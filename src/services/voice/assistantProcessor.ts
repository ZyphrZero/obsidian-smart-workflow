/**
 * AssistantProcessor - AI 助手处理器
 * 
 * 职责:
 * 1. 处理 Q&A 模式（无选中文本时，直接回答用户问题）
 * 2. 处理文本处理模式（有选中文本时，根据语音指令处理文本）
 * 3. 复用现有 AIClient 进行 LLM 调用
 * 
 * 参考 LLMPostProcessor 的实现模式
 */

import { debugLog, errorLog } from '../../utils/logger';
import { AIClient } from '../ai/aiClient';
import { ConfigManager } from '../config/configManager';
import {
  VoiceSettings,
  VoiceAssistantConfig,
  Provider,
  ModelConfig,
  SmartWorkflowSettings,
} from '../../settings/settings';
import { ILLMPostProcessor } from './voiceInputService';

/**
 * 助手模式类型
 * - qa: 问答模式，无选中文本时使用
 * - text_processing: 文本处理模式，有选中文本时使用
 */
export type AssistantMode = 'qa' | 'text_processing';

/**
 * 助手处理请求
 */
export interface AssistantProcessRequest {
  /** 语音命令（ASR 转录结果） */
  voiceCommand: string;
  /** 选中的文本（可选，有则为文本处理模式，无则为 Q&A 模式） */
  selectedText?: string | null;
}

/**
 * 助手处理结果
 */
export interface AssistantProcessResult {
  /** 处理模式 */
  mode: AssistantMode;
  /** 语音命令 */
  voiceCommand: string;
  /** 选中的文本（如果有） */
  selectedText: string | null;
  /** LLM 响应 */
  response: string;
  /** 处理耗时 (ms) */
  duration: number;
}

/**
 * AssistantProcessor
 * 
 * AI 助手处理器，支持 Q&A 模式和文本处理模式
 */
export class AssistantProcessor implements ILLMPostProcessor {
  private settings: SmartWorkflowSettings;
  private voiceSettings: VoiceSettings;
  private assistantConfig: VoiceAssistantConfig;
  private configManager: ConfigManager;
  private aiClient: AIClient | null = null;
  private timeout: number;
  private debugMode: boolean;

  constructor(
    settings: SmartWorkflowSettings,
    configManager: ConfigManager
  ) {
    this.settings = settings;
    this.voiceSettings = settings.voice;
    this.assistantConfig = settings.voice.assistantConfig;
    this.configManager = configManager;
    this.timeout = settings.timeout || 15000;
    this.debugMode = settings.debugMode || false;
  }

  // ============================================================================
  // ILLMPostProcessor 接口实现
  // ============================================================================

  /**
   * 处理文本（实现 ILLMPostProcessor 接口）
   * 
   * @param text 要处理的文本（用户提示）
   * @param systemPrompt 系统提示词
   * @returns 处理后的文本
   */
  async process(text: string, systemPrompt: string): Promise<string> {
    const startTime = Date.now();
    
    try {
      debugLog('[AssistantProcessor] 开始处理，文本长度:', text.length);
      
      // 获取 AI 客户端配置
      const { provider, model } = this.resolveProviderAndModel();
      
      // 创建 AI 客户端
      this.aiClient = new AIClient({
        provider,
        model,
        timeout: this.timeout,
        debugMode: this.debugMode,
      });

      // 发送请求
      const response = await this.aiClient.request({
        prompt: text,
        systemPrompt,
      });

      const duration = Date.now() - startTime;
      debugLog('[AssistantProcessor] 处理完成，耗时:', duration, 'ms');

      return response.content;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorLog('[AssistantProcessor] 处理失败:', errorMessage);
      throw error;
    } finally {
      this.aiClient = null;
    }
  }

  // ============================================================================
  // 公共方法
  // ============================================================================

  /**
   * 处理助手请求
   * 根据是否有选中文本自动选择 Q&A 模式或文本处理模式
   * 
   * @param request 助手处理请求
   * @returns 处理结果
   */
  async processRequest(request: AssistantProcessRequest): Promise<AssistantProcessResult> {
    const startTime = Date.now();
    const { voiceCommand, selectedText } = request;
    
    // 检测模式
    const mode = this.detectMode(selectedText);
    
    debugLog('[AssistantProcessor] 处理请求，模式:', mode);
    
    // 获取对应的系统提示词
    const systemPrompt = this.getSystemPrompt(mode);
    
    // 构建用户提示
    const userPrompt = this.buildUserPrompt(mode, voiceCommand, selectedText);
    
    // 调用 LLM
    const response = await this.process(userPrompt, systemPrompt);
    
    const duration = Date.now() - startTime;
    
    return {
      mode,
      voiceCommand,
      selectedText: selectedText || null,
      response,
      duration,
    };
  }

  /**
   * 处理 Q&A 模式请求
   * 直接回答用户的语音问题
   * 
   * @param voiceCommand 语音命令（用户问题）
   * @returns LLM 响应
   */
  async processQA(voiceCommand: string): Promise<string> {
    debugLog('[AssistantProcessor] 处理 Q&A 请求');
    
    const systemPrompt = this.assistantConfig.qaSystemPrompt;
    return this.process(voiceCommand, systemPrompt);
  }

