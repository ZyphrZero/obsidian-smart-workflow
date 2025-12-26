/**
 * TerminalService - 基于 Rust PTY 服务器的终端服务
 * 
 * 职责:
 * 1. 管理 Rust PTY 服务器进程的生命周期
 * 2. 管理所有终端实例
 * 3. 处理服务器崩溃和自动重启
 * 4. 集成 BinaryManager 确保二进制文件可用
 */

import { App, Notice } from 'obsidian';
import { spawn, ChildProcess } from 'child_process';
import { BinaryManager, BinaryManagerError, BinaryErrorCode } from './binaryManager';
import { TerminalSettings, getCurrentPlatformShell, getCurrentPlatformCustomShellPath } from '../../settings/settings';
import { TerminalInstance } from './terminalInstance';
import { debugLog, debugWarn, errorLog } from '../../utils/logger';
import { t } from '../../i18n';

// 预加载 TerminalInstance 模块，避免首次创建终端时的动态 import 延迟
let terminalInstanceModule: typeof import('./terminalInstance') | null = null;
const preloadTerminalInstance = async () => {
  if (!terminalInstanceModule) {
    terminalInstanceModule = await import('./terminalInstance');
  }
  return terminalInstanceModule;
};
// 立即开始预加载
preloadTerminalInstance();

/**
 * 服务器信息
 */
export interface ServerInfo {
  port: number;  // 监听端口
  pid: number;   // 进程 PID
}

/**
 * TerminalService
 */
export class TerminalService {
  private app: App;
  private settings: TerminalSettings;
  private binaryManager: BinaryManager;
  
  // 服务器进程管理
  private ptyServerProcess: ChildProcess | null = null;
  private ptyServerPort: number | null = null;
  private serverStartPromise: Promise<number> | null = null;
  
  // 服务器重启管理
  private serverRestartAttempts = 0;
  private readonly maxRestartAttempts: number = 3;
  
  // 终端实例管理
  private terminals: Map<string, TerminalInstance> = new Map();

  constructor(app: App, settings: TerminalSettings, pluginDir: string) {
    this.app = app;
    this.settings = settings;
    
    // 从 package.json 读取版本号，GitHub repo 需要配置
    const version = '1.0.0'; // TODO: 从 manifest.json 或 package.json 读取
    const githubRepo = 'ZyphrZero/obsidian-smart-workflow'; // TODO: 配置实际的 GitHub repo
    
    this.binaryManager = new BinaryManager(pluginDir, version, githubRepo);
  }

  /**
   * 确保 PTY 服务器正在运行（单例模式）
   * 
   * @returns PTY 服务器监听的端口号
   */
  async ensurePtyServer(): Promise<number> {
    // 如果服务器已经启动，直接返回端口号
    if (this.ptyServerPort !== null) {
      return this.ptyServerPort;
    }

    // 如果正在启动，等待启动完成
    if (this.serverStartPromise) {
      return this.serverStartPromise;
    }

    // 启动服务器
    this.serverStartPromise = this.startPtyServer();
    return this.serverStartPromise;
  }

  /**
   * 启动 PTY 服务器进程
   * 
   * @returns PTY 服务器监听的端口号
   * @throws Error 如果服务器启动失败
   */
  private async startPtyServer(): Promise<number> {
    try {
      debugLog('[TerminalService] 启动 PTY 服务器...');
      
      const binaryPath = await this.binaryManager.ensureBinary();
      debugLog('[TerminalService] 二进制文件路径:', binaryPath);
      
      // 使用端口 0 让系统自动分配可用端口
      this.ptyServerProcess = spawn(binaryPath, ['--port', '0'], {
        stdio: ['pipe', 'pipe', 'pipe'], // 捕获 stderr 以避免日志干扰
        env: { 
          ...process.env, 
          // 确保 TERM 环境变量存在，否则 clear/vim 等命令无法正常工作
          TERM: process.env.TERM || 'xterm-256color' 
        },
        windowsHide: true, // Windows: 隐藏控制台窗口
        detached: false    // 不分离进程，确保随插件一起退出
      });
      
      debugLog('[TerminalService] PTY 服务器进程已启动, PID:', this.ptyServerProcess.pid);
      
      // 监听进程错误事件
      this.ptyServerProcess.on('error', (error) => {
        errorLog('[TerminalService] PTY 服务器进程错误:', error);
        this.handleServerError(error);
      });
      
      const port = await this.waitForServerPort();
      this.ptyServerPort = port;
      this.serverRestartAttempts = 0; // 重置重启计数
      
      debugLog(`[TerminalService] PTY 服务器已启动，端口: ${port}`);
      
      this.setupServerExitHandler();
      
      return port;
      
    } catch (error) {
      this.serverStartPromise = null;
      
      if (error instanceof BinaryManagerError) {
        this.handleBinaryManagerError(error);
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errorLog('[TerminalService] 启动 PTY 服务器失败:', errorMessage);
        
        new Notice(t('notices.ptyServerStartFailed'), 0);
      }
      
      throw error;
    }
  }

