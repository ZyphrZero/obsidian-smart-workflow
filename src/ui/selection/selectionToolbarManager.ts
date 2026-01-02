/**
 * SelectionToolbarManager - 选中文字浮动工具栏主管理类
 * 负责组件生命周期和协调各子模块


 */

import { App, MarkdownView } from 'obsidian';
import { 
  SelectionContext, 
  SelectionToolbarSettings, 
  ToolbarAction,
  ToolbarActionItem,
  SubmenuAction,
  DEFAULT_SELECTION_TOOLBAR_SETTINGS
} from './types';
import { SelectionService } from './selectionService';
import { ToolbarView } from './toolbarView';
import { PositionManager } from './positionManager';
import { ActionExecutor } from './actionExecutor';
import { debugLog } from '../../utils/logger';
import { SmartWorkflowSettings } from '../../settings/settings';
import { WritingActionExecutor, WritingActionContext } from '../writing/writingActionExecutor';
import { TranslationService } from '../../services/translation';
import { TranslationModal } from '../translation/translationModal';
import { ServerManager } from '../../services/server/serverManager';

/**
 * 选中文字浮动工具栏管理器
 * 协调 SelectionService、ToolbarView、PositionManager、ActionExecutor
 */
export class SelectionToolbarManager {
  private app: App;
  private settings: SelectionToolbarSettings;
  private pluginSettings: SmartWorkflowSettings | null = null;
  private isInitialized: boolean = false;
  
  // 子模块
  private selectionService: SelectionService;
  private toolbarView: ToolbarView;
  private positionManager: PositionManager;
  private actionExecutor: ActionExecutor;
  
  // 写作功能执行器
  private writingActionExecutor: WritingActionExecutor | null = null;
  private onSettingsChange?: () => Promise<void>;
  
  // 翻译服务
  private translationService: TranslationService | null = null;
  
  // ServerManager 实例
  private serverManager: ServerManager | null = null;
  
  // 事件处理器引用
  private boundHandleKeyDown: (e: KeyboardEvent) => void;
  private boundHandleClick: (e: MouseEvent) => void;
  private boundHandleInput: (e: Event) => void;
  private boundHandleScroll: (e: Event) => void;
  
  // 显示延迟定时器
  private showDelayTimeoutId: number | null = null;

  constructor(
    app: App, 
    settings?: SelectionToolbarSettings,
    pluginSettings?: SmartWorkflowSettings,
    onSettingsChange?: () => Promise<void>
  ) {
    this.app = app;
    this.settings = settings || { ...DEFAULT_SELECTION_TOOLBAR_SETTINGS };
    this.pluginSettings = pluginSettings || null;
    this.onSettingsChange = onSettingsChange;
    
    // 初始化子模块
    this.selectionService = new SelectionService(app, this.settings);
    this.toolbarView = new ToolbarView();
    this.positionManager = new PositionManager();
    this.actionExecutor = new ActionExecutor(app);
    
    // 初始化写作功能执行器（如果有插件设置）
    if (this.pluginSettings) {
      this.writingActionExecutor = new WritingActionExecutor(
        app,
        this.pluginSettings,
        onSettingsChange
      );
      
      // 初始化翻译服务
      this.translationService = new TranslationService(
        app,
        this.pluginSettings,
        onSettingsChange
      );
    }
    
    // 绑定事件处理器
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    this.boundHandleClick = this.handleClick.bind(this);
    this.boundHandleInput = this.handleInput.bind(this);
    this.boundHandleScroll = this.handleScroll.bind(this);
  }

  /**
   * 初始化工具栏管理器

   */
  initialize(): void {
    if (this.isInitialized) {
      debugLog('[SelectionToolbarManager] Already initialized');
      return;
    }
    
    if (!this.settings.enabled) {
      debugLog('[SelectionToolbarManager] Feature disabled, skipping initialization');
      return;
    }
    
    debugLog('[SelectionToolbarManager] Initializing...');
    
    // 渲染工具栏到 body
    this.toolbarView.render(document.body);
    
    // 设置工具栏动作
    this.setupActions();
    
    // 设置选择变化回调
    this.selectionService.onSelectionChange = this.handleSelectionChange.bind(this);
    
    // 设置动作执行回调
    this.toolbarView.onActionExecute = this.handleActionExecute.bind(this);
    
    // 开始监听选择事件
    this.selectionService.startListening();
    
    // 添加键盘和点击事件监听
    document.addEventListener('keydown', this.boundHandleKeyDown);
    document.addEventListener('click', this.boundHandleClick, true);
    document.addEventListener('input', this.boundHandleInput, true);
    document.addEventListener('scroll', this.boundHandleScroll, true);
    
    this.isInitialized = true;
    debugLog('[SelectionToolbarManager] Initialized successfully');
  }

