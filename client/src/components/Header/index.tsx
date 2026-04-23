import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../stores/app';
import { useAIStore } from '../../stores/ai';
import type { ProjectConfig } from '@shared/types';

// ===== 图标组件 =====
const ChevronDownIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const SearchIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
);

const BookIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const SettingsIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const LogoutIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const WikiBrowserIcon: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="wb-grad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#2563EB" />
        <stop offset="100%" stopColor="#60A5FA" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#wb-grad)" />
    <rect x="16" y="14" width="32" height="24" rx="3" fill="white" fillOpacity="0.9" />
    <rect x="20" y="18" width="24" height="16" rx="2" fill="#2563EB" fillOpacity="0.15" />
    <line x1="24" y1="24" x2="40" y2="24" stroke="#2563EB" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="24" y1="28" x2="36" y2="28" stroke="#2563EB" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M14 42 Q32 52 50 42" stroke="white" strokeWidth="3" strokeLinecap="round" fill="none" />
    <line x1="32" y1="38" x2="32" y2="46" stroke="white" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const AskAIIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" />
  </svg>
);

/**
 * 项目选择下拉组件
 * 展示当前项目和项目列表，支持切换
 */
const ProjectSelector: React.FC = () => {
  const projects = useAppStore((s) => s.projects);
  const config = useAppStore((s) => s.config);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentProjectId = config?.lastOpenedProject;
  const currentProject = projects.find((p) => p.id === currentProjectId);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = async (project: ProjectConfig) => {
    setCurrentProject(project.id);
    setOpen(false);
    try {
      const { updateConfig } = await import('../../services/api');
      await updateConfig({ lastOpenedProject: project.id });
    } catch (err) {
      console.error('持久化项目选择失败:', err);
    }
  };

  if (projects.length === 0) {
    return <span className="text-[13px] text-content-tertiary">暂无项目</span>;
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="
          flex items-center gap-2
          px-3 py-1.5 min-w-[140px]
          border border-edge rounded-lg
          bg-surface-secondary text-content
          text-[13px] font-medium
          transition-colors duration-150
          hover:border-content-tertiary
        "
      >
        <BookIcon size={14} />
        <span className="flex-1 text-left truncate">{currentProject?.name || '选择项目'}</span>
        <ChevronDownIcon size={14} />
      </button>

      {open && (
        <div className="
          absolute top-full left-0 mt-1
          min-w-[220px]
          bg-surface border border-edge
          rounded-lg shadow-lg
          z-50 overflow-y-auto
          animate-fade-in
          max-h-[320px]
        ">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => handleSelect(project)}
              className={`
                flex items-center gap-2 w-full
                px-3 py-2
                text-[13px] text-left
                transition-colors duration-150
                hover:bg-surface-hover
                ${project.id === currentProjectId
                  ? 'bg-accent-light text-accent-text'
                  : 'text-content'
                }
              `}
            >
              <BookIcon size={14} />
              <span className="truncate">{project.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * 顶部导航栏组件
 * 包含项目选择器、搜索入口、AI 面板开关、设置和登出按钮
 */
const Header: React.FC = () => {
  const toggleSearch = useAppStore((s) => s.toggleSearch);
  const toggleSettings = useAppStore((s) => s.toggleSettings);
  const toggleAIPanel = useAIStore((s) => s.toggleAIPanel);
  const aiPanelOpen = useAIStore((s) => s.aiPanelOpen);

  const [authEnabled, setAuthEnabled] = useState(false);

  useEffect(() => {
    import('../../services/api').then(({ getAuthStatus }) => {
      getAuthStatus().then(data => {
        setAuthEnabled(data.enabled);
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  const handleLogout = async () => {
    try {
      // 先关闭 AI WebSocket 连接
      const { aiWs } = await import('../../services/ai-ws');
      aiWs.disconnect();
    } catch {}
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    window.location.reload();
  };

  return (
    <header className="
      h-14 flex items-center justify-between
      px-5 border-b border-edge
      bg-surface-secondary/80 backdrop-blur-md
      shrink-0 z-10
    ">
      {/* 左侧：Logo + 项目选择器 */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5 select-none">
          <WikiBrowserIcon size={22} />
          <span className="font-semibold text-[15px] text-content">WikiBrowser</span>
        </div>
        <div className="w-px h-6 bg-edge" />
        <ProjectSelector />
      </div>

      {/* 中间：搜索入口 */}
      <button
        data-testid="search-trigger"
        onClick={toggleSearch}
        className="
          flex items-center gap-2
          px-3.5 py-2 min-w-[140px] xl:min-w-[200px] 2xl:min-w-[280px]
          border border-edge rounded-lg
          bg-surface-secondary text-content-tertiary
          text-[13px]
          transition-colors duration-150
          hover:border-content-tertiary hover:text-content
        "
      >
        <SearchIcon size={14} />
        <span className="flex-1 text-left">搜索...</span>
        <kbd className="text-[11px] px-1.5 py-0.5 rounded bg-surface-tertiary border border-edge-light font-mono">
          ⌘K
        </kbd>
      </button>

      {/* 右侧：AI + 设置 */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleAIPanel}
          aria-pressed={aiPanelOpen}
          className="
            flex items-center gap-1.5 px-3 py-1.5
            rounded-lg border
            transition-all duration-150
            border-edge bg-surface-secondary text-content-tertiary
            hover:bg-surface-hover hover:text-content
            aria-pressed:border-accent
            aria-pressed:bg-accent-light
            aria-pressed:text-accent-text
            aria-pressed:hover:bg-accent-light
          "
          title="问问 AI"
        >
          <AskAIIcon size={14} />
          <span className="text-[13px] font-medium">问问 AI</span>
        </button>
        <button
          onClick={toggleSettings}
          className="
            w-9 h-9
            flex items-center justify-center
            rounded-lg border border-edge
            bg-surface-secondary text-content-tertiary
            hover:bg-surface-hover hover:text-content
            transition-colors duration-150
          "
          title="设置"
        >
          <SettingsIcon size={18} />
        </button>
        {authEnabled && (
          <button
            onClick={handleLogout}
            className="
              w-9 h-9
              flex items-center justify-center
              rounded-lg border border-edge
              bg-surface-secondary text-content-tertiary
              hover:bg-surface-hover hover:text-content
              transition-colors duration-150
            "
            title="退出登录"
          >
            <LogoutIcon size={18} />
          </button>
        )}
      </div>
    </header>
  );
};

export default Header;
