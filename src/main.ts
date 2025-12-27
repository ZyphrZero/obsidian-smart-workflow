import { Plugin, TFile, Menu, MarkdownView, WorkspaceLeaf, Modal, Setting } from 'obsidian';
import { SmartWorkflowSettings, DEFAULT_SETTINGS } from './settings/settings';
import { SmartWorkflowSettingTab } from './settings/settingsTab';
import { AIService } from './services/naming/aiService';
import { FileNameService } from './services/naming/fileNameService';
import { NoticeHelper } from './ui/noticeHelper';
import { TerminalService } from './services/terminal/terminalService';
import { TerminalView, TERMINAL_VIEW_TYPE } from './ui/terminal/terminalView';
import { SelectionToolbarManager } from './ui/selection';
import { setDebugMode, debugLog, errorLog } from './utils/logger';
import { i18n, t } from './i18n';
import * as path from 'path';

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
  aiService: AIService;
  fileNameService: FileNameService;
  terminalService: TerminalService;
  selectionToolbarManager: SelectionToolbarManager;
  generatingFiles: Set<string> = new Set();


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

    // 初始化服务
    this.aiService = new AIService(this.app, this.settings, () => this.saveSettings());
    this.fileNameService = new FileNameService(
      this.app,
      this.aiService,
      this.settings
    );
    
    // 初始化终端服务（使用 Rust PTY 服务器架构）
    const pluginDir = this.getPluginDir();
    this.terminalService = new TerminalService(this.app, this.settings.terminal, pluginDir);

    // 初始化选中文字浮动工具栏
    this.selectionToolbarManager = new SelectionToolbarManager(
      this.app,
      this.settings.selectionToolbar
    );
    this.selectionToolbarManager.initialize();

    // 注册终端视图
    this.registerView(
      TERMINAL_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new TerminalView(leaf, this.terminalService)
    );

    // 添加侧边栏图标按钮 - AI 文件名生成
    if (this.settings.featureVisibility.aiNaming.showInRibbon) {
      this.addRibbonIcon('sparkles', t('ribbon.aiFilenameTooltip'), async () => {
        await this.handleGenerateCommand();
      });
    }

    // 添加侧边栏图标按钮 - 打开终端
    if (this.settings.featureVisibility.terminal.showInRibbon) {
      this.addRibbonIcon('terminal-square', t('ribbon.terminalTooltip'), async () => {
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

    // 添加打开终端命令
    if (this.settings.featureVisibility.terminal.showInCommandPalette) {
      this.addCommand({
        id: 'open-terminal',
        name: t('commands.openTerminal'),
        hotkeys: [{ modifiers: ['Ctrl'], key: 'o' }],
        callback: async () => {
          await this.activateTerminalView();
        }
      });
    }

    // 终端快捷键命令
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
              if (text) terminal.sendMessage(text);
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

    // 添加编辑器右键菜单
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

    // 添加设置标签页
    this.addSettingTab(new SmartWorkflowSettingTab(this.app, this));

    // 监听文件切换，清理不属于当前文件的动画效果
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.cleanupTitleAnimations();
      })
    );

    // 注册新标签页中的"打开终端"选项
    if (this.settings.featureVisibility.terminal.showInNewTab) {
      this.registerNewTabTerminalAction();
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
   * 实现深度合并逻辑，确保新字段有默认值，处理无效配置回退
   */
  async loadSettings() {
    let loadedData: Partial<SmartWorkflowSettings> | null = null;
    let needsSave = false;

    try {
      loadedData = await this.loadData();
    } catch (error) {
      // JSON 解析失败，使用默认配置
      errorLog('[Settings] 配置数据解析失败，使用默认配置:', error);
      loadedData = null;
    }

    // 初始化为默认设置的浅拷贝
    this.settings = { ...DEFAULT_SETTINGS };

    if (loadedData) {
      // 深度合并加载的数据
      this.settings = this.deepMergeSettings(DEFAULT_SETTINGS, loadedData);
      
      // 验证并修复供应商配置
      const providersValid = this.validateAndFixProviders();
      if (!providersValid) {
        needsSave = true;
      }

      // 验证并修复功能绑定配置
      const bindingsValid = this.validateAndFixFeatureBindings();
      if (!bindingsValid) {
        needsSave = true;
      }
    }

    // 确保终端设置完整（深度合并）
    if (!this.settings.terminal) {
      this.settings.terminal = { ...DEFAULT_SETTINGS.terminal };
      needsSave = true;
    } else {
      // 合并终端设置，确保所有字段都存在
      this.settings.terminal = {
        ...DEFAULT_SETTINGS.terminal,
        ...this.settings.terminal,
        platformShells: {
          ...DEFAULT_SETTINGS.terminal.platformShells,
          ...(this.settings.terminal.platformShells || {})
        },
        platformCustomShellPaths: {
          ...DEFAULT_SETTINGS.terminal.platformCustomShellPaths,
          ...(this.settings.terminal.platformCustomShellPaths || {})
        }
      };
    }

    // 确保功能显示设置完整（深度合并）
    if (!this.settings.featureVisibility) {
      this.settings.featureVisibility = { ...DEFAULT_SETTINGS.featureVisibility };
      needsSave = true;
    } else {
      // 合并功能显示设置，确保所有字段都存在
      this.settings.featureVisibility = {
        aiNaming: {
          ...DEFAULT_SETTINGS.featureVisibility.aiNaming,
          ...(this.settings.featureVisibility.aiNaming || {})
        },
        terminal: {
          ...DEFAULT_SETTINGS.featureVisibility.terminal,
          ...(this.settings.featureVisibility.terminal || {})
        }
      };
    }

    // 确保选中工具栏设置完整（深度合并）
    if (!this.settings.selectionToolbar) {
      this.settings.selectionToolbar = { ...DEFAULT_SETTINGS.selectionToolbar };
      needsSave = true;
    } else {
      // 合并选中工具栏设置，确保所有字段都存在
      this.settings.selectionToolbar = {
        ...DEFAULT_SETTINGS.selectionToolbar,
        ...this.settings.selectionToolbar,
        actions: {
          ...DEFAULT_SETTINGS.selectionToolbar.actions,
          ...(this.settings.selectionToolbar.actions || {})
        }
      };
    }

    // 如果 defaultPromptTemplate 为空，使用代码中的默认值
    if (!this.settings.defaultPromptTemplate || this.settings.defaultPromptTemplate.trim() === '') {
      this.settings.defaultPromptTemplate = DEFAULT_SETTINGS.defaultPromptTemplate;
      needsSave = true;
    }

    // 保存修复后的配置
    if (loadedData && needsSave) {
      await this.saveSettings();
    }
  }

  /**
   * 深度合并设置对象
   * @param defaults 默认设置
   * @param loaded 加载的设置
   * @returns 合并后的设置
   */
  private deepMergeSettings(
    defaults: SmartWorkflowSettings,
    loaded: Partial<SmartWorkflowSettings>
  ): SmartWorkflowSettings {
    const result = { ...defaults };

    // 合并基本类型字段
    if (typeof loaded.defaultPromptTemplate === 'string') {
      result.defaultPromptTemplate = loaded.defaultPromptTemplate;
    }
    if (typeof loaded.useCurrentFileNameContext === 'boolean') {
      result.useCurrentFileNameContext = loaded.useCurrentFileNameContext;
    }
    if (typeof loaded.analyzeDirectoryNamingStyle === 'boolean') {
      result.analyzeDirectoryNamingStyle = loaded.analyzeDirectoryNamingStyle;
    }
    if (typeof loaded.timeout === 'number' && loaded.timeout > 0) {
      result.timeout = loaded.timeout;
    }
    if (typeof loaded.debugMode === 'boolean') {
      result.debugMode = loaded.debugMode;
    }

    // 合并供应商配置
    if (Array.isArray(loaded.providers) && loaded.providers.length > 0) {
      result.providers = this.mergeProviders(defaults.providers, loaded.providers);
    }

    // 合并功能绑定配置
    if (loaded.featureBindings && typeof loaded.featureBindings === 'object') {
      result.featureBindings = this.mergeFeatureBindings(
        defaults.featureBindings,
        loaded.featureBindings
      );
    }

    // 合并终端设置
    if (loaded.terminal && typeof loaded.terminal === 'object') {
      result.terminal = {
        ...defaults.terminal,
        ...loaded.terminal,
        platformShells: {
          ...defaults.terminal.platformShells,
          ...(loaded.terminal.platformShells || {})
        },
        platformCustomShellPaths: {
          ...defaults.terminal.platformCustomShellPaths,
          ...(loaded.terminal.platformCustomShellPaths || {})
        }
      };
    }

    // 合并功能显示设置
    if (loaded.featureVisibility && typeof loaded.featureVisibility === 'object') {
      result.featureVisibility = {
        aiNaming: {
          ...defaults.featureVisibility.aiNaming,
          ...(loaded.featureVisibility.aiNaming || {})
        },
        terminal: {
          ...defaults.featureVisibility.terminal,
          ...(loaded.featureVisibility.terminal || {})
        }
      };
    }

    // 合并选中工具栏设置
    if (loaded.selectionToolbar && typeof loaded.selectionToolbar === 'object') {
      result.selectionToolbar = {
        ...defaults.selectionToolbar,
        ...loaded.selectionToolbar,
        actions: {
          ...defaults.selectionToolbar.actions,
          ...(loaded.selectionToolbar.actions || {})
        }
      };
    }

    return result;
  }

  /**
   * 合并供应商配置
   * @param defaults 默认供应商列表
   * @param loaded 加载的供应商列表
   * @returns 合并后的供应商列表
   */
  private mergeProviders(
    defaults: import('./settings/settings').Provider[],
    loaded: import('./settings/settings').Provider[]
  ): import('./settings/settings').Provider[] {
    // 验证每个供应商的结构
    const validProviders = loaded.filter(provider => {
      if (!provider || typeof provider !== 'object') return false;
      if (!provider.id || typeof provider.id !== 'string') return false;
      if (!provider.name || typeof provider.name !== 'string') return false;
      if (!provider.endpoint || typeof provider.endpoint !== 'string') return false;
      if (typeof provider.apiKey !== 'string') return false;
      return true;
    }).map(provider => {
      // 确保每个供应商的 models 数组有效
      const models = Array.isArray(provider.models) 
        ? provider.models.filter(model => this.isValidModelConfig(model))
        : [];
      
      return {
        ...provider,
        models // 保留有效的模型，即使为空数组
      };
    });

    // 如果没有有效的供应商，返回默认值
    if (validProviders.length === 0) {
      debugLog('[Settings] 没有有效的供应商配置，使用默认值');
      return [...defaults];
    }

    return validProviders;
  }

  /**
   * 验证模型配置是否有效
   * @param model 模型配置
   * @returns 是否有效
   */
  private isValidModelConfig(model: unknown): model is import('./settings/settings').ModelConfig {
    if (!model || typeof model !== 'object') return false;
    const m = model as Record<string, unknown>;
    if (!m.id || typeof m.id !== 'string') return false;
    if (!m.name || typeof m.name !== 'string') return false;
    // displayName 是可选的
    if (m.displayName !== undefined && typeof m.displayName !== 'string') return false;
    if (typeof m.temperature !== 'number' || m.temperature < 0 || m.temperature > 2) return false;
    if (typeof m.maxTokens !== 'number' || m.maxTokens < 0) return false;
    if (typeof m.topP !== 'number' || m.topP < 0 || m.topP > 1) return false;
    return true;
  }

  /**
   * 合并功能绑定配置
   * @param defaults 默认功能绑定
   * @param loaded 加载的功能绑定
   * @returns 合并后的功能绑定
   */
  private mergeFeatureBindings(
    defaults: Partial<Record<import('./settings/settings').AIFeature, import('./settings/settings').FeatureBinding>>,
    loaded: Partial<Record<import('./settings/settings').AIFeature, import('./settings/settings').FeatureBinding>>
  ): Partial<Record<import('./settings/settings').AIFeature, import('./settings/settings').FeatureBinding>> {
    const result = { ...defaults };

    // 验证并合并每个功能绑定
    const features: import('./settings/settings').AIFeature[] = ['naming', 'translation'];
    for (const feature of features) {
      const binding = loaded[feature];
      if (binding && this.isValidFeatureBinding(binding)) {
        result[feature] = binding;
      }
    }

    return result;
  }

  /**
   * 验证功能绑定是否有效
   * @param binding 功能绑定
   * @returns 是否有效
   */
  private isValidFeatureBinding(binding: unknown): binding is import('./settings/settings').FeatureBinding {
    if (!binding || typeof binding !== 'object') return false;
    const b = binding as Record<string, unknown>;
    if (!b.providerId || typeof b.providerId !== 'string') return false;
    if (!b.modelId || typeof b.modelId !== 'string') return false;
    if (typeof b.promptTemplate !== 'string') return false;
    return true;
  }

  /**
   * 验证并修复供应商配置
   * @returns 配置是否有效（无需修复）
   */
  private validateAndFixProviders(): boolean {
    let isValid = true;

    // 确保 providers 数组存在
    if (!this.settings.providers) {
      this.settings.providers = [];
      isValid = false;
    }

    // 验证每个供应商的模型列表
    for (const provider of this.settings.providers) {
      if (!provider.models) {
        provider.models = [];
        isValid = false;
      }
    }

    return isValid;
  }

  /**
   * 验证并修复功能绑定配置
   * 确保绑定引用的供应商和模型存在
   * @returns 配置是否有效（无需修复）
   */
  private validateAndFixFeatureBindings(): boolean {
    let isValid = true;

    // 确保功能绑定对象存在
    if (!this.settings.featureBindings) {
      this.settings.featureBindings = {};
      isValid = false;
    }

    // 验证 naming 功能绑定（仅当有供应商时）
    const namingBinding = this.settings.featureBindings.naming;
    if (namingBinding && this.settings.providers.length > 0) {
      const provider = this.settings.providers.find(p => p.id === namingBinding.providerId);
      if (!provider) {
        debugLog(`[Settings] naming 绑定的供应商 "${namingBinding.providerId}" 不存在，清除绑定`);
        delete this.settings.featureBindings.naming;
        isValid = false;
      } else if (provider.models.length > 0) {
        const model = provider.models.find(m => m.id === namingBinding.modelId);
        if (!model) {
          debugLog(`[Settings] naming 绑定的模型 "${namingBinding.modelId}" 不存在，使用第一个模型`);
          this.settings.featureBindings.naming = {
            ...namingBinding,
            modelId: provider.models[0].id
          };
          isValid = false;
        }
      }
    }

    return isValid;
  }

  /**
   * 保存设置
   */
  async saveSettings() {
    await this.saveData(this.settings);
    
    // 更新调试模式
    setDebugMode(this.settings.debugMode);
    
    // 更新终端服务的设置（如果已初始化）
    if (this.terminalService) {
      this.terminalService.updateSettings(this.settings.terminal);
    }
    
    // 更新选中工具栏的设置（如果已初始化）
    if (this.selectionToolbarManager) {
      this.selectionToolbarManager.updateSettings(this.settings.selectionToolbar);
    }
  }

  /**
   * 更新选中工具栏设置
   * 供设置面板调用，实现设置实时生效
   * Requirements: 4.5
   */
  updateSelectionToolbarSettings(): void {
    if (this.selectionToolbarManager) {
      this.selectionToolbarManager.updateSettings(this.settings.selectionToolbar);
    }
  }

  /**
   * 插件卸载时调用
   */
  async onunload() {
    debugLog(t('plugin.unloadingMessage'));

    // 销毁选中文字浮动工具栏
    try {
      if (this.selectionToolbarManager) {
        this.selectionToolbarManager.destroy();
      }
    } catch (error) {
      errorLog('销毁选中工具栏失败:', error);
    }

    // 清理所有终端
    try {
      if (this.terminalService) {
        await this.terminalService.destroyAllTerminals();
      }
    } catch (error) {
      errorLog('清理终端失败:', error);
    }

    // 停止 PTY 服务器
    try {
      await this.terminalService.stopPtyServer();
    } catch (error) {
      errorLog(error);
    }
  }

  /**
   * 获取插件目录的绝对路径
   * 
   * @returns 插件目录的绝对路径
   */
  private getPluginDir(): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = this.app.vault.adapter as any;
    const vaultPath = adapter.getBasePath();
    
    const manifestDir = this.manifest.dir || `.obsidian/plugins/${this.manifest.id}`;
    
    // 转换为绝对路径
    return path.join(vaultPath, manifestDir);
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
   * 获取当前活动的终端视图
   */
  private getActiveTerminalView(): TerminalView | null {
    const activeView = this.app.workspace.getActiveViewOfType(TerminalView);
    return activeView;
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
