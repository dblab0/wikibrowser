import React, { useState, useRef, useCallback } from 'react';
import { useAIStore } from '../../stores/ai';
import { aiWs } from '../../services/ai-ws';
import { ReferencePill } from './ReferencePill';
import { buildContextPrompt, parseContextPrompt } from '@shared/utils/context-prompt';

/** 发送图标 */
const SendIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 2L11 13" />
    <path d="M22 2L15 22L11 13L2 9L22 2Z" />
  </svg>
);

/** 停止图标 */
const StopIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

/**
 * AI 输入栏组件
 * 支持多行文本输入、引用文件、发送消息和停止生成
 */
const AIInputBar: React.FC = () => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeSessionId = useAIStore((s) => s.activeSessionId);
  const streaming = useAIStore((s) => s.aiStreaming);
  const setStreaming = useAIStore((s) => s.setStreaming);
  const addMessage = useAIStore((s) => s.addMessage);
  const setAIError = useAIStore((s) => s.setAIError);
  const sessions = useAIStore((s) => s.aiSessions);
  const updateSessionTitle = useAIStore((s) => s.updateSessionTitle);
  const pendingReferences = useAIStore((s) => s.pendingReferences);
  const removeReference = useAIStore((s) => s.removeReference);
  const clearReferences = useAIStore((s) => s.clearReferences);

  /** 发送消息（通过 WebSocket） */
  const handleSend = useCallback(() => {
    const message = input.trim();
    if (!message || !activeSessionId || streaming) return;

    console.log(`[AIInputBar] Sending message via WebSocket: msg="${message.substring(0, 50)}..."`);
    setInput('');
    setStreaming(true);
    setAIError(null);

    // 首次发送消息时，用 prompt 前 100 字符命名会话
    const currentSession = sessions.find((s) => s.id === activeSessionId);
    if (currentSession && (currentSession.title === '新对话' || !currentSession.title)) {
      const { visibleText } = parseContextPrompt(message);
      const title = visibleText.length > 50 ? visibleText.substring(0, 50) + '...' : visibleText;
      updateSessionTitle(activeSessionId, title);
    }

    // 构建包含引用的完整 prompt
    const fullPrompt = buildContextPrompt(pendingReferences, message);

    // 添加用户消息到列表（包含引用信息）
    addMessage({
      id: `user-${Date.now()}`,
      sessionId: activeSessionId,
      role: 'user',
      type: 'text',
      content: {
        text: message,
        references: pendingReferences.length > 0 ? [...pendingReferences] : undefined,
      },
      timestamp: Date.now(),
    });

    // 通过 WebSocket 发送消息
    aiWs.sendPrompt(fullPrompt);

    // 清空引用
    clearReferences();

    // 重新聚焦输入框
    textareaRef.current?.focus();
  }, [input, activeSessionId, streaming, sessions, pendingReferences, setStreaming, addMessage, setAIError, updateSessionTitle, clearReferences]);

  /** 停止生成（通过 WebSocket） */
  const handleStop = useCallback(() => {
    if (!activeSessionId) return;
    console.log('[AIInputBar] Sending cancel via WebSocket');
    aiWs.sendCancel();
    setStreaming(false);
  }, [activeSessionId, setStreaming]);

  /** 键盘事件：Enter 发送，Shift+Enter 换行 */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  /** textarea 自动调整高度 */
  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
  }, []);

  return (
    <div className="border-t border-edge bg-surface-secondary shrink-0 px-3.5 pt-3 pb-2.5">
      {/* Reference Pills 列表 */}
      {pendingReferences.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          {pendingReferences.map((ref) => (
            <ReferencePill
              key={ref.id}
              reference={ref}
              removable={true}
              onRemove={removeReference}
            />
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            data-testid="ai-input"
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="输入消息..."
            disabled={streaming}
            rows={1}
            className="w-full resize-none px-3.5 py-2.5 pr-2 border border-edge rounded-xl bg-surface text-content text-[14px] leading-relaxed font-sans outline-none max-h-[150px] min-h-[40px] transition-all duration-150 focus:border-accent focus:ring-[3px] focus:ring-accent/15 placeholder:text-content-muted"
          />
        </div>
        {/* 发送/停止按钮 */}
        {streaming ? (
          <button
            onClick={handleStop}
            title="停止生成"
            className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center bg-danger text-white hover:opacity-85 transition-all duration-150"
          >
            <StopIcon size={14} />
          </button>
        ) : (
          <button
            data-testid="ai-send"
            onClick={handleSend}
            disabled={!input.trim() || !activeSessionId}
            title="发送消息"
            className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center bg-accent text-white hover:bg-accent-hover transition-all duration-150 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <SendIcon size={14} />
          </button>
        )}
      </div>
      <div className="text-[11px] text-content-muted mt-1.5 text-center">
        Enter 发送 / Shift+Enter 换行
      </div>
    </div>
  );
};

export { AIInputBar };
