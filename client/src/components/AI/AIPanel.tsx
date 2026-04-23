import React, { useEffect, useCallback, useState, useRef } from 'react';
import { useAIStore } from '../../stores/ai';
import { useAppStore } from '../../stores/app';
import { useDragResize } from '../../hooks/useDragResize';
import { aiApi } from '../../services/ai-api';
import { aiWs } from '../../services/ai-ws';
import { AISessionBar } from './AISessionBar';
import { AIMessageList } from './AIMessageList';
import { AIInputBar } from './AIInputBar';
import { AIInstallPrompt } from './AIInstallPrompt';
import { MessageSearchBar } from './MessageSearchBar';
import { TokenStatusBar } from './TokenStatusBar';
import { WireDebugPanel } from './WireDebugPanel';
import type { SubagentEvent } from '@shared/types';

/** 根据视口宽度返回 AI Panel 的 min/default/max 宽度配置 */
function getWidthConfig(vw: number) {
  if (vw >= 1536) return { min: 360, default: 520, max: 960 };
  if (vw >= 1280) return { min: 320, default: 480, max: 800 };
  return { min: 300, default: 400, max: 600 };
}

/**
 * AI 对话面板组件
 * 包含会话管理、WebSocket 连接管理、消息渲染、输入栏等功能
 */
