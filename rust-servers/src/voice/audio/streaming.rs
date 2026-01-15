// 流式音频录制模块
// 支持边录音边发送 PCM 数据块，用于实时 ASR

macro_rules! log_info {
    ($($arg:tt)*) => {
        eprintln!("[INFO] [streaming] {}", format!($($arg)*));
    };
}

macro_rules! log_warn {
    ($($arg:tt)*) => {
        eprintln!("[WARN] [streaming] {}", format!($($arg)*));
    };
}

macro_rules! log_error {
    ($($arg:tt)*) => {{
        eprintln!("[ERROR] [streaming] {}", format!($($arg)*))
    }};
}

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Stream;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::mpsc;

use super::recorder::{
    convert_i16_to_f32, convert_u16_to_f32, resample, to_mono, RecordingError, RecordingMode,
    TARGET_SAMPLE_RATE,
};
use super::utils;
use super::AudioData;

/// 每个音频块的样本数 (0.2秒 @ 16kHz = 3200 样本)
pub const CHUNK_SAMPLES: usize = 3200;

/// 音频块通道缓冲大小 (约 10 秒的音频)
pub const CHUNK_CHANNEL_BUFFER: usize = 50;

/// VAD 拖尾块数 (默认 3 块 = 0.6 秒)
pub const VAD_HANGOVER_CHUNKS: usize = 3;

/// 音频级别发送间隔 (毫秒)，目标 ~30Hz
pub const AUDIO_LEVEL_EMIT_INTERVAL_MS: u128 = 33;

/// 音频块数据 (PCM i16 格式)
#[derive(Debug, Clone)]
pub struct AudioChunkData {
    pub samples: Vec<i16>,
    pub timestamp_ms: u64,
}

/// 音频级别回调类型
pub type StreamingLevelCallback = Box<dyn Fn(f32, Vec<f32>) + Send + 'static>;

/// 流式音频录制器
pub struct StreamingRecorder {
    device_sample_rate: u32,
    channels: u16,
    is_recording: Arc<Mutex<bool>>,
    recording_mode: Arc<Mutex<Option<RecordingMode>>>,
    stream: Option<Stream>,
    chunk_sender: Option<mpsc::Sender<AudioChunkData>>,
    full_audio_data: Arc<Mutex<Vec<f32>>>,
    level_callback: Arc<Mutex<Option<StreamingLevelCallback>>>,
    smoothed_level: Arc<Mutex<f32>>,
    start_time: Arc<Mutex<Option<std::time::Instant>>>,
    vad_hangover: Arc<Mutex<usize>>,
    agc_gain: Arc<Mutex<f32>>,
    last_emit_time: Arc<Mutex<Instant>>,
}

impl StreamingRecorder {
    pub fn new() -> Result<Self, RecordingError> {
        Ok(Self {
            device_sample_rate: 48000,
            channels: 1,
            is_recording: Arc::new(Mutex::new(false)),
            recording_mode: Arc::new(Mutex::new(None)),
            stream: None,
            chunk_sender: None,
            full_audio_data: Arc::new(Mutex::new(Vec::new())),
            level_callback: Arc::new(Mutex::new(None)),
            smoothed_level: Arc::new(Mutex::new(0.0)),
            start_time: Arc::new(Mutex::new(None)),
            vad_hangover: Arc::new(Mutex::new(0)),
            agc_gain: Arc::new(Mutex::new(1.0)),
            last_emit_time: Arc::new(Mutex::new(Instant::now())),
        })
    }

    pub fn set_level_callback<F>(&mut self, callback: F)
    where
        F: Fn(f32, Vec<f32>) + Send + 'static,
    {
        let mut cb = self.level_callback.lock().unwrap();
        *cb = Some(Box::new(callback));
    }

