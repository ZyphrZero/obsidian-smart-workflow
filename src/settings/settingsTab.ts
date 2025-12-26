import { App, PluginSettingTab, Setting, Modal, Notice, setIcon } from 'obsidian';
import type SmartWorkflowPlugin from '../main';
import { BASE_PROMPT_TEMPLATE, ADVANCED_PROMPT_TEMPLATE } from './settings';
import { validateShellPath } from '../services/terminal/platformUtils';
import { t } from '../i18n';

/**
 * 设置标签页接口
 */
interface SettingTab {
  id: string;
  name: string;
  icon: string;
}

/**
 * 设置标签页定义
 * 使用函数返回以确保 i18n 已初始化
 */
function getSettingTabs(): SettingTab[] {
  return [
    { id: 'general', name: t('settings.tabs.general'), icon: 'settings' },
    { id: 'naming', name: t('settings.tabs.naming'), icon: 'tag' },
    { id: 'terminal', name: t('settings.tabs.terminal'), icon: 'terminal' },
    { id: 'advanced', name: t('settings.tabs.advanced'), icon: 'sliders-horizontal' }
  ];
}

/**
 * 配置重命名弹窗
 */
class RenameConfigModal extends Modal {
  private currentName: string;
  private onSubmit: (newName: string) => void;

  constructor(app: App, currentName: string, onSubmit: (newName: string) => void) {
    super(app);
    this.currentName = currentName;
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // 设置弹窗宽度
    this.modalEl.setCssProps({
      width: '450px',
      'max-width': '90vw'
    });

    new Setting(contentEl)
      .setName(t('modals.renameConfig.title'))
      .setHeading();

    // 创建输入框
    const inputContainer = contentEl.createDiv({ cls: 'setting-item' });
    const input = inputContainer.createEl('input', {
      type: 'text',
      value: this.currentName
    });
    input.setCssProps({
      width: '100%',
      padding: '8px',
      'margin-bottom': '16px'
    });

    // 选中当前文本
    input.select();

    // 创建按钮容器
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    buttonContainer.setCssProps({
      display: 'flex',
      'justify-content': 'flex-end',
      gap: '8px'
    });

    // 取消按钮
    const cancelButton = buttonContainer.createEl('button', { text: t('common.cancel') });
    cancelButton.addEventListener('click', () => {
      this.close();
    });

    // 确认按钮
    const confirmButton = buttonContainer.createEl('button', {
      text: t('common.confirm'),
      cls: 'mod-cta'
    });
    confirmButton.addEventListener('click', () => {
      const newName = input.value.trim();
      if (newName) {
        this.onSubmit(newName);
        this.close();
      }
    });

    // 回车键提交
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const newName = input.value.trim();
        if (newName) {
          this.onSubmit(newName);
          this.close();
        }
      } else if (e.key === 'Escape') {
        this.close();
      }
    });

    // 聚焦输入框
    input.focus();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * 配置删除确认弹窗
 */
class DeleteConfigModal extends Modal {
  private configName: string;
  private onConfirm: () => void;

  constructor(app: App, configName: string, onConfirm: () => void) {
    super(app);
    this.configName = configName;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // 设置弹窗宽度
    this.modalEl.setCssProps({
      width: '500px',
      'max-width': '90vw'
    });

    new Setting(contentEl)
      .setName(t('modals.deleteConfig.title'))
      .setHeading();

    // 警告信息
    const warningContainer = contentEl.createDiv({ cls: 'setting-item' });
    warningContainer.setCssProps({
      padding: '12px',
      'margin-bottom': '16px',
      'background-color': 'var(--background-modifier-error)',
      'border-radius': '6px',
      'border': '1px solid var(--background-modifier-error-hover)'
    });

    const warningText = warningContainer.createDiv();
    warningText.setText(t('modals.deleteConfig.warning', { name: this.configName }));
    warningText.setCssProps({
      color: 'var(--text-on-accent)',
      'font-weight': '500'
    });

    // 创建按钮容器
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    buttonContainer.setCssProps({
      display: 'flex',
      'justify-content': 'flex-end',
      gap: '8px'
    });

    // 取消按钮
    const cancelButton = buttonContainer.createEl('button', { text: t('common.cancel') });
    cancelButton.addEventListener('click', () => {
      this.close();
    });

    // 确认删除按钮
    const confirmButton = buttonContainer.createEl('button', {
      text: t('common.confirm'),
      cls: 'mod-warning'
    });
    confirmButton.addEventListener('click', () => {
      this.onConfirm();
      this.close();
    });

    // ESC 键关闭
    contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * 设置标签页类
 * 提供插件配置界面
 */
export class SmartWorkflowSettingTab extends PluginSettingTab {
  plugin: SmartWorkflowPlugin;
  private activeTab = 'general';
  private expandedSections: Set<string> = new Set(); // 记录展开的功能区块

  constructor(app: App, plugin: SmartWorkflowPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // 头部
    const headerEl = containerEl.createDiv({ cls: 'smart-workflow-settings-header' });
    new Setting(headerEl)
      .setName('Smart Workflow')
      .setHeading();

    // GitHub Feedback Link
    const feedbackContainer = headerEl.createDiv({ cls: 'setting-item-description' });
    feedbackContainer.setCssProps({
      'margin-bottom': '10px'
    });
    feedbackContainer.appendText(t('settings.header.feedbackText'));
    feedbackContainer.createEl('a', {
      text: t('settings.header.feedbackLink'),
      href: 'https://github.com/ZyphrZero/obsidian-smart-workflow'
    });

    // 标签页导航
    const tabsEl = containerEl.createDiv({ cls: 'smart-workflow-tabs' });

    getSettingTabs().forEach(tab => {
      const tabEl = tabsEl.createEl('div', {
        cls: 'smart-workflow-tab'
      });

      if (tab.id === this.activeTab) {
        tabEl.addClass('active');
      }

      // 使用 Obsidian 原生图标
      setIcon(tabEl, tab.icon);

      // 文本
      tabEl.createSpan({
        text: tab.name
      });

      // 点击事件
      tabEl.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.display();
      });
    });

    // 内容区域
    const contentEl = containerEl.createDiv({ cls: 'smart-workflow-content' });

    // 根据当前标签页显示不同内容
    switch (this.activeTab) {
      case 'general':
        this.renderGeneralSettings(contentEl);
        break;
      case 'naming':
        this.renderNamingSettings(contentEl);
        break;
      case 'terminal':
        this.renderTerminalSettings(contentEl);
        break;
      case 'advanced':
        this.renderAdvancedSettings(contentEl);
        break;
    }
  }

