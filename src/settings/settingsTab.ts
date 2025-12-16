import { App, PluginSettingTab, Setting, Modal, Notice, setIcon } from 'obsidian';
import type AIFileNamerPlugin from '../main';
import { BASE_PROMPT_TEMPLATE, ADVANCED_PROMPT_TEMPLATE } from './settings';

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
 */
const SETTING_TABS: SettingTab[] = [
  { id: 'general', name: '常规设置', icon: 'settings' },
  { id: 'naming', name: '命名设置', icon: 'tag' },
  { id: 'advanced', name: '高级选项', icon: 'sliders-horizontal' }
];

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

    new Setting(contentEl)
      .setName('重命名配置')
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
    const cancelButton = buttonContainer.createEl('button', { text: '取消' });
    cancelButton.addEventListener('click', () => {
      this.close();
    });

    // 确认按钮
    const confirmButton = buttonContainer.createEl('button', {
      text: '确认',
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
 * 设置标签页类
 * 提供插件配置界面
 */
export class AIFileNamerSettingTab extends PluginSettingTab {
  plugin: AIFileNamerPlugin;
  private activeTab = 'general';

  constructor(app: App, plugin: AIFileNamerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // 头部
    const headerEl = containerEl.createDiv({ cls: 'ai-file-namer-settings-header' });
    new Setting(headerEl)
      .setName('AI Note Renamer')
      .setHeading();

    // GitHub Feedback Link
    const feedbackContainer = headerEl.createDiv({ cls: 'setting-item-description' });
    feedbackContainer.setCssProps({
      'margin-top': '-10px',
      'margin-bottom': '20px'
    });
    feedbackContainer.appendText('谢谢你的使用~欢迎反馈！戳这里：');
    feedbackContainer.createEl('a', {
      text: 'GitHub',
      href: 'https://github.com/ZyphrZero/obsidian-ai-note-renamer'
    });

    // 标签页导航
    const tabsEl = containerEl.createDiv({ cls: 'ai-file-namer-tabs' });

    SETTING_TABS.forEach(tab => {
      const tabEl = tabsEl.createEl('div', {
        cls: 'ai-file-namer-tab'
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
    const contentEl = containerEl.createDiv({ cls: 'ai-file-namer-content' });

    // 根据当前标签页显示不同内容
    switch (this.activeTab) {
      case 'general':
        this.renderGeneralSettings(contentEl);
        break;
      case 'naming':
        this.renderNamingSettings(contentEl);
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
    card.style.marginBottom = '20px';
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
      .setName('当前配置')
      .setDesc('选择要使用的 API 配置')
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
      .setName('配置管理')
      .setDesc('添加、重命名或删除 API 配置')
      .addButton(button => button
        .setButtonText('添加配置')
        .onClick(async () => {
          // 生成新的配置 ID
          const newId = `config-${Date.now()}`;

          // 创建新配置
          const newConfig = {
            id: newId,
            name: `配置 ${this.plugin.settings.configs.length + 1}`,
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
        .setButtonText('重命名配置')
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
        .setButtonText('删除配置')
        .setWarning()
        .onClick(async () => {
          // 不允许删除最后一个配置
          if (this.plugin.settings.configs.length <= 1) {
            return;
          }

          // 删除当前配置
          this.plugin.settings.configs = this.plugin.settings.configs.filter(
            c => c.id !== this.plugin.settings.activeConfigId
          );

          // 切换到第一个配置
          this.plugin.settings.activeConfigId = this.plugin.settings.configs[0].id;

          // 保存设置
          await this.plugin.saveSettings();

          // 重新渲染界面
          this.display();
        }));

    // API 配置部分
    if (!currentConfig) {
      return;
    }

    // API 配置卡片
    const apiCard = this.createSettingCard(containerEl);

    new Setting(apiCard)
      .setName(`API 配置`)
      .setHeading();

    // API 端点
    new Setting(apiCard)
      .setName('API 端点')
      .setDesc('OpenAI API 兼容的端点地址（可以是基础 URL，完整路径将在运行时自动补全）')
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
        .setButtonText('测试连接')
        .onClick(async () => {
          button.setButtonText('测试中...');
          button.setDisabled(true);

          try {
            await this.plugin.aiService.testConnection(currentConfig.id);
            new Notice('✅ 连接成功！');
          } catch (error) {
            new Notice(`❌ 连接失败: ${error instanceof Error ? error.message : String(error)}`);
          } finally {
            button.setButtonText('测试连接');
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
        previewText.setText(`实际请求地址: ${normalized.url}`);
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
      .setName('API key')
      .setDesc('您的 API 密钥')
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
      .setName('模型名称')
      .setDesc('使用的 AI 模型')
      .addText(text => text
        .setPlaceholder('gpt-3.5-turbo')
        .setValue(currentConfig.model)
        .onChange(async (value) => {
          currentConfig.model = value;
          await this.plugin.saveSettings();
        }));

    // Temperature
    new Setting(apiCard)
      .setName('Temperature')
      .setDesc('控制文件名生成的创造性。值越低（接近 0）生成的文件名越保守、准确；值越高生成的文件名越有创意但可能偏离内容。建议设置为 0.3-0.7')
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
      .setName('Max tokens')
      .setDesc('生成的最大 token 数量')
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
      .setName('Top p')
      .setDesc('控制文件名用词的多样性。值越小生成的文件名用词越常见、简洁；值越大用词范围越广、越丰富。建议保持默认值 1.0')
      .addSlider(slider => slider
        .setLimits(0, 1, 0.05)
        .setValue(currentConfig.topP)
        .setDynamicTooltip()
        .onChange(async (value) => {
          currentConfig.topP = value;
          await this.plugin.saveSettings();
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
      .setName('命名行为设置')
      .setHeading();

    // 使用当前文件名上下文
    new Setting(namingCard)
      .setName('使用当前文件名作为上下文')
      .setDesc('开启后，AI 会参考当前文件名进行改进；关闭后，仅根据笔记内容生成标题')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useCurrentFileNameContext)
        .onChange(async (value) => {
          this.plugin.settings.useCurrentFileNameContext = value;
          await this.plugin.saveSettings();
        }));

    // 分析目录命名风格
    new Setting(namingCard)
      .setName('分析目录下其他文件命名风格')
      .setDesc('开启后，AI 会分析同目录下其他文件的命名模式，生成风格一致的文件名（可能影响性能）')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.analyzeDirectoryNamingStyle)
        .onChange(async (value) => {
          this.plugin.settings.analyzeDirectoryNamingStyle = value;
          await this.plugin.saveSettings();
        }));

    // Prompt 模板设置卡片
    const promptCard = this.createSettingCard(containerEl);

    new Setting(promptCard)
      .setName(`Prompt 模板`)
      .setHeading();

    const promptDesc = promptCard.createEl('div', { cls: 'setting-item-description' });
    promptDesc.appendText('自定义发送给 AI 的提示词模板。支持的变量：');
    promptDesc.createEl('br');
    promptDesc.appendText('• ');
    promptDesc.createEl('code', { text: '{{content}}' });
    promptDesc.appendText(' - 笔记内容');
    promptDesc.createEl('br');
    promptDesc.appendText('• ');
    promptDesc.createEl('code', { text: '{{currentFileName}}' });
    promptDesc.appendText(' - 当前文件名');
    promptDesc.createEl('br');
    promptDesc.appendText('• ');
    promptDesc.createEl('code', { text: '{{#if currentFileName}}...{{/if}}' });
    promptDesc.appendText(' - 条件块');

    // 当前使用的模板编辑器
    const currentTemplateCard = this.createSettingCard(containerEl);

    new Setting(currentTemplateCard)
      .setName('✏️ 当前 Prompt 模板')
      .setDesc('在下方编辑当前配置使用的模板')
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
      .setName('快速重置')
      .setDesc('根据"使用当前文件名作为上下文"设置，自动选择合适的模板')
      .addButton(button => button
        .setButtonText('重置为推荐模板')
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
   * 渲染高级设置
   */
  private renderAdvancedSettings(containerEl: HTMLElement): void {
    const advancedCard = this.createSettingCard(containerEl);

    new Setting(advancedCard)
      .setName('高级选项')
      .setHeading();

    // 请求超时
    new Setting(advancedCard)
      .setName('请求超时时间 (秒)')
      .setDesc('设置 API 请求的最大等待时间，防止请求由于网络原因卡死')
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

    // 调试模式
    new Setting(advancedCard)
      .setName('调试模式')
      .setDesc('开启后在浏览器控制台显示详细的调试日志（包括 Prompt 内容、目录分析结果等）')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode)
        .onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
        }));
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
