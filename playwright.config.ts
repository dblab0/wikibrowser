import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ========== 在配置加载时创建测试环境 ==========
// Playwright 生命周期：config 加载 → webServer 启动 → globalSetup → 测试
// 所以临时环境必须在 config 加载阶段就创建，不能放在 globalSetup 中

// 重要：Playwright retry 会重新加载 config，但 webServer 只启动一次
// 如果已有运行中的环境，直接使用它，避免创建新目录导致路径不一致
let tmpDir: string;
if (process.env.WIKIBROWSER_TEST_TMPDIR && fs.existsSync(process.env.WIKIBROWSER_TEST_TMPDIR)) {
  // 已有测试环境（retry 场景），复用已有目录
  tmpDir = process.env.WIKIBROWSER_TEST_TMPDIR;
} else {
  // 创建新的测试环境（首次运行）
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wikibrowser-test-'));
}
const configDir = path.join(tmpDir, 'config');
const dataDir = path.join(tmpDir, 'projects');
const binDir = path.join(tmpDir, 'bin');

// 创建配置目录
fs.mkdirSync(configDir, { recursive: true });

// 复制 mock 项目数据到临时目录
const fixturesDir = path.resolve(__dirname, 'e2e/fixtures/projects');
fs.cpSync(fixturesDir, dataDir, { recursive: true });

// 写入测试专用配置（scanPaths 指向 mock 数据目录）
fs.writeFileSync(
  path.join(configDir, 'settings.json'),
  JSON.stringify({ scanPaths: [dataDir], projects: [], theme: 'light' }, null, 2)
);

// 创建 mock kimi CLI 脚本
fs.mkdirSync(binDir, { recursive: true });
const mockSource = path.resolve(__dirname, 'e2e/fixtures/mock-kimi/kimi-mock.js');
fs.writeFileSync(
  path.join(binDir, 'kimi'),
  `#!/usr/bin/env node\nrequire('${mockSource.replace(/'/g, "\\'")}');\n`
);
fs.chmodSync(path.join(binDir, 'kimi'), 0o755);

// 保存临时目录路径供 globalSetup 清理时使用
process.env.WIKIBROWSER_TEST_TMPDIR = tmpDir;

export default defineConfig({
  testDir: './e2e/specs',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:9001',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: {
    // 需要先构建：npm run build:e2e
    command: 'node bin/wikibrowser.js --no-auth',
    port: 9001,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      WIKIBROWSER_CONFIG_DIR: configDir,
      TEST_DATA_DIR: dataDir,
      WIKIBROWSER_AUTH_ENABLED: '0',
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    },
  },
  globalSetup: require.resolve('./e2e/global-setup'),
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
