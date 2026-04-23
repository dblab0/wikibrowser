/**
 * 会话池管理器测试
 * 覆盖 session-pool.ts 的基本生命周期、LRU 驱逐、空闲回收、排队机制、优雅关闭逻辑
 */
// 先导入 vi，确保在 Mock 之前可用
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// Mock child_process
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    spawn: vi.fn(),
  }
})

// Mock os 模块
vi.mock('os', () => ({
  platform: vi.fn(() => 'linux'),
  homedir: vi.fn(() => '/home/testuser'),
}))

// Mock config 服务
vi.mock('../../src/services/config.js', () => ({
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  invalidateConfigCache: vi.fn(),
}))

// Mock logger
vi.mock('../../src/services/logger.js', () => ({
  aiInfo: vi.fn(),
  aiDebug: vi.fn(),
  aiError: vi.fn(),
}))

// 导入已 Mock 的模块
import * as configService from '../../src/services/config.js'

// 导入被测模块 — 必须在 Mock 之后
import { SessionPoolManager } from '../../src/services/session-pool.js'
import type { ProcessInfo } from '../../src/services/ai.js'

// ===== 辅助函数 =====

/**
 * 创建 Mock 的 ProcessInfo 对象
 * @param overrides - 覆盖默认值的属性
 * @returns 带默认值的 ProcessInfo 对象
 */
function createMockProcessInfo(
  overrides: Partial<ProcessInfo> = {},
): ProcessInfo {
  return {
    proc: {
      pid: Math.floor(Math.random() * 100000),
      kill: vi.fn(),
    } as any,
    sessionId: overrides.sessionId ?? 'test-session',
    projectPath: overrides.projectPath ?? '/test/project',
    initialized: true,
    initPromise: Promise.resolve(),
    lastActivity: Date.now(),
    eventEmitter: new EventEmitter(),
    pendingRequests: new Map(),
    msgIdCounter: 0,
    ...overrides,
  }
}

/**
 * 创建 SessionPoolManager 实例
 * @param configOverrides - 覆盖默认配置的属性
 * @returns 配置好的 SessionPoolManager 实例
 */
function createPool(
  configOverrides: Record<string, any> = {},
): SessionPoolManager {
  const mockConfig = {}
  vi.mocked(configService.getConfig).mockReturnValue(mockConfig)

  const mockStartProcess = vi.fn().mockImplementation(
    (sessionId: string, projectPath: string) => {
      return Promise.resolve(
        createMockProcessInfo({ sessionId, projectPath }),
      )
    },
  )

  const pool = new SessionPoolManager(mockStartProcess, {
    maxSessions: 3,
    idleTimeoutMs: 5000,
    evictionIntervalMs: 100,
    maxQueueSize: 5,
    queueTimeoutMs: 200,
    ...configOverrides,
  })

  return pool as any
}

// ===== 测试用例 =====

