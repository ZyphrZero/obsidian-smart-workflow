/**
 * UtilsClient - Utils 模块客户端
 * 
 * 提供语言检测等工具功能
 */

import { ModuleClient } from './moduleClient';
import { UtilsEvents, ServerMessage, LanguageDetectionResult } from './types';
import { debugLog } from '../../utils/logger';

/**
 * Utils 模块客户端
 */
export class UtilsClient extends ModuleClient {
  /** 事件监听器 */
  private eventListeners: Map<keyof UtilsEvents, Set<UtilsEvents[keyof UtilsEvents]>> = new Map();
  
  /** 待处理的语言检测请求 */
  private pendingRequests: Map<string, {
    resolve: (result: LanguageDetectionResult) => void;
    reject: (error: Error) => void;
  }> = new Map();
  
  /** 请求 ID 计数器 */
  private requestIdCounter = 0;

  constructor() {
    super('utils');
  }

  /**
   * 检测语言
   * 
   * @param text 要检测的文本
   * @returns 语言检测结果
   */
  async detectLanguage(text: string): Promise<LanguageDetectionResult> {
    return new Promise((resolve, reject) => {
      const requestId = `lang_${++this.requestIdCounter}_${Date.now()}`;
      
      // 设置超时
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('语言检测超时'));
      }, 5000);
      
      // 保存请求
      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      
      // 发送请求
      this.send('detect_language', {
        text,
        request_id: requestId,
      });
    });
  }

  /**
   * 注册语言检测结果处理器
   */
  onLanguageDetected(handler: UtilsEvents['language-detected']): () => void {
    return this.on('language-detected', handler);
  }

  /**
   * 注册错误处理器
   */
  onError(handler: UtilsEvents['error']): () => void {
    return this.on('error', handler);
  }

  /**
   * 注册事件监听器
   */
  private on<K extends keyof UtilsEvents>(event: K, handler: UtilsEvents[K]): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler as UtilsEvents[keyof UtilsEvents]);
    
    return () => {
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        listeners.delete(handler as UtilsEvents[keyof UtilsEvents]);
      }
    };
  }

  /**
   * 触发事件
   */
  private emit<K extends keyof UtilsEvents>(
    event: K,
    ...args: Parameters<UtilsEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          (listener as (...args: Parameters<UtilsEvents[K]>) => void)(...args);
        } catch (error) {
          debugLog(`[UtilsClient] 事件处理器错误 (${event}):`, error);
        }
      });
    }
  }

  /**
   * 处理服务器消息
   */
  protected onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'language_detected': {
        const requestId = msg.request_id as string;
        const result: LanguageDetectionResult = {
          language: msg.language as string,
          confidence: msg.confidence as number,
          is_simplified: msg.is_simplified as boolean | undefined,
        };
        
        // 处理待处理的请求
        const pending = this.pendingRequests.get(requestId);
        if (pending) {
          this.pendingRequests.delete(requestId);
          pending.resolve(result);
        }
        
        // 触发事件
        this.emit('language-detected', requestId, result);
        break;
      }
        
      case 'error': {
        const code = msg.code as string;
        const message = msg.message as string;
        
        // 如果有 request_id，拒绝对应的请求
        if (msg.request_id) {
          const pending = this.pendingRequests.get(msg.request_id as string);
          if (pending) {
            this.pendingRequests.delete(msg.request_id as string);
            pending.reject(new Error(message));
          }
        }
        
        this.emit('error', code, message);
        break;
      }
    }
  }

  /**
   * 清理资源
   */
  override destroy(): void {
    // 拒绝所有待处理的请求
    this.pendingRequests.forEach((pending) => {
      pending.reject(new Error('客户端已销毁'));
    });
    this.pendingRequests.clear();
    this.eventListeners.clear();
    super.destroy();
  }
}
