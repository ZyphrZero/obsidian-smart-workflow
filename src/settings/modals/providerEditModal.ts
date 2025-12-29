import { App, Modal, Setting, Notice } from 'obsidian';
import type { ConfigManager } from '../../services/config/configManager';
import type { Provider } from '../settings';
import { t } from '../../i18n';
import { EndpointNormalizer } from '../../services/ai';

/**
 * 供应商编辑弹窗
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

    // 表单数据
    const formData = {
      name: this.provider?.name || '',
      endpoint: this.provider?.endpoint || '',
      apiKey: this.provider?.apiKey || ''
    };

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
      const normalized = EndpointNormalizer.normalizeChatCompletions(endpoint);
      actualUrlEl.setText(t('settingsDetails.general.actualRequestUrl', { url: normalized }));
    };

    // 初始化显示
    updateActualUrl(formData.endpoint);

    // API Key
    new Setting(contentEl)
      .setName(t('modals.providerEdit.apiKey'))
      .setDesc(t('modals.providerEdit.apiKeyDesc'))
      .addText(text => {
        text
          .setPlaceholder('sk-...')
          .setValue(formData.apiKey)
          .onChange(value => {
            formData.apiKey = value;
          });
        text.inputEl.type = 'password';
        text.inputEl.setCssProps({ 'min-width': '200px' });
      });

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

        if (this.isNew) {
          // 创建新供应商（不添加默认模型，用户需要手动添加）
          this.configManager.addProvider({
            name: formData.name.trim(),
            endpoint: formData.endpoint.trim(),
            apiKey: formData.apiKey
          });
        } else if (this.provider) {
          // 更新现有供应商
          this.configManager.updateProvider(this.provider.id, {
            name: formData.name.trim(),
            endpoint: formData.endpoint.trim(),
            apiKey: formData.apiKey
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
