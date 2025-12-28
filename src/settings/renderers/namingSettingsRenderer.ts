/**
 * 命名设置渲染器
 * 负责渲染 AI 命名功能和选中工具栏功能设置
 */

import { Setting, setIcon } from 'obsidian';
import type { RendererContext } from '../types';
import { BASE_PROMPT_TEMPLATE, ADVANCED_PROMPT_TEMPLATE } from '../settings';
import { BaseSettingsRenderer } from './baseRenderer';
import { t } from '../../i18n';

/**
 * 命名设置渲染器
 * 处理 AI 命名行为、Prompt 模板和选中工具栏功能设置的渲染
 */
export class NamingSettingsRenderer extends BaseSettingsRenderer {
  /**
   * 渲染命名设置
   * @param context 渲染器上下文
   */
  render(context: RendererContext): void {
    this.context = context;

    // AI 命名功能区块（可折叠，默认展开）
    const isNamingExpanded = !this.context.expandedSections.has('naming-feature-collapsed');
    
    // 功能卡片
    const namingCard = context.containerEl.createDiv();
    namingCard.style.padding = '16px';
    namingCard.style.borderRadius = '8px';
    namingCard.style.backgroundColor = 'var(--background-secondary)';
    namingCard.style.marginBottom = '10px';
    
    // 可折叠标题
    const headerEl = namingCard.createDiv({ cls: 'feature-header' });
    headerEl.setCssProps({
      display: 'flex',
      'align-items': 'center',
      gap: '8px',
      cursor: 'pointer',
      'user-select': 'none',
      'margin-bottom': isNamingExpanded ? '20px' : '0'
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
        this.context.expandedSections.add('naming-feature-collapsed');
      } else {
        this.context.expandedSections.delete('naming-feature-collapsed');
      }
      this.refreshDisplay();
    });

    // 如果未展开，不渲染内容，但继续渲染选中工具栏设置
    if (!isNamingExpanded) {
      // 选中工具栏功能设置（独立卡片）
      this.renderSelectionToolbarFunctionSettings(context.containerEl);
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
        .setValue(this.context.plugin.settings.useCurrentFileNameContext)
        .onChange(async (value) => {
          this.context.plugin.settings.useCurrentFileNameContext = value;
          await this.saveSettings();
        }));

