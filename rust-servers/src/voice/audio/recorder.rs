// 音频录制模块
// 使用 cpal 实现跨平台音频采集，支持 Press/Toggle 录音模式

macro_rules! log_info {
    ($($arg:tt)*) => {
        eprintln!("[INFO] [recorder] {}", format!($($arg)*));
    };
}

macro_rules! log_debug {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[DEBUG] [recorder] {}", format!($($arg)*));
        }
    };
}

macro_rules! log_warn {
    ($($arg:tt)*) => {
        eprintln!("[WARN] [recorder] {}", format!($($arg)*));
    };
}

macro_rules! log_error {
    ($($arg:tt)*) => {{
        eprintln!("[ERROR] [recorder] {}", format!($($arg)*))
    }};
}

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Stream;
use std::sync::{Arc, Mutex};
use thiserror::Error;

use super::{AudioData, utils};

/// API 要求的目标采样率 (16kHz)
pub const TARGET_SAMPLE_RATE: u32 = 16000;

/// 录音模式
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RecordingMode {
    Press,
    Toggle,
}

/// 录音错误类型
#[derive(Debug, Error)]
pub enum RecordingError {
    #[error("麦克风不可用: {0}")]
    MicrophoneUnavailable(String),

    #[error("音频录制权限被拒绝")]
    PermissionDenied,

    #[error("音频设备错误: {0}")]
    DeviceError(String),

    #[error("已在录音中")]
    AlreadyRecording,

    #[error("未在录音中")]
    NotRecording,

    #[error("音频编码错误: {0}")]
    EncodingError(String),

    #[error("不支持的采样格式: {0}")]
    UnsupportedSampleFormat(String),
}

/// 音频级别回调类型
pub type AudioLevelCallback = Box<dyn Fn(f32, Vec<f32>) + Send + 'static>;

/// 音频录制器
pub struct AudioRecorder {
    device_sample_rate: u32,
    channels: u16,
    audio_data: Arc<Mutex<Vec<f32>>>,
    is_recording: Arc<Mutex<bool>>,
    recording_mode: Arc<Mutex<Option<RecordingMode>>>,
    stream: Option<Stream>,
    level_callback: Arc<Mutex<Option<AudioLevelCallback>>>,
    smoothed_level: Arc<Mutex<f32>>,
}

impl AudioRecorder {
    pub fn new() -> Result<Self, RecordingError> {
        Ok(Self {
            device_sample_rate: 48000,
            channels: 1,
            audio_data: Arc::new(Mutex::new(Vec::new())),
            is_recording: Arc::new(Mutex::new(false)),
            recording_mode: Arc::new(Mutex::new(None)),
            stream: None,
            level_callback: Arc::new(Mutex::new(None)),
            smoothed_level: Arc::new(Mutex::new(0.0)),
        })
    }

    pub fn set_level_callback<F>(&mut self, callback: F)
    where
        F: Fn(f32, Vec<f32>) + Send + 'static,
    {
        let mut cb = self.level_callback.lock().unwrap();
        *cb = Some(Box::new(callback));
    }

    pub fn start(&mut self, mode: RecordingMode) -> Result<(), RecordingError> {
        {
            let is_recording = self.is_recording.lock().unwrap();
            if *is_recording {
                return Err(RecordingError::AlreadyRecording);
            }
        }

        log_info!("开始录音，模式: {:?}", mode);

        self.audio_data.lock().unwrap().clear();
        *self.is_recording.lock().unwrap() = true;
        *self.recording_mode.lock().unwrap() = Some(mode);
        *self.smoothed_level.lock().unwrap() = 0.0;

        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| RecordingError::MicrophoneUnavailable("没有找到默认音频输入设备".to_string()))?;

        let supported_config = device
            .default_input_config()
            .map_err(|e| RecordingError::DeviceError(format!("无法获取默认音频配置: {}", e)))?;

        log_debug!("设备支持的配置: {:?}", supported_config);

        let config = supported_config.config();
        self.device_sample_rate = config.sample_rate.0;
        self.channels = config.channels;

        log_info!(
            "设备配置: 采样率={}Hz, 声道={}, 目标采样率={}Hz",
            self.device_sample_rate,
            self.channels,
            TARGET_SAMPLE_RATE
        );

        let audio_data = Arc::clone(&self.audio_data);
        let is_recording = Arc::clone(&self.is_recording);
        let level_callback = Arc::clone(&self.level_callback);
        let smoothed_level = Arc::clone(&self.smoothed_level);
        let device_sample_rate = self.device_sample_rate;
        let channels = self.channels;
        let callback_counter = Arc::new(Mutex::new(0u32));

        let err_fn = |err| log_error!("录音流错误: {}", err);

