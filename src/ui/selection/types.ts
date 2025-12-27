/**
 * Selection Toolbar Types
 * 选中文字浮动工具栏类型定义
 */

// 从 settings.ts 导入设置类型
export type { SelectionToolbarSettings } from '../../settings/settings';
export { DEFAULT_SELECTION_TOOLBAR_SETTINGS } from '../../settings/settings';

/**
 * 选中文字的上下文信息
 * Requirements: 1.1, 1.2
 */
export interface SelectionContext {
  /** 选中的文本内容 */
  text: string;
  /** 选区的边界矩形 */
  rect: DOMRect;
  /** 选区所在的视图类型 */
  viewType: 'editing' | 'source' | 'reading';
  /** 原始 Selection 对象 */
  selection: Selection;
  /** 原始 Range 对象 */
  range: Range;
}

/**
 * 工具栏位置信息
 * Requirements: 2.1
 */
export interface ToolbarPosition {
  /** 顶部位置 (px) */
  top: number;
  /** 左侧位置 (px) */
  left: number;
  /** 工具栏显示在选区上方还是下方 */
  placement: 'above' | 'below';
}

/**
 * 工具栏动作按钮
 * Requirements: 3.1-3.4
 */
export interface ToolbarAction {
  /** 动作唯一标识 */
  id: string;
  /** 显示图标 (Obsidian icon name) */
  icon: string;
  /** 提示文字 (i18n key) */
  tooltipKey: string;
  /** 执行函数，返回新的选中文本（可选） */
  execute: (context: SelectionContext) => Promise<string | void>;
  /** 检查是否禁用（可选） */
  isDisabled?: (context: SelectionContext) => boolean;
}

/**
 * 工具栏尺寸
 */
export interface ToolbarSize {
  width: number;
  height: number;
}

/**
 * 视口尺寸
 */
export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * 工具栏动作 ID 枚举
 */
export type ToolbarActionId = 'copy' | 'search' | 'createLink' | 'highlight';

/**
 * 位置计算常量
 */
export const POSITION_CONSTANTS = {
  /** 最小边距 (px) */
  MIN_EDGE_MARGIN: 8,
  /** 工具栏与选区的间距 (px) */
  TOOLBAR_GAP: 8,
  /** 默认视口宽度 */
  DEFAULT_VIEWPORT_WIDTH: 1920,
  /** 默认视口高度 */
  DEFAULT_VIEWPORT_HEIGHT: 1080,
} as const;

/**
 * 动画时长常量
 */
export const ANIMATION_CONSTANTS = {
  /** 淡入动画时长 (ms) */
  FADE_IN_DURATION: 150,
  /** 淡出动画时长 (ms) */
  FADE_OUT_DURATION: 100,
  /** 选择检测延迟 (ms) */
  SELECTION_DETECT_DELAY: 100,
  /** 隐藏延迟 (ms) */
  HIDE_DELAY: 50,
} as const;
