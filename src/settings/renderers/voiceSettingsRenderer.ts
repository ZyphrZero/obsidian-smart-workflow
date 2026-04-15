/**
 * 语音输入设置渲染器
 * 负责渲染语音输入功能的所有设置
 */

import type { App } from 'obsidian';
import { Setting, Notice, setIcon } from 'obsidian';
import type { RendererContext } from '../types';
import { BaseSettingsRenderer } from './baseRenderer';
import { createHotkeyInput, createSettingCardBordered } from '../components';
import { t } from '../../i18n';
import type { 
  VoiceASRProvider, 
  VoiceASRMode, 
  VoiceRecordingMode,
  VoiceOverlayPosition,
  VoiceLLMPreset,
  VoiceASRProviderConfig,
  VoiceSettings,
  VoiceAudioCompressionLevel,
  VoiceQwenApiProvider,
  SecretStorageMode,
  KeyConfig,
} from '../settings';
import {
  DEFAULT_VOICE_LLM_PRESETS,
  DEFAULT_VOICE_ASSISTANT_QA_PROMPT,
  DEFAULT_VOICE_ASSISTANT_TEXT_PROCESSING_PROMPT,
} from '../settings';
import type { TranscriptionHistory } from '../../services/voice/types';
import { HistoryManager } from '../../services/voice/historyManager';

/**
 * 检查 SecretComponent 是否可用
 * Obsidian 1.11.1+ 才支持 SecretComponent
 */
function isSecretComponentAvailable(app: App): boolean {
  return !!(app as any).secretStorage;
}

/**
 * 动态创建 SecretComponent
 * 由于 TypeScript 类型定义可能不包含 SecretComponent，使用动态导入
 */
async function createSecretComponent(app: App, containerEl: HTMLElement): Promise<any> {
  try {
    const obsidian = await import('obsidian');
    const SecretComponent = (obsidian as any).SecretComponent;
    if (SecretComponent) {
      return new SecretComponent(app, containerEl);
    }
  } catch {
    // SecretComponent 不可用
  }
  return null;
}

/**
 * ASR 供应商显示信息
 * 按推荐顺序排列：豆包（推荐）> 阿里云 > 硅基流动
 */
const ASR_PROVIDER_INFO: Record<VoiceASRProvider, { 
  name: string; 
  modes: VoiceASRMode[]; 
  guideUrl?: string;
  modelName: string;
}> = {
  doubao: { 
    name: '豆包 Doubao（推荐）', 
    modes: ['realtime', 'http'],
    guideUrl: 'https://www.volcengine.com/docs/6561/163043',
    modelName: 'Doubao-Seed-ASR-2.0',
  },
  qwen: { 
    name: '阿里云 Qwen', 
    modes: ['realtime', 'http'],
    guideUrl: 'https://help.aliyun.com/zh/model-studio/developer-reference/get-api-key',
    modelName: 'qwen3-asr-flash',
  },
  sensevoice: { 
    name: '硅基流动 SenseVoice', 
    modes: ['http'],
    guideUrl: 'https://docs.siliconflow.cn/quickstart',
    modelName: 'FunAudioLLM/SenseVoiceSmall',
  },
};

/**
 * ASR 供应商顺序（用于下拉列表）
 */
const ASR_PROVIDER_ORDER: VoiceASRProvider[] = ['doubao', 'qwen', 'sensevoice'];

/**
 * ASR 模式显示名称 - 使用 i18n 翻译
 */
const getASRModeNames = (): Record<VoiceASRMode, string> => ({
  realtime: t('voice.settings.asrModeRealtime') + ' - ' + t('voice.settings.asrModeRealtimeDesc'),
  http: t('voice.settings.asrModeHttp') + ' - ' + t('voice.settings.asrModeHttpDesc'),
});

/**
 * 录音模式显示名称
 */
const RECORDING_MODE_NAMES: Record<VoiceRecordingMode, string> = {
  press: '按住模式 (按住录音，松开停止)',
  toggle: '切换模式 (按一次开始，再按一次结束)',
};

/**
 * 音频压缩等级显示名称
 */
const getAudioCompressionNames = (): Record<VoiceAudioCompressionLevel, string> => ({
  original: t('voice.settings.audioCompressionOriginal'),
  medium: t('voice.settings.audioCompressionMedium'),
  minimum: t('voice.settings.audioCompressionMinimum'),
});

/**
 * 悬浮窗位置显示名称
 */
const getOverlayPositionNames = (): Record<VoiceOverlayPosition, string> => ({
  cursor: t('voice.settings.overlayPositionCursor'),
  center: t('voice.settings.overlayPositionCenter'),
  'top-right': t('voice.settings.overlayPositionTopRight'),
  bottom: t('voice.settings.overlayPositionBottom'),
});

/**
 * 语音输入设置渲染器
 * 处理 ASR 配置、快捷键、LLM 后处理、AI 助手和历史记录设置的渲染
 */
export class VoiceSettingsRenderer extends BaseSettingsRenderer {
  private historyManager: HistoryManager | null = null;
  private historyRecords: TranscriptionHistory[] = [];
  private historySearchQuery = '';
  private editingPresetId: string | null = null;

  /**
   * 渲染语音输入设置
   * @param context 渲染器上下文
   */
  render(context: RendererContext): void {
    this.context = context;
    const containerEl = context.containerEl;

    // 功能开关卡片
    this.renderEnableSettings(containerEl);

    // 使用 toggleConditionalSection 渲染启用后的设置
    // 这样在初始渲染时也能正确显示
    this.toggleConditionalSection(
      containerEl,
      'voice-enabled-settings',
      this.context.plugin.settings.voice.enabled,
      (el) => this.renderEnabledSettings(el)
    );
  }

  // ============================================================================
  // 状态表盘（iOS 风格）
  // ============================================================================

  /**
   * 渲染状态表盘
   * 显示 ASR、LLM 后处理、AI 助手的配置状态
   */
  private renderStatusDashboard(containerEl: HTMLElement): void {
    const voiceSettings = this.context.plugin.settings.voice;
    
    // 创建表盘容器
    const dashboardEl = containerEl.createDiv({ cls: 'voice-status-dashboard' });
    
    // ASR 语音识别状态卡片
    this.renderASRStatusCard(dashboardEl, voiceSettings);
    
    // LLM 后处理状态卡片
    this.renderLLMStatusCard(dashboardEl, voiceSettings);
    
    // AI 助手状态卡片
    this.renderAssistantStatusCard(dashboardEl, voiceSettings);
  }

  /**
   * 渲染 ASR 状态卡片
   */
  private renderASRStatusCard(containerEl: HTMLElement, voiceSettings: VoiceSettings): void {
    const card = containerEl.createDiv({ cls: 'voice-status-card' });
    
    // 卡片头部
    const headerEl = card.createDiv({ cls: 'voice-status-card-header' });
    const iconEl = headerEl.createDiv({ cls: 'voice-status-card-icon asr' });
    setIcon(iconEl, 'mic');
    headerEl.createSpan({ cls: 'voice-status-card-title', text: t('voice.dashboard.asrTitle') });
    
    // 卡片内容
    const contentEl = card.createDiv({ cls: 'voice-status-card-content' });
    
    // 主模型 - 点击可选择
    const primaryInfo = ASR_PROVIDER_INFO[voiceSettings.primaryASR.provider];
    this.renderSelectableStatusItem(
      contentEl, 
      t('voice.dashboard.primaryModel'), 
      primaryInfo?.modelName || '-', 
      'check-circle', 
      'success',
      ASR_PROVIDER_ORDER.map(p => ({ value: p, label: ASR_PROVIDER_INFO[p].modelName })),
      voiceSettings.primaryASR.provider,
      async (value) => {
        const provider = value as VoiceASRProvider;
        const modes = ASR_PROVIDER_INFO[provider].modes;
        this.context.plugin.settings.voice.primaryASR = {
          ...this.context.plugin.settings.voice.primaryASR,
          provider,
          mode: modes[0],
        };
        await this.saveSettings();
      }
    );
    
    const backupConfigs = this.getBackupASRConfigs();
    if (backupConfigs.length > 0) {
      const backupModels = backupConfigs
        .map((config) => ASR_PROVIDER_INFO[config.provider].modelName)
        .join(' -> ');
      this.renderStatusItem(
        contentEl,
        t('voice.dashboard.backupModel'),
        backupModels,
        voiceSettings.enableFallback ? 'shield-check' : 'shield-off',
        voiceSettings.enableFallback ? 'success' : 'muted'
      );
    }
    
    // ASR 模式 - 点击可切换
    const currentMode = voiceSettings.primaryASR.mode;
    const availableModes = ASR_PROVIDER_INFO[voiceSettings.primaryASR.provider].modes;
    const modeOptions = availableModes.map(m => ({
      value: m,
      label: m === 'realtime' ? t('voice.settings.asrModeRealtime') : t('voice.settings.asrModeHttp')
    }));
    this.renderSelectableStatusItem(
      contentEl, 
      t('voice.dashboard.asrMode'), 
      currentMode === 'realtime' ? t('voice.settings.asrModeRealtime') : t('voice.settings.asrModeHttp'),
      'radio', 
      'info',
      modeOptions,
      currentMode,
      async (value) => {
        this.context.plugin.settings.voice.primaryASR.mode = value as VoiceASRMode;
        await this.saveSettings();
      }
    );
    
    // 移除末尾标点 - 点击可切换
    this.renderToggleStatusItem(
      contentEl, 
      t('voice.dashboard.removePunctuation'), 
      voiceSettings.removeTrailingPunctuation,
      async (value) => {
        this.context.plugin.settings.voice.removeTrailingPunctuation = value;
        await this.saveSettings();
      }
    );
  }

  /**
   * 渲染 LLM 后处理状态卡片
   */
  private renderLLMStatusCard(containerEl: HTMLElement, voiceSettings: VoiceSettings): void {
    const card = containerEl.createDiv({ cls: 'voice-status-card' });
    
    // 卡片头部
    const headerEl = card.createDiv({ cls: 'voice-status-card-header' });
    const iconEl = headerEl.createDiv({ cls: 'voice-status-card-icon llm' });
    setIcon(iconEl, 'sparkles');
    headerEl.createSpan({ cls: 'voice-status-card-title', text: t('voice.dashboard.llmTitle') });
    
    // 状态开关 - 可点击切换
    this.renderHeaderToggle(headerEl, voiceSettings.enableLLMPostProcessing, async (value) => {
      this.context.plugin.settings.voice.enableLLMPostProcessing = value;
      await this.saveSettings();
      
      // 使用局部更新替代全量刷新
      this.toggleConditionalSection(
        card,
        'llm-status-content',
        value,
        (el) => this.renderLLMStatusCardContent(el, true),
        headerEl
      );
      // 如果禁用，显示提示
      this.toggleConditionalSection(
        card,
        'llm-status-hint',
        !value,
        (el) => this.renderLLMStatusCardHint(el),
        headerEl
      );
    });
    
    // 卡片内容区域 - 初始渲染
    this.toggleConditionalSection(
      card,
      'llm-status-content',
      voiceSettings.enableLLMPostProcessing,
      (el) => this.renderLLMStatusCardContent(el, true),
      headerEl
    );
    // 禁用提示 - 初始渲染
    this.toggleConditionalSection(
      card,
      'llm-status-hint',
      !voiceSettings.enableLLMPostProcessing,
      (el) => this.renderLLMStatusCardHint(el),
      headerEl
    );
  }

