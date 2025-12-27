/**
 * Development Environment Install Script
 * Copy plugin files to Obsidian plugins directory for testing
 * 
 * ⚠️  WARNING: This script will OVERWRITE existing files by default!
 * 
 * Usage:
 *   node scripts/install-dev.js              # Default: force overwrite + build (no lint/type check)
 *   node scripts/install-dev.js --check      # Run ESLint and TypeScript check before build
 *   node scripts/install-dev.js --kill       # Auto-close Obsidian process
 *   node scripts/install-dev.js --no-build   # Skip build step
 *   node scripts/install-dev.js --reset      # Reset saved configuration
 *   node scripts/install-dev.js -i           # Interactive mode (ask before overwrite)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync, spawn } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT_DIR, '.dev-install-config.json');

// Parse command line arguments
const args = process.argv.slice(2);
const INTERACTIVE_MODE = args.includes('-i') || args.includes('--interactive');
const KILL_OBSIDIAN = args.includes('--kill');
const RESET_CONFIG = args.includes('--reset');
const SKIP_BUILD = args.includes('--no-build');
const RUN_CHECK = args.includes('--check');

// Color output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Load saved configuration
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch (e) {
    // Ignore errors
  }
  return {};
}

// Save configuration
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    log(`  ⚠️  Cannot save config: ${e.message}`, 'yellow');
  }
}

// Detect operating system
function getPlatform() {
  const platform = process.platform;
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

// Get Obsidian executable path
function getObsidianPath() {
  const platform = getPlatform();
  if (platform === 'windows') {
    const possiblePaths = [
      path.join(process.env.LOCALAPPDATA || '', 'Obsidian', 'Obsidian.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Obsidian', 'Obsidian.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || '', 'Obsidian', 'Obsidian.exe'),
    ];
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) return p;
    }
  } else if (platform === 'macos') {
    return '/Applications/Obsidian.app';
  } else {
    try {
      return execSync('which obsidian 2>/dev/null', { encoding: 'utf-8' }).trim();
    } catch (e) {
      return 'obsidian';
    }
  }
  return null;
}

// Kill Obsidian process
function killObsidian() {
  const platform = getPlatform();
  try {
    if (platform === 'windows') {
      execSync('taskkill /F /IM Obsidian.exe 2>nul', { stdio: 'ignore' });
    } else {
      execSync('pkill -f Obsidian 2>/dev/null || true', { stdio: 'ignore' });
    }
    log('  ✓ Obsidian process closed', 'green');
    return true;
  } catch (e) {
    return false;
  }
}

// Kill PTY server process
function killPtyServer() {
  const platform = getPlatform();
  try {
    if (platform === 'windows') {
      // 终止所有 pty-server 进程
      execSync('taskkill /F /IM pty-server-win32-x64.exe 2>nul', { stdio: 'ignore' });
    } else if (platform === 'macos') {
      execSync('pkill -f pty-server-darwin 2>/dev/null || true', { stdio: 'ignore' });
    } else {
      execSync('pkill -f pty-server-linux 2>/dev/null || true', { stdio: 'ignore' });
    }
    log('  ✓ PTY server process terminated', 'green');
    return true;
  } catch (e) {
    // 进程可能不存在，忽略错误
    return false;
  }
}

// Start Obsidian
function startObsidian() {
  const platform = getPlatform();
  const obsidianPath = getObsidianPath();
  
  try {
    if (platform === 'windows') {
      if (obsidianPath && fs.existsSync(obsidianPath)) {
        spawn(obsidianPath, [], { detached: true, stdio: 'ignore', shell: true }).unref();
      } else {
        execSync('start obsidian://', { stdio: 'ignore', shell: true });
      }
    } else if (platform === 'macos') {
      execSync('open -a Obsidian', { stdio: 'ignore' });
    } else {
      spawn('obsidian', [], { detached: true, stdio: 'ignore' }).unref();
    }
    log('  ✓ Obsidian started', 'green');
    return true;
  } catch (e) {
    log(`  ⚠️  Cannot auto-start Obsidian: ${e.message}`, 'yellow');
    return false;
  }
}

// Check if Obsidian is running
function isObsidianRunning() {
  const platform = getPlatform();
  try {
    if (platform === 'windows') {
      const result = execSync('tasklist /FI "IMAGENAME eq Obsidian.exe" 2>nul', { encoding: 'utf-8' });
      return result.includes('Obsidian.exe');
    } else {
      const result = execSync('pgrep -f Obsidian 2>/dev/null || echo ""', { encoding: 'utf-8' });
      return result.trim() !== '';
    }
  } catch (e) {
    return false;
  }
}

// Copy file with retry
async function copyFileWithRetry(srcPath, destPath, maxRetries = 3, retryDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      fs.copyFileSync(srcPath, destPath);
      return true;
    } catch (error) {
      if (error.code === 'EBUSY' || error.code === 'EPERM') {
        if (attempt < maxRetries) {
          log(`  ⚠️  File locked, retrying in ${retryDelay / 1000}s (${attempt}/${maxRetries})...`, 'yellow');
          await sleep(retryDelay);
          continue;
        }
      }
      throw error;
    }
  }
  return false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Create readline interface
let rl = null;
function getReadline() {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }
  return rl;
}

function closeReadline() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

function question(query) {
  return new Promise(resolve => getReadline().question(query, resolve));
}

async function main() {
  log('\n📦 Obsidian Plugin Development Install Tool\n', 'cyan');
  log('   ⚠️  WARNING: Will OVERWRITE existing files by default!', 'yellow');
  log('   Use -i flag for interactive mode\n', 'gray');
  
  if (INTERACTIVE_MODE || KILL_OBSIDIAN || SKIP_BUILD || RUN_CHECK) {
    const modes = [];
    if (INTERACTIVE_MODE) modes.push('Interactive mode');
    if (KILL_OBSIDIAN) modes.push('Auto-close Obsidian');
    if (SKIP_BUILD) modes.push('Skip build');
    if (RUN_CHECK) modes.push('Run lint/type check');
    log(`   Mode: ${modes.join(' + ')}`, 'gray');
  }

  if (RESET_CONFIG) {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
      log('✓ Configuration reset\n', 'green');
    }
    closeReadline();
    process.exit(0);
  }

  const config = loadConfig();

  // 0. Build the plugin
  if (!SKIP_BUILD) {
    // 0.1 ESLint check (only when --check flag is provided)
    if (RUN_CHECK) {
      log('🔍 Running ESLint check...', 'cyan');
      try {
        execSync('npx eslint src --ext .ts', { cwd: ROOT_DIR, stdio: 'inherit' });
        log('  ✓ ESLint check passed\n', 'green');
      } catch (error) {
        log('\n❌ ESLint check failed', 'red');
        closeReadline();
        process.exit(1);
      }

      // 0.2 TypeScript type check
      log('🔍 Running TypeScript type check...', 'cyan');
      try {
        execSync('npx tsc --noEmit', { cwd: ROOT_DIR, stdio: 'inherit' });
        log('  ✓ TypeScript check passed\n', 'green');
      } catch (error) {
        log('\n❌ TypeScript type check failed', 'red');
        closeReadline();
        process.exit(1);
      }
    }

    // 0.3 Build
    log('🔨 Building plugin...', 'cyan');
    try {
      execSync('pnpm build', { cwd: ROOT_DIR, stdio: 'inherit' });
      log('  ✓ Build completed\n', 'green');
    } catch (error) {
      log('\n❌ Build failed', 'red');
      closeReadline();
      process.exit(1);
    }
  }

  // 1. Check required files
  log('🔍 Checking required files...', 'cyan');
  
  const platform = getPlatform();
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  let binaryName;
  if (platform === 'windows') {
    binaryName = `pty-server-win32-${arch}.exe`;
  } else if (platform === 'macos') {
    binaryName = `pty-server-darwin-${arch}`;
  } else {
    binaryName = `pty-server-linux-${arch}`;
  }

  const requiredFiles = [
    'main.js',
    'manifest.json',
    'styles.css',
    `binaries/${binaryName}`
  ];

  const missingFiles = [];
  for (const file of requiredFiles) {
    const filePath = path.join(ROOT_DIR, file);
    if (!fs.existsSync(filePath)) {
      missingFiles.push(file);
      log(`  ❌ Missing: ${file}`, 'red');
    } else {
      log(`  ✓ ${file}`, 'green');
    }
  }

  if (missingFiles.length > 0) {
    log('\n❌ Error: Missing required files', 'red');
    log('Please run the following commands:', 'yellow');
    if (missingFiles.some(f => f.endsWith('.js') || f.endsWith('.json') || f.endsWith('.css'))) {
      log('  pnpm build', 'yellow');
    }
    if (missingFiles.some(f => f.includes('binaries'))) {
      log('  pnpm build:rust', 'yellow');
    }
    closeReadline();
    process.exit(1);
  }

  log('\n✅ All required files exist\n', 'green');

  // 2. Get Obsidian plugins directory
  let pluginDirPath = config.pluginDir;

  if (!pluginDirPath) {
    log('📁 Please enter your Obsidian plugins directory path:', 'cyan');
    log('   Example: C:\\Users\\<username>\\Documents\\Obsidian\\<vault>\\.obsidian\\plugins', 'yellow');
    log('   Or open the plugins folder in Obsidian and copy the path\n', 'yellow');

    const pluginDir = await question('Plugins directory path: ');

    if (!pluginDir || pluginDir.trim() === '') {
      log('\n❌ No path provided', 'red');
      closeReadline();
      process.exit(1);
    }

    pluginDirPath = pluginDir.trim().replace(/['"]/g, '');
  } else {
    log(`📁 Using saved plugins directory: ${pluginDirPath}`, 'cyan');
    log('   (Run node scripts/install-dev.js --reset to reset)\n', 'gray');
  }

  if (!fs.existsSync(pluginDirPath)) {
    log(`\n❌ Directory does not exist: ${pluginDirPath}`, 'red');
    if (config.pluginDir) {
      delete config.pluginDir;
      saveConfig(config);
    }
    closeReadline();
    process.exit(1);
  }

  if (config.pluginDir !== pluginDirPath) {
    config.pluginDir = pluginDirPath;
    saveConfig(config);
    log('  ✓ Plugins directory path saved (will be used automatically next time)', 'green');
  }

  // 3. Create plugin folder
  const targetDir = path.join(pluginDirPath, 'obsidian-smart-workflow');
  
  log(`\n📂 Target directory: ${targetDir}`, 'cyan');

  if (fs.existsSync(targetDir)) {
    if (INTERACTIVE_MODE) {
      const overwrite = await question('\n⚠️  Target directory exists, overwrite? (y/n): ');
      if (overwrite.toLowerCase() !== 'y') {
        log('\n❌ Cancelled', 'yellow');
        closeReadline();
        process.exit(0);
      }
    } else {
      log('  ⚠️  Target directory exists, overwriting...', 'yellow');
    }
  } else {
    fs.mkdirSync(targetDir, { recursive: true });
    log('  ✓ Created target directory', 'green');
  }

  // 4. If needed, close Obsidian
  if (KILL_OBSIDIAN && isObsidianRunning()) {
    log('\n🔄 Closing Obsidian process...', 'cyan');
    killObsidian();
  }

  // 4.5. Kill PTY server process to release file locks
  log('\n🔄 Terminating PTY server process...', 'cyan');
  killPtyServer();

  // 5. Copy files
  log('\n📋 Copying files...', 'cyan');

  const coreFiles = ['main.js', 'manifest.json', 'styles.css'];
  for (const file of coreFiles) {
    const srcPath = path.join(ROOT_DIR, file);
    const destPath = path.join(targetDir, file);
    try {
      await copyFileWithRetry(srcPath, destPath);
      log(`  ✓ ${file}`, 'green');
    } catch (error) {
      log(`  ❌ ${file}: ${error.message}`, 'red');
      closeReadline();
      process.exit(1);
    }
  }

  const binariesDir = path.join(targetDir, 'binaries');
  if (!fs.existsSync(binariesDir)) {
    fs.mkdirSync(binariesDir, { recursive: true });
  }

  const binaryFiles = fs.readdirSync(path.join(ROOT_DIR, 'binaries'))
    .filter(f => f.startsWith('pty-server-') && !f.endsWith('.md'));

  let hasLockedFile = false;
  for (const file of binaryFiles) {
    const srcPath = path.join(ROOT_DIR, 'binaries', file);
    const destPath = path.join(binariesDir, file);
    try {
      await copyFileWithRetry(srcPath, destPath);
      log(`  ✓ binaries/${file}`, 'green');
    } catch (error) {
      if (error.code === 'EBUSY' || error.code === 'EPERM') {
        hasLockedFile = true;
        log(`  ❌ binaries/${file}: File locked`, 'red');
      } else {
        log(`  ❌ binaries/${file}: ${error.message}`, 'red');
      }
    }
  }

  if (hasLockedFile) {
    log('\n⚠️  Some files are locked (Obsidian may be using them)', 'yellow');
    log('   Solutions:', 'yellow');
    log('   1. Close Obsidian and run this script again', 'yellow');
    log('   2. Or use --kill flag to auto-close Obsidian:', 'yellow');
    log('      node scripts/install-dev.js -f --kill\n', 'cyan');
    closeReadline();
    process.exit(1);
  }

  // 6. If Obsidian was closed earlier, restart it
  if (KILL_OBSIDIAN) {
    log('\n🚀 Restarting Obsidian...', 'cyan');
    startObsidian();
  }

  // 7. Complete
  log('\n🎉 Installation complete!', 'green');
  
  if (!KILL_OBSIDIAN) {
    log('\nNext steps:', 'cyan');
    log('  1. Open Obsidian', 'yellow');
    log('  2. Go to Settings → Community plugins', 'yellow');
    log('  3. Disable "Restricted mode" (if enabled)', 'yellow');
    log('  4. Find "Smart Workflow" in installed plugins list', 'yellow');
    log('  5. Enable the plugin', 'yellow');
    log('  6. Use Command Palette (Ctrl+P) and type "Terminal" to test\n', 'yellow');
  }

  log('💡 Tips:', 'cyan');
  log('  - After code changes, run pnpm build, then reload plugin in Obsidian', 'yellow');
  log('  - Press Ctrl+Shift+I to open developer tools for logs', 'yellow');
  log('  - Quick install: pnpm install:dev:force\n', 'yellow');

  closeReadline();
}

main().catch(error => {
  log(`\n❌ Error: ${error.message}`, 'red');
  closeReadline();
  process.exit(1);
});
