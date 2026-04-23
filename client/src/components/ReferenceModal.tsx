import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '../stores/app';
import { getFileContent } from '../services/api';
import { copyToClipboard } from '../services/clipboard';
import { getLanguageFromFilename } from './Content/syntax-languages';

/** 引用行的数据结构 */
interface LineData {
  lineNumber: number;
  content: string;
  highlighted: boolean;
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

const CloseIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </svg>
);

// ===== Shiki 代码高亮器（带行号）=====
let shikiHighlighter: any = null;
let shikiLoadPromise: Promise<any> | null = null;

/**
 * 异步加载 Shiki 高亮器实例（单例模式）
 * @returns Shiki 高亮器实例
 */
async function loadShikiHighlighter(): Promise<any> {
  if (shikiHighlighter) return shikiHighlighter;
  if (shikiLoadPromise) return shikiLoadPromise;

  // 使用 streamdown 内置的 shiki
  shikiLoadPromise = import('streamdown').then(async (streamdown) => {
    // 尝试从 streamdown 的上下文获取 shiki，或直接加载
    try {
      const shiki = await import('shiki');
      shikiHighlighter = await shiki.createHighlighter({
        themes: ['one-light', 'one-dark-pro'],
        langs: ['typescript', 'javascript', 'python', 'json', 'bash', 'css', 'scss', 'sql', 'yaml', 'markdown', 'java', 'cpp', 'c', 'go', 'rust', 'tsx', 'html', 'xml', 'vue', 'jsx', 'dockerfile', 'toml', 'ini', 'diff', 'makefile', 'graphql', 'svelte', 'kotlin', 'swift', 'r', 'lua', 'php', 'ruby', 'scala', 'dart', 'elixir', 'hcl'],
      });
      return shikiHighlighter;
    } catch {
      // 降级方案：streamdown 内部已包含 shiki
      return null;
    }
  });

  return shikiLoadPromise;
}

/** Shiki 代码查看器属性 */
interface ShikiCodeViewerProps {
  /** 代码内容 */
  code: string;
  /** 编程语言 */
  language: string;
  /** 是否为深色主题 */
  isDark: boolean;
  /** 需要高亮的行号集合 */
  highlightLines?: Set<number>;
  /** 起始行号 */
  startLineNumber?: number;
}

/**
 * 基于 Shiki 的代码语法高亮查看器
 * 支持行号显示和指定行高亮
 */
const ShikiCodeViewer: React.FC<ShikiCodeViewerProps> = ({ code, language, isDark, highlightLines, startLineNumber = 1 }) => {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);

  useEffect(() => {
    loadShikiHighlighter().then((highlighter) => {
      if (!highlighter) {
        // 降级为纯文本 + 行号
        const escaped = code.split('\n').map((line, i) => {
          const lineNum = startLineNumber + i;
          const isHighlighted = highlightLines?.has(lineNum);
          return `<div class="code-line${isHighlighted ? ' highlighted' : ''}"><span class="line-number">${lineNum}</span><span class="line-content">${escapeHtml(line)}</span></div>`;
        }).join('');
        setHighlightedHtml(escaped);
        return;
      }

      try {
        const html = highlighter.codeToHtml(code, {
          lang: language || 'text',
          theme: isDark ? 'one-dark-pro' : 'one-light',
        });

        // 解析 HTML 并添加行号和高亮
        const lines = code.split('\n');
        const processedHtml = processShikiHtml(html, lines, startLineNumber, highlightLines, isDark);
        setHighlightedHtml(processedHtml);
      } catch {
        const escaped = code.split('\n').map((line, i) => {
          const lineNum = startLineNumber + i;
          const isHighlighted = highlightLines?.has(lineNum);
          return `<div class="code-line${isHighlighted ? ' highlighted' : ''}"><span class="line-number">${lineNum}</span><span class="line-content">${escapeHtml(line)}</span></div>`;
        }).join('');
        setHighlightedHtml(escaped);
      }
    });
  }, [code, language, isDark, highlightLines, startLineNumber]);

  if (!highlightedHtml) {
    return <div className="shiki-loading">加载代码...</div>;
  }

  return (
    <div
      className="shiki-code-viewer"
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  );
};

/**
 * 转义 HTML 特殊字符
 * @param text 原始文本
 * @returns 转义后的安全文本
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 处理 Shiki 输出的 HTML，添加行号和高亮标记
 * @param html Shiki 生成的原始 HTML
 * @param lines 代码行数组
 * @param startLineNumber 起始行号
 * @param highlightLines 需要高亮的行号集合
 * @param isDark 是否为深色主题
 * @returns 处理后的 HTML 字符串
 */
function processShikiHtml(html: string, lines: string[], startLineNumber: number, highlightLines?: Set<number>, isDark?: boolean): string {
  // Shiki 输出 <pre><code> 结构，每个 token 用 span 包裹
  // 需要拆分为行并添加行号
  const highlightBg = isDark ? 'rgba(0, 100, 100, 0.3)' : 'rgba(200, 230, 200, 0.5)';

  // 从 Shiki 输出中提取代码内容
  const codeMatch = html.match(/<code[^>]*>(.*?)<\/code>/s);
  if (!codeMatch) return html;

  const codeContent = codeMatch[1];
  // 按 HTML 中的换行符拆分（Shiki 使用真实换行）
  const htmlLines = codeContent.split('\n');

  const processedLines = htmlLines.map((lineHtml, i) => {
    const lineNum = startLineNumber + i;
    const isHighlighted = highlightLines?.has(lineNum);
    const bgStyle = isHighlighted ? `background: ${highlightBg}` : '';

    return `<div class="shiki-line" style="${bgStyle}"><span class="shiki-line-num">${lineNum}</span><span class="shiki-line-content">${lineHtml || ' '}</span></div>`;
  });

  return `<pre class="shiki-pre"><code>${processedLines.join('\n')}</code></pre>`;
}

