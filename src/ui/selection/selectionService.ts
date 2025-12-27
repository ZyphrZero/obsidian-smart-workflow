/**
 * SelectionService - 选择监听服务
 * 负责监听和检测文字选择事件
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */

import { App, MarkdownView } from 'obsidian';
import { SelectionContext, SelectionToolbarSettings, ANIMATION_CONSTANTS } from './types';
import { debugLog } from '../../utils/logger';

/**
 * 选择变化回调类型
 */
export type SelectionChangeCallback = (context: SelectionContext | null) => void;

/**
 * 选择监听服务
 * 监听用户的文字选择操作，构建选择上下文
 */
export class SelectionService {
  private app: App;
  private settings: SelectionToolbarSettings;
  private isListening: boolean = false;
  private isDragging: boolean = false;
  private currentSelection: SelectionContext | null = null;
  
  /** 选择变化回调 */
  onSelectionChange: SelectionChangeCallback = () => {};
  
  // 事件处理器引用（用于移除监听）
  private boundMouseDown: (e: MouseEvent) => void;
  private boundMouseUp: (e: MouseEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundSelectionChange: () => void;
  private boundContextMenu: (e: MouseEvent) => void;

  constructor(app: App, settings: SelectionToolbarSettings) {
    this.app = app;
    this.settings = settings;
    
    // 绑定事件处理器
    this.boundMouseDown = this.handleMouseDown.bind(this);
    this.boundMouseUp = this.handleMouseUp.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundSelectionChange = this.handleSelectionChange.bind(this);
    this.boundContextMenu = this.handleContextMenu.bind(this);
  }

  /**
   * 开始监听选择事件
   * Requirements: 1.1, 1.2
   */
  startListening(): void {
    if (this.isListening) return;
    
    debugLog('[SelectionService] Starting to listen for selection events');
    
    document.addEventListener('mousedown', this.boundMouseDown);
    document.addEventListener('mouseup', this.boundMouseUp);
    document.addEventListener('keyup', this.boundKeyUp);
    document.addEventListener('selectionchange', this.boundSelectionChange);
    document.addEventListener('contextmenu', this.boundContextMenu);
    
    this.isListening = true;
  }

  /**
   * 停止监听选择事件
   */
  stopListening(): void {
    if (!this.isListening) return;
    
    document.removeEventListener('mousedown', this.boundMouseDown);
    document.removeEventListener('mouseup', this.boundMouseUp);
    document.removeEventListener('keyup', this.boundKeyUp);
    document.removeEventListener('selectionchange', this.boundSelectionChange);
    document.removeEventListener('contextmenu', this.boundContextMenu);
    
    this.isListening = false;
    this.currentSelection = null;
  }

  /**
   * 获取当前选择上下文
   */
  getCurrentSelection(): SelectionContext | null {
    return this.currentSelection;
  }

  /**
   * 更新设置
   */
  updateSettings(settings: SelectionToolbarSettings): void {
    this.settings = settings;
  }

  /**
   * 处理鼠标按下事件
   * Requirements: 1.5 - 拖动选择时不显示工具栏
   */
  private handleMouseDown(_e: MouseEvent): void {
    this.isDragging = true;
  }

  /**
   * 处理鼠标释放事件
   * Requirements: 1.1 - 鼠标拖动选择后检测
   */
  private handleMouseUp(e: MouseEvent): void {
    this.isDragging = false;
    
    // 检查是否点击在工具栏内，如果是则忽略
    const target = e.target as HTMLElement;
    if (target?.closest('.selection-toolbar')) {
      debugLog('[SelectionService] Mouse up on toolbar, skipping');
      return;
    }
    
    debugLog('[SelectionService] Mouse up detected, target:', e.target);
    
    // 延迟检测，确保选区已更新
    setTimeout(() => {
      this.detectSelection(e.target as HTMLElement);
    }, ANIMATION_CONSTANTS.SELECTION_DETECT_DELAY);
  }

  /**
   * 处理键盘释放事件
   * Requirements: 1.2 - 键盘快捷键选择后检测
   */
  private handleKeyUp(e: KeyboardEvent): void {
    // 只处理可能导致选择变化的按键
    const selectionKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
    const isSelectionKey = e.shiftKey && selectionKeys.includes(e.key);
    const isSelectAll = (e.ctrlKey || e.metaKey) && e.key === 'a';
    
    if (isSelectionKey || isSelectAll) {
      setTimeout(() => {
        this.detectSelection(e.target as HTMLElement);
      }, ANIMATION_CONSTANTS.SELECTION_DETECT_DELAY);
    }
  }

  /**
   * 处理右键菜单事件
   * 右键菜单关闭后延迟检测选区变化（处理右键全选）
   */
  private handleContextMenu(_e: MouseEvent): void {
    // 延迟检测，等待右键菜单操作完成
    setTimeout(() => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) {
        this.detectSelection(document.activeElement as HTMLElement);
      }
    }, 300);
  }

  /**
   * 处理选区变化事件
   * Requirements: 1.4 - 选区清除时隐藏工具栏
   */
  private handleSelectionChange(): void {
    // 如果正在拖动，不处理（等待 mouseup）
    if (this.isDragging) return;
    
    const selection = window.getSelection();
    
    // 选区被清除
    if (!selection || selection.isCollapsed || selection.toString().trim() === '') {
      if (this.currentSelection) {
        debugLog('[SelectionService] Selection cleared, notifying');
        this.currentSelection = null;
        // 立即通知选区清除
        this.onSelectionChange(null);
      }
    } else {
      // 选区存在且有内容，延迟检测（处理右键全选等情况）
      // 使用较长延迟确保 UI 操作完成
      setTimeout(() => {
        const currentSelection = window.getSelection();
        if (currentSelection && !currentSelection.isCollapsed && currentSelection.toString().trim()) {
          this.detectSelection(document.activeElement as HTMLElement);
        }
      }, 100);
    }
  }

  /**
   * 检测并处理选择
   */
  private detectSelection(target: HTMLElement | null): void {
    debugLog('[SelectionService] Detecting selection, target:', target);
    
    // 检查是否在 MarkdownView 中（优先使用选区锚点节点）
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    const checkTarget = (anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement) || target;
    
    if (!this.isInMarkdownView(checkTarget)) {
      debugLog('[SelectionService] Not in MarkdownView, skipping');
      // 如果不在 MarkdownView 中且之前有选择，清除选择
      if (this.currentSelection) {
        this.currentSelection = null;
        this.onSelectionChange(null);
      }
      return;
    }
    
    const context = this.buildSelectionContext();
    debugLog('[SelectionService] Built context:', context);
    
    if (context) {
      // 检查最小字符数
      // Requirements: 1.3 - 最小字符数过滤
      if (context.text.length < this.settings.minSelectionLength) {
        debugLog('[SelectionService] Selection too short:', context.text.length, '<', this.settings.minSelectionLength);
        // 选择太短，视为无选择
        if (this.currentSelection) {
          this.currentSelection = null;
          this.onSelectionChange(null);
        }
        return;
      }
      
      this.currentSelection = context;
      debugLog('[SelectionService] Calling onSelectionChange with context');
      this.onSelectionChange(context);
    } else {
      // 没有有效选择，隐藏工具栏
      if (this.currentSelection) {
        debugLog('[SelectionService] No valid selection, clearing');
        this.currentSelection = null;
        this.onSelectionChange(null);
      }
    }
  }

  /**
   * 构建选择上下文
   */
  private buildSelectionContext(): SelectionContext | null {
    const selection = window.getSelection();
    
    // 检查选区有效性
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return null;
    }
    
    const text = selection.toString().trim();
    if (!text) {
      return null;
    }
    
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    // 检查矩形有效性
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }
    
    // 获取视图类型
    const viewType = this.getViewType();
    
    return {
      text,
      rect,
      viewType,
      selection,
      range,
    };
  }

  /**
   * 检查目标元素是否在 MarkdownView 中
   * Requirements: 5.4 - 仅在 MarkdownView 中显示
   */
  private isInMarkdownView(target: HTMLElement | null): boolean {
    // 获取当前活动视图
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      debugLog('[SelectionService] isInMarkdownView: no active MarkdownView');
      return false;
    }
    
    const viewContainer = activeView.containerEl;
    
    // 如果有 target，检查是否在视图容器内
    if (target) {
      const isInView = viewContainer.contains(target);
      debugLog('[SelectionService] isInMarkdownView:', isInView, 'target:', target);
      if (isInView) return true;
    }
    
    // 如果 target 检查失败，尝试使用选区的锚点节点
    const selection = window.getSelection();
    if (selection && selection.anchorNode) {
      const anchorElement = selection.anchorNode instanceof HTMLElement 
        ? selection.anchorNode 
        : selection.anchorNode.parentElement;
      if (anchorElement && viewContainer.contains(anchorElement)) {
        debugLog('[SelectionService] isInMarkdownView: true (via anchorNode)');
        return true;
      }
    }
    
    debugLog('[SelectionService] isInMarkdownView: false');
    return false;
  }

  /**
   * 获取当前视图类型
   * Requirements: 5.1, 5.2, 5.3 - 支持不同编辑模式
   */
  private getViewType(): 'editing' | 'source' | 'reading' {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) return 'editing';
    
    const state = activeView.getState();
    const mode = state.mode;
    
    if (mode === 'source') {
      // 检查是否为 Live Preview 模式
      const isLivePreview = state.source === false;
      return isLivePreview ? 'editing' : 'source';
    } else if (mode === 'preview') {
      return 'reading';
    }
    
    return 'editing';
  }
}
