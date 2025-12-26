import { existsSync } from 'fs';
import { platform } from 'os';

/**
 * 平台检测工具
 * 提供跨平台的 Shell 检测和路径解析功能
 */

/**
 * 获取当前平台的默认 Shell 程序
 * 
 * Windows: 优先返回 PowerShell，回退到 cmd
 * macOS/Linux: 从环境变量 SHELL 获取，回退到 /bin/bash
 * 
 * @returns 默认 Shell 程序的类型标识符
 */
export function getDefaultShell(): string {
  const currentPlatform = platform();
  
  if (currentPlatform === 'win32') {
    // Windows 平台:默认使用 CMD (更稳定)
    const cmdPath = 'C:\\Windows\\System32\\cmd.exe';
    const pwshPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

    // 优先 CMD,因为在终端环境中更稳定
    if (existsSync(cmdPath)) {
      return 'cmd';
    }
    // 回退到 PowerShell
    if (existsSync(pwshPath)) {
      return 'powershell';
    }
    return 'cmd';
  } else if (currentPlatform === 'darwin' || currentPlatform === 'linux') {
    // macOS 和 Linux：从环境变量获取
    const shellEnv = process.env.SHELL;
    if (shellEnv) {
      // 从路径中提取 shell 名称
      const shellName = shellEnv.split('/').pop() || 'bash';
      return shellName;
    }
    // 回退到 bash
    return 'bash';
  }
  
  // 未知平台，回退到 bash
  return 'bash';
}

/**
 * 根据 Shell 类型获取完整路径
 * 
 * 支持的 Shell 类型：
 * - Windows: cmd, powershell, wsl
 * - macOS/Linux: bash, zsh, sh, fish
 * - default: 自动检测平台默认 Shell
 * 
 * @param shellType Shell 类型标识符
 * @returns Shell 程序的完整路径
 */
export function getShellPath(shellType: string): string {
  // 如果是 "default"，先获取默认 Shell 类型
  if (shellType === 'default' || !shellType) {
    const defaultShellType = getDefaultShell();
    return getShellPath(defaultShellType);
  }
  
  const currentPlatform = platform();
  
  if (currentPlatform === 'win32') {
    // Windows 平台
    switch (shellType.toLowerCase()) {
      case 'cmd':
        return 'C:\\Windows\\System32\\cmd.exe';
      case 'powershell':
        return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
      case 'wsl':
        return 'C:\\Windows\\System32\\wsl.exe';
      case 'gitbash': {
        // Git Bash 常见安装路径
        const gitBashPaths = [
          'C:\\Program Files\\Git\\bin\\bash.exe',
          'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
          `${process.env.USERPROFILE}\\AppData\\Local\\Programs\\Git\\bin\\bash.exe`
        ];
        
        // 检查路径是否存在
        for (const path of gitBashPaths) {
          if (existsSync(path)) {
            return path;
          }
        }
        
        // 如果都不存在，返回最常见的路径
        return 'C:\\Program Files\\Git\\bin\\bash.exe';
      }
      default:
        // 如果是自定义路径，直接返回
        return shellType;
    }
  } else if (currentPlatform === 'darwin' || currentPlatform === 'linux') {
    // macOS 和 Linux 平台
    switch (shellType.toLowerCase()) {
      case 'bash':
        return '/bin/bash';
      case 'zsh':
        return '/bin/zsh';
      case 'sh':
        return '/bin/sh';
      case 'fish':
        return '/usr/bin/fish';
      default:
        // 尝试从环境变量获取
        if (process.env.SHELL && process.env.SHELL.includes(shellType)) {
          return process.env.SHELL;
        }
        // 如果是自定义路径，直接返回
        return shellType;
    }
  }
  
  // 未知平台，返回原始值
  return shellType;
}

/**
 * 验证 Shell 路径是否有效
 * 
 * 检查指定路径的文件是否存在
 * 
 * @param path Shell 程序的路径
 * @returns 如果路径有效返回 true，否则返回 false
 */
export function validateShellPath(path: string): boolean {
  if (!path || path.trim() === '') {
    return false;
  }
  
  try {
    return existsSync(path);
  } catch (error) {
    // 如果检查过程中出现错误（如权限问题），返回 false
    return false;
  }
}
