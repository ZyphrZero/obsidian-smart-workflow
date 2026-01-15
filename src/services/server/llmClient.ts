/**
 * LLMClient - LLM 模块客户端
 * 
 * 提供 LLM 流式处理功能
 */

import { ModuleClient } from './moduleClient';
import type { LLMEvents, ServerMessage, StreamConfig } from './types';
import { debugLog } from '../../utils/logger';

/**
 * LLM 模块客户端
 */
export class LLMClient extends ModuleClient {
  /** 事件监听器 */
  private eventListeners: Map<keyof LLMEvents, Set<LLMEvents[keyof LLMEvents]>> = new Map();

  constructor() {
    super('llm');
  }

  /**
   * 开始流式请求
   * 
   * @param config 流式请求配置
   */
  startStream(config: StreamConfig): void {
    this.send('stream_start', {
      endpoint: config.endpoint,
      headers: config.headers,
      body: config.body,
      api_format: config.api_format,
    });
  }

  /**
   * 取消流式请求
   */
  cancelStream(): void {
    this.send('stream_cancel');
  }

  /**
   * 注册数据块处理器
   */
  onChunk(handler: LLMEvents['chunk']): () => void {
    return this.on('chunk', handler);
  }

  /**
   * 注册思考内容处理器
   */
  onThinking(handler: LLMEvents['thinking']): () => void {
    return this.on('thinking', handler);
  }

  /**
   * 注册完成处理器
   */
  onComplete(handler: LLMEvents['complete']): () => void {
    return this.on('complete', handler);
  }

  /**
   * 注册错误处理器
   */
  onError(handler: LLMEvents['error']): () => void {
    return this.on('error', handler);
  }

  /**
   * 注册事件监听器
   */
  private on<K extends keyof LLMEvents>(event: K, handler: LLMEvents[K]): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler as LLMEvents[keyof LLMEvents]);
    
    return () => {
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        listeners.delete(handler as LLMEvents[keyof LLMEvents]);
      }
    };
  }

  /**
   * 触发事件
   */
  private emit<K extends keyof LLMEvents>(
    event: K,
    ...args: Parameters<LLMEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          (listener as (...args: Parameters<LLMEvents[K]>) => void)(...args);
        } catch (error) {
          debugLog(`[LLMClient] 事件处理器错误 (${event}):`, error);
        }
      });
    }
  }

  /**
   * 处理服务器消息
   */
  protected onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'stream_chunk':
        this.emit('chunk', msg.content as string);
        break;
        
      case 'stream_thinking':
        this.emit('thinking', msg.content as string);
        break;
        
      case 'stream_complete':
        this.emit('complete', msg.full_content as string);
        break;
        
      case 'stream_error':
        this.emit('error', msg.code as string, msg.message as string);
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
