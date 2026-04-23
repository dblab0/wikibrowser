/**
 * 服务端测试 Mock 工具集
 * 提供 Database、文件系统、WebSocket、wire 协议等常用 mock 工厂函数
 */
import { vi } from 'vitest'
import { Readable } from 'stream'

// ===== 数据库 Mock =====

/**
 * Mock better-sqlite3，使用内存数据库替代
 * 通过 vi.stubGlobal 将 Database 构造函数注入全局
 * @returns mockDatabase 构造函数，可用于后续断言
 */
export function mockDb() {
  const mockDatabase = vi.fn().mockImplementation(() => {
    const tables: Map<string, any[]> = new Map()

    return {
      exec: vi.fn((sql: string) => {
        // 简单 mock：解析 CREATE TABLE 语句
        const match = sql.match(/CREATE TABLE (\w+)/i)
        if (match) tables.set(match[1], [])
      }),
      prepare: vi.fn((sql: string) => {
        return {
          run: vi.fn((params: any) => ({ changes: 1 })),
          get: vi.fn((params: any) => null),
          all: vi.fn((params: any) => []),
          pluck: vi.fn().mockReturnThis(),
        }
      }),
      transaction: vi.fn((fn: Function) => fn),
      close: vi.fn(),
    }
  })

  vi.stubGlobal('Database', mockDatabase)
  return mockDatabase
}

// ===== 文件系统 Mock =====

/**
 * Mock fs 同步文件系统操作
 * @param files - 初始文件内容映射表，键为文件路径，值为文件内容
 * @returns fileContents（文件内容 Map）和 mockFsModule（mock 模块对象）
 */
export function mockFs(files: Record<string, string> = {}) {
  const fileContents = new Map(Object.entries(files))

  const mockFsModule = {
    existsSync: vi.fn((path: string) => fileContents.has(path)),
    readFileSync: vi.fn((path: string) => {
      const content = fileContents.get(path)
      if (content === undefined) {
        const error = new Error(`ENOENT: no such file or directory, open '${path}'`)
        error.code = 'ENOENT'
        throw error
      }
      return content
    }),
    writeFileSync: vi.fn((path: string, content: string) => {
      fileContents.set(path, content)
    }),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn((path: string) => []),
    statSync: vi.fn((path: string) => ({
      mtimeMs: Date.now(),
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    })),
    lstatSync: vi.fn((path: string) => ({
      isSymbolicLink: () => false,
      isDirectory: () => false,
    })),
    createReadStream: vi.fn((path: string, options?: { encoding?: string }) => {
      const content = fileContents.get(path) || ''
      const lines = content.split('\n')

      return new Readable({
        read() {
          lines.forEach(line => this.push(line + '\n'))
          this.push(null)
        }
      })
    }),
  }

  vi.mock('fs', () => mockFsModule)

  return {
    fileContents,
    mockFsModule,
  }
}

/**
 * Mock fs/promises 异步文件系统模块
 * @param files - 初始文件内容映射表，键为文件路径，值为文件内容
 * @returns fileContents（文件内容 Map）和 mockFsPromisesModule（mock 模块对象）
 */
export function mockFsPromises(files: Record<string, string> = {}) {
  const fileContents = new Map(Object.entries(files))

  const mockFsPromisesModule = {
    readFile: vi.fn((path: string, encoding?: string) => {
      const content = fileContents.get(path)
      if (content === undefined) {
        const error = new Error(`ENOENT: no such file or directory, open '${path}'`)
        error.code = 'ENOENT'
        return Promise.reject(error)
      }
      return Promise.resolve(content)
    }),
    writeFile: vi.fn((path: string, content: string) => {
      fileContents.set(path, content)
      return Promise.resolve()
    }),
    stat: vi.fn((path: string) => {
      if (!fileContents.has(path)) {
        const error = new Error(`ENOENT: no such file or directory, stat '${path}'`)
        error.code = 'ENOENT'
        return Promise.reject(error)
      }
      return Promise.resolve({
        mtimeMs: Date.now(),
        isDirectory: () => false,
        isFile: () => true,
      })
    }),
  }

  vi.mock('fs/promises', () => mockFsPromisesModule)

  return {
    fileContents,
    mockFsPromisesModule,
  }
}