  /**
   * 渲染 LLM 状态卡片内容
   */
  private renderLLMStatusCardContent(contentEl: HTMLElement, _isEnabled: boolean): void {
    const voiceSettings = this.context.plugin.settings.voice;
    
    // 当前预设 - 点击可选择
    const activePreset = voiceSettings.llmPresets.find(p => p.id === voiceSettings.activeLLMPresetId);
    const presetOptions = voiceSettings.llmPresets.map(p => ({ value: p.id, label: p.name }));
    this.renderSelectableStatusItem(
      contentEl, 
      t('voice.dashboard.activePreset'), 
      activePreset?.name || '-',
      'bookmark',
      'info',
      presetOptions,
      voiceSettings.activeLLMPresetId,
      async (value) => {
        this.context.plugin.settings.voice.activeLLMPresetId = value;
        await this.saveSettings();
      }
    );
    
    // 使用的模型 - 点击可选择
    let modelName = '-';
    let currentModelValue = '';
    if (voiceSettings.postProcessingProviderId && voiceSettings.postProcessingModelId) {
      const provider = this.context.configManager.getProvider(voiceSettings.postProcessingProviderId);
      const model = provider?.models.find(m => m.id === voiceSettings.postProcessingModelId);
      modelName = model?.displayName || model?.name || '-';
      currentModelValue = `${voiceSettings.postProcessingProviderId}|${voiceSettings.postProcessingModelId}`;
    }
    
    // 构建模型选项
    const modelOptions = this.buildProviderModelOptions();
    this.renderSelectableStatusItem(
      contentEl, 
      t('voice.dashboard.llmModel'), 
      modelName, 
      'cpu', 
      'success',
      modelOptions,
      currentModelValue,
      async (value) => {
        if (!value) {
          this.context.plugin.settings.voice.postProcessingProviderId = undefined;
          this.context.plugin.settings.voice.postProcessingModelId = undefined;
        } else {
          const [providerId, modelId] = value.split('|');
          this.context.plugin.settings.voice.postProcessingProviderId = providerId;
          this.context.plugin.settings.voice.postProcessingModelId = modelId;
        }
        await this.saveSettings();
      }
    );
  }

  /**
   * 渲染 LLM 状态卡片禁用提示
   */
  private renderLLMStatusCardHint(contentEl: HTMLElement): void {
    const hintEl = contentEl.createDiv({ cls: 'voice-status-hint clickable' });
    hintEl.setText(t('voice.dashboard.llmDisabledHint'));
    hintEl.addEventListener('click', async () => {
      this.context.plugin.settings.voice.enableLLMPostProcessing = true;
      await this.saveSettings();
      
      // 使用局部更新
      const card = contentEl.closest('.voice-status-card') as HTMLElement;
      const headerEl = card?.querySelector('.voice-status-card-header') as HTMLElement;
      if (card && headerEl) {
        // 更新开关状态
        const toggleEl = headerEl.querySelector('.voice-status-toggle');
        if (toggleEl) {
          toggleEl.classList.add('active');
        }
        // 切换内容区域
        this.toggleConditionalSection(card, 'llm-status-hint', false, () => {}, headerEl);
        this.toggleConditionalSection(card, 'llm-status-content', true, (el) => this.renderLLMStatusCardContent(el, true), headerEl);
      }
    });
  }

  /**
   * 渲染 AI 助手状态卡片
   */
  private renderAssistantStatusCard(containerEl: HTMLElement, voiceSettings: VoiceSettings): void {
    const card = containerEl.createDiv({ cls: 'voice-status-card' });
    
    // 卡片头部
    const headerEl = card.createDiv({ cls: 'voice-status-card-header' });
    const iconEl = headerEl.createDiv({ cls: 'voice-status-card-icon assistant' });
    setIcon(iconEl, 'bot');
    headerEl.createSpan({ cls: 'voice-status-card-title', text: t('voice.dashboard.assistantTitle') });
    
    // 状态开关 - 可点击切换
    this.renderHeaderToggle(headerEl, voiceSettings.assistantConfig.enabled, async (value) => {
      this.context.plugin.settings.voice.assistantConfig.enabled = value;
      await this.saveSettings();
      
      // 使用局部更新替代全量刷新
      this.toggleConditionalSection(
        card,
        'assistant-status-content',
        value,
        (el) => this.renderAssistantStatusCardContent(el),
        headerEl
      );
      // 如果禁用，显示提示
      this.toggleConditionalSection(
        card,
        'assistant-status-hint',
        !value,
        (el) => this.renderAssistantStatusCardHint(el),
        headerEl
      );
    });
    
    // 卡片内容区域 - 初始渲染
    this.toggleConditionalSection(
      card,
      'assistant-status-content',
      voiceSettings.assistantConfig.enabled,
      (el) => this.renderAssistantStatusCardContent(el),
      headerEl
    );
    // 禁用提示 - 初始渲染
    this.toggleConditionalSection(
      card,
      'assistant-status-hint',
      !voiceSettings.assistantConfig.enabled,
      (el) => this.renderAssistantStatusCardHint(el),
      headerEl
    );
  }

  /**
   * 渲染 AI 助手状态卡片内容
   */
  private renderAssistantStatusCardContent(contentEl: HTMLElement): void {
    const voiceSettings = this.context.plugin.settings.voice;
    
    // 使用的模型 - 点击可选择
    let modelName = '-';
    let currentModelValue = '';
    if (voiceSettings.assistantConfig.providerId && voiceSettings.assistantConfig.modelId) {
      const provider = this.context.configManager.getProvider(voiceSettings.assistantConfig.providerId);
      const model = provider?.models.find(m => m.id === voiceSettings.assistantConfig.modelId);
      modelName = model?.displayName || model?.name || '-';
      currentModelValue = `${voiceSettings.assistantConfig.providerId}|${voiceSettings.assistantConfig.modelId}`;
    }
    
    // 构建模型选项
    const modelOptions = this.buildProviderModelOptions();
    this.renderSelectableStatusItem(
      contentEl, 
      t('voice.dashboard.assistantModel'), 
      modelName, 
      'cpu', 
      'success',
      modelOptions,
      currentModelValue,
      async (value) => {
        if (!value) {
          this.context.plugin.settings.voice.assistantConfig.providerId = undefined;
          this.context.plugin.settings.voice.assistantConfig.modelId = undefined;
        } else {
          const [providerId, modelId] = value.split('|');
          this.context.plugin.settings.voice.assistantConfig.providerId = providerId;
          this.context.plugin.settings.voice.assistantConfig.modelId = modelId;
        }
        await this.saveSettings();
      }
    );
    
    // 支持的模式（只读显示）
    this.renderStatusItem(contentEl, t('voice.dashboard.qaMode'), t('voice.dashboard.supported'), 'message-circle', 'info');
    this.renderStatusItem(contentEl, t('voice.dashboard.textProcessMode'), t('voice.dashboard.supported'), 'file-text', 'info');
  }

  /**
   * 渲染 AI 助手状态卡片禁用提示
   */
  private renderAssistantStatusCardHint(contentEl: HTMLElement): void {
    const hintEl = contentEl.createDiv({ cls: 'voice-status-hint clickable' });
    hintEl.setText(t('voice.dashboard.assistantDisabledHint'));
    hintEl.addEventListener('click', async () => {
      this.context.plugin.settings.voice.assistantConfig.enabled = true;
      await this.saveSettings();
      
      // 使用局部更新
      const card = contentEl.closest('.voice-status-card') as HTMLElement;
      const headerEl = card?.querySelector('.voice-status-card-header') as HTMLElement;
      if (card && headerEl) {
        // 更新开关状态
        const toggleEl = headerEl.querySelector('.voice-status-toggle');
        if (toggleEl) {
          toggleEl.classList.add('active');
        }
        // 切换内容区域
        this.toggleConditionalSection(card, 'assistant-status-hint', false, () => {}, headerEl);
        this.toggleConditionalSection(card, 'assistant-status-content', true, (el) => this.renderAssistantStatusCardContent(el), headerEl);
      }
    });
  }

  /**
   * 构建供应商/模型选项列表
   */
  private buildProviderModelOptions(): Array<{ value: string; label: string; group?: string }> {
    const providers = this.context.configManager.getProviders();
    const options: Array<{ value: string; label: string; group?: string }> = [
      { value: '', label: t('settingsDetails.general.noBinding') }
    ];
    
    providers.forEach(provider => {
      provider.models.forEach(model => {
        options.push({
          value: `${provider.id}|${model.id}`,
          label: model.displayName || model.name,
          group: provider.name
        });
      });
    });
    
    return options;
  }

  /**
   * 渲染头部开关
   */
  private renderHeaderToggle(
    headerEl: HTMLElement, 
    isEnabled: boolean, 
    onChange: (value: boolean) => Promise<void>
  ): void {
    const toggleEl = headerEl.createDiv({ cls: `voice-status-toggle ${isEnabled ? 'active' : ''}` });
    const toggleTrack = toggleEl.createDiv({ cls: 'voice-status-toggle-track' });
    toggleTrack.createDiv({ cls: 'voice-status-toggle-thumb' });
    
    toggleEl.addEventListener('click', async (e) => {
      e.stopPropagation();
      await onChange(!isEnabled);
    });
  }

