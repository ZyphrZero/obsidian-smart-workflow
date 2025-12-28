/**
 * 常规设置渲染器
 * 负责渲染供应商管理和功能绑定设置
 */

import { Setting, Notice, setIcon, requestUrl } from 'obsidian';
import type { RendererContext } from '../types';
import type { Provider, ModelConfig } from '../settings';
import { BaseSettingsRenderer } from './baseRenderer';
import { 
  DeleteConfigModal, 
  ProviderEditModal, 
  ModelEditModal, 
  ModelSelectModal, 
  TestConnectionModal 
} from '../modals';
import { 
  providerExpandedStatus, 
  shortenEndpoint, 
  formatContextLength 
} from '../utils/settingsUtils';
import { inferModelInfo, createModelTagGroup } from '../../services/naming/modelTypeInferrer';
import { inferContextLength } from '../../services/naming/modelContextLengths';
import { t } from '../../i18n';

/**
 * 常规设置渲染器
 * 处理供应商管理、模型管理和功能绑定的渲染
 */
export class GeneralSettingsRenderer extends BaseSettingsRenderer {
  /**
   * 渲染常规设置
   * @param context 渲染器上下文
   */
  render(context: RendererContext): void {
    this.context = context;

    // 供应商管理区域
    this.renderProviderManagement(context.containerEl);

    // 功能绑定区域
    this.renderFeatureBindings(context.containerEl);
  }

  /**
   * 渲染功能绑定区域
   */
  private renderFeatureBindings(containerEl: HTMLElement): void {
    const bindingCard = this.createCard();
    bindingCard.remove();
    const card = containerEl.createDiv();
    card.style.padding = '16px';
    card.style.borderRadius = '8px';
    card.style.backgroundColor = 'var(--background-secondary)';
    card.style.marginBottom = '10px';

    new Setting(card)
      .setName(t('settingsDetails.general.featureBindings'))
      .setDesc(t('settingsDetails.general.featureBindingsDesc'))
      .setHeading();

    // 获取当前 naming 功能的解析配置
    const resolvedConfig = this.context.configManager.resolveFeatureConfig('naming');
    const currentProvider = resolvedConfig?.provider;
    const currentModel = resolvedConfig?.model;

    // Naming 功能绑定
    const namingSetting = new Setting(card)
      .setName(t('settingsDetails.general.namingFeature'));
    
    // 使用 descEl 支持换行
    const descEl = namingSetting.descEl;
    descEl.empty();
    const descText = t('settingsDetails.general.namingFeatureDesc');
    const lines = descText.split('\n');
    lines.forEach((line, index) => {
      if (index > 0) descEl.createEl('br');
      descEl.appendText(line);
    });

    // 使用自定义 select 元素支持 optgroup
    namingSetting.addDropdown(dropdown => {
      const selectEl = dropdown.selectEl;
      selectEl.empty();
      
      // 设置最小宽度
      selectEl.style.minWidth = '200px';

      // 添加空选项（不绑定）
      const emptyOption = selectEl.createEl('option', {
        value: '',
        text: t('settingsDetails.general.noBinding')
      });
      emptyOption.setAttribute('value', '');

      // 按供应商分组添加选项
      const providers = this.context.configManager.getProviders();
      providers.forEach(provider => {
        if (provider.models.length === 0) return;

        // 创建 optgroup
        const optgroup = selectEl.createEl('optgroup', { attr: { label: provider.name } });
        
        // 添加模型选项
        provider.models.forEach(model => {
          const displayName = model.displayName || model.name;
          const option = optgroup.createEl('option', {
            value: `${provider.id}|${model.id}`,
            text: displayName
          });
          option.setAttribute('value', `${provider.id}|${model.id}`);
        });
      });

      // 设置当前值
      const currentValue = currentProvider && currentModel 
        ? `${currentProvider.id}|${currentModel.id}`
        : '';
      selectEl.value = currentValue;

      // 监听变化
      dropdown.onChange(async (value) => {
        if (!value) {
          // 清除绑定
          delete this.context.plugin.settings.featureBindings.naming;
        } else {
          const [providerId, modelId] = value.split('|');
          const existingBinding = this.context.plugin.settings.featureBindings.naming;
          this.context.plugin.settings.featureBindings.naming = {
            providerId,
            modelId,
            promptTemplate: existingBinding?.promptTemplate ?? this.context.plugin.settings.defaultPromptTemplate
          };
        }
        await this.saveSettings();
        this.refreshDisplay();
      });
    });

    // 显示当前绑定状态
    if (currentProvider && currentModel) {
      const displayName = currentModel.displayName || currentModel.name;
      const statusEl = card.createDiv({ cls: 'feature-binding-status' });
      statusEl.setCssProps({
        'font-size': '0.85em',
        color: 'var(--text-muted)',
        'margin-top': '8px',
        padding: '8px 12px',
        'background-color': 'var(--background-primary)',
        'border-radius': '4px'
      });
      statusEl.setText(t('settingsDetails.general.currentBindingStatus', {
        provider: currentProvider.name,
        model: displayName
      }));
    }
  }

