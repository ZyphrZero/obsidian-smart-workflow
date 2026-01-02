/**
 * ServerManager - 统一服务器管理器
 * 
 * 职责:
 * 1. 管理统一 Rust 服务器进程的生命周期
 * 2. 管理单一 WebSocket 连接
 * 3. 提供模块化 API (pty/voice/llm/utils)
 * 4. 处理服务器崩溃和自动重启
 * 
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Notice } from 'obsidian';
import { debugLog, debugWarn, errorLog } from '../../utils/logger';
import { t } from '../../i18n';
import { 
  ServerInfo, 
  ServerEvents, 
  ServerErrorCode, 
  ServerManagerError,
  ServerMessage,
} from './types';
import { PtyClient } from './ptyClient';
import { VoiceClient } from './voiceClient';
import { LLMClient } from './llmClient';
import { UtilsClient } from './utilsClient';

/**
 * 事件监听器类型
 */
type EventListener<K extends keyof ServerEvents> = ServerEvents[K];

/**
 * 统一服务器管理器
 * 
 * 替代 BinaryManager + TerminalService + VoiceServerManager
 */
export class ServerManager {
  /** 插件目录 */
  private pluginDir: string;
  
  /** 服务器进程 */
  private process: ChildProcess | null = null;
  
  /** WebSocket 连接 */
  private ws: WebSocket | null = null;
  
  /** 服务器端口 */
  private port: number | null = null;
  
  /** 是否正在关闭 */
  private isShuttingDown = false;
  
  /** 重启尝试次数 */
  private restartAttempts = 0;
  
  /** 最大重启次数 */
  private readonly maxRestartAttempts = 3;
  
  /** 服务器启动 Promise */
  private serverStartPromise: Promise<void> | null = null;
  
  /** WebSocket 连接 Promise */
  private wsConnectPromise: Promise<void> | null = null;
  
  /** 事件监听器 */
  private eventListeners: Map<keyof ServerEvents, Set<EventListener<keyof ServerEvents>>> = new Map();
  
  // 模块客户端 (懒加载)
  private _ptyClient: PtyClient | null = null;
  private _voiceClient: VoiceClient | null = null;
  private _llmClient: LLMClient | null = null;
  private _utilsClient: UtilsClient | null = null;

  constructor(pluginDir: string) {
    this.pluginDir = pluginDir;
  }

  // ============================================================================
  // 公共 API
  // ============================================================================

