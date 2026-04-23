import { test, expect } from '@playwright/test';
import { TEST_IDS } from '../helpers/test-ids';
import { waitForAppReady } from '../helpers/wait-for-app';

/**
 * 辅助函数：通过 Header 的项目选择器切换到 demo-project
 * @param page - Playwright Page 实例
 */
async function selectDemoProject(page: import('@playwright/test').Page) {
  const selector = page.locator('header button').filter({ hasText: '选择项目' }).or(
    page.locator('header button').filter({ hasText: 'demo-project' }),
  );
  await selector.first().click();
  await page.locator('header button').filter({ hasText: 'demo-project' }).last().click();
}

test.describe('全文搜索', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
    // 搜索需要项目上下文，先进入 demo-project
    await selectDemoProject(page);
    // 等待导航树加载确认项目已就绪
    await expect(page.getByTestId(TEST_IDS.WIKI_NAV)).toBeVisible({ timeout: 10000 });
  });

  test('搜索英文关键词 "API"', async ({ page }) => {
    // 通过快捷键 Ctrl+K 打开搜索弹窗
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId(TEST_IDS.SEARCH_MODAL)).toBeVisible();

    // 输入英文关键词
    await page.getByTestId(TEST_IDS.SEARCH_INPUT).fill('API');
    // 等待搜索结果出现（搜索有 200ms 防抖 + 网络请求）
    await expect(page.getByTestId(TEST_IDS.SEARCH_RESULT_ITEM).first())
      .toBeVisible({ timeout: 5000 });

    // 验证搜索结果包含 API 相关页面
    const results = page.getByTestId(TEST_IDS.SEARCH_RESULT_ITEM);
    const count = await results.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('搜索中文关键词 "架构"', async ({ page }) => {
    // 通过搜索按钮打开搜索弹窗
    await page.getByTestId(TEST_IDS.SEARCH_TRIGGER).click();
    await expect(page.getByTestId(TEST_IDS.SEARCH_MODAL)).toBeVisible();

    // 输入中文关键词
    await page.getByTestId(TEST_IDS.SEARCH_INPUT).fill('架构');
    await expect(page.getByTestId(TEST_IDS.SEARCH_RESULT_ITEM).first())
      .toBeVisible({ timeout: 5000 });

    // 验证搜索结果中包含「架构概述」页面
    const firstResult = page.getByTestId(TEST_IDS.SEARCH_RESULT_ITEM).first();
    await expect(firstResult).toContainText('架构概述');
  });

  test('点击搜索结果跳转', async ({ page }) => {
    await page.getByTestId(TEST_IDS.SEARCH_TRIGGER).click();
    await expect(page.getByTestId(TEST_IDS.SEARCH_MODAL)).toBeVisible();

    // 搜索 API 相关内容
    await page.getByTestId(TEST_IDS.SEARCH_INPUT).fill('API');
    await expect(page.getByTestId(TEST_IDS.SEARCH_RESULT_ITEM).first())
      .toBeVisible({ timeout: 5000 });

    // 点击第一个搜索结果
    await page.getByTestId(TEST_IDS.SEARCH_RESULT_ITEM).first().click();

    // 验证搜索弹窗已关闭
    await expect(page.getByTestId(TEST_IDS.SEARCH_MODAL)).not.toBeVisible();

    // 验证主内容区域已加载对应页面
    await expect(page.getByTestId(TEST_IDS.WIKI_CONTENT)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.CONTENT_TITLE)).toBeVisible();
  });

  test('空搜索无结果（输入不存在的内容）', async ({ page }) => {
    await page.getByTestId(TEST_IDS.SEARCH_TRIGGER).click();
    await expect(page.getByTestId(TEST_IDS.SEARCH_MODAL)).toBeVisible();

    // 输入一个不存在的关键词
    await page.getByTestId(TEST_IDS.SEARCH_INPUT).fill('zzznotexist123');
    // 等待「没有找到相关结果」提示出现
    await expect(page.getByTestId(TEST_IDS.SEARCH_NO_RESULT))
      .toBeVisible({ timeout: 5000 });

    // 验证无结果提示文本
    await expect(page.getByTestId(TEST_IDS.SEARCH_NO_RESULT)).toContainText('没有找到相关结果');
  });

  test('清空搜索', async ({ page }) => {
    await page.getByTestId(TEST_IDS.SEARCH_TRIGGER).click();
    await expect(page.getByTestId(TEST_IDS.SEARCH_MODAL)).toBeVisible();

    // 先搜索一个有结果的关键词
    await page.getByTestId(TEST_IDS.SEARCH_INPUT).fill('API');
    await expect(page.getByTestId(TEST_IDS.SEARCH_RESULT_ITEM).first())
      .toBeVisible({ timeout: 5000 });

    // 清空搜索输入框
    await page.getByTestId(TEST_IDS.SEARCH_INPUT).clear();

    // 清空后搜索结果应被清空（回到初始提示状态）
    await expect(page.getByTestId(TEST_IDS.SEARCH_RESULT_ITEM)).toHaveCount(0);
    // 应回到「输入关键词开始搜索」提示
    await expect(page.getByTestId(TEST_IDS.SEARCH_MODAL)).toContainText('输入关键词开始搜索');
  });
});
