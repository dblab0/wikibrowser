import { Router } from 'express';
import type { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as configService from '../services/config.js';
import * as scanner from '../services/scanner.js';
import * as searchIndex from '../services/search-index.js';
import * as wikiLoader from '../services/wiki-loader.js';
import { wikiDataCache, pageContentCache } from '../services/cache.js';
import { AppError, ErrorCodes } from '../middleware/errorHandler.js';

/**
 * 将路径中的反斜杠替换为正斜杠，统一路径分隔符
 * @param p - 原始路径
 * @returns 标准化后的路径
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * 根据项目路径生成 .zread/wiki 子目录的完整路径
 * @param projectPath - 项目根目录路径
 * @returns Wiki 目录完整路径
 */
function getWikiPath(projectPath: string): string {
  return path.join(projectPath, '.zread', 'wiki');
}

export const projectsRouter = Router();

/**
 * 获取所有项目列表
 * GET /api/projects
 * @param _req - Express 请求对象（未使用）
 * @param res - Express 响应对象
 */
projectsRouter.get('/', (_req: Request, res: Response) => {
  const config = configService.getConfig();
  res.json({
    success: true,
    data: config.projects,
  });
});

/**
 * 通过路径添加新项目
 * POST /api/projects
 * @param req - Express 请求对象，body 包含 path 字段
 * @param res - Express 响应对象
 * @param next - Express next 中间件函数
 */
projectsRouter.post('/', async (req: Request, res: Response, next: Function) => {
  try {
    const { path: projectPath } = req.body as { path: string };

    if (!projectPath) {
      throw new AppError(400, ErrorCodes.INVALID_PATH, 'Project path is required');
    }

    const resolved = path.resolve(projectPath);
    if (!fs.existsSync(resolved)) {
      throw new AppError(400, ErrorCodes.INVALID_PATH, `Path does not exist: ${resolved}`);
    }

    const wikiPath = getWikiPath(resolved);
    if (!fs.existsSync(wikiPath)) {
      throw new AppError(
        400,
        ErrorCodes.INVALID_PATH,
        `No .zread/wiki directory found at: ${resolved}`
      );
    }

    const project = await scanner.scanSinglePath(resolved);
    if (!project) {
      throw new AppError(
        400,
        ErrorCodes.INVALID_PATH,
        `Failed to create project config for: ${resolved}`
      );
    }

    // 为新项目建立搜索索引
    await searchIndex.indexProject(project);

    res.json({
      success: true,
      data: project,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 删除指定项目
 * DELETE /api/projects/:id
 * @param req - Express 请求对象，params 包含项目 id
 * @param res - Express 响应对象
 * @param next - Express next 中间件函数
 */
projectsRouter.delete('/:id', (req: Request, res: Response, next: Function) => {
  try {
    const id = req.params.id as string;
    const project = configService.getProjectById(id);

    if (!project) {
      throw new AppError(404, ErrorCodes.PROJECT_NOT_FOUND, `Project not found: ${id}`);
    }

    configService.removeProject(id);
    searchIndex.clearProjectIndex(id);

    res.json({
      success: true,
      data: { id },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 激活指定项目
 * POST /api/projects/:id/activate
 * @param req - Express 请求对象，params 包含项目 id
 * @param res - Express 响应对象
 * @param next - Express next 中间件函数
 */
projectsRouter.post('/:id/activate', async (req: Request, res: Response, next: Function) => {
  try {
    const id = req.params.id as string;
    const project = configService.getProjectById(id);

    if (!project) {
      throw new AppError(404, ErrorCodes.PROJECT_NOT_FOUND, `Project not found: ${id}`);
    }

    const updatedConfig = configService.setActiveProject(id);

    // 确保项目已建立搜索索引
    const activeProject = updatedConfig.projects.find((p) => p.id === id);
    if (activeProject) {
      await searchIndex.indexProject(activeProject);
    }

    res.json({
      success: true,
      data: activeProject,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 刷新项目缓存
 * POST /api/projects/:id/refresh-cache
 * 失效服务端内存缓存 → 预加载 wiki.json → 重建搜索索引
 * @param req - Express 请求对象，params 包含项目 id
 * @param res - Express 响应对象
 * @param next - Express next 中间件函数
 */
projectsRouter.post('/:id/refresh-cache', async (req: Request, res: Response, next: Function) => {
  try {
    const id = req.params.id as string;
    const project = configService.getProjectById(id);

    if (!project) {
      throw new AppError(404, ErrorCodes.PROJECT_NOT_FOUND, `Project not found: ${id}`);
    }

    // 失效该项目的服务端缓存
    const wikiPathPrefix = `${project.wikiPath}:`;
    wikiDataCache.invalidatePattern(wikiPathPrefix);
    pageContentCache.invalidatePattern(wikiPathPrefix);

    // 预加载 wiki.json（优先读取 current 指针，回退到配置中的版本）
    const version = wikiLoader.readCurrentPointer(project.wikiPath) || project.currentVersion;
    await wikiLoader.loadWikiJson(project.wikiPath, version);

    // 重建搜索索引
    await searchIndex.indexProject(project, true);

    res.json({
      success: true,
      data: {
        wikiDataCleared: true,
        wikiDataReloaded: true,
        searchIndexUpdated: true,
      },
    });
  } catch (err) {
    next(err);
  }
});
