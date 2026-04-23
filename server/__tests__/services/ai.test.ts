/**
 * AI 服务测试
 * 覆盖 ai.ts 的 session 创建/删除、prompt 发送、进程管理、配置读写等核心逻辑
 */
// 在所有 Mock 定义之前先导入 vi
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// Mock child_process 模块
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    spawn: vi.fn(),
  }
})

// Mock fs 模块
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
    rmSync: vi.fn(),
  }
})

// Mock 配置服务
vi.mock('../../src/services/config.js', () => ({
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  invalidateConfigCache: vi.fn(),
}))

// Mock wire-reader 模块
vi.mock('../../src/services/wire-reader.js', () => ({
  extractTitleAsync: vi.fn(),
  extractMessagesStreaming: vi.fn(),
  extractFirstTimestamp: vi.fn(),
}))

// Mock 日志服务
vi.mock('../../src/services/logger.js', () => ({
  aiInfo: vi.fn(),
  aiDebug: vi.fn(),
  aiError: vi.fn(),
}))

// Mock uuid 模块
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-session-id-1234'),
}))

// 使用 vi.hoisted 在 vi.mock 工厂函数执行前定义 Mock 对象
const { mockActiveProcesses, mockSessionMetas, mockSessionPool } = vi.hoisted(() => {
  const mockActiveProcesses = new Map<string, any>()
  const mockSessionMetas = new Map<string, { sessionId: string; projectId: string; projectPath: string }>()
  const mockSessionPool = {
    getProcess: vi.fn((sessionId: string) => mockActiveProcesses.get(sessionId)),
    has: vi.fn((sessionId: string) => mockActiveProcesses.has(sessionId)),
    activate: vi.fn(async (sessionId: string) => {
      const existing = mockActiveProcesses.get(sessionId)
      if (existing) return existing
      const meta = mockSessionMetas.get(sessionId)
      if (!meta) {
        throw new Error(`Session not found: ${sessionId}`)
      }
      const ai = await import('../../src/services/ai.js')
      const processInfo = await ai.startProcess(sessionId, meta.projectPath)
      mockActiveProcesses.set(sessionId, processInfo)
      return processInfo
    }),
    deactivate: vi.fn((sessionId: string) => {
      const info = mockActiveProcesses.get(sessionId)
      if (info) {
        for (const [, pending] of info.pendingRequests) {
          clearTimeout(pending.timer)
          pending.reject(new Error('Process deactivated'))
        }
        try { info.proc.kill() } catch {}
        mockActiveProcesses.delete(sessionId)
      }
    }),
    registerSessionMeta: vi.fn((sessionId: string, projectId: string, projectPath: string) => {
      mockSessionMetas.set(sessionId, { sessionId, projectId, projectPath })
    }),
    getSessionMeta: vi.fn((sessionId: string) => mockSessionMetas.get(sessionId)),
    startEvictionLoop: vi.fn(),
    stopEvictionLoop: vi.fn(),
    shutdown: vi.fn(async () => {}),
    getStats: vi.fn(() => ({ activeCount: mockActiveProcesses.size, maxSessions: 20, inactiveCount: 0, queueLength: 0, totalActivations: 0, totalEvictions: 0, totalQueueTimeouts: 0 })),
    getSessionList: vi.fn(() => []),
    setDeactivateNotifier: vi.fn(),
    get activeCount() { return mockActiveProcesses.size },
  }
  return { mockActiveProcesses, mockSessionMetas, mockSessionPool }
})

vi.mock('../../src/services/session-pool.js', () => ({
  sessionPool: mockSessionPool,
  initSessionPool: vi.fn(),
  onPoolReady: vi.fn(),
  getSessionPool: vi.fn(() => mockSessionPool),
}))

// 导入已 Mock 的模块
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as configService from '../../src/services/config.js'
import { extractTitleAsync, extractMessagesStreaming, extractFirstTimestamp } from '../../src/services/wire-reader.js'

// 导入被测模块（必须在 Mock 定义之后）
import * as ai from '../../src/services/ai.js'

// 创建 Mock 进程的辅助函数
function createMockProcess() {
  const emitter = new EventEmitter()
  const writtenData: string[] = []

  return {
    pid: 12345,
    killed: false,
    exitCode: null,
    stdin: {
      write: vi.fn((data: string) => {
        writtenData.push(data)
        return true
      }),
    },
    stdout: {
      on: vi.fn((event: string, cb: Function) => {
        if (event === 'data') {
          // 立即发送初始化响应
          process.nextTick(() => {
            cb(Buffer.from(JSON.stringify({ id: 'init', result: { protocol_version: '1.8' } }) + '\n'))
          })
        }
        return emitter
      }),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event: string, cb: Function) => {
      emitter.on(event, cb as any)
    }),
    emit: (event: string, ...args: any[]) => emitter.emit(event, ...args),
    kill: vi.fn((signal?: string) => {
      emitter.emit('close', 1, signal || 'SIGTERM')
    }),
    writtenData,
  }
}

