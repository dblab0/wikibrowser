import { cut, cut_for_search } from 'jieba-wasm';

let loaded = false;

/**
 * 预热：jieba-wasm 在 Node.js 环境首次调用时自动加载 WASM + 字典（~16MB）。
 * 建议在启动流程中主动调用一次，避免首次搜索时的延迟。
 */
export async function initJieba(): Promise<void> {
  if (loaded) return;
  try {
    // 首次调用触发 WASM 加载 + 字典初始化
    cut('预热');
    loaded = true;
    console.log('[Jieba] WASM 加载成功');
  } catch (err) {
    console.error('[Jieba] 加载失败:', err);
    // 不设置 loaded=true，后续调用走 fallback
  }
}

/** 精确模式分词（用于索引构建） */
export function cutText(text: string): string[] {
  if (!loaded) return fallbackTokenize(text);
  try {
    return cut(text, true); // HMM=true，对未知词效果更好
  } catch {
    return fallbackTokenize(text);
  }
}

/** 搜索模式分词（用于查询，粒度更细，召回率更高） */
export function cutForSearch(text: string): string[] {
  if (!loaded) return fallbackTokenize(text);
  try {
    return cut_for_search(text, true); // HMM=true
  } catch {
    return fallbackTokenize(text);
  }
}

/**
 * 降级分词：简单空格分割（英文）+ 单字（中文）
 * @param text - 待分词文本
 * @returns 分词结果数组
 */
function fallbackTokenize(text: string): string[] {
  // 降级：简单空格分割（英文）+ 单字（中文）
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  tokens.push(...(lower.match(/[a-z0-9]+/g) || []));
  tokens.push(...(lower.match(/[\u4e00-\u9fff]/g) || []));
  return tokens;
}
