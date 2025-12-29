/**
 * WritingService - 写作功能核心服务
 * 负责与 AI API 交互，支持流式输出
 * 
 * 使用 AIClient 进行 AI 通信，专注于写作业务逻辑
 * 

 */

import { App } from 'obsidian';
import {
  SmartWorkflowSettings,
  DEFAULT_POLISH_PROMPT_TEMPLATE
} from '../../settings/settings';
import { ConfigManager } from '../config/configManager';
import { debugLog } from '../../utils/logger';
import { t } from '../../i18n';
import { WritingError, WritingErrorCode } from './errors';
import { AIClient } from '../ai/aiClient';
import { AIError, isAIError } from '../ai/errors';

/**
 * 流式回调接口
 * 用于处理流式 AI 响应
 */
export interface StreamCallbacks {
  /** 流开始时调用 */
  onStart: () => void;
  /** 收到新内容块时调用 */
  onChunk: (chunk: string) => void;
  /** 收到思考内容时调用（可选） */
  onThinking?: (chunk: string) => void;
  /** 流完成时调用 */
  onComplete: (fullText: string) => void;
  /** 发生错误时调用 */
  onError: (error: Error) => void;
}

/**
 * WritingService 配置选项
 */
export interface WritingServiceOptions {
  provider: import('../../settings/settings').Provider;
  model: import('../../settings/settings').ModelConfig;
  promptTemplate: string;
  timeout?: number;
}

/**
 * 写作服务类
 * 负责与 AI API 交互，支持流式输出
 */
export class WritingService {
  private settings: SmartWorkflowSettings;
  private configManager: ConfigManager;
  private aiClient: AIClient | null = null;

  constructor(
    _app: App,
    settings: SmartWorkflowSettings,
    onSettingsChange?: () => Promise<void>
  ) {
    this.settings = settings;
    this.configManager = new ConfigManager(settings, onSettingsChange);
  }

  // ============================================================================
  // 公共 API
  // ============================================================================

  /**
   * 流式润色请求
   * @param text 要润色的文本
   * @param callbacks 流式回调
   * @throws WritingError 如果配置无效或请求失败
   */
  async polishStream(text: string, callbacks: StreamCallbacks): Promise<void> {
    // 解析写作功能配置
    const resolvedConfig = this.configManager.resolveFeatureConfig('writing');

    if (!resolvedConfig) {
      const error = new WritingError(
        WritingErrorCode.NO_PROVIDER_CONFIGURED,
        t('writing.errors.noProviderConfigured'),
        false
      );
      callbacks.onError(error);
      return;
    }

    const { provider, model, promptTemplate } = resolvedConfig;

    // 构建 prompt
    const prompt = this.buildPolishPrompt(text, promptTemplate);

    if (this.settings.debugMode) {
      debugLog('[WritingService] 发送给 AI 的 Prompt:');
      debugLog('='.repeat(50));
      debugLog(prompt);
      debugLog('='.repeat(50));
      debugLog(`[WritingService] 使用供应商: ${provider.name}, 模型: ${model.displayName}`);
    }

    try {
      // 创建 AIClient 实例
      this.aiClient = new AIClient({
        provider,
        model,
        timeout: this.settings.timeout || 15000,
        debugMode: this.settings.debugMode,
      });

      // 通知开始
      callbacks.onStart();

      // 使用 AIClient 发送流式请求
      await this.aiClient.requestStream(
        { prompt },
        {
          onStart: () => {
            // AIClient 已经在 requestStream 内部调用了 onStart
            // 这里不需要再次调用
          },
          onChunk: callbacks.onChunk,
          onThinking: callbacks.onThinking,
          onComplete: (response) => {
            callbacks.onComplete(response.content);
          },
          onError: (error) => {
            // 将 AIError 转换为 WritingError
            const writingError = this.convertToWritingError(error);
            callbacks.onError(writingError);
          },
        }
      );
    } catch (error) {
      // 如果是取消操作，不报错
      if (error instanceof Error && error.name === 'AbortError') {
        debugLog('[WritingService] 请求已取消');
        return;
      }

      // 处理其他错误
      const writingError = this.convertToWritingError(error);
      callbacks.onError(writingError);
    } finally {
      this.aiClient = null;
    }
  }

