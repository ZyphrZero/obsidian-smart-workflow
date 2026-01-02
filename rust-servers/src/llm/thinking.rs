// 思考内容过滤器
// 用于过滤 LLM 响应中的思考过程标签

use std::borrow::Cow;

/// 思考内容过滤结果
#[derive(Debug, Clone, PartialEq)]
pub struct FilterResult {
    /// 过滤后的内容（移除思考标签后的文本）
    pub content: String,
    /// 提取的思考内容（如果有）
    pub thinking: Option<String>,
}

/// 思考内容过滤器
/// 
/// 支持两种思考标签格式：
/// 1. `<think>...</think>` - 英文标签
/// 2. `【思考】...【/思考】` - 中文标签
/// 
/// Requirements 4.3: 检测并过滤思考内容标签
pub struct ThinkingFilter;

impl ThinkingFilter {
    /// 过滤思考内容
    /// 
    /// 返回过滤后的内容和提取的思考内容
    pub fn filter(content: &str) -> FilterResult {
        let mut result = content.to_string();
        let mut thinking_parts = Vec::new();
        
        // 过滤 <think>...</think> 标签
        result = Self::filter_tag(&result, "<think>", "</think>", &mut thinking_parts);
        
        // 过滤 【思考】...【/思考】 标签
        result = Self::filter_tag(&result, "【思考】", "【/思考】", &mut thinking_parts);
        
        // 清理多余的空白
        let content = Self::clean_whitespace(&result);
        
        // 合并思考内容
        let thinking = if thinking_parts.is_empty() {
            None
        } else {
            Some(thinking_parts.join("\n"))
        };
        
        FilterResult { content, thinking }
    }
    
    /// 过滤指定标签
    fn filter_tag(
        content: &str,
        open_tag: &str,
        close_tag: &str,
        thinking_parts: &mut Vec<String>,
    ) -> String {
        let mut result = String::new();
        let mut remaining = content;
        
        while let Some(start) = remaining.find(open_tag) {
            // 添加标签前的内容
            result.push_str(&remaining[..start]);
            
            // 查找结束标签
            let after_open = &remaining[start + open_tag.len()..];
            if let Some(end) = after_open.find(close_tag) {
                // 提取思考内容
                let thinking = after_open[..end].trim().to_string();
                if !thinking.is_empty() {
                    thinking_parts.push(thinking);
                }
                
                // 跳过结束标签
                remaining = &after_open[end + close_tag.len()..];
            } else {
                // 没有找到结束标签，保留剩余内容
                // 这可能是流式传输中的不完整标签
                result.push_str(&remaining[start..]);
                remaining = "";
                break;
            }
        }
        
        // 添加剩余内容
        result.push_str(remaining);
        
        result
    }
    
    /// 清理多余的空白
    fn clean_whitespace(content: &str) -> String {
        // 首先处理连续空格（将多个空格合并为一个）
        let mut result = String::new();
        let mut prev_space = false;
        
        for ch in content.chars() {
            if ch == ' ' {
                if !prev_space {
                    result.push(ch);
                    prev_space = true;
                }
                // 跳过连续的空格
            } else if ch == '\n' || ch == '\r' {
                // 保留换行符，重置空格状态
                result.push(ch);
                prev_space = false;
            } else {
                result.push(ch);
                prev_space = false;
            }
        }
        
        // 然后处理连续的空行
        let lines: Vec<&str> = result.lines().collect();
        let mut final_lines = Vec::new();
        let mut prev_empty = false;
        
        for line in lines {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                if !prev_empty && !final_lines.is_empty() {
                    final_lines.push("");
                    prev_empty = true;
                }
            } else {
                final_lines.push(trimmed);
                prev_empty = false;
            }
        }
        
        // 移除开头和结尾的空行
        while final_lines.first() == Some(&"") {
            final_lines.remove(0);
        }
        while final_lines.last() == Some(&"") {
            final_lines.pop();
        }
        
