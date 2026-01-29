/**
 * 终端设置渲染器
 * 负责渲染终端相关的所有设置
 */

import { Setting, Notice } from 'obsidian';
import type { RendererContext } from '../types';
import type { 
  ShellType 
} from '../settings';
import { 
  getCurrentPlatformShell, 
  setCurrentPlatformShell, 
  getCurrentPlatformCustomShellPath, 
  setCurrentPlatformCustomShellPath 
} from '../settings';
import { BaseSettingsRenderer } from './baseRenderer';
import { validateShellPath } from '../utils/settingsUtils';
import { t } from '../../i18n';

/**
 * 终端设置渲染器
 * 处理 Shell 程序、实例行为、主题和外观设置的渲染
 */
export class TerminalSettingsRenderer extends BaseSettingsRenderer {
  /**
   * 渲染终端设置
   * @param context 渲染器上下文
   */
  render(context: RendererContext): void {
    this.context = context;
    const containerEl = context.containerEl;

    // Shell 程序设置卡片
    this.renderShellSettings(containerEl);

    // 实例行为设置卡片
    this.renderInstanceBehaviorSettings(containerEl);

    // 主题设置卡片
    this.renderThemeSettings(containerEl);

    // 外观设置卡片
    this.renderAppearanceSettings(containerEl);

    // 行为设置卡片
    this.renderBehaviorSettings(containerEl);

    // 功能显示设置卡片
    this.renderVisibilitySettings(containerEl);
  }

