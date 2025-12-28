/**
 * 基础设置渲染器
 * 提供所有设置渲染器的共享基类和工具方法
 */

import type { RendererContext, ISettingsRenderer } from '../types';
import { createSettingCard, createCollapsibleSection } from '../components';

/**
 * 基础设置渲染器抽象类
 * 所有具体的设置渲染器都应继承此类
 */
export abstract class BaseSettingsRenderer implements ISettingsRenderer {
  protected context!: RendererContext;

  /**
   * 渲染设置内容
   * 子类必须实现此方法
   * @param context 渲染器上下文
   */
  abstract render(context: RendererContext): void;

  /**
   * 创建设置卡片容器
   * @returns 卡片容器元素
   */
  protected createCard(): HTMLElement {
    return createSettingCard(this.context.containerEl);
  }

  /**
   * 创建可折叠的设置区块
   * @param containerEl 父容器元素
   * @param sectionId 区块唯一标识
   * @param title 区块标题
   * @param description 区块描述
   * @param renderContent 渲染内容的回调函数
   */
  protected createCollapsibleSection(
    containerEl: HTMLElement,
    sectionId: string,
    title: string,
    description: string,
    renderContent: (contentEl: HTMLElement) => void
  ): void {
    createCollapsibleSection(
      containerEl,
      sectionId,
      title,
      description,
      this.context.expandedSections,
      renderContent,
      () => this.context.refreshDisplay()
    );
  }

  /**
   * 刷新设置显示
   */
  protected refreshDisplay(): void {
    this.context.refreshDisplay();
  }

  /**
   * 保存设置
   */
  protected async saveSettings(): Promise<void> {
    await this.context.plugin.saveSettings();
  }
}
