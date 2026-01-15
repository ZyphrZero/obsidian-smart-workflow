/**
 * AI 通信层类型定义
 * 提供统一的 AI 请求/响应类型接口
 * 

 */

import type { Provider, ModelConfig, APIFormat, ReasoningEffort } from '../../settings/settings';
import type { ServerManager } from '../server/serverManager';

// ============================================================================
// AIClient 配置类型
// ============================================================================

/**
 * AIClient 配置选项
 * 用于初始化 AIClient 实例
 */
export interface AIClientOptions {
  /** AI 供应商配置 */
  provider: Provider;
  /** 模型配置 */
  model: ModelConfig;
  /** 请求超时时间（毫秒） */
  timeout?: number;
  /** 是否启用调试模式 */
  debugMode?: boolean;
  /** ServerManager 实例（用于流式请求，非流式请求可选） */
  serverManager?: ServerManager;
}

/**
 * AI 请求选项
 * 用于发起 AI 请求
 */
export interface AIRequestOptions {
  /** 用户提示内容（如果是单次交互） */
  prompt?: string;
  /** 完整的消息历史（如果是对话模式） - 优先于 prompt */
  messages?: Array<{ role: string; content: string }>;
  /** 系统提示（可选） */
  systemPrompt?: string;
  /** 是否使用流式响应 */
  stream?: boolean;
}

// ============================================================================
// 响应类型
// ============================================================================

/**
 * AI 响应接口
 * 统一的 AI 响应数据结构
 */
export interface AIResponse {
  /** 响应内容 */
  content: string;
  /** 推理摘要（仅 Responses API） */
  reasoningSummary?: string;
  /** 使用量统计 */
  usage?: {
    /** 输入 token 数 */
    inputTokens: number;
    /** 输出 token 数 */
    outputTokens: number;
    /** 推理 token 数（仅 Responses API） */
    reasoningTokens?: number;
  };
}

/**
 * 解析后的响应接口
 * ResponseParser 的输出类型
 */
export interface ParsedResponse {
  /** 响应内容 */
  content: string;
  /** 推理摘要（仅 Responses API） */
  reasoningSummary?: string;
  /** 使用量统计 */
  usage?: {
    /** 输入 token 数 */
    inputTokens: number;
    /** 输出 token 数 */
    outputTokens: number;
    /** 推理 token 数（仅 Responses API） */
    reasoningTokens?: number;
  };
}

// ============================================================================
// 流式回调类型
// ============================================================================

/**
 * 流式回调接口
 * 用于处理流式 AI 响应
 */
export interface StreamCallbacks {
  /** 流开始时调用 */
  onStart?: () => void;
  /** 收到新内容块时调用 */
  onChunk: (chunk: string) => void;
  /** 收到思考内容时调用（可选） */
  onThinking?: (chunk: string) => void;
  /** 流完成时调用 */
  onComplete: (response: AIResponse) => void;
  /** 发生错误时调用 */
  onError: (error: Error) => void;
}

// ============================================================================
// Chat Completions API 类型
// ============================================================================

/**
 * Chat Completions API 请求体接口
 * 用于传统的 /v1/chat/completions 端点
 */
export interface ChatCompletionsRequest {
  /** 模型名称 */
  model: string;
  /** 消息数组 */
  messages: Array<{
    /** 角色：system, user, assistant */
    role: string;
    /** 消息内容 */
    content: string;
  }>;
  /** 温度参数 (0-2) */
  temperature?: number;
  /** 最大 token 数 */
  max_tokens?: number;
  /** Top P 参数 (0-1) */
  top_p?: number;
  /** 是否流式响应 */
  stream?: boolean;
}

/**
 * Chat Completions API 响应接口
 */
export interface ChatCompletionsResponse {
  /** 响应 ID */
  id?: string;
  /** 对象类型 */
  object?: string;
  /** 创建时间戳 */
  created?: number;
  /** 使用的模型名称 */
  model?: string;
  /** 选择数组 */
  choices?: Array<{
    /** 选择索引 */
    index?: number;
    /** 消息内容 */
    message?: {
      /** 角色 */
      role?: string;
      /** 内容 */
      content?: string;
    };
    /** 完成原因 */
    finish_reason?: string;
  }>;
  /** 使用量统计 */
  usage?: {
    /** 提示 token 数 */
    prompt_tokens?: number;
    /** 完成 token 数 */
    completion_tokens?: number;
    /** 总 token 数 */
    total_tokens?: number;
  };
  /** 错误信息 */
  error?: {
    /** 错误消息 */
    message?: string;
    /** 错误类型 */
    type?: string;
    /** 错误代码 */
    code?: string;
  };
}

// ============================================================================
// Responses API 类型
// ============================================================================

/**
 * Responses API 请求体接口
 * 用于新的 /v1/responses 端点，专为推理模型设计
 */
export interface ResponsesAPIRequest {
  /** 模型名称 */
  model: string;
  /** 输入内容（字符串或消息数组） */
  input: string | Array<{
    /** 类型 */
    type: string;
    /** 角色（可选） */
    role?: string;
    /** 内容（可选） */
    content?: string;
  }>;
  /** 推理配置 */
  reasoning?: {
    /** 推理深度 */
    effort: ReasoningEffort;
  };
  /** 最大输出 token 数 */
  max_output_tokens?: number;
  /** 是否流式响应 */
  stream?: boolean;
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
    /** 内容类型 */
    type: string;
    /** 文本内容 */
    text?: string;
  }>;
  /** 推理摘要（reasoning 类型） */
  summary?: Array<{
    /** 摘要类型 */
    type: string;
    /** 摘要文本 */
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
    /** 输入 token 数 */
    input_tokens: number;
    /** 输出 token 数 */
    output_tokens: number;
    /** 推理 token 数 */
    reasoning_tokens?: number;
  };
  /** 错误信息 */
  error?: {
    /** 错误消息 */
    message?: string;
    /** 错误类型 */
    type?: string;
    /** 错误代码 */
    code?: string;
  };
}

// ============================================================================
// 思考处理类型
// ============================================================================

/**
 * 思考标签模式
 */
export interface ThinkingPattern {
  /** 开始标签 */
  start: string;
  /** 结束标签 */
  end: string;
}

/**
 * 思考处理结果
 */
export interface ThinkingProcessResult {
  /** 思考内容 */
  thinking: string;
  /** 实际内容 */
  content: string;
}

// ============================================================================
// 请求构建器类型
// ============================================================================

/**
 * 请求构建器选项
 */
export interface RequestBuilderOptions {
  /** 模型配置 */
  model: ModelConfig;
  /** 用户提示内容 */
  prompt?: string;
  /** 完整的消息历史 */
  messages?: Array<{ role: string; content: string }>;
  /** 系统提示（可选） */
  systemPrompt?: string;
  /** 是否流式响应 */
  stream?: boolean;
}

// ============================================================================
// 重新导出设置类型
// ============================================================================

export type { Provider, ModelConfig, APIFormat, ReasoningEffort };
