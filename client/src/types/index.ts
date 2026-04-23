// 前端专用类型定义

import type { ProjectConfig, WikiData, WikiPage, SearchResult, AppConfig } from '@shared/types';

// 重新导出共享类型
export type { ProjectConfig, WikiData, WikiPage, SearchResult, AppConfig };
export type { ScanStatus, ApiSuccess, ApiError, ApiResponse } from '@shared/types';

// 导航分组：由 WikiData 构建的导航树结构
export interface NavGroup {
  name: string;
  pages: WikiPage[];
}

export interface NavSection {
  name: string;
  groups: NavGroup[];
  ungroupedPages: WikiPage[];
}

export interface NavTree {
  sections: NavSection[];
}

// 当前视图状态
export interface CurrentView {
  projectId: string;
  version: string;
  slug: string;
  content: string;
  loading: boolean;
  error?: string;

  // 编辑模式
  mode: 'read' | 'edit';
  editContent: string | null;
  isDirty: boolean;

  // 冲突检测
  fileMtime: number | null;
  conflictData: {
    serverContent: string;
    serverMtime: number;
  } | null;
}
