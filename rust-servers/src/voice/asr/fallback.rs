// 兜底策略模块
// 实现主引擎重试和备用引擎并行执行的智能兜底机制

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::voice::asr::{ASREngine, ASRError, RetryConfig, TranscriptionResult};
use crate::voice::audio::AudioData;
use crate::voice::config::ASRConfig;

/// 兜底策略
pub struct FallbackStrategy {
    primary: Box<dyn ASREngine>,
    fallbacks: Vec<Box<dyn ASREngine>>,
    enable_fallback: bool,
    retry_config: RetryConfig,
}

impl FallbackStrategy {
    pub fn new(
        primary: Box<dyn ASREngine>,
        fallbacks: Vec<Box<dyn ASREngine>>,
        enable_fallback: bool,
    ) -> Self {
        Self {
            primary,
            fallbacks,
            enable_fallback,
            retry_config: RetryConfig::default(),
        }
    }
    
    pub fn with_retry_config(
        primary: Box<dyn ASREngine>,
        fallbacks: Vec<Box<dyn ASREngine>>,
        enable_fallback: bool,
        retry_config: RetryConfig,
    ) -> Self {
        Self {
            primary,
            fallbacks,
            enable_fallback,
            retry_config,
        }
    }
    
    pub fn from_config(config: &ASRConfig) -> Result<Self, ASRError> {
        let primary = crate::voice::asr::create_engine(&config.primary)?;

        let mut fallbacks = Vec::new();
        for fallback_config in &config.fallbacks {
            fallbacks.push(crate::voice::asr::create_engine(fallback_config)?);
        }

        Ok(Self::new(primary, fallbacks, config.enable_fallback))
    }
    
    pub async fn transcribe(&self, audio: &AudioData) -> Result<TranscriptionResult, ASRError> {
        let start_time = Instant::now();
        let mut primary_errors: Vec<String> = Vec::new();
        
        for attempt in 0..=self.retry_config.max_retries {
            if attempt > 0 {
                let delay = Duration::from_millis(
                    self.retry_config.base_delay_ms * (1 << (attempt - 1))
                );
                eprintln!(
                    "[INFO] 主引擎重试 {}/{}, 等待 {}ms",
                    attempt,
                    self.retry_config.max_retries,
                    delay.as_millis()
                );
                tokio::time::sleep(delay).await;
            }
            
            match self.primary.transcribe(audio).await {
                Ok(text) => {
                    let duration_ms = start_time.elapsed().as_millis() as u64;
                    eprintln!(
                        "[INFO] 主引擎 {} 转录成功 (尝试 {}), 耗时 {}ms",
                        self.primary.name(),
                        attempt + 1,
                        duration_ms
                    );
                    return Ok(TranscriptionResult::new(
                        text,
                        self.primary.name().to_string(),
                        false,
                        duration_ms,
                    ));
                }
                Err(e) => {
                    eprintln!(
                        "[WARN] 主引擎 {} 转录失败 (尝试 {}/{}): {}",
                        self.primary.name(),
                        attempt + 1,
                        self.retry_config.max_retries + 1,
                        e
                    );
                    primary_errors.push(e.to_string());
                }
            }
        }
        
        // 主引擎失败，尝试备用引擎
        if self.enable_fallback && !self.fallbacks.is_empty() {
            let mut fallback_errors: Vec<String> = Vec::new();
            for fallback in &self.fallbacks {
                eprintln!("[INFO] 主引擎所有重试失败，尝试兜底引擎 {}...", fallback.name());
                match fallback.transcribe(audio).await {
                    Ok(text) => {
                        let duration_ms = start_time.elapsed().as_millis() as u64;
                        eprintln!(
                            "[INFO] 兜底引擎 {} 转录成功，耗时 {}ms",
                            fallback.name(),
                            duration_ms
                        );
                        return Ok(TranscriptionResult::new(
                            text,
                            fallback.name().to_string(),
                            true,
                            duration_ms,
                        ));
                    }
                    Err(fallback_error) => {
                        fallback_errors.push(format!("{}: {}", fallback.name(), fallback_error));
                    }
                }
            }

            return Err(ASRError::AllEnginesFailed {
                primary_error: primary_errors.join("; "),
                fallback_error: Some(fallback_errors.join("; ")),
            });
        }
        
        Err(ASRError::AllEnginesFailed {
            primary_error: primary_errors.join("; "),
            fallback_error: None,
        })
    }
    
    pub fn primary_provider(&self) -> String {
        self.primary.name().to_string()
    }
    
    pub fn is_fallback_enabled(&self) -> bool {
        self.enable_fallback && !self.fallbacks.is_empty()
    }
}

/// 带并行执行的兜底策略
pub struct ParallelFallbackStrategy {
    primary_config: crate::voice::config::ASRProviderConfig,
    fallback_config: Option<crate::voice::config::ASRProviderConfig>,
    enable_fallback: bool,
    retry_config: RetryConfig,
}

