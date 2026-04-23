/**
 * AI Store 测试
 *
 * 测试 useAIStore 的核心功能，包括消息处理、会话管理、流式状态等
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAIStore } from '../../src/stores/ai';
import type { AIMessage, AISession, SubagentEvent, AIStatusInfo } from '@shared/types';
import {
  wireEvents,
  createMockAIMessage,
  createMockAISession,
  clearAllMocks,
} from '../helpers/mocks';

describe('useAIStore', () => {
  beforeEach(() => {
    // 每个测试前重置 store 到初始状态
    useAIStore.getState().resetAI();
  });

  afterEach(() => {
    clearAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useAIStore.getState();

      expect(state.aiPanelOpen).toBe(false);
      expect(state.aiPanelWidth).toBe(400);
      expect(state.aiStatus).toBe(null);
      expect(state.showInstallPrompt).toBe(false);
      expect(state.aiSessions).toEqual([]);
      expect(state.activeSessionId).toBe(null);
      expect(state.aiMessages).toEqual([]);
      expect(state.aiStreaming).toBe(false);
      expect(state.aiConnected).toBe(false);
      expect(state.statusInfo).toEqual({});
      expect(state.sessionStatus).toBe('idle');
      expect(state.aiError).toBe(null);
    });
  });

  describe('UI Actions', () => {
    it('should toggle aiPanelOpen', () => {
      const store = useAIStore.getState();

      store.toggleAIPanel();
      expect(useAIStore.getState().aiPanelOpen).toBe(true);

      store.toggleAIPanel();
      expect(useAIStore.getState().aiPanelOpen).toBe(false);
    });

    it('should set aiPanelOpen to specific value', () => {
      const store = useAIStore.getState();

      store.setAIPanelOpen(true);
      expect(useAIStore.getState().aiPanelOpen).toBe(true);

      store.setAIPanelOpen(false);
      expect(useAIStore.getState().aiPanelOpen).toBe(false);
    });

    it('should set aiPanelWidth', () => {
      const store = useAIStore.getState();

      store.setAIPanelWidth(500);
      expect(useAIStore.getState().aiPanelWidth).toBe(500);
    });

    it('should set aiStatus', () => {
      const store = useAIStore.getState();
      const status = { available: true, version: '1.0.0' };

      store.setAIStatus(status);
      expect(useAIStore.getState().aiStatus).toEqual(status);
    });

    it('should set showInstallPrompt', () => {
      const store = useAIStore.getState();

      store.setShowInstallPrompt(true);
      expect(useAIStore.getState().showInstallPrompt).toBe(true);
    });
  });

  describe('Session Actions', () => {
    it('should set aiSessions', () => {
      const store = useAIStore.getState();
      const sessions: AISession[] = [
        createMockAISession({ id: 'session-1', title: 'Session 1' }),
        createMockAISession({ id: 'session-2', title: 'Session 2' }),
      ];

      store.setAISessions(sessions);
      expect(useAIStore.getState().aiSessions).toEqual(sessions);
    });

    it('should set activeSessionId', () => {
      const store = useAIStore.getState();

      store.setActiveSession('session-1');
      expect(useAIStore.getState().activeSessionId).toBe('session-1');

      store.setActiveSession(null);
      expect(useAIStore.getState().activeSessionId).toBe(null);
    });

    it('should clear messages when switching session', () => {
      const store = useAIStore.getState();

      // 先添加一些消息
      store.setActiveSession('session-1');
      store.addMessage(createMockAIMessage('text', { text: 'Hello' }, { sessionId: 'session-1' }));
      expect(useAIStore.getState().aiMessages.length).toBe(1);

      // 切换会话 — 注意：store 中不会自动清除消息
      // 消息清除由服务层处理
      store.setActiveSession('session-2');
      expect(useAIStore.getState().activeSessionId).toBe('session-2');

      // 显式清除消息
      store.clearMessages();
      expect(useAIStore.getState().aiMessages.length).toBe(0);
    });
  });

  describe('Message Actions', () => {
    beforeEach(() => {
      const store = useAIStore.getState();
      store.setActiveSession('test-session');
    });

    it('should add a message', () => {
      const store = useAIStore.getState();
      const message = createMockAIMessage('text', { text: 'Hello' });

      store.addMessage(message);
      const messages = useAIStore.getState().aiMessages;

      expect(messages.length).toBe(1);
      expect(messages[0]).toEqual(message);
    });

    it('should add multiple messages in order', () => {
      const store = useAIStore.getState();
      const msg1 = createMockAIMessage('text', { text: 'First' });
      const msg2 = createMockAIMessage('text', { text: 'Second' });

      store.addMessage(msg1);
      store.addMessage(msg2);

      const messages = useAIStore.getState().aiMessages;
      expect(messages.length).toBe(2);
      expect(messages[0]).toEqual(msg1);
      expect(messages[1]).toEqual(msg2);
    });

    it('should update a message by id', () => {
      const store = useAIStore.getState();
      const message = createMockAIMessage('text', { text: 'Original' }, { id: 'msg-1' });

      store.addMessage(message);
      store.updateMessage('msg-1', { content: { text: 'Updated' } });

      const messages = useAIStore.getState().aiMessages;
      expect(messages[0].content).toEqual({ text: 'Updated' });
    });

    it('should not affect other messages when updating', () => {
      const store = useAIStore.getState();
      const msg1 = createMockAIMessage('text', { text: 'First' }, { id: 'msg-1' });
      const msg2 = createMockAIMessage('text', { text: 'Second' }, { id: 'msg-2' });

      store.addMessage(msg1);
      store.addMessage(msg2);
      store.updateMessage('msg-1', { content: { text: 'Updated First' } });

      const messages = useAIStore.getState().aiMessages;
      expect(messages[0].content).toEqual({ text: 'Updated First' });
      expect(messages[1].content).toEqual({ text: 'Second' });
    });

    it('should append content to message field', () => {
      const store = useAIStore.getState();
      const message = createMockAIMessage('text', { text: 'Hello' }, { id: 'msg-1' });

      store.addMessage(message);
      store.appendToMessage('msg-1', 'text', ' World');

      const messages = useAIStore.getState().aiMessages;
      expect(messages[0].content).toEqual({ text: 'Hello World' });
    });

    it('should append multiple times for streaming text', () => {
      const store = useAIStore.getState();
      const message = createMockAIMessage('text', { text: '' }, { id: 'msg-1' });

      store.addMessage(message);
      store.appendToMessage('msg-1', 'text', 'Part1');
      store.appendToMessage('msg-1', 'text', ' Part2');
      store.appendToMessage('msg-1', 'text', ' Part3');

      const messages = useAIStore.getState().aiMessages;
      expect(messages[0].content).toEqual({ text: 'Part1 Part2 Part3' });
    });

    it('should append to think content', () => {
      const store = useAIStore.getState();
      const message = createMockAIMessage('think', { think: '' }, { id: 'msg-1' });

      store.addMessage(message);
      store.appendToMessage('msg-1', 'think', 'Thinking...');
      store.appendToMessage('msg-1', 'think', ' More thoughts');

      const messages = useAIStore.getState().aiMessages;
      expect(messages[0].content).toEqual({ think: 'Thinking... More thoughts' });
    });

    it('should set all messages', () => {
      const store = useAIStore.getState();
      const messages: AIMessage[] = [
        createMockAIMessage('text', { text: 'Hello' }),
        createMockAIMessage('text', { text: 'World' }),
      ];

      store.setAIMessages(messages);
      expect(useAIStore.getState().aiMessages).toEqual(messages);
    });

    it('should clear messages', () => {
      const store = useAIStore.getState();
      store.addMessage(createMockAIMessage('text', { text: 'Hello' }));
      store.addMessage(createMockAIMessage('text', { text: 'World' }));

      expect(useAIStore.getState().aiMessages.length).toBe(2);

      store.clearMessages();
      expect(useAIStore.getState().aiMessages.length).toBe(0);
      expect(useAIStore.getState().aiStreaming).toBe(false);
    });
  });

  describe('Streaming State', () => {
    it('should set streaming to true', () => {
      const store = useAIStore.getState();

      store.setStreaming(true);
      expect(useAIStore.getState().aiStreaming).toBe(true);
    });

    it('should set streaming to false', () => {
      const store = useAIStore.getState();
      store.setStreaming(true);

      store.setStreaming(false);
      expect(useAIStore.getState().aiStreaming).toBe(false);
    });

    it('should set connected to true', () => {
      const store = useAIStore.getState();

      store.setConnected(true);
      expect(useAIStore.getState().aiConnected).toBe(true);
    });

    it('should set connected to false', () => {
      const store = useAIStore.getState();
      store.setConnected(true);

      store.setConnected(false);
      expect(useAIStore.getState().aiConnected).toBe(false);
    });
  });

  describe('Status Info Actions', () => {
    it('should set statusInfo', () => {
      const store = useAIStore.getState();
      const info: AIStatusInfo = {
        tokenUsage: {
          inputOther: 100,
          output: 50,
          inputCacheRead: 20,
          inputCacheCreation: 10,
        },
        contextUsage: 0.5,
      };

      store.setStatusInfo(info);
      expect(useAIStore.getState().statusInfo).toEqual(info);
    });

    it('should merge statusInfo updates', () => {
      const store = useAIStore.getState();

      store.setStatusInfo({ contextUsage: 0.5 });
      store.setStatusInfo({ tokenUsage: { inputOther: 100, output: 50, inputCacheRead: 0, inputCacheCreation: 0 } });

      const statusInfo = useAIStore.getState().statusInfo;
      expect(statusInfo.contextUsage).toBe(0.5);
      expect(statusInfo.tokenUsage).toEqual({
        inputOther: 100,
        output: 50,
        inputCacheRead: 0,
        inputCacheCreation: 0,
      });
    });

    it('should set sessionStatus', () => {
      const store = useAIStore.getState();

      store.setSessionStatus('busy');
      expect(useAIStore.getState().sessionStatus).toBe('busy');

      store.setSessionStatus('idle');
      expect(useAIStore.getState().sessionStatus).toBe('idle');

      store.setSessionStatus('error');
      expect(useAIStore.getState().sessionStatus).toBe('error');

      store.setSessionStatus('stopped');
      expect(useAIStore.getState().sessionStatus).toBe('stopped');
    });
  });

  describe('ToolCall Args Append', () => {
    beforeEach(() => {
      const store = useAIStore.getState();
      store.setActiveSession('test-session');
    });

    it('should append to tool call arguments', () => {
      const store = useAIStore.getState();
      const message = createMockAIMessage('tool_call', {
        toolCallId: 'tc-1',
        functionName: 'readFile',
        arguments: '',
      }, { id: 'msg-1' });

      store.addMessage(message);
      store.appendToToolCallArgs('tc-1', '{"path": ');
      store.appendToToolCallArgs('tc-1', '"test.txt"}');

      const messages = useAIStore.getState().aiMessages;
      const content = messages[0].content as { toolCallId: string; functionName: string; arguments: string };
      expect(content.arguments).toBe('{"path": "test.txt"}');
    });

    it('should not affect non-tool_call messages', () => {
      const store = useAIStore.getState();
      const textMsg = createMockAIMessage('text', { text: 'Hello' }, { id: 'msg-1' });
      const toolMsg = createMockAIMessage('tool_call', {
        toolCallId: 'tc-1',
        functionName: 'readFile',
        arguments: '',
      }, { id: 'msg-2' });

      store.addMessage(textMsg);
      store.addMessage(toolMsg);
      store.appendToToolCallArgs('tc-1', '{"path": "test.txt"}');

      const messages = useAIStore.getState().aiMessages;
      const textContent = messages[0].content as { text: string };
      const toolContent = messages[1].content as { toolCallId: string; arguments: string };

      expect(textContent.text).toBe('Hello');
      expect(toolContent.arguments).toBe('{"path": "test.txt"}');
    });

    it('should only update matching toolCallId', () => {
      const store = useAIStore.getState();
      const tool1 = createMockAIMessage('tool_call', {
        toolCallId: 'tc-1',
        functionName: 'readFile',
        arguments: '',
      }, { id: 'msg-1' });
      const tool2 = createMockAIMessage('tool_call', {
        toolCallId: 'tc-2',
        functionName: 'writeFile',
        arguments: '',
      }, { id: 'msg-2' });

      store.addMessage(tool1);
      store.addMessage(tool2);
      store.appendToToolCallArgs('tc-1', '{"path": ');

      const messages = useAIStore.getState().aiMessages;
      const content1 = messages[0].content as { toolCallId: string; arguments: string };
      const content2 = messages[1].content as { toolCallId: string; arguments: string };

      expect(content1.arguments).toBe('{"path": ');
      expect(content2.arguments).toBe('');
    });
  });

  describe('Subagent Actions', () => {
    beforeEach(() => {
      const store = useAIStore.getState();
      store.setActiveSession('test-session');
    });

    it('should create new subagent message on first event', () => {
      const store = useAIStore.getState();
      const event: SubagentEvent = wireEvents.subagentEvent(
        'tc-1',
        'agent-1',
        'task',
        wireEvents.contentPartText('Subagent output')
      ).message as SubagentEvent;

      store.addSubagentEvent('tc-1', 'agent-1', 'task', event);

      const messages = useAIStore.getState().aiMessages;
      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe('subagent');

      const content = messages[0].content as {
        parentToolCallId: string;
        agentId: string;
        subagentType: string;
        events: SubagentEvent[];
        status: string;
      };

      expect(content.parentToolCallId).toBe('tc-1');
      expect(content.agentId).toBe('agent-1');
      expect(content.subagentType).toBe('task');
      expect(content.events.length).toBe(1);
      expect(content.status).toBe('running');
    });

    it('should append events to existing subagent message', () => {
      const store = useAIStore.getState();
      const event1: SubagentEvent = wireEvents.subagentEvent(
        'tc-1',
        'agent-1',
        'task',
        wireEvents.contentPartText('First output')
      ).message as SubagentEvent;

      const event2: SubagentEvent = wireEvents.subagentEvent(
        'tc-1',
        'agent-1',
        'task',
        wireEvents.contentPartText('Second output')
      ).message as SubagentEvent;

      store.addSubagentEvent('tc-1', 'agent-1', 'task', event1);
      store.addSubagentEvent('tc-1', 'agent-1', 'task', event2);

      const messages = useAIStore.getState().aiMessages;
      expect(messages.length).toBe(1);

      const content = messages[0].content as { events: SubagentEvent[] };
      expect(content.events.length).toBe(2);
    });

    it('should create separate subagent messages for different agents', () => {
      const store = useAIStore.getState();
      const event1: SubagentEvent = wireEvents.subagentEvent(
        'tc-1',
        'agent-1',
        'task',
        wireEvents.contentPartText('Agent 1 output')
      ).message as SubagentEvent;

      const event2: SubagentEvent = wireEvents.subagentEvent(
        'tc-1',
        'agent-2',
        'task',
        wireEvents.contentPartText('Agent 2 output')
      ).message as SubagentEvent;

      store.addSubagentEvent('tc-1', 'agent-1', 'task', event1);
      store.addSubagentEvent('tc-1', 'agent-2', 'task', event2);

      const messages = useAIStore.getState().aiMessages;
      expect(messages.length).toBe(2);

      const content1 = messages[0].content as { agentId: string };
      const content2 = messages[1].content as { agentId: string };

      expect(content1.agentId).toBe('agent-1');
      expect(content2.agentId).toBe('agent-2');
    });

    it('should update subagent status', () => {
      const store = useAIStore.getState();
      const event: SubagentEvent = wireEvents.subagentEvent(
        'tc-1',
        'agent-1',
        'task',
        wireEvents.contentPartText('Output')
      ).message as SubagentEvent;

      store.addSubagentEvent('tc-1', 'agent-1', 'task', event);
      store.updateSubagentStatus('tc-1', 'agent-1', 'completed');

      const messages = useAIStore.getState().aiMessages;
      const content = messages[0].content as { status: string };

      expect(content.status).toBe('completed');
    });

    it('should update subagent status to error', () => {
      const store = useAIStore.getState();
      const event: SubagentEvent = wireEvents.subagentEvent(
        'tc-1',
        'agent-1',
        'task',
        wireEvents.contentPartText('Output')
      ).message as SubagentEvent;

      store.addSubagentEvent('tc-1', 'agent-1', 'task', event);
      store.updateSubagentStatus('tc-1', 'agent-1', 'error');

      const messages = useAIStore.getState().aiMessages;
      const content = messages[0].content as { status: string };

      expect(content.status).toBe('error');
    });

    it('should not affect other subagents when updating status', () => {
      const store = useAIStore.getState();
      const event1: SubagentEvent = wireEvents.subagentEvent(
        'tc-1',
        'agent-1',
        'task',
        wireEvents.contentPartText('Output')
      ).message as SubagentEvent;

      const event2: SubagentEvent = wireEvents.subagentEvent(
        'tc-1',
        'agent-2',
        'task',
        wireEvents.contentPartText('Output')
      ).message as SubagentEvent;

      store.addSubagentEvent('tc-1', 'agent-1', 'task', event1);
      store.addSubagentEvent('tc-1', 'agent-2', 'task', event2);
      store.updateSubagentStatus('tc-1', 'agent-1', 'completed');

      const messages = useAIStore.getState().aiMessages;
      const content1 = messages[0].content as { agentId: string; status: string };
      const content2 = messages[1].content as { agentId: string; status: string };

      expect(content1.status).toBe('completed');
      expect(content2.status).toBe('running');
    });
  });

  describe('Error Actions', () => {
    it('should set AI error', () => {
      const store = useAIStore.getState();

      store.setAIError('Something went wrong');
      expect(useAIStore.getState().aiError).toBe('Something went wrong');
    });

    it('should clear AI error', () => {
      const store = useAIStore.getState();
      store.setAIError('Error');

      store.setAIError(null);
      expect(useAIStore.getState().aiError).toBe(null);
    });
  });

  describe('Reset', () => {
    it('should reset all state to initial values', () => {
      const store = useAIStore.getState();

      // 设置各种状态值
      store.setAIPanelOpen(true);
      store.setAIPanelWidth(500);
      store.setAIStatus({ available: true, version: '1.0' });
      store.setShowInstallPrompt(true);
      store.setAISessions([createMockAISession()]);
      store.setActiveSession('session-1');
      store.addMessage(createMockAIMessage('text', { text: 'Hello' }));
      store.setStreaming(true);
      store.setConnected(true);
      store.setStatusInfo({ contextUsage: 0.5 });
      store.setSessionStatus('busy');
      store.setAIError('Error');

      // 重置
      store.resetAI();

      const state = useAIStore.getState();
      expect(state.aiPanelOpen).toBe(false);
      expect(state.aiPanelWidth).toBe(400);
      expect(state.aiStatus).toBe(null);
      expect(state.showInstallPrompt).toBe(false);
      expect(state.aiSessions).toEqual([]);
      expect(state.activeSessionId).toBe(null);
      expect(state.aiMessages).toEqual([]);
      expect(state.aiStreaming).toBe(false);
      expect(state.aiConnected).toBe(false);
      expect(state.statusInfo).toEqual({});
      expect(state.sessionStatus).toBe('idle');
      expect(state.aiError).toBe(null);
    });
  });

  describe('Wire Event Processing Scenario', () => {
    beforeEach(() => {
      const store = useAIStore.getState();
      store.setActiveSession('test-session');
      store.setStreaming(true);
    });

    it('should handle a complete conversation flow', () => {
      const store = useAIStore.getState();

      // 用户消息
      const userMsg = createMockAIMessage('text', { text: 'Hello' }, { role: 'user' });
      store.addMessage(userMsg);

      // 助手文本消息
      const textMsg = createMockAIMessage('text', { text: '' }, { id: 'text-1' });
      store.addMessage(textMsg);
      store.appendToMessage('text-1', 'text', 'Hello! ');
      store.appendToMessage('text-1', 'text', 'How can I help?');

      // 工具调用
      const toolMsg = createMockAIMessage('tool_call', {
        toolCallId: 'tc-1',
        functionName: 'readFile',
        arguments: '',
      }, { id: 'tool-1' });
      store.addMessage(toolMsg);
      store.appendToToolCallArgs('tc-1', '{"path": "');
      store.appendToToolCallArgs('tc-1', 'test.txt"}');

      // 工具结果
      const resultMsg = createMockAIMessage('tool_result', {
        toolCallId: 'tc-1',
        isError: false,
        output: 'File content here',
      }, { id: 'result-1' });
      store.addMessage(resultMsg);

      // 结束流式传输
      store.setStreaming(false);

      const messages = useAIStore.getState().aiMessages;
      expect(messages.length).toBe(4);
      expect(messages[0].role).toBe('user');
      expect(messages[1].type).toBe('text');
      expect(messages[1].content).toEqual({ text: 'Hello! How can I help?' });
      expect(messages[2].type).toBe('tool_call');
      expect(messages[3].type).toBe('tool_result');

      expect(useAIStore.getState().aiStreaming).toBe(false);
    });

    it('should handle think + text + tool sequence', () => {
      const store = useAIStore.getState();

      // 思考消息
      const thinkMsg = createMockAIMessage('think', { think: '' }, { id: 'think-1' });
      store.addMessage(thinkMsg);
      store.appendToMessage('think-1', 'think', 'Analyzing request...');
      store.appendToMessage('think-1', 'think', ' Need to read file.');

      // 文本消息
      const textMsg = createMockAIMessage('text', { text: 'I will read the file.' }, { id: 'text-1' });
      store.addMessage(textMsg);

      // 工具调用
      const toolMsg = createMockAIMessage('tool_call', {
        toolCallId: 'tc-1',
        functionName: 'readFile',
        arguments: '{"path": "file.txt"}',
      });
      store.addMessage(toolMsg);

      const messages = useAIStore.getState().aiMessages;
      expect(messages.length).toBe(3);

      const thinkContent = messages[0].content as { think: string };
      expect(thinkContent.think).toBe('Analyzing request... Need to read file.');
    });

    it('should handle nested subagent events', () => {
      const store = useAIStore.getState();

      // 父级工具调用
      const parentTool = createMockAIMessage('tool_call', {
        toolCallId: 'tc-parent',
        functionName: 'delegateTask',
        arguments: '{"task": "complex"}',
      });
      store.addMessage(parentTool);

      // 子代理事件
      const subagentEvent1: SubagentEvent = wireEvents.subagentEvent(
        'tc-parent',
        'agent-1',
        'task',
        wireEvents.contentPartText('Subagent thinking...')
      ).message as SubagentEvent;

      const subagentEvent2: SubagentEvent = wireEvents.subagentEvent(
        'tc-parent',
        'agent-1',
        'task',
        wireEvents.toolCall('tc-child', 'readFile', '{"path": "inner.txt"}')
      ).message as SubagentEvent;

      store.addSubagentEvent('tc-parent', 'agent-1', 'task', subagentEvent1);
      store.addSubagentEvent('tc-parent', 'agent-1', 'task', subagentEvent2);
      store.updateSubagentStatus('tc-parent', 'agent-1', 'completed');

      const messages = useAIStore.getState().aiMessages;
      expect(messages.length).toBe(2); // tool_call 加 subagent 两条消息
      expect(messages[1].type).toBe('subagent');

      const subagentContent = messages[1].content as {
        parentToolCallId: string;
        events: SubagentEvent[];
        status: string;
      };

      expect(subagentContent.events.length).toBe(2);
      expect(subagentContent.status).toBe('completed');
    });
  });

  describe('Reference Actions', () => {
    it('should add reference to empty array and auto-open panel', () => {
      const store = useAIStore.getState();
      const reference = {
        id: 'ref-1',
        filePath: '/src/test.ts',
        startLine: 10,
        endLine: 15,
        selectedText: 'test code',
      };

      store.addReference(reference);

      const state = useAIStore.getState();
      expect(state.pendingReferences).toHaveLength(1);
      expect(state.pendingReferences[0]).toEqual(reference);
      expect(state.aiPanelOpen).toBe(true);
    });

    it('should append reference to existing array', () => {
      const store = useAIStore.getState();
      const ref1 = {
        id: 'ref-1',
        filePath: '/src/test1.ts',
        startLine: 10,
        endLine: 15,
        selectedText: 'code1',
      };
      const ref2 = {
        id: 'ref-2',
        filePath: '/src/test2.ts',
        startLine: 20,
        endLine: 25,
        selectedText: 'code2',
      };

      store.addReference(ref1);
      store.addReference(ref2);

      const state = useAIStore.getState();
      expect(state.pendingReferences).toHaveLength(2);
      expect(state.pendingReferences[0]).toEqual(ref1);
      expect(state.pendingReferences[1]).toEqual(ref2);
    });

    it('should remove reference by id', () => {
      const store = useAIStore.getState();
      const ref1 = {
        id: 'ref-1',
        filePath: '/src/test1.ts',
        startLine: 10,
        endLine: 15,
        selectedText: 'code1',
      };
      const ref2 = {
        id: 'ref-2',
        filePath: '/src/test2.ts',
        startLine: 20,
        endLine: 25,
        selectedText: 'code2',
      };

      store.addReference(ref1);
      store.addReference(ref2);
      expect(useAIStore.getState().pendingReferences).toHaveLength(2);

      store.removeReference('ref-1');

      const state = useAIStore.getState();
      expect(state.pendingReferences).toHaveLength(1);
      expect(state.pendingReferences[0].id).toBe('ref-2');
    });

    it('should handle removing non-existent reference id', () => {
      const store = useAIStore.getState();
      const ref = {
        id: 'ref-1',
        filePath: '/src/test.ts',
        startLine: 10,
        endLine: 15,
        selectedText: 'code',
      };

      store.addReference(ref);
      expect(useAIStore.getState().pendingReferences).toHaveLength(1);

      store.removeReference('non-existent-id');

      const state = useAIStore.getState();
      expect(state.pendingReferences).toHaveLength(1);
      expect(state.pendingReferences[0].id).toBe('ref-1');
    });

    it('should clear all references', () => {
      const store = useAIStore.getState();
      const ref1 = {
        id: 'ref-1',
        filePath: '/src/test1.ts',
        startLine: 10,
        endLine: 15,
        selectedText: 'code1',
      };
      const ref2 = {
        id: 'ref-2',
        filePath: '/src/test2.ts',
        startLine: 20,
        endLine: 25,
        selectedText: 'code2',
      };

      store.addReference(ref1);
      store.addReference(ref2);
      expect(useAIStore.getState().pendingReferences).toHaveLength(2);

      store.clearReferences();

      const state = useAIStore.getState();
      expect(state.pendingReferences).toHaveLength(0);
    });

    it('should clear references when array is already empty', () => {
      const store = useAIStore.getState();

      expect(useAIStore.getState().pendingReferences).toHaveLength(0);

      store.clearReferences();

      const state = useAIStore.getState();
      expect(state.pendingReferences).toHaveLength(0);
    });
  });

  describe('Message Type Coverage', () => {
    beforeEach(() => {
      const store = useAIStore.getState();
      store.setActiveSession('test-session');
    });

    it('should handle approval message type', () => {
      const store = useAIStore.getState();
      const approvalMsg = createMockAIMessage('approval', {
        requestId: 'req-1',
        toolCallId: 'tc-1',
        action: 'read',
        description: 'Read file',
        display: [],
        responded: false,
      });

      store.addMessage(approvalMsg);

      const messages = useAIStore.getState().aiMessages;
      expect(messages[0].type).toBe('approval');
    });

    it('should handle question message type', () => {
      const store = useAIStore.getState();
      const questionMsg = createMockAIMessage('question', {
        questionId: 'q-1',
        questions: [
          { id: 'q-1-1', text: 'What is your preference?' },
        ],
      });

      store.addMessage(questionMsg);

      const messages = useAIStore.getState().aiMessages;
      expect(messages[0].type).toBe('question');
    });

    it('should handle all message types', () => {
      const store = useAIStore.getState();
      const types: Array<'text' | 'think' | 'tool_call' | 'tool_result' | 'approval' | 'question' | 'subagent'> = [
        'text', 'think', 'tool_call', 'tool_result', 'approval', 'question', 'subagent',
      ];

      for (const type of types) {
        store.addMessage(createMockAIMessage(type, {}));
      }

      const messages = useAIStore.getState().aiMessages;
      expect(messages.length).toBe(types.length);
      expect(messages.map(m => m.type)).toEqual(types);
    });
  });
});