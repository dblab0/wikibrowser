// @vitest-environment jsdom
/**
 * ReferencePill 组件测试
 *
 * 测试文件引用标签组件，包括显示、工具提示、删除按钮、截断等功能
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ReferencePill } from '../../src/components/AI/ReferencePill';
import type { FileReference } from '@shared/types';

describe('ReferencePill Component', () => {
  const mockReference: FileReference = {
    id: 'ref-1',
    filePath: '/src/components/Button.tsx',
    startLine: 10,
    endLine: 15,
    selectedText: 'const Button = () => {\n  return <button>Click me</button>\n};',
  };

  it('should display filename and line range', () => {
    render(<ReferencePill reference={mockReference} />);

    expect(screen.getByText(/Button.tsx/)).toBeInTheDocument();
    expect(screen.getByText(/L10-L15/)).toBeInTheDocument();
  });

  it('should display single line range when startLine equals endLine', () => {
    const singleLineRef: FileReference = {
      ...mockReference,
      startLine: 10,
      endLine: 10,
    };

    render(<ReferencePill reference={singleLineRef} />);

    // 组件的 formatLineRange 始终使用 Lstart-Lend 格式
    expect(screen.getByText(/L10-L10/)).toBeInTheDocument();
  });

  it('should display tooltip with full path and text preview', () => {
    render(<ReferencePill reference={mockReference} />);

    const pill = document.querySelector('.reference-pill');
    expect(pill).toBeInTheDocument();

    if (pill) {
      expect(pill).toHaveAttribute('title');

      const title = pill.getAttribute('title') || '';
      expect(title).toContain('/src/components/Button.tsx');
      expect(title).toContain('const Button = ()');
    }
  });

  it('should truncate selected text in tooltip when too long', () => {
    const longTextRef: FileReference = {
      ...mockReference,
      selectedText: 'a'.repeat(300), // 300 characters
    };

    render(<ReferencePill reference={longTextRef} />);

    const pill = document.querySelector('.reference-pill');
    expect(pill).toBeInTheDocument();

    if (pill) {
      const title = pill.getAttribute('title') || '';
      expect(title.length).toBeLessThan(300);
      expect(title).toContain('…'); // 应包含省略号
    }
  });

  it('should show remove button when removable is true', () => {
    render(<ReferencePill reference={mockReference} removable={true} />);

    const removeButton = screen.getByRole('button');
    expect(removeButton).toBeInTheDocument();
  });

  it('should not show remove button when removable is false', () => {
    render(<ReferencePill reference={mockReference} removable={false} />);

    const removeButton = screen.queryByRole('button');
    expect(removeButton).not.toBeInTheDocument();
  });

  it('should not show remove button when removable is not provided (default)', () => {
    render(<ReferencePill reference={mockReference} />);

    const removeButton = screen.queryByRole('button');
    expect(removeButton).not.toBeInTheDocument();
  });

  it('should call onRemove with correct id when remove button is clicked', () => {
    const onRemove = vi.fn();

    render(<ReferencePill reference={mockReference} removable={true} onRemove={onRemove} />);

    const removeButton = screen.getByRole('button');
    fireEvent.click(removeButton);

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('ref-1');
  });

  it('should stop propagation when remove button is clicked', () => {
    const onRemove = vi.fn();
    const onParentClick = vi.fn();

    const { container } = render(
      <div onClick={onParentClick}>
        <ReferencePill reference={mockReference} removable={true} onRemove={onRemove} />
      </div>
    );

    const removeButton = screen.getByRole('button');
    fireEvent.click(removeButton);

    expect(onRemove).toHaveBeenCalled();
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('should apply correct CSS classes and styles', () => {
    const { container } = render(<ReferencePill reference={mockReference} />);

    const pill = container.querySelector('.reference-pill');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveClass('reference-pill');
    expect(pill).toHaveClass('inline-flex');
    expect(pill).toHaveClass('items-center');
  });

  it('should handle deep file paths correctly', () => {
    const deepPathRef: FileReference = {
      ...mockReference,
      filePath: '/src/components/ui/buttons/primary/Button.tsx',
    };

    render(<ReferencePill reference={deepPathRef} />);

    expect(screen.getByText(/Button.tsx/)).toBeInTheDocument();
    expect(screen.queryByText(/src\/components\/ui\/buttons\/primary/)).not.toBeInTheDocument();
  });

  it('should display truncated filename in span', () => {
    const { container } = render(<ReferencePill reference={mockReference} />);

    const span = container.querySelector('.truncate');
    expect(span).toBeInTheDocument();
    expect(span).toHaveTextContent('Button.tsx L10-L15');
  });

  it('should handle empty selected text', () => {
    const emptyTextRef: FileReference = {
      ...mockReference,
      selectedText: '',
    };

    render(<ReferencePill reference={emptyTextRef} />);

    const pill = document.querySelector('.reference-pill');
    expect(pill).toBeInTheDocument();

    if (pill) {
      const title = pill.getAttribute('title') || '';
      expect(title).toContain('/src/components/Button.tsx');
    }
  });

  it('should handle file path with special characters', () => {
    const specialCharRef: FileReference = {
      ...mockReference,
      filePath: '/src/utils/helper-with-dash.ts',
    };

    render(<ReferencePill reference={specialCharRef} />);

    expect(screen.getByText(/helper-with-dash.ts/)).toBeInTheDocument();
  });
});
