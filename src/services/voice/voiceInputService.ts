/**
 * VoiceInputService - 语音输入主服务
 * 
 * 重构后的版本：使用统一的 ServerManager 和 VoiceClient
 * 
 * 职责:
 * 1. 使用 VoiceClient 与统一服务器通信
 * 2. 协调录音、ASR 转录、LLM 后处理和文本插入
 * 3. 提供听写模式和助手模式的完整流程
 * 4. 发射事件供 UI 组件订阅
 * 
 */

import { App, MarkdownView } from 'obsidian';
import { debugLog, errorLog } from '../../utils/logger';
import { t } from '../../i18n';
import { ServerManager } from '../server/serverManager';
import { VoiceClient } from '../server/voiceClient';
import { ConfigManager } from '../config/configManager';
import {
  IVoiceInputService,
  VoiceInputMode,
  RecordingMode,
  ASRConfig,
  VoiceServiceEvents,
  VoiceServerError,
  VoiceErrorCode,
  TranscriptionCompleteMessage,
  LLMProcessingError,
} from './types';
import { VoiceSettings } from '../../settings/settings';

/**
 * 听写结果
 */
export interface DictationResult {
  /** 原始 ASR 转录文本 */
  originalText: string;
  /** LLM 处理后的文本（如果启用了后处理） */
  processedText: string;
  /** 是否使用了 LLM 后处理 */
  usedLLMProcessing: boolean;
  /** 使用的 ASR 引擎 */
  asrEngine: string;
  /** 是否使用了兜底引擎 */
  usedFallback: boolean;
  /** 录音时长 (ms) */
  duration: number;
  /** ASR 处理耗时 (ms) */
  asrDuration?: number;
  /** LLM 处理耗时 (ms) */
  llmDuration?: number;
}


/**
 * 助手模式结果
 */
export interface AssistantResult {
  /** 语音命令（ASR 转录结果） */
  voiceCommand: string;
  /** 选中的文本（如果有） */
  selectedText: string | null;
  /** 助手模式类型 */
  mode: 'qa' | 'text_processing';
  /** LLM 响应（如果有） */
  response: string | null;
  /** 使用的 ASR 引擎 */
  asrEngine: string;
  /** 是否使用了兜底引擎 */
  usedFallback: boolean;
  /** 录音时长 (ms) */
  duration: number;
  /** ASR 处理耗时 (ms) */
  asrDuration?: number;
  /** LLM 处理耗时 (ms) */
  llmDuration?: number;
}

/**
 * LLM 后处理器接口
 * 用于依赖注入，方便测试和解耦
 */
export interface ILLMPostProcessor {
  process(text: string, systemPrompt: string): Promise<string>;
}

/**
 * 文本插入器接口
 * 用于依赖注入，方便测试和解耦
 */
export interface ITextInserterService {
  insertAtCursor(text: string): Promise<boolean>;
  replaceSelection(text: string): Promise<boolean>;
  hasActiveEditor(): boolean;
}

/**
 * 事件监听器类型
 */
type EventListener<K extends keyof VoiceServiceEvents> = VoiceServiceEvents[K];


/**
 * VoiceInputService
 * 
 * 语音输入主服务，使用 ServerManager 和 VoiceClient 与统一服务器通信
 * 
 */
export class VoiceInputService implements IVoiceInputService {
  private app: App;
  private settings: VoiceSettings;
  private serverManager: ServerManager;
  private configManager: ConfigManager;
  
  /** VoiceClient 实例 */
  private voiceClient: VoiceClient | null = null;
  
  /** 事件取消订阅函数 */
  private eventUnsubscribers: (() => void)[] = [];
  
  // 可选依赖（用于完整流程）
  private llmPostProcessor: ILLMPostProcessor | null = null;
  private textInserter: ITextInserterService | null = null;
  
  // 录音状态
  private _isRecording = false;
  private _currentMode: VoiceInputMode | null = null;
  private _recordingMode: RecordingMode = 'press';
  
  // 助手模式上下文
  private selectedText: string | null = null;
  
  // 转录结果缓存
  private lastTranscription: TranscriptionCompleteMessage | null = null;
  private lastDictationResult: DictationResult | null = null;
  
  // 事件监听器
  private eventListeners: Map<keyof VoiceServiceEvents, Set<EventListener<keyof VoiceServiceEvents>>> = new Map();
  
  // 服务状态
  private isInitialized = false;
  private isDestroyed = false;

