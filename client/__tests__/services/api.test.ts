/**
 * API 服务测试
 *
 * 测试 /client/src/services/api.ts 的缓存、请求处理和 API 方法
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mockFetch,
  mockFetchSuccess,
  mockFetchError,
  mockFetchNetworkError,
  mockFetchNotFound,
  mockFetchServerError,
  mockTimers,
} from '../helpers/mocks';

describe('api', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===== 缓存层测试 =====
  describe('Cache Layer', () => {
    it('should cache GET request results for 5 minutes', async () => {
      const projectsData = [
        { id: 'proj1', name: 'Project 1', path: '/path/1' },
      ];

      mockFetchSuccess(projectsData);

      const { getProjects } = await import('../../src/services/api');

      // 首次调用
      const result1 = await getProjects();
      expect(result1).toEqual(projectsData);
      expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);

      // 5 分钟内第二次调用应使用缓存
      const result2 = await getProjects();
      expect(result2).toEqual(projectsData);
      expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1); // 仍为 1，使用了缓存
    });

    it('should refetch after cache expires', async () => {
      const projectsData = [
        { id: 'proj1', name: 'Project 1', path: '/path/1' },
      ];

      mockFetchSuccess(projectsData);

      const { getProjects } = await import('../../src/services/api');
      const timers = mockTimers();

      // 首次调用
      await getProjects();
      expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);

      // 前进 5 分钟 + 1ms（缓存 TTL = 5 * 60 * 1000）
      timers.advanceTime(5 * 60 * 1000 + 1);

      // 缓存过期后第二次调用应重新请求
      await getProjects();
      expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);

      timers.restore();
    });

    it('should not cache non-GET requests', async () => {
      const updatedConfig = { theme: 'dark' as const, scanPaths: [] };

      mockFetchSuccess(updatedConfig);

      const { updateConfig } = await import('../../src/services/api');

      // 首次调用
      const result1 = await updateConfig({ theme: 'dark' });
      expect(result1).toEqual(updatedConfig);
      expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);

      // 第二次调用不应使用缓存
      const result2 = await updateConfig({ theme: 'dark' });
      expect(result2).toEqual(updatedConfig);
      expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2); // 未缓存
    });

    it('should cache different URLs separately', async () => {
      mockFetchSuccess({ id: 'project-1' });
      mockFetchSuccess({ id: 'wiki-1' });

      const { getProjects, getWiki } = await import('../../src/services/api');

      await getProjects();
      await getWiki('project-1');

      // 各自应发起独立请求
      expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    });

    it('should invalidate cache when calling PUT', async () => {
      const pageData = { page: { slug: 'test' }, content: '# Test', mtime: 123 };
      const updatedMtime = { mtime: 456 };

      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        callCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: pageData }),
        };
      });

      const { getPage, putPage } = await import('../../src/services/api');

      // 首次 GET 请求
      await getPage('proj1', 'v1', 'test-slug');
      expect(callCount).toBe(1);

      // 第二次 GET 应使用缓存
      await getPage('proj1', 'v1', 'test-slug');
      expect(callCount).toBe(1);

      // 设置 PUT 请求的 mock
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: updatedMtime }),
        };
      });

      // PUT 请求
      await putPage('proj1', 'v1', 'test-slug', 'new content');
      expect(callCount).toBe(2);

      // 设置 PUT 之后 GET 请求的 mock
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: pageData }),
        };
      });

      // PUT 之后 GET 应重新请求（缓存已失效）
      await getPage('proj1', 'v1', 'test-slug');
      expect(callCount).toBe(3);
    });
  });

  // ===== 请求处理测试 =====
  describe('Request Processing', () => {
    it('should correctly construct request URL with API_BASE prefix', async () => {
      const mock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: [] }),
      });
      global.fetch = mock;

      const { getProjects } = await import('../../src/services/api');
      await getProjects();

      expect(mock).toHaveBeenCalledWith(
        '/api/projects',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('should handle network errors and throw', async () => {
      mockFetchNetworkError();

      const { getProjects } = await import('../../src/services/api');

      await expect(getProjects()).rejects.toThrow();
    });

    it('should handle API error response', async () => {
      mockFetchError('Project not found', 'NOT_FOUND', 404);

      const { getWiki } = await import('../../src/services/api');

      await expect(getWiki('invalid-id')).rejects.toThrow('Project not found');
    });

    it('should handle 5xx server errors', async () => {
      mockFetchServerError('Database connection failed');

      const { getProjects } = await import('../../src/services/api');

      await expect(getProjects()).rejects.toThrow('Database connection failed');
    });

    it('should encode URL parameters correctly', async () => {
      const mock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { id: 'test' } }),
      });
      global.fetch = mock;

      const { getWiki, getPage, searchProject } = await import('../../src/services/api');

      // 测试特殊字符
      await getWiki('project with spaces');
      expect(mock).toHaveBeenCalledWith(
        expect.stringContaining('project%20with%20spaces'),
        expect.anything(),
      );

      mock.mockClear();

      await getPage('proj-1', 'v1.0', 'slug/with/slashes');
      expect(mock).toHaveBeenCalledWith(
        expect.stringContaining('proj-1'),
        expect.anything(),
      );

      mock.mockClear();

      await searchProject('proj-1', 'search query?');
      expect(mock).toHaveBeenCalledWith(
        expect.stringContaining('search%20query%3F'),
        expect.anything(),
      );
    });

    it('should send JSON body in PUT requests', async () => {
      const mock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { mtime: 123 } }),
      });
      global.fetch = mock;

      const { putPage } = await import('../../src/services/api');
      await putPage('proj1', 'v1', 'slug', 'new content', 100);

      expect(mock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ content: 'new content', expectedMtime: 100 }),
        }),
      );
    });
  });

  // ===== API 方法测试 =====
  describe('API Methods', () => {
    describe('getProjects', () => {
      it('should return list of projects', async () => {
        const projects = [
          { id: 'proj1', name: 'Project 1', path: '/path/1', wikiPath: '/path/1/.zread/wiki', currentVersion: 'v1', isActive: true, addedAt: 1000 },
          { id: 'proj2', name: 'Project 2', path: '/path/2', wikiPath: '/path/2/.zread/wiki', currentVersion: 'v2', isActive: true, addedAt: 2000 },
        ];

        mockFetchSuccess(projects);

        const { getProjects } = await import('../../src/services/api');
        const result = await getProjects();

        expect(result).toEqual(projects);
      });
    });

    describe('getWiki', () => {
      it('should return wiki data for a project', async () => {
        const wikiData = {
          id: 'wiki-1',
          generated_at: '2026-04-17T00:00:00Z',
          language: 'zh',
          pages: [
            { slug: 'index', title: 'Home', file: 'index.md', section: 'Main', level: 'Beginner' as const },
          ],
        };

        mockFetchSuccess(wikiData);

        const { getWiki } = await import('../../src/services/api');
        const result = await getWiki('project-1');

        expect(result).toEqual(wikiData);
      });
    });

    describe('getPage', () => {
      it('should return page content', async () => {
        const pageData = {
          page: { slug: 'test', title: 'Test Page', file: 'test.md', section: 'Main', level: 'Beginner' as const },
          content: '# Test Page\n\nContent here.',
          mtime: 1713398400000,
        };

        mockFetchSuccess(pageData);

        const { getPage } = await import('../../src/services/api');
        const result = await getPage('proj1', 'v1', 'test');

        expect(result).toEqual(pageData);
      });
    });

    describe('putPage', () => {
      it('should update page content', async () => {
        const newMtime = Date.now();
        mockFetchSuccess({ mtime: newMtime });

        const { putPage } = await import('../../src/services/api');
        const result = await putPage('proj1', 'v1', 'test', '# Updated Content');

        expect(result).toEqual({ mtime: newMtime });
      });

      it('should send expectedMtime for conflict detection', async () => {
        const mock = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { mtime: 1234567890 } }),
        });
        global.fetch = mock;

        const { putPage } = await import('../../src/services/api');
        await putPage('proj1', 'v1', 'test', 'content', 123456789);

        const callArgs = mock.mock.calls[0][1];
        const body = JSON.parse(callArgs.body);
        expect(body.expectedMtime).toBe(123456789);
      });
    });

    describe('searchProject', () => {
      it('should return search results', async () => {
        const searchResults = [
          {
            projectId: 'proj1',
            projectName: 'Project 1',
            page: { slug: 'test', title: 'Test', file: 'test.md', section: 'Main', level: 'Beginner' as const },
            content: 'matching content',
            matchType: 'content' as const,
            score: 0.95,
          },
        ];

        mockFetchSuccess(searchResults);

        const { searchProject } = await import('../../src/services/api');
        const result = await searchProject('proj1', 'query');

        expect(result).toEqual(searchResults);
      });

      it('should not cache search results', async () => {
        mockFetchSuccess([]);

        const { searchProject } = await import('../../src/services/api');

        await searchProject('proj1', 'query1');
        await searchProject('proj1', 'query2');

        // 搜索不应缓存（不同查询）
        expect((global.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
      });
    });

    describe('getConfig', () => {
      it('should return app configuration', async () => {
        const config = {
          scanPaths: ['/home/user/projects'],
          projects: [],
          theme: 'light' as const,
        };

        mockFetchSuccess(config);

        const { getConfig } = await import('../../src/services/api');
        const result = await getConfig();

        expect(result).toEqual(config);
      });
    });

    describe('updateConfig', () => {
      it('should update configuration', async () => {
        const updatedConfig = {
          scanPaths: ['/home/user/projects'],
          projects: [],
          theme: 'dark' as const,
        };

        mockFetchSuccess(updatedConfig);

        const { updateConfig } = await import('../../src/services/api');
        const result = await updateConfig({ theme: 'dark' });

        expect(result).toEqual(updatedConfig);
      });

      it('should invalidate config cache after update', async () => {
        const config1 = { scanPaths: [], projects: [], theme: 'light' as const };
        const config2 = { scanPaths: [], projects: [], theme: 'dark' as const };

        let callCount = 0;
        global.fetch = vi.fn().mockImplementation(async (_url: string, options?: RequestInit) => {
          callCount++;
          const isPut = options?.method === 'PUT';
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: isPut ? config2 : config1 }),
          };
        });

        const { getConfig, updateConfig } = await import('../../src/services/api');

        // 首次 GET
        await getConfig();
        expect(callCount).toBe(1);

        // 第二次 GET 使用缓存
        await getConfig();
        expect(callCount).toBe(1);

        // PUT 更新
        await updateConfig({ theme: 'dark' });
        expect(callCount).toBe(2);

        // PUT 之后 GET 不应使用缓存
        await getConfig();
        expect(callCount).toBe(3);
      });
    });

    describe('addProject', () => {
      it('should add a new project', async () => {
        const newProject = {
          id: 'new-proj',
          name: 'New Project',
          path: '/path/to/new',
          wikiPath: '/path/to/new/.zread/wiki',
          currentVersion: 'v1',
          isActive: true,
          addedAt: Date.now(),
        };

        mockFetchSuccess(newProject);

        const { addProject } = await import('../../src/services/api');
        const result = await addProject('/path/to/new');

        expect(result).toEqual(newProject);
      });
    });

    describe('deleteProject', () => {
      it('should delete a project', async () => {
        mockFetchSuccess({ id: 'deleted-proj' });

        const { deleteProject } = await import('../../src/services/api');
        const result = await deleteProject('deleted-proj');

        expect(result).toEqual({ id: 'deleted-proj' });
      });
    });

    describe('triggerScan', () => {
      it('should trigger a scan', async () => {
        const projects = [
          { id: 'proj1', name: 'Project 1', path: '/path/1' },
        ];

        mockFetchSuccess(projects);

        const { triggerScan } = await import('../../src/services/api');
        const result = await triggerScan();

        expect(result).toEqual(projects);
      });
    });

    describe('getScanStatus', () => {
      it('should return scan status', async () => {
        const status = {
          scanning: true,
          progress: { total: 100, scanned: 50, found: 10 },
          lastScanAt: Date.now(),
        };

        mockFetchSuccess(status);

        const { getScanStatus } = await import('../../src/services/api');
        const result = await getScanStatus();

        expect(result).toEqual(status);
      });
    });

    describe('getFileContent', () => {
      it('should return file content', async () => {
        const fileContent = {
          path: '/path/to/file.ts',
          totalLines: 100,
          lines: [
            { lineNumber: 1, content: 'line 1', highlighted: false },
            { lineNumber: 2, content: 'line 2', highlighted: true },
          ],
        };

        mockFetchSuccess(fileContent);

        const { getFileContent } = await import('../../src/services/api');
        const result = await getFileContent('/path/to/file.ts', 1, 10);

        expect(result).toEqual(fileContent);
      });

      it('should include line range parameters in URL', async () => {
        const mock = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { path: '', totalLines: 0, lines: [] } }),
        });
        global.fetch = mock;

        const { getFileContent } = await import('../../src/services/api');
        await getFileContent('/path/to/file.ts', 10, 20);

        expect(mock).toHaveBeenCalledWith(
          expect.stringContaining('startLine=10'),
          expect.anything(),
        );
        expect(mock).toHaveBeenCalledWith(
          expect.stringContaining('endLine=20'),
          expect.anything(),
        );
      });
    });

    describe('refreshProjectCache', () => {
      it('应调用 POST /projects/:id/refresh-cache 并返回结果', async () => {
        const refreshResult = {
          wikiDataCleared: true,
          wikiDataReloaded: true,
          searchIndexUpdated: true,
        };

        const mock = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: refreshResult }),
        });
        global.fetch = mock;

        const { refreshProjectCache } = await import('../../src/services/api');
        const result = await refreshProjectCache('test-project');

        expect(result).toEqual(refreshResult);
        expect(mock).toHaveBeenCalledWith(
          expect.stringContaining('/projects/test-project/refresh-cache'),
          expect.objectContaining({ method: 'POST' }),
        );
      });

      it('应在 API 成功后清除客户端 HTTP 缓存', async () => {
        const refreshResult = {
          wikiDataCleared: true,
          wikiDataReloaded: true,
          searchIndexUpdated: true,
        };

        let callCount = 0;
        global.fetch = vi.fn().mockImplementation(async (url: string) => {
          callCount++;
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: url.includes('/wiki/') ? { pages: [] } : refreshResult }),
          };
        });

        const { getWiki, refreshProjectCache } = await import('../../src/services/api');

        // 先发起 GET 请求建立缓存
        await getWiki('test-project');
        expect(callCount).toBe(1);

        // 第二次 GET 应使用缓存
        await getWiki('test-project');
        expect(callCount).toBe(1);

        // 刷新缓存
        await refreshProjectCache('test-project');
        expect(callCount).toBe(2);

        // 刷新后 GET 应重新请求
        await getWiki('test-project');
        expect(callCount).toBe(3);
      });

      it('应正确编码项目 ID 中的特殊字符', async () => {
        const refreshResult = {
          wikiDataCleared: true,
          wikiDataReloaded: true,
          searchIndexUpdated: true,
        };

        const mock = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: refreshResult }),
        });
        global.fetch = mock;

        const { refreshProjectCache } = await import('../../src/services/api');
        await refreshProjectCache('project with spaces');

        expect(mock).toHaveBeenCalledWith(
          expect.stringContaining('project%20with%20spaces'),
          expect.anything(),
        );
      });
    });
  });
});

// ===== 401 自动重定向测试 =====
/**
 * @vitest-environment jsdom
 */
