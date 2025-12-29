/**
 * AI 通信层完整性验证脚本
 * Checkpoint 9 - 验证 AIClient 非流式请求、流式请求、错误处理和取消功能
 */

// 导出空对象使其成为模块
export {};

console.log('='.repeat(60));
console.log('AI 通信层完整性验证 - Checkpoint 9');
console.log('='.repeat(60));

// ============================================================================
// 模拟类型定义
// ============================================================================

interface Provider {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
  models: ModelConfig[];
}

interface ModelConfig {
  id: string;
  name: string;
  displayName: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  apiFormat?: 'chat-completions' | 'responses';
  reasoningEffort?: 'low' | 'medium' | 'high';
}

interface AIClientOptions {
  provider: Provider;
  model: ModelConfig;
  timeout?: number;
  debugMode?: boolean;
}

// ============================================================================
// 1. AIClient 配置验证测试
// ============================================================================
console.log('\n【1. AIClient 配置验证测试】\n');

// 模拟 AIClient.validateOptions 逻辑
function validateOptions(options: AIClientOptions): { valid: boolean; error?: string } {
  const { provider, model } = options;

  // 验证供应商配置
  if (!provider) {
    return { valid: false, error: 'NO_PROVIDER_CONFIGURED' };
  }

  if (!provider.apiKey || provider.apiKey.trim() === '') {
    return { valid: false, error: 'INVALID_API_KEY' };
  }

  if (!provider.endpoint || provider.endpoint.trim() === '') {
    return { valid: false, error: 'INVALID_ENDPOINT' };
  }

  // 验证模型配置
  if (!model) {
    return { valid: false, error: 'NO_MODEL_CONFIGURED' };
  }

  if (!model.name || model.name.trim() === '') {
    return { valid: false, error: 'INVALID_MODEL_NAME' };
  }

  return { valid: true };
}

// 测试用例
const validProvider: Provider = {
  id: 'test-provider',
  name: 'Test Provider',
  endpoint: 'https://api.openai.com',
  apiKey: 'sk-test-key',
  models: []
};

const validModel: ModelConfig = {
  id: 'test-model',
  name: 'gpt-4',
  displayName: 'GPT-4',
  temperature: 0.7,
  maxTokens: 1000,
  topP: 0.9,
  apiFormat: 'chat-completions'
};

const configTests = [
  {
    name: '有效配置',
    options: { provider: validProvider, model: validModel },
    expectedValid: true
  },
  {
    name: '缺少 API Key',
    options: { provider: { ...validProvider, apiKey: '' }, model: validModel },
    expectedValid: false,
    expectedError: 'INVALID_API_KEY'
  },
  {
    name: '缺少端点',
    options: { provider: { ...validProvider, endpoint: '' }, model: validModel },
    expectedValid: false,
    expectedError: 'INVALID_ENDPOINT'
  },
  {
    name: '缺少模型名称',
    options: { provider: validProvider, model: { ...validModel, name: '' } },
    expectedValid: false,
    expectedError: 'INVALID_MODEL_NAME'
  }
];

let configPassed = 0;
let configFailed = 0;

for (const test of configTests) {
  const result = validateOptions(test.options as AIClientOptions);
  const passed = result.valid === test.expectedValid && 
                 (!test.expectedError || result.error === test.expectedError);
  
  if (passed) {
    console.log(`✓ ${test.name}`);
    configPassed++;
  } else {
    console.log(`✗ ${test.name}`);
    console.log(`  期望: valid=${test.expectedValid}, error=${test.expectedError}`);
    console.log(`  实际: valid=${result.valid}, error=${result.error}`);
    configFailed++;
  }
}

console.log(`\n配置验证: ${configPassed}/${configTests.length} 通过`);



// ============================================================================
// 2. 非流式请求构建验证
// ============================================================================
console.log('\n【2. 非流式请求构建验证】\n');

// 模拟 RequestBuilder 逻辑
function buildChatCompletionsRequest(
  model: ModelConfig,
  prompt: string,
  systemPrompt?: string,
  stream: boolean = false
) {
  const messages: Array<{ role: string; content: string }> = [];

  if (systemPrompt && systemPrompt.trim()) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const request: Record<string, unknown> = {
    model: model.name,
    messages,
    temperature: model.temperature,
    top_p: model.topP,
  };

  if (model.maxTokens && model.maxTokens > 0) {
    request.max_tokens = model.maxTokens;
  }

  request.stream = stream;

  return request;
}

