import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { WireEvent } from '@shared/types';

interface WireDebugPanelProps {
  sessionId: string;
}

// ===== 类型定义 =====
interface StoredEvent {
  id: string;
  timestamp: string;
  type: string;
  payload: unknown;
}

// ===== Icons =====
const ChevronIcon: React.FC<{ size?: number; className?: string }> = ({ size = 12, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    className={`transition-transform duration-200 ${className || ''}`}
  ><path d="M9 18l6-6-6-6" /></svg>
);

const SearchIcon: React.FC<{ size?: number; className?: string }> = ({ size = 14, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.2-4.2" />
  </svg>
);

const ClearIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

// ===== Event Type Filter Options =====
const EVENT_TYPES = [
  { value: 'all', label: '全部' },
  { value: 'TurnBegin', label: 'TurnBegin' },
  { value: 'TurnEnd', label: 'TurnEnd' },
  { value: 'StepBegin', label: 'StepBegin' },
  { value: 'ContentPart', label: 'ContentPart' },
  { value: 'TextPart', label: 'TextPart' },
  { value: 'ThinkPart', label: 'ThinkPart' },
  { value: 'ToolCall', label: 'ToolCall' },
  { value: 'ToolCallPart', label: 'ToolCallPart' },
  { value: 'ToolResult', label: 'ToolResult' },
  { value: 'StatusUpdate', label: 'StatusUpdate' },
  { value: 'QuestionRequest', label: 'QuestionRequest' },
  { value: 'SubagentEvent', label: 'SubagentEvent' },
  { value: 'SessionStatus', label: 'SessionStatus' },
  { value: 'ApprovalRequest', label: 'ApprovalRequest' },
];

// ===== Helper Functions =====

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour12: false });
}

function getPayloadSize(payload: unknown): number {
  try {
    return JSON.stringify(payload).length;
  } catch {
    return 0;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}b`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kb`;
  return `${(bytes / 1024 / 1024).toFixed(1)}mb`;
}

// ===== WireDebugPanel Component =====
/**
 * Wire 协议调试面板组件
 * 实时展示 WebSocket 事件流，支持按类型过滤和事件详情查看
 */
