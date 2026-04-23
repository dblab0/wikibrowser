/**
 * Wire Reader 测试
 * 覆盖 wire-reader.ts 的标题提取、消息流解析、CTX 上下文标记处理等逻辑
 */
// 在所有 Mock 定义之前先导入 vi
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Readable } from 'stream'

// 对 fs 使用部分 Mock，未 Mock 的方法保留真实实现
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
    createReadStream: vi.fn(),
  }
})

// 对 fs/promises 使用部分 Mock
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(),
  }
})

// 对 readline 使用部分 Mock，必须包含默认导出
vi.mock('readline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('readline')>()
  return {
    ...actual,
    default: {
      ...actual,
      createInterface: vi.fn(),
    },
    createInterface: vi.fn(),
  }
})

// 导入已 Mock 的模块
import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import readline from 'readline'

// 导入被测模块
import {
  extractTitleAsync,
  extractMessagesStreaming,
} from '../../src/services/wire-reader.js'

// 辅助函数
function createMockReadStream(content: string): Readable {
  const lines = content.split('\n')
  let index = 0

  // 创建可供 readline 消费的可读流
  const stream = new Readable({
    read() {
      if (index < lines.length) {
        this.push(lines[index] + '\n')
        index++
      } else {
        this.push(null)
      }
    },
  })

  return stream
}

function createWireJsonl(
  events: Array<{ timestamp: number; message: { type: string; payload?: any } }>
): string {
  return events.map(e => JSON.stringify(e)).join('\n')
}

function createMockReadlineInterface(content: string) {
  // 立即从内容中解析行
  const lines = content.split('\n').filter(l => l.trim())

  // 创建实现异步迭代器的对象
  const interfaceObj = {
    [Symbol.asyncIterator]: async function* () {
      for (const line of lines) {
        yield line.trim()
      }
    },
    close: vi.fn(),
    on: vi.fn((event: string, callback: Function) => {
      if (event === 'close') {
        process.nextTick(() => callback())
      }
      return interfaceObj
    }),
    pause: vi.fn(),
    resume: vi.fn(),
    output: null,
    completer: null,
    terminal: false,
  }

  return interfaceObj as any
}

