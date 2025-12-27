# Smart Workflow

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**Smart Workflow** 是一款强大的 Obsidian 智能工作流插件，通过智能笔记命名和集成终端功能，提升您的知识管理效率。告别起名困难和频繁切换窗口，让一切都在 Obsidian 中高效完成。

## ✨ 功能特性

### 🧠 智能笔记命名
- 支持 OpenAI 兼容 API（GPT、Claude、DeepSeek 等）
- 多种触发方式：侧边栏、命令面板、右键菜单
- 多配置管理，快速切换
- 自定义 Prompt 模板，支持变量注入
- 支持思考链模型（自动过滤 `<think>` 标签）

### 💻 集成终端
- 跨平台：Windows、macOS、Linux
- 基于 Rust 的 PTY 服务器，WebSocket 通信
- 多 Shell 支持：PowerShell、CMD、Bash、Zsh、WSL
- Canvas/WebGL 渲染可选
- 自动崩溃恢复，多会话支持
- 可自定义主题和背景图片

## 🚀 安装

### 手动安装（推荐）
1.  从 [Releases](https://github.com/ZyphrZero/obsidian-smart-workflow/releases) 下载 `main.js`, `manifest.json`, `styles.css`。
2.  将文件放入您的插件目录：`.obsidian/plugins/obsidian-smart-workflow/`。
3.  重启 Obsidian 并在设置中启用插件。

### 源码编译
```bash
# 克隆仓库
git clone https://github.com/ZyphrZero/obsidian-smart-workflow.git
cd obsidian-smart-workflow

# 安装依赖
pnpm i

# 构建插件
pnpm build

# 构建 PTY 服务器二进制（终端功能需要）
node scripts/build-rust.js

# 安装到 Obsidian（交互式）
pnpm install:dev
```

更多详情请参阅 [构建脚本指南](./scripts/README.md)。

## 📖 使用指南

### 1. 配置 API
进入 **设置 > 常规设置**：
*   **API 端点**：输入您的 API 地址（插件会自动补全路径，如 `/v1/chat/completions`）。
*   **API Key**：输入您的密钥。
*   **模型**：输入模型名称（如 `gpt-4o`, `deepseek-chat`）。
*   点击 **"测试连接"** 确保配置正确。
*   **超时设置**：网络较慢时可适当增加超时时间。

### 2. 生成文件名
您可以通过以下任意方式触发：
*   ~~**✨ 标题悬浮按钮**：鼠标悬停在笔记标题（Inline Title）区域，点击出现的星星图标。(暂无合适的实现方式)~~
*   **命令面板**：`Ctrl/Cmd + P` 输入 "Generate AI File Name"。
*   **右键菜单**：在文件列表或编辑器区域右键点击。

### 3. Prompt 模板变量
在设置中自定义 Prompt 时，可以使用以下变量：
*   `{{content}}`：笔记内容片段（智能截断）。
*   `{{currentFileName}}`：当前文件名。
*   `{{#if currentFileName}}...{{/if}}`：条件块，仅当有文件名时显示。

**Example Template:**
```text
请阅读以下笔记内容，为其生成一个不仅简洁而且极具概括性的文件名。
不要包含扩展名，不要使用特殊字符。

笔记内容：
{{content}}
```

## ⚙️ 高级设置

### AI 文件命名设置
*   **使用当前文件名作为上下文**：开启后，AI 会知道当前文件名叫什么，您可以让它"优化"现有名称而不是重新生成。
*   **分析目录命名风格**：(实验性) 尝试分析同目录下其他文件的命名习惯。
*   **调试模式**：在开发者控制台 (Ctrl+Shift+I) 输出完整的 Prompt 和 API 响应，便于排查问题。

### 终端设置
*   **Shell 配置**：
    *   支持自定义 Shell 路径（如 `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`）。
    *   自动验证 Shell 路径有效性，避免启动失败。
*   **外观定制**：
    *   **渲染器选择**：canvas（兼容性好）或 WebGL（性能更佳）。
    *   **主题颜色**：使用 Obsidian 主题或自定义前景色、背景色、光标颜色等。
    *   **背景图片**：支持设置背景图片 URL，可调节透明度（0-1）和毛玻璃模糊效果（0-50px）。
*   **行为设置**：
    *   **滚动缓冲区**：设置终端历史记录行数（100-10000），默认 1000 行。
    *   **面板高度**：设置终端面板默认高度（100-1000 像素），默认 300 像素。

## 🧩 常见问题

### AI 文件命名
**Q: 支持 DeepSeek 或 Claude 吗？**
A: 支持。本插件兼容 OpenAI 格式接口。对于 DeepSeek 等输出 "思考过程" 的模型，插件会自动过滤 `<think>` 标签，只保留最终结果。

**Q: 为什么生成的标题没变化？**
A: 请检查 Prompt 模板是否合理，或者开启调试模式并按下 `Ctrl+Shift+I` 打开控制台，查看 AI 实际返回的内容。

### 终端功能
**Q: 如何更换终端 Shell？**
A: 在设置 > 终端 > Shell 配置中，输入自定义 Shell 路径。例如：
- Windows PowerShell: `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
- Windows CMD: `C:\Windows\System32\cmd.exe`
- Git Bash: `C:\Program Files\Git\bin\bash.exe`

**Q: 如何设置终端背景图片？**
A: 在设置 > 终端 > 外观中，输入图片 URL（支持本地路径或网络地址）。可以调节透明度和模糊效果，实现毛玻璃效果。

**Q: canvas 和 WebGL 渲染器应该选哪个？**
A: 
- **canvas**: 兼容性更好，适合大多数场景。
- **WebGL**: 性能更佳，但某些系统可能不支持。建议先尝试 WebGL，如遇问题再切换到 canvas。

---
<div align="center">

**用 ❤️ 构建 | Made with Love**

⭐ 如果这个项目对你有帮助，请给我们一个 Star！❤️

</div>