/**
 * 引用源码查看弹窗
 * 展示 AI 对话中引用的代码片段，支持语法高亮和行高亮
 */
const ReferenceModal: React.FC = () => {
  const referenceOpen = useAppStore((s) => s.referenceOpen);
  const referenceData = useAppStore((s) => s.referenceData);
  const closeReference = useAppStore((s) => s.closeReference);

  const [lines, setLines] = useState<LineData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const language = useMemo(() => {
    if (!referenceData?.filePath) return 'text';
    return getLanguageFromFilename(referenceData.filePath);
  }, [referenceData?.filePath]);

  useEffect(() => {
    if (referenceOpen && referenceData) {
      loadContent();
    }
  }, [referenceOpen, referenceData]);

  const loadContent = async () => {
    if (!referenceData) return;

    setLoading(true);
    setError(null);

    try {
      const data = await getFileContent(
        referenceData.filePath,
        referenceData.startLine,
        referenceData.endLine
      );
      setLines(data.lines);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载文件失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyContent = useCallback(async () => {
    if (lines.length === 0) return;
    const content = lines.map(line => line.content).join('\n');
    const success = await copyToClipboard(content);
    if (success) {
      setCopied(true);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    }
  }, [lines]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const highlightStart = referenceData?.startLine ?? 0;
  const highlightEnd = referenceData?.endLine ?? 0;
  const hasHighlight = highlightStart > 0 && highlightEnd > 0;

  // 计算需要高亮的行号（1-based in code content）
  const highlightLines = useMemo(() => {
    if (!hasHighlight) return new Set<number>();
    const set = new Set<number>();
    for (let i = highlightStart; i <= highlightEnd; i++) {
      set.add(i);
    }
    return set;
  }, [hasHighlight, highlightStart, highlightEnd]);

  if (!referenceOpen) return null;

  const code = lines.map(l => l.content).join('\n');
  const startLineNumber = lines.length > 0 ? lines[0].lineNumber : 1;

  return (
    <div className="overlay overlay-centered" onClick={closeReference}>
      <div
        className={`flex flex-col overflow-hidden rounded-xl shadow-2xl ${isDark ? 'bg-[#1e1e2e]' : 'bg-white'}`}
        style={{ width: 'min(85vw, 720px)', maxHeight: '70vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${isDark ? 'border-[#333]' : 'border-gray-200'}`}>
          <div>
            <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {referenceData?.filePath}
            </div>
            {referenceData?.startLine && referenceData?.endLine && (
              <div className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                L{referenceData.startLine}-L{referenceData.endLine}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* 复制按钮 */}
            <button
              onClick={handleCopyContent}
              disabled={loading || error !== null || lines.length === 0}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px]
                transition-all duration-150
                ${copied
                  ? 'bg-success text-white border border-success'
                  : `${isDark ? 'border-[#444] text-gray-400 hover:text-gray-200' : 'border-gray-300 text-gray-500 hover:text-gray-700'} border`
                }
                ${(loading || error !== null || lines.length === 0) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
              title="复制内容"
            >
              {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              {copied ? '已复制' : '复制'}
            </button>

            {/* 关闭按钮 */}
            <button
              onClick={closeReference}
              className={`p-1.5 rounded-md cursor-pointer ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-gray-400 hover:text-gray-600'}`}
              title="关闭"
            >
              <CloseIcon size={20} />
            </button>
          </div>
        </div>

        {/* 带语法高亮的内容区 */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className={`text-center py-10 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              加载中...
            </div>
          ) : error ? (
            <div className={`text-center py-10 ${isDark ? 'text-red-400' : 'text-red-500'}`}>
              {error}
            </div>
          ) : code ? (
            <ShikiCodeViewer
              code={code}
              language={language}
              isDark={isDark}
              highlightLines={highlightLines}
              startLineNumber={startLineNumber}
            />
          ) : null}
        </div>
      </div>

      {/* Shiki 查看器样式 */}
      <style>{`
        .shiki-loading {
          padding: 20px;
          text-align: center;
          color: ${isDark ? '#888' : '#666'};
        }
        .shiki-code-viewer {
          font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
          font-size: 13px;
          line-height: 1;
        }
        .shiki-pre {
          margin: 0;
          padding: 16px 20px;
          background: ${isDark ? '#1e1e2e' : '#fafafa'};
        }
        .shiki-pre code {
          display: block;
        }
        .shiki-line {
          display: flex;
          min-height: 1em;
        }
        .shiki-line.highlighted {
          background: ${isDark ? 'rgba(0, 100, 100, 0.3)' : 'rgba(200, 230, 200, 0.5)'};
        }
        .shiki-line-num {
          display: inline-block;
          min-width: 3.5em;
          padding-right: 1.5em;
          color: ${isDark ? '#555' : '#bbb'};
          text-align: right;
          user-select: none;
          opacity: 0.6;
        }
        .shiki-line-content {
          flex: 1;
        }
      `}</style>
    </div>
  );
};

export default ReferenceModal;