/**
 * 标签生成设置渲染器
 * 负责渲染 AI 标签生成和智能归档配置
 */

import { Setting } from 'obsidian';
import type { RendererContext } from '../types';
import { BaseSettingsRenderer } from './baseRenderer';
import { DEFAULT_TAGGING_SETTINGS, DEFAULT_ARCHIVING_SETTINGS } from '../settings';
import { t } from '../../i18n';

/**
 * 标签生成设置渲染器
 */
export class TaggingSettingsRenderer extends BaseSettingsRenderer {
  /**
   * 渲染标签生成设置
   * @param context 渲染器上下文
   */
  render(context: RendererContext): void {
    this.context = context;
    const containerEl = context.containerEl;

    // AI 标签生成设置（包含模型配置）
    this.renderTaggingSettings(containerEl);

    // 智能归档设置（包含模型配置）
    this.renderArchivingSettings(containerEl);
  }

  /**
   * 渲染 AI 标签生成设置
   */
  private renderTaggingSettings(containerEl: HTMLElement): void {
    // 确保配置存在
    if (!this.context.plugin.settings.tagging) {
      this.context.plugin.settings.tagging = { ...DEFAULT_TAGGING_SETTINGS };
    }

    const taggingCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(taggingCard)
      .setName(t('tagging.settings.title'))
      .setDesc(t('tagging.settings.titleDesc'))
      .setHeading();

    const settings = this.context.plugin.settings.tagging;

    // 启用标签生成
    const enableSetting = new Setting(taggingCard)
      .setName(t('tagging.settings.enabled'))
      .setDesc(t('tagging.settings.enabledDesc'))
      .addToggle(toggle => toggle
        .setValue(settings.enabled)
        .onChange(async (value) => {
          settings.enabled = value;
          await this.saveSettings();
          // 使用 toggleConditionalSection 局部更新配置区域
          this.toggleConditionalSection(
            taggingCard,
            'tagging-config',
            value,
            (el) => this.renderTaggingConfig(el),
            enableSetting.settingEl
          );
        }));

    if (settings.enabled) {
      // 创建条件区域容器
      const configSection = taggingCard.createDiv({ cls: 'conditional-section-tagging-config' });
      this.renderTaggingConfig(configSection);
    }
  }

