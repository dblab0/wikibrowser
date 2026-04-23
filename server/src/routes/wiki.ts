import { Router } from 'express';
import type { Request, Response } from 'express';
import { readFile } from 'fs/promises';
import { statSync } from 'fs';
import * as crypto from 'crypto';
import * as configService from '../services/config.js';
import * as wikiLoader from '../services/wiki-loader.js';
import { pageContentCache } from '../services/cache.js';
import { AppError, ErrorCodes } from '../middleware/errorHandler.js';

export const wikiRouter = Router();

/**
 * 列出指定项目的所有 Wiki 版本
 * GET /api/wiki/:projectId/versions
 * @param req - Express 请求对象，params 包含 projectId
 * @param res - Express 响应对象
 * @param next - Express next 中间件函数
 */
wikiRouter.get('/:projectId/versions', async (req: Request, res: Response, next: Function) => {
  try {
    const projectId = req.params.projectId as string;
    const project = configService.getProjectById(projectId);

    if (!project) {
      throw new AppError(404, ErrorCodes.PROJECT_NOT_FOUND, `Project not found: ${projectId}`);
    }

    const versions = wikiLoader.listVersions(project.wikiPath);

    res.json({
      success: true,
      data: versions,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 获取指定项目的 Wiki 数据（wiki.json）
 * GET /api/wiki/:projectId?version=xxx
 * @param req - Express 请求对象，params 包含 projectId，query 可选包含 version
 * @param res - Express 响应对象
 * @param next - Express next 中间件函数
 */
wikiRouter.get('/:projectId', async (req: Request, res: Response, next: Function) => {
  try {
    const projectId = req.params.projectId as string;
    const version = req.query.version as string | undefined;
    const project = configService.getProjectById(projectId);

    if (!project) {
      throw new AppError(404, ErrorCodes.PROJECT_NOT_FOUND, `Project not found: ${projectId}`);
    }

    // 如果指定了 version 参数，使用它；否则使用项目的 currentVersion
    const effectiveVersion = version || project.currentVersion;

    const wikiData = await wikiLoader.loadWikiJson(project.wikiPath, effectiveVersion);

    if (!wikiData) {
      throw new AppError(404, ErrorCodes.WIKI_NOT_FOUND, `Wiki data not found for project: ${project.name}`);
    }

    res.json({
      success: true,
      data: wikiData,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 获取指定页面的 Markdown 内容（支持 ETag 缓存和 304 协商）
 * GET /api/wiki/:projectId/:version/:slug
 * @param req - Express 请求对象，params 包含 projectId、version、slug
 * @param res - Express 响应对象
 * @param next - Express next 中间件函数
 */
wikiRouter.get('/:projectId/:version/:slug', async (req: Request, res: Response, next: Function) => {
  try {
    const projectId = req.params.projectId as string;
    const version = req.params.version as string;
    const slug = req.params.slug as string;
    const project = configService.getProjectById(projectId);

    if (!project) {
      throw new AppError(404, ErrorCodes.PROJECT_NOT_FOUND, `Project not found: ${projectId}`);
    }

    // 先加载 wiki.json 以查找目标页面
    const wikiData = await wikiLoader.loadWikiJson(project.wikiPath, version);

    if (!wikiData) {
      throw new AppError(404, ErrorCodes.WIKI_NOT_FOUND, `Wiki data not found for version: ${version}`);
    }

    const page = wikiLoader.getPageBySlug(wikiData, slug);

    if (!page) {
      throw new AppError(
        404,
        ErrorCodes.WIKI_NOT_FOUND,
        `Page not found: ${slug}`
      );
    }

    const filePath = wikiLoader.resolvePageFilePath(project.wikiPath, version, page.file);

    if (!filePath) {
      throw new AppError(
        404,
        ErrorCodes.WIKI_NOT_FOUND,
        `Markdown file not found: ${page.file}`
      );
    }

    const rawContent = await readFile(filePath, 'utf-8');
    const markdown = rawContent.replace(/<\/?blog>/g, '');
    const stat = statSync(filePath);

    // 计算 ETag
    const etag = crypto.createHash('md5').update(markdown).digest('hex');
    const lastModified = stat.mtime.toUTCString();

    // 设置缓存头
    res.set({
      'Cache-Control': 'public, max-age=300',  // 5 分钟
      'ETag': etag,
      'Last-Modified': lastModified,
    });

    // 检查客户端缓存是否有效
    const clientEtag = req.headers['if-none-match'];
    const clientLastModified = req.headers['if-modified-since'];

    if (clientEtag === etag) {
      // ETag 匹配，返回 304 Not Modified
      return res.status(304).end();
    }

    if (clientLastModified) {
      try {
        const clientDate = new Date(clientLastModified);
        if (clientDate >= stat.mtime) {
          // Last-Modified 匹配，返回 304
          return res.status(304).end();
        }
      } catch {
        // 无效的日期格式，忽略
      }
    }

    // 返回完整内容
    res.json({
      success: true,
      data: {
        page,
        content: markdown,
        mtime: stat.mtimeMs,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 保存页面 Markdown 内容（支持冲突检测）
 * PUT /api/wiki/:projectId/:version/:slug
 * @param req - Express 请求对象，params 包含 projectId、version、slug，body 包含 content 和 expectedMtime
 * @param res - Express 响应对象
 * @param next - Express next 中间件函数
 */
wikiRouter.put('/:projectId/:version/:slug', async (req: Request, res: Response, next: Function) => {
  try {
    const projectId = req.params.projectId as string;
    const version = req.params.version as string;
    const slug = req.params.slug as string;
    const { content, expectedMtime } = req.body;

    if (!content || typeof content !== 'string') {
      throw new AppError(400, ErrorCodes.INVALID_PATH, 'Content is required and must be a string');
    }
    if (content.length > 1024 * 1024) {
      throw new AppError(400, ErrorCodes.CONTENT_TOO_LARGE, 'Content exceeds maximum size of 1MB');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
      throw new AppError(400, ErrorCodes.INVALID_PATH, 'Invalid slug format');
    }

    const project = configService.getProjectById(projectId);
    if (!project) {
      throw new AppError(404, ErrorCodes.PROJECT_NOT_FOUND, `Project not found: ${projectId}`);
    }

    const wikiData = await wikiLoader.loadWikiJson(project.wikiPath, version);
    if (!wikiData) {
      throw new AppError(404, ErrorCodes.WIKI_NOT_FOUND, `Wiki data not found for version: ${version}`);
    }

    const page = wikiLoader.getPageBySlug(wikiData, slug);
    if (!page) {
      throw new AppError(404, ErrorCodes.WIKI_NOT_FOUND, `Page not found: ${slug}`);
    }

    const filePath = wikiLoader.resolvePageFilePath(project.wikiPath, version, page.file);
    if (!filePath) {
      throw new AppError(404, ErrorCodes.WIKI_NOT_FOUND, `Markdown file not found: ${page.file}`);
    }

    // 冲突检测
    if (expectedMtime !== undefined) {
      const currentStat = statSync(filePath);
      const currentMtime = currentStat.mtimeMs;
      if (Math.abs(currentMtime - expectedMtime) > 100) {
        throw new AppError(
          409,
          ErrorCodes.CONFLICT,
          `File modified since load. Current mtime: ${currentMtime}, expected: ${expectedMtime}`
        );
      }
    }

    const mtime = wikiLoader.savePageMarkdown(filePath, content);

    // 失效相关缓存
    const cacheKey = `${project.wikiPath}:${version}:${page.file}`;
    pageContentCache.invalidate(cacheKey);

    res.json({
      success: true,
      data: { mtime },
    });
  } catch (err) {
    next(err);
  }
});
