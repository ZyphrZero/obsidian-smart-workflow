/**
 * 端点规范化器
 * 负责规范化 API 端点 URL，支持多种 API 格式
 * 

 */

import { APIFormat } from '../../settings/settings';

/**
 * 端点规范化器类
 * 提供统一的端点规范化方法，支持 Chat Completions 和 Responses API
 */
export class EndpointNormalizer {
  // ============================================================================
  // 公共静态方法
  // ============================================================================

  /**
   * 规范化端点（根据 API 格式选择）
   * 统一入口，根据 apiFormat 分发到对应的规范化方法
   * @param endpoint 原始端点 URL
   * @param apiFormat API 格式
   * @returns 规范化后的完整 URL
   */
  static normalize(endpoint: string, apiFormat: APIFormat): string {
    if (apiFormat === 'responses') {
      return this.normalizeResponses(endpoint);
    }
    return this.normalizeChatCompletions(endpoint);
  }

  /**
   * 规范化为 Chat Completions 端点
   * 自动补全 /v1/chat/completions 路径
   * @param endpoint 原始端点 URL
   * @returns 规范化后的完整 URL（以 /chat/completions 结尾）
   */
  static normalizeChatCompletions(endpoint: string): string {
    let normalized = this.addProtocol(endpoint);
    normalized = this.removeTrailingSlashes(normalized);

    // 检查是否已包含完整路径
    const chatCompletionsPaths = [
      '/v1/chat/completions',
      '/chat/completions',
      '/v1/completions',
      '/completions'
    ];

    const hasPath = chatCompletionsPaths.some(path => normalized.includes(path));

    if (!hasPath) {
      // 检查是否以版本号结尾（如 /v1, /v2, /v3, /v4 等）
      const versionMatch = normalized.match(/\/v\d+$/);
      // 检查是否以 /openai 结尾（Gemini 等兼容格式）
      const openaiMatch = normalized.endsWith('/openai');
      
      if (versionMatch || openaiMatch) {
        // 已有版本号或 /openai 后缀，直接添加 /chat/completions
        normalized = normalized + '/chat/completions';
      } else {
        // 移除已有的 API 路径，获取基础 URL
        normalized = this.removeExistingPath(normalized);
        // 添加 /v1/chat/completions 路径
        normalized = normalized + '/v1/chat/completions';
      }
    }

    return this.fixDoubleSlashes(normalized);
  }

  /**
   * 规范化为 Responses API 端点
   * 自动补全 /v1/responses 路径
   * @param endpoint 原始端点 URL
   * @returns 规范化后的完整 URL（以 /v1/responses 结尾）
   */
  static normalizeResponses(endpoint: string): string {
    let normalized = this.addProtocol(endpoint);
    normalized = this.removeTrailingSlashes(normalized);

    // 检查是否已包含 /v1/responses 路径
    if (normalized.includes('/v1/responses')) {
      return this.fixDoubleSlashes(normalized);
    }

    // 移除已有的 API 路径，获取基础 URL
    normalized = this.removeExistingPath(normalized);
    // 添加 /v1/responses 路径
    normalized = normalized + '/v1/responses';

    return this.fixDoubleSlashes(normalized);
  }

  /**
   * 规范化为 Models API 端点
   * 自动补全 /v1/models 路径
   * @param endpoint 原始端点 URL
   * @returns 规范化后的完整 URL（以 /v1/models 结尾）
   */
  static normalizeModels(endpoint: string): string {
    let normalized = this.addProtocol(endpoint);
    normalized = this.removeTrailingSlashes(normalized);

    // 检查是否已包含 /v1/models 路径
    if (normalized.includes('/v1/models') || normalized.includes('/models')) {
      return this.fixDoubleSlashes(normalized);
    }

    // 移除已有的 API 路径，获取基础 URL
    normalized = this.removeExistingPath(normalized);
    // 添加 /v1/models 路径
    normalized = normalized + '/v1/models';

    return this.fixDoubleSlashes(normalized);
  }

  // ============================================================================
  // 私有辅助方法
  // ============================================================================

  /**
   * 添加协议（如果缺失）
   * @param url 原始 URL
   * @returns 带协议的 URL
   */
  private static addProtocol(url: string): string {
    let normalized = url.trim();

    if (!normalized) {
      throw new Error('Endpoint URL cannot be empty');
    }

    // 检查并添加协议
    if (!normalized.match(/^https?:\/\//i)) {
      if (normalized.startsWith('//')) {
        normalized = 'https:' + normalized;
      } else if (!normalized.includes('://')) {
        normalized = 'https://' + normalized;
      }
    }

    return normalized;
  }

  /**
   * 移除末尾斜杠
   * @param url URL
   * @returns 移除末尾斜杠后的 URL
   */
  private static removeTrailingSlashes(url: string): string {
    return url.replace(/\/+$/, '');
  }

  /**
   * 移除已有的 API 路径部分，获取基础 URL
   * @param url URL
   * @returns 基础 URL
   */
  private static removeExistingPath(url: string): string {
    // 需要移除的路径列表（按长度降序排列，确保先匹配最长的）
    const pathsToRemove = [
      '/v1/chat/completions',
      '/chat/completions',
      '/v1/completions',
      '/v1/responses',
      '/completions',
      '/v1/models',
      '/responses',
      '/models',
      '/v1'
    ];

    let normalized = url;

    for (const path of pathsToRemove) {
      if (normalized.endsWith(path)) {
        normalized = normalized.slice(0, -path.length);
        break;
      }
    }

    return normalized;
  }

  /**
   * 修正双斜杠（协议部分除外）
   * @param url URL
   * @returns 修正后的 URL
   */
  private static fixDoubleSlashes(url: string): string {
    return url.replace(/([^:])\/\//g, '$1/');
  }
}