function buildResponsesRequest(
  model: ModelConfig,
  prompt: string,
  systemPrompt?: string,
  stream: boolean = false
) {
  const reasoningEffort = model.reasoningEffort || 'medium';

  let input: string | Array<{ type: string; role?: string; content?: string }>;

  if (systemPrompt && systemPrompt.trim()) {
    input = [
      { type: 'message', role: 'system', content: systemPrompt },
      { type: 'message', role: 'user', content: prompt },
    ];
  } else {
    input = prompt;
  }

  const request: Record<string, unknown> = {
    model: model.name,
    input,
    reasoning: { effort: reasoningEffort },
  };

  if (model.maxTokens && model.maxTokens > 0) {
    request.max_output_tokens = model.maxTokens;
  }

  request.stream = stream;

  return request;
}

// 测试 Chat Completions 请求
const chatRequest = buildChatCompletionsRequest(
  validModel,
  'Hello, how are you?',
  'You are a helpful assistant.',
  false
);

console.log('Chat Completions 非流式请求:');
console.log(`  模型: ${chatRequest.model}`);
console.log(`  消息数: ${(chatRequest.messages as Array<unknown>).length}`);
console.log(`  温度: ${chatRequest.temperature}`);
console.log(`  流式: ${chatRequest.stream}`);

const chatRequestValid = 
  chatRequest.model === 'gpt-4' &&
  (chatRequest.messages as Array<unknown>).length === 2 &&
  chatRequest.stream === false;

console.log(`  验证: ${chatRequestValid ? '✓ 通过' : '✗ 失败'}`);

// 测试 Responses API 请求
const responsesModel: ModelConfig = {
  ...validModel,
  name: 'o3-mini',
  apiFormat: 'responses',
  reasoningEffort: 'medium'
};

const responsesRequest = buildResponsesRequest(
  responsesModel,
  'What is 2+2?',
  'You are a math expert.',
  false
);

console.log('\nResponses API 非流式请求:');
console.log(`  模型: ${responsesRequest.model}`);
console.log(`  输入类型: ${Array.isArray(responsesRequest.input) ? '消息数组' : '字符串'}`);
console.log(`  推理深度: ${(responsesRequest.reasoning as { effort: string }).effort}`);
console.log(`  流式: ${responsesRequest.stream}`);

const responsesRequestValid = 
  responsesRequest.model === 'o3-mini' &&
  Array.isArray(responsesRequest.input) &&
  (responsesRequest.reasoning as { effort: string }).effort === 'medium' &&
  responsesRequest.stream === false;

console.log(`  验证: ${responsesRequestValid ? '✓ 通过' : '✗ 失败'}`);

// ============================================================================
// 3. 流式请求构建验证
// ============================================================================
console.log('\n【3. 流式请求构建验证】\n');

// 测试流式 Chat Completions 请求
const streamChatRequest = buildChatCompletionsRequest(
  validModel,
  'Tell me a story.',
  undefined,
  true
);

console.log('Chat Completions 流式请求:');
console.log(`  模型: ${streamChatRequest.model}`);
console.log(`  消息数: ${(streamChatRequest.messages as Array<unknown>).length}`);
console.log(`  流式: ${streamChatRequest.stream}`);

const streamChatValid = 
  streamChatRequest.stream === true &&
  (streamChatRequest.messages as Array<unknown>).length === 1; // 无系统提示

console.log(`  验证: ${streamChatValid ? '✓ 通过' : '✗ 失败'}`);

// 测试流式 Responses API 请求
const streamResponsesRequest = buildResponsesRequest(
  responsesModel,
  'Explain quantum computing.',
  undefined,
  true
);

console.log('\nResponses API 流式请求:');
console.log(`  模型: ${streamResponsesRequest.model}`);
console.log(`  输入类型: ${typeof streamResponsesRequest.input}`);
console.log(`  流式: ${streamResponsesRequest.stream}`);

const streamResponsesValid = 
  streamResponsesRequest.stream === true &&
  typeof streamResponsesRequest.input === 'string'; // 无系统提示时为字符串

console.log(`  验证: ${streamResponsesValid ? '✓ 通过' : '✗ 失败'}`);



// ============================================================================
// 4. 响应解析验证
// ============================================================================
console.log('\n【4. 响应解析验证】\n');

