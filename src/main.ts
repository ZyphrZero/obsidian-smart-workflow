import type { Menu, WorkspaceLeaf} from 'obsidian';
import { Plugin, TFile, MarkdownView, Modal, Setting, Platform, normalizePath } from 'obsidian';
import type { SmartWorkflowSettings} from './settings/settings';
import { DEFAULT_SETTINGS } from './settings/settings';
import { SmartWorkflowSettingTab } from './settings/settingsTab';
import { FileNameService } from './services/naming/fileNameService';
import { NoticeHelper } from './ui/noticeHelper';
// 终端相关模块仅在桌面端使用，使用 type 导入避免移动端加载失败
import type { TerminalService } from './services/terminal/terminalService';
import type { TerminalView } from './ui/terminal/terminalView';
import { TERMINAL_VIEW_TYPE } from './ui/terminal/terminalView';
import { ChatService } from './services/chat/chatService';
import { ChatView, CHAT_VIEW_TYPE } from './ui/chat/chatView';
import { WritingApplyView, WRITING_APPLY_VIEW_TYPE } from './ui/writing/writingApplyView';
import { SelectionToolbarManager } from './ui/selection';
import { setDebugMode, debugLog, errorLog } from './utils/logger';
import { i18n, t } from './i18n';
// ServerManager 仅在桌面端使用
import type { ServerManager } from './services/server/serverManager';

// 语音输入服务
import { VoiceInputService } from './services/voice/voiceInputService';
import { VoiceOverlay } from './ui/voice/voiceOverlay';
import { TextInserter } from './services/voice/textInserter';
import { LLMPostProcessor } from './services/voice/llmPostProcessor';
import { AssistantProcessor } from './services/voice/assistantProcessor';
import { ConfigManager } from './services/config/configManager';
import { HistoryManager } from './services/voice/historyManager';
import { LLMProcessingError } from './services/voice/types';
import { VoiceErrorHandler, isLLMProcessingError } from './services/voice/voiceErrorHandler';

// 标签生成服务
import { TagService } from './services/tagging/tagService';
import { TagConfirmModal } from './ui/tagging/tagConfirmModal';

// 分类和归档服务
import { CategoryService } from './services/categorizing/categoryService';
import { ArchiveService } from './services/archiving/archiveService';
import { CategoryConfirmModal } from './ui/categorizing/categoryConfirmModal';

// 自动归档服务
import { AutoArchiveService } from './services/automation/autoArchiveService';

// 导入选择工具栏样式
import './ui/selection/selectionToolbar.css';

/**
 * 重命名确认对话框
 */
class RenameConfirmModal extends Modal {
  private oldName: string;
  private newName: string;
  private onResult: (confirmed: boolean) => void;
  private resolved = false;