  /**
   * 确保服务器运行
   * 

   */
  async ensureServer(): Promise<void> {
    // 如果服务器已经运行，直接返回
    if (this.port !== null && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    // 如果正在启动，等待启动完成
    if (this.serverStartPromise) {
      return this.serverStartPromise;
    }

    // 启动服务器
    this.serverStartPromise = this.startServer();
    return this.serverStartPromise;
  }

  /**
   * 获取 PTY 客户端
   * 

   */
  pty(): PtyClient {
    if (!this._ptyClient) {
      this._ptyClient = new PtyClient();
      if (this.ws) {
        this._ptyClient.setWebSocket(this.ws);
      }
    }
    return this._ptyClient;
  }

  /**
   * 获取 Voice 客户端
   * 

   */
  voice(): VoiceClient {
    if (!this._voiceClient) {
      this._voiceClient = new VoiceClient();
      if (this.ws) {
        this._voiceClient.setWebSocket(this.ws);
      }
    }
    return this._voiceClient;
  }

  /**
   * 获取 LLM 客户端
   * 

   */
  llm(): LLMClient {
    if (!this._llmClient) {
      this._llmClient = new LLMClient();
      if (this.ws) {
        this._llmClient.setWebSocket(this.ws);
      }
    }
    return this._llmClient;
  }

  /**
   * 获取 Utils 客户端
   * 

   */
  utils(): UtilsClient {
    if (!this._utilsClient) {
      this._utilsClient = new UtilsClient();
      if (this.ws) {
        this._utilsClient.setWebSocket(this.ws);
      }
    }
    return this._utilsClient;
  }

  /**
   * 关闭服务器
   * 

   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    debugLog('[ServerManager] 关闭服务器...');
    
    // 关闭 WebSocket 连接
    if (this.ws) {
      try {
        this.ws.close();
      } catch (error) {
        debugWarn('[ServerManager] 关闭 WebSocket 时出错:', error);
      }
      this.ws = null;
    }
    
    // 停止服务器进程
    if (this.process) {
      try {
        this.process.kill('SIGTERM');
        
        // 等待进程退出
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (this.process && !this.process.killed) {
              debugWarn('[ServerManager] 强制终止服务器');
              this.process.kill('SIGKILL');
            }
            resolve();
          }, 1000);

          if (this.process) {
            this.process.once('exit', () => {
              clearTimeout(timeout);
              resolve();
            });
          }
        });
      } catch (error) {
        errorLog('[ServerManager] 停止服务器时出错:', error);
      } finally {
        this.process = null;
      }
    }
    
    // 清理状态
    this.port = null;
    this.serverStartPromise = null;
    this.wsConnectPromise = null;
    
    // 销毁模块客户端
    this._ptyClient?.destroy();
    this._voiceClient?.destroy();
    this._llmClient?.destroy();
    this._utilsClient?.destroy();
    
    this._ptyClient = null;
    this._voiceClient = null;
    this._llmClient = null;
    this._utilsClient = null;
    
    this.emit('server-stopped');
    
    debugLog('[ServerManager] 服务器已关闭');
  }

  /**
   * 服务器是否运行中
   */
  isServerRunning(): boolean {
    return this.port !== null && this.process !== null;
  }

  /**
   * WebSocket 是否已连接
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 获取服务器端口
   */
  getServerPort(): number | null {
    return this.port;
  }

  /**
   * 注册事件监听器
   */
  on<K extends keyof ServerEvents>(event: K, callback: ServerEvents[K]): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback as EventListener<keyof ServerEvents>);
  }

  /**
   * 移除事件监听器
   */
  off<K extends keyof ServerEvents>(event: K, callback: ServerEvents[K]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback as EventListener<keyof ServerEvents>);
    }
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 启动服务器
   */
  private async startServer(): Promise<void> {
    try {
      debugLog('[ServerManager] 启动统一服务器...');
      
      const binaryPath = this.getBinaryPath();
      
      if (!fs.existsSync(binaryPath)) {
        throw new ServerManagerError(
          ServerErrorCode.BINARY_NOT_FOUND,
          `二进制文件未找到: ${binaryPath}`
        );
      }
      
      // 确保可执行权限 (Unix)
      await this.ensureExecutable(binaryPath);
      
      // 启动进程
      this.process = spawn(binaryPath, ['--port', '0'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TERM: process.env.TERM || 'xterm-256color',
        },
        windowsHide: true,
        detached: false,
      });
      
      debugLog('[ServerManager] 服务器进程已启动, PID:', this.process.pid);
      
      // 监听进程错误
      this.process.on('error', (error) => {
        errorLog('[ServerManager] 服务器进程错误:', error);
        this.handleServerError(error);
      });
      
      // 等待端口信息
      const port = await this.waitForServerPort();
      this.port = port;
      this.restartAttempts = 0;
      
      debugLog(`[ServerManager] 服务器已启动，端口: ${port}`);
      
      // 设置退出处理器
      this.setupServerExitHandler();
      
      // 建立 WebSocket 连接
      await this.connectWebSocket();
      
      this.emit('server-started', port);
      
    } catch (error) {
      this.serverStartPromise = null;
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorLog('[ServerManager] 启动服务器失败:', errorMessage);
      
      new Notice(t('notices.serverStartFailed') || '服务器启动失败', 0);
      
      this.emit('server-error', error instanceof Error ? error : new Error(errorMessage));
      throw error;
    }
  }

  /**
   * 获取二进制文件路径
   */
  private getBinaryPath(): string {
    const platform = process.platform;
    const arch = process.arch;
    const ext = platform === 'win32' ? '.exe' : '';
    const filename = `smart-workflow-server-${platform}-${arch}${ext}`;
    
    return path.join(this.pluginDir, 'binaries', filename);
  }

  /**
   * 确保文件可执行 (Unix)
   */
  private async ensureExecutable(filePath: string): Promise<void> {
    if (process.platform === 'win32') {
      return;
    }
    
    try {
      const stats = await fs.promises.stat(filePath);
      const isExecutable = (stats.mode & 0o111) !== 0;
      
      if (!isExecutable) {
        debugLog('[ServerManager] 添加可执行权限:', filePath);
        await fs.promises.chmod(filePath, 0o755);
      }
    } catch (error) {
      errorLog('[ServerManager] 设置可执行权限失败:', error);
    }
  }

  /**
   * 等待服务器输出端口信息
   */
  private async waitForServerPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdout) {
        reject(new ServerManagerError(
          ServerErrorCode.SERVER_START_FAILED,
          '进程未启动'
        ));
        return;
      }

      let buffer = '';
      
      const timeout = setTimeout(() => {
        this.process?.stdout?.off('data', onData);
        reject(new ServerManagerError(
          ServerErrorCode.SERVER_START_FAILED,
          '等待端口信息超时'
        ));
      }, 10000);

      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        
        try {
          const match = buffer.match(/\{[^}]+\}/);
          if (match) {
            const info: ServerInfo = JSON.parse(match[0]);
            if (info.port && typeof info.port === 'number') {
              clearTimeout(timeout);
              this.process?.stdout?.off('data', onData);
              debugLog('[ServerManager] 解析到服务器信息:', info);
              resolve(info.port);
            }
          }
        } catch {
          // JSON 解析失败，继续等待
        }
      };

      this.process.stdout.on('data', onData);
      
      // 监听 stderr 用于调试
      this.process.stderr?.on('data', (data: Buffer) => {
        debugLog('[ServerManager] stderr:', data.toString());
      });

      this.process.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0 && code !== null) {
          reject(new ServerManagerError(
            ServerErrorCode.SERVER_START_FAILED,
            `服务器启动失败，退出码: ${code}`
          ));
        }
      });
    });
  }

  /**
   * 建立 WebSocket 连接
   * 

   */
  private async connectWebSocket(): Promise<void> {
    if (this.wsConnectPromise) {
      return this.wsConnectPromise;
    }

    this.wsConnectPromise = new Promise((resolve, reject) => {
      if (!this.port) {
        reject(new ServerManagerError(
          ServerErrorCode.CONNECTION_FAILED,
          '服务器端口未知'
        ));
        return;
      }

      const wsUrl = `ws://127.0.0.1:${this.port}`;
      debugLog('[ServerManager] 连接 WebSocket:', wsUrl);
      
      this.ws = new WebSocket(wsUrl);
      
      const timeout = setTimeout(() => {
        reject(new ServerManagerError(
          ServerErrorCode.CONNECTION_FAILED,
          'WebSocket 连接超时'
        ));
      }, 5000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        debugLog('[ServerManager] WebSocket 已连接');
        
        // 更新所有模块客户端的 WebSocket
        this.updateClientsWebSocket();
        
        this.emit('ws-connected');
        resolve();
      };

      this.ws.onclose = () => {
        debugLog('[ServerManager] WebSocket 已断开');
        this.wsConnectPromise = null;
        
        // 清除模块客户端的 WebSocket
        this._ptyClient?.setWebSocket(null);
        this._voiceClient?.setWebSocket(null);
        this._llmClient?.setWebSocket(null);
        this._utilsClient?.setWebSocket(null);
        
        this.emit('ws-disconnected');
        
        // 如果不是主动关闭，尝试重连
        if (!this.isShuttingDown && this.port !== null) {
          this.handleWebSocketDisconnect();
        }
      };

      this.ws.onerror = (event) => {
        clearTimeout(timeout);
        errorLog('[ServerManager] WebSocket 错误:', event);
        reject(new ServerManagerError(
          ServerErrorCode.WEBSOCKET_ERROR,
          'WebSocket 连接错误'
        ));
      };

      this.ws.onmessage = (event) => {
        this.handleWebSocketMessage(event);
      };
    });

    return this.wsConnectPromise;
  }

  /**
   * 更新所有模块客户端的 WebSocket
   */
  private updateClientsWebSocket(): void {
    if (this.ws) {
      this._ptyClient?.setWebSocket(this.ws);
      this._voiceClient?.setWebSocket(this.ws);
      this._llmClient?.setWebSocket(this.ws);
      this._utilsClient?.setWebSocket(this.ws);
    }
  }

  /**
   * 处理 WebSocket 消息
   */
  private handleWebSocketMessage(event: MessageEvent): void {
    // 处理二进制消息 (PTY 输出)
    if (event.data instanceof ArrayBuffer) {
      this._ptyClient?.handleBinaryMessage(event.data);
      return;
    }
    
    if (event.data instanceof Blob) {
      event.data.arrayBuffer().then(buffer => {
        this._ptyClient?.handleBinaryMessage(buffer);
      });
      return;
    }
    
    // 处理 JSON 消息
    try {
      const msg: ServerMessage = JSON.parse(event.data);
      
      // 根据模块分发消息
      switch (msg.module) {
        case 'pty':
          this._ptyClient?.handleMessage(msg);
          break;
        case 'voice':
          this._voiceClient?.handleMessage(msg);
          break;
        case 'llm':
          this._llmClient?.handleMessage(msg);
          break;
        case 'utils':
          this._utilsClient?.handleMessage(msg);
          break;
        default:
          debugWarn('[ServerManager] 未知模块消息:', msg);
      }
    } catch (error) {
      errorLog('[ServerManager] 解析消息失败:', error);
    }
  }

  /**
   * 处理 WebSocket 断开
   */
  private handleWebSocketDisconnect(): void {
    // 尝试重连
    setTimeout(() => {
      if (!this.isShuttingDown && this.port !== null) {
        debugLog('[ServerManager] 尝试重连 WebSocket...');
        this.connectWebSocket().catch(error => {
          errorLog('[ServerManager] WebSocket 重连失败:', error);
        });
      }
    }, 1000);
  }

  /**
   * 设置服务器退出处理器
   * 

   */
  private setupServerExitHandler(): void {
    if (!this.process) {
      return;
    }

    this.process.on('exit', (code, signal) => {
      this.port = null;
      this.serverStartPromise = null;
      
      if (this.isShuttingDown) {
        debugLog(`[ServerManager] 服务器已停止: code=${code}, signal=${signal}`);
        return;
      }
      
      errorLog(`[ServerManager] 服务器退出: code=${code}, signal=${signal}`);
      
      const isAbnormalExit = code !== 0 && code !== null;
      
      if (isAbnormalExit) {
        new Notice(
          t('notices.serverCrashed', { 
            code: String(code), 
            signal: signal || 'N/A' 
          }) || `服务器崩溃: code=${code}, signal=${signal}`,
          5000
        );
      }

      // 尝试自动重启
      this.attemptRestart();
    });
  }

  /**
   * 尝试自动重启服务器
   */
  private attemptRestart(): void {
    if (this.restartAttempts < this.maxRestartAttempts) {
      this.restartAttempts++;
      debugLog(
        `[ServerManager] 尝试重启服务器 ` +
        `(${this.restartAttempts}/${this.maxRestartAttempts})`
      );
      
      const delay = 1000 * Math.pow(2, this.restartAttempts - 1);
      
      setTimeout(() => {
        this.ensureServer()
          .then(() => {
            new Notice(
              t('notices.serverRestartSuccess') || '服务器重启成功',
              3000
            );
          })
          .catch(err => {
            errorLog('[ServerManager] 服务器重启失败:', err);
            new Notice(
              t('notices.serverRestartFailed') || '服务器重启失败',
              0
            );
          });
      }, delay);
    } else {
      new Notice(
        t('notices.serverRestartFailed') || '服务器重启失败，已达到最大重试次数',
        0
      );
    }
  }

  /**
   * 处理服务器进程错误
   */
  private handleServerError(error: Error): void {
    const errorCode = (error as NodeJS.ErrnoException).code;
    
    if (errorCode === 'ENOENT') {
      new Notice(
        '❌ 无法启动服务器\n\n' +
        '错误: 二进制文件未找到\n' +
        '请重新加载插件',
        0
      );
    } else if (errorCode === 'EACCES') {
      new Notice(
        '❌ 无法启动服务器\n\n' +
        '错误: 权限不足\n' +
        '请检查文件权限',
        0
      );
    } else {
      new Notice(
        `❌ 服务器启动失败\n\n` +
        `错误: ${error.message}\n` +
        `请查看控制台获取详细信息`,
        0
      );
    }
    
    this.emit('server-error', error);
  }

  /**
   * 触发事件
   */
  private emit<K extends keyof ServerEvents>(
    event: K,
    ...args: Parameters<ServerEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          (listener as (...args: Parameters<ServerEvents[K]>) => void)(...args);
        } catch (error) {
          errorLog(`[ServerManager] 事件处理器错误 (${event}):`, error);
        }
      });
    }
  }

  /**
   * 重置关闭状态（用于重新启用服务）
   */
  resetShutdownState(): void {
    this.isShuttingDown = false;
    this.restartAttempts = 0;
  }
}
