import React, { useEffect, useRef, useState, useCallback } from 'react';
import mermaid from 'mermaid';
import { useAppStore } from '../../stores/app';
import { copyToClipboard } from '../../services/clipboard';

/** Mermaid 图表块属性 */
interface MermaidBlockProps {
  /** Mermaid 图表代码 */
  chart: string;
}

// ===== 图标组件 =====
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

// ===== 展开图标 =====
const ExpandIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

let mermaidInitialized = false;

/**
 * 获取当前 Mermaid 主题配置
 * @returns 'dark' 或 'default'
 */
function getMermaidTheme(): 'dark' | 'default' {
  const theme = document.documentElement.getAttribute('data-theme');
  return theme === 'dark' ? 'dark' : 'default';
}

/**
 * Mermaid 图表渲染组件
 * 将 Mermaid 代码渲染为 SVG，支持复制源码和全屏预览
 */
const MermaidBlock: React.FC<MermaidBlockProps> = ({ chart }) => {
  const instanceId = useRef(`mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).current;
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const openMermaidViewer = useAppStore((s) => s.openMermaidViewer);

  useEffect(() => {
    if (!mermaidInitialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme: getMermaidTheme(),
        securityLevel: 'loose',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
        flowchart: {
          useMaxWidth: true,
          htmlLabels: true,
          curve: 'basis',
        },
        sequence: {
          useMaxWidth: true,
          diagramMarginX: 10,
          diagramMarginY: 10,
        },
        gantt: {
          useMaxWidth: true,
        },
      });
      mermaidInitialized = true;
    }

    let cancelled = false;

    async function renderChart() {
      try {
        const id = instanceId;
        const theme = getMermaidTheme();

        mermaid.initialize({
          startOnLoad: false,
          theme,
          securityLevel: 'loose',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
          flowchart: {
            useMaxWidth: true,
            htmlLabels: true,
            curve: 'basis',
          },
          sequence: {
            useMaxWidth: true,
            diagramMarginX: 10,
            diagramMarginY: 10,
          },
          gantt: {
            useMaxWidth: true,
          },
        });

        const { svg: renderedSvg } = await mermaid.render(id, chart.trim());
        if (!cancelled) {
          setSvg(renderedSvg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Mermaid 渲染失败');
          setSvg('');
        }
      }
    }

    renderChart();

    return () => {
      cancelled = true;
    };
  }, [chart]);

  const handleCopy = useCallback(async () => {
    const success = await copyToClipboard(chart.trim());
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [chart]);

  const handleClick = useCallback(() => {
    if (svg) {
      openMermaidViewer(svg, chart.trim());
    }
  }, [svg, chart, openMermaidViewer]);

  if (error) {
    return <div className="mermaid-error">{error}</div>;
  }

  return (
    <div
      className="mermaid-container"
      ref={containerRef}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      style={{ position: 'relative' }}
    >
      {/* 操作按钮 */}
      <div
        className="mermaid-actions"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          display: 'flex',
          gap: 4,
          opacity: isHovering ? 1 : 0,
          transition: 'opacity 0.15s ease',
          zIndex: 20,
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleCopy();
          }}
          className="mermaid-action-btn"
          title="复制 Mermaid 代码"
        >
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleClick();
          }}
          className="mermaid-action-btn"
          title="查看大图"
        >
          <ExpandIcon size={12} />
        </button>
      </div>

      {/* Mermaid 图表内容（可点击） */}
      <div
        onClick={handleClick}
        style={{
          cursor: 'pointer',
          userSelect: 'none',
        }}
        title="点击查看大图"
      >
        {svg && (
          <div
            className="mermaid-svg-wrapper"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </div>
    </div>
  );
};

export default MermaidBlock;
