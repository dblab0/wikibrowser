import React, { useState, useCallback, useRef } from 'react';
import { useAppStore } from '../stores/app';

// ===== 图标组件 =====
const CloseIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </svg>
);

const ZoomInIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

const ZoomOutIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </svg>
);

const FitScreenIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
  </svg>
);

/**
 * Mermaid 图表全屏预览弹窗
 * 支持缩放、拖拽移动和滚轮缩放
 */
const MermaidViewerModal: React.FC = () => {
  const mermaidViewerOpen = useAppStore((s) => s.mermaidViewerOpen);
  const mermaidViewerData = useAppStore((s) => s.mermaidViewerData);
  const closeMermaidViewer = useAppStore((s) => s.closeMermaidViewer);

  const [scale, setScale] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleZoomIn = useCallback(() => {
    setScale((s) => Math.min(s * 1.2, 10));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((s) => Math.max(s / 1.2, 0.3));
  }, []);

  const handleResetZoom = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  }, [position]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale((s) => Math.max(0.3, Math.min(10, s * delta)));
  }, []);

  if (!mermaidViewerOpen || !mermaidViewerData) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex flex-col animate-fade-in"
      style={{
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={closeMermaidViewer}
    >
      {/* 头部工具栏 */}
      <div
        className="
          flex items-center justify-between
          px-4 py-3
          bg-surface-secondary border-b border-edge
          shrink-0
        "
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左侧标题 */}
        <div className="flex items-center gap-2">
          <span className="text-content text-[15px] font-semibold">
            图表预览
          </span>
          <span className="text-content-tertiary text-[13px] font-medium px-2 py-0.5 bg-surface-tertiary rounded">
            {Math.round(scale * 100)}%
          </span>
        </div>

        {/* 右侧控制按钮 */}
        <div className="flex items-center gap-1.5">
          {/* 缩放控制组 */}
          <div className="flex items-center gap-px bg-surface-tertiary rounded-lg p-0.5">
            <ToolbarButton onClick={handleZoomOut} title="缩小 (-)">
              <ZoomOutIcon size={16} />
            </ToolbarButton>
            <ToolbarButton onClick={handleResetZoom} title="适应屏幕 (0)">
              <FitScreenIcon size={16} />
            </ToolbarButton>
            <ToolbarButton onClick={handleZoomIn} title="放大 (+)">
              <ZoomInIcon size={16} />
            </ToolbarButton>
          </div>

          <div className="w-px h-5 bg-edge mx-1" />

          {/* 关闭按钮 */}
          <button
            onClick={closeMermaidViewer}
            className="
              p-2 border-none rounded-lg
              text-content-secondary cursor-pointer
              hover:bg-surface-tertiary hover:text-content
              transition-colors duration-150
            "
            title="关闭 (Esc)"
          >
            <CloseIcon size={18} />
          </button>
        </div>
      </div>

      {/* 内容区域 */}
      <div
        ref={containerRef}
        className="
          flex-1 overflow-hidden
          flex items-center justify-center
          p-4
        "
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div
          style={{
            transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})`,
            willChange: 'transform',
            transition: isDragging ? 'none' : 'transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
          className="
            bg-surface-secondary rounded-xl p-3
            max-w-[calc(100vw-32px)] max-h-[calc(100vh-120px)]
            overflow-auto
          "
          onClick={(e) => e.stopPropagation()}
          dangerouslySetInnerHTML={{ __html: mermaidViewerData.svg }}
        />
      </div>

      {/* 底部提示 */}
      <div
        className="
          absolute bottom-5 left-1/2 -translate-x-1/2
          px-4 py-2 rounded-full
          bg-black/60 backdrop-blur-sm
          text-white/90 text-[12px]
          pointer-events-none
          flex items-center gap-3
        "
      >
        <HintItem>滚轮缩放</HintItem>
        <HintDivider />
        <HintItem>拖拽移动</HintItem>
        <HintDivider />
        <HintItem>点击背景关闭</HintItem>
      </div>
    </div>
  );
};

// ===== 子组件 =====

/** 工具栏按钮 */
const ToolbarButton: React.FC<{
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ onClick, title, children }) => (
  <button
    onClick={onClick}
    title={title}
    className="
      p-1.5 px-2.5 border-none rounded-md
      bg-transparent text-content-secondary
      cursor-pointer
      hover:bg-surface-secondary hover:text-content
      transition-colors duration-150
      flex items-center justify-center
    "
  >
    {children}
  </button>
);

/** 提示文本项 */
const HintItem: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="whitespace-nowrap">{children}</span>
);

/** 提示项分隔符 */
const HintDivider: React.FC = () => (
  <span className="w-1 h-1 rounded-full bg-white/40" />
);

export default MermaidViewerModal;
