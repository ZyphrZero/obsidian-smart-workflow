// LLM API 响应解析
// 支持 Chat Completions API 和 Responses API 两种格式

use serde::{Deserialize, Serialize};

/// API 格式类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiFormat {
    /// OpenAI Chat Completions API 格式
    ChatCompletions,
    /// OpenAI Responses API 格式（用于推理模型）
    Responses,
}

impl Default for ApiFormat {
    fn default() -> Self {
        Self::ChatCompletions
    }
}

// ============================================================================
// Chat Completions API 响应结构
// ============================================================================

/// Chat Completions 流式响应
#[derive(Debug, Deserialize)]
pub struct ChatCompletionsChunk {
    pub id: Option<String>,
    pub object: Option<String>,
    pub created: Option<i64>,
    pub model: Option<String>,
    pub choices: Vec<ChatCompletionsChoice>,
}

#[derive(Debug, Deserialize)]
pub struct ChatCompletionsChoice {
    pub index: Option<i32>,
    pub delta: Option<ChatCompletionsDelta>,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ChatCompletionsDelta {
    pub role: Option<String>,
    pub content: Option<String>,
    /// 用于推理模型的思考内容
    pub reasoning_content: Option<String>,
}

// ============================================================================
// Responses API 响应结构
// ============================================================================

/// Responses API 流式响应
#[derive(Debug, Deserialize)]
pub struct ResponsesChunk {
    #[serde(rename = "type")]
    pub event_type: Option<String>,
    pub delta: Option<String>,
    pub response: Option<ResponsesResponse>,
}

#[derive(Debug, Deserialize)]
pub struct ResponsesResponse {
    pub id: Option<String>,
    pub status: Option<String>,
    pub output: Option<Vec<ResponsesOutput>>,
}

#[derive(Debug, Deserialize)]
pub struct ResponsesOutput {
    #[serde(rename = "type")]
    pub output_type: Option<String>,
    pub content: Option<Vec<ResponsesContent>>,
}

#[derive(Debug, Deserialize)]
pub struct ResponsesContent {
    #[serde(rename = "type")]
    pub content_type: Option<String>,
    pub text: Option<String>,
}

// ============================================================================
// 统一的内容提取结果
// ============================================================================

/// 内容提取结果
#[derive(Debug, Clone, Default)]
pub struct ExtractedContent {
    /// 主要内容
    pub content: Option<String>,
    /// 思考/推理内容
    pub reasoning: Option<String>,
    /// 是否完成
    pub is_done: bool,
    /// 完成原因
    pub finish_reason: Option<String>,
}

// ============================================================================
// 响应解析器
// ============================================================================

/// 响应解析器
/// 
/// Requirements 4.7: 支持 Chat Completions API 和 Responses API 两种响应格式
pub struct ResponseParser;

impl ResponseParser {
    /// 解析 SSE 数据
    /// 
    /// 根据 API 格式解析 JSON 数据并提取内容
    pub fn parse(data: &str, format: ApiFormat) -> Result<ExtractedContent, ParseError> {
        match format {
            ApiFormat::ChatCompletions => Self::parse_chat_completions(data),
            ApiFormat::Responses => Self::parse_responses(data),
        }
    }
    
    /// 解析 Chat Completions API 响应
    fn parse_chat_completions(data: &str) -> Result<ExtractedContent, ParseError> {
        let chunk: ChatCompletionsChunk = serde_json::from_str(data)
            .map_err(|e| ParseError::JsonError(e.to_string()))?;
        
        let mut result = ExtractedContent::default();
        
        if let Some(choice) = chunk.choices.first() {
            // 检查完成状态
            if let Some(reason) = &choice.finish_reason {
                result.is_done = true;
                result.finish_reason = Some(reason.clone());
            }
            
            // 提取内容
            if let Some(delta) = &choice.delta {
                result.content = delta.content.clone();
                result.reasoning = delta.reasoning_content.clone();
            }
        }
        
        Ok(result)
    }
    
