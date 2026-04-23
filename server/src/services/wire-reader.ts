import { readFile } from 'fs/promises';
import { existsSync, createReadStream } from 'fs';
import readline from 'readline';
import { v4 as uuidv4 } from 'uuid';
import { aiError } from './logger.js';
import { parseContextPrompt } from '../../../shared/utils/context-prompt.js';
import type {
  AIMessage,
  AITextContent,
  AIThinkContent,
  AIToolCallContent,
  AIToolResultContent,
  AIApprovalContent,
  AISubagentContent,
  SubagentEvent,
  FileReference,
} from '../../../shared/types/index.js';

// ===== wire.jsonl 内部类型定义 =====

/** 内容片段 */
interface ContentPart {
  type: string;          // 片段类型（text/think 等）
  text?: string;         // 文本内容
  [key: string]: any;
}

/** Wire 协议载荷 */
interface WirePayload {
  user_input?: string | ContentPart[];                    // 用户输入
  type?: string;                                          // 事件类型
  text?: string;                                          // 文本内容
  id?: string;                                            // 消息/工具调用 ID
  function?: { name: string; arguments: string };         // 工具调用函数信息
  tool_call_id?: string;                                  // 工具调用关联 ID
  return_value?: { output: string; is_error: boolean };   // 工具返回值
  [key: string]: any;
}

/** Wire 协议消息 */
interface WireMessage {
  type: string;                    // 消息类型
  payload?: WirePayload;           // 消息载荷
  [key: string]: any;
}

/** Wire 协议记录（一行 JSON） */
interface WireRecord {
  timestamp: number;               // 时间戳（秒，带小数）
  message: WireMessage;            // 消息体
}

// ===== 辅助函数 =====

/**
 * 从 user_input 中提取文本内容。
 * user_input 可能是 string 或 ContentPart 数组。
 */
function extractUserInputText(userInput: string | ContentPart[]): string {
  if (typeof userInput === 'string') {
    return userInput;
  }
  if (Array.isArray(userInput)) {
    return userInput
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text!)
      .join('');
  }
  return '';
}

/**
 * 截取前 maxLen 字符，超出添加省略号。
 */
function truncateWithEllipsis(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return text.substring(0, maxLen) + '...';
}

// ===== 导出函数 =====

/**
 * 从 wire.jsonl 文件中提取第一个事件的 timestamp，转换为毫秒返回。
 * wire.jsonl 中的 timestamp 为秒（带小数），需 ×1000 转为毫秒。
 * 文件不存在或解析失败时返回 0。
 */
