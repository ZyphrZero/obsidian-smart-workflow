/**
 * BinaryDownloader - 二进制文件下载器
 * 
 * 职责:
 * 1. 检测当前平台
 * 2. 从 GitHub Release 下载对应的二进制文件
 * 3. 校验 SHA256
 * 4. 管理下载进度
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import * as http from 'http';
import * as https from 'https';
import { requestUrl, Notice } from 'obsidian';
import { debugLog, debugWarn, errorLog } from '../../utils/logger';
import { t } from '../../i18n';

/** 下载进度回调 */
export type DownloadProgressCallback = (progress: DownloadProgress) => void;

/** 下载进度信息 */
export interface DownloadProgress {
  /** 当前阶段 */
  stage: 'checking' | 'downloading' | 'verifying' | 'complete' | 'error';
  /** 进度百分比 (0-100) */
  percent: number;
  /** 已下载字节数 */
  downloadedBytes?: number;
  /** 总字节数 */
  totalBytes?: number;
  /** 错误信息 */
  error?: string;
}

/** 二进制信息 */
interface BinaryInfo {
  /** 文件名 */
  filename: string;
  /** 下载 URL */
  url: string;
  /** SHA256 校验和 URL */
  checksumUrl: string;
}

/** GitHub Release Asset */
interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

/** GitHub Release */
interface GitHubRelease {
  tag_name: string;
  assets: GitHubAsset[];
}

export class BinaryDownloader {
  /** GitHub 仓库 */
  private readonly repo = 'ZyphrZero/obsidian-smart-workflow';
  
  /** 插件目录 */
  private pluginDir: string;
  
  /** 当前插件版本 */
  private version: string;
  
  /** 下载加速源 */
  private downloadAcceleratorUrl: string;

  constructor(pluginDir: string, version: string, downloadAcceleratorUrl: string = '') {
    this.pluginDir = pluginDir;
    this.version = version;
    this.downloadAcceleratorUrl = downloadAcceleratorUrl;
  }

  /**
   * 检查二进制文件是否存在且版本匹配
   */
  binaryExists(): boolean {
    const binaryPath = this.getBinaryPath();
    if (!fs.existsSync(binaryPath)) {
      return false;
    }
    
    // 检查版本是否匹配
    const installedVersion = this.getInstalledVersion();
    return installedVersion === this.version;
  }
  
  /**
   * 检查是否需要更新（文件存在但版本不匹配）
   */
  needsUpdate(): boolean {
    const binaryPath = this.getBinaryPath();
    if (!fs.existsSync(binaryPath)) {
      return false; // 文件不存在，需要下载而非更新
    }
    
    const installedVersion = this.getInstalledVersion();
    return installedVersion !== this.version;
  }
  
  /**
   * 获取已安装的二进制版本
   */
  private getInstalledVersion(): string | null {
    try {
      const binaryPath = this.getBinaryPath();
      if (!fs.existsSync(binaryPath)) {
        return null;
      }

      const result = spawnSync(binaryPath, ['--version'], {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 2000,
      });

      if (result.error || result.status !== 0) {
        debugWarn('[BinaryDownloader] 获取二进制版本失败:', result.error ?? result.stderr);
        return null;
      }

      const rawVersion = (result.stdout || '').trim();
      if (!rawVersion) {
        return null;
      }

      const version = rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion;
      return version || null;
    } catch (error) {
      debugWarn('[BinaryDownloader] 获取二进制版本异常:', error);
    }
    
    return null;
  }

  /**
   * 获取二进制文件路径
   */
  getBinaryPath(): string {
    const platform = process.platform;
    const arch = process.arch;
    const ext = platform === 'win32' ? '.exe' : '';
    const filename = `smart-workflow-server-${platform}-${arch}${ext}`;
    
    return path.join(this.pluginDir, 'binaries', filename);
  }

