/**
 * 文件命名服务类
 * 负责与 AI API 交互，生成文件名
 * 
 * 使用 AIClient 进行 AI 通信，专注于命名业务逻辑
 */

import { App } from 'obsidian';
import { SmartWorkflowSettings, BASE_PROMPT_TEMPLATE } from '../../settings/settings';
import { ConfigManager } from '../config/configManager';
import { debugLog } from '../../utils/logger';
import { t } from '../../i18n';
import { AIClient, ConnectionTester, ModelFetcher, RemoteModelInfo } from '../ai';
import { AIError, isAIError } from '../ai/errors';

// 重新导出 RemoteModelInfo 以保持向后兼容
export type { RemoteModelInfo } from '../ai';


/**
 * 负责与 AI API 交互，生成文件名
 * 
 * 架构说明：
 * - 使用 AIClient 进行 AI 通信
 * - 专注于命名业务逻辑（extractFileName、prompt 构建等）
 */
export class AIService {
  private configManager: ConfigManager;
  private settings: SmartWorkflowSettings;

  constructor(
    _app: App,
    settings: SmartWorkflowSettings,
    onSettingsChange?: () => Promise<void>
  ) {
    this.settings = settings;
    this.configManager = new ConfigManager(settings, onSettingsChange);
  }

  // ============================================================================
  // 公共 API
  // ============================================================================

  /**
   * 生成文件名
   * @param content 笔记内容
   * @param currentFileName 当前文件名（可选）
   * @param directoryNamingStyle 目录命名风格分析结果（可选）
   * @returns 生成的文件名
   */
  async generateFileName(
    content: string,
    currentFileName?: string,
    directoryNamingStyle?: string
  ): Promise<string> {
    // 使用 ConfigManager 解析 naming 功能的配置
    const resolvedConfig = this.configManager.resolveFeatureConfig('naming');

    if (!resolvedConfig) {
      throw new Error(t('aiService.configNotResolved'));
    }

    const { provider, model, promptTemplate } = resolvedConfig;

    // 准备 prompt
    const prompt = this.preparePrompt(content, promptTemplate, currentFileName, directoryNamingStyle);

    if (this.settings.debugMode) {
      debugLog('[AIService] 发送给 AI 的 Prompt:');
      debugLog('='.repeat(50));
      debugLog(prompt);
      debugLog('='.repeat(50));
      debugLog(`[AIService] 使用供应商: ${provider.name}, 模型: ${model.displayName}, API 格式: ${model.apiFormat || 'chat-completions'}`);
    }

    try {
      // 创建 AIClient 实例
      const aiClient = new AIClient({
        provider,
        model,
        timeout: this.settings.timeout || 15000,
        debugMode: this.settings.debugMode,
      });

      // 发送非流式请求
      const response = await aiClient.request({ prompt });

      // 从响应内容中提取文件名
      return this.extractFileName(response.content);
    } catch (error) {
      // 统一错误处理
      throw this.handleRequestError(error);
    }
  }

  // ============================================================================
  // 错误处理
  // ============================================================================

  /**
   * 统一错误处理
   */
  private handleRequestError(error: unknown): Error {
    if (isAIError(error)) {
      const aiError = error as AIError;
      // 添加用户友好的提示
      if (aiError.code === 'UNSUPPORTED_API_FORMAT') {
        const hint = t('aiService.unsupportedApiFormatHint');
        return new Error(`${aiError.message}\n${hint}`);
      }
      if (aiError.code === 'INVALID_REASONING_EFFORT') {
        return aiError;
      }
      return aiError;
    }
    if (error instanceof Error) {
      return error;
    }
    return new Error(t('aiService.networkError', { message: String(error) }));
  }

  // ============================================================================
  // Prompt 准备
  // ============================================================================

  /**
   * 准备 prompt
   */
  private preparePrompt(
    content: string,
    promptTemplate: string,
    currentFileName?: string,
    directoryNamingStyle?: string
  ): string {
    // 智能处理内容长度，避免超出 token 限制
    const truncatedContent = this.smartTruncateContent(content);

    // 根据配置选择模板
    let template = promptTemplate;
    if (!this.settings.useCurrentFileNameContext) {
      template = BASE_PROMPT_TEMPLATE;
    }

    // 构建变量对象
    const variables: Record<string, string> = {
      content: truncatedContent,
      currentFileName: (this.settings.useCurrentFileNameContext && currentFileName) ? currentFileName : '',
      directoryNamingStyle: directoryNamingStyle || ''
    };

    return this.renderPrompt(template, variables);
  }


  // ============================================================================
  // 文件名提取方法（命名特有逻辑）
  // ============================================================================

