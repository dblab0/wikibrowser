import { useEffect } from 'react';
import { useAppStore } from '../stores/app';

/**
 * 管理全局键盘快捷键的自定义 Hook
 * 注册 Ctrl/Cmd+K（搜索）、Ctrl/Cmd+B（侧边栏）、Escape（关闭弹窗）等快捷键
 * @returns 无返回值
 */
export function useKeyboard(): void {
  const toggleSearch = useAppStore((state) => state.toggleSearch);
  const setSearchOpen = useAppStore((state) => state.setSearchOpen);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const searchOpen = useAppStore((state) => state.searchOpen);
  const settingsOpen = useAppStore((state) => state.settingsOpen);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isMod = e.ctrlKey || e.metaKey;

      // Ctrl/Cmd + K -> 打开搜索
      if (isMod && e.key === 'k') {
        e.preventDefault();
        toggleSearch();
        return;
      }

      // Ctrl/Cmd + B -> 切换侧边栏折叠状态
      if (isMod && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Escape -> 关闭弹窗
      if (e.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false);
        } else if (settingsOpen) {
          setSettingsOpen(false);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSearch, setSearchOpen, setSettingsOpen, toggleSidebar, searchOpen, settingsOpen]);
}