describe('AiService', () => {
  let mockProcess: ReturnType<typeof createMockProcess>
  let mockConfig: any

  beforeEach(() => {
    vi.resetAllMocks()
    mockActiveProcesses.clear()
    mockSessionMetas.clear()

    mockProcess = createMockProcess()
    mockConfig = {
      projects: [{ id: 'project-1', path: '/test/project' }],
      projectSessions: {},
      aiPromptTimeout: 10,
      yolo: false,
    }

    vi.mocked(configService.getConfig).mockReturnValue(mockConfig)
    vi.mocked(configService.saveConfig).mockImplementation((config) => {
      if (config) mockConfig = config
      return mockConfig
    })
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.rmSync).mockImplementation(() => {})
    vi.mocked(extractTitleAsync).mockResolvedValue('新对话')
    vi.mocked(extractMessagesStreaming).mockResolvedValue([])
    vi.mocked(spawn).mockReturnValue(mockProcess as any)
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('createSession', () => {
    it('should create new session and save to config', async () => {
      const result = await ai.createSession('project-1', '/test/project')

      expect(result.sessionId).toBe('test-session-id-1234')
      expect(result.projectPath).toBe('/test/project')
      expect(vi.mocked(configService.saveConfig)).toHaveBeenCalled()
      expect(mockConfig.projectSessions['project-1']).toContain('test-session-id-1234')
    })

    it('should add session to existing projectSessions array', async () => {
      mockConfig.projectSessions = { 'project-1': ['existing-session'] }

      await ai.createSession('project-1', '/test/project')

      expect(mockConfig.projectSessions['project-1']).toHaveLength(2)
    })

    it('should create projectSessions if not exists', async () => {
      mockConfig.projectSessions = undefined

      await ai.createSession('project-1', '/test/project')

      expect(mockConfig.projectSessions).toBeDefined()
    })

    it('should not call sessionPool.activate', async () => {
      await ai.createSession('project-1', '/test/project')

      expect(mockSessionPool.activate).not.toHaveBeenCalled()
    })
  })

  describe('getProcess', () => {
    it('should return undefined for non-existent session', () => {
      expect(ai.getProcess('non-existent')).toBeUndefined()
    })
  })

  describe('deleteSession', () => {
    it('should remove session from config', async () => {
      mockConfig.projectSessions = { 'project-1': ['session-1', 'session-2'] }

      await ai.deleteSession('session-1')

      expect(mockConfig.projectSessions['project-1']).toHaveLength(1)
      expect(mockConfig.projectSessions['project-1']).toContain('session-2')
    })

    it('should delete empty projectSessions entry', async () => {
      mockConfig.projectSessions = { 'project-1': ['session-1'] }

      await ai.deleteSession('session-1')

      expect(mockConfig.projectSessions['project-1']).toBeUndefined()
    })

    it('should not call rmSync without projectPath', async () => {
      mockConfig.projectSessions = {}

      await ai.deleteSession('unknown-session')

      expect(vi.mocked(fs.rmSync)).not.toHaveBeenCalled()
    })
  })

  describe('listSessions', () => {
    it('should return all sessions for a project', async () => {
      mockConfig.projectSessions = { 'project-1': ['session-1', 'session-2'] }

      const sessions = await ai.listSessions('project-1')

      expect(sessions.length).toBe(2)
      expect(sessions.map(s => s.id)).toEqual(['session-1', 'session-2'])
    })

    it('should return empty array for project without sessions', async () => {
      mockConfig.projectSessions = {}

      const sessions = await ai.listSessions('project-1')

      expect(sessions).toEqual([])
    })

    it('should extract title from wire.jsonl', async () => {
      mockConfig.projectSessions = { 'project-1': ['session-1'] }
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(extractTitleAsync).mockResolvedValue('Test Title')
      vi.mocked(extractFirstTimestamp).mockResolvedValue(Date.now())

      const sessions = await ai.listSessions('project-1')

      expect(sessions[0].title).toBe('Test Title')
    })
  })

  describe('getSessionDetail', () => {
    it('should return null for unknown session', async () => {
      const result = await ai.getSessionDetail('unknown-session')
      expect(result).toBeNull()
    })

    it('should return session detail with messages', async () => {
      mockConfig.projectSessions = { 'project-1': ['session-1'] }
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(extractTitleAsync).mockResolvedValue('Test Title')
      vi.mocked(extractFirstTimestamp).mockResolvedValue(Date.now())
      vi.mocked(extractMessagesStreaming).mockResolvedValue([
        { id: 'msg-1', role: 'user', type: 'text', content: { text: 'Hello' }, timestamp: 1000 },
      ])

      const result = await ai.getSessionDetail('session-1')

      expect(result).toBeDefined()
      expect(result?.title).toBe('Test Title')
      expect(result?.messages).toHaveLength(1)
    })
  })

  describe('checkInstalled', () => {
    it('should return unavailable status before initAI', () => {
      const status = ai.checkInstalled()
      expect(status.available).toBe(false)
    })
  })

  describe('stopProcess', () => {
    it('should do nothing for non-existent session', () => {
      ai.stopProcess('non-existent')
      // 不应抛出异常
    })
  })

  describe('getEventEmitter', () => {
    it('should return undefined for non-existent session', () => {
      expect(ai.getEventEmitter('non-existent')).toBeUndefined()
    })
  })

  describe('respondApproval', () => {
    it('should throw error for non-existent session', () => {
      expect(() => ai.respondApproval('non-existent', 'request-id', 'approve')).toThrow('Session not found')
    })
  })

  describe('cancelGeneration', () => {
    it('should throw error for non-existent session', () => {
      expect(() => ai.cancelGeneration('non-existent')).toThrow('Session not found')
    })
  })

  describe('sendPrompt', () => {
    it('should throw error for non-existent session without restart', async () => {
      mockConfig.projectSessions = {}
      await expect(ai.sendPrompt('non-existent', 'message')).rejects.toThrow('Session not found')
    })
  })

  describe('config yolo flag', () => {
    it('should not spawn process during createSession', async () => {
      mockConfig.yolo = true
      vi.mocked(spawn).mockClear()

      // createSession 不再启动进程（延迟激活）
      await ai.createSession('project-1', '/test/project')

      // spawn 不应被调用，因为 createSession 只注册元数据
      expect(vi.mocked(spawn)).not.toHaveBeenCalled()
      expect(mockSessionPool.activate).not.toHaveBeenCalled()
    })
  })
})