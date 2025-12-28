/**
 * 模型上下文长度推断模块
 * 根据模型 ID 推断其上下文窗口大小
 * 
 * 数据来源：2025 年 12 月最新官方文档
 * 
 * 匹配规则说明：
 * - 所有模式使用 /i 忽略大小写
 * - 使用 [_-]? 匹配可选的分隔符（支持 model-name、model_name、modelname）
 * - 使用 \.? 匹配可选的点号（支持 qwen2.5、qwen25）
 * - 模式按优先级排序，更具体的模式在前
 */

/**
 * 上下文长度配置接口
 */
interface ContextLengthConfig {
  pattern: RegExp;
  contextLength: number;
}

/**
 * 已知模型的上下文长度配置
 * 按优先级排序，更具体的模式应放在前面
 */
const CONTEXT_LENGTH_CONFIGS: ContextLengthConfig[] = [
  // ============================================================================
  // OpenAI 模型 (2025)
  // ============================================================================
  // GPT-5.2 系列 - 400K tokens
  { pattern: /gpt[_-]?5\.?2/i, contextLength: 400000 },
  // GPT-5.1 系列 - 1M tokens
  { pattern: /gpt[_-]?5\.?1/i, contextLength: 1000000 },
  // GPT-5 系列 - 400K tokens (272K input + 128K output)
  { pattern: /gpt[_-]?5[_-]?pro/i, contextLength: 400000 },
  { pattern: /gpt[_-]?5[_-]?mini/i, contextLength: 400000 },
  { pattern: /gpt[_-]?5[_-]?nano/i, contextLength: 400000 },
  { pattern: /gpt[_-]?5[_-]?chat/i, contextLength: 128000 },
  { pattern: /gpt[_-]?5/i, contextLength: 400000 },
  // GPT-4.1 系列 - 1M tokens
  { pattern: /gpt[_-]?4\.?1/i, contextLength: 1000000 },
  // GPT-4o 系列 - 128K tokens
  { pattern: /gpt[_-]?4o/i, contextLength: 128000 },
  { pattern: /gpt[_-]?4[_-]?turbo/i, contextLength: 128000 },
  { pattern: /gpt[_-]?4[_-]?32k/i, contextLength: 32768 },
  { pattern: /gpt[_-]?4/i, contextLength: 8192 },
  { pattern: /gpt[_-]?3\.?5[_-]?turbo[_-]?16k/i, contextLength: 16384 },
  { pattern: /gpt[_-]?3\.?5[_-]?turbo/i, contextLength: 16385 },
  // o 系列推理模型 - 200K tokens
  { pattern: /o1[_-]?preview/i, contextLength: 128000 },
  { pattern: /o1[_-]?mini/i, contextLength: 128000 },
  { pattern: /o1[_-]?pro/i, contextLength: 200000 },
  { pattern: /o1/i, contextLength: 200000 },
  { pattern: /o3[_-]?mini/i, contextLength: 200000 },
  { pattern: /o3/i, contextLength: 200000 },
  { pattern: /o4[_-]?mini/i, contextLength: 200000 },
  { pattern: /o4/i, contextLength: 200000 },

  // ============================================================================
  // Anthropic Claude 模型 (2025)
  // ============================================================================
  // Claude Opus 4.5 - 200K tokens
  { pattern: /claude[_-]?opus[_-]?4\.?5/i, contextLength: 200000 },
  // Claude Sonnet 4.5 - 200K (标准) / 1M (beta)
  { pattern: /claude[_-]?sonnet[_-]?4\.?5/i, contextLength: 200000 },
  // Claude Haiku 4.5 - 200K tokens
  { pattern: /claude[_-]?haiku[_-]?4\.?5/i, contextLength: 200000 },
  { pattern: /claude[_-]?4\.?5/i, contextLength: 200000 },
  // Claude Sonnet 4 - 1M tokens (API beta)
  { pattern: /claude[_-]?sonnet[_-]?4/i, contextLength: 1000000 },
  { pattern: /claude[_-]?opus[_-]?4/i, contextLength: 200000 },
  { pattern: /claude[_-]?haiku[_-]?4/i, contextLength: 200000 },
  { pattern: /claude[_-]?4/i, contextLength: 200000 },
  { pattern: /claude[_-]?3\.?7/i, contextLength: 200000 },
  { pattern: /claude[_-]?3\.?5[_-]?sonnet/i, contextLength: 200000 },
  { pattern: /claude[_-]?3\.?5[_-]?haiku/i, contextLength: 200000 },
  { pattern: /claude[_-]?3\.?5/i, contextLength: 200000 },
  { pattern: /claude[_-]?3[_-]?opus/i, contextLength: 200000 },
  { pattern: /claude[_-]?3[_-]?sonnet/i, contextLength: 200000 },
  { pattern: /claude[_-]?3[_-]?haiku/i, contextLength: 200000 },
  { pattern: /claude[_-]?3/i, contextLength: 200000 },
  { pattern: /claude[_-]?2\.?1/i, contextLength: 200000 },
  { pattern: /claude[_-]?2/i, contextLength: 100000 },
  { pattern: /claude/i, contextLength: 200000 },

  // ============================================================================
  // Google Gemini 模型 (2025)
  // ============================================================================
  // Gemini 3 系列
  { pattern: /gemini[_-]?3[_-]?pro/i, contextLength: 1048576 },
  { pattern: /gemini[_-]?3[_-]?deep[_-]?think/i, contextLength: 1048576 },
  { pattern: /gemini[_-]?3/i, contextLength: 1048576 },
  // Gemini 2.5 系列 - 1M tokens
  { pattern: /gemini[_-]?2\.?5[_-]?pro/i, contextLength: 1048576 },
  { pattern: /gemini[_-]?2\.?5[_-]?flash[_-]?lite/i, contextLength: 1048576 },
  { pattern: /gemini[_-]?2\.?5[_-]?flash/i, contextLength: 1048576 },
  { pattern: /gemini[_-]?2\.?5/i, contextLength: 1048576 },
  // Gemini 2.0 系列 - 1M tokens
  { pattern: /gemini[_-]?2\.?0[_-]?pro/i, contextLength: 1048576 },
  { pattern: /gemini[_-]?2\.?0[_-]?flash/i, contextLength: 1048576 },
  { pattern: /gemini[_-]?2/i, contextLength: 1048576 },
  // Gemini 1.5 系列
  { pattern: /gemini[_-]?1\.?5[_-]?pro/i, contextLength: 2097152 },
  { pattern: /gemini[_-]?1\.?5[_-]?flash/i, contextLength: 1048576 },
  { pattern: /gemini[_-]?1\.?5/i, contextLength: 1048576 },
  { pattern: /gemini[_-]?pro/i, contextLength: 32768 },
  { pattern: /gemini/i, contextLength: 1048576 },

  // ============================================================================
  // DeepSeek 模型 (2025)
  // ============================================================================
  // DeepSeek V3.1/V3.2 - 128K tokens
  { pattern: /deepseek[_-]?v3\.?[12]/i, contextLength: 128000 },
  { pattern: /deepseek[_-]?v3/i, contextLength: 128000 },
  { pattern: /deepseek[_-]?v2/i, contextLength: 128000 },
  { pattern: /deepseek[_-]?coder/i, contextLength: 128000 },
  { pattern: /deepseek[_-]?chat/i, contextLength: 128000 },
  { pattern: /deepseek[_-]?reasoner/i, contextLength: 128000 },
  { pattern: /deepseek[_-]?r1/i, contextLength: 128000 },
  { pattern: /deepseek/i, contextLength: 128000 },

  // ============================================================================
  // Qwen 模型 (2025)
  // ============================================================================
  // Qwen3-Next - 256K tokens
  { pattern: /qwen3[_-]?next/i, contextLength: 262144 },
  // Qwen3-Coder-Plus - 1M tokens
  { pattern: /qwen3[_-]?coder[_-]?plus/i, contextLength: 1000000 },
  { pattern: /qwen3[_-]?coder[_-]?480b/i, contextLength: 1000000 },
  { pattern: /qwen3[_-]?coder[_-]?30b/i, contextLength: 131072 },
  { pattern: /qwen3[_-]?coder/i, contextLength: 131072 },
  { pattern: /qwen3[_-]?omni/i, contextLength: 32768 },
  { pattern: /qwen3[_-]?vl/i, contextLength: 32768 },
  // Qwen3 基础 - 32K native, 128K with YaRN
  { pattern: /qwen3[_-]?235b/i, contextLength: 131072 },
  { pattern: /qwen3[_-]?32b/i, contextLength: 131072 },
  { pattern: /qwen3[_-]?30b/i, contextLength: 131072 },
  { pattern: /qwen3[_-]?14b/i, contextLength: 131072 },
  { pattern: /qwen3[_-]?8b/i, contextLength: 131072 },
  { pattern: /qwen3[_-]?max/i, contextLength: 131072 },
  { pattern: /qwen3/i, contextLength: 131072 },
  // QwQ 推理模型 - 131K tokens
  { pattern: /qwq/i, contextLength: 131072 },
  // QVQ 视觉推理模型 - 131K tokens
  { pattern: /qvq/i, contextLength: 131072 },
  // Qwen2.5 系列
  { pattern: /qwen2\.?5[_-]?turbo/i, contextLength: 1000000 },
  { pattern: /qwen2\.?5[_-]?1m/i, contextLength: 1000000 },
  { pattern: /qwen2\.?5[_-]?vl[_-]?72b/i, contextLength: 128000 },
  { pattern: /qwen2\.?5[_-]?vl[_-]?32b/i, contextLength: 128000 },
  { pattern: /qwen2\.?5[_-]?vl[_-]?7b/i, contextLength: 128000 },
  { pattern: /qwen2\.?5[_-]?vl/i, contextLength: 128000 },
  { pattern: /qwen2\.?5[_-]?72b/i, contextLength: 128000 },
  { pattern: /qwen2\.?5[_-]?32b/i, contextLength: 128000 },
  { pattern: /qwen2\.?5[_-]?14b/i, contextLength: 128000 },
  { pattern: /qwen2\.?5[_-]?7b/i, contextLength: 128000 },
  { pattern: /qwen2\.?5[_-]?coder/i, contextLength: 128000 },
  { pattern: /qwen2\.?5/i, contextLength: 128000 },
  { pattern: /qwen2[_-]?vl/i, contextLength: 128000 },
  { pattern: /qwen2/i, contextLength: 128000 },
  // Qwen 商业版
  { pattern: /qwen[_-]?long/i, contextLength: 10000000 },
  { pattern: /qwenlong/i, contextLength: 10000000 },
  { pattern: /qwen[_-]?plus/i, contextLength: 1000000 },
  { pattern: /qwen[_-]?turbo/i, contextLength: 1000000 },
  { pattern: /qwen[_-]?max[_-]?longcontext/i, contextLength: 28000 },
  { pattern: /qwen[_-]?max/i, contextLength: 32768 },
  // Qwen Image 系列
  { pattern: /qwen[_-]?image/i, contextLength: 32768 },
  { pattern: /qwen/i, contextLength: 32768 },

  // ============================================================================
  // 智谱 GLM 模型 (2025)
  // ============================================================================
  // GLM-4.7 最新
  { pattern: /glm[_-]?4\.?7/i, contextLength: 200000 },
  // GLM-4.6 系列 - 128K-200K tokens
  { pattern: /glm[_-]?4\.?6[_-]?v/i, contextLength: 128000 },
  { pattern: /glm[_-]?4\.?6/i, contextLength: 200000 },
  // GLM-4.5 系列 - 128K tokens
  { pattern: /glm[_-]?4\.?5[_-]?v/i, contextLength: 64000 },
  { pattern: /glm[_-]?4\.?5[_-]?air/i, contextLength: 128000 },
  { pattern: /glm[_-]?4\.?5/i, contextLength: 128000 },
  // GLM-4.1 系列
  { pattern: /glm[_-]?4\.?1[_-]?v/i, contextLength: 128000 },
  { pattern: /glm[_-]?4\.?1/i, contextLength: 128000 },
  { pattern: /glm[_-]?4[_-]?plus/i, contextLength: 128000 },
  { pattern: /glm[_-]?4[_-]?long/i, contextLength: 1000000 },
  { pattern: /glm[_-]?4[_-]?9b/i, contextLength: 128000 },
  { pattern: /glm[_-]?4[_-]?32b/i, contextLength: 128000 },
  { pattern: /glm[_-]?4/i, contextLength: 128000 },
  // GLM-Z1 推理系列
  { pattern: /glm[_-]?z1[_-]?rumination/i, contextLength: 128000 },
  { pattern: /glm[_-]?z1[_-]?32b/i, contextLength: 128000 },
  { pattern: /glm[_-]?z1[_-]?9b/i, contextLength: 128000 },
  { pattern: /glm[_-]?z1/i, contextLength: 128000 },
  { pattern: /glm[_-]?zero/i, contextLength: 128000 },
  { pattern: /glm[_-]?3[_-]?turbo/i, contextLength: 128000 },
  { pattern: /chatglm/i, contextLength: 32768 },

  // ============================================================================
  // Moonshot/Kimi 模型 (2025)
  // ============================================================================
  // Kimi K2 系列 - 256K tokens
  { pattern: /kimi[_-]?k2[_-]?thinking/i, contextLength: 262144 },
  { pattern: /kimi[_-]?k2[_-]?0905/i, contextLength: 262144 },
  { pattern: /kimi[_-]?k2/i, contextLength: 262144 },
  // Kimi-Dev-72B - 128K tokens
  { pattern: /kimi[_-]?dev[_-]?72b/i, contextLength: 128000 },
  { pattern: /kimi[_-]?dev/i, contextLength: 128000 },
  { pattern: /kimi[_-]?vl/i, contextLength: 128000 },
  { pattern: /kimi/i, contextLength: 128000 },
  { pattern: /moonshot[_-]?v1[_-]?128k/i, contextLength: 128000 },
  { pattern: /moonshot[_-]?v1[_-]?32k/i, contextLength: 32000 },
  { pattern: /moonshot[_-]?v1[_-]?8k/i, contextLength: 8000 },
  { pattern: /moonshot/i, contextLength: 128000 },

  // ============================================================================
  // Mistral 模型 (2025)
  // ============================================================================
  // Mistral Large 3 - 256K tokens
  { pattern: /mistral[_-]?large[_-]?3/i, contextLength: 256000 },
  { pattern: /mistral[_-]?large/i, contextLength: 128000 },
  // Mistral Medium 3.1 - 128K tokens
  { pattern: /mistral[_-]?medium[_-]?3/i, contextLength: 131072 },
  { pattern: /mistral[_-]?medium/i, contextLength: 128000 },
  // Mistral Small 3.2 - 128K tokens
  { pattern: /mistral[_-]?small[_-]?3/i, contextLength: 128000 },
  { pattern: /mistral[_-]?small/i, contextLength: 128000 },
  { pattern: /mixtral/i, contextLength: 32768 },
  { pattern: /mistral/i, contextLength: 128000 },
  { pattern: /pixtral/i, contextLength: 128000 },

  // ============================================================================
  // Meta Llama 模型 (2025)
  // ============================================================================
  // Llama 4 系列 - MoE 架构，原生多模态 (2025年4月发布)
  // Scout: 17B 活跃参数 (109B 总参数)，10M tokens 上下文
  { pattern: /llama[_-]?4[_-]?scout/i, contextLength: 10000000 },
  // Maverick: 17B 活跃参数 (400B 总参数)，1M tokens 上下文
  { pattern: /llama[_-]?4[_-]?maverick/i, contextLength: 1000000 },
  // Behemoth: 288B 活跃参数 (2T 总参数)，预计 1M+ tokens
  { pattern: /llama[_-]?4[_-]?behemoth/i, contextLength: 1000000 },
  // Llama 4 通用匹配
  { pattern: /llama[_-]?4/i, contextLength: 1000000 },
  // Llama 3 系列 - 128K tokens
  { pattern: /llama[_-]?3\.?3[_-]?70b/i, contextLength: 128000 },
  { pattern: /llama[_-]?3\.?3/i, contextLength: 128000 },
  { pattern: /llama[_-]?3\.?2[_-]?vision/i, contextLength: 128000 },
  { pattern: /llama[_-]?3\.?2[_-]?90b/i, contextLength: 128000 },
  { pattern: /llama[_-]?3\.?2[_-]?11b/i, contextLength: 128000 },
  { pattern: /llama[_-]?3\.?2[_-]?3b/i, contextLength: 128000 },
  { pattern: /llama[_-]?3\.?2[_-]?1b/i, contextLength: 128000 },
  { pattern: /llama[_-]?3\.?2/i, contextLength: 128000 },
  { pattern: /llama[_-]?3\.?1[_-]?405b/i, contextLength: 128000 },
  { pattern: /llama[_-]?3\.?1[_-]?70b/i, contextLength: 128000 },
  { pattern: /llama[_-]?3\.?1[_-]?8b/i, contextLength: 128000 },
  { pattern: /llama[_-]?3\.?1/i, contextLength: 128000 },
  { pattern: /llama[_-]?3[_-]?70b/i, contextLength: 8192 },
  { pattern: /llama[_-]?3[_-]?8b/i, contextLength: 8192 },
  { pattern: /llama[_-]?3/i, contextLength: 8192 },
  { pattern: /llama[_-]?2[_-]?70b/i, contextLength: 4096 },
  { pattern: /llama[_-]?2[_-]?13b/i, contextLength: 4096 },
  { pattern: /llama[_-]?2[_-]?7b/i, contextLength: 4096 },
  { pattern: /llama[_-]?2/i, contextLength: 4096 },
  { pattern: /llama/i, contextLength: 128000 },

  // ============================================================================
  // xAI Grok 模型 (2025)
  // ============================================================================
  // Grok 4 Fast - 2M tokens
  { pattern: /grok[_-]?4[_-]?fast/i, contextLength: 2000000 },
  // Grok 4 - 256K tokens
  { pattern: /grok[_-]?4/i, contextLength: 256000 },
  // Grok 3 - 131K tokens
  { pattern: /grok[_-]?3/i, contextLength: 131072 },
  { pattern: /grok[_-]?2/i, contextLength: 131072 },
  { pattern: /grok/i, contextLength: 131072 },

  // ============================================================================
  // 字节豆包 Doubao 模型 (2025)
  // ============================================================================
  // Doubao 1.8 - 256K tokens
  { pattern: /doubao[_-]?1\.?8/i, contextLength: 256000 },
  // Doubao 1.5 Pro - 256K tokens
  { pattern: /doubao[_-]?1\.?5[_-]?pro/i, contextLength: 256000 },
  { pattern: /doubao[_-]?1\.?5/i, contextLength: 256000 },
  // Doubao-Seed-Code - 256K tokens
  { pattern: /doubao[_-]?seed[_-]?code/i, contextLength: 256000 },
  // Seed-OSS - 512K tokens
  { pattern: /seed[_-]?oss[_-]?36b/i, contextLength: 512000 },
  { pattern: /seed[_-]?oss/i, contextLength: 512000 },
  // Seed-Rice - 128K tokens
  { pattern: /seed[_-]?rice/i, contextLength: 128000 },
  // Doubao Pro 系列
  { pattern: /doubao[_-]?pro[_-]?256k/i, contextLength: 256000 },
  { pattern: /doubao[_-]?pro[_-]?128k/i, contextLength: 128000 },
  { pattern: /doubao[_-]?pro[_-]?32k/i, contextLength: 32000 },
  { pattern: /doubao[_-]?pro/i, contextLength: 128000 },
  // Doubao Lite 系列
  { pattern: /doubao[_-]?lite[_-]?128k/i, contextLength: 128000 },
  { pattern: /doubao[_-]?lite[_-]?32k/i, contextLength: 32000 },
  { pattern: /doubao[_-]?lite/i, contextLength: 32000 },
  { pattern: /doubao/i, contextLength: 128000 },

  // ============================================================================
  // MiniMax 模型 (2025)
  // ============================================================================
  // MiniMax M2 系列 - 200K tokens
  { pattern: /minimax[_-]?m2\.?1/i, contextLength: 204800 },
  { pattern: /minimax[_-]?m2/i, contextLength: 204800 },
  // MiniMax M1 系列 - 80K tokens
  { pattern: /minimax[_-]?m1[_-]?80k/i, contextLength: 80000 },
  { pattern: /minimax[_-]?m1/i, contextLength: 80000 },
  { pattern: /abab7/i, contextLength: 245760 },
  { pattern: /abab6/i, contextLength: 245760 },
  { pattern: /abab/i, contextLength: 245760 },
  { pattern: /minimax/i, contextLength: 204800 },

  // ============================================================================
  // 百川模型
  // ============================================================================
  { pattern: /baichuan/i, contextLength: 32768 },

  // ============================================================================
  // 华为盘古模型 (Pangu)
  // ============================================================================
  // Pangu Pro MoE - 128K tokens
  { pattern: /pangu[_-]?pro[_-]?moe/i, contextLength: 128000 },
  { pattern: /pangu[_-]?pro/i, contextLength: 128000 },
  { pattern: /pangu/i, contextLength: 32768 },

  // ============================================================================
  // Yi 模型
  // ============================================================================
  { pattern: /yi[_-]?large[_-]?turbo/i, contextLength: 16000 },
  { pattern: /yi[_-]?large/i, contextLength: 32000 },
  { pattern: /yi[_-]?medium/i, contextLength: 16000 },
  { pattern: /yi[_-]/i, contextLength: 16384 },

  // ============================================================================
  // Cohere 模型
  // ============================================================================
  { pattern: /command[_-]?r[_-]?plus/i, contextLength: 128000 },
  { pattern: /command[_-]?r/i, contextLength: 128000 },
  { pattern: /command/i, contextLength: 4096 },

  // ============================================================================
  // 百度文心模型
  // ============================================================================
  // ERNIE-4.5-300B - 128K tokens
  { pattern: /ernie[_-]?4\.?5[_-]?300b/i, contextLength: 128000 },
  { pattern: /ernie[_-]?4/i, contextLength: 128000 },
  { pattern: /ernie/i, contextLength: 8000 },

  // ============================================================================
  // 腾讯混元模型 (Hunyuan)
  // ============================================================================
  // Hunyuan-A13B - 128K tokens
  { pattern: /hunyuan[_-]?a13b/i, contextLength: 128000 },
  // Hunyuan-MT-7B - 机器翻译模型
  { pattern: /hunyuan[_-]?mt/i, contextLength: 32768 },
  { pattern: /hunyuan/i, contextLength: 128000 },

  // ============================================================================
  // 阶跃星辰 StepFun (Step)
  // ============================================================================
  // Step-3 - 64K tokens
  { pattern: /step[_-]?3/i, contextLength: 64000 },

  // ============================================================================
  // InternLM 模型
  // ============================================================================
  // InternLM 2.5 - 128K tokens
  { pattern: /internlm2\.?5/i, contextLength: 32768 },
  { pattern: /internlm2/i, contextLength: 32768 },
  { pattern: /internlm/i, contextLength: 32768 },

  // ============================================================================
  // 快手 KAT 模型
  // ============================================================================
  // KAT-Dev - 128K tokens
  { pattern: /kat[_-]?dev/i, contextLength: 128000 },
  { pattern: /kat/i, contextLength: 128000 },

  // ============================================================================
  // 灵犀 Ling 模型 (InclusionAI)
  // ============================================================================
  // Ling-flash-2.0 - 128K tokens
  // Ling-mini-2.0 - 128K tokens
  { pattern: /ling[_-]?flash/i, contextLength: 128000 },
  { pattern: /ling[_-]?mini/i, contextLength: 128000 },
  { pattern: /ring[_-]?flash/i, contextLength: 128000 },
];

/**
 * 默认上下文长度
 * 0 表示"自动"，不发送 max_tokens 参数，由 API 使用模型默认值
 */
const DEFAULT_CONTEXT_LENGTH = 0;

/**
 * 根据模型 ID 推断上下文长度
 * @param modelId 模型 ID
 * @returns 推断的上下文长度（token 数）
 */
export function inferContextLength(modelId: string): number {
  if (!modelId) {
    return DEFAULT_CONTEXT_LENGTH;
  }

  for (const config of CONTEXT_LENGTH_CONFIGS) {
    if (config.pattern.test(modelId)) {
      return config.contextLength;
    }
  }

  return DEFAULT_CONTEXT_LENGTH;
}

// 导出配置供测试使用
export { CONTEXT_LENGTH_CONFIGS, DEFAULT_CONTEXT_LENGTH };
