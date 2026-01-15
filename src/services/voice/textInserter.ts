/**
 * TextInserter - 文本插入器
 * 
 * 职责:
 * 1. 在光标位置插入文本
 * 2. 替换选中的文本
 * 3. 检测活动编辑器状态
 * 4. 处理无编辑器时的警告
 * 
 * 实现 ITextInserter 接口，供 VoiceInputService 使用
 */

import type { App} from 'obsidian';
import { MarkdownView, Notice } from 'obsidian';
import type { ITextInserter } from './types';
import { debugLog, errorLog } from '../../utils/logger';
import { t } from '../../i18n';

/**
 * TextInserter
 * 
 * 负责将文本插入到 Obsidian 编辑器中
 * 支持光标位置插入和选中文本替换
 */
export class TextInserter implements ITextInserter {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * 在光标位置插入文本
   * 
   * @param text 要插入的文本
   * @returns 是否成功插入
   */
  async insertAtCursor(text: string): Promise<boolean> {
    try {
      // 获取活动的 MarkdownView
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      
      if (!view) {
        this.showNoEditorWarning();
        return false;
      }

      const editor = view.editor;
      if (!editor) {
        this.showNoEditorWarning();
        return false;
      }

      // 获取当前光标位置
      const cursor = editor.getCursor();
      
      // 在光标位置插入文本
      editor.replaceRange(text, cursor);
      
      // 计算新的光标位置（移动到插入文本的末尾）
      const newCursor = this.calculateNewCursorPosition(cursor, text);
      editor.setCursor(newCursor);
      
      // 确保编辑器获得焦点
      editor.focus();
      
      debugLog('[TextInserter] 文本已插入，长度:', text.length);
      return true;
    } catch (error) {
      errorLog('[TextInserter] 插入文本失败:', error);
      return false;
    }
  }

  /**
   * 替换选中的文本
   * 
   * @param text 替换后的文本
   * @returns 是否成功替换
   */
  async replaceSelection(text: string): Promise<boolean> {
    try {
      // 获取活动的 MarkdownView
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      
      if (!view) {
        this.showNoEditorWarning();
        return false;
      }

      const editor = view.editor;
      if (!editor) {
        this.showNoEditorWarning();
        return false;
      }

      // 检查是否有选中文本
      const selection = editor.getSelection();
      if (!selection) {
        // 没有选中文本，回退到光标位置插入
        debugLog('[TextInserter] 没有选中文本，回退到光标位置插入');
        return this.insertAtCursor(text);
      }

      // 获取选区范围
      const from = editor.getCursor('from');
      const to = editor.getCursor('to');
      
      // 替换选中的文本
      editor.replaceRange(text, from, to);
      
      // 选中替换后的文本（可选，便于用户查看替换结果）
      const newTo = this.calculateNewCursorPosition(from, text);
      editor.setSelection(from, newTo);
      
      // 确保编辑器获得焦点
      editor.focus();
      
      debugLog('[TextInserter] 选中文本已替换，原长度:', selection.length, '新长度:', text.length);
      return true;
    } catch (error) {
      errorLog('[TextInserter] 替换选中文本失败:', error);
      return false;
    }
  }

  /**
   * 检查是否有活动编辑器
   * 
   * @returns 是否有活动的 Markdown 编辑器
   */
  hasActiveEditor(): boolean {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view !== null && view.editor !== null;
  }

  /**
   * 获取当前选中的文本
   * 
   * @returns 选中的文本，如果没有选中则返回 null
   */
  getSelectedText(): string | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) {
      return null;
    }
    
    const selection = view.editor.getSelection();
    return selection || null;
  }

  /**
   * 获取当前光标位置的上下文
   * 用于智能插入（如在段落末尾自动添加空格）
   * 
   * @returns 光标位置的上下文信息
   */
  getCursorContext(): { line: string; ch: number; lineNumber: number } | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !view.editor) {
      return null;
    }
    
    const editor = view.editor;
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    
    return {
      line,
      ch: cursor.ch,
      lineNumber: cursor.line,
    };
  }

  /**
   * 计算插入文本后的新光标位置
   * 
   * @param startPos 起始位置
   * @param text 插入的文本
   * @returns 新的光标位置
   */
  private calculateNewCursorPosition(
    startPos: { line: number; ch: number },
    text: string
  ): { line: number; ch: number } {
    const lines = text.split('\n');
    const lineCount = lines.length;
    const lastLineLength = lines[lineCount - 1].length;
    
    if (lineCount === 1) {
      // 单行文本：光标在同一行，列位置增加
      return {
        line: startPos.line,
        ch: startPos.ch + lastLineLength,
      };
    } else {
      // 多行文本：光标移动到最后一行
      return {
        line: startPos.line + lineCount - 1,
        ch: lastLineLength,
      };
    }
  }

  /**
   * 显示无编辑器警告
   */
  private showNoEditorWarning(): void {
    const message = t('voiceInput.noActiveEditor') || '没有活动的编辑器，请先打开一个 Markdown 文件';
    new Notice(message, 3000);
    debugLog('[TextInserter] 警告: 没有活动的编辑器');
  }
}
