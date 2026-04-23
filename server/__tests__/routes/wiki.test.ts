/**
 * Wiki Routes Tests
 * Tests for GET /api/wiki/:projectId/versions endpoint
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Response } from 'express';

// Mock configService and wikiLoader before importing the router
vi.mock('../../src/services/config.js', () => ({
  getProjectById: vi.fn(),
}));

vi.mock('../../src/services/wiki-loader.js', () => ({
  listVersions: vi.fn(),
  loadWikiJson: vi.fn(),
  getPageBySlug: vi.fn(),
  resolvePageFilePath: vi.fn(),
  savePageMarkdown: vi.fn(),
}));

vi.mock('../../src/services/cache.js', () => {
  const LRUCache = class<T> {
    private map = new Map<string, { data: T; expiry: number }>();
    get(key: string) { return this.map.get(key)?.data; }
    set(key: string, data: T) { this.map.set(key, { data, expiry: Date.now() + 300000 }); }
    delete(key: string) { this.map.delete(key); }
    has(key: string) { return this.map.has(key); }
    clear() { this.map.clear(); }
    invalidate(prefix: string) { for (const key of this.map.keys()) { if (key.includes(prefix)) this.map.delete(key); } }
  };
  return {
    wikiDataCache: new LRUCache<any>(),
    pageContentCache: new LRUCache<string>(),
    LRUCache,
  };
});

import * as configService from '../../src/services/config.js';
import * as wikiLoader from '../../src/services/wiki-loader.js';
import { wikiRouter } from '../../src/routes/wiki.js';
import type { ProjectConfig, WikiVersion } from '../../../shared/types/index.js';

// Helper to create mock response
function createMockResponse(): Response & { json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } {
  const res: any = {
    _status: 200,
    _json: null,
    _headers: {},
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: any) {
      res._json = data;
      return res;
    },
    set(headers: Record<string, string>) {
      Object.assign(res._headers, headers);
      return res;
    },
    end() {
      return res;
    },
  };
  return res;
}

// Helper to create mock next
function createMockNext() {
  return vi.fn();
}

describe('GET /api/wiki/:projectId/versions', () => {
  const mockProject: ProjectConfig = {
    id: 'test-project',
    name: 'Test Project',
    path: '/test/project',
    wikiPath: '/test/project/.zread/wiki',
    currentVersion: '2026-04-16-220440',
    isActive: true,
    addedAt: Date.now(),
  };

  const mockVersions: WikiVersion[] = [
    { version: '2026-04-16-220440', generatedAt: '2026-04-16T22:04:40Z', pageCount: 10, isCurrent: true },
    { version: '2026-04-15-120000', generatedAt: '2026-04-15T12:00:00Z', pageCount: 8, isCurrent: false },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应返回版本列表 JSON', async () => {
    vi.mocked(configService.getProjectById).mockReturnValue(mockProject);
    vi.mocked(wikiLoader.listVersions).mockReturnValue(mockVersions);

    const req = { params: { projectId: 'test-project' } } as any;
    const res = createMockResponse();
    const next = createMockNext();

    // Find the versions route handler
    const handler = wikiRouter.stack.find(
      (layer: any) => layer.route && layer.route.path === '/:projectId/versions' && layer.route.methods.get,
    );
    expect(handler).toBeDefined();

    await handler.route.stack[0].handle(req, res, next);

    expect(configService.getProjectById).toHaveBeenCalledWith('test-project');
    expect(wikiLoader.listVersions).toHaveBeenCalledWith('/test/project/.zread/wiki');
    expect(res._json).toEqual({
      success: true,
      data: mockVersions,
    });
  });

  it('projectId 不存在时应调用 next 并传递 404 错误', async () => {
    vi.mocked(configService.getProjectById).mockReturnValue(undefined);

    const req = { params: { projectId: 'nonexistent' } } as any;
    const res = createMockResponse();
    const next = createMockNext();

    const handler = wikiRouter.stack.find(
      (layer: any) => layer.route && layer.route.path === '/:projectId/versions' && layer.route.methods.get,
    );

    await handler.route.stack[0].handle(req, res, next);

    expect(next).toHaveBeenCalled();
    const error = next.mock.calls[0][0];
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('版本列表中应正确标记 isCurrent', async () => {
    vi.mocked(configService.getProjectById).mockReturnValue(mockProject);
    vi.mocked(wikiLoader.listVersions).mockReturnValue(mockVersions);

    const req = { params: { projectId: 'test-project' } } as any;
    const res = createMockResponse();
    const next = createMockNext();

    const handler = wikiRouter.stack.find(
      (layer: any) => layer.route && layer.route.path === '/:projectId/versions' && layer.route.methods.get,
    );

    await handler.route.stack[0].handle(req, res, next);

    const data = res._json.data as WikiVersion[];
    const currentVersion = data.find((v) => v.isCurrent);
    const otherVersion = data.find((v) => !v.isCurrent);

    expect(currentVersion).toBeDefined();
    expect(currentVersion!.version).toBe('2026-04-16-220440');
    expect(currentVersion!.isCurrent).toBe(true);
    expect(otherVersion).toBeDefined();
    expect(otherVersion!.isCurrent).toBe(false);
  });
});
