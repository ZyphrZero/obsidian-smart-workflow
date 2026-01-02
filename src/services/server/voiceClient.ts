/**
 * VoiceClient - Voice 模块客户端
 * 
 * 提供语音录制和 ASR 转录功能
 */

import { ModuleClient } from './moduleClient';
import { VoiceEvents, ServerMessage, ASRConfig, RecordingMode } from './types';
import { debugLog } from '../../utils/logger';

/**
 * Voice 模块客户端
 */
export class VoiceClient extends ModuleClient {
  /** 事件监听器 */
  private eventListeners: Map<keyof VoiceEvents, Set<VoiceEvents[keyof VoiceEvents]>> = new Map();

  constructor() {
    super('voice');
  }

  /**
   * 开始录音
   * 
   * @param mode 录音模式
   * @param asrConfig ASR 配置
   */
  startRecording(mode: RecordingMode, asrConfig: ASRConfig): void {
    this.send('start_recording', {
      mode,
      asr_config: asrConfig,
    });
  }

  /**
   * 停止录音
   */
  stopRecording(): void {
    this.send('stop_recording');
  }

  /**
   * 取消录音
   */
  cancelRecording(): void {
    this.send('cancel_recording');
  }

  /**
   * 更新 ASR 配置
   * 
   * @param asrConfig ASR 配置
   */
  updateConfig(asrConfig: ASRConfig): void {
    this.send('update_config', {
      asr_config: asrConfig,
    });
  }

  /**
   * 注册录音状态处理器
   */
  onRecordingState(handler: VoiceEvents['recording-state']): () => void {
    return this.on('recording-state', handler);
  }

  /**
   * 注册音频级别处理器
   */
  onAudioLevel(handler: VoiceEvents['audio-level']): () => void {
    return this.on('audio-level', handler);
  }

  /**
   * 注册转录进度处理器
   */
  onTranscriptionProgress(handler: VoiceEvents['transcription-progress']): () => void {
    return this.on('transcription-progress', handler);
  }

  /**
   * 注册转录完成处理器
   */
  onTranscriptionComplete(handler: VoiceEvents['transcription-complete']): () => void {
    return this.on('transcription-complete', handler);
  }

  /**
   * 注册错误处理器
   */
  onError(handler: VoiceEvents['error']): () => void {
    return this.on('error', handler);
  }

  /**
   * 注册事件监听器
   */
  private on<K extends keyof VoiceEvents>(event: K, handler: VoiceEvents[K]): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler as VoiceEvents[keyof VoiceEvents]);
    
    return () => {
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        listeners.delete(handler as VoiceEvents[keyof VoiceEvents]);
      }
    };
  }

  /**
   * 触发事件
   */
  private emit<K extends keyof VoiceEvents>(
    event: K,
    ...args: Parameters<VoiceEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          (listener as (...args: Parameters<VoiceEvents[K]>) => void)(...args);
        } catch (error) {
          debugLog(`[VoiceClient] 事件处理器错误 (${event}):`, error);
        }
      });
    }
  }

  /**
   * 处理服务器消息
   */
  protected onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'recording_state':
        this.emit('recording-state', msg.state as 'started' | 'stopped' | 'cancelled');
        break;
        
      case 'audio_level':
        this.emit('audio-level', msg.level as number, msg.waveform as number[]);
        break;
        
      case 'transcription_progress':
        this.emit('transcription-progress', msg.partial_text as string);
        break;
        
      case 'transcription_complete':
        this.emit(
          'transcription-complete',
          msg.text as string,
          msg.engine as string,
          msg.used_fallback as boolean,
          msg.duration_ms as number
        );
        break;
        
      case 'error':
        this.emit('error', msg.code as string, msg.message as string);
        break;
    }
  }

  /**
   * 清理资源
   */
  override destroy(): void {
    this.eventListeners.clear();
    super.destroy();
  }
}
