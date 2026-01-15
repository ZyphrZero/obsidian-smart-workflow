/**
 * ResponseParser - 响应解析器
 * 负责解析不同格式的 AI 响应
 * 
 * 支持的响应格式：
 * - Chat Completions API (choices[0].message.content)
 * - Responses API (output 数组)
 * 

 */

import type {
  ParsedResponse,
  ChatCompletionsResponse,
  ResponsesAPIResponse,
  ResponsesOutputItem,
} from './types';
import { ThinkingProcessor } from './thinkingProcessor';
import { InvalidResponseError } from './errors';
import { t } from '../../i18n';

/**
 * 响应格式类型
 */
export type ResponseFormat = 'chat-completions' | 'responses' | 'unknown';

/**
 * 响应解析器类
 * 提供统一的 AI 响应解析接口
 */
export class ResponseParser {
  // ============================================================================
  // 主要解析方法
  // ============================================================================

  /**
   * 解析响应（自动检测格式）
   * 根据响应结构自动判断是 Chat Completions 还是 Responses API 格式
   * @param response API 响应数据
   * @returns 解析后的响应
   * @throws InvalidResponseError 如果响应格式无效
   */
  static parse(response: unknown): ParsedResponse {
    // 检测响应格式
    const format = ResponseParser.detectFormat(response);

    switch (format) {
      case 'chat-completions':
        return ResponseParser.parseChatCompletions(response as ChatCompletionsResponse);
      case 'responses':
        return ResponseParser.parseResponses(response as ResponsesAPIResponse);
      default:
        throw new InvalidResponseError(
          t('aiService.responseFormatError'),
          response
        );
    }
  }

  /**
   * 解析 Chat Completions API 响应
   * 从 choices[0].message.content 提取内容
   * 支持智谱 AI 等供应商的 reasoning_content 字段
   * @param response Chat Completions API 响应
   * @returns 解析后的响应
   * @throws InvalidResponseError 如果响应结构无效
   */
  static parseChatCompletions(response: ChatCompletionsResponse): ParsedResponse {
    // 检查错误响应
    if (response.error?.message) {
      throw new InvalidResponseError(
        response.error.message,
        response
      );
    }

    // 验证 choices 数组
    if (!response.choices || response.choices.length === 0) {
      throw new InvalidResponseError(
        t('aiService.missingChoices'),
        response
      );
    }

    const choice = response.choices[0];

    // 获取 content，可能为空字符串
    const rawContent = choice.message?.content || '';

    // 检查是否有 reasoning_content（智谱 AI / DeepSeek 风格）
    // 直接从 message 中提取，因为 extractReasoningContent 期望完整响应对象
    const message = choice.message as Record<string, unknown> | undefined;
    const reasoningContent = (message?.reasoning_content as string) || '';

    // 验证：content 和 reasoning_content 至少有一个非空
    if (!rawContent && !reasoningContent) {
      throw new InvalidResponseError(
        t('aiService.missingContent'),
        response
      );
    }

    // 使用 ThinkingProcessor 处理思考内容
    const processed = ThinkingProcessor.process(rawContent);

    // 确定最终内容：优先使用 content，如果为空则使用 reasoning_content
    const finalContent = processed.content || reasoningContent;

    // 构建解析结果
    const result: ParsedResponse = {
      content: finalContent,
    };

    // 如果有推理内容且 content 也有内容，将推理内容作为摘要
    // 如果 content 为空，reasoning_content 已作为主内容，不再重复添加
    if (processed.content && (reasoningContent || processed.thinking)) {
      result.reasoningSummary = reasoningContent || processed.thinking;
    }

    // 提取使用量统计
    if (response.usage) {
      result.usage = {
        inputTokens: response.usage.prompt_tokens || 0,
        outputTokens: response.usage.completion_tokens || 0,
      };
    }

    return result;
  }

