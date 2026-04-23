import React, { useMemo } from 'react';
import { useAIStore } from '../../stores/ai';
import type { TokenUsage } from '@shared/types';

// ===== 辅助函数 =====

/** 格式化数字，添加千位分隔符 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

/** 计算总输入 token（安全处理 undefined 值） */
function getTotalInput(usage: TokenUsage): number {
  const inputOther = usage.inputOther ?? 0;
  const inputCacheRead = usage.inputCacheRead ?? 0;
  const inputCacheCreation = usage.inputCacheCreation ?? 0;
  return inputOther + inputCacheRead + inputCacheCreation;
}

/** 获取上下文使用率的颜色 */
function getContextColor(usage?: number): string {
  if (!usage) return 'var(--content-tertiary)';
  if (usage > 95) return 'var(--danger)';
  if (usage > 80) return 'var(--warning)';
  return 'var(--content-secondary)';
}

/** 获取上下文使用率的背景色 */
function getContextBgColor(usage?: number): string {
  if (!usage) return 'var(--surface-tertiary)';
  if (usage > 95) return 'var(--danger-light)';
  if (usage > 80) return 'var(--warning-light)';
  return 'var(--surface-tertiary)';
}

// ===== TokenStatusBar Component =====
/**
 * Token 用量状态栏组件
 * 显示当前会话的 Token 消耗和上下文使用率
 */
const TokenStatusBar: React.FC = () => {
  const statusInfo = useAIStore((s) => s.statusInfo);
  const sessionStatus = useAIStore((s) => s.sessionStatus);

  const display = useMemo(() => {
    const { tokenUsage, contextUsage } = statusInfo;

    // 没有 token 数据时显示简化状态
    if (!tokenUsage) {
      const statusText = sessionStatus === 'busy' ? '生成中...' :
                         sessionStatus === 'error' ? '错误' :
                         sessionStatus === 'stopped' ? '已停止' : '就绪';
      return { statusText };
    }

    // 安全处理所有可能为 undefined 的数值字段
    const totalInput = getTotalInput(tokenUsage);
    const output = tokenUsage.output ?? 0;
    const cacheRead = tokenUsage.inputCacheRead ?? 0;
    const cacheCreation = tokenUsage.inputCacheCreation ?? 0;

    return {
      input: formatNumber(totalInput),
      output: formatNumber(output),
      contextUsage: contextUsage ? Math.round(contextUsage * 100) : undefined,
      contextColor: getContextColor(contextUsage),
      contextBgColor: getContextBgColor(contextUsage),
      cacheRead,
      cacheCreation,
    };
  }, [statusInfo, sessionStatus]);

  // 简化状态显示（无 token 数据）
  if (!statusInfo.tokenUsage) {
    return (
      <div className="px-3 py-1.5 bg-surface-secondary border-t border-edge text-[11px] text-content-tertiary flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          {sessionStatus === 'busy' && (
            <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
            </svg>
          )}
          {display.statusText}
        </span>
      </div>
    );
  }

  return (
    <div className="px-3 py-1.5 bg-surface-secondary border-t border-edge text-[11px] flex items-center gap-3 overflow-hidden">
      {/* 输入 token */}
      <span className="text-content-secondary shrink-0">
        输入: <span className="text-content font-medium">{display.input}</span>
        {display.cacheRead != null && display.cacheRead > 0 && (
          <span className="text-success ml-1" title="缓存读取">
            (+{formatNumber(display.cacheRead)} 缓存)
          </span>
        )}
      </span>

      {/* 分隔符 */}
      <span className="text-edge">|</span>

      {/* 输出 token */}
      <span className="text-content-secondary shrink-0">
        输出: <span className="text-content font-medium">{display.output}</span>
      </span>

      {/* 分隔符 */}
      <span className="text-edge">|</span>

      {/* 上下文使用率 */}
      {display.contextUsage !== undefined && (
        <span
          className="px-1.5 py-0.5 rounded shrink-0"
          style={{
            background: display.contextBgColor,
            color: display.contextColor
          }}
        >
          上下文: {display.contextUsage}%
          {display.contextUsage > 80 && (
            <span className="ml-1">
              {display.contextUsage > 95 ? '!' : '⚠'}
            </span>
          )}
        </span>
      )}

      {/* 右侧状态指示 */}
      {sessionStatus === 'busy' && (
        <span className="ml-auto flex items-center gap-1 text-accent shrink-0">
          <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
          </svg>
          生成中
        </span>
      )}
    </div>
  );
};

export { TokenStatusBar };