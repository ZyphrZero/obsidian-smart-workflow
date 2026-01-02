# Smart Workflow

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![GitHub Downloads](https://img.shields.io/github/downloads/ZyphrZero/obsidian-smart-workflow/total?logo=github&color=blue)](https://github.com/ZyphrZero/obsidian-smart-workflow/releases)

> 🎯 **用户体验至上** — 追求直观流畅的操作体验，而非功能堆砌。

**Smart Workflow** 是一款强大的 Obsidian 插件，集成 AI 智能功能、终端、语音输入，提升知识管理效率。

[English](./README.md)

## ✨ 功能特性

### 🧠 AI 智能命名
- 支持 OpenAI 兼容 API（GPT、Claude、DeepSeek、Qwen 等）
- 多供应商管理，快速切换
- 自定义 Prompt 模板，支持变量注入
- 支持推理模型（自动过滤 `<think>` 标签）

### 💻 集成终端
- 跨平台：Windows、macOS、Linux
- Rust PTY 服务器，WebSocket 通信
- 多 Shell 支持：PowerShell、CMD、Bash、Zsh、WSL
- Canvas/WebGL 渲染，可自定义主题

### 🎤 语音输入
- 按键说话听写模式
- 多 ASR 引擎：阿里云 Qwen、豆包 Doubao、SenseVoice
- 实时流式转录
- LLM 后处理，自定义预设

### 🌐 翻译功能
- 自动语言检测
- 双向翻译（中文 ↔ 英文）
- 选中文字工具栏集成

### ✍️ 写作助手
- 文本润色优化
- LLM 流式响应
- 思考过程可视化

## 🚀 安装

### 手动安装
1. 从 [Releases](https://github.com/ZyphrZero/obsidian-smart-workflow/releases) 下载 `main.js`、`manifest.json`、`styles.css`
2. 放入 `.obsidian/plugins/obsidian-smart-workflow/`
3. 重启 Obsidian 并启用插件

### 源码构建
```bash
git clone https://github.com/ZyphrZero/obsidian-smart-workflow.git
cd obsidian-smart-workflow

pnpm install
pnpm build
pnpm build:rust    # 构建 Rust 服务器
pnpm install:dev   # 安装到 Obsidian
```

## 📖 快速开始

### 配置 AI 供应商
1. 进入 **设置 > AI 供应商**
2. 添加供应商，填写端点和 API Key
3. 在供应商下添加模型
4. 将模型绑定到功能（命名、翻译、写作等）

### AI 文件命名
- **命令面板**：`Ctrl/Cmd + P` → "Generate AI File Name"
- **右键菜单**：右键文件或编辑器

### 终端
- **命令面板**：`Ctrl/Cmd + P` → "Open Terminal"
- 支持自定义 Shell 路径和外观设置

### 语音输入
- 在设置中配置 ASR 凭证
- 使用快捷键开始/停止录音
- 转录结果自动插入光标位置

## ⚙️ 配置说明

### Prompt 模板变量
```
{{content}}           - 笔记内容（智能截断）
{{currentFileName}}   - 当前文件名
{{#if currentFileName}}...{{/if}}  - 条件块
```

### 终端设置
- 自定义 Shell 路径
- 渲染器：Canvas（兼容性好）/ WebGL（性能更佳）
- 主题颜色、背景图片、模糊效果
- 滚动缓冲区（100-10000 行）

### 语音设置
- ASR 供应商：Qwen / Doubao / SenseVoice
- 模式：Realtime（WebSocket）/ HTTP
- 录音模式：按住说话 / 切换模式
- LLM 后处理预设

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────────┐
│                 Obsidian 插件 (TypeScript)                   │
├─────────────────────────────────────────────────────────────┤
│  服务层                                                      │
│  ├── naming/       AI 文件命名                              │
│  ├── terminal/     终端管理                                 │
│  ├── voice/        语音输入 & ASR                           │
│  ├── translation/  语言检测 & 翻译                          │
│  ├── writing/      写作助手                                 │
│  └── config/       供应商 & 模型管理                        │
├─────────────────────────────────────────────────────────────┤
│  UI 层                                                       │
│  ├── settings/     设置标签页                               │
│  ├── terminal/     终端视图 (xterm.js)                      │
│  ├── selection/    选中文字工具栏                           │
│  └── voice/        语音悬浮窗                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Smart Workflow Server (Rust)                    │
│  ├── pty/      终端会话                                     │
│  ├── voice/    音频录制 & ASR                               │
│  ├── llm/      LLM 流式处理                                 │
│  └── utils/    语言检测                                     │
└─────────────────────────────────────────────────────────────┘
```

## 🧩 常见问题

**Q: 支持哪些 AI 供应商？**  
A: 任何 OpenAI 兼容 API。已测试 OpenAI、Claude、DeepSeek、Qwen、GLM 等。

**Q: 如何更换终端 Shell？**  
A: 设置 > 终端 > Shell 配置，输入自定义路径如 `C:\Program Files\Git\bin\bash.exe`。

**Q: Canvas 还是 WebGL 渲染器？**  
A: 建议先尝试 WebGL 获得更好性能，如遇问题再切换到 Canvas。

**Q: 语音输入不工作？**  
A: 检查 ASR 凭证配置，确保已授予麦克风权限。

---

<div align="center">

**用 ❤️ 构建**

⭐ 如果这个项目对你有帮助，请给个 Star！

</div>
