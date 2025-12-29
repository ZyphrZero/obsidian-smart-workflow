import { TFile, TFolder } from 'obsidian';
import { debugLog } from '../../utils/logger';

/**
 * 命名分析结果接口
 */
interface NamingAnalysis {
  avgLength: number;           // 平均长度
  hasDatePattern: boolean;     // 是否有日期模式
  hasNumberPrefix: boolean;    // 是否有数字前缀
  language: 'chinese' | 'english' | 'mixed';  // 主要语言
  separator: string | null;    // 分隔符
  caseStyle: string | null;    // 大小写风格
}

/**
 * 文件分析器类
 * 分析目录下其他文件的命名风格
 */
export class FileAnalyzer {
  /**
   * 分析目录下文件的命名风格
   * @param currentFile 当前文件
   * @param debugMode 是否启用调试模式
   * @param maxSamples 最大采样数量（默认10个）
   * @returns 命名风格描述
   */
  analyzeDirectoryNamingStyle(currentFile: TFile, debugMode = false, maxSamples = 10): string {
    const directory = currentFile.parent;

    if (!directory) {
      if (debugMode) {
        debugLog('[FileAnalyzer] 当前文件没有父目录');
      }
      return '';
    }

    if (debugMode) {
      debugLog(`[FileAnalyzer] 正在分析目录: ${directory.path}`);
    }

    // 获取同目录下的其他 Markdown 文件
    const siblingFiles = this.getSiblingFiles(currentFile, directory);

    if (debugMode) {
      debugLog(`[FileAnalyzer] 找到 ${siblingFiles.length} 个同目录文件`);
    }

    if (siblingFiles.length === 0) {
      if (debugMode) {
        debugLog('[FileAnalyzer] 目录下没有其他文件，跳过分析');
      }
      return '';
    }

    // 采样文件名（限制数量以提高性能）
    const samples = siblingFiles.slice(0, maxSamples);
    const fileNames = samples.map((file: TFile) => file.basename);

    if (debugMode) {
      debugLog(`[FileAnalyzer] 采样文件名:`, fileNames);
    }

    // 分析命名模式
    const analysis = this.analyzeNamingPatterns(fileNames);

    const result = this.formatAnalysisResult(analysis, fileNames);

    if (debugMode) {
      debugLog(`[FileAnalyzer] 分析结果:\n${result}`);
    }

    return result;
  }

  /**
   * 获取同目录下的其他文件
   * @param currentFile 当前文件
   * @param directory 目录
   * @returns 兄弟文件列表
   */
  private getSiblingFiles(currentFile: TFile, directory: TFolder): TFile[] {
    const files: TFile[] = [];

    for (const child of directory.children) {
      if (child instanceof TFile &&
          child.extension === 'md' &&
          child.path !== currentFile.path) {
        files.push(child);
      }
    }

    return files;
  }

  /**
   * 分析命名模式
   * @param fileNames 文件名列表
   * @returns 分析结果
   */
  private analyzeNamingPatterns(fileNames: string[]): NamingAnalysis {
    const analysis: NamingAnalysis = {
      avgLength: 0,
      hasDatePattern: false,
      hasNumberPrefix: false,
      language: 'mixed',
      separator: null,
      caseStyle: null
    };

    if (fileNames.length === 0) {
      return analysis;
    }

    // 分析平均长度
    analysis.avgLength = Math.round(
      fileNames.reduce((sum, name) => sum + name.length, 0) / fileNames.length
    );

    // 检测日期模式 (YYYY-MM-DD, YYYYMMDD 等)
    const datePatterns = /\d{4}[-./]?\d{2}[-./]?\d{2}/;
    analysis.hasDatePattern = fileNames.some(name => datePatterns.test(name));

    // 检测数字前缀 (01-, 001-, 1. 等)
    const numberPrefixPattern = /^\d+[-.\s]/;
    analysis.hasNumberPrefix = fileNames.some(name => numberPrefixPattern.test(name));

    // 检测语言（简单判断中文字符占比）
    const chineseCount = fileNames.filter(name => /[\u4e00-\u9fa5]/.test(name)).length;
    const englishCount = fileNames.filter(name => /^[a-zA-Z0-9\s-_]+$/.test(name)).length;

    if (chineseCount > fileNames.length * 0.7) {
      analysis.language = 'chinese';
    } else if (englishCount > fileNames.length * 0.7) {
      analysis.language = 'english';
    }

    // 检测分隔符（-, _, 空格）
    const separators = ['-', '_', ' '];
    for (const sep of separators) {
      if (fileNames.filter(name => name.includes(sep)).length > fileNames.length * 0.5) {
        analysis.separator = sep;
        break;
      }
    }

    // 检测大小写风格（仅针对英文）
    if (analysis.language === 'english') {
      const camelCaseCount = fileNames.filter(name => /[a-z][A-Z]/.test(name)).length;
      const kebabCaseCount = fileNames.filter(name => /[a-z]-[a-z]/.test(name)).length;
      const snakeCaseCount = fileNames.filter(name => /[a-z]_[a-z]/.test(name)).length;

      if (camelCaseCount > fileNames.length * 0.5) {
        analysis.caseStyle = 'camelCase';
      } else if (kebabCaseCount > fileNames.length * 0.5) {
        analysis.caseStyle = 'kebab-case';
      } else if (snakeCaseCount > fileNames.length * 0.5) {
        analysis.caseStyle = 'snake_case';
      }
    }

    return analysis;
  }

  /**
   * 格式化分析结果为文本描述
   * @param analysis 分析结果
   * @param samples 样本文件名
   * @returns 格式化的描述文本
   */
  private formatAnalysisResult(analysis: NamingAnalysis, samples: string[]): string {
    const parts: string[] = [];

    // 添加样本示例
    parts.push(`示例文件名：${samples.slice(0, 5).join('、')}`);

    // 添加特征描述
    const features: string[] = [];

    if (analysis.hasDatePattern) {
      features.push('包含日期');
    }

    if (analysis.hasNumberPrefix) {
      features.push('使用数字编号前缀');
    }

    if (analysis.language === 'chinese') {
      features.push('主要使用中文');
    } else if (analysis.language === 'english') {
      features.push('主要使用英文');
    }

    if (analysis.separator) {
      const sepName: Record<string, string> = {
        '-': '连字符',
        '_': '下划线',
        ' ': '空格'
      };
      features.push(`使用${sepName[analysis.separator] || analysis.separator}分隔`);
    }

    if (analysis.caseStyle) {
      features.push(`${analysis.caseStyle} 风格`);
    }

    features.push(`平均长度约 ${analysis.avgLength} 字符`);

    if (features.length > 0) {
      parts.push(`命名特征：${features.join('、')}`);
    }

    return parts.join('\n');
  }
}
