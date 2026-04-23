/**
 * Line Range 工具函数
 * 提供从 DOM 选区中提取对应源代码行号范围的能力
 */

/**
 * 从 DOM 选区中计算对应的源代码行号范围
 * @param range - DOM Range 对象
 * @param container - 包含选区的容器元素（必须有 data-source-line 属性）
 * @param totalLines - 文档总行数（用于计算选区到文档末尾的情况）
 * @returns 包含起始和结束行号的对象，如果无法计算则返回 null
 */
export function getLineRangeFromSelection(
  range: Range,
  container: HTMLElement,
  totalLines: number
): { startLine: number; endLine: number } | null {
  // 查找选区起始位置的最近带有 data-source-line 属性的元素
  let startElement: HTMLElement | null = range.startContainer.parentElement;
  while (startElement && !startElement.dataset.sourceLine) {
    startElement = startElement.parentElement;
  }

  if (!startElement) {
    return null;
  }

  const startLine = parseInt(startElement.dataset.sourceLine!, 10);
  if (isNaN(startLine)) {
    return null;
  }

  // 计算选区的结束行号
  let endLine = startLine;

  // 查找选区结束位置的下一个带有 data-source-line 属性的元素
  let endElement: HTMLElement | null = range.endContainer.parentElement;
  while (endElement && !endElement.dataset.sourceLine) {
    endElement = endElement.parentElement;
  }

  if (endElement) {
    const nextLine = parseInt(endElement.dataset.sourceLine!, 10);
    if (!isNaN(nextLine)) {
      // 如果选区跨越多个元素，找到选区结束元素的下一个元素的起始行
      let nextSibling = endElement.nextElementSibling;
      while (nextSibling && !(nextSibling as HTMLElement).dataset.sourceLine) {
        nextSibling = nextSibling.nextElementSibling;
      }

      if (nextSibling) {
        const nextSiblingLine = parseInt((nextSibling as HTMLElement).dataset.sourceLine!, 10);
        if (!isNaN(nextSiblingLine)) {
          endLine = nextSiblingLine - 1;
        } else {
          endLine = nextLine;
        }
      } else {
        // 没有下一个元素，使用文档总行数
        endLine = totalLines;
      }
    }
  } else {
    // 没有找到结束元素，使用起始行
    endLine = startLine;
  }

  // 确保 endLine 不小于 startLine
  if (endLine < startLine) {
    endLine = startLine;
  }

  // 确保 endLine 不超过总行数
  if (endLine > totalLines) {
    endLine = totalLines;
  }

  return {
    startLine,
    endLine,
  };
}