  /**
   * 渲染可选择的状态项
   */
  private renderSelectableStatusItem(
    containerEl: HTMLElement, 
    label: string, 
    value: string, 
    iconName: string,
    status: 'success' | 'warning' | 'error' | 'info' | 'muted',
    options: Array<{ value: string; label: string; group?: string }>,
    currentValue: string,
    onChange: (value: string) => Promise<void>
  ): void {
    const itemEl = containerEl.createDiv({ cls: 'voice-status-item clickable' });
    
    // 图标
    const iconEl = itemEl.createDiv({ cls: `voice-status-item-icon ${status}` });
    setIcon(iconEl, iconName);
    
    // 标签
    itemEl.createSpan({ cls: 'voice-status-item-label', text: label });
    
    // 值（下拉选择）
    const selectWrapper = itemEl.createDiv({ cls: 'voice-status-item-select-wrapper' });
    const selectEl = selectWrapper.createEl('select', { cls: 'voice-status-item-select' });
    
    // 按组分类添加选项
    const groups = new Map<string, Array<{ value: string; label: string }>>();
    const ungrouped: Array<{ value: string; label: string }> = [];
    
    options.forEach(opt => {
      if (opt.group) {
        if (!groups.has(opt.group)) {
          groups.set(opt.group, []);
        }
        groups.get(opt.group)!.push(opt);
      } else {
        ungrouped.push(opt);
      }
    });
    
    // 添加未分组选项
    ungrouped.forEach(opt => {
      const optionEl = selectEl.createEl('option', { value: opt.value, text: opt.label });
      if (opt.value === currentValue) {
        optionEl.selected = true;
      }
    });
    
    // 添加分组选项
    groups.forEach((opts, groupName) => {
      const optgroup = selectEl.createEl('optgroup', { attr: { label: groupName } });
      opts.forEach(opt => {
        const optionEl = optgroup.createEl('option', { value: opt.value, text: opt.label });
        if (opt.value === currentValue) {
          optionEl.selected = true;
        }
      });
    });
    
    selectEl.addEventListener('change', async () => {
      await onChange(selectEl.value);
    });
    
    // 下拉箭头
    const arrowEl = selectWrapper.createDiv({ cls: 'voice-status-item-arrow' });
    setIcon(arrowEl, 'chevron-down');
  }

  /**
   * 渲染开关状态项
   */
  private renderToggleStatusItem(
    containerEl: HTMLElement, 
    label: string, 
    isEnabled: boolean,
    onChange: (value: boolean) => Promise<void>
  ): void {
    const itemEl = containerEl.createDiv({ cls: 'voice-status-item clickable' });
    
    // 图标
    const iconEl = itemEl.createDiv({ cls: `voice-status-item-icon ${isEnabled ? 'success' : 'muted'}` });
    setIcon(iconEl, isEnabled ? 'check' : 'x');
    
    // 标签
    itemEl.createSpan({ cls: 'voice-status-item-label', text: label });
    
    // 开关
    const toggleEl = itemEl.createDiv({ cls: `voice-status-item-toggle ${isEnabled ? 'active' : ''}` });
    const toggleTrack = toggleEl.createDiv({ cls: 'voice-status-item-toggle-track' });
    toggleTrack.createDiv({ cls: 'voice-status-item-toggle-thumb' });
    
    itemEl.addEventListener('click', async () => {
      await onChange(!isEnabled);
    });
  }

  /**
   * 渲染只读状态项
   */
  private renderStatusItem(
    containerEl: HTMLElement, 
    label: string, 
    value: string, 
    iconName: string,
    status: 'success' | 'warning' | 'error' | 'info' | 'muted'
  ): void {
    const itemEl = containerEl.createDiv({ cls: 'voice-status-item' });
    
    // 图标
    const iconEl = itemEl.createDiv({ cls: `voice-status-item-icon ${status}` });
    setIcon(iconEl, iconName);
    // 标签
    itemEl.createSpan({ cls: 'voice-status-item-label', text: label });
    
    // 值（添加 title 属性显示完整内容）
    const valueEl = itemEl.createSpan({ cls: `voice-status-item-value ${status}`, text: value });
    valueEl.setAttribute('title', value);
  }

  // ============================================================================
  // 快捷键设置
  // ============================================================================

  /**
   * 渲染快捷键设置
   */
  private renderHotkeySettings(containerEl: HTMLElement): void {
    const card = this.createCard(containerEl);

    // 标题
    new Setting(card)
      .setName(t('voice.settings.hotkeyConfig'))
      .setDesc(t('voice.settings.hotkeyConfigDesc'))
      .setHeading();

    // 使用封装的快捷键组件
    // 转录模式命令
    createHotkeyInput({
      app: this.context.app,
      containerEl: card,
      commandId: 'voice-dictation',
      name: t('voice.settings.dictationCommand'),
      description: t('voice.settings.dictationCommandDesc'),
      i18nPrefix: 'voice.settings',
      // 不再传递 onRefresh，快捷键组件内部会自动更新显示
    });
    
    // 助手模式命令
    createHotkeyInput({
      app: this.context.app,
      containerEl: card,
      commandId: 'voice-assistant',
      name: t('voice.settings.assistantCommand'),
      description: t('voice.settings.assistantCommandDesc'),
      i18nPrefix: 'voice.settings',
    });
    
    // 取消录音命令
    createHotkeyInput({
      app: this.context.app,
      containerEl: card,
      commandId: 'voice-cancel',
      name: t('voice.settings.cancelCommand'),
      description: t('voice.settings.cancelCommandDesc'),
      i18nPrefix: 'voice.settings',
    });
  }

  // ============================================================================
  // 功能开关设置
  // ============================================================================

  /**
   * 渲染功能开关设置
   */
  private renderEnableSettings(containerEl: HTMLElement): void {
    const card = this.createCard(containerEl);
    const isEnabled = this.context.plugin.settings.voice.enabled;

    // 标题行 - 包含标题和 iOS 风格开关
    const headerEl = card.createDiv({ cls: 'voice-enable-header' });
    
    // 左侧：标题和描述
    const infoEl = headerEl.createDiv({ cls: 'voice-enable-info' });
    infoEl.createDiv({ cls: 'voice-enable-title', text: t('voice.settings.title') });
    infoEl.createDiv({ cls: 'voice-enable-desc', text: t('voice.settings.titleDesc') });
    
    // 右侧：iOS 风格开关
    const toggleEl = headerEl.createDiv({ cls: `voice-enable-toggle ${isEnabled ? 'active' : ''}` });
    const toggleTrack = toggleEl.createDiv({ cls: 'voice-enable-toggle-track' });
    toggleTrack.createDiv({ cls: 'voice-enable-toggle-thumb' });
    
    toggleEl.addEventListener('click', async () => {
      const newEnabled = !this.context.plugin.settings.voice.enabled;
      this.context.plugin.settings.voice.enabled = newEnabled;
      // 同步更新 featureVisibility.voice.enabled
      this.context.plugin.settings.featureVisibility.voice.enabled = newEnabled;
      await this.saveSettings();
      
      // 更新开关样式
      if (newEnabled) {
        toggleEl.addClass('active');
      } else {
        toggleEl.removeClass('active');
      }
      
      // 使用 toggleConditionalSection 显示/隐藏其他设置
      this.toggleConditionalSection(
        containerEl,
        'voice-enabled-settings',
        newEnabled,
        (el) => this.renderEnabledSettings(el),
        card
      );
    });
  }

  /**
   * 渲染启用后的设置内容
   * 当语音功能启用时显示的所有设置
   */
  private renderEnabledSettings(containerEl: HTMLElement): void {
    // 快捷键说明卡片
    this.renderHotkeySettings(containerEl);

    // ASR 配置卡片
    this.renderASRSettings(containerEl);

    // LLM 后处理配置卡片
    this.renderLLMPostProcessingSettings(containerEl);

    // AI 助手配置卡片
    this.renderAssistantSettings(containerEl);

    // 其他设置卡片
    this.renderOtherSettings(containerEl);

    // 历史记录卡片
    this.renderHistorySettings(containerEl);
  }

  private getBackupASRConfigs(): VoiceASRProviderConfig[] {
    return this.context.plugin.settings.voice.backupASRs;
  }

  private createASRProviderConfig(provider: VoiceASRProvider): VoiceASRProviderConfig {
    const modes = ASR_PROVIDER_INFO[provider].modes;
    return {
      provider,
      mode: modes[0],
    };
  }

  private getDefaultBackupProvider(): VoiceASRProvider {
    return ASR_PROVIDER_ORDER.find((provider) => provider !== this.context.plugin.settings.voice.primaryASR.provider)
      ?? ASR_PROVIDER_ORDER[0];
  }

  private async updateBackupASRConfig(index: number, updates: Partial<VoiceASRProviderConfig>): Promise<void> {
    const nextConfigs = [...this.getBackupASRConfigs()];
    const currentConfig = nextConfigs[index];
    if (!currentConfig) {
      return;
    }

    nextConfigs[index] = {
      ...currentConfig,
      ...updates,
    };
    this.context.plugin.settings.voice.backupASRs = nextConfigs;
    await this.saveSettings();
  }

  private async replaceBackupASRConfig(index: number, config: VoiceASRProviderConfig): Promise<void> {
    const nextConfigs = [...this.getBackupASRConfigs()];
    nextConfigs[index] = config;
    this.context.plugin.settings.voice.backupASRs = nextConfigs;
    await this.saveSettings();
  }

  private async addBackupASRConfig(): Promise<void> {
    const nextConfigs = [...this.getBackupASRConfigs(), this.createASRProviderConfig(this.getDefaultBackupProvider())];
    this.context.plugin.settings.voice.backupASRs = nextConfigs;
    if (nextConfigs.length > 0) {
      this.context.plugin.settings.voice.enableFallback = true;
    }
    await this.saveSettings();
  }

  private async removeBackupASRConfig(index: number): Promise<void> {
    const nextConfigs = this.getBackupASRConfigs().filter((_, configIndex) => configIndex !== index);
    this.context.plugin.settings.voice.backupASRs = nextConfigs;
    if (nextConfigs.length === 0) {
      this.context.plugin.settings.voice.enableFallback = false;
    }
    await this.saveSettings();
  }

  // ============================================================================
  // ASR 配置设置
  // ============================================================================