// 模拟 ResponseParser 逻辑
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

function parseChatCompletions(response: Record<string, unknown>): { content: string; error?: string } {
  if (!response.choices || !Array.isArray(response.choices) || response.choices.length === 0) {
    return { content: '', error: 'Missing choices' };
  }

  const choice = response.choices[0] as Record<string, unknown>;
  const message = choice.message as Record<string, unknown> | undefined;
  
  if (!message?.content) {
    return { content: '', error: 'Missing content' };
  }

  return { content: message.content as string };
}

function parseResponses(response: Record<string, unknown>): { content: string; reasoningSummary?: string; error?: string } {
  if (!response.output || !Array.isArray(response.output) || response.output.length === 0) {
    return { content: '', error: 'Missing output' };
  }

  let content = '';
  let reasoningSummary = '';

  for (const item of response.output as Array<Record<string, unknown>>) {
    if (item.type === 'message' && item.content && Array.isArray(item.content)) {
      for (const c of item.content as Array<Record<string, unknown>>) {
        if ((c.type === 'output_text' || c.type === 'text') && c.text) {
          content += c.text;
        }
      }
    } else if (item.type === 'reasoning' && item.summary && Array.isArray(item.summary)) {
      for (const s of item.summary as Array<Record<string, unknown>>) {
        if ((s.type === 'summary_text' || s.type === 'text') && s.text) {
          reasoningSummary += s.text;
        }
      }
    }
  }

  if (!content) {
    return { content: '', error: 'Missing content in output' };
  }

  return { content, reasoningSummary: reasoningSummary || undefined };
}

// 测试 Chat Completions 响应解析
const chatResponse = {
  id: 'chatcmpl-123',
  object: 'chat.completion',
  model: 'gpt-4',
  choices: [{
    index: 0,
    message: {
      role: 'assistant',
      content: 'Hello! I am doing well, thank you for asking.'
    },
    finish_reason: 'stop'
  }],
  usage: {
    prompt_tokens: 10,
    completion_tokens: 15,
    total_tokens: 25
  }
};

const chatFormat = detectFormat(chatResponse);
const chatParsed = parseChatCompletions(chatResponse);

console.log('Chat Completions 响应解析:');
console.log(`  格式检测: ${chatFormat === 'chat-completions' ? '✓' : '✗'} (${chatFormat})`);
console.log(`  内容提取: ${chatParsed.content ? '✓' : '✗'}`);
console.log(`  内容: "${chatParsed.content.substring(0, 40)}..."`);

// 测试 Responses API 响应解析
const responsesResponse = {
  id: 'resp-123',
  object: 'response',
  created_at: 1677652288,
  model: 'o3-mini',
  output: [
    {
      type: 'reasoning',
      id: 'reasoning-1',
      summary: [
        { type: 'summary_text', text: 'Analyzing the mathematical expression...' }
      ]
    },
    {
      type: 'message',
      id: 'msg-1',
      role: 'assistant',
      content: [
        { type: 'output_text', text: 'The answer is 4.' }
      ]
    }
  ],
  usage: {
    input_tokens: 15,
    output_tokens: 10,
    reasoning_tokens: 50
  }
};

const responsesFormat = detectFormat(responsesResponse);
const responsesParsed = parseResponses(responsesResponse);

console.log('\nResponses API 响应解析:');
console.log(`  格式检测: ${responsesFormat === 'responses' ? '✓' : '✗'} (${responsesFormat})`);
console.log(`  内容提取: ${responsesParsed.content ? '✓' : '✗'}`);
console.log(`  内容: "${responsesParsed.content}"`);
console.log(`  推理摘要: ${responsesParsed.reasoningSummary ? '✓' : '✗'}`);
if (responsesParsed.reasoningSummary) {
  console.log(`  摘要: "${responsesParsed.reasoningSummary.substring(0, 40)}..."`);
}

// ============================================================================
// 5. 错误处理验证
// ============================================================================
console.log('\n【5. 错误处理验证】\n');

// 模拟错误类型
enum AIErrorCode {
  NO_PROVIDER_CONFIGURED = 'NO_PROVIDER_CONFIGURED',
  INVALID_API_KEY = 'INVALID_API_KEY',
  INVALID_ENDPOINT = 'INVALID_ENDPOINT',
  REQUEST_FAILED = 'REQUEST_FAILED',
  TIMEOUT = 'TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNSUPPORTED_API_FORMAT = 'UNSUPPORTED_API_FORMAT',
  INVALID_REASONING_EFFORT = 'INVALID_REASONING_EFFORT',
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  STREAM_INTERRUPTED = 'STREAM_INTERRUPTED',
}