const WireDebugPanel: React.FC<WireDebugPanelProps> = ({ sessionId }) => {
  // Events storage
  const [events, setEvents] = useState<StoredEvent[]>([]);
  // Filter state
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  // Selected event for detail view
  const [selectedEvent, setSelectedEvent] = useState<StoredEvent | null>(null);
  // Auto-scroll
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  // Listen to WebSocket events from global event bus
  // Note: This requires a global event emitter to be set up in AIPanel
  // For now, we'll use a simple approach with a custom hook
  useEffect(() => {
    // Create a global event store for debug events
    const eventStore = (window as any).__wireDebugEvents || {};
    (window as any).__wireDebugEvents = eventStore;

    // Subscribe to new events
    const handleNewEvent = (event: { type: string; payload: unknown }) => {
      const stored: StoredEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: formatTimestamp(new Date()),
        type: event.type,
        payload: event.payload,
      };
      setEvents(prev => [...prev, stored]);
    };

    eventStore[sessionId] = handleNewEvent;

    return () => {
      delete eventStore[sessionId];
    };
  }, [sessionId]);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  // Filtered events
  const filteredEvents = useMemo(() => {
    let result = events;

    // Type filter
    if (filterType !== 'all') {
      result = result.filter(e => e.type === filterType);
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(e => {
        // Search in type
        if (e.type.toLowerCase().includes(query)) return true;
        // Search in payload
        try {
          const payloadStr = JSON.stringify(e.payload).toLowerCase();
          return payloadStr.includes(query);
        } catch {
          return false;
        }
      });
    }

    return result;
  }, [events, filterType, searchQuery]);

  // Clear events
  const clearEvents = useCallback(() => {
    setEvents([]);
    setSelectedEvent(null);
  }, []);

  // Statistics
  const stats = useMemo(() => {
    const totalCount = events.length;
    const totalSize = events.reduce((sum, e) => sum + getPayloadSize(e.payload), 0);

    // Token usage (from StatusUpdate events)
    let lastTokenUsage: { input?: number; output?: number } | null = null;
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'StatusUpdate') {
        const payload = e.payload as {
          token_usage?: { inputOther?: number; output?: number; inputCacheRead?: number; inputCacheCreation?: number };
        };
        if (payload?.token_usage) {
          // 安全处理 undefined/NaN 值
          const inputOther = payload.token_usage.inputOther ?? 0;
          const inputCacheRead = payload.token_usage.inputCacheRead ?? 0;
          const inputCacheCreation = payload.token_usage.inputCacheCreation ?? 0;
          const totalInput = inputOther + inputCacheRead + inputCacheCreation;
          lastTokenUsage = {
            input: totalInput,
            output: payload.token_usage.output ?? 0,
          };
          break;
        }
      }
    }

    return {
      totalCount,
      filteredCount: filteredEvents.length,
      totalSize,
      tokenUsage: lastTokenUsage,
    };
  }, [events, filteredEvents]);

  return (
    <div className="mt-2 rounded-lg border border-edge bg-surface-secondary overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface-tertiary border-b border-edge">
        <span className="text-[11px] font-medium text-content">Wire Debug</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={clearEvents}
            className="p-1 rounded hover:bg-surface-hover text-content-tertiary hover:text-content transition-colors"
            title="清除事件"
          >
            <ClearIcon size={12} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-edge">
        {/* Type Filter */}
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-2 py-1 rounded text-[11px] bg-surface-tertiary text-content border border-edge outline-none cursor-pointer"
        >
          {EVENT_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        {/* Search */}
        <div className="flex items-center gap-1 flex-1">
          <SearchIcon size={12} className="text-content-tertiary shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索..."
            className="flex-1 px-2 py-1 rounded text-[11px] bg-surface-tertiary text-content placeholder:text-content-tertiary outline-none border border-edge focus:border-accent"
            spellCheck={false}
          />
        </div>

        {/* Auto-scroll toggle */}
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
            autoScroll
              ? 'bg-accent-light text-accent'
              : 'bg-surface-tertiary text-content-tertiary hover:bg-surface-hover'
          }`}
          title="自动滚动"
        >
          跟随
        </button>
      </div>

      {/* Event List */}
      <div
        ref={listRef}
        className="h-[180px] overflow-y-auto px-2 py-1 space-y-0.5"
        style={{ background: 'var(--surface)' }}
      >
        {filteredEvents.length === 0 ? (
          <div className="text-[11px] text-content-tertiary text-center py-4">
            {events.length === 0 ? '等待事件...' : '无匹配事件'}
          </div>
        ) : (
          filteredEvents.map((event) => (
            <button
              key={event.id}
              onClick={() => setSelectedEvent(event)}
              className={`
                w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px]
                transition-colors cursor-pointer text-left
                ${selectedEvent?.id === event.id
                  ? 'bg-accent-light text-accent'
                  : 'bg-surface-secondary hover:bg-surface-hover text-content'
                }
              `}
            >
              {/* Timestamp */}
              <span className="text-content-tertiary shrink-0 w-[60px]">
                {event.timestamp}
              </span>

              {/* Type */}
              <span className="font-medium shrink-0">
                {event.type}
              </span>

              {/* Size */}
              <span className="text-content-tertiary shrink-0 ml-auto">
                {formatSize(getPayloadSize(event.payload))}
              </span>

              {/* Expand indicator */}
              <ChevronIcon size={10} className="text-content-tertiary shrink-0" />
            </button>
          ))
        )}
      </div>

      {/* Detail View */}
      {selectedEvent && (
        <div className="px-3 py-2 border-t border-edge">
          <div className="text-[10px] text-content-tertiary mb-1">
            {selectedEvent.timestamp} - {selectedEvent.type}
          </div>
          <pre
            className="p-2 rounded text-[10px] font-mono max-h-[100px] overflow-y-auto whitespace-pre-wrap break-all"
            style={{ background: '#1e1e2e', color: '#cdd6f4' }}
          >
            {JSON.stringify({ type: selectedEvent.type, payload: selectedEvent.payload }, null, 2)}
          </pre>
        </div>
      )}

      {/* Statistics Footer */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-tertiary border-t border-edge text-[10px] text-content-tertiary">
        <span>
          {stats.filteredCount === stats.totalCount
            ? `${stats.totalCount} 事件`
            : `${stats.filteredCount}/${stats.totalCount} 事件`
          }
          | {formatSize(stats.totalSize)}
        </span>
        {stats.tokenUsage && (
          <span>
            Token: {stats.tokenUsage.input?.toLocaleString() || 0} in / {stats.tokenUsage.output?.toLocaleString() || 0} out
          </span>
        )}
      </div>
    </div>
  );
};

export { WireDebugPanel };