/**
 * 功能设置渲染器
 * 负责渲染选中工具栏、写作和翻译功能设置
 */

import { Setting, setIcon } from 'obsidian';
import type { RendererContext } from '../types';
import { BaseSettingsRenderer } from './baseRenderer';
import { WritingSettingsRenderer } from './writingSettingsRenderer';
import { TranslationSettingsRenderer } from './translationSettingsRenderer';
import { t } from '../../i18n';

/**
 * 功能设置渲染器
 * 处理选中工具栏、写作和翻译功能设置的渲染
 */
export class FeatureSettingsRenderer extends BaseSettingsRenderer {
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
   * 渲染功能设置
   * @param context 渲染器上下文
   */
  render(context: RendererContext): void {
    this.context = context;

    // 渲染顺序：选中工具栏 → 写作 → 翻译
    
    // 1. 选中工具栏功能设置
    this.renderSelectionToolbarFunctionSettings(context.containerEl);

    // 2. 写作功能设置
    this.writingRenderer.render(context);

    // 3. 翻译功能设置
    this.translationRenderer.render(context);
  }


  /**
   * 渲染选中工具栏功能设置（最小选中字符数、显示延迟、按钮配置）
   * 可折叠卡片
   */
  private renderSelectionToolbarFunctionSettings(containerEl: HTMLElement): void {
    // 选中工具栏功能区块（可折叠，默认收起）
    const isExpanded = this.context.expandedSections.has('selection-toolbar-expanded');
    
    // 功能卡片
    const toolbarCard = containerEl.createDiv({ cls: 'settings-card' });
    
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

    // 内容容器（用于条件渲染）
    const contentWrapper = toolbarCard.createDiv({ cls: 'feature-content-wrapper' });

    // 点击切换展开状态
    headerEl.addEventListener('click', () => {
      const willExpand = !this.context.expandedSections.has('selection-toolbar-expanded');
      
      if (willExpand) {
        this.context.expandedSections.add('selection-toolbar-expanded');
        // 更新图标
        chevronEl.empty();
        setIcon(chevronEl, 'chevron-down');
        // 更新 header margin
        headerEl.setCssProps({ 'margin-bottom': '20px' });
      } else {
        this.context.expandedSections.delete('selection-toolbar-expanded');
        // 更新图标
        chevronEl.empty();
        setIcon(chevronEl, 'chevron-right');
        // 更新 header margin
        headerEl.setCssProps({ 'margin-bottom': '0' });
      }
      
      // 使用 toggleConditionalSection 显示/隐藏内容
      this.toggleConditionalSection(
        contentWrapper,
        'selection-toolbar-content',
        willExpand,
        (el) => this.renderSelectionToolbarContent(el)
      );
    });

    // 初始渲染：如果已展开，渲染内容
    if (isExpanded) {
      this.toggleConditionalSection(
        contentWrapper,
        'selection-toolbar-content',
        true,
        (el) => this.renderSelectionToolbarContent(el)
      );
    }
  }

  /**
   * 渲染选中工具栏内容
   */
  private renderSelectionToolbarContent(contentEl: HTMLElement): void {
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

    // 按钮列表容器（用于条件渲染）
    const buttonListWrapper = containerEl.createDiv({ cls: 'toolbar-button-list-wrapper' });
    
    // 使用 toggleConditionalSection 渲染按钮列表，便于拖拽后刷新
    this.toggleConditionalSection(
      buttonListWrapper,
      'toolbar-button-list',
      true,
      (el) => this.renderButtonList(el, buttonListWrapper)
    );
  }

  /**
   * 渲染按钮列表内容
   */
  private renderButtonList(buttonListEl: HTMLElement, wrapperEl: HTMLElement): void {
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
          
          // 使用 toggleConditionalSection 重新渲染按钮列表
          this.toggleConditionalSection(wrapperEl, 'toolbar-button-list', false, () => {});
          this.toggleConditionalSection(wrapperEl, 'toolbar-button-list', true, (el) => this.renderButtonList(el, wrapperEl));
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
