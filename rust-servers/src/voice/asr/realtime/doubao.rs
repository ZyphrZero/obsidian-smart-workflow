// Doubao ASR Realtime 模式实现
// 使用字节跳动豆包 WebSocket API 进行实时流式语音识别（二进制协议）

use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose};
use flate2::{write::GzEncoder, read::GzDecoder, Compression};
use futures_util::{SinkExt, StreamExt, stream::SplitSink};
use std::io::{Write, Read};
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

const WEBSOCKET_URL: &str = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream";
const RESOURCE_ID: &str = "volc.seedasr.sauc.duration";
const TRANSCRIPTION_TIMEOUT_SECS: u64 = 10;

type WsSink = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;

pub struct DoubaoRealtimeEngine {
    app_id: String,
    access_key: String,
    #[allow(dead_code)]
    retry_config: RetryConfig,
}

impl DoubaoRealtimeEngine {
    pub fn new(app_id: String, access_key: String) -> Self {
        Self {
            app_id,
            access_key,
            retry_config: RetryConfig::default(),
        }
    }
}

#[async_trait]
impl ASREngine for DoubaoRealtimeEngine {
    fn name(&self) -> &str {
        "doubao"
    }
    
    fn supported_modes(&self) -> Vec<ASRMode> {
        vec![ASRMode::Realtime]
    }
    
    async fn transcribe(&self, _audio: &AudioData) -> Result<String, ASRError> {
        Err(ASRError::UnsupportedOperation(
            "DoubaoRealtimeEngine 不支持 HTTP 模式，请使用 DoubaoHttpEngine 或创建 Realtime 会话".to_string()
        ))
    }
    
    async fn create_realtime_session(&self) -> Result<Box<dyn RealtimeSession>, ASRError> {
        let session = DoubaoRealtimeSession::connect(
            self.app_id.clone(),
            self.access_key.clone(),
        ).await?;
        
        Ok(Box::new(session))
    }
}

enum SessionCommand {
    SendAudio(Vec<u8>),
    Finish,
}

pub struct DoubaoRealtimeSession {
    cmd_sender: mpsc::Sender<SessionCommand>,
    result_receiver: Option<oneshot::Receiver<Result<String, ASRError>>>,
    partial_callback: Option<Arc<Mutex<Box<dyn Fn(&str) + Send + 'static>>>>,
}

