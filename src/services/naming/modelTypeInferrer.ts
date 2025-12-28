/**
 * 推断模型的类型和能力 + UI 标签渲染
 */

import { ModelType, ModelAbility } from '../../settings/settings';
import { setIcon } from 'obsidian';
import { t } from '../../i18n';

/**
 * 类型关键词配置接口
 */
interface TypeKeywords {
  type: ModelType;
  keywords: readonly string[];
}

/**
 * 标签配置接口
 */
interface TagConfig {
  icon: string;
  colorClass: string;
}

/**
 * 类型关键词匹配配置
 * 按优先级排序：image > embedding > tts > asr > chat(default)
 */
const TYPE_KEYWORDS: TypeKeywords[] = [
  {
    type: 'image',
    keywords: [
      'dall-e', 'dalle', 'midjourney', 'stable-diffusion', 'sd-', 'sdxl', 'flux', 
      'imagen', 'image-gen', 'cogview', 'wanxiang', 'seedream', 'seedance',
      'playground', 'ideogram', 'recraft', 'kolors',
      '!gemini', '!gpt', '!claude'  // 排除多模态聊天模型
    ]
  },
  {
    type: 'embedding',
    keywords: ['embedding', 'embed', 'bge', 'm3e', 'e5-', 'text-embedding', 'gte-']
  },
  {
    type: 'tts',
    keywords: ['tts', 'voice-gen', 'audio-out', 'text-to-speech', 'elevenlabs', 'cosyvoice', 'fish-speech']
  },
  {
    type: 'asr',
    keywords: ['whisper', 'asr', 'stt', 'speech-to-text', 'audio-in', 'transcribe', 'sensevoice']
  }
];

/**
 * 模型提供商检测配置
 * 用于检测模型属于哪个提供商，以便应用对应的能力规则
 * 
 * 匹配规则：按顺序检测，更具体的关键词应放在前面
 */
const MODEL_PROVIDER_DETECTION: Record<string, readonly string[]> = {
  openai: ['gpt-', 'gpt5', 'gpt4', 'o1', 'o3', 'o4', 'chatgpt'],
  anthropic: ['claude'],
  google: ['gemini', 'gemma', 'learnlm'],
  xai: ['grok'],
  deepseek: ['deepseek'],
  qwen: ['qwen', 'qwq', 'qvq'],
  zhipu: ['glm', 'chatglm'],
  minimax: ['minimax', 'abab'],
  moonshot: ['moonshot', 'kimi'],
  baichuan: ['baichuan'],
  yi: ['yi-'],
  doubao: ['doubao', 'seed-'],
  spark: ['spark'],
  ernie: ['ernie'],
  hunyuan: ['hunyuan'],
  mistral: ['mistral', 'mixtral', 'pixtral'],
  llama: ['llama', 'llava'],
  cohere: ['command'],
  pangu: ['pangu'],
  stepfun: ['step-', 'step1', 'step2', 'step3'],
  internlm: ['internlm'],
  kat: ['kat-'],
  ling: ['ling-', 'ring-'],
};

/**
 * 按提供商分组的能力关键词配置 (2025 年 12 月更新)
 * 
 * 关键词规则：
 * - 普通关键词：包含匹配
 * - ! 前缀：排除匹配（优先级最高）
 * - ^ 前缀：只在开头匹配
 */
