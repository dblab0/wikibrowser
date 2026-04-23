/** Callout 操作的联合类型，支持插入、编辑和删除 */
type CalloutAction =
  | { type: 'insert'; afterLine: number; calloutType: string; title: string; content: string }
  | { type: 'edit'; startLine: number; endLine: number; calloutType: string; title: string; content: string }
  | { type: 'delete'; startLine: number; endLine: number };

/**
 * 对 Markdown 源文本执行 callout 增删改操作
 * @param source - 原始 Markdown 文本
 * @param action - 要执行的操作（插入、编辑或删除 callout）
 * @returns 修改后的 Markdown 文本
 */
export function patchMarkdown(source: string, action: CalloutAction): string {
  const lines = source.split('\n');

  switch (action.type) {
    case 'insert': {
      // 构造 callout 标题部分
      const titlePart = action.title ? ` ${action.title}` : '';
      // 构造 callout 正文行，每行以 "> " 前缀
      const bodyLines = action.content
        ? ['>', ...action.content.split('\n').map((l: string) => `> ${l}`)]
        : ['> '];
      // 组装完整的 callout 块（前后各加一个空行）
      const calloutLines = [
        '',
        `> [!${action.calloutType}]${titlePart}`,
        ...bodyLines,
        '',
      ];
      lines.splice(action.afterLine, 0, ...calloutLines);
      break;
    }
    case 'edit': {
      const titlePart = action.title ? ` ${action.title}` : '';
      const bodyLines = action.content
        ? ['>', ...action.content.split('\n').map((l: string) => `> ${l}`)]
        : ['> '];
      // 替换指定行范围内的 callout 内容
      const newCalloutLines = [
        `> [!${action.calloutType}]${titlePart}`,
        ...bodyLines,
      ];
      lines.splice(action.startLine - 1, action.endLine - action.startLine + 1, ...newCalloutLines);
      break;
    }
    case 'delete': {
      let deleteStart = action.startLine - 1;
      let deleteCount = action.endLine - action.startLine + 1;
      // 如果 callout 上方有空行，一并删除以保持格式整洁
      if (deleteStart > 0 && lines[deleteStart - 1] === '') {
        deleteStart -= 1;
        deleteCount += 1;
      }
      lines.splice(deleteStart, deleteCount);
      break;
    }
  }

  return lines.join('\n');
}
