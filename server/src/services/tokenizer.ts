import * as jiebaService from './jieba.js';

/** 分词后用空格连接，用于 FTS5 索引 */
export function tokenizeForFTS(text: string): string {
  if (!text) return '';
  const tokens = jiebaService.cutText(text);
  return tokens.join(' ');
}