  /**
   * 渲染供应商管理区域
   */
  private renderProviderManagement(containerEl: HTMLElement): void {
    const providerCard = containerEl.createDiv();
    providerCard.style.padding = '16px';
    providerCard.style.borderRadius = '8px';
    providerCard.style.backgroundColor = 'var(--background-secondary)';
    providerCard.style.marginBottom = '10px';

    // 供应商管理标题和添加按钮
    new Setting(providerCard)
      .setName(t('settingsDetails.general.providerManagement'))
      .setDesc(t('settingsDetails.general.providerManagementDesc'))
      .setHeading()
      .addButton(button => button
        .setButtonText(t('settingsDetails.general.addProvider'))
        .setCta()
        .onClick(() => {
          const modal = new ProviderEditModal(
            this.context.app,
            this.context.configManager,
            null,
            async () => {
              await this.saveSettings();
              this.refreshDisplay();
            }
          );
          modal.open();
        }));

    // 供应商列表
    const providers = this.context.configManager.getProviders();
    
    if (providers.length === 0) {
      const emptyEl = providerCard.createDiv({ cls: 'provider-empty' });
      emptyEl.setCssProps({
        padding: '20px',
        'text-align': 'center',
        color: 'var(--text-muted)'
      });
      emptyEl.setText(t('settingsDetails.general.noProviders'));
      return;
    }

    // 渲染每个供应商
    providers.forEach(provider => {
      this.renderProviderItem(providerCard, provider);
    });
  }


