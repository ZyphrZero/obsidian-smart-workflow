// LLM 流式处理模块
// 提供 SSE 流解析和响应处理功能

pub mod sse_parser;
pub mod thinking;
pub mod response;

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;
use tokio_util::sync::CancellationToken;
use serde::{Deserialize, Serialize};

use crate::router::{ModuleHandler, ModuleMessage, ModuleType, RouterError, ServerResponse};
use crate::server::WsSender;

use futures_util::SinkExt;

use self::sse_parser::{SSEParser, SSEEvent};
use self::thinking::StreamingThinkingFilter;
use self::response::{ApiFormat, ResponseParser};

/// 日志宏
macro_rules! log_info {
    ($($arg:tt)*) => {
        eprintln!("[INFO] [LLM] {}", format!($($arg)*));
    };
}

macro_rules! log_error {
    ($($arg:tt)*) => {
        eprintln!("[ERROR] [LLM] {}", format!($($arg)*));
    };
}

macro_rules! log_debug {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[DEBUG] [LLM] {}", format!($($arg)*));
        }
    };
}

// ============================================================================
// 配置和消息类型
// ============================================================================

/// LLM 流式请求配置
/// 
/// Requirements 4.1: stream_start 消息配置
#[derive(Debug, Clone, Deserialize)]
pub struct StreamConfig {
    /// API 端点
    pub endpoint: String,
    /// 请求头
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// 请求体 (JSON 字符串)
    pub body: String,
    /// API 格式
    #[serde(default)]
    pub api_format: ApiFormat,
    /// 请求 ID（用于关联响应）
    #[serde(default)]
    pub request_id: Option<String>,
}

/// LLM 模块错误
#[derive(Debug, thiserror::Error)]
pub enum LLMError {
    #[error("Network error: {0}")]
    NetworkError(String),
    
    #[error("Parse error: {0}")]
    ParseError(String),
    
    #[error("Request cancelled")]
    Cancelled,
    
    #[error("Invalid configuration: {0}")]
    InvalidConfig(String),
    
    #[error("HTTP error: {status} - {message}")]
    HttpError { status: u16, message: String },
}

// ============================================================================
// 响应消息类型
// ============================================================================

/// 流式数据块消息
#[derive(Debug, Serialize)]
struct StreamChunkMessage {
    module: &'static str,
    #[serde(rename = "type")]
    msg_type: &'static str,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
}

/// 思考内容消息
#[derive(Debug, Serialize)]
struct StreamThinkingMessage {
    module: &'static str,
    #[serde(rename = "type")]
    msg_type: &'static str,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
}

/// 流式完成消息
#[derive(Debug, Serialize)]
struct StreamCompleteMessage {
    module: &'static str,
    #[serde(rename = "type")]
    msg_type: &'static str,
    full_content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
}

/// 流式错误消息
#[derive(Debug, Serialize)]
struct StreamErrorMessage {
    module: &'static str,
    #[serde(rename = "type")]
    msg_type: &'static str,
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
}

// ============================================================================
// LLM 处理器
// ============================================================================

/// LLM 模块处理器
/// 
/// Requirements 4.1-4.7: 实现 LLM 流式处理
pub struct LLMHandler {
    /// WebSocket 发送器
    ws_sender: Arc<TokioMutex<Option<WsSender>>>,
    /// 当前请求的取消令牌
    cancel_token: Arc<TokioMutex<Option<CancellationToken>>>,
    /// HTTP 客户端
    http_client: reqwest::Client,
}

impl LLMHandler {
    /// 创建新的 LLM 处理器
    pub fn new() -> Self {
        Self {
            ws_sender: Arc::new(TokioMutex::new(None)),
            cancel_token: Arc::new(TokioMutex::new(None)),
            http_client: reqwest::Client::new(),
        }
    }
    
    /// 设置 WebSocket 发送器
    pub async fn set_ws_sender(&self, sender: WsSender) {
        let mut ws = self.ws_sender.lock().await;
        *ws = Some(sender);
    }
    
