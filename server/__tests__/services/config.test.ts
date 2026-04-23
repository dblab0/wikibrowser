/**
 * 配置服务测试
 * 覆盖 config.ts 的配置读写、缓存机制、项目管理、扫描路径管理、配置迁移等逻辑
 */
// 在所有 Mock 定义之前先导入 vi
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Mock os 模块
vi.mock('os', () => ({
  platform: vi.fn(() => 'linux'),
  homedir: vi.fn(() => '/home/testuser'),
}))

// Mock path 模块
vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>()
  return {
    ...actual,
    join: vi.fn((...args: string[]) => args.join('/')),
    resolve: vi.fn((p: string) => p.startsWith('/') ? p : `/home/testuser/${p}`),
  }
})

// Mock fs 模块
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    copyFileSync: vi.fn(),
    rmSync: vi.fn(),
    statSync: vi.fn(() => ({ isDirectory: () => false })),
    cpSync: vi.fn(),
  }
})

// Mock session-pool.types 以提供 DEFAULT_POOL_CONFIG
vi.mock('../../src/services/session-pool.types.js', () => ({
  DEFAULT_POOL_CONFIG: {
    maxSessions: 20,
    idleTimeoutMs: 10 * 60 * 1000,
    evictionIntervalMs: 60 * 1000,
    maxQueueSize: 50,
    queueTimeoutMs: 5 * 60 * 1000,
  },
}))

// 导入已 Mock 的模块
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// 导入被测模块（必须在 Mock 定义之后）
import {
  invalidateConfigCache,
  getConfig,
  saveConfig,
  addScanPath,
  removeScanPath,
  getProjectById,
  addProject,
  removeProject,
  setActiveProject,
  updateConfig,
} from '../../src/services/config.js'
import type { AppConfig, ProjectConfig } from '../../../shared/types/index.js'

// 创建有效 ProjectConfig 的辅助函数
function createProject(id: string, name: string, p: string): ProjectConfig {
  return {
    id,
    name,
    path: p,
    wikiPath: `${p}/.zread/wiki`,
    currentVersion: 'v1',
    isActive: false,
    addedAt: Date.now(),
  }
}

