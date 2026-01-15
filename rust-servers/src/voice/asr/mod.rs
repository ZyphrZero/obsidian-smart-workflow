// ASR (自动语音识别) 模块
// 包含 ASR 引擎抽象层和各供应商实现

use async_trait::async_trait;
use crate::voice::audio::AudioData;
use crate::voice::config::{ASRProviderConfig, ASRProvider, ASRMode as ConfigASRMode};

pub mod http;
pub mod realtime;
pub mod realtime_task;
pub mod fallback;

pub use http::QwenHttpEngine;
pub use http::DoubaoHttpEngine;
pub use http::SenseVoiceHttpEngine;
pub use realtime::QwenRealtimeEngine;
pub use realtime::DoubaoRealtimeEngine;
pub use realtime_task::{RealtimeTranscriptionTask, PartialResultCallback, RealtimeTaskResult};
pub use fallback::{FallbackStrategy, ParallelFallbackStrategy, RaceStrategy};

// ============================================================================
// 错误类型
// ============================================================================

#[derive(Debug, Clone, thiserror::Error)]
pub enum ASRError {
    #[error("网络错误: {0}")]
    NetworkError(String),
    
    #[error("认证失败 ({engine}): {message}")]
    AuthFailed {
        engine: String,
        message: String,
    },
    
    #[error("配额超限 ({engine})")]
    QuotaExceeded {
        engine: String,
    },
    
    #[error("无效的音频格式: {0}")]
    InvalidAudio(String),
    
    #[error("请求超时 ({timeout_ms}ms)")]
    Timeout {
        timeout_ms: u64,
    },
    
    #[error("WebSocket 错误: {0}")]
    WebSocketError(String),
    
    #[error("所有 ASR 引擎失败: 主引擎={primary_error}, 备用引擎={fallback_error:?}")]
    AllEnginesFailed {
        primary_error: String,
        fallback_error: Option<String>,
    },
    
    #[error("引擎未初始化")]
    NotInitialized,
    
    #[error("不支持的操作: {0}")]
    UnsupportedOperation(String),
    
    #[error("配置错误: {0}")]
    ConfigError(String),
    
    #[error("内部错误: {0}")]
    InternalError(String),
}

// ============================================================================
// ASR 模式
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ASRMode {
    Realtime,
    Http,
}

impl From<ConfigASRMode> for ASRMode {
    fn from(mode: ConfigASRMode) -> Self {
        match mode {
            ConfigASRMode::Realtime => ASRMode::Realtime,
            ConfigASRMode::Http => ASRMode::Http,
        }
    }
}

impl std::fmt::Display for ASRMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ASRMode::Realtime => write!(f, "realtime"),
            ASRMode::Http => write!(f, "http"),
        }
    }
}

// ============================================================================
// 转录结果
// ============================================================================

#[derive(Debug, Clone, serde::Serialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub engine: String,
    pub used_fallback: bool,
    pub duration_ms: u64,
}

