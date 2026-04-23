import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AppConfig, ProjectConfig } from '../../../shared/types/index.js';
import { DEFAULT_POOL_CONFIG } from './session-pool.types.js';

/** 获取配置目录路径，优先使用环境变量（用于 E2E 测试隔离） */
function getConfigDir(): string {
  // 优先使用环境变量指定的配置目录（主要用于 E2E 测试隔离）
  if (process.env.WIKIBROWSER_CONFIG_DIR) {
    return process.env.WIKIBROWSER_CONFIG_DIR;
  }
  return path.join(os.homedir(), '.wikibrowser');
}

/** 旧版 Linux/macOS 配置目录，仅迁移时使用 */
function getLegacyConfigDir(): string {
  return path.join(os.homedir(), '.config', 'wikibrowser');
}

/**
 * 将旧版 ~/.config/wikibrowser/ 下的配置文件迁移到 ~/.wikibrowser/
 * 迁移完成后删除旧目录
 */
function migrateFromLegacyDir(): void {
  const legacyDir = getLegacyConfigDir();
  const newDir = getConfigDir();

  if (!fs.existsSync(legacyDir)) return;

  // 新目录已存在则不覆盖，只迁移新目录中不存在的文件
  if (!fs.existsSync(newDir)) {
    fs.mkdirSync(newDir, { recursive: true });
  }

  const files = fs.readdirSync(legacyDir);
  for (const file of files) {
    const src = path.join(legacyDir, file);
    const dest = path.join(newDir, file);
    if (!fs.existsSync(dest)) {
      if (!fs.existsSync(src)) continue;
      const stat = fs.statSync(src);
      if (stat.isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
      } else {
        fs.copyFileSync(src, dest);
      }
    }
  }

  // 迁移完成后删除旧目录
  fs.rmSync(legacyDir, { recursive: true, force: true });
  console.log('[Config] Migrated config from', legacyDir, 'to', newDir);
}

/** 获取配置文件路径，首次访问时自动从旧目录迁移 */
function getConfigFilePath(): string {
  migrateFromLegacyDir();
  return path.join(getConfigDir(), 'settings.json');
}

/** 获取默认配置 */
function getDefaultConfig(): AppConfig {
  return {
    scanPaths: [],
    projects: [],
    theme: 'light',
    aiPromptTimeout: 10, // 默认 10 分钟
  };
}

let cachedConfig: AppConfig | null = null;

/** 缓存失效函数（用于需要强制重新加载配置的场景） */
export function invalidateConfigCache(): void {
  cachedConfig = null;
}

/**
 * 首次加载配置时，如果 settings.json 没有 sessionPool 字段，写入默认配置
 */
function ensureSessionPoolConfig(config: AppConfig): void {
  if (!config.sessionPool) {
    config.sessionPool = { ...DEFAULT_POOL_CONFIG };
    saveConfig(config);
  }
}

/**
 * 获取应用配置，带缓存。首次加载时自动补充默认 sessionPool 配置。
 * @returns 应用配置对象
 */
export function getConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const filePath = getConfigFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      cachedConfig = JSON.parse(raw) as AppConfig;
      ensureSessionPoolConfig(cachedConfig);
      return cachedConfig;
    }
  } catch (err) {
    console.error('[Config] Failed to read config file:', err);
  }

  cachedConfig = getDefaultConfig();
  ensureSessionPoolConfig(cachedConfig);
  return cachedConfig;
}

/**
 * 保存应用配置到文件并更新缓存
 * @param config - 可选的配置对象，未提供时使用缓存或默认值
 * @returns 保存后的配置对象
 */
export function saveConfig(config?: AppConfig): AppConfig {
  const cfg = config || cachedConfig || getDefaultConfig();
  const dir = getConfigDir();

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(getConfigFilePath(), JSON.stringify(cfg, null, 2), 'utf-8');
    cachedConfig = cfg;
  } catch (err) {
    console.error('[Config] Failed to save config file:', err);
    throw err;
  }

  return cfg;
}

/**
 * 添加扫描路径（已存在则忽略）
 * @param scanPath - 新增的扫描路径
 * @returns 更新后的配置
 */
export function addScanPath(scanPath: string): AppConfig {
  const config = getConfig();
  const normalized = path.resolve(scanPath);

  if (!config.scanPaths.includes(normalized)) {
    config.scanPaths.push(normalized);
  }

  return saveConfig(config);
}

/**
 * 移除扫描路径
 * @param scanPath - 要移除的扫描路径
 * @returns 更新后的配置
 */
export function removeScanPath(scanPath: string): AppConfig {
  const config = getConfig();
  const normalized = path.resolve(scanPath);

  config.scanPaths = config.scanPaths.filter((p) => p !== normalized);

  return saveConfig(config);
}

/**
 * 根据 ID 获取项目配置
 * @param id - 项目 ID
 * @returns 项目配置或 undefined
 */
export function getProjectById(id: string): ProjectConfig | undefined {
  const config = getConfig();
  return config.projects.find((p) => p.id === id);
}

/**
 * 添加或更新项目配置（已存在则替换）
 * @param project - 项目配置
 * @returns 更新后的配置
 */
export function addProject(project: ProjectConfig): AppConfig {
  const config = getConfig();

  const existingIndex = config.projects.findIndex((p) => p.id === project.id);
  if (existingIndex >= 0) {
    config.projects[existingIndex] = project;
  } else {
    config.projects.push(project);
  }

  return saveConfig(config);
}

/**
 * 移除项目配置，同时清除 lastOpenedProject 引用
 * @param id - 要移除的项目 ID
 * @returns 更新后的配置
 */
export function removeProject(id: string): AppConfig {
  const config = getConfig();
  config.projects = config.projects.filter((p) => p.id !== id);

  if (config.lastOpenedProject === id) {
    delete config.lastOpenedProject;
  }

  return saveConfig(config);
}

/**
 * 设置当前活跃项目
 * @param id - 项目 ID
 * @returns 更新后的配置
 */
export function setActiveProject(id: string): AppConfig {
  const config = getConfig();

  const project = config.projects.find((p) => p.id === id);
  if (!project) {
    return config;
  }

  config.projects.forEach((p) => {
    p.isActive = p.id === id;
  });
  config.lastOpenedProject = id;

  return saveConfig(config);
}

/**
 * 部分更新应用配置，仅更新传入的字段
 * @param partial - 要更新的配置字段
 * @returns 更新后的配置
 */
export function updateConfig(partial: Partial<AppConfig>): AppConfig {
  const config = getConfig();

  if (partial.theme !== undefined) {
    config.theme = partial.theme;
  }
  if (partial.scanPaths !== undefined) {
    config.scanPaths = partial.scanPaths;
  }
  if (partial.lastOpenedProject !== undefined) {
    config.lastOpenedProject = partial.lastOpenedProject;
  }
  if (partial.logRetentionDays !== undefined) {
    config.logRetentionDays = partial.logRetentionDays;
  }
  if (partial.aiPromptTimeout !== undefined) {
    config.aiPromptTimeout = partial.aiPromptTimeout;
  }
  if (partial.yolo !== undefined) {
    config.yolo = partial.yolo;
  }
  if (partial.sessionPool !== undefined) {
    config.sessionPool = partial.sessionPool;
  }

  return saveConfig(config);
}