    // 重命名前确认
    new Setting(contentEl)
      .setName(t('settingsDetails.naming.confirmBeforeRename'))
      .setDesc(t('settingsDetails.naming.confirmBeforeRenameDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.confirmBeforeRename)
        .onChange(async (value) => {
          this.context.plugin.settings.confirmBeforeRename = value;
          await this.saveSettings();
        }));

    // 分析目录命名风格
    new Setting(contentEl)
      .setName(t('settingsDetails.naming.analyzeDirectory'))
      .setDesc(t('settingsDetails.naming.analyzeDirectoryDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.analyzeDirectoryNamingStyle)
        .onChange(async (value) => {
          this.context.plugin.settings.analyzeDirectoryNamingStyle = value;
          await this.saveSettings();
        }));

    // 请求超时设置
    const timeoutSetting = new Setting(contentEl)
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

    // 基础模板编辑器
    new Setting(contentEl)
      .setName(t('settingsDetails.naming.basePromptTemplate'))
      .setDesc(t('settingsDetails.naming.basePromptTemplateDesc'))
      .setHeading();

    new Setting(contentEl)
      .addTextArea(text => {
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
    new Setting(contentEl)
      .addButton(button => button
        .setButtonText(t('settingsDetails.naming.resetToDefault'))
        .onClick(async () => {
          this.context.plugin.settings.basePromptTemplate = BASE_PROMPT_TEMPLATE;
          await this.saveSettings();
          this.refreshDisplay();
        }));

    // 高级模板编辑器
    new Setting(contentEl)
      .setName(t('settingsDetails.naming.advancedPromptTemplate'))
      .setDesc(t('settingsDetails.naming.advancedPromptTemplateDesc'))
      .setHeading();

    new Setting(contentEl)
      .addTextArea(text => {
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
    new Setting(contentEl)
      .addButton(button => button
        .setButtonText(t('settingsDetails.naming.resetToDefault'))
        .onClick(async () => {
          this.context.plugin.settings.advancedPromptTemplate = ADVANCED_PROMPT_TEMPLATE;
          await this.saveSettings();
          this.refreshDisplay();
        }));

    // 选中工具栏功能设置
    this.renderSelectionToolbarFunctionSettings(context.containerEl);
  }


  /**
   * 渲染选中工具栏功能设置（最小选中字符数、显示延迟）
   * 可折叠卡片，与文件命名设置风格一致
   * Requirements: 4.3, 4.4
   */
  private renderSelectionToolbarFunctionSettings(containerEl: HTMLElement): void {
    // 选中工具栏功能区块（可折叠，默认收起）
    const isExpanded = !this.context.expandedSections.has('selection-toolbar-collapsed');
    
    // 功能卡片
    const toolbarCard = containerEl.createDiv();
    toolbarCard.style.padding = '16px';
    toolbarCard.style.borderRadius = '8px';
    toolbarCard.style.backgroundColor = 'var(--background-secondary)';
    toolbarCard.style.marginBottom = '10px';
    
    // 可折叠标题
    const headerEl = toolbarCard.createDiv({ cls: 'feature-header' });
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
    const titleEl = headerEl.createSpan({ text: t('selectionToolbar.settings.title') });
    titleEl.setCssProps({
      'font-weight': '600',
      'font-size': '1em'
    });

    // 点击切换展开状态
    headerEl.addEventListener('click', () => {
      if (isExpanded) {
        this.context.expandedSections.add('selection-toolbar-collapsed');
      } else {
        this.context.expandedSections.delete('selection-toolbar-collapsed');
      }
      this.refreshDisplay();
    });

    // 如果未展开，不渲染内容
    if (!isExpanded) {
      return;
    }

    // 内容容器
    const contentEl = toolbarCard.createDiv({ cls: 'feature-content' });

    // 最小选中字符数 - Requirements: 4.3
    const minLengthSetting = new Setting(contentEl)
      .setName(t('selectionToolbar.settings.minSelectionLength'))
      .setDesc(t('selectionToolbar.settings.minSelectionLengthDesc'));
    
    let minLengthTextComponent: any;
    minLengthSetting.addText(text => {
      minLengthTextComponent = text;
      text
        .setPlaceholder('1')
        .setValue(String(this.context.plugin.settings.selectionToolbar.minSelectionLength))
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            // 范围约束：1-100
            const clampedValue = Math.max(1, Math.min(100, numValue));
            this.context.plugin.settings.selectionToolbar.minSelectionLength = clampedValue;
            await this.saveSettings();
            this.context.plugin.updateSelectionToolbarSettings();
          }
        });
      
      // 失去焦点时验证并修正
      text.inputEl.addEventListener('blur', async () => {
        const value = text.inputEl.value;
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 1 || numValue > 100) {
          // 恢复到有效范围
          const clampedValue = isNaN(numValue) ? 1 : Math.max(1, Math.min(100, numValue));
          this.context.plugin.settings.selectionToolbar.minSelectionLength = clampedValue;
          await this.saveSettings();
          text.setValue(String(clampedValue));
          this.context.plugin.updateSelectionToolbarSettings();
        }
      });
      
      text.inputEl.setCssProps({ width: '60px' });
      return text;
    });

    // 重置按钮
    minLengthSetting.addExtraButton(button => {
      button
        .setIcon('rotate-ccw')
        .setTooltip(t('common.reset'))
        .onClick(async () => {
          this.context.plugin.settings.selectionToolbar.minSelectionLength = 1;
          await this.saveSettings();
          this.context.plugin.updateSelectionToolbarSettings();
          if (minLengthTextComponent) {
            minLengthTextComponent.setValue('1');
          }
        });
    });

    // 显示延迟 - Requirements: 4.4
    const showDelaySetting = new Setting(contentEl)
      .setName(t('selectionToolbar.settings.showDelay'))
      .setDesc(t('selectionToolbar.settings.showDelayDesc'));
    
    let showDelayTextComponent: any;
    showDelaySetting.addText(text => {
      showDelayTextComponent = text;
      text
        .setPlaceholder('0')
        .setValue(String(this.context.plugin.settings.selectionToolbar.showDelay))
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            // 范围约束：0-1000
            const clampedValue = Math.max(0, Math.min(1000, numValue));
            this.context.plugin.settings.selectionToolbar.showDelay = clampedValue;
            await this.saveSettings();
            this.context.plugin.updateSelectionToolbarSettings();
          }
        });
      
      // 失去焦点时验证并修正
      text.inputEl.addEventListener('blur', async () => {
        const value = text.inputEl.value;
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 0 || numValue > 1000) {
          // 恢复到有效范围
          const clampedValue = isNaN(numValue) ? 0 : Math.max(0, Math.min(1000, numValue));
          this.context.plugin.settings.selectionToolbar.showDelay = clampedValue;
          await this.saveSettings();
          text.setValue(String(clampedValue));
          this.context.plugin.updateSelectionToolbarSettings();
        }
      });
      
      text.inputEl.setCssProps({ width: '60px' });
      return text;
    });

    // 重置按钮
    showDelaySetting.addExtraButton(button => {
      button
        .setIcon('rotate-ccw')
        .setTooltip(t('common.reset'))
        .onClick(async () => {
          this.context.plugin.settings.selectionToolbar.showDelay = 0;
          await this.saveSettings();
          this.context.plugin.updateSelectionToolbarSettings();
          if (showDelayTextComponent) {
            showDelayTextComponent.setValue('0');
          }
        });
    });
  }
}
