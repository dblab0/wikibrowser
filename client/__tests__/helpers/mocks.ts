/**
 * 客户端测试 Mock 工具集（Vitest 版本）
 * 提供 fetch、WebSocket、AI 消息、定时器等常用 mock 工厂函数
 */
import { vi } from 'vitest';

// ===== Fetch Mock =====

/**
 * Mock 全局 fetch 函数
 * @param response - 模拟的响应体数据
 * @param options - 可选配置，包含 status（HTTP 状态码）和 ok（是否成功）
 */
export function mockFetch(response: unknown, options?: { status?: number; ok?: boolean }) {
  const status = options?.status ?? 200;
  const ok = options?.ok ?? (status >= 200 && status < 300);

  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => response,
    text: async () => (typeof response === 'string' ? response : JSON.stringify(response)),
  });
}

/**
 * Mock fetch 返回成功的 API 响应
 * @param data - 响应数据
 * @returns mock fetch 的返回值
 */
export function mockFetchSuccess<T>(data: T) {
  return mockFetch({ success: true, data });
}

/**
 * Mock fetch 返回错误的 API 响应
 * @param message - 错误消息
 * @param code - 错误码，默认 'ERROR'
 * @param status - HTTP 状态码，默认 400
 * @returns mock fetch 的返回值
 */
export function mockFetchError(message: string, code: string = 'ERROR', status: number = 400) {
  return mockFetch(
    { success: false, error: { code, message } },
    { status, ok: false }
  );
}

/**
 * Mock fetch 抛出网络错误
 * 模拟请求失败（如断网）场景
 */
export function mockFetchNetworkError() {
  global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
}

/**
 * Mock fetch 返回 404 响应
 * 模拟资源不存在场景
 */
export function mockFetchNotFound() {
  return mockFetch(
    { success: false, error: { code: 'NOT_FOUND', message: 'Resource not found' } },
    { status: 404, ok: false }
  );
}

/**
 * Mock fetch 返回 500 服务器错误响应
 * @param message - 错误消息，默认 'Internal Server Error'
 * @returns mock fetch 的返回值
 */
export function mockFetchServerError(message: string = 'Internal Server Error') {
  return mockFetch(
    { success: false, error: { code: 'INTERNAL_ERROR', message } },
    { status: 500, ok: false }
  );
}

// ===== WebSocket Mock =====

/** Mock WebSocket 消息结构 */
export interface MockWsMessage {
  type: string;
  payload?: unknown;
  id?: string;
}

/** Mock WebSocket 实例接口 */
export interface MockWebSocketInstance {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  sentMessages: string[];
  url: string;
}

/**
 * Mock WebSocket 实现类
 * 模拟浏览器 WebSocket 的完整生命周期，支持手动触发 open、message、error、close 事件
 */
class MockWebSocketImpl {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockWebSocketImpl.CONNECTING; // 初始为 CONNECTING 状态
  url: string;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  sentMessages: string[] = [];
  isClosed: boolean = false;

  constructor(url: string) {
    this.url = url;
    this.send = vi.fn((data: string) => {
      if (this.readyState !== MockWebSocketImpl.OPEN) {
        throw new Error('WebSocket is not open');
      }
      this.sentMessages.push(data);
    });
    this.close = vi.fn((code: number = 1000, reason?: string) => {
      if (this.isClosed) return;
      this.isClosed = true;
      this.readyState = MockWebSocketImpl.CLOSED;
      if (this.onclose) {
        this.onclose({ code, reason, wasClean: true } as CloseEvent);
      }
    });
  }

  simulateOpen(): void {
    this.readyState = MockWebSocketImpl.OPEN;
    if (this.onopen) {
      this.onopen({ type: 'open' } as Event);
    }
  }

  simulateMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage({
        data: JSON.stringify(data),
      } as MessageEvent);
    }
  }

  simulateError(): void {
    if (this.onerror) {
      this.onerror({ type: 'error' } as Event);
    }
  }

  simulateClose(code: number = 1000, reason?: string): void {
    this.readyState = MockWebSocketImpl.CLOSED;
    if (this.onclose) {
      this.onclose({ code, reason, wasClean: true } as CloseEvent);
    }
  }
}

