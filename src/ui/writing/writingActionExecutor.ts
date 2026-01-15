/**
 * WritingActionExecutor - 写作动作执行器
 * 协调写作动作的执行流程，使用独立的 WritingApplyView 显示 diff
 */

import type { App, MarkdownView, Editor } from 'obsidian';
import type { SmartWorkflowSettings } from '../../settings/settings';
import { WritingService } from '../../services/writing/writingService';
import type { WritingApplyViewState } from './writingApplyView';
import { WritingApplyView, WRITING_APPLY_VIEW_TYPE } from './writingApplyView';
import { debugLog } from '../../utils/logger';
import type { SelectionRange } from '../selection/types';
import type { ServerManager } from '../../services/server/serverManager';
import type { ISecretService } from '../../services/secret';

/**
 * 写作动作上下文
 */
export interface WritingActionContext {
  /** 选中的文本（所有选区合并） */
  text: string;
  /** 选区范围 */
  range: Range;
  /** Obsidian Editor 实例 */
  editor: Editor;
  /** MarkdownView 实例 */
  view: MarkdownView;
  /** 选区起始位置（单选区时使用） */
  from: { line: number; ch: number };
  /** 选区结束位置（单选区时使用） */
  to: { line: number; ch: number };
  /** 多选区信息 */
  selections?: SelectionRange[];
  /** 是否为多选区 */
  isMultiSelection?: boolean;
}

/**
 * 写作动作执行器类
 */
export class WritingActionExecutor {
  private app: App;
  private settings: SmartWorkflowSettings;
  private writingService: WritingService;
  private onSettingsChange?: () => Promise<void>;
  private serverManager: ServerManager | null = null;
  private secretService: ISecretService | null = null;
  
  // 当前活动的视图
  private currentView: WritingApplyView | null = null;
  private currentContext: WritingActionContext | null = null;
  private originalText: string = '';

  constructor(
    app: App,
    settings: SmartWorkflowSettings,
    onSettingsChange?: () => Promise<void>,
    serverManager?: ServerManager,
    secretService?: ISecretService
  ) {
    this.app = app;
    this.settings = settings;
    this.onSettingsChange = onSettingsChange;
    this.serverManager = serverManager ?? null;
    this.secretService = secretService ?? null;
    this.writingService = new WritingService(app, settings, onSettingsChange, serverManager, secretService);
  }

  /**
   * 设置 ServerManager
   * 用于启用 Rust 模式的流式处理
   */
  setServerManager(serverManager: ServerManager): void {
    this.serverManager = serverManager;
    this.writingService.setServerManager(serverManager);
  }

  // ============================================================================
  // 公共 API
  // ============================================================================

  /**
   * 执行润色动作
   */
  async executePolish(context: WritingActionContext): Promise<void> {
    debugLog('[WritingActionExecutor] 开始执行润色动作');
    
    this.currentContext = context;
    this.originalText = context.text;
    
    // 打开 WritingApplyView
    await this.openApplyView(context);
    
    // 发起流式请求
    await this.writingService.polishStream(context.text, {
      onStart: () => {
        debugLog('[WritingActionExecutor] 流式请求开始');
      },
      onChunk: (chunk: string) => {
        this.currentView?.appendContent(chunk);
      },
      onThinking: (chunk: string) => {
        debugLog('[WritingActionExecutor] 收到思考内容');
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
    this.writingService.cancelRequest();
    this.cleanup();
  }

  /**
   * 更新设置
   */
  updateSettings(settings: SmartWorkflowSettings): void {
    this.settings = settings;
    this.writingService = new WritingService(this.app, settings, this.onSettingsChange, this.serverManager ?? undefined, this.secretService ?? undefined);
  }

  /**
   * 检查是否有活动的写作操作
   */
  isActive(): boolean {
    return this.currentView !== null;
  }


  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 打开 WritingApplyView
   */
  private async openApplyView(context: WritingActionContext): Promise<void> {
    const filePath = context.view.file?.path || '';
    
    // 在右侧打开新的 leaf
    const leaf = this.app.workspace.getLeaf('split', 'vertical');
    await leaf.setViewState({
      type: WRITING_APPLY_VIEW_TYPE,
      active: true,
    });
    
    // 获取视图实例
    const view = leaf.view;
    if (view instanceof WritingApplyView) {
      this.currentView = view;
      
      // 设置状态
      const state: WritingApplyViewState = {
        originalText: this.originalText,
        newText: '',
        filePath: filePath,
        from: context.from,
        to: context.to,
        selections: context.selections,
        isMultiSelection: context.isMultiSelection,
      };
      
      this.currentView.setViewState(state);
    }
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    debugLog('[WritingActionExecutor] 清理资源');
    
    this.currentView = null;
    this.currentContext = null;
    this.originalText = '';
    
    debugLog('[WritingActionExecutor] 清理完成');
  }
}
