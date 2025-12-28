/**
 * 卡片式设置容器组件
 * 提供统一的设置卡片样式
 */

/**
 * 创建卡片式设置容器
 * @param containerEl 父容器元素
 * @returns 卡片容器元素
 */
export function createSettingCard(containerEl: HTMLElement): HTMLElement {
  const card = containerEl.createDiv();
  card.style.padding = '16px';
  card.style.borderRadius = '8px';
  card.style.backgroundColor = 'var(--background-secondary)';
  card.style.marginBottom = '10px';
  return card;
}
