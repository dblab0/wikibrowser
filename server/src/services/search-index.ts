import { getDB, optimizeFTSIndex } from './search-db.js';
import { tokenizeForFTS } from './tokenizer.js';
import * as wikiLoader from './wiki-loader.js';
import * as configService from './config.js';
import * as fs from 'fs';
import type { ProjectConfig, WikiPage } from '../../../shared/types/index.js';

/**
 * 索引整个项目
 * @param project - 项目配置
 * @param rebuild - 是否强制重建（版本变更时）
 */
export async function indexProject(project: ProjectConfig, rebuild = false): Promise<void> {
  const db = getDB();

  const wikiData = await wikiLoader.loadWikiJson(project.wikiPath, project.currentVersion);
  if (!wikiData) {
    console.warn(`[SearchIndex] No wiki.json found for project ${project.name}`);
    return;
  }

  if (rebuild) {
    db.prepare('DELETE FROM search_index WHERE project_id = ?').run(project.id);
    db.prepare('DELETE FROM index_status WHERE project_id = ?').run(project.id);
  }

  // 预加载所有页面内容和 mtime
  interface PageData {
    page: WikiPage;
    content: string;
    mtime: number;
  }

  const pageDataList: PageData[] = [];
  for (const page of wikiData.pages) {
    const content = await wikiLoader.loadPageMarkdown(
      project.wikiPath,
      project.currentVersion,
      page.file
    ) || '';

    // 获取文件 mtime 用于增量检测
    let mtime = 0;
    const filePath = wikiLoader.resolvePageFilePath(project.wikiPath, project.currentVersion, page.file);
    if (filePath) {
      try {
        mtime = fs.statSync(filePath).mtimeMs;
      } catch {
        // 文件可能不存在，mtime 保持 0
      }
    }

    pageDataList.push({ page, content, mtime });
  }

  // 事务批量写入
  const deletePageStmt = db.prepare(
    'DELETE FROM search_index WHERE project_id = ? AND page_slug = ?'
  );
  const insertStmt = db.prepare(`
    INSERT INTO search_index
      (project_id, page_slug, title_tokens, section_tokens, content_tokens,
       original_title, original_section, original_content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertStatusStmt = db.prepare(`
    INSERT OR REPLACE INTO index_status (project_id, page_slug, file_mtime, indexed_at)
    VALUES (?, ?, ?, ?)
  `);

  const indexBatch = db.transaction((pages: PageData[]) => {
    for (const { page, content, mtime } of pages) {
      const titleTokens = tokenizeForFTS(page.title);
      const sectionTokens = tokenizeForFTS(page.section);
      const contentTokens = tokenizeForFTS(content);

      deletePageStmt.run(project.id, page.slug);
      insertStmt.run(
        project.id,
        page.slug,
        titleTokens,
        sectionTokens,
        contentTokens,
        page.title,
        page.section,
        content
      );
      upsertStatusStmt.run(project.id, page.slug, mtime, Date.now());
    }
  });

  indexBatch(pageDataList);

  // 更新项目注册表
  db.prepare(`
    INSERT OR REPLACE INTO projects (id, name, wiki_path, current_version, indexed_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(project.id, project.name, project.wikiPath, project.currentVersion, Date.now());

  // 大量更新后执行 FTS 碎片整理
  optimizeFTSIndex();

  console.log(`[SearchIndex] Indexed project "${project.name}" (${pageDataList.length} pages)`);
}

/**
 * 索引单个页面（用于增量更新）
 */
export async function indexPage(
  project: ProjectConfig,
  page: WikiPage
): Promise<void> {
  const db = getDB();

  const content = await wikiLoader.loadPageMarkdown(
    project.wikiPath,
    project.currentVersion,
    page.file
  ) || '';

  const titleTokens = tokenizeForFTS(page.title);
  const sectionTokens = tokenizeForFTS(page.section);
  const contentTokens = tokenizeForFTS(content);

  // 获取文件 mtime
  let mtime = 0;
  const filePath = wikiLoader.resolvePageFilePath(project.wikiPath, project.currentVersion, page.file);
  if (filePath) {
    try {
      mtime = fs.statSync(filePath).mtimeMs;
    } catch {
      // 文件可能不存在
    }
  }

  // 先删除该页旧索引
  db.prepare('DELETE FROM search_index WHERE project_id = ? AND page_slug = ?')
    .run(project.id, page.slug);

  // 插入新索引
  db.prepare(`
    INSERT INTO search_index
      (project_id, page_slug, title_tokens, section_tokens, content_tokens,
       original_title, original_section, original_content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    project.id,
    page.slug,
    titleTokens,
    sectionTokens,
    contentTokens,
    page.title,
    page.section,
    content
  );

  // 记录索引状态
  db.prepare(`
    INSERT OR REPLACE INTO index_status (project_id, page_slug, file_mtime, indexed_at)
    VALUES (?, ?, ?, ?)
  `).run(project.id, page.slug, mtime, Date.now());
}

/**
 * 启动时同步索引：对比 settings.json 与 DB，执行增量更新
 */
export async function syncProjectIndex(): Promise<void> {
  const config = configService.getConfig();
  const db = getDB();

  // 获取数据库中已注册的项目
  const dbProjects = db.prepare('SELECT id, current_version FROM projects').all() as Array<{
    id: string;
    current_version: string;
  }>;

  // 1. 清理已删除项目的索引
  for (const dbProj of dbProjects) {
    if (!config.projects.find((p) => p.id === dbProj.id)) {
      clearProjectIndex(dbProj.id);
      console.log(`[SearchIndex] Cleaned up index for removed project: ${dbProj.id}`);
    }
  }

  // 2. 索引新项目或版本变更项目，或增量更新
  for (const project of config.projects) {
    const dbProj = dbProjects.find((p) => p.id === project.id);

    if (!dbProj) {
      // 新项目 → 全量索引
      console.log(`[SearchIndex] New project: ${project.name}, indexing...`);
      await indexProject(project);
    } else if (dbProj.current_version !== project.currentVersion) {
      // 版本变更 → 重建
      console.log(`[SearchIndex] Version changed for ${project.name}, rebuilding...`);
      await indexProject(project, true);
    } else {
      // 版本未变更 → 增量检查（mtime 对比）
      await incrementalUpdate(project);
    }
  }

  console.log('[SearchIndex] Sync complete');
}

/**
 * 增量更新：检查每个页面的 mtime，仅更新变更的页面
 */
async function incrementalUpdate(project: ProjectConfig): Promise<void> {
  const db = getDB();

  const wikiData = await wikiLoader.loadWikiJson(project.wikiPath, project.currentVersion);
  if (!wikiData) return;

  // 获取已索引页面的状态
  const statusRows = db.prepare(
    'SELECT page_slug, file_mtime FROM index_status WHERE project_id = ?'
  ).all(project.id) as Array<{ page_slug: string; file_mtime: number }>;

  const statusMap = new Map(statusRows.map((r) => [r.page_slug, r.file_mtime]));

  let updatedCount = 0;
  for (const page of wikiData.pages) {
    const filePath = wikiLoader.resolvePageFilePath(
      project.wikiPath,
      project.currentVersion,
      page.file
    );
    if (!filePath) continue;

    let currentMtime = 0;
    try {
      currentMtime = fs.statSync(filePath).mtimeMs;
    } catch {
      continue;
    }

    const indexedMtime = statusMap.get(page.slug);
    if (indexedMtime === undefined || indexedMtime !== currentMtime) {
      await indexPage(project, page);
      updatedCount++;
    }
  }

  // 检查是否需要清理已删除的页面（在 wiki.json 中不再存在的页面）
  const currentSlugs = new Set(wikiData.pages.map((p) => p.slug));
  for (const row of statusRows) {
    if (!currentSlugs.has(row.page_slug)) {
      db.prepare('DELETE FROM search_index WHERE project_id = ? AND page_slug = ?')
        .run(project.id, row.page_slug);
      db.prepare('DELETE FROM index_status WHERE project_id = ? AND page_slug = ?')
        .run(project.id, row.page_slug);
      updatedCount++;
    }
  }

  if (updatedCount > 0) {
    console.log(`[SearchIndex] Incremental update: ${updatedCount} page(s) for "${project.name}"`);
  }
}

/**
 * 清理项目索引
 */
export function clearProjectIndex(projectId: string): void {
  const db = getDB();
  db.prepare('DELETE FROM search_index WHERE project_id = ?').run(projectId);
  db.prepare('DELETE FROM index_status WHERE project_id = ?').run(projectId);
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
}

/**
 * 获取索引状态信息
 */
export function getIndexStatus(): {
  projects: Array<{
    id: string;
    name: string;
    version: string;
    indexedAt: number;
    pageCount: number;
  }>;
  totalPages: number;
} {
  const db = getDB();

  const projects = db.prepare('SELECT id, name, current_version, indexed_at FROM projects').all() as Array<{
    id: string;
    name: string;
    current_version: string;
    indexed_at: number;
  }>;

  let totalPages = 0;
  const projectStatuses = projects.map((p) => {
    const countRow = db.prepare(
      'SELECT COUNT(*) as cnt FROM search_index WHERE project_id = ?'
    ).get(p.id) as { cnt: number };
    totalPages += countRow.cnt;
    return {
      id: p.id,
      name: p.name,
      version: p.current_version,
      indexedAt: p.indexed_at,
      pageCount: countRow.cnt,
    };
  });

  return { projects: projectStatuses, totalPages };
}