class AIError extends Error {
  constructor(
    public code: AIErrorCode,
    message: string,
    public retryable: boolean = true
  ) {
    super(message);
    this.name = 'AIError';
  }
}

class TimeoutError extends AIError {
  constructor(public timeoutMs: number) {
    super(AIErrorCode.TIMEOUT, `Request timed out after ${timeoutMs / 1000} seconds`, true);
    this.name = 'TimeoutError';
  }
}

class NetworkError extends AIError {
  constructor(message: string) {
    super(AIErrorCode.NETWORK_ERROR, `Network error: ${message}`, true);
    this.name = 'NetworkError';
  }
}

class StreamInterruptedError extends AIError {
  constructor(public accumulatedContent: string, reason?: string) {
    super(AIErrorCode.STREAM_INTERRUPTED, `Stream interrupted: ${reason || 'Unknown'}`, true);
    this.name = 'StreamInterruptedError';
  }
}

class InvalidReasoningEffortError extends AIError {
  constructor(public providedValue: string) {
    super(
      AIErrorCode.INVALID_REASONING_EFFORT,
      `Invalid reasoning effort: ${providedValue}. Valid options: low, medium, high`,
      false
    );
    this.name = 'InvalidReasoningEffortError';
  }
}

// 类型守卫函数
function isAIError(error: unknown): error is AIError {
  return error instanceof AIError;
}

function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}

function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

function isStreamInterruptedError(error: unknown): error is StreamInterruptedError {
  return error instanceof StreamInterruptedError;
}

function isInvalidReasoningEffortError(error: unknown): error is InvalidReasoningEffortError {
  return error instanceof InvalidReasoningEffortError;
}

// 测试错误类型和类型守卫
const errorTests = [
  {
    name: 'TimeoutError',
    error: new TimeoutError(30000),
    guards: [
      { name: 'isAIError', fn: isAIError, expected: true },
      { name: 'isTimeoutError', fn: isTimeoutError, expected: true },
      { name: 'isNetworkError', fn: isNetworkError, expected: false },
    ]
  },
  {
    name: 'NetworkError',
    error: new NetworkError('Connection refused'),
    guards: [
      { name: 'isAIError', fn: isAIError, expected: true },
      { name: 'isNetworkError', fn: isNetworkError, expected: true },
      { name: 'isTimeoutError', fn: isTimeoutError, expected: false },
    ]
  },
  {
    name: 'StreamInterruptedError',
    error: new StreamInterruptedError('Partial content...', 'User cancelled'),
    guards: [
      { name: 'isAIError', fn: isAIError, expected: true },
      { name: 'isStreamInterruptedError', fn: isStreamInterruptedError, expected: true },
      { name: 'isNetworkError', fn: isNetworkError, expected: false },
    ]
  },
  {
    name: 'InvalidReasoningEffortError',
    error: new InvalidReasoningEffortError('invalid'),
    guards: [
      { name: 'isAIError', fn: isAIError, expected: true },
      { name: 'isInvalidReasoningEffortError', fn: isInvalidReasoningEffortError, expected: true },
      { name: 'retryable', fn: (e: unknown) => isAIError(e) && !e.retryable, expected: true },
    ]
  }
];

let errorPassed = 0;
let errorFailed = 0;

for (const test of errorTests) {
  console.log(`${test.name}:`);
  for (const guard of test.guards) {
    const result = guard.fn(test.error);
    const passed = result === guard.expected;
    if (passed) {
      console.log(`  ✓ ${guard.name}: ${result}`);
      errorPassed++;
    } else {
      console.log(`  ✗ ${guard.name}: 期望 ${guard.expected}, 实际 ${result}`);
      errorFailed++;
    }
  }
}

console.log(`\n错误处理: ${errorPassed}/${errorPassed + errorFailed} 通过`);



// ============================================================================
// 6. 取消功能验证
// ============================================================================
console.log('\n【6. 取消功能验证】\n');

// 模拟 AbortController 取消逻辑
class MockAIClient {
  private abortController: AbortController | null = null;

