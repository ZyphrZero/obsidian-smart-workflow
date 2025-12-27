import { App, requestUrl, RequestUrlResponse } from 'obsidian';
import { SmartWorkflowSettings, BASE_PROMPT_TEMPLATE, ModelType, ModelConfig, ReasoningEffort, APIFormat, Provider } from '../../settings/settings';
import { ConfigManager } from '../config/configManager';
import { debugLog } from '../../utils/logger';
import { t } from '../../i18n';
import { inferModelType } from './modelTypeInferrer';
import {
  UnsupportedAPIFormatError,
  InvalidReasoningEffortError,
  ResponsesAPIError,
  isUnsupportedAPIFormatError,
  isInvalidReasoningEffortError,
  isResponsesAPIError
} from './errors';

/**
 * Chat Completions API 请求体接口
 * 用于传统的 /v1/chat/completions 端点
 */
export interface ChatCompletionsRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

/**
 * Responses API 请求体接口
 * 用于新的 /v1/responses 端点，专为推理模型设计
 */
export interface ResponsesAPIRequest {
  model: string;
  input: string | Array<{ type: string; role?: string; content?: string }>;
  reasoning?: {
    effort: 'low' | 'medium' | 'high';
  };
  max_output_tokens?: number;
}

/**
 * API 响应数据接口（Chat Completions 格式）
 */
interface APIResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

/**
 * Responses API 输出项接口
 * 用于解析 /v1/responses 端点返回的 output 数组中的每个项
 */
export interface ResponsesOutputItem {
  /** 输出项类型：message（消息）或 reasoning（推理过程） */
  type: 'message' | 'reasoning';
  /** 输出项 ID */
  id?: string;
  /** 角色（仅 message 类型） */
  role?: string;
  /** 内容数组（message 类型的文本内容） */
  content?: Array<{
    type: string;
    text?: string;
  }>;
  /** 推理摘要（reasoning 类型） */
  summary?: Array<{
    type: string;
    text?: string;
  }>;
}

/**
 * Responses API 响应接口
 * 用于解析 /v1/responses 端点的响应数据
 */
export interface ResponsesAPIResponse {
  /** 响应 ID */
  id: string;
  /** 对象类型 */
  object: string;
  /** 创建时间戳 */
  created_at: number;
  /** 使用的模型名称 */
  model: string;
  /** 输出项数组 */
  output: Array<ResponsesOutputItem>;
  /** 使用量统计 */
  usage?: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens?: number;
  };
  /** 错误信息 */
  error?: {
    message?: string;
  };
}

/**
 * 模型列表 API 响应接口
 * 标准 OpenAI 格式 + 部分提供商的扩展字段
 */
interface ModelsAPIResponse {
  data?: Array<{
    id: string;
    object?: string;
    created?: number;
    owned_by?: string;
    // 扩展字段（部分提供商支持）
    capabilities?: {
      vision?: boolean;
      function_calling?: boolean;
      reasoning?: boolean;
    };
    // OpenRouter 格式
    context_length?: number;
    // SiliconFlow 格式
    max_context_length?: number;
  }>;
  error?: {
    message?: string;
  };
}

/**
 * 远程模型信息接口
 */
export interface RemoteModelInfo {
  id: string;
  name: string;
  capabilities: ModelType[];
  contextLength?: number;
  // API 返回的原始能力信息（如果有）
  rawAbilities?: {
    vision?: boolean;
    functionCall?: boolean;
    reasoning?: boolean;
  };
}

