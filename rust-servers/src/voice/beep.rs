// 音频反馈播放器模块
// 使用 rodio 实现录音开始/结束提示音

use rodio::{OutputStreamBuilder, Sink, Source};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// 日志宏
macro_rules! log_debug {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[DEBUG] [beep] {}", format!($($arg)*));
        }
    };
}

macro_rules! log_error {
    ($($arg:tt)*) => {
        eprintln!("[ERROR] [beep] {}", format!($($arg)*));
    };
}

/// 提示音类型
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BeepType {
    /// 录音开始提示音 (上升音调)
    RecordingStart,
    /// 录音结束提示音 (下降音调)
    RecordingStop,
}

/// 音频反馈播放器
/// 
/// 使用 rodio 生成简单的正弦波提示音
pub struct BeepPlayer {
    /// 是否启用音频反馈
    enabled: Arc<AtomicBool>,
    /// 音量 (0.0 - 1.0)
    volume: f32,
}

impl Default for BeepPlayer {
    fn default() -> Self {
        Self::new()
    }
}

impl BeepPlayer {
    /// 创建新的播放器实例
    pub fn new() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(true)),
            volume: 0.3, // 默认音量 30%
        }
    }

    /// 创建带自定义音量的播放器
    pub fn with_volume(volume: f32) -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(true)),
            volume: volume.clamp(0.0, 1.0),
        }
    }

    /// 设置是否启用音频反馈
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
    }

    /// 检查是否启用音频反馈
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    /// 设置音量
    pub fn set_volume(&mut self, volume: f32) {
        self.volume = volume.clamp(0.0, 1.0);
    }

    /// 获取当前音量
    pub fn volume(&self) -> f32 {
        self.volume
    }

    /// 播放录音开始提示音 (非阻塞)
    pub fn play_start(&self) {
        self.play(BeepType::RecordingStart);
    }

    /// 播放录音结束提示音 (非阻塞)
    pub fn play_stop(&self) {
        self.play(BeepType::RecordingStop);
    }

    /// 播放指定类型的提示音 (非阻塞)
    pub fn play(&self, beep_type: BeepType) {
        if !self.is_enabled() {
            log_debug!("音频反馈已禁用，跳过播放");
            return;
        }

        let volume = self.volume;
        
        // 在新线程中播放，避免阻塞
        std::thread::spawn(move || {
            if let Err(e) = play_beep_blocking(beep_type, volume) {
                log_error!("播放提示音失败: {}", e);
            }
        });
    }
}

/// 阻塞式播放提示音
fn play_beep_blocking(beep_type: BeepType, volume: f32) -> Result<(), BeepError> {
    // 获取音频输出流 (rodio 0.21 新 API)
    let stream = OutputStreamBuilder::open_default_stream()
        .map_err(|e| BeepError::OutputStreamError(e.to_string()))?;
    
    let mixer = stream.mixer();
    let sink = Sink::connect_new(&mixer);

    // 根据提示音类型生成不同的音调
    let source = match beep_type {
        BeepType::RecordingStart => {
            // 上升音调: 440Hz -> 880Hz (A4 -> A5)
            create_sweep_tone(440.0, 880.0, 150, volume)
        }
        BeepType::RecordingStop => {
            // 下降音调: 880Hz -> 440Hz (A5 -> A4)
            create_sweep_tone(880.0, 440.0, 150, volume)
        }
    };

    sink.append(source);
    sink.sleep_until_end();

    Ok(())
}

/// 创建频率扫描音调
fn create_sweep_tone(
    start_freq: f32,
    end_freq: f32,
    duration_ms: u64,
    volume: f32,
) -> SweepTone {
    SweepTone::new(start_freq, end_freq, duration_ms, volume)
}

/// 频率扫描音调源
struct SweepTone {
    sample_rate: u32,
    start_freq: f32,
    end_freq: f32,
    duration_samples: u64,
    current_sample: u64,
    volume: f32,
}

impl SweepTone {
    fn new(start_freq: f32, end_freq: f32, duration_ms: u64, volume: f32) -> Self {
        let sample_rate = 44100;
        let duration_samples = (sample_rate as u64 * duration_ms) / 1000;
        
        Self {
            sample_rate,
            start_freq,
            end_freq,
            duration_samples,
            current_sample: 0,
            volume,
        }
    }
}

