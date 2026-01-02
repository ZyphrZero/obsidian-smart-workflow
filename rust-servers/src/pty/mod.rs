// PTY 模块
// 提供终端会话管理功能

mod session;
mod shell;

pub use session::{PtySession, PtyReader, PtyWriter};
pub use shell::{get_shell_by_type, get_shell_integration_script, get_default_shell};

use crate::router::{ModuleHandler, ModuleMessage, ModuleType, RouterError, ServerResponse};
use crate::server::WsSender;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as TokioMutex;
use tokio_tungstenite::tungstenite::Message;
use futures_util::SinkExt;

/// 日志宏
macro_rules! log_info {
    ($($arg:tt)*) => {
        eprintln!("[INFO] [PTY] {}", format!($($arg)*));
    };
}

macro_rules! log_error {
    ($($arg:tt)*) => {
        eprintln!("[ERROR] [PTY] {}", format!($($arg)*));
    };
}

macro_rules! log_debug {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[DEBUG] [PTY] {}", format!($($arg)*));
        }
    };
}

// ============================================================================
// PTY 处理器
// ============================================================================

/// PTY 模块处理器
/// 
/// 管理 PTY 会话的生命周期，处理终端相关的消息
pub struct PtyHandler {
    /// 当前 PTY 会话 (每个连接一个会话)
    session: TokioMutex<Option<Arc<TokioMutex<PtySession>>>>,
    /// PTY 读取器
    reader: TokioMutex<Option<Arc<Mutex<PtyReader>>>>,
    /// PTY 写入器
    writer: TokioMutex<Option<Arc<Mutex<PtyWriter>>>>,
    /// WebSocket 发送器 (用于发送 PTY 输出)
    ws_sender: TokioMutex<Option<WsSender>>,
    /// 读取任务句柄
    read_task: TokioMutex<Option<tokio::task::JoinHandle<()>>>,
    /// Shell 类型 (用于 Shell Integration)
    shell_type: TokioMutex<Option<String>>,
}

impl PtyHandler {
    /// 创建新的 PTY 处理器
    pub fn new() -> Self {
        Self {
            session: TokioMutex::new(None),
            reader: TokioMutex::new(None),
            writer: TokioMutex::new(None),
            ws_sender: TokioMutex::new(None),
            read_task: TokioMutex::new(None),
            shell_type: TokioMutex::new(None),
        }
    }
    
    /// 设置 WebSocket 发送器
    pub async fn set_ws_sender(&self, sender: WsSender) {
        let mut ws_sender = self.ws_sender.lock().await;
        *ws_sender = Some(sender);
    }
    
    /// 处理 init 消息 - 创建 PTY 会话
    async fn handle_init(
        &self,
        shell_type: Option<String>,
        shell_args: Option<Vec<String>>,
        cwd: Option<String>,
        env: Option<HashMap<String, String>>,
    ) -> Result<Option<ServerResponse>, RouterError> {
        log_info!("初始化 PTY 会话: shell_type={:?}, cwd={:?}", shell_type, cwd);
        
        // 创建 PTY 会话
        let (pty_session, pty_reader, pty_writer) = PtySession::new(
            80,
            24,
            shell_type.as_deref(),
            shell_args.as_ref().map(|v| v.as_slice()),
            cwd.as_deref(),
            env.as_ref(),
        ).map_err(|e| RouterError::ModuleError(format!("创建 PTY 会话失败: {}", e)))?;
        
        // 保存会话和读写器
        let pty_session = Arc::new(TokioMutex::new(pty_session));
        let pty_reader = Arc::new(Mutex::new(pty_reader));
        let pty_writer = Arc::new(Mutex::new(pty_writer));
        
        {
            let mut session = self.session.lock().await;
            *session = Some(Arc::clone(&pty_session));
        }
        {
            let mut reader = self.reader.lock().await;
            *reader = Some(Arc::clone(&pty_reader));
        }
        {
            let mut writer = self.writer.lock().await;
            *writer = Some(Arc::clone(&pty_writer));
        }
        {
            let mut st = self.shell_type.lock().await;
            *st = shell_type.clone();
        }
        
        // 启动 PTY 输出读取任务
        self.start_read_task().await?;
        
        log_info!("PTY 会话创建成功");
        
        // 返回成功响应
        Ok(Some(ServerResponse::new(
            ModuleType::Pty,
            "init_complete",
            serde_json::json!({
                "success": true
            }),
        )))
    }
    
