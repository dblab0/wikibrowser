import { create } from 'zustand';
import type { AIStatus, AISession, AIMessage, AIStatusInfo, AISubagentContent, SubagentEvent, FileReference } from '@shared/types';
import { aiApi } from '../services/ai-api';
import { aiWs } from '../services/ai-ws';

/**
 * 会话池统计信息接口
 * 用于展示 AI 会话池的当前状态
 */
export interface PoolStats {
  activeCount: number;
  maxSessions: number;
  inactiveCount: number;
  queueLength: number;
}

/**
 * AI 状态数据接口
 * 包含 UI 状态、会话管理、消息流、子代理、文件引用等
 */
interface AIState {
  // UI 状态
  aiPanelOpen: boolean;
  aiPanelWidth: number;
  aiStatus: AIStatus | null;
  showInstallPrompt: boolean;

  // 会话管理
  aiSessions: AISession[];
  activeSessionId: string | null;

  // 消息
  aiMessages: AIMessage[];
  aiStreaming: boolean;
  aiConnected: boolean;

  // Phase 2: 新增状态字段
  statusInfo: AIStatusInfo;
  sessionStatus: 'idle' | 'connecting' | 'active' | 'busy' | 'error' | 'stopped' | 'expired';

  // 会话池状态
  poolStats: PoolStats | null;

  // 文件引用（AI 上下文）
  pendingReferences: FileReference[];

  // 错误
  aiError: string | null;
}

/**
 * AI 状态操作接口
 * 包含 UI 控制、会话管理、消息操作、子代理、文件引用等操作方法
 */
interface AIActions {
  // UI 操作
  toggleAIPanel: () => void;
  setAIPanelOpen: (open: boolean) => void;
  setAIPanelWidth: (width: number) => void;
  setAIStatus: (status: AIStatus) => void;
  setShowInstallPrompt: (show: boolean) => void;

  // 会话操作
  setAISessions: (sessions: AISession[]) => void;
  setActiveSession: (id: string | null) => void;
  updateSessionTitle: (sessionId: string, title: string) => void;

  // 消息操作
  setAIMessages: (messages: AIMessage[]) => void;
  addMessage: (message: AIMessage) => void;
  updateMessage: (id: string, updates: Partial<AIMessage>) => void;
  appendToMessage: (id: string, field: string, content: string) => void;
  setStreaming: (streaming: boolean) => void;
  setConnected: (connected: boolean) => void;

  // Phase 2: 新增操作
  setStatusInfo: (info: AIStatusInfo) => void;
  setSessionStatus: (status: 'idle' | 'connecting' | 'active' | 'busy' | 'error' | 'stopped' | 'expired') => void;
  appendToToolCallArgs: (toolCallId: string, argsPart: string) => void;

  // 子代理操作
  addSubagentEvent: (parentToolCallId: string, agentId: string, subagentType: string, event: SubagentEvent) => void;
  updateSubagentStatus: (parentToolCallId: string, agentId: string, status: 'running' | 'completed' | 'error') => void;

  // 会话池操作
  fetchPoolStats: () => Promise<void>;
  handleSessionDeactivated: (sessionId: string, reason: string) => void;

  // 文件引用操作
  addReference: (reference: FileReference) => void;
  removeReference: (id: string) => void;
  clearReferences: () => void;

  // 错误操作
  setAIError: (error: string | null) => void;

  // 重置
  clearMessages: () => void;
  resetAI: () => void;

  // 项目切换
  switchProject: (newProjectId: string) => void;
}

/** AI 状态初始值 */
const initialState: AIState = {
  aiPanelOpen: false,
  aiPanelWidth: 400,
  aiStatus: null,
  showInstallPrompt: false,
  aiSessions: [],
  activeSessionId: null,
  aiMessages: [],
  aiStreaming: false,
  aiConnected: false,
  // Phase 2: 新增状态初始值
  statusInfo: {},
  sessionStatus: 'idle',
  poolStats: null,
  pendingReferences: [],
  aiError: null,
};

/**
 * AI 功能状态管理 Store
 * 管理 AI 对话面板、会话池、消息流、子代理、文件引用等状态
 */
