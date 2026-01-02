// Qwen ASR Realtime 模式实现
// 使用阿里云 DashScope WebSocket API 进行实时流式语音识别

use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose};
use futures_util::{SinkExt, StreamExt, stream::SplitSink};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, mpsc, oneshot};
use tokio::net::TcpStream;
use tokio_tungstenite::{
    connect_async, 
    tungstenite::{Message, http},
    MaybeTlsStream, 
    WebSocketStream
};

use crate::voice::asr::{ASREngine, ASRError, ASRMode, RealtimeSession, RetryConfig};
use crate::voice::audio::AudioData;

const WEBSOCKET_URL: &str = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
const DEFAULT_MODEL: &str = "qwen3-asr-flash-realtime";
const TRANSCRIPTION_TIMEOUT_SECS: u64 = 10;

type WsSink = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;

pub struct QwenRealtimeEngine {
    api_key: String,
    model: String,
    #[allow(dead_code)]
    retry_config: RetryConfig,
}

impl QwenRealtimeEngine {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            model: DEFAULT_MODEL.to_string(),
            retry_config: RetryConfig::default(),
        }
    }
    
    pub fn with_model(mut self, model: String) -> Self {
        self.model = model;
        self
    }
}

#[async_trait]
impl ASREngine for QwenRealtimeEngine {
    fn name(&self) -> &str {
        "qwen"
    }
    
    fn supported_modes(&self) -> Vec<ASRMode> {
        vec![ASRMode::Realtime]
    }
    
    async fn transcribe(&self, _audio: &AudioData) -> Result<String, ASRError> {
        Err(ASRError::UnsupportedOperation(
            "QwenRealtimeEngine 不支持 HTTP 模式，请使用 QwenHttpEngine 或创建 Realtime 会话".to_string()
        ))
    }
    
    async fn create_realtime_session(&self) -> Result<Box<dyn RealtimeSession>, ASRError> {
        let session = QwenRealtimeSession::connect(
            self.api_key.clone(),
            self.model.clone(),
        ).await?;
        
        Ok(Box::new(session))
    }
}

enum SessionCommand {
    SendAudio(Vec<u8>),
    Commit,
    Close,
}

pub struct QwenRealtimeSession {
    cmd_sender: mpsc::Sender<SessionCommand>,
    result_receiver: Option<oneshot::Receiver<Result<String, ASRError>>>,
    partial_callback: Option<Arc<Mutex<Box<dyn Fn(&str) + Send + 'static>>>>,
    #[allow(dead_code)]
    partial_sender: mpsc::Sender<String>,
}

