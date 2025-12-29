/**
 * WritingActionExecutor - 写作动作执行器
 * 协调写作动作的执行流程，管理 WritingService 和 InlineResultView
 * 

 */

import { App, MarkdownView, Editor } from 'obsidian';
import { SmartWorkflowSettings } from '../../settings/settings';
import { WritingService } from '../../services/writing/writingService';
import { InlineResultView } from './inlineResultView';
import { debugLog } from '../../utils/logger';
import { NoticeHelper } from '../noticeHelper';
import { t } from '../../i18n';

/**
 * 写作动作上下文
 * 包含执行写作动作所需的所有信息
 */
export interface WritingActionContext {
  /** 选中的文本 */
  text: string;
  /** 选区范围 */
  range: Range;
  /** Obsidian Editor 实例 */
  editor: Editor;
  /** MarkdownView 实例 */
  view: MarkdownView;
  /** 选区在编辑器中的起始位置 */
  from: { line: number; ch: number };
  /** 选区在编辑器中的结束位置 */
  to: { line: number; ch: number };
}

/**
 * 写作动作执行器类
 * 负责协调润色等写作动作的执行流程
 */
export class WritingActionExecutor {
  private app: App;
  private settings: SmartWorkflowSettings;
  private writingService: WritingService;
  private onSettingsChange?: () => Promise<void>;
  
  // 当前活动的视图和上下文
  private currentView: InlineResultView | null = null;
  private currentContext: WritingActionContext | null = null;
  private originalText: string = '';
  