  /**
   * 渲染 Shell 程序设置
   */
  private renderShellSettings(containerEl: HTMLElement): void {
    const shellCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.shellSettings'))
      .setHeading();

    // 默认 Shell 程序选择
    const currentShell = getCurrentPlatformShell(this.context.plugin.settings.terminal);
    
    const shellDropdownSetting = new Setting(shellCard)
      .setName(t('settingsDetails.terminal.defaultShell'))
      .setDesc(t('settingsDetails.terminal.defaultShellDesc'))
      .addDropdown(dropdown => {
        // 根据平台显示不同的选项
        if (process.platform === 'win32') {
          dropdown.addOption('cmd', t('shellOptions.cmd'));
          dropdown.addOption('powershell', t('shellOptions.powershell'));
          dropdown.addOption('gitbash', t('shellOptions.gitbash'));
          dropdown.addOption('wsl', t('shellOptions.wsl'));
        } else if (process.platform === 'darwin' || process.platform === 'linux') {
          dropdown.addOption('bash', t('shellOptions.bash'));
          dropdown.addOption('zsh', t('shellOptions.zsh'));
        }
        dropdown.addOption('custom', t('shellOptions.custom'));

        dropdown.setValue(currentShell);
        dropdown.onChange(async (value) => {
          setCurrentPlatformShell(this.context.plugin.settings.terminal, value as ShellType);
          await this.saveSettings();
          
          // 使用局部更新替代全量刷新
          this.toggleConditionalSection(
            shellCard,
            'custom-shell-path',
            value === 'custom',
            (el) => this.renderCustomShellPathSetting(el),
            shellDropdownSetting.settingEl
          );
        });
      });

    // 自定义程序路径（仅在选择 custom 时显示）- 初始渲染
    this.toggleConditionalSection(
      shellCard,
      'custom-shell-path',
      currentShell === 'custom',
      (el) => this.renderCustomShellPathSetting(el),
      shellDropdownSetting.settingEl
    );

    // 默认启动参数
    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.defaultArgs'))
      .setDesc(t('settingsDetails.terminal.defaultArgsDesc'))
      .addText(text => text
        .setPlaceholder(t('settingsDetails.terminal.defaultArgsPlaceholder'))
        .setValue(this.context.plugin.settings.terminal.shellArgs.join(' '))
        .onChange(async (value) => {
          // 将字符串分割为数组，过滤空字符串
          this.context.plugin.settings.terminal.shellArgs = value
            .split(' ')
            .filter(arg => arg.trim().length > 0);
          await this.saveSettings();
        }));

    // 自动进入项目目录
    new Setting(shellCard)
      .setName(t('settingsDetails.terminal.autoEnterVault'))
      .setDesc(t('settingsDetails.terminal.autoEnterVaultDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.terminal.autoEnterVaultDirectory)
        .onChange(async (value) => {
          this.context.plugin.settings.terminal.autoEnterVaultDirectory = value;
          await this.saveSettings();
        }));
  }

  /**
   * 渲染自定义 Shell 路径设置
   * 提取为独立方法，用于 toggleConditionalSection 调用
   */
  private renderCustomShellPathSetting(container: HTMLElement): void {
    const currentCustomPath = getCurrentPlatformCustomShellPath(this.context.plugin.settings.terminal);
    
    new Setting(container)
      .setName(t('settingsDetails.terminal.customShellPath'))
      .setDesc(t('settingsDetails.terminal.customShellPathDesc'))
      .addText(text => {
        text
          .setPlaceholder(t('settingsDetails.terminal.customShellPathPlaceholder'))
          .setValue(currentCustomPath)
          .onChange(async (value) => {
            setCurrentPlatformCustomShellPath(this.context.plugin.settings.terminal, value);
            await this.saveSettings();
            
            // 验证路径
            this.validateCustomShellPath(container, value);
          });
        
        // 初始验证
        setTimeout(() => {
          this.validateCustomShellPath(container, currentCustomPath);
        }, 0);
        
        return text;
      });
  }


  /**
   * 渲染实例行为设置
   */
  private renderInstanceBehaviorSettings(containerEl: HTMLElement): void {
    const instanceCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.instanceBehavior'))
      .setHeading();

    // 新实例行为
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.newInstanceLayout'))
      .setDesc(t('settingsDetails.terminal.newInstanceLayoutDesc'))
      .addDropdown(dropdown => {
        dropdown.addOption('replaceTab', t('layoutOptions.replaceTab'));
        dropdown.addOption('newTab', t('layoutOptions.newTab'));
        dropdown.addOption('newLeftTab', t('layoutOptions.newLeftTab'));
        dropdown.addOption('newLeftSplit', t('layoutOptions.newLeftSplit'));
        dropdown.addOption('newRightTab', t('layoutOptions.newRightTab'));
        dropdown.addOption('newRightSplit', t('layoutOptions.newRightSplit'));
        dropdown.addOption('newHorizontalSplit', t('layoutOptions.newHorizontalSplit'));
        dropdown.addOption('newVerticalSplit', t('layoutOptions.newVerticalSplit'));
        dropdown.addOption('newWindow', t('layoutOptions.newWindow'));

        dropdown.setValue(this.context.plugin.settings.terminal.newInstanceBehavior);
        dropdown.onChange(async (value) => {
          this.context.plugin.settings.terminal.newInstanceBehavior = value as any;
          await this.saveSettings();
        });
      });

    // 在现有终端附近创建
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.createNearExisting'))
      .setDesc(t('settingsDetails.terminal.createNearExistingDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.terminal.createInstanceNearExistingOnes)
        .onChange(async (value) => {
          this.context.plugin.settings.terminal.createInstanceNearExistingOnes = value;
          await this.saveSettings();
        }));

    // 聚焦新实例
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.focusNewInstance'))
      .setDesc(t('settingsDetails.terminal.focusNewInstanceDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.terminal.focusNewInstance)
        .onChange(async (value) => {
          this.context.plugin.settings.terminal.focusNewInstance = value;
          await this.saveSettings();
        }));

    // 锁定新实例
    new Setting(instanceCard)
      .setName(t('settingsDetails.terminal.lockNewInstance'))
      .setDesc(t('settingsDetails.terminal.lockNewInstanceDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.terminal.lockNewInstance)
        .onChange(async (value) => {
          this.context.plugin.settings.terminal.lockNewInstance = value;
          await this.saveSettings();
        }));
  }

  /**
   * 渲染主题设置
   */
  private renderThemeSettings(containerEl: HTMLElement): void {
    const themeCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(themeCard)
      .setName(t('settingsDetails.terminal.themeSettings'))
      .setHeading();

    // 使用 Obsidian 主题
    const useObsidianThemeSetting = new Setting(themeCard)
      .setName(t('settingsDetails.terminal.useObsidianTheme'))
      .setDesc(t('settingsDetails.terminal.useObsidianThemeDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.terminal.useObsidianTheme)
        .onChange(async (value) => {
          this.context.plugin.settings.terminal.useObsidianTheme = value;
          await this.saveSettings();
          
          // 使用局部更新替代全量刷新
          this.toggleConditionalSection(
            themeCard,
            'custom-color-settings',
            !value,
            (el) => this.renderCustomColorSettingsContent(el),
            useObsidianThemeSetting.settingEl
          );
        }));

    // 自定义颜色设置（仅在不使用 Obsidian 主题时显示）- 初始渲染
    this.toggleConditionalSection(
      themeCard,
      'custom-color-settings',
      !this.context.plugin.settings.terminal.useObsidianTheme,
      (el) => this.renderCustomColorSettingsContent(el),
      useObsidianThemeSetting.settingEl
    );
  }

  /**
   * 渲染自定义颜色设置内容
   * 提取为独立方法，用于 toggleConditionalSection 调用
   */
  private renderCustomColorSettingsContent(container: HTMLElement): void {
    // 背景色
    new Setting(container)
      .setName(t('settingsDetails.terminal.backgroundColor'))
      .setDesc(t('settingsDetails.terminal.backgroundColorDesc'))
      .addColorPicker(color => color
        .setValue(this.context.plugin.settings.terminal.backgroundColor || '#000000')
        .onChange(async (value) => {
          this.context.plugin.settings.terminal.backgroundColor = value;
          await this.saveSettings();
        }))
      .addExtraButton(button => button
        .setIcon('reset')
        .setTooltip(t('common.reset'))
        .onClick(async () => {
          this.context.plugin.settings.terminal.backgroundColor = undefined;
          await this.saveSettings();
          new Notice(t('notices.settings.backgroundColorReset'));
        }));

    // 前景色
    new Setting(container)
      .setName(t('settingsDetails.terminal.foregroundColor'))
      .setDesc(t('settingsDetails.terminal.foregroundColorDesc'))
      .addColorPicker(color => color
        .setValue(this.context.plugin.settings.terminal.foregroundColor || '#FFFFFF')
        .onChange(async (value) => {
          this.context.plugin.settings.terminal.foregroundColor = value;
          await this.saveSettings();
        }))
      .addExtraButton(button => button
        .setIcon('reset')
        .setTooltip(t('common.reset'))
        .onClick(async () => {
          this.context.plugin.settings.terminal.foregroundColor = undefined;
          await this.saveSettings();
          new Notice(t('notices.settings.foregroundColorReset'));
        }));

    // 背景图片设置（仅 Canvas 渲染器支持）
    this.toggleConditionalSection(
      container,
      'background-image-settings',
      this.context.plugin.settings.terminal.preferredRenderer === 'canvas',
      (el) => this.renderBackgroundImageSettings(el)
    );
  }


  /**
   * 渲染背景图片设置
   */
  private renderBackgroundImageSettings(container: HTMLElement): void {
    const bgImageSetting = new Setting(container)
      .setName(t('settingsDetails.terminal.backgroundImage'))
      .setDesc(t('settingsDetails.terminal.backgroundImageDesc'));
    
    bgImageSetting.addText(text => {
      const inputEl = text
        .setPlaceholder(t('settingsDetails.terminal.backgroundImagePlaceholder'))
        .setValue(this.context.plugin.settings.terminal.backgroundImage || '')
        .onChange(async (value) => {
          // 只保存，不刷新
          this.context.plugin.settings.terminal.backgroundImage = value || undefined;
          await this.saveSettings();
        });
      
      // 失去焦点时使用局部更新
      text.inputEl.addEventListener('blur', () => {
        const hasImage = !!this.context.plugin.settings.terminal.backgroundImage;
        this.toggleConditionalSection(
          container,
          'background-image-options',
          hasImage,
          (el) => this.renderBackgroundImageOptionsContent(el),
          bgImageSetting.settingEl
        );
      });
      
      return inputEl;
    });
    
    bgImageSetting.addExtraButton(button => button
      .setIcon('reset')
      .setTooltip(t('common.reset'))
      .onClick(async () => {
        this.context.plugin.settings.terminal.backgroundImage = undefined;
        await this.saveSettings();
        
        // 使用局部更新移除背景图片选项
        this.toggleConditionalSection(
          container,
          'background-image-options',
          false,
          (el) => this.renderBackgroundImageOptionsContent(el),
          bgImageSetting.settingEl
        );
        
        new Notice(t('notices.settings.backgroundImageCleared'));
      }));

    // 背景图片相关选项（仅在有背景图片时显示）- 初始渲染
    this.toggleConditionalSection(
      container,
      'background-image-options',
      !!this.context.plugin.settings.terminal.backgroundImage,
      (el) => this.renderBackgroundImageOptionsContent(el),
      bgImageSetting.settingEl
    );
  }

  /**
   * 渲染背景图片相关选项内容
   * 提取为独立方法，用于 toggleConditionalSection 调用
   */
  private renderBackgroundImageOptionsContent(container: HTMLElement): void {
    // 背景图片透明度
    new Setting(container)
      .setName(t('settingsDetails.terminal.backgroundImageOpacity'))
      .setDesc(t('settingsDetails.terminal.backgroundImageOpacityDesc'))
      .addSlider(slider => slider
        .setLimits(0, 1, 0.05)
        .setValue(this.context.plugin.settings.terminal.backgroundImageOpacity ?? 0.5)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.context.plugin.settings.terminal.backgroundImageOpacity = value;
          await this.saveSettings();
        }));

    // 背景图片大小
    new Setting(container)
      .setName(t('settingsDetails.terminal.backgroundImageSize'))
      .setDesc(t('settingsDetails.terminal.backgroundImageSizeDesc'))
      .addDropdown(dropdown => dropdown
        .addOption('cover', t('backgroundSizeOptions.cover'))
        .addOption('contain', t('backgroundSizeOptions.contain'))
        .addOption('auto', t('backgroundSizeOptions.auto'))
        .setValue(this.context.plugin.settings.terminal.backgroundImageSize || 'cover')
        .onChange(async (value: 'cover' | 'contain' | 'auto') => {
          this.context.plugin.settings.terminal.backgroundImageSize = value;
          await this.saveSettings();
        }));

    // 背景图片位置
    new Setting(container)
      .setName(t('settingsDetails.terminal.backgroundImagePosition'))
      .setDesc(t('settingsDetails.terminal.backgroundImagePositionDesc'))
      .addDropdown(dropdown => dropdown
        .addOption('center', t('backgroundPositionOptions.center'))
        .addOption('top', t('backgroundPositionOptions.top'))
        .addOption('bottom', t('backgroundPositionOptions.bottom'))
        .addOption('left', t('backgroundPositionOptions.left'))
        .addOption('right', t('backgroundPositionOptions.right'))
        .addOption('top left', t('backgroundPositionOptions.topLeft'))
        .addOption('top right', t('backgroundPositionOptions.topRight'))
        .addOption('bottom left', t('backgroundPositionOptions.bottomLeft'))
        .addOption('bottom right', t('backgroundPositionOptions.bottomRight'))
        .setValue(this.context.plugin.settings.terminal.backgroundImagePosition || 'center')
        .onChange(async (value) => {
          this.context.plugin.settings.terminal.backgroundImagePosition = value;
          await this.saveSettings();
        }));

    // 毛玻璃效果
    const blurEffectSetting = new Setting(container)
      .setName(t('settingsDetails.terminal.blurEffect'))
      .setDesc(t('settingsDetails.terminal.blurEffectDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.terminal.enableBlur ?? false)
        .onChange(async (value) => {
          this.context.plugin.settings.terminal.enableBlur = value;
          await this.saveSettings();
          
          // 使用局部更新替代全量刷新
          this.toggleConditionalSection(
            container,
            'blur-amount-slider',
            value,
            (el) => this.renderBlurAmountSlider(el),
            blurEffectSetting.settingEl
          );
        }));

    // 毛玻璃模糊程度（仅在启用毛玻璃效果时显示）- 初始渲染
    this.toggleConditionalSection(
      container,
      'blur-amount-slider',
      this.context.plugin.settings.terminal.enableBlur ?? false,
      (el) => this.renderBlurAmountSlider(el),
      blurEffectSetting.settingEl
    );

    // 文本透明度
    new Setting(container)
      .setName(t('settingsDetails.terminal.textOpacity'))
      .setDesc(t('settingsDetails.terminal.textOpacityDesc'))
      .addSlider(slider => slider
        .setLimits(0, 1, 0.05)
        .setValue(this.context.plugin.settings.terminal.textOpacity ?? 1.0)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.context.plugin.settings.terminal.textOpacity = value;
          await this.saveSettings();
        }));
  }

  /**
   * 渲染模糊程度滑块
   * 提取为独立方法，用于 toggleConditionalSection 调用
   */
  private renderBlurAmountSlider(container: HTMLElement): void {
    new Setting(container)
      .setName(t('settingsDetails.terminal.blurAmount'))
      .setDesc(t('settingsDetails.terminal.blurAmountDesc'))
      .addSlider(slider => slider
        .setLimits(0, 20, 1)
        .setValue(this.context.plugin.settings.terminal.blurAmount ?? 10)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.context.plugin.settings.terminal.blurAmount = value;
          await this.saveSettings();
        }));
  }


