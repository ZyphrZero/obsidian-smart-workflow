/**
 * TranslationService - 翻译服务
 * 负责语言检测和翻译请求，支持流式输出
 * 
 * 功能：
 * - 自动语言检测（Rust 端 whatlang + 可选 LLM）
 * - 流式翻译响应
 * - 格式保留（段落、换行）
 * - 请求取消
 * 
 */

import { App } from 'obsidian';
import { SmartWorkflowSettings } from '../../settings/settings';
import { ConfigManager } from '../config/configManager';
import type { ISecretService } from '../secret';
import { LanguageDetector } from './languageDetector';
import { AIClient, AIError, AIErrorCode, NetworkError, TimeoutError } from '../ai';
import { debugLog } from '../../utils/logger';
import { t } from '../../i18n';
import { LanguageCode, SUPPORTED_LANGUAGES } from '../../settings/types';
import { ServerManager } from '../server/serverManager';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 翻译选项接口
 */
export interface TranslationOptions {
  /** 原始文本 */
  text: string;
  /** 源语言 (auto 表示自动检测) */
  sourceLanguage: LanguageCode;
  /** 目标语言 */
  targetLanguage: LanguageCode;
}

/**
 * 翻译流式回调接口
 */
export interface TranslationStreamCallbacks {
  /** 翻译开始 */
  onStart: () => void;
  /** 收到翻译内容块 */
  onChunk: (chunk: string) => void;
  /** 收到思考内容（思考模型） */
  onThinking?: (chunk: string) => void;
  /** 检测到源语言 */
  onDetectedLanguage?: (language: LanguageCode) => void;
  /** 翻译完成 */
  onComplete: (fullText: string) => void;
  /** 发生错误 */
  onError: (error: Error) => void;
}

/**
 * TranslationService 类
 * 提供翻译功能的核心服务
 */
export class TranslationService {
  private settings: SmartWorkflowSettings;
  private configManager: ConfigManager;
  private languageDetector: LanguageDetector;
  private aiClient: AIClient | null = null;
  private serverManager: ServerManager | null = null;

  /**
   * 构造函数
   * @param _app Obsidian App 实例（保留用于将来扩展）
   * @param settings 插件设置
   * @param onSettingsChange 设置变更回调
   * @param serverManager ServerManager 实例（可选，用于 Rust 模式流式处理和语言检测）
   * @param secretService SecretService 实例（可选，用于共享密钥解析）
   */
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
    
    // 初始化语言检测器
    this.languageDetector = new LanguageDetector({
      enableLLMDetection: settings.translation?.enableLLMDetection ?? false,
      llmConfidenceThreshold: settings.translation?.llmConfidenceThreshold ?? 0.8,
    });
    
