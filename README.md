# Smart Workflow

**Smart Workflow** is a powerful Obsidian plugin that streamlines your knowledge management workflow with intelligent note naming and integrated terminal functionality. Say goodbye to naming difficulties and context switching - keep everything organized in one place.

[中文文档](./README_CN.md)

## ✨ Features

### 🧠 Intelligent Note Naming
*   **Smart Analysis**: Based on OpenAI-compatible APIs (supports GPT, Claude, DeepSeek, etc.), deeply understands note content and generates the best filenames.
*   **Convenient Triggers**:
    *   **Multiple Entry Points**: Supports sidebar icon, command palette, editor right-click, and file list right-click menus.
*   **Multi-Config Management**: Supports saving multiple sets of API configurations and quick switching.
*   **Highly Customizable**:
    *   Custom Prompt templates, supporting variable injection.
    *   Fine-grained control of AI parameters (Temperature, Top P, Max Tokens).
    *   **Context Awareness**: Option to reference the current filename for optimization.
*   **Robust Design**:
    *   Supports "Chain of Thought" models (like DeepSeek R1), automatically filtering out `<think>` tags.
    *   Intelligent API endpoint completion and correction.
    *   Customizable request timeout settings.

### 💻 Integrated Terminal
*   **Cross-Platform Support**: Works seamlessly on Windows, macOS, and Linux.
*   **Native Experience**: Powered by Rust-based PTY server with WebSocket communication.
*   **Multiple Renderers**: Choose between canvas and WebGL rendering for optimal performance.
*   **Auto-Recovery**: Automatic crash detection and server restart.
*   **Multiple Sessions**: Support for multiple terminal instances.
*   **Highly Customizable**:
    *   Custom Shell path (supports PowerShell, CMD, Bash, etc.).
    *   Adjustable scrollback buffer size (100-10000 lines).
    *   Custom terminal panel default height (100-1000 pixels).
    *   Option to restore terminals on startup.
*   **Themes & Appearance**:
    *   Use Obsidian theme colors or custom color schemes.
    *   Support for background images with opacity and blur effects.
    *   Adaptive light/dark theme switching.

## 🚀 Installation

### Manual Installation (Recommended)
1.  Download `main.js`, `manifest.json`, `styles.css` from [Releases](https://github.com/ZyphrZero/obsidian-smart-workflow/releases).
2.  Place the files in your library directory: `.obsidian/plugins/smart-workflow/`.
3.  Restart Obsidian and enable the plugin in the settings.

### Source Code Compilation
```bash
# Clone repository
git clone https://github.com/ZyphrZero/obsidian-smart-workflow.git
cd obsidian-smart-workflow

# Install dependencies
npm install

# Build plugin
npm run build

# Build PTY server binary (for terminal feature)
node scripts/build-rust.js win32-x64      # Windows
node scripts/build-rust.js darwin-arm64   # macOS Apple Silicon
node scripts/build-rust.js darwin-x64     # macOS Intel
node scripts/build-rust.js linux-x64      # Linux

# Install to Obsidian (interactive)
npm run install:dev
```

For more details, see [Build Scripts Guide](./scripts/README.md).

## 📖 User Guide

### 1. Configure API
Enter **Settings > AI File Namer**:
*   **API Endpoint**: Enter your API address (the plugin will automatically complete the path, like `/v1/chat/completions`).
*   **API Key**: Enter your key.
*   **Model**: Enter the model name (e.g., `gpt-4o`, `deepseek-chat`).
*   Click **"Test Connection"** to ensure the configuration is correct.

### 2. Generate File Name
You can trigger it in any of the following ways:
*   **✨ Title Hover Button**: Hover over the title of the note (Inline Title) area, click the star icon that appears.
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
*   **Timeout Settings**: You can appropriately increase the timeout period when the network is slow.

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
    *   **Restore on Startup**: When enabled, automatically restore previously opened terminal instances on plugin load.

## 🧩 FAQ

### AI File Naming
**Q: Does it support DeepSeek or Claude?**
A: Yes. This plugin is compatible with OpenAI format interfaces. For models like DeepSeek that output a "thinking process," the plugin automatically filters out `<think>` tags, keeping only the final result.

**Q: Why hasn't the generated title changed?**
A: Please check if the Prompt template is reasonable, or enable Debug Mode and press `Ctrl+Shift+I` to open the console and view the content actually returned by the AI.

### Terminal Features
**Q: What should I do if the terminal won't start?**
A: Please check the following:
1. Verify that the Shell path is correct (the settings will automatically validate path validity).
2. Check the developer console (Ctrl+Shift+I) for error messages.
3. Try using the diagnostic script: `node scripts/diagnose-terminal.js`.

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
