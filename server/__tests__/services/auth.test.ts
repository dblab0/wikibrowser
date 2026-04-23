/**
 * 认证服务测试
 * 覆盖 auth.ts 的密码生成、复杂度校验、密码验证逻辑
 */
import { vi, describe, it, expect } from 'vitest';
import {
  generatePassword,
  validatePasswordComplexity,
  verifyPassword,
} from '../../src/services/auth.js';

describe('generatePassword', () => {
  it('生成的密码长度为 18', () => {
    const password = generatePassword();
    expect(password.length).toBe(18);
  });

  it('包含至少 1 个大写字母', () => {
    const password = generatePassword();
    expect(/[A-Z]/.test(password)).toBe(true);
  });

  it('包含至少 1 个小写字母', () => {
    const password = generatePassword();
    expect(/[a-z]/.test(password)).toBe(true);
  });

  it('包含至少 1 个数字', () => {
    const password = generatePassword();
    expect(/[0-9]/.test(password)).toBe(true);
  });

  it('包含至少 1 个特殊字符', () => {
    const password = generatePassword();
    expect(/[!@#$%^&*()\-_=+]/.test(password)).toBe(true);
  });

  it('连续生成多次不重复', () => {
    const passwords = new Set<string>();
    const iterations = 20;
    for (let i = 0; i < iterations; i++) {
      passwords.add(generatePassword());
    }
    expect(passwords.size).toBe(iterations);
  });
});

describe('validatePasswordComplexity', () => {
  it('合法密码返回空数组', () => {
    const validPassword = generatePassword();
    const errors = validatePasswordComplexity(validPassword);
    expect(errors).toEqual([]);
  });

  it('长度不足返回对应错误', () => {
    const errors = validatePasswordComplexity('Ab1!short');
    expect(errors).toContain('长度必须为 18 位（当前 9 位）');
  });

  it('缺少大写字母返回对应错误', () => {
    const password = 'a'.repeat(14) + '1!bcdefgh'; // 18 个字符，无大写
    const noUpper = 'bcdefgh1!xyzmnpqr'; // 18 个字符，全小写 + 数字 + 特殊字符
    const errors = validatePasswordComplexity(noUpper);
    expect(errors).toContain('必须包含大写字母');
  });

  it('缺少小写字母返回对应错误', () => {
    const password = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1!'; // 28 个字符 — 使用精确 18 个
    const noLower = 'ABCDEFGH1!XYZMNPQR'; // 18 个字符，全大写 + 数字 + 特殊字符
    const errors = validatePasswordComplexity(noLower);
    expect(errors).toContain('必须包含小写字母');
  });

  it('缺少数字返回对应错误', () => {
    const password = 'Abc!xyzMNPQRstuvwx'; // 18 个字符，无数字
    const errors = validatePasswordComplexity(password);
    expect(errors).toContain('必须包含数字');
  });

  it('缺少特殊字符返回对应错误', () => {
    const password = 'Abc1xyzMNPQRstuvwx'; // 18 个字符，无特殊字符
    const errors = validatePasswordComplexity(password);
    expect(errors).toContain('必须包含特殊字符 (!@#$%^&*()-_=+)');
  });

  it('多项不满足返回多个错误', () => {
    // 'abc' 长度不足、缺少大写、缺少数字、缺少特殊字符
    const errors = validatePasswordComplexity('abc');
    expect(errors.length).toBeGreaterThanOrEqual(3);
    expect(errors).toContain('长度必须为 18 位（当前 3 位）');
    expect(errors).toContain('必须包含大写字母');
    expect(errors).toContain('必须包含数字');
    expect(errors).toContain('必须包含特殊字符 (!@#$%^&*()-_=+)');
  });
});

describe('verifyPassword', () => {
  it('正确密码返回 true', () => {
    const password = 'test-password-123';
    expect(verifyPassword(password, password)).toBe(true);
  });

  it('错误密码返回 false', () => {
    expect(verifyPassword('wrong-password', 'correct-password')).toBe(false);
  });

  it('不同长度的密码返回 false（不崩溃）', () => {
    expect(verifyPassword('short', 'a-much-longer-password')).toBe(false);
    expect(verifyPassword('a-much-longer-password', 'short')).toBe(false);
  });

  it('空密码比较不崩溃', () => {
    expect(verifyPassword('', '')).toBe(true);
    expect(verifyPassword('', 'nonempty')).toBe(false);
    expect(verifyPassword('nonempty', '')).toBe(false);
  });

  it('包含 unicode 字符的密码正确比较', () => {
    const password = '密码-test-中文';
    expect(verifyPassword(password, password)).toBe(true);
    expect(verifyPassword(password, '密码-test-错误')).toBe(false);
  });

  it('正确密码与错误密码的比较时间应接近（timingSafeEqual 保证）', async () => {
    const correctPassword = 'Abcdefgh1!23456789';
    const wrongPassword =   'Abcdefgh1!23456788';

    const iterations = 100;
    const correctTimes: number[] = [];
    const wrongTimes: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      verifyPassword(correctPassword, correctPassword);
      correctTimes.push(Number(process.hrtime.bigint() - start));
    }

    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      verifyPassword(wrongPassword, correctPassword);
      wrongTimes.push(Number(process.hrtime.bigint() - start));
    }

    const avgCorrect = correctTimes.reduce((a, b) => a + b, 0) / iterations;
    const avgWrong = wrongTimes.reduce((a, b) => a + b, 0) / iterations;

    const ratio = Math.max(avgCorrect, avgWrong) / Math.max(Math.min(avgCorrect, avgWrong), 1);
    expect(ratio).toBeLessThan(5);
  });
});
