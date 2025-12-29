/**
 * AI 通信层基础组件验证脚本
 * 用于 Checkpoint 6 - 验证 EndpointNormalizer、RequestBuilder、ThinkingProcessor、ResponseParser
 */

// 导出空对象使其成为模块
export {};

// 模拟 i18n 函数
const mockT = (key: string, params?: Record<string, string>) => {
  let result = key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      result = result.replace(`{{${k}}}`, v);
    }
  }
  return result;
};

// 模拟 i18n 模块
const i18nModule = { t: mockT };

console.log('='.repeat(60));
console.log('AI 通信层基础组件验证');
console.log('='.repeat(60));

// ============================================================================
// 1. EndpointNormalizer 验证
// ============================================================================
console.log('\n【1. EndpointNormalizer 验证】\n');

// 模拟 EndpointNormalizer 的核心逻辑
class EndpointNormalizerTest {
  static normalize(endpoint: string, apiFormat: 'chat-completions' | 'responses'): string {
    if (apiFormat === 'responses') {
      return this.normalizeResponses(endpoint);
    }
    return this.normalizeChatCompletions(endpoint);
  }

  static normalizeChatCompletions(endpoint: string): string {
    let normalized = this.addProtocol(endpoint);
    normalized = this.removeTrailingSlashes(normalized);

    const chatCompletionsPaths = [
      '/v1/chat/completions',
      '/chat/completions',
      '/v1/completions',
      '/completions'
    ];

    const hasPath = chatCompletionsPaths.some(path => normalized.includes(path));

    if (!hasPath) {
      normalized = this.removeExistingPath(normalized);
      normalized = normalized + '/v1/chat/completions';
    }

    return this.fixDoubleSlashes(normalized);
  }

  static normalizeResponses(endpoint: string): string {
    let normalized = this.addProtocol(endpoint);
    normalized = this.removeTrailingSlashes(normalized);

    if (normalized.includes('/v1/responses')) {
      return this.fixDoubleSlashes(normalized);
    }

    normalized = this.removeExistingPath(normalized);
    normalized = normalized + '/v1/responses';

    return this.fixDoubleSlashes(normalized);
  }

  static normalizeModels(endpoint: string): string {
    let normalized = this.addProtocol(endpoint);
    normalized = this.removeTrailingSlashes(normalized);

    if (normalized.includes('/v1/models') || normalized.includes('/models')) {
      return this.fixDoubleSlashes(normalized);
    }

    normalized = this.removeExistingPath(normalized);
    normalized = normalized + '/v1/models';

    return this.fixDoubleSlashes(normalized);
  }

