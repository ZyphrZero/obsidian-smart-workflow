// 语言检测模块
// 使用 whatlang 库实现语言检测，支持简繁中文区分

use serde::Serialize;
use whatlang::{detect, Lang};

/// 日志宏
macro_rules! log_debug {
    ($($arg:tt)*) => {
        if cfg!(debug_assertions) {
            eprintln!("[DEBUG] {}", format!($($arg)*));
        }
    };
}

// ============================================================================
// 语言检测结果
// ============================================================================

/// 语言检测结果
/// 
/// Requirements 5.2: 返回 ISO 639-1 语言代码和置信度分数
#[derive(Debug, Clone, Serialize)]
pub struct LanguageDetectionResult {
    /// ISO 639-1 语言代码
    pub language: String,
    /// 置信度 (0.0 - 1.0)
    pub confidence: f64,
    /// 是否为简体中文 (仅当 language 为 "zh" 时有效)
    /// Requirements 5.3: 能够区分简体中文和繁体中文
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_simplified: Option<bool>,
}

impl LanguageDetectionResult {
    /// 创建新的语言检测结果
    pub fn new(language: &str, confidence: f64) -> Self {
        Self {
            language: language.to_string(),
            confidence,
            is_simplified: None,
        }
    }
    
    /// 创建中文检测结果（包含简繁体信息）
    pub fn chinese(confidence: f64, is_simplified: bool) -> Self {
        Self {
            language: "zh".to_string(),
            confidence,
            is_simplified: Some(is_simplified),
        }
    }
}


// ============================================================================
// 语言检测器
// ============================================================================

/// 语言检测器
/// 
/// 使用 whatlang 库进行语言检测，并支持简繁中文区分
pub struct LanguageDetector;

impl LanguageDetector {
    /// 创建新的语言检测器
    pub fn new() -> Self {
        Self
    }
    
    /// 检测文本语言
    /// 
    /// Requirements 5.1: 检测文本语言并返回结果
    /// Requirements 5.2: 返回 ISO 639-1 语言代码和置信度分数
    /// Requirements 5.3: 能够区分简体中文和繁体中文
    pub fn detect(&self, text: &str) -> LanguageDetectionResult {
        // 空文本返回未知
        if text.trim().is_empty() {
            return LanguageDetectionResult::new("und", 0.0);
        }
        
        // 预检测：优先检查是否包含 CJK 字符
        // 这可以避免 whatlang 在中文混合英文时误判为其他语言（如德语）
        if let Some(result) = self.pre_detect_cjk(text) {
            log_debug!("CJK 预检测结果: {}, 置信度: {}", result.language, result.confidence);
            return result;
        }
        
        // 使用 whatlang 检测语言
        match detect(text) {
            Some(info) => {
                let lang = info.lang();
                let confidence = info.confidence();
                
                log_debug!("whatlang 检测结果: {:?}, 置信度: {}", lang, confidence);
                
                // 转换为 ISO 639-1 代码
                let iso_code = self.lang_to_iso639_1(lang);
                
                // 如果是中文，进一步区分简繁体
                if lang == Lang::Cmn {
                    let is_simplified = self.is_simplified_chinese(text);
                    LanguageDetectionResult::chinese(confidence as f64, is_simplified)
                } else {
                    LanguageDetectionResult::new(&iso_code, confidence as f64)
                }
            }
            None => {
                // 无法检测，返回未知
                log_debug!("无法检测语言");
                LanguageDetectionResult::new("und", 0.0)
            }
        }
    }
    
    /// CJK 预检测
    /// 
    /// 当文本包含足够多的 CJK 字符时，直接返回对应语言
    /// 这可以避免 whatlang 在混合文本时的误判问题
    fn pre_detect_cjk(&self, text: &str) -> Option<LanguageDetectionResult> {
        let mut chinese_count = 0;
        let mut japanese_kana_count = 0;
        let mut korean_count = 0;
        let mut total_chars = 0;
        
        for ch in text.chars() {
            // 跳过空白和 ASCII 字符
            if ch.is_whitespace() || ch.is_ascii() {
                continue;
            }
            
            total_chars += 1;
            
            // 检测日文假名（平假名和片假名）
            if self.is_japanese_kana(ch) {
                japanese_kana_count += 1;
            }
            // 检测韩文
            else if self.is_korean(ch) {
                korean_count += 1;
            }
            // 检测中文（CJK 统一汉字）
            else if self.is_cjk_unified(ch) {
                chinese_count += 1;
            }
        }
        
        // 如果没有非 ASCII 字符，返回 None 让 whatlang 处理
        if total_chars == 0 {
            return None;
        }
        
        // 计算各语言字符占比
        let chinese_ratio = chinese_count as f64 / total_chars as f64;
        let japanese_ratio = japanese_kana_count as f64 / total_chars as f64;
        let korean_ratio = korean_count as f64 / total_chars as f64;
        
        log_debug!(
            "CJK 字符统计: 中文={}, 日文假名={}, 韩文={}, 总计={}",
            chinese_count, japanese_kana_count, korean_count, total_chars
        );
        
        // 日文：有假名就是日文（日文会混用汉字和假名）
        if japanese_kana_count > 0 && japanese_ratio >= 0.1 {
            return Some(LanguageDetectionResult::new("ja", 0.9 + japanese_ratio * 0.1));
        }
        
        // 韩文：韩文字符占比超过 30%
        if korean_ratio >= 0.3 {
            return Some(LanguageDetectionResult::new("ko", 0.9 + korean_ratio * 0.1));
        }
        
        // 中文：CJK 汉字占比超过 20%（允许混合英文）
        if chinese_ratio >= 0.2 && chinese_count >= 3 {
            let is_simplified = self.is_simplified_chinese(text);
            let confidence = 0.85 + chinese_ratio * 0.15;
            return Some(LanguageDetectionResult::chinese(confidence.min(1.0), is_simplified));
        }
        
        None
    }
    
    /// 检查字符是否为日文假名（平假名或片假名）
    fn is_japanese_kana(&self, ch: char) -> bool {
        let code = ch as u32;
        // 平假名: U+3040 - U+309F
        // 片假名: U+30A0 - U+30FF
        (0x3040..=0x309F).contains(&code) || (0x30A0..=0x30FF).contains(&code)
    }
    
    /// 检查字符是否为韩文
    fn is_korean(&self, ch: char) -> bool {
        let code = ch as u32;
        // 韩文音节: U+AC00 - U+D7AF
        // 韩文字母: U+1100 - U+11FF, U+3130 - U+318F
        (0xAC00..=0xD7AF).contains(&code) ||
        (0x1100..=0x11FF).contains(&code) ||
        (0x3130..=0x318F).contains(&code)
    }
    
