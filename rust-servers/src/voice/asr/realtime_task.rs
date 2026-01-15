// 实时转录任务模块
// 协调 StreamingRecorder 和 RealtimeSession，实现边录边转录

use std::sync::Arc;
use tokio::sync::{mpsc, Mutex, oneshot};

use crate::voice::asr::{ASRError, TranscriptionResult, create_engine};
use crate::voice::audio::streaming::AudioChunkData;
use crate::voice::config::ASRProviderConfig;

macro_rules! log_info {
    ($($arg:tt)*) => {
        eprintln!("[INFO] [realtime_task] {}", format!($($arg)*));
    };
}

macro_rules! log_debug {
    ($($arg:tt)*) => {
        eprintln!("[DEBUG] [realtime_task] {}", format!($($arg)*));
    };
}

macro_rules! log_warn {
    ($($arg:tt)*) => {
        eprintln!("[WARN] [realtime_task] {}", format!($($arg)*));
    };
}

macro_rules! log_error {
    ($($arg:tt)*) => {
        eprintln!("[ERROR] [realtime_task] {}", format!($($arg)*));
    };
}

/// 实时转录任务结果
#[derive(Debug)]
pub enum RealtimeTaskResult {
    Success(TranscriptionResult),
    Failed {
        error: ASRError,
        engine_name: String,
        chunks_sent: u64,
        samples_sent: u64,
    },
}

impl RealtimeTaskResult {
    pub fn is_success(&self) -> bool {
        matches!(self, RealtimeTaskResult::Success(_))
    }
    
    pub fn into_result(self) -> Result<TranscriptionResult, ASRError> {
        match self {
            RealtimeTaskResult::Success(result) => Ok(result),
            RealtimeTaskResult::Failed { error, .. } => Err(error),
        }
    }
    
    pub fn error(&self) -> Option<&ASRError> {
        match self {
            RealtimeTaskResult::Failed { error, .. } => Some(error),
            _ => None,
        }
    }
}

/// 部分结果回调类型
pub type PartialResultCallback = Box<dyn Fn(&str) + Send + 'static>;

/// 实时转录任务
pub struct RealtimeTranscriptionTask {
    asr_config: ASRProviderConfig,
    chunk_receiver: mpsc::Receiver<AudioChunkData>,
    partial_callback: Arc<Mutex<Option<PartialResultCallback>>>,
    stop_receiver: Option<oneshot::Receiver<()>>,
}

impl RealtimeTranscriptionTask {
    pub fn new(
        asr_config: ASRProviderConfig,
        chunk_receiver: mpsc::Receiver<AudioChunkData>,
        partial_callback: Option<PartialResultCallback>,
    ) -> (Self, oneshot::Sender<()>) {
        let (stop_tx, stop_rx) = oneshot::channel();
        
        let task = Self {
            asr_config,
            chunk_receiver,
            partial_callback: Arc::new(Mutex::new(partial_callback)),
            stop_receiver: Some(stop_rx),
        };
        
        (task, stop_tx)
    }
    
    pub async fn run(self) -> Result<TranscriptionResult, ASRError> {
        match self.run_with_details().await {
            RealtimeTaskResult::Success(result) => Ok(result),
            RealtimeTaskResult::Failed { error, engine_name, chunks_sent, samples_sent } => {
                log_error!(
                    "实时转录失败: 引擎={}, 已发送块={}, 样本={}, 错误={}",
                    engine_name, chunks_sent, samples_sent, error
                );
                Err(error)
            }
        }
    }
    
