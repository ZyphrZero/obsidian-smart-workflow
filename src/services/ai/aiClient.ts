/**
 * AIClient - AI 通信层统一客户端
 * 提供统一的 AI 请求接口
 * 
 * 功能：
 * - 非流式请求 (request)
 * - 流式请求 (requestStream) - 通过 Rust 端 LLM 模块处理 SSE 解析
 * - 请求取消 (cancel)
 * 
 */

import {
  AIClientOptions,
  AIRequestOptions,
  AIResponse,
  StreamCallbacks,
  Provider,
  ModelConfig,
} from './types';
import { RequestBuilder } from './requestBuilder';
import { ResponseParser } from './responseParser';
import { EndpointNormalizer } from './endpointNormalizer';
import {
  AIError,
  AIErrorCode,
  NetworkError,
  TimeoutError,
  StreamInterruptedError,
} from './errors';
import { t } from '../../i18n';
import { ServerManager } from '../server/serverManager';
import { ApiFormat } from '../server/types';
import { debugLog, debugWarn, errorLog } from '../../utils/logger';

/**
 * AI 客户端类
 * AI 通信层的主入口，提供统一的请求接口
 */
export class AIClient {
  private provider: Provider;
  private model: ModelConfig;
  private timeout: number;
  private debugMode: boolean;
  
  // 用于取消非流式请求的 AbortController
  private abortController: AbortController | null = null;
  
  // ServerManager 实例（用于流式请求，非流式请求可选）
  private serverManager: ServerManager | null;
  
  // LLMClient 事件清理函数
  private llmCleanupFns: Array<() => void> = [];

  /**
   * 构造函数
   * @param options 客户端配置选项
   * @throws AIError 如果配置验证失败
   */
  constructor(options: AIClientOptions) {
    // 验证配置
    AIClient.validateOptions(options);

    this.provider = options.provider;
    this.model = options.model;
    this.timeout = options.timeout ?? 30000;
    this.debugMode = options.debugMode ?? false;
    this.serverManager = options.serverManager ?? null;
  }

  // ============================================================================
  // 公共方法
  // ============================================================================

  /**
   * 非流式请求
   * 发送请求并等待完整响应
   * @param options 请求选项
   * @returns AI 响应
   * @throws AIError 如果请求失败
   */
  async request(options: AIRequestOptions): Promise<AIResponse> {
    this.abortController = new AbortController();

    try {
      const requestBody = RequestBuilder.build({
        model: this.model,
        prompt: options.prompt,
        systemPrompt: options.systemPrompt,
        stream: false,
      });

      const apiFormat = this.model.apiFormat || 'chat-completions';
      const endpoint = EndpointNormalizer.normalize(this.provider.endpoint, apiFormat);

      if (this.debugMode) {
        debugLog('[AIClient] Request:', { endpoint, apiFormat, model: this.model.name });
      }

      const response = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const responseData = await response.json();

      if (this.debugMode) {
        debugLog('[AIClient] Response:', responseData);
      }

      const parsed = ResponseParser.parse(responseData);

      return {
        content: parsed.content,
        reasoningSummary: parsed.reasoningSummary,
        usage: parsed.usage,
      };
    } catch (error) {
      throw this.normalizeError(error);
    } finally {
      this.abortController = null;
    }
  }

