/**
 * AI 通信层导出入口
 * 统一导出所有公共类和类型
 * 

 */

// ============================================================================
// 主要类导出
// ============================================================================

export { AIClient } from './aiClient';
export { RequestBuilder } from './requestBuilder';
export { ResponseParser, type ResponseFormat } from './responseParser';
export { StreamHandler } from './streamHandler';
export { ThinkingProcessor, THINKING_PATTERNS } from './thinkingProcessor';
export { EndpointNormalizer } from './endpointNormalizer';
export { ConnectionTester, type ConnectionTesterOptions, type ConnectionTestResult } from './connectionTester';
export { ModelFetcher, type ModelFetcherOptions, type RemoteModelInfo } from './modelFetcher';

// ============================================================================
// 错误类型导出
// ============================================================================

export {
  // 错误代码枚举
  AIErrorCode,
  // 错误基类
  AIError,
  // 特定错误类型
  UnsupportedAPIFormatError,
  InvalidReasoningEffortError,
  NetworkError,
  TimeoutError,
  StreamInterruptedError,
  ResponsesAPIError,
  InvalidResponseError,
  // 类型守卫函数
  isAIError,
  isUnsupportedAPIFormatError,
  isInvalidReasoningEffortError,
  isNetworkError,
  isTimeoutError,
  isStreamInterruptedError,
  isResponsesAPIError,
  isInvalidResponseError,
  isRetryableError,
  hasErrorCode,
} from './errors';

// ============================================================================
// 类型导出
// ============================================================================

export type {
  // AIClient 配置类型
  AIClientOptions,
  AIRequestOptions,
  AIResponse,
  StreamCallbacks,
  ParsedResponse,
  // 请求/响应类型
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  ResponsesAPIRequest,
  ResponsesAPIResponse,
  ResponsesOutputItem,
  // 请求构建器类型
  RequestBuilderOptions,
  // 流式处理器类型
  StreamHandlerOptions,
  // 思考处理类型
  ThinkingPattern,
  ThinkingProcessResult,
  // 设置类型（重新导出）
  Provider,
  ModelConfig,
  APIFormat,
  ReasoningEffort,
} from './types';
