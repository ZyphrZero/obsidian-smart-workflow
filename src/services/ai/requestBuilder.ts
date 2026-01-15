/**
 * AI 请求构建器
 * 根据 API 格式构建统一的请求体
 * 

 */

import type {
  RequestBuilderOptions,
  ChatCompletionsRequest,
  ResponsesAPIRequest,
  ModelConfig,
  APIFormat,
  ReasoningEffort,
} from './types';
import { InvalidReasoningEffortError, AIError, AIErrorCode } from './errors';
import { inferOutputTokenLimit } from './modelContextLengths';

/**
 * 请求构建器类
 * 负责根据 API 格式构建正确的请求体
 */
export class RequestBuilder {
  /**
   * 构建请求体（自动选择格式）
   * 根据模型的 apiFormat 配置自动选择正确的构建方法
   * 
   * @param options 请求构建选项
   * @returns 构建好的请求体
   * @throws AIError 如果参数验证失败
   * 

   */
  static build(options: RequestBuilderOptions): ChatCompletionsRequest | ResponsesAPIRequest {
    // 验证参数
    RequestBuilder.validate(options);

    // 获取 API 格式，默认为 'chat-completions'
    const apiFormat = options.model.apiFormat || 'chat-completions';

    if (apiFormat === 'responses') {
      return RequestBuilder.buildResponses(options);
    }

    return RequestBuilder.buildChatCompletions(options);
  }

  /**
   * 构建 Chat Completions API 请求体
   * 用于传统的 /v1/chat/completions 端点
   * 
   * @param options 请求构建选项
   * @returns Chat Completions API 请求体
   * 

   */
  static buildChatCompletions(options: RequestBuilderOptions): ChatCompletionsRequest {
    const { model, prompt, messages: historyMessages, systemPrompt, stream } = options;

    // 验证输出 token 限制
    RequestBuilder.validateOutputTokenLimit(model);

    // 构建消息数组
    const messages: Array<{ role: string; content: string }> = [];

    // 如果有系统提示，添加 system 消息
    // 注意：如果 historyMessages 中已经包含了 system 消息，这里可能会重复，
    // 但通常 historyMessages 主要是 user/assistant 交互。
    // 如果调用者已经手动构建了包含 system 的 messages，则不应再传 systemPrompt。
    if (systemPrompt && systemPrompt.trim()) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    if (historyMessages && historyMessages.length > 0) {
      messages.push(...historyMessages);
    }
    
    // 如果同时提供了 prompt，将其作为最新的 user 消息添加
    if (prompt && prompt.trim()) {
      messages.push({ role: 'user', content: prompt });
    }

    const request: ChatCompletionsRequest = {
      model: model.name,
      messages,
      temperature: model.temperature,
      top_p: model.topP,
    };

    // 仅当 maxOutputTokens 为正整数时才添加 max_tokens 参数
    if (model.maxOutputTokens && model.maxOutputTokens > 0) {
      request.max_tokens = model.maxOutputTokens;
    }

    // 设置流式模式
    if (stream !== undefined) {
      request.stream = stream;
    }

    return request;
  }

  /**
   * 构建 Responses API 请求体
   * 用于新的 /v1/responses 端点，专为推理模型设计
   * 
   * @param options 请求构建选项
   * @returns Responses API 请求体
   * @throws InvalidReasoningEffortError 如果 reasoningEffort 值无效
   * 

   */
  static buildResponses(options: RequestBuilderOptions): ResponsesAPIRequest {
    const { model, prompt, messages, systemPrompt, stream } = options;

    // 验证输出 token 限制
    RequestBuilder.validateOutputTokenLimit(model);

    // 获取推理深度，默认为 'medium'
    const reasoningEffort: ReasoningEffort = model.reasoningEffort || 'medium';

    // 验证 reasoningEffort 值
    const validEfforts: ReasoningEffort[] = ['low', 'medium', 'high'];
    if (!validEfforts.includes(reasoningEffort)) {
      throw new InvalidReasoningEffortError(reasoningEffort);
    }

    // 构建输入内容
    // Responses API 支持字符串或消息数组格式
    let input: string | Array<{ type: string; role?: string; content?: string }>;

    if (messages && messages.length > 0) {
        input = [];
        if (systemPrompt && systemPrompt.trim()) {
             input.push({ type: 'message', role: 'system', content: systemPrompt });
        }
        input.push(...messages.map(m => ({ type: 'message', role: m.role, content: m.content })));
        if (prompt && prompt.trim()) {
             input.push({ type: 'message', role: 'user', content: prompt });
        }
    } else if (systemPrompt && systemPrompt.trim()) {
      // 如果有系统提示，使用消息数组格式
      input = [
        { type: 'message', role: 'system', content: systemPrompt },
        { type: 'message', role: 'user', content: prompt || '' },
      ];
    } else {
      // 否则使用简单字符串格式
      input = prompt || '';
    }

    const request: ResponsesAPIRequest = {
      model: model.name,
      input,
      reasoning: {
        effort: reasoningEffort,
      },
    };

    // 仅当 maxOutputTokens 为正整数时才添加 max_output_tokens 参数
    if (model.maxOutputTokens && model.maxOutputTokens > 0) {
      request.max_output_tokens = model.maxOutputTokens;
    }

    // 设置流式模式
    if (stream !== undefined) {
      request.stream = stream;
    }

    return request;
  }

