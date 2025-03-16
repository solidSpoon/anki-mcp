import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from 'url';

// 定义项目路径
const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOG_DIR = path.join(PROJECT_ROOT, "logs");
const LOG_FILE = path.join(LOG_DIR, `anki-mcp-${new Date().toISOString().split('T')[0]}.log`);

// 日志级别类型
export type LogLevel = 'INFO' | 'ERROR' | 'DEBUG';

// 日志函数
export async function log(level: LogLevel, message: string, data?: any): Promise<void> {
  const timestamp = new Date().toISOString();
  let logMessage = `[${timestamp}] [${level}] ${message}\n`;
  
  // 如果有额外数据需要记录
  if (data) {
    // 如果是错误级别的日志，添加详细的错误信息
    if (level === 'ERROR') {
      // 确保错误对象被正确序列化
      const errorObj = data instanceof Error ? data : new Error(JSON.stringify(data));
      logMessage += `错误类型: ${errorObj.name}\n`;
      logMessage += `错误信息: ${errorObj.message}\n`;
      
      // 如果是对象，记录其属性
      if (typeof data === 'object' && data !== null) {
        try {
          const sanitizedError = Object.getOwnPropertyNames(data).reduce((acc, key) => {
            try {
              acc[key] = JSON.stringify(data[key]);
            } catch (err: any) {
              acc[key] = `[无法序列化: ${err.message}]`;
            }
            return acc;
          }, {} as Record<string, string>);
          
          logMessage += `错误详情:\n${JSON.stringify(sanitizedError, null, 2)}\n`;
        } catch (err: any) {
          logMessage += `错误详情序列化失败: ${err.message}\n`;
        }
      }
      
      // 记录堆栈信息
      if (errorObj.stack) {
        logMessage += `堆栈信息:\n${errorObj.stack}\n`;
      }
      
      logMessage += '---\n';
    } else {
      // 对于非错误级别的日志，只记录数据的简单字符串表示
      try {
        logMessage += `${JSON.stringify(data, null, 2)}\n`;
      } catch (err: any) {
        logMessage += `[数据序列化失败: ${err.message}]\n`;
      }
    }
  }
  
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(LOG_FILE, logMessage);
  } catch (err: any) {
    console.error(`[fs 错误] ${err.message}`);
    console.error(logMessage);
  }
} 