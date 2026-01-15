import type { App} from 'obsidian';
import { Modal, Setting } from 'obsidian';
import { t } from '../../i18n';

/**
 * 模型删除确认弹窗
 */
export class DeleteModelModal extends Modal {
  private modelName: string;
  private onConfirm: () => void;

  constructor(app: App, modelName: string, onConfirm: () => void) {
    super(app);
    this.modelName = modelName;
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
      .setName(t('modals.deleteModel.title'))
      .setHeading();

    // 警告信息
    const warningContainer = contentEl.createDiv({ cls: 'setting-item' });
    warningContainer.setCssProps({
      padding: '12px',
      'margin-bottom': '16px',
      'border-radius': '6px'
    });

    const warningText = warningContainer.createDiv();
    warningText.setText(t('modals.deleteModel.warning', { name: this.modelName }));
    warningText.setCssProps({
      color: 'var(--text-normal)',
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
