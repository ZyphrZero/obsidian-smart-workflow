# Smart Workflow Server

Smart Workflow 插件的统一 Rust 后端服务器，通过 WebSocket 提供 PTY 终端、语音输入、LLM 流式处理、工具函数等功能。

## 项目结构

```
rust-servers/
├── Cargo.toml              # 项目配置和依赖
├── src/
│   ├── main.rs             # 入口，CLI 参数解析，服务器启动
│   ├── server.rs           # WebSocket 服务器实现
│   ├── router.rs           # 消息路由器，分发到各功能模块
│   ├── pty/                # PTY 终端模块
│   │   ├── mod.rs          # PtyHandler 处理器
│   │   ├── session.rs      # PTY 会话管理 (portable-pty)
│   │   └── shell.rs        # Shell 检测和集成脚本
│   ├── voice/              # 语音输入模块
│   │   ├── mod.rs          # VoiceHandler 处理器
│   │   ├── config.rs       # ASR 配置定义
│   │   ├── beep.rs         # 提示音播放
│   │   ├── audio/          # 音频录制
│   │   │   ├── recorder.rs # 普通录音器 (HTTP 模式)
│   │   │   └── streaming.rs# 流式录音器 (Realtime 模式)
│   │   └── asr/            # ASR 引擎
│   │       ├── http/       # HTTP 模式 (Qwen/Doubao/SenseVoice)
│   │       └── realtime/   # 实时模式 (Qwen/Doubao WebSocket)
│   ├── llm/                # LLM 流式处理模块
│   │   ├── mod.rs          # LLMHandler 处理器
│   │   ├── sse_parser.rs   # SSE 事件解析器
│   │   ├── thinking.rs     # 思考内容过滤器
│   │   └── response.rs     # API 响应解析
│   └── utils/              # 工具模块
│       ├── mod.rs          # UtilsHandler 处理器
│       └── language.rs     # 语言检测 (whatlang)
└── target/                 # 构建输出
```

## 核心依赖

| 依赖 | 用途 |
|------|------|
| `portable-pty` | 跨平台 PTY 库 |
| `tokio` | 异步运行时 |
| `tokio-tungstenite` | WebSocket 服务器/客户端 |
| `cpal` | 音频录制 |
| `rodio` | 音频播放 (提示音) |
| `hound` | WAV 编码 |
| `reqwest` | HTTP 客户端 (ASR/LLM API) |
| `whatlang` | 语言检测 |
| `serde` | JSON 序列化 |

## 构建

```bash
# 开发构建
cargo build

# 发布构建
cargo build --release

# 使用项目脚本构建
pnpm build:rust
```

构建产物位于 `binaries/` 目录：
- `smart-workflow-server-win32-x64.exe`
- `smart-workflow-server-darwin-arm64`
- `smart-workflow-server-linux-x64`

## 使用

```bash
# 启动服务器 (随机端口)
./smart-workflow-server

# 指定端口
./smart-workflow-server --port 8080
```

启动后输出 JSON 格式的端口信息：
```json
{"port": 12345, "pid": 67890}
```

## 通信协议

所有消息使用 JSON 格式，必须包含 `module` 字段指定目标模块。

### 模块类型

| 模块 | 功能 |
|------|------|
| `pty` | 终端会话管理 |
| `voice` | 语音录制和 ASR 转录 |
| `llm` | LLM 流式请求处理 |
| `utils` | 语言检测等工具 |

### PTY 模块

```jsonc
// 初始化终端
{ "module": "pty", "type": "init", "shell_type": "powershell", "cwd": "/path" }

// 调整尺寸
{ "module": "pty", "type": "resize", "cols": 120, "rows": 30 }

// 输入：直接发送文本或二进制数据
```

### Voice 模块

```jsonc
// 开始录音
{ "module": "voice", "type": "start_recording", "mode": "press", "asr_config": {...} }

// 停止录音
{ "module": "voice", "type": "stop_recording" }

// 取消录音
{ "module": "voice", "type": "cancel_recording" }
```

响应消息：
- `recording_state` - 录音状态 (started/stopped/cancelled)
- `audio_level` - 音频级别和波形数据
- `transcription_progress` - 实时转录进度
- `transcription_complete` - 转录完成结果

### LLM 模块

```jsonc
// 开始流式请求
{
  "module": "llm",
  "type": "stream_start",
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "headers": { "Authorization": "Bearer xxx" },
  "body": "{\"model\":\"gpt-4\",\"messages\":[...],\"stream\":true}",
  "api_format": "chat_completions",
  "request_id": "req-123"
}

// 取消请求
{ "module": "llm", "type": "stream_cancel" }
```

响应消息：
- `stream_chunk` - 内容块
- `stream_thinking` - 思考内容 (推理模型)
- `stream_complete` - 流式完成
- `stream_error` - 错误信息

### Utils 模块

```jsonc
// 语言检测
{ "module": "utils", "type": "detect_language", "text": "Hello world", "request_id": "req-456" }
```

响应：
```jsonc
{ "module": "utils", "type": "language_detected", "request_id": "req-456", "language": "en", "confidence": 0.95 }
```

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    WebSocket Server                          │
│                      (server.rs)                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   Message Router                             │
│                    (router.rs)                               │
│  ┌─────────┬─────────┬─────────┬─────────┐                  │
│  │   PTY   │  Voice  │   LLM   │  Utils  │                  │
│  └────┬────┴────┬────┴────┬────┴────┬────┘                  │
└───────┼─────────┼─────────┼─────────┼───────────────────────┘
        │         │         │         │
        ▼         ▼         ▼         ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
   │ PTY     │ │ Audio   │ │ HTTP    │ │Language │
   │ Session │ │Recorder │ │ Client  │ │Detector │
   └─────────┘ └─────────┘ └─────────┘ └─────────┘
```

## 插件集成

服务器由 TypeScript 端的 `ServerManager` 管理：

1. `BinaryManager` 确保二进制文件可用
2. 启动服务器进程，解析端口
3. 建立 WebSocket 连接
4. 各服务模块通过统一连接通信
5. 插件卸载时关闭服务器

## 错误处理

- WebSocket 连接异常自动清理资源
- PTY 会话退出时通知客户端
- ASR 转录失败自动回退到备用引擎
- LLM 请求支持取消和超时处理
