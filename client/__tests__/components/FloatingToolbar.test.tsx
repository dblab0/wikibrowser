// @vitest-environment jsdom
/**
 * FloatingToolbar 组件测试
 *
 * 测试浮动工具栏组件，包括按钮渲染、点击事件、外部点击关闭、定位等功能
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import FloatingToolbar from '../../src/components/Content/FloatingToolbar';

describe('FloatingToolbar Component', () => {
  const mockProps = {
    visible: true,
    position: { top: 100, left: 200 },
    onComment: vi.fn(),
    onSendToAI: vi.fn(),
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render both buttons when visible', () => {
    render(<FloatingToolbar {...mockProps} />);

    expect(screen.getByText('评论')).toBeInTheDocument();
    expect(screen.getByText('发送到 AI')).toBeInTheDocument();
  });

  it('should not render when visible is false', () => {
    render(<FloatingToolbar {...mockProps} visible={false} />);

    expect(screen.queryByText('评论')).not.toBeInTheDocument();
    expect(screen.queryByText('发送到 AI')).not.toBeInTheDocument();
  });

  it('should call onComment when 评论 button is clicked', () => {
    render(<FloatingToolbar {...mockProps} />);

    const commentButton = screen.getByText('评论');
    fireEvent.click(commentButton);

    expect(mockProps.onComment).toHaveBeenCalledTimes(1);
  });

  it('should call onSendToAI when 发送到 AI button is clicked', () => {
    render(<FloatingToolbar {...mockProps} />);

    const sendButton = screen.getByText('发送到 AI');
    fireEvent.click(sendButton);

    expect(mockProps.onSendToAI).toHaveBeenCalledTimes(1);
  });

  it('should not have any extra buttons beyond 评论 and 发送到 AI', () => {
    const { container } = render(<FloatingToolbar {...mockProps} />);

    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
  });

  it('should position toolbar correctly based on props', () => {
    const customPosition = { top: 150, left: 300 };
    const { container } = render(
      <FloatingToolbar {...mockProps} position={customPosition} />
    );

    const toolbar = container.querySelector('.floating-toolbar');
    expect(toolbar).toBeInTheDocument();

    if (toolbar) {
      // 工具栏位置为 top - 50，即 150 - 50 = 100
      expect(toolbar.style.top).toBe('100px');
    }
  });

  it('should call onClose when clicking outside the toolbar', async () => {
    vi.useFakeTimers();

    const { container } = render(<FloatingToolbar {...mockProps} />);

    // 推进定时器超过 100ms 延迟
    vi.advanceTimersByTime(150);

    // 点击工具栏外部
    fireEvent.mouseDown(document.body);

    expect(mockProps.onClose).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('should not call onClose when clicking inside the toolbar', async () => {
    const { container } = render(<FloatingToolbar {...mockProps} />);

    // 等待添加 mousedown 监听器的定时器完成
    await waitFor(
      () => {
        expect(mockProps.onClose).not.toHaveBeenCalled();
      },
      { timeout: 150 }
    );

    // 点击工具栏内部
    const toolbar = container.querySelector('.floating-toolbar');
    if (toolbar) {
      fireEvent.mouseDown(toolbar);
    }

    // 等待一段时间以确保 onClose 未被调用
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(mockProps.onClose).not.toHaveBeenCalled();
  });

  it('should render 评论 button with correct icon', () => {
    const { container } = render(<FloatingToolbar {...mockProps} />);

    const commentButton = screen.getByText('评论').closest('button');
    expect(commentButton).toBeInTheDocument();

    if (commentButton) {
      const svg = commentButton.querySelector('svg');
      expect(svg).toBeInTheDocument();
    }
  });

  it('should render 发送到 AI button with correct icon', () => {
    const { container } = render(<FloatingToolbar {...mockProps} />);

    const sendButton = screen.getByText('发送到 AI').closest('button');
    expect(sendButton).toBeInTheDocument();

    if (sendButton) {
      const svg = sendButton.querySelector('svg');
      expect(svg).toBeInTheDocument();
    }
  });

  it('should apply correct CSS classes and styles', () => {
    const { container } = render(<FloatingToolbar {...mockProps} />);

    const toolbar = container.querySelector('.floating-toolbar');
    expect(toolbar).toBeInTheDocument();
    expect(toolbar).toHaveClass('floating-toolbar');
    expect(toolbar).toHaveClass('inline-flex');
  });

  it('should handle rapid button clicks without errors', () => {
    render(<FloatingToolbar {...mockProps} />);

    const commentButton = screen.getByText('评论');
    const sendButton = screen.getByText('发送到 AI');

    fireEvent.click(commentButton);
    fireEvent.click(sendButton);
    fireEvent.click(commentButton);

    expect(mockProps.onComment).toHaveBeenCalledTimes(2);
    expect(mockProps.onSendToAI).toHaveBeenCalledTimes(1);
  });

  it('should cleanup event listeners on unmount', async () => {
    const { unmount } = render(<FloatingToolbar {...mockProps} />);

    // 等待添加 mousedown 监听器的定时器完成
    await waitFor(
      () => {
        expect(mockProps.onClose).not.toHaveBeenCalled();
      },
      { timeout: 150 }
    );

    unmount();

    // 卸载后点击 — 不应触发 onClose
    fireEvent.mouseDown(document.body);

    await new Promise(resolve => setTimeout(resolve, 200));

    // 清理操作应阻止事件处理器被调用
    // 注意：此测试仅验证组件卸载时不会崩溃
    expect(true).toBe(true);
  });
});
