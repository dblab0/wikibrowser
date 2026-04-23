/** 项目配置 */
export interface ProjectConfig {
  id: string;             // 唯一ID (路径 SHA-256 hash 前16位)
  name: string;           // 项目显示名称
  path: string;           // 绝对路径
  wikiPath: string;       // .zread/wiki 路径
  currentVersion: string; // 当前版本ID
  isActive: boolean;      // 是否启用
  addedAt: number;        // 添加时间
}

/** 会话池配置（与 session-pool.types.ts 保持一致） */
export interface SessionPoolConfig {
  maxSessions: number;         // 最大会话数
  idleTimeoutMs: number;       // 空闲超时时间（毫秒）
  evictionIntervalMs: number;  // 回收检查间隔（毫秒）
  maxQueueSize: number;        // 最大队列大小
  queueTimeoutMs: number;      // 队列超时时间（毫秒）
}

/** 应用配置 */
export interface AppConfig {
  scanPaths: string[];    // 自动扫描路径列表
  projects: ProjectConfig[]; // 项目列表
  theme: 'light' | 'dark';  // 主题模式
  lastOpenedProject?: string; // 上次打开的项目 ID
  projectSessions?: Record<string, string[]>; // projectId → session IDs
  logRetentionDays?: number;                  // 日志保留天数，默认 7
  aiPromptTimeout?: number;                   // AI prompt 超时时间（分钟），默认 10
  yolo?: boolean;                             // AI 自动审批模式，默认 false
  sessionPool?: SessionPoolConfig;            // 会话池配置
}

/** Wiki 数据结构 */
export interface WikiData {
  id: string;               // Wiki 唯一标识
  generated_at: string;     // 生成时间
  language: string;         // 文档语言
  pages: WikiPage[];        // 页面列表
}

/** Wiki 页面信息 */
export interface WikiPage {
  slug: string;             // 页面 URL 标识
  title: string;            // 页面标题
  file: string;             // 文件名
  section: string;          // 所属章节
  group?: string;           // 所属分组
  level: 'Beginner' | 'Intermediate' | 'Advanced'; // 难度等级
}

/** 版本摘要信息 */
export interface WikiVersion {
  version: string;       // "2026-04-16-220440"
  generatedAt: string;   // wiki.json 里的 generated_at
  pageCount: number;     // 页面数量
  isCurrent: boolean;    // 是否是 current 指向的版本
}

/** 搜索结果 */
export interface SearchResult {
  projectId: string;       // 项目 ID
  projectName: string;     // 项目名称
  page: WikiPage;          // 匹配的页面
  content: string;       // 匹配到的内容片段
  matchType: 'title' | 'content' | 'section';
  score: number;         // 相关度评分
}

/** 扫描状态 */
export interface ScanStatus {
  scanning: boolean;       // 是否正在扫描
  progress?: {             // 扫描进度
    total: number;         // 总目录数
    scanned: number;       // 已扫描数
    found: number;         // 已发现数
  };
  lastScanAt?: number;     // 上次扫描时间戳
}

/** API 统一响应格式 - 成功 */
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

/** API 统一响应格式 - 错误 */
export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

/** API 统一响应类型 */
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ===== AI 相关类型 =====

/** AI 功能状态 */
export interface AIStatus {
  available: boolean;      // AI 功能是否可用
  version?: string;        // 版本号
  wireDebug?: boolean;     // Wire 调试模式
}

/** AI Session（前端展示用，不含消息内容） */
export interface AISession {
  id: string;              // 会话 ID
  projectId: string;       // 所属项目 ID
  projectPath: string;     // 项目路径
  title: string;           // 会话标题
  status: 'active' | 'idle' | 'error'; // 会话状态
  createdAt: number;       // 创建时间戳
  updatedAt: number;       // 更新时间戳
}

/** AI 消息（流式接收，前端渲染用） */
export interface AIMessage {
  id: string;              // 消息 ID
  sessionId: string;       // 所属会话 ID
  role: 'user' | 'assistant'; // 发送角色
  type: 'text' | 'think' | 'tool_call' | 'tool_result' | 'approval' | 'question' | 'subagent'; // 消息类型
  content: AITextContent | AIThinkContent | AIToolCallContent | AIToolResultContent | AIApprovalContent | AIQuestionContent | AISubagentContent; // 消息内容
  timestamp: number;       // 时间戳
}

/** AI 文本消息内容 */
export interface AITextContent {
  text: string;            // 文本内容
  references?: FileReference[]; // 文件引用列表
}

/** 文件引用 - 用于 AI 上下文引用功能 */
export interface FileReference {
  id: string;              // 引用唯一标识
  filePath: string;        // 文件路径
  startLine: number;       // 起始行号
  endLine: number;         // 结束行号
  selectedText: string;    // 选中的文本内容
}

/** AI 思考内容 */
export interface AIThinkContent {
  think: string;           // 思考文本
  duration?: number;       // 思考耗时（秒）
}

