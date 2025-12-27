// ============================================================================
// 多供应商 AI 配置类型定义
// ============================================================================

/**
 * AI 功能类型
 * - naming: 文件命名功能
 * - translation: 翻译功能（预留）
 */
export type AIFeature = 'naming' | 'translation';

/**
 * 模型基本类型
 * - chat: 对话/文本生成
 * - image: 图像生成
 * - embedding: 向量化/嵌入
 * - asr: 语音识别
 * - tts: 语音合成
 */
export type ModelType = 'chat' | 'image' | 'embedding' | 'asr' | 'tts';

/**
 * 模型能力类型（主要用于 chat 类型模型）
 * - vision: 视觉/图像理解
 * - functionCall: 函数调用/工具使用
 * - reasoning: 推理/思考能力
 * - webSearch: 联网搜索
 * - files: 文件处理
 */
export type ModelAbility = 'vision' | 'functionCall' | 'reasoning' | 'webSearch' | 'files';

/**
 * API 格式类型
 * - chat-completions: 传统 Chat Completions API (/v1/chat/completions)
 * - responses: 新 Responses API (/v1/responses)，专为推理模型设计
 */
export type APIFormat = 'chat-completions' | 'responses';

/**
 * 推理深度类型（仅用于 Responses API）
 * - low: 快速响应，较少推理
 * - medium: 平衡模式（默认）
 * - high: 深度推理，更长时间
 */
export type ReasoningEffort = 'low' | 'medium' | 'high';

/**
 * 模型配置接口
 * 属于某个供应商，包含模型名称和参数
 */
export interface ModelConfig {
  id: string;              // 唯一标识符
  name: string;            // 模型名称（API 调用用，如 'gpt-3.5-turbo'）
  displayName: string;     // 显示名称（UI 展示用）
  temperature: number;     // 温度参数 (0-2)
  maxTokens: number;       // 最大 token 数
  topP: number;            // Top P 参数 (0-1)
  type?: ModelType;        // 模型基本类型
  abilities?: ModelAbility[]; // 模型能力列表（主要用于 chat 类型）
  contextLength?: number;  // 上下文长度（可选）
  apiFormat?: APIFormat;   // API 格式，默认 'chat-completions'
  reasoningEffort?: ReasoningEffort; // 推理深度，默认 'medium'（仅用于 Responses API）
  showReasoningSummary?: boolean; // 是否显示推理摘要（仅用于 Responses API）
}

/**
 * AI 供应商配置接口
 * 包含 API 端点、认证信息和该供应商下的模型列表
 */
export interface Provider {
  id: string;              // 唯一标识符
  name: string;            // 供应商名称（如 'OpenAI', 'Anthropic'）
  endpoint: string;        // API 端点
  apiKey: string;          // API 密钥
  models: ModelConfig[];   // 该供应商下的模型列表
}

/**
 * 功能绑定配置接口
 * 将某个 AI 功能与特定的供应商+模型组合关联
 */
export interface FeatureBinding {
  providerId: string;      // 绑定的供应商 ID
  modelId: string;         // 绑定的模型 ID
  promptTemplate: string;  // 该功能的 Prompt 模板
}

/**
 * 解析后的完整配置接口
 * 供 AIService 使用，包含完整的供应商和模型信息
 */
export interface ResolvedConfig {
  provider: Provider;      // 完整的供应商信息
  model: ModelConfig;      // 完整的模型配置
  promptTemplate: string;  // Prompt 模板
}

/** Windows 平台支持的 Shell 类型 */
export type WindowsShellType = 'cmd' | 'powershell' | 'wsl' | 'gitbash' | 'custom';

/** Unix 平台（macOS/Linux）支持的 Shell 类型 */
export type UnixShellType = 'bash' | 'zsh' | 'custom';

/** 所有 Shell 类型的联合 */
export type ShellType = WindowsShellType | UnixShellType;