  constructor(app: import('obsidian').App, oldName: string, newName: string, onResult: (confirmed: boolean) => void) {
    super(app);
    this.oldName = oldName;
    this.newName = newName;
    this.onResult = onResult;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // 设置弹窗宽度
    this.modalEl.style.width = '450px';
    this.modalEl.style.maxWidth = '90vw';

    // 标题
    new Setting(contentEl)
      .setName(t('modals.renameConfirm.title'))
      .setHeading();

    // 原文件名
    const oldNameEl = contentEl.createDiv({ cls: 'rename-confirm-item' });
    oldNameEl.style.marginBottom = '12px';
    oldNameEl.createEl('div', { 
      text: t('modals.renameConfirm.oldName'),
      cls: 'setting-item-name'
    });
    oldNameEl.createEl('div', { 
      text: this.oldName,
      cls: 'setting-item-description'
    }).style.fontFamily = 'var(--font-monospace)';

    // 新文件名
    const newNameEl = contentEl.createDiv({ cls: 'rename-confirm-item' });
    newNameEl.style.marginBottom = '16px';
    newNameEl.createEl('div', { 
      text: t('modals.renameConfirm.newName'),
      cls: 'setting-item-name'
    });
    newNameEl.createEl('div', { 
      text: this.newName,
      cls: 'setting-item-description'
    }).style.fontFamily = 'var(--font-monospace)';

    // 按钮容器
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'flex-end';
    buttonContainer.style.gap = '8px';

    // 取消按钮
    const cancelButton = buttonContainer.createEl('button', { text: t('common.cancel') });
    cancelButton.addEventListener('click', () => {
      this.resolved = true;
      this.onResult(false);
      this.close();
    });

    // 确认按钮
    const confirmButton = buttonContainer.createEl('button', {
      text: t('common.confirm'),
      cls: 'mod-cta'
    });
    confirmButton.addEventListener('click', () => {
      this.resolved = true;
      this.onResult(true);
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
    // 如果未通过按钮关闭（ESC、点击外部、关闭按钮），视为取消
    if (!this.resolved) {
      this.onResult(false);
    }
  }
}

/**
 * AI 文件名生成器插件主类
 */
export default class SmartWorkflowPlugin extends Plugin {
  settings: SmartWorkflowSettings;
  fileNameService: FileNameService;
  generatingFiles: Set<string> = new Set();
  
  // 延迟初始化的服务（桌面端专用服务使用动态导入）
  private _serverManager: ServerManager | null = null;
  private _terminalService: TerminalService | null = null;
  private _chatService: ChatService | null = null;
  private _selectionToolbarManager: SelectionToolbarManager | null = null;
  
  // 动态导入的模块缓存
  private _serverManagerModule: typeof import('./services/server/serverManager') | null = null;
  private _terminalServiceModule: typeof import('./services/terminal/terminalService') | null = null;
  private _terminalViewModule: typeof import('./ui/terminal/terminalView') | null = null;
  
  // 语音输入服务（延迟初始化）
  private _voiceInputService: VoiceInputService | null = null;
  private _voiceOverlay: VoiceOverlay | null = null;
  private _textInserter: TextInserter | null = null;
  private _llmPostProcessor: LLMPostProcessor | null = null;
  private _assistantProcessor: AssistantProcessor | null = null;
  private _configManager: ConfigManager | null = null;
  private _historyManager: HistoryManager | null = null;
  private _voiceErrorHandler: VoiceErrorHandler | null = null;

  // 标签生成服务（延迟初始化）
  private _tagService: TagService | null = null;

  // 分类和归档服务（延迟初始化）
  private _categoryService: CategoryService | null = null;
  private _archiveService: ArchiveService | null = null;

  // 自动归档服务（延迟初始化）
  private _autoArchiveService: AutoArchiveService | null = null;

  // Ribbon 图标引用
  private aiNamingRibbonIcon: HTMLElement | null = null;
  private terminalRibbonIcon: HTMLElement | null = null;
  private voiceInputRibbonIcon: HTMLElement | null = null;

  // 按住模式相关
  private pressModekeyupHandler: ((e: KeyboardEvent) => void) | null = null;
  private currentVoiceCommandId: string | null = null;

  /**
   * 获取统一服务器管理器（延迟初始化，仅桌面端）
   * 使用动态导入避免移动端加载 Node.js 模块
   */
  async getServerManager(): Promise<ServerManager> {
    if (Platform.isMobile) {
      throw new Error('ServerManager is not available on mobile');
    }
    
    if (!this._serverManager) {
      debugLog('[SmartWorkflowPlugin] Initializing ServerManager...');
      
      // 动态导入 ServerManager 模块
      if (!this._serverManagerModule) {
        this._serverManagerModule = await import('./services/server/serverManager');
      }
      
      const pluginDir = this.getPluginDir();
      this._serverManager = new this._serverManagerModule.ServerManager(pluginDir);
      
      // 应用配置中的连接设置
      const { maxReconnectAttempts, reconnectInterval } = this.settings.serverConnection;
      this._serverManager.updateConnectionConfig({
        maxAttempts: maxReconnectAttempts,
        interval: reconnectInterval,
      });
      
      debugLog('[SmartWorkflowPlugin] ServerManager initialized');
    }
    return this._serverManager;
  }

  /**
   * 同步获取已初始化的 ServerManager（用于已确认桌面端的场景）
   */
  get serverManager(): ServerManager {
    if (!this._serverManager) {
      throw new Error('ServerManager not initialized. Call getServerManager() first.');
    }
    return this._serverManager;
  }

  /**
   * 获取终端服务（延迟初始化，仅桌面端）
   */
  async getTerminalService(): Promise<TerminalService> {
    if (Platform.isMobile) {
      throw new Error('TerminalService is not available on mobile');
    }
    
    if (!this._terminalService) {
      debugLog('[SmartWorkflowPlugin] Initializing Terminal Service...');
      
      // 动态导入 TerminalService 模块
      if (!this._terminalServiceModule) {
        this._terminalServiceModule = await import('./services/terminal/terminalService');
      }
      
      const serverManager = await this.getServerManager();
      this._terminalService = new this._terminalServiceModule.TerminalService(
        this.app, 
        this.settings.terminal, 
        serverManager
      );
      debugLog('[SmartWorkflowPlugin] Terminal Service initialized');
    }
    return this._terminalService;
  }

  /**
   * 同步获取已初始化的 TerminalService
   */
  get terminalService(): TerminalService {
    if (!this._terminalService) {
      throw new Error('TerminalService not initialized. Call getTerminalService() first.');
    }
    return this._terminalService;
  }

  /**
   * 获取聊天服务（延迟初始化，仅桌面端）
   */
  async getChatService(): Promise<ChatService> {
    if (Platform.isMobile) {
      throw new Error('ChatService is not available on mobile');
    }
    
    if (!this._chatService) {
      debugLog('[SmartWorkflowPlugin] Initializing Chat Service...');
      const serverManager = await this.getServerManager();
      this._chatService = new ChatService(this.app, this.settings, serverManager);
      debugLog('[SmartWorkflowPlugin] Chat Service initialized');
    }
    return this._chatService;
  }

  /**
   * 同步获取已初始化的 ChatService
   */
  get chatService(): ChatService {
    if (!this._chatService) {
      throw new Error('ChatService not initialized. Call getChatService() first.');
    }
    return this._chatService;
  }

  /**
   * 获取选中工具栏管理器（延迟初始化）
   * 桌面端会设置 ServerManager，移动端不设置
   */
  async getSelectionToolbarManager(): Promise<SelectionToolbarManager> {
    if (!this._selectionToolbarManager) {
      debugLog('[SmartWorkflowPlugin] Initializing Selection Toolbar...');
      this._selectionToolbarManager = new SelectionToolbarManager(
        this.app,
        this.settings.selectionToolbar,
        this.settings,
        () => this.saveSettings()
      );
      // 仅桌面端设置 ServerManager 以启用 Rust 模式流式处理
      if (!Platform.isMobile) {
        try {
          const serverManager = await this.getServerManager();
          this._selectionToolbarManager.setServerManager(serverManager);
        } catch (e) {
          debugLog('[SmartWorkflowPlugin] ServerManager not available, using fallback mode');
        }
      }
      this._selectionToolbarManager.initialize();
      debugLog('[SmartWorkflowPlugin] Selection Toolbar initialized');
    }
    return this._selectionToolbarManager;
  }

  /**
   * 同步获取已初始化的 SelectionToolbarManager
   */
  get selectionToolbarManager(): SelectionToolbarManager {
    if (!this._selectionToolbarManager) {
      throw new Error('SelectionToolbarManager not initialized. Call getSelectionToolbarManager() first.');
    }
    return this._selectionToolbarManager;
  }

  /**
   * 获取标签生成服务（延迟初始化）
   */
  get tagService(): TagService {
    if (!this._tagService) {
      debugLog('[SmartWorkflowPlugin] Initializing Tag Service...');
      this._tagService = new TagService(this.app, this.settings, this.serverManager);
      debugLog('[SmartWorkflowPlugin] Tag Service initialized');
    }
    return this._tagService;
  }

  /**
   * 获取分类服务（延迟初始化）
   */
  get categoryService(): CategoryService {
    if (!this._categoryService) {
      debugLog('[SmartWorkflowPlugin] Initializing Category Service...');
      this._categoryService = new CategoryService(this.app, this.settings, this.serverManager);
      debugLog('[SmartWorkflowPlugin] Category Service initialized');
    }
    return this._categoryService;
  }

  /**
   * 获取归档服务（延迟初始化）
   */
  get archiveService(): ArchiveService {
    if (!this._archiveService) {
      debugLog('[SmartWorkflowPlugin] Initializing Archive Service...');
      this._archiveService = new ArchiveService(this.app, this.settings);
      debugLog('[SmartWorkflowPlugin] Archive Service initialized');
    }
    return this._archiveService;
  }

  /**
   * 获取自动归档服务（延迟初始化）
   */
  get autoArchiveService(): AutoArchiveService {
    if (!this._autoArchiveService) {
      debugLog('[SmartWorkflowPlugin] Initializing Auto Archive Service...');
      this._autoArchiveService = new AutoArchiveService(
        this.app,
        this.settings,
        this.tagService,
        this.categoryService,
        this.archiveService
      );
      debugLog('[SmartWorkflowPlugin] Auto Archive Service initialized');
    }
    return this._autoArchiveService;
  }

  /**
   * 获取配置管理器（延迟初始化）
   */
  get configManager(): ConfigManager {
    if (!this._configManager) {
      debugLog('[SmartWorkflowPlugin] Initializing ConfigManager...');
      this._configManager = new ConfigManager(this.settings, () => this.saveSettings());
      debugLog('[SmartWorkflowPlugin] ConfigManager initialized');
    }
    return this._configManager;
  }

  /**
   * 获取语音输入服务（延迟初始化，仅桌面端）
   * 使用统一的 ServerManager
   */
  async getVoiceInputService(): Promise<VoiceInputService> {
    if (Platform.isMobile) {
      throw new Error('VoiceInputService is not available on mobile');
    }
    
    if (!this._voiceInputService) {
      debugLog('[SmartWorkflowPlugin] Initializing VoiceInputService...');
      const serverManager = await this.getServerManager();
      this._voiceInputService = new VoiceInputService(
        this.app,
        this.settings.voice,
        serverManager,
        this.configManager
      );
      
      // 注入依赖
      this._voiceInputService.setLLMPostProcessor(this.llmPostProcessor);
      this._voiceInputService.setTextInserter(this.textInserter);
      
      debugLog('[SmartWorkflowPlugin] VoiceInputService initialized');
    }
    return this._voiceInputService;
  }

  /**
   * 同步获取已初始化的 VoiceInputService
   */
  get voiceInputService(): VoiceInputService {
    if (!this._voiceInputService) {
      throw new Error('VoiceInputService not initialized. Call getVoiceInputService() first.');
    }
    return this._voiceInputService;
  }

  /**
   * 获取语音悬浮窗（延迟初始化）
   */
  get voiceOverlay(): VoiceOverlay {
    if (!this._voiceOverlay) {
      debugLog('[SmartWorkflowPlugin] Initializing VoiceOverlay...');
      this._voiceOverlay = new VoiceOverlay(this.app, {
        position: this.settings.voice.overlayPosition,
      });
      debugLog('[SmartWorkflowPlugin] VoiceOverlay initialized');
    }
    return this._voiceOverlay;
  }

  /**
   * 获取文本插入器（延迟初始化）
   */
  get textInserter(): TextInserter {
    if (!this._textInserter) {
      debugLog('[SmartWorkflowPlugin] Initializing TextInserter...');
      this._textInserter = new TextInserter(this.app);
      debugLog('[SmartWorkflowPlugin] TextInserter initialized');
    }
    return this._textInserter;
  }

  /**
   * 获取 LLM 后处理器（延迟初始化）
   */
  get llmPostProcessor(): LLMPostProcessor {
    if (!this._llmPostProcessor) {
      debugLog('[SmartWorkflowPlugin] Initializing LLMPostProcessor...');
      this._llmPostProcessor = new LLMPostProcessor(this.settings, this.configManager);
      debugLog('[SmartWorkflowPlugin] LLMPostProcessor initialized');
    }
    return this._llmPostProcessor;
  }

  /**
   * 获取 AI 助手处理器（延迟初始化）
   */
  get assistantProcessor(): AssistantProcessor {
    if (!this._assistantProcessor) {
      debugLog('[SmartWorkflowPlugin] Initializing AssistantProcessor...');
      this._assistantProcessor = new AssistantProcessor(this.settings, this.configManager);
      debugLog('[SmartWorkflowPlugin] AssistantProcessor initialized');
    }
    return this._assistantProcessor;
  }

  /**
   * 获取历史记录管理器（延迟初始化）
   */
  get historyManager(): HistoryManager {
    if (!this._historyManager) {
      debugLog('[SmartWorkflowPlugin] Initializing HistoryManager...');
      this._historyManager = new HistoryManager(this.app);
      debugLog('[SmartWorkflowPlugin] HistoryManager initialized');
    }
    return this._historyManager;
  }

  /**
   * 获取语音错误处理器（延迟初始化）
   */
  get voiceErrorHandler(): VoiceErrorHandler {
    if (!this._voiceErrorHandler) {
      debugLog('[SmartWorkflowPlugin] Initializing VoiceErrorHandler...');
      this._voiceErrorHandler = new VoiceErrorHandler(this.app);
      debugLog('[SmartWorkflowPlugin] VoiceErrorHandler initialized');
    }
    return this._voiceErrorHandler;
  }


  /**
   * 插件加载时调用
   */
  async onload() {
    // 初始化 i18n 服务
    i18n.initialize();
    
    debugLog(t('plugin.loadingMessage'));

    // 加载设置
    await this.loadSettings();
    
    // 初始化调试模式
    setDebugMode(this.settings.debugMode);

    // 初始化核心服务（AI 命名功能）
    debugLog('[SmartWorkflowPlugin] Initializing FileNameService...');
    this.fileNameService = new FileNameService(
      this.app,
      this.settings,
      () => this.saveSettings()
    );
    debugLog('[SmartWorkflowPlugin] FileNameService initialized');

    // 注册终端视图（仅桌面端，使用动态导入）
    if (this.isTerminalEnabled()) {
      // 预加载终端模块
      this.registerTerminalView();
    }

    // 注册聊天视图（仅桌面端）
    if (!Platform.isMobile) {
      this.registerChatView();
    }

    // 注册写作应用视图
    this.registerView(
      WRITING_APPLY_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new WritingApplyView(leaf)
    );

    // 添加侧边栏图标按钮 - AI 文件名生成
    if (this.settings.featureVisibility.aiNaming.showInRibbon) {
      this.aiNamingRibbonIcon = this.addRibbonIcon('sparkles', t('ribbon.aiFilenameTooltip'), async () => {
        await this.handleGenerateCommand();
      });
    }

    // 添加侧边栏图标按钮 - 打开终端（仅桌面端）
    if (this.isTerminalEnabled() && this.settings.featureVisibility.terminal.showInRibbon) {
      this.terminalRibbonIcon = this.addRibbonIcon('terminal-square', t('ribbon.terminalTooltip'), async () => {
        await this.activateTerminalView();
      });
    }

    // 添加命令面板命令 - AI 文件名生成
    if (this.settings.featureVisibility.aiNaming.showInCommandPalette) {
      this.addCommand({
        id: 'generate-ai-filename',
        name: t('commands.generateAiFilename'),
        callback: async () => {
          await this.handleGenerateCommand();
        }
      });
    }

    // 添加命令面板命令 - AI 标签生成
    if (this.settings.tagging.enabled && this.settings.tagging.showInCommandPalette) {
      this.addCommand({
        id: 'generate-ai-tags',
        name: t('tagging.commands.generateTags'),
        checkCallback: (checking: boolean) => {
          const file = this.app.workspace.getActiveFile();
          if (file) {
            if (!checking) {
              this.handleGenerateTagsCommand(file);
            }
            return true;
          }
          return false;
        }
      });
    }

    // 添加命令面板命令 - 智能归档
    if (this.settings.archiving.enabled && this.settings.archiving.showInCommandPalette) {
      this.addCommand({
        id: 'smart-archive',
        name: t('archiving.commands.archiveNote'),
        checkCallback: (checking: boolean) => {
          const file = this.app.workspace.getActiveFile();
          if (file) {
            if (!checking) {
              this.handleSmartArchiveCommand(file);
            }
            return true;
          }
          return false;
        }
      });
    }

    // 添加命令 - 一键归档（标签+归档）
    // 命令始终注册（只要功能启用），以便用户可以在 Obsidian 快捷键设置中配置
    if (this.settings.autoArchive?.enabled) {
      this.addCommand({
        id: 'auto-archive',
        name: t('autoArchive.commands.autoArchive'),
        checkCallback: (checking: boolean) => {
          const file = this.app.workspace.getActiveFile();
          if (file && this.autoArchiveService.canProcess(file)) {
            if (!checking) {
              this.autoArchiveService.execute(file);
            }
            return true;
          }
          return false;
        }
      });
    }

    // 添加打开终端命令（仅桌面端）
    if (this.isTerminalEnabled() && this.settings.featureVisibility.terminal.showInCommandPalette) {
      this.addCommand({
        id: 'open-terminal',
        name: t('commands.openTerminal'),
        hotkeys: [{ modifiers: ['Ctrl'], key: 'o' }],
        callback: async () => {
          await this.activateTerminalView();
        }
      });
    }

    // 添加打开聊天命令
    this.addCommand({
      id: 'open-chat',
      name: 'Open Smart Chat',
      callback: async () => {
        await this.activateChatView();
      }
    });

    // 终端快捷键命令（仅桌面端）
    if (this.isTerminalEnabled()) {
      this.addCommand({
        id: 'terminal-clear',
        name: t('commands.terminalClear'),
        hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'r' }],
        checkCallback: (checking: boolean) => {
          const terminalView = this.getActiveTerminalView();
          if (terminalView?.getTerminalInstance()) {
            if (!checking) {
              terminalView.getTerminalInstance()?.getXterm().clear();
            }
            return true;
          }
          return false;
        }
      });

      this.addCommand({
        id: 'terminal-copy',
        name: t('commands.terminalCopy'),
        hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'c' }],
        checkCallback: (checking: boolean) => {
          const terminalView = this.getActiveTerminalView();
          const terminal = terminalView?.getTerminalInstance();
          if (terminal?.getXterm().hasSelection()) {
            if (!checking) {
              const selection = terminal.getXterm().getSelection();
              navigator.clipboard.writeText(selection);
              terminal.getXterm().clearSelection();
            }
            return true;
          }
          return false;
        }
      });

