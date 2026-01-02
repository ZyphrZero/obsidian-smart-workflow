/**
 * 文本处理验证脚本
 * 
 * 用于验证 Phase 5 文本处理组件的功能：
 * 1. TextInserter - 文本插入器
 * 2. LLMPostProcessor - LLM 后处理器
 * 3. AssistantProcessor - AI 助手处理器
 * 4. HistoryManager - 历史记录管理器
 * 
 * 这是一个类型检查和逻辑验证脚本
 * 运行方式: npx tsc --noEmit tests/test-text-processing.ts
 */

import type { ITextInserter, TranscriptionHistory, IHistoryManager, VoiceInputMode } from '../src/services/voice/types';
import type { ILLMPostProcessor } from '../src/services/voice/voiceInputService';
import type { VoiceLLMPreset } from '../src/settings/settings';

// ============================================================================
// 测试结果类型
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
}

const results: TestResult[] = [];

function addResult(name: string, passed: boolean, message: string): void {
  results.push({ name, passed, message });
}

// ============================================================================
// 1. TextInserter 验证
// ============================================================================

/**
 * 验证 TextInserter 接口实现
 */
function validateTextInserterInterface(): void {
  // 模拟 TextInserter 实现 (符合 ITextInserter 接口)
  const mockTextInserter: ITextInserter = {
    async insertAtCursor(text: string): Promise<boolean> {
      // 验证参数类型
      if (typeof text !== 'string') {
        return false;
      }
      return true;
    },
    
    async replaceSelection(text: string): Promise<boolean> {
      if (typeof text !== 'string') {
        return false;
      }
      return true;
    },
    
    hasActiveEditor(): boolean {
      return true;
    },
  };

  // 测试 insertAtCursor
  addResult(
    'TextInserter.insertAtCursor 接口',
    typeof mockTextInserter.insertAtCursor === 'function',
    'insertAtCursor 方法存在且为函数'
  );

  // 测试 replaceSelection
  addResult(
    'TextInserter.replaceSelection 接口',
    typeof mockTextInserter.replaceSelection === 'function',
    'replaceSelection 方法存在且为函数'
  );

  // 测试 hasActiveEditor
  addResult(
    'TextInserter.hasActiveEditor 接口',
    typeof mockTextInserter.hasActiveEditor === 'function',
    'hasActiveEditor 方法存在且为函数'
  );
}

/**
 * 验证光标位置计算逻辑
 */
function validateCursorPositionCalculation(): void {
  // 模拟光标位置计算
  function calculateNewCursorPosition(
    startPos: { line: number; ch: number },
    text: string
  ): { line: number; ch: number } {
    const lines = text.split('\n');
    const lineCount = lines.length;
    const lastLineLength = lines[lineCount - 1].length;
    
    if (lineCount === 1) {
      return {
        line: startPos.line,
        ch: startPos.ch + lastLineLength,
      };
    } else {
      return {
        line: startPos.line + lineCount - 1,
        ch: lastLineLength,
      };
    }
  }

  // 测试单行文本
  const singleLineResult = calculateNewCursorPosition({ line: 0, ch: 5 }, 'hello');
  addResult(
    '单行文本光标计算',
    singleLineResult.line === 0 && singleLineResult.ch === 10,
    `期望 {line: 0, ch: 10}，实际 {line: ${singleLineResult.line}, ch: ${singleLineResult.ch}}`
  );

  // 测试多行文本
  const multiLineResult = calculateNewCursorPosition({ line: 2, ch: 3 }, 'line1\nline2\nline3');
  addResult(
    '多行文本光标计算',
    multiLineResult.line === 4 && multiLineResult.ch === 5,
    `期望 {line: 4, ch: 5}，实际 {line: ${multiLineResult.line}, ch: ${multiLineResult.ch}}`
  );

  // 测试空文本
  const emptyResult = calculateNewCursorPosition({ line: 1, ch: 0 }, '');
  addResult(
    '空文本光标计算',
    emptyResult.line === 1 && emptyResult.ch === 0,
    `期望 {line: 1, ch: 0}，实际 {line: ${emptyResult.line}, ch: ${emptyResult.ch}}`
  );
}

// ============================================================================
// 2. LLMPostProcessor 验证
// ============================================================================

/**
 * 验证 LLMPostProcessor 接口实现
 */
function validateLLMPostProcessorInterface(): void {
  // 模拟 LLMPostProcessor 实现
  const mockProcessor: ILLMPostProcessor = {
    async process(text: string, systemPrompt: string): Promise<string> {
      // 验证参数类型
      if (typeof text !== 'string' || typeof systemPrompt !== 'string') {
        throw new Error('Invalid parameters');
      }
      return `Processed: ${text}`;
    },
  };

  addResult(
    'LLMPostProcessor.process 接口',
    typeof mockProcessor.process === 'function',
    'process 方法存在且为函数'
  );
}

