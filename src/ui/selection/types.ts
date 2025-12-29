/**
 * Selection Toolbar Types
 * 选中文字浮动工具栏类型定义
 */

// 从 settings.ts 导入设置类型
export type { SelectionToolbarSettings, ToolbarButtonConfig } from '../../settings/settings';
export { DEFAULT_SELECTION_TOOLBAR_SETTINGS, DEFAULT_TOOLBAR_BUTTON_CONFIGS } from '../../settings/settings';

/**
 * 选中文字的上下文信息

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
  /** 执行后是否隐藏工具栏（默认 false） */
  hideAfterExecute?: boolean;
  /** 是否显示文字标签（默认 true） */
  showLabel?: boolean;
}

/**
 * 带子菜单的工具栏动作

 */
export interface SubmenuAction extends Omit<ToolbarAction, 'execute'> {
  /** 子菜单项列表 */
  submenu: ToolbarAction[];
  /** 子菜单动作不需要 execute，由子项处理 */
  execute?: never;
  /** 是否显示文字标签（默认 true） */
  showLabel?: boolean;
}

/**
 * 工具栏动作类型（普通动作或子菜单动作）
 */
export type ToolbarActionItem = ToolbarAction | SubmenuAction;

/**
 * 类型守卫：检查是否为子菜单动作
 */
export function isSubmenuAction(action: ToolbarActionItem): action is SubmenuAction {
  return 'submenu' in action && Array.isArray((action as SubmenuAction).submenu);
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
