// Qwen ASR HTTP 模式实现
// 使用阿里云 DashScope API 进行语音识别

use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose};
use std::time::{Duration, Instant};

use crate::voice::asr::{ASREngine, ASRError, ASRMode, RealtimeSession, RetryConfig};
use crate::voice::audio::AudioData;

const QWEN_API_URL: &str = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
const DEFAULT_MODEL: &str = "qwen3-asr-flash";

pub struct QwenHttpEngine {
    api_key: String,
    client: reqwest::Client,
    retry_config: RetryConfig,
    model: String,
}

impl QwenHttpEngine {
    pub fn new(api_key: String) -> Self {
        Self::with_config(api_key, RetryConfig::default())
    }
    
    pub fn with_config(api_key: String, retry_config: RetryConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(retry_config.timeout_ms))
            .build()
            .unwrap_or_default();
        
        Self {
            api_key,
            client,
            retry_config,
            model: DEFAULT_MODEL.to_string(),
        }
    }
    
    pub fn with_model(mut self, model: String) -> Self {
        self.model = model;
        self
    }
    
    async fn transcribe_once(&self, audio: &AudioData) -> Result<String, ASRError> {
        let wav_data = audio.to_wav()
            .map_err(|e| ASRError::InvalidAudio(e.to_string()))?;
        
        let audio_base64 = general_purpose::STANDARD.encode(&wav_data);
        
        let request_body = serde_json::json!({
            "model": self.model,
            "input": {
                "messages": [
                    {
                        "role": "system",
                        "content": [{"text": ""}]
                    },
                    {
                        "role": "user",
                        "content": [{
                            "audio": format!("data:audio/wav;base64,{}", audio_base64)
                        }]
                    }
                ]
            },
            "parameters": {
                "result_format": "message",
                "enable_itn": false,
                "disfluency_removal": true,
                "language": "zh"
            }
        });
        
        let response = self.client
            .post(QWEN_API_URL)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    ASRError::Timeout { timeout_ms: self.retry_config.timeout_ms }
                } else {
                    ASRError::NetworkError(e.to_string())
                }
            })?;
        
        let status = response.status();
        
        if !status.is_success() {
            let error_text = response.text().await
                .unwrap_or_else(|_| "无法读取错误响应".to_string());
            
            return match status.as_u16() {
                401 | 403 => Err(ASRError::AuthFailed {
                    engine: "qwen".to_string(),
                    message: error_text,
                }),
                429 => Err(ASRError::QuotaExceeded {
                    engine: "qwen".to_string(),
                }),
                _ => Err(ASRError::NetworkError(format!(
                    "API 请求失败 ({}): {}",
                    status, error_text
                ))),
            };
        }
        
        let result: serde_json::Value = response.json().await
            .map_err(|e| ASRError::InternalError(format!("解析响应失败: {}", e)))?;
        
        let text = result["output"]["choices"]
            .as_array()
            .and_then(|arr| arr.first())
            .and_then(|choice| choice["message"]["content"].as_array())
            .and_then(|content| content.first())
            .and_then(|item| item["text"].as_str())
            .ok_or_else(|| ASRError::InternalError(format!(
                "无法解析转录结果，响应格式: {:?}",
                result
            )))?;
        
        let mut text = text.to_string();
        strip_trailing_punctuation(&mut text);
        
        Ok(text)
    }
}

#[async_trait]
impl ASREngine for QwenHttpEngine {
    fn name(&self) -> &str {
        "qwen"
    }
    
    fn supported_modes(&self) -> Vec<ASRMode> {
        vec![ASRMode::Http]
    }
    
    async fn transcribe(&self, audio: &AudioData) -> Result<String, ASRError> {
        if audio.is_empty() {
            return Err(ASRError::InvalidAudio("音频数据为空".to_string()));
        }
        
        let start_time = Instant::now();
        let mut last_error = None;
        
        for attempt in 0..=self.retry_config.max_retries {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(
                    self.retry_config.base_delay_ms * (1 << (attempt - 1))
                )).await;
            }
            
            match self.transcribe_once(audio).await {
                Ok(text) => {
                    let duration = start_time.elapsed().as_millis() as u64;
                    eprintln!("[INFO] Qwen HTTP 转录成功，耗时 {}ms", duration);
                    return Ok(text);
                }
                Err(e) => {
                    eprintln!(
                        "[WARN] Qwen HTTP 转录失败 (尝试 {}/{}): {}",
                        attempt + 1,
                        self.retry_config.max_retries + 1,
                        e
                    );
                    last_error = Some(e);
                }
            }
        }
        
        Err(last_error.unwrap_or_else(|| ASRError::InternalError("转录失败，未知错误".to_string())))
    }
    
    async fn create_realtime_session(&self) -> Result<Box<dyn RealtimeSession>, ASRError> {
        Err(ASRError::UnsupportedOperation(
            "QwenHttpEngine 不支持 Realtime 模式，请使用 QwenRealtimeEngine".to_string()
        ))
    }
}

fn strip_trailing_punctuation(text: &mut String) {
    let punctuation = ['。', '，', '！', '？', '、', '；', '：', '"', '"',
                       '.', ',', '!', '?', ';', ':', '"', '\'',
                       '（', '）', '(', ')', '【', '】', '[', ']',
                       '《', '》', '<', '>', '—', '…', '·'];
    
    while let Some(c) = text.chars().last() {
        if punctuation.contains(&c) {
            text.pop();
        } else {
            break;
        }
    }
}