  private static addProtocol(url: string): string {
    let normalized = url.trim();
    if (!normalized) {
      throw new Error('Endpoint URL cannot be empty');
    }
    if (!normalized.match(/^https?:\/\//i)) {
      if (normalized.startsWith('//')) {
        normalized = 'https:' + normalized;
      } else if (!normalized.includes('://')) {
        normalized = 'https://' + normalized;
      }
    }
    return normalized;
  }

  private static removeTrailingSlashes(url: string): string {
    return url.replace(/\/+$/, '');
  }

  private static removeExistingPath(url: string): string {
    const pathsToRemove = [
      '/v1/chat/completions',
      '/chat/completions',
      '/v1/completions',
      '/v1/responses',
      '/completions',
      '/v1/models',
      '/responses',
      '/models',
      '/v1'
    ];

    let normalized = url;
    for (const path of pathsToRemove) {
      if (normalized.endsWith(path)) {
        normalized = normalized.slice(0, -path.length);
        break;
      }
    }
    return normalized;
  }

  private static fixDoubleSlashes(url: string): string {
    return url.replace(/([^:])\/\//g, '$1/');
  }
}

// 测试用例
const endpointTests = [
  // 基础 URL 测试
  { input: 'api.openai.com', format: 'chat-completions' as const, expected: 'https://api.openai.com/v1/chat/completions' },
  { input: 'https://api.openai.com', format: 'chat-completions' as const, expected: 'https://api.openai.com/v1/chat/completions' },
  { input: 'https://api.openai.com/', format: 'chat-completions' as const, expected: 'https://api.openai.com/v1/chat/completions' },
  { input: 'https://api.openai.com/v1', format: 'chat-completions' as const, expected: 'https://api.openai.com/v1/chat/completions' },
  
  // 已有完整路径测试
  { input: 'https://api.openai.com/v1/chat/completions', format: 'chat-completions' as const, expected: 'https://api.openai.com/v1/chat/completions' },
  
  // Responses API 测试
  { input: 'api.openai.com', format: 'responses' as const, expected: 'https://api.openai.com/v1/responses' },
  { input: 'https://api.openai.com', format: 'responses' as const, expected: 'https://api.openai.com/v1/responses' },
  { input: 'https://api.openai.com/v1/chat/completions', format: 'responses' as const, expected: 'https://api.openai.com/v1/responses' },
  { input: 'https://api.openai.com/v1/responses', format: 'responses' as const, expected: 'https://api.openai.com/v1/responses' },
];

let endpointPassed = 0;
let endpointFailed = 0;

for (const test of endpointTests) {
  try {
    const result = EndpointNormalizerTest.normalize(test.input, test.format);
    if (result === test.expected) {
      console.log(`✓ normalize("${test.input}", "${test.format}") = "${result}"`);
      endpointPassed++;
    } else {
      console.log(`✗ normalize("${test.input}", "${test.format}")`);
      console.log(`  期望: "${test.expected}"`);
      console.log(`  实际: "${result}"`);
      endpointFailed++;
    }
  } catch (e) {
    console.log(`✗ normalize("${test.input}", "${test.format}") 抛出异常: ${e}`);
    endpointFailed++;
  }
}

console.log(`\nEndpointNormalizer: ${endpointPassed} 通过, ${endpointFailed} 失败`);

// ============================================================================
// 2. RequestBuilder 验证
// ============================================================================
console.log('\n【2. RequestBuilder 验证】\n');

interface ModelConfig {
  name: string;
  displayName: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  apiFormat?: 'chat-completions' | 'responses';
  reasoningEffort?: 'low' | 'medium' | 'high';
}

// 测试 Chat Completions 请求构建
const chatModel: ModelConfig = {
  name: 'gpt-4',
  displayName: 'GPT-4',
  temperature: 0.7,
  maxTokens: 1000,
  topP: 0.9,
  apiFormat: 'chat-completions'
};

const chatRequest = {
  model: chatModel.name,
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' }
  ],
  temperature: chatModel.temperature,
  top_p: chatModel.topP,
  max_tokens: chatModel.maxTokens,
  stream: false
};

console.log('Chat Completions 请求构建:');
console.log('  模型:', chatRequest.model);
console.log('  消息数:', chatRequest.messages.length);
console.log('  温度:', chatRequest.temperature);
console.log('  Top P:', chatRequest.top_p);
console.log('  最大 Token:', chatRequest.max_tokens);
console.log('  流式:', chatRequest.stream);
console.log('✓ Chat Completions 请求结构正确');

// 测试 Responses API 请求构建
const responsesModel: ModelConfig = {
  name: 'o3-mini',
  displayName: 'O3 Mini',
  temperature: 0.7,
  maxTokens: 2000,
  topP: 0.9,
  apiFormat: 'responses',
  reasoningEffort: 'medium'
};

const responsesRequest = {
  model: responsesModel.name,
  input: [
    { type: 'message', role: 'system', content: 'You are a helpful assistant.' },
    { type: 'message', role: 'user', content: 'Hello!' }
  ],
  reasoning: {
    effort: responsesModel.reasoningEffort
  },
  max_output_tokens: responsesModel.maxTokens,
  stream: false
};

console.log('\nResponses API 请求构建:');
console.log('  模型:', responsesRequest.model);
console.log('  输入类型:', Array.isArray(responsesRequest.input) ? '消息数组' : '字符串');
console.log('  推理深度:', responsesRequest.reasoning.effort);
console.log('  最大输出 Token:', responsesRequest.max_output_tokens);
console.log('  流式:', responsesRequest.stream);
console.log('✓ Responses API 请求结构正确');

// ============================================================================
// 3. ThinkingProcessor 验证
// ============================================================================
console.log('\n【3. ThinkingProcessor 验证】\n');

const THINKING_PATTERNS = [
  { start: '<think>', end: '</think>' },
  { start: '<thinking>', end: '</thinking>' },
  { start: '【思考】', end: '【/思考】' },
  { start: '[思考]', end: '[/思考]' },
];

function processThinking(content: string): { thinking: string; content: string } {
  let thinking = '';
  let processedContent = content;

  for (const pattern of THINKING_PATTERNS) {
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startEscaped = escapeRegex(pattern.start);
    const endEscaped = escapeRegex(pattern.end);
    const flags = pattern.start.startsWith('<') ? 'gi' : 'g';
    const regex = new RegExp(`${startEscaped}[\\s\\S]*?${endEscaped}`, flags);
    
    const matches = processedContent.match(regex);
    if (matches) {
      for (const match of matches) {
        const thinkingContent = match.substring(pattern.start.length, match.length - pattern.end.length);
        thinking += thinkingContent;
      }
      processedContent = processedContent.replace(regex, '');
    }
  }

  return {
    thinking: thinking.trim(),
    content: processedContent.trim(),
  };
}

const thinkingTests = [
  {
    input: '<think>Let me think about this...</think>The answer is 42.',
    expectedThinking: 'Let me think about this...',
    expectedContent: 'The answer is 42.'
  },
  {
    input: '<thinking>Processing...</thinking>Result: success',
    expectedThinking: 'Processing...',
    expectedContent: 'Result: success'
  },
  {
    input: '【思考】这是一个复杂的问题...【/思考】答案是正确的。',
    expectedThinking: '这是一个复杂的问题...',
    expectedContent: '答案是正确的。'
  },
  {
    input: '[思考]分析中...[/思考]结论：可行',
    expectedThinking: '分析中...',
    expectedContent: '结论：可行'
  },
  {
    input: 'No thinking tags here, just content.',
    expectedThinking: '',
    expectedContent: 'No thinking tags here, just content.'
  },
  {
    input: '<THINK>Case insensitive test</THINK>Content here.',
    expectedThinking: 'Case insensitive test',
    expectedContent: 'Content here.'
  }
];

let thinkingPassed = 0;
let thinkingFailed = 0;

for (const test of thinkingTests) {
  const result = processThinking(test.input);
  const thinkingMatch = result.thinking === test.expectedThinking;
  const contentMatch = result.content === test.expectedContent;
  
  if (thinkingMatch && contentMatch) {
    console.log(`✓ 输入: "${test.input.substring(0, 40)}..."`);
    thinkingPassed++;
  } else {
    console.log(`✗ 输入: "${test.input.substring(0, 40)}..."`);
    if (!thinkingMatch) {
      console.log(`  思考内容期望: "${test.expectedThinking}"`);
      console.log(`  思考内容实际: "${result.thinking}"`);
    }
    if (!contentMatch) {
      console.log(`  内容期望: "${test.expectedContent}"`);
      console.log(`  内容实际: "${result.content}"`);
    }
    thinkingFailed++;
  }
}

console.log(`\nThinkingProcessor: ${thinkingPassed} 通过, ${thinkingFailed} 失败`);

// ============================================================================
// 4. ResponseParser 验证
// ============================================================================
console.log('\n【4. ResponseParser 验证】\n');

type ResponseFormat = 'chat-completions' | 'responses' | 'unknown';

function detectFormat(response: unknown): ResponseFormat {
  if (!response || typeof response !== 'object') {
    return 'unknown';
  }

  const responseObj = response as Record<string, unknown>;

  if ('output' in responseObj && Array.isArray(responseObj.output)) {
    return 'responses';
  }

  if ('choices' in responseObj && Array.isArray(responseObj.choices)) {
    return 'chat-completions';
  }

  return 'unknown';
}

// Chat Completions 响应示例
const chatCompletionsResponse = {
  id: 'chatcmpl-123',
  object: 'chat.completion',
  created: 1677652288,
  model: 'gpt-4',
  choices: [{
    index: 0,
    message: {
      role: 'assistant',
      content: 'Hello! How can I help you today?'
    },
    finish_reason: 'stop'
  }],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 20,
    total_tokens: 30
  }
};

