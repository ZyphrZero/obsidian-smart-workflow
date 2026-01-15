/**
 * 设置标签页主入口
 * 负责标签页导航和状态管理，委托渲染给各 Renderer
 */

import type { App} from 'obsidian';
import { PluginSettingTab, setIcon } from 'obsidian';
import type SmartWorkflowPlugin from '../main';
import { ConfigManager } from '../services/config/configManager';
import { SecretService } from '../services/secret';
import { t } from '../i18n';

// 从模块化文件导入
import type { RendererContext, SettingTab } from './types';
import { getSettingTabs, findParentGroupId } from './utils/settingsUtils';
import {
  GeneralSettingsRenderer,
  FeatureSettingsRenderer,
  FileNamingSettingsRenderer,
  TerminalSettingsRenderer,
  AdvancedSettingsRenderer,
  VoiceSettingsRenderer,
  TaggingSettingsRenderer,
  AutoArchiveSettingsRenderer
} from './renderers';

/**
 * 设置标签页类
 * 提供插件配置界面
 */
export class SmartWorkflowSettingTab extends PluginSettingTab {
  plugin: SmartWorkflowPlugin;
  private activeTab = 'general';
  private expandedSections: Set<string> = new Set();
  private expandedGroups: Set<string> = new Set(); // 展开的导航分组
  private configManager: ConfigManager;
  private sidebarExpanded = false; // 侧边栏默认收起

  // 渲染器实例
  private generalRenderer: GeneralSettingsRenderer;
  private featureSettingsRenderer: FeatureSettingsRenderer;
  private fileNamingRenderer: FileNamingSettingsRenderer;
  private terminalRenderer: TerminalSettingsRenderer;
  private advancedRenderer: AdvancedSettingsRenderer;
  private voiceRenderer: VoiceSettingsRenderer;
  private taggingRenderer: TaggingSettingsRenderer;
  private autoArchiveRenderer: AutoArchiveSettingsRenderer;
  private secretService: SecretService;