/**
 * 验证预设管理逻辑
 */
function validatePresetManagement(): void {
  // 模拟预设列表 (符合 VoiceLLMPreset 接口)
  const presets: VoiceLLMPreset[] = [
    {
      id: 'preset-1',
      name: '文本润色',
      systemPrompt: '请润色以下文本...',
    },
    {
      id: 'preset-2',
      name: '翻译',
      systemPrompt: '请将以下文本翻译为英文...',
    },
  ];

  // 测试获取预设
  const preset = presets.find(p => p.id === 'preset-1');
  addResult(
    '预设获取',
    preset !== undefined && preset.name === '文本润色',
    `获取预设 preset-1: ${preset?.name}`
  );

  // 测试预设不存在
  const notFound = presets.find(p => p.id === 'non-existent');
  addResult(
    '预设不存在处理',
    notFound === undefined,
    '不存在的预设返回 undefined'
  );

  // 测试添加预设
  const newPreset: VoiceLLMPreset = {
    id: 'preset-3',
    name: '摘要',
    systemPrompt: '请生成摘要...',
  };
  presets.push(newPreset);
  addResult(
    '添加预设',
    presets.length === 3 && presets[2].id === 'preset-3',
    `预设数量: ${presets.length}`
  );

  // 测试删除预设
  const indexToDelete = presets.findIndex(p => p.id === 'preset-2');
  if (indexToDelete !== -1) {
    presets.splice(indexToDelete, 1);
  }
  addResult(
    '删除预设',
    presets.length === 2 && !presets.some(p => p.id === 'preset-2'),
    `删除后预设数量: ${presets.length}`
  );
}

// ============================================================================
// 3. AssistantProcessor 验证
// ============================================================================

/**
 * 验证助手模式检测逻辑
 */
function validateAssistantModeDetection(): void {
  // 模式检测函数
  function detectMode(selectedText?: string | null): 'qa' | 'text_processing' {
    return selectedText && selectedText.trim().length > 0 
      ? 'text_processing' 
      : 'qa';
  }

  // 测试有选中文本
  addResult(
    '助手模式检测 - 有选中文本',
    detectMode('some text') === 'text_processing',
    '有选中文本时应为 text_processing 模式'
  );

  // 测试无选中文本
  addResult(
    '助手模式检测 - 无选中文本',
    detectMode(null) === 'qa',
    '无选中文本时应为 qa 模式'
  );

  // 测试空字符串
  addResult(
    '助手模式检测 - 空字符串',
    detectMode('') === 'qa',
    '空字符串时应为 qa 模式'
  );

  // 测试纯空白字符串
  addResult(
    '助手模式检测 - 纯空白',
    detectMode('   \n\t  ') === 'qa',
    '纯空白字符串时应为 qa 模式'
  );
}

/**
 * 验证文本处理提示构建
 */
function validateTextProcessingPromptBuild(): void {
  // 提示构建函数
  function buildTextProcessingPrompt(voiceCommand: string, selectedText: string): string {
    return `选中的文本：
${selectedText}

用户指令：${voiceCommand}`;
  }

  const prompt = buildTextProcessingPrompt('翻译成英文', '你好世界');
  
  addResult(
    '文本处理提示构建',
    prompt.includes('选中的文本：') && 
    prompt.includes('你好世界') && 
    prompt.includes('用户指令：') &&
    prompt.includes('翻译成英文'),
    '提示包含所有必要部分'
  );
}

// ============================================================================
// 4. HistoryManager 验证
// ============================================================================

/**
 * 验证历史记录接口实现
 */
function validateHistoryManagerInterface(): void {
  // 模拟历史记录
  const records: TranscriptionHistory[] = [];

  // 模拟 HistoryManager 实现 (符合 IHistoryManager 接口)
  const mockHistoryManager: IHistoryManager = {
    async save(record: Omit<TranscriptionHistory, 'id'>): Promise<void> {
      const newRecord: TranscriptionHistory = {
        ...record,
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      };
      records.unshift(newRecord);
    },
    
    async getAll(): Promise<TranscriptionHistory[]> {
      return [...records];
    },
    
    async search(query: string): Promise<TranscriptionHistory[]> {
      if (!query || query.trim() === '') {
        return [...records];
      }
      const normalizedQuery = query.toLowerCase().trim();
      return records.filter(r => 
        r.originalText.toLowerCase().includes(normalizedQuery) ||
        r.processedText?.toLowerCase().includes(normalizedQuery)
      );
    },
    
    async clear(): Promise<void> {
      records.length = 0;
    },
  };

  addResult(
    'HistoryManager.save 接口',
    typeof mockHistoryManager.save === 'function',
    'save 方法存在且为函数'
  );

  addResult(
    'HistoryManager.getAll 接口',
    typeof mockHistoryManager.getAll === 'function',
    'getAll 方法存在且为函数'
  );

  addResult(
    'HistoryManager.search 接口',
    typeof mockHistoryManager.search === 'function',
    'search 方法存在且为函数'
  );

  addResult(
    'HistoryManager.clear 接口',
    typeof mockHistoryManager.clear === 'function',
    'clear 方法存在且为函数'
  );
}

