// 消息路由器
// 根据 module 字段将消息分发到对应的功能模块

use serde::{Deserialize, Serialize};
use thiserror::Error;
use crate::server::WsSender;

/// 日志宏
macro_rules! log_info {
    ($($arg:tt)*) => {
        eprintln!("[INFO] {}", format!($($arg)*));
    };
}

#[allow(unused_macros)]
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
// 模块类型和消息定义
// ============================================================================

/// 模块类型
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModuleType {
    /// PTY 终端模块
    Pty,
    /// 语音模块
    Voice,
    /// LLM 流式处理模块
    Llm,
    /// 工具模块
    Utils,
}

impl std::fmt::Display for ModuleType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ModuleType::Pty => write!(f, "pty"),
            ModuleType::Voice => write!(f, "voice"),
            ModuleType::Llm => write!(f, "llm"),
            ModuleType::Utils => write!(f, "utils"),
        }
    }
}

/// 统一消息格式
/// 
/// 所有客户端消息必须包含 `module` 字段来指定目标模块
#[derive(Debug, Deserialize)]
pub struct ModuleMessage {
    /// 目标模块
    pub module: ModuleType,
    /// 消息类型
    #[serde(rename = "type")]
    pub msg_type: String,
    /// 消息负载 (保留原始 JSON 以便各模块解析)
    #[serde(flatten)]
    pub payload: serde_json::Value,
}

impl ModuleMessage {
    /// 获取消息负载
    pub fn get_payload(&self) -> &serde_json::Value {
        &self.payload
    }
    
    /// 获取负载中的字段值
    pub fn get_field<T: serde::de::DeserializeOwned>(&self, field: &str) -> Option<T> {
        self.payload.get(field).and_then(|v| serde_json::from_value(v.clone()).ok())
    }
}

/// 服务器响应消息
#[derive(Debug, Serialize)]
pub struct ServerResponse {
    /// 来源模块
    pub module: ModuleType,
    /// 消息类型
    #[serde(rename = "type")]
    pub msg_type: String,
    /// 响应负载
    #[serde(flatten)]
    pub payload: serde_json::Value,
}

impl ServerResponse {
    /// 创建新的服务器响应
    #[allow(dead_code)]
    pub fn new(module: ModuleType, msg_type: &str, payload: serde_json::Value) -> Self {
        Self {
            module,
            msg_type: msg_type.to_string(),
            payload,
        }
    }
    
    /// 创建错误响应
    pub fn error(module: ModuleType, code: &str, message: &str) -> Self {
        Self {
            module,
            msg_type: "error".to_string(),
            payload: serde_json::json!({
                "code": code,
                "message": message
            }),
        }
    }
}

// ============================================================================
// 路由器错误
// ============================================================================

/// 路由器错误类型
#[derive(Debug, Error)]
pub enum RouterError {
    /// 未知模块
    #[error("Unknown module: {0}")]
    #[allow(dead_code)]
    UnknownModule(String),
    
    /// 无效的消息格式
    #[error("Invalid message format: {0}")]
    #[allow(dead_code)]
    InvalidMessage(String),
    
    /// 模块处理错误
    #[error("Module error: {0}")]
    ModuleError(String),
    
    /// JSON 序列化/反序列化错误
    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),
}

// ============================================================================
// 模块处理器 trait
// ============================================================================

/// 模块处理器 trait
/// 
/// 各功能模块需要实现此 trait 来处理消息
#[async_trait::async_trait]
pub trait ModuleHandler: Send + Sync {
    /// 获取模块类型
    fn module_type(&self) -> ModuleType;
    
    /// 处理消息
    /// 
    /// 返回 Some(response) 表示需要发送响应
    /// 返回 None 表示无需响应（如异步处理）
    async fn handle(&self, msg: &ModuleMessage) -> Result<Option<ServerResponse>, RouterError>;
}

// ============================================================================
// 消息路由器
// ============================================================================

/// 消息路由器
/// 
/// 负责将消息路由到对应的功能模块
pub struct MessageRouter {
    // PTY 模块处理器
    pty_handler: crate::pty::PtyHandler,
    // Voice 模块处理器
    voice_handler: crate::voice::VoiceHandler,
    // LLM 模块处理器
    llm_handler: crate::llm::LLMHandler,
    // Utils 模块处理器
    utils_handler: crate::utils::UtilsHandler,
}

