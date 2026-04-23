/**
 * 搜索数据库测试
 * 覆盖 search-db.ts 的建表、FTS5 索引列、WAL 模式、项目及索引状态表操作
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// 从 search-db.ts createTables() 复制的 SQL，用于内存数据库测试
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

describe('search-db (in-memory)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('createTables', () => {
    it('should create all tables without error', () => {
      expect(() => db.exec(CREATE_TABLES_SQL)).not.toThrow();

      // 验证表已创建
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' OR type='view' ORDER BY name")
        .all()
        .map((r: any) => r.name);

      expect(tables).toContain('projects');
      expect(tables).toContain('index_status');

      // FTS5 虚拟表在 sqlite_master 中显示为 table 类型
      const ftsTables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'search_index%' ORDER BY name")
        .all()
        .map((r: any) => r.name);
      expect(ftsTables.length).toBeGreaterThan(0);
    });

    it('should be idempotent (running twice does not fail)', () => {
      db.exec(CREATE_TABLES_SQL);
      expect(() => db.exec(CREATE_TABLES_SQL)).not.toThrow();
    });
  });

  describe('user_version migration pattern', () => {
    it('should read user_version as 0 on fresh database', () => {
      const version = db.pragma('user_version', { simple: true }) as number;
      expect(version).toBe(0);
    });

    it('should set and read user_version', () => {
      db.pragma('user_version = 1');
      const version = db.pragma('user_version', { simple: true }) as number;
      expect(version).toBe(1);
    });
  });

  describe('WAL mode', () => {
    it('in-memory database defaults to memory journal mode', () => {
      // :memory: 数据库使用 memory 日志模式，而非 WAL
      const mode = db.pragma('journal_mode', { simple: true }) as string;
      expect(mode).toBe('memory');
    });
  });

  describe('FTS5 UNINDEXED columns', () => {
    beforeEach(() => {
      db.exec(CREATE_TABLES_SQL);
    });

    it('UNINDEXED columns are readable but not matched by FTS', () => {
      // 插入一行包含分词结果和原始文本的数据
      db.prepare(`
        INSERT INTO search_index
          (project_id, page_slug, title_tokens, section_tokens, content_tokens,
           original_title, original_section, original_content)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'proj1',
        'page-1',
        '搜索 引擎',
        '概述',
        '这是一个 搜索引擎 的 测试',
        '搜索引擎',
        '概述',
        '这是一个搜索引擎的测试内容'
      );

      // 在已索引列上进行 MATCH 查询（title_tokens 包含 '搜索'）
      const matched = db.prepare(`
        SELECT * FROM search_index WHERE search_index MATCH '搜索'
      `).all() as any[];
      expect(matched.length).toBe(1);

      // UNINDEXED 列可以正常读取
      expect(matched[0].original_title).toBe('搜索引擎');
      expect(matched[0].original_content).toBe('这是一个搜索引擎的测试内容');
    });

    it('UNINDEXED column values cannot be matched directly via FTS', () => {
      db.prepare(`
        INSERT INTO search_index
          (project_id, page_slug, title_tokens, section_tokens, content_tokens,
           original_title, original_section, original_content)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'proj1',
        'page-2',
        '索引',
        '测试',
        '内容 索引',
        'UNINDEXED_TITLE_SPECIAL_KEYWORD_XYZ',
        'section',
        'content'
      );

      // UNINDEXED 列的值不应被 FTS 匹配到
      const matched = db.prepare(`
        SELECT * FROM search_index WHERE search_index MATCH 'UNINDEXED_TITLE_SPECIAL_KEYWORD_XYZ'
      `).all() as any[];
      // FTS 不应找到该结果，因为 original_title 是 UNINDEXED 的
      expect(matched.length).toBe(0);
    });
  });

  describe('FTS5 optimize', () => {
    beforeEach(() => {
      db.exec(CREATE_TABLES_SQL);
    });

    it('optimize does not throw on non-empty index', () => {
      db.prepare(`
        INSERT INTO search_index
          (project_id, page_slug, title_tokens, section_tokens, content_tokens,
           original_title, original_section, original_content)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'proj1', 'page-1', '测试', '章节', '内容 测试',
        '测试标题', '章节', '测试内容'
      );

      expect(() => {
        db.exec("INSERT INTO search_index(search_index) VALUES('optimize')");
      }).not.toThrow();
    });

    it('optimize does not throw on empty index', () => {
      expect(() => {
        db.exec("INSERT INTO search_index(search_index) VALUES('optimize')");
      }).not.toThrow();
    });
  });

  describe('projects table operations', () => {
    beforeEach(() => {
      db.exec(CREATE_TABLES_SQL);
    });

    it('insert and query project', () => {
      db.prepare(`
        INSERT OR REPLACE INTO projects (id, name, wiki_path, current_version, indexed_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('proj1', 'Test Project', '/path/to/wiki', 'v1', Date.now());

      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get('proj1') as any;
      expect(project).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.wiki_path).toBe('/path/to/wiki');
    });

    it('INSERT OR REPLACE updates existing project', () => {
      db.prepare(`
        INSERT OR REPLACE INTO projects (id, name, wiki_path, current_version, indexed_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('proj1', 'Old Name', '/path', 'v1', 100);

      db.prepare(`
        INSERT OR REPLACE INTO projects (id, name, wiki_path, current_version, indexed_at)
        VALUES (?, ?, ?, ?, ?)
      `).run('proj1', 'New Name', '/path', 'v2', 200);

      const project = db.prepare('SELECT * FROM projects WHERE id = ?').get('proj1') as any;
      expect(project.name).toBe('New Name');
      expect(project.current_version).toBe('v2');
    });
  });

  describe('index_status table operations', () => {
    beforeEach(() => {
      db.exec(CREATE_TABLES_SQL);
    });

    it('insert and query index status', () => {
      db.prepare(`
        INSERT OR REPLACE INTO index_status (project_id, page_slug, file_mtime, indexed_at)
        VALUES (?, ?, ?, ?)
      `).run('proj1', 'page-1', 1000, Date.now());

      const status = db.prepare(
        'SELECT * FROM index_status WHERE project_id = ? AND page_slug = ?'
      ).get('proj1', 'page-1') as any;

      expect(status).toBeDefined();
      expect(status.file_mtime).toBe(1000);
    });

    it('DELETE removes index status', () => {
      db.prepare(`
        INSERT OR REPLACE INTO index_status (project_id, page_slug, file_mtime, indexed_at)
        VALUES (?, ?, ?, ?)
      `).run('proj1', 'page-1', 1000, Date.now());

      db.prepare('DELETE FROM index_status WHERE project_id = ? AND page_slug = ?')
        .run('proj1', 'page-1');

      const status = db.prepare(
        'SELECT * FROM index_status WHERE project_id = ? AND page_slug = ?'
      ).get('proj1', 'page-1');
      expect(status).toBeUndefined();
    });
  });
});
