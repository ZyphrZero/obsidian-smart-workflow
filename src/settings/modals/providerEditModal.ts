import { App, Modal, Setting, Notice, setIcon } from 'obsidian';
import type { ConfigManager } from '../../services/config/configManager';
import type { Provider, KeyConfig, SecretStorageMode } from '../settings';
import { t } from '../../i18n';
import { EndpointNormalizer } from '../../services/ai';
import { ApiKeyManagerModal } from './apiKeyManagerModal';

/**
 * 供应商预设配置
 */
interface ProviderPreset {
  id: string;
  name: string;
  endpoint: string;
  description: string;
}

/**
 * 内置供应商预设列表
 */
const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'custom',
    name: '自定义',
    endpoint: '',
    description: '手动输入供应商信息',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    description: 'GPT-4o, GPT-4o-mini, o3, o4-mini 等',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1',
    description: 'Claude 4.5, Claude 4 等',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    description: 'gemini-3-pro-preview, Gemini 2.5 Flash 等',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1',
    description: 'DeepSeek-V3, DeepSeek-R1 等',
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    endpoint: 'https://api.siliconflow.cn/v1',
    description: 'Qwen, DeepSeek, GLM 等多种模型',
  },
  {
    id: 'zhipu',
    name: '智谱 AI',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4',
    description: 'GLM-4-Flash, GLM-4 等',
  },
  {
    id: 'dashscope',
    name: '阿里云百炼',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    description: 'Qwen-Max, Qwen-Plus 等',
  },
  {
    id: 'moonshot',
    name: 'Moonshot (月之暗面)',
    endpoint: 'https://api.moonshot.cn/v1',
    description: 'Kimi 系列模型',
  },
  {
    id: 'doubao',
    name: '豆包 (字节跳动)',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    description: 'Doubao 系列模型',
  },
  {
    id: 'volcengine',
    name: '火山引擎',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    description: 'Doubao、DeepSeek 等模型',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1',
    description: '聚合多家模型供应商',
  },
  {
    id: 'modelscope',
    name: 'ModelScope 魔搭',
    endpoint: 'https://api-inference.modelscope.cn/v1',
    description: 'Qwen、DeepSeek 等开源模型',
  },
];

/**
 * 检查 SecretComponent 是否可用
 * Obsidian 1.11.1+ 才支持 SecretComponent
 */
function isSecretComponentAvailable(app: App): boolean {
  // 检查 app.secretStorage 是否存在
  return !!(app as any).secretStorage;
}

/**
 * 动态创建 SecretComponent
 * 由于 TypeScript 类型定义可能不包含 SecretComponent，使用动态导入
 */
function createSecretComponent(app: App, containerEl: HTMLElement): any {
  try {
    // 尝试从 obsidian 模块动态获取 SecretComponent
    const obsidian = require('obsidian');
    if (obsidian.SecretComponent) {
      return new obsidian.SecretComponent(app, containerEl);
    }
  } catch {
    // SecretComponent 不可用
  }
  return null;
}

/**
 * 供应商编辑弹窗
 * 支持共享密钥和本地密钥两种存储模式
 */
export class ProviderEditModal extends Modal {
  private provider: Provider | null;
  private configManager: ConfigManager;
  private onSave: () => void;
  private isNew: boolean;

