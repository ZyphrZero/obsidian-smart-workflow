import { App, Modal, Setting, Notice, setIcon } from 'obsidian';
import { t } from '../../i18n';

/** 密钥健康状态 */
type KeyHealthStatus = 'unknown' | 'checking' | 'healthy' | 'unhealthy';

/**
 * API 密钥管理模态窗口
 * 支持添加、删除、排序多个 API 密钥，以及健康度检查
 */
export class ApiKeyManagerModal extends Modal {
  private apiKeys: string[];
  private onSave: (keys: string[]) => void;
  private endpoint: string;
  private keyHealthStatus: Map<number, KeyHealthStatus> = new Map();
  private isCheckingAll = false;

  constructor(
    app: App,
    apiKeys: string[],
    onSave: (keys: string[]) => void,
    endpoint?: string
  ) {
    super(app);
    // 复制数组避免直接修改原数据
    this.apiKeys = [...apiKeys];
    this.onSave = onSave;
    this.endpoint = endpoint || '';
  }

  onOpen() {
    this.render();
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();

    // 设置弹窗宽度
    this.modalEl.setCssProps({
      width: '550px',
      'max-width': '90vw'
    });

    // 标题
    new Setting(contentEl)
      .setName(t('modals.apiKeyManager.title'))
      .setDesc(t('modals.apiKeyManager.desc'))
      .setHeading();

    // 密钥数量提示和全部检查按钮
    const headerContainer = contentEl.createDiv({ cls: 'api-key-header' });
    headerContainer.style.display = 'flex';
    headerContainer.style.justifyContent = 'space-between';
    headerContainer.style.alignItems = 'center';
    headerContainer.style.marginBottom = '12px';

    const countEl = headerContainer.createDiv({ cls: 'api-key-count' });
    countEl.style.fontSize = '0.85em';
    countEl.style.color = 'var(--text-muted)';
    countEl.setText(t('modals.apiKeyManager.keyCount', { count: this.apiKeys.length }));

    // 全部检查按钮
    if (this.apiKeys.length > 0 && this.endpoint) {
      const checkAllBtn = headerContainer.createEl('button', {
        cls: 'mod-cta',
        text: this.isCheckingAll 
          ? t('modals.apiKeyManager.checkingAll') 
          : t('modals.apiKeyManager.checkAll')
      });
      checkAllBtn.style.fontSize = '0.85em';
      checkAllBtn.disabled = this.isCheckingAll;
      checkAllBtn.addEventListener('click', () => this.checkAllKeys());
    }

    // 密钥列表容器
    const listEl = contentEl.createDiv({ cls: 'api-key-list' });
    listEl.style.maxHeight = '300px';
    listEl.style.overflowY = 'auto';
    listEl.style.marginBottom = '12px';

    // 渲染每个密钥
    this.apiKeys.forEach((key, index) => {
      this.renderKeyItem(listEl, key, index);
    });

    // 添加新密钥
    const addContainer = contentEl.createDiv({ cls: 'api-key-add' });
    addContainer.style.marginBottom = '16px';

    let newKeyInput: HTMLInputElement;
    new Setting(addContainer)
      .setName(t('modals.apiKeyManager.addKey'))
      .addText(text => {
        text
          .setPlaceholder('sk-...')
          .onChange(() => {});
        text.inputEl.type = 'password';
        text.inputEl.style.minWidth = '200px';
        newKeyInput = text.inputEl;
      })
      .addButton(button => button
        .setIcon('plus')
        .setCta()
        .onClick(() => {
          const newKey = newKeyInput.value.trim();
          if (!newKey) {
            new Notice('❌ ' + t('modals.apiKeyManager.keyEmpty'));
            return;
          }
          if (this.apiKeys.includes(newKey)) {
            new Notice('❌ ' + t('modals.apiKeyManager.keyDuplicate'));
            return;
          }
          this.apiKeys.push(newKey);
          this.render();
        }));

    // 批量导入提示
    const importHint = contentEl.createDiv({ cls: 'api-key-import-hint' });
    importHint.style.fontSize = '0.8em';
    importHint.style.color = 'var(--text-muted)';
    importHint.style.marginBottom = '16px';
    importHint.setText(t('modals.apiKeyManager.importHint'));

    // 按钮容器
    const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'flex-end';
    buttonContainer.style.gap = '8px';

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
    saveButton.addEventListener('click', () => {
      this.onSave(this.apiKeys);
      this.close();
    });
  }

