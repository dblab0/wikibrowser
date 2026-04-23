import type {
  AppConfig,
  ProjectConfig,
  WikiData,
  WikiPage,
  WikiVersion,
  SearchResult,
  ScanStatus,
  ApiResponse,
} from '@shared/types';

const API_BASE = '/api';

let isRedirecting = false;

/**
 * 通用 API 请求封装，统一处理认证和错误
 * @param url - 请求路径（不含前缀）
 * @param options - fetch 选项
 * @returns 解析后的响应数据
 */
async function apiFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    cache: 'no-cache',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  // 401 自动刷新（防并发）
  if (response.status === 401 && !isRedirecting) {
    isRedirecting = true;
    window.location.reload();
    return new Promise(() => {}); // 永不 resolve，防止后续代码执行
  }

  const json: ApiResponse<T> = await response.json();

  if (!json.success) {
    throw new Error(json.error?.message || '请求失败');
  }

  return json.data;
}

// ===== 缓存层 =====
const cache = new Map<string, { data: any; expiry: number }>();
const pendingRequests = new Map<string, Promise<any>>();
const CACHE_TTL = 5 * 60 * 1000; // 缓存有效期 5 分钟

/**
 * 带缓存的 API 请求封装，仅对 GET 请求进行缓存
 * @param url - 请求路径（不含前缀）
 * @param options - fetch 选项
 * @returns 解析后的响应数据
 */
function cachedApiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const method = options?.method || 'GET';
  const cacheKey = `${method}:${url}`;

  if (method === 'GET') {
    const cached = cache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }

    const pending = pendingRequests.get(cacheKey);
    if (pending) return pending;
  }

  const promise = apiFetch<T>(url, options).then((data) => {
    if (method === 'GET') {
      cache.set(cacheKey, { data, expiry: Date.now() + CACHE_TTL });
      pendingRequests.delete(`${method}:${url}`);
    }
    return data;
  }).catch((err) => {
    if (method === 'GET') {
      pendingRequests.delete(`${method}:${url}`);
    }
    throw err;
  });

  if (method === 'GET') {
    pendingRequests.set(`${method}:${url}`, promise);
  }

  return promise;
}

/**
 * 使匹配指定模式的缓存失效
 * @param urlPattern - 需要失效的 URL 模式字符串
 */
function invalidateCache(urlPattern: string): void {
  for (const key of cache.keys()) {
    if (key.includes(urlPattern)) {
      cache.delete(key);
    }
  }
}

// ===== 项目 API =====

/**
 * 获取所有项目列表
 * @returns 项目配置数组
 */
export async function getProjects(): Promise<ProjectConfig[]> {
  return cachedApiFetch<ProjectConfig[]>('/projects');
}

/**
 * 获取项目的 Wiki 数据
 * @param projectId - 项目 ID
 * @param version - Wiki 版本（可选）
 * @returns Wiki 数据
 */
export async function getWiki(projectId: string, version?: string): Promise<WikiData> {
  const params = version ? `?version=${encodeURIComponent(version)}` : '';
  return cachedApiFetch<WikiData>(
    `/wiki/${encodeURIComponent(projectId)}${params}`
  );
}

/**
 * 获取项目的 Wiki 版本列表
 * @param projectId - 项目 ID
 * @returns Wiki 版本信息数组
 */
export async function getWikiVersions(projectId: string): Promise<WikiVersion[]> {
  return cachedApiFetch<WikiVersion[]>(
    `/wiki/${encodeURIComponent(projectId)}/versions`
  );
}

/**
 * 获取 Wiki 页面内容及元数据
 * @param projectId - 项目 ID
 * @param version - Wiki 版本
 * @param slug - 页面 slug
 * @returns 包含页面信息、Markdown 内容和修改时间的对象
 */
export async function getPage(
  projectId: string,
  version: string,
  slug: string,
): Promise<{ page: WikiPage; content: string; mtime: number }> {
  return cachedApiFetch<{ page: WikiPage; content: string; mtime: number }>(
    `/wiki/${encodeURIComponent(projectId)}/${encodeURIComponent(version)}/${encodeURIComponent(slug)}`,
  );
}

/**
 * 保存 Wiki 页面内容（支持冲突检测）
 * @param projectId - 项目 ID
 * @param version - Wiki 版本
 * @param slug - 页面 slug
 * @param content - 页面 Markdown 内容
 * @param expectedMtime - 预期的修改时间戳，用于冲突检测（可选）
 * @returns 更新后的修改时间
 */
