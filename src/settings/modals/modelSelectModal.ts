import type { App} from 'obsidian';
import { Modal, setIcon } from 'obsidian';
import type { ModelType } from '../settings';
import { inferModelInfo, createModelTagGroup } from '../../services/ai';
import { t } from '../../i18n';

/**
 * 模型选择弹窗
 * 支持分组显示、搜索和刷新功能
 */
export class ModelSelectModal extends Modal {
  private availableModels: string[];
  private existingModels: string[];
  private onSelect: (selectedModels: string[]) => void;
  private onRefresh: () => Promise<string[]>;
  private selectedModels: Set<string> = new Set();
  private searchQuery: string = '';
  private collapsedGroups: Set<string> = new Set();
  private listContainer: HTMLElement | null = null;
  private activeFilter: 'all' | ModelType = 'all';

  constructor(
    app: App,
    availableModels: string[],
    existingModels: string[],
    onSelect: (selectedModels: string[]) => void,
    onRefresh: () => Promise<string[]>
  ) {
    super(app);
    this.availableModels = availableModels;
    this.existingModels = existingModels;
    this.onSelect = onSelect;
    this.onRefresh = onRefresh;
  }

  /**
   * 从模型 ID 提取分组名称
   * 例如: Qwen/Qwen2.5-72B -> Qwen, Pro/Qwen/Model -> Pro
   */
  private getGroupName(modelId: string): string {
    const parts = modelId.split('/');
    if (parts.length > 1) {
      return parts[0];
    }
    return t('modals.modelSelect.ungrouped');
  }

  /**
   * 将模型按分组组织
   */
  private groupModels(models: string[]): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    
    models.forEach(modelId => {
      const groupName = this.getGroupName(modelId);
      if (!groups.has(groupName)) {
        groups.set(groupName, []);
      }
      groups.get(groupName)!.push(modelId);
    });

