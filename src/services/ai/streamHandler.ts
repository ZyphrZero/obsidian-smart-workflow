/**
 * StreamHandler - 流式响应处理器
 * 负责处理 SSE (Server-Sent Events) 格式的流式响应
 * 
 * 支持的 API 格式：
 * - Chat Completions API (OpenAI 标准格式)
 * - Responses API (推理模型格式)
 * 

 */

import { StreamHandlerOptions } from './types';
import { ThinkingProcessor } from './thinkingProcessor';
import { StreamInterruptedError, AIError, AIErrorCode } from './errors';

/**
 * 流式处理器类
 * 处理 SSE 流式响应，支持 Chat Completions 和 Responses API 格式
 */
export class StreamHandler {
  private options: StreamHandlerOptions;
  private thinkingProcessor: ThinkingProcessor;
  
  // 累积内容
  private accumulatedContent: string = '';
  
  // SSE 行缓冲区（处理跨块的不完整行）
  private lineBuffer: string = '';
  
  // 是否已完成
  private isCompleted: boolean = false;

  constructor(options: StreamHandlerOptions) {
    this.options = options;
    
    // 初始化思考处理器
    this.thinkingProcessor = new ThinkingProcessor({
      onThinking: (content: string) => {
        if (this.options.onThinking) {
          this.options.onThinking(content);
        }
      },
      onContent: (content: string) => {
        this.accumulatedContent += content;
        this.options.onChunk(content);
      },
    });
  }

  // ============================================================================
  // 公共方法
  // ============================================================================

