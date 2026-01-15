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
import type { ISecretService } from '../secret';
import { debugLog } from '../../utils/logger';
import { t } from '../../i18n';
import { AIClient, AIError, AIErrorCode, NetworkError, TimeoutError } from '../ai';
import { MULTI_SELECTION_SEPARATOR } from '../../ui/selection/types';
import { ServerManager } from '../server/serverManager';

/**
 * 流式回调接口
 */
export interface StreamCallbacks {
  onStart: () => void;
  onChunk: (chunk: string) => void;
  onThinking?: (chunk: string) => void;
  onComplete: (fullText: string) => void;
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
 */
export class WritingService {
  private settings: SmartWorkflowSettings;
  private configManager: ConfigManager;
  private aiClient: AIClient | null = null;
  private serverManager: ServerManager | null = null;

  constructor(
    _app: App,
    settings: SmartWorkflowSettings,
    onSettingsChange?: () => Promise<void>,
    serverManager?: ServerManager,
    secretService?: ISecretService
  ) {
    this.settings = settings;
    this.configManager = new ConfigManager(settings, onSettingsChange, secretService);
    this.serverManager = serverManager ?? null;
  }

  /**
   * 设置 ServerManager
   * 用于启用 Rust 模式的流式处理
   */
  setServerManager(serverManager: ServerManager): void {
    this.serverManager = serverManager;
  }

  // ============================================================================
  // 公共 API
  // ============================================================================

  /**
   * 流式润色请求
   */
  async polishStream(text: string, callbacks: StreamCallbacks): Promise<void> {
    const resolvedConfig = this.configManager.resolveFeatureConfig('writing');

    if (!resolvedConfig) {
      callbacks.onError(new AIError(
        AIErrorCode.NO_PROVIDER_CONFIGURED,
        t('writing.errors.noProviderConfigured'),
        false
      ));
      return;
    }

    const { provider, model, promptTemplate } = resolvedConfig;
    const prompt = this.buildPolishPrompt(text, promptTemplate);

    if (this.settings.debugMode) {
      debugLog('[WritingService] 发送给 AI 的 Prompt:');
      debugLog('='.repeat(50));
      debugLog(prompt);
      debugLog('='.repeat(50));
      debugLog(`[WritingService] 使用供应商: ${provider.name}, 模型: ${model.displayName}`);
    }

    try {
      this.aiClient = new AIClient({
        provider,
        model,
        timeout: this.settings.timeout || 15000,
        debugMode: this.settings.debugMode,
        serverManager: this.serverManager ?? undefined,
      });

      callbacks.onStart();

      await this.aiClient.requestStream(
        { prompt },
        {
          onStart: () => {},
          onChunk: callbacks.onChunk,
          onThinking: callbacks.onThinking,
          onComplete: (response) => {
            if (this.settings.debugMode) {
              debugLog('[WritingService] AI 润色完成，返回内容:');
              debugLog('='.repeat(50));
              debugLog(response.content);
              debugLog('='.repeat(50));
            }
            callbacks.onComplete(response.content);
          },
          onError: (error) => callbacks.onError(this.normalizeError(error)),
        }
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        debugLog('[WritingService] 请求已取消');
        return;
      }
      callbacks.onError(this.normalizeError(error));
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
   * 如果文本包含多选区分隔符，会添加额外说明让 AI 保持分隔符
   */
  buildPolishPrompt(text: string, template?: string): string {
    const promptTemplate = template || this.getPolishPromptTemplate();
    
    // 检查是否为多选区文本
    const isMultiSelection = text.includes(MULTI_SELECTION_SEPARATOR);
    
    if (isMultiSelection) {
      // 为多选区添加额外说明
      const multiSelectionNote = `
注意：输入文本包含多个独立段落，用 "---SELECTION_BOUNDARY---" 分隔。
请分别润色每个段落，并在输出中保持相同的分隔符 "---SELECTION_BOUNDARY---" 来分隔各段落。
`;
      const basePrompt = this.renderPrompt(promptTemplate, { content: text });
      return multiSelectionNote + '\n' + basePrompt;
    }
    
    return this.renderPrompt(promptTemplate, { content: text });
  }

  private getPolishPromptTemplate(): string {
    const binding = this.configManager.getFeatureBinding('writing');
    if (binding?.promptTemplate) return binding.promptTemplate;
    if (this.settings.writing?.polishPromptTemplate) return this.settings.writing.polishPromptTemplate;
    return DEFAULT_POLISH_PROMPT_TEMPLATE;
  }

  private renderPrompt(template: string, variables: Record<string, string>): string {
    let result = template;
    result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, varName, content) => {
      return variables[varName] ? content : '';
    });
    result = result.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
      return variables[varName] || '';
    });
    return result;
  }

  // ============================================================================
  // 错误处理
  // ============================================================================

  /**
   * 规范化错误为 AIError
   */
  private normalizeError(error: unknown): AIError {
    if (error instanceof AIError) return error;

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return new TimeoutError(this.settings.timeout || 15000);
      }
      if (error.message.includes('fetch') || error.message.includes('network')) {
        return new NetworkError(error.message, error);
      }
      return new AIError(AIErrorCode.REQUEST_FAILED, error.message, true, error);
    }

    return new AIError(AIErrorCode.REQUEST_FAILED, String(error), true);
  }
}
