import React, { useState } from 'react';
import type { AIApprovalContent, AIApprovalDisplay } from '@shared/types';
import { useAIStore } from '../../stores/ai';
import { aiWs } from '../../services/ai-ws';

/** AI 审批消息属性 */
interface AIApprovalMessageProps {
  /** 消息 ID */
  messageId: string;
  /** 审批内容 */
  content: AIApprovalContent;
}

/** 审批内容展示项组件 */
const DisplayItem: React.FC<{ display: AIApprovalDisplay }> = ({ display }) => {
  if (display.type === 'diff') {
    return (
      <pre className="p-3 rounded-lg text-[11px] leading-relaxed font-mono max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all"
        style={{ background: '#1e1e2e', color: '#cdd6f4' }}
      >
        {display.content && renderDiffContent(display.content as string)}
      </pre>
    );
  }
  return (
    <div className="text-[13px] text-content-secondary whitespace-pre-wrap">
      {display.content ? String(display.content) : JSON.stringify(display, null, 2)}
    </div>
  );
};

/**
 * 渲染 diff 格式内容（新增行为绿色，删除行为红色）
 * @param content diff 文本内容
 * @returns React 节点数组
 */
function renderDiffContent(content: string): React.ReactNode {
  const lines = content.split('\n');
  return lines.map((line, i) => {
    let className = '';
    if (line.startsWith('+') && !line.startsWith('+++')) className = 'text-success';
    else if (line.startsWith('-') && !line.startsWith('---')) className = 'text-danger';
    return <div key={i} className={className}>{line}</div>;
  });
}

/**
 * AI 操作审批消息组件
 * 展示 AI 请求的审批操作，支持批准或拒绝，可显示 diff 等多种内容格式
 */
const AIApprovalMessage: React.FC<AIApprovalMessageProps> = ({ messageId, content }) => {
  const [responding, setResponding] = useState(false);
  const activeSessionId = useAIStore((s) => s.activeSessionId);
  const updateMessage = useAIStore((s) => s.updateMessage);
  const responded = content.responded;

  const handleRespond = (response: 'approve' | 'reject') => {
    if (responded || responding || !activeSessionId) return;
    setResponding(true);

    // 通过 WebSocket 发送审批响应
    aiWs.sendApproval(content.requestId, response);

    // 更新消息状态
    updateMessage(messageId, { content: { ...content, responded: true, response } });
    setResponding(false);
  };

  return (
    <div className="my-2 rounded-xl border-2 border-warning overflow-hidden bg-surface-secondary">
      <div className="flex items-center gap-2 px-3.5 py-2.5 bg-warning/8">
        <span className="text-warning shrink-0">⚠️</span>
        <span className="text-[13px] font-semibold text-content">需要审批：{content.action}</span>
        {responded && (
          <span className={`ml-auto text-[12px] ${content.response === 'approve' ? 'text-success' : 'text-danger'}`}>
            {content.response === 'approve' ? '已批准' : '已拒绝'}
          </span>
        )}
      </div>
      <p className="px-3.5 py-3 text-[13px] text-content-secondary leading-relaxed">{content.description}</p>
      {content.display && content.display.length > 0 && (
        <div className="px-3.5 pb-3 flex flex-col gap-2">
          {content.display.map((item: any, i: number) => <DisplayItem key={i} display={item} />)}
        </div>
      )}
      <div className="flex gap-2 px-3.5 py-2.5 border-t border-edge">
        <button onClick={() => handleRespond('approve')} disabled={responded || responding}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-success text-white text-[13px] font-medium hover:bg-[#15803d] transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >批准</button>
        <button onClick={() => handleRespond('reject')} disabled={responded || responding}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-surface-secondary text-danger border border-danger text-[13px] font-medium hover:bg-danger hover:text-white transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
        >拒绝</button>
      </div>
    </div>
  );
};

export { AIApprovalMessage };
