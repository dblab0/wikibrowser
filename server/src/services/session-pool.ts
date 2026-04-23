import { ChildProcess, spawn } from 'child_process';
import * as os from 'os';
import type { ProcessInfo } from './ai.js';
import * as configService from './config.js';
import { aiInfo, aiDebug, aiError } from './logger.js';
import {
  SessionPoolConfig,
  SessionStatus,
  QueueEntry,
  PoolStats,
  PoolSessionInfo,
  SessionMeta,
  DEFAULT_POOL_CONFIG,
} from './session-pool.types.js';

/**
 * 进程启动函数签名，由外部注入（依赖注入，避免循环依赖）。
 */
export type StartProcessFn = (
  sessionId: string,
  projectPath: string,
) => Promise<ProcessInfo>;

export class SessionPoolManager {
  private config: SessionPoolConfig;
  private activeProcesses: Map<string, ProcessInfo> = new Map();
  private sessionMetas: Map<string, SessionMeta> = new Map();
  private waitQueue: QueueEntry[] = [];
  private evictionTimer: NodeJS.Timeout | null = null;

  // 依赖注入的进程启动函数
  private startProcessFn: StartProcessFn;

  // 统计
  private stats = {
    totalActivations: 0,
    totalEvictions: 0,
    totalQueueTimeouts: 0,
  };

  // WebSocket 通知回调（由外部设置）
  private deactivateNotifier:
    | ((sessionId: string, reason: 'idle_timeout' | 'evicted') => void)
    | null = null;

  constructor(
    startProcessFn: StartProcessFn,
    config?: Partial<SessionPoolConfig>,
  ) {
    this.startProcessFn = startProcessFn;

    // 从 AppConfig 合并 sessionPool 配置
    const appConfig = configService.getConfig();
    const appPoolConfig = appConfig.sessionPool ?? {};
    this.config = { ...DEFAULT_POOL_CONFIG, ...appPoolConfig, ...config };
  }

  // ===== 公共属性 =====

  get activeCount(): number {
    return this.activeProcesses.size;
  }

  get queueLength(): number {
    return this.waitQueue.length;
  }

  getProcess(sessionId: string): ProcessInfo | undefined {
    return this.activeProcesses.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.activeProcesses.has(sessionId);
  }

  // ===== 通知器 =====

  setDeactivateNotifier(
    notifier: (sessionId: string, reason: 'idle_timeout' | 'evicted') => void,
  ): void {
    this.deactivateNotifier = notifier;
  }

  // ===== 会话元数据管理 =====

  /**
   * 注册会话元数据。activate 和 createSession 时调用。
   */
  registerSessionMeta(sessionId: string, projectId: string, projectPath: string): void {
    this.sessionMetas.set(sessionId, { sessionId, projectId, projectPath });
  }

  /**
   * 获取会话元数据。
   */
  getSessionMeta(sessionId: string): SessionMeta | undefined {
    return this.sessionMetas.get(sessionId);
  }

  /**
   * 删除会话元数据（仅用于 deleteSession 场景）。
   */
  removeSessionMeta(sessionId: string): boolean {
    return this.sessionMetas.delete(sessionId);
  }

  // ===== 核心：activate =====

  /**
   * 激活一个会话进程。
   *
   * 1. 如果进程已存在，直接返回 ProcessInfo
   * 2. 池未满 → 启动进程
   * 3. 池已满 → 尝试 LRU 驱逐 → 成功则启动
   * 4. 全满且无法驱逐 → 排队等待
   */
  async activate(sessionId: string): Promise<ProcessInfo> {
    // 1. 已激活 → 直接返回
    const existing = this.activeProcesses.get(sessionId);
    if (existing) {
      aiDebug(`[Pool] activate(${sessionId}): already active`);
      return existing;
    }

    // 2. 池未满 → 直接启动
    if (this.activeProcesses.size < this.config.maxSessions) {
      return this.startProcessInPool(sessionId);
    }

    // 3. 池已满 → 尝试 LRU 驱逐
    aiInfo(`[Pool] activate(${sessionId}): pool full (${this.activeProcesses.size}/${this.config.maxSessions}), attempting LRU eviction`);
    const evicted = this.evictLRU();
    if (evicted) {
      return this.startProcessInPool(sessionId);
    }

    // 4. 全满且无法驱逐 → 排队等待
    aiInfo(`[Pool] activate(${sessionId}): no evictable session, enqueueing`);
    return this.enqueueAndWait(sessionId);
  }

