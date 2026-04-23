import React, { useMemo, useState, useCallback } from 'react';
import { Streamdown, CodeBlock, type BundledTheme } from 'streamdown';
import { code as codePlugin } from '@streamdown/code';
import { copyToClipboard } from '../../services/clipboard';

/** Streamdown 渲染器属性 */
interface StreamdownRendererProps {
  /** Markdown 文本内容 */
  content: string;
  /** 是否正在流式传输 */
  streaming?: boolean;
}

// Light theme for light mode, dark theme for dark mode
const LIGHT_THEME: BundledTheme = 'one-light';
const DARK_THEME: BundledTheme = 'one-dark-pro';
const THEME_PAIR: [BundledTheme, BundledTheme] = [LIGHT_THEME, DARK_THEME];

const PLUGINS = { code: codePlugin };
// 隐藏 Streamdown 内置的复制/下载按钮
const CONTROLS = { code: { copy: false, download: false } };

// ===== Copy Icon =====
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
 * Streamdown Markdown 流式渲染器
 * 基于 streamdown 库实现 Markdown 实时渲染，支持代码高亮和一键复制
 */
const StreamdownRenderer: React.FC<StreamdownRendererProps> = ({ content, streaming }) => {
  // Determine mode based on streaming prop
  const mode = streaming ? 'streaming' : 'static';
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(content);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [content]);

  const renderedContent = useMemo(() => {
    if (!content) return null;

    return (
      <Streamdown
        children={content}
        mode={mode}
        parseIncompleteMarkdown={streaming}
        shikiTheme={THEME_PAIR}
        plugins={PLUGINS}
        controls={CONTROLS}
      />
    );
  }, [content, mode, streaming]);

  if (!content) {
    return null;
  }

  return (
    <div className="text-[14px] leading-[1.7] overflow-hidden">
      <div className="group/code relative">
        {renderedContent}
        {!streaming && (
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 p-1.5 rounded-md
              bg-surface-secondary/80 border border-edge-light text-content-tertiary
              opacity-0 group-hover/code:opacity-100 transition-all duration-150
              hover:bg-surface-hover hover:text-content cursor-pointer z-10"
            title={copied ? '已复制' : '复制代码'}
            type="button"
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </button>
        )}
      </div>
    </div>
  );
};

// Export ShikiCodeBlock for use in MarkdownRenderer
// This wraps Streamdown's built-in code highlighting
interface ShikiCodeBlockProps {
  code: string;
  language: string;
  filename?: string;
}

const ShikiCodeBlock: React.FC<ShikiCodeBlockProps> = ({ code, language, filename }) => {
  // Create a markdown code block string and render it with Streamdown
  const codeMarkdown = useMemo(() => {
    const lang = language || 'text';
    return `\`\`\`${filename ? `${lang} ${filename}` : lang}\n${code}\n\`\`\``;
  }, [code, language, filename]);

  return (
    <Streamdown
      children={codeMarkdown}
      mode="static"
      shikiTheme={THEME_PAIR}
      plugins={PLUGINS}
      controls={CONTROLS}
    />
  );
};

export default StreamdownRenderer;
export { ShikiCodeBlock };
