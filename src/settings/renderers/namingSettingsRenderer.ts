/**
 * 命名设置渲染器
 * 负责渲染 AI 命名功能、选中工具栏功能和写作功能设置
 */

import { Setting, setIcon } from 'obsidian';
import type { RendererContext } from '../types';
import { BASE_PROMPT_TEMPLATE, ADVANCED_PROMPT_TEMPLATE } from '../settings';
import { BaseSettingsRenderer } from './baseRenderer';
import { WritingSettingsRenderer } from './writingSettingsRenderer';
import { TranslationSettingsRenderer } from './translationSettingsRenderer';
import { t } from '../../i18n';

/**
 * 命名设置渲染器
 * 处理 AI 命名行为、Prompt 模板、选中工具栏功能和写作功能设置的渲染
 */
export class NamingSettingsRenderer extends BaseSettingsRenderer {
  // 写作设置渲染器实例
  private writingRenderer: WritingSettingsRenderer;
  // 翻译设置渲染器实例
  private translationRenderer: TranslationSettingsRenderer;

  constructor() {
    super();
    this.writingRenderer = new WritingSettingsRenderer();
    this.translationRenderer = new TranslationSettingsRenderer();
  }

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
   * 渲染命名设置
   * @param context 渲染器上下文
   */
  render(context: RendererContext): void {
    this.context = context;

    // 渲染顺序：选中工具栏 → 写作 → 翻译 → AI 文件名生成
    
    // 1. 选中工具栏功能设置
    this.renderSelectionToolbarFunctionSettings(context.containerEl);

    // 2. 写作功能设置
    this.writingRenderer.render(context);

    // 3. 翻译功能设置
    this.translationRenderer.render(context);

    // 4. AI 命名功能设置
    this.renderNamingFeature(context.containerEl);
  }