const PROVIDER_ABILITY_CONFIG: Record<string, {
  vision?: readonly string[];
  reasoning?: readonly string[];
  functionCall?: readonly string[];
  webSearch?: readonly string[];
}> = {
  openai: {
    // GPT-5 系列全部支持视觉，GPT-4o/4-turbo/4-vision 支持视觉
    vision: ['gpt-5', 'gpt5', '4o', 'gpt-4-turbo', 'gpt-4-vision', 'computer-use', '!audio', '!realtime', '!codex', '!nano'],
    // o1/o3/o4 系列、GPT-5 系列、deep-research 支持推理
    reasoning: ['o1', 'o3', 'o4', 'gpt-5', 'gpt5', 'deep-research'],
    // GPT 系列、o3/o4 支持 Function Call（排除 o1、codex）
    functionCall: ['gpt-4', 'gpt-3.5-turbo', 'gpt-5', 'gpt5', 'o3', 'o4', '!o1', '!codex', '!deep-research'],
    // search 后缀、deep-research 支持联网
    webSearch: ['search', 'deep-research'],
  },
  anthropic: {
    // Claude 3/3.5/4/4.5 全系列支持视觉
    vision: ['claude-3', 'claude-4', 'claude3', 'claude4', '!instant'],
    // Claude 3.5 Sonnet、3 Opus、4 全系列支持推理
    reasoning: ['claude-3.5-sonnet', 'claude-3-opus', 'claude-4', 'claude4', 'opus-4', 'sonnet-4', 'haiku-4'],
    // Claude 3/4 全系列支持 Function Call
    functionCall: ['claude-3', 'claude-4', 'claude3', 'claude4', 'claude-2.1'],
    // Claude 暂不支持联网搜索
    webSearch: [],
  },
  google: {
    // Gemini 全系列支持视觉（排除 embedding 和 gemma）
    vision: ['gemini', 'learnlm', '!embedding', '!text-embedding', '!gemma'],
    // Gemini 2.5/3 支持推理
    reasoning: ['gemini-3', 'gemini-2.5', 'gemini3', 'gemini2.5', '!flash-lite', '!image'],
    // Gemini 全系列支持 Function Call
    functionCall: ['gemini', 'learnlm', '!embedding', '!text-embedding', '!image', '!gemma'],
    // Gemini 2.5/3 支持联网搜索
    webSearch: ['gemini-2.5', 'gemini-3', 'gemini2.5', 'gemini3', '!embedding', '!image'],
  },
  deepseek: {
    // DeepSeek VL、Janus、OCR 支持视觉
    vision: ['deepseek-vl', 'janus', 'ocr'],
    // DeepSeek V3/V3.1/V3.2、R1、Reasoner 支持推理
    reasoning: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-r1', 'r1-', 'deepseek-v3', 'v3.1', 'v3.2'],
    // DeepSeek Chat/Reasoner/Coder/V3 支持工具调用
    functionCall: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v3', 'deepseek-v2', 'deepseek-coder', 'r1'],
    // DeepSeek 暂不支持联网搜索
    webSearch: [],
  },
  qwen: {
    // Qwen VL 系列、QVQ、Omni 支持视觉
    vision: ['-vl', 'qvq', '-omni', 'vl-'],
    // QwQ、QVQ、Thinking 后缀支持推理
    reasoning: ['qwq', 'qvq', 'thinking', 'qwen3-next'],
    // Qwen 主要系列支持 Function Call
    functionCall: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen2', 'qwen3', 'qwen-long'],
    // Qwen 暂不支持联网搜索
    webSearch: [],
  },
  zhipu: {
    // GLM-4V 系列、CogVLM 支持视觉
    vision: ['glm-4v', 'glm-4.5v', 'glm-4.6v', 'glm-4.7v', '-4v', 'cogvlm'],
    // GLM-4.5/4.6/4.7、GLM-Zero 支持推理
    reasoning: ['glm-zero', 'glm-z1', 'glm-4.5', 'glm-4.6', 'glm-4.7', 'glm-4-plus'],
    // GLM-4 全系列支持 Function Call
    functionCall: ['glm-4', 'glm-3-turbo'],
    // web-search、alltools 后缀支持联网
    webSearch: ['web-search', 'alltools'],
  },
  minimax: {
    // abab6.5s、abab7 支持视觉
    vision: ['abab6.5s', 'abab7'],
    // MiniMax M2 系列支持推理
    reasoning: ['minimax-m2', '-m2', 'm2.1'],
    // abab6/7、M2 系列支持 Function Call
    functionCall: ['abab6', 'abab7', 'minimax-m2', '-m2'],
    // MiniMax 暂不支持联网搜索
    webSearch: [],
  },
  moonshot: {
    // Kimi Vision 支持视觉
    vision: ['moonshot-v1-vision', 'kimi-vision', 'kimi-vl'],
    // Kimi K2 Thinking 支持推理
    reasoning: ['kimi-thinking', 'kimi-k1', 'kimi-k2', 'k2-thinking'],
    // Moonshot/Kimi 全系列支持 Function Call
    functionCall: ['moonshot-v1', 'kimi'],
    // Kimi 支持联网搜索
    webSearch: ['kimi', 'moonshot'],
  },
  doubao: {
    // Doubao Vision 系列支持视觉
    vision: ['doubao-vision', 'doubao-1.5-vision', 'doubao-1.8-vision'],
    // Doubao 1.5/1.8 Thinking 支持推理
    reasoning: ['doubao-1.5-thinking', 'doubao-1.8-thinking', 'seed-code'],
    // Doubao Pro/Lite/1.5/1.8 支持 Function Call
    functionCall: ['doubao-pro', 'doubao-lite', 'doubao-1.5', 'doubao-1.8', 'seed-code'],
    // Doubao 暂不支持联网搜索
    webSearch: [],
  },
  mistral: {
    // Pixtral 支持视觉
    vision: ['pixtral'],
    // Mistral Large 3 支持推理
    reasoning: ['mistral-large-3', 'large-3'],
    // Mistral Large/Medium、Mixtral 支持 Function Call
    functionCall: ['mistral-large', 'mistral-medium', 'mistral-small', 'mixtral'],
    // Mistral 暂不支持联网搜索
    webSearch: [],
  },
  llama: {
    // LLaVA、Llama 3.2 Vision、Llama 4 全系列支持视觉（多模态原生支持）
    vision: ['llava', 'llama-3.2-vision', 'llama-4', 'llama4', 'scout', 'maverick', 'behemoth'],
    // Llama 4 全系列支持推理（MoE 架构增强）
    reasoning: ['llama-4', 'llama4', 'scout', 'maverick', 'behemoth'],
    // Llama 3.1/3.2/3.3/4 支持 Function Call
    functionCall: ['llama-3.1', 'llama-3.2', 'llama-3.3', 'llama-4', 'llama4', 'scout', 'maverick', 'behemoth'],
    // Llama 暂不支持联网搜索
    webSearch: [],
  },
  xai: {
    // Grok 2 Vision、Grok 4 支持视觉
    vision: ['grok-2-vision', 'grok-vision', 'grok-4', 'grok4'],
    // Grok 3/4 支持推理
    reasoning: ['grok-3', 'grok-4', 'grok3', 'grok4'],
    // Grok 2/3/4 支持工具调用
    functionCall: ['grok-2', 'grok-3', 'grok-4', 'grok2', 'grok3', 'grok4'],
    // Grok 3/4 支持联网搜索
    webSearch: ['grok-3', 'grok-4', 'grok3', 'grok4'],
  },
  pangu: {
    // Pangu 暂不支持视觉
    vision: [],
    // Pangu Pro MoE 支持推理
    reasoning: ['pangu-pro-moe'],
    // Pangu Pro 支持 Function Call
    functionCall: ['pangu-pro'],
    // Pangu 暂不支持联网搜索
    webSearch: [],
  },
  stepfun: {
    // Step-3 支持视觉
    vision: ['step-3', 'step3'],
    // Step-3 支持推理
    reasoning: ['step-3', 'step3'],
    // Step 系列支持 Function Call
    functionCall: ['step-3', 'step-2', 'step3', 'step2'],
    // Step 暂不支持联网搜索
    webSearch: [],
  },
  internlm: {
    // InternLM 暂不支持视觉
    vision: [],
    // InternLM 暂不支持推理
    reasoning: [],
    // InternLM 2.5 支持 Function Call
    functionCall: ['internlm2.5', 'internlm2_5'],
    // InternLM 暂不支持联网搜索
    webSearch: [],
  },
  kat: {
    // KAT-Dev 暂不支持视觉
    vision: [],
    // KAT-Dev 支持推理
    reasoning: ['kat-dev'],
    // KAT-Dev 支持 Function Call
    functionCall: ['kat-dev'],
    // KAT 暂不支持联网搜索
    webSearch: [],
  },
  ling: {
    // Ling 暂不支持视觉
    vision: [],
    // Ling 暂不支持推理
    reasoning: [],
    // Ling 支持 Function Call
    functionCall: ['ling-flash', 'ring-flash'],
    // Ling 暂不支持联网搜索
    webSearch: [],
  },
  // 默认配置，用于未知提供商
  default: {
    vision: ['vision', '-vl', 'vl-', '-omni', 'ocr'],
    reasoning: ['thinking', 'reasoner', 'reason'],
    functionCall: [],  // 未知提供商不默认推断 functionCall
    webSearch: ['search', 'web'],
  },
};