// 跟踪所有 WebSocket 实例
const wsInstances: MockWebSocketImpl[] = [];

class MockWebSocketWithTracking extends MockWebSocketImpl {
  constructor(url: string) {
    super(url);
    wsInstances.push(this);
  }
}

/**
 * 创建 mock WebSocket 并替换全局 WebSocket
 * @returns 包含 getLastInstance、clearInstances、simulateMessages 的控制对象
 */
export function mockWebSocket(): {
  getLastInstance: () => MockWebSocketInstance | null;
  clearInstances: () => void;
  simulateMessages: (messages: MockWsMessage[], delay?: number) => void;
} {
  vi.stubGlobal('WebSocket', MockWebSocketWithTracking);

  return {
    getLastInstance: () => wsInstances[wsInstances.length - 1] || null,
    clearInstances: () => {
      wsInstances.length = 0;
    },
    simulateMessages: (messages: MockWsMessage[], delay: number = 10) => {
      const instance = wsInstances[wsInstances.length - 1];
      if (!instance) return;

      // 先模拟连接打开
      setTimeout(() => {
        instance.simulateOpen();
        // 依次发送消息
        messages.forEach((msg, i) => {
          setTimeout(() => {
            instance.simulateMessage(msg);
          }, (i + 1) * delay);
        });
      }, 0);
    },
  };
}

/**
 * 恢复全局 WebSocket 为原始实现
 * 同时清空已跟踪的 mock 实例
 */
export function restoreWebSocket(): void {
  wsInstances.length = 0;
  vi.unstubAllGlobals();
}

// ===== AI Wire 协议 Mock =====

/** AI wire 协议事件消息结构 */
export interface WireEventMessage {
  timestamp: number;
  message: {
    type: string;
    payload: unknown;
  };
}

/**
 * 创建 AI wire 协议事件
 * @param type - 事件类型，如 TurnBegin、ContentPart 等
 * @param payload - 事件载荷，默认为空对象
 * @returns 符合 WireEventMessage 格式的事件对象
 */
export function createAiEvent(type: string, payload: unknown = {}): WireEventMessage {
  return {
    timestamp: Date.now() / 1000,
    message: { type, payload },
  };
}

/**
 * 常用 wire 事件工厂集合
 * 提供各类型 AI wire 协议事件的快捷创建方法
 */
export const wireEvents = {
  turnBegin: (userInput: string) =>
    createAiEvent('TurnBegin', { user_input: userInput }),

  contentPartText: (text: string) =>
    createAiEvent('ContentPart', { type: 'text', text }),

  contentPartThink: (think: string) =>
    createAiEvent('ContentPart', { type: 'think', think }),

  toolCall: (id: string, functionName: string, args: string) =>
    createAiEvent('ToolCall', {
      id,
      function: { name: functionName, arguments: args },
    }),

  toolCallPart: (toolCallId: string, argumentsPart: string) =>
    createAiEvent('ToolCallPart', {
      tool_call_id: toolCallId,
      arguments_part: argumentsPart,
    }),

  toolResult: (toolCallId: string, output: string, isError: boolean = false) =>
    createAiEvent('ToolResult', {
      tool_call_id: toolCallId,
      return_value: { output, is_error: isError },
    }),

  approvalRequest: (id: string, toolCallId: string, action: string, description: string) =>
    createAiEvent('ApprovalRequest', {
      id,
      tool_call_id: toolCallId,
      action,
      description,
      display: [],
    }),

  subagentEvent: (
    parentToolCallId: string,
    agentId: string,
    subagentType: string,
    innerEvent: WireEventMessage
  ) =>
    createAiEvent('SubagentEvent', {
      parent_tool_call_id: parentToolCallId,
      agent_id: agentId,
      subagent_type: subagentType,
      event: innerEvent.message,
    }),

  turnEnd: () => createAiEvent('TurnEnd'),

  stepBegin: () => createAiEvent('StepBegin'),

  statusUpdate: (
    tokenUsage?: { inputOther: number; output: number; inputCacheRead: number; inputCacheCreation: number },
    contextUsage?: number
  ) =>
    createAiEvent('StatusUpdate', {
      token_usage: tokenUsage,
      context_usage: contextUsage,
    }),

  sessionStatus: (sessionId: string, state: 'idle' | 'busy' | 'error' | 'stopped', reason?: string) =>
    createAiEvent('SessionStatus', {
      session_id: sessionId,
      state,
      reason,
    }),

  questionRequest: (id: string, questions: { id: string; text: string; options?: string[] }[]) =>
    createAiEvent('QuestionRequest', {
      id,
      questions,
    }),
};

