import React from 'react';

// ===== 工具专用图标 =====

/** 终端图标 - Shell / Bash */
export const TerminalIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

/** 文件图标 - ReadFile / read_file */
export const FileIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

/** 文件编辑图标 - WriteFile / str_replace_file */
export const FileEditIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M10 18l1.5-1.5L16 12l2 2-4.5 4.5L12 20z" />
  </svg>
);

/** 搜索图标 - Grep / grep */
export const SearchIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

/** 文件夹搜索图标 - Glob / glob */
export const FolderSearchIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    <circle cx="14" cy="14" r="3" />
    <line x1="20" y1="20" x2="16.65" y2="16.65" />
  </svg>
);

/** 地球图标 - Web Search */
export const GlobeIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

/** 扳手图标 - 默认 fallback */
export const WrenchIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

// ===== Tool Meta Mapping =====

export interface ToolMeta {
  icon: React.FC<{ size?: number; className?: string }>;
  displayName: string;
  paramKeys: string[];
}

const TOOL_META_MAP: Record<string, ToolMeta> = {
  Shell:            { icon: TerminalIcon,    displayName: 'Shell',    paramKeys: ['command'] },
  Bash:             { icon: TerminalIcon,    displayName: 'Shell',    paramKeys: ['command'] },
  ReadFile:         { icon: FileIcon,        displayName: '读取',     paramKeys: ['file_path', 'path'] },
  read_file:        { icon: FileIcon,        displayName: '读取',     paramKeys: ['file_path', 'path'] },
  WriteFile:        { icon: FileEditIcon,    displayName: '写入',     paramKeys: ['file_path', 'path'] },
  write_file:       { icon: FileEditIcon,    displayName: '写入',     paramKeys: ['file_path', 'path'] },
  EditFile:         { icon: FileEditIcon,    displayName: '编辑',     paramKeys: ['file_path', 'path'] },
  str_replace_file: { icon: FileEditIcon,    displayName: '编辑',     paramKeys: ['file_path', 'path'] },
  Grep:             { icon: SearchIcon,      displayName: '搜索',     paramKeys: ['pattern', 'query'] },
  grep:             { icon: SearchIcon,      displayName: '搜索',     paramKeys: ['pattern', 'query'] },
  Glob:             { icon: FolderSearchIcon, displayName: '查找文件', paramKeys: ['pattern', 'path'] },
  glob:             { icon: FolderSearchIcon, displayName: '查找文件', paramKeys: ['pattern', 'path'] },
  SearchWeb:        { icon: GlobeIcon,       displayName: '网页搜索', paramKeys: ['query'] },
  web_search:       { icon: GlobeIcon,       displayName: '网页搜索', paramKeys: ['query'] },
};

const DEFAULT_META: ToolMeta = {
  icon: WrenchIcon,
  displayName: '',
  paramKeys: ['file_path', 'path', 'filename', 'file', 'url', 'command', 'query', 'content'],
};

/** 根据函数名获取工具元数据 */
export function getToolMeta(name: string): ToolMeta {
  return TOOL_META_MAP[name] || { ...DEFAULT_META, displayName: name };
}

/** 安全地将值转为 JSON 字符串，防止循环引用导致崩溃 */
export function safeStringify(value: unknown, fallback = '{}'): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

/** 从 JSON 参数字符串中提取主要参数用于简洁显示 */
export function extractPrimaryParam(args: string, paramKeys?: string[]): string {
  try {
    const str = safeStringify(args, '');
    const parsed = JSON.parse(str);
    const keys = paramKeys || ['file_path', 'path', 'filename', 'file', 'url', 'command', 'query', 'content'];
    for (const key of keys) {
      if (parsed[key]) {
        const value = String(parsed[key]);
        if (value.length > 50) {
          const parts = value.split('/');
          if (parts.length > 3) {
            return `.../${parts.slice(-2).join('/')}`;
          }
          return value.slice(0, 50) + '...';
        }
        return value;
      }
    }
    return '';
  } catch {
    return '';
  }
}
