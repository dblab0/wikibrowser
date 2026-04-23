import React from 'react';
import { useAppStore } from '../../stores/app';

/**
 * 编辑/阅读模式切换按钮
 */
const ModeToggle: React.FC = () => {
  const mode = useAppStore((s) => s.currentView?.mode);
  const isDirty = useAppStore((s) => s.currentView?.isDirty);
  const setEditMode = useAppStore((s) => s.setEditMode);
  const setReadMode = useAppStore((s) => s.setReadMode);

  const handleToggle = () => {
    if (mode === 'edit') {
      if (isDirty) {
        const confirmed = window.confirm('未保存的修改将丢失，是否继续？');
        if (!confirmed) return;
      }
      setReadMode();
    } else {
      setEditMode();
    }
  };

  return (
    <button
      onClick={handleToggle}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium
                 text-content-secondary hover:text-content hover:bg-surface-hover
                 border border-edge-light transition-colors duration-150"
      title={mode === 'edit' ? '切换到阅读模式' : '切换到编辑模式'}
    >
      {mode === 'edit' ? (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          阅读
        </>
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
          </svg>
          编辑
        </>
      )}
    </button>
  );
};

export default ModeToggle;
