/**
 * Auth Routes Tests
 * Tests for POST /api/auth/login, POST /api/auth/logout, GET /api/auth/status
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Use vi.hoisted so mock functions are available inside vi.mock factory
const {
  mockVerifyPassword,
  mockGetClientId,
  mockIsClientLocked,
  mockRecordLoginFailure,
  mockClearLoginAttempts,
  mockGetLoginDelay,
  mockPruneSessions,
} = vi.hoisted(() => ({
  mockVerifyPassword: vi.fn(),
  mockGetClientId: vi.fn(),
  mockIsClientLocked: vi.fn(),
  mockRecordLoginFailure: vi.fn(),
  mockClearLoginAttempts: vi.fn(),
  mockGetLoginDelay: vi.fn(() => 0),
  mockPruneSessions: vi.fn(),
}));

vi.mock('../../src/services/auth.js', () => ({
  verifyPassword: mockVerifyPassword,
  getClientId: mockGetClientId,
  isClientLocked: mockIsClientLocked,
  recordLoginFailure: mockRecordLoginFailure,
  clearLoginAttempts: mockClearLoginAttempts,
  getLoginDelay: mockGetLoginDelay,
  pruneSessions: mockPruneSessions,
}));

// Import module under test - must be after mocks
import { authRouter } from '../../src/routes/auth.js';

// Helper to create mock response
function createMockResponse() {
  const res: any = {
    _status: 200,
    _json: null as any,
    _headers: {} as Record<string, string>,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: any) {
      res._json = data;
      return res;
    },
    set(headers: Record<string, string>) {
      Object.assign(res._headers, headers);
      return res;
    },
    get(name: string) {
      return res._headers[name];
    },
    end() {
      return res;
    },
  };
  return res;
}

// Helper to find a route handler by method and path
function findHandler(method: string, path: string) {
  const layer = authRouter.stack.find(
    (l: any) => l.route && l.route.path === path && l.route.methods[method],
  );
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  return layer.route.stack[0].handle;
}

describe('Auth Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLoginDelay.mockReturnValue(0);
    mockGetClientId.mockReturnValue('test-client-id');
    mockIsClientLocked.mockReturnValue(false);
    mockRecordLoginFailure.mockReturnValue(false);
    delete process.env.WIKIBROWSER_AUTH_CODE;
    delete process.env.WIKIBROWSER_AUTH_ENABLED;
  });

  describe('GET /status', () => {
    it('WIKIBROWSER_AUTH_ENABLED=1 时返回 enabled: true', () => {
      process.env.WIKIBROWSER_AUTH_ENABLED = '1';
      const handler = findHandler('get', '/status');
      const req = {} as any;
      const res = createMockResponse();

      handler(req, res, vi.fn());

      expect(res._json).toEqual({ enabled: true });
    });

    it('未设置 WIKIBROWSER_AUTH_ENABLED 时返回 enabled: false', () => {
      const handler = findHandler('get', '/status');
      const req = {} as any;
      const res = createMockResponse();

      handler(req, res, vi.fn());

      expect(res._json).toEqual({ enabled: false });
    });
  });

  describe('POST /login', () => {
    const correctPassword = 'correct-test-password';

    function createLoginRequest(password?: string) {
      return {
        body: password !== undefined ? { password } : {},
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
        get: vi.fn((name: string) => (name === 'user-agent' ? 'test-agent' : undefined)),
        session: {} as any,
        sessionStore: { sessions: {}, destroy: vi.fn() } as any,
      } as any;
    }

    it('登录成功（密码正确，session 被设置）', async () => {
      process.env.WIKIBROWSER_AUTH_CODE = correctPassword;
      mockVerifyPassword.mockReturnValue(true);

      const handler = findHandler('post', '/login');
      const req = createLoginRequest(correctPassword);
      const res = createMockResponse();

      await handler(req, res, vi.fn());

      expect(res._status).toBe(200);
      expect(res._json).toEqual({ success: true });
      expect(req.session.authenticated).toBe(true);
      expect(typeof req.session.loginAt).toBe('number');
      expect(mockClearLoginAttempts).toHaveBeenCalledWith('test-client-id');
    });

    it('登录成功时调用 pruneSessions 清理旧 session', async () => {
      process.env.WIKIBROWSER_AUTH_CODE = correctPassword;
      mockVerifyPassword.mockReturnValue(true);

      const handler = findHandler('post', '/login');
      const req = createLoginRequest(correctPassword);
      const res = createMockResponse();

      await handler(req, res, vi.fn());

      expect(mockPruneSessions).toHaveBeenCalledWith(req.sessionStore);
    });

    it('登录失败（密码错误，返回 401）', async () => {
      process.env.WIKIBROWSER_AUTH_CODE = correctPassword;
      mockVerifyPassword.mockReturnValue(false);

      const handler = findHandler('post', '/login');
      const req = createLoginRequest('wrong-password');
      const res = createMockResponse();

      await handler(req, res, vi.fn());

      expect(res._status).toBe(401);
      expect(res._json).toEqual({ success: false, error: '密码错误' });
      expect(mockRecordLoginFailure).toHaveBeenCalledWith('test-client-id');
    });

    it('客户端被锁定时返回 429', async () => {
      process.env.WIKIBROWSER_AUTH_CODE = correctPassword;
      mockIsClientLocked.mockReturnValue(true);

      const handler = findHandler('post', '/login');
      const req = createLoginRequest(correctPassword);
      const res = createMockResponse();

      await handler(req, res, vi.fn());

      expect(res._status).toBe(429);
      expect(res._json).toEqual({ success: false, error: '登录尝试次数过多，请 5 分钟后再试' });
      // Should not even attempt to verify password
      expect(mockVerifyPassword).not.toHaveBeenCalled();
    });

    it('登录失败触发锁定时返回 429', async () => {
      process.env.WIKIBROWSER_AUTH_CODE = correctPassword;
      mockVerifyPassword.mockReturnValue(false);
      mockRecordLoginFailure.mockReturnValue(true);

      const handler = findHandler('post', '/login');
      const req = createLoginRequest('wrong-password');
      const res = createMockResponse();

      await handler(req, res, vi.fn());

      expect(res._status).toBe(429);
      expect(res._json).toEqual({ success: false, error: '登录尝试次数过多，请 5 分钟后再试' });
    });

    it('未提供密码时返回 401', async () => {
      process.env.WIKIBROWSER_AUTH_CODE = correctPassword;

      const handler = findHandler('post', '/login');
      const req = createLoginRequest(); // no password
      const res = createMockResponse();

      await handler(req, res, vi.fn());

      expect(res._status).toBe(401);
      expect(res._json).toEqual({ success: false, error: '密码错误' });
    });

    it('未设置 WIKIBROWSER_AUTH_CODE 时返回 401', async () => {
      // process.env.WIKIBROWSER_AUTH_CODE is not set

      const handler = findHandler('post', '/login');
      const req = createLoginRequest('any-password');
      const res = createMockResponse();

      await handler(req, res, vi.fn());

      expect(res._status).toBe(401);
      expect(res._json).toEqual({ success: false, error: '密码错误' });
    });
  });

  describe('POST /logout', () => {
    it('登出成功（session 被销毁）', () => {
      const handler = findHandler('post', '/logout');
      const destroyFn = vi.fn((cb: () => void) => cb());
      const req = {
        session: {
          destroy: destroyFn,
        },
      } as any;
      const res = createMockResponse();

      handler(req, res, vi.fn());

      expect(destroyFn).toHaveBeenCalled();
      expect(res._json).toEqual({ success: true });
    });
  });
});
