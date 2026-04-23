import React from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import type { AIThinkContent } from '@shared/types';
import StreamdownRenderer from './StreamdownRenderer';

/** AI 思考消息属性 */
interface AIThinkMessageProps {
  /** 思考内容 */
  content: AIThinkContent;
  /** 是否正在流式传输 */
  streaming?: boolean;
}

// ===== 图标组件 =====
const ChevronIcon: React.FC<{ size?: number; className?: string }> = ({ size = 12, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className={`transition-transform duration-200 ${className || ''}`}
  ><path d="M9 18l6-6-6-6" /></svg>
);

const BrainIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a4 4 0 0 0-4 4v2a4 4 0 0 0 0 8v2a4 4 0 0 0 8 0v-2a4 4 0 0 0 0-8V6a4 4 0 0 0-4-4z" />
    <path d="M12 6v4" />
    <path d="M12 14v4" />
    <path d="M8 10h8" />
  </svg>
);

/**
 * AI 思考过程消息组件
 * 可折叠展示 AI 的思考内容，流式传输时自动展开
 */
const AIThinkMessage: React.FC<AIThinkMessageProps> = ({ content, streaming }) => {
  const [open, setOpen] = React.useState(streaming || false);

  // streaming 变化时同步折叠状态
  React.useEffect(() => {
    setOpen(streaming || false);
  }, [streaming]);

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className="my-2 rounded-xl border border-edge-light bg-surface-tertiary overflow-hidden"
    >
      <Collapsible.Trigger className="group flex items-center gap-2 w-full px-3.5 py-2.5 text-[12px] font-medium text-content-secondary hover:bg-surface-hover transition-colors duration-150 cursor-pointer">
        <BrainIcon size={14} />
        <span className="flex-1">
          {streaming ? '思考中...' : '思考过程'}
        </span>
        {content.duration && !streaming && (
          <span className="text-[11px] text-content-tertiary">
            {content.duration}s
          </span>
        )}
        <ChevronIcon size={12} className="group-data-[state=open]:rotate-90" />
      </Collapsible.Trigger>

      <Collapsible.Content className="CollapsibleContent">
        <div className="px-3.5 py-3 text-[13px] text-content-tertiary leading-relaxed border-t border-edge-light whitespace-pre-wrap break-words">
          {content.think && (
            <StreamdownRenderer content={content.think} streaming={streaming} />
          )}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
};

export { AIThinkMessage };