  /**
   * 下载二进制文件
   */
  async download(onProgress?: DownloadProgressCallback): Promise<void> {
    const notify = (progress: DownloadProgress) => {
      onProgress?.(progress);
    };

    try {
      notify({ stage: 'checking', percent: 0 });
      
      // 获取二进制信息
      const binaryInfo = await this.getBinaryInfo();
      
      if (!binaryInfo) {
        throw new Error(t('notices.binaryNotAvailable') || '当前平台没有可用的二进制文件');
      }

      // 确保目录存在
      const binariesDir = path.join(this.pluginDir, 'binaries');
      if (!fs.existsSync(binariesDir)) {
        fs.mkdirSync(binariesDir, { recursive: true });
      }

      notify({ stage: 'downloading', percent: 10 });
      
      // 下载二进制文件
      const binaryPath = this.getBinaryPath();
      await this.downloadFile(binaryInfo.url, binaryPath, (percent, downloadedBytes, totalBytes) => {
        // 下载阶段占 10% - 80%
        notify({
          stage: 'downloading',
          percent: 10 + percent * 0.7,
          downloadedBytes,
          totalBytes,
        });
      });

      notify({ stage: 'verifying', percent: 85 });
      
      // 下载并验证校验和
      try {
        const checksumContent = await this.fetchText(binaryInfo.checksumUrl);
        const expectedHash = checksumContent.split(/\s+/)[0].toLowerCase();
        
        const actualHash = await this.calculateSHA256(binaryPath);
        
        if (actualHash !== expectedHash) {
          // 删除损坏的文件
          fs.unlinkSync(binaryPath);
          throw new Error(
            t('notices.checksumMismatch') || 
            `校验和不匹配: 期望 ${expectedHash}, 实际 ${actualHash}`
          );
        }
        
        debugLog('[BinaryDownloader] SHA256 校验通过');
      } catch (checksumError) {
        // 校验和下载失败时，仅警告但不阻止使用
        debugWarn('[BinaryDownloader] 校验和验证失败:', checksumError);
      }

      // 设置可执行权限 (Unix)
      if (process.platform !== 'win32') {
        fs.chmodSync(binaryPath, 0o755);
      }

      notify({ stage: 'complete', percent: 100 });
      
      debugLog('[BinaryDownloader] 二进制文件下载完成:', binaryPath);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errorLog('[BinaryDownloader] 下载失败:', errorMessage);
      
      notify({ 
        stage: 'error', 
        percent: 0, 
        error: errorMessage 
      });
      
      throw error;
    }
  }

  /**
   * 获取二进制文件信息
   */
  private async getBinaryInfo(): Promise<BinaryInfo | null> {
    const platform = process.platform;
    const arch = process.arch;
    const ext = platform === 'win32' ? '.exe' : '';
    const filename = `smart-workflow-server-${platform}-${arch}${ext}`;

    // 尝试获取当前版本的 Release
    const releaseUrl = `https://api.github.com/repos/${this.repo}/releases/tags/${this.version}`;
    
    try {
      const response = await requestUrl({
        url: releaseUrl,
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'obsidian-smart-workflow',
        },
      });

      const release: GitHubRelease = response.json;
      
      // 查找对应平台的二进制文件
      const binaryAsset = release.assets.find(a => a.name === filename);
      const checksumAsset = release.assets.find(a => a.name === `${filename}.sha256`);
      
      if (binaryAsset) {
        const downloadUrl = this.applyDownloadAccelerator(binaryAsset.browser_download_url);
        const checksumUrl = checksumAsset?.browser_download_url
          ? this.applyDownloadAccelerator(checksumAsset.browser_download_url)
          : '';
        return {
          filename,
          url: downloadUrl,
          checksumUrl,
        };
      }
    } catch (error) {
      debugWarn('[BinaryDownloader] 获取指定版本 Release 失败，尝试最新版本');
    }

    // 回退到最新 Release
    const latestUrl = `https://api.github.com/repos/${this.repo}/releases/latest`;
    
