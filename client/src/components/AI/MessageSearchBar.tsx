import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { AIMessage } from '@shared/types';

/** 消息搜索栏属性 */
interface MessageSearchBarProps {
  /** 消息列表 */
  messages: AIMessage[];
  /** 关闭回调 */
  onClose: () => void;
  /** 高亮匹配回调 */
  onHighlight: (messageId: string, matchIndex: number) => void;
}

// ===== 图标组件 =====
const SearchIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.2-4.2" />
  </svg>
);

const ChevronUpIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

const ChevronDownIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CloseIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// ===== 辅助函数 =====

/** 提取消息的可搜索文本内容 */
function extractSearchableText(message: AIMessage): string {
  const content = message.content;

  switch (message.type) {
    case 'text':
      return (content as { text: string }).text || '';

    case 'think':
      return (content as { think: string }).think || '';

    case 'tool_call': {
      const tc = content as { functionName: string; arguments: string };
      return `${tc.functionName || ''} ${tc.arguments || ''}`;
    }

    case 'tool_result': {
      const tr = content as { output: string };
      return tr.output || '';
    }

    case 'approval': {
      const ap = content as { action: string; description: string };
      return `${ap.action || ''} ${ap.description || ''}`;
    }

    case 'question': {
      const q = content as { questions: Array<{ text: string; options?: string[] }> };
      return q.questions?.map(q => `${q.text} ${q.options?.join(' ') || ''}`).join(' ') || '';
    }

    default:
      return '';
  }
}

/** 在文本中查找所有匹配位置 */
function findMatches(text: string, query: string): number[] {
  if (!query.trim()) return [];

  const matches: number[] = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  let pos = 0;
  while (pos < lowerText.length) {
    const idx = lowerText.indexOf(lowerQuery, pos);
    if (idx === -1) break;
    matches.push(idx);
    pos = idx + 1;
  }

  return matches;
}

/**
 * 消息搜索栏组件
 * 支持在 AI 对话消息中搜索文本，上下导航匹配结果
 */
const MessageSearchBar: React.FC<MessageSearchBarProps> = ({ messages, onClose, onHighlight }) => {
  const [query, setQuery] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 搜索所有消息，找到匹配项
  const searchResults = useMemo(() => {
    if (!query.trim()) return [];

    const results: Array<{ messageId: string; matchPositions: number[]; text: string }> = [];

    for (const message of messages) {
      const text = extractSearchableText(message);
      const matchPositions = findMatches(text, query);

      if (matchPositions.length > 0) {
        results.push({
          messageId: message.id,
          matchPositions,
          text,
        });
      }
    }

    return results;
  }, [messages, query]);

  // 总匹配数
  const totalMatches = useMemo(() => {
    return searchResults.reduce((sum, r) => sum + r.matchPositions.length, 0);
  }, [searchResults]);

  // 当前匹配信息
  const currentMatchInfo = useMemo(() => {
    if (searchResults.length === 0 || totalMatches === 0) return null;

    // 计算 currentIndex 对应的消息和匹配位置
    let count = 0;
    for (const result of searchResults) {
      if (currentIndex < count + result.matchPositions.length) {
        const matchIndex = currentIndex - count;
        return {
          messageId: result.messageId,
          matchIndex,
          position: result.matchPositions[matchIndex],
          text: result.text,
        };
      }
      count += result.matchPositions.length;
    }

    // 超出范围，返回第一个
    return {
      messageId: searchResults[0].messageId,
      matchIndex: 0,
      position: searchResults[0].matchPositions[0],
      text: searchResults[0].text,
    };
  }, [searchResults, currentIndex, totalMatches]);

  // 导航到上一个
  const goToPrev = useCallback(() => {
    if (totalMatches === 0) return;
    const newIndex = currentIndex > 0 ? currentIndex - 1 : totalMatches - 1;
    setCurrentIndex(newIndex);
  }, [currentIndex, totalMatches]);

  // 导航到下一个
  const goToNext = useCallback(() => {
    if (totalMatches === 0) return;
    const newIndex = currentIndex < totalMatches - 1 ? currentIndex + 1 : 0;
    setCurrentIndex(newIndex);
  }, [currentIndex, totalMatches]);

  // 高亮当前匹配
  useEffect(() => {
    if (currentMatchInfo) {
      onHighlight(currentMatchInfo.messageId, currentMatchInfo.matchIndex);
    }
  }, [currentMatchInfo, onHighlight]);

  // 键盘事件处理
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        goToPrev();
      } else {
        goToNext();
      }
    } else if (e.key === 'ArrowUp') {
      goToPrev();
    } else if (e.key === 'ArrowDown') {
      goToNext();
    }
  }, [onClose, goToPrev, goToNext]);

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-surface-secondary border-b border-edge">
      {/* 搜索图标 */}
      <SearchIcon size={14} className="text-content-tertiary shrink-0" />

      {/* 输入框 */}
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setCurrentIndex(0); // 重置到第一个匹配
        }}
        onKeyDown={handleKeyDown}
        placeholder="搜索消息..."
        className="flex-1 bg-transparent text-[13px] text-content placeholder:text-content-tertiary outline-none"
        spellCheck={false}
      />

      {/* 匹配计数 */}
      <div className="text-[11px] text-content-tertiary shrink-0 min-w-[40px] text-right">
        {query.trim() ? (
          totalMatches > 0 ? (
            `${currentIndex + 1}/${totalMatches}`
          ) : (
            '无匹配'
          )
        ) : ''}
      </div>

      {/* 上一个/下一个按钮 */}
      {query.trim() && totalMatches > 0 && (
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={goToPrev}
            className="p-1 rounded hover:bg-surface-hover text-content-tertiary hover:text-content transition-colors"
            title="上一个 (Shift+Enter / ↑)"
          >
            <ChevronUpIcon size={14} />
          </button>
          <button
            onClick={goToNext}
            className="p-1 rounded hover:bg-surface-hover text-content-tertiary hover:text-content transition-colors"
            title="下一个 (Enter / ↓)"
          >
            <ChevronDownIcon size={14} />
          </button>
        </div>
      )}

      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        className="p-1 rounded hover:bg-surface-hover text-content-tertiary hover:text-content transition-colors shrink-0"
        title="关闭 (Esc)"
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
};

export { MessageSearchBar };