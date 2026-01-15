// Voice 模块
// 提供语音录制和 ASR 转录功能

pub mod audio;
pub mod asr;
pub mod beep;
pub mod config;

use crate::router::{ModuleHandler, ModuleMessage, ModuleType, RouterError, ServerResponse};
use crate::server::WsSender;
use futures_util::SinkExt;
use std::time::Instant;
use tokio::sync::{mpsc, oneshot, Mutex as TokioMutex};
use tokio::task::JoinHandle;

use audio::{AudioRecorder, RecordingMode as AudioRecordingMode, StreamingRecorder, AudioData};
use asr::{RaceStrategy, TranscriptionResult, ASRError, RealtimeTaskResult, RealtimeTranscriptionTask};
use beep::BeepPlayer;
use config::{ASRConfig, ASRMode};

/// 日志宏
macro_rules! log_info {
    ($($arg:tt)*) => {
        eprintln!("[INFO] [Voice] {}", format!($($arg)*));
    };
}

macro_rules! log_error {
    ($($arg:tt)*) => {
        eprintln!("[ERROR] [Voice] {}", format!($($arg)*));
    };
}

macro_rules! log_debug {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[DEBUG] [Voice] {}", format!($($arg)*));
        }
    };
}

// ============================================================================
// 录音模式
// ============================================================================

/// 录音模式
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordingMode {
    Press,  // 按住录音
    Toggle, // 切换录音
}

impl From<RecordingMode> for AudioRecordingMode {
    fn from(mode: RecordingMode) -> Self {
        match mode {
            RecordingMode::Press => AudioRecordingMode::Press,
            RecordingMode::Toggle => AudioRecordingMode::Toggle,
        }
    }
}

// ============================================================================
// 录音状态
// ============================================================================

/// 录音状态
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordingState {
    Started,
    Stopped,
    Cancelled,
}

// ============================================================================
// 音频级别数据
// ============================================================================

/// 音频级别数据 (用于通过 channel 传递)
#[derive(Debug, Clone)]
struct AudioLevelData {
    level: f32,
    waveform: Vec<f32>,
}

// ============================================================================
// 连接状态
// ============================================================================

/// 连接状态
struct ConnectionState {
    /// 当前 ASR 配置
    asr_config: Option<ASRConfig>,
    /// 是否正在录音
    is_recording: bool,
    /// 录音模式
    recording_mode: Option<RecordingMode>,
    /// 录音开始时间
    recording_start_time: Option<Instant>,
    /// 音频录制器 (HTTP 模式)
    recorder: Option<AudioRecorder>,
    /// 流式录制器 (Realtime 模式)
    streaming_recorder: Option<StreamingRecorder>,
    /// 实时转录任务句柄
    realtime_task: Option<JoinHandle<RealtimeTaskResult>>,
    /// 停止信号发送器 (用于停止实时转录任务)
    stop_signal: Option<oneshot::Sender<()>>,
    /// 提示音播放器
    beep_player: BeepPlayer,
    /// 音频级别发送器
    audio_level_tx: Option<mpsc::UnboundedSender<AudioLevelData>>,
}

impl ConnectionState {
    fn new() -> Self {
        Self {
            asr_config: None,
            is_recording: false,
            recording_mode: None,
            recording_start_time: None,
            recorder: None,
            streaming_recorder: None,
            realtime_task: None,
            stop_signal: None,
            beep_player: BeepPlayer::new(),
            audio_level_tx: None,
        }
    }
}

// ============================================================================
// Voice 处理器
// ============================================================================

/// Voice 模块处理器
/// 
/// 管理语音录制和 ASR 转录
pub struct VoiceHandler {
    /// 连接状态
    state: TokioMutex<ConnectionState>,
    /// WebSocket 发送器
    ws_sender: TokioMutex<Option<WsSender>>,
}

impl VoiceHandler {
    /// 创建新的 Voice 处理器
    pub fn new() -> Self {
        Self {
            state: TokioMutex::new(ConnectionState::new()),
            ws_sender: TokioMutex::new(None),
        }
    }
    