  /**
   * 从 AI 响应内容中提取文件名
   * 注意：思考标签已由 AIClient 通过 ThinkingProcessor 处理，此处仅处理命名特有逻辑
   * @param content AI 响应的原始文本内容（已移除思考标签）
   * @returns 提取的文件名
   */
  private extractFileName(content: string): string {
    let processedContent = content.trim();

    // 如果返回多行内容，尝试提取最后一个非空行（通常是最终答案）
    const lines = processedContent.split('\n').map((line: string) => line.trim()).filter((line: string) => line.length > 0);
    if (lines.length > 1) {
      // 优先查找"文件名："或"Title:"后面的内容
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
      // 如果没有找到标记，使用最后一行
      if (processedContent === content.trim()) {
        processedContent = lines[lines.length - 1];
      }
    }

    // 移除可能的引号包裹
    let fileName = processedContent;
    if ((fileName.startsWith('"') && fileName.endsWith('"')) ||
      (fileName.startsWith("'") && fileName.endsWith("'")) ||
      (fileName.startsWith('《') && fileName.endsWith('》')) ||
      (fileName.startsWith('`') && fileName.endsWith('`'))) {
      fileName = fileName.substring(1, fileName.length - 1);
    }

    // 移除 .md 扩展名（如果 AI 添加了）
    if (fileName.toLowerCase().endsWith('.md')) {
      fileName = fileName.substring(0, fileName.length - 3);
    }

    // 移除可能的前缀（如 "文件名："、"Title:" 等）
    fileName = fileName.replace(/^(文件名[：:]|Title:\s*)/i, '').trim();

    // 限制文件名长度（防止 AI 返回过长内容）
    if (fileName.length > 100) {
      fileName = fileName.substring(0, 100);
    }

    fileName = fileName.trim();

    if (!fileName) {
      throw new Error(t('aiService.emptyFileName'));
    }

    return fileName;
  }

  // ============================================================================
  // 内容处理方法
  // ============================================================================

  /**
   * 智能截取内容
   * 优先保留开头和结尾，因为它们通常包含最重要的信息
   * @param content 原始内容
   * @param maxChars 最大字符数（默认 3000）
   * @returns 截取后的内容
   */
  private smartTruncateContent(content: string, maxChars = 3000): string {
    if (content.length <= maxChars) {
      return content;
    }

    const headChars = Math.floor(maxChars * 0.6);
    const tailChars = Math.floor(maxChars * 0.3);

    const head = content.substring(0, headChars);
    const tail = content.substring(content.length - tailChars);

    return `${head}\n\n[... Content truncated due to length. Total ${content.length} characters, showing first ${headChars} and last ${tailChars} characters ...]\n\n${tail}`;
  }

  // ============================================================================
  // Prompt 模板渲染
  // ============================================================================

  /**
   * 渲染 Prompt 模板
   * @param template 模板字符串
   * @param variables 变量对象
   * @returns 渲染后的字符串
   */
  private renderPrompt(template: string, variables: Record<string, string>): string {
    let result = template;

    // 处理条件块 {{#if variable}}...{{/if}}
    result = result.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, varName, content) => {
      return variables[varName] ? content : '';
    });

    // 处理变量替换 {{variable}}
    result = result.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
      return variables[varName] || '';
    });

    return result;
  }


  // ============================================================================
  // 连接测试方法
  // ============================================================================

  /**
   * 测试供应商连接
   * 委托给 ConnectionTester 处理
   * @param providerId 供应商 ID
   * @param modelId 模型 ID
   * @returns 是否连接成功
   */
  async testConnection(providerId: string, modelId: string): Promise<boolean> {
    const provider = this.configManager.getProvider(providerId);
    if (!provider) {
      throw new Error(t('aiService.providerNotFound', { id: providerId }));
    }

    const model = this.configManager.getModel(providerId, modelId);
    if (!model) {
      throw new Error(t('aiService.modelNotFound', { providerId, modelId }));
    }

    const tester = new ConnectionTester({
      timeout: this.settings.timeout || 15000,
      debugMode: this.settings.debugMode,
    });

    return tester.testConnection(provider, model);
  }

  // ============================================================================
  // 配置管理方法
  // ============================================================================

  /**
   * 获取 ConfigManager 实例
   * 用于外部访问配置管理功能
   */
  getConfigManager(): ConfigManager {
    return this.configManager;
  }


  // ============================================================================
  // 模型列表获取方法
  // ============================================================================

  /**
   * 获取供应商的模型列表
   * 委托给 ModelFetcher 处理
   * @param providerId 供应商 ID
   * @returns 模型信息列表
   */
  async fetchModels(providerId: string): Promise<RemoteModelInfo[]> {
    const provider = this.configManager.getProvider(providerId);
    if (!provider) {
      throw new Error(t('aiService.providerNotFound', { id: providerId }));
    }

    const fetcher = new ModelFetcher({
      timeout: this.settings.timeout || 15000,
      debugMode: this.settings.debugMode,
    });

    return fetcher.fetchModels(provider);
  }
}