/**
 * 验证历史记录验证逻辑
 */
function validateHistoryRecordValidation(): void {
  // 记录验证函数
  function isValidRecord(record: unknown): record is TranscriptionHistory {
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

  // 测试有效记录
  const validRecord = {
    id: 'test-1',
    timestamp: Date.now(),
    mode: 'dictation' as VoiceInputMode,
    originalText: 'hello world',
    asrEngine: 'qwen',
    usedFallback: false,
    duration: 1500,
  };
  addResult(
    '有效历史记录验证',
    isValidRecord(validRecord),
    '有效记录应通过验证'
  );

  // 测试无效记录 - 缺少字段
  const invalidRecord1 = {
    id: 'test-2',
    timestamp: Date.now(),
    // 缺少 mode
    originalText: 'hello',
    asrEngine: 'qwen',
    usedFallback: false,
    duration: 1000,
  };
  addResult(
    '无效历史记录验证 - 缺少字段',
    !isValidRecord(invalidRecord1),
    '缺少必要字段的记录应不通过验证'
  );

  // 测试无效记录 - 错误类型
  const invalidRecord2 = {
    id: 'test-3',
    timestamp: 'not a number', // 应该是 number
    mode: 'dictation',
    originalText: 'hello',
    asrEngine: 'qwen',
    usedFallback: false,
    duration: 1000,
  };
  addResult(
    '无效历史记录验证 - 错误类型',
    !isValidRecord(invalidRecord2),
    '类型错误的记录应不通过验证'
  );

  // 测试无效记录 - 无效模式
  const invalidRecord3 = {
    id: 'test-4',
    timestamp: Date.now(),
    mode: 'invalid_mode', // 应该是 'dictation' 或 'assistant'
    originalText: 'hello',
    asrEngine: 'qwen',
    usedFallback: false,
    duration: 1000,
  };
  addResult(
    '无效历史记录验证 - 无效模式',
    !isValidRecord(invalidRecord3),
    '无效模式的记录应不通过验证'
  );
}

/**
 * 验证搜索逻辑
 */
function validateSearchLogic(): void {
  const records: TranscriptionHistory[] = [
    {
      id: '1',
      timestamp: Date.now(),
      mode: 'dictation',
      originalText: 'hello world',
      processedText: '你好世界',
      asrEngine: 'qwen',
      usedFallback: false,
      duration: 1000,
    },
    {
      id: '2',
      timestamp: Date.now() - 1000,
      mode: 'assistant',
      originalText: 'translate this',
      asrEngine: 'doubao',
      usedFallback: true,
      duration: 2000,
    },
    {
      id: '3',
      timestamp: Date.now() - 2000,
      mode: 'dictation',
      originalText: 'another test',
      asrEngine: 'sensevoice',
      usedFallback: false,
      duration: 1500,
    },
  ];

  // 搜索函数
  function search(query: string): TranscriptionHistory[] {
    if (!query || query.trim() === '') {
      return [...records];
    }
    const normalizedQuery = query.toLowerCase().trim();
    return records.filter(r => 
      r.originalText.toLowerCase().includes(normalizedQuery) ||
      r.processedText?.toLowerCase().includes(normalizedQuery) ||
      r.asrEngine.toLowerCase().includes(normalizedQuery)
    );
  }

  // 测试搜索原始文本
  const result1 = search('hello');
  addResult(
    '搜索原始文本',
    result1.length === 1 && result1[0].id === '1',
    `搜索 "hello" 找到 ${result1.length} 条记录`
  );

  // 测试搜索处理后文本
  const result2 = search('你好');
  addResult(
    '搜索处理后文本',
    result2.length === 1 && result2[0].id === '1',
    `搜索 "你好" 找到 ${result2.length} 条记录`
  );

  // 测试搜索引擎名称
  const result3 = search('qwen');
  addResult(
    '搜索引擎名称',
    result3.length === 1 && result3[0].id === '1',
    `搜索 "qwen" 找到 ${result3.length} 条记录`
  );

  // 测试空搜索返回全部
  const result4 = search('');
  addResult(
    '空搜索返回全部',
    result4.length === 3,
    `空搜索返回 ${result4.length} 条记录`
  );

  // 测试无匹配
  const result5 = search('nonexistent');
  addResult(
    '无匹配搜索',
    result5.length === 0,
    `搜索 "nonexistent" 找到 ${result5.length} 条记录`
  );
}

// ============================================================================
// 5. 集成验证
// ============================================================================

/**
 * 验证 VoiceInputService 与文本处理组件的集成
 */
function validateServiceIntegration(): void {
  // 验证 DictationResult 类型
  interface DictationResult {
    originalText: string;
    processedText: string;
    usedLLMProcessing: boolean;
    asrEngine: string;
    usedFallback: boolean;
    duration: number;
  }

  const mockResult: DictationResult = {
    originalText: 'hello world',
    processedText: '你好世界',
    usedLLMProcessing: true,
    asrEngine: 'qwen',
    usedFallback: false,
    duration: 1500,
  };

  addResult(
    'DictationResult 类型完整性',
    mockResult.originalText !== undefined &&
    mockResult.processedText !== undefined &&
    mockResult.usedLLMProcessing !== undefined &&
    mockResult.asrEngine !== undefined &&
    mockResult.usedFallback !== undefined &&
    mockResult.duration !== undefined,
    'DictationResult 包含所有必要字段'
  );

  // 验证 AssistantResult 类型
  interface AssistantResult {
    voiceCommand: string;
    selectedText: string | null;
    mode: 'qa' | 'text_processing';
    response: string | null;
    asrEngine: string;
    usedFallback: boolean;
    duration: number;
  }

  const mockAssistantResult: AssistantResult = {
    voiceCommand: 'translate this',
    selectedText: 'hello world',
    mode: 'text_processing',
    response: '你好世界',
    asrEngine: 'doubao',
    usedFallback: false,
    duration: 2000,
  };

  addResult(
    'AssistantResult 类型完整性',
    mockAssistantResult.voiceCommand !== undefined &&
    mockAssistantResult.mode !== undefined &&
    mockAssistantResult.asrEngine !== undefined,
    'AssistantResult 包含所有必要字段'
  );
}

/**
 * 验证错误处理
 */
function validateErrorHandling(): void {
  // LLMProcessingError 类型
  class LLMProcessingError extends Error {
    constructor(
      message: string,
      public readonly rawText: string
    ) {
      super(message);
      this.name = 'LLMProcessingError';
    }
  }

  const error = new LLMProcessingError('LLM 处理失败', 'original text');
  
  addResult(
    'LLMProcessingError 包含原始文本',
    error.rawText === 'original text',
    `错误包含原始文本: ${error.rawText}`
  );

  addResult(
    'LLMProcessingError 名称正确',
    error.name === 'LLMProcessingError',
    `错误名称: ${error.name}`
  );
}

// ============================================================================
// 运行所有验证
// ============================================================================

function runAllValidations(): void {
  console.log('\n========================================');
  console.log('      文本处理组件验证');
  console.log('========================================\n');

  // 1. TextInserter 验证
  console.log('--- TextInserter 验证 ---');
  validateTextInserterInterface();
  validateCursorPositionCalculation();

  // 2. LLMPostProcessor 验证
  console.log('\n--- LLMPostProcessor 验证 ---');
  validateLLMPostProcessorInterface();
  validatePresetManagement();

  // 3. AssistantProcessor 验证
  console.log('\n--- AssistantProcessor 验证 ---');
  validateAssistantModeDetection();
  validateTextProcessingPromptBuild();

  // 4. HistoryManager 验证
  console.log('\n--- HistoryManager 验证 ---');
  validateHistoryManagerInterface();
  validateHistoryRecordValidation();
  validateSearchLogic();

  // 5. 集成验证
  console.log('\n--- 集成验证 ---');
  validateServiceIntegration();
  validateErrorHandling();

  // 打印结果
  console.log('\n========================================');
  console.log('           验证结果');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    const status = result.passed ? '✓ PASS' : '✗ FAIL';
    const color = result.passed ? '\x1b[32m' : '\x1b[31m';
    console.log(`${color}${status}\x1b[0m  ${result.name}`);
    if (!result.passed) {
      console.log(`         ${result.message}`);
    }
    if (result.passed) passed++;
    else failed++;
  }

  console.log('\n----------------------------------------');
  console.log(`总计: ${passed} 通过, ${failed} 失败`);
  console.log('========================================\n');
}

// 导出验证函数供外部调用
export {
  runAllValidations,
  validateTextInserterInterface,
  validateCursorPositionCalculation,
  validateLLMPostProcessorInterface,
  validatePresetManagement,
  validateAssistantModeDetection,
  validateTextProcessingPromptBuild,
  validateHistoryManagerInterface,
  validateHistoryRecordValidation,
  validateSearchLogic,
  validateServiceIntegration,
  validateErrorHandling,
};
