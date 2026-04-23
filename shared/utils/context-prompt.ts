/**
 * 构建包含文件引用的上下文提示词，供 AI 使用。
 * 引用信息嵌入在 HTML 注释标记中，显示时会被剥离。
 */

import type { FileReference } from '../types/index.js';

/** 上下文提示词解析结果 */
export interface ContextPromptResult {
  visibleText: string;     // 用户可见的文本
  references: FileReference[]; // 文件引用列表
}

/**
 * 从文件路径中提取文件名
 * @param filePath - 文件路径
 * @returns 文件名部分
 */
export function getFileName(filePath: string): string {
  // 兼容 Unix 和 Windows 路径分隔符
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  const lastPart = parts[parts.length - 1];
  // 处理末尾斜杠的情况
  return lastPart || '';
}

/**
 * 格式化行号范围用于显示
 * @param startLine - 起始行号
 * @param endLine - 结束行号
 * @returns 格式化的行号范围字符串，如 "L10" 或 "L10-L20"
 */
export function formatLineRange(startLine: number, endLine: number): string {
  // 确保 startLine <= endLine
  const [start, end] = startLine <= endLine
    ? [startLine, endLine]
    : [endLine, startLine];

  return start === end ? `L${start}` : `L${start}-L${end}`;
}

/**
 * 构建包含文件引用的上下文提示词
 * @param references - 文件引用列表
 * @param userText - 用户输入的文本
 * @returns 包含引用信息的完整提示词
 */
export function buildContextPrompt(
  references: FileReference[],
  userText: string
): string {
  if (references.length === 0) {
    return userText;
  }

  const refLines = references
    .map(ref => `- ${ref.filePath} ${formatLineRange(ref.startLine, ref.endLine)}`)
    .join('\n');

  return `<!--CTX_START-->
用户引用了以下文件内容，请使用 ReadFile 工具查看：
${refLines}
<!--CTX_END-->
${userText}`;
}

/**
 * 解析上下文提示词，提取可见文本和文件引用
 * @param fullText - 完整的提示词文本
 * @returns 包含可见文本和引用列表的解析结果
 */
export function parseContextPrompt(fullText: string): ContextPromptResult {
  const ctxRegex = /<!--CTX_START-->([\s\S]*?)<!--CTX_END-->/;
  const match = fullText.match(ctxRegex);

  if (!match) {
    return { visibleText: fullText, references: [] };
  }

  const markerContent = match[1];
  const visibleText = fullText.replace(ctxRegex, '').trim();

  // 从标记内容中提取文件引用
  const refRegex = /-\s+(\S+)\s+(L\d+(?:-L\d+)?)?/g;
  const references: FileReference[] = [];
  let refMatch: RegExpExecArray | null;

  while ((refMatch = refRegex.exec(markerContent)) !== null) {
    const filePath = refMatch[1];
    const lineRange = refMatch[2];

    let startLine = 1;
    let endLine = 1;

    if (lineRange) {
      const rangeMatch = lineRange.match(/L(\d+)(?:-L(\d+))?/);
      if (rangeMatch) {
        startLine = parseInt(rangeMatch[1], 10);
        endLine = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : startLine;
      }
    }

    references.push({
      id: `${filePath}_${startLine}_${endLine}_${Date.now()}_${Math.random()}`,
      filePath,
      startLine,
      endLine,
      selectedText: '' // 提示词中不存储选中文本
    });
  }

  return { visibleText, references };
}
