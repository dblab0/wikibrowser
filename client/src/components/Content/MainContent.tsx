import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/app';
import { useAIStore } from '../../stores/ai';
import type { WikiPage } from '@shared/types';
import MarkdownRenderer from './MarkdownRenderer';
import MarkdownEditor from './MarkdownEditor';
import ModeToggle from './ModeToggle';
import Toc from '../Toc';

// ===== 图标组件 =====
const BookIcon: React.FC<{ size?: number }> = ({ size = 32 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

/**
 * 主内容区域组件
 * 根据状态展示欢迎页、加载中、错误提示或文档内容
 * 支持查看模式和编辑模式切换
 */
const MainContent: React.FC = () => {
  const currentView = useAppStore((s) => s.currentView);
  const currentWiki = useAppStore((s) => s.currentWiki);
  const aiPanelOpen = useAIStore((s) => s.aiPanelOpen);

  // 视口宽度小于 xl (1280px) 时隐藏 TOC
  const [isXl, setIsXl] = useState(() => window.innerWidth >= 1280);
  useEffect(() => {
    const handler = () => setIsXl(window.innerWidth >= 1280);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const currentPage = currentWiki?.pages.find(
    (p: WikiPage) => p.slug === currentView?.slug,
  );

  const levelClass =
    currentPage?.level === 'Beginner'
      ? 'bg-accent-light text-accent-text border-accent/15'
      : currentPage?.level === 'Intermediate'
        ? 'bg-warning-light text-[#92400e] border-warning/15'
        : 'bg-danger-light text-[#991b1b] border-danger/15';

  // 尚未加载视图 - 显示欢迎页
  if (!currentView) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-5 text-content-tertiary">
        <div className="w-16 h-16 rounded-2xl bg-surface-tertiary flex items-center justify-center text-content-muted">
          <BookIcon size={32} />
        </div>
        <div className="text-center">
          <p className="text-base font-semibold text-content mb-1">开始阅读</p>
          <p className="text-[13px] text-content-tertiary">
            从左侧导航选择一个页面，或按
            <kbd className="text-[11px] px-1.5 py-0.5 mx-1 rounded bg-surface-tertiary border border-edge-light font-mono">
              ⌘K
            </kbd>
            搜索
          </p>
        </div>
      </div>
    );
  }

  // 加载状态
  if (currentView.loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-content-tertiary">
        <div className="w-8 h-8 rounded-full border-2 border-edge border-t-accent animate-spin" />
        <p className="text-[13px]">加载中...</p>
      </div>
    );
  }

  // 错误状态
  if (currentView.error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-10">
        <div className="w-14 h-14 rounded-[14px] bg-danger-light text-danger flex items-center justify-center text-2xl font-bold">
          !
        </div>
        <p className="text-base font-semibold text-content">加载失败</p>
        <p className="text-[13px] text-content-secondary max-w-md text-center leading-relaxed">
          {currentView.error}
        </p>
      </div>
    );
  }

  // 内容视图
  const isEditMode = currentView.mode === 'edit';

  return (
    <div data-testid="wiki-content" className="flex-1 min-w-0 flex overflow-hidden">
      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* 页面头部 */}
        {currentPage && !isEditMode && (
          <div className="pt-7 pb-0 border-b border-edge-light bg-surface" style={{ paddingLeft: 'var(--content-padding-x)', paddingRight: 'var(--content-padding-x)' }}>
            <h1 data-testid="content-title" className="text-[26px] font-bold text-content leading-snug tracking-tight mb-2">
              {currentPage.title}
            </h1>
            <div className="flex items-center gap-3 pb-4 text-xs text-content-tertiary flex-wrap">
              <span>{currentPage.section}</span>
              {currentPage.group && (
                <>
                  <span className="text-edge">·</span>
                  <span>{currentPage.group}</span>
                </>
              )}
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium leading-snug border ${levelClass}`}>
                {currentPage.level}
              </span>
              <div className="flex-1" />
              <ModeToggle />
            </div>
          </div>
        )}

        {isEditMode ? (
          <MarkdownEditor />
        ) : (
          <>
            {/* Markdown 内容区 */}
            <div className="flex-1 mx-auto overflow-x-hidden" style={{ maxWidth: 'var(--content-max-width)', paddingLeft: 'var(--content-padding-x)', paddingRight: 'var(--content-padding-x)', paddingTop: 'var(--content-padding-top)', paddingBottom: 'var(--content-padding-bottom)' }}>
              <MarkdownRenderer content={currentView.content} />
            </div>
          </>
        )}
      </div>

      {/* TOC 面板 - 仅在 AI 面板关闭、非编辑模式、视口 >= xl 时显示 */}
      {currentView.content && !aiPanelOpen && !isEditMode && isXl && <Toc content={currentView.content} />}
    </div>
  );
};

export default MainContent;
