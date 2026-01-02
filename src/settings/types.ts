/**
 * 设置模块类型定义
 * 提供设置标签页、渲染器和共享组件的类型接口
 */

import type { App } from 'obsidian';
import type SmartWorkflowPlugin from '../main';
import type { ConfigManager } from '../services/config/configManager';

// ============================================================================
// 语言相关类型定义
// ============================================================================

/**
 * 支持的语言代码类型 (ISO 639-1)
 * - auto: 自动检测
 * - zh-CN: 简体中文
 * - zh-TW: 繁体中文
 * - en: 英语
 * - ja: 日语
 * - ko: 韩语
 * - fr: 法语
 * - de: 德语
 * - es: 西班牙语
 * - ru: 俄语
 */
export type LanguageCode = 'auto' | 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'ru';

/**
 * 语言信息接口
 */
export interface LanguageInfo {
  /** 英文名称 */
  name: string;
  /** 中文名称 */
  nameZh: string;
}

/**
 * 支持的语言列表
 */
export const SUPPORTED_LANGUAGES: Record<LanguageCode, LanguageInfo> = {
  'auto': { name: 'Auto-detect', nameZh: '自动检测' },
  'zh-CN': { name: 'Simplified Chinese', nameZh: '简体中文' },
  'zh-TW': { name: 'Traditional Chinese', nameZh: '繁体中文' },
  'en': { name: 'English', nameZh: '英语' },
  'ja': { name: 'Japanese', nameZh: '日语' },
  'ko': { name: 'Korean', nameZh: '韩语' },
  'fr': { name: 'French', nameZh: '法语' },
  'de': { name: 'German', nameZh: '德语' },
  'es': { name: 'Spanish', nameZh: '西班牙语' },
  'ru': { name: 'Russian', nameZh: '俄语' },
} as const;

/**
 * 语言检测结果接口
 */
export interface DetectionResult {
  /** 检测到的语言代码 (ISO 639-1) */
  language: LanguageCode;
  /** 置信度 (0-1) */
  confidence: number;
  /** 检测方法 */
  method: 'rust' | 'llm';
}

/**
 * 语言检测器选项接口
 */
export interface LanguageDetectorOptions {
  /** 是否启用 LLM 检测 */
  enableLLMDetection: boolean;
  /** LLM 检测的置信度阈值 */
  llmConfidenceThreshold: number;
}

/**
 * 设置标签页定义
 * 用于定义设置界面的导航标签
 */
export interface SettingTab {
  /** 标签页唯一标识符 */
  id: string;
  /** 标签页显示名称 */
  name: string;
  /** 标签页图标名称（Obsidian 图标） */
  icon: string;
}

/**
 * 渲染器上下文接口
 * 传递给各设置渲染器的共享依赖和状态
 */
export interface RendererContext {
  /** Obsidian App 实例 */
  app: App;
  /** 插件实例 */
  plugin: SmartWorkflowPlugin;
  /** 配置管理器实例 */
  configManager: ConfigManager;
  /** 设置内容容器元素 */
  containerEl: HTMLElement;
  /** 当前展开的区块集合 */
  expandedSections: Set<string>;
  /** 刷新显示的回调函数 */
  refreshDisplay: () => void;
}

/**
 * 设置渲染器接口
 * 所有设置渲染器必须实现此接口
 */
export interface ISettingsRenderer {
  /**
   * 渲染设置内容
   * @param context 渲染器上下文
   */
  render(context: RendererContext): void;
}