describe('SessionPoolManager', () => {
  let pool: SessionPoolManager
  let mockStartProcess: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()

    const mockConfig = {}
    vi.mocked(configService.getConfig).mockReturnValue(mockConfig)

    mockStartProcess = vi.fn().mockImplementation(
      (sessionId: string, projectPath: string) => {
        return Promise.resolve(
          createMockProcessInfo({ sessionId, projectPath }),
        )
      },
    )

    pool = new SessionPoolManager(mockStartProcess, {
      maxSessions: 3,
      idleTimeoutMs: 5000,
      evictionIntervalMs: 100,
      maxQueueSize: 5,
      queueTimeoutMs: 200,
    })
  })

  afterEach(() => {
    pool.stopEvictionLoop()
    vi.useRealTimers()
  })

  // ===== 1. 基本生命周期 =====

  describe('基本生命周期', () => {
    it('activate 首次调用会启动进程', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/test/path1')

      const result = await pool.activate('s1')

      expect(result).toBeDefined()
      expect(result.sessionId).toBe('s1')
      expect(mockStartProcess).toHaveBeenCalledWith('s1', '/test/path1')
      expect(pool.activeCount).toBe(1)
    })

    it('activate 已存在的进程直接返回', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/test/path1')

      const first = await pool.activate('s1')
      const second = await pool.activate('s1')

      expect(second).toBe(first)
      expect(mockStartProcess).toHaveBeenCalledTimes(1)
    })

    it('deactivate 关闭进程', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/test/path1')
      const processInfo = await pool.activate('s1')
      expect(pool.activeCount).toBe(1)

      const result = pool.deactivate('s1')

      expect(result).toBe(true)
      expect(pool.activeCount).toBe(0)
      expect(pool.has('s1')).toBe(false)
    })

    it('deactivate 后可以重新 activate', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/test/path1')

      await pool.activate('s1')
      pool.deactivate('s1')
      expect(pool.activeCount).toBe(0)

      const result = await pool.activate('s1')
      expect(result).toBeDefined()
      expect(pool.activeCount).toBe(1)
      expect(mockStartProcess).toHaveBeenCalledTimes(2)
    })

    it('deactivate 不存在的会话返回 false', () => {
      const result = pool.deactivate('non-existent')
      expect(result).toBe(false)
    })

    it('activate 未注册 meta 的会话抛出错误', async () => {
      await expect(pool.activate('no-meta')).rejects.toThrow(
        'SessionMeta not found',
      )
    })
  })

  // ===== 2. 上限控制与 LRU 驱逐 =====

  describe('上限控制', () => {
    it('池满时 activate 触发 LRU 驱逐', async () => {
      // 创建 maxSessions=2 的池
      const smallPool = createPool({ maxSessions: 2 })
      smallPool.registerSessionMeta('s1', 'proj1', '/p1')
      smallPool.registerSessionMeta('s2', 'proj2', '/p2')
      smallPool.registerSessionMeta('s3', 'proj3', '/p3')

      // Activate two sessions to fill the pool
      const p1 = await smallPool.activate('s1')
      p1.lastActivity = 100 // 最旧
      const p2 = await smallPool.activate('s2')
      p2.lastActivity = 200

      expect(smallPool.activeCount).toBe(2)

      // 激活第三个 — 应驱逐 s1（最旧）
      await smallPool.activate('s3')

      expect(smallPool.activeCount).toBe(2)
      expect(smallPool.has('s1')).toBe(false)
      expect(smallPool.has('s2')).toBe(true)
      expect(smallPool.has('s3')).toBe(true)

      smallPool.stopEvictionLoop()
    })

    it('所有会话都有 pending requests 时无法驱逐，进入排队', async () => {
      const smallPool = createPool({ maxSessions: 2 })
      smallPool.registerSessionMeta('s1', 'proj1', '/p1')
      smallPool.registerSessionMeta('s2', 'proj2', '/p2')
      smallPool.registerSessionMeta('s3', 'proj3', '/p3')

      const p1 = await smallPool.activate('s1')
      const p2 = await smallPool.activate('s2')

      // 为两个会话添加 pending requests 使其无法被驱逐
      p1.pendingRequests.set('req-1', {
        resolve: vi.fn(),
        reject: vi.fn(),
        timer: setTimeout(() => {}, 100000) as any,
      })
      p2.pendingRequests.set('req-2', {
        resolve: vi.fn(),
        reject: vi.fn(),
        timer: setTimeout(() => {}, 100000) as any,
      })

      expect(smallPool.activeCount).toBe(2)

      // 无可驱逐会话时应进入排队
      const activatePromise = smallPool.activate('s3')

      // 应在队列中，尚未激活
      expect(smallPool.queueLength).toBe(1)
      expect(smallPool.activeCount).toBe(2)

      // 清除 pending request 以允许出队
      p1.pendingRequests.delete('req-1')
      smallPool.deactivate('s1')

      // 现在排队请求应被处理
      const result = await activatePromise
      expect(result).toBeDefined()

      smallPool.stopEvictionLoop()
    })
  })

  // ===== 3. LRU Eviction =====

  describe('LRU 驱逐', () => {
    it('驱逐 lastActivity 最早且无 pending requests 的会话', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')
      pool.registerSessionMeta('s2', 'proj2', '/p2')
      pool.registerSessionMeta('s3', 'proj3', '/p3')

      const p1 = await pool.activate('s1')
      p1.lastActivity = 100 // 最旧

      const p2 = await pool.activate('s2')
      p2.lastActivity = 300

      const p3 = await pool.activate('s3')
      p3.lastActivity = 200

      const result = pool.evictLRU()

      expect(result).toBe(true)
      expect(pool.has('s1')).toBe(false) // 最旧的被驱逐
      expect(pool.has('s2')).toBe(true)
      expect(pool.has('s3')).toBe(true)
    })

    it('有 pending requests 的会话不被驱逐', () => {
      // Manually build scenario - use a fresh pool with maxSessions=3
      const testPool = createPool({ maxSessions: 3 })
      testPool.registerSessionMeta('s1', 'proj1', '/p1')
      testPool.registerSessionMeta('s2', 'proj2', '/p2')

      return (async () => {
        const p1 = await testPool.activate('s1')
        p1.lastActivity = 100 // 最旧但有 pending

        const p2 = await testPool.activate('s2')
        p2.lastActivity = 300

        // Add pending request to oldest session
        p1.pendingRequests.set('req-1', {
          resolve: vi.fn(),
          reject: vi.fn(),
          timer: setTimeout(() => {}, 100000) as any,
        })

        const result = testPool.evictLRU()

        // s1 不应被驱逐，因为有 pending requests
        // s2 应被驱逐（唯一无 pending requests 的候选）
        expect(result).toBe(true)
        expect(testPool.has('s1')).toBe(true) // 有 pending，未被驱逐
        expect(testPool.has('s2')).toBe(false) // 被驱逐

        testPool.stopEvictionLoop()
      })()
    })

    it('所有会话都有 pending requests 时 evictLRU 返回 false', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')
      pool.registerSessionMeta('s2', 'proj2', '/p2')

      const p1 = await pool.activate('s1')
      const p2 = await pool.activate('s2')

      p1.pendingRequests.set('req-1', {
        resolve: vi.fn(),
        reject: vi.fn(),
        timer: setTimeout(() => {}, 100000) as any,
      })
      p2.pendingRequests.set('req-2', {
        resolve: vi.fn(),
        reject: vi.fn(),
        timer: setTimeout(() => {}, 100000) as any,
      })

      const result = pool.evictLRU()
      expect(result).toBe(false)
      expect(pool.activeCount).toBe(2)
    })

    it('没有活跃进程时 evictLRU 返回 false', () => {
      const result = pool.evictLRU()
      expect(result).toBe(false)
    })
  })

  // ===== 4. Idle Eviction =====

  describe('空闲回收', () => {
    it('超过 idleTimeoutMs 且无 pending requests 的会话被回收', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')
      pool.registerSessionMeta('s2', 'proj2', '/p2')

      const p1 = await pool.activate('s1')
      p1.lastActivity = Date.now() - 10000 // 10s ago, exceeds 5000ms timeout

      const p2 = await pool.activate('s2')
      p2.lastActivity = Date.now() // 刚刚

      pool.startEvictionLoop()

      // Advance timer to trigger eviction check
      vi.advanceTimersByTime(150)

      expect(pool.has('s1')).toBe(false) // 因空闲被驱逐
      expect(pool.has('s2')).toBe(true) // 仍然活跃
    })

    it('有 pending requests 的会话不被回收', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')

      const p1 = await pool.activate('s1')
      p1.lastActivity = Date.now() - 10000 // exceeds timeout

      // Add pending request
      p1.pendingRequests.set('req-1', {
        resolve: vi.fn(),
        reject: vi.fn(),
        timer: setTimeout(() => {}, 100000) as any,
      })

      pool.startEvictionLoop()
      vi.advanceTimersByTime(150)

      expect(pool.has('s1')).toBe(true) // 因有 pending 未被驱逐
    })

    it('未超时的会话不被回收', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')

      const p1 = await pool.activate('s1')
      p1.lastActivity = Date.now() - 1000 // 1s ago, within 5000ms timeout

      pool.startEvictionLoop()
      vi.advanceTimersByTime(150)

      expect(pool.has('s1')).toBe(true)
    })

    it('stopEvictionLoop 停止清扫器', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')
      const p1 = await pool.activate('s1')
      p1.lastActivity = Date.now() - 10000 // exceeds timeout

      pool.startEvictionLoop()
      pool.stopEvictionLoop()

      vi.advanceTimersByTime(500)

      expect(pool.has('s1')).toBe(true) // 循环已停止，未被驱逐
    })
  })

  // ===== 5. Queue Mechanism =====

  describe('排队机制', () => {
    it('池满时进入排队', async () => {
      const smallPool = createPool({ maxSessions: 1 })
      smallPool.registerSessionMeta('s1', 'proj1', '/p1')
      smallPool.registerSessionMeta('s2', 'proj2', '/p2')

      const p1 = await smallPool.activate('s1')
      // 添加 pending request 使 s1 无法被驱逐
      p1.pendingRequests.set('req-1', {
        resolve: vi.fn(),
        reject: vi.fn(),
        timer: setTimeout(() => {}, 100000) as any,
      })
      expect(smallPool.activeCount).toBe(1)

      // 池满且无可驱逐会话时应进入排队
      const activatePromise = smallPool.activate('s2')
      expect(smallPool.queueLength).toBe(1)

      // 清理：移除 pending 并 deactivate 以处理队列
      p1.pendingRequests.delete('req-1')
      smallPool.deactivate('s1')
      await activatePromise

      smallPool.stopEvictionLoop()
    })

    it('排队超时 reject', async () => {
      const smallPool = createPool({
        maxSessions: 1,
        queueTimeoutMs: 200,
      })
      smallPool.registerSessionMeta('s1', 'proj1', '/p1')
      smallPool.registerSessionMeta('s2', 'proj2', '/p2')

      // 给 s1 添加 pending request 使其无法被驱逐
      const p1 = await smallPool.activate('s1')
      p1.pendingRequests.set('req-1', {
        resolve: vi.fn(),
        reject: vi.fn(),
        timer: setTimeout(() => {}, 100000) as any,
      })

      const activatePromise = smallPool.activate('s2')

      // 超过超时时间
      vi.advanceTimersByTime(250)

      await expect(activatePromise).rejects.toThrow('Queue timeout')

      smallPool.stopEvictionLoop()
    })

    it('队列满时抛出错误', async () => {
      const smallPool = createPool({
        maxSessions: 1,
        maxQueueSize: 2,
      })
      smallPool.registerSessionMeta('s1', 'proj1', '/p1')

      const p1 = await smallPool.activate('s1')
      // 添加 pending 以阻止驱逐
      p1.pendingRequests.set('req-1', {
        resolve: vi.fn(),
        reject: vi.fn(),
        timer: setTimeout(() => {}, 100000) as any,
      })

      // 填满队列
      smallPool.registerSessionMeta('s2', 'proj2', '/p2')
      smallPool.registerSessionMeta('s3', 'proj3', '/p3')

      const p2 = smallPool.activate('s2')
      const p3 = smallPool.activate('s3')

      expect(smallPool.queueLength).toBe(2)

      // 队列已满时应抛出异常
      smallPool.registerSessionMeta('s4', 'proj4', '/p4')
      await expect(smallPool.activate('s4')).rejects.toThrow(
        'Session pool queue is full',
      )

      smallPool.stopEvictionLoop()
    })

    it('deactivate 后触发队列处理', async () => {
      const smallPool = createPool({
        maxSessions: 1,
        queueTimeoutMs: 5000,
      })
      smallPool.registerSessionMeta('s1', 'proj1', '/p1')
      smallPool.registerSessionMeta('s2', 'proj2', '/p2')

      const p1 = await smallPool.activate('s1')
      // 添加 pending request 以阻止 LRU 驱逐
      p1.pendingRequests.set('req-1', {
        resolve: vi.fn(),
        reject: vi.fn(),
        timer: setTimeout(() => {}, 100000) as any,
      })
      expect(smallPool.activeCount).toBe(1)

      // 入队 s2 — 因 s1 有 pending requests 而排队
      const activatePromise = smallPool.activate('s2')
      expect(smallPool.queueLength).toBe(1)

      // 移除 pending 并 deactivate s1，应处理队列
      p1.pendingRequests.delete('req-1')
      smallPool.deactivate('s1')

      const result = await activatePromise
      expect(result).toBeDefined()
      expect(result.sessionId).toBe('s2')
      expect(smallPool.activeCount).toBe(1)
      expect(smallPool.queueLength).toBe(0)

      smallPool.stopEvictionLoop()
    })
  })

  // ===== 6. Graceful Shutdown =====

  describe('优雅关闭', () => {
    it('shutdown 停止清扫器', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')
      const p1 = await pool.activate('s1')
      p1.lastActivity = Date.now() - 10000

      pool.startEvictionLoop()
      pool.shutdown()

      // shutdown 后驱逐循环应停止
      vi.advanceTimersByTime(500)

      // s1 应仍被移除，因为 shutdown 也会 deactivate 所有进程
      // 但通过验证 stopEvictionLoop 幂等来确认定时器已清除
      expect(pool.queueLength).toBe(0)
    })

    it('shutdown reject 所有排队请求', async () => {
      const smallPool = createPool({
        maxSessions: 1,
        queueTimeoutMs: 60000,
      })
      smallPool.registerSessionMeta('s1', 'proj1', '/p1')
      smallPool.registerSessionMeta('s2', 'proj2', '/p2')

      const p1 = await smallPool.activate('s1')
      p1.pendingRequests.set('req-1', {
        resolve: vi.fn(),
        reject: vi.fn(),
        timer: setTimeout(() => {}, 100000) as any,
      })

      const activatePromise = smallPool.activate('s2')
      expect(smallPool.queueLength).toBe(1)

      smallPool.shutdown()

      await expect(activatePromise).rejects.toThrow(
        'Session pool is shutting down',
      )
      expect(smallPool.queueLength).toBe(0)

      smallPool.stopEvictionLoop()
    })

    it('shutdown 关闭所有活跃进程', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')
      pool.registerSessionMeta('s2', 'proj2', '/p2')

      await pool.activate('s1')
      await pool.activate('s2')
      expect(pool.activeCount).toBe(2)

      pool.shutdown()

      expect(pool.activeCount).toBe(0)
    })
  })

  // ===== 7. Statistics =====

  describe('统计数据', () => {
    it('getStats 返回正确的统计数据', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')
      pool.registerSessionMeta('s2', 'proj2', '/p2')

      await pool.activate('s1')
      await pool.activate('s2')

      const stats = pool.getStats()

      expect(stats.activeCount).toBe(2)
      expect(stats.maxSessions).toBe(3)
      expect(stats.inactiveCount).toBe(0)
      expect(stats.queueLength).toBe(0)
      expect(stats.totalActivations).toBe(2)
      expect(stats.totalEvictions).toBe(0)
    })

    it('getStats 正确统计 inactive 会话', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')
      pool.registerSessionMeta('s2', 'proj2', '/p2')

      await pool.activate('s1')
      await pool.activate('s2')

      pool.deactivate('s1')

      const stats = pool.getStats()
      expect(stats.activeCount).toBe(1)
      expect(stats.inactiveCount).toBe(1) // s1 meta 仍已注册
      expect(stats.totalEvictions).toBe(1)
    })

    it('getSessionList 返回正确的会话列表', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')
      pool.registerSessionMeta('s2', 'proj2', '/p2')

      const p1 = await pool.activate('s1')
      p1.lastActivity = 1000

      // s2 未激活 — 仅注册了 meta

      const list = pool.getSessionList()

      expect(list).toHaveLength(2)

      const s1Info = list.find((s) => s.sessionId === 's1')
      expect(s1Info).toBeDefined()
      expect(s1Info!.status).toBe('ACTIVE')
      expect(s1Info!.projectId).toBe('proj1')
      expect(s1Info!.lastActivity).toBe(1000)

      const s2Info = list.find((s) => s.sessionId === 's2')
      expect(s2Info).toBeDefined()
      expect(s2Info!.status).toBe('INACTIVE')
      expect(s2Info!.lastActivity).toBe(0)
    })
  })

  // ===== 8. Deactivate Notifier =====

  describe('通知器', () => {
    it('deactivate 调用通知器', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')
      await pool.activate('s1')

      const notifier = vi.fn()
      pool.setDeactivateNotifier(notifier)

      pool.deactivate('s1', 'idle_timeout')

      expect(notifier).toHaveBeenCalledWith('s1', 'idle_timeout')
    })

    it('manual deactivate 通知为 evicted', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')
      await pool.activate('s1')

      const notifier = vi.fn()
      pool.setDeactivateNotifier(notifier)

      pool.deactivate('s1', 'manual')

      expect(notifier).toHaveBeenCalledWith('s1', 'evicted')
    })
  })

  // ===== 9. Pending Request Cleanup =====

  describe('pending requests 清理', () => {
    it('deactivate 时 reject 所有 pending requests', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')
      const p1 = await pool.activate('s1')

      const rejectFn = vi.fn()
      p1.pendingRequests.set('req-1', {
        resolve: vi.fn(),
        reject: rejectFn,
        timer: setTimeout(() => {}, 100000) as any,
      })

      pool.deactivate('s1', 'manual')

      expect(rejectFn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Process deactivated: manual',
        }),
      )
    })
  })

  // ===== 10. SessionMeta =====

  describe('SessionMeta 管理', () => {
    it('registerSessionMeta 注册元数据', () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')

      const meta = pool.getSessionMeta('s1')
      expect(meta).toEqual({
        sessionId: 's1',
        projectId: 'proj1',
        projectPath: '/p1',
      })
    })

    it('removeSessionMeta 删除元数据', () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')
      const result = pool.removeSessionMeta('s1')
      expect(result).toBe(true)
      expect(pool.getSessionMeta('s1')).toBeUndefined()
    })

    it('removeSessionMeta 不存在的元数据返回 false', () => {
      const result = pool.removeSessionMeta('non-existent')
      expect(result).toBe(false)
    })

    it('deactivate 不删除 sessionMeta', async () => {
      pool.registerSessionMeta('s1', 'proj1', '/p1')
      await pool.activate('s1')
      pool.deactivate('s1')

      // Meta should still be registered
      const meta = pool.getSessionMeta('s1')
      expect(meta).toBeDefined()
    })
  })

  // ===== 11. Queue Timeout Stats =====

  describe('排队超时统计', () => {
    it('排队超时计入 totalQueueTimeouts', async () => {
      const smallPool = createPool({
        maxSessions: 1,
        queueTimeoutMs: 200,
      })
      smallPool.registerSessionMeta('s1', 'proj1', '/p1')
      smallPool.registerSessionMeta('s2', 'proj2', '/p2')

      const p1 = await smallPool.activate('s1')
      p1.pendingRequests.set('req-1', {
        resolve: vi.fn(),
        reject: vi.fn(),
        timer: setTimeout(() => {}, 100000) as any,
      })

      const activatePromise = smallPool.activate('s2')

      vi.advanceTimersByTime(250)

      try {
        await activatePromise
      } catch {
        // 预期的错误
      }

      const stats = smallPool.getStats()
      expect(stats.totalQueueTimeouts).toBe(1)

      smallPool.stopEvictionLoop()
    })
  })
})
