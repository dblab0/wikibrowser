/**
 * Projects Routes Tests
 * 测试 POST /api/projects/:id/refresh-cache 路由
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Response } from 'express';

// Mock 依赖模块
vi.mock('../../src/services/config.js', () => ({
  getProjectById: vi.fn(),
}));

vi.mock('../../src/services/search-index.js', () => ({
  indexProject: vi.fn(),
  clearProjectIndex: vi.fn(),
}));

vi.mock('../../src/services/wiki-loader.js', () => ({
  readCurrentPointer: vi.fn(),
  loadWikiJson: vi.fn(),
}));

vi.mock('../../src/services/cache.js', () => {
  const LRUCache = class<T> {
    private map = new Map<string, { data: T; expiry: number }>();
    get(key: string): T | null { const entry = this.map.get(key); return entry ? entry.data : null; }
    set(key: string, data: T) { this.map.set(key, { data, expiry: Date.now() + 300000 }); }
    delete(key: string) { this.map.delete(key); }
    has(key: string) { return this.map.has(key); }
    clear() { this.map.clear(); }
    invalidatePattern(prefix: string) {
      if (!prefix) return;
      for (const key of this.map.keys()) {
        if (key.startsWith(prefix)) this.map.delete(key);
      }
    }
  };
  return {
    wikiDataCache: new LRUCache<any>(),
    pageContentCache: new LRUCache<string>(),
    LRUCache,
  };
});

import * as configService from '../../src/services/config.js';
import * as searchIndex from '../../src/services/search-index.js';
import * as wikiLoader from '../../src/services/wiki-loader.js';
import { wikiDataCache, pageContentCache } from '../../src/services/cache.js';
import { projectsRouter } from '../../src/routes/projects.js';
import type { ProjectConfig } from '../../../shared/types/index.js';

/** 创建 mock Response 对象 */
function createMockResponse() {
  const res: any = {
    _status: 200,
    _json: null,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: any) {
      res._json = data;
      return res;
    },
  };
  return res;
}

/** 创建 mock next 函数 */
function createMockNext() {
  return vi.fn();
}