  /**
   * 渲染外观设置
   */
  private renderAppearanceSettings(containerEl: HTMLElement): void {
    const appearanceCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.appearanceSettings'))
      .setHeading();

    // 字体大小
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.fontSize'))
      .setDesc(t('settingsDetails.terminal.fontSizeDesc'))
      .addSlider(slider => slider
        .setLimits(8, 24, 1)
        .setValue(this.context.plugin.settings.terminal.fontSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.context.plugin.settings.terminal.fontSize = value;
          await this.saveSettings();
        }));

    // 字体族
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.fontFamily'))
      .setDesc(t('settingsDetails.terminal.fontFamilyDesc'))
      .addText(text => text
        .setPlaceholder(t('settingsDetails.terminal.fontFamilyPlaceholder'))
        .setValue(this.context.plugin.settings.terminal.fontFamily)
        .onChange(async (value) => {
          this.context.plugin.settings.terminal.fontFamily = value;
          await this.saveSettings();
        }));

    // 光标样式
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.cursorStyle'))
      .setDesc(t('settingsDetails.terminal.cursorStyleDesc'))
      .addDropdown(dropdown => {
        dropdown.addOption('block', t('cursorStyleOptions.block'));
        dropdown.addOption('underline', t('cursorStyleOptions.underline'));
        dropdown.addOption('bar', t('cursorStyleOptions.bar'));

        dropdown.setValue(this.context.plugin.settings.terminal.cursorStyle);
        dropdown.onChange(async (value) => {
          this.context.plugin.settings.terminal.cursorStyle = value as any;
          await this.saveSettings();
        });
      });

