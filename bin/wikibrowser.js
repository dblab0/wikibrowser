#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// 读取版本号
function getVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    host: '127.0.0.1',
    port: 9001,
    logLevel: 'info',
    wireDebug: false,
    authCode: null,
    noAuth: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--host' && args[i + 1]) {
      config.host = args[i + 1];
      i++;
    } else if (args[i] === '--port' && args[i + 1]) {
      config.port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--log-level' && args[i + 1]) {
      const level = args[i + 1];
      if (['info', 'debug'].includes(level)) {
        config.logLevel = level;
      } else {
        console.error(`Invalid log level: ${level}. Use 'info' or 'debug'.`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--wire-debug') {
      config.wireDebug = true;
    } else if (args[i] === '--auth-code' && args[i + 1]) {
      config.authCode = args[i + 1];
      i++;
    } else if (args[i] === '--no-auth') {
      config.noAuth = true;
    } else if (args[i] === '--version' || args[i] === '-v') {
      console.log(`wikibrowser v${getVersion()}`);
      process.exit(0);
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
wikibrowser - Wiki Browser

Usage: wikibrowser [options]

Options:
  --host <host>       Server host (default: 127.0.0.1)
  --port <port>       Server port (default: 9001)
  --log-level <level> Log file verbosity: info | debug (default: info)
  --wire-debug        Enable AI wire message debug panel
  --auth-code <password> Custom auth password (18 chars, needs complexity)
  --no-auth               Disable auth (localhost only)
  --version, -v       Show version number
  --help, -h          Show this help message

Examples:
  wikibrowser
  wikibrowser --host 0.0.0.0 --port 3000
  wikibrowser --log-level debug
  wikibrowser --wire-debug
`);
      process.exit(0);
    }
  }

  return config;
}

const { host, port, logLevel, wireDebug, authCode, noAuth } = parseArgs();

// === 认证逻辑 ===
const isLocal = host === '127.0.0.1' || host === 'localhost';

// 密码复杂度验证函数
function validatePasswordComplexity(password) {
  const errors = [];
  if (password.length !== 18) errors.push(`长度必须为 18 位（当前 ${password.length} 位）`);
  if (!/[A-Z]/.test(password)) errors.push('必须包含大写字母');
  if (!/[a-z]/.test(password)) errors.push('必须包含小写字母');
  if (!/[0-9]/.test(password)) errors.push('必须包含数字');
  if (!/[!@#$%^&*()\-_=+]/.test(password)) errors.push('必须包含特殊字符 (!@#$%^&*()-_=+)');
  return errors;
}

// 生成 18 位随机密码
function generatePassword() {
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const specials = '!@#$%^&*()-_=+';
  const all = upper + lower + digits + specials;

  const required = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    specials[Math.floor(Math.random() * specials.length)],
  ];

  const remaining = Array.from({ length: 14 }, () =>
    all[Math.floor(Math.random() * all.length)]
  );

  const chars = [...required, ...remaining];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

let authEnabled = false;
let finalPassword = null;

if (noAuth && !isLocal) {
  console.error('');
  console.error('❌ 安全错误：非本地绑定（' + host + '）必须启用认证');
  console.error('   移除 --no-auth 参数，或使用 --host 127.0.0.1');
  console.error('');
  process.exit(1);
}

if (noAuth && isLocal) {
  // 本地绑定，用户明确禁用认证
  authEnabled = false;
} else if (authCode) {
  // 用户提供了自定义密码，校验复杂度
  const errors = validatePasswordComplexity(authCode);
  if (errors.length > 0) {
    console.error('');
    console.error('❌ 密码不满足要求：');
    errors.forEach(e => console.error('   - ' + e));
    console.error('');
    process.exit(1);
  }
  authEnabled = true;
  finalPassword = authCode;
} else if (!isLocal) {
  // 非本地绑定，没有自定义密码，自动生成
  authEnabled = true;
  finalPassword = generatePassword();
} else {
  // 本地绑定，默认不启用
  authEnabled = false;
}

// 设置环境变量传递给服务端
process.env.WIKIBROWSER_HOST = host;
process.env.WIKIBROWSER_PORT = String(port);
process.env.WIKIBROWSER_LOG_LEVEL = logLevel;
if (wireDebug) {
  process.env.WIRE_DEBUG = '1';
}

// 认证配置
if (authEnabled) {
  process.env.WIKIBROWSER_AUTH_ENABLED = '1';
  process.env.WIKIBROWSER_AUTH_CODE = finalPassword;
} else {
  process.env.WIKIBROWSER_AUTH_ENABLED = '0';
}

// 启动服务端
console.log('');
console.log(`WikiBrowser v${getVersion()} 启动成功`);
console.log('');
console.log(`访问地址: http://${host}:${port}`);
if (authEnabled) {
  console.log(`认证密码: ${finalPassword}`);
}
console.log('');

const serverPath = path.join(__dirname, '../dist/server/index.js');
const serverArgs = [serverPath];
if (wireDebug) {
  serverArgs.push('--wire-debug');
}
const server = spawn('node', serverArgs, {
  stdio: 'inherit',
  env: process.env,
});

server.on('error', (err) => {
  console.error('Failed to start wikibrowser:', err.message);
  process.exit(1);
});

server.on('close', (code) => {
  process.exit(code || 0);
});

// 处理终止信号
process.on('SIGINT', () => {
  server.kill('SIGINT');
});

process.on('SIGTERM', () => {
  server.kill('SIGTERM');
});