/**
 * 创建一组连续的 AI wire 事件，用于模拟常见的 AI 响应模式
 * @param options - 配置项，包含用户输入、文本片段、思考内容、工具调用/结果等
 * @returns 按顺序排列的 WireEventMessage 数组
 */
export function createAiResponseSequence(options: {
  userInput?: string;
  textParts?: string[];
  thinkContent?: string;
  toolCalls?: { id: string; name: string; args: string }[];
  toolResults?: { toolCallId: string; output: string; isError?: boolean }[];
  includeTurnBegin?: boolean;
  includeTurnEnd?: boolean;
}): WireEventMessage[] {
  const events: WireEventMessage[] = [];

  if (options.includeTurnBegin !== false && options.userInput) {
    events.push(wireEvents.turnBegin(options.userInput));
  }

  if (options.thinkContent) {
    events.push(wireEvents.contentPartThink(options.thinkContent));
  }

  if (options.textParts) {
    for (const text of options.textParts) {
      events.push(wireEvents.contentPartText(text));
    }
  }

  if (options.toolCalls) {
    for (const tc of options.toolCalls) {
      events.push(wireEvents.toolCall(tc.id, tc.name, tc.args));
    }
  }

  if (options.toolResults) {
    for (const tr of options.toolResults) {
      events.push(wireEvents.toolResult(tr.toolCallId, tr.output, tr.isError));
    }
  }

  if (options.includeTurnEnd !== false) {
    events.push(wireEvents.turnEnd());
  }

  return events;
}

/**
 * 清除所有 mock 和已跟踪的 WebSocket 实例
 */
export function clearAllMocks() {
  vi.clearAllMocks();
  wsInstances.length = 0;
}

/**
 * Mock 定时器工具，用于缓存 TTL 等时间相关测试
 * @returns advanceTime（推进时间）和 restore（恢复真实定时器）方法
 */
export function mockTimers(): {
  advanceTime: (ms: number) => void;
  restore: () => void;
} {
  vi.useFakeTimers();

  return {
    advanceTime: (ms: number) => {
      vi.advanceTimersByTime(ms);
    },
    restore: () => {
      vi.useRealTimers();
    },
  };
}

/**
 * 创建模拟的 AI 消息对象
 * @param type - 消息类型
 * @param content - 消息内容
 * @param options - 可选配置，包含 id、sessionId、role、timestamp
 * @returns 符合 AI 消息结构的 mock 对象
 */
export function createMockAIMessage(
  type: 'text' | 'think' | 'tool_call' | 'tool_result' | 'approval' | 'question' | 'subagent',
  content: unknown,
  options?: { id?: string; sessionId?: string; role?: 'user' | 'assistant'; timestamp?: number }
) {
  return {
    id: options?.id ?? `ai-${type}-${Date.now()}`,
    sessionId: options?.sessionId ?? 'test-session',
    role: options?.role ?? 'assistant',
    type,
    content,
    timestamp: options?.timestamp ?? Date.now(),
  };
}

/**
 * 创建模拟的 AI 会话对象
 * @param overrides - 可选的属性覆盖，包含 id、projectId、projectPath、title、status、createdAt、updatedAt
 * @returns 符合 AI 会话结构的 mock 对象
 */
export function createMockAISession(overrides?: Partial<{
  id: string;
  projectId: string;
  projectPath: string;
  title: string;
  status: 'active' | 'idle' | 'error';
  createdAt: number;
  updatedAt: number;
}>) {
  return {
    id: overrides?.id ?? 'test-session-id',
    projectId: overrides?.projectId ?? 'test-project-id',
    projectPath: overrides?.projectPath ?? '/test/path',
    title: overrides?.title ?? 'Test Session',
    status: overrides?.status ?? 'active',
    createdAt: overrides?.createdAt ?? Date.now(),
    updatedAt: overrides?.updatedAt ?? Date.now(),
  };
}