  // ===== 核心：deactivate =====

  /**
   * 停用一个会话进程。
   *
   * 1. 获取 ProcessInfo
   * 2. 清理 pending requests（reject with error）
   * 3. Kill 进程
   * 4. 从 activeProcesses 中删除
   * 5. 保留 sessionMeta（不删除）
   * 6. 如果有 deactivateNotifier，调用通知
   * 7. stats.totalEvictions++
   * 8. 调用 processQueue()
   */
  deactivate(
    sessionId: string,
    reason: 'idle_timeout' | 'evicted' | 'manual' = 'manual',
  ): boolean {
    const processInfo = this.activeProcesses.get(sessionId);
    if (!processInfo) {
      return false;
    }

    aiInfo(`[Pool] deactivate(${sessionId}): reason=${reason}`);

    // 清理 pending requests
    for (const [id, pending] of processInfo.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Process deactivated: ${reason}`));
    }

    // Kill 进程
    try {
      if (os.platform() === 'win32') {
        spawn('taskkill', ['/pid', String(processInfo.proc.pid), '/f', '/t']);
      } else {
        processInfo.proc.kill('SIGTERM');
      }
    } catch (err) {
      aiError(`[Pool] Error killing process for session ${sessionId}:`, err);
    }

    // 从 activeProcesses 中删除
    this.activeProcesses.delete(sessionId);

    // 保留 sessionMeta（不删除）

    // 通知外部（WebSocket 等）
    if (this.deactivateNotifier) {
      this.deactivateNotifier(sessionId, reason === 'manual' ? 'evicted' : reason);
    }

    // 更新统计
    this.stats.totalEvictions++;

    // 处理排队
    this.processQueue();

    return true;
  }

  // ===== 进程启动 =====

  /**
   * 从 sessionMetas 获取 projectPath，启动进程并存入 activeProcesses。
   */
  private async startProcessInPool(sessionId: string): Promise<ProcessInfo> {
    const meta = this.sessionMetas.get(sessionId);
    if (!meta) {
      throw new Error(
        `SessionMeta not found for session ${sessionId}. Register meta before activating.`,
      );
    }

    aiDebug(`[Pool] startProcessInPool(${sessionId}): projectPath=${meta.projectPath}`);
    const processInfo = await this.startProcessFn(sessionId, meta.projectPath);

    this.activeProcesses.set(sessionId, processInfo);
    this.stats.totalActivations++;

    aiInfo(
      `[Pool] Process activated: sessionId=${sessionId}, activeCount=${this.activeProcesses.size}/${this.config.maxSessions}`,
    );

    return processInfo;
  }

  // ===== LRU 驱逐 =====

  /**
   * 驱逐 lastActivity 最早且无 pendingRequests 的会话。
   * 返回是否成功驱逐。
   */
  evictLRU(): boolean {
    let oldestSessionId: string | null = null;
    let oldestActivity = Infinity;

    for (const [sessionId, processInfo] of this.activeProcesses) {
      // 只驱逐无 pending requests 的会话
      if (processInfo.pendingRequests.size > 0) {
        continue;
      }
      if (processInfo.lastActivity < oldestActivity) {
        oldestActivity = processInfo.lastActivity;
        oldestSessionId = sessionId;
      }
    }

    if (oldestSessionId === null) {
      aiDebug('[Pool] evictLRU: no evictable session found');
      return false;
    }

    aiInfo(`[Pool] evictLRU: evicting session ${oldestSessionId}, lastActivity=${oldestActivity}`);
    return this.deactivate(oldestSessionId, 'evicted');
  }

  // ===== 空闲回收 =====

  /**
   * 启动定期清扫循环。
   */
  startEvictionLoop(): void {
    if (this.evictionTimer) {
      return; // 已在运行
    }

    aiInfo(
      `[Pool] Starting eviction loop, interval=${this.config.evictionIntervalMs}ms, idleTimeout=${this.config.idleTimeoutMs}ms`,
    );

    this.evictionTimer = setInterval(() => {
      this.evictIdle();
    }, this.config.evictionIntervalMs);

    // 允许进程退出时定时器不阻止退出
    if (this.evictionTimer.unref) {
      this.evictionTimer.unref();
    }
  }

  /**
   * 清扫所有空闲超时的会话。
   * 跳过有 pendingRequests 的会话。
   */
  private evictIdle(): void {
    const now = Date.now();
    const sessionsToEvict: string[] = [];

    for (const [sessionId, processInfo] of this.activeProcesses) {
      // 跳过有 pending requests 的会话
      if (processInfo.pendingRequests.size > 0) {
        continue;
      }

      const idleMs = now - processInfo.lastActivity;
      if (idleMs >= this.config.idleTimeoutMs) {
        sessionsToEvict.push(sessionId);
      }
    }

    if (sessionsToEvict.length > 0) {
      aiInfo(
        `[Pool] evictIdle: found ${sessionsToEvict.length} idle session(s) to evict`,
      );
      for (const sessionId of sessionsToEvict) {
        this.deactivate(sessionId, 'idle_timeout');
      }
    }
  }

  /**
   * 停止清扫循环。
   */
  stopEvictionLoop(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
      aiInfo('[Pool] Eviction loop stopped');
    }
  }

  // ===== 排队机制 =====

  /**
   * 将会话加入等待队列，返回 Promise。
   * 当有可用槽位时，processQueue 会 resolve 此 Promise。
   */
  private enqueueAndWait(sessionId: string): Promise<ProcessInfo> {
    // 检查队列是否已满
    if (this.waitQueue.length >= this.config.maxQueueSize) {
      throw new Error(
        `Session pool queue is full (${this.waitQueue.length}/${this.config.maxQueueSize}). Cannot activate session ${sessionId}.`,
      );
    }

    return new Promise<ProcessInfo>((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        // 超时：从队列中移除
        const idx = this.waitQueue.findIndex((e) => e.sessionId === sessionId);
        if (idx !== -1) {
          this.waitQueue.splice(idx, 1);
        }
        this.stats.totalQueueTimeouts++;
        aiInfo(`[Pool] enqueueAndWait(${sessionId}): queue timeout`);
        reject(new Error(`Queue timeout for session ${sessionId}`));
      }, this.config.queueTimeoutMs);

      const entry: QueueEntry = {
        sessionId,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        timeoutTimer,
      };

      this.waitQueue.push(entry);
      aiInfo(
        `[Pool] enqueueAndWait(${sessionId}): enqueued, queueLength=${this.waitQueue.length}`,
      );
    });
  }

  /**
   * FIFO 处理等待队列：为等待的请求启动进程。
   */
  private processQueue(): void {
    while (this.waitQueue.length > 0 && this.activeProcesses.size < this.config.maxSessions) {
      const entry = this.waitQueue.shift()!;
      clearTimeout(entry.timeoutTimer);

      // 尝试启动进程
      this.startProcessInPool(entry.sessionId)
        .then((processInfo) => {
          entry.resolve(processInfo);
        })
        .catch((err) => {
          aiError(`[Pool] processQueue: failed to start process for ${entry.sessionId}:`, err);
          entry.reject(err);
          // 继续处理下一个
          this.processQueue();
        });
    }
  }

  // ===== 统计数据 =====

  /**
   * 返回池统计摘要。
   */
  getStats(): PoolStats {
    // 计算 inactive 数量：sessionMetas 中存在但不在 activeProcesses 中的
    let inactiveCount = 0;
    for (const [sessionId] of this.sessionMetas) {
      if (!this.activeProcesses.has(sessionId)) {
        inactiveCount++;
      }
    }

    return {
      activeCount: this.activeProcesses.size,
      maxSessions: this.config.maxSessions,
      inactiveCount,
      queueLength: this.waitQueue.length,
      totalActivations: this.stats.totalActivations,
      totalEvictions: this.stats.totalEvictions,
      totalQueueTimeouts: this.stats.totalQueueTimeouts,
    };
  }

  /**
   * 返回所有会话详情列表。
   */
  getSessionList(): PoolSessionInfo[] {
    const now = Date.now();
    const result: PoolSessionInfo[] = [];

    for (const [sessionId, meta] of this.sessionMetas) {
      const processInfo = this.activeProcesses.get(sessionId);
      const isActive = !!processInfo;

      result.push({
        sessionId,
        projectId: meta.projectId,
        status: isActive ? 'ACTIVE' : ('INACTIVE' as SessionStatus),
        lastActivity: processInfo ? processInfo.lastActivity : 0,
        idleMs: processInfo ? now - processInfo.lastActivity : 0,
      });
    }

    return result;
  }

  // ===== 关闭 =====

  /**
   * 关闭池：停止所有进程、清理队列、停止清扫循环。
   */
  shutdown(): void {
    aiInfo('[Pool] Shutting down session pool...');

    // 停止清扫循环
    this.stopEvictionLoop();

    // 清理等待队列
    for (const entry of this.waitQueue) {
      clearTimeout(entry.timeoutTimer);
      entry.reject(new Error('Session pool is shutting down'));
    }
    this.waitQueue = [];

    // 停止所有活跃进程
    for (const [sessionId] of this.activeProcesses) {
      this.deactivate(sessionId, 'manual');
    }

    aiInfo('[Pool] Session pool shut down complete');
  }
}

// ===== 单例实例 =====

/** 会话池单例实例（延迟初始化） */
let sessionPoolInstance: SessionPoolManager | null = null;

/**
 * 获取会话池单例。如未初始化则自动初始化（使用默认配置）。
 */
export function getSessionPool(): SessionPoolManager {
  if (!sessionPoolInstance) {
    initSessionPool();
  }
  return sessionPoolInstance!;
}

/**
 * 初始化会话池单例并启动空闲回收循环。
 * 由 ai.ts 的 initAI() 调用。
 */
export function initSessionPool(): void {
  if (sessionPoolInstance) {
    return; // 已初始化
  }

  // 依赖注入：使用 ai.ts 的 startProcess 作为进程启动函数
  // 此处不能直接 import ai.ts 的 startProcess，否则会循环依赖。
  // 改为延迟绑定：先创建池，再通过外部调用注入 startProcessFn。
  // 但 SessionPoolManager 构造函数需要 StartProcessFn，
  // 所以我们使用一个间接导入的方式。
  sessionPoolInstance = new SessionPoolManager(
    async (sessionId: string, projectPath: string) => {
      // 延迟导入避免循环依赖
      const { startProcess } = await import('./ai.js');
      return startProcess(sessionId, projectPath);
    },
  );

  sessionPoolInstance.startEvictionLoop();
  aiInfo('[Pool] Session pool initialized and eviction loop started');

  // 触发待执行的延迟回调（例如 setDeactivateNotifier 延迟调用）
  for (const cb of pendingInitCallbacks) {
    cb(sessionPoolInstance);
  }
  pendingInitCallbacks = [];
}

/** 等待池初始化后执行的回调队列 */
let pendingInitCallbacks: Array<(pool: SessionPoolManager) => void> = [];

/**
 * 在池初始化后执行回调。如果已初始化则立即执行。
 * 用于解决模块加载顺序依赖问题。
 */
export function onPoolReady(cb: (pool: SessionPoolManager) => void): void {
  if (sessionPoolInstance) {
    cb(sessionPoolInstance);
  } else {
    pendingInitCallbacks.push(cb);
  }
}

/**
 * 导出单例快捷引用。
 * 使用 getSessionPool() 更安全，但为了与现有 import 兼容也导出此代理。
 */
export const sessionPool: SessionPoolManager = new Proxy({} as SessionPoolManager, {
  get(_target, prop) {
    const pool = getSessionPool();
    return (pool as any)[prop];
  },
});
