/**
 * 高级设置渲染器
 * 负责渲染性能调试设置
 */

import { Setting } from 'obsidian';
import type { RendererContext } from '../types';
import { BaseSettingsRenderer } from './baseRenderer';
import { t } from '../../i18n';
import { DEFAULT_SERVER_CONNECTION_SETTINGS } from '../settings';

/**
 * 高级设置渲染器
 * 处理调试模式设置的渲染
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
    
    // 服务器连接设置
    this.renderServerConnectionSettings(containerEl);
  }

  /**
   * 渲染性能与调试设置
   */
  private renderPerformanceSettings(containerEl: HTMLElement): void {
    const performanceCard = containerEl.createDiv({ cls: 'settings-card' });

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
   * 渲染服务器连接设置
   */
  private renderServerConnectionSettings(containerEl: HTMLElement): void {
    // 确保 serverConnection 设置存在
    if (!this.context.plugin.settings.serverConnection) {
      this.context.plugin.settings.serverConnection = { ...DEFAULT_SERVER_CONNECTION_SETTINGS };
    }
    
    const connectionCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(connectionCard)
      .setName(t('settingsDetails.advanced.serverConnection'))
      .setDesc(t('settingsDetails.advanced.serverConnectionDesc'))
      .setHeading();

    const settings = this.context.plugin.settings;

    // 最大重连次数
    new Setting(connectionCard)
      .setName(t('settingsDetails.advanced.reconnectMaxAttempts'))
      .setDesc(t('settingsDetails.advanced.reconnectMaxAttemptsDesc'))
      .addText(text => text
        .setPlaceholder('5')
        .setValue(String(settings.serverConnection.maxReconnectAttempts))
        .onChange(async (value) => {
          const num = parseInt(value, 10);
          if (!isNaN(num) && num >= 1 && num <= 20) {
            settings.serverConnection.maxReconnectAttempts = num;
            await this.saveSettings();
          }
        }));

    // 重连间隔
    new Setting(connectionCard)
      .setName(t('settingsDetails.advanced.reconnectInterval'))
      .setDesc(t('settingsDetails.advanced.reconnectIntervalDesc'))
      .addText(text => text
        .setPlaceholder('3000')
        .setValue(String(settings.serverConnection.reconnectInterval))
        .onChange(async (value) => {
          const num = parseInt(value, 10);
          if (!isNaN(num) && num >= 1000 && num <= 30000) {
            settings.serverConnection.reconnectInterval = num;
            await this.saveSettings();
          }
        }));

    // 下载加速源
    new Setting(connectionCard)
      .setName(t('settingsDetails.advanced.downloadAccelerator'))
      .setDesc(t('settingsDetails.advanced.downloadAcceleratorDesc'))
      .addText(text => text
        .setPlaceholder('https://ghfast.top/')
        .setValue(settings.serverConnection.downloadAcceleratorUrl || '')
        .onChange(async (value) => {
          settings.serverConnection.downloadAcceleratorUrl = value.trim();
          await this.saveSettings();
        }));
    
    // 重置按钮
    new Setting(connectionCard)
      .setName(t('settingsDetails.advanced.resetToDefaults'))
      .setDesc(t('settingsDetails.advanced.resetToDefaultsDesc'))
      .addButton(button => button
        .setButtonText(t('common.reset'))
        .onClick(async () => {
          this.context.plugin.settings.serverConnection = { ...DEFAULT_SERVER_CONNECTION_SETTINGS };
          await this.saveSettings();
          this.context.refreshDisplay();
        }));
  }
}