    /// 检查字符是否为 CJK 统一汉字
    fn is_cjk_unified(&self, ch: char) -> bool {
        let code = ch as u32;
        // CJK 统一汉字: U+4E00 - U+9FFF
        // CJK 扩展 A: U+3400 - U+4DBF
        // CJK 扩展 B: U+20000 - U+2A6DF
        (0x4E00..=0x9FFF).contains(&code) ||
        (0x3400..=0x4DBF).contains(&code) ||
        (0x20000..=0x2A6DF).contains(&code)
    }

    
    /// 将 whatlang Lang 转换为 ISO 639-1 代码
    fn lang_to_iso639_1(&self, lang: Lang) -> String {
        match lang {
            Lang::Eng => "en",
            Lang::Cmn => "zh",
            Lang::Spa => "es",
            Lang::Por => "pt",
            Lang::Rus => "ru",
            Lang::Jpn => "ja",
            Lang::Kor => "ko",
            Lang::Fra => "fr",
            Lang::Deu => "de",
            Lang::Ita => "it",
            Lang::Nld => "nl",
            Lang::Pol => "pl",
            Lang::Tur => "tr",
            Lang::Ara => "ar",
            Lang::Hin => "hi",
            Lang::Vie => "vi",
            Lang::Tha => "th",
            Lang::Ind => "id",
            Lang::Ukr => "uk",
            Lang::Ces => "cs",
            Lang::Ell => "el",
            Lang::Heb => "he",
            Lang::Ron => "ro",
            Lang::Hun => "hu",
            Lang::Swe => "sv",
            Lang::Dan => "da",
            Lang::Fin => "fi",
            Lang::Nob => "no",  // Norwegian Bokmål
            Lang::Cat => "ca",
            Lang::Hrv => "hr",
            Lang::Srp => "sr",
            Lang::Slk => "sk",
            Lang::Slv => "sl",
            Lang::Bul => "bg",
            Lang::Lit => "lt",
            Lang::Lav => "lv",
            Lang::Est => "et",
            Lang::Mkd => "mk",
            Lang::Bel => "be",
            Lang::Afr => "af",
            Lang::Tgl => "tl",
            Lang::Mal => "ml",
            Lang::Tam => "ta",
            Lang::Tel => "te",
            Lang::Ben => "bn",
            Lang::Guj => "gu",
            Lang::Kan => "kn",
            Lang::Mar => "mr",
            Lang::Pan => "pa",
            Lang::Epo => "eo",  // Esperanto
            Lang::Kat => "ka",  // Georgian
            Lang::Yid => "yi",  // Yiddish
            Lang::Amh => "am",  // Amharic
            Lang::Jav => "jv",  // Javanese
            Lang::Urd => "ur",  // Urdu
            Lang::Uzb => "uz",  // Uzbek
            Lang::Aze => "az",  // Azerbaijani
            Lang::Pes => "fa",  // Persian
            Lang::Ori => "or",  // Odia
            Lang::Mya => "my",  // Burmese
            Lang::Nep => "ne",  // Nepali
            Lang::Sin => "si",  // Sinhala
            Lang::Khm => "km",  // Khmer
            Lang::Tuk => "tk",  // Turkmen
            Lang::Aka => "ak",  // Akan
            Lang::Zul => "zu",  // Zulu
            Lang::Sna => "sn",  // Shona
            Lang::Lat => "la",  // Latin
            Lang::Hye => "hy",  // Armenian
            Lang::Cym => "cy",  // Welsh
        }.to_string()
    }

    
    /// 判断中文文本是简体还是繁体
    /// 
    /// 通过统计简体字和繁体字的数量来判断
    /// Requirements 5.3: 能够区分简体中文和繁体中文
    fn is_simplified_chinese(&self, text: &str) -> bool {
        let mut simplified_count = 0;
        let mut traditional_count = 0;
        
        for ch in text.chars() {
            if self.is_simplified_char(ch) {
                simplified_count += 1;
            } else if self.is_traditional_char(ch) {
                traditional_count += 1;
            }
        }
        
        log_debug!("简体字数: {}, 繁体字数: {}", simplified_count, traditional_count);
        
        // 如果简体字数量大于等于繁体字数量，认为是简体中文
        simplified_count >= traditional_count
    }
    
