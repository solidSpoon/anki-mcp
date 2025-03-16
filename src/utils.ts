import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

// 格式化时间间隔
export function formatInterval(interval: number): string {
  if (interval === 0) return "新卡片";
  if (interval < 24) return `${interval}小时`;
  const days = Math.floor(interval / 24);
  if (days < 30) return `${days}天`;
  const months = Math.floor(days / 30);
  return `${months}个月`;
}

// 词汇数据类型定义
export interface WordData {
  word: string;
  definition: string;
  example?: string;
  notes?: string;
  tags?: string[];
  dateAdded: string;
}

// 词汇数据去重函数
export function deduplicateWordData(data: WordData[]): WordData[] {
  const wordMap = data.reduce((acc, curr) => {
    const key = curr.word.toLowerCase();
    if (acc[key]) {
      const existingDate = new Date(acc[key].dateAdded);
      const newDate = new Date(curr.dateAdded);
      if (newDate > existingDate) {
        acc[key] = curr;
      }
    } else {
      acc[key] = curr;
    }
    return acc;
  }, {} as Record<string, WordData>);

  return Object.values(wordMap).sort((a, b) => 
    new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime()
  );
}

// 格式化单词为文件名
export function formatWordForFilename(word: string): string {
  return word.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
}

// 获取稳定的哈希值
export function getStableHash(text: string): string {
  return crypto.createHash("md5").update(text).digest("hex").slice(0, 8);
}

// 验证单词数据
export function validateWordData(wordData: {
  word: string;
  definition: string;
  example?: string;
  notes?: string;
  tags?: string[];
}): { isValid: boolean; error?: string } {
  // 验证单词（仅允许英文字母）
  if (!/^[a-zA-Z\s\-']+$/.test(wordData.word)) {
    return { 
      isValid: false, 
      error: `Word "${wordData.word}" must contain only English letters, spaces, hyphens, or apostrophes` 
    };
  }

  // 验证定义（仅允许英文文本）
  if (!/^[a-zA-Z0-9\s.,!?;:'"()\-\[\]]*$/.test(wordData.definition)) {
    return { 
      isValid: false, 
      error: `Definition for "${wordData.word}" must be in English` 
    };
  }

  // 验证例句（如果提供）
  if (wordData.example && !/^[a-zA-Z0-9\s.,!?;:'"()\-\[\]]*$/.test(wordData.example)) {
    return { 
      isValid: false, 
      error: `Example for "${wordData.word}" must be in English` 
    };
  }

  // 验证注释（如果提供）
  if (wordData.notes && !/^[a-zA-Z0-9\s.,!?;:'"()\-\[\]]*$/.test(wordData.notes)) {
    return { 
      isValid: false, 
      error: `Notes for "${wordData.word}" must be in English` 
    };
  }

  // 验证标签（如果提供）
  if (wordData.tags) {
    for (const tag of wordData.tags) {
      if (!/^[a-zA-Z0-9\-_]+$/.test(tag)) {
        return { 
          isValid: false, 
          error: `Tag "${tag}" for word "${wordData.word}" must contain only English letters, numbers, hyphens, or underscores` 
        };
      }
    }
  }

  return { isValid: true };
}

// 延迟函数
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 分块处理数组
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
} 