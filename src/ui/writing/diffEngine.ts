/**
 * 差异计算引擎
 * 使用 vscode-diff 库进行专业级行级 diff 计算
 */

import type {
  ILinesDiffComputerOptions,
  DetailedLineRangeMapping} from 'vscode-diff';
import {
  linesDiffComputers
} from 'vscode-diff';

/**
 * 差异块类型
 */
export type DiffBlockType = 'unchanged' | 'modified';

/**
 * 块决策类型
 */
export type BlockDecision = 'pending' | 'incoming' | 'current' | 'both';

/**
 * 差异块
 */
export interface DiffBlock {
  /** 块类型 */
  type: DiffBlockType;
  /** 块索引 */
  index: number;
  /** 未变化内容（type=unchanged 时有值） */
  value?: string;
  /** 原始内容（type=modified 时可能有值） */
  originalValue?: string;
  /** 修改后内容（type=modified 时可能有值） */
  modifiedValue?: string;
  /** 原始内容起始行号（1-indexed） */
  originalStartLine?: number;
  /** 原始内容结束行号（1-indexed，不包含） */
  originalEndLine?: number;
  /** 修改后内容起始行号（1-indexed） */
  modifiedStartLine?: number;
  /** 修改后内容结束行号（1-indexed，不包含） */
  modifiedEndLine?: number;
}

/**
 * 差异计算结果
 */
export interface DiffResult {
  /** 差异块列表 */
  blocks: DiffBlock[];
  /** 修改块索引列表 */
  modifiedIndices: number[];
  /** 总修改块数 */
  totalModified: number;
}

/**
 * DiffEngine 类
 * 使用 vscode-diff 的 DefaultLinesDiffComputer 进行精确的行级差异计算
 */
export class DiffEngine {
  private options: ILinesDiffComputerOptions;

  constructor() {
    this.options = {
      ignoreTrimWhitespace: false,
      computeMoves: true,
      maxComputationTimeMs: 0, // 无超时限制
    };
  }

  /**
   * 计算两段文本的差异
   * @param original 原始文本
   * @param modified 修改后文本
   * @param originalStartLine 原始文本在文档中的起始行号（1-indexed，默认1）
   * @returns 差异计算结果
   */
  computeDiff(original: string, modified: string, originalStartLine: number = 1): DiffResult {
    const blocks: DiffBlock[] = [];
    let blockIndex = 0;

    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');

    // 使用 vscode-diff 的默认 diff 计算器
    const diffComputer = linesDiffComputers.getDefault();
    const diffResult = diffComputer.computeDiff(
      originalLines,
      modifiedLines,
      this.options
    );

    const changes = diffResult.changes;

    // 1-indexed，跟踪上一个处理的原始行结束位置（相对于本段文本）
    let lastOriginalEndLineNumberExclusive = 1;
    // 跟踪修改后文本的当前行位置
    let lastModifiedEndLineNumberExclusive = 1;

    changes.forEach((change: DetailedLineRangeMapping) => {
      const oStart = change.original.startLineNumber;
      const oEnd = change.original.endLineNumberExclusive;
      const mStart = change.modified.startLineNumber;
      const mEnd = change.modified.endLineNumberExclusive;

      // 输出未变化块（在当前变更之前的部分）
      if (oStart > lastOriginalEndLineNumberExclusive) {
        const unchangedValue = originalLines
          .slice(lastOriginalEndLineNumberExclusive - 1, oStart - 1)
          .join('\n');
        if (unchangedValue.length > 0) {
          blocks.push({
            type: 'unchanged',
            index: blockIndex++,
            value: unchangedValue,
            originalStartLine: originalStartLine + lastOriginalEndLineNumberExclusive - 1,
            originalEndLine: originalStartLine + oStart - 1,
          });
        }
        lastModifiedEndLineNumberExclusive = mStart;
      }

      // 输出修改块
      const originalValue = originalLines.slice(oStart - 1, oEnd - 1).join('\n');
      const modifiedValue = modifiedLines.slice(mStart - 1, mEnd - 1).join('\n');

      if (originalValue.length > 0 || modifiedValue.length > 0) {
        blocks.push({
          type: 'modified',
          index: blockIndex++,
          originalValue: originalValue.length > 0 ? originalValue : undefined,
          modifiedValue: modifiedValue.length > 0 ? modifiedValue : undefined,
          originalStartLine: originalStartLine + oStart - 1,
          originalEndLine: originalStartLine + oEnd - 1,
          modifiedStartLine: mStart,
          modifiedEndLine: mEnd,
        });
      }

      lastOriginalEndLineNumberExclusive = oEnd;
      lastModifiedEndLineNumberExclusive = mEnd;
    });

    // 输出最后的未变化块（如果有）
    if (originalLines.length >= lastOriginalEndLineNumberExclusive) {
      const unchangedValue = originalLines
        .slice(lastOriginalEndLineNumberExclusive - 1)
        .join('\n');
      if (unchangedValue.length > 0) {
        blocks.push({
          type: 'unchanged',
          index: blockIndex++,
          value: unchangedValue,
          originalStartLine: originalStartLine + lastOriginalEndLineNumberExclusive - 1,
          originalEndLine: originalStartLine + originalLines.length,
        });
      }
    }

    // 提取修改块索引
    const modifiedIndices = blocks
      .filter((b) => b.type === 'modified')
      .map((b) => b.index);

    return {
      blocks,
      modifiedIndices,
      totalModified: modifiedIndices.length,
    };
  }

  /**
   * 根据决策生成最终内容
   * @param blocks 差异块列表
   * @param decisions 决策映射
   * @param defaultDecision 未决策块的默认处理
   * @returns 最终内容
   */
  generateFinalContent(
    blocks: DiffBlock[],
    decisions: Map<number, BlockDecision>,
    defaultDecision: 'incoming' | 'current'
  ): string {
    const parts: string[] = [];

    for (const block of blocks) {
      if (block.type === 'unchanged') {
        // 未变化块直接使用原值
        if (block.value !== undefined) {
          parts.push(block.value);
        }
      } else {
        // 修改块根据决策处理
        const decision = decisions.get(block.index) ?? 'pending';
        const effectiveDecision = decision === 'pending' ? defaultDecision : decision;

        switch (effectiveDecision) {
          case 'incoming':
            // 使用新内容
            if (block.modifiedValue !== undefined) {
              parts.push(block.modifiedValue);
            }
            break;
          case 'current':
            // 保留原内容
            if (block.originalValue !== undefined) {
              parts.push(block.originalValue);
            }
            break;
          case 'both':
            // 合并两者，原内容在前，新内容在后
            if (block.originalValue !== undefined && block.modifiedValue !== undefined) {
              parts.push(block.originalValue + '\n' + block.modifiedValue);
            } else if (block.originalValue !== undefined) {
              parts.push(block.originalValue);
            } else if (block.modifiedValue !== undefined) {
              parts.push(block.modifiedValue);
            }
            break;
        }
      }
    }

    return parts.join('\n');
  }
}
