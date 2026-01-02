// 音频编码模块
// 使用 hound 实现 WAV 编码

use hound::{SampleFormat, WavSpec, WavWriter};
use std::io::Cursor;
use thiserror::Error;

use super::recorder::TARGET_SAMPLE_RATE;
use super::AudioData;

/// 编码错误类型
#[derive(Debug, Error)]
pub enum EncodingError {
    #[error("WAV 编码错误: {0}")]
    WavError(String),

    #[error("IO 错误: {0}")]
    IoError(String),

    #[error("无效的音频数据")]
    InvalidAudioData,
}

impl From<hound::Error> for EncodingError {
    fn from(err: hound::Error) -> Self {
        EncodingError::WavError(err.to_string())
    }
}

impl From<std::io::Error> for EncodingError {
    fn from(err: std::io::Error) -> Self {
        EncodingError::IoError(err.to_string())
    }
}

/// WAV 编码器
pub struct WavEncoder {
    sample_rate: u32,
    channels: u16,
    bits_per_sample: u16,
}

impl WavEncoder {
    /// 创建新的 WAV 编码器
    pub fn new(sample_rate: u32, channels: u16, bits_per_sample: u16) -> Self {
        Self {
            sample_rate,
            channels,
            bits_per_sample,
        }
    }

    /// 创建默认配置的 WAV 编码器 (16kHz, 单声道, 16位)
    pub fn default_config() -> Self {
        Self::new(TARGET_SAMPLE_RATE, 1, 16)
    }

    /// 将 AudioData 编码为 WAV 格式字节数组
    pub fn encode(&self, audio: &AudioData) -> Result<Vec<u8>, EncodingError> {
        if audio.is_empty() {
            return Err(EncodingError::InvalidAudioData);
        }

        let spec = WavSpec {
            channels: self.channels,
            sample_rate: self.sample_rate,
            bits_per_sample: self.bits_per_sample,
            sample_format: SampleFormat::Int,
        };

        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = WavWriter::new(&mut cursor, spec)?;
            for &sample in audio.samples.iter() {
                let amplitude =
                    (sample * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
                writer.write_sample(amplitude)?;
            }
            writer.finalize()?;
        }

        Ok(cursor.into_inner())
    }

    /// 将 f32 采样数组编码为 WAV 格式字节数组
    pub fn encode_samples(&self, samples: &[f32]) -> Result<Vec<u8>, EncodingError> {
        if samples.is_empty() {
            return Err(EncodingError::InvalidAudioData);
        }

        let spec = WavSpec {
            channels: self.channels,
            sample_rate: self.sample_rate,
            bits_per_sample: self.bits_per_sample,
            sample_format: SampleFormat::Int,
        };

        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = WavWriter::new(&mut cursor, spec)?;
            for &sample in samples.iter() {
                let amplitude =
                    (sample * i16::MAX as f32).clamp(i16::MIN as f32, i16::MAX as f32) as i16;
                writer.write_sample(amplitude)?;
            }
            writer.finalize()?;
        }

        Ok(cursor.into_inner())
    }

    /// 将 i16 采样数组编码为 WAV 格式字节数组
    pub fn encode_i16_samples(&self, samples: &[i16]) -> Result<Vec<u8>, EncodingError> {
        if samples.is_empty() {
            return Err(EncodingError::InvalidAudioData);
        }

        let spec = WavSpec {
            channels: self.channels,
            sample_rate: self.sample_rate,
            bits_per_sample: self.bits_per_sample,
            sample_format: SampleFormat::Int,
        };

        let mut cursor = Cursor::new(Vec::new());
        {
            let mut writer = WavWriter::new(&mut cursor, spec)?;
            for &sample in samples.iter() {
                writer.write_sample(sample)?;
            }
            writer.finalize()?;
        }

        Ok(cursor.into_inner())
    }
}

/// 将 AudioData 编码为 WAV 格式 (便捷函数)
pub fn encode_to_wav(audio: &AudioData) -> Result<Vec<u8>, EncodingError> {
    let encoder = WavEncoder::new(audio.sample_rate, audio.channels, 16);
    encoder.encode(audio)
}

/// 将 f32 采样编码为 WAV 格式 (便捷函数)
pub fn encode_samples_to_wav(
    samples: &[f32],
    sample_rate: u32,
    channels: u16,
) -> Result<Vec<u8>, EncodingError> {
    let encoder = WavEncoder::new(sample_rate, channels, 16);
    encoder.encode_samples(samples)
}

/// 将 i16 采样编码为 WAV 格式 (便捷函数)
pub fn encode_i16_to_wav(
    samples: &[i16],
    sample_rate: u32,
    channels: u16,
) -> Result<Vec<u8>, EncodingError> {
    let encoder = WavEncoder::new(sample_rate, channels, 16);
    encoder.encode_i16_samples(samples)
}
