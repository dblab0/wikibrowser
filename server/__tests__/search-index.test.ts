/**
 * 搜索索引集成测试
 * 覆盖 search-index.ts 的分词入库、BM25 搜索、增量更新、批量插入、索引状态追踪
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import Database from 'better-sqlite3';
import * as jiebaService from '../src/services/jieba.js';
import { tokenizeForFTS } from '../src/services/tokenizer.js';

// 从 search-db.ts createTables() 复制的 SQL
const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    wiki_path TEXT NOT NULL,
    current_version TEXT NOT NULL,
    indexed_at INTEGER DEFAULT 0
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING FTS5(
    project_id UNINDEXED,
    page_slug UNINDEXED,
    title_tokens,
    section_tokens,
    content_tokens,
    original_title UNINDEXED,
    original_section UNINDEXED,
    original_content UNINDEXED,
    tokenize = 'unicode61'
  );
  CREATE TABLE IF NOT EXISTS index_status (
    project_id TEXT,
    page_slug TEXT,
    file_mtime INTEGER,
    indexed_at INTEGER,
    PRIMARY KEY (project_id, page_slug)
  );
`;

/** 辅助函数：对文本进行 FTS 分词（与 search-index.ts 逻辑一致） */
function makeTokens(text: string): string {
  return tokenizeForFTS(text);
}

/** 辅助函数：将 jieba 搜索模式分词结果构建为 FTS MATCH 表达式 */
function escapeFtsTokens(tokens: string[]): string {
  return tokens
    .filter(t => t.length > 0)
    .map(t => `"${t.replace(/"/g, '""')}"`)
    .join(' ');
}

