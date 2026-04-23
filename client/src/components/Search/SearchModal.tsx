import React, { useEffect, useRef, useCallback } from 'react';
import { useDebouncedCallback } from 'use-debounce';
import { useAppStore } from '../../stores/app';
import { searchProject, getPage } from '../../services/api';
import type { SearchResult, WikiPage } from '@shared/types';

// ===== 图标组件 =====
const SearchIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
);

const CloseIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </svg>
);

const FileIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

/** 搜索结果项组件 */
const SearchResultItem: React.FC<{
  result: SearchResult;
  onClick: () => void;
}> = React.memo(({ result, onClick }) => {
  const levelClass =
    result.page.level === 'Beginner'
      ? 'badge-beginner'
      : result.page.level === 'Intermediate'
        ? 'badge-intermediate'
        : 'badge-advanced';

  return (
    <button
      data-testid="search-result-item"
      onClick={onClick}
      className="
        flex items-start gap-2.5 w-full px-3.5 py-2.5
        border-none bg-transparent text-content
        cursor-pointer text-left rounded-md
        transition-colors duration-150
        hover:bg-surface-hover
      "
    >
      <FileIcon size={16} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-medium text-[13px] truncate">
            {result.page.title}
          </span>
          <span className={`badge ${levelClass}`}>
            {result.page.level}
          </span>
        </div>
        <div className="text-[12px] text-content-tertiary truncate">
          {result.page.section}
          {result.page.group ? ` / ${result.page.group}` : ''}
        </div>
        {result.content && (
          <div className="text-[12px] text-content-secondary mt-1 truncate max-w-full">
            {result.content}
          </div>
        )}
      </div>
    </button>
  );
});

/**
 * 全局搜索弹窗组件
 * 支持全文搜索，实时防抖查询，点击结果跳转到对应页面
 */
const SearchModal: React.FC = () => {
  const searchOpen = useAppStore((s) => s.searchOpen);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const searchResults = useAppStore((s) => s.searchResults);
  const config = useAppStore((s) => s.config);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const setSearchResults = useAppStore((s) => s.setSearchResults);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  const inputRef = useRef<HTMLInputElement>(null);

  // 弹窗打开时自动聚焦输入框
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [searchOpen]);

  // 防抖搜索
  const debouncedSearch = useDebouncedCallback(
    async (query: string) => {
      if (!query.trim()) {
        setSearchResults([]);
        return;
      }

      const projectId = config?.lastOpenedProject;
      if (!projectId) {
        setSearchResults([]);
        return;
      }

      try {
        const results = await searchProject(projectId, query);
        setSearchResults(results);
      } catch (err) {
        console.error('搜索失败:', err);
        setSearchResults([]);
      }
    },
    200,
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchQuery(value);
      debouncedSearch(value);
    },
    [setSearchQuery, debouncedSearch],
  );

  const handleResultClick = useCallback(
    (result: SearchResult) => {
      if (result.projectId !== config?.lastOpenedProject) {
        setCurrentProject(result.projectId);
      }

      const project = useAppStore
        .getState()
        .projects.find((p) => p.id === result.projectId);
      const version = project?.currentVersion || 'latest';

      setCurrentView({
        projectId: result.projectId,
        version,
        slug: result.page.slug,
        content: '',
        loading: true,
        mode: 'read',
        editContent: null,
        isDirty: false,
        fileMtime: null,
        conflictData: null,
      });

      getPage(result.projectId, version, result.page.slug)
        .then((pageResult) => {
          setCurrentView({
            projectId: result.projectId,
            version,
            slug: result.page.slug,
            content: pageResult.content,
            loading: false,
            mode: 'read',
            editContent: null,
            isDirty: false,
            fileMtime: pageResult.mtime,
            conflictData: null,
          });
        })
        .catch((err) => {
          setCurrentView({
            projectId: result.projectId,
            version,
            slug: result.page.slug,
            content: '',
            loading: false,
            error: err instanceof Error ? err.message : '加载页面失败',
            mode: 'read',
            editContent: null,
            isDirty: false,
            fileMtime: null,
            conflictData: null,
          });
        });

      setSearchOpen(false);
    },
    [config?.lastOpenedProject, setCurrentProject, setCurrentView, setSearchOpen, getPage],
  );

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        setSearchOpen(false);
      }
    },
    [setSearchOpen],
  );

  if (!searchOpen) return null;

  return (
    <div
      data-testid="search-modal"
      className="overlay overlay-centered"
      onClick={handleOverlayClick}
    >
      <div
        className="
          modal max-h-[70vh]
          bg-surface-secondary border border-edge
          rounded-xl shadow-lg
          flex flex-col overflow-hidden
        "
        style={{ maxWidth: 'clamp(420px, 45vw, 600px)' }}
      >
        {/* 搜索输入框 */}
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-edge">
          <SearchIcon size={18} />
          <input
            ref={inputRef}
            data-testid="search-input"
            type="text"
            value={searchQuery}
            onChange={handleInputChange}
            placeholder="搜索文档..."
            className="
              flex-1 border-none outline-none bg-transparent
              text-content text-[15px]
            "
          />
          <button
            onClick={() => setSearchOpen(false)}
            className="
              flex items-center justify-center
              w-7 h-7 border border-edge rounded-md
              bg-surface-tertiary text-content-tertiary
              cursor-pointer text-[11px]
              hover:bg-surface-hover hover:text-content
              transition-colors duration-150
            "
            title="关闭 (Esc)"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        {/* 搜索结果 */}
        <div className="flex-1 overflow-y-auto p-2">
          {searchQuery && searchResults.length === 0 ? (
            <div data-testid="search-no-result" className="py-6 px-4 text-center text-content-tertiary text-[13px]">
              没有找到相关结果
            </div>
          ) : !searchQuery ? (
            <div className="py-6 px-4 text-center text-content-tertiary text-[13px]">
              输入关键词开始搜索
            </div>
          ) : (
            searchResults.map((result, index) => (
              <SearchResultItem
                key={`${result.projectId}-${result.page.slug}-${index}`}
                result={result}
                onClick={() => handleResultClick(result)}
              />
            ))
          )}
        </div>

        {/* 底部提示 */}
        {searchResults.length > 0 && (
          <div className="px-4 py-2 border-t border-edge text-[11px] text-content-tertiary text-center">
            找到 {searchResults.length} 个结果
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchModal;