  /**
   * 渲染 ASR 配置设置
   */
  private renderASRSettings(containerEl: HTMLElement): void {
    const card = this.createCard(containerEl);

    // 标题
    new Setting(card)
      .setName(t('voice.settings.asrConfig'))
      .setDesc(t('voice.settings.asrConfigDesc'))
      .setHeading();

    // 默认录音模式
    new Setting(card)
      .setName(t('voice.settings.defaultRecordingMode'))
      .setDesc(t('voice.settings.defaultRecordingModeDesc'))
      .addDropdown(dropdown => {
        Object.entries(RECORDING_MODE_NAMES).forEach(([value, name]) => {
          dropdown.addOption(value, name);
        });
        dropdown
          .setValue(this.context.plugin.settings.voice.defaultRecordingMode)
          .onChange(async (value: VoiceRecordingMode) => {
            this.context.plugin.settings.voice.defaultRecordingMode = value;
            await this.saveSettings();
          });
      });

    // 录音设备选择
    this.renderRecordingDeviceSetting(card);

    // 音频压缩
    this.renderAudioCompressionSetting(card);

    // 主 ASR 引擎配置
    const primarySection = createSettingCardBordered(card);
    primarySection.addClass('voice-asr-engine-section');
    this.renderPrimaryASRProviderConfig(primarySection);

    const backupActionSetting = new Setting(card)
      .setName(t('voice.settings.backupASRs'))
      .setDesc(t('voice.settings.backupASRsDesc'));
    backupActionSetting.addButton((button) => {
      button
        .setButtonText(t('voice.settings.addBackupASR'))
        .onClick(async () => {
          await this.addBackupASRConfig();
          renderBackupSections();
        });
    });

    const backupListEl = card.createDiv({ cls: 'voice-asr-backup-list' });
    const fallbackToggleContainer = card.createDiv({ cls: 'voice-asr-fallback-toggle' });

    const renderBackupSections = (): void => {
      backupListEl.empty();
      fallbackToggleContainer.empty();

      const backupConfigs = this.getBackupASRConfigs();
      if (backupConfigs.length === 0) {
        return;
      }

      backupConfigs.forEach((config, index) => {
        const backupSection = createSettingCardBordered(backupListEl);
        backupSection.addClass('voice-asr-engine-section');
        this.renderBackupASRProviderConfig(backupSection, index, config, async () => {
          await this.removeBackupASRConfig(index);
          renderBackupSections();
        });
      });

      new Setting(fallbackToggleContainer)
        .setName(t('voice.settings.enableFallback'))
        .setDesc(t('voice.settings.enableFallbackDesc'))
        .addToggle(toggle => toggle
          .setValue(this.context.plugin.settings.voice.enableFallback)
          .onChange(async (value) => {
            this.context.plugin.settings.voice.enableFallback = value;
            await this.saveSettings();
          }));
    };

    renderBackupSections();

    // 移除末尾标点
    new Setting(card)
      .setName(t('voice.settings.removeTrailingPunctuation'))
      .setDesc(t('voice.settings.removeTrailingPunctuationDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.voice.removeTrailingPunctuation)
        .onChange(async (value) => {
          this.context.plugin.settings.voice.removeTrailingPunctuation = value;
          await this.saveSettings();
        }));
  }

  /**
   * 渲染录音设备设置
   */
  private renderRecordingDeviceSetting(containerEl: HTMLElement): void {
    const voiceSettings = this.context.plugin.settings.voice;
    const deviceSetting = new Setting(containerEl)
      .setName(t('voice.settings.recordingDevice'))
      .setDesc(t('voice.settings.recordingDeviceDesc'));

    deviceSetting.addDropdown(dropdown => {
      const updateDropdown = (devices: Array<{ name: string; is_default: boolean }>) => {
        dropdown.selectEl.empty();
        const hasDevices = devices.length > 0;

        if (!hasDevices) {
          dropdown.addOption('', t('voice.settings.recordingDeviceNone'));
          dropdown.setValue('');
          dropdown.setDisabled(true);
          return;
        }

        dropdown.setDisabled(false);
        dropdown.addOption('', t('voice.settings.recordingDeviceDefault'));
        devices.forEach(device => {
          const label = device.is_default
            ? `${device.name} (${t('voice.settings.recordingDeviceDefaultTag')})`
            : device.name;
          dropdown.addOption(device.name, label);
        });

        dropdown.setValue(voiceSettings.recordingDeviceName || '');
      };

      dropdown.setDisabled(true);
      dropdown.addOption('', t('voice.settings.recordingDeviceLoading'));

      dropdown.onChange(async (value) => {
        this.context.plugin.settings.voice.recordingDeviceName = value || undefined;
        await this.saveSettings();
      });

      void (async () => {
        try {
          const voiceService = await this.context.plugin.getVoiceInputService();
          const devices = await voiceService.listInputDevices();
          updateDropdown(devices);
        } catch {
          updateDropdown([]);
        }
      })();
    });
  }

  /**
   * 渲染音频压缩设置
   */
  private renderAudioCompressionSetting(containerEl: HTMLElement): void {
    const voiceSettings = this.context.plugin.settings.voice;
    const compressionNames = getAudioCompressionNames();

    new Setting(containerEl)
      .setName(t('voice.settings.audioCompression'))
      .setDesc(t('voice.settings.audioCompressionDesc'))
      .addDropdown(dropdown => {
        (Object.keys(compressionNames) as VoiceAudioCompressionLevel[]).forEach(level => {
          dropdown.addOption(level, compressionNames[level]);
        });
        dropdown
          .setValue(voiceSettings.audioCompressionLevel)
          .onChange(async (value: VoiceAudioCompressionLevel) => {
            this.context.plugin.settings.voice.audioCompressionLevel = value;
            await this.saveSettings();
          });
      });
  }

  /**
   * 渲染 ASR 供应商配置
   */
  private renderPrimaryASRProviderConfig(containerEl: HTMLElement): void {
    this.renderASRProviderConfig(containerEl, {
      title: t('voice.settings.primaryASR'),
      description: t('voice.settings.primaryASRDesc'),
      getConfig: () => this.context.plugin.settings.voice.primaryASR,
      onProviderChange: async (provider) => {
        this.context.plugin.settings.voice.primaryASR = {
          ...this.context.plugin.settings.voice.primaryASR,
          ...this.createASRProviderConfig(provider),
        };
        await this.saveSettings();
      },
      onUpdateConfig: async (updates) => {
        this.context.plugin.settings.voice.primaryASR = {
          ...this.context.plugin.settings.voice.primaryASR,
          ...updates,
        };
        await this.saveSettings();
      },
    });
  }

  private renderBackupASRProviderConfig(
    containerEl: HTMLElement,
    index: number,
    _config: VoiceASRProviderConfig,
    onRemove: () => Promise<void>
  ): void {
    this.renderASRProviderConfig(containerEl, {
      title: `${t('voice.settings.backupASR')} ${index + 1}`,
      description: t('voice.settings.backupASRDesc'),
      getConfig: () => this.getBackupASRConfigs()[index],
      onProviderChange: async (provider) => {
        const currentConfig = this.getBackupASRConfigs()[index];
        if (!currentConfig) {
          return;
        }

        await this.replaceBackupASRConfig(index, {
          ...currentConfig,
          ...this.createASRProviderConfig(provider),
        });
      },
      onUpdateConfig: async (updates) => {
        await this.updateBackupASRConfig(index, updates);
      },
      onRemove,
    });
  }

  private renderASRProviderConfig(
    containerEl: HTMLElement,
    options: {
      title: string;
      description: string;
      getConfig: () => VoiceASRProviderConfig | undefined;
      onProviderChange: (provider: VoiceASRProvider) => Promise<void>;
      onUpdateConfig: (updates: Partial<VoiceASRProviderConfig>) => Promise<void>;
      onRemove?: () => Promise<void>;
    }
  ): void {
    const providerSetting = new Setting(containerEl)
      .setName(options.title)
      .setDesc(options.description);

    providerSetting.addDropdown((dropdown) => {
      ASR_PROVIDER_ORDER.forEach((provider) => {
        const info = ASR_PROVIDER_INFO[provider];
        dropdown.addOption(provider, info.name);
      });

      dropdown
        .setValue(options.getConfig()?.provider || ASR_PROVIDER_ORDER[0])
        .onChange(async (value: VoiceASRProvider) => {
          await options.onProviderChange(value);
          renderDetails();
        });
    });

    if (options.onRemove) {
      providerSetting.addExtraButton((button) => {
        button
          .setIcon('trash')
          .setTooltip(t('voice.settings.removeBackupASR'))
          .onClick(async () => {
            await options.onRemove?.();
          });
      });
    }

    const detailsContainer = containerEl.createDiv({ cls: 'voice-asr-provider-details' });
    const renderDetails = (): void => {
      detailsContainer.empty();
      const currentConfig = options.getConfig();
      if (!currentConfig) {
        return;
      }

      this.renderASRProviderDetails(detailsContainer, currentConfig, options.onUpdateConfig);
    };

    renderDetails();
  }

  /**
   * 渲染 ASR 供应商详细配置
   */
  private renderASRProviderDetails(
    containerEl: HTMLElement,
    config: VoiceASRProviderConfig,
    onUpdateConfig: (updates: Partial<VoiceASRProviderConfig>) => Promise<void>
  ): void {
    const providerInfo = ASR_PROVIDER_INFO[config.provider];
    const supportsRealtime = providerInfo.modes.includes('realtime');

    // 模式选择 - 始终显示，但根据供应商支持情况禁用不支持的选项
    const modeSetting = new Setting(containerEl)
      .setName(t('voice.settings.asrMode'))
      .setDesc(supportsRealtime 
        ? t('voice.settings.asrModeDesc') 
        : t('voice.settings.asrModeHttpOnly'));

    if (supportsRealtime) {
      // 供应商支持多种模式，显示下拉选择
      modeSetting.addDropdown(dropdown => {
        const modeNames = getASRModeNames();
        providerInfo.modes.forEach(mode => {
          dropdown.addOption(mode, modeNames[mode]);
        });
        dropdown
          .setValue(config.mode)
          .onChange(async (value: VoiceASRMode) => {
            await onUpdateConfig({ mode: value });
          });
      });
    } else {
      // 供应商只支持 HTTP 模式，显示禁用的下拉框
      modeSetting.addDropdown(dropdown => {
        const modeNames = getASRModeNames();
        dropdown.addOption('http', modeNames['http']);
        dropdown.setValue('http');
        dropdown.setDisabled(true);
      });
    }

    // 根据供应商类型显示不同的 API Key 输入
    this.renderASRApiKeyInputs(containerEl, config, onUpdateConfig);
  }

  /**
   * 渲染 ASR API Key 输入
   * 支持共享密钥和本地密钥两种存储模式
   */
  private renderASRApiKeyInputs(
    containerEl: HTMLElement,
    config: VoiceASRProviderConfig,
    updateConfig: (updates: Partial<VoiceASRProviderConfig>) => Promise<void>
  ): void {
    // 添加 API 申请指南链接
    const providerInfo = ASR_PROVIDER_INFO[config.provider];
    if (providerInfo.guideUrl) {
      const guideEl = containerEl.createDiv({ cls: 'voice-api-guide' });
      guideEl.style.marginBottom = '12px';
      guideEl.style.fontSize = '0.85em';
      guideEl.style.display = 'flex';
      guideEl.style.justifyContent = 'space-between';
      guideEl.style.alignItems = 'center';
      
      // 当前模型名称
      const modelEl = guideEl.createSpan();
      modelEl.style.color = 'var(--text-muted)';
      modelEl.setText(`${t('voice.settings.currentModel')}: ${providerInfo.modelName}`);
      
      // 申请指南链接
      const linkEl = guideEl.createEl('a', {
        text: `📖 ${t('voice.settings.apiKeyGuide')}`,
        href: providerInfo.guideUrl,
      });
      linkEl.style.color = 'var(--text-accent)';
      linkEl.style.textDecoration = 'none';
      linkEl.addEventListener('click', (e) => {
        e.preventDefault();
        window.open(providerInfo.guideUrl, '_blank');
      });
    }

    // 检查 SecretComponent 是否可用
    const secretComponentAvailable = isSecretComponentAvailable(this.context.app);

    switch (config.provider) {
      case 'qwen':
        this.renderQwenApiProviderSettings(
          containerEl,
          config,
          secretComponentAvailable,
          updateConfig
        );
        break;

      case 'doubao':
        // App ID（非密钥，直接存储）
        new Setting(containerEl)
          .setName(t('voice.settings.doubaoAppId'))
          .setDesc(t('voice.settings.doubaoAppIdDesc'))
          .addText(text => text
            .setPlaceholder(t('voice.settings.appIdPlaceholder'))
            .setValue(config.app_id || '')
            .onChange(async (value) => {
              await updateConfig({ app_id: value });
            }));

        // Access Token（密钥，支持共享存储）
        this.renderASRKeyWithStorageMode(
          containerEl,
          {
            keyName: t('voice.settings.doubaoAccessToken'),
            keyDesc: t('voice.settings.doubaoAccessTokenDesc'),
            keyConfig: config.doubaoKeyConfig,
            secretComponentAvailable,
            onKeyConfigChange: async (keyConfig: KeyConfig | undefined) => {
              await updateConfig({ doubaoKeyConfig: keyConfig });
            },
          }
        );
        break;

      case 'sensevoice': {
        // 检查模型配置中是否有硅基流动供应商
        const siliconFlowProvider = this.context.configManager.findSiliconFlowProvider();
        const siliconFlowApiKey = this.context.configManager.getSiliconFlowApiKey();
        const hasExistingKey = !!siliconFlowApiKey;

        // 提示信息
        const hintEl = containerEl.createDiv({ cls: 'voice-siliconflow-hint' });
        hintEl.style.marginBottom = '12px';
        hintEl.style.padding = '8px 12px';
        hintEl.style.borderRadius = '6px';
        hintEl.style.fontSize = '0.85em';
        hintEl.style.display = 'flex';
        hintEl.style.alignItems = 'center';
        hintEl.style.gap = '8px';

        if (hasExistingKey) {
          // 已配置硅基流动供应商，显示成功提示
          hintEl.style.backgroundColor = 'var(--background-modifier-success)';
          
          const iconEl = hintEl.createSpan();
          iconEl.setText('✅');
          
          const textEl = hintEl.createSpan();
          textEl.style.color = 'var(--text-normal)';
          textEl.setText(t('voice.settings.siliconflowExistingHint', { 
            providerName: siliconFlowProvider?.name || '硅基流动' 
          }));

          // 自动同步 API Key 到配置（使用本地模式）
          const currentKeyValue = this.context.configManager.resolveKeyValue(config.siliconflowKeyConfig);
          if (currentKeyValue !== siliconFlowApiKey) {
            void updateConfig({
              siliconflowKeyConfig: {
                mode: 'local',
                localValue: siliconFlowApiKey,
              },
            }).catch((error) => {
              console.error('[VoiceSettingsRenderer] 同步 SiliconFlow API Key 失败:', error);
            });
          }
        } else {
          // 未配置硅基流动供应商，提示用户去添加或手动配置
          hintEl.style.backgroundColor = 'var(--background-modifier-error)';
          
          const iconEl = hintEl.createSpan();
          iconEl.setText('⚠️');
          
          const textEl = hintEl.createSpan();
          textEl.style.color = 'var(--text-normal)';
          textEl.setText(t('voice.settings.siliconflowNoProviderHint'));

          // 如果没有现有供应商，显示手动配置选项
          this.renderASRKeyWithStorageMode(
            containerEl,
            {
              keyName: t('voice.settings.siliconflowApiKey') || 'SiliconFlow API Key',
              keyDesc: t('voice.settings.siliconflowApiKeyDesc') || '硅基流动 API Key',
              keyConfig: config.siliconflowKeyConfig,
              secretComponentAvailable,
              onKeyConfigChange: async (keyConfig: KeyConfig | undefined) => {
                await updateConfig({ siliconflowKeyConfig: keyConfig });
              },
            }
          );
        }
        break;
      }
    }
  }

  private renderQwenApiProviderSettings(
    containerEl: HTMLElement,
    config: VoiceASRProviderConfig,
    secretComponentAvailable: boolean,
    updateConfig: (updates: Partial<VoiceASRProviderConfig>) => Promise<void>
  ): void {
    const apiProvider = config.qwenApiProvider ?? 'bailian';
    const sectionId = 'qwen-api-provider';

    const apiProviderSetting = new Setting(containerEl)
      .setName(t('voice.settings.qwenApiProvider'))
      .setDesc(t('voice.settings.qwenApiProviderDesc'));

    apiProviderSetting.addDropdown(dropdown => {
      dropdown
        .addOption('modelService', t('voice.settings.qwenApiProviderModelService'))
        .addOption('bailian', t('voice.settings.qwenApiProviderBailian'))
        .setValue(apiProvider)
        .onChange(async (value: string) => {
          await updateConfig({ qwenApiProvider: value as VoiceQwenApiProvider });
          this.toggleConditionalSection(containerEl, sectionId, false, () => {}, apiProviderSetting.settingEl);
          this.toggleConditionalSection(
            containerEl,
            sectionId,
            true,
            (el) => this.renderQwenApiProviderDetails(
              el,
              { ...config, qwenApiProvider: value as VoiceQwenApiProvider },
              value as VoiceQwenApiProvider,
              secretComponentAvailable,
              updateConfig
            ),
            apiProviderSetting.settingEl
          );
        });
    });

    this.toggleConditionalSection(
      containerEl,
      sectionId,
      true,
      (el) => this.renderQwenApiProviderDetails(el, config, apiProvider, secretComponentAvailable, updateConfig),
      apiProviderSetting.settingEl
    );
  }

  private renderQwenApiProviderDetails(
    containerEl: HTMLElement,
    config: VoiceASRProviderConfig,
    apiProvider: VoiceQwenApiProvider,
    secretComponentAvailable: boolean,
    updateConfig: (updates: Partial<VoiceASRProviderConfig>) => Promise<void>
  ): void {
    if (apiProvider === 'modelService') {
      const providers = this.context.configManager.getProviders();
      if (providers.length === 0) {
        const hintEl = containerEl.createDiv({ cls: 'voice-qwen-provider-hint' });
        hintEl.style.marginTop = '8px';
        hintEl.style.fontSize = '0.85em';
        hintEl.style.color = 'var(--text-muted)';
        hintEl.setText(t('voice.settings.qwenProviderEmpty'));
        return;
      }

      new Setting(containerEl)
        .setName(t('voice.settings.qwenProviderSelect'))
        .setDesc(t('voice.settings.qwenProviderSelectDesc'))
        .addDropdown(dropdown => {
          dropdown.addOption('', t('voice.settings.qwenProviderNotSelected'));
          providers.forEach(provider => {
            dropdown.addOption(provider.id, provider.name);
          });
          dropdown
            .setValue(config.qwenProviderId || '')
            .onChange(async (value: string) => {
              const nextId = value || undefined;
              await updateConfig({ qwenProviderId: nextId });
              containerEl.empty();
              this.renderQwenApiProviderDetails(
                containerEl,
                { ...config, qwenProviderId: nextId },
                apiProvider,
                secretComponentAvailable,
                updateConfig
              );
            });
        });

      if (config.qwenProviderId) {
        const providerExists = providers.some(provider => provider.id === config.qwenProviderId);
        if (!providerExists) {
          const hintEl = containerEl.createDiv({ cls: 'voice-qwen-provider-hint' });
          hintEl.style.marginTop = '8px';
          hintEl.style.fontSize = '0.85em';
          hintEl.style.color = 'var(--text-warning)';
          hintEl.setText(t('voice.settings.qwenProviderNotFound'));
          return;
        }

        const apiKey = this.context.configManager.getApiKey(config.qwenProviderId);
        if (!apiKey) {
          const hintEl = containerEl.createDiv({ cls: 'voice-qwen-provider-hint' });
          hintEl.style.marginTop = '8px';
          hintEl.style.fontSize = '0.85em';
          hintEl.style.color = 'var(--text-warning)';
          hintEl.setText(t('voice.settings.qwenProviderMissingKey'));
        }
      }
      return;
    }

    this.renderASRKeyWithStorageMode(
      containerEl,
      {
        keyName: t('voice.settings.dashscopeApiKey'),
        keyDesc: t('voice.settings.dashscopeApiKeyDesc'),
        keyConfig: config.dashscopeKeyConfig,
        secretComponentAvailable,
        onKeyConfigChange: async (keyConfig: KeyConfig | undefined) => {
          await updateConfig({ dashscopeKeyConfig: keyConfig });
        },
      }
    );
  }

  /**
   * 渲染带存储模式选择的 ASR 密钥输入
   * 支持共享密钥（SecretComponent）和本地密钥（TextComponent）
   */
  private renderASRKeyWithStorageMode(
    containerEl: HTMLElement,
    options: {
      keyName: string;
      keyDesc: string;
      keyConfig: KeyConfig | undefined;
      secretComponentAvailable: boolean;
      onKeyConfigChange: (keyConfig: KeyConfig | undefined) => Promise<void>;
    }
  ): void {
    const { keyName, keyDesc, keyConfig, secretComponentAvailable, onKeyConfigChange } = options;

    // 确定当前存储模式
    let currentMode: SecretStorageMode = keyConfig?.mode || 'local';
    let currentSecretId = keyConfig?.secretId || '';
    let currentLocalValue = keyConfig?.localValue || '';

    // 创建容器
    const keyContainer = containerEl.createDiv({ cls: 'voice-asr-key-container' });
    keyContainer.style.marginBottom = '16px';

    // 存储模式选择器（仅当 SecretComponent 可用时显示）
    let secretComponentContainer: HTMLElement | null = null;
    let localKeyContainer: HTMLElement | null = null;

    const updateStorageModeUI = () => {
      if (secretComponentContainer && localKeyContainer) {
        if (currentMode === 'shared') {
          secretComponentContainer.style.display = 'block';
          localKeyContainer.style.display = 'none';
        } else {
          secretComponentContainer.style.display = 'none';
          localKeyContainer.style.display = 'block';
        }
      }
    };

    if (secretComponentAvailable) {
      new Setting(keyContainer)
        .setName(t('voice.settings.keyStorageMode') || '密钥存储模式')
        .setDesc(t('voice.settings.keyStorageModeDesc') || '选择密钥的存储方式')
        .addDropdown(dropdown => {
          dropdown
            .addOption('local', t('voice.settings.localKey') || '本地密钥')
            .addOption('shared', t('voice.settings.sharedKey') || '共享密钥')
            .setValue(currentMode)
            .onChange(async (value: string) => {
              currentMode = value as SecretStorageMode;
              updateStorageModeUI();
              
              // 更新配置
              if (currentMode === 'shared') {
                await onKeyConfigChange({
                  mode: 'shared',
                  secretId: currentSecretId,
                });
              } else {
                await onKeyConfigChange({
                  mode: 'local',
                  localValue: currentLocalValue,
                });
              }
            });
        });

      // 共享密钥容器 (SecretComponent)
      secretComponentContainer = keyContainer.createDiv({ cls: 'voice-secret-component-container' });
      const secretSetting = new Setting(secretComponentContainer)
        .setName(keyName)
        .setDesc(keyDesc);

      secretSetting.controlEl.empty();
      void createSecretComponent(this.context.app, secretSetting.controlEl).then(secretComponent => {
        if (secretComponent) {
          secretComponent
            .setValue(currentSecretId)
            .onChange(async (value: string) => {
              currentSecretId = value;
              await onKeyConfigChange({
                mode: 'shared',
                secretId: value,
              });
            });
        }
      });
    }

    // 本地密钥容器 (TextComponent)
    localKeyContainer = keyContainer.createDiv({ cls: 'voice-local-key-container' });
    new Setting(localKeyContainer)
      .setName(keyName)
      .setDesc(keyDesc)
      .addText(text => {
        text
          .setPlaceholder(t('voice.settings.apiKeyPlaceholder'))
          .setValue(currentLocalValue)
          .onChange(async (value) => {
            currentLocalValue = value;
            await onKeyConfigChange({
              mode: 'local',
              localValue: value,
            });
          });
        text.inputEl.type = 'password';
      });

    // 初始化 UI 显示
    if (secretComponentAvailable) {
      updateStorageModeUI();
    } else {
      // SecretComponent 不可用时，只显示本地密钥输入
      if (localKeyContainer) {
        localKeyContainer.style.display = 'block';
      }
    }
  }


  // ============================================================================
  // LLM 后处理配置设置
  // ============================================================================

  /**
   * 渲染 LLM 后处理配置设置
   */
  private renderLLMPostProcessingSettings(containerEl: HTMLElement): void {
    const card = this.createCard(containerEl);
    const voiceSettings = this.context.plugin.settings.voice;

    // 标题
    new Setting(card)
      .setName(t('voice.settings.llmPostProcessing'))
      .setDesc(t('voice.settings.llmPostProcessingDesc'))
      .setHeading();

    // 启用 LLM 后处理
    const enableLLMSetting = new Setting(card)
      .setName(t('voice.settings.enableLLMPostProcessing'))
      .setDesc(t('voice.settings.enableLLMPostProcessingDesc'))
      .addToggle(toggle => toggle
        .setValue(voiceSettings.enableLLMPostProcessing)
        .onChange(async (value) => {
          this.context.plugin.settings.voice.enableLLMPostProcessing = value;
          await this.saveSettings();
          
          // 使用局部更新替代全量刷新
          this.toggleConditionalSection(
            card,
            'llm-post-processing-config',
            value,
            (el) => this.renderLLMPostProcessingConfigContent(el),
            enableLLMSetting.settingEl
          );
        }));

    // LLM 后处理配置区域（仅在启用时显示）- 初始渲染
    this.toggleConditionalSection(
      card,
      'llm-post-processing-config',
      voiceSettings.enableLLMPostProcessing,
      (el) => this.renderLLMPostProcessingConfigContent(el),
      enableLLMSetting.settingEl
    );
  }

  /**
   * 渲染 LLM 后处理配置内容
   * 提取为独立方法，用于 toggleConditionalSection 调用
   */
  private renderLLMPostProcessingConfigContent(container: HTMLElement): void {
    // 选择供应商和模型
    this.renderProviderModelBinding(container, 'postProcessing');

    // 预设管理
    this.renderPresetManagement(container);
  }

  /**
   * 渲染供应商/模型绑定选择
   * 使用 optgroup 按供应商分组显示模型
   */
  private renderProviderModelBinding(
    containerEl: HTMLElement,
    type: 'postProcessing' | 'assistant'
  ): void {
    const voiceSettings = this.context.plugin.settings.voice;
    const providers = this.context.configManager.getProviders();

    // 获取当前绑定
    let currentProviderId: string | undefined;
    let currentModelId: string | undefined;

    if (type === 'postProcessing') {
      currentProviderId = voiceSettings.postProcessingProviderId;
      currentModelId = voiceSettings.postProcessingModelId;
    } else {
      currentProviderId = voiceSettings.assistantConfig.providerId;
      currentModelId = voiceSettings.assistantConfig.modelId;
    }

    const currentValue = currentProviderId && currentModelId
      ? `${currentProviderId}|${currentModelId}`
      : '';

    const bindingSetting = new Setting(containerEl)
      .setName(t('voice.settings.selectProviderModel'))
      .setDesc(t('voice.settings.selectProviderModelDesc'));

    bindingSetting.addDropdown(dropdown => {
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
      selectEl.value = currentValue;

      // 监听变化
      dropdown.onChange(async (value) => {
        if (!value) {
          if (type === 'postProcessing') {
            this.context.plugin.settings.voice.postProcessingProviderId = undefined;
            this.context.plugin.settings.voice.postProcessingModelId = undefined;
          } else {
            this.context.plugin.settings.voice.assistantConfig.providerId = undefined;
            this.context.plugin.settings.voice.assistantConfig.modelId = undefined;
          }
        } else {
          const [providerId, modelId] = value.split('|');
          if (type === 'postProcessing') {
            this.context.plugin.settings.voice.postProcessingProviderId = providerId;
            this.context.plugin.settings.voice.postProcessingModelId = modelId;
          } else {
            this.context.plugin.settings.voice.assistantConfig.providerId = providerId;
            this.context.plugin.settings.voice.assistantConfig.modelId = modelId;
          }
        }
        await this.saveSettings();
      });
    });
  }

  /**
   * 渲染预设管理
   */
  private renderPresetManagement(containerEl: HTMLElement): void {
    const voiceSettings = this.context.plugin.settings.voice;
    let activePresetSelectEl: HTMLSelectElement | null = null;
    let presetListEl: HTMLElement | null = null;

    const refreshActivePresetDropdown = (): void => {
      const selectEl = activePresetSelectEl;
      if (!selectEl) {
        return;
      }

      selectEl.empty();
      voiceSettings.llmPresets.forEach(preset => {
        const option = selectEl.createEl('option', {
          value: preset.id,
          text: preset.name,
        });
        option.setAttribute('value', preset.id);
      });

      selectEl.value = voiceSettings.activeLLMPresetId;
    };

    // 预设管理标题
    new Setting(containerEl)
      .setName(t('voice.settings.presetManagement'))
      .setDesc(t('voice.settings.presetManagementDesc'))
      .setHeading();

    // 当前激活的预设
    new Setting(containerEl)
      .setName(t('voice.settings.activePreset'))
      .setDesc(t('voice.settings.activePresetDesc'))
      .addDropdown(dropdown => {
        activePresetSelectEl = dropdown.selectEl;
        refreshActivePresetDropdown();
        dropdown.onChange(async (value) => {
          this.context.plugin.settings.voice.activeLLMPresetId = value;
          await this.saveSettings();
          if (presetListEl) {
            this.renderPresetList(presetListEl, refreshActivePresetDropdown);
          }
        });
      });

    // 预设操作
    const presetActionsSetting = new Setting(containerEl);
    presetActionsSetting.settingEl.addClass('voice-preset-actions');
    presetActionsSetting
      .addButton(button => button
        .setButtonText(t('voice.settings.addPreset'))
        .setCta()
        .onClick(async () => {
          const newPreset: VoiceLLMPreset = {
            id: `custom-${Date.now()}`,
            name: t('voice.settings.newPresetName'),
            systemPrompt: '',
          };
          this.context.plugin.settings.voice.llmPresets.unshift(newPreset);
          this.editingPresetId = newPreset.id;
          await this.saveSettings();
          refreshActivePresetDropdown();
          if (presetListEl) {
            this.renderPresetList(presetListEl, refreshActivePresetDropdown);
          }
        }))
      .addButton(button => button
        .setButtonText(t('voice.settings.resetPresets'))
        .onClick(async () => {
          this.context.plugin.settings.voice.llmPresets = [...DEFAULT_VOICE_LLM_PRESETS];
          this.context.plugin.settings.voice.activeLLMPresetId = 'polishing';
          this.editingPresetId = null;
          await this.saveSettings();
          refreshActivePresetDropdown();
          if (presetListEl) {
            this.renderPresetList(presetListEl, refreshActivePresetDropdown);
          }
          new Notice(t('voice.settings.presetsReset'));
        }));

    // 预设列表容器
    presetListEl = containerEl.createDiv({ cls: 'voice-preset-list' });
    presetListEl.style.marginTop = '8px';

    // 渲染预设列表
    this.renderPresetList(presetListEl, refreshActivePresetDropdown);
  }

  /**
   * 渲染预设列表
   * 提取为独立方法，用于局部更新
   */
  private renderPresetList(
    presetListEl: HTMLElement,
    onPresetOptionsChange?: () => void
  ): void {
    presetListEl.empty();
    const voiceSettings = this.context.plugin.settings.voice;
    voiceSettings.llmPresets.forEach(preset => {
      this.renderPresetItem(presetListEl, preset, onPresetOptionsChange);
    });
  }

  /**
   * 渲染单个预设项
   */
  private renderPresetItem(
    containerEl: HTMLElement,
    preset: VoiceLLMPreset,
    onPresetOptionsChange?: () => void
  ): void {
    const isEditing = this.editingPresetId === preset.id;
    const isDefault = DEFAULT_VOICE_LLM_PRESETS.some(p => p.id === preset.id);
    const isActive = this.context.plugin.settings.voice.activeLLMPresetId === preset.id;

    const itemEl = containerEl.createDiv({ cls: 'voice-preset-item' });
    if (isActive) {
      itemEl.addClass('is-active');
    }
    itemEl.style.padding = '12px';
    itemEl.style.marginBottom = '8px';
    itemEl.style.borderRadius = '6px';
    itemEl.style.backgroundColor = 'var(--background-primary)';
    itemEl.style.border = '1px solid var(--background-modifier-border)';

    if (isEditing) {
      // 编辑模式
      // 名称输入
      new Setting(itemEl)
        .setName(t('voice.settings.presetName'))
        .addText(text => text
          .setValue(preset.name)
          .onChange(async (value) => {
            const presetIndex = this.context.plugin.settings.voice.llmPresets.findIndex(p => p.id === preset.id);
            if (presetIndex !== -1) {
              this.context.plugin.settings.voice.llmPresets[presetIndex].name = value;
              await this.saveSettings();
            }
          }));

      // 系统提示词输入
      new Setting(itemEl)
        .setName(t('voice.settings.presetSystemPrompt'))
        .setDesc(t('voice.settings.presetSystemPromptDesc'));

      const textAreaEl = itemEl.createEl('textarea');
      textAreaEl.value = preset.systemPrompt;
      textAreaEl.rows = 6;
      textAreaEl.style.width = '100%';
      textAreaEl.style.marginTop = '8px';
      textAreaEl.style.resize = 'vertical';
      textAreaEl.addEventListener('change', async () => {
        const presetIndex = this.context.plugin.settings.voice.llmPresets.findIndex(p => p.id === preset.id);
        if (presetIndex !== -1) {
          this.context.plugin.settings.voice.llmPresets[presetIndex].systemPrompt = textAreaEl.value;
          await this.saveSettings();
        }
      });

      // 保存按钮
      new Setting(itemEl)
        .addButton(button => button
          .setButtonText(t('common.save'))
          .setCta()
          .onClick(() => {
            this.editingPresetId = null;
            if (onPresetOptionsChange) {
              onPresetOptionsChange();
            }
            // 使用局部更新替代全量刷新
            const presetListEl = containerEl;
            this.renderPresetList(presetListEl, onPresetOptionsChange);
          }));
    } else {
      // 显示模式
      const headerEl = itemEl.createDiv({ cls: 'preset-header' });
      headerEl.style.display = 'flex';
      headerEl.style.justifyContent = 'space-between';
      headerEl.style.alignItems = 'center';

      const nameEl = headerEl.createSpan({ text: preset.name });
      nameEl.style.fontWeight = '600';

      const actionsEl = headerEl.createDiv({ cls: 'preset-actions' });
      actionsEl.style.display = 'flex';
      actionsEl.style.gap = '8px';

      // 编辑按钮
      const editBtn = actionsEl.createEl('button', { cls: 'clickable-icon' });
      setIcon(editBtn, 'pencil');
      editBtn.setAttribute('aria-label', t('common.edit'));
      editBtn.addEventListener('click', () => {
        this.editingPresetId = preset.id;
        // 使用局部更新替代全量刷新
        const presetListEl = containerEl;
        this.renderPresetList(presetListEl, onPresetOptionsChange);
      });

      // 删除按钮（默认预设不可删除）
      if (!isDefault) {
        const deleteBtn = actionsEl.createEl('button', { cls: 'clickable-icon' });
        setIcon(deleteBtn, 'trash-2');
        deleteBtn.setAttribute('aria-label', t('common.delete'));
        deleteBtn.addEventListener('click', async () => {
          const presets = this.context.plugin.settings.voice.llmPresets;
          const index = presets.findIndex(p => p.id === preset.id);
          if (index !== -1) {
            presets.splice(index, 1);
            // 如果删除的是当前激活的预设，切换到第一个
            if (this.context.plugin.settings.voice.activeLLMPresetId === preset.id) {
              this.context.plugin.settings.voice.activeLLMPresetId = presets[0]?.id || 'polishing';
            }
            await this.saveSettings();
            if (onPresetOptionsChange) {
              onPresetOptionsChange();
            }
            // 使用局部更新替代全量刷新
            const presetListEl = containerEl;
            this.renderPresetList(presetListEl, onPresetOptionsChange);
          }
        });
      }

      // 预览系统提示词
      if (preset.systemPrompt) {
        const previewEl = itemEl.createDiv({ cls: 'preset-preview' });
        previewEl.style.marginTop = '8px';
        previewEl.style.fontSize = '0.85em';
        previewEl.style.color = 'var(--text-muted)';
        previewEl.style.whiteSpace = 'nowrap';
        previewEl.style.overflow = 'hidden';
        previewEl.style.textOverflow = 'ellipsis';
        previewEl.setText(preset.systemPrompt.substring(0, 100) + (preset.systemPrompt.length > 100 ? '...' : ''));
      }
    }
  }


  // ============================================================================
  // AI 助手配置设置
  // ============================================================================

  /**
   * 渲染 AI 助手配置设置
   */
  private renderAssistantSettings(containerEl: HTMLElement): void {
    const card = this.createCard(containerEl);
    const assistantConfig = this.context.plugin.settings.voice.assistantConfig;

    // 标题
    new Setting(card)
      .setName(t('voice.settings.assistantConfig'))
      .setDesc(t('voice.settings.assistantConfigDesc'))
      .setHeading();

    // 启用 AI 助手
    const enableAssistantSetting = new Setting(card)
      .setName(t('voice.settings.enableAssistant'))
      .setDesc(t('voice.settings.enableAssistantDesc'))
      .addToggle(toggle => toggle
        .setValue(assistantConfig.enabled)
        .onChange(async (value) => {
          this.context.plugin.settings.voice.assistantConfig.enabled = value;
          await this.saveSettings();
          
          // 使用局部更新替代全量刷新
          this.toggleConditionalSection(
            card,
            'assistant-config',
            value,
            (el) => this.renderAssistantConfigContent(el),
            enableAssistantSetting.settingEl
          );
        }));

    // AI 助手配置区域（仅在启用时显示）- 初始渲染
    this.toggleConditionalSection(
      card,
      'assistant-config',
      assistantConfig.enabled,
      (el) => this.renderAssistantConfigContent(el),
      enableAssistantSetting.settingEl
    );
  }

  /**
   * 渲染 AI 助手配置内容
   * 提取为独立方法，用于 toggleConditionalSection 调用
   */
  private renderAssistantConfigContent(container: HTMLElement): void {
    // 选择供应商和模型
    this.renderProviderModelBinding(container, 'assistant');

    // Q&A 系统提示词
    new Setting(container)
      .setName(t('voice.settings.qaSystemPrompt'))
      .setDesc(t('voice.settings.qaSystemPromptDesc'));

    const qaTextAreaEl = container.createEl('textarea');
    qaTextAreaEl.value = this.context.plugin.settings.voice.assistantConfig.qaSystemPrompt;
    qaTextAreaEl.rows = 6;
    qaTextAreaEl.style.width = '100%';
    qaTextAreaEl.style.marginBottom = '12px';
    qaTextAreaEl.style.resize = 'vertical';
    qaTextAreaEl.addEventListener('change', async () => {
      this.context.plugin.settings.voice.assistantConfig.qaSystemPrompt = qaTextAreaEl.value;
      await this.saveSettings();
    });

    // 重置 Q&A 提示词按钮
    new Setting(container)
      .addButton(button => button
        .setButtonText(t('voice.settings.resetQaPrompt'))
        .onClick(async () => {
          this.context.plugin.settings.voice.assistantConfig.qaSystemPrompt = DEFAULT_VOICE_ASSISTANT_QA_PROMPT;
          qaTextAreaEl.value = DEFAULT_VOICE_ASSISTANT_QA_PROMPT;
          await this.saveSettings();
        }));

    // 文本处理系统提示词
    new Setting(container)
      .setName(t('voice.settings.textProcessingSystemPrompt'))
      .setDesc(t('voice.settings.textProcessingSystemPromptDesc'));

    const textProcessingTextAreaEl = container.createEl('textarea');
    textProcessingTextAreaEl.value = this.context.plugin.settings.voice.assistantConfig.textProcessingSystemPrompt;
    textProcessingTextAreaEl.rows = 6;
    textProcessingTextAreaEl.style.width = '100%';
    textProcessingTextAreaEl.style.marginBottom = '12px';
    textProcessingTextAreaEl.style.resize = 'vertical';
    textProcessingTextAreaEl.addEventListener('change', async () => {
      this.context.plugin.settings.voice.assistantConfig.textProcessingSystemPrompt = textProcessingTextAreaEl.value;
      await this.saveSettings();
    });

    // 重置文本处理提示词按钮
    new Setting(container)
      .addButton(button => button
        .setButtonText(t('voice.settings.resetTextProcessingPrompt'))
        .onClick(async () => {
          this.context.plugin.settings.voice.assistantConfig.textProcessingSystemPrompt = DEFAULT_VOICE_ASSISTANT_TEXT_PROCESSING_PROMPT;
          textProcessingTextAreaEl.value = DEFAULT_VOICE_ASSISTANT_TEXT_PROCESSING_PROMPT;
          await this.saveSettings();
        }));
  }

  // ============================================================================
  // 其他设置
  // ============================================================================

  /**
   * 渲染其他设置
   */
  private renderOtherSettings(containerEl: HTMLElement): void {
    const card = this.createCard(containerEl);
    const voiceSettings = this.context.plugin.settings.voice;

    // 标题
    new Setting(card)
      .setName(t('voice.settings.otherSettings'))
      .setDesc(t('voice.settings.otherSettingsDesc'))
      .setHeading();

    // 音频反馈
    new Setting(card)
      .setName(t('voice.settings.enableAudioFeedback'))
      .setDesc(t('voice.settings.enableAudioFeedbackDesc'))
      .addToggle(toggle => toggle
        .setValue(voiceSettings.enableAudioFeedback)
        .onChange(async (value) => {
          this.context.plugin.settings.voice.enableAudioFeedback = value;
          await this.saveSettings();
        }));

    // 悬浮窗位置
    new Setting(card)
      .setName(t('voice.settings.overlayPosition'))
      .setDesc(t('voice.settings.overlayPositionDesc'))
      .addDropdown(dropdown => {
        Object.entries(getOverlayPositionNames()).forEach(([value, name]) => {
          dropdown.addOption(value, name);
        });
        dropdown
          .setValue(voiceSettings.overlayPosition)
          .onChange(async (value: string) => {
            this.context.plugin.settings.voice.overlayPosition = value as VoiceOverlayPosition;
            await this.saveSettings();
          });
      });

    // 可见性设置
    this.renderVisibilitySettings(card);
  }

  // ============================================================================
  // 可见性设置
  // ============================================================================

  /**
   * 渲染可见性设置
   */
  private renderVisibilitySettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t('voice.settings.visibility'))
      .setHeading();

