import React from 'react';
import { useToc } from './useToc';

/** 目录组件属性 */
interface TocProps {
  /** Markdown 文本内容 */
  content: string;
}

/**
 * 文档目录（TOC）侧边栏组件
 * 展示当前文档的标题层级，支持点击跳转和高亮当前标题
 */
const Toc: React.FC<TocProps> = ({ content }) => {
  const { items, activeId, scrollToHeading } = useToc(content);

  if (items.length === 0) return null;

  return (
    <aside className="h-full shrink-0 border-l border-edge bg-surface-tertiary overflow-y-auto py-5 px-3 shadow-[inset_4px_0_12px_rgba(0,0,0,0.05)]" style={{ width: 'var(--toc-width)' }}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-content-muted mb-3 select-none">
        目录
      </h3>
      <nav className="flex flex-col gap-0.5">
        {items.map(h => (
          <a
            key={h.id}
            href={`#${h.id}`}
            title={h.text}
            className={`
              block py-1 text-[12px] leading-snug truncate
              transition-colors duration-150
              hover:text-content
              ${h.id === activeId
                ? 'text-accent font-medium'
                : 'text-content-tertiary'
              }
            `}
            style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
            onClick={(e) => {
              e.preventDefault();
              scrollToHeading(h.id);
            }}
          >
            {h.text}
          </a>
        ))}
      </nav>
    </aside>
  );
};

export default Toc;
