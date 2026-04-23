import type { Request, Response, NextFunction } from 'express';
import { getRequestId } from './requestId.js';

/** 应用层错误类，携带 HTTP 状态码和错误码 */
export class AppError extends Error {
  /** HTTP 状态码 */
  public statusCode: number;
  /** 业务错误码 */
  public code: string;

  /**
   * 创建应用层错误实例
   * @param statusCode - HTTP 状态码
   * @param code - 业务错误码
   * @param message - 错误描述信息
   */
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = 'AppError';
  }
}

/** 业务错误码常量集合 */
export const ErrorCodes = {
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  WIKI_NOT_FOUND: 'WIKI_NOT_FOUND',
  INVALID_PATH: 'INVALID_PATH',
  SCAN_IN_PROGRESS: 'SCAN_IN_PROGRESS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  CONTENT_TOO_LARGE: 'CONTENT_TOO_LARGE',
  CONFLICT: 'CONFLICT',
} as const;

/**
 * 全局错误处理中间件，捕获并统一格式化错误响应
 * - AppError 类型返回对应的 HTTP 状态码和业务错误码
 * - 其他未知错误返回 500 内部服务器错误
 * @param err - 捕获的错误对象
 * @param req - Express 请求对象
 * @param res - Express 响应对象
 * @param _next - Express next 函数（未使用）
 */
export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = getRequestId(req);

  // 处理已知的应用层错误
  if (err instanceof AppError) {
    console.error(`[${requestId}] AppError ${err.code}: ${err.message} | ${req.path} ${req.method}`);
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        requestId,
      },
    });
    return;
  }

  // 处理未知错误，返回 500
  console.error(`[${requestId}] Unhandled Error:`, err);
  res.status(500).json({
    success: false,
    error: {
      code: ErrorCodes.INTERNAL_ERROR,
      message: 'Internal server error',
      requestId,
    },
  });
}
