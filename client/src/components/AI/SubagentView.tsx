import React, { useState, useMemo } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import type { SubagentEvent, WireEvent } from '@shared/types';
import { getToolMeta, extractPrimaryParam, safeStringify, TerminalIcon, FileEditIcon } from './tool-meta';

interface SubagentViewProps {
  events: SubagentEvent[];
}

// ===== 步骤类型定义 =====
interface ThinkingStep {
  type: 'thinking';
  text: string;
}

interface ToolStep {
  type: 'tool';
  name: string;
  displayName: string;
  icon: React.FC<{ size?: number; className?: string }>;
  param: string;
  status: 'running' | 'success' | 'error';
  arguments?: string;
  output?: string;
}

interface TextStep {
  type: 'text';
  text: string;
}

type Step = ThinkingStep | ToolStep | TextStep;

// ===== Shared Icons =====
const ChevronIcon: React.FC<{ size?: number; className?: string }> = ({ size = 12, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className={`transition-transform duration-200 ${className || ''}`}
  ><path d="M9 18l6-6-6-6" /></svg>
);

const SpinnerIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className={`animate-spin ${className || ''}`}
  >
    <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
  </svg>
);

const CheckCircleIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="9 12 12 15 16 10" />
  </svg>
);

const XCircleIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

// ===== Event Aggregation =====

/** 需要过滤掉的内部事件类型 */
const HIDDEN_EVENT_TYPES = new Set(['StepBegin', 'StepEnd', 'StatusUpdate', 'TurnBegin', 'TurnEnd']);

/** 将原始 WireEvent 流聚合为用户可见的 Step 列表 */
function aggregateSteps(events: WireEvent[]): Step[] {
  const steps: Step[] = [];

  for (const event of events) {
    if (HIDDEN_EVENT_TYPES.has(event.type)) continue;

    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
      case 'ContentPart': {
        const contentType = String(payload?.type || 'text');
        // 防御性处理：text / think 可能是对象而非字符串
        const rawText = payload?.text ?? payload?.think ?? '';
        const text = typeof rawText === 'string' ? rawText : String(rawText);
        if (!text.trim()) break;

        if (contentType === 'think') {
          // 追加到最后一个 ThinkingStep，或新建一个
          const last = steps[steps.length - 1];
          if (last && last.type === 'thinking') {
            last.text += '\n' + text;
          } else {
            steps.push({ type: 'thinking', text });
          }
        } else {
          steps.push({ type: 'text', text });
        }
        break;
      }

      case 'ToolCall': {
        const func = payload?.function as Record<string, unknown>;
        const funcName = String(func?.name || 'tool');
        const meta = getToolMeta(funcName);
        // kimi JSON-RPC 可能发送 arguments 为 JSON 对象而非字符串，统一转为字符串
        const rawArgs = func?.arguments;
        const args = safeStringify(rawArgs);
        steps.push({
          type: 'tool',
          name: funcName,
          displayName: meta.displayName,
          icon: meta.icon,
          param: extractPrimaryParam(args, meta.paramKeys),
          status: 'running',
          arguments: args,
        });
        break;
      }

      case 'ToolResult': {
        // 回填最近的 running ToolStep
        const returnValue = payload?.return_value as Record<string, unknown>;
        const isError = Boolean(returnValue?.is_error);
        const output = typeof returnValue?.output === 'string' ? returnValue.output : '';
        for (let i = steps.length - 1; i >= 0; i--) {
          const step = steps[i];
          if (step.type === 'tool' && step.status === 'running') {
            step.status = isError ? 'error' : 'success';
            step.output = output;
            break;
          }
        }
        break;
      }
    }
  }

  return steps;
}

// ===== Helper: Subagent Status =====

function getSubagentStatus(events: SubagentEvent[]): 'running' | 'success' | 'error' {
  for (let i = events.length - 1; i >= 0; i--) {
    const innerEvent = events[i].payload.event;
    if (innerEvent.type === 'ToolResult') {
      const payload = innerEvent.payload as { return_value?: { is_error?: boolean } };
      return payload?.return_value?.is_error ? 'error' : 'success';
    }
    if (innerEvent.type === 'TurnEnd') {
      return 'success';
    }
  }
  return events.length > 0 ? 'running' : 'success';
}

// ===== Step Item Components =====

const ThinkingStepItem: React.FC<{ step: ThinkingStep }> = ({ step }) => {
  // 截断到 2 行（约 80 字符）
  const displayText = step.text.length > 80 ? step.text.slice(0, 80) + '...' : step.text;

  return (
    <div className="flex items-start gap-2 py-1 text-[11px]">
      <span className="shrink-0 mt-0.5 text-purple-400/70">💭</span>
      <span className="text-content-tertiary italic leading-relaxed line-clamp-2">{displayText}</span>
    </div>
  );
};

const TextStepItem: React.FC<{ step: TextStep }> = ({ step }) => {
  const displayText = step.text.length > 60 ? step.text.slice(0, 60) + '...' : step.text;

  return (
    <div className="flex items-start gap-2 py-1 text-[11px]">
      <span className="shrink-0 mt-0.5 text-content-tertiary/60">·</span>
      <span className="text-content-secondary leading-relaxed line-clamp-1">{displayText}</span>
    </div>
  );
};

