import React, { useCallback, useMemo, useRef, useState, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
const MermaidBlock = React.lazy(() => import('./MermaidBlock'));
import CodeBlock from './CodeBlock';
import CalloutBlock from './CalloutBlock';
import FloatingToolbar from './FloatingToolbar';
import { useAppStore } from '../../stores/app';
import { useAIStore } from '../../stores/ai';
import { getPage } from '../../services/api';
import { parseCallout } from '../../utils/callout-parser';
import type { CalloutType } from '../../utils/callout-parser';
import { patchMarkdown } from '../../utils/markdown-patcher';
import { getLineRangeFromSelection } from '../../utils/line-range';
import type { Components } from 'react-markdown';

/** Markdown 渲染器属性 */
interface MarkdownRendererProps {
  /** Markdown 文本内容 */
  content: string;
}

/**
 * 根据标题文本生成 URL 安全的 ID
 * @param text 标题文本
 * @returns 生成的 ID 字符串
 */
function generateHeadingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'heading';
}

/**
 * 递归提取 ReactNode 中的纯文本
 * @param children React 子节点
 * @returns 提取的纯文本字符串
 */
function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (React.isValidElement(children) && children.props.children) {
    return extractText(children.props.children);
  }
  return '';
}

/**
 * 创建带 ID 和行号标记的标题组件
 * @param tag HTML 标签名（h1-h6）
 */
function createHeadingComponent(tag: string) {
  const Component: React.FC<{ node?: any; children?: React.ReactNode }> = ({ node, children }) => {
    const text = extractText(children);
    const id = generateHeadingId(text);
    const startLine = node?.position?.start?.line;
    return React.createElement(tag, { id, 'data-source-line': startLine }, children);
  };
  Component.displayName = `Heading_${tag}`;
  return Component;
}

const HeadingH1 = createHeadingComponent('h1');
const HeadingH2 = createHeadingComponent('h2');
const HeadingH3 = createHeadingComponent('h3');
const HeadingH4 = createHeadingComponent('h4');
const HeadingH5 = createHeadingComponent('h5');
const HeadingH6 = createHeadingComponent('h6');

/**
 * 模块级链接点击处理函数
 * 通过 getState() 获取最新 store 值，避免 useMemo 闭包过期
 * @param href 链接地址
 * @param e 鼠标事件
 */