/**
 * 类型配置映射
 */
const TYPE_CONFIG: Record<ModelType, TagConfig> = {
  chat: { icon: 'messages-square', colorClass: 'type-chat' },
  image: { icon: 'image', colorClass: 'type-image' },
  embedding: { icon: 'database', colorClass: 'type-embedding' },
  tts: { icon: 'audio-lines', colorClass: 'type-tts' },
  asr: { icon: 'mic', colorClass: 'type-asr' }
};

/**
 * 能力配置映射
 */
const ABILITY_CONFIG: Record<ModelAbility, TagConfig> = {
  vision: { icon: 'eye', colorClass: 'ability-vision' },
  functionCall: { icon: 'function-square', colorClass: 'ability-function' },
  reasoning: { icon: 'brain', colorClass: 'ability-reasoning' },
  webSearch: { icon: 'globe', colorClass: 'ability-web' },
  files: { icon: 'file', colorClass: 'ability-files' }
};

/**
 * 检查模型 ID 是否匹配关键词列表（支持排除规则和前缀匹配）
 * 
 * 关键词规则：
 * - 普通关键词：包含匹配
 * - ! 前缀：排除匹配（优先级最高，匹配则返回 false）
 * - ^ 前缀：只在开头匹配
 * 
 * @param modelId 模型 ID（会自动转小写）
 * @param keywords 关键词列表
 * @returns 是否匹配
 */
