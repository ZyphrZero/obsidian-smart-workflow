/**
 * 命名设置渲染器
 * 负责渲染 AI 命名功能、选中工具栏功能和写作功能设置
 */

import { Setting, setIcon } from 'obsidian';
import type { RendererContext } from '../types';
import { BASE_PROMPT_TEMPLATE, ADVANCED_PROMPT_TEMPLATE } from '../settings';
import { BaseSettingsRenderer } from './baseRenderer';
import { WritingSettingsRenderer } from './writingSettingsRenderer';
import { t } from '../../i18n';

/**
 * 命名设置渲染器
 * 处理 AI 命名行为、Prompt 模板、选中工具栏功能和写作功能设置的渲染
 */
export class NamingSettingsRenderer extends BaseSettingsRenderer {
  // 写作设置渲染器实例
  private writingRenderer: WritingSettingsRenderer;

  constructor() {
    super();
    this.writingRenderer = new WritingSettingsRenderer();
  }

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

    // 如果未展开，不渲染内容，但继续渲染选中工具栏设置和写作设置
    if (!isNamingExpanded) {
      // 选中工具栏功能设置（独立卡片）
      this.renderSelectionToolbarFunctionSettings(context.containerEl);
      // 写作功能设置
      this.writingRenderer.render(context);
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

    // 写作功能设置
    this.writingRenderer.render(context);
  }


  /**
   * 渲染选中工具栏功能设置（最小选中字符数、显示延迟、按钮配置）
   * 可折叠卡片，与文件命名设置风格一致

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

    // 启用开关
    new Setting(contentEl)
      .setName(t('selectionToolbar.settings.enabled'))
      .setDesc(t('selectionToolbar.settings.enabledDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.selectionToolbar.enabled)
        .onChange(async (value) => {
          this.context.plugin.settings.selectionToolbar.enabled = value;
          await this.saveSettings();
          this.context.plugin.updateSelectionToolbarSettings();
        }));

    // 最小选中字符数
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

    // 显示延迟
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

    // 按钮配置区域
    this.renderButtonConfigs(contentEl);
  }

  /**
   * 渲染按钮配置列表（支持拖拽排序）
   */
  private renderButtonConfigs(containerEl: HTMLElement): void {
    // 按钮配置标题
    new Setting(containerEl)
      .setName(t('selectionToolbar.settings.buttonConfig'))
      .setDesc(t('selectionToolbar.settings.buttonConfigDesc'))
      .setHeading();

    // 按钮列表容器
    const buttonListEl = containerEl.createDiv({ cls: 'toolbar-button-list' });
    buttonListEl.setCssProps({
      'margin-top': '8px'
    });

    // 获取按钮配置，按 order 排序
    const buttonConfigs = [...(this.context.plugin.settings.selectionToolbar.buttonConfigs || [])];
    buttonConfigs.sort((a, b) => a.order - b.order);

    // 按钮名称映射
    const buttonNames: Record<string, string> = {
      copy: t('selectionToolbar.actions.copy'),
      search: t('selectionToolbar.actions.search'),
      createLink: t('selectionToolbar.actions.createLink'),
      highlight: t('selectionToolbar.actions.highlight'),
      bold: t('selectionToolbar.actions.bold'),
      italic: t('selectionToolbar.actions.italic'),
      strikethrough: t('selectionToolbar.actions.strikethrough'),
      inlineCode: t('selectionToolbar.actions.inlineCode'),
      inlineMath: t('selectionToolbar.actions.inlineMath'),
      clearFormat: t('selectionToolbar.actions.clearFormat'),
      writing: t('writing.menu.writing')
    };

    // 默认图标映射
    const defaultIcons: Record<string, string> = {
      copy: 'copy',
      search: 'search',
      createLink: 'link',
      highlight: 'highlighter',
      bold: 'bold',
      italic: 'italic',
      strikethrough: 'strikethrough',
      inlineCode: 'code',
      inlineMath: 'sigma',
      clearFormat: 'eraser',
      writing: 'pen-tool'
    };

    // 拖拽状态
    let draggedIndex: number | null = null;

    // 渲染每个按钮配置项
    buttonConfigs.forEach((config, index) => {
      const itemEl = buttonListEl.createDiv({ cls: 'toolbar-button-item' });
      itemEl.setAttribute('draggable', 'true');
      itemEl.setAttribute('data-index', String(index));
      itemEl.setCssProps({
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        padding: '8px 10px',
        'margin-bottom': '4px',
        'background-color': 'var(--background-primary)',
        'border-radius': '6px',
        cursor: 'grab',
        transition: 'all 0.2s ease',
        'border-left': '3px solid transparent'
      });

      // 拖拽事件
      itemEl.addEventListener('dragstart', (e) => {
        draggedIndex = index;
        itemEl.style.opacity = '0.4';
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
        }
      });

      itemEl.addEventListener('dragend', () => {
        draggedIndex = null;
        itemEl.style.opacity = '1';
        itemEl.style.borderLeftColor = 'transparent';
      });

      itemEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (draggedIndex !== null && draggedIndex !== index) {
          itemEl.style.backgroundColor = 'var(--background-modifier-hover)';
          itemEl.style.borderLeftColor = 'var(--interactive-accent)';
        }
      });

