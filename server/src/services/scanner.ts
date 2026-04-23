import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { glob } from 'glob';
import type { ProjectConfig, ScanStatus } from '../../../shared/types/index.js';
import * as configService from './config.js';

/** 将路径中的反斜杠替换为正斜杠（跨平台兼容） */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/** 获取项目 wiki 目录路径 */
function getWikiPath(projectPath: string): string {
  return normalizePath(path.join(projectPath, '.zread', 'wiki'));
}

const scanStatus: ScanStatus = {
  scanning: false,
  lastScanAt: undefined,
};

/**
 * 获取扫描状态
 * @returns 扫描状态副本
 */
export function getScanStatus(): ScanStatus {
  return { ...scanStatus };
}

/** 返回当前是否正在扫描 */
export function isScanning(): boolean {
  return scanStatus.scanning;
}

/** 返回上次扫描完成时间（ISO 字符串），从未扫描返回 null */
export function getLastScanTime(): string | null {
  if (!scanStatus.lastScanAt) {
    return null;
  }
  return new Date(scanStatus.lastScanAt).toISOString();
}

/** 根据项目路径生成唯一 ID（SHA256 前 16 位） */
function generateProjectId(projectPath: string): string {
  const normalized = normalizePath(projectPath);
  return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
}

/** 从路径中提取项目名称（目录名） */
function getProjectName(projectPath: string): string {
  return path.basename(projectPath);
}

/** 获取当前版本 ID，依次尝试 current 文件/符号链接、versions 目录 */
function getCurrentVersion(wikiPath: string): string {
  // 尝试读取 "current" 符号链接或文件
  const currentPath = normalizePath(path.join(wikiPath, 'current'));
  try {
    if (fs.existsSync(currentPath)) {
      const stat = fs.lstatSync(currentPath);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(currentPath);
        return path.basename(target);
      }
      // 普通文件则读取内容作为版本字符串
      const content = fs.readFileSync(currentPath, 'utf-8').trim();
      if (content) {
        return path.basename(content);
      }
    }
  } catch {
    // 忽略错误，继续尝试下一种方式
  }

  // 尝试列出 versions 目录
  const versionsDir = normalizePath(path.join(wikiPath, 'versions'));
  try {
    if (fs.existsSync(versionsDir)) {
      const entries = fs.readdirSync(versionsDir)
        .filter((entry) => {
          const fullPath = normalizePath(path.join(versionsDir, entry));
          return fs.statSync(fullPath).isDirectory();
        })
        .sort();

      if (entries.length > 0) {
        return entries[entries.length - 1];
      }
    }
  } catch {
    // 忽略错误，返回默认版本
  }

  return 'default';
}

/** 检查是否有可用的 wiki.json 文件（与 wiki-loader 逻辑一致） */
function hasValidWikiJson(wikiPath: string, version: string): boolean {
  // 检查是否有可用的 wiki.json，与 wiki-loader 逻辑一致
  const candidates = [
    normalizePath(path.join(wikiPath, 'versions', version, 'wiki.json')),
    normalizePath(path.join(wikiPath, 'current', 'wiki.json')),
    normalizePath(path.join(wikiPath, 'wiki.json')),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const content = fs.readFileSync(candidate, 'utf-8');
        const data = JSON.parse(content);
        // 验证基本结构：必须有 pages 数组
        if (data && Array.isArray(data.pages)) {
          return true;
        }
      } catch {
        // 解析失败，继续检查下一个
      }
    }
  }

  return false;
}

/** 为项目目录创建 ProjectConfig，wiki 目录不存在或无效时返回 null */
function createProjectConfig(projectDir: string): ProjectConfig | null {
  const wikiPath = getWikiPath(projectDir);

  if (!fs.existsSync(wikiPath)) {
    return null;
  }

  const currentVersion = getCurrentVersion(wikiPath);

  // 检查是否有有效的 wiki.json（与加载逻辑一致）
  if (!hasValidWikiJson(wikiPath, currentVersion)) {
    console.warn(`[Scanner] No valid wiki.json found in ${wikiPath}, skipping`);
    return null;
  }

  const id = generateProjectId(projectDir);

  return {
    id,
    name: getProjectName(projectDir),
    path: normalizePath(projectDir),
    wikiPath: normalizePath(wikiPath),
    currentVersion,
    isActive: false,
    addedAt: Date.now(),
  };
}