    /// 检查字符是否为简体中文特有字符
    /// 
    /// 这里使用一些常见的简体字作为判断依据
    fn is_simplified_char(&self, ch: char) -> bool {
        // 常见简体字（与繁体不同的字）
        const SIMPLIFIED_CHARS: &[char] = &[
            '国', '为', '这', '个', '们', '来', '时', '会', '对', '发',
            '学', '经', '说', '过', '动', '问', '关', '点', '长', '头',
            '里', '后', '开', '实', '现', '进', '种', '东', '机', '电',
            '车', '书', '见', '门', '马', '鱼', '鸟', '龙', '风', '飞',
            '语', '话', '认', '识', '让', '请', '谁', '读', '写', '听',
            '买', '卖', '贝', '钱', '银', '铁', '钢', '铜', '锁', '镜',
            '医', '药', '病', '痛', '疗', '症', '疯', '疲', '疑', '痕',
            '厂', '广', '产', '业', '农', '渔', '矿', '厅', '厨', '厕',
            '办', '劳', '动', '务', '势', '励', '勤', '勇', '勋', '勒',
            '华', '单', '卫', '历', '压', '厉', '县', '参', '双', '变',
            '叶', '号', '台', '吃', '吗', '吧', '听', '呢', '响', '哪',
            '园', '图', '团', '围', '圆', '圣', '场', '坏', '块', '坚',
            '报', '场', '声', '壳', '处', '备', '复', '夸', '头', '夹',
            '奋', '奖', '奥', '妇', '妈', '姐', '娘', '婴', '嫁', '孙',
            '学', '宁', '宝', '实', '宠', '审', '宪', '宫', '家', '宾',
            '对', '导', '寻', '将', '尔', '尘', '尝', '尽', '层', '属',
            '岁', '岛', '岭', '岸', '币', '师', '帅', '带', '帮', '帐',
            '干', '并', '广', '庄', '庆', '库', '应', '庙', '废', '开',
            '异', '弃', '张', '弹', '强', '归', '当', '录', '彦', '彻',
            '径', '从', '御', '复', '德', '忆', '忧', '怀', '态', '总',
            '恶', '悬', '惊', '惯', '惨', '愿', '慑', '戏', '战', '户',
            '执', '扩', '扫', '扬', '扰', '抚', '抢', '护', '报', '担',
            '拟', '拥', '择', '挂', '挡', '挤', '挥', '损', '换', '据',
            '掷', '搜', '摄', '摆', '摇', '撑', '撤', '擦', '攒', '敌',
            '数', '斋', '斗', '斩', '断', '无', '旧', '时', '昼', '显',
            '晋', '晒', '晓', '晕', '暂', '术', '机', '杀', '杂', '权',
            '条', '来', '杨', '极', '构', '枪', '柜', '标', '栋', '样',
            '桥', '档', '梦', '检', '棱', '椭', '楼', '榄', '槽', '橱',
            '欢', '欧', '歼', '殴', '毁', '毕', '毙', '气', '氢', '汇',
            '汉', '污', '汤', '沟', '没', '沪', '沿', '泪', '泼', '洁',
            '浅', '测', '济', '浑', '浓', '涂', '涛', '涡', '涨', '淀',
            '渊', '渐', '渔', '温', '湾', '溃', '滚', '滞', '滨', '滩',
            '满', '漏', '潜', '澜', '灭', '灯', '灵', '灶', '灾', '炉',
            '炼', '烂', '烛', '烟', '烦', '烧', '热', '焕', '焰', '煤',
            '熟', '燃', '爱', '爷', '牵', '犹', '狭', '狮', '独', '狱',
            '猎', '猪', '献', '玛', '环', '现', '玻', '珑', '珠', '琐',
            '瑶', '璃', '瓶', '甚', '电', '画', '畅', '疗', '疯', '疲',
            '疼', '痒', '痴', '瘦', '癣', '皱', '盏', '盐', '监', '盖',
            '盘', '眯', '睁', '睐', '睦', '瞒', '矫', '矿', '码', '砖',
            '础', '硕', '确', '碍', '碰', '磁', '礼', '祝', '祸', '禀',
            '离', '秃', '秆', '积', '称', '税', '稳', '穷', '窃', '窍',
            '窜', '窝', '窥', '竖', '竞', '笔', '笼', '筑', '筛', '筹',
            '签', '简', '箩', '篮', '篱', '类', '粮', '粪', '糊', '纠',
            '红', '纤', '约', '级', '纪', '纬', '纯', '纱', '纲', '纳',
            '纵', '纷', '纸', '纹', '纺', '纽', '线', '练', '组', '细',
            '织', '终', '绍', '经', '结', '绕', '绘', '给', '络', '绝',
            '统', '绣', '继', '绩', '绪', '续', '绳', '维', '绵', '综',
            '绿', '缀', '缓', '编', '缘', '缚', '缝', '缠', '缩', '缴',
            '缸', '罐', '网', '罗', '罚', '罢', '罩', '羁', '翘', '耸',
            '聂', '职', '联', '聪', '肃', '肠', '肤', '肿', '胀', '胁',
            '胆', '胜', '胧', '胶', '脉', '脏', '脑', '脱', '脸', '腊',
            '腻', '腾', '膜', '舆', '舰', '舱', '艰', '艳', '艺', '节',
            '芜', '芦', '苇', '苍', '苏', '苹', '茎', '荆', '荐', '荡',
            '荣', '药', '莅', '莱', '莲', '获', '萝', '营', '萧', '萨',
            '葱', '蒋', '蒙', '蓝', '蔑', '蔷', '蔼', '蕴', '薪', '藏',
            '虏', '虑', '虚', '虫', '蚀', '蚁', '蚂', '蛋', '蛮', '蜡',
            '蝇', '蝉', '蝴', '螺', '蟹', '衅', '补', '衬', '袄', '袜',
            '袭', '装', '裤', '褂', '褴', '览', '觉', '观', '规', '觅',
            '视', '览', '觉', '触', '誉', '计', '订', '认', '讨', '让',
            '讯', '记', '讲', '讳', '许', '论', '讼', '设', '访', '证',
            '评', '识', '诈', '诉', '词', '译', '试', '诗', '诚', '话',
            '诞', '询', '详', '语', '误', '说', '请', '诸', '诺', '读',
            '课', '谁', '调', '谈', '谊', '谋', '谓', '谜', '谢', '谣',
            '谦', '谨', '谱', '谴', '谷', '豪', '贝', '贞', '负', '贡',
            '财', '责', '贤', '败', '货', '质', '贩', '贪', '贫', '贬',
            '购', '贮', '贯', '贰', '贱', '贴', '贵', '贷', '贸', '费',
            '贺', '贼', '贾', '贿', '赁', '赂', '赃', '资', '赅', '赈',
            '赊', '赋', '赌', '赎', '赏', '赐', '赔', '赖', '赘', '赚',
            '赛', '赞', '赠', '赢', '赣', '赵', '趋', '趸', '跃', '跄',
            '践', '跷', '跸', '跹', '跻', '踊', '踌', '踪', '蹄', '蹈',
            '蹋', '蹒', '蹿', '躏', '躯', '车', '轧', '轨', '轩', '转',
            '轮', '软', '轰', '轲', '轴', '轻', '载', '轿', '较', '辅',
            '辆', '辈', '辉', '辊', '辍', '辐', '辑', '输', '辕', '辖',
            '辗', '辘', '辙', '辞', '辟', '辣', '边', '辽', '达', '迁',
            '过', '迈', '运', '近', '返', '还', '这', '进', '远', '违',
            '连', '迟', '迩', '迫', '迭', '述', '迳', '迹', '追', '退',
            '送', '适', '逃', '逆', '选', '逊', '递', '逐', '途', '逗',
            '通', '逛', '逝', '逞', '速', '造', '逢', '逮', '逯', '逵',
            '逸', '逻', '遂', '遇', '遍', '遏', '道', '遗', '遣', '遥',
            '遨', '遭', '遮', '遴', '遵', '避', '邀', '邓', '邝', '邬',
            '邮', '邹', '邻', '郁', '郑', '郧', '郸', '酝', '酱', '酿',
            '释', '里', '重', '量', '钅', '钆', '钇', '针', '钉', '钊',
            '钋', '钌', '钍', '钎', '钏', '钐', '钒', '钓', '钔', '钕',
            '钖', '钗', '钘', '钙', '钚', '钛', '钜', '钝', '钞', '钟',
            '钠', '钡', '钢', '钣', '钤', '钥', '钦', '钧', '钨', '钩',
            '钪', '钫', '钬', '钭', '钮', '钯', '钰', '钱', '钲', '钳',
            '钴', '钵', '钶', '钷', '钸', '钹', '钺', '钻', '钼', '钽',
            '钾', '钿', '铀', '铁', '铂', '铃', '铄', '铅', '铆', '铇',
            '铈', '铉', '铊', '铋', '铌', '铍', '铎', '铏', '铐', '铑',
            '铒', '铓', '铔', '铕', '铖', '铗', '铘', '铙', '铚', '铛',
            '铜', '铝', '铞', '铟', '铠', '铡', '铢', '铣', '铤', '铥',
            '铦', '铧', '铨', '铩', '铪', '铫', '铬', '铭', '铮', '铯',
            '铰', '铱', '铲', '铳', '铴', '铵', '银', '铷', '铸', '铹',
            '铺', '铻', '铼', '铽', '链', '铿', '销', '锁', '锂', '锃',
            '锄', '锅', '锆', '锇', '锈', '锉', '锊', '锋', '锌', '锍',
            '锎', '锏', '锐', '锑', '锒', '锓', '锔', '锕', '锖', '锗',
            '锘', '错', '锚', '锛', '锜', '锝', '锞', '锟', '锠', '锡',
            '锢', '锣', '锤', '锥', '锦', '锧', '锨', '锩', '锪', '锫',
            '锬', '锭', '键', '锯', '锰', '锱', '锲', '锳', '锴', '锵',
            '锶', '锷', '锸', '锹', '锺', '锻', '锼', '锽', '锾', '锿',
            '镀', '镁', '镂', '镃', '镄', '镅', '镆', '镇', '镈', '镉',
            '镊', '镋', '镌', '镍', '镎', '镏', '镐', '镑', '镒', '镓',
            '镔', '镕', '镖', '镗', '镘', '镙', '镚', '镛', '镜', '镝',
            '镞', '镟', '镠', '镡', '镢', '镣', '镤', '镥', '镦', '镧',
            '镨', '镩', '镪', '镫', '镬', '镭', '镮', '镯', '镰', '镱',
            '镲', '镳', '镴', '镵', '镶', '长', '门', '闩', '闪', '闫',
            '闭', '问', '闯', '闰', '闱', '闲', '闳', '间', '闵', '闶',
            '闷', '闸', '闹', '闺', '闻', '闼', '闽', '闾', '闿', '阀',
            '阁', '阂', '阃', '阄', '阅', '阆', '阇', '阈', '阉', '阊',
            '阋', '阌', '阍', '阎', '阏', '阐', '阑', '阒', '阓', '阔',
            '阕', '阖', '阗', '阘', '阙', '阚', '阛', '队', '阳', '阴',
            '阵', '阶', '际', '陆', '陇', '陈', '陉', '陕', '陧', '险',
            '随', '隐', '隶', '隽', '难', '雏', '雠', '雳', '雾', '霁',
            '霉', '霭', '靓', '静', '靥', '鞑', '鞒', '鞯', '韦', '韧',
            '韩', '韪', '韫', '韬', '韵', '页', '顶', '顷', '顸', '项',
            '顺', '须', '顼', '顽', '顾', '顿', '颀', '颁', '颂', '颃',
            '预', '颅', '领', '颇', '颈', '颉', '颊', '颋', '颌', '颍',
            '颎', '颏', '颐', '频', '颒', '颓', '颔', '颕', '颖', '颗',
            '题', '颙', '颚', '颛', '颜', '额', '颞', '颟', '颠', '颡',
            '颢', '颣', '颤', '颥', '颦', '颧', '风', '飏', '飐', '飑',
            '飒', '飓', '飔', '飕', '飖', '飗', '飘', '飙', '飚', '飞',
            '飨', '餍', '饥', '饧', '饨', '饩', '饪', '饫', '饬', '饭',
            '饮', '饯', '饰', '饱', '饲', '饳', '饴', '饵', '饶', '饷',
            '饸', '饹', '饺', '饻', '饼', '饽', '饾', '饿', '馀', '馁',
            '馂', '馃', '馄', '馅', '馆', '馇', '馈', '馉', '馊', '馋',
            '馌', '馍', '馎', '馏', '馐', '馑', '馒', '馓', '馔', '馕',
            '马', '驭', '驮', '驯', '驰', '驱', '驲', '驳', '驴', '驵',
            '驶', '驷', '驸', '驹', '驺', '驻', '驼', '驽', '驾', '驿',
            '骀', '骁', '骂', '骃', '骄', '骅', '骆', '骇', '骈', '骉',
            '骊', '骋', '验', '骍', '骎', '骏', '骐', '骑', '骒', '骓',
            '骔', '骕', '骖', '骗', '骘', '骙', '骚', '骛', '骜', '骝',
            '骞', '骟', '骠', '骡', '骢', '骣', '骤', '骥', '骦', '骧',
            '骨', '髅', '髋', '髌', '鬓', '魇', '魉', '鱼', '鱽', '鱾',
            '鱿', '鲀', '鲁', '鲂', '鲃', '鲄', '鲅', '鲆', '鲇', '鲈',
            '鲉', '鲊', '鲋', '鲌', '鲍', '鲎', '鲏', '鲐', '鲑', '鲒',
            '鲓', '鲔', '鲕', '鲖', '鲗', '鲘', '鲙', '鲚', '鲛', '鲜',
            '鲝', '鲞', '鲟', '鲠', '鲡', '鲢', '鲣', '鲤', '鲥', '鲦',
            '鲧', '鲨', '鲩', '鲪', '鲫', '鲬', '鲭', '鲮', '鲯', '鲰',
            '鲱', '鲲', '鲳', '鲴', '鲵', '鲶', '鲷', '鲸', '鲹', '鲺',
            '鲻', '鲼', '鲽', '鲾', '鲿', '鳀', '鳁', '鳂', '鳃', '鳄',
            '鳅', '鳆', '鳇', '鳈', '鳉', '鳊', '鳋', '鳌', '鳍', '鳎',
            '鳏', '鳐', '鳑', '鳒', '鳓', '鳔', '鳕', '鳖', '鳗', '鳘',
            '鳙', '鳚', '鳛', '鳜', '鳝', '鳞', '鳟', '鳠', '鳡', '鳢',
            '鳣', '鸟', '鸠', '鸡', '鸢', '鸣', '鸤', '鸥', '鸦', '鸧',
            '鸨', '鸩', '鸪', '鸫', '鸬', '鸭', '鸮', '鸯', '鸰', '鸱',
            '鸲', '鸳', '鸴', '鸵', '鸶', '鸷', '鸸', '鸹', '鸺', '鸻',
            '鸼', '鸽', '鸾', '鸿', '鹀', '鹁', '鹂', '鹃', '鹄', '鹅',
            '鹆', '鹇', '鹈', '鹉', '鹊', '鹋', '鹌', '鹍', '鹎', '鹏',
            '鹐', '鹑', '鹒', '鹓', '鹔', '鹕', '鹖', '鹗', '鹘', '鹙',
            '鹚', '鹛', '鹜', '鹝', '鹞', '鹟', '鹠', '鹡', '鹢', '鹣',
            '鹤', '鹥', '鹦', '鹧', '鹨', '鹩', '鹪', '鹫', '鹬', '鹭',
            '鹮', '鹯', '鹰', '鹱', '鹲', '鹳', '鹴', '鹾', '麦', '麸',
            '黄', '黉', '黩', '黪', '黾', '鼋', '鼍', '鼹', '齐', '齑',
            '齿', '龀', '龁', '龂', '龃', '龄', '龅', '龆', '龇', '龈',
            '龉', '龊', '龋', '龌', '龙', '龚', '龛', '龟',
        ];
        
        SIMPLIFIED_CHARS.contains(&ch)
    }

    
    /// 检查字符是否为繁体中文特有字符
    /// 
    /// 这里使用一些常见的繁体字作为判断依据
    fn is_traditional_char(&self, ch: char) -> bool {
        // 常见繁体字（与简体不同的字）
        const TRADITIONAL_CHARS: &[char] = &[
            '國', '為', '這', '個', '們', '來', '時', '會', '對', '發',
            '學', '經', '說', '過', '動', '問', '關', '點', '長', '頭',
            '裡', '後', '開', '實', '現', '進', '種', '東', '機', '電',
            '車', '書', '見', '門', '馬', '魚', '鳥', '龍', '風', '飛',
            '語', '話', '認', '識', '讓', '請', '誰', '讀', '寫', '聽',
            '買', '賣', '貝', '錢', '銀', '鐵', '鋼', '銅', '鎖', '鏡',
            '醫', '藥', '病', '痛', '療', '癥', '瘋', '疲', '疑', '痕',
            '廠', '廣', '產', '業', '農', '漁', '礦', '廳', '廚', '廁',
            '辦', '勞', '動', '務', '勢', '勵', '勤', '勇', '勳', '勒',
            '華', '單', '衛', '歷', '壓', '厲', '縣', '參', '雙', '變',
            '葉', '號', '臺', '吃', '嗎', '吧', '聽', '呢', '響', '哪',
            '園', '圖', '團', '圍', '圓', '聖', '場', '壞', '塊', '堅',
            '報', '場', '聲', '殼', '處', '備', '復', '誇', '頭', '夾',
            '奮', '獎', '奧', '婦', '媽', '姐', '娘', '嬰', '嫁', '孫',
            '學', '寧', '寶', '實', '寵', '審', '憲', '宮', '家', '賓',
            '對', '導', '尋', '將', '爾', '塵', '嘗', '盡', '層', '屬',
            '歲', '島', '嶺', '岸', '幣', '師', '帥', '帶', '幫', '帳',
            '幹', '並', '廣', '莊', '慶', '庫', '應', '廟', '廢', '開',
            '異', '棄', '張', '彈', '強', '歸', '當', '錄', '彥', '徹',
            '徑', '從', '禦', '復', '德', '憶', '憂', '懷', '態', '總',
            '惡', '懸', '驚', '慣', '慘', '願', '懾', '戲', '戰', '戶',
            '執', '擴', '掃', '揚', '擾', '撫', '搶', '護', '報', '擔',
            '擬', '擁', '擇', '掛', '擋', '擠', '揮', '損', '換', '據',
            '擲', '搜', '攝', '擺', '搖', '撐', '撤', '擦', '攢', '敵',
            '數', '齋', '鬥', '斬', '斷', '無', '舊', '時', '晝', '顯',
            '晉', '曬', '曉', '暈', '暫', '術', '機', '殺', '雜', '權',
            '條', '來', '楊', '極', '構', '槍', '櫃', '標', '棟', '樣',
            '橋', '檔', '夢', '檢', '棱', '橢', '樓', '欖', '槽', '櫥',
            '歡', '歐', '殲', '毆', '毀', '畢', '斃', '氣', '氫', '匯',
            '漢', '污', '湯', '溝', '沒', '滬', '沿', '淚', '潑', '潔',
            '淺', '測', '濟', '渾', '濃', '塗', '濤', '渦', '漲', '澱',
            '淵', '漸', '漁', '溫', '灣', '潰', '滾', '滯', '濱', '灘',
            '滿', '漏', '潛', '瀾', '滅', '燈', '靈', '竈', '災', '爐',
            '煉', '爛', '燭', '煙', '煩', '燒', '熱', '煥', '焰', '煤',
            '熟', '燃', '愛', '爺', '牽', '猶', '狹', '獅', '獨', '獄',
            '獵', '豬', '獻', '瑪', '環', '現', '玻', '瓏', '珠', '瑣',
            '瑤', '璃', '瓶', '甚', '電', '畫', '暢', '療', '瘋', '疲',
            '疼', '癢', '癡', '瘦', '癬', '皺', '盞', '鹽', '監', '蓋',
            '盤', '瞇', '睜', '睞', '睦', '瞞', '矯', '礦', '碼', '磚',
            '礎', '碩', '確', '礙', '碰', '磁', '禮', '祝', '禍', '稟',
            '離', '禿', '稈', '積', '稱', '稅', '穩', '窮', '竊', '竅',
            '竄', '窩', '窺', '豎', '競', '筆', '籠', '築', '篩', '籌',
            '簽', '簡', '籮', '籃', '籬', '類', '糧', '糞', '糊', '糾',
            '紅', '纖', '約', '級', '紀', '緯', '純', '紗', '綱', '納',
            '縱', '紛', '紙', '紋', '紡', '紐', '線', '練', '組', '細',
            '織', '終', '紹', '經', '結', '繞', '繪', '給', '絡', '絕',
            '統', '繡', '繼', '績', '緒', '續', '繩', '維', '綿', '綜',
            '綠', '綴', '緩', '編', '緣', '縛', '縫', '纏', '縮', '繳',
            '缸', '罐', '網', '羅', '罰', '罷', '罩', '羈', '翹', '聳',
            '聶', '職', '聯', '聰', '肅', '腸', '膚', '腫', '脹', '脅',
            '膽', '勝', '朧', '膠', '脈', '臟', '腦', '脫', '臉', '臘',
            '膩', '騰', '膜', '輿', '艦', '艙', '艱', '艷', '藝', '節',
            '蕪', '蘆', '葦', '蒼', '蘇', '蘋', '莖', '荊', '薦', '蕩',
            '榮', '藥', '蒞', '萊', '蓮', '獲', '蘿', '營', '蕭', '薩',
            '蔥', '蔣', '蒙', '藍', '蔑', '薔', '藹', '蘊', '薪', '藏',
            '虜', '慮', '虛', '蟲', '蝕', '蟻', '螞', '蛋', '蠻', '蠟',
            '蠅', '蟬', '蝴', '螺', '蟹', '釁', '補', '襯', '襖', '襪',
            '襲', '裝', '褲', '褂', '襤', '覽', '覺', '觀', '規', '覓',
            '視', '覽', '覺', '觸', '譽', '計', '訂', '認', '討', '讓',
            '訊', '記', '講', '諱', '許', '論', '訟', '設', '訪', '證',
            '評', '識', '詐', '訴', '詞', '譯', '試', '詩', '誠', '話',
            '誕', '詢', '詳', '語', '誤', '說', '請', '諸', '諾', '讀',
            '課', '誰', '調', '談', '誼', '謀', '謂', '謎', '謝', '謠',
            '謙', '謹', '譜', '譴', '谷', '豪', '貝', '貞', '負', '貢',
            '財', '責', '賢', '敗', '貨', '質', '販', '貪', '貧', '貶',
            '購', '貯', '貫', '貳', '賤', '貼', '貴', '貸', '貿', '費',
            '賀', '賊', '賈', '賄', '賃', '賂', '贓', '資', '賅', '賑',
            '賒', '賦', '賭', '贖', '賞', '賜', '賠', '賴', '贅', '賺',
            '賽', '贊', '贈', '贏', '贛', '趙', '趨', '躉', '躍', '蹌',
            '踐', '蹺', '蹕', '躚', '躋', '踴', '躊', '蹤', '蹄', '蹈',
            '蹋', '蹣', '躥', '躪', '軀', '車', '軋', '軌', '軒', '轉',
            '輪', '軟', '轟', '軻', '軸', '輕', '載', '轎', '較', '輔',
            '輛', '輩', '輝', '輥', '輟', '輻', '輯', '輸', '轅', '轄',
            '輾', '轆', '轍', '辭', '闢', '辣', '邊', '遼', '達', '遷',
            '過', '邁', '運', '近', '返', '還', '這', '進', '遠', '違',
            '連', '遲', '邇', '迫', '迭', '述', '逕', '跡', '追', '退',
            '送', '適', '逃', '逆', '選', '遜', '遞', '逐', '途', '逗',
            '通', '逛', '逝', '逞', '速', '造', '逢', '逮', '逯', '逵',
            '逸', '邏', '遂', '遇', '遍', '遏', '道', '遺', '遣', '遙',
            '遨', '遭', '遮', '遴', '遵', '避', '邀', '鄧', '鄺', '鄔',
            '郵', '鄒', '鄰', '鬱', '鄭', '鄖', '鄲', '醞', '醬', '釀',
            '釋', '裏', '重', '量', '釒', '釓', '釔', '針', '釘', '釗',
            '釙', '釕', '釷', '釺', '釧', '釤', '釩', '釣', '鍆', '釹',
            '錫', '釵', '釻', '鈣', '鈈', '鈦', '鉅', '鈍', '鈔', '鐘',
            '鈉', '鋇', '鋼', '鈑', '鈐', '鑰', '欽', '鈞', '鎢', '鉤',
            '鈧', '鈁', '鈥', '鈄', '鈕', '鈀', '鈺', '錢', '鉦', '鉗',
            '鈷', '缽', '鈳', '鉕', '鈽', '鈸', '鉞', '鑽', '鉬', '鉭',
            '鉀', '鈿', '鈾', '鐵', '鉑', '鈴', '鑠', '鉛', '鉚', '鉋',
            '鈰', '鉉', '鉈', '鉍', '鈮', '鈹', '鐸', '鉶', '銬', '銠',
            '鉺', '鋩', '銨', '銪', '銖', '鋏', '銘', '鋙', '銛', '鐺',
            '銅', '鋁', '銇', '銦', '鎧', '鍘', '銖', '銑', '鋌', '銩',
            '銪', '鏵', '銓', '鎩', '鉿', '銚', '鉻', '銘', '錚', '銫',
            '鉸', '銥', '鏟', '銃', '鋃', '銨', '銀', '銣', '鑄', '鐒',
            '鋪', '鋙', '錸', '鋱', '鏈', '鏗', '銷', '鎖', '鋰', '鋥',
            '鋤', '鍋', '鋯', '鋨', '銹', '銼', '鋝', '鋒', '鋅', '鋶',
            '鐦', '鐧', '銳', '銻', '鋃', '鋟', '鋦', '錒', '鋜', '鍺',
            '鍩', '錯', '錨', '錛', '錡', '鍀', '錁', '錕', '錩', '錫',
            '錮', '鑼', '錘', '錐', '錦', '鍤', '鍁', '錈', '鍃', '鍇',
            '鍈', '錠', '鍵', '鋸', '錳', '錙', '鍥', '鍇', '鍇', '鏘',
            '鍶', '鍔', '鍤', '鍬', '鍾', '鍛', '鍠', '鍰', '鎄',
            '鍍', '鎂', '鏤', '鎡', '鐨', '鎇', '鎆', '鎮', '鎛', '鎘',
            '鑷', '鎋', '鐫', '鎳', '鎿', '鎦', '鎬', '鎊', '鎰', '鎵',
            '鑌', '鎔', '鏢', '鏜', '鏝', '鏍', '鏰', '鏞', '鏡', '鏑',
            '鏃', '鏇', '鏐', '鐔', '鐝', '鐐', '鐠', '鑥', '鐓', '鑭',
            '鐠', '鑹', '鏹', '鐙', '鑊', '鐳', '鐶', '鐲', '鐮', '鐿',
            '鑔', '鑣', '鑞', '鑱', '鑲', '長', '門', '閂', '閃', '閆',
            '閉', '問', '闖', '閏', '闈', '閑', '閎', '間', '閔', '閌',
            '悶', '閘', '鬧', '閨', '聞', '闥', '閩', '閭', '闓', '閥',
            '閣', '閡', '閫', '鬮', '閱', '閬', '闍', '閾', '閹', '閶',
            '鬩', '閿', '閽', '閻', '閼', '闡', '闌', '闃', '闠', '闊',
            '闋', '闔', '闐', '闘', '闕', '闞', '闤', '隊', '陽', '陰',
            '陣', '階', '際', '陸', '隴', '陳', '陘', '陝', '隉', '險',
            '隨', '隱', '隸', '雋', '難', '雛', '讎', '靂', '霧', '霽',
            '黴', '靄', '靚', '靜', '靨', '韃', '鞽', '韉', '韋', '韌',
            '韓', '韙', '韞', '韜', '韻', '頁', '頂', '頃', '頇', '項',
            '順', '須', '頊', '頑', '顧', '頓', '頎', '頒', '頌', '頏',
            '預', '顱', '領', '頗', '頸', '頡', '頰', '頲', '頜', '潁',
            '頎', '頦', '頤', '頻', '頮', '頹', '頷', '頴', '穎', '顆',
            '題', '顒', '顎', '顓', '顏', '額', '顳', '顢', '顛', '顙',
            '顥', '纇', '顫', '顬', '顰', '顴', '風', '颺', '颭', '颮',
            '颯', '颶', '颸', '颼', '颻', '颾', '飄', '飆', '飈', '飛',
            '饗', '饜', '飢', '餳', '飩', '餼', '飪', '飫', '飭', '飯',
            '飲', '餞', '飾', '飽', '飼', '飿', '飴', '餌', '饒', '餉',
            '餄', '餎', '餃', '餑', '餖', '餓', '餘', '餒', '餕', '餜',
            '餛', '餡', '館', '餷', '饋', '餶', '餿', '饞', '饁', '饃',
            '饇', '餾', '饈', '饉', '饅', '饊', '饌', '饢', '馬', '馭',
            '馱', '馴', '馳', '驅', '馹', '駁', '驢', '駔', '駛', '駟',
            '駙', '駒', '駑', '駐', '駝', '駑', '駕', '驛', '駘', '驍',
            '駡', '駪', '驕', '驊', '駱', '駭', '駢', '驫', '驪', '騁',
            '驗', '騂', '騎', '駿', '騏', '騎', '騍', '騅', '騙', '騤',
            '騷', '騖', '騮', '騫', '騸', '驃', '騾', '驄', '驂', '驤',
            '驥', '驦', '驤', '骨', '髏', '髖', '髕', '鬢', '魘', '魎',
            '魚', '魽', '魾', '魿', '鮀', '魯', '魴', '鮃', '鮄', '鮅',
            '鮆', '鮇', '鮈', '鮊', '鮋', '鮌', '鮑', '鮎', '鮏', '鮐',
            '鮭', '鮒', '鮓', '鮔', '鮕', '鮖', '鮗', '鮘', '鮙', '鮚',
            '鮛', '鮮', '鮝', '鮞', '鮟', '鯁', '鰻', '鰱', '鰹', '鯉',
            '鰣', '鰷', '鯀', '鯊', '鯇', '鯪', '鯫', '鯬', '鯭', '鯮',
            '鯰', '鯱', '鯲', '鯳', '鯴', '鯵', '鯶', '鯷', '鯸', '鯹',
            '鯺', '鯻', '鯼', '鯽', '鯾', '鯿', '鰀', '鰁', '鰂', '鰃',
            '鰄', '鰅', '鰆', '鰇', '鰈', '鰉', '鰊', '鰋', '鰌', '鰍',
            '鰎', '鰏', '鰐', '鰑', '鰒', '鰓', '鰔', '鰕', '鰖', '鰗',
            '鰘', '鰙', '鰚', '鰛', '鰜', '鰝', '鰞', '鰟', '鰠', '鰡',
            '鰢', '鰣', '鳥', '鳩', '雞', '鳶', '鳴', '鳤', '鷗', '鴉',
            '鴇', '鴆', '鴣', '鶇', '鸕', '鴨', '鴞', '鴦', '鴒', '鴟',
            '鴝', '鴛', '鴴', '鴕', '鷥', '鷙', '鴯', '鴰', '鵂', '鴴',
            '鴼', '鴿', '鸞', '鴻', '鵐', '鵓', '鸝', '鵑', '鵠', '鵝',
            '鵒', '鷴', '鵜', '鵡', '鵲', '鶓', '鵪', '鵬', '鵮', '鶉',
            '鶊', '鶓', '鶔', '鶘', '鶖', '鶚', '鶻', '鶿', '鷀', '鶥',
            '鶩', '鶯', '鷂', '鶲', '鷁', '鷊', '鷓', '鶴', '鷖', '鸚',
            '鷓', '鷚', '鷯', '鷦', '鷲', '鷸', '鷺', '鸛', '鸌', '鷹',
            '鸊', '鸇', '鸛', '鸘', '鹺', '麥', '麩', '黃', '黌', '黷',
            '黲', '黽', '黿', '鼉', '鼴', '齊', '齏', '齒', '齔', '齕',
            '齗', '齟', '齡', '齙', '齠', '齜', '齦', '齬', '齪', '齲',
            '齷', '龍', '龔', '龕', '龜',
        ];
        
        TRADITIONAL_CHARS.contains(&ch)
    }
}

