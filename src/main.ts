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
  generatingFiles: Set<string> = new Set();
  
  // 延迟初始化的服务
  private _terminalService: TerminalService | null = null;
  private _selectionToolbarManager: SelectionToolbarManager | null = null;
  
  // Ribbon 图标引用
  private aiNamingRibbonIcon: HTMLElement | null = null;
  private terminalRibbonIcon: HTMLElement | null = null;

  /**
   * 获取终端服务（延迟初始化）
   */
  get terminalService(): TerminalService {
    if (!this._terminalService) {
      const pluginDir = this.getPluginDir();
      this._terminalService = new TerminalService(this.app, this.settings.terminal, pluginDir);
    }
    return this._terminalService;
  }

  /**
   * 获取选中工具栏管理器（延迟初始化）
   */
  get selectionToolbarManager(): SelectionToolbarManager {
    if (!this._selectionToolbarManager) {
      this._selectionToolbarManager = new SelectionToolbarManager(
        this.app,
        this.settings.selectionToolbar
      );
      this._selectionToolbarManager.initialize();
    }
    return this._selectionToolbarManager;
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

    // 初始化核心服务（AI 功能）
    this.aiService = new AIService(this.app, this.settings, () => this.saveSettings());
    this.fileNameService = new FileNameService(
      this.app,
      this.aiService,
      this.settings
    );

    // 注册终端视图（视图注册不触发服务初始化）
    this.registerView(
      TERMINAL_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new TerminalView(leaf, this.terminalService)
    );

    // 添加侧边栏图标按钮 - AI 文件名生成
    if (this.settings.featureVisibility.aiNaming.showInRibbon) {
      this.aiNamingRibbonIcon = this.addRibbonIcon('sparkles', t('ribbon.aiFilenameTooltip'), async () => {
        await this.handleGenerateCommand();
      });
    }

    // 添加侧边栏图标按钮 - 打开终端
    if (this.settings.featureVisibility.terminal.showInRibbon) {
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
      // 供应商配置：直接使用，确保 models 数组存在
      providers: (loaded.providers || []).map(p => ({
        ...p,
        models: p.models || []
      })),
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
          ...loaded.featureVisibility?.terminal
        }
      },
      selectionToolbar: {
        ...DEFAULT_SETTINGS.selectionToolbar,
        ...loaded.selectionToolbar,
        actions: {
          ...DEFAULT_SETTINGS.selectionToolbar.actions,
          ...loaded.selectionToolbar?.actions
        }
      }
    };
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
      this._selectionToolbarManager.updateSettings(this.settings.selectionToolbar);
    }
  }

  /**
   * 更新选中工具栏设置
   * 供设置面板调用，实现设置实时生效
   * Requirements: 4.5
   */
  updateSelectionToolbarSettings(): void {
    if (this._selectionToolbarManager) {
      this._selectionToolbarManager.updateSettings(this.settings.selectionToolbar);
    }
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

    // 更新终端 Ribbon 图标
    if (this.settings.featureVisibility.terminal.showInRibbon) {
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

    // 清理终端相关资源（仅当已初始化时）
    if (this._terminalService) {
      try {
        await this._terminalService.destroyAllTerminals();
        await this._terminalService.stopPtyServer();
      } catch (error) {
        errorLog('清理终端失败:', error);
      }
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
