import {
  AIFeature,
  ModelConfig,
  Provider,
  FeatureBinding,
  ResolvedConfig,
  SmartWorkflowSettings,
  DEFAULT_FEATURE_BINDINGS,
  KeyConfig,
} from '../../settings/settings';
import type { ISecretService } from '../secret';

/**
 * 配置管理器
 * 负责供应商、模型、功能绑定的 CRUD 操作
 */
export class ConfigManager {
  private settings: SmartWorkflowSettings;
  private onSettingsChange?: () => Promise<void>;
  private _secretService?: ISecretService;

  constructor(
    settings: SmartWorkflowSettings,
    onSettingsChange?: () => Promise<void>,
    secretService?: ISecretService
  ) {
    this.settings = settings;
    this.onSettingsChange = onSettingsChange;
    this._secretService = secretService;
  }

  /**
   * 设置密钥服务
   * 用于延迟注入 SecretService
   */
  setSecretService(secretService: ISecretService): void {
    this._secretService = secretService;
  }

  /**
   * 生成唯一 ID
   * 使用时间戳 + 随机字符串确保唯一性
   */
  generateId(): string {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${randomPart}`;
  }

  // ============================================================================
  // 供应商 CRUD 操作
  // ============================================================================

  /**
   * 获取所有供应商
   */
  getProviders(): Provider[] {
    return this.settings.providers;
  }

  /**
   * 根据 ID 获取供应商
   */
  getProvider(id: string): Provider | undefined {
    return this.settings.providers.find(p => p.id === id);
  }

  /**
   * 添加供应商
   * @throws Error 如果验证失败
   */
  addProvider(provider: Omit<Provider, 'id' | 'models'>): Provider {
    // 验证必填字段
    if (!provider.name || provider.name.trim() === '') {
      throw new Error('Provider name is required');
    }
    if (!provider.endpoint || provider.endpoint.trim() === '') {
      throw new Error('Provider endpoint is required');
    }

    const newProvider: Provider = {
      ...provider,
      id: this.generateId(),
      models: []
    };

    this.settings.providers.push(newProvider);
    this.saveSettings();
    return newProvider;
  }

  /**
   * 更新供应商
   * @throws Error 如果供应商不存在或验证失败
   */
  updateProvider(id: string, updates: Partial<Omit<Provider, 'id'>>): void {
    const provider = this.getProvider(id);
    if (!provider) {
      throw new Error(`Provider not found: ${id}`);
    }

    // 验证更新字段
    if (updates.name !== undefined && updates.name.trim() === '') {
      throw new Error('Provider name cannot be empty');
    }
    if (updates.endpoint !== undefined && updates.endpoint.trim() === '') {
      throw new Error('Provider endpoint cannot be empty');
    }

    // 应用更新
    Object.assign(provider, updates);
    this.saveSettings();
  }

  /**
   * 删除供应商
   * 级联删除所有关联的模型，并重置相关的功能绑定
   */
  deleteProvider(id: string): void {
    const index = this.settings.providers.findIndex(p => p.id === id);
    if (index === -1) {
      throw new Error(`Provider not found: ${id}`);
    }

    // 重置引用此供应商的功能绑定
    this.resetBindingsForProvider(id);

    // 删除供应商（模型会随之删除）
    this.settings.providers.splice(index, 1);
    this.saveSettings();
  }

  // ============================================================================
  // 模型 CRUD 操作
  // ============================================================================

  /**
   * 获取供应商下的所有模型
   */
  getModels(providerId: string): ModelConfig[] {
    const provider = this.getProvider(providerId);
    return provider?.models ?? [];
  }

  /**
   * 获取特定模型
   */
  getModel(providerId: string, modelId: string): ModelConfig | undefined {
    const provider = this.getProvider(providerId);
    return provider?.models.find(m => m.id === modelId);
  }

  /**
   * 添加模型
   * @throws Error 如果供应商不存在或验证失败
   */
  addModel(providerId: string, model: Omit<ModelConfig, 'id'>): ModelConfig {
    const provider = this.getProvider(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    // 验证模型参数
    this.validateModelConfig(model);

    const newModel: ModelConfig = {
      ...model,
      id: this.generateId()
    };

    provider.models.push(newModel);
    this.saveSettings();
    return newModel;
  }

  /**
   * 更新模型
   * @throws Error 如果供应商或模型不存在，或验证失败
   */
  updateModel(
    providerId: string,
    modelId: string,
    updates: Partial<Omit<ModelConfig, 'id'>>
  ): void {
    const provider = this.getProvider(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    const model = provider.models.find(m => m.id === modelId);
    if (!model) {
      throw new Error(`Model not found: ${providerId}/${modelId}`);
    }

    // 验证更新字段
    const merged = { ...model, ...updates };
    this.validateModelConfig(merged);

    // 应用更新
    Object.assign(model, updates);
    this.saveSettings();
  }

  /**
   * 删除模型
   * 重置引用此模型的功能绑定
   */
  deleteModel(providerId: string, modelId: string): void {
    const provider = this.getProvider(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    const index = provider.models.findIndex(m => m.id === modelId);
    if (index === -1) {
      throw new Error(`Model not found: ${providerId}/${modelId}`);
    }

    // 重置引用此模型的功能绑定
    this.resetBindingsForModel(providerId, modelId);

    // 删除模型
    provider.models.splice(index, 1);
    this.saveSettings();
  }

  /**
   * 重新排序模型
   * @param providerId 供应商 ID
   * @param fromIndex 原始索引
   * @param toIndex 目标索引
   */
  reorderModel(providerId: string, fromIndex: number, toIndex: number): void {
    const provider = this.getProvider(providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`);
    }

    if (fromIndex < 0 || fromIndex >= provider.models.length ||
        toIndex < 0 || toIndex >= provider.models.length) {
      throw new Error('Invalid index for reorder');
    }

    if (fromIndex === toIndex) {
      return;
    }

    // 移动模型
    const [model] = provider.models.splice(fromIndex, 1);
    provider.models.splice(toIndex, 0, model);
    this.saveSettings();
  }

  /**
   * 验证模型配置参数
   */
  private validateModelConfig(model: Omit<ModelConfig, 'id'>): void {
    if (!model.name || model.name.trim() === '') {
      throw new Error('Model name is required');
    }
    if (model.temperature < 0 || model.temperature > 2) {
      throw new Error('Invalid parameter: temperature must be between 0 and 2');
    }
    if (model.maxOutputTokens !== undefined && 
        (!Number.isInteger(model.maxOutputTokens) || model.maxOutputTokens < 0)) {
      throw new Error('Invalid parameter: maxOutputTokens must be a non-negative integer');
    }
    if (model.topP < 0 || model.topP > 1) {
      throw new Error('Invalid parameter: topP must be between 0 and 1');
    }
  }

  // ============================================================================
  // 功能绑定操作
  // ============================================================================

  /**
   * 获取功能绑定
   */
  getFeatureBinding(feature: AIFeature): FeatureBinding | undefined {
    return this.settings.featureBindings[feature];
  }

  /**
   * 设置功能绑定
   * @throws Error 如果引用的供应商或模型不存在
   */
  setFeatureBinding(feature: AIFeature, binding: FeatureBinding): void {
    // 验证供应商存在
    const provider = this.getProvider(binding.providerId);
    if (!provider) {
      throw new Error(`Provider not found: ${binding.providerId}`);
    }

    // 验证模型存在
    const model = provider.models.find(m => m.id === binding.modelId);
    if (!model) {
      throw new Error(`Model not found: ${binding.providerId}/${binding.modelId}`);
    }

    this.settings.featureBindings[feature] = binding;
    this.saveSettings();
  }

  /**
   * 解析功能配置
   * 返回完整的供应商和模型信息，供 AIService 使用
   * 如果没有绑定，返回 undefined（不自动回退）
   */
  resolveFeatureConfig(feature: AIFeature): ResolvedConfig | undefined {
    const binding = this.getFeatureBinding(feature);
    
    // 如果没有绑定，返回 undefined
    if (!binding) {
      return undefined;
    }

    const provider = this.getProvider(binding.providerId);
    if (!provider) {
      return undefined;
    }

    const model = provider.models.find(m => m.id === binding.modelId);
    if (!model) {
      return undefined;
    }

    return {
      provider,
      model,
      promptTemplate: binding.promptTemplate
    };
  }

  /**
   * 获取供应商+模型选项列表
   * 用于 UI 下拉选择器
   */
  getProviderModelOptions(): Array<{
    label: string;
    value: { providerId: string; modelId: string };
  }> {
    const options: Array<{
      label: string;
      value: { providerId: string; modelId: string };
    }> = [];

    for (const provider of this.settings.providers) {
      for (const model of provider.models) {
        options.push({
          label: `${provider.name} / ${model.displayName}`,
          value: {
            providerId: provider.id,
            modelId: model.id
          }
        });
      }
    }

    return options;
  }

  // ============================================================================
  // 私有辅助方法
  // ============================================================================

  /**
   * 获取默认的解析配置
   */
  private getDefaultResolvedConfig(feature: AIFeature): ResolvedConfig | undefined {
    const defaultBinding = DEFAULT_FEATURE_BINDINGS[feature];
    if (!defaultBinding) {
      return undefined;
    }

    // 尝试从当前设置中找到默认供应商
    let provider = this.getProvider(defaultBinding.providerId);
    
    // 如果找不到，使用第一个可用的供应商
    if (!provider && this.settings.providers.length > 0) {
      provider = this.settings.providers[0];
    }

    // 如果没有供应商，返回 undefined（调用方需要处理）
    if (!provider) {
      return undefined;
    }

    // 查找模型
    let model = provider.models.find(m => m.id === defaultBinding.modelId);
    if (!model && provider.models.length > 0) {
      model = provider.models[0];
    }

    // 如果没有模型，返回 undefined
    if (!model) {
      return undefined;
    }

    return {
      provider,
      model,
      promptTemplate: defaultBinding.promptTemplate
    };
  }

  /**
   * 重置引用指定供应商的功能绑定
   */
  private resetBindingsForProvider(providerId: string): void {
    const features: AIFeature[] = ['naming', 'translation', 'writing', 'tagging', 'categorizing'];
    for (const feature of features) {
      const binding = this.settings.featureBindings[feature];
      if (binding?.providerId === providerId) {
        // 重置为默认绑定
        const defaultBinding = DEFAULT_FEATURE_BINDINGS[feature];
        if (defaultBinding) {
          this.settings.featureBindings[feature] = { ...defaultBinding };
        } else {
          delete this.settings.featureBindings[feature];
        }
      }
    }
    
    // 重置语音 LLM 后处理配置
    if (this.settings.voice?.postProcessingProviderId === providerId) {
      this.settings.voice.postProcessingProviderId = undefined;
      this.settings.voice.postProcessingModelId = undefined;
    }
    
    // 重置 AI 助手配置
    if (this.settings.voice?.assistantConfig?.providerId === providerId) {
      this.settings.voice.assistantConfig.providerId = undefined;
      this.settings.voice.assistantConfig.modelId = undefined;
    }
  }

  /**
   * 重置引用指定模型的功能绑定
   */
  private resetBindingsForModel(providerId: string, modelId: string): void {
    const features: AIFeature[] = ['naming', 'translation', 'writing', 'tagging', 'categorizing'];
    for (const feature of features) {
      const binding = this.settings.featureBindings[feature];
      if (binding?.providerId === providerId && binding?.modelId === modelId) {
        // 重置为默认绑定
        const defaultBinding = DEFAULT_FEATURE_BINDINGS[feature];
        if (defaultBinding) {
          this.settings.featureBindings[feature] = { ...defaultBinding };
        } else {
          delete this.settings.featureBindings[feature];
        }
      }
    }
    
    // 重置语音 LLM 后处理配置
    if (this.settings.voice?.postProcessingProviderId === providerId &&
        this.settings.voice?.postProcessingModelId === modelId) {
      this.settings.voice.postProcessingModelId = undefined;
    }
    
    // 重置 AI 助手配置
    if (this.settings.voice?.assistantConfig?.providerId === providerId &&
        this.settings.voice?.assistantConfig?.modelId === modelId) {
      this.settings.voice.assistantConfig.modelId = undefined;
    }
  }

  /**
   * 保存设置
   */
  private saveSettings(): void {
    if (this.onSettingsChange) {
      this.onSettingsChange();
    }
  }

  // ============================================================================
  // 统一密钥管理（支持共享密钥和本地密钥）
  // ============================================================================

  /**
   * 解析单个密钥配置
   * 根据存储模式从 SecretStorage 或本地设置获取密钥值
   * @param keyConfig 密钥配置
   * @returns 密钥值，不可用返回 undefined
   */
  resolveKeyValue(keyConfig: KeyConfig | undefined): string | undefined {
    if (!keyConfig) {
      return undefined;
    }

    if (keyConfig.mode === 'shared') {
      // 共享模式：从 SecretStorage 获取
      if (!keyConfig.secretId) {
        return undefined;
      }
      if (!this._secretService) {
        // SecretService 未初始化，无法获取共享密钥
        return undefined;
      }
      const value = this._secretService.getSecret(keyConfig.secretId);
      return value ?? undefined;
    } else {
      // 本地模式：直接返回本地值
      return keyConfig.localValue;
    }
  }

  /**
   * 获取供应商的 API 密钥（统一接口）
   * 自动处理共享/本地存储模式
   * @param providerId 供应商 ID
   * @returns 密钥值，不可用返回 undefined
   */
  getApiKey(providerId: string): string | undefined {
    const provider = this.getProvider(providerId);
    if (!provider) {
      return undefined;
    }

    // 如果有多密钥配置，使用轮询
    if (provider.keyConfigs && provider.keyConfigs.length > 0) {
      const index = provider.currentKeyIndex ?? 0;
      const keyConfig = provider.keyConfigs[index];
      const value = this.resolveKeyValue(keyConfig);
      if (value) {
        return value;
      }
      // 如果当前密钥不可用，尝试下一个
      return this.findNextAvailableKey(provider);
    }
    
    // 单密钥配置
    return this.resolveKeyValue(provider.keyConfig);
  }

  /**
   * 获取供应商的所有 API 密钥（统一接口）
   * 用于多密钥轮询场景，自动处理共享/本地存储模式
   * @param providerId 供应商 ID
   * @returns 密钥值数组（仅包含可用的密钥）
   */
  getApiKeys(providerId: string): string[] {
    const provider = this.getProvider(providerId);
    if (!provider) {
      return [];
    }

    const keys: string[] = [];

    // 使用 keyConfigs 配置
    if (provider.keyConfigs && provider.keyConfigs.length > 0) {
      for (const keyConfig of provider.keyConfigs) {
        const value = this.resolveKeyValue(keyConfig);
        if (value) {
          keys.push(value);
        }
      }
      if (keys.length > 0) {
        return keys;
      }
    }

    // 使用主密钥配置
    const value = this.resolveKeyValue(provider.keyConfig);
    if (value) {
      keys.push(value);
    }

    return keys;
  }

  /**
   * 查找下一个可用的密钥
   * 当当前密钥不可用时（如共享密钥被删除），自动跳过
   * @param provider 供应商配置
   * @returns 可用的密钥值，如果都不可用返回 undefined
   */
  private findNextAvailableKey(provider: Provider): string | undefined {
    if (!provider.keyConfigs || provider.keyConfigs.length === 0) {
      return undefined;
    }

    const startIndex = provider.currentKeyIndex ?? 0;
    const totalKeys = provider.keyConfigs.length;

    // 从当前索引开始，尝试找到一个可用的密钥
    for (let i = 0; i < totalKeys; i++) {
      const index = (startIndex + i) % totalKeys;
      const keyConfig = provider.keyConfigs[index];
      const value = this.resolveKeyValue(keyConfig);
      if (value) {
        // 更新当前索引
        if (index !== startIndex) {
          provider.currentKeyIndex = index;
          this.saveSettings();
        }
        return value;
      }
    }

    return undefined;
  }

  // ============================================================================
  // 密钥轮询
  // ============================================================================

  /**
   * 获取供应商的当前 API 密钥
   * 支持多密钥轮询模式
   * @deprecated 使用 getApiKey() 替代
   */
  getCurrentApiKey(providerId: string): string | undefined {
    return this.getApiKey(providerId);
  }

  /**
   * 轮询到下一个密钥
   * 在请求失败（如限流）时调用
   * 自动跳过不可用的共享密钥
   */
  rotateApiKey(providerId: string): string | undefined {
    const provider = this.getProvider(providerId);
    if (!provider) return undefined;

    // 只有多密钥时才轮询
    if (!provider.keyConfigs || provider.keyConfigs.length <= 1) {
      return this.resolveKeyValue(provider.keyConfig);
    }

    const currentIndex = provider.currentKeyIndex ?? 0;
    const totalKeys = provider.keyConfigs.length;

    // 从下一个索引开始，尝试找到一个可用的密钥
    for (let i = 1; i <= totalKeys; i++) {
      const nextIndex = (currentIndex + i) % totalKeys;
      const keyConfig = provider.keyConfigs[nextIndex];
      const value = this.resolveKeyValue(keyConfig);
      if (value) {
        // 更新当前索引
        provider.currentKeyIndex = nextIndex;
        this.saveSettings();
        return value;
      }
    }

    // 所有密钥都不可用
    return undefined;
  }

  /**
   * 获取供应商的密钥数量
   */
  getApiKeyCount(providerId: string): number {
    const provider = this.getProvider(providerId);
    if (!provider) return 0;

    if (provider.keyConfigs && provider.keyConfigs.length > 0) {
      return provider.keyConfigs.length;
    }

    return provider.keyConfig ? 1 : 0;
  }

  // ============================================================================
  // 供应商查找
  // ============================================================================

  /**
   * 根据 endpoint 特征查找硅基流动供应商
   * 用于 ASR 配置复用已有的 API Key
   * @returns 硅基流动供应商，如果未找到则返回 undefined
   */
  findSiliconFlowProvider(): Provider | undefined {
    // 硅基流动的 endpoint 特征
    const siliconFlowEndpoints = [
      'api.siliconflow.cn',
      'siliconflow.cn',
    ];

    return this.settings.providers.find(provider => {
      const endpoint = provider.endpoint.toLowerCase();
      return siliconFlowEndpoints.some(pattern => endpoint.includes(pattern));
    });
  }

  /**
   * 获取硅基流动供应商的 API Key
   * @returns API Key，如果未找到供应商或无 API Key 则返回 undefined
   */
  getSiliconFlowApiKey(): string | undefined {
    const provider = this.findSiliconFlowProvider();
    if (!provider) return undefined;
    return this.getApiKey(provider.id);
  }
}

