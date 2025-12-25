# 构建脚本使用指南

本目录包含用于构建、打包和开发 Smart Workflow Obsidian 插件的自动化脚本。

## 快速开始

### 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 构建插件代码
npm run build

# 3. 构建当前平台的二进制（仅在修改 Rust 代码时需要）
# 推荐：直接调用脚本（避免 npm 警告）
node scripts/build-rust.js win32-x64      # Windows
node scripts/build-rust.js darwin-arm64   # macOS Apple Silicon
node scripts/build-rust.js darwin-x64     # macOS Intel
node scripts/build-rust.js linux-x64      # Linux

# 或者通过 npm（需要使用 -- 分隔符）
npm run build:rust -- win32-x64

# 4. 安装到 Obsidian
npm run install:dev
# 或使用快速安装（需要先配置路径）
node scripts/quick-install.js "你的vault路径"
```

### 快速开发循环

```bash
# 1. 设置环境变量（仅需一次）
# Windows: set OBSIDIAN_PLUGIN_PATH=D:\MyVault\.obsidian\plugins\obsidian-smart-workflow
# macOS/Linux: export OBSIDIAN_PLUGIN_PATH="/path/to/vault/.obsidian/plugins/obsidian-smart-workflow"

# 2. 开发循环（一行命令）
npm run build && node scripts/quick-install.js

# 3. 在 Obsidian 中按 Ctrl+R 重新加载
```

---

## 脚本说明

### build-rust.js - 构建 Rust 二进制

```bash
# 推荐：直接调用脚本（避免 npm 警告）
node scripts/build-rust.js win32-x64

# 或通过 npm（需要 -- 分隔符）
npm run build:rust -- win32-x64

# 构建所有平台（仅用于发布，需要 CI/CD）
npm run build:rust
```

**支持的平台**: `win32-x64`, `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`

**输出**: `binaries/pty-server-{platform}{ext}` 和对应的 `.sha256` 文件

> **注意**: 本地开发时只需构建当前平台。交叉编译其他平台非常困难，建议使用 GitHub Actions。

---

### package-plugin.js - 打包插件（适用于手动发布）

```bash
# 基本打包
npm run package

# 打包并创建 ZIP
npm run package -- --zip
```

**输出**: `dist/obsidian-smart-workflow-{version}/`

**内置平台**: `win32-x64`, `darwin-arm64`, `linux-x64`（其他平台首次使用时自动下载）

---

### install-dev.js - 交互式安装

```bash
npm run install:dev
```

交互式引导安装插件到 Obsidian，适合首次使用。

---

### quick-install.js - 快速安装

```bash
# 方法 1: 命令行参数
node scripts/quick-install.js "D:\MyVault\.obsidian\plugins\obsidian-smart-workflow"

# 方法 2: 环境变量
set OBSIDIAN_PLUGIN_PATH=D:\MyVault\.obsidian\plugins\obsidian-smart-workflow
node scripts/quick-install.js
```

无需交互，适合频繁开发迭代。

---

## 发布流程

**推荐使用 GitHub Actions 自动化发布**:

```bash
# 1. 更新版本号（manifest.json 和 versions.json）

# 2. 提交并创建 tag
git add .
git commit -m "chore: bump version to x.x.x"
git tag vx.x.x
git push origin vx.x.x

# 3. GitHub Actions 自动执行:
#    - 构建所有平台的二进制
#    - 打包插件
#    - 创建 GitHub Release
```

---

## 常见问题

### 交叉编译失败

**问题**: 无法在 Windows 上构建 macOS/Linux 平台

**解决方案**: 
- 本地开发只构建当前平台
- 使用 GitHub Actions 在对应平台上构建
- 发布时从 GitHub Release 下载完整构建产物

### 找不到插件目录

**解决方案**:
1. 打开 Obsidian → 设置 → 第三方插件
2. 点击"打开插件文件夹"
3. 复制路径用于 `quick-install.js`

### 二进制文件缺失

**解决方案**:
```bash
# 构建当前平台的二进制
npm run build:rust -- win32-x64  # 或你的平台
```

---

## 相关文档

- [PTY 服务器文档](../pty-server/README.md)
- [主 README](../README.md)
- [GitHub Actions 工作流](../.github/workflows/build-rust.yml)
