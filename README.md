# Smart Workflow

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Release](https://img.shields.io/github/v/release/ZyphrZero/obsidian-smart-workflow)](https://github.com/ZyphrZero/obsidian-smart-workflow/releases)

**Smart Workflow** is a powerful Obsidian plugin that enhances your knowledge management with AI-powered features, integrated terminal, and voice input.

[中文文档](./README_CN.md)

## ✨ Features

### 🧠 AI Note Naming
- OpenAI-compatible API support (GPT, Claude, DeepSeek, Qwen, etc.)
- Multi-provider management with quick switching
- Custom prompt templates with variable injection
- Reasoning model support (auto-filters `<think>` tags)

### 💻 Integrated Terminal
- Cross-platform: Windows, macOS, Linux
- Rust PTY server with WebSocket communication
- Multi-shell support: PowerShell, CMD, Bash, Zsh, WSL
- Canvas/WebGL rendering, customizable themes

### 🎤 Voice Input
- Push-to-talk dictation mode
- Multiple ASR engines: Alibaba Qwen, Doubao, SenseVoice
- Realtime streaming transcription
- LLM post-processing with custom presets

### 🌐 Translation
- Auto language detection
- Bidirectional translation (Chinese ↔ English)
- Selection toolbar integration

### ✍️ Writing Assistant
- Text polishing and refinement
- Streaming LLM responses
- Thinking process visualization

## 🚀 Installation

### Manual Installation
1. Download `main.js`, `manifest.json`, `styles.css` from [Releases](https://github.com/ZyphrZero/obsidian-smart-workflow/releases)
2. Place files in `.obsidian/plugins/obsidian-smart-workflow/`
3. Restart Obsidian and enable the plugin

### Build from Source
```bash
git clone https://github.com/ZyphrZero/obsidian-smart-workflow.git
cd obsidian-smart-workflow

pnpm install
pnpm build
pnpm build:rust    # Build Rust server binary
pnpm install:dev   # Install to Obsidian
```

## 📖 Quick Start

### Configure AI Provider
1. Go to **Settings > AI Providers**
2. Add a provider with endpoint and API key
3. Add models under the provider
4. Bind models to features (naming, translation, writing, etc.)

### AI File Naming
- **Command Palette**: `Ctrl/Cmd + P` → "Generate AI File Name"
- **Right-click Menu**: Right-click file or editor

### Terminal
- **Command Palette**: `Ctrl/Cmd + P` → "Open Terminal"
- Supports custom shell paths and appearance settings

### Voice Input
- Configure ASR credentials in settings
- Use hotkey to start/stop recording
- Transcription auto-inserts at cursor

## ⚙️ Configuration

### Prompt Template Variables
```
{{content}}           - Note content (smart truncated)
{{currentFileName}}   - Current file name
{{#if currentFileName}}...{{/if}}  - Conditional block
```

### Terminal Settings
- Shell path customization
- Renderer: Canvas (compatible) / WebGL (performant)
- Theme colors, background image, blur effects
- Scrollback buffer (100-10000 lines)

### Voice Settings
- ASR provider: Qwen / Doubao / SenseVoice
- Mode: Realtime (WebSocket) / HTTP
- Recording mode: Press-to-talk / Toggle
- LLM post-processing presets

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                 Obsidian Plugin (TypeScript)                 │
├─────────────────────────────────────────────────────────────┤
│  Services                                                    │
│  ├── naming/       AI file naming                           │
│  ├── terminal/     Terminal management                      │
│  ├── voice/        Voice input & ASR                        │
│  ├── translation/  Language detection & translation         │
│  ├── writing/      Writing assistant                        │
│  └── config/       Provider & model management              │
├─────────────────────────────────────────────────────────────┤
│  UI                                                          │
│  ├── settings/     Settings tabs                            │
│  ├── terminal/     Terminal view (xterm.js)                 │
│  ├── selection/    Selection toolbar                        │
│  └── voice/        Voice overlay                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Smart Workflow Server (Rust)                    │
│  ├── pty/      Terminal sessions                            │
│  ├── voice/    Audio recording & ASR                        │
│  ├── llm/      LLM streaming                                │
│  └── utils/    Language detection                           │
└─────────────────────────────────────────────────────────────┘
```

## 🧩 FAQ

**Q: Which AI providers are supported?**  
A: Any OpenAI-compatible API. Tested with OpenAI, Claude, DeepSeek, Qwen, GLM, etc.

**Q: How to change terminal shell?**  
A: Settings > Terminal > Shell Configuration. Enter custom path like `C:\Program Files\Git\bin\bash.exe`.

**Q: Canvas or WebGL renderer?**  
A: Try WebGL first for better performance. Switch to Canvas if issues occur.

**Q: Voice input not working?**  
A: Check ASR credentials and ensure microphone permissions are granted.

## 🙏 Acknowledgements

- [push-2-talk](https://github.com/yyyzl/push-2-talk) - Voice input architecture inspiration

---

<div align="center">

**Made with ❤️**

⭐ Star this project if it helps you!

</div>
