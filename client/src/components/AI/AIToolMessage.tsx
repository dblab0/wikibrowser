import React from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import type { AIToolCallContent, AIToolResultContent } from '@shared/types';
import { getToolMeta, extractPrimaryParam, safeStringify } from './tool-meta';

/** AI 工具调用消息属性 */
interface AIToolMessageProps {
  /** 工具调用内容 */
  content: AIToolCallContent;
  /** 工具执行结果 */
  result?: AIToolResultContent;
}

// ===== 图标组件 =====
const ChevronIcon: React.FC<{ size?: number; className?: string }> = ({ size = 12, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className={`transition-transform duration-200 ${className || ''}`}
  ><path d="M9 18l6-6-6-6" /></svg>
);

const CheckIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const XIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// ===== 辅助函数 =====

/**
 * 格式化工具调用参数为美化的 JSON
 * @param args 原始参数字符串
 * @returns 格式化后的 JSON 字符串
 */
function formatArguments(args: string): string {
  const str = safeStringify(args, '');
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

/**
 * 截断过长的输出内容
 * @param output 原始输出
 * @param maxLen 最大长度
 * @returns 截断后的字符串
 */
function truncateOutput(output: string, maxLen: number = 500): string {
  if (output.length <= maxLen) return output;
  return output.slice(0, maxLen) + '\n... (输出已截断)';
}

/**
 * AI 工具调用消息组件
 * 可折叠展示工具调用的参数和执行结果，带状态图标
 */
const AIToolMessage: React.FC<AIToolMessageProps> = ({ content, result }) => {
  const meta = getToolMeta(content.functionName);
  const ToolIcon = meta.icon;
  const primaryParam = extractPrimaryParam(content.arguments, meta.paramKeys);
  const status = result ? (result.isError ? 'error' : 'success') : 'running';

  return (
    <Collapsible.Root
      defaultOpen={false}
      className="my-2 rounded-xl border border-edge bg-surface-secondary overflow-hidden"
    >
      <Collapsible.Trigger className="group flex items-center gap-2 w-full px-3.5 py-2.5 bg-surface-tertiary text-[13px] font-medium text-content hover:bg-surface-hover transition-colors duration-150 cursor-pointer">
        {/* 工具图标 */}
        <span className={`shrink-0 ${status === 'running' ? 'animate-pulse' : ''}`}>
          <ToolIcon size={14} className={status === 'error' ? 'text-danger' : 'text-content-tertiary'} />
        </span>

        {/* 显示名称 */}
        <span className="text-content-secondary shrink-0">{meta.displayName}</span>

        {/* 主要参数 */}
        {primaryParam && (
          <span className="text-[11px] text-content-tertiary truncate flex-1 font-mono">
            {primaryParam}
          </span>
        )}

        {/* 状态 */}
        <span className="shrink-0">
          {status === 'running' && <span className="text-[11px] text-accent">...</span>}
          {status === 'success' && <CheckIcon size={14} className="text-success" />}
          {status === 'error' && <XIcon size={14} className="text-danger" />}
        </span>

        {/* 展开图标 */}
        <ChevronIcon size={12} className="group-data-[state=open]:rotate-90 shrink-0 text-content-tertiary" />
      </Collapsible.Trigger>

      <Collapsible.Content>
        <div className="px-3.5 py-3 border-t border-edge space-y-2">
          {/* 参数 */}
          <div>
            <div className="text-[11px] text-content-tertiary mb-1">参数</div>
            <pre className="p-3 rounded-lg text-[11px] leading-relaxed font-mono max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all"
              style={{ background: '#1e1e2e', color: '#cdd6f4' }}
            >
              {formatArguments(content.arguments)}
            </pre>
          </div>

          {/* 结果 */}
          {result && (
            <div>
              <div className="text-[11px] text-content-tertiary mb-1">结果</div>
              <pre className={`
                p-3 rounded-lg text-[11px] leading-relaxed font-mono max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all
                ${result.isError ? 'bg-danger-light text-danger border border-danger/20' : 'bg-surface-tertiary text-content-secondary'}
              `}>
                {truncateOutput(result.output)}
              </pre>
            </div>
          )}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
};

export { AIToolMessage };