    pub fn start_streaming(
        &mut self,
        mode: RecordingMode,
    ) -> Result<mpsc::Receiver<AudioChunkData>, RecordingError> {
        {
            let is_recording = self.is_recording.lock().unwrap();
            if *is_recording {
                return Err(RecordingError::AlreadyRecording);
            }
        }

        log_info!("开始流式录音，模式: {:?}", mode);

        self.full_audio_data.lock().unwrap().clear();
        *self.is_recording.lock().unwrap() = true;
        *self.recording_mode.lock().unwrap() = Some(mode);
        *self.smoothed_level.lock().unwrap() = 0.0;
        *self.start_time.lock().unwrap() = Some(std::time::Instant::now());
        *self.vad_hangover.lock().unwrap() = 0;
        *self.agc_gain.lock().unwrap() = 1.0;
        *self.last_emit_time.lock().unwrap() = Instant::now();

        let (chunk_tx, chunk_rx) = mpsc::channel::<AudioChunkData>(CHUNK_CHANNEL_BUFFER);
        self.chunk_sender = Some(chunk_tx.clone());

        let host = cpal::default_host();
        let device = host.default_input_device().ok_or_else(|| {
            RecordingError::MicrophoneUnavailable("没有找到默认音频输入设备".to_string())
        })?;

        let supported_config = device
            .default_input_config()
            .map_err(|e| RecordingError::DeviceError(format!("无法获取默认音频配置: {}", e)))?;

        let config = supported_config.config();
        self.device_sample_rate = config.sample_rate.0;
        self.channels = config.channels;

        log_info!(
            "流式录音配置: 采样率={}Hz, 声道={}, 目标采样率={}Hz, 块大小={}样本",
            self.device_sample_rate,
            self.channels,
            TARGET_SAMPLE_RATE,
            CHUNK_SAMPLES
        );

        let is_recording = Arc::clone(&self.is_recording);
        let full_audio_data = Arc::clone(&self.full_audio_data);
        let level_callback = Arc::clone(&self.level_callback);
        let smoothed_level = Arc::clone(&self.smoothed_level);
        let start_time = Arc::clone(&self.start_time);
        let vad_hangover = Arc::clone(&self.vad_hangover);
        let agc_gain = Arc::clone(&self.agc_gain);
        let last_emit_time = Arc::clone(&self.last_emit_time);
        let device_sample_rate = self.device_sample_rate;
        let channels = self.channels;

        let pending_samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::new()));

        let err_fn = |err| log_error!("录音流错误: {}", err);

        let stream = match supported_config.sample_format() {
            cpal::SampleFormat::F32 => {
                let pending = Arc::clone(&pending_samples);
                let chunk_tx = chunk_tx.clone();
                let vad_hangover = Arc::clone(&vad_hangover);
                let agc_gain = Arc::clone(&agc_gain);
                let last_emit_time = Arc::clone(&last_emit_time);

                device
                    .build_input_stream(
                        &config,
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            Self::handle_streaming_callback(
                                data,
                                &is_recording,
                                &full_audio_data,
                                &pending,
                                &chunk_tx,
                                &level_callback,
                                &smoothed_level,
                                &start_time,
                                &vad_hangover,
                                &agc_gain,
                                &last_emit_time,
                                device_sample_rate,
                                channels,
                            );
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| RecordingError::DeviceError(e.to_string()))?
            }
            cpal::SampleFormat::I16 => {
                let is_recording = Arc::clone(&is_recording);
                let full_audio_data = Arc::clone(&full_audio_data);
                let pending = Arc::clone(&pending_samples);
                let level_callback = Arc::clone(&level_callback);
                let smoothed_level = Arc::clone(&smoothed_level);
                let start_time = Arc::clone(&start_time);
                let chunk_tx = chunk_tx.clone();
                let vad_hangover = Arc::clone(&vad_hangover);
                let agc_gain = Arc::clone(&agc_gain);
                let last_emit_time = Arc::clone(&last_emit_time);

                device
                    .build_input_stream(
                        &config,
                        move |data: &[i16], _: &cpal::InputCallbackInfo| {
                            let f32_data = convert_i16_to_f32(data);
                            Self::handle_streaming_callback(
                                &f32_data,
                                &is_recording,
                                &full_audio_data,
                                &pending,
                                &chunk_tx,
                                &level_callback,
                                &smoothed_level,
                                &start_time,
                                &vad_hangover,
                                &agc_gain,
                                &last_emit_time,
                                device_sample_rate,
                                channels,
                            );
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| RecordingError::DeviceError(e.to_string()))?
            }
            cpal::SampleFormat::U16 => {
                let is_recording = Arc::clone(&is_recording);
                let full_audio_data = Arc::clone(&full_audio_data);
                let pending = Arc::clone(&pending_samples);
                let level_callback = Arc::clone(&level_callback);
                let smoothed_level = Arc::clone(&smoothed_level);
                let start_time = Arc::clone(&start_time);
                let chunk_tx = chunk_tx.clone();
                let vad_hangover = Arc::clone(&vad_hangover);
                let agc_gain = Arc::clone(&agc_gain);
                let last_emit_time = Arc::clone(&last_emit_time);

                device
                    .build_input_stream(
                        &config,
                        move |data: &[u16], _: &cpal::InputCallbackInfo| {
                            let f32_data = convert_u16_to_f32(data);
                            Self::handle_streaming_callback(
                                &f32_data,
                                &is_recording,
                                &full_audio_data,
                                &pending,
                                &chunk_tx,
                                &level_callback,
                                &smoothed_level,
                                &start_time,
                                &vad_hangover,
                                &agc_gain,
                                &last_emit_time,
                                device_sample_rate,
                                channels,
                            );
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| RecordingError::DeviceError(e.to_string()))?
            }
            format => {
                return Err(RecordingError::UnsupportedSampleFormat(format!(
                    "{:?}",
                    format
                )));
            }
        };

        stream
            .play()
            .map_err(|e| RecordingError::DeviceError(e.to_string()))?;

        self.stream = Some(stream);

        log_info!("流式录音已启动");
        Ok(chunk_rx)
    }

    #[allow(clippy::too_many_arguments)]
    fn handle_streaming_callback(
        data: &[f32],
        is_recording: &Arc<Mutex<bool>>,
        full_audio_data: &Arc<Mutex<Vec<f32>>>,
        pending_samples: &Arc<Mutex<Vec<f32>>>,
        chunk_tx: &mpsc::Sender<AudioChunkData>,
        level_callback: &Arc<Mutex<Option<StreamingLevelCallback>>>,
        smoothed_level: &Arc<Mutex<f32>>,
        start_time: &Arc<Mutex<Option<std::time::Instant>>>,
        vad_hangover: &Arc<Mutex<usize>>,
        agc_gain: &Arc<Mutex<f32>>,
        last_emit_time: &Arc<Mutex<Instant>>,
        device_sample_rate: u32,
        channels: u16,
    ) {
        if !*is_recording.lock().unwrap() {
            return;
        }

        full_audio_data.lock().unwrap().extend_from_slice(data);

        let mono = to_mono(data, channels);
        let resampled = resample(&mono, device_sample_rate, TARGET_SAMPLE_RATE);

        {
            let mut last_emit = last_emit_time.lock().unwrap();
            if last_emit.elapsed().as_millis() >= AUDIO_LEVEL_EMIT_INTERVAL_MS {
                let level = utils::calculate_audio_level(&resampled);
                let mut current_smoothed = smoothed_level.lock().unwrap();
                *current_smoothed = utils::smooth_level(*current_smoothed, level);

                let waveform = utils::generate_waveform(&resampled, 9);

                if let Some(ref callback) = *level_callback.lock().unwrap() {
                    callback(*current_smoothed, waveform);
                }
                *last_emit = Instant::now();
            }
        }

        let mut pending = pending_samples.lock().unwrap();
        pending.extend(resampled);

        while pending.len() >= CHUNK_SAMPLES {
            let mut chunk_f32: Vec<f32> = pending.drain(..CHUNK_SAMPLES).collect();

            let is_active = utils::is_voice_active(&chunk_f32);
            let mut hangover = vad_hangover.lock().unwrap();

            if is_active {
                *hangover = VAD_HANGOVER_CHUNKS;
            } else if *hangover > 0 {
                *hangover -= 1;
            }

            if !is_active && *hangover == 0 {
                let mut gain = agc_gain.lock().unwrap();
                *gain = *gain * 0.5 + 0.5;
                continue;
            }
            drop(hangover);

            let mut gain = agc_gain.lock().unwrap();
            utils::apply_agc(&mut chunk_f32, &mut gain);
            drop(gain);

            let chunk_i16: Vec<i16> = chunk_f32
                .iter()
                .map(|&s| (s * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16)
                .collect();

            let timestamp_ms = start_time
                .lock()
                .unwrap()
                .map(|t| t.elapsed().as_millis() as u64)
                .unwrap_or(0);

            let chunk_data = AudioChunkData {
                samples: chunk_i16,
                timestamp_ms,
            };

            if chunk_tx.try_send(chunk_data).is_err() {
                log_warn!("音频块通道已满，丢弃块");
            }
        }
    }

    pub fn stop_streaming(&mut self) -> Result<AudioData, RecordingError> {
        {
            let is_recording = self.is_recording.lock().unwrap();
            if !*is_recording {
                return Err(RecordingError::NotRecording);
            }
        }

        log_info!("停止流式录音...");

        std::thread::sleep(std::time::Duration::from_millis(200));

        *self.is_recording.lock().unwrap() = false;
        *self.recording_mode.lock().unwrap() = None;

        std::thread::sleep(std::time::Duration::from_millis(100));

        self.stream = None;
        self.chunk_sender = None;

        let raw_audio = self.full_audio_data.lock().unwrap().clone();

        if raw_audio.is_empty() {
            log_warn!("没有录制到音频数据");
            return Ok(AudioData::new(Vec::new(), TARGET_SAMPLE_RATE, 1));
        }

        let mono_audio = to_mono(&raw_audio, self.channels);
        let resampled_audio = resample(&mono_audio, self.device_sample_rate, TARGET_SAMPLE_RATE);

        let audio_data = AudioData::new(resampled_audio, TARGET_SAMPLE_RATE, 1);
        log_info!(
            "流式录音停止，完整音频时长: {}ms",
            audio_data.duration_ms
        );

        Ok(audio_data)
    }

    pub fn cancel(&mut self) {
        log_info!("取消流式录音");

        *self.is_recording.lock().unwrap() = false;
        *self.recording_mode.lock().unwrap() = None;
        self.stream = None;
        self.chunk_sender = None;
        self.full_audio_data.lock().unwrap().clear();
    }

    pub fn is_recording(&self) -> bool {
        *self.is_recording.lock().unwrap()
    }

    pub fn recording_mode(&self) -> Option<RecordingMode> {
        *self.recording_mode.lock().unwrap()
    }
}

unsafe impl Send for StreamingRecorder {}
unsafe impl Sync for StreamingRecorder {}
