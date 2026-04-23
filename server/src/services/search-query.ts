import { getDB } from './search-db.js';
import * as jiebaService from './jieba.js';
import * as configService from './config.js';
import type { SearchResult, WikiPage } from '../../../shared/types/index.js';

/**
 * 将 jieba 分词结果转义为安全的 FTS5 MATCH 表达式。
 * 双引号内的特殊字符（括号、星号等）失去特殊含义，内嵌双引号用 "" 转义。
 *
 * @param tokens - jieba 分词后的词元数组
 * @returns 安全的 FTS5 MATCH 表达式字符串
 */
function escapeFtsTokens(tokens: string[]): string {
  return tokens
    .filter(t => t.length > 0)
    .map(t => `"${t.replace(/"/g, '""')}"`)
    .join(' ');
}

/**
 * 从原始中文内容中提取摘要：找到第一个匹配词的位置，
 * 截取其前后上下文，并在匹配词周围加高亮标记。
 *
 * @param content - 原始完整内容
 * @param queryTokens - jieba 分词后的查询词
 * @param radius - 上下文半径（字符数），默认 80
 * @returns 带高亮标记的摘要字符串
 */
function extractSnippet(content: string, queryTokens: string[], radius = 80): string {
  if (!content) return '';

  // 在原文中查找第一个匹配词的位置
  let matchPos = -1;
  let matchedToken = '';
  for (const token of queryTokens) {
    const pos = content.indexOf(token);
    if (pos !== -1) {
      matchPos = pos;
      matchedToken = token;
      break;
    }
  }

  if (matchPos === -1) {
    // 未找到匹配，返回开头 200 字
    return content.slice(0, 200) + (content.length > 200 ? '...' : '');
  }

  // 截取上下文
  const start = Math.max(0, matchPos - radius);
  const end = Math.min(content.length, matchPos + matchedToken.length + radius);

  let snippet = '';
  if (start > 0) snippet += '...';
  snippet += content.slice(start, end);
  if (end < content.length) snippet += '...';

  // 高亮所有匹配词
  for (const token of queryTokens) {
    snippet = snippet.split(token).join(`\u27EA${token}\u27EB`);
  }

  return snippet;
}

/**
 * 从 config 获取项目名
 */
function getProjectName(projectId: string): string {
  const project = configService.getProjectById(projectId);
  return project?.name ?? projectId;
}

/**
 * 判断 matchType：标题包含查询词 → 'title'，section 包含 → 'section'，否则 → 'content'
 */
function determineMatchType(
  title: string,
  section: string,
  queryTokens: string[]
): 'title' | 'section' | 'content' {
  for (const token of queryTokens) {
    if (title.includes(token)) return 'title';
  }
  for (const token of queryTokens) {
    if (section.includes(token)) return 'section';
  }
  return 'content';
}

/**
 * 搜索单个项目，使用 FTS5 MATCH 过滤和 BM25 排序
 * @param projectId - 项目 ID
 * @param query - 搜索查询字符串
 * @returns 搜索结果数组
 */
export function searchInProject(
  projectId: string,
  query: string
): SearchResult[] {
  const db = getDB();

  const queryTokens = jiebaService.cutForSearch(query);
  if (queryTokens.length === 0) return [];

  const ftsQuery = escapeFtsTokens(queryTokens);
  if (!ftsQuery) return [];

  // FTS5 负责 MATCH 过滤 + BM25 排序
  const rows = db.prepare(`
    SELECT project_id, page_slug, original_title, original_section,
           original_content,
           bm25(search_index) as score
    FROM search_index
    WHERE project_id = ? AND search_index MATCH ?
    ORDER BY bm25(search_index)
    LIMIT 100
  `).all(projectId, ftsQuery) as Array<{
    project_id: string;
    page_slug: string;
    original_title: string;
    original_section: string;
    original_content: string;
    score: number;
  }>;

  return rows.map(row => {
    const page: WikiPage = {
      slug: row.page_slug,
      title: row.original_title,
      file: '', // file 不参与搜索结果展示
      section: row.original_section,
      level: 'Beginner', // 默认值，搜索结果不需要精确的 level
    };

    return {
      projectId: row.project_id,
      projectName: getProjectName(row.project_id),
      page,
      content: extractSnippet(row.original_content, queryTokens),
      matchType: determineMatchType(row.original_title, row.original_section, queryTokens),
      score: Math.abs(row.score),
    };
  });
}

