import crypto from 'crypto';

// 密码字符集
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SPECIALS = '!@#$%^&*()-_=+';
const ALL_CHARS = UPPER + LOWER + DIGITS + SPECIALS;
const PASSWORD_LENGTH = 18;

/**
 * 生成固定 18 位强密码，确保包含大小写字母、数字、特殊字符
 */
export function generatePassword(): string {
  // 从每个字符集中至少取一个，剩余随机填充，然后打乱顺序
  const required = [
    UPPER[Math.floor(Math.random() * UPPER.length)],
    LOWER[Math.floor(Math.random() * LOWER.length)],
    DIGITS[Math.floor(Math.random() * DIGITS.length)],
    SPECIALS[Math.floor(Math.random() * SPECIALS.length)],
  ];

  const remaining = Array.from({ length: PASSWORD_LENGTH - required.length }, () =>
    ALL_CHARS[Math.floor(Math.random() * ALL_CHARS.length)]
  );

  const chars = [...required, ...remaining];
  // Fisher-Yates shuffle
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * 校验密码复杂度规则，返回不满足的规则列表
 */
export function validatePasswordComplexity(password: string): string[] {
  const errors: string[] = [];
  if (password.length !== PASSWORD_LENGTH) {
    errors.push(`长度必须为 ${PASSWORD_LENGTH} 位（当前 ${password.length} 位）`);
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('必须包含大写字母');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('必须包含小写字母');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('必须包含数字');
  }
  if (!/[!@#$%^&*()\-_=+]/.test(password)) {
    errors.push('必须包含特殊字符 (!@#$%^&*()-_=+)');
  }
  return errors;
}

/**
 * 使用时间安全比较验证密码
 */
export function verifyPassword(input: string, expected: string): boolean {
  const inputBuf = Buffer.from(input, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (inputBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(inputBuf, expectedBuf);
}

/** 暴力破解防护配置 */
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 分钟
const LOGIN_DELAY_MS = 1000; // 1 秒

interface LoginAttempt {
  count: number;
  lockedUntil: number;
}

const loginAttempts = new Map<string, LoginAttempt>();

/**
 * 获取客户端标识（IP + User-Agent 组合）
 */
export function getClientId(ip: string, userAgent: string): string {
  return crypto.createHash('sha256').update(`${ip}:${userAgent}`).digest('hex').slice(0, 16);
}

/**
 * 检查客户端是否被锁定
 */
export function isClientLocked(clientId: string): boolean {
  const attempt = loginAttempts.get(clientId);
  if (!attempt) return false;
  if (attempt.lockedUntil && Date.now() < attempt.lockedUntil) return true;
  if (attempt.lockedUntil && Date.now() >= attempt.lockedUntil) {
    loginAttempts.delete(clientId);
  }
  return false;
}

/**
 * 记录登录失败，返回是否触发锁定
 */
export function recordLoginFailure(clientId: string): boolean {
  let attempt = loginAttempts.get(clientId);
  if (!attempt) {
    attempt = { count: 0, lockedUntil: 0 };
    loginAttempts.set(clientId, attempt);
  }
  attempt.count++;
  if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
    attempt.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    return true;
  }
  return false;
}

/**
 * 清除客户端的登录失败记录（登录成功时调用）
 */
export function clearLoginAttempts(clientId: string): void {
  loginAttempts.delete(clientId);
}

/**
 * 获取登录延迟时间
 */
export function getLoginDelay(): number {
  return LOGIN_DELAY_MS;
}

/** Session LRU 清理配置 */
const MAX_SESSIONS = 50;

/**
 * 清理超出上限的最旧 Session
 * @param store express-session MemoryStore 实例
 */
export function pruneSessions(store: any): void {
  // MemoryStore 内部维护 sessions 对象
  const sessions = store.sessions as Record<string, string>;
  if (!sessions) return;

  const entries = Object.entries(sessions);
  if (entries.length <= MAX_SESSIONS) return;

  // 解析 session 数据，按 loginAt 排序
  const parsed = entries.map(([id, raw]) => {
    try {
      const data = JSON.parse(raw);
      return { id, loginAt: data.loginAt || 0 };
    } catch {
      return { id, loginAt: 0 };
    }
  });

  parsed.sort((a, b) => a.loginAt - b.loginAt);

  // 清理超出上限的
  const toRemove = parsed.slice(0, parsed.length - MAX_SESSIONS);
  for (const { id } of toRemove) {
    store.destroy(id);
  }
}
