/**
 * ArchiveService - 笔记归档服务
 *
 * 功能：
 * - 移动文件到指定分类文件夹
 * - 移动附件
 * - 更新双向链接
 */

import type { App } from 'obsidian';
import { TFile, TFolder } from 'obsidian';
import type { SmartWorkflowSettings } from '../../settings/settings';
import { debugLog, errorLog } from '../../utils/logger';
import { t } from '../../i18n';

/**
 * 归档选项接口
 */
export interface ArchiveOptions {
  /** 目标文件夹路径 */
  targetPath: string;
  /** 是否移动附件 */
  moveAttachments?: boolean;
  /** 是否更新链接 */
  updateLinks?: boolean;
  /** 是否创建目标文件夹（如果不存在） */
  createFolder?: boolean;
}

/**
 * 归档结果接口
 */
export interface ArchiveResult {
  /** 是否成功 */
  success: boolean;
  /** 新文件路径 */
  newPath?: string;
  /** 移动的附件数量 */
  movedAttachments?: number;
  /** 错误信息（如果失败） */
  error?: string;
}

/**
 * ArchiveService 类
 */
export class ArchiveService {
  private app: App;
  private settings: SmartWorkflowSettings;

  constructor(app: App, settings: SmartWorkflowSettings) {
    this.app = app;
    this.settings = settings;
  }

  /**
   * 归档文件到指定路径
   * @param file 要归档的文件
   * @param options 归档选项
   * @returns 归档结果
   */
  async archiveFile(file: TFile, options: ArchiveOptions): Promise<ArchiveResult> {
    try {
      // 1. 确保目标文件夹存在
      if (options.createFolder) {
        await this.ensureFolderExists(options.targetPath);
      }

      const targetFolder = this.app.vault.getAbstractFileByPath(options.targetPath);
      if (!targetFolder || !(targetFolder instanceof TFolder)) {
        return {
          success: false,
          error: t('archiving.service.targetNotExist', { path: options.targetPath }),
        };
      }

      // 2. 构建新文件路径
      const newPath = `${options.targetPath}/${file.name}`;

      // 检查目标路径是否已存在同名文件
      const existingFile = this.app.vault.getAbstractFileByPath(newPath);
      if (existingFile) {
        return {
          success: false,
          error: t('archiving.service.fileExists', { path: newPath }),
        };
      }

      debugLog('[ArchiveService] 开始归档文件:', file.path, '→', newPath);

      // 3. 移动附件（如果需要）
      let movedAttachments = 0;
      if (options.moveAttachments && this.settings.archiving.moveAttachments) {
        movedAttachments = await this.moveAttachments(file, options.targetPath);
      }

      // 4. 移动文件
      await this.app.fileManager.renameFile(file, newPath);

      debugLog('[ArchiveService] 文件移动成功:', newPath);

      // 5. Obsidian 的 renameFile 会自动更新所有双向链接，无需手动处理

      return {
        success: true,
        newPath,
        movedAttachments,
      };
    } catch (error) {
      errorLog('[ArchiveService] 归档失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 确保文件夹存在，如果不存在则创建
   * @param path 文件夹路径
   */
  private async ensureFolderExists(path: string): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(path);

    if (folder instanceof TFolder) {
      return; // 文件夹已存在
    }

    try {
      await this.app.vault.createFolder(path);
      debugLog('[ArchiveService] 创建文件夹:', path);
    } catch (error) {
      // 如果文件夹已存在，忽略错误
      if (error.message && !error.message.includes('already exists')) {
        throw error;
      }
    }
  }

  /**
   * 移动文件的附件
   * @param file 源文件
   * @param targetFolderPath 目标文件夹路径
   * @returns 移动的附件数量
   */
  private async moveAttachments(file: TFile, targetFolderPath: string): Promise<number> {
    let movedCount = 0;

    try {
      // 获取文件中的所有链接
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) return 0;

      const attachments = new Set<string>();

      // 从嵌入链接中查找附件
      if (cache.embeds) {
        for (const embed of cache.embeds) {
          const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
            embed.link,
            file.path
          );
          if (linkedFile && this.isAttachment(linkedFile)) {
            attachments.add(linkedFile.path);
          }
        }
      }

      // 从普通链接中查找附件
      if (cache.links) {
        for (const link of cache.links) {
          const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
            link.link,
            file.path
          );
          if (linkedFile && this.isAttachment(linkedFile)) {
            attachments.add(linkedFile.path);
          }
        }
      }

      // 移动所有附件
      for (const attachmentPath of attachments) {
        const attachment = this.app.vault.getAbstractFileByPath(attachmentPath);
        if (attachment instanceof TFile) {
          const newAttachmentPath = `${targetFolderPath}/${attachment.name}`;

          // 检查目标是否已存在
          const existing = this.app.vault.getAbstractFileByPath(newAttachmentPath);
          if (!existing) {
            await this.app.fileManager.renameFile(attachment, newAttachmentPath);
            movedCount++;
            debugLog('[ArchiveService] 移动附件:', attachment.path, '→', newAttachmentPath);
          }
        }
      }
    } catch (error) {
      errorLog('[ArchiveService] 移动附件失败:', error);
    }

    return movedCount;
  }

  /**
   * 判断文件是否为附件
   * @param file 文件
   * @returns 是否为附件
   */
  private isAttachment(file: TFile): boolean {
    const attachmentExtensions = [
      'png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', // 图片
      'pdf', // PDF
      'mp3', 'wav', 'ogg', 'm4a', 'flac', // 音频
      'mp4', 'webm', 'ogv', 'mov', 'mkv', // 视频
      'zip', 'rar', '7z', 'tar', 'gz', // 压缩包
    ];

    const extension = file.extension.toLowerCase();
    return attachmentExtensions.includes(extension);
  }

  /**
   * 检查文件是否可以归档
   * @param file 文件
   * @returns 是否可以归档
   */
  canArchive(file: TFile): boolean {
    // 检查文件是否已经在归档区
    const baseFolder = this.settings.archiving.baseFolder;
    return !file.path.startsWith(baseFolder + '/');
  }
}