  constructor(app: App, plugin: SmartWorkflowPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.secretService = new SecretService(app);
    this.configManager = new ConfigManager(
      this.plugin.settings,
      () => this.plugin.saveSettings(),
      this.secretService
    );

    // 初始化渲染器
    this.generalRenderer = new GeneralSettingsRenderer();
    this.featureSettingsRenderer = new FeatureSettingsRenderer();
    this.fileNamingRenderer = new FileNamingSettingsRenderer();
    this.terminalRenderer = new TerminalSettingsRenderer();
    this.advancedRenderer = new AdvancedSettingsRenderer();
    this.voiceRenderer = new VoiceSettingsRenderer();
    this.taggingRenderer = new TaggingSettingsRenderer();
    this.autoArchiveRenderer = new AutoArchiveSettingsRenderer();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // 刷新 ConfigManager 实例以确保使用最新设置
    this.configManager = new ConfigManager(
      this.plugin.settings,
      () => this.plugin.saveSettings(),
      this.secretService
    );

    // 自动展开当前激活标签页所属的分组
    const parentGroupId = findParentGroupId(this.activeTab);
    if (parentGroupId) {
      this.expandedGroups.add(parentGroupId);
    }

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
      if (tab.children && tab.children.length > 0) {
        // 有子菜单的分组
        this.renderNavGroup(navEl, tab);
      } else {
        // 普通导航项
        this.renderNavItem(navEl, tab);
      }
    });
  }

  /**
   * 渲染导航分组（带子菜单）
   */
  private renderNavGroup(navEl: HTMLElement, tab: SettingTab): void {
    const isGroupExpanded = this.expandedGroups.has(tab.id);
    const hasActiveChild = tab.children?.some(child => child.id === this.activeTab) ?? false;
    
    const groupEl = navEl.createDiv({
      cls: `sidebar-nav-group ${isGroupExpanded || hasActiveChild ? 'expanded' : ''}`
    });

    // 一级菜单项
    const navItem = groupEl.createDiv({
      cls: `sidebar-nav-item has-children ${hasActiveChild ? 'has-active-child' : ''}`
    });

    // 图标
    const iconEl = navItem.createDiv({ cls: 'sidebar-nav-icon' });
    setIcon(iconEl, tab.icon);

    // 文字标签
    navItem.createSpan({ cls: 'sidebar-nav-label', text: tab.name });

    // 展开箭头
    const arrowEl = navItem.createDiv({ cls: 'sidebar-nav-arrow' });
    setIcon(arrowEl, 'chevron-right');

    // 设置 tooltip（收起时显示）
    if (!this.sidebarExpanded) {
      navItem.setAttribute('aria-label', tab.name);
    }

    // 点击展开/收起（仅在侧边栏展开时生效）
    navItem.addEventListener('click', () => {
      // 收起状态下不处理点击，由 hover 显示浮动菜单
      if (!this.sidebarExpanded) {
        return;
      }
      
      if (this.expandedGroups.has(tab.id)) {
        this.expandedGroups.delete(tab.id);
      } else {
        this.expandedGroups.add(tab.id);
      }
      this.display();
    });

    // 二级菜单容器（展开状态）
    const submenuEl = groupEl.createDiv({ cls: 'sidebar-nav-submenu' });
    
    tab.children?.forEach(child => {
      const submenuItem = submenuEl.createDiv({
        cls: `sidebar-nav-submenu-item ${child.id === this.activeTab ? 'active' : ''}`
      });

      // 子菜单图标
      const childIconEl = submenuItem.createDiv({ cls: 'sidebar-nav-submenu-icon' });
      setIcon(childIconEl, child.icon);

      // 子菜单文字
      submenuItem.createSpan({ cls: 'sidebar-nav-submenu-label', text: child.name });

      submenuItem.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activeTab = child.id;
        this.display();
      });
    });

    // 浮动菜单（收起状态时 hover 显示）
    this.renderFloatingMenu(groupEl, tab);
  }

  /**
   * 渲染浮动二级菜单（侧边栏收起时使用）
   */
  private renderFloatingMenu(groupEl: HTMLElement, tab: SettingTab): void {
    const floatingMenu = groupEl.createDiv({ cls: 'sidebar-nav-floating-menu' });
    
    // 内容容器（用于样式）
    const contentEl = floatingMenu.createDiv({ cls: 'sidebar-nav-floating-menu-content' });
    
    // 标题
    contentEl.createDiv({ cls: 'sidebar-nav-floating-title', text: tab.name });
    
    tab.children?.forEach(child => {
      const floatingItem = contentEl.createDiv({
        cls: `sidebar-nav-floating-item ${child.id === this.activeTab ? 'active' : ''}`
      });

      const iconEl = floatingItem.createDiv({ cls: 'sidebar-nav-submenu-icon' });
      setIcon(iconEl, child.icon);
      floatingItem.createSpan({ text: child.name });

      floatingItem.addEventListener('click', (e) => {
        e.stopPropagation();
        this.activeTab = child.id;
        this.display();
      });
    });
  }

  /**
   * 渲染普通导航项（无子菜单）
   */
  private renderNavItem(navEl: HTMLElement, tab: SettingTab): void {
    const navItem = navEl.createDiv({
      cls: `sidebar-nav-item ${tab.id === this.activeTab ? 'active' : ''}`
    });

    // 图标
    const iconEl = navItem.createDiv({ cls: 'sidebar-nav-icon' });
    setIcon(iconEl, tab.icon);

    // 文字标签
    navItem.createSpan({ cls: 'sidebar-nav-label', text: tab.name });
    
    // 设置 tooltip（收起时显示）
    if (!this.sidebarExpanded) {
      navItem.setAttribute('aria-label', tab.name);
    }

    navItem.addEventListener('click', () => {
      this.activeTab = tab.id;
      this.display();
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
        this.featureSettingsRenderer.render(context);
        break;
      case 'fileNaming':
        this.fileNamingRenderer.render(context);
        break;
      case 'tagging':
        this.taggingRenderer.render(context);
        break;
      case 'autoArchive':
        this.autoArchiveRenderer.render(context);
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