    /// 设置 WebSocket 发送器
    pub async fn set_ws_sender(&self, sender: WsSender) {
        let mut ws_sender = self.ws_sender.lock().await;
        *ws_sender = Some(sender);
    }
    
    /// 发送消息给客户端
    async fn send_message(&self, msg_type: &str, payload: serde_json::Value) -> Result<(), RouterError> {
        let ws_sender = self.ws_sender.lock().await;
        if let Some(ref sender) = *ws_sender {
            let response = serde_json::json!({
                "module": "voice",
                "type": msg_type,
            });
            
            // 合并 payload 到 response
            let mut response = response.as_object().unwrap().clone();
            if let serde_json::Value::Object(payload_obj) = payload {
                for (k, v) in payload_obj {
                    response.insert(k, v);
                }
            }
            
            let json = serde_json::to_string(&response)
                .map_err(|e| RouterError::ModuleError(format!("JSON 序列化失败: {}", e)))?;
            
            let mut sender = sender.lock().await;
            sender.send(tokio_tungstenite::tungstenite::Message::Text(json.into())).await
                .map_err(|e| RouterError::ModuleError(format!("发送消息失败: {}", e)))?;
        }
        Ok(())
    }

    /// 处理开始录音命令
    async fn handle_start_recording(
        &self,
        mode: RecordingMode,
        asr_config: ASRConfig,
    ) -> Result<Option<ServerResponse>, RouterError> {
        log_info!("收到开始录音命令，模式: {:?}", mode);
        
        let mut state = self.state.lock().await;
        
        // 检查是否已在录音
        if state.is_recording {
            return Err(RouterError::ModuleError("已在录音中".to_string()));
        }
        
        // 创建音频级别 channel
        let (audio_level_tx, mut audio_level_rx) = mpsc::unbounded_channel::<AudioLevelData>();
        
        // 根据 ASR 模式选择录音器
        let is_realtime_mode = asr_config.primary.mode == ASRMode::Realtime;
        
        if is_realtime_mode {
            log_info!("使用 Realtime 模式，启动流式录音器");
            
            // 创建流式录音器
            let mut streaming_recorder = StreamingRecorder::new()
                .map_err(|e| RouterError::ModuleError(format!("创建流式录音器失败: {}", e)))?;
            
            // 设置音频级别回调
            let tx = audio_level_tx.clone();
            streaming_recorder.set_level_callback(move |level, waveform| {
                let _ = tx.send(AudioLevelData { level, waveform });
            });
            
            // 启动流式录音，获取音频块接收通道
            let chunk_rx = streaming_recorder.start_streaming(mode.clone().into())
                .map_err(|e| RouterError::ModuleError(format!("启动流式录音失败: {}", e)))?;
            
            // 创建实时转录任务
            let primary_config = asr_config.primary.clone();
            let ws_sender = self.ws_sender.lock().await.clone();
            
            // 创建部分结果回调
            let partial_callback: Option<Box<dyn Fn(&str) + Send + 'static>> = if let Some(sender) = ws_sender.clone() {
                Some(Box::new(move |text: &str| {
                    let text_owned = text.to_string();
                    let sender = sender.clone();
                    tokio::spawn(async move {
                        let msg = serde_json::json!({
                            "module": "voice",
                            "type": "transcription_progress",
                            "partial_text": text_owned,
                        });
                        let json = serde_json::to_string(&msg).unwrap();
                        let mut s = sender.lock().await;
                        let _ = s.send(tokio_tungstenite::tungstenite::Message::Text(json.into())).await;
                    });
                }))
            } else {
                None
            };
            
            // 创建实时转录任务
            let (task, stop_tx) = RealtimeTranscriptionTask::new(
                primary_config,
                chunk_rx,
                partial_callback,
            );
            
            // 启动实时转录任务
            let task_handle = tokio::spawn(async move {
                task.run_with_details().await
            });
            
            state.asr_config = Some(asr_config.clone());
            state.is_recording = true;
            state.recording_mode = Some(mode.clone());
            state.recording_start_time = Some(Instant::now());
            state.audio_level_tx = Some(audio_level_tx.clone());
            state.streaming_recorder = Some(streaming_recorder);
            state.realtime_task = Some(task_handle);
            state.stop_signal = Some(stop_tx);
            
        } else {
            log_info!("使用 HTTP 模式，启动普通录音器");
            
            // 创建普通录音器
            let mut recorder = AudioRecorder::new()
                .map_err(|e| RouterError::ModuleError(format!("创建录音器失败: {}", e)))?;
            
            // 设置音频级别回调
            let tx = audio_level_tx.clone();
            recorder.set_level_callback(move |level, waveform| {
                let _ = tx.send(AudioLevelData { level, waveform });
            });
            
            // 启动录音
            recorder.start(mode.clone().into())
                .map_err(|e| RouterError::ModuleError(format!("启动录音失败: {}", e)))?;
            
            state.asr_config = Some(asr_config.clone());
            state.is_recording = true;
            state.recording_mode = Some(mode.clone());
            state.recording_start_time = Some(Instant::now());
            state.audio_level_tx = Some(audio_level_tx.clone());
            state.recorder = Some(recorder);
        }
        
