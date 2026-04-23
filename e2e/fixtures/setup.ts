import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * 创建临时测试环境
 * @returns 临时目录路径和 cleanup 函数
 */
export function createTestEnvironment() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wikibrowser-test-'));
  const configDir = path.join(tmpDir, 'config');
  const dataDir = path.join(tmpDir, 'projects');

  // 创建配置目录
  fs.mkdirSync(configDir, { recursive: true });

  // 复制 mock 项目数据到临时目录
  const fixturesDir = path.resolve(__dirname, 'projects');
  fs.cpSync(fixturesDir, dataDir, { recursive: true });

  // 写入测试专用配置
  const settings = {
    scanPaths: [dataDir],
    projects: [],
    theme: 'light',
  };
  fs.writeFileSync(
    path.join(configDir, 'settings.json'),
    JSON.stringify(settings, null, 2)
  );

  // 设置环境变量
  process.env.WIKIBROWSER_CONFIG_DIR = configDir;
  process.env.TEST_DATA_DIR = dataDir;

  return {
    tmpDir,
    configDir,
    dataDir,
    cleanup: () => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

/**
 * 创建 mock kimi CLI 脚本
 * @param binDir 存放 mock 脚本的目录
 */
export function createMockKimi(binDir: string) {
  fs.mkdirSync(binDir, { recursive: true });
  const mockScript = path.join(binDir, 'kimi');
  const mockSource = path.resolve(__dirname, 'mock-kimi', 'kimi-mock.js');

  // 创建 wrapper 脚本指向 kimi-mock.js
  const scriptContent = `#!/usr/bin/env node\nrequire('${mockSource.replace(/'/g, "\\'")}');\n`;
  fs.writeFileSync(mockScript, scriptContent);
  fs.chmodSync(mockScript, 0o755);

  return mockScript;
}
