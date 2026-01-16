/**
 * 写作设置渲染器
 * 负责渲染写作功能（润色、缩写、扩写等）的设置
 */

import { Setting, setIcon } from 'obsidian';
import type { RendererContext } from '../types';
import { DEFAULT_POLISH_PROMPT_TEMPLATE } from '../settings';
import { BaseSettingsRenderer } from './baseRenderer';
import { t } from '../../i18n';

/**
 * 写作设置渲染器
 * 处理写作功能的启用/禁用、AI 供应商绑定和 Prompt 模板设置
 */
export class WritingSettingsRenderer extends BaseSettingsRenderer {
  /**
   * 渲染写作设置
   * @param context 渲染器上下文
   */
  render(context: RendererContext): void {
    this.context = context;

    // 写作功能区块（可折叠，默认收起）
    const isExpanded = this.context.expandedSections.has('writing-feature-expanded');
    
    // 功能卡片
    const writingCard = context.containerEl.createDiv({ cls: 'settings-card' });
    
    // 可折叠标题
    const headerEl = writingCard.createDiv({ cls: 'feature-header' });
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
    const titleEl = headerEl.createSpan({ text: t('writing.settings.title') });
    titleEl.setCssProps({
      'font-weight': '600',
      'font-size': '1em'
    });

    // 点击切换展开状态
    headerEl.addEventListener('click', () => {
      const isExpandedNow = this.context.expandedSections.has('writing-feature-expanded');
      const newExpanded = !isExpandedNow;
      if (newExpanded) {
        this.context.expandedSections.add('writing-feature-expanded');
      } else {
        this.context.expandedSections.delete('writing-feature-expanded');
      }
      
      // 更新图标
      chevronEl.empty();
      setIcon(chevronEl, newExpanded ? 'chevron-down' : 'chevron-right');
      
      // 更新标题下边距
      headerEl.setCssProps({
        'margin-bottom': newExpanded ? '20px' : '0'
      });
      
      // 使用 toggleConditionalSection 局部更新内容区域
      this.toggleConditionalSection(
        writingCard,
        'writing-content',
        newExpanded,
        (el) => this.renderWritingContent(el),
        headerEl
      );
    });

    // 如果展开，渲染内容
    if (isExpanded) {
      const contentEl = writingCard.createDiv({ cls: 'conditional-section-writing-content feature-content' });
      this.renderWritingContent(contentEl);
    }
  }

  /**
   * 渲染写作设置内容（供 toggleConditionalSection 使用）
   */
  private renderWritingContent(containerEl: HTMLElement): void {
    containerEl.addClass('feature-content');
    
    // AI 供应商/模型绑定
    this.renderProviderBinding(containerEl);

    // 可见性设置
    this.renderVisibilitySettings(containerEl);

    // Prompt 模板设置
    this.renderPromptTemplate(containerEl);
  }

