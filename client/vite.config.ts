import { defineConfig, Plugin, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import http from 'http';

/**
 * Vite 插件：绕过 Vite proxy 的 SSE 处理问题。
 *
 * 问题：Vite 内部的 compression/transform 中间件会缓冲 SSE 响应，
 * 导致 EventSource 连接无法建立（readyState 卡在 0）。
 *
 * 方案：用 configureServer 返回一个 post-hook 函数，
 * 在 Vite 内部中间件（含 proxy）之后插入自定义 SSE 代理。
 * 由于 Vite proxy 会匹配 /api 前缀，SSE 路径也被 proxy 捕获，
 * 所以我们在 post-hook 中用 server.middlewares.use 插入的中间件
 * 可以覆盖 proxy 的响应（因为 proxy 是异步的）。
 *
 * 实际方案：关闭 SSE 路径的 proxy，完全自己处理。
 */
function sseProxyFix(): Plugin {
  return {
    name: 'sse-proxy-fix',
    configureServer(server: ViteDevServer) {
      // 返回 post-hook：在 Vite 所有内置中间件（包含 proxy）之后执行
      return () => {
        server.middlewares.use((req, res, next) => {
          const url = req.url || '';
          const match = url.match(/^\/api\/ai\/sessions\/([^/]+)\/events/);
          if (!match) {
            return next();
          }

          const sessionId = match[1];
          const target = new URL(`/api/ai/sessions/${sessionId}/events`, 'http://localhost:9001');

          const proxyReq = http.request(
            target,
            {
              method: 'GET',
              headers: {
                accept: 'text/event-stream',
                'cache-control': 'no-cache',
              },
            },
            (proxyRes) => {
              if (proxyRes.statusCode === 200) {
                res.writeHead(200, {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                  Connection: 'keep-alive',
                  'X-Accel-Buffering': 'no',
                });
                proxyRes.pipe(res);
              } else {
                let body = '';
                proxyRes.on('data', (chunk) => { body += chunk; });
                proxyRes.on('end', () => {
                  res.writeHead(proxyRes.statusCode || 502);
                  res.end(body);
                });
              }
            },
          );

          proxyReq.on('error', (err) => {
            console.error('[SSE Proxy] Connection error:', err.message);
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'text/event-stream' });
            }
            res.end(`event: close\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
          });

          res.on('close', () => {
            proxyReq.destroy();
          });

          proxyReq.end();
        });
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), sseProxyFix()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:9001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          mermaid: ['mermaid'],
        },
      },
    },
  },
});