const AIPanel: React.FC = () => {
  const aiPanelOpen = useAIStore((s) => s.aiPanelOpen);
  const aiStatus = useAIStore((s) => s.aiStatus);
  const setAIStatus = useAIStore((s) => s.setAIStatus);
  const setAISessions = useAIStore((s) => s.setAISessions);
  const setActiveSession = useAIStore((s) => s.setActiveSession);
  const setAIMessages = useAIStore((s) => s.setAIMessages);
  const setConnected = useAIStore((s) => s.setConnected);
  const setStreaming = useAIStore((s) => s.setStreaming);
  const setAIPanelWidth = useAIStore((s) => s.setAIPanelWidth);
  const setStatusInfo = useAIStore((s) => s.setStatusInfo);
  const setSessionStatus = useAIStore((s) => s.setSessionStatus);
  const switchProject = useAIStore((s) => s.switchProject);
  const aiMessages = useAIStore((s) => s.aiMessages);
  const sessionStatus = useAIStore((s) => s.sessionStatus);

  const config = useAppStore((s) => s.config);
  const projects = useAppStore((s) => s.projects);

  const activeSessionId = useAIStore((s) => s.activeSessionId);

  // Phase 3: Search state
  const [showSearch, setShowSearch] = useState(false);
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);

  // 追踪是否曾处于 active 状态，用于区分首次激活与重新连接
  const hasBeenActiveRef = useRef(false);

  const currentProjectId = config?.lastOpenedProject;
  const currentProject = projects.find((p) => p.id === currentProjectId);

  // 响应式宽度配置：根据视口动态计算 min/default/max
  const [widthConfig, setWidthConfig] = useState(() => getWidthConfig(window.innerWidth));

  /** 监听窗口 resize，跨越断点时更新配置并 clamp 面板宽度 */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const handleResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const newConfig = getWidthConfig(window.innerWidth);
        setWidthConfig((prev) => {
          // 断点未变化时跳过更新
          if (prev.min === newConfig.min && prev.max === newConfig.max) return prev;
          return newConfig;
        });
      }, 150);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, []);

  const { width, dragHandleProps, isDragging } = useDragResize({
    minWidth: widthConfig.min,
    maxWidth: widthConfig.max,
    initialWidth: widthConfig.default,
    onResize: setAIPanelWidth,
  });

  /** 宽度配置变更时，clamp 当前面板宽度到新的合法范围 */
  useEffect(() => {
    const currentWidth = useAIStore.getState().aiPanelWidth;
    if (currentWidth > widthConfig.max || currentWidth < widthConfig.min) {
      const clamped = Math.min(widthConfig.max, Math.max(widthConfig.min, currentWidth));
      setAIPanelWidth(clamped);
    }
  }, [widthConfig, setAIPanelWidth]);

  /** 面板打开时初始化 + 项目切换时重新加载 */
  useEffect(() => {
    if (!aiPanelOpen) return;
    let cancelled = false;
    // 捕获当前 projectId 用于竞态保护
    const projectId = currentProjectId;

    async function init() {
      try {
        console.log(`[AIPanel] Init started for project ${projectId}`);

        // 项目切换时重置 AI 状态
        switchProject(projectId ?? '');

        if (!projectId || !currentProject) return;

        // 1: 检查 AI 状态
        const status = await aiApi.getStatus();
        if (cancelled) return;
        setAIStatus(status);
        console.log(`[AIPanel] AI status: available=${status.available}, version=${status.version}`);

        if (!status.available) return;

        // 2: 加载 session 列表
        const sessions = await aiApi.listSessions(projectId);
        if (cancelled || useAppStore.getState().config?.lastOpenedProject !== projectId) return;

        setAISessions(sessions);
        console.log(`[AIPanel] Found ${sessions.length} sessions for project ${projectId}`);

        if (sessions.length > 0) {
          // 3. 选中最近一个 session
          const latest = sessions[sessions.length - 1];
          console.log(`[AIPanel] Selecting latest session: ${latest.id}`);
          setActiveSession(latest.id);
          // 加载历史消息
          const detail = await aiApi.getSessionDetail(latest.id);
          if (cancelled || useAppStore.getState().config?.lastOpenedProject !== projectId) return;
          setAIMessages(detail.messages);
          console.log(`[AIPanel] Session detail loaded: ${detail.messages?.length || 0} messages`);
        } else {
          // 4. 无 session → 自动新建
          console.log(`[AIPanel] No sessions found, creating new one...`);
          const result = await aiApi.createSession(projectId, currentProject.path);
          if (cancelled || useAppStore.getState().config?.lastOpenedProject !== projectId) return;
          console.log(`[AIPanel] New session created: ${result.id}`);
          setActiveSession(result.id);
          setAIMessages([]);
          // 本地追加 session，不重新请求列表
          setAISessions([{
            id: result.id,
            projectId: projectId,
            projectPath: currentProject.path,
            title: '新对话',
            status: 'active',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }]);
        }
        console.log('[AIPanel] Init completed');
      } catch (err) {
        console.error('[AIPanel] Init failed:', err);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [aiPanelOpen, currentProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** WebSocket 连接管理 */
  useEffect(() => {
    if (!aiPanelOpen || !activeSessionId) return;

    console.log(`[AIPanel] Setting up WebSocket for session ${activeSessionId}`);
    setConnected(false);
    // 切换会话时重置 active 追踪标记
    hasBeenActiveRef.current = false;

    // ---- Turn 边界追踪 ----
    let turnSeq = 0;                              // Turn 序号
    let turnMsgMap: Record<string, string> = {};   // contentType → messageId 映射
    let msgCounter = 0;                            // 消息 ID 自增计数器
    let lastToolCallId = '';                        // 最近一个 ToolCall 的 ID，用于关联后续 ToolCallPart

    const callbacks = {
      onEvent: (event: { type: string; payload: unknown }) => {
        const store = useAIStore.getState();
        const sessionId = store.activeSessionId;
        const payload = event.payload as Record<string, unknown>;
        console.log(`[AIPanel] WS onEvent: type=${event.type}`);

        // Phase 3: 分发事件给 WireDebugPanel
        const eventStore = (window as any).__wireDebugEvents || {};
        if (eventStore[activeSessionId]) {
          eventStore[activeSessionId](event);
        }

        switch (event.type) {
          case 'TurnBegin':
            turnSeq++;
            turnMsgMap = {};
            store.setStreaming(true);
            store.setSessionStatus('busy');
            break;

          case 'StepBegin':
            // StepBegin 标志 Turn 内的新推理步骤，重置消息映射以隔离不同 Step 的内容
            turnMsgMap = {};
            break;

          case 'ContentPart': {
            // kimi wire protocol v1.9+: payload.type === "text" | "think"
            const contentType = payload?.type as string;
            if (contentType === 'text') {
              const existingId = turnMsgMap['text'];
              if (existingId) {
                store.appendToMessage(existingId, 'text', (payload.text as string) || '');
              } else {
                const id = `ai-text-${Date.now()}-${++msgCounter}`;
                store.addMessage({
                  id,
                  sessionId: sessionId!,
                  role: 'assistant',
                  type: 'text',
                  content: { text: (payload.text as string) || '' },
                  timestamp: Date.now(),
                });
                turnMsgMap['text'] = id;
              }
            } else if (contentType === 'think') {
              const existingId = turnMsgMap['think'];
              if (existingId) {
                store.appendToMessage(existingId, 'think', (payload.think as string) || '');
              } else {
                const id = `ai-think-${Date.now()}-${++msgCounter}`;
                store.addMessage({
                  id,
                  sessionId: sessionId!,
                  role: 'assistant',
                  type: 'think',
                  content: { think: (payload.think as string) || '' },
                  timestamp: Date.now(),
                });
                turnMsgMap['think'] = id;
              }
            }
            break;
          }

          case 'TextPart': {
            const existingId = turnMsgMap['text'];
            if (existingId) {
              store.appendToMessage(existingId, 'text', (payload.text as string) || '');
            } else {
              const id = `ai-text-${Date.now()}-${++msgCounter}`;
              store.addMessage({
                id,
                sessionId: sessionId!,
                role: 'assistant',
                type: 'text',
                content: { text: (payload.text as string) || '' },
                timestamp: Date.now(),
              });
              turnMsgMap['text'] = id;
            }
            break;
          }

          case 'ThinkPart': {
            const existingId = turnMsgMap['think'];
            if (existingId) {
              store.appendToMessage(existingId, 'think', (payload.think as string) || '');
            } else {
              const id = `ai-think-${Date.now()}-${++msgCounter}`;
              store.addMessage({
                id,
                sessionId: sessionId!,
                role: 'assistant',
                type: 'think',
                content: { think: (payload.think as string) || '' },
                timestamp: Date.now(),
              });
              turnMsgMap['think'] = id;
            }
            break;
          }

          case 'ToolCall': {
            // kimi JSON-RPC 可能发送 arguments 为 JSON 对象（而非字符串），需统一转为字符串
            const rawArgs = (payload.function as Record<string, unknown>)?.arguments;
            const argsStr = typeof rawArgs === 'string'
              ? rawArgs
              : rawArgs != null ? JSON.stringify(rawArgs) : '';
            const toolCallId = (payload.id as string) || '';
            lastToolCallId = toolCallId; // 记录最近的 ToolCall ID，用于关联后续 ToolCallPart
            store.addMessage({
              id: `ai-tool-${Date.now()}`,
              sessionId: sessionId!,
              role: 'assistant',
              type: 'tool_call',
              content: {
                toolCallId,
                functionName: (payload.function as Record<string, string>)?.name || '',
                arguments: argsStr,
              },
              timestamp: Date.now(),
            });
            break;
          }

          // [Phase 2] ToolCallPart - 工具参数流式传输
          // ToolCallPart 事件没有 tool_call_id，使用最近一个 ToolCall 的 ID 关联
          case 'ToolCallPart': {
            const toolCallId = (payload.tool_call_id as string) || lastToolCallId;
            const argsPart = payload.arguments_part as string;
            if (toolCallId && argsPart) {
              store.appendToToolCallArgs(toolCallId, argsPart);
            }
            break;
          }

          case 'ToolResult':
            store.addMessage({
              id: `ai-result-${Date.now()}`,
              sessionId: sessionId!,
              role: 'assistant',
              type: 'tool_result',
              content: {
                toolCallId: (payload.tool_call_id as string) || '',
                isError: Boolean((payload.return_value as Record<string, unknown>)?.is_error),
                output: (payload.return_value as Record<string, unknown>)?.output as string || '',
              },
              timestamp: Date.now(),
            });
            break;

          // [Phase 2] StatusUpdate - token 用量、上下文使用率
          case 'StatusUpdate': {
            const statusPayload = payload as {
              token_usage?: {
                input_other?: number;
                output?: number;
                input_cache_read?: number;
                input_cache_creation?: number;
              };
              context_usage?: number;
              plan_mode?: boolean;
            };
            // 安全处理：确保所有数值字段存在，避免 NaN
            if (statusPayload.token_usage) {
              const tu = statusPayload.token_usage;
              const safeTokenUsage = {
                inputOther: tu.input_other ?? 0,
                output: tu.output ?? 0,
                inputCacheRead: tu.input_cache_read ?? 0,
                inputCacheCreation: tu.input_cache_creation ?? 0,
              };
              store.setStatusInfo({
                tokenUsage: safeTokenUsage,
                contextUsage: statusPayload.context_usage,
              });
            } else {
              store.setStatusInfo({
                contextUsage: statusPayload.context_usage,
              });
            }
            break;
          }

          // [Phase 2] QuestionRequest - AI 主动提问
          case 'QuestionRequest': {
            const questionPayload = payload as {
              id: string;
              questions: Array<{ id: string; text: string; options?: string[] }>;
            };
            store.addMessage({
              id: `ai-question-${Date.now()}`,
              sessionId: sessionId!,
              role: 'assistant',
              type: 'question',
              content: {
                questionId: questionPayload.id,
                questions: questionPayload.questions,
              },
              timestamp: Date.now(),
            });
            break;
          }

          // [Phase 2] SessionStatus - 会话状态变更
          case 'SessionStatus': {
            const statusPayload = payload as {
              session_id: string;
              state: 'idle' | 'busy' | 'error' | 'stopped';
              reason?: string;
            };
            store.setSessionStatus(statusPayload.state);
            if (statusPayload.state === 'idle' || statusPayload.state === 'stopped') {
              store.setStreaming(false);
            }
            break;
          }

          case 'SubagentEvent': {
            const subPayload = payload as {
              parent_tool_call_id: string;
              agent_id: string;
              subagent_type: string;
              event: { type: string; payload: unknown };
            };
            if (subPayload?.parent_tool_call_id && subPayload?.agent_id && subPayload?.event) {
              const subagentEvent: SubagentEvent = {
                type: 'SubagentEvent',
                payload: {
                  parent_tool_call_id: subPayload.parent_tool_call_id,
                  agent_id: subPayload.agent_id,
                  subagent_type: subPayload.subagent_type || 'agent',
                  event: subPayload.event,
                },
              };
              store.addSubagentEvent(
                subPayload.parent_tool_call_id,
                subPayload.agent_id,
                subPayload.subagent_type || 'agent',
                subagentEvent
              );

              // 检查内部事件是否表示子代理完成
              const innerType = subPayload.event.type;
              if (innerType === 'TurnEnd') {
                store.updateSubagentStatus(
                  subPayload.parent_tool_call_id,
                  subPayload.agent_id,
                  'completed'
                );
              }
            }
            break;
          }

          case 'TurnEnd':
            store.setStreaming(false);
            store.setSessionStatus('idle');
            break;

          case 'session-deactivated': {
            const deactPayload = payload as { sessionId?: string; reason?: string };
            store.handleSessionDeactivated(
              deactPayload.sessionId || store.activeSessionId || '',
              deactPayload.reason || 'unknown',
            );
            break;
          }

          case 'activating': {
            // 会话正在激活/重新激活，显示 connecting 状态
            store.setSessionStatus('connecting');
            break;
          }

          case 'activated': {
            // 会话已激活就绪，进入正常对话模式
            store.setSessionStatus('active');
            hasBeenActiveRef.current = true;
            break;
          }
        }
      },

      onRequest: (request: { id: string; payload: unknown }) => {
        const store = useAIStore.getState();
        const payload = request.payload as Record<string, unknown>;
        // ApprovalRequest 通过 payload 的内容识别
        if (payload?.action && payload?.tool_call_id) {
          store.addMessage({
            id: `ai-approval-${Date.now()}`,
            sessionId: store.activeSessionId!,
            role: 'assistant',
            type: 'approval',
            content: {
              requestId: (payload.id as string) || request.id,
              toolCallId: (payload.tool_call_id as string) || '',
              action: (payload.action as string) || '',
              description: (payload.description as string) || '',
              display: (payload.display as Array<{ type: string; [key: string]: unknown }>) || [],
              responded: false,
            },
            timestamp: Date.now(),
          });
        }
      },

      onError: (error: { message: string }) => {
        console.error('[AIPanel] WS onError:', error);
        useAIStore.getState().setConnected(false);
        useAIStore.getState().setSessionStatus('error');
      },

      onClose: (info?: { code: number | null; sessionId?: string }) => {
        console.log('[AIPanel] WS onClose:', info);
        useAIStore.getState().setConnected(false);
        useAIStore.getState().setStreaming(false);
        useAIStore.getState().setSessionStatus('stopped');
      },

      onConnect: () => {
        console.log('[AIPanel] WS onConnect - connection established');
        useAIStore.getState().setConnected(true);
        // WS 连接即表示就绪，直接进入 active 状态，不显示启动横幅
        // 进程激活仅在用户发 prompt 时由 activating 事件触发短暂提示
        useAIStore.getState().setSessionStatus('active');
      },
    };

    aiWs.connect(activeSessionId, callbacks);

    return () => {
      aiWs.disconnect();
      setConnected(false);
    };
  }, [aiPanelOpen, activeSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 面板关闭时的清理 */
  useEffect(() => {
    if (!aiPanelOpen) {
      // WebSocket 连接断开（面板关闭时断开连接）
      aiWs.disconnect();
      // Phase 3: 清理搜索状态
      setShowSearch(false);
      setHighlightMessageId(null);
    }
  }, [aiPanelOpen]);

  /** Phase 3: Ctrl+F / Cmd+F 快捷键触发搜索 */
  useEffect(() => {
    if (!aiPanelOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+F or Cmd+F
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
      }
      // Escape 关闭搜索
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false);
        setHighlightMessageId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [aiPanelOpen, showSearch]);

  /** Phase 3: 搜索高亮回调 */
  const handleSearchHighlight = useCallback((messageId: string, _matchIndex: number) => {
    setHighlightMessageId(messageId);
  }, []);

  /** Phase 3: 关闭搜索回调 */
  const handleSearchClose = useCallback(() => {
    setShowSearch(false);
    setHighlightMessageId(null);
  }, []);

  // Phase 3: wireDebug flag from aiStatus
  const wireDebug = aiStatus?.wireDebug ?? false;

  // 面板关闭时不渲染
  if (!aiPanelOpen) return null;

  const isAvailable = aiStatus?.available !== false;

  return (
    <div
      data-testid="ai-panel"
      className="relative h-full shrink-0 flex flex-col border-l border-edge bg-surface animate-slide-in-right"
      style={{ width: `${width}px`, userSelect: isDragging ? 'none' : 'auto' }}
    >
      {/* 拖拽 handle */}
      <div
        {...dragHandleProps}
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-accent/30 active:bg-accent/50 transition-colors duration-150"
      />

      {isAvailable ? (
        <>
          <AISessionBar />
          {/* 连接中/已过期状态提示 */}
          {sessionStatus === 'connecting' && (
            <div className="flex items-center gap-2 px-3 py-2 text-[12px] font-medium animate-pulse"
              style={{ background: 'var(--accent-light)', color: 'var(--accent-text)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              {hasBeenActiveRef.current ? '正在重新连接，请稍候...' : '正在启动 AI，请稍候...'}
            </div>
          )}
          {sessionStatus === 'expired' && (
            <div className="flex items-center gap-2 px-3 py-2 text-[12px] font-medium"
              style={{ background: 'var(--warning-light)', color: 'var(--warning)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              会话已过期，发送消息将重新连接
            </div>
          )}
          {/* Phase 3: 搜索栏 */}
          {showSearch && (
            <MessageSearchBar
              messages={aiMessages}
              onClose={handleSearchClose}
              onHighlight={handleSearchHighlight}
            />
          )}
          {config?.yolo && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium"
              style={{ background: 'var(--warning-light)', color: 'var(--warning)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              YOLO 自动审批已启用
            </div>
          )}
          {/* Phase 3: 传递 highlightMessageId 给消息列表 */}
          <AIMessageList highlightMessageId={highlightMessageId} />
          <AIInputBar />
          {/* Phase 3: Token 状态栏 */}
          <TokenStatusBar />
          {/* Phase 3: Wire Debug 面板（仅 wireDebug=true 时显示） */}
          {wireDebug && activeSessionId && (
            <WireDebugPanel sessionId={activeSessionId} />
          )}
        </>
      ) : (
        <AIInstallPrompt />
      )}
    </div>
  );
};

export { AIPanel };