/**
 * 设置工具函数模块
 * 提供设置界面使用的通用工具函数和状态管理
 */

import { existsSync } from 'fs';
import { t } from '../../i18n';
import type { SettingTab } from '../types';

/**
 * 供应商模型列表展开状态缓存
 * key: 供应商 ID
 * value: 是否展开（默认展开）
 */
export const providerExpandedStatus: Map<string, boolean> = new Map();

/**
 * 验证 Shell 路径是否有效
 * @param path Shell 可执行文件路径
 * @returns 路径是否存在且有效
 */
export function validateShellPath(path: string): boolean {
  if (!path || path.trim() === '') return false;
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/**
 * 获取设置标签页定义
 * 使用函数返回以确保 i18n 已初始化
 * @returns 设置标签页数组
 */
export function getSettingTabs(): SettingTab[] {
  return [
    { id: 'general', name: t('settings.tabs.general'), icon: 'settings' },
    { id: 'naming', name: t('settings.tabs.naming'), icon: 'tag' },
    { id: 'terminal', name: t('settings.tabs.terminal'), icon: 'terminal' },
    { id: 'advanced', name: t('settings.tabs.advanced'), icon: 'sliders-horizontal' }
  ];
}

/**
 * 标准化 API 端点 URL
 * 自动补全协议和路径
 * @param url 原始 URL
 * @returns 包含标准化 URL 的对象
 */
export function normalizeEndpoint(url: string): { url: string } {
  let normalized = url.trim();

  if (!normalized) {
    return { url: '' };
  }

  // 检查协议
  if (!normalized.match(/^https?:\/\//i)) {
    if (normalized.startsWith('//')) {
      normalized = 'https:' + normalized;
    } else if (!normalized.includes('://')) {
      normalized = 'https://' + normalized;
    }
  }

  // 移除末尾多余的斜杠
  normalized = normalized.replace(/\/+$/, '');

  // 检查是否包含完整路径
  const commonPaths = [
    '/v1/chat/completions',
    '/chat/completions',
    '/v1/completions',
    '/completions'
  ];

  const hasPath = commonPaths.some(path => normalized.includes(path));

  if (!hasPath) {
    // 尝试检测基础 URL 并自动补全
    const urlObj = tryParseUrl(normalized);
    if (urlObj) {
      const pathname = urlObj.pathname;

      // 如果路径以 /v1 结尾，自动补全为 /v1/chat/completions
      if (pathname === '/v1' || pathname === '/v1/') {
        normalized = normalized + '/chat/completions';
      }
      // 如果只有根路径或空路径，补全为 /v1/chat/completions
      else if (!pathname || pathname === '/') {
        normalized = normalized + '/v1/chat/completions';
      }
      // 如果路径以 /chat 结尾，补全为 /chat/completions
      else if (pathname === '/chat' || pathname === '/chat/') {
        normalized = normalized + '/completions';
      }
    }
  }

  // 修正双斜杠
  if (normalized.includes('//v1')) {
    normalized = normalized.replace('//v1', '/v1');
  }

  return { url: normalized };
}

/**
 * 缩短端点 URL 显示
 * 仅显示主机名，便于 UI 展示
 * @param endpoint 完整端点 URL
 * @returns 缩短后的显示文本
 */
export function shortenEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    // 只显示主机名
    return url.hostname;
  } catch {
    // 如果解析失败，截取前30个字符
    return endpoint.length > 30 ? endpoint.substring(0, 30) + '...' : endpoint;
  }
}

/**
 * 格式化上下文长度显示
 * 将 token 数量转换为人类可读格式
 * @param length 上下文长度（tokens）
 * @returns 格式化后的字符串（如 "4K", "1M"）
 */
export function formatContextLength(length: number): string {
  if (length >= 1000000) {
    return `${(length / 1000000).toFixed(0)}M`;
  } else if (length >= 1000) {
    return `${(length / 1000).toFixed(0)}K`;
  }
  return String(length);
}

/**
 * 尝试解析 URL
 * 安全地解析 URL 字符串，失败时返回 null
 * @param urlString URL 字符串
 * @returns URL 对象或 null
 */
export function tryParseUrl(urlString: string): URL | null {
  try {
    return new URL(urlString);
  } catch {
    return null;
  }
}
