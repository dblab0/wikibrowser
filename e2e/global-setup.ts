import * as fs from 'fs';

/**
 * Playwright 全局 setup
 * 临时环境已在 playwright.config.ts 加载阶段创建
 * 这里仅负责注册 cleanup 回调
 */
export default async function globalSetup() {
  const tmpDir = process.env.WIKIBROWSER_TEST_TMPDIR;
  console.log(`[E2E] Using test environment at ${tmpDir}`);

  return async () => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      console.log('[E2E] Test environment cleaned up.');
    }
  };
}
