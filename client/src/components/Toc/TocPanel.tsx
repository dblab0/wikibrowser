import React from 'react';
import type { TocItem } from './useToc';

/** 目录面板属性 */
interface TocPanelProps {
  /** 目录项列表 */
  items: TocItem[];
  /** 当前活跃标题 ID */
  activeId: string | null;
  /** 跳转到指定标题的回调 */
  onJump: (id: string) => void;
}

/** 目录浮动面板组件 */
const TocPanel: React.FC<TocPanelProps> = ({ items, activeId, onJump }) => {
  return (
    <div className="toc-panel">
      <div className="toc-panel-title">目录</div>
      <div className="toc-panel-list">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <div
              key={item.id}
              className={`toc-item${isActive ? ' active' : ''}`}
              style={{ paddingLeft: 12 + (item.level - 1) * 12 }}
              onClick={() => onJump(item.id)}
              title={item.text}
            >
              {item.text}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TocPanel;
