/**
 * Wiki 加载器测试
 * 覆盖 wiki.json 解析、页面 Markdown 加载、版本管理、缓存逻辑
 */
// 必须在所有 Mock 之前导入 vi
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { WikiData, WikiPage } from '../../../shared/types/index.js'

// 对 fs 使用部分 Mock
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
    statSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
  }
})

// 对 fs/promises 使用部分 Mock
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(),
  }
})

// Mock 缓存模块以隔离缓存行为
vi.mock('../../src/services/cache.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/cache.js')>()
  // 为每个测试创建新的缓存实例
  const { LRUCache } = actual
  return {
    ...actual,
    wikiDataCache: new LRUCache<any>(50),
    pageContentCache: new LRUCache<string>(200),
  }
})

// 导入被 Mock 的模块
import * as fs from 'fs'
import * as fsPromises from 'fs/promises'
import { readFileSync, readdirSync } from 'fs'

// Mock 之后导入缓存
import { wikiDataCache, pageContentCache } from '../../src/services/cache.js'

// 导入待测模块
import {
  loadWikiJson,
  loadPageMarkdown,
  resolvePageFilePath,
  savePageMarkdown,
  getPageBySlug,
  readCurrentPointer,
  listVersions,
} from '../../src/services/wiki-loader.js'

// 用于断言的路径归一化辅助函数（处理 Windows 反斜杠）
function np(p: string): string {
  return p.replace(/\\/g, '/')
}

// 断言 Mock 被以匹配给定归一化路径的参数调用
function expectCalledWithPath(mock: ReturnType<typeof vi.fn>, expectedPath: string) {
  const normalizedExpected = np(expectedPath)
  const found = mock.mock.calls.some((call: any[]) => np(call[0]) === normalizedExpected)
  expect(found).toBe(true)
}

// 创建合法 WikiData 的辅助函数
function createWikiData(overrides: Partial<WikiData> = {}): WikiData {
  return {
    id: 'test-wiki',
    generated_at: '2026-04-17T10:00:00Z',
    language: 'zh-CN',
    pages: [
      {
        slug: 'introduction',
        title: 'Introduction',
        file: 'introduction.md',
        section: 'Getting Started',
        level: 'Beginner',
      },
      {
        slug: 'CLI',
        title: 'CLI Commands',
        file: 'cli.md',
        section: 'Reference',
        level: 'Intermediate',
      },
      {
        slug: 'advanced',
        title: 'Advanced Topics',
        file: 'advanced.md',
        section: 'Advanced',
        level: 'Advanced',
      },
    ],
    ...overrides,
  }
}

// 包含 blog 标签的示例 Markdown 内容
const markdownWithBlogTags = `---
title: Introduction
---

<blog>
This is blog content.
</blog>

# Introduction

This is the main content.

<blog>
More blog content.
</blog>

End of document.
`

const markdownWithoutBlogTags = `---
title: Introduction
---


# Introduction

This is the main content.


End of document.
`

// 跨平台兼容的路径归一化（Windows 使用 \，测试使用 /）
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}