describe('POST /api/projects/:id/refresh-cache', () => {
  const mockProject: ProjectConfig = {
    id: 'test-project',
    name: 'Test Project',
    path: '/test/project',
    wikiPath: '/test/project/.zread/wiki',
    currentVersion: '2026-04-16-220440',
    isActive: true,
    addedAt: Date.now(),
  };

  const mockOtherProject: ProjectConfig = {
    id: 'other-project',
    name: 'Other Project',
    path: '/other/project',
    wikiPath: '/other/project/.zread/wiki',
    currentVersion: '2026-04-15-120000',
    isActive: false,
    addedAt: Date.now(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    wikiDataCache.clear();
    pageContentCache.clear();
  });

  /** 查找 refresh-cache 路由的 handler */
  function findRefreshCacheHandler() {
    const handler = projectsRouter.stack.find(
      (layer: any) => layer.route && layer.route.path === '/:id/refresh-cache' && layer.route.methods.post,
    );
    expect(handler).toBeDefined();
    return handler.route.stack[0].handle;
  }

  it('成功刷新存在项目的缓存', async () => {
    vi.mocked(configService.getProjectById).mockReturnValue(mockProject);
    vi.mocked(wikiLoader.readCurrentPointer).mockReturnValue('2026-04-16-220440');
    vi.mocked(wikiLoader.loadWikiJson).mockResolvedValue({ pages: [] } as any);
    vi.mocked(searchIndex.indexProject).mockResolvedValue();

    const req = { params: { id: 'test-project' } } as any;
    const res = createMockResponse();
    const next = createMockNext();

    await findRefreshCacheHandler()(req, res, next);

    expect(configService.getProjectById).toHaveBeenCalledWith('test-project');
    expect(res._json).toEqual({
      success: true,
      data: {
        wikiDataCleared: true,
        wikiDataReloaded: true,
        searchIndexUpdated: true,
      },
    });
  });

  it('项目不存在时返回 404 错误', async () => {
    vi.mocked(configService.getProjectById).mockReturnValue(undefined);

    const req = { params: { id: 'nonexistent' } } as any;
    const res = createMockResponse();
    const next = createMockNext();

    await findRefreshCacheHandler()(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('刷新后 wikiDataCache 缓存被清除并重新加载', async () => {
    vi.mocked(configService.getProjectById).mockReturnValue(mockProject);
    vi.mocked(wikiLoader.readCurrentPointer).mockReturnValue('2026-04-16-220440');
    vi.mocked(wikiLoader.loadWikiJson).mockResolvedValue({ pages: [] } as any);
    vi.mocked(searchIndex.indexProject).mockResolvedValue();

    // 预置缓存数据
    wikiDataCache.set('/test/project/.zread/wiki:2026-04-16-220440', { pages: [] } as any);
    wikiDataCache.set('/other/project/.zread/wiki:2026-04-15-120000', { pages: [] } as any);

    const req = { params: { id: 'test-project' } } as any;
    const res = createMockResponse();
    const next = createMockNext();

    await findRefreshCacheHandler()(req, res, next);

    // 该项目缓存应被清除
    expect(wikiDataCache.get('/test/project/.zread/wiki:2026-04-16-220440')).toBeNull();
    // 其他项目缓存不受影响
    expect(wikiDataCache.get('/other/project/.zread/wiki:2026-04-15-120000')).not.toBeNull();

    // 应重新加载 wiki.json
    expect(wikiLoader.loadWikiJson).toHaveBeenCalledWith('/test/project/.zread/wiki', '2026-04-16-220440');
  });

  it('刷新后 pageContentCache 缓存被清除', async () => {
    vi.mocked(configService.getProjectById).mockReturnValue(mockProject);
    vi.mocked(wikiLoader.readCurrentPointer).mockReturnValue('2026-04-16-220440');
    vi.mocked(wikiLoader.loadWikiJson).mockResolvedValue({ pages: [] } as any);
    vi.mocked(searchIndex.indexProject).mockResolvedValue();

    // 预置页面缓存
    pageContentCache.set('/test/project/.zread/wiki:2026-04-16-220440:page1.md', 'content1');
    pageContentCache.set('/other/project/.zread/wiki:2026-04-15-120000:page2.md', 'content2');

    const req = { params: { id: 'test-project' } } as any;
    const res = createMockResponse();
    const next = createMockNext();

    await findRefreshCacheHandler()(req, res, next);

    // 该项目页面缓存应被清除
    expect(pageContentCache.get('/test/project/.zread/wiki:2026-04-16-220440:page1.md')).toBeNull();
    // 其他项目页面缓存不受影响
    expect(pageContentCache.get('/other/project/.zread/wiki:2026-04-15-120000:page2.md')).not.toBeNull();
  });

  it('刷新后搜索索引被重建', async () => {
    vi.mocked(configService.getProjectById).mockReturnValue(mockProject);
    vi.mocked(wikiLoader.readCurrentPointer).mockReturnValue('2026-04-16-220440');
    vi.mocked(wikiLoader.loadWikiJson).mockResolvedValue({ pages: [] } as any);
    vi.mocked(searchIndex.indexProject).mockResolvedValue();

    const req = { params: { id: 'test-project' } } as any;
    const res = createMockResponse();
    const next = createMockNext();

    await findRefreshCacheHandler()(req, res, next);

    // 应以 rebuild=true 调用 indexProject
    expect(searchIndex.indexProject).toHaveBeenCalledWith(mockProject, true);
  });

  it('不影响其他项目的缓存', async () => {
    vi.mocked(configService.getProjectById).mockReturnValue(mockProject);
    vi.mocked(wikiLoader.readCurrentPointer).mockReturnValue('2026-04-16-220440');
    vi.mocked(wikiLoader.loadWikiJson).mockResolvedValue({ pages: [] } as any);
    vi.mocked(searchIndex.indexProject).mockResolvedValue();

    // 预置其他项目缓存
    wikiDataCache.set('/other/project/.zread/wiki:2026-04-15-120000', { pages: [] } as any);
    pageContentCache.set('/other/project/.zread/wiki:2026-04-15-120000:page.md', 'other content');

    const req = { params: { id: 'test-project' } } as any;
    const res = createMockResponse();
    const next = createMockNext();

    await findRefreshCacheHandler()(req, res, next);

    // 其他项目缓存应保持不变
    expect(wikiDataCache.get('/other/project/.zread/wiki:2026-04-15-120000')).not.toBeNull();
    expect(pageContentCache.get('/other/project/.zread/wiki:2026-04-15-120000:page.md')).toBe('other content');
  });

  it('readCurrentPointer 返回 null 时使用 project.currentVersion', async () => {
    vi.mocked(configService.getProjectById).mockReturnValue(mockProject);
    vi.mocked(wikiLoader.readCurrentPointer).mockReturnValue(null);
    vi.mocked(wikiLoader.loadWikiJson).mockResolvedValue({ pages: [] } as any);
    vi.mocked(searchIndex.indexProject).mockResolvedValue();

    const req = { params: { id: 'test-project' } } as any;
    const res = createMockResponse();
    const next = createMockNext();

    await findRefreshCacheHandler()(req, res, next);

    // 应使用 project.currentVersion 作为回退
    expect(wikiLoader.loadWikiJson).toHaveBeenCalledWith('/test/project/.zread/wiki', '2026-04-16-220440');
  });
});