impl DoubaoRealtimeSession {
    async fn connect(app_id: String, access_key: String) -> Result<Self, ASRError> {
        let websocket_key = generate_websocket_key();
        let request_id = generate_request_id();
        
        eprintln!("[INFO] 创建豆包 Realtime WebSocket 连接");
        
        let request = http::Request::builder()
            .uri(WEBSOCKET_URL)
            .header("Host", "openspeech.bytedance.com")
            .header("Connection", "Upgrade")
            .header("Upgrade", "websocket")
            .header("Sec-WebSocket-Version", "13")
            .header("Sec-WebSocket-Key", &websocket_key)
            .header("X-Api-App-Key", &app_id)
            .header("X-Api-Access-Key", &access_key)
            .header("X-Api-Resource-Id", RESOURCE_ID)
            .header("X-Api-Connect-Id", &request_id)
            .body(())
            .map_err(|e| ASRError::WebSocketError(format!("构建请求失败: {}", e)))?;
        
        let (ws_stream, _) = connect_async(request).await
            .map_err(|e| ASRError::WebSocketError(format!("WebSocket 连接失败: {}", e)))?;
        
        eprintln!("[INFO] 豆包 Realtime WebSocket 连接成功");
        
        let (mut write, mut read) = ws_stream.split();
        
        let config = serde_json::json!({
            "user": {"uid": &app_id},
            "audio": {"format": "pcm", "rate": 16000, "bits": 16, "channel": 1},
            "request": {"model_name": "bigmodel", "enable_itn": true, "enable_punc": true}
        });
        
        eprintln!("[DEBUG] 豆包 Full Client Request: {}", serde_json::to_string_pretty(&config).unwrap_or_default());
        
        let msg = build_message(0x1, 0x1, 1, &serde_json::to_vec(&config)
            .map_err(|e| ASRError::InternalError(format!("序列化配置失败: {}", e)))?, 0x1)?;
        
        write.send(Message::Binary(msg.clone().into())).await
            .map_err(|e| ASRError::WebSocketError(format!("发送 Full Client Request 失败: {}", e)))?;
        
        eprintln!("[DEBUG] 豆包 Full Client Request 已发送: {} bytes", msg.len());
        
        if let Some(response) = read.next().await {
            match response {
                Ok(Message::Binary(data)) => {
                    eprintln!("[DEBUG] 豆包 Full Client Request 响应: {} bytes", data.len());
                    match parse_response(&data) {
                        Ok((text, _is_last)) => {
                            if !text.is_empty() {
                                eprintln!("[DEBUG] 豆包初始响应包含文本（意外）: {}", text);
                            }
                        }
                        Err(e) => {
                            eprintln!("[DEBUG] 豆包初始响应（预期无文本）: {}", e);
                        }
                    }
                }
                Ok(other) => {
                    eprintln!("[WARN] 豆包 Full Client Request 收到非二进制响应: {:?}", other);
                }
                Err(e) => {
                    return Err(ASRError::WebSocketError(format!(
                        "豆包 Full Client Request 响应错误: {}", e
                    )));
                }
            }
        }
        
        let (cmd_tx, mut cmd_rx) = mpsc::channel::<SessionCommand>(100);
        let (result_tx, result_rx) = oneshot::channel::<Result<String, ASRError>>();
        let (partial_tx, mut partial_rx) = mpsc::channel::<String>(100);
        
        let write: Arc<Mutex<WsSink>> = Arc::new(Mutex::new(write));
        let write_clone = Arc::clone(&write);
        
        tokio::spawn(async move {
            let mut sequence = 1i32;
            
            while let Some(cmd) = cmd_rx.recv().await {
                match cmd {
                    SessionCommand::SendAudio(audio) => {
                        sequence += 1;
                        match build_message(0x2, 0x1, sequence, &audio, 0x0) {
                            Ok(msg) => {
                                let mut w = write_clone.lock().await;
                                if let Err(e) = w.send(Message::Binary(msg.into())).await {
                                    eprintln!("[ERROR] 豆包发送音频块失败: {}", e);
                                    break;
                                }
                            }
                            Err(e) => {
                                eprintln!("[ERROR] 豆包构建音频消息失败: {}", e);
                            }
                        }
                    }
                    SessionCommand::Finish => {
                        sequence += 1;
                        let last_seq = -sequence;
                        eprintln!("[DEBUG] 豆包发送结束标志，sequence={}", last_seq);
                        
                        match build_message(0x2, 0x3, last_seq, &[], 0x0) {
                            Ok(msg) => {
                                let mut w = write_clone.lock().await;
                                if let Err(e) = w.send(Message::Binary(msg.into())).await {
                                    eprintln!("[ERROR] 豆包发送结束标志失败: {}", e);
                                }
                            }
                            Err(e) => {
                                eprintln!("[ERROR] 豆包构建结束消息失败: {}", e);
                            }
                        }
                        break;
                    }
                }
            }
        });
        
        let partial_tx_clone = partial_tx.clone();
        tokio::spawn(async move {
            let mut accumulated_text = String::new();
            let mut result_tx = Some(result_tx);
            
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(Message::Binary(data)) => {
                        eprintln!("[DEBUG] 豆包 WebSocket 收到二进制消息: {} bytes", data.len());
                        match parse_response(&data) {
                            Ok((text, is_final)) => {
                                if !text.is_empty() {
                                    accumulated_text = text.clone();
                                    eprintln!("[DEBUG] 豆包累积文本: {}", accumulated_text);
                                    let _ = partial_tx_clone.send(accumulated_text.clone()).await;
                                }
                                if is_final {
                                    let final_text = accumulated_text.clone();
                                    eprintln!("[INFO] 豆包流式转录结果（最终包）: {}", final_text);
                                    if let Some(tx) = result_tx.take() {
                                        let _ = tx.send(Ok(final_text));
                                    }
                                    break;
                                }
                            }
                            Err(e) => {
                                eprintln!("[DEBUG] 豆包响应解析（非最终结果）: {}", e);
                            }
                        }
                    }
                    Ok(Message::Close(frame)) => {
                        eprintln!("[WARN] 豆包 WebSocket 连接关闭: {:?}", frame);
                        if !accumulated_text.is_empty() {
                            eprintln!("[INFO] 豆包连接关闭，返回累积文本: {}", accumulated_text);
                            if let Some(tx) = result_tx.take() {
                                let _ = tx.send(Ok(accumulated_text.clone()));
                            }
                        } else {
                            eprintln!("[WARN] 豆包连接关闭，无转录结果");
                            if let Some(tx) = result_tx.take() {
                                let _ = tx.send(Err(ASRError::WebSocketError(
                                    "WebSocket 连接被关闭".to_string()
                                )));
                            }
                        }
                        break;
                    }
                    Ok(other) => {
                        eprintln!("[DEBUG] 豆包 WebSocket 收到其他消息类型: {:?}", other);
                    }
                    Err(e) => {
                        eprintln!("[ERROR] 豆包 WebSocket 接收错误: {}", e);
                        if let Some(tx) = result_tx.take() {
                            let _ = tx.send(Err(ASRError::WebSocketError(
                                format!("WebSocket 错误: {}", e)
                            )));
                        }
                        break;
                    }
                }
            }
            
            if result_tx.is_some() {
                if !accumulated_text.is_empty() {
                    eprintln!("[INFO] 豆包连接结束，返回累积文本: {}", accumulated_text);
                    if let Some(tx) = result_tx.take() {
                        let _ = tx.send(Ok(accumulated_text));
                    }
                } else {
                    eprintln!("[WARN] 豆包连接结束，无转录结果");
                    if let Some(tx) = result_tx.take() {
                        let _ = tx.send(Err(ASRError::WebSocketError(
                            "WebSocket 连接结束，无转录结果".to_string()
                        )));
                    }
                }
            }
            eprintln!("[DEBUG] 豆包 WebSocket 接收任务结束");
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
        })
    }
}

