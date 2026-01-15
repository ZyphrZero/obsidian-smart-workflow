/**
 * 自动归档设置渲染器
 * 负责渲染一键归档配置
 */

import { Setting } from 'obsidian';
import type { RendererContext } from '../types';
import { BaseSettingsRenderer } from './baseRenderer';
import { DEFAULT_AUTO_ARCHIVE_SETTINGS } from '../settings';
import { createHotkeyInput } from '../components';
import { t } from '../../i18n';

/**
 * 自动归档设置渲染器
 */
export class AutoArchiveSettingsRenderer extends BaseSettingsRenderer {
  /**
   * 渲染自动归档设置
   * @param context 渲染器上下文
   */
  render(context: RendererContext): void {
    this.context = context;
    const containerEl = context.containerEl;

    // 统一初始化 autoArchive 设置
    if (!this.context.plugin.settings.autoArchive) {
      this.context.plugin.settings.autoArchive = { ...DEFAULT_AUTO_ARCHIVE_SETTINGS };
    }

    // 功能说明
    this.renderDescription(containerEl);

    // 主要设置
    this.renderMainSettings(containerEl);

    // 快捷键设置
    this.renderHotkeySettings(containerEl);

    // 显示选项
    this.renderVisibilitySettings(containerEl);
  }

  /**
   * 渲染功能说明
   */
  private renderDescription(containerEl: HTMLElement): void {
    const descCard = containerEl.createDiv({ cls: 'settings-card' });

    descCard.createEl('h3', {
      text: t('autoArchive.settings.title'),
      attr: { style: 'margin-top: 0; margin-bottom: 8px;' }
    });

    const desc = descCard.createEl('p', {
      attr: { style: 'margin: 0; color: var(--text-muted); line-height: 1.5;' }
    });
    desc.innerHTML = t('autoArchive.settings.descriptionHtml');
  }

  /**
   * 渲染主要设置
   */
  private renderMainSettings(containerEl: HTMLElement): void {
    const card = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(card)
      .setName(t('autoArchive.settings.mainSettings'))
      .setHeading();

    // 启用/禁用
    new Setting(card)
      .setName(t('autoArchive.settings.enabled'))
      .setDesc(t('autoArchive.settings.enabledDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.autoArchive.enabled ?? false)
        .onChange(async (value) => {
          this.context.plugin.settings.autoArchive.enabled = value;
          await this.context.plugin.saveSettings();
        })
      );

    // 自动生成标签
    new Setting(card)
      .setName(t('autoArchive.settings.generateTags'))
      .setDesc(t('autoArchive.settings.generateTagsDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.autoArchive.generateTags ?? true)
        .onChange(async (value) => {
          this.context.plugin.settings.autoArchive.generateTags = value;
          await this.context.plugin.saveSettings();
        })
      );

    // 执行自动归档
    new Setting(card)
      .setName(t('autoArchive.settings.performArchive'))
      .setDesc(t('autoArchive.settings.performArchiveDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.autoArchive.performArchive ?? true)
        .onChange(async (value) => {
          this.context.plugin.settings.autoArchive.performArchive = value;
          await this.context.plugin.saveSettings();
        })
      );

    // 排除文件夹
    new Setting(card)
      .setName(t('autoArchive.settings.excludeFolders'))
      .setDesc(t('autoArchive.settings.excludeFoldersDesc'))
      .addTextArea(text => {
        text.inputEl.style.width = '100%';
        text.inputEl.style.minHeight = '80px';
        text.inputEl.style.fontFamily = 'var(--font-monospace)';
        text
          .setPlaceholder(t('autoArchive.settings.excludeFoldersPlaceholder'))
          .setValue((this.context.plugin.settings.autoArchive.excludeFolders || []).join('\n'))
          .onChange(async (value) => {
            const folders = value.split('\n').map(f => f.trim()).filter(f => f.length > 0);
            this.context.plugin.settings.autoArchive.excludeFolders = folders;
            await this.context.plugin.saveSettings();
          });
      });
  }

  /**
   * 渲染快捷键设置
   */
  private renderHotkeySettings(containerEl: HTMLElement): void {
    const card = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(card)
      .setName(t('autoArchive.settings.hotkeyConfig'))
      .setDesc(t('autoArchive.settings.hotkeyConfigDesc'))
      .setHeading();

    // 使用封装的快捷键组件
    createHotkeyInput({
      app: this.context.app,
      containerEl: card,
      commandId: 'auto-archive',
      name: t('autoArchive.commands.autoArchive'),
      description: t('autoArchive.settings.hotkeyDesc'),
      i18nPrefix: 'autoArchive.settings',
      // 不再传递 onRefresh，快捷键组件内部会自动更新显示
    });
  }

  /**
   * 渲染显示选项
   */
  private renderVisibilitySettings(containerEl: HTMLElement): void {
    const card = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(card)
      .setName(t('autoArchive.settings.visibility'))
      .setHeading();

    const visibilitySettings = this.context.plugin.settings.featureVisibility.autoArchive;

    // 命令面板
    new Setting(card)
      .setName(t('autoArchive.settings.commandPalette'))
      .setDesc(t('autoArchive.settings.commandPaletteDesc'))
      .addToggle(toggle => toggle
        .setValue(visibilitySettings.showInCommandPalette ?? true)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.autoArchive.showInCommandPalette = value;
          await this.context.plugin.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        })
      );

    // 编辑器右键菜单
    new Setting(card)
      .setName(t('autoArchive.settings.editorMenu'))
      .setDesc(t('autoArchive.settings.editorMenuDesc'))
      .addToggle(toggle => toggle
        .setValue(visibilitySettings.showInEditorMenu ?? true)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.autoArchive.showInEditorMenu = value;
          await this.context.plugin.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        })
      );

    // 文件浏览器右键菜单
    new Setting(card)
      .setName(t('autoArchive.settings.fileMenu'))
      .setDesc(t('autoArchive.settings.fileMenuDesc'))
      .addToggle(toggle => toggle
        .setValue(visibilitySettings.showInFileMenu ?? true)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.autoArchive.showInFileMenu = value;
          await this.context.plugin.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        })
      );
  }
}
