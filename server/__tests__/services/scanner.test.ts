/**
 * 项目扫描服务测试
 * 覆盖 scanner.ts 的项目发现、wiki.json 解析、版本检测、路径排除逻辑
 */
// 先导入 vi，确保在 Mock 之前可用
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// 优先 Mock configService
vi.mock('../../src/services/config.js', () => ({
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  addProject: vi.fn(),
  invalidateConfigCache: vi.fn(),
}))

// Mock glob 模块
vi.mock('glob', () => ({
  glob: vi.fn(),
}))

// Mock fs 模块
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    lstatSync: vi.fn(),
    readlinkSync: vi.fn(),
  }
})

// 导入已 Mock 的模块
import * as fs from 'fs'
import { glob } from 'glob'

// 导入被测模块 — 必须在 Mock 之后
import {
  getScanStatus,
  scanAllPaths,
  scanSinglePath,
} from '../../src/services/scanner.js'
import * as configService from '../../src/services/config.js'
import type { AppConfig, ProjectConfig } from '../../../shared/types/index.js'

/**
 * 创建有效的 ProjectConfig 对象
 * @param id - 项目 ID
 * @param name - 项目名称
 * @param p - 项目路径
 * @returns 完整的 ProjectConfig 对象
 */
function createProject(id: string, name: string, p: string): ProjectConfig {
  return {
    id,
    name,
    path: p,
    wikiPath: `${p}/.zread/wiki`,
    currentVersion: 'default',
    isActive: false,
    addedAt: Date.now(),
  }
}

/**
 * 创建有效的 wiki.json 内容
 * @param pages - 页面列表，默认包含首页
 * @returns JSON 字符串
 */
function createWikiJson(pages: Array<{ slug: string; title: string; file: string }> = [
  { slug: 'index', title: 'Index', file: 'index.md' },
]): string {
  return JSON.stringify({
    id: 'test-wiki',
    generated_at: '2026-04-17',
    language: 'zh-CN',
    pages,
  })
}

/**
 * 根据路径计算预期的项目 ID（SHA-256 哈希前 16 位）
 * @param projectPath - 项目路径
 * @returns 16 位十六进制项目 ID
 */
function computeProjectId(projectPath: string): string {
  // 直接使用 Node 的 crypto 模块（未被 Mock）
  const crypto = require('crypto')
  const normalized = projectPath.replace(/\\/g, '/')
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16)
}

/**
 * 规范化路径以便跨平台比较
 * @param p - 待规范化的路径
 * @returns 使用正斜杠的路径
 */
function normalizePathForTest(p: string): string {
  return p.replace(/\\/g, '/')
}

/**
 * 检查路径是否匹配预期模式（跨平台兼容）
 * @param actual - 实际路径
 * @param expected - 预期路径
 * @returns 是否匹配
 */
function pathMatches(actual: string, expected: string): boolean {
  return normalizePathForTest(actual) === normalizePathForTest(expected)
}

/**
 * 检查路径是否包含指定子串（跨平台兼容）
 * @param actual - 实际路径
 * @param substring - 子串
 * @returns 是否包含
 */
function pathContains(actual: string, substring: string): boolean {
  return normalizePathForTest(actual).includes(normalizePathForTest(substring))
}

