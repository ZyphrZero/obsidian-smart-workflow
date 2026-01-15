import type { App} from 'obsidian';
import { Modal } from 'obsidian';
import type { Provider } from '../settings';
import { inferModelInfo, createModelTagGroup } from '../../services/ai';
import { t } from '../../i18n';

/**
 * 测试连接模型选择弹窗
 */
export class TestConnectionModal extends Modal {
  private provider: Provider;
  private onSelect: (modelId: string) => void;

  constructor(
    app: App,
    provider: Provider,
    onSelect: (modelId: string) => void
  ) {
    super(app);
    this.provider = provider;
    this.onSelect = onSelect;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    this.modalEl.setCssProps({
      width: '400px',
      'max-width': '90vw'
    });

    // 标题
    const titleEl = contentEl.createEl('h3', { text: t('modals.testConnection.title') });
    titleEl.setCssProps({ 'margin-top': '0' });

    // 描述
    const descEl = contentEl.createEl('p', { text: t('modals.testConnection.desc') });
    descEl.setCssProps({
      color: 'var(--text-muted)',
      'font-size': '0.9em',
      'margin-bottom': '16px'
    });

    // 模型列表
    const listEl = contentEl.createDiv({ cls: 'test-model-list' });
    listEl.setCssProps({
      'max-height': '300px',
      'overflow-y': 'auto',
      border: '1px solid var(--background-modifier-border)',
      'border-radius': '6px'
    });

    this.provider.models.forEach(model => {
      const itemEl = listEl.createDiv({ cls: 'test-model-item' });
      itemEl.setCssProps({
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        padding: '10px 12px',
        cursor: 'pointer',
        'border-bottom': '1px solid var(--background-modifier-border)'
      });

      // 悬停效果
      itemEl.addEventListener('mouseenter', () => {
        itemEl.setCssProps({ 'background-color': 'var(--background-modifier-hover)' });
      });
      itemEl.addEventListener('mouseleave', () => {
        itemEl.setCssProps({ 'background-color': 'transparent' });
      });

      // 模型名称
      const displayName = model.displayName || model.name;
      const nameEl = itemEl.createSpan({ text: displayName });
      nameEl.setCssProps({ 'font-weight': '500', flex: '1' });

      // 类型和能力标签 - 使用推断或显式配置的类型和能力
      const { type, abilities } = inferModelInfo(model.name, model.type, model.abilities);
      const tagsEl = itemEl.createSpan({ cls: 'model-type-tags' });
      tagsEl.setCssProps({
        display: 'flex',
        gap: '3px'
      });
      createModelTagGroup(tagsEl, type, abilities);

      // 点击选择
      itemEl.addEventListener('click', () => {
        this.onSelect(model.id);
        this.close();
      });
    });

    // 取消按钮
    const buttonContainer = contentEl.createDiv();
    buttonContainer.setCssProps({
      display: 'flex',
      'justify-content': 'flex-end',
      'margin-top': '16px'
    });

    const cancelBtn = buttonContainer.createEl('button', { text: t('common.cancel') });
    cancelBtn.addEventListener('click', () => this.close());
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
