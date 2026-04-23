import { type Page } from '@playwright/test';

/**
 * 等待应用完全就绪
 * 轮询 /api/scan/status 直到扫描完成，然后等待页面主体渲染
 */
export async function waitForAppReady(page: Page) {
  // 等待 HTTP 服务就绪
  await page.goto('/');

  // 等待项目扫描完成 + 搜索索引构建
  await page.waitForFunction(
    async () => {
      try {
        const res = await fetch('/api/scan/status');
        const data = await res.json();
        return !data.scanning && data.lastScanAt != null;
      } catch {
        return false;
      }
    },
    { timeout: 30000 }
  );

  // 等待页面主体渲染（Header 组件必定存在）
  await page.waitForSelector('header', { timeout: 10000 });
}
