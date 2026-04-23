import { useState, useEffect, useMemo, useCallback } from 'react';

/** 目录项数据结构 */
export interface TocItem {
  id: string;
  text: string;
  level: number;
  position: number;
  contentLength: number;
}

/**
 * 根据标题文本生成 URL 安全的 ID
 * @param text 标题文本
 * @param index 标题序号（用于兜底 ID）
 * @returns 生成的 ID 字符串
 */
function generateId(text: string, index: number): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `heading-${index}`;
}

/**
 * 从 Markdown 内容中提取标题列表
 * @param content Markdown 原始文本
 * @returns 目录项数组
 */
function extractHeadings(content: string): TocItem[] {
  const lines = content.split('\n');
  const headings: TocItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+?)\r?$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      const id = generateId(text, headings.length);

      headings.push({
        id,
        text,
        level,
        position: i,
        contentLength: 0,
      });
    }
  }

  // 计算每个标题的内容长度
  for (let i = 0; i < headings.length; i++) {
    const nextPosition = headings[i + 1]?.position ?? lines.length;
    headings[i].contentLength = nextPosition - headings[i].position;
  }

  return headings;
}

/**
 * 跟踪当前可见的标题，返回活跃标题的 ID
 * @param ids 需要监听的标题元素 ID 列表
 * @returns 当前活跃的标题 ID，无活跃时返回 null
 */
function useActiveHeading(ids: string[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // 找到最接近视口顶部的标题
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          const topMost = visible.sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
          setActiveId(topMost.target.id);
        }
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );

    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [ids]);

  return activeId;
}

/**
 * 文档目录（TOC）Hook
 * 从 Markdown 内容中提取标题，跟踪当前可见标题，提供滚动跳转功能
 * @param content Markdown 文本内容
 * @returns 目录项列表、当前活跃标题 ID、滚动到指定标题的函数
 */
export function useToc(content: string) {
  const items = useMemo(() => extractHeadings(content), [content]);
  const ids = useMemo(() => items.map((h) => h.id), [items]);
  const activeId = useActiveHeading(ids);

  const scrollToHeading = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  return { items, activeId, scrollToHeading };
}
