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
    const writingCard = context.containerEl.createDiv();
    writingCard.style.padding = '16px';
    writingCard.style.borderRadius = '8px';
    writingCard.style.backgroundColor = 'var(--background-secondary)';
    writingCard.style.marginBottom = '10px';
    
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
      if (isExpanded) {
        this.context.expandedSections.delete('writing-feature-expanded');
      } else {
        this.context.expandedSections.add('writing-feature-expanded');
      }
      this.refreshDisplay();
    });

    // 如果未展开，不渲染内容
    if (!isExpanded) {
      return;
    }

    // 内容容器
    const contentEl = writingCard.createDiv({ cls: 'feature-content' });

    // AI 供应商/模型绑定
    this.renderProviderBinding(contentEl);

    // Prompt 模板设置
    this.renderPromptTemplate(contentEl);
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

    // Prompt 模板编辑器
    new Setting(containerEl)
      .addTextArea(text => {
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
          this.refreshDisplay();
        }));
  }
}
