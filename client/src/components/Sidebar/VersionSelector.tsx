import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../stores/app';

/**
 * 格式化版本 ID 为可读时间
 * "2026-04-16-220440" -> "2026-04-16 22:04"
 */
function formatVersionTime(version: string): string {
  const match = version.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/);
  if (!match) return version;
  const [, year, month, day, hour, min] = match;
  return `${year}-${month}-${day} ${hour}:${min}`;
}

/**
 * Wiki 版本选择器组件
 * 下拉选择不同版本的 Wiki 文档
 */
export default function VersionSelector() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const availableVersions = useAppStore((s) => s.availableVersions);
  const selectedVersion = useAppStore((s) => s.selectedVersion);
  const setWikiVersion = useAppStore((s) => s.setWikiVersion);

  // 计算下拉菜单位置
  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left + 8,
      width: rect.width - 16,
    });
  }, []);

  // 打开/关闭时计算位置
  useEffect(() => {
    if (open) {
      updatePosition();
    } else {
      setDropdownPos(null);
    }
  }, [open, updatePosition]);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        portalRef.current && !portalRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  if (availableVersions.length <= 1) return null;

  const currentSelected = availableVersions.find(
    (v) => v.version === selectedVersion
  );

  const displayText = currentSelected
    ? formatVersionTime(currentSelected.version)
    : '选择版本';

  async function handleSelect(version: string) {
    setOpen(false);
    if (version !== selectedVersion) {
      await setWikiVersion(version);
    }
  }

  return (
    <>
      <div className="relative px-2 py-1.5 border-b border-[var(--edge)]">
        <button
          ref={buttonRef}
          onClick={() => setOpen(!open)}
          className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs
                     hover:bg-[var(--surface-hover)] transition-colors text-[var(--content-secondary)]"
          title="切换 Wiki 版本"
        >
          <span className="flex items-center gap-1.5 truncate">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="truncate">{displayText}</span>
          </span>
          <svg
            className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {open && dropdownPos && createPortal(
        <div
          ref={portalRef}
          className="fixed z-[9999]
                     bg-[var(--surface)] border border-[var(--edge)]
                     rounded shadow-lg max-h-60 overflow-y-auto"
          style={{
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
          }}
        >
          {availableVersions.map((v) => (
            <button
              key={v.version}
              onClick={() => handleSelect(v.version)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs
                         hover:bg-[var(--surface-hover)] transition-colors text-left
                         ${v.version === selectedVersion ? 'bg-[var(--surface-hover)] text-[var(--content)] font-medium' : 'text-[var(--content-secondary)]'}`}
            >
              <span className="flex items-center gap-2">
                <span>{formatVersionTime(v.version)}</span>
                {v.isCurrent && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-[var(--accent-light)] text-[var(--accent-text)]">
                    当前
                  </span>
                )}
              </span>
              <span className="text-[var(--content-tertiary)]">{v.pageCount}页</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
