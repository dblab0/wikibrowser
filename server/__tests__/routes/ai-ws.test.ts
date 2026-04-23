/**
 * AI WebSocket 路由测试
 * 覆盖 ai.ts 路由的 WS 连接管理、延迟激活、进程退出处理、池回收通知等逻辑
 */
// 在所有 Mock 定义之前先导入 vi
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

// Mock 日志服务
vi.mock('../../src/services/logger.js', () => ({
  aiInfo: vi.fn(),
  aiDebug: vi.fn(),
  aiError: vi.fn(),
}))

// Mock AI 服务
vi.mock('../../src/services/ai.js', () => ({
  sendPrompt: vi.fn(),
  respondApproval: vi.fn(),
  cancelGeneration: vi.fn(),
  getSessionDetail: vi.fn(),
  checkInstalled: vi.fn(() => ({ available: false })),
}))

// 使用 vi.hoisted 在 vi.mock 工厂函数执行前定义 Mock 对象
const { mockSessionPool, mockOnPoolReady, captured } = vi.hoisted(() => {
  const mockSessionPool = {
    activate: vi.fn(),
    has: vi.fn(() => false),
    getSessionMeta: vi.fn(() => undefined),
    registerSessionMeta: vi.fn(),
    getProcess: vi.fn(() => undefined),
  }
  // 使用可变容器，使模块加载时（在 mockOnPoolReady 内部）捕获的回调
  // 在后续测试中可访问
  const captured: { onPoolReadyCb: ((pool: any) => void) | null } = {
    onPoolReadyCb: null,
  }
  const mockOnPoolReady = vi.fn((cb: (pool: any) => void) => {
    captured.onPoolReadyCb = cb
  })
  return { mockSessionPool, mockOnPoolReady, captured }
})

vi.mock('../../src/services/session-pool.js', () => ({
  sessionPool: mockSessionPool,
  onPoolReady: mockOnPoolReady,
  initSessionPool: vi.fn(),
  getSessionPool: vi.fn(() => mockSessionPool),
}))

// 导入已 Mock 的模块
import * as aiService from '../../src/services/ai.js'

// 导入被测模块（必须在 Mock 定义之后）
import { handleAIWebSocket } from '../../src/routes/ai.js'
import type { ProcessInfo } from '../../src/services/ai.js'

// ===== 辅助函数 =====

