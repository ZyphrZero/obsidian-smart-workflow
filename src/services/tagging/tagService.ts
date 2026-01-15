/**
 * TagService - AI标签生成服务
 *
 * 功能：
 * - 分析笔记内容生成标签
 * - 管理frontmatter标签
 * - 标签去重和规范化
 */

import type { TFile, App } from 'obsidian';
import type { SmartWorkflowSettings } from '../../settings/settings';
import { AIClient } from '../ai/aiClient';
import { ConfigManager } from '../config/configManager';
import type { ISecretService } from '../secret';
import type { ServerManager } from '../server/serverManager';
import { debugLog, errorLog } from '../../utils/logger';
import { t } from '../../i18n';

/**
 * 标签生成结果接口
 */
export interface TagGenerationResult {
  /** 生成的新标签列表 */
  tags: string[];
  /** 合并后的完整标签列表（包含原有标签） */
  allTags: string[];
  /** 原有标签列表 */
  existingTags: string[];
  /** 是否成功 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: string;
}

/**
 * TagService 类
 */
export class TagService {
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
   * 为文件生成标签
   * @param file 目标文件
   * @returns 标签生成结果
   */
  async generateTags(file: TFile): Promise<TagGenerationResult> {
    try {
      if (!this.settings.tagging.enabled) {
        return {
          tags: [],
          allTags: [],
          existingTags: [],
          success: false,
          error: t('tagging.service.notEnabled'),
        };
      }

      // 1. 读取文件内容
      const content = await this.app.vault.read(file);

      if (!content || content.trim().length === 0) {
        return {
          tags: [],
          allTags: [],
          existingTags: [],
          success: false,
          error: t('tagging.service.emptyContent'),
        };
      }

      // 2. 提取现有标签
      const existingTags = await this.extractExistingTags(file);

      debugLog('[TagService] 现有标签:', existingTags);

      // 3. 调用AI生成标签
      const newTags = await this.callAI(content, existingTags);

      debugLog('[TagService] AI生成的新标签:', newTags);

      // 4. 合并标签
      const allTags = this.settings.tagging.preserveExistingTags
        ? this.mergeTags(existingTags, newTags)
        : newTags;

      return {
        tags: newTags,
        allTags,
        existingTags,
        success: true,
      };
    } catch (error) {
      errorLog('[TagService] 标签生成失败:', error);
      return {
        tags: [],
        allTags: [],
        existingTags: [],
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 应用标签到文件
   * @param file 目标文件
   * @param tags 标签列表
   */
  async applyTags(file: TFile, tags: string[]): Promise<void> {
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        // 确保tags字段是数组
        frontmatter.tags = tags;
      });

      debugLog('[TagService] 标签已应用到文件:', file.path, tags);
    } catch (error) {
      errorLog('[TagService] 应用标签失败:', error);
      throw error;
    }
  }

