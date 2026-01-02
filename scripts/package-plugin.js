/**
 * Plugin Package Script
 * Auto-detect current platform and package the unified server binary
 * Binary naming: smart-workflow-server-{platform}-{arch}
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Unified server configuration
const SERVER_CONFIG = {
  name: 'smart-workflow-server',
  displayName: 'Smart Workflow Server'
};

/**
 * Get current platform identifier
 */
function getCurrentPlatform() {
  return `${process.platform}-${process.arch}`;
}

// Parse command line arguments
const args = process.argv.slice(2);
const createZip = args.includes('--zip');

// Detect current platform
const currentPlatform = getCurrentPlatform();

console.log('📦 Plugin Package Script');
console.log(`🔍 Current platform: ${currentPlatform}`);
console.log('');

// Project paths
const ROOT_DIR = path.join(__dirname, '..');
const BINARIES_DIR = path.join(ROOT_DIR, 'binaries');
const PACKAGE_DIR = path.join(ROOT_DIR, 'plugin-package');

// 1. Check required files
console.log('🔍 Checking required files...');
const requiredFiles = [
  'main.js',
  'manifest.json',
  'styles.css'
];

for (const file of requiredFiles) {
  const filePath = path.join(ROOT_DIR, file);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Error: Missing required file ${file}`);
    console.error('Please run pnpm build first');
    process.exit(1);
  }
}
console.log('✅ All required files exist');
console.log('');

// 2. Check binary file for current platform
console.log('🔍 Checking binary file...');

const ext = currentPlatform.startsWith('win32') ? '.exe' : '';
const binaryName = `${SERVER_CONFIG.name}-${currentPlatform}${ext}`;
const binaryPath = path.join(BINARIES_DIR, binaryName);

if (!fs.existsSync(binaryPath)) {
  console.error(`  ❌ Missing: ${binaryName}`);
  console.error('');
  console.error('Please run: node scripts/build-rust.js');
  process.exit(1);
}

const binaryStats = fs.statSync(binaryPath);
const binarySizeMB = (binaryStats.size / 1024 / 1024).toFixed(2);
console.log(`  ✓ ${binaryName} (${binarySizeMB} MB)`);
console.log('');

// 3. Clean and create package directory
if (fs.existsSync(PACKAGE_DIR)) {
  fs.rmSync(PACKAGE_DIR, { recursive: true, force: true });
}
fs.mkdirSync(PACKAGE_DIR, { recursive: true });
fs.mkdirSync(path.join(PACKAGE_DIR, 'binaries'), { recursive: true });

console.log('📋 Copying files to package directory...');

// 4. Copy core files
for (const file of requiredFiles) {
  const srcPath = path.join(ROOT_DIR, file);
  const destPath = path.join(PACKAGE_DIR, file);
  fs.copyFileSync(srcPath, destPath);
  console.log(`  ✓ ${file}`);
}

// 5. Copy binary file
const destBinaryPath = path.join(PACKAGE_DIR, 'binaries', binaryName);
fs.copyFileSync(binaryPath, destBinaryPath);

// Copy SHA256 file if exists
const checksumSrc = `${binaryPath}.sha256`;
if (fs.existsSync(checksumSrc)) {
  fs.copyFileSync(checksumSrc, `${destBinaryPath}.sha256`);
}

console.log(`  ✓ binaries/${binaryName}`);
console.log('');

// 6. Calculate package size
console.log('📊 Package size statistics...');
let totalSize = 0;

for (const file of requiredFiles) {
  const filePath = path.join(PACKAGE_DIR, file);
  const stats = fs.statSync(filePath);
  totalSize += stats.size;
  const sizeKB = (stats.size / 1024).toFixed(1);
  console.log(`  ${file}: ${sizeKB} KB`);
}

const packagedBinaryStats = fs.statSync(destBinaryPath);
totalSize += packagedBinaryStats.size;
const sizeMB = (packagedBinaryStats.size / 1024 / 1024).toFixed(2);
console.log(`  ${binaryName}: ${sizeMB} MB`);

const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);
console.log(`  Total: ${totalSizeMB} MB`);
console.log('');

// 7. Create ZIP package (optional)
if (createZip) {
  console.log('📦 Creating ZIP package...');
  
  const zipName = 'obsidian-smart-workflow.zip';
  const zipPath = path.join(ROOT_DIR, zipName);
  
  // Delete old ZIP file
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }
  
  try {
    // Use PowerShell Compress-Archive (Windows) or zip command (Unix)
    if (process.platform === 'win32') {
      execSync(
        `powershell -Command "Compress-Archive -Path '${PACKAGE_DIR}\\*' -DestinationPath '${zipPath}' -Force"`,
        { stdio: 'inherit' }
      );
    } else {
      execSync(
        `cd "${PACKAGE_DIR}" && zip -r "${zipPath}" .`,
        { stdio: 'inherit' }
      );
    }
    
    const zipStats = fs.statSync(zipPath);
    const zipSizeMB = (zipStats.size / 1024 / 1024).toFixed(2);
    console.log(`  ✅ ZIP created: ${zipName} (${zipSizeMB} MB)`);
  } catch (error) {
    console.error('  ❌ Failed to create ZIP:', error.message);
    console.log('  💡 Tip: You can manually compress the plugin-package/ directory');
  }
  
  console.log('');
}

console.log('🎉 Package complete!');
console.log(`📁 Package directory: ${PACKAGE_DIR}`);
console.log(`📋 Packaged platform: ${currentPlatform}`);
console.log('');
console.log('📦 Packaged server:');
console.log(`  - ${SERVER_CONFIG.displayName}: ${binaryName}`);
