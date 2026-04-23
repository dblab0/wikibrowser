import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useAppStore } from '../../stores/app';
import { useAIStore } from '../../stores/ai';
import { getWiki, getPage, getWikiVersions } from '../../services/api';
import type { WikiPage, WikiData } from '@shared/types';
import type { NavSection, NavGroup, NavTree } from '../../types';
import VersionSelector from './VersionSelector';

// ===== 图标组件 =====
const ChevronRightIcon: React.FC<{
  size?: number;
  rotated?: boolean;
}> = ({ size = 14, rotated }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`shrink-0 transition-transform duration-150 ${rotated ? 'rotate-90' : ''}`}
  >
    <path d="M9 18l6-6-6-6" />
  </svg>
);

const CollapseIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);

const ExpandIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="14" y1="3" x2="14" y2="21" />
  </svg>
);

/**
 * 根据 Wiki 数据构建导航树
 * @param wiki Wiki 数据
 * @returns 分区-分组-页面的树形导航结构
 */
function buildNavTree(wiki: WikiData): NavTree {
  const sectionMap = new Map<string, { grouped: Map<string, WikiPage[]>; ungrouped: WikiPage[] }>();

  for (const page of wiki.pages) {
    if (!sectionMap.has(page.section)) {
      sectionMap.set(page.section, {
        grouped: new Map(),
        ungrouped: [],
      });
    }

    const section = sectionMap.get(page.section)!;

    if (page.group) {
      if (!section.grouped.has(page.group)) {
        section.grouped.set(page.group, []);
      }
      section.grouped.get(page.group)!.push(page);
    } else {
      section.ungrouped.push(page);
    }
  }

  const sections: NavSection[] = [];
  for (const [name, data] of sectionMap) {
    const groups: NavGroup[] = [];
    for (const [groupName, pages] of data.grouped) {
      groups.push({ name: groupName, pages });
    }
    sections.push({
      name,
      groups,
      ungroupedPages: data.ungrouped,
    });
  }

  return { sections };
}

// ===== 子组件 =====

