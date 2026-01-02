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
  AdvancedSettingsRenderer,
  VoiceSettingsRenderer
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
  private sidebarExpanded = false; // 侧边栏默认收起

  // 渲染器实例
  private generalRenderer: GeneralSettingsRenderer;
  private namingRenderer: NamingSettingsRenderer;
  private terminalRenderer: TerminalSettingsRenderer;
  private advancedRenderer: AdvancedSettingsRenderer;
  private voiceRenderer: VoiceSettingsRenderer;

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
    this.voiceRenderer = new VoiceSettingsRenderer();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // 刷新 ConfigManager 实例以确保使用最新设置
    this.configManager = new ConfigManager(
      this.plugin.settings,
      () => this.plugin.saveSettings()
    );

    // 添加主容器类
    containerEl.addClass('smart-workflow-settings-container');

    // 创建主布局容器（左侧导航 + 右侧内容）
    const layoutEl = containerEl.createDiv({ cls: 'smart-workflow-layout' });

    // 渲染左侧导航栏
    this.renderSidebar(layoutEl);

    // 渲染右侧主内容区
    const mainEl = layoutEl.createDiv({ cls: 'smart-workflow-main' });
    
    // 渲染头部
    this.renderHeader(mainEl);

    // 渲染内容区域
    const contentEl = mainEl.createDiv({ cls: 'smart-workflow-content' });
    this.renderContent(contentEl);
  }

  /**
   * 渲染左侧导航栏
   */
  private renderSidebar(layoutEl: HTMLElement): void {
    const sidebarEl = layoutEl.createDiv({ 
      cls: `smart-workflow-sidebar ${this.sidebarExpanded ? 'expanded' : ''}` 
    });

    // 展开/收起按钮
    const toggleBtn = sidebarEl.createDiv({ cls: 'sidebar-toggle' });
    setIcon(toggleBtn, this.sidebarExpanded ? 'chevron-left' : 'chevron-right');
    toggleBtn.setAttribute('aria-label', this.sidebarExpanded ? '收起导航' : '展开导航');
    toggleBtn.addEventListener('click', () => {
      this.sidebarExpanded = !this.sidebarExpanded;
      this.display();
    });

    // 导航项容器
    const navEl = sidebarEl.createDiv({ cls: 'sidebar-nav' });

    getSettingTabs().forEach(tab => {
      const navItem = navEl.createDiv({
        cls: `sidebar-nav-item ${tab.id === this.activeTab ? 'active' : ''}`
      });

      // 图标
      const iconEl = navItem.createDiv({ cls: 'sidebar-nav-icon' });
      setIcon(iconEl, tab.icon);

      // 文字标签（仅展开时显示）
      const labelEl = navItem.createSpan({ cls: 'sidebar-nav-label', text: tab.name });
      
      // 设置 tooltip（收起时显示）
      if (!this.sidebarExpanded) {
        navItem.setAttribute('aria-label', tab.name);
      }

      navItem.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.display();
      });
    });
  }

  /**
   * 渲染头部区域
   */
  private renderHeader(containerEl: HTMLElement): void {
    const headerEl = containerEl.createDiv({ cls: 'smart-workflow-settings-header' });
    
    // 标题行（包含标题和重载按钮）
    const titleRow = headerEl.createDiv({ cls: 'settings-title-row' });

    // 标题
    const titleEl = titleRow.createEl('h2', { text: 'Smart Workflow' });
    titleEl.addClass('settings-title');

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
    const feedbackContainer = headerEl.createDiv({ cls: 'settings-feedback' });
    feedbackContainer.appendText(t('settings.header.feedbackText'));
    feedbackContainer.createEl('a', {
      text: t('settings.header.feedbackLink'),
      href: 'https://github.com/ZyphrZero/obsidian-smart-workflow'
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
      case 'voice':
        this.voiceRenderer.render(context);
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