    const visibilitySettings = this.context.plugin.settings.featureVisibility.voice;

    // 命令面板
    new Setting(containerEl)
      .setName(t('voice.settings.commandPalette'))
      .setDesc(t('voice.settings.commandPaletteDesc'))
      .addToggle(toggle => toggle
        .setValue(visibilitySettings.showInCommandPalette)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.voice.showInCommandPalette = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    // 编辑器右键菜单
    new Setting(containerEl)
      .setName(t('voice.settings.editorMenu'))
      .setDesc(t('voice.settings.editorMenuDesc'))
      .addToggle(toggle => toggle
        .setValue(visibilitySettings.showInEditorMenu)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.voice.showInEditorMenu = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    // 文件浏览器右键菜单
    new Setting(containerEl)
      .setName(t('voice.settings.fileMenu'))
      .setDesc(t('voice.settings.fileMenuDesc'))
      .addToggle(toggle => toggle
        .setValue(visibilitySettings.showInFileMenu)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.voice.showInFileMenu = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));
  }

  // ============================================================================
  // 历史记录设置
  // ============================================================================

  /**
   * 渲染历史记录设置
   */
  private renderHistorySettings(containerEl: HTMLElement): void {
    const card = this.createCard(containerEl);

    // 标题
    new Setting(card)
      .setName(t('voice.settings.historyTitle'))
      .setDesc(t('voice.settings.historyDesc'))
      .setHeading();

    // 搜索框
    new Setting(card)
      .setName(t('voice.settings.historySearch'))
      .addText(text => text
        .setPlaceholder(t('voice.settings.historySearchPlaceholder'))
        .setValue(this.historySearchQuery)
        .onChange(async (value) => {
          this.historySearchQuery = value;
          await this.loadAndFilterHistory();
          this.renderHistoryList(card);
        }));

    // 清空历史按钮
    new Setting(card)
      .addButton(button => button
        .setButtonText(t('voice.settings.clearHistory'))
        .setWarning()
        .onClick(async () => {
          if (this.historyManager) {
            await this.historyManager.clear();
            this.historyRecords = [];
            this.renderHistoryList(card);
            new Notice(t('voice.settings.historyCleared'));
          }
        }));

    // 历史记录列表容器
    const historyListEl = card.createDiv({ cls: 'voice-history-list' });
    historyListEl.id = 'voice-history-list';
    historyListEl.style.maxHeight = '400px';
    historyListEl.style.overflowY = 'auto';
    historyListEl.style.marginTop = '12px';

    // 初始化历史记录管理器并加载数据
    void this.initializeHistoryManager()
      .then(() => {
        this.renderHistoryList(card);
      })
      .catch((error) => {
        console.error('[VoiceSettingsRenderer] 初始化历史记录失败:', error);
      });
  }