  /**
   * 销毁工具栏管理器，清理所有事件监听
   */
  destroy(): void {
    if (!this.isInitialized) {
      return;
    }
    
    debugLog('[SelectionToolbarManager] Destroying...');
    
    // 清除显示延迟定时器
    this.clearShowDelayTimeout();
    
    // 停止选择监听
    this.selectionService.stopListening();
    
    // 移除事件监听
    document.removeEventListener('keydown', this.boundHandleKeyDown);
    document.removeEventListener('click', this.boundHandleClick, true);
    document.removeEventListener('input', this.boundHandleInput, true);
    document.removeEventListener('scroll', this.boundHandleScroll, true);
    
    // 销毁工具栏视图
    this.toolbarView.destroy();
    
    this.isInitialized = false;
    debugLog('[SelectionToolbarManager] Destroyed');
  }

  /**
   * 更新设置

   */
  updateSettings(settings: SelectionToolbarSettings, pluginSettings?: SmartWorkflowSettings): void {
    const wasEnabled = this.settings.enabled;
    this.settings = settings;
    
    // 更新插件设置
    if (pluginSettings) {
      this.pluginSettings = pluginSettings;
      
      // 更新写作功能执行器
      if (this.writingActionExecutor) {
        this.writingActionExecutor.updateSettings(pluginSettings);
      } else {
        this.writingActionExecutor = new WritingActionExecutor(
          this.app,
          pluginSettings,
          this.onSettingsChange
        );
      }
      
      // 更新翻译服务
      if (!this.translationService) {
        this.translationService = new TranslationService(
          this.app,
          pluginSettings,
          this.onSettingsChange
        );
      }
    }
    
    // 更新子模块设置
    this.selectionService.updateSettings(settings);
    
    // 处理启用/禁用状态变化
    if (wasEnabled && !settings.enabled) {
      // 从启用变为禁用
      this.destroy();
    } else if (!wasEnabled && settings.enabled) {
      // 从禁用变为启用
      this.initialize();
    } else if (settings.enabled) {
      // 更新动作按钮
      this.setupActions();
    }
    
    debugLog('[SelectionToolbarManager] Settings updated');
  }

  /**
   * 设置 ServerManager
   * 用于启用 Rust 模式的流式处理
   */
  setServerManager(serverManager: ServerManager): void {
    this.serverManager = serverManager;
    
    // 更新写作功能执行器
    if (this.writingActionExecutor) {
      this.writingActionExecutor.setServerManager(serverManager);
    }
    
    // 更新翻译服务
    if (this.translationService) {
      this.translationService.setServerManager(serverManager);
    }
    
    debugLog('[SelectionToolbarManager] ServerManager set');
  }

  /**
   * 手动显示工具栏（用于测试）
   */
  show(selection: SelectionContext): void {
    if (!this.isInitialized || !this.settings.enabled) {
      return;
    }
    
    this.showToolbar(selection);
  }

  /**
   * 手动隐藏工具栏
   */
  hide(): void {
    this.clearShowDelayTimeout();
    this.toolbarView.hide();
  }

  /**
   * 检查工具栏是否可见
   */
  isVisible(): boolean {
    return this.toolbarView.getIsVisible();
  }

  /**
   * 设置工具栏动作按钮
   * 根据 buttonConfigs 配置动态生成按钮，支持自定义图标、标签显示和顺序
   */
  private setupActions(): void {
    // 获取按钮配置，按 order 排序
    const buttonConfigs = this.settings.buttonConfigs || [];
    const sortedConfigs = [...buttonConfigs].sort((a, b) => a.order - b.order);
    
    const actions: ToolbarActionItem[] = [];
    
    // 按钮定义映射
    const buttonDefinitions = this.getButtonDefinitions();
    
    // 根据配置生成按钮
    for (const config of sortedConfigs) {
      if (!config.enabled) continue;
      
      // 特殊处理写作子菜单
      if (config.id === 'writing') {
        const writingSubmenu = this.buildWritingSubmenu(config.showLabel);
        if (writingSubmenu) {
          actions.push(writingSubmenu);
        }
        continue;
      }
      
      // 获取按钮定义
      const definition = buttonDefinitions[config.id];
      if (!definition) continue;
      
      // 创建动作，应用配置
      const action: ToolbarAction = {
        ...definition,
        icon: config.customIcon || definition.icon,
        showLabel: config.showLabel,
      };
      
      actions.push(action);
    }
    
    this.toolbarView.updateActions(actions);
  }

