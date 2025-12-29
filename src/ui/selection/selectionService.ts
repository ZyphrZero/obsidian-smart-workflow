/**
 * SelectionService - 选择监听服务
 * 负责监听和检测文字选择事件

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
  
  /** 右键菜单是否打开（用于暂停选区检测） */
  private isContextMenuOpen: boolean = false;
  
  /** 防抖定时器 ID */
  private detectTimeoutId: number | null = null;
  
  /** 选择变化回调 */
  onSelectionChange: SelectionChangeCallback = () => {};
  
  // 事件处理器引用（用于移除监听）
  private boundMouseDown: (e: MouseEvent) => void;
  private boundMouseUp: (e: MouseEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundSelectionChange: () => void;
  private boundContextMenu: (e: MouseEvent) => void;
  private boundDocumentClick: (e: MouseEvent) => void;

  constructor(app: App, settings: SelectionToolbarSettings) {
    this.app = app;
    this.settings = settings;
    
    // 绑定事件处理器
    this.boundMouseDown = this.handleMouseDown.bind(this);
    this.boundMouseUp = this.handleMouseUp.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundSelectionChange = this.handleSelectionChange.bind(this);
    this.boundContextMenu = this.handleContextMenu.bind(this);
    this.boundDocumentClick = this.handleDocumentClick.bind(this);
  }

  /**
   * 开始监听选择事件

   */
  startListening(): void {
    if (this.isListening) return;
    
    debugLog('[SelectionService] Starting to listen for selection events');
    
    document.addEventListener('mousedown', this.boundMouseDown);
    document.addEventListener('mouseup', this.boundMouseUp);
    document.addEventListener('keyup', this.boundKeyUp);
    document.addEventListener('selectionchange', this.boundSelectionChange);
    // 使用捕获阶段确保在其他处理器之前执行
    document.addEventListener('contextmenu', this.boundContextMenu, true);
    // 监听点击事件以检测右键菜单关闭
    document.addEventListener('click', this.boundDocumentClick);
    
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
    document.removeEventListener('contextmenu', this.boundContextMenu, true);
    document.removeEventListener('click', this.boundDocumentClick);
    
    this.clearDetectTimeout();
    this.isListening = false;
    this.isContextMenuOpen = false;
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
   * 拖动选择时不显示工具栏
   */
  private handleMouseDown(e: MouseEvent): void {
    this.isDragging = true;
    // 只有左键按下时才关闭右键菜单状态
    if (e.button === 0) {
      this.isContextMenuOpen = false;
    }
  }

  /**
   * 处理鼠标释放事件
   * 鼠标拖动选择后检测
   */
  private handleMouseUp(e: MouseEvent): void {
    this.isDragging = false;
    
    // 右键释放或右键菜单打开期间不处理
    if (e.button === 2 || this.isContextMenuOpen) {
      return;
    }
    
    // 检查是否点击在工具栏内，如果是则忽略
    const target = e.target as HTMLElement;
    if (target?.closest('.selection-toolbar')) {
      return;
    }
    
    // 防抖检测
    this.scheduleDetection(e.target as HTMLElement);
  }

  /**
   * 处理键盘释放事件
   * 键盘快捷键选择后检测
   */
  private handleKeyUp(e: KeyboardEvent): void {
    // 右键菜单打开期间不处理
    if (this.isContextMenuOpen) return;
    
    // 只处理可能导致选择变化的按键
    const selectionKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
    const isSelectionKey = e.shiftKey && selectionKeys.includes(e.key);
    const isSelectAll = (e.ctrlKey || e.metaKey) && e.key === 'a';
    
    if (isSelectionKey || isSelectAll) {
      this.scheduleDetection(e.target as HTMLElement);
    }
  }

  /**
   * 处理右键菜单事件
   * 右键菜单打开时隐藏工具栏并暂停选区检测
   */
  private handleContextMenu(_e: MouseEvent): void {
    debugLog('[SelectionService] Context menu opened, hiding toolbar');
    
    // 标记右键菜单已打开
    this.isContextMenuOpen = true;
    
    // 立即通知隐藏工具栏（无论当前是否有选区）
    this.onSelectionChange(null);
    this.currentSelection = null;
  }

  /**
   * 处理文档点击事件
   * 用于检测右键菜单关闭后恢复选区检测
   */
  private handleDocumentClick(_e: MouseEvent): void {
    if (this.isContextMenuOpen) {
      debugLog('[SelectionService] Context menu closed via click');
      this.isContextMenuOpen = false;
      
      // 延迟检测选区
      this.scheduleDetection(document.activeElement as HTMLElement);
    }
  }

  /**
   * 处理选区变化事件
   * 选区清除时隐藏工具栏
   */
  private handleSelectionChange(): void {
    // 如果正在拖动或右键菜单打开，不处理
    if (this.isDragging || this.isContextMenuOpen) return;
    
    const selection = window.getSelection();
    
    // 选区被清除 - 立即响应
    if (!selection || selection.isCollapsed || selection.toString().trim() === '') {
      this.clearDetectTimeout();
      if (this.currentSelection) {
        debugLog('[SelectionService] Selection cleared, notifying');
        this.currentSelection = null;
        this.onSelectionChange(null);
      }
    } else {
      // 选区存在且有内容，防抖检测
      this.scheduleDetection(document.activeElement as HTMLElement);
    }
  }

  /**
   * 调度选区检测（防抖）
   */
  private scheduleDetection(target: HTMLElement | null): void {
    this.clearDetectTimeout();
    
    this.detectTimeoutId = window.setTimeout(() => {
      this.detectTimeoutId = null;
      
      if (this.isContextMenuOpen) return;
      
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        if (this.currentSelection) {
          this.currentSelection = null;
          this.onSelectionChange(null);
        }
        return;
      }
      
      this.detectSelection(target);
    }, ANIMATION_CONSTANTS.SELECTION_DETECT_DELAY);
  }

  /**
   * 清除检测定时器
   */
  private clearDetectTimeout(): void {
    if (this.detectTimeoutId !== null) {
      window.clearTimeout(this.detectTimeoutId);
      this.detectTimeoutId = null;
    }
  }

  /**
   * 检测并处理选择
   */
  private detectSelection(target: HTMLElement | null): void {
    // 检查是否在 MarkdownView 中（优先使用选区锚点节点）
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    const checkTarget = (anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement) || target;
    
    if (!this.isInMarkdownView(checkTarget)) {
      // 如果不在 MarkdownView 中且之前有选择，清除选择
      if (this.currentSelection) {
        this.currentSelection = null;
        this.onSelectionChange(null);
      }
      return;
    }
    
    debugLog('[SelectionService] Detecting selection in MarkdownView');
    
    const context = this.buildSelectionContext();
    debugLog('[SelectionService] Built context:', context);
    
    if (context) {
      // 检查最小字符数
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
   * 仅在 MarkdownView 中显示
   */
  private isInMarkdownView(target: HTMLElement | null): boolean {
    // 获取当前活动视图
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      return false;
    }
    
    const viewContainer = activeView.containerEl;
    
    // 如果有 target，检查是否在视图容器内
    if (target) {
      const isInView = viewContainer.contains(target);
      if (isInView) return true;
    }
    
    // 如果 target 检查失败，尝试使用选区的锚点节点
    const selection = window.getSelection();
    if (selection && selection.anchorNode) {
      const anchorElement = selection.anchorNode instanceof HTMLElement 
        ? selection.anchorNode 
        : selection.anchorNode.parentElement;
      if (anchorElement && viewContainer.contains(anchorElement)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * 获取当前视图类型
   * 支持不同编辑模式
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