/// 竞速策略：主备并行执行，重试前优先检查备引擎结果
pub struct RaceStrategy {
    primary_config: crate::voice::config::ASRProviderConfig,
    fallback_config: Option<crate::voice::config::ASRProviderConfig>,
    enable_fallback: bool,
    retry_config: RetryConfig,
}

impl RaceStrategy {
    pub fn from_config(config: ASRConfig) -> Self {
        let ASRConfig {
            primary,
            fallbacks,
            enable_fallback,
            ..
        } = config;
        let fallback_config = fallbacks.into_iter().next();
        Self {
            primary_config: primary,
            fallback_config,
            enable_fallback,
            retry_config: RetryConfig::default(),
        }
    }

    pub fn with_retry_config(mut self, retry_config: RetryConfig) -> Self {
        self.retry_config = retry_config;
        self
    }

    pub async fn transcribe(&self, audio: &AudioData) -> Result<TranscriptionResult, ASRError> {
        let start_time = Instant::now();
        let fallback_result: Arc<Mutex<Option<Result<String, String>>>> =
            Arc::new(Mutex::new(None));

        let mut fallback_handle = if self.enable_fallback && self.fallback_config.is_some() {
            let fallback_config = self.fallback_config.clone().unwrap();
            let audio_clone = audio.clone();
            let result_holder = Arc::clone(&fallback_result);

            Some(tokio::spawn(async move {
                let engine = crate::voice::asr::create_engine(&fallback_config)?;
                let result = engine.transcribe(&audio_clone).await;
                let mut holder = result_holder.lock().unwrap();
                match &result {
                    Ok(text) => {
                        *holder = Some(Ok(text.clone()));
                    }
                    Err(error) => {
                        *holder = Some(Err(error.to_string()));
                    }
                }
                result
            }))
        } else {
            None
        };

        let primary_engine = crate::voice::asr::create_engine(&self.primary_config)?;
        let primary_name = primary_engine.name().to_string();
        let fallback_name = self
            .fallback_config
            .as_ref()
            .map(|c| c.provider.to_string())
            .unwrap_or_else(|| "fallback".to_string());

        let mut primary_errors: Vec<String> = Vec::new();

        for attempt in 0..=self.retry_config.max_retries {
            if attempt > 0 {
                if let Some(ref result) = *fallback_result.lock().unwrap() {
                    match result {
                        Ok(text) => {
                            if let Some(handle) = fallback_handle.take() {
                                handle.abort();
                            }
                            let duration_ms = start_time.elapsed().as_millis() as u64;
                            return Ok(TranscriptionResult::new(
                                text.clone(),
                                fallback_name,
                                true,
                                duration_ms,
                            ));
                        }
                        Err(_) => {}
                    }
                }

                let delay = Duration::from_millis(
                    self.retry_config.base_delay_ms * (1 << (attempt - 1)),
                );
                eprintln!(
                    "[INFO] 主引擎重试 {}/{}, 等待 {}ms",
                    attempt,
                    self.retry_config.max_retries,
                    delay.as_millis()
                );
                tokio::time::sleep(delay).await;
            }

            match primary_engine.transcribe(audio).await {
                Ok(text) => {
                    let duration_ms = start_time.elapsed().as_millis() as u64;
                    eprintln!(
                        "[INFO] 主引擎 {} 转录成功 (尝试 {}), 耗时 {}ms",
                        primary_name,
                        attempt + 1,
                        duration_ms
                    );

                    if let Some(handle) = fallback_handle.take() {
                        handle.abort();
                    }

                    return Ok(TranscriptionResult::new(
                        text,
                        primary_name,
                        false,
                        duration_ms,
                    ));
                }
                Err(e) => {
                    eprintln!(
                        "[WARN] 主引擎 {} 转录失败 (尝试 {}/{}): {}",
                        primary_name,
                        attempt + 1,
                        self.retry_config.max_retries + 1,
                        e
                    );
                    primary_errors.push(e.to_string());
                }
            }
        }

        if let Some(handle) = fallback_handle {
            eprintln!("[INFO] 主引擎所有重试失败，等待兜底引擎结果...");

            match handle.await {
                Ok(Ok(text)) => {
                    let duration_ms = start_time.elapsed().as_millis() as u64;
                    eprintln!(
                        "[INFO] 兜底引擎 {} 转录成功，耗时 {}ms",
                        fallback_name,
                        duration_ms
                    );

                    return Ok(TranscriptionResult::new(
                        text,
                        fallback_name,
                        true,
                        duration_ms,
                    ));
                }
                Ok(Err(fallback_error)) => {
                    return Err(ASRError::AllEnginesFailed {
                        primary_error: primary_errors.join("; "),
                        fallback_error: Some(fallback_error.to_string()),
                    });
                }
                Err(join_error) => {
                    return Err(ASRError::AllEnginesFailed {
                        primary_error: primary_errors.join("; "),
                        fallback_error: Some(format!("后台任务失败: {}", join_error)),
                    });
                }
            }
        }

        Err(ASRError::AllEnginesFailed {
            primary_error: primary_errors.join("; "),
            fallback_error: None,
        })
    }