  /**
   * 获取所有按钮的定义
   * @returns 按钮 ID 到定义的映射
   */
  private getButtonDefinitions(): Record<string, ToolbarAction> {
    return {
      copy: {
        id: 'copy',
        icon: 'copy',
        tooltipKey: 'selectionToolbar.actions.copy',
        hideAfterExecute: true,
        execute: async (context) => {
          await this.actionExecutor.copyToClipboard(context.text);
        }
      },
      search: {
        id: 'search',
        icon: 'search',
        tooltipKey: 'selectionToolbar.actions.search',
        hideAfterExecute: true,
        execute: async (context) => {
          this.actionExecutor.searchInVault(context.text);
        }
      },
      createLink: {
        id: 'createLink',
        icon: 'link',
        tooltipKey: 'selectionToolbar.actions.createLink',
        execute: async (context) => {
          return this.actionExecutor.createInternalLink(context);
        },
        isDisabled: (context) => this.actionExecutor.isInternalLink(context.text)
      },
      highlight: {
        id: 'highlight',
        icon: 'highlighter',
        tooltipKey: 'selectionToolbar.actions.highlight',
        execute: async (context) => {
          return this.actionExecutor.addHighlight(context);
        },
        isDisabled: (context) => this.actionExecutor.isHighlighted(context.text)
      },
      bold: {
        id: 'bold',
        icon: 'bold',
        tooltipKey: 'selectionToolbar.actions.bold',
        execute: async (context) => {
          return this.actionExecutor.addBold(context);
        },
        isDisabled: (context) => this.actionExecutor.isBold(context.text)
      },
      italic: {
        id: 'italic',
        icon: 'italic',
        tooltipKey: 'selectionToolbar.actions.italic',
        execute: async (context) => {
          return this.actionExecutor.addItalic(context);
        },
        isDisabled: (context) => this.actionExecutor.isItalic(context.text)
      },
      strikethrough: {
        id: 'strikethrough',
        icon: 'strikethrough',
        tooltipKey: 'selectionToolbar.actions.strikethrough',
        execute: async (context) => {
          return this.actionExecutor.addStrikethrough(context);
        },
        isDisabled: (context) => this.actionExecutor.isStrikethrough(context.text)
      },
      inlineCode: {
        id: 'inlineCode',
        icon: 'code',
        tooltipKey: 'selectionToolbar.actions.inlineCode',
        execute: async (context) => {
          return this.actionExecutor.addInlineCode(context);
        },
        isDisabled: (context) => this.actionExecutor.isInlineCode(context.text)
      },
      inlineMath: {
        id: 'inlineMath',
        icon: 'sigma',
        tooltipKey: 'selectionToolbar.actions.inlineMath',
        execute: async (context) => {
          return this.actionExecutor.addInlineMath(context);
        },
        isDisabled: (context) => this.actionExecutor.isInlineMath(context.text)
      },
      clearFormat: {
        id: 'clearFormat',
        icon: 'eraser',
        tooltipKey: 'selectionToolbar.actions.clearFormat',
        execute: async (context) => {
          return this.actionExecutor.clearFormatting(context);
        }
      },
      translate: {
        id: 'translate',
        icon: 'languages',
        tooltipKey: 'selectionToolbar.actions.translate',
        hideAfterExecute: false,
        execute: async (context) => {
          await this.executeTranslate(context);
        },
        isDisabled: (context) => {
          // 空白文本禁用翻译按钮
          return !context.text || context.text.trim().length === 0;
        }
      }
    };
  }

