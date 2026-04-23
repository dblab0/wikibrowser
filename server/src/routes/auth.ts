import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  verifyPassword,
  getClientId,
  isClientLocked,
  recordLoginFailure,
  clearLoginAttempts,
  getLoginDelay,
  pruneSessions,
} from '../services/auth.js';

export const authRouter = Router();

/**
 * 获取认证是否启用（公开接口）
 * GET /api/auth/status
 * @param _req - Express 请求对象（未使用）
 * @param res - Express 响应对象
 */
authRouter.get('/status', (_req: Request, res: Response) => {
  res.json({ enabled: process.env.WIKIBROWSER_AUTH_ENABLED === '1' });
});

/**
 * 登录接口，验证密码并创建会话
 * POST /api/auth/login
 * @param req - Express 请求对象，body 包含 password
 * @param res - Express 响应对象
 */
authRouter.post('/login', async (req: Request, res: Response) => {
  const { password } = req.body || {};
  const clientId = getClientId(
    req.ip || req.socket.remoteAddress || 'unknown',
    req.get('user-agent') || ''
  );

  // 检查是否被锁定
  if (isClientLocked(clientId)) {
    res.status(429).json({ success: false, error: '登录尝试次数过多，请 5 分钟后再试' });
    return;
  }

  // 延迟响应（防止暴力破解）
  await new Promise(resolve => setTimeout(resolve, getLoginDelay()));

  const expectedPassword = process.env.WIKIBROWSER_AUTH_CODE;
  if (!expectedPassword || !password || !verifyPassword(String(password), expectedPassword)) {
    const locked = recordLoginFailure(clientId);
    if (locked) {
      res.status(429).json({ success: false, error: '登录尝试次数过多，请 5 分钟后再试' });
    } else {
      res.status(401).json({ success: false, error: '密码错误' });
    }
    return;
  }

  // 登录成功
  clearLoginAttempts(clientId);
  (req.session as any).authenticated = true;
  (req.session as any).loginAt = Date.now();

  // Session LRU 清理
  if (req.sessionStore) {
    pruneSessions(req.sessionStore);
  }

  res.json({ success: true });
});

/**
 * 登出接口，销毁当前会话
 * POST /api/auth/logout
 * @param req - Express 请求对象
 * @param res - Express 响应对象
 */
authRouter.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});