  /**
   * 初始化历史记录管理器
   */
  private async initializeHistoryManager(): Promise<void> {
    if (!this.historyManager) {
      this.historyManager = new HistoryManager(this.context.app);
      await this.historyManager.initialize();
    }
    await this.loadAndFilterHistory();
  }

  /**
   * 加载并过滤历史记录
   */
  private async loadAndFilterHistory(): Promise<void> {
    if (!this.historyManager) {
      return;
    }

    if (this.historySearchQuery) {
      this.historyRecords = await this.historyManager.search(this.historySearchQuery);
    } else {
      this.historyRecords = await this.historyManager.getAll();
    }
  }

  /**
   * 渲染历史记录列表
   */
  private renderHistoryList(containerEl: HTMLElement): void {
    const listEl = containerEl.querySelector('#voice-history-list');
    if (!listEl) {
      return;
    }

    listEl.empty();

    if (this.historyRecords.length === 0) {
      const emptyEl = listEl.createDiv({ cls: 'voice-history-empty' });
      emptyEl.style.padding = '20px';
      emptyEl.style.textAlign = 'center';
      emptyEl.style.color = 'var(--text-muted)';
      emptyEl.setText(this.historySearchQuery 
        ? t('voice.settings.historyNoResults') 
        : t('voice.settings.historyEmpty'));
      return;
    }

    // 显示最近 50 条记录
    const displayRecords = this.historyRecords.slice(0, 50);

    displayRecords.forEach(record => {
      this.renderHistoryItem(listEl as HTMLElement, record);
    });

    // 如果有更多记录，显示提示
    if (this.historyRecords.length > 50) {
      const moreEl = listEl.createDiv({ cls: 'voice-history-more' });
      moreEl.style.padding = '12px';
      moreEl.style.textAlign = 'center';
      moreEl.style.color = 'var(--text-muted)';
      moreEl.style.fontSize = '0.85em';
      moreEl.setText(t('voice.settings.historyMore', { count: this.historyRecords.length - 50 }));
    }
  }