  private renderKeyItem(containerEl: HTMLElement, key: string, index: number) {
    const itemEl = containerEl.createDiv({ cls: 'api-key-item' });
    itemEl.style.display = 'flex';
    itemEl.style.alignItems = 'center';
    itemEl.style.gap = '8px';
    itemEl.style.padding = '8px';
    itemEl.style.marginBottom = '4px';
    itemEl.style.borderRadius = '4px';
    itemEl.style.backgroundColor = 'var(--background-secondary)';

    // 序号
    const indexEl = itemEl.createSpan({ cls: 'api-key-index' });
    indexEl.style.minWidth = '24px';
    indexEl.style.color = 'var(--text-muted)';
    indexEl.style.fontSize = '0.85em';
    indexEl.setText(`#${index + 1}`);

    // 健康状态指示器
    const statusEl = itemEl.createSpan({ cls: 'api-key-status' });
    statusEl.style.minWidth = '20px';
    statusEl.style.textAlign = 'center';
    this.updateStatusIndicator(statusEl, index);

    // 密钥显示（脱敏）
    const keyEl = itemEl.createSpan({ cls: 'api-key-value' });
    keyEl.style.flex = '1';
    keyEl.style.fontFamily = 'monospace';
    keyEl.style.fontSize = '0.85em';
    keyEl.setText(this.maskKey(key));

    // 健康检查按钮
    if (this.endpoint) {
      const checkBtn = itemEl.createEl('button', { cls: 'clickable-icon' });
      const status = this.keyHealthStatus.get(index);
      if (status === 'checking') {
        setIcon(checkBtn, 'loader-2');
        checkBtn.disabled = true;
        checkBtn.style.animation = 'spin 1s linear infinite';
      } else {
        setIcon(checkBtn, 'activity');
      }
      checkBtn.setAttribute('aria-label', t('modals.apiKeyManager.checkHealth'));
      checkBtn.addEventListener('click', () => this.checkKeyHealth(index));
    }

    // 上移按钮
    if (index > 0) {
      const upBtn = itemEl.createEl('button', { cls: 'clickable-icon' });
      setIcon(upBtn, 'chevron-up');
      upBtn.setAttribute('aria-label', t('modals.apiKeyManager.moveUp'));
      upBtn.addEventListener('click', () => {
        [this.apiKeys[index - 1], this.apiKeys[index]] = [this.apiKeys[index], this.apiKeys[index - 1]];
        // 同步交换健康状态
        const status1 = this.keyHealthStatus.get(index - 1);
        const status2 = this.keyHealthStatus.get(index);
        if (status1 !== undefined) this.keyHealthStatus.set(index, status1);
        else this.keyHealthStatus.delete(index);
        if (status2 !== undefined) this.keyHealthStatus.set(index - 1, status2);
        else this.keyHealthStatus.delete(index - 1);
        this.render();
      });
    }

    // 下移按钮
    if (index < this.apiKeys.length - 1) {
      const downBtn = itemEl.createEl('button', { cls: 'clickable-icon' });
      setIcon(downBtn, 'chevron-down');
      downBtn.setAttribute('aria-label', t('modals.apiKeyManager.moveDown'));
      downBtn.addEventListener('click', () => {
        [this.apiKeys[index], this.apiKeys[index + 1]] = [this.apiKeys[index + 1], this.apiKeys[index]];
        // 同步交换健康状态
        const status1 = this.keyHealthStatus.get(index);
        const status2 = this.keyHealthStatus.get(index + 1);
        if (status1 !== undefined) this.keyHealthStatus.set(index + 1, status1);
        else this.keyHealthStatus.delete(index + 1);
        if (status2 !== undefined) this.keyHealthStatus.set(index, status2);
        else this.keyHealthStatus.delete(index);
        this.render();
      });
    }

    // 删除按钮
    const deleteBtn = itemEl.createEl('button', { cls: 'clickable-icon' });
    setIcon(deleteBtn, 'trash-2');
    deleteBtn.style.color = 'var(--text-error)';
    deleteBtn.setAttribute('aria-label', t('common.delete'));
    deleteBtn.addEventListener('click', () => {
      this.apiKeys.splice(index, 1);
      this.keyHealthStatus.delete(index);
      // 重新映射后续索引的状态
      const newStatusMap = new Map<number, KeyHealthStatus>();
      this.keyHealthStatus.forEach((status, idx) => {
        if (idx > index) {
          newStatusMap.set(idx - 1, status);
        } else if (idx < index) {
          newStatusMap.set(idx, status);
        }
      });
      this.keyHealthStatus = newStatusMap;
      this.render();
    });
  }

