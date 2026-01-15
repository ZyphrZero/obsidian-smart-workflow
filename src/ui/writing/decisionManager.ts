/**
 * 决策管理器
 * 负责跟踪用户对每个修改块的决策
 */

import type { BlockDecision } from './diffEngine';

/**
 * 决策变更事件
 */
export interface DecisionChangeEvent {
  blockIndex: number;
  decision: BlockDecision;
  resolvedCount: number;
  totalCount: number;
}

/**
 * DecisionManager 类
 * 决策状态管理器，负责跟踪用户对每个修改块的决策
 */
export class DecisionManager {
  /** 决策映射 */
  private decisions: Map<number, BlockDecision>;
  /** 修改块索引列表 */
  private modifiedIndices: number[];
  /** 变更回调 */
  private onChange?: (event: DecisionChangeEvent) => void;

  /**
   * 构造函数
   * @param modifiedIndices 修改块索引列表
   * @param onChange 决策变更回调
   */
  constructor(modifiedIndices: number[], onChange?: (event: DecisionChangeEvent) => void) {
    this.modifiedIndices = [...modifiedIndices];
    this.onChange = onChange;
    this.decisions = new Map();

    // 初始化所有修改块为 pending 状态
    for (const index of modifiedIndices) {
      this.decisions.set(index, 'pending');
    }
  }

  /**
   * 设置块决策
   * @param blockIndex 块索引
   * @param decision 决策类型
   */
  setDecision(blockIndex: number, decision: BlockDecision): void {
    if (!this.modifiedIndices.includes(blockIndex)) {
      return; // 忽略非修改块
    }

    this.decisions.set(blockIndex, decision);
    this.notifyChange(blockIndex, decision);
  }

  /**
   * 获取块决策
   * @param blockIndex 块索引
   * @returns 决策类型，默认返回 'pending'
   */
  getDecision(blockIndex: number): BlockDecision {
    return this.decisions.get(blockIndex) ?? 'pending';
  }

  /**
   * 撤销块决策，恢复为 pending 状态
   * @param blockIndex 块索引
   */
  undoDecision(blockIndex: number): void {
    if (!this.modifiedIndices.includes(blockIndex)) {
      return; // 忽略非修改块
    }

    this.decisions.set(blockIndex, 'pending');
    this.notifyChange(blockIndex, 'pending');
  }

  /**
   * 接受所有新内容
   * 将所有修改块的决策设置为 'incoming'
   */
  acceptAllIncoming(): void {
    for (const index of this.modifiedIndices) {
      this.decisions.set(index, 'incoming');
    }
    // 通知最后一个块的变更（触发 UI 更新）
    if (this.modifiedIndices.length > 0) {
      const lastIndex = this.modifiedIndices[this.modifiedIndices.length - 1];
      this.notifyChange(lastIndex, 'incoming');
    }
  }

  /**
   * 保留所有原内容
   * 将所有修改块的决策设置为 'current'
   */
  acceptAllCurrent(): void {
    for (const index of this.modifiedIndices) {
      this.decisions.set(index, 'current');
    }
    // 通知最后一个块的变更（触发 UI 更新）
    if (this.modifiedIndices.length > 0) {
      const lastIndex = this.modifiedIndices[this.modifiedIndices.length - 1];
      this.notifyChange(lastIndex, 'current');
    }
  }

  /**
   * 重置所有决策
   * 将所有修改块的决策恢复为 'pending'
   */
  resetAll(): void {
    for (const index of this.modifiedIndices) {
      this.decisions.set(index, 'pending');
    }
    // 通知最后一个块的变更（触发 UI 更新）
    if (this.modifiedIndices.length > 0) {
      const lastIndex = this.modifiedIndices[this.modifiedIndices.length - 1];
      this.notifyChange(lastIndex, 'pending');
    }
  }

  /**
   * 获取已决策数量
   * @returns 非 pending 状态的决策数量
   */
  getResolvedCount(): number {
    let count = 0;
    for (const index of this.modifiedIndices) {
      const decision = this.decisions.get(index);
      if (decision && decision !== 'pending') {
        count++;
      }
    }
    return count;
  }

  /**
   * 获取总修改块数量
   * @returns 修改块总数
   */
  getTotalCount(): number {
    return this.modifiedIndices.length;
  }

  /**
   * 获取所有决策
   * @returns 决策映射的副本
   */
  getAllDecisions(): Map<number, BlockDecision> {
    return new Map(this.decisions);
  }

  /**
   * 通知决策变更
   */
  private notifyChange(blockIndex: number, decision: BlockDecision): void {
    if (this.onChange) {
      this.onChange({
        blockIndex,
        decision,
        resolvedCount: this.getResolvedCount(),
        totalCount: this.getTotalCount(),
      });
    }
  }
}