/** AI 工具调用内容 */
export interface AIToolCallContent {
  toolCallId: string;      // 工具调用 ID
  functionName: string;    // 函数名称
  arguments: string;       // 调用参数（JSON 字符串）
}

/** AI 工具调用结果内容 */
export interface AIToolResultContent {
  toolCallId: string;      // 对应的工具调用 ID
  isError: boolean;        // 是否为错误结果
  output: string;          // 工具输出内容
}

/** AI 工具审批请求内容 */
export interface AIApprovalContent {
  requestId: string;       // 审批请求 ID
  toolCallId: string;      // 关联的工具调用 ID
  action: string;          // 操作描述
  description: string;     // 详细说明
  display: AIApprovalDisplay[]; // 展示信息列表
  responded: boolean;      // 是否已响应
  response?: 'approve' | 'reject'; // 用户响应结果
}

/** AI 审批展示项 */
export interface AIApprovalDisplay {
  type: string;            // 展示类型
  [key: string]: any;      // 其他动态字段
}

// ===== Wire 事件类型 =====

/** AI 问题内容（AI 主动向用户提问） */
export interface AIQuestionContent {
  questionId: string;      // 问题 ID
  questions: QuestionItem[]; // 问题列表
}

/** 问题项 */
export interface QuestionItem {
  id: string;              // 问题 ID
  text: string;            // 问题文本
  options?: string[];      // 可选选项列表
}

/** 子代理消息内容 */
export interface AISubagentContent {
  parentToolCallId: string; // 父级工具调用 ID
  agentId: string;          // 子代理 ID
  subagentType: string;     // 子代理类型
  events: SubagentEvent[];  // 子代理事件列表
  status: 'running' | 'completed' | 'error'; // 子代理运行状态
}

/** AIMessage.type 扩展 */
export type AIMessageType = 'text' | 'think' | 'tool_call' | 'tool_result' | 'approval' | 'question' | 'subagent';

/** Token 使用量 */
export interface TokenUsage {
  inputOther: number;      // 其他输入 token 数
  output: number;          // 输出 token 数
  inputCacheRead: number;  // 缓存读取 token 数
  inputCacheCreation: number; // 缓存创建 token 数
}

/** AI 状态信息 */
export interface AIStatusInfo {
  tokenUsage?: TokenUsage; // Token 使用量
  contextUsage?: number;   // 上下文使用率
  sessionState?: 'idle' | 'connecting' | 'active' | 'busy' | 'error' | 'stopped' | 'expired'; // 会话状态
}

/** Wire 事件类型 */
export interface WireEvent {
  type: string;            // 事件类型
  payload: unknown;        // 事件数据
}

/** ToolCallPart 事件 - 工具参数流式传输 */
export interface ToolCallPartEvent {
  type: 'ToolCallPart';    // 事件类型标识
  payload: {
    tool_call_id: string;  // 工具调用 ID
    arguments_part: string; // 参数片段
  };
}

/** StatusUpdate 事件 - token 用量、上下文使用率 */
export interface StatusUpdateEvent {
  type: 'StatusUpdate';    // 事件类型标识
  payload: {
    token_usage?: TokenUsage; // Token 使用量
    context_usage?: number;   // 上下文使用率
    plan_mode?: boolean;      // 是否处于计划模式
  };
}

/** QuestionRequest 事件 - AI 主动提问 */
export interface QuestionRequestEvent {
  type: 'QuestionRequest'; // 事件类型标识
  payload: {
    id: string;            // 问题请求 ID
    questions: QuestionItem[]; // 问题列表
  };
}

/** SubagentEvent - 嵌套子代理事件 */
export interface SubagentEvent {
  type: 'SubagentEvent';   // 事件类型标识
  payload: {
    parent_tool_call_id: string; // 父级工具调用 ID
    agent_id: string;       // 子代理 ID
    subagent_type: string;  // 子代理类型
    event: {
      type: string;         // 内部事件类型
      payload: unknown;     // 内部事件数据
    };
  };
}

/** SessionStatus 事件 - 会话状态变更 */
export interface SessionStatusEvent {
  type: 'SessionStatus';   // 事件类型标识
  payload: {
    session_id: string;    // 会话 ID
    state: 'idle' | 'connecting' | 'active' | 'busy' | 'error' | 'stopped' | 'expired'; // 会话状态
    reason?: string;       // 状态变更原因
  };
}

/** WebSocket 客户端消息类型 */
export interface WSSendMessage {
  type: 'prompt' | 'approve' | 'answer' | 'cancel'; // 消息类型
  content?: string;        // 消息内容
  requestId?: string;      // 请求 ID（审批用）
  response?: 'approve' | 'reject'; // 审批响应
  feedback?: string;       // 反馈文本
  questionId?: string;     // 问题 ID（回答用）
  answer?: string;         // 回答内容
}

// ===== 认证相关类型 =====

/** 登录请求 */
export interface LoginRequest {
  password: string;
}

/** 登录响应 */
export interface LoginResponse {
  success: boolean;
  error?: string;
}

/** 认证状态 */
export interface AuthStatus {
  enabled: boolean;
}
