// 音频工具函数模块
// 提供 AGC (自动增益控制)、VAD (静音检测)、RMS 计算、波形生成等功能

// ============================================================================
// AGC (Automatic Gain Control) 配置常量
// ============================================================================

/// AGC 目标 RMS 值
/// 
/// 自动增益控制会将音频信号调整到此目标音量级别。
/// 较高的值会使输出更响亮，较低的值会使输出更安静。
/// 
/// 默认值 0.10 是经过实际测试的平衡值，适合大多数语音输入场景。
/// - 太高 (>0.15): 可能导致削波失真
/// - 太低 (<0.05): 语音可能不够清晰
pub const AGC_TARGET_RMS: f32 = 0.10;

/// AGC 最大增益倍数
/// 
/// 限制对微弱声音的最大放大倍数，防止过度放大背景噪声。
/// 当输入音量很低时，增益会被限制在此值以内。
/// 
/// 默认值 5.0 允许将微弱语音放大到可识别水平，同时避免噪声爆炸。
/// - 太高 (>8.0): 可能放大过多背景噪声
/// - 太低 (<2.0): 微弱语音可能无法被充分放大
pub const AGC_MAX_GAIN: f32 = 5.0;

/// AGC 最小增益倍数
/// 
/// 限制对大声音的最小压缩倍数，防止过度压缩导致失真。
/// 当输入音量很高时，增益会被限制在此值以上。
/// 
/// 默认值 0.1 允许将过响的声音压缩到安全范围，同时保持动态范围。
/// - 太高 (>0.3): 大声音可能无法被充分压缩
/// - 太低 (<0.05): 可能导致过度压缩，声音不自然
pub const AGC_MIN_GAIN: f32 = 0.1;

/// AGC 底噪阈值
/// 
/// 当输入 RMS 低于此阈值时，AGC 会保持增益为 1.0，避免放大背景噪声。
/// 这是区分"有效语音"和"环境噪声"的关键参数。
/// 
/// 默认值 0.003 适合安静到中等噪声的环境。
/// - 太高 (>0.01): 可能误判轻声语音为噪声
/// - 太低 (<0.001): 可能放大环境噪声
/// 
/// 注意：此值与 VAD_VOICE_THRESHOLD 保持一致，确保 AGC 和 VAD 行为协调。
pub const AGC_NOISE_FLOOR: f32 = 0.003;

// ============================================================================
// AGC 函数
// ============================================================================

/// AGC：自动增益控制（带平滑处理）
/// 
/// 根据输入音量自动调整增益，使输出音量保持在目标范围内。
/// 使用平滑过渡避免突变，使用 tanh 软限幅防止失真。
/// 
/// # Arguments
/// * `samples` - 待处理的音频样本（会被原地修改）
/// * `current_gain` - 当前增益状态，用于平滑过渡（会被更新）
/// 
/// # Algorithm
/// 1. 计算当前块的 RMS
/// 2. 如果 RMS < NOISE_FLOOR，保持增益为 1.0（避免放大噪声）
/// 3. 否则计算目标增益 = TARGET_RMS / RMS，限制在 [MIN_GAIN, MAX_GAIN]
/// 4. 平滑过渡：Attack 快（0.5），Release 慢（0.1）
/// 5. 应用增益并使用 tanh 软限幅
/// 
/// # Example
/// ```
/// let mut samples = vec![0.1, 0.2, -0.1, 0.15];
/// let mut gain = 1.0;
/// apply_agc(&mut samples, &mut gain);
/// // samples 现在已被 AGC 处理
/// ```
pub fn apply_agc(samples: &mut [f32], current_gain: &mut f32) {
    if samples.is_empty() {
        return;
    }
    
    let rms = calculate_rms(samples);
    
    // 底噪时保持增益为 1.0，避免放大背景噪声
    let target_gain = if rms < AGC_NOISE_FLOOR {
        1.0
    } else {
        (AGC_TARGET_RMS / rms).clamp(AGC_MIN_GAIN, AGC_MAX_GAIN)
    };
    
    // 增益平滑过渡：
    // - Attack 快 (alpha=0.5)：快速响应突然变大的声音，防止爆音
    // - Release 慢 (alpha=0.1)：缓慢恢复增益，防止呼吸效应
    let alpha = if target_gain < *current_gain { 0.5 } else { 0.1 };
    *current_gain = *current_gain * (1.0 - alpha) + target_gain * alpha;
    
    // 应用增益并使用 tanh 软限幅防止失真
    for s in samples.iter_mut() {
        *s = (*s * *current_gain).tanh();
    }
}

// ============================================================================
// VAD (Voice Activity Detection) 配置常量
// ============================================================================

/// 语音活动检测阈值 (RMS 值高于此阈值视为有语音)
///
/// 与 AGC_NOISE_FLOOR 保持一致，确保增益控制与语音检测的判断基准统一。
pub const VAD_VOICE_THRESHOLD: f32 = AGC_NOISE_FLOOR;

/// 音频级别映射增益 (用于 UI 显示灵敏度)
pub const AUDIO_LEVEL_GAIN: f32 = 8.0;

/// 平滑过渡参数（轻量平滑）
pub const SMOOTH_RISE_NEW: f32 = 0.8;
pub const SMOOTH_RISE_OLD: f32 = 0.2;
pub const SMOOTH_FALL_NEW: f32 = 0.6;
pub const SMOOTH_FALL_OLD: f32 = 0.4;

/// 计算原始 RMS 值
pub fn calculate_rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    let sum: f64 = samples.iter().map(|&s| (s as f64).powi(2)).sum();
    (sum / samples.len() as f64).sqrt() as f32
}

/// 计算音频级别（用于 UI 显示，0.0 到 1.0）
///
/// 使用 RMS * GAIN 后进行平方根压缩，保留动态范围并提升灵敏度。
pub fn calculate_audio_level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    let rms = calculate_rms(samples);
    let normalized = (rms * AUDIO_LEVEL_GAIN).min(1.0);
    normalized.sqrt().max(0.0).min(1.0)
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
        let level = calculate_audio_level(samples);
        return vec![level; num_bars];
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
        let level = calculate_audio_level(chunk);
        waveform.push(level);
    }
    waveform
}

/// VAD：基于 RMS 阈值判断是否有语音
pub fn is_voice_active(samples: &[f32]) -> bool {
    calculate_rms(samples) > VAD_VOICE_THRESHOLD
}

/// 检测是否为静音
pub fn is_silence(samples: &[f32]) -> bool {
    !is_voice_active(samples)
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
