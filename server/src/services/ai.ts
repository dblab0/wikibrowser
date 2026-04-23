import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import readline from 'readline';
import * as configService from './config.js';
import { extractTitleAsync, extractMessagesStreaming, extractFirstTimestamp } from './wire-reader.js';
import { aiInfo, aiDebug, aiError } from './logger.js';
import { sessionPool, initSessionPool } from './session-pool.js';

/** 待处理的 JSON-RPC 请求 */
interface PendingRequest {
  resolve: (value: any) => void;   // 请求成功回调
  reject: (reason: any) => void;   // 请求失败回调
  timer: NodeJS.Timeout;           // 超时定时器
}

/**
 * kimi 进程信息
 */
export interface ProcessInfo {
  proc: ChildProcess;                              // 子进程实例
  sessionId: string;                               // 会话 ID
  projectPath: string;                             // 项目路径
  initialized: boolean;                            // 是否已完成初始化握手
  initPromise: Promise<void>;                      // 初始化握手完成的 Promise，失败/超时时 reject
  lastActivity: number;                            // 最后活跃时间戳
  eventEmitter: EventEmitter;                      // 事件发射器
  pendingRequests: Map<string, PendingRequest>;    // 待处理的请求映射
  msgIdCounter: number;                            // 消息 ID 计数器
}

const INITIALIZE_TIMEOUT = 30000; // 初始化握手超时 30 秒

/** 启动时一次性缓存的 kimi 安装状态 */
let cachedKimiStatus: { available: boolean; version?: string } | null = null;

/**
 * 获取 prompt 超时时间（毫秒），从配置读取，默认 10 分钟
 * @returns 超时毫秒数
 */
function getPromptTimeout(): number {
  const config = configService.getConfig();
  const timeoutMinutes = config.aiPromptTimeout ?? 10;
  return timeoutMinutes * 60 * 1000;
}

/**
 * 跨平台启动 kimi CLI 进程。
 * Windows 下 kimi 安装为 kimi.cmd（需要 shell 模式），
 * 将完整命令作为单字符串传入以避免 DEP0190 弃用警告。
 *
 * @param args - 命令行参数数组
 * @param options - spawn 选项
 * @returns 子进程实例
 */
function spawnKimi(args: string[], options: { stdio: any[] }): ChildProcess {
  if (os.platform() === 'win32') {
    // Windows 下将命令作为单字符串传入，避免 DEP0190 弃用警告
    const cmdParts = ['kimi', ...args].map(a => a.includes(' ') ? `"${a}"` : a).join(' ');
    aiInfo(`[AI] Spawning kimi (win32): ${cmdParts}`);
    return spawn(cmdParts, [], { ...options, shell: true, windowsHide: true });
  }
  aiInfo(`[AI] Spawning kimi: kimi ${args.join(' ')}`);
  return spawn('kimi', args, options);
}

/**
 * 服务启动时检查 kimi 是否已安装，结果缓存在内存中。
 * 如果未安装，仅打印警告，不阻止服务启动。
 */
export async function initAI(): Promise<void> {
  cachedKimiStatus = await detectKimi();
  if (cachedKimiStatus.available) {
    aiInfo(`[AI] kimi CLI detected: v${cachedKimiStatus.version}`);
  } else {
    aiInfo('[AI] kimi CLI not found. AI features will be unavailable.');
  }

  // 初始化会话池管理器
  initSessionPool();
}

/**
 * 实际执行 `kimi --version` 检测。
 */
async function detectKimi(): Promise<{ available: boolean; version?: string }> {
  return new Promise((resolve) => {
    try {
      const proc = spawnKimi(['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';

      proc.stdout!.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.stderr!.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && output.trim()) {
          const match = output.trim().match(/(\d+\.\d+\.\d+)/);
          resolve({ available: true, version: match ? match[1] : output.trim() });
        } else {
          resolve({ available: false });
        }
      });

      proc.on('error', () => {
        resolve({ available: false });
      });

      // 超时兜底
      setTimeout(() => {
        proc.kill();
        resolve({ available: false });
      }, 10000);
    } catch {
      resolve({ available: false });
    }
  });
}