/**
 * 平台特定的 Shell 配置
 */
export interface PlatformShellConfig {
  windows: WindowsShellType;
  darwin: UnixShellType;  // macOS
  linux: UnixShellType;
}

/**
 * 平台特定的自定义 Shell 路径
 */
export interface PlatformCustomShellPaths {
  windows: string;
  darwin: string;
  linux: string;
}

/**
 * 终端设置接口
 */
export interface TerminalSettings {
  // 各平台的默认 Shell 程序类型（独立存储）
  platformShells: PlatformShellConfig;

  // 各平台的自定义 Shell 路径（独立存储）
  platformCustomShellPaths: PlatformCustomShellPaths;

  // 默认启动参数
  shellArgs: string[];

  // 启动目录设置
  autoEnterVaultDirectory: boolean; // 打开终端时自动进入项目目录

  // 新实例行为：替换标签页、新标签页、新窗口、水平/垂直分屏、左侧/右侧标签页或分屏
  newInstanceBehavior: 'replaceTab' | 'newTab' | 'newLeftTab' | 'newLeftSplit' |
    'newRightTab' | 'newRightSplit' | 'newHorizontalSplit' | 'newVerticalSplit' | 'newWindow';

  // 在现有终端附近创建新实例
  createInstanceNearExistingOnes: boolean;

  // 聚焦新实例：创建新终端时是否自动切换到该标签页
  focusNewInstance: boolean;

  // 锁定新实例：新建终端标签页是否默认锁定
  lockNewInstance: boolean;

  // 终端外观设置
  fontSize: number;
  fontFamily: string;
  cursorStyle: 'block' | 'underline' | 'bar';
  cursorBlink: boolean;

  // 主题设置
  useObsidianTheme: boolean;      // 是否使用 Obsidian 主题颜色
  backgroundColor?: string;        // 自定义背景色
  foregroundColor?: string;        // 自定义前景色

  // 背景图片设置
  backgroundImage?: string;        // 背景图片 URL
  backgroundImageOpacity?: number; // 背景图片透明度 (0-1.0)
  backgroundImageSize?: 'cover' | 'contain' | 'auto'; // 背景图片大小
  backgroundImagePosition?: string; // 背景图片位置
  
  // 毛玻璃效果
  enableBlur?: boolean;            // 是否启用毛玻璃效果
  blurAmount?: number;             // 毛玻璃模糊程度 (0-20px)

  // 文本透明度
  textOpacity?: number;            // 文本透明度 (0-1.0)

  // 渲染器类型：Canvas（推荐）、WebGL（高性能）
  // 注意：DOM 渲染器已过时，存在光标定位等问题，不再提供
  preferredRenderer: 'canvas' | 'webgl';

  // 滚动缓冲区大小（行数）
  scrollback: number;

  // 终端面板默认高度（像素）
  defaultHeight: number;
}

/**
 * 选中工具栏设置接口
 * Requirements: 4.1-4.4
 */
export interface SelectionToolbarSettings {
  /** 是否启用选中工具栏 */
  enabled: boolean;
  /** 最小选中字符数 */
  minSelectionLength: number;
  /** 显示延迟 (ms) */
  showDelay: number;
  /** 各按钮的显示状态 */
  actions: {
    copy: boolean;
    search: boolean;
    createLink: boolean;
    highlight: boolean;
    bold: boolean;
    italic: boolean;
    strikethrough: boolean;
    inlineCode: boolean;
    inlineMath: boolean;
    clearFormat: boolean;
  };
}

/**
 * 默认选中工具栏设置
 */
export const DEFAULT_SELECTION_TOOLBAR_SETTINGS: SelectionToolbarSettings = {
  enabled: true,
  minSelectionLength: 1,
  showDelay: 0,
  actions: {
    copy: true,
    search: true,
    createLink: true,
    highlight: true,
    bold: true,
    italic: true,
    strikethrough: true,
    inlineCode: true,
    inlineMath: true,
    clearFormat: true,
  },
};