        // 根据配置设置音频反馈
        state.beep_player.set_enabled(asr_config.enable_audio_feedback);
        
        // 播放开始提示音
        state.beep_player.play_start();
        
        drop(state);
        
        // 启动音频级别转发任务
        let ws_sender = self.ws_sender.lock().await.clone();
        if let Some(sender) = ws_sender {
            tokio::spawn(async move {
                while let Some(data) = audio_level_rx.recv().await {
                    let msg = serde_json::json!({
                        "module": "voice",
                        "type": "audio_level",
                        "level": data.level,
                        "waveform": data.waveform,
                    });
                    let json = serde_json::to_string(&msg).unwrap();
                    let mut s = sender.lock().await;
                    if s.send(tokio_tungstenite::tungstenite::Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
            });
        }
        
        // 发送录音开始状态
        self.send_message("recording_state", serde_json::json!({
            "state": "started"
        })).await?;
        
        Ok(None)
    }

    /// 处理停止录音命令
    async fn handle_stop_recording(&self) -> Result<Option<ServerResponse>, RouterError> {
        log_info!("收到停止录音命令");
        
        let mut state = self.state.lock().await;
        
        // 检查是否在录音
        if !state.is_recording {
            return Err(RouterError::ModuleError("未在录音中".to_string()));
        }
        
        // 播放结束提示音
        state.beep_player.play_stop();
        
        // 关闭音频级别 channel
        state.audio_level_tx = None;
        
        // 获取 ASR 配置
        let asr_config = state.asr_config.clone()
            .ok_or_else(|| RouterError::ModuleError("ASR 配置未设置".to_string()))?;
        
        // 检查是否是 realtime 模式
        let is_realtime_mode = state.streaming_recorder.is_some();
        
        if is_realtime_mode {
            // Realtime 模式：停止流式录音，等待实时转录任务完成
            log_info!("停止 Realtime 模式录音");
            
            // 发送停止信号给实时转录任务
            if let Some(stop_tx) = state.stop_signal.take() {
                let _ = stop_tx.send(());
            }
            
            // 停止流式录音并获取完整音频数据 (用于回退)
            let audio_data = if let Some(ref mut streaming_recorder) = state.streaming_recorder {
                streaming_recorder.stop_streaming()
                    .map_err(|e| RouterError::ModuleError(format!("停止流式录音失败: {}", e)))?
            } else {
                return Err(RouterError::ModuleError("流式录音器未初始化".to_string()));
            };
            
            // 获取实时转录任务句柄
            let realtime_task = state.realtime_task.take();
            
            // 更新状态
            state.is_recording = false;
            state.recording_mode = None;
            state.streaming_recorder = None;
            drop(state);
            
            // 发送录音停止状态
            self.send_message("recording_state", serde_json::json!({
                "state": "stopped"
            })).await?;
            
            // 等待实时转录任务完成
            let realtime_result = if let Some(task_handle) = realtime_task {
                log_info!("等待实时转录任务完成...");
                match task_handle.await {
                    Ok(result) => Some(result),
                    Err(e) => {
                        log_error!("实时转录任务 panic: {}", e);
                        None
                    }
                }
            } else {
                log_error!("实时转录任务句柄不存在");
                None
            };
            
            // 处理实时转录结果
            match realtime_result {
                Some(RealtimeTaskResult::Success(result)) => {
                    log_info!(
                        "实时转录成功: engine={}, duration={}ms, text={}",
                        result.engine,
                        result.duration_ms,
                        &result.text
                    );
                    
                    self.send_message("transcription_complete", serde_json::json!({
                        "text": result.text,
                        "engine": result.engine,
                        "used_fallback": false,
                        "duration_ms": result.duration_ms,
                    })).await?;
                }
                Some(RealtimeTaskResult::Failed { error, engine_name, .. }) => {
                    log_error!("实时转录失败 ({}): {}，尝试回退到 HTTP 模式", engine_name, error);
                    
                    // 回退到 HTTP 模式
                    let fallback_result = perform_fallback_transcription(&audio_data, &asr_config).await;
                    
                    match fallback_result {
                        Ok(result) => {
                            log_info!(
                                "HTTP 回退转录成功: engine={}, duration={}ms, text={}",
                                result.engine,
                                result.duration_ms,
                                &result.text
                            );
                            
                            self.send_message("transcription_complete", serde_json::json!({
                                "text": result.text,
                                "engine": result.engine,
                                "used_fallback": true,
                                "duration_ms": result.duration_ms,
                            })).await?;
                        }
                        Err(fallback_error) => {
                            log_error!("HTTP 回退也失败: {}", fallback_error);
                            
                            self.send_message("error", serde_json::json!({
                                "code": "TRANSCRIPTION_FAILED",
                                "message": format!(
                                    "实时转录失败: {}; HTTP 回退也失败: {}",
                                    error, fallback_error
                                ),
                            })).await?;
                        }
                    }
                }
                None => {
                    log_error!("实时转录任务异常，尝试回退到 HTTP 模式");
                    
                    // 回退到 HTTP 模式
                    let fallback_result = perform_fallback_transcription(&audio_data, &asr_config).await;
                    
                    match fallback_result {
                        Ok(result) => {
                            log_info!(
                                "HTTP 回退转录成功: engine={}, duration={}ms, text={}",
                                result.engine,
                                result.duration_ms,
                                &result.text
                            );
                            
                            self.send_message("transcription_complete", serde_json::json!({
                                "text": result.text,
                                "engine": result.engine,
                                "used_fallback": true,
                                "duration_ms": result.duration_ms,
                            })).await?;
                        }
                        Err(fallback_error) => {
                            log_error!("HTTP 回退也失败: {}", fallback_error);
                            
                            self.send_message("error", serde_json::json!({
                                "code": "TRANSCRIPTION_FAILED",
                                "message": format!(
                                    "实时转录任务异常; HTTP 回退也失败: {}",
                                    fallback_error
                                ),
                            })).await?;
                        }
                    }
                }
            }
        } else {
            // HTTP 模式：停止普通录音，执行 HTTP 转录
            log_info!("停止 HTTP 模式录音");
            
            // 停止录音并获取音频数据
            let audio_data = if let Some(ref mut recorder) = state.recorder {
                recorder.stop().map_err(|e| RouterError::ModuleError(format!("停止录音失败: {}", e)))?
            } else {
                return Err(RouterError::ModuleError("录音器未初始化".to_string()));
            };
            
            // 更新状态
            state.is_recording = false;
            state.recording_mode = None;
            state.recorder = None;
            drop(state);
            
            // 发送录音停止状态
            self.send_message("recording_state", serde_json::json!({
                "state": "stopped"
            })).await?;
            
            // 检查音频数据是否为空
            if audio_data.is_empty() {
                log_info!("录音数据为空，跳过转录");
                self.send_message("transcription_complete", serde_json::json!({
                    "text": "",
                    "engine": "none",
                    "used_fallback": false,
                    "duration_ms": 0,
                })).await?;
                return Ok(None);
            }
            
            log_info!("开始 ASR 转录，音频时长: {}ms", audio_data.duration_ms);
            
            // 执行 ASR 转录
            let transcription_result = perform_transcription(&audio_data, &asr_config).await;
            
            match transcription_result {
                Ok(result) => {
                    log_info!(
                        "转录成功: engine={}, used_fallback={}, duration={}ms, text={}",
                        result.engine,
                        result.used_fallback,
                        result.duration_ms,
                        &result.text
                    );
                    
                    self.send_message("transcription_complete", serde_json::json!({
                        "text": result.text,
                        "engine": result.engine,
                        "used_fallback": result.used_fallback,
                        "duration_ms": result.duration_ms,
                    })).await?;
                }
                Err(e) => {
                    log_error!("转录失败: {}", e);
                    
                    self.send_message("error", serde_json::json!({
                        "code": "TRANSCRIPTION_FAILED",
                        "message": e.to_string(),
                    })).await?;
                }
            }
        }
        
        Ok(None)
    }

    /// 处理取消录音命令
    async fn handle_cancel_recording(&self) -> Result<Option<ServerResponse>, RouterError> {
        log_info!("收到取消录音命令");
        
        let mut state = self.state.lock().await;
        
        // 检查是否在录音
        if !state.is_recording {
            return Err(RouterError::ModuleError("未在录音中".to_string()));
        }
        
        // 关闭音频级别 channel
        state.audio_level_tx = None;
        
        // 检查是否是 realtime 模式
        let is_realtime_mode = state.streaming_recorder.is_some();
        
        if is_realtime_mode {
            // 发送停止信号给实时转录任务
            if let Some(stop_tx) = state.stop_signal.take() {
                let _ = stop_tx.send(());
            }
            
            // 取消流式录音
            if let Some(ref mut streaming_recorder) = state.streaming_recorder {
                streaming_recorder.cancel();
            }
            
            // 中止实时转录任务
            if let Some(task_handle) = state.realtime_task.take() {
                task_handle.abort();
            }
            
            // 更新状态
            state.streaming_recorder = None;
            state.realtime_task = None;
            state.stop_signal = None;
        } else {
            // 取消普通录音
            if let Some(ref mut recorder) = state.recorder {
                recorder.cancel();
            }
            state.recorder = None;
        }
        
        // 更新状态
        state.is_recording = false;
        state.recording_mode = None;
        drop(state);
        
        // 发送录音取消状态
        self.send_message("recording_state", serde_json::json!({
            "state": "cancelled"
        })).await?;
        
        Ok(None)
    }
    
    /// 处理更新配置命令
    async fn handle_update_config(&self, asr_config: ASRConfig) -> Result<Option<ServerResponse>, RouterError> {
        log_info!("收到更新配置命令");
        
        let mut state = self.state.lock().await;
        state.asr_config = Some(asr_config);
        
        log_debug!("ASR 配置已更新");
        
        Ok(None)
    }
    
    /// 检查是否正在录音
    pub async fn is_recording(&self) -> bool {
        let state = self.state.lock().await;
        state.is_recording
    }
    
    /// 清理资源
    pub async fn cleanup(&self) {
        let mut state = self.state.lock().await;
        
        if state.is_recording {
            state.is_recording = false;
            state.recording_mode = None;
            log_info!("连接关闭，取消录音");
        }
        
        // 取消实时转录任务
        if let Some(stop_tx) = state.stop_signal.take() {
            let _ = stop_tx.send(());
        }
        if let Some(task_handle) = state.realtime_task.take() {
            task_handle.abort();
        }
        
        // 取消录音
        if let Some(ref mut streaming_recorder) = state.streaming_recorder {
            streaming_recorder.cancel();
        }
        if let Some(ref mut recorder) = state.recorder {
            recorder.cancel();
        }
        
        state.streaming_recorder = None;
        state.recorder = None;
        state.audio_level_tx = None;
    }
}

impl Default for VoiceHandler {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl ModuleHandler for VoiceHandler {
    fn module_type(&self) -> ModuleType {
        ModuleType::Voice
    }
    