impl Default for LanguageDetector {
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
    fn test_detect_english() {
        let detector = LanguageDetector::new();
        let result = detector.detect("Hello, this is a test message in English.");
        
        assert_eq!(result.language, "en");
        assert!(result.confidence > 0.5);
        assert!(result.is_simplified.is_none());
    }
    
    #[test]
    fn test_detect_simplified_chinese() {
        let detector = LanguageDetector::new();
        let result = detector.detect("这是一段简体中文测试文本，用于测试语言检测功能。");
        
        assert_eq!(result.language, "zh");
        assert!(result.confidence > 0.5);
        assert_eq!(result.is_simplified, Some(true));
    }
    
    #[test]
    fn test_detect_traditional_chinese() {
        let detector = LanguageDetector::new();
        let result = detector.detect("這是一段繁體中文測試文本，用於測試語言檢測功能。");
        
        assert_eq!(result.language, "zh");
        assert!(result.confidence > 0.5);
        assert_eq!(result.is_simplified, Some(false));
    }
    
    #[test]
    fn test_detect_japanese() {
        let detector = LanguageDetector::new();
        let result = detector.detect("これは日本語のテストメッセージです。");
        
        assert_eq!(result.language, "ja");
        assert!(result.confidence > 0.5);
        assert!(result.is_simplified.is_none());
    }
    