// ===== WebSocket Mock =====

/**
 * Mock WebSocket 服务器及客户端
 * 替换 ws 模块，提供模拟的 WebSocketServer 和 WebSocket 实例
 * @returns mockWs（模拟的 WebSocket 客户端）和 mockWebSocketServer（模拟的服务器构造函数）
 */
export function mockWebSocket() {
  const mockWs = {
    on: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1, // OPEN 状态
  }

  const mockWebSocketServer = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    clients: new Set(),
    close: vi.fn(),
  }))

  vi.mock('ws', () => ({
    WebSocketServer: mockWebSocketServer,
    WebSocket: {
      OPEN: 1,
      CLOSED: 3,
    },
  }))

  return {
    mockWs,
    mockWebSocketServer,
  }
}

// ===== Wire 协议工具 =====

/**
 * 创建 wire.jsonl 格式的内容
 * @param events - wire 事件数组，每项包含 timestamp 和 message
 * @returns 拼接后的 JSONL 字符串，每行一个 JSON 事件
 */
export function createWireJsonl(
  events: Array<{ timestamp: number; message: { type: string; payload?: any } }>
): string {
  return events.map(e => JSON.stringify(e)).join('\n')
}

/**
 * 清除所有 mock 并重置模块
 * 调用 vi.clearAllMocks 和 vi.resetModules
 */
export function clearAllMocks() {
  vi.clearAllMocks()
  vi.resetModules()
}

/**
 * 创建单个 wire 协议事件
 * @param type - 事件类型，如 TurnBegin、ContentPart 等
 * @param payload - 事件载荷
 * @param timestamp - 时间戳（秒），默认为当前时间
 * @returns 符合 wire 协议格式的事件对象
 */
export function createWireEvent(
  type: string,
  payload: any,
  timestamp: number = Date.now() / 1000
): { timestamp: number; message: { type: string; payload: any } } {
  return {
    timestamp,
    message: {
      type,
      payload,
    },
  }
}

/**
 * 常用 wire 事件工厂集合
 * 提供各类型 wire 协议事件的快捷创建方法
 */
export const wireEvents = {
  metadata: (data: any = {}) => createWireEvent('metadata', data),
  turnBegin: (userInput: string | any[], timestamp?: number) =>
    createWireEvent('TurnBegin', { user_input: userInput }, timestamp),
  contentPartText: (text: string, timestamp?: number) =>
    createWireEvent('ContentPart', { type: 'text', text }, timestamp),
  contentPartThink: (think: string, timestamp?: number) =>
    createWireEvent('ContentPart', { type: 'think', think }, timestamp),
  stepBegin: (timestamp?: number) => createWireEvent('StepBegin', {}, timestamp),
  toolCall: (id: string, functionName: string, args: string, timestamp?: number) =>
    createWireEvent('ToolCall', { id, function: { name: functionName, arguments: args } }, timestamp),
  toolResult: (toolCallId: string, output: string, isError: boolean = false, timestamp?: number) =>
    createWireEvent('ToolResult', { tool_call_id: toolCallId, return_value: { output, is_error: isError } }, timestamp),
  approvalRequest: (id: string, toolCallId: string, action: string, description: string, display: any[] = [], timestamp?: number) =>
    createWireEvent('ApprovalRequest', { id, tool_call_id: toolCallId, action, description, display }, timestamp),
  subagentEvent: (
    parentToolCallId: string,
    agentId: string,
    subagentType: string,
    innerEvent: { type: string; payload: any },
    timestamp?: number
  ) =>
    createWireEvent('SubagentEvent', {
      parent_tool_call_id: parentToolCallId,
      agent_id: agentId,
      subagent_type: subagentType,
      event: innerEvent,
    }, timestamp),
  turnEnd: (timestamp?: number) => createWireEvent('TurnEnd', {}, timestamp),
}