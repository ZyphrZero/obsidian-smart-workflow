// 配置管理模块
// 定义 ASR 供应商配置和相关数据结构

use serde::{Deserialize, Serialize};

/// ASR 供应商类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ASRProvider {
    /// 阿里云 Qwen
    Qwen,
    /// 豆包 Doubao
    Doubao,
    /// 硅基流动 SenseVoice
    #[serde(rename = "sensevoice")]
    SenseVoice,
}

impl std::fmt::Display for ASRProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ASRProvider::Qwen => write!(f, "qwen"),
            ASRProvider::Doubao => write!(f, "doubao"),
            ASRProvider::SenseVoice => write!(f, "sensevoice"),
        }
    }
}

/// ASR 模式
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ASRMode {
    /// WebSocket 实时模式
    Realtime,
    /// HTTP 上传模式
    Http,
}

impl std::fmt::Display for ASRMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ASRMode::Realtime => write!(f, "realtime"),
            ASRMode::Http => write!(f, "http"),
        }
    }
}

/// ASR 供应商配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ASRProviderConfig {
    /// 供应商类型
    pub provider: ASRProvider,
    /// ASR 模式
    pub mode: ASRMode,
    
    // Qwen 特有配置
    /// DashScope API Key (阿里云)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dashscope_api_key: Option<String>,
    
    // Doubao 特有配置
    /// 应用 ID (豆包)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    /// 访问令牌 (豆包)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    
    // SenseVoice 特有配置
    /// 硅基流动 API Key
    #[serde(skip_serializing_if = "Option::is_none")]
    pub siliconflow_api_key: Option<String>,
}

impl ASRProviderConfig {
    /// 创建 Qwen 配置
    pub fn qwen(mode: ASRMode, api_key: String) -> Self {
        Self {
            provider: ASRProvider::Qwen,
            mode,
            dashscope_api_key: Some(api_key),
            app_id: None,
            access_token: None,
            siliconflow_api_key: None,
        }
    }
    
    /// 创建 Doubao 配置
    pub fn doubao(mode: ASRMode, app_id: String, access_token: String) -> Self {
        Self {
            provider: ASRProvider::Doubao,
            mode,
            dashscope_api_key: None,
            app_id: Some(app_id),
            access_token: Some(access_token),
            siliconflow_api_key: None,
        }
    }
    
    /// 创建 SenseVoice 配置 (仅支持 HTTP 模式)
    pub fn sensevoice(api_key: String) -> Self {
        Self {
            provider: ASRProvider::SenseVoice,
            mode: ASRMode::Http, // SenseVoice 仅支持 HTTP
            dashscope_api_key: None,
            app_id: None,
            access_token: None,
            siliconflow_api_key: Some(api_key),
        }
    }
    
    /// 验证配置是否完整
    pub fn validate(&self) -> Result<(), ConfigError> {
        match self.provider {
            ASRProvider::Qwen => {
                if self.dashscope_api_key.as_ref().map_or(true, |k| k.is_empty()) {
                    return Err(ConfigError::MissingApiKey("dashscope_api_key".to_string()));
                }
            }
            ASRProvider::Doubao => {
                if self.app_id.as_ref().map_or(true, |k| k.is_empty()) {
                    return Err(ConfigError::MissingApiKey("app_id".to_string()));
                }
                if self.access_token.as_ref().map_or(true, |k| k.is_empty()) {
                    return Err(ConfigError::MissingApiKey("access_token".to_string()));
                }
            }
            ASRProvider::SenseVoice => {
                if self.siliconflow_api_key.as_ref().map_or(true, |k| k.is_empty()) {
                    return Err(ConfigError::MissingApiKey("siliconflow_api_key".to_string()));
                }
                // SenseVoice 仅支持 HTTP 模式
                if self.mode != ASRMode::Http {
                    return Err(ConfigError::UnsupportedMode {
                        provider: self.provider.to_string(),
                        mode: self.mode.to_string(),
                    });
                }
            }
        }
        Ok(())
    }
}

/// 完整 ASR 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ASRConfig {
    /// 主 ASR 引擎配置
    pub primary: ASRProviderConfig,
    /// 备用 ASR 引擎配置
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback: Option<ASRProviderConfig>,
    /// 是否启用自动兜底
    pub enable_fallback: bool,
}