    #[test]
    fn test_detect_korean() {
        let detector = LanguageDetector::new();
        let result = detector.detect("이것은 한국어 테스트 메시지입니다.");
        
        assert_eq!(result.language, "ko");
        assert!(result.confidence > 0.5);
        assert!(result.is_simplified.is_none());
    }
    
    #[test]
    fn test_detect_empty_text() {
        let detector = LanguageDetector::new();
        let result = detector.detect("");
        
        assert_eq!(result.language, "und");
        assert_eq!(result.confidence, 0.0);
    }
    
    #[test]
    fn test_detect_whitespace_only() {
        let detector = LanguageDetector::new();
        let result = detector.detect("   \n\t  ");
        
        assert_eq!(result.language, "und");
        assert_eq!(result.confidence, 0.0);
    }
    
    #[test]
    fn test_detect_french() {
        let detector = LanguageDetector::new();
        let result = detector.detect("Bonjour, ceci est un message de test en français.");
        
        assert_eq!(result.language, "fr");
        assert!(result.confidence > 0.5);
    }
    
    #[test]
    fn test_detect_german() {
        let detector = LanguageDetector::new();
        let result = detector.detect("Hallo, dies ist eine Testnachricht auf Deutsch.");
        
        assert_eq!(result.language, "de");
        assert!(result.confidence > 0.5);
    }
    
