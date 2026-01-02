// ============================================================================
// 语音输入历史记录管理器
// ============================================================================

import type { App } from 'obsidian';
import type { TranscriptionHistory, IHistoryManager, VoiceInputMode } from './types';

/**
 * 历史记录存储文件名
 */
const HISTORY_FILE_NAME = 'voice-history.json';

/**
 * 历史记录存储目录（相对于 vault 根目录）
 */
const HISTORY_DIR = '.obsidian/plugins/smart-workflow';

/**
 * 最大历史记录数量
 */
const MAX_HISTORY_COUNT = 500;

/**
 * 历史记录存储格式
 */
interface HistoryStorage {
  version: number;
  records: TranscriptionHistory[];
}

/**
 * 当前存储版本
 */
const STORAGE_VERSION = 1;

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 历史记录管理器
 * 负责语音转录历史记录的保存、查询、搜索和清空
 */
export class HistoryManager implements IHistoryManager {
  private app: App;
  private records: TranscriptionHistory[] = [];
  private initialized = false;
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly saveDebounceMs = 1000;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * 初始化历史记录管理器
   * 从存储文件加载历史记录
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.loadFromStorage();
      this.initialized = true;
    } catch (error) {
      console.error('[HistoryManager] 初始化失败:', error);
      // 初始化失败时使用空记录
      this.records = [];
      this.initialized = true;
    }
  }

  /**
   * 保存历史记录
   * @param record 历史记录（不含 id）
   */
  async save(record: Omit<TranscriptionHistory, 'id'>): Promise<void> {
    await this.ensureInitialized();

    const newRecord: TranscriptionHistory = {
      ...record,
      id: generateId(),
    };

    // 添加到记录列表开头（最新的在前）
    this.records.unshift(newRecord);

    // 限制记录数量
    if (this.records.length > MAX_HISTORY_COUNT) {
      this.records = this.records.slice(0, MAX_HISTORY_COUNT);
    }

    // 防抖保存到存储
    this.debouncedSave();
  }

  /**
   * 获取所有历史记录
   * @returns 历史记录列表（按时间倒序）
   */
  async getAll(): Promise<TranscriptionHistory[]> {
    await this.ensureInitialized();
    return [...this.records];
  }

  /**
   * 搜索历史记录
   * @param query 搜索关键词
   * @returns 匹配的历史记录列表
   */
  async search(query: string): Promise<TranscriptionHistory[]> {
    await this.ensureInitialized();

    if (!query || query.trim() === '') {
      return [...this.records];
    }

    const normalizedQuery = query.toLowerCase().trim();

    return this.records.filter((record) => {
      // 搜索原始文本
      if (record.originalText.toLowerCase().includes(normalizedQuery)) {
        return true;
      }
      // 搜索处理后文本
      if (record.processedText?.toLowerCase().includes(normalizedQuery)) {
        return true;
      }
      // 搜索 ASR 引擎名称
      if (record.asrEngine.toLowerCase().includes(normalizedQuery)) {
        return true;
      }
      // 搜索 LLM 预设名称
      if (record.llmPreset?.toLowerCase().includes(normalizedQuery)) {
        return true;
      }
      return false;
    });
  }

  /**
   * 清空所有历史记录
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    this.records = [];
    await this.saveToStorage();
  }

  /**
   * 根据 ID 获取单条历史记录
   * @param id 记录 ID
   * @returns 历史记录或 undefined
   */
  async getById(id: string): Promise<TranscriptionHistory | undefined> {
    await this.ensureInitialized();
    return this.records.find((record) => record.id === id);
  }

  /**
   * 根据 ID 删除单条历史记录
   * @param id 记录 ID
   * @returns 是否删除成功
   */
  async deleteById(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const index = this.records.findIndex((record) => record.id === id);
    if (index === -1) {
      return false;
    }
    this.records.splice(index, 1);
    this.debouncedSave();
    return true;
  }

  /**
   * 按模式筛选历史记录
   * @param mode 语音输入模式
   * @returns 匹配的历史记录列表
   */
  async getByMode(mode: VoiceInputMode): Promise<TranscriptionHistory[]> {
    await this.ensureInitialized();
    return this.records.filter((record) => record.mode === mode);
  }

  /**
   * 按时间范围筛选历史记录
   * @param startTime 开始时间戳
   * @param endTime 结束时间戳
   * @returns 匹配的历史记录列表
   */
  async getByTimeRange(
    startTime: number,
    endTime: number
  ): Promise<TranscriptionHistory[]> {
    await this.ensureInitialized();
    return this.records.filter(
      (record) => record.timestamp >= startTime && record.timestamp <= endTime
    );
  }

  /**
   * 获取历史记录数量
   * @returns 记录数量
   */
  async getCount(): Promise<number> {
    await this.ensureInitialized();
    return this.records.length;
  }

  /**
   * 销毁管理器，清理资源
   */
  async destroy(): Promise<void> {
    // 取消待处理的保存操作
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }

    // 立即保存未保存的数据
    if (this.initialized && this.records.length > 0) {
      await this.saveToStorage();
    }

    this.records = [];
    this.initialized = false;
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 确保管理器已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * 防抖保存到存储
   */
  private debouncedSave(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.saveToStorage().catch((error) => {
        console.error('[HistoryManager] 保存失败:', error);
      });
    }, this.saveDebounceMs);
  }

  /**
   * 获取存储文件路径
   */
  private getStoragePath(): string {
    return `${HISTORY_DIR}/${HISTORY_FILE_NAME}`;
  }

  /**
   * 从存储加载历史记录
   */
  private async loadFromStorage(): Promise<void> {
    const path = this.getStoragePath();

    try {
      // 检查文件是否存在
      const exists = await this.app.vault.adapter.exists(path);
      if (!exists) {
        this.records = [];
        return;
      }

      // 读取文件内容
      const content = await this.app.vault.adapter.read(path);
      const storage = JSON.parse(content) as HistoryStorage;

      this.records = storage.records || [];

      // 验证记录格式
      this.records = this.records.filter(this.isValidRecord);
    } catch (error) {
      console.error('[HistoryManager] 加载存储失败:', error);
      this.records = [];
    }
  }

  /**
   * 保存历史记录到存储
   */
  private async saveToStorage(): Promise<void> {
    const path = this.getStoragePath();
    const storage: HistoryStorage = {
      version: STORAGE_VERSION,
      records: this.records,
    };

    try {
      // 确保目录存在
      const dirExists = await this.app.vault.adapter.exists(HISTORY_DIR);
      if (!dirExists) {
        await this.app.vault.adapter.mkdir(HISTORY_DIR);
      }

      // 写入文件
      const content = JSON.stringify(storage, null, 2);
      await this.app.vault.adapter.write(path, content);
    } catch (error) {
      console.error('[HistoryManager] 保存存储失败:', error);
      throw error;
    }
  }

  /**
   * 验证记录格式是否有效
   * @param record 待验证的记录
   * @returns 是否有效
   */
  private isValidRecord(record: unknown): record is TranscriptionHistory {
    if (!record || typeof record !== 'object') {
      return false;
    }

    const r = record as Record<string, unknown>;

    return (
      typeof r.id === 'string' &&
      typeof r.timestamp === 'number' &&
      (r.mode === 'dictation' || r.mode === 'assistant') &&
      typeof r.originalText === 'string' &&
      typeof r.asrEngine === 'string' &&
      typeof r.usedFallback === 'boolean' &&
      typeof r.duration === 'number'
    );
  }
}
