/**
 * Obsidian API 类型扩展
 * 为 Obsidian 1.11.4 新增的 SecretStorage API 添加类型定义
 */

import 'obsidian';

declare module 'obsidian' {
  /**
   * SecretStorage 类
   * Obsidian 1.11.4 新增的密钥存储类
   */
  interface SecretStorage {
    /**
     * 获取密钥
     * @param id 密钥 ID
     * @returns 密钥值，不存在返回 null
     */
    getSecret(id: string): string | null;

    /**
     * 设置密钥
     * @param id 密钥 ID (小写字母数字+连字符)
     * @param secret 密钥值
     * @throws Error 如果 ID 格式无效
     */
    setSecret(id: string, secret: string): void;

    /**
     * 列出所有密钥 ID
     * @returns 密钥 ID 数组
     */
    listSecrets(): string[];
  }

  interface App {
    /**
     * 密钥存储
     * Obsidian 1.11.4 新增
     */
    secretStorage: SecretStorage;
  }
}
