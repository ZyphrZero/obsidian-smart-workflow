// ASR HTTP 模式实现
// 包含各供应商的 HTTP API 调用实现

pub mod qwen;
pub mod doubao;
pub mod sensevoice;

pub use qwen::QwenHttpEngine;
pub use doubao::DoubaoHttpEngine;
pub use sensevoice::SenseVoiceHttpEngine;