    // 光标闪烁
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.cursorBlink'))
      .setDesc(t('settingsDetails.terminal.cursorBlinkDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.terminal.cursorBlink)
        .onChange(async (value) => {
          this.context.plugin.settings.terminal.cursorBlink = value;
          await this.saveSettings();
        }));

    // 渲染器类型
    new Setting(appearanceCard)
      .setName(t('settingsDetails.terminal.rendererType'))
      .setDesc(t('settingsDetails.terminal.rendererTypeDesc'))
      .addDropdown(dropdown => dropdown
        .addOption('canvas', t('rendererOptions.canvas'))
        .addOption('webgl', t('rendererOptions.webgl'))
        .setValue(this.context.plugin.settings.terminal.preferredRenderer)
        .onChange(async (value: 'canvas' | 'webgl') => {
          this.context.plugin.settings.terminal.preferredRenderer = value;
          await this.saveSettings();
          this.updateBackgroundImageSettingsVisibility();
          new Notice(t('notices.settings.rendererUpdated'));
        }));
  }

  /**
   * 更新背景图片设置可见性
   * 仅在自定义主题设置已渲染时生效
   */
  private updateBackgroundImageSettingsVisibility(): void {
    const customColorContainer = this.context.containerEl.querySelector<HTMLElement>(
      '.conditional-section-custom-color-settings'
    );
    if (!customColorContainer) {
      return;
    }

    this.toggleConditionalSection(
      customColorContainer,
      'background-image-settings',
      this.context.plugin.settings.terminal.preferredRenderer === 'canvas',
      (el) => this.renderBackgroundImageSettings(el)
    );
  }

