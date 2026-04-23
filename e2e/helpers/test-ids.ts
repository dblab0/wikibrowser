/**
 * E2E 测试 data-testid 常量定义
 * 与客户端组件中的 data-testid 属性一一对应
 */
export const TEST_IDS = {
  // 项目列表
  PROJECT_CARD: 'project-card',
  PROJECT_NAME: 'project-name',

  // Wiki 导航
  WIKI_NAV: 'wiki-nav',
  NAV_ITEM: (slug: string) => `nav-item-${slug}`,

  // 内容区域
  WIKI_CONTENT: 'wiki-content',
  CONTENT_TITLE: 'content-title',

  // 搜索
  SEARCH_TRIGGER: 'search-trigger',
  SEARCH_MODAL: 'search-modal',
  SEARCH_INPUT: 'search-input',
  SEARCH_RESULT_ITEM: 'search-result-item',
  SEARCH_NO_RESULT: 'search-no-result',

  // AI 面板
  AI_PANEL: 'ai-panel',
  AI_INPUT: 'ai-input',
  AI_SEND: 'ai-send',
  AI_MESSAGE_LIST: 'ai-message-list',
  AI_MESSAGE: (index: number) => `ai-message-${index}`,

  // 侧边栏
  SIDEBAR_TOGGLE: 'sidebar-toggle',
} as const;
