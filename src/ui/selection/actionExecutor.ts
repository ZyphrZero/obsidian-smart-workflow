/**
 * ActionExecutor - 工具栏动作执行器
 * 负责执行选中文字工具栏的各种操作

 */

import { App, MarkdownView } from 'obsidian';
import { SelectionContext } from './types';
import { NoticeHelper } from '../noticeHelper';
import { t } from '../../i18n';

/**
 * 动作执行器类
 * 提供复制、搜索、创建链接、添加高亮等操作
 */
export class ActionExecutor {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * 检查文本是否完全是高亮格式（整体被 == 包裹）
   * @param text 要检查的文本
   */
  isHighlighted(text: string): boolean {
    // 必须以 == 开头和结尾，且中间内容不为空
    if (!text.startsWith('==') || !text.endsWith('==')) {
      return false;
    }
    // 去掉首尾的 == 后，内容不能再包含未闭合的 ==
    const inner = text.slice(2, -2);
    return inner.length > 0 && !inner.startsWith('=') && !inner.endsWith('=');
  }

  /**
   * 检查文本是否完全是内部链接格式（整体被 [[ ]] 包裹）
   * @param text 要检查的文本
   */
  isInternalLink(text: string): boolean {
    // 必须以 [[ 开头和 ]] 结尾，且中间内容不为空
    if (!text.startsWith('[[') || !text.endsWith(']]')) {
      return false;
    }
    // 去掉首尾的 [[ ]] 后，内容不能再包含未闭合的 [[ 或 ]]
    const inner = text.slice(2, -2);
    return inner.length > 0 && !inner.includes('[[') && !inner.includes(']]');
  }

  /**
   * 检查文本是否完全是加粗格式
   */
  isBold(text: string): boolean {
    return text.startsWith('**') && text.endsWith('**') && text.length > 4;
  }

  /**
   * 检查文本是否完全是斜体格式
   */
  isItalic(text: string): boolean {
    // 斜体是单个 * 或 _，但不能是加粗
    if (this.isBold(text)) return false;
    return (text.startsWith('*') && text.endsWith('*') && text.length > 2) ||
           (text.startsWith('_') && text.endsWith('_') && text.length > 2);
  }

  /**
   * 检查文本是否完全是删除线格式
   */
  isStrikethrough(text: string): boolean {
    return text.startsWith('~~') && text.endsWith('~~') && text.length > 4;
  }

  /**
   * 检查文本是否完全是行内代码格式
   */
  isInlineCode(text: string): boolean {
    return text.startsWith('`') && text.endsWith('`') && !text.startsWith('``') && text.length > 2;
  }

  /**
   * 检查文本是否完全是行内公式格式
   */
  isInlineMath(text: string): boolean {
    return text.startsWith('$') && text.endsWith('$') && !text.startsWith('$$') && text.length > 2;
  }