  /**
   * 验证请求参数
   * 在构建请求前验证必需参数
   * 
   * @param options 请求构建选项
   * @throws AIError 如果验证失败
   * 

   */
  static validate(options: RequestBuilderOptions): void {
    const { model, prompt, messages } = options;

    // 验证模型配置
    if (!model) {
      throw new AIError(
        AIErrorCode.INVALID_RESPONSE,
        'Model configuration is required',
        false
      );
    }

    if (!model.name || model.name.trim() === '') {
      throw new AIError(
        AIErrorCode.INVALID_RESPONSE,
        'Model name is required',
        false
      );
    }

    // 验证 prompt 或 messages
    const hasPrompt = prompt && prompt.trim() !== '';
    const hasMessages = messages && messages.length > 0;

    if (!hasPrompt && !hasMessages) {
      throw new AIError(
        AIErrorCode.INVALID_RESPONSE,
        'Either prompt or messages is required',
        false
      );
    }

    // 验证 API 格式（如果指定）
    const apiFormat = model.apiFormat;
    if (apiFormat && apiFormat !== 'chat-completions' && apiFormat !== 'responses') {
      throw new AIError(
        AIErrorCode.UNSUPPORTED_API_FORMAT,
        `Unsupported API format: ${apiFormat}`,
        false
      );
    }

    // 验证 reasoningEffort（如果使用 Responses API）
    if (apiFormat === 'responses' && model.reasoningEffort) {
      const validEfforts: ReasoningEffort[] = ['low', 'medium', 'high'];
      if (!validEfforts.includes(model.reasoningEffort)) {
        throw new InvalidReasoningEffortError(model.reasoningEffort);
      }
    }

    // 验证数值参数范围
    if (model.temperature !== undefined) {
      if (model.temperature < 0 || model.temperature > 2) {
        throw new AIError(
          AIErrorCode.INVALID_RESPONSE,
          'Temperature must be between 0 and 2',
          false
        );
      }
    }

    if (model.topP !== undefined) {
      if (model.topP < 0 || model.topP > 1) {
        throw new AIError(
          AIErrorCode.INVALID_RESPONSE,
          'Top P must be between 0 and 1',
          false
        );
      }
    }

    if (model.maxOutputTokens !== undefined && model.maxOutputTokens < 0) {
      throw new AIError(
        AIErrorCode.INVALID_RESPONSE,
        'Max output tokens must be a non-negative number',
        false
      );
    }
  }

  /**
   * 验证输出 token 限制
   * 检查配置的 maxOutputTokens 是否超过模型的已知限制
   * 
   * @param model 模型配置
   */
  static validateOutputTokenLimit(model: ModelConfig): void {
    if (!model.maxOutputTokens || model.maxOutputTokens <= 0) {
      return; // 未配置或为自动模式，无需验证
    }

    const modelLimit = inferOutputTokenLimit(model.name);
    if (model.maxOutputTokens > modelLimit) {
      console.warn(
        `[RequestBuilder] maxOutputTokens (${model.maxOutputTokens}) exceeds the known limit (${modelLimit}) for model "${model.name}". This may cause API errors.`
      );
    }
  }

  /**
   * 获取请求的 API 格式
   * 辅助方法，用于确定请求应使用的 API 格式
   * 
   * @param model 模型配置
   * @returns API 格式
   */
  static getAPIFormat(model: ModelConfig): APIFormat {
    return model.apiFormat || 'chat-completions';
  }

  /**
   * 检查请求是否为流式模式
   * 
   * @param request 请求体
   * @returns 是否为流式模式
   */
  static isStreamRequest(request: ChatCompletionsRequest | ResponsesAPIRequest): boolean {
    return request.stream === true;
  }
}