/** 导航页面项组件（带悬停提示） */
const PageItem: React.FC<{
  page: WikiPage;
  isActive: boolean;
  onClick: () => void;
}> = React.memo(({ page, isActive, onClick }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<'top' | 'bottom'>('bottom');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const levelClass =
    page.level === 'Beginner'
      ? 'bg-accent-light text-accent-text border-accent/15'
      : page.level === 'Intermediate'
        ? 'bg-warning-light text-[#92400e] border-warning/15'
        : 'bg-danger-light text-[#991b1b] border-danger/15';

  const handleMouseEnter = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) {
        const spaceAbove = rect.top;
        setTooltipPosition(spaceAbove > 80 ? 'top' : 'bottom');
      }
      setShowTooltip(true);
    }, 300);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setShowTooltip(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div data-testid={`nav-item-${page.slug}`} className="relative">
      <button
        ref={buttonRef}
        onClick={onClick}
        aria-selected={isActive}
        className={`
          relative flex items-center w-full
          pl-9 pr-2.5 py-[7px]
          text-[13px] text-content
          rounded-lg
          transition-colors duration-150
          hover:bg-surface-hover
          aria-selected:bg-accent-light
          aria-selected:text-accent-text
          aria-selected:hover:bg-accent-light
        `}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {isActive && (
          <div className="absolute left-1 top-1/2 -translate-y-1/2 w-[3px] h-3/5 rounded-r-full bg-accent" />
        )}
        <span className="truncate">{page.title}</span>
      </button>

      {/* 悬停提示 */}
      {showTooltip && (
        <div
          className="
            fixed z-[1000]
            bg-surface border border-edge
            rounded-lg shadow-lg
            p-2.5 min-w-[120px]
            pointer-events-none
            animate-fade-in
          "
          style={{
            left: buttonRef.current?.getBoundingClientRect().left ?? 0,
            top: tooltipPosition === 'top'
              ? (buttonRef.current?.getBoundingClientRect().top ?? 0) - 60
              : (buttonRef.current?.getBoundingClientRect().bottom ?? 0) + 8,
          }}
        >
          <div className="text-[13px] font-semibold text-content mb-1.5 leading-snug">
            {page.title}
          </div>
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium leading-snug border ${levelClass}`}>
            {page.level}
          </span>
        </div>
      )}
    </div>
  );
});

/** 导航分组项组件 */
const GroupItem: React.FC<{
  name: string;
  pages: WikiPage[];
  expanded: boolean;
  currentSlug: string | undefined;
  onToggle: () => void;
  onPageClick: (page: WikiPage) => void;
}> = ({ name, pages, expanded, currentSlug, onToggle, onPageClick }) => {
  return (
    <div>
      <button
        onClick={onToggle}
        className="
          flex items-center gap-1.5 w-full text-left
          pl-7 pr-2.5 py-1.5
          text-[13px] font-medium text-content-secondary
          rounded-lg
          transition-colors duration-150
          hover:bg-surface-hover
        "
      >
        <ChevronRightIcon size={11} rotated={expanded} />
        <span className="flex-1 truncate">{name}</span>
        <span className="text-[11px] text-content-muted">{pages.length}</span>
      </button>

      {expanded && (
        <div>
          {pages.map((page) => (
            <PageItem
              key={page.slug}
              page={page}
              isActive={page.slug === currentSlug}
              onClick={() => onPageClick(page)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/** 导航分区项组件 */
const SectionItem: React.FC<{
  section: NavSection;
  expanded: boolean;
  currentSlug: string | undefined;
  expandedGroups: string[];
  onToggleSection: () => void;
  onToggleGroup: (group: string) => void;
  onPageClick: (page: WikiPage) => void;
}> = ({
  section,
  expanded,
  currentSlug,
  expandedGroups,
  onToggleSection,
  onToggleGroup,
  onPageClick,
}) => {
  return (
    <div className="mb-0.5">
      <button
        onClick={onToggleSection}
        className="
          flex items-center gap-2 w-full text-left
          px-2.5 py-2
          text-[13px] font-semibold text-content
          rounded-lg
          transition-colors duration-150
          hover:bg-surface-hover
        "
      >
        <ChevronRightIcon size={12} rotated={expanded} />
        <span className="flex-1 truncate">{section.name}</span>
      </button>

      {expanded && (
        <div>
          {section.groups.map((group) => (
            <GroupItem
              key={group.name}
              name={group.name}
              pages={group.pages}
              expanded={expandedGroups.includes(`${section.name}::${group.name}`)}
              currentSlug={currentSlug}
              onToggle={() => onToggleGroup(`${section.name}::${group.name}`)}
              onPageClick={onPageClick}
            />
          ))}
          {section.ungroupedPages.map((page) => (
            <PageItem
              key={page.slug}
              page={page}
              isActive={page.slug === currentSlug}
              onClick={() => onPageClick(page)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/** 折叠模式下的分区图标项（悬停弹出页面列表） */
const SidebarIconItem: React.FC<{
  section: NavSection;
  isActive: boolean;
  currentSlug: string | undefined;
  onPageClick: (page: WikiPage) => void;
}> = ({ section, isActive, currentSlug, onPageClick }) => {
  const [showPanel, setShowPanel] = useState(false);
  const [tooltipUp, setTooltipUp] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iconRef = useRef<HTMLButtonElement>(null);

  const allPages = [
    ...section.ungroupedPages,
    ...section.groups.flatMap(g => g.pages),
  ];

  const handleMouseEnter = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      const rect = iconRef.current?.getBoundingClientRect();
      if (rect) {
        setTooltipUp((window.innerHeight - rect.bottom) < 200);
      }
      setShowPanel(true);
    }, 200);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setShowPanel(false);
  }, []);

  const initial = section.name.charAt(0).toUpperCase();

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        ref={iconRef}
        className={`
          w-9 h-9 rounded-lg text-[13px] font-semibold
          flex items-center justify-center
          transition-colors duration-150 cursor-pointer
          ${isActive
            ? 'bg-accent-light text-accent-text'
            : 'text-content-tertiary hover:bg-surface-hover hover:text-content'
          }
        `}
        title={section.name}
      >
        {initial}
      </button>

      {/* 浮动页面列表 */}
      {showPanel && (
        <div
          className={`
            fixed z-[1000]
            bg-surface border border-edge
            rounded-lg shadow-lg
            py-1.5 min-w-[180px] max-h-[400px] overflow-y-auto
            pointer-events-auto
          `}
          style={{
            left: (iconRef.current?.getBoundingClientRect().right ?? 0) + 8,
            top: tooltipUp
              ? (iconRef.current?.getBoundingClientRect().bottom ?? 0) - Math.min(allPages.length * 36 + 40, 400)
              : iconRef.current?.getBoundingClientRect().top ?? 0,
          }}
          onMouseEnter={() => {
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
          }}
          onMouseLeave={handleMouseLeave}
        >
          <div className="px-3 py-1.5 text-[11px] font-semibold text-content-muted uppercase tracking-wider">
            {section.name}
          </div>
          {section.groups.map(group => (
            <div key={group.name}>
              <div className="px-3 py-1 text-[11px] font-medium text-content-tertiary">
                {group.name}
              </div>
              {group.pages.map(page => (
                <button
                  key={page.slug}
                  onClick={() => {
                    onPageClick(page);
                    setShowPanel(false);
                  }}
                  className={`
                    w-full text-left px-4 py-1.5 text-[12px] truncate
                    transition-colors duration-100 cursor-pointer
                    ${page.slug === currentSlug
                      ? 'text-accent font-medium bg-accent-light'
                      : 'text-content-secondary hover:bg-surface-hover hover:text-content'
                    }
                  `}
                >
                  {page.title}
                </button>
              ))}
            </div>
          ))}
          {section.ungroupedPages.map(page => (
            <button
              key={page.slug}
              onClick={() => {
                onPageClick(page);
                setShowPanel(false);
              }}
              className={`
                w-full text-left px-4 py-1.5 text-[12px] truncate
                transition-colors duration-100 cursor-pointer
                ${page.slug === currentSlug
                  ? 'text-accent font-medium bg-accent-light'
                  : 'text-content-secondary hover:bg-surface-hover hover:text-content'
                }
              `}
            >
              {page.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ===== 主侧边栏组件 =====

/** 会话池状态指示器 */
const PoolStatsIndicator: React.FC = () => {
  const poolStats = useAIStore((s) => s.poolStats);
  const fetchPoolStats = useAIStore((s) => s.fetchPoolStats);

  useEffect(() => {
    // 初次加载时获取一次池状态
    fetchPoolStats();
    // 每 30 秒轮询更新
    const timer = setInterval(fetchPoolStats, 30000);
    return () => clearInterval(timer);
  }, [fetchPoolStats]);

  if (!poolStats) return null;

  return (
    <div className="px-4 py-2 border-t border-edge text-[11px] text-content-tertiary flex items-center gap-1.5 select-none">
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          poolStats.activeCount >= poolStats.maxSessions
            ? 'bg-warning'
            : 'bg-accent'
        }`}
      />
      <span>
        会话 {poolStats.activeCount}/{poolStats.maxSessions}
      </span>
    </div>
  );
};