/**
 * 功能显示设置接口
 */
export interface FeatureVisibilitySettings {
  // AI 文件名生成功能
  aiNaming: {
    showInCommandPalette: boolean;    // 命令面板
    showInEditorMenu: boolean;        // 编辑器右键菜单
    showInFileMenu: boolean;          // 文件浏览器右键菜单
    showInRibbon: boolean;            // 侧边栏图标
  };
  // 终端功能
  terminal: {
    showInCommandPalette: boolean;    // 命令面板
    showInRibbon: boolean;            // 侧边栏图标
    showInNewTab: boolean;            // 新标签页
  };
}

/**
 * 插件设置接口
 */
export interface SmartWorkflowSettings {
  // AI 配置
  providers: Provider[];                                    // 供应商列表
  featureBindings: Partial<Record<AIFeature, FeatureBinding>>; // 功能绑定

  // 通用 AI 设置
  defaultPromptTemplate: string; // 默认 Prompt 模板
  useCurrentFileNameContext: boolean;  // 是否使用当前文件名作为上下文
  analyzeDirectoryNamingStyle: boolean; // 是否分析目录下其他文件命名风格
  timeout: number;               // 请求超时时间（毫秒）

  // 其他设置
  debugMode: boolean;            // 调试模式（在控制台显示详细日志）
  terminal: TerminalSettings;    // 终端设置
  selectionToolbar: SelectionToolbarSettings; // 选中工具栏设置
  featureVisibility: FeatureVisibilitySettings; // 功能显示设置
}

/**
 * 基础 Prompt 模板（不使用文件名上下文）
 * 仅根据笔记内容生成文件名
 */
export const BASE_PROMPT_TEMPLATE = `Generate a concise and accurate filename for the following note content.

Note content:
{{content}}

Requirements:
1. The filename should be concise and clear, no more than 10 characters
2. Accurately summarize the core content of the note
3. The language of the filename should match the primary language of the note content
4. Use Chinese or English, avoid special characters
5. Return only the filename itself, do not include the .md extension
6. Do not wrap the filename with quotes, angle brackets, or other symbols`;

/**
 * 高级 Prompt 模板
 * 支持文件名上下文和目录命名风格分析
 * 根据设置动态包含：
 * - 当前文件名（作为改进参考）
 * - 同目录文件的命名风格
 */
export const ADVANCED_PROMPT_TEMPLATE = `Generate a concise and accurate filename for the following note content.
{{#if currentFileName}}
Current filename: {{currentFileName}}
Please improve upon this filename to create a more accurate one.
{{/if}}
{{#if directoryNamingStyle}}
Reference naming style from other files in the directory:
{{directoryNamingStyle}}
{{/if}}

Note content:
{{content}}

Requirements:
1. The filename should be concise and clear, no more than 10 characters
2. Accurately summarize the core content of the note
3. The language of the filename should match the primary language of the note content
4. Use Chinese or English, avoid special characters
5. Return only the filename itself, do not include the .md extension
6. Do not wrap the filename with quotes, angle brackets, or other symbols`;

/**
 * 默认平台 Shell 配置
 */
export const DEFAULT_PLATFORM_SHELLS: PlatformShellConfig = {
  windows: 'cmd',
  darwin: 'zsh',
  linux: 'bash'
};

/**
 * 默认平台自定义 Shell 路径
 */
export const DEFAULT_PLATFORM_CUSTOM_SHELL_PATHS: PlatformCustomShellPaths = {
  windows: '',
  darwin: '',
  linux: ''
};

/**
 * 获取当前平台的 Shell 类型
 */
export function getCurrentPlatformShell(settings: TerminalSettings): ShellType {
  const platform = process.platform;
  if (platform === 'win32') {
    return settings.platformShells.windows;
  } else if (platform === 'darwin') {
    return settings.platformShells.darwin;
  } else {
    return settings.platformShells.linux;
  }
}