  constructor(
    app: App,
    settings: VoiceSettings,
    serverManager: ServerManager,
    configManager: ConfigManager
  ) {
    this.app = app;
    this.settings = settings;
    this.serverManager = serverManager;
    this.configManager = configManager;
    this._recordingMode = settings.defaultRecordingMode;
  }


  // ============================================================================
  // 生命周期方法
  // ============================================================================

  /**
   * 初始化服务
   * 确保统一服务器运行并获取 VoiceClient
   */
  async initialize(): Promise<void> {
    if (this.isInitialized || this.isDestroyed) {
      return;
    }

    try {
      debugLog('[VoiceInputService] 初始化服务...');
      
      // 确保统一服务器运行
      await this.serverManager.ensureServer();
      
      // 获取 VoiceClient 并设置事件监听
      this.voiceClient = this.serverManager.voice();
      this.setupVoiceClientEvents();
      
      this.isInitialized = true;
      debugLog('[VoiceInputService] 服务初始化完成');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorLog('[VoiceInputService] 初始化失败:', errorMessage);
      throw error;
    }
  }

  /**
   * 设置 VoiceClient 事件监听
   */
  private setupVoiceClientEvents(): void {
    if (!this.voiceClient) {
      return;
    }
    
    // 录音状态事件
    this.eventUnsubscribers.push(
      this.voiceClient.onRecordingState((state) => {
        this.handleRecordingState(state);
      })
    );
    
    // 音频级别事件
    this.eventUnsubscribers.push(
      this.voiceClient.onAudioLevel((level, waveform) => {
        this.emit('audio-level', level, waveform);
      })
    );
    
    // 转录进度事件
    this.eventUnsubscribers.push(
      this.voiceClient.onTranscriptionProgress((text) => {
        this.emit('transcription-progress', text);
      })
    );
    
    // 转录完成事件
    this.eventUnsubscribers.push(
      this.voiceClient.onTranscriptionComplete((text, engine, usedFallback, durationMs) => {
        this.lastTranscription = {
          type: 'transcription_complete',
          text,
          engine,
          used_fallback: usedFallback,
          duration_ms: durationMs,
        };
        this.emit('transcription-complete', text);
      })
    );
    
    // 错误事件
    this.eventUnsubscribers.push(
      this.voiceClient.onError((code, message) => {
        this.handleServerError({ code, message });
      })
    );
  }


  /**
   * 销毁服务
   * 清理事件监听和资源
   */
  async destroy(): Promise<void> {
    if (this.isDestroyed) {
      return;
    }
    
    this.isDestroyed = true;
    debugLog('[VoiceInputService] 销毁服务...');
    
    // 取消所有事件订阅
    this.eventUnsubscribers.forEach(unsubscribe => unsubscribe());
    this.eventUnsubscribers = [];
    
    // 清理 VoiceClient 引用
    this.voiceClient = null;
    
    // 清理事件监听器
    this.eventListeners.clear();
    
    debugLog('[VoiceInputService] 服务已销毁');
  }

  // ============================================================================
  // 录音控制方法
  // ============================================================================

  /**
   * 开始听写模式
   */
  async startDictation(): Promise<void> {
    if (this._isRecording) {
      throw new VoiceServerError(
        t('voiceInput.alreadyRecording') || '已在录音中',
        VoiceErrorCode.ALREADY_RECORDING
      );
    }

    // 确保服务已初始化
    await this.ensureInitialized();
    
    this._currentMode = 'dictation';
    this._isRecording = true;
    
    // 使用 VoiceClient 发送开始录音消息
    this.voiceClient!.startRecording(this._recordingMode, this.buildASRConfig());
    debugLog('[VoiceInputService] 开始听写模式');
  }

  /**
   * 停止听写模式
   * @returns 转录后的文本
   */
  async stopDictation(): Promise<string> {
    if (!this._isRecording || this._currentMode !== 'dictation') {
      throw new VoiceServerError(
        t('voiceInput.notRecording') || '未在录音中',
        VoiceErrorCode.DEVICE_ERROR
      );
    }

    // 使用 VoiceClient 发送停止录音消息
    this.voiceClient!.stopRecording();
    
    // 等待转录完成
    const result = await this.waitForTranscription();
    
    this._isRecording = false;
    this._currentMode = null;
    
    debugLog('[VoiceInputService] 听写模式结束，转录结果:', result);
    
    return result;
  }