  /**
   * 渲染单个供应商项
   */
  private renderProviderItem(containerEl: HTMLElement, provider: Provider): void {
    // 供应商容器 - 使用更紧凑的布局
    const providerContainer = containerEl.createDiv({ cls: 'provider-item' });
    providerContainer.setCssProps({
      'margin-top': '8px',
      padding: '10px 12px',
      'background-color': 'var(--background-primary)',
      'border-radius': '6px',
      border: '1px solid var(--background-modifier-border)'
    });

    // 供应商头部（名称 + 状态 + 操作按钮）- 单行布局
    const headerEl = providerContainer.createDiv({ cls: 'provider-header' });
    headerEl.setCssProps({
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'space-between'
    });

    // 左侧：名称、端点和状态
    const leftEl = headerEl.createDiv({ cls: 'provider-info' });
    leftEl.setCssProps({
      display: 'flex',
      'align-items': 'center',
      gap: '8px',
      flex: '1',
      'min-width': '0'
    });

    // 供应商名称
    const nameEl = leftEl.createSpan({ cls: 'provider-name' });
    nameEl.setText(provider.name);
    nameEl.setCssProps({
      'font-weight': '600'
    });

    // 端点信息（简化显示）
    const endpointEl = leftEl.createSpan({ cls: 'provider-endpoint' });
    const shortEndpoint = shortenEndpoint(provider.endpoint);
    endpointEl.setText(shortEndpoint);
    endpointEl.setCssProps({
      'font-size': '0.8em',
      color: 'var(--text-muted)',
      'white-space': 'nowrap',
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
      'max-width': '200px'
    });
    endpointEl.setAttribute('title', provider.endpoint);

    // 模型数量标签（可点击展开/收缩）
    const isExpanded = providerExpandedStatus.get(provider.id) ?? true;
    const modelCountEl = leftEl.createSpan({ cls: 'provider-model-count' });
    modelCountEl.setCssProps({
      display: 'inline-flex',
      'align-items': 'center',
      gap: '2px',
      'font-size': '0.75em',
      color: 'var(--text-faint)',
      padding: '2px 6px',
      'background-color': 'var(--background-secondary)',
      'border-radius': '10px',
      cursor: provider.models.length > 0 ? 'pointer' : 'default'
    });

    // 展开/收缩图标
    if (provider.models.length > 0) {
      const chevronEl = modelCountEl.createSpan({ cls: 'model-chevron' });
      setIcon(chevronEl, isExpanded ? 'chevron-down' : 'chevron-right');
      chevronEl.setCssProps({
        display: 'inline-flex',
        'align-items': 'center',
        width: '14px',
        height: '14px'
      });
    }

    // 数量文本
    const countTextEl = modelCountEl.createSpan();
    const modelWord = provider.models.length === 1 ? 'model' : 'models';
    countTextEl.setText(`${provider.models.length} ${modelWord}`);

    // 点击切换展开状态
    if (provider.models.length > 0) {
      modelCountEl.addEventListener('click', (e) => {
        e.stopPropagation();
        providerExpandedStatus.set(provider.id, !isExpanded);
        this.refreshDisplay();
      });
    }

    // 右侧：操作按钮
    const actionsEl = headerEl.createDiv({ cls: 'provider-actions' });
    actionsEl.setCssProps({
      display: 'flex',
      gap: '2px',
      'flex-shrink': '0'
    });

    // 测试连接按钮
    const testButton = actionsEl.createEl('button', { cls: 'clickable-icon' });
    setIcon(testButton, 'wifi');
    testButton.setAttribute('aria-label', t('settingsDetails.general.testConnection'));
    testButton.addEventListener('click', async () => {
      await this.testProviderConnection(provider);
    });

    // 获取模型列表按钮
    const fetchModelsButton = actionsEl.createEl('button', { cls: 'clickable-icon' });
    setIcon(fetchModelsButton, 'list');
    fetchModelsButton.setAttribute('aria-label', t('settingsDetails.general.fetchModels'));
    fetchModelsButton.addEventListener('click', async () => {
      await this.fetchProviderModels(provider);
    });

    // 添加模型按钮
    const addModelButton = actionsEl.createEl('button', { cls: 'clickable-icon' });
    setIcon(addModelButton, 'plus');
    addModelButton.setAttribute('aria-label', t('settingsDetails.general.addModel'));
    addModelButton.addEventListener('click', () => {
      const modal = new ModelEditModal(
        this.context.app,
        this.context.configManager,
        provider.id,
        null,
        async () => {
          await this.saveSettings();
          this.refreshDisplay();
        }
      );
      modal.open();
    });

    // 编辑按钮
    const editButton = actionsEl.createEl('button', { cls: 'clickable-icon' });
    setIcon(editButton, 'pencil');
    editButton.setAttribute('aria-label', t('settingsDetails.general.editProvider'));
    editButton.addEventListener('click', () => {
      const modal = new ProviderEditModal(
        this.context.app,
        this.context.configManager,
        provider,
        async () => {
          await this.saveSettings();
          this.refreshDisplay();
        }
      );
      modal.open();
    });

    // 删除按钮
    const deleteButton = actionsEl.createEl('button', { cls: 'clickable-icon' });
    setIcon(deleteButton, 'trash-2');
    deleteButton.setAttribute('aria-label', t('settingsDetails.general.deleteProvider'));
    deleteButton.addEventListener('click', () => {
      const modal = new DeleteConfigModal(
        this.context.app,
        provider.name,
        async () => {
          try {
            this.context.configManager.deleteProvider(provider.id);
            await this.saveSettings();
            new Notice('✅ ' + t('notices.configDeleted'));
            this.refreshDisplay();
          } catch (error) {
            new Notice('❌ ' + (error instanceof Error ? error.message : String(error)));
          }
        }
      );
      modal.open();
    });

    // 模型列表区域（仅当展开且有模型时显示）
    const isModelListExpanded = providerExpandedStatus.get(provider.id) ?? true;
    if (provider.models.length > 0 && isModelListExpanded) {
      this.renderModelList(providerContainer, provider);
    } else if (provider.models.length === 0) {
      // 无模型时显示提示文本
      const noModelsEl = providerContainer.createDiv({ cls: 'no-models-hint' });
      noModelsEl.setCssProps({
        'margin-top': '8px',
        'padding-top': '8px',
        'border-top': '1px solid var(--background-modifier-border)'
      });
      
      const hintText = noModelsEl.createSpan();
      hintText.setText(t('settingsDetails.general.noModels'));
      hintText.setCssProps({
        'font-size': '0.85em',
        color: 'var(--text-muted)',
        'font-style': 'italic'
      });
    }
  }