  // 键盘事件处理器
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    app: App,
    settings: SmartWorkflowSettings,
    onSettingsChange?: () => Promise<void>
  ) {
    this.app = app;
    this.settings = settings;
    this.onSettingsChange = onSettingsChange;
    this.writingService = new WritingService(app, settings, onSettingsChange);
  }

  // ============================================================================
  // 公共 API
  // ============================================================================

  /**
   * 执行润色动作

   * @param context 写作动作上下文
   */
  async executePolish(context: WritingActionContext): Promise<void> {
    debugLog('[WritingActionExecutor] 开始执行润色动作');
    
    // 保存上下文和原文
    this.currentContext = context;
    this.originalText = context.text;
    
    // 获取编辑器容器元素
    const containerEl = this.getEditorContainer(context.view);
    if (!containerEl) {
      NoticeHelper.error(t('writing.errors.invalidResponse'));
      return;
    }
    
    // 创建内联结果视图
    this.createInlineResultView(containerEl);
    
    // 设置键盘快捷键
    this.setupKeyboardHandlers();
    
    // 发起流式请求
    await this.writingService.polishStream(context.text, {
      onStart: () => {
        debugLog('[WritingActionExecutor] 流式请求开始');
      },
      onChunk: (chunk: string) => {
        this.currentView?.appendContent(chunk);
      },
      onThinking: (chunk: string) => {
        debugLog('[WritingActionExecutor] 收到思考内容:', chunk.substring(0, 50) + '...');
        this.currentView?.appendThinking(chunk);
      },
      onComplete: (fullText: string) => {
        debugLog('[WritingActionExecutor] 流式请求完成，总长度:', fullText.length);
        this.currentView?.setComplete();
      },
      onError: (error: Error) => {
        debugLog('[WritingActionExecutor] 流式请求错误:', error.message);
        this.currentView?.setError(error.message);
      }
    });
  }

  /**
   * 取消当前操作

   */
  cancel(): void {
    debugLog('[WritingActionExecutor] 取消当前操作');
    
    // 取消流式请求
    this.writingService.cancelRequest();
    
    // 清理视图和事件
    this.cleanup();
  }

  /**
   * 更新设置
   */
  updateSettings(settings: SmartWorkflowSettings): void {
    this.settings = settings;
    this.writingService = new WritingService(this.app, settings, this.onSettingsChange);
  }

  /**
   * 检查是否有活动的写作操作
   */
  isActive(): boolean {
    return this.currentView !== null;
  }

  // ============================================================================
  // 私有方法 - 视图管理
  // ============================================================================

  /**
   * 创建内联结果视图
   */
  private createInlineResultView(containerEl: HTMLElement): void {
    // 如果已有视图，先清理
    if (this.currentView) {
      this.currentView.destroy();
    }
    
    // 创建视图容器
    const viewContainer = this.createViewContainer(containerEl);
    
    // 创建内联结果视图
    this.currentView = new InlineResultView({
      containerEl: viewContainer,
      originalText: this.originalText,
      onAccept: (text: string) => this.handleAccept(text),
      onReject: () => this.handleReject(),
      onMerge: (text: string) => this.handleMerge(text),
      onEdit: () => this.handleEditStart(),
      onRetry: () => this.handleRetry()
    });
    
    // 渲染视图
    this.currentView.render();
  }

  /**
   * 创建视图容器并定位
   * 使用绝对定位将视图显示在选区下方
   */
  private createViewContainer(editorContainer: HTMLElement): HTMLElement {
    const container = document.createElement('div');
    container.className = 'writing-action-container';
    
    // 获取选区的屏幕坐标
    const coords = this.getSelectionCoords();
    if (coords) {
      // 获取编辑器容器的位置
      const containerRect = editorContainer.getBoundingClientRect();
      
      // 计算相对于编辑器容器的位置
      const left = Math.max(0, coords.left - containerRect.left);
      const top = coords.bottom - containerRect.top + 8; // 选区下方 8px
      
      container.style.position = 'absolute';
      container.style.left = `${left}px`;
      container.style.top = `${top}px`;
      container.style.zIndex = '100';
      container.style.width = `calc(100% - ${left}px - 16px)`; // 留出右边距
      container.style.maxWidth = '800px';
    }
    
    // 确保编辑器容器有相对定位
    const computedStyle = window.getComputedStyle(editorContainer);
    if (computedStyle.position === 'static') {
      editorContainer.style.position = 'relative';
    }
    
    editorContainer.appendChild(container);
    return container;
  }

  /**
   * 获取选区坐标
   */
  private getSelectionCoords(): { left: number; top: number; bottom: number } | null {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        bottom: rect.bottom
      };
    }
    return null;
  }

  /**
   * 获取编辑器容器元素
   */
  private getEditorContainer(view: MarkdownView): HTMLElement | null {
    // 获取编辑器的内容容器
    const contentEl = view.contentEl;
    const editorEl = contentEl.querySelector('.cm-editor') as HTMLElement;
    return editorEl?.parentElement || contentEl;
  }

  // ============================================================================
  // 私有方法 - 文档操作
  // ============================================================================

  /**
   * 处理接受操作

   * @param newText 新文本（可能被用户编辑过）
   */
  private handleAccept(newText: string): void {
    debugLog('[WritingActionExecutor] 处理接受操作');
    
    if (!this.currentContext) {
      debugLog('[WritingActionExecutor] 无上下文，无法执行接受操作');
      return;
    }
    
    const { editor, from, to } = this.currentContext;
    
    // 替换选区文本
    editor.replaceRange(newText, from, to);
    
    // 清理
    this.cleanup();
    
    debugLog('[WritingActionExecutor] 接受操作完成');
  }

  /**
   * 处理保留原文操作

   */
  private handleReject(): void {
    debugLog('[WritingActionExecutor] 处理保留原文操作');
    
    // 取消流式请求（如果还在进行中）
    this.writingService.cancelRequest();
    
    // 清理，不修改文档
    this.cleanup();
    
    debugLog('[WritingActionExecutor] 保留原文操作完成');
  }

  /**
   * 处理合并操作

   * @param newText 新文本
   */
  private handleMerge(newText: string): void {
    debugLog('[WritingActionExecutor] 处理合并操作');
    
    if (!this.currentContext) {
      debugLog('[WritingActionExecutor] 无上下文，无法执行合并操作');
      return;
    }
    
    const { editor, to } = this.currentContext;
    
    // 在原文后追加新内容（换行分隔）
    const mergedText = this.originalText + '\n\n' + newText;
    editor.replaceRange(mergedText, this.currentContext.from, to);
    
    // 清理
    this.cleanup();
    
    debugLog('[WritingActionExecutor] 合并操作完成');
  }

  /**
   * 处理用户开始编辑

   */
  private handleEditStart(): void {
    debugLog('[WritingActionExecutor] 用户开始编辑，取消流式请求');
    
    // 取消流式请求
    this.writingService.cancelRequest();
  }

  /**
   * 处理重试操作
   */
  private handleRetry(): void {
    debugLog('[WritingActionExecutor] 处理重试操作');
    
    if (!this.currentContext) {
      debugLog('[WritingActionExecutor] 无上下文，无法重试');
      return;
    }
    
    // 重新发起请求
    this.writingService.polishStream(this.originalText, {
      onStart: () => {
        debugLog('[WritingActionExecutor] 重试：流式请求开始');
      },
      onChunk: (chunk: string) => {
        this.currentView?.appendContent(chunk);
      },
      onThinking: (chunk: string) => {
        debugLog('[WritingActionExecutor] 重试：收到思考内容');
        this.currentView?.appendThinking(chunk);
      },
      onComplete: (fullText: string) => {
        debugLog('[WritingActionExecutor] 重试：流式请求完成，总长度:', fullText.length);
        this.currentView?.setComplete();
      },
      onError: (error: Error) => {
        debugLog('[WritingActionExecutor] 重试：流式请求错误:', error.message);
        this.currentView?.setError(error.message);
      }
    });
  }

  // ============================================================================
  // 私有方法 - 键盘快捷键
  // ============================================================================

  /**
   * 设置键盘快捷键处理

   */
  private setupKeyboardHandlers(): void {
    // 移除旧的处理器
    this.removeKeyboardHandlers();
    
    this.keydownHandler = (e: KeyboardEvent) => {
      // 如果没有活动视图，不处理
      if (!this.currentView) return;
      
      const status = this.currentView.getStatus();
      
      // 编辑模式下不拦截快捷键（除了 Escape）

      if (status === 'editing') {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.handleReject();
        }
        return;
      }
      
      // 错误状态下只响应 Escape
      if (status === 'error') {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.handleReject();
        }
        return;
      }
      
      // 加载状态下只响应 Escape 取消
      if (status === 'loading') {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.handleReject();
        }
        return;
      }
      
      // 流式/完成状态下的快捷键
      if (status === 'streaming' || status === 'complete') {
        // Enter 或 Ctrl+Enter 接受

        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const content = this.currentView.getContent();
          if (content) {
            this.handleAccept(content);
          }
          return;
        }
        
        // Escape 保留原文

        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.handleReject();
          return;
        }
        
        // Ctrl+M 合并

        if (e.ctrlKey && e.key === 'm') {
          e.preventDefault();
          e.stopPropagation();
          const content = this.currentView.getContent();
          if (content) {
            this.handleMerge(content);
          }
          return;
        }
      }
    };
    
    // 使用 capture 模式确保优先处理
    document.addEventListener('keydown', this.keydownHandler, true);
  }

  /**
   * 移除键盘快捷键处理器
   */
  private removeKeyboardHandlers(): void {
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
  }

  // ============================================================================
  // 私有方法 - 清理
  // ============================================================================

  /**
   * 清理所有资源
   */
  private cleanup(): void {
    debugLog('[WritingActionExecutor] 清理资源');
    
    // 移除键盘处理器
    this.removeKeyboardHandlers();
    
    // 销毁视图
    if (this.currentView) {
      this.currentView.destroy();
      this.currentView = null;
    }
    
    // 移除视图容器
    const containers = document.querySelectorAll('.writing-action-container');
    containers.forEach(container => container.remove());
    
    // 清理上下文
    this.currentContext = null;
    this.originalText = '';
    
    debugLog('[WritingActionExecutor] 清理完成');
  }
}
