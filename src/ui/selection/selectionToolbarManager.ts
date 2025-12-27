/**
 * SelectionToolbarManager - 选中文字浮动工具栏主管理类
 * 负责组件生命周期和协调各子模块
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { App, MarkdownView } from 'obsidian';
import { 
  SelectionContext, 
  SelectionToolbarSettings, 
  ToolbarAction,
  DEFAULT_SELECTION_TOOLBAR_SETTINGS
} from './types';
import { SelectionService } from './selectionService';
import { ToolbarView } from './toolbarView';
import { PositionManager } from './positionManager';
import { ActionExecutor } from './actionExecutor';
import { debugLog } from '../../utils/logger';

/**
 * 选中文字浮动工具栏管理器
 * 协调 SelectionService、ToolbarView、PositionManager、ActionExecutor
 */
export class SelectionToolbarManager {
  private app: App;
  private settings: SelectionToolbarSettings;
  private isInitialized: boolean = false;
  
  // 子模块
  private selectionService: SelectionService;
  private toolbarView: ToolbarView;
  private positionManager: PositionManager;
  private actionExecutor: ActionExecutor;
  
  // 事件处理器引用
  private boundHandleKeyDown: (e: KeyboardEvent) => void;
  private boundHandleClick: (e: MouseEvent) => void;
  private boundHandleInput: (e: Event) => void;
  private boundHandleScroll: (e: Event) => void;
  
  // 显示延迟定时器
  private showDelayTimeoutId: number | null = null;

  constructor(app: App, settings?: SelectionToolbarSettings) {
    this.app = app;
    this.settings = settings || { ...DEFAULT_SELECTION_TOOLBAR_SETTINGS };
    
    // 初始化子模块
    this.selectionService = new SelectionService(app, this.settings);
    this.toolbarView = new ToolbarView();
    this.positionManager = new PositionManager();
    this.actionExecutor = new ActionExecutor(app);
    
    // 绑定事件处理器
    this.boundHandleKeyDown = this.handleKeyDown.bind(this);
    this.boundHandleClick = this.handleClick.bind(this);
    this.boundHandleInput = this.handleInput.bind(this);
    this.boundHandleScroll = this.handleScroll.bind(this);
  }

  /**
   * 初始化工具栏管理器
   * Requirements: 5.1, 5.2, 5.3 - 支持各种编辑模式
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
   * Requirements: 4.5 - 设置变更立即生效
   */
  updateSettings(settings: SelectionToolbarSettings): void {
    const wasEnabled = this.settings.enabled;
    this.settings = settings;
    
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
   */
  private setupActions(): void {
    const actions: ToolbarAction[] = [];
    
    // 复制按钮
    if (this.settings.actions.copy) {
      actions.push({
        id: 'copy',
        icon: 'copy',
        tooltipKey: 'selectionToolbar.actions.copy',
        execute: async (context) => {
          await this.actionExecutor.copyToClipboard(context.text);
        }
      });
    }
    
    // 搜索按钮
    if (this.settings.actions.search) {
      actions.push({
        id: 'search',
        icon: 'search',
        tooltipKey: 'selectionToolbar.actions.search',
        execute: async (context) => {
          this.actionExecutor.searchInVault(context.text);
        }
      });
    }
    
    // 创建链接按钮
    if (this.settings.actions.createLink) {
      actions.push({
        id: 'createLink',
        icon: 'link',
        tooltipKey: 'selectionToolbar.actions.createLink',
        execute: async (context) => {
          return this.actionExecutor.createInternalLink(context);
        },
        isDisabled: (context) => this.actionExecutor.isInternalLink(context.text)
      });
    }
    
    // 高亮按钮
    if (this.settings.actions.highlight) {
      actions.push({
        id: 'highlight',
        icon: 'highlighter',
        tooltipKey: 'selectionToolbar.actions.highlight',
        execute: async (context) => {
          return this.actionExecutor.addHighlight(context);
        },
        isDisabled: (context) => this.actionExecutor.isHighlighted(context.text)
      });
    }
    
    // 加粗按钮
    if (this.settings.actions.bold) {
      actions.push({
        id: 'bold',
        icon: 'bold',
        tooltipKey: 'selectionToolbar.actions.bold',
        execute: async (context) => {
          return this.actionExecutor.addBold(context);
        },
        isDisabled: (context) => this.actionExecutor.isBold(context.text)
      });
    }
    
    // 斜体按钮
    if (this.settings.actions.italic) {
      actions.push({
        id: 'italic',
        icon: 'italic',
        tooltipKey: 'selectionToolbar.actions.italic',
        execute: async (context) => {
          return this.actionExecutor.addItalic(context);
        },
        isDisabled: (context) => this.actionExecutor.isItalic(context.text)
      });
    }
    
    // 删除线按钮
    if (this.settings.actions.strikethrough) {
      actions.push({
        id: 'strikethrough',
        icon: 'strikethrough',
        tooltipKey: 'selectionToolbar.actions.strikethrough',
        execute: async (context) => {
          return this.actionExecutor.addStrikethrough(context);
        },
        isDisabled: (context) => this.actionExecutor.isStrikethrough(context.text)
      });
    }
    
    // 行内代码按钮
    if (this.settings.actions.inlineCode) {
      actions.push({
        id: 'inlineCode',
        icon: 'code',
        tooltipKey: 'selectionToolbar.actions.inlineCode',
        execute: async (context) => {
          return this.actionExecutor.addInlineCode(context);
        },
        isDisabled: (context) => this.actionExecutor.isInlineCode(context.text)
      });
    }
    
    // 行内公式按钮
    if (this.settings.actions.inlineMath) {
      actions.push({
        id: 'inlineMath',
        icon: 'sigma',
        tooltipKey: 'selectionToolbar.actions.inlineMath',
        execute: async (context) => {
          return this.actionExecutor.addInlineMath(context);
        },
        isDisabled: (context) => this.actionExecutor.isInlineMath(context.text)
      });
    }
    
    // 清除格式按钮
    if (this.settings.actions.clearFormat) {
      actions.push({
        id: 'clearFormat',
        icon: 'eraser',
        tooltipKey: 'selectionToolbar.actions.clearFormat',
        execute: async (context) => {
          return this.actionExecutor.clearFormatting(context);
        }
      });
    }
    
    this.toolbarView.updateActions(actions);
  }

  /**
   * 处理选择变化
   * Requirements: 5.4 - 仅在 MarkdownView 中显示
   * Requirements: 5.5 - 仅在选择发生的窗格中显示
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
    // Requirements: 5.4 - 非 MarkdownView 不显示
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
   * Requirements: 3.6 - 显示成功通知
   * @returns 新的选中文本（如果有）
   */
  private async handleActionExecute(
    action: ToolbarAction, 
    context: SelectionContext
  ): Promise<string | void> {
    try {
      const result = await action.execute(context);
      debugLog(`[SelectionToolbarManager] Action ${action.id} executed successfully`);
      return result;
    } catch (error) {
      debugLog(`[SelectionToolbarManager] Action ${action.id} failed:`, error);
    }
  }

  /**
   * 处理键盘按下事件
   * Requirements: 6.1 - Escape 键立即隐藏工具栏
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
   * Requirements: 6.3 - 点击工具栏外部隐藏
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
   * Requirements: 6.2 - 开始输入时隐藏工具栏，允许正常文本输入
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
   * Requirements: 5.4 - 仅在 MarkdownView 中显示
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
