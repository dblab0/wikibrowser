import * as path from 'path';

/**
 * 将路径中的反斜杠统一为正斜杠
 * @param p - 需要标准化的路径字符串
 * @returns 使用正斜杠的标准化路径
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * 获取项目的 Wiki 文档路径
 * @param projectPath - 项目根目录的绝对路径
 * @returns 标准化后的 .zread/wiki 路径
 */
export function getWikiPath(projectPath: string): string {
  return normalizePath(path.join(projectPath, '.zread', 'wiki'));
}