describe('WireReader', () => {
  let mockFileContents: Map<string, string>

  beforeEach(() => {
    mockFileContents = new Map()
    vi.resetAllMocks()

    // 设置 fs.existsSync 的 Mock
    vi.mocked(fs.existsSync).mockImplementation((path: string) => {
      return mockFileContents.has(path)
    })

    // 设置 fs.createReadStream 的 Mock
    vi.mocked(fs.createReadStream).mockImplementation((path: string) => {
      const content = mockFileContents.get(path) || ''
      return createMockReadStream(content)
    })

    // 设置 fs/promises.readFile 的 Mock
    vi.mocked(fsPromises.readFile).mockImplementation((path: string) => {
      const content = mockFileContents.get(path)
      if (content === undefined) {
        const error = new Error(`ENOENT: ${path}`)
        ;(error as any).code = 'ENOENT'
        return Promise.reject(error)
      }
      return Promise.resolve(content)
    })

    // 设置 readline.createInterface 的 Mock，直接返回接口（非 Promise）
    vi.mocked(readline.createInterface).mockImplementation(({ input }: { input: Readable }) => {
      // 同步从流中收集内容
      const chunks: string[] = []

      // 对于我们的 Mock 流，需要触发读取
      // 流在我们开始读取时发出 'data' 事件
      input.on('data', (chunk: Buffer | string) => {
        chunks.push(chunk.toString())
      })

      // 获取内容 - 由于我们控制 Mock 流，可以通过内部行获取
      // 需要等待所有数据被收集
      let content = ''
      const lines = (input as any)._lines || []

      // 替代方案：在 nextTick 之后从 chunks 读取内容
      process.nextTick(() => {
        content = chunks.join('')
      })

      // 返回一个包含预解析内容的接口
      // 由于我们知道 mockFileContents 中的内容，可以直接使用
      // 但需要某种方式获取路径...

      // 实际上，直接返回一个迭代 chunks 的接口即可
      // chunks 将通过 nextTick 被填充
      return createMockReadlineInterface(chunks.join('') || '')
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('extractTitleAsync', () => {
    it('should extract title from TurnBegin user_input (string format)', async () => {
      const wirePath = '/test/wire.jsonl'
      mockFileContents.set(wirePath, createWireJsonl([
        { timestamp: 1234567890, message: { type: 'metadata', payload: {} } },
        { timestamp: 1234567891, message: { type: 'TurnBegin', payload: { user_input: 'Hello, this is my question' } } },
      ]))

      const title = await extractTitleAsync(wirePath)
      expect(title).toBe('Hello, this is my question')
    })

    it('should extract title from TurnBegin user_input (ContentPart array format)', async () => {
      const wirePath = '/test/wire.jsonl'
      mockFileContents.set(wirePath, createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: [
          { type: 'text', text: 'Part one ' },
          { type: 'text', text: 'part two' },
        ] } } },
      ]))

      const title = await extractTitleAsync(wirePath)
      expect(title).toBe('Part one part two')
    })

    it('should truncate title longer than 50 characters', async () => {
      const wirePath = '/test/wire.jsonl'
      const longTitle = 'This is a very long title that exceeds fifty characters and should be truncated'
      mockFileContents.set(wirePath, createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: longTitle } } },
      ]))

      const title = await extractTitleAsync(wirePath)
      expect(title.length).toBe(53)
      expect(title.startsWith('This is a very long title that exceeds fifty')).toBe(true)
      expect(title.endsWith('...')).toBe(true)
    })

    it('should return "新对话" when file does not exist', async () => {
      const wirePath = '/nonexistent/wire.jsonl'

      const title = await extractTitleAsync(wirePath)
      expect(title).toBe('新对话')
    })

    it('should return "新对话" when no TurnBegin event found', async () => {
      const wirePath = '/test/wire.jsonl'
      mockFileContents.set(wirePath, createWireJsonl([
        { timestamp: 1234567890, message: { type: 'metadata', payload: {} } },
        { timestamp: 1234567891, message: { type: 'ContentPart', payload: { type: 'text', text: 'Hello' } } },
      ]))

      const title = await extractTitleAsync(wirePath)
      expect(title).toBe('新对话')
    })

    it('should return "新对话" when TurnBegin has no user_input', async () => {
      const wirePath = '/test/wire.jsonl'
      mockFileContents.set(wirePath, createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: {} } },
      ]))

      const title = await extractTitleAsync(wirePath)
      expect(title).toBe('新对话')
    })

    it('should skip metadata lines and find first TurnBegin', async () => {
      const wirePath = '/test/wire.jsonl'
      mockFileContents.set(wirePath, createWireJsonl([
        { timestamp: 1234567890, message: { type: 'metadata', payload: { session_id: 'abc123' } } },
        { timestamp: 1234567891, message: { type: 'TurnBegin', payload: { user_input: 'First question' } } },
        { timestamp: 1234567892, message: { type: 'TurnBegin', payload: { user_input: 'Second question' } } },
      ]))

      const title = await extractTitleAsync(wirePath)
      expect(title).toBe('First question')
    })

    it('should handle malformed JSON lines gracefully', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = `invalid json line
{"timestamp": 1234567890, "message": {"type": "TurnBegin", "payload": {"user_input": "Valid question"}}}
another invalid line`

      mockFileContents.set(wirePath, content)

      const title = await extractTitleAsync(wirePath)
      expect(title).toBe('Valid question')
    })

    it('should extract text from ContentPart array, ignoring non-text parts', async () => {
      const wirePath = '/test/wire.jsonl'
      mockFileContents.set(wirePath, createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: [
          { type: 'image', url: 'http://example.com/image.png' },
          { type: 'text', text: 'Text content here' },
          { type: 'code', code: 'console.log()' },
        ] } } },
      ]))

      const title = await extractTitleAsync(wirePath)
      expect(title).toBe('Text content here')
    })
  })

  describe('extractMessagesStreaming', () => {
    const sessionId = 'test-session-id'

    // 使用已知内容创建 readline 接口的辅助函数
    function setupReadlineMockWithContent(content: string) {
      vi.mocked(readline.createInterface).mockReturnValue(createMockReadlineInterface(content) as any)
    }

    beforeEach(() => {
      // 覆盖 readline 的 Mock，使用 mockFileContents 中的内容
      vi.mocked(readline.createInterface).mockImplementation(({ input }: { input: Readable }) => {
        // 从流中获取路径 - 需要传递过来
        // 由于我们控制 createReadStream，可以把内容作为属性添加
        return createMockReadlineInterface((input as any).__content || '') as any
      })

      // 更新 createReadStream 以包含内容
      vi.mocked(fs.createReadStream).mockImplementation((path: string) => {
        const content = mockFileContents.get(path) || ''
        const stream = createMockReadStream(content)
        ;(stream as any).__content = content
        return stream
      })
    })

    it('should return empty array when file does not exist', async () => {
      const wirePath = '/nonexistent/wire.jsonl'

      const messages = await extractMessagesStreaming(wirePath, sessionId)
      expect(messages).toEqual([])
    })

    it('should create user message from TurnBegin', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: 'User question' } } },
        { timestamp: 1234567891, message: { type: 'TurnEnd', payload: {} } },
      ])
      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages.length).toBe(1)
      expect(messages[0].role).toBe('user')
      expect(messages[0].type).toBe('text')
      expect((messages[0].content as any).text).toBe('User question')
    })

    it('should aggregate ContentPart text events into single message', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: 'Question' } } },
        { timestamp: 1234567891, message: { type: 'ContentPart', payload: { type: 'text', text: 'Hello ' } } },
        { timestamp: 1234567892, message: { type: 'ContentPart', payload: { type: 'text', text: 'world!' } } },
        { timestamp: 1234567893, message: { type: 'TurnEnd', payload: {} } },
      ])
      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages.length).toBe(2)
      expect(messages[1].role).toBe('assistant')
      expect(messages[1].type).toBe('text')
      expect((messages[1].content as any).text).toBe('Hello world!')
    })

    it('should aggregate ContentPart think events into single message', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: 'Question' } } },
        { timestamp: 1234567891, message: { type: 'ContentPart', payload: { type: 'think', think: 'Thinking... ' } } },
        { timestamp: 1234567892, message: { type: 'ContentPart', payload: { type: 'think', think: 'more thoughts' } } },
        { timestamp: 1234567893, message: { type: 'TurnEnd', payload: {} } },
      ])
      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages.length).toBe(2)
      expect(messages[1].role).toBe('assistant')
      expect(messages[1].type).toBe('think')
      expect((messages[1].content as any).think).toBe('Thinking... more thoughts')
    })

    it('should handle ToolCall event', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: 'Question' } } },
        { timestamp: 1234567891, message: { type: 'ToolCall', payload: {
          id: 'tool-call-1',
          function: { name: 'read_file', arguments: '{"path": "/test/file.ts"}' },
        } } },
        { timestamp: 1234567892, message: { type: 'TurnEnd', payload: {} } },
      ])
      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages.length).toBe(2)
      expect(messages[1].role).toBe('assistant')
      expect(messages[1].type).toBe('tool_call')
      expect((messages[1].content as any).toolCallId).toBe('tool-call-1')
      expect((messages[1].content as any).functionName).toBe('read_file')
      expect((messages[1].content as any).arguments).toBe('{"path": "/test/file.ts"}')
    })

    it('should handle ToolResult event', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: 'Question' } } },
        { timestamp: 1234567891, message: { type: 'ToolCall', payload: {
          id: 'tool-call-1',
          function: { name: 'read_file', arguments: '{}' },
        } } },
        { timestamp: 1234567892, message: { type: 'ToolResult', payload: {
          tool_call_id: 'tool-call-1',
          return_value: { output: 'file content here', is_error: false },
        } } },
        { timestamp: 1234567893, message: { type: 'TurnEnd', payload: {} } },
      ])
      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages.length).toBe(3)
      expect(messages[2].role).toBe('assistant')
      expect(messages[2].type).toBe('tool_result')
      expect((messages[2].content as any).toolCallId).toBe('tool-call-1')
      expect((messages[2].content as any).output).toBe('file content here')
      expect((messages[2].content as any).isError).toBe(false)
    })

    it('should handle ToolResult with error', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: 'Question' } } },
        { timestamp: 1234567891, message: { type: 'ToolCall', payload: {
          id: 'tool-call-1',
          function: { name: 'read_file', arguments: '{}' },
        } } },
        { timestamp: 1234567892, message: { type: 'ToolResult', payload: {
          tool_call_id: 'tool-call-1',
          return_value: { output: 'Error: file not found', is_error: true },
        } } },
        { timestamp: 1234567893, message: { type: 'TurnEnd', payload: {} } },
      ])
      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages.length).toBe(3)
      expect((messages[2].content as any).isError).toBe(true)
      expect((messages[2].content as any).output).toBe('Error: file not found')
    })

    it('should handle ApprovalRequest event', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: 'Question' } } },
        { timestamp: 1234567891, message: { type: 'ApprovalRequest', payload: {
          id: 'approval-1',
          tool_call_id: 'tool-call-1',
          action: 'write_file',
          description: 'Write to file',
          display: [{ type: 'text', content: 'Write content to file' }],
        } } },
        { timestamp: 1234567892, message: { type: 'TurnEnd', payload: {} } },
      ])
      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages.length).toBe(2)
      expect(messages[1].role).toBe('assistant')
      expect(messages[1].type).toBe('approval')
      expect((messages[1].content as any).requestId).toBe('approval-1')
      expect((messages[1].content as any).toolCallId).toBe('tool-call-1')
      expect((messages[1].content as any).action).toBe('write_file')
      expect((messages[1].content as any).description).toBe('Write to file')
      expect((messages[1].content as any).responded).toBe(false)
    })

    it('should handle SubagentEvent', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: 'Question' } } },
        { timestamp: 1234567891, message: { type: 'SubagentEvent', payload: {
          parent_tool_call_id: 'parent-tool-1',
          agent_id: 'agent-123',
          subagent_type: 'agent',
          event: { type: 'ContentPart', payload: { type: 'text', text: 'Subagent response' } },
        } } },
        { timestamp: 1234567892, message: { type: 'SubagentEvent', payload: {
          parent_tool_call_id: 'parent-tool-1',
          agent_id: 'agent-123',
          subagent_type: 'agent',
          event: { type: 'TurnEnd', payload: {} },
        } } },
        { timestamp: 1234567893, message: { type: 'TurnEnd', payload: {} } },
      ])
      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages.length).toBe(2)
      expect(messages[1].role).toBe('assistant')
      expect(messages[1].type).toBe('subagent')
      expect((messages[1].content as any).parentToolCallId).toBe('parent-tool-1')
      expect((messages[1].content as any).agentId).toBe('agent-123')
      expect((messages[1].content as any).subagentType).toBe('agent')
      expect((messages[1].content as any).events.length).toBe(2)
      expect((messages[1].content as any).status).toBe('completed')
    })

    it('should flush buffers on StepBegin', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: 'Question' } } },
        { timestamp: 1234567891, message: { type: 'ContentPart', payload: { type: 'text', text: 'First part' } } },
        { timestamp: 1234567892, message: { type: 'StepBegin', payload: {} } },
        { timestamp: 1234567893, message: { type: 'ContentPart', payload: { type: 'text', text: 'Second part' } } },
        { timestamp: 1234567894, message: { type: 'TurnEnd', payload: {} } },
      ])
      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages.length).toBe(3)
      expect(messages[1].role).toBe('assistant')
      expect(messages[1].type).toBe('text')
      expect((messages[1].content as any).text).toBe('First part')
      expect(messages[2].role).toBe('assistant')
      expect(messages[2].type).toBe('text')
      expect((messages[2].content as any).text).toBe('Second part')
    })

    it('should handle multiple turns', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: 'Question 1' } } },
        { timestamp: 1234567891, message: { type: 'ContentPart', payload: { type: 'text', text: 'Answer 1' } } },
        { timestamp: 1234567892, message: { type: 'TurnEnd', payload: {} } },
        { timestamp: 1234567893, message: { type: 'TurnBegin', payload: { user_input: 'Question 2' } } },
        { timestamp: 1234567894, message: { type: 'ContentPart', payload: { type: 'text', text: 'Answer 2' } } },
        { timestamp: 1234567895, message: { type: 'TurnEnd', payload: {} } },
      ])
      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages.length).toBe(4)
      expect((messages[0].content as any).text).toBe('Question 1')
      expect((messages[1].content as any).text).toBe('Answer 1')
      expect((messages[2].content as any).text).toBe('Question 2')
      expect((messages[3].content as any).text).toBe('Answer 2')
    })

    it('should handle interleaved text and think content', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: 'Question' } } },
        { timestamp: 1234567891, message: { type: 'ContentPart', payload: { type: 'think', think: 'Thinking...' } } },
        { timestamp: 1234567892, message: { type: 'ContentPart', payload: { type: 'text', text: 'Response' } } },
        { timestamp: 1234567893, message: { type: 'TurnEnd', payload: {} } },
      ])
      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages.length).toBe(3)
      expect(messages[1].type).toBe('think')
      expect(messages[2].type).toBe('text')
    })

    it('should preserve timestamp from wire records', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = createWireJsonl([
        { timestamp: 1700000000.5, message: { type: 'TurnBegin', payload: { user_input: 'Question' } } },
        { timestamp: 1700000001.5, message: { type: 'ContentPart', payload: { type: 'text', text: 'Answer' } } },
        { timestamp: 1700000002.5, message: { type: 'TurnEnd', payload: {} } },
      ])
      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages[0].timestamp).toBe(1700000000500)
    })

    it('should handle malformed JSON lines gracefully', async () => {
      const wirePath = '/test/wire.jsonl'
      // 注意：ContentPart 行需要有效 JSON，以测试无效行后解析能否继续
      const content = `{"timestamp": 1234567890, "message": {"type": "TurnBegin", "payload": {"user_input": "Question"}}}
invalid json line
{"timestamp": 1234567891, "message": {"type": "ContentPart", "payload": {"type": "text", "text": "Answer"}}}
{"timestamp": 1234567892, "message": {"type": "TurnEnd", "payload": {}}}`

      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages.length).toBe(2)
      expect((messages[0].content as any).text).toBe('Question')
      expect((messages[1].content as any).text).toBe('Answer')
    })

    it('should handle SubagentEvent accumulation for same agent', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: 'Question' } } },
        { timestamp: 1234567891, message: { type: 'SubagentEvent', payload: {
          parent_tool_call_id: 'parent-tool-1',
          agent_id: 'agent-123',
          subagent_type: 'agent',
          event: { type: 'ContentPart', payload: { type: 'text', text: 'Event 1' } },
        } } },
        { timestamp: 1234567892, message: { type: 'SubagentEvent', payload: {
          parent_tool_call_id: 'parent-tool-1',
          agent_id: 'agent-123',
          subagent_type: 'agent',
          event: { type: 'ContentPart', payload: { type: 'text', text: 'Event 2' } },
        } } },
        { timestamp: 1234567893, message: { type: 'SubagentEvent', payload: {
          parent_tool_call_id: 'parent-tool-1',
          agent_id: 'agent-123',
          subagent_type: 'agent',
          event: { type: 'TurnEnd', payload: {} },
        } } },
        { timestamp: 1234567894, message: { type: 'TurnEnd', payload: {} } },
      ])
      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages.length).toBe(2)
      expect((messages[1].content as any).events.length).toBe(3)
      expect((messages[1].content as any).status).toBe('completed')
    })

    it('should handle multiple different subagents', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: 'Question' } } },
        { timestamp: 1234567891, message: { type: 'SubagentEvent', payload: {
          parent_tool_call_id: 'parent-tool-1',
          agent_id: 'agent-1',
          subagent_type: 'agent',
          event: { type: 'ContentPart', payload: { type: 'text', text: 'Agent 1 event' } },
        } } },
        { timestamp: 1234567892, message: { type: 'SubagentEvent', payload: {
          parent_tool_call_id: 'parent-tool-2',
          agent_id: 'agent-2',
          subagent_type: 'coder',
          event: { type: 'ContentPart', payload: { type: 'text', text: 'Agent 2 event' } },
        } } },
        { timestamp: 1234567893, message: { type: 'TurnEnd', payload: {} } },
      ])
      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages.length).toBe(3)
      expect(messages[1].type).toBe('subagent')
      expect(messages[2].type).toBe('subagent')
      expect((messages[1].content as any).agentId).toBe('agent-1')
      expect((messages[2].content as any).agentId).toBe('agent-2')
    })

    it('should skip metadata events', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = createWireJsonl([
        { timestamp: 1234567890, message: { type: 'metadata', payload: { session_id: 'abc123' } } },
        { timestamp: 1234567891, message: { type: 'TurnBegin', payload: { user_input: 'Question' } } },
        { timestamp: 1234567892, message: { type: 'ContentPart', payload: { type: 'text', text: 'Answer' } } },
        { timestamp: 1234567893, message: { type: 'TurnEnd', payload: {} } },
      ])
      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages.length).toBe(2)
    })

    it('should handle unknown event types gracefully', async () => {
      const wirePath = '/test/wire.jsonl'
      const content = createWireJsonl([
        { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: 'Question' } } },
        { timestamp: 1234567891, message: { type: 'UnknownEvent', payload: { data: 'something' } } },
        { timestamp: 1234567892, message: { type: 'ContentPart', payload: { type: 'text', text: 'Answer' } } },
        { timestamp: 1234567893, message: { type: 'TurnEnd', payload: {} } },
      ])
      mockFileContents.set(wirePath, content)

      const messages = await extractMessagesStreaming(wirePath, sessionId)

      expect(messages.length).toBe(2)
    })

    describe('Context Prompt Parsing', () => {
      it('should parse user_input with CTX markers and extract visible text', async () => {
        const wirePath = '/test/wire.jsonl'
        const userInput = `<!--CTX_START-->
用户引用了以下文件内容，请使用 ReadFile 工具查看：
- /src/utils/helper.ts L10-L15
<!--CTX_END-->
Explain this code`
        const content = createWireJsonl([
          { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: userInput } } },
          { timestamp: 1234567891, message: { type: 'TurnEnd', payload: {} } },
        ])
        mockFileContents.set(wirePath, content)

        const messages = await extractMessagesStreaming(wirePath, sessionId)

        expect(messages.length).toBe(1)
        expect(messages[0].role).toBe('user')
        expect((messages[0].content as any).text).toBe('Explain this code')
      })

      it('should attach references to message content when CTX markers present', async () => {
        const wirePath = '/test/wire.jsonl'
        const userInput = `<!--CTX_START-->
用户引用了以下文件内容，请使用 ReadFile 工具查看：
- /src/utils/helper.ts L10-L15
- /src/components/Button.tsx L5-L20
<!--CTX_END-->
Compare these files`
        const content = createWireJsonl([
          { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: userInput } } },
          { timestamp: 1234567891, message: { type: 'TurnEnd', payload: {} } },
        ])
        mockFileContents.set(wirePath, content)

        const messages = await extractMessagesStreaming(wirePath, sessionId)

        expect(messages.length).toBe(1)
        const contentData = messages[0].content as any
        expect(contentData.references).toBeDefined()
        expect(contentData.references).toHaveLength(2)
        expect(contentData.references[0].filePath).toBe('/src/utils/helper.ts')
        expect(contentData.references[0].startLine).toBe(10)
        expect(contentData.references[0].endLine).toBe(15)
        expect(contentData.references[1].filePath).toBe('/src/components/Button.tsx')
        expect(contentData.references[1].startLine).toBe(5)
        expect(contentData.references[1].endLine).toBe(20)
      })

      it('should handle old messages without CTX markers (backward compatibility)', async () => {
        const wirePath = '/test/wire.jsonl'
        const content = createWireJsonl([
          { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: 'Plain old message' } } },
          { timestamp: 1234567891, message: { type: 'TurnEnd', payload: {} } },
        ])
        mockFileContents.set(wirePath, content)

        const messages = await extractMessagesStreaming(wirePath, sessionId)

        expect(messages.length).toBe(1)
        const contentData = messages[0].content as any
        expect(contentData.text).toBe('Plain old message')
        expect(contentData.references).toBeUndefined()
      })

      it('should handle malformed CTX marker format by falling back to original text', async () => {
        const wirePath = '/test/wire.jsonl'
        const userInput = `<!--CTX_START-->
用户引用了以下文件内容，请使用 ReadFile 工具查看：
- /src/test.ts invalid-line-format
<!--CTX_END-->
Help me`
        const content = createWireJsonl([
          { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: userInput } } },
          { timestamp: 1234567891, message: { type: 'TurnEnd', payload: {} } },
        ])
        mockFileContents.set(wirePath, content)

        const messages = await extractMessagesStreaming(wirePath, sessionId)

        expect(messages.length).toBe(1)
        const contentData = messages[0].content as any
        expect(contentData.text).toBe('Help me')
        expect(contentData.references).toBeDefined()
        // 格式错误的行仍应创建带默认值的引用条目
        expect(contentData.references.length).toBeGreaterThan(0)
      })

      it('should handle single line reference format (L10 instead of L10-L15)', async () => {
        const wirePath = '/test/wire.jsonl'
        const userInput = `<!--CTX_START-->
用户引用了以下文件内容，请使用 ReadFile 工具查看：
- /src/test.ts L10
<!--CTX_END-->
Explain this line`
        const content = createWireJsonl([
          { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: userInput } } },
          { timestamp: 1234567891, message: { type: 'TurnEnd', payload: {} } },
        ])
        mockFileContents.set(wirePath, content)

        const messages = await extractMessagesStreaming(wirePath, sessionId)

        expect(messages.length).toBe(1)
        const contentData = messages[0].content as any
        expect(contentData.text).toBe('Explain this line')
        expect(contentData.references).toHaveLength(1)
        expect(contentData.references[0].startLine).toBe(10)
        expect(contentData.references[0].endLine).toBe(10)
      })

      it('should handle ContentPart array format with CTX markers', async () => {
        const wirePath = '/test/wire.jsonl'
        const userInputParts = [
          { type: 'text', text: `<!--CTX_START-->
用户引用了以下文件内容，请使用 ReadFile 工具查看：
- /src/test.ts L5-L10
<!--CTX_END-->
` },
          { type: 'text', text: 'Actual question here' },
        ]
        const content = createWireJsonl([
          { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: userInputParts } } },
          { timestamp: 1234567891, message: { type: 'TurnEnd', payload: {} } },
        ])
        mockFileContents.set(wirePath, content)

        const messages = await extractMessagesStreaming(wirePath, sessionId)

        expect(messages.length).toBe(1)
        const contentData = messages[0].content as any
        expect(contentData.text).toBe('Actual question here')
        expect(contentData.references).toBeDefined()
        expect(contentData.references).toHaveLength(1)
      })

      it('should handle empty reference list (markers but no refs)', async () => {
        const wirePath = '/test/wire.jsonl'
        const userInput = `<!--CTX_START-->
用户引用了以下文件内容，请使用 ReadFile 工具查看：
<!--CTX_END-->
Just a message`
        const content = createWireJsonl([
          { timestamp: 1234567890, message: { type: 'TurnBegin', payload: { user_input: userInput } } },
          { timestamp: 1234567891, message: { type: 'TurnEnd', payload: {} } },
        ])
        mockFileContents.set(wirePath, content)

        const messages = await extractMessagesStreaming(wirePath, sessionId)

        expect(messages.length).toBe(1)
        const contentData = messages[0].content as any
        expect(contentData.text).toBe('Just a message')
        // 当 references 数组为空时，不附加到 content 上
        expect(contentData.references).toBeUndefined()
      })
    })
  })
})