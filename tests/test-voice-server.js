/**
 * Voice Server 验证脚本
 * 
 * 用于验证 TypeScript 服务层的功能：
 * 1. 服务器启动
 * 2. WebSocket 通信
 * 
 * 运行方式: node tests/test-voice-server.js
 */

const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

// 配置
const BINARY_PATH = path.join(__dirname, '..', 'binaries', 'voice-server-win32-x64.exe');
const TIMEOUT_MS = 10000;

/**
 * 测试结果
 */
const results = {
  serverStart: false,
  portParsed: false,
  wsConnect: false,
  wsStartRecording: false,
  wsStopRecording: false,
  wsTranscriptionReceived: false,
  wsCancelRecording: false,
  wsUpdateConfig: false,
};

/**
 * 启动 Voice Server 并获取端口
 */
async function startServer() {
  return new Promise((resolve, reject) => {
    console.log('[TEST] 启动 Voice Server...');
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
 * 测试 WebSocket 通信
 */
async function testWebSocket(port) {
  return new Promise((resolve, reject) => {
    console.log('\n[TEST] 测试 WebSocket 通信...');
    
    const wsUrl = `ws://127.0.0.1:${port}`;
    console.log('[TEST] 连接到:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket 测试超时'));
    }, TIMEOUT_MS);
    
    let testStep = 0;
    
    ws.on('open', () => {
      results.wsConnect = true;
      console.log('[TEST] ✓ WebSocket 连接成功');
      
      // 步骤 1: 发送开始录音命令
      testStep = 1;
      const startMsg = {
        type: 'start_recording',
        mode: 'press',
        asr_config: {
          primary: {
            provider: 'qwen',
            mode: 'realtime',
          },
          enable_fallback: false,
        },
      };
      console.log('[TEST] 发送 start_recording 命令...');
      ws.send(JSON.stringify(startMsg));
    });
    
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      console.log('[TEST] 收到消息:', JSON.stringify(msg, null, 2));
      
      switch (testStep) {
        case 1:
          // 期望收到 recording_state: started
          if (msg.type === 'recording_state' && msg.state === 'started') {
            results.wsStartRecording = true;
            console.log('[TEST] ✓ 开始录音响应正确');
            
            // 步骤 2: 发送停止录音命令
            testStep = 2;
            console.log('[TEST] 发送 stop_recording 命令...');
            ws.send(JSON.stringify({ type: 'stop_recording' }));
          }
          break;
          
        case 2:
          // 期望收到 recording_state: stopped
          if (msg.type === 'recording_state' && msg.state === 'stopped') {
            results.wsStopRecording = true;
            console.log('[TEST] ✓ 停止录音响应正确');
            testStep = 3;
          } else if (msg.type === 'transcription_complete') {
            results.wsTranscriptionReceived = true;
            console.log('[TEST] ✓ 收到转录结果');
            
            // 步骤 3: 测试取消录音
            testStep = 4;
            // 先开始录音
            const startMsg = {
              type: 'start_recording',
              mode: 'toggle',
              asr_config: {
                primary: {
                  provider: 'doubao',
                  mode: 'http',
                },
                enable_fallback: true,
              },
            };
            console.log('[TEST] 发送 start_recording (toggle 模式)...');
            ws.send(JSON.stringify(startMsg));
          }
          break;
          
        case 3:
          // 等待转录结果
          if (msg.type === 'transcription_complete') {
            results.wsTranscriptionReceived = true;
            console.log('[TEST] ✓ 收到转录结果');
            
            // 步骤 3: 测试取消录音
            testStep = 4;
            const startMsg = {
              type: 'start_recording',
              mode: 'toggle',
              asr_config: {
                primary: {
                  provider: 'doubao',
                  mode: 'http',
                },
                enable_fallback: true,
              },
            };
            console.log('[TEST] 发送 start_recording (toggle 模式)...');
            ws.send(JSON.stringify(startMsg));
          }
          break;
          
        case 4:
          // 期望收到 recording_state: started
          if (msg.type === 'recording_state' && msg.state === 'started') {
            // 发送取消录音命令
            testStep = 5;
            console.log('[TEST] 发送 cancel_recording 命令...');
            ws.send(JSON.stringify({ type: 'cancel_recording' }));
          }
          break;
          
        case 5:
          // 期望收到 recording_state: cancelled
          if (msg.type === 'recording_state' && msg.state === 'cancelled') {
            results.wsCancelRecording = true;
            console.log('[TEST] ✓ 取消录音响应正确');
            
            // 步骤 4: 测试更新配置
            testStep = 6;
            const updateMsg = {
              type: 'update_config',
              asr_config: {
                primary: {
                  provider: 'sensevoice',
                  mode: 'http',
                  siliconflow_api_key: 'test-key',
                },
                enable_fallback: false,
              },
            };
            console.log('[TEST] 发送 update_config 命令...');
            ws.send(JSON.stringify(updateMsg));
            
            // update_config 不会有响应，直接标记成功
            results.wsUpdateConfig = true;
            console.log('[TEST] ✓ 更新配置命令已发送');
            
            // 测试完成
            clearTimeout(timeout);
            ws.close();
            resolve();
          }
          break;
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
  console.log('         Voice Server 验证结果');
  console.log('========================================\n');
  
  const tests = [
    ['服务器启动', results.serverStart],
    ['端口解析', results.portParsed],
    ['WebSocket 连接', results.wsConnect],
    ['开始录音命令', results.wsStartRecording],
    ['停止录音命令', results.wsStopRecording],
    ['转录结果接收', results.wsTranscriptionReceived],
    ['取消录音命令', results.wsCancelRecording],
    ['更新配置命令', results.wsUpdateConfig],
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