  /**
   * 流式请求
   * 通过 Rust 端 LLM 模块处理 SSE 解析
   * 
   * @param options 请求选项
   * @param callbacks 流式回调
   * @throws AIError 如果 ServerManager 未配置
   */
  async requestStream(
    options: AIRequestOptions,
    callbacks: StreamCallbacks
  ): Promise<void> {
    // 流式请求必须有 ServerManager
    if (!this.serverManager) {
      throw new AIError(AIErrorCode.REQUEST_FAILED, 'ServerManager is required for streaming requests', false);
    }
    
    try {
      // 确保服务器运行
      await this.serverManager.ensureServer();
      
      const llmClient = this.serverManager.llm();
      
      const requestBody = RequestBuilder.build({
        model: this.model,
        prompt: options.prompt,
        systemPrompt: options.systemPrompt,
        stream: true,
      });

      const apiFormat = this.model.apiFormat || 'chat-completions';
      const endpoint = EndpointNormalizer.normalize(this.provider.endpoint, apiFormat);

      if (this.debugMode) {
        debugLog('[AIClient] Stream Request:', { endpoint, apiFormat, model: this.model.name });
      }

      if (callbacks.onStart) {
        callbacks.onStart();
      }

      // 清理之前的事件监听器
      this.cleanupLLMListeners();

      // 注册事件处理器
      const unsubChunk = llmClient.onChunk((content: string) => {
        callbacks.onChunk(content);
      });
      this.llmCleanupFns.push(unsubChunk);

      const unsubThinking = llmClient.onThinking((content: string) => {
        if (callbacks.onThinking) {
          callbacks.onThinking(content);
        }
      });
      this.llmCleanupFns.push(unsubThinking);

      // 使用 Promise 包装完成和错误事件
      await new Promise<void>((resolve, reject) => {
        const unsubComplete = llmClient.onComplete((fullContent: string) => {
          if (this.debugMode) {
            debugLog('[AIClient] Stream Complete:', { contentLength: fullContent.length });
          }

          callbacks.onComplete({ content: fullContent });
          this.cleanupLLMListeners();
          resolve();
        });
        this.llmCleanupFns.push(unsubComplete);

        const unsubError = llmClient.onError((code: string, message: string) => {
          errorLog('[AIClient] Stream Error:', { code, message });
          
          const error = new AIError(
            AIErrorCode.REQUEST_FAILED,
            message,
            code === 'network_error' || code === 'timeout'
          );
          
          callbacks.onError(error);
          this.cleanupLLMListeners();
          reject(error);
        });
        this.llmCleanupFns.push(unsubError);

        // 转换 API 格式为 Rust 端格式
        const rustApiFormat: ApiFormat = apiFormat === 'responses' 
          ? 'responses' 
          : 'chat_completions';

        // 发送流式请求
        llmClient.startStream({
          endpoint,
          headers: this.buildHeaders(),
          body: JSON.stringify(requestBody),
          api_format: rustApiFormat,
        });
      });

    } catch (error) {
      this.cleanupLLMListeners();
      const normalizedError = this.normalizeError(error);
      callbacks.onError(normalizedError);
    }
  }

  /**
   * 取消当前请求
   */
  cancel(): void {
    // 取消非流式请求
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    
    // 取消流式请求
    if (this.serverManager) {
      try {
        const llmClient = this.serverManager.llm();
        llmClient.cancelStream();
      } catch (e) {
        debugWarn('[AIClient] Error cancelling stream:', e);
      }
    }
    
    this.cleanupLLMListeners();
  }

  /**
   * 检查是否有正在进行的请求
   */
  isRequestInProgress(): boolean {
    return this.abortController !== null || this.llmCleanupFns.length > 0;
  }

  // ============================================================================
  // 静态方法
  // ============================================================================

  /**
   * 验证客户端配置选项
   */
  static validateOptions(options: AIClientOptions): void {
    const { provider, model } = options;

    if (!provider) {
      throw new AIError(AIErrorCode.NO_PROVIDER_CONFIGURED, t('aiService.noProviderConfigured'), false);
    }

    // 检查是否有有效的 API 密钥配置
    const hasApiKey = AIClient.hasValidApiKey(provider);
    if (!hasApiKey) {
      throw new AIError(AIErrorCode.INVALID_API_KEY, t('aiService.invalidApiKey'), false);
    }

    if (!provider.endpoint || provider.endpoint.trim() === '') {
      throw new AIError(AIErrorCode.INVALID_ENDPOINT, t('aiService.invalidEndpoint'), false);
    }

    if (!model) {
      throw new AIError(AIErrorCode.NO_PROVIDER_CONFIGURED, t('aiService.noModelConfigured'), false);
    }

    if (!model.name || model.name.trim() === '') {
      throw new AIError(AIErrorCode.INVALID_RESPONSE, 'Model name is required', false);
    }
  }

