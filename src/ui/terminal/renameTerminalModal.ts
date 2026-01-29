/**
 * 终端重命名模态框
 */

import type { App} from 'obsidian';
import { Modal, Setting } from 'obsidian';
import { t } from '../../i18n';

export class RenameTerminalModal extends Modal {
  private currentTitle: string;
  private onSubmit: (newTitle: string) => void;
  private inputValue: string;

  constructor(app: App, currentTitle: string, onSubmit: (newTitle: string) => void) {
    super(app);
    this.currentTitle = currentTitle;
    this.inputValue = currentTitle;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h3', { text: t('terminal.renameTerminal') });

    new Setting(contentEl)
      .setName(t('terminal.renameTerminalPlaceholder'))
      .addText((text) => {
        text
          .setValue(this.currentTitle)
          .onChange((value) => {
            this.inputValue = value;
          });
        
        // 自动聚焦并选中文本
        setTimeout(() => {
          text.inputEl.focus();
          text.inputEl.select();
        }, 10);

        // 回车确认
        text.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.submit();
          }
        });
      });

    new Setting(contentEl)
      .addButton((btn) => {
        btn
          .setButtonText(t('common.cancel'))
          .onClick(() => this.close());
      })
      .addButton((btn) => {
        btn
          .setButtonText(t('common.confirm'))
          .setCta()
          .onClick(() => this.submit());
      });
  }

  private submit(): void {
    if (this.inputValue.trim()) {
      this.onSubmit(this.inputValue);
    }
    this.close();
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export default RenameTerminalModal;