    try {
      const response = await requestUrl({
        url: latestUrl,
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'obsidian-smart-workflow',
        },
      });

      const release: GitHubRelease = response.json;
      
      const binaryAsset = release.assets.find(a => a.name === filename);
      const checksumAsset = release.assets.find(a => a.name === `${filename}.sha256`);
      
      if (binaryAsset) {
        const downloadUrl = this.applyDownloadAccelerator(binaryAsset.browser_download_url);
        const checksumUrl = checksumAsset?.browser_download_url
          ? this.applyDownloadAccelerator(checksumAsset.browser_download_url)
          : '';
        return {
          filename,
          url: downloadUrl,
          checksumUrl,
        };
      }
    } catch (error) {
      errorLog('[BinaryDownloader] 获取最新 Release 失败:', error);
    }

    return null;
  }

  /**
   * 下载文件
   */
  private async downloadFile(
    url: string, 
    destPath: string,
    onProgress?: (percent: number, downloadedBytes: number, totalBytes: number) => void
  ): Promise<void> {
    debugLog('[BinaryDownloader] 开始下载:', url);
    await this.downloadFileWithRedirect(url, destPath, onProgress, 5);
    debugLog('[BinaryDownloader] 文件已保存:', destPath);
  }

  private async downloadFileWithRedirect(
    url: string,
    destPath: string,
    onProgress: ((percent: number, downloadedBytes: number, totalBytes: number) => void) | undefined,
    remainingRedirects: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;

      const request = client.get(
        urlObj,
        {
          headers: {
            'User-Agent': 'obsidian-smart-workflow',
          },
        },
        (response) => {
          const statusCode = response.statusCode ?? 0;
          const redirectLocation = response.headers.location;

          if (statusCode >= 300 && statusCode < 400 && redirectLocation) {
            response.resume();
            if (remainingRedirects <= 0) {
              reject(new Error('下载失败: 重定向次数过多'));
              return;
            }
            const nextUrl = new URL(redirectLocation, urlObj).toString();
            resolve(this.downloadFileWithRedirect(nextUrl, destPath, onProgress, remainingRedirects - 1));
            return;
          }

          if (statusCode !== 200) {
            response.resume();
            reject(new Error(`下载失败: HTTP ${statusCode}`));
            return;
          }

          const totalBytes = Number(response.headers['content-length'] || 0);
          let downloadedBytes = 0;
          let finished = false;

          const fileStream = fs.createWriteStream(destPath);

          const fail = (error: Error) => {
            if (finished) {
              return;
            }
            finished = true;
            fileStream.destroy();
            fs.unlink(destPath, () => reject(error));
          };

          response.on('data', (chunk: Buffer) => {
            downloadedBytes += chunk.length;
            if (totalBytes > 0) {
              const percent = Math.min(100, (downloadedBytes / totalBytes) * 100);
              onProgress?.(percent, downloadedBytes, totalBytes);
            }
          });

          response.on('error', fail);
          fileStream.on('error', fail);

          fileStream.on('finish', () => {
            if (finished) {
              return;
            }
            finished = true;
            onProgress?.(100, downloadedBytes, totalBytes);
            fileStream.close(() => resolve());
          });

          response.pipe(fileStream);
        }
      );

      request.on('error', (error) => reject(error));
    });
  }

  private applyDownloadAccelerator(url: string): string {
    const base = this.downloadAcceleratorUrl.trim();
    if (!base) {
      return url;
    }

    if (!/^https?:\/\//i.test(base)) {
      debugWarn('[BinaryDownloader] 下载加速源格式无效，已忽略:', base);
      return url;
    }

    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    return `${normalizedBase}${url}`;
  }

  /**
   * 获取文本内容
   */
  private async fetchText(url: string): Promise<string> {
    const response = await requestUrl({
      url,
      headers: {
        'User-Agent': 'obsidian-smart-workflow',
      },
    });

    return response.text;
  }

  /**
   * 计算文件 SHA256
   */
  private async calculateSHA256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}
