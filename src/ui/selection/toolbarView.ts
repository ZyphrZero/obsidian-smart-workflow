/**
 * ToolbarView - 工具栏视图组件
 * 负责工具栏的 DOM 渲染和交互


 */

import { setIcon, setTooltip } from 'obsidian';
import { 
  ToolbarAction, 
  ToolbarActionItem,
  SubmenuAction,
  ToolbarPosition, 
  SelectionContext,
  ANIMATION_CONSTANTS,
  isSubmenuAction
} from './types';
import { t } from '../../i18n';

/**
 * 工具栏动作执行回调
 * @returns { newText?: string, shouldHide: boolean }
 */
export type ActionCallback = (action: ToolbarAction, context: SelectionContext) => Promise<{ newText?: string; shouldHide: boolean }>;

/**
 * 工具栏视图类
 * 管理工具栏的 DOM 结构、显示/隐藏和用户交互
 */
export class ToolbarView {
  private containerEl: HTMLElement | null = null;
  private toolbarEl: HTMLElement | null = null;
  private actions: ToolbarActionItem[] = [];
  private currentContext: SelectionContext | null = null;
  private isVisible: boolean = false;
  private hideTimeoutId: number | null = null;
  
  // 当前打开的子菜单
  private activeSubmenu: HTMLElement | null = null;
  private activeSubmenuWrapper: HTMLElement | null = null;
  
  // 全局点击监听器（用于关闭子菜单）
  private documentClickHandler: ((e: MouseEvent) => void) | null = null;
  
  // 拖拽相关状态
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private toolbarStartX: number = 0;
  private toolbarStartY: number = 0;
  private boundHandleMouseMove: (e: MouseEvent) => void;
  private boundHandleMouseUp: (e: MouseEvent) => void;
  
  /** 动作执行回调 */
  onActionExecute: ActionCallback = async () => ({ shouldHide: false });

  constructor() {
    // 初始化时不创建 DOM，等待 render() 调用
    // 绑定拖拽事件处理器
    this.boundHandleMouseMove = this.handleDragMove.bind(this);
    this.boundHandleMouseUp = this.handleDragEnd.bind(this);
  }

  /**
   * 渲染工具栏到 DOM
   * @param container 父容器元素
   */
  render(container: HTMLElement): void {
    this.containerEl = container;
    
    // 创建工具栏元素
    this.toolbarEl = document.createElement('div');
    this.toolbarEl.className = 'selection-toolbar';
    this.toolbarEl.setAttribute('role', 'toolbar');
    this.toolbarEl.setAttribute('aria-label', 'Selection toolbar');
    
    // 渲染按钮
    this.renderButtons();
    
    // 添加到容器
    this.containerEl.appendChild(this.toolbarEl);
    
    console.log('[ToolbarView] Toolbar rendered, element:', this.toolbarEl);
  }

  /**
   * 显示工具栏

   * @param position 工具栏位置
   * @param context 选择上下文
   */
  show(position: ToolbarPosition, context: SelectionContext): void {
    if (!this.toolbarEl) {
      console.warn('[ToolbarView] Cannot show: toolbarEl is null');
      return;
    }
    
    // 清除隐藏定时器
    this.clearHideTimeout();
    
    // 保存当前上下文
    this.currentContext = context;
    
    // 更新按钮禁用状态
    this.updateButtonStates(context);
    
    // 设置位置
    this.toolbarEl.style.top = `${position.top}px`;
    this.toolbarEl.style.left = `${position.left}px`;
    
    console.log('[ToolbarView] Showing toolbar at position:', position);
    
    // 移除隐藏类，添加可见类
    this.toolbarEl.classList.remove('hiding');
    this.toolbarEl.classList.add('visible');
    
    this.isVisible = true;
  }

  /**
   * 隐藏工具栏
   */
  hide(): void {
    if (!this.toolbarEl || !this.isVisible) return;
    
    // 关闭子菜单
    this.closeActiveSubmenu();
    
    // 添加隐藏动画类
    this.toolbarEl.classList.add('hiding');
    this.toolbarEl.classList.remove('visible');
    
    // 动画结束后完全隐藏
    this.hideTimeoutId = window.setTimeout(() => {
      if (this.toolbarEl) {
        this.toolbarEl.classList.remove('hiding');
      }
      this.currentContext = null;
      this.isVisible = false;
    }, ANIMATION_CONSTANTS.FADE_OUT_DURATION);
  }