    async fn handle(&self, msg: &ModuleMessage) -> Result<Option<ServerResponse>, RouterError> {
        log_debug!("处理 Voice 消息: {}", msg.msg_type);
        
        match msg.msg_type.as_str() {
            "start_recording" => {
                let mode: RecordingMode = msg.get_field("mode")
                    .ok_or_else(|| RouterError::ModuleError("缺少 mode 字段".to_string()))?;
                let asr_config: ASRConfig = msg.get_field("asr_config")
                    .ok_or_else(|| RouterError::ModuleError("缺少 asr_config 字段".to_string()))?;
                
                self.handle_start_recording(mode, asr_config).await
            }
            "stop_recording" => {
                self.handle_stop_recording().await
            }
            "cancel_recording" => {
                self.handle_cancel_recording().await
            }
            "update_config" => {
                let asr_config: ASRConfig = msg.get_field("asr_config")
                    .ok_or_else(|| RouterError::ModuleError("缺少 asr_config 字段".to_string()))?;
                
                self.handle_update_config(asr_config).await
            }
            _ => {
                log_debug!("未知的 Voice 消息类型: {}", msg.msg_type);
                Err(RouterError::ModuleError(format!("未知的 Voice 消息类型: {}", msg.msg_type)))
            }
        }
    }
}

// ============================================================================
// 辅助函数
// ============================================================================

/// 执行 ASR 转录
async fn perform_transcription(
    audio_data: &AudioData,
    asr_config: &ASRConfig,
) -> Result<TranscriptionResult, ASRError> {
    // 验证配置
    asr_config.validate()
        .map_err(|e| ASRError::ConfigError(e.to_string()))?;
    
    // 创建竞速策略
    let strategy = RaceStrategy::from_config(asr_config.clone());
    
    log_info!(
        "使用 ASR 引擎: primary={}, fallback={:?}, enable_fallback={}",
        strategy.primary_provider(),
        strategy.fallback_provider(),
        strategy.is_fallback_enabled()
    );
    
    // 执行转录
    strategy.transcribe(audio_data).await
}

/// 执行回退 ASR 转录
async fn perform_fallback_transcription(
    audio_data: &AudioData,
    asr_config: &ASRConfig,
) -> Result<TranscriptionResult, ASRError> {
    // 检查音频数据是否为空
    if audio_data.is_empty() {
        log_info!("回退转录：音频数据为空");
        return Ok(TranscriptionResult::new(
            String::new(),
            "none".to_string(),
            true,
            0,
        ));
    }
    
    log_info!("执行回退转录，音频时长: {}ms", audio_data.duration_ms);
    
    // 如果配置了 fallback 引擎且启用了 fallback，优先使用 fallback 引擎
    if asr_config.enable_fallback {
        if let Some(ref fallback_config) = asr_config.fallback {
            log_info!("使用配置的 fallback 引擎: {}", fallback_config.provider);
            
            // 创建 fallback 引擎
            let engine = asr::create_engine(fallback_config)?;
            
            let start_time = std::time::Instant::now();
            let text = engine.transcribe(audio_data).await?;
            let duration_ms = start_time.elapsed().as_millis() as u64;
            
            return Ok(TranscriptionResult::new(
                text,
                engine.name().to_string(),
                true,
                duration_ms,
            ));
        }
    }
    
    // 没有配置 fallback 引擎，使用 primary 引擎的 HTTP 模式
    log_info!("使用 primary 引擎的 HTTP 模式进行回退");
    
    // 创建 HTTP 模式的配置
    let mut http_config = asr_config.primary.clone();
    http_config.mode = ASRMode::Http;
    
    // 创建 HTTP 引擎
    let engine = asr::create_engine(&http_config)?;
    
    let start_time = std::time::Instant::now();
    let text = engine.transcribe(audio_data).await?;
    let duration_ms = start_time.elapsed().as_millis() as u64;
    
    Ok(TranscriptionResult::new(
        text,
        format!("{}-http", engine.name()),
        true,
        duration_ms,
    ))
}