export async function extractFirstTimestamp(wireFilePath: string): Promise<number> {
  try {
    if (!existsSync(wireFilePath)) {
      return 0;
    }

    const content = await readFile(wireFilePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let record: WireRecord;
      try {
        record = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (record.timestamp) {
        return Math.round(record.timestamp * 1000);
      }
    }

    return 0;
  } catch {
    return 0;
  }
}

/**
 * 从 wire.jsonl 文件中提取会话标题（异步版本）。
 * 读取第一个 TurnBegin 事件的 user_input 作为标题。
 * 截取前 50 字符，超出添加省略号。
 * 读取失败时返回 "新对话"。
 */
export async function extractTitleAsync(wireFilePath: string): Promise<string> {
  try {
    if (!existsSync(wireFilePath)) {
      return '新对话';
    }

    const content = await readFile(wireFilePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let record: WireRecord;
      try {
        record = JSON.parse(trimmed);
      } catch {
        continue;
      }

      // 跳过 metadata 行
      if (record.message?.type === 'metadata') {
        continue;
      }

      // 找到第一个 TurnBegin
      if (record.message?.type === 'TurnBegin' && record.message.payload?.user_input != null) {
        const text = extractUserInputText(record.message.payload.user_input);
        if (text) {
          const { visibleText } = parseContextPrompt(text);
          return truncateWithEllipsis(visibleText, 50);
        }
      }
    }

    return '新对话';
  } catch {
    return '新对话';
  }
}


/**
 * 从 wire.jsonl 文件中提取所有历史消息（流式解析版本）。
 * 使用 readline 接口逐行处理，避免一次性加载整个文件。
 * 使用状态机逐事件处理，支持 text/think 缓冲拼接和 tool_call/tool_result 匹配。
 */
export async function extractMessagesStreaming(
  wireFilePath: string,
  sessionId: string
): Promise<AIMessage[]> {
  const messages: AIMessage[] = [];

  if (!existsSync(wireFilePath)) {
    return messages;
  }

  try {
    const fileStream = createReadStream(wireFilePath, 'utf-8');
    const rl = readline.createInterface({ input: fileStream });

    // 状态机缓冲区
    let currentAssistantText = '';
    let currentThinkText = '';
    const pendingToolCalls = new Map<string, AIToolCallContent>();
    const activeSubagents = new Map<string, { messageIndex: number; events: SubagentEvent[] }>();
    let lastTimestamp = Date.now();

    /**
     * 刷新 text 缓冲：如果有累积的 assistant text，创建一条 AIMessage。
     */
    function flushText(): void {
      if (currentAssistantText) {
        messages.push({
          id: uuidv4(),
          sessionId,
          role: 'assistant',
          type: 'text',
          content: { text: currentAssistantText } as AITextContent,
          timestamp: lastTimestamp,
        });
        currentAssistantText = '';
      }
    }

    /**
     * 刷新 think 缓冲：如果有累积的 think text，创建一条 AIMessage。
     */
    function flushThink(): void {
      if (currentThinkText) {
        messages.push({
          id: uuidv4(),
          sessionId,
          role: 'assistant',
          type: 'think',
          content: { think: currentThinkText } as AIThinkContent,
          timestamp: lastTimestamp,
        });
        currentThinkText = '';
      }
    }

    /**
     * 刷新所有缓冲区（text 和 think）。
     */
    function flushAll(): void {
      flushThink();
      flushText();
    }

    /**
     * 生成 subagent 的唯一 key。
     */
    function subagentKey(parentToolCallId: string, agentId: string): string {
      return `${parentToolCallId}:${agentId}`;
    }

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let record: WireRecord;
      try {
        record = JSON.parse(trimmed);
      } catch {
        continue;
      }

      const msg = record.message;
      if (!msg) continue;

      // 跳过 metadata 行和其他非事件类型
      if (msg.type === 'metadata') continue;

      // 更新时间戳（使用 wire 记录的时间，转换为毫秒）
      if (record.timestamp) {
        lastTimestamp = Math.round(record.timestamp * 1000);
      }

      switch (msg.type) {
        case 'TurnBegin': {
          // 先刷新之前缓冲的内容
          flushAll();

          // 创建 user 消息
          const userInput = msg.payload?.user_input;
          if (userInput != null) {
            const rawText = extractUserInputText(userInput);
            if (rawText) {
              // 解析 context prompt 提取引用信息
              const { visibleText, references } = parseContextPrompt(rawText);

              // 创建消息内容，可能包含引用
              const textContent: AITextContent = { text: visibleText };
              if (references.length > 0) {
                textContent.references = references;
              }

              messages.push({
                id: uuidv4(),
                sessionId,
                role: 'user',
                type: 'text',
                content: textContent,
                timestamp: lastTimestamp,
              });
            }
          }
          break;
        }

        case 'ContentPart': {
          const payload = msg.payload;
          if (!payload) break;

          if (payload.type === 'text' && typeof payload.text === 'string') {
            currentAssistantText += payload.text;
          } else if (payload.type === 'think' && typeof payload.think === 'string') {
            currentThinkText += payload.think;
          }
          break;
        }

        case 'StepBegin': {
          // StepBegin 标志 Turn 内的新推理步骤，刷新缓冲以隔离不同 Step 的消息
          flushAll();
          break;
        }

        case 'ToolCall': {
          // 先刷新缓冲
          flushAll();

          const payload = msg.payload;
          if (!payload || !payload.id) break;

          const toolCallContent: AIToolCallContent = {
            toolCallId: payload.id,
            functionName: payload.function?.name || '',
            arguments: payload.function?.arguments || '',
          };

          messages.push({
            id: uuidv4(),
            sessionId,
            role: 'assistant',
            type: 'tool_call',
            content: toolCallContent,
            timestamp: lastTimestamp,
          });

          // 加入等待结果队列
          pendingToolCalls.set(payload.id, toolCallContent);
          break;
        }

        case 'ToolResult': {
          // 先刷新缓冲
          flushAll();

          const payload = msg.payload;
          if (!payload) break;

          const toolCallId = payload.tool_call_id;
          if (!toolCallId) break;

          messages.push({
            id: uuidv4(),
            sessionId,
            role: 'assistant',
            type: 'tool_result',
            content: {
              toolCallId,
              isError: payload.return_value?.is_error ?? false,
              output: payload.return_value?.output || '',
            } as AIToolResultContent,
            timestamp: lastTimestamp,
          });

          // 从等待队列中移除
          pendingToolCalls.delete(toolCallId);
          break;
        }

        case 'ApprovalRequest': {
          // 先刷新缓冲
          flushAll();

          const payload = msg.payload;
          if (!payload) break;

          messages.push({
            id: uuidv4(),
            sessionId,
            role: 'assistant',
            type: 'approval',
            content: {
              requestId: payload.id || uuidv4(),
              toolCallId: payload.tool_call_id || '',
              action: payload.action || '',
              description: payload.description || '',
              display: Array.isArray(payload.display) ? payload.display : [],
              responded: false,
            } as AIApprovalContent,
            timestamp: lastTimestamp,
          });
          break;
        }

        case 'SubagentEvent': {
          // 先刷新文本缓冲
          flushAll();

          const payload = msg.payload;
          if (!payload) break;

          const parentToolCallId = payload.parent_tool_call_id as string;
          const agentId = payload.agent_id as string;
          const subagentType = (payload.subagent_type as string) || 'agent';
          const innerEvent = payload.event as { type: string; payload: unknown };

          if (!parentToolCallId || !agentId || !innerEvent) break;

          const key = subagentKey(parentToolCallId, agentId);
          const subagentEvent: SubagentEvent = {
            type: 'SubagentEvent',
            payload: {
              parent_tool_call_id: parentToolCallId,
              agent_id: agentId,
              subagent_type: subagentType,
              event: innerEvent,
            },
          };

          const existing = activeSubagents.get(key);
          if (existing) {
            existing.events.push(subagentEvent);
            const msgObj = messages[existing.messageIndex];
            if (msgObj) {
              const content = msgObj.content as AISubagentContent;
              messages[existing.messageIndex] = {
                ...msgObj,
                content: { ...content, events: [...content.events, subagentEvent] },
              };
            }
          } else {
            const idx = messages.length;
            messages.push({
              id: uuidv4(),
              sessionId,
              role: 'assistant',
              type: 'subagent',
              content: {
                parentToolCallId,
                agentId,
                subagentType,
                events: [subagentEvent],
                status: 'running',
              } as AISubagentContent,
              timestamp: lastTimestamp,
            });
            activeSubagents.set(key, { messageIndex: idx, events: [subagentEvent] });
          }

          // 根据内部事件更新状态
          const entry = activeSubagents.get(key);
          if (entry) {
            if (innerEvent.type === 'TurnEnd') {
              const msgObj = messages[entry.messageIndex];
              if (msgObj) {
                const content = msgObj.content as AISubagentContent;
                messages[entry.messageIndex] = {
                  ...msgObj,
                  content: { ...content, status: 'completed' },
                };
              }
              // 只有 TurnEnd 才删除：工具调用失败不代表代理结束
              activeSubagents.delete(key);
            }
          }
          break;
        }

        case 'TurnEnd': {
          // 刷新所有缓冲区
          flushAll();
          break;
        }

        // 其他事件类型（StepBegin, StepEnd 等）跳过
        default:
          break;
      }
    }

    // 文件末尾再刷新一次，确保最后的内容不丢失
    flushAll();
  } catch (err) {
    aiError('[wire-reader] Failed to extract messages:', err);
  }

  return messages;
}

