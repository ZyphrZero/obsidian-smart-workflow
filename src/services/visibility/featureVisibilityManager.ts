/**
 * 功能可见性管理器
 * 集中管理所有功能模块的 UI 可见性
 */

import type { Plugin } from 'obsidian';
import { errorLog } from '@/utils/logger';
import type {
  FeatureId,
  VisibilityConfig,
  FeatureRegistrationConfig,
  FeatureRegistration,
} from './types';

/**
 * 功能可见性管理器
 * 集中管理所有功能模块的 UI 可见性
 */
export class FeatureVisibilityManager {
  private _plugin: Plugin;
  private _registeredFeatures: Map<FeatureId, FeatureRegistration>;
  private _ribbonIcons: Map<FeatureId, HTMLElement>;

  constructor(plugin: Plugin) {
    this._plugin = plugin;
    this._registeredFeatures = new Map();
    this._ribbonIcons = new Map();
  }

  /**
   * 注册功能模块
   * @param config 功能注册配置
   */
  registerFeature(config: FeatureRegistrationConfig): void {
    try {
      this._registeredFeatures.set(config.id, {
        config,
        ribbonRegistered: false,
      });

      // 初始化 Ribbon 图标
      this.updateRibbonVisibility(config.id);
    } catch (error) {
      errorLog(`[FeatureVisibility] Failed to register feature ${config.id}:`, error);
    }
  }

  /**
   * 更新指定功能的可见性
   * 主要用于 Ribbon 图标的动态添加/移除
   * 命令和菜单通过 checkCallback 和事件回调实时检查
   * @param featureId 功能标识符
   */
  updateVisibility(featureId: FeatureId): void {
    const registration = this._registeredFeatures.get(featureId);
    if (!registration) return;

    try {
      // 更新 Ribbon 图标
      this.updateRibbonVisibility(featureId);

      // 调用自定义回调
      const visibility = registration.config.getVisibility();
      registration.config.onVisibilityChange?.(visibility);
    } catch (error) {
      errorLog(`[FeatureVisibility] Failed to update visibility for ${featureId}:`, error);
      // 保持之前的状态，不抛出异常
    }
  }

  /**
   * 更新所有已注册功能的可见性
   */
  updateAllVisibility(): void {
    for (const featureId of this._registeredFeatures.keys()) {
      this.updateVisibility(featureId);
    }
  }

  /**
   * 获取功能的当前可见性配置
   * @param featureId 功能标识符
   */
  getVisibility(featureId: FeatureId): VisibilityConfig | undefined {
    const registration = this._registeredFeatures.get(featureId);
    return registration?.config.getVisibility();
  }

  /**
   * 检查功能是否启用
   * @param featureId 功能标识符
   */
  isFeatureEnabled(featureId: FeatureId): boolean {
    const visibility = this.getVisibility(featureId);
    return visibility?.enabled ?? false;
  }

  /**
   * 检查功能在指定 UI 位置是否可见
   * 用于命令的 checkCallback 和菜单事件回调
   * @param featureId 功能标识符
   * @param position UI 位置
   */
  isVisibleAt(featureId: FeatureId, position: keyof VisibilityConfig): boolean {
    const visibility = this.getVisibility(featureId);
    if (!visibility) return false;

    // 功能未启用时，所有位置都不可见
    if (!visibility.enabled) return false;

    return visibility[position] === true;
  }

  /**
   * 更新 Ribbon 图标可见性
   * @param featureId 功能标识符
   */
  private updateRibbonVisibility(featureId: FeatureId): void {
    const registration = this._registeredFeatures.get(featureId);
    if (!registration?.config.ribbon) return;

    try {
      const visibility = registration.config.getVisibility();
      const shouldShow = visibility.enabled && visibility.showInRibbon;
      const currentIcon = this._ribbonIcons.get(featureId);

      if (shouldShow && !currentIcon) {
        // 添加图标
        const { icon, tooltip, callback } = registration.config.ribbon;
        const ribbonIcon = this._plugin.addRibbonIcon(icon, tooltip, callback);
        this._ribbonIcons.set(featureId, ribbonIcon);
        registration.ribbonRegistered = true;
      } else if (!shouldShow && currentIcon) {
        // 移除图标
        currentIcon.remove();
        this._ribbonIcons.delete(featureId);
        registration.ribbonRegistered = false;
      }
    } catch (error) {
      errorLog(`[FeatureVisibility] Failed to update ribbon for ${featureId}:`, error);
      // 保持之前的状态，不抛出异常
    }
  }

  /**
   * 销毁管理器，清理所有资源
   */
  destroy(): void {
    try {
      // 移除所有 Ribbon 图标
      for (const icon of this._ribbonIcons.values()) {
        icon.remove();
      }
      this._ribbonIcons.clear();
      this._registeredFeatures.clear();
    } catch (error) {
      errorLog('[FeatureVisibility] Failed to destroy manager:', error);
    }
  }
}