impl MessageRouter {
    /// 创建新的消息路由器
    pub fn new() -> Self {
        Self {
            pty_handler: crate::pty::PtyHandler::new(),
            voice_handler: crate::voice::VoiceHandler::new(),
            llm_handler: crate::llm::LLMHandler::new(),
            utils_handler: crate::utils::UtilsHandler::new(),
        }
    }
    
    /// 设置 WebSocket 发送器 (用于 PTY 输出、Voice 消息、LLM 流式响应等)
    pub async fn set_ws_sender(&self, sender: WsSender) {
        self.pty_handler.set_ws_sender(sender.clone()).await;
        self.voice_handler.set_ws_sender(sender.clone()).await;
        self.llm_handler.set_ws_sender(sender.clone()).await;
        self.utils_handler.set_ws_sender(sender).await;
    }
    
    /// 获取 PTY 处理器引用 (用于写入数据)
    pub fn pty_handler(&self) -> &crate::pty::PtyHandler {
        &self.pty_handler
    }
    
    /// 获取 Voice 处理器引用
    pub fn voice_handler(&self) -> &crate::voice::VoiceHandler {
        &self.voice_handler
    }
    
    /// 获取 LLM 处理器引用
    pub fn llm_handler(&self) -> &crate::llm::LLMHandler {
        &self.llm_handler
    }
    
    /// 获取 Utils 处理器引用
    pub fn utils_handler(&self) -> &crate::utils::UtilsHandler {
        &self.utils_handler
    }
    
    /// 解析消息并提取模块类型
    /// 
    /// 返回 ModuleMessage 或错误
    pub fn parse_message(&self, text: &str) -> Result<ModuleMessage, RouterError> {
        // 首先尝试解析为 ModuleMessage
        let msg: ModuleMessage = serde_json::from_str(text)?;
        
        log_debug!("解析消息: module={}, type={}", msg.module, msg.msg_type);
        
        Ok(msg)
    }
    
    /// 尝试从原始 JSON 中解析模块类型
    /// 
    /// 用于在消息解析失败时提取模块信息以便返回正确的错误响应
    pub fn try_parse_module(&self, text: &str) -> Option<ModuleType> {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(text) {
            if let Some(module_str) = value.get("module").and_then(|v| v.as_str()) {
                return match module_str {
                    "pty" => Some(ModuleType::Pty),
                    "voice" => Some(ModuleType::Voice),
                    "llm" => Some(ModuleType::Llm),
                    "utils" => Some(ModuleType::Utils),
                    _ => None,
                };
            }
        }
        None
    }
    
    /// 路由消息到对应模块
    /// 
    /// 返回模块处理结果或错误响应
    /// 
    pub async fn route(&self, msg: ModuleMessage) -> Result<Option<ServerResponse>, RouterError> {
        log_info!("路由消息到模块: {}, 类型: {}", msg.module, msg.msg_type);
        
        match msg.module {
            ModuleType::Pty => {
                // PTY 模块处理
                log_debug!("PTY 模块消息: {}", msg.msg_type);
                self.pty_handler.handle(&msg).await
            }
            ModuleType::Voice => {
                // Voice 模块处理
                log_debug!("Voice 模块消息: {}", msg.msg_type);
                self.voice_handler.handle(&msg).await
            }
            ModuleType::Llm => {
                // LLM 模块处理
                log_debug!("LLM 模块消息: {}", msg.msg_type);
                self.llm_handler.handle(&msg).await
            }
            ModuleType::Utils => {
                // Utils 模块处理
                log_debug!("Utils 模块消息: {}", msg.msg_type);
                self.utils_handler.handle(&msg).await
            }
        }
    }
    
    /// 创建错误响应
    /// 
    pub fn create_error_response(&self, module: ModuleType, error: &RouterError) -> ServerResponse {
        let (code, message) = match error {
            RouterError::UnknownModule(m) => ("UNKNOWN_MODULE", format!("未知模块: {}", m)),
            RouterError::InvalidMessage(m) => ("INVALID_MESSAGE", format!("无效消息: {}", m)),
            RouterError::ModuleError(m) => ("MODULE_ERROR", m.clone()),
            RouterError::JsonError(e) => ("JSON_ERROR", format!("JSON 错误: {}", e)),
        };
        
        ServerResponse::error(module, code, &message)
    }
    
