/**
 * 常规设置渲染器
 * 负责渲染供应商管理设置
 */

import { Setting, Notice, setIcon, requestUrl } from 'obsidian';
import type { RendererContext } from '../types';
import type { Provider, ModelConfig } from '../settings';
import { BaseSettingsRenderer } from './baseRenderer';
import { 
  DeleteConfigModal,
  DeleteModelModal,
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
import { inferModelInfo, createModelTagGroup, inferContextLength, ConnectionTester } from '../../services/ai';
import { t } from '../../i18n';

/**
 * 常规设置渲染器
 * 处理供应商管理和模型管理的渲染
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
  }

  /**
   * 渲染供应商管理区域
   */
  private renderProviderManagement(containerEl: HTMLElement): void {
    const providerCard = containerEl.createDiv({ cls: 'settings-card' });

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
   * 渲染模型列表（支持拖拽排序）
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

    // 拖拽状态
    let draggedIndex: number | null = null;

    provider.models.forEach((model, index) => {
      this.renderModelItem(modelsEl, provider, model, index, {
        onDragStart: (idx) => { draggedIndex = idx; },
        onDragEnd: () => { draggedIndex = null; },
        onDrop: async (targetIdx) => {
          if (draggedIndex !== null && draggedIndex !== targetIdx) {
            this.context.configManager.reorderModel(provider.id, draggedIndex, targetIdx);
            await this.saveSettings();
            this.refreshDisplay();
          }
        },
        getDraggedIndex: () => draggedIndex
      });
    });
  }

  /**
   * 渲染单个模型项（支持拖拽排序）
   */
  private renderModelItem(
    containerEl: HTMLElement,
    provider: Provider,
    model: ModelConfig,
    index: number,
    dragHandlers: {
      onDragStart: (index: number) => void;
      onDragEnd: () => void;
      onDrop: (targetIndex: number) => Promise<void>;
      getDraggedIndex: () => number | null;
    }
  ): void {
    const modelEl = containerEl.createDiv({ cls: 'model-item' });
    modelEl.setAttribute('draggable', 'true');
    modelEl.setAttribute('data-index', String(index));
    modelEl.setCssProps({
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'space-between',
      padding: '6px 8px',
      'margin-bottom': '4px',
      'background-color': 'var(--background-secondary)',
      'border-radius': '4px',
      cursor: 'grab',
      transition: 'all 0.2s ease',
      'border-left': '3px solid transparent'
    });

    // 拖拽事件
    modelEl.addEventListener('dragstart', (e) => {
      dragHandlers.onDragStart(index);
      modelEl.style.opacity = '0.4';
      modelEl.style.transform = 'scale(0.98)';
      modelEl.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
      }
    });

    modelEl.addEventListener('dragend', () => {
      dragHandlers.onDragEnd();
      modelEl.style.opacity = '1';
      modelEl.style.transform = 'scale(1)';
      modelEl.style.boxShadow = 'none';
      modelEl.style.borderLeftColor = 'transparent';
    });

    modelEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      const draggedIdx = dragHandlers.getDraggedIndex();
      if (draggedIdx !== null && draggedIdx !== index) {
        modelEl.style.backgroundColor = 'var(--background-modifier-hover)';
        modelEl.style.borderLeftColor = 'var(--interactive-accent)';
        // 根据拖拽方向显示上/下边框指示
        if (draggedIdx < index) {
          modelEl.style.transform = 'translateY(2px)';
        } else {
          modelEl.style.transform = 'translateY(-2px)';
        }
      }
    });

    modelEl.addEventListener('dragleave', () => {
      modelEl.style.backgroundColor = 'var(--background-secondary)';
      modelEl.style.borderLeftColor = 'transparent';
      modelEl.style.transform = 'translateY(0)';
    });

    modelEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      modelEl.style.backgroundColor = 'var(--background-secondary)';
      modelEl.style.borderLeftColor = 'transparent';
      modelEl.style.transform = 'translateY(0)';
      await dragHandlers.onDrop(index);
    });

    // 左侧：拖拽手柄 + 模型信息和能力标签
    const leftEl = modelEl.createDiv({ cls: 'model-left' });
    leftEl.setCssProps({
      display: 'flex',
      'align-items': 'center',
      gap: '8px',
      flex: '1',
      'min-width': '0'
    });

    // 拖拽手柄图标
    const dragHandle = leftEl.createSpan({ cls: 'drag-handle' });
    setIcon(dragHandle, 'grip-vertical');
    dragHandle.setCssProps({
      color: 'var(--text-faint)',
      cursor: 'grab',
      transition: 'color 0.15s ease, transform 0.15s ease',
      display: 'inline-flex',
      'align-items': 'center',
      'flex-shrink': '0'
    });
    dragHandle.setAttribute('aria-label', t('settingsDetails.general.dragToReorder'));

    // 悬停时高亮拖拽手柄
    modelEl.addEventListener('mouseenter', () => {
      dragHandle.style.color = 'var(--text-muted)';
    });
    modelEl.addEventListener('mouseleave', () => {
      dragHandle.style.color = 'var(--text-faint)';
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

    // 上下文长度标签（动态推断）
    const inferredContextLength = inferContextLength(model.name);
    if (inferredContextLength > 0) {
      const contextEl = tagsEl.createSpan({ cls: 'context-length-tag' });
      contextEl.setText(formatContextLength(inferredContextLength));
      contextEl.setAttribute('aria-label', `Context: ${inferredContextLength.toLocaleString()} tokens`);
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
    copyButton.addEventListener('click', async (e) => {
      e.stopPropagation();
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
    editButton.addEventListener('click', (e) => {
      e.stopPropagation();
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
    deleteButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      new DeleteModelModal(
        this.context.app,
        model.displayName || model.name,
        async () => {
          try {
            this.context.configManager.deleteModel(provider.id, model.id);
            await this.saveSettings();
            this.refreshDisplay();
          } catch (error) {
            new Notice('❌ ' + (error instanceof Error ? error.message : String(error)));
          }
        }
      ).open();
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

    const model = provider.models.find(m => m.id === modelId);
    if (!model) {
      new Notice('❌ ' + t('notices.connectionFailed', { message: 'Model not found' }));
      return;
    }

    try {
      const tester = new ConnectionTester({
        timeout: this.context.plugin.settings.timeout || 15000,
        debugMode: this.context.plugin.settings.debugMode,
      });
      await tester.testConnection(provider, model);
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
        'Authorization': `Bearer ${this.getProviderApiKey(provider)}`,
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
    const apiKey = this.getProviderApiKey(provider);
    if (!apiKey || apiKey.trim() === '') {
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
                maxOutputTokens: 0, // 0 表示自动，由 API 使用默认值
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

  /**
   * 获取供应商的 API 密钥
   * 支持新的 keyConfig 结构
   */
  private getProviderApiKey(provider: Provider): string {
    // 使用 ConfigManager 的统一接口获取密钥
    const apiKey = this.context.configManager.getApiKey(provider.id);
    if (apiKey) {
      return apiKey;
    }
    
    // 如果 ConfigManager 无法获取（可能是临时 provider），直接从 keyConfig 获取
    if (provider.keyConfig?.mode === 'local' && provider.keyConfig.localValue) {
      return provider.keyConfig.localValue;
    }
    
    return '';
  }
}