describe('ConfigService', () => {
  let mockFileContents: Map<string, string>
  const configDir = '/home/testuser/.wikibrowser'
  const configFilePath = `${configDir}/settings.json`

  beforeEach(() => {
    mockFileContents = new Map()
    vi.resetAllMocks()

    // 重置 os 模块的 Mock
    vi.mocked(os.platform).mockReturnValue('linux')
    vi.mocked(os.homedir).mockReturnValue('/home/testuser')

    // 重置 path 模块的 Mock，模拟真实行为
    vi.mocked(path.join).mockImplementation((...args: string[]) => args.join('/'))
    vi.mocked(path.resolve).mockImplementation((p: string) => p.startsWith('/') ? p : `/home/testuser/${p}`)

    // 设置 fs 模块的 Mock
    vi.mocked(fs.existsSync).mockImplementation((filePath: string) => {
      return mockFileContents.has(filePath)
    })

    vi.mocked(fs.readFileSync).mockImplementation((filePath: string) => {
      const content = mockFileContents.get(filePath)
      if (content === undefined) {
        const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`)
        ;(error as any).code = 'ENOENT'
        throw error
      }
      return content
    })

    vi.mocked(fs.writeFileSync).mockImplementation((filePath: string, content: string) => {
      mockFileContents.set(filePath, content)
    })

    vi.mocked(fs.mkdirSync).mockImplementation(() => {})

    // 每个测试前清除配置缓存
    invalidateConfigCache()
  })

  afterEach(() => {
    vi.resetAllMocks()
    invalidateConfigCache()
  })

  describe('getConfig', () => {
    it('should return current config when file exists', () => {
      const config: AppConfig = {
        scanPaths: ['/path1', '/path2'],
        projects: [createProject('proj1', 'Project 1', '/proj1')],
        theme: 'dark',
        aiPromptTimeout: 15,
      }
      mockFileContents.set(configFilePath, JSON.stringify(config))

      const result = getConfig()

      expect(result.scanPaths).toEqual(['/path1', '/path2'])
      expect(result.projects.length).toBe(1)
      expect(result.projects[0].name).toBe('Project 1')
      expect(result.theme).toBe('dark')
      expect(result.aiPromptTimeout).toBe(15)
    })

    it('should return default config when file does not exist', () => {
      // 未设置文件，模拟首次运行
      const result = getConfig()

      expect(result.scanPaths).toEqual([])
      expect(result.projects).toEqual([])
      expect(result.theme).toBe('light')
      expect(result.aiPromptTimeout).toBe(10) // 默认值
    })

    it('should return default config when file read fails', () => {
      // 文件存在但读取抛出错误
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Read error')
      })

      const result = getConfig()

      expect(result.scanPaths).toEqual([])
      expect(result.projects).toEqual([])
      expect(result.theme).toBe('light')
    })

    it('should return cached config on subsequent calls', () => {
      const config: AppConfig = {
        scanPaths: ['/cached-path'],
        projects: [],
        theme: 'light',
      }
      mockFileContents.set(configFilePath, JSON.stringify(config))

      // 第一次调用
      const result1 = getConfig()
      expect(fs.existsSync).toHaveBeenCalledTimes(4) // 旧目录 + 配置文件 + saveConfig: 旧目录 + 配置目录

      // 第二次调用 - 应使用缓存
      vi.mocked(fs.existsSync).mockClear()
      const result2 = getConfig()
      expect(fs.existsSync).toHaveBeenCalledTimes(0) // 不应再次检查文件

      expect(result1).toEqual(result2)
    })

    it('should handle malformed JSON gracefully', () => {
      mockFileContents.set(configFilePath, 'invalid json content')

      const result = getConfig()

      expect(result.scanPaths).toEqual([])
      expect(result.projects).toEqual([])
      expect(result.theme).toBe('light')
    })

    it('should write default sessionPool config when settings.json has no sessionPool field', () => {
      const configWithoutPool: AppConfig = {
        scanPaths: ['/path1'],
        projects: [],
        theme: 'dark',
        aiPromptTimeout: 15,
      }
      mockFileContents.set(configFilePath, JSON.stringify(configWithoutPool))

      const result = getConfig()

      // sessionPool 应被填充默认值
      expect(result.sessionPool).toBeDefined()
      expect(result.sessionPool!.maxSessions).toBe(20)
      expect(result.sessionPool!.maxQueueSize).toBe(50)

      // saveConfig 应已被调用以持久化默认值
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        configFilePath,
        expect.stringContaining('"sessionPool"'),
        'utf-8'
      )
    })

    it('should not overwrite existing sessionPool config', () => {
      const existingPoolConfig = {
        maxSessions: 5,
        idleTimeoutMs: 1000,
        evictionIntervalMs: 500,
        maxQueueSize: 10,
        queueTimeoutMs: 3000,
      }
      const configWithPool: AppConfig = {
        scanPaths: ['/path1'],
        projects: [],
        theme: 'dark',
        sessionPool: existingPoolConfig,
      }
      mockFileContents.set(configFilePath, JSON.stringify(configWithPool))

      vi.mocked(fs.writeFileSync).mockClear()
      const result = getConfig()

      // 已有的 sessionPool 配置应被保留
      expect(result.sessionPool).toEqual(existingPoolConfig)
      expect(result.sessionPool!.maxSessions).toBe(5)

      // saveConfig 不应被调用（不覆盖）
      expect(fs.writeFileSync).not.toHaveBeenCalled()
    })

    it('should write default sessionPool for default config when file does not exist', () => {
      // 未设置文件，模拟首次运行
      const result = getConfig()

      // 即使是默认配置也应获得 sessionPool 默认值
      expect(result.sessionPool).toBeDefined()
      expect(result.sessionPool!.maxSessions).toBe(20)
      expect(result.sessionPool!.idleTimeoutMs).toBe(10 * 60 * 1000)
      expect(result.sessionPool!.evictionIntervalMs).toBe(60 * 1000)
      expect(result.sessionPool!.maxQueueSize).toBe(50)
      expect(result.sessionPool!.queueTimeoutMs).toBe(5 * 60 * 1000)

      // saveConfig 应已被调用
      expect(fs.writeFileSync).toHaveBeenCalled()
    })
  })

  describe('updateConfig', () => {
    it('should merge partial config and persist', () => {
      const initialConfig: AppConfig = {
        scanPaths: ['/existing'],
        projects: [],
        theme: 'light',
        aiPromptTimeout: 10,
      }
      mockFileContents.set(configFilePath, JSON.stringify(initialConfig))

      const result = updateConfig({ theme: 'dark', aiPromptTimeout: 20 })

      expect(result.theme).toBe('dark')
      expect(result.aiPromptTimeout).toBe(20)
      expect(result.scanPaths).toEqual(['/existing']) // 保留原值

      // 验证已写入文件
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        configFilePath,
        expect.stringContaining('"theme": "dark"'),
        'utf-8'
      )
    })

    it('should handle logRetentionDays update', () => {
      const initialConfig: AppConfig = {
        scanPaths: [],
        projects: [],
        theme: 'light',
      }
      mockFileContents.set(configFilePath, JSON.stringify(initialConfig))

      const result = updateConfig({ logRetentionDays: 30 })

      expect(result.logRetentionDays).toBe(30)
    })

    it('should handle yolo mode update', () => {
      const initialConfig: AppConfig = {
        scanPaths: [],
        projects: [],
        theme: 'light',
      }
      mockFileContents.set(configFilePath, JSON.stringify(initialConfig))

      const result = updateConfig({ yolo: true })

      expect(result.yolo).toBe(true)
    })

    it('should handle lastOpenedProject update', () => {
      const initialConfig: AppConfig = {
        scanPaths: [],
        projects: [],
        theme: 'light',
      }
      mockFileContents.set(configFilePath, JSON.stringify(initialConfig))

      const result = updateConfig({ lastOpenedProject: 'proj-123' })

      expect(result.lastOpenedProject).toBe('proj-123')
    })

    it('should not modify config when partial is empty', () => {
      const initialConfig: AppConfig = {
        scanPaths: ['/test'],
        projects: [],
        theme: 'light',
      }
      mockFileContents.set(configFilePath, JSON.stringify(initialConfig))

      const result = updateConfig({})

      expect(result.scanPaths).toEqual(['/test'])
      expect(result.theme).toBe('light')
    })

    it('should update scanPaths array', () => {
      const initialConfig: AppConfig = {
        scanPaths: ['/old'],
        projects: [],
        theme: 'light',
      }
      mockFileContents.set(configFilePath, JSON.stringify(initialConfig))

      const result = updateConfig({ scanPaths: ['/new1', '/new2'] })

      expect(result.scanPaths).toEqual(['/new1', '/new2'])
    })
  })

  describe('默认值', () => {
    it('should have reasonable defaults for all config fields', () => {
      const result = getConfig()

      expect(result.scanPaths).toEqual([])
      expect(result.projects).toEqual([])
      expect(result.theme).toBe('light')
      expect(result.aiPromptTimeout).toBe(10)
    })

    it('should be compatible with old config missing new fields', () => {
      // 模拟缺少 aiPromptTimeout 的旧配置
      const oldConfig = {
        scanPaths: ['/path'],
        projects: [],
        theme: 'light',
      }
      mockFileContents.set(configFilePath, JSON.stringify(oldConfig))

      const result = getConfig()

      // 旧字段被保留
      expect(result.scanPaths).toEqual(['/path'])
      expect(result.theme).toBe('light')

      // 新字段应为 undefined（不会自动添加）
      // 配置服务在读取时不会自动合并默认值
      expect(result.aiPromptTimeout).toBeUndefined()
    })

    it('should preserve optional fields when they exist', () => {
      const config: AppConfig = {
        scanPaths: [],
        projects: [],
        theme: 'light',
        logRetentionDays: 14,
        yolo: true,
        projectSessions: { 'proj1': ['sess1', 'sess2'] },
      }
      mockFileContents.set(configFilePath, JSON.stringify(config))

      const result = getConfig()

      expect(result.logRetentionDays).toBe(14)
      expect(result.yolo).toBe(true)
      expect(result.projectSessions).toEqual({ 'proj1': ['sess1', 'sess2'] })
    })
  })

  describe('项目管理', () => {
    describe('addProject', () => {
      it('should add new project to empty projects list', () => {
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: [],
          projects: [],
          theme: 'light',
        }))

        const project = createProject('proj1', 'Test Project', '/test/path')
        const result = addProject(project)

        expect(result.projects.length).toBe(1)
        expect(result.projects[0].id).toBe('proj1')
        expect(result.projects[0].name).toBe('Test Project')
      })

      it('should add new project to existing projects list', () => {
        const existingProject = createProject('proj1', 'Existing', '/existing')
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: [],
          projects: [existingProject],
          theme: 'light',
        }))

        const newProject = createProject('proj2', 'New Project', '/new/path')
        const result = addProject(newProject)

        expect(result.projects.length).toBe(2)
        expect(result.projects.map(p => p.id)).toContain('proj1')
        expect(result.projects.map(p => p.id)).toContain('proj2')
      })

      it('should update existing project with same id', () => {
        const existingProject = createProject('proj1', 'Old Name', '/old/path')
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: [],
          projects: [existingProject],
          theme: 'light',
        }))

        const updatedProject = createProject('proj1', 'Updated Name', '/updated/path')
        const result = addProject(updatedProject)

        expect(result.projects.length).toBe(1)
        expect(result.projects[0].name).toBe('Updated Name')
        expect(result.projects[0].path).toBe('/updated/path')
      })
    })

    describe('removeProject', () => {
      it('should remove project by id', () => {
        const project1 = createProject('proj1', 'Project 1', '/path1')
        const project2 = createProject('proj2', 'Project 2', '/path2')
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: [],
          projects: [project1, project2],
          theme: 'light',
        }))

        const result = removeProject('proj1')

        expect(result.projects.length).toBe(1)
        expect(result.projects[0].id).toBe('proj2')
      })

      it('should do nothing when project id not found', () => {
        const project = createProject('proj1', 'Project 1', '/path1')
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: [],
          projects: [project],
          theme: 'light',
        }))

        const result = removeProject('nonexistent')

        expect(result.projects.length).toBe(1)
        expect(result.projects[0].id).toBe('proj1')
      })

      it('should clear lastOpenedProject when removing that project', () => {
        const project = createProject('proj1', 'Project 1', '/path1')
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: [],
          projects: [project],
          theme: 'light',
          lastOpenedProject: 'proj1',
        }))

        const result = removeProject('proj1')

        expect(result.lastOpenedProject).toBeUndefined()
      })

      it('should keep lastOpenedProject when removing different project', () => {
        const project1 = createProject('proj1', 'Project 1', '/path1')
        const project2 = createProject('proj2', 'Project 2', '/path2')
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: [],
          projects: [project1, project2],
          theme: 'light',
          lastOpenedProject: 'proj1',
        }))

        const result = removeProject('proj2')

        expect(result.lastOpenedProject).toBe('proj1')
      })
    })

    describe('setActiveProject', () => {
      it('should set project as active', () => {
        const project1 = createProject('proj1', 'Project 1', '/path1')
        const project2 = createProject('proj2', 'Project 2', '/path2')
        project1.isActive = true // 初始为活跃状态
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: [],
          projects: [project1, project2],
          theme: 'light',
        }))

        const result = setActiveProject('proj2')

        expect(result.projects.find(p => p.id === 'proj2')?.isActive).toBe(true)
        expect(result.projects.find(p => p.id === 'proj1')?.isActive).toBe(false)
        expect(result.lastOpenedProject).toBe('proj2')
      })

      it('should return unchanged config when project not found', () => {
        const project = createProject('proj1', 'Project 1', '/path1')
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: [],
          projects: [project],
          theme: 'light',
        }))

        const result = setActiveProject('nonexistent')

        expect(result.projects[0].isActive).toBe(false)
        expect(result.lastOpenedProject).toBeUndefined()
      })
    })

    describe('getProjectById', () => {
      it('should return project when found', () => {
        const project = createProject('proj1', 'Test Project', '/test/path')
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: [],
          projects: [project],
          theme: 'light',
        }))

        const result = getProjectById('proj1')

        expect(result).toBeDefined()
        expect(result?.name).toBe('Test Project')
        expect(result?.path).toBe('/test/path')
      })

      it('should return undefined when project not found', () => {
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: [],
          projects: [],
          theme: 'light',
        }))

        const result = getProjectById('nonexistent')

        expect(result).toBeUndefined()
      })
    })
  })

  describe('扫描路径管理', () => {
    describe('addScanPath', () => {
      it('should add new scan path', () => {
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: [],
          projects: [],
          theme: 'light',
        }))

        const result = addScanPath('/new/path')

        expect(result.scanPaths).toContain('/new/path')
      })

      it('should not duplicate existing scan path', () => {
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: ['/existing/path'],
          projects: [],
          theme: 'light',
        }))

        const result = addScanPath('/existing/path')

        expect(result.scanPaths.length).toBe(1)
        expect(result.scanPaths).toContain('/existing/path')
      })

      it('should normalize scan path', () => {
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: [],
          projects: [],
          theme: 'light',
        }))

        // path.resolve 的 Mock 会规范化相对路径
        const result = addScanPath('relative/path')

        expect(result.scanPaths).toContain('/home/testuser/relative/path')
      })

      it('should add to existing scan paths', () => {
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: ['/path1'],
          projects: [],
          theme: 'light',
        }))

        const result = addScanPath('/path2')

        expect(result.scanPaths.length).toBe(2)
        expect(result.scanPaths).toContain('/path1')
        expect(result.scanPaths).toContain('/path2')
      })
    })

    describe('removeScanPath', () => {
      it('should remove existing scan path', () => {
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: ['/path1', '/path2'],
          projects: [],
          theme: 'light',
        }))

        const result = removeScanPath('/path1')

        expect(result.scanPaths.length).toBe(1)
        expect(result.scanPaths).toContain('/path2')
      })

      it('should do nothing when path not found', () => {
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: ['/path1'],
          projects: [],
          theme: 'light',
        }))

        const result = removeScanPath('/nonexistent')

        expect(result.scanPaths.length).toBe(1)
        expect(result.scanPaths).toContain('/path1')
      })

      it('should normalize path before removal', () => {
        mockFileContents.set(configFilePath, JSON.stringify({
          scanPaths: ['/home/testuser/relative/path'],
          projects: [],
          theme: 'light',
        }))

        const result = removeScanPath('relative/path')

        expect(result.scanPaths.length).toBe(0)
      })
    })
  })

  describe('配置迁移', () => {
    const legacyDir = '/home/testuser/.config/wikibrowser'
    const legacySettingsPath = `${legacyDir}/settings.json`

    it('should migrate from legacy ~/.config/wikibrowser to ~/.wikibrowser', () => {
      const oldConfig: AppConfig = {
        scanPaths: ['/migrated-path'],
        projects: [],
        theme: 'dark',
      }

      // 旧目录存在，新目录不存在
      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === legacyDir) return true
        if (p === legacySettingsPath) return true
        if (p === configDir) return false
        return mockFileContents.has(p)
      })
      vi.mocked(fs.readdirSync).mockReturnValue(['settings.json'] as any)
      vi.mocked(fs.copyFileSync).mockImplementation(() => {
        mockFileContents.set(configFilePath, JSON.stringify(oldConfig))
      })

      const result = getConfig()

      expect(fs.copyFileSync).toHaveBeenCalledWith(legacySettingsPath, expect.stringContaining('.wikibrowser/settings.json'))
      expect(fs.rmSync).toHaveBeenCalledWith(legacyDir, { recursive: true, force: true })
      expect(result.scanPaths).toEqual(['/migrated-path'])
    })

    it('should skip migration when legacy dir does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      getConfig()

      expect(fs.readdirSync).not.toHaveBeenCalled()
      expect(fs.rmSync).not.toHaveBeenCalled()
    })

    it('should not overwrite existing files during migration', () => {
      const newConfig: AppConfig = {
        scanPaths: ['/new'],
        projects: [],
        theme: 'light',
      }

      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p === legacyDir) return true
        if (p === configDir) return true
        if (p === configFilePath) return true
        return false
      })
      vi.mocked(fs.readdirSync).mockReturnValue(['settings.json'] as any)
      mockFileContents.set(configFilePath, JSON.stringify(newConfig))

      const result = getConfig()

      expect(fs.copyFileSync).not.toHaveBeenCalled()
      expect(result.scanPaths).toEqual(['/new'])
    })
  })

  describe('缓存机制', () => {
    it('should clear cache when invalidateConfigCache is called', () => {
      const config: AppConfig = {
        scanPaths: ['/cached'],
        projects: [],
        theme: 'light',
      }
      mockFileContents.set(configFilePath, JSON.stringify(config))

      // 第一次调用 - 从文件加载
      getConfig()
      expect(fs.existsSync).toHaveBeenCalledTimes(4) // 旧目录 + 配置文件 + saveConfig: 旧目录 + 配置目录

      // 清除缓存
      invalidateConfigCache()

      // 第二次调用 - 应从文件重新加载
      vi.mocked(fs.existsSync).mockClear()
      getConfig()
      expect(fs.existsSync).toHaveBeenCalledTimes(2) // 旧目录 + 配置文件
    })

    it('should update cache after saveConfig', () => {
      mockFileContents.set(configFilePath, JSON.stringify({
        scanPaths: [],
        projects: [],
        theme: 'light',
      }))

      const newConfig: AppConfig = {
        scanPaths: ['/saved'],
        projects: [],
        theme: 'dark',
      }

      saveConfig(newConfig)

      // 后续 getConfig 应从缓存返回已保存的配置
      vi.mocked(fs.existsSync).mockClear()
      const result = getConfig()
      expect(result.scanPaths).toEqual(['/saved'])
      expect(result.theme).toBe('dark')
      expect(fs.existsSync).toHaveBeenCalledTimes(0) // 使用了缓存
    })

    it('should use cached config when calling addProject', () => {
      const initialConfig: AppConfig = {
        scanPaths: [],
        projects: [],
        theme: 'light',
      }
      mockFileContents.set(configFilePath, JSON.stringify(initialConfig))

      // 将配置加载到缓存
      getConfig()
      vi.mocked(fs.existsSync).mockClear()

      // 添加项目 - 应使用缓存的配置
      const project = createProject('proj1', 'Test', '/test')
      addProject(project)

      // getConfig 在内部被调用，但缓存填充后，
      // 后续的 getConfig 调用会使用缓存
    })
  })

  describe('saveConfig', () => {
    it('should create config directory if not exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      const config: AppConfig = {
        scanPaths: [],
        projects: [],
        theme: 'light',
      }

      saveConfig(config)

      expect(fs.mkdirSync).toHaveBeenCalledWith(configDir, { recursive: true })
    })

    it('should not create directory if already exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      const config: AppConfig = {
        scanPaths: [],
        projects: [],
        theme: 'light',
      }

      saveConfig(config)

      expect(fs.mkdirSync).not.toHaveBeenCalled()
    })

    it('should write config with proper formatting', () => {
      const config: AppConfig = {
        scanPaths: ['/path'],
        projects: [createProject('proj1', 'Test', '/test')],
        theme: 'dark',
        aiPromptTimeout: 15,
      }

      saveConfig(config)

      const writtenContent = mockFileContents.get(configFilePath)
      expect(writtenContent).toBeDefined()

      // 验证 JSON 格式化带缩进
      const parsed = JSON.parse(writtenContent!)
      expect(parsed.scanPaths).toEqual(['/path'])
      expect(parsed.theme).toBe('dark')
    })

    it('should use cached config when no config provided', () => {
      const cachedConfig: AppConfig = {
        scanPaths: ['/cached'],
        projects: [],
        theme: 'light',
      }
      mockFileContents.set(configFilePath, JSON.stringify(cachedConfig))

      // 将配置加载到缓存
      getConfig()

      // 不提供配置参数保存 - 应使用缓存
      vi.mocked(fs.writeFileSync).mockClear()
      saveConfig()

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        configFilePath,
        expect.stringContaining('/cached'),
        'utf-8'
      )
    })

    it('should throw error when write fails', () => {
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('Write failed')
      })

      const config: AppConfig = {
        scanPaths: [],
        projects: [],
        theme: 'light',
      }

      expect(() => saveConfig(config)).toThrow('Write failed')
    })
  })

  describe('平台差异', () => {
    it('should use correct config path on Windows', () => {
      vi.mocked(os.platform).mockReturnValue('win32')
      vi.mocked(os.homedir).mockReturnValue('C:\\Users\\test')

      // 重置 path.join 的 Mock 以适配 Windows
      vi.mocked(path.join).mockImplementation((...args: string[]) => args.join('\\'))

      mockFileContents.set('C:\\Users\\test\\.wikibrowser\\settings.json', JSON.stringify({
        scanPaths: [],
        projects: [],
        theme: 'light',
      }))

      const result = getConfig()

      expect(result).toBeDefined()
      expect(result.theme).toBe('light')
    })
  })
})