        let stream = match supported_config.sample_format() {
            cpal::SampleFormat::F32 => {
                let callback_counter = Arc::clone(&callback_counter);
                device
                    .build_input_stream(
                        &config,
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            Self::handle_audio_callback(
                                data,
                                &audio_data,
                                &is_recording,
                                &level_callback,
                                &smoothed_level,
                                &callback_counter,
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
                let audio_data = Arc::clone(&audio_data);
                let is_recording = Arc::clone(&is_recording);
                let level_callback = Arc::clone(&level_callback);
                let smoothed_level = Arc::clone(&smoothed_level);
                let callback_counter = Arc::clone(&callback_counter);

                device
                    .build_input_stream(
                        &config,
                        move |data: &[i16], _: &cpal::InputCallbackInfo| {
                            let f32_data: Vec<f32> = convert_i16_to_f32(data);
                            Self::handle_audio_callback(
                                &f32_data,
                                &audio_data,
                                &is_recording,
                                &level_callback,
                                &smoothed_level,
                                &callback_counter,
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
                let audio_data = Arc::clone(&audio_data);
                let is_recording = Arc::clone(&is_recording);
                let level_callback = Arc::clone(&level_callback);
                let smoothed_level = Arc::clone(&smoothed_level);
                let callback_counter = Arc::clone(&callback_counter);

                device
                    .build_input_stream(
                        &config,
                        move |data: &[u16], _: &cpal::InputCallbackInfo| {
                            let f32_data: Vec<f32> = convert_u16_to_f32(data);
                            Self::handle_audio_callback(
                                &f32_data,
                                &audio_data,
                                &is_recording,
                                &level_callback,
                                &smoothed_level,
                                &callback_counter,
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
                return Err(RecordingError::UnsupportedSampleFormat(format!("{:?}", format)));
            }
        };

        stream
            .play()
            .map_err(|e| RecordingError::DeviceError(e.to_string()))?;

        self.stream = Some(stream);
        log_info!("录音已启动");
        Ok(())
    }

    fn handle_audio_callback(
        data: &[f32],
        audio_data: &Arc<Mutex<Vec<f32>>>,
        is_recording: &Arc<Mutex<bool>>,
        level_callback: &Arc<Mutex<Option<AudioLevelCallback>>>,
        smoothed_level: &Arc<Mutex<f32>>,
        callback_counter: &Arc<Mutex<u32>>,
        _device_sample_rate: u32,
        _channels: u16,
    ) {
        if !*is_recording.lock().unwrap() {
            return;
        }

        audio_data.lock().unwrap().extend_from_slice(data);

        let mut counter = callback_counter.lock().unwrap();
        *counter += 1;

        if *counter % 2 == 0 {
            let raw_level = utils::calculate_rms(data);
            let mut current_smoothed = smoothed_level.lock().unwrap();
            *current_smoothed = utils::smooth_level(*current_smoothed, raw_level);
            let waveform = utils::generate_waveform(data, 9);

            if let Some(ref callback) = *level_callback.lock().unwrap() {
                callback(*current_smoothed, waveform);
            }
        }
    }

    pub fn stop(&mut self) -> Result<AudioData, RecordingError> {
        {
            let is_recording = self.is_recording.lock().unwrap();
            if !*is_recording {
                return Err(RecordingError::NotRecording);
            }
        }

        log_info!("停止录音...");

        *self.is_recording.lock().unwrap() = false;
        *self.recording_mode.lock().unwrap() = None;
        self.stream = None;

        std::thread::sleep(std::time::Duration::from_millis(100));

        let raw_audio = self.audio_data.lock().unwrap().clone();
        let original_len = raw_audio.len();

        if raw_audio.is_empty() {
            log_warn!("没有录制到音频数据");
            return Ok(AudioData::new(Vec::new(), TARGET_SAMPLE_RATE, 1));
        }

        let mono_audio = to_mono(&raw_audio, self.channels);
        log_debug!("转单声道: {} -> {} 样本", original_len, mono_audio.len());

        let resampled_audio = resample(&mono_audio, self.device_sample_rate, TARGET_SAMPLE_RATE);
        log_debug!(
            "降采样: {}Hz -> {}Hz, {} -> {} 样本",
            self.device_sample_rate,
            TARGET_SAMPLE_RATE,
            mono_audio.len(),
            resampled_audio.len()
        );

        let audio_data = AudioData::new(resampled_audio, TARGET_SAMPLE_RATE, 1);
        log_info!("录音完成，时长: {}ms", audio_data.duration_ms);

        Ok(audio_data)
    }

    pub fn cancel(&mut self) {
        log_info!("取消录音");
        *self.is_recording.lock().unwrap() = false;
        *self.recording_mode.lock().unwrap() = None;
        self.stream = None;
        self.audio_data.lock().unwrap().clear();
    }

    pub fn is_recording(&self) -> bool {
        *self.is_recording.lock().unwrap()
    }

    pub fn recording_mode(&self) -> Option<RecordingMode> {
        *self.recording_mode.lock().unwrap()
    }
}

// ============================================================================
// 音频格式转换函数
// ============================================================================

#[inline]
pub fn convert_i16_to_f32(data: &[i16]) -> Vec<f32> {
    data.iter().map(|&s| s as f32 / i16::MAX as f32).collect()
}

#[inline]
pub fn convert_u16_to_f32(data: &[u16]) -> Vec<f32> {
    data.iter()
        .map(|&s| (s as f32 - 32768.0) / 32768.0)
        .collect()
}

#[inline]
pub fn convert_f32_to_i16(data: &[f32]) -> Vec<i16> {
    data.iter()
        .map(|&s| (s * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16)
        .collect()
}

pub fn to_mono(input: &[f32], channels: u16) -> Vec<f32> {
    if channels == 1 {
        return input.to_vec();
    }

    let channels = channels as usize;
    let output_len = input.len() / channels;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let mut sum = 0.0f32;
        for ch in 0..channels {
            sum += input[i * channels + ch];
        }
        output.push(sum / channels as f32);
    }

    output
}

pub fn resample(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return input.to_vec();
    }

    let ratio = from_rate as f64 / to_rate as f64;
    let output_len = (input.len() as f64 / ratio) as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_idx = i as f64 * ratio;
        let idx_floor = src_idx.floor() as usize;
        let idx_ceil = (idx_floor + 1).min(input.len().saturating_sub(1));
        let frac = src_idx - idx_floor as f64;

        if idx_floor < input.len() {
            let sample = input[idx_floor] as f64 * (1.0 - frac)
                + input.get(idx_ceil).copied().unwrap_or(0.0) as f64 * frac;
            output.push(sample as f32);
        }
    }

    output
}

unsafe impl Send for AudioRecorder {}
unsafe impl Sync for AudioRecorder {}
