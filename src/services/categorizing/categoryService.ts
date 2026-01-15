/**
 * CategoryService - AI智能分类服务
 *
 * 功能：
 * - 扫描归档区文件夹结构
 * - 分析笔记内容匹配最合适的分类
 * - 提供分类建议和置信度评分
 */

import type { App } from 'obsidian';
import { TFile, TFolder } from 'obsidian';
import type { SmartWorkflowSettings } from '../../settings/settings';
import { AIClient } from '../ai/aiClient';
import { ConfigManager } from '../config/configManager';
import type { ISecretService } from '../secret';
import type { ServerManager } from '../server/serverManager';
import { debugLog, errorLog } from '../../utils/logger';
import { t } from '../../i18n';

/**
 * 分类建议接口
 */
export interface CategorySuggestion {
  /** 建议的完整路径 */
  path: string;
  /** 置信度 (0-1) */
  confidence: number;
  /** 分类名称 */
  name: string;
  /** 是否是新建分类 */
  isNew: boolean;
  /** 父文件夹路径（如果是新建） */
  parentPath?: string;
  /** AI的推理说明 */
  reasoning?: string;
}

/**
 * 分类结果接口
 */
export interface CategoryResult {
  /** 分类建议列表（按置信度降序） */
  suggestions: CategorySuggestion[];
  /** 是否成功 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: string;
}

/**
 * 文件夹结构信息
 */
interface FolderInfo {
  /** 文件夹路径 */
  path: string;
  /** 文件夹名称 */
  name: string;
  /** 深度级别 */
  level: number;
  /** 子文件夹 */
  children: FolderInfo[];
  /** 文件数量 */
  fileCount: number;
}

/**
 * CategoryService 类
 */
export class CategoryService {
  private app: App;
  private settings: SmartWorkflowSettings;
  private configManager: ConfigManager;
  private serverManager: ServerManager | null;

  constructor(
    app: App,
    settings: SmartWorkflowSettings,
    serverManager: ServerManager | null = null,
    secretService?: ISecretService
  ) {
    this.app = app;
    this.settings = settings;
    this.configManager = new ConfigManager(settings, undefined, secretService);
    this.serverManager = serverManager;
  }

