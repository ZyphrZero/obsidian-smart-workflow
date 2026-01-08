/**
 * 模型列表获取器
 * 负责从 AI 供应商获取可用模型列表
 * 
 * 职责：
 * - 调用 /v1/models 端点获取模型列表
 * - 解析模型能力信息
 * - 推断模型类型和上下文长度
 */

import { requestUrl, RequestUrlResponse } from 'obsidian';
import { Provider } from '../../settings/settings';
import { EndpointNormalizer } from './endpointNormalizer';
import { debugLog } from '../../utils/logger';
import { t } from '../../i18n';
import { inferModelType } from './modelTypeInferrer';
import { inferContextLength } from './modelContextLengths';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 模型列表 API 响应接口
 * 标准 OpenAI 格式 + 部分提供商的扩展字段
 */
interface ModelsAPIResponse {
  data?: Array<{
    id: string;
    object?: string;
    created?: number;
    owned_by?: string;
    capabilities?: {
      vision?: boolean;
      function_calling?: boolean;
      reasoning?: boolean;
    };
    context_length?: number;
    max_context_length?: number;
  }>;
  error?: {
    message?: string;
  };
}

/**
 * 远程模型信息接口
 */
export interface RemoteModelInfo {
  id: string;
  name: string;
  capabilities: string[];
  contextLength?: number;
  rawAbilities?: {
    vision?: boolean;
    functionCall?: boolean;
    reasoning?: boolean;
  };
}

/**
 * 模型获取器选项
 */
export interface ModelFetcherOptions {
  /** 请求超时时间（毫秒） */
  timeout?: number;
  /** 是否启用调试模式 */
  debugMode?: boolean;
}

// ============================================================================
// ModelFetcher 类
// ============================================================================

/**
 * 模型列表获取器
 * 从 AI 供应商获取可用模型列表
 */
export class ModelFetcher {
  private timeout: number;
  private debugMode: boolean;

  constructor(options: ModelFetcherOptions = {}) {
    this.timeout = options.timeout || 15000;
    this.debugMode = options.debugMode || false;
  }

  /**
   * 获取供应商的模型列表
   * @param provider 供应商配置
   * @returns 模型信息列表
   */
  async fetchModels(provider: Provider): Promise<RemoteModelInfo[]> {
    if (this.debugMode) {
      debugLog('[ModelFetcher] 获取模型列表:', { provider: provider.name });
    }

    // 验证供应商配置
    this.validateProvider(provider);

    try {
      const response = await this.makeRequest(provider);
      return this.parseResponse(response);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(t('aiService.networkError', { message: String(error) }));
    }
  }

  /**
   * 验证供应商配置
   */
  private validateProvider(provider: Provider): void {
    // 检查是否有有效的 API 密钥配置
    const hasApiKey = this.hasValidApiKey(provider);
    if (!hasApiKey) {
      throw new Error(t('aiService.providerApiKeyNotConfigured', { provider: provider.name }));
    }
    if (!provider.endpoint || provider.endpoint.trim() === '') {
      throw new Error(t('aiService.providerEndpointNotConfigured', { provider: provider.name }));
    }
  }

  /**
   * 检查 Provider 是否有有效的 API 密钥
   */
  private hasValidApiKey(provider: Provider): boolean {
    // 检查 keyConfig
    if (provider.keyConfig) {
      if (provider.keyConfig.mode === 'local' && provider.keyConfig.localValue && provider.keyConfig.localValue.trim() !== '') {
        return true;
      }
      if (provider.keyConfig.mode === 'shared' && provider.keyConfig.secretId) {
        return true;
      }
    }
    return false;
  }

  /**
   * 获取 Provider 的 API 密钥
   */
  private getApiKey(provider: Provider): string {
    if (provider.keyConfig?.mode === 'local' && provider.keyConfig.localValue) {
      return provider.keyConfig.localValue;
    }
    // 共享模式需要预先解析
    return '';
  }

  /**
   * 发送请求获取模型列表
   */
  private async makeRequest(provider: Provider): Promise<RequestUrlResponse> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(t('aiService.requestTimeout', { seconds: String(this.timeout / 1000) })));
      }, this.timeout);
    });

    // 使用 EndpointNormalizer 规范化端点
    const modelsEndpoint = EndpointNormalizer.normalizeModels(provider.endpoint);
    
    if (this.debugMode) {
      debugLog('[ModelFetcher] 获取模型列表端点:', modelsEndpoint);
    }

    const requestPromise = requestUrl({
      url: modelsEndpoint,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.getApiKey(provider)}`
      },
      throw: false
    });

    const response = await Promise.race([requestPromise, timeoutPromise]) as RequestUrlResponse;
    
    if (this.debugMode) {
      debugLog('[ModelFetcher] 获取模型列表响应状态:', response.status);
    }

    if (response.status !== 200) {
      let errorMessage = t('aiService.requestFailed', { status: String(response.status) });
      
      try {
        const errorData = response.json;
        if (errorData?.error?.message) {
          errorMessage += ` - ${errorData.error.message}`;
        }
      } catch {
        // 无法解析错误信息，忽略
      }

      throw new Error(errorMessage);
    }

    return response;
  }

  /**
   * 解析模型列表响应
   */
  private parseResponse(response: RequestUrlResponse): RemoteModelInfo[] {
    const data = response.json as ModelsAPIResponse;
    
    if (!data.data || !Array.isArray(data.data)) {
      throw new Error(t('aiService.responseFormatError'));
    }

    // 解析模型列表并推断能力
    const models: RemoteModelInfo[] = data.data.map(model => {
      const rawAbilities = model.capabilities ? {
        vision: model.capabilities.vision,
        functionCall: model.capabilities.function_calling,
        reasoning: model.capabilities.reasoning,
      } : undefined;

      const contextLength = model.context_length || model.max_context_length || inferContextLength(model.id);
      const modelType = inferModelType(model.id);

      return {
        id: model.id,
        name: model.id,
        capabilities: [modelType],
        contextLength,
        rawAbilities,
      };
    });

    if (this.debugMode) {
      debugLog('[ModelFetcher] 获取到模型列表:', models.length, '个模型');
      const modelsWithAbilities = models.filter(m => m.rawAbilities);
      if (modelsWithAbilities.length > 0) {
        debugLog('[ModelFetcher] 其中', modelsWithAbilities.length, '个模型有 API 返回的能力信息');
      }
    }

    return models;
  }
}