    pub async fn run_with_details(mut self) -> RealtimeTaskResult {
        let start_time = std::time::Instant::now();
        let mut engine_name = String::from("unknown");
        let mut chunk_count = 0u64;
        let mut total_samples = 0u64;
        
        log_info!(
            "启动实时转录任务，供应商: {}, 模式: {}",
            self.asr_config.provider,
            self.asr_config.mode
        );
        
        let engine = match create_engine(&self.asr_config) {
            Ok(e) => e,
            Err(e) => {
                log_error!("创建 ASR 引擎失败: {}", e);
                return RealtimeTaskResult::Failed {
                    error: e,
                    engine_name,
                    chunks_sent: 0,
                    samples_sent: 0,
                };
            }
        };
        engine_name = engine.name().to_string();
        
        log_debug!("创建 ASR 引擎: {}", engine_name);
        
        let mut session = match engine.create_realtime_session().await {
            Ok(s) => s,
            Err(e) => {
                log_error!("创建实时会话失败 (WebSocket 连接失败): {}", e);
                return RealtimeTaskResult::Failed {
                    error: e,
                    engine_name,
                    chunks_sent: 0,
                    samples_sent: 0,
                };
            }
        };
        
        log_info!("实时会话已创建");
        
        let partial_callback = Arc::clone(&self.partial_callback);
        session.set_partial_callback(Box::new(move |text| {
            let text_owned = text.to_string();
            let callback = partial_callback.clone();
            tokio::spawn(async move {
                if let Some(ref cb) = *callback.lock().await {
                    cb(&text_owned);
                }
            });
        }));
        
        let mut stop_rx = self.stop_receiver.take();
        let mut consecutive_send_failures = 0u32;
        const MAX_CONSECUTIVE_FAILURES: u32 = 5;
        
        loop {
            tokio::select! {
                _ = async {
                    if let Some(ref mut rx) = stop_rx {
                        rx.await.ok()
                    } else {
                        std::future::pending::<Option<()>>().await
                    }
                } => {
                    log_info!("收到停止信号，准备关闭会话");
                    break;
                }
                
                chunk = self.chunk_receiver.recv() => {
                    match chunk {
                        Some(audio_chunk) => {
                            chunk_count += 1;
                            total_samples += audio_chunk.samples.len() as u64;
                            
                            let pcm_bytes = samples_to_bytes(&audio_chunk.samples);
                            
                            match session.send_chunk(&pcm_bytes).await {
                                Ok(()) => {
                                    consecutive_send_failures = 0;
                                }
                                Err(e) => {
                                    consecutive_send_failures += 1;
                                    log_warn!(
                                        "发送音频块失败 ({}/{}): {}",
                                        consecutive_send_failures,
                                        MAX_CONSECUTIVE_FAILURES,
                                        e
                                    );
                                    
                                    if consecutive_send_failures >= MAX_CONSECUTIVE_FAILURES {
                                        log_error!("连续发送失败次数过多，中止任务");
                                        return RealtimeTaskResult::Failed {
                                            error: ASRError::WebSocketError(format!(
                                                "连续 {} 次发送失败: {}",
                                                consecutive_send_failures, e
                                            )),
                                            engine_name,
                                            chunks_sent: chunk_count,
                                            samples_sent: total_samples,
                                        };
                                    }
                                }
                            }
                            
                            if chunk_count % 10 == 0 {
                                log_debug!(
                                    "已发送 {} 个音频块，共 {} 样本",
                                    chunk_count,
                                    total_samples
                                );
                            }
                        }
                        None => {
                            log_info!("音频通道关闭，录音结束");
                            break;
                        }
                    }
                }
            }
        }
        
        log_info!(
            "共发送 {} 个音频块，{} 样本，约 {:.1} 秒",
            chunk_count,
            total_samples,
            total_samples as f64 / 16000.0
        );
        
        log_info!("关闭 ASR 会话，等待最终结果...");
        let final_text = match session.close().await {
            Ok(text) => text,
            Err(e) => {
                log_error!("关闭会话失败: {}", e);
                return RealtimeTaskResult::Failed {
                    error: e,
                    engine_name,
                    chunks_sent: chunk_count,
                    samples_sent: total_samples,
                };
            }
        };
        
        let duration_ms = start_time.elapsed().as_millis() as u64;
        
        log_info!(
            "实时转录完成，耗时 {}ms，结果: {}",
            duration_ms,
            if final_text.chars().count() > 50 {
                format!("{}...", final_text.chars().take(50).collect::<String>())
            } else {
                final_text.clone()
            }
        );
        
        RealtimeTaskResult::Success(TranscriptionResult::new(
            final_text,
            engine_name,
            false,
            duration_ms,
        ))
    }
}

fn samples_to_bytes(samples: &[i16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}
