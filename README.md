# Smart Workflow

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Obsidian Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&query=%24%5B%22obsidian-smart-workflow%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json)](https://obsidian.md/plugins?id=obsidian-smart-workflow)

**Smart Workflow** is a powerful Obsidian plugin that streamlines your knowledge management workflow with intelligent note naming and integrated terminal functionality. Say goodbye to naming difficulties and context switching - keep everything organized in one place.

[中文文档](./README_CN.md)

## ✨ Features

### 🧠 Intelligent Note Naming
- OpenAI-compatible API support (GPT, Claude, DeepSeek, etc.)
- Multiple triggers: sidebar, command palette, right-click menu
- Multi-config management with quick switching
- Custom Prompt templates with variable injection
- Chain-of-thought model support (auto-filters `<think>` tags)

### 💻 Integrated Terminal
- Cross-platform: Windows, macOS, Linux
- Rust-based PTY server with WebSocket communication
- Multiple shell support: PowerShell, CMD, Bash, Zsh, WSL
- Canvas/WebGL rendering options
- Auto crash recovery and multi-session support
- Customizable themes and background images

## 🚀 Installation

### Manual Installation (Recommended)
1.  Download `main.js`, `manifest.json`, `styles.css` from [Releases](https://github.com/ZyphrZero/obsidian-smart-workflow/releases).
2.  Place the files in your library directory: `.obsidian/plugins/obsidian-smart-workflow/`.
3.  Restart Obsidian and enable the plugin in the settings.

### Source Code Compilation
```bash
# Clone repository
git clone https://github.com/ZyphrZero/obsidian-smart-workflow.git
cd obsidian-smart-workflow

# Install dependencies
pnpm i

# Build plugin
pnpm build

# Build PTY server binary (for terminal feature)
node scripts/build-rust.js

# Install to Obsidian (interactive)
pnpm install:dev
```

For more details, see [Build Scripts Guide](./scripts/README.md).

## 📖 User Guide

### 1. Configure API
Enter **Settings > General**:
*   **API Endpoint**: Enter your API address (the plugin will automatically complete the path, like `/v1/chat/completions`).
*   **API Key**: Enter your key.
*   **Model**: Enter the model name (e.g., `gpt-4o`, `deepseek-chat`).
*   Click **"Test Connection"** to ensure the configuration is correct.
*   **Timeout Settings**: You can appropriately increase the timeout period when the network is slow.

### 2. Generate File Name
You can trigger it in any of the following ways:
*   ~~**✨ Title Hover Button**: Hover over the title of the note (Inline Title) area, click the star icon that appears. (No suitable implementation method available yet)~~
*   **Command Palette**: `Ctrl/Cmd + P` input "Generate AI File Name".
*   **Right-click Menu**: Right-click in the file list or editor area.

### 3. Prompt Template Variables
In the settings, you can use the following variables when customizing the prompt:
*   `{{content}}`: Note content snippet (smartly truncated).
*   `{{currentFileName}}`: Current file name.
*   `{{#if currentFileName}}...{{/if}}`: Conditional block that only displays when there is a file name.

**Example Template:**
```text
Please read the following note content and generate a filename that is concise and highly summary.
Do not include the extension, do not use special characters.

Note content:
{{content}}
```

## ⚙️ Advanced Settings

### AI File Naming Settings
*   **Use Current Filename as Context**: When enabled, the AI will know the current filename, allowing you to ask it to "optimize" the existing name instead of regenerating it.
*   **Analyze Directory Naming Style**: (Experimental) Attempts to analyze the naming habits of other files in the same directory.
*   **Debug Mode**: Output the full Prompt and API response in the developer console (Ctrl+Shift+I) for troubleshooting.

### Terminal Settings
*   **Shell Configuration**:
    *   Support for custom Shell paths (e.g., `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`).
    *   Automatic validation of Shell path validity to avoid startup failures.
*   **Appearance Customization**:
    *   **Renderer Selection**: canvas (better compatibility) or WebGL (better performance).
    *   **Theme Colors**: Use Obsidian theme or customize foreground, background, cursor colors, etc.
    *   **Background Image**: Support for background image URLs with adjustable opacity (0-1) and blur effects (0-50px).
*   **Behavior Settings**:
    *   **Scrollback Buffer**: Set terminal history lines (100-10000), default 1000 lines.
    *   **Panel Height**: Set terminal panel default height (100-1000 pixels), default 300 pixels.

## 🧩 FAQ

### AI File Naming
**Q: Does it support DeepSeek or Claude?**
A: Yes. This plugin is compatible with OpenAI format interfaces. For models like DeepSeek that output a "thinking process," the plugin automatically filters out `<think>` tags, keeping only the final result.

**Q: Why hasn't the generated title changed?**
A: Please check if the Prompt template is reasonable, or enable Debug Mode and press `Ctrl+Shift+I` to open the console and view the content actually returned by the AI.

### Terminal Features
**Q: How do I change the terminal Shell?**
A: In Settings > Terminal > Shell Configuration, enter a custom Shell path. For example:
- Windows PowerShell: `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
- Windows CMD: `C:\Windows\System32\cmd.exe`
- Git Bash: `C:\Program Files\Git\bin\bash.exe`

**Q: How do I set a terminal background image?**
A: In Settings > Terminal > Appearance, enter an image URL (supports local paths or web addresses). You can adjust opacity and blur effects to achieve a frosted glass effect.

**Q: Should I choose canvas or WebGL renderer?**
A: 
- **canvas**: Better compatibility, suitable for most scenarios.
- **WebGL**: Better performance, but may not be supported on some systems. Try WebGL first, and switch to canvas if you encounter issues.

---
<div align="center">

**Made with Love**

⭐ If this project helps you, please give us a Star! ❤️

</div>