  /**
   * 复制选中文本到剪贴板

   * @param text 要复制的文本
   */
  async copyToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      NoticeHelper.success(t('selectionToolbar.actions.copySuccess'));
    } catch (error) {
      NoticeHelper.error(t('selectionToolbar.actions.copyFailed'));
      throw error;
    }
  }

  /**
   * 在 Vault 中搜索选中文本

   * @param text 要搜索的文本
   */
  searchInVault(text: string): void {
    try {
      // 使用 Obsidian 的全局搜索功能，但不改变焦点
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const searchPlugin = (this.app as any).internalPlugins?.getPluginById('global-search');
      if (searchPlugin?.instance) {
        // 打开搜索但保持当前焦点
        searchPlugin.instance.openGlobalSearch(text);
        
        // 延迟后将焦点返回编辑器
        setTimeout(() => {
          const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (activeView?.editor) {
            activeView.editor.focus();
          }
        }, 100);
        
        NoticeHelper.success(t('selectionToolbar.actions.searchSuccess'));
      } else {
        // 备用方案：使用命令面板搜索
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.app as any).commands?.executeCommandById('global-search:open');
        NoticeHelper.info(t('selectionToolbar.actions.searchFallback'));
      }
    } catch (error) {
      NoticeHelper.error(t('selectionToolbar.actions.searchFailed'));
      throw error;
    }
  }

  /**
   * 将选中文本转为内部链接 [[text]]

   * @param context 选择上下文
   * @returns 新的选中文本
   */
  createInternalLink(context: SelectionContext): string {
    try {
      const { text, range } = context;
      const linkText = this.transformToInternalLink(text);
      
      this.replaceSelectionText(range, linkText);
      NoticeHelper.success(t('selectionToolbar.actions.linkCreated'));
      return linkText;
    } catch (error) {
      NoticeHelper.error(t('selectionToolbar.actions.linkFailed'));
      throw error;
    }
  }

  /**
   * 添加高亮标记 ==text==

   * @param context 选择上下文
   * @returns 新的选中文本
   */
  addHighlight(context: SelectionContext): string {
    try {
      const { text, range } = context;
      const highlightText = this.transformToHighlight(text);
      
      this.replaceSelectionText(range, highlightText);
      NoticeHelper.success(t('selectionToolbar.actions.highlightAdded'));
      return highlightText;
    } catch (error) {
      NoticeHelper.error(t('selectionToolbar.actions.highlightFailed'));
      throw error;
    }
  }

  /**
   * 将文本转换为内部链接格式
   * Property 4: Create Link Transformation
   * @param text 原始文本
   * @returns 内部链接格式文本 [[text]]
   */
  transformToInternalLink(text: string): string {
    return `[[${text}]]`;
  }

  /**
   * 将文本转换为高亮格式
   * @param text 原始文本
   * @returns 高亮格式文本 ==text==
   */
  transformToHighlight(text: string): string {
    return this.applyInlineFormat(text, '==', '==');
  }

  /**
   * 对文本应用行内格式（支持跨行处理）
   * 每一行都会被独立包裹格式标记
   * @param text 原始文本
   * @param prefix 格式前缀（如 ** 或 ==）
   * @param suffix 格式后缀（如 ** 或 ==）
   * @returns 格式化后的文本
   */
  private applyInlineFormat(text: string, prefix: string, suffix: string): string {
    // 检查是否包含换行符
    if (!text.includes('\n')) {
      return `${prefix}${text}${suffix}`;
    }

    // 跨行处理：每行独立包裹格式标记
    const lines = text.split('\n');
    const formattedLines = lines.map(line => {
      // 空行保持不变
      if (line.trim() === '') {
        return line;
      }
      return `${prefix}${line}${suffix}`;
    });

    return formattedLines.join('\n');
  }

  /**
   * 添加加粗 **text**
   */
  addBold(context: SelectionContext): string {
    const { text, range } = context;
    const newText = this.applyInlineFormat(text, '**', '**');
    this.replaceSelectionText(range, newText);
    return newText;
  }

  /**
   * 添加斜体 *text*
   */
  addItalic(context: SelectionContext): string {
    const { text, range } = context;
    const newText = this.applyInlineFormat(text, '*', '*');
    this.replaceSelectionText(range, newText);
    return newText;
  }

  /**
   * 添加删除线 ~~text~~
   */
  addStrikethrough(context: SelectionContext): string {
    const { text, range } = context;
    const newText = this.applyInlineFormat(text, '~~', '~~');
    this.replaceSelectionText(range, newText);
    return newText;
  }

  /**
   * 添加行内代码 `text`
   */
  addInlineCode(context: SelectionContext): string {
    const { text, range } = context;
    const newText = this.applyInlineFormat(text, '`', '`');
    this.replaceSelectionText(range, newText);
    return newText;
  }

  /**
   * 添加行内公式 $text$
   */
  addInlineMath(context: SelectionContext): string {
    const { text, range } = context;
    const newText = this.applyInlineFormat(text, '$', '$');
    this.replaceSelectionText(range, newText);
    return newText;
  }

  /**
   * 清除所有格式标记
   */
  clearFormatting(context: SelectionContext): string {
    const { text, range } = context;
    let cleanText = text;
    
    // 使用正则表达式移除所有格式标记
    // 高亮 ==text==
    cleanText = cleanText.replace(/==(.*?)==/g, '$1');
    // 加粗 **text**
    cleanText = cleanText.replace(/\*\*(.*?)\*\*/g, '$1');
    // 删除线 ~~text~~
    cleanText = cleanText.replace(/~~(.*?)~~/g, '$1');
    // 斜体 *text* (注意要在加粗之后处理)
    cleanText = cleanText.replace(/\*(.*?)\*/g, '$1');
    // 斜体 _text_
    cleanText = cleanText.replace(/_(.*?)_/g, '$1');
    // 行内代码 `text`
    cleanText = cleanText.replace(/`(.*?)`/g, '$1');
    // 行内公式 $text$ (非贪婪匹配，避免匹配 $$)
    cleanText = cleanText.replace(/\$([^$]+)\$/g, '$1');
    // 内部链接 [[text]] 或 [[text|alias]]
    cleanText = cleanText.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1');
    
    this.replaceSelectionText(range, cleanText);
    return cleanText;
  }

  /**
   * 替换选区文本并重新选中新文本
   * @param _range 选区范围（保留用于未来扩展）
   * @param newText 新文本
   * @returns 新文本内容（用于更新工具栏状态）
   */
  private replaceSelectionText(_range: Range, newText: string): string {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
      throw new Error('No active markdown view');
    }

    const editor = activeView.editor;
    if (!editor) {
      throw new Error('No editor available');
    }

    // 获取选区在编辑器中的位置
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      throw new Error('No selection available');
    }

    // 使用编辑器 API 替换选中文本
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    
    editor.replaceRange(newText, from, to);
    
    // 重新选中替换后的文本（支持跨行）
    const newLines = newText.split('\n');
    const newTo = {
      line: from.line + newLines.length - 1,
      ch: newLines.length === 1 
        ? from.ch + newText.length 
        : newLines[newLines.length - 1].length
    };
    editor.setSelection(from, newTo);
    
    // 确保编辑器获得焦点，触发选区同步
    editor.focus();
    
    return newText;
  }
}