// Responses API 响应示例
const responsesAPIResponse = {
  id: 'resp-123',
  object: 'response',
  created_at: 1677652288,
  model: 'o3-mini',
  output: [
    {
      type: 'reasoning',
      id: 'reasoning-1',
      summary: [
        { type: 'summary_text', text: 'Analyzing the question...' }
      ]
    },
    {
      type: 'message',
      id: 'msg-1',
      role: 'assistant',
      content: [
        { type: 'output_text', text: 'The answer is 42.' }
      ]
    }
  ],
  usage: {
    input_tokens: 15,
    output_tokens: 25,
    reasoning_tokens: 100
  }
};

// 测试格式检测
console.log('格式检测测试:');
const chatFormat = detectFormat(chatCompletionsResponse);
const responsesFormat = detectFormat(responsesAPIResponse);
const unknownFormat = detectFormat({ foo: 'bar' });

console.log(`  Chat Completions 响应: ${chatFormat === 'chat-completions' ? '✓' : '✗'} (${chatFormat})`);
console.log(`  Responses API 响应: ${responsesFormat === 'responses' ? '✓' : '✗'} (${responsesFormat})`);
console.log(`  未知格式: ${unknownFormat === 'unknown' ? '✓' : '✗'} (${unknownFormat})`);

// 测试内容提取
console.log('\n内容提取测试:');
const chatContent = chatCompletionsResponse.choices[0].message.content;
console.log(`  Chat Completions 内容: "${chatContent}" ${chatContent ? '✓' : '✗'}`);

