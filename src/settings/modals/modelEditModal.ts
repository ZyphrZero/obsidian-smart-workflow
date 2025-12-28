import { App, Modal, Setting, Notice, setIcon } from 'obsidian';
import type { ConfigManager } from '../../services/config/configManager';
import type { ModelConfig, APIFormat, ReasoningEffort } from '../settings';
import { inferContextLength } from '../../services/naming/modelContextLengths';
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

    // Max Context Window (带节点的拖动条 + 输入框)
    // 节点值：0(自动), 4K, 8K, 16K, 32K, 64K, 1M, 2M
    const contextWindowSteps = [0, 4096, 8192, 16384, 32768, 65536, 1048576, 2097152];
    const contextWindowLabels = [t('common.auto'), '4K', '8K', '16K', '32K', '64K', '1M', '2M'];
    
    // 格式化显示值：0 显示为"自动"，其他显示数字
    const formatContextValue = (value: number): string => {
      return value === 0 ? t('common.auto') : String(value);
    };

    // 解析输入值："自动"或空字符串解析为 0
    const parseContextValue = (input: string): number => {
      const trimmed = input.trim();
      if (trimmed === '' || trimmed === t('common.auto') || trimmed.toLowerCase() === 'auto') {
        return 0;
      }
      const num = parseInt(trimmed);
      return isNaN(num) || num < 0 ? -1 : num; // -1 表示无效输入
    };

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
    contextInput.value = formatContextValue(formData.maxTokens);
    contextInput.setCssProps({
      width: '70px',
      'text-align': 'center',
      padding: '4px 8px'
    });

    // 重置图标按钮
    const resetIconBtn = controlContainer.createEl('button', {
      cls: 'clickable-icon'
    });
    resetIconBtn.setAttribute('aria-label', t('common.reset'));
    setIcon(resetIconBtn, 'rotate-ccw');
    resetIconBtn.addEventListener('click', () => {
      // 根据当前模型 ID 推断默认值
      const inferredValue = formData.name ? inferContextLength(formData.name) : 0;
      formData.maxTokens = inferredValue;
      contextSlider.value = String(findClosestStepIndex(inferredValue));
      contextInput.value = formatContextValue(inferredValue);
    });

    // 滑块变化时更新输入框和 formData
    contextSlider.addEventListener('input', () => {
      const stepIndex = parseInt(contextSlider.value);
      const value = contextWindowSteps[stepIndex];
      formData.maxTokens = value;
      contextInput.value = formatContextValue(value);
    });

    // 输入框变化时更新滑块和 formData
    contextInput.addEventListener('change', () => {
      const parsedValue = parseContextValue(contextInput.value);

      if (parsedValue >= 0) {
        formData.maxTokens = parsedValue;
        contextSlider.value = String(findClosestStepIndex(parsedValue));
        contextInput.value = formatContextValue(parsedValue);
      } else {
        // 无效输入，恢复原值
        contextInput.value = formatContextValue(formData.maxTokens);
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