  /**
   * 提取文件中的现有标签
   * @param file 文件对象
   * @returns 标签数组
   */
  private async extractExistingTags(file: TFile): Promise<string[]> {
    const cache = this.app.metadataCache.getFileCache(file);
    const tags: string[] = [];

    // 从 frontmatter 中提取标签
    if (cache?.frontmatter?.tags) {
      const frontmatterTags = cache.frontmatter.tags;
      if (Array.isArray(frontmatterTags)) {
        tags.push(...frontmatterTags.map(t => String(t).trim()));
      } else if (typeof frontmatterTags === 'string') {
        tags.push(frontmatterTags.trim());
      }
    }

    // 从正文中提取行内标签 (#tag)
    if (cache?.tags) {
      for (const tagCache of cache.tags) {
        const tag = tagCache.tag.replace(/^#/, ''); // 移除开头的 #
        if (!tags.includes(tag)) {
          tags.push(tag);
        }
      }
    }

    return tags.filter(tag => tag.length > 0);
  }

  /**
   * 调用AI生成标签
   * @param content 笔记内容
   * @param existingTags 现有标签
   * @returns 生成的标签数组
   */
  private async callAI(content: string, existingTags: string[]): Promise<string[]> {
    try {
      // 获取标签生成功能的配置
      const config = this.configManager.resolveFeatureConfig('tagging');

      if (!config) {
        throw new Error(t('tagging.service.noAIConfig'));
      }

      // 构建 Prompt
      const prompt = this.buildTaggingPrompt(content, existingTags, config.promptTemplate);

      // 创建 AI 客户端
      const aiClient = new AIClient({
        provider: config.provider,
        model: config.model,
        timeout: this.settings.timeout,
        debugMode: this.settings.debugMode,
        serverManager: this.serverManager || undefined,
      });

      // 调用AI
      const response = await aiClient.request({
        prompt,
        systemPrompt: '你是一个专业的笔记标签生成助手。',
      });

      // 解析标签
      return this.parseTags(response.content);
    } catch (error) {
      errorLog('[TagService] AI调用失败:', error);
      throw error;
    }
  }

  /**
   * 构建标签生成 Prompt
   * @param content 笔记内容
   * @param existingTags 现有标签
   * @param template Prompt模板
   * @returns 构建后的Prompt
   */
  private buildTaggingPrompt(
    content: string,
    existingTags: string[],
    template: string
  ): string {
    // 简单的模板替换（支持 {{variable}} 格式）
    let prompt = template
      .replace(/\{\{content\}\}/g, content)
      .replace(/\{\{tagCount\}\}/g, this.settings.tagging.tagCount.toString());

    // 处理条件模板 {{#if existingTags}}...{{/if}}
    if (existingTags.length > 0) {
      const existingTagsStr = existingTags.join(', ');
      prompt = prompt.replace(
        /\{\{#if existingTags\}\}([\s\S]*?)\{\{\/if\}\}/g,
        '$1'
      );
      prompt = prompt.replace(/\{\{existingTags\}\}/g, existingTagsStr);
    } else {
      // 移除条件块
      prompt = prompt.replace(/\{\{#if existingTags\}\}[\s\S]*?\{\{\/if\}\}/g, '');
    }

    return prompt;
  }

  /**
   * 解析AI返回的标签
   * @param aiResponse AI返回的内容
   * @returns 标签数组
   */
  private parseTags(aiResponse: string): string[] {
    try {
      // 尝试解析 JSON 格式
      const trimmed = aiResponse.trim();

      // 移除可能的 Markdown 代码块标记
      const jsonStr = trimmed
        .replace(/^```json?\n?/i, '')
        .replace(/\n?```$/,'');

      // 尝试解析 JSON
      const parsed = JSON.parse(jsonStr);

      if (parsed.tags && Array.isArray(parsed.tags)) {
        return parsed.tags
          .map((tag: any) => this.normalizeTag(String(tag)))
          .filter((tag: string) => tag.length > 0)
          .slice(0, this.settings.tagging.maxTagCount);
      }
    } catch (e) {
      // JSON解析失败，尝试其他格式
      debugLog('[TagService] JSON解析失败，尝试其他格式:', e);
    }

    // 尝试按逗号或换行分隔
    const tags = aiResponse
      .split(/[,\n]/)
      .map(tag => this.normalizeTag(tag.replace(/^[#\-*]\s*/, '')))
      .filter(tag => tag.length > 0)
      .slice(0, this.settings.tagging.maxTagCount);

    if (tags.length > 0) {
      return tags;
    }

    // 如果还是没有解析出来，返回空数组
    return [];
  }

  /**
   * 合并标签（去重）
   * @param existingTags 现有标签
   * @param newTags 新标签
   * @returns 合并后的标签数组
   */
  private mergeTags(existingTags: string[], newTags: string[]): string[] {
    const tagSet = new Set<string>();

    // 先添加现有标签
    existingTags.forEach((tag: string) => tagSet.add(tag.toLowerCase()));

    // 添加新标签（去重，不区分大小写）
    const result = [...existingTags];
    newTags.forEach((tag: string) => {
      if (!tagSet.has(tag.toLowerCase())) {
        result.push(tag);
        tagSet.add(tag.toLowerCase());
      }
    });

    return result;
  }

  /**
   * 规范化标签
   * - 移除特殊字符
   * - 限制长度
   * @param tag 原始标签
   * @returns 规范化后的标签
   */
  private normalizeTag(tag: string): string {
    return tag
      .trim()
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\-_]/g, '') // 只保留中英文、数字、-、_
      .slice(0, 20); // 限制最大长度
  }
}
