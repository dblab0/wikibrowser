import React, { useEffect, useRef } from 'react';

/** 浮动工具栏属性 */
interface FloatingToolbarProps {
  /** 是否可见 */
  visible: boolean;
  /** 工具栏位置 */
  position: {
    top: number;
    left: number;
  };
  /** 插入评论回调 */
  onComment: () => void;
  /** 发送到 AI 回调 */
  onSendToAI: () => void;
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 文本选区浮动工具栏
 * 选中 Markdown 文本后弹出，提供评论和发送到 AI 操作
 */
const FloatingToolbar: React.FC<FloatingToolbarProps> = ({
  visible,
  position,
  onComment,
  onSendToAI,
  onClose,
}) => {
  const toolbarRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // 延迟添加，避免触发此事件的是打开工具栏的 mouseup
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  if (!visible) return null;

  return (
    <div
      ref={toolbarRef}
      className="floating-toolbar inline-flex items-center gap-1 p-1 rounded-lg shadow-lg border bg-surface"
      style={{
        position: 'absolute',
        top: position.top - 50,
        left: position.left,
        transform: 'translateX(-50%)',
        zIndex: 50,
      }}
    >
      <button
        onClick={onComment}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-accent/10 transition-colors"
        style={{ color: 'var(--foreground)' }}
        title="插入评论 Callout"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        评论
      </button>
      <button
        onClick={onSendToAI}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium hover:bg-accent/10 transition-colors"
        style={{ color: 'var(--accent-text)' }}
        title="发送到 AI 侧边栏"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        发送到 AI
      </button>
    </div>
  );
};

export default FloatingToolbar;
