import React, { useState, useCallback } from 'react';
import type { AIQuestionContent, QuestionItem } from '@shared/types';
import { aiWs } from '../../services/ai-ws';

/** 问题对话框属性 */
interface QuestionDialogProps {
  /** 问题内容 */
  content: AIQuestionContent;
}

// ===== 图标组件 =====
const QuestionIcon: React.FC<{ size?: number; className?: string }> = ({ size = 16, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const SendIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

/**
 * AI 问题对话框组件
 * 展示 AI 主动提问，支持选项选择和自由文本输入
 */
const QuestionDialog: React.FC<QuestionDialogProps> = ({ content }) => {
  const { questionId, questions } = content;

  // 单个问题的回答状态
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // 多选项问题的选择状态
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  // 自由输入的回答
  const [freeTextAnswers, setFreeTextAnswers] = useState<Record<string, string>>({});

  // 更新答案
  const updateAnswer = useCallback((questionId: string, value: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  }, []);

  // 更新选项选择
  const updateOptionSelection = useCallback((qId: string, option: string) => {
    setSelectedOptions(prev => ({ ...prev, [qId]: option }));
    updateAnswer(qId, option);
  }, [updateAnswer]);

  // 更新自由文本输入
  const updateFreeText = useCallback((qId: string, text: string) => {
    setFreeTextAnswers(prev => ({ ...prev, [qId]: text }));
    updateAnswer(qId, text);
  }, [updateAnswer]);

  // 发送回答
  const handleSendAnswer = useCallback((qId: string) => {
    const answer = answers[qId];
    if (!answer?.trim()) return;

    aiWs.sendAnswer(questionId, answer.trim());

    // 标记该问题已回答（从 UI 移除或标记）
    // 这里暂时不处理，由父组件通过 store 更新消息状态
  }, [questionId, answers]);

  // 发送所有回答
  const handleSendAll = useCallback(() => {
    // 将所有回答合并发送
    const allAnswers = questions.map(q => ({
      questionId: q.id,
      answer: answers[q.id] || ''
    })).filter(a => a.answer.trim());

    if (allAnswers.length === 0) return;

    // 发送第一个有内容的回答（目前 wire 协议不支持批量）
    // 后续可能需要逐个发送
    for (const { questionId: qId, answer } of allAnswers) {
      aiWs.sendAnswer(questionId, answer);
    }
  }, [questions, answers]);

  // 检查是否所有问题都有回答
  const allAnswered = questions.every(q => (answers[q.id] || '').trim());

  return (
    <div className="my-3 px-4 py-3 rounded-xl border border-edge bg-surface-secondary">
      {/* 头部 */}
      <div className="flex items-center gap-2 mb-3">
        <QuestionIcon size={16} className="text-accent" />
        <span className="text-[13px] font-medium text-content">AI 需要更多信息</span>
      </div>

      {/* 问题列表 */}
      <div className="space-y-4">
        {questions.map((q) => (
          <div key={q.id} className="space-y-2">
            {/* 问题文本 */}
            <div className="text-[13px] text-content">
              {q.text}
            </div>

            {/* 选项（如有） */}
            {q.options && q.options.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {q.options.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => updateOptionSelection(q.id, opt)}
                    className={`
                      px-3 py-1.5 rounded-lg text-[12px] font-medium
                      transition-colors duration-150 cursor-pointer
                      ${selectedOptions[q.id] === opt
                        ? 'bg-accent text-white'
                        : 'bg-surface-tertiary text-content-secondary hover:bg-surface-hover hover:text-content'
                      }
                    `}
                  >
                    {opt}
                  </button>
                ))}

                {/* 自由输入选项 */}
                <input
                  type="text"
                  value={freeTextAnswers[q.id] || ''}
                  onChange={(e) => updateFreeText(q.id, e.target.value)}
                  placeholder="或输入其他答案..."
                  className="flex-1 min-w-[120px] px-3 py-1.5 rounded-lg text-[12px] bg-surface-tertiary text-content placeholder:text-content-tertiary outline-none border border-edge focus:border-accent"
                />
              </div>
            ) : (
              /* 自由文本输入 */
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={answers[q.id] || ''}
                  onChange={(e) => updateAnswer(q.id, e.target.value)}
                  placeholder="输入回答..."
                  className="flex-1 px-3 py-2 rounded-lg text-[12px] bg-surface-tertiary text-content placeholder:text-content-tertiary outline-none border border-edge focus:border-accent"
                />
                <button
                  onClick={() => handleSendAnswer(q.id)}
                  disabled={!answers[q.id]?.trim()}
                  className={`
                    px-3 py-2 rounded-lg text-[12px] font-medium
                    transition-colors duration-150
                    ${answers[q.id]?.trim()
                      ? 'bg-accent text-white hover:bg-accent/90 cursor-pointer'
                      : 'bg-surface-tertiary text-content-tertiary cursor-not-allowed'
                    }
                  `}
                >
                  <SendIcon size={14} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 提交所有按钮（多个问题且全部回答时显示） */}
      {questions.length > 1 && allAnswered && (
        <div className="mt-3 pt-3 border-t border-edge">
          <button
            onClick={handleSendAll}
            className="w-full px-4 py-2 rounded-lg bg-accent text-white text-[12px] font-medium hover:bg-accent/90 transition-colors cursor-pointer"
          >
            提交所有回答
          </button>
        </div>
      )}
    </div>
  );
};

export { QuestionDialog };