import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import WebSocket from 'ws';
import { AppError, ErrorCodes } from '../middleware/errorHandler.js';
import * as aiService from '../services/ai.js';
import * as configService from '../services/config.js';
import { aiDebug, aiError, aiInfo } from '../services/logger.js';
import { sessionPool, onPoolReady } from '../services/session-pool.js';
import type { ProcessInfo } from '../services/ai.js';

export const aiRouter = Router();

// ===== WebSocket 连接注册表（按 sessionId 管理） =====
const wsConnections: Map<string, WebSocket> = new Map();

/**
 * 注册 WebSocket 连接，以便后续回收通知时能找到对应客户端。
 */
function registerWsConnection(sessionId: string, ws: WebSocket): void {
  wsConnections.set(sessionId, ws);
}

/**
 * 注销 WebSocket 连接。
 */
function unregisterWsConnection(sessionId: string): void {
  wsConnections.delete(sessionId);
}

// ===== 会话池回收通知器 =====
// 当 SessionPoolManager 回收会话时，通过对应 WebSocket 连接通知客户端

// 记录被池主动回收的会话，用于 exitHandler 判断是否跳过 WS 关闭（透明重连）
const poolDeactivatedSessions = new Set<string>();

/**
 * 会话池回收通知回调，向客户端发送 session-deactivated 事件
 * @param sessionId - 被回收的会话 ID
 * @param reason - 回收原因：'idle_timeout'（空闲超时）或 'evicted'（被驱逐）
 */
const deactivateNotifier = (sessionId: string, reason: 'idle_timeout' | 'evicted'): void => {
  poolDeactivatedSessions.add(sessionId); // 同步标记，不依赖 WS 消息时序
  const ws = wsConnections.get(sessionId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    aiInfo(`[AI WS] 发送会话回收事件: sessionId=${sessionId}, reason=${reason}`);
    ws.send(JSON.stringify({ type: 'session-deactivated', sessionId, reason }));
  }
};

// 在 sessionPool 初始化后设置通知器回调（延迟执行，解决模块加载顺序问题）
onPoolReady((pool) => {
  pool.setDeactivateNotifier(deactivateNotifier);
});

// Wire 调试模式检测（Phase 3）
const wireDebug = process.argv.includes('--wire-debug') || process.env.WIRE_DEBUG === '1';

// ===== HTTP 接口 =====

/**
 * 检查 Kimi CLI 是否已安装（返回缓存结果），同时返回 wireDebug 标志
 * GET /api/ai/status
 * @param _req - Express 请求对象（未使用）
 * @param res - Express 响应对象
 */
aiRouter.get('/status', (_req: Request, res: Response) => {
  const status = aiService.checkInstalled();
  res.json({
    success: true,
    data: {
      ...status,
      wireDebug,
    },
  });
});

/**
 * 列出指定项目的所有 AI 会话
 * GET /api/ai/sessions?projectId=xxx
 * @param req - Express 请求对象，query 包含 projectId
 * @param res - Express 响应对象
 * @param next - Express next 中间件函数
 */
aiRouter.get('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = req.query.projectId as string;
    if (!projectId) {
      throw new AppError(400, ErrorCodes.INVALID_PATH, 'projectId query parameter is required');
    }

    const sessions = await aiService.listSessions(projectId);
    res.json({
      success: true,
      data: sessions,
    });
  } catch (err) {
    next(err);
  }
});

// ===== 会话池可观测性 API =====

/**
 * 获取会话池统计数据
 * GET /api/ai/pool/stats
 * @param _req - Express 请求对象（未使用）
 * @param res - Express 响应对象
 */
aiRouter.get('/pool/stats', (_req: Request, res: Response) => {
  const stats = sessionPool.getStats();
  res.json({ success: true, data: stats });
});

/**
 * 获取会话池中所有会话的详细信息
 * GET /api/ai/pool/sessions
 * @param _req - Express 请求对象（未使用）
 * @param res - Express 响应对象
 */
aiRouter.get('/pool/sessions', (_req: Request, res: Response) => {
  const sessions = sessionPool.getSessionList();
  res.json({ success: true, data: sessions });
});

/**
 * 创建新的 AI 会话
 * POST /api/ai/sessions
 * @param req - Express 请求对象，body 包含 projectId 和 projectPath
 * @param res - Express 响应对象
 * @param next - Express next 中间件函数
 */
