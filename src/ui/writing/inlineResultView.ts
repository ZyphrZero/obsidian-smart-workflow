/**
 * InlineResultView - 内联结果视图组件
 * 在编辑器中显示 AI 生成内容的 UI 组件（内联 diff 样式）
 * 

 */

import { t } from '../../i18n';

/**
 * 内联结果视图状态
 */
export type InlineResultViewStatus = 'loading' | 'streaming' | 'complete' | 'error' | 'editing';

/**
 * 内联结果视图配置选项
 */
export interface InlineResultViewOptions {
  /** 挂载容器 */
  containerEl: HTMLElement;
  /** 原始文本 */
  originalText: string;
  /** 接受操作回调 */
  onAccept: (text: string) => void;
  /** 保留原文回调 */
  onReject: () => void;
  /** 合并操作回调 */
  onMerge: (text: string) => void;
  /** 用户开始编辑时回调 */
  onEdit: () => void;
  /** 重试操作回调 */
  onRetry?: () => void;
}

/**
 * 内联结果视图状态
 */
export interface InlineResultViewState {
  /** 当前状态 */
  status: InlineResultViewStatus;
  /** 内容 */
  content: string;
  /** 思考内容 */
  thinkingContent: string;
  /** 错误信息 */
  error?: string;
}

/**
 * 内联结果视图类
 * 管理 AI 生成内容的显示、编辑和操作（内联 diff 样式）
 */
export class InlineResultView {
  private options: InlineResultViewOptions;
  private state: InlineResultViewState;
  
  // DOM 元素
  private rootEl: HTMLElement | null = null;
  private toolbarEl: HTMLElement | null = null;
  private diffContainerEl: HTMLElement | null = null;
  private thinkingEl: HTMLElement | null = null;
  private thinkingContentEl: HTMLElement | null = null;
  private originalEl: HTMLElement | null = null;
  private resultEl: HTMLElement | null = null;
  private loadingEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;
  
  // 事件监听器引用（用于清理）
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private inputHandler: (() => void) | null = null;

  constructor(options: InlineResultViewOptions) {
    this.options = options;
    this.state = {
      status: 'loading',
      content: '',
      thinkingContent: '',
    };
  }

  // ============================================================================
  // 公共 API
  // ============================================================================

  /**
   * 渲染视图

   */
  render(): void {
    // 创建根元素
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'writing-inline-diff';
    this.rootEl.setAttribute('role', 'dialog');
    this.rootEl.setAttribute('aria-label', t('writing.status.loading'));

    // 创建顶部工具栏
    this.toolbarEl = this.createToolbarElement();
    this.rootEl.appendChild(this.toolbarEl);

    // 创建 diff 容器
    this.diffContainerEl = document.createElement('div');
    this.diffContainerEl.className = 'writing-diff-container';

    // 创建加载指示器
    this.loadingEl = this.createLoadingElement();
    this.diffContainerEl.appendChild(this.loadingEl);
    
    // 创建思考内容区域（可折叠）
    this.thinkingEl = this.createThinkingElement();
    this.thinkingEl.style.display = 'none';
    this.diffContainerEl.appendChild(this.thinkingEl);

    // 创建原文区域（红色删除样式）
    this.originalEl = this.createOriginalElement();
    this.originalEl.style.display = 'none';
    this.diffContainerEl.appendChild(this.originalEl);

    // 创建结果区域（绿色新增样式）
    this.resultEl = this.createResultElement();
    this.resultEl.style.display = 'none';
    this.diffContainerEl.appendChild(this.resultEl);

    // 创建错误区域
    this.errorEl = this.createErrorElement();
    this.errorEl.style.display = 'none';
    this.diffContainerEl.appendChild(this.errorEl);

    this.rootEl.appendChild(this.diffContainerEl);

    // 设置键盘事件监听
    this.setupKeyboardHandlers();

    // 添加到容器
    this.options.containerEl.appendChild(this.rootEl);

    // 更新显示状态
    this.updateDisplay();
  }

