/**
 * 日志服务测试
 * 覆盖 logger.ts 的初始化、日志级别控制、按日期轮换、旧日志清理逻辑
 */
// 先导入 vi，确保在 Mock 之前可用
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// 优先 Mock os 模块
vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}))

// Mock path 模块
vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>()
  return {
    ...actual,
    join: vi.fn((...args: string[]) => args.join('/')),
  }
})

// 全局流实例，可在模块重新加载后跟踪
let globalMockStream: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } | null = null

// Mock fs 模块
vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
  createWriteStream: vi.fn(() => {
    globalMockStream = {
      write: vi.fn(),
      end: vi.fn(),
    }
    return globalMockStream as any
  }),
}))

// Mock console
vi.stubGlobal('console', {
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
})

// 导入已 Mock 的模块
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * 获取当前全局流实例
 * @returns 当前全局 Mock 流，可能为 null
 */
function getGlobalStream() {
  return globalMockStream
}

/**
 * 在 initLogger 前重置全局流
 */
function resetGlobalStream() {
  globalMockStream = null
}

describe('Logger', () => {
  const logDir = '/home/testuser/.wikibrowser/logs'

  beforeEach(() => {
    vi.resetAllMocks()
    resetGlobalStream()

    // 重置模块状态 — 清除 logger.ts 的内部状态
    vi.resetModules()

    // 重置 os Mock
    vi.mocked(os.homedir).mockReturnValue('/home/testuser')

    // 重置 path Mock
    vi.mocked(path.join).mockImplementation((...args: string[]) => args.join('/'))

    // 重置 console Mock
    vi.mocked(console.log).mockReset()
    vi.mocked(console.error).mockReset()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('initLogger', () => {
    it('should create log directory on init', async () => {
      const { initLogger } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })

      expect(fs.mkdirSync).toHaveBeenCalledWith(logDir, { recursive: true })
    })

    it('should default to info log level', async () => {
      const { initLogger, aiDebug } = await import('../../src/services/logger.js')
      initLogger({})

      // aiDebug 在 info 级别不应写入文件
      aiDebug('test message')
      const stream = getGlobalStream()
      expect(stream!.write).not.toHaveBeenCalled()
    })

    it('should create log file with current date', async () => {
      const { initLogger } = await import('../../src/services/logger.js')
      const today = new Date().toISOString().substring(0, 10)
      initLogger({})

      expect(fs.createWriteStream).toHaveBeenCalledWith(
        `${logDir}/wikibrowser-${today}.log`,
        { flags: 'a' }
      )
    })

    it('should clean old logs with default retention days', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue([])
      const { initLogger } = await import('../../src/services/logger.js')

      initLogger({})

      expect(fs.readdirSync).toHaveBeenCalledWith(logDir)
    })

    it('should clean old logs with custom retention days', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue([])
      const { initLogger } = await import('../../src/services/logger.js')

      initLogger({ retentionDays: 14 })

      expect(fs.readdirSync).toHaveBeenCalledWith(logDir)
    })
  })

  describe('serverLog', () => {
    it('should write log to file', async () => {
      const { initLogger, serverLog } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      serverLog('test message')

      expect(stream.write).toHaveBeenCalled()
      const writtenContent = stream.write.mock.calls[0][0]
      expect(writtenContent).toContain('[Server]')
      expect(writtenContent).toContain('test message')
    })

    it('should output to console.log', async () => {
      const { initLogger, serverLog } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })

      serverLog('test', 'multiple', 'args')

      expect(console.log).toHaveBeenCalledWith('test', 'multiple', 'args')
    })

    it('should format log with timestamp and prefix', async () => {
      const { initLogger, serverLog } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      serverLog('test message')

      const writtenContent = stream.write.mock.calls[0][0]
      // 检查时间戳格式：[YYYY-MM-DDTHH:MM:SS.sssZ]
      expect(writtenContent).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/)
      expect(writtenContent).toContain('[Server]')
      expect(writtenContent).toContain('test message')
      expect(writtenContent).toMatch(/\n$/) // 应以换行符结尾
    })

    it('should handle multiple arguments', async () => {
      const { initLogger, serverLog } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      serverLog('message1', 'message2', 123)

      const writtenContent = stream.write.mock.calls[0][0]
      expect(writtenContent).toContain('message1 message2 123')
    })

    it('should convert non-string arguments to string', async () => {
      const { initLogger, serverLog } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      serverLog('value:', 42, { key: 'value' })

      const writtenContent = stream.write.mock.calls[0][0]
      expect(writtenContent).toContain('42')
      expect(writtenContent).toContain('[object Object]')
    })
  })

  describe('serverError', () => {
    it('should write error to file', async () => {
      const { initLogger, serverError } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      serverError('error message')

      expect(stream.write).toHaveBeenCalled()
      const writtenContent = stream.write.mock.calls[0][0]
      expect(writtenContent).toContain('[ERROR]')
      expect(writtenContent).toContain('error message')
    })

    it('should output to console.error', async () => {
      const { initLogger, serverError } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })

      serverError('error', 'details')

      expect(console.error).toHaveBeenCalledWith('error', 'details')
    })

    it('should format with timestamp and ERROR prefix', async () => {
      const { initLogger, serverError } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      serverError('something went wrong')

      const writtenContent = stream.write.mock.calls[0][0]
      expect(writtenContent).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/)
      expect(writtenContent).toContain('[ERROR]')
      expect(writtenContent).toContain('something went wrong')
    })
  })

  describe('aiInfo', () => {
    it('should write AI info to file', async () => {
      const { initLogger, aiInfo } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      aiInfo('AI started')

      expect(stream.write).toHaveBeenCalled()
      const writtenContent = stream.write.mock.calls[0][0]
      expect(writtenContent).toContain('[AI]')
      expect(writtenContent).toContain('AI started')
    })

    it('should always output to console.log', async () => {
      const { initLogger, aiInfo } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })

      aiInfo('important event')

      expect(console.log).toHaveBeenCalledWith('important event')
    })

    it('should format with timestamp and AI prefix', async () => {
      const { initLogger, aiInfo } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      aiInfo('processing request')

      const writtenContent = stream.write.mock.calls[0][0]
      expect(writtenContent).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/)
      expect(writtenContent).toContain('[AI]')
    })
  })

  describe('aiDebug', () => {
    it('should not write to file at info level', async () => {
      const { initLogger, aiDebug } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      aiDebug('debug message')

      expect(stream.write).not.toHaveBeenCalled()
    })

    it('should never output to console even at debug level', async () => {
      const { initLogger, aiDebug } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'debug' })

      aiDebug('debug message')

      expect(console.log).not.toHaveBeenCalled()
    })

    it('should write to file at debug level', async () => {
      const { initLogger, aiDebug } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'debug' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      aiDebug('debug message')

      expect(stream.write).toHaveBeenCalled()
      const writtenContent = stream.write.mock.calls[0][0]
      expect(writtenContent).toContain('[AI DEBUG]')
      expect(writtenContent).toContain('debug message')
    })

    it('should write to file with AI DEBUG prefix and timestamp', async () => {
      const { initLogger, aiDebug } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'debug' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      aiDebug('detailed info')

      const writtenContent = stream.write.mock.calls[0][0]
      expect(writtenContent).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/)
      expect(writtenContent).toContain('[AI DEBUG]')
      expect(writtenContent).toContain('detailed info')
    })
  })

  describe('aiError', () => {
    it('should write AI error to file', async () => {
      const { initLogger, aiError } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      aiError('AI failed')

      expect(stream.write).toHaveBeenCalled()
      const writtenContent = stream.write.mock.calls[0][0]
      expect(writtenContent).toContain('[AI ERROR]')
      expect(writtenContent).toContain('AI failed')
    })

    it('should always output to console.error', async () => {
      const { initLogger, aiError } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })

      aiError('critical error')

      expect(console.error).toHaveBeenCalledWith('critical error')
    })

    it('should format with timestamp and AI ERROR prefix', async () => {
      const { initLogger, aiError } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      aiError('processing error')

      const writtenContent = stream.write.mock.calls[0][0]
      expect(writtenContent).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/)
      expect(writtenContent).toContain('[AI ERROR]')
    })
  })

  describe('日志级别控制', () => {
    it('should serverLog always output to console regardless of log level', async () => {
      const { initLogger, serverLog } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      vi.mocked(console.log).mockClear()
      serverLog('server message')
      expect(console.log).toHaveBeenCalledWith('server message')
    })

    it('should serverError always output to console regardless of log level', async () => {
      const { initLogger, serverError } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      vi.mocked(console.error).mockClear()
      serverError('server error')
      expect(console.error).toHaveBeenCalledWith('server error')
    })

    it('should aiInfo always output to console regardless of log level', async () => {
      const { initLogger, aiInfo } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      vi.mocked(console.log).mockClear()
      aiInfo('ai info')
      expect(console.log).toHaveBeenCalledWith('ai info')
    })

    it('should aiDebug never output to console', async () => {
      vi.resetModules()
      resetGlobalStream()
      const module1 = await import('../../src/services/logger.js')
      module1.initLogger({ logLevel: 'debug' })
      module1.aiDebug('ai debug')
      expect(console.log).not.toHaveBeenCalled()
    })

    it('should aiError always output to console regardless of log level', async () => {
      const { initLogger, aiError } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      vi.mocked(console.error).mockClear()
      aiError('ai error')
      expect(console.error).toHaveBeenCalledWith('ai error')
    })

    it('should aiDebug write to file only at debug level', async () => {
      vi.resetModules()
      resetGlobalStream()

      // info level - should not write to file
      const module1 = await import('../../src/services/logger.js')
      module1.initLogger({ logLevel: 'info' })
      module1.aiDebug('ai debug')
      const stream1 = getGlobalStream()
      expect(stream1!.write).not.toHaveBeenCalled()

      vi.resetModules()
      resetGlobalStream()

      // debug level - should write to file
      const module2 = await import('../../src/services/logger.js')
      module2.initLogger({ logLevel: 'debug' })
      module2.aiDebug('ai debug')
      const stream2 = getGlobalStream()
      expect(stream2!.write).toHaveBeenCalled()
    })

    it('should error level functions always write to file even at info level', async () => {
      const { initLogger, serverError, aiError } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      serverError('server error')
      aiError('ai error')

      expect(stream.write).toHaveBeenCalledTimes(2)
    })
  })

  describe('日志文件按日期轮换', () => {
    it('should create new log file when date changes', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-15T10:00:00Z'))

      vi.resetModules()
      resetGlobalStream()
      const { initLogger, serverLog } = await import('../../src/services/logger.js')
      initLogger({})

      expect(fs.createWriteStream).toHaveBeenCalledWith(
        `${logDir}/wikibrowser-2026-01-15.log`,
        { flags: 'a' }
      )
      expect(fs.createWriteStream).toHaveBeenCalledTimes(1)

      // 清除 Mock 并模拟日期变更
      vi.mocked(fs.createWriteStream).mockClear()
      vi.setSystemTime(new Date('2026-01-16T10:00:00Z'))

      // 写入应触发日期检查和轮换
      serverLog('test after midnight')

      // 应关闭旧流并创建新流
      expect(fs.createWriteStream).toHaveBeenCalledWith(
        `${logDir}/wikibrowser-2026-01-16.log`,
        { flags: 'a' }
      )

      vi.useRealTimers()
    })

    it('should reuse same stream when date has not changed', async () => {
      vi.resetModules()
      resetGlobalStream()
      const { initLogger, serverLog } = await import('../../src/services/logger.js')
      initLogger({})

      expect(fs.createWriteStream).toHaveBeenCalledTimes(1)
      vi.mocked(fs.createWriteStream).mockClear()

      // 同一天多次写入
      serverLog('message 1')
      serverLog('message 2')

      // 不应创建新流
      expect(fs.createWriteStream).toHaveBeenCalledTimes(0)
    })
  })

  describe('清理旧日志文件', () => {
    it('should delete log files older than retention days', async () => {
      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 10) // 10 天前
      const oldTimestamp = oldDate.getTime()

      vi.mocked(fs.readdirSync).mockReturnValue([
        'wikibrowser-2026-01-01.log', // 旧文件
        'wikibrowser-2026-01-05.log', // 旧文件
        'wikibrowser-2026-04-17.log', // 当前文件
      ] as any)

      vi.mocked(fs.statSync).mockImplementation((filePath: string) => {
        const fileName = filePath.split('/').pop()!
        if (fileName === 'wikibrowser-2026-01-01.log' || fileName === 'wikibrowser-2026-01-05.log') {
          return { mtimeMs: oldTimestamp } as any
        }
        return { mtimeMs: Date.now() } as any
      })

      vi.resetModules()
      const { initLogger } = await import('../../src/services/logger.js')
      initLogger({ retentionDays: 7 })

      expect(fs.unlinkSync).toHaveBeenCalledTimes(2)
    })

    it('should not delete recent log files', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue([
        'wikibrowser-2026-04-15.log',
        'wikibrowser-2026-04-16.log',
        'wikibrowser-2026-04-17.log',
      ] as any)

      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: Date.now() } as any)

      vi.resetModules()
      const { initLogger } = await import('../../src/services/logger.js')
      initLogger({ retentionDays: 7 })

      expect(fs.unlinkSync).not.toHaveBeenCalled()
    })

    it('should ignore non-log files in log directory', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue([
        'other-file.txt',
        'wikibrowser-2026-04-17.log',
        'readme.md',
      ] as any)

      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: Date.now() } as any)

      vi.resetModules()
      const { initLogger } = await import('../../src/services/logger.js')
      initLogger({ retentionDays: 7 })

      // 应只处理 .log 文件
      expect(fs.statSync).toHaveBeenCalledTimes(1)
      expect(fs.statSync).toHaveBeenCalledWith(`${logDir}/wikibrowser-2026-04-17.log`)
    })

    it('should only delete files matching wikibrowser-*.log pattern', async () => {
      const oldTimestamp = Date.now() - 10 * 24 * 60 * 60 * 1000 // 10 天前

      vi.mocked(fs.readdirSync).mockReturnValue([
        'wikibrowser-2026-01-01.log',
        'other-2026-01-01.log', // 应被忽略
        'wikibrowser-old.txt', // 应被忽略
      ] as any)

      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: oldTimestamp } as any)

      vi.resetModules()
      const { initLogger } = await import('../../src/services/logger.js')
      initLogger({ retentionDays: 7 })

      expect(fs.unlinkSync).toHaveBeenCalledTimes(1)
      expect(fs.unlinkSync).toHaveBeenCalledWith(`${logDir}/wikibrowser-2026-01-01.log`)
    })

    it('should handle cleanup errors gracefully', async () => {
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('Read directory failed')
      })

      vi.resetModules()
      const { initLogger } = await import('../../src/services/logger.js')

      // 不应抛出异常
      expect(() => initLogger({ retentionDays: 7 })).not.toThrow()
    })

    it('should handle stat errors gracefully during cleanup', async () => {
      vi.mocked(fs.readdirSync).mockReturnValue([
        'wikibrowser-2026-01-01.log',
      ] as any)

      vi.mocked(fs.statSync).mockImplementation(() => {
        throw new Error('Stat failed')
      })

      vi.resetModules()
      const { initLogger } = await import('../../src/services/logger.js')

      // 不应抛出异常
      expect(() => initLogger({ retentionDays: 7 })).not.toThrow()
    })

    it('should handle unlink errors gracefully during cleanup', async () => {
      const oldTimestamp = Date.now() - 10 * 24 * 60 * 60 * 1000

      vi.mocked(fs.readdirSync).mockReturnValue([
        'wikibrowser-2026-01-01.log',
      ] as any)

      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: oldTimestamp } as any)
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw new Error('Unlink failed')
      })

      vi.resetModules()
      const { initLogger } = await import('../../src/services/logger.js')

      // 不应抛出异常
      expect(() => initLogger({ retentionDays: 7 })).not.toThrow()
    })
  })

  describe('文件写入', () => {
    it('should append to log file (flags: a)', async () => {
      vi.resetModules()
      resetGlobalStream()
      const { initLogger } = await import('../../src/services/logger.js')
      initLogger({})

      expect(fs.createWriteStream).toHaveBeenCalledWith(
        expect.any(String),
        { flags: 'a' }
      )
    })

    it('should write each log message with newline', async () => {
      vi.resetModules()
      resetGlobalStream()
      const { initLogger, serverLog } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      serverLog('first message')
      serverLog('second message')

      expect(stream.write).toHaveBeenCalledTimes(2)

      const firstCall = stream.write.mock.calls[0][0]
      const secondCall = stream.write.mock.calls[1][0]

      expect(firstCall).toMatch(/\n$/)
      expect(secondCall).toMatch(/\n$/)
    })

    it('should handle null stream gracefully', async () => {
      // 强制 createWriteStream 返回 null
      vi.mocked(fs.createWriteStream).mockReturnValue(null as any)

      vi.resetModules()
      resetGlobalStream()
      const { initLogger, serverLog } = await import('../../src/services/logger.js')

      // 重新初始化日志器
      initLogger({})

      // 流为 null 时不应抛出异常
      expect(() => serverLog('test')).not.toThrow()
    })
  })

  describe('格式化', () => {
    it('should include ISO timestamp in log output', async () => {
      vi.resetModules()
      resetGlobalStream()
      const { initLogger, serverLog } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      serverLog('test')

      const writtenContent = stream.write.mock.calls[0][0]
      // ISO 时间戳格式：YYYY-MM-DDTHH:MM:SS.sssZ
      expect(writtenContent).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/)
    })

    it('should include correct prefix for each log type at debug level', async () => {
      vi.resetModules()
      resetGlobalStream()
      const { initLogger, serverLog, serverError, aiInfo, aiDebug, aiError } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'debug' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      serverLog('msg')
      expect(stream.write.mock.calls[0][0]).toContain('[Server]')

      serverError('msg')
      expect(stream.write.mock.calls[1][0]).toContain('[ERROR]')

      aiInfo('msg')
      expect(stream.write.mock.calls[2][0]).toContain('[AI]')

      aiDebug('msg')
      expect(stream.write.mock.calls[3][0]).toContain('[AI DEBUG]')

      aiError('msg')
      expect(stream.write.mock.calls[4][0]).toContain('[AI ERROR]')
    })

    it('should not write aiDebug to file at info level', async () => {
      vi.resetModules()
      resetGlobalStream()
      const { initLogger, serverLog, aiDebug } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      serverLog('msg')   // 已写入（info 级别）
      aiDebug('secret')  // 未写入（debug 级别被过滤）

      expect(stream.write).toHaveBeenCalledTimes(1)
      expect(stream.write.mock.calls[0][0]).toContain('[Server]')
    })

    it('should join multiple arguments with space', async () => {
      vi.resetModules()
      resetGlobalStream()
      const { initLogger, serverLog } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      serverLog('arg1', 'arg2', 'arg3')

      const writtenContent = stream.write.mock.calls[0][0]
      expect(writtenContent).toContain('arg1 arg2 arg3')
    })

    it('should convert all arguments to string', async () => {
      vi.resetModules()
      resetGlobalStream()
      const { initLogger, serverLog } = await import('../../src/services/logger.js')
      initLogger({ logLevel: 'info' })
      const stream = getGlobalStream()
      if (!stream) throw new Error('Stream not initialized')

      serverLog('string', 123, true, null, undefined)

      const writtenContent = stream.write.mock.calls[0][0]
      expect(writtenContent).toContain('string 123 true null undefined')
    })
  })
})