  /**
   * 渲染行为设置
   */
  private renderBehaviorSettings(containerEl: HTMLElement): void {
    const behaviorCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(behaviorCard)
      .setName(t('settingsDetails.terminal.behaviorSettings'))
      .setHeading();

    // 滚动缓冲区大小
    const scrollbackSetting = new Setting(behaviorCard)
      .setName(t('settingsDetails.terminal.scrollback'))
      .setDesc(t('settingsDetails.terminal.scrollbackDesc'));
    
    scrollbackSetting.addText(text => {
      const inputEl = text
        .setPlaceholder('1000')
        .setValue(String(this.context.plugin.settings.terminal.scrollback))
        .onChange(async (value) => {
          // 只在输入时保存，不验证
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            this.context.plugin.settings.terminal.scrollback = numValue;
            await this.saveSettings();
          }
        });
      
      // 失去焦点时验证
      text.inputEl.addEventListener('blur', async () => {
        const value = text.inputEl.value;
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 100 || numValue > 10000) {
          new Notice('⚠️ ' + t('notices.settings.scrollbackRangeError'));
          this.context.plugin.settings.terminal.scrollback = 1000;
          await this.saveSettings();
          text.setValue('1000');
        }
      });
      
      return inputEl;
    });

    // 终端面板默认高度
    const defaultHeightSetting = new Setting(behaviorCard)
      .setName(t('settingsDetails.terminal.defaultHeight'))
      .setDesc(t('settingsDetails.terminal.defaultHeightDesc'));
    
    defaultHeightSetting.addText(text => {
      const inputEl = text
        .setPlaceholder('300')
        .setValue(String(this.context.plugin.settings.terminal.defaultHeight))
        .onChange(async (value) => {
          // 只在输入时保存，不验证
          const numValue = parseInt(value);
          if (!isNaN(numValue)) {
            this.context.plugin.settings.terminal.defaultHeight = numValue;
            await this.saveSettings();
          }
        });
      
      // 失去焦点时验证
      text.inputEl.addEventListener('blur', async () => {
        const value = text.inputEl.value;
        const numValue = parseInt(value);
        if (isNaN(numValue) || numValue < 100 || numValue > 1000) {
          new Notice('⚠️ ' + t('notices.settings.heightRangeError'));
          this.context.plugin.settings.terminal.defaultHeight = 300;
          await this.saveSettings();
          text.setValue('300');
        }
      });
      
      return inputEl;
    });
  }

  /**
   * 验证自定义 Shell 路径
   * @param containerEl 容器元素
   * @param path Shell 路径
   */
  private validateCustomShellPath(containerEl: HTMLElement, path: string): void {
    // 移除之前的验证消息
    const existingValidation = containerEl.querySelector('.shell-path-validation');
    if (existingValidation) {
      existingValidation.remove();
    }
    
    // 如果路径为空，不显示验证消息
    if (!path || path.trim() === '') {
      return;
    }
    
    // 创建验证消息容器
    const validationEl = containerEl.createDiv({ cls: 'shell-path-validation setting-item-description' });
    validationEl.style.marginTop = '8px';
    
    // 验证路径
    const isValid = validateShellPath(path);
    
    if (isValid) {
      validationEl.setText(t('settingsDetails.terminal.pathValid'));
      validationEl.style.color = 'var(--text-success)';
    } else {
      validationEl.setText(t('settingsDetails.terminal.pathInvalid'));
      validationEl.style.color = 'var(--text-error)';
    }
  }

  /**
   * 渲染功能显示设置
   */
  private renderVisibilitySettings(containerEl: HTMLElement): void {
    const visibilityCard = containerEl.createDiv({ cls: 'settings-card' });

    new Setting(visibilityCard)
      .setName(t('settingsDetails.terminal.visibilitySettings'))
      .setHeading();

    new Setting(visibilityCard)
      .setName(t('settingsDetails.advanced.showInCommandPalette'))
      .setDesc(t('settingsDetails.advanced.showInCommandPaletteDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.featureVisibility.terminal.showInCommandPalette)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.terminal.showInCommandPalette = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    new Setting(visibilityCard)
      .setName(t('settingsDetails.advanced.showInRibbon'))
      .setDesc(t('settingsDetails.advanced.showInRibbonTerminalDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.featureVisibility.terminal.showInRibbon)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.terminal.showInRibbon = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    new Setting(visibilityCard)
      .setName(t('settingsDetails.advanced.showInNewTab'))
      .setDesc(t('settingsDetails.advanced.showInNewTabDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.featureVisibility.terminal.showInNewTab)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.terminal.showInNewTab = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));

    new Setting(visibilityCard)
      .setName(t('settingsDetails.advanced.showInStatusBar'))
      .setDesc(t('settingsDetails.advanced.showInStatusBarDesc'))
      .addToggle(toggle => toggle
        .setValue(this.context.plugin.settings.featureVisibility.terminal.showInStatusBar)
        .onChange(async (value) => {
          this.context.plugin.settings.featureVisibility.terminal.showInStatusBar = value;
          await this.saveSettings();
          this.context.plugin.updateFeatureVisibility();
        }));
  }
}
