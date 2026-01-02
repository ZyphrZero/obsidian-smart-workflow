/**
 * Unified Server 验证脚本
 * 
 * 用于验证统一 Rust 服务器的功能：
 * 1. 服务器启动
 * 2. PTY 模块通信
 * 3. Voice 模块通信
 * 
 * 运行方式: node tests/test-unified-server.js
 */

const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

// 配置
const BINARY_PATH = path.join(__dirname, '..', 'binaries', 'smart-workflow-server-win32-x64.exe');
const TIMEOUT_MS = 15000;

/**
 * 测试结果
 */
const results = {
  serverStart: false,
  portParsed: false,
  wsConnect: false,
  // PTY 模块测试
  ptyInit: false,
  ptyOutput: false,
  ptyResize: false,
  // Voice 模块测试
  voiceStartRecording: false,
  voiceStopRecording: false,
  voiceCancelRecording: false,
};

/**
 * 启动统一服务器并获取端口
 */
async function startServer() {
  return new Promise((resolve, reject) => {
    console.log('[TEST] 启动统一服务器...');
    console.log('[TEST] 二进制路径:', BINARY_PATH);
    
    const process = spawn(BINARY_PATH, ['--port', '0'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    
    let buffer = '';
    
    const timeout = setTimeout(() => {
      process.kill();
      reject(new Error('等待端口信息超时'));
    }, TIMEOUT_MS);
    
    process.stdout.on('data', (data) => {
      buffer += data.toString();
      console.log('[SERVER stdout]', data.toString().trim());
      
      // 尝试解析 JSON 端口信息
      const lines = buffer.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        try {
          const info = JSON.parse(trimmed);
          if (typeof info.port === 'number' && info.port > 0) {
            clearTimeout(timeout);
            results.serverStart = true;
            results.portParsed = true;
            console.log('[TEST] ✓ 服务器启动成功，端口:', info.port);
            resolve({ process, port: info.port });
            return;
          }
        } catch {
          // 不是有效的 JSON，继续等待
        }
      }
    });
    
    process.stderr.on('data', (data) => {
      console.log('[SERVER stderr]', data.toString().trim());
    });
    
    process.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    
    process.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timeout);
        reject(new Error(`服务器退出，代码: ${code}`));
      }
    });
  });
}

/**
 * 测试 PTY 模块
 */
async function testPtyModule(ws) {
  return new Promise((resolve, reject) => {
    console.log('\n[TEST] 测试 PTY 模块...');
    
    const timeout = setTimeout(() => {
      reject(new Error('PTY 模块测试超时'));
    }, TIMEOUT_MS);
    
    let outputReceived = false;
    
    const messageHandler = (data) => {
      const dataStr = data.toString();
      
      // 检查是否是二进制数据 (PTY 输出)
      if (data instanceof Buffer && !dataStr.startsWith('{')) {
        if (!outputReceived) {
          outputReceived = true;
          results.ptyOutput = true;
          console.log('[TEST] ✓ 收到 PTY 输出');
        }
        return;
      }
      
      // 尝试解析 JSON 消息
      try {
        const msg = JSON.parse(dataStr);
        console.log('[TEST] 收到消息:', JSON.stringify(msg, null, 2));
        
        if (msg.module === 'pty') {
          if (msg.type === 'error') {
            console.log('[TEST] PTY 错误:', msg.message);
          }
        }
      } catch {
        // 可能是 PTY 输出的文本
        if (!outputReceived) {
          outputReceived = true;
          results.ptyOutput = true;
          console.log('[TEST] ✓ 收到 PTY 输出 (文本)');
        }
      }
    };
    
    ws.on('message', messageHandler);
    
    // 发送 PTY 初始化消息
    const initMsg = {
      module: 'pty',
      type: 'init',
      shell_type: 'powershell',
      cols: 80,
      rows: 24,
    };
    console.log('[TEST] 发送 PTY init 命令...');
    ws.send(JSON.stringify(initMsg));
    results.ptyInit = true;
    console.log('[TEST] ✓ PTY init 命令已发送');
    
    // 等待一段时间让 PTY 初始化
    setTimeout(() => {
      // 发送 resize 命令
      const resizeMsg = {
        module: 'pty',
        type: 'resize',
        cols: 120,
        rows: 30,
      };
      console.log('[TEST] 发送 PTY resize 命令...');
      ws.send(JSON.stringify(resizeMsg));
      results.ptyResize = true;
      console.log('[TEST] ✓ PTY resize 命令已发送');
      
      // 发送测试命令
      console.log('[TEST] 发送测试命令: echo hello');
      ws.send('echo hello\r\n');
      
      // 等待输出
      setTimeout(() => {
        clearTimeout(timeout);
        ws.removeListener('message', messageHandler);
        resolve();
      }, 2000);
    }, 1000);
  });
}