/**
 * AI 服务类
 * 负责与 AI API 交互，生成文件名
 * 
 * 架构说明：
 * - 请求构建：通过 buildRequest() 统一入口，根据 apiFormat 分发到对应的构建方法
 * - 响应解析：通过 parseUnifiedResponse() 统一入口，自动检测响应格式并解析
 * - 端点路由：通过 getEndpointForFormat() 根据 apiFormat 选择正确的端点
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

    // 验证配置
    this.validateProviderConfig(provider);

    // 准备 prompt
    const prompt = this.preparePrompt(content, promptTemplate, currentFileName, directoryNamingStyle);

    // 获取 API 格式，默认为 'chat-completions'
    const apiFormat = this.getAPIFormat(model);

    if (this.settings.debugMode) {
      debugLog('[AIService] 发送给 AI 的 Prompt:');
      debugLog('='.repeat(50));
      debugLog(prompt);
      debugLog('='.repeat(50));
      debugLog(`[AIService] 使用供应商: ${provider.name}, 模型: ${model.displayName}, API 格式: ${apiFormat}`);
    }

    // 统一请求构建入口
    const requestBody = this.buildRequest(model, prompt, apiFormat);

    try {
      // 发送请求并获取响应
      const response = await this.sendRequest(provider, requestBody, apiFormat);

      // 统一响应解析入口
      return this.parseUnifiedResponse(response, apiFormat);
    } catch (error) {
      // 统一错误处理
      throw this.handleRequestError(error, apiFormat);
    }
  }

  // ============================================================================
  // 请求构建层（统一入口）
  // ============================================================================

  /**
   * 统一请求构建入口
   * 根据 apiFormat 分发到对应的构建方法
   * @param model 模型配置
   * @param prompt 用户提示内容
   * @param apiFormat API 格式
   * @returns 请求体
   */
  private buildRequest(
    model: ModelConfig,
    prompt: string,
    apiFormat: APIFormat
  ): ChatCompletionsRequest | ResponsesAPIRequest {
    if (apiFormat === 'responses') {
      return this.buildResponsesRequest(model, prompt);
    }
    return this.buildChatCompletionsRequest(model, prompt);
  }

  // ============================================================================
  // 响应解析层（统一入口）
  // ============================================================================

  /**
   * 统一响应解析入口
   * 根据 apiFormat 或响应结构自动选择解析方法
   * @param response API 响应数据
   * @param apiFormat API 格式（可选，用于优化解析路径）
   * @returns 提取的文件名
   */
  private parseUnifiedResponse(response: unknown, apiFormat?: APIFormat): string {
    // 如果明确指定了 apiFormat，优先使用对应的解析方法
    if (apiFormat === 'responses') {
      const result = this.parseResponsesResponse(response as ResponsesAPIResponse);
      return result.fileName;
    }

    if (apiFormat === 'chat-completions') {
      return this.parseResponse(response as APIResponse);
    }

    // 未指定格式时，自动检测
    return this.parseResponseAuto(response);
  }

  // ============================================================================
  // 请求发送层
  // ============================================================================

  /**
   * 发送 API 请求
   * @param provider 供应商配置
   * @param requestBody 请求体
   * @param apiFormat API 格式
   * @returns 响应数据
   */
  private async sendRequest(
    provider: Provider,
    requestBody: ChatCompletionsRequest | ResponsesAPIRequest,
    apiFormat: APIFormat
  ): Promise<unknown> {
    const timeoutMs = this.settings.timeout || 15000;

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(t('aiService.requestTimeout', { seconds: String(timeoutMs / 1000) })));
      }, timeoutMs);
    });

    // 根据 API 格式选择端点
    const fullEndpoint = this.getEndpointForFormat(provider.endpoint, apiFormat);

    if (this.settings.debugMode) {
      debugLog(`[AIService] 请求端点: ${fullEndpoint}`);
      debugLog(`[AIService] 请求体:`, JSON.stringify(requestBody, null, 2));
    }

    const requestPromise = requestUrl({
      url: fullEndpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(requestBody),
      throw: false
    });

    const response = await Promise.race([requestPromise, timeoutPromise]) as RequestUrlResponse;

    // 检查响应状态
    if (response.status !== 200) {
      this.handleHttpError(response, fullEndpoint, apiFormat, requestBody);
    }

    return response.json;
  }

  /**
   * 处理 HTTP 错误响应
   */
  private handleHttpError(
    response: RequestUrlResponse,
    fullEndpoint: string,
    apiFormat: APIFormat,
    requestBody: ChatCompletionsRequest | ResponsesAPIRequest
  ): never {
    let errorMessage = t('aiService.requestFailed', { status: String(response.status) });
    errorMessage += `\nRequest URL: ${fullEndpoint}`;

    // 尝试解析错误响应
    let errorData: { error?: { message?: string; type?: string; code?: string } } | null = null;
    try {
      errorData = response.json;
    } catch {
      // 无法解析错误信息
    }

    // 检测 Responses API 特有的错误
    if (apiFormat === 'responses') {
      this.handleResponsesAPIError(response, errorData, requestBody as ResponsesAPIRequest);
    }

    // 通用错误处理
    if (response.status === 404) {
      errorMessage += `\n${t('aiService.requestFailedHint')}`;
    }

    if (response.status === 401) {
      errorMessage += `\n${t('aiService.invalidApiKeyHint')}`;
    }

    if (errorData?.error?.message) {
      errorMessage += `\n${t('aiService.errorDetails', { message: errorData.error.message })}`;
    }

    throw new Error(errorMessage);
  }

  /**
   * 处理 Responses API 特有的错误
   */
  private handleResponsesAPIError(
    response: RequestUrlResponse,
    errorData: { error?: { message?: string; type?: string; code?: string } } | null,
    requestBody: ResponsesAPIRequest
  ): void {
    // 404 错误可能表示端点不支持 Responses API
    if (response.status === 404) {
      throw new UnsupportedAPIFormatError('responses', 'chat-completions', response.status);
    }

    // 400 错误可能表示请求格式不正确
    if (response.status === 400) {
      const errorType = errorData?.error?.type || errorData?.error?.code;
      const originalMessage = errorData?.error?.message;

      // 检查是否是不支持的 API 格式错误
      if (originalMessage && (
        originalMessage.toLowerCase().includes('unsupported') ||
        originalMessage.toLowerCase().includes('not supported') ||
        originalMessage.toLowerCase().includes('invalid endpoint')
      )) {
        throw new UnsupportedAPIFormatError('responses', 'chat-completions', response.status);
      }

      // 检查是否是无效的 reasoning effort 错误
      if (originalMessage && (
        originalMessage.toLowerCase().includes('reasoning') ||
        originalMessage.toLowerCase().includes('effort')
      )) {
        const providedEffort = requestBody.reasoning?.effort || 'unknown';
        throw new InvalidReasoningEffortError(providedEffort);
      }

      // 其他 Responses API 错误
      throw new ResponsesAPIError(
        response.status,
        t('aiService.responsesApiError', {
          status: String(response.status),
          message: originalMessage || 'Unknown error'
        }),
        errorType,
        originalMessage
      );
    }
  }

  /**
   * 统一错误处理
   */
  private handleRequestError(error: unknown, _apiFormat: APIFormat): Error {
    if (isUnsupportedAPIFormatError(error)) {
      const hint = t('aiService.unsupportedApiFormatHint');
      return new Error(`${error.message}\n${hint}`);
    }
    if (isInvalidReasoningEffortError(error)) {
      return error;
    }
    if (isResponsesAPIError(error)) {
      const hint = t('aiService.responsesApiErrorHint');
      return new Error(`${error.message}\n${hint}`);
    }
    if (error instanceof Error) {
      return error;
    }
    return new Error(t('aiService.networkError', { message: String(error) }));
  }

  // ============================================================================
  // 配置辅助方法
  // ============================================================================

  /**
   * 验证供应商配置
   */
  private validateProviderConfig(provider: Provider): void {
    if (!provider.apiKey || provider.apiKey.trim() === '') {
      throw new Error(t('aiService.providerApiKeyNotConfigured', { provider: provider.name }));
    }

    if (!provider.endpoint || provider.endpoint.trim() === '') {
      throw new Error(t('aiService.providerEndpointNotConfigured', { provider: provider.name }));
    }
  }

  /**
   * 获取 API 格式，默认为 'chat-completions'
   */
  private getAPIFormat(model: ModelConfig): APIFormat {
    return model.apiFormat || 'chat-completions';
  }

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
  // 响应解析方法
  // ============================================================================

  /**
   * 自动检测响应格式并解析
   * 根据响应结构自动判断是 Chat Completions 还是 Responses API 格式
   * @param response API 响应数据
   * @returns 提取的文件名
   */
  private parseResponseAuto(response: unknown): string {
    const responseObj = response as Record<string, unknown>;

    // 检测 Responses API 格式：包含 output 数组
    if (responseObj && 'output' in responseObj && Array.isArray(responseObj.output)) {
      if (this.settings.debugMode) {
        debugLog('[AIService] 检测到 Responses API 响应格式');
      }
      const result = this.parseResponsesResponse(response as unknown as ResponsesAPIResponse);
      return result.fileName;
    }

    // 检测 Chat Completions API 格式：包含 choices 数组
    if (responseObj && 'choices' in responseObj && Array.isArray(responseObj.choices)) {
      if (this.settings.debugMode) {
        debugLog('[AIService] 检测到 Chat Completions API 响应格式');
      }
      return this.parseResponse(response as unknown as APIResponse);
    }

    // 无法识别的响应格式
    throw new Error(t('aiService.responseFormatError'));
  }

  /**
   * 解析 Chat Completions API 响应
   * @param response API 响应数据
   * @returns 提取的文件名
   */
  private parseResponse(response: APIResponse): string {
    if (!response || !response.choices || response.choices.length === 0) {
      throw new Error(t('aiService.missingChoices'));
    }

    const choice = response.choices[0];
    if (!choice.message || !choice.message.content) {
      throw new Error(t('aiService.missingContent'));
    }

    const content = choice.message.content.trim();
    return this.extractFileName(content);
  }

  /**
   * 解析 Responses API 响应
   * 用于解析 /v1/responses 端点返回的响应数据
   * @param response Responses API 响应数据
   * @returns 解析结果，包含文件名和可选的推理摘要
   */
  parseResponsesResponse(response: ResponsesAPIResponse): { fileName: string; reasoningSummary?: string } {
    if (!response || !response.output || response.output.length === 0) {
      throw new Error(t('aiService.missingOutput'));
    }

    let messageContent = '';
    let reasoningSummary: string | undefined;

    // 遍历 output 数组，提取消息内容和推理摘要
    for (const item of response.output) {
      if (item.type === 'message') {
        messageContent += this.extractMessageContent(item);
      } else if (item.type === 'reasoning') {
        reasoningSummary = this.extractReasoningSummary(item);
      }
    }

    if (!messageContent) {
      throw new Error(t('aiService.missingContent'));
    }

    // 使用通用的文件名提取逻辑
    const fileName = this.extractFileName(messageContent.trim());

    if (this.settings.debugMode && reasoningSummary) {
      debugLog('[AIService] 推理摘要:', reasoningSummary);
    }

    return { fileName, reasoningSummary };
  }

  /**
   * 从 Responses API 的 message 项中提取文本内容
   */
  private extractMessageContent(item: ResponsesOutputItem): string {
    let content = '';
    if (item.content && Array.isArray(item.content)) {
      for (const contentItem of item.content) {
        if ((contentItem.type === 'output_text' || contentItem.type === 'text') && contentItem.text) {
          content += contentItem.text;
        }
      }
    }
    return content;
  }

  /**
   * 从 Responses API 的 reasoning 项中提取推理摘要
   */
  private extractReasoningSummary(item: ResponsesOutputItem): string | undefined {
    if (item.summary && Array.isArray(item.summary)) {
      const summaryTexts: string[] = [];
      for (const summaryItem of item.summary) {
        if ((summaryItem.type === 'summary_text' || summaryItem.type === 'text') && summaryItem.text) {
          summaryTexts.push(summaryItem.text);
        }
      }
      if (summaryTexts.length > 0) {
        return summaryTexts.join('\n');
      }
    }
    return undefined;
  }

  // ============================================================================
  // 文件名提取方法
  // ============================================================================

  /**
   * 从 AI 响应内容中提取文件名
   * 通用的文件名提取逻辑，适用于 Chat Completions 和 Responses API
   * @param content AI 响应的原始文本内容
   * @returns 提取的文件名
   */
  private extractFileName(content: string): string {
    let processedContent = content;

    // 处理带思考过程的模型（如 DeepSeek、o1 系列等）
    // 这些模型可能在 reasoning_content 字段中包含思考过程
    // 或者在 content 中用特殊标记包裹思考过程

    // 移除 <think>...</think> 或 <thinking>...</thinking> 标记的思考内容
    processedContent = processedContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    processedContent = processedContent.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();

    // 移除 【思考】...【/思考】 或 [思考]...[/思考] 标记的思考内容
    processedContent = processedContent.replace(/【思考】[\s\S]*?【\/思考】/g, '').trim();
    processedContent = processedContent.replace(/\[思考\][\s\S]*?\[\/思考\]/g, '').trim();

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
      if (processedContent === content) {
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
    // 如果内容不超过限制，直接返回
    if (content.length <= maxChars) {
      return content;
    }

    // 计算开头和结尾各保留多少字符
    const headChars = Math.floor(maxChars * 0.6); // 开头保留 60%
    const tailChars = Math.floor(maxChars * 0.3); // 结尾保留 30%
    // 剩余 10% 用于省略标记

    const head = content.substring(0, headChars);
    const tail = content.substring(content.length - tailChars);

    // 添加省略标记，说明内容被截断
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
  // 请求构建方法（Chat Completions API）
  // ============================================================================

  /**
   * 构建 Chat Completions API 请求体
   * @param model 模型配置
   * @param prompt 用户提示内容
   * @returns Chat Completions API 请求体
   */
  buildChatCompletionsRequest(model: ModelConfig, prompt: string): ChatCompletionsRequest {
    const request: ChatCompletionsRequest = {
      model: model.name,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: model.temperature,
      top_p: model.topP
    };

    // 仅当 maxTokens 为正整数时才添加该参数
    if (model.maxTokens && model.maxTokens > 0) {
      request.max_tokens = model.maxTokens;
    }

    return request;
  }

  // ============================================================================
  // 请求构建方法（Responses API）
  // ============================================================================

  /**
   * 构建 Responses API 请求体
   * 用于推理模型（如 o3、o4-mini），支持推理深度控制
   * @param model 模型配置
   * @param prompt 用户提示内容
   * @returns Responses API 请求体
   * @throws InvalidReasoningEffortError 如果 reasoningEffort 值无效
   */
  buildResponsesRequest(model: ModelConfig, prompt: string): ResponsesAPIRequest {
    // 获取推理深度，默认为 'medium'
    const reasoningEffort: ReasoningEffort = model.reasoningEffort || 'medium';

    // 验证 reasoningEffort 值
    const validEfforts: ReasoningEffort[] = ['low', 'medium', 'high'];
    if (!validEfforts.includes(reasoningEffort)) {
      throw new InvalidReasoningEffortError(reasoningEffort);
    }

    const request: ResponsesAPIRequest = {
      model: model.name,
      input: prompt,
      reasoning: {
        effort: reasoningEffort
      }
    };

    // 如果配置了 maxTokens，添加 max_output_tokens 参数
    if (model.maxTokens && model.maxTokens > 0) {
      request.max_output_tokens = model.maxTokens;
    }

    return request;
  }

  // ============================================================================
  // 端点规范化方法
  // ============================================================================

  /**
   * 标准化 API 端点 URL（运行时自动补全）
   * 用于 Chat Completions API
   * @param url 原始 URL
   * @returns 补全后的完整 URL
   */
  private normalizeEndpoint(url: string): string {
    let normalized = url.trim();

    if (!normalized) {
      throw new Error(t('aiService.endpointEmpty'));
    }

    // 检查并添加协议
    if (!normalized.match(/^https?:\/\//i)) {
      if (normalized.startsWith('//')) {
        normalized = 'https:' + normalized;
      } else if (!normalized.includes('://')) {
        normalized = 'https://' + normalized;
      }
    }

    // 移除末尾多余的斜杠
    normalized = normalized.replace(/\/+$/, '');

    // 检查是否包含完整路径
    const commonPaths = [
      '/v1/chat/completions',
      '/chat/completions',
      '/v1/completions',
      '/completions'
    ];

    const hasPath = commonPaths.some(path => normalized.includes(path));

    if (!hasPath) {
      // 尝试解析 URL 并自动补全路径
      try {
        const urlObj = new URL(normalized);
        const pathname = urlObj.pathname;

        // 如果路径以 /v1 结尾，自动补全为 /v1/chat/completions
        if (pathname === '/v1' || pathname === '/v1/') {
          normalized = normalized.replace(/\/v1\/?$/, '') + '/v1/chat/completions';
        }
        // 如果只有根路径或空路径，补全为 /v1/chat/completions
        else if (!pathname || pathname === '/') {
          normalized = normalized + '/v1/chat/completions';
        }
        // 如果路径以 /chat 结尾，补全为 /chat/completions
        else if (pathname === '/chat' || pathname === '/chat/') {
          normalized = normalized.replace(/\/chat\/?$/, '') + '/chat/completions';
        }
      } catch {
        // URL 解析失败，保持原样
      }
    }

    // 修正双斜杠
    normalized = normalized.replace(/([^:])\/\//g, '$1/');

    return normalized;
  }

  /**
   * 标准化 Responses API 端点 URL
   * 用于 Responses API
   * @param url 原始 URL
   * @returns 补全后的完整 URL（以 /v1/responses 结尾）
   */
  private normalizeResponsesEndpoint(url: string): string {
    let normalized = url.trim();

    if (!normalized) {
      throw new Error(t('aiService.endpointEmpty'));
    }

    // 检查并添加协议
    if (!normalized.match(/^https?:\/\//i)) {
      if (normalized.startsWith('//')) {
        normalized = 'https:' + normalized;
      } else if (!normalized.includes('://')) {
        normalized = 'https://' + normalized;
      }
    }

    // 移除末尾多余的斜杠
    normalized = normalized.replace(/\/+$/, '');

    // 检查是否已包含 /v1/responses 路径
    if (normalized.includes('/v1/responses')) {
      // 修正双斜杠
      return normalized.replace(/([^:])\/\//g, '$1/');
    }

    // 移除已有的 API 路径部分，获取基础 URL
    const pathsToRemove = [
      '/v1/chat/completions',
      '/chat/completions',
      '/v1/completions',
      '/completions',
      '/v1/models',
      '/models',
      '/v1'  // 处理以 /v1 结尾的情况
    ];

    for (const path of pathsToRemove) {
      if (normalized.endsWith(path)) {
        normalized = normalized.slice(0, -path.length);
        break;
      }
    }

    // 添加 /v1/responses 路径
    normalized = normalized + '/v1/responses';

    // 修正双斜杠
    normalized = normalized.replace(/([^:])\/\//g, '$1/');

    return normalized;
  }

  // ============================================================================
  // 端点路由方法
  // ============================================================================

  /**
   * 根据 API 格式获取正确的端点
   * 统一的端点路由入口，根据 apiFormat 分发到对应的规范化方法
   * @param baseEndpoint 基础端点 URL
   * @param apiFormat API 格式
   * @returns 完整的 API 端点
   */
  getEndpointForFormat(baseEndpoint: string, apiFormat: APIFormat): string {
    if (apiFormat === 'responses') {
      return this.normalizeResponsesEndpoint(baseEndpoint);
    }
    return this.normalizeEndpoint(baseEndpoint);
  }

  // ============================================================================
  // 连接测试方法
  // ============================================================================

  /**
   * 测试供应商连接
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

    debugLog('[AIService] 测试连接:', { provider: provider.name, model: model.name });

    // 验证配置
    if (!provider.apiKey || provider.apiKey.trim() === '') {
      throw new Error(t('aiService.providerApiKeyNotConfigured', { provider: provider.name }));
    }

    if (!provider.endpoint || provider.endpoint.trim() === '') {
      throw new Error(t('aiService.providerEndpointNotConfigured', { provider: provider.name }));
    }

    // 构造极简请求
    const requestBody = {
      model: model.name,
      messages: [
        { role: 'user', content: 'Hi' }
      ],
      max_tokens: 5
    };

    try {
      const timeoutMs = this.settings.timeout || 15000;

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(t('aiService.requestTimeout', { seconds: String(timeoutMs / 1000) })));
        }, timeoutMs);
      });

      // 补全 API 端点（运行时处理）
      const fullEndpoint = this.normalizeEndpoint(provider.endpoint);
      debugLog('[AIService] 测试连接端点:', fullEndpoint);

      const requestPromise = requestUrl({
        url: fullEndpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.apiKey}`
        },
        body: JSON.stringify(requestBody),
        throw: false
      });

      const response = await Promise.race([requestPromise, timeoutPromise]) as RequestUrlResponse;
      debugLog('[AIService] 测试连接响应状态:', response.status);

      if (response.status !== 200) {
        let errorMessage = t('aiService.requestFailed', { status: String(response.status) });
        if (response.status === 401) errorMessage += ': ' + t('aiService.testApiKeyInvalid');
        else if (response.status === 404) errorMessage += ': ' + t('aiService.testEndpointNotFound');

        try {
          const errorData = response.json;
          if (errorData?.error?.message) {
            errorMessage += ` - ${errorData.error.message}`;
          }
        } catch {
          // 无法解析错误信息，忽略
        }

        throw new Error(errorMessage);
      }

      debugLog('[AIService] 测试连接成功');
      return true;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(t('aiService.networkError', { message: String(error) }));
    }
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
   * @param providerId 供应商 ID
   * @returns 模型信息列表
   */
  async fetchModels(providerId: string): Promise<RemoteModelInfo[]> {
    const provider = this.configManager.getProvider(providerId);
    if (!provider) {
      throw new Error(t('aiService.providerNotFound', { id: providerId }));
    }

    debugLog('[AIService] 获取模型列表:', { provider: provider.name });

    // 验证配置
    if (!provider.apiKey || provider.apiKey.trim() === '') {
      throw new Error(t('aiService.providerApiKeyNotConfigured', { provider: provider.name }));
    }

    if (!provider.endpoint || provider.endpoint.trim() === '') {
      throw new Error(t('aiService.providerEndpointNotConfigured', { provider: provider.name }));
    }

    try {
      const timeoutMs = this.settings.timeout || 15000;

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(t('aiService.requestTimeout', { seconds: String(timeoutMs / 1000) })));
        }, timeoutMs);
      });

      // 构建 /v1/models 端点
      const modelsEndpoint = this.getModelsEndpoint(provider.endpoint);
      debugLog('[AIService] 获取模型列表端点:', modelsEndpoint);

      const requestPromise = requestUrl({
        url: modelsEndpoint,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${provider.apiKey}`
        },
        throw: false
      });

      const response = await Promise.race([requestPromise, timeoutPromise]) as RequestUrlResponse;
      debugLog('[AIService] 获取模型列表响应状态:', response.status);

      if (response.status !== 200) {
        let errorMessage = t('aiService.requestFailed', { status: String(response.status) });
        
        try {
          const errorData = response.json;
          if (errorData?.error?.message) {
            errorMessage += ` - ${errorData.error.message}`;
          }
        } catch {
          // 无法解析错误信息，忽略
        }

        throw new Error(errorMessage);
      }

      const data = response.json as ModelsAPIResponse;
      
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error(t('aiService.responseFormatError'));
      }

      // 解析模型列表并推断能力
      const models: RemoteModelInfo[] = data.data.map(model => {
        // 尝试从 API 返回的扩展字段获取能力信息
        const rawAbilities = model.capabilities ? {
          vision: model.capabilities.vision,
          functionCall: model.capabilities.function_calling,
          reasoning: model.capabilities.reasoning,
        } : undefined;

        // 获取上下文长度（优先使用 API 返回的值）
        const contextLength = model.context_length || model.max_context_length || this.inferContextLength(model.id);

        // 使用 inferModelType 推断模型类型
        const modelType = inferModelType(model.id);

        return {
          id: model.id,
          name: model.id,
          capabilities: [modelType],
          contextLength,
          rawAbilities,
        };
      });

      debugLog('[AIService] 获取到模型列表:', models.length, '个模型');
      // 检查是否有 API 返回能力信息的模型
      const modelsWithAbilities = models.filter(m => m.rawAbilities);
      if (modelsWithAbilities.length > 0) {
        debugLog('[AIService] 其中', modelsWithAbilities.length, '个模型有 API 返回的能力信息');
      }

      return models;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(t('aiService.networkError', { message: String(error) }));
    }
  }

  // ============================================================================
  // 模型能力推断方法
  // ============================================================================

  /**
   * 获取 /v1/models 端点
   * @param endpoint 原始端点
   * @returns models API 端点
   */
  private getModelsEndpoint(endpoint: string): string {
    let normalized = endpoint.trim();

    // 检查并添加协议
    if (!normalized.match(/^https?:\/\//i)) {
      if (normalized.startsWith('//')) {
        normalized = 'https:' + normalized;
      } else if (!normalized.includes('://')) {
        normalized = 'https://' + normalized;
      }
    }

    // 移除末尾多余的斜杠
    normalized = normalized.replace(/\/+$/, '');

    // 移除已有的路径部分，获取基础 URL
    const pathsToRemove = [
      '/v1/chat/completions',
      '/chat/completions',
      '/v1/completions',
      '/completions',
      '/v1/models',
      '/models',
      '/v1'  // 处理以 /v1 结尾的情况
    ];

    for (const path of pathsToRemove) {
      if (normalized.endsWith(path)) {
        normalized = normalized.slice(0, -path.length);
        break;
      }
    }

    // 添加 /v1/models 路径
    return normalized + '/v1/models';
  }

  /**
   * 根据模型名称推断上下文长度
   * @param modelId 模型 ID
   * @returns 上下文长度（tokens）
   */
  private inferContextLength(modelId: string): number | undefined {
    const id = modelId.toLowerCase();

    // 常见模型的上下文长度
    const contextLengths: Record<string, number> = {
      'gpt-4-turbo': 128000,
      'gpt-4o': 128000,
      'gpt-4': 8192,
      'gpt-3.5-turbo': 16385,
      'claude-3': 200000,
      'claude-2': 100000,
      'gemini-pro': 32000,
      'gemini-1.5': 1000000,
      'deepseek': 64000,
      'qwen-turbo': 8000,
      'qwen-plus': 32000,
      'qwen-max': 32000,
      'moonshot': 128000,
    };

    // 检查模型名称中的上下文长度标记
    const contextMatch = id.match(/(\d+)k/);
    if (contextMatch) {
      return parseInt(contextMatch[1]) * 1000;
    }

    // 根据已知模型返回上下文长度
    for (const [pattern, length] of Object.entries(contextLengths)) {
      if (id.includes(pattern)) {
        return length;
      }
    }

    return undefined;
  }
}
