/**
 * PositionManager - 工具栏位置计算模块
 * 负责计算工具栏的显示位置，处理边界情况

 */

import { ToolbarPosition, ToolbarSize, ViewportSize, POSITION_CONSTANTS } from './types';

/**
 * 位置管理器
 * 计算工具栏相对于选区的最佳显示位置
 */
export class PositionManager {
  private readonly minEdgeMargin: number;
  private readonly toolbarGap: number;

  constructor() {
    this.minEdgeMargin = POSITION_CONSTANTS.MIN_EDGE_MARGIN;
    this.toolbarGap = POSITION_CONSTANTS.TOOLBAR_GAP;
  }

  /**
   * 计算工具栏位置
   * @param selectionRect 选区边界矩形
   * @param toolbarSize 工具栏尺寸
   * @param viewport 视口尺寸（可选，默认使用 window）
   * @returns 计算后的位置
   * 
   * Requirements:
   * - 2.1: 工具栏默认显示在选区上方，水平居中
   * - 2.2: 如果上方空间不足，显示在下方
   * - 2.3: 如果左右超出边界，调整水平位置
   * - 2.6: 保持最小 8px 边距
   */
  calculatePosition(
    selectionRect: DOMRect,
    toolbarSize: ToolbarSize,
    viewport?: ViewportSize
  ): ToolbarPosition {
    // 获取视口尺寸
    const viewportSize = viewport || this.getViewportSize();
    
    // 处理无效输入
    if (this.isInvalidRect(selectionRect) || this.isInvalidSize(toolbarSize)) {
      return this.getFallbackPosition(viewportSize, toolbarSize);
    }

    // 检测是否为全选情况（选区高度超过视口高度的 80%）
    const isFullSelection = selectionRect.height > viewportSize.height * 0.8;
    
    if (isFullSelection) {
      // 全选时，工具栏显示在视口顶部居中
      return this.getFullSelectionPosition(viewportSize, toolbarSize);
    }

    // 计算水平位置（居中对齐选区）
    const left = this.calculateHorizontalPosition(selectionRect, toolbarSize, viewportSize);
    
    // 计算垂直位置和放置方向
    const { top, placement } = this.calculateVerticalPosition(
      selectionRect,
      toolbarSize,
      viewportSize
    );

    return { top, left, placement };
  }

  /**
   * 获取全选时的位置（视口顶部居中）
   */
  private getFullSelectionPosition(viewport: ViewportSize, toolbarSize: ToolbarSize): ToolbarPosition {
    const left = Math.max(
      this.minEdgeMargin,
      (viewport.width - toolbarSize.width) / 2
    );
    
    // 显示在视口顶部，留出一定边距
    const top = this.minEdgeMargin + 50; // 50px 距离顶部，避免遮挡标题栏
    
    return {
      top,
      left,
      placement: 'above',
    };
  }

  /**
   * 计算水平位置
   * 默认居中对齐选区，超出边界时调整
   */
  private calculateHorizontalPosition(
    selectionRect: DOMRect,
    toolbarSize: ToolbarSize,
    viewport: ViewportSize
  ): number {
    // 计算选区中心点
    const selectionCenterX = selectionRect.left + selectionRect.width / 2;
    
    // 工具栏居中对齐选区
    let left = selectionCenterX - toolbarSize.width / 2;
    
    // 左边界调整
    const minLeft = this.minEdgeMargin;
    if (left < minLeft) {
      left = minLeft;
    }
    
    // 右边界调整
    const maxLeft = viewport.width - toolbarSize.width - this.minEdgeMargin;
    if (left > maxLeft) {
      left = Math.max(minLeft, maxLeft);
    }
    
    return left;
  }

  /**
   * 计算垂直位置和放置方向
   * 优先显示在上方，空间不足时显示在下方
   */
  private calculateVerticalPosition(
    selectionRect: DOMRect,
    toolbarSize: ToolbarSize,
    viewport: ViewportSize
  ): { top: number; placement: 'above' | 'below' } {
    // 计算上方所需空间
    const spaceAbove = selectionRect.top;
    const requiredSpaceAbove = toolbarSize.height + this.toolbarGap + this.minEdgeMargin;
    
    // 判断是否有足够的上方空间
    const canPlaceAbove = spaceAbove >= requiredSpaceAbove;
    
    let top: number;
    let placement: 'above' | 'below';
    
    if (canPlaceAbove) {
      // 显示在选区上方
      top = selectionRect.top - toolbarSize.height - this.toolbarGap;
      placement = 'above';
    } else {
      // 显示在选区下方
      top = selectionRect.bottom + this.toolbarGap;
      placement = 'below';
    }
    
    // 确保不超出顶部边界
    if (top < this.minEdgeMargin) {
      top = this.minEdgeMargin;
    }
    
    // 确保不超出底部边界
    const maxTop = viewport.height - toolbarSize.height - this.minEdgeMargin;
    if (top > maxTop) {
      top = Math.max(this.minEdgeMargin, maxTop);
    }
    
    return { top, placement };
  }

  /**
   * 获取视口尺寸
   */
  private getViewportSize(): ViewportSize {
    if (typeof window !== 'undefined') {
      return {
        width: window.innerWidth,
        height: window.innerHeight,
      };
    }
    // 回退到默认值
    return {
      width: POSITION_CONSTANTS.DEFAULT_VIEWPORT_WIDTH,
      height: POSITION_CONSTANTS.DEFAULT_VIEWPORT_HEIGHT,
    };
  }

  /**
   * 检查矩形是否无效
   */
  private isInvalidRect(rect: DOMRect): boolean {
    return !rect || rect.width === 0 || rect.height === 0;
  }

  /**
   * 检查尺寸是否无效
   */
  private isInvalidSize(size: ToolbarSize): boolean {
    return !size || size.width <= 0 || size.height <= 0;
  }

  /**
   * 获取回退位置（视口中央）
   */
  private getFallbackPosition(viewport: ViewportSize, toolbarSize: ToolbarSize): ToolbarPosition {
    const width = toolbarSize.width > 0 ? toolbarSize.width : 100;
    const height = toolbarSize.height > 0 ? toolbarSize.height : 40;
    
    return {
      top: Math.max(this.minEdgeMargin, (viewport.height - height) / 2),
      left: Math.max(this.minEdgeMargin, (viewport.width - width) / 2),
      placement: 'above',
    };
  }
}