      itemEl.addEventListener('dragleave', () => {
        itemEl.style.backgroundColor = 'var(--background-primary)';
        itemEl.style.borderLeftColor = 'transparent';
      });

      itemEl.addEventListener('drop', async (e) => {
        e.preventDefault();
        itemEl.style.backgroundColor = 'var(--background-primary)';
        itemEl.style.borderLeftColor = 'transparent';
        
        if (draggedIndex !== null && draggedIndex !== index) {
          // 重新排序
          const configs = this.context.plugin.settings.selectionToolbar.buttonConfigs;
          const [removed] = configs.splice(draggedIndex, 1);
          configs.splice(index, 0, removed);
          
          // 更新 order 值
          configs.forEach((c, i) => { c.order = i; });
          
          await this.saveSettings();
          this.context.plugin.updateSelectionToolbarSettings();
          this.refreshDisplay();
        }
      });

      // 拖拽手柄
      const dragHandle = itemEl.createSpan({ cls: 'drag-handle' });
      setIcon(dragHandle, 'grip-vertical');
      dragHandle.setCssProps({
        color: 'var(--text-faint)',
        cursor: 'grab',
        display: 'inline-flex',
        'align-items': 'center',
        'flex-shrink': '0'
      });

      // 启用开关
      const toggleEl = itemEl.createEl('input', { type: 'checkbox' });
      toggleEl.checked = config.enabled;
      toggleEl.setCssProps({
        'flex-shrink': '0'
      });
      toggleEl.addEventListener('change', async () => {
        config.enabled = toggleEl.checked;
        await this.saveSettings();
        this.context.plugin.updateSelectionToolbarSettings();
      });

      // 图标预览
      const iconPreview = itemEl.createSpan({ cls: 'button-icon-preview' });
      setIcon(iconPreview, config.customIcon || defaultIcons[config.id] || 'circle');
      iconPreview.setCssProps({
        display: 'inline-flex',
        'align-items': 'center',
        'justify-content': 'center',
        width: '20px',
        height: '20px',
        color: 'var(--text-muted)',
        'flex-shrink': '0'
      });

      // 按钮名称
      const nameEl = itemEl.createSpan({ cls: 'button-name' });
      nameEl.setText(buttonNames[config.id] || config.id);
      nameEl.setCssProps({
        flex: '1',
        'font-size': '0.9em'
      });

      // 显示文字开关
      const showLabelContainer = itemEl.createDiv({ cls: 'show-label-toggle' });
      showLabelContainer.setCssProps({
        display: 'flex',
        'align-items': 'center',
        gap: '4px',
        'flex-shrink': '0'
      });
      
      const showLabelLabel = showLabelContainer.createSpan();
      showLabelLabel.setText(t('selectionToolbar.settings.showLabel'));
      showLabelLabel.setCssProps({
        'font-size': '0.8em',
        color: 'var(--text-muted)'
      });
      
      const showLabelToggle = showLabelContainer.createEl('input', { type: 'checkbox' });
      showLabelToggle.checked = config.showLabel;
      showLabelToggle.addEventListener('change', async () => {
        config.showLabel = showLabelToggle.checked;
        await this.saveSettings();
        this.context.plugin.updateSelectionToolbarSettings();
      });

      // 悬停效果
      itemEl.addEventListener('mouseenter', () => {
        dragHandle.style.color = 'var(--text-muted)';
      });
      itemEl.addEventListener('mouseleave', () => {
        dragHandle.style.color = 'var(--text-faint)';
      });
    });
  }
}
