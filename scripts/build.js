const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

// 解析命令行参数：--no-obfuscate 时跳过代码混淆步骤
const noObfuscate = process.argv.includes('--no-obfuscate');

// Helper function to run command
function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: cwd || ROOT,
      shell: true,
      stdio: 'inherit'
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    proc.on('error', reject);
  });
}

// Helper function to copy directory
function copyDir(src, dest, filter) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      // Skip __tests__ directory entirely
      if (entry.name === '__tests__') continue;
      copyDir(srcPath, destPath, filter);
    } else if (!filter || filter(entry.name)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Helper function to clean directory
function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function build() {
  console.log('=== WikiBrowser Build Script ===\n');

  // 1. Clean dist directory
  console.log('[1/6] Cleaning dist directory...');
  const distDir = path.join(ROOT, 'dist');
  cleanDir(distDir);
  fs.mkdirSync(distDir, { recursive: true });
  console.log('  Done.\n');

  // 2. Build client with Vite
  console.log('[2/6] Building client (Vite)...');
  const clientDistDir = path.join(ROOT, 'client', 'dist');
  cleanDir(clientDistDir);
  await run('npx', ['vite', 'build'], path.join(ROOT, 'client'));
  console.log('  Done.\n');

  // 3. Copy client output to dist/public
  console.log('[3/6] Copying client to dist/public...');
  const publicDir = path.join(ROOT, 'dist', 'public');
  if (fs.existsSync(clientDistDir)) {
    copyDir(clientDistDir, publicDir);
    console.log('  Done.\n');
  } else {
    console.error('  ERROR: Client build output not found');
    process.exit(1);
  }

  // 4. Build server with TypeScript
  console.log('[4/6] Building server (TypeScript)...');
  const serverDistDir = path.join(ROOT, 'server', 'dist');
  cleanDir(serverDistDir);
  await run('npx', ['tsc'], path.join(ROOT, 'server'));
  console.log('  Done.\n');

  // 5. Move server output to dist/server (fix path issue)
  console.log('[5/6] Processing server output...');
  const serverSrcDist = path.join(ROOT, 'server', 'dist', 'server', 'src');
  const sharedSrcDist = path.join(ROOT, 'server', 'dist', 'shared');
  const targetServerDir = path.join(ROOT, 'dist', 'server');

  if (fs.existsSync(serverSrcDist)) {
    copyDir(serverSrcDist, targetServerDir, (name) => {
      return !name.endsWith('.map') && !name.endsWith('.d.ts');
    });
    console.log('  Server files moved to dist/server/');
  } else {
    console.error('  ERROR: Server build output not found at:', serverSrcDist);
    process.exit(1);
  }

  // Copy shared to dist/shared/
  if (fs.existsSync(sharedSrcDist)) {
    copyDir(sharedSrcDist, path.join(ROOT, 'dist', 'shared'), (name) => {
      return !name.endsWith('.map') && !name.endsWith('.d.ts') && name !== 'vitest.config.js';
    });
    console.log('  Shared files copied to dist/shared/');
  } else {
    console.error('  ERROR: Shared build output not found at:', sharedSrcDist);
    process.exit(1);
  }

  // Fix shared import paths: ../../../shared/ → ../../shared/
  // After moving server files from server/dist/server/src/ to dist/server/,
  // the relative depth changes, so we adjust the compiled JS accordingly.
  function fixSharedPaths(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        fixSharedPaths(fullPath);
      } else if (entry.name.endsWith('.js')) {
        let content = fs.readFileSync(fullPath, 'utf8');
        const fixed = content.replace(/\.\.\/\.\.\/\.\.\/shared\//g, '../../shared/');
        if (content !== fixed) {
          fs.writeFileSync(fullPath, fixed, 'utf8');
        }
      }
    }
  }
  fixSharedPaths(targetServerDir);
  console.log('  Fixed shared import paths in dist/server/');

  cleanDir(serverDistDir);
  console.log('  Cleaned server/dist/');
  console.log('  Done.\n');

  // 6. Obfuscate server code（--no-obfuscate 时跳过）
  if (noObfuscate) {
    console.log('[6/6] Skipping obfuscation (--no-obfuscate flag detected).');
  } else {
    console.log('[6/6] Obfuscating server code...');
    try {
      const obfuscatorConfig = path.join(ROOT, 'server', 'obfuscator.config.json');
      const obfDistDir = path.join(ROOT, 'dist', 'server-obf');

      await run('npx', [
        'javascript-obfuscator',
        `"${targetServerDir}"`,
        '--output', `"${obfDistDir}"`,
        '--config', `"${obfuscatorConfig}"`
      ]);

      cleanDir(targetServerDir);
      fs.renameSync(obfDistDir, targetServerDir);
      console.log('  Server code obfuscated.\n');
    } catch (err) {
      console.error('  Warning: Obfuscation failed, using unobfuscated code.');
      console.error('  Error:', err.message);
    }
  }

  // Summary
  console.log('=== Build Complete ===');
  console.log('Output:');
  console.log('  - dist/public/  (frontend)');
  console.log('  - dist/server/  (backend, obfuscated)');
  console.log('  - dist/shared/  (shared modules)');
}

build().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
