/**
 * App Store 测试
 *
 * 测试 useAppStore 的核心功能，包括项目管理、UI 状态、编辑模式、Wiki 数据等
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from '../../src/stores/app';
import * as api from '../../src/services/api';
import type { ProjectConfig, WikiData, AppConfig, SearchResult } from '@shared/types';
import type { CurrentView } from '../../src/types';

// Mock api 模块
vi.mock('../../src/services/api', () => ({
  putPage: vi.fn(),
  getPage: vi.fn(),
  getWiki: vi.fn(),
}));

/**
 * 创建 Mock 项目配置
 *
 * @param overrides - 需要覆盖的部分字段
 * @returns 完整的 ProjectConfig 对象
 */
function createMockProject(overrides?: Partial<ProjectConfig>): ProjectConfig {
  return {
    id: overrides?.id ?? 'project-1',
    name: overrides?.name ?? 'Test Project',
    path: overrides?.path ?? '/test/path',
    wikiPath: overrides?.wikiPath ?? '/test/path/.zread/wiki',
    currentVersion: overrides?.currentVersion ?? 'main',
    isActive: overrides?.isActive ?? true,
    addedAt: overrides?.addedAt ?? Date.now(),
  };
}

/**
 * 创建 Mock 应用配置
 *
 * @param overrides - 需要覆盖的部分字段
 * @returns 完整的 AppConfig 对象
 */
function createMockConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    scanPaths: overrides?.scanPaths ?? ['/test'],
    projects: overrides?.projects ?? [createMockProject()],
    theme: overrides?.theme ?? 'dark',
    lastOpenedProject: overrides?.lastOpenedProject ?? 'project-1',
    projectSessions: overrides?.projectSessions ?? {},
    logRetentionDays: overrides?.logRetentionDays ?? 7,
    aiPromptTimeout: overrides?.aiPromptTimeout ?? 10,
    yolo: overrides?.yolo ?? false,
  };
}

/**
 * 创建 Mock Wiki 数据
 *
 * @returns 包含示例页面的 WikiData 对象
 */
function createMockWikiData(): WikiData {
  return {
    id: 'wiki-1',
    generated_at: '2026-04-17T00:00:00Z',
    language: 'zh',
    pages: [
      {
        slug: 'intro',
        title: 'Introduction',
        file: 'intro.md',
        section: 'Getting Started',
        group: 'Basics',
        level: 'Beginner',
      },
    ],
  };
}

/**
 * 创建 Mock 当前视图
 *
 * @param overrides - 需要覆盖的部分字段
 * @returns 完整的 CurrentView 对象
 */
function createMockCurrentView(overrides?: Partial<CurrentView>): CurrentView {
  return {
    projectId: overrides?.projectId ?? 'project-1',
    version: overrides?.version ?? 'main',
    slug: overrides?.slug ?? 'intro',
    content: overrides?.content ?? '# Introduction\n\nThis is the introduction.',
    loading: overrides?.loading ?? false,
    error: overrides?.error,
    mode: overrides?.mode ?? 'read',
    editContent: overrides?.editContent ?? null,
    isDirty: overrides?.isDirty ?? false,
    fileMtime: overrides?.fileMtime ?? null,
    conflictData: overrides?.conflictData ?? null,
  };
}

/**
 * 创建 Mock 搜索结果
 *
 * @returns 包含示例数据的 SearchResult 对象
 */
function createMockSearchResult(): SearchResult {
  return {
    projectId: 'project-1',
    projectName: 'Test Project',
    page: {
      slug: 'intro',
      title: 'Introduction',
      file: 'intro.md',
      section: 'Getting Started',
      level: 'Beginner',
    },
    content: 'Sample content',
    matchType: 'content',
    score: 0.9,
  };
}

