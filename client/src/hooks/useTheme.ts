import { useEffect } from 'react';
import { useAppStore } from '../stores/app';

/**
 * 管理 CSS 主题切换的自定义 Hook
 * 根据全局配置自动更新 document 根元素的 data-theme 属性
 * @returns 无返回值
 */
export function useTheme(): void {
  const config = useAppStore((state) => state.config);

  useEffect(() => {
    const theme = config?.theme || 'light';
    document.documentElement.setAttribute('data-theme', theme);
  }, [config?.theme]);
}
