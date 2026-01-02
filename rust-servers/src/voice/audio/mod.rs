// 音频模块
// 包含录音、流式处理、编码和工具函数

pub mod encoder;
pub mod recorder;
pub mod streaming;
pub mod utils;

// 重新导出常用类型
pub use encoder::{encode_to_wav, encode_samples_to_wav, encode_i16_to_wav, WavEncoder, EncodingError};
pub use recorder::{AudioRecorder, RecordingError, RecordingMode, TARGET_SAMPLE_RATE};
pub use streaming::{StreamingRecorder, AudioChunkData, CHUNK_SAMPLES};

/// 音频数据
#[derive(Debug, Clone)]
pub struct AudioData {
    /// 音频采样数据 (f32 格式，范围 -1.0 到 1.0)
    pub samples: Vec<f32>,
    /// 采样率
    pub sample_rate: u32,
    /// 声道数
    pub channels: u16,
    /// 时长 (毫秒)
    pub duration_ms: u64,
}

impl AudioData {
    /// 创建新的音频数据
    pub fn new(samples: Vec<f32>, sample_rate: u32, channels: u16) -> Self {
        let duration_ms = if sample_rate > 0 && channels > 0 {
            (samples.len() as u64 * 1000) / (sample_rate as u64 * channels as u64)
        } else {
            0
        };

        Self {
            samples,
            sample_rate,
            channels,
            duration_ms,
        }
    }

    /// 检查音频数据是否为空
    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }

    /// 获取采样数量
    pub fn sample_count(&self) -> usize {
        self.samples.len()
    }

    /// 编码为 WAV 格式
    pub fn to_wav(&self) -> Result<Vec<u8>, EncodingError> {
        encode_to_wav(self)
    }
}

/// 音频块 (用于流式传输)
#[derive(Debug, Clone)]
pub struct AudioChunk {
    /// 音频数据 (PCM 字节)
    pub data: Vec<u8>,
    /// 时间戳 (毫秒)
    pub timestamp: u64,
    /// 采样率
    pub sample_rate: u32,
}

/// 波形数据 (用于 UI 显示)
#[derive(Debug, Clone, serde::Serialize)]
pub struct WaveformData {
    /// 音量级别 (0-1 范围)
    pub levels: Vec<f32>,
    /// 时间戳 (毫秒)
    pub timestamp: u64,
}

impl WaveformData {
    /// 创建新的波形数据
    pub fn new(levels: Vec<f32>, timestamp: u64) -> Self {
        Self { levels, timestamp }
    }

    /// 创建空的波形数据
    pub fn empty() -> Self {
        Self {
            levels: vec![0.0; 9], // 9 条柱状图
            timestamp: 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audio_data_new() {
        let samples = vec![0.0f32; 16000]; // 1 秒 @ 16kHz
        let audio = AudioData::new(samples, 16000, 1);

        assert_eq!(audio.sample_count(), 16000);
        assert_eq!(audio.duration_ms, 1000);
        assert!(!audio.is_empty());
    }

    #[test]
    fn test_audio_data_empty() {
        let audio = AudioData::new(Vec::new(), 16000, 1);

        assert!(audio.is_empty());
        assert_eq!(audio.duration_ms, 0);
    }

    #[test]
    fn test_audio_data_stereo() {
        let samples = vec![0.0f32; 32000]; // 1 秒 @ 16kHz 立体声
        let audio = AudioData::new(samples, 16000, 2);

        assert_eq!(audio.duration_ms, 1000);
    }

    #[test]
    fn test_audio_data_to_wav() {
        let samples = vec![0.0f32, 0.5, -0.5];
        let audio = AudioData::new(samples, 16000, 1);

        let wav = audio.to_wav().unwrap();
        assert!(!wav.is_empty());
        assert_eq!(&wav[0..4], b"RIFF");
    }

    #[test]
    fn test_waveform_data() {
        let waveform = WaveformData::new(vec![0.5; 9], 1000);

        assert_eq!(waveform.levels.len(), 9);
        assert_eq!(waveform.timestamp, 1000);
    }

    #[test]
    fn test_waveform_data_empty() {
        let waveform = WaveformData::empty();

        assert_eq!(waveform.levels.len(), 9);
        assert!(waveform.levels.iter().all(|&v| v == 0.0));
    }
}