    // 按分组名称排序
    return new Map([...groups.entries()].sort((a, b) => {
      // "其他" 分组放最后
      if (a[0] === t('modals.modelSelect.ungrouped')) return 1;
      if (b[0] === t('modals.modelSelect.ungrouped')) return -1;
      return a[0].localeCompare(b[0]);
    }));
  }

  /**
   * 过滤模型
   */
  private filterModels(models: string[]): string[] {
    // 先过滤已存在的模型
    let filtered = models.filter(m => !this.existingModels.includes(m));
    
    // 按类型筛选
    if (this.activeFilter !== 'all') {
      filtered = filtered.filter(m => {
        const { type } = inferModelInfo(m);
        return type === this.activeFilter;
      });
    }
    
    // 再按搜索词过滤
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(m => m.toLowerCase().includes(query));
    }
    
    return filtered;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('model-select-modal');

    // 设置弹窗尺寸
    this.modalEl.setCssProps({
      width: '550px',
      'max-width': '90vw',
      'max-height': '85vh'
    });

    // 头部：标题和刷新按钮
    const headerEl = contentEl.createDiv({ cls: 'modal-header' });
    headerEl.setCssProps({
      display: 'flex',
      'justify-content': 'space-between',
      'align-items': 'center',
      'margin-bottom': '12px'
    });

    const titleEl = headerEl.createDiv();
    titleEl.createEl('h3', { text: t('modals.modelSelect.title') });
    titleEl.setCssProps({ margin: '0' });

    // 刷新按钮
    const refreshBtn = headerEl.createEl('button', { cls: 'clickable-icon' });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.setAttribute('aria-label', t('modals.modelSelect.refresh'));
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.addClass('is-loading');
      setIcon(refreshBtn, 'loader');
      try {
        this.availableModels = await this.onRefresh();
        this.renderList();
      } finally {
        refreshBtn.removeClass('is-loading');
        setIcon(refreshBtn, 'refresh-cw');
      }
    });

    // 搜索框
    const searchContainer = contentEl.createDiv({ cls: 'search-container' });
    searchContainer.setCssProps({
      'margin-bottom': '12px'
    });

    const searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: t('modals.modelSelect.searchPlaceholder'),
      cls: 'model-search-input'
    });
    searchInput.setCssProps({
      width: '100%',
      padding: '8px 12px',
      'border-radius': '6px',
      border: '1px solid var(--background-modifier-border)',
      'background-color': 'var(--background-primary)',
      'font-size': '14px'
    });
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.renderList();
    });

    // 类型筛选标签
    const filterContainer = contentEl.createDiv({ cls: 'model-filter-container' });
    filterContainer.setCssProps({
      display: 'flex',
      gap: '8px',
      'margin-bottom': '12px',
      'flex-wrap': 'wrap'
    });

    // 筛选选项：全部 + 各类型
    const filterOptions: Array<'all' | ModelType> = ['all', 'chat', 'embedding', 'image', 'asr', 'tts'];
    
    filterOptions.forEach(filter => {
      const filterBtn = filterContainer.createEl('button', {
        cls: `model-filter-btn ${this.activeFilter === filter ? 'is-active' : ''}`,
        text: t(`modelTypes.${filter}`)
      });
      filterBtn.setCssProps({
        padding: '4px 12px',
        'border-radius': '16px',
        border: '1px solid var(--background-modifier-border)',
        'background-color': this.activeFilter === filter ? 'var(--interactive-accent)' : 'var(--background-primary)',
        color: this.activeFilter === filter ? 'var(--text-on-accent)' : 'var(--text-normal)',
        cursor: 'pointer',
        'font-size': '0.85em',
        transition: 'all 0.15s ease'
      });
      
      filterBtn.addEventListener('click', () => {
        this.activeFilter = filter;
        this.renderList();
        // 更新按钮样式
        filterContainer.querySelectorAll('.model-filter-btn').forEach(btn => {
          const btnEl = btn as HTMLElement;
          const isActive = btnEl.textContent === t(`modelTypes.${filter}`);
          btnEl.classList.toggle('is-active', isActive);
          btnEl.setCssProps({
            'background-color': isActive ? 'var(--interactive-accent)' : 'var(--background-primary)',
            color: isActive ? 'var(--text-on-accent)' : 'var(--text-normal)'
          });
        });
      });
    });

    // 模型数量提示
    const countEl = contentEl.createDiv({ cls: 'model-count' });
    countEl.setCssProps({
      'font-size': '0.85em',
      color: 'var(--text-muted)',
      'margin-bottom': '8px'
    });
    const newModels = this.availableModels.filter(m => !this.existingModels.includes(m));
    countEl.setText(t('modals.modelSelect.desc', { count: String(newModels.length) }));

    // 模型列表容器
    this.listContainer = contentEl.createDiv({ cls: 'model-select-list' });
    this.listContainer.setCssProps({
      'max-height': '400px',
      'overflow-y': 'auto',
      'margin-bottom': '16px',
      border: '1px solid var(--background-modifier-border)',
      'border-radius': '6px'
    });

    this.renderList();

    // 底部按钮
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    buttonContainer.setCssProps({
      display: 'flex',
      'justify-content': 'space-between',
      'align-items': 'center'
    });

    // 全选按钮
    const selectAllBtn = buttonContainer.createEl('button', { text: t('modals.modelSelect.selectAll') });
    selectAllBtn.addEventListener('click', () => {
      const filteredModels = this.filterModels(this.availableModels);
      const allSelected = filteredModels.every(m => this.selectedModels.has(m));
      
      if (allSelected) {
        filteredModels.forEach(m => this.selectedModels.delete(m));
      } else {
        filteredModels.forEach(m => this.selectedModels.add(m));
      }
      this.renderList();
    });

    // 右侧按钮
    const rightButtons = buttonContainer.createDiv();
    rightButtons.setCssProps({
      display: 'flex',
      gap: '8px'
    });

    const cancelButton = rightButtons.createEl('button', { text: t('common.cancel') });
    cancelButton.addEventListener('click', () => this.close());

    const confirmButton = rightButtons.createEl('button', {
      text: t('modals.modelSelect.addSelected'),
      cls: 'mod-cta'
    });
    confirmButton.addEventListener('click', () => {
      if (this.selectedModels.size > 0) {
        this.onSelect(Array.from(this.selectedModels));
      }
      this.close();
    });
  }

  /**
   * 渲染模型列表
   */
  private renderList(): void {
    if (!this.listContainer) return;
    this.listContainer.empty();

    const filteredModels = this.filterModels(this.availableModels);

    if (filteredModels.length === 0) {
      const emptyEl = this.listContainer.createDiv();
      emptyEl.setText(this.searchQuery ? t('modals.modelSelect.noResults') : t('modals.modelSelect.allExist'));
      emptyEl.setCssProps({
        padding: '20px',
        'text-align': 'center',
        color: 'var(--text-muted)'
      });
      return;
    }

    const groupedModels = this.groupModels(filteredModels);

    groupedModels.forEach((models, groupName) => {
      this.renderGroup(groupName, models);
    });
  }

  /**
   * 渲染分组
   */
  private renderGroup(groupName: string, models: string[]): void {
    if (!this.listContainer) return;

    const isCollapsed = this.collapsedGroups.has(groupName);
    const selectedInGroup = models.filter(m => this.selectedModels.has(m)).length;

    // 分组头部
    const groupHeader = this.listContainer.createDiv({ cls: 'model-group-header' });
    groupHeader.setCssProps({
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'space-between',
      padding: '8px 12px',
      'background-color': 'var(--background-secondary)',
      cursor: 'pointer',
      'border-bottom': '1px solid var(--background-modifier-border)',
      'user-select': 'none'
    });

    const leftPart = groupHeader.createDiv();
    leftPart.setCssProps({
      display: 'flex',
      'align-items': 'center',
      gap: '8px'
    });

    // 展开/收起图标
    const chevron = leftPart.createSpan({ cls: 'group-chevron' });
    setIcon(chevron, isCollapsed ? 'chevron-right' : 'chevron-down');
    chevron.setCssProps({
      width: '16px',
      height: '16px',
      color: 'var(--text-muted)'
    });

    // 分组名称
    const nameEl = leftPart.createSpan({ text: groupName });
    nameEl.setCssProps({
      'font-weight': '500'
    });

    // 数量标签
    const countBadge = leftPart.createSpan({ text: String(models.length) });
    countBadge.setCssProps({
      'font-size': '0.75em',
      color: 'var(--text-faint)',
      padding: '2px 6px',
      'background-color': 'var(--background-primary)',
      'border-radius': '10px'
    });

    // 分组全选按钮
    const groupSelectBtn = groupHeader.createEl('button', { cls: 'clickable-icon' });
    setIcon(groupSelectBtn, selectedInGroup === models.length ? 'check-square' : 'square');
    groupSelectBtn.setCssProps({
      padding: '4px'
    });
    groupSelectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const allSelected = models.every(m => this.selectedModels.has(m));
      if (allSelected) {
        models.forEach(m => this.selectedModels.delete(m));
      } else {
        models.forEach(m => this.selectedModels.add(m));
      }
      this.renderList();
    });

    // 点击头部切换展开/收起
    groupHeader.addEventListener('click', () => {
      if (isCollapsed) {
        this.collapsedGroups.delete(groupName);
      } else {
        this.collapsedGroups.add(groupName);
      }
      this.renderList();
    });

    // 模型列表（如果未收起）
    if (!isCollapsed) {
      models.forEach(modelId => {
        this.renderModelItem(modelId);
      });
    }
  }

  /**
   * 渲染单个模型项
   */
  private renderModelItem(modelId: string): void {
    if (!this.listContainer) return;

    const isSelected = this.selectedModels.has(modelId);

    const itemEl = this.listContainer.createDiv({ cls: 'model-select-item' });
    itemEl.setCssProps({
      display: 'flex',
      'align-items': 'center',
      padding: '8px 12px 8px 36px',
      'border-bottom': '1px solid var(--background-modifier-border)',
      cursor: 'pointer',
      'background-color': isSelected ? 'var(--background-modifier-hover)' : 'transparent'
    });

    // 复选框
    const checkbox = itemEl.createEl('input', { type: 'checkbox' });
    checkbox.checked = isSelected;
    checkbox.setCssProps({
      'margin-right': '10px'
    });

    // 模型名称
    const nameEl = itemEl.createSpan({ text: modelId });
    nameEl.setCssProps({
      flex: '1',
      'font-size': '0.9em'
    });

    // 类型和能力标签 - 使用推断的类型和能力
    const { type, abilities } = inferModelInfo(modelId);
    const tagsEl = itemEl.createSpan({ cls: 'model-type-tags' });
    tagsEl.setCssProps({
      display: 'flex',
      gap: '3px',
      'margin-left': '8px'
    });
    createModelTagGroup(tagsEl, type, abilities);

    // 点击整行切换选中状态
    const toggleSelection = () => {
      if (this.selectedModels.has(modelId)) {
        this.selectedModels.delete(modelId);
      } else {
        this.selectedModels.add(modelId);
      }
      this.renderList();
    };

    itemEl.addEventListener('click', (e) => {
      if (e.target !== checkbox) {
        toggleSelection();
      }
    });

    checkbox.addEventListener('change', toggleSelection);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
