// Utils 模块
// 提供语言检测等通用工具功能

pub mod language;

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

use crate::router::{ModuleMessage, ModuleType, RouterError, ServerResponse};
use crate::server::WsSender;
use language::{LanguageDetector, LanguageDetectionResult};

/// 日志宏
macro_rules! log_info {
    ($($arg:tt)*) => {
        eprintln!("[INFO] {}", format!($($arg)*));
    };
}

macro_rules! log_error {
    ($($arg:tt)*) => {
        eprintln!("[ERROR] {}", format!($($arg)*));
    };
}

macro_rules! log_debug {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[DEBUG] {}", format!($($arg)*));
        }
    };
}

// ============================================================================
// 消息类型定义
// ============================================================================

/// 语言检测请求
/// 
/// Requirements 5.1: 收到 detect_language 消息时检测文本语言
#[derive(Debug, Deserialize)]
pub struct DetectLanguageRequest {
    /// 要检测的文本
    pub text: String,
    /// 请求 ID (用于关联响应)
    pub request_id: String,
}


/// 语言检测响应
#[derive(Debug, Serialize)]
pub struct LanguageDetectedResponse {
    /// 请求 ID
    pub request_id: String,
    /// ISO 639-1 语言代码
    pub language: String,
    /// 置信度 (0.0 - 1.0)
    pub confidence: f64,
    /// 是否为简体中文 (仅当 language 为 "zh" 时有效)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_simplified: Option<bool>,
}

impl LanguageDetectedResponse {
    /// 从语言检测结果创建响应
    pub fn from_result(request_id: String, result: LanguageDetectionResult) -> Self {
        Self {
            request_id,
            language: result.language,
            confidence: result.confidence,
            is_simplified: result.is_simplified,
        }
    }
}

// ============================================================================
// Utils 模块处理器
// ============================================================================

/// Utils 模块处理器
/// 
/// 提供语言检测等通用工具功能
pub struct UtilsHandler {
    /// 语言检测器
    detector: LanguageDetector,
    /// WebSocket 发送器
    ws_sender: Arc<TokioMutex<Option<WsSender>>>,
}

impl UtilsHandler {
    /// 创建新的 Utils 处理器
    pub fn new() -> Self {
        Self {
            detector: LanguageDetector::new(),
            ws_sender: Arc::new(TokioMutex::new(None)),
        }
    }
    
    /// 设置 WebSocket 发送器
    pub async fn set_ws_sender(&self, sender: WsSender) {
        let mut ws = self.ws_sender.lock().await;
        *ws = Some(sender);
    }

    
    /// 处理 Utils 模块消息
    /// 
    /// Requirements 5.1: 收到 detect_language 消息时检测文本语言并返回结果
    pub async fn handle(&self, msg: &ModuleMessage) -> Result<Option<ServerResponse>, RouterError> {
        log_info!("Utils 模块处理消息: {}", msg.msg_type);
        
        match msg.msg_type.as_str() {
            "detect_language" => {
                self.handle_detect_language(msg).await
            }
            _ => {
                log_error!("未知的 Utils 消息类型: {}", msg.msg_type);
                Err(RouterError::ModuleError(format!(
                    "Unknown Utils message type: {}",
                    msg.msg_type
                )))
            }
        }
    }
    
    /// 处理语言检测请求
    /// 
    /// Requirements 5.1: 检测文本语言并返回结果
    /// Requirements 5.2: 返回 ISO 639-1 语言代码和置信度分数
    /// Requirements 5.3: 能够区分简体中文和繁体中文
    async fn handle_detect_language(
        &self,
        msg: &ModuleMessage,
    ) -> Result<Option<ServerResponse>, RouterError> {
        // 解析请求
        let request: DetectLanguageRequest = serde_json::from_value(msg.payload.clone())
            .map_err(|e| RouterError::ModuleError(format!("Invalid detect_language request: {}", e)))?;
        
        log_debug!("语言检测请求: request_id={}, text_len={}", 
            request.request_id, request.text.len());
        
        // 执行语言检测
        let start_time = std::time::Instant::now();
        let result = self.detector.detect(&request.text);
        let elapsed = start_time.elapsed();
        
        log_info!("语言检测完成: language={}, confidence={:.2}, is_simplified={:?}, elapsed={:?}",
            result.language, result.confidence, result.is_simplified, elapsed);
        
        // 构建响应
        let response = LanguageDetectedResponse::from_result(request.request_id, result);
        let payload = serde_json::to_value(&response)
            .map_err(|e| RouterError::ModuleError(format!("Failed to serialize response: {}", e)))?;
        
        Ok(Some(ServerResponse {
            module: ModuleType::Utils,
            msg_type: "language_detected".to_string(),
            payload,
        }))
    }
    
