import React, { useState } from 'react';
import { useAppStore } from '../../stores/app';

/**
 * 编辑冲突解决弹窗
 * 当文档被外部修改时，提示用户选择加载最新版本或保留本地修改
 */
const ConflictDialog: React.FC = () => {
  const conflictData = useAppStore((s) => s.currentView?.conflictData);
  const resolveConflict = useAppStore((s) => s.resolveConflict);

  const [showPreview, setShowPreview] = useState(true);

  if (!conflictData) return null;

  const previewLines = conflictData.serverContent.split('\n').slice(0, 30);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg mx-4 bg-surface-secondary rounded-xl shadow-2xl border border-edge overflow-hidden">
        {/* 头部 */}
        <div className="px-6 py-4 border-b border-edge-light">
          <div className="flex items-center gap-2 text-warning text-base font-semibold">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
            此页面已被外部修改
          </div>
          <p className="text-[13px] text-content-secondary mt-1.5">
            你可以选择加载最新版本，或保留你当前的修改继续编辑。
          </p>
        </div>

        {/* 服务器端内容预览 */}
        {showPreview && (
          <div className="px-6 py-3 max-h-48 overflow-y-auto bg-surface-tertiary border-b border-edge-light">
            <p className="text-[11px] text-content-muted mb-2 font-medium">服务器最新版本（预览）</p>
            <pre className="text-[12px] font-mono text-content-secondary whitespace-pre-wrap leading-relaxed">
              {previewLines.join('\n')}
              {conflictData.serverContent.split('\n').length > 30 && '\n...'}
            </pre>
          </div>
        )}

        <div className="px-6 py-1">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="text-[12px] text-accent hover:underline"
          >
            {showPreview ? '收起预览' : '展开预览'}
          </button>
        </div>

        {/* 操作按钮 */}
        <div className="px-6 py-4 flex justify-end gap-3">
          <button
            onClick={() => resolveConflict('server')}
            className="px-4 py-2 rounded-lg text-[13px] font-medium
                       text-content-secondary hover:text-content hover:bg-surface-hover
                       border border-edge-light transition-colors duration-150"
          >
            加载最新版本
          </button>
          <button
            onClick={() => resolveConflict('mine')}
            className="px-4 py-2 rounded-lg text-[13px] font-medium
                       bg-accent text-white hover:bg-accent-hover
                       transition-colors duration-150"
          >
            保留我的修改
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConflictDialog;
