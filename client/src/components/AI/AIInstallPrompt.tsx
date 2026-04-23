import React from 'react';
import { useAIStore } from '../../stores/ai';

/**
 * AI 安装提示组件
 * 当 Kimi-CLI 未安装时，引导用户安装
 */
const AIInstallPrompt: React.FC = () => {
  const setAIPanelOpen = useAIStore((s) => s.setAIPanelOpen);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="text-5xl mb-4">🤖</div>
      <h3 className="text-lg font-semibold text-content">Ask AI 需要 Kimi-CLI</h3>
      <p className="text-[14px] text-content-secondary leading-relaxed max-w-[300px]">
        请先安装 Kimi-CLI 以使用 AI 对话功能。
      </p>
      <p className="text-[13px] text-content-tertiary leading-relaxed max-w-[300px]">
        安装指南：
        <a href="https://moonshotai.github.io/kimi-cli" target="_blank" rel="noopener noreferrer"
          className="text-accent no-underline"
        >https://moonshotai.github.io/kimi-cli</a>
      </p>
      <div className="flex gap-3 mt-4">
        <button onClick={() => window.open('https://moonshotai.github.io/kimi-cli', '_blank')}
          className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-accent text-white text-[14px] font-medium hover:bg-accent-hover transition-colors duration-150"
        >打开安装指南</button>
        <button onClick={() => setAIPanelOpen(false)}
          className="inline-flex items-center px-5 py-2 rounded-lg bg-surface-secondary text-content-secondary border border-edge text-[14px] hover:bg-surface-hover transition-colors duration-150"
        >关闭</button>
      </div>
    </div>
  );
};

export { AIInstallPrompt };
