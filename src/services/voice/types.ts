// ============================================================================
// 语音输入服务类型定义
// ============================================================================

/**
 * ASR 供应商类型
 * - qwen: 阿里云 Qwen
 * - doubao: 豆包 Doubao
 * - sensevoice: 硅基流动 SenseVoice
 */
export type ASRProvider = 'qwen' | 'doubao' | 'sensevoice';

/**
 * ASR 模式
 * - realtime: WebSocket 实时模式
 * - http: HTTP 上传模式
 */
export type ASRMode = 'realtime' | 'http';

/**
 * 录音模式
 * - press: 按住模式，按住快捷键录音，松开停止
 * - toggle: 松手模式，按一次开始录音，再按一次结束
 */
export type RecordingMode = 'press' | 'toggle';

/**
 * 语音输入模式
 * - dictation: 听写模式，语音转文字后插入
 * - assistant: AI 助手模式，语音命令处理文本
 */
export type VoiceInputMode = 'dictation' | 'assistant';

// ============================================================================
// ASR 配置类型
// ============================================================================

/**
 * ASR 供应商配置
 * 与 Rust 端 ASRProviderConfig 保持一致
 */
export interface ASRProviderConfig {
  /** 供应商类型 */
  provider: ASRProvider;
  /** ASR 模式 */
  mode: ASRMode;
  
  // Qwen 特有配置
  /** DashScope API Key (阿里云) */
  dashscope_api_key?: string;
  
  // Doubao 特有配置
  /** 应用 ID (豆包) */
  app_id?: string;
  /** 访问令牌 (豆包) */
  access_token?: string;
  
  // SenseVoice 特有配置
  /** 硅基流动 API Key */
  siliconflow_api_key?: string;
}

/**
 * 完整 ASR 配置
 * 与 Rust 端 ASRConfig 保持一致
 */
export interface ASRConfig {
  /** 主 ASR 引擎配置 */
  primary: ASRProviderConfig;
  /** 备用 ASR 引擎配置 */
  fallback?: ASRProviderConfig;
  /** 是否启用自动兜底 */
  enable_fallback: boolean;
}

// ============================================================================
// WebSocket 消息类型 (客户端 → 服务器)
// ============================================================================

/**
 * 开始录音消息
 */
export interface StartRecordingMessage {
  type: 'start_recording';
  mode: RecordingMode;
  asr_config: ASRConfig;
}

/**
 * 停止录音消息
 */
export interface StopRecordingMessage {
  type: 'stop_recording';
}

/**
 * 取消录音消息
 */
export interface CancelRecordingMessage {
  type: 'cancel_recording';
}

/**
 * 更新配置消息
 */
export interface UpdateConfigMessage {
  type: 'update_config';
  asr_config: ASRConfig;
}

/**
 * 客户端发送的消息联合类型
 */
export type ClientMessage = 
  | StartRecordingMessage 
  | StopRecordingMessage 
  | CancelRecordingMessage 
  | UpdateConfigMessage;

// ============================================================================
// WebSocket 消息类型 (服务器 → 客户端)
// ============================================================================

/**
 * 录音状态消息
 */
export interface RecordingStateMessage {
  type: 'recording_state';
  state: 'started' | 'stopped' | 'cancelled';
}

/**
 * 音频级别消息 (用于波形显示)
 */
export interface AudioLevelMessage {
  type: 'audio_level';
  /** 音量级别 (0-1) */
  level: number;
  /** 波形数据 */
  waveform: number[];
}

/**
 * 转录进度消息 (实时模式)
 */
export interface TranscriptionProgressMessage {
  type: 'transcription_progress';
  partial_text: string;
}

/**
 * 转录完成消息
 */
export interface TranscriptionCompleteMessage {
  type: 'transcription_complete';
  text: string;
  engine: string;
  used_fallback: boolean;
  duration_ms: number;
}

/**
 * 错误消息
 */
export interface VoiceErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

/**
 * 服务器发送的消息联合类型
 */
export type ServerMessage = 
  | RecordingStateMessage 
  | AudioLevelMessage 
  | TranscriptionProgressMessage 
  | TranscriptionCompleteMessage 
  | VoiceErrorMessage;

// ============================================================================
// 悬浮窗状态类型
// ============================================================================

/**
 * 悬浮窗状态
 */
export type OverlayState = 
  | { type: 'recording'; mode: RecordingMode }
  | { type: 'processing' }
  | { type: 'success'; message?: string }
  | { type: 'error'; message: string };

/**
 * 悬浮窗位置
 */
export type OverlayPosition = 'cursor' | 'center' | 'top-right' | 'bottom';

