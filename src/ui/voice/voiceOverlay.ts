/**
 * VoiceOverlay - 语音状态悬浮窗组件
 * 
 * 职责:
 * 1. 显示录音状态（录音中、处理中、成功、错误）
 * 2. 显示实时波形可视化（9 条柱状图）
 * 3. Toggle 模式下显示取消/完成按钮
 * 4. 处理中显示动画
 * 5. 成功/错误状态短暂显示后自动隐藏
 * 6. 显示实时转录文本（realtime 模式）
 * 
 */

import type { App} from 'obsidian';
import { MarkdownView } from 'obsidian';
import { t } from '../../i18n';
import { debugLog } from '../../utils/logger';
import type {
  IVoiceOverlay,
  OverlayState,
  OverlayPosition,
  RecordingMode,
} from '../../services/voice/types';

/**
 * 悬浮窗配置
 */
interface VoiceOverlayConfig {
  /** 悬浮窗位置 */
  position: OverlayPosition;
  /** 成功/错误状态显示时长 (ms) */
  statusDisplayDuration: number;
  /** 波形柱状图数量 */
  waveformBars: number;
  /** 波形更新间隔 (ms) */
  waveformUpdateInterval: number;
}

const DEFAULT_CONFIG: VoiceOverlayConfig = {
  position: 'center',
  statusDisplayDuration: 1500,
  waveformBars: 9,
  waveformUpdateInterval: 50,
};

/**
 * VoiceOverlay 悬浮窗组件
 */
export class VoiceOverlay implements IVoiceOverlay {
  private app: App;
  private config: VoiceOverlayConfig;
  
  // DOM 元素
  private containerEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private waveformEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private buttonsEl: HTMLElement | null = null;
  private partialTextEl: HTMLElement | null = null;
  
  // 波形柱状图元素
  private waveformBars: HTMLElement[] = [];
  
  // 状态
  private currentState: OverlayState | null = null;
  private isVisible = false;
  private hideTimeout: NodeJS.Timeout | null = null;
  
  // 回调
  private onCancel: (() => void) | null = null;
  private onFinish: (() => void) | null = null;