export const useAIStore = create<AIState & AIActions>((set) => ({
  ...initialState,

  /** 切换 AI 面板展开/折叠 */
  toggleAIPanel: () => set((state) => ({ aiPanelOpen: !state.aiPanelOpen })),
  /**
   * 设置 AI 面板展开状态
   * @param open - 是否展开
   */
  setAIPanelOpen: (open) => set({ aiPanelOpen: open }),
  /**
   * 设置 AI 面板宽度
   * @param width - 面板宽度（像素）
   */
  setAIPanelWidth: (width) => set({ aiPanelWidth: width }),
  /**
   * 设置 AI 状态信息
   * @param status - AI 状态对象
   */
  setAIStatus: (status) => set({ aiStatus: status }),
  /**
   * 设置是否显示安装提示
   * @param show - 是否显示
   */
  setShowInstallPrompt: (show) => set({ showInstallPrompt: show }),

  /** 会话操作 */

  /**
   * 设置 AI 会话列表
   * @param sessions - 会话数组
   */
  setAISessions: (sessions) => set({ aiSessions: sessions }),
  /**
   * 设置当前活跃会话 ID
   * @param id - 会话 ID，传 null 表示无活跃会话
   */
  setActiveSession: (id) => set({ activeSessionId: id }),
  /**
   * 更新指定会话的标题
   * @param sessionId - 目标会话 ID
   * @param title - 新标题
   */
  updateSessionTitle: (sessionId, title) =>
    set((state) => ({
      aiSessions: state.aiSessions.map((s) =>
        s.id === sessionId ? { ...s, title } : s,
      ),
    })),

  /** 消息操作 */

  /**
   * 设置完整的消息列表
   * @param messages - 消息数组
   */
  setAIMessages: (messages) => set({ aiMessages: messages }),
  /**
   * 追加一条消息
   * @param message - 新消息
   */
  addMessage: (message) =>
    set((state) => ({ aiMessages: [...state.aiMessages, message] })),
  /**
   * 更新指定消息的部分字段
   * @param id - 消息 ID
   * @param updates - 需要更新的字段
   */
  updateMessage: (id, updates) =>
    set((state) => ({
      aiMessages: state.aiMessages.map((msg) =>
        msg.id === id ? { ...msg, ...updates } : msg,
      ),
    })),
  /**
   * 向指定消息的指定字段追加内容（流式拼接）
   * @param id - 消息 ID
   * @param field - 要追加的字段名
   * @param content - 追加的内容
   */
  appendToMessage: (id, field, content) =>
    set((state) => ({
      aiMessages: state.aiMessages.map((msg): AIMessage => {
        if (msg.id !== id) return msg;
        const existingContent = msg.content as unknown as Record<string, string>;
        const currentValue = existingContent[field] || '';
        return {
          ...msg,
          content: { ...existingContent, [field]: currentValue + content } as unknown as AIMessage['content'],
        };
      }),
    })),
  /**
   * 设置流式输出状态
   * @param streaming - 是否正在流式输出
   */
  setStreaming: (streaming) => set({ aiStreaming: streaming }),
  /**
   * 设置 WebSocket 连接状态
   * @param connected - 是否已连接
   */
  setConnected: (connected) => set({ aiConnected: connected }),

  /** Phase 2: 新增操作 */

  /**
   * 设置状态信息（合并更新）
   * @param info - 状态信息片段
   */
  setStatusInfo: (info) => set((state) => ({ statusInfo: { ...state.statusInfo, ...info } })),
  /**
   * 设置会话连接状态
   * @param status - 会话状态
   */
  setSessionStatus: (status) => set({ sessionStatus: status }),
  /**
   * 向工具调用的 arguments 字段追加内容（流式拼接）
   * @param toolCallId - 工具调用 ID
   * @param argsPart - 追加的参数片段
   */
  appendToToolCallArgs: (toolCallId, argsPart) =>
    set((state) => ({
      aiMessages: state.aiMessages.map((msg): AIMessage => {
        if (msg.type !== 'tool_call') return msg;
        const content = msg.content as { toolCallId: string; arguments: string };
        if (content.toolCallId !== toolCallId) return msg;
        return {
          ...msg,
          content: {
            ...content,
            arguments: content.arguments + argsPart,
          } as unknown as AIMessage['content'],
        };
      }),
    })),

  /**
   * 设置 AI 错误信息
   * @param error - 错误信息，传 null 清除错误
   */
  setAIError: (error) => set({ aiError: error }),

  /** 子代理操作 */

  /**
   * 添加子代理事件
   * 如果已有该 parentToolCallId + agentId 对应的子代理消息，则追加事件；否则创建新的子代理消息
   * @param parentToolCallId - 父工具调用 ID
   * @param agentId - 子代理 ID
   * @param subagentType - 子代理类型
   * @param event - 子代理事件
   */
  addSubagentEvent: (parentToolCallId, agentId, subagentType, event) =>
    set((state) => {
      const messages = state.aiMessages;
      // 查找已存在的对应子代理消息
      const existingIdx = messages.findIndex(
        (msg) =>
          msg.type === 'subagent' &&
          (msg.content as { parentToolCallId: string; agentId: string }).parentToolCallId === parentToolCallId &&
          (msg.content as { parentToolCallId: string; agentId: string }).agentId === agentId
      );

      if (existingIdx >= 0) {
        // 向已有的子代理消息追加事件
        return {
          aiMessages: messages.map((msg, i) => {
            if (i !== existingIdx) return msg;
            const content = msg.content as AISubagentContent;
            return {
              ...msg,
              content: {
                ...content,
                events: [...content.events, event],
              } as AISubagentContent,
            };
          }),
        };
      } else {
        // 创建新的子代理消息
        const newMsg: AIMessage = {
          id: `ai-subagent-${Date.now()}`,
          sessionId: state.activeSessionId!,
          role: 'assistant',
          type: 'subagent',
          content: {
            parentToolCallId,
            agentId,
            subagentType,
            events: [event],
            status: 'running',
          } as AISubagentContent,
          timestamp: Date.now(),
        };
        return { aiMessages: [...messages, newMsg] };
      }
    }),

  /**
   * 更新子代理的运行状态
   * @param parentToolCallId - 父工具调用 ID
   * @param agentId - 子代理 ID
   * @param status - 新状态
   */
  updateSubagentStatus: (parentToolCallId, agentId, status) =>
    set((state) => ({
      aiMessages: state.aiMessages.map((msg) => {
        if (msg.type !== 'subagent') return msg;
        const content = msg.content as AISubagentContent;
        if (content.parentToolCallId !== parentToolCallId || content.agentId !== agentId) return msg;
        return { ...msg, content: { ...content, status } as AISubagentContent };
      }),
    })),

  /** 会话池操作 */

  /**
   * 从服务端获取会话池统计信息
   */
  fetchPoolStats: async () => {
    try {
      const stats = await aiApi.getPoolStats();
      set({ poolStats: stats });
    } catch (err) {
      console.error('[AI Store] 获取会话池统计信息失败:', err);
    }
  },

  /**
   * 处理会话被服务端回收/停用的事件
   * @param sessionId - 被停用的会话 ID
   * @param reason - 停用原因
   */
  handleSessionDeactivated: (sessionId, reason) => {
    console.log(`[AI Store] 会话已停用: ${sessionId}, 原因: ${reason}`);
    // 更新本地会话列表中对应会话的状态为 idle
    set((state) => ({
      aiSessions: state.aiSessions.map((s) =>
        s.id === sessionId ? { ...s, status: 'idle' as const, updatedAt: Date.now() } : s,
      ),
    }));
    // 如果被回收的是当前活跃会话，设置 expired 状态（不断开 WebSocket）
    const { activeSessionId, sessionStatus } = useAIStore.getState();
    if (activeSessionId === sessionId && sessionStatus !== 'stopped') {
      set({ sessionStatus: 'expired', aiStreaming: false });
    }
    // 刷新会话池状态
    useAIStore.getState().fetchPoolStats();
  },

  /** 文件引用操作 */

  /**
   * 添加文件引用到 AI 上下文，并自动打开 AI 面板
   * @param reference - 文件引用对象
   */
  addReference: (reference) =>
    set((state) => {
      return {
        pendingReferences: [...state.pendingReferences, reference],
        aiPanelOpen: true,
      };
    }),

  /**
   * 移除指定的文件引用
   * @param id - 引用 ID
   */
  removeReference: (id) =>
    set((state) => ({
      pendingReferences: state.pendingReferences.filter((ref) => ref.id !== id),
    })),

  /** 清空所有文件引用 */
  clearReferences: () => set({ pendingReferences: [] }),

  /** 清空消息列表并停止流式输出 */
  clearMessages: () => set({ aiMessages: [], aiStreaming: false }),

  /**
   * 切换项目时重置 AI 状态
   * 如果正在流式输出则中断 WebSocket 连接
   * @param _newProjectId - 新项目 ID（当前未使用）
   */
  switchProject: (_newProjectId) => {
    const state = useAIStore.getState();
    // 如果正在流式输出，中断连接
    if (state.aiStreaming) {
      try { aiWs.disconnect(); } catch { /* 忽略断连错误 */ }
    }
    set({
      activeSessionId: null,
      aiMessages: [],
      aiStreaming: false,
      sessionStatus: 'idle',
      aiError: null,
      statusInfo: {},
    });
  },

  /** 重置所有 AI 状态到初始值 */
  resetAI: () => set(initialState),
}));
