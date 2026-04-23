#!/usr/bin/env node
/**
 * Mock Kimi CLI 进程
 * 模拟 Wire 协议的 JSON-RPC 通信，用于 E2E 测试 AI 对话流程
 */

const readline = require('readline');

// 解析启动参数
const args = process.argv.slice(2);

// 处理 --version：detectKimi() 会执行 kimi --version 检测安装状态
if (args.includes('--version')) {
  process.stdout.write('kimi-mock v1.0.0\n');
  process.exit(0);
}

const workDirIdx = args.indexOf('--work-dir');
const sessionIdx = args.indexOf('--session');
const workDir = workDirIdx >= 0 ? args[workDirIdx + 1] : '/tmp';
const sessionId = sessionIdx >= 0 ? args[sessionIdx + 1] : 'mock-session';

let msgId = 0;

/**
 * 发送 JSON-RPC 通知（Wire 协议事件）
 */
function sendEvent(type, payload) {
  const msg = { jsonrpc: '2.0', method: 'event', params: { type, payload } };
  process.stdout.write(JSON.stringify(msg) + '\n');
}

/**
 * 处理 prompt 请求，模拟流式响应
 */
function handlePrompt(text) {
  // 1. TurnBegin
  sendEvent('TurnBegin', { sessionId });

  // 2. 流式 ContentPart
  const response = `# 你好\n\n这是 AI 的模拟回复。你说了："${text}"。\n\n\`\`\`javascript\nconsole.log("hello from mock kimi");\n\`\`\`\n\n以上就是回答。`;
  for (const char of response) {
    sendEvent('ContentPart', { text: char, type: 'text' });
  }

  // 3. StatusUpdate
  sendEvent('StatusUpdate', { status: 'complete', sessionId });
}

// 监听 stdin 的 JSON-RPC 消息
const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);

    if (msg.method === 'initialize') {
      // 初始化握手响应
      const resp = { jsonrpc: '2.0', id: msg.id, result: { ready: true } };
      process.stdout.write(JSON.stringify(resp) + '\n');
    } else if (msg.method === 'prompt') {
      handlePrompt(msg.params?.text || msg.params?.content || '');
    }
  } catch {
    // 忽略无法解析的行
  }
});

// stdin 关闭时优雅退出
process.stdin.on('end', () => process.exit(0));
