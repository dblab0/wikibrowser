import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import * as path from 'path';
import { TEST_IDS } from '../helpers/test-ids';
import { waitForAppReady } from '../helpers/wait-for-app';

/**
 * 辅助函数：通过 Header 的项目选择器切换到指定项目
 * @param page - Playwright Page 实例
 * @param projectName - 目标项目名称（模糊匹配）
 */
async function selectProject(page: import('@playwright/test').Page, projectName: string) {
  // 点击 Header 中的项目选择器按钮（包含 BookIcon + 当前项目名/「选择项目」）
  const selector = page.locator('header button').filter({ hasText: '选择项目' }).or(
    page.locator('header button').filter({ hasText: projectName }),
  );
  await selector.first().click();
  // 从下拉列表中选择目标项目
  await page.locator('header button').filter({ hasText: projectName }).last().click();
}

test.describe('Wiki 浏览', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
  });

  test('加载项目列表', async ({ page }) => {
    // 验证应用已加载：Header 中应显示项目选择器
    const projectSelector = page.locator('header button').filter({ hasText: '选择项目' }).or(
      page.locator('header button').filter({ hasText: 'demo-project' }),
    );
    await expect(projectSelector.first()).toBeVisible();

    // 打开设置弹窗来验证项目卡片（project-card 仅在设置弹窗中显示）
    await page.locator('header button[title="设置"]').click();
    // 切换到「项目管理」标签页
    await page.getByRole('button', { name: '项目管理' }).click();

    // 验证扫描发现了项目卡片
    const cards = page.getByTestId(TEST_IDS.PROJECT_CARD);
    await expect(cards.first()).toBeVisible({ timeout: 5000 });
    // 至少应有一个项目（demo-project）
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // 验证项目名称包含预期文本
    const firstProjectName = page.getByTestId(TEST_IDS.PROJECT_NAME).first();
    await expect(firstProjectName).toContainText('demo-project');
  });

  test('点击项目进入 wiki', async ({ page }) => {
    // 通过 Header 的项目选择器进入 demo-project
    await selectProject(page, 'demo-project');

    // 验证导航树加载完成
    await expect(page.getByTestId(TEST_IDS.WIKI_NAV)).toBeVisible({ timeout: 10000 });

    // 验证导航项按 section 分组显示（wiki.json 中定义了 3 个页面）
    await expect(page.getByTestId(TEST_IDS.NAV_ITEM('kuai-su-kai-shi'))).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.NAV_ITEM('jia-gou-gai-shu'))).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.NAV_ITEM('api-zhi-nan'))).toBeVisible();
  });

  test('点击页面加载内容', async ({ page }) => {
    await selectProject(page, 'demo-project');
    await expect(page.getByTestId(TEST_IDS.WIKI_NAV)).toBeVisible({ timeout: 10000 });

    // 点击导航项「快速开始」
    await page.getByTestId(TEST_IDS.NAV_ITEM('kuai-su-kai-shi')).click();

    // 验证内容区域已加载
    await expect(page.getByTestId(TEST_IDS.WIKI_CONTENT)).toBeVisible();

    // 验证内容标题渲染为页面的 title
    await expect(page.getByTestId(TEST_IDS.CONTENT_TITLE)).toContainText('快速开始');

    // 验证 Markdown 内容渲染（页面内容包含「WikiBrowser」关键字）
    const contentArea = page.getByTestId(TEST_IDS.WIKI_CONTENT);
    await expect(contentArea).toContainText('WikiBrowser');
  });

  test('前后导航', async ({ page }) => {
    await selectProject(page, 'demo-project');
    await expect(page.getByTestId(TEST_IDS.WIKI_NAV)).toBeVisible({ timeout: 10000 });

    // 点击第一个页面
    await page.getByTestId(TEST_IDS.NAV_ITEM('kuai-su-kai-shi')).click();
    await expect(page.getByTestId(TEST_IDS.CONTENT_TITLE)).toContainText('快速开始');

    // 点击第二个页面
    await page.getByTestId(TEST_IDS.NAV_ITEM('jia-gou-gai-shu')).click();
    await expect(page.getByTestId(TEST_IDS.CONTENT_TITLE)).toContainText('架构概述');

    // 回到第一个页面（点击导航项而非浏览器后退，因为 SPA 无 URL 路由）
    await page.getByTestId(TEST_IDS.NAV_ITEM('kuai-su-kai-shi')).click();
    await expect(page.getByTestId(TEST_IDS.CONTENT_TITLE)).toContainText('快速开始');

    // 再切到第三个页面
    await page.getByTestId(TEST_IDS.NAV_ITEM('api-zhi-nan')).click();
    await expect(page.getByTestId(TEST_IDS.CONTENT_TITLE)).toContainText('API 指南');
  });

  test('侧边栏展开/收起', async ({ page }) => {
    await selectProject(page, 'demo-project');
    await expect(page.getByTestId(TEST_IDS.WIKI_NAV)).toBeVisible({ timeout: 10000 });

    // 点击折叠按钮收起侧边栏
    const toggle = page.getByTestId(TEST_IDS.SIDEBAR_TOGGLE);
    await toggle.click();

    // 收起后 wiki-nav 不可见（被替换为图标栏）
    await expect(page.getByTestId(TEST_IDS.WIKI_NAV)).not.toBeVisible();

    // 再次点击展开按钮恢复侧边栏
    await page.getByTestId(TEST_IDS.SIDEBAR_TOGGLE).click();
    await expect(page.getByTestId(TEST_IDS.WIKI_NAV)).toBeVisible();
  });

  test('刷新项目缓存后内容更新', async ({ page }) => {
    // 确保已加载 demo-project 并建立缓存
    await selectProject(page, 'demo-project');
    await expect(page.getByTestId(TEST_IDS.WIKI_NAV)).toBeVisible({ timeout: 10000 });

    // 点击第一个页面，建立缓存
    await page.getByTestId(TEST_IDS.NAV_ITEM('kuai-su-kai-shi')).click();
    await expect(page.getByTestId(TEST_IDS.CONTENT_TITLE)).toContainText('快速开始');

    // 记录原始内容
    const originalContent = page.getByTestId(TEST_IDS.WIKI_CONTENT);
    await expect(originalContent).toContainText('WikiBrowser');

    // 外部修改文件（直接操作文件系统）
    // 通过 playwright.config.ts 中设置的临时目录推导项目路径
    // 注意：TEST_DATA_DIR 只传给了 webServer 进程，测试进程需通过 WIKIBROWSER_TEST_TMPDIR 推导
    const tmpDir = process.env.WIKIBROWSER_TEST_TMPDIR;
    if (!tmpDir) {
      console.warn('WIKIBROWSER_TEST_TMPDIR 未设置，跳过缓存刷新测试');
      return;
    }
    const testProjectPath = path.join(tmpDir, 'projects', 'demo-project');
    const wikiDir = path.join(testProjectPath, '.zread', 'wiki');
    const versionsDir = path.join(wikiDir, 'versions');

    // 读取 current 指针或取最新版本目录
    let versionId = '';
    try {
      const currentPointer = readFileSync(path.join(wikiDir, 'current'), 'utf-8').trim();
      const match = currentPointer.match(/versions\/(.+)/);
      versionId = match ? match[1] : '';
    } catch {
      // 回退到最新版本目录
    }
    if (!versionId) {
      const dirs = readdirSync(versionsDir).sort().reverse();
      versionId = dirs[0] || '';
    }

    // md 文件直接在版本目录下（无 pages 子目录）
    const mdFile = path.join(versionsDir, versionId, '01-kuai-su-kai-shi.md');
    let originalMd = '';
    const modifiedMarker = 'WikiBrowser-MODIFIED-for-test';
    try {
      originalMd = readFileSync(mdFile, 'utf-8');
      const modifiedMd = originalMd.replace('WikiBrowser', modifiedMarker);
      writeFileSync(mdFile, modifiedMd, 'utf-8');
    } catch {
      // 文件不存在或无法修改，跳过测试
      return;
    }

    try {
      // 先导航到其他页面，再回来，验证 JS 缓存生效（仍显示旧内容）
      await page.getByTestId(TEST_IDS.NAV_ITEM('jia-gou-gai-shu')).click();
      await expect(page.getByTestId(TEST_IDS.CONTENT_TITLE)).toContainText('架构概述');
      await page.getByTestId(TEST_IDS.NAV_ITEM('kuai-su-kai-shi')).click();
      const cachedContent = page.getByTestId(TEST_IDS.WIKI_CONTENT);
      await expect(cachedContent).toContainText('WikiBrowser');
      await expect(cachedContent).not.toContainText(modifiedMarker);

      // 刷新缓存：打开设置 → 项目管理
      await page.locator('header button[title="设置"]').click();
      await page.getByRole('button', { name: '项目管理' }).click();

      // 点击刷新按钮
      const card = page.getByTestId(TEST_IDS.PROJECT_CARD).first();
      await card.locator('button[title="刷新缓存"]').click();

      // 等待刷新完成（按钮恢复）
      await expect(card.locator('button[title="刷新缓存"]')).not.toBeDisabled();

      // 关闭设置弹窗（按 Escape 关闭）
      await page.keyboard.press('Escape');
      await page.waitForSelector('.overlay', { state: 'hidden' });

      // 先导航到其他页面，再回来，触发重新获取（JS 缓存已清除）
      await page.getByTestId(TEST_IDS.NAV_ITEM('jia-gou-gai-shu')).click();
      await expect(page.getByTestId(TEST_IDS.CONTENT_TITLE)).toContainText('架构概述');
      await page.getByTestId(TEST_IDS.NAV_ITEM('kuai-su-kai-shi')).click();

      // 验证显示新内容（缓存已刷新）
      const refreshedContent = page.getByTestId(TEST_IDS.WIKI_CONTENT);
      await expect(refreshedContent).toContainText(modifiedMarker);
    } finally {
      // 清理：恢复原文件
      writeFileSync(mdFile, originalMd, 'utf-8');
    }
  });
});
