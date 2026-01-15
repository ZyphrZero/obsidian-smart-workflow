/**
 * TranslationModal - 翻译模态窗口
 * 显示翻译结果，支持语言选择、流式更新、复制和替换功能
 * 
 */

import type { App} from 'obsidian';
import { Modal, setIcon } from 'obsidian';
import type { TranslationService, TranslationOptions, TranslationStreamCallbacks } from '../../services/translation';
import type { LanguageCode} from '../../settings/types';
import { SUPPORTED_LANGUAGES } from '../../settings/types';
import type { SmartWorkflowSettings } from '../../settings/settings';
import { t, i18n } from '../../i18n';
import type { SelectionContext } from '../selection/types';
import { debugLog } from '../../utils/logger';

/**
 * 翻译模态窗口选项接口
 */
export interface TranslationModalOptions {
  /** 原始文本 */
  originalText: string;
  /** 选区信息（用于替换功能） */
  selectionContext: SelectionContext;
  /** 翻译服务实例 */
  translationService: TranslationService;
  /** 插件设置 */
  settings: SmartWorkflowSettings;
  /** 替换回调 */
  onReplace?: (translatedText: string) => void;
  /** 设置保存回调 */
  onSettingsSave?: () => Promise<void>;
}

/**
 * 翻译模态窗口类
 */
export class TranslationModal extends Modal {
  // 配置
  private options: TranslationModalOptions;
  
  // 状态
  private sourceLanguage: LanguageCode = 'auto';
  private targetLanguage: LanguageCode = 'zh-CN';
  private showOriginal: boolean = true;
  private isTranslating: boolean = false;
  private translatedText: string = '';
  private thinkingText: string = '';
  private showThinking: boolean = false;
  private detectedLanguage: LanguageCode | null = null;
  private error: string | null = null;
  
  // DOM 元素引用
  private contentContainer: HTMLElement | null = null;
  private originalSection: HTMLElement | null = null;
  private thinkingSection: HTMLElement | null = null;
  private translatedSection: HTMLElement | null = null;
  private translatedHeader: HTMLElement | null = null;
  private headerLoadingIndicator: HTMLElement | null = null;
  private headerCompleteIndicator: HTMLElement | null = null;
  private errorSection: HTMLElement | null = null;
  private actionButtons: HTMLElement | null = null;
  private sourceLanguageSelect: HTMLSelectElement | null = null;
  private targetLanguageSelect: HTMLSelectElement | null = null;
  private toggleOriginalBtn: HTMLButtonElement | null = null;
  private toggleThinkingBtn: HTMLButtonElement | null = null;

  constructor(app: App, options: TranslationModalOptions) {
    super(app);
    this.options = options;
    
    // 初始化默认值
    const translationSettings = options.settings.translation;
    this.targetLanguage = (translationSettings?.rememberLastTargetLanguage && translationSettings?.lastTargetLanguage
      ? translationSettings.lastTargetLanguage
      : translationSettings?.defaultTargetLanguage || 'zh-CN') as LanguageCode;
    this.showOriginal = translationSettings?.showOriginalByDefault ?? true;
  }

  /**
   * 模态窗口打开时调用
   */
  onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();
    
    // 设置模态窗口样式
    modalEl.addClass('translation-modal');
    modalEl.style.width = '600px';
    modalEl.style.maxWidth = '90vw';
    modalEl.style.maxHeight = '80vh';
    
    // 渲染内容
    this.renderContent();
    
