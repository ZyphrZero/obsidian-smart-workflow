/**
 * TypedEventEmitter - 类型安全的事件发射器
 *
 * 提供类型安全的事件订阅和发射功能
 */

import { errorLog } from '../../utils/logger';

/**
 * 事件处理器类型
 */
type EventHandler = (...args: unknown[]) => void;

/**
 * 类型安全的事件发射器基类
 *
 * @template Events 事件映射类型
 *
 * @example
 * ```typescript
 * interface MyEvents {
 *   'data': (value: string) => void;
 *   'error': (code: number, message: string) => void;
 * }
 *
 * class MyEmitter extends TypedEventEmitter<MyEvents> {
 *   sendData(value: string) {
 *     this.emit('data', value);
 *   }
 * }
 * ```
 */
export class TypedEventEmitter<Events> {
  /** 事件监听器映射 */
  private listeners = new Map<keyof Events, Set<EventHandler>>();

  /**
   * 注册事件监听器
   *
   * @param event 事件名称
   * @param handler 事件处理器
   * @returns 取消注册的函数
   */
  on<K extends keyof Events>(event: K, handler: Events[K]): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.add(handler as EventHandler);
    }

    // 返回取消注册函数
    return () => this.off(event, handler);
  }

  /**
   * 注册一次性事件监听器
   *
   * @param event 事件名称
   * @param handler 事件处理器
   * @returns 取消注册的函数
   */
  once<K extends keyof Events>(event: K, handler: Events[K]): () => void {
    const wrappedHandler = ((...args: unknown[]) => {
      this.off(event, wrappedHandler as Events[K]);
      (handler as EventHandler)(...args);
    }) as Events[K];

    return this.on(event, wrappedHandler);
  }

  /**
   * 移除事件监听器
   *
   * @param event 事件名称
   * @param handler 事件处理器
   */
  off<K extends keyof Events>(event: K, handler: Events[K]): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(handler as EventHandler);
      if (listeners.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * 移除指定事件的所有监听器
   *
   * @param event 事件名称
   */
  removeAllListeners<K extends keyof Events>(event?: K): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * 触发事件
   *
   * @param event 事件名称
   * @param args 事件参数
   */
  protected emit<K extends keyof Events>(
    event: K,
    ...args: Events[K] extends (...args: infer P) => void ? P : never
  ): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          (listener as EventHandler)(...args);
        } catch (error) {
          errorLog(`[EventEmitter] 事件处理器错误 (${String(event)}):`, error);
        }
      });
    }
  }

  /**
   * 获取指定事件的监听器数量
   *
   * @param event 事件名称
   * @returns 监听器数量
   */
  listenerCount<K extends keyof Events>(event: K): number {
    return this.listeners.get(event)?.size || 0;
  }

  /**
   * 检查是否有指定事件的监听器
   *
   * @param event 事件名称
   * @returns 是否有监听器
   */
  hasListeners<K extends keyof Events>(event: K): boolean {
    return this.listenerCount(event) > 0;
  }
}
