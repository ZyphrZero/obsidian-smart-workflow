/**
 * CategoryConfirmModal - 分类确认对话框
 *
 * 显示AI推荐的分类，允许用户选择、编辑或创建新分类
 */

import type { App} from 'obsidian';
import { Modal, Setting } from 'obsidian';
import type { CategorySuggestion } from '../../services/categorizing';
import { t } from '../../i18n';

/**
 * 分类确认对话框
 */
export class CategoryConfirmModal extends Modal {
  private suggestions: CategorySuggestion[];
  private selectedSuggestion: CategorySuggestion | null = null;
  private onConfirm: (suggestion: CategorySuggestion | null) => void;
  private customPath: string = '';

  constructor(
    app: App,
    suggestions: CategorySuggestion[],
    onConfirm: (suggestion: CategorySuggestion | null) => void
  ) {
    super(app);
    this.suggestions = suggestions;
    this.onConfirm = onConfirm;

    // 默认选择第一个建议（如果有）
    if (suggestions.length > 0) {
      this.selectedSuggestion = suggestions[0];
    }
  }

  onOpen() {
    const { contentEl } = this;

    // 清空之前的内容，避免重复渲染时内容累积
    contentEl.empty();

    // 标题
    contentEl.createEl('h2', { text: t('archiving.modal.title') });

    // 如果没有建议
    if (this.suggestions.length === 0) {
      contentEl.createEl('p', {
        text: t('archiving.modal.noSuggestions'),
        cls: 'mod-warning',
      });
    } else {
      // 显示建议说明
      contentEl.createEl('p', {
        text: t('archiving.modal.suggestionsDesc'),
        cls: 'setting-item-description',
      });

      // 渲染分类建议列表
      this.renderSuggestions(contentEl);
    }

    // 自定义路径选项
    this.renderCustomPath(contentEl);

    // 按钮区域
    this.renderButtons(contentEl);
  }

  /**
   * 渲染分类建议列表
   */
  private renderSuggestions(containerEl: HTMLElement): void {
    const suggestionsContainer = containerEl.createDiv({ cls: 'category-suggestions' });

    this.suggestions.forEach((suggestion) => {
      const suggestionItem = suggestionsContainer.createDiv({ 
        cls: `category-suggestion-item${this.selectedSuggestion === suggestion ? ' is-selected' : ''}`
      });

      // 点击选择
      suggestionItem.addEventListener('click', () => {
        this.selectedSuggestion = suggestion;
        this.customPath = ''; // 清空自定义路径
        this.onOpen(); // 重新渲染
      });

      // 鼠标悬停效果 - 由 CSS 处理

      // 分类名称和置信度
      const headerRow = suggestionItem.createDiv({ cls: 'suggestion-header' });

      headerRow.createEl('strong', { text: suggestion.name });

      headerRow.createEl('span', {
        text: `${(suggestion.confidence * 100).toFixed(0)}%`,
      });

      // 路径
      suggestionItem.createDiv({ 
        text: suggestion.path,
        cls: 'suggestion-path'
      });

      // 新建标记
      if (suggestion.isNew) {
        suggestionItem.createEl('span', { 
          text: t('archiving.modal.newBadge'),
          cls: 'category-new-badge'
        });
      }

      // AI推理说明
      if (suggestion.reasoning) {
        suggestionItem.createDiv({ 
          text: `💡 ${suggestion.reasoning}`,
          cls: 'suggestion-reasoning'
        });
      }
    });
  }

  /**
   * 渲染自定义路径输入
   */
  private renderCustomPath(containerEl: HTMLElement): void {
    const customSection = containerEl.createDiv({ cls: 'category-custom-path' });

    new Setting(customSection)
      .setName(t('archiving.modal.customPathTitle'))
      .setDesc(t('archiving.modal.customPathDesc'))
      .addText(text => {
        text
          .setPlaceholder(t('archiving.modal.customPathPlaceholder'))
          .setValue(this.customPath)
          .onChange(value => {
            this.customPath = value;
            if (value.trim()) {
              this.selectedSuggestion = null; // 清空选中的建议
            }
          });
        text.inputEl.style.width = '100%';

        // 回车键提交
        text.inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.confirm();
          }
        });
      });
  }

  /**
   * 渲染按钮区域
   */
  private renderButtons(containerEl: HTMLElement): void {
    const buttonContainer = containerEl.createDiv({ cls: 'modal-button-container' });

    // 取消按钮
    const cancelBtn = buttonContainer.createEl('button', { text: t('archiving.modal.cancel') });
    cancelBtn.addEventListener('click', () => {
      this.close();
    });

    // 确认按钮
    const confirmBtn = buttonContainer.createEl('button', {
      text: t('archiving.modal.confirm'),
      cls: 'mod-cta',
    });
    confirmBtn.addEventListener('click', () => {
      this.confirm();
    });
  }

  /**
   * 确认归档
   */
  private confirm(): void {
    let finalSuggestion: CategorySuggestion | null = null;

    if (this.customPath.trim()) {
      // 使用自定义路径
      finalSuggestion = {
        path: this.customPath.trim(),
        name: this.customPath.trim().split('/').pop() || this.customPath.trim(),
        confidence: 1.0,
        isNew: true,
      };
    } else if (this.selectedSuggestion) {
      // 使用选中的建议
      finalSuggestion = this.selectedSuggestion;
    }

    this.onConfirm(finalSuggestion);
    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
