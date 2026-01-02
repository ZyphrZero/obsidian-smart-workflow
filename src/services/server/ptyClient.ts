/**
 * PtyClient - PTY 模块客户端
 * 
 * 提供终端会话管理功能
 */

import { ModuleClient } from './moduleClient';
import { PtyConfig, PtyEvents, ServerMessage } from './types';
import { debugLog } from '../../utils/logger';

/**
 * PTY 模块客户端
 */
export class PtyClient extends ModuleClient {
  /** 事件监听器 */
  private eventListeners: Map<keyof PtyEvents, Set<PtyEvents[keyof PtyEvents]>> = new Map();

  constructor() {
    super('pty');
  }

  /**
   * 初始化 PTY 会话
   * 
   * @param config PTY 配置
   */
  init(config: PtyConfig = {}): void {
    this.send('init', {
      shell_type: config.shell_type,
      shell_args: config.shell_args,
      cwd: config.cwd,
      env: config.env,
      cols: config.cols,
      rows: config.rows,
    });
  }

  /**
   * 调整终端尺寸
   * 
   * @param cols 列数
   * @param rows 行数
   */
  resize(cols: number, rows: number): void {
    this.send('resize', { cols, rows });
  }

  /**
   * 写入文本数据
   * 
   * @param data 文本数据
   */
  write(data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    // PTY 文本输入直接发送字符串
    this.ws.send(data);
  }

  /**
   * 写入二进制数据
   * 
   * @param data 二进制数据
   */
  writeBinary(data: Uint8Array | ArrayBuffer): void {
    this.sendBinary(data);
  }

  /**
   * 注册输出处理器
   * 
   * @param handler 输出处理器
   * @returns 取消注册的函数
   */
  onOutput(handler: PtyEvents['output']): () => void {
    return this.on('output', handler);
  }

  /**
   * 注册退出处理器
   * 
   * @param handler 退出处理器
   * @returns 取消注册的函数
   */
  onExit(handler: PtyEvents['exit']): () => void {
    return this.on('exit', handler);
  }

  /**
   * 注册错误处理器
   * 
   * @param handler 错误处理器
   * @returns 取消注册的函数
   */
  onError(handler: PtyEvents['error']): () => void {
    return this.on('error', handler);
  }

  /**
   * 注册事件监听器
   */
  private on<K extends keyof PtyEvents>(event: K, handler: PtyEvents[K]): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler as PtyEvents[keyof PtyEvents]);
    
    return () => {
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        listeners.delete(handler as PtyEvents[keyof PtyEvents]);
      }
    };
  }

  /**
   * 触发事件
   */
  private emit<K extends keyof PtyEvents>(
    event: K,
    ...args: Parameters<PtyEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          (listener as (...args: Parameters<PtyEvents[K]>) => void)(...args);
        } catch (error) {
          debugLog(`[PtyClient] 事件处理器错误 (${event}):`, error);
        }
      });
    }
  }

  /**
   * 处理服务器消息
   */
  protected onMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'output':
        // 输出数据 (二进制数据在 ServerManager 中单独处理)
        if (msg.data) {
          const data = msg.data as number[];
          this.emit('output', new Uint8Array(data));
        }
        break;
        
      case 'exit':
        this.emit('exit', (msg.code as number) || 0);
        break;
        
      case 'error':
        this.emit('error', msg.code as string, msg.message as string);
        break;
    }
  }

  /**
   * 处理二进制消息 (PTY 输出)
   * 由 ServerManager 调用
   */
  handleBinaryMessage(data: ArrayBuffer): void {
    this.emit('output', new Uint8Array(data));
  }

  /**
   * 清理资源
   */
  override destroy(): void {
    this.eventListeners.clear();
    super.destroy();
  }
}