  /**
   * 立即隐藏工具栏（无动画）
   */
  hideImmediately(): void {
    if (!this.toolbarEl) return;
    
    this.clearHideTimeout();
    this.closeActiveSubmenu();
    
    this.toolbarEl.classList.remove('visible', 'hiding');
    this.currentContext = null;
    this.isVisible = false;
  }

  /**
   * 检查工具栏是否可见
   */
  getIsVisible(): boolean {
    return this.isVisible;
  }

  /**
   * 更新可用动作
   * @param actions 动作列表
   */
  updateActions(actions: ToolbarActionItem[]): void {
    this.actions = actions;
    
    // 如果已渲染，重新渲染按钮
    if (this.toolbarEl) {
      this.renderButtons();
    }
  }

  /**
   * 获取工具栏尺寸
   * @returns 工具栏宽度和高度
   */
  getSize(): { width: number; height: number } {
    if (!this.toolbarEl) {
      // 估算默认尺寸：每个按钮 28px + 间距 4px + 内边距 16px
      const buttonCount = this.actions.length || 4;
      return {
        width: buttonCount * 28 + (buttonCount - 1) * 4 + 16,
        height: 36, // 28px 按钮 + 8px 内边距
      };
    }
    
    // 临时显示以获取真实尺寸
    const wasHidden = !this.isVisible;
    if (wasHidden) {
      this.toolbarEl.style.visibility = 'hidden';
      this.toolbarEl.classList.add('visible');
    }
    
    const rect = this.toolbarEl.getBoundingClientRect();
    
    if (wasHidden) {
      this.toolbarEl.classList.remove('visible');
      this.toolbarEl.style.visibility = '';
    }
    
    return {
      width: rect.width,
      height: rect.height,
    };
  }

  /**
   * 检查元素是否在工具栏内
   * @param element 要检查的元素
   */
  containsElement(element: HTMLElement | null): boolean {
    if (!this.toolbarEl || !element) return false;
    return this.toolbarEl.contains(element);
  }

  /**
   * 销毁视图
   */
  destroy(): void {
    this.clearHideTimeout();
    this.closeActiveSubmenu();
    this.removeDocumentClickHandler();
    
    // 移除拖拽事件监听
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);
    this.isDragging = false;
    
    if (this.toolbarEl) {
      this.toolbarEl.remove();
      this.toolbarEl = null;
    }
    