/**
 * 返回缓存的 kimi 安装状态（启动时已检查）
 * @returns 包含 available 和可选 version 的状态对象
 */
export function checkInstalled(): { available: boolean; version?: string } {
  return cachedKimiStatus ?? { available: false };
}

/**
 * 获取 kimi 会话根目录：~/.kimi/sessions
 * @returns 会话根目录路径
 */
function getKimiSessionsDir(): string {
  return path.join(os.homedir(), '.kimi', 'sessions');
}

/**
 * 计算项目路径的 work-dir-hash，与 kimi-cli 的哈希算法一致。
 * 用于定位 kimi 存储会话的目录结构。
 *
 * @param projectPath - 项目路径
 * @returns MD5 哈希字符串
 */
function getWorkDirHash(projectPath: string): string {
  const resolved = path.resolve(projectPath);
  // 与 kimi-cli metadata.py 一致: md5(path.encode("utf-8")).hexdigest()
  return createHash('md5').update(resolved, 'utf8').digest('hex');
}

/**
 * 获取指定项目和会话 ID 的会话目录路径
 * @param projectPath - 项目路径
 * @param sessionId - 会话 ID
 * @returns 会话目录路径
 */
function getSessionDir(projectPath: string, sessionId: string): string {
  const workDirHash = getWorkDirHash(projectPath);
  return path.join(getKimiSessionsDir(), workDirHash, sessionId);
}

/**
 * 向进程 stdin 发送 JSON-RPC 消息
 * @param proc - 子进程实例
 * @param msg - JSON-RPC 消息对象
 */
function sendMessage(proc: ChildProcess, msg: object): void {
  const line = JSON.stringify(msg) + '\n';
  aiDebug(`[AI] >>> Sending to kimi stdin: ${line.trim().substring(0, 200)}`);
  const written = proc.stdin?.write(line);
  aiDebug(`[AI] >>> stdin.write returned: ${written}, proc.killed=${proc.killed}, proc.exitCode=${proc.exitCode}`);
}

/**
 * 启动 kimi 进程并完成初始化握手。
 * 此函数注入到 SessionPoolManager 中用于进程创建，池内部管理进程映射。
 *
 * @param sessionId - 会话 ID
 * @param projectPath - 项目路径
 * @returns 进程信息对象
 */