  /**
   * 渲染标签生成配置（供 toggleConditionalSection 使用）
   */
  private renderTaggingConfig(containerEl: HTMLElement): void {
    const settings = this.context.plugin.settings.tagging;
    
    // AI 模型配置（放在启用开关之后）
    this.renderTaggingModelBinding(containerEl);

    // 标签数量
    new Setting(containerEl)
      .setName(t('tagging.settings.tagCount'))
      .setDesc(t('tagging.settings.tagCountDesc'))
      .addSlider(slider => slider
        .setLimits(settings.minTagCount, settings.maxTagCount, 1)
        .setValue(settings.tagCount)
        .setDynamicTooltip()
        .onChange(async (value) => {
          settings.tagCount = value;
          await this.saveSettings();
        }));

    // 保留现有标签
    new Setting(containerEl)
      .setName(t('tagging.settings.preserveExisting'))
      .setDesc(t('tagging.settings.preserveExistingDesc'))
      .addToggle(toggle => toggle
        .setValue(settings.preserveExistingTags)
        .onChange(async (value) => {
          settings.preserveExistingTags = value;
          await this.saveSettings();
        }));

    // 自动应用
    new Setting(containerEl)
      .setName(t('tagging.settings.autoApply'))
      .setDesc(t('tagging.settings.autoApplyDesc'))
      .addToggle(toggle => toggle
        .setValue(settings.autoApply)
        .onChange(async (value) => {
          settings.autoApply = value;
          await this.saveSettings();
        }));

    // 显示设置
    new Setting(containerEl)
      .setName(t('tagging.settings.visibility'))
      .setHeading();

    const visibilitySettings = this.context.plugin.settings.featureVisibility.tagging;

    new Setting(containerEl)
      .setName(t('tagging.settings.commandPalette'))
      .setDesc(t('tagging.settings.commandPaletteDesc'))
      .addToggle(toggle => toggle
        .setValue(visibilitySettings.showInCommandPalette)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.tagging.showInCommandPalette = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    new Setting(containerEl)
      .setName(t('tagging.settings.editorMenu'))
      .setDesc(t('tagging.settings.editorMenuDesc'))
      .addToggle(toggle => toggle
        .setValue(visibilitySettings.showInEditorMenu)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.tagging.showInEditorMenu = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    new Setting(containerEl)
      .setName(t('tagging.settings.fileMenu'))
      .setDesc(t('tagging.settings.fileMenuDesc'))
      .addToggle(toggle => toggle
        .setValue(visibilitySettings.showInFileMenu)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.tagging.showInFileMenu = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    // 保存 textarea 引用用于重置
    let textareaEl: HTMLTextAreaElement | null = null;

    // Prompt 模板
    new Setting(containerEl)
      .setName(t('tagging.settings.promptTemplate'))
      .setDesc(t('tagging.settings.promptTemplateDesc'))
      .addTextArea(text => {
        textareaEl = text.inputEl;
        text
          .setValue(settings.promptTemplate)
          .onChange(async (value) => {
            settings.promptTemplate = value;
            await this.saveSettings();
          });
        text.inputEl.rows = 8;
        text.inputEl.style.width = '100%';
        text.inputEl.style.fontFamily = 'var(--font-monospace)';
        text.inputEl.style.fontSize = '12px';
      });

    // 重置按钮
    new Setting(containerEl)
      .setName(t('tagging.settings.resetToDefault'))
      .setDesc(t('tagging.settings.resetToDefaultDesc'))
      .addButton(button => button
        .setButtonText(t('common.reset'))
        .onClick(async () => {
          this.context.plugin.settings.tagging = { ...DEFAULT_TAGGING_SETTINGS };
          await this.saveSettings();
          // 局部更新 textarea 值，避免全量刷新
          if (textareaEl) {
            textareaEl.value = DEFAULT_TAGGING_SETTINGS.promptTemplate;
          }
        }));
  }

  /**
   * 渲染标签生成 AI 模型绑定
   */
  private renderTaggingModelBinding(containerEl: HTMLElement): void {
    const resolvedConfig = this.context.configManager.resolveFeatureConfig('tagging');
    const currentProvider = resolvedConfig?.provider;
    const currentModel = resolvedConfig?.model;

    const bindingSetting = new Setting(containerEl)
      .setName(t('tagging.settings.selectModel'))
      .setDesc(t('tagging.settings.selectModelDesc'));

    bindingSetting.addDropdown(dropdown => {
      const selectEl = dropdown.selectEl;
      selectEl.empty();
      selectEl.style.minWidth = '200px';

      // 添加空选项
      const emptyOption = selectEl.createEl('option', {
        value: '',
        text: t('tagging.settings.notBound')
      });
      emptyOption.setAttribute('value', '');

      // 按供应商分组添加选项
      const providers = this.context.configManager.getProviders();
      providers.forEach(provider => {
        if (provider.models.length === 0) return;
        const optgroup = selectEl.createEl('optgroup', { attr: { label: provider.name } });
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

      dropdown.onChange(async (value) => {
        if (!value) {
          delete this.context.plugin.settings.featureBindings.tagging;
        } else {
          const [providerId, modelId] = value.split('|');
          const existingBinding = this.context.plugin.settings.featureBindings.tagging;
          this.context.plugin.settings.featureBindings.tagging = {
            providerId,
            modelId,
            promptTemplate: existingBinding?.promptTemplate ?? this.context.plugin.settings.tagging.promptTemplate
          };
        }
        await this.saveSettings();
      });
    });

    // 绑定状态容器（用于局部更新）
    const statusContainerId = 'tagging-binding-status';
    const statusContainer = containerEl.createDiv({ cls: `conditional-section-${statusContainerId}` });
    
    // 显示绑定状态
    if (currentProvider && currentModel) {
      const displayName = currentModel.displayName || currentModel.name;
      const statusEl = statusContainer.createDiv({ cls: 'feature-binding-status' });
      statusEl.setCssProps({
        'font-size': '0.85em',
        color: 'var(--text-muted)',
        'margin-top': '8px',
        'margin-bottom': '16px',
        padding: '8px 12px',
        'background-color': 'var(--background-primary)',
        'border-radius': '4px'
      });
      statusEl.setText(t('tagging.settings.currentBinding', { provider: currentProvider.name, model: displayName }));
    } else {
      const warningEl = statusContainer.createDiv({ cls: 'feature-binding-warning' });
      warningEl.setCssProps({
        'font-size': '0.85em',
        color: 'var(--text-error)',
        'margin-top': '8px',
        'margin-bottom': '16px',
        padding: '8px 12px',
        'background-color': 'var(--background-primary)',
        'border-radius': '4px'
      });
      warningEl.setText(t('tagging.settings.notBoundWarning'));
    }
  }

  /**
   * 渲染智能归档设置
   */
  private renderArchivingSettings(containerEl: HTMLElement): void {
    if (!this.context.plugin.settings.archiving) {
      this.context.plugin.settings.archiving = { ...DEFAULT_ARCHIVING_SETTINGS };
    }

    const archivingCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(archivingCard)
      .setName(t('archiving.settings.title'))
      .setDesc(t('archiving.settings.titleDesc'))
      .setHeading();

    const settings = this.context.plugin.settings.archiving;

    // 启用归档
    const enableSetting = new Setting(archivingCard)
      .setName(t('archiving.settings.enabled'))
      .setDesc(t('archiving.settings.enabledDesc'))
      .addToggle(toggle => toggle
        .setValue(settings.enabled)
        .onChange(async (value) => {
          settings.enabled = value;
          await this.saveSettings();
          // 使用 toggleConditionalSection 局部更新配置区域
          this.toggleConditionalSection(
            archivingCard,
            'archiving-config',
            value,
            (el) => this.renderArchivingConfig(el),
            enableSetting.settingEl
          );
        }));

    if (settings.enabled) {
      // 创建条件区域容器
      const configSection = archivingCard.createDiv({ cls: 'conditional-section-archiving-config' });
      this.renderArchivingConfig(configSection);
    }
  }

  /**
   * 渲染归档配置（供 toggleConditionalSection 使用）
   */
  private renderArchivingConfig(containerEl: HTMLElement): void {
    const settings = this.context.plugin.settings.archiving;
    
    // AI 模型配置（放在启用开关之后）
    this.renderArchivingModelBinding(containerEl);

    // 归档基础文件夹
    new Setting(containerEl)
      .setName(t('archiving.settings.baseFolder'))
      .setDesc(t('archiving.settings.baseFolderDesc'))
      .addText(text => text
        .setPlaceholder(t('archiving.settings.baseFolderPlaceholder'))
        .setValue(settings.baseFolder)
        .onChange(async (value) => {
          settings.baseFolder = value;
          await this.saveSettings();
        }));

    // 最小置信度
    new Setting(containerEl)
      .setName(t('archiving.settings.minConfidence'))
      .setDesc(t('archiving.settings.minConfidenceDesc'))
      .addSlider(slider => slider
        .setLimits(0.5, 1, 0.05)
        .setValue(settings.minConfidence)
        .setDynamicTooltip()
        .onChange(async (value) => {
          settings.minConfidence = value;
          await this.saveSettings();
        }));

    // 允许创建新分类
    new Setting(containerEl)
      .setName(t('archiving.settings.createNewCategories'))
      .setDesc(t('archiving.settings.createNewCategoriesDesc'))
      .addToggle(toggle => toggle
        .setValue(settings.createNewCategories)
        .onChange(async (value) => {
          settings.createNewCategories = value;
          await this.saveSettings();
        }));

    // 归档前确认
    new Setting(containerEl)
      .setName(t('archiving.settings.confirmBeforeArchive'))
      .setDesc(t('archiving.settings.confirmBeforeArchiveDesc'))
      .addToggle(toggle => toggle
        .setValue(settings.confirmBeforeArchive)
        .onChange(async (value) => {
          settings.confirmBeforeArchive = value;
          await this.saveSettings();
        }));

    // 同时移动附件
    new Setting(containerEl)
      .setName(t('archiving.settings.moveAttachments'))
      .setDesc(t('archiving.settings.moveAttachmentsDesc'))
      .addToggle(toggle => toggle
        .setValue(settings.moveAttachments)
        .onChange(async (value) => {
          settings.moveAttachments = value;
          await this.saveSettings();
        }));

    // 自动更新链接
    new Setting(containerEl)
      .setName(t('archiving.settings.updateLinks'))
      .setDesc(t('archiving.settings.updateLinksDesc'))
      .addToggle(toggle => toggle
        .setValue(settings.updateLinks)
        .onChange(async (value) => {
          settings.updateLinks = value;
          await this.saveSettings();
        }));

    // 界面显示设置
    new Setting(containerEl)
      .setName(t('archiving.settings.visibility'))
      .setHeading();

    const archivingVisibilitySettings = this.context.plugin.settings.featureVisibility.archiving;

    new Setting(containerEl)
      .setName(t('archiving.settings.commandPalette'))
      .setDesc(t('archiving.settings.commandPaletteDesc'))
      .addToggle(toggle => toggle
        .setValue(archivingVisibilitySettings.showInCommandPalette)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.archiving.showInCommandPalette = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    new Setting(containerEl)
      .setName(t('archiving.settings.editorMenu'))
      .setDesc(t('archiving.settings.editorMenuDesc'))
      .addToggle(toggle => toggle
        .setValue(archivingVisibilitySettings.showInEditorMenu)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.archiving.showInEditorMenu = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    new Setting(containerEl)
      .setName(t('archiving.settings.fileMenu'))
      .setDesc(t('archiving.settings.fileMenuDesc'))
      .addToggle(toggle => toggle
        .setValue(archivingVisibilitySettings.showInFileMenu)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.archiving.showInFileMenu = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    // 保存 textarea 引用用于重置
    let textareaEl: HTMLTextAreaElement | null = null;

    // Prompt 模板
    new Setting(containerEl)
      .setName(t('archiving.settings.promptTemplate'))
      .setDesc(t('archiving.settings.promptTemplateDesc'))
      .addTextArea(text => {
        textareaEl = text.inputEl;
        text
          .setValue(settings.promptTemplate)
          .onChange(async (value) => {
            settings.promptTemplate = value;
            await this.saveSettings();
          });
        text.inputEl.rows = 10;
        text.inputEl.style.width = '100%';
        text.inputEl.style.fontFamily = 'var(--font-monospace)';
        text.inputEl.style.fontSize = '12px';
      });

    // 重置按钮
    new Setting(containerEl)
      .setName(t('archiving.settings.resetToDefault'))
      .setDesc(t('archiving.settings.resetToDefaultDesc'))
      .addButton(button => button
        .setButtonText(t('common.reset'))
        .onClick(async () => {
          this.context.plugin.settings.archiving = { ...DEFAULT_ARCHIVING_SETTINGS };
          await this.saveSettings();
          // 局部更新 textarea 值，避免全量刷新
          if (textareaEl) {
            textareaEl.value = DEFAULT_ARCHIVING_SETTINGS.promptTemplate;
          }
        }));
  }

  /**
   * 渲染归档 AI 模型绑定
   */
  private renderArchivingModelBinding(containerEl: HTMLElement): void {
    const resolvedConfig = this.context.configManager.resolveFeatureConfig('categorizing');
    const currentProvider = resolvedConfig?.provider;
    const currentModel = resolvedConfig?.model;

    const bindingSetting = new Setting(containerEl)
      .setName(t('archiving.settings.selectModel'))
      .setDesc(t('archiving.settings.selectModelDesc'));

    bindingSetting.addDropdown(dropdown => {
      const selectEl = dropdown.selectEl;
      selectEl.empty();
      selectEl.style.minWidth = '200px';

      const emptyOption = selectEl.createEl('option', {
        value: '',
        text: t('archiving.settings.notBound')
      });
      emptyOption.setAttribute('value', '');

      const providers = this.context.configManager.getProviders();
      providers.forEach(provider => {
        if (provider.models.length === 0) return;
        const optgroup = selectEl.createEl('optgroup', { attr: { label: provider.name } });
        provider.models.forEach(model => {
          const displayName = model.displayName || model.name;
          const option = optgroup.createEl('option', {
            value: `${provider.id}|${model.id}`,
            text: displayName
          });
          option.setAttribute('value', `${provider.id}|${model.id}`);
        });
      });

      const currentValue = currentProvider && currentModel
        ? `${currentProvider.id}|${currentModel.id}`
        : '';
      selectEl.value = currentValue;

      dropdown.onChange(async (value) => {
        if (!value) {
          delete this.context.plugin.settings.featureBindings.categorizing;
        } else {
          const [providerId, modelId] = value.split('|');
          const existingBinding = this.context.plugin.settings.featureBindings.categorizing;
          this.context.plugin.settings.featureBindings.categorizing = {
            providerId,
            modelId,
            promptTemplate: existingBinding?.promptTemplate ?? this.context.plugin.settings.archiving.promptTemplate
          };
        }
        await this.saveSettings();
      });
    });

    // 绑定状态容器（用于局部更新）
    const statusContainerId = 'archiving-binding-status';
    const statusContainer = containerEl.createDiv({ cls: `conditional-section-${statusContainerId}` });

    if (currentProvider && currentModel) {
      const displayName = currentModel.displayName || currentModel.name;
      const statusEl = statusContainer.createDiv({ cls: 'feature-binding-status' });
      statusEl.setCssProps({
        'font-size': '0.85em',
        color: 'var(--text-muted)',
        'margin-top': '8px',
        'margin-bottom': '16px',
        padding: '8px 12px',
        'background-color': 'var(--background-primary)',
        'border-radius': '4px'
      });
      statusEl.setText(t('archiving.settings.currentBinding', { provider: currentProvider.name, model: displayName }));
    } else {
      const warningEl = statusContainer.createDiv({ cls: 'feature-binding-warning' });
      warningEl.setCssProps({
        'font-size': '0.85em',
        color: 'var(--text-error)',
        'margin-top': '8px',
        'margin-bottom': '16px',
        padding: '8px 12px',
        'background-color': 'var(--background-primary)',
        'border-radius': '4px'
      });
      warningEl.setText(t('archiving.settings.notBoundWarning'));
    }
  }
}