    /// 清理资源
    pub async fn cleanup(&self) {
        log_debug!("Utils 模块清理资源");
        // Utils 模块目前没有需要清理的资源
    }
}

impl Default for UtilsHandler {
    fn default() -> Self {
        Self::new()
    }
}


// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_detect_language_request_deserialization() {
        let json = r#"{"text": "Hello world", "request_id": "test-123"}"#;
        let request: DetectLanguageRequest = serde_json::from_str(json).unwrap();
        
        assert_eq!(request.text, "Hello world");
        assert_eq!(request.request_id, "test-123");
    }
    
    #[test]
    fn test_language_detected_response_serialization() {
        let result = LanguageDetectionResult::new("en", 0.95);
        let response = LanguageDetectedResponse::from_result("test-123".to_string(), result);
        
        let json = serde_json::to_string(&response).unwrap();
        
        assert!(json.contains("\"request_id\":\"test-123\""));
        assert!(json.contains("\"language\":\"en\""));
        assert!(json.contains("\"confidence\":0.95"));
        // is_simplified 为 None 时不应该出现在 JSON 中
        assert!(!json.contains("is_simplified"));
    }
    
    #[test]
    fn test_chinese_response_serialization() {
        let result = LanguageDetectionResult::chinese(0.9, true);
        let response = LanguageDetectedResponse::from_result("test-456".to_string(), result);
        
        let json = serde_json::to_string(&response).unwrap();
        
        assert!(json.contains("\"language\":\"zh\""));
        assert!(json.contains("\"is_simplified\":true"));
    }
    
    #[tokio::test]
    async fn test_utils_handler_detect_language() {
        let handler = UtilsHandler::new();
        
        // 创建测试消息
        let msg = ModuleMessage {
            module: ModuleType::Utils,
            msg_type: "detect_language".to_string(),
            payload: serde_json::json!({
                "text": "Hello, this is a test message.",
                "request_id": "test-789"
            }),
        };
        
        let result = handler.handle(&msg).await;
        assert!(result.is_ok());
        
        let response = result.unwrap();
        assert!(response.is_some());
        
        let response = response.unwrap();
        assert_eq!(response.module, ModuleType::Utils);
        assert_eq!(response.msg_type, "language_detected");
        
        // 验证响应内容
        let payload = response.payload;
        assert_eq!(payload.get("request_id").unwrap().as_str().unwrap(), "test-789");
        assert_eq!(payload.get("language").unwrap().as_str().unwrap(), "en");
    }
    
    #[tokio::test]
    async fn test_utils_handler_unknown_message_type() {
        let handler = UtilsHandler::new();
        
        let msg = ModuleMessage {
            module: ModuleType::Utils,
            msg_type: "unknown_type".to_string(),
            payload: serde_json::json!({}),
        };
        
        let result = handler.handle(&msg).await;
        assert!(result.is_err());
        
        if let Err(RouterError::ModuleError(msg)) = result {
            assert!(msg.contains("Unknown Utils message type"));
        } else {
            panic!("Expected ModuleError");
        }
    }
    
    #[tokio::test]
    async fn test_utils_handler_invalid_request() {
        let handler = UtilsHandler::new();
        
        // 缺少必要字段的请求
        let msg = ModuleMessage {
            module: ModuleType::Utils,
            msg_type: "detect_language".to_string(),
            payload: serde_json::json!({
                "text": "Hello"
                // 缺少 request_id
            }),
        };
        
        let result = handler.handle(&msg).await;
        assert!(result.is_err());
    }
}
