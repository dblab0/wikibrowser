import React from 'react';

// 支持的 Callout 类型列表
const CALLOUT_TYPES = ['NOTE', 'TIP', 'WARNING', 'CAUTION', 'IMPORTANT'] as const;
// 匹配 callout 标记的正则表达式，如 "[!NOTE] 标题"
const CALLOUT_REGEX = /^\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\]\s*(.*)/;

/** Callout 类型，从 CALLOUT_TYPES 常量中派生 */
export type CalloutType = typeof CALLOUT_TYPES[number];

/** Callout 解析结果 */
export interface CalloutParseResult {
  calloutType: CalloutType; // callout 类型
  title: string; // callout 标题
  bodyText: string; // 第一个段落中 callout 标记之后的正文
  bodyChildren: React.ReactNode[]; // callout 正文后续的子节点
}

/**
 * 从 blockquote children 中解析 callout 信息
 * react-markdown v9 将 blockquote 内每行渲染为独立 <p> 元素
 * @param children - blockquote 元素的子节点
 * @returns 解析后的 callout 信息，如果不是合法 callout 则返回 null
 */
export function parseCallout(
  children: React.ReactNode
): CalloutParseResult | null {
  const childArray = React.Children.toArray(children);

  if (childArray.length === 0) return null;

  // 跳过非元素类型的 children（如 react-markdown v9 产生的 \n text nodes），
  // 找到第一个 React 元素作为包含 callout 标记的子节点
  const firstChild = childArray.find(
    (child) => React.isValidElement(child)
  );
  if (!firstChild) return null;

  const firstText = extractText(firstChild);

  const match = firstText.match(CALLOUT_REGEX);
  if (!match) return null;

  const calloutType = match[1] as CalloutType;
  const title = match[2].trim();

  // 从第一个 <p> 元素的完整文本中，去掉 "[!TYPE] title\n" 前缀，提取正文文本
  let bodyText = '';
  const prefix = match[0].trimEnd(); // 例如 "[!NOTE] 测试标题"
  const firstChildText = firstText.trimStart();
  if (firstChildText.startsWith(prefix)) {
    const afterPrefix = firstChildText.slice(prefix.length);
    // afterPrefix 可能以换行开头（正文跟在标题后面），也可能为空
    bodyText = afterPrefix.startsWith('\n') ? afterPrefix.slice(1) : afterPrefix.trim();
  }

  // 正文从 firstChild 之后的子节点开始（跳过可能存在的 \n 文本节点）
  const firstChildIndex = childArray.indexOf(firstChild);
  const bodyChildren = childArray.slice(firstChildIndex + 1);

  return { calloutType, title, bodyText, bodyChildren };
}

/**
 * 递归提取 React 节点中的纯文本内容
 * @param node - 任意 React 节点
 * @returns 拼接后的纯文本字符串
 */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node) return '';

  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    if (props.children) {
      return React.Children.toArray(props.children).map(extractText).join('');
    }
  }

  if (Array.isArray(node)) {
    return node.map(extractText).join('');
  }

  return '';
}