  /**
   * 渲染 AI 命名功能区块
   */
  private renderNamingFeature(containerEl: HTMLElement): void {
    // AI 命名功能区块（可折叠，默认收起）
    const isNamingExpanded = this.context.expandedSections.has('naming-feature-expanded');
    
    // 功能卡片
    const namingCard = containerEl.createDiv();
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
        this.context.expandedSections.delete('naming-feature-expanded');
      } else {
        this.context.expandedSections.add('naming-feature-expanded');
      }
      this.refreshDisplay();
    });

    // 如果未展开，不渲染内容
    if (!isNamingExpanded) {
      return;
    }

    // 内容容器
    const contentEl = namingCard.createDiv({ cls: 'feature-content' });

    // 模型绑定设置
    this.renderModelBinding(contentEl);

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

    // 功能显示设置
    this.renderVisibilitySettings(contentEl);
  }


  /**
   * 渲染选中工具栏功能设置（最小选中字符数、显示延迟、按钮配置）
   * 可折叠卡片，与文件命名设置风格一致

   */
  private renderSelectionToolbarFunctionSettings(containerEl: HTMLElement): void {
    // 选中工具栏功能区块（可折叠，默认收起）
    const isExpanded = this.context.expandedSections.has('selection-toolbar-expanded');
    
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
        this.context.expandedSections.delete('selection-toolbar-expanded');
      } else {
        this.context.expandedSections.add('selection-toolbar-expanded');
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
      writing: t('writing.menu.writing'),
      translate: t('selectionToolbar.actions.translate')
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
      writing: 'pen-tool',
      translate: 'languages'
    };

    // 有子菜单的按钮及其子项
    const subMenuItems: Record<string, { id: string; name: string; icon: string }[]> = {
      writing: [
        { id: 'polish', name: t('writing.menu.polish'), icon: 'sparkles' }
      ]
    };

    // 拖拽状态
    let draggedIndex: number | null = null;

    // 渲染每个按钮配置项
    buttonConfigs.forEach((config, index) => {
      const hasSubMenu = subMenuItems[config.id] !== undefined;
      
      const itemEl = buttonListEl.createDiv({ cls: 'toolbar-button-item' });
      itemEl.setAttribute('draggable', 'true');
      itemEl.setAttribute('data-index', String(index));
      itemEl.setCssProps({
        display: 'flex',
        'align-items': 'center',
        gap: '10px',
        padding: '8px 12px',
        'margin-bottom': hasSubMenu ? '0' : '4px',
        'background-color': 'var(--background-primary)',
        'border-radius': hasSubMenu ? '6px 6px 0 0' : '6px',
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

      // 图标预览
      const iconPreview = itemEl.createSpan({ cls: 'button-icon-preview' });
      setIcon(iconPreview, config.customIcon || defaultIcons[config.id] || 'circle');
      iconPreview.setCssProps({
        display: 'inline-flex',
        'align-items': 'center',
        'justify-content': 'center',
        width: '18px',
        height: '18px',
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

      // 右侧控制区域
      const controlsEl = itemEl.createDiv({ cls: 'button-controls' });
      controlsEl.setCssProps({
        display: 'flex',
        'align-items': 'center',
        gap: '12px',
        'flex-shrink': '0'
      });

      // 启用开关：开关 [ ]
      const enabledContainer = controlsEl.createDiv({ cls: 'toggle-container' });
      enabledContainer.setCssProps({
        display: 'flex',
        'align-items': 'center',
        gap: '4px'
      });
      
      const enabledLabel = enabledContainer.createSpan();
      enabledLabel.setText(t('selectionToolbar.settings.enabledShort'));
      enabledLabel.setCssProps({
        'font-size': '0.8em',
        color: 'var(--text-muted)'
      });
      
      const enabledToggle = enabledContainer.createEl('input', { type: 'checkbox' });
      enabledToggle.checked = config.enabled;
      enabledToggle.addEventListener('change', async () => {
        config.enabled = enabledToggle.checked;
        await this.saveSettings();
        this.context.plugin.updateSelectionToolbarSettings();
      });

      // 显示文字开关：文字 [ ]
      const showLabelContainer = controlsEl.createDiv({ cls: 'toggle-container' });
      showLabelContainer.setCssProps({
        display: 'flex',
        'align-items': 'center',
        gap: '4px'
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

      // 渲染子菜单项（如果有）
      if (hasSubMenu) {
        this.renderSubMenuItems(buttonListEl, config.id, subMenuItems[config.id]);
      }
    });
  }

  /**
   * 渲染子菜单项
   * 注：当前只有润色一个子菜单项，暂不支持拖拽排序
   * 未来添加更多子菜单项时可扩展排序功能
   */
  private renderSubMenuItems(
    containerEl: HTMLElement, 
    parentId: string, 
    items: { id: string; name: string; icon: string }[]
  ): void {
    const subMenuContainer = containerEl.createDiv({ cls: 'sub-menu-container' });
    subMenuContainer.setCssProps({
      'margin-left': '24px',
      'margin-bottom': '4px',
      'padding': '8px 12px',
      'background-color': 'var(--background-primary)',
      'border-radius': '0 0 6px 6px',
      'border-top': '1px dashed var(--background-modifier-border)'
    });

    items.forEach((item, index) => {
      const subItemEl = subMenuContainer.createDiv({ cls: 'sub-menu-item' });
      subItemEl.setCssProps({
        display: 'flex',
        'align-items': 'center',
        gap: '10px',
        padding: '4px 0',
        'margin-bottom': index < items.length - 1 ? '4px' : '0'
      });

      // 树形连接线
      const treeLineEl = subItemEl.createSpan({ cls: 'tree-line' });
      treeLineEl.setText(index === items.length - 1 ? '└' : '├');
      treeLineEl.setCssProps({
        color: 'var(--text-faint)',
        'font-family': 'monospace',
        'margin-right': '4px'
      });

      // 子项图标
      const iconEl = subItemEl.createSpan({ cls: 'sub-item-icon' });
      setIcon(iconEl, item.icon);
      iconEl.setCssProps({
        display: 'inline-flex',
        'align-items': 'center',
        width: '16px',
        height: '16px',
        color: 'var(--text-muted)',
        'flex-shrink': '0'
      });

      // 子项名称
      const nameEl = subItemEl.createSpan({ cls: 'sub-item-name' });
      nameEl.setText(item.name);
      nameEl.setCssProps({
        flex: '1',
        'font-size': '0.85em',
        color: 'var(--text-muted)'
      });

      // 子项控制区域
      const controlsEl = subItemEl.createDiv({ cls: 'sub-item-controls' });
      controlsEl.setCssProps({
        display: 'flex',
        'align-items': 'center',
        gap: '12px',
        'flex-shrink': '0'
      });

      // 根据 parentId 和 item.id 获取对应的设置
      if (parentId === 'writing' && item.id === 'polish') {
        // 润色功能启用开关
        const enabledContainer = controlsEl.createDiv({ cls: 'toggle-container' });
        enabledContainer.setCssProps({
          display: 'flex',
          'align-items': 'center',
          gap: '4px'
        });
        
        const enabledLabel = enabledContainer.createSpan();
        enabledLabel.setText(t('selectionToolbar.settings.enabledShort'));
        enabledLabel.setCssProps({
          'font-size': '0.8em',
          color: 'var(--text-muted)'
        });
        
        const enabledToggle = enabledContainer.createEl('input', { type: 'checkbox' });
        enabledToggle.checked = this.context.plugin.settings.writing.actions.polish;
        enabledToggle.addEventListener('change', async () => {
          this.context.plugin.settings.writing.actions.polish = enabledToggle.checked;
          await this.saveSettings();
          this.context.plugin.updateSelectionToolbarSettings();
        });

        // 润色功能文字显示开关
        const showLabelContainer = controlsEl.createDiv({ cls: 'toggle-container' });
        showLabelContainer.setCssProps({
          display: 'flex',
          'align-items': 'center',
          gap: '4px'
        });
        
        const showLabelLabel = showLabelContainer.createSpan();
        showLabelLabel.setText(t('selectionToolbar.settings.showLabel'));
        showLabelLabel.setCssProps({
          'font-size': '0.8em',
          color: 'var(--text-muted)'
        });
        
        const showLabelToggle = showLabelContainer.createEl('input', { type: 'checkbox' });
        showLabelToggle.checked = this.context.plugin.settings.writing.showLabels?.polish ?? true;
        showLabelToggle.addEventListener('change', async () => {
          if (!this.context.plugin.settings.writing.showLabels) {
            this.context.plugin.settings.writing.showLabels = { polish: true };
          }
          this.context.plugin.settings.writing.showLabels.polish = showLabelToggle.checked;
          await this.saveSettings();
          this.context.plugin.updateSelectionToolbarSettings();
        });
      }
    });
  }
}
