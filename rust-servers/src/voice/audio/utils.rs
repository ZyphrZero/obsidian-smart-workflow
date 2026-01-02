// 音频工具函数模块
// 提供 VAD (静音检测)、RMS 计算、波形生成等功能

/// 静音检测阈值 (RMS 值低于此阈值视为静音)
pub const VAD_THRESHOLD: f32 = 0.01;

/// RMS 放大系数 (使音量显示更敏感)
pub const RMS_AMPLIFICATION: f32 = 1.5;

/// 平滑过渡参数
pub const SMOOTH_RISE_NEW: f32 = 0.7;
pub const SMOOTH_RISE_OLD: f32 = 0.3;
pub const SMOOTH_FALL_NEW: f32 = 0.4;
pub const SMOOTH_FALL_OLD: f32 = 0.6;

/// 计算音频样本的 RMS (Root Mean Square) 音量级别
pub fn calculate_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    let sum: f64 = samples.iter().map(|&s| (s as f64).powi(2)).sum();
    let rms = (sum / samples.len() as f64).sqrt() as f32;
    let amplified = rms * RMS_AMPLIFICATION;
    let normalized = (amplified * 3.0).min(1.0);

    if normalized > 0.0 {
        ((normalized.ln() + 4.0) / 4.0).max(0.0).min(1.0)
    } else {
        0.0
    }
}

/// 计算原始 RMS 值 (不应用放大和归一化)
pub fn calculate_raw_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples.iter().map(|&s| (s as f64).powi(2)).sum();
    (sum / samples.len() as f64).sqrt() as f32
}

/// 应用平滑过渡
pub fn smooth_level(current: f32, target: f32) -> f32 {
    if target > current {
        current * SMOOTH_RISE_OLD + target * SMOOTH_RISE_NEW
    } else {
        current * SMOOTH_FALL_OLD + target * SMOOTH_FALL_NEW
    }
}

/// 生成波形数据 (用于 UI 显示)
pub fn generate_waveform(samples: &[f32], num_bars: usize) -> Vec<f32> {
    if samples.is_empty() || num_bars == 0 {
        return vec![0.0; num_bars];
    }

    let chunk_size = samples.len() / num_bars;
    if chunk_size == 0 {
        let rms = calculate_rms(samples);
        return vec![rms; num_bars];
    }

    let mut waveform = Vec::with_capacity(num_bars);
    for i in 0..num_bars {
        let start = i * chunk_size;
        let end = if i == num_bars - 1 {
            samples.len()
        } else {
            (i + 1) * chunk_size
        };
        let chunk = &samples[start..end];
        let rms = calculate_rms(chunk);
        waveform.push(rms);
    }
    waveform
}

/// 检测是否为静音
pub fn is_silence(samples: &[f32]) -> bool {
    calculate_raw_rms(samples) < VAD_THRESHOLD
}

/// 计算音频时长 (毫秒)
pub fn calculate_duration_ms(sample_count: usize, sample_rate: u32, channels: u16) -> u64 {
    if sample_rate == 0 || channels == 0 {
        return 0;
    }
    (sample_count as u64 * 1000) / (sample_rate as u64 * channels as u64)
}

/// 计算峰值音量
pub fn calculate_peak(samples: &[f32]) -> f32 {
    samples
        .iter()
        .map(|&s| s.abs())
        .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        .unwrap_or(0.0)
}

/// 归一化音频数据
pub fn normalize(samples: &mut [f32]) {
    let peak = calculate_peak(samples);
    if peak > 0.0 && peak < 1.0 {
        let scale = 1.0 / peak;
        for sample in samples.iter_mut() {
            *sample *= scale;
        }
    }
}