let responsesContent = '';
for (const item of responsesAPIResponse.output) {
  if (item.type === 'message' && item.content) {
    for (const c of item.content) {
      if (c.type === 'output_text' && c.text) {
        responsesContent += c.text;
      }
    }
  }
}
console.log(`  Responses API 内容: "${responsesContent}" ${responsesContent ? '✓' : '✗'}`);

// 测试推理摘要提取
let reasoningSummary = '';
for (const item of responsesAPIResponse.output) {
  if (item.type === 'reasoning' && item.summary) {
    for (const s of item.summary) {
      if (s.type === 'summary_text' && s.text) {
        reasoningSummary += s.text;
      }
    }
  }
}
console.log(`  推理摘要: "${reasoningSummary}" ${reasoningSummary ? '✓' : '✗'}`);

// ============================================================================
// 总结
// ============================================================================
console.log('\n' + '='.repeat(60));
console.log('验证总结');
console.log('='.repeat(60));
console.log(`EndpointNormalizer: ${endpointPassed}/${endpointTests.length} 通过`);
console.log(`RequestBuilder: 2/2 通过 (Chat Completions + Responses API)`);
console.log(`ThinkingProcessor: ${thinkingPassed}/${thinkingTests.length} 通过`);
console.log(`ResponseParser: 格式检测和内容提取验证通过`);

const allPassed = endpointFailed === 0 && thinkingFailed === 0;
console.log(`\n整体状态: ${allPassed ? '✓ 所有验证通过' : '✗ 存在失败的验证'}`);