  /**
   * 检查 Provider 是否有有效的 API 密钥
   * 支持新的 keyConfig 结构和旧的 apiKey/apiKeys 字段
   */
  private static hasValidApiKey(provider: Provider): boolean {
    // 检查 keyConfig
    if (provider.keyConfig) {
      if (provider.keyConfig.mode === 'shared' && provider.keyConfig.secretId) {
        return true;
      }
      if (provider.keyConfig.mode === 'local' && provider.keyConfig.localValue && provider.keyConfig.localValue.trim() !== '') {
        return true;
      }
    }
    
    // 检查 keyConfigs（多密钥）
    if (provider.keyConfigs && provider.keyConfigs.length > 0) {
      return provider.keyConfigs.some(kc => {
        if (kc.mode === 'shared' && kc.secretId) return true;
        if (kc.mode === 'local' && kc.localValue && kc.localValue.trim() !== '') return true;
        return false;
      });
    }
    
    return false;
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 清理 LLM 事件监听器
   */
  private cleanupLLMListeners(): void {
    for (const cleanup of this.llmCleanupFns) {
      try {
        cleanup();
      } catch (e) {
        debugWarn('[AIClient] Error cleaning up LLM listener:', e);
      }
    }
    this.llmCleanupFns = [];
  }

  /**
   * 构建请求头
   */
  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.getCurrentApiKey()}`,
    };
  }

  /**
   * 获取当前使用的 API 密钥
   * 支持新的 keyConfig 结构和多密钥轮询模式
   * 注意：共享密钥需要在调用前通过 ConfigManager 解析
   */
  private getCurrentApiKey(): string {
    // 如果有多密钥配置，使用轮询
    if (this.provider.keyConfigs && this.provider.keyConfigs.length > 0) {
      const index = this.provider.currentKeyIndex ?? 0;
      const keyConfig = this.provider.keyConfigs[index];
      // 对于本地模式，直接返回值
      if (keyConfig.mode === 'local' && keyConfig.localValue) {
        return keyConfig.localValue;
      }
      // 对于共享模式，secretId 应该已经被解析为实际值
      // 如果没有解析，返回空字符串（调用方应该先解析）
      return '';
    }
    
    // 使用主密钥配置
    if (this.provider.keyConfig) {
      if (this.provider.keyConfig.mode === 'local' && this.provider.keyConfig.localValue) {
        return this.provider.keyConfig.localValue;
      }
      // 共享模式需要预先解析
      return '';
    }
    
    return '';
  }

  /**
   * 带超时的 fetch 请求
   */
  private async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new TimeoutError(this.timeout)), this.timeout);
    });

    try {
      return await Promise.race([fetch(url, options), timeoutPromise]);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new StreamInterruptedError('', 'Request cancelled');
      }
      if (error instanceof TimeoutError) {
        throw error;
      }
      throw new NetworkError(
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * 处理错误响应
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

    try {
      const errorData = await response.json();
      if (typeof errorData === 'object' && errorData !== null) {
        const data = errorData as Record<string, unknown>;
        if (data.error && typeof data.error === 'object') {
          const errorObj = data.error as Record<string, unknown>;
          if (errorObj.message) errorMessage = String(errorObj.message);
        } else if (data.message) {
          errorMessage = String(data.message);
        }
      }
    } catch {
      // 无法解析 JSON
    }

    if (response.status === 401 || response.status === 403) {
      throw new AIError(AIErrorCode.INVALID_API_KEY, errorMessage, false);
    }
    if (response.status === 404) {
      throw new AIError(AIErrorCode.INVALID_ENDPOINT, errorMessage, false);
    }
    if (response.status >= 500) {
      throw new AIError(AIErrorCode.REQUEST_FAILED, errorMessage, true);
    }
    throw new AIError(AIErrorCode.REQUEST_FAILED, errorMessage, false);
  }

  /**
   * 规范化错误
   */
  private normalizeError(error: unknown): AIError {
    if (error instanceof AIError) return error;
    if (error instanceof Error && error.name === 'AbortError') {
      return new StreamInterruptedError('', 'Request cancelled');
    }
    if (error instanceof TypeError) {
      return new NetworkError(error.message, error);
    }
    if (error instanceof Error) {
      return new AIError(AIErrorCode.REQUEST_FAILED, error.message, true, error);
    }
    return new AIError(AIErrorCode.REQUEST_FAILED, String(error), true);
  }

  // ============================================================================
  // Getter 方法
  // ============================================================================

  getProvider(): Provider { return this.provider; }
  getModel(): ModelConfig { return this.model; }
  getTimeout(): number { return this.timeout; }
  isDebugMode(): boolean { return this.debugMode; }
}
