import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/app';
import ConflictDialog from './ConflictDialog';

/**
 * Markdown 编辑器组件
 * 提供文档编辑功能，支持 Ctrl+S 保存和冲突检测
 */
const MarkdownEditor: React.FC = () => {
  const editContent = useAppStore((s) => s.currentView?.editContent ?? '');
  const isDirty = useAppStore((s) => s.currentView?.isDirty ?? false);
  const conflictData = useAppStore((s) => s.currentView?.conflictData);
  const updateEditContent = useAppStore((s) => s.updateEditContent);
  const setReadMode = useAppStore((s) => s.setReadMode);
  const savePage = useAppStore((s) => s.savePage);

  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      await savePage();
    } catch (err) {
      console.error('保存失败:', err);
      alert('保存失败: ' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setSaving(false);
    }
  }, [savePage, saving]);

  const handleCancel = useCallback(() => {
    if (isDirty) {
      const confirmed = window.confirm('未保存的修改将丢失，是否继续？');
      if (!confirmed) return;
    }
    setReadMode();
  }, [isDirty, setReadMode]);

  // Ctrl+S / Cmd+S 保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 工具栏 */}
      <div className="editor-toolbar">
        <button
          onClick={handleCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium
                     text-content-secondary hover:text-content hover:bg-surface-hover
                     transition-colors duration-150"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m12 19-7-7 7-7" />
            <path d="M19 12H5" />
          </svg>
          返回阅读
        </button>

        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="text-[12px] text-content-tertiary">未保存</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-medium
                       bg-accent text-white hover:bg-accent-hover
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors duration-150"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17,21 17,13 7,13 7,21" />
              <polyline points="7,3 7,8 15,8" />
            </svg>
            {saving ? '保存中...' : '保存'}
            <kbd className="text-[10px] px-1 py-0.5 rounded bg-white/20 ml-1 font-mono">⌘S</kbd>
          </button>
        </div>
      </div>

      {/* 文本编辑区 */}
      <textarea
        ref={textareaRef}
        value={editContent}
        onChange={(e) => updateEditContent(e.target.value)}
        className="markdown-editor"
        spellCheck={false}
      />

      {/* 冲突解决弹窗 */}
      {conflictData && <ConflictDialog />}
    </div>
  );
};

export default MarkdownEditor;
