/**
 * 文件命名服务
 * 
 * 职责：
 * - 调用 AI 生成文件名（prompt 构建、AI 请求、文件名提取）
 * - 文件操作（读取内容、重命名、冲突处理）
 */

import { App, TFile } from 'obsidian';
import { SmartWorkflowSettings, BASE_PROMPT_TEMPLATE, ModelConfig } from '../../settings/settings';
import { ConfigManager } from '../config/configManager';
import type { ISecretService } from '../secret';
import { FileAnalyzer } from './fileAnalyzer';
import { debugLog, debugWarn } from '../../utils/logger';
import { t } from '../../i18n';
import { AIClient } from '../ai';
import { AIError, isAIError } from '../ai/errors';
import { 
  inferContextLength, 
  estimateTokenCount, 
  DEFAULT_OUTPUT_TOKEN_RESERVATION 
} from '../ai/modelContextLengths';

/**
 * 生成文件名结果接口
 */
export interface GenerateResult {
  /** 原文件名（不含扩展名） */
  oldName: string;
  /** 新文件名（不含扩展名） */
  newName: string;
  /** 新文件名是否与原文件名相同 */
  isSame: boolean;
}

/**
 * 重命名结果接口
 */
export interface RenameResult {
  /** 是否执行了重命名 */
  renamed: boolean;
  /** 原文件名（不含扩展名） */
  oldName: string;
  /** 新文件名（不含扩展名） */
  newName: string;
  /** 结果消息 */
  message: string;
}

/**
 * 文件命名服务类
 */
export class FileNameService {
  private configManager: ConfigManager;
  private fileAnalyzer: FileAnalyzer;

  constructor(
    private app: App,
    private settings: SmartWorkflowSettings,
    onSettingsChange?: () => Promise<void>,
    secretService?: ISecretService
  ) {
    this.configManager = new ConfigManager(settings, onSettingsChange, secretService);
    this.fileAnalyzer = new FileAnalyzer();
  }

  // ============================================================================
  // 公共 API
  // ============================================================================

  /**
   * 获取 ConfigManager 实例
   */
  getConfigManager(): ConfigManager {
    return this.configManager;
  }

  /**
   * 生成文件名（不执行重命名）
   */
  async generateFileName(file: TFile): Promise<GenerateResult> {
    const content = await this.app.vault.read(file);
    const currentFileName = file.basename;

    // 分析目录命名风格
    let directoryNamingStyle: string | undefined;
    if (this.settings.analyzeDirectoryNamingStyle) {
      try {
        directoryNamingStyle = this.fileAnalyzer.analyzeDirectoryNamingStyle(
          file, 
          this.settings.debugMode
        );
      } catch (error) {
        debugWarn('[FileNameService] 分析目录命名风格失败:', error);
      }
    }

    // 调用 AI 生成文件名
    const newFileName = await this.generateFileNameFromAI(
      content,
      currentFileName,
      directoryNamingStyle
    );

    const sanitizedFileName = this.sanitizeFileName(newFileName);
    const sanitizedCurrentFileName = this.sanitizeFileName(currentFileName);
    const isSame = sanitizedFileName.toLowerCase() === sanitizedCurrentFileName.toLowerCase();

    return {
      oldName: currentFileName,
      newName: sanitizedFileName,
      isSame
    };
  }

  /**
   * 执行文件重命名
   */
  async renameFile(file: TFile, newFileName: string): Promise<RenameResult> {
    const currentFileName = file.basename;
    const sanitizedFileName = this.sanitizeFileName(newFileName);
    const newPath = this.buildNewPath(file, sanitizedFileName);
    const finalPath = await this.resolveConflict(newPath);

    await this.app.fileManager.renameFile(file, finalPath);

    const finalFileName = finalPath.split('/').pop()?.replace(/\.[^.]+$/, '') || sanitizedFileName;

    return {
      renamed: true,
      oldName: currentFileName,
      newName: finalFileName,
      message: t('fileNameService.fileRenamed', { fileName: finalFileName })
    };
  }

  /**
   * 生成文件名并重命名
   */
  async generateAndRename(file: TFile): Promise<RenameResult> {
    const generateResult = await this.generateFileName(file);

    if (generateResult.isSame) {
      if (this.settings.debugMode) {
        debugLog('[FileNameService] 生成的文件名与当前文件名相同，跳过重命名');
      }
      return {
        renamed: false,
        oldName: generateResult.oldName,
        newName: generateResult.newName,
        message: t('fileNameService.noChangeNeeded')
      };
    }

    return this.renameFile(file, generateResult.newName);
  }

