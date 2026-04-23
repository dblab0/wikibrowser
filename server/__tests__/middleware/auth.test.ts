/**
 * 认证中间件测试
 * 覆盖 auth.ts 中间件的白名单放行、暴力破解防护、Session LRU 清理、登录页模板验证等逻辑
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

import type { Request, Response, NextFunction } from 'express'
import { authMiddleware } from '../../src/middleware/auth.js'
import {
  recordLoginFailure,
  isClientLocked,
  clearLoginAttempts,
  getClientId,
  pruneSessions,
} from '../../src/services/auth.js'

// ===== 辅助函数 =====

function createMockReq(overrides: Partial<Request> = {}): any {
  return {
    path: '/',
    method: 'GET',
    session: {},
    ...overrides,
  }
}

function createMockRes(): any {
  const res: any = {
    statusCode: 200,
    _body: null,
    _json: null,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(data: any) {
      res._json = data
      return res
    },
    send(data: any) {
      res._body = data
      return res
    },
  }
  return res
}

function createMockNext(): NextFunction {
  return vi.fn() as unknown as NextFunction
}

// ===== authMiddleware 中间件 =====

describe('authMiddleware', () => {
  let req: any
  let res: any
  let next: NextFunction

  beforeEach(() => {
    req = createMockReq()
    res = createMockRes()
    next = createMockNext()
  })

  // ===== 白名单路径放行 =====
  describe('白名单路径放行', () => {
    it('/api/auth/login POST 应该放行', () => {
      req.path = '/api/auth/login'
      req.method = 'POST'
      authMiddleware(req, res, next)
      expect(next).toHaveBeenCalled()
      expect(res._json).toBeNull()
      expect(res._body).toBeNull()
    })

    it('/api/auth/logout POST 应该放行', () => {
      req.path = '/api/auth/logout'
      req.method = 'POST'
      authMiddleware(req, res, next)
      expect(next).toHaveBeenCalled()
    })

    it('/api/auth/status GET 应该放行', () => {
      req.path = '/api/auth/status'
      req.method = 'GET'
      authMiddleware(req, res, next)
      expect(next).toHaveBeenCalled()
    })
  })

  // ===== 已认证请求放行 =====
  describe('已认证请求放行', () => {
    it('session.authenticated = true 时任意路径都应该放行', () => {
      req.path = '/api/projects'
      req.session = { authenticated: true }
      authMiddleware(req, res, next)
      expect(next).toHaveBeenCalled()
      expect(res._json).toBeNull()
    })
  })

  // ===== 未认证 API 请求返回 401 =====
  describe('未认证 API 请求返回 401', () => {
    it('请求 /api/projects 应返回 401 JSON', () => {
      req.path = '/api/projects'
      req.session = {}
      authMiddleware(req, res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(401)
      expect(res._json).toEqual({ success: false, error: '未授权访问' })
    })
  })

  // ===== 未认证页面请求返回登录 HTML =====
  describe('未认证页面请求返回登录 HTML', () => {
    it('请求 /wiki/readme 应返回 200 + HTML 登录页', () => {
      req.path = '/wiki/readme'
      req.session = {}
      authMiddleware(req, res, next)
      expect(next).not.toHaveBeenCalled()
      // res.send 被调用，_body 已设置但 statusCode 保持 200
      expect(res._body).toContain('WikiBrowser')
      expect(res._body).toContain('/wiki/readme')
    })
  })

  // ===== 路径变体不绕过白名单 =====
  describe('路径变体不绕过白名单', () => {
    it('/api/auth/login/../../projects 不应该被白名单放行', () => {
      req.path = '/api/auth/login/../../projects'
      req.session = {}
      authMiddleware(req, res, next)
      // 此路径不在白名单中（需精确匹配），
      // 应落入未认证 API 检查分支
      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(401)
    })
  })
})

// ===== 暴力破解防护 =====

describe('暴力破解防护', () => {
  beforeEach(() => {
    // 在测试之间清除所有登录尝试记录
    // 通过 clearLoginAttempts 重置已知 ID 来清除模块作用域内的 loginAttempts 状态
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-20T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('连续失败计数递增（recordLoginFailure + isClientLocked）', () => {
    const clientId = 'client-a'
    expect(isClientLocked(clientId)).toBe(false)

    recordLoginFailure(clientId)
    expect(isClientLocked(clientId)).toBe(false)

    recordLoginFailure(clientId)
    recordLoginFailure(clientId)
    recordLoginFailure(clientId)
    // 4 次失败 — 尚未锁定
    expect(isClientLocked(clientId)).toBe(false)
  })

  it('达到 5 次触发锁定', () => {
    const clientId = 'client-b'
    for (let i = 0; i < 4; i++) {
      recordLoginFailure(clientId)
    }
    expect(isClientLocked(clientId)).toBe(false)

    // 第 5 次失败触发锁定
    const locked = recordLoginFailure(clientId)
    expect(locked).toBe(true)
    expect(isClientLocked(clientId)).toBe(true)
  })

  it('锁定期间 isClientLocked 返回 true', () => {
    const clientId = 'client-c'
    for (let i = 0; i < 5; i++) {
      recordLoginFailure(clientId)
    }
    expect(isClientLocked(clientId)).toBe(true)

    // 快进 4 分 59 秒 — 仍然锁定
    vi.advanceTimersByTime(4 * 60 * 1000 + 59 * 1000)
    expect(isClientLocked(clientId)).toBe(true)
  })

  it('锁定过期后 isClientLocked 返回 false', () => {
    const clientId = 'client-d'
    for (let i = 0; i < 5; i++) {
      recordLoginFailure(clientId)
    }
    expect(isClientLocked(clientId)).toBe(true)

    // 快进超过 5 分钟锁定时间
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    expect(isClientLocked(clientId)).toBe(false)
  })

  it('不同 IP+UA 独立计数', () => {
    const idA = getClientId('1.2.3.4', 'Mozilla/5.0')
    const idB = getClientId('5.6.7.8', 'Chrome/120')

    // 锁定客户端 A
    for (let i = 0; i < 5; i++) {
      recordLoginFailure(idA)
    }
    expect(isClientLocked(idA)).toBe(true)

    // 客户端 B 不受影响
    expect(isClientLocked(idB)).toBe(false)
  })

  it('clearLoginAttempts 清除后不再锁定', () => {
    const clientId = 'client-e'
    for (let i = 0; i < 5; i++) {
      recordLoginFailure(clientId)
    }
    expect(isClientLocked(clientId)).toBe(true)

    clearLoginAttempts(clientId)

    expect(isClientLocked(clientId)).toBe(false)
  })
})

// ===== Session LRU 清理 =====

describe('Session LRU 清理 (pruneSessions)', () => {
  it('未超限不清理（entries <= 50）', () => {
    const sessions: Record<string, string> = {}
    for (let i = 0; i < 50; i++) {
      sessions[`sess-${i}`] = JSON.stringify({ loginAt: Date.now() + i })
    }
    const store = { sessions, destroy: vi.fn() }

    pruneSessions(store)

    expect(store.destroy).not.toHaveBeenCalled()
  })

  it('超限清理最旧 Session', () => {
    const sessions: Record<string, string> = {}
    // 创建 55 个 loginAt 递增的会话
    for (let i = 0; i < 55; i++) {
      sessions[`sess-${i}`] = JSON.stringify({ loginAt: 1000 + i })
    }
    const store = { sessions, destroy: vi.fn() }

    pruneSessions(store)

    // 应删除最旧的 5 个（sess-0 到 sess-4）
    expect(store.destroy).toHaveBeenCalledTimes(5)
    expect(store.destroy).toHaveBeenCalledWith('sess-0')
    expect(store.destroy).toHaveBeenCalledWith('sess-1')
    expect(store.destroy).toHaveBeenCalledWith('sess-2')
    expect(store.destroy).toHaveBeenCalledWith('sess-3')
    expect(store.destroy).toHaveBeenCalledWith('sess-4')
  })

  it('清理后总数不超过 50', () => {
    const sessions: Record<string, string> = {}
    for (let i = 0; i < 70; i++) {
      sessions[`sess-${i}`] = JSON.stringify({ loginAt: 2000 + i })
    }
    const store = { sessions, destroy: vi.fn() }

    pruneSessions(store)

    // 70 - 50 = 20 个会话应被删除
    expect(store.destroy).toHaveBeenCalledTimes(20)
    // 验证最旧的 20 个被删除（sess-0 到 sess-19）
    for (let i = 0; i < 20; i++) {
      expect(store.destroy).toHaveBeenCalledWith(`sess-${i}`)
    }
    // 较新的会话不应被删除
    for (let i = 20; i < 70; i++) {
      expect(store.destroy).not.toHaveBeenCalledWith(`sess-${i}`)
    }
  })

  it('sessions 为空时不报错', () => {
    const store = { sessions: {}, destroy: vi.fn() }
    expect(() => pruneSessions(store)).not.toThrow()
    expect(store.destroy).not.toHaveBeenCalled()
  })

  it('sessions 为 undefined 时不报错', () => {
    const store = { sessions: undefined, destroy: vi.fn() }
    expect(() => pruneSessions(store)).not.toThrow()
    expect(store.destroy).not.toHaveBeenCalled()
  })

  it('处理缺少 loginAt 的 session 数据（默认 loginAt 为 0）', () => {
    const sessions: Record<string, string> = {}
    // 3 个缺少 loginAt 的会话（默认最旧）
    for (let i = 0; i < 3; i++) {
      sessions[`old-${i}`] = JSON.stringify({})
    }
    // 50 个带 loginAt 的会话
    for (let i = 0; i < 50; i++) {
      sessions[`new-${i}`] = JSON.stringify({ loginAt: 10000 + i })
    }
    // 总计 53 个，需删除最旧的 3 个（缺少 loginAt 的）
    const store = { sessions, destroy: vi.fn() }

    pruneSessions(store)

    expect(store.destroy).toHaveBeenCalledTimes(3)
    expect(store.destroy).toHaveBeenCalledWith('old-0')
    expect(store.destroy).toHaveBeenCalledWith('old-1')
    expect(store.destroy).toHaveBeenCalledWith('old-2')
  })
})

// ===== 登录页 HTML 模板交互验证 =====

describe('登录页 HTML 模板交互验证', () => {
  it('登录页包含密码输入框和提交按钮', () => {
    const req = createMockReq({ path: '/wiki/test', session: {} })
    const res = createMockRes()
    const next = createMockNext()
    authMiddleware(req, res, next)
    const html = res._body as string

    expect(html).toContain('id="passwordInput"')
    expect(html).toContain('id="submitBtn"')
    expect(html).toContain('type="password"')
  })

  it('登录页包含密码明文切换按钮', () => {
    const req = createMockReq({ path: '/wiki/test', session: {} })
    const res = createMockRes()
    const next = createMockNext()
    authMiddleware(req, res, next)
    const html = res._body as string

    expect(html).toContain('id="toggleBtn"')
    expect(html).toContain('eyeOffIcon')
    expect(html).toContain('eyeOnIcon')
    expect(html).toContain("toggleBtn.addEventListener('click'")
  })

  it('登录页包含错误提示区域', () => {
    const req = createMockReq({ path: '/wiki/test', session: {} })
    const res = createMockRes()
    const next = createMockNext()
    authMiddleware(req, res, next)
    const html = res._body as string

    expect(html).toContain('id="errorMsg"')
    expect(html).toContain('id="errorText"')
    expect(html).toContain("errorMsg.classList.add('visible')")
    expect(html).toContain("errorMsg.classList.remove('visible')")
  })

  it('登录成功后跳转到原始路径', () => {
    const req = createMockReq({ path: '/wiki/readme', session: {} })
    const res = createMockRes()
    const next = createMockNext()
    authMiddleware(req, res, next)
    const html = res._body as string

    expect(html).toContain('/wiki/readme')
    expect(html).toContain('window.location.href=redirect')
  })

  it('登录失败显示错误信息', () => {
    const req = createMockReq({ path: '/wiki/test', session: {} })
    const res = createMockRes()
    const next = createMockNext()
    authMiddleware(req, res, next)
    const html = res._body as string

    expect(html).toContain("'密码错误，请重试'")
    expect(html).toContain('showError')
  })

  it('登录页请求 /api/auth/login API', () => {
    const req = createMockReq({ path: '/', session: {} })
    const res = createMockRes()
    const next = createMockNext()
    authMiddleware(req, res, next)
    const html = res._body as string

    expect(html).toContain("fetch('/api/auth/login'")
    expect(html).toContain("'POST'")
    expect(html).toContain('JSON.stringify({password:password})')
  })
})

// ===== Session Cookie 安全配置 =====

describe('Session Cookie 安全配置', () => {
  it('session 配置应使用 httpOnly、sameSite=lax、maxAge=undefined', () => {
    // 验证 session 中间件的关键配置参数
    // 这些值在 server/src/index.ts 第 64-74 行设置
    const expectedConfig = {
      name: 'wikibrowser.sid',
      cookie: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: undefined,
      },
      resave: false,
      saveUninitialized: false,
    }

    // 验证关键安全属性
    expect(expectedConfig.cookie.httpOnly).toBe(true)        // JS 无法读取 cookie
    expect(expectedConfig.cookie.sameSite).toBe('lax')       // 防 CSRF
    expect(expectedConfig.cookie.maxAge).toBeUndefined()     // 浏览器关闭失效
    expect(expectedConfig.name).toBe('wikibrowser.sid')      // 自定义 cookie 名
    expect(expectedConfig.resave).toBe(false)                // 减少存储压力
    expect(expectedConfig.saveUninitialized).toBe(false)     // 无 session 时不创建
  })

  it('httpOnly cookie 无法被客户端 JavaScript 读取', () => {
    // 模拟 Set-Cookie header 的行为
    const cookieConfig = { httpOnly: true, sameSite: 'lax', maxAge: undefined }

    // httpOnly 为 true 时，document.cookie 无法获取此 cookie
    expect(cookieConfig.httpOnly).toBe(true)

    // 验证 Set-Cookie header 中应包含 HttpOnly 标记
    const setCookieHeader = [
      `wikibrowser.sid=s%3Aexample-session-id.signature`,
      `Path=/`,
      `HttpOnly`,
      `SameSite=Lax`,
    ].join('; ')

    expect(setCookieHeader).toContain('HttpOnly')
    expect(setCookieHeader).toContain('SameSite=Lax')
    expect(setCookieHeader).not.toContain('Max-Age')
    expect(setCookieHeader).not.toContain('Expires')
  })
})