    #[test]
    fn test_detect_spanish() {
        let detector = LanguageDetector::new();
        let result = detector.detect("Hola, este es un mensaje de prueba en español.");
        
        assert_eq!(result.language, "es");
        assert!(result.confidence > 0.5);
    }
    
    #[test]
    fn test_language_detection_result_serialization() {
        let result = LanguageDetectionResult::new("en", 0.95);
        let json = serde_json::to_string(&result).unwrap();
        
        assert!(json.contains("\"language\":\"en\""));
        assert!(json.contains("\"confidence\":0.95"));
        // is_simplified 为 None 时不应该出现在 JSON 中
        assert!(!json.contains("is_simplified"));
    }
    
    #[test]
    fn test_chinese_result_serialization() {
        let result = LanguageDetectionResult::chinese(0.9, true);
        let json = serde_json::to_string(&result).unwrap();
        
        assert!(json.contains("\"language\":\"zh\""));
        assert!(json.contains("\"is_simplified\":true"));
    }

    // 简繁中文区分的详细测试
    #[test]
    fn test_is_simplified_chinese_detailed() {
        let detector = LanguageDetector::new();
        
        // 纯简体中文
        let simplified_texts = [
            "这是简体中文",
            "国家发展经济",
            "学习语言很重要",
            "电脑和手机",
            "开门见山",
            "时间就是金钱",
            "我们的国家很强大",
            "请问这个怎么办",
            "软件开发工程师",
            "数据库管理系统",
        ];
        
        for text in simplified_texts {
            let result = detector.detect(text);
            assert_eq!(result.language, "zh", "Text: {}", text);
            assert_eq!(result.is_simplified, Some(true), "Expected simplified for: {}", text);
        }
    }
    