  constructor(app: App, config?: Partial<VoiceOverlayConfig>) {
    this.app = app;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ============================================================================
  // 公共方法
  // ============================================================================

  /**
   * 显示悬浮窗
   */
  show(state: OverlayState): void {
    debugLog('[VoiceOverlay] 显示悬浮窗，状态:', state.type);
    
    // 清除之前的隐藏定时器
    this.clearHideTimeout();
    
    // 创建或更新 DOM
    if (!this.containerEl) {
      this.createOverlay();
    }
    
    // 更新状态
    this.updateState(state);
    
    // 显示悬浮窗
    if (this.containerEl && !this.isVisible) {
      this.containerEl.classList.add('visible');
      this.isVisible = true;
    }
    
    // 设置位置
    this.updatePosition();
  }

  /**
   * 隐藏悬浮窗
   */
  hide(): void {
    debugLog('[VoiceOverlay] 隐藏悬浮窗');
    
    this.clearHideTimeout();
    
    if (this.containerEl && this.isVisible) {
      this.containerEl.classList.remove('visible');
      this.containerEl.classList.add('hiding');
      
      // 动画结束后移除 hiding 类
      setTimeout(() => {
        if (this.containerEl) {
          this.containerEl.classList.remove('hiding');
        }
      }, 200);
      
      this.isVisible = false;
    }
    
    this.currentState = null;
  }

  /**
   * 更新状态
   */
  updateState(state: OverlayState): void {
    this.currentState = state;
    
    if (!this.containerEl) {
      return;
    }
    
    // 更新容器类名
    this.updateContainerClass(state);
    
    // 更新内容
    switch (state.type) {
      case 'recording':
        this.showRecordingState(state.mode);
        break;
      case 'processing':
        this.showProcessingState();
        break;
      case 'success':
        this.showSuccessState(state.message);
        this.scheduleHide();
        break;
      case 'error':
        this.showErrorState(state.message);
        this.scheduleHide();
        break;
    }
  }

  /**
   * 更新波形数据
   */
  updateWaveform(levels: number[]): void {
    if (!this.waveformEl || this.currentState?.type !== 'recording') {
      return;
    }
    
    // 确保有足够的数据
    const normalizedLevels = this.normalizeWaveformData(levels);
    
    // 更新每个柱状图的高度
    this.waveformBars.forEach((bar, index) => {
      const level = normalizedLevels[index] || 0;
      // 最小高度 10%，最大高度 100%
      const height = Math.max(10, Math.min(100, level * 100));
      bar.style.height = `${height}%`;
    });
  }

  /**
   * 更新部分转录文本（实时模式）
   * @param text 部分转录文本
   */
  updatePartialText(text: string): void {
    if (!this.partialTextEl || this.currentState?.type !== 'recording') {
      return;
    }
    
    // 更新文本内容
    this.partialTextEl.textContent = text;
    
    // 显示部分转录区域（如果有文本）
    if (text.trim()) {
      this.partialTextEl.style.display = 'block';
      debugLog('[VoiceOverlay] 更新部分转录文本:', text);
    } else {
      this.partialTextEl.style.display = 'none';
    }
  }

  /**
   * 清除部分转录文本
   */
  clearPartialText(): void {
    if (this.partialTextEl) {
      this.partialTextEl.textContent = '';
      this.partialTextEl.style.display = 'none';
    }
  }

  /**
   * 设置位置
   */
  setPosition(x: number, y: number): void {
    if (!this.containerEl) {
      return;
    }
    
    this.containerEl.style.left = `${x}px`;
    this.containerEl.style.top = `${y}px`;
    this.containerEl.style.transform = 'translate(-50%, -50%)';
  }

  /**
   * 设置取消回调
   */
  setOnCancel(callback: () => void): void {
    this.onCancel = callback;
  }

  /**
   * 设置完成回调
   */
  setOnFinish(callback: () => void): void {
    this.onFinish = callback;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<VoiceOverlayConfig>): void {
    this.config = { ...this.config, ...config };
    
    // 如果位置改变，更新位置
    if (config.position && this.isVisible) {
      this.updatePosition();
    }
  }

  /**
   * 销毁组件
   */
  destroy(): void {
    debugLog('[VoiceOverlay] 销毁组件');
    
    this.clearHideTimeout();
    
    if (this.containerEl) {
      this.containerEl.remove();
      this.containerEl = null;
    }
    
    this.contentEl = null;
    this.waveformEl = null;
    this.statusEl = null;
    this.buttonsEl = null;
    this.partialTextEl = null;
    this.waveformBars = [];
    this.currentState = null;
    this.isVisible = false;
  }

  // ============================================================================
  // 私有方法 - DOM 创建
  // ============================================================================

  /**
   * 创建悬浮窗 DOM 结构
   */
  private createOverlay(): void {
    // 创建容器
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'voice-overlay';
    
    // 创建内容区域
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'voice-overlay-content';
    this.containerEl.appendChild(this.contentEl);
    
    // 创建波形区域
    this.waveformEl = document.createElement('div');
    this.waveformEl.className = 'voice-overlay-waveform';
    this.createWaveformBars();
    this.contentEl.appendChild(this.waveformEl);
    
    // 创建状态文本区域
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'voice-overlay-status';
    this.contentEl.appendChild(this.statusEl);
    
    // 创建部分转录文本区域（实时模式）
    this.partialTextEl = document.createElement('div');
    this.partialTextEl.className = 'voice-overlay-partial-text';
    this.partialTextEl.style.display = 'none';
    this.contentEl.appendChild(this.partialTextEl);
    
    // 创建按钮区域（Toggle 模式）
    this.buttonsEl = document.createElement('div');
    this.buttonsEl.className = 'voice-overlay-buttons';
    this.createButtons();
    this.contentEl.appendChild(this.buttonsEl);
    
    // 添加到 body
    document.body.appendChild(this.containerEl);
  }

  /**
   * 创建波形柱状图
   */
  private createWaveformBars(): void {
    if (!this.waveformEl) {
      return;
    }
    
    this.waveformBars = [];
    
    for (let i = 0; i < this.config.waveformBars; i++) {
      const bar = document.createElement('div');
      bar.className = 'voice-overlay-waveform-bar';
      bar.style.height = '10%';
      this.waveformEl.appendChild(bar);
      this.waveformBars.push(bar);
    }
  }

  /**
   * 创建按钮
   */
  private createButtons(): void {
    if (!this.buttonsEl) {
      return;
    }
    
    // 取消按钮
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'voice-overlay-btn voice-overlay-btn-cancel';
    cancelBtn.innerHTML = this.getCancelIcon();
    cancelBtn.setAttribute('aria-label', t('voiceInput.cancel') || '取消');
    cancelBtn.addEventListener('click', () => {
      if (this.onCancel) {
        this.onCancel();
      }
    });
    this.buttonsEl.appendChild(cancelBtn);
    
    // 完成按钮
    const finishBtn = document.createElement('button');
    finishBtn.className = 'voice-overlay-btn voice-overlay-btn-finish';
    finishBtn.innerHTML = this.getFinishIcon();
    finishBtn.setAttribute('aria-label', t('voiceInput.finish') || '完成');
    finishBtn.addEventListener('click', () => {
      if (this.onFinish) {
        this.onFinish();
      }
    });
    this.buttonsEl.appendChild(finishBtn);
  }

  // ============================================================================
  // 私有方法 - 状态显示
  // ============================================================================

  /**
   * 更新容器类名
   */
  private updateContainerClass(state: OverlayState): void {
    if (!this.containerEl) {
      return;
    }
    
    // 移除所有状态类
    this.containerEl.classList.remove(
      'state-recording',
      'state-processing',
      'state-success',
      'state-error',
      'mode-press',
      'mode-toggle'
    );
    
    // 添加当前状态类
    this.containerEl.classList.add(`state-${state.type}`);
    
    // 如果是录音状态，添加模式类
    if (state.type === 'recording') {
      this.containerEl.classList.add(`mode-${state.mode}`);
    }
  }

  /**
   * 显示录音状态
   */
  private showRecordingState(mode: RecordingMode): void {
    // 显示波形
    if (this.waveformEl) {
      this.waveformEl.style.display = 'flex';
    }
    
    // 更新状态文本
    if (this.statusEl) {
      this.statusEl.textContent = t('voiceInput.recording') || '录音中...';
      this.statusEl.style.display = 'block';
    }
    
    // 清除之前的部分转录文本
    this.clearPartialText();
    
    // Toggle 模式显示按钮
    if (this.buttonsEl) {
      this.buttonsEl.style.display = mode === 'toggle' ? 'flex' : 'none';
    }
  }

  /**
   * 显示处理中状态
   */
  private showProcessingState(): void {
    // 隐藏波形
    if (this.waveformEl) {
      this.waveformEl.style.display = 'none';
    }
    
    // 隐藏部分转录文本
    if (this.partialTextEl) {
      this.partialTextEl.style.display = 'none';
    }
    
    // 更新状态文本（带动画）
    if (this.statusEl) {
      this.statusEl.innerHTML = `
        <div class="voice-overlay-processing">
          <div class="voice-overlay-spinner"></div>
          <span>${t('voiceInput.processing') || '处理中...'}</span>
        </div>
      `;
      this.statusEl.style.display = 'block';
    }
    
    // 隐藏按钮
    if (this.buttonsEl) {
      this.buttonsEl.style.display = 'none';
    }
  }

  /**
   * 显示成功状态
   */
  private showSuccessState(message?: string): void {
    // 隐藏波形
    if (this.waveformEl) {
      this.waveformEl.style.display = 'none';
    }
    
    // 更新状态文本
    if (this.statusEl) {
      this.statusEl.innerHTML = `
        <div class="voice-overlay-success">
          ${this.getSuccessIcon()}
          <span>${message || t('voiceInput.success') || '完成'}</span>
        </div>
      `;
      this.statusEl.style.display = 'block';
    }
    
    // 隐藏按钮
    if (this.buttonsEl) {
      this.buttonsEl.style.display = 'none';
    }
  }

  /**
   * 显示错误状态
   */
  private showErrorState(message: string): void {
    // 隐藏波形
    if (this.waveformEl) {
      this.waveformEl.style.display = 'none';
    }
    
    // 更新状态文本
    if (this.statusEl) {
      this.statusEl.innerHTML = `
        <div class="voice-overlay-error">
          ${this.getErrorIcon()}
          <span>${message}</span>
        </div>
      `;
      this.statusEl.style.display = 'block';
    }
    
    // 隐藏按钮
    if (this.buttonsEl) {
      this.buttonsEl.style.display = 'none';
    }
  }

  // ============================================================================
  // 私有方法 - 位置计算
  // ============================================================================

  /**
   * 更新悬浮窗位置
   */
  private updatePosition(): void {
    if (!this.containerEl) {
      return;
    }
    
    switch (this.config.position) {
      case 'cursor':
        this.positionAtCursor();
        break;
      case 'center':
        this.positionAtCenter();
        break;
      case 'top-right':
        this.positionAtTopRight();
        break;
      case 'bottom':
        this.positionAtBottom();
        break;
    }
  }

  /**
   * 定位到光标位置
   * 智能判断：如果有选区且光标在选区末尾，显示在光标下方；否则显示在光标上方
   */
  private positionAtCursor(): void {
    if (!this.containerEl) {
      return;
    }
    
    // 尝试获取编辑器光标的实际屏幕位置
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) {
      this.positionAtCenter();
      return;
    }
    
    const editor = view.editor;
    const cursor = editor.getCursor();
    
    // 判断悬浮窗应该显示在光标上方还是下方
    let showBelow = false;
    const selection = editor.getSelection();
    if (selection) {
      // 有选区时，判断光标位置
      const from = editor.getCursor('from');
      const to = editor.getCursor('to');
      
      // 如果光标在选区末尾（to 位置），说明选区在上方，悬浮窗应显示在下方
      if (cursor.line === to.line && cursor.ch === to.ch) {
        showBelow = true;
      }
    }
    
    // 使用 CodeMirror 6 的 coordsAtPos 获取光标的屏幕坐标
    // @ts-expect-error - 访问 CodeMirror 内部 API
    const cm = editor.cm;
    if (cm && cm.coordsAtPos) {
      try {
        const pos = editor.posToOffset(cursor);
        const coords = cm.coordsAtPos(pos);
        if (coords) {
          // 根据选区位置决定悬浮窗显示在上方还是下方
          const x = coords.left;
          const y = showBelow ? coords.bottom + 20 : coords.top - 60;
          
          // 确保不超出屏幕边界
          const overlayWidth = this.containerEl.offsetWidth || 200;
          const overlayHeight = this.containerEl.offsetHeight || 100;
          
          const finalX = Math.max(overlayWidth / 2, Math.min(window.innerWidth - overlayWidth / 2, x));
          const finalY = showBelow 
            ? Math.min(window.innerHeight - overlayHeight / 2 - 10, y)
            : Math.max(overlayHeight / 2 + 10, y);
          
          this.setPosition(finalX, finalY);
          return;
        }
      } catch (e) {
        debugLog('[VoiceOverlay] coordsAtPos 失败:', e);
      }
    }
    
    // 回退到屏幕中心
    this.positionAtCenter();
  }

