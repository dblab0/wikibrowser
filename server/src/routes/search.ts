import { Router } from 'express';
import type { Request, Response } from 'express';
import * as searchQuery from '../services/search-query.js';
import * as searchIndex from '../services/search-index.js';
import * as configService from '../services/config.js';
import { AppError, ErrorCodes } from '../middleware/errorHandler.js';

export const searchRouter = Router();

/**
 * 获取搜索索引状态
 * GET /api/search/status
 * @param _req - Express 请求对象（未使用）
 * @param res - Express 响应对象
 */
searchRouter.get('/status', (_req: Request, res: Response) => {
  const status = searchIndex.getIndexStatus();
  res.json({ success: true, data: status });
});

/**
 * 强制重建指定项目的搜索索引
 * POST /api/search/reindex/:projectId
 * @param req - Express 请求对象，params 包含 projectId
 * @param res - Express 响应对象
 * @param next - Express next 中间件函数
 */
searchRouter.post('/reindex/:projectId', async (req: Request, res: Response, next: Function) => {
  try {
    const projectId = req.params.projectId as string;
    const project = configService.getProjectById(projectId);
    if (!project) {
      throw new AppError(404, ErrorCodes.PROJECT_NOT_FOUND, `Project not found: ${projectId}`);
    }

    await searchIndex.indexProject(project, true);
    res.json({ success: true, message: `Reindexed project: ${project.name}` });
  } catch (err) {
    next(err);
  }
});

/**
 * 在指定项目内搜索 Wiki 内容（支持分页）
 * GET /api/search/:projectId?q=keyword&page=1&limit=20
 * @param req - Express 请求对象，params 包含 projectId，query 包含 q、page、limit
 * @param res - Express 响应对象
 * @param next - Express next 中间件函数
 */
searchRouter.get('/:projectId', (req: Request, res: Response, next: Function) => {
  try {
    const projectId = req.params.projectId as string;
    const query = req.query.q as string;
    const page = parseInt(req.query.page as string || '1', 10);
    const limit = parseInt(req.query.limit as string || '20', 10);

    // 参数校验
    if (page < 1 || limit < 1 || limit > 100) {
      throw new AppError(400, ErrorCodes.INVALID_PATH, 'Invalid pagination parameters');
    }

    if (!query || query.trim().length === 0) {
      res.json({
        success: true,
        data: [],
        pagination: { total: 0, page, limit, totalPages: 0, hasNext: false, hasPrev: false },
      });
      return;
    }

    const project = configService.getProjectById(projectId);
    if (!project) {
      throw new AppError(404, ErrorCodes.PROJECT_NOT_FOUND, `Project not found: ${projectId}`);
    }

    // 获取所有结果
    const allResults = searchQuery.searchInProject(projectId, query.trim());

    // 分页计算
    const total = allResults.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const end = start + limit;
    const results = allResults.slice(start, end);

    res.json({
      success: true,
      data: results,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (err) {
    next(err);
  }
});
