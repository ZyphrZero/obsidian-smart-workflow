/**
 * AI 通信层错误类型定义
 * 提供统一的错误类型和类型守卫函数
 * 

 */

import { t } from '../../i18n';

// ============================================================================
// 错误代码枚举
// ============================================================================

/**
 * AI 错误代码枚举
 * 定义所有可能的 AI 通信层错误类型
 */
export enum AIErrorCode {
  // 配置错误
  /** 未配置供应商 */
  NO_PROVIDER_CONFIGURED = 'NO_PROVIDER_CONFIGURED',
  /** 无效的 API Key */
  INVALID_API_KEY = 'INVALID_API_KEY',
  /** 无效的端点 */
  INVALID_ENDPOINT = 'INVALID_ENDPOINT',

  // 请求错误
  /** 请求失败 */
  REQUEST_FAILED = 'REQUEST_FAILED',
  /** 请求超时 */
  TIMEOUT = 'TIMEOUT',
  /** 网络错误 */
  NETWORK_ERROR = 'NETWORK_ERROR',

  // 格式错误
  /** 不支持的 API 格式 */
  UNSUPPORTED_API_FORMAT = 'UNSUPPORTED_API_FORMAT',
  /** 无效的推理深度 */
  INVALID_REASONING_EFFORT = 'INVALID_REASONING_EFFORT',
  /** 无效的响应 */
  INVALID_RESPONSE = 'INVALID_RESPONSE',

  // 流式错误
  /** 流式传输中断 */
  STREAM_INTERRUPTED = 'STREAM_INTERRUPTED',
  /** 流式解析错误 */
  STREAM_PARSE_ERROR = 'STREAM_PARSE_ERROR',
}

// ============================================================================
// 基础错误类
// ============================================================================

/**
 * AI 错误基类
 * 所有 AI 通信层错误的基类
 */
export class AIError extends Error {
  /** 错误代码 */
  public readonly code: AIErrorCode;
  /** 是否可重试 */
  public readonly retryable: boolean;
  /** 原始错误（如果有） */
  public readonly originalError?: Error;

  constructor(
    code: AIErrorCode,
    message: string,
    retryable: boolean = true,
    originalError?: Error
  ) {
    super(message);
    this.name = 'AIError';
    this.code = code;
    this.retryable = retryable;
    this.originalError = originalError;

    // 确保原型链正确（TypeScript 编译到 ES5 时需要）
    Object.setPrototypeOf(this, AIError.prototype);
  }
}

// ============================================================================
// 特定错误类型
// ============================================================================

/**
 * 不支持的 API 格式错误
 * 当模型不支持指定的 API 格式时抛出
 */
export class UnsupportedAPIFormatError extends AIError {
  /** 请求的 API 格式 */
  public readonly requestedFormat: string;
  /** 建议使用的 API 格式 */
  public readonly suggestedFormat: string;
  /** HTTP 状态码（如果有） */
  public readonly httpStatus?: number;

  constructor(
    requestedFormat: string,
    suggestedFormat: string = 'chat-completions',
    httpStatus?: number
  ) {
    const message = t('aiService.unsupportedApiFormat', {
      format: requestedFormat,
      suggestion: suggestedFormat
    });
    super(AIErrorCode.UNSUPPORTED_API_FORMAT, message, false);
    this.name = 'UnsupportedAPIFormatError';
    this.requestedFormat = requestedFormat;
    this.suggestedFormat = suggestedFormat;
    this.httpStatus = httpStatus;

    Object.setPrototypeOf(this, UnsupportedAPIFormatError.prototype);
  }
}

/**
 * 无效的推理深度错误
 * 当提供的 reasoningEffort 值无效时抛出
 */
export class InvalidReasoningEffortError extends AIError {
  /** 提供的无效值 */
  public readonly providedValue: string;
  /** 有效的选项列表 */
  public readonly validOptions: string[];

  constructor(providedValue: string) {
    const validOptions = ['low', 'medium', 'high'];
    const message = t('aiService.invalidReasoningEffort', {
      value: providedValue,
      validOptions: validOptions.join(', ')
    });
    super(AIErrorCode.INVALID_REASONING_EFFORT, message, false);
    this.name = 'InvalidReasoningEffortError';
    this.providedValue = providedValue;
    this.validOptions = validOptions;

    Object.setPrototypeOf(this, InvalidReasoningEffortError.prototype);
  }
}

/**
 * 网络错误
 * 当发生网络连接问题时抛出
 */
