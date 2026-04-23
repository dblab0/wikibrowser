import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { AIMessage, AITextContent, AIThinkContent, AIToolCallContent, AIToolResultContent, AIApprovalContent, AIQuestionContent, AISubagentContent } from '@shared/types';
import { useAIStore } from '../../stores/ai';
import { copyToClipboard } from '../../services/clipboard';
import { AITextMessage } from './AITextMessage';
import { AIThinkMessage } from './AIThinkMessage';
import { AIToolMessage } from './AIToolMessage';
import { AIApprovalMessage } from './AIApprovalMessage';
import { QuestionDialog } from './QuestionDialog';
import { SubagentView } from './SubagentView';
import { ReferencePill } from './ReferencePill';

// ===== 复制图标 =====
const CopyIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/** 渲染单条用户消息 */
const UserMessage: React.FC<{ content: AITextContent }> = ({ content }) => {
  const [copied, setCopied] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!content.text) return;
    const success = await copyToClipboard(content.text);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [content.text]);

  const showReferences = content.references && content.references.length > 0;

  return (
    <div
      className="flex items-end gap-2 animate-fade-up"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* 复制按钮 - 在左下角边 */}
      {content.text && (
        <button
          onClick={handleCopy}
          className={`
            shrink-0 p-1.5 rounded-md
            cursor-pointer flex items-center justify-center
            transition-all duration-150
            ${copied
              ? 'bg-success text-white'
              : 'bg-surface-secondary border border-edge text-content-tertiary hover:bg-surface-hover hover:text-content'
            }
            ${isHovering ? 'opacity-100' : 'opacity-0'}
          `}
          title={copied ? '已复制' : '复制'}
        >
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
        </button>
      )}
      {/* 消息内容 */}
      <div className="flex-1 max-w-[calc(100%-32px)]">
        {/* 引用列表 */}
        {showReferences && (
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {content.references!.map((ref) => (
              <ReferencePill
                key={ref.id}
                reference={ref}
                removable={false}
              />
            ))}
          </div>
        )}
        {/* 文本内容 */}
        <div className="px-3.5 py-2.5 bg-accent-light border border-accent/20 rounded-xl rounded-tl-sm text-[14px] leading-relaxed text-content break-words select-text">
          {content.text}
        </div>
      </div>
    </div>
  );
};

/** 根据 type 获取消息内容（类型安全） */
function getContentByType<T>(msg: AIMessage): T {
  return msg.content as T;
}

/** AI 消息列表属性 */
interface AIMessageListProps {
  /** 需要高亮的消息 ID */
  highlightMessageId?: string | null;
}

/**
 * AI 消息列表组件
 * 使用虚拟滚动渲染消息列表，支持多种消息类型的分发渲染
 */
