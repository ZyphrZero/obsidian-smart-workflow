import { App, PluginSettingTab, Setting, Modal, Notice, setIcon, requestUrl } from 'obsidian';
import type SmartWorkflowPlugin from '../main';
import { BASE_PROMPT_TEMPLATE, ADVANCED_PROMPT_TEMPLATE, getCurrentPlatformShell, setCurrentPlatformShell, getCurrentPlatformCustomShellPath, setCurrentPlatformCustomShellPath, ShellType, Provider, ModelConfig, ModelType, APIFormat, ReasoningEffort } from './settings';
import { ConfigManager } from '../services/config/configManager';
import { inferModelInfo, createModelTagGroup } from '../services/naming/modelTypeInferrer';
import { existsSync } from 'fs';
import { t } from '../i18n';

/**
 * 供应商模型列表展开状态缓存（默认展开）
 */
const providerExpandedStatus: Map<string, boolean> = new Map();

/**
 * 验证 Shell 路径是否有效
 */
function validateShellPath(path: string): boolean {
  if (!path || path.trim() === '') return false;
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/**
 * 设置标签页接口
 */
interface SettingTab {
  id: string;
  name: string;
  icon: string;
}

/**
 * 设置标签页定义
 * 使用函数返回以确保 i18n 已初始化
 */
function getSettingTabs(): SettingTab[] {
  return [
    { id: 'general', name: t('settings.tabs.general'), icon: 'settings' },
    { id: 'naming', name: t('settings.tabs.naming'), icon: 'tag' },
    { id: 'terminal', name: t('settings.tabs.terminal'), icon: 'terminal' },
    { id: 'advanced', name: t('settings.tabs.advanced'), icon: 'sliders-horizontal' }
  ];
}

/**
 * 配置删除确认弹窗
 */
class DeleteConfigModal extends Modal {
  private configName: string;
  private onConfirm: () => void;

  constructor(app: App, configName: string, onConfirm: () => void) {
    super(app);
    this.configName = configName;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // 设置弹窗宽度
    this.modalEl.setCssProps({
      width: '500px',
      'max-width': '90vw'
    });

    new Setting(contentEl)
      .setName(t('modals.deleteConfig.title'))
      .setHeading();

    // 警告信息
    const warningContainer = contentEl.createDiv({ cls: 'setting-item' });
    warningContainer.setCssProps({
      padding: '12px',
      'margin-bottom': '16px',
      'background-color': 'var(--background-modifier-error)',
      'border-radius': '6px',
      'border': '1px solid var(--background-modifier-error-hover)'
    });

    const warningText = warningContainer.createDiv();
    warningText.setText(t('modals.deleteConfig.warning', { name: this.configName }));
    warningText.setCssProps({
      color: 'var(--text-on-accent)',
      'font-weight': '500'
    });

    // 创建按钮容器
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    buttonContainer.setCssProps({
      display: 'flex',
      'justify-content': 'flex-end',
      gap: '8px'
    });

    // 取消按钮
    const cancelButton = buttonContainer.createEl('button', { text: t('common.cancel') });
    cancelButton.addEventListener('click', () => {
      this.close();
    });

    // 确认删除按钮
    const confirmButton = buttonContainer.createEl('button', {
      text: t('common.confirm'),
      cls: 'mod-warning'
    });
    confirmButton.addEventListener('click', () => {
      this.onConfirm();
      this.close();
    });

    // ESC 键关闭
    contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * 供应商编辑弹窗
 */
class ProviderEditModal extends Modal {
  private provider: Provider | null;
  private configManager: ConfigManager;
  private onSave: () => void;
  private isNew: boolean;

  constructor(
    app: App,
    configManager: ConfigManager,
    provider: Provider | null,
    onSave: () => void
  ) {
    super(app);
    this.configManager = configManager;
    this.provider = provider;
    this.onSave = onSave;
    this.isNew = !provider;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // 设置弹窗宽度
    this.modalEl.setCssProps({
      width: '550px',
      'max-width': '90vw'
    });

    // 标题
    new Setting(contentEl)
      .setName(this.isNew ? t('modals.providerEdit.titleAdd') : t('modals.providerEdit.titleEdit'))
      .setHeading();

    // 表单数据
    const formData = {
      name: this.provider?.name || '',
      endpoint: this.provider?.endpoint || '',
      apiKey: this.provider?.apiKey || ''
    };

    // 供应商名称
    new Setting(contentEl)
      .setName(t('modals.providerEdit.name'))
      .setDesc(t('modals.providerEdit.nameDesc'))
      .addText(text => {
        text
          .setPlaceholder(t('modals.providerEdit.namePlaceholder'))
          .setValue(formData.name)
          .onChange(value => {
            formData.name = value;
          });
        text.inputEl.setCssProps({ 'min-width': '200px' });
      });

    // API 端点
    new Setting(contentEl)
      .setName(t('modals.providerEdit.endpoint'))
      .setDesc(t('modals.providerEdit.endpointDesc'))
      .addText(text => {
        text
          .setPlaceholder('https://api.openai.com/v1/chat/completions')
          .setValue(formData.endpoint)
          .onChange(value => {
            formData.endpoint = value;
            // 更新实际请求 URL 显示
            updateActualUrl(value);
          });
        text.inputEl.setCssProps({ 'min-width': '200px' });
      });

    // 实际请求 URL 显示
    const actualUrlEl = contentEl.createDiv({ cls: 'actual-url-display' });
    actualUrlEl.setCssProps({
      'font-size': '0.8em',
      color: 'var(--text-muted)',
      'margin-top': '-8px',
      'margin-bottom': '12px',
      padding: '0px',
      'background-color': 'var(--background-primary)',
      'border-radius': '4px',
      'word-break': 'break-all'
    });

    const updateActualUrl = (endpoint: string) => {
      const normalized = this.normalizeEndpointForDisplay(endpoint);
      actualUrlEl.setText(t('settingsDetails.general.actualRequestUrl', { url: normalized }));
    };

    // 初始化显示
    updateActualUrl(formData.endpoint);

    // API Key
    new Setting(contentEl)
      .setName(t('modals.providerEdit.apiKey'))
      .setDesc(t('modals.providerEdit.apiKeyDesc'))
      .addText(text => {
        text
          .setPlaceholder('sk-...')
          .setValue(formData.apiKey)
          .onChange(value => {
            formData.apiKey = value;
          });
        text.inputEl.type = 'password';
        text.inputEl.setCssProps({ 'min-width': '200px' });
      });

    // 按钮容器
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    buttonContainer.setCssProps({
      display: 'flex',
      'justify-content': 'flex-end',
      gap: '8px',
      'margin-top': '16px'
    });

    // 取消按钮
    const cancelButton = buttonContainer.createEl('button', { text: t('common.cancel') });
    cancelButton.addEventListener('click', () => {
      this.close();
    });

    // 保存按钮
    const saveButton = buttonContainer.createEl('button', {
      text: t('common.save'),
      cls: 'mod-cta'
    });
    saveButton.addEventListener('click', async () => {
      try {
        if (!formData.name.trim()) {
          new Notice('❌ ' + t('modals.providerEdit.nameRequired'));
          return;
        }
        if (!formData.endpoint.trim()) {
          new Notice('❌ ' + t('modals.providerEdit.endpointRequired'));
          return;
        }

        if (this.isNew) {
          // 创建新供应商（不添加默认模型，用户需要手动添加）
          this.configManager.addProvider({
            name: formData.name.trim(),
            endpoint: formData.endpoint.trim(),
            apiKey: formData.apiKey
          });
        } else if (this.provider) {
          // 更新现有供应商
          this.configManager.updateProvider(this.provider.id, {
            name: formData.name.trim(),
            endpoint: formData.endpoint.trim(),
            apiKey: formData.apiKey
          });
        }

        this.onSave();
        this.close();
      } catch (error) {
        new Notice('❌ ' + (error instanceof Error ? error.message : String(error)));
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  /**
   * 标准化端点 URL 用于显示
   */
  private normalizeEndpointForDisplay(url: string): string {
    let normalized = url.trim();

    if (!normalized) {
      return '';
    }

    // 检查协议
    if (!normalized.match(/^https?:\/\//i)) {
      if (normalized.startsWith('//')) {
        normalized = 'https:' + normalized;
      } else if (!normalized.includes('://')) {
        normalized = 'https://' + normalized;
      }
    }

    // 移除末尾多余的斜杠
    normalized = normalized.replace(/\/+$/, '');

    // 检查是否包含完整路径
    const commonPaths = [
      '/v1/chat/completions',
      '/chat/completions',
      '/v1/completions',
      '/completions'
    ];

    const hasPath = commonPaths.some(path => normalized.includes(path));

    if (!hasPath) {
      try {
        const urlObj = new URL(normalized);
        const pathname = urlObj.pathname;

        if (pathname === '/v1' || pathname === '/v1/') {
          normalized = normalized.replace(/\/v1\/?$/, '') + '/v1/chat/completions';
        } else if (!pathname || pathname === '/') {
          normalized = normalized + '/v1/chat/completions';
        } else if (pathname === '/chat' || pathname === '/chat/') {
          normalized = normalized.replace(/\/chat\/?$/, '') + '/chat/completions';
        }
      } catch {
        // URL 解析失败，保持原样
      }
    }

    // 修正双斜杠
    normalized = normalized.replace(/([^:])\/\//g, '$1/');

    return normalized;
  }
}

/**
 * 模型编辑弹窗
 */
class ModelEditModal extends Modal {
  private providerId: string;
  private model: ModelConfig | null;
  private configManager: ConfigManager;
  private onSave: () => void;
  private isNew: boolean;

  constructor(
    app: App,
    configManager: ConfigManager,
    providerId: string,
    model: ModelConfig | null,
    onSave: () => void
  ) {
    super(app);
    this.configManager = configManager;
    this.providerId = providerId;
    this.model = model;
    this.onSave = onSave;
    this.isNew = !model;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // 设置弹窗宽度
    this.modalEl.setCssProps({
      width: '550px',
      'max-width': '90vw'
    });

    // 标题
    new Setting(contentEl)
      .setName(this.isNew ? t('modals.modelEdit.titleAdd') : t('modals.modelEdit.titleEdit'))
      .setHeading();

    // 表单数据
    const formData: {
      name: string;
      displayName: string;
      temperature: number;
      maxTokens: number;
      topP: number;
      apiFormat: APIFormat;
      reasoningEffort: ReasoningEffort;
      showReasoningSummary: boolean;
    } = {
      name: this.model?.name || '',
      displayName: this.model?.displayName || '',
      temperature: this.model?.temperature ?? 0.7,
      maxTokens: this.model?.maxTokens ?? 0,
      topP: this.model?.topP ?? 1.0,
      apiFormat: this.model?.apiFormat ?? 'chat-completions',
      reasoningEffort: this.model?.reasoningEffort ?? 'medium',
      showReasoningSummary: (this.model as any)?.showReasoningSummary ?? false
    };

    // 模型 ID（API 调用用）- 必填
    new Setting(contentEl)
      .setName(t('modals.modelEdit.name'))
      .setDesc(t('modals.modelEdit.nameDesc'))
      .addText(text => {
        text
          .setPlaceholder('gpt-4o, claude-3-sonnet, deepseek-chat')
          .setValue(formData.name)
          .onChange(value => {
            formData.name = value;
          });
        text.inputEl.setCssProps({ 'min-width': '200px' });
      });

    // 显示名称 - 可选
    new Setting(contentEl)
      .setName(t('modals.modelEdit.displayName'))
      .setDesc(t('modals.modelEdit.displayNameDesc'))
      .addText(text => {
        text
          .setPlaceholder(t('modals.modelEdit.displayNameDesc').includes('留空') ? '留空则使用模型 ID' : 'Leave empty to use Model ID')
          .setValue(formData.displayName)
          .onChange(value => {
            formData.displayName = value;
          });
        text.inputEl.setCssProps({ 'min-width': '200px' });
      });

    // API 格式选择器
    new Setting(contentEl)
      .setName(t('modals.modelEdit.apiFormat'))
      .setDesc(t('modals.modelEdit.apiFormatDesc'))
      .addDropdown(dropdown => dropdown
        .addOption('chat-completions', t('modals.modelEdit.apiFormatChatCompletions'))
        .addOption('responses', t('modals.modelEdit.apiFormatResponses'))
        .setValue(formData.apiFormat)
        .onChange((value: string) => {
          formData.apiFormat = value as APIFormat;
          // 根据 API 格式显示/隐藏推理配置选项
          updateReasoningVisibility(value === 'responses');
        }));

    // 推理深度选择器容器（条件显示）
    const reasoningContainer = contentEl.createDiv({ cls: 'reasoning-settings-container' });

    // 推理深度选择器
    new Setting(reasoningContainer)
      .setName(t('modals.modelEdit.reasoningEffort'))
      .setDesc(t('modals.modelEdit.reasoningEffortDesc'))
      .addDropdown(dropdown => dropdown
        .addOption('low', t('modals.modelEdit.reasoningEffortLow'))
        .addOption('medium', t('modals.modelEdit.reasoningEffortMedium'))
        .addOption('high', t('modals.modelEdit.reasoningEffortHigh'))
        .setValue(formData.reasoningEffort)
        .onChange((value: string) => {
          formData.reasoningEffort = value as ReasoningEffort;
        }));

    // 推理摘要显示开关
    new Setting(reasoningContainer)
      .setName(t('modals.modelEdit.showReasoningSummary'))
      .setDesc(t('modals.modelEdit.showReasoningSummaryDesc'))
      .addToggle(toggle => toggle
        .setValue(formData.showReasoningSummary)
        .onChange(value => {
          formData.showReasoningSummary = value;
        }));

    // 更新推理配置可见性的函数
    const updateReasoningVisibility = (show: boolean) => {
      reasoningContainer.setCssProps({
        display: show ? 'block' : 'none'
      });
    };

    // 初始化推理配置可见性
    updateReasoningVisibility(formData.apiFormat === 'responses');

    // Max Context Window (带节点的拖动条 + 输入框)
    // 节点值：0(无限制), 4K, 8K, 16K, 32K, 64K, 1M, 2M
    const contextWindowSteps = [0, 4096, 8192, 16384, 32768, 65536, 1048576, 2097152];
    const contextWindowLabels = ['0', '4K', '8K', '16K', '32K', '64K', '1M', '2M'];
    
    // 找到当前值对应的步骤索引
    const findClosestStepIndex = (value: number): number => {
      if (value <= 0) return 0;
      let closestIndex = 0;
      let minDiff = Math.abs(contextWindowSteps[0] - value);
      for (let i = 1; i < contextWindowSteps.length; i++) {
        const diff = Math.abs(contextWindowSteps[i] - value);
        if (diff < minDiff) {
          minDiff = diff;
          closestIndex = i;
        }
      }
      return closestIndex;
    };

    const maxTokensSetting = new Setting(contentEl)
      .setName(t('settingsDetails.general.maxTokens'))
      .setDesc(t('settingsDetails.general.maxTokensDesc'));

    // 创建自定义控件容器
    const controlContainer = maxTokensSetting.controlEl.createDiv({ cls: 'context-window-control' });
    controlContainer.setCssProps({
      display: 'flex',
      'align-items': 'center',
      gap: '12px',
      width: '100%'
    });

    // 滑块容器
    const sliderContainer = controlContainer.createDiv({ cls: 'slider-container' });
    sliderContainer.setCssProps({
      flex: '1',
      'min-width': '200px',
      display: 'flex',
      'flex-direction': 'column',
      gap: '4px'
    });

    // 滑块
    const contextSlider = sliderContainer.createEl('input', {
      type: 'range',
      cls: 'slider'
    });
    contextSlider.min = '0';
    contextSlider.max = String(contextWindowSteps.length - 1);
    contextSlider.value = String(findClosestStepIndex(formData.maxTokens));
    contextSlider.setCssProps({
      width: '100%'
    });

    // 刻度标签容器
    const ticksContainer = sliderContainer.createDiv({ cls: 'slider-ticks' });
    ticksContainer.setCssProps({
      display: 'flex',
      'justify-content': 'space-between',
      'font-size': '0.7em',
      color: 'var(--text-muted)',
      'padding': '0 2px'
    });

    // 添加刻度标签
    contextWindowLabels.forEach(label => {
      const tick = ticksContainer.createSpan();
      tick.setText(label);
    });

    // 输入框
    const contextInput = controlContainer.createEl('input', {
      type: 'text',
      cls: 'context-window-input'
    });
    contextInput.value = String(formData.maxTokens);
    contextInput.setCssProps({
      width: '70px',
      'text-align': 'center',
      padding: '4px 8px'
    });

    // 滑块变化时更新输入框和 formData
    contextSlider.addEventListener('input', () => {
      const stepIndex = parseInt(contextSlider.value);
      const value = contextWindowSteps[stepIndex];
      formData.maxTokens = value;
      contextInput.value = String(value);
    });

    // 输入框变化时更新滑块和 formData
    contextInput.addEventListener('change', () => {
      const numValue = parseInt(contextInput.value.trim());

      if (!isNaN(numValue) && numValue >= 0) {
        formData.maxTokens = numValue;
        contextSlider.value = String(findClosestStepIndex(numValue));
        contextInput.value = String(numValue);
      } else {
        // 恢复原值
        contextInput.value = String(formData.maxTokens);
      }
    });

    // Temperature
    new Setting(contentEl)
      .setName(t('settingsDetails.general.temperature'))
      .setDesc(t('settingsDetails.general.temperatureDesc'))
      .addSlider(slider => slider
        .setLimits(0, 2, 0.1)
        .setValue(formData.temperature)
        .setDynamicTooltip()
        .onChange(value => {
          formData.temperature = value;
        }));

    // Top P
    new Setting(contentEl)
      .setName(t('settingsDetails.general.topP'))
      .setDesc(t('settingsDetails.general.topPDesc'))
      .addSlider(slider => slider
        .setLimits(0, 1, 0.05)
        .setValue(formData.topP)
        .setDynamicTooltip()
        .onChange(value => {
          formData.topP = value;
        }));

    // 按钮容器
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    buttonContainer.setCssProps({
      display: 'flex',
      'justify-content': 'flex-end',
      gap: '8px',
      'margin-top': '16px'
    });

    // 取消按钮
    const cancelButton = buttonContainer.createEl('button', { text: t('common.cancel') });
    cancelButton.addEventListener('click', () => {
      this.close();
    });

    // 保存按钮
    const saveButton = buttonContainer.createEl('button', {
      text: t('common.save'),
      cls: 'mod-cta'
    });
    saveButton.addEventListener('click', async () => {
      try {
        if (!formData.name.trim()) {
          new Notice('❌ ' + t('modals.modelEdit.nameRequired'));
          return;
        }

        const displayName = formData.displayName.trim() || '';

        // 构建模型配置数据
        const modelData: Partial<ModelConfig> & { showReasoningSummary?: boolean } = {
          name: formData.name.trim(),
          displayName: displayName,
          temperature: formData.temperature,
          maxTokens: formData.maxTokens,
          topP: formData.topP,
          apiFormat: formData.apiFormat,
        };

        // 仅当使用 Responses API 时保存推理相关配置
        if (formData.apiFormat === 'responses') {
          modelData.reasoningEffort = formData.reasoningEffort;
          modelData.showReasoningSummary = formData.showReasoningSummary;
        }

        if (this.isNew) {
          // 创建新模型
          this.configManager.addModel(this.providerId, modelData as Omit<ModelConfig, 'id'>);
        } else if (this.model) {
          // 更新现有模型
          this.configManager.updateModel(this.providerId, this.model.id, modelData);
        }

        this.onSave();
        this.close();
      } catch (error) {
        new Notice('❌ ' + (error instanceof Error ? error.message : String(error)));
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * 模型选择弹窗
 * 支持分组显示、搜索和刷新功能
 */
class ModelSelectModal extends Modal {
  private availableModels: string[];
  private existingModels: string[];
  private onSelect: (selectedModels: string[]) => void;
  private onRefresh: () => Promise<string[]>;
  private selectedModels: Set<string> = new Set();
  private searchQuery: string = '';
  private collapsedGroups: Set<string> = new Set();
  private listContainer: HTMLElement | null = null;
  private activeFilter: 'all' | ModelType = 'all';

  constructor(
    app: App,
    availableModels: string[],
    existingModels: string[],
    onSelect: (selectedModels: string[]) => void,
    onRefresh: () => Promise<string[]>
  ) {
    super(app);
    this.availableModels = availableModels;
    this.existingModels = existingModels;
    this.onSelect = onSelect;
    this.onRefresh = onRefresh;
  }

  /**
   * 从模型 ID 提取分组名称
   * 例如: Qwen/Qwen2.5-72B -> Qwen, Pro/Qwen/Model -> Pro
   */
  private getGroupName(modelId: string): string {
    const parts = modelId.split('/');
    if (parts.length > 1) {
      return parts[0];
    }
    return t('modals.modelSelect.ungrouped');
  }

  /**
   * 将模型按分组组织
   */
  private groupModels(models: string[]): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    
    models.forEach(modelId => {
      const groupName = this.getGroupName(modelId);
      if (!groups.has(groupName)) {
        groups.set(groupName, []);
      }
      groups.get(groupName)!.push(modelId);
    });

    // 按分组名称排序
    return new Map([...groups.entries()].sort((a, b) => {
      // "其他" 分组放最后
      if (a[0] === t('modals.modelSelect.ungrouped')) return 1;
      if (b[0] === t('modals.modelSelect.ungrouped')) return -1;
      return a[0].localeCompare(b[0]);
    }));
  }

  /**
   * 过滤模型
   */
  private filterModels(models: string[]): string[] {
    // 先过滤已存在的模型
    let filtered = models.filter(m => !this.existingModels.includes(m));
    
    // 按类型筛选
    if (this.activeFilter !== 'all') {
      filtered = filtered.filter(m => {
        const { type } = inferModelInfo(m);
        return type === this.activeFilter;
      });
    }
    
    // 再按搜索词过滤
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(m => m.toLowerCase().includes(query));
    }
    
    return filtered;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('model-select-modal');

    // 设置弹窗尺寸
    this.modalEl.setCssProps({
      width: '550px',
      'max-width': '90vw',
      'max-height': '85vh'
    });

    // 头部：标题和刷新按钮
    const headerEl = contentEl.createDiv({ cls: 'modal-header' });
    headerEl.setCssProps({
      display: 'flex',
      'justify-content': 'space-between',
      'align-items': 'center',
      'margin-bottom': '12px'
    });

    const titleEl = headerEl.createDiv();
    titleEl.createEl('h3', { text: t('modals.modelSelect.title') });
    titleEl.setCssProps({ margin: '0' });

    // 刷新按钮
    const refreshBtn = headerEl.createEl('button', { cls: 'clickable-icon' });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.setAttribute('aria-label', t('modals.modelSelect.refresh'));
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.addClass('is-loading');
      setIcon(refreshBtn, 'loader');
      try {
        this.availableModels = await this.onRefresh();
        this.renderList();
      } finally {
        refreshBtn.removeClass('is-loading');
        setIcon(refreshBtn, 'refresh-cw');
      }
    });

    // 搜索框
    const searchContainer = contentEl.createDiv({ cls: 'search-container' });
    searchContainer.setCssProps({
      'margin-bottom': '12px'
    });

    const searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: t('modals.modelSelect.searchPlaceholder'),
      cls: 'model-search-input'
    });
    searchInput.setCssProps({
      width: '100%',
      padding: '8px 12px',
      'border-radius': '6px',
      border: '1px solid var(--background-modifier-border)',
      'background-color': 'var(--background-primary)',
      'font-size': '14px'
    });
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.renderList();
    });

    // 类型筛选标签
    const filterContainer = contentEl.createDiv({ cls: 'model-filter-container' });
    filterContainer.setCssProps({
      display: 'flex',
      gap: '8px',
      'margin-bottom': '12px',
      'flex-wrap': 'wrap'
    });

    // 筛选选项：全部 + 各类型
    const filterOptions: Array<'all' | ModelType> = ['all', 'chat', 'embedding', 'image', 'asr', 'tts'];
    
    filterOptions.forEach(filter => {
      const filterBtn = filterContainer.createEl('button', {
        cls: `model-filter-btn ${this.activeFilter === filter ? 'is-active' : ''}`,
        text: t(`modelTypes.${filter}`)
      });
      filterBtn.setCssProps({
        padding: '4px 12px',
        'border-radius': '16px',
        border: '1px solid var(--background-modifier-border)',
        'background-color': this.activeFilter === filter ? 'var(--interactive-accent)' : 'var(--background-primary)',
        color: this.activeFilter === filter ? 'var(--text-on-accent)' : 'var(--text-normal)',
        cursor: 'pointer',
        'font-size': '0.85em',
        transition: 'all 0.15s ease'
      });
      
      filterBtn.addEventListener('click', () => {
        this.activeFilter = filter;
        this.renderList();
        // 更新按钮样式
        filterContainer.querySelectorAll('.model-filter-btn').forEach(btn => {
          const btnEl = btn as HTMLElement;
          const isActive = btnEl.textContent === t(`modelTypes.${filter}`);
          btnEl.classList.toggle('is-active', isActive);
          btnEl.setCssProps({
            'background-color': isActive ? 'var(--interactive-accent)' : 'var(--background-primary)',
            color: isActive ? 'var(--text-on-accent)' : 'var(--text-normal)'
          });
        });
      });
    });

    // 模型数量提示
    const countEl = contentEl.createDiv({ cls: 'model-count' });
    countEl.setCssProps({
      'font-size': '0.85em',
      color: 'var(--text-muted)',
      'margin-bottom': '8px'
    });
    const newModels = this.availableModels.filter(m => !this.existingModels.includes(m));
    countEl.setText(t('modals.modelSelect.desc', { count: String(newModels.length) }));

    // 模型列表容器
    this.listContainer = contentEl.createDiv({ cls: 'model-select-list' });
    this.listContainer.setCssProps({
      'max-height': '400px',
      'overflow-y': 'auto',
      'margin-bottom': '16px',
      border: '1px solid var(--background-modifier-border)',
      'border-radius': '6px'
    });

    this.renderList();

    // 底部按钮
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    buttonContainer.setCssProps({
      display: 'flex',
      'justify-content': 'space-between',
      'align-items': 'center'
    });

    // 全选按钮
    const selectAllBtn = buttonContainer.createEl('button', { text: t('modals.modelSelect.selectAll') });
    selectAllBtn.addEventListener('click', () => {
      const filteredModels = this.filterModels(this.availableModels);
      const allSelected = filteredModels.every(m => this.selectedModels.has(m));
      
      if (allSelected) {
        filteredModels.forEach(m => this.selectedModels.delete(m));
      } else {
        filteredModels.forEach(m => this.selectedModels.add(m));
      }
      this.renderList();
    });

    // 右侧按钮
    const rightButtons = buttonContainer.createDiv();
    rightButtons.setCssProps({
      display: 'flex',
      gap: '8px'
    });

    const cancelButton = rightButtons.createEl('button', { text: t('common.cancel') });
    cancelButton.addEventListener('click', () => this.close());

    const confirmButton = rightButtons.createEl('button', {
      text: t('modals.modelSelect.addSelected'),
      cls: 'mod-cta'
    });
    confirmButton.addEventListener('click', () => {
      if (this.selectedModels.size > 0) {
        this.onSelect(Array.from(this.selectedModels));
      }
      this.close();
    });
  }

  /**
   * 渲染模型列表
   */
  private renderList(): void {
    if (!this.listContainer) return;
    this.listContainer.empty();

    const filteredModels = this.filterModels(this.availableModels);

    if (filteredModels.length === 0) {
      const emptyEl = this.listContainer.createDiv();
      emptyEl.setText(this.searchQuery ? t('modals.modelSelect.noResults') : t('modals.modelSelect.allExist'));
      emptyEl.setCssProps({
        padding: '20px',
        'text-align': 'center',
        color: 'var(--text-muted)'
      });
      return;
    }

    const groupedModels = this.groupModels(filteredModels);

    groupedModels.forEach((models, groupName) => {
      this.renderGroup(groupName, models);
    });
  }

  /**
   * 渲染分组
   */
  private renderGroup(groupName: string, models: string[]): void {
    if (!this.listContainer) return;

    const isCollapsed = this.collapsedGroups.has(groupName);
    const selectedInGroup = models.filter(m => this.selectedModels.has(m)).length;

    // 分组头部
    const groupHeader = this.listContainer.createDiv({ cls: 'model-group-header' });
    groupHeader.setCssProps({
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'space-between',
      padding: '8px 12px',
      'background-color': 'var(--background-secondary)',
      cursor: 'pointer',
      'border-bottom': '1px solid var(--background-modifier-border)',
      'user-select': 'none'
    });

    const leftPart = groupHeader.createDiv();
    leftPart.setCssProps({
      display: 'flex',
      'align-items': 'center',
      gap: '8px'
    });

    // 展开/收起图标
    const chevron = leftPart.createSpan({ cls: 'group-chevron' });
    setIcon(chevron, isCollapsed ? 'chevron-right' : 'chevron-down');
    chevron.setCssProps({
      width: '16px',
      height: '16px',
      color: 'var(--text-muted)'
    });

    // 分组名称
    const nameEl = leftPart.createSpan({ text: groupName });
    nameEl.setCssProps({
      'font-weight': '500'
    });

    // 数量标签
    const countBadge = leftPart.createSpan({ text: String(models.length) });
    countBadge.setCssProps({
      'font-size': '0.75em',
      color: 'var(--text-faint)',
      padding: '2px 6px',
      'background-color': 'var(--background-primary)',
      'border-radius': '10px'
    });

    // 分组全选按钮
    const groupSelectBtn = groupHeader.createEl('button', { cls: 'clickable-icon' });
    setIcon(groupSelectBtn, selectedInGroup === models.length ? 'check-square' : 'square');
    groupSelectBtn.setCssProps({
      padding: '4px'
    });
    groupSelectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const allSelected = models.every(m => this.selectedModels.has(m));
      if (allSelected) {
        models.forEach(m => this.selectedModels.delete(m));
      } else {
        models.forEach(m => this.selectedModels.add(m));
      }
      this.renderList();
    });

    // 点击头部切换展开/收起
    groupHeader.addEventListener('click', () => {
      if (isCollapsed) {
        this.collapsedGroups.delete(groupName);
      } else {
        this.collapsedGroups.add(groupName);
      }
      this.renderList();
    });

    // 模型列表（如果未收起）
    if (!isCollapsed) {
      models.forEach(modelId => {
        this.renderModelItem(modelId);
      });
    }
  }

  /**
   * 渲染单个模型项
   */
  private renderModelItem(modelId: string): void {
    if (!this.listContainer) return;

    const isSelected = this.selectedModels.has(modelId);

    const itemEl = this.listContainer.createDiv({ cls: 'model-select-item' });
    itemEl.setCssProps({
      display: 'flex',
      'align-items': 'center',
      padding: '8px 12px 8px 36px',
      'border-bottom': '1px solid var(--background-modifier-border)',
      cursor: 'pointer',
      'background-color': isSelected ? 'var(--background-modifier-hover)' : 'transparent'
    });

    // 复选框
    const checkbox = itemEl.createEl('input', { type: 'checkbox' });
    checkbox.checked = isSelected;
    checkbox.setCssProps({
      'margin-right': '10px'
    });

    // 模型名称
    const nameEl = itemEl.createSpan({ text: modelId });
    nameEl.setCssProps({
      flex: '1',
      'font-size': '0.9em'
    });

    // 类型和能力标签 - 使用推断的类型和能力
    const { type, abilities } = inferModelInfo(modelId);
    const tagsEl = itemEl.createSpan({ cls: 'model-type-tags' });
    tagsEl.setCssProps({
      display: 'flex',
      gap: '3px',
      'margin-left': '8px'
    });
    createModelTagGroup(tagsEl, type, abilities);

    // 点击整行切换选中状态
    const toggleSelection = () => {
      if (this.selectedModels.has(modelId)) {
        this.selectedModels.delete(modelId);
      } else {
        this.selectedModels.add(modelId);
      }
      this.renderList();
    };

    itemEl.addEventListener('click', (e) => {
      if (e.target !== checkbox) {
        toggleSelection();
      }
    });

    checkbox.addEventListener('change', toggleSelection);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * 测试连接模型选择弹窗
 */
class TestConnectionModal extends Modal {
  private provider: Provider;
  private onSelect: (modelId: string) => void;

  constructor(
    app: App,
    provider: Provider,
    onSelect: (modelId: string) => void
  ) {
    super(app);
    this.provider = provider;
    this.onSelect = onSelect;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.modalEl.setCssProps({
      width: '400px',
      'max-width': '90vw'
    });

    // 标题
    const titleEl = contentEl.createEl('h3', { text: t('modals.testConnection.title') });
    titleEl.setCssProps({ 'margin-top': '0' });

    // 描述
    const descEl = contentEl.createEl('p', { text: t('modals.testConnection.desc') });
    descEl.setCssProps({
      color: 'var(--text-muted)',
      'font-size': '0.9em',
      'margin-bottom': '16px'
    });

    // 模型列表
    const listEl = contentEl.createDiv({ cls: 'test-model-list' });
    listEl.setCssProps({
      'max-height': '300px',
      'overflow-y': 'auto',
      border: '1px solid var(--background-modifier-border)',
      'border-radius': '6px'
    });

    this.provider.models.forEach(model => {
      const itemEl = listEl.createDiv({ cls: 'test-model-item' });
      itemEl.setCssProps({
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        padding: '10px 12px',
        cursor: 'pointer',
        'border-bottom': '1px solid var(--background-modifier-border)'
      });

      // 悬停效果
      itemEl.addEventListener('mouseenter', () => {
        itemEl.setCssProps({ 'background-color': 'var(--background-modifier-hover)' });
      });
      itemEl.addEventListener('mouseleave', () => {
        itemEl.setCssProps({ 'background-color': 'transparent' });
      });

      // 模型名称
      const displayName = model.displayName || model.name;
      const nameEl = itemEl.createSpan({ text: displayName });
      nameEl.setCssProps({ 'font-weight': '500', flex: '1' });

      // 类型和能力标签 - 使用推断或显式配置的类型和能力
      const { type, abilities } = inferModelInfo(model.name, model.type, model.abilities);
      const tagsEl = itemEl.createSpan({ cls: 'model-type-tags' });
      tagsEl.setCssProps({
        display: 'flex',
        gap: '3px'
      });
      createModelTagGroup(tagsEl, type, abilities);

      // 点击选择
      itemEl.addEventListener('click', () => {
        this.onSelect(model.id);
        this.close();
      });
    });

    // 取消按钮
    const buttonContainer = contentEl.createDiv();
    buttonContainer.setCssProps({
      display: 'flex',
      'justify-content': 'flex-end',
      'margin-top': '16px'
    });

    const cancelBtn = buttonContainer.createEl('button', { text: t('common.cancel') });
    cancelBtn.addEventListener('click', () => this.close());
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * 设置标签页类
 * 提供插件配置界面
 */
export class SmartWorkflowSettingTab extends PluginSettingTab {
  plugin: SmartWorkflowPlugin;
  private activeTab = 'general';
  private expandedSections: Set<string> = new Set(); // 记录展开的功能区块
  private configManager: ConfigManager;

  constructor(app: App, plugin: SmartWorkflowPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.configManager = new ConfigManager(
      this.plugin.settings,
      () => this.plugin.saveSettings()
    );
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // 头部
    const headerEl = containerEl.createDiv({ cls: 'smart-workflow-settings-header' });
    
    // 标题行（包含标题和重载按钮）
    const titleRow = headerEl.createDiv({ cls: 'settings-title-row' });
    titleRow.setCssProps({
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'space-between',
      'margin-bottom': '0'
    });

    // 标题
    const titleEl = titleRow.createEl('h2', { text: 'Smart Workflow' });
    titleEl.setCssProps({
      margin: '0',
      'font-weight': '700'
    });

    // 重载按钮
    const reloadBtn = titleRow.createEl('button', { cls: 'clickable-icon' });
    setIcon(reloadBtn, 'refresh-cw');
    reloadBtn.setAttribute('aria-label', t('settings.header.reload'));
    reloadBtn.addEventListener('click', async () => {
      // 重载插件
      const pluginId = this.plugin.manifest.id;
      // @ts-expect-error - 访问 Obsidian 内部 API
      await this.app.plugins.disablePlugin(pluginId);
      // @ts-expect-error - 访问 Obsidian 内部 API
      await this.app.plugins.enablePlugin(pluginId);
      // 重新打开设置页面并选中 Smart Workflow
      // @ts-expect-error - 访问 Obsidian 内部 API
      this.app.setting.openTabById(pluginId);
    });

    // GitHub Feedback Link
    const feedbackContainer = headerEl.createDiv({ cls: 'setting-item-description' });
    feedbackContainer.setCssProps({
      'margin-bottom': '10px'
    });
    feedbackContainer.appendText(t('settings.header.feedbackText'));
    feedbackContainer.createEl('a', {
      text: t('settings.header.feedbackLink'),
      href: 'https://github.com/ZyphrZero/obsidian-smart-workflow'
    });

    // 标签页导航
    const tabsEl = containerEl.createDiv({ cls: 'smart-workflow-tabs' });

    getSettingTabs().forEach(tab => {
      const tabEl = tabsEl.createEl('div', {
        cls: 'smart-workflow-tab'
      });

      if (tab.id === this.activeTab) {
        tabEl.addClass('active');
      }

      // 使用 Obsidian 原生图标
      setIcon(tabEl, tab.icon);

      // 文本
      tabEl.createSpan({
        text: tab.name
      });

      // 点击事件
      tabEl.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.display();
      });
    });

    // 内容区域
    const contentEl = containerEl.createDiv({ cls: 'smart-workflow-content' });

    // 根据当前标签页显示不同内容
    switch (this.activeTab) {
      case 'general':
        this.renderGeneralSettings(contentEl);
        break;
      case 'naming':
        this.renderNamingSettings(contentEl);
        break;
      case 'terminal':
        this.renderTerminalSettings(contentEl);
        break;
      case 'advanced':
        this.renderAdvancedSettings(contentEl);
        break;
    }
  }

  /**
   * 创建卡片式设置容器
   */
  private createSettingCard(containerEl: HTMLElement): HTMLElement {
    const card = containerEl.createDiv();
    card.style.padding = '16px';
    card.style.borderRadius = '8px';
    card.style.backgroundColor = 'var(--background-secondary)';
    card.style.marginBottom = '10px';
    return card;
  }

  /**
   * 渲染常规设置（供应商管理 + 模型管理 + 功能绑定）
   * 使用新的多供应商配置结构
   */
  private renderGeneralSettings(containerEl: HTMLElement): void {
    // 刷新 ConfigManager 实例以确保使用最新设置
    this.configManager = new ConfigManager(
      this.plugin.settings,
      () => this.plugin.saveSettings()
    );

    // ========== 供应商管理区域 ==========
    this.renderProviderManagement(containerEl);

    // ========== 功能绑定区域 ==========
    this.renderFeatureBindings(containerEl);
  }

  /**
   * 渲染功能绑定区域
   */
  private renderFeatureBindings(containerEl: HTMLElement): void {
    const bindingCard = this.createSettingCard(containerEl);

    new Setting(bindingCard)
      .setName(t('settingsDetails.general.featureBindings'))
      .setDesc(t('settingsDetails.general.featureBindingsDesc'))
      .setHeading();

    // 获取当前 naming 功能的解析配置
    const resolvedConfig = this.configManager.resolveFeatureConfig('naming');
    const currentProvider = resolvedConfig?.provider;
    const currentModel = resolvedConfig?.model;

    // Naming 功能绑定
    const namingSetting = new Setting(bindingCard)
      .setName(t('settingsDetails.general.namingFeature'))
      .setDesc(t('settingsDetails.general.namingFeatureDesc'));

    // 使用自定义 select 元素支持 optgroup
    namingSetting.addDropdown(dropdown => {
      const selectEl = dropdown.selectEl;
      selectEl.empty();

      // 按供应商分组添加选项
      const providers = this.configManager.getProviders();
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
      if (currentValue) {
        dropdown.setValue(currentValue);
      }

      // 监听变化
      dropdown.onChange(async (value) => {
        const [providerId, modelId] = value.split('|');
        const namingBinding = this.plugin.settings.featureBindings.naming;
        if (namingBinding) {
          this.configManager.setFeatureBinding('naming', {
            ...namingBinding,
            providerId,
            modelId
          });
        }
        await this.plugin.saveSettings();
        // 刷新视图以更新绑定状态显示
        this.display();
      });
    });

    // 显示当前绑定状态
    if (currentProvider && currentModel) {
      const displayName = currentModel.displayName || currentModel.name;
      const statusEl = bindingCard.createDiv({ cls: 'feature-binding-status' });
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
    const providerCard = this.createSettingCard(containerEl);

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
            this.app,
            this.configManager,
            null,
            async () => {
              await this.plugin.saveSettings();
              this.display();
            }
          );
          modal.open();
        }));

    // 供应商列表
    const providers = this.configManager.getProviders();
    
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
    const shortEndpoint = this.shortenEndpoint(provider.endpoint);
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
        this.display();
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
        this.app,
        this.configManager,
        provider.id,
        null,
        async () => {
          await this.plugin.saveSettings();
          this.display();
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
        this.app,
        this.configManager,
        provider,
        async () => {
          await this.plugin.saveSettings();
          this.display();
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
        this.app,
        provider.name,
        async () => {
          try {
            this.configManager.deleteProvider(provider.id);
            await this.plugin.saveSettings();
            new Notice('✅ ' + t('notices.configDeleted'));
            this.display();
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
      contextEl.setText(this.formatContextLength(model.contextLength));
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
        this.app,
        this.configManager,
        provider.id,
        model,
        async () => {
          await this.plugin.saveSettings();
          this.display();
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
        this.configManager.deleteModel(provider.id, model.id);
        await this.plugin.saveSettings();
        this.display();
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
      this.app,
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
      await this.plugin.aiService.testConnection(provider.id, modelId);
      new Notice('✅ ' + t('notices.connectionSuccess'));
    } catch (error) {
      new Notice('❌ ' + t('notices.connectionFailed', { 
        message: error instanceof Error ? error.message : String(error) 
      }));
    }
  }

  /**
   * 渲染命名设置
   */
  private renderNamingSettings(containerEl: HTMLElement): void {
    // 获取当前 naming 功能的绑定配置
    const namingBinding = this.plugin.settings.featureBindings.naming;

    if (!namingBinding) {
      return;
    }

    // AI 命名功能区块（可折叠）
    const isNamingExpanded = this.expandedSections.has('naming-feature');
    
    // 功能卡片
    const namingCard = this.createSettingCard(containerEl);
    
    // 可折叠标题
    const headerEl = namingCard.createDiv({ cls: 'feature-header' });
    headerEl.setCssProps({
      display: 'flex',
      'align-items': 'center',
      gap: '8px',
      cursor: 'pointer',
      'user-select': 'none',
      'margin-bottom': isNamingExpanded ? '12px' : '0'
    });

    // 展开/收缩图标
    const chevronEl = headerEl.createSpan({ cls: 'feature-chevron' });
    setIcon(chevronEl, isNamingExpanded ? 'chevron-down' : 'chevron-right');
    chevronEl.setCssProps({
      width: '18px',
      height: '18px',
      display: 'inline-flex',
      'align-items': 'center'
    });

    // 功能名称
    const titleEl = headerEl.createSpan({ text: t('settingsDetails.general.namingFeature') });
    titleEl.setCssProps({
      'font-weight': '600',
      'font-size': '1em'
    });

    // 点击切换展开状态
    headerEl.addEventListener('click', () => {
      if (isNamingExpanded) {
        this.expandedSections.delete('naming-feature');
      } else {
        this.expandedSections.add('naming-feature');
      }
      this.display();
    });

    // 如果未展开，不渲染内容
    if (!isNamingExpanded) {
      return;
    }

    // 内容容器
    const contentEl = namingCard.createDiv({ cls: 'feature-content' });

    // 命名行为设置
    new Setting(contentEl)
      .setName(t('settingsDetails.naming.namingBehavior'))
      .setHeading();

    // 使用当前文件名上下文
    new Setting(contentEl)
      .setName(t('settingsDetails.naming.useCurrentFilename'))
      .setDesc(t('settingsDetails.naming.useCurrentFilenameDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useCurrentFileNameContext)
        .onChange(async (value) => {
          this.plugin.settings.useCurrentFileNameContext = value;
          await this.plugin.saveSettings();
        }));

    // 分析目录命名风格
    new Setting(contentEl)
      .setName(t('settingsDetails.naming.analyzeDirectory'))
      .setDesc(t('settingsDetails.naming.analyzeDirectoryDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.analyzeDirectoryNamingStyle)
        .onChange(async (value) => {
          this.plugin.settings.analyzeDirectoryNamingStyle = value;
          await this.plugin.saveSettings();
        }));

    // Prompt 模板设置
    new Setting(contentEl)
      .setName(t('settingsDetails.naming.promptTemplate'))
      .setHeading();

    const promptDesc = contentEl.createEl('div', { cls: 'setting-item-description' });
    promptDesc.setCssProps({ 'margin-bottom': '12px' });
    promptDesc.appendText(t('settingsDetails.naming.promptTemplateDesc'));
    promptDesc.createEl('br');
    promptDesc.appendText('• ');
    promptDesc.createEl('code', { text: '{{content}}' });
    promptDesc.appendText(' - ' + t('settingsDetails.naming.promptVariables.content').replace('{{content}} - ', ''));
    promptDesc.createEl('br');
    promptDesc.appendText('• ');
    promptDesc.createEl('code', { text: '{{currentFileName}}' });
    promptDesc.appendText(' - ' + t('settingsDetails.naming.promptVariables.currentFileName').replace('{{currentFileName}} - ', ''));
    promptDesc.createEl('br');
    promptDesc.appendText('• ');
    promptDesc.createEl('code', { text: '{{#if currentFileName}}...{{/if}}' });
    promptDesc.appendText(' - ' + t('settingsDetails.naming.promptVariables.conditionalBlock').replace('{{#if currentFileName}}...{{/if}} - ', ''));

    // 当前使用的模板编辑器
    new Setting(contentEl)
      .setName(t('settingsDetails.naming.currentPromptTemplate'))
      .setDesc(t('settingsDetails.naming.currentPromptTemplateDesc'))
      .setHeading();

    new Setting(contentEl)
      .addTextArea(text => {
        text
          .setValue(namingBinding.promptTemplate)
          .onChange(async (value) => {
            namingBinding.promptTemplate = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 10;
        text.inputEl.cols = 50;
        text.inputEl.style.width = '100%';
      });

    // 重置按钮
    new Setting(contentEl)
      .setName(t('settingsDetails.naming.quickReset'))
      .setDesc(t('settingsDetails.naming.quickResetDesc'))
      .addButton(button => button
        .setButtonText(t('settingsDetails.naming.resetToRecommended'))
        .onClick(async () => {
          // 根据设置选择对应的模板
          if (this.plugin.settings.useCurrentFileNameContext) {
            // 使用高级模板
            namingBinding.promptTemplate = ADVANCED_PROMPT_TEMPLATE;
          } else {
            // 使用基础模板
            namingBinding.promptTemplate = BASE_PROMPT_TEMPLATE;
          }
          await this.plugin.saveSettings();
          this.display();
        }));
  }

  /**
   * 渲染终端设置
   */
  private renderTerminalSettings(containerEl: HTMLElement): void {
    // 架构选择卡片
    // Shell 程序设置卡片
    const shellCard = this.createSettingCard(containerEl);

    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.shellSettings'))
      .setHeading();

    // 默认 Shell 程序选择
    const currentShell = getCurrentPlatformShell(this.plugin.settings.terminal);
    
    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.defaultShell'))
      .setDesc(t('settingsDetails.terminal.defaultShellDesc'))
      .addDropdown(dropdown => {
        // 根据平台显示不同的选项
        if (process.platform === 'win32') {
          dropdown.addOption('cmd', t('shellOptions.cmd'));
          dropdown.addOption('powershell', t('shellOptions.powershell'));
          dropdown.addOption('gitbash', t('shellOptions.gitbash'));
          dropdown.addOption('wsl', t('shellOptions.wsl'));
        } else if (process.platform === 'darwin' || process.platform === 'linux') {
          dropdown.addOption('bash', t('shellOptions.bash'));
          dropdown.addOption('zsh', t('shellOptions.zsh'));
        }
        dropdown.addOption('custom', t('shellOptions.custom'));

        dropdown.setValue(currentShell);
        dropdown.onChange(async (value) => {
          setCurrentPlatformShell(this.plugin.settings.terminal, value as ShellType);
          await this.plugin.saveSettings();
          this.display(); // 重新渲染以显示/隐藏自定义路径输入框
        });
      });

    // 自定义程序路径（仅在选择 custom 时显示）
    if (currentShell === 'custom') {
      const currentCustomPath = getCurrentPlatformCustomShellPath(this.plugin.settings.terminal);
      
      new Setting(shellCard)
        .setName(t('settingsDetails.terminal.customShellPath'))
        .setDesc(t('settingsDetails.terminal.customShellPathDesc'))
        .addText(text => {
          text
            .setPlaceholder(t('settingsDetails.terminal.customShellPathPlaceholder'))
            .setValue(currentCustomPath)
            .onChange(async (value) => {
              setCurrentPlatformCustomShellPath(this.plugin.settings.terminal, value);
              await this.plugin.saveSettings();
              
              // 验证路径
              this.validateCustomShellPath(shellCard, value);
            });
          
          // 初始验证
          setTimeout(() => {
            this.validateCustomShellPath(shellCard, currentCustomPath);
          }, 0);
          
          return text;
        });
    }

    // 默认启动参数
    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.defaultArgs'))
      .setDesc(t('settingsDetails.terminal.defaultArgsDesc'))
      .addText(text => text
        .setPlaceholder(t('settingsDetails.terminal.defaultArgsPlaceholder'))
        .setValue(this.plugin.settings.terminal.shellArgs.join(' '))
        .onChange(async (value) => {
          // 将字符串分割为数组，过滤空字符串
          this.plugin.settings.terminal.shellArgs = value
            .split(' ')
            .filter(arg => arg.trim().length > 0);
          await this.plugin.saveSettings();
        }));

    // 自动进入项目目录
    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.autoEnterVault'))
      .setDesc(t('settingsDetails.terminal.autoEnterVaultDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.terminal.autoEnterVaultDirectory)
        .onChange(async (value) => {
          this.plugin.settings.terminal.autoEnterVaultDirectory = value;
          await this.plugin.saveSettings();
        }));

    // 实例行为设置卡片
    const instanceCard = this.createSettingCard(containerEl);

    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.instanceBehavior'))
      .setHeading();

    // 新实例行为
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.newInstanceLayout'))
      .setDesc(t('settingsDetails.terminal.newInstanceLayoutDesc'))
      .addDropdown(dropdown => {
        dropdown.addOption('replaceTab', t('layoutOptions.replaceTab'));
        dropdown.addOption('newTab', t('layoutOptions.newTab'));
        dropdown.addOption('newLeftTab', t('layoutOptions.newLeftTab'));
        dropdown.addOption('newLeftSplit', t('layoutOptions.newLeftSplit'));
        dropdown.addOption('newRightTab', t('layoutOptions.newRightTab'));
        dropdown.addOption('newRightSplit', t('layoutOptions.newRightSplit'));
        dropdown.addOption('newHorizontalSplit', t('layoutOptions.newHorizontalSplit'));
        dropdown.addOption('newVerticalSplit', t('layoutOptions.newVerticalSplit'));
        dropdown.addOption('newWindow', t('layoutOptions.newWindow'));

        dropdown.setValue(this.plugin.settings.terminal.newInstanceBehavior);
        dropdown.onChange(async (value) => {
          this.plugin.settings.terminal.newInstanceBehavior = value as any;
          await this.plugin.saveSettings();
        });
      });

    // 在现有终端附近创建
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.createNearExisting'))
      .setDesc(t('settingsDetails.terminal.createNearExistingDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.terminal.createInstanceNearExistingOnes)
        .onChange(async (value) => {
          this.plugin.settings.terminal.createInstanceNearExistingOnes = value;
          await this.plugin.saveSettings();
        }));

    // 聚焦新实例
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.focusNewInstance'))
      .setDesc(t('settingsDetails.terminal.focusNewInstanceDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.terminal.focusNewInstance)
        .onChange(async (value) => {
          this.plugin.settings.terminal.focusNewInstance = value;
          await this.plugin.saveSettings();
        }));

    // 锁定新实例
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.lockNewInstance'))
      .setDesc(t('settingsDetails.terminal.lockNewInstanceDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.terminal.lockNewInstance)
        .onChange(async (value) => {
          this.plugin.settings.terminal.lockNewInstance = value;
          await this.plugin.saveSettings();
        }));

    // 主题设置卡片
    const themeCard = this.createSettingCard(containerEl);

    new Setting(themeCard)
      .setName(t('settingsDetails.terminal.themeSettings'))
      .setHeading();

    // 使用 Obsidian 主题
    new Setting(themeCard)
      .setName(t('settingsDetails.terminal.useObsidianTheme'))
      .setDesc(t('settingsDetails.terminal.useObsidianThemeDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.terminal.useObsidianTheme)
        .onChange(async (value) => {
          this.plugin.settings.terminal.useObsidianTheme = value;
          await this.plugin.saveSettings();
          this.display(); // 重新渲染以显示/隐藏自定义颜色设置
        }));

    // 自定义颜色设置（仅在不使用 Obsidian 主题时显示）
    if (!this.plugin.settings.terminal.useObsidianTheme) {
      // 背景色
      new Setting(themeCard)
        .setName(t('settingsDetails.terminal.backgroundColor'))
        .setDesc(t('settingsDetails.terminal.backgroundColorDesc'))
        .addColorPicker(color => color
          .setValue(this.plugin.settings.terminal.backgroundColor || '#000000')
          .onChange(async (value) => {
            this.plugin.settings.terminal.backgroundColor = value;
            await this.plugin.saveSettings();
          }))
        .addExtraButton(button => button
          .setIcon('reset')
          .setTooltip(t('common.reset'))
          .onClick(async () => {
            this.plugin.settings.terminal.backgroundColor = undefined;
            await this.plugin.saveSettings();
            this.display(); // 刷新设置面板
            new Notice(t('notices.settings.backgroundColorReset'));
          }));

      // 前景色
      new Setting(themeCard)
        .setName(t('settingsDetails.terminal.foregroundColor'))
        .setDesc(t('settingsDetails.terminal.foregroundColorDesc'))
        .addColorPicker(color => color
          .setValue(this.plugin.settings.terminal.foregroundColor || '#FFFFFF')
          .onChange(async (value) => {
            this.plugin.settings.terminal.foregroundColor = value;
            await this.plugin.saveSettings();
          }))
        .addExtraButton(button => button
          .setIcon('reset')
          .setTooltip(t('common.reset'))
          .onClick(async () => {
            this.plugin.settings.terminal.foregroundColor = undefined;
            await this.plugin.saveSettings();
            this.display(); // 刷新设置面板
            new Notice(t('notices.settings.foregroundColorReset'));
          }));

      // 背景图片设置（仅 Canvas 渲染器支持）
      if (this.plugin.settings.terminal.preferredRenderer === 'canvas') {
        const bgImageSetting = new Setting(themeCard)
          .setName(t('settingsDetails.terminal.backgroundImage'))
          .setDesc(t('settingsDetails.terminal.backgroundImageDesc'));
        
        bgImageSetting.addText(text => {
          const inputEl = text
            .setPlaceholder(t('settingsDetails.terminal.backgroundImagePlaceholder'))
            .setValue(this.plugin.settings.terminal.backgroundImage || '')
            .onChange(async (value) => {
              // 只保存，不刷新
              this.plugin.settings.terminal.backgroundImage = value || undefined;
              await this.plugin.saveSettings();
            });
          
          // 失去焦点时刷新界面
          text.inputEl.addEventListener('blur', () => {
            this.display();
          });
          
          return inputEl;
        });
        
        bgImageSetting.addExtraButton(button => button
          .setIcon('reset')
          .setTooltip(t('common.reset'))
          .onClick(async () => {
            this.plugin.settings.terminal.backgroundImage = undefined;
            await this.plugin.saveSettings();
            this.display();
            new Notice(t('notices.settings.backgroundImageCleared'));
          }));

        // 背景图片透明度
        if (this.plugin.settings.terminal.backgroundImage) {
          new Setting(themeCard)
            .setName(t('settingsDetails.terminal.backgroundImageOpacity'))
            .setDesc(t('settingsDetails.terminal.backgroundImageOpacityDesc'))
            .addSlider(slider => slider
              .setLimits(0, 1, 0.05)
              .setValue(this.plugin.settings.terminal.backgroundImageOpacity ?? 0.5)
              .setDynamicTooltip()
              .onChange(async (value) => {
                this.plugin.settings.terminal.backgroundImageOpacity = value;
                await this.plugin.saveSettings();
              }));

          // 背景图片大小
          new Setting(themeCard)
            .setName(t('settingsDetails.terminal.backgroundImageSize'))
            .setDesc(t('settingsDetails.terminal.backgroundImageSizeDesc'))
            .addDropdown(dropdown => dropdown
              .addOption('cover', t('backgroundSizeOptions.cover'))
              .addOption('contain', t('backgroundSizeOptions.contain'))
              .addOption('auto', t('backgroundSizeOptions.auto'))
              .setValue(this.plugin.settings.terminal.backgroundImageSize || 'cover')
              .onChange(async (value: 'cover' | 'contain' | 'auto') => {
                this.plugin.settings.terminal.backgroundImageSize = value;
                await this.plugin.saveSettings();
              }));

          // 背景图片位置
          new Setting(themeCard)
            .setName(t('settingsDetails.terminal.backgroundImagePosition'))
            .setDesc(t('settingsDetails.terminal.backgroundImagePositionDesc'))
            .addDropdown(dropdown => dropdown
              .addOption('center', t('backgroundPositionOptions.center'))
              .addOption('top', t('backgroundPositionOptions.top'))
              .addOption('bottom', t('backgroundPositionOptions.bottom'))
              .addOption('left', t('backgroundPositionOptions.left'))
              .addOption('right', t('backgroundPositionOptions.right'))
              .addOption('top left', t('backgroundPositionOptions.topLeft'))
              .addOption('top right', t('backgroundPositionOptions.topRight'))
              .addOption('bottom left', t('backgroundPositionOptions.bottomLeft'))
              .addOption('bottom right', t('backgroundPositionOptions.bottomRight'))
              .setValue(this.plugin.settings.terminal.backgroundImagePosition || 'center')
              .onChange(async (value) => {
                this.plugin.settings.terminal.backgroundImagePosition = value;
                await this.plugin.saveSettings();
              }));

          // 毛玻璃效果
          new Setting(themeCard)
            .setName(t('settingsDetails.terminal.blurEffect'))
            .setDesc(t('settingsDetails.terminal.blurEffectDesc'))
            .addToggle(toggle => toggle
              .setValue(this.plugin.settings.terminal.enableBlur ?? false)
              .onChange(async (value) => {
                this.plugin.settings.terminal.enableBlur = value;
                await this.plugin.saveSettings();
                this.display(); // 刷新以显示/隐藏模糊程度滑块
              }));

          // 毛玻璃模糊程度
          if (this.plugin.settings.terminal.enableBlur) {
            new Setting(themeCard)
              .setName(t('settingsDetails.terminal.blurAmount'))
              .setDesc(t('settingsDetails.terminal.blurAmountDesc'))
              .addSlider(slider => slider
                .setLimits(0, 20, 1)
                .setValue(this.plugin.settings.terminal.blurAmount ?? 10)
                .setDynamicTooltip()
                .onChange(async (value) => {
                  this.plugin.settings.terminal.blurAmount = value;
                  await this.plugin.saveSettings();
                }));
          }

          // 文本透明度
          new Setting(themeCard)
            .setName(t('settingsDetails.terminal.textOpacity'))
            .setDesc(t('settingsDetails.terminal.textOpacityDesc'))
            .addSlider(slider => slider
              .setLimits(0, 1, 0.05)
              .setValue(this.plugin.settings.terminal.textOpacity ?? 1.0)
              .setDynamicTooltip()
              .onChange(async (value) => {
                this.plugin.settings.terminal.textOpacity = value;
                await this.plugin.saveSettings();
              }));
        }
      }
    }

    // 外观设置卡片
    const appearanceCard = this.createSettingCard(containerEl);

    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.appearanceSettings'))
      .setHeading();

    // 字体大小
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.fontSize'))
      .setDesc(t('settingsDetails.terminal.fontSizeDesc'))
      .addSlider(slider => slider
        .setLimits(8, 24, 1)
        .setValue(this.plugin.settings.terminal.fontSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.terminal.fontSize = value;
          await this.plugin.saveSettings();
        }));

    // 字体族
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.fontFamily'))
      .setDesc(t('settingsDetails.terminal.fontFamilyDesc'))
      .addText(text => text
        .setPlaceholder(t('settingsDetails.terminal.fontFamilyPlaceholder'))
        .setValue(this.plugin.settings.terminal.fontFamily)
        .onChange(async (value) => {
          this.plugin.settings.terminal.fontFamily = value;
          await this.plugin.saveSettings();
        }));

    // 光标样式
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.cursorStyle'))
      .setDesc(t('settingsDetails.terminal.cursorStyleDesc'))
      .addDropdown(dropdown => {
        dropdown.addOption('block', t('cursorStyleOptions.block'));
        dropdown.addOption('underline', t('cursorStyleOptions.underline'));
        dropdown.addOption('bar', t('cursorStyleOptions.bar'));

        dropdown.setValue(this.plugin.settings.terminal.cursorStyle);
        dropdown.onChange(async (value) => {
          this.plugin.settings.terminal.cursorStyle = value as any;
          await this.plugin.saveSettings();
        });
      });

    // 光标闪烁
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.cursorBlink'))
      .setDesc(t('settingsDetails.terminal.cursorBlinkDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.terminal.cursorBlink)
        .onChange(async (value) => {
          this.plugin.settings.terminal.cursorBlink = value;
          await this.plugin.saveSettings();
        }));

    // 渲染器类型
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.rendererType'))
      .setDesc(t('settingsDetails.terminal.rendererTypeDesc'))
      .addDropdown(dropdown => dropdown
        .addOption('canvas', t('rendererOptions.canvas'))
        .addOption('webgl', t('rendererOptions.webgl'))
        .setValue(this.plugin.settings.terminal.preferredRenderer)
        .onChange(async (value: 'canvas' | 'webgl') => {
          this.plugin.settings.terminal.preferredRenderer = value;
          await this.plugin.saveSettings();
          this.display(); // 刷新设置页面以显示/隐藏背景图片选项
          new Notice(t('notices.settings.rendererUpdated'));
        }));

    // 行为设置卡片
    const behaviorCard = this.createSettingCard(containerEl);

    new Setting(behaviorCard)
      .setName(t('settingsDetails.terminal.behaviorSettings'))
      .setHeading();

    // 滚动缓冲区大小
    const scrollbackSetting = new Setting(behaviorCard)
      .setName(t('settingsDetails.terminal.scrollback'))
      .setDesc(t('settingsDetails.terminal.scrollbackDesc'));
    
    scrollbackSetting.addText(text => {
      const inputEl = text
        .setPlaceholder('1000')
        .setValue(String(this.plugin.settings.terminal.scrollback))
        .onChange(async (value) => {
          // 只在输入时保存，不验证
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            this.plugin.settings.terminal.scrollback = numValue;
            await this.plugin.saveSettings();
          }
        });
      
      // 失去焦点时验证
      text.inputEl.addEventListener('blur', async () => {
        const value = text.inputEl.value;
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 100 || numValue > 10000) {
          new Notice('⚠️ ' + t('notices.settings.scrollbackRangeError'));
          this.plugin.settings.terminal.scrollback = 1000;
          await this.plugin.saveSettings();
          text.setValue('1000');
        }
      });
      
      return inputEl;
    });

    // 终端面板默认高度
    const defaultHeightSetting = new Setting(behaviorCard)
      .setName(t('settingsDetails.terminal.defaultHeight'))
      .setDesc(t('settingsDetails.terminal.defaultHeightDesc'));
    
    defaultHeightSetting.addText(text => {
      const inputEl = text
        .setPlaceholder('300')
        .setValue(String(this.plugin.settings.terminal.defaultHeight))
        .onChange(async (value) => {
          // 只在输入时保存，不验证
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            this.plugin.settings.terminal.defaultHeight = numValue;
            await this.plugin.saveSettings();
          }
        });
      
      // 失去焦点时验证
      text.inputEl.addEventListener('blur', async () => {
        const value = text.inputEl.value;
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 100 || numValue > 1000) {
          new Notice('⚠️ ' + t('notices.settings.heightRangeError'));
          this.plugin.settings.terminal.defaultHeight = 300;
          await this.plugin.saveSettings();
          text.setValue('300');
        }
      });
      
      return inputEl;
    });
  }

  /**
   * 渲染选中工具栏设置
   * Requirements: 4.1, 4.2, 4.3, 4.4
   */
  private renderSelectionToolbarSettings(containerEl: HTMLElement): void {
    const toolbarCard = this.createSettingCard(containerEl);

    new Setting(toolbarCard)
      .setName(t('selectionToolbar.settings.title'))
      .setDesc(t('selectionToolbar.settings.titleDesc'))
      .setHeading();

    // 启用/禁用开关 - Requirements: 4.1
    new Setting(toolbarCard)
      .setName(t('selectionToolbar.settings.enabled'))
      .setDesc(t('selectionToolbar.settings.enabledDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.selectionToolbar.enabled)
        .onChange(async (value) => {
          this.plugin.settings.selectionToolbar.enabled = value;
          await this.plugin.saveSettings();
          // 通知 SelectionToolbarManager 更新设置
          this.plugin.updateSelectionToolbarSettings();
        }));

    // 最小选中字符数 - Requirements: 4.3
    const minLengthSetting = new Setting(toolbarCard)
      .setName(t('selectionToolbar.settings.minSelectionLength'))
      .setDesc(t('selectionToolbar.settings.minSelectionLengthDesc'));
    
    minLengthSetting.addText(text => {
      const inputEl = text
        .setPlaceholder('1')
        .setValue(String(this.plugin.settings.selectionToolbar.minSelectionLength))
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            // 范围约束：1-100
            const clampedValue = Math.max(1, Math.min(100, numValue));
            this.plugin.settings.selectionToolbar.minSelectionLength = clampedValue;
            await this.plugin.saveSettings();
            this.plugin.updateSelectionToolbarSettings();
          }
        });
      
      // 失去焦点时验证并修正
      text.inputEl.addEventListener('blur', async () => {
        const value = text.inputEl.value;
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 1 || numValue > 100) {
          // 恢复到有效范围
          const clampedValue = isNaN(numValue) ? 1 : Math.max(1, Math.min(100, numValue));
          this.plugin.settings.selectionToolbar.minSelectionLength = clampedValue;
          await this.plugin.saveSettings();
          text.setValue(String(clampedValue));
          this.plugin.updateSelectionToolbarSettings();
        }
      });
      
      text.inputEl.setCssProps({ width: '60px' });
      return inputEl;
    });

    // 显示延迟 - Requirements: 4.4
    const showDelaySetting = new Setting(toolbarCard)
      .setName(t('selectionToolbar.settings.showDelay'))
      .setDesc(t('selectionToolbar.settings.showDelayDesc'));
    
    showDelaySetting.addText(text => {
      const inputEl = text
        .setPlaceholder('0')
        .setValue(String(this.plugin.settings.selectionToolbar.showDelay))
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            // 范围约束：0-1000
            const clampedValue = Math.max(0, Math.min(1000, numValue));
            this.plugin.settings.selectionToolbar.showDelay = clampedValue;
            await this.plugin.saveSettings();
            this.plugin.updateSelectionToolbarSettings();
          }
        });
      
      // 失去焦点时验证并修正
      text.inputEl.addEventListener('blur', async () => {
        const value = text.inputEl.value;
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 0 || numValue > 1000) {
          // 恢复到有效范围
          const clampedValue = isNaN(numValue) ? 0 : Math.max(0, Math.min(1000, numValue));
          this.plugin.settings.selectionToolbar.showDelay = clampedValue;
          await this.plugin.saveSettings();
          text.setValue(String(clampedValue));
          this.plugin.updateSelectionToolbarSettings();
        }
      });
      
      text.inputEl.setCssProps({ width: '60px' });
      return inputEl;
    });

    // 按钮显隐设置 - Requirements: 4.2
    new Setting(toolbarCard)
      .setName(t('selectionToolbar.settings.actionsTitle'))
      .setDesc(t('selectionToolbar.settings.actionsDesc'))
      .setHeading();

    // 复制按钮
    new Setting(toolbarCard)
      .setName(t('selectionToolbar.settings.actionCopy'))
      .setDesc(t('selectionToolbar.settings.actionCopyDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.selectionToolbar.actions.copy)
        .onChange(async (value) => {
          this.plugin.settings.selectionToolbar.actions.copy = value;
          await this.plugin.saveSettings();
          this.plugin.updateSelectionToolbarSettings();
        }));

    // 搜索按钮
    new Setting(toolbarCard)
      .setName(t('selectionToolbar.settings.actionSearch'))
      .setDesc(t('selectionToolbar.settings.actionSearchDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.selectionToolbar.actions.search)
        .onChange(async (value) => {
          this.plugin.settings.selectionToolbar.actions.search = value;
          await this.plugin.saveSettings();
          this.plugin.updateSelectionToolbarSettings();
        }));

    // 创建链接按钮
    new Setting(toolbarCard)
      .setName(t('selectionToolbar.settings.actionCreateLink'))
      .setDesc(t('selectionToolbar.settings.actionCreateLinkDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.selectionToolbar.actions.createLink)
        .onChange(async (value) => {
          this.plugin.settings.selectionToolbar.actions.createLink = value;
          await this.plugin.saveSettings();
          this.plugin.updateSelectionToolbarSettings();
        }));

    // 高亮按钮
    new Setting(toolbarCard)
      .setName(t('selectionToolbar.settings.actionHighlight'))
      .setDesc(t('selectionToolbar.settings.actionHighlightDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.selectionToolbar.actions.highlight)
        .onChange(async (value) => {
          this.plugin.settings.selectionToolbar.actions.highlight = value;
          await this.plugin.saveSettings();
          this.plugin.updateSelectionToolbarSettings();
        }));
  }

  /**
   * 渲染高级设置
   */
  private renderAdvancedSettings(containerEl: HTMLElement): void {
    // 选中工具栏设置
    this.renderSelectionToolbarSettings(containerEl);

    // 性能与调试设置
    const performanceCard = this.createSettingCard(containerEl);

    new Setting(performanceCard)
      .setName(t('settingsDetails.advanced.performanceAndDebug'))
      .setHeading();

    // 调试模式
    new Setting(performanceCard)
      .setName(t('settingsDetails.advanced.debugMode'))
      .setDesc(t('settingsDetails.advanced.debugModeDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode)
        .onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
        }));

    // 功能显示管理
    const visibilityCard = this.createSettingCard(containerEl);

    new Setting(visibilityCard)
      .setName(t('settingsDetails.advanced.featureVisibility'))
      .setDesc(t('settingsDetails.advanced.featureVisibilityDesc'))
      .setHeading();

    // AI 文件名生成功能 - 可折叠区块
    this.createCollapsibleSection(
      visibilityCard,
      'aiNaming',
      t('settingsDetails.advanced.aiNamingVisibility'),
      t('settingsDetails.advanced.aiNamingVisibilityDesc'),
      (contentEl) => {
        new Setting(contentEl)
          .setName(t('settingsDetails.advanced.showInCommandPalette'))
          .setDesc(t('settingsDetails.advanced.showInCommandPaletteDesc'))
          .addToggle(toggle => toggle
            .setValue(this.plugin.settings.featureVisibility.aiNaming.showInCommandPalette)
            .onChange(async (value) => {
              this.plugin.settings.featureVisibility.aiNaming.showInCommandPalette = value;
              await this.plugin.saveSettings();
            }));

        new Setting(contentEl)
          .setName(t('settingsDetails.advanced.showInEditorMenu'))
          .setDesc(t('settingsDetails.advanced.showInEditorMenuDesc'))
          .addToggle(toggle => toggle
            .setValue(this.plugin.settings.featureVisibility.aiNaming.showInEditorMenu)
            .onChange(async (value) => {
              this.plugin.settings.featureVisibility.aiNaming.showInEditorMenu = value;
              await this.plugin.saveSettings();
            }));

        new Setting(contentEl)
          .setName(t('settingsDetails.advanced.showInFileMenu'))
          .setDesc(t('settingsDetails.advanced.showInFileMenuDesc'))
          .addToggle(toggle => toggle
            .setValue(this.plugin.settings.featureVisibility.aiNaming.showInFileMenu)
            .onChange(async (value) => {
              this.plugin.settings.featureVisibility.aiNaming.showInFileMenu = value;
              await this.plugin.saveSettings();
            }));

        new Setting(contentEl)
          .setName(t('settingsDetails.advanced.showInRibbon'))
          .setDesc(t('settingsDetails.advanced.showInRibbonDesc'))
          .addToggle(toggle => toggle
            .setValue(this.plugin.settings.featureVisibility.aiNaming.showInRibbon)
            .onChange(async (value) => {
              this.plugin.settings.featureVisibility.aiNaming.showInRibbon = value;
              await this.plugin.saveSettings();
            }));
      }
    );

    // 终端功能 - 可折叠区块
    this.createCollapsibleSection(
      visibilityCard,
      'terminal',
      t('settingsDetails.advanced.terminalVisibility'),
      t('settingsDetails.advanced.terminalVisibilityDesc'),
      (contentEl) => {
        new Setting(contentEl)
          .setName(t('settingsDetails.advanced.showInCommandPalette'))
          .setDesc(t('settingsDetails.advanced.showInCommandPaletteDesc'))
          .addToggle(toggle => toggle
            .setValue(this.plugin.settings.featureVisibility.terminal.showInCommandPalette)
            .onChange(async (value) => {
              this.plugin.settings.featureVisibility.terminal.showInCommandPalette = value;
              await this.plugin.saveSettings();
            }));

        new Setting(contentEl)
          .setName(t('settingsDetails.advanced.showInRibbon'))
          .setDesc(t('settingsDetails.advanced.showInRibbonTerminalDesc'))
          .addToggle(toggle => toggle
            .setValue(this.plugin.settings.featureVisibility.terminal.showInRibbon)
            .onChange(async (value) => {
              this.plugin.settings.featureVisibility.terminal.showInRibbon = value;
              await this.plugin.saveSettings();
            }));

        new Setting(contentEl)
          .setName(t('settingsDetails.advanced.showInNewTab'))
          .setDesc(t('settingsDetails.advanced.showInNewTabDesc'))
          .addToggle(toggle => toggle
            .setValue(this.plugin.settings.featureVisibility.terminal.showInNewTab)
            .onChange(async (value) => {
              this.plugin.settings.featureVisibility.terminal.showInNewTab = value;
              await this.plugin.saveSettings();
            }));
      }
    );
  }

  /**
   * 创建可折叠的设置区块
   * @param containerEl 容器元素
   * @param sectionId 区块 ID
   * @param title 标题
   * @param description 描述
   * @param renderContent 渲染内容的回调函数
   */
  private createCollapsibleSection(
    containerEl: HTMLElement,
    sectionId: string,
    title: string,
    description: string,
    renderContent: (contentEl: HTMLElement) => void
  ): void {
    const isExpanded = this.expandedSections.has(sectionId);

    // 创建包装容器
    const wrapperEl = containerEl.createDiv({ cls: 'collapsible-section-wrapper' });

    // 创建标题区域（可点击）
    const headerEl = wrapperEl.createDiv({ 
      cls: 'collapsible-section-header' 
    });

    const headerInfo = headerEl.createDiv({ cls: 'setting-item-info' });
    
    const headerName = headerInfo.createDiv({ cls: 'setting-item-name' });
    
    // 添加展开/收起图标
    const iconEl = headerName.createSpan({ cls: 'collapsible-icon' });
    setIcon(iconEl, isExpanded ? 'chevron-down' : 'chevron-right');
    
    headerName.appendText(title);
    
    const headerDesc = headerInfo.createDiv({ cls: 'setting-item-description' });
    headerDesc.setText(description);

    // 创建内容区域
    const contentEl = wrapperEl.createDiv({ cls: 'collapsible-content' });
    contentEl.style.display = isExpanded ? 'block' : 'none';

    // 点击标题切换展开/收起
    headerEl.addEventListener('click', () => {
      const willExpand = !this.expandedSections.has(sectionId);
      
      if (willExpand) {
        this.expandedSections.add(sectionId);
        contentEl.style.display = 'block';
        headerEl.addClass('is-expanded');
        setIcon(iconEl, 'chevron-down');
        
        // 如果内容还未渲染，现在渲染
        if (contentEl.children.length === 0) {
          renderContent(contentEl);
        }
      } else {
        this.expandedSections.delete(sectionId);
        contentEl.style.display = 'none';
        headerEl.removeClass('is-expanded');
        setIcon(iconEl, 'chevron-right');
      }
    });

    // 设置初始状态
    if (isExpanded) {
      headerEl.addClass('is-expanded');
      renderContent(contentEl);
    }
  }

  /**
   * 验证自定义 Shell 路径
   * @param containerEl 容器元素
   * @param path Shell 路径
   */
  private validateCustomShellPath(containerEl: HTMLElement, path: string): void {
    // 移除之前的验证消息
    const existingValidation = containerEl.querySelector('.shell-path-validation');
    if (existingValidation) {
      existingValidation.remove();
    }
    
    // 如果路径为空，不显示验证消息
    if (!path || path.trim() === '') {
      return;
    }
    
    // 创建验证消息容器
    const validationEl = containerEl.createDiv({ cls: 'shell-path-validation setting-item-description' });
    validationEl.style.marginTop = '8px';
    
    // 验证路径
    const isValid = validateShellPath(path);
    
    if (isValid) {
      validationEl.setText(t('settingsDetails.terminal.pathValid'));
      validationEl.style.color = 'var(--text-success)';
    } else {
      validationEl.setText(t('settingsDetails.terminal.pathInvalid'));
      validationEl.style.color = 'var(--text-error)';
    }
  }

  /**
   * 标准化 API 端点 URL
   * @param url 原始 URL
   * @returns 标准化后的 URL
   */
  private normalizeEndpoint(url: string): { url: string } {
    let normalized = url.trim();

    if (!normalized) {
      return { url: '' };
    }

    // 检查协议
    if (!normalized.match(/^https?:\/\//i)) {
      if (normalized.startsWith('//')) {
        normalized = 'https:' + normalized;
      } else if (!normalized.includes('://')) {
        normalized = 'https://' + normalized;
      }
    }

    // 移除末尾多余的斜杠
    normalized = normalized.replace(/\/+$/, '');

    // 检查是否包含完整路径
    const commonPaths = [
      '/v1/chat/completions',
      '/chat/completions',
      '/v1/completions',
      '/completions'
    ];

    const hasPath = commonPaths.some(path => normalized.includes(path));

    if (!hasPath) {
      // 尝试检测基础 URL 并自动补全
      const urlObj = this.tryParseUrl(normalized);
      if (urlObj) {
        const pathname = urlObj.pathname;

        // 如果路径以 /v1 结尾，自动补全为 /v1/chat/completions
        if (pathname === '/v1' || pathname === '/v1/') {
          normalized = normalized + '/chat/completions';
        }
        // 如果只有根路径或空路径，补全为 /v1/chat/completions
        else if (!pathname || pathname === '/') {
          normalized = normalized + '/v1/chat/completions';
        }
        // 如果路径以 /chat 结尾，补全为 /chat/completions
        else if (pathname === '/chat' || pathname === '/chat/') {
          normalized = normalized + '/completions';
        }
      }
    }

    // 修正双斜杠
    if (normalized.includes('//v1')) {
      normalized = normalized.replace('//v1', '/v1');
    }

    return { url: normalized };
  }

  /**
   * 缩短端点 URL 显示
   * @param endpoint 完整端点 URL
   * @returns 缩短后的显示文本
   */
  private shortenEndpoint(endpoint: string): string {
    try {
      const url = new URL(endpoint);
      // 只显示主机名
      return url.hostname;
    } catch {
      // 如果解析失败，截取前30个字符
      return endpoint.length > 30 ? endpoint.substring(0, 30) + '...' : endpoint;
    }
  }

  /**
   * 格式化上下文长度显示
   * @param length 上下文长度（tokens）
   * @returns 格式化后的字符串
   */
  private formatContextLength(length: number): string {
    if (length >= 1000000) {
      return `${(length / 1000000).toFixed(0)}M`;
    } else if (length >= 1000) {
      return `${(length / 1000).toFixed(0)}K`;
    }
    return String(length);
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
        this.app,
        models,
        provider.models.map(m => m.name),
        async (selectedModels: string[]) => {
          // 添加选中的模型
          for (const modelId of selectedModels) {
            const exists = provider.models.some(m => m.name === modelId);
            if (!exists) {
              this.configManager.addModel(provider.id, {
                name: modelId,
                displayName: '',
                temperature: 0.7,
                maxTokens: 4096,
                topP: 1.0
              });
            }
          }
          await this.plugin.saveSettings();
          this.display();
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
   * 尝试解析 URL
   * @param urlString URL 字符串
   * @returns URL 对象或 null
   */
  private tryParseUrl(urlString: string): URL | null {
    try {
      return new URL(urlString);
    } catch {
      return null;
    }
  }
}