  /**
   * 处理文本处理模式请求
   * 根据语音指令处理选中的文本
   * 
   * @param voiceCommand 语音命令（处理指令）
   * @param selectedText 选中的文本
   * @returns LLM 响应（处理后的文本）
   */
  async processTextCommand(voiceCommand: string, selectedText: string): Promise<string> {
    debugLog('[AssistantProcessor] 处理文本处理请求');
    
    const systemPrompt = this.assistantConfig.textProcessingSystemPrompt;
    const userPrompt = this.buildTextProcessingPrompt(voiceCommand, selectedText);
    
    return this.process(userPrompt, systemPrompt);
  }

  /**
   * 取消当前处理
   */
  cancel(): void {
    if (this.aiClient) {
      this.aiClient.cancel();
      this.aiClient = null;
      debugLog('[AssistantProcessor] 处理已取消');
    }
  }

  /**
   * 检查是否有正在进行的处理
   */
  isProcessing(): boolean {
    return this.aiClient !== null && this.aiClient.isRequestInProgress();
  }

  // ============================================================================
  // 配置方法
  // ============================================================================

  /**
   * 更新设置
   */
  updateSettings(settings: SmartWorkflowSettings): void {
    this.settings = settings;
    this.voiceSettings = settings.voice;
    this.assistantConfig = settings.voice.assistantConfig;
    this.timeout = settings.timeout || 15000;
    this.debugMode = settings.debugMode || false;
  }

  /**
   * 检查是否已启用
   */
  isEnabled(): boolean {
    return this.assistantConfig.enabled;
  }

  /**
   * 检查是否已配置
   */
  isConfigured(): boolean {
    if (!this.assistantConfig.enabled) {
      return false;
    }
    
    try {
      this.resolveProviderAndModel();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取当前配置信息
   */
  getConfigInfo(): { provider: string; model: string } | null {
    try {
      const { provider, model } = this.resolveProviderAndModel();
      return {
        provider: provider.name,
        model: model.displayName,
      };
    } catch {
      return null;
    }
  }

  /**
   * 获取 Q&A 模式系统提示词
   */
  getQASystemPrompt(): string {
    return this.assistantConfig.qaSystemPrompt;
  }

  /**
   * 设置 Q&A 模式系统提示词
   */
  setQASystemPrompt(prompt: string): void {
    this.assistantConfig.qaSystemPrompt = prompt;
  }

  /**
   * 获取文本处理模式系统提示词
   */
  getTextProcessingSystemPrompt(): string {
    return this.assistantConfig.textProcessingSystemPrompt;
  }

  /**
   * 设置文本处理模式系统提示词
   */
  setTextProcessingSystemPrompt(prompt: string): void {
    this.assistantConfig.textProcessingSystemPrompt = prompt;
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 检测助手模式
   * 根据是否有选中文本决定模式
   */
  private detectMode(selectedText?: string | null): AssistantMode {
    return selectedText && selectedText.trim().length > 0 
      ? 'text_processing' 
      : 'qa';
  }

  /**
   * 获取对应模式的系统提示词
   */
  private getSystemPrompt(mode: AssistantMode): string {
    return mode === 'qa'
      ? this.assistantConfig.qaSystemPrompt
      : this.assistantConfig.textProcessingSystemPrompt;
  }

  /**
   * 构建用户提示
   */
  private buildUserPrompt(
    mode: AssistantMode,
    voiceCommand: string,
    selectedText?: string | null
  ): string {
    if (mode === 'qa') {
      return voiceCommand;
    }
    
    return this.buildTextProcessingPrompt(voiceCommand, selectedText || '');
  }

  /**
   * 构建文本处理模式的用户提示
   */
  private buildTextProcessingPrompt(voiceCommand: string, selectedText: string): string {
    return `选中的文本：
${selectedText}

用户指令：${voiceCommand}`;
  }

  /**
   * 解析供应商和模型配置
   */
  private resolveProviderAndModel(): { provider: Provider; model: ModelConfig } {
    // 如果使用现有供应商
    if (this.assistantConfig.useExistingProvider) {
      const providerId = this.assistantConfig.providerId;
      const modelId = this.assistantConfig.modelId;
      
      if (!providerId || !modelId) {
        throw new Error('请在设置中配置 AI 助手的供应商和模型');
      }
      
      const provider = this.configManager.getProvider(providerId);
      if (!provider) {
        throw new Error('AI 助手配置的供应商已被删除，请重新选择');
      }
      
      const model = provider.models.find(m => m.id === modelId);
      if (!model) {
        throw new Error('AI 助手配置的模型已被删除，请重新选择');
      }
      
      return { provider, model };
    }
    
    // 使用自定义配置
    const endpoint = this.assistantConfig.endpoint;
    const modelName = this.assistantConfig.model;
    const apiKey = this.assistantConfig.apiKey;
    
    if (!endpoint || !modelName || !apiKey) {
      throw new Error('未配置自定义 AI 助手端点、模型或 API Key');
    }
    
    // 构建临时供应商和模型配置
    const provider: Provider = {
      id: 'voice-assistant-custom',
      name: 'Voice Assistant Custom',
      endpoint,
      keyConfig: {
        mode: 'local',
        localValue: apiKey,
      },
      models: [],
    };
    
    const model: ModelConfig = {
      id: 'voice-assistant-custom-model',
      name: modelName,
      displayName: modelName,
      temperature: 0.7,
      topP: 1,
    };
    
    return { provider, model };
  }
}
