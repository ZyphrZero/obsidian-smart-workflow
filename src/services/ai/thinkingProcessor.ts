/**
 * ThinkingProcessor - 思考过程处理器
 * 负责分离和处理 AI 的思考内容
 * 
 * 支持的思考标签格式：
 * - <think>...</think>
 * - <thinking>...</thinking>
 * - 【思考】...【/思考】
 * - [思考]...[/思考]
 * 

 */

import type { ThinkingPattern, ThinkingProcessResult } from './types';

/**
 * 思考标签模式常量
 * 定义所有支持的思考标签格式
 */
export const THINKING_PATTERNS: readonly ThinkingPattern[] = [
  { start: '<think>', end: '</think>' },
  { start: '<thinking>', end: '</thinking>' },
  { start: '【思考】', end: '【/思考】' },
  { start: '[思考]', end: '[/思考]' },
] as const;

/**
 * 思考处理器选项
 */
export interface ThinkingProcessorOptions {
  /** 思考内容回调（可选） */
  onThinking?: (content: string) => void;
  /** 实际内容回调 */
  onContent: (content: string) => void;
}

/**
 * 思考处理器类
 * 负责分离和处理 AI 的思考内容
 */
export class ThinkingProcessor {
  private options: ThinkingProcessorOptions;
  
  // 流式处理状态
  private isInThinkingBlock: boolean = false;
  private thinkingBuffer: string = '';
  private contentBuffer: string = '';
  private currentPatternIndex: number = -1;

  constructor(options: ThinkingProcessorOptions) {
    this.options = options;
  }

  // ============================================================================
  // 静态方法（非流式处理）
  // ============================================================================

  /**
   * 处理完整内容（非流式）
   * 从内容中提取思考部分和实际内容
   * @param content 原始内容
   * @returns 处理结果，包含思考内容和实际内容
   */
  static process(content: string): ThinkingProcessResult {
    let thinking = '';
    let processedContent = content;

    // 遍历所有思考标签模式
    for (const pattern of THINKING_PATTERNS) {
      // 使用正则表达式提取所有匹配的思考块
      const regex = ThinkingProcessor.createPatternRegex(pattern);
      const matches = processedContent.match(regex);
      
      if (matches) {
        for (const match of matches) {
          // 提取思考内容（去除标签）
          const thinkingContent = match
            .substring(pattern.start.length, match.length - pattern.end.length);
          thinking += thinkingContent;
        }
        // 从内容中移除思考块
        processedContent = processedContent.replace(regex, '');
      }
    }

    return {
      thinking: thinking.trim(),
      content: processedContent.trim(),
    };
  }

  /**
   * 创建匹配思考标签的正则表达式
   * @param pattern 思考标签模式
   * @returns 正则表达式
   */
  private static createPatternRegex(pattern: ThinkingPattern): RegExp {
    // 转义特殊字符
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startEscaped = escapeRegex(pattern.start);
    const endEscaped = escapeRegex(pattern.end);
    
    // 对于 <think> 和 <thinking> 标签，使用不区分大小写的匹配
    const flags = pattern.start.startsWith('<') ? 'gi' : 'g';
    
    return new RegExp(`${startEscaped}[\\s\\S]*?${endEscaped}`, flags);
  }

  /**
   * 从 DeepSeek 风格的响应中提取 reasoning_content 字段
   * @param parsed 解析后的响应对象
   * @returns 推理内容，如果不存在则返回空字符串
   */
  static extractReasoningContent(parsed: unknown): string {
    if (!parsed || typeof parsed !== 'object') {
      return '';
    }

    const obj = parsed as Record<string, unknown>;

    // DeepSeek 格式：choices[0].delta.reasoning_content（流式）
    if (obj.choices && Array.isArray(obj.choices)) {
      const choice = obj.choices[0] as Record<string, unknown> | undefined;
      if (choice?.delta) {
        const delta = choice.delta as Record<string, unknown>;
        if (delta.reasoning_content && typeof delta.reasoning_content === 'string') {
          return delta.reasoning_content;
        }
      }
      // DeepSeek 格式：choices[0].message.reasoning_content（非流式）
      if (choice?.message) {
        const message = choice.message as Record<string, unknown>;
        if (message.reasoning_content && typeof message.reasoning_content === 'string') {
          return message.reasoning_content;
        }
      }
    }

    // Responses API 格式的推理内容（流式）
    if (obj.type === 'response.reasoning.delta') {
      return (obj.delta as string) || '';
    }

    // Responses API 格式的推理内容（非流式）
    if (obj.type === 'reasoning' && obj.summary && Array.isArray(obj.summary)) {
      const summaryTexts: string[] = [];
      for (const item of obj.summary as Array<{ type?: string; text?: string }>) {
        if ((item.type === 'summary_text' || item.type === 'text') && item.text) {
          summaryTexts.push(item.text);
        }
      }
      return summaryTexts.join('\n');
    }

    return '';
  }