// ============================================================================
// 历史记录类型
// ============================================================================

/**
 * 转录历史记录
 */
export interface TranscriptionHistory {
  /** 唯一标识 */
  id: string;
  /** 时间戳 */
  timestamp: number;
  /** 语音输入模式 */
  mode: VoiceInputMode;
  /** ASR 原始转录文本 */
  originalText: string;
  /** LLM 处理后的文本 */
  processedText?: string;
  /** 使用的 LLM 预设 */
  llmPreset?: string;
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
  /** 文本字数 */
  charCount?: number;
}

// ============================================================================
// 错误类型
// ============================================================================

/**
 * 语音服务错误码
 */
export enum VoiceErrorCode {
  // 录音错误
  MICROPHONE_UNAVAILABLE = 'MICROPHONE_UNAVAILABLE',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  DEVICE_ERROR = 'DEVICE_ERROR',
  ALREADY_RECORDING = 'ALREADY_RECORDING',
  
  // ASR 错误
  ASR_NETWORK_ERROR = 'ASR_NETWORK_ERROR',
  ASR_AUTH_FAILED = 'ASR_AUTH_FAILED',
  ASR_QUOTA_EXCEEDED = 'ASR_QUOTA_EXCEEDED',
  ASR_INVALID_AUDIO = 'ASR_INVALID_AUDIO',
  ASR_TIMEOUT = 'ASR_TIMEOUT',
  ASR_ALL_FAILED = 'ASR_ALL_FAILED',
  
  // 服务器错误
  SERVER_NOT_RUNNING = 'SERVER_NOT_RUNNING',
  CONNECTION_LOST = 'CONNECTION_LOST',
  INVALID_MESSAGE = 'INVALID_MESSAGE',
}

/**
 * 语音服务错误
 */
export class VoiceServerError extends Error {
  constructor(
    message: string,
    public readonly code: VoiceErrorCode
  ) {
    super(message);
    this.name = 'VoiceServerError';
  }
}

/**
 * LLM 处理错误
 */
export class LLMProcessingError extends Error {
  constructor(
    message: string,
    /** 原始转录文本，用于回退 */
    public readonly rawText: string
  ) {
    super(message);
    this.name = 'LLMProcessingError';
  }
}

// ============================================================================
// 服务接口类型
// ============================================================================

/**
 * 语音输入服务接口
 */
export interface IVoiceInputService {
  /** 初始化服务 */
  initialize(): Promise<void>;
  /** 销毁服务 */
  destroy(): Promise<void>;
  
  /** 开始听写模式 */
  startDictation(): Promise<void>;
  /** 停止听写模式 */
  stopDictation(): Promise<string>;
  /** 开始助手模式 */
  startAssistant(selectedText?: string): Promise<void>;
  /** 停止助手模式 */
  stopAssistant(): Promise<string>;
  
  /** 是否正在录音 */
  isRecording(): boolean;
  /** 获取当前录音模式 */
  getRecordingMode(): VoiceInputMode | null;
}

/**
 * 悬浮窗接口
 */
export interface IVoiceOverlay {
  /** 显示悬浮窗 */
  show(state: OverlayState): void;
  /** 隐藏悬浮窗 */
  hide(): void;
  /** 更新状态 */
  updateState(state: OverlayState): void;
  /** 更新波形 */
  updateWaveform(levels: number[]): void;
  /** 设置位置 */
  setPosition(x: number, y: number): void;
}

/**
 * 文本插入器接口
 */
export interface ITextInserter {
  /** 在光标位置插入文本 */
  insertAtCursor(text: string): Promise<boolean>;
  /** 替换选中文本 */
  replaceSelection(text: string): Promise<boolean>;
  /** 检查是否有活动编辑器 */
  hasActiveEditor(): boolean;
}

/**
 * 历史记录管理器接口
 */
export interface IHistoryManager {
  /** 保存历史记录 */
  save(record: Omit<TranscriptionHistory, 'id'>): Promise<void>;
  /** 获取所有历史记录 */
  getAll(): Promise<TranscriptionHistory[]>;
  /** 搜索历史记录 */
  search(query: string): Promise<TranscriptionHistory[]>;
  /** 清空历史记录 */
  clear(): Promise<void>;
}

// ============================================================================
// 事件类型
// ============================================================================

/**
 * 语音服务事件映射
 */
export interface VoiceServiceEvents {
  'recording-start': () => void;
  'recording-stop': () => void;
  'transcription-progress': (text: string) => void;
  'transcription-complete': (text: string) => void;
  'error': (error: Error) => void;
  'audio-level': (level: number, waveform: number[]) => void;
}
