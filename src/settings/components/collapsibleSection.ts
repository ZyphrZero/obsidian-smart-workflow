import { setIcon } from 'obsidian';

/**
 * 可折叠区块组件
 * 提供可展开/收起的设置区块
 */

/**
 * 创建可折叠的设置区块
 * @param containerEl 父容器元素
 * @param sectionId 区块唯一标识
 * @param title 区块标题
 * @param description 区块描述
 * @param expandedSections 已展开区块的 Set
 * @param renderContent 渲染内容的回调函数
 * @param onToggle 展开/收起状态变化时的回调（可选）
 */
export function createCollapsibleSection(
  containerEl: HTMLElement,
  sectionId: string,
  title: string,
  description: string,
  expandedSections: Set<string>,
  renderContent: (contentEl: HTMLElement) => void,
  onToggle?: () => void
): void {
  const isExpanded = expandedSections.has(sectionId);

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
    const willExpand = !expandedSections.has(sectionId);
    
    if (willExpand) {
      expandedSections.add(sectionId);
      contentEl.style.display = 'block';
      headerEl.addClass('is-expanded');
      setIcon(iconEl, 'chevron-down');
      
      // 如果内容还未渲染，现在渲染
      if (contentEl.children.length === 0) {
        renderContent(contentEl);
      }
    } else {
      expandedSections.delete(sectionId);
      contentEl.style.display = 'none';
      headerEl.removeClass('is-expanded');
      setIcon(iconEl, 'chevron-right');
    }
    
    // 调用状态变化回调
    onToggle?.();
  });

  // 设置初始状态
  if (isExpanded) {
    headerEl.addClass('is-expanded');
    renderContent(contentEl);
  }
}
