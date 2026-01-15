/**
 * 翻译设置渲染器
 * 负责渲染翻译功能的设置
 */

import { Setting, setIcon } from 'obsidian';
import type { RendererContext } from '../types';
import { SUPPORTED_LANGUAGES, LanguageCode } from '../types';
import { BaseSettingsRenderer } from './baseRenderer';
import { t, i18n } from '../../i18n';

/**
 * 翻译设置渲染器
 * 处理翻译功能的启用/禁用、AI 供应商绑定和默认设置
 */
export class TranslationSettingsRenderer extends BaseSettingsRenderer {
  /**
   * 渲染翻译设置
   * @param context 渲染器上下文
   */
  render(context: RendererContext): void {
    this.context = context;

    // 翻译功能区块（可折叠，默认收起）
    const isExpanded = this.context.expandedSections.has('translation-feature-expanded');
    
    // 功能卡片
    const translationCard = context.containerEl.createDiv({ cls: 'settings-card' });
    
    // 可折叠标题
    const headerEl = translationCard.createDiv({ cls: 'feature-header' });
    headerEl.setCssProps({
      display: 'flex',
      'align-items': 'center',
      gap: '8px',
      cursor: 'pointer',
      'user-select': 'none',
      'margin-bottom': isExpanded ? '20px' : '0'
    });

    // 展开/收缩图标
    const chevronEl = headerEl.createSpan({ cls: 'feature-chevron' });
    setIcon(chevronEl, isExpanded ? 'chevron-down' : 'chevron-right');
    chevronEl.setCssProps({
      width: '18px',
      height: '18px',
      display: 'inline-flex',
      'align-items': 'center'
    });

    // 功能名称
    const titleEl = headerEl.createSpan({ text: t('translation.settings.title') });
    titleEl.setCssProps({
      'font-weight': '600',
      'font-size': '1em'
    });

    // 点击切换展开状态
    headerEl.addEventListener('click', () => {
      if (isExpanded) {
        this.context.expandedSections.delete('translation-feature-expanded');
      } else {
        this.context.expandedSections.add('translation-feature-expanded');
      }
      this.refreshDisplay();
    });

    // 如果未展开，不渲染内容
    if (!isExpanded) {
      return;
    }

    // 内容容器
    const contentEl = translationCard.createDiv({ cls: 'feature-content' });

    // AI 供应商/模型绑定
    this.renderProviderBinding(contentEl);

    // 可见性设置
    this.renderVisibilitySettings(contentEl);

    // 翻译设置
    this.renderTranslationSettings(contentEl);
  }

  /**
   * 渲染 AI 供应商/模型绑定设置
   */
  private renderProviderBinding(containerEl: HTMLElement): void {
    // 获取当前 translation 功能的解析配置
    const resolvedConfig = this.context.configManager.resolveFeatureConfig('translation');
    const currentProvider = resolvedConfig?.provider;
    const currentModel = resolvedConfig?.model;

    // 模型绑定设置标题
    new Setting(containerEl)
      .setName(t('translation.settings.modelBinding'))
      .setHeading();

    // 供应商/模型绑定下拉框
    const bindingSetting = new Setting(containerEl)
      .setName(t('translation.settings.selectModel'))
      .setDesc(t('translation.settings.selectModelDesc'));

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
          delete this.context.plugin.settings.featureBindings.translation;
        } else {
          const [providerId, modelId] = value.split('|');
          this.context.plugin.settings.featureBindings.translation = {
            providerId,
            modelId,
            promptTemplate: '' // 翻译功能不需要自定义 prompt
          };
        }
        await this.saveSettings();
        this.refreshDisplay();
      });
    });

    // 显示当前绑定状态
    if (currentProvider && currentModel) {
      const displayName = currentModel.displayName || currentModel.name;
      const statusEl = containerEl.createDiv({ cls: 'feature-binding-status' });
      statusEl.setCssProps({
        'font-size': '0.85em',
        color: 'var(--text-muted)',
        'margin-top': '8px',
        'margin-bottom': '16px',
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
   * 渲染可见性设置
   */
  private renderVisibilitySettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t('translation.settings.visibility'))
      .setHeading();

    const visibilitySettings = this.context.plugin.settings.featureVisibility.translation;

    // 命令面板
    new Setting(containerEl)
      .setName(t('translation.settings.commandPalette'))
      .setDesc(t('translation.settings.commandPaletteDesc'))
      .addToggle(toggle => toggle
        .setValue(visibilitySettings.showInCommandPalette)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.translation.showInCommandPalette = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    // 编辑器右键菜单
    new Setting(containerEl)
      .setName(t('translation.settings.editorMenu'))
      .setDesc(t('translation.settings.editorMenuDesc'))
      .addToggle(toggle => toggle
        .setValue(visibilitySettings.showInEditorMenu)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.translation.showInEditorMenu = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    // 文件浏览器右键菜单
    new Setting(containerEl)
      .setName(t('translation.settings.fileMenu'))
      .setDesc(t('translation.settings.fileMenuDesc'))
      .addToggle(toggle => toggle
        .setValue(visibilitySettings.showInFileMenu)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.translation.showInFileMenu = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));
  }

  /**
   * 渲染翻译设置
   */
  private renderTranslationSettings(containerEl: HTMLElement): void {
    const translationSettings = this.context.plugin.settings.translation;
    const isZhUI = i18n.getLocale() === 'zh-CN';

    // LLM 语言检测开关
    new Setting(containerEl)
      .setName(t('translation.settings.enableLLMDetection'))
      .setDesc(t('translation.settings.enableLLMDetectionDesc'))
      .addToggle(toggle => toggle
        .setValue(translationSettings.enableLLMDetection)
        .onChange(async (value) => {
          this.context.plugin.settings.translation.enableLLMDetection = value;
          await this.saveSettings();
        }));

    // 默认目标语言下拉框
    new Setting(containerEl)
      .setName(t('translation.settings.defaultTargetLanguage'))
      .setDesc(t('translation.settings.defaultTargetLanguageDesc'))
      .addDropdown(dropdown => {
        // 添加语言选项（排除 auto）
        Object.entries(SUPPORTED_LANGUAGES).forEach(([code, info]) => {
          if (code === 'auto') return;
          const displayName = isZhUI ? info.nameZh : info.name;
          dropdown.addOption(code, displayName);
        });

        dropdown
          .setValue(translationSettings.defaultTargetLanguage)
          .onChange(async (value) => {
            this.context.plugin.settings.translation.defaultTargetLanguage = value as LanguageCode;
            await this.saveSettings();
          });
      });

    // 默认显示原文开关
    new Setting(containerEl)
      .setName(t('translation.settings.showOriginalByDefault'))
      .setDesc(t('translation.settings.showOriginalByDefaultDesc'))
      .addToggle(toggle => toggle
        .setValue(translationSettings.showOriginalByDefault)
        .onChange(async (value) => {
          this.context.plugin.settings.translation.showOriginalByDefault = value;
          await this.saveSettings();
        }));
  }
}