  /**
   * 执行完整的听写流程
   * 包括：录音 → ASR 转录 → LLM 后处理（可选）→ 文本插入
   * 
   * @returns 听写结果
   */
  async executeDictationFlow(): Promise<DictationResult> {
    // 记录 ASR 开始时间
    const asrStartTime = Date.now();
    
    // 停止录音并获取转录结果
    const originalText = await this.stopDictation();
    
    // 计算 ASR 耗时
    const asrDuration = Date.now() - asrStartTime;
    
    // 获取转录元数据
    const transcription = this.lastTranscription;
    const asrEngine = transcription?.engine || 'unknown';
    const usedFallback = transcription?.used_fallback || false;
    const duration = transcription?.duration_ms || 0;
    
    let processedText = originalText;
    let usedLLMProcessing = false;
    let llmDuration: number | undefined;
    
    // 如果启用了 LLM 后处理，且原始文本不为空
    if (this.settings.enableLLMPostProcessing && this.llmPostProcessor && originalText && originalText.trim() !== '') {
      try {
        // 获取当前激活的预设
        const activePreset = this.settings.llmPresets.find(
          p => p.id === this.settings.activeLLMPresetId
        );
        
        if (activePreset) {
          debugLog('[VoiceInputService] 执行 LLM 后处理，预设:', activePreset.name);
          
          // 记录 LLM 开始时间
          const llmStartTime = Date.now();
          
          processedText = await this.llmPostProcessor.process(
            originalText,
            activePreset.systemPrompt
          );
          
          // 计算 LLM 耗时
          llmDuration = Date.now() - llmStartTime;
          
          usedLLMProcessing = true;
          debugLog('[VoiceInputService] LLM 后处理完成，耗时:', llmDuration, 'ms');
        }
      } catch (error) {
        // LLM 处理失败，使用原始文本
        errorLog('[VoiceInputService] LLM 后处理失败:', error);
        // 抛出 LLMProcessingError，让调用方决定是否使用原始文本
        throw new LLMProcessingError(
          error instanceof Error ? error.message : String(error),
          originalText
        );
      }
    }
    
    // 如果启用了移除末尾标点，在最终输出前处理
    // 放在 LLM 处理之后，确保 LLM 生成的标点也会被移除
    if (this.settings.removeTrailingPunctuation && processedText) {
      processedText = this.removeTrailingPunctuation(processedText);
    }
    
    // 构建结果
    const result: DictationResult = {
      originalText,
      processedText,
      usedLLMProcessing,
      asrEngine,
      usedFallback,
      duration,
      asrDuration,
      llmDuration,
    };
    
    this.lastDictationResult = result;
    
    return result;
  }


  /**
   * 执行完整的听写流程并插入文本
   * 这是最常用的方法，一步完成所有操作
   * 
   * @returns 是否成功插入文本
   */
  async executeDictationAndInsert(): Promise<boolean> {
    // 检查是否有活动编辑器
    if (!this.hasActiveEditor()) {
      throw new VoiceServerError(
        t('voiceInput.noActiveEditor') || '没有活动的编辑器',
        VoiceErrorCode.DEVICE_ERROR
      );
    }
    
    // 执行听写流程
    const result = await this.executeDictationFlow();
    
    // 插入文本
    if (this.textInserter) {
      const success = await this.textInserter.insertAtCursor(result.processedText);
      debugLog('[VoiceInputService] 文本插入结果:', success);
      return success;
    } else {
      // 如果没有注入 textInserter，使用内置方法
      return this.insertTextAtCursor(result.processedText);
    }
  }

  /**
   * 内置的文本插入方法
   * 在光标位置插入文本
   */
  private insertTextAtCursor(text: string): boolean {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      return false;
    }
    
    const editor = view.editor;
    const cursor = editor.getCursor();
    
    editor.replaceRange(text, cursor);
    
    // 移动光标到插入文本的末尾
    const lines = text.split('\n');
    const lastLineLength = lines[lines.length - 1].length;
    const newLine = cursor.line + lines.length - 1;
    const newCh = lines.length === 1 
      ? cursor.ch + lastLineLength 
      : lastLineLength;
    
    editor.setCursor({ line: newLine, ch: newCh });
    
