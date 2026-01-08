/**
 * LLMPostProcessor - LLM 后处理器
 * 
 * 职责:
 * 1. 对 ASR 转录结果进行 LLM 后处理（润色、翻译等）
 * 2. 管理 LLM 预设
 * 3. 复用现有 AIService/AIClient 进行 LLM 调用
 * 
 * 参考 WritingService 的 AIClient 使用模式
 */

import { debugLog, errorLog } from '../../utils/logger';
import { AIClient } from '../ai/aiClient';
import { ConfigManager } from '../config/configManager';
import {
  VoiceSettings,
  VoiceLLMPreset,
  Provider,
  ModelConfig,
  SmartWorkflowSettings,
} from '../../settings/settings';
import { ILLMPostProcessor } from './voiceInputService';

/**
 * LLM 后处理配置
 */
export interface LLMPostProcessorConfig {
  /** 是否启用后处理 */
  enabled: boolean;
  /** 是否使用现有 AI 供应商 */
  useExistingProvider: boolean;
  /** 供应商 ID（使用现有供应商时） */
  providerId?: string;
  /** 模型 ID（使用现有供应商时） */
  modelId?: string;
  /** 自定义端点 */
  endpoint?: string;
  /** 自定义模型名称 */
  model?: string;
  /** 自定义 API Key */
  apiKey?: string;
  /** 预设列表 */
  presets: VoiceLLMPreset[];
  /** 当前激活的预设 ID */
  activePresetId: string;
}

/**
 * LLM 后处理结果
 */
export interface LLMPostProcessResult {
  /** 原始文本 */
  originalText: string;
  /** 处理后的文本 */
  processedText: string;
  /** 使用的预设 */
  preset: VoiceLLMPreset | null;
  /** 处理耗时 (ms) */
  duration: number;
}

/**
 * LLMPostProcessor
 * 
 * 语音转录结果的 LLM 后处理器
 */