        final_lines.join("\n")
    }
    
    /// 检查内容是否包含思考标签
    pub fn has_thinking_tags(content: &str) -> bool {
        content.contains("<think>") || content.contains("【思考】")
    }
    
    /// 检查是否是不完整的思考标签（用于流式处理）
    /// 
    /// 返回 true 如果内容以未闭合的思考标签结尾
    pub fn has_incomplete_tag(content: &str) -> bool {
        // 检查 <think> 标签
        let think_opens = content.matches("<think>").count();
        let think_closes = content.matches("</think>").count();
        if think_opens > think_closes {
            return true;
        }
        
        // 检查 【思考】 标签
        let cn_opens = content.matches("【思考】").count();
        let cn_closes = content.matches("【/思考】").count();
        if cn_opens > cn_closes {
            return true;
        }
        
        false
    }
    
    /// 提取思考内容（不修改原内容）
    pub fn extract_thinking(content: &str) -> Option<String> {
        let result = Self::filter(content);
        result.thinking
    }
    
    /// 仅移除思考标签（返回过滤后的内容）
    pub fn remove_thinking(content: &str) -> Cow<'_, str> {
        if !Self::has_thinking_tags(content) {
            return Cow::Borrowed(content);
        }
        
        let result = Self::filter(content);
        Cow::Owned(result.content)
    }
}

// ============================================================================
// 流式思考过滤器
// ============================================================================

/// 流式思考过滤器
/// 
/// 用于处理流式传输中的思考内容，支持跨块检测
pub struct StreamingThinkingFilter {
    /// 缓冲区，用于存储可能不完整的标签
    buffer: String,
    /// 是否在思考标签内
    in_thinking: bool,
    /// 当前思考标签类型
    tag_type: Option<TagType>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum TagType {
    English,  // <think>...</think>
    Chinese,  // 【思考】...【/思考】
}

impl StreamingThinkingFilter {
    /// 创建新的流式过滤器
    pub fn new() -> Self {
        Self {
            buffer: String::new(),
            in_thinking: false,
            tag_type: None,
        }
    }
    
    /// 处理流式数据块
    /// 
    /// 返回 (过滤后的内容, 思考内容)
    pub fn process_chunk(&mut self, chunk: &str) -> (String, Option<String>) {
        self.buffer.push_str(chunk);
        
        let mut content = String::new();
        let mut thinking = String::new();
        
        while !self.buffer.is_empty() {
            if self.in_thinking {
                // 在思考标签内，查找结束标签
                let close_tag = match self.tag_type {
                    Some(TagType::English) => "</think>",
                    Some(TagType::Chinese) => "【/思考】",
                    None => break,
                };
                
                if let Some(end) = self.buffer.find(close_tag) {
                    // 找到结束标签
                    thinking.push_str(&self.buffer[..end]);
                    self.buffer = self.buffer[end + close_tag.len()..].to_string();
                    self.in_thinking = false;
                    self.tag_type = None;
                } else {
                    // 没有找到结束标签，可能是不完整的
                    // 检查是否可能是部分结束标签
                    if self.might_be_partial_close_tag(close_tag) {
                        // 保留缓冲区，等待更多数据
                        break;
                    }
                    // 将内容添加到思考中
                    thinking.push_str(&self.buffer);
                    self.buffer.clear();
                    break;
                }
            } else {
                // 不在思考标签内，查找开始标签
                let en_start = self.buffer.find("<think>");
                let cn_start = self.buffer.find("【思考】");
                
                match (en_start, cn_start) {
                    (Some(en), Some(cn)) => {
                        // 两种标签都存在，选择先出现的
                        if en < cn {
                            content.push_str(&self.buffer[..en]);
                            self.buffer = self.buffer[en + 7..].to_string();
                            self.in_thinking = true;
                            self.tag_type = Some(TagType::English);
                        } else {
                            content.push_str(&self.buffer[..cn]);
                            self.buffer = self.buffer[cn + "【思考】".len()..].to_string();
                            self.in_thinking = true;
                            self.tag_type = Some(TagType::Chinese);
                        }
                    }
                    (Some(en), None) => {
                        content.push_str(&self.buffer[..en]);
                        self.buffer = self.buffer[en + 7..].to_string();
                        self.in_thinking = true;
                        self.tag_type = Some(TagType::English);
                    }
                    (None, Some(cn)) => {
                        content.push_str(&self.buffer[..cn]);
                        self.buffer = self.buffer[cn + "【思考】".len()..].to_string();
                        self.in_thinking = true;
                        self.tag_type = Some(TagType::Chinese);
                    }
                    (None, None) => {
                        // 没有找到开始标签
                        // 检查是否可能是部分开始标签
                        if self.might_be_partial_open_tag() {
                            // 保留可能的部分标签
                            let safe_len = self.find_safe_output_length();
                            content.push_str(&self.buffer[..safe_len]);
                            self.buffer = self.buffer[safe_len..].to_string();
                        } else {
                            content.push_str(&self.buffer);
                            self.buffer.clear();
                        }
                        break;
                    }
                }
            }
        }
        
        let thinking_result = if thinking.is_empty() {
            None
        } else {
            Some(thinking.trim().to_string())
        };
        
        (content, thinking_result)
    }
    