  /**
   * 定位到屏幕中心
   */
  private positionAtCenter(): void {
    if (!this.containerEl) {
      return;
    }
    
    const x = window.innerWidth / 2;
    const y = window.innerHeight / 2;
    
    this.setPosition(x, y);
  }

  /**
   * 定位到右上角
   */
  private positionAtTopRight(): void {
    if (!this.containerEl) {
      return;
    }
    
    this.containerEl.style.left = 'auto';
    this.containerEl.style.right = '20px';
    this.containerEl.style.top = '20px';
    this.containerEl.style.transform = 'none';
  }

  /**
   * 定位到底部偏上
   */
  private positionAtBottom(): void {
    if (!this.containerEl) {
      return;
    }
    
    const x = window.innerWidth / 2;
    const y = window.innerHeight - 120; // 距离底部 120px
    
    this.setPosition(x, y);
  }

  // ============================================================================
  // 私有方法 - 工具函数
  // ============================================================================

  /**
   * 标准化波形数据
   * 将任意长度的数据转换为指定数量的柱状图数据
   */
  private normalizeWaveformData(levels: number[]): number[] {
    const targetLength = this.config.waveformBars;
    
    if (levels.length === 0) {
      return new Array(targetLength).fill(0);
    }
    
    if (levels.length === targetLength) {
      return levels;
    }
    
    // 重采样
    const result: number[] = [];
    const ratio = levels.length / targetLength;
    
    for (let i = 0; i < targetLength; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.floor((i + 1) * ratio);
      
      // 取区间内的平均值
      let sum = 0;
      let count = 0;
      for (let j = start; j < end && j < levels.length; j++) {
        sum += levels[j];
        count++;
      }
      
      result.push(count > 0 ? sum / count : 0);
    }
    
    return result;
  }

  /**
   * 清除隐藏定时器
   */
  private clearHideTimeout(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  /**
   * 安排自动隐藏
   */
  private scheduleHide(): void {
    this.clearHideTimeout();
    
    this.hideTimeout = setTimeout(() => {
      this.hide();
    }, this.config.statusDisplayDuration);
  }

  // ============================================================================
  // 私有方法 - 图标
  // ============================================================================

  /**
   * 获取取消图标
   */
  private getCancelIcon(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>`;
  }

  /**
   * 获取完成图标
   */
  private getFinishIcon(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>`;
  }

  /**
   * 获取成功图标
   */
  private getSuccessIcon(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="voice-overlay-icon-success">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
      <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>`;
  }

  /**
   * 获取错误图标
   */
  private getErrorIcon(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="voice-overlay-icon-error">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>`;
  }
}