impl QwenRealtimeSession {
    async fn connect(api_key: String, model: String) -> Result<Self, ASRError> {
        let url = format!("{}?model={}", WEBSOCKET_URL, model);
        eprintln!("[INFO] 创建 Qwen Realtime WebSocket 连接: {}", url);
        
        let request = http::Request::builder()
            .uri(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("OpenAI-Beta", "realtime=v1")
            .header("Host", "dashscope.aliyuncs.com")
            .header("Connection", "Upgrade")
            .header("Upgrade", "websocket")
            .header("Sec-WebSocket-Version", "13")
            .header("Sec-WebSocket-Key", generate_websocket_key())
            .body(())
            .map_err(|e| ASRError::WebSocketError(format!("构建请求失败: {}", e)))?;
        
        let (ws_stream, _) = connect_async(request).await
            .map_err(|e| ASRError::WebSocketError(format!("WebSocket 连接失败: {}", e)))?;
        
        eprintln!("[INFO] Qwen Realtime WebSocket 连接成功");
        
        let (mut write, mut read) = ws_stream.split();
        
        let session_update = serde_json::json!({
            "event_id": format!("event_{}", timestamp_ms()),
            "type": "session.update",
            "session": {
                "modalities": ["text"],
                "input_audio_format": "pcm",
                "sample_rate": 16000,
                "input_audio_transcription": {
                    "language": "zh"
                },
                "turn_detection": serde_json::Value::Null
            }
        });
        
        write.send(Message::Text(session_update.to_string().into())).await
            .map_err(|e| ASRError::WebSocketError(format!("发送 session.update 失败: {}", e)))?;
        
        eprintln!("[INFO] 已发送 session.update 配置");
        
        let (cmd_tx, mut cmd_rx) = mpsc::channel::<SessionCommand>(100);
        let (result_tx, result_rx) = oneshot::channel::<Result<String, ASRError>>();
        let (partial_tx, mut partial_rx) = mpsc::channel::<String>(100);
        
        let write: Arc<Mutex<WsSink>> = Arc::new(Mutex::new(write));
        let write_clone = Arc::clone(&write);
        
        tokio::spawn(async move {
            while let Some(cmd) = cmd_rx.recv().await {
                match cmd {
                    SessionCommand::SendAudio(pcm_bytes) => {
                        let encoded = general_purpose::STANDARD.encode(&pcm_bytes);
                        let event = serde_json::json!({
                            "event_id": format!("event_{}", timestamp_ms()),
                            "type": "input_audio_buffer.append",
                            "audio": encoded
                        });
                        
                        let mut w = write_clone.lock().await;
                        if let Err(e) = w.send(Message::Text(event.to_string().into())).await {
                            eprintln!("[ERROR] 发送音频块失败: {}", e);
                            break;
                        }
                    }
                    SessionCommand::Commit => {
                        let event = serde_json::json!({
                            "event_id": format!("event_{}", timestamp_ms()),
                            "type": "input_audio_buffer.commit"
                        });
                        
                        let mut w = write_clone.lock().await;
                        if let Err(e) = w.send(Message::Text(event.to_string().into())).await {
                            eprintln!("[ERROR] 发送 commit 失败: {}", e);
                        }
                        eprintln!("[INFO] 已发送 input_audio_buffer.commit");
                    }
                    SessionCommand::Close => {
                        let mut w = write_clone.lock().await;
                        let _ = w.close().await;
                        break;
                    }
                }
            }
        });
        
        let partial_tx_clone = partial_tx.clone();
        tokio::spawn(async move {
            let mut final_text = String::new();
            let mut has_result = false;
            let mut result_tx = Some(result_tx);
            
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        match serde_json::from_str::<serde_json::Value>(&text) {
                            Ok(data) => {
                                let event_type = data["type"].as_str().unwrap_or("");
                                
                                match event_type {
                                    "session.created" | "session.updated" => {
                                        eprintln!("[INFO] 会话已创建/更新");
                                    }
                                    "input_audio_buffer.committed" => {
                                        eprintln!("[INFO] 音频缓冲区已提交");
                                    }
                                    "conversation.item.input_audio_transcription.completed" => {
                                        if let Some(transcript) = data["transcript"].as_str() {
                                            final_text = transcript.to_string();
                                            has_result = true;
                                            eprintln!("[INFO] 转录完成: {}", final_text);
                                        }
                                    }
                                    "response.audio_transcript.delta" => {
                                        if let Some(delta) = data["delta"].as_str() {
                                            final_text.push_str(delta);
                                            let _ = partial_tx_clone.send(final_text.clone()).await;
                                        }
                                    }
                                    "response.audio_transcript.done" => {
                                        if let Some(transcript) = data["transcript"].as_str() {
                                            final_text = transcript.to_string();
                                        }
                                        has_result = true;
                                        eprintln!("[INFO] 转录完成: {}", final_text);
                                    }
                                    "response.done" => {
                                        has_result = true;
                                    }
                                    "error" => {
                                        let error_msg = data["error"]["message"]
                                            .as_str()
                                            .unwrap_or("未知错误");
                                        eprintln!("[ERROR] API 错误: {}", error_msg);
                                        if let Some(tx) = result_tx.take() {
                                            let _ = tx.send(Err(ASRError::WebSocketError(
                                                format!("API 错误: {}", error_msg)
                                            )));
                                        }
                                        return;
                                    }
                                    _ => {}
                                }
                            }
                            Err(e) => {
                                eprintln!("[WARN] 解析消息失败: {}", e);
                            }
                        }
                    }
                    Ok(Message::Close(_)) => {
                        eprintln!("[INFO] WebSocket 连接关闭");
                        break;
                    }
                    Err(e) => {
                        eprintln!("[ERROR] WebSocket 错误: {}", e);
                        if let Some(tx) = result_tx.take() {
                            let _ = tx.send(Err(ASRError::WebSocketError(
                                format!("WebSocket 错误: {}", e)
                            )));
                        }
                        return;
                    }
                    _ => {}
                }
                
                if has_result && !final_text.is_empty() {
                    let cleaned_text = strip_punctuation(&final_text);
                    if let Some(tx) = result_tx.take() {
                        let _ = tx.send(Ok(cleaned_text));
                    }
                    break;
                }
            }
            
            if !has_result {
                if let Some(tx) = result_tx.take() {
                    let _ = tx.send(Err(ASRError::InternalError("未收到转录结果".to_string())));
                }
            }
        });
        
        let partial_callback: Option<Arc<Mutex<Box<dyn Fn(&str) + Send + 'static>>>> = None;
        let partial_callback_clone = partial_callback.clone();
        tokio::spawn(async move {
            while let Some(text) = partial_rx.recv().await {
                if let Some(ref callback) = partial_callback_clone {
                    let cb = callback.lock().await;
                    cb(&text);
                }
            }
        });
        
        Ok(Self {
            cmd_sender: cmd_tx,
            result_receiver: Some(result_rx),
            partial_callback,
            partial_sender: partial_tx,
        })
    }
}

