/**
 * VoiceErrorHandler - 语音服务错误处理器
 * 
 * 职责:
 * 1. 统一处理语音服务相关的错误
 * 2. 显示用户友好的错误通知
 * 3. 提供 LLM 失败时的原始文本回退选项
 * 

 */

import type { App} from 'obsidian';
import { Modal, Setting, Notice } from 'obsidian';
import { t } from '../../i18n';
import { debugLog, errorLog } from '../../utils/logger';
import { 
  VoiceServerError, 
  VoiceErrorCode, 
  LLMProcessingError 
} from './types';

/**
 * 错误处理结果
 */
export interface ErrorHandleResult {
  /** 是否已处理 */
  handled: boolean;
  /** 用户选择的操作 */
  action?: 'retry' | 'use_raw_text' | 'cancel';
  /** 原始文本（如果有） */
  rawText?: string;
}

/**
 * LLM 失败回退对话框
 * 当 LLM 处理失败时，让用户选择是否使用原始转录文本
 */
class LLMFallbackModal extends Modal {
  private rawText: string;
  private errorMessage: string;
  private onResult: (result: 'use_raw_text' | 'retry' | 'cancel') => void;
  private resolved = false;

  constructor(
    app: App, 
    rawText: string, 
    errorMessage: string,
    onResult: (result: 'use_raw_text' | 'retry' | 'cancel') => void
  ) {
    super(app);
    this.rawText = rawText;
    this.errorMessage = errorMessage;
    this.onResult = onResult;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // 设置弹窗宽度
    this.modalEl.style.width = '500px';
    this.modalEl.style.maxWidth = '90vw';

    // 标题
    new Setting(contentEl)
      .setName(t('voiceError.llmFailed.title') || 'LLM 处理失败')
      .setHeading();

    // 错误信息
    const errorEl = contentEl.createDiv({ cls: 'voice-error-message' });
    errorEl.style.marginBottom = '16px';
    errorEl.style.padding = '12px';
    errorEl.style.backgroundColor = 'var(--background-modifier-error)';
    errorEl.style.borderRadius = '4px';
    errorEl.style.color = 'var(--text-error)';
    errorEl.createEl('div', { 
      text: `❌ ${this.errorMessage}`,
      cls: 'voice-error-text'
    });

    // 原始文本预览
    const previewEl = contentEl.createDiv({ cls: 'voice-raw-text-preview' });
    previewEl.style.marginBottom = '16px';
    
    previewEl.createEl('div', { 
      text: t('voiceError.llmFailed.rawTextLabel') || '原始转录文本：',
      cls: 'setting-item-name'
    }).style.marginBottom = '8px';
    
    const textPreview = previewEl.createEl('div', { 
      cls: 'voice-raw-text-content'
    });
    textPreview.style.padding = '12px';
    textPreview.style.backgroundColor = 'var(--background-secondary)';
    textPreview.style.borderRadius = '4px';
    textPreview.style.fontFamily = 'var(--font-monospace)';
    textPreview.style.maxHeight = '150px';
    textPreview.style.overflow = 'auto';
    textPreview.style.whiteSpace = 'pre-wrap';
    textPreview.style.wordBreak = 'break-word';
    textPreview.textContent = this.rawText;

    // 提示信息
    const hintEl = contentEl.createDiv({ cls: 'voice-error-hint' });
    hintEl.style.marginBottom = '16px';
    hintEl.style.color = 'var(--text-muted)';
    hintEl.style.fontSize = '0.9em';
    hintEl.textContent = t('voiceError.llmFailed.hint') || 
      '您可以选择使用原始转录文本，或者取消操作。';

    // 按钮容器
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'flex-end';
    buttonContainer.style.gap = '8px';

    // 取消按钮
    const cancelButton = buttonContainer.createEl('button', { 
      text: t('common.cancel') || '取消' 
    });
    cancelButton.addEventListener('click', () => {
      this.resolved = true;
      this.onResult('cancel');
      this.close();
    });

    // 重试按钮
    const retryButton = buttonContainer.createEl('button', { 
      text: t('voiceError.llmFailed.retry') || '重试' 
    });
    retryButton.addEventListener('click', () => {
      this.resolved = true;
      this.onResult('retry');
      this.close();
    });

    // 使用原始文本按钮
    const useRawButton = buttonContainer.createEl('button', {
      text: t('voiceError.llmFailed.useRawText') || '使用原始文本',
      cls: 'mod-cta'
    });
    useRawButton.addEventListener('click', () => {
      this.resolved = true;
      this.onResult('use_raw_text');
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    // 如果未通过按钮关闭，视为取消
    if (!this.resolved) {
      this.onResult('cancel');
    }
  }
}

/**
 * VoiceErrorHandler
 * 
 * 语音服务错误处理器
 */
export class VoiceErrorHandler {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  // ============================================================================
  // 公共方法
  // ============================================================================

  /**
   * 处理语音服务错误
   * 根据错误类型显示适当的通知
   * 
   * @param error 错误对象
   * @returns 错误处理结果
   */
  async handleError(error: Error): Promise<ErrorHandleResult> {
    debugLog('[VoiceErrorHandler] 处理错误:', error.name, error.message);

    // 处理 LLM 处理错误（特殊处理，提供回退选项）
    if (error instanceof LLMProcessingError) {
      return await this.handleLLMProcessingError(error);
    }

    // 处理语音服务器错误
    if (error instanceof VoiceServerError) {
      return this.handleVoiceServerError(error);
    }

    // 处理通用错误
    return this.handleGenericError(error);
  }

  /**
   * 显示错误通知
   * 
   * @param message 错误消息
   * @param duration 显示时长（毫秒），0 表示不自动关闭
   */
  showErrorNotice(message: string, duration = 8000): void {
    new Notice(`❌ ${message}`, duration);
  }

  /**
   * 显示警告通知
   * 
   * @param message 警告消息
   * @param duration 显示时长（毫秒）
   */
  showWarningNotice(message: string, duration = 6000): void {
    new Notice(`⚠️ ${message}`, duration);
  }

  /**
   * 显示成功通知
   * 
   * @param message 成功消息
   * @param duration 显示时长（毫秒）
   */
  showSuccessNotice(message: string, duration = 4000): void {
    new Notice(`✅ ${message}`, duration);
  }

  // ============================================================================
  // 私有方法 - 错误处理
  // ============================================================================

  /**
   * 处理 LLM 处理错误
   * 显示对话框让用户选择是否使用原始文本
   */
  private async handleLLMProcessingError(error: LLMProcessingError): Promise<ErrorHandleResult> {
    debugLog('[VoiceErrorHandler] 处理 LLM 处理错误');

    return new Promise((resolve) => {
      const modal = new LLMFallbackModal(
        this.app,
        error.rawText,
        error.message,
        (result) => {
          switch (result) {
            case 'use_raw_text':
              debugLog('[VoiceErrorHandler] 用户选择使用原始文本');
              resolve({
                handled: true,
                action: 'use_raw_text',
                rawText: error.rawText,
              });
              break;
            case 'retry':
              debugLog('[VoiceErrorHandler] 用户选择重试');
              resolve({
                handled: true,
                action: 'retry',
                rawText: error.rawText,
              });
              break;
            case 'cancel':
            default:
              debugLog('[VoiceErrorHandler] 用户取消操作');
              resolve({
                handled: true,
                action: 'cancel',
              });
              break;
          }
        }
      );
      modal.open();
    });
  }

  /**
   * 处理语音服务器错误
   */
  private handleVoiceServerError(error: VoiceServerError): ErrorHandleResult {
    const message = this.getVoiceErrorMessage(error.code, error.message);
    
    // 根据错误类型决定通知时长
    const duration = this.getErrorNoticeDuration(error.code);
    
    this.showErrorNotice(message, duration);
    errorLog('[VoiceErrorHandler] 语音服务器错误:', error.code, error.message);

    return {
      handled: true,
      action: 'cancel',
    };
  }

  /**
   * 处理通用错误
   */
  private handleGenericError(error: Error): ErrorHandleResult {
    const message = error.message || t('voiceError.unknown') || '未知错误';
    this.showErrorNotice(message);
    errorLog('[VoiceErrorHandler] 通用错误:', error);

    return {
      handled: true,
      action: 'cancel',
    };
  }

  // ============================================================================
  // 私有方法 - 辅助函数
  // ============================================================================

  /**
   * 获取语音错误的用户友好消息
   */
  private getVoiceErrorMessage(code: VoiceErrorCode, defaultMessage: string): string {
    const messageKey = `voiceError.${code}`;
    const translatedMessage = t(messageKey as keyof typeof t);
    
    // 如果有翻译，使用翻译；否则使用默认消息
    if (translatedMessage && translatedMessage !== messageKey) {
      return translatedMessage;
    }

    // 根据错误码返回默认消息
    switch (code) {
      case VoiceErrorCode.MICROPHONE_UNAVAILABLE:
        return t('voiceError.microphoneUnavailable') || '麦克风不可用，请检查麦克风设置';
      case VoiceErrorCode.PERMISSION_DENIED:
        return t('voiceError.permissionDenied') || '麦克风权限被拒绝，请在系统设置中允许访问';
      case VoiceErrorCode.DEVICE_ERROR:
        return t('voiceError.deviceError') || '音频设备错误';
      case VoiceErrorCode.ALREADY_RECORDING:
        return t('voiceError.alreadyRecording') || '已在录音中';
      case VoiceErrorCode.ASR_NETWORK_ERROR:
        return t('voiceError.asrNetworkError') || 'ASR 网络错误，请检查网络连接';
      case VoiceErrorCode.ASR_AUTH_FAILED:
        return t('voiceError.asrAuthFailed') || 'ASR 认证失败，请检查 API Key';
      case VoiceErrorCode.ASR_QUOTA_EXCEEDED:
        return t('voiceError.asrQuotaExceeded') || 'ASR 配额已用尽，请检查账户余额';
      case VoiceErrorCode.ASR_INVALID_AUDIO:
        return t('voiceError.asrInvalidAudio') || '音频格式无效';
      case VoiceErrorCode.ASR_TIMEOUT:
        return t('voiceError.asrTimeout') || 'ASR 请求超时';
      case VoiceErrorCode.ASR_ALL_FAILED:
        return t('voiceError.asrAllFailed') || '所有 ASR 引擎均失败';
      case VoiceErrorCode.SERVER_NOT_RUNNING:
        return t('voiceError.serverNotRunning') || '语音服务器未运行';
      case VoiceErrorCode.CONNECTION_LOST:
        return t('voiceError.connectionLost') || '连接丢失';
      case VoiceErrorCode.INVALID_MESSAGE:
        return t('voiceError.invalidMessage') || '无效的消息格式';
      default:
        return defaultMessage;
    }
  }

  /**
   * 获取错误通知的显示时长
   */
  private getErrorNoticeDuration(code: VoiceErrorCode): number {
    // 严重错误显示更长时间
    switch (code) {
      case VoiceErrorCode.PERMISSION_DENIED:
      case VoiceErrorCode.ASR_AUTH_FAILED:
      case VoiceErrorCode.ASR_QUOTA_EXCEEDED:
      case VoiceErrorCode.ASR_ALL_FAILED:
        return 0; // 不自动关闭
      case VoiceErrorCode.MICROPHONE_UNAVAILABLE:
      case VoiceErrorCode.SERVER_NOT_RUNNING:
        return 10000;
      default:
        return 8000;
    }
  }
}

/**
 * 类型守卫：检查是否为 VoiceServerError
 */
export function isVoiceServerError(error: unknown): error is VoiceServerError {
  return error instanceof VoiceServerError;
}

/**
 * 类型守卫：检查是否为 LLMProcessingError
 */
export function isLLMProcessingError(error: unknown): error is LLMProcessingError {
  return error instanceof LLMProcessingError;
}

/**
 * 获取错误的用户友好消息
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof VoiceServerError) {
    return error.message;
  }
  if (error instanceof LLMProcessingError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