  /**
   * 为文件生成分类建议
   * @param file 目标文件
   * @returns 分类结果
   */
  async suggestCategory(file: TFile): Promise<CategoryResult> {
    try {
      if (!this.settings.archiving.enabled) {
        return {
          suggestions: [],
          success: false,
          error: t('archiving.service.notEnabled'),
        };
      }

      // 1. 扫描归档区文件夹结构
      const folderStructure = await this.scanArchiveFolder();

      // 检查归档文件夹是否存在
      const folderExists = await this.categoryExists(this.settings.archiving.baseFolder);

      // 如果文件夹不存在且不允许创建新分类，返回错误
      if (!folderExists && !this.settings.archiving.createNewCategories) {
        return {
          suggestions: [],
          success: false,
          error: t('archiving.service.folderNotExist', { folder: this.settings.archiving.baseFolder }),
        };
      }

      // 如果文件夹存在但没有子文件夹，且不允许创建新分类，建议直接归档到根目录
      if (folderExists && folderStructure.children.length === 0 && !this.settings.archiving.createNewCategories) {
        // 添加一个默认建议：归档到基础文件夹
        const defaultSuggestion: CategorySuggestion = {
          path: this.settings.archiving.baseFolder,
          confidence: 0.8,
          name: this.settings.archiving.baseFolder.split('/').pop() || this.settings.archiving.baseFolder,
          isNew: false,
          reasoning: '归档目录下暂无子分类，建议直接归档到此目录',
        };
        return {
          suggestions: [defaultSuggestion],
          success: true,
        };
      }

      debugLog('[CategoryService] 文件夹结构:', folderStructure);

      // 2. 读取文件内容
      const content = await this.app.vault.read(file);

      if (!content || content.trim().length === 0) {
        return {
          suggestions: [],
          success: false,
          error: t('archiving.service.emptyContent'),
        };
      }

      // 3. 调用AI匹配分类
      const suggestions = await this.callAI(content, file.basename, folderStructure);

      debugLog('[CategoryService] AI分类建议:', suggestions);

      // 4. 过滤低置信度的建议
      const filteredSuggestions = suggestions.filter(
        s => s.confidence >= this.settings.archiving.minConfidence
      );

      return {
        suggestions: filteredSuggestions,
        success: true,
      };
    } catch (error) {
      errorLog('[CategoryService] 分类匹配失败:', error);
      return {
        suggestions: [],
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 扫描归档区文件夹结构
   * @returns 文件夹结构树
   */
  private async scanArchiveFolder(): Promise<FolderInfo> {
    const baseFolder = this.settings.archiving.baseFolder;
    const folder = this.app.vault.getAbstractFileByPath(baseFolder);

    const rootInfo: FolderInfo = {
      path: baseFolder,
      name: baseFolder,
      level: 0,
      children: [],
      fileCount: 0,
    };

    if (!folder || !(folder instanceof TFolder)) {
      return rootInfo;
    }

    // 递归扫描文件夹
    await this.scanFolderRecursive(folder, rootInfo, 0);

    return rootInfo;
  }

  /**
   * 递归扫描文件夹
   * @param folder 要扫描的文件夹
   * @param parentInfo 父文件夹信息
   * @param level 当前深度
   */
  private async scanFolderRecursive(
    folder: TFolder,
    parentInfo: FolderInfo,
    level: number
  ): Promise<void> {
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        const childInfo: FolderInfo = {
          path: child.path,
          name: child.name,
          level: level + 1,
          children: [],
          fileCount: 0,
        };

        // 统计文件数量
        childInfo.fileCount = child.children.filter(c => c instanceof TFile).length;

        parentInfo.children.push(childInfo);

        // 递归扫描子文件夹（限制深度为3层）
        if (level < 2) {
          await this.scanFolderRecursive(child, childInfo, level + 1);
        }
      }
    }
  }

  /**
   * 调用AI进行分类匹配
   * @param content 笔记内容
   * @param filename 文件名
   * @param folderStructure 文件夹结构
   * @returns 分类建议数组
   */
  private async callAI(
    content: string,
    filename: string,
    folderStructure: FolderInfo
  ): Promise<CategorySuggestion[]> {
    try {
      // 获取分类功能的配置
      const config = this.configManager.resolveFeatureConfig('categorizing');

      if (!config) {
        throw new Error(t('archiving.service.noAIConfig'));
      }

      const resolvedProvider = this.configManager.resolveProviderForRequest(config.provider);
      if (!resolvedProvider) {
        throw new Error(t('aiService.invalidApiKey'));
      }

      // 构建 Prompt
      const prompt = this.buildCategorizingPrompt(
        content,
        filename,
        folderStructure,
        config.promptTemplate
      );

      // 创建 AI 客户端
      const aiClient = new AIClient({
        provider: resolvedProvider,
        model: config.model,
        timeout: this.settings.timeout,
        debugMode: this.settings.debugMode,
        serverManager: this.serverManager || undefined,
      });

      // 调用AI
      debugLog('[CategoryService] 发送给AI的Prompt:', prompt.substring(0, 500) + '...');

      const response = await aiClient.request({
        prompt,
        systemPrompt: '你是一个专业的笔记分类助手。请严格按照要求返回JSON格式的分类建议。',
      });

      debugLog('[CategoryService] AI原始响应:', response.content);

      // 解析分类建议
      return this.parseSuggestions(response.content, folderStructure);
    } catch (error) {
      errorLog('[CategoryService] AI调用失败:', error);
      throw error;
    }
  }

  /**
   * 构建分类 Prompt
   * @param content 笔记内容
   * @param filename 文件名
   * @param folderStructure 文件夹结构
   * @param template Prompt模板
   * @returns 构建后的Prompt
   */
  private buildCategorizingPrompt(
    content: string,
    filename: string,
    folderStructure: FolderInfo,
    template: string
  ): string {
    // 将文件夹结构转换为文本描述
    const folderTree = this.formatFolderTree(folderStructure);

    // 简单的模板替换
    const prompt = template
      .replace(/\{\{content\}\}/g, content)
      .replace(/\{\{filename\}\}/g, filename)
      .replace(/\{\{folderTree\}\}/g, folderTree)
      .replace(/\{\{baseFolder\}\}/g, this.settings.archiving.baseFolder)
      .replace(/\{\{minConfidence\}\}/g, this.settings.archiving.minConfidence.toString())
      .replace(/\{\{createNewCategories\}\}/g, this.settings.archiving.createNewCategories.toString());

    return prompt;
  }

  /**
   * 格式化文件夹树为文本
   * @param folderInfo 文件夹信息
   * @param indent 缩进
   * @returns 格式化后的文本
   */
  private formatFolderTree(folderInfo: FolderInfo, indent = ''): string {
    let result = '';

    for (const child of folderInfo.children) {
      result += `${indent}- ${child.name} (${child.fileCount} 篇笔记)\n`;

      if (child.children.length > 0) {
        result += this.formatFolderTree(child, indent + '  ');
      }
    }

    return result;
  }

  /**
   * 解析AI返回的分类建议
   * @param aiResponse AI返回的内容
   * @param folderStructure 文件夹结构（用于验证）
   * @returns 分类建议数组
   */
  private parseSuggestions(
    aiResponse: string,
    folderStructure: FolderInfo
  ): CategorySuggestion[] {
    try {
      // 尝试解析 JSON 格式
      const trimmed = aiResponse.trim();

      // 移除可能的 Markdown 代码块标记
      const jsonStr = trimmed
        .replace(/^```json?\n?/i, '')
        .replace(/\n?```$/, '');

      // 尝试解析 JSON
      const parsed = JSON.parse(jsonStr);

      if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
        const suggestions = parsed.suggestions
          .map((item: any) => {
            const suggestion: CategorySuggestion = {
              path: String(item.path || '').trim(),
              confidence: Number(item.confidence || 0),
              name: String(item.name || '').trim(),
              isNew: Boolean(item.isNew || false),
              parentPath: item.parentPath ? String(item.parentPath).trim() : undefined,
              reasoning: item.reasoning ? String(item.reasoning).trim() : undefined,
            };

            // 验证置信度范围
            if (suggestion.confidence < 0) suggestion.confidence = 0;
            if (suggestion.confidence > 1) suggestion.confidence = 1;

            debugLog('[CategoryService] 解析建议:', suggestion.name, '置信度:', suggestion.confidence);

            return suggestion;
          })
          .filter((s: CategorySuggestion) => s.path.length > 0)
          .sort((a: CategorySuggestion, b: CategorySuggestion) => b.confidence - a.confidence) // 按置信度降序排序
          .slice(0, 3); // 最多返回3个建议

        return suggestions;
      } else {
        errorLog('[CategoryService] AI响应中没有suggestions字段或不是数组:', parsed);
      }
    } catch (e) {
      errorLog('[CategoryService] JSON解析失败:', e);
      errorLog('[CategoryService] 原始响应:', aiResponse);
    }

    // 如果解析失败，返回空数组
    errorLog('[CategoryService] 无法解析分类建议，返回空数组');
    return [];
  }

  /**
   * 验证分类路径是否存在
   * @param path 分类路径
   * @returns 是否存在
   */
  async categoryExists(path: string): Promise<boolean> {
    const folder = this.app.vault.getAbstractFileByPath(path);
    return folder instanceof TFolder;
  }

  /**
   * 创建新分类文件夹
   * @param path 分类路径
   */
  async createCategory(path: string): Promise<void> {
    try {
      await this.app.vault.createFolder(path);
      debugLog('[CategoryService] 创建分类文件夹:', path);
    } catch (error) {
      // 如果文件夹已存在，忽略错误
      if (error.message && error.message.includes('already exists')) {
        debugLog('[CategoryService] 文件夹已存在:', path);
      } else {
        throw error;
      }
    }
  }
}