    this.containerEl = null;
    this.currentContext = null;
    this.isVisible = false;
  }

  /**
   * 渲染按钮
   */
  private renderButtons(): void {
    if (!this.toolbarEl) return;
    
    // 清空现有内容
    this.toolbarEl.empty();
    
    // 关闭任何打开的子菜单
    this.closeActiveSubmenu();
    
    // 首先渲染拖拽手柄
    const dragHandle = this.createDragHandle();
    this.toolbarEl.appendChild(dragHandle);
    
    // 渲染每个动作按钮
    this.actions.forEach((action) => {
      if (isSubmenuAction(action)) {
        // 渲染带子菜单的按钮
        const wrapper = this.renderSubmenuButton(action);
        this.toolbarEl!.appendChild(wrapper);
      } else {
        // 渲染普通按钮
        const button = this.createButton(action);
        this.toolbarEl!.appendChild(button);
      }
    });
  }

  /**
   * 创建拖拽手柄
   */
  private createDragHandle(): HTMLElement {
    const handle = document.createElement('div');
    handle.className = 'selection-toolbar-drag-handle';
    handle.setAttribute('aria-label', 'Drag to move toolbar');
    
    // 内联样式
    handle.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      align-self: stretch;
      cursor: grab;
      color: var(--text-faint);
      border-radius: 3px;
      flex-shrink: 0;
      margin: -4px 0;
      padding: 4px 0;
    `;
    
    // 创建拖拽图标（使用 grip-vertical 图标）
    setIcon(handle, 'grip-vertical');
    
    // 拖拽开始
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleDragStart(e);
    });
    
    return handle;
  }

  /**
   * 处理拖拽开始
   */
  private handleDragStart(e: MouseEvent): void {
    if (!this.toolbarEl) return;
    
    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    
    // 获取当前工具栏位置
    const rect = this.toolbarEl.getBoundingClientRect();
    this.toolbarStartX = rect.left;
    this.toolbarStartY = rect.top;
    
    // 更新手柄样式
    const handle = this.toolbarEl.querySelector('.selection-toolbar-drag-handle') as HTMLElement;
    if (handle) {
      handle.style.cursor = 'grabbing';
    }
    
    // 添加拖拽中的类
    this.toolbarEl.classList.add('dragging');
    
    // 添加全局事件监听
    document.addEventListener('mousemove', this.boundHandleMouseMove);
    document.addEventListener('mouseup', this.boundHandleMouseUp);
  }

  /**
   * 处理拖拽移动
   */
  private handleDragMove(e: MouseEvent): void {
    if (!this.isDragging || !this.toolbarEl) return;
    
    e.preventDefault();
    
    const deltaX = e.clientX - this.dragStartX;
    const deltaY = e.clientY - this.dragStartY;
    
    let newLeft = this.toolbarStartX + deltaX;
    let newTop = this.toolbarStartY + deltaY;
    
    // 边界限制
    const toolbarRect = this.toolbarEl.getBoundingClientRect();
    const minMargin = 8;
    
    if (newLeft < minMargin) newLeft = minMargin;
    if (newLeft + toolbarRect.width > window.innerWidth - minMargin) {
      newLeft = window.innerWidth - toolbarRect.width - minMargin;
    }
    if (newTop < minMargin) newTop = minMargin;
    if (newTop + toolbarRect.height > window.innerHeight - minMargin) {
      newTop = window.innerHeight - toolbarRect.height - minMargin;
    }
    
    this.toolbarEl.style.left = `${newLeft}px`;
    this.toolbarEl.style.top = `${newTop}px`;
  }

  /**
   * 处理拖拽结束
   */
  private handleDragEnd(): void {
    if (!this.isDragging) return;
    
    this.isDragging = false;
    
    document.removeEventListener('mousemove', this.boundHandleMouseMove);
    document.removeEventListener('mouseup', this.boundHandleMouseUp);
    
    if (this.toolbarEl) {
      this.toolbarEl.classList.remove('dragging');
      
      const handle = this.toolbarEl.querySelector('.selection-toolbar-drag-handle') as HTMLElement;
      if (handle) {
        handle.style.cursor = 'grab';
      }
    }
  }

  /**
   * 渲染带子菜单的按钮

   * @param action 子菜单动作配置
   */
  private renderSubmenuButton(action: SubmenuAction): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'selection-toolbar-submenu-wrapper';
    wrapper.setAttribute('data-action', action.id);
    
    const showLabel = action.showLabel !== false; // 默认显示标签
    
    // 创建主按钮（与普通按钮样式完全一致）
    const button = document.createElement('button');
    button.className = 'selection-toolbar-btn';
    button.setAttribute('data-action', action.id);
    
    // 内联样式（与 createButton 保持一致）
    button.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      gap: ${showLabel ? '4px' : '2px'};
      padding: ${showLabel ? '4px 8px' : '4px 6px'};
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
      outline: none;
      box-shadow: none;
      transition: all 100ms ease-in-out;
    `;
    
    // 悬浮效果（与 createButton 保持一致）
    button.addEventListener('mouseenter', () => {
      button.style.color = 'var(--text-normal)';
      button.style.background = 'var(--background-modifier-hover)';
    });
    
    button.addEventListener('mouseleave', () => {
      // 如果子菜单打开，保持高亮
      if (this.activeSubmenuWrapper !== wrapper) {
        button.style.color = 'var(--text-muted)';
        button.style.background = 'transparent';
      }
    });
    
    // 创建图标容器
    const iconSpan = document.createElement('span');
    iconSpan.className = 'selection-toolbar-btn-icon';
    setIcon(iconSpan, action.icon);
    button.appendChild(iconSpan);
    
    // 创建文字标签（仅当 showLabel 为 true 时）
    if (showLabel) {
      const labelSpan = document.createElement('span');
      labelSpan.className = 'selection-toolbar-btn-label';
      labelSpan.textContent = t(action.tooltipKey);
      button.appendChild(labelSpan);
    }
    
    // 创建下拉箭头（小尺寸，与文字对齐）
    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'selection-toolbar-submenu-arrow';
    arrowSpan.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      width: 12px;
      height: 12px;
      opacity: 0.7;
    `;
    setIcon(arrowSpan, 'chevron-down');
    button.appendChild(arrowSpan);
    
    // 设置 tooltip
    const tooltipText = t(action.tooltipKey);
    setTooltip(button, tooltipText);
    
    // 创建子菜单容器
    const submenu = document.createElement('div');
    submenu.className = 'selection-toolbar-submenu';
    submenu.style.display = 'none';
    
    // 渲染子菜单项
    action.submenu.forEach(subAction => {
      const subButton = this.createSubmenuItem(subAction);
      submenu.appendChild(subButton);
    });
    
    wrapper.appendChild(button);
    wrapper.appendChild(submenu);
    
    // 点击显示/隐藏子菜单
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleSubmenu(wrapper, submenu, button);
    });
    
    return wrapper;
  }

  /**
   * 创建子菜单项
   * @param action 子菜单项动作配置
   */
  private createSubmenuItem(action: ToolbarAction): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'selection-toolbar-submenu-item';
    button.setAttribute('data-action', action.id);
    
    const showLabel = action.showLabel !== false; // 默认显示标签
    
    // 内联样式（与工具栏按钮风格一致）
    button.style.cssText = `
      display: flex;
      align-items: center;
      gap: ${showLabel ? '6px' : '0'};
      padding: ${showLabel ? '4px 8px' : '4px 6px'};
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
      outline: none;
      box-shadow: none;
      transition: all 100ms ease-in-out;
    `;
    
    // 悬浮效果
    button.addEventListener('mouseenter', () => {
      button.style.color = 'var(--text-normal)';
      button.style.background = 'var(--background-modifier-hover)';
    });
    
    button.addEventListener('mouseleave', () => {
      button.style.color = 'var(--text-muted)';
      button.style.background = 'transparent';
    });
    
    // 创建图标容器（与工具栏按钮一致）
    const iconSpan = document.createElement('span');
    iconSpan.className = 'selection-toolbar-btn-icon';
    setIcon(iconSpan, action.icon);
    button.appendChild(iconSpan);
    
    // 创建文字标签（仅当 showLabel 为 true 时）
    if (showLabel) {
      const labelSpan = document.createElement('span');
      labelSpan.className = 'selection-toolbar-btn-label';
      labelSpan.textContent = t(action.tooltipKey);
      button.appendChild(labelSpan);
    }
    
    // 绑定点击事件
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!this.currentContext || button.disabled) return;
      
      try {
        // 关闭子菜单
        this.closeActiveSubmenu();
        
        const result = await this.onActionExecute(action, this.currentContext);
        
        // 根据结果决定是否隐藏工具栏
        if (result.shouldHide) {
          this.hideImmediately();
          return;
        }
        
        // 如果返回了新文本，更新 context 并刷新按钮状态
        if (typeof result.newText === 'string' && this.currentContext) {
          this.currentContext = {
            ...this.currentContext,
            text: result.newText
          };
          this.updateButtonStates(this.currentContext);
        }
      } catch (error) {
        console.error(`[ToolbarView] Submenu action ${action.id} failed:`, error);
      }
    });
    
    return button;
  }

  /**
   * 切换子菜单显示/隐藏
   * @param wrapper 子菜单包装器
   * @param submenu 子菜单元素
   * @param button 触发按钮
   */
  private toggleSubmenu(wrapper: HTMLElement, submenu: HTMLElement, button: HTMLButtonElement): void {
    const isCurrentlyOpen = this.activeSubmenu === submenu;
    
    // 先关闭当前打开的子菜单
    this.closeActiveSubmenu();
    
    if (!isCurrentlyOpen) {
      // 打开新子菜单
      submenu.style.display = 'block';
      this.activeSubmenu = submenu;
      this.activeSubmenuWrapper = wrapper;
      
      // 保持按钮高亮
      button.style.color = 'var(--text-normal)';
      button.style.background = 'var(--background-modifier-hover)';
      
      // 添加全局点击监听器以关闭子菜单
      this.setupDocumentClickHandler();
    }
  }

  /**
   * 关闭当前打开的子菜单
   */
  private closeActiveSubmenu(): void {
    if (this.activeSubmenu) {
      this.activeSubmenu.style.display = 'none';
      
      // 恢复按钮样式
      if (this.activeSubmenuWrapper) {
        const button = this.activeSubmenuWrapper.querySelector('.selection-toolbar-btn') as HTMLButtonElement;
        if (button) {
          button.style.color = 'var(--text-muted)';
          button.style.background = 'transparent';
        }
      }
      
      this.activeSubmenu = null;
      this.activeSubmenuWrapper = null;
    }
    
    // 移除全局点击监听器
    this.removeDocumentClickHandler();
  }

  /**
   * 设置全局点击监听器
   */
  private setupDocumentClickHandler(): void {
    this.removeDocumentClickHandler();
    
    this.documentClickHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // 如果点击在子菜单包装器外部，关闭子菜单
      if (this.activeSubmenuWrapper && !this.activeSubmenuWrapper.contains(target)) {
        this.closeActiveSubmenu();
      }
    };
    
    // 使用 setTimeout 延迟添加，避免立即触发
    setTimeout(() => {
      if (this.documentClickHandler) {
        document.addEventListener('click', this.documentClickHandler, true);
      }
    }, 0);
  }

  /**
   * 移除全局点击监听器
   */
  private removeDocumentClickHandler(): void {
    if (this.documentClickHandler) {
      document.removeEventListener('click', this.documentClickHandler, true);
      this.documentClickHandler = null;
    }
  }

  /**
   * 创建按钮元素
   * @param action 动作配置
   */
  private createButton(action: ToolbarAction): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'selection-toolbar-btn';
    button.setAttribute('data-action', action.id);
    
    const showLabel = action.showLabel !== false; // 默认显示标签
    
    // 内联样式确保扁平化效果（覆盖 Obsidian 默认按钮样式）
    button.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      gap: ${showLabel ? '4px' : '0'};
      padding: ${showLabel ? '4px 8px' : '4px 6px'};
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
      outline: none;
      box-shadow: none;
      transition: all 100ms ease-in-out;
    `;
    
    // 悬浮效果
    button.addEventListener('mouseenter', () => {
      button.style.color = 'var(--text-normal)';
      button.style.background = 'var(--background-modifier-hover)';
      button.style.border = '0px solid var(--background-modifier-border)';
    });
    
    button.addEventListener('mouseleave', () => {
      button.style.color = 'var(--text-muted)';
      button.style.background = 'transparent';
      button.style.border = 'none';
    });
    
    // 创建图标容器
    const iconSpan = document.createElement('span');
    iconSpan.className = 'selection-toolbar-btn-icon';
    setIcon(iconSpan, action.icon);
    button.appendChild(iconSpan);
    
    // 创建文字标签（仅当 showLabel 为 true 时）
    if (showLabel) {
      const labelSpan = document.createElement('span');
      labelSpan.className = 'selection-toolbar-btn-label';
      labelSpan.textContent = t(action.tooltipKey);
      button.appendChild(labelSpan);
    }
    
    // 设置 tooltip（使用 Obsidian 原生 tooltip）
    const tooltipText = t(action.tooltipKey);
    setTooltip(button, tooltipText);
    
    // 绑定点击事件
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!this.currentContext || button.disabled) return;
      
      try {
        const result = await this.onActionExecute(action, this.currentContext);
        
        // 根据结果决定是否隐藏工具栏
        if (result.shouldHide) {
          this.hideImmediately();
          return;
        }
        
        // 如果返回了新文本，更新 context 并刷新按钮状态
        if (typeof result.newText === 'string' && this.currentContext) {
          this.currentContext = {
            ...this.currentContext,
            text: result.newText
          };
          this.updateButtonStates(this.currentContext);
        }
      } catch (error) {
        console.error(`[ToolbarView] Action ${action.id} failed:`, error);
      }
    });
    
    return button;
  }

  /**
   * 清除隐藏定时器
   */
  private clearHideTimeout(): void {
    if (this.hideTimeoutId !== null) {
      window.clearTimeout(this.hideTimeoutId);
      this.hideTimeoutId = null;
    }
  }

  /**
   * 更新按钮禁用状态
   * @param context 选择上下文
   */
  private updateButtonStates(context: SelectionContext): void {
    if (!this.toolbarEl) return;
    
    this.actions.forEach((action) => {
      const button = this.toolbarEl!.querySelector(`[data-action="${action.id}"]`) as HTMLButtonElement;
      if (!button) return;
      
      const isDisabled = action.isDisabled?.(context) ?? false;
      button.disabled = isDisabled;
      
      // 更新禁用状态的样式
      if (isDisabled) {
        button.style.opacity = '0.4';
        button.style.cursor = 'not-allowed';
      } else {
        button.style.opacity = '1';
        button.style.cursor = 'pointer';
      }
    });
  }
}