      this.addCommand({
        id: 'terminal-paste',
        name: t('commands.terminalPaste'),
        hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'v' }],
        checkCallback: (checking: boolean) => {
          const terminalView = this.getActiveTerminalView();
          const terminal = terminalView?.getTerminalInstance();
          if (terminal) {
            if (!checking) {
              navigator.clipboard.readText().then(text => {
                if (text) terminal.write(text);
              });
            }
            return true;
          }
          return false;
        }
      });

      this.addCommand({
        id: 'terminal-font-increase',
        name: t('commands.terminalFontIncrease'),
        hotkeys: [{ modifiers: ['Ctrl'], key: '=' }],
        checkCallback: (checking: boolean) => {
          const terminalView = this.getActiveTerminalView();
          const terminal = terminalView?.getTerminalInstance();
          if (terminal) {
            if (!checking) {
              terminal.increaseFontSize();
            }
            return true;
          }
          return false;
        }
      });

      this.addCommand({
        id: 'terminal-font-decrease',
        name: t('commands.terminalFontDecrease'),
        hotkeys: [{ modifiers: ['Ctrl'], key: '-' }],
        checkCallback: (checking: boolean) => {
          const terminalView = this.getActiveTerminalView();
          const terminal = terminalView?.getTerminalInstance();
          if (terminal) {
            if (!checking) {
              terminal.decreaseFontSize();
            }
            return true;
          }
          return false;
        }
      });

      this.addCommand({
        id: 'terminal-font-reset',
        name: t('commands.terminalFontReset'),
        hotkeys: [{ modifiers: ['Ctrl'], key: '0' }],
        checkCallback: (checking: boolean) => {
          const terminalView = this.getActiveTerminalView();
          const terminal = terminalView?.getTerminalInstance();
          if (terminal) {
            if (!checking) {
              terminal.resetFontSize();
            }
            return true;
          }
          return false;
        }
      });

      this.addCommand({
        id: 'terminal-split-horizontal',
        name: t('commands.terminalSplitHorizontal'),
        hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'h' }],
        checkCallback: (checking: boolean) => {
          const terminalView = this.getActiveTerminalView();
          if (terminalView) {
            if (!checking) {
              this.splitTerminal('horizontal');
            }
            return true;
          }
          return false;
        }
      });

      this.addCommand({
        id: 'terminal-split-vertical',
        name: t('commands.terminalSplitVertical'),
        hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'j' }],
        checkCallback: (checking: boolean) => {
          const terminalView = this.getActiveTerminalView();
          if (terminalView) {
            if (!checking) {
              this.splitTerminal('vertical');
            }
            return true;
          }
          return false;
        }
      });

      this.addCommand({
        id: 'terminal-clear-buffer',
        name: t('commands.terminalClearBuffer'),
        hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'k' }],
        checkCallback: (checking: boolean) => {
          const terminalView = this.getActiveTerminalView();
          const terminal = terminalView?.getTerminalInstance();
          if (terminal) {
            if (!checking) {
              terminal.clearBuffer();
            }
            return true;
          }
          return false;
        }
      });
    }

    // ========================================================================
    // 语音输入命令注册
    // 注意：命令始终注册，不依赖 enabled 设置，这样用户可以先设置快捷键
    // ========================================================================

    // 语音听写命令
    this.addCommand({
      id: 'voice-dictation',
      name: t('commands.voiceDictation'),
      callback: async () => {
        if (!this.settings.voice.enabled) {
          NoticeHelper.warning(t('voice.settings.notEnabled'));
          return;
        }
        // 如果已在录音中，则停止录音（支持 toggle 行为）
        if (this._voiceInputService?.isRecording()) {
          await this.finishVoiceRecording();
          return;
        }
        await this.handleVoiceDictation();
      }
    });

    // 语音助手命令
    this.addCommand({
      id: 'voice-assistant',
      name: t('commands.voiceAssistant'),
      callback: async () => {
        if (!this.settings.voice.enabled) {
          NoticeHelper.warning(t('voice.settings.notEnabled'));
          return;
        }
        // 如果已在录音中，则停止录音（支持 toggle 行为）
        if (this._voiceInputService?.isRecording()) {
          await this.finishVoiceRecording();
          return;
        }
        await this.handleVoiceAssistant();
      }
    });

    // 取消录音命令
    this.addCommand({
      id: 'voice-cancel',
      name: t('commands.voiceCancel'),
      checkCallback: (checking: boolean) => {
        // 只有在录音中时才显示此命令
        if (this._voiceInputService?.isRecording()) {
          if (!checking) {
            this.cancelVoiceRecording();
          }
          return true;
        }
        return false;
      }
    });    // 添加编辑器右键菜单
    if (this.settings.featureVisibility.aiNaming.showInEditorMenu) {
      this.registerEvent(
        this.app.workspace.on('editor-menu', (menu: Menu, _editor, _view) => {
          menu.addItem((item) => {
            item
              .setTitle(t('menu.generateAiFilename'))
              .setIcon('sparkles')
              .onClick(async () => {
                await this.handleGenerateCommand();
              });
          });
        })
      );
    }

    // 添加标签生成右键菜单
    if (this.settings.tagging.enabled && this.settings.tagging.showInEditorMenu) {
      this.registerEvent(
        this.app.workspace.on('editor-menu', (menu: Menu, _editor, _view) => {
          const file = this.app.workspace.getActiveFile();
          if (file) {
            menu.addItem((item) => {
              item
                .setTitle(t('tagging.commands.generateTags'))
                .setIcon('tag')
                .onClick(async () => {
                  await this.handleGenerateTagsCommand(file);
                });
            });
          }
        })
      );
    }

    // 添加智能归档右键菜单
    if (this.settings.archiving.enabled && this.settings.archiving.showInEditorMenu) {
      this.registerEvent(
        this.app.workspace.on('editor-menu', (menu: Menu, _editor, _view) => {
          const file = this.app.workspace.getActiveFile();
          if (file && this.archiveService.canArchive(file)) {
            menu.addItem((item) => {
              item
                .setTitle(t('archiving.commands.archiveNote'))
                .setIcon('archive')
                .onClick(async () => {
                  await this.handleSmartArchiveCommand(file);
                });
            });
          }
        })
      );
    }

    // 添加自动归档编辑器右键菜单
    if (this.settings.autoArchive?.enabled && this.settings.autoArchive?.showInEditorMenu) {
      this.registerEvent(
        this.app.workspace.on('editor-menu', (menu: Menu, _editor, _view) => {
          const file = this.app.workspace.getActiveFile();
          if (file && this.autoArchiveService.canProcess(file)) {
            menu.addItem((item) => {
              item
                .setTitle(t('autoArchive.commands.autoArchive'))
                .setIcon('workflow')
                .onClick(async () => {
                  await this.autoArchiveService.execute(file);
                });
            });
          }
        })
      );
    }

    // 添加文件浏览器右键菜单
    if (this.settings.featureVisibility.aiNaming.showInFileMenu) {
      this.registerEvent(
        this.app.workspace.on('file-menu', (menu: Menu, file) => {
          if (file instanceof TFile) {
            menu.addItem((item) => {
              item
                .setTitle(t('menu.generateAiFilename'))
                .setIcon('sparkles')
                .onClick(async () => {
                  await this.handleGenerateForFile(file);
                });
            });
          }
        })
      );
    }

    // 添加标签生成文件浏览器右键菜单
    if (this.settings.tagging.enabled && this.settings.tagging.showInFileMenu) {
      this.registerEvent(
        this.app.workspace.on('file-menu', (menu: Menu, file) => {
          if (file instanceof TFile) {
            menu.addItem((item) => {
              item
                .setTitle(t('tagging.commands.generateTags'))
                .setIcon('tag')
                .onClick(async () => {
                  await this.handleGenerateTagsCommand(file);
                });
            });
          }
        })
      );
    }

    // 添加智能归档文件浏览器右键菜单
    if (this.settings.archiving.enabled && this.settings.archiving.showInFileMenu) {
      this.registerEvent(
        this.app.workspace.on('file-menu', (menu: Menu, file) => {
          if (file instanceof TFile && this.archiveService.canArchive(file)) {
            menu.addItem((item) => {
              item
                .setTitle(t('archiving.commands.archiveNote'))
                .setIcon('archive')
                .onClick(async () => {
                  await this.handleSmartArchiveCommand(file);
                });
            });
          }
        })
      );
    }

    // 添加自动归档文件浏览器右键菜单
    if (this.settings.autoArchive?.enabled && this.settings.autoArchive?.showInFileMenu) {
      this.registerEvent(
        this.app.workspace.on('file-menu', (menu: Menu, file) => {
          if (file instanceof TFile && this.autoArchiveService.canProcess(file)) {
            menu.addItem((item) => {
              item
                .setTitle(t('autoArchive.commands.autoArchive'))
                .setIcon('workflow')
                .onClick(async () => {
                  await this.autoArchiveService.execute(file);
                });
            });
          }
        })
      );
    }

    // 添加设置标签页
    this.addSettingTab(new SmartWorkflowSettingTab(this.app, this));

    // 监听文件切换，清理不属于当前文件的动画效果
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.cleanupTitleAnimations();
      })
    );

    // 注册新标签页中的"打开终端"选项（仅桌面端）
    if (this.isTerminalEnabled() && this.settings.featureVisibility.terminal.showInNewTab) {
      this.registerNewTabTerminalAction();
    }

    // 初始化选中文字浮动工具栏（如果启用）
    if (this.settings.selectionToolbar.enabled) {
      // 触发延迟初始化（异步）
      void this.getSelectionToolbarManager();
    }
  }

  /**
   * 清理不属于当前文件的标题动画效果
   */
  cleanupTitleAnimations() {
    const activeFile = this.app.workspace.getActiveFile();
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

    if (!activeView) return;

    const viewContent = activeView.containerEl.querySelector('.view-content');
    const inlineTitle = viewContent?.querySelector('.inline-title') as HTMLElement;

    if (!inlineTitle) return;

    // 如果当前文件不在生成列表中，移除动画效果
    if (!activeFile || !this.generatingFiles.has(activeFile.path)) {
      inlineTitle.removeClass('ai-generating-title');
    } else {
      // 如果当前文件正在生成，确保有动画效果
      inlineTitle.addClass('ai-generating-title');
    }
  }

  /**
   * 处理生成命令（从当前活动文件）
   */
  async handleGenerateCommand() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      NoticeHelper.error(t('notices.noOpenFile'));
      return;
    }
    await this.handleGenerateForFile(file);
  }

  /**
   * 处理标签生成命令
   * @param file 目标文件
   */
  async handleGenerateTagsCommand(file: TFile) {
    try {
      NoticeHelper.info(t('tagging.notices.generating'));

      // 调用TagService生成标签
      const result = await this.tagService.generateTags(file);

      if (!result.success) {
        NoticeHelper.error(t('tagging.notices.failed', { message: result.error || t('common.error') }));
        return;
      }

      if (result.tags.length === 0) {
        NoticeHelper.warning(t('tagging.notices.noTags'));
        return;
      }

      // 如果设置为自动应用，直接应用标签
      if (this.settings.tagging.autoApply) {
        await this.tagService.applyTags(file, result.allTags);
        NoticeHelper.success(t('tagging.notices.applied', { tags: result.tags.join(', ') }));
      } else {
        // 否则显示确认对话框
        new TagConfirmModal(
          this.app,
          result.allTags,
          async (confirmedTags) => {
            try {
              await this.tagService.applyTags(file, confirmedTags);
              NoticeHelper.success(t('tagging.notices.applied', { tags: confirmedTags.join(', ') }));
            } catch (error) {
              errorLog('[SmartWorkflowPlugin] 应用标签失败:', error);
              NoticeHelper.error(t('tagging.notices.failed', { message: String(error) }));
            }
          },
          () => {
            NoticeHelper.info(t('tagging.notices.cancelled'));
          },
          result.existingTags // 传入原有标签用于标识
        ).open();
      }
    } catch (error) {
      errorLog('[SmartWorkflowPlugin] 标签生成失败:', error);
      NoticeHelper.error(t('tagging.notices.failed', { message: String(error) }));
    }
  }

  /**
   * 处理智能归档命令
   * @param file 目标文件
   */
  async handleSmartArchiveCommand(file: TFile) {
    try {
      // 检查文件是否可以归档
      if (!this.archiveService.canArchive(file)) {
        NoticeHelper.warning(t('archiving.notices.archived', { path: '' }).replace('：', ''));
        return;
      }

      NoticeHelper.info(t('archiving.notices.analyzing'));

      // 调用 CategoryService 生成分类建议
      const result = await this.categoryService.suggestCategory(file);

      if (!result.success) {
        NoticeHelper.error(t('archiving.notices.failed', { message: result.error || t('common.error') }));
        return;
      }

      // 如果没有建议且不允许确认，直接返回
      if (result.suggestions.length === 0 && !this.settings.archiving.confirmBeforeArchive) {
        NoticeHelper.warning(t('archiving.notices.noCategory'));
        return;
      }

      // 显示分类确认对话框
      new CategoryConfirmModal(
        this.app,
        result.suggestions,
        async (selectedSuggestion) => {
          if (!selectedSuggestion) {
            NoticeHelper.info(t('archiving.notices.cancelled'));
            return;
          }

          try {
            NoticeHelper.info(t('archiving.notices.archiving'));

            // 如果是新分类且允许创建，先创建文件夹
            if (selectedSuggestion.isNew && this.settings.archiving.createNewCategories) {
              const exists = await this.categoryService.categoryExists(selectedSuggestion.path);
              if (!exists) {
                await this.categoryService.createCategory(selectedSuggestion.path);
              }
            }

            // 归档文件
            const archiveResult = await this.archiveService.archiveFile(file, {
              targetPath: selectedSuggestion.path,
              moveAttachments: this.settings.archiving.moveAttachments,
              updateLinks: this.settings.archiving.updateLinks,
              createFolder: this.settings.archiving.createNewCategories,
            });

            if (archiveResult.success) {
              NoticeHelper.success(t('archiving.notices.archived', { path: selectedSuggestion.name }));
            } else {
              NoticeHelper.error(t('archiving.notices.failed', { message: archiveResult.error || t('common.error') }));
            }
          } catch (error) {
            errorLog('[SmartWorkflowPlugin] 归档失败:', error);
            NoticeHelper.error(t('archiving.notices.failed', { message: String(error) }));
          }
        }
      ).open();
    } catch (error) {
      errorLog('[SmartWorkflowPlugin] 智能归档失败:', error);
      NoticeHelper.error(t('archiving.notices.failed', { message: String(error) }));
    }
  }

  /**
   * 获取指定文件的标题元素
   * @param filePath 文件路径
   */
  getInlineTitleForFile(filePath: string): HTMLElement | null {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile || activeFile.path !== filePath) {
      return null;
    }

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) return null;

    const viewContent = activeView.containerEl.querySelector('.view-content');
    return viewContent?.querySelector('.inline-title') as HTMLElement;
  }

  /**
   * 处理指定文件的生成
   * @param file 目标文件
   */
  async handleGenerateForFile(file: TFile) {
    // 延迟验证功能绑定配置
    this.validateFeatureBindings();
    
    // 添加到生成中的文件集合
    this.generatingFiles.add(file.path);

    // 添加标题动画效果
    let inlineTitle = this.getInlineTitleForFile(file.path);
    if (inlineTitle) {
      inlineTitle.addClass('ai-generating-title');
    }

    try {
      NoticeHelper.info(t('notices.generatingFilename'));

      // 先生成文件名
      const generateResult = await this.fileNameService.generateFileName(file);

      // 如果文件名相同，直接返回
      if (generateResult.isSame) {
        NoticeHelper.info(t('fileNameService.noChangeNeeded'));
        return;
      }

      // 根据设置决定是否需要确认
      if (this.settings.confirmBeforeRename) {
        // 显示确认对话框
        const confirmed = await this.showRenameConfirmDialog(
          generateResult.oldName,
          generateResult.newName
        );
        
        if (!confirmed) {
          NoticeHelper.info(t('notices.renameCancelled'));
          return;
        }
      }

      // 执行重命名
      const result = await this.fileNameService.renameFile(file, generateResult.newName);
      NoticeHelper.success(result.message);

    } catch (error) {
      if (error instanceof Error) {
        NoticeHelper.error(t('notices.operationFailed', { message: error.message }));
        errorLog('AI 文件名生成错误:', error);
      } else {
        NoticeHelper.error(t('notices.operationFailed', { message: '未知错误' }));
        errorLog('AI 文件名生成错误:', error);
      }
    } finally {
      // 移除生成状态
      this.generatingFiles.delete(file.path);

      // 移除标题动画效果 - 重新获取元素以确保移除正确的元素
      inlineTitle = this.getInlineTitleForFile(file.path);
      if (inlineTitle) {
        inlineTitle.removeClass('ai-generating-title');
      }
    }
  }

  /**
   * 显示重命名确认对话框
   * @param oldName 原文件名
   * @param newName 新文件名
   * @returns 用户是否确认
   */
  private showRenameConfirmDialog(oldName: string, newName: string): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new RenameConfirmModal(this.app, oldName, newName, (confirmed) => {
        resolve(confirmed);
      });
      modal.open();
    });
  }

  /**
   * 加载设置
   * 优化版：使用简洁的深度合并，延迟验证到首次使用时
   */
  async loadSettings() {
    const loaded = await this.loadData() as Partial<SmartWorkflowSettings> | null;
    
    if (!loaded) {
      this.settings = { ...DEFAULT_SETTINGS };
      return;
    }

    // 一次性深度合并所有设置
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      // 确保 prompt 模板非空
      defaultPromptTemplate: loaded.defaultPromptTemplate?.trim() || DEFAULT_SETTINGS.defaultPromptTemplate,
      basePromptTemplate: loaded.basePromptTemplate || DEFAULT_SETTINGS.basePromptTemplate,
      advancedPromptTemplate: loaded.advancedPromptTemplate || DEFAULT_SETTINGS.advancedPromptTemplate,
      // 供应商配置：迁移旧格式 apiKey -> keyConfig
      providers: (loaded.providers || []).map(p => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const provider = p as any;
        
        // 迁移主密钥：如果有旧的 apiKey 字段但没有 keyConfig，进行迁移
        let keyConfig = provider.keyConfig;
        if (!keyConfig && provider.apiKey) {
          keyConfig = {
            mode: 'local' as const,
            localValue: provider.apiKey
          };
        }
        // 确保 keyConfig 有默认值
        if (!keyConfig) {
          keyConfig = { mode: 'local' as const, localValue: '' };
        }
        
        // 迁移多密钥：如果有旧的 apiKeys 字段但没有 keyConfigs，进行迁移
        let keyConfigs = provider.keyConfigs;
        if (!keyConfigs && provider.apiKeys && Array.isArray(provider.apiKeys)) {
          keyConfigs = provider.apiKeys.map((key: string) => ({
            mode: 'local' as const,
            localValue: key
          }));
        }
        
        return {
          id: provider.id,
          name: provider.name,
          endpoint: provider.endpoint,
          keyConfig,
          keyConfigs,
          currentKeyIndex: provider.currentKeyIndex,
          models: provider.models || []
        };
      }),
      // 功能绑定：直接使用
      featureBindings: loaded.featureBindings || {},
      // 嵌套对象深度合并
      terminal: {
        ...DEFAULT_SETTINGS.terminal,
        ...loaded.terminal,
        platformShells: {
          ...DEFAULT_SETTINGS.terminal.platformShells,
          ...loaded.terminal?.platformShells
        },
        platformCustomShellPaths: {
          ...DEFAULT_SETTINGS.terminal.platformCustomShellPaths,
          ...loaded.terminal?.platformCustomShellPaths
        }
      },
      featureVisibility: {
        aiNaming: {
          ...DEFAULT_SETTINGS.featureVisibility.aiNaming,
          ...loaded.featureVisibility?.aiNaming
        },
        terminal: {
          ...DEFAULT_SETTINGS.featureVisibility.terminal,
          ...loaded.featureVisibility?.terminal,
          // 移动端强制关闭终端功能
          enabled: Platform.isMobile ? false : (loaded.featureVisibility?.terminal?.enabled ?? DEFAULT_SETTINGS.featureVisibility.terminal.enabled)
        }
      },
      selectionToolbar: {
        ...DEFAULT_SETTINGS.selectionToolbar,
        ...loaded.selectionToolbar,
        // 合并 buttonConfigs，保留用户自定义配置
        buttonConfigs: this.mergeButtonConfigs(
          DEFAULT_SETTINGS.selectionToolbar.buttonConfigs,
          loaded.selectionToolbar?.buttonConfigs
        )
      },
      // 写作功能设置深度合并
      writing: {
        ...DEFAULT_SETTINGS.writing,
        ...loaded.writing,
        actions: {
          ...DEFAULT_SETTINGS.writing.actions,
          ...loaded.writing?.actions
        }
      },
      // 语音输入设置深度合并（包含 ASR 密钥迁移）
      voice: {
        ...DEFAULT_SETTINGS.voice,
        ...loaded.voice,
        primaryASR: this.migrateASRConfig({
          ...DEFAULT_SETTINGS.voice.primaryASR,
          ...loaded.voice?.primaryASR
        }),
        backupASR: loaded.voice?.backupASR ? this.migrateASRConfig({
          ...DEFAULT_SETTINGS.voice.backupASR,
          ...loaded.voice.backupASR
        }) : DEFAULT_SETTINGS.voice.backupASR,
        llmPresets: loaded.voice?.llmPresets || DEFAULT_SETTINGS.voice.llmPresets,
        assistantConfig: {
          ...DEFAULT_SETTINGS.voice.assistantConfig,
          ...loaded.voice?.assistantConfig
        }
      },
      // 服务器连接设置深度合并
      serverConnection: {
        ...DEFAULT_SETTINGS.serverConnection,
        ...loaded.serverConnection,
      }
    };
  }

  /**
   * 迁移 ASR 配置中的旧密钥字段到新的 KeyConfig 格式
   * @param config ASR 配置（可能包含旧字段）
   * @returns 迁移后的 ASR 配置
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private migrateASRConfig(config: any): import('./settings/settings').VoiceASRProviderConfig {
    const result = { ...config };
    
    // 迁移 DashScope API Key (Qwen)
    if (!result.dashscopeKeyConfig && result.dashscope_api_key) {
      result.dashscopeKeyConfig = {
        mode: 'local' as const,
        localValue: result.dashscope_api_key
      };
    }
    
    // 迁移 Doubao access_token
    if (!result.doubaoKeyConfig && result.access_token) {
      result.doubaoKeyConfig = {
        mode: 'local' as const,
        localValue: result.access_token
      };
    }
    
    // 迁移 SiliconFlow API Key (SenseVoice)
    if (!result.siliconflowKeyConfig && result.siliconflow_api_key) {
      result.siliconflowKeyConfig = {
        mode: 'local' as const,
        localValue: result.siliconflow_api_key
      };
    }
    
    return result;
  }

  /**
   * 合并工具栏按钮配置
   * 保留用户自定义配置，同时确保新按钮被添加
   */
  private mergeButtonConfigs(
    defaults: import('./settings/settings').ToolbarButtonConfig[],
    loaded?: import('./settings/settings').ToolbarButtonConfig[]
  ): import('./settings/settings').ToolbarButtonConfig[] {
    if (!loaded || loaded.length === 0) {
      return [...defaults];
    }
    
    // 创建已加载配置的映射
    const loadedMap = new Map(loaded.map(c => [c.id, c]));
    
    // 合并配置：优先使用已加载的，补充缺失的默认配置
    const result: import('./settings/settings').ToolbarButtonConfig[] = [];
    
    // 先添加已加载的配置（保持用户顺序）
    for (const config of loaded) {
      result.push(config);
    }
    
    // 添加缺失的默认配置（新按钮）
    for (const defaultConfig of defaults) {
      if (!loadedMap.has(defaultConfig.id)) {
        result.push({
          ...defaultConfig,
          order: result.length // 放到最后
        });
      }
    }
    
    return result;
  }

  /**
   * 验证功能绑定配置（延迟验证，在首次使用 AI 功能时调用）
   * @returns 配置是否有效
   */
  validateFeatureBindings(): boolean {
    const namingBinding = this.settings.featureBindings.naming;
    if (!namingBinding) return true;
    
    const provider = this.settings.providers.find(p => p.id === namingBinding.providerId);
    if (!provider) {
      debugLog(`[Settings] naming 绑定的供应商 "${namingBinding.providerId}" 不存在，清除绑定`);
      delete this.settings.featureBindings.naming;
      return false;
    }
    
    if (provider.models.length > 0) {
      const model = provider.models.find(m => m.id === namingBinding.modelId);
      if (!model) {
        debugLog(`[Settings] naming 绑定的模型 "${namingBinding.modelId}" 不存在，使用第一个模型`);
        this.settings.featureBindings.naming = {
          ...namingBinding,
          modelId: provider.models[0].id
        };
        return false;
      }
    }
    
    return true;
  }

  /**
   * 保存设置
   */
  async saveSettings() {
    await this.saveData(this.settings);
    
    // 更新调试模式
    setDebugMode(this.settings.debugMode);
    
    // 更新终端服务的设置（仅当已初始化时）
    if (this._terminalService) {
      this._terminalService.updateSettings(this.settings.terminal);
    }
    
    // 更新选中工具栏的设置（仅当已初始化时）
    if (this._selectionToolbarManager) {
      this._selectionToolbarManager.updateSettings(this.settings.selectionToolbar, this.settings);
    }

    // 更新语音输入服务的设置（仅当已初始化时）
    if (this._voiceInputService) {
      this._voiceInputService.updateSettings(this.settings.voice);
    }

    // 更新 LLM 后处理器的设置（仅当已初始化时）
    if (this._llmPostProcessor) {
      this._llmPostProcessor.updateSettings(this.settings);
    }

    // 更新 AI 助手处理器的设置（仅当已初始化时）
    if (this._assistantProcessor) {
      this._assistantProcessor.updateSettings(this.settings);
    }

    // 更新语音悬浮窗的配置（仅当已初始化时）
    if (this._voiceOverlay) {
      this._voiceOverlay.updateConfig({
        position: this.settings.voice.overlayPosition,
      });
    }

    // 更新服务器连接配置（仅当已初始化时）
    if (this._serverManager) {
      const { maxReconnectAttempts, reconnectInterval } = this.settings.serverConnection;
      this._serverManager.updateConnectionConfig({
        maxAttempts: maxReconnectAttempts,
        interval: reconnectInterval,
      });
    }

    // 重置标签、分类、归档相关服务实例，使其在下次使用时重新初始化以应用新设置
    // 这些服务依赖 settings 对象，需要在设置变更后重新创建
    this._tagService = null;
    this._categoryService = null;
    this._archiveService = null;
    this._autoArchiveService = null;
  }

  /**
   * 更新选中工具栏设置
   * 供设置面板调用，实现设置实时生效

   */
  updateSelectionToolbarSettings(): void {
    if (this._selectionToolbarManager) {
      this._selectionToolbarManager.updateSettings(this.settings.selectionToolbar, this.settings);
    }
  }

  /**
   * 检查终端功能是否启用
   * 移动端默认关闭，桌面端根据设置决定
   */
  isTerminalEnabled(): boolean {
    // 移动端始终禁用终端
    if (Platform.isMobile) {
      return false;
    }
    // 桌面端根据设置决定
    return this.settings.featureVisibility.terminal.enabled;
  }

  /**
   * 更新功能显示设置
   * 供设置面板调用，实现 Ribbon 图标的实时显示/隐藏
   */
  updateFeatureVisibility(): void {
    // 更新 AI 文件名生成 Ribbon 图标
    if (this.settings.featureVisibility.aiNaming.showInRibbon) {
      if (!this.aiNamingRibbonIcon) {
        this.aiNamingRibbonIcon = this.addRibbonIcon('sparkles', t('ribbon.aiFilenameTooltip'), async () => {
          await this.handleGenerateCommand();
        });
      }
    } else {
      if (this.aiNamingRibbonIcon) {
        this.aiNamingRibbonIcon.remove();
        this.aiNamingRibbonIcon = null;
      }
    }

    // 更新终端 Ribbon 图标（仅桌面端）
    if (this.isTerminalEnabled() && this.settings.featureVisibility.terminal.showInRibbon) {
      if (!this.terminalRibbonIcon) {
        this.terminalRibbonIcon = this.addRibbonIcon('terminal-square', t('ribbon.terminalTooltip'), async () => {
          await this.activateTerminalView();
        });
      }
    } else {
      if (this.terminalRibbonIcon) {
        this.terminalRibbonIcon.remove();
        this.terminalRibbonIcon = null;
      }
    }
  }

  /**
   * 插件卸载时调用
   */
  async onunload() {
    debugLog(t('plugin.unloadingMessage'));

    // 销毁选中文字浮动工具栏（仅当已初始化时）
    if (this._selectionToolbarManager) {
      try {
        this._selectionToolbarManager.destroy();
      } catch (error) {
        errorLog('销毁选中工具栏失败:', error);
      }
    }

    // 清理语音输入相关资源（仅当已初始化时）
    if (this._voiceOverlay) {
      try {
        this._voiceOverlay.destroy();
      } catch (error) {
        errorLog('销毁语音悬浮窗失败:', error);
      }
    }

    if (this._voiceInputService) {
      try {
        await this._voiceInputService.destroy();
      } catch (error) {
        errorLog('销毁语音输入服务失败:', error);
      }
    }

    // 注意：VoiceInputService 直接使用 ServerManager，
    // _serverManager.shutdown() 会统一关闭服务器

    // 清理自动归档相关资源（仅当已初始化时）
    if (this._autoArchiveService) {
      try {
        this._autoArchiveService.cleanup();
      } catch (error) {
        errorLog('清理自动归档服务失败:', error);
      }
    }

    // 清理终端相关资源（仅当已初始化时）
    if (this._terminalService) {
      try {
        await this._terminalService.shutdown();
      } catch (error) {
        errorLog('清理终端失败:', error);
      }
    }

    // 关闭统一服务器（仅当已初始化时）
    // 这会关闭所有模块（PTY、Voice、LLM、Utils）
    if (this._serverManager) {
      try {
        await this._serverManager.shutdown();
      } catch (error) {
        errorLog('关闭服务器失败:', error);
      }
    }
  }

  // ========================================================================
  // 语音输入 - 按住模式辅助方法
  // ========================================================================

  /**
   * 获取命令的快捷键配置
   */
  private getCommandHotkey(commandId: string): { modifiers: string[]; key: string } | null {
    const fullCommandId = `obsidian-smart-workflow:${commandId}`;
    
    try {
      // @ts-expect-error - 访问 Obsidian 内部 API
      const hotkeyManager = this.app.hotkeyManager;
      
      if (!hotkeyManager) {
        return null;
      }
      
      const hotkeys = hotkeyManager.getHotkeys(fullCommandId);
      
      if (hotkeys && hotkeys.length > 0) {
        return hotkeys[0];
      }
    } catch (e) {
      errorLog('[VoiceInput] 获取快捷键失败:', e);
    }
    
    return null;
  }

  /**
   * 设置按住模式的 keyup 监听器
   * 当用户松开快捷键时自动停止录音
   */
  private setupPressModeListener(commandId: string): void {
    // 移除之前的监听器
    this.removePressModeListener();
    
    const hotkey = this.getCommandHotkey(commandId);
    if (!hotkey) {
      debugLog('[VoiceInput] 未找到快捷键配置，使用 toggle 模式行为');
      return;
    }
    
    this.currentVoiceCommandId = commandId;
    
    // 创建 keyup 处理器
    this.pressModekeyupHandler = (e: KeyboardEvent) => {
      // 检查是否是快捷键的主键松开
      const releasedKey = e.key.toLowerCase();
      const hotkeyKey = hotkey.key.toLowerCase();
      
      // 标准化按键名称
      const normalizedReleasedKey = this.normalizeKeyName(releasedKey);
      const normalizedHotkeyKey = this.normalizeKeyName(hotkeyKey);
      
      if (normalizedReleasedKey === normalizedHotkeyKey) {
        debugLog('[VoiceInput] 检测到快捷键松开，停止录音');
        this.removePressModeListener();
        this.finishVoiceRecording();
      }
    };
    
    // 添加全局 keyup 监听
    document.addEventListener('keyup', this.pressModekeyupHandler);
    debugLog('[VoiceInput] 已设置按住模式监听器，等待松开:', hotkey.key);
  }

  /**
   * 移除按住模式的 keyup 监听器
   */
  private removePressModeListener(): void {
    if (this.pressModekeyupHandler) {
      document.removeEventListener('keyup', this.pressModekeyupHandler);
      this.pressModekeyupHandler = null;
      this.currentVoiceCommandId = null;
      debugLog('[VoiceInput] 已移除按住模式监听器');
    }
  }

  /**
   * 移除文本末尾的标点符号
   * 支持中英文常见标点
   */
  private removeTrailingPunctuation(text: string): string {
    if (!text) return text;
    
    // 中英文常见末尾标点符号
    // 包括：句号、问号、感叹号、逗号、分号、冒号、省略号等
    const trailingPunctuationRegex = /[。？！，、；：…．.?!,;:]+$/;
    
    return text.replace(trailingPunctuationRegex, '');
  }

  /**
   * 标准化按键名称
   */
  private normalizeKeyName(key: string): string {
    // 处理常见的按键名称差异
    const keyMap: Record<string, string> = {
      'control': 'ctrl',
      'meta': 'mod',
      'command': 'mod',
      ' ': 'space',
      'arrowup': 'up',
      'arrowdown': 'down',
      'arrowleft': 'left',
      'arrowright': 'right',
    };
    
    const normalized = key.toLowerCase();
    return keyMap[normalized] || normalized;
  }

  // ========================================================================
  // 语音输入处理方法
  // ========================================================================

  /**
   * 处理语音听写命令
   * 开始录音 → ASR 转录 → LLM 后处理（可选）→ 插入文本
   */
  private async handleVoiceDictation(): Promise<void> {
    try {
      // 检查是否有活动编辑器
      if (!this.voiceInputService.hasActiveEditor()) {
        NoticeHelper.error(t('voiceInput.noActiveEditor'));
        return;
      }

      // 初始化服务（如果需要）
      await this.voiceInputService.initialize();

      // 设置悬浮窗事件
      this.setupVoiceOverlayEvents();

      // 显示录音状态
      this.voiceOverlay.show({
        type: 'recording',
        mode: this.settings.voice.defaultRecordingMode,
      });

      // 开始听写
      await this.voiceInputService.startDictation();

      // 根据录音模式设置不同的行为
      if (this.settings.voice.defaultRecordingMode === 'press') {
        // press 模式：设置 keyup 监听器，松开快捷键时自动停止
        this.setupPressModeListener('voice-dictation');
      }
      // toggle 模式：悬浮窗显示取消/完成按钮，由用户控制

    } catch (error) {
      this.removePressModeListener();
      this.voiceOverlay.hide();
      const message = error instanceof Error ? error.message : String(error);
      NoticeHelper.error(message);
      errorLog('[VoiceDictation] 错误:', error);
    }
  }

  /**
   * 处理语音助手命令
   * 开始录音 → ASR 转录 → LLM 处理（Q&A 或文本处理）→ 插入/替换文本
   */
  private async handleVoiceAssistant(): Promise<void> {
    try {
      // 检查是否有活动编辑器
      if (!this.voiceInputService.hasActiveEditor()) {
        NoticeHelper.error(t('voiceInput.noActiveEditor'));
        return;
      }

      // 初始化服务（如果需要）
      await this.voiceInputService.initialize();

      // 设置悬浮窗事件
      this.setupVoiceOverlayEvents();

      // 获取选中的文本（如果有）
      const selectedText = this.voiceInputService.getSelectedText();

      // 显示录音状态
      this.voiceOverlay.show({
        type: 'recording',
        mode: this.settings.voice.defaultRecordingMode,
      });

      // 开始助手模式
      await this.voiceInputService.startAssistant(selectedText ?? undefined);

      // 根据录音模式设置不同的行为
      if (this.settings.voice.defaultRecordingMode === 'press') {
        // press 模式：设置 keyup 监听器，松开快捷键时自动停止
        this.setupPressModeListener('voice-assistant');
      }
      // toggle 模式：悬浮窗显示取消/完成按钮，由用户控制

    } catch (error) {
      this.removePressModeListener();
      this.voiceOverlay.hide();
      const message = error instanceof Error ? error.message : String(error);
      NoticeHelper.error(message);
      errorLog('[VoiceAssistant] 错误:', error);
    }
  }

  /**
   * 取消当前录音
   */
  private cancelVoiceRecording(): void {
    this.removePressModeListener();
    if (this._voiceInputService?.isRecording()) {
      this._voiceInputService.cancelRecording();
      this.voiceOverlay.hide();
      debugLog('[VoiceInput] 录音已取消');
    }
  }

  /**
   * 设置语音悬浮窗事件绑定
   * 连接悬浮窗按钮到 VoiceInputService
   */
  private setupVoiceOverlayEvents(): void {
    // 取消按钮
    this.voiceOverlay.setOnCancel(() => {
      this.cancelVoiceRecording();
    });

    // 完成按钮（toggle 模式）
    this.voiceOverlay.setOnFinish(async () => {
      await this.finishVoiceRecording();
    });

    // 监听服务事件
    this.voiceInputService.on('audio-level', (level, waveform) => {
      if (waveform) {
        this.voiceOverlay.updateWaveform(waveform);
      }
    });

    // 监听部分转录结果（实时模式）
    this.voiceInputService.on('transcription-progress', (partialText) => {
      this.voiceOverlay.updatePartialText(partialText);
    });

    this.voiceInputService.on('recording-stop', () => {
      this.voiceOverlay.updateState({ type: 'processing' });
    });

    this.voiceInputService.on('transcription-complete', async (text) => {
      await this.handleTranscriptionComplete(text);
    });

    this.voiceInputService.on('error', (error) => {
      this.voiceOverlay.updateState({
        type: 'error',
        message: error.message,
      });
    });
  }

  /**
   * 完成录音并处理结果
   */
  private async finishVoiceRecording(): Promise<void> {
    // 移除按住模式监听器
    this.removePressModeListener();
    
    const mode = this.voiceInputService.getRecordingMode();
    
    try {
      this.voiceOverlay.updateState({ type: 'processing' });

      if (mode === 'dictation') {
        // 听写模式：执行完整流程
        const result = await this.voiceInputService.executeDictationFlow();
        
        // 插入文本
        const success = await this.textInserter.insertAtCursor(result.processedText);
        
        if (success) {
          this.voiceOverlay.updateState({
            type: 'success',
            message: t('voiceInput.textInserted'),
          });
        }
        
        // 保存历史记录（仅当有实际内容时，无论插入是否成功）
        if (result.originalText.trim()) {
          const finalText = result.usedLLMProcessing ? result.processedText : result.originalText;
          await this.historyManager.save({
            timestamp: Date.now(),
            mode: 'dictation',
            originalText: result.originalText,
            processedText: result.usedLLMProcessing ? result.processedText : undefined,
            asrEngine: result.asrEngine,
            usedFallback: result.usedFallback,
            duration: result.duration,
            asrDuration: result.asrDuration,
            llmDuration: result.llmDuration,
            charCount: finalText.length,
          });
        }
      } else if (mode === 'assistant') {
        // 助手模式：执行完整流程，使用 AssistantProcessor
        const result = await this.voiceInputService.executeAssistantFlow(this.assistantProcessor);
        
        if (result.response) {
          // 如果启用了移除末尾标点，在最终输出前处理
          let finalResponse = result.response;
          if (this.settings.voice.removeTrailingPunctuation) {
            finalResponse = this.removeTrailingPunctuation(finalResponse);
          }
          
          let success = false;
          
          if (result.mode === 'text_processing' && result.selectedText) {
            // 替换选中文本
            success = await this.textInserter.replaceSelection(finalResponse);
          } else {
            // 插入响应
            success = await this.textInserter.insertAtCursor(finalResponse);
          }
          
          if (success) {
            this.voiceOverlay.updateState({
              type: 'success',
              message: result.mode === 'text_processing' 
                ? t('voiceInput.textReplaced') 
                : t('voiceInput.textInserted'),
            });
          }
          
          // 保存历史记录（仅当有实际内容时，无论插入是否成功）
          if (result.voiceCommand.trim()) {
            await this.historyManager.save({
              timestamp: Date.now(),
              mode: 'assistant',
              originalText: result.voiceCommand,
              processedText: result.response,
              asrEngine: result.asrEngine,
              usedFallback: result.usedFallback,
              duration: result.duration,
              asrDuration: result.asrDuration,
              llmDuration: result.llmDuration,
              charCount: result.response.length,
            });
          }
        } else {
          // 语音命令为空或 LLM 未启用，显示提示并隐藏悬浮窗
          this.voiceOverlay.updateState({
            type: 'error',
            message: t('voiceInput.emptyVoiceCommand') || '未检测到语音命令',
          });
        }
      }
    } catch (error) {
      // 使用 VoiceErrorHandler 处理错误
      if (isLLMProcessingError(error)) {
        // LLM 处理失败，显示回退选项对话框
        debugLog('[VoiceInput] LLM 处理失败，显示回退选项');
        this.voiceOverlay.hide();
        
        const handleResult = await this.voiceErrorHandler.handleError(error);
        
        if (handleResult.action === 'use_raw_text' && handleResult.rawText) {
          // 用户选择使用原始文本
          const success = await this.textInserter.insertAtCursor(handleResult.rawText);
          if (success) {
            this.voiceErrorHandler.showSuccessNotice(t('voiceInput.textInserted'));
          }
        } else if (handleResult.action === 'retry') {
          // 用户选择重试 - 这里可以重新触发录音流程
          // 目前简单地显示提示，让用户手动重试
          this.voiceErrorHandler.showWarningNotice(
            t('voiceError.llmFailed.hint') || '请重新开始录音'
          );
        }
        // 如果是 cancel，不做任何操作
      } else {
        // 其他错误，使用 VoiceErrorHandler 显示错误通知
        const handleResult = await this.voiceErrorHandler.handleError(error as Error);
        
        if (!handleResult.handled) {
          // 如果错误处理器没有处理，显示在悬浮窗
          const message = error instanceof Error ? error.message : String(error);
          this.voiceOverlay.updateState({
            type: 'error',
            message,
          });
        } else {
          // 错误已处理，隐藏悬浮窗
          this.voiceOverlay.hide();
        }
        
        errorLog('[VoiceInput] 处理失败:', error);
      }
    }
  }

  /**
   * 处理转录完成事件
   */
  private async handleTranscriptionComplete(text: string): Promise<void> {
    debugLog('[VoiceInput] 转录完成:', text);
    // 转录完成后的处理由 finishVoiceRecording 统一处理
  }

  /**
   * 获取插件目录的绝对路径
   * 仅桌面端可用
   * 
   * @returns 插件目录的绝对路径
   */
  private getPluginDir(): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = this.app.vault.adapter as any;
    const vaultPath = adapter.getBasePath();
    
    const manifestDir = this.manifest.dir || `.obsidian/plugins/${this.manifest.id}`;
    
    // 使用简单的路径拼接，避免依赖 Node.js path 模块
    const separator = vaultPath.includes('\\') ? '\\' : '/';
    return `${vaultPath}${separator}${manifestDir.replace(/\//g, separator)}`;
  }

  /**
   * 注册终端视图（使用动态导入）
   */
  private registerTerminalView(): void {
    this.registerView(
      TERMINAL_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => {
        // 创建一个占位视图，实际初始化在 onOpen 时进行
        const view = new TerminalViewWrapper(leaf, this);
        return view;
      }
    );
  }

  /**
   * 注册聊天视图（使用动态导入）
   */
  private registerChatView(): void {
    this.registerView(
      CHAT_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => {
        const view = new ChatViewWrapper(leaf, this);
        return view;
      }
    );
  }

  /**
   * 激活终端视图
   */
  async activateTerminalView(): Promise<void> {
    const { workspace } = this.app;
    const leaf = this.getLeafForNewTerminal();

    // 如果启用锁定新实例，设置标签页为锁定状态
    if (this.settings.terminal.lockNewInstance) {
      leaf.setPinned(true);
    }

    await leaf.setViewState({
      type: TERMINAL_VIEW_TYPE,
      active: this.settings.terminal.focusNewInstance,
    });

    // 如果启用聚焦新实例，切换到新标签页
    if (this.settings.terminal.focusNewInstance) {
      workspace.setActiveLeaf(leaf, { focus: true });
    }
  }

  /**
   * 激活聊天视图
   */
  async activateChatView(): Promise<void> {
    const { workspace } = this.app;
    
    // Check if already open
    let leaf = workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];
    
    if (!leaf) {
      // Create new leaf (right split by default)
      const rightLeaf = workspace.getRightLeaf(false);
      leaf = rightLeaf ?? workspace.getLeaf('split', 'vertical');
      
      await leaf.setViewState({
        type: CHAT_VIEW_TYPE,
        active: true,
      });
    }

    workspace.revealLeaf(leaf);
  }

  /**
   * 获取当前活动的终端视图
   */
  private getActiveTerminalView(): TerminalViewWrapper | null {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf?.view?.getViewType() === TERMINAL_VIEW_TYPE) {
      return activeLeaf.view as TerminalViewWrapper;
    }
    return null;
  }

  /**
   * 拆分终端
   */
  private async splitTerminal(direction: 'horizontal' | 'vertical'): Promise<void> {
    const { workspace } = this.app;
    const newLeaf = workspace.getLeaf('split', direction);
    
    await newLeaf.setViewState({
      type: TERMINAL_VIEW_TYPE,
      active: true,
    });

    workspace.setActiveLeaf(newLeaf, { focus: true });
  }

  /**
   * 注册新标签页中的"打开终端"选项
   * 通过监听 layout-change 事件，在空标签页中注入自定义按钮
   */
  private registerNewTabTerminalAction(): void {
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        this.injectTerminalButtonToEmptyViews();
      })
    );

    // 初始注入
    this.injectTerminalButtonToEmptyViews();
  }

  /**
   * 向所有空标签页注入"打开终端"按钮
   */
  private injectTerminalButtonToEmptyViews(): void {
    const emptyViews = document.querySelectorAll('.empty-state');
    
    emptyViews.forEach((emptyView) => {
      // 检查是否已经注入过
      if (emptyView.querySelector('.smart-workflow-terminal-action')) {
        return;
      }

      // 查找操作容器
      const actionsContainer = emptyView.querySelector('.empty-state-action-list');
      if (!actionsContainer) {
        return;
      }

      // 创建"打开终端"按钮
      const terminalAction = document.createElement('div');
      terminalAction.className = 'empty-state-action smart-workflow-terminal-action';
      terminalAction.textContent = t('commands.openTerminal') + ' (Ctrl+O)';
      terminalAction.addEventListener('click', async () => {
        await this.activateTerminalView();
      });

      // 添加到操作列表
      actionsContainer.appendChild(terminalAction);
    });
  }

  /**
   * 根据配置获取新终端的 WorkspaceLeaf
   */
  private getLeafForNewTerminal(): WorkspaceLeaf {
    const { workspace } = this.app;
    const { leftSplit, rightSplit } = workspace;
    const { terminal: settings } = this.settings;

    // 如果启用"在现有终端附近创建"
    if (settings.createInstanceNearExistingOnes) {
      const existingLeaves = workspace.getLeavesOfType(TERMINAL_VIEW_TYPE);
      const existingLeaf = existingLeaves[existingLeaves.length - 1];

      if (existingLeaf) {
        const root = existingLeaf.getRoot();

        // 如果在左侧栏，继续在左侧栏创建
        if (root === leftSplit) {
          const leftLeaf = workspace.getLeftLeaf(false);
          if (leftLeaf) return leftLeaf;
        }

        // 如果在右侧栏，继续在右侧栏创建
        if (root === rightSplit) {
          const rightLeaf = workspace.getRightLeaf(false);
          if (rightLeaf) return rightLeaf;
        }

        // 如果在主区域，设置为活动 leaf 并创建新标签页
        workspace.setActiveLeaf(existingLeaf);
        return workspace.getLeaf('tab');
      }
    }

    // 根据 newInstanceBehavior 创建新的 leaf
    switch (settings.newInstanceBehavior) {
      case 'replaceTab':
        // 替换当前标签页
        return workspace.getLeaf();

      case 'newTab':
        // 新标签页：在当前标签组中创建新标签页
        return workspace.getLeaf('tab');

      case 'newLeftTab': {
        // 左侧新标签页
        const leftLeaf = workspace.getLeftLeaf(false);
        return leftLeaf ?? workspace.getLeaf('split');
      }

      case 'newLeftSplit': {
        // 左侧新分屏
        const leftLeaf = workspace.getLeftLeaf(true);
        return leftLeaf ?? workspace.getLeaf('split');
      }

      case 'newRightTab': {
        // 右侧新标签页
        const rightLeaf = workspace.getRightLeaf(false);
        return rightLeaf ?? workspace.getLeaf('split');
      }

      case 'newRightSplit': {
        // 右侧新分屏
        const rightLeaf = workspace.getRightLeaf(true);
        return rightLeaf ?? workspace.getLeaf('split');
      }

      case 'newHorizontalSplit':
        // 水平分屏：在右侧创建分屏
        return workspace.getLeaf('split', 'horizontal');

      case 'newVerticalSplit':
        // 垂直分屏：在下方创建分屏
        return workspace.getLeaf('split', 'vertical');

      case 'newWindow':
        // 新窗口：在新窗口中打开
        return workspace.getLeaf('window');

      default:
        // 默认：水平分屏
        return workspace.getLeaf('split', 'vertical');
    }
  }
}