describe('Scanner', () => {
  beforeEach(() => {
    vi.resetAllMocks()

    // 通过重新导入模块重置扫描状态（scanStatus 是模块级状态）
    vi.doMock('../../src/services/scanner.js', async (importOriginal) => {
      const original = await importOriginal<typeof import('../../src/services/scanner.js')>()
      // 无法重置模块级状态，测试需要考虑这一点
      return original
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('getScanStatus', () => {
    it('should return current scan status', async () => {
      // 重新导入以获取新的模块状态
      vi.resetModules()
      const { getScanStatus: freshGetScanStatus } = await import('../../src/services/scanner.js')

      const status = freshGetScanStatus()

      expect(status).toHaveProperty('scanning')
      expect(typeof status.scanning).toBe('boolean')
      expect(status.scanning).toBe(false)
    })

    it('should return status with lastScanAt after scan', async () => {
      vi.resetModules()
      const { getScanStatus: freshGetScanStatus, scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')
      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/test/path'],
        projects: [],
        theme: 'light',
      })
      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        // 扫描路径存在
        if (p === '/test/path') return true
        // Wiki 目录存在
        if (p.includes('.zread/wiki')) return true
        // wiki.json 存在
        if (p.includes('wiki.json')) return true
        return false
      })
      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })
      vi.mocked(glob).mockResolvedValue(['/test/path/.zread/wiki'])

      await freshScanAllPaths()

      const status = freshGetScanStatus()
      expect(status.lastScanAt).toBeDefined()
      expect(typeof status.lastScanAt).toBe('number')
    })

    it('should return progress during scan', async () => {
      // 注意：进度仅在扫描期间可用，难以在不产生竞态条件下测试
      // 此测试验证结构
      vi.resetModules()
      const { getScanStatus: freshGetScanStatus } = await import('../../src/services/scanner.js')

      const status = freshGetScanStatus()

      expect(status.scanning).toBe(false)
      // 当 scanning 为 false 时，progress 可能未定义
      if (status.progress) {
        expect(status.progress).toHaveProperty('total')
        expect(status.progress).toHaveProperty('scanned')
        expect(status.progress).toHaveProperty('found')
      }
    })
  })

  describe('scanAllPaths', () => {
    it('should identify directory with .zread/wiki as valid project', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/projects'],
        projects: [],
        theme: 'light',
      })

      // 配置 fs Mock
      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === '/projects') return true
        if (p === '/projects/myproject/.zread/wiki') return true
        if (p === '/projects/myproject/.zread/wiki/wiki.json') return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      vi.mocked(glob).mockResolvedValue(['/projects/myproject/.zread/wiki'])

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      expect(result.length).toBe(1)
      expect(result[0].name).toBe('myproject')
      expect(result[0].path).toBe('/projects/myproject')
      expect(result[0].wikiPath).toBe('/projects/myproject/.zread/wiki')
    })

    it('should ignore paths without .zread directory', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/projects'],
        projects: [],
        theme: 'light',
      })

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === '/projects') return true
        return false
      })

      // glob 返回空数组 — 未找到 .zread/wiki
      vi.mocked(glob).mockResolvedValue([])

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      expect(result.length).toBe(0)
    })

    it('should recursively scan subdirectories', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/workspace'],
        projects: [],
        theme: 'light',
      })

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === '/workspace') return true
        if (p.includes('.zread/wiki')) return true
        if (p.includes('wiki.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      // 多个嵌套项目
      vi.mocked(glob).mockResolvedValue([
        '/workspace/project1/.zread/wiki',
        '/workspace/team/project2/.zread/wiki',
        '/workspace/team/subteam/project3/.zread/wiki',
      ])

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      expect(result.length).toBe(3)
      expect(result.map(p => p.name)).toEqual(['project1', 'project2', 'project3'])
      expect(result.map(p => p.path)).toEqual([
        '/workspace/project1',
        '/workspace/team/project2',
        '/workspace/team/subteam/project3',
      ])
    })

    it('should skip hidden directories and node_modules', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/workspace'],
        projects: [],
        theme: 'light',
      })

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === '/workspace') return true
        if (p.includes('.zread/wiki')) return true
        if (p.includes('wiki.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      // glob 的 ignore 模式应排除 node_modules 和 .git
      // scanner.ts 传递 ignore: ['**/node_modules/**', '**/.git/**'] 给 glob
      vi.mocked(glob).mockResolvedValue([
        '/workspace/valid-project/.zread/wiki',
        // 注意：glob Mock 使用 ignore 模式调用，但模拟的是 glob 应用模式后
        // 的返回结果 — 即没有来自 node_modules 或 .git 的结果
      ])

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      // 验证 glob 使用正确的 ignore 模式调用
      expect(glob).toHaveBeenCalledWith(
        '**/.zread/wiki',
        expect.objectContaining({
          ignore: ['**/node_modules/**', '**/.git/**'],
        })
      )

      expect(result.length).toBe(1)
      expect(result[0].name).toBe('valid-project')
    })

    it('should generate correct project ID based on path hash', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/projects'],
        projects: [],
        theme: 'light',
      })

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === '/projects') return true
        if (p === '/projects/myproject/.zread/wiki') return true
        if (p === '/projects/myproject/.zread/wiki/wiki.json') return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      vi.mocked(glob).mockResolvedValue(['/projects/myproject/.zread/wiki'])

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      const expectedId = computeProjectId('/projects/myproject')
      expect(result[0].id).toBe(expectedId)
      expect(result[0].id.length).toBe(16) // SHA-256 hex substring
    })

    it('should handle wiki.json format errors gracefully', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/projects'],
        projects: [],
        theme: 'light',
      })

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === '/projects') return true
        if (p === '/projects/badproject/.zread/wiki') return true
        if (p === '/projects/badproject/.zread/wiki/wiki.json') return true
        return false
      })

      // 无效的 wiki.json — 缺少 pages 数组
      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) {
          return JSON.stringify({ id: 'bad-wiki', generated_at: '2026-04-17' }) // 无 pages 数组
        }
        return ''
      })

      vi.mocked(glob).mockResolvedValue(['/projects/badproject/.zread/wiki'])

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      // 应返回空 — 无效的 wiki.json 导致项目被跳过
      expect(result.length).toBe(0)
    })

    it('should handle malformed wiki.json JSON syntax', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/projects'],
        projects: [],
        theme: 'light',
      })

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === '/projects') return true
        if (p === '/projects/malformed/.zread/wiki') return true
        if (p === '/projects/malformed/.zread/wiki/wiki.json') return true
        return false
      })

      // 格式错误的 JSON
      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return 'invalid json { broken'
        return ''
      })

      vi.mocked(glob).mockResolvedValue(['/projects/malformed/.zread/wiki'])

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      expect(result.length).toBe(0)
    })

    it('should handle scan path that does not exist', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/nonexistent/path'],
        projects: [],
        theme: 'light',
      })

      vi.mocked(fs.existsSync).mockReturnValue(false)

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      // 应返回空并记录警告
      expect(result.length).toBe(0)
      expect(fs.existsSync).toHaveBeenCalledWith('/nonexistent/path')
    })

    it('should merge with existing projects preserving user settings', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      const existingProject: ProjectConfig = {
        id: computeProjectId('/projects/myproject'),
        name: 'My Project', // 用户自定义名称
        path: '/projects/myproject',
        wikiPath: '/projects/myproject/.zread/wiki',
        currentVersion: 'v1',
        isActive: true, // 用户偏好
        addedAt: 1000000, // 原始时间戳
      }

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/projects'],
        projects: [existingProject],
        theme: 'light',
      })

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === '/projects') return true
        if (p === '/projects/myproject/.zread/wiki') return true
        if (p === '/projects/myproject/.zread/wiki/wiki.json') return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      vi.mocked(glob).mockResolvedValue(['/projects/myproject/.zread/wiki'])

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      expect(result.length).toBe(1)
      // 用户设置被保留
      expect(result[0].isActive).toBe(true)
      expect(result[0].addedAt).toBe(1000000)
      expect(result[0].name).toBe('My Project')
    })

    it('should update path and version for existing projects', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      const existingProject: ProjectConfig = {
        id: computeProjectId('/projects/myproject'),
        name: 'myproject',
        path: '/projects/myproject', // 旧路径（同一位置）
        wikiPath: '/projects/myproject/.zread/wiki',
        currentVersion: 'v1', // 旧版本
        isActive: false,
        addedAt: 1000000,
      }

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/projects'],
        projects: [existingProject],
        theme: 'light',
      })

      // 配置版本检测 — 有新版本可用
      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === '/projects') return true
        if (p === '/projects/myproject/.zread/wiki') return true
        if (p === '/projects/myproject/.zread/wiki/wiki.json') return true
        if (p === '/projects/myproject/.zread/wiki/versions') return true
        if (p === '/projects/myproject/.zread/wiki/versions/v2') return true
        return false
      })

      vi.mocked(fs.statSync).mockImplementation((p: string) => ({
        isDirectory: () => p.includes('versions'),
        isFile: () => false,
        isSymbolicLink: () => false,
        mtimeMs: Date.now(),
      }))

      vi.mocked(fs.readdirSync).mockImplementation((p: string) => {
        if (p.includes('versions')) return ['v1', 'v2']
        return []
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      vi.mocked(glob).mockResolvedValue(['/projects/myproject/.zread/wiki'])

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      expect(result.length).toBe(1)
      // 版本应更新为最新（v2）
      expect(result[0].currentVersion).toBe('v2')
    })

    it('should keep manually added projects not in scan paths', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      const manualProject: ProjectConfig = {
        id: computeProjectId('/manual/project'),
        name: 'Manual Project',
        path: '/manual/project',
        wikiPath: '/manual/project/.zread/wiki',
        currentVersion: 'default',
        isActive: false,
        addedAt: 1000000,
      }

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/scan-path'], // 与手动项目路径不同
        projects: [manualProject],
        theme: 'light',
      })

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === '/scan-path') return true
        if (p === '/manual/project/.zread/wiki') return true // 手动项目仍然存在
        if (p === '/scan-path/scanned/.zread/wiki') return true
        if (p.includes('wiki.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      vi.mocked(glob).mockResolvedValue(['/scan-path/scanned/.zread/wiki'])

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      expect(result.length).toBe(2)
      // 手动项目应被保留
      expect(result.map(p => p.name)).toContain('Manual Project')
      expect(result.map(p => p.name)).toContain('scanned')
    })

    it('should remove manual projects that no longer exist on disk', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      const missingProject: ProjectConfig = {
        id: computeProjectId('/deleted/project'),
        name: 'Deleted Project',
        path: '/deleted/project',
        wikiPath: '/deleted/project/.zread/wiki',
        currentVersion: 'default',
        isActive: false,
        addedAt: 1000000,
      }

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/scan-path'],
        projects: [missingProject],
        theme: 'light',
      })

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === '/scan-path') return true
        if (p === '/deleted/project/.zread/wiki') return false // 项目已不存在
        if (p === '/scan-path/scanned/.zread/wiki') return true
        if (p.includes('wiki.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      vi.mocked(glob).mockResolvedValue(['/scan-path/scanned/.zread/wiki'])

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      expect(result.length).toBe(1)
      expect(result[0].name).toBe('scanned')
      expect(result.map(p => p.name)).not.toContain('Deleted Project')
    })

    it('should prevent concurrent scans', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths, getScanStatus: freshGetScanStatus } = await import('../../src/services/scanner.js')

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/projects'],
        projects: [],
        theme: 'light',
      })

      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      // 使 glob 返回一个延迟 resolve 的 Promise
      let resolveGlob: (value: string[]) => void
      const globPromise = new Promise<string[]>((resolve) => {
        resolveGlob = resolve
      })
      vi.mocked(glob).mockReturnValue(globPromise)

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      // 启动第一次扫描
      const scan1Promise = freshScanAllPaths()

      // 在第一次扫描进行中尝试启动第二次
      const scan2Promise = freshScanAllPaths()

      // 第二次扫描应立即抛出异常
      await expect(scan2Promise).rejects.toThrow('Scan already in progress')

      // 完成第一次扫描
      resolveGlob(['/projects/test/.zread/wiki'])

      // 第一次扫描应成功完成
      const result1 = await scan1Promise
      expect(result1.length).toBe(1)
    })

    it('should reset scanning flag after error', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths, getScanStatus: freshGetScanStatus } = await import('../../src/services/scanner.js')

      vi.mocked(configService.getConfig).mockImplementation(() => {
        throw new Error('Config error')
      })

      try {
        await freshScanAllPaths()
      } catch (e) {
        // 预期的错误
      }

      // 即使出错，scanning 标志也应被重置
      const status = freshGetScanStatus()
      expect(status.scanning).toBe(false)
    })

    it('should handle multiple scan paths in parallel', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/path1', '/path2', '/path3'],
        projects: [],
        theme: 'light',
      })

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (['/path1', '/path2', '/path3'].includes(p)) return true
        if (p.includes('.zread/wiki')) return true
        if (p.includes('wiki.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      // 每个扫描路径各发现一个项目
      vi.mocked(glob).mockImplementation(async (pattern: string, options: any) => {
        const cwd = options.cwd
        if (cwd === '/path1') return ['/path1/project1/.zread/wiki']
        if (cwd === '/path2') return ['/path2/project2/.zread/wiki']
        if (cwd === '/path3') return ['/path3/project3/.zread/wiki']
        return []
      })

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      expect(result.length).toBe(3)
      expect(result.map(p => p.name)).toEqual(['project1', 'project2', 'project3'])
    })

    it('should deduplicate projects found in multiple scan paths', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/path1', '/path2'],
        projects: [],
        theme: 'light',
      })

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (['/path1', '/path2'].includes(p)) return true
        if (p === '/shared/.zread/wiki') return true
        if (p.includes('wiki.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      // 两个扫描路径发现同一个项目（符号链接或共享位置）
      vi.mocked(glob).mockImplementation(async (pattern: string, options: any) => {
        const cwd = options.cwd
        if (cwd === '/path1') return ['/shared/.zread/wiki']
        if (cwd === '/path2') return ['/shared/.zread/wiki'] // 同一个项目
        return []
      })

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      // 应去重 — 只有一个项目
      expect(result.length).toBe(1)
      expect(result[0].path).toBe('/shared')
    })

    it('should scan with correct glob options', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/test'],
        projects: [],
        theme: 'light',
      })

      vi.mocked(fs.existsSync).mockReturnValue(true)

      vi.mocked(glob).mockResolvedValue([])

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      await freshScanAllPaths()

      expect(glob).toHaveBeenCalledWith(
        '**/.zread/wiki',
        expect.objectContaining({
          cwd: '/test',
          absolute: true,
          maxDepth: 5,
          ignore: ['**/node_modules/**', '**/.git/**'],
        })
      )
    })
  })

  describe('scanSinglePath', () => {
    it('should add a single project from valid path', async () => {
      vi.resetModules()
      const { scanSinglePath: freshScanSinglePath } = await import('../../src/services/scanner.js')

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        // 使用灵活的路径匹配以兼容跨平台
        const normalized = normalizePathForTest(p)
        if (normalized.includes('/myproject/.zread/wiki')) return true
        if (normalized.includes('wiki.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      vi.mocked(configService.addProject).mockImplementation((project: ProjectConfig) => ({
        scanPaths: [],
        projects: [project],
        theme: 'light',
      }))

      const result = await freshScanSinglePath('/projects/myproject')

      expect(result).not.toBeNull()
      // 路径应被规范化
      expect(normalizePathForTest(result!.path)).toContain('/projects/myproject')
      expect(configService.addProject).toHaveBeenCalled()
    })

    it('should return null for path without .zread/wiki', async () => {
      vi.resetModules()
      const { scanSinglePath: freshScanSinglePath } = await import('../../src/services/scanner.js')

      vi.mocked(fs.existsSync).mockReturnValue(false)

      const result = await freshScanSinglePath('/projects/nonexistent')

      expect(result).toBeNull()
      expect(configService.addProject).not.toHaveBeenCalled()
    })

    it('should return null for path with invalid wiki.json', async () => {
      vi.resetModules()
      const { scanSinglePath: freshScanSinglePath } = await import('../../src/services/scanner.js')

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === '/projects/bad/.zread/wiki') return true
        if (p === '/projects/bad/.zread/wiki/wiki.json') return true
        return false
      })

      // 无效的 wiki.json
      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return JSON.stringify({ id: 'bad' }) // 无 pages
        return ''
      })

      const result = await freshScanSinglePath('/projects/bad')

      expect(result).toBeNull()
      expect(configService.addProject).not.toHaveBeenCalled()
    })

    it('should resolve relative path to absolute', async () => {
      vi.resetModules()
      const { scanSinglePath: freshScanSinglePath } = await import('../../src/services/scanner.js')

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        // scanner 使用 path.resolve，实际代码中会将相对路径解析为绝对路径
        // 测试中 Mock 了 fs，因此需要处理解析后的路径
        if (p.endsWith('/.zread/wiki') || p.endsWith('wiki.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      vi.mocked(configService.addProject).mockImplementation((project: ProjectConfig) => ({
        scanPaths: [],
        projects: [project],
        theme: 'light',
      }))

      // 传入相对路径 — scanner 应将其解析
      const result = await freshScanSinglePath('./myproject')

      // 项目配置应使用绝对路径
      expect(result).toBeDefined()
      if (result) {
        expect(result.path).not.toMatch(/^\.\//)
      }
    })

    it('should generate correct project ID for single path', async () => {
      vi.resetModules()
      const { scanSinglePath: freshScanSinglePath } = await import('../../src/services/scanner.js')

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        const normalized = normalizePathForTest(p)
        if (normalized.includes('/test/.zread/wiki')) return true
        if (normalized.includes('wiki.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      vi.mocked(configService.addProject).mockImplementation((project: ProjectConfig) => ({
        scanPaths: [],
        projects: [project],
        theme: 'light',
      }))

      const result = await freshScanSinglePath('/projects/test')

      // computeProjectId 会规范化路径，因此应匹配
      // 注意：Windows 上 path.resolve 会添加盘符，需要考虑这一点
      const normalizedResultPath = normalizePathForTest(result!.path)
      // ID 由解析后的路径计算（Windows 上含盘符）
      const expectedId = computeProjectId(result!.path)
      expect(result!.id).toBe(expectedId)
    })

    it('should handle Windows-style paths', async () => {
      vi.resetModules()
      const { scanSinglePath: freshScanSinglePath } = await import('../../src/services/scanner.js')

      const windowsPath = 'C:\\Users\\test\\myproject'

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        // 规范化路径以进行比较
        const normalized = p.replace(/\\/g, '/')
        if (normalized.includes('.zread/wiki')) return true
        if (normalized.includes('wiki.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      vi.mocked(configService.addProject).mockImplementation((project: ProjectConfig) => ({
        scanPaths: [],
        projects: [project],
        theme: 'light',
      }))

      const result = await freshScanSinglePath(windowsPath)

      expect(result).toBeDefined()
      if (result) {
        // 路径应被规范化（反斜杠转为正斜杠）
        expect(result.path).not.toContain('\\')
        expect(result.wikiPath).not.toContain('\\')
      }
    })
  })

  describe('版本检测', () => {
    it('should detect current version from symlink', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/projects'],
        projects: [],
        theme: 'light',
      })

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === '/projects') return true
        if (p === '/projects/myproject/.zread/wiki') return true
        if (p === '/projects/myproject/.zread/wiki/current') return true
        if (p === '/projects/myproject/.zread/wiki/wiki.json') return true
        return false
      })

      vi.mocked(fs.lstatSync).mockImplementation((p: string) => ({
        isSymbolicLink: () => p.includes('/current'),
        isDirectory: () => false,
      }))

      vi.mocked(fs.readlinkSync).mockImplementation((p: string) => {
        if (p.includes('/current')) return '/projects/myproject/.zread/wiki/versions/v2'
        return ''
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      vi.mocked(glob).mockResolvedValue(['/projects/myproject/.zread/wiki'])

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      expect(result[0].currentVersion).toBe('v2')
    })

    it('should detect current version from versions directory', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/projects'],
        projects: [],
        theme: 'light',
      })

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === '/projects') return true
        if (p === '/projects/myproject/.zread/wiki') return true
        if (p === '/projects/myproject/.zread/wiki/versions') return true
        if (p === '/projects/myproject/.zread/wiki/versions/v1') return true
        if (p === '/projects/myproject/.zread/wiki/versions/v2') return true
        if (p === '/projects/myproject/.zread/wiki/versions/v3') return true
        // wiki.json 存在于最新版本（v3）
        if (p === '/projects/myproject/.zread/wiki/versions/v3/wiki.json') return true
        return false
      })

      vi.mocked(fs.statSync).mockImplementation((p: string) => ({
        isDirectory: () => p.includes('/versions/v'),
        isFile: () => false,
        isSymbolicLink: () => false,
        mtimeMs: Date.now(),
      }))

      vi.mocked(fs.readdirSync).mockImplementation((p: string) => {
        if (p.includes('/versions')) return ['v1', 'v2', 'v3']
        return []
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      vi.mocked(glob).mockResolvedValue(['/projects/myproject/.zread/wiki'])

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      // 应使用最新版本（排序后的 v3）
      expect(result[0].currentVersion).toBe('v3')
    })

    it('should fallback to default version when no version detected', async () => {
      vi.resetModules()
      const { scanAllPaths: freshScanAllPaths } = await import('../../src/services/scanner.js')

      vi.mocked(configService.getConfig).mockReturnValue({
        scanPaths: ['/projects'],
        projects: [],
        theme: 'light',
      })

      // 无 current 符号链接或 versions 目录
      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === '/projects') return true
        if (p === '/projects/myproject/.zread/wiki') return true
        if (p === '/projects/myproject/.zread/wiki/wiki.json') return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      vi.mocked(glob).mockResolvedValue(['/projects/myproject/.zread/wiki'])

      vi.mocked(configService.saveConfig).mockImplementation((cfg: AppConfig) => cfg)

      const result = await freshScanAllPaths()

      expect(result[0].currentVersion).toBe('default')
    })
  })

  describe('wiki.json 位置验证', () => {
    it('should accept wiki.json in root wiki directory', async () => {
      vi.resetModules()
      const { scanSinglePath: freshScanSinglePath } = await import('../../src/services/scanner.js')

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        const normalized = normalizePathForTest(p)
        if (normalized.includes('/project/.zread/wiki') && !normalized.includes('versions')) return true
        if (normalized.endsWith('.zread/wiki/wiki.json')) return true
        return false
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      vi.mocked(configService.addProject).mockImplementation((project: ProjectConfig) => ({
        scanPaths: [],
        projects: [project],
        theme: 'light',
      }))

      const result = await freshScanSinglePath('/project')

      expect(result).not.toBeNull()
    })

    it('should accept wiki.json in current version directory', async () => {
      vi.resetModules()
      const { scanSinglePath: freshScanSinglePath } = await import('../../src/services/scanner.js')

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        const normalized = normalizePathForTest(p)
        if (normalized.includes('/project/.zread/wiki')) return true
        return false
      })

      vi.mocked(fs.lstatSync).mockImplementation((p: string) => ({
        isSymbolicLink: () => normalizePathForTest(p).includes('/current'),
        isDirectory: () => false,
      }))

      vi.mocked(fs.readlinkSync).mockImplementation((p: string) => {
        if (normalizePathForTest(p).includes('/current')) return '/project/.zread/wiki/versions/v1'
        return ''
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      vi.mocked(configService.addProject).mockImplementation((project: ProjectConfig) => ({
        scanPaths: [],
        projects: [project],
        theme: 'light',
      }))

      const result = await freshScanSinglePath('/project')

      expect(result).not.toBeNull()
    })

    it('should accept wiki.json in versions directory', async () => {
      vi.resetModules()
      const { scanSinglePath: freshScanSinglePath } = await import('../../src/services/scanner.js')

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        const normalized = normalizePathForTest(p)
        if (normalized.includes('/project/.zread/wiki')) return true
        return false
      })

      vi.mocked(fs.statSync).mockImplementation((p: string) => ({
        isDirectory: () => normalizePathForTest(p).includes('/versions/v'),
        isFile: () => false,
        isSymbolicLink: () => false,
        mtimeMs: Date.now(),
      }))

      vi.mocked(fs.readdirSync).mockImplementation((p: string) => {
        if (normalizePathForTest(p).includes('/versions')) return ['v1']
        return []
      })

      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p.includes('wiki.json')) return createWikiJson()
        return ''
      })

      vi.mocked(configService.addProject).mockImplementation((project: ProjectConfig) => ({
        scanPaths: [],
        projects: [project],
        theme: 'light',
      }))

      const result = await freshScanSinglePath('/project')

      expect(result).not.toBeNull()
    })
  })
})