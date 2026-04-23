import type { WSSendMessage } from '@shared/types';

/** WebSocket 接收消息类型 */
export interface WSReceiveMessage {
  type: string;  // 消息类型
  id?: string;  // 消息 ID（可选）
  payload?: unknown;  // 消息负载（可选）
}

/** WebSocket 回调接口 */
export interface WSCallbacks {
  onEvent: (event: { type: string; payload: unknown }) => void;  // 接收 Wire 事件
  onRequest: (request: { id: string; payload: unknown }) => void;  // 接收审批请求
  onError: (error: { message: string }) => void;  // 错误回调
  onClose: (info?: { code: number | null; sessionId?: string }) => void;  // 连接关闭回调
  onConnect?: () => void;  // 连接建立回调（可选）
}

/**
 * AI WebSocket 客户端
 * 替代原有的 SSE 连接，提供双向通信能力。
 */
class AIWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnect = 5;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentSessionId: string | null = null;
  private currentCallbacks: WSCallbacks | null = null;
  private intentionallyClosed = false;

  /** 连接代数：每次 disconnect/connect 递增，旧连接的回调检查代数自动失效 */
  private connectionGeneration = 0;

  // 心跳机制
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private missedPongs = 0;
  private lastPongTime = 0;
  private static readonly HEARTBEAT_INTERVAL = 30000; // 30 秒发送一次 ping
  private static readonly MAX_MISSED_PONGS = 2; // 连续 2 次无 pong（60 秒）认为断开

  /**
   * 建立 WebSocket 连接
   * @param sessionId - 会话 ID
   * @param callbacks - WebSocket 事件回调集合
   */
  connect(sessionId: string, callbacks: WSCallbacks): void {
    console.log(`[AI WS] Connecting to session ${sessionId}`);
    // 清理已有连接
    this.disconnect();

    this.currentSessionId = sessionId;
    this.currentCallbacks = callbacks;
    this.reconnectAttempts = 0;
    this.intentionallyClosed = false;

    this.createConnection(sessionId, callbacks);
  }

  /**
   * 创建 WebSocket 连接并绑定事件监听
   * @param sessionId - 会话 ID
   * @param callbacks - WebSocket 事件回调集合
   */
  private createConnection(sessionId: string, callbacks: WSCallbacks): void {
    // 构建 WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/api/ai/sessions/${sessionId}/ws`;

    // 递增代数，捕获当前代数用于回调中检查是否过期
    const generation = ++this.connectionGeneration;

    console.log(`[AI WS] Creating WebSocket: ${url} (generation=${generation})`);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      // 代数不匹配说明这是旧连接的回调，忽略
      if (generation !== this.connectionGeneration) {
        console.log(`[AI WS] Stale onopen ignored (gen ${generation} vs current ${this.connectionGeneration})`);
        return;
      }
      console.log(`[AI WS] Connection opened`);
      this.startHeartbeat();
      callbacks.onConnect?.();
    };

    this.ws.onmessage = (event) => {
      if (generation !== this.connectionGeneration) return;
      try {
        const msg: WSReceiveMessage = JSON.parse(event.data);
        this.handleMessage(msg, callbacks);
      } catch (err) {
        console.error('[AI WS] Message parse error:', err);
      }
    };

    this.ws.onclose = (event) => {
      // 代数不匹配说明这是旧连接的回调（已被 disconnect/connect 取代），忽略
      if (generation !== this.connectionGeneration) {
        console.log(`[AI WS] Stale onclose ignored (gen ${generation} vs current ${this.connectionGeneration})`);
        return;
      }
      console.log(`[AI WS] Connection closed: code=${event.code}, reason=${event.reason}`);
      // 如果不是主动关闭，尝试重连
      if (!this.intentionallyClosed) {
        this.handleReconnect();
      } else {
        callbacks.onClose();
      }
    };

    this.ws.onerror = (err) => {
      if (generation !== this.connectionGeneration) return;
      console.error('[AI WS] Connection error:', err);
      callbacks.onError({ message: 'WebSocket connection error' });
    };
  }

  /**
   * 处理接收到的 WebSocket 消息，按类型分发到对应回调
   * @param msg - 接收到的消息对象
   * @param callbacks - WebSocket 事件回调集合
   */
  private handleMessage(msg: WSReceiveMessage, callbacks: WSCallbacks): void {
    console.log(`[AI WS] Received message: type=${msg.type}`);

    switch (msg.type) {
      case 'connected':
        // 连接确认
        console.log(`[AI WS] Connection confirmed for session ${(msg.payload as any)?.sessionId}`);
        break;

      case 'request':
        // 审批/问题请求
        callbacks.onRequest({
          id: msg.id || '',
          payload: msg.payload || {},
        });
        break;

      case 'close':
        // 服务端明确关闭（进程退出等），不应重连
        console.log(`[AI WS] Server sent close message, marking as intentionally closed`);
        this.intentionallyClosed = true;
        this.stopHeartbeat();
        callbacks.onClose(msg.payload as { code: number | null; sessionId?: string });
        break;

      case 'error':
        // 错误通知
        callbacks.onError({
          message: (msg.payload as any)?.message || 'Unknown error',
        });
        break;

      case 'pong':
        // 心跳响应
        this.missedPongs = 0;
        this.lastPongTime = Date.now();
        break;

      case 'session-deactivated':
        // 会话池回收通知：空闲超时回收或 LRU 驱逐
        console.log(`[AI WS] Session deactivated: sessionId=${(msg.payload as any)?.sessionId}, reason=${(msg.payload as any)?.reason}`);
        callbacks.onEvent({
          type: 'session-deactivated',
          payload: msg.payload || {},
        });
        break;

      case 'activating':
        // 会话正在激活/重新激活
        console.log(`[AI WS] Session activating: sessionId=${(msg.payload as any)?.sessionId}`);
        callbacks.onEvent({
          type: 'activating',
          payload: msg.payload || {},
        });
        break;

      case 'activated':
        // 会话已激活就绪
        console.log(`[AI WS] Session activated: sessionId=${(msg.payload as any)?.sessionId}`);
        callbacks.onEvent({
          type: 'activated',
          payload: msg.payload || {},
        });
        break;

      default:
        // Wire 事件（TurnBegin、ContentPart、ToolCall 等）
        callbacks.onEvent({
          type: msg.type,
          payload: msg.payload || {},
        });
    }
  }

  /**
   * 启动心跳机制，定时发送 ping 检测连接活性
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedPongs = 0;
    this.lastPongTime = Date.now();

    this.heartbeatInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat();
        return;
      }

      this.missedPongs++;
      if (this.missedPongs > AIWebSocket.MAX_MISSED_PONGS) {
        console.warn(`[AI WS] No pong received for ${this.missedPongs * AIWebSocket.HEARTBEAT_INTERVAL / 1000}s, closing connection`);
        this.stopHeartbeat();
        // 强制关闭，触发 onclose -> handleReconnect
        this.ws.close();
        return;
      }

      // 发送 ping
      this.ws.send(JSON.stringify({ type: 'ping' }));
    }, AIWebSocket.HEARTBEAT_INTERVAL);
  }

  /**
   * 停止心跳机制，清除定时器
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * 处理 WebSocket 重连逻辑（指数退避策略）
   */
  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnect) {
      console.log(`[AI WS] Max reconnect attempts reached`);
      this.currentCallbacks?.onError({
        message: '连接已断开，请刷新页面重试',
      });
      this.disconnect();
      return;
    }

    this.reconnectAttempts++;

    // 指数退避：1s, 2s, 4s, 8s, 16s
    const delay = Math.pow(2, this.reconnectAttempts - 1) * 1000;
    console.log(`[AI WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      if (this.currentSessionId && this.currentCallbacks && !this.intentionallyClosed) {
        // 清理旧的 WebSocket
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }
        this.createConnection(this.currentSessionId, this.currentCallbacks);
      }
    }, delay);
  }

  /**
   * 发送用户消息
   * @param content - 用户消息内容
   */
  sendPrompt(content: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[AI WS] Cannot send prompt: WebSocket not connected');
      return;
    }
    const msg: WSSendMessage = { type: 'prompt', content };
    this.ws.send(JSON.stringify(msg));
    console.log(`[AI WS] Sent prompt: "${content.substring(0, 50)}..."`);
  }

  /**
   * 发送审批响应
   * @param requestId - 审批请求 ID
   * @param response - 审批结果（approve 或 reject）
   * @param feedback - 附加反馈信息（可选）
   */
  sendApproval(requestId: string, response: 'approve' | 'reject', feedback?: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[AI WS] Cannot send approval: WebSocket not connected');
      return;
    }
    const msg: WSSendMessage = { type: 'approve', requestId, response, feedback };
    this.ws.send(JSON.stringify(msg));
    console.log(`[AI WS] Sent approval: requestId=${requestId}, response=${response}`);
  }

  /**
   * 发送问题回答（Phase 3 功能）
   * @param questionId - 问题 ID
   * @param answer - 回答内容
   */
  sendAnswer(questionId: string, answer: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[AI WS] Cannot send answer: WebSocket not connected');
      return;
    }
    const msg: WSSendMessage = { type: 'answer', questionId, answer };
    this.ws.send(JSON.stringify(msg));
    console.log(`[AI WS] Sent answer: questionId=${questionId}`);
  }

  /**
   * 发送取消请求
   */
  sendCancel(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[AI WS] Cannot send cancel: WebSocket not connected');
      return;
    }
    const msg: WSSendMessage = { type: 'cancel' };
    this.ws.send(JSON.stringify(msg));
    console.log(`[AI WS] Sent cancel`);
  }

  /**
   * 断开连接（阻止重连）
   */
  disconnect(): void {
    this.intentionallyClosed = true;
    // 递增代数，使所有旧连接的 onopen/onclose/onmessage 回调自动失效
    this.connectionGeneration++;
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      // 先清除事件处理器，防止 close 触发旧回调
      this.ws.onclose = null;
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    this.currentSessionId = null;
    this.currentCallbacks = null;
    this.reconnectAttempts = 0;
  }

  /**
   * 检查是否已连接
   * @returns 是否处于连接状态
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

export const aiWs = new AIWebSocket();