export async function startProcess(
  sessionId: string,
  projectPath: string
): Promise<ProcessInfo> {
  // 如果池中已存在该会话的进程，直接返回（等待初始化完成）
  const existing = sessionPool.getProcess(sessionId);
  if (existing) {
    if (!existing.initialized) {
      await existing.initPromise;
    }
    return existing;
  }

  const eventEmitter = new EventEmitter();
  const pendingRequests = new Map<string, PendingRequest>();

  const config = configService.getConfig();
  const spawnArgs = ['--wire', '--work-dir', projectPath, '--session', sessionId];
  if (config.yolo) spawnArgs.push('--yolo');

  const proc = spawnKimi(spawnArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  aiInfo(`[AI] kimi process spawned, pid=${proc.pid}, sessionId=${sessionId}`);

  // 创建 initPromise，使其他调用方可以等待初始化完成
  let initResolve!: () => void;
  let initReject!: (err: unknown) => void;
  const initPromise = new Promise<void>((resolve, reject) => {
    initResolve = resolve;
    initReject = reject;
  });

  const processInfo: ProcessInfo = {
    proc,
    sessionId,
    projectPath,
    initialized: false,
    initPromise,
    lastActivity: Date.now(),
    eventEmitter,
    pendingRequests,
    msgIdCounter: 1,
  };

  // 处理 stdout，逐行解析 JSON-RPC 消息
  const rl = readline.createInterface({ input: proc.stdout! });
  rl.on('line', (line: string) => {
    if (!line.trim()) return;
    try {
      const msg = JSON.parse(line);
      handleIncomingMessage(processInfo, msg);
    } catch (err) {
      aiError('[AI] Failed to parse stdout line:', line, err);
    }
  });

  // 处理 stderr，记录调试日志
  proc.stderr?.on('data', (data: Buffer) => {
    aiError('[AI] kimi stderr:', data.toString());
  });

  // 处理进程退出
  proc.on('close', (code, signal) => {
    aiInfo(`[AI] kimi process exited with code=${code} signal=${signal} for session ${sessionId}`);
    // 拒绝所有待处理的请求
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Process exited with code ${code}`));
      pendingRequests.delete(id);
    }
    // 委托池清理；如果池不可用则直接停用
    if (sessionPool) {
      sessionPool.deactivate(sessionId);
    }
    eventEmitter.emit('process-exit', { code, sessionId });
  });

  proc.on('error', (err) => {
    aiError(`[AI] kimi process error for session ${sessionId}:`, err);
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(err);
      pendingRequests.delete(id);
    }
    if (sessionPool) {
      sessionPool.deactivate(sessionId);
    }
  });

  // 发送初始化握手消息
  const initMsg = {
    jsonrpc: '2.0',
    method: 'initialize',
    id: 'init',
    params: {
      protocol_version: '1.8',
      client: {
        name: 'wikibrowser',
        version: '1.0.0',
      },
      capabilities: {
        supports_question: true,
      },
    },
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      processInfo.pendingRequests.delete('init');
      aiInfo(`[AI] Initialize handshake TIMED OUT for session ${sessionId}`);
      stopProcess(sessionId);
      initReject(new Error('Initialize handshake timed out'));
      reject(new Error('Initialize handshake timed out'));
    }, INITIALIZE_TIMEOUT);

    processInfo.pendingRequests.set('init', {
      resolve: (result: any) => {
        clearTimeout(timer);
        processInfo.initialized = true;
        processInfo.pendingRequests.delete('init');
        aiInfo(`[AI] Session ${sessionId} initialized successfully, init result: ${JSON.stringify(result).substring(0, 200)}`);
        initResolve();
        resolve(processInfo);
      },
      reject: (err: any) => {
        clearTimeout(timer);
        processInfo.pendingRequests.delete('init');
        aiInfo(`[AI] Session ${sessionId} init REJECTED: ${err}`);
        initReject(err);
        reject(err);
      },
      timer,
    });

    aiDebug(`[AI] Sending initialize handshake for session ${sessionId}...`);
    sendMessage(proc, initMsg);
  });
}

/**
 * 处理来自 kimi 进程的 JSON-RPC 消息
 * @param processInfo - 进程信息对象
 * @param msg - 解析后的 JSON-RPC 消息
 */
function handleIncomingMessage(processInfo: ProcessInfo, msg: any): void {
  processInfo.lastActivity = Date.now();

  // 之前的请求响应（包含 id 和 result 或 error）
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
    aiDebug(`[AI] <<< Response received: id=${msg.id}, hasResult=${msg.result !== undefined}, hasError=${msg.error !== undefined}`);
    const pending = processInfo.pendingRequests.get(String(msg.id));
    if (pending) {
      clearTimeout(pending.timer);
      processInfo.pendingRequests.delete(String(msg.id));
      if (msg.error) {
        aiDebug(`[AI] <<< Rejecting pending request id=${msg.id}, error=${JSON.stringify(msg.error).substring(0, 200)}`);
        pending.reject(msg.error);
      } else {
        aiDebug(`[AI] <<< Resolving pending request id=${msg.id}`);
        pending.resolve(msg.result);
      }
    } else {
      aiDebug(`[AI] <<< No pending request found for id=${msg.id}`);
    }
    return;
  }

  // 来自 kimi 的通知（method: "event"）
  if (msg.method === 'event') {
    const { type, payload } = msg.params || {};
    const p = payload as Record<string, unknown> | undefined;

    // 结构化日志：按事件类型提取关键信息
    switch (type) {
      case 'ToolCall': {
        const func = p?.function as Record<string, unknown> | undefined;
        const funcName = func?.name ?? 'unknown';
        const rawArgs = func?.arguments;
        const argsType = rawArgs === undefined ? 'undefined' : typeof rawArgs;
        const argsPreview = (() => {
          try { return JSON.stringify(rawArgs).substring(0, 200); } catch { return '[unserializable]'; }
        })();
        aiDebug(`[AI] <<< Event: ToolCall → name=${funcName}, argsType=${argsType}, argsPreview=${argsPreview}`);
        break;
      }
      case 'ToolResult': {
        const rv = p?.return_value as Record<string, unknown> | undefined;
        const isError = Boolean(rv?.is_error);
        const output = typeof rv?.output === 'string' ? (rv.output as string) : '';
        aiDebug(`[AI] <<< Event: ToolResult → isError=${isError}, outputLen=${output.length}`);
        break;
      }
      case 'ContentPart': {
        const contentType = p?.type ?? 'text';
        const text = typeof p?.text === 'string' ? (p.text as string) : '';
        const think = typeof p?.think === 'string' ? (p.think as string) : '';
        const content = text || think;
        aiDebug(`[AI] <<< Event: ContentPart → contentType=${contentType}, textLen=${content.length}`);
        break;
      }
      case 'SubagentEvent': {
        const agentType = p?.subagent_type ?? 'unknown';
        const innerEvent = p?.event as Record<string, unknown> | undefined;
        const innerType = (innerEvent?.type as string) ?? 'unknown';
        aiDebug(`[AI] <<< Event: SubagentEvent → agentType=${agentType}, innerType=${innerType}`);
        break;
      }
      case 'ToolCallPart': {
        const toolCallId = p?.tool_call_id ?? 'unknown';
        const partLen = typeof p?.arguments_part === 'string' ? (p.arguments_part as string).length : 0;
        aiDebug(`[AI] <<< Event: ToolCallPart → toolCallId=${toolCallId}, partLen=${partLen}`);
        break;
      }
      case 'StatusUpdate': {
        const tokenUsage = p?.token_usage as Record<string, unknown> | undefined;
        const contextUsage = p?.context_usage;
        aiDebug(`[AI] <<< Event: StatusUpdate → contextUsage=${contextUsage}, tokens=${JSON.stringify(tokenUsage)}`);
        break;
      }
      case 'QuestionRequest': {
        const questions = Array.isArray(p?.questions) ? (p!.questions as unknown[]).length : 0;
        aiDebug(`[AI] <<< Event: QuestionRequest → questions=${questions}`);
        break;
      }
      default: {
        const payloadStr = JSON.stringify(payload);
        const payloadPreview = payloadStr.length > 500 ? payloadStr.substring(0, 500) + '...' : payloadStr;
        aiDebug(`[AI] <<< Event: type=${type}, payload=${payloadPreview}`);
        break;
      }
    }

    processInfo.eventEmitter.emit('wire-event', { type, payload });
    return;
  }

  // 来自 kimi 的请求（method: "request"，例如 ApprovalRequest）
  if (msg.method === 'request') {
    const { id: requestId, type, payload } = msg.params || {};
    const rp = payload as Record<string, unknown> | undefined;

    // 结构化日志
    if (type === 'ApprovalRequest') {
      const action = rp?.action ?? 'unknown';
      const toolCallId = rp?.tool_call_id ?? 'unknown';
      const description = typeof rp?.description === 'string' ? (rp.description as string).substring(0, 150) : '';
      aiDebug(`[AI] <<< Request: ApprovalRequest → requestId=${requestId}, action=${action}, toolCallId=${toolCallId}, desc=${description}`);
    } else if (type === 'QuestionRequest') {
      const questions = Array.isArray(rp?.questions) ? (rp!.questions as unknown[]).length : 0;
      aiDebug(`[AI] <<< Request: QuestionRequest → requestId=${requestId}, questions=${questions}`);
    } else {
      const reqPayloadStr = JSON.stringify(payload);
      const reqPreview = reqPayloadStr.length > 500 ? reqPayloadStr.substring(0, 500) + '...' : reqPayloadStr;
      aiDebug(`[AI] <<< Request from kimi: type=${type}, requestId=${requestId}, payload=${reqPreview}`);
    }
    processInfo.eventEmitter.emit('wire-request', {
      id: requestId || String(msg.id),
      type,
      payload,
    });
    return;
  }

  // 会话状态通知（method: "session_status"）
  if (msg.method === 'session_status') {
    const { session_id, state, reason } = msg.params || {};
    aiDebug(`[AI] <<< Session status: session_id=${session_id}, state=${state}`);
    processInfo.eventEmitter.emit('wire-event', {
      type: 'SessionStatus',
      payload: { session_id, state, reason }
    });
    return;
  }

  // 记录未识别的消息
  aiDebug('[AI] Unhandled message:', JSON.stringify(msg));
}

/**
 * 向 kimi 进程发送 prompt 消息。
 * 使用 sessionPool.activate 确保进程正在运行（启动、驱逐或排队）。
 *
 * @param sessionId - 会话 ID
 * @param message - 用户输入消息
 * @returns JSON-RPC 响应结果
 */
export async function sendPrompt(sessionId: string, message: string): Promise<any> {
  aiDebug(`[AI] sendPrompt called: sessionId=${sessionId}, message="${message.substring(0, 50)}..."`);

  // sessionPool.activate 处理：已激活→直接返回 / 池未满→启动 / 池已满→驱逐→启动 / 全满→排队
  const processInfo = await sessionPool.activate(sessionId);
  aiDebug(`[AI] Process obtained: initialized: ${processInfo.initialized}, pid: ${processInfo.proc?.pid}`);

  // 如果初始化仍在进行中，等待完成
  if (!processInfo.initialized) {
    aiDebug(`[AI] Session ${sessionId} not yet initialized, waiting...`);
    await processInfo.initPromise;
    // 初始化失败期间进程可能已被移除，重新获取
    const refreshed = sessionPool.getProcess(sessionId);
    if (!refreshed || !refreshed.initialized) {
      throw new Error(`Session initialization failed: ${sessionId}`);
    }
  }

  const msgId = String(++processInfo.msgIdCounter);
  const rpcMsg = {
    jsonrpc: '2.0',
    method: 'prompt',
    id: msgId,
    params: {
      user_input: message,
    },
  };

  aiDebug(`[AI] Sending prompt RPC: msgId=${msgId}, waiting for response...`);

  return new Promise((resolve, reject) => {
    const timeoutMs = getPromptTimeout();
    const timer = setTimeout(() => {
      processInfo!.pendingRequests.delete(msgId);
      aiInfo(`[AI] Prompt msgId=${msgId} timed out after ${timeoutMs / 60000}min`);
      reject(new Error('Prompt request timed out'));
    }, timeoutMs);

    processInfo!.pendingRequests.set(msgId, {
      resolve: (result: any) => {
        clearTimeout(timer);
        aiDebug(`[AI] Prompt msgId=${msgId} resolved`);
        resolve(result);
      },
      reject: (err: any) => {
        clearTimeout(timer);
        aiDebug(`[AI] Prompt msgId=${msgId} rejected: ${err}`);
        reject(err);
      },
      timer,
    });
    sendMessage(processInfo!.proc, rpcMsg);
  });
}

/**
 * 响应审批请求。
 * 发送 JSON-RPC 响应（非请求），匹配原始请求 ID。
 * Kimi-CLI 的 WireServer._handle_response 期望格式：
 *   {"jsonrpc": "2.0", "id": "<original_request_id>", "result": {"request_id": "...", "response": "approve", "feedback": ""}}
 *
 * @param sessionId - 会话 ID
 * @param requestId - 原始请求 ID
 * @param response - 审批结果（"approve" 或 "reject"）
 */
export function respondApproval(
  sessionId: string,
  requestId: string,
  response: 'approve' | 'reject'
): void {
  const processInfo = sessionPool.getProcess(sessionId);
  if (!processInfo) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const rpcMsg = {
    jsonrpc: '2.0',
    id: requestId,
    result: {
      request_id: requestId,
      response,
      feedback: '',
    },
  };

  sendMessage(processInfo.proc, rpcMsg);
}

/**
 * 取消当前生成操作，发送 cancel JSON-RPC 消息。
 * 不会终止进程，仅取消当前操作。
 *
 * @param sessionId - 会话 ID
 */
export function cancelGeneration(sessionId: string): void {
  const processInfo = sessionPool.getProcess(sessionId);
  if (!processInfo) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const msgId = String(++processInfo.msgIdCounter);
  const rpcMsg = {
    jsonrpc: '2.0',
    method: 'cancel',
    id: msgId,
    params: {},
  };

  sendMessage(processInfo.proc, rpcMsg);
}

/**
 * 停止进程，委托给会话池管理
 * @param sessionId - 会话 ID
 */
export function stopProcess(sessionId: string): void {
  sessionPool.deactivate(sessionId, 'manual');
}

/**
 * 获取会话的事件发射器
 * @param sessionId - 会话 ID
 * @returns EventEmitter 实例或 undefined
 */
export function getEventEmitter(sessionId: string): EventEmitter | undefined {
  return sessionPool.getProcess(sessionId)?.eventEmitter;
}

/**
 * 获取会话的进程信息
 * @param sessionId - 会话 ID
 * @returns ProcessInfo 实例或 undefined
 */
export function getProcess(sessionId: string): ProcessInfo | undefined {
  return sessionPool.getProcess(sessionId);
}

/**
 * 列出项目的所有会话。
 * 使用内存中的进程映射和配置作为数据源，不依赖读取 kimi 内部目录的 wire.jsonl 文件。
 * 使用 Promise.all 并行读取所有会话标题，提升加载速度。
 *
 * @param projectId - 项目 ID
 * @returns 会话列表
 */
export async function listSessions(projectId: string): Promise<any[]> {
  const config = configService.getConfig();
  const sessionIds = config.projectSessions?.[projectId] || [];

  // 查找项目路径
  const project = config.projects.find((p) => p.id === projectId);
  if (!project) return [];

  // 并行处理所有会话
  const sessions = await Promise.all(
    sessionIds.map(async (sid) => {
      const isActive = sessionPool.has(sid);
      const processInfo = sessionPool.getProcess(sid);

      // 从 wire.jsonl 提取标题和创建时间
      const sessionDir = getSessionDir(project.path, sid);
      const wirePath = path.join(sessionDir, 'wire.jsonl');
      let title = '新对话';
      let createdAt = 0;
      try {
        if (existsSync(wirePath)) {
          title = await extractTitleAsync(wirePath);
          createdAt = await extractFirstTimestamp(wirePath);
        }
      } catch (err) {
        aiError(`[AI] Failed to extract title for session ${sid}:`, err);
      }

      return {
        id: sid,
        projectId,
        projectPath: project.path,
        title,
        status: isActive ? 'active' as const : 'idle' as const,
        createdAt,
        updatedAt: processInfo ? processInfo.lastActivity : createdAt,
      };
    })
  );

  return sessions;
}

/**
 * 获取会话详情，从 wire.jsonl 加载历史消息。
 * 使用异步版本 extractTitleAsync 和 extractMessagesStreaming。
 *
 * @param sessionId - 会话 ID
 * @returns 会话详情对象，会话不存在时返回 null
 */
export async function getSessionDetail(sessionId: string): Promise<any> {
  // 查找会话所属的项目
  const config = configService.getConfig();
  let projectPath = '';
  let projectId = '';

  for (const [pid, sids] of Object.entries(config.projectSessions || {})) {
    if ((sids as string[]).includes(sessionId)) {
      projectId = pid;
      const project = config.projects.find((p) => p.id === pid);
      if (project) {
        projectPath = project.path;
      }
      break;
    }
  }

  if (!projectPath) {
    return null;
  }

  const processInfo = sessionPool.getProcess(sessionId);

  // 从 wire.jsonl 提取标题、创建时间和消息（使用异步版本）
  const sessionDir = getSessionDir(projectPath, sessionId);
  const wirePath = path.join(sessionDir, 'wire.jsonl');
  let title = '新对话';
  let createdAt = 0;
  let messages: any[] = [];
  try {
    if (existsSync(wirePath)) {
      title = await extractTitleAsync(wirePath);
      createdAt = await extractFirstTimestamp(wirePath);
      messages = await extractMessagesStreaming(wirePath, sessionId);
    }
  } catch (err) {
    aiError(`[AI] Failed to load history for session ${sessionId}:`, err);
  }

  return {
    id: sessionId,
    projectId,
    projectPath,
    title,
    status: processInfo ? 'active' as const : 'idle' as const,
    createdAt,
    updatedAt: processInfo ? processInfo.lastActivity : createdAt,
    messages,
    isActive: !!processInfo,
  };
}

/**
 * 删除会话：停止进程并移除会话目录
 * @param sessionId - 会话 ID
 */
export async function deleteSession(sessionId: string): Promise<void> {
  // 如果进程正在运行则停止
  stopProcess(sessionId);

  // 查找项目信息
  const config = configService.getConfig();
  let projectPath = '';

  for (const [pid, sids] of Object.entries(config.projectSessions || {})) {
    if (sids.includes(sessionId)) {
      const project = config.projects.find((p) => p.id === pid);
      if (project) {
        projectPath = project.path;
      }
      // 从配置中移除会话
      if (!config.projectSessions) config.projectSessions = {};
      config.projectSessions[pid] = sids.filter((s) => s !== sessionId);
      if (config.projectSessions[pid].length === 0) {
        delete config.projectSessions[pid];
      }
      break;
    }
  }

  configService.saveConfig(config);

  // 删除会话目录
  if (projectPath) {
    const sessionDir = getSessionDir(projectPath, sessionId);
    try {
      if (existsSync(sessionDir)) {
        const fs = require('fs');
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    } catch (err) {
      aiError(`[AI] Error deleting session directory:`, err);
    }
  }
}

/**
 * 创建新会话：生成 ID、在后台启动进程、保存到配置。
 * 进程初始化延迟执行，sendPrompt() 会在需要时等待初始化完成。
 *
 * @param projectId - 项目 ID
 * @param projectPath - 项目路径
 * @returns 包含 sessionId 和 projectPath 的对象
 */
export async function createSession(
  projectId: string,
  projectPath: string
): Promise<{ sessionId: string; projectPath: string }> {
  const sessionId = uuidv4();

  // 在池中注册会话元数据
  sessionPool.registerSessionMeta(sessionId, projectId, projectPath);

  // 保存会话到配置
  const config = configService.getConfig();
  if (!config.projectSessions) {
    config.projectSessions = {};
  }
  if (!config.projectSessions[projectId]) {
    config.projectSessions[projectId] = [];
  }
  config.projectSessions[projectId].push(sessionId);
  configService.saveConfig(config);

  return { sessionId, projectPath };
}

