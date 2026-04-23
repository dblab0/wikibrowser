import React, { useState } from 'react';
import type { CalloutType } from '../../utils/callout-parser';

/** Callout 标注块属性 */
interface CalloutBlockProps {
  /** 标注类型 */
  calloutType: CalloutType;
  /** 标题 */
  title: string;
  /** 正文文本 */
  bodyText: string;
  /** 正文子节点 */
  bodyChildren: React.ReactNode[];
  /** 原始 Markdown 正文 */
  rawBodyMd?: string;
  /** 起始行号 */
  startLine?: number;
  /** 结束行号 */
  endLine?: number;
  /** 编辑回调 */
  onEdit?: (type: CalloutType, title: string, content: string) => void;
  /** 删除回调 */
  onDelete?: () => void;
}

/** 各标注类型的图标和样式配置 */
const TYPE_CONFIG: Record<CalloutType, { icon: string; className: string }> = {
  NOTE: { icon: 'ℹ️', className: 'callout-note' },
  TIP: { icon: '💡', className: 'callout-tip' },
  WARNING: { icon: '⚠️', className: 'callout-warning' },
  CAUTION: { icon: '🚫', className: 'callout-caution' },
  IMPORTANT: { icon: '❗', className: 'callout-important' },
};

/**
 * Callout 标注块组件
 * 支持 NOTE/TIP/WARNING/CAUTION/IMPORTANT 五种类型，可就地编辑和删除
 */
const CalloutBlock: React.FC<CalloutBlockProps> = ({
  calloutType,
  title,
  bodyText,
  bodyChildren,
  rawBodyMd,
  onEdit,
  onDelete,
}) => {
  const [editing, setEditing] = useState(false);
  const [editType, setEditType] = useState<CalloutType>(calloutType);
  const [editTitle, setEditTitle] = useState(title);
  const [editContent, setEditContent] = useState(rawBodyMd || bodyText || extractTextFromChildren(bodyChildren));

  const config = TYPE_CONFIG[calloutType];

  const handleConfirmEdit = () => {
    onEdit?.(editType, editTitle, editContent);
    setEditing(false);
  };

  const handleCancelEdit = () => {
    setEditType(calloutType);
    setEditTitle(title);
    setEditContent(rawBodyMd || bodyText || extractTextFromChildren(bodyChildren));
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="callout-edit-form">
        <div className="flex items-center gap-2 mb-2">
          <label className="text-[12px] text-content-tertiary">类型</label>
          <select
            value={editType}
            onChange={(e) => setEditType(e.target.value as CalloutType)}
            className="text-[13px] px-2 py-1 rounded border border-edge-light bg-surface text-content"
          >
            <option value="NOTE">NOTE</option>
            <option value="TIP">TIP</option>
            <option value="WARNING">WARNING</option>
            <option value="CAUTION">CAUTION</option>
            <option value="IMPORTANT">IMPORTANT</option>
          </select>
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="标题（可选）"
            className="flex-1 text-[13px] px-2 py-1 rounded border border-edge-light bg-surface text-content outline-none focus:border-accent"
          />
        </div>
        <textarea
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          placeholder="内容..."
          rows={3}
          className="w-full text-[13px] px-2 py-1.5 rounded border border-edge-light bg-surface text-content outline-none focus:border-accent resize-y font-mono"
        />
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={handleCancelEdit}
            className="px-3 py-1 text-[12px] rounded-md text-content-secondary hover:bg-surface-hover transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirmEdit}
            className="px-3 py-1 text-[12px] rounded-md bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            确认
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`callout ${config.className}`}>
      <div className="flex items-start gap-2">
        <span className="text-[14px] mt-0.5 shrink-0">{config.icon}</span>
        <div className="flex-1 min-w-0">
          {title && (
            <p className="font-semibold text-[14px] mb-1">{title}</p>
          )}
          <div className="text-[14px] text-content-secondary callout-body">
            {bodyText && <p className="whitespace-pre-wrap">{bodyText}</p>}
            {bodyChildren}
          </div>
        </div>
      </div>
      <div className="callout-actions">
        <button
          onClick={() => setEditing(true)}
          title="编辑 callout"
          className="p-1 rounded hover:bg-surface-hover text-content-muted hover:text-content transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        </button>
        <button
          onClick={() => onDelete?.()}
          title="删除 callout"
          className="p-1 rounded hover:bg-surface-hover text-content-muted hover:text-danger transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  );
};

/**
 * 递归提取 React 子节点中的纯文本
 * @param children React 子节点
 * @returns 拼接后的文本
 */
function extractTextFromChildren(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (!children) return '';

  return React.Children.toArray(children).map((child) => {
    if (typeof child === 'string') return child;
    if (typeof child === 'number') return String(child);
    if (React.isValidElement(child)) {
      const props = child.props as { children?: React.ReactNode };
      return extractTextFromChildren(props.children);
    }
    return '';
  }).join('\n');
}

export default CalloutBlock;