function formatArguments(args: string): string {
  const str = safeStringify(args, '');
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

function truncateOutput(output: string, maxLen = 500): string {
  if (output.length <= maxLen) return output;
  return output.slice(0, maxLen) + '\n... (输出已截断)';
}

const ToolStepItem: React.FC<{ step: ToolStep }> = ({ step }) => {
  const ToolIcon = step.icon;

  return (
    <Collapsible.Root defaultOpen={false}>
      <Collapsible.Trigger className="group flex items-center gap-2 w-full py-1 text-[11px] cursor-pointer hover:bg-surface-hover/50 rounded px-1 -mx-1 transition-colors duration-100">
        {/* Status / Tool Icon */}
        <span className="shrink-0 flex items-center justify-center w-4 h-4">
          {step.status === 'running' ? (
            <SpinnerIcon size={12} className="text-accent" />
          ) : step.status === 'error' ? (
            <XCircleIcon size={12} className="text-danger" />
          ) : (
            <ToolIcon size={12} className="text-success/70" />
          )}
        </span>

        {/* Display Name */}
        <span className="text-content-secondary font-medium shrink-0">{step.displayName}</span>

        {/* Parameter */}
        {step.param && (
          <span className="text-content-tertiary font-mono truncate flex-1">{step.param}</span>
        )}

        {/* Expand hint */}
        <ChevronIcon size={10} className="text-content-tertiary/40 shrink-0 group-data-[state=open]:rotate-90" />
      </Collapsible.Trigger>

      <Collapsible.Content>
        <div className="ml-6 mt-1 mb-2 space-y-2 border-l-2 border-edge pl-3">
          {step.arguments && (
            <div>
              <div className="text-[10px] text-content-tertiary mb-1">参数</div>
              <pre className="p-2 rounded text-[10px] leading-relaxed font-mono max-h-[150px] overflow-y-auto whitespace-pre-wrap break-all"
                style={{ background: '#1e1e2e', color: '#cdd6f4' }}
              >
                {formatArguments(step.arguments)}
              </pre>
            </div>
          )}
          {step.output && (
            <div>
              <div className="text-[10px] text-content-tertiary mb-1">结果</div>
              <pre className={`
                p-2 rounded text-[10px] leading-relaxed font-mono max-h-[150px] overflow-y-auto whitespace-pre-wrap break-all
                ${step.status === 'error' ? 'bg-danger-light text-danger border border-danger/20' : 'bg-surface-tertiary text-content-secondary'}
              `}>
                {truncateOutput(step.output)}
              </pre>
            </div>
          )}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
};

// ===== SubagentView Component =====

/**
 * 子代理视图组件
 * 展示 AI 子代理的执行事件流，包括思考、工具调用和文本输出
 */
const SubagentView: React.FC<SubagentViewProps> = ({ events }) => {
  const [isOpen, setIsOpen] = useState(false);

  // 所有 hooks 必须在条件返回之前调用，否则 React error #310
  const steps = useMemo(() => {
    const innerEvents = events.map(e => e.payload.event);
    return aggregateSteps(innerEvents);
  }, [events]);

  const summary = useMemo(() => {
    const firstThinking = steps.find(s => s.type === 'thinking');
    if (firstThinking) {
      const text = firstThinking.text.trim();
      return text.length > 30 ? text.slice(0, 30) + '...' : text;
    }
    const firstTool = steps.find(s => s.type === 'tool');
    if (firstTool) return `${firstTool.displayName} ${firstTool.param}`;
    return `${steps.length} 步`;
  }, [steps]);

  if (steps.length === 0) return null;

  const status = getSubagentStatus(events);
  const subagentType = events[0]?.payload?.subagent_type || 'agent';

  return (
    <Collapsible.Root
      open={isOpen}
      onOpenChange={setIsOpen}
      className="my-1.5 rounded-lg border border-edge bg-surface-secondary overflow-hidden"
    >
      <Collapsible.Trigger className="group flex items-center gap-2 w-full px-3 py-2 bg-surface-tertiary text-[12px] font-medium text-content hover:bg-surface-hover transition-colors duration-150 cursor-pointer">
        {/* Status Icon */}
        <span className="shrink-0">
          {status === 'running' && <SpinnerIcon size={12} className="text-accent" />}
          {status === 'success' && <CheckCircleIcon size={12} className="text-success" />}
          {status === 'error' && <XCircleIcon size={12} className="text-danger" />}
        </span>

        {/* Agent Type */}
        <span className="text-accent shrink-0">{subagentType}</span>

        {/* Summary */}
        <span className="text-[11px] text-content-tertiary truncate flex-1">
          {summary}
        </span>

        {/* Step Count */}
        <span className="text-[10px] text-content-tertiary px-1.5 py-0.5 bg-surface rounded shrink-0">
          {steps.length}步
        </span>

        {/* Expand Icon */}
        <ChevronIcon size={10} className={`text-content-tertiary shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
      </Collapsible.Trigger>

      <Collapsible.Content>
        <div className="px-3 py-2 border-t border-edge space-y-0.5">
          {steps.map((step, index) => {
            switch (step.type) {
              case 'thinking':
                return <ThinkingStepItem key={`think-${index}`} step={step} />;
              case 'tool':
                return <ToolStepItem key={`tool-${index}`} step={step} />;
              case 'text':
                return <TextStepItem key={`text-${index}`} step={step} />;
            }
          })}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
};

export { SubagentView };