    /// 开始流式请求
    /// 
    /// Requirements 4.1: 发起 HTTP 请求并开始流式解析
    async fn start_stream(&self, config: StreamConfig) -> Result<(), LLMError> {
        log_info!("开始流式请求: endpoint={}", config.endpoint);
        
        // 创建取消令牌
        let cancel_token = CancellationToken::new();
        {
            let mut token = self.cancel_token.lock().await;
            *token = Some(cancel_token.clone());
        }
        
        // 获取 WebSocket 发送器
        let ws_sender = {
            let ws = self.ws_sender.lock().await;
            ws.clone().ok_or_else(|| LLMError::InvalidConfig("WebSocket not connected".to_string()))?
        };
        
        // 克隆配置用于异步任务
        let endpoint = config.endpoint.clone();
        let headers = config.headers.clone();
        let body = config.body.clone();
        let api_format = config.api_format;
        let request_id = config.request_id.clone();
        let http_client = self.http_client.clone();
        
        // 在后台任务中执行流式请求
        tokio::spawn(async move {
            let result = Self::execute_stream(
                http_client,
                endpoint,
                headers,
                body,
                api_format,
                request_id.clone(),
                ws_sender.clone(),
                cancel_token,
            ).await;
            
            if let Err(e) = result {
                log_error!("流式请求失败: {}", e);
                // 发送错误消息
                let _ = Self::send_error(&ws_sender, &e, request_id.as_deref()).await;
            }
        });
        
        Ok(())
    }
    
    /// 执行流式请求
    async fn execute_stream(
        client: reqwest::Client,
        endpoint: String,
        headers: HashMap<String, String>,
        body: String,
        api_format: ApiFormat,
        request_id: Option<String>,
        ws_sender: WsSender,
        cancel_token: CancellationToken,
    ) -> Result<(), LLMError> {
        // 构建请求
        let mut request = client.post(&endpoint)
            .header("Content-Type", "application/json")
            .header("Accept", "text/event-stream");
        
        // 添加自定义请求头
        for (key, value) in &headers {
            request = request.header(key, value);
        }
        
        // 发送请求
        let response = request.body(body).send().await
            .map_err(|e| LLMError::NetworkError(e.to_string()))?;
        
        // 检查响应状态
        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            return Err(LLMError::HttpError {
                status: status.as_u16(),
                message: error_text,
            });
        }
        
