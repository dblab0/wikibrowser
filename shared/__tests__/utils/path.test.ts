/**
 * 路径工具函数测试
 * 覆盖 shared/utils/path.ts 的 normalizePath 和 getWikiPath 路径标准化逻辑
 */
import { describe, it, expect } from 'vitest';
import { normalizePath, getWikiPath } from '../../utils/path';

describe('path utils', () => {
  describe('normalizePath', () => {
    it('should correctly connect path segments', () => {
      // Unix 风格路径应保持不变
      expect(normalizePath('/home/user/project')).toBe('/home/user/project');
      expect(normalizePath('a/b/c')).toBe('a/b/c');
      expect(normalizePath('./src/components')).toBe('./src/components');
      expect(normalizePath('../parent/child')).toBe('../parent/child');
    });

    it('should handle Windows and Unix path separators', () => {
      // Windows 反斜杠转 Unix 正斜杠
      expect(normalizePath('C:\\Users\\test')).toBe('C:/Users/test');
      expect(normalizePath('D:\\Projects\\MyApp\\src')).toBe('D:/Projects/MyApp/src');
      expect(normalizePath('a\\b\\c')).toBe('a/b/c');

      // 混合分隔符
      expect(normalizePath('C:\\Users/test\\documents')).toBe('C:/Users/test/documents');

      // UNC 路径
      expect(normalizePath('\\\\server\\share\\path')).toBe('//server/share/path');
    });

    it('should handle relative paths', () => {
      // 当前目录引用
      expect(normalizePath('./src')).toBe('./src');
      expect(normalizePath('.\\src')).toBe('./src');
      expect(normalizePath('./a/../b')).toBe('./a/../b');

      // 父级目录引用
      expect(normalizePath('../parent')).toBe('../parent');
      expect(normalizePath('..\\parent')).toBe('../parent');

      // 带有 Windows 分隔符的复杂相对路径
      expect(normalizePath('..\\..\\grandparent\\child')).toBe('../../grandparent/child');
    });

    it('should handle empty and edge cases', () => {
      expect(normalizePath('')).toBe('');
      expect(normalizePath('/')).toBe('/');
      expect(normalizePath('single')).toBe('single');
      expect(normalizePath('path/')).toBe('path/');
    });

    it('should handle paths with multiple consecutive separators', () => {
      // 注意：normalizePath 仅替换反斜杠，不会合并连续分隔符
      expect(normalizePath('path//file')).toBe('path//file');
      expect(normalizePath('path\\\\file')).toBe('path//file');
    });
  });

  describe('getWikiPath', () => {
    it('should return .zread/wiki path', () => {
      expect(getWikiPath('/home/user/project')).toBe('/home/user/project/.zread/wiki');
    });

    it('should handle Windows paths', () => {
      // 在 Unix 系统上，path.join 会转换分隔符
      const result = getWikiPath('C:\\Users\\test\\project');
      // path.join 在 Unix 上标准化为正斜杠
      expect(result).toContain('.zread');
      expect(result).toContain('wiki');
    });

    it('should handle relative project paths', () => {
      // path.join 会标准化路径，移除 ./ 前缀
      expect(getWikiPath('./my-project')).toBe('my-project/.zread/wiki');
      expect(getWikiPath('../parent-project')).toBe('../parent-project/.zread/wiki');
    });

    it('should handle paths with trailing slashes', () => {
      expect(getWikiPath('/home/user/project/')).toBe('/home/user/project/.zread/wiki');
    });

    it('should handle empty project path', () => {
      expect(getWikiPath('')).toBe('.zread/wiki');
    });

    it('should always append .zread/wiki regardless of input', () => {
      const testPaths = [
        '/absolute/path',
        'relative/path',
        '.',
        '..',
        '/root',
      ];

      for (const projectPath of testPaths) {
        const result = getWikiPath(projectPath);
        expect(result.endsWith('.zread/wiki')).toBe(true);
      }
    });
  });
});