  /**
   * 验证文件名是否合法
   */
  validateFileName(fileName: string): boolean {
    if (/[\\/:*?"<>|]/.test(fileName)) return false;
    if (!fileName || fileName.trim() === '') return false;
    if (fileName.length > 100) return false;
    return true;
  }

  // ============================================================================
  // AI 文件名生成（原 NamingService 逻辑）
  // ============================================================================

  /**
   * 调用 AI 生成文件名
   */
  private async generateFileNameFromAI(
    content: string,
    currentFileName?: string,
    directoryNamingStyle?: string
  ): Promise<string> {
    const resolvedConfig = this.configManager.resolveFeatureConfig('naming');

    if (!resolvedConfig) {
      throw new Error(t('aiService.configNotResolved'));
    }

    const { provider, model, promptTemplate } = resolvedConfig;
    const prompt = this.preparePrompt(content, promptTemplate, model, currentFileName, directoryNamingStyle);

    if (this.settings.debugMode) {
      debugLog('[FileNameService] 发送给 AI 的 Prompt:');
      debugLog('='.repeat(50));
      debugLog(prompt);
      debugLog('='.repeat(50));
      debugLog(`[FileNameService] 使用供应商: ${provider.name}, 模型: ${model.displayName}`);
    }

    try {
      const aiClient = new AIClient({
        provider,
        model,
        timeout: this.settings.timeout || 15000,
        debugMode: this.settings.debugMode,
      });

      const response = await aiClient.request({ prompt });
      return this.extractFileName(response.content);
    } catch (error) {
      throw this.handleRequestError(error);
    }
  }

  /**
   * 准备 prompt
   */
  private preparePrompt(
    content: string,
    promptTemplate: string,
    model: ModelConfig,
    currentFileName?: string,
    directoryNamingStyle?: string
  ): string {
    const truncatedContent = this.smartTruncateContent(content, model);

    let template = promptTemplate;
    if (!this.settings.useCurrentFileNameContext) {
      template = BASE_PROMPT_TEMPLATE;
    }

    const variables: Record<string, string> = {
      content: truncatedContent,
      currentFileName: (this.settings.useCurrentFileNameContext && currentFileName) ? currentFileName : '',
      directoryNamingStyle: directoryNamingStyle || ''
    };

    return this.renderPrompt(template, variables);
  }

  /**
   * 从 AI 响应中提取文件名
   */
  private extractFileName(content: string): string {
    let processedContent = content.trim();

    // 多行内容处理
    const lines = processedContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    if (lines.length > 1) {
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.includes('文件名：') || line.includes('文件名:')) {
          processedContent = line.split(/文件名[：:]/)[1]?.trim() || line;
          break;
        } else if (line.toLowerCase().includes('title:')) {
          processedContent = line.split(/title:/i)[1]?.trim() || line;
          break;
        }
      }
      if (processedContent === content.trim()) {
        processedContent = lines[lines.length - 1];
      }
    }

    // 移除引号包裹
    let fileName = processedContent;
    if ((fileName.startsWith('"') && fileName.endsWith('"')) ||
      (fileName.startsWith("'") && fileName.endsWith("'")) ||
      (fileName.startsWith('《') && fileName.endsWith('》')) ||
      (fileName.startsWith('`') && fileName.endsWith('`'))) {
      fileName = fileName.substring(1, fileName.length - 1);
    }

    // 移除 .md 扩展名
    if (fileName.toLowerCase().endsWith('.md')) {
      fileName = fileName.substring(0, fileName.length - 3);
    }

    // 移除前缀
    fileName = fileName.replace(/^(文件名[：:]|Title:\s*)/i, '').trim();

    // 限制长度
    if (fileName.length > 100) {
      fileName = fileName.substring(0, 100);
    }

    fileName = fileName.trim();

    if (!fileName) {
      throw new Error(t('aiService.emptyFileName'));
    }

    return fileName;
  }

