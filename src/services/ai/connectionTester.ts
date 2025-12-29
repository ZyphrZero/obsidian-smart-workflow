/**
 * 连接测试器
 * 负责测试 AI 供应商的连接状态
 * 
 * 职责：
 * - 发送极简请求验证连接
 * - 验证 API Key 有效性
 * - 验证端点可达性
 */

import { Provider, ModelConfig } from '../../settings/settings';
import { AIClient } from './aiClient';
import { isAIError, AIError } from './errors';
import { debugLog } from '../../utils/logger';
import { t } from '../../i18n';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 连接测试器选项
 */
export interface ConnectionTesterOptions {
  /** 请求超时时间（毫秒） */
  timeout?: number;
  /** 是否启用调试模式 */
  debugMode?: boolean;
}

/**
 * 连接测试结果
 */
export interface ConnectionTestResult {
  /** 是否连接成功 */
  success: boolean;
  /** 错误信息（如果失败） */
  error?: string;
}

// ============================================================================
// ConnectionTester 类
// ============================================================================

/**
 * 连接测试器
 * 测试 AI 供应商的连接状态
 */
export class ConnectionTester {
  private timeout: number;
  private debugMode: boolean;

  constructor(options: ConnectionTesterOptions = {}) {
    this.timeout = options.timeout || 15000;
    this.debugMode = options.debugMode || false;
  }

  /**
   * 测试供应商连接
   * 使用 AIClient 发送极简请求验证连接
   * @param provider 供应商配置
   * @param model 模型配置
   * @returns 是否连接成功
   */
  async testConnection(provider: Provider, model: ModelConfig): Promise<boolean> {
    if (this.debugMode) {
      debugLog('[ConnectionTester] 测试连接:', { provider: provider.name, model: model.name });
    }

    try {
      // 创建临时模型配置，强制使用 chat-completions 格式和极小的 maxTokens
      const testModel: ModelConfig = {
        ...model,
        apiFormat: 'chat-completions',
        maxTokens: 5,
      };

      // 使用 AIClient 发送极简请求
      const aiClient = new AIClient({
        provider,
        model: testModel,
        timeout: this.timeout,
        debugMode: this.debugMode,
      });

      await aiClient.request({ prompt: 'Hi' });

      if (this.debugMode) {
        debugLog('[ConnectionTester] 测试连接成功');
      }
      return true;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * 测试供应商连接（返回详细结果）
   * @param provider 供应商配置
   * @param model 模型配置
   * @returns 连接测试结果
   */
  async testConnectionWithResult(provider: Provider, model: ModelConfig): Promise<ConnectionTestResult> {
    try {
      await this.testConnection(provider, model);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 处理错误
   */
  private handleError(error: unknown): Error {
    // 转换错误信息为用户友好的格式
    if (isAIError(error)) {
      const aiError = error as AIError;
      let errorMessage = aiError.message;
      
      if (aiError.code === 'INVALID_API_KEY') {
        errorMessage = t('aiService.testApiKeyInvalid');
      } else if (aiError.code === 'INVALID_ENDPOINT') {
        errorMessage = t('aiService.testEndpointNotFound');
      }
      
      return new Error(errorMessage);
    }
    
    if (error instanceof Error) {
      return error;
    }
    return new Error(t('aiService.networkError', { message: String(error) }));
  }
}