        // 处理流式响应
        Self::process_stream(
            response,
            api_format,
            request_id,
            ws_sender,
            cancel_token,
        ).await
    }
    
    /// 处理流式响应
    /// 
    /// Requirements 4.2, 4.3, 4.4, 4.5: 解析 SSE 并发送消息
    async fn process_stream(
        response: reqwest::Response,
        api_format: ApiFormat,
        request_id: Option<String>,
        ws_sender: WsSender,
        cancel_token: CancellationToken,
    ) -> Result<(), LLMError> {
        use futures_util::StreamExt;
        
        let mut sse_parser = SSEParser::new();
        let mut thinking_filter = StreamingThinkingFilter::new();
        let mut full_content = String::new();
        let mut stream = response.bytes_stream();
        
        loop {
            tokio::select! {
                // 检查取消
                _ = cancel_token.cancelled() => {
                    log_info!("流式请求已取消");
                    return Err(LLMError::Cancelled);
                }
                
                // 读取数据
                chunk = stream.next() => {
                    match chunk {
                        Some(Ok(bytes)) => {
                            let text = String::from_utf8_lossy(&bytes);
                            log_debug!("收到数据块: {} 字节", bytes.len());
                            
                            // 解析 SSE 事件
                            let events = sse_parser.parse_chunk(&text);
                            
                            for event in events {
                                match event {
                                    SSEEvent::Done => {
                                        // 流结束
                                        log_info!("流式响应完成");
                                        
                                        // 刷新思考过滤器
                                        let (remaining, thinking) = thinking_filter.flush();
                                        if !remaining.is_empty() {
                                            full_content.push_str(&remaining);
                                        }
                                        if let Some(t) = thinking {
                                            Self::send_thinking(&ws_sender, &t, request_id.as_deref()).await?;
                                        }
                                        
                                        // 发送完成消息
                                        Self::send_complete(&ws_sender, &full_content, request_id.as_deref()).await?;
                                        return Ok(());
                                    }
                                    SSEEvent::Data(data) => {
                                        // 解析响应数据
                                        match ResponseParser::parse(&data, api_format) {
                                            Ok(extracted) => {
                                                // 处理推理内容
                                                if let Some(reasoning) = extracted.reasoning {
                                                    Self::send_thinking(&ws_sender, &reasoning, request_id.as_deref()).await?;
                                                }
                                                
                                                // 处理主要内容
                                                if let Some(content) = extracted.content {
                                                    // 通过思考过滤器处理
                                                    let (filtered, thinking) = thinking_filter.process_chunk(&content);
                                                    
                                                    // 发送思考内容
                                                    if let Some(t) = thinking {
                                                        Self::send_thinking(&ws_sender, &t, request_id.as_deref()).await?;
                                                    }
                                                    
                                                    // 发送过滤后的内容
                                                    if !filtered.is_empty() {
                                                        full_content.push_str(&filtered);
                                                        Self::send_chunk(&ws_sender, &filtered, request_id.as_deref()).await?;
                                                    }
                                                }
                                                
                                                // 检查是否完成
                                                if extracted.is_done {
                                                    log_info!("流式响应完成 (finish_reason: {:?})", extracted.finish_reason);
                                                    
                                                    // 刷新思考过滤器
                                                    let (remaining, thinking) = thinking_filter.flush();
                                                    if !remaining.is_empty() {
                                                        full_content.push_str(&remaining);
                                                    }
                                                    if let Some(t) = thinking {
                                                        Self::send_thinking(&ws_sender, &t, request_id.as_deref()).await?;
                                                    }
                                                    
                                                    // 发送完成消息
                                                    Self::send_complete(&ws_sender, &full_content, request_id.as_deref()).await?;
                                                    return Ok(());
                                                }
                                            }
                                            Err(e) => {
                                                log_debug!("解析响应失败: {} (data: {})", e, data);
                                                // 继续处理，某些数据可能不是有效的 JSON
                                            }
                                        }
                                    }
                                    SSEEvent::Comment(_) => {
                                        // 忽略注释
                                    }
                                    SSEEvent::Event { event_type, data } => {
                                        log_debug!("收到事件: type={}, data={}", event_type, data);
                                        // 某些 API 使用 event 字段，尝试解析 data
                                        if let Ok(extracted) = ResponseParser::parse(&data, api_format) {
                                            if let Some(content) = extracted.content {
                                                let (filtered, thinking) = thinking_filter.process_chunk(&content);
                                                if let Some(t) = thinking {
                                                    Self::send_thinking(&ws_sender, &t, request_id.as_deref()).await?;
                                                }
                                                if !filtered.is_empty() {
                                                    full_content.push_str(&filtered);
                                                    Self::send_chunk(&ws_sender, &filtered, request_id.as_deref()).await?;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Some(Err(e)) => {
                            return Err(LLMError::NetworkError(e.to_string()));
                        }
                        None => {
                            // 流结束
                            log_info!("流结束");
                            
                            // 刷新思考过滤器
                            let (remaining, thinking) = thinking_filter.flush();
                            if !remaining.is_empty() {
                                full_content.push_str(&remaining);
                            }
                            if let Some(t) = thinking {
                                Self::send_thinking(&ws_sender, &t, request_id.as_deref()).await?;
                            }
                            
                            // 发送完成消息
                            Self::send_complete(&ws_sender, &full_content, request_id.as_deref()).await?;
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
    
    /// 发送数据块消息
    /// 
    /// Requirements 4.2: 发送 stream_chunk 消息
    async fn send_chunk(ws_sender: &WsSender, content: &str, request_id: Option<&str>) -> Result<(), LLMError> {
        let msg = StreamChunkMessage {
            module: "llm",
            msg_type: "stream_chunk",
            content: content.to_string(),
            request_id: request_id.map(|s| s.to_string()),
        };
        
        let json = serde_json::to_string(&msg)
            .map_err(|e| LLMError::ParseError(e.to_string()))?;
        
        let mut sender = ws_sender.lock().await;
        sender.send(tokio_tungstenite::tungstenite::Message::Text(json.into())).await
            .map_err(|e| LLMError::NetworkError(e.to_string()))?;
        
        Ok(())
    }
    
    /// 发送思考内容消息
    /// 
    /// Requirements 4.3: 发送 stream_thinking 消息
    async fn send_thinking(ws_sender: &WsSender, content: &str, request_id: Option<&str>) -> Result<(), LLMError> {
        let msg = StreamThinkingMessage {
            module: "llm",
            msg_type: "stream_thinking",
            content: content.to_string(),
            request_id: request_id.map(|s| s.to_string()),
        };
        
        let json = serde_json::to_string(&msg)
            .map_err(|e| LLMError::ParseError(e.to_string()))?;
        
        let mut sender = ws_sender.lock().await;
        sender.send(tokio_tungstenite::tungstenite::Message::Text(json.into())).await
            .map_err(|e| LLMError::NetworkError(e.to_string()))?;
        
        Ok(())
    }
    
    /// 发送完成消息
    /// 
    /// Requirements 4.4: 发送 stream_complete 消息
    async fn send_complete(ws_sender: &WsSender, full_content: &str, request_id: Option<&str>) -> Result<(), LLMError> {
        let msg = StreamCompleteMessage {
            module: "llm",
            msg_type: "stream_complete",
            full_content: full_content.to_string(),
            request_id: request_id.map(|s| s.to_string()),
        };
        
        let json = serde_json::to_string(&msg)
            .map_err(|e| LLMError::ParseError(e.to_string()))?;
        
        let mut sender = ws_sender.lock().await;
        sender.send(tokio_tungstenite::tungstenite::Message::Text(json.into())).await
            .map_err(|e| LLMError::NetworkError(e.to_string()))?;
        
        Ok(())
    }
    
    /// 发送错误消息
    /// 
    /// Requirements 4.5: 发送 stream_error 消息
    async fn send_error(ws_sender: &WsSender, error: &LLMError, request_id: Option<&str>) -> Result<(), LLMError> {
        let (code, message) = match error {
            LLMError::NetworkError(msg) => ("NETWORK_ERROR", msg.clone()),
            LLMError::ParseError(msg) => ("PARSE_ERROR", msg.clone()),
            LLMError::Cancelled => ("CANCELLED", "Request cancelled".to_string()),
            LLMError::InvalidConfig(msg) => ("INVALID_CONFIG", msg.clone()),
            LLMError::HttpError { status, message } => ("HTTP_ERROR", format!("{}: {}", status, message)),
        };
        
        let msg = StreamErrorMessage {
            module: "llm",
            msg_type: "stream_error",
            code: code.to_string(),
            message,
            request_id: request_id.map(|s| s.to_string()),
        };
        
        let json = serde_json::to_string(&msg)
            .map_err(|e| LLMError::ParseError(e.to_string()))?;
        
        let mut sender = ws_sender.lock().await;
        sender.send(tokio_tungstenite::tungstenite::Message::Text(json.into())).await
            .map_err(|e| LLMError::NetworkError(e.to_string()))?;
        
        Ok(())
    }
    
    /// 取消流式请求
    /// 
    /// Requirements 4.6: 取消当前流式请求
    async fn cancel_stream(&self) -> Result<(), LLMError> {
        log_info!("取消流式请求");
        
        let mut token = self.cancel_token.lock().await;
        if let Some(cancel_token) = token.take() {
            cancel_token.cancel();
        }
        
        Ok(())
    }
    
    /// 清理资源
    pub async fn cleanup(&self) {
        // 取消任何正在进行的请求
        let _ = self.cancel_stream().await;
    }
}

impl Default for LLMHandler {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// ModuleHandler 实现
// ============================================================================

#[async_trait::async_trait]
impl ModuleHandler for LLMHandler {
    fn module_type(&self) -> ModuleType {
        ModuleType::Llm
    }
    
    async fn handle(&self, msg: &ModuleMessage) -> Result<Option<ServerResponse>, RouterError> {
        log_debug!("处理 LLM 消息: {}", msg.msg_type);
        
        match msg.msg_type.as_str() {
            "stream_start" => {
                // 解析配置
                let config: StreamConfig = serde_json::from_value(msg.payload.clone())
                    .map_err(|e| RouterError::ModuleError(format!("Invalid stream config: {}", e)))?;
                
                // 开始流式请求
                self.start_stream(config).await
                    .map_err(|e| RouterError::ModuleError(e.to_string()))?;
                
                // 返回确认消息
                Ok(Some(ServerResponse::new(
                    ModuleType::Llm,
                    "stream_started",
                    serde_json::json!({}),
                )))
            }
            "stream_cancel" => {
                // 取消流式请求
                self.cancel_stream().await
                    .map_err(|e| RouterError::ModuleError(e.to_string()))?;
                
                Ok(Some(ServerResponse::new(
                    ModuleType::Llm,
                    "stream_cancelled",
                    serde_json::json!({}),
                )))
            }
            _ => {
                Err(RouterError::ModuleError(format!("Unknown LLM message type: {}", msg.msg_type)))
            }
        }
    }
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_stream_config_deserialize() {
        let json = r#"{
            "endpoint": "https://api.example.com/v1/chat/completions",
            "headers": {"Authorization": "Bearer token"},
            "body": "{\"model\":\"gpt-4\"}",
            "api_format": "chat_completions",
            "request_id": "req-123"
        }"#;
        
        let config: StreamConfig = serde_json::from_str(json).unwrap();
        
        assert_eq!(config.endpoint, "https://api.example.com/v1/chat/completions");
        assert_eq!(config.headers.get("Authorization"), Some(&"Bearer token".to_string()));
        assert_eq!(config.api_format, ApiFormat::ChatCompletions);
        assert_eq!(config.request_id, Some("req-123".to_string()));
    }
    
    #[test]
    fn test_stream_config_default_format() {
        let json = r#"{
            "endpoint": "https://api.example.com",
            "body": "{}"
        }"#;
        
        let config: StreamConfig = serde_json::from_str(json).unwrap();
        
        assert_eq!(config.api_format, ApiFormat::ChatCompletions);
        assert!(config.headers.is_empty());
        assert!(config.request_id.is_none());
    }
    
    #[test]
    fn test_llm_handler_creation() {
        let handler = LLMHandler::new();
        assert_eq!(handler.module_type(), ModuleType::Llm);
    }
}
