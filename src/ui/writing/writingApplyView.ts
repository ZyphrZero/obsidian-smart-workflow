/**
 * WritingApplyView - 写作结果应用视图
 * 使用独立的 Obsidian View 显示 diff 对比，支持块级决策
 */

import { ItemView, WorkspaceLeaf, MarkdownView, TFile, setTooltip, Editor } from 'obsidian';
import { t } from '../../i18n';
import { DiffEngine, DiffBlock, DiffResult, BlockDecision } from './diffEngine';
import { DecisionManager } from './decisionManager';
import { SelectionRange, MULTI_SELECTION_SEPARATOR } from '../selection/types';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';

// ============================================================================
// CodeMirror 6 选区高亮装饰器
// ============================================================================

/**
 * 高亮装饰效果
 */
const setHighlightEffect = StateEffect.define<{ from: number; to: number }[]>();
const clearHighlightEffect = StateEffect.define<null>();

/**
 * 高亮装饰样式
 */
const highlightMark = Decoration.mark({
  class: 'writing-apply-source-highlight',
});

/**
 * 高亮状态字段
 */
const highlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    // 处理文档变化，映射装饰位置
    decorations = decorations.map(tr.changes);
    
    for (const effect of tr.effects) {
      if (effect.is(setHighlightEffect)) {
        // 设置新的高亮
        const ranges = effect.value;
        if (ranges.length > 0) {
          const decos = ranges
            .filter(r => r.from < r.to) // 确保范围有效
            .map(r => highlightMark.range(r.from, r.to));
          decorations = Decoration.set(decos, true);
        } else {
          decorations = Decoration.none;
        }
      } else if (effect.is(clearHighlightEffect)) {
        // 清除高亮
        decorations = Decoration.none;
      }
    }
    return decorations;
  },
  provide: f => EditorView.decorations.from(f),
});

export const WRITING_APPLY_VIEW_TYPE = 'smart-workflow-writing-apply';

/**
 * 选区 Diff 组
 * 每个选区独立计算 diff，独立管理决策
 */
interface SelectionDiffGroup {
  /** 选区索引 */
  index: number;
  /** 原始文本 */
  originalText: string;
  /** 新文本 */
  newText: string;
  /** 选区在文档中的起始行号（1-indexed） */
  startLine: number;
  /** Diff 结果 */
  diffResult: DiffResult;
  /** 决策管理器 */
  decisionManager: DecisionManager;
}

/**
 * 视图状态
 */
export interface WritingApplyViewState {
  /** 原始文本 */
  originalText: string;
  /** 新文本（AI 生成，流式完成后设置） */
  newText: string;
  /** 文件路径 */
  filePath: string;
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
 * 流式状态
 */
export interface StreamState {
  /** 是否正在流式传输 */
  isStreaming: boolean;
  /** 累积的流式内容 */
  content: string;
  /** 思考内容 */
  thinking: string;
  /** 错误信息 */
  error?: string;
}

/**
 * 视图阶段
 */
type ViewPhase = 'streaming' | 'computing' | 'ready';

/**
 * 写作应用视图
 */
export class WritingApplyView extends ItemView {
  // 核心状态
  private state: WritingApplyViewState | null = null;
  private viewContentEl: HTMLElement | null = null;
  
  // Diff 引擎
  private diffEngine: DiffEngine;
  
  // 选区 Diff 组（多选区时每个选区一组）
  private selectionGroups: SelectionDiffGroup[] = [];
  
  // 原始带分隔符的内容（用于多选区应用）
  private rawNewContent: string = '';
  
  // 视图阶段
  private viewPhase: ViewPhase = 'streaming';
  
  // 流式状态
  private streamState: StreamState = {
    isStreaming: false,
    content: '',
    thinking: '',
  };
  
  // UI 元素引用
  private statusEl: HTMLElement | null = null;
  private progressEl: HTMLElement | null = null;
  private diffContainerEl: HTMLElement | null = null;
  private toolbarActionsEl: HTMLElement | null = null;
  
  // 键盘长按确认状态
  private keyHoldTimer: ReturnType<typeof setTimeout> | null = null;
  private keyHoldAction: (() => void) | null = null;
  private static readonly HOLD_DURATION = 1000; // 1 秒
  
  // 源编辑器高亮相关
  private sourceEditorView: EditorView | null = null;
  private highlightExtensionAdded: boolean = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.diffEngine = new DiffEngine();
  }

  getViewType(): string {
    return WRITING_APPLY_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t('writing.applyView.title');
  }

  getIcon(): string {
    return 'file-diff';
  }


  async onOpen(): Promise<void> {
    this.viewContentEl = this.containerEl.children[1] as HTMLElement;
    this.viewContentEl.empty();
    this.viewContentEl.addClass('writing-apply-view');
    
    // 注册键盘快捷键
    this.registerKeyboardShortcuts();
    
    if (this.state) {
      this.render();
    }
  }

  async onClose(): Promise<void> {
    // 清除源编辑器高亮
    this.clearSourceHighlight();
    
    this.viewContentEl?.empty();
    this.selectionGroups = [];
  }
  
  /**
   * 注册键盘快捷键
   * - Y: 接受新内容 (当前聚焦块)
   * - N: 保留原内容 (当前聚焦块)
   * - B: 合并两者 (当前聚焦块)
   * - Shift+Y: 接受全部
   * - Shift+N: 拒绝全部
   * - Shift+R: 重置
   * - 长按 Enter: 应用并关闭
   * - 长按 Escape: 关闭不应用
   */
  private registerKeyboardShortcuts(): void {
    // keydown 开始长按计时
    this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
      // 只在视图激活时响应
      if (!this.viewContentEl?.isShown()) return;
      
      // 检查是否在输入框中
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLInputElement || 
          activeElement instanceof HTMLTextAreaElement) {
        return;
      }
      
