/**
 * 快捷键输入组件
 * 通用的快捷键录入和显示组件
 */

import type { App} from 'obsidian';
import { Setting, setIcon } from 'obsidian';
import { t } from '../../i18n';

export interface HotkeyInputOptions {
  /** Obsidian App 实例 */
  app: App;
  /** 容器元素 */
  containerEl: HTMLElement;
  /** 命令 ID（不含插件前缀） */
  commandId: string;
  /** 显示名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 插件 ID（默认：obsidian-smart-workflow） */
  pluginId?: string;
  /** 刷新回调 */
  onRefresh?: () => void;
  /** i18n 键前缀（用于获取 noHotkeySet、pressKey、resetHotkey 翻译） */
  i18nPrefix?: string;
}

/**
 * 快捷键输入组件类
 */
export class HotkeyInput {
  private app: App;
  private containerEl: HTMLElement;
  private commandId: string;
  private name: string;
  private description: string;
  private pluginId: string;
  private onRefresh?: () => void;
  private i18nPrefix: string;

  constructor(options: HotkeyInputOptions) {
    this.app = options.app;
    this.containerEl = options.containerEl;
    this.commandId = options.commandId;
    this.name = options.name;
    this.description = options.description;
    this.pluginId = options.pluginId || 'obsidian-smart-workflow';
    this.onRefresh = options.onRefresh;
    this.i18nPrefix = options.i18nPrefix || 'common.hotkey';

    this.render();
  }

  /**
   * 渲染组件
   */
  private render(): void {
    const currentHotkey = this.getCommandHotkey();

    const setting = new Setting(this.containerEl)
      .setName(this.name)
      .setDesc(this.description);

    // 快捷键按钮容器
    const hotkeyContainer = setting.controlEl.createDiv({ cls: 'hotkey-input-container' });
    hotkeyContainer.style.display = 'flex';
    hotkeyContainer.style.alignItems = 'center';
    hotkeyContainer.style.gap = '8px';

    // 快捷键显示/录入按钮
    const hotkeyBtn = hotkeyContainer.createEl('button', { cls: 'setting-hotkey' });
    hotkeyBtn.style.minWidth = '100px';
    hotkeyBtn.style.padding = '4px 12px';
    hotkeyBtn.style.borderRadius = '4px';
    hotkeyBtn.style.border = '1px solid var(--background-modifier-border)';
    hotkeyBtn.style.backgroundColor = 'var(--background-primary)';
    hotkeyBtn.style.cursor = 'pointer';
    hotkeyBtn.style.fontFamily = 'inherit';
    hotkeyBtn.style.fontSize = '0.9em';

    const updateButtonText = () => {
      const hotkey = this.getCommandHotkey();
      if (hotkey) {
        hotkeyBtn.setText(hotkey);
        hotkeyBtn.style.color = 'var(--text-normal)';
      } else {
        hotkeyBtn.setText(this.getI18n('noHotkeySet'));
        hotkeyBtn.style.color = 'var(--text-faint)';
      }
    };

    updateButtonText();

    let isRecording = false;

    hotkeyBtn.addEventListener('click', () => {
      if (isRecording) return;

      isRecording = true;
      hotkeyBtn.setText(this.getI18n('pressKey'));
      hotkeyBtn.style.color = 'var(--text-accent)';
      hotkeyBtn.style.borderColor = 'var(--interactive-accent)';

      const handleKeyDown = async (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // 忽略单独的修饰键
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
          return;
        }

        // Escape 取消录入
        if (e.key === 'Escape') {
          cleanup();
          updateButtonText();
          return;
        }

        // 构建快捷键
        const modifiers: string[] = [];
        if (e.ctrlKey || e.metaKey) modifiers.push('Mod');
        if (e.altKey) modifiers.push('Alt');
        if (e.shiftKey) modifiers.push('Shift');

        const hotkey = {
          modifiers,
          key: e.key,
        };

        await this.setCommandHotkey(hotkey);
        cleanup();
        this.onRefresh?.();
      };

      const cleanup = () => {
        isRecording = false;
        hotkeyBtn.style.borderColor = 'var(--background-modifier-border)';
        document.removeEventListener('keydown', handleKeyDown, true);
      };

      document.addEventListener('keydown', handleKeyDown, true);

      // 点击其他地方取消
      setTimeout(() => {
        const handleClickOutside = (e: MouseEvent) => {
          if (!hotkeyBtn.contains(e.target as Node)) {
            cleanup();
            updateButtonText();
            document.removeEventListener('click', handleClickOutside, true);
          }
        };
        document.addEventListener('click', handleClickOutside, true);
      }, 100);
    });

