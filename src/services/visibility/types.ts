/**
 * 功能可见性系统类型定义
 * 提供统一的可见性配置接口
 */

// ============================================================================
// 功能标识符类型
// ============================================================================

/**
 * 功能模块标识符
 * 使用字符串字面量类型确保类型安全
 */
export type FeatureId =
  | 'aiNaming' // AI 文件命名
  | 'terminal' // 集成终端
  | 'voice' // 语音输入
  | 'tagging' // 标签生成
  | 'archiving' // 智能归档
  | 'autoArchive' // 自动归档
  | 'writing' // 写作助手
  | 'translation'; // 翻译功能

// ============================================================================
// 可见性配置接口
// ============================================================================

/**
 * 功能可见性配置接口
 * 定义功能在各 UI 位置的显示状态
 */
export interface VisibilityConfig {
  /** 功能是否启用（主开关） */
  enabled: boolean;
  /** 是否在命令面板中显示 */
  showInCommandPalette: boolean;
  /** 是否在编辑器右键菜单中显示 */
  showInEditorMenu: boolean;
  /** 是否在文件浏览器右键菜单中显示 */
  showInFileMenu: boolean;
  /** 是否在侧边栏显示图标 */
  showInRibbon: boolean;
  /** 是否在新标签页中显示（仅终端功能使用） */
  showInNewTab?: boolean;
  /** 是否在状态栏显示（仅终端功能使用） */
  showInStatusBar?: boolean;
}

/**
 * 默认可见性配置
 */
export const DEFAULT_VISIBILITY_CONFIG: VisibilityConfig = {
  enabled: true,
  showInCommandPalette: true,
  showInEditorMenu: true,
  showInFileMenu: true,
  showInRibbon: false, // 默认不显示 Ribbon 图标，避免侧边栏拥挤
};

// ============================================================================
// 功能注册配置接口
// ============================================================================

/**
 * Ribbon 图标配置
 */
export interface RibbonConfig {
  /** 图标名称 (Obsidian icon name) */
  icon: string;
  /** 提示文本 */
  tooltip: string;
  /** 点击回调 */
  callback: () => void | Promise<void>;
}

/**
 * 功能注册配置
 * 定义功能模块的 UI 元素和行为
 */
export interface FeatureRegistrationConfig {
  /** 功能标识符 */
  id: FeatureId;

  /** 获取当前可见性配置的函数（从 settings 中读取） */
  getVisibility: () => VisibilityConfig;

  /** Ribbon 图标配置（可选） */
  ribbon?: RibbonConfig;

  /** 可见性变更时的自定义回调（可选） */
  onVisibilityChange?: (visibility: VisibilityConfig) => void;
}

// ============================================================================
// 内部类型
// ============================================================================

/**
 * 功能注册信息（内部使用）
 */
export interface FeatureRegistration {
  config: FeatureRegistrationConfig;
  ribbonRegistered: boolean;
}

// ============================================================================
// 错误类型
// ============================================================================

/**
 * 可见性管理错误
 */
export class VisibilityError extends Error {
  constructor(
    public featureId: FeatureId,
    public operation: 'register' | 'update' | 'destroy',
    message: string
  ) {
    super(`[FeatureVisibility] ${operation} failed for ${featureId}: ${message}`);
    this.name = 'VisibilityError';
  }
}