function createMockProcessInfo(
  overrides: Partial<ProcessInfo> = {},
): ProcessInfo {
  return {
    proc: {
      pid: 12345,
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

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  readyState: number
  messages: string[]
  handlers: Record<string, Function>
}

function createMockWebSocket(): MockWebSocket {
  const messages: string[] = []
  const handlers: Record<string, Function> = {}
  return {
    send: vi.fn((data: string) => messages.push(data)),
    close: vi.fn(),
    on: vi.fn((event: string, handler: Function) => {
      handlers[event] = handler
    }),
    readyState: 1, // WebSocket.OPEN 状态
    messages,
    handlers,
  }
}

/** 解析 Mock WS 发送的所有 JSON 消息 */
function parseMessages(ws: MockWebSocket): any[] {
  return ws.messages.map((m) => JSON.parse(m))
}

/** 查找第一条匹配类型的消息 */
function findMessage(ws: MockWebSocket, type: string): any {
  return parseMessages(ws).find((m) => m.type === type)
}

/** 模拟客户端在 WS 上发送消息 */
function simulateMessage(ws: MockWebSocket, data: any): void {
  const handler = ws.handlers['message']
  if (handler) {
    handler(Buffer.from(JSON.stringify(data)))
  }
}

/** 等待所有待处理的微任务完成 */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ===== 测试用例 =====

describe('handleAIWebSocket', () => {
  let ws: MockWebSocket
  const sessionId = 'test-session-001'

  beforeEach(() => {
    vi.clearAllMocks()
    ws = createMockWebSocket()
    mockSessionPool.activate.mockReset()
    mockSessionPool.has.mockReset().mockReturnValue(false)
    mockSessionPool.getSessionMeta.mockReset().mockReturnValue(undefined)
    mockSessionPool.registerSessionMeta.mockReset()
  })

  // ===== 延迟激活 =====

  describe('Lazy Activation', () => {
    it('WS 连接时发送 connected 消息，不激活进程', async () => {
      await handleAIWebSocket(ws as any, sessionId)

      // 应立即发送 connected 消息
      const msg = findMessage(ws, 'connected')
      expect(msg).toBeDefined()
      expect(msg.payload.sessionId).toBe(sessionId)

      // 连接时不应调用 activate
      expect(mockSessionPool.activate).not.toHaveBeenCalled()
    })

    it('首次 prompt 触发 ensureProcessActive，发送 activating 和 activated 消息', async () => {
      const processInfo = createMockProcessInfo({ sessionId })
      vi.mocked(aiService.getSessionDetail).mockResolvedValue({
        projectId: 'proj-1',
        projectPath: '/test/project',
      })
      mockSessionPool.activate.mockResolvedValue(processInfo)

      await handleAIWebSocket(ws as any, sessionId)

      // 模拟 prompt 消息
      simulateMessage(ws, { type: 'prompt', content: 'Hello' })

      // 等待异步处理完成
      await flushMicrotasks()

      // 应已调用 activate
      expect(mockSessionPool.activate).toHaveBeenCalledWith(sessionId)

      // 应在调用 activate 前发送 activating，在调用后发送 activated
      const parsed = parseMessages(ws)
      const activatingIdx = parsed.findIndex((m) => m.type === 'activating')
      const activatedIdx = parsed.findIndex((m) => m.type === 'activated')
      expect(activatingIdx).toBeGreaterThanOrEqual(0)
      expect(activatedIdx).toBeGreaterThanOrEqual(0)
      expect(activatedIdx).toBeGreaterThan(activatingIdx)

      // 激活后应调用 sendPrompt
      expect(aiService.sendPrompt).toHaveBeenCalledWith(sessionId, 'Hello')
    })

    it('进程已活跃时 prompt 不重复激活', async () => {
      const processInfo = createMockProcessInfo({ sessionId })
      // 进程已在池中活跃
      mockSessionPool.has.mockReturnValue(true)
      vi.mocked(aiService.getSessionDetail).mockResolvedValue({
        projectId: 'proj-1',
        projectPath: '/test/project',
      })

      await handleAIWebSocket(ws as any, sessionId)

      // 第一个 prompt 激活进程
      mockSessionPool.activate.mockResolvedValue(processInfo)
      simulateMessage(ws, { type: 'prompt', content: 'First' })
      await flushMicrotasks()

      // 重置以跟踪新的调用
      mockSessionPool.activate.mockClear()

      // 第二个 prompt - 进程已活跃
      simulateMessage(ws, { type: 'prompt', content: 'Second' })
      await flushMicrotasks()

      // 进程已活跃，不应再次调用 activate
      expect(mockSessionPool.activate).not.toHaveBeenCalled()
      expect(aiService.sendPrompt).toHaveBeenCalledWith(sessionId, 'Second')
    })

    it('激活失败时发送 error 消息', async () => {
      vi.mocked(aiService.getSessionDetail).mockResolvedValue({
        projectId: 'proj-1',
        projectPath: '/test/project',
      })
      mockSessionPool.activate.mockRejectedValue(new Error('Activation failed'))

      await handleAIWebSocket(ws as any, sessionId)

      // 模拟触发激活失败的 prompt
      simulateMessage(ws, { type: 'prompt', content: 'Hello' })
      await flushMicrotasks()

      const errorMsg = findMessage(ws, 'error')
      expect(errorMsg).toBeDefined()
      expect(errorMsg.payload.message).toBe('发送提示失败')
    })

    it('并发 prompt 共享同一个 pendingActivation Promise，activate 只调用一次', async () => {
      let resolveActivation: (value: ProcessInfo) => void
      const activationPromise = new Promise<ProcessInfo>((resolve) => {
        resolveActivation = resolve
      })
      vi.mocked(aiService.getSessionDetail).mockResolvedValue({
        projectId: 'proj-1',
        projectPath: '/test/project',
      })
      mockSessionPool.activate.mockReturnValue(activationPromise)

      await handleAIWebSocket(ws as any, sessionId)

      // 在激活完成前并发发送两个 prompt
      simulateMessage(ws, { type: 'prompt', content: 'Prompt 1' })
      simulateMessage(ws, { type: 'prompt', content: 'Prompt 2' })

      // 允许微任务调度但暂不 resolve
      await flushMicrotasks()

      // activate 应只被调用一次（pendingActivation 共享）
      expect(mockSessionPool.activate).toHaveBeenCalledTimes(1)

      // 现在 resolve 激活
      const processInfo = createMockProcessInfo({ sessionId })
      resolveActivation!(processInfo)
      await flushMicrotasks()

      // 两个 prompt 都应被发送
      expect(aiService.sendPrompt).toHaveBeenCalledTimes(2)
    })
  })

  // ===== 池回收会话处理 =====

  describe('poolDeactivatedSessions', () => {
    /**
     * 辅助函数：调用 onPoolReady 回调（在模块加载时捕获），
     * 提取 routes/ai.ts 注册的 deactivateNotifier 函数。
     */
    function getDeactivateNotifier(): (sessionId: string, reason: string) => void {
      expect(captured.onPoolReadyCb).toBeDefined()
      const poolArg = { setDeactivateNotifier: vi.fn() }
      captured.onPoolReadyCb!(poolArg)
      expect(poolArg.setDeactivateNotifier).toHaveBeenCalledTimes(1)
      return poolArg.setDeactivateNotifier.mock.calls[0][0]
    }

    it('池回收后 exitHandler 不关闭 WS（poolDeactivatedSessions 中有 sessionId）', async () => {
      const processInfo = createMockProcessInfo({ sessionId })
      vi.mocked(aiService.getSessionDetail).mockResolvedValue({
        projectId: 'proj-1',
        projectPath: '/test/project',
      })
      mockSessionPool.activate.mockResolvedValue(processInfo)

      await handleAIWebSocket(ws as any, sessionId)

      // 通过发送 prompt 激活进程
      simulateMessage(ws, { type: 'prompt', content: 'Hello' })
      await flushMicrotasks()

      // 清除之前的消息以使断言更清晰
      ws.messages.length = 0

      // 获取 routes/ai.ts 通过 onPoolReady 注册的通知函数
      const notifierFn = getDeactivateNotifier()

      // 模拟池回收：通知函数将 sessionId 添加到 poolDeactivatedSessions
      notifierFn(sessionId, 'idle_timeout')

      // 发送 process-exit 事件（模拟进程被池回收终止）
      processInfo.eventEmitter.emit('process-exit', {
        code: 0,
        sessionId,
      })

      // WS 不应被关闭，也不应发送 'close' 消息
      expect(ws.close).not.toHaveBeenCalled()
      expect(findMessage(ws, 'close')).toBeUndefined()

      // 通知函数本身应通过 WS 发送 session-deactivated
      const deactivatedMsg = findMessage(ws, 'session-deactivated')
      expect(deactivatedMsg).toBeDefined()
      expect(deactivatedMsg.sessionId).toBe(sessionId)
      expect(deactivatedMsg.reason).toBe('idle_timeout')
    })

    it('异常退出仍关闭 WS（poolDeactivatedSessions 中没有 sessionId）', async () => {
      const processInfo = createMockProcessInfo({ sessionId })
      vi.mocked(aiService.getSessionDetail).mockResolvedValue({
        projectId: 'proj-1',
        projectPath: '/test/project',
      })
      mockSessionPool.activate.mockResolvedValue(processInfo)

      await handleAIWebSocket(ws as any, sessionId)

      // 激活进程
      simulateMessage(ws, { type: 'prompt', content: 'Hello' })
      await flushMicrotasks()

      // 清除之前的消息
      ws.messages.length = 0

      // 发送 process-exit 但不添加到 poolDeactivatedSessions
      // 模拟异常退出（崩溃）
      processInfo.eventEmitter.emit('process-exit', {
        code: 1,
        sessionId,
      })

      // WS 应被关闭并发送 close 消息
      expect(ws.close).toHaveBeenCalled()
      const closeMsg = findMessage(ws, 'close')
      expect(closeMsg).toBeDefined()
      expect(closeMsg.payload.code).toBe(1)
      expect(closeMsg.payload.sessionId).toBe(sessionId)
    })

    it('exitHandler 处理后从 Set 中删除 sessionId（及时清理不泄漏）', async () => {
      const processInfo = createMockProcessInfo({ sessionId })
      vi.mocked(aiService.getSessionDetail).mockResolvedValue({
        projectId: 'proj-1',
        projectPath: '/test/project',
      })
      mockSessionPool.activate.mockResolvedValue(processInfo)

      await handleAIWebSocket(ws as any, sessionId)

      // 激活进程
      simulateMessage(ws, { type: 'prompt', content: 'Hello' })
      await flushMicrotasks()

      // 获取通知函数
      const notifierFn = getDeactivateNotifier()

      // 通过通知函数将 sessionId 添加到 poolDeactivatedSessions
      notifierFn(sessionId, 'idle_timeout')

      // 发送 process-exit — exitHandler 应处理并从 Set 中删除 sessionId
      processInfo.eventEmitter.emit('process-exit', {
        code: 0,
        sessionId,
      })

      // WS 不应被关闭（池回收路径）
      expect(ws.close).not.toHaveBeenCalled()

      // 创建第二个 WS 验证 Set 已被清理
      // 如果 Set 未被清理，残留条目会导致第二个 WS 的 exitHandler
      // 在没有池回收的情况下也跳过关闭
      const ws2 = createMockWebSocket()
      const processInfo2 = createMockProcessInfo({ sessionId })
      mockSessionPool.has.mockReturnValue(false)
      mockSessionPool.activate.mockResolvedValue(processInfo2)

      await handleAIWebSocket(ws2 as any, sessionId)
      simulateMessage(ws2, { type: 'prompt', content: 'Test' })
      await flushMicrotasks()

      // 发送 ws2 的 process-exit 但不调用通知函数
      // 如果 Set 已被正确清理，此处应关闭 WS
      processInfo2.eventEmitter.emit('process-exit', {
        code: 1,
        sessionId,
      })

      expect(ws2.close).toHaveBeenCalled()
    })
  })
})
