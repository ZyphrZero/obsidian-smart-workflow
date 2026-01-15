/**
 * I18n 服务
 * 负责管理语言资源和提供翻译功能
 */

import { en } from './locales/en';
import { zhCN } from './locales/zh-CN';
import type { TranslationKeys, SupportedLocale } from './types';

class I18nService {
  private currentLocale: SupportedLocale = 'en';
  private resources: Record<SupportedLocale, TranslationKeys> = {
    'en': en,
    'zh-CN': zhCN
  };

  /**
   * 初始化 i18n 服务，检测当前语言
   */
  initialize(): void {
    this.currentLocale = this.detectLocale();
  }

  /**
   * 检测 Obsidian 当前语言设置
   * 从 localStorage 读取 'language' 键
   */
  private detectLocale(): SupportedLocale {
    const lang = window.localStorage.getItem('language');
    // zh, zh-CN, zh-TW 都使用中文
    if (lang && (lang === 'zh' || lang.startsWith('zh-'))) {
      return 'zh-CN';
    }
    return 'en';
  }

  /**
   * 获取翻译文本
   * @param key 翻译键（支持点号分隔的嵌套键，如 'settings.tabs.general'）
   * @param params 插值参数，用于替换模板中的 {{key}} 占位符
   * @returns 翻译后的文本，如果找不到则返回原始键名
   */
  t(key: string, params?: Record<string, string | number>): string {
    const value = this.getNestedValue(this.resources[this.currentLocale], key)
      ?? this.getNestedValue(this.resources['en'], key)
      ?? key;
    
    return params ? this.interpolate(value, params) : value;
  }

  /**
   * 获取嵌套对象的值
   * @param obj 要查找的对象
   * @param path 点号分隔的路径，如 'settings.tabs.general'
   */
  private getNestedValue(obj: unknown, path: string): string | undefined {
    const result = path.split('.').reduce<unknown>((current, key) => {
      if (current && typeof current === 'object' && key in current) {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
    
    return typeof result === 'string' ? result : undefined;
  }

  /**
   * 字符串插值
   * 将模板中的 {{key}} 占位符替换为对应的参数值
   * @param template 包含占位符的模板字符串
   * @param params 参数对象
   */
  private interpolate(template: string, params: Record<string, string | number>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => 
      params[key] !== undefined ? String(params[key]) : match
    );
  }

  /**
   * 设置当前语言
   * @param locale 要设置的语言
   */
  setLocale(locale: SupportedLocale): void {
    this.currentLocale = locale;
  }

  /**
   * 获取当前语言
   */
  getLocale(): SupportedLocale {
    return this.currentLocale;
  }
}

// 导出单例实例
export const i18n = new I18nService();

// 便捷函数，用于快速获取翻译
export const t = (key: string, params?: Record<string, string | number>): string => i18n.t(key, params);
