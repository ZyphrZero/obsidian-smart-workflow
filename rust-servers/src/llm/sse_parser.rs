// SSE (Server-Sent Events) 解析器
// 用于解析 LLM API 返回的流式响应

/// SSE 事件类型
#[derive(Debug, Clone, PartialEq)]
pub enum SSEEvent {
    /// 数据事件
    Data(String),
    /// 流结束标记
    Done,
    /// 注释（通常忽略）
    Comment(String),
    /// 事件类型
    Event { event_type: String, data: String },
}

/// SSE 解析器
/// 
/// 处理 SSE 流数据，支持跨块解析
/// 
/// Requirements 4.2: 解析 SSE 数据块并发送 stream_chunk 消息
pub struct SSEParser {
    /// 缓冲区，用于存储不完整的行
    buffer: String,
    /// 当前事件类型
    current_event_type: Option<String>,
    /// 当前数据行
    current_data: Vec<String>,
}

impl SSEParser {
    /// 创建新的 SSE 解析器
    pub fn new() -> Self {
        Self {
            buffer: String::new(),
            current_event_type: None,
            current_data: Vec::new(),
        }
    }
    
    /// 解析 SSE 数据块
    /// 
    /// 返回解析出的事件列表
    /// 
    /// SSE 格式规范:
    /// - 每行以 \n 或 \r\n 结尾
    /// - 空行表示事件结束
    /// - data: 开头的行是数据
    /// - event: 开头的行指定事件类型
    /// - : 开头的行是注释
    /// - [DONE] 表示流结束
    pub fn parse_chunk(&mut self, chunk: &str) -> Vec<SSEEvent> {
        let mut events = Vec::new();
        
        // 将新数据添加到缓冲区
        self.buffer.push_str(chunk);
        
        // 按行处理
        while let Some(line_end) = self.find_line_end() {
            let line = self.buffer[..line_end].to_string();
            
            // 移除已处理的行（包括换行符）
            let skip = if self.buffer[line_end..].starts_with("\r\n") {
                line_end + 2
            } else {
                line_end + 1
            };
            self.buffer = self.buffer[skip..].to_string();
            
            // 处理行
            if let Some(event) = self.process_line(&line) {
                events.push(event);
            }
        }
        
        events
    }
    
    /// 查找行结束位置
    fn find_line_end(&self) -> Option<usize> {
        // 优先查找 \r\n，然后是 \n，最后是 \r
        if let Some(pos) = self.buffer.find("\r\n") {
            return Some(pos);
        }
        if let Some(pos) = self.buffer.find('\n') {
            return Some(pos);
        }
        // 单独的 \r 只有在没有后续字符或后续不是 \n 时才算行结束
        if let Some(pos) = self.buffer.find('\r') {
            // 检查是否是 \r\n 的一部分（已经在上面处理了）
            // 或者是否是缓冲区末尾（可能是不完整的 \r\n）
            if pos + 1 < self.buffer.len() {
                return Some(pos);
            }
        }
        None
    }
    
    /// 处理单行
    fn process_line(&mut self, line: &str) -> Option<SSEEvent> {
        // 空行表示事件结束
        if line.is_empty() {
            return self.flush_event();
        }
        
        // 注释行
        if line.starts_with(':') {
            let comment = line[1..].trim().to_string();
            return Some(SSEEvent::Comment(comment));
        }
        
        // 解析字段
        if let Some((field, value)) = self.parse_field(line) {
            match field {
                "data" => {
                    // 检查是否是 [DONE] 标记
                    let trimmed = value.trim();
                    if trimmed == "[DONE]" {
                        return Some(SSEEvent::Done);
                    }
                    self.current_data.push(value.to_string());
                }
                "event" => {
                    self.current_event_type = Some(value.to_string());
                }
                _ => {
                    // 忽略其他字段 (id, retry 等)
                }
            }
        }
        
        None
    }
    