/**
 * 测试 Voice 模块
 */
async function testVoiceModule(ws) {
  return new Promise((resolve, reject) => {
    console.log('\n[TEST] 测试 Voice 模块...');
    
    const timeout = setTimeout(() => {
      reject(new Error('Voice 模块测试超时'));
    }, TIMEOUT_MS);
    
    let testStep = 0;
    
    const messageHandler = (data) => {
      const dataStr = data.toString();
      
      // 跳过二进制数据
      if (data instanceof Buffer && !dataStr.startsWith('{')) {
        return;
      }
      
      try {
        const msg = JSON.parse(dataStr);
        
        if (msg.module !== 'voice') {
          return;
        }
        
        console.log('[TEST] Voice 消息:', JSON.stringify(msg, null, 2));
        
        switch (testStep) {
          case 1:
            // 期望收到 recording_state: started
            if (msg.type === 'recording_state' && msg.state === 'started') {
              results.voiceStartRecording = true;
              console.log('[TEST] ✓ 开始录音响应正确');
              
              // 步骤 2: 发送停止录音命令
              testStep = 2;
              setTimeout(() => {
                console.log('[TEST] 发送 Voice stop_recording 命令...');
                ws.send(JSON.stringify({ module: 'voice', type: 'stop_recording' }));
              }, 500);
            }
            break;
            
          case 2:
            // 期望收到 recording_state: stopped
            if (msg.type === 'recording_state' && msg.state === 'stopped') {
              results.voiceStopRecording = true;
              console.log('[TEST] ✓ 停止录音响应正确');
              testStep = 3;
            } else if (msg.type === 'transcription_complete' || msg.type === 'error') {
              // 转录完成或错误，继续下一步
              testStep = 3;
              
              // 步骤 3: 测试取消录音
              setTimeout(() => {
                const startMsg = {
                  module: 'voice',
                  type: 'start_recording',
                  mode: 'toggle',
                  asr_config: {
                    primary: {
                      provider: 'qwen',
                      mode: 'http',
                    },
                    enable_fallback: false,
                  },
                };
                console.log('[TEST] 发送 Voice start_recording (toggle 模式)...');
                ws.send(JSON.stringify(startMsg));
                testStep = 4;
              }, 500);
            }
            break;
            
          case 3:
            // 等待转录结果后开始取消测试
            if (msg.type === 'transcription_complete' || msg.type === 'error') {
              setTimeout(() => {
                const startMsg = {
                  module: 'voice',
                  type: 'start_recording',
                  mode: 'toggle',
                  asr_config: {
                    primary: {
                      provider: 'qwen',
                      mode: 'http',
                    },
                    enable_fallback: false,
                  },
                };
                console.log('[TEST] 发送 Voice start_recording (toggle 模式)...');
                ws.send(JSON.stringify(startMsg));
                testStep = 4;
              }, 500);
            }
            break;
            
          case 4:
            // 期望收到 recording_state: started
            if (msg.type === 'recording_state' && msg.state === 'started') {
              // 发送取消录音命令
              testStep = 5;
              setTimeout(() => {
                console.log('[TEST] 发送 Voice cancel_recording 命令...');
                ws.send(JSON.stringify({ module: 'voice', type: 'cancel_recording' }));
              }, 500);
            }
            break;
            
          case 5:
            // 期望收到 recording_state: cancelled
            if (msg.type === 'recording_state' && msg.state === 'cancelled') {
              results.voiceCancelRecording = true;
              console.log('[TEST] ✓ 取消录音响应正确');
              
              // 测试完成
              clearTimeout(timeout);
              ws.removeListener('message', messageHandler);
              resolve();
            }
            break;
        }
      } catch {
        // 忽略非 JSON 消息
      }
    };
    
    ws.on('message', messageHandler);
    
    // 步骤 1: 发送开始录音命令
    testStep = 1;
    const startMsg = {
      module: 'voice',
      type: 'start_recording',
      mode: 'press',
      asr_config: {
        primary: {
          provider: 'qwen',
          mode: 'http',
        },
        enable_fallback: false,
      },
    };
    console.log('[TEST] 发送 Voice start_recording 命令...');
    ws.send(JSON.stringify(startMsg));
  });
}

