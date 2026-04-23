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

/**
 * 辅助函数：打开 AI 侧边栏并等待 session 激活
 * 点击「问问 AI」按钮 → 等待 AI 面板可见 → 等待输入框变为 enabled
 * @param page - Playwright Page 实例
 */
async function openAIPanelAndWait(page: import('@playwright/test').Page) {
  // 点击 Header 中的「问问 AI」按钮
  await page.locator('header button[title="问问 AI"]').click();

  // 等待 AI 面板可见
  await expect(page.getByTestId(TEST_IDS.AI_PANEL)).toBeVisible({ timeout: 10000 });

  // 等待 session 激活完成（输入框从 disabled 变为 enabled）
  // 初始化流程：创建/加载 session → 建立 WS 连接 → session 状态变为 active
  await expect(page.getByTestId(TEST_IDS.AI_INPUT)).toBeEnabled({ timeout: 20000 });
}

test.describe('AI 对话', () => {
  test.beforeEach(async ({ page }) => {
    await waitForAppReady(page);
    // AI 面板需要项目上下文来创建 session
    await selectDemoProject(page);
    await expect(page.getByTestId(TEST_IDS.WIKI_NAV)).toBeVisible({ timeout: 10000 });
  });

  test('打开 AI 侧边栏', async ({ page }) => {
    // 点击「问问 AI」按钮
    await page.locator('header button[title="问问 AI"]').click();

    // 验证 AI 面板已打开
    await expect(page.getByTestId(TEST_IDS.AI_PANEL)).toBeVisible({ timeout: 10000 });

    // 验证 AI 面板中的核心元素存在
    await expect(page.getByTestId(TEST_IDS.AI_INPUT)).toBeVisible();
    await expect(page.getByTestId(TEST_IDS.AI_SEND)).toBeVisible();

    // 等待 session 激活完成
    await expect(page.getByTestId(TEST_IDS.AI_INPUT)).toBeEnabled({ timeout: 20000 });

    // 验证空状态提示（无消息时显示引导文字）
    await expect(page.getByText('开始与 AI 对话')).toBeVisible();
  });

  test('发送消息并接收流式响应', async ({ page }) => {
    await openAIPanelAndWait(page);

    // 输入消息
    await page.getByTestId(TEST_IDS.AI_INPUT).fill('你好');

    // 点击发送按钮
    await page.getByTestId(TEST_IDS.AI_SEND).click();

    // 验证用户消息已添加到消息列表（index 0）
    await expect(page.getByTestId(TEST_IDS.AI_MESSAGE(0))).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId(TEST_IDS.AI_MESSAGE(0))).toContainText('你好');

    // 等待 AI 流式响应完成
    // Mock Kimi 进程发送 TurnBegin → ContentPart(逐字) → StatusUpdate(complete)
    // AI 回复消息会作为 index 1 出现
    await expect(page.getByTestId(TEST_IDS.AI_MESSAGE(1)))
      .toBeVisible({ timeout: 20000 });

    // 验证回复内容包含预期文本（mock 进程回复包含「模拟回复」）
    await expect(page.getByTestId(TEST_IDS.AI_MESSAGE(1)))
      .toContainText('模拟回复', { timeout: 10000 });
  });

  test('代码块渲染（语法高亮 + 复制按钮）', async ({ page }) => {
    await openAIPanelAndWait(page);

    // 发送触发代码回复的消息
    await page.getByTestId(TEST_IDS.AI_INPUT).fill('写段代码');
    await page.getByTestId(TEST_IDS.AI_SEND).click();

    // 等待 AI 回复消息出现
    await expect(page.getByTestId(TEST_IDS.AI_MESSAGE(1)))
      .toBeVisible({ timeout: 20000 });

    const aiMessage = page.getByTestId(TEST_IDS.AI_MESSAGE(1));

    // 验证代码块元素存在
    await expect(aiMessage.locator('code')).toBeVisible({ timeout: 15000 });

    // 验证代码块内容包含 JavaScript 代码
    await expect(aiMessage.locator('code')).toContainText('console.log');

    // 验证消息中有代码块语言标签
    await expect(aiMessage.locator('text=javascript')).toBeVisible();
  });
});
