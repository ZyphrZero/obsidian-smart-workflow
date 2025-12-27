import {
  AIFeature,
  ModelConfig,
  Provider,
  FeatureBinding,
  ResolvedConfig,
  SmartWorkflowSettings,
  DEFAULT_FEATURE_BINDINGS
} from '../../settings/settings';

/**
 * 配置管理器
 * 负责供应商、模型、功能绑定的 CRUD 操作
 */
export class ConfigManager {
  private settings: SmartWorkflowSettings;
  private onSettingsChange?: () => Promise<void>;

  constructor(
    settings: SmartWorkflowSettings,
    onSettingsChange?: () => Promise<void>
  ) {
    this.settings = settings;
    this.onSettingsChange = onSettingsChange;
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
    if (updates.apiKey !== undefined && updates.apiKey.trim() === '') {
      throw new Error('Provider API key cannot be empty');
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
   * 验证模型配置参数
   */
  private validateModelConfig(model: Omit<ModelConfig, 'id'>): void {
    if (!model.name || model.name.trim() === '') {
      throw new Error('Model name is required');
    }
    if (model.temperature < 0 || model.temperature > 2) {
      throw new Error('Invalid parameter: temperature must be between 0 and 2');
    }
    if (!Number.isInteger(model.maxTokens) || model.maxTokens < 0) {
      throw new Error('Invalid parameter: maxTokens must be a non-negative integer');
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
    const features: AIFeature[] = ['naming', 'translation'];
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
  }

  /**
   * 重置引用指定模型的功能绑定
   */
  private resetBindingsForModel(providerId: string, modelId: string): void {
    const features: AIFeature[] = ['naming', 'translation'];
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
  }

  /**
   * 保存设置
   */
  private saveSettings(): void {
    if (this.onSettingsChange) {
      this.onSettingsChange();
    }
  }
}