    #[test]
    fn test_is_traditional_chinese_detailed() {
        let detector = LanguageDetector::new();
        
        // 纯繁体中文
        let traditional_texts = [
            "這是繁體中文",
            "國家發展經濟",
            "學習語言很重要",
            "電腦和手機",
            "開門見山",
            "時間就是金錢",
            "我們的國家很強大",
            "請問這個怎麼辦",
            "軟體開發工程師",
            "資料庫管理系統",
        ];
        
        for text in traditional_texts {
            let result = detector.detect(text);
            assert_eq!(result.language, "zh", "Text: {}", text);
            assert_eq!(result.is_simplified, Some(false), "Expected traditional for: {}", text);
        }
    }
    
    #[test]
    fn test_mixed_chinese_text() {
        let detector = LanguageDetector::new();
        
        // 简体字多于繁体字 -> 简体
        let mostly_simplified = "这是一段测试文本，包含國两个繁体字";
        let result = detector.detect(mostly_simplified);
        assert_eq!(result.language, "zh");
        assert_eq!(result.is_simplified, Some(true), "简体字应该多于繁体字");
        
        // 繁体字多于简体字 -> 繁体
        // 這(繁) 是 一 段 測(繁) 試(繁) 文 本 國(繁) 家(繁) 發(繁) 展(繁) 經(繁) 濟(繁)
        let mostly_traditional = "這是一段測試文本，國家發展經濟";
        let result = detector.detect(mostly_traditional);
        assert_eq!(result.language, "zh");
        assert_eq!(result.is_simplified, Some(false), "繁体字应该多于简体字");
    }
    
