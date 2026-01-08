import type { App } from 'obsidian';

/**
 * 密钥服务错误码
 */
export enum SecretErrorCode {
  /** 密钥 ID 格式无效 */
  INVALID_SECRET_ID = 'INVALID_SECRET_ID',
  /** 共享密钥不存在 */
  SECRET_NOT_FOUND = 'SECRET_NOT_FOUND',
  /** 密钥值为空 */
  EMPTY_SECRET_VALUE = 'EMPTY_SECRET_VALUE',
}

/**
 * 密钥服务错误
 */
export class SecretServiceError extends Error {
  constructor(
    message: string,
    public code: SecretErrorCode,
    public cause?: Error
  ) {
    super(message);
    this.name = 'SecretServiceError';
  }
}

/**
 * 密钥服务接口
 * 封装 Obsidian SecretStorage API，提供统一的密钥管理接口
 */
export interface ISecretService {
  /**
   * 获取共享密钥
   * @param id 密钥 ID
   * @returns 密钥值，不存在返回 null
   */
  getSecret(id: string): string | null;

  /**
   * 设置共享密钥
   * @param id 密钥 ID (小写字母数字+连字符)
   * @param value 密钥值
   * @throws SecretServiceError 如果 ID 格式无效
   */
  setSecret(id: string, value: string): void;

  /**
   * 列出所有共享密钥 ID
   * @returns 密钥 ID 数组
   */
  listSecrets(): string[];

  /**
   * 验证密钥 ID 格式
   * @param id 待验证的 ID
   * @returns true 如果格式有效
   */
  validateSecretId(id: string): boolean;

  /**
   * 清除密钥缓存
   */
  clearCache(): void;
}

/**
 * 密钥 ID 验证正则表达式
 * 格式：小写字母数字 + 可选连字符，不能以连字符开头或结尾
 * 示例有效 ID: "openai-api-key", "mykey123", "api-key-v2"
 * 示例无效 ID: "-key", "key-", "Key", "key--name"
 */
const SECRET_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * 密钥服务实现
 * 封装 Obsidian SecretStorage API，提供缓存机制
 */
export class SecretService implements ISecretService {
  private app: App;
  private cache: Map<string, string | null> = new Map();

  constructor(app: App) {
    this.app = app;
  }

  /**
   * 验证密钥 ID 格式
   * 格式要求：小写字母数字 + 可选连字符，不能以连字符开头或结尾
   * @param id 待验证的 ID
   * @returns true 如果格式有效
   */
  validateSecretId(id: string): boolean {
    if (!id || typeof id !== 'string') {
      return false;
    }
    return SECRET_ID_PATTERN.test(id);
  }

  /**
   * 获取共享密钥
   * 优先从缓存获取，缓存未命中时从 SecretStorage 获取
   * @param id 密钥 ID
   * @returns 密钥值，不存在返回 null
   */
  getSecret(id: string): string | null {
    // 检查缓存
    if (this.cache.has(id)) {
      return this.cache.get(id) ?? null;
    }

    // 从 SecretStorage 获取
    const value = this.app.secretStorage.getSecret(id);
    
    // 更新缓存
    this.cache.set(id, value);
    
    return value;
  }

  /**
   * 设置共享密钥
   * @param id 密钥 ID (小写字母数字+连字符)
   * @param value 密钥值
   * @throws SecretServiceError 如果 ID 格式无效
   */
  setSecret(id: string, value: string): void {
    // 验证 ID 格式
    if (!this.validateSecretId(id)) {
      throw new SecretServiceError(
        `Invalid secret ID: "${id}". ID must be lowercase alphanumeric with optional dashes.`,
        SecretErrorCode.INVALID_SECRET_ID
      );
    }

    // 设置密钥
    this.app.secretStorage.setSecret(id, value);
    
    // 更新缓存
    this.cache.set(id, value);
  }

  /**
   * 列出所有共享密钥 ID
   * @returns 密钥 ID 数组
   */
  listSecrets(): string[] {
    return this.app.secretStorage.listSecrets();
  }

  /**
   * 清除密钥缓存
   * 在需要强制刷新缓存时调用
   */
  clearCache(): void {
    this.cache.clear();
  }
}
