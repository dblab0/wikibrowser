/** 会话池配置 */
export interface SessionPoolConfig {
  maxSessions: number;         // 最大活跃进程数，默认 20
  idleTimeoutMs: number;       // 空闲超时(ms)，默认 10*60*1000
  evictionIntervalMs: number;  // 清扫间隔(ms)，默认 60*1000
  maxQueueSize: number;        // 等待队列上限，默认 50
  queueTimeoutMs: number;      // 排队超时(ms)，默认 5*60*1000
}

/** 会话默认配置常量 */
export const DEFAULT_POOL_CONFIG: SessionPoolConfig = {
  maxSessions: 20,
  idleTimeoutMs: 10 * 60 * 1000,
  evictionIntervalMs: 60 * 1000,
  maxQueueSize: 50,
  queueTimeoutMs: 5 * 60 * 1000,
};

/** 会话状态 */
export type SessionStatus = 'ACTIVE' | 'INACTIVE';

/** 排队条目 */
export interface QueueEntry {
  sessionId: string;
  resolve: (processInfo: any) => void;  // 解析为 ProcessInfo
  reject: (error: Error) => void;
  enqueuedAt: number;
  timeoutTimer: NodeJS.Timeout;
}

/** 池统计 */
export interface PoolStats {
  activeCount: number;
  maxSessions: number;
  inactiveCount: number;
  queueLength: number;
  totalActivations: number;
  totalEvictions: number;
  totalQueueTimeouts: number;
}

/** 池中会话详情 */
export interface PoolSessionInfo {
  sessionId: string;
  projectId: string;
  status: SessionStatus;
  lastActivity: number;
  idleMs: number;
}

/** 会话元数据（INACTIVE 状态保留） */
export interface SessionMeta {
  sessionId: string;
  projectId: string;
  projectPath: string;
}