      // 避免重复触发（长按时会连续触发 keydown）
      if (evt.repeat) return;
      
      // 只在 ready 阶段响应快捷键
      if (this.viewPhase !== 'ready') return;
      
      // Shift+Y: 接受全部
      if (evt.key === 'Y' && evt.shiftKey) {
        evt.preventDefault();
        evt.stopPropagation();
        this.handleAcceptAllIncoming();
        return;
      }
      
      // Shift+N: 拒绝全部
      if (evt.key === 'N' && evt.shiftKey) {
        evt.preventDefault();
        evt.stopPropagation();
        this.handleRejectAll();
        return;
      }
      
      // Shift+R: 重置
      if (evt.key === 'R' && evt.shiftKey) {
        evt.preventDefault();
        evt.stopPropagation();
        this.handleReset();
        return;
      }
      
      // Y: 接受新内容 (当前聚焦块)
      if (evt.key === 'y' && !evt.shiftKey && !evt.ctrlKey && !evt.metaKey) {
        evt.preventDefault();
        evt.stopPropagation();
        this.handleBlockShortcut('incoming');
        return;
      }
      
      // N: 保留原内容 (当前聚焦块)
      if (evt.key === 'n' && !evt.shiftKey && !evt.ctrlKey && !evt.metaKey) {
        evt.preventDefault();
        evt.stopPropagation();
        this.handleBlockShortcut('current');
        return;
      }
      
      // B: 合并两者 (当前聚焦块)
      if (evt.key === 'b' && !evt.shiftKey && !evt.ctrlKey && !evt.metaKey) {
        evt.preventDefault();
        evt.stopPropagation();
        this.handleBlockShortcut('both');
        return;
      }
      
      // F4: 长按应用
      if (evt.key === 'F4') {
        evt.preventDefault();
        evt.stopPropagation();
        this.startKeyHold(() => this.handleApply(), 'apply');
        return;
      }
      
      // Enter: 长按应用
      if (evt.key === 'Enter' && !evt.shiftKey) {
        evt.preventDefault();
        evt.stopPropagation();
        this.startKeyHold(() => this.handleApply(), 'apply');
        return;
      }
      