/**
 * 设置当前平台的 Shell 类型
 */
export function setCurrentPlatformShell(
  settings: TerminalSettings,
  shell: ShellType
): void {
  const platform = process.platform;
  if (platform === 'win32') {
    settings.platformShells.windows = shell as WindowsShellType;
  } else if (platform === 'darwin') {
    settings.platformShells.darwin = shell as UnixShellType;
  } else {
    settings.platformShells.linux = shell as UnixShellType;
  }
}

/**
 * 获取当前平台的自定义 Shell 路径
 */
export function getCurrentPlatformCustomShellPath(settings: TerminalSettings): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return settings.platformCustomShellPaths.windows;
  } else if (platform === 'darwin') {
    return settings.platformCustomShellPaths.darwin;
  } else {
    return settings.platformCustomShellPaths.linux;
  }
}

/**
 * 设置当前平台的自定义 Shell 路径
 */
export function setCurrentPlatformCustomShellPath(
  settings: TerminalSettings,
  path: string
): void {
  const platform = process.platform;
  if (platform === 'win32') {
    settings.platformCustomShellPaths.windows = path;
  } else if (platform === 'darwin') {
    settings.platformCustomShellPaths.darwin = path;
  } else {
    settings.platformCustomShellPaths.linux = path;
  }
}

/**
 * 默认终端设置
 */
export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings = {
  platformShells: { ...DEFAULT_PLATFORM_SHELLS },
  platformCustomShellPaths: { ...DEFAULT_PLATFORM_CUSTOM_SHELL_PATHS },
  shellArgs: [],
  autoEnterVaultDirectory: true,
  newInstanceBehavior: 'newHorizontalSplit',
  createInstanceNearExistingOnes: true,
  focusNewInstance: true,
  lockNewInstance: false,
  fontSize: 14,
  fontFamily: 'Consolas, "Courier New", monospace',
  cursorStyle: 'block',
  cursorBlink: true,
  useObsidianTheme: true,
  preferredRenderer: 'canvas',
  scrollback: 1000,
  defaultHeight: 300,
  backgroundImageOpacity: 0.5,
  backgroundImageSize: 'cover',
  backgroundImagePosition: 'center',
  enableBlur: false,
  blurAmount: 10,
  textOpacity: 1.0
};

/**
 * 默认功能显示设置
 */
export const DEFAULT_FEATURE_VISIBILITY: FeatureVisibilitySettings = {
  aiNaming: {
    showInCommandPalette: true,
    showInEditorMenu: true,
    showInFileMenu: true,
    showInRibbon: true
  },
  terminal: {
    showInCommandPalette: true,
    showInRibbon: true,
    showInNewTab: true
  }
};

/**
 * 默认功能绑定配置
 */
export const DEFAULT_FEATURE_BINDINGS: Partial<Record<AIFeature, FeatureBinding>> = {
  naming: {
    providerId: '',
    modelId: '',
    promptTemplate: ADVANCED_PROMPT_TEMPLATE
  }
};

/**
 * 默认设置
 */
export const DEFAULT_SETTINGS: SmartWorkflowSettings = {
  providers: [],
  featureBindings: {},
  defaultPromptTemplate: ADVANCED_PROMPT_TEMPLATE,
  useCurrentFileNameContext: true,  // 默认使用当前文件名上下文
  analyzeDirectoryNamingStyle: false, // 默认不分析目录命名风格（性能考虑）
  debugMode: false, // 默认关闭调试模式
  timeout: 15000, // 默认超时时间 15 秒
  terminal: DEFAULT_TERMINAL_SETTINGS, // 终端默认设置
  selectionToolbar: DEFAULT_SELECTION_TOOLBAR_SETTINGS, // 选中工具栏默认设置
  featureVisibility: DEFAULT_FEATURE_VISIBILITY // 功能显示默认设置
};
