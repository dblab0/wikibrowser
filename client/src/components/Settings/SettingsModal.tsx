import React, { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../../stores/app';
import {
  updateConfig,
  addProject,
  deleteProject,
  triggerScan,
  getScanStatus,
  getConfig,
  refreshProjectCache,
} from '../../services/api';
import type { ScanStatus, ProjectConfig } from '@shared/types';

// ===== 图标组件 =====
const CloseIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </svg>
);

const PlusIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

const TrashIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const RefreshIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const SunIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

const MoonIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const ZapIcon: React.FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const FolderIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);

/**
 * 设置弹窗组件
 * 包含通用设置（主题、AI 自动审批）、项目管理和扫描路径配置
 */
const SettingsModal: React.FC = () => {
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const config = useAppStore((s) => s.config);
  const projects = useAppStore((s) => s.projects);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setConfig = useAppStore((s) => s.setConfig);
  const setProjects = useAppStore((s) => s.setProjects);

  const [newPath, setNewPath] = useState('');
  const [newProjectPath, setNewProjectPath] = useState('');
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshingProjects, setRefreshingProjects] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'general' | 'projects' | 'scan'>('general');

  // 打开时获取扫描状态
  useEffect(() => {
    if (settingsOpen) {
      getScanStatus()
        .then(setScanStatus)
        .catch(() => {});
    }
  }, [settingsOpen]);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        setSettingsOpen(false);
      }
    },
    [setSettingsOpen],
  );

  const handleThemeToggle = useCallback(async () => {
    if (!config) return;
    const newTheme = config.theme === 'dark' ? 'light' : 'dark';
    try {
      const updated = await updateConfig({ theme: newTheme });
      setConfig(updated);
    } catch (err) {
      console.error('更新主题失败:', err);
    }
  }, [config, setConfig]);

  const handleYoloToggle = useCallback(async () => {
    if (!config) return;
    try {
      const updated = await updateConfig({ yolo: !config.yolo });
      setConfig(updated);
    } catch (err) {
      console.error('更新 AI 自动审批设置失败:', err);
    }
  }, [config, setConfig]);

  const handleAddScanPath = useCallback(async () => {
    if (!newPath.trim()) return;
    setError(null);
    try {
      const updated = await updateConfig({
        scanPaths: [...(config?.scanPaths || []), newPath.trim()],
      });
      setConfig(updated);
      setNewPath('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加扫描路径失败');
    }
  }, [newPath, config, setConfig]);

  const handleRemoveScanPath = useCallback(
    async (path: string) => {
      if (!config) return;
      setError(null);
      try {
        const updated = await updateConfig({
          scanPaths: config.scanPaths.filter((p) => p !== path),
        });
        setConfig(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : '移除扫描路径失败');
      }
    },
    [config, setConfig],
  );

  const handleAddProject = useCallback(async () => {
    if (!newProjectPath.trim()) return;
    setError(null);
    try {
      const project = await addProject(newProjectPath.trim());
      setProjects([...projects, project]);
      setNewProjectPath('');
      const updatedConfig = await getConfig();
      setConfig(updatedConfig);
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加项目失败');
    }
  }, [newProjectPath, projects, setProjects, setConfig]);

  const handleDeleteProject = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await deleteProject(id);
        setProjects(projects.filter((p) => p.id !== id));
        const updatedConfig = await getConfig();
        setConfig(updatedConfig);
      } catch (err) {
        setError(err instanceof Error ? err.message : '删除项目失败');
      }
    },
    [projects, setProjects, setConfig],
  );

  const handleScan = useCallback(async () => {
    setScanning(true);
    setError(null);

    try {
      await triggerScan();
      // 扫描完成，刷新配置和项目列表
      const updatedConfig = await getConfig();
      setConfig(updatedConfig);
      setProjects(updatedConfig.projects);
      // 更新扫描状态显示
      const status = await getScanStatus();
      setScanStatus(status);
    } catch (err) {
      if (err instanceof Error && err.message.includes('already in progress')) {
        setError('已有扫描正在进行中');
      } else {
        setError(err instanceof Error ? err.message : '扫描失败');
      }
    } finally {
      setScanning(false);
    }
  }, [setConfig, setProjects]);

  const handleRefreshProject = useCallback(async (id: string) => {
    setRefreshingProjects(prev => new Set(prev).add(id));
    setError(null);
    try {
      await refreshProjectCache(id);
      // 成功后客户端缓存已在 refreshProjectCache 内部清除，无需额外操作
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新缓存失败');
    } finally {
      setRefreshingProjects(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  if (!settingsOpen) return null;

  const isDark = config?.theme === 'dark';
  const isYolo = !!config?.yolo;

  return (
    <div className="overlay overlay-centered" onClick={handleOverlayClick}>
      <div
        className="
          modal max-h-[80vh]
          bg-surface-secondary border border-edge
          rounded-xl shadow-lg
          flex flex-col overflow-hidden
        "
        style={{ width: 'clamp(480px, 50vw, 800px)' }}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <h2 className="text-[16px] font-semibold text-content m-0">
            设置
          </h2>
          <button
            onClick={() => setSettingsOpen(false)}
            className="
              flex items-center justify-center
              w-8 h-8 border-none rounded-md
              bg-transparent text-content-secondary
              cursor-pointer
              hover:bg-surface-hover hover:text-content
              transition-colors duration-150
            "
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {/* 选项卡 */}
        <div className="flex border-b border-edge px-5">
          {(
            [
              { key: 'general', label: '通用' },
              { key: 'projects', label: '项目管理' },
              { key: 'scan', label: '扫描' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`
                px-4 py-2.5 border-none bg-transparent cursor-pointer text-[13px]
                transition-colors duration-150
                ${activeTab === tab.key
                  ? 'border-b-2 border-accent text-accent font-medium'
                  : 'border-b-2 border-transparent text-content-secondary font-normal hover:text-content'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mx-5 mt-3 px-3 py-2 rounded-md bg-danger-light border border-danger text-danger text-[13px]">
            {error}
          </div>
        )}

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* 通用设置 */}
          {activeTab === 'general' && (
            <div>
              {/* 主题切换 */}
              <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-surface-tertiary mb-4">
                <div className="flex items-center gap-2.5">
                  {isDark ? <MoonIcon size={18} /> : <SunIcon size={18} />}
                  <div>
                    <div className="text-[14px] font-medium text-content">
                      主题
                    </div>
                    <div className="text-[12px] text-content-tertiary">
                      {isDark ? '暗色模式' : '浅色模式'}
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleThemeToggle}
                  className="
                    relative w-11 h-6 rounded-full border-none
                    cursor-pointer transition-colors duration-200 p-0
                  "
                  style={{ background: isDark ? 'var(--accent)' : 'var(--surface-hover)' }}
                >
                  <div
                    className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all duration-200 shadow-sm"
                    style={{ left: isDark ? '23px' : '3px' }}
                  />
                </button>
              </div>

              {/* AI 自动审批切换 */}
              <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-surface-tertiary">
                <div className="flex items-center gap-2.5">
                  <ZapIcon size={18} />
                  <div>
                    <div className="text-[14px] font-medium text-content">
                      AI 自动审批
                    </div>
                    <div className="text-[12px] text-content-tertiary">
                      {isYolo ? '已启用' : '已关闭'} — 启用后 AI 操作无需手动确认
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleYoloToggle}
                  className="
                    relative w-11 h-6 rounded-full border-none
                    cursor-pointer transition-colors duration-200 p-0
                  "
                  style={{ background: isYolo ? 'var(--warning)' : 'var(--surface-hover)' }}
                >
                  <div
                    className="absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white transition-all duration-200 shadow-sm"
                    style={{ left: isYolo ? '23px' : '3px' }}
                  />
                </button>
              </div>
            </div>
          )}
          {activeTab === 'projects' && (
            <div>
              {/* 手动添加项目 */}
              <div className="mb-5">
                <label className="block text-[13px] font-medium text-content mb-1.5">
                  手动添加项目
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="input"
                    value={newProjectPath}
                    onChange={(e) => setNewProjectPath(e.target.value)}
                    placeholder="输入项目路径..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddProject();
                    }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={handleAddProject}
                  >
                    <PlusIcon size={14} />
                    添加
                  </button>
                </div>
              </div>

              {/* 项目列表 */}
              <div>
                <label className="block text-[13px] font-medium text-content mb-2">
                  已发现的项目 ({projects.length})
                </label>

                {projects.length === 0 ? (
                  <div className="py-5 px-4 text-center text-content-tertiary text-[13px] bg-surface-tertiary rounded-lg">
                    暂无项目，请手动添加或扫描发现
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {projects.map((project) => (
                      <div
                        key={project.id}
                        data-testid="project-card"
                        className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-surface-tertiary border border-edge-light"
                      >
                        <FolderIcon size={16} />
                        <div className="flex-1 min-w-0">
                          <div data-testid="project-name" className="text-[13px] font-medium text-content truncate">
                            {project.name}
                          </div>
                          <div className="text-[11px] text-content-tertiary truncate">
                            {project.path}
                          </div>
                        </div>
                        <button
                          className="btn btn-icon"
                          onClick={() => handleRefreshProject(project.id)}
                          title="刷新缓存"
                          disabled={refreshingProjects.has(project.id)}
                          style={{
                            color: 'var(--content-secondary)',
                            flexShrink: 0,
                            animation: refreshingProjects.has(project.id) ? 'spin 1s linear infinite' : undefined,
                          }}
                        >
                          <RefreshIcon size={14} />
                        </button>
                        <button
                          className="btn btn-icon"
                          onClick={() => handleDeleteProject(project.id)}
                          title="删除项目"
                          style={{ color: 'var(--danger)', flexShrink: 0 }}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 扫描设置 */}
          {activeTab === 'scan' && (
            <div>
              {/* 扫描路径 */}
              <div className="mb-5">
                <label className="block text-[13px] font-medium text-content mb-1.5">
                  扫描路径
                </label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    className="input"
                    value={newPath}
                    onChange={(e) => setNewPath(e.target.value)}
                    placeholder="输入要扫描的目录路径..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddScanPath();
                    }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={handleAddScanPath}
                  >
                    <PlusIcon size={14} />
                    添加
                  </button>
                </div>

                {/* 路径列表 */}
                {(config?.scanPaths || []).length === 0 ? (
                  <div className="p-3 text-center text-content-tertiary text-[13px] bg-surface-tertiary rounded-md">
                    暂无扫描路径
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {(config?.scanPaths || []).map((path) => (
                      <div
                        key={path}
                        className="flex items-center gap-2 px-3 py-2 rounded-md bg-surface-tertiary border border-edge-light text-[13px] text-content-secondary"
                      >
                        <FolderIcon size={13} />
                        <span className="flex-1 truncate">
                          {path}
                        </span>
                        <button
                          className="btn btn-icon"
                          onClick={() => handleRemoveScanPath(path)}
                          style={{ color: 'var(--danger)' }}
                        >
                          <TrashIcon size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 扫描按钮和状态 */}
              <div>
                <button
                  className="btn btn-primary mb-3"
                  onClick={handleScan}
                  disabled={scanning}
                  style={{
                    opacity: scanning ? 0.7 : 1,
                    cursor: scanning ? 'not-allowed' : 'pointer',
                  }}
                >
                  <RefreshIcon size={14} />
                  {scanning ? '扫描中...' : '开始扫描'}
                </button>

                {scanStatus && (
                  <div className="px-4 py-3 rounded-lg bg-surface-tertiary border border-edge-light text-[13px]">
                    <div className="text-content mb-1">
                      状态：{scanStatus.scanning ? '扫描中' : '空闲'}
                    </div>
                    {scanStatus.progress && (
                      <div className="text-content-secondary text-[12px]">
                        已扫描 {scanStatus.progress.scanned}/{scanStatus.progress.total}，
                        发现 {scanStatus.progress.found} 个项目
                      </div>
                    )}
                    {scanStatus.lastScanAt && (
                      <div className="text-content-tertiary text-[11px] mt-1">
                        上次扫描：{new Date(scanStatus.lastScanAt).toLocaleString('zh-CN')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
