// Doubao ASR HTTP 模式实现
// 使用字节跳动豆包 API 进行语音识别

use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose};
use std::time::{Duration, Instant};

use crate::voice::asr::{ASREngine, ASRError, ASRMode, RealtimeSession, RetryConfig};
use crate::voice::audio::AudioData;

const DOUBAO_API_URL: &str = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
const RESOURCE_ID: &str = "volc.bigasr.auc_turbo";

pub struct DoubaoHttpEngine {
    app_id: String,
    access_key: String,
    client: reqwest::Client,
    retry_config: RetryConfig,
}

impl DoubaoHttpEngine {
    pub fn new(app_id: String, access_key: String) -> Self {
        Self::with_config(app_id, access_key, RetryConfig::default())
    }
    
    pub fn with_config(app_id: String, access_key: String, retry_config: RetryConfig) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(retry_config.timeout_ms))
            .build()
            .unwrap_or_default();
        
        Self {
            app_id,
            access_key,
            client,
            retry_config,
        }
    }
    
    async fn transcribe_once(&self, audio: &AudioData) -> Result<String, ASRError> {
        let wav_data = audio.to_wav()
            .map_err(|e| ASRError::InvalidAudio(e.to_string()))?;
        
        let audio_base64 = general_purpose::STANDARD.encode(&wav_data);
        
        eprintln!("[INFO] 豆包 ASR: 音频数据大小 {} bytes", wav_data.len());
        
        let request_body = serde_json::json!({
            "user": {
                "uid": &self.app_id
            },
            "audio": {
                "data": audio_base64
            },
            "request": {
                "model_name": "bigmodel"
            }
        });
        
        let request_id = generate_request_id();
        
        let response = self.client
            .post(DOUBAO_API_URL)
            .header("X-Api-App-Key", &self.app_id)
            .header("X-Api-Access-Key", &self.access_key)
            .header("X-Api-Resource-Id", RESOURCE_ID)
            .header("X-Api-Request-Id", &request_id)
            .header("X-Api-Sequence", "-1")
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
        
        let status_code = response
            .headers()
            .get("X-Api-Status-Code")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        
        let api_message = response
            .headers()
            .get("X-Api-Message")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        
        eprintln!("[INFO] 豆包 ASR 响应: status_code={}, message={}", status_code, api_message);
        
        if status_code != "20000000" {
            return match status_code {
                "40100001" | "40100002" | "40300001" => Err(ASRError::AuthFailed {
                    engine: "doubao".to_string(),
                    message: api_message.to_string(),
                }),
                "42900001" => Err(ASRError::QuotaExceeded {
                    engine: "doubao".to_string(),
                }),
                _ => Err(ASRError::NetworkError(format!(
                    "豆包 ASR 失败 ({}): {}",
                    status_code, api_message
                ))),
            };
        }
        
        let result: serde_json::Value = response.json().await
            .map_err(|e| ASRError::InternalError(format!("解析响应失败: {}", e)))?;
        
        eprintln!("[DEBUG] 豆包 ASR 响应体: {}", serde_json::to_string_pretty(&result).unwrap_or_default());
        
        let text = result["result"]["text"]
            .as_str()
            .ok_or_else(|| ASRError::InternalError(format!(
                "无法解析豆包转录结果，响应格式: {:?}",
                result
            )))?;
        
        let mut text = text.to_string();
        strip_trailing_punctuation(&mut text);
        
        Ok(text)
    }
}

#[async_trait]
impl ASREngine for DoubaoHttpEngine {
    fn name(&self) -> &str {
        "doubao"
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
                    eprintln!("[INFO] 豆包 HTTP 转录成功，耗时 {}ms: {}", duration, text);
                    return Ok(text);
                }
                Err(e) => {
                    eprintln!(
                        "[WARN] 豆包 HTTP 转录失败 (尝试 {}/{}): {}",
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
            "DoubaoHttpEngine 不支持 Realtime 模式，请使用 DoubaoRealtimeEngine".to_string()
        ))
    }
}

fn generate_request_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("req_{}", timestamp)
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
