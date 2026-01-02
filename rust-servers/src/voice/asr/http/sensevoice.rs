// SenseVoice ASR HTTP 模式实现
// 使用硅基流动 (SiliconFlow) API 进行语音识别

use async_trait::async_trait;
use std::time::{Duration, Instant};

use crate::voice::asr::{ASREngine, ASRError, ASRMode, RealtimeSession, RetryConfig};
use crate::voice::audio::AudioData;

const SILICONFLOW_API_URL: &str = "https://api.siliconflow.cn/v1/audio/transcriptions";
const DEFAULT_MODEL: &str = "FunAudioLLM/SenseVoiceSmall";

pub struct SenseVoiceHttpEngine {
    api_key: String,
    client: reqwest::Client,
    retry_config: RetryConfig,
    model: String,
}

impl SenseVoiceHttpEngine {
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
        
        eprintln!("[INFO] SenseVoice ASR: 音频数据大小 {} bytes", wav_data.len());
        
        let file_part = reqwest::multipart::Part::bytes(wav_data)
            .file_name("audio.wav")
            .mime_str("audio/wav")
            .map_err(|e| ASRError::InternalError(format!("创建文件部分失败: {}", e)))?;
        
        let form = reqwest::multipart::Form::new()
            .part("file", file_part)
            .text("model", self.model.clone());
        
        let response = self.client
            .post(SILICONFLOW_API_URL)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .multipart(form)
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
                401 => Err(ASRError::AuthFailed {
                    engine: "sensevoice".to_string(),
                    message: error_text,
                }),
                429 => Err(ASRError::QuotaExceeded {
                    engine: "sensevoice".to_string(),
                }),
                404 => Err(ASRError::ConfigError(format!(
                    "模型不存在或服务不可用: {}",
                    error_text
                ))),
                503 | 504 => Err(ASRError::NetworkError(format!(
                    "服务暂时不可用 ({}): {}",
                    status, error_text
                ))),
                _ => Err(ASRError::NetworkError(format!(
                    "API 请求失败 ({}): {}",
                    status, error_text
                ))),
            };
        }
        
        let result: SenseVoiceResponse = response.json().await
            .map_err(|e| ASRError::InternalError(format!("解析响应失败: {}", e)))?;
        
        eprintln!("[DEBUG] SenseVoice ASR 响应: text={}", result.text);
        
        let mut text = result.text;
        strip_trailing_punctuation(&mut text);
        
        Ok(text)
    }
}

#[derive(Debug, serde::Deserialize)]
struct SenseVoiceResponse {
    text: String,
}

#[async_trait]
impl ASREngine for SenseVoiceHttpEngine {
    fn name(&self) -> &str {
        "sensevoice"
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
                    eprintln!("[INFO] SenseVoice HTTP 转录成功，耗时 {}ms: {}", duration, text);
                    return Ok(text);
                }
                Err(e) => {
                    eprintln!(
                        "[WARN] SenseVoice HTTP 转录失败 (尝试 {}/{}): {}",
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
            "SenseVoice 不支持 Realtime 模式，仅支持 HTTP 模式".to_string()
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