impl Iterator for SweepTone {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.current_sample >= self.duration_samples {
            return None;
        }

        // 计算当前进度 (0.0 - 1.0)
        let progress = self.current_sample as f32 / self.duration_samples as f32;
        
        // 线性插值计算当前频率
        let freq = self.start_freq + (self.end_freq - self.start_freq) * progress;
        
        // 计算相位
        let t = self.current_sample as f32 / self.sample_rate as f32;
        
        // 生成正弦波
        let sample = (2.0 * std::f32::consts::PI * freq * t).sin();
        
        // 应用淡入淡出包络，避免爆音
        let envelope = calculate_envelope(progress);
        
        self.current_sample += 1;
        
        Some(sample * self.volume * envelope)
    }
}

impl Source for SweepTone {
    fn current_span_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        1 // 单声道
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        let duration_ms = (self.duration_samples * 1000) / self.sample_rate as u64;
        Some(Duration::from_millis(duration_ms))
    }
}

/// 计算包络 (淡入淡出)
fn calculate_envelope(progress: f32) -> f32 {
    const FADE_DURATION: f32 = 0.1; // 10% 淡入淡出
    
    if progress < FADE_DURATION {
        // 淡入
        progress / FADE_DURATION
    } else if progress > (1.0 - FADE_DURATION) {
        // 淡出
        (1.0 - progress) / FADE_DURATION
    } else {
        // 中间部分保持最大音量
        1.0
    }
}

/// 提示音播放错误
#[derive(Debug, thiserror::Error)]
pub enum BeepError {
    #[error("无法获取音频输出流: {0}")]
    OutputStreamError(String),
    
    #[error("无法创建音频 Sink: {0}")]
    SinkError(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_beep_player_creation() {
        let player = BeepPlayer::new();
        assert!(player.is_enabled());
        assert!((player.volume() - 0.3).abs() < 0.001);
    }

    #[test]
    fn test_beep_player_with_volume() {
        let player = BeepPlayer::with_volume(0.5);
        assert!((player.volume() - 0.5).abs() < 0.001);
    }

    #[test]
    fn test_beep_player_volume_clamping() {
        let player = BeepPlayer::with_volume(1.5);
        assert!((player.volume() - 1.0).abs() < 0.001);

        let player = BeepPlayer::with_volume(-0.5);
        assert!((player.volume() - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_beep_player_enable_disable() {
        let player = BeepPlayer::new();
        
        assert!(player.is_enabled());
        
        player.set_enabled(false);
        assert!(!player.is_enabled());
        
        player.set_enabled(true);
        assert!(player.is_enabled());
    }

    #[test]
    fn test_sweep_tone_generation() {
        let tone = SweepTone::new(440.0, 880.0, 100, 0.5);
        
        assert_eq!(tone.channels(), 1);
        assert_eq!(tone.sample_rate(), 44100);
        assert!(tone.total_duration().is_some());
    }

    #[test]
    fn test_sweep_tone_samples() {
        let tone = SweepTone::new(440.0, 880.0, 10, 0.5);
        let samples: Vec<f32> = tone.collect();
        
        // 10ms @ 44100Hz = 441 samples
        assert_eq!(samples.len(), 441);
        
        // 所有样本应该在 -1.0 到 1.0 范围内
        for sample in &samples {
            assert!(*sample >= -1.0 && *sample <= 1.0);
        }
    }

    #[test]
    fn test_envelope_calculation() {
        // 开始时应该是 0
        assert!((calculate_envelope(0.0) - 0.0).abs() < 0.001);
        
        // 中间应该是 1
        assert!((calculate_envelope(0.5) - 1.0).abs() < 0.001);
        
        // 结束时应该是 0
        assert!((calculate_envelope(1.0) - 0.0).abs() < 0.001);
    }

    #[test]
    fn test_beep_type_equality() {
        assert_eq!(BeepType::RecordingStart, BeepType::RecordingStart);
        assert_ne!(BeepType::RecordingStart, BeepType::RecordingStop);
    }
}