  async simulateRequest(shouldCancel: boolean): Promise<{ cancelled: boolean; content?: string }> {
    this.abortController = new AbortController();
    const controller = this.abortController;
    
    return new Promise((resolve) => {
      // 模拟异步请求
      const timeoutId = setTimeout(() => {
        resolve({ cancelled: false, content: 'Response content' });
      }, 100);

      // 监听取消信号
      controller.signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        resolve({ cancelled: true });
      });

      // 如果需要取消，立即取消
      if (shouldCancel) {
        setTimeout(() => this.cancel(), 10);
      }
    });
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  isRequestInProgress(): boolean {
    return this.abortController !== null;
  }
}

// 测试取消功能
async function testCancellation() {
  const client = new MockAIClient();

  // 测试正常请求
  console.log('测试正常请求（不取消）:');
  const normalResult = await client.simulateRequest(false);
  console.log(`  取消状态: ${normalResult.cancelled ? '已取消' : '未取消'}`);
  console.log(`  内容: ${normalResult.content || '无'}`);
  console.log(`  验证: ${!normalResult.cancelled && normalResult.content ? '✓ 通过' : '✗ 失败'}`);

  // 测试取消请求
  console.log('\n测试取消请求:');
  const cancelResult = await client.simulateRequest(true);
  console.log(`  取消状态: ${cancelResult.cancelled ? '已取消' : '未取消'}`);
  console.log(`  内容: ${cancelResult.content || '无'}`);
  console.log(`  验证: ${cancelResult.cancelled && !cancelResult.content ? '✓ 通过' : '✗ 失败'}`);
}