/**
 * 终端视图包装器
 * 使用动态导入延迟加载终端模块，避免移动端加载 Node.js 依赖
 */
import { ItemView, WorkspaceLeaf as WL } from 'obsidian';

class TerminalViewWrapper extends ItemView {
  private plugin: SmartWorkflowPlugin;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private realView: any = null;
  private initialized = false;

  constructor(leaf: WL, plugin: SmartWorkflowPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return TERMINAL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.realView?.getDisplayText() ?? 'Terminal';
  }

  getIcon(): string {
    return 'terminal-square';
  }

  async onOpen(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      // 动态导入终端模块
      const [terminalViewModule, terminalService] = await Promise.all([
        import('./ui/terminal/terminalView'),
        this.plugin.getTerminalService()
      ]);

      // 创建真实的终端视图
      const { TerminalView: RealTerminalView } = terminalViewModule;
      this.realView = new RealTerminalView(this.leaf, terminalService);
      
      // 将真实视图的内容挂载到当前容器
      this.contentEl.empty();
      await this.realView.onOpen();
      
      // 移动内容
      if (this.realView.containerEl) {
        while (this.realView.contentEl.firstChild) {
          this.contentEl.appendChild(this.realView.contentEl.firstChild);
        }
      }
    } catch (error) {
      errorLog('[TerminalViewWrapper] Failed to initialize:', error);
      this.contentEl.createEl('div', { 
        text: 'Failed to load terminal. This feature is only available on desktop.',
        cls: 'terminal-error'
      });
    }
  }

  async onClose(): Promise<void> {
    if (this.realView) {
      await this.realView.onClose();
    }
  }

  getTerminalInstance() {
    return this.realView?.getTerminalInstance?.() ?? null;
  }
}

/**
 * 聊天视图包装器
 */
class ChatViewWrapper extends ItemView {
  private plugin: SmartWorkflowPlugin;
  private realView: ChatView | null = null;
  private initialized = false;

  constructor(leaf: WL, plugin: SmartWorkflowPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Smart Chat';
  }

  getIcon(): string {
    return 'message-circle';
  }

  async onOpen(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const [chatService, voiceInputService] = await Promise.all([
        this.plugin.getChatService(),
        this.plugin.getVoiceInputService().catch(() => null) // 语音服务可选
      ]);

      // 清空并创建真实的聊天视图（不继承 ItemView）
      this.contentEl.empty();
      this.realView = new ChatView(
        this.app,
        this.contentEl,
        chatService,
        voiceInputService as VoiceInputService
      );
      await this.realView.render();
    } catch (error) {
      errorLog('[ChatViewWrapper] Failed to initialize:', error);
      this.contentEl.createEl('div', { 
        text: 'Failed to load chat. This feature is only available on desktop.',
        cls: 'chat-error'
      });
    }
  }

  async onClose(): Promise<void> {
    if (this.realView) {
      await this.realView.destroy();
      this.realView = null;
    }
  }
}
