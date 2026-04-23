import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * 请求 ID 中间件，为每个请求生成唯一的短 ID
 * 将 ID 同时写入请求头和响应头，便于日志追踪
 * @param req - Express 请求对象
 * @param res - Express 响应对象
 * @param next - Express next 函数
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const id = uuidv4().substring(0, 8);  // 截取前 8 位作为短 ID
  req.headers['x-request-id'] = id;
  res.setHeader('X-Request-Id', id);
  next();
}

/**
 * 从请求对象中获取请求 ID
 * @param req - Express 请求对象
 * @returns 请求 ID 字符串，若不存在则返回 'unknown'
 */
export function getRequestId(req: Request): string {
  return req.headers['x-request-id'] as string || 'unknown';
}