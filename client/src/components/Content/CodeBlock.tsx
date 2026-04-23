import React, { useState, useCallback, ReactNode } from 'react';
import { copyToClipboard } from '../../services/clipboard';
import { ShikiCodeBlock } from '../AI/StreamdownRenderer';

/** 代码块属性 */
interface CodeBlockProps {
  /** 子节点 */
  children: ReactNode;
  /** 原始代码文本 */
  rawCode?: string;
  /** 编程语言 */
  language?: string;
}

// ===== 复制图标 =====
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
 * 从 ReactNode 中提取文本内容
 * @param node React 节点
 * @returns 提取的纯文本
 */
function extractTextContent(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';

  if (Array.isArray(node)) {
    return node.map(extractTextContent).join('');
  }

  if (typeof node === 'object' && 'props' in node) {
    return extractTextContent(node.props.children);
  }

  return '';
}

/**
 * 代码块组件
 * 支持 Shiki 语法高亮和一键复制
 */
const CodeBlock: React.FC<CodeBlockProps> = ({ children, rawCode, language }) => {
  const [copied, setCopied] = useState(false);
  const code = rawCode ?? extractTextContent(children);
  const lang = language || 'text';
  const trimmedCode = code.replace(/\n$/, '');

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(trimmedCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [trimmedCode]);

  return (
    <div className="group/code relative">
      <ShikiCodeBlock code={trimmedCode} language={lang} />
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-surface-secondary/80 border border-edge-light text-content-tertiary opacity-0 group-hover/code:opacity-100 transition-all duration-150 hover:bg-surface-hover hover:text-content cursor-pointer"
        title={copied ? '已复制' : '复制代码'}
        type="button"
      >
        {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      </button>
    </div>
  );
};

export default CodeBlock;