  /**
   * 智能截取内容
   * 根据模型的上下文长度和输出 token 限制计算可用输入空间
   * 
   * @param content 原始内容
   * @param model 模型配置（可选）
   * @returns 截断后的内容
   */
  private smartTruncateContent(content: string, model?: ModelConfig): string {
    // 计算可用输入 token 空间
    const availableInputTokens = this.calculateAvailableInputTokens(model);
    
    // 估算当前内容的 token 数
    const contentTokens = estimateTokenCount(content);
    
    // 如果内容在限制内，直接返回
    if (contentTokens <= availableInputTokens) {
      return content;
    }
    
    // 计算需要保留的字符数（基于 token 估算的反向计算）
    // 使用保守估算：假设平均 2 字符 = 1 token（中英文混合）
    const maxChars = Math.floor(availableInputTokens * 2);
    
    // 应用智能截断（保留头尾）
    const headChars = Math.floor(maxChars * 0.6);
    const tailChars = Math.floor(maxChars * 0.3);

    const head = content.substring(0, headChars);
    const tail = content.substring(content.length - tailChars);

    const truncatedContent = `${head}\n\n[... Content truncated due to length. Total ${content.length} characters (~${contentTokens} tokens), showing first ${headChars} and last ${tailChars} characters ...]\n\n${tail}`;
    
    if (this.settings.debugMode) {
      debugLog(`[FileNameService] 内容截断: ${content.length} 字符 (~${contentTokens} tokens) -> ${truncatedContent.length} 字符, 可用空间: ${availableInputTokens} tokens`);
    }
    
    return truncatedContent;
  }

  /**
   * 计算可用的输入 token 空间
   * 
   * 计算公式: 可用输入空间 = 上下文长度 - 输出预留空间 - 系统提示预留
   * 
   * @param model 模型配置（可选）
   * @returns 可用的输入 token 数
   */
  private calculateAvailableInputTokens(model?: ModelConfig): number {
    // 默认值：保守的 3000 字符约等于 1500 tokens
    const DEFAULT_AVAILABLE_TOKENS = 1500;
    
    // 系统提示和模板预留空间（约 500 tokens）
    const SYSTEM_PROMPT_RESERVATION = 500;
    
    if (!model) {
      return DEFAULT_AVAILABLE_TOKENS;
    }
    
    // 获取上下文长度（优先使用配置值，否则推断）
    const contextLength = inferContextLength(model.name);
    
    // 如果无法推断上下文长度，使用默认值
    if (contextLength === 0) {
      return DEFAULT_AVAILABLE_TOKENS;
    }
    
    // 获取输出 token 预留空间
    const outputReservation = model.maxOutputTokens && model.maxOutputTokens > 0 
      ? model.maxOutputTokens 
      : DEFAULT_OUTPUT_TOKEN_RESERVATION;
    
    // 计算可用输入空间
    const availableTokens = contextLength - outputReservation - SYSTEM_PROMPT_RESERVATION;
    
    // 确保返回合理的正值，最小为默认值
    return Math.max(availableTokens, DEFAULT_AVAILABLE_TOKENS);
  }

  /**
   * 渲染 Prompt 模板
   */
  private renderPrompt(template: string, variables: Record<string, string>): string {
    let result = template;

    // 条件块
    result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, varName, content) => {
      return variables[varName] ? content : '';
    });

    // 变量替换
    result = result.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
      return variables[varName] || '';
    });

    return result;
  }

  /**
   * 统一错误处理
   */
  private handleRequestError(error: unknown): Error {
    if (isAIError(error)) {
      const aiError = error as AIError;
      if (aiError.code === 'UNSUPPORTED_API_FORMAT') {
        const hint = t('aiService.unsupportedApiFormatHint');
        return new Error(`${aiError.message}\n${hint}`);
      }
      return aiError;
    }
    if (error instanceof Error) return error;
    return new Error(t('aiService.networkError', { message: String(error) }));
  }

  // ============================================================================
  // 文件操作辅助方法
  // ============================================================================

  /**
   * 清理文件名
   */
  private sanitizeFileName(fileName: string): string {
    let sanitized = fileName.replace(/[\\/:*?"<>|]/g, '');
    sanitized = sanitized.trim().replace(/\s+/g, ' ');

    if (sanitized.length > 100) {
      sanitized = sanitized.substring(0, 100).trim();
    }

    if (!sanitized) {
      throw new Error(t('fileNameService.invalidFileName'));
    }

    return sanitized;
  }

  /**
   * 构建新路径
   */
  private buildNewPath(file: TFile, newFileName: string): string {
    const extension = file.extension;
    const directory = file.parent?.path || '';

    return directory ? `${directory}/${newFileName}.${extension}` : `${newFileName}.${extension}`;
  }

  /**
   * 解决文件名冲突
   */
  private async resolveConflict(path: string): Promise<string> {
    let finalPath = path;
    let counter = 1;

    while (await this.app.vault.adapter.exists(finalPath)) {
      const match = path.match(/^(.+)\.([^.]+)$/);
      if (match) {
        finalPath = `${match[1]} ${counter}.${match[2]}`;
      } else {
        finalPath = `${path} ${counter}`;
      }
      counter++;
    }

    return finalPath;
  }
}