    /// 检查模块是否已实现
    #[allow(dead_code)]
    pub fn is_module_implemented(&self, module: ModuleType) -> bool {
        match module {
            ModuleType::Pty => true,    // PTY 模块已实现
            ModuleType::Voice => true,  // Voice 模块已实现
            ModuleType::Llm => true,    // LLM 模块已实现
            ModuleType::Utils => true,  // Utils 模块已实现
        }
    }
}

impl Default for MessageRouter {
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
    fn test_parse_pty_message() {
        let router = MessageRouter::new();
        let json = r#"{"module": "pty", "type": "init", "shell_type": "powershell"}"#;
        
        let msg = router.parse_message(json).unwrap();
        assert_eq!(msg.module, ModuleType::Pty);
        assert_eq!(msg.msg_type, "init");
        
        // 测试获取负载字段
        let shell_type: Option<String> = msg.get_field("shell_type");
        assert_eq!(shell_type, Some("powershell".to_string()));
    }
    
    #[test]
    fn test_parse_voice_message() {
        let router = MessageRouter::new();
        let json = r#"{"module": "voice", "type": "start_recording", "mode": "press"}"#;
        
        let msg = router.parse_message(json).unwrap();
        assert_eq!(msg.module, ModuleType::Voice);
        assert_eq!(msg.msg_type, "start_recording");
    }
    
    #[test]
    fn test_parse_llm_message() {
        let router = MessageRouter::new();
        let json = r#"{"module": "llm", "type": "stream_start", "endpoint": "https://api.example.com"}"#;
        
        let msg = router.parse_message(json).unwrap();
        assert_eq!(msg.module, ModuleType::Llm);
        assert_eq!(msg.msg_type, "stream_start");
    }
    
    #[test]
    fn test_parse_utils_message() {
        let router = MessageRouter::new();
        let json = r#"{"module": "utils", "type": "detect_language", "text": "Hello world"}"#;
        
        let msg = router.parse_message(json).unwrap();
        assert_eq!(msg.module, ModuleType::Utils);
        assert_eq!(msg.msg_type, "detect_language");
    }
    
    #[test]
    fn test_parse_invalid_module() {
        let router = MessageRouter::new();
        let json = r#"{"module": "unknown", "type": "test"}"#;
        
        let result = router.parse_message(json);
        assert!(result.is_err());
    }
    
    #[test]
    fn test_parse_missing_module() {
        let router = MessageRouter::new();
        let json = r#"{"type": "test"}"#;
        
        let result = router.parse_message(json);
        assert!(result.is_err());
    }
    
