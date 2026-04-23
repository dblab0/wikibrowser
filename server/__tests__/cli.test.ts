/**
 * CLI 参数解析与认证逻辑测试
 * 覆盖参数解析、认证强制逻辑、密码复杂度校验
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// 从 CLI 文件中提取的核心函数（复制逻辑进行测试）
// 因为 bin/wikibrowser.js 有顶级副作用，无法直接 import

/**
 * 解析 CLI 命令行参数
 * @param args - 命令行参数数组
 * @returns 解析后的配置对象
 */
function parseArgs(args: string[]) {
  const config = {
    host: '127.0.0.1',
    port: 9001,
    logLevel: 'info' as string,
    wireDebug: false,
    authCode: null as string | null,
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
      }
      i++;
    } else if (args[i] === '--wire-debug') {
      config.wireDebug = true;
    } else if (args[i] === '--auth-code' && args[i + 1]) {
      config.authCode = args[i + 1];
      i++;
    } else if (args[i] === '--no-auth') {
      config.noAuth = true;
    }
  }

  return config;
}

/**
 * 校验密码复杂度
 * @param password - 待校验的密码
 * @returns 错误信息数组，空数组表示通过
 */
function validatePasswordComplexity(password: string) {
  const errors: string[] = [];
  if (password.length !== 18) errors.push(`长度必须为 18 位（当前 ${password.length} 位）`);
  if (!/[A-Z]/.test(password)) errors.push('必须包含大写字母');
  if (!/[a-z]/.test(password)) errors.push('必须包含小写字母');
  if (!/[0-9]/.test(password)) errors.push('必须包含数字');
  if (!/[!@#$%^&*()\-_=+]/.test(password)) errors.push('必须包含特殊字符 (!@#$%^&*()-_=+)');
  return errors;
}

/**
 * 根据解析后的 CLI 配置确定认证策略
 * @param config - parseArgs 返回的配置对象
 * @returns 认证配置结果（含启用标志、密码或错误信息）
 */
function getAuthConfig(config: ReturnType<typeof parseArgs>) {
  const isLocal = config.host === '127.0.0.1' || config.host === 'localhost';

  // --no-auth + 非本地绑定 => 错误
  if (config.noAuth && !isLocal) {
    return { error: '非本地绑定必须启用认证' };
  }

  if (config.noAuth && isLocal) {
    return { authEnabled: false, password: null };
  }

  if (config.authCode) {
    const errors = validatePasswordComplexity(config.authCode);
    if (errors.length > 0) {
      return { error: '密码不满足要求', errors };
    }
    return { authEnabled: true, password: config.authCode };
  }

  if (!isLocal) {
    return { authEnabled: true, password: '__generated__' };
  }

  return { authEnabled: false, password: null };
}

describe('CLI 参数解析', () => {
  it('默认值：host=127.0.0.1, port=9001, 无认证', () => {
    const config = parseArgs([]);
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(9001);
    expect(config.authCode).toBeNull();
    expect(config.noAuth).toBe(false);
  });

  it('--auth-code 设置自定义密码', () => {
    const config = parseArgs(['--auth-code', 'MyPassword1!23456789']);
    // 注意：长度 20，但只测解析
    expect(config.authCode).toBe('MyPassword1!23456789');
  });

  it('--no-auth 设置禁用认证标志', () => {
    const config = parseArgs(['--no-auth']);
    expect(config.noAuth).toBe(true);
  });

  it('--host 0.0.0.0 设置局域网绑定', () => {
    const config = parseArgs(['--host', '0.0.0.0']);
    expect(config.host).toBe('0.0.0.0');
  });

  it('参数组合：--host 0.0.0.0 --auth-code Abcdefgh1!23456789', () => {
    const config = parseArgs(['--host', '0.0.0.0', '--auth-code', 'Abcdefgh1!23456789']);
    expect(config.host).toBe('0.0.0.0');
    expect(config.authCode).toBe('Abcdefgh1!23456789');
  });
});

describe('CLI 认证强制逻辑', () => {
  it('本地绑定默认不启用认证', () => {
    const result = getAuthConfig(parseArgs([]));
    expect(result.authEnabled).toBe(false);
  });

  it('非本地绑定自动启用认证', () => {
    const result = getAuthConfig(parseArgs(['--host', '0.0.0.0']));
    expect(result.authEnabled).toBe(true);
    expect(result.password).toBe('__generated__');
  });

  it('--no-auth + 本地绑定 => 禁用认证', () => {
    const result = getAuthConfig(parseArgs(['--no-auth']));
    expect(result.authEnabled).toBe(false);
  });

  it('--no-auth + 非本地绑定 => 错误', () => {
    const result = getAuthConfig(parseArgs(['--host', '0.0.0.0', '--no-auth']));
    expect(result.error).toBe('非本地绑定必须启用认证');
  });

  it('--auth-code 有效密码 => 启用认证', () => {
    const password = 'Abcdefgh1!23456789'; // 18 个字符，满足所有要求
    const result = getAuthConfig(parseArgs(['--auth-code', password]));
    expect(result.authEnabled).toBe(true);
    expect(result.password).toBe(password);
  });

  it('--auth-code 无效密码 => 错误', () => {
    const result = getAuthConfig(parseArgs(['--auth-code', 'short']));
    expect(result.error).toBe('密码不满足要求');
  });
});

describe('CLI 密码复杂度验证', () => {
  it('18 位包含全部字符类 => 通过', () => {
    const errors = validatePasswordComplexity('Abcdefgh1!23456789');
    expect(errors).toEqual([]);
  });

  it('长度不足 18 位 => 报错', () => {
    const errors = validatePasswordComplexity('Ab1!');
    expect(errors.some(e => e.includes('18'))).toBe(true);
  });

  it('缺少大写字母 => 报错', () => {
    const errors = validatePasswordComplexity('bcdefgh1!23456789a');
    expect(errors).toContain('必须包含大写字母');
  });

  it('缺少小写字母 => 报错', () => {
    const errors = validatePasswordComplexity('ABCDEFGH1!23456789');
    expect(errors).toContain('必须包含小写字母');
  });

  it('缺少数字 => 报错', () => {
    const errors = validatePasswordComplexity('Abcdefgh!@#$%^&*()');
    expect(errors).toContain('必须包含数字');
  });

  it('缺少特殊字符 => 报错', () => {
    const errors = validatePasswordComplexity('Abcdefgh1234567890');
    expect(errors).toContain('必须包含特殊字符 (!@#$%^&*()-_=+)');
  });
});
