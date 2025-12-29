/**
 * 写作功能错误类型定义

 */

/**
 * 写作错误代码枚举
 */
export enum WritingErrorCode {
  /** 未配置 AI 供应商 */
  NO_PROVIDER_CONFIGURED = 'NO_PROVIDER_CONFIGURED',
  /** API 请求失败 */
  API_REQUEST_FAILED = 'API_REQUEST_FAILED',
  /** 流式传输中断 */
  STREAM_INTERRUPTED = 'STREAM_INTERRUPTED',
  /** 网络错误 */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** 请求超时 */
  TIMEOUT = 'TIMEOUT',
  /** 无效响应 */
  INVALID_RESPONSE = 'INVALID_RESPONSE',
}

/**
 * 写作功能错误类
 */
export class WritingError extends Error {
  /** 错误代码 */
  public readonly code: WritingErrorCode;
  /** 是否可重试 */
  public readonly retryable: boolean;

  constructor(
    code: WritingErrorCode,
    message: string,
    retryable: boolean = true
  ) {
    super(message);
    this.name = 'WritingError';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * 类型守卫：检查是否为 WritingError
 */
export function isWritingError(error: unknown): error is WritingError {
  return error instanceof WritingError;
}

/**
 * 类型守卫：检查是否为可重试的错误
 */
export function isRetryableError(error: unknown): boolean {
  if (isWritingError(error)) {
    return error.retryable;
  }
  return false;
}