    // 恢复默认按钮（清除快捷键）- 仅在有快捷键时显示
    if (currentHotkey) {
      const resetBtn = hotkeyContainer.createEl('button', {
        cls: 'clickable-icon',
        attr: { 'aria-label': this.getI18n('resetHotkey') }
      });
      setIcon(resetBtn, 'rotate-ccw');
      resetBtn.style.color = 'var(--text-muted)';
      resetBtn.addEventListener('click', async () => {
        await this.clearCommandHotkey();
        this.onRefresh?.();
      });
    }
  }

  /**
   * 获取 i18n 翻译
   */
  private getI18n(key: string): string {
    // 尝试使用指定前缀
    const fullKey = `${this.i18nPrefix}.${key}`;
    const result = t(fullKey as never);
    
    // 如果翻译不存在，使用通用默认值
    if (result === fullKey) {
      const defaults: Record<string, string> = {
        noHotkeySet: 'Not set',
        pressKey: 'Press key...',
        resetHotkey: 'Clear hotkey',
      };
      return defaults[key] || key;
    }
    
    return result;
  }

  /**
   * 获取完整命令 ID
   */
  private getFullCommandId(): string {
    return `${this.pluginId}:${this.commandId}`;
  }

  /**
   * 获取命令的当前快捷键
   */
  private getCommandHotkey(): string {
    const fullCommandId = this.getFullCommandId();

    try {
      // @ts-expect-error - 访问 Obsidian 内部 API
      const hotkeyManager = this.app.hotkeyManager;

      if (!hotkeyManager) {
        return '';
      }

      const hotkeys = hotkeyManager.getHotkeys(fullCommandId);

      if (hotkeys && hotkeys.length > 0) {
        return this.formatHotkey(hotkeys[0]);
      }
    } catch (e) {
      console.error('[HotkeyInput] Error getting hotkey:', e);
    }

    return '';
  }

  /**
   * 格式化快捷键显示
   */
  private formatHotkey(hotkey: { modifiers: string[]; key: string }): string {
    const parts: string[] = [];

    if (hotkey.modifiers.includes('Ctrl') || hotkey.modifiers.includes('Mod')) {
      parts.push('Ctrl');
    }
    if (hotkey.modifiers.includes('Alt')) {
      parts.push('Alt');
    }
    if (hotkey.modifiers.includes('Shift')) {
      parts.push('Shift');
    }
    if (hotkey.modifiers.includes('Meta')) {
      parts.push('Meta');
    }

    // 格式化按键名称
    let keyName = hotkey.key;
    if (keyName.length === 1) {
      keyName = keyName.toUpperCase();
    } else if (keyName.startsWith('Key')) {
      keyName = keyName.slice(3);
    } else if (keyName.startsWith('Digit')) {
      keyName = keyName.slice(5);
    }

    parts.push(keyName);
    return parts.join(' + ');
  }

  /**
   * 设置命令的快捷键
   */
  private async setCommandHotkey(hotkey: { modifiers: string[]; key: string }): Promise<void> {
    const fullCommandId = this.getFullCommandId();

    try {
      // @ts-expect-error - 访问 Obsidian 内部 API
      const hotkeyManager = this.app.hotkeyManager;

      if (!hotkeyManager) {
        return;
      }

      hotkeyManager.setHotkeys(fullCommandId, [hotkey]);
      await hotkeyManager.save();
      hotkeyManager.bake();
    } catch (e) {
      console.error('[HotkeyInput] Error setting hotkey:', e);
    }
  }

  /**
   * 清除命令的快捷键
   */
  private async clearCommandHotkey(): Promise<void> {
    const fullCommandId = this.getFullCommandId();

    try {
      // @ts-expect-error - 访问 Obsidian 内部 API
      const hotkeyManager = this.app.hotkeyManager;

      if (!hotkeyManager) {
        return;
      }

      hotkeyManager.removeHotkeys(fullCommandId);
      await hotkeyManager.save();
      hotkeyManager.bake();
    } catch (e) {
      console.error('[HotkeyInput] Error clearing hotkey:', e);
    }
  }
}

/**
 * 便捷函数：创建快捷键输入组件
 */
export function createHotkeyInput(options: HotkeyInputOptions): HotkeyInput {
  return new HotkeyInput(options);
}