#[async_trait]
impl RealtimeSession for DoubaoRealtimeSession {
    async fn send_chunk(&mut self, chunk: &[u8]) -> Result<(), ASRError> {
        self.cmd_sender.send(SessionCommand::SendAudio(chunk.to_vec())).await
            .map_err(|_| ASRError::WebSocketError("发送音频块失败：通道已关闭".to_string()))
    }
    
    async fn close(&mut self) -> Result<String, ASRError> {
        let _ = self.cmd_sender.send(SessionCommand::Finish).await;
        
        let result_rx = self.result_receiver.take()
            .ok_or_else(|| ASRError::InternalError("会话已关闭".to_string()))?;
        
        let result = tokio::time::timeout(
            Duration::from_secs(TRANSCRIPTION_TIMEOUT_SECS),
            result_rx
        ).await
            .map_err(|_| ASRError::Timeout { timeout_ms: TRANSCRIPTION_TIMEOUT_SECS * 1000 })?
            .map_err(|_| ASRError::InternalError("结果通道已关闭".to_string()))?;
        
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

fn generate_request_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("req_{}", timestamp)
}

fn build_message(
    msg_type: u8,
    flags: u8,
    sequence: i32,
    payload: &[u8],
    compression_type: u8,
) -> Result<Vec<u8>, ASRError> {
    let final_payload = if compression_type == 0x1 {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(payload)
            .map_err(|e| ASRError::InternalError(format!("Gzip 压缩失败: {}", e)))?;
        encoder.finish()
            .map_err(|e| ASRError::InternalError(format!("Gzip 完成失败: {}", e)))?
    } else {
        payload.to_vec()
    };
    
    let serialization = if msg_type == 0x1 { 0x1 } else { 0x0 };
    
    let mut msg = vec![
        0x11,
        (msg_type << 4) | flags,
        (serialization << 4) | compression_type,
        0x00,
    ];
    msg.extend_from_slice(&sequence.to_be_bytes());
    msg.extend_from_slice(&(final_payload.len() as u32).to_be_bytes());
    msg.extend_from_slice(&final_payload);
    
    Ok(msg)
}

fn parse_response(data: &[u8]) -> Result<(String, bool), ASRError> {
    if data.len() < 4 {
        return Err(ASRError::InternalError(format!("响应太短: {} bytes", data.len())));
    }
    
    let header_size = (data[0] & 0x0f) as usize * 4;
    let message_type = data[1] >> 4;
    let message_flags = data[1] & 0x0f;
    let compression = data[2] & 0x0f;
    
    eprintln!(
        "[DEBUG] 豆包响应 header: size={}, type={:#x}, flags={:#x}, compression={}",
        header_size, message_type, message_flags, compression
    );
    
    if message_type == 0xf {
        let error_code = if data.len() >= header_size + 4 {
            u32::from_be_bytes([
                data[header_size],
                data[header_size + 1],
                data[header_size + 2],
                data[header_size + 3],
            ])
        } else {
            0
        };
        return Err(ASRError::WebSocketError(format!("服务器返回错误: code={}", error_code)));
    }
    
    let mut offset = header_size;
    
    if message_flags & 0x01 != 0 {
        if data.len() < offset + 4 {
            return Err(ASRError::InternalError("数据不足以包含 sequence".to_string()));
        }
        let sequence = i32::from_be_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]);
        eprintln!("[DEBUG] 豆包响应 sequence: {}", sequence);
        offset += 4;
    }
    
    if data.len() < offset + 4 {
        return Err(ASRError::InternalError("数据不足以包含 payload size".to_string()));
    }
    let payload_size = u32::from_be_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ]) as usize;
    offset += 4;
    
    if data.len() < offset + payload_size {
        return Err(ASRError::InternalError(format!(
            "数据不完整: 需要 {} bytes，实际 {} bytes",
            offset + payload_size,
            data.len()
        )));
    }
    
    let payload_data = &data[offset..offset + payload_size];
    let json_str = if compression == 0x1 {
        let mut decoder = GzDecoder::new(payload_data);
        let mut s = String::new();
        decoder.read_to_string(&mut s)
            .map_err(|e| ASRError::InternalError(format!("Gzip 解压失败: {}", e)))?;
        s
    } else {
        String::from_utf8(payload_data.to_vec())
            .map_err(|e| ASRError::InternalError(format!("UTF-8 解码失败: {}", e)))?
    };
    
    eprintln!("[DEBUG] 豆包响应 JSON: {}", json_str);
    
    let result: serde_json::Value = serde_json::from_str(&json_str)
        .map_err(|e| ASRError::InternalError(format!("JSON 解析失败: {}", e)))?;
    
    let is_last = message_flags & 0x02 != 0;
    let text = result["result"]["text"].as_str().unwrap_or("").to_string();
    
    if is_last || !text.is_empty() {
        return Ok((text, is_last));
    }
    
    Err(ASRError::InternalError("中间响应，等待更多数据".to_string()))
}