    // 设置 ServerManager 用于 Rust 端语言检测
    if (this.serverManager) {
      this.languageDetector.setServerManager(this.serverManager);
    }
  }

  /**
   * 设置 ServerManager
   * 用于启用 Rust 模式的流式处理和语言检测
   */
  setServerManager(serverManager: ServerManager): void {
    this.serverManager = serverManager;
    // 同时更新语言检测器的 ServerManager
    this.languageDetector.setServerManager(serverManager);
  }

  // ============================================================================
  // 公共 API
  // ============================================================================

  /**
   * 流式翻译
   * @param options 翻译选项
   * @param callbacks 流式回调
   */
  async translateStream(
    options: TranslationOptions,
    callbacks: TranslationStreamCallbacks
  ): Promise<void> {
    const { text, sourceLanguage, targetLanguage } = options;

    // 验证输入
    if (!text || text.trim().length === 0) {
      callbacks.onError(new AIError(
        AIErrorCode.REQUEST_FAILED,
        t('translation.errors.emptyText'),
        false
      ));
      return;
    }

    // 检查源语言和目标语言是否相同
    if (sourceLanguage !== 'auto' && sourceLanguage === targetLanguage) {
      callbacks.onError(new AIError(
        AIErrorCode.REQUEST_FAILED,
        t('translation.errors.sameLanguage'),
        false
      ));
      return;
    }

    // 获取翻译功能配置
    const resolvedConfig = this.configManager.resolveFeatureConfig('translation');

    if (!resolvedConfig) {
      callbacks.onError(new AIError(
        AIErrorCode.NO_PROVIDER_CONFIGURED,
        t('translation.errors.noProviderConfigured'),
        false
      ));
      return;
    }

    const { provider, model } = resolvedConfig;

    try {
      // 1. 语言检测（如果需要）
      let detectedSourceLanguage: LanguageCode = sourceLanguage;
      
      if (sourceLanguage === 'auto') {
        // 配置 LLM 检测（如果启用）
        if (this.settings.translation?.enableLLMDetection) {
          this.languageDetector.setLLMConfig({
            provider,
            model,
            timeout: 10000, // LLM 检测使用较短超时
            debugMode: this.settings.debugMode,
          });
        }

        const detectionResult = await this.languageDetector.detect(text);
        detectedSourceLanguage = detectionResult.language;

        debugLog(`[TranslationService] 检测到源语言: ${detectedSourceLanguage}, 置信度: ${detectionResult.confidence}, 方法: ${detectionResult.method}`);

        // 通知检测到的语言
        if (callbacks.onDetectedLanguage) {
          callbacks.onDetectedLanguage(detectedSourceLanguage);
        }

        // 检查检测到的语言是否与目标语言相同
        if (detectedSourceLanguage === targetLanguage) {
          callbacks.onError(new AIError(
            AIErrorCode.REQUEST_FAILED,
            t('translation.errors.sameLanguage'),
            false
          ));
          return;
        }
      }

      // 2. 构建翻译 Prompt
      const prompt = this.buildTranslationPrompt(text, detectedSourceLanguage, targetLanguage);

      if (this.settings.debugMode) {
        debugLog('[TranslationService] 发送给 AI 的 Prompt:');
        debugLog('='.repeat(50));
        debugLog(prompt);
        debugLog('='.repeat(50));
        debugLog(`[TranslationService] 使用供应商: ${provider.name}, 模型: ${model.displayName}`);
      }

      // 3. 创建 AI 客户端并发送请求
      this.aiClient = new AIClient({
        provider,
        model,
        timeout: this.settings.timeout || 30000, // 翻译可能需要更长时间
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
              debugLog('[TranslationService] AI 翻译完成，返回内容:');
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
        debugLog('[TranslationService] 请求已取消');
        return;
      }
      callbacks.onError(this.normalizeError(error));
    } finally {
      this.aiClient = null;
    }
  }

  /**
   * 取消当前翻译请求
   */
  cancelTranslation(): void {
    if (this.aiClient) {
      this.aiClient.cancel();
      this.aiClient = null;
      debugLog('[TranslationService] 翻译请求已取消');
    }
    
    // 同时取消语言检测的 LLM 请求
    this.languageDetector.cancelLLMDetection();
  }

  // ============================================================================
  // Prompt 构建
  // ============================================================================

  /**
   * 构建翻译 Prompt
   * @param text 原始文本
   * @param sourceLanguage 源语言
   * @param targetLanguage 目标语言
   * @returns 翻译 Prompt
   */
  buildTranslationPrompt(
    text: string,
    sourceLanguage: LanguageCode,
    targetLanguage: LanguageCode
  ): string {
    // 获取语言显示名称
    const sourceLangName = this.getLanguageDisplayName(sourceLanguage);
    const targetLangName = this.getLanguageDisplayName(targetLanguage);

    // 构建 Prompt
    return `You are a professional translator. Translate the following text from ${sourceLangName} to ${targetLangName}.

IMPORTANT RULES:
1. Preserve the original formatting including line breaks, paragraphs, and whitespace
2. Maintain the same number of paragraphs as the original text
3. Do not add any explanations, notes, or additional content
4. Only output the translated text, nothing else
5. If the text contains code blocks, technical terms, or proper nouns, keep them as-is or translate appropriately based on context

Source text (${sourceLangName}):

${text}

Translated text (${targetLangName}):`;
  }

  /**
   * 获取语言显示名称
   * @param code 语言代码
   * @returns 语言显示名称
   */
  private getLanguageDisplayName(code: LanguageCode): string {
    const langInfo = SUPPORTED_LANGUAGES[code];
    if (langInfo) {
      return langInfo.name;
    }
    return code;
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
        return new TimeoutError(this.settings.timeout || 30000);
      }
      if (error.message.includes('fetch') || error.message.includes('network')) {
        return new NetworkError(error.message, error);
      }
      return new AIError(AIErrorCode.REQUEST_FAILED, error.message, true, error);
    }

    return new AIError(AIErrorCode.REQUEST_FAILED, String(error), true);
  }
}