export class NetworkError extends AIError {
  /** 原始错误消息 */
  public readonly originalMessage: string;

  constructor(message: string, originalError?: Error) {
    const fullMessage = t('aiService.networkError', { message });
    super(AIErrorCode.NETWORK_ERROR, fullMessage, true, originalError);
    this.name = 'NetworkError';
    this.originalMessage = message;

    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * 超时错误
 * 当请求超过配置的超时时间时抛出
 */
export class TimeoutError extends AIError {
  /** 超时时间（毫秒） */
  public readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    const message = t('aiService.requestTimeout', {
      seconds: String(timeoutMs / 1000)
    });
    super(AIErrorCode.TIMEOUT, message, true);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;

    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * 流式传输中断错误
 * 当流式传输被中断时抛出
 */
export class StreamInterruptedError extends AIError {
  /** 已接收的内容 */
  public readonly accumulatedContent: string;
  /** 中断原因 */
  public readonly reason?: string;

  constructor(accumulatedContent: string, reason?: string, originalError?: Error) {
    const message = reason
      ? t('writing.errors.streamInterrupted', { reason })
      : t('writing.errors.streamInterrupted', { reason: 'Unknown' });
    super(AIErrorCode.STREAM_INTERRUPTED, message, true, originalError);
    this.name = 'StreamInterruptedError';
    this.accumulatedContent = accumulatedContent;
    this.reason = reason;

    Object.setPrototypeOf(this, StreamInterruptedError.prototype);
  }
}

/**
 * Responses API 错误
 * 用于处理 Responses API 特有的错误响应
 */
export class ResponsesAPIError extends AIError {
  /** HTTP 状态码 */
  public readonly statusCode: number;
  /** 错误类型 */
  public readonly errorType?: string;
  /** 原始错误消息 */
  public readonly originalMessage?: string;

  constructor(
    statusCode: number,
    message: string,
    errorType?: string,
    originalMessage?: string
  ) {
    super(AIErrorCode.REQUEST_FAILED, message, statusCode >= 500);
    this.name = 'ResponsesAPIError';
    this.statusCode = statusCode;
    this.errorType = errorType;
    this.originalMessage = originalMessage;

    Object.setPrototypeOf(this, ResponsesAPIError.prototype);
  }
}

/**
 * 无效响应错误
 * 当 API 响应格式无效时抛出
 */
export class InvalidResponseError extends AIError {
  /** 响应数据（用于调试） */
  public readonly responseData?: unknown;

  constructor(message: string, responseData?: unknown) {
    super(AIErrorCode.INVALID_RESPONSE, message, false);
    this.name = 'InvalidResponseError';
    this.responseData = responseData;

    Object.setPrototypeOf(this, InvalidResponseError.prototype);
  }
}

// ============================================================================
// 类型守卫函数
// ============================================================================

/**
 * 检查错误是否为 AIError
 */
export function isAIError(error: unknown): error is AIError {
  return error instanceof AIError;
}

/**
 * 检查错误是否为 UnsupportedAPIFormatError
 */
export function isUnsupportedAPIFormatError(error: unknown): error is UnsupportedAPIFormatError {
  return error instanceof UnsupportedAPIFormatError;
}

/**
 * 检查错误是否为 InvalidReasoningEffortError
 */
export function isInvalidReasoningEffortError(error: unknown): error is InvalidReasoningEffortError {
  return error instanceof InvalidReasoningEffortError;
}

/**
 * 检查错误是否为 NetworkError
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

/**
 * 检查错误是否为 TimeoutError
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}

/**
 * 检查错误是否为 StreamInterruptedError
 */
export function isStreamInterruptedError(error: unknown): error is StreamInterruptedError {
  return error instanceof StreamInterruptedError;
}

/**
 * 检查错误是否为 ResponsesAPIError
 */
export function isResponsesAPIError(error: unknown): error is ResponsesAPIError {
  return error instanceof ResponsesAPIError;
}

/**
 * 检查错误是否为 InvalidResponseError
 */
export function isInvalidResponseError(error: unknown): error is InvalidResponseError {
  return error instanceof InvalidResponseError;
}

/**
 * 检查错误是否可重试
 */
export function isRetryableError(error: unknown): boolean {
  if (isAIError(error)) {
    return error.retryable;
  }
  return false;
}

/**
 * 根据错误代码检查错误类型
 */
export function hasErrorCode(error: unknown, code: AIErrorCode): boolean {
  if (isAIError(error)) {
    return error.code === code;
  }
  return false;
}