impl TranscriptionResult {
    pub fn new(text: String, engine: String, used_fallback: bool, duration_ms: u64) -> Self {
        Self {
            text,
            engine,
            used_fallback,
            duration_ms,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PartialTranscription {
    pub text: String,
    pub is_final: bool,
}

impl PartialTranscription {
    pub fn new(text: String, is_final: bool) -> Self {
        Self { text, is_final }
    }
}

// ============================================================================
// ASR 引擎 Trait
// ============================================================================

#[async_trait]
pub trait ASREngine: Send + Sync {
    fn name(&self) -> &str;
    fn supported_modes(&self) -> Vec<ASRMode>;
    
    fn supports_mode(&self, mode: ASRMode) -> bool {
        self.supported_modes().contains(&mode)
    }
    
    async fn transcribe(&self, audio: &AudioData) -> Result<String, ASRError>;
    async fn create_realtime_session(&self) -> Result<Box<dyn RealtimeSession>, ASRError>;
}

// ============================================================================
// 实时会话 Trait
// ============================================================================

#[async_trait]
pub trait RealtimeSession: Send {
    async fn send_chunk(&mut self, chunk: &[u8]) -> Result<(), ASRError>;
    
    async fn commit(&mut self) -> Result<(), ASRError> {
        Ok(())
    }
    
    async fn close(&mut self) -> Result<String, ASRError>;
    fn set_partial_callback(&mut self, callback: Box<dyn Fn(&str) + Send + 'static>);
}

// ============================================================================
// 重试配置
// ============================================================================

#[derive(Debug, Clone)]
pub struct RetryConfig {
    pub max_retries: u32,
    pub base_delay_ms: u64,
    pub timeout_ms: u64,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: 2,
            base_delay_ms: 500,
            timeout_ms: 6000,
        }
    }
}

// ============================================================================
// 引擎工厂
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineType {
    Qwen,
    Doubao,
    SenseVoice,
}

impl From<ASRProvider> for EngineType {
    fn from(provider: ASRProvider) -> Self {
        match provider {
            ASRProvider::Qwen => EngineType::Qwen,
            ASRProvider::Doubao => EngineType::Doubao,
            ASRProvider::SenseVoice => EngineType::SenseVoice,
        }
    }
}

impl std::fmt::Display for EngineType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EngineType::Qwen => write!(f, "qwen"),
            EngineType::Doubao => write!(f, "doubao"),
            EngineType::SenseVoice => write!(f, "sensevoice"),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct EngineCredentials {
    pub api_key: Option<String>,
    pub app_id: Option<String>,
    pub access_token: Option<String>,
}

impl EngineCredentials {
    pub fn with_api_key(api_key: String) -> Self {
        Self {
            api_key: Some(api_key),
            ..Default::default()
        }
    }
    
    pub fn with_doubao(app_id: String, access_token: String) -> Self {
        Self {
            app_id: Some(app_id),
            access_token: Some(access_token),
            ..Default::default()
        }
    }
}

/// 创建 ASR 引擎
pub fn create_engine(config: &ASRProviderConfig) -> Result<Box<dyn ASREngine>, ASRError> {
    config.validate().map_err(|e| ASRError::ConfigError(e.to_string()))?;
    
    let engine_type = EngineType::from(config.provider.clone());
    let mode = ASRMode::from(config.mode.clone());
    
    match engine_type {
        EngineType::Qwen => {
            let api_key = config.dashscope_api_key.clone()
                .ok_or_else(|| ASRError::ConfigError("缺少 dashscope_api_key".to_string()))?;
            
            match mode {
                ASRMode::Http => Ok(Box::new(QwenHttpEngine::new(api_key))),
                ASRMode::Realtime => Ok(Box::new(QwenRealtimeEngine::new(api_key))),
            }
        }
        EngineType::Doubao => {
            let app_id = config.app_id.clone()
                .ok_or_else(|| ASRError::ConfigError("缺少 app_id".to_string()))?;
            let access_token = config.access_token.clone()
                .ok_or_else(|| ASRError::ConfigError("缺少 access_token".to_string()))?;
            
            match mode {
                ASRMode::Http => Ok(Box::new(DoubaoHttpEngine::new(app_id, access_token))),
                ASRMode::Realtime => Ok(Box::new(DoubaoRealtimeEngine::new(app_id, access_token))),
            }
        }
        EngineType::SenseVoice => {
            let api_key = config.siliconflow_api_key.clone()
                .ok_or_else(|| ASRError::ConfigError("缺少 siliconflow_api_key".to_string()))?;
            Ok(Box::new(SenseVoiceHttpEngine::new(api_key)))
        }
    }
}

/// 根据引擎类型创建引擎
pub fn create_engine_by_type(
    engine_type: EngineType,
    credentials: EngineCredentials,
    mode: ASRMode,
) -> Result<Box<dyn ASREngine>, ASRError> {
    match engine_type {
        EngineType::Qwen => {
            let api_key = credentials.api_key
                .ok_or_else(|| ASRError::ConfigError("缺少 API Key".to_string()))?;
            
            match mode {
                ASRMode::Http => Ok(Box::new(QwenHttpEngine::new(api_key))),
                ASRMode::Realtime => Ok(Box::new(QwenRealtimeEngine::new(api_key))),
            }
        }
        EngineType::Doubao => {
            let app_id = credentials.app_id
                .ok_or_else(|| ASRError::ConfigError("缺少 app_id".to_string()))?;
            let access_token = credentials.access_token
                .ok_or_else(|| ASRError::ConfigError("缺少 access_token".to_string()))?;
            
            match mode {
                ASRMode::Http => Ok(Box::new(DoubaoHttpEngine::new(app_id, access_token))),
                ASRMode::Realtime => Ok(Box::new(DoubaoRealtimeEngine::new(app_id, access_token))),
            }
        }
        EngineType::SenseVoice => {
            let api_key = credentials.api_key
                .ok_or_else(|| ASRError::ConfigError("缺少 API Key".to_string()))?;
            Ok(Box::new(SenseVoiceHttpEngine::new(api_key)))
        }
    }
}
