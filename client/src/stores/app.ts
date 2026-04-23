import { create } from 'zustand';
import type { ProjectConfig, WikiData, WikiVersion, AppConfig, SearchResult } from '@shared/types';
import type { CurrentView } from '../types';
import * as api from '../services/api';

/**
 * 应用全局状态数据接口
 * 包含项目列表、Wiki 数据、UI 状态、弹窗状态、加载状态等
 */
interface AppState {
  // 数据
  projects: ProjectConfig[];
  config: AppConfig | null;
  currentWiki: WikiData | null;
  currentView: CurrentView | null;
  availableVersions: WikiVersion[];
  selectedVersion: string | null;

  // UI 状态
  sidebarOpen: boolean;
  settingsOpen: boolean;
  searchOpen: boolean;
  searchQuery: string;
  searchResults: SearchResult[];
  expandedSections: string[];
  expandedGroups: string[];

  // 引用查看弹窗状态
  referenceOpen: boolean;
  referenceData: {
    filePath: string;
    startLine?: number;
    endLine?: number;
  } | null;

  // Mermaid 图表查看弹窗状态
  mermaidViewerOpen: boolean;
  mermaidViewerData: {
    svg: string;
    code: string;
  } | null;

  // 加载状态
  loadingWiki: boolean;
  loadingPage: boolean;
  loadingProjects: boolean;
}

/**
 * 应用全局状态操作接口
 * 包含数据设置、UI 切换、弹窗控制、编辑模式、版本管理等操作方法
 */
interface AppActions {
  // 数据设置
  setProjects: (projects: ProjectConfig[]) => void;
  setConfig: (config: AppConfig) => void;
  setCurrentWiki: (wiki: WikiData | null) => void;
  setCurrentView: (view: CurrentView | null) => void;

  // 项目操作
  setCurrentProject: (projectId: string) => void;

  // UI 开关
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSettings: () => void;
  setSettingsOpen: (open: boolean) => void;
  toggleSearch: () => void;
  setSearchOpen: (open: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: SearchResult[]) => void;

  // 引用查看弹窗
  openReference: (filePath: string, startLine?: number, endLine?: number) => void;
  closeReference: () => void;

  // Mermaid 图表查看弹窗
  openMermaidViewer: (svg: string, code: string) => void;
  closeMermaidViewer: () => void;

  // 展开/折叠
  toggleSection: (section: string) => void;
  toggleGroup: (group: string) => void;
  setExpandedSections: (sections: string[]) => void;
  setExpandedGroups: (groups: string[]) => void;

  // 加载状态
  setLoadingWiki: (loading: boolean) => void;
  setLoadingPage: (loading: boolean) => void;
  setLoadingProjects: (loading: boolean) => void;

  // 编辑模式
  setEditMode: () => void;
  setReadMode: () => void;
  updateEditContent: (content: string) => void;
  savePage: () => Promise<void>;
  resolveConflict: (choice: 'server' | 'mine') => void;
  saveCalloutAction: (newContent: string) => Promise<void>;

  // 版本管理
  setAvailableVersions: (versions: WikiVersion[]) => void;
  setWikiVersion: (version: string) => Promise<void>;

  // 重置
  reset: () => void;
}

/** 应用全局状态初始值 */
const initialState: AppState = {
  projects: [],
  config: null,
  currentWiki: null,
  currentView: null,
  availableVersions: [],
  selectedVersion: null,
  sidebarOpen: true,
  settingsOpen: false,
  searchOpen: false,
  searchQuery: '',
  searchResults: [],
  expandedSections: [],
  expandedGroups: [],
  referenceOpen: false,
  referenceData: null,
  mermaidViewerOpen: false,
  mermaidViewerData: null,
  loadingWiki: false,
  loadingPage: false,
  loadingProjects: false,
};

/**
 * 应用全局状态管理 Store
 * 包含项目管理、Wiki 浏览、搜索、编辑模式、版本切换等核心功能
 */
