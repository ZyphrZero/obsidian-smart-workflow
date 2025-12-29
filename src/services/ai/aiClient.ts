/**
 * AIClient - AI 通信层统一客户端
 * 提供统一的 AI 请求接口，集成所有通信层组件
 * 
 * 功能：
 * - 非流式请求 (request)
 * - 流式请求 (requestStream)
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
import { StreamHandler } from './streamHandler';
import { EndpointNormalizer } from './endpointNormalizer';
import {
  AIError,
  AIErrorCode,
  NetworkError,
  TimeoutError,
  StreamInterruptedError,
} from './errors';
import { t } from '../../i18n';

/**
 * AI 客户端类
 * AI 通信层的主入口，提供统一的请求接口
 */
export class AIClient {
  private provider: Provider;
  private model: ModelConfig;
  private timeout: number;
  private debugMode: boolean;
  
  // 用于取消请求的 AbortController
  private abortController: AbortController | null = null;

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
    this.timeout = options.timeout ?? 30000; // 默认 30 秒
    this.debugMode = options.debugMode ?? false;
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
    // 创建新的 AbortController
    this.abortController = new AbortController();

    try {
      // 构建请求体
      const requestBody = RequestBuilder.build({
        model: this.model,
        prompt: options.prompt,
        systemPrompt: options.systemPrompt,
        stream: false,
      });

      // 获取规范化的端点
      const apiFormat = this.model.apiFormat || 'chat-completions';
      const endpoint = EndpointNormalizer.normalize(this.provider.endpoint, apiFormat);

      // 调试日志
      if (this.debugMode) {
        console.log('[AIClient] Request:', {
          endpoint,
          apiFormat,
          model: this.model.name,
          body: requestBody,
        });
      }

      // 发送请求
      const response = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });

      // 检查响应状态
      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      // 解析响应
      const responseData = await response.json();

      // 调试日志
      if (this.debugMode) {
        console.log('[AIClient] Response:', responseData);
      }

      // 使用 ResponseParser 解析响应
      const parsed = ResponseParser.parse(responseData);

      return {
        content: parsed.content,
        reasoningSummary: parsed.reasoningSummary,
        usage: parsed.usage,
      };
    } catch (error) {
      // 处理错误
      throw this.normalizeError(error);
    } finally {
      this.abortController = null;
    }
  }

  /**
   * 流式请求
   * 发送请求并通过回调处理流式响应
   * @param options 请求选项
   * @param callbacks 流式回调
   */
  async requestStream(
    options: AIRequestOptions,
    callbacks: StreamCallbacks
  ): Promise<void> {
    // 创建新的 AbortController
    this.abortController = new AbortController();

    try {
      // 构建请求体
      const requestBody = RequestBuilder.build({
        model: this.model,
        prompt: options.prompt,
        systemPrompt: options.systemPrompt,
        stream: true,
      });

      // 获取规范化的端点
      const apiFormat = this.model.apiFormat || 'chat-completions';
      const endpoint = EndpointNormalizer.normalize(this.provider.endpoint, apiFormat);

      // 调试日志
      if (this.debugMode) {
        console.log('[AIClient] Stream Request:', {
          endpoint,
          apiFormat,
          model: this.model.name,
          body: requestBody,
        });
      }

      // 通知开始
      if (callbacks.onStart) {
        callbacks.onStart();
      }

      // 发送请求
      const response = await this.fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });

      // 检查响应状态
      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      // 创建流式处理器
      const streamHandler = new StreamHandler({
        apiFormat,
        onChunk: callbacks.onChunk,
        onThinking: callbacks.onThinking,
        onComplete: (fullContent: string) => {
          // 调试日志
          if (this.debugMode) {
            console.log('[AIClient] Stream Complete:', { contentLength: fullContent.length });
          }

          callbacks.onComplete({
            content: fullContent,
            // 流式响应通常不包含 usage 信息
          });
        },
        onError: (error: Error) => {
          callbacks.onError(this.normalizeError(error));
        },
      });

      // 处理流
      await streamHandler.handleStream(response);
    } catch (error) {
      // 处理错误
      const normalizedError = this.normalizeError(error);
      callbacks.onError(normalizedError);
    } finally {
      this.abortController = null;
    }
  }

  /**
   * 取消当前请求
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 检查是否有正在进行的请求
   */
  isRequestInProgress(): boolean {
    return this.abortController !== null;
  }

  // ============================================================================
  // 静态方法
  // ============================================================================

  /**
   * 验证客户端配置选项
   * @param options 配置选项
   * @throws AIError 如果验证失败
   */
  static validateOptions(options: AIClientOptions): void {
    const { provider, model } = options;

    // 验证供应商配置
    if (!provider) {
      throw new AIError(
        AIErrorCode.NO_PROVIDER_CONFIGURED,
        t('aiService.noProviderConfigured'),
        false
      );
    }

    if (!provider.apiKey || provider.apiKey.trim() === '') {
      throw new AIError(
        AIErrorCode.INVALID_API_KEY,
        t('aiService.invalidApiKey'),
        false
      );
    }

    if (!provider.endpoint || provider.endpoint.trim() === '') {
      throw new AIError(
        AIErrorCode.INVALID_ENDPOINT,
        t('aiService.invalidEndpoint'),
        false
      );
    }

    // 验证模型配置
    if (!model) {
      throw new AIError(
        AIErrorCode.NO_PROVIDER_CONFIGURED,
        t('aiService.noModelConfigured'),
        false
      );
    }

    if (!model.name || model.name.trim() === '') {
      throw new AIError(
        AIErrorCode.INVALID_RESPONSE,
        'Model name is required',
        false
      );
    }
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 构建请求头
   */
  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.provider.apiKey}`,
    };
  }

  /**
   * 带超时的 fetch 请求
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit
  ): Promise<Response> {
    // 创建超时 Promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError(this.timeout));
      }, this.timeout);
    });

    try {
      // 使用 Promise.race 实现超时
      const response = await Promise.race([
        fetch(url, options),
        timeoutPromise,
      ]);

      return response;
    } catch (error) {
      // 检查是否是取消请求
      if (error instanceof Error && error.name === 'AbortError') {
        throw new StreamInterruptedError('', 'Request cancelled');
      }

      // 检查是否是超时错误
      if (error instanceof TimeoutError) {
        throw error;
      }

      // 网络错误
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
    let errorData: unknown;

    try {
      errorData = await response.json();
      if (typeof errorData === 'object' && errorData !== null) {
        const data = errorData as Record<string, unknown>;
        if (data.error && typeof data.error === 'object') {
          const errorObj = data.error as Record<string, unknown>;
          if (errorObj.message) {
            errorMessage = String(errorObj.message);
          }
        } else if (data.message) {
          errorMessage = String(data.message);
        }
      }
    } catch {
      // 无法解析 JSON，使用默认错误消息
    }

    // 调试日志
    if (this.debugMode) {
      console.error('[AIClient] Error Response:', {
        status: response.status,
        statusText: response.statusText,
        errorData,
      });
    }

    // 根据状态码抛出不同类型的错误
    if (response.status === 401 || response.status === 403) {
      throw new AIError(
        AIErrorCode.INVALID_API_KEY,
        errorMessage,
        false
      );
    }

    if (response.status === 404) {
      throw new AIError(
        AIErrorCode.INVALID_ENDPOINT,
        errorMessage,
        false
      );
    }

    if (response.status >= 500) {
      throw new AIError(
        AIErrorCode.REQUEST_FAILED,
        errorMessage,
        true // 服务器错误可重试
      );
    }

    throw new AIError(
      AIErrorCode.REQUEST_FAILED,
      errorMessage,
      false
    );
  }

  /**
   * 规范化错误
   * 将各种错误类型转换为 AIError
   */
  private normalizeError(error: unknown): AIError {
    // 已经是 AIError，直接返回
    if (error instanceof AIError) {
      return error;
    }

    // 处理 AbortError
    if (error instanceof Error && error.name === 'AbortError') {
      return new StreamInterruptedError('', 'Request cancelled');
    }

    // 处理 TypeError（通常是网络错误）
    if (error instanceof TypeError) {
      return new NetworkError(error.message, error);
    }

    // 处理其他 Error
    if (error instanceof Error) {
      return new AIError(
        AIErrorCode.REQUEST_FAILED,
        error.message,
        true,
        error
      );
    }

    // 处理未知错误
    return new AIError(
      AIErrorCode.REQUEST_FAILED,
      String(error),
      true
    );
  }

  // ============================================================================
  // Getter 方法
  // ============================================================================

  /**
   * 获取当前供应商配置
   */
  getProvider(): Provider {
    return this.provider;
  }

  /**
   * 获取当前模型配置
   */
  getModel(): ModelConfig {
    return this.model;
  }

  /**
   * 获取超时时间
   */
  getTimeout(): number {
    return this.timeout;
  }

  /**
   * 获取调试模式状态
   */
  isDebugMode(): boolean {
    return this.debugMode;
  }
}