  /**
   * 取消当前请求
   */
  cancelRequest(): void {
    if (this.aiClient) {
      this.aiClient.cancel();
      this.aiClient = null;
      debugLog('[WritingService] 请求已取消');
    }
  }

  // ============================================================================
  // Prompt 构建
  // ============================================================================

  /**
   * 构建润色 Prompt
   * @param text 要润色的文本
   * @param template Prompt 模板
   * @returns 渲染后的 Prompt
   */
  buildPolishPrompt(text: string, template?: string): string {
    const promptTemplate = template || this.getPolishPromptTemplate();
    return this.renderPrompt(promptTemplate, { content: text });
  }

  /**
   * 获取润色 Prompt 模板
   * 优先使用用户配置，否则使用默认模板
   */
  private getPolishPromptTemplate(): string {
    // 优先使用功能绑定中的模板
    const binding = this.configManager.getFeatureBinding('writing');
    if (binding?.promptTemplate) {
      return binding.promptTemplate;
    }

    // 使用写作设置中的模板
    if (this.settings.writing?.polishPromptTemplate) {
      return this.settings.writing.polishPromptTemplate;
    }

    // 使用默认模板
    return DEFAULT_POLISH_PROMPT_TEMPLATE;
  }

  /**
   * 渲染 Prompt 模板
   * @param template 模板字符串
   * @param variables 变量对象
   * @returns 渲染后的字符串
   */
  private renderPrompt(template: string, variables: Record<string, string>): string {
    let result = template;

    // 处理条件块 {{#if variable}}...{{/if}}
    result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, varName, content) => {
      return variables[varName] ? content : '';
    });

    // 处理变量替换 {{variable}}
    result = result.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
      return variables[varName] || '';
    });

    return result;
  }

  // ============================================================================
  // 错误转换
  // ============================================================================

  /**
   * 将 AIError 或其他错误转换为 WritingError
   * @param error 原始错误
   * @returns WritingError
   */
  private convertToWritingError(error: unknown): WritingError {
    // 已经是 WritingError，直接返回
    if (error instanceof WritingError) {
      return error;
    }

    // 处理 AIError
    if (isAIError(error)) {
      return this.mapAIErrorToWritingError(error);
    }

    // 处理其他 Error
    if (error instanceof Error) {
      // 超时错误
      if (error.name === 'AbortError') {
        return new WritingError(
          WritingErrorCode.TIMEOUT,
          t('writing.errors.requestTimeout', {
            seconds: String((this.settings.timeout || 15000) / 1000)
          }),
          true
        );
      }

      // 网络错误
      if (error.message.includes('fetch') || error.message.includes('network')) {
        return new WritingError(
          WritingErrorCode.NETWORK_ERROR,
          t('writing.errors.networkError', { message: error.message }),
          true
        );
      }

      return new WritingError(
        WritingErrorCode.API_REQUEST_FAILED,
        t('writing.errors.requestFailed', { message: error.message }),
        true
      );
    }

    return new WritingError(
      WritingErrorCode.API_REQUEST_FAILED,
      t('writing.errors.requestFailed', { message: String(error) }),
      true
    );
  }

  /**
   * 将 AIError 映射到 WritingError
   * @param error AIError
   * @returns WritingError
   */
  private mapAIErrorToWritingError(error: AIError): WritingError {
    // 根据 AIError 的 code 映射到 WritingErrorCode
    switch (error.code) {
      case 'NO_PROVIDER_CONFIGURED':
      case 'INVALID_API_KEY':
      case 'INVALID_ENDPOINT':
        return new WritingError(
          WritingErrorCode.NO_PROVIDER_CONFIGURED,
          error.message,
          false
        );

      case 'TIMEOUT':
        return new WritingError(
          WritingErrorCode.TIMEOUT,
          error.message,
          true
        );

      case 'NETWORK_ERROR':
        return new WritingError(
          WritingErrorCode.NETWORK_ERROR,
          error.message,
          true
        );

      case 'STREAM_INTERRUPTED':
      case 'STREAM_PARSE_ERROR':
        return new WritingError(
          WritingErrorCode.STREAM_INTERRUPTED,
          error.message,
          true
        );

      case 'INVALID_RESPONSE':
        return new WritingError(
          WritingErrorCode.INVALID_RESPONSE,
          error.message,
          true
        );

      default:
        return new WritingError(
          WritingErrorCode.API_REQUEST_FAILED,
          error.message,
          error.retryable
        );
    }
  }
}
