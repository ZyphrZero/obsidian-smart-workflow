/**
 * ToolbarView - 工具栏视图组件
 * 负责工具栏的 DOM 渲染和交互
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { setIcon, setTooltip } from 'obsidian';
import { 
  ToolbarAction, 
  ToolbarPosition, 
  SelectionContext,
  ANIMATION_CONSTANTS 
} from './types';
import { t } from '../../i18n';

/**
 * 工具栏动作执行回调
 */
export type ActionCallback = (action: ToolbarAction, context: SelectionContext) => Promise<string | void>;

/**
 * 工具栏视图类
 * 管理工具栏的 DOM 结构、显示/隐藏和用户交互
 */
export class ToolbarView {
  private containerEl: HTMLElement | null = null;
  private toolbarEl: HTMLElement | null = null;
  private actions: ToolbarAction[] = [];
  private currentContext: SelectionContext | null = null;
  private isVisible: boolean = false;
  private hideTimeoutId: number | null = null;
  
  /** 动作执行回调 */
  onActionExecute: ActionCallback = async () => {};

  constructor() {
    // 初始化时不创建 DOM，等待 render() 调用
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
   * Requirements: 2.4 - 淡入动画 150ms
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
   * Requirements: 2.5 - 淡出动画 100ms
   */
  hide(): void {
    if (!this.toolbarEl || !this.isVisible) return;
    
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
  updateActions(actions: ToolbarAction[]): void {
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
    
    // 渲染每个动作按钮
    this.actions.forEach((action) => {
      const button = this.createButton(action);
      this.toolbarEl!.appendChild(button);
    });
  }

  /**
   * 创建按钮元素
   * @param action 动作配置
   */
  private createButton(action: ToolbarAction): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'selection-toolbar-btn';
    button.setAttribute('data-action', action.id);
    
    // 内联样式确保扁平化效果（覆盖 Obsidian 默认按钮样式）
    button.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 4px 8px;
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
    
    // 创建文字标签
    const labelSpan = document.createElement('span');
    labelSpan.className = 'selection-toolbar-btn-label';
    labelSpan.textContent = t(action.tooltipKey);
    button.appendChild(labelSpan);
    
    // 设置 tooltip（使用 Obsidian 原生 tooltip）
    const tooltipText = t(action.tooltipKey);
    setTooltip(button, tooltipText);
    
    // 绑定点击事件
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!this.currentContext || button.disabled) return;
      
      try {
        const newText = await this.onActionExecute(action, this.currentContext);
        
        // 如果返回了新文本，更新 context 并刷新按钮状态
        if (typeof newText === 'string' && this.currentContext) {
          this.currentContext = {
            ...this.currentContext,
            text: newText
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