  /**
   * 渲染 AI 供应商/模型绑定设置

   */
  private renderProviderBinding(containerEl: HTMLElement): void {
    // 获取当前 writing 功能的解析配置
    const resolvedConfig = this.context.configManager.resolveFeatureConfig('writing');
    const currentProvider = resolvedConfig?.provider;
    const currentModel = resolvedConfig?.model;

    // 模型绑定设置标题
    new Setting(containerEl)
      .setName(t('writing.settings.modelBinding'))
      .setHeading();

    // 供应商/模型绑定下拉框
    const bindingSetting = new Setting(containerEl)
      .setName(t('writing.settings.selectModel'))
      .setDesc(t('writing.settings.selectModelDesc'));

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
        let nextProviderId: string | undefined;
        let nextModelId: string | undefined;
        if (!value) {
          // 清除绑定
          delete this.context.plugin.settings.featureBindings.writing;
        } else {
          const [providerId, modelId] = value.split('|');
          const existingBinding = this.context.plugin.settings.featureBindings.writing;
          this.context.plugin.settings.featureBindings.writing = {
            providerId,
            modelId,
            promptTemplate: existingBinding?.promptTemplate ?? this.context.plugin.settings.writing.polishPromptTemplate
          };
          nextProviderId = providerId;
          nextModelId = modelId;
        }
        await this.saveSettings();
        updateStatus(nextProviderId, nextModelId);
      });
    });

    // 绑定状态容器（用于局部更新）
    const statusContainerId = 'writing-binding-status';
    const statusContainer = containerEl.createDiv({ cls: `conditional-section-${statusContainerId}` });
    const updateStatus = (providerId?: string, modelId?: string): void => {
      statusContainer.empty();
      if (!providerId || !modelId) {
        return;
      }
      const provider = this.context.configManager.getProvider(providerId);
      const model = provider?.models.find(item => item.id === modelId);
      if (!provider || !model) {
        return;
      }
      const displayName = model.displayName || model.name;
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
      statusEl.setText(t('settingsDetails.general.currentBindingStatus', {
        provider: provider.name,
        model: displayName
      }));
    };
    
    // 显示当前绑定状态
    updateStatus(currentProvider?.id, currentModel?.id);
  }

  /**
   * 渲染可见性设置
   */
  private renderVisibilitySettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName(t('writing.settings.visibility'))
      .setHeading();

    const visibilitySettings = this.context.plugin.settings.featureVisibility.writing;

    // 命令面板
    new Setting(containerEl)
      .setName(t('writing.settings.commandPalette'))
      .setDesc(t('writing.settings.commandPaletteDesc'))
      .addToggle(toggle => toggle
        .setValue(visibilitySettings.showInCommandPalette)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.writing.showInCommandPalette = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    // 编辑器右键菜单
    new Setting(containerEl)
      .setName(t('writing.settings.editorMenu'))
      .setDesc(t('writing.settings.editorMenuDesc'))
      .addToggle(toggle => toggle
        .setValue(visibilitySettings.showInEditorMenu)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.writing.showInEditorMenu = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    // 文件浏览器右键菜单
    new Setting(containerEl)
      .setName(t('writing.settings.fileMenu'))
      .setDesc(t('writing.settings.fileMenuDesc'))
      .addToggle(toggle => toggle
        .setValue(visibilitySettings.showInFileMenu)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.writing.showInFileMenu = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));
  }

  /**
   * 渲染 Prompt 模板设置
   */
  private renderPromptTemplate(containerEl: HTMLElement): void {
    // Prompt 模板标题
    new Setting(containerEl)
      .setName(t('writing.settings.promptTemplate'))
      .setHeading();

    // 模板说明
    const promptDesc = containerEl.createEl('div', { cls: 'setting-item-description' });
    promptDesc.setCssProps({ 'margin-bottom': '12px' });
    promptDesc.appendText(t('writing.settings.promptTemplateDesc'));

    // 保存 textarea 引用用于重置
    let textareaEl: HTMLTextAreaElement | null = null;

    // Prompt 模板编辑器
    new Setting(containerEl)
      .addTextArea(text => {
        textareaEl = text.inputEl;
        text
          .setValue(this.context.plugin.settings.writing.polishPromptTemplate)
          .onChange(async (value) => {
            this.context.plugin.settings.writing.polishPromptTemplate = value;
            // 同步更新 featureBindings 中的 promptTemplate
            if (this.context.plugin.settings.featureBindings.writing) {
              this.context.plugin.settings.featureBindings.writing.promptTemplate = value;
            }
            await this.saveSettings();
          });
        text.inputEl.rows = 10;
        text.inputEl.cols = 50;
        text.inputEl.style.width = '100%';
        text.inputEl.style.fontFamily = 'monospace';
      });

    // 重置按钮
    new Setting(containerEl)
      .addButton(button => button
        .setButtonText(t('writing.settings.resetPrompt'))
        .onClick(async () => {
          this.context.plugin.settings.writing.polishPromptTemplate = DEFAULT_POLISH_PROMPT_TEMPLATE;
          // 同步更新 featureBindings 中的 promptTemplate
          if (this.context.plugin.settings.featureBindings.writing) {
            this.context.plugin.settings.featureBindings.writing.promptTemplate = DEFAULT_POLISH_PROMPT_TEMPLATE;
          }
          await this.saveSettings();
          // 局部更新 textarea 值，避免全量刷新
          if (textareaEl) {
            textareaEl.value = DEFAULT_POLISH_PROMPT_TEMPLATE;
          }
        }));
  }
}