describe('401 Auto-Redirect', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // 模拟 window.location.reload
    Object.defineProperty(window, 'location', {
      value: { reload: vi.fn(), href: '' },
      writable: true,
    });
  });

  it('should trigger page reload on 401 response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ success: false, error: { code: 'UNAUTHORIZED', message: '未授权访问' } }),
    });

    const { getProjects } = await import('../../src/services/api');

    // getProjects 应触发重载并返回一个永不 resolve 的 Promise
    getProjects();

    // 等待微任务完成
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(window.location.reload).toHaveBeenCalled();
  });

  it('should prevent concurrent reloads on multiple 401 responses', async () => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        ok: false,
        status: 401,
        json: async () => ({ success: false, error: { code: 'UNAUTHORIZED', message: '未授权' } }),
      };
    });

    const { getProjects, getConfig } = await import('../../src/services/api');

    // 并发发起多个请求（抑制第二个 401 的未处理 rejection）
    getProjects().catch(() => {});
    getConfig().catch(() => {});

    await new Promise(resolve => setTimeout(resolve, 10));

    // 尽管有多个 401，reload 应只调用一次
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('should not reload on non-401 errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Server error' } }),
    });

    const { getProjects } = await import('../../src/services/api');

    await expect(getProjects()).rejects.toThrow('Server error');

    expect(window.location.reload).not.toHaveBeenCalled();
  });
});