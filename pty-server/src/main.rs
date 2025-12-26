// PTY 服务器主程序
mod server;
mod pty_session;
mod shell;

use server::{Server, ServerConfig};
use std::env;

/// 简单的日志宏
macro_rules! log_info {
    ($($arg:tt)*) => {
        eprintln!("[INFO] {}", format!($($arg)*));
    };
}

macro_rules! log_debug {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[DEBUG] {}", format!($($arg)*));
        }
    };
}

/// 手动解析命令行参数（比 clap 快约 10-20ms）
fn parse_args() -> u16 {
    let args: Vec<String> = env::args().collect();
    let mut port: u16 = 0;
    
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "-p" | "--port" => {
                if i + 1 < args.len() {
                    port = args[i + 1].parse().unwrap_or(0);
                    i += 1;
                }
            }
            arg if arg.starts_with("--port=") => {
                port = arg.trim_start_matches("--port=").parse().unwrap_or(0);
            }
            "-h" | "--help" => {
                eprintln!("Usage: pty-server [OPTIONS]");
                eprintln!("Options:");
                eprintln!("  -p, --port <PORT>  监听端口（0 表示随机端口）[default: 0]");
                eprintln!("  -h, --help         显示帮助信息");
                std::process::exit(0);
            }
            _ => {}
        }
        i += 1;
    }
    
    port
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 手动解析命令行参数
    let port = parse_args();

    log_debug!("启动参数: port={}", port);

    // 创建服务器配置
    let config = ServerConfig { port };

    // 创建并启动服务器
    let server = Server::new(config);
    let port = server.start().await?;

    // 保持主线程运行
    log_info!("PTY 服务器已启动，监听端口: {}", port);
    
    // 等待 Ctrl+C 信号
    tokio::signal::ctrl_c().await?;
    log_info!("收到退出信号，正在关闭服务器...");

    Ok(())
}