  /**
   * 渲染单条历史记录
   */
  private renderHistoryItem(containerEl: HTMLElement, record: TranscriptionHistory): void {
    const itemEl = containerEl.createDiv({ cls: 'voice-history-item' });
    itemEl.style.padding = '12px';
    itemEl.style.marginBottom = '8px';
    itemEl.style.borderRadius = '6px';
    itemEl.style.backgroundColor = 'var(--background-primary)';
    itemEl.style.border = '1px solid var(--background-modifier-border)';

    // 头部：时间和模式
    const headerEl = itemEl.createDiv({ cls: 'history-header' });
    headerEl.style.display = 'flex';
    headerEl.style.justifyContent = 'space-between';
    headerEl.style.alignItems = 'center';
    headerEl.style.marginBottom = '8px';

    const timeEl = headerEl.createSpan({ cls: 'history-time' });
    timeEl.style.fontSize = '0.85em';
    timeEl.style.color = 'var(--text-muted)';
    timeEl.setText(this.formatTimestamp(record.timestamp));

    const metaEl = headerEl.createDiv({ cls: 'history-meta' });
    metaEl.style.display = 'flex';
    metaEl.style.gap = '8px';
    metaEl.style.alignItems = 'center';

    // 模式标签
    const modeEl = metaEl.createSpan({ cls: 'history-mode' });
    modeEl.style.fontSize = '0.75em';
    modeEl.style.padding = '2px 6px';
    modeEl.style.borderRadius = '4px';
    modeEl.style.backgroundColor = record.mode === 'dictation' 
      ? 'var(--interactive-accent)' 
      : 'var(--text-accent)';
    modeEl.style.color = 'var(--text-on-accent)';
    modeEl.setText(record.mode === 'dictation' ? t('voice.settings.modeDictation') : t('voice.settings.modeAssistant'));

    // ASR 引擎
    const engineEl = metaEl.createSpan({ cls: 'history-engine' });
    engineEl.style.fontSize = '0.75em';
    engineEl.style.color = 'var(--text-muted)';
    engineEl.setText(record.asrEngine + (record.usedFallback ? ' (兜底)' : ''));

    // 统计信息行
    const statsEl = itemEl.createDiv({ cls: 'history-stats' });
    statsEl.style.display = 'flex';
    statsEl.style.gap = '12px';
    statsEl.style.marginBottom = '8px';
    statsEl.style.fontSize = '0.75em';
    statsEl.style.color = 'var(--text-muted)';

    // ASR 耗时
    if (record.asrDuration !== undefined) {
      const asrStatEl = statsEl.createSpan();
      asrStatEl.setText(`ASR ${(record.asrDuration / 1000).toFixed(2)}s`);
    }

    // LLM 耗时
    if (record.llmDuration !== undefined) {
      const llmStatEl = statsEl.createSpan();
      llmStatEl.setText(`LLM ${(record.llmDuration / 1000).toFixed(2)}s`);
    }

    // 总耗时
    const totalDuration = (record.asrDuration || 0) + (record.llmDuration || 0);
    if (totalDuration > 0) {
      const totalStatEl = statsEl.createSpan();
      totalStatEl.setText(`共 ${(totalDuration / 1000).toFixed(2)}s`);
    }

    // 字数
    if (record.charCount !== undefined) {
      const charStatEl = statsEl.createSpan();
      charStatEl.setText(`${record.charCount} 字`);
    }

    // 文本内容区域
    const textContainer = itemEl.createDiv({ cls: 'history-text-container' });
    textContainer.style.marginBottom = '8px';

    // 判断是否有 AI 处理后的文本
    const hasProcessedText = record.processedText && record.originalText !== record.processedText;

    if (hasProcessedText) {
      // 原文区域
      const originalSection = textContainer.createDiv({ cls: 'history-original-section' });
      originalSection.style.marginBottom = '8px';
      
      const originalLabel = originalSection.createDiv({ cls: 'history-text-label' });
      originalLabel.style.fontSize = '0.75em';
      originalLabel.style.color = 'var(--text-muted)';
      originalLabel.style.marginBottom = '4px';
      originalLabel.setText(t('voice.settings.originalTextLabel'));
      
      const originalText = originalSection.createDiv({ cls: 'history-text history-original-text' });
      originalText.style.padding = '8px';
      originalText.style.borderRadius = '4px';
      originalText.style.backgroundColor = 'var(--background-secondary)';
      originalText.style.fontSize = '0.9em';
      originalText.style.color = 'var(--text-muted)';
      const origDisplay = record.originalText.length > 200 
        ? record.originalText.substring(0, 200) + '...' 
        : record.originalText;
      originalText.setText(origDisplay);

      // AI 处理结果区域
      const processedSection = textContainer.createDiv({ cls: 'history-processed-section' });
      
      const processedLabel = processedSection.createDiv({ cls: 'history-text-label' });
      processedLabel.style.fontSize = '0.75em';
      processedLabel.style.color = 'var(--text-muted)';
      processedLabel.style.marginBottom = '4px';
      processedLabel.setText(t('voice.settings.processedTextLabel'));
      
      const processedText = processedSection.createDiv({ cls: 'history-text history-processed-text' });
      processedText.style.padding = '8px';
      processedText.style.borderRadius = '4px';
      processedText.style.backgroundColor = 'var(--background-secondary)';
      const procDisplay = record.processedText!.length > 200 
        ? record.processedText!.substring(0, 200) + '...' 
        : record.processedText!;
      processedText.setText(procDisplay);
    } else {
      // 只有原文，直接显示
      const textEl = textContainer.createDiv({ cls: 'history-text' });
      const displayText = record.originalText;
      textEl.setText(displayText.length > 200 ? displayText.substring(0, 200) + '...' : displayText);
    }

    // 操作按钮
    const actionsEl = itemEl.createDiv({ cls: 'history-actions' });
    actionsEl.style.display = 'flex';
    actionsEl.style.gap = '8px';

    // 复制按钮
    const copyBtn = actionsEl.createEl('button', { cls: 'mod-cta' });
    copyBtn.style.fontSize = '0.85em';
    copyBtn.setText(t('voice.settings.copyToClipboard'));
    copyBtn.addEventListener('click', async () => {
      const textToCopy = record.processedText || record.originalText;
      await navigator.clipboard.writeText(textToCopy);
      new Notice(t('voice.settings.copiedToClipboard'));
    });

    // 删除按钮
    const deleteBtn = actionsEl.createEl('button', { cls: 'clickable-icon' });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.setAttribute('aria-label', t('common.delete'));
    deleteBtn.addEventListener('click', async () => {
      if (this.historyManager) {
        await this.historyManager.deleteById(record.id);
        await this.loadAndFilterHistory();
        this.renderHistoryList(containerEl.parentElement as HTMLElement);
      }
    });
  }

  /**
   * 格式化时间戳
   */
  private formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString();
    } else if (diffDays === 1) {
      return t('voice.settings.yesterday') + ' ' + date.toLocaleTimeString();
    } else if (diffDays < 7) {
      return `${diffDays} ${t('voice.settings.daysAgo')}`;
    } else {
      return date.toLocaleDateString();
    }
  }
}