export const useAppStore = create<AppState & AppActions>((set, get) => ({
  ...initialState,

  /** 设置项目列表 */
  setProjects: (projects) => set({ projects }),
  /** 设置应用配置 */
  setConfig: (config) => set({ config }),
  /** 设置当前 Wiki 数据 */
  setCurrentWiki: (wiki) => set({ currentWiki: wiki }),
  /** 设置当前视图 */
  setCurrentView: (view) => set({ currentView: view }),

  /**
   * 设置当前打开的项目
   * @param projectId - 项目 ID
   */
  setCurrentProject: (projectId) =>
    set((state) => ({
      config: state.config
        ? { ...state.config, lastOpenedProject: projectId }
        : state.config,
    })),

  /** 切换侧边栏展开/折叠 */
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  /** 设置侧边栏展开状态 */
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  /** 切换设置面板展开/折叠 */
  toggleSettings: () =>
    set((state) => ({ settingsOpen: !state.settingsOpen })),
  /** 设置设置面板展开状态 */
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  /** 切换搜索面板展开/折叠 */
  toggleSearch: () => set((state) => ({ searchOpen: !state.searchOpen })),
  /**
   * 设置搜索面板展开状态
   * 关闭时自动清空搜索关键词和结果
   * @param open - 是否展开
   */
  setSearchOpen: (open) =>
    set((state) => ({
      searchOpen: open,
      searchQuery: open ? state.searchQuery : '',
      searchResults: open ? state.searchResults : [],
    })),
  /**
   * 设置搜索关键词
   * @param query - 搜索关键词
   */
  setSearchQuery: (query) => set({ searchQuery: query }),
  /**
   * 设置搜索结果列表
   * @param results - 搜索结果数组
   */
  setSearchResults: (results) => set({ searchResults: results }),

  /**
   * 打开代码引用查看弹窗
   * @param filePath - 文件路径
   * @param startLine - 起始行号
   * @param endLine - 结束行号
   */
  openReference: (filePath, startLine, endLine) =>
    set({
      referenceOpen: true,
      referenceData: { filePath, startLine, endLine },
    }),
  /** 关闭代码引用查看弹窗 */
  closeReference: () => set({ referenceOpen: false, referenceData: null }),

  /**
   * 打开 Mermaid 图表查看弹窗
   * @param svg - 渲染后的 SVG 内容
   * @param code - Mermaid 源代码
   */
  openMermaidViewer: (svg, code) =>
    set({
      mermaidViewerOpen: true,
      mermaidViewerData: { svg, code },
    }),
  /** 关闭 Mermaid 图表查看弹窗 */
  closeMermaidViewer: () => set({ mermaidViewerOpen: false, mermaidViewerData: null }),

  /**
   * 切换侧边栏章节的展开/折叠状态
   * @param section - 章节标识
   */
  toggleSection: (section) =>
    set((state) => ({
      expandedSections: state.expandedSections.includes(section)
        ? state.expandedSections.filter((s) => s !== section)
        : [...state.expandedSections, section],
    })),

  /**
   * 切换侧边栏分组的展开/折叠状态
   * @param group - 分组标识
   */
  toggleGroup: (group) =>
    set((state) => ({
      expandedGroups: state.expandedGroups.includes(group)
        ? state.expandedGroups.filter((g) => g !== group)
        : [...state.expandedGroups, group],
    })),

  /**
   * 设置展开的章节列表
   * @param sections - 章节标识数组
   */
  setExpandedSections: (sections) => set({ expandedSections: sections }),
  /**
   * 设置展开的分组列表
   * @param groups - 分组标识数组
   */
  setExpandedGroups: (groups) => set({ expandedGroups: groups }),

  /**
   * 设置 Wiki 加载状态
   * @param loading - 是否正在加载
   */
  setLoadingWiki: (loading) => set({ loadingWiki: loading }),
  /**
   * 设置页面加载状态
   * @param loading - 是否正在加载
   */
  setLoadingPage: (loading) => set({ loadingPage: loading }),
  /**
   * 设置项目列表加载状态
   * @param loading - 是否正在加载
   */
  setLoadingProjects: (loading) => set({ loadingProjects: loading }),

  /** 进入编辑模式，以当前内容作为编辑初始值 */
  setEditMode: () =>
    set((state) => {
      if (!state.currentView) return state;
      return {
        currentView: {
          ...state.currentView,
          mode: 'edit',
          editContent: state.currentView.content,
          isDirty: false,
        },
      };
    }),

  /** 退出编辑模式，回到阅读模式 */
  setReadMode: () =>
    set((state) => {
      if (!state.currentView) return state;
      return {
        currentView: {
          ...state.currentView,
          mode: 'read',
          editContent: null,
          isDirty: false,
        },
      };
    }),

  /**
   * 更新编辑内容
   * @param content - 新的编辑内容
   */
  updateEditContent: (content) =>
    set((state) => {
      if (!state.currentView) return state;
      if (state.currentView.editContent === content) return state;
      return {
        currentView: {
          ...state.currentView,
          editContent: content,
          isDirty: content !== state.currentView.content,
        },
      };
    }),

  /**
   * 保存当前页面内容
   * 处理编辑冲突：当服务端文件在加载后被修改时，会检测冲突并提供解决选项
   * @throws 当保存失败且非冲突错误时抛出异常
   */
  savePage: async () => {
    const { currentView } = get();
    if (!currentView) return;

    const content = currentView.mode === 'edit'
      ? currentView.editContent!
      : currentView.content;

    try {
      const { mtime } = await api.putPage(
        currentView.projectId,
        currentView.version,
        currentView.slug,
        content,
        currentView.fileMtime ?? undefined,
      );

      set((state) => ({
        currentView: state.currentView ? {
          ...state.currentView,
          content: state.currentView.mode === 'edit'
            ? state.currentView.editContent!
            : state.currentView.content,
          mode: 'read',
          editContent: null,
          isDirty: false,
          fileMtime: mtime,
          conflictData: null,
        } : null,
      }));
    } catch (err: any) {
      // 检测是否为编辑冲突（文件在加载后被修改）
      const isConflict = err?.message?.includes('modified since load') ||
        err?.message?.includes('CONFLICT');

      if (!isConflict) throw err;

      // 阅读模式下冲突：直接刷新为服务端最新内容
      if (currentView.mode === 'read') {
        const data = await api.getPage(currentView.projectId, currentView.version, currentView.slug);
        set((state) => ({
          currentView: state.currentView ? {
            ...state.currentView,
            content: data.content,
            fileMtime: data.mtime,
            conflictData: null,
          } : null,
        }));
        return;
      }

      // 编辑模式下冲突：加载服务端内容供用户选择
      const data = await api.getPage(currentView.projectId, currentView.version, currentView.slug);
      set((state) => ({
        currentView: state.currentView ? {
          ...state.currentView,
          conflictData: {
            serverContent: data.content,
            serverMtime: data.mtime,
          },
        } : null,
      }));
    }
  },

  /**
   * 解决编辑冲突
   * @param choice - 选择使用服务端内容还是保留本地内容
   */
  resolveConflict: (choice) => {
    const { currentView } = get();
    if (!currentView?.conflictData) return;

    if (choice === 'server') {
      // 使用服务端内容覆盖本地编辑
      set((state) => ({
        currentView: state.currentView ? {
          ...state.currentView,
          editContent: state.currentView.conflictData!.serverContent,
          fileMtime: state.currentView.conflictData!.serverMtime,
          isDirty: false,
          conflictData: null,
        } : null,
      }));
    } else {
      // 保留本地内容，仅更新 mtime 以便后续保存
      set((state) => ({
        currentView: state.currentView ? {
          ...state.currentView,
          fileMtime: state.currentView.conflictData!.serverMtime,
          conflictData: null,
        } : null,
      }));
    }
  },

  /**
   * 保存 Callout 组件编辑后的完整页面内容
   * @param newContent - 编辑后的新页面内容
   */
  saveCalloutAction: async (newContent: string) => {
    const { currentView } = get();
    if (!currentView) return;

    const { mtime } = await api.putPage(
      currentView.projectId,
      currentView.version,
      currentView.slug,
      newContent,
      currentView.fileMtime ?? undefined,
    );

    set((state) => ({
      currentView: state.currentView ? {
        ...state.currentView,
        content: newContent,
        fileMtime: mtime,
      } : null,
    }));
  },

  /**
   * 设置可用的 Wiki 版本列表
   * @param versions - 版本数组
   */
  setAvailableVersions: (versions) => set({ availableVersions: versions }),

  /**
   * 切换 Wiki 版本并加载对应数据
   * @param version - 目标版本标识
   */
  setWikiVersion: async (version) => {
    const { config, currentWiki } = get();
    const projectId = config?.lastOpenedProject;
    if (!projectId) return;

    set({ selectedVersion: version, loadingWiki: true });

    try {
      // 加载新版本的 wiki 数据
      const wikiData = await api.getWiki(projectId, version);
      set({ currentWiki: wikiData });

      // 加载新版本的第一页
      if (wikiData.pages.length > 0) {
        const firstPage = wikiData.pages[0];
        set({ loadingPage: true });
        try {
          const pageData = await api.getPage(projectId, version, firstPage.slug);
          set({
            currentView: {
              projectId,
              version,
              slug: firstPage.slug,
              content: pageData.content,
              loading: false,
              mode: 'read',
              editContent: null,
              isDirty: false,
              fileMtime: pageData.mtime,
              conflictData: null,
            },
          });
        } finally {
          set({ loadingPage: false });
        }
      }
    } finally {
      set({ loadingWiki: false });
    }
  },

  /** 重置所有状态到初始值 */
  reset: () => set(initialState),
}));
