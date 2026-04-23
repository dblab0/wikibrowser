import { Router } from 'express';
import type { Request, Response } from 'express';
import * as configService from '../services/config.js';

export const configRouter = Router();

/**
 * 获取应用配置
 * GET /api/config
 * @param _req - Express 请求对象（未使用）
 * @param res - Express 响应对象
 */
configRouter.get('/', (_req: Request, res: Response) => {
  const config = configService.getConfig();
  res.json({
    success: true,
    data: config,
  });
});

/**
 * 更新应用配置
 * PUT /api/config
 * @param req - Express 请求对象，body 包含要更新的配置项
 * @param res - Express 响应对象
 * @param next - Express next 中间件函数
 */
configRouter.put('/', (req: Request, res: Response, next: Function) => {
  try {
    const partial = req.body;
    const updated = configService.updateConfig(partial);
    res.json({
      success: true,
      data: updated,
    });
  } catch (err) {
    next(err);
  }
});
