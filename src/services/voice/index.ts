// ============================================================================
// 语音输入服务模块导出
// ============================================================================

// 类型导出
export * from './types';

// 语音输入主服务
export { 
  VoiceInputService,
  type DictationResult,
  type AssistantResult,
  type ILLMPostProcessor,
  type ITextInserterService,
} from './voiceInputService';

// 文本插入器
export { TextInserter } from './textInserter';

// LLM 后处理器
export { 
  LLMPostProcessor,
  type LLMPostProcessorConfig,
  type LLMPostProcessResult,
} from './llmPostProcessor';

// AI 助手处理器
export {
  AssistantProcessor,
  type AssistantMode,
  type AssistantProcessRequest,
  type AssistantProcessResult,
} from './assistantProcessor';

// 历史记录管理器
export { HistoryManager } from './historyManager';