  /**
   * 创建卡片式设置容器
   */
  private createSettingCard(containerEl: HTMLElement): HTMLElement {
    const card = containerEl.createDiv();
    card.style.padding = '16px';
    card.style.borderRadius = '8px';
    card.style.backgroundColor = 'var(--background-secondary)';
    card.style.marginBottom = '10px';
    return card;
  }

  /**
   * 渲染常规设置（配置选择 + API 配置）
   */
  private renderGeneralSettings(containerEl: HTMLElement): void {
    const currentConfig = this.plugin.settings.configs.find(
      c => c.id === this.plugin.settings.activeConfigId
    );

    // 配置选择卡片
    const configCard = this.createSettingCard(containerEl);

    // 配置选择部分
    new Setting(configCard)
      .setName(t('settingsDetails.general.currentConfig'))
      .setDesc(t('settingsDetails.general.currentConfigDesc'))
      .addDropdown(dropdown => {
        // 添加所有配置选项
        this.plugin.settings.configs.forEach(config => {
          dropdown.addOption(config.id, config.name);
        });

        // 设置当前值
        dropdown.setValue(this.plugin.settings.activeConfigId);

        // 监听变化
        dropdown.onChange(async (value) => {
          this.plugin.settings.activeConfigId = value;
          await this.plugin.saveSettings();
          this.display(); // 重新渲染界面
        });
      });

    // 添加新配置按钮
    new Setting(configCard)
      .setName(t('settingsDetails.general.configManagement'))
      .setDesc(t('settingsDetails.general.configManagementDesc'))
      .addButton(button => button
        .setButtonText(t('settingsDetails.general.addConfig'))
        .onClick(async () => {
          // 生成新的配置 ID
          const newId = `config-${Date.now()}`;

          // 创建新配置
          const newConfig = {
            id: newId,
            name: `Config ${this.plugin.settings.configs.length + 1}`,
            endpoint: 'https://api.openai.com/v1/chat/completions',
            apiKey: '',
            model: 'gpt-3.5-turbo',
            temperature: 0.7,
            maxTokens: 300,
            topP: 1.0,
            promptTemplate: this.plugin.settings.defaultPromptTemplate
          };

          // 添加到配置列表
          this.plugin.settings.configs.push(newConfig);

          // 设置为当前活动配置
          this.plugin.settings.activeConfigId = newId;

          // 保存设置
          await this.plugin.saveSettings();

          // 重新渲染界面
          this.display();
        }))
      .addButton(button => button
        .setButtonText(t('settingsDetails.general.renameConfig'))
        .onClick(() => {
          const config = this.plugin.settings.configs.find(
            c => c.id === this.plugin.settings.activeConfigId
          );

          if (!config) {
            return;
          }

          // 创建重命名弹窗
          const modal = new RenameConfigModal(this.app, config.name, async (newName) => {
            if (newName && newName.trim()) {
              config.name = newName.trim();
              await this.plugin.saveSettings();
              this.display();
            }
          });
          modal.open();
        }))
      .addButton(button => button
        .setButtonText(t('settingsDetails.general.deleteConfig'))
        .setWarning()
        .onClick(async () => {
          // 获取当前配置
          const currentConfig = this.plugin.settings.configs.find(
            c => c.id === this.plugin.settings.activeConfigId
          );

          if (!currentConfig) {
            return;
          }

          // 不允许删除默认配置
          if (currentConfig.id === 'default') {
            new Notice('❌ ' + t('notices.cannotDeleteDefault'));
            return;
          }

          // 不允许删除最后一个配置
          if (this.plugin.settings.configs.length <= 1) {
            new Notice('❌ ' + t('notices.cannotDeleteLast'));
            return;
          }

          // 显示删除确认弹窗
          const modal = new DeleteConfigModal(
            this.app,
            currentConfig.name,
            async () => {
              // 删除当前配置
              this.plugin.settings.configs = this.plugin.settings.configs.filter(
                c => c.id !== this.plugin.settings.activeConfigId
              );

              // 切换到第一个配置
              this.plugin.settings.activeConfigId = this.plugin.settings.configs[0].id;

              // 保存设置
              await this.plugin.saveSettings();

              // 显示成功提示
              new Notice('✅ ' + t('notices.configDeleted'));

              // 重新渲染界面
              this.display();
            }
          );
          modal.open();
        }));

    // API 配置部分
    if (!currentConfig) {
      return;
    }

    // API 配置卡片
    const apiCard = this.createSettingCard(containerEl);

    new Setting(apiCard)
      .setName(t('settingsDetails.general.apiConfig'))
      .setHeading();

    // API 端点
    new Setting(apiCard)
      .setName(t('settingsDetails.general.apiEndpoint'))
      .setDesc(t('settingsDetails.general.apiEndpointDesc'))
      .addText(text => {
        text
          .setPlaceholder('https://api.openai.com/v1/chat/completions')
          .setValue(currentConfig.endpoint)
          .onChange(async (value) => {
            // 直接保存用户输入的原始值，不进行补全
            currentConfig.endpoint = value.trim();
            await this.plugin.saveSettings();
            updatePreview(value);
          });

        // 初始预览
        setTimeout(() => updatePreview(currentConfig.endpoint), 0);
      })
      .addButton(button => button
        .setButtonText(t('settingsDetails.general.testConnection'))
        .onClick(async () => {
          button.setButtonText(t('settingsDetails.general.testing'));
          button.setDisabled(true);

          try {
            await this.plugin.aiService.testConnection(currentConfig.id);
            new Notice('✅ ' + t('notices.connectionSuccess'));
          } catch (error) {
            new Notice('❌ ' + t('notices.connectionFailed', { message: error instanceof Error ? error.message : String(error) }));
          } finally {
            button.setButtonText(t('settingsDetails.general.testConnection'));
            button.setDisabled(false);
          }
        }));

    // 创建预览容器（在 API 端点设置项之后）
    const previewContainer = apiCard.createDiv({
      cls: 'setting-item-description'
    });

    const updatePreview = (value: string) => {
      const normalized = this.normalizeEndpoint(value);
      previewContainer.empty();

      if (value.trim()) {
        const previewText = previewContainer.createDiv();
        previewText.setText(t('settingsDetails.general.actualRequestUrl', { url: normalized.url }));
        previewText.setCssProps({
          color: 'var(--text-muted)',
          'font-size': '0.9em',
          'margin-top': '4px'
        });
      }
    };

    // 初始化预览
    updatePreview(currentConfig.endpoint);

    // API Key
    new Setting(apiCard)
      .setName(t('settingsDetails.general.apiKey'))
      .setDesc(t('settingsDetails.general.apiKeyDesc'))
      .addText(text => {
        text
          .setPlaceholder('sk-...')
          .setValue(currentConfig.apiKey)
          .onChange(async (value) => {
            currentConfig.apiKey = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = 'password';
      });

    // 模型名称
    new Setting(apiCard)
      .setName(t('settingsDetails.general.modelName'))
      .setDesc(t('settingsDetails.general.modelNameDesc'))
      .addText(text => text
        .setPlaceholder('gpt-3.5-turbo')
        .setValue(currentConfig.model)
        .onChange(async (value) => {
          currentConfig.model = value;
          await this.plugin.saveSettings();
        }));

    // Temperature
    new Setting(apiCard)
      .setName(t('settingsDetails.general.temperature'))
      .setDesc(t('settingsDetails.general.temperatureDesc'))
      .addSlider(slider => slider
        .setLimits(0, 2, 0.1)
        .setValue(currentConfig.temperature)
        .setDynamicTooltip()
        .onChange(async (value) => {
          currentConfig.temperature = value;
          await this.plugin.saveSettings();
        }));

    // Max Tokens
    new Setting(apiCard)
      .setName(t('settingsDetails.general.maxTokens'))
      .setDesc(t('settingsDetails.general.maxTokensDesc'))
      .addText(text => text
        .setPlaceholder('100')
        .setValue(String(currentConfig.maxTokens))
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue > 0) {
            currentConfig.maxTokens = numValue;
            await this.plugin.saveSettings();
          }
        }));