  /**
   * 等待 PTY 服务器输出端口信息
   * 
   * @returns 服务器监听的端口号
   * @throws Error 如果无法获取端口信息或超时
   */
  private async waitForServerPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this.ptyServerProcess || !this.ptyServerProcess.stdout) {
        reject(new Error(t('terminalService.processNotStarted')));
        return;
      }

      let buffer = '';
      
      const timeout = setTimeout(() => {
        this.ptyServerProcess?.stdout?.off('data', onData);
        
        const errorMsg = t('terminalService.portInfoTimeout');
        errorLog('[TerminalService]', errorMsg);
        reject(new Error(errorMsg));
      }, 10000);

      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        
        // 格式: {"port": 12345, "pid": 67890}
        try {
          const match = buffer.match(/\{[^}]+\}/);
          if (match) {
            const info: ServerInfo = JSON.parse(match[0]);
            if (info.port && typeof info.port === 'number') {
              clearTimeout(timeout);
              if (this.ptyServerProcess?.stdout) {
                this.ptyServerProcess.stdout.off('data', onData);
              }
              debugLog('[TerminalService] 解析到服务器信息:', info);
              resolve(info.port);
            }
          }
        } catch (e) {
          // JSON 解析失败，继续等待更多数据
          debugLog('[TerminalService] JSON 解析失败，继续等待:', e);
        }
      };

      this.ptyServerProcess.stdout.on('data', onData);

      this.ptyServerProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      
      this.ptyServerProcess.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0 && code !== null) {
          reject(new Error(t('terminalService.startFailedWithCode', { code: String(code) })));
        }
      });
    });
  }

  /**
   * 设置服务器退出事件处理器
   */
  private setupServerExitHandler(): void {
    if (!this.ptyServerProcess) {
      return;
    }

    this.ptyServerProcess.on('exit', (code, signal) => {
      errorLog(`[TerminalService] PTY 服务器退出: code=${code}, signal=${signal}`);
      
      // 清理状态
      this.ptyServerPort = null;
      this.serverStartPromise = null;
      
      this.terminals.forEach(terminal => {
        terminal.handleServerCrash();
      });

      const isAbnormalExit = code !== 0 && code !== null;
      
      if (isAbnormalExit) {
        new Notice(
          t('notices.terminal.serverCrashed', { 
            code: String(code), 
            signal: signal || 'N/A' 
          }),
          5000
        );
      }

      if (this.serverRestartAttempts < this.maxRestartAttempts) {
        this.serverRestartAttempts++;
        debugLog(
          `[TerminalService] 尝试重启服务器 ` +
          `(${this.serverRestartAttempts}/${this.maxRestartAttempts})`
        );
        
        // 使用指数退避策略
        const delay = 1000 * Math.pow(2, this.serverRestartAttempts - 1);
        
        setTimeout(() => {
          this.ensurePtyServer()
            .then(() => {
              new Notice(t('notices.terminal.serverRestartSuccess'), 3000);
            })
            .catch(err => {
              errorLog('[TerminalService] 服务器重启失败:', err);
              new Notice(t('notices.terminal.serverRestartFailed'), 0);
            });
        }, delay);
      } else {
        new Notice(t('notices.terminal.serverRestartFailed'), 0);
      }
    });
  }

  /**
   * 停止 PTY 服务器进程
   */
  async stopPtyServer(): Promise<void> {
    if (this.ptyServerProcess) {
      debugLog('[TerminalService] 停止 PTY 服务器');
      
      try {
        // 发送 SIGTERM 信号优雅关闭
        this.ptyServerProcess.kill('SIGTERM');
        
        // 等待进程退出
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            // 如果 1 秒后还没退出，强制终止
            if (this.ptyServerProcess && !this.ptyServerProcess.killed) {
              debugWarn('[TerminalService] 强制终止 PTY 服务器');
              this.ptyServerProcess.kill('SIGKILL');
            }
            resolve();
          }, 1000);

          if (this.ptyServerProcess) {
            this.ptyServerProcess.once('exit', () => {
              clearTimeout(timeout);
              resolve();
            });
          }
        });
      } catch (error) {
        errorLog('[TerminalService] 停止 PTY 服务器时出错:', error);
      } finally {
        this.ptyServerProcess = null;
        this.ptyServerPort = null;
        this.serverStartPromise = null;
      }
    }
  }

  /**
   * 创建新的终端实例
   * 
   * @returns 创建的终端实例
   * @throws Error 如果终端创建失败
   */
  async createTerminal(): Promise<TerminalInstance> {
    try {
      const port = await this.ensurePtyServer();
      
      debugLog(`[TerminalService] 创建终端，使用服务器端口: ${port}`);

      // 使用预加载的模块
      const { TerminalInstance } = await preloadTerminalInstance();
      
      // 获取工作目录（如果启用了自动进入项目目录）
      let cwd: string | undefined;
      if (this.settings.autoEnterVaultDirectory) {
        cwd = this.getVaultPath();
        if (cwd) {
          debugLog(`[TerminalService] 自动进入项目目录: ${cwd}`);
        }
      }
      
      // 处理自定义 shell 路径
      const currentShell = getCurrentPlatformShell(this.settings);
      let shellType: string = currentShell;
      if (currentShell === 'custom') {
        const customPath = getCurrentPlatformCustomShellPath(this.settings);
        if (customPath) {
          shellType = `custom:${customPath}`;
        }
      }
      
      // 获取 shell 启动参数
      const shellArgs = this.settings.shellArgs.length > 0 ? this.settings.shellArgs : undefined;
      
      // 创建终端实例
      const terminal = new TerminalInstance({
        shellType: shellType,
        shellArgs: shellArgs,
        cwd: cwd,
        fontSize: this.settings.fontSize,
        fontFamily: this.settings.fontFamily,
        cursorStyle: this.settings.cursorStyle,
        cursorBlink: this.settings.cursorBlink,
        scrollback: this.settings.scrollback,
        preferredRenderer: this.settings.preferredRenderer,
        useObsidianTheme: this.settings.useObsidianTheme,
        backgroundColor: this.settings.backgroundColor,
        foregroundColor: this.settings.foregroundColor,
        backgroundImage: this.settings.backgroundImage,
        backgroundImageOpacity: this.settings.backgroundImageOpacity,
        backgroundImageSize: this.settings.backgroundImageSize,
        backgroundImagePosition: this.settings.backgroundImagePosition,
        enableBlur: this.settings.enableBlur,
        blurAmount: this.settings.blurAmount,
        textOpacity: this.settings.textOpacity,
      });
      
      // 初始化终端（建立 WebSocket 连接）
      await terminal.initialize(port);
      
      this.terminals.set(terminal.id, terminal);
      
      return terminal;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorLog('[TerminalService] 创建终端实例失败:', errorMessage);
      
      new Notice(t('notices.terminal.createFailed', { message: errorMessage }), 5000);
      
      throw error;
    }
  }

  /**
   * 获取 Vault 路径
   * @returns Vault 的绝对路径，如果无法获取则返回 undefined
   */
  private getVaultPath(): string | undefined {
    try {
      const adapter = this.app.vault.adapter as any;
      if (adapter && typeof adapter.getBasePath === 'function') {
        return adapter.getBasePath();
      }
    } catch (error) {
      debugWarn('[TerminalService] 无法获取 Vault 路径:', error);
    }
    return undefined;
  }

  /**
   * 获取终端实例
   * 
   * @param id 终端实例 ID
   * @returns 终端实例，如果不存在则返回 undefined
   */
  getTerminal(id: string): TerminalInstance | undefined {
    return this.terminals.get(id);
  }

  /**
   * 获取所有终端实例
   * 
   * @returns 所有终端实例数组
   */
  getAllTerminals(): TerminalInstance[] {
    return Array.from(this.terminals.values());
  }

  /**
   * 销毁指定的终端实例
   * 
   * @param id 终端实例 ID
   */
  async destroyTerminal(id: string): Promise<void> {
    const terminal = this.terminals.get(id);
    if (terminal) {
      try {
        await terminal.destroy();
      } catch (error) {
        errorLog(`[TerminalService] 销毁终端 ${id} 失败:`, error);
      } finally {
        this.terminals.delete(id);
      }
    }
  }

  /**
   * 销毁所有终端实例
   */
  async destroyAllTerminals(): Promise<void> {
    const destroyPromises: Promise<void>[] = [];
    const failedTerminals: string[] = [];
    
    for (const [id, terminal] of this.terminals.entries()) {
      const destroyPromise = terminal.destroy().catch(error => {
        errorLog(`[TerminalService] 销毁终端 ${id} 失败:`, error);
        failedTerminals.push(id);
      });
      destroyPromises.push(destroyPromise);
    }
    
    // 等待所有销毁操作完成
    await Promise.allSettled(destroyPromises);
    
    // 清空映射
    this.terminals.clear();
    
    // 如果有失败的终端，记录警告
    if (failedTerminals.length > 0) {
      debugWarn(`[TerminalService] 以下终端清理失败: ${failedTerminals.join(', ')}`);
    }
  }

  /**
   * 更新设置
   * 
   * @param settings 新的设置
   */
  updateSettings(settings: TerminalSettings): void {
    this.settings = settings;
  }

  /**
   * 处理 BinaryManager 错误
   * 
   * @param error BinaryManager 错误
   */
  private handleBinaryManagerError(error: BinaryManagerError): void {
    errorLog('[TerminalService] BinaryManager 错误:', error);
    
    switch (error.code) {
      case BinaryErrorCode.BINARY_MISSING:
        new Notice(
          '❌ 二进制文件缺失\n\n' +
          error.message +
          (error.downloadUrl ? `\n\n手动下载: ${error.downloadUrl}` : ''),
          0
        );
        break;
        
      case BinaryErrorCode.CHECKSUM_FAILED:
        new Notice(
          '❌ 文件校验失败\n\n' +
          error.message +
          '\n\n文件可能已损坏，请重试',
          0
        );
        break;
        
      case BinaryErrorCode.NETWORK_ERROR:
        new Notice(
          '❌ 网络错误\n\n' +
          error.message +
          '\n\n请检查网络连接' +
          (error.downloadUrl ? `\n或手动下载: ${error.downloadUrl}` : ''),
          0
        );
        break;
        
      case BinaryErrorCode.PERMISSION_ERROR:
        new Notice(
          '❌ 权限错误\n\n' +
          error.message,
          0
        );
        break;
        
      case BinaryErrorCode.DISK_SPACE_ERROR:
        new Notice(
          '❌ 磁盘空间不足\n\n' +
          error.message +
          '\n\n请清理磁盘空间后重试',
          0
        );
        break;
        
      case BinaryErrorCode.CORRUPTED_FILE:
        new Notice(
          '❌ 文件损坏\n\n' +
          error.message +
          '\n\n正在重新下载...',
          5000
        );
        break;
        
      default:
        new Notice(
          '❌ 未知错误\n\n' +
          error.message,
          0
        );
    }
  }

  /**
   * 处理服务器进程错误
   * 
   * @param error 错误对象
   */
  private handleServerError(error: Error): void {
    const errorCode = (error as NodeJS.ErrnoException).code;
    
    if (errorCode === 'ENOENT') {
      new Notice(
        '❌ 无法启动 PTY 服务器\n\n' +
        '错误: 二进制文件未找到\n' +
        '请重新加载插件',
        0
      );
    } else if (errorCode === 'EACCES') {
      new Notice(
        '❌ 无法启动 PTY 服务器\n\n' +
        '错误: 权限不足\n' +
        '请检查文件权限',
        0
      );
    } else {
      new Notice(
        `❌ PTY 服务器启动失败\n\n` +
        `错误: ${error.message}\n` +
        `请查看控制台获取详细信息`,
        0
      );
    }
  }

  /**
   * 生成终端 ID
   * 
   * @returns 唯一的终端 ID
   */
  private generateTerminalId(): string {
    return `terminal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取服务器状态
   * 
   * @returns 服务器是否正在运行
   */
  isServerRunning(): boolean {
    return this.ptyServerPort !== null && this.ptyServerProcess !== null;
  }

  /**
   * 获取服务器端口
   * 
   * @returns 服务器端口，如果未运行则返回 null
   */
  getServerPort(): number | null {
    return this.ptyServerPort;
  }

  /**
   * 获取终端数量
   * 
   * @returns 当前终端实例数量
   */
  getTerminalCount(): number {
    return this.terminals.size;
  }
}
