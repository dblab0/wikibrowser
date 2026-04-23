import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const LOG_DIR = path.join(os.homedir(), '.wikibrowser', 'logs');
const DEFAULT_RETENTION_DAYS = 7;

/** 日志级别类型 */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/** 日志级别对应的数值，用于级别比较 */
const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

let currentLevel: number = LOG_LEVEL_VALUES.info;
let logStream: fs.WriteStream | null = null;
let currentDate = '';

/** 获取当天日期字符串，格式 "2026-04-12" */
function getTodayStr(): string {
  return new Date().toISOString().substring(0, 10);
}

/** 打开当天日志文件，日期变化时自动轮转 */
function openLogFile(): void {
  const today = getTodayStr();
  if (today === currentDate && logStream) return;

  // 日期变化时关闭之前的流
  if (logStream) {
    logStream.end();
    logStream = null;
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  currentDate = today;
  logStream = fs.createWriteStream(
    path.join(LOG_DIR, `wikibrowser-${today}.log`),
    { flags: 'a' },
  );
}

/**
 * 删除超过保留天数的日志文件
 * @param retentionDays - 日志保留天数
 */
function cleanOldLogs(retentionDays: number): void {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.startsWith('wikibrowser-') || !file.endsWith('.log')) continue;
      const filePath = path.join(LOG_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
      }
    }
  } catch {
    // 非关键操作，清理失败可忽略
  }
}

/**
 * 初始化日志器，服务启动时调用一次
 * @param options - 初始化选项
 * @param options.logLevel - 日志级别（error/warn/info/debug）
 * @param options.retentionDays - 日志保留天数
 */
export function initLogger(options: { logLevel?: string; retentionDays?: number }) {
  currentLevel = LOG_LEVEL_VALUES[options.logLevel as LogLevel] ?? LOG_LEVEL_VALUES.info;
  openLogFile();
  cleanOldLogs(options.retentionDays ?? DEFAULT_RETENTION_DAYS);
}

/** 写入日志到文件，日期变化时自动轮转（服务跨午夜运行） */
function writeToFile(prefix: string, args: any[]): void {
  // 跨日自动轮转
  const today = getTodayStr();
  if (today !== currentDate) {
    openLogFile();
  }
  if (!logStream) return;

  const line = `[${new Date().toISOString()}] ${prefix} ${args.map(String).join(' ')}\n`;
  logStream.write(line);
}

// ===== Server-level logging =====

/** 服务级信息日志，始终输出到控制台，级别 >= info 时写入文件 */
export function serverLog(...args: any[]): void {
  if (currentLevel >= LOG_LEVEL_VALUES.info) writeToFile('[Server]', args);
  console.log(...args);
}

/** 服务级错误日志，始终输出到控制台和文件 */
export function serverError(...args: any[]): void {
  writeToFile('[ERROR]', args);
  console.error(...args);
}

// ===== AI-domain logging =====

/** AI 重要事件日志，始终输出到控制台，级别 >= info 时写入文件 */
export function aiInfo(...args: any[]): void {
  if (currentLevel >= LOG_LEVEL_VALUES.info) writeToFile('[AI]', args);
  console.log(...args);
}

/** AI 调试日志，仅级别 >= debug 时写入文件，不输出到控制台 */
export function aiDebug(...args: any[]): void {
  if (currentLevel >= LOG_LEVEL_VALUES.debug) writeToFile('[AI DEBUG]', args);
}

/** AI 错误日志，始终输出到控制台和文件 */
export function aiError(...args: any[]): void {
  writeToFile('[AI ERROR]', args);
  console.error(...args);
}

