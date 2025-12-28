/**
 * 高级设置渲染器
 * 负责渲染性能调试和功能显示管理设置
 */

import { Setting } from 'obsidian';
import type { RendererContext } from '../types';
import { BaseSettingsRenderer } from './baseRenderer';
import { t } from '../../i18n';

/**
 * 高级设置渲染器
 * 处理调试模式和功能可见性设置的渲染
 */
export class AdvancedSettingsRenderer extends BaseSettingsRenderer {
  /**
   * 渲染高级设置
   * @param context 渲染器上下文
   */
  render(context: RendererContext): void {
    this.context = context;
    const containerEl = context.containerEl;

    // 性能与调试设置
    this.renderPerformanceSettings(containerEl);

    // 功能显示管理
    this.renderFeatureVisibilitySettings(containerEl);
  }

  /**
   * 渲染性能与调试设置
   */
  private renderPerformanceSettings(containerEl: HTMLElement): void {
    const performanceCard = containerEl.createDiv();
    performanceCard.style.padding = '16px';
    performanceCard.style.borderRadius = '8px';
    performanceCard.style.backgroundColor = 'var(--background-secondary)';
    performanceCard.style.marginBottom = '10px';

    new Setting(performanceCard)
      .setName(t('settingsDetails.advanced.performanceAndDebug'))
      .setHeading();

    // 调试模式
    new Setting(performanceCard)
      .setName(t('settingsDetails.advanced.debugMode'))
      .setDesc(t('settingsDetails.advanced.debugModeDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.debugMode)
        .onChange(async (value) => {
          this.context.plugin.settings.debugMode = value;
          await this.saveSettings();
        }));
  }

  /**
   * 渲染功能显示管理设置
   */
  private renderFeatureVisibilitySettings(containerEl: HTMLElement): void {
    const visibilityCard = containerEl.createDiv();
    visibilityCard.style.padding = '16px';
    visibilityCard.style.borderRadius = '8px';
    visibilityCard.style.backgroundColor = 'var(--background-secondary)';
    visibilityCard.style.marginBottom = '10px';

    new Setting(visibilityCard)
      .setName(t('settingsDetails.advanced.featureVisibility'))
      .setDesc(t('settingsDetails.advanced.featureVisibilityDesc'))
      .setHeading();

    // AI 文件名生成功能 - 可折叠区块
    this.createCollapsibleSection(
      visibilityCard,
      'aiNaming',
      t('settingsDetails.advanced.aiNamingVisibility'),
      t('settingsDetails.advanced.aiNamingVisibilityDesc'),
      (contentEl) => {
        this.renderAiNamingVisibilityContent(contentEl);
      }
    );

    // 终端功能 - 可折叠区块
    this.createCollapsibleSection(
      visibilityCard,
      'terminal',
      t('settingsDetails.advanced.terminalVisibility'),
      t('settingsDetails.advanced.terminalVisibilityDesc'),
      (contentEl) => {
        this.renderTerminalVisibilityContent(contentEl);
      }
    );

    // 选中工具栏功能 - 可折叠区块
    this.createCollapsibleSection(
      visibilityCard,
      'selectionToolbar',
      t('selectionToolbar.visibility'),
      t('selectionToolbar.visibilityDesc'),
      (contentEl) => {
        this.renderSelectionToolbarVisibilityContent(contentEl);
      }
    );
  }

  /**
   * 渲染 AI 命名功能可见性设置
   */
  private renderAiNamingVisibilityContent(contentEl: HTMLElement): void {
    new Setting(contentEl)
      .setName(t('settingsDetails.advanced.showInCommandPalette'))
      .setDesc(t('settingsDetails.advanced.showInCommandPaletteDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.featureVisibility.aiNaming.showInCommandPalette)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.aiNaming.showInCommandPalette = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    new Setting(contentEl)
      .setName(t('settingsDetails.advanced.showInEditorMenu'))
      .setDesc(t('settingsDetails.advanced.showInEditorMenuDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.featureVisibility.aiNaming.showInEditorMenu)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.aiNaming.showInEditorMenu = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    new Setting(contentEl)
      .setName(t('settingsDetails.advanced.showInFileMenu'))
      .setDesc(t('settingsDetails.advanced.showInFileMenuDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.featureVisibility.aiNaming.showInFileMenu)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.aiNaming.showInFileMenu = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    new Setting(contentEl)
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
   * 渲染终端功能可见性设置
   */
  private renderTerminalVisibilityContent(contentEl: HTMLElement): void {
    new Setting(contentEl)
      .setName(t('settingsDetails.advanced.showInCommandPalette'))
      .setDesc(t('settingsDetails.advanced.showInCommandPaletteDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.featureVisibility.terminal.showInCommandPalette)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.terminal.showInCommandPalette = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    new Setting(contentEl)
      .setName(t('settingsDetails.advanced.showInRibbon'))
      .setDesc(t('settingsDetails.advanced.showInRibbonTerminalDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.featureVisibility.terminal.showInRibbon)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.terminal.showInRibbon = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    new Setting(contentEl)
      .setName(t('settingsDetails.advanced.showInNewTab'))
      .setDesc(t('settingsDetails.advanced.showInNewTabDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.featureVisibility.terminal.showInNewTab)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.terminal.showInNewTab = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));
  }


  /**
   * 渲染选中工具栏显示设置（启用开关、按钮显隐）
   * 用于功能显示区域的可折叠内容
   * Requirements: 4.1, 4.2
   */
  private renderSelectionToolbarVisibilityContent(contentEl: HTMLElement): void {
    // 启用/禁用开关 - Requirements: 4.1
    new Setting(contentEl)
      .setName(t('selectionToolbar.settings.enabled'))
      .setDesc(t('selectionToolbar.settings.enabledDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.selectionToolbar.enabled)
        .onChange(async (value) => {
          this.context.plugin.settings.selectionToolbar.enabled = value;
          await this.saveSettings();
          // 通知 SelectionToolbarManager 更新设置
          this.context.plugin.updateSelectionToolbarSettings();
        }));

    // 复制按钮
    new Setting(contentEl)
      .setName(t('selectionToolbar.settings.actionCopy'))
      .setDesc(t('selectionToolbar.settings.actionCopyDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.selectionToolbar.actions.copy)
        .onChange(async (value) => {
          this.context.plugin.settings.selectionToolbar.actions.copy = value;
          await this.saveSettings();
          this.context.plugin.updateSelectionToolbarSettings();
        }));

    // 搜索按钮
    new Setting(contentEl)
      .setName(t('selectionToolbar.settings.actionSearch'))
      .setDesc(t('selectionToolbar.settings.actionSearchDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.selectionToolbar.actions.search)
        .onChange(async (value) => {
          this.context.plugin.settings.selectionToolbar.actions.search = value;
          await this.saveSettings();
          this.context.plugin.updateSelectionToolbarSettings();
        }));

    // 创建链接按钮
    new Setting(contentEl)
      .setName(t('selectionToolbar.settings.actionCreateLink'))
      .setDesc(t('selectionToolbar.settings.actionCreateLinkDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.selectionToolbar.actions.createLink)
        .onChange(async (value) => {
          this.context.plugin.settings.selectionToolbar.actions.createLink = value;
          await this.saveSettings();
          this.context.plugin.updateSelectionToolbarSettings();
        }));

    // 高亮按钮
    new Setting(contentEl)
      .setName(t('selectionToolbar.settings.actionHighlight'))
      .setDesc(t('selectionToolbar.settings.actionHighlightDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.selectionToolbar.actions.highlight)
        .onChange(async (value) => {
          this.context.plugin.settings.selectionToolbar.actions.highlight = value;
          await this.saveSettings();
          this.context.plugin.updateSelectionToolbarSettings();
        }));

    // 加粗按钮
    new Setting(contentEl)
      .setName(t('selectionToolbar.settings.actionBold'))
      .setDesc(t('selectionToolbar.settings.actionBoldDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.selectionToolbar.actions.bold)
        .onChange(async (value) => {
          this.context.plugin.settings.selectionToolbar.actions.bold = value;
          await this.saveSettings();
          this.context.plugin.updateSelectionToolbarSettings();
        }));

    // 斜体按钮
    new Setting(contentEl)
      .setName(t('selectionToolbar.settings.actionItalic'))
      .setDesc(t('selectionToolbar.settings.actionItalicDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.selectionToolbar.actions.italic)
        .onChange(async (value) => {
          this.context.plugin.settings.selectionToolbar.actions.italic = value;
          await this.saveSettings();
          this.context.plugin.updateSelectionToolbarSettings();
        }));

    // 删除线按钮
    new Setting(contentEl)
      .setName(t('selectionToolbar.settings.actionStrikethrough'))
      .setDesc(t('selectionToolbar.settings.actionStrikethroughDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.selectionToolbar.actions.strikethrough)
        .onChange(async (value) => {
          this.context.plugin.settings.selectionToolbar.actions.strikethrough = value;
          await this.saveSettings();
          this.context.plugin.updateSelectionToolbarSettings();
        }));

    // 行内代码按钮
    new Setting(contentEl)
      .setName(t('selectionToolbar.settings.actionInlineCode'))
      .setDesc(t('selectionToolbar.settings.actionInlineCodeDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.selectionToolbar.actions.inlineCode)
        .onChange(async (value) => {
          this.context.plugin.settings.selectionToolbar.actions.inlineCode = value;
          await this.saveSettings();
          this.context.plugin.updateSelectionToolbarSettings();
        }));

    // 行内公式按钮
    new Setting(contentEl)
      .setName(t('selectionToolbar.settings.actionInlineMath'))
      .setDesc(t('selectionToolbar.settings.actionInlineMathDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.selectionToolbar.actions.inlineMath)
        .onChange(async (value) => {
          this.context.plugin.settings.selectionToolbar.actions.inlineMath = value;
          await this.saveSettings();
          this.context.plugin.updateSelectionToolbarSettings();
        }));

    // 清除格式按钮
    new Setting(contentEl)
      .setName(t('selectionToolbar.settings.actionClearFormat'))
      .setDesc(t('selectionToolbar.settings.actionClearFormatDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.selectionToolbar.actions.clearFormat)
        .onChange(async (value) => {
          this.context.plugin.settings.selectionToolbar.actions.clearFormat = value;
          await this.saveSettings();
          this.context.plugin.updateSelectionToolbarSettings();
        }));
  }
}
