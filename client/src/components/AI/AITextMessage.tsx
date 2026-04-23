import React, { useState, useCallback } from 'react';
import type { AITextContent } from '@shared/types';
import { copyToClipboard } from '../../services/clipboard';
import StreamdownRenderer from './StreamdownRenderer';
import { ReferencePill } from './ReferencePill';

/** AI 文本消息属性 */
interface AITextMessageProps {
  /** 消息内容 */
  content: AITextContent;
  /** 是否正在流式传输 */
  streaming?: boolean;
  /** 消息角色 */
  role?: 'user' | 'assistant';
}

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

/**
 * AI 文本消息组件
 * 渲染 AI 或用户的文本消息，支持 Markdown 流式渲染、引用文件和一键复制
 */
const AITextMessage: React.FC<AITextMessageProps> = ({ content, streaming, role }) => {
  const [copied, setCopied] = useState(false);
  const [isHovering, setIsHovering] = useState(false);

  // 仅用户消息显示引用
  const showReferences = role === 'user' && content.references && content.references.length > 0;

  const handleCopy = useCallback(async () => {
    if (!content.text) return;
    const success = await copyToClipboard(content.text);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [content.text]);

  return (
    <div
      className="flex flex-row-reverse items-end gap-2 animate-fade-up"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* 复制按钮 - 在右下角边 */}
      {!streaming && content.text && (
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
      <div className="flex-1 min-w-0 max-w-[calc(100%-32px)]">
        {/* 引用列表 - 仅用户消息显示 */}
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
        <div className="ai-message-content px-3.5 py-3 bg-surface-secondary border border-edge-light rounded-xl rounded-bl-sm text-[14px] leading-[1.7] text-content break-words">
          <StreamdownRenderer content={content.text} streaming={streaming} />
        </div>
      </div>
    </div>
  );
};

export { AITextMessage };
