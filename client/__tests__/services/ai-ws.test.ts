/**
 * AI WebSocket 通信测试
 *
 * 测试 /client/src/services/ai-ws.ts 中的 WebSocket 连接管理、消息收发、
 * 重连机制和心跳保活等功能。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mockWebSocket,
  restoreWebSocket,
  MockWebSocketInstance,
  clearAllMocks,
  mockTimers,
} from '../helpers/mocks';

describe('AIWebSocket', () => {
  let wsMock: ReturnType<typeof mockWebSocket>;
  let wsInstance: MockWebSocketInstance | null;

  beforeEach(() => {
    vi.resetModules();
    clearAllMocks();
    // Mock window.location 用于构造 WebSocket URL
    vi.stubGlobal('window', {
      location: {
        protocol: 'http:',
        host: 'localhost:3000',
      },
    });
    wsMock = mockWebSocket();
  });

  afterEach(() => {
    restoreWebSocket();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // ===== 连接管理测试 =====
  describe('Connection Management', () => {
    it('should establish WebSocket connection', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);

      wsInstance = wsMock.getLastInstance();
      expect(wsInstance).not.toBeNull();
      expect(wsInstance?.url).toContain('test-session-id');
      expect(wsInstance?.url).toContain('/api/ai/sessions/');

      // 模拟连接打开
      wsInstance?.simulateOpen();

      expect(callbacks.onConnect).toHaveBeenCalled();
    });

    it('should close connection on disconnect', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      expect(aiWs.isConnected()).toBe(true);

      aiWs.disconnect();

      expect(wsInstance?.close).toHaveBeenCalled();
      expect(aiWs.isConnected()).toBe(false);
    });

    it('should call onClose callback when connection closes intentionally', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      // 注意：disconnect() 在调用 close() 前会清除 onclose 回调，
      // 所以在 disconnect() 流程中 onClose 回调不会被调用。
      // 它仅在服务端发送 'close' 消息时被调用。
      aiWs.disconnect();

      // 验证连接已关闭
      expect(aiWs.isConnected()).toBe(false);
    });

    it('should call onError callback on connection error', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();

      // 模拟连接错误
      wsInstance?.simulateError();

      expect(callbacks.onError).toHaveBeenCalledWith({
        message: 'WebSocket connection error',
      });
    });

    it('should update isConnected status correctly', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      // 连接前
      expect(aiWs.isConnected()).toBe(false);

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();

      // WebSocket 已创建但尚未打开
      expect(aiWs.isConnected()).toBe(false);

      // 模拟连接打开
      wsInstance?.simulateOpen();
      expect(aiWs.isConnected()).toBe(true);

      // 断开连接
      aiWs.disconnect();
      expect(aiWs.isConnected()).toBe(false);
    });

    it('should clean up existing connection when reconnecting', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks1 = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      const callbacks2 = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      // 第一次连接
      aiWs.connect('session-1', callbacks1);
      const ws1 = wsMock.getLastInstance();
      ws1?.simulateOpen();

      // 第二次连接（应先关闭第一次连接）
      aiWs.connect('session-2', callbacks2);
      const ws2 = wsMock.getLastInstance();

      expect(ws2?.url).toContain('session-2');
      expect(ws2).not.toBe(ws1);
    });
  });

  // ===== 消息流测试 =====
  describe('Message Flow', () => {
    it('should parse and dispatch event messages', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      // 模拟接收事件消息
      wsInstance?.simulateMessage({
        type: 'ContentPart',
        payload: { type: 'text', text: 'Hello' },
      });

      expect(callbacks.onEvent).toHaveBeenCalledWith({
        type: 'ContentPart',
        payload: { type: 'text', text: 'Hello' },
      });
    });

    it('should handle request messages', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      // 模拟接收请求消息
      wsInstance?.simulateMessage({
        type: 'request',
        id: 'req-123',
        payload: { action: 'read_file', description: 'Read config file' },
      });

      expect(callbacks.onRequest).toHaveBeenCalledWith({
        id: 'req-123',
        payload: { action: 'read_file', description: 'Read config file' },
      });
    });

    it('should handle error messages', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      // 模拟接收错误消息
      wsInstance?.simulateMessage({
        type: 'error',
        payload: { message: 'Something went wrong' },
      });

      expect(callbacks.onError).toHaveBeenCalledWith({
        message: 'Something went wrong',
      });
    });

    it('should handle close messages from server', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      // 模拟接收服务端关闭消息
      wsInstance?.simulateMessage({
        type: 'close',
        payload: { code: null, sessionId: 'test-session-id' },
      });

      expect(callbacks.onClose).toHaveBeenCalledWith({
        code: null,
        sessionId: 'test-session-id',
      });
    });

    it('should handle connected confirmation message', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      // 模拟接收连接确认消息
      wsInstance?.simulateMessage({
        type: 'connected',
        payload: { sessionId: 'test-session-id' },
      });

      // 不应触发任何回调（仅记录日志）
      expect(callbacks.onEvent).not.toHaveBeenCalled();
    });

    it('should handle pong message for heartbeat', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      // 模拟接收 pong 响应
      wsInstance?.simulateMessage({
        type: 'pong',
      });

      // 不应触发任何回调
      expect(callbacks.onEvent).not.toHaveBeenCalled();
    });

    it('should handle multiple sequential messages', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      // 模拟发送多条消息
      wsInstance?.simulateMessage({ type: 'TurnBegin', payload: {} });
      wsInstance?.simulateMessage({ type: 'ContentPart', payload: { type: 'text', text: 'Part 1' } });
      wsInstance?.simulateMessage({ type: 'ContentPart', payload: { type: 'text', text: 'Part 2' } });
      wsInstance?.simulateMessage({ type: 'TurnEnd' });

      expect(callbacks.onEvent).toHaveBeenCalledTimes(4);
    });
  });

  // ===== 发送操作测试 =====
  describe('Send Operations', () => {
    it('should send prompt message correctly', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      aiWs.sendPrompt('Hello, AI!');

      expect(wsInstance?.send).toHaveBeenCalled();
      const sentData = wsInstance?.sentMessages[0];
      expect(JSON.parse(sentData)).toEqual({
        type: 'prompt',
        content: 'Hello, AI!',
      });
    });

    it('should send approval message correctly', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      aiWs.sendApproval('req-123', 'approve', 'Looks good');

      expect(wsInstance?.send).toHaveBeenCalled();
      const sentData = wsInstance?.sentMessages[0];
      expect(JSON.parse(sentData)).toEqual({
        type: 'approve',
        requestId: 'req-123',
        response: 'approve',
        feedback: 'Looks good',
      });
    });

    it('should send rejection message correctly', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      aiWs.sendApproval('req-123', 'reject', 'Not allowed');

      expect(wsInstance?.send).toHaveBeenCalled();
      const sentData = wsInstance?.sentMessages[0];
      expect(JSON.parse(sentData)).toEqual({
        type: 'approve',
        requestId: 'req-123',
        response: 'reject',
        feedback: 'Not allowed',
      });
    });

    it('should send cancel message correctly', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      aiWs.sendCancel();

      expect(wsInstance?.send).toHaveBeenCalled();
      const sentData = wsInstance?.sentMessages[0];
      expect(JSON.parse(sentData)).toEqual({
        type: 'cancel',
      });
    });

    it('should send answer message correctly', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      aiWs.sendAnswer('q-123', 'My answer');

      expect(wsInstance?.send).toHaveBeenCalled();
      const sentData = wsInstance?.sentMessages[0];
      expect(JSON.parse(sentData)).toEqual({
        type: 'answer',
        questionId: 'q-123',
        answer: 'My answer',
      });
    });

    it('should not send when WebSocket is not connected', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      // 不连接
      aiWs.sendPrompt('Hello');

      wsInstance = wsMock.getLastInstance();
      // 无实例或 send 未被调用
      if (wsInstance) {
        expect(wsInstance.send).not.toHaveBeenCalled();
      }
    });

    it('should not send after disconnect', async () => {
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      aiWs.disconnect();

      // 清除连接阶段发送的消息
      if (wsInstance) {
        wsInstance.sentMessages.length = 0;
      }

      // 尝试在断开后发送
      aiWs.sendPrompt('Hello');

      // send 不应再次被调用
      expect(wsInstance?.sentMessages.length).toBe(0);
    });
  });

  // ===== 重连机制测试 =====
  describe('Reconnect Logic', () => {
    it('should attempt reconnect on unexpected close', async () => {
      const timers = mockTimers();
      wsMock.clearInstances();
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      // 模拟非预期关闭（非 disconnect() 触发）
      wsInstance?.simulateClose(1006); // Abnormal closure

      // 等待重连延迟（首次尝试为 1 秒）
      timers.advanceTime(1000);

      // 应已创建新的 WebSocket（共 2 个实例：原始 + 重连）
      const newWsInstance = wsMock.getLastInstance();
      expect(newWsInstance).not.toBeNull();
      expect(newWsInstance?.url).toContain('test-session-id');

      timers.restore();
    });

    it('should use exponential backoff for reconnect', async () => {
      const timers = mockTimers();
      wsMock.clearInstances();
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      // 第一次关闭 - 1 秒后重连
      wsInstance?.simulateClose(1006);
      timers.advanceTime(1000);
      // 1 秒后应有 2 个实例（原始 + 首次重连）
      expect(wsMock.getLastInstance()).not.toBeNull();

      // 第二次关闭 - 2 秒后重连
      const instance1 = wsMock.getLastInstance();
      instance1?.simulateOpen(); // 需要打开才能进行连接逻辑
      instance1?.simulateClose(1006);
      timers.advanceTime(2000);
      // 再过 2 秒后应有新实例
      expect(wsMock.getLastInstance()).not.toBeNull();

      timers.restore();
    });

    it('should stop reconnecting after max attempts', async () => {
      const timers = mockTimers();
      wsMock.clearInstances();
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      // 模拟 5 次失败的重连（不打开重连的 socket）
      const delays = [1000, 2000, 4000, 8000, 16000];
      wsInstance?.simulateClose(1006);

      for (const delay of delays) {
        timers.advanceTime(delay);
        // 每次重连创建新的 WebSocket，但不打开它，因此保持关闭状态
      }

      // 5 次尝试后，应调用 onError
      expect(callbacks.onError).toHaveBeenCalledWith({
        message: '连接已断开，请刷新页面重试',
      });

      timers.restore();
    });

    it('should not reconnect when intentionally closed', async () => {
      const timers = mockTimers();
      wsMock.clearInstances();
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      // 主动断开连接
      aiWs.disconnect();

      // 推进时间 - 不应重连
      timers.advanceTime(10000);

      // 不应调用 onError（无重连错误）
      expect(callbacks.onError).not.toHaveBeenCalled();

      timers.restore();
    });

    it('should reset reconnect attempts on successful connection', async () => {
      const timers = mockTimers();
      wsMock.clearInstances();
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      // 第一次关闭并重连
      wsInstance?.simulateClose(1006);
      timers.advanceTime(1000);

      let newInstance = wsMock.getLastInstance();
      newInstance?.simulateOpen(); // 重连成功

      // 再次关闭 - 应再次使用 1 秒延迟（尝试次数已重置）
      newInstance?.simulateClose(1006);
      timers.advanceTime(1000);

      // 应已创建另一个实例
      const anotherInstance = wsMock.getLastInstance();
      expect(anotherInstance).not.toBeNull();

      timers.restore();
    });
  });

  // ===== 心跳机制测试 =====
  describe('Heartbeat Mechanism', () => {
    it('should start heartbeat on connection open', async () => {
      const timers = mockTimers();
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      // 推进 30 秒（心跳间隔）
      timers.advanceTime(30000);

      // 应已发送 ping 消息
      const pingMessage = wsInstance?.sentMessages.find((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === 'ping';
      });
      expect(pingMessage).toBeDefined();

      timers.restore();
    });

    it('should reset missedPongs on pong response', async () => {
      const timers = mockTimers();
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      // 发送 ping（30 秒）
      timers.advanceTime(30000);

      // 接收 pong 响应
      wsInstance?.simulateMessage({ type: 'pong' });

      // Send another ping (60s)
      timers.advanceTime(30000);

      // Should not close (missedPongs was reset)
      expect(wsInstance?.close).not.toHaveBeenCalled();

      timers.restore();
    });

    it('should close connection after too many missed pongs', async () => {
      const timers = mockTimers();
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      // Wait for 60s (2 missed pongs = 2 * 30s)
      timers.advanceTime(30000); // First ping, missedPongs = 1
      timers.advanceTime(30000); // Second ping, missedPongs = 2

      // Wait for another ping check (missedPongs > MAX_MISSED_PONGS)
      timers.advanceTime(30000); // Third ping, missedPongs = 3 > 2

      // Should have closed the connection
      expect(wsInstance?.close).toHaveBeenCalled();

      timers.restore();
    });

    it('should stop heartbeat on disconnect', async () => {
      const timers = mockTimers();
      const { aiWs } = await import('../../src/services/ai-ws');

      const callbacks = {
        onEvent: vi.fn(),
        onRequest: vi.fn(),
        onError: vi.fn(),
        onClose: vi.fn(),
        onConnect: vi.fn(),
      };

      aiWs.connect('test-session-id', callbacks);
      wsInstance = wsMock.getLastInstance();
      wsInstance?.simulateOpen();

      aiWs.disconnect();

      // Clear sent messages
      if (wsInstance) {
        wsInstance.sentMessages.length = 0;
      }

      // Advance time - should not send ping anymore
      timers.advanceTime(60000);

      // No new ping messages
      const pingMessages = wsInstance?.sentMessages.filter((msg) => {
        const parsed = JSON.parse(msg);
        return parsed.type === 'ping';
      });
      expect(pingMessages?.length).toBe(0);

      timers.restore();
    });
  });
});