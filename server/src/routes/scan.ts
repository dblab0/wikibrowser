import { Router } from 'express';
import type { Request, Response } from 'express';
import * as scanner from '../services/scanner.js';
import * as searchIndex from '../services/search-index.js';
import { AppError, ErrorCodes } from '../middleware/errorHandler.js';

export const scanRouter = Router();

/**
 * 触发全量扫描，扫描磁盘上的所有项目
 * POST /api/scan
 * @param _req - Express 请求对象（未使用）
 * @param res - Express 响应对象
 * @param next - Express next 中间件函数
 */
scanRouter.post('/', async (_req: Request, res: Response, next: Function) => {
  try {
    const status = scanner.getScanStatus();

    if (status.scanning) {
      throw new AppError(409, ErrorCodes.SCAN_IN_PROGRESS, 'A scan is already in progress');
    }

    const projects = await scanner.scanAllPaths();

    // 扫描完成后同步搜索索引
    await searchIndex.syncProjectIndex();

    res.json({
      success: true,
      data: projects,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 获取当前扫描状态
 * GET /api/scan/status
 * @param _req - Express 请求对象（未使用）
 * @param res - Express 响应对象
 */
scanRouter.get('/status', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      scanning: scanner.isScanning(),
      lastScanAt: scanner.getLastScanTime(),
    },
  });
});