    return true;
  }

  /**
   * 内置的选中文本替换方法
   */
  private replaceSelectedText(text: string): boolean {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      return false;
    }
    
    const editor = view.editor;
    const selection = editor.getSelection();
    
    if (!selection) {
      return false;
    }
    
    editor.replaceSelection(text);
    return true;
  }

  /**
   * 获取最后一次听写结果
   */
  getLastDictationResult(): DictationResult | null {
    return this.lastDictationResult;
  }


  // ============================================================================
  // 依赖注入方法
  // ============================================================================

  /**
   * 设置 LLM 后处理器
   */
  setLLMPostProcessor(processor: ILLMPostProcessor): void {
    this.llmPostProcessor = processor;
  }

  /**
   * 设置文本插入器
   */
  setTextInserter(inserter: ITextInserterService): void {
    this.textInserter = inserter;
  }

  /**
   * 开始助手模式
   * @param selectedText 选中的文本（可选）
   */
  async startAssistant(selectedText?: string): Promise<void> {
    if (this._isRecording) {
      throw new VoiceServerError(
        t('voiceInput.alreadyRecording') || '已在录音中',
        VoiceErrorCode.ALREADY_RECORDING
      );
    }

    // 确保服务已初始化
    await this.ensureInitialized();
    
    // 如果没有传入选中文本，尝试从编辑器获取
    if (selectedText === undefined) {
      const editorSelection = this.getSelectedText();
      selectedText = editorSelection ?? undefined;
    }
    
    this.selectedText = selectedText || null;
    this._currentMode = 'assistant';
    this._isRecording = true;
    
    // 使用 VoiceClient 发送开始录音消息
    this.voiceClient!.startRecording(this._recordingMode, this.buildASRConfig());
    debugLog('[VoiceInputService] 开始助手模式，选中文本:', this.selectedText ? '有' : '无');
  }

  /**
   * 停止助手模式
   * @returns 处理后的文本
   */
  async stopAssistant(): Promise<string> {
    if (!this._isRecording || this._currentMode !== 'assistant') {
      throw new VoiceServerError(
        t('voiceInput.notRecording') || '未在录音中',
        VoiceErrorCode.DEVICE_ERROR
      );
    }

    // 使用 VoiceClient 发送停止录音消息
    this.voiceClient!.stopRecording();
    
    // 等待转录完成
    const voiceCommand = await this.waitForTranscription();
    
    this._isRecording = false;
    this._currentMode = null;
    
    debugLog('[VoiceInputService] 助手模式结束，语音命令:', voiceCommand);
    
    // 返回语音命令文本，后续由调用方处理 LLM 调用
    return voiceCommand;
  }

  /**
   * 获取助手模式的选中文本
   * 在 startAssistant 时捕获的选中文本
   */
  getAssistantSelectedText(): string | null {
    return this.selectedText;
  }

  /**
   * 检测助手模式类型
   * 根据是否有选中文本决定是 Q&A 模式还是文本处理模式
   */
  detectAssistantMode(): 'qa' | 'text_processing' {
    return this.selectedText ? 'text_processing' : 'qa';
  }


  /**
   * 执行完整的助手模式流程
   * 包括：录音 → ASR 转录 → LLM 处理 → 文本插入/替换
   * 
   * @param llmProcessor LLM 处理器（用于调用 AI）
   * @returns 处理结果
   */
  async executeAssistantFlow(llmProcessor?: ILLMPostProcessor): Promise<AssistantResult> {
    // 记录 ASR 开始时间
    const asrStartTime = Date.now();
    
    // 停止录音并获取语音命令
    const voiceCommand = await this.stopAssistant();
    
    // 计算 ASR 耗时
    const asrDuration = Date.now() - asrStartTime;
    
    // 获取转录元数据
    const transcription = this.lastTranscription;
    const asrEngine = transcription?.engine || 'unknown';
    const usedFallback = transcription?.used_fallback || false;
    const duration = transcription?.duration_ms || 0;
    
    // 检测模式
    const mode = this.detectAssistantMode();
    const selectedText = this.selectedText;
    
    // 清理选中文本状态
    this.selectedText = null;
    
    // 构建结果
    const result: AssistantResult = {
      voiceCommand,
      selectedText,
      mode,
      response: null,
      asrEngine,
      usedFallback,
      duration,
      asrDuration,
    };
    
    // 检查语音命令是否为空
    if (!voiceCommand || voiceCommand.trim() === '') {
      debugLog('[VoiceInputService] 语音命令为空，跳过 LLM 调用');
      return result;
    }
    
    // 如果提供了 LLM 处理器，执行 LLM 调用
    const processor = llmProcessor || this.llmPostProcessor;
    if (processor && this.settings.assistantConfig.enabled) {
      try {
        // 根据模式选择系统提示词
        const systemPrompt = mode === 'qa'
          ? this.settings.assistantConfig.qaSystemPrompt
          : this.settings.assistantConfig.textProcessingSystemPrompt;
        
        // 构建用户提示
        const userPrompt = mode === 'qa'
          ? voiceCommand
          : `选中的文本：\n${selectedText}\n\n用户指令：${voiceCommand}`;
        
        debugLog('[VoiceInputService] 执行助手 LLM 调用，模式:', mode);
        
        // 记录 LLM 开始时间
        const llmStartTime = Date.now();
        
        result.response = await processor.process(userPrompt, systemPrompt);
        
        // 计算 LLM 耗时
        result.llmDuration = Date.now() - llmStartTime;
        
        debugLog('[VoiceInputService] 助手 LLM 调用完成，耗时:', result.llmDuration, 'ms');
      } catch (error) {
        errorLog('[VoiceInputService] 助手 LLM 调用失败:', error);
        throw new LLMProcessingError(
          error instanceof Error ? error.message : String(error),
          voiceCommand
        );
      }
    }
    
    return result;
  }


  /**
   * 执行完整的助手模式流程并处理文本
   * 这是最常用的方法，一步完成所有操作
   * 
   * @param llmProcessor LLM 处理器（可选）
   * @returns 是否成功处理
   */
  async executeAssistantAndApply(llmProcessor?: ILLMPostProcessor): Promise<boolean> {
    // 检查是否有活动编辑器
    if (!this.hasActiveEditor()) {
      throw new VoiceServerError(
        t('voiceInput.noActiveEditor') || '没有活动的编辑器',
        VoiceErrorCode.DEVICE_ERROR
      );
    }
    
    // 执行助手流程
    const result = await this.executeAssistantFlow(llmProcessor);
    
    // 如果没有 LLM 响应，返回 false
    if (!result.response) {
      debugLog('[VoiceInputService] 没有 LLM 响应，跳过文本处理');
      return false;
    }
    
    // 如果启用了移除末尾标点，在最终输出前处理
    let finalResponse = result.response;
    if (this.settings.removeTrailingPunctuation && finalResponse) {
      finalResponse = this.removeTrailingPunctuation(finalResponse);
    }
    
    // 根据模式决定如何处理文本
    if (result.mode === 'text_processing' && result.selectedText) {
      // 文本处理模式：替换选中的文本
      if (this.textInserter) {
        return await this.textInserter.replaceSelection(finalResponse);
      } else {
        return this.replaceSelectedText(finalResponse);
      }
    } else {
      // Q&A 模式：在光标位置插入响应
      if (this.textInserter) {
        return await this.textInserter.insertAtCursor(finalResponse);
      } else {
        return this.insertTextAtCursor(finalResponse);
      }
    }
  }

  /**
   * 取消录音
   */
  cancelRecording(): void {
    if (!this._isRecording) {
      return;
    }

    // 使用 VoiceClient 发送取消录音消息
    this.voiceClient?.cancelRecording();
    
    this._isRecording = false;
    this._currentMode = null;
    this.selectedText = null;
    
    debugLog('[VoiceInputService] 录音已取消');
  }


  // ============================================================================
  // 状态查询方法
  // ============================================================================

  /**
   * 是否正在录音
   */
  isRecording(): boolean {
    return this._isRecording;
  }

  /**
   * 获取当前录音模式
   */
  getRecordingMode(): VoiceInputMode | null {
    return this._currentMode;
  }

  /**
   * 获取选中的文本（助手模式）
   */
  getSelectedText(): string | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      return null;
    }
    
    const editor = view.editor;
    const selection = editor.getSelection();
    
    return selection || null;
  }

  /**
   * 检查是否有活动编辑器
   */
  hasActiveEditor(): boolean {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view !== null;
  }

  /**
   * 获取最后一次转录结果
   */
  getLastTranscription(): TranscriptionCompleteMessage | null {
    return this.lastTranscription;
  }

  // ============================================================================
  // 事件系统
  // ============================================================================

  /**
   * 注册事件监听器
   */
  on<K extends keyof VoiceServiceEvents>(event: K, callback: VoiceServiceEvents[K]): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback as EventListener<keyof VoiceServiceEvents>);
  }

  /**
   * 移除事件监听器
   */
  off<K extends keyof VoiceServiceEvents>(event: K, callback: VoiceServiceEvents[K]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback as EventListener<keyof VoiceServiceEvents>);
    }
  }

  /**
   * 触发事件
   */
  private emit<K extends keyof VoiceServiceEvents>(
    event: K,
    ...args: Parameters<VoiceServiceEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          (listener as (...args: Parameters<VoiceServiceEvents[K]>) => void)(...args);
        } catch (error) {
          errorLog(`[VoiceInputService] 事件处理器错误 (${event}):`, error);
        }
      });
    }
  }


  // ============================================================================
  // 辅助方法
  // ============================================================================

  /**
   * 确保服务已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
      return;
    }
    
    // 确保 WebSocket 连接可用
    if (!this.serverManager.isConnected()) {
      await this.serverManager.ensureServer();
      // 重新获取 VoiceClient（不需要重新设置事件，因为 VoiceClient 是单例）
      this.voiceClient = this.serverManager.voice();
    }
  }

  /**
   * 处理录音状态变化
   */
  private handleRecordingState(state: 'started' | 'stopped' | 'cancelled'): void {
    switch (state) {
      case 'started':
        this.emit('recording-start');
        break;
      case 'stopped':
      case 'cancelled':
        this.emit('recording-stop');
        break;
    }
  }

  /**
   * 处理服务器错误
   */
  private handleServerError(message: { code: string; message: string }): void {
    const error = new VoiceServerError(
      message.message,
      message.code as VoiceErrorCode
    );
    
    errorLog('[VoiceInputService] 服务器错误:', message);
    
    // 如果正在录音，重置状态
    if (this._isRecording) {
      this._isRecording = false;
      this._currentMode = null;
    }
    
    this.emit('error', error);
  }

  /**
   * 构建 ASR 配置
   * 使用 ConfigManager 统一接口解析密钥值
   */
  private buildASRConfig(): ASRConfig {
    const config: ASRConfig = {
      primary: {
        provider: this.settings.primaryASR.provider,
        mode: this.settings.primaryASR.mode,
        // 使用 ConfigManager 解析密钥值
        dashscope_api_key: this.configManager.resolveKeyValue(this.settings.primaryASR.dashscopeKeyConfig),
        app_id: this.settings.primaryASR.app_id,
        access_token: this.configManager.resolveKeyValue(this.settings.primaryASR.doubaoKeyConfig),
        siliconflow_api_key: this.configManager.resolveKeyValue(this.settings.primaryASR.siliconflowKeyConfig),
      },
      enable_fallback: this.settings.enableFallback,
      enable_audio_feedback: this.settings.enableAudioFeedback,
    };

    if (this.settings.backupASR && this.settings.enableFallback) {
      config.fallback = {
        provider: this.settings.backupASR.provider,
        mode: this.settings.backupASR.mode,
        // 使用 ConfigManager 解析密钥值
        dashscope_api_key: this.configManager.resolveKeyValue(this.settings.backupASR.dashscopeKeyConfig),
        app_id: this.settings.backupASR.app_id,
        access_token: this.configManager.resolveKeyValue(this.settings.backupASR.doubaoKeyConfig),
        siliconflow_api_key: this.configManager.resolveKeyValue(this.settings.backupASR.siliconflowKeyConfig),
      };
    }

    return config;
  }

  /**
   * 移除文本末尾的标点符号
   * 支持中英文常见标点
   */
  private removeTrailingPunctuation(text: string): string {
    if (!text) return text;
    
    // 中英文常见末尾标点符号
    // 包括：句号、问号、感叹号、逗号、分号、冒号、省略号等
    const trailingPunctuationRegex = /[。？！，、；：…．.?!,;:]+$/;
    
    return text.replace(trailingPunctuationRegex, '');
  }


  /**
   * 等待转录完成
   */
  private waitForTranscription(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new VoiceServerError(
          t('voiceInput.transcriptionTimeout') || '转录超时',
          VoiceErrorCode.ASR_TIMEOUT
        ));
      }, 30000); // 30 秒超时

      const onComplete = (text: string) => {
        cleanup();
        resolve(text);
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.off('transcription-complete', onComplete);
        this.off('error', onError);
      };

      this.on('transcription-complete', onComplete);
      this.on('error', onError);
    });
  }

  /**
   * 更新设置
   */
  updateSettings(settings: VoiceSettings): void {
    this.settings = settings;
    this._recordingMode = settings.defaultRecordingMode;
    
    // 如果 VoiceClient 可用，发送配置更新
    if (this.voiceClient && this.serverManager.isConnected()) {
      this.voiceClient.updateConfig(this.buildASRConfig());
    }
  }

  /**
   * 设置录音模式
   */
  setRecordingMode(mode: RecordingMode): void {
    this._recordingMode = mode;
  }

  /**
   * 获取当前录音模式设置
   */
  getRecordingModeSettings(): RecordingMode {
    return this._recordingMode;
  }
}