/**
 * 扫描所有已配置的路径，发现并注册 wiki 项目。
 * 合并扫描结果与已有配置，保留用户偏好设置。
 *
 * @returns 合并后的项目配置列表
 * @throws 扫描已在进行中时抛出错误
 */
export async function scanAllPaths(): Promise<ProjectConfig[]> {
  if (scanStatus.scanning) {
    throw new Error('Scan already in progress');
  }

  scanStatus.scanning = true;
  scanStatus.progress = { total: 0, scanned: 0, found: 0 };

  try {
    const appConfig = configService.getConfig();
    const foundIds = new Set<string>();

    // 第一层：并行处理所有扫描路径
    const allResults = await Promise.all(
      appConfig.scanPaths.map(async (scanPath) => {
        if (!fs.existsSync(scanPath)) {
          console.warn(`[Scanner] Scan path does not exist: ${scanPath}`);
          return [];
        }

        const pattern = '**/.zread/wiki';
        const matches = await glob(pattern, {
          cwd: scanPath,
          absolute: true,
          maxDepth: 5,
          ignore: ['**/node_modules/**', '**/.git/**'],
        });

        // 更新进度（原子操作，progress 已在函数开头初始化）
        if (scanStatus.progress) {
          scanStatus.progress.total += matches.length;
        }

        // 第二层：并行处理每个匹配项
        const projects = await Promise.all(
          matches.map(async (wikiDir) => {
            const projectDir = path.dirname(path.dirname(wikiDir));
            const projectConfig = createProjectConfig(projectDir);
            if (scanStatus.progress) {
              scanStatus.progress.scanned++;
            }
            return projectConfig;
          })
        );

        return projects.filter((p): p is ProjectConfig => p !== null);
      })
    );

    // 合并所有结果并去重
    const allProjects: ProjectConfig[] = [];
    for (const projects of allResults) {
      for (const project of projects) {
        if (!foundIds.has(project.id)) {
          foundIds.add(project.id);
          allProjects.push(project);
          scanStatus.progress.found++;
        }
      }
    }

    // 与已有项目合并：保留已有项目的用户设置
    const existingMap = new Map<string, ProjectConfig>();
    for (const p of appConfig.projects) {
      existingMap.set(p.id, p);
    }

    const mergedProjects: ProjectConfig[] = [];
    for (const newProject of allProjects) {
      const existing = existingMap.get(newProject.id);
      if (existing) {
        // 更新路径和版本，但保留用户偏好设置
        mergedProjects.push({
          ...existing,
          path: newProject.path,
          wikiPath: newProject.wikiPath,
          currentVersion: newProject.currentVersion,
        });
        existingMap.delete(newProject.id);
      } else {
        mergedProjects.push(newProject);
      }
    }

    // 保留手动添加的项目（非扫描路径来源），但检查磁盘是否仍存在
    for (const [, remaining] of existingMap) {
      // 检查项目在磁盘上是否仍然存在
      if (fs.existsSync(remaining.wikiPath)) {
        mergedProjects.push(remaining);
      }
    }

    // 用合并结果更新配置
    const updatedConfig = { ...appConfig, projects: mergedProjects };
    configService.saveConfig(updatedConfig);

    scanStatus.lastScanAt = Date.now();

    return mergedProjects;
  } finally {
    scanStatus.scanning = false;
  }
}

/**
 * 扫描单个项目路径，发现并注册 wiki 项目
 * @param projectPath - 项目路径
 * @returns 项目配置或 null（无效项目时）
 */
export async function scanSinglePath(projectPath: string): Promise<ProjectConfig | null> {
  const resolved = normalizePath(path.resolve(projectPath));
  const projectConfig = createProjectConfig(resolved);

  if (!projectConfig) {
    return null;
  }

  configService.addProject(projectConfig);
  return projectConfig;
}