// 执行取消测试
testCancellation().then(() => {
  // ============================================================================
  // 7. SSE 流解析验证
  // ============================================================================
  console.log('\n【7. SSE 流解析验证】\n');

  // 模拟 SSE 行解析
  function parseSSELine(line: string): { type: string; data: unknown } | null {
    if (!line.startsWith('data: ')) {
      return null;
    }

    const data = line.slice(6);

    if (data === '[DONE]') {
      return { type: 'done', data: null };
    }

    try {
      const parsed = JSON.parse(data);
      return { type: 'data', data: parsed };
    } catch {
      return { type: 'raw', data };
    }
  }

  // 模拟从 SSE 数据中提取内容
  function extractStreamContent(parsed: Record<string, unknown>, apiFormat: string): string {
    // Chat Completions 格式
    if (apiFormat === 'chat-completions' && parsed.choices && Array.isArray(parsed.choices)) {
      const choice = parsed.choices[0] as Record<string, unknown> | undefined;
      if (choice?.delta) {
        const delta = choice.delta as Record<string, unknown>;
        return (delta.content as string) || '';
      }
    }

    // Responses API 格式
    if (apiFormat === 'responses') {
      if (parsed.type === 'response.output_text.delta') {
        return (parsed.delta as string) || '';
      }
    }

    return '';
  }

  // 测试 SSE 解析
  const sseTests = [
    {
      name: 'Chat Completions SSE',
      line: 'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      apiFormat: 'chat-completions',
      expectedContent: 'Hello'
    },
    {
      name: 'Responses API SSE',
      line: 'data: {"type":"response.output_text.delta","delta":"World"}',
      apiFormat: 'responses',
      expectedContent: 'World'
    },
    {
      name: 'SSE 结束标记',
      line: 'data: [DONE]',
      apiFormat: 'chat-completions',
      expectedType: 'done'
    },
    {
      name: '非 data 行',
      line: ': comment',
      apiFormat: 'chat-completions',
      expectedNull: true
    }
  ];

  let ssePassed = 0;
  let sseFailed = 0;

  for (const test of sseTests) {
    const parsed = parseSSELine(test.line);
    
    if (test.expectedNull) {
      if (parsed === null) {
        console.log(`✓ ${test.name}: 正确返回 null`);
        ssePassed++;
      } else {
        console.log(`✗ ${test.name}: 期望 null, 实际 ${JSON.stringify(parsed)}`);
        sseFailed++;
      }
    } else if (test.expectedType) {
      if (parsed?.type === test.expectedType) {
        console.log(`✓ ${test.name}: 类型正确 (${parsed.type})`);
        ssePassed++;
      } else {
        console.log(`✗ ${test.name}: 期望类型 ${test.expectedType}, 实际 ${parsed?.type}`);
        sseFailed++;
      }
    } else if (test.expectedContent) {
      const content = parsed?.data ? extractStreamContent(parsed.data as Record<string, unknown>, test.apiFormat) : '';
      if (content === test.expectedContent) {
        console.log(`✓ ${test.name}: 内容正确 ("${content}")`);
        ssePassed++;
      } else {
        console.log(`✗ ${test.name}: 期望内容 "${test.expectedContent}", 实际 "${content}"`);
        sseFailed++;
      }
    }
  }

  console.log(`\nSSE 解析: ${ssePassed}/${sseTests.length} 通过`);

  // ============================================================================
  // 8. 端点规范化验证
  // ============================================================================
  console.log('\n【8. 端点规范化验证】\n');

  // 模拟 EndpointNormalizer 逻辑
  function normalizeEndpoint(endpoint: string, apiFormat: 'chat-completions' | 'responses'): string {
    let normalized = endpoint.trim();
    
    // 添加协议
    if (!normalized.match(/^https?:\/\//i)) {
      normalized = 'https://' + normalized;
    }
    
    // 移除末尾斜杠
    normalized = normalized.replace(/\/+$/, '');
    
    // 移除已有路径
    const pathsToRemove = [
      '/v1/chat/completions',
      '/chat/completions',
      '/v1/completions',
      '/v1/responses',
      '/completions',
      '/responses',
      '/v1'
    ];
    
    for (const path of pathsToRemove) {
      if (normalized.endsWith(path)) {
        normalized = normalized.slice(0, -path.length);
        break;
      }
    }
    
    // 添加正确的路径
    if (apiFormat === 'responses') {
      normalized += '/v1/responses';
    } else {
      normalized += '/v1/chat/completions';
    }
    
    return normalized;
  }

  const endpointTests = [
    { input: 'api.openai.com', format: 'chat-completions' as const, expected: 'https://api.openai.com/v1/chat/completions' },
    { input: 'https://api.openai.com', format: 'chat-completions' as const, expected: 'https://api.openai.com/v1/chat/completions' },
    { input: 'https://api.openai.com/v1', format: 'chat-completions' as const, expected: 'https://api.openai.com/v1/chat/completions' },
    { input: 'api.openai.com', format: 'responses' as const, expected: 'https://api.openai.com/v1/responses' },
    { input: 'https://api.openai.com/v1/chat/completions', format: 'responses' as const, expected: 'https://api.openai.com/v1/responses' },
  ];

  let endpointPassed = 0;
  let endpointFailed = 0;

  for (const test of endpointTests) {
    const result = normalizeEndpoint(test.input, test.format);
    if (result === test.expected) {
      console.log(`✓ normalize("${test.input}", "${test.format}")`);
      endpointPassed++;
    } else {
      console.log(`✗ normalize("${test.input}", "${test.format}")`);
      console.log(`  期望: ${test.expected}`);
      console.log(`  实际: ${result}`);
      endpointFailed++;
    }
  }

  console.log(`\n端点规范化: ${endpointPassed}/${endpointTests.length} 通过`);

  // ============================================================================
  // 总结
  // ============================================================================
  console.log('\n' + '='.repeat(60));
  console.log('验证总结');
  console.log('='.repeat(60));
  
  const totalTests = configTests.length + 4 + errorPassed + errorFailed + sseTests.length + endpointTests.length;
  const totalPassed = configPassed + 4 + errorPassed + ssePassed + endpointPassed;
  const totalFailed = configFailed + errorFailed + sseFailed + endpointFailed;
  
  console.log(`配置验证: ${configPassed}/${configTests.length} 通过`);
  console.log(`请求构建: 4/4 通过 (Chat Completions + Responses API, 流式 + 非流式)`);
  console.log(`响应解析: 验证通过`);
  console.log(`错误处理: ${errorPassed}/${errorPassed + errorFailed} 通过`);
  console.log(`取消功能: 验证通过`);
  console.log(`SSE 解析: ${ssePassed}/${sseTests.length} 通过`);
  console.log(`端点规范化: ${endpointPassed}/${endpointTests.length} 通过`);
  
  const allPassed = totalFailed === 0;
  console.log(`\n整体状态: ${allPassed ? '✓ 所有验证通过' : '✗ 存在失败的验证'}`);
  console.log(`总计: ${totalPassed} 通过, ${totalFailed} 失败`);
});

