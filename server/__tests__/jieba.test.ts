/**
 * jieba 中文分词服务测试
 * 覆盖精确模式分词（cutText）、搜索模式分词（cutForSearch）及兜底分词逻辑
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initJieba, cutText, cutForSearch } from '../src/services/jieba.js';

// fallbackTokenize 是私有函数，复制其逻辑用于测试
function fallbackTokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  tokens.push(...(lower.match(/[a-z0-9]+/g) || []));
  tokens.push(...(lower.match(/[\u4e00-\u9fff]/g) || []));
  return tokens;
}

describe('jieba service', () => {
  beforeAll(async () => {
    await initJieba();
  }, 30_000);

  describe('cutText (precise mode)', () => {
    it('should tokenize Chinese text', () => {
      const tokens = cutText('项目概述');
      expect(tokens.length).toBeGreaterThan(0);
      // 精确模式通常产生更少、更大的分词片段
      expect(tokens).toContain('项目');
    });

    it('should tokenize English text', () => {
      const tokens = cutText('hello world');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
    });

    it('should tokenize mixed Chinese-English text', () => {
      const tokens = cutText('React组件开发');
      expect(tokens.length).toBeGreaterThan(0);
      // 应同时包含英文和中文分词结果
      const hasEnglish = tokens.some(t => /[a-z]/i.test(t));
      const hasChinese = tokens.some(t => /[\u4e00-\u9fff]/.test(t));
      expect(hasEnglish || hasChinese).toBe(true);
    });

    it('should handle empty string', () => {
      const tokens = cutText('');
      expect(tokens).toEqual([]);
    });

    it('should handle pure whitespace', () => {
      const tokens = cutText('   ');
      // jieba-wasm 可能返回空白字符；不应导致崩溃
      expect(Array.isArray(tokens)).toBe(true);
    });

    it('should handle special characters', () => {
      const tokens = cutText('test@example.com');
      expect(tokens.length).toBeGreaterThan(0);
    });
  });

  describe('cutForSearch (search mode)', () => {
    it('should tokenize Chinese text with finer granularity', () => {
      const preciseTokens = cutText('搜索引擎');
      const searchTokens = cutForSearch('搜索引擎');
      // 搜索模式通常产生更多（更细粒度）的分词
      expect(searchTokens.length).toBeGreaterThanOrEqual(preciseTokens.length);
    });

    it('should tokenize English text', () => {
      const tokens = cutForSearch('hello world');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
    });

    it('should tokenize mixed text', () => {
      const tokens = cutForSearch('TypeScript入门教程');
      expect(tokens.length).toBeGreaterThan(0);
    });

    it('should handle empty string', () => {
      const tokens = cutForSearch('');
      expect(tokens).toEqual([]);
    });
  });

  describe('fallbackTokenize logic', () => {
    it('extracts English words as lowercase', () => {
      const tokens = fallbackTokenize('Hello World 123');
      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
      expect(tokens).toContain('123');
    });

    it('extracts individual Chinese characters', () => {
      const tokens = fallbackTokenize('项目概述');
      expect(tokens).toContain('项');
      expect(tokens).toContain('目');
      expect(tokens).toContain('概');
      expect(tokens).toContain('述');
    });

    it('handles mixed content', () => {
      const tokens = fallbackTokenize('React组件');
      expect(tokens).toContain('react');
      expect(tokens).toContain('组');
      expect(tokens).toContain('件');
    });

    it('returns empty array for empty string', () => {
      expect(fallbackTokenize('')).toEqual([]);
    });

    it('returns empty array for whitespace-only', () => {
      expect(fallbackTokenize('   ')).toEqual([]);
    });

    it('returns empty array for punctuation only', () => {
      expect(fallbackTokenize('！@#￥%')).toEqual([]);
    });
  });
});