function matchesKeywords(modelId: string, keywords: readonly string[]): boolean {
  const lowerModelId = modelId.toLowerCase();
  
  // 分离排除规则和包含规则
  const excludeKeywords = keywords.filter(k => k.startsWith('!'));
  const includeKeywords = keywords.filter(k => !k.startsWith('!'));
  
  // 先检查排除规则（优先级最高）
  for (const keyword of excludeKeywords) {
    const kw = keyword.slice(1).toLowerCase(); // 移除 ! 前缀
    const isMatch = kw.startsWith('^')
      ? lowerModelId.startsWith(kw.slice(1))
      : lowerModelId.includes(kw);
    if (isMatch) {
      return false;
    }
  }
  
  // 检查包含规则
  return includeKeywords.some(keyword => {
    const kw = keyword.toLowerCase();
    if (kw.startsWith('^')) {
      // ^ 前缀：只在开头匹配
      return lowerModelId.startsWith(kw.slice(1));
    }
    // 默认：包含匹配
    return lowerModelId.includes(kw);
  });
}

/**
 * 检测模型所属的提供商
 * @param modelId 模型 ID
 * @returns 提供商名称，未知则返回 'default'
 */
function detectModelProvider(modelId: string): string {
  const lowerModelId = modelId.toLowerCase();
  
  for (const [provider, keywords] of Object.entries(MODEL_PROVIDER_DETECTION)) {
    if (keywords.some(kw => lowerModelId.includes(kw.toLowerCase()))) {
      return provider;
    }
  }
  
  return 'default';
}

/**
 * 推断模型类型
 * @param modelId 模型 ID
 * @param explicitType 显式配置的类型（优先使用）
 * @returns 推断的模型类型
 */
export function inferModelType(
  modelId: string,
  explicitType?: ModelType
): ModelType {
  if (explicitType) {
    return explicitType;
  }

  for (const { type, keywords } of TYPE_KEYWORDS) {
    if (matchesKeywords(modelId, keywords)) {
      return type;
    }
  }

  return 'chat';
}

/**
 * 推断模型能力（仅对 chat 类型有意义）
 * 使用按提供商分组的配置，更精确地匹配能力
 * 
 * @param modelId 模型 ID
 * @param modelType 模型类型
 * @param explicitAbilities 显式配置的能力列表
 * @returns 推断的能力列表
 */