impl ASRConfig {
    /// 创建仅主引擎的配置
    pub fn primary_only(primary: ASRProviderConfig) -> Self {
        Self {
            primary,
            fallback: None,
            enable_fallback: false,
        }
    }
    
    /// 创建带兜底的配置
    pub fn with_fallback(primary: ASRProviderConfig, fallback: ASRProviderConfig) -> Self {
        Self {
            primary,
            fallback: Some(fallback),
            enable_fallback: true,
        }
    }
    
    /// 验证配置
    pub fn validate(&self) -> Result<(), ConfigError> {
        self.primary.validate()?;
        if let Some(ref fallback) = self.fallback {
            fallback.validate()?;
        }
        Ok(())
    }
}

/// 配置错误
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("缺少必需的 API Key: {0}")]
    MissingApiKey(String),
    
    #[error("供应商 {provider} 不支持 {mode} 模式")]
    UnsupportedMode {
        provider: String,
        mode: String,
    },
    
    #[error("无效的配置: {0}")]
    InvalidConfig(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_qwen_config_validation() {
        let config = ASRProviderConfig::qwen(ASRMode::Realtime, "test-key".to_string());
        assert!(config.validate().is_ok());
        
        let invalid_config = ASRProviderConfig {
            provider: ASRProvider::Qwen,
            mode: ASRMode::Realtime,
            dashscope_api_key: None,
            app_id: None,
            access_token: None,
            siliconflow_api_key: None,
        };
        assert!(invalid_config.validate().is_err());
    }

    #[test]
    fn test_doubao_config_validation() {
        let config = ASRProviderConfig::doubao(
            ASRMode::Realtime, 
            "app-123".to_string(), 
            "token-456".to_string()
        );
        assert!(config.validate().is_ok());
        
        // 缺少 app_id 应该失败
        let invalid_config = ASRProviderConfig {
            provider: ASRProvider::Doubao,
            mode: ASRMode::Realtime,
            dashscope_api_key: None,
            app_id: None,
            access_token: Some("token".to_string()),
            siliconflow_api_key: None,
        };
        assert!(invalid_config.validate().is_err());
    }

    #[test]
    fn test_sensevoice_mode_validation() {
        // SenseVoice 仅支持 HTTP 模式
        let mut config = ASRProviderConfig::sensevoice("test-key".to_string());
        assert!(config.validate().is_ok());
        
        // 尝试使用 Realtime 模式应该失败
        config.mode = ASRMode::Realtime;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_asr_config_serialization() {
        let config = ASRConfig::with_fallback(
            ASRProviderConfig::qwen(ASRMode::Realtime, "qwen-key".to_string()),
            ASRProviderConfig::sensevoice("sensevoice-key".to_string()),
        );
        
        let json = serde_json::to_string(&config).unwrap();
        let parsed: ASRConfig = serde_json::from_str(&json).unwrap();
        
        assert_eq!(parsed.primary.provider, ASRProvider::Qwen);
        assert!(parsed.fallback.is_some());
        assert!(parsed.enable_fallback);
    }

    #[test]
    fn test_asr_config_from_json() {
        // 测试从 TypeScript 端发送的 JSON 格式反序列化
        let json = r#"{
            "primary": {
                "provider": "qwen",
                "mode": "realtime",
                "dashscope_api_key": "sk-xxx"
            },
            "fallback": {
                "provider": "sensevoice",
                "mode": "http",
                "siliconflow_api_key": "sf-xxx"
            },
            "enable_fallback": true
        }"#;
        
        let config: ASRConfig = serde_json::from_str(json).unwrap();
        
        assert_eq!(config.primary.provider, ASRProvider::Qwen);
        assert_eq!(config.primary.mode, ASRMode::Realtime);
        assert_eq!(config.primary.dashscope_api_key, Some("sk-xxx".to_string()));
        
        let fallback = config.fallback.unwrap();
        assert_eq!(fallback.provider, ASRProvider::SenseVoice);
        assert_eq!(fallback.mode, ASRMode::Http);
        assert_eq!(fallback.siliconflow_api_key, Some("sf-xxx".to_string()));
        
        assert!(config.enable_fallback);
    }

    #[test]
    fn test_primary_only_config() {
        let config = ASRConfig::primary_only(
            ASRProviderConfig::qwen(ASRMode::Http, "test-key".to_string())
        );
        
        assert!(config.fallback.is_none());
        assert!(!config.enable_fallback);
        assert!(config.validate().is_ok());
    }
}