    #[test]
    fn test_try_parse_module_valid() {
        let router = MessageRouter::new();
        
        assert_eq!(router.try_parse_module(r#"{"module": "pty"}"#), Some(ModuleType::Pty));
        assert_eq!(router.try_parse_module(r#"{"module": "voice"}"#), Some(ModuleType::Voice));
        assert_eq!(router.try_parse_module(r#"{"module": "llm"}"#), Some(ModuleType::Llm));
        assert_eq!(router.try_parse_module(r#"{"module": "utils"}"#), Some(ModuleType::Utils));
    }
    
    #[test]
    fn test_try_parse_module_invalid() {
        let router = MessageRouter::new();
        
        // 未知模块
        assert_eq!(router.try_parse_module(r#"{"module": "unknown"}"#), None);
        
        // 缺少 module 字段
        assert_eq!(router.try_parse_module(r#"{"type": "test"}"#), None);
        
        // 无效 JSON
        assert_eq!(router.try_parse_module("not json"), None);
    }
    
    #[test]
    fn test_server_response_error() {
        let response = ServerResponse::error(ModuleType::Pty, "TEST_ERROR", "Test error message");
        
        assert_eq!(response.module, ModuleType::Pty);
        assert_eq!(response.msg_type, "error");
        
        let payload = response.payload.as_object().unwrap();
        assert_eq!(payload.get("code").unwrap().as_str().unwrap(), "TEST_ERROR");
        assert_eq!(payload.get("message").unwrap().as_str().unwrap(), "Test error message");
    }
    
    #[test]
    fn test_server_response_new() {
        let payload = serde_json::json!({"key": "value"});
        let response = ServerResponse::new(ModuleType::Voice, "test_type", payload);
        
        assert_eq!(response.module, ModuleType::Voice);
        assert_eq!(response.msg_type, "test_type");
        assert_eq!(response.payload.get("key").unwrap().as_str().unwrap(), "value");
    }
    
    #[test]
    fn test_module_type_display() {
        assert_eq!(format!("{}", ModuleType::Pty), "pty");
        assert_eq!(format!("{}", ModuleType::Voice), "voice");
        assert_eq!(format!("{}", ModuleType::Llm), "llm");
        assert_eq!(format!("{}", ModuleType::Utils), "utils");
    }
    
    #[test]
    fn test_create_error_response_unknown_module() {
        let router = MessageRouter::new();
        let error = RouterError::UnknownModule("test_module".to_string());
        let response = router.create_error_response(ModuleType::Utils, &error);
        
        assert_eq!(response.module, ModuleType::Utils);
        assert_eq!(response.msg_type, "error");
        
        let payload = response.payload.as_object().unwrap();
        assert_eq!(payload.get("code").unwrap().as_str().unwrap(), "UNKNOWN_MODULE");
        assert!(payload.get("message").unwrap().as_str().unwrap().contains("test_module"));
    }
    
    #[test]
    fn test_create_error_response_module_error() {
        let router = MessageRouter::new();
        let error = RouterError::ModuleError("Something went wrong".to_string());
        let response = router.create_error_response(ModuleType::Llm, &error);
        
        assert_eq!(response.module, ModuleType::Llm);
        assert_eq!(response.msg_type, "error");
        
        let payload = response.payload.as_object().unwrap();
        assert_eq!(payload.get("code").unwrap().as_str().unwrap(), "MODULE_ERROR");
        assert_eq!(payload.get("message").unwrap().as_str().unwrap(), "Something went wrong");
    }
    
    #[tokio::test]
    async fn test_utils_module_is_implemented() {
        let router = MessageRouter::new();
        assert!(router.is_module_implemented(ModuleType::Utils));
    }
    
    #[tokio::test]
    async fn test_llm_module_is_implemented() {
        let router = MessageRouter::new();
        assert!(router.is_module_implemented(ModuleType::Llm));
    }
    
    #[tokio::test]
    async fn test_pty_module_is_implemented() {
        let router = MessageRouter::new();
        assert!(router.is_module_implemented(ModuleType::Pty));
    }
    
    #[tokio::test]
    async fn test_voice_module_is_implemented() {
        let router = MessageRouter::new();
        assert!(router.is_module_implemented(ModuleType::Voice));
    }
    
    #[test]
    fn test_module_message_get_field() {
        let router = MessageRouter::new();
        let json = r#"{"module": "pty", "type": "init", "cols": 80, "rows": 24, "shell_type": "bash"}"#;
        
        let msg = router.parse_message(json).unwrap();
        
        // 测试获取不同类型的字段
        let cols: Option<u16> = msg.get_field("cols");
        assert_eq!(cols, Some(80));
        
        let rows: Option<u16> = msg.get_field("rows");
        assert_eq!(rows, Some(24));
        
        let shell_type: Option<String> = msg.get_field("shell_type");
        assert_eq!(shell_type, Some("bash".to_string()));
        
        // 测试获取不存在的字段
        let missing: Option<String> = msg.get_field("nonexistent");
        assert_eq!(missing, None);
    }
    
    #[test]
    fn test_module_type_serialization() {
        // 测试序列化
        let pty = ModuleType::Pty;
        let json = serde_json::to_string(&pty).unwrap();
        assert_eq!(json, r#""pty""#);
        
        // 测试反序列化
        let deserialized: ModuleType = serde_json::from_str(r#""voice""#).unwrap();
        assert_eq!(deserialized, ModuleType::Voice);
    }
}