    /// 启动 PTY 输出读取任务
    async fn start_read_task(&self) -> Result<(), RouterError> {
        let reader = {
            let reader_guard = self.reader.lock().await;
            reader_guard.clone()
        };
        
        let ws_sender = {
            let ws_sender_guard = self.ws_sender.lock().await;
            ws_sender_guard.clone()
        };
        
        let writer = {
            let writer_guard = self.writer.lock().await;
            writer_guard.clone()
        };
        
        let shell_type = {
            let st = self.shell_type.lock().await;
            st.clone()
        };
        
        let reader = reader.ok_or_else(|| RouterError::ModuleError("PTY reader not initialized".to_string()))?;
        let ws_sender = ws_sender.ok_or_else(|| RouterError::ModuleError("WebSocket sender not set".to_string()))?;
        
        // 启动读取任务
        let task = tokio::spawn(async move {
            let mut first_output = true;
            
            loop {
                // 在阻塞任务中读取 PTY 输出
                let reader_clone = Arc::clone(&reader);
                let result = tokio::task::spawn_blocking(move || -> Result<(Vec<u8>, usize), String> {
                    let mut reader = reader_clone.lock().unwrap();
                    let mut local_buf = vec![0u8; 8192];
                    match reader.read(&mut local_buf) {
                        Ok(n) => Ok((local_buf, n)),
                        Err(e) => Err(e.to_string()),
                    }
                }).await;
                
                match result {
                    Ok(Ok((data, n))) if n > 0 => {
                        log_debug!("读取 PTY 输出: {} 字节", n);
                        
                        // 构建带 module 字段的响应
                        // 对于二进制数据，我们直接发送，TypeScript 端会根据连接上下文处理
                        let mut sender = ws_sender.lock().await;
                        if let Err(e) = sender.send(Message::Binary(data[..n].to_vec().into())).await {
                            log_error!("发送 PTY 输出失败: {}", e);
                            break;
                        }
                        drop(sender);
                        
                        // 首次输出后注入 Shell Integration 脚本
                        if first_output {
                            first_output = false;
                            if let Some(ref st) = shell_type {
                                if let Some(script) = get_shell_integration_script(st) {
                                    if let Some(ref writer) = writer {
                                        let mut w = writer.lock().unwrap();
                                        if let Err(e) = w.write(script.as_bytes()) {
                                            log_error!("发送 Shell Integration 脚本失败: {}", e);
                                        } else {
                                            log_debug!("Shell Integration 脚本已发送");
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Ok(Ok(_)) => {
                        // EOF
                        log_info!("PTY 输出结束");
                        break;
                    }
                    Ok(Err(e)) => {
                        log_error!("PTY 输出读取错误: {}", e);
                        break;
                    }
                    Err(e) => {
                        log_error!("PTY 读取任务错误: {}", e);
                        break;
                    }
                }
            }
        });
        
        // 保存任务句柄
        let mut read_task = self.read_task.lock().await;
        *read_task = Some(task);
        
        Ok(())
    }
    
    /// 处理 resize 消息 - 调整终端尺寸
    async fn handle_resize(&self, cols: u16, rows: u16) -> Result<Option<ServerResponse>, RouterError> {
        log_info!("调整终端尺寸: {}x{}", cols, rows);
        
        let session = {
            let session_guard = self.session.lock().await;
            session_guard.clone()
        };
        
        if let Some(session) = session {
            let mut pty = session.lock().await;
            pty.resize(cols, rows)
                .map_err(|e| RouterError::ModuleError(format!("调整终端尺寸失败: {}", e)))?;
        } else {
            return Err(RouterError::ModuleError("PTY 会话未初始化".to_string()));
        }
        
        Ok(None) // resize 不需要响应
    }
    
    /// 写入数据到 PTY
    pub async fn write_data(&self, data: &[u8]) -> Result<(), RouterError> {
        let writer = {
            let writer_guard = self.writer.lock().await;
            writer_guard.clone()
        };
        
        if let Some(writer) = writer {
            let mut w = writer.lock().unwrap();
            w.write(data)
                .map_err(|e| RouterError::ModuleError(format!("写入 PTY 失败: {}", e)))?;
        } else {
            return Err(RouterError::ModuleError("PTY writer 未初始化".to_string()));
        }
        
        Ok(())
    }
    
    /// 终止 PTY 会话
    pub async fn kill(&self) -> Result<(), RouterError> {
        log_info!("终止 PTY 会话");
        
        // 终止 PTY 进程
        let session = {
            let session_guard = self.session.lock().await;
            session_guard.clone()
        };
        
        if let Some(session) = session {
            let mut pty = session.lock().await;
            let _ = pty.kill();
        }
        
        // 等待读取任务结束
        let task = {
            let mut read_task = self.read_task.lock().await;
            read_task.take()
        };
        
        if let Some(task) = task {
            let _ = task.await;
        }
        
        // 清理状态
        {
            let mut session = self.session.lock().await;
            *session = None;
        }
        {
            let mut reader = self.reader.lock().await;
            *reader = None;
        }
        {
            let mut writer = self.writer.lock().await;
            *writer = None;
        }
        
        Ok(())
    }
    
    /// 检查会话是否已初始化
    pub async fn is_initialized(&self) -> bool {
        let session = self.session.lock().await;
        session.is_some()
    }
}

impl Default for PtyHandler {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl ModuleHandler for PtyHandler {
    fn module_type(&self) -> ModuleType {
        ModuleType::Pty
    }
    
    async fn handle(&self, msg: &ModuleMessage) -> Result<Option<ServerResponse>, RouterError> {
        log_debug!("处理 PTY 消息: {}", msg.msg_type);
        
        match msg.msg_type.as_str() {
            "init" => {
                let shell_type: Option<String> = msg.get_field("shell_type");
                let shell_args: Option<Vec<String>> = msg.get_field("shell_args");
                let cwd: Option<String> = msg.get_field("cwd");
                let env: Option<HashMap<String, String>> = msg.get_field("env");
                
                self.handle_init(shell_type, shell_args, cwd, env).await
            }
            "resize" => {
                let cols: u16 = msg.get_field("cols").unwrap_or(80);
                let rows: u16 = msg.get_field("rows").unwrap_or(24);
                
                self.handle_resize(cols, rows).await
            }
            "env" => {
                // env 命令在原实现中只是记录日志，实际环境变量在 init 时设置
                let cwd: Option<String> = msg.get_field("cwd");
                let env: Option<HashMap<String, String>> = msg.get_field("env");
                log_info!("收到 env 命令: cwd={:?}, env={:?}", cwd, env);
                Ok(None)
            }
            _ => {
                log_debug!("未知的 PTY 消息类型: {}", msg.msg_type);
                Err(RouterError::ModuleError(format!("未知的 PTY 消息类型: {}", msg.msg_type)))
            }
        }
    }
}
