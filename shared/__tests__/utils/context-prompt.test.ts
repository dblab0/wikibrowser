/**
 * 上下文提示工具测试
 * 覆盖 shared/utils/context-prompt.ts 的 buildContextPrompt、parseContextPrompt、
 * getFileName、formatLineRange 四个函数
 */
import { describe, it, expect } from 'vitest';
import {
  buildContextPrompt,
  parseContextPrompt,
  getFileName,
  formatLineRange,
} from '../../utils/context-prompt.js';
import type { FileReference } from '../../types/index.js';

describe('context-prompt', () => {
  describe('buildContextPrompt', () => {
    it('should return original text when no references', () => {
      const result = buildContextPrompt([], 'Hello AI');
      expect(result).toBe('Hello AI');
    });

    it('should build prompt with single reference', () => {
      const refs: FileReference[] = [{
        id: '1',
        filePath: 'example.md',
        startLine: 10,
        endLine: 15,
        selectedText: 'selected text'
      }];
      const result = buildContextPrompt(refs, 'Explain this');
      expect(result).toContain('<!--CTX_START-->');
      expect(result).toContain('<!--CTX_END-->');
      expect(result).toContain('- example.md L10-L15');
      expect(result).toContain('Explain this');
    });

    it('should build prompt with multiple references', () => {
      const refs: FileReference[] = [
        {
          id: '1',
          filePath: 'file1.md',
          startLine: 5,
          endLine: 10,
          selectedText: 'text1'
        },
        {
          id: '2',
          filePath: 'file2.md',
          startLine: 20,
          endLine: 25,
          selectedText: 'text2'
        }
      ];
      const result = buildContextPrompt(refs, 'Compare these');
      expect(result).toContain('- file1.md L5-L10');
      expect(result).toContain('- file2.md L20-L25');
    });

    it('should handle empty text', () => {
      const refs: FileReference[] = [{
        id: '1',
        filePath: 'test.md',
        startLine: 1,
        endLine: 5,
        selectedText: 'text'
      }];
      const result = buildContextPrompt(refs, '');
      expect(result).toContain('<!--CTX_START-->');
    });

    it('should handle special characters', () => {
      const refs: FileReference[] = [{
        id: '1',
        filePath: 'file with spaces.md',
        startLine: 1,
        endLine: 1,
        selectedText: 'text with <special> chars'
      }];
      const result = buildContextPrompt(refs, 'Test');
      expect(result).toContain('file with spaces.md');
    });
  });

  describe('parseContextPrompt', () => {
    it('should parse prompt with CTX markers', () => {
      const input = `<!--CTX_START-->
用户引用了以下文件内容，请使用 ReadFile 工具查看：
- example.md L10-L15
<!--CTX_END-->
Explain this`;
      const result = parseContextPrompt(input);
      expect(result.visibleText).toBe('Explain this');
      expect(result.references).toHaveLength(1);
      expect(result.references[0]).toEqual({
        id: expect.any(String),
        filePath: 'example.md',
        startLine: 10,
        endLine: 15,
        selectedText: ''
      });
    });

    it('should parse prompt with multiple references', () => {
      const input = `<!--CTX_START-->
用户引用了以下文件内容，请使用 ReadFile 工具查看：
- file1.md L5-L10
- file2.md L20-L25
<!--CTX_END-->
Question`;
      const result = parseContextPrompt(input);
      expect(result.references).toHaveLength(2);
    });

    it('should return original text without CTX markers', () => {
      const input = 'Just a normal message';
      const result = parseContextPrompt(input);
      expect(result.visibleText).toBe('Just a normal message');
      expect(result.references).toHaveLength(0);
    });

    it('should handle empty reference list', () => {
      const input = `<!--CTX_START-->

<!--CTX_END-->
Empty`;
      const result = parseContextPrompt(input);
      expect(result.visibleText).toBe('Empty');
      expect(result.references).toHaveLength(0);
    });

    it('should handle malformed markers gracefully', () => {
      const input = `<!--CTX_START-->
Incomplete marker`;
      const result = parseContextPrompt(input);
      expect(result.visibleText).toBe(input);
      expect(result.references).toHaveLength(0);
    });
  });

  describe('getFileName', () => {
    it('should extract filename from normal path', () => {
      expect(getFileName('path/to/file.md')).toBe('file.md');
    });

    it('should extract filename from deep path', () => {
      expect(getFileName('a/b/c/d/e/file.txt')).toBe('file.txt');
    });

    it('should return filename only when given filename', () => {
      expect(getFileName('file.md')).toBe('file.md');
    });

    it('should handle Windows paths', () => {
      expect(getFileName('C:\\Users\\test\\file.md')).toBe('file.md');
      expect(getFileName('path\\to\\file.md')).toBe('file.md');
    });

    it('should handle trailing slashes', () => {
      expect(getFileName('path/to/')).toBe('');
    });

    it('should handle empty string', () => {
      expect(getFileName('')).toBe('');
    });
  });

  describe('formatLineRange', () => {
    it('should format single line range', () => {
      expect(formatLineRange(10, 10)).toBe('L10');
    });

    it('should format multi-line range', () => {
      expect(formatLineRange(10, 15)).toBe('L10-L15');
    });

    it('should handle reversed order', () => {
      expect(formatLineRange(15, 10)).toBe('L10-L15');
    });
  });
});