    /// 检查是否可能是部分开始标签
    fn might_be_partial_open_tag(&self) -> bool {
        let suffixes = ["<", "<t", "<th", "<thi", "<thin", "<think",
                       "【", "【思", "【思考"];
        for suffix in suffixes {
            if self.buffer.ends_with(suffix) {
                return true;
            }
        }
        false
    }
    
    /// 检查是否可能是部分结束标签
    fn might_be_partial_close_tag(&self, close_tag: &str) -> bool {
        for i in 1..close_tag.len() {
            if self.buffer.ends_with(&close_tag[..i]) {
                return true;
            }
        }
        false
    }
    
    /// 找到安全输出长度（不包含可能的部分标签）
    fn find_safe_output_length(&self) -> usize {
        let max_tag_start = 7.max("【思考】".len());
        if self.buffer.len() <= max_tag_start {
            0
        } else {
            self.buffer.len() - max_tag_start
        }
    }
    
    /// 刷新缓冲区（流结束时调用）
    pub fn flush(&mut self) -> (String, Option<String>) {
        let thinking = if self.in_thinking {
            // 如果还在思考标签内，将缓冲区作为思考内容
            let t = std::mem::take(&mut self.buffer);
            if t.is_empty() { None } else { Some(t) }
        } else {
            None
        };
        
        let content = if !self.in_thinking {
            std::mem::take(&mut self.buffer)
        } else {
            String::new()
        };
        
        self.in_thinking = false;
        self.tag_type = None;
        
        (content, thinking)
    }
    
    /// 重置过滤器状态
    pub fn reset(&mut self) {
        self.buffer.clear();
        self.in_thinking = false;
        self.tag_type = None;
    }
    
    /// 检查是否在思考标签内
    pub fn is_in_thinking(&self) -> bool {
        self.in_thinking
    }
}

impl Default for StreamingThinkingFilter {
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
    fn test_filter_english_tag() {
        let content = "Hello <think>this is thinking</think> World";
        let result = ThinkingFilter::filter(content);
        
        // 标签前后各有一个空格，过滤后会有两个空格，clean_whitespace 会处理
        assert_eq!(result.content, "Hello World");
        assert_eq!(result.thinking, Some("this is thinking".to_string()));
    }
    
    #[test]
    fn test_filter_chinese_tag() {
        let content = "你好 【思考】这是思考内容【/思考】 世界";
        let result = ThinkingFilter::filter(content);
        
        assert_eq!(result.content, "你好 世界");
        assert_eq!(result.thinking, Some("这是思考内容".to_string()));
    }
    
    #[test]
    fn test_filter_multiple_tags() {
        let content = "<think>first</think> middle 【思考】second【/思考】 end";
        let result = ThinkingFilter::filter(content);
        
        assert_eq!(result.content, "middle end");
        assert_eq!(result.thinking, Some("first\nsecond".to_string()));
    }
    
    #[test]
    fn test_filter_no_tags() {
        let content = "Hello World";
        let result = ThinkingFilter::filter(content);
        
        assert_eq!(result.content, "Hello World");
        assert_eq!(result.thinking, None);
    }
    
    #[test]
    fn test_filter_empty_tag() {
        let content = "Hello <think></think> World";
        let result = ThinkingFilter::filter(content);
        
        assert_eq!(result.content, "Hello World");
        assert_eq!(result.thinking, None);
    }
    
    #[test]
    fn test_filter_nested_content() {
        let content = "<think>Let me think about this...\nStep 1: ...\nStep 2: ...</think>The answer is 42.";
        let result = ThinkingFilter::filter(content);
        
        assert_eq!(result.content, "The answer is 42.");
        assert!(result.thinking.is_some());
        assert!(result.thinking.unwrap().contains("Step 1"));
    }
    