  /**
   * 渲染模型列表
   */
  private renderModelList(containerEl: HTMLElement, provider: Provider): void {
    // 模型列表
    const modelsEl = containerEl.createDiv({ cls: 'model-list' });
    modelsEl.setCssProps({
      'margin-top': '8px',
      'padding-top': '8px',
      'border-top': '1px solid var(--background-modifier-border)'
    });

    if (provider.models.length === 0) {
      const emptyEl = modelsEl.createDiv();
      emptyEl.setCssProps({
        'font-size': '0.85em',
        color: 'var(--text-muted)',
        'font-style': 'italic'
      });
      emptyEl.setText(t('settingsDetails.general.noModels'));
      return;
    }

    provider.models.forEach(model => {
      this.renderModelItem(modelsEl, provider, model);
    });
  }

  /**
   * 渲染单个模型项
   */
  private renderModelItem(containerEl: HTMLElement, provider: Provider, model: ModelConfig): void {
    const modelEl = containerEl.createDiv({ cls: 'model-item' });
    modelEl.setCssProps({
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'space-between',
      padding: '6px 8px',
      'margin-bottom': '4px',
      'background-color': 'var(--background-secondary)',
      'border-radius': '4px'
    });

    // 左侧：模型信息和能力标签
    const leftEl = modelEl.createDiv({ cls: 'model-left' });
    leftEl.setCssProps({
      display: 'flex',
      'align-items': 'center',
      gap: '8px',
      flex: '1',
      'min-width': '0'
    });

    // 模型信息
    const infoEl = leftEl.createDiv({ cls: 'model-info' });
    
    // 显示名称：优先使用 displayName，为空则使用 name（模型 ID）
    const displayText = model.displayName || model.name;
    const nameEl = infoEl.createSpan({ cls: 'model-name' });
    nameEl.setText(displayText);
    nameEl.setCssProps({
      'font-size': '0.9em'
    });

    // 类型和能力标签 - 使用推断或显式配置的类型和能力
    const { type, abilities } = inferModelInfo(model.name, model.type, model.abilities);
    const tagsEl = leftEl.createDiv({ cls: 'model-capability-tags' });
    tagsEl.setCssProps({
      display: 'flex',
      gap: '3px',
      'flex-shrink': '0'
    });

    // 使用 createModelTagGroup 渲染类型和能力标签
    createModelTagGroup(tagsEl, type, abilities);

    // 上下文长度标签（如果有）
    if (model.contextLength) {
      const contextEl = tagsEl.createSpan({ cls: 'context-length-tag' });
      contextEl.setText(formatContextLength(model.contextLength));
      contextEl.setCssProps({
        'font-size': '0.7em',
        padding: '1px 4px',
        'border-radius': '3px',
        'background-color': 'var(--background-primary)',
        color: 'var(--text-muted)'
      });
    }

    // 操作按钮
    const actionsEl = modelEl.createDiv({ cls: 'model-actions' });
    actionsEl.setCssProps({
      display: 'flex',
      gap: '2px'
    });

    // 复制模型 ID 按钮
    const copyButton = actionsEl.createEl('button', { cls: 'clickable-icon' });
    setIcon(copyButton, 'copy');
    copyButton.setAttribute('aria-label', t('settingsDetails.general.copyModelId'));
    copyButton.setCssProps({
      padding: '2px'
    });
    copyButton.addEventListener('click', async () => {
      await navigator.clipboard.writeText(model.name);
      new Notice('✅ ' + t('settingsDetails.general.modelIdCopied'));
    });

    // 编辑按钮
    const editButton = actionsEl.createEl('button', { cls: 'clickable-icon' });
    setIcon(editButton, 'pencil');
    editButton.setAttribute('aria-label', t('settingsDetails.general.editModel'));
    editButton.setCssProps({
      padding: '2px'
    });
    editButton.addEventListener('click', () => {
      const modal = new ModelEditModal(
        this.context.app,
        this.context.configManager,
        provider.id,
        model,
        async () => {
          await this.saveSettings();
          this.refreshDisplay();
        }
      );
      modal.open();
    });

    // 删除按钮
    const deleteButton = actionsEl.createEl('button', { cls: 'clickable-icon' });
    setIcon(deleteButton, 'trash-2');
    deleteButton.setAttribute('aria-label', t('settingsDetails.general.deleteModel'));
    deleteButton.setCssProps({
      padding: '2px'
    });
    deleteButton.addEventListener('click', async () => {
      try {
        this.context.configManager.deleteModel(provider.id, model.id);
        await this.saveSettings();
        this.refreshDisplay();
      } catch (error) {
        new Notice('❌ ' + (error instanceof Error ? error.message : String(error)));
      }
    });
  }