/**
 * 侧边栏导航组件
 * 支持展开和折叠两种模式，展示分区-分组-页面的树形导航结构
 */
const Sidebar: React.FC = () => {
  const currentWiki = useAppStore((s) => s.currentWiki);
  const currentView = useAppStore((s) => s.currentView);
  const config = useAppStore((s) => s.config);
  const expandedSections = useAppStore((s) => s.expandedSections);
  const expandedGroups = useAppStore((s) => s.expandedGroups);
  const toggleSection = useAppStore((s) => s.toggleSection);
  const toggleGroup = useAppStore((s) => s.toggleGroup);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const setCurrentWiki = useAppStore((s) => s.setCurrentWiki);
  const setLoadingWiki = useAppStore((s) => s.setLoadingWiki);
  const setLoadingPage = useAppStore((s) => s.setLoadingPage);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setAvailableVersions = useAppStore((s) => s.setAvailableVersions);

  const projectId = config?.lastOpenedProject;

  useEffect(() => {
    if (!projectId) {
      setCurrentWiki(null);
      setCurrentView(null);
      setAvailableVersions([]);
      return;
    }

    let cancelled = false;
    setLoadingWiki(true);
    setCurrentView(null);

    getWiki(projectId)
      .then((wiki) => {
        if (!cancelled) {
          setCurrentWiki(wiki);
        }
      })
      .catch((err) => {
        console.error('加载 Wiki 失败:', err);
        if (!cancelled) {
          setCurrentWiki(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingWiki(false);
      });

    // 加载可用版本列表
    getWikiVersions(projectId)
      .then((versions) => {
        if (!cancelled) {
          setAvailableVersions(versions);
          // 设置当前选中版本为 currentPointer 指向的版本
          const currentVersion = versions.find((v) => v.isCurrent);
          if (currentVersion) {
            const project = useAppStore.getState().projects.find((p) => p.id === projectId);
            useAppStore.setState({ selectedVersion: project?.currentVersion || currentVersion.version });
          }
        }
      })
      .catch((err) => {
        console.error('加载版本列表失败:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, setCurrentWiki, setCurrentView, setLoadingWiki, setAvailableVersions]);

  const navTree = useMemo(() => {
    if (!currentWiki) return null;
    return buildNavTree(currentWiki);
  }, [currentWiki]);

  useEffect(() => {
    if (navTree && navTree.sections.length > 0) {
      const allSections = navTree.sections.map(s => s.name);
      const allGroups = navTree.sections.flatMap(section =>
        section.groups.map(g => `${section.name}::${g.name}`)
      );

      useAppStore.getState().setExpandedSections(allSections);
      useAppStore.getState().setExpandedGroups(allGroups);

      const firstSection = navTree.sections[0];
      const firstPage = firstSection.groups[0]?.pages[0] || firstSection.ungroupedPages[0];
      if (firstPage && !currentSlug) {
        handlePageClick(firstPage);
      }
    }
  }, [navTree]);

  const handlePageClick = async (page: WikiPage) => {
    if (!projectId) return;

    const project = useAppStore.getState().projects.find((p) => p.id === projectId);
    const version = project?.currentVersion || 'latest';

    setCurrentView({
      projectId,
      version,
      slug: page.slug,
      content: '',
      loading: true,
      mode: 'read',
      editContent: null,
      isDirty: false,
      fileMtime: null,
      conflictData: null,
    });

    try {
      const result = await getPage(projectId, version, page.slug);
      setCurrentView({
        projectId,
        version,
        slug: page.slug,
        content: result.content,
        loading: false,
        mode: 'read',
        editContent: null,
        isDirty: false,
        fileMtime: result.mtime,
        conflictData: null,
      });
    } catch (err) {
      setCurrentView({
        projectId,
        version,
        slug: page.slug,
        content: '',
        loading: false,
        error: err instanceof Error ? err.message : '加载页面失败',
        mode: 'read',
        editContent: null,
        isDirty: false,
        fileMtime: null,
        conflictData: null,
      });
    }
  };

  const currentSlug = currentView?.slug;

  // ===== 折叠模式：图标栏 =====
  if (!sidebarOpen) {
    return (
      <aside className="w-[48px] h-full border-r border-edge bg-surface-tertiary flex flex-col shrink-0 items-center py-3 gap-1 shadow-[inset_-4px_0_12px_rgba(0,0,0,0.05)]">
        {/* 展开按钮 */}
        <button
          data-testid="sidebar-toggle"
          onClick={toggleSidebar}
          className="p-2 rounded-lg text-content-tertiary hover:bg-surface-hover hover:text-content transition-colors duration-150 cursor-pointer"
          title="展开导航"
        >
          <ExpandIcon size={16} />
        </button>

        {/* 分区图标列表 */}
        {navTree?.sections.map((section) => {
          const allPages = [
            ...section.ungroupedPages,
            ...section.groups.flatMap(g => g.pages),
          ];
          const isActive = allPages.some(p => p.slug === currentSlug);

          return (
            <SidebarIconItem
              key={section.name}
              section={section}
              isActive={isActive}
              currentSlug={currentSlug}
              onPageClick={(page) => {
                handlePageClick(page);
              }}
            />
          );
        })}
      </aside>
    );
  }

  // ===== 展开模式：完整导航 =====
  return (
    <aside className="h-full border-r border-edge bg-surface-tertiary flex flex-col shrink-0 overflow-hidden shadow-[inset_-4px_0_12px_rgba(0,0,0,0.05)]" style={{ width: 'var(--sidebar-width)' }}>
      {/* 侧边栏头部 */}
      <div className="
        flex items-center justify-between
        px-4 py-3.5
        border-b border-edge
        text-[11px] font-semibold uppercase tracking-wider
        text-content-muted select-none
      ">
        <span>导航</span>
        <button
          data-testid="sidebar-toggle"
          onClick={toggleSidebar}
          className="p-1 rounded text-content-muted hover:text-content hover:bg-surface-hover transition-colors duration-150 cursor-pointer"
          title="折叠导航"
        >
          <CollapseIcon size={14} />
        </button>
      </div>

      {/* 版本选择器 */}
      <VersionSelector />

      {/* 导航树 */}
      <nav data-testid="wiki-nav" className="flex-1 overflow-y-auto py-2 px-2">
        {!navTree ? (
          <div className="px-4 py-6 text-center text-[13px] text-content-tertiary">
            {projectId ? '加载中...' : '请先选择一个项目'}
          </div>
        ) : navTree.sections.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-content-tertiary">
            暂无内容
          </div>
        ) : (
          navTree.sections.map((section) => (
            <SectionItem
              key={section.name}
              section={section}
              expanded={expandedSections.includes(section.name)}
              currentSlug={currentSlug}
              expandedGroups={expandedGroups}
              onToggleSection={() => toggleSection(section.name)}
              onToggleGroup={(group) => toggleGroup(group)}
              onPageClick={handlePageClick}
            />
          ))
        )}
      </nav>

      {/* 池状态指示器 */}
      <PoolStatsIndicator />
    </aside>
  );
};

export default Sidebar;