async function handleLinkClick(href: string, e: React.MouseEvent) {
  e.preventDefault();

  const { currentView, projects, setCurrentView, setLoadingPage, openReference } =
    useAppStore.getState();

  // 解析链接格式：filePath#L57-L68 或 filePath#L57 或 filePath
  const match = href.match(/^(.+?)(?:#L(\d+)(?:-L(\d+))?)?$/);
  if (!match) {
    window.open(href, '_blank');
    return;
  }

  const [, rawPath, startLine, endLine] = match;

  // 外部 URL（http://, https://）→ 新标签页打开
  if (/^https?:\/\//.test(rawPath)) {
    window.open(rawPath, '_blank');
    return;
  }

  // 规范化路径：去掉 ./ 前缀，处理 ../
  let filePath = rawPath;
  while (filePath.startsWith('./')) {
    filePath = filePath.slice(2);
  }
  if (filePath.includes('../')) {
    filePath = filePath.split('/').pop() || filePath;
  }

  // Windows 绝对路径 → 文件引用
  if (/^[A-Za-z]:\\/.test(filePath)) {
    openReference(
      filePath,
      startLine ? parseInt(startLine, 10) : undefined,
      endLine ? parseInt(endLine, 10) : undefined,
    );
    return;
  }

  // 判断链接特征
  const hasExtension = /\.[^/.\\]+$/.test(filePath);
  const isMdFile = filePath.endsWith('.md');

  // 非 .md 但有扩展名 → 文件引用（如 .ts, .json）
  if (hasExtension && !isMdFile) {
    if (!currentView) return;
    const currentProject = projects.find((p) => p.id === currentView.projectId);
    if (!currentProject) return;

    const absolutePath = filePath.startsWith('/')
      ? filePath
      : `${currentProject.path}/${rawPath}`;
    openReference(
      absolutePath,
      startLine ? parseInt(startLine, 10) : undefined,
      endLine ? parseInt(endLine, 10) : undefined,
    );
    return;
  }

  // 检查是否为已知的 wiki 页面 slug
  const { currentWiki } = useAppStore.getState();
  if (!currentView || !currentWiki) return;

  // 规范化 slug：去掉前导 /，去掉 .md 后缀
  let slug = filePath;
  if (slug.startsWith('/')) slug = slug.slice(1);
  if (isMdFile) slug = slug.slice(0, -3);

  const isKnownWikiPage = currentWiki.pages.some(
    (p) => p.slug === slug || p.slug.toLowerCase() === slug.toLowerCase()
  );

  if (!isKnownWikiPage) {
    // 不是已知 wiki 页面 → 作为文件引用弹窗打开
    const currentProject = projects.find((p) => p.id === currentView.projectId);
    if (!currentProject) return;
    const absolutePath = filePath.startsWith('/')
      ? filePath
      : `${currentProject.path}/${rawPath}`;
    openReference(
      absolutePath,
      startLine ? parseInt(startLine, 10) : undefined,
      endLine ? parseInt(endLine, 10) : undefined,
    );
    return;
  }

  // 已知 wiki 页面 → 导航
  setLoadingPage(true);
  try {
    const data = await getPage(currentView.projectId, currentView.version, slug);
    setCurrentView({
      ...currentView,
      slug,
      content: data.content,
      fileMtime: data.mtime,
    });
  } finally {
    setLoadingPage(false);
  }
}

/**
 * Markdown 渲染器组件
 * 将 Markdown 文本渲染为富文本 HTML，支持代码高亮、Mermaid 图表、Callout 标注块和链接导航
 */
const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const markdownRef = useRef<HTMLDivElement>(null);
  const [floatingToolbar, setFloatingToolbar] = useState<{
    top: number;
    left: number;
    selectedText: string;
  } | null>(null);

  const saveCalloutAction = useAppStore((s) => s.saveCalloutAction);

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      setFloatingToolbar(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const container = markdownRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) {
      setFloatingToolbar(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    setFloatingToolbar({
      top: rect.top + window.scrollY,
      left: rect.left + rect.width / 2,
      selectedText: selection.toString(),
    });
  }, []);

  const handleCalloutInsert = useCallback(async (calloutType: CalloutType) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const container = markdownRef.current;
    if (!container) return;

    const currentView = useAppStore.getState().currentView;
    if (!currentView) return;

    const totalLines = currentView.content.split('\n').length;
    const lineRange = getLineRangeFromSelection(range, container, totalLines);

    if (!lineRange) {
      console.error('无法从选区计算行范围');
      return;
    }

    const { startLine, endLine } = lineRange;

    const newContent = patchMarkdown(currentView.content, {
      type: 'insert',
      afterLine: endLine,
      calloutType,
      title: '',
      content: '',
    });

    setFloatingToolbar(null);
    selection.removeAllRanges();

    try {
      await saveCalloutAction(newContent);
    } catch (err) {
      console.error('插入 callout 失败:', err);
    }
  }, [saveCalloutAction]);

  const handleCalloutEdit = useCallback(async (
    startLine: number,
    endLine: number,
    calloutType: CalloutType,
    title: string,
    content: string
  ) => {
    const currentView = useAppStore.getState().currentView;
    if (!currentView) return;

    const newContent = patchMarkdown(currentView.content, {
      type: 'edit',
      startLine,
      endLine,
      calloutType,
      title,
      content,
    });

    try {
      await saveCalloutAction(newContent);
    } catch (err) {
      console.error('编辑 callout 失败:', err);
    }
  }, [saveCalloutAction]);

  const handleCalloutDelete = useCallback(async (startLine: number, endLine: number) => {
    const currentView = useAppStore.getState().currentView;
    if (!currentView) return;

    const newContent = patchMarkdown(currentView.content, {
      type: 'delete',
      startLine,
      endLine,
    });

    try {
      await saveCalloutAction(newContent);
    } catch (err) {
      console.error('删除 callout 失败:', err);
    }
  }, [saveCalloutAction]);

  const handleSendToAI = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const container = markdownRef.current;
    if (!container) return;

    const appState = useAppStore.getState();
    const { currentView, currentWiki } = appState;
    if (!currentView || !currentWiki) return;

    const totalLines = currentView.content.split('\n').length;
    const lineRange = getLineRangeFromSelection(range, container, totalLines);

    if (!lineRange) {
      console.error('无法从选区计算行范围');
      return;
    }

    // 查找当前页面对应的 WikiPage，获取文件路径
    const currentPage = currentWiki.pages.find((p) => p.slug === currentView.slug);
    if (!currentPage) {
      console.error('当前页面未在 wiki 页面列表中找到');
      return;
    }

    const selectedText = selection.toString();

    // 拼接项目相对路径：.zread/wiki/versions/{version}/{file}
    const filePath = `.zread/wiki/versions/${currentView.version}/${currentPage.file}`;

    const reference = {
      id: Date.now().toString(),
      filePath,
      startLine: lineRange.startLine,
      endLine: lineRange.endLine,
      selectedText,
    };

    useAIStore.getState().addReference(reference);

    setFloatingToolbar(null);
    selection.removeAllRanges();
  }, []);

  const components = useMemo<Components>(
    () => ({
      h1: HeadingH1,
      h2: HeadingH2,
      h3: HeadingH3,
      h4: HeadingH4,
      h5: HeadingH5,
      h6: HeadingH6,

      p({ node, children }) {
        const startLine = node?.position?.start?.line;
        return <p data-source-line={startLine}>{children}</p>;
      },

      blockquote({ node, children }) {
        const startLine = node?.position?.start?.line;
        const endLine = node?.position?.end?.line;

        const callout = parseCallout(children);
        if (callout) {
          // 从原始 markdown 源码提取 callout body 的原始文本，保留所有格式
          let rawBodyMd: string | undefined;
          if (startLine != null && endLine != null) {
            const lines = content.split('\n');
            // callout blockquote 每行以 "> " 开头，去掉前缀恢复原始 markdown body
            const bodyLines: string[] = [];
            let foundBodyStart = false;
            for (let i = startLine - 1; i < endLine && i < lines.length; i++) {
              const raw = lines[i];
              const unquoted = raw.replace(/^>\s?/, '');
              if (!foundBodyStart) {
                // 跳过第一行（包含 [!TYPE] title 的那一行）
                foundBodyStart = true;
                continue;
              }
              bodyLines.push(unquoted);
            }
            rawBodyMd = bodyLines.join('\n').trim();
          }

          return (
            <CalloutBlock
              calloutType={callout.calloutType}
              title={callout.title}
              bodyText={callout.bodyText}
              bodyChildren={callout.bodyChildren}
              rawBodyMd={rawBodyMd}
              startLine={startLine}
              endLine={endLine}
              onEdit={(type, title, content) =>
                handleCalloutEdit(startLine!, endLine!, type, title, content)
              }
              onDelete={() => handleCalloutDelete(startLine!, endLine!)}
            />
          );
        }

        return <blockquote data-source-line={startLine}>{children}</blockquote>;
      },

      ul({ node, children }) {
        const startLine = node?.position?.start?.line;
        return <ul data-source-line={startLine}>{children}</ul>;
      },

      ol({ node, children }) {
        const startLine = node?.position?.start?.line;
        return <ol data-source-line={startLine}>{children}</ol>;
      },

      table({ node, children }) {
        const startLine = node?.position?.start?.line;
        return <table data-source-line={startLine}>{children}</table>;
      },

      pre({ node, children }) {
        // 通过 AST 节点或 children 类型检测 mermaid 块，避免被 CodeBlock 包裹产生双复制按钮
        const codeNode = node?.children?.[0] as any;
        const langClass: string[] = codeNode?.properties?.className || [];
        const isMermaid = langClass.includes('language-mermaid') ||
          (React.isValidElement(children) && children.type === MermaidBlock);

        if (isMermaid) {
          return children;
        }

        // 从 className 中提取语言，如 "language-typescript" → "typescript"
        const langMatch = langClass.find((c: string) => c.startsWith('language-'));
        const language = langMatch ? langMatch.replace('language-', '') : undefined;

        const rawCode = React.isValidElement(children) && typeof children.props?.children === 'string'
          ? children.props.children
          : undefined;

        return <CodeBlock rawCode={rawCode} language={language}>{children}</CodeBlock>;
      },

      code({ className, children, ...props }) {
        const match = /language-(\w+)/.exec(className || '');
        const lang = match ? match[1] : '';
        const value = String(children).replace(/\n$/, '');

        if (lang === 'mermaid') {
          return (
            <Suspense fallback={<div className="mermaid-loading">加载图表...</div>}>
              <MermaidBlock chart={value} />
            </Suspense>
          );
        }

        // 块级代码由 pre 组件统一处理，这里只返回原始 <code> 元素
        return <code className={className} {...props}>{children}</code>;
      },

      a({ href, children }) {
        return (
          <a
            href={href}
            onClick={(e) => {
              if (href) {
                handleLinkClick(href, e);
              }
            }}
            className="text-accent no-underline cursor-pointer"
          >
            {children}
          </a>
        );
      },
    }),
    [handleCalloutEdit, handleCalloutDelete, content]
  );

  if (!content) {
    return null;
  }

  return (
    <div className="markdown-body" ref={markdownRef} onMouseUp={handleMouseUp}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
      {floatingToolbar && (
        <FloatingToolbar
          visible={true}
          position={floatingToolbar}
          onComment={() => handleCalloutInsert('NOTE')}
          onSendToAI={handleSendToAI}
          onClose={() => setFloatingToolbar(null)}
        />
      )}
    </div>
  );
};

export default MarkdownRenderer;
