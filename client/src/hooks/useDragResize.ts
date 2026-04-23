import { useState, useCallback, useEffect, useRef } from 'react';

interface UseDragResizeOptions {
  minWidth: number;
  maxWidth: number;
  initialWidth: number;
  onResize: (width: number) => void;
}

interface UseDragResizeReturn {
  width: number;
  dragHandleProps: {
    onMouseDown: (e: React.MouseEvent) => void;
  };
  isDragging: boolean;
}

/**
 * 管理拖拽调整面板宽度的自定义 Hook
 * 支持鼠标和触摸事件，使用 requestAnimationFrame 节流以优化性能
 * @param options - 拖拽调整的配置选项，包含最小/最大宽度、初始宽度和回调
 * @returns 当前宽度、拖拽手柄属性和拖拽状态
 */
export function useDragResize(options: UseDragResizeOptions): UseDragResizeReturn {
  const { minWidth, maxWidth, initialWidth, onResize } = options;
  const [width, setWidth] = useState(initialWidth);
  const [isDragging, setIsDragging] = useState(false);
  const rafId = useRef<number | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  /**
   * 将宽度值限制在 [minWidth, maxWidth] 范围内
   * @param w - 待限制的宽度值
   * @returns 限制后的宽度值
   */
  const clampWidth = useCallback(
    (w: number) => Math.min(maxWidth, Math.max(minWidth, w)),
    [minWidth, maxWidth],
  );

  /**
   * 处理拖拽移动事件，使用 requestAnimationFrame 节流更新宽度
   * @param clientX - 当前鼠标/触摸的 X 坐标
   */
  const handleMove = useCallback(
    (clientX: number) => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
      rafId.current = requestAnimationFrame(() => {
        // 从右边缘计算：宽度 = 窗口宽度 - 鼠标X位置
        const newWidth = clampWidth(window.innerWidth - clientX);
        setWidth(newWidth);
        onResize(newWidth);
      });
    },
    [clampWidth, onResize],
  );

  /**
   * 处理拖拽结束事件，重置拖拽状态和 body 样式
   */
  const handleEnd = useCallback(() => {
    setIsDragging(false);
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  // 鼠标事件
  /**
   * 处理鼠标按下事件，启动拖拽流程
   * @param e - 鼠标事件对象
   */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startXRef.current = e.clientX;
      startWidthRef.current = width;

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX);
    };

    const handleMouseUp = () => {
      handleEnd();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMove, handleEnd]);

  // 触摸事件
  useEffect(() => {
    if (!isDragging) return;

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handleMove(e.touches[0].clientX);
      }
    };

    const handleTouchEnd = () => {
      handleEnd();
    };

    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, handleMove, handleEnd]);

  // 同步 initialWidth 变化（如外部恢复保存的宽度）
  useEffect(() => {
    setWidth(clampWidth(initialWidth));
  }, [initialWidth, clampWidth]);

  // 支持 touchstart 以启动拖拽
  const dragHandleProps = {
    onMouseDown: handleMouseDown,
    onTouchStart: (e: React.TouchEvent) => {
      setIsDragging(true);
      startWidthRef.current = width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      // 不阻止默认行为，以允许 touchmove 正常触发
    },
  };

  return { width, dragHandleProps, isDragging };
}
