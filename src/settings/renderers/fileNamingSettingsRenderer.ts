/**
 * 文件名生成设置渲染器
 * 负责渲染 AI 文件名生成功能设置
 */

import { Setting, setIcon } from 'obsidian';
import type { RendererContext } from '../types';
import { BASE_PROMPT_TEMPLATE, ADVANCED_PROMPT_TEMPLATE } from '../settings';
import { BaseSettingsRenderer } from './baseRenderer';
import { t } from '../../i18n';

/**
 * 文件名生成设置渲染器
 * 处理 AI 命名行为、Prompt 模板设置的渲染
 */
export class FileNamingSettingsRenderer extends BaseSettingsRenderer {
  /**
   * 渲染功能显示设置
   */
  private renderVisibilitySettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t('settingsDetails.naming.visibilitySettings'))
      .setHeading();

    new Setting(containerEl)
      .setName(t('settingsDetails.advanced.showInCommandPalette'))
      .setDesc(t('settingsDetails.advanced.showInCommandPaletteDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.featureVisibility.aiNaming.showInCommandPalette)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.aiNaming.showInCommandPalette = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    new Setting(containerEl)
      .setName(t('settingsDetails.advanced.showInEditorMenu'))
      .setDesc(t('settingsDetails.advanced.showInEditorMenuDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.featureVisibility.aiNaming.showInEditorMenu)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.aiNaming.showInEditorMenu = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    new Setting(containerEl)
      .setName(t('settingsDetails.advanced.showInFileMenu'))
      .setDesc(t('settingsDetails.advanced.showInFileMenuDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.featureVisibility.aiNaming.showInFileMenu)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.aiNaming.showInFileMenu = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    new Setting(containerEl)
      .setName(t('settingsDetails.advanced.showInRibbon'))
      .setDesc(t('settingsDetails.advanced.showInRibbonDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.featureVisibility.aiNaming.showInRibbon)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.aiNaming.showInRibbon = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));
  }

  /**
   * 渲染模型绑定设置
   */
  private renderModelBinding(containerEl: HTMLElement): void {
    // 获取当前 naming 功能的解析配置
    const resolvedConfig = this.context.configManager.resolveFeatureConfig('naming');
    const currentProvider = resolvedConfig?.provider;
    const currentModel = resolvedConfig?.model;

    // 模型绑定设置
    new Setting(containerEl)
      .setName(t('settingsDetails.naming.modelBinding'))
      .setHeading();

    const bindingSetting = new Setting(containerEl)
      .setName(t('settingsDetails.naming.selectModel'))
      .setDesc(t('settingsDetails.naming.selectModelDesc'));

    // 使用自定义 select 元素支持 optgroup
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
   * 渲染文件名生成设置
   * @param context 渲染器上下文
   */
  render(context: RendererContext): void {
    this.context = context;

    // 功能卡片
    const namingCard = context.containerEl.createDiv({ cls: 'settings-card' });

    // 模型绑定设置
    this.renderModelBinding(namingCard);

    // 命名行为设置
    new Setting(namingCard)
      .setName(t('settingsDetails.naming.namingBehavior'))
      .setHeading();

    // 使用当前文件名上下文
    new Setting(namingCard)
      .setName(t('settingsDetails.naming.useCurrentFilename'))
      .setDesc(t('settingsDetails.naming.useCurrentFilenameDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.useCurrentFileNameContext)
        .onChange(async (value) => {
          this.context.plugin.settings.useCurrentFileNameContext = value;
          await this.saveSettings();
        }));

    // 重命名前确认
    new Setting(namingCard)
      .setName(t('settingsDetails.naming.confirmBeforeRename'))
      .setDesc(t('settingsDetails.naming.confirmBeforeRenameDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.confirmBeforeRename)
        .onChange(async (value) => {
          this.context.plugin.settings.confirmBeforeRename = value;
          await this.saveSettings();
        }));

    // 分析目录命名风格
    new Setting(namingCard)
      .setName(t('settingsDetails.naming.analyzeDirectory'))
      .setDesc(t('settingsDetails.naming.analyzeDirectoryDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.analyzeDirectoryNamingStyle)
        .onChange(async (value) => {
          this.context.plugin.settings.analyzeDirectoryNamingStyle = value;
          await this.saveSettings();
        }));

    // 请求超时设置
    const timeoutSetting = new Setting(namingCard)
      .setName(t('settingsDetails.general.timeout'))
      .setDesc(t('settingsDetails.general.timeoutDesc'));
    
    let timeoutTextComponent: any;
    timeoutSetting.addText(text => {
      timeoutTextComponent = text;
      text
        .setPlaceholder('15')
        .setValue(String(Math.round(this.context.plugin.settings.timeout / 1000)))
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            // 范围约束：5-120秒
            const clampedValue = Math.max(5, Math.min(120, numValue));
            this.context.plugin.settings.timeout = clampedValue * 1000;
            await this.saveSettings();
          }
        });
      
      // 失去焦点时验证并修正
      text.inputEl.addEventListener('blur', async () => {
        const value = text.inputEl.value;
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 5 || numValue > 120) {
          // 恢复到有效范围
          const clampedValue = isNaN(numValue) ? 15 : Math.max(5, Math.min(120, numValue));
          this.context.plugin.settings.timeout = clampedValue * 1000;
          await this.saveSettings();
          text.setValue(String(clampedValue));
        }
      });
      
      text.inputEl.setCssProps({ width: '60px' });
      return text;
    });

    // 重置按钮
    timeoutSetting.addExtraButton(button => {
      button
        .setIcon('rotate-ccw')
        .setTooltip(t('common.reset'))
        .onClick(async () => {
          this.context.plugin.settings.timeout = 15000;
          await this.saveSettings();
          if (timeoutTextComponent) {
            timeoutTextComponent.setValue('15');
          }
        });
    });

    // Prompt 模板设置
    new Setting(namingCard)
      .setName(t('settingsDetails.naming.promptTemplate'))
      .setHeading();

    const promptDesc = namingCard.createEl('div', { cls: 'setting-item-description' });
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

    // 基础模板编辑器
    new Setting(namingCard)
      .setName(t('settingsDetails.naming.basePromptTemplate'))
      .setDesc(t('settingsDetails.naming.basePromptTemplateDesc'))
      .setHeading();

    let baseTemplateTextArea: any;
    new Setting(namingCard)
      .addTextArea(text => {
        baseTemplateTextArea = text;
        text
          .setValue(this.context.plugin.settings.basePromptTemplate ?? BASE_PROMPT_TEMPLATE)
          .onChange(async (value) => {
            this.context.plugin.settings.basePromptTemplate = value;
            await this.saveSettings();
          });
        text.inputEl.rows = 8;
        text.inputEl.cols = 50;
        text.inputEl.style.width = '100%';
      });

    // 基础模板重置按钮
    new Setting(namingCard)
      .addButton(button => button
        .setButtonText(t('settingsDetails.naming.resetToDefault'))
        .onClick(async () => {
          this.context.plugin.settings.basePromptTemplate = BASE_PROMPT_TEMPLATE;
          await this.saveSettings();
          // 直接更新 TextArea 的值
          if (baseTemplateTextArea) {
            baseTemplateTextArea.setValue(BASE_PROMPT_TEMPLATE);
          }
        }));

    // 高级模板编辑器
    new Setting(namingCard)
      .setName(t('settingsDetails.naming.advancedPromptTemplate'))
      .setDesc(t('settingsDetails.naming.advancedPromptTemplateDesc'))
      .setHeading();

    let advancedTemplateTextArea: any;
    new Setting(namingCard)
      .addTextArea(text => {
        advancedTemplateTextArea = text;
        text
          .setValue(this.context.plugin.settings.advancedPromptTemplate ?? ADVANCED_PROMPT_TEMPLATE)
          .onChange(async (value) => {
            this.context.plugin.settings.advancedPromptTemplate = value;
            await this.saveSettings();
          });
        text.inputEl.rows = 10;
        text.inputEl.cols = 50;
        text.inputEl.style.width = '100%';
      });

    // 高级模板重置按钮
    new Setting(namingCard)
      .addButton(button => button
        .setButtonText(t('settingsDetails.naming.resetToDefault'))
        .onClick(async () => {
          this.context.plugin.settings.advancedPromptTemplate = ADVANCED_PROMPT_TEMPLATE;
          await this.saveSettings();
          // 直接更新 TextArea 的值
          if (advancedTemplateTextArea) {
            advancedTemplateTextArea.setValue(ADVANCED_PROMPT_TEMPLATE);
          }
        }));

    // 功能显示设置
    this.renderVisibilitySettings(namingCard);
  }
}
