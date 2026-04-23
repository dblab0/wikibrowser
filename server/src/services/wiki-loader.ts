import { readFile } from 'fs/promises';
import { existsSync, statSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import type { WikiData, WikiPage, WikiVersion } from '../../../shared/types/index.js';
import { wikiDataCache, pageContentCache } from './cache.js';

/**
 * 移除 <blog></blog> 标签，保留内部内容
 * @param content - 原始 Markdown 内容
 * @returns 移除 blog 标签后的内容
 */
function stripBlogTags(content: string): string {
  return content.replace(/<\/?blog>/g, '');
}

/**
 * 加载 wiki.json 配置文件，按版本目录、current 目录、根目录顺序查找
 * @param wikiPath - wiki 根目录路径
 * @param version - 版本 ID
 * @returns WikiData 或 null（文件不存在时）
 */
export async function loadWikiJson(wikiPath: string, version: string): Promise<WikiData | null> {
  const cacheKey = `${wikiPath}:${version}`;
  const cached = wikiDataCache.get(cacheKey);
  if (cached) {
    console.log(`[WikiLoader] Cache hit for wiki.json: ${cacheKey}`);
    return cached;
  }

  // 优先尝试版本目录
  const versionedPath = path.join(wikiPath, 'versions', version, 'wiki.json');

  if (existsSync(versionedPath)) {
    try {
      const raw = await readFile(versionedPath, 'utf-8');
      const data = JSON.parse(raw) as WikiData;
      wikiDataCache.set(cacheKey, data);
      return data;
    } catch (err) {
      console.error(`[WikiLoader] Failed to read wiki.json at ${versionedPath}:`, err);
    }
  }

  // 尝试 current 目录
  const currentPath = path.join(wikiPath, 'current', 'wiki.json');
  if (existsSync(currentPath)) {
    try {
      const raw = await readFile(currentPath, 'utf-8');
      const data = JSON.parse(raw) as WikiData;
      wikiDataCache.set(cacheKey, data);
      return data;
    } catch (err) {
      console.error(`[WikiLoader] Failed to read wiki.json at ${currentPath}:`, err);
    }
  }

  // 尝试 wiki 根目录
  const rootPath = path.join(wikiPath, 'wiki.json');
  if (existsSync(rootPath)) {
    try {
      const raw = await readFile(rootPath, 'utf-8');
      const data = JSON.parse(raw) as WikiData;
      wikiDataCache.set(cacheKey, data);
      return data;
    } catch (err) {
      console.error(`[WikiLoader] Failed to read wiki.json at ${rootPath}:`, err);
    }
  }

  return null;
}

/**
 * 加载页面 Markdown 内容，按多个候选路径依次查找
 * @param wikiPath - wiki 根目录路径
 * @param version - 版本 ID
 * @param file - 页面文件名
 * @returns Markdown 内容或 null（文件不存在时）
 */
export async function loadPageMarkdown(
  wikiPath: string,
  version: string,
  file: string
): Promise<string | null> {
  const cacheKey = `${wikiPath}:${version}:${file}`;
  const cached = pageContentCache.get(cacheKey);
  if (cached) {
    console.log(`[WikiLoader] Cache hit for page: ${cacheKey}`);
    return cached;
  }

  // 候选路径：md 文件可能在版本目录下或 pages/ 子目录下
  const candidates = [
    path.join(wikiPath, 'versions', version, 'pages', file),
    path.join(wikiPath, 'versions', version, file),
    path.join(wikiPath, 'current', 'pages', file),
    path.join(wikiPath, 'current', file),
    path.join(wikiPath, 'pages', file),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const rawContent = await readFile(candidate, 'utf-8');
        const content = stripBlogTags(rawContent);
        pageContentCache.set(cacheKey, content);
        return content;
      } catch (err) {
        console.error(`[WikiLoader] Failed to read page at ${candidate}:`, err);
      }
    }
  }

  return null;
}

/**
 * 解析页面文件的绝对路径，按多个候选路径依次查找
 * @param wikiPath - wiki 根目录路径
 * @param version - 版本 ID
 * @param file - 页面文件名
 * @returns 文件绝对路径或 null
 */
export function resolvePageFilePath(
  wikiPath: string,
  version: string,
  file: string
): string | null {
  const candidates = [
    path.join(wikiPath, 'versions', version, 'pages', file),
    path.join(wikiPath, 'versions', version, file),
    path.join(wikiPath, 'current', 'pages', file),
    path.join(wikiPath, 'current', file),
    path.join(wikiPath, 'pages', file),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * 保存页面 Markdown 内容到文件
 * @param filePath - 文件绝对路径
 * @param content - Markdown 内容
 * @returns 文件的修改时间（mtimeMs）
 */
export function savePageMarkdown(
  filePath: string,
  content: string
): number {
  writeFileSync(filePath, content, 'utf-8');
  const stat = statSync(filePath);
  return stat.mtimeMs;
}

/**
 * 根据 slug 查找页面，精确匹配优先，大小写不敏感回退
 * @param wikiData - Wiki 数据对象
 * @param slug - 页面 slug
 * @returns 匹配的 WikiPage 或 undefined
 */
export function getPageBySlug(
  wikiData: WikiData,
  slug: string
): WikiPage | undefined {
  // 精确匹配
  const exact = wikiData.pages.find((p) => p.slug === slug);
  if (exact) return exact;

  // 大小写不敏感回退匹配（处理 CLI vs cli 等情况）
  const lowerSlug = slug.toLowerCase();
  return wikiData.pages.find((p) => p.slug.toLowerCase() === lowerSlug);
}

/**
 * 读取 current 指针文件，返回版本 ID（不含 versions/ 前缀）
 */
export function readCurrentPointer(wikiPath: string): string | null {
  const currentPath = path.join(wikiPath, 'current');
  if (!existsSync(currentPath)) return null;
  try {
    const content = readFileSync(currentPath, 'utf-8').trim();
    // current 文件内容格式: "versions/2026-04-16-220440"
    const match = content.match(/versions\/(.+)/);
    return match ? match[1] : (content || null);
  } catch {
    return null;
  }
}

/**
 * 列出所有可用的 wiki 版本
 */
export function listVersions(wikiPath: string): WikiVersion[] {
  const versionsDir = path.join(wikiPath, 'versions');
  if (!existsSync(versionsDir)) return [];

  const currentPointer = readCurrentPointer(wikiPath);

  const entries = readdirSync(versionsDir)
    .filter((e: string) => statSync(path.join(versionsDir, e)).isDirectory())
    .sort()
    .reverse();

  return entries.map((dirName: string) => {
    const jsonPath = path.join(versionsDir, dirName, 'wiki.json');
    let generatedAt = '';
    let pageCount = 0;

    if (existsSync(jsonPath)) {
      try {
        const raw = readFileSync(jsonPath, 'utf-8');
        const data = JSON.parse(raw);
        generatedAt = data.generated_at || '';
        pageCount = data.pages?.length || 0;
      } catch {
        // JSON 解析失败，使用默认值
      }
    }

    return {
      version: dirName,
      generatedAt,
      pageCount,
      isCurrent: currentPointer === dirName,
    };
  });
}