  // ============================================================================
  // 实例方法（流式处理）
  // ============================================================================

  /**
   * 处理流式内容块
   * 分离思考内容和实际内容，通过回调函数分别处理
   * @param chunk 内容块
   */
  processChunk(chunk: string): void {
    // 将 chunk 追加到内容缓冲区
    this.contentBuffer += chunk;
    
    // 处理缓冲区内容
    this.processBuffer();
  }

  /**
   * 处理缓冲区内容
   * 内部方法，用于解析和分发内容
   */
  private processBuffer(): void {
    let processedContent = this.contentBuffer;
    let outputContent = '';

    // 如果当前在思考块中，继续查找结束标签
    if (this.isInThinkingBlock && this.currentPatternIndex >= 0) {
      const pattern = THINKING_PATTERNS[this.currentPatternIndex];
      const endIndex = this.findPatternEnd(processedContent, pattern);
      
      if (endIndex !== -1) {
        // 找到结束标签
        const thinkingContent = processedContent.substring(0, endIndex);
        this.thinkingBuffer += thinkingContent;
        
        // 发送思考内容
        if (this.options.onThinking && this.thinkingBuffer) {
          this.options.onThinking(this.thinkingBuffer);
          this.thinkingBuffer = '';
        }
        
        // 更新处理内容，跳过结束标签
        processedContent = processedContent.substring(endIndex + pattern.end.length);
        this.isInThinkingBlock = false;
        this.currentPatternIndex = -1;
      } else {
        // 还没找到结束标签，继续累积思考内容
        // 实时输出思考内容（流式显示）
        if (this.options.onThinking && processedContent) {
          this.options.onThinking(processedContent);
        }
        this.thinkingBuffer += processedContent;
        this.contentBuffer = '';
        return;
      }
    }

    // 查找开始标签
    while (processedContent.length > 0) {
      const { patternIndex, startIndex } = this.findEarliestPatternStart(processedContent);
      
      if (patternIndex === -1) {
        // 没有找到任何开始标签
        // 检查是否有部分开始标签在末尾
        const partialStart = this.findPartialPatternStart(processedContent);
        if (partialStart > 0) {
          // 输出除了可能是部分标签的内容
          outputContent += processedContent.substring(0, processedContent.length - partialStart);
          this.contentBuffer = processedContent.substring(processedContent.length - partialStart);
        } else {
          outputContent += processedContent;
          this.contentBuffer = '';
        }
        break;
      }

      const pattern = THINKING_PATTERNS[patternIndex];
      
      // 开始标签之前的内容是正常内容
      outputContent += processedContent.substring(0, startIndex);
      
      // 检查是否有完整的思考块
      const afterStart = processedContent.substring(startIndex + pattern.start.length);
      const endIndex = this.findPatternEnd(afterStart, pattern);
      
      if (endIndex !== -1) {
        // 完整的思考块
        const thinkingContent = afterStart.substring(0, endIndex);
        if (this.options.onThinking) {
          this.options.onThinking(thinkingContent);
        }
        
        // 继续处理结束标签之后的内容
        processedContent = afterStart.substring(endIndex + pattern.end.length);
      } else {
        // 不完整的思考块，进入思考状态
        this.isInThinkingBlock = true;
        this.currentPatternIndex = patternIndex;
        // 实时输出思考内容（流式显示）
        if (this.options.onThinking && afterStart) {
          this.options.onThinking(afterStart);
        }
        this.thinkingBuffer = afterStart;
        this.contentBuffer = '';
        break;
      }
    }

    // 输出正常内容
    if (outputContent && this.options.onContent) {
      this.options.onContent(outputContent);
    }
  }

