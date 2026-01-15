import type { App} from 'obsidian';
import { Modal, Setting, Notice, setIcon } from 'obsidian';
import type { ConfigManager } from '../../services/config/configManager';
import type { ModelConfig, APIFormat, ReasoningEffort } from '../settings';
import { inferContextLength, inferOutputTokenLimit } from '../../services/ai';
import { t } from '../../i18n';

/**
 * 模型编辑弹窗
 */
export class ModelEditModal extends Modal {
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
      maxOutputTokens: number;
      topP: number;
      apiFormat: APIFormat;
      reasoningEffort: ReasoningEffort;
      showReasoningSummary: boolean;
    } = {
      name: this.model?.name || '',
      displayName: this.model?.displayName || '',
      temperature: this.model?.temperature ?? 0.7,
      maxOutputTokens: this.model?.maxOutputTokens ?? 0,
      topP: this.model?.topP ?? 1.0,
      apiFormat: this.model?.apiFormat ?? 'chat-completions',
      reasoningEffort: this.model?.reasoningEffort ?? 'medium',
      showReasoningSummary: (this.model as ModelConfig & { showReasoningSummary?: boolean })?.showReasoningSummary ?? false
    };

    // 模型 ID（API 调用用）- 必填
    new Setting(contentEl)
      .setName(t('modals.modelEdit.name'))
      .setDesc(t('modals.modelEdit.nameDesc'))
      .addText(text => {
        text
          .setPlaceholder('gpt-4o, claude-4.5-sonnet')
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

    // ============================================================================
    // Token 配置区域
    // ============================================================================

    // 格式化 token 数量显示（如 128K、1M）
    const formatTokenCount = (tokens: number): string => {
      if (tokens <= 0) return t('common.auto');
      if (tokens >= 1000000) {
        return `${(tokens / 1000000).toFixed(1)}M`;
      } else if (tokens >= 1000) {
        return `${Math.round(tokens / 1000)}K`;
      }
      return String(tokens);
    };

    // 上下文长度只读展示（信息性显示）
    const contextLengthSetting = new Setting(contentEl)
      .setName(t('settingsDetails.general.contextLength'))
      .setDesc(t('settingsDetails.general.contextLengthDesc'));

    // 创建只读显示元素
    const contextLengthDisplay = contextLengthSetting.controlEl.createSpan({
      cls: 'context-length-display'
    });
    contextLengthDisplay.setCssProps({
      'font-family': 'var(--font-monospace)',
      'font-size': '0.9em',
      'color': 'var(--text-muted)',
      'padding': '4px 8px',
      'background': 'var(--background-secondary)',
      'border-radius': '4px'
    });

    // 更新上下文长度显示的函数
    const updateContextLengthDisplay = () => {
      const inferredContext = formData.name ? inferContextLength(formData.name) : 0;
      contextLengthDisplay.setText(inferredContext > 0 ? formatTokenCount(inferredContext) : '—');
    };

    // 初始化显示
    updateContextLengthDisplay();

    // 最大输出 Token 编辑控件
    const maxOutputTokensSetting = new Setting(contentEl)
      .setName(t('settingsDetails.general.maxOutputTokens'))
      .setDesc(t('settingsDetails.general.maxOutputTokensDesc'));

    // 创建自定义控件容器
    const controlContainer = maxOutputTokensSetting.controlEl.createDiv({ cls: 'output-tokens-control' });
    controlContainer.setCssProps({
      display: 'flex',
      'flex-direction': 'column',
      gap: '8px',
      width: '100%'
    });

    // 滑块 + 输入框行
    const sliderRow = controlContainer.createDiv({ cls: 'slider-row' });
    sliderRow.setCssProps({
      display: 'flex',
      'align-items': 'center',
      gap: '12px',
      width: '100%'
    });

    // 滑块容器
    const sliderContainer = sliderRow.createDiv({ cls: 'slider-container' });
    sliderContainer.setCssProps({
      flex: '1',
      'min-width': '200px'
    });

    // 获取当前模型的输出 token 限制
    const getOutputLimit = () => formData.name ? inferOutputTokenLimit(formData.name) : 8192;

    // 滑块
    const outputSlider = sliderContainer.createEl('input', {
      type: 'range',
      cls: 'slider'
    });
    outputSlider.min = '0';
    outputSlider.max = String(getOutputLimit());
    outputSlider.step = '256';
    outputSlider.value = String(formData.maxOutputTokens);
    outputSlider.setCssProps({
      width: '100%'
    });

    // 输入框
    const outputInput = sliderRow.createEl('input', {
      type: 'text',
      cls: 'output-tokens-input'
    });
    outputInput.value = formData.maxOutputTokens === 0 ? t('common.auto') : String(formData.maxOutputTokens);
    outputInput.setCssProps({
      width: '80px',
      'text-align': 'center',
      padding: '4px 8px'
    });

    // 重置按钮（重置为 0/自动）
    const resetBtn = sliderRow.createEl('button', {
      cls: 'clickable-icon'
    });
    resetBtn.setAttribute('aria-label', t('common.reset'));
    setIcon(resetBtn, 'rotate-ccw');

    // 警告提示容器
    const warningContainer = controlContainer.createDiv({ cls: 'output-tokens-warning' });
    warningContainer.setCssProps({
      display: 'none',
      'font-size': '0.85em',
      'color': 'var(--text-warning)',
      'padding': '4px 8px',
      'background': 'var(--background-modifier-warning)',
      'border-radius': '4px'
    });

    // 更新警告显示的函数
    const updateWarning = () => {
      const limit = getOutputLimit();
      if (formData.maxOutputTokens > 0 && formData.maxOutputTokens > limit) {
        warningContainer.setText(t('settingsDetails.general.outputTokensWarning', { limit: formatTokenCount(limit) }));
        warningContainer.setCssProps({ display: 'block' });
      } else {
        warningContainer.setCssProps({ display: 'none' });
      }
    };

    // 更新滑块范围的函数（当模型 ID 变化时调用）
    const updateSliderRange = () => {
      const limit = getOutputLimit();
      outputSlider.max = String(limit);
      // 如果当前值超过新限制，调整滑块位置（但保留用户输入的值）
      if (formData.maxOutputTokens > limit) {
        outputSlider.value = String(limit);
      }
      updateWarning();
    };

    // 格式化输出值显示
    const formatOutputValue = (value: number): string => {
      return value === 0 ? t('common.auto') : String(value);
    };

    // 解析输入值
    const parseOutputValue = (input: string): number => {
      const trimmed = input.trim();
      if (trimmed === '' || trimmed === t('common.auto') || trimmed.toLowerCase() === 'auto') {
        return 0;
      }
      const num = parseInt(trimmed);
      return isNaN(num) || num < 0 ? -1 : num;
    };

    // 滑块变化事件
    outputSlider.addEventListener('input', () => {
      const value = parseInt(outputSlider.value);
      formData.maxOutputTokens = value;
      outputInput.value = formatOutputValue(value);
      updateWarning();
    });

    // 输入框变化事件
    outputInput.addEventListener('change', () => {
      const parsedValue = parseOutputValue(outputInput.value);
      if (parsedValue >= 0) {
        formData.maxOutputTokens = parsedValue;
        outputSlider.value = String(Math.min(parsedValue, parseInt(outputSlider.max)));
        outputInput.value = formatOutputValue(parsedValue);
        updateWarning();
      } else {
        // 无效输入，恢复原值
        outputInput.value = formatOutputValue(formData.maxOutputTokens);
      }
    });

    // 重置按钮事件
    resetBtn.addEventListener('click', () => {
      formData.maxOutputTokens = 0;
      outputSlider.value = '0';
      outputInput.value = t('common.auto');
      updateWarning();
    });

    // 监听模型 ID 输入框变化，更新上下文长度显示和滑块范围
    const modelNameInput = contentEl.querySelector('input[placeholder*="gpt-4o"]') as HTMLInputElement;
    if (modelNameInput) {
      modelNameInput.addEventListener('input', () => {
        formData.name = modelNameInput.value;
        updateContextLengthDisplay();
        updateSliderRange();
      });
    }

    // 初始化警告状态
    updateWarning();

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
          maxOutputTokens: formData.maxOutputTokens,
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
