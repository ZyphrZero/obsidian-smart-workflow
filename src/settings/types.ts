/**
 * 设置模块类型定义
 * 提供设置标签页、渲染器和共享组件的类型接口
 */

import type { App } from 'obsidian';
import type SmartWorkflowPlugin from '../main';
import type { ConfigManager } from '../services/config/configManager';

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
