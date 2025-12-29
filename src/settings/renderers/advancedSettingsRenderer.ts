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


}
