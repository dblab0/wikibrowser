import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const DB_VERSION = 1; // 当前数据库版本，变更表结构时递增

let db: Database.Database | null = null;

/** 获取数据库文件路径，首次访问时自动迁移旧版数据库 */
function getDBPath(): string {
  const configDir = path.join(os.homedir(), '.wikibrowser');
  const dbPath = path.join(configDir, 'search.db');

  if (!fs.existsSync(dbPath)) {
    // 迁移优先级：wikibrowser 旧路径 > zreadbrow 路径
    const migrationSources = [
      {
        dir: path.join(os.homedir(), '.config', 'wikibrowser'),
        label: '~/.config/wikibrowser',
      },
      {
        dir: path.join(os.homedir(), '.config', 'zreadbrow'),
        label: '~/.config/zreadbrow',
      },
      {
        dir: path.join(os.homedir(), '.zreadbrow'),
        label: '~/.zreadbrow',
      },
    ];

    for (const src of migrationSources) {
      const srcDb = path.join(src.dir, 'search.db');
      if (fs.existsSync(srcDb)) {
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }
        fs.renameSync(srcDb, dbPath);
        const exts = ['-wal', '-shm'];
        for (const ext of exts) {
          const old = srcDb + ext;
          if (fs.existsSync(old)) fs.renameSync(old, dbPath + ext);
        }
        console.log(`[SearchDB] Migrated database from ${src.label} to ~/.wikibrowser`);
        break;
      }
    }
  }

  return dbPath;
}

/**
 * 初始化搜索数据库，创建必要的表结构。
 * 如果数据库损坏则自动重建。
 */
export function initSearchDB(): void {
  const dbPath = getDBPath();
  const configDir = path.dirname(dbPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL'); // WAL 模式：读写并发安全
    runMigrations();
    console.log('[SearchDB] Initialized');
  } catch (err) {
    console.error('[SearchDB] Failed to open database:', err);
    // 数据库损坏时：删除 .db 文件重建
    if (fs.existsSync(dbPath)) {
      console.log('[SearchDB] Removing corrupted database and recreating...');
      try {
        // 先尝试关闭可能已打开的连接
        if (db) { try { db.close(); } catch { /* ignore */ } }
        fs.unlinkSync(dbPath);
        // 同时删除 WAL 和 SHM 文件
        const walPath = dbPath + '-wal';
        const shmPath = dbPath + '-shm';
        if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
        if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
      } catch (unlinkErr) {
        console.error('[SearchDB] Failed to remove corrupted database:', unlinkErr);
      }
      // 重建
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      runMigrations();
      console.log('[SearchDB] Database recreated successfully');
    } else {
      throw err;
    }
  }
}

/**
 * 数据库迁移：基于 user_version 判断是否需要升级
 * 每个版本号对应一次迁移逻辑，顺序执行
 */
function runMigrations(): void {
  const currentVersion = db!.pragma('user_version', { simple: true }) as number;

  if (currentVersion < 1) {
    createTables();
    db!.pragma(`user_version = ${DB_VERSION}`);
  }
  // 未来版本示例：
  // if (currentVersion < 2) { migrateV2(); db!.pragma('user_version = 2'); }
}

/** 创建初始数据库表结构（FTS5 虚拟表 + 索引状态表 + 项目注册表） */
function createTables(): void {
  db!.exec(`
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
  `);
}

/**
 * FTS5 索引碎片整理，建议在大量删除/更新后调用
 */
export function optimizeFTSIndex(): void {
  if (!db) return;
  db.exec("INSERT INTO search_index(search_index) VALUES('optimize')");
}

/** 关闭搜索数据库连接 */
export function closeSearchDB(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * 获取数据库实例，未初始化时抛出错误
 * @returns Database 实例
 * @throws 数据库未初始化时抛出错误
 */
export function getDB(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}