    // 自动开始翻译
    this.startTranslation();
  }

  /**
   * 模态窗口关闭时调用
   */
  onClose(): void {
    // 取消正在进行的翻译
    this.options.translationService.cancelTranslation();
    
    // 清理 DOM
    const { contentEl } = this;
    contentEl.empty();
    
    // 清理引用
    this.contentContainer = null;
    this.originalSection = null;
    this.thinkingSection = null;
    this.translatedSection = null;
    this.translatedHeader = null;
    this.headerLoadingIndicator = null;
    this.headerCompleteIndicator = null;
    this.errorSection = null;
    this.actionButtons = null;
    this.sourceLanguageSelect = null;
    this.targetLanguageSelect = null;
    this.toggleOriginalBtn = null;
    this.toggleThinkingBtn = null;
  }

  /**
   * 渲染模态窗口内容
   */
  private renderContent(): void {
    const { contentEl } = this;
    
    // 创建主容器
    this.contentContainer = contentEl.createDiv({ cls: 'translation-modal-content' });
    
    // 1. 渲染语言选择器
    this.renderLanguageSelectors();
    
    // 2. 渲染原文区域（可折叠）
    this.renderOriginalSection();
    
    // 3. 渲染译文区域（包含思考内容）
    this.renderTranslatedSection();
    
    // 4. 渲染错误区域
    this.renderErrorSection();
    
    // 5. 渲染操作按钮
    this.renderActionButtons();
  }

  /**
   * 渲染语言选择器
   */
  private renderLanguageSelectors(): void {
    if (!this.contentContainer) return;
    
    const selectorContainer = this.contentContainer.createDiv({ cls: 'translation-language-selectors' });
    
    // 源语言选择器
    const sourceGroup = selectorContainer.createDiv({ cls: 'translation-language-group' });
    sourceGroup.createEl('label', { 
      text: t('translation.modal.sourceLanguage'),
      cls: 'translation-language-label'
    });
    
    this.sourceLanguageSelect = sourceGroup.createEl('select', { cls: 'translation-language-select' });
    this.populateLanguageOptions(this.sourceLanguageSelect, true);
    this.sourceLanguageSelect.value = this.sourceLanguage;
    this.sourceLanguageSelect.addEventListener('change', () => this.handleSourceLanguageChange());
    
    // 箭头图标
    const arrowIcon = selectorContainer.createDiv({ cls: 'translation-arrow-icon' });
    setIcon(arrowIcon, 'arrow-right');
    
    // 目标语言选择器
    const targetGroup = selectorContainer.createDiv({ cls: 'translation-language-group' });
    targetGroup.createEl('label', { 
      text: t('translation.modal.targetLanguage'),
      cls: 'translation-language-label'
    });
    
    this.targetLanguageSelect = targetGroup.createEl('select', { cls: 'translation-language-select' });
    this.populateLanguageOptions(this.targetLanguageSelect, false);
    this.targetLanguageSelect.value = this.targetLanguage;
    this.targetLanguageSelect.addEventListener('change', () => this.handleTargetLanguageChange());
  }

  /**
   * 填充语言选项
   */
  private populateLanguageOptions(select: HTMLSelectElement, includeAuto: boolean): void {
    const isZhUI = i18n.getLocale() === 'zh-CN';
    
    Object.entries(SUPPORTED_LANGUAGES).forEach(([code, info]) => {
      // 跳过 auto 选项（如果不需要）
      if (code === 'auto' && !includeAuto) return;
      
      const option = select.createEl('option', {
        value: code,
        text: isZhUI ? info.nameZh : info.name
      });
      select.appendChild(option);
    });
  }

  /**
   * 渲染原文区域
   */
  private renderOriginalSection(): void {
    if (!this.contentContainer) return;
    
    this.originalSection = this.contentContainer.createDiv({ 
      cls: `translation-original-section ${this.showOriginal ? '' : 'collapsed'}`
    });
    
    // 原文标题栏
    const header = this.originalSection.createDiv({ cls: 'translation-section-header' });
    header.createEl('span', { 
      text: t('translation.modal.originalText'),
      cls: 'translation-section-title'
    });
    
    // 显示/隐藏切换按钮
    this.toggleOriginalBtn = header.createEl('button', { 
      cls: 'translation-toggle-btn clickable-icon',
      attr: { 'aria-label': this.showOriginal ? t('translation.modal.hideOriginal') : t('translation.modal.showOriginal') }
    });
    setIcon(this.toggleOriginalBtn, this.showOriginal ? 'chevron-up' : 'chevron-down');
    this.toggleOriginalBtn.addEventListener('click', () => this.toggleOriginalVisibility());
    
    // 原文内容
    const content = this.originalSection.createDiv({ cls: 'translation-original-content' });
    content.createEl('pre', { 
      text: this.options.originalText,
      cls: 'translation-text-display'
    });
  }

  /**
   * 渲染译文区域
   */
  private renderTranslatedSection(): void {
    if (!this.contentContainer) return;
    
    this.translatedSection = this.contentContainer.createDiv({ cls: 'translation-translated-section' });
    
    // 译文标题
    this.translatedHeader = this.translatedSection.createDiv({ cls: 'translation-section-header' });
    this.translatedHeader.createEl('span', { 
      text: t('translation.modal.translatedText'),
      cls: 'translation-section-title'
    });
    
    // 加载指示器（在标题栏内）
    this.headerLoadingIndicator = this.translatedHeader.createDiv({ 
      cls: `translation-header-loading ${this.isTranslating ? '' : 'hidden'}`
    });
    const spinner = this.headerLoadingIndicator.createDiv({ cls: 'translation-spinner' });
    setIcon(spinner, 'loader');
    this.headerLoadingIndicator.createEl('span', { 
      text: t('translation.modal.translating'),
      cls: 'translation-loading-text'
    });
    
    // 完成指示器（在标题栏内，默认隐藏）
    this.headerCompleteIndicator = this.translatedHeader.createDiv({ 
      cls: 'translation-header-complete hidden'
    });
    const checkIcon = this.headerCompleteIndicator.createDiv({ cls: 'translation-complete-icon' });
    setIcon(checkIcon, 'check');
    this.headerCompleteIndicator.createEl('span', { 
      text: t('translation.modal.completed'),
      cls: 'translation-complete-text'
    });
    
    // 检测到的语言显示
    if (this.detectedLanguage && this.sourceLanguage === 'auto') {
      const langInfo = SUPPORTED_LANGUAGES[this.detectedLanguage];
      const isZhUI = i18n.getLocale() === 'zh-CN';
      const langName = langInfo ? (isZhUI ? langInfo.nameZh : langInfo.name) : this.detectedLanguage;
      this.translatedHeader.createEl('span', { 
        text: `(${t('translation.modal.detectedAs')} ${langName})`,
        cls: 'translation-detected-language'
      });
    }
    
    // 译文内容容器
    const contentWrapper = this.translatedSection.createDiv({ cls: 'translation-translated-content' });
    
    // 思考内容区域（在译文内容内部，默认隐藏）
    this.renderThinkingSection(contentWrapper);
    
    // 译文内容
    contentWrapper.createEl('pre', { 
      text: this.translatedText || '',
      cls: 'translation-text-display translation-result'
    });
  }

  /**
   * 渲染思考内容区域（思考模型专用，在译文内容内部）
   */
  private renderThinkingSection(container: HTMLElement): void {
    // 默认隐藏，只有收到思考内容时才显示
    this.thinkingSection = container.createDiv({ 
      cls: `translation-thinking-section hidden`
    });
    
    // 思考标题栏
    const header = this.thinkingSection.createDiv({ cls: 'translation-thinking-header' });
    header.createEl('span', { 
      text: t('translation.modal.thinkingProcess'),
      cls: 'translation-thinking-title'
    });
    
    // 显示/隐藏切换按钮
    this.toggleThinkingBtn = header.createEl('button', { 
      cls: 'translation-toggle-btn clickable-icon',
      attr: { 'aria-label': this.showThinking ? t('translation.modal.hideThinking') : t('translation.modal.showThinking') }
    });
    setIcon(this.toggleThinkingBtn, this.showThinking ? 'chevron-up' : 'chevron-down');
    this.toggleThinkingBtn.addEventListener('click', () => this.toggleThinkingVisibility());
    
    // 思考内容
    const content = this.thinkingSection.createDiv({ cls: 'translation-thinking-content' });
    content.createEl('pre', { 
      text: '',
      cls: 'translation-text-display translation-thinking-result'
    });
  }

  /**
   * 渲染错误区域
   */
  private renderErrorSection(): void {
    if (!this.contentContainer) return;
    
    this.errorSection = this.contentContainer.createDiv({ 
      cls: `translation-error ${this.error ? '' : 'hidden'}`
    });
    
    const errorIcon = this.errorSection.createDiv({ cls: 'translation-error-icon' });
    setIcon(errorIcon, 'alert-circle');
    
    this.errorSection.createEl('span', { 
      text: this.error || '',
      cls: 'translation-error-text'
    });
  }

  /**
   * 渲染操作按钮
   */
  private renderActionButtons(): void {
    if (!this.contentContainer) return;
    
    this.actionButtons = this.contentContainer.createDiv({ cls: 'translation-action-buttons' });
    
    // 重试按钮
    const retryBtn = this.actionButtons.createEl('button', { 
      cls: 'translation-btn translation-btn-retry',
      text: t('translation.modal.retry')
    });
    setIcon(retryBtn.createSpan({ cls: 'translation-btn-icon' }), 'refresh-cw');
    retryBtn.addEventListener('click', () => this.handleRetry());
    
    // 复制按钮
    const copyBtn = this.actionButtons.createEl('button', { 
      cls: 'translation-btn translation-btn-copy',
      text: t('translation.modal.copy')
    });
    setIcon(copyBtn.createSpan({ cls: 'translation-btn-icon' }), 'copy');
    copyBtn.addEventListener('click', () => this.handleCopy());
    
    // 替换按钮
    const replaceBtn = this.actionButtons.createEl('button', { 
      cls: 'translation-btn translation-btn-replace mod-cta',
      text: t('translation.modal.replace')
    });
    setIcon(replaceBtn.createSpan({ cls: 'translation-btn-icon' }), 'replace');
    replaceBtn.addEventListener('click', () => this.handleReplace());
  }

  /**
   * 开始翻译
   */
  async startTranslation(): Promise<void> {
    // 重置状态
    this.isTranslating = true;
    this.translatedText = '';
    this.thinkingText = '';
    this.error = null;
    this.detectedLanguage = null;
    
    // 更新 UI
    this.updateLoadingState(true, false);
    this.updateErrorState(null);
    this.updateTranslatedContent('');
    this.updateThinkingContent('');
    this.hideThinkingSection();
    
    const options: TranslationOptions = {
      text: this.options.originalText,
      sourceLanguage: this.sourceLanguage,
      targetLanguage: this.targetLanguage,
    };
    
    const callbacks: TranslationStreamCallbacks = {
      onStart: () => {
        debugLog('[TranslationModal] 翻译开始');
      },
      onChunk: (chunk: string) => {
        this.translatedText += chunk;
        this.updateTranslatedContent(this.translatedText);
      },
      onThinking: (chunk: string) => {
        this.thinkingText += chunk;
        this.showThinkingSection();
        this.updateThinkingContent(this.thinkingText);
      },
      onDetectedLanguage: (language: LanguageCode) => {
        this.detectedLanguage = language;
        this.updateDetectedLanguageDisplay();
      },
      onComplete: (fullText: string) => {
        this.translatedText = fullText;
        this.isTranslating = false;
        this.updateLoadingState(false, true);
        this.updateTranslatedContent(fullText);
        debugLog('[TranslationModal] 翻译完成');
        
        // 保存上次使用的目标语言
        this.saveLastTargetLanguage();
      },
      onError: (error: Error) => {
        this.isTranslating = false;
        this.error = error.message;
        this.updateLoadingState(false, false);
        this.updateErrorState(error.message);
        debugLog(`[TranslationModal] 翻译错误: ${error.message}`);
      },
    };
    
    await this.options.translationService.translateStream(options, callbacks);
  }

  /**
   * 处理源语言变更
   */
  private handleSourceLanguageChange(): void {
    if (!this.sourceLanguageSelect) return;
    
    this.sourceLanguage = this.sourceLanguageSelect.value as LanguageCode;
    debugLog(`[TranslationModal] 源语言变更为: ${this.sourceLanguage}`);
    
    // 重新翻译
    this.startTranslation();
  }

  /**
   * 处理目标语言变更
   */
  private handleTargetLanguageChange(): void {
    if (!this.targetLanguageSelect) return;
    
    this.targetLanguage = this.targetLanguageSelect.value as LanguageCode;
    debugLog(`[TranslationModal] 目标语言变更为: ${this.targetLanguage}`);
    
    // 重新翻译
    this.startTranslation();
  }

  /**
   * 切换原文显示/隐藏
   */
  private toggleOriginalVisibility(): void {
    this.showOriginal = !this.showOriginal;
    
    if (this.originalSection) {
      this.originalSection.toggleClass('collapsed', !this.showOriginal);
    }
    
    if (this.toggleOriginalBtn) {
      setIcon(this.toggleOriginalBtn, this.showOriginal ? 'chevron-up' : 'chevron-down');
      this.toggleOriginalBtn.setAttribute('aria-label', 
        this.showOriginal ? t('translation.modal.hideOriginal') : t('translation.modal.showOriginal')
      );
    }
  }

  /**
   * 切换思考内容显示/隐藏
   */
  private toggleThinkingVisibility(): void {
    this.showThinking = !this.showThinking;
    
    if (this.thinkingSection) {
      this.thinkingSection.toggleClass('collapsed', !this.showThinking);
    }
    
    if (this.toggleThinkingBtn) {
      setIcon(this.toggleThinkingBtn, this.showThinking ? 'chevron-up' : 'chevron-down');
      this.toggleThinkingBtn.setAttribute('aria-label', 
        this.showThinking ? t('translation.modal.hideThinking') : t('translation.modal.showThinking')
      );
    }
  }

  /**
   * 显示思考内容区域
   */
  private showThinkingSection(): void {
    if (this.thinkingSection) {
      this.thinkingSection.removeClass('hidden');
      // 默认展开显示
      if (!this.showThinking) {
        this.showThinking = true;
        this.thinkingSection.removeClass('collapsed');
        if (this.toggleThinkingBtn) {
          setIcon(this.toggleThinkingBtn, 'chevron-up');
        }
      }
    }
  }

  /**
   * 隐藏思考内容区域
   */
  private hideThinkingSection(): void {
    if (this.thinkingSection) {
      this.thinkingSection.addClass('hidden');
    }
  }

  /**
   * 更新思考内容
   */
  private updateThinkingContent(text: string): void {
    if (this.thinkingSection) {
      const content = this.thinkingSection.querySelector('.translation-thinking-result');
      if (content) {
        content.textContent = text;
        // 流式更新时添加光标动画类
        if (this.isTranslating && text.length > 0) {
          content.addClass('streaming');
        } else {
          content.removeClass('streaming');
        }
      }
    }
  }

  /**
   * 处理复制操作
   */
  private async handleCopy(): Promise<void> {
    if (!this.translatedText) return;
    
    try {
      await navigator.clipboard.writeText(this.translatedText);
      debugLog('[TranslationModal] 译文已复制到剪贴板');
      // 可以添加一个简短的成功提示
    } catch (error) {
      debugLog(`[TranslationModal] 复制失败: ${error}`);
    }
  }

  /**
   * 处理替换操作
   */
  private handleReplace(): void {
    if (!this.translatedText || !this.options.onReplace) return;
    
    this.options.onReplace(this.translatedText);
    this.close();
  }

  /**
   * 处理重试操作
   */
  private handleRetry(): void {
    this.startTranslation();
  }

  /**
   * 更新加载状态
   */
  private updateLoadingState(isLoading: boolean, isComplete: boolean = false): void {
    if (this.headerLoadingIndicator) {
      this.headerLoadingIndicator.toggleClass('hidden', !isLoading);
    }
    if (this.headerCompleteIndicator) {
      this.headerCompleteIndicator.toggleClass('hidden', !isComplete);
    }
  }

  /**
   * 更新错误状态
   */
  private updateErrorState(errorMessage: string | null): void {
    if (this.errorSection) {
      this.errorSection.toggleClass('hidden', !errorMessage);
      const errorText = this.errorSection.querySelector('.translation-error-text');
      if (errorText) {
        errorText.textContent = errorMessage || '';
      }
    }
  }

  /**
   * 更新译文内容
   */
  private updateTranslatedContent(text: string): void {
    if (this.translatedSection) {
      const content = this.translatedSection.querySelector('.translation-result');
      if (content) {
        content.textContent = text;
        // 流式更新时添加光标动画类
        if (this.isTranslating && text.length > 0) {
          content.addClass('streaming');
        } else {
          content.removeClass('streaming');
        }
      }
    }
  }

  /**
   * 更新检测到的语言显示
   */
  private updateDetectedLanguageDisplay(): void {
    if (!this.translatedHeader || !this.detectedLanguage) return;
    
    // 移除旧的检测语言显示
    const oldDetected = this.translatedHeader.querySelector('.translation-detected-language');
    if (oldDetected) {
      oldDetected.remove();
    }
    
    // 添加新的检测语言显示
    if (this.sourceLanguage === 'auto') {
      const langInfo = SUPPORTED_LANGUAGES[this.detectedLanguage];
      const isZhUI = i18n.getLocale() === 'zh-CN';
      const langName = langInfo ? (isZhUI ? langInfo.nameZh : langInfo.name) : this.detectedLanguage;
      this.translatedHeader.createEl('span', { 
        text: `(${t('translation.modal.detectedAs')} ${langName})`,
        cls: 'translation-detected-language'
      });
    }
  }

  /**
   * 保存上次使用的目标语言
   */
  private async saveLastTargetLanguage(): Promise<void> {
    const translationSettings = this.options.settings.translation;
    if (translationSettings?.rememberLastTargetLanguage) {
      translationSettings.lastTargetLanguage = this.targetLanguage;
      if (this.options.onSettingsSave) {
        await this.options.onSettingsSave();
      }
    }
  }
}

export default TranslationModal;