    /// 解析字段
    fn parse_field<'a>(&self, line: &'a str) -> Option<(&'a str, &'a str)> {
        if let Some(colon_pos) = line.find(':') {
            let field = &line[..colon_pos];
            let value = if colon_pos + 1 < line.len() {
                let v = &line[colon_pos + 1..];
                // 移除值开头的单个空格（如果有）
                if v.starts_with(' ') {
                    &v[1..]
                } else {
                    v
                }
            } else {
                ""
            };
            Some((field, value))
        } else {
            None
        }
    }
    
    /// 刷新当前事件
    fn flush_event(&mut self) -> Option<SSEEvent> {
        if self.current_data.is_empty() {
            return None;
        }
        
        // 合并多行数据
        let data = self.current_data.join("\n");
        self.current_data.clear();
        
        let event = if let Some(event_type) = self.current_event_type.take() {
            SSEEvent::Event { event_type, data }
        } else {
            SSEEvent::Data(data)
        };
        
        Some(event)
    }
    
    /// 重置解析器状态
    pub fn reset(&mut self) {
        self.buffer.clear();
        self.current_event_type = None;
        self.current_data.clear();
    }
    
    /// 检查是否有未处理的数据
    pub fn has_pending_data(&self) -> bool {
        !self.buffer.is_empty() || !self.current_data.is_empty()
    }
}

impl Default for SSEParser {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// 测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_parse_simple_data() {
        let mut parser = SSEParser::new();
        let events = parser.parse_chunk("data: hello\n\n");
        
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], SSEEvent::Data("hello".to_string()));
    }
    
    #[test]
    fn test_parse_multiple_data_lines() {
        let mut parser = SSEParser::new();
        let events = parser.parse_chunk("data: line1\ndata: line2\n\n");
        
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], SSEEvent::Data("line1\nline2".to_string()));
    }
    
    #[test]
    fn test_parse_done_marker() {
        let mut parser = SSEParser::new();
        let events = parser.parse_chunk("data: [DONE]\n\n");
        
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], SSEEvent::Done);
    }
    
    #[test]
    fn test_parse_comment() {
        let mut parser = SSEParser::new();
        let events = parser.parse_chunk(": this is a comment\n");
        
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], SSEEvent::Comment("this is a comment".to_string()));
    }
    
    #[test]
    fn test_parse_event_with_type() {
        let mut parser = SSEParser::new();
        let events = parser.parse_chunk("event: message\ndata: hello\n\n");
        
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], SSEEvent::Event {
            event_type: "message".to_string(),
            data: "hello".to_string(),
        });
    }
    
    #[test]
    fn test_parse_chunked_data() {
        let mut parser = SSEParser::new();
        
        // 第一个块：不完整的行
        let events1 = parser.parse_chunk("data: hel");
        assert!(events1.is_empty());
        
        // 第二个块：完成行
        let events2 = parser.parse_chunk("lo\n\n");
        assert_eq!(events2.len(), 1);
        assert_eq!(events2[0], SSEEvent::Data("hello".to_string()));
    }
    
    #[test]
    fn test_parse_crlf_line_endings() {
        let mut parser = SSEParser::new();
        let events = parser.parse_chunk("data: hello\r\n\r\n");
        
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], SSEEvent::Data("hello".to_string()));
    }
    
    #[test]
    fn test_parse_multiple_events() {
        let mut parser = SSEParser::new();
        let events = parser.parse_chunk("data: first\n\ndata: second\n\n");
        
        assert_eq!(events.len(), 2);
        assert_eq!(events[0], SSEEvent::Data("first".to_string()));
        assert_eq!(events[1], SSEEvent::Data("second".to_string()));
    }
    
    #[test]
    fn test_parse_json_data() {
        let mut parser = SSEParser::new();
        let json = r#"{"choices":[{"delta":{"content":"Hello"}}]}"#;
        let events = parser.parse_chunk(&format!("data: {}\n\n", json));
        
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], SSEEvent::Data(json.to_string()));
    }
    
    #[test]
    fn test_reset() {
        let mut parser = SSEParser::new();
        parser.parse_chunk("data: incomplete");
        
        assert!(parser.has_pending_data());
        
        parser.reset();
        
        assert!(!parser.has_pending_data());
    }
    
    #[test]
    fn test_empty_data_value() {
        let mut parser = SSEParser::new();
        let events = parser.parse_chunk("data:\n\n");
        
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], SSEEvent::Data("".to_string()));
    }
    
    #[test]
    fn test_data_with_colon() {
        let mut parser = SSEParser::new();
        let events = parser.parse_chunk("data: key: value\n\n");
        
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], SSEEvent::Data("key: value".to_string()));
    }
}