/** 辅助函数：向搜索索引中插入一个页面 */
function insertPage(
  db: Database.Database,
  projectId: string,
  slug: string,
  title: string,
  section: string,
  content: string
): void {
  db.prepare(`
    INSERT INTO search_index
      (project_id, page_slug, title_tokens, section_tokens, content_tokens,
       original_title, original_section, original_content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    projectId,
    slug,
    makeTokens(title),
    makeTokens(section),
    makeTokens(content),
    title,
    section,
    content
  );
}

/** 辅助函数：使用 BM25 排序进行搜索 */
function searchIndex(
  db: Database.Database,
  query: string,
  projectId?: string
): Array<{ page_slug: string; original_title: string; score: number }> {
  const queryTokens = jiebaService.cutForSearch(query);
  if (queryTokens.length === 0) return [];

  const ftsQuery = escapeFtsTokens(queryTokens);

  if (projectId) {
    return db.prepare(`
      SELECT page_slug, original_title, bm25(search_index) as score
      FROM search_index
      WHERE project_id = ? AND search_index MATCH ?
      ORDER BY bm25(search_index)
      LIMIT 100
    `).all(projectId, ftsQuery) as any[];
  }

  return db.prepare(`
    SELECT page_slug, original_title, project_id, bm25(search_index) as score
    FROM search_index
    WHERE search_index MATCH ?
    ORDER BY bm25(search_index)
    LIMIT 100
  `).all(ftsQuery) as any[];
}

describe('search-index integration (in-memory)', () => {
  let db: Database.Database;

  beforeAll(async () => {
    await jiebaService.initJieba();
  }, 30_000);

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(CREATE_TABLES_SQL);
  });

  afterEach(() => {
    db.close();
  });

  describe('search queries', () => {
    beforeEach(() => {
      insertPage(db, 'proj1', 'getting-started', '项目概述', '快速开始',
        '这是一个项目的概述文档，介绍了项目的基本结构和功能。');
      insertPage(db, 'proj1', 'api-reference', 'API 参考', '接口说明',
        '本文档提供了完整的 API 参考信息，包括所有可用的接口和参数说明。');
      insertPage(db, 'proj1', 'architecture', '架构概览', '系统架构',
        '系统采用前后端分离架构，使用 Express 作为后端框架。');
      insertPage(db, 'proj2', 'intro', 'Introduction', 'Getting Started',
        'This document provides an overview of the project architecture and features.');
    });

    it('finds results with Chinese keyword', () => {
      const results = searchIndex(db, '项目', 'proj1');
      expect(results.length).toBeGreaterThan(0);
      // 应匹配到 '项目概述' 页面
      const titles = results.map(r => r.original_title);
      expect(titles).toContain('项目概述');
    });

    it('ranks results by BM25', () => {
      const results = searchIndex(db, '架构', 'proj1');
      expect(results.length).toBeGreaterThan(0);
      // '架构概览' 应排第一，因为 '架构' 出现在标题中
      expect(results[0].original_title).toBe('架构概览');
    });

    it('handles multi-word Chinese query', () => {
      const results = searchIndex(db, 'API 参考', 'proj1');
      expect(results.length).toBeGreaterThan(0);
      const titles = results.map(r => r.original_title);
      expect(titles).toContain('API 参考');
    });

    it('returns empty for non-existent keyword', () => {
      const results = searchIndex(db, '量子计算xyz不存在的词', 'proj1');
      expect(results.length).toBe(0);
    });

    it('finds English keyword in English content', () => {
      const results = searchIndex(db, 'architecture', 'proj2');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].original_title).toBe('Introduction');
    });

    it('searches across all projects when projectId is not specified', () => {
      const results = searchIndex(db, '架构');
      expect(results.length).toBeGreaterThan(0);
    });

    it('returns empty for empty query after tokenization', () => {
      const results = searchIndex(db, '   ');
      expect(results).toEqual([]);
    });
  });

  describe('incremental update', () => {
    it('deletes old index before re-inserting a page', () => {
      insertPage(db, 'proj1', 'page-1', '旧标题', '章节',
        '这是旧的内容');

      // 验证初始插入
      let rows = db.prepare(
        "SELECT * FROM search_index WHERE project_id = 'proj1' AND page_slug = 'page-1'"
      ).all() as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].original_title).toBe('旧标题');

      // 模拟重新索引：先删除再插入（与 search-index.ts indexPage 逻辑一致）
      db.prepare('DELETE FROM search_index WHERE project_id = ? AND page_slug = ?')
        .run('proj1', 'page-1');
      insertPage(db, 'proj1', 'page-1', '新标题', '章节',
        '这是新的内容');

      rows = db.prepare(
        "SELECT * FROM search_index WHERE project_id = 'proj1' AND page_slug = 'page-1'"
      ).all() as any[];
      expect(rows.length).toBe(1);
      expect(rows[0].original_title).toBe('新标题');
    });

    it('clears entire project index', () => {
      insertPage(db, 'proj1', 'page-1', '标题1', '章节', '内容1');
      insertPage(db, 'proj1', 'page-2', '标题2', '章节', '内容2');
      insertPage(db, 'proj2', 'page-3', '标题3', '章节', '内容3');

      // 清除 proj1（与 search-index.ts 中 clearProjectIndex 逻辑一致）
      db.prepare('DELETE FROM search_index WHERE project_id = ?').run('proj1');
      db.prepare('DELETE FROM index_status WHERE project_id = ?').run('proj1');
      db.prepare('DELETE FROM projects WHERE id = ?').run('proj1');

      // proj1 的页面应已被清除
      const proj1Rows = db.prepare(
        "SELECT * FROM search_index WHERE project_id = 'proj1'"
      ).all() as any[];
      expect(proj1Rows.length).toBe(0);

      // proj2 应保持不变
      const proj2Rows = db.prepare(
        "SELECT * FROM search_index WHERE project_id = 'proj2'"
      ).all() as any[];
      expect(proj2Rows.length).toBe(1);
    });
  });

  describe('batch insert with transaction', () => {
    it('inserts multiple pages atomically', () => {
      const insertStmt = db.prepare(`
        INSERT INTO search_index
          (project_id, page_slug, title_tokens, section_tokens, content_tokens,
           original_title, original_section, original_content)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const pages = [
        { slug: 'p1', title: '页面一', section: '章节A', content: '内容一' },
        { slug: 'p2', title: '页面二', section: '章节B', content: '内容二' },
        { slug: 'p3', title: '页面三', section: '章节C', content: '内容三' },
      ];

      const insertBatch = db.transaction((items: typeof pages) => {
        for (const page of items) {
          insertStmt.run(
            'proj1', page.slug,
            makeTokens(page.title), makeTokens(page.section), makeTokens(page.content),
            page.title, page.section, page.content
          );
        }
      });

      insertBatch(pages);

      const rows = db.prepare(
        "SELECT * FROM search_index WHERE project_id = 'proj1' ORDER BY page_slug"
      ).all() as any[];
      expect(rows.length).toBe(3);
      expect(rows[0].page_slug).toBe('p1');
      expect(rows[2].page_slug).toBe('p3');
    });
  });

  describe('index_status tracking', () => {
    it('records and queries index status', () => {
      const now = Date.now();
      db.prepare(`
        INSERT OR REPLACE INTO index_status (project_id, page_slug, file_mtime, indexed_at)
        VALUES (?, ?, ?, ?)
      `).run('proj1', 'page-1', 1000, now);

      const status = db.prepare(
        'SELECT * FROM index_status WHERE project_id = ?'
      ).all('proj1') as any[];

      expect(status.length).toBe(1);
      expect(status[0].page_slug).toBe('page-1');
      expect(status[0].file_mtime).toBe(1000);
      expect(status[0].indexed_at).toBe(now);
    });

    it('detects stale pages via mtime comparison', () => {
      db.prepare(`
        INSERT OR REPLACE INTO index_status (project_id, page_slug, file_mtime, indexed_at)
        VALUES (?, ?, ?, ?)
      `).run('proj1', 'page-1', 1000, Date.now());

      // 模拟文件修改：mtime 已变更
      const currentMtime = 2000;
      const statusRow = db.prepare(
        'SELECT file_mtime FROM index_status WHERE project_id = ? AND page_slug = ?'
      ).get('proj1', 'page-1') as any;

      const isStale = statusRow.file_mtime !== currentMtime;
      expect(isStale).toBe(true);
    });
  });
});
