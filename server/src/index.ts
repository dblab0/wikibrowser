import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { errorHandler } from './middleware/errorHandler.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { projectsRouter } from './routes/projects.js';
import { wikiRouter } from './routes/wiki.js';
import { scanRouter } from './routes/scan.js';
import { searchRouter } from './routes/search.js';
import { configRouter } from './routes/config.js';
import { filesRouter } from './routes/files.js';
import { aiRouter, handleAIWebSocket } from './routes/ai.js';
import * as configService from './services/config.js';
import * as scanner from './services/scanner.js';
import { initSearchDB, closeSearchDB } from './services/search-db.js';
import { initJieba } from './services/jieba.js';
import { syncProjectIndex } from './services/search-index.js';
import { initLogger, serverLog, serverError } from './services/logger.js';
import { initAI } from './services/ai.js';
import { sessionPool } from './services/session-pool.js';
import session from 'express-session';
import crypto from 'crypto';
import { authMiddleware } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';

// Session store 引用（WebSocket 认证需要访问）
let sessionStore: session.MemoryStore | null = null;
let sessionSecret: string = '';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST = process.env.WIKIBROWSER_HOST || '127.0.0.1';
const PORT = parseInt(process.env.WIKIBROWSER_PORT || '9001', 10);
const AUTH_ENABLED = process.env.WIKIBROWSER_AUTH_ENABLED === '1';
const AUTH_CODE = process.env.WIKIBROWSER_AUTH_CODE || '';

const corsOptions = {
  origin: HOST !== '127.0.0.1' && HOST !== 'localhost'
    ? true  // 局域网绑定：允许所有 origin
    : [
        `http://127.0.0.1:${PORT}`,
        `http://localhost:${PORT}`,
      ],
  credentials: true,
};

const app = express();

// ===== 中间件 =====
app.use(cors(corsOptions));
app.use(requestIdMiddleware);
app.use(compression()); // HTTP 响应压缩
app.use(express.json());

// Session 中间件（仅认证启用时）
if (AUTH_ENABLED) {
  sessionStore = new session.MemoryStore();
  sessionSecret = crypto.randomBytes(32).toString('hex');
  app.use(session({
    name: 'wikibrowser.sid',
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: undefined,  // 浏览器关闭失效
    },
  }));

  // 认证中间件
  app.use(authMiddleware);

  // 认证路由
  app.use('/api/auth', authRouter);

  serverLog('[Server] Authentication enabled.');
}

// ===== API 路由 =====
app.use('/api/projects', projectsRouter);
app.use('/api/wiki', wikiRouter);
app.use('/api/scan', scanRouter);
app.use('/api/search', searchRouter);
app.use('/api/config', configRouter);
app.use('/api/files', filesRouter);
app.use('/api/ai', aiRouter);

// 托管 dist/public 目录下的静态资源（生产构建产物）
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// SPA 回退：所有非 API 路由返回 index.html
app.get('*', (req, res, next) => {
  // 跳过 API 路由
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(path.join(publicPath, 'index.html'), (err) => {
    if (err) {
      // 若 index.html 不存在（开发模式），继续执行后续中间件
      next();
    }
  });
});

// 错误处理中间件（必须放在所有路由之后）
app.use(errorHandler);

/**
 * 优雅关闭：清理数据库连接和会话池后退出进程
 * @param signal - 触发关闭的信号名称
 */
async function gracefulShutdown(signal: string): Promise<void> {
  serverLog(`[Server] Received ${signal}, shutting down gracefully...`);
  try {
    await sessionPool.shutdown();
    serverLog('[Server] Session pool shut down.');
  } catch (err) {
    serverError('[Server] Error during session pool shutdown:', err);
  }
  closeSearchDB();
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

/**
 * 启动服务器：初始化日志、数据库、分词器、AI 服务，并注册路由和 WebSocket
 * @returns Promise<void>
 */
async function startServer() {
  const config = configService.getConfig();
  initLogger({
    logLevel: process.env.WIKIBROWSER_LOG_LEVEL || 'info',
    retentionDays: config.logRetentionDays,
  });

  serverLog('[Server] Starting wikibrowser server...');

  serverLog(`[Server] Loaded config with ${config.projects.length} projects, ${config.scanPaths.length} scan paths`);

  // 1. 初始化 SQLite 数据库
  try {
    initSearchDB();
    serverLog('[Server] Search database initialized.');
  } catch (err) {
    serverError('[Server] Failed to initialize search database:', err);
  }

  // 2. 预热 jieba-wasm
  try {
    await initJieba();
  } catch (err) {
    serverError('[Server] Failed to initialize jieba:', err);
  }

  // 检查 Kimi CLI 可用性（非阻塞）
  initAI();

  // 创建 HTTP 服务器和 WebSocket 服务器
  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  // 服务端心跳 - 每 30 秒 ping 一次，连续未 pong 则终止连接
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const ext = ws as any;
      if (!ext.isAlive) {
        serverLog('[Server] WebSocket heartbeat timeout, terminating connection');
        ext.terminate();
        return;
      }
      ext.isAlive = false;
      ext.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  // 处理 AI 端点的 WebSocket 升级请求
  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = request.url || '';

    // 匹配 /api/ai/sessions/:sessionId/ws 路径
    const match = pathname.match(/^\/api\/ai\/sessions\/([^\/]+)\/ws$/);
    if (match) {
      // WebSocket 认证（仅认证启用时）
      if (AUTH_ENABLED && sessionStore) {
        const cookies = request.headers.cookie || '';
        // 解析 Cookie：express-session 签名后的格式为 s%3A<sessionId>.<signature>
        const sidMatch = cookies.match(/wikibrowser\.sid=s%3A([^;.]+)/);
        if (!sidMatch) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        // 异步验证 Session
        const rawSid = sidMatch[1];
        sessionStore.get(rawSid, (err, sessionData) => {
          if (err || !(sessionData as any)?.authenticated) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }

          // 已认证，允许连接
          const sessionId = match[1];
          wss.handleUpgrade(request, socket, head, (ws) => {
            (ws as any).isAlive = true;
            ws.on('pong', () => { (ws as any).isAlive = true; });
            handleAIWebSocket(ws, sessionId);
          });
        });
        return; // 异步回调中处理后续流程
      }

      const sessionId = match[1];
      wss.handleUpgrade(request, socket, head, (ws) => {
        // 初始化心跳标记
        (ws as any).isAlive = true;
        ws.on('pong', () => { (ws as any).isAlive = true; });
        handleAIWebSocket(ws, sessionId);
      });
    } else {
      // 非 WebSocket 路由，销毁连接
      socket.destroy();
    }
  });

  // 开始监听端口
  httpServer.listen(PORT, HOST, () => {
    serverLog(`[Server] wikibrowser running at http://${HOST}:${PORT}`);
  });

  // 3. 启动时自动扫描已配置的扫描路径
  if (config.scanPaths.length > 0) {
    serverLog('[Server] Auto-scanning configured paths...');
    try {
      const projects = await scanner.scanAllPaths();
      serverLog(`[Server] Auto-scan complete. Found ${projects.length} project(s).`);

      // 4. 同步搜索索引（增量更新）
      await syncProjectIndex();
      serverLog('[Server] Search index synced.');
    } catch (err) {
      serverError('[Server] Auto-scan failed:', err);
    }
  } else {
    serverLog('[Server] No scan paths configured. Use the config API to add scan paths.');
  }
}

startServer().catch((err) => {
  serverError('[Server] Failed to start:', err);
  process.exit(1);
});

export default app;