describe('WikiLoader', () => {
  let mockFileContents: Map<string, string>
  let mockDirectories: Set<string>
  const wikiPath = '/test/wiki'
  const version = 'v1.0.0'

  beforeEach(() => {
    mockFileContents = new Map()
    mockDirectories = new Set()
    vi.resetAllMocks()

    // 每次测试前清除缓存
    wikiDataCache.clear()
    pageContentCache.clear()

    // 设置 fs.existsSync Mock（跨平台归一化）
    vi.mocked(fs.existsSync).mockImplementation((p: string) => {
      const normalized = normalizePath(p)
      if (mockFileContents.has(normalized) || mockDirectories.has(normalized)) return true
      // 如果路径是已知目录的父路径也返回 true
      const prefix = normalized + '/'
      for (const dir of mockDirectories) {
        if (dir.startsWith(prefix)) return true
      }
      return false
    })

    // 设置 fs.writeFileSync Mock
    vi.mocked(fs.writeFileSync).mockImplementation((p: string, content: string) => {
      mockFileContents.set(normalizePath(p), content)
    })

    // 设置 fs.statSync Mock
    vi.mocked(fs.statSync).mockImplementation((p: string) => {
      const normalized = normalizePath(p)
      const isDir = mockDirectories.has(normalized)
      const hasEntry = mockFileContents.has(normalized) || isDir
      if (!hasEntry) {
        const error = new Error(`ENOENT: no such file or directory, stat '${p}'`)
        ;(error as any).code = 'ENOENT'
        throw error
      }
      return {
        mtimeMs: Date.now(),
        isDirectory: () => isDir,
        isFile: () => !isDir,
        isSymbolicLink: () => false,
      } as fs.Stats
    })

    // 设置 fs.readFileSync Mock
    vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
      const normalized = normalizePath(p)
      const content = mockFileContents.get(normalized)
      if (content === undefined) {
        const error = new Error(`ENOENT: no such file or directory, open '${p}'`)
        ;(error as any).code = 'ENOENT'
        throw error
      }
      return content
    })

    // 设置 fs.readdirSync Mock
    vi.mocked(fs.readdirSync).mockImplementation((dirPath: string) => {
      const normalizedDir = normalizePath(dirPath)
      const prefix = normalizedDir + '/'
      const entries: string[] = []
      for (const p of mockDirectories) {
        if (p.startsWith(prefix)) {
          const rest = p.slice(prefix.length)
          if (!rest.includes('/')) {
            entries.push(rest)
          }
        }
      }
      return entries
    })

    // 设置 fs/promises.readFile Mock
    vi.mocked(fsPromises.readFile).mockImplementation((p: string) => {
      const normalized = normalizePath(p)
      const content = mockFileContents.get(normalized)
      if (content === undefined) {
        const error = new Error(`ENOENT: no such file or directory, open '${p}'`)
        ;(error as any).code = 'ENOENT'
        return Promise.reject(error)
      }
      return Promise.resolve(content)
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
    wikiDataCache.clear()
    pageContentCache.clear()
  })

  describe('loadWikiJson', () => {
    describe('解析 wiki.json 并返回结构化索引', () => {
      it('should load from versioned path when wiki.json exists in versions/{version}', async () => {
        const wikiData = createWikiData()
        const versionedPath = `${wikiPath}/versions/${version}/wiki.json`
        mockFileContents.set(versionedPath, JSON.stringify(wikiData))

        const result = await loadWikiJson(wikiPath, version)

        expect(result).not.toBeNull()
        expect(result!.id).toBe('test-wiki')
        expect(result!.pages.length).toBe(3)
        expect(result!.pages[0].slug).toBe('introduction')
        expectCalledWithPath(fs.existsSync, versionedPath)
      })

      it('should load from current path when versioned path does not exist', async () => {
        const wikiData = createWikiData()
        const currentPath = `${wikiPath}/current/wiki.json`
        mockFileContents.set(currentPath, JSON.stringify(wikiData))

        const result = await loadWikiJson(wikiPath, version)

        expect(result).not.toBeNull()
        expect(result!.id).toBe('test-wiki')
        expectCalledWithPath(fs.existsSync, `${wikiPath}/versions/${version}/wiki.json`)
        expectCalledWithPath(fs.existsSync, currentPath)
      })

      it('should load from root wiki path as fallback', async () => {
        const wikiData = createWikiData()
        const rootPath = `${wikiPath}/wiki.json`
        mockFileContents.set(rootPath, JSON.stringify(wikiData))

        const result = await loadWikiJson(wikiPath, version)

        expect(result).not.toBeNull()
        expect(result!.id).toBe('test-wiki')
        expectCalledWithPath(fs.existsSync, `${wikiPath}/versions/${version}/wiki.json`)
        expectCalledWithPath(fs.existsSync, `${wikiPath}/current/wiki.json`)
        expectCalledWithPath(fs.existsSync, rootPath)
      })

      it('should correctly parse all WikiPage fields', async () => {
        const wikiData: WikiData = {
          id: 'full-wiki',
          generated_at: '2026-04-17T12:00:00Z',
          language: 'en-US',
          pages: [
            {
              slug: 'page-with-group',
              title: 'Page with Group',
              file: 'group-page.md',
              section: 'Section A',
              group: 'Group 1',
              level: 'Intermediate',
            },
          ],
        }
        const versionedPath = `${wikiPath}/versions/${version}/wiki.json`
        mockFileContents.set(versionedPath, JSON.stringify(wikiData))

        const result = await loadWikiJson(wikiPath, version)

        expect(result!.pages[0].group).toBe('Group 1')
        expect(result!.pages[0].level).toBe('Intermediate')
      })
    })

    describe('处理不存在的 wiki 目录返回 null', () => {
      it('should return null when wiki.json does not exist anywhere', async () => {
        const result = await loadWikiJson(wikiPath, version)

        expect(result).toBeNull()
      })

      it('should return null when wiki directory path is invalid', async () => {
        const result = await loadWikiJson('/nonexistent/path', version)

        expect(result).toBeNull()
      })
    })

    describe('处理格式错误的 JSON', () => {
      it('should handle malformed JSON and return null', async () => {
        const versionedPath = `${wikiPath}/versions/${version}/wiki.json`
        mockFileContents.set(versionedPath, 'invalid json content {')

        const result = await loadWikiJson(wikiPath, version)

        expect(result).toBeNull()
      })

      it('should fallback to next path when versioned JSON is malformed', async () => {
        const wikiData = createWikiData()
        const versionedPath = `${wikiPath}/versions/${version}/wiki.json`
        const currentPath = `${wikiPath}/current/wiki.json`
        mockFileContents.set(versionedPath, 'invalid json')
        mockFileContents.set(currentPath, JSON.stringify(wikiData))

        const result = await loadWikiJson(wikiPath, version)

        expect(result).not.toBeNull()
        expect(result!.id).toBe('test-wiki')
      })

      it('should handle empty JSON object', async () => {
        const versionedPath = `${wikiPath}/versions/${version}/wiki.json`
        mockFileContents.set(versionedPath, '{}')

        const result = await loadWikiJson(wikiPath, version)

        // Should parse but have undefined fields
        expect(result).not.toBeNull()
        expect(result!.pages).toBeUndefined()
      })

      it('should handle JSON with missing required fields', async () => {
        const versionedPath = `${wikiPath}/versions/${version}/wiki.json`
        mockFileContents.set(versionedPath, JSON.stringify({ id: 'partial-wiki' }))

        const result = await loadWikiJson(wikiPath, version)

        expect(result).not.toBeNull()
        expect(result!.id).toBe('partial-wiki')
        expect(result!.pages).toBeUndefined()
      })
    })

    describe('缓存层', () => {
      it('should cache loaded wiki.json data', async () => {
        const wikiData = createWikiData()
        const versionedPath = `${wikiPath}/versions/${version}/wiki.json`
        mockFileContents.set(versionedPath, JSON.stringify(wikiData))

        // 首次加载
        const result1 = await loadWikiJson(wikiPath, version)
        expect(result1).not.toBeNull()

        // 检查缓存
        const cacheKey = `${wikiPath}:${version}`
        const cached = wikiDataCache.get(cacheKey)
        expect(cached).not.toBeNull()
        expect(cached!.id).toBe('test-wiki')
      })

      it('should return cached data on subsequent calls', async () => {
        const wikiData = createWikiData()
        const versionedPath = `${wikiPath}/versions/${version}/wiki.json`
        mockFileContents.set(versionedPath, JSON.stringify(wikiData))

        // 首次加载 - should call fs methods
        await loadWikiJson(wikiPath, version)
        const firstCallCount = vi.mocked(fs.existsSync).mock.calls.length

        // 第二次加载 - 应使用缓存
        const result2 = await loadWikiJson(wikiPath, version)
        expect(result2).not.toBeNull()

        // existsSync should not be called again (cache hit)
        // 注意：缓存检查在 existsSync 之前，因此调用次数不应增加
        const secondCallCount = vi.mocked(fs.existsSync).mock.calls.length
        expect(secondCallCount).toBe(firstCallCount)
      })

      it('should use different cache keys for different versions', async () => {
        const wikiData1 = createWikiData({ id: 'wiki-v1' })
        const wikiData2 = createWikiData({ id: 'wiki-v2' })

        mockFileContents.set(`${wikiPath}/versions/v1.0.0/wiki.json`, JSON.stringify(wikiData1))
        mockFileContents.set(`${wikiPath}/versions/v2.0.0/wiki.json`, JSON.stringify(wikiData2))

        const result1 = await loadWikiJson(wikiPath, 'v1.0.0')
        const result2 = await loadWikiJson(wikiPath, 'v2.0.0')

        expect(result1!.id).toBe('wiki-v1')
        expect(result2!.id).toBe('wiki-v2')

        // 两者应分别缓存
        expect(wikiDataCache.get(`${wikiPath}:v1.0.0`)!.id).toBe('wiki-v1')
        expect(wikiDataCache.get(`${wikiPath}:v2.0.0`)!.id).toBe('wiki-v2')
      })
    })
  })

  describe('loadPageMarkdown', () => {
    const file = 'introduction.md'

    describe('读取指定版本和 slug 的 markdown 文件', () => {
      it('should load markdown from versions/{version}/pages/{file}', async () => {
        const filePath = `${wikiPath}/versions/${version}/pages/${file}`
        mockFileContents.set(filePath, '# Introduction Content')

        const result = await loadPageMarkdown(wikiPath, version, file)

        expect(result).toBe('# Introduction Content')
        expectCalledWithPath(fs.existsSync, filePath)
      })

      it('should load markdown from versions/{version}/{file} as fallback', async () => {
        const filePath = `${wikiPath}/versions/${version}/${file}`
        mockFileContents.set(filePath, '# Versioned Content')

        const result = await loadPageMarkdown(wikiPath, version, file)

        expect(result).toBe('# Versioned Content')
      })

      it('should load markdown from current/pages/{file}', async () => {
        const filePath = `${wikiPath}/current/pages/${file}`
        mockFileContents.set(filePath, '# Current Pages Content')

        const result = await loadPageMarkdown(wikiPath, version, file)

        expect(result).toBe('# Current Pages Content')
      })

      it('should load markdown from current/{file}', async () => {
        const filePath = `${wikiPath}/current/${file}`
        mockFileContents.set(filePath, '# Current Content')

        const result = await loadPageMarkdown(wikiPath, version, file)

        expect(result).toBe('# Current Content')
      })

      it('should load markdown from pages/{file} as final fallback', async () => {
        const filePath = `${wikiPath}/pages/${file}`
        mockFileContents.set(filePath, '# Root Pages Content')

        const result = await loadPageMarkdown(wikiPath, version, file)

        expect(result).toBe('# Root Pages Content')
      })
    })

    describe('处理文件不存在的情况', () => {
      it('should return null when file does not exist in any location', async () => {
        const result = await loadPageMarkdown(wikiPath, version, 'nonexistent.md')

        expect(result).toBeNull()
      })

      it('should try all candidate paths before returning null', async () => {
        await loadPageMarkdown(wikiPath, version, 'nonexistent.md')

        // 应检查全部 5 个候选路径
        expectCalledWithPath(fs.existsSync, `${wikiPath}/versions/${version}/pages/nonexistent.md`)
        expectCalledWithPath(fs.existsSync, `${wikiPath}/versions/${version}/nonexistent.md`)
        expectCalledWithPath(fs.existsSync, `${wikiPath}/current/pages/nonexistent.md`)
        expectCalledWithPath(fs.existsSync, `${wikiPath}/current/nonexistent.md`)
        expectCalledWithPath(fs.existsSync, `${wikiPath}/pages/nonexistent.md`)
      })
    })

    describe('移除 blog 标签', () => {
      it('should strip <blog> opening tags from content', async () => {
        const filePath = `${wikiPath}/versions/${version}/pages/${file}`
        mockFileContents.set(filePath, '<blog>Blog content</blog>Main content')

        const result = await loadPageMarkdown(wikiPath, version, file)

        expect(result).toBe('Blog contentMain content')
        expect(result!.includes('<blog>')).toBe(false)
      })

      it('should strip </blog> closing tags from content', async () => {
        const filePath = `${wikiPath}/versions/${version}/pages/${file}`
        mockFileContents.set(filePath, 'Content before<blog>hidden</blog>Content after')

        const result = await loadPageMarkdown(wikiPath, version, file)

        expect(result).toBe('Content beforehiddenContent after')
        expect(result!.includes('</blog>')).toBe(false)
      })

      it('should strip multiple blog tags', async () => {
        const filePath = `${wikiPath}/versions/${version}/pages/${file}`
        mockFileContents.set(filePath, markdownWithBlogTags)

        const result = await loadPageMarkdown(wikiPath, version, file)

        expect(result!.includes('<blog>')).toBe(false)
        expect(result!.includes('</blog>')).toBe(false)
      })

      it('should preserve content inside blog tags', async () => {
        const filePath = `${wikiPath}/versions/${version}/pages/${file}`
        mockFileContents.set(filePath, '<blog>Important blog content here</blog>')

        const result = await loadPageMarkdown(wikiPath, version, file)

        expect(result).toBe('Important blog content here')
      })

      it('should handle content without blog tags unchanged', async () => {
        const filePath = `${wikiPath}/versions/${version}/pages/${file}`
        const originalContent = '# Pure Markdown\n\nNo blog tags here.'
        mockFileContents.set(filePath, originalContent)

        const result = await loadPageMarkdown(wikiPath, version, file)

        expect(result).toBe(originalContent)
      })
    })

    describe('缓存层', () => {
      it('should cache loaded page content', async () => {
        const filePath = `${wikiPath}/versions/${version}/pages/${file}`
        mockFileContents.set(filePath, '# Cached Content')

        await loadPageMarkdown(wikiPath, version, file)

        const cacheKey = `${wikiPath}:${version}:${file}`
        const cached = pageContentCache.get(cacheKey)
        expect(cached).toBe('# Cached Content')
      })

      it('should return cached content on subsequent calls', async () => {
        const filePath = `${wikiPath}/versions/${version}/pages/${file}`
        mockFileContents.set(filePath, '# Cached Content')

        // 首次加载
        await loadPageMarkdown(wikiPath, version, file)
        const firstCallCount = vi.mocked(fs.existsSync).mock.calls.length

        // 第二次加载 - 应使用缓存
        const result = await loadPageMarkdown(wikiPath, version, file)
        expect(result).toBe('# Cached Content')

        const secondCallCount = vi.mocked(fs.existsSync).mock.calls.length
        expect(secondCallCount).toBe(firstCallCount)
      })

      it('should cache stripped content (without blog tags)', async () => {
        const filePath = `${wikiPath}/versions/${version}/pages/${file}`
        mockFileContents.set(filePath, '<blog>Blog</blog>Content')

        await loadPageMarkdown(wikiPath, version, file)

        const cacheKey = `${wikiPath}:${version}:${file}`
        const cached = pageContentCache.get(cacheKey)
        // 缓存内容应已去除标签
        expect(cached!.includes('<blog>')).toBe(false)
        expect(cached).toBe('BlogContent')
      })
    })
  })

  describe('resolvePageFilePath', () => {
    const file = 'introduction.md'

    it('should return path when file exists in versions/{version}/pages/{file}', () => {
      const expectedPath = `${wikiPath}/versions/${version}/pages/${file}`
      mockFileContents.set(expectedPath, 'content')

      const result = resolvePageFilePath(wikiPath, version, file)

      expect(np(result!)).toBe(expectedPath)
    })

    it('should return path when file exists in versions/{version}/{file}', () => {
      const expectedPath = `${wikiPath}/versions/${version}/${file}`
      mockFileContents.set(expectedPath, 'content')

      const result = resolvePageFilePath(wikiPath, version, file)

      expect(np(result!)).toBe(expectedPath)
    })

    it('should return path when file exists in current/pages/{file}', () => {
      const expectedPath = `${wikiPath}/current/pages/${file}`
      mockFileContents.set(expectedPath, 'content')

      const result = resolvePageFilePath(wikiPath, version, file)

      expect(np(result!)).toBe(expectedPath)
    })

    it('should return path when file exists in current/{file}', () => {
      const expectedPath = `${wikiPath}/current/${file}`
      mockFileContents.set(expectedPath, 'content')

      const result = resolvePageFilePath(wikiPath, version, file)

      expect(np(result!)).toBe(expectedPath)
    })

    it('should return path when file exists in pages/{file}', () => {
      const expectedPath = `${wikiPath}/pages/${file}`
      mockFileContents.set(expectedPath, 'content')

      const result = resolvePageFilePath(wikiPath, version, file)

      expect(np(result!)).toBe(expectedPath)
    })

    it('should return null when file does not exist anywhere', () => {
      const result = resolvePageFilePath(wikiPath, version, 'nonexistent.md')

      expect(result).toBeNull()
    })

    it('should try paths in correct priority order', () => {
      // 设置文件存在的多个路径
      const versionedPagesPath = `${wikiPath}/versions/${version}/pages/${file}`
      const currentPagesPath = `${wikiPath}/current/pages/${file}`
      mockFileContents.set(versionedPagesPath, 'versioned content')
      mockFileContents.set(currentPagesPath, 'current content')

      const result = resolvePageFilePath(wikiPath, version, file)

      // 应返回第一个找到的路径（versions/{version}/pages/{file}）
      expect(np(result!)).toBe(versionedPagesPath)
    })
  })

  describe('savePageMarkdown', () => {
    const file = 'introduction.md'

    it('should write markdown content to file', () => {
      const filePath = `${wikiPath}/versions/${version}/pages/${file}`
      const content = '# Updated Content\n\nNew content here.'
      mockFileContents.set(filePath, 'old content')

      const mtime = savePageMarkdown(filePath, content)

      expect(fs.writeFileSync).toHaveBeenCalledWith(filePath, content, 'utf-8')
      expect(mtime).toBeDefined()
      expect(typeof mtime).toBe('number')
    })

    it('should return mtime timestamp after writing', () => {
      const filePath = `${wikiPath}/versions/${version}/pages/${file}`
      const content = 'Content'
      mockFileContents.set(filePath, 'old')
      const mockMtime = 1713384000000 // 用于测试的固定时间戳

      vi.mocked(fs.statSync).mockImplementation((path: string) => {
        return {
          mtimeMs: mockMtime,
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
        } as fs.Stats
      })

      const mtime = savePageMarkdown(filePath, content)

      expect(mtime).toBe(mockMtime)
    })

    it('should update file content in mock storage', () => {
      const filePath = `${wikiPath}/versions/${version}/pages/${file}`
      const newContent = '# New Content'
      mockFileContents.set(filePath, 'old content')

      savePageMarkdown(filePath, newContent)

      // 验证内容已更新
      expect(mockFileContents.get(filePath)).toBe(newContent)
    })

    it('should handle content with special characters', () => {
      const filePath = `${wikiPath}/versions/${version}/pages/${file}`
      const content = '# 中文标题\n\n特殊字符: <>&"\'\n代码块: ```js\nconsole.log("test")\n```'
      mockFileContents.set(filePath, 'old')

      const mtime = savePageMarkdown(filePath, content)

      expect(fs.writeFileSync).toHaveBeenCalledWith(filePath, content, 'utf-8')
      expect(mtime).toBeDefined()
    })
  })

  describe('getPageBySlug', () => {
    it('should find page by exact slug match', () => {
      const wikiData = createWikiData()

      const page = getPageBySlug(wikiData, 'introduction')

      expect(page).toBeDefined()
      expect(page!.slug).toBe('introduction')
      expect(page!.title).toBe('Introduction')
    })

    it('should find page by exact slug match for CLI', () => {
      const wikiData = createWikiData()

      const page = getPageBySlug(wikiData, 'CLI')

      expect(page).toBeDefined()
      expect(page!.slug).toBe('CLI')
      expect(page!.title).toBe('CLI Commands')
    })

    it('should return undefined when slug not found', () => {
      const wikiData = createWikiData()

      const page = getPageBySlug(wikiData, 'nonexistent')

      expect(page).toBeUndefined()
    })

    describe('大小写不敏感回退匹配', () => {
      it('should fallback to case-insensitive match when exact match fails', () => {
        const wikiData = createWikiData()
        // Wiki 包含 'CLI' 但搜索 'cli'

        const page = getPageBySlug(wikiData, 'cli')

        expect(page).toBeDefined()
        expect(page!.slug).toBe('CLI') // 返回 wiki 中的实际 slug
      })

      it('should fallback to case-insensitive match for INTRODUCTION', () => {
        const wikiData = createWikiData()
        // Wiki 包含 'introduction' 但搜索 'INTRODUCTION'

        const page = getPageBySlug(wikiData, 'INTRODUCTION')

        expect(page).toBeDefined()
        expect(page!.slug).toBe('introduction')
      })

      it('should prefer exact match over case-insensitive match', () => {
        // 创建同时包含 'test' 和 'TEST' slug 的 wiki
        const wikiData: WikiData = {
          id: 'case-test',
          generated_at: '2026-04-17T10:00:00Z',
          language: 'en',
          pages: [
            { slug: 'test', title: 'Test Lower', file: 'test.md', section: 'A', level: 'Beginner' },
            { slug: 'TEST', title: 'Test Upper', file: 'TEST.md', section: 'B', level: 'Beginner' },
          ],
        }

        const pageLower = getPageBySlug(wikiData, 'test')
        const pageUpper = getPageBySlug(wikiData, 'TEST')

        expect(pageLower!.slug).toBe('test')
        expect(pageUpper!.slug).toBe('TEST')
      })

      it('should still return undefined when case-insensitive match also fails', () => {
        const wikiData = createWikiData()

        const page = getPageBySlug(wikiData, 'NONEXISTENT')

        expect(page).toBeUndefined()
      })

      it('should handle mixed case search correctly', () => {
        const wikiData = createWikiData()

        const page = getPageBySlug(wikiData, 'IntroDUCTION')

        expect(page).toBeDefined()
        expect(page!.slug).toBe('introduction')
      })
    })

    it('should work with empty pages array', () => {
      const wikiData: WikiData = {
        id: 'empty',
        generated_at: '2026-04-17T10:00:00Z',
        language: 'en',
        pages: [],
      }

      const page = getPageBySlug(wikiData, 'any-slug')

      expect(page).toBeUndefined()
    })
  })

  describe('readCurrentPointer', () => {
    it('应正确解析 current 文件中的版本路径', () => {
      const currentPath = `${wikiPath}/current`
      mockFileContents.set(currentPath, 'versions/2026-04-16-220440')

      const result = readCurrentPointer(wikiPath)

      expect(result).toBe('2026-04-16-220440')
    })

    it('应正确解析不包含 versions/ 前缀的内容', () => {
      const currentPath = `${wikiPath}/current`
      mockFileContents.set(currentPath, '2026-04-15-120000')

      const result = readCurrentPointer(wikiPath)

      expect(result).toBe('2026-04-15-120000')
    })

    it('current 文件不存在时应返回 null', () => {
      const result = readCurrentPointer(wikiPath)

      expect(result).toBeNull()
    })

    it('current 文件内容为空时应返回 null', () => {
      const currentPath = `${wikiPath}/current`
      mockFileContents.set(currentPath, '')

      const result = readCurrentPointer(wikiPath)

      expect(result).toBeNull()
    })

    it('current 文件内容为纯空白时应返回 null', () => {
      const currentPath = `${wikiPath}/current`
      mockFileContents.set(currentPath, '   \n\t  ')

      const result = readCurrentPointer(wikiPath)

      expect(result).toBeNull()
    })

    it('readFileSync 抛出异常时应返回 null', () => {
      const currentPath = `${wikiPath}/current`
      mockFileContents.set(currentPath, 'versions/2026-04-16-220440')

      // 覆盖 readFileSync 使其在此特定测试中抛出异常
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Permission denied')
      })

      const result = readCurrentPointer(wikiPath)

      expect(result).toBeNull()
    })
  })

  describe('listVersions', () => {
    it('应正确列出所有版本并标记 current', () => {
      const versionsDir = `${wikiPath}/versions`
      const currentPath = `${wikiPath}/current`

      // Setup current pointer
      mockFileContents.set(currentPath, 'versions/2026-04-16-220440')

      // Setup version directories
      mockDirectories.add(`${versionsDir}/2026-04-16-220440`)
      mockDirectories.add(`${versionsDir}/2026-04-15-120000`)

      // Setup wiki.json for each version
      mockFileContents.set(
        `${versionsDir}/2026-04-16-220440/wiki.json`,
        JSON.stringify({ generated_at: '2026-04-16T22:04:40Z', pages: [{ slug: 'a' }, { slug: 'b' }] }),
      )
      mockFileContents.set(
        `${versionsDir}/2026-04-15-120000/wiki.json`,
        JSON.stringify({ generated_at: '2026-04-15T12:00:00Z', pages: [{ slug: 'a' }] }),
      )

      const result = listVersions(wikiPath)

      expect(result).toHaveLength(2)
      // Should be sorted in reverse (newest first)
      expect(result[0].version).toBe('2026-04-16-220440')
      expect(result[0].isCurrent).toBe(true)
      expect(result[0].pageCount).toBe(2)
      expect(result[0].generatedAt).toBe('2026-04-16T22:04:40Z')
      expect(result[1].version).toBe('2026-04-15-120000')
      expect(result[1].isCurrent).toBe(false)
      expect(result[1].pageCount).toBe(1)
    })

    it('无 versions 目录时应返回空数组', () => {
      const result = listVersions(wikiPath)

      expect(result).toEqual([])
    })

    it('应按时间戳降序排列（最新在前）', () => {
      const versionsDir = `${wikiPath}/versions`

      // Add multiple version directories in non-sorted order
      mockDirectories.add(`${versionsDir}/2026-04-10-100000`)
      mockDirectories.add(`${versionsDir}/2026-04-16-220440`)
      mockDirectories.add(`${versionsDir}/2026-04-12-150000`)

      // No wiki.json needed - default values
      const result = listVersions(wikiPath)

      expect(result).toHaveLength(3)
      expect(result[0].version).toBe('2026-04-16-220440')
      expect(result[1].version).toBe('2026-04-12-150000')
      expect(result[2].version).toBe('2026-04-10-100000')
    })

    it('版本目录中 wiki.json 不存在时 pageCount 应为 0', () => {
      const versionsDir = `${wikiPath}/versions`
      mockDirectories.add(`${versionsDir}/2026-04-16-220440`)
      // No wiki.json set for this version

      const result = listVersions(wikiPath)

      expect(result).toHaveLength(1)
      expect(result[0].pageCount).toBe(0)
      expect(result[0].generatedAt).toBe('')
    })

    it('wiki.json 解析失败时应使用默认值', () => {
      const versionsDir = `${wikiPath}/versions`
      mockDirectories.add(`${versionsDir}/2026-04-16-220440`)
      mockFileContents.set(`${versionsDir}/2026-04-16-220440/wiki.json`, 'invalid json')

      const result = listVersions(wikiPath)

      expect(result).toHaveLength(1)
      expect(result[0].pageCount).toBe(0)
      expect(result[0].generatedAt).toBe('')
    })

    it('只有一个版本时也应正确返回', () => {
      const versionsDir = `${wikiPath}/versions`
      const currentPath = `${wikiPath}/current`

      mockFileContents.set(currentPath, 'versions/2026-04-16-220440')
      mockDirectories.add(`${versionsDir}/2026-04-16-220440`)
      mockFileContents.set(
        `${versionsDir}/2026-04-16-220440/wiki.json`,
        JSON.stringify({ generated_at: '2026-04-16T22:04:40Z', pages: [{ slug: 'intro' }, { slug: 'guide' }, { slug: 'api' }] }),
      )

      const result = listVersions(wikiPath)

      expect(result).toHaveLength(1)
      expect(result[0].version).toBe('2026-04-16-220440')
      expect(result[0].isCurrent).toBe(true)
      expect(result[0].pageCount).toBe(3)
    })

    it('没有 current 文件时所有版本 isCurrent 应为 false', () => {
      const versionsDir = `${wikiPath}/versions`
      // No current file set

      mockDirectories.add(`${versionsDir}/2026-04-16-220440`)
      mockDirectories.add(`${versionsDir}/2026-04-15-120000`)

      const result = listVersions(wikiPath)

      expect(result).toHaveLength(2)
      expect(result[0].isCurrent).toBe(false)
      expect(result[1].isCurrent).toBe(false)
    })
  })
})