    /// 解析 Responses API 响应
    fn parse_responses(data: &str) -> Result<ExtractedContent, ParseError> {
        let chunk: ResponsesChunk = serde_json::from_str(data)
            .map_err(|e| ParseError::JsonError(e.to_string()))?;
        
        let mut result = ExtractedContent::default();
        
        // 检查事件类型
        if let Some(event_type) = &chunk.event_type {
            match event_type.as_str() {
                "response.output_text.delta" => {
                    // 文本增量
                    result.content = chunk.delta.clone();
                }
                "response.output_text.done" | "response.done" => {
                    result.is_done = true;
                }
                "response.completed" => {
                    result.is_done = true;
                    // 尝试从 response 中提取完整内容
                    if let Some(response) = &chunk.response {
                        if let Some(outputs) = &response.output {
                            for output in outputs {
                                if let Some(contents) = &output.content {
                                    for content in contents {
                                        if content.content_type.as_deref() == Some("output_text") {
                                            result.content = content.text.clone();
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                _ => {
                    // 其他事件类型，尝试提取 delta
                    if chunk.delta.is_some() {
                        result.content = chunk.delta.clone();
                    }
                }
            }
        } else if chunk.delta.is_some() {
            // 没有事件类型但有 delta
            result.content = chunk.delta.clone();
        }
        
        Ok(result)
    }
    
    /// 尝试自动检测 API 格式
    pub fn detect_format(data: &str) -> Option<ApiFormat> {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
            // Chat Completions 格式有 choices 数组
            if value.get("choices").is_some() {
                return Some(ApiFormat::ChatCompletions);
            }
            
            // Responses 格式有 type 字段
            if value.get("type").is_some() {
                return Some(ApiFormat::Responses);
            }
            
            // 有 delta 字段但没有 choices，可能是 Responses 格式
            if value.get("delta").is_some() && value.get("choices").is_none() {
                return Some(ApiFormat::Responses);
            }
        }
        
        None
    }
}

/// 解析错误
#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("JSON parse error: {0}")]
    JsonError(String),
    
    #[error("Unknown format")]
    UnknownFormat,
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_parse_chat_completions_content() {
        let data = r#"{"id":"chatcmpl-123","object":"chat.completion.chunk","created":1234567890,"model":"gpt-4","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}"#;
        
        let result = ResponseParser::parse(data, ApiFormat::ChatCompletions).unwrap();
        
        assert_eq!(result.content, Some("Hello".to_string()));
        assert!(!result.is_done);
    }
    
    #[test]
    fn test_parse_chat_completions_done() {
        let data = r#"{"id":"chatcmpl-123","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}"#;
        
        let result = ResponseParser::parse(data, ApiFormat::ChatCompletions).unwrap();
        
        assert!(result.is_done);
        assert_eq!(result.finish_reason, Some("stop".to_string()));
    }
    
    #[test]
    fn test_parse_chat_completions_reasoning() {
        let data = r#"{"choices":[{"delta":{"content":"Answer","reasoning_content":"Let me think..."}}]}"#;
        
        let result = ResponseParser::parse(data, ApiFormat::ChatCompletions).unwrap();
        
        assert_eq!(result.content, Some("Answer".to_string()));
        assert_eq!(result.reasoning, Some("Let me think...".to_string()));
    }
    
    #[test]
    fn test_parse_responses_delta() {
        let data = r#"{"type":"response.output_text.delta","delta":"Hello"}"#;
        
        let result = ResponseParser::parse(data, ApiFormat::Responses).unwrap();
        
        assert_eq!(result.content, Some("Hello".to_string()));
        assert!(!result.is_done);
    }
    
    #[test]
    fn test_parse_responses_done() {
        let data = r#"{"type":"response.done"}"#;
        
        let result = ResponseParser::parse(data, ApiFormat::Responses).unwrap();
        
        assert!(result.is_done);
    }
    
    #[test]
    fn test_detect_format_chat_completions() {
        let data = r#"{"choices":[{"delta":{"content":"test"}}]}"#;
        
        assert_eq!(ResponseParser::detect_format(data), Some(ApiFormat::ChatCompletions));
    }
    
    #[test]
    fn test_detect_format_responses() {
        let data = r#"{"type":"response.output_text.delta","delta":"test"}"#;
        
        assert_eq!(ResponseParser::detect_format(data), Some(ApiFormat::Responses));
    }
    
    #[test]
    fn test_api_format_serialization() {
        let format = ApiFormat::ChatCompletions;
        let json = serde_json::to_string(&format).unwrap();
        assert_eq!(json, r#""chat_completions""#);
        
        let format: ApiFormat = serde_json::from_str(r#""responses""#).unwrap();
        assert_eq!(format, ApiFormat::Responses);
    }
}
