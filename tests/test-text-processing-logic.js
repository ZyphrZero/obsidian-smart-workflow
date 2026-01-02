/**
 * 文本处理逻辑验证脚本
 * 
 * 用于验证 Phase 5 文本处理组件的核心逻辑：
 * 1. 光标位置计算
 * 2. 助手模式检测
 * 3. 历史记录验证
 * 4. 搜索逻辑
 * 
 * 运行方式: node tests/test-text-processing-logic.js
 */

// ============================================================================
// 测试结果
// ============================================================================

const results = [];

function addResult(name, passed, message) {
  results.push({ name, passed, message });
}

// ============================================================================
// 1. 光标位置计算验证
// ============================================================================

function calculateNewCursorPosition(startPos, text) {
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

function testCursorPositionCalculation() {
  console.log('\n--- 光标位置计算验证 ---');
  
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

  // 测试带换行符结尾的文本
  const trailingNewlineResult = calculateNewCursorPosition({ line: 0, ch: 0 }, 'hello\n');
  addResult(
    '带换行符结尾文本光标计算',
    trailingNewlineResult.line === 1 && trailingNewlineResult.ch === 0,
    `期望 {line: 1, ch: 0}，实际 {line: ${trailingNewlineResult.line}, ch: ${trailingNewlineResult.ch}}`
  );
}

// ============================================================================
// 2. 助手模式检测验证
// ============================================================================

function detectMode(selectedText) {
  return selectedText && selectedText.trim().length > 0 
    ? 'text_processing' 
    : 'qa';
}

function testAssistantModeDetection() {
  console.log('\n--- 助手模式检测验证 ---');
  
  // 测试有选中文本
  addResult(
    '助手模式检测 - 有选中文本',
    detectMode('some text') === 'text_processing',
    '有选中文本时应为 text_processing 模式'
  );

  // 测试无选中文本
  addResult(
    '助手模式检测 - null',
    detectMode(null) === 'qa',
    'null 时应为 qa 模式'
  );

  // 测试 undefined
  addResult(
    '助手模式检测 - undefined',
    detectMode(undefined) === 'qa',
    'undefined 时应为 qa 模式'
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

  // 测试带空白的有效文本
  addResult(
    '助手模式检测 - 带空白的有效文本',
    detectMode('  hello  ') === 'text_processing',
    '带空白的有效文本应为 text_processing 模式'
  );
}

// ============================================================================
// 3. 历史记录验证逻辑
// ============================================================================

function isValidRecord(record) {
  if (!record || typeof record !== 'object') {
    return false;
  }

  return (
    typeof record.id === 'string' &&
    typeof record.timestamp === 'number' &&
    (record.mode === 'dictation' || record.mode === 'assistant') &&
    typeof record.originalText === 'string' &&
    typeof record.asrEngine === 'string' &&
    typeof record.usedFallback === 'boolean' &&
    typeof record.duration === 'number'
  );
}

function testHistoryRecordValidation() {
  console.log('\n--- 历史记录验证逻辑 ---');
  
  // 测试有效记录
  const validRecord = {
    id: 'test-1',
    timestamp: Date.now(),
    mode: 'dictation',
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

  // 测试带可选字段的有效记录
  const validRecordWithOptional = {
    id: 'test-1b',
    timestamp: Date.now(),
    mode: 'dictation',
    originalText: 'hello world',
    processedText: '你好世界',
    llmPreset: 'polishing',
    asrEngine: 'qwen',
    usedFallback: false,
    duration: 1500,
  };
  addResult(
    '带可选字段的有效记录验证',
    isValidRecord(validRecordWithOptional),
    '带可选字段的有效记录应通过验证'
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
    '无效历史记录验证 - 缺少 mode',
    !isValidRecord(invalidRecord1),
    '缺少 mode 字段的记录应不通过验证'
  );

  // 测试无效记录 - 错误类型
  const invalidRecord2 = {
    id: 'test-3',
    timestamp: 'not a number',
    mode: 'dictation',
    originalText: 'hello',
    asrEngine: 'qwen',
    usedFallback: false,
    duration: 1000,
  };
  addResult(
    '无效历史记录验证 - timestamp 类型错误',
    !isValidRecord(invalidRecord2),
    'timestamp 类型错误的记录应不通过验证'
  );

  // 测试无效记录 - 无效模式
  const invalidRecord3 = {
    id: 'test-4',
    timestamp: Date.now(),
    mode: 'invalid_mode',
    originalText: 'hello',
    asrEngine: 'qwen',
    usedFallback: false,
    duration: 1000,
  };
  addResult(
    '无效历史记录验证 - 无效 mode',
    !isValidRecord(invalidRecord3),
    '无效 mode 的记录应不通过验证'
  );

  // 测试 null
  addResult(
    '无效历史记录验证 - null',
    !isValidRecord(null),
    'null 应不通过验证'
  );

  // 测试 undefined
  addResult(
    '无效历史记录验证 - undefined',
    !isValidRecord(undefined),
    'undefined 应不通过验证'
  );
}

// ============================================================================
// 4. 搜索逻辑验证
// ============================================================================

function testSearchLogic() {
  console.log('\n--- 搜索逻辑验证 ---');
  
  const records = [
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
  function search(query) {
    if (!query || query.trim() === '') {
      return [...records];
    }
    const normalizedQuery = query.toLowerCase().trim();
    return records.filter(r => 
      r.originalText.toLowerCase().includes(normalizedQuery) ||
      (r.processedText && r.processedText.toLowerCase().includes(normalizedQuery)) ||
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

  // 测试 null 搜索返回全部
  const result5 = search(null);
  addResult(
    'null 搜索返回全部',
    result5.length === 3,
    `null 搜索返回 ${result5.length} 条记录`
  );

  // 测试无匹配
  const result6 = search('nonexistent');
  addResult(
    '无匹配搜索',
    result6.length === 0,
    `搜索 "nonexistent" 找到 ${result6.length} 条记录`
  );

  // 测试大小写不敏感
  const result7 = search('HELLO');
  addResult(
    '大小写不敏感搜索',
    result7.length === 1 && result7[0].id === '1',
    `搜索 "HELLO" 找到 ${result7.length} 条记录`
  );

  // 测试部分匹配
  const result8 = search('test');
  addResult(
    '部分匹配搜索',
    result8.length === 1 && result8[0].id === '3',
    `搜索 "test" 找到 ${result8.length} 条记录`
  );
}

// ============================================================================
// 5. 文本处理提示构建验证
// ============================================================================

function testTextProcessingPromptBuild() {
  console.log('\n--- 文本处理提示构建验证 ---');
  
  function buildTextProcessingPrompt(voiceCommand, selectedText) {
    return `选中的文本：
${selectedText}

用户指令：${voiceCommand}`;
  }

  const prompt = buildTextProcessingPrompt('翻译成英文', '你好世界');
  
  addResult(
    '文本处理提示包含选中文本标记',
    prompt.includes('选中的文本：'),
    '提示应包含 "选中的文本：" 标记'
  );

  addResult(
    '文本处理提示包含选中文本内容',
    prompt.includes('你好世界'),
    '提示应包含选中的文本内容'
  );

  addResult(
    '文本处理提示包含用户指令标记',
    prompt.includes('用户指令：'),
    '提示应包含 "用户指令：" 标记'
  );

  addResult(
    '文本处理提示包含语音命令',
    prompt.includes('翻译成英文'),
    '提示应包含语音命令'
  );
}

// ============================================================================
// 6. 预设管理验证
// ============================================================================

function testPresetManagement() {
  console.log('\n--- 预设管理验证 ---');
  
  const presets = [
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
  const newPreset = {
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

  // 测试更新预设
  const presetToUpdate = presets.find(p => p.id === 'preset-1');
  if (presetToUpdate) {
    presetToUpdate.name = '高级润色';
  }
  addResult(
    '更新预设',
    presets.find(p => p.id === 'preset-1')?.name === '高级润色',
    `更新后预设名称: ${presets.find(p => p.id === 'preset-1')?.name}`
  );
}

// ============================================================================
// 7. 错误处理验证
// ============================================================================

function testErrorHandling() {
  console.log('\n--- 错误处理验证 ---');
  
  // 模拟 LLMProcessingError
  class LLMProcessingError extends Error {
    constructor(message, rawText) {
      super(message);
      this.name = 'LLMProcessingError';
      this.rawText = rawText;
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

  addResult(
    'LLMProcessingError 消息正确',
    error.message === 'LLM 处理失败',
    `错误消息: ${error.message}`
  );

  // 模拟 VoiceServerError
  class VoiceServerError extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'VoiceServerError';
      this.code = code;
    }
  }

  const serverError = new VoiceServerError('服务器未运行', 'SERVER_NOT_RUNNING');
  
  addResult(
    'VoiceServerError 包含错误码',
    serverError.code === 'SERVER_NOT_RUNNING',
    `错误码: ${serverError.code}`
  );
}

// ============================================================================
// 打印结果
// ============================================================================

function printResults() {
  console.log('\n========================================');
  console.log('         文本处理逻辑验证结果');
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

  return failed === 0;
}

// ============================================================================
// 主函数
// ============================================================================

function main() {
  console.log('\n========================================');
  console.log('      文本处理组件逻辑验证');
  console.log('========================================');

  testCursorPositionCalculation();
  testAssistantModeDetection();
  testHistoryRecordValidation();
  testSearchLogic();
  testTextProcessingPromptBuild();
  testPresetManagement();
  testErrorHandling();

  const success = printResults();

  if (!success) {
    console.log('[TEST] ✗ 部分测试失败');
    process.exit(1);
  }

  console.log('[TEST] ✓ 所有测试通过！');
}

main();