  /**
   * 追加流式内容

   * @param chunk 新内容块
   */
  appendContent(chunk: string): void {
    this.state.content += chunk;
    
    // 如果还在加载状态，切换到流式状态
    if (this.state.status === 'loading') {
      this.state.status = 'streaming';
      this.updateDisplay();
    }

    // 更新内容显示
    if (this.resultEl) {
      this.resultEl.textContent = this.state.content;
      // 滚动到底部
      this.resultEl.scrollTop = this.resultEl.scrollHeight;
    }
  }
  
  /**
   * 追加思考内容
   * @param chunk 思考内容块
   */
  appendThinking(chunk: string): void {
    this.state.thinkingContent += chunk;
    
    // 显示思考区域
    if (this.thinkingEl) {
      this.thinkingEl.style.display = 'block';
    }
    
    // 更新思考内容显示
    if (this.thinkingContentEl) {
      this.thinkingContentEl.textContent = this.state.thinkingContent;
      // 滚动到底部
      this.thinkingContentEl.scrollTop = this.thinkingContentEl.scrollHeight;
    }
  }

  /**
   * 设置完成状态

   */
  setComplete(): void {
    this.state.status = 'complete';
    this.updateDisplay();
  }

  /**
   * 设置错误状态

   * @param message 错误信息
   */
  setError(message: string): void {
    this.state.status = 'error';
    this.state.error = message;
    this.updateDisplay();
  }

  /**
   * 获取当前内容（可能被用户编辑过）

   * @returns 当前内容
   */
  getContent(): string {
    if (this.resultEl) {
      return this.resultEl.textContent || '';
    }
    return this.state.content;
  }

  /**
   * 获取当前状态
   */
  getStatus(): InlineResultViewStatus {
    return this.state.status;
  }

  /**
   * 聚焦编辑区域
   */
  focus(): void {
    if (this.resultEl && this.state.status !== 'loading' && this.state.status !== 'error') {
      this.resultEl.focus();
    }
  }

  /**
   * 销毁视图

   */
  destroy(): void {
    // 移除键盘事件监听
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }

    // 移除输入事件监听
    if (this.resultEl && this.inputHandler) {
      this.resultEl.removeEventListener('input', this.inputHandler);
      this.inputHandler = null;
    }