const AIMessageList: React.FC<AIMessageListProps> = ({ highlightMessageId }) => {
  const messages = useAIStore((s) => s.aiMessages);
  const streaming = useAIStore((s) => s.aiStreaming);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const toolResultMap = useMemo(() => {
    const map = new Map<string, AIMessage>();
    for (const msg of messages) {
      if (msg.type === 'tool_result') {
        const resultContent = msg.content as AIToolResultContent;
        map.set(resultContent.toolCallId, msg);
      }
    }
    return map;
  }, [messages]);

  const displayMessages = useMemo(
    () => messages.filter((msg) => msg.type !== 'tool_result'),
    [messages]
  );

  // Virtuoso followOutput 只在数组新增项时触发，不会因现有项高度变化而滚动。
  // 流式内容（think/text/tool）通过 appendToMessage 原地更新，高度增长但不会触发 followOutput。
  // 且 atBottomStateChange 在内容快速增长时也会误报 false，无法作为可靠判断依据。
  // 因此在 streaming 期间直接强制 scrollToIndex，不依赖 isAtBottom。
  useEffect(() => {
    if (streaming && displayMessages.length > 0) {
      virtuosoRef.current?.scrollToIndex({
        index: displayMessages.length - 1,
        behavior: 'smooth',
        align: 'end',
      });
    }
  }, [messages, streaming, displayMessages.length]);

  if (displayMessages.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center gap-4 text-content-tertiary p-6">
        <p className="text-[14px]">开始与 AI 对话</p>
        <p className="text-[12px]">输入问题，AI 将基于当前项目上下文回答</p>
      </div>
    );
  }

  return (
    <div data-testid="ai-message-list" className="relative flex-1 min-h-0">
      <Virtuoso
        ref={virtuosoRef}
        data={displayMessages}
        followOutput="smooth"
        atBottomStateChange={setIsAtBottom}
        className="flex-1 overflow-y-auto"
        style={{ background: 'var(--surface)' }}
        itemContent={(index, msg) => {
        const isLastAssistant = index === displayMessages.length - 1;
        // Phase 3: 高亮匹配的消息
        const isHighlighted = highlightMessageId === msg.id;

        if (msg.role === 'user') {
          return (
            <div data-testid={`ai-message-${index}`} className={`px-4 pt-5 ${isHighlighted ? 'bg-accent-light/50 rounded-lg' : ''}`}>
              <UserMessage content={getContentByType<AITextContent>(msg)} />
            </div>
          );
        }

        switch (msg.type) {
          case 'text': {
            const textContent = getContentByType<AITextContent>(msg);
            return (
              <div data-testid={`ai-message-${index}`} className={`px-4 pt-5 ${isHighlighted ? 'bg-accent-light/50 rounded-lg' : ''}`}>
                <AITextMessage
                  content={textContent}
                  streaming={streaming && isLastAssistant}
                  role="assistant"
                />
              </div>
            );
          }

          case 'think': {
            const thinkContent = getContentByType<AIThinkContent>(msg);
            return (
              <div data-testid={`ai-message-${index}`} className={`px-4 pt-5 max-w-[360px] ${isHighlighted ? 'bg-accent-light/50 rounded-lg' : ''}`}>
                <AIThinkMessage
                  content={thinkContent}
                  streaming={streaming && isLastAssistant}
                />
              </div>
            );
          }

          case 'tool_call': {
            const toolContent = getContentByType<AIToolCallContent>(msg);
            const resultMsg = toolResultMap.get(toolContent.toolCallId);
            const resultContent = resultMsg
              ? getContentByType<AIToolResultContent>(resultMsg)
              : undefined;
            return (
              <div data-testid={`ai-message-${index}`} className={`px-4 pt-5 max-w-[360px] ${isHighlighted ? 'bg-accent-light/50 rounded-lg' : ''}`}>
                <AIToolMessage content={toolContent} result={resultContent} />
              </div>
            );
          }

          case 'approval': {
            const approvalContent = getContentByType<AIApprovalContent>(msg);
            return (
              <div data-testid={`ai-message-${index}`} className={`px-4 pt-5 ${isHighlighted ? 'bg-accent-light/50 rounded-lg' : ''}`}>
                <AIApprovalMessage messageId={msg.id} content={approvalContent} />
              </div>
            );
          }

          // Phase 3: Question 类型消息
          case 'question': {
            const questionContent = getContentByType<AIQuestionContent>(msg);
            return (
              <div data-testid={`ai-message-${index}`} className={`px-4 pt-5 ${isHighlighted ? 'bg-accent-light/50 rounded-lg' : ''}`}>
                <QuestionDialog content={questionContent} />
              </div>
            );
          }

          case 'subagent': {
            const subagentContent = getContentByType<AISubagentContent>(msg);
            return (
              <div data-testid={`ai-message-${index}`} className={`px-4 pt-5 max-w-[360px] ${isHighlighted ? 'bg-accent-light/50 rounded-lg' : ''}`}>
                <SubagentView events={subagentContent.events} />
              </div>
            );
          }

          default:
            return null;
        }
      }}
    />
    {/* 不在底部时显示回到底部按钮 */}
    {!isAtBottom && !streaming && (
      <button
        onClick={() => {
          virtuosoRef.current?.scrollToIndex({
            index: displayMessages.length - 1,
            behavior: 'smooth',
            align: 'end',
          });
        }}
        className="absolute right-3 bottom-3 w-8 h-8 flex items-center justify-center rounded-full bg-surface-secondary border border-edge shadow-md hover:bg-surface-hover transition-all duration-200 cursor-pointer text-content-tertiary hover:text-content"
        title="回到底部"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14" />
          <path d="M19 12l-7 7-7-7" />
        </svg>
      </button>
    )}
    </div>
  );
};

export { AIMessageList };
