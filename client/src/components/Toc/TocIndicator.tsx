import React, { useState } from 'react';
import type { TocItem } from './useToc';
import TocPanel from './TocPanel';

/** 目录指示器属性 */
interface TocIndicatorProps {
  /** 目录项列表 */
  items: TocItem[];
  /** 当前活跃标题 ID */
  activeId: string | null;
  /** 跳转到指定标题的回调 */
  onJump: (id: string) => void;
}

/**
 * 根据内容长度计算指示点大小
 * @param contentLength 内容长度
 * @returns 指示点直径（像素）
 */
function getDotSize(contentLength: number): number {
  if (contentLength > 2000) return 8;
  if (contentLength > 500) return 6;
  return 4;
}

/**
 * 目录指示器组件
 * 以圆点条形式展示目录结构，悬停展开为完整目录面板
 */
const TocIndicator: React.FC<TocIndicatorProps> = ({ items, activeId, onJump }) => {
  const [hovered, setHovered] = useState(false);

  if (items.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: 'var(--header-height)',
        bottom: 0,
        width: hovered ? 280 : 40,
        zIndex: 98,
        transition: 'width 0.15s ease',
      }}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 圆点指示条 */}
      <div
        className="toc-indicator"
        onMouseEnter={() => setHovered(true)}
      >
        {items.map((item) => {
          const size = getDotSize(item.contentLength);
          const isActive = item.id === activeId;
          return (
            <div
              key={item.id}
              className={`toc-dot${isActive ? ' active' : ''}`}
              onClick={() => onJump(item.id)}
              title={item.text}
            >
              <span
                style={{
                  display: 'block',
                  width: size,
                  height: size,
                  borderRadius: '50%',
                  backgroundColor: isActive ? 'var(--accent)' : 'var(--text-muted)',
                  transition: 'background-color 0.15s, transform 0.15s',
                  cursor: 'pointer',
                }}
              />
            </div>
          );
        })}
      </div>

      {/* 浮动目录面板 */}
      {hovered && (
        <TocPanel
          items={items}
          activeId={activeId}
          onJump={(id) => {
            onJump(id);
            setHovered(false);
          }}
        />
      )}
    </div>
  );
};

export default TocIndicator;
