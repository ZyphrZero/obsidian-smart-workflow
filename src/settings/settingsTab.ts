/**
 * 设置标签页主入口
 * 负责标签页导航和状态管理，委托渲染给各 Renderer
 */

import { App, PluginSettingTab, setIcon } from 'obsidian';
import type SmartWorkflowPlugin from '../main';
import { ConfigManager } from '../services/config/configManager';
import { t } from '../i18n';

// 从模块化文件导入
import type { RendererContext } from './types';
import { getSettingTabs } from './utils/settingsUtils';
import { 
  GeneralSettingsRenderer, 
  NamingSettingsRenderer, 
  TerminalSettingsRenderer, 
  AdvancedSettingsRenderer
} from './renderers';

/**
 * 设置标签页类
 * 提供插件配置界面
 */
export class SmartWorkflowSettingTab extends PluginSettingTab {
  plugin: SmartWorkflowPlugin;
  private activeTab = 'general';
  private expandedSections: Set<string> = new Set();
  private configManager: ConfigManager;

  // 渲染器实例
  private generalRenderer: GeneralSettingsRenderer;
  private namingRenderer: NamingSettingsRenderer;
  private terminalRenderer: TerminalSettingsRenderer;
  private advancedRenderer: AdvancedSettingsRenderer;

  constructor(app: App, plugin: SmartWorkflowPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.configManager = new ConfigManager(
      this.plugin.settings,
      () => this.plugin.saveSettings()
    );

    // 初始化渲染器
    this.generalRenderer = new GeneralSettingsRenderer();
    this.namingRenderer = new NamingSettingsRenderer();
    this.terminalRenderer = new TerminalSettingsRenderer();
    this.advancedRenderer = new AdvancedSettingsRenderer();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // 刷新 ConfigManager 实例以确保使用最新设置
    this.configManager = new ConfigManager(
      this.plugin.settings,
      () => this.plugin.saveSettings()
    );

    // 渲染头部
    this.renderHeader(containerEl);

    // 渲染标签页导航
    this.renderTabs(containerEl);

    // 渲染内容区域
    const contentEl = containerEl.createDiv({ cls: 'smart-workflow-content' });
    this.renderContent(contentEl);
  }

  /**
   * 渲染头部区域
   */
  private renderHeader(containerEl: HTMLElement): void {
    const headerEl = containerEl.createDiv({ cls: 'smart-workflow-settings-header' });
    
    // 标题行（包含标题和重载按钮）
    const titleRow = headerEl.createDiv({ cls: 'settings-title-row' });
    titleRow.setCssProps({
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'space-between',
      'margin-bottom': '0'
    });

    // 标题
    const titleEl = titleRow.createEl('h2', { text: 'Smart Workflow' });
    titleEl.setCssProps({
      margin: '0',
      'font-weight': '700'
    });

    // 重载按钮
    const reloadBtn = titleRow.createEl('button', { cls: 'clickable-icon' });
    setIcon(reloadBtn, 'refresh-cw');
    reloadBtn.setAttribute('aria-label', t('settings.header.reload'));
    reloadBtn.addEventListener('click', async () => {
      const pluginId = this.plugin.manifest.id;
      // @ts-expect-error - 访问 Obsidian 内部 API
      await this.app.plugins.disablePlugin(pluginId);
      // @ts-expect-error - 访问 Obsidian 内部 API
      await this.app.plugins.enablePlugin(pluginId);
      // @ts-expect-error - 访问 Obsidian 内部 API
      this.app.setting.openTabById(pluginId);
    });

    // GitHub Feedback Link
    const feedbackContainer = headerEl.createDiv({ cls: 'setting-item-description' });
    feedbackContainer.setCssProps({
      'margin-bottom': '10px'
    });
    feedbackContainer.appendText(t('settings.header.feedbackText'));
    feedbackContainer.createEl('a', {
      text: t('settings.header.feedbackLink'),
      href: 'https://github.com/ZyphrZero/obsidian-smart-workflow'
    });
  }

  /**
   * 渲染标签页导航
   */
  private renderTabs(containerEl: HTMLElement): void {
    const tabsEl = containerEl.createDiv({ cls: 'smart-workflow-tabs' });

    getSettingTabs().forEach(tab => {
      const tabEl = tabsEl.createEl('div', {
        cls: 'smart-workflow-tab'
      });

      if (tab.id === this.activeTab) {
        tabEl.addClass('active');
      }

      setIcon(tabEl, tab.icon);
      tabEl.createSpan({ text: tab.name });

      tabEl.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.display();
      });
    });
  }

  /**
   * 渲染内容区域
   * 根据当前标签页委托给对应的渲染器
   */
  private renderContent(contentEl: HTMLElement): void {
    // 创建渲染器上下文
    const context: RendererContext = {
      app: this.app,
      plugin: this.plugin,
      configManager: this.configManager,
      containerEl: contentEl,
      expandedSections: this.expandedSections,
      refreshDisplay: () => this.display()
    };

    // 根据当前标签页委托渲染
    switch (this.activeTab) {
      case 'general':
        this.generalRenderer.render(context);
        break;
      case 'naming':
        this.namingRenderer.render(context);
        break;
      case 'terminal':
        this.terminalRenderer.render(context);
        break;
      case 'advanced':
        this.advancedRenderer.render(context);
        break;
    }
  }
}