export class LLMPostProcessor implements ILLMPostProcessor {
  private settings: SmartWorkflowSettings;
  private voiceSettings: VoiceSettings;
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
    this.configManager = configManager;
    this.timeout = settings.timeout || 15000;
    this.debugMode = settings.debugMode || false;
  }

  // ============================================================================
  // 公共方法
  // ============================================================================

  /**
   * 处理文本
   * 实现 ILLMPostProcessor 接口
   * 
   * @param text 要处理的文本
   * @param systemPrompt 系统提示词
   * @returns 处理后的文本
   */
  async process(text: string, systemPrompt: string): Promise<string> {
    const startTime = Date.now();
    
    try {
      debugLog('[LLMPostProcessor] 开始处理文本，长度:', text.length);
      
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
      debugLog('[LLMPostProcessor] 处理完成，耗时:', duration, 'ms');

      return response.content;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorLog('[LLMPostProcessor] 处理失败:', errorMessage);
      throw error;
    } finally {
      this.aiClient = null;
    }
  }

  /**
   * 使用预设处理文本
   * 
   * @param text 要处理的文本
   * @param presetId 预设 ID（可选，默认使用当前激活的预设）
   * @returns 处理结果
   */
  async processWithPreset(text: string, presetId?: string): Promise<LLMPostProcessResult> {
    const startTime = Date.now();
    
    // 获取预设
    const preset = this.getPreset(presetId || this.voiceSettings.activeLLMPresetId);
    
    if (!preset) {
      throw new Error(`预设不存在: ${presetId || this.voiceSettings.activeLLMPresetId}`);
    }

    debugLog('[LLMPostProcessor] 使用预设:', preset.name);

    // 处理文本
    const processedText = await this.process(text, preset.systemPrompt);

    const duration = Date.now() - startTime;

    return {
      originalText: text,
      processedText,
      preset,
      duration,
    };
  }

  /**
   * 取消当前处理
   */
  cancel(): void {
    if (this.aiClient) {
      this.aiClient.cancel();
      this.aiClient = null;
      debugLog('[LLMPostProcessor] 处理已取消');
    }
  }

  /**
   * 检查是否有正在进行的处理
   */
  isProcessing(): boolean {
    return this.aiClient !== null && this.aiClient.isRequestInProgress();
  }

  // ============================================================================
  // 预设管理方法
  // ============================================================================

  /**
   * 获取所有预设
   */
  getPresets(): VoiceLLMPreset[] {
    return this.voiceSettings.llmPresets;
  }

  /**
   * 获取指定预设
   */
  getPreset(id: string): VoiceLLMPreset | undefined {
    return this.voiceSettings.llmPresets.find(p => p.id === id);
  }

  /**
   * 获取当前激活的预设
   */
  getActivePreset(): VoiceLLMPreset | undefined {
    return this.getPreset(this.voiceSettings.activeLLMPresetId);
  }

  /**
   * 设置激活的预设
   */
  setActivePreset(id: string): void {
    const preset = this.getPreset(id);
    if (!preset) {
      throw new Error(`预设不存在: ${id}`);
    }
    this.voiceSettings.activeLLMPresetId = id;
    debugLog('[LLMPostProcessor] 激活预设:', preset.name);
  }

  /**
   * 添加预设
   */
  addPreset(preset: Omit<VoiceLLMPreset, 'id'>): VoiceLLMPreset {
    const id = this.generatePresetId();
    const newPreset: VoiceLLMPreset = {
      ...preset,
      id,
    };
    this.voiceSettings.llmPresets.push(newPreset);
    debugLog('[LLMPostProcessor] 添加预设:', newPreset.name);
    return newPreset;
  }

  /**
   * 更新预设
   */
  updatePreset(id: string, updates: Partial<Omit<VoiceLLMPreset, 'id'>>): void {
    const preset = this.getPreset(id);
    if (!preset) {
      throw new Error(`预设不存在: ${id}`);
    }
    Object.assign(preset, updates);
    debugLog('[LLMPostProcessor] 更新预设:', preset.name);
  }

  /**
   * 删除预设
   */
  deletePreset(id: string): void {
    const index = this.voiceSettings.llmPresets.findIndex(p => p.id === id);
    if (index === -1) {
      throw new Error(`预设不存在: ${id}`);
    }
    
    // 不允许删除最后一个预设
    if (this.voiceSettings.llmPresets.length <= 1) {
      throw new Error('至少需要保留一个预设');
    }
    
    const preset = this.voiceSettings.llmPresets[index];
    this.voiceSettings.llmPresets.splice(index, 1);
    
    // 如果删除的是当前激活的预设，切换到第一个预设
    if (this.voiceSettings.activeLLMPresetId === id) {
      this.voiceSettings.activeLLMPresetId = this.voiceSettings.llmPresets[0].id;
    }
    
    debugLog('[LLMPostProcessor] 删除预设:', preset.name);
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
    this.timeout = settings.timeout || 15000;
    this.debugMode = settings.debugMode || false;
  }

  /**
   * 检查是否已配置
   */
  isConfigured(): boolean {
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

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 解析供应商和模型配置
   */
  private resolveProviderAndModel(): { provider: Provider; model: ModelConfig } {
    // 如果使用现有供应商
    if (this.voiceSettings.useExistingProviderForPostProcessing) {
      const providerId = this.voiceSettings.postProcessingProviderId;
      const modelId = this.voiceSettings.postProcessingModelId;
      
      if (!providerId || !modelId) {
        throw new Error('请在设置中配置 LLM 后处理的供应商和模型');
      }
      
      const provider = this.configManager.getProvider(providerId);
      if (!provider) {
        throw new Error('LLM 后处理配置的供应商已被删除，请重新选择');
      }
      
      const model = provider.models.find(m => m.id === modelId);
      if (!model) {
        throw new Error('LLM 后处理配置的模型已被删除，请重新选择');
      }
      
      return { provider, model };
    }
    
    // 使用自定义配置
    const endpoint = this.voiceSettings.llmEndpoint;
    const modelName = this.voiceSettings.llmModel;
    const apiKey = this.voiceSettings.llmApiKey;
    
    if (!endpoint || !modelName || !apiKey) {
      throw new Error('未配置自定义 LLM 端点、模型或 API Key');
    }
    
    // 构建临时供应商和模型配置
    const provider: Provider = {
      id: 'voice-llm-custom',
      name: 'Voice LLM Custom',
      endpoint,
      keyConfig: {
        mode: 'local',
        localValue: apiKey,
      },
      models: [],
    };
    
    const model: ModelConfig = {
      id: 'voice-llm-custom-model',
      name: modelName,
      displayName: modelName,
      temperature: 0.7,
      topP: 1,
    };
    
    return { provider, model };
  }

  /**
   * 生成预设 ID
   */
  private generatePresetId(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 8);
    return `preset-${timestamp}-${randomPart}`;
  }
}