/**
 * 测试 WebSocket 连接
 */
async function testWebSocket(port) {
  return new Promise((resolve, reject) => {
    console.log('\n[TEST] 测试 WebSocket 连接...');
    
    const wsUrl = `ws://127.0.0.1:${port}`;
    console.log('[TEST] 连接到:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket 连接超时'));
    }, TIMEOUT_MS);
    
    ws.on('open', async () => {
      clearTimeout(timeout);
      results.wsConnect = true;
      console.log('[TEST] ✓ WebSocket 连接成功');
      
      try {
        // 测试 PTY 模块
        await testPtyModule(ws);
        
        // 测试 Voice 模块
        await testVoiceModule(ws);
        
        ws.close();
        resolve();
      } catch (error) {
        ws.close();
        reject(error);
      }
    });
    
    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    
    ws.on('close', () => {
      console.log('[TEST] WebSocket 连接已关闭');
    });
  });
}

/**
 * 打印测试结果
 */
function printResults() {
  console.log('\n========================================');
  console.log('       Unified Server 验证结果');
  console.log('========================================\n');
  
  const tests = [
    ['服务器启动', results.serverStart],
    ['端口解析', results.portParsed],
    ['WebSocket 连接', results.wsConnect],
    ['PTY 初始化', results.ptyInit],
    ['PTY 输出', results.ptyOutput],
    ['PTY 调整大小', results.ptyResize],
    ['Voice 开始录音', results.voiceStartRecording],
    ['Voice 停止录音', results.voiceStopRecording],
    ['Voice 取消录音', results.voiceCancelRecording],
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const [name, result] of tests) {
    const status = result ? '✓ PASS' : '✗ FAIL';
    const color = result ? '\x1b[32m' : '\x1b[31m';
    console.log(`${color}${status}\x1b[0m  ${name}`);
    if (result) passed++;
    else failed++;
  }
  
  console.log('\n----------------------------------------');
  console.log(`总计: ${passed} 通过, ${failed} 失败`);
  console.log('========================================\n');
  
  return failed === 0;
}

/**
 * 主函数
 */
async function main() {
  let serverProcess = null;
  
  try {
    // 启动服务器
    const { process, port } = await startServer();
    serverProcess = process;
    
    // 测试 WebSocket 通信
    await testWebSocket(port);
    
    // 打印结果
    const success = printResults();
    
    // 关闭服务器
    console.log('[TEST] 关闭服务器...');
    serverProcess.kill();
    
    // 等待服务器进程退出
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (!success) {
      throw new Error('部分测试失败');
    }
    
    console.log('[TEST] ✓ 所有测试通过！');
    
  } catch (error) {
    console.error('\n[TEST] ✗ 测试失败:', error.message);
    
    if (serverProcess) {
      serverProcess.kill();
    }
    
    printResults();
    throw error;
  }
}

main();