  /**
   * 更新状态指示器
   */
  private updateStatusIndicator(el: HTMLElement, index: number) {
    const status = this.keyHealthStatus.get(index);
    el.empty();
    
    // 未检查时不显示任何内容
    if (!status || status === 'unknown') {
      el.style.display = 'none';
      return;
    }
    
    el.style.display = 'inline';
    
    switch (status) {
      case 'checking':
        el.setText('⏳');
        el.setAttribute('title', t('modals.apiKeyManager.statusChecking'));
        break;
      case 'healthy':
        el.setText('✅');
        el.setAttribute('title', t('modals.apiKeyManager.statusHealthy'));
        break;
      case 'unhealthy':
        el.setText('❌');
        el.setAttribute('title', t('modals.apiKeyManager.statusUnhealthy'));
        break;
    }
  }

  /**
   * 检查单个密钥健康度
   */
  private async checkKeyHealth(index: number): Promise<void> {
    if (!this.endpoint) return;
    
    const key = this.apiKeys[index];
    this.keyHealthStatus.set(index, 'checking');
    this.render();

    try {
      const isHealthy = await this.testApiKey(key);
      this.keyHealthStatus.set(index, isHealthy ? 'healthy' : 'unhealthy');
    } catch {
      this.keyHealthStatus.set(index, 'unhealthy');
    }
    
    this.render();
  }

  /**
   * 检查所有密钥健康度
   */
  private async checkAllKeys(): Promise<void> {
    if (!this.endpoint || this.isCheckingAll) return;
    
    this.isCheckingAll = true;
    this.render();

    // 并行检查所有密钥
    const promises = this.apiKeys.map(async (key, index) => {
      this.keyHealthStatus.set(index, 'checking');
      this.render();
      
      try {
        const isHealthy = await this.testApiKey(key);
        this.keyHealthStatus.set(index, isHealthy ? 'healthy' : 'unhealthy');
      } catch {
        this.keyHealthStatus.set(index, 'unhealthy');
      }
    });

    await Promise.all(promises);
    
    this.isCheckingAll = false;
    this.render();

    // 显示结果统计
    const healthyCount = Array.from(this.keyHealthStatus.values()).filter(s => s === 'healthy').length;
    const unhealthyCount = Array.from(this.keyHealthStatus.values()).filter(s => s === 'unhealthy').length;
    new Notice(t('modals.apiKeyManager.checkAllResult', { 
      healthy: healthyCount, 
      unhealthy: unhealthyCount 
    }));
  }

  /**
   * 测试 API 密钥是否有效
   * 使用极简请求测试连接
   */
  private async testApiKey(apiKey: string): Promise<boolean> {
    // 构建完整端点，复用 EndpointNormalizer 的逻辑
    let endpoint = this.endpoint.trim();
    
    // 检查是否已经是完整的 chat/completions 或 responses 端点
    if (!endpoint.endsWith('/chat/completions') && !endpoint.endsWith('/responses')) {
      // 检查是否以 /v1 结尾（标准 OpenAI 格式）
      if (endpoint.endsWith('/v1')) {
        endpoint += '/chat/completions';
      }
      // 检查是否以 /openai 结尾（Gemini 等兼容格式）
      else if (endpoint.endsWith('/openai')) {
        endpoint += '/chat/completions';
      }
      // 其他情况，追加完整路径
      else if (endpoint.endsWith('/')) {
        endpoint += 'v1/chat/completions';
      } else {
        endpoint += '/v1/chat/completions';
      }
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o', // 使用通用模型名，大多数兼容 API 都支持
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
      });

      // 401/403 表示密钥无效，其他错误（如 404 模型不存在）可能是配置问题但密钥本身有效
      if (response.status === 401 || response.status === 403) {
        return false;
      }
      
      // 200 或其他非认证错误都认为密钥有效
      return true;
    } catch {
      // 网络错误，无法判断密钥状态
      return false;
    }
  }

  /**
   * 脱敏显示密钥
   */
  private maskKey(key: string): string {
    if (key.length <= 8) {
      return '****';
    }
    return key.substring(0, 4) + '****' + key.substring(key.length - 4);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