  /**
   * 处理 Response 流
   * @param response Fetch Response 对象
   */
  async handleStream(response: Response): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new AIError(
        AIErrorCode.INVALID_RESPONSE,
        'Response body is not readable',
        false
      );
    }

    const decoder = new TextDecoder();
    
    try {
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;

        if (done) {
          break;
        }

        const value = result.value;

        // 解码并追加到缓冲区
        this.lineBuffer += decoder.decode(value, { stream: true });

        // 按行处理
        this.processBuffer();
      }

      // 处理缓冲区中剩余的数据
      this.processRemainingBuffer();

      // 刷新思考处理器中的缓冲内容
      const flushed = this.thinkingProcessor.flush();
      if (flushed.content) {
        this.accumulatedContent += flushed.content;
        this.options.onChunk(flushed.content);
      }

      // 标记完成
      this.isCompleted = true;
      
      // 通知完成
      this.options.onComplete(this.accumulatedContent);
    } catch (error) {
      // 处理流中断错误
      if (error instanceof Error && error.name === 'AbortError') {
        // 请求被取消，保留已接收的内容
        const interruptedError = new StreamInterruptedError(
          this.accumulatedContent,
          'Request aborted',
          error
        );
        this.options.onError(interruptedError);
        return;
      }

      // 其他错误
      const streamError = error instanceof AIError
        ? error
        : new StreamInterruptedError(
            this.accumulatedContent,
            error instanceof Error ? error.message : String(error),
            error instanceof Error ? error : undefined
          );
      
      this.options.onError(streamError);
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 获取累积的内容
   * @returns 累积的完整内容
   */
  getAccumulatedContent(): string {
    return this.accumulatedContent;
  }

  /**
   * 检查流是否已完成
   */
  isStreamCompleted(): boolean {
    return this.isCompleted;
  }

  /**
   * 重置处理器状态
   */
  reset(): void {
    this.accumulatedContent = '';
    this.lineBuffer = '';
    this.isCompleted = false;
    this.thinkingProcessor.reset();
  }

  // ============================================================================
  // 私有方法 - SSE 解析
  // ============================================================================

  /**
   * 处理缓冲区内容
   * 按行分割并处理每一行
   */
  private processBuffer(): void {
    // 按行分割
    const lines = this.lineBuffer.split('\n');
    
    // 保留最后一个可能不完整的行
    this.lineBuffer = lines.pop() || '';

    // 处理完整的行
    for (const line of lines) {
      this.processLine(line);
    }
  }

  /**
   * 处理缓冲区中剩余的数据
   */
  private processRemainingBuffer(): void {
    if (this.lineBuffer.trim()) {
      this.processLine(this.lineBuffer);
      this.lineBuffer = '';
    }
  }

  /**
   * 处理单行 SSE 数据
   * @param line SSE 行
   */
  private processLine(line: string): void {
    const trimmedLine = line.trim();

    // 跳过空行和注释
    if (!trimmedLine || trimmedLine.startsWith(':')) {
      return;
    }

    // 解析 SSE 数据行
    const parsed = this.parseSSELine(trimmedLine);
    if (!parsed) {
      return;
    }

    // 处理解析后的数据
    this.handleParsedData(parsed);
  }

  /**
   * 解析 SSE 行
   * @param line SSE 行
   * @returns 解析结果，如果无法解析则返回 null
   */
  private parseSSELine(line: string): { type: string; data: unknown } | null {
    // 检查是否是 data 行
    if (!line.startsWith('data: ')) {
      // 可能是其他 SSE 字段（event, id, retry），暂时忽略
      return null;
    }

    const data = line.slice(6); // 移除 'data: ' 前缀

    // 检查是否是结束标记
    if (data === '[DONE]') {
      return { type: 'done', data: null };
    }

    // 尝试解析 JSON
    try {
      const parsed = JSON.parse(data);
      return { type: 'data', data: parsed };
    } catch {
      // JSON 解析失败，返回原始数据
      return { type: 'raw', data };
    }
  }

  /**
   * 处理解析后的 SSE 数据
   * @param parsed 解析结果
   */
  private handleParsedData(parsed: { type: string; data: unknown }): void {
    // 结束标记
    if (parsed.type === 'done') {
      return;
    }

    // 原始数据（JSON 解析失败）
    if (parsed.type === 'raw') {
      return;
    }

    // JSON 数据
    const data = parsed.data as Record<string, unknown>;

    // 检查是否有独立的 reasoning_content 字段（如 DeepSeek）
    const reasoningContent = ThinkingProcessor.extractReasoningContent(data);
    if (reasoningContent && this.options.onThinking) {
      this.options.onThinking(reasoningContent);
    }

    // 提取流式内容
    const content = this.extractStreamContent(data);
    if (content) {
      // 通过思考处理器处理内容（分离思考标签）
      this.thinkingProcessor.processChunk(content);
    }
  }

  /**
   * 从流式响应中提取内容
   * @param parsed 解析后的 JSON 数据
   * @returns 提取的内容
   */
  private extractStreamContent(parsed: Record<string, unknown>): string {
    const apiFormat = this.options.apiFormat;

    // Chat Completions API 格式
    if (apiFormat === 'chat-completions' || this.isChatCompletionsFormat(parsed)) {
      return this.extractChatCompletionsContent(parsed);
    }

    // Responses API 格式
    if (apiFormat === 'responses' || this.isResponsesFormat(parsed)) {
      return this.extractResponsesContent(parsed);
    }

    // 尝试通用提取
    return this.extractGenericContent(parsed);
  }

  /**
   * 检查是否是 Chat Completions 格式
   */
  private isChatCompletionsFormat(parsed: Record<string, unknown>): boolean {
    return Array.isArray(parsed.choices);
  }

  /**
   * 检查是否是 Responses API 格式
   */
  private isResponsesFormat(parsed: Record<string, unknown>): boolean {
    return typeof parsed.type === 'string' && 
           (parsed.type.startsWith('response.') || parsed.type === 'done');
  }

  /**
   * 提取 Chat Completions 格式的内容
   */
  private extractChatCompletionsContent(parsed: Record<string, unknown>): string {
    if (!parsed.choices || !Array.isArray(parsed.choices)) {
      return '';
    }

    const choice = parsed.choices[0] as Record<string, unknown> | undefined;
    if (!choice?.delta) {
      return '';
    }

    const delta = choice.delta as Record<string, unknown>;
    return (delta.content as string) || '';
  }

  /**
   * 提取 Responses API 格式的内容
   */
  private extractResponsesContent(parsed: Record<string, unknown>): string {
    // 文本输出增量
    if (parsed.type === 'response.output_text.delta') {
      return (parsed.delta as string) || '';
    }

    // 内容部分增量
    if (parsed.type === 'response.content_part.delta') {
      const delta = parsed.delta as Record<string, unknown> | undefined;
      if (delta?.text) {
        return delta.text as string;
      }
    }

    return '';
  }

  /**
   * 通用内容提取
   */
  private extractGenericContent(parsed: Record<string, unknown>): string {
    // 尝试直接获取 delta 字段
    if (parsed.delta && typeof parsed.delta === 'string') {
      return parsed.delta;
    }

    // 尝试获取 content 字段
    if (parsed.content && typeof parsed.content === 'string') {
      return parsed.content;
    }

    // 尝试获取 text 字段
    if (parsed.text && typeof parsed.text === 'string') {
      return parsed.text;
    }

    return '';
  }
}