  /**
   * 查找最早出现的开始标签
   * @param content 内容
   * @returns 模式索引和开始位置
   */
  private findEarliestPatternStart(content: string): { patternIndex: number; startIndex: number } {
    let earliestIndex = -1;
    let earliestPatternIndex = -1;

    for (let i = 0; i < THINKING_PATTERNS.length; i++) {
      const pattern = THINKING_PATTERNS[i];
      const index = this.findPatternStart(content, pattern);
      
      if (index !== -1 && (earliestIndex === -1 || index < earliestIndex)) {
        earliestIndex = index;
        earliestPatternIndex = i;
      }
    }

    return { patternIndex: earliestPatternIndex, startIndex: earliestIndex };
  }

  /**
   * 查找开始标签位置（不区分大小写对于 HTML 标签）
   */
  private findPatternStart(content: string, pattern: ThinkingPattern): number {
    if (pattern.start.startsWith('<')) {
      // HTML 标签，不区分大小写
      return content.toLowerCase().indexOf(pattern.start.toLowerCase());
    }
    return content.indexOf(pattern.start);
  }

  /**
   * 查找结束标签位置（不区分大小写对于 HTML 标签）
   */
  private findPatternEnd(content: string, pattern: ThinkingPattern): number {
    if (pattern.end.startsWith('<')) {
      // HTML 标签，不区分大小写
      return content.toLowerCase().indexOf(pattern.end.toLowerCase());
    }
    return content.indexOf(pattern.end);
  }

  /**
   * 查找可能的部分开始标签
   * @param content 内容
   * @returns 部分标签的长度，0 表示没有
   */
  private findPartialPatternStart(content: string): number {
    let maxPartialLength = 0;

    for (const pattern of THINKING_PATTERNS) {
      const start = pattern.start.toLowerCase();
      // 检查内容末尾是否是开始标签的前缀
      for (let len = 1; len < start.length; len++) {
        const suffix = content.substring(content.length - len).toLowerCase();
        if (start.startsWith(suffix)) {
          maxPartialLength = Math.max(maxPartialLength, len);
        }
      }
    }

    return maxPartialLength;
  }

  /**
   * 查找可能的部分结束标签
   * @param content 内容
   * @param pattern 当前模式
   * @returns 部分标签的长度，0 表示没有
   */
  private findPartialPatternEnd(content: string, pattern: ThinkingPattern): number {
    const end = pattern.end.toLowerCase();
    // 检查内容末尾是否是结束标签的前缀
    for (let len = 1; len < end.length; len++) {
      const suffix = content.substring(content.length - len).toLowerCase();
      if (end.startsWith(suffix)) {
        return len;
      }
    }
    return 0;
  }

  /**
   * 重置处理器状态
   * 清除所有缓冲区和状态
   */
  reset(): void {
    this.isInThinkingBlock = false;
    this.thinkingBuffer = '';
    this.contentBuffer = '';
    this.currentPatternIndex = -1;
  }

  /**
   * 刷新缓冲区
   * 返回所有缓冲的内容并重置状态
   * @returns 处理结果
   */
  flush(): ThinkingProcessResult {
    const result: ThinkingProcessResult = {
      thinking: this.thinkingBuffer,
      content: this.contentBuffer,
    };

    // 如果在思考块中，将缓冲内容作为思考内容
    if (this.isInThinkingBlock) {
      result.thinking = this.thinkingBuffer;
      result.content = '';
    } else {
      result.thinking = '';
      result.content = this.contentBuffer;
    }

    // 重置状态
    this.reset();

    return result;
  }

  // ============================================================================
  // 状态查询方法
  // ============================================================================

  /**
   * 检查是否在思考块中
   */
  isProcessingThinking(): boolean {
    return this.isInThinkingBlock;
  }

  /**
   * 获取当前思考缓冲区内容
   */
  getThinkingBuffer(): string {
    return this.thinkingBuffer;
  }

  /**
   * 获取当前内容缓冲区内容
   */
  getContentBuffer(): string {
    return this.contentBuffer;
  }
}
