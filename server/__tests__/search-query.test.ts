/**
 * 搜索查询工具函数测试
 * 覆盖 search-query.ts 中 escapeFtsTokens（FTS5 查询转义）和 extractSnippet（摘要提取）逻辑
 */
import { describe, it, expect } from 'vitest';

// 这些函数在 search-query.ts 中是私有的，精确复制其逻辑用于单元测试

function escapeFtsTokens(tokens: string[]): string {
  return tokens
    .filter(t => t.length > 0)
    .map(t => `"${t.replace(/"/g, '""')}"`)
    .join(' ');
}

function extractSnippet(content: string, queryTokens: string[], radius = 80): string {
  if (!content) return '';

  let matchPos = -1;
  let matchedToken = '';
  for (const token of queryTokens) {
    const pos = content.indexOf(token);
    if (pos !== -1) {
      matchPos = pos;
      matchedToken = token;
      break;
    }
  }

  if (matchPos === -1) {
    return content.slice(0, 200) + (content.length > 200 ? '...' : '');
  }

  const start = Math.max(0, matchPos - radius);
  const end = Math.min(content.length, matchPos + matchedToken.length + radius);

  let snippet = '';
  if (start > 0) snippet += '...';
  snippet += content.slice(start, end);
  if (end < content.length) snippet += '...';

  for (const token of queryTokens) {
    snippet = snippet.split(token).join(`\u27EA${token}\u27EB`);
  }

  return snippet;
}

describe('escapeFtsTokens', () => {
  it('wraps each token in double quotes', () => {
    expect(escapeFtsTokens(['hello', 'world'])).toBe('"hello" "world"');
  });

  it('escapes internal double quotes by doubling them', () => {
    expect(escapeFtsTokens(['say"hi'])).toBe('"say""hi"');
  });

  it('filters out empty strings', () => {
    expect(escapeFtsTokens(['hello', '', 'world'])).toBe('"hello" "world"');
  });

  it('handles single token', () => {
    expect(escapeFtsTokens(['搜索'])).toBe('"搜索"');
  });

  it('handles Chinese tokens', () => {
    expect(escapeFtsTokens(['搜索', '引擎'])).toBe('"搜索" "引擎"');
  });

  it('returns empty string for all-empty input', () => {
    expect(escapeFtsTokens(['', ''])).toBe('');
  });

  it('returns empty string for empty array', () => {
    expect(escapeFtsTokens([])).toBe('');
  });

  it('handles tokens with multiple double quotes', () => {
    expect(escapeFtsTokens(['a"b"c'])).toBe('"a""b""c"');
  });

  it('handles special FTS characters inside quotes', () => {
    // 这些字符在 FTS5 双引号短语内会失去特殊含义
    expect(escapeFtsTokens(['AND', 'OR', 'NOT'])).toBe('"AND" "OR" "NOT"');
  });

  it('handles asterisk in tokens', () => {
    expect(escapeFtsTokens(['test*'])).toBe('"test*"');
  });
});

describe('extractSnippet', () => {
  it('returns empty string for empty content', () => {
    expect(extractSnippet('', ['test'])).toBe('');
  });

  it('returns first 200 chars when no match found', () => {
    const content = 'A'.repeat(300);
    const result = extractSnippet(content, ['xyz']);
    expect(result).toBe('A'.repeat(200) + '...');
  });

  it('returns full content when no match and content <= 200 chars', () => {
    const content = 'Short content';
    const result = extractSnippet(content, ['xyz']);
    expect(result).toBe('Short content');
  });

  it('extracts snippet around first matching token', () => {
    const content = 'A'.repeat(100) + 'TARGET' + 'B'.repeat(100);
    const result = extractSnippet(content, ['TARGET']);
    // 应包含 TARGET 及其上下文
    expect(result).toContain('TARGET');
    // 应包含高亮标记
    expect(result).toContain('\u27EA');
    expect(result).toContain('\u27EB');
  });

  it('adds ellipsis when snippet starts after beginning', () => {
    const content = 'X'.repeat(200) + 'TARGET' + 'Y'.repeat(200);
    const result = extractSnippet(content, ['TARGET'], 50);
    expect(result.startsWith('...')).toBe(true);
  });

  it('adds ellipsis when snippet ends before end', () => {
    const content = 'X'.repeat(200) + 'TARGET' + 'Y'.repeat(200);
    const result = extractSnippet(content, ['TARGET'], 50);
    expect(result.endsWith('...')).toBe(true);
  });

  it('does not add leading ellipsis when snippet starts at 0', () => {
    const content = 'TARGET' + 'B'.repeat(200);
    const result = extractSnippet(content, ['TARGET'], 80);
    expect(result.startsWith('...')).toBe(false);
  });

  it('does not add trailing ellipsis when snippet reaches end', () => {
    const content = 'A'.repeat(200) + 'TARGET';
    const result = extractSnippet(content, ['TARGET'], 80);
    expect(result.endsWith('...')).toBe(false);
  });

  it('highlights all query tokens', () => {
    const content = 'hello world and more text here';
    const result = extractSnippet(content, ['hello', 'world']);
    expect(result).toContain('\u27EAhello\u27EB');
    expect(result).toContain('\u27EAworld\u27EB');
  });

  it('uses default radius of 80', () => {
    const content = 'A'.repeat(200) + 'TARGET' + 'B'.repeat(200);
    const result = extractSnippet(content, ['TARGET']);
    // 默认半径 80，预期原始内容跨度约 80 + len('TARGET') + 80 个字符
    // 去除高亮标记（\u27EA 和 \u27EB，各 2 字符）和省略号来测量原始内容跨度
    const rawContent = result.replace(/\.\.\./g, '').replace(/\u27EA|\u27EB/g, '');
    expect(rawContent.length).toBeLessThanOrEqual(80 + 'TARGET'.length + 80);
  });

  it('respects custom radius', () => {
    const content = 'A'.repeat(200) + 'TARGET' + 'B'.repeat(200);
    const result = extractSnippet(content, ['TARGET'], 20);
    const withoutEllipsis = result.replace(/\.\.\./g, '').replace(/\u27EA|\u27EB/g, '');
    // 预期约为 20 + len('TARGET') + 20
    expect(withoutEllipsis.length).toBeLessThanOrEqual(20 + 'TARGET'.length + 20);
  });

  it('matches first token from query list', () => {
    const content = 'alpha beta gamma';
    // 'beta' 在查询列表中排在前面，而 'gamma' 在内容中
    const result = extractSnippet(content, ['beta', 'gamma']);
    // 'beta' 在内容中存在，应被匹配并高亮
    expect(result).toContain('\u27EAbeta\u27EB');
  });

  it('handles Chinese content with Chinese tokens', () => {
    const content = '这是一个关于搜索引擎的技术文档，包含了大量的技术细节。';
    const result = extractSnippet(content, ['搜索引擎']);
    expect(result).toContain('\u27EA搜索引擎\u27EB');
  });

  it('handles single-character tokens', () => {
    const content = 'find the x in the text';
    const result = extractSnippet(content, ['x']);
    expect(result).toContain('\u27EAx\u27EB');
  });
});