#[async_trait]
impl RealtimeSession for QwenRealtimeSession {
    async fn send_chunk(&mut self, chunk: &[u8]) -> Result<(), ASRError> {
        self.cmd_sender.send(SessionCommand::SendAudio(chunk.to_vec())).await
            .map_err(|_| ASRError::WebSocketError("发送音频块失败：通道已关闭".to_string()))
    }
    
    async fn commit(&mut self) -> Result<(), ASRError> {
        self.cmd_sender.send(SessionCommand::Commit).await
            .map_err(|_| ASRError::WebSocketError("提交音频失败：通道已关闭".to_string()))
    }
    
    async fn close(&mut self) -> Result<String, ASRError> {
        let _ = self.cmd_sender.send(SessionCommand::Commit).await;
        
        let result_rx = self.result_receiver.take()
            .ok_or_else(|| ASRError::InternalError("会话已关闭".to_string()))?;
        
        let result = tokio::time::timeout(
            Duration::from_secs(TRANSCRIPTION_TIMEOUT_SECS),
            result_rx
        ).await
            .map_err(|_| ASRError::Timeout { timeout_ms: TRANSCRIPTION_TIMEOUT_SECS * 1000 })?
            .map_err(|_| ASRError::InternalError("结果通道已关闭".to_string()))?;
        
        let _ = self.cmd_sender.send(SessionCommand::Close).await;
        
        result
    }
    
    fn set_partial_callback(&mut self, callback: Box<dyn Fn(&str) + Send + 'static>) {
        self.partial_callback = Some(Arc::new(Mutex::new(callback)));
    }
}

fn generate_websocket_key() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    general_purpose::STANDARD.encode(format!("{}", timestamp).as_bytes())
}

fn timestamp_ms() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis()
}

fn strip_punctuation(text: &str) -> String {
    let punctuation = ['。', '，', '！', '？', '、', '；', '：', '"', '"',
                       '.', ',', '!', '?', ';', ':', '"', '\'',
                       '（', '）', '(', ')', '【', '】', '[', ']',
                       '《', '》', '<', '>', '—', '…', '·',
                       '\u{2018}', '\u{2019}'];
    
    text.chars()
        .filter(|c| !punctuation.contains(c))
        .collect()
}