export async function putPage(
  projectId: string,
  version: string,
  slug: string,
  content: string,
  expectedMtime?: number,
): Promise<{ mtime: number }> {
  const result = await apiFetch<{ mtime: number }>(
    `/wiki/${encodeURIComponent(projectId)}/${encodeURIComponent(version)}/${encodeURIComponent(slug)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ content, expectedMtime }),
    },
  );
  invalidateCache('/wiki/');
  return result;
}

/**
 * 在项目内进行全文搜索
 * @param projectId - 项目 ID
 * @param query - 搜索关键词
 * @returns 搜索结果数组
 */
export async function searchProject(
  projectId: string,
  query: string,
): Promise<SearchResult[]> {
  return apiFetch<SearchResult[]>(
    `/search/${encodeURIComponent(projectId)}?q=${encodeURIComponent(query)}`,
  );
}

// ===== 配置 API =====

/**
 * 获取应用配置
 * @returns 应用配置对象
 */
export async function getConfig(): Promise<AppConfig> {
  return cachedApiFetch<AppConfig>('/config');
}

/**
 * 更新应用配置
 * @param config - 需要更新的配置字段
 * @returns 更新后的完整配置
 */
export async function updateConfig(config: Partial<AppConfig>): Promise<AppConfig> {
  const result = await apiFetch<AppConfig>('/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  invalidateCache('/config');
  return result;
}

// ===== 项目管理 API =====

/**
 * 添加新项目
 * @param projectPath - 项目磁盘路径
 * @returns 新增的项目配置
 */
export async function addProject(projectPath: string): Promise<ProjectConfig> {
  const result = await apiFetch<ProjectConfig>('/projects', {
    method: 'POST',
    body: JSON.stringify({ path: projectPath }),
  });
  invalidateCache('/projects');
  return result;
}

/**
 * 删除项目
 * @param id - 项目 ID
 * @returns 包含已删除项目 ID 的对象
 */
export async function deleteProject(id: string): Promise<{ id: string }> {
  const result = await apiFetch<{ id: string }>(`/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  invalidateCache('/projects');
  return result;
}

/**
 * 刷新项目缓存
 * 服务端失效内存缓存 + 重建搜索索引后，客户端也需清除本地 HTTP 缓存
 * @param id - 项目 ID
 * @returns 刷新结果
 */
export async function refreshProjectCache(id: string): Promise<{
  wikiDataCleared: boolean;
  wikiDataReloaded: boolean;
  searchIndexUpdated: boolean;
}> {
  const result = await apiFetch<{
    wikiDataCleared: boolean;
    wikiDataReloaded: boolean;
    searchIndexUpdated: boolean;
  }>(`/projects/${encodeURIComponent(id)}/refresh-cache`, {
    method: 'POST',
  });
  // 服务端缓存已刷新，同时清除客户端 HTTP 缓存中该项目相关的条目
  invalidateCache('/wiki/');
  return result;
}

// ===== 扫描 API =====

/**
 * 触发项目扫描
 * @returns 扫描后的项目配置数组
 */
export async function triggerScan(): Promise<ProjectConfig[]> {
  return apiFetch<ProjectConfig[]>('/scan', {
    method: 'POST',
  });
}

/**
 * 获取扫描状态
 * @returns 扫描状态信息
 */
export async function getScanStatus(): Promise<ScanStatus> {
  return apiFetch<ScanStatus>('/scan/status');
}

/**
 * 获取文件内容（支持行范围和行高亮）
 * @param filePath - 文件路径
 * @param startLine - 起始行号（可选）
 * @param endLine - 结束行号（可选）
 * @returns 包含文件路径、总行数和行内容数组的对象
 */
export async function getFileContent(
  filePath: string,
  startLine?: number,
  endLine?: number
): Promise<{
  path: string;
  totalLines: number;
  lines: Array<{
    lineNumber: number;
    content: string;
    highlighted: boolean;
  }>;
}> {
  const params = new URLSearchParams({ path: filePath });
  if (startLine) params.append('startLine', startLine.toString());
  if (endLine) params.append('endLine', endLine.toString());
  return cachedApiFetch<{
    path: string;
    totalLines: number;
    lines: Array<{
      lineNumber: number;
      content: string;
      highlighted: boolean;
    }>;
  }>(`/files/content?${params.toString()}`);
}

// ===== 认证 API =====

/**
 * 获取认证状态
 * @returns 包含认证是否启用的对象
 */
export async function getAuthStatus(): Promise<{ enabled: boolean }> {
  const response = await fetch('/api/auth/status');
  return response.json();
}