    #[test]
    fn test_common_chinese_words() {
        let detector = LanguageDetector::new();
        
        // 常见简体词汇
        assert!(detector.is_simplified_chinese("计算机科学与技术"));
        assert!(detector.is_simplified_chinese("软件开发"));
        assert!(detector.is_simplified_chinese("机器学习"));
        
        // 常见繁体词汇
        assert!(!detector.is_simplified_chinese("計算機科學與技術"));
        assert!(!detector.is_simplified_chinese("軟體開發"));
        assert!(!detector.is_simplified_chinese("機器學習"));
    }
    
    #[test]
    fn test_chinese_punctuation_only() {
        let detector = LanguageDetector::new();
        
        // 只有标点符号，没有简繁体特征字
        // 应该返回 true (简体字数 >= 繁体字数，都是 0)
        let result = detector.is_simplified_chinese("，。！？");
        assert!(result);
    }
    
    #[test]
    fn test_chinese_with_numbers() {
        let detector = LanguageDetector::new();
        
        // 包含数字的简体中文
        let result = detector.detect("2024年1月1日，这是新的一年");
        assert_eq!(result.language, "zh");
        assert_eq!(result.is_simplified, Some(true));
        
        // 包含数字的繁体中文
        let result = detector.detect("2024年1月1日，這是新的一年");
        assert_eq!(result.language, "zh");
        assert_eq!(result.is_simplified, Some(false));
    }

    #[test]
    fn test_chinese_mixed_with_english() {
        let detector = LanguageDetector::new();
        
        // 中文混合英文技术术语 - 这是导致误判为德语的典型场景
        let mixed_texts = [
            "实时流式转录集成Rust 端已经实现了 QwenRealtimeEngine 和 DoubaoRealtimeEngine",
            "但 server.rs 目前只使用 HTTP 模式。需要集成实时模式以实现边说边显示的效果。",
            "使用 TypeScript 和 React 开发前端界面",
            "Tauri 2.0 框架支持跨平台桌面应用开发",
            "WebSocket 连接管理和消息路由",
            "ASR 语音识别引擎配置",
            "LLM 大语言模型 API 调用",
        ];
        
        for text in mixed_texts {
            let result = detector.detect(text);
            assert_eq!(result.language, "zh", "应该检测为中文，而不是其他语言: {}", text);
            assert_eq!(result.is_simplified, Some(true), "应该是简体中文: {}", text);
        }
    }
    
    #[test]
    fn test_cjk_pre_detection() {
        let detector = LanguageDetector::new();
        
        // 测试 CJK 预检测功能
        
        // 纯英文 - 应该返回 None，让 whatlang 处理
        let english_result = detector.pre_detect_cjk("Hello, this is a test.");
        assert!(english_result.is_none());
        
        // 中文混合英文 - 应该检测为中文
        let mixed_result = detector.pre_detect_cjk("这是一个 Test 测试");
        assert!(mixed_result.is_some());
        let result = mixed_result.unwrap();
        assert_eq!(result.language, "zh");
        
        // 日文 - 应该检测为日文
        let japanese_result = detector.pre_detect_cjk("これはテストです");
        assert!(japanese_result.is_some());
        let result = japanese_result.unwrap();
        assert_eq!(result.language, "ja");
        
        // 韩文 - 应该检测为韩文
        let korean_result = detector.pre_detect_cjk("이것은 테스트입니다");
        assert!(korean_result.is_some());
        let result = korean_result.unwrap();
        assert_eq!(result.language, "ko");
    }
}