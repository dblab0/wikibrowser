import type { AIStatus, AISession } from '@shared/types';

const API_BASE = '/api/ai';

/**
 * AI API 请求封装
 * @param url - 请求路径（不含前缀）
 * @param options - fetch 选项
 * @returns 解析后的响应数据
 */
async function aiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  const json = await response.json();

  if (!json.success) {
    throw new Error(json.error?.message || 'AI API Error');
  }

  return json.data;
}

/**
 * AI API 客户端，封装 AI 会话的 REST API
 */
class AIApiClient {
  /**
   * 获取 AI 服务状态
   * @returns AI 状态信息
   */
  async getStatus(): Promise<AIStatus> {
    return aiFetch<AIStatus>('/status');
  }

  /**
   * 获取项目的 AI 会话列表
   * @param projectId - 项目 ID
   * @returns AI 会话数组
   */
  async listSessions(projectId: string): Promise<AISession[]> {
    return aiFetch<AISession[]>(
      `/sessions?projectId=${encodeURIComponent(projectId)}`,
    );
  }

  /**
   * 创建 AI 会话
   * @param projectId - 项目 ID
   * @param projectPath - 项目路径
   * @returns 包含会话 ID 和状态的对象
   */
  async createSession(
    projectId: string,
    projectPath: string,
  ): Promise<{ id: string; status: string }> {
    return aiFetch<{ id: string; status: string }>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ projectId, projectPath }),
    });
  }

  /**
   * 获取会话详情
   * @param sessionId - 会话 ID
   * @returns 会话详情数据
   */
  async getSessionDetail(
    sessionId: string,
  ): Promise<any> {
    return aiFetch<any>(
      `/sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  /**
   * 删除 AI 会话
   * @param sessionId - 会话 ID
   */
  async deleteSession(sessionId: string): Promise<void> {
    await aiFetch<void>(
      `/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' },
    );
  }

  /**
   * 获取会话池统计信息
   * @returns 包含活跃数、最大会话数、空闲数和队列长度的统计对象
   */
  async getPoolStats(): Promise<{ activeCount: number; maxSessions: number; inactiveCount: number; queueLength: number }> {
    return aiFetch<{ activeCount: number; maxSessions: number; inactiveCount: number; queueLength: number }>('/pool/stats');
  }
}

export const aiApi = new AIApiClient();