    pub fn primary_provider(&self) -> String {
        self.primary_config.provider.to_string()
    }

    pub fn is_fallback_enabled(&self) -> bool {
        self.enable_fallback && self.fallback_config.is_some()
    }
}

impl ParallelFallbackStrategy {
    pub fn from_config(config: ASRConfig) -> Self {
        let ASRConfig {
            primary,
            fallbacks,
            enable_fallback,
            ..
        } = config;
        let fallback_config = fallbacks.into_iter().next();
        Self {
            primary_config: primary,
            fallback_config,
            enable_fallback,
            retry_config: RetryConfig::default(),
        }
    }
    
    pub fn with_retry_config(mut self, retry_config: RetryConfig) -> Self {
        self.retry_config = retry_config;
        self
    }
    
    pub async fn transcribe(&self, audio: &AudioData) -> Result<TranscriptionResult, ASRError> {
        let start_time = Instant::now();
        
        // 启动备用引擎后台任务
        let fallback_handle = if self.enable_fallback && self.fallback_config.is_some() {
            let fallback_config = self.fallback_config.clone().unwrap();
            let audio_clone = audio.clone();
            
            Some(tokio::spawn(async move {
                let engine = crate::voice::asr::create_engine(&fallback_config)?;
                engine.transcribe(&audio_clone).await
            }))
        } else {
            None
        };
        
        let primary_engine = crate::voice::asr::create_engine(&self.primary_config)?;
        let primary_name = primary_engine.name().to_string();
        
        let mut primary_errors: Vec<String> = Vec::new();
        
        for attempt in 0..=self.retry_config.max_retries {
            if attempt > 0 {
                let delay = Duration::from_millis(
                    self.retry_config.base_delay_ms * (1 << (attempt - 1))
                );
                eprintln!(
                    "[INFO] 主引擎重试 {}/{}, 等待 {}ms",
                    attempt,
                    self.retry_config.max_retries,
                    delay.as_millis()
                );
                tokio::time::sleep(delay).await;
            }
            
            match primary_engine.transcribe(audio).await {
                Ok(text) => {
                    let duration_ms = start_time.elapsed().as_millis() as u64;
                    eprintln!(
                        "[INFO] 主引擎 {} 转录成功 (尝试 {}), 耗时 {}ms",
                        primary_name,
                        attempt + 1,
                        duration_ms
                    );
                    
                    if let Some(handle) = fallback_handle {
                        handle.abort();
                    }
                    
                    return Ok(TranscriptionResult::new(
                        text,
                        primary_name,
                        false,
                        duration_ms,
                    ));
                }
                Err(e) => {
                    eprintln!(
                        "[WARN] 主引擎 {} 转录失败 (尝试 {}/{}): {}",
                        primary_name,
                        attempt + 1,
                        self.retry_config.max_retries + 1,
                        e
                    );
                    primary_errors.push(e.to_string());
                }
            }
        }
        
        // 主引擎所有重试都失败，等待后台任务结果
        if let Some(handle) = fallback_handle {
            eprintln!("[INFO] 主引擎所有重试失败，等待兜底引擎结果...");
            
            match handle.await {
                Ok(Ok(text)) => {
                    let duration_ms = start_time.elapsed().as_millis() as u64;
                    let fallback_name = self.fallback_config
                        .as_ref()
                        .map(|c| c.provider.to_string())
                        .unwrap_or_else(|| "fallback".to_string());
                    
                    eprintln!(
                        "[INFO] 兜底引擎 {} 转录成功，耗时 {}ms",
                        fallback_name,
                        duration_ms
                    );
                    
                    return Ok(TranscriptionResult::new(
                        text,
                        fallback_name,
                        true,
                        duration_ms,
                    ));
                }
                Ok(Err(fallback_error)) => {
                    return Err(ASRError::AllEnginesFailed {
                        primary_error: primary_errors.join("; "),
                        fallback_error: Some(fallback_error.to_string()),
                    });
                }
                Err(join_error) => {
                    return Err(ASRError::AllEnginesFailed {
                        primary_error: primary_errors.join("; "),
                        fallback_error: Some(format!("后台任务失败: {}", join_error)),
                    });
                }
            }
        }
        
        Err(ASRError::AllEnginesFailed {
            primary_error: primary_errors.join("; "),
            fallback_error: None,
        })
    }
    
    pub fn primary_provider(&self) -> String {
        self.primary_config.provider.to_string()
    }
    
    pub fn is_fallback_enabled(&self) -> bool {
        self.enable_fallback && self.fallback_config.is_some()
    }
}
