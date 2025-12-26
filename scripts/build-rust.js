/**
 * Rust PTY 服务器构建脚本
 * 为所有支持的平台交叉编译 Rust 二进制文件
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 支持的平台配置
const PLATFORMS = [
  { 
    name: 'win32-x64', 
    target: 'x86_64-pc-windows-msvc',
    ext: '.exe',
    displayName: 'Windows x64'
  },
  { 
    name: 'darwin-x64', 
    target: 'x86_64-apple-darwin',
    ext: '',
    displayName: 'macOS Intel'
  },
  { 
    name: 'darwin-arm64', 
    target: 'aarch64-apple-darwin',
    ext: '',
    displayName: 'macOS Apple Silicon'
  },
  { 
    name: 'linux-x64', 
    target: 'x86_64-unknown-linux-gnu',
    ext: '',
    displayName: 'Linux x64'
  },
  { 
    name: 'linux-arm64', 
    target: 'aarch64-unknown-linux-gnu',
    ext: '',
    displayName: 'Linux ARM64'
  },
];

// 二进制文件大小参考值（仅用于提示）
const REFERENCE_BINARY_SIZE = 2 * 1024 * 1024;

// 项目路径
const PTY_SERVER_DIR = path.join(__dirname, '..', 'pty-server');
const BINARIES_DIR = path.join(__dirname, '..', 'binaries');

console.log('🦀 Rust PTY 服务器构建脚本');
console.log('');

// 检查 Rust 是否安装
try {
  const rustVersion = execSync('cargo --version', { encoding: 'utf8' });
  console.log(`✅ Rust 已安装: ${rustVersion.trim()}`);
} catch (error) {
  console.error('❌ 错误: 未找到 Cargo');
  console.error('请先安装 Rust: https://rustup.rs/');
  process.exit(1);
}

// 检查 pty-server 目录
if (!fs.existsSync(PTY_SERVER_DIR)) {
  console.error(`❌ 错误: 未找到 pty-server 目录: ${PTY_SERVER_DIR}`);
  process.exit(1);
}

// 创建 binaries 目录
if (!fs.existsSync(BINARIES_DIR)) {
  fs.mkdirSync(BINARIES_DIR, { recursive: true });
  console.log(`📁 创建 binaries 目录: ${BINARIES_DIR}`);
}

console.log('');

// 解析命令行参数
const args = process.argv.slice(2);
const specificPlatform = args.find(arg => !arg.startsWith('--'));
const skipInstall = args.includes('--skip-install');

// 如果指定了特定平台，只构建该平台
const platformsToBuild = specificPlatform
  ? PLATFORMS.filter(p => p.name === specificPlatform)
  : PLATFORMS;

if (platformsToBuild.length === 0) {
  console.error(`❌ 错误: 未知平台 "${specificPlatform}"`);
  console.error(`支持的平台: ${PLATFORMS.map(p => p.name).join(', ')}`);
  process.exit(1);
}

// 安装编译目标
if (!skipInstall) {
  console.log('📦 安装 Rust 编译目标...');
  for (const platform of platformsToBuild) {
    try {
      console.log(`  - ${platform.target}`);
      execSync(`rustup target add ${platform.target}`, { 
        stdio: 'pipe',
        cwd: PTY_SERVER_DIR 
      });
    } catch (error) {
      console.warn(`  ⚠️  无法安装 ${platform.target}，可能已安装`);
    }
  }
  console.log('');
}

// 构建每个平台
let successCount = 0;
let failCount = 0;

for (const platform of platformsToBuild) {
  console.log(`🔨 构建 ${platform.displayName} (${platform.name})...`);
  
  try {
    buildPlatform(platform);
    successCount++;
    console.log(`✅ ${platform.displayName} 构建成功`);
  } catch (error) {
    failCount++;
    console.error(`❌ ${platform.displayName} 构建失败: ${error.message}`);
  }
  
  console.log('');
}

// 总结
console.log('📊 构建总结:');
console.log(`  ✅ 成功: ${successCount}`);
if (failCount > 0) {
  console.log(`  ❌ 失败: ${failCount}`);
}
console.log('');

if (successCount > 0) {
  console.log('🎉 构建完成！');
  console.log(`📁 二进制文件位置: ${BINARIES_DIR}`);
}

process.exit(failCount > 0 ? 1 : 0);

/**
 * 为特定平台构建二进制文件
 */
function buildPlatform(platform) {
  const binaryName = `pty-server-${platform.name}${platform.ext}`;
  const outputPath = path.join(BINARIES_DIR, binaryName);
  
  // 1. 清理该目标平台的缓存，强制重新编译
  console.log('  🧹 清理缓存...');
  try {
    execSync(
      `cargo clean --release --target ${platform.target}`,
      {
        cwd: PTY_SERVER_DIR,
        stdio: 'pipe',
        encoding: 'utf8'
      }
    );
  } catch (error) {
    // 清理失败不影响构建，可能是首次构建
    console.log('  ⚠️  清理缓存跳过（可能是首次构建）');
  }
  
  // 2. 编译
  console.log('  📦 编译中...');
  const startTime = Date.now();
  
  try {
    execSync(
      `cargo build --release --target ${platform.target}`,
      {
        cwd: PTY_SERVER_DIR,
        stdio: 'pipe',
        encoding: 'utf8'
      }
    );
  } catch (error) {
    throw new Error(`编译失败: ${error.stderr || error.message}`);
  }
  
  const buildTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  ⏱️  编译耗时: ${buildTime}s`);
  
  // 2. 查找编译产物
  const targetDir = path.join(PTY_SERVER_DIR, 'target', platform.target, 'release');
  const sourceBinary = path.join(targetDir, `pty-server${platform.ext}`);
  
  if (!fs.existsSync(sourceBinary)) {
    throw new Error(`未找到编译产物: ${sourceBinary}`);
  }
  
  // 3. 复制到 binaries 目录
  console.log('  📋 复制二进制文件...');
  fs.copyFileSync(sourceBinary, outputPath);
  
  // 4. 验证文件大小
  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  const sizeKB = (stats.size / 1024).toFixed(0);
  
  console.log(`  📊 文件大小: ${sizeMB} MB (${sizeKB} KB)`);
  
  if (stats.size > REFERENCE_BINARY_SIZE) {
    console.log(`  💡 提示: 文件大小超过 2MB 参考值，这是正常的`);
  }
  
  // 5. 生成 SHA256 校验和
  console.log('  🔐 生成 SHA256 校验和...');
  const checksum = generateChecksum(outputPath);
  const checksumPath = `${outputPath}.sha256`;
  fs.writeFileSync(checksumPath, `${checksum}  ${binaryName}\n`);
  console.log(`  ✓ SHA256: ${checksum}`);
}

/**
 * 生成文件的 SHA256 校验和
 */
function generateChecksum(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256');
  hash.update(fileBuffer);
  return hash.digest('hex');
}