  /**
   * 构建写作子菜单

   * @param showLabel 是否显示文字标签
   * @returns 写作子菜单动作，如果写作功能禁用则返回 null
   */
  private buildWritingSubmenu(showLabel: boolean = true): SubmenuAction | null {
    // 检查写作功能是否启用
    if (!this.pluginSettings?.writing?.enabled) {
      return null;
    }
    
    const writingSettings = this.pluginSettings.writing;
    const submenuItems: ToolbarAction[] = [];
    
    // 润色动作

    if (writingSettings.actions.polish) {
      submenuItems.push({
        id: 'writing-polish',
        icon: 'sparkles',
        tooltipKey: 'writing.menu.polish',
        showLabel: writingSettings.showLabels?.polish ?? true,
        hideAfterExecute: true,
        execute: async (context) => {
          await this.executeWritingPolish(context);
        }
      });
    }
    
    // 缩写动作（预留）
    if (writingSettings.actions.condense) {
      submenuItems.push({
        id: 'writing-condense',
        icon: 'minimize-2',
        tooltipKey: 'writing.menu.condense',
        hideAfterExecute: true,
        execute: async () => {
          // TODO: 实现缩写功能
          debugLog('[SelectionToolbarManager] 缩写功能尚未实现');
        }
      });
    }
    
    // 扩写动作（预留）
    if (writingSettings.actions.expand) {
      submenuItems.push({
        id: 'writing-expand',
        icon: 'maximize-2',
        tooltipKey: 'writing.menu.expand',
        hideAfterExecute: true,
        execute: async () => {
          // TODO: 实现扩写功能
          debugLog('[SelectionToolbarManager] 扩写功能尚未实现');
        }
      });
    }
    
    // 续写动作（预留）
    if (writingSettings.actions.continue) {
      submenuItems.push({
        id: 'writing-continue',
        icon: 'arrow-right',
        tooltipKey: 'writing.menu.continue',
        hideAfterExecute: true,
        execute: async () => {
          // TODO: 实现续写功能
          debugLog('[SelectionToolbarManager] 续写功能尚未实现');
        }
      });
    }
    
    // 如果没有启用任何写作动作，不显示子菜单
    if (submenuItems.length === 0) {
      return null;
    }
    
    return {
      id: 'writing',
      icon: 'pen-tool',
      tooltipKey: 'writing.menu.writing',
      submenu: submenuItems,
      showLabel: showLabel
    };
  }

  /**
   * 执行写作润色动作

   * @param context 选择上下文
   */
  private async executeWritingPolish(context: SelectionContext): Promise<void> {
    if (!this.writingActionExecutor) {
      debugLog('[SelectionToolbarManager] WritingActionExecutor 未初始化');
      return;
    }
    
    // 获取当前活动的 MarkdownView
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      debugLog('[SelectionToolbarManager] 无法获取 MarkdownView');
      return;
    }
    
    // 获取编辑器
    const editor = activeView.editor;
    if (!editor) {
      debugLog('[SelectionToolbarManager] 无法获取 Editor');
      return;
    }
    
    // 获取选区位置
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    
    // 构建写作动作上下文
    const writingContext: WritingActionContext = {
      text: context.text,
      range: context.range,
      editor: editor,
      view: activeView,
      from: from,
      to: to,
      selections: context.selections,
      isMultiSelection: context.isMultiSelection,
    };
    
    debugLog('[SelectionToolbarManager] 执行润色，多选区:', context.isMultiSelection, '选区数:', context.selections?.length);
    
