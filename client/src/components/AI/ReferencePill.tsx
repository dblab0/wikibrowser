import React from 'react';
import type { FileReference } from '@shared/types';

/** 文件引用标签属性 */
interface ReferencePillProps {
  /** 文件引用数据 */
  reference: FileReference;
  /** 是否可移除 */
  removable?: boolean;
  /** 移除回调 */
  onRemove?: (id: string) => void;
}

/** 从完整路径中提取文件名 */
function getFileName(filePath: string): string {
  const parts = filePath.split('/');
  return parts[parts.length - 1] || filePath;
}

/** 格式化行号范围显示 */
function formatLineRange(startLine: number, endLine: number): string {
  return `L${startLine}-L${endLine}`;
}

/**
 * 文件引用标签组件
 * 以紧凑的药丸形式展示引用的文件路径和行号范围
 */
const ReferencePill: React.FC<ReferencePillProps> = ({ reference, removable = false, onRemove }) => {
  const fileName = getFileName(reference.filePath);
  const lineRange = formatLineRange(reference.startLine, reference.endLine);
  const previewText = reference.selectedText.length > 200
    ? reference.selectedText.slice(0, 200) + '…'
    : reference.selectedText;

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove?.(reference.id);
  };

  return (
    <div
      className="reference-pill inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border cursor-default transition-colors"
      style={{
        background: 'var(--accent-light)',
        borderColor: 'var(--accent)',
        color: 'var(--accent-text)',
      }}
      title={reference.selectedText ? `${reference.filePath}\n\n${previewText}` : reference.filePath}
    >
      <span className="truncate max-w-[200px]">
        {fileName} {lineRange}
      </span>
      {removable && (
        <button
          onClick={handleRemove}
          className="flex items-center justify-center w-4 h-4 rounded hover:bg-foreground/10 transition-colors"
          aria-label="移除引用"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
};

export { ReferencePill };