  /**
   * 解析 Responses API 响应
   * 从 output 数组提取内容和推理摘要
   * @param response Responses API 响应
   * @returns 解析后的响应
   * @throws InvalidResponseError 如果响应结构无效
   */
  static parseResponses(response: ResponsesAPIResponse): ParsedResponse {
    // 检查错误响应
    if (response.error?.message) {
      throw new InvalidResponseError(
        response.error.message,
        response
      );
    }

    // 验证 output 数组
    if (!response.output || response.output.length === 0) {
      throw new InvalidResponseError(
        t('aiService.missingOutput'),
        response
      );
    }

    let messageContent = '';
    let reasoningSummary: string | undefined;

    // 遍历 output 数组，提取消息内容和推理摘要
    for (const item of response.output) {
      if (item.type === 'message') {
        messageContent += ResponseParser.extractMessageContent(item);
      } else if (item.type === 'reasoning') {
        const summary = ResponseParser.extractReasoningSummary(item);
        if (summary) {
          reasoningSummary = reasoningSummary
            ? reasoningSummary + '\n' + summary
            : summary;
        }
      }
    }

    // 验证是否提取到内容
    if (!messageContent) {
      throw new InvalidResponseError(
        t('aiService.missingContent'),
        response
      );
    }

    // 使用 ThinkingProcessor 处理可能的思考标签
    const processed = ThinkingProcessor.process(messageContent);

    // 合并推理摘要
    if (processed.thinking) {
      reasoningSummary = reasoningSummary
        ? reasoningSummary + '\n' + processed.thinking
        : processed.thinking;
    }

    // 构建解析结果
    const result: ParsedResponse = {
      content: processed.content,
    };

    if (reasoningSummary) {
      result.reasoningSummary = reasoningSummary;
    }

    // 提取使用量统计
    if (response.usage) {
      result.usage = {
        inputTokens: response.usage.input_tokens || 0,
        outputTokens: response.usage.output_tokens || 0,
        reasoningTokens: response.usage.reasoning_tokens,
      };
    }

    return result;
  }

  // ============================================================================
  // 格式检测方法
  // ============================================================================

  /**
   * 检测响应格式
   * 根据响应结构判断是 Chat Completions 还是 Responses API 格式
   * @param response API 响应数据
   * @returns 响应格式类型
   */
  static detectFormat(response: unknown): ResponseFormat {
    // 检查是否为有效对象
    if (!response || typeof response !== 'object') {
      return 'unknown';
    }

    const responseObj = response as Record<string, unknown>;

    // 检测 Responses API 格式：包含 output 数组
    if ('output' in responseObj && Array.isArray(responseObj.output)) {
      return 'responses';
    }

    // 检测 Chat Completions API 格式：包含 choices 数组
    if ('choices' in responseObj && Array.isArray(responseObj.choices)) {
      return 'chat-completions';
    }

    return 'unknown';
  }

  // ============================================================================
  // 辅助方法
  // ============================================================================

  /**
   * 从 Responses API 的 message 项中提取文本内容
   * @param item 输出项
   * @returns 提取的文本内容
   */
  private static extractMessageContent(item: ResponsesOutputItem): string {
    let content = '';

    if (item.content && Array.isArray(item.content)) {
      for (const contentItem of item.content) {
        // 支持 output_text 和 text 两种类型
        if ((contentItem.type === 'output_text' || contentItem.type === 'text') && contentItem.text) {
          content += contentItem.text;
        }
      }
    }

    return content;
  }

  /**
   * 从 Responses API 的 reasoning 项中提取推理摘要
   * @param item 输出项
   * @returns 推理摘要，如果不存在则返回 undefined
   */
  private static extractReasoningSummary(item: ResponsesOutputItem): string | undefined {
    if (item.summary && Array.isArray(item.summary)) {
      const summaryTexts: string[] = [];

      for (const summaryItem of item.summary) {
        // 支持 summary_text 和 text 两种类型
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
}
