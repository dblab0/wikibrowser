import React, { useEffect, lazy, Suspense } from 'react';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import MainContent from './components/Content/MainContent';
import SearchModal from './components/Search/SearchModal';
const SettingsModal = lazy(() => import('./components/Settings/SettingsModal'));
const ReferenceModal = lazy(() => import('./components/ReferenceModal'));
const MermaidViewerModal = lazy(() => import('./components/MermaidViewerModal'));
const AIPanel = lazy(() => import('./components/AI/AIPanel').then(m => ({ default: m.AIPanel })));
import { useAppStore } from './stores/app';
import { useAIStore } from './stores/ai';
import { useTheme } from './hooks/useTheme';
import { useKeyboard } from './hooks/useKeyboard';
import { getConfig, getProjects, getWiki, getPage } from './services/api';

/**
 * 应用根组件，包含主布局、路由、模态框和 AI 面板
 * @returns React 元素
 */
const App: React.FC = () => {
  const setConfig = useAppStore((s) => s.setConfig);
  const setProjects = useAppStore((s) => s.setProjects);
  const setCurrentWiki = useAppStore((s) => s.setCurrentWiki);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const aiPanelOpen = useAIStore((s) => s.aiPanelOpen);

  // 应用主题
  useTheme();

  // 注册键盘快捷键
  useKeyboard();

  // 初始化：加载配置和项目列表
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const config = await getConfig();
        if (cancelled) return;
        setConfig(config);
        setProjects(config.projects);

        if (config.lastOpenedProject) {
          try {
            const wiki = await getWiki(config.lastOpenedProject);
            if (cancelled) return;
            setCurrentWiki(wiki);
          } catch (err) {
            console.error('加载上次打开的项目 Wiki 失败:', err);
          }
        }
      } catch (err) {
        console.error('应用初始化失败:', err);
      }
    }

    init();

    return () => {
      cancelled = true;
    };
  }, [setConfig, setProjects, setCurrentWiki]);

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen bg-surface text-content overflow-hidden">
        <Header />
        <div className="flex flex-1 min-h-0">
          <Sidebar />
          <main className="flex-1 flex flex-col min-w-0">
            <MainContent />
          </main>
          {/* AI 面板打开时占据右侧区域 */}
          {aiPanelOpen && (
            <Suspense fallback={<div className="ai-panel-loading">加载 AI...</div>}>
              <AIPanel />
            </Suspense>
          )}
        </div>
      </div>

      {/* ===== 模态框区域 ===== */}
      <SearchModal />
      <Suspense fallback={null}>
        <SettingsModal />
        <ReferenceModal />
        <MermaidViewerModal />
      </Suspense>
    </ErrorBoundary>
  );
};

export default App;