describe('useAppStore', () => {
  beforeEach(() => {
    // 每个测试前重置 store 到初始状态
    useAppStore.getState().reset();
    // 清除所有 Mock
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = useAppStore.getState();

      expect(state.projects).toEqual([]);
      expect(state.config).toBe(null);
      expect(state.currentWiki).toBe(null);
      expect(state.currentView).toBe(null);
      expect(state.sidebarOpen).toBe(true);
      expect(state.settingsOpen).toBe(false);
      expect(state.searchOpen).toBe(false);
      expect(state.searchQuery).toBe('');
      expect(state.searchResults).toEqual([]);
      expect(state.expandedSections).toEqual([]);
      expect(state.expandedGroups).toEqual([]);
      expect(state.referenceOpen).toBe(false);
      expect(state.referenceData).toBe(null);
      expect(state.mermaidViewerOpen).toBe(false);
      expect(state.mermaidViewerData).toBe(null);
      expect(state.loadingWiki).toBe(false);
      expect(state.loadingPage).toBe(false);
      expect(state.loadingProjects).toBe(false);
    });
  });

  describe('项目管理', () => {
    it('should setProjects update project list', () => {
      const store = useAppStore.getState();
      const projects = [
        createMockProject({ id: 'project-1', name: 'Project 1' }),
        createMockProject({ id: 'project-2', name: 'Project 2' }),
      ];

      store.setProjects(projects);
      expect(useAppStore.getState().projects).toEqual(projects);
    });

    it('should setProjects replace existing projects', () => {
      const store = useAppStore.getState();
      const initialProjects = [createMockProject({ id: 'old-project' })];
      const newProjects = [createMockProject({ id: 'new-project' })];

      store.setProjects(initialProjects);
      store.setProjects(newProjects);

      expect(useAppStore.getState().projects).toEqual(newProjects);
    });

    it('should setCurrentProject update lastOpenedProject in config', () => {
      const store = useAppStore.getState();
      const config = createMockConfig({ lastOpenedProject: 'project-1' });

      store.setConfig(config);
      store.setCurrentProject('project-2');

      const state = useAppStore.getState();
      expect(state.config?.lastOpenedProject).toBe('project-2');
    });

    it('should setCurrentProject not modify state if config is null', () => {
      const store = useAppStore.getState();

      // config 初始为 null
      expect(store.config).toBe(null);

      store.setCurrentProject('project-1');

      // config 仍应为 null
      expect(useAppStore.getState().config).toBe(null);
    });

    it('should setConfig update config state', () => {
      const store = useAppStore.getState();
      const config = createMockConfig();

      store.setConfig(config);
      expect(useAppStore.getState().config).toEqual(config);
    });
  });

  describe('UI 状态', () => {
    it('should toggleSidebar toggle sidebar open state', () => {
      const store = useAppStore.getState();

      expect(store.sidebarOpen).toBe(true);

      store.toggleSidebar();
      expect(useAppStore.getState().sidebarOpen).toBe(false);

      store.toggleSidebar();
      expect(useAppStore.getState().sidebarOpen).toBe(true);
    });

    it('should setSidebarOpen set specific sidebar state', () => {
      const store = useAppStore.getState();

      store.setSidebarOpen(false);
      expect(useAppStore.getState().sidebarOpen).toBe(false);

      store.setSidebarOpen(true);
      expect(useAppStore.getState().sidebarOpen).toBe(true);
    });

    it('should toggleSearch toggle search modal state', () => {
      const store = useAppStore.getState();

      expect(store.searchOpen).toBe(false);

      store.toggleSearch();
      expect(useAppStore.getState().searchOpen).toBe(true);

      store.toggleSearch();
      expect(useAppStore.getState().searchOpen).toBe(false);
    });

    it('should setSearchOpen clear query and results when closing', () => {
      const store = useAppStore.getState();

      // 先设置一些搜索状态
      store.setSearchOpen(true);
      store.setSearchQuery('test query');
      store.setSearchResults([createMockSearchResult()]);

      // 关闭搜索
      store.setSearchOpen(false);

      const state = useAppStore.getState();
      expect(state.searchOpen).toBe(false);
      expect(state.searchQuery).toBe('');
      expect(state.searchResults).toEqual([]);
    });

    it('should setSearchOpen preserve query and results when opening', () => {
      const store = useAppStore.getState();

      // 打开前先设置查询和结果
      store.setSearchQuery('test query');
      store.setSearchResults([createMockSearchResult()]);

      // 打开搜索
      store.setSearchOpen(true);

      const state = useAppStore.getState();
      expect(state.searchOpen).toBe(true);
      expect(state.searchQuery).toBe('test query');
      expect(state.searchResults.length).toBe(1);
    });

    it('should setSearchQuery update search query', () => {
      const store = useAppStore.getState();

      store.setSearchQuery('new query');
      expect(useAppStore.getState().searchQuery).toBe('new query');
    });

    it('should setSearchResults update search results', () => {
      const store = useAppStore.getState();
      const results = [createMockSearchResult()];

      store.setSearchResults(results);
      expect(useAppStore.getState().searchResults).toEqual(results);
    });

    it('should toggleSettings toggle settings panel state', () => {
      const store = useAppStore.getState();

      expect(store.settingsOpen).toBe(false);

      store.toggleSettings();
      expect(useAppStore.getState().settingsOpen).toBe(true);

      store.toggleSettings();
      expect(useAppStore.getState().settingsOpen).toBe(false);
    });

    it('should setSettingsOpen set specific settings state', () => {
      const store = useAppStore.getState();

      store.setSettingsOpen(true);
      expect(useAppStore.getState().settingsOpen).toBe(true);

      store.setSettingsOpen(false);
      expect(useAppStore.getState().settingsOpen).toBe(false);
    });
  });

  describe('编辑模式', () => {
    beforeEach(() => {
      const store = useAppStore.getState();
      store.setCurrentView(createMockCurrentView());
    });

    it('should setEditMode enter edit mode with current content', () => {
      const store = useAppStore.getState();
      const content = '# Test Content';

      store.setCurrentView(createMockCurrentView({ content }));
      store.setEditMode();

      const state = useAppStore.getState();
      expect(state.currentView?.mode).toBe('edit');
      expect(state.currentView?.editContent).toBe(content);
      expect(state.currentView?.isDirty).toBe(false);
    });

    it('should setEditMode not modify state if currentView is null', () => {
      const store = useAppStore.getState();

      // 重置以清除 currentView
      store.reset();

      store.setEditMode();

      expect(useAppStore.getState().currentView).toBe(null);
    });

    it('should setReadMode exit edit mode', () => {
      const store = useAppStore.getState();
      const originalContent = '# Original';

      // 先进入编辑模式
      store.setCurrentView(createMockCurrentView({ content: originalContent }));
      store.setEditMode();
      store.updateEditContent('# Modified');

      // 退出编辑模式
      store.setReadMode();

      const state = useAppStore.getState();
      expect(state.currentView?.mode).toBe('read');
      expect(state.currentView?.editContent).toBe(null);
      expect(state.currentView?.isDirty).toBe(false);
      // 内容应保持原始版本
      expect(state.currentView?.content).toBe(originalContent);
    });

    it('should setReadMode not modify state if currentView is null', () => {
      const store = useAppStore.getState();

      store.reset();
      store.setReadMode();

      expect(useAppStore.getState().currentView).toBe(null);
    });

    it('should updateEditContent update edit content and mark dirty', () => {
      const store = useAppStore.getState();
      const originalContent = '# Original';

      store.setCurrentView(createMockCurrentView({ content: originalContent }));
      store.setEditMode();
      store.updateEditContent('# Modified');

      const state = useAppStore.getState();
      expect(state.currentView?.editContent).toBe('# Modified');
      expect(state.currentView?.isDirty).toBe(true);
    });

    it('should updateEditContent not mark dirty if content unchanged', () => {
      const store = useAppStore.getState();
      const originalContent = '# Original';

      store.setCurrentView(createMockCurrentView({ content: originalContent }));
      store.setEditMode();
      // 使用与原始内容相同的值更新
      store.updateEditContent(originalContent);

      const state = useAppStore.getState();
      expect(state.currentView?.isDirty).toBe(false);
    });

    it('should updateEditContent skip update if content same as current editContent', () => {
      const store = useAppStore.getState();

      store.setCurrentView(createMockCurrentView({ content: '# Original' }));
      store.setEditMode();
      store.updateEditContent('# First Update');
      store.updateEditContent('# First Update'); // 与当前 editContent 相同

      const state = useAppStore.getState();
      expect(state.currentView?.editContent).toBe('# First Update');
    });

    it('should updateEditContent not modify state if currentView is null', () => {
      const store = useAppStore.getState();

      store.reset();
      store.updateEditContent('# New Content');

      expect(useAppStore.getState().currentView).toBe(null);
    });

    it('should savePage call api.putPage and update state on success', async () => {
      const mockPutPage = vi.mocked(api.putPage);
      mockPutPage.mockResolvedValueOnce({ mtime: Date.now() });

      const store = useAppStore.getState();
      const content = '# Test Content';

      store.setCurrentView(createMockCurrentView({ content }));
      store.setEditMode();
      store.updateEditContent('# Updated Content');

      await store.savePage();

      const state = useAppStore.getState();
      expect(mockPutPage).toHaveBeenCalled();
      expect(state.currentView?.mode).toBe('read');
      expect(state.currentView?.editContent).toBe(null);
      expect(state.currentView?.isDirty).toBe(false);
      expect(state.currentView?.content).toBe('# Updated Content');
      expect(state.currentView?.conflictData).toBe(null);
    });

    it('should savePage handle conflict in edit mode', async () => {
      const mockPutPage = vi.mocked(api.putPage);
      const mockGetPage = vi.mocked(api.getPage);
      const serverContent = '# Server Content';

      mockPutPage.mockRejectedValueOnce(new Error('Page has been modified since load'));
      mockGetPage.mockResolvedValueOnce({
        content: serverContent,
        mtime: Date.now(),
      });

      const store = useAppStore.getState();

      store.setCurrentView(createMockCurrentView({ content: '# Original', fileMtime: 1000 }));
      store.setEditMode();
      store.updateEditContent('# My Edit');

      await store.savePage();

      const state = useAppStore.getState();
      expect(state.currentView?.conflictData).toEqual({
        serverContent,
        serverMtime: expect.any(Number),
      });
      expect(state.currentView?.mode).toBe('edit');
    });

    it('should savePage handle conflict in read mode by updating content', async () => {
      const mockPutPage = vi.mocked(api.putPage);
      const mockGetPage = vi.mocked(api.getPage);
      const serverContent = '# Server Content';
      const serverMtime = 2000;

      mockPutPage.mockRejectedValueOnce(new Error('CONFLICT: version mismatch'));
      mockGetPage.mockResolvedValueOnce({
        content: serverContent,
        mtime: serverMtime,
      });

      const store = useAppStore.getState();

      store.setCurrentView(createMockCurrentView({ content: '# Original', mode: 'read' }));

      await store.savePage();

      const state = useAppStore.getState();
      expect(state.currentView?.content).toBe(serverContent);
      expect(state.currentView?.fileMtime).toBe(serverMtime);
      expect(state.currentView?.conflictData).toBe(null);
      expect(state.currentView?.mode).toBe('read');
    });

    it('should savePage throw non-conflict errors', async () => {
      const mockPutPage = vi.mocked(api.putPage);
      mockPutPage.mockRejectedValueOnce(new Error('Network error'));

      const store = useAppStore.getState();
      store.setCurrentView(createMockCurrentView());

      await expect(store.savePage()).rejects.toThrow('Network error');
    });

    it('should savePage return early if currentView is null', async () => {
      const store = useAppStore.getState();

      store.reset();

      await store.savePage();

      expect(api.putPage).not.toHaveBeenCalled();
    });

    it('should resolveConflict set server content when choice is server', () => {
      const store = useAppStore.getState();
      const serverContent = '# Server Version';
      const serverMtime = 2000;

      store.setCurrentView(createMockCurrentView({
        content: '# Original',
        editContent: '# My Edit',
        fileMtime: 1000,
        conflictData: {
          serverContent,
          serverMtime,
        },
      }));

      store.resolveConflict('server');

      const state = useAppStore.getState();
      expect(state.currentView?.editContent).toBe(serverContent);
      expect(state.currentView?.fileMtime).toBe(serverMtime);
      expect(state.currentView?.isDirty).toBe(false);
      expect(state.currentView?.conflictData).toBe(null);
    });

    it('should resolveConflict keep my content when choice is mine', () => {
      const store = useAppStore.getState();
      const serverMtime = 2000;

      store.setCurrentView(createMockCurrentView({
        content: '# Original',
        editContent: '# My Edit',
        fileMtime: 1000,
        conflictData: {
          serverContent: '# Server Version',
          serverMtime,
        },
      }));

      store.resolveConflict('mine');

      const state = useAppStore.getState();
      expect(state.currentView?.editContent).toBe('# My Edit');
      expect(state.currentView?.fileMtime).toBe(serverMtime);
      expect(state.currentView?.conflictData).toBe(null);
    });

    it('should resolveConflict do nothing if no conflictData', () => {
      const store = useAppStore.getState();

      store.setCurrentView(createMockCurrentView({ conflictData: null }));
      store.resolveConflict('server');

      // 不应有任何变化
      expect(useAppStore.getState().currentView?.conflictData).toBe(null);
    });

    it('should saveCalloutAction update content with new mtime', async () => {
      const mockPutPage = vi.mocked(api.putPage);
      const newMtime = Date.now();
      mockPutPage.mockResolvedValueOnce({ mtime: newMtime });

      const store = useAppStore.getState();
      const newContent = '# Updated Callout Content';

      store.setCurrentView(createMockCurrentView({ content: '# Original' }));

      await store.saveCalloutAction(newContent);

      const state = useAppStore.getState();
      expect(state.currentView?.content).toBe(newContent);
      expect(state.currentView?.fileMtime).toBe(newMtime);
    });

    it('should saveCalloutAction return early if currentView is null', async () => {
      const store = useAppStore.getState();

      store.reset();

      await store.saveCalloutAction('# New');

      expect(api.putPage).not.toHaveBeenCalled();
    });
  });

  describe('Wiki 数据', () => {
    it('should setCurrentWiki set wiki data', () => {
      const store = useAppStore.getState();
      const wiki = createMockWikiData();

      store.setCurrentWiki(wiki);
      expect(useAppStore.getState().currentWiki).toEqual(wiki);
    });

    it('should setCurrentWiki clear wiki data with null', () => {
      const store = useAppStore.getState();
      const wiki = createMockWikiData();

      store.setCurrentWiki(wiki);
      store.setCurrentWiki(null);

      expect(useAppStore.getState().currentWiki).toBe(null);
    });

    it('should setCurrentView set view data', () => {
      const store = useAppStore.getState();
      const view = createMockCurrentView();

      store.setCurrentView(view);
      expect(useAppStore.getState().currentView).toEqual(view);
    });

    it('should setCurrentView clear view data with null', () => {
      const store = useAppStore.getState();
      const view = createMockCurrentView();

      store.setCurrentView(view);
      store.setCurrentView(null);

      expect(useAppStore.getState().currentView).toBe(null);
    });
  });

  describe('Reference Modal', () => {
    it('should openReference set reference data', () => {
      const store = useAppStore.getState();

      store.openReference('/path/to/file.ts', 10, 20);

      const state = useAppStore.getState();
      expect(state.referenceOpen).toBe(true);
      expect(state.referenceData).toEqual({
        filePath: '/path/to/file.ts',
        startLine: 10,
        endLine: 20,
      });
    });

    it('should openReference work without line numbers', () => {
      const store = useAppStore.getState();

      store.openReference('/path/to/file.ts');

      const state = useAppStore.getState();
      expect(state.referenceOpen).toBe(true);
      expect(state.referenceData).toEqual({
        filePath: '/path/to/file.ts',
        startLine: undefined,
        endLine: undefined,
      });
    });

    it('should closeReference clear reference state', () => {
      const store = useAppStore.getState();

      store.openReference('/path/to/file.ts', 1, 10);
      store.closeReference();

      const state = useAppStore.getState();
      expect(state.referenceOpen).toBe(false);
      expect(state.referenceData).toBe(null);
    });
  });

  describe('Mermaid Viewer Modal', () => {
    it('should openMermaidViewer set mermaid data', () => {
      const store = useAppStore.getState();
      const svg = '<svg>...</svg>';
      const code = 'graph TD\n  A --> B';

      store.openMermaidViewer(svg, code);

      const state = useAppStore.getState();
      expect(state.mermaidViewerOpen).toBe(true);
      expect(state.mermaidViewerData).toEqual({ svg, code });
    });

    it('should closeMermaidViewer clear mermaid state', () => {
      const store = useAppStore.getState();

      store.openMermaidViewer('<svg>test</svg>', 'graph TD');
      store.closeMermaidViewer();

      const state = useAppStore.getState();
      expect(state.mermaidViewerOpen).toBe(false);
      expect(state.mermaidViewerData).toBe(null);
    });
  });

  describe('Expand/Collapse Sections and Groups', () => {
    it('should toggleSection add section if not expanded', () => {
      const store = useAppStore.getState();

      store.toggleSection('section-1');

      const state = useAppStore.getState();
      expect(state.expandedSections).toContain('section-1');
    });

    it('should toggleSection remove section if already expanded', () => {
      const store = useAppStore.getState();

      store.toggleSection('section-1');
      store.toggleSection('section-1');

      const state = useAppStore.getState();
      expect(state.expandedSections).not.toContain('section-1');
    });

    it('should toggleSection handle multiple sections', () => {
      const store = useAppStore.getState();

      store.toggleSection('section-1');
      store.toggleSection('section-2');
      store.toggleSection('section-3');

      const state = useAppStore.getState();
      expect(state.expandedSections).toEqual(['section-1', 'section-2', 'section-3']);

      // 移除一个
      store.toggleSection('section-2');
      expect(useAppStore.getState().expandedSections).toEqual(['section-1', 'section-3']);
    });

    it('should toggleGroup add group if not expanded', () => {
      const store = useAppStore.getState();

      store.toggleGroup('group-1');

      const state = useAppStore.getState();
      expect(state.expandedGroups).toContain('group-1');
    });

    it('should toggleGroup remove group if already expanded', () => {
      const store = useAppStore.getState();

      store.toggleGroup('group-1');
      store.toggleGroup('group-1');

      const state = useAppStore.getState();
      expect(state.expandedGroups).not.toContain('group-1');
    });

    it('should toggleGroup handle multiple groups', () => {
      const store = useAppStore.getState();

      store.toggleGroup('group-1');
      store.toggleGroup('group-2');

      const state = useAppStore.getState();
      expect(state.expandedGroups).toEqual(['group-1', 'group-2']);

      // 移除一个
      store.toggleGroup('group-1');
      expect(useAppStore.getState().expandedGroups).toEqual(['group-2']);
    });

    it('should setExpandedSections set all sections', () => {
      const store = useAppStore.getState();
      const sections = ['section-1', 'section-2', 'section-3'];

      store.setExpandedSections(sections);
      expect(useAppStore.getState().expandedSections).toEqual(sections);
    });

    it('should setExpandedSections replace existing sections', () => {
      const store = useAppStore.getState();

      store.setExpandedSections(['old-1', 'old-2']);
      store.setExpandedSections(['new-1', 'new-2']);

      expect(useAppStore.getState().expandedSections).toEqual(['new-1', 'new-2']);
    });

    it('should setExpandedGroups set all groups', () => {
      const store = useAppStore.getState();
      const groups = ['group-1', 'group-2'];

      store.setExpandedGroups(groups);
      expect(useAppStore.getState().expandedGroups).toEqual(groups);
    });

    it('should setExpandedGroups replace existing groups', () => {
      const store = useAppStore.getState();

      store.setExpandedGroups(['old-group']);
      store.setExpandedGroups(['new-group']);

      expect(useAppStore.getState().expandedGroups).toEqual(['new-group']);
    });
  });

  describe('Loading States', () => {
    it('should setLoadingWiki set wiki loading state', () => {
      const store = useAppStore.getState();

      store.setLoadingWiki(true);
      expect(useAppStore.getState().loadingWiki).toBe(true);

      store.setLoadingWiki(false);
      expect(useAppStore.getState().loadingWiki).toBe(false);
    });

    it('should setLoadingPage set page loading state', () => {
      const store = useAppStore.getState();

      store.setLoadingPage(true);
      expect(useAppStore.getState().loadingPage).toBe(true);

      store.setLoadingPage(false);
      expect(useAppStore.getState().loadingPage).toBe(false);
    });

    it('should setLoadingProjects set projects loading state', () => {
      const store = useAppStore.getState();

      store.setLoadingProjects(true);
      expect(useAppStore.getState().loadingProjects).toBe(true);

      store.setLoadingProjects(false);
      expect(useAppStore.getState().loadingProjects).toBe(false);
    });
  });

  describe('Reset', () => {
    it('should reset all state to initial values', () => {
      const store = useAppStore.getState();

      // 设置各种状态值
      store.setProjects([createMockProject()]);
      store.setConfig(createMockConfig());
      store.setCurrentWiki(createMockWikiData());
      store.setCurrentView(createMockCurrentView());
      store.setSidebarOpen(false);
      store.setSettingsOpen(true);
      store.setSearchOpen(true);
      store.setSearchQuery('test');
      store.setSearchResults([createMockSearchResult()]);
      store.toggleSection('section-1');
      store.toggleGroup('group-1');
      store.openReference('/path/to/file.ts');
      store.openMermaidViewer('<svg>test</svg>', 'code');
      store.setLoadingWiki(true);
      store.setLoadingPage(true);
      store.setLoadingProjects(true);

      // 重置
      store.reset();

      const state = useAppStore.getState();
      expect(state.projects).toEqual([]);
      expect(state.config).toBe(null);
      expect(state.currentWiki).toBe(null);
      expect(state.currentView).toBe(null);
      expect(state.sidebarOpen).toBe(true);
      expect(state.settingsOpen).toBe(false);
      expect(state.searchOpen).toBe(false);
      expect(state.searchQuery).toBe('');
      expect(state.searchResults).toEqual([]);
      expect(state.expandedSections).toEqual([]);
      expect(state.expandedGroups).toEqual([]);
      expect(state.referenceOpen).toBe(false);
      expect(state.referenceData).toBe(null);
      expect(state.mermaidViewerOpen).toBe(false);
      expect(state.mermaidViewerData).toBe(null);
      expect(state.loadingWiki).toBe(false);
      expect(state.loadingPage).toBe(false);
      expect(state.loadingProjects).toBe(false);
    });
  });

  describe('完整流程场景', () => {
    it('should handle typical project/wiki/view workflow', () => {
      const store = useAppStore.getState();

      // 1. 设置项目
      const projects = [
        createMockProject({ id: 'proj-1', name: 'My Project' }),
      ];
      store.setProjects(projects);

      // 2. 设置配置
      const config = createMockConfig({ lastOpenedProject: 'proj-1' });
      store.setConfig(config);

      // 3. 切换项目
      store.setCurrentProject('proj-1');

      // 4. 加载 Wiki
      store.setLoadingWiki(true);
      const wiki = createMockWikiData();
      store.setCurrentWiki(wiki);
      store.setLoadingWiki(false);

      // 5. 加载页面视图
      store.setLoadingPage(true);
      const view = createMockCurrentView({ projectId: 'proj-1' });
      store.setCurrentView(view);
      store.setLoadingPage(false);

      const state = useAppStore.getState();
      expect(state.projects).toEqual(projects);
      expect(state.config?.lastOpenedProject).toBe('proj-1');
      expect(state.currentWiki).toEqual(wiki);
      expect(state.currentView?.projectId).toBe('proj-1');
      expect(state.loadingWiki).toBe(false);
      expect(state.loadingPage).toBe(false);
    });

    it('should handle edit and save workflow', async () => {
      const mockPutPage = vi.mocked(api.putPage);
      mockPutPage.mockResolvedValueOnce({ mtime: Date.now() });

      const store = useAppStore.getState();

      // 设置视图
      store.setCurrentView(createMockCurrentView({ content: '# Original' }));

      // 进入编辑模式
      store.setEditMode();
      expect(useAppStore.getState().currentView?.mode).toBe('edit');

      // 修改内容
      store.updateEditContent('# Modified');
      expect(useAppStore.getState().currentView?.isDirty).toBe(true);

      // 保存
      await store.savePage();

      const state = useAppStore.getState();
      expect(state.currentView?.mode).toBe('read');
      expect(state.currentView?.content).toBe('# Modified');
      expect(state.currentView?.isDirty).toBe(false);
    });

    it('should handle conflict resolution workflow', async () => {
      const mockPutPage = vi.mocked(api.putPage);
      const mockGetPage = vi.mocked(api.getPage);

      mockPutPage.mockRejectedValueOnce(new Error('modified since load'));
      mockGetPage.mockResolvedValueOnce({
        content: '# Server Content',
        mtime: 2000,
      });

      const store = useAppStore.getState();

      // 设置视图并进入编辑模式
      store.setCurrentView(createMockCurrentView({ content: '# Original', fileMtime: 1000 }));
      store.setEditMode();
      store.updateEditContent('# My Content');

      // 尝试保存 — 触发冲突
      await store.savePage();

      const stateAfterConflict = useAppStore.getState();
      expect(stateAfterConflict.currentView?.conflictData).not.toBe(null);

      // 选择"保留我的内容"解决冲突
      store.resolveConflict('mine');

      const stateAfterResolve = useAppStore.getState();
      expect(stateAfterResolve.currentView?.conflictData).toBe(null);
      expect(stateAfterResolve.currentView?.editContent).toBe('# My Content');
      expect(stateAfterResolve.currentView?.fileMtime).toBe(2000);
    });
  });

  describe('版本切换', () => {
    it('setAvailableVersions 应更新版本列表', () => {
      const store = useAppStore.getState();
      const versions = [
        { version: '2026-04-16-220440', generatedAt: '2026-04-16T22:04:40Z', pageCount: 10, isCurrent: true },
        { version: '2026-04-15-120000', generatedAt: '2026-04-15T12:00:00Z', pageCount: 8, isCurrent: false },
      ];

      store.setAvailableVersions(versions);

      expect(useAppStore.getState().availableVersions).toEqual(versions);
    });

    it('setWikiVersion 应更新 selectedVersion', async () => {
      const mockGetWiki = vi.mocked(api.getWiki);
      const mockGetPage = vi.mocked(api.getPage);
      const wikiData = createMockWikiData();
      mockGetWiki.mockResolvedValueOnce(wikiData);
      mockGetPage.mockResolvedValueOnce({
        page: wikiData.pages[0],
        content: '# Intro',
        mtime: 1000,
      });

      const store = useAppStore.getState();
      const config = createMockConfig({ lastOpenedProject: 'project-1' });
      store.setConfig(config);

      await store.setWikiVersion('2026-04-16-220440');

      expect(useAppStore.getState().selectedVersion).toBe('2026-04-16-220440');
    });

    it('setWikiVersion 应重新加载 wiki 和页面数据', async () => {
      const mockGetWiki = vi.mocked(api.getWiki);
      const mockGetPage = vi.mocked(api.getPage);

      const wikiData = createMockWikiData();
      mockGetWiki.mockResolvedValueOnce(wikiData);
      mockGetPage.mockResolvedValueOnce({
        page: wikiData.pages[0],
        content: '# Introduction Content',
        mtime: 12345,
      });

      const store = useAppStore.getState();
      const config = createMockConfig({ lastOpenedProject: 'project-1' });
      store.setConfig(config);

      await store.setWikiVersion('2026-04-16-220440');

      expect(mockGetWiki).toHaveBeenCalledWith('project-1', '2026-04-16-220440');
      expect(mockGetPage).toHaveBeenCalledWith('project-1', '2026-04-16-220440', 'intro');

      const state = useAppStore.getState();
      expect(state.currentWiki).toEqual(wikiData);
      expect(state.currentView).not.toBe(null);
      expect(state.currentView?.projectId).toBe('project-1');
      expect(state.currentView?.version).toBe('2026-04-16-220440');
      expect(state.currentView?.slug).toBe('intro');
      expect(state.currentView?.content).toBe('# Introduction Content');
    });

    it('setWikiVersion 无 projectId 时不应执行操作', async () => {
      const mockGetWiki = vi.mocked(api.getWiki);

      const store = useAppStore.getState();
      // config 默认为 null，因此没有 lastOpenedProject

      await store.setWikiVersion('2026-04-16-220440');

      expect(mockGetWiki).not.toHaveBeenCalled();
      expect(useAppStore.getState().selectedVersion).toBe(null);
    });

    it('setWikiVersion 应在加载过程中设置 loadingWiki 状态', async () => {
      const mockGetWiki = vi.mocked(api.getWiki);
      const mockGetPage = vi.mocked(api.getPage);
      let resolveWiki: (value: any) => void;
      const wikiPromise = new Promise((resolve) => { resolveWiki = resolve; });
      mockGetWiki.mockReturnValueOnce(wikiPromise as any);
      mockGetPage.mockResolvedValueOnce({
        page: createMockWikiData().pages[0],
        content: '# Intro',
        mtime: 1000,
      });

      const store = useAppStore.getState();
      const config = createMockConfig({ lastOpenedProject: 'project-1' });
      store.setConfig(config);

      const setWikiPromise = store.setWikiVersion('2026-04-16-220440');

      // 加载期间 loadingWiki 应为 true
      expect(useAppStore.getState().loadingWiki).toBe(true);
      expect(useAppStore.getState().selectedVersion).toBe('2026-04-16-220440');

      // 解析 Wiki Promise
      resolveWiki!(createMockWikiData());
      await setWikiPromise;

      // 加载完成后 loadingWiki 应为 false
      expect(useAppStore.getState().loadingWiki).toBe(false);
    });

    it('setWikiVersion 加载失败时也应重置 loadingWiki', async () => {
      const mockGetWiki = vi.mocked(api.getWiki);
      mockGetWiki.mockRejectedValueOnce(new Error('Network error'));

      const store = useAppStore.getState();
      const config = createMockConfig({ lastOpenedProject: 'project-1' });
      store.setConfig(config);

      // setWikiVersion 内部使用 try/finally，loadingWiki 会被重置但错误会向上抛出
      await expect(store.setWikiVersion('2026-04-16-220440')).rejects.toThrow('Network error');

      expect(useAppStore.getState().loadingWiki).toBe(false);
    });

    it('reset 应清除版本相关状态', () => {
      const store = useAppStore.getState();

      // 设置版本状态
      store.setAvailableVersions([
        { version: '2026-04-16-220440', generatedAt: '2026-04-16T22:04:40Z', pageCount: 10, isCurrent: true },
      ]);
      // 手动通过 set 设置 selectedVersion（模拟 setWikiVersion 的行为）
      useAppStore.setState({ selectedVersion: '2026-04-16-220440' });

      // 验证状态已设置
      expect(useAppStore.getState().availableVersions).toHaveLength(1);
      expect(useAppStore.getState().selectedVersion).toBe('2026-04-16-220440');

      // 重置
      store.reset();

      const state = useAppStore.getState();
      expect(state.availableVersions).toEqual([]);
      expect(state.selectedVersion).toBe(null);
    });
  });
});