aiRouter.post('/sessions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId, projectPath } = req.body as { projectId: string; projectPath: string };

    if (!projectId || !projectPath) {
      throw new AppError(400, ErrorCodes.INVALID_PATH, 'projectId and projectPath are required');
    }

    const { sessionId, projectPath: pp } = await aiService.createSession(projectId, projectPath);
    res.json({
      success: true,
      data: {
        id: sessionId,
        projectId,
        projectPath: pp,
        status: 'initializing',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 获取指定会话的详细信息
 * GET /api/ai/sessions/:id
 * @param req - Express 请求对象，params 包含会话 id
 * @param res - Express 响应对象
 * @param next - Express next 中间件函数
 */
aiRouter.get('/sessions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.params.id as string;
    const detail = await aiService.getSessionDetail(sessionId);

    if (!detail) {
      throw new AppError(404, ErrorCodes.PROJECT_NOT_FOUND, `Session not found: ${sessionId}`);
    }

    res.json({
      success: true,
      data: detail,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 删除指定 AI 会话
 * DELETE /api/ai/sessions/:id
 * @param req - Express 请求对象，params 包含会话 id
 * @param res - Express 响应对象
 * @param next - Express next 中间件函数
 */
aiRouter.delete('/sessions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.params.id as string;
    await aiService.deleteSession(sessionId);
    res.json({
      success: true,
      data: { id: sessionId },
    });
  } catch (err) {
    next(err);
  }
});

// ===== WebSocket Handler =====

/**
 * 处理 AI 会话的 WebSocket 连接
 * 从 SSE 升级为 WebSocket 以支持双向通信。
 *
 * 懒激活机制：WS 连接时不会启动进程，进程在收到第一条 'prompt' 消息时通过 ensureProcessActive() 激活。
 *
 * 客户端可发送的消息类型：
 *   - {type: 'prompt', content: string} - 发送消息
 *   - {type: 'approve', requestId: string, response: 'approve'|'reject', feedback?: string} - 响应审批请求
 *   - {type: 'answer', questionId: string, answer: string} - 回答 AI 提问
 *   - {type: 'cancel'} - 取消当前生成
 *
 * 服务端会发送的消息类型：
 *   - {type: 'connected', payload: {sessionId}} - 连接确认
 *   - {type: 'activating', payload: {sessionId}} - 进程激活开始
 *   - {type: 'activated', payload: {sessionId}} - 进程激活完成
 *   - Wire 事件: {type: 'TurnBegin'|'ContentPart'|'ToolCall'|..., payload: ...}
 *   - {type: 'request', id, payload} - 来自 AI 的审批/提问请求
 *   - {type: 'close', payload: {code, sessionId}} - 进程异常退出
 *   - {type: 'session-deactivated', sessionId, reason} - 会话池回收通知（透明重连）
 *   - {type: 'error', payload: {message}} - 错误通知
 *
 * @param ws - WebSocket 连接实例
 * @param sessionId - AI 会话 ID
 */
export async function handleAIWebSocket(ws: WebSocket, sessionId: string): Promise<void> {
  aiInfo(`[AI WS] WebSocket 已连接，会话 ${sessionId}`);

  // 注册 WebSocket 连接（用于回收通知）
  registerWsConnection(sessionId, ws);

  // 发送连接确认（懒激活，不启动进程）
  ws.send(JSON.stringify({ type: 'connected', payload: { sessionId } }));

  // 进程状态
  let currentProcessInfo: ProcessInfo | null = null;
  let pendingActivation: Promise<ProcessInfo> | null = null;

  // 事件处理器 - 将 kimi 事件转发到 WebSocket 客户端
  const eventHandler = (event: { type: string; payload: unknown }) => {
    aiDebug(`[AI WS] >>> 转发事件: type=${event.type}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  };

  const requestHandler = (request: { id: string; type: string; payload: unknown }) => {
    aiDebug(`[AI WS] >>> 转发请求: type=${request.type}, id=${request.id}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'request', id: request.id, payload: request.payload }));
    }
  };

  const exitHandler = (info: { code: number | null; sessionId: string }) => {
    aiDebug(`[AI WS] >>> 进程退出: code=${info.code}`);

    // Pool 主动回收 → 不关闭 WS（透明重连）
    if (poolDeactivatedSessions.has(info.sessionId)) {
      poolDeactivatedSessions.delete(info.sessionId);
      detachEventHandlers();
      return;
    }

    // 异常退出 → 关闭 WS（保持现有行为）
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'close',
        payload: { code: info.code, sessionId: info.sessionId, reason: 'process_exit' },
      }));
      ws.close();
    }
  };

  /**
   * 将事件处理器绑定到指定进程
   * @param processInfo - 进程信息对象
   */
  function attachEventHandlers(processInfo: ProcessInfo): void {
    processInfo.eventEmitter.on('wire-event', eventHandler);
    processInfo.eventEmitter.on('wire-request', requestHandler);
    processInfo.eventEmitter.on('process-exit', exitHandler);
  }

  /**
   * 从当前进程解绑所有事件处理器
   */
  function detachEventHandlers(): void {
    if (currentProcessInfo) {
      currentProcessInfo.eventEmitter.off('wire-event', eventHandler);
      currentProcessInfo.eventEmitter.off('wire-request', requestHandler);
      currentProcessInfo.eventEmitter.off('process-exit', exitHandler);
    }
  }

  /**
   * 确保进程处于活跃状态。如果进程不存在或已被回收，则重新激活。
   * 使用 pendingActivation Promise 缓存防止并发激活。
   * @returns 活跃的进程信息对象
   */
  async function ensureProcessActive(): Promise<ProcessInfo> {
    // 已有活跃进程 → 直接返回
    if (currentProcessInfo && sessionPool.has(sessionId)) {
      return currentProcessInfo;
    }

    // 已有进行中的激活 → 等待它完成
    if (pendingActivation) {
      return pendingActivation;
    }

    // 发起激活
    pendingActivation = (async () => {
      // 确保 session meta 已注册
      if (!sessionPool.getSessionMeta(sessionId)) {
        const detail = await aiService.getSessionDetail(sessionId);
        if (detail?.projectPath) {
          sessionPool.registerSessionMeta(sessionId, detail.projectId, detail.projectPath);
        }
      }

      ws.send(JSON.stringify({ type: 'activating', payload: { sessionId } }));
      const processInfo = await sessionPool.activate(sessionId);
      attachEventHandlers(processInfo);
      currentProcessInfo = processInfo;
      ws.send(JSON.stringify({ type: 'activated', payload: { sessionId } }));
      return processInfo;
    })();

    try {
      return await pendingActivation;
    } finally {
      pendingActivation = null;
    }
  }

  // 处理来自 WebSocket 客户端的消息
  ws.on('message', async (data: WebSocket.RawData) => {
    try {
      const msgStr = data.toString();
      const msg = JSON.parse(msgStr);
      aiDebug(`[AI WS] <<< 收到消息: type=${msg.type}`);

      switch (msg.type) {
        case 'prompt':
          // 确保进程处于活跃状态后发送提示消息
          try {
            await ensureProcessActive();
            await aiService.sendPrompt(sessionId, msg.content);
          } catch (err) {
            aiError(`[AI WS] 发送提示失败:`, err);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'error', payload: { message: '发送提示失败' } }));
            }
          }
          break;

        case 'approve':
          // 响应工具审批请求
          try {
            aiService.respondApproval(sessionId, msg.requestId, msg.response);
          } catch (err) {
            aiError(`[AI WS] 响应审批失败:`, err);
          }
          break;

        case 'answer':
          // 回答 AI 提问（Phase 3 预留功能）
          aiDebug(`[AI WS] 收到回答: questionId=${msg.questionId}, answer=${msg.answer}`);
          // TODO: 等待 kimi 支持通过 JSON-RPC 回答提问后实现
          break;

        case 'cancel':
          // 取消当前生成
          try {
            aiService.cancelGeneration(sessionId);
          } catch (err) {
            aiError(`[AI WS] 取消生成失败:`, err);
          }
          break;

        case 'ping':
          // 心跳响应
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
          break;

        default:
          aiDebug(`[AI WS] 未知消息类型: ${msg.type}`);
      }
    } catch (err) {
      aiError('[AI WS] 消息解析错误:', err);
    }
  });

  // 处理 WebSocket 关闭
  ws.on('close', () => {
    aiInfo(`[AI WS] WebSocket 已关闭，会话 ${sessionId}`);
    unregisterWsConnection(sessionId);
    detachEventHandlers();
  });

  // 处理 WebSocket 错误
  ws.on('error', (err) => {
    aiError(`[AI WS] WebSocket 错误:`, err);
  });
}