    #[test]
    fn test_has_thinking_tags() {
        assert!(ThinkingFilter::has_thinking_tags("<think>test</think>"));
        assert!(ThinkingFilter::has_thinking_tags("【思考】test【/思考】"));
        assert!(!ThinkingFilter::has_thinking_tags("no tags here"));
    }
    
    #[test]
    fn test_has_incomplete_tag() {
        assert!(ThinkingFilter::has_incomplete_tag("<think>incomplete"));
        assert!(ThinkingFilter::has_incomplete_tag("【思考】incomplete"));
        assert!(!ThinkingFilter::has_incomplete_tag("<think>complete</think>"));
        assert!(!ThinkingFilter::has_incomplete_tag("no tags"));
    }
    
    #[test]
    fn test_remove_thinking() {
        let content = "Hello <think>thinking</think> World";
        let result = ThinkingFilter::remove_thinking(content);
        
        assert_eq!(result.as_ref(), "Hello World");
    }
    
    #[test]
    fn test_remove_thinking_no_tags() {
        let content = "Hello World";
        let result = ThinkingFilter::remove_thinking(content);
        
        // 应该返回借用，不是新分配
        assert!(matches!(result, Cow::Borrowed(_)));
        assert_eq!(result.as_ref(), "Hello World");
    }
    
    // 流式过滤器测试
    
    #[test]
    fn test_streaming_simple() {
        let mut filter = StreamingThinkingFilter::new();
        
        let (content, thinking) = filter.process_chunk("Hello World");
        assert_eq!(content, "Hello World");
        assert_eq!(thinking, None);
    }
    
    #[test]
    fn test_streaming_complete_tag() {
        let mut filter = StreamingThinkingFilter::new();
        
        let (content, thinking) = filter.process_chunk("Hello <think>thinking</think> World");
        assert_eq!(content, "Hello  World");
        assert_eq!(thinking, Some("thinking".to_string()));
    }
    
    #[test]
    fn test_streaming_split_tag() {
        let mut filter = StreamingThinkingFilter::new();
        
        // 第一块：开始标签
        let (content1, thinking1) = filter.process_chunk("Hello <think>thin");
        assert_eq!(content1, "Hello ");
        // 在思考标签内，所以 thinking 可能有部分内容
        // 但由于还没有结束标签，thinking 应该是 None
        assert!(thinking1.is_none() || thinking1 == Some("thin".to_string()));
        
        // 第二块：结束标签
        let (content2, thinking2) = filter.process_chunk("king</think> World");
        assert_eq!(content2, " World");
        // 完整的思考内容
        assert!(thinking2.is_some());
        assert!(thinking2.unwrap().contains("king"));
    }
    
    #[test]
    fn test_streaming_chinese_tag() {
        let mut filter = StreamingThinkingFilter::new();
        
        let (content, thinking) = filter.process_chunk("你好 【思考】思考中【/思考】 世界");
        assert_eq!(content, "你好  世界");
        assert_eq!(thinking, Some("思考中".to_string()));
    }
    
    #[test]
    fn test_streaming_flush() {
        let mut filter = StreamingThinkingFilter::new();
        
        // 不完整的标签
        let (content1, thinking1) = filter.process_chunk("Hello <think>incomplete");
        assert_eq!(content1, "Hello ");
        
        // 在处理过程中，"incomplete" 被添加到内部缓冲区
        // 由于没有结束标签，thinking1 可能为 None（内容还在缓冲区中）
        
        // 刷新 - 由于在思考标签内，缓冲区内容作为思考内容返回
        let (content2, thinking2) = filter.flush();
        // content2 应该为空，因为我们在思考标签内
        assert!(content2.is_empty());
        // thinking2 应该包含 "incomplete"
        // 注意：thinking1 或 thinking2 中应该有一个包含 "incomplete"
        let has_incomplete = thinking1.as_ref().map_or(false, |t| t.contains("incomplete"))
            || thinking2.as_ref().map_or(false, |t| t.contains("incomplete"));
        assert!(has_incomplete, "Expected 'incomplete' in thinking content");
    }
    
    #[test]
    fn test_streaming_reset() {
        let mut filter = StreamingThinkingFilter::new();
        
        filter.process_chunk("Hello <think>test");
        assert!(filter.is_in_thinking());
        
        filter.reset();
        assert!(!filter.is_in_thinking());
    }
}