export function inferModelAbilities(
  modelId: string,
  modelType: ModelType,
  explicitAbilities?: ModelAbility[]
): ModelAbility[] {
  if (explicitAbilities && explicitAbilities.length > 0) {
    return explicitAbilities;
  }

  // 非 chat 类型不推断能力
  if (modelType !== 'chat') {
    return [];
  }

  // 检测提供商并获取对应配置
  const provider = detectModelProvider(modelId);
  const config = PROVIDER_ABILITY_CONFIG[provider] || PROVIDER_ABILITY_CONFIG.default;
  
  const abilities: ModelAbility[] = [];
  
  // 检查 vision 能力
  if (config.vision && config.vision.length > 0 && matchesKeywords(modelId, config.vision)) {
    abilities.push('vision');
  }
  
  // 检查 reasoning 能力
  if (config.reasoning && config.reasoning.length > 0 && matchesKeywords(modelId, config.reasoning)) {
    abilities.push('reasoning');
  }
  
  // 检查 functionCall 能力
  if (config.functionCall && config.functionCall.length > 0 && matchesKeywords(modelId, config.functionCall)) {
    abilities.push('functionCall');
  }
  
  // 检查 webSearch 能力
  if (config.webSearch && config.webSearch.length > 0 && matchesKeywords(modelId, config.webSearch)) {
    abilities.push('webSearch');
  }

  return abilities;
}

/**
 * 推断模型的完整信息（类型 + 能力）
 * @param modelId 模型 ID
 * @param explicitType 显式配置的类型
 * @param explicitAbilities 显式配置的能力列表
 * @returns 类型和能力信息
 */
export function inferModelInfo(
  modelId: string,
  explicitType?: ModelType,
  explicitAbilities?: ModelAbility[]
): { type: ModelType; abilities: ModelAbility[] } {
  const type = inferModelType(modelId, explicitType);
  const abilities = inferModelAbilities(modelId, type, explicitAbilities);
  return { type, abilities };
}

// 导出配置供测试使用
export { TYPE_KEYWORDS, PROVIDER_ABILITY_CONFIG, MODEL_PROVIDER_DETECTION, matchesKeywords, detectModelProvider };


/**
 * 标签选项接口
 */
interface TagOptions {
  showLabel?: boolean;
  size?: 'small' | 'normal';
}

/**
 * 创建类型标签
 * @param container 父容器元素
 * @param type 模型类型
 * @param options 配置选项
 * @returns 创建的标签元素
 */
export function createTypeTag(
  container: HTMLElement,
  type: ModelType,
  options: TagOptions = {}
): HTMLElement {
  const { showLabel = false, size = 'small' } = options;
  const config = TYPE_CONFIG[type];
  
  const tagEl = container.createSpan({ 
    cls: `model-tag model-type-tag ${config.colorClass} size-${size}` 
  });
  
  const iconEl = tagEl.createSpan({ cls: 'tag-icon' });
  setIcon(iconEl, config.icon);
  
  if (showLabel) {
    tagEl.createSpan({ 
      cls: 'tag-label',
      text: t(`modelTypes.${type}`)
    });
  }
  
  tagEl.setAttribute('aria-label', t(`modelTypes.${type}Desc`));
  
  return tagEl;
}

/**
 * 创建能力标签
 * @param container 父容器元素
 * @param ability 模型能力
 * @param options 配置选项
 * @returns 创建的标签元素
 */
export function createAbilityTag(
  container: HTMLElement,
  ability: ModelAbility,
  options: TagOptions = {}
): HTMLElement {
  const { showLabel = false, size = 'small' } = options;
  const config = ABILITY_CONFIG[ability];
  
  const tagEl = container.createSpan({ 
    cls: `model-tag model-ability-tag ${config.colorClass} size-${size}` 
  });
  
  const iconEl = tagEl.createSpan({ cls: 'tag-icon' });
  setIcon(iconEl, config.icon);
  
  if (showLabel) {
    tagEl.createSpan({ 
      cls: 'tag-label',
      text: t(`modelAbilities.${ability}`)
    });
  }
  
  tagEl.setAttribute('aria-label', t(`modelAbilities.${ability}Desc`));
  
  return tagEl;
}

/**
 * 创建模型标签组（显示类型标签和能力标签）
 * @param container 父容器元素
 * @param type 模型类型
 * @param abilities 模型能力列表
 * @returns 创建的标签组元素
 */
export function createModelTagGroup(
  container: HTMLElement,
  type: ModelType,
  abilities: ModelAbility[]
): HTMLElement {
  const groupEl = container.createSpan({ cls: 'model-tag-group' });
  
  // 先显示类型标签
  createTypeTag(groupEl, type);
  
  // 再显示能力标签（最多显示 4 个，避免过长）
  const displayAbilities = abilities.slice(0, 4);
  displayAbilities.forEach(ability => createAbilityTag(groupEl, ability));
  
  return groupEl;
}

// 导出配置供外部使用
export { TYPE_CONFIG, ABILITY_CONFIG };