      // Escape: 长按关闭
      if (evt.key === 'Escape') {
        evt.preventDefault();
        evt.stopPropagation();
        this.startKeyHold(() => this.leaf.detach(), 'reject-all');
        return;
      }
    });
    
    // keyup 取消长按
    this.registerDomEvent(document, 'keyup', (evt: KeyboardEvent) => {
      if (evt.key === 'Enter' || evt.key === 'Escape' || evt.key === 'F4') {
        this.cancelKeyHold();
      }
    });
  }
  
  /**
   * 处理块级快捷键
   * 找到第一个未决策的修改块并应用决策
   */
  private handleBlockShortcut(decision: 'incoming' | 'current' | 'both'): void {
    // 遍历所有选区组，找到第一个未决策的修改块
    for (const group of this.selectionGroups) {
      for (const block of group.diffResult.blocks) {
        if (block.type === 'modified') {
          const currentDecision = group.decisionManager.getDecision(block.index);
          if (currentDecision === 'pending') {
            // 检查决策是否有效
            if (decision === 'incoming' && block.modifiedValue === undefined) continue;
            if (decision === 'current' && block.originalValue === undefined) continue;
            if (decision === 'both' && (block.originalValue === undefined || block.modifiedValue === undefined)) continue;
            
            group.decisionManager.setDecision(block.index, decision);
            return;
          }
        }
      }
    }
  }
  
  /**
   * 开始键盘长按计时
   */
  private startKeyHold(action: () => void, buttonClass: string): void {
    // 清除之前的计时器
    this.cancelKeyHold();
    
    // 高亮对应按钮
    const btn = this.toolbarActionsEl?.querySelector(`.${buttonClass}`) as HTMLElement | null;
    if (btn) {
      btn.addClass('holding');
      // 启动进度条动画
      const progressBar = btn.querySelector('.hold-progress') as HTMLElement | null;
      if (progressBar) {
        progressBar.style.transition = `width ${WritingApplyView.HOLD_DURATION}ms linear`;
        progressBar.style.width = '100%';
      }
    }
    
    this.keyHoldAction = action;
    this.keyHoldTimer = setTimeout(() => {
      // 移除高亮
      if (btn) {
        btn.removeClass('holding');
        const progressBar = btn.querySelector('.hold-progress') as HTMLElement | null;
        if (progressBar) {
          progressBar.style.transition = 'none';
          progressBar.style.width = '0%';
        }
      }
      // 执行操作
      action();
      this.keyHoldTimer = null;
      this.keyHoldAction = null;
    }, WritingApplyView.HOLD_DURATION);
  }
  
  /**
   * 取消键盘长按
   */
  private cancelKeyHold(): void {
    if (this.keyHoldTimer) {
      clearTimeout(this.keyHoldTimer);
      this.keyHoldTimer = null;
    }
    this.keyHoldAction = null;
    
    // 移除所有按钮的 holding 状态
    const buttons = this.toolbarActionsEl?.querySelectorAll('.holding');
    buttons?.forEach(btn => {
      btn.removeClass('holding');
      const progressBar = btn.querySelector('.hold-progress') as HTMLElement | null;
      if (progressBar) {
        progressBar.style.transition = 'none';
        progressBar.style.width = '0%';
      }
    });
  }

  /**
   * 设置视图状态（自定义方法，不覆盖父类）
   */
  setViewState(state: WritingApplyViewState): void {
    this.state = state;
    
    // 重置流式状态
    this.streamState = {
      isStreaming: true,
      content: '',
      thinking: '',
    };
    
    // 重置选区 diff 组
    this.selectionGroups = [];
    this.viewPhase = 'streaming';
    
    // 延迟高亮源编辑器中的选区，确保编辑器已准备好
    setTimeout(() => {
      this.highlightSourceSelection();
    }, 100);
    
    if (this.contentEl) {
      this.render();
    }
  }

  /**
   * 追加流式内容
   */
  appendContent(chunk: string): void {
    this.streamState.content += chunk;
    this.updateStreamingContent();
  }

  /**
   * 追加思考内容
   */
  appendThinking(chunk: string): void {
    // 累积思考内容
    this.streamState.thinking += chunk;
    this.updateThinkingContent();
  }

  /**
   * 设置完成状态，触发 diff 计算
   */
  setComplete(): void {
    this.streamState.isStreaming = false;
    this.viewPhase = 'computing';
    this.updateStatus();
    
    // 计算 diff
    if (this.state) {
      // 清理流式内容中的前导/尾随空行（think 标签移除后可能留下）
      const cleanedContent = this.cleanContent(this.streamState.content);
      
      // 保存原始带分隔符的内容（用于多选区应用）
      this.rawNewContent = cleanedContent;
      
      // 按选区分别计算 diff
      this.selectionGroups = this.computeSelectionDiffs(cleanedContent);
      
      this.viewPhase = 'ready';
    }
    
    // 重新渲染以显示 diff 结果
    this.render();
  }
  
  /**
   * 按选区分别计算 diff
   */
  private computeSelectionDiffs(newContent: string): SelectionDiffGroup[] {
    if (!this.state) return [];
    
    const groups: SelectionDiffGroup[] = [];
    
    // 分割原始内容和新内容
    const originalParts = this.state.originalText.split(MULTI_SELECTION_SEPARATOR);
    const newParts = newContent.split(MULTI_SELECTION_SEPARATOR);
    
    // 获取每个选区的起始行号
    const selections = this.state.selections || [];
    
    // 为每个选区创建 diff 组
    const count = Math.max(originalParts.length, newParts.length);
    for (let i = 0; i < count; i++) {
      const originalText = (originalParts[i] || '').trim();
      const newText = (newParts[i] || '').trim();
      
      // 获取选区起始行号（1-indexed）
      const startLine = selections[i] ? selections[i].from.line + 1 : 1;
      
      const diffResult = this.diffEngine.computeDiff(originalText, newText, startLine);
      const decisionManager = new DecisionManager(
        diffResult.modifiedIndices,
        () => this.onDecisionChange()
      );
      
      groups.push({
        index: i,
        originalText,
        newText,
        startLine,
        diffResult,
        decisionManager,
      });
    }
    
    return groups;
  }
  
  /**
   * 清理内容中的多余空行
   * 移除 think 标签后可能留下的前导空行和连续空行
   * 注意：保护 MULTI_SELECTION_SEPARATOR 不被破坏
   */
  private cleanContent(content: string): string {
    // 先保护分隔符，用占位符替换
    const PLACEHOLDER = '\x00SELECTION_BOUNDARY_PLACEHOLDER\x00';
    let cleaned = content.replace(/\n---SELECTION_BOUNDARY---\n/g, PLACEHOLDER);
    
    // 移除开头的空行
    cleaned = cleaned.replace(/^\s*\n+/, '');
    // 移除结尾的空行
    cleaned = cleaned.replace(/\n+\s*$/, '');
    // 将连续的多个空行替换为单个空行
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    
    // 恢复分隔符
    cleaned = cleaned.replace(new RegExp(PLACEHOLDER, 'g'), MULTI_SELECTION_SEPARATOR);
    
    return cleaned;
  }

  /**
   * 设置错误状态
   */
  setError(message: string): void {
    this.streamState.isStreaming = false;
    this.streamState.error = message;
    this.viewPhase = 'ready';
    
    if (this.statusEl) {
      this.statusEl.textContent = `${t('writing.status.error')}: ${message}`;
      this.statusEl.addClass('error');
    }
  }

  /**
   * 决策变更回调
   */
  private onDecisionChange(): void {
    // 更新进度显示
    this.updateProgress();
    // 更新工具栏按钮状态
    this.updateToolbarButtons();
    // 重新渲染 diff 块
    this.renderDiffBlocks();
  }

  // ============================================================================
  // 渲染方法
  // ============================================================================

  private render(): void {
    if (!this.viewContentEl || !this.state) return;
    
    this.viewContentEl.empty();
    
    // 工具栏
    const toolbar = this.createToolbar();
    this.viewContentEl.appendChild(toolbar);
    
    // Diff 内容区域
    this.diffContainerEl = document.createElement('div');
    this.diffContainerEl.className = 'writing-apply-diff-container';
    
    // 思考内容（可折叠）
    const thinkingEl = this.createThinkingSection();
    this.diffContainerEl.appendChild(thinkingEl);
    
    // 根据视图阶段渲染不同内容
    if (this.viewPhase === 'streaming') {
      // 流式阶段：显示流式内容
      this.renderStreamingContent();
    } else if (this.viewPhase === 'ready' && this.selectionGroups.length > 0) {
      // 就绪阶段：显示 diff 块
      this.renderDiffBlocks();
    }
    
    this.viewContentEl.appendChild(this.diffContainerEl);
    
    this.updateStatus();
    this.updateProgress();
    this.updateToolbarButtons();
    
    // 恢复思考内容显示（如果有）
    this.updateThinkingContent();
  }
  
  /**
   * 渲染流式内容（流式阶段）
   * 按选区分开显示，每个选区独立的原文和流式结果
   */
  private renderStreamingContent(): void {
    if (!this.diffContainerEl || !this.state) return;
    
    // 移除旧的流式内容
    const oldBlocks = this.diffContainerEl.querySelector('.writing-apply-blocks');
    if (oldBlocks) oldBlocks.remove();
    
    const blocksContainer = document.createElement('div');
    blocksContainer.className = 'writing-apply-blocks';
    
    // 分割原始内容和流式内容
    const originalParts = this.state.originalText.split(MULTI_SELECTION_SEPARATOR);
    const streamParts = (this.streamState.content || '').split(MULTI_SELECTION_SEPARATOR);
    const selections = this.state.selections || [];
    
    // 为每个选区创建流式块
    for (let i = 0; i < originalParts.length; i++) {
      const originalText = (originalParts[i] || '').trim();
      const streamText = (streamParts[i] || '...').trim();
      const startLine = selections[i] ? selections[i].from.line + 1 : 1;
      
      const blockEl = document.createElement('div');
      blockEl.className = 'writing-apply-block writing-apply-block-modified streaming-block';
      blockEl.setAttribute('data-selection-index', String(i));
      
      // 原始内容（带行号）
      const originalEl = this.createContentWithLineNumbers(
        originalText,
        startLine,
        'original'
      );
      blockEl.appendChild(originalEl);
      
      // AI 生成内容（带行号，使用相同的起始行号便于对照）
      const modifiedEl = this.createContentWithLineNumbers(
        streamText,
        startLine,
        'modified streaming-result' + (this.streamState.isStreaming ? ' streaming' : '')
      );
      blockEl.appendChild(modifiedEl);
      
      blocksContainer.appendChild(blockEl);
    }
    
    this.diffContainerEl.appendChild(blocksContainer);
  }
  
  /**
   * 创建带行号的内容区域
   */
  private createContentWithLineNumbers(
    content: string,
    startLine: number,
    className: string
  ): HTMLElement {
    const container = document.createElement('div');
    container.className = `writing-apply-block-content ${className}`;
    
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const lineEl = document.createElement('div');
      lineEl.className = 'writing-apply-line';
      
      // 行号
      const lineNumEl = document.createElement('span');
      lineNumEl.className = 'writing-apply-line-number';
      lineNumEl.textContent = String(startLine + i);
      lineEl.appendChild(lineNumEl);
      
      // 行内容
      const lineContentEl = document.createElement('span');
      lineContentEl.className = 'writing-apply-line-content';
      lineContentEl.textContent = lines[i] || ' '; // 空行显示空格保持高度
      lineEl.appendChild(lineContentEl);
      
      container.appendChild(lineEl);
    }
    
    return container;
  }
  
  /**
   * 创建可编辑的内容区域
   */
  private createEditableContent(
    block: DiffBlock,
    group: SelectionDiffGroup,
    startLine: number,
    className: string
  ): HTMLElement {
    const container = document.createElement('div');
    container.className = `writing-apply-block-content ${className} editable`;
    
    // 使用 textarea 实现可编辑
    const textarea = document.createElement('textarea');
    textarea.className = 'writing-apply-editable-textarea';
    textarea.value = block.modifiedValue || '';
    textarea.spellcheck = false;
    
    // 自动调整高度
    const adjustHeight = () => {
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    };
    
    // 初始调整高度
    setTimeout(adjustHeight, 0);
    
    // 输入时调整高度并更新值
    textarea.addEventListener('input', () => {
      adjustHeight();
      // 更新 block 的 modifiedValue
      block.modifiedValue = textarea.value;
    });
    
    // 行号容器
    const lineNumbersEl = document.createElement('div');
    lineNumbersEl.className = 'writing-apply-line-numbers';
    
    // 更新行号显示
    const updateLineNumbers = () => {
      const lines = textarea.value.split('\n');
      lineNumbersEl.empty();
      for (let i = 0; i < lines.length; i++) {
        const lineNumEl = document.createElement('div');
        lineNumEl.className = 'writing-apply-line-number';
        lineNumEl.textContent = String(startLine + i);
        lineNumbersEl.appendChild(lineNumEl);
      }
    };
    
    // 初始更新行号
    updateLineNumbers();
    
    // 输入时更新行号
    textarea.addEventListener('input', updateLineNumbers);
    
    container.appendChild(lineNumbersEl);
    container.appendChild(textarea);
    
    return container;
  }
  
  /**
   * 更新流式内容显示
   */
  private updateStreamingContent(): void {
    if (!this.diffContainerEl || !this.state) return;
    
    // 如果流式内容区域不存在，先创建它
    if (!this.diffContainerEl.querySelector('.streaming-block')) {
      this.renderStreamingContent();
      return;
    }
    
    // 分割流式内容
    const streamParts = (this.streamState.content || '').split(MULTI_SELECTION_SEPARATOR);
    const streamingBlocks = this.diffContainerEl.querySelectorAll('.streaming-block');
    const selections = this.state.selections || [];
    
    streamingBlocks.forEach((blockEl, i) => {
      const streamText = (streamParts[i] || '...').trim();
      const modifiedEl = blockEl.querySelector('.modified.streaming-result');
      // 获取该选区的起始行号
      const startLine = selections[i] ? selections[i].from.line + 1 : 1;
      
      if (modifiedEl) {
        // 重新渲染带行号的内容
        modifiedEl.empty();
        const lines = streamText.split('\n');
        
        for (let j = 0; j < lines.length; j++) {
          const lineEl = document.createElement('div');
          lineEl.className = 'writing-apply-line';
          
          const lineNumEl = document.createElement('span');
          lineNumEl.className = 'writing-apply-line-number';
          lineNumEl.textContent = String(startLine + j);
          lineEl.appendChild(lineNumEl);
          
          const lineContentEl = document.createElement('span');
          lineContentEl.className = 'writing-apply-line-content';
          lineContentEl.textContent = lines[j] || ' ';
          lineEl.appendChild(lineContentEl);
          
          modifiedEl.appendChild(lineEl);
        }
      }
    });
  }
  
  /**
   * 渲染 diff 块列表（按选区显示，带行号）
   */
  private renderDiffBlocks(): void {
    if (!this.diffContainerEl) return;
    
    // 移除旧的 diff 块容器
    const oldBlocks = this.diffContainerEl.querySelector('.writing-apply-blocks');
    if (oldBlocks) oldBlocks.remove();
    
    const blocksContainer = document.createElement('div');
    blocksContainer.className = 'writing-apply-blocks';
    
    // 直接按选区渲染，不使用分组容器
    for (const group of this.selectionGroups) {
      for (const block of group.diffResult.blocks) {
        const blockEl = this.renderDiffBlock(block, group);
        blocksContainer.appendChild(blockEl);
      }
    }
    
    this.diffContainerEl.appendChild(blocksContainer);
  }
  
  /**
   * 渲染单个 diff 块（带行号）
   */
  private renderDiffBlock(block: DiffBlock, group: SelectionDiffGroup): HTMLElement {
    const blockEl = document.createElement('div');
    blockEl.className = `writing-apply-block writing-apply-block-${block.type}`;
    blockEl.setAttribute('data-block-index', String(block.index));
    blockEl.setAttribute('data-group-index', String(group.index));
    
    if (block.type === 'unchanged') {
      // 未变化块：带行号显示
      const content = this.createContentWithLineNumbers(
        block.value || '',
        block.originalStartLine || 1,
        'unchanged'
      );
      blockEl.appendChild(content);
    } else {
      // 修改块：显示原文和新文，以及操作按钮
      const decision = group.decisionManager.getDecision(block.index);
      
      // 根据决策状态显示不同内容
      if (decision === 'pending') {
        // 未决策：显示原文（红色背景）和新文（绿色背景，可编辑）
        if (block.originalValue !== undefined) {
          const originalEl = this.createContentWithLineNumbers(
            block.originalValue,
            block.originalStartLine || 1,
            'original'
          );
          blockEl.appendChild(originalEl);
        }
        
        if (block.modifiedValue !== undefined) {
          // 修改后内容使用可编辑区域
          const modifiedEl = this.createEditableContent(
            block,
            group,
            block.originalStartLine || 1,
            'modified'
          );
          blockEl.appendChild(modifiedEl);
        }
        
        // 操作按钮（悬浮在块上方）
        const actionsEl = this.createBlockActions(block, group);
        blockEl.appendChild(actionsEl);
      } else {
        // 已决策：显示决策标签和预览内容
        blockEl.addClass('decided');
        
        const headerEl = document.createElement('div');
        headerEl.className = 'writing-apply-decided-header';
        
        const labelEl = document.createElement('span');
        labelEl.className = 'writing-apply-decided-label';
        labelEl.textContent = `✓ ${this.getDecisionLabel(decision)}`;
        headerEl.appendChild(labelEl);
        
        // Undo 按钮
        const undoBtn = document.createElement('button');
        undoBtn.className = 'writing-apply-block-btn undo';
        undoBtn.textContent = t('writing.actions.undo');
        undoBtn.addEventListener('click', () => {
          group.decisionManager.undoDecision(block.index);
        });
        headerEl.appendChild(undoBtn);
        
        blockEl.appendChild(headerEl);
        
        // 预览内容（带行号）
        const previewContent = this.getDecisionPreview(block, decision);
        const previewEl = this.createContentWithLineNumbers(
          previewContent,
          block.originalStartLine || 1,
          'preview'
        );
        blockEl.appendChild(previewEl);
      }
    }
    
    return blockEl;
  }
  
  /**
   * 获取决策标签文本
   */
  private getDecisionLabel(decision: BlockDecision): string {
    switch (decision) {
      case 'incoming':
        return t('writing.decisions.acceptedIncoming');
      case 'current':
        return t('writing.decisions.keptCurrent');
      case 'both':
        return t('writing.decisions.mergedBoth');
      default:
        return '';
    }
  }
  
  /**
   * 创建带快捷键提示的按钮
   */
  private createButtonWithShortcut(
    className: string,
    text: string,
    shortcut: string,
    onClick: () => void
  ): HTMLElement {
    const btn = document.createElement('button');
    btn.className = className;
    
    // 按钮文本
    const textSpan = document.createElement('span');
    textSpan.className = 'btn-text';
    textSpan.textContent = text;
    btn.appendChild(textSpan);
    
    // 快捷键提示
    const shortcutSpan = document.createElement('span');
    shortcutSpan.className = 'btn-shortcut';
    shortcutSpan.textContent = shortcut;
    btn.appendChild(shortcutSpan);
    
    btn.addEventListener('click', onClick);
    return btn;
  }
  
  /**
   * 创建块级操作按钮
   */
  private createBlockActions(block: DiffBlock, group: SelectionDiffGroup): HTMLElement {
    const actionsEl = document.createElement('div');
    actionsEl.className = 'writing-apply-block-actions';
    
    // Accept Incoming 按钮 (Y)
    if (block.modifiedValue !== undefined) {
      const incomingBtn = this.createButtonWithShortcut(
        'writing-apply-block-btn incoming',
        t('writing.actions.acceptIncoming'),
        'Y',
        () => group.decisionManager.setDecision(block.index, 'incoming')
      );
      actionsEl.appendChild(incomingBtn);
    }
    
    // Accept Current 按钮 (N)
    if (block.originalValue !== undefined) {
      const currentBtn = this.createButtonWithShortcut(
        'writing-apply-block-btn current',
        t('writing.actions.acceptCurrent'),
        'N',
        () => group.decisionManager.setDecision(block.index, 'current')
      );
      actionsEl.appendChild(currentBtn);
    }
    
    // Accept Both 按钮 (B)
    if (block.originalValue !== undefined && block.modifiedValue !== undefined) {
      const bothBtn = this.createButtonWithShortcut(
        'writing-apply-block-btn both',
        t('writing.actions.acceptBoth'),
        'B',
        () => group.decisionManager.setDecision(block.index, 'both')
      );
      actionsEl.appendChild(bothBtn);
    }
    
    return actionsEl;
  }
  
  /**
   * 获取决策预览内容
   */
  private getDecisionPreview(block: DiffBlock, decision: BlockDecision): string {
    switch (decision) {
      case 'incoming':
        return block.modifiedValue || '';
      case 'current':
        return block.originalValue || '';
      case 'both':
        return (block.originalValue || '') + '\n' + (block.modifiedValue || '');
      default:
        return '';
    }
  }

  private createToolbar(): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'writing-apply-toolbar';
    
    // 左侧：状态和进度
    const leftSection = document.createElement('div');
    leftSection.className = 'writing-apply-toolbar-left';
    
    // 状态
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'writing-apply-status';
    leftSection.appendChild(this.statusEl);
    
    // 进度显示
    this.progressEl = document.createElement('div');
    this.progressEl.className = 'writing-apply-progress';
    leftSection.appendChild(this.progressEl);
    
    toolbar.appendChild(leftSection);
    
    // 右侧：按钮组
    this.toolbarActionsEl = document.createElement('div');
    this.toolbarActionsEl.className = 'writing-apply-actions';
    
    // 接受全部按钮 - 普通点击，标记所有块为 incoming (Shift+Y)
    const acceptAllBtn = this.createButtonWithShortcut(
      'writing-apply-btn accept-all',
      t('writing.actions.acceptAll'),
      'Shift+Y',
      () => this.handleAcceptAllIncoming()
    );
    setTooltip(acceptAllBtn, t('writing.actions.acceptAllTooltip'));
    this.toolbarActionsEl.appendChild(acceptAllBtn);
    
    // 拒绝全部按钮 - 普通点击，标记所有块为 current (Shift+N)
    const rejectAllBtn = this.createButtonWithShortcut(
      'writing-apply-btn reject-all',
      t('writing.actions.rejectAll'),
      'Shift+N',
      () => this.handleRejectAll()
    );
    setTooltip(rejectAllBtn, t('writing.actions.rejectAllTooltip'));
    this.toolbarActionsEl.appendChild(rejectAllBtn);
    
    // 重置按钮（有决策时显示）(Shift+R)
    const resetBtn = this.createButtonWithShortcut(
      'writing-apply-btn reset',
      t('writing.actions.reset'),
      'Shift+R',
      () => this.handleReset()
    );
    resetBtn.style.display = 'none';
    this.toolbarActionsEl.appendChild(resetBtn);
    
    // 应用按钮 - 长按确认 (F4)
    const applyBtn = this.createHoldToConfirmButton(
      'apply',
      t('writing.actions.apply'),
      () => this.handleApply(),
      'writing.actions.applyTooltip',
      'F4'
    );
    this.toolbarActionsEl.appendChild(applyBtn);
    
    toolbar.appendChild(this.toolbarActionsEl);
    return toolbar;
  }
  
  /**
   * 创建长按确认按钮
   * 按住后执行操作，显示进度动画
   */
  private createHoldToConfirmButton(
    className: string,
    text: string,
    onConfirm: () => void,
    tooltipKey?: string,
    shortcut?: string
  ): HTMLElement {
    const HOLD_DURATION = 500; // 0.5 秒
    
    const btn = document.createElement('button');
    btn.className = `writing-apply-btn ${className} hold-to-confirm`;
    if (tooltipKey) setTooltip(btn, t(tooltipKey));
    
    // 按钮文本
    const textSpan = document.createElement('span');
    textSpan.className = 'btn-text';
    textSpan.textContent = text;
    btn.appendChild(textSpan);
    
    // 快捷键提示
    if (shortcut) {
      const shortcutSpan = document.createElement('span');
      shortcutSpan.className = 'btn-shortcut';
      shortcutSpan.textContent = shortcut;
      btn.appendChild(shortcutSpan);
    }
    
    // 进度条
    const progressBar = document.createElement('div');
    progressBar.className = 'hold-progress';
    btn.appendChild(progressBar);
    
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let startTime = 0;
    let animationFrame: number | null = null;
    
    const updateProgress = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / HOLD_DURATION, 1);
      progressBar.style.width = `${progress * 100}%`;
      
      if (progress < 1) {
        animationFrame = requestAnimationFrame(updateProgress);
      }
    };
    
    const startHold = () => {
      if (btn.disabled) return;
      
      startTime = Date.now();
      btn.addClass('holding');
      progressBar.style.width = '0%';
      
      animationFrame = requestAnimationFrame(updateProgress);
      
      holdTimer = setTimeout(() => {
        btn.removeClass('holding');
        progressBar.style.width = '0%';
        onConfirm();
      }, HOLD_DURATION);
    };
    
    const cancelHold = () => {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      btn.removeClass('holding');
      progressBar.style.width = '0%';
    };
    
    // 鼠标事件
    btn.addEventListener('mousedown', startHold);
    btn.addEventListener('mouseup', cancelHold);
    btn.addEventListener('mouseleave', cancelHold);
    
    // 触摸事件
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startHold();
    });
    btn.addEventListener('touchend', cancelHold);
    btn.addEventListener('touchcancel', cancelHold);
    
    return btn;
  }

  private createThinkingSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'writing-apply-thinking';
    section.style.display = 'none';
    
    const header = document.createElement('div');
    header.className = 'writing-apply-thinking-header';
    
    const chevron = document.createElement('span');
    chevron.className = 'writing-apply-thinking-chevron';
    chevron.textContent = '▶';
    header.appendChild(chevron);
    
    const title = document.createElement('span');
    title.textContent = t('writing.thinking.title');
    header.appendChild(title);
    
    const content = document.createElement('div');
    content.className = 'writing-apply-thinking-content';
    content.style.display = 'none';
    
    header.addEventListener('click', () => {
      const isExpanded = content.style.display !== 'none';
      content.style.display = isExpanded ? 'none' : 'block';
      chevron.textContent = isExpanded ? '▶' : '▼';
    });
    
    section.appendChild(header);
    section.appendChild(content);
    
    return section;
  }


  // ============================================================================
  // 更新方法
  // ============================================================================

  private updateStatus(): void {
    if (!this.statusEl) return;
    
    this.statusEl.removeClass('error');
    
    switch (this.viewPhase) {
      case 'streaming':
        this.statusEl.textContent = t('writing.status.streaming');
        break;
      case 'computing':
        this.statusEl.textContent = t('writing.status.computing');
        break;
      case 'ready':
        if (this.streamState.error) {
          this.statusEl.textContent = `${t('writing.status.error')}: ${this.streamState.error}`;
          this.statusEl.addClass('error');
        } else {
          this.statusEl.textContent = t('writing.status.complete');
        }
        break;
    }
  }
  
  /**
   * 更新进度显示
   */
  private updateProgress(): void {
    if (!this.progressEl || this.selectionGroups.length === 0) {
      if (this.progressEl) {
        this.progressEl.textContent = '';
      }
      return;
    }
    
    // 汇总所有选区的进度
    let resolved = 0;
    let total = 0;
    for (const group of this.selectionGroups) {
      resolved += group.decisionManager.getResolvedCount();
      total += group.decisionManager.getTotalCount();
    }
    
    if (total > 0) {
      this.progressEl.textContent = t('writing.progress.resolved', { resolved: String(resolved), total: String(total) });
    } else {
      this.progressEl.textContent = t('writing.progress.noChanges');
    }
  }
  
  /**
   * 更新工具栏按钮状态
   */
  private updateToolbarButtons(): void {
    if (!this.toolbarActionsEl) return;
    
    const isReady = this.viewPhase === 'ready';
    
    // 汇总所有选区的决策状态
    let hasDecisions = false;
    let hasModifiedBlocks = false;
    for (const group of this.selectionGroups) {
      if (group.decisionManager.getResolvedCount() > 0) hasDecisions = true;
      if (group.decisionManager.getTotalCount() > 0) hasModifiedBlocks = true;
    }
    
    // 获取按钮
    const acceptAllBtn = this.toolbarActionsEl.querySelector('.accept-all') as HTMLButtonElement | null;
    const rejectAllBtn = this.toolbarActionsEl.querySelector('.reject-all') as HTMLButtonElement | null;
    const resetBtn = this.toolbarActionsEl.querySelector('.reset') as HTMLButtonElement | null;
    const applyBtn = this.toolbarActionsEl.querySelector('.apply') as HTMLButtonElement | null;
    
    // 流式期间禁用决策按钮
    if (acceptAllBtn) {
      acceptAllBtn.disabled = !isReady || !hasModifiedBlocks;
    }
    if (rejectAllBtn) {
      rejectAllBtn.disabled = !isReady || !hasModifiedBlocks;
    }
    if (applyBtn) {
      applyBtn.disabled = !isReady;
    }
    
    // Reset 按钮只在有决策时显示
    if (resetBtn) {
      resetBtn.style.display = hasDecisions ? 'inline-block' : 'none';
    }
  }

  private updateThinkingContent(): void {
    const thinkingSection = this.viewContentEl?.querySelector('.writing-apply-thinking') as HTMLElement | null;
    const thinkingContent = thinkingSection?.querySelector('.writing-apply-thinking-content') as HTMLElement | null;
    const chevron = thinkingSection?.querySelector('.writing-apply-thinking-chevron') as HTMLElement | null;
    
    if (thinkingSection && thinkingContent && this.streamState.thinking) {
      // 显示思考区域
      thinkingSection.style.display = 'block';
      // 自动展开内容（首次有内容时）
      if (thinkingContent.style.display === 'none') {
        thinkingContent.style.display = 'block';
        if (chevron) {
          chevron.textContent = '▼';
        }
      }
      thinkingContent.textContent = this.streamState.thinking;
    }
  }

  // ============================================================================
  // 操作处理
  // ============================================================================
  
  /**
   * 接受所有新内容（标记所有块为 incoming）
   */
  private handleAcceptAllIncoming(): void {
    for (const group of this.selectionGroups) {
      group.decisionManager.acceptAllIncoming();
    }
  }
  
  /**
   * 拒绝所有（标记所有块为 current）
   */
  private handleRejectAll(): void {
    for (const group of this.selectionGroups) {
      group.decisionManager.acceptAllCurrent();
    }
  }
  
  /**
   * 重置所有决策
   */
  private handleReset(): void {
    for (const group of this.selectionGroups) {
      group.decisionManager.resetAll();
    }
  }

  /**
   * 应用更改并关闭
   */
  private async handleApply(): Promise<void> {
    if (!this.state || this.selectionGroups.length === 0) return;
    
    // 获取目标文件的 MarkdownView
    const file = this.app.vault.getAbstractFileByPath(this.state.filePath);
    if (!(file instanceof TFile)) {
      this.showError(t('writing.errors.fileNotFound'));
      return;
    }
    
    // 查找打开该文件的 MarkdownView
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    let found = false;
    
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === this.state.filePath) {
        const editor = view.editor;
        
        // 多选区处理
        if (this.state.isMultiSelection && this.state.selections && this.state.selections.length > 1) {
          const selections = this.state.selections;
          
          // 为每个选区生成最终内容
          const partsToApply: string[] = [];
          for (let i = 0; i < selections.length; i++) {
            const group = this.selectionGroups[i];
            if (group) {
              const finalContent = this.diffEngine.generateFinalContent(
                group.diffResult.blocks,
                group.decisionManager.getAllDecisions(),
                'current'  // 未决策的块保留原内容
              );
              partsToApply.push(finalContent);
            } else {
              // 如果没有对应的 diff 组，保留原文
              partsToApply.push(selections[i].text);
            }
          }
          
          // 从后往前替换，避免位置偏移
          const indexedSelections = selections.map((sel, idx) => ({ sel, idx }));
          indexedSelections.sort((a, b) => {
            return b.sel.from.line - a.sel.from.line || b.sel.from.ch - a.sel.from.ch;
          });
          
          // 批量替换
          for (const { sel, idx } of indexedSelections) {
            if (idx < partsToApply.length) {
              editor.replaceRange(partsToApply[idx], sel.from, sel.to);
            }
          }
        } else {
          // 单选区处理
          const group = this.selectionGroups[0];
          if (group) {
            const finalContent = this.diffEngine.generateFinalContent(
              group.diffResult.blocks,
              group.decisionManager.getAllDecisions(),
              'current'  // 未决策的块保留原内容
            );
            editor.replaceRange(finalContent, this.state.from, this.state.to);
          }
        }
        
        found = true;
        break;
      }
    }
    
    if (!found) {
      this.showError(t('writing.errors.editorNotFound'));
      return;
    }
    
    // 关闭视图
    this.leaf.detach();
  }
  
  /**
   * 显示错误提示
   */
  private showError(message: string): void {
    if (this.statusEl) {
      this.statusEl.textContent = message;
      this.statusEl.addClass('error');
    }
  }
  
  // ============================================================================
  // 源编辑器高亮
  // ============================================================================
  
  /**
   * 获取 CodeMirror EditorView
   */
  private getEditorView(editor: Editor): EditorView | null {
    // Obsidian 的 Editor 内部有 cm 属性指向 CodeMirror EditorView
    const editorAny = editor as Editor & { cm?: EditorView };
    if (editorAny.cm && editorAny.cm instanceof EditorView) {
      return editorAny.cm;
    }
    return null;
  }
  
  /**
   * 高亮源编辑器中的选区
   */
  private highlightSourceSelection(): void {
    if (!this.state) return;
    
    // 先清除之前的高亮
    this.clearSourceHighlight();
    
    // 查找源文件的 MarkdownView
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === this.state.filePath) {
        const editor = view.editor;
        const editorView = this.getEditorView(editor);
        
        if (!editorView) {
          console.warn('[WritingApplyView] 无法获取 EditorView');
          continue;
        }
        
        this.sourceEditorView = editorView;
        
        // 确保高亮扩展已添加
        if (!this.highlightExtensionAdded) {
          // 检查是否已有该扩展
          try {
            editorView.state.field(highlightField);
          } catch {
            // 扩展不存在，添加它
            editorView.dispatch({
              effects: StateEffect.appendConfig.of([highlightField]),
            });
          }
          this.highlightExtensionAdded = true;
        }
        
        // 计算高亮范围（字符偏移量）
        const ranges: { from: number; to: number }[] = [];
        const doc = editorView.state.doc;
        
        if (this.state.isMultiSelection && this.state.selections && this.state.selections.length > 0) {
          // 多选区
          for (const sel of this.state.selections) {
            try {
              const fromLine = doc.line(sel.from.line + 1);
              const toLine = doc.line(sel.to.line + 1);
              const from = fromLine.from + sel.from.ch;
              const to = toLine.from + sel.to.ch;
              ranges.push({ from, to });
            } catch (e) {
              // 行号超出范围，跳过
              console.warn('[WritingApplyView] 行号超出范围:', e);
            }
          }
        } else {
          // 单选区
          try {
            const fromLine = doc.line(this.state.from.line + 1);
            const toLine = doc.line(this.state.to.line + 1);
            const from = fromLine.from + this.state.from.ch;
            const to = toLine.from + this.state.to.ch;
            ranges.push({ from, to });
          } catch (e) {
            // 行号超出范围
            console.warn('[WritingApplyView] 行号超出范围:', e);
          }
        }
        
        // 应用高亮
        if (ranges.length > 0) {
          console.log('[WritingApplyView] 应用高亮范围:', ranges);
          editorView.dispatch({
            effects: setHighlightEffect.of(ranges),
          });
          
          // 滚动到第一个选区
          const firstRange = ranges[0];
          editorView.dispatch({
            effects: EditorView.scrollIntoView(firstRange.from, { y: 'center' }),
          });
        }
        
        break;
      }
    }
  }
  
  /**
   * 清除源编辑器高亮
   */
  private clearSourceHighlight(): void {
    if (this.sourceEditorView) {
      try {
        // 检查 EditorView 是否仍然有效
        if (this.sourceEditorView.state && this.highlightExtensionAdded) {
          this.sourceEditorView.dispatch({
            effects: clearHighlightEffect.of(null),
          });
        }
      } catch {
        // 编辑器可能已被销毁，忽略错误
      }
    }
    this.sourceEditorView = null;
    this.highlightExtensionAdded = false;
  }
}