  constructor(
    app: App,
    configManager: ConfigManager,
    provider: Provider | null,
    onSave: () => void
  ) {
    super(app);
    this.configManager = configManager;
    this.provider = provider;
    this.onSave = onSave;
    this.isNew = !provider;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    // 设置弹窗宽度
    this.modalEl.setCssProps({
      width: '550px',
      'max-width': '90vw'
    });

    // 标题
    new Setting(contentEl)
      .setName(this.isNew ? t('modals.providerEdit.titleAdd') : t('modals.providerEdit.titleEdit'))
      .setHeading();

    // 从现有 provider 中提取 keyConfig 信息
    const existingKeyConfig = this.provider?.keyConfig;
    const existingKeyConfigs = this.provider?.keyConfigs;

    // 表单数据
    const formData = {
      name: this.provider?.name || '',
      endpoint: this.provider?.endpoint || '',
      // 密钥存储模式
      storageMode: (existingKeyConfig?.mode || 'local') as SecretStorageMode,
      // 共享密钥 ID
      secretId: existingKeyConfig?.secretId || '',
      // 本地密钥值
      localValue: existingKeyConfig?.localValue || '',
      // 多密钥配置
      keyConfigs: existingKeyConfigs ? [...existingKeyConfigs] : []
    };

    // 用于更新表单 UI 的引用
    let nameInput: HTMLInputElement | null = null;
    let endpointInput: HTMLInputElement | null = null;
    let keyCountEl: HTMLElement | null = null;
    let secretComponentContainer: HTMLElement | null = null;
    let localKeyContainer: HTMLElement | null = null;

    // 检查 SecretComponent 是否可用
    const secretComponentAvailable = isSecretComponentAvailable(this.app);

    // 更新密钥数量显示
    const updateKeyCount = () => {
      if (keyCountEl) {
        const count = formData.keyConfigs.length;
        if (count > 0) {
          keyCountEl.setText(t('modals.providerEdit.multiKeyCount', { count }));
          keyCountEl.style.display = 'block';
        } else {
          keyCountEl.style.display = 'none';
        }
      }
    };

    // 更新存储模式 UI 显示
    const updateStorageModeUI = () => {
      if (secretComponentContainer && localKeyContainer) {
        if (formData.storageMode === 'shared') {
          secretComponentContainer.style.display = 'block';
          localKeyContainer.style.display = 'none';
        } else {
          secretComponentContainer.style.display = 'none';
          localKeyContainer.style.display = 'block';
        }
      }
    };

    // 仅在新建时显示预设选择
    if (this.isNew) {
      new Setting(contentEl)
        .setName(t('modals.providerEdit.preset'))
        .setDesc(t('modals.providerEdit.presetDesc'))
        .addDropdown(dropdown => {
          PROVIDER_PRESETS.forEach(preset => {
            dropdown.addOption(preset.id, preset.name);
          });
          dropdown.setValue('custom');
          dropdown.onChange(value => {
            const preset = PROVIDER_PRESETS.find(p => p.id === value);
            if (preset && preset.id !== 'custom') {
              formData.name = preset.name;
              formData.endpoint = preset.endpoint;
              // 更新输入框显示
              if (nameInput) nameInput.value = preset.name;
              if (endpointInput) endpointInput.value = preset.endpoint;
              updateActualUrl(preset.endpoint);
            }
          });
        });
    }

    // 供应商名称
    new Setting(contentEl)
      .setName(t('modals.providerEdit.name'))
      .setDesc(t('modals.providerEdit.nameDesc'))
      .addText(text => {
        text
          .setPlaceholder(t('modals.providerEdit.namePlaceholder'))
          .setValue(formData.name)
          .onChange(value => {
            formData.name = value;
          });
        text.inputEl.setCssProps({ 'min-width': '200px' });
        nameInput = text.inputEl;
      });

    // API 端点
    new Setting(contentEl)
      .setName(t('modals.providerEdit.endpoint'))
      .setDesc(t('modals.providerEdit.endpointDesc'))
      .addText(text => {
        text
          .setPlaceholder('https://api.openai.com/v1/chat/completions')
          .setValue(formData.endpoint)
          .onChange(value => {
            formData.endpoint = value;
            // 更新实际请求 URL 显示
            updateActualUrl(value);
          });
        text.inputEl.setCssProps({ 'min-width': '200px' });
        endpointInput = text.inputEl;
      });

    // 实际请求 URL 显示
    const actualUrlEl = contentEl.createDiv({ cls: 'actual-url-display' });
    actualUrlEl.setCssProps({
      'font-size': '0.8em',
      color: 'var(--text-muted)',
      'margin-top': '-8px',
      'margin-bottom': '12px',
      padding: '0px',
      'background-color': 'var(--background-primary)',
      'border-radius': '4px',
      'word-break': 'break-all'
    });

    const updateActualUrl = (endpoint: string) => {
      if (!endpoint.trim()) {
        actualUrlEl.setText(t('settingsDetails.general.actualRequestUrl', { url: '...' }));
        return;
      }
      const normalized = EndpointNormalizer.normalizeChatCompletions(endpoint);
      actualUrlEl.setText(t('settingsDetails.general.actualRequestUrl', { url: normalized }));
    };

    // 初始化显示
    updateActualUrl(formData.endpoint);

    // 密钥存储模式选择器（仅当 SecretComponent 可用时显示）
    if (secretComponentAvailable) {
      new Setting(contentEl)
        .setName(t('modals.providerEdit.storageMode'))
        .setDesc(t('modals.providerEdit.storageModeDesc'))
        .addDropdown(dropdown => {
          dropdown
            .addOption('local', t('modals.providerEdit.storageModeLocal'))
            .addOption('shared', t('modals.providerEdit.storageModeShared'))
            .setValue(formData.storageMode)
            .onChange((value: string) => {
              const newMode = value as SecretStorageMode;
              // 存储模式切换时的值保留逻辑
              if (formData.storageMode !== newMode) {
                formData.storageMode = newMode;
                updateStorageModeUI();
              }
            });
        });

      // 共享密钥容器 (SecretComponent)
      secretComponentContainer = contentEl.createDiv({ cls: 'secret-component-container' });
      const secretSetting = new Setting(secretComponentContainer)
        .setName(t('modals.providerEdit.sharedSecret'))
        .setDesc(t('modals.providerEdit.sharedSecretDesc'));
      
      // 使用动态创建的 SecretComponent
      secretSetting.controlEl.empty();
      const secretComponent = createSecretComponent(this.app, secretSetting.controlEl);
      if (secretComponent) {
        secretComponent
          .setValue(formData.secretId)
          .onChange((value: string) => {
            formData.secretId = value;
          });
      }
    }

    // 本地密钥容器 (TextComponent with password type)
    localKeyContainer = contentEl.createDiv({ cls: 'local-key-container' });
    let localKeyInput: HTMLInputElement | null = null;
    
    const localKeySetting = new Setting(localKeyContainer)
      .setName(t('modals.providerEdit.apiKey'))
      .setDesc(t('modals.providerEdit.apiKeyDesc'))
      .addText(text => {
        text
          .setPlaceholder(t('modals.providerEdit.apiKeyPlaceholder'))
          .setValue(formData.localValue)
          .onChange(value => {
            formData.localValue = value;
          });
        text.inputEl.type = 'password';
        text.inputEl.setCssProps({ 'min-width': '180px' });
        localKeyInput = text.inputEl;
      })
      .addButton(button => {
        button
          .setIcon('settings')
          .setTooltip(t('modals.providerEdit.manageKeys'))
          .onClick(() => {
            // 打开密钥管理模态窗口
            // 准备 keyConfigs 数组
            let keysToEdit = [...formData.keyConfigs];
            
            // 如果当前有单个密钥但没有多密钥列表，先初始化
            if (keysToEdit.length === 0) {
              if (formData.storageMode === 'shared' && formData.secretId) {
                keysToEdit.push({
                  mode: 'shared',
                  secretId: formData.secretId
                });
              } else if (formData.localValue) {
                keysToEdit.push({
                  mode: 'local',
                  localValue: formData.localValue
                });
              }
            }
            
            new ApiKeyManagerModal(
              this.app,
              keysToEdit,
              (newKeyConfigs) => {
                // 更新 keyConfigs
                formData.keyConfigs = newKeyConfigs;
                // 更新主密钥为第一个
                if (newKeyConfigs.length > 0) {
                  const firstKey = newKeyConfigs[0];
                  formData.storageMode = firstKey.mode;
                  if (firstKey.mode === 'shared') {
                    formData.secretId = firstKey.secretId || '';
                    formData.localValue = '';
                  } else {
                    formData.localValue = firstKey.localValue || '';
                    formData.secretId = '';
                    if (localKeyInput) {
                      localKeyInput.value = formData.localValue;
                    }
                  }
                }
                updateKeyCount();
              },
              formData.endpoint // 传入端点用于健康检查
            ).open();
          });
      });

    // 多密钥数量提示
    keyCountEl = contentEl.createDiv({ cls: 'api-key-count-hint' });
    keyCountEl.setCssProps({
      'font-size': '0.8em',
      color: 'var(--text-accent)',
      'margin-top': '-8px',
      'margin-bottom': '12px'
    });
    updateKeyCount();

    // 初始化存储模式 UI（仅当 SecretComponent 可用时）
    if (secretComponentAvailable) {
      updateStorageModeUI();
    }

    // 按钮容器
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    buttonContainer.setCssProps({
      display: 'flex',
      'justify-content': 'flex-end',
      gap: '8px',
      'margin-top': '16px'
    });

    // 取消按钮
    const cancelButton = buttonContainer.createEl('button', { text: t('common.cancel') });
    cancelButton.addEventListener('click', () => {
      this.close();
    });

    // 保存按钮
    const saveButton = buttonContainer.createEl('button', {
      text: t('common.save'),
      cls: 'mod-cta'
    });
    saveButton.addEventListener('click', async () => {
      try {
        if (!formData.name.trim()) {
          new Notice('❌ ' + t('modals.providerEdit.nameRequired'));
          return;
        }
        if (!formData.endpoint.trim()) {
          new Notice('❌ ' + t('modals.providerEdit.endpointRequired'));
          return;
        }

        // 构建 keyConfig
        const keyConfig: KeyConfig = {
          mode: formData.storageMode,
          secretId: formData.storageMode === 'shared' ? formData.secretId : undefined,
          localValue: formData.storageMode === 'local' ? formData.localValue : undefined
        };

        // 构建 keyConfigs（多密钥）
        const keyConfigs = formData.keyConfigs.length > 0 ? formData.keyConfigs : undefined;

        if (this.isNew) {
          // 创建新供应商
          this.configManager.addProvider({
            name: formData.name.trim(),
            endpoint: formData.endpoint.trim(),
            keyConfig,
            keyConfigs
          });
        } else if (this.provider) {
          // 更新现有供应商
          this.configManager.updateProvider(this.provider.id, {
            name: formData.name.trim(),
            endpoint: formData.endpoint.trim(),
            keyConfig,
            keyConfigs
          });
        }

        this.onSave();
        this.close();
      } catch (error) {
        new Notice('❌ ' + (error instanceof Error ? error.message : String(error)));
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
