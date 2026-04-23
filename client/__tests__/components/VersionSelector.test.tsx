// @vitest-environment jsdom
/**
 * VersionSelector 组件测试
 *
 * 测试 Wiki 版本选择器组件，包括渲染、下拉交互、版本切换等功能
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import VersionSelector from '../../src/components/Sidebar/VersionSelector';
import { useAppStore } from '../../src/stores/app';
import type { WikiVersion } from '@shared/types';

// Mock store 模块
vi.mock('../../src/stores/app', () => ({
  useAppStore: vi.fn(),
}));

/**
 * 设置 Store 的 Mock 状态
 *
 * @param state - 需要模拟的 store 状态片段
 */
function mockStoreState(state: {
  availableVersions?: WikiVersion[];
  selectedVersion?: string | null;
  setWikiVersion?: (version: string) => Promise<void>;
}) {
  (useAppStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (selector: (s: any) => any) =>
      selector({
        availableVersions: state.availableVersions ?? [],
        selectedVersion: state.selectedVersion ?? null,
        setWikiVersion: state.setWikiVersion ?? vi.fn().mockResolvedValue(undefined),
      }),
  );
}

describe('VersionSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('只有一个版本时不应渲染', () => {
    mockStoreState({
      availableVersions: [
        { version: '2026-04-16-220440', generatedAt: '2026-04-16T22:04:40Z', pageCount: 5, isCurrent: true },
      ],
      selectedVersion: '2026-04-16-220440',
    });

    const { container } = render(<VersionSelector />);
    expect(container.innerHTML).toBe('');
  });

  it('无版本时不应渲染', () => {
    mockStoreState({
      availableVersions: [],
      selectedVersion: null,
    });

    const { container } = render(<VersionSelector />);
    expect(container.innerHTML).toBe('');
  });

  it('应显示当前选中版本的格式化时间', () => {
    mockStoreState({
      availableVersions: [
        { version: '2026-04-16-220440', generatedAt: '2026-04-16T22:04:40Z', pageCount: 5, isCurrent: true },
        { version: '2026-04-15-120000', generatedAt: '2026-04-15T12:00:00Z', pageCount: 3, isCurrent: false },
      ],
      selectedVersion: '2026-04-16-220440',
    });

    render(<VersionSelector />);
    expect(screen.getByTitle('切换 Wiki 版本')).toHaveTextContent('2026-04-16 22:04');
  });

  it('点击按钮应展开版本下拉列表', async () => {
    mockStoreState({
      availableVersions: [
        { version: '2026-04-16-220440', generatedAt: '2026-04-16T22:04:40Z', pageCount: 5, isCurrent: true },
        { version: '2026-04-15-120000', generatedAt: '2026-04-15T12:00:00Z', pageCount: 3, isCurrent: false },
      ],
      selectedVersion: '2026-04-16-220440',
    });

    render(<VersionSelector />);

    // 下拉列表初始不可见（只有按钮显示当前选中的版本）
    expect(screen.getAllByText('2026-04-16 22:04')).toHaveLength(1);

    // 点击切换按钮
    fireEvent.click(screen.getByTitle('切换 Wiki 版本'));

    // 下拉列表现在应显示所有版本 — "2026-04-16 22:04" 出现两次（按钮 + 下拉项）
    expect(screen.getAllByText('2026-04-16 22:04')).toHaveLength(2);
    expect(screen.getByText('2026-04-15 12:00')).toBeInTheDocument();
  });

  it('选择某版本应调用 setWikiVersion', async () => {
    const mockSetWikiVersion = vi.fn().mockResolvedValue(undefined);
    mockStoreState({
      availableVersions: [
        { version: '2026-04-16-220440', generatedAt: '2026-04-16T22:04:40Z', pageCount: 5, isCurrent: true },
        { version: '2026-04-15-120000', generatedAt: '2026-04-15T12:00:00Z', pageCount: 3, isCurrent: false },
      ],
      selectedVersion: '2026-04-16-220440',
      setWikiVersion: mockSetWikiVersion,
    });

    render(<VersionSelector />);

    // 打开下拉列表
    fireEvent.click(screen.getByTitle('切换 Wiki 版本'));

    // 点击第二个版本
    fireEvent.click(screen.getByText('2026-04-15 12:00'));

    expect(mockSetWikiVersion).toHaveBeenCalledWith('2026-04-15-120000');
  });

  it('选择当前已选中的版本不应调用 setWikiVersion', async () => {
    const mockSetWikiVersion = vi.fn().mockResolvedValue(undefined);
    mockStoreState({
      availableVersions: [
        { version: '2026-04-16-220440', generatedAt: '2026-04-16T22:04:40Z', pageCount: 5, isCurrent: true },
        { version: '2026-04-15-120000', generatedAt: '2026-04-15T12:00:00Z', pageCount: 3, isCurrent: false },
      ],
      selectedVersion: '2026-04-16-220440',
      setWikiVersion: mockSetWikiVersion,
    });

    render(<VersionSelector />);

    // 打开下拉列表
    fireEvent.click(screen.getByTitle('切换 Wiki 版本'));

    // 点击已选中的版本
    // 版本文本 "2026-04-16 22:04" 同时出现在按钮和下拉列表中
    // 获取所有包含该文本的元素并点击下拉列表中的那个
    const versionElements = screen.getAllByText('2026-04-16 22:04');
    // 下拉列表项应包含版本按钮
    fireEvent.click(versionElements[versionElements.length - 1]);

    expect(mockSetWikiVersion).not.toHaveBeenCalled();
  });

  it('current 版本应显示 "当前" 标签', () => {
    mockStoreState({
      availableVersions: [
        { version: '2026-04-16-220440', generatedAt: '2026-04-16T22:04:40Z', pageCount: 5, isCurrent: true },
        { version: '2026-04-15-120000', generatedAt: '2026-04-15T12:00:00Z', pageCount: 3, isCurrent: false },
      ],
      selectedVersion: '2026-04-16-220440',
    });

    render(<VersionSelector />);

    // 打开下拉列表
    fireEvent.click(screen.getByTitle('切换 Wiki 版本'));

    // 当前版本应显示"当前"标签
    expect(screen.getByText('当前')).toBeInTheDocument();
  });

  it('应显示每个版本的页数', () => {
    mockStoreState({
      availableVersions: [
        { version: '2026-04-16-220440', generatedAt: '2026-04-16T22:04:40Z', pageCount: 10, isCurrent: true },
        { version: '2026-04-15-120000', generatedAt: '2026-04-15T12:00:00Z', pageCount: 3, isCurrent: false },
      ],
      selectedVersion: '2026-04-16-220440',
    });

    render(<VersionSelector />);

    // 打开下拉列表
    fireEvent.click(screen.getByTitle('切换 Wiki 版本'));

    expect(screen.getByText('10页')).toBeInTheDocument();
    expect(screen.getByText('3页')).toBeInTheDocument();
  });
});