  /**
   * 测试供应商连接
   */
  private async testProviderConnection(provider: Provider): Promise<void> {
    // 检查是否有模型
    if (provider.models.length === 0) {
      new Notice('❌ ' + t('settingsDetails.general.noModelsToTest'));
      return;
    }

    // 如果只有一个模型，直接测试
    if (provider.models.length === 1) {
      await this.doTestConnection(provider, provider.models[0].id);
      return;
    }

    // 多个模型时弹出选择框
    const modal = new TestConnectionModal(
      this.context.app,
      provider,
      async (modelId: string) => {
        await this.doTestConnection(provider, modelId);
      }
    );
    modal.open();
  }

  /**
   * 执行连接测试
   */
  private async doTestConnection(provider: Provider, modelId: string): Promise<void> {
    new Notice('🔄 ' + t('notices.testingConnection'));

    try {
      await this.context.plugin.aiService.testConnection(provider.id, modelId);
      new Notice('✅ ' + t('notices.connectionSuccess'));
    } catch (error) {
      new Notice('❌ ' + t('notices.connectionFailed', { 
        message: error instanceof Error ? error.message : String(error) 
      }));
    }
  }

  /**
   * 从 API 获取模型列表
   * @param provider 供应商配置
   * @returns 模型 ID 列表
   */
  private async fetchModelsFromApi(provider: Provider): Promise<string[]> {
    // 构建 models 端点 URL
    let modelsEndpoint = provider.endpoint.trim();
    
    // 移除 chat/completions 路径，替换为 models
    modelsEndpoint = modelsEndpoint.replace(/\/chat\/completions\/?$/, '/models');
    modelsEndpoint = modelsEndpoint.replace(/\/completions\/?$/, '/models');
    
    // 如果没有 /models 路径，添加它
    if (!modelsEndpoint.endsWith('/models')) {
      modelsEndpoint = modelsEndpoint.replace(/\/v1\/?$/, '/v1/models');
      if (!modelsEndpoint.includes('/models')) {
        modelsEndpoint = modelsEndpoint + '/v1/models';
      }
    }

    // 修正双斜杠
    modelsEndpoint = modelsEndpoint.replace(/([^:])\/\//g, '$1/');

    const response = await requestUrl({
      url: modelsEndpoint,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json'
      },
      throw: false
    });

    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = response.json;
    
    if (!data || !data.data || !Array.isArray(data.data)) {
      throw new Error(t('settingsDetails.general.fetchModelsInvalidResponse'));
    }

    return data.data
      .filter((m: { id?: string }) => m.id)
      .map((m: { id: string }) => m.id);
  }

  /**
   * 获取供应商的模型列表
   * @param provider 供应商配置
   */
  private async fetchProviderModels(provider: Provider): Promise<void> {
    // 验证 API Key
    if (!provider.apiKey || provider.apiKey.trim() === '') {
      new Notice('❌ ' + t('settingsDetails.general.fetchModelsNoApiKey'));
      return;
    }

    new Notice('⏳ ' + t('settingsDetails.general.fetchingModels'));

    try {
      const models = await this.fetchModelsFromApi(provider);

      if (models.length === 0) {
        new Notice('⚠️ ' + t('settingsDetails.general.fetchModelsEmpty'));
        return;
      }

      new Notice('✅ ' + t('settingsDetails.general.fetchModelsSuccess', { count: String(models.length) }));

      // 显示模型选择弹窗
      const modal = new ModelSelectModal(
        this.context.app,
        models,
        provider.models.map(m => m.name),
        async (selectedModels: string[]) => {
          // 添加选中的模型
          for (const modelId of selectedModels) {
            const exists = provider.models.some(m => m.name === modelId);
            if (!exists) {
              this.context.configManager.addModel(provider.id, {
                name: modelId,
                displayName: '',
                temperature: 0.7,
                maxTokens: inferContextLength(modelId),
                topP: 1.0
              });
            }
          }
          await this.saveSettings();
          this.refreshDisplay();
          new Notice('✅ ' + t('settingsDetails.general.modelsAdded', { count: String(selectedModels.length) }));
        },
        async () => {
          // 刷新回调
          return await this.fetchModelsFromApi(provider);
        }
      );
      modal.open();

    } catch (error) {
      new Notice('❌ ' + t('settingsDetails.general.fetchModelsFailed', { 
        message: error instanceof Error ? error.message : String(error) 
      }));
    }
  }
}
