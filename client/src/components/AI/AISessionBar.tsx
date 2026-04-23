import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { AISession } from '@shared/types';
import { useAIStore } from '../../stores/ai';
import { useAppStore } from '../../stores/app';
import { aiApi } from '../../services/ai-api';

/**
 * 格式化时间戳为相对时间描述
 * @param timestamp 时间戳（毫秒）
 * @returns 相对时间文本
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const PlusIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const TrashIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const CloseIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const ChevronIcon: React.FC<{ size?: number; open?: boolean }> = ({ size = 12, open }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/**
 * AI 会话管理栏组件
 * 支持切换会话、新建会话、删除会话等操作
 */
const AISessionBar: React.FC = () => {
  const sessions = useAIStore((s) => s.aiSessions);
  const activeSessionId = useAIStore((s) => s.activeSessionId);
  const setActiveSession = useAIStore((s) => s.setActiveSession);
  const setAIPanelOpen = useAIStore((s) => s.setAIPanelOpen);
  const setAISessions = useAIStore((s) => s.setAISessions);
  const setAIMessages = useAIStore((s) => s.setAIMessages);
  const streaming = useAIStore((s) => s.aiStreaming);
  const config = useAppStore((s) => s.config);
  const projects = useAppStore((s) => s.projects);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentProjectId = config?.lastOpenedProject;
  const currentProject = projects.find((p) => p.id === currentProjectId);
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const handleNewSession = useCallback(async () => {
    if (!currentProject || streaming) return;
    try {
      const result = await aiApi.createSession(currentProject.id, currentProject.path);
      const newSession: AISession = {
        id: result.id, projectId: currentProject.id, projectPath: currentProject.path,
        title: '新对话', status: 'active', createdAt: Date.now(), updatedAt: Date.now(),
      };
      setAISessions([...sessions, newSession]);
      setActiveSession(result.id);
      setAIMessages([]);
    } catch (err) { console.error('Failed to create session:', err); }
    setDropdownOpen(false);
  }, [currentProject, streaming, sessions, setAISessions, setActiveSession, setAIMessages]);

  const handleSwitchSession = useCallback(async (session: AISession) => {
    if (session.id === activeSessionId || streaming) return;
    try {
      setActiveSession(session.id);
      const detail = await aiApi.getSessionDetail(session.id);
      setAIMessages(detail.messages);
    } catch (err) { console.error('Failed to switch session:', err); }
    setDropdownOpen(false);
  }, [activeSessionId, streaming, setActiveSession, setAIMessages]);

  const handleDeleteSession = useCallback(async () => {
    if (!activeSessionId || streaming) return;
    if (!window.confirm('确定删除这个对话？此操作不可撤销。')) return;
    try {
      await aiApi.deleteSession(activeSessionId);
      if (currentProject) {
        const updated = await aiApi.listSessions(currentProject.id);
        setAISessions(updated);
        if (updated.length > 0) {
          const latest = updated[updated.length - 1];
          setActiveSession(latest.id);
          const detail = await aiApi.getSessionDetail(latest.id);
          setAIMessages(detail.messages);
        } else {
          setActiveSession(null);
          setAIMessages([]);
        }
      }
    } catch (err) { console.error('Failed to delete session:', err); }
  }, [activeSessionId, streaming, currentProject, setAISessions, setActiveSession, setAIMessages]);

  return (
    <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-edge bg-surface-secondary shrink-0">
      {/* Session dropdown */}
      <div ref={dropdownRef} className="relative flex-1 min-w-0">
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="flex items-center gap-1.5 w-full px-2.5 py-1.5 border border-edge rounded-md bg-surface text-content text-[13px] font-medium transition-colors duration-150 hover:border-content-tertiary"
        >
          <span className="flex-1 text-left truncate">{activeSession?.title || '新对话'}</span>
          <ChevronIcon open={dropdownOpen} />
        </button>
        {dropdownOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-edge rounded-lg shadow-lg z-50 max-h-[240px] overflow-auto animate-fade-in">
            {sessions.length === 0 ? (
              <div className="px-3 py-3 text-[13px] text-content-tertiary text-center">暂无历史对话</div>
            ) : sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => handleSwitchSession(session)}
                className={`
                  flex flex-col gap-0.5 w-full px-3 py-2 text-left
                  text-[13px] transition-colors duration-150
                  hover:bg-surface-hover
                  ${session.id === activeSessionId ? 'bg-accent-light text-accent-text' : 'text-content'}
                `}
              >
                <span className="font-medium truncate">{session.title || '新对话'}</span>
                <span className="text-[11px] text-content-tertiary">{formatRelativeTime(session.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button onClick={handleNewSession} disabled={streaming} title="新建对话"
        className="p-1.5 rounded-md text-content-tertiary hover:bg-surface-hover hover:text-content transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
      ><PlusIcon /></button>
      <button onClick={handleDeleteSession} disabled={!activeSessionId || streaming} title="删除当前对话"
        className="p-1.5 rounded-md text-content-tertiary hover:bg-surface-hover hover:text-danger transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
      ><TrashIcon /></button>
      <button onClick={() => setAIPanelOpen(false)} disabled={streaming} title="关闭 AI 面板"
        className="p-1.5 rounded-md text-content-tertiary hover:bg-surface-hover hover:text-danger transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
      ><CloseIcon /></button>
    </div>
  );
};

export { AISessionBar };
