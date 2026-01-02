# Smart Workflow Server

A unified Rust backend server for the Smart Workflow Obsidian plugin, providing PTY terminal, voice input, LLM streaming, and utility functions via WebSocket.

## Project Structure

```
rust-servers/
├── Cargo.toml              # Project config and dependencies
├── src/
│   ├── main.rs             # Entry point, CLI parsing, server startup
│   ├── server.rs           # WebSocket server implementation
│   ├── router.rs           # Message router, dispatches to modules
│   ├── pty/                # PTY terminal module
│   │   ├── mod.rs          # PtyHandler
│   │   ├── session.rs      # PTY session management (portable-pty)
│   │   └── shell.rs        # Shell detection and integration scripts
│   ├── voice/              # Voice input module
│   │   ├── mod.rs          # VoiceHandler
│   │   ├── config.rs       # ASR configuration
│   │   ├── beep.rs         # Audio feedback
│   │   ├── audio/          # Audio recording
│   │   │   ├── recorder.rs # Standard recorder (HTTP mode)
│   │   │   └── streaming.rs# Streaming recorder (Realtime mode)
│   │   └── asr/            # ASR engines
│   │       ├── http/       # HTTP mode (Qwen/Doubao/SenseVoice)
│   │       └── realtime/   # Realtime mode (Qwen/Doubao WebSocket)
│   ├── llm/                # LLM streaming module
│   │   ├── mod.rs          # LLMHandler
│   │   ├── sse_parser.rs   # SSE event parser
│   │   ├── thinking.rs     # Thinking content filter
│   │   └── response.rs     # API response parser
│   └── utils/              # Utilities module
│       ├── mod.rs          # UtilsHandler
│       └── language.rs     # Language detection (whatlang)
└── target/                 # Build output
```

## Core Dependencies

| Dependency | Purpose |
|------------|---------|
| `portable-pty` | Cross-platform PTY library |
| `tokio` | Async runtime |
| `tokio-tungstenite` | WebSocket server/client |
| `cpal` | Audio recording |
| `rodio` | Audio playback (beep sounds) |
| `hound` | WAV encoding |
| `reqwest` | HTTP client (ASR/LLM APIs) |
| `whatlang` | Language detection |
| `serde` | JSON serialization |

## Building

```bash
# Development build
cargo build

# Release build
cargo build --release

# Using project script
pnpm build:rust
```

Build artifacts are placed in the `binaries/` directory:
- `smart-workflow-server-win32-x64.exe`
- `smart-workflow-server-darwin-arm64`
- `smart-workflow-server-linux-x64`

## Usage

```bash
# Start server (random port)
./smart-workflow-server

# Specify port
./smart-workflow-server --port 8080
```

On startup, outputs JSON with port info:
```json
{"port": 12345, "pid": 67890}
```

## Communication Protocol

All messages use JSON format and must include a `module` field to specify the target module.

### Module Types

| Module | Function |
|--------|----------|
| `pty` | Terminal session management |
| `voice` | Audio recording and ASR transcription |
| `llm` | LLM streaming request handling |
| `utils` | Language detection and other utilities |

### PTY Module

```jsonc
// Initialize terminal
{ "module": "pty", "type": "init", "shell_type": "powershell", "cwd": "/path" }

// Resize terminal
{ "module": "pty", "type": "resize", "cols": 120, "rows": 30 }

// Input: send text or binary data directly
```

### Voice Module

```jsonc
// Start recording
{ "module": "voice", "type": "start_recording", "mode": "press", "asr_config": {...} }

// Stop recording
{ "module": "voice", "type": "stop_recording" }

// Cancel recording
{ "module": "voice", "type": "cancel_recording" }
```

Response messages:
- `recording_state` - Recording state (started/stopped/cancelled)
- `audio_level` - Audio level and waveform data
- `transcription_progress` - Realtime transcription progress
- `transcription_complete` - Transcription result

### LLM Module

```jsonc
// Start streaming request
{
  "module": "llm",
  "type": "stream_start",
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "headers": { "Authorization": "Bearer xxx" },
  "body": "{\"model\":\"gpt-4\",\"messages\":[...],\"stream\":true}",
  "api_format": "chat_completions",
  "request_id": "req-123"
}

// Cancel request
{ "module": "llm", "type": "stream_cancel" }
```

Response messages:
- `stream_chunk` - Content chunk
- `stream_thinking` - Thinking content (reasoning models)
- `stream_complete` - Stream completed
- `stream_error` - Error information

### Utils Module

```jsonc
// Language detection
{ "module": "utils", "type": "detect_language", "text": "Hello world", "request_id": "req-456" }
```

Response:
```jsonc
{ "module": "utils", "type": "language_detected", "request_id": "req-456", "language": "en", "confidence": 0.95 }
```

## Architecture

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

## Plugin Integration

The server is managed by `ServerManager` on the TypeScript side:

1. `BinaryManager` ensures binary availability
2. Starts server process, parses port from stdout
3. Establishes WebSocket connection
4. Service modules communicate via unified connection
5. Server shuts down when plugin unloads

## Error Handling

- WebSocket disconnection triggers automatic resource cleanup
- PTY session exit notifies client
- ASR transcription failure falls back to backup engine
- LLM requests support cancellation and timeout handling
