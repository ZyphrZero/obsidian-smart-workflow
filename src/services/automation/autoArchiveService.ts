/**
 * AutoArchiveService - 自动归档服务
 *
 * 功能:
 * - 通过命令/菜单手动触发
 * - 自动生成标签 + 智能归档
 */

import type { TFile, App} from 'obsidian';
import { Notice } from 'obsidian';
import type { SmartWorkflowSettings } from '../../settings/settings';
import type { TagService } from '../tagging/tagService';
import type { CategoryService } from '../categorizing/categoryService';
import type { ArchiveService } from '../archiving/archiveService';
import { debugLog, errorLog } from '../../utils/logger';
import { t } from '../../i18n';

/**
 * AutoArchiveService 类
 */
export class AutoArchiveService {
  private app: App;
  private settings: SmartWorkflowSettings;
  private tagService: TagService;
  private categoryService: CategoryService;
  private archiveService: ArchiveService;

  // 正在处理中的文件 (防止重复触发)
  private processingFiles: Set<string> = new Set();

  constructor(
    app: App,
    settings: SmartWorkflowSettings,
    tagService: TagService,
    categoryService: CategoryService,
    archiveService: ArchiveService
  ) {
    this.app = app;
    this.settings = settings;
    this.tagService = tagService;
    this.categoryService = categoryService;
    this.archiveService = archiveService;
  }

  /**
   * 检查文件是否可以执行自动归档
   * @param file 文件对象
   * @returns 是否可以执行
   */
  canProcess(file: TFile): boolean {
    // 检查自动归档是否启用
    if (!this.settings.autoArchive?.enabled) {
      return false;
    }

    // 检查是否在排除列表中
    const excludeFolders = this.settings.autoArchive.excludeFolders || [
      '03-归档区',
      '99-资源库',
    ];
    const isExcluded = excludeFolders.some(folder =>
      file.path.startsWith(folder + '/')
    );
    if (isExcluded) {
      return false;
    }

    // 检查是否已在归档区
    if (!this.archiveService.canArchive(file)) {
      return false;
    }

    return true;
  }

  /**
   * 执行自动归档流程 (手动触发)
   * @param file 文件
   */
  async execute(file: TFile): Promise<void> {
    // 检查是否正在处理中
    if (this.processingFiles.has(file.basename)) {
      debugLog('[AutoArchiveService] 文件正在处理中,跳过:', file.path);
      return;
    }

    // 标记为正在处理
    this.processingFiles.add(file.basename);

    debugLog('[AutoArchiveService] 开始自动归档流程:', file.path);
    new Notice(t('autoArchive.notices.processing', { filename: file.basename }));

    try {
      // 步骤1: 生成标签
      if (this.settings.autoArchive?.generateTags && this.settings.tagging.enabled) {
        debugLog('[AutoArchiveService] 步骤1: 生成标签');
        await this.autoGenerateTags(file);
      }

      // 步骤2: 智能归档
      if (this.settings.autoArchive?.performArchive && this.settings.archiving.enabled) {
        debugLog('[AutoArchiveService] 步骤2: 智能归档');
        await this.autoArchiveFile(file);
      }

      new Notice(t('autoArchive.notices.completed', { filename: file.basename }));
      debugLog('[AutoArchiveService] 自动归档流程完成:', file.path);
    } catch (error) {
      errorLog('[AutoArchiveService] 自动归档流程失败:', error);
      new Notice(t('autoArchive.notices.failed', { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      // 移除处理中标记
      this.processingFiles.delete(file.basename);
    }
  }

  /**
   * 自动生成标签
   * @param file 文件
   */
  private async autoGenerateTags(file: TFile): Promise<void> {
    try {
      const result = await this.tagService.generateTags(file);

      if (!result.success) {
        throw new Error(result.error || t('tagging.service.generateFailed'));
      }

      if (result.tags.length === 0) {
        debugLog('[AutoArchiveService] AI未生成标签,跳过');
        return;
      }

      // 应用标签
      await this.tagService.applyTags(file, result.allTags);
      debugLog('[AutoArchiveService] 已自动应用标签:', result.allTags);
      new Notice(t('autoArchive.notices.tagsGenerated', { count: result.tags.length.toString() }));
    } catch (error) {
      errorLog('[AutoArchiveService] 自动生成标签失败:', error);
      throw new Error(t('tagging.notices.failed', { message: error instanceof Error ? error.message : String(error) }));
    }
  }

  /**
   * 自动归档文件
   * @param file 文件
   */
  private async autoArchiveFile(file: TFile): Promise<void> {
    try {
      // 生成分类建议
      const categoryResult = await this.categoryService.suggestCategory(file);

      if (!categoryResult.success) {
        throw new Error(categoryResult.error || t('archiving.service.categorizeFailed'));
      }

      if (categoryResult.suggestions.length === 0) {
        debugLog('[AutoArchiveService] 未找到归档分类,跳过');
        new Notice(t('autoArchive.notices.noCategory'));
        return;
      }

      // 使用第一个建议(置信度最高)
      const topSuggestion = categoryResult.suggestions[0];
      debugLog('[AutoArchiveService] 使用归档分类:', topSuggestion);

      // 执行归档
      const archiveResult = await this.archiveService.archiveFile(file, {
        targetPath: topSuggestion.path,
        moveAttachments: this.settings.archiving.moveAttachments,
        updateLinks: this.settings.archiving.updateLinks,
        createFolder: true,
      });

      if (!archiveResult.success) {
        throw new Error(archiveResult.error || t('archiving.service.archiveFailed'));
      }

      debugLog('[AutoArchiveService] 文件归档成功:', archiveResult.newPath);
      new Notice(t('autoArchive.notices.archived', { path: topSuggestion.name || topSuggestion.path }));
    } catch (error) {
      errorLog('[AutoArchiveService] 自动归档失败:', error);
      throw new Error(t('archiving.notices.failed', { message: error instanceof Error ? error.message : String(error) }));
    }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.processingFiles.clear();
  }
}