    // 移除 DOM 元素
    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }

    // 清理引用
    this.toolbarEl = null;
    this.diffContainerEl = null;
    this.thinkingEl = null;
    this.thinkingContentEl = null;
    this.originalEl = null;
    this.resultEl = null;
    this.loadingEl = null;
    this.errorEl = null;
  }

  // ============================================================================
  // 私有方法 - DOM 创建
  // ============================================================================

  /**
   * 创建顶部工具栏

   */
  private createToolbarElement(): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'writing-diff-toolbar';

    // 左侧状态信息
    const statusEl = document.createElement('div');
    statusEl.className = 'writing-diff-status';
    toolbar.appendChild(statusEl);

    // 右侧操作按钮
    const actionsEl = document.createElement('div');
    actionsEl.className = 'writing-diff-actions';

    // 接受按钮
    const acceptBtn = this.createButton(
      'writing-btn-accept',
      t('writing.actions.accept'),
      t('writing.shortcuts.acceptHint'),
      () => this.handleAccept()
    );
    actionsEl.appendChild(acceptBtn);

    // 保留原文按钮
    const rejectBtn = this.createButton(
      'writing-btn-reject',
      t('writing.actions.reject'),
      t('writing.shortcuts.rejectHint'),
      () => this.handleReject()
    );
    actionsEl.appendChild(rejectBtn);

    // 合并按钮
    const mergeBtn = this.createButton(
      'writing-btn-merge',
      t('writing.actions.merge'),
      t('writing.shortcuts.mergeHint'),
      () => this.handleMerge()
    );
    actionsEl.appendChild(mergeBtn);

    toolbar.appendChild(actionsEl);

    return toolbar;
  }

  /**
   * 创建加载指示器元素

   */
  private createLoadingElement(): HTMLElement {
    const loading = document.createElement('div');
    loading.className = 'writing-diff-loading';

    const spinner = document.createElement('div');
    spinner.className = 'writing-spinner';
    loading.appendChild(spinner);

    const text = document.createElement('span');
    text.textContent = t('writing.status.loading');
    loading.appendChild(text);

    return loading;
  }
  
  /**
   * 创建思考内容区域元素（可折叠）
   */
  private createThinkingElement(): HTMLElement {
    const thinking = document.createElement('div');
    thinking.className = 'writing-diff-thinking';
    
    // 创建折叠头部
    const header = document.createElement('div');
    header.className = 'writing-diff-thinking-header';
    
    // 折叠图标
    const chevron = document.createElement('span');
    chevron.className = 'writing-diff-thinking-chevron';
    chevron.innerHTML = '▶';
    header.appendChild(chevron);
    
    // 标题
    const title = document.createElement('span');
    title.className = 'writing-diff-thinking-title';
    title.textContent = t('writing.thinking.title');
    header.appendChild(title);
    
    // 思考内容容器
    this.thinkingContentEl = document.createElement('div');
    this.thinkingContentEl.className = 'writing-diff-thinking-content';
    this.thinkingContentEl.style.display = 'none'; // 默认折叠
    
    // 点击头部切换折叠状态
    header.addEventListener('click', () => {
      const isExpanded = this.thinkingContentEl!.style.display !== 'none';
      this.thinkingContentEl!.style.display = isExpanded ? 'none' : 'block';
      chevron.innerHTML = isExpanded ? '▶' : '▼';
      chevron.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(0deg)';
    });
    
    thinking.appendChild(header);
    thinking.appendChild(this.thinkingContentEl);
    
    return thinking;
  }

  /**
   * 创建原文区域元素（红色删除样式）

   */
  private createOriginalElement(): HTMLElement {
    const original = document.createElement('div');
    original.className = 'writing-diff-original';
    original.textContent = this.options.originalText;
    return original;
  }

  /**
   * 创建结果区域元素（绿色新增样式）

   */
  private createResultElement(): HTMLElement {
    const result = document.createElement('div');
    result.className = 'writing-diff-result';
    result.setAttribute('contenteditable', 'true');
    result.setAttribute('spellcheck', 'false');
    result.setAttribute('role', 'textbox');
    result.setAttribute('aria-multiline', 'true');
    result.setAttribute('aria-label', t('writing.status.streaming'));

    // 监听输入事件，切换到编辑状态
    this.inputHandler = () => {
      if (this.state.status === 'streaming') {
        // 用户开始编辑，通知外部取消流式传输
        this.options.onEdit();
      }
      if (this.state.status !== 'editing') {
        this.state.status = 'editing';
        this.updateDisplay();
      }
    };
    result.addEventListener('input', this.inputHandler);

    return result;
  }

  /**
   * 创建错误区域元素

   */
  private createErrorElement(): HTMLElement {
    const error = document.createElement('div');
    error.className = 'writing-diff-error';
    return error;
  }

  /**
   * 创建按钮元素
   */
  private createButton(
    className: string,
    text: string,
    tooltip: string,
    onClick: () => void
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = className;
    button.textContent = text;
    button.title = tooltip;
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return button;
  }

  // ============================================================================
  // 私有方法 - 事件处理
  // ============================================================================

  /**
   * 设置键盘快捷键处理

   */
  private setupKeyboardHandlers(): void {
    this.keydownHandler = (e: KeyboardEvent) => {
      // 如果正在编辑内容区域，不拦截快捷键
      if (this.state.status === 'editing' && 
          document.activeElement === this.resultEl) {
        // 只处理 Escape 键退出编辑
        if (e.key === 'Escape') {
          e.preventDefault();
          this.handleReject();
        }
        return;
      }

      // 错误状态下只响应 Escape
      if (this.state.status === 'error') {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.handleReject();
        }
        return;
      }

      // 加载状态下只响应 Escape 取消
      if (this.state.status === 'loading') {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.handleReject();
        }
        return;
      }

      // 流式/完成状态下的快捷键
      if (this.state.status === 'streaming' || this.state.status === 'complete') {
        // Enter 或 Ctrl+Enter 接受
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handleAccept();
          return;
        }

        // Escape 保留原文
        if (e.key === 'Escape') {
          e.preventDefault();
          this.handleReject();
          return;
        }

        // Ctrl+M 合并
        if (e.ctrlKey && e.key === 'm') {
          e.preventDefault();
          this.handleMerge();
          return;
        }
      }
    };

    document.addEventListener('keydown', this.keydownHandler);
  }

  /**
   * 处理接受操作

   */
  private handleAccept(): void {
    const content = this.getContent();
    if (content) {
      this.options.onAccept(content);
    }
  }

  /**
   * 处理保留原文操作

   */
  private handleReject(): void {
    this.options.onReject();
  }

  /**
   * 处理合并操作

   */
  private handleMerge(): void {
    const content = this.getContent();
    if (content) {
      this.options.onMerge(content);
    }
  }

  /**
   * 处理重试操作

   */
  private handleRetry(): void {
    if (this.options.onRetry) {
      // 重置状态
      this.state.status = 'loading';
      this.state.content = '';
      this.state.error = undefined;
      this.updateDisplay();
      
      this.options.onRetry();
    }
  }

  // ============================================================================
  // 私有方法 - 显示更新
  // ============================================================================

  /**
   * 更新显示状态
   */
  private updateDisplay(): void {
    if (!this.rootEl) return;

    // 更新加载指示器
    if (this.loadingEl) {
      this.loadingEl.style.display = this.state.status === 'loading' ? 'flex' : 'none';
    }

    // 更新原文区域
    if (this.originalEl) {
      const showOriginal = this.state.status === 'streaming' || 
                           this.state.status === 'complete' || 
                           this.state.status === 'editing';
      this.originalEl.style.display = showOriginal ? 'block' : 'none';
    }

    // 更新结果区域
    if (this.resultEl) {
      const showResult = this.state.status === 'streaming' || 
                         this.state.status === 'complete' || 
                         this.state.status === 'editing';
      this.resultEl.style.display = showResult ? 'block' : 'none';
      
      // 流式状态添加动画类
      if (this.state.status === 'streaming') {
        this.resultEl.classList.add('streaming');
      } else {
        this.resultEl.classList.remove('streaming');
      }
    }

    // 更新错误区域
    if (this.errorEl) {
      if (this.state.status === 'error') {
        this.errorEl.style.display = 'block';
        this.errorEl.innerHTML = '';
        
        const errorText = document.createElement('span');
        errorText.textContent = this.state.error || t('writing.errors.invalidResponse');
        this.errorEl.appendChild(errorText);
        
        // 添加重试按钮
        if (this.options.onRetry) {
          const retryBtn = this.createButton(
            'writing-btn-retry',
            t('writing.actions.retry'),
            t('writing.actions.retryTooltip'),
            () => this.handleRetry()
          );
          this.errorEl.appendChild(retryBtn);
        }
      } else {
        this.errorEl.style.display = 'none';
      }
    }

    // 更新工具栏按钮状态
    this.updateToolbarDisplay();

    // 更新 ARIA 标签
    this.rootEl.setAttribute('aria-label', this.getAriaLabel());
  }

  /**
   * 更新工具栏显示
   */
  private updateToolbarDisplay(): void {
    if (!this.toolbarEl) return;

    // 更新状态文本
    const statusEl = this.toolbarEl.querySelector('.writing-diff-status');
    if (statusEl) {
      statusEl.textContent = this.getStatusText();
    }

    // 更新按钮状态
    const acceptBtn = this.toolbarEl.querySelector('.writing-btn-accept') as HTMLButtonElement;
    const mergeBtn = this.toolbarEl.querySelector('.writing-btn-merge') as HTMLButtonElement;

    if (acceptBtn) {
      acceptBtn.disabled = this.state.status === 'loading' || this.state.status === 'error';
    }
    if (mergeBtn) {
      mergeBtn.disabled = this.state.status === 'loading' || this.state.status === 'error';
    }
  }

  /**
   * 获取状态文本
   */
  private getStatusText(): string {
    switch (this.state.status) {
      case 'loading':
        return t('writing.status.loading');
      case 'streaming':
        return t('writing.status.streaming');
      case 'complete':
        return t('writing.status.complete');
      case 'error':
        return t('writing.status.error');
      case 'editing':
        return t('writing.status.editing');
      default:
        return '';
    }
  }

  /**
   * 获取 ARIA 标签
   */
  private getAriaLabel(): string {
    return this.getStatusText();
  }
}