    // 执行润色
    await this.writingActionExecutor.executePolish(writingContext);
  }

  /**
   * 执行翻译动作
   * 打开翻译模态窗口
   * @param context 选择上下文
   */
  private async executeTranslate(context: SelectionContext): Promise<void> {
    if (!this.translationService || !this.pluginSettings) {
      debugLog('[SelectionToolbarManager] TranslationService 或 pluginSettings 未初始化');
      return;
    }
    
    // 获取当前活动的 MarkdownView
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      debugLog('[SelectionToolbarManager] 无法获取 MarkdownView');
      return;
    }
    
    // 获取编辑器
    const editor = activeView.editor;
    if (!editor) {
      debugLog('[SelectionToolbarManager] 无法获取 Editor');
      return;
    }
    
    debugLog('[SelectionToolbarManager] 打开翻译模态窗口，文本长度:', context.text.length);
    
    // 打开翻译模态窗口
    const modal = new TranslationModal(this.app, {
      originalText: context.text,
      selectionContext: context,
      translationService: this.translationService,
      settings: this.pluginSettings,
      onReplace: (translatedText: string) => {
        // 替换选中文本
        const from = editor.getCursor('from');
        const to = editor.getCursor('to');
        editor.replaceRange(translatedText, from, to);
        debugLog('[SelectionToolbarManager] 翻译文本已替换');
      },
      onSettingsSave: this.onSettingsChange,
    });
    
    modal.open();
  }

  /**
   * 处理选择变化
   * 仅在 MarkdownView 中显示
   */
  private handleSelectionChange(context: SelectionContext | null): void {
    debugLog('[SelectionToolbarManager] handleSelectionChange called, context:', context);
    
    if (!context) {
      // 选择被清除，隐藏工具栏
      debugLog('[SelectionToolbarManager] No context, hiding toolbar');
      this.hide();
      return;
    }
    
    // 检查是否在 MarkdownView 中
    // 非 MarkdownView 不显示
    if (!this.isInMarkdownView()) {
      debugLog('[SelectionToolbarManager] Not in MarkdownView, skipping');
      return;
    }
    
    debugLog('[SelectionToolbarManager] Showing toolbar for selection:', context.text);
    
    // 处理显示延迟
    if (this.settings.showDelay > 0) {
      this.clearShowDelayTimeout();
      this.showDelayTimeoutId = window.setTimeout(() => {
        this.showToolbar(context);
      }, this.settings.showDelay);
    } else {
      this.showToolbar(context);
    }
  }

  /**
   * 显示工具栏
   */
  private showToolbar(context: SelectionContext): void {
    // 获取工具栏尺寸
    const toolbarSize = this.toolbarView.getSize();
    debugLog('[SelectionToolbarManager] Toolbar size:', toolbarSize);
    
    // 计算位置
    const position = this.positionManager.calculatePosition(
      context.rect,
      toolbarSize
    );
    debugLog('[SelectionToolbarManager] Calculated position:', position);
    
    // 显示工具栏
    this.toolbarView.show(position, context);
    debugLog('[SelectionToolbarManager] Toolbar shown');
  }

  /**
   * 处理动作执行

   * @returns 执行结果，包含新文本和是否隐藏工具栏
   */
  private async handleActionExecute(
    action: ToolbarAction, 
    context: SelectionContext
  ): Promise<{ newText?: string; shouldHide: boolean }> {
    try {
      const result = await action.execute(context);
      debugLog(`[SelectionToolbarManager] Action ${action.id} executed successfully`);
      
      const shouldHide = action.hideAfterExecute ?? false;
      
      // 如果需要隐藏，清除选区以防止重新触发显示
      if (shouldHide) {
        window.getSelection()?.removeAllRanges();
      }
      
      return {
        newText: typeof result === 'string' ? result : undefined,
        shouldHide
      };
    } catch (error) {
      debugLog(`[SelectionToolbarManager] Action ${action.id} failed:`, error);
      return { shouldHide: false };
    }
  }

  /**
   * 处理键盘按下事件
   * Escape 键立即隐藏工具栏
   */
  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.toolbarView.getIsVisible()) {
      return;
    }
    
    // Escape 键立即隐藏工具栏（无动画）
    if (e.key === 'Escape') {
      this.clearShowDelayTimeout();
      this.toolbarView.hideImmediately();
    }
  }

  /**
   * 处理点击事件
   * 点击工具栏外部隐藏
   */
  private handleClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    
    // 如果点击在工具栏内，不处理
    if (this.toolbarView.containsElement(target)) {
      return;
    }
    
    // 点击工具栏外部时，清除显示延迟定时器
    this.clearShowDelayTimeout();
  }

  /**
   * 处理输入事件
   * 开始输入时隐藏工具栏，允许正常文本输入
   */
  private handleInput(_e: Event): void {
    if (this.toolbarView.getIsVisible()) {
      // 立即隐藏工具栏，不阻止输入
      this.clearShowDelayTimeout();
      this.toolbarView.hideImmediately();
    }
  }

  /**
   * 处理滚动事件
   * 滚动时隐藏工具栏，避免工具栏位置与选区不同步
   */
  private handleScroll(_e: Event): void {
    if (this.toolbarView.getIsVisible()) {
      this.clearShowDelayTimeout();
      this.toolbarView.hideImmediately();
    }
  }

  /**
   * 检查当前活动视图是否为 MarkdownView
   * 仅在 MarkdownView 中显示
   */
  private isInMarkdownView(): boolean {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    return activeView !== null;
  }

  /**
   * 清除显示延迟定时器
   */
  private clearShowDelayTimeout(): void {
    if (this.showDelayTimeoutId !== null) {
      window.clearTimeout(this.showDelayTimeoutId);
      this.showDelayTimeoutId = null;
    }
  }
}
