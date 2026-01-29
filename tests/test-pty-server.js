// PTY Server Test Script
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');

async function testPtyServer() {
  console.log('=== PTY Server Test ===\n');
  
  // Detect current platform
  const platform = `${process.platform}-${process.arch}`;
  const ext = process.platform === 'win32' ? '.exe' : '';
  const binaryName = `pty-server-${platform}${ext}`;
  
  // Binary is in root binaries/ directory
  const binaryPath = path.join(__dirname, '..', 'binaries', binaryName);
  console.log('1. Starting PTY server:', binaryPath);
  
  const server = spawn(binaryPath, ['--port', '0'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  
  // Wait for port info
  const port = await new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
    
    server.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      console.log('   stdout:', chunk.toString().trim());
      
      try {
        const match = buffer.match(/\{[^}]+\}/);
        if (match) {
          const info = JSON.parse(match[0]);
          if (info.port) {
            clearTimeout(timeout);
            resolve(info.port);
          }
        }
      } catch (e) {}
    });
    
    server.stderr.on('data', (chunk) => {
      console.log('   stderr:', chunk.toString().trim());
    });
    
    server.on('error', reject);
  });
  
  console.log(`\n2. Server started on port: ${port}\n`);
  
  // Connect WebSocket
  console.log('3. Connecting WebSocket...');
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  
  await new Promise((resolve, reject) => {
    ws.on('open', () => {
      console.log('   ✓ WebSocket connected\n');
      resolve();
    });
    ws.on('error', reject);
  });
  
  // Receive data
  ws.on('message', (data) => {
    console.log('   << Received:', data.toString().substring(0, 100));
  });
  
  // Send test command
  console.log('4. Sending test command: echo hello');
  ws.send('echo hello\r\n');
  
  // Wait for response
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Cleanup
  console.log('\n5. Cleaning up...');
  ws.close();
  server.kill();
  
  console.log('   ✓ Test complete\n');
}

testPtyServer().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