    // Top P
    new Setting(apiCard)
      .setName(t('settingsDetails.general.topP'))
      .setDesc(t('settingsDetails.general.topPDesc'))
      .addSlider(slider => slider
        .setLimits(0, 1, 0.05)
        .setValue(currentConfig.topP)
        .setDynamicTooltip()
        .onChange(async (value) => {
          currentConfig.topP = value;
          await this.plugin.saveSettings();
        }));

    // 请求超时
    new Setting(apiCard)
      .setName(t('settingsDetails.general.timeout'))
      .setDesc(t('settingsDetails.general.timeoutDesc'))
      .addText(text => text
        .setPlaceholder('15')
        .setValue(String((this.plugin.settings.timeout || 15000) / 1000))
        .onChange(async (value) => {
          const numValue = parseInt(value);
          if (!isNaN(numValue) && numValue > 0) {
            this.plugin.settings.timeout = numValue * 1000;
            await this.plugin.saveSettings();
          }
        }));
  }

  /**
   * 渲染命名设置
   */
  private renderNamingSettings(containerEl: HTMLElement): void {
    const config = this.plugin.settings.configs.find(
      c => c.id === this.plugin.settings.activeConfigId
    );

    if (!config) {
      return;
    }

    // 命名行为设置卡片
    const namingCard = this.createSettingCard(containerEl);

    new Setting(namingCard)
      .setName(t('settingsDetails.naming.namingBehavior'))
      .setHeading();

    // 使用当前文件名上下文
    new Setting(namingCard)
      .setName(t('settingsDetails.naming.useCurrentFilename'))
      .setDesc(t('settingsDetails.naming.useCurrentFilenameDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useCurrentFileNameContext)
        .onChange(async (value) => {
          this.plugin.settings.useCurrentFileNameContext = value;
          await this.plugin.saveSettings();
        }));

    // 分析目录命名风格
    new Setting(namingCard)
      .setName(t('settingsDetails.naming.analyzeDirectory'))
      .setDesc(t('settingsDetails.naming.analyzeDirectoryDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.analyzeDirectoryNamingStyle)
        .onChange(async (value) => {
          this.plugin.settings.analyzeDirectoryNamingStyle = value;
          await this.plugin.saveSettings();
        }));

    // Prompt 模板设置卡片
    const promptCard = this.createSettingCard(containerEl);

    new Setting(promptCard)
      .setName(t('settingsDetails.naming.promptTemplate'))
      .setHeading();

    const promptDesc = promptCard.createEl('div', { cls: 'setting-item-description' });
    promptDesc.appendText(t('settingsDetails.naming.promptTemplateDesc'));
    promptDesc.createEl('br');
    promptDesc.appendText('• ');
    promptDesc.createEl('code', { text: '{{content}}' });
    promptDesc.appendText(' - ' + t('settingsDetails.naming.promptVariables.content').replace('{{content}} - ', ''));
    promptDesc.createEl('br');
    promptDesc.appendText('• ');
    promptDesc.createEl('code', { text: '{{currentFileName}}' });
    promptDesc.appendText(' - ' + t('settingsDetails.naming.promptVariables.currentFileName').replace('{{currentFileName}} - ', ''));
    promptDesc.createEl('br');
    promptDesc.appendText('• ');
    promptDesc.createEl('code', { text: '{{#if currentFileName}}...{{/if}}' });
    promptDesc.appendText(' - ' + t('settingsDetails.naming.promptVariables.conditionalBlock').replace('{{#if currentFileName}}...{{/if}} - ', ''));

    // 当前使用的模板编辑器
    const currentTemplateCard = this.createSettingCard(containerEl);

    new Setting(currentTemplateCard)
      .setName(t('settingsDetails.naming.currentPromptTemplate'))
      .setDesc(t('settingsDetails.naming.currentPromptTemplateDesc'))
      .setHeading();

    new Setting(currentTemplateCard)
      .addTextArea(text => {
        text
          .setValue(config.promptTemplate)
          .onChange(async (value) => {
            config.promptTemplate = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 10;
        text.inputEl.cols = 50;
        text.inputEl.style.width = '100%';
      });

    // 重置按钮
    new Setting(currentTemplateCard)
      .setName(t('settingsDetails.naming.quickReset'))
      .setDesc(t('settingsDetails.naming.quickResetDesc'))
      .addButton(button => button
        .setButtonText(t('settingsDetails.naming.resetToRecommended'))
        .onClick(async () => {
          // 根据设置选择对应的模板
          if (this.plugin.settings.useCurrentFileNameContext) {
            // 使用高级模板
            config.promptTemplate = ADVANCED_PROMPT_TEMPLATE;
          } else {
            // 使用基础模板
            config.promptTemplate = BASE_PROMPT_TEMPLATE;
          }
          await this.plugin.saveSettings();
          this.display();
        }));
  }

  /**
   * 渲染终端设置
   */
  private renderTerminalSettings(containerEl: HTMLElement): void {
    // 架构选择卡片
    // Shell 程序设置卡片
    const shellCard = this.createSettingCard(containerEl);

    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.shellSettings'))
      .setHeading();

    // 默认 Shell 程序选择
    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.defaultShell'))
      .setDesc(t('settingsDetails.terminal.defaultShellDesc'))
      .addDropdown(dropdown => {
        // 根据平台显示不同的选项
        if (process.platform === 'win32') {
          dropdown.addOption('cmd', t('shellOptions.cmd'));
          dropdown.addOption('powershell', t('shellOptions.powershell'));
          dropdown.addOption('gitbash', t('shellOptions.gitbash'));
          dropdown.addOption('wsl', t('shellOptions.wsl'));
        } else if (process.platform === 'darwin' || process.platform === 'linux') {
          dropdown.addOption('bash', t('shellOptions.bash'));
          dropdown.addOption('zsh', t('shellOptions.zsh'));
        }
        dropdown.addOption('custom', t('shellOptions.custom'));

        dropdown.setValue(this.plugin.settings.terminal.defaultShell);
        dropdown.onChange(async (value) => {
          this.plugin.settings.terminal.defaultShell = value as any;
          await this.plugin.saveSettings();
          this.display(); // 重新渲染以显示/隐藏自定义路径输入框
        });
      });

    // 自定义程序路径（仅在选择 custom 时显示）
    if (this.plugin.settings.terminal.defaultShell === 'custom') {
      new Setting(shellCard)
        .setName(t('settingsDetails.terminal.customShellPath'))
        .setDesc(t('settingsDetails.terminal.customShellPathDesc'))
        .addText(text => {
          text
            .setPlaceholder(t('settingsDetails.terminal.customShellPathPlaceholder'))
            .setValue(this.plugin.settings.terminal.customShellPath)
            .onChange(async (value) => {
              this.plugin.settings.terminal.customShellPath = value;
              await this.plugin.saveSettings();
              
              // 验证路径
              this.validateCustomShellPath(shellCard, value);
            });
          
          // 初始验证
          setTimeout(() => {
            this.validateCustomShellPath(shellCard, this.plugin.settings.terminal.customShellPath);
          }, 0);
          
          return text;
        });
    }

    // 默认启动参数
    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.defaultArgs'))
      .setDesc(t('settingsDetails.terminal.defaultArgsDesc'))
      .addText(text => text
        .setPlaceholder(t('settingsDetails.terminal.defaultArgsPlaceholder'))
        .setValue(this.plugin.settings.terminal.shellArgs.join(' '))
        .onChange(async (value) => {
          // 将字符串分割为数组，过滤空字符串
          this.plugin.settings.terminal.shellArgs = value
            .split(' ')
            .filter(arg => arg.trim().length > 0);
          await this.plugin.saveSettings();
        }));

    // 自动进入项目目录
    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.autoEnterVault'))
      .setDesc(t('settingsDetails.terminal.autoEnterVaultDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.terminal.autoEnterVaultDirectory)
        .onChange(async (value) => {
          this.plugin.settings.terminal.autoEnterVaultDirectory = value;
          await this.plugin.saveSettings();
        }));

    // 实例行为设置卡片
    const instanceCard = this.createSettingCard(containerEl);

    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.instanceBehavior'))
      .setHeading();

    // 新实例行为
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.newInstanceLayout'))
      .setDesc(t('settingsDetails.terminal.newInstanceLayoutDesc'))
      .addDropdown(dropdown => {
        dropdown.addOption('replaceTab', t('layoutOptions.replaceTab'));
        dropdown.addOption('newTab', t('layoutOptions.newTab'));
        dropdown.addOption('newLeftTab', t('layoutOptions.newLeftTab'));
        dropdown.addOption('newLeftSplit', t('layoutOptions.newLeftSplit'));
        dropdown.addOption('newRightTab', t('layoutOptions.newRightTab'));
        dropdown.addOption('newRightSplit', t('layoutOptions.newRightSplit'));
        dropdown.addOption('newHorizontalSplit', t('layoutOptions.newHorizontalSplit'));
        dropdown.addOption('newVerticalSplit', t('layoutOptions.newVerticalSplit'));
        dropdown.addOption('newWindow', t('layoutOptions.newWindow'));

        dropdown.setValue(this.plugin.settings.terminal.newInstanceBehavior);
        dropdown.onChange(async (value) => {
          this.plugin.settings.terminal.newInstanceBehavior = value as any;
          await this.plugin.saveSettings();
        });
      });

    // 在现有终端附近创建
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.createNearExisting'))
      .setDesc(t('settingsDetails.terminal.createNearExistingDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.terminal.createInstanceNearExistingOnes)
        .onChange(async (value) => {
          this.plugin.settings.terminal.createInstanceNearExistingOnes = value;
          await this.plugin.saveSettings();
        }));

    // 聚焦新实例
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.focusNewInstance'))
      .setDesc(t('settingsDetails.terminal.focusNewInstanceDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.terminal.focusNewInstance)
        .onChange(async (value) => {
          this.plugin.settings.terminal.focusNewInstance = value;
          await this.plugin.saveSettings();
        }));

    // 锁定新实例
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.lockNewInstance'))
      .setDesc(t('settingsDetails.terminal.lockNewInstanceDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.terminal.lockNewInstance)
        .onChange(async (value) => {
          this.plugin.settings.terminal.lockNewInstance = value;
          await this.plugin.saveSettings();
        }));

    // 主题设置卡片
    const themeCard = this.createSettingCard(containerEl);

    new Setting(themeCard)
      .setName(t('settingsDetails.terminal.themeSettings'))
      .setHeading();

    // 使用 Obsidian 主题
    new Setting(themeCard)
      .setName(t('settingsDetails.terminal.useObsidianTheme'))
      .setDesc(t('settingsDetails.terminal.useObsidianThemeDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.terminal.useObsidianTheme)
        .onChange(async (value) => {
          this.plugin.settings.terminal.useObsidianTheme = value;
          await this.plugin.saveSettings();
          this.display(); // 重新渲染以显示/隐藏自定义颜色设置
        }));

    // 自定义颜色设置（仅在不使用 Obsidian 主题时显示）
    if (!this.plugin.settings.terminal.useObsidianTheme) {
      // 背景色
      new Setting(themeCard)
        .setName(t('settingsDetails.terminal.backgroundColor'))
        .setDesc(t('settingsDetails.terminal.backgroundColorDesc'))
        .addColorPicker(color => color
          .setValue(this.plugin.settings.terminal.backgroundColor || '#000000')
          .onChange(async (value) => {
            this.plugin.settings.terminal.backgroundColor = value;
            await this.plugin.saveSettings();
          }))
        .addExtraButton(button => button
          .setIcon('reset')
          .setTooltip(t('common.reset'))
          .onClick(async () => {
            this.plugin.settings.terminal.backgroundColor = undefined;
            await this.plugin.saveSettings();
            this.display(); // 刷新设置面板
            new Notice(t('notices.settings.backgroundColorReset'));
          }));

      // 前景色
      new Setting(themeCard)
        .setName(t('settingsDetails.terminal.foregroundColor'))
        .setDesc(t('settingsDetails.terminal.foregroundColorDesc'))
        .addColorPicker(color => color
          .setValue(this.plugin.settings.terminal.foregroundColor || '#FFFFFF')
          .onChange(async (value) => {
            this.plugin.settings.terminal.foregroundColor = value;
            await this.plugin.saveSettings();
          }))
        .addExtraButton(button => button
          .setIcon('reset')
          .setTooltip(t('common.reset'))
          .onClick(async () => {
            this.plugin.settings.terminal.foregroundColor = undefined;
            await this.plugin.saveSettings();
            this.display(); // 刷新设置面板
            new Notice(t('notices.settings.foregroundColorReset'));
          }));

      // 背景图片设置（仅 Canvas 渲染器支持）
      if (this.plugin.settings.terminal.preferredRenderer === 'canvas') {
        const bgImageSetting = new Setting(themeCard)
          .setName(t('settingsDetails.terminal.backgroundImage'))
          .setDesc(t('settingsDetails.terminal.backgroundImageDesc'));
        
        bgImageSetting.addText(text => {
          const inputEl = text
            .setPlaceholder(t('settingsDetails.terminal.backgroundImagePlaceholder'))
            .setValue(this.plugin.settings.terminal.backgroundImage || '')
            .onChange(async (value) => {
              // 只保存，不刷新
              this.plugin.settings.terminal.backgroundImage = value || undefined;
              await this.plugin.saveSettings();
            });
          
          // 失去焦点时刷新界面
          text.inputEl.addEventListener('blur', () => {
            this.display();
          });
          
          return inputEl;
        });
        
        bgImageSetting.addExtraButton(button => button
          .setIcon('reset')
          .setTooltip(t('common.reset'))
          .onClick(async () => {
            this.plugin.settings.terminal.backgroundImage = undefined;
            await this.plugin.saveSettings();
            this.display();
            new Notice(t('notices.settings.backgroundImageCleared'));
          }));

        // 背景图片透明度
        if (this.plugin.settings.terminal.backgroundImage) {
          new Setting(themeCard)
            .setName(t('settingsDetails.terminal.backgroundImageOpacity'))
            .setDesc(t('settingsDetails.terminal.backgroundImageOpacityDesc'))
            .addSlider(slider => slider
              .setLimits(0, 1, 0.05)
              .setValue(this.plugin.settings.terminal.backgroundImageOpacity ?? 0.5)
              .setDynamicTooltip()
              .onChange(async (value) => {
                this.plugin.settings.terminal.backgroundImageOpacity = value;
                await this.plugin.saveSettings();
              }));

          // 背景图片大小
          new Setting(themeCard)
            .setName(t('settingsDetails.terminal.backgroundImageSize'))
            .setDesc(t('settingsDetails.terminal.backgroundImageSizeDesc'))
            .addDropdown(dropdown => dropdown
              .addOption('cover', t('backgroundSizeOptions.cover'))
              .addOption('contain', t('backgroundSizeOptions.contain'))
              .addOption('auto', t('backgroundSizeOptions.auto'))
              .setValue(this.plugin.settings.terminal.backgroundImageSize || 'cover')
              .onChange(async (value: 'cover' | 'contain' | 'auto') => {
                this.plugin.settings.terminal.backgroundImageSize = value;
                await this.plugin.saveSettings();
              }));

          // 背景图片位置
          new Setting(themeCard)
            .setName(t('settingsDetails.terminal.backgroundImagePosition'))
            .setDesc(t('settingsDetails.terminal.backgroundImagePositionDesc'))
            .addDropdown(dropdown => dropdown
              .addOption('center', t('backgroundPositionOptions.center'))
              .addOption('top', t('backgroundPositionOptions.top'))
              .addOption('bottom', t('backgroundPositionOptions.bottom'))
              .addOption('left', t('backgroundPositionOptions.left'))
              .addOption('right', t('backgroundPositionOptions.right'))
              .addOption('top left', t('backgroundPositionOptions.topLeft'))
              .addOption('top right', t('backgroundPositionOptions.topRight'))
              .addOption('bottom left', t('backgroundPositionOptions.bottomLeft'))
              .addOption('bottom right', t('backgroundPositionOptions.bottomRight'))
              .setValue(this.plugin.settings.terminal.backgroundImagePosition || 'center')
              .onChange(async (value) => {
                this.plugin.settings.terminal.backgroundImagePosition = value;
                await this.plugin.saveSettings();
              }));

          // 毛玻璃效果
          new Setting(themeCard)
            .setName(t('settingsDetails.terminal.blurEffect'))
            .setDesc(t('settingsDetails.terminal.blurEffectDesc'))
            .addToggle(toggle => toggle
              .setValue(this.plugin.settings.terminal.enableBlur ?? false)
              .onChange(async (value) => {
                this.plugin.settings.terminal.enableBlur = value;
                await this.plugin.saveSettings();
                this.display(); // 刷新以显示/隐藏模糊程度滑块
              }));

          // 毛玻璃模糊程度
          if (this.plugin.settings.terminal.enableBlur) {
            new Setting(themeCard)
              .setName(t('settingsDetails.terminal.blurAmount'))
              .setDesc(t('settingsDetails.terminal.blurAmountDesc'))
              .addSlider(slider => slider
                .setLimits(0, 20, 1)
                .setValue(this.plugin.settings.terminal.blurAmount ?? 10)
                .setDynamicTooltip()
                .onChange(async (value) => {
                  this.plugin.settings.terminal.blurAmount = value;
                  await this.plugin.saveSettings();
                }));
          }

          // 文本透明度
          new Setting(themeCard)
            .setName(t('settingsDetails.terminal.textOpacity'))
            .setDesc(t('settingsDetails.terminal.textOpacityDesc'))
            .addSlider(slider => slider
              .setLimits(0, 1, 0.05)
              .setValue(this.plugin.settings.terminal.textOpacity ?? 1.0)
              .setDynamicTooltip()
              .onChange(async (value) => {
                this.plugin.settings.terminal.textOpacity = value;
                await this.plugin.saveSettings();
              }));
        }
      }
    }

    // 外观设置卡片
    const appearanceCard = this.createSettingCard(containerEl);

    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.appearanceSettings'))
      .setHeading();

    // 字体大小
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.fontSize'))
      .setDesc(t('settingsDetails.terminal.fontSizeDesc'))
      .addSlider(slider => slider
        .setLimits(8, 24, 1)
        .setValue(this.plugin.settings.terminal.fontSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.terminal.fontSize = value;
          await this.plugin.saveSettings();
        }));

    // 字体族
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.fontFamily'))
      .setDesc(t('settingsDetails.terminal.fontFamilyDesc'))
      .addText(text => text
        .setPlaceholder(t('settingsDetails.terminal.fontFamilyPlaceholder'))
        .setValue(this.plugin.settings.terminal.fontFamily)
        .onChange(async (value) => {
          this.plugin.settings.terminal.fontFamily = value;
          await this.plugin.saveSettings();
        }));

    // 光标样式
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.cursorStyle'))
      .setDesc(t('settingsDetails.terminal.cursorStyleDesc'))
      .addDropdown(dropdown => {
        dropdown.addOption('block', t('cursorStyleOptions.block'));
        dropdown.addOption('underline', t('cursorStyleOptions.underline'));
        dropdown.addOption('bar', t('cursorStyleOptions.bar'));

        dropdown.setValue(this.plugin.settings.terminal.cursorStyle);
        dropdown.onChange(async (value) => {
          this.plugin.settings.terminal.cursorStyle = value as any;
          await this.plugin.saveSettings();
        });
      });

    // 光标闪烁
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.cursorBlink'))
      .setDesc(t('settingsDetails.terminal.cursorBlinkDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.terminal.cursorBlink)
        .onChange(async (value) => {
          this.plugin.settings.terminal.cursorBlink = value;
          await this.plugin.saveSettings();
        }));

    // 渲染器类型
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.rendererType'))
      .setDesc(t('settingsDetails.terminal.rendererTypeDesc'))
      .addDropdown(dropdown => dropdown
        .addOption('canvas', t('rendererOptions.canvas'))
        .addOption('webgl', t('rendererOptions.webgl'))
        .setValue(this.plugin.settings.terminal.preferredRenderer)
        .onChange(async (value: 'canvas' | 'webgl') => {
          this.plugin.settings.terminal.preferredRenderer = value;
          await this.plugin.saveSettings();
          this.display(); // 刷新设置页面以显示/隐藏背景图片选项
          new Notice(t('notices.settings.rendererUpdated'));
        }));

    // 行为设置卡片
    const behaviorCard = this.createSettingCard(containerEl);

    new Setting(behaviorCard)
      .setName(t('settingsDetails.terminal.behaviorSettings'))
      .setHeading();

    // 滚动缓冲区大小
    const scrollbackSetting = new Setting(behaviorCard)
      .setName(t('settingsDetails.terminal.scrollback'))
      .setDesc(t('settingsDetails.terminal.scrollbackDesc'));
    
    scrollbackSetting.addText(text => {
      const inputEl = text
        .setPlaceholder('1000')
        .setValue(String(this.plugin.settings.terminal.scrollback))
        .onChange(async (value) => {
          // 只在输入时保存，不验证
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            this.plugin.settings.terminal.scrollback = numValue;
            await this.plugin.saveSettings();
          }
        });
      
      // 失去焦点时验证
      text.inputEl.addEventListener('blur', async () => {
        const value = text.inputEl.value;
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 100 || numValue > 10000) {
          new Notice('⚠️ ' + t('notices.settings.scrollbackRangeError'));
          this.plugin.settings.terminal.scrollback = 1000;
          await this.plugin.saveSettings();
          text.setValue('1000');
        }
      });
      
      return inputEl;
    });

    // 终端面板默认高度
    const defaultHeightSetting = new Setting(behaviorCard)
      .setName(t('settingsDetails.terminal.defaultHeight'))
      .setDesc(t('settingsDetails.terminal.defaultHeightDesc'));
    
    defaultHeightSetting.addText(text => {
      const inputEl = text
        .setPlaceholder('300')
        .setValue(String(this.plugin.settings.terminal.defaultHeight))
        .onChange(async (value) => {
          // 只在输入时保存，不验证
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            this.plugin.settings.terminal.defaultHeight = numValue;
            await this.plugin.saveSettings();
          }
        });
      
      // 失去焦点时验证
      text.inputEl.addEventListener('blur', async () => {
        const value = text.inputEl.value;
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 100 || numValue > 1000) {
          new Notice('⚠️ ' + t('notices.settings.heightRangeError'));
          this.plugin.settings.terminal.defaultHeight = 300;
          await this.plugin.saveSettings();
          text.setValue('300');
        }
      });
      
      return inputEl;
    });
  }

  /**
   * 渲染高级设置
   */
  private renderAdvancedSettings(containerEl: HTMLElement): void {
    // 性能与调试设置
    const performanceCard = this.createSettingCard(containerEl);

    new Setting(performanceCard)
      .setName(t('settingsDetails.advanced.performanceAndDebug'))
      .setHeading();

    // 调试模式
    new Setting(performanceCard)
      .setName(t('settingsDetails.advanced.debugMode'))
      .setDesc(t('settingsDetails.advanced.debugModeDesc'))
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode)
        .onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
        }));

    // 功能显示管理
    const visibilityCard = this.createSettingCard(containerEl);

    new Setting(visibilityCard)
      .setName(t('settingsDetails.advanced.featureVisibility'))
      .setDesc(t('settingsDetails.advanced.featureVisibilityDesc'))
      .setHeading();

    // AI 文件名生成功能 - 可折叠区块
    this.createCollapsibleSection(
      visibilityCard,
      'aiNaming',
      t('settingsDetails.advanced.aiNamingVisibility'),
      t('settingsDetails.advanced.aiNamingVisibilityDesc'),
      (contentEl) => {
        new Setting(contentEl)
          .setName(t('settingsDetails.advanced.showInCommandPalette'))
          .setDesc(t('settingsDetails.advanced.showInCommandPaletteDesc'))
          .addToggle(toggle => toggle
            .setValue(this.plugin.settings.featureVisibility.aiNaming.showInCommandPalette)
            .onChange(async (value) => {
              this.plugin.settings.featureVisibility.aiNaming.showInCommandPalette = value;
              await this.plugin.saveSettings();
            }));

        new Setting(contentEl)
          .setName(t('settingsDetails.advanced.showInEditorMenu'))
          .setDesc(t('settingsDetails.advanced.showInEditorMenuDesc'))
          .addToggle(toggle => toggle
            .setValue(this.plugin.settings.featureVisibility.aiNaming.showInEditorMenu)
            .onChange(async (value) => {
              this.plugin.settings.featureVisibility.aiNaming.showInEditorMenu = value;
              await this.plugin.saveSettings();
            }));

        new Setting(contentEl)
          .setName(t('settingsDetails.advanced.showInFileMenu'))
          .setDesc(t('settingsDetails.advanced.showInFileMenuDesc'))
          .addToggle(toggle => toggle
            .setValue(this.plugin.settings.featureVisibility.aiNaming.showInFileMenu)
            .onChange(async (value) => {
              this.plugin.settings.featureVisibility.aiNaming.showInFileMenu = value;
              await this.plugin.saveSettings();
            }));

        new Setting(contentEl)
          .setName(t('settingsDetails.advanced.showInRibbon'))
          .setDesc(t('settingsDetails.advanced.showInRibbonDesc'))
          .addToggle(toggle => toggle
            .setValue(this.plugin.settings.featureVisibility.aiNaming.showInRibbon)
            .onChange(async (value) => {
              this.plugin.settings.featureVisibility.aiNaming.showInRibbon = value;
              await this.plugin.saveSettings();
            }));
      }
    );

    // 终端功能 - 可折叠区块
    this.createCollapsibleSection(
      visibilityCard,
      'terminal',
      t('settingsDetails.advanced.terminalVisibility'),
      t('settingsDetails.advanced.terminalVisibilityDesc'),
      (contentEl) => {
        new Setting(contentEl)
          .setName(t('settingsDetails.advanced.showInCommandPalette'))
          .setDesc(t('settingsDetails.advanced.showInCommandPaletteDesc'))
          .addToggle(toggle => toggle
            .setValue(this.plugin.settings.featureVisibility.terminal.showInCommandPalette)
            .onChange(async (value) => {
              this.plugin.settings.featureVisibility.terminal.showInCommandPalette = value;
              await this.plugin.saveSettings();
            }));

        new Setting(contentEl)
          .setName(t('settingsDetails.advanced.showInRibbon'))
          .setDesc(t('settingsDetails.advanced.showInRibbonTerminalDesc'))
          .addToggle(toggle => toggle
            .setValue(this.plugin.settings.featureVisibility.terminal.showInRibbon)
            .onChange(async (value) => {
              this.plugin.settings.featureVisibility.terminal.showInRibbon = value;
              await this.plugin.saveSettings();
            }));

        new Setting(contentEl)
          .setName(t('settingsDetails.advanced.showInNewTab'))
          .setDesc(t('settingsDetails.advanced.showInNewTabDesc'))
          .addToggle(toggle => toggle
            .setValue(this.plugin.settings.featureVisibility.terminal.showInNewTab)
            .onChange(async (value) => {
              this.plugin.settings.featureVisibility.terminal.showInNewTab = value;
              await this.plugin.saveSettings();
            }));
      }
    );
  }

  /**
   * 创建可折叠的设置区块
   * @param containerEl 容器元素
   * @param sectionId 区块 ID
   * @param title 标题
   * @param description 描述
   * @param renderContent 渲染内容的回调函数
   */
  private createCollapsibleSection(
    containerEl: HTMLElement,
    sectionId: string,
    title: string,
    description: string,
    renderContent: (contentEl: HTMLElement) => void
  ): void {
    const isExpanded = this.expandedSections.has(sectionId);

    // 创建包装容器
    const wrapperEl = containerEl.createDiv({ cls: 'collapsible-section-wrapper' });

    // 创建标题区域（可点击）
    const headerEl = wrapperEl.createDiv({ 
      cls: 'collapsible-section-header' 
    });

    const headerInfo = headerEl.createDiv({ cls: 'setting-item-info' });
    
    const headerName = headerInfo.createDiv({ cls: 'setting-item-name' });
    
    // 添加展开/收起图标
    const iconEl = headerName.createSpan({ cls: 'collapsible-icon' });
    setIcon(iconEl, isExpanded ? 'chevron-down' : 'chevron-right');
    
    headerName.appendText(title);
    
    const headerDesc = headerInfo.createDiv({ cls: 'setting-item-description' });
    headerDesc.setText(description);

    // 创建内容区域
    const contentEl = wrapperEl.createDiv({ cls: 'collapsible-content' });
    contentEl.style.display = isExpanded ? 'block' : 'none';

    // 点击标题切换展开/收起
    headerEl.addEventListener('click', () => {
      const willExpand = !this.expandedSections.has(sectionId);
      
      if (willExpand) {
        this.expandedSections.add(sectionId);
        contentEl.style.display = 'block';
        headerEl.addClass('is-expanded');
        setIcon(iconEl, 'chevron-down');
        
        // 如果内容还未渲染，现在渲染
        if (contentEl.children.length === 0) {
          renderContent(contentEl);
        }
      } else {
        this.expandedSections.delete(sectionId);
        contentEl.style.display = 'none';
        headerEl.removeClass('is-expanded');
        setIcon(iconEl, 'chevron-right');
      }
    });

    // 设置初始状态
    if (isExpanded) {
      headerEl.addClass('is-expanded');
      renderContent(contentEl);
    }
  }

  /**
   * 验证自定义 Shell 路径
   * @param containerEl 容器元素
   * @param path Shell 路径
   */
  private validateCustomShellPath(containerEl: HTMLElement, path: string): void {
    // 移除之前的验证消息
    const existingValidation = containerEl.querySelector('.shell-path-validation');
    if (existingValidation) {
      existingValidation.remove();
    }
    
    // 如果路径为空，不显示验证消息
    if (!path || path.trim() === '') {
      return;
    }
    
    // 创建验证消息容器
    const validationEl = containerEl.createDiv({ cls: 'shell-path-validation setting-item-description' });
    validationEl.style.marginTop = '8px';
    
    // 验证路径
    const isValid = validateShellPath(path);
    
    if (isValid) {
      validationEl.setText(t('settingsDetails.terminal.pathValid'));
      validationEl.style.color = 'var(--text-success)';
    } else {
      validationEl.setText(t('settingsDetails.terminal.pathInvalid'));
      validationEl.style.color = 'var(--text-error)';
    }
  }

  /**
   * 标准化 API 端点 URL
   * @param url 原始 URL
   * @returns 标准化后的 URL
   */
  private normalizeEndpoint(url: string): { url: string } {
    let normalized = url.trim();

    if (!normalized) {
      return { url: '' };
    }

    // 检查协议
    if (!normalized.match(/^https?:\/\//i)) {
      if (normalized.startsWith('//')) {
        normalized = 'https:' + normalized;
      } else if (!normalized.includes('://')) {
        normalized = 'https://' + normalized;
      }
    }

    // 移除末尾多余的斜杠
    normalized = normalized.replace(/\/+$/, '');

    // 检查是否包含完整路径
    const commonPaths = [
      '/v1/chat/completions',
      '/chat/completions',
      '/v1/completions',
      '/completions'
    ];

    const hasPath = commonPaths.some(path => normalized.includes(path));

    if (!hasPath) {
      // 尝试检测基础 URL 并自动补全
      const urlObj = this.tryParseUrl(normalized);
      if (urlObj) {
        const pathname = urlObj.pathname;

        // 如果路径以 /v1 结尾，自动补全为 /v1/chat/completions
        if (pathname === '/v1' || pathname === '/v1/') {
          normalized = normalized + '/chat/completions';
        }
        // 如果只有根路径或空路径，补全为 /v1/chat/completions
        else if (!pathname || pathname === '/') {
          normalized = normalized + '/v1/chat/completions';
        }
        // 如果路径以 /chat 结尾，补全为 /chat/completions
        else if (pathname === '/chat' || pathname === '/chat/') {
          normalized = normalized + '/completions';
        }
      }
    }

    // 修正双斜杠
    if (normalized.includes('//v1')) {
      normalized = normalized.replace('//v1', '/v1');
    }

    return { url: normalized };
  }

  /**
   * 尝试解析 URL
   * @param urlString URL 字符串
   * @returns URL 对象或 null
   */
  private tryParseUrl(urlString: string): URL | null {
    try {
      return new URL(urlString);
    } catch {
      return null;
    }
  }
}
