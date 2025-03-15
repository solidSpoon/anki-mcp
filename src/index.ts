#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parse } from "csv-parse";
import { stringify } from "csv-stringify/sync";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import OpenAI from "openai";
import dotenv from "dotenv";
import { fileURLToPath } from 'url';

// 加载环境变量
dotenv.config();

// 验证必要的环境变量
if (!process.env.OPENAI_API_KEY) {
  console.error("错误: 未设置 OPENAI_API_KEY 环境变量");
  process.exit(1);
}

// 定义项目路径
const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const AUDIO_DIR = path.join(DATA_DIR, "audio");
const VOCAB_FILE = path.join(DATA_DIR, "vocabulary.csv");
const LOG_DIR = path.join(PROJECT_ROOT, "logs");
const LOG_FILE = path.join(LOG_DIR, `anki-mcp-${new Date().toISOString().split('T')[0]}.log`);

// 日志函数
async function log(level: 'INFO' | 'ERROR' | 'DEBUG', message: string, error?: any) {
  const timestamp = new Date().toISOString();
  let logMessage = `[${timestamp}] [${level}] ${message}\n`;
  
  // 如果是错误，添加详细信息
  if (error) {
    // 确保错误对象被正确序列化
    const errorObj = error instanceof Error ? error : new Error(JSON.stringify(error));
    logMessage += `错误类型: ${errorObj.name}\n`;
    logMessage += `错误信息: ${errorObj.message}\n`;
    
    // 如果是对象，记录其属性
    if (typeof error === 'object' && error !== null) {
      try {
        const sanitizedError = Object.getOwnPropertyNames(error).reduce((acc, key) => {
          try {
            acc[key] = JSON.stringify(error[key]);
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
  }
  
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(LOG_FILE, logMessage);
  } catch (err: any) {
    console.error('写入日志失败:', err.message);
  }
  
  // 同时输出到控制台
  if (level === 'ERROR') {
    console.error(logMessage);
  } else {
    console.log(logMessage);
  }
}

// AnkiConnect API endpoint
const ANKI_CONNECT_URL = process.env.ANKI_CONNECT_URL || "http://localhost:8765";
const ANKI_DECK_NAME = process.env.ANKI_DECK_NAME || "Vocabulary";
const ANKI_MODEL_NAME = process.env.ANKI_MODEL_NAME || "Basic";

// OpenAI 配置
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE,
});

// Create server instance
const server = new McpServer({
  name: "anki-mcp",
  version: "1.0.0",
});

// Helper function for making AnkiConnect requests
async function invokeAnkiConnect(action: string, params = {}) {
  try {
    await log('DEBUG', `调用 AnkiConnect API: ${action}`, { action, params });
    
    const requestBody = {
      action,
      version: 6,
      params,
    };
    
    await log('DEBUG', '发送请求到 AnkiConnect', { url: ANKI_CONNECT_URL, body: requestBody });
    
    const response = await fetch(ANKI_CONNECT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = new Error(`AnkiConnect request failed: ${response.statusText}`);
      (error as any).response = {
        status: response.status,
        statusText: response.statusText,
        url: response.url
      };
      throw error;
    }

    const result = await response.json();
    await log('DEBUG', '收到 AnkiConnect 响应', { result });
    
    if (result.error) {
      const error = new Error(`AnkiConnect error: ${result.error}`);
      (error as any).result = result;
      throw error;
    }

    return result.result;
  } catch (error: any) {
    await log('ERROR', `AnkiConnect 请求失败: ${action}`, {
      error,
      request: {
        action,
        params: JSON.stringify(params),
        url: ANKI_CONNECT_URL
      }
    });
    throw error;
  }
}

// Helper function to format word for filename
function formatWordForFilename(word: string): string {
  return word.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
}

// Helper function to get stable hash
function getStableHash(text: string): string {
  return crypto.createHash("md5").update(text).digest("hex").slice(0, 8);
}

// Helper function to create audio file
async function createAudioFile(text: string, word: string, audioType: string): Promise<string> {
  const formattedWord = formatWordForFilename(word);
  const stableHash = getStableHash(text);
  const audioFilename = `${formattedWord}-${audioType}-${stableHash}.mp3`;
  const audioPath = path.join(AUDIO_DIR, audioFilename);

  try {
    await fs.access(audioPath);
  } catch (e) {
    const mp3Response = await openai.audio.speech.create({
      model: "tts-1",
      voice: "alloy",
      input: text,
      response_format: "mp3",
    });

    const buffer = Buffer.from(await mp3Response.arrayBuffer());
    await fs.writeFile(audioPath, buffer);

    // 将音频文件添加到 Anki
    await invokeAnkiConnect("storeMediaFile", {
      filename: audioFilename,
      data: buffer.toString("base64"),
    });
  }

  return audioFilename;
}

// Helper function to read CSV file
async function readCsvFile(filePath: string) {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return new Promise((resolve, reject) => {
      parse(content, {
        columns: true,
        skip_empty_lines: true,
      }, (err, data) => {
        if (err) reject(err);
        else {
          // 将数据转换为以单词为键的对象
          const wordMap = (data as any[]).reduce((acc, curr) => {
            // 使用 toLowerCase 来确保不区分大小写
            const key = curr.word.toLowerCase();
            // 如果已存在该单词，比较日期，保留最新的记录
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
          }, {} as Record<string, any>);
          
          // 转换回数组形式
          resolve(Object.values(wordMap));
        }
      });
    });
  } catch (e) {
    // 如果文件不存在，返回空数组
    if ((e as any).code === 'ENOENT') {
      return [];
    }
    throw e;
  }
}

// Helper function to write CSV file
async function writeCsvFile(filePath: string, data: any[]) {
  // 确保数据是数组
  if (!Array.isArray(data)) {
    throw new Error('数据必须是数组格式');
  }
  
  // 去重处理
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
  }, {} as Record<string, any>);
  
  // 转换回数组并按添加日期排序
  const uniqueData = (Object.values(wordMap) as Array<{ dateAdded: string }>).sort((a, b) => 
    new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime()
  );
  
  const csvContent = stringify(uniqueData, { header: true });
  await fs.writeFile(filePath, csvContent);
}

// Helper function to ensure directories exist
async function ensureDirectories() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(AUDIO_DIR, { recursive: true });
  try {
    await fs.access(VOCAB_FILE);
  } catch (e) {
    await writeCsvFile(VOCAB_FILE, []);
  }
}

// Helper function to process a single word
async function processWord(wordData: {
  word: string;
  definition: string;
  example?: string;
  notes?: string;
  tags?: string[];
}) {
  const { word, definition, example = "", notes = "", tags = [] } = wordData;
  
  try {
    await log('INFO', `Processing word: ${word}`);
    
    // Generate audio files
    const wordAudio = await createAudioFile(word, word, "word");
    const definitionAudio = await createAudioFile(definition, word, "definition");
    let exampleAudio = "";
    if (example) {
      exampleAudio = await createAudioFile(example, word, "example");
    }

    // Create Anki note
    const note = {
      deckName: ANKI_DECK_NAME,
      modelName: ANKI_MODEL_NAME,
      fields: {
        Word: word,
        WordAudio: `[sound:${wordAudio}]`,
        Definition: definition,
        DefinitionAudio: `[sound:${definitionAudio}]`,
        Example: example || "",
        ExampleAudio: example ? `[sound:${exampleAudio}]` : "",
      },
      tags: tags,
      options: {
        allowDuplicate: false,
        duplicateScope: "deck",
      },
    };

    await invokeAnkiConnect("addNote", { note });

    return {
      word,
      definition,
      example,
      notes,
      tags: tags.join(","),
      dateAdded: new Date().toISOString(),
      wordAudio,
      definitionAudio,
      exampleAudio,
    };
  } catch (error) {
    await log('ERROR', `处理单词失败: ${word}`, error);
    throw error;
  }
}

// Helper function to validate English text
function isEnglishText(text: string): boolean {
  // Allow English letters, numbers, basic punctuation, and whitespace
  const englishPattern = /^[a-zA-Z0-9\s.,!?;:'"()\-\[\]]*$/;
  return englishPattern.test(text);
}

// Helper function to validate word data
function validateWordData(wordData: {
  word: string;
  definition: string;
  example?: string;
  notes?: string;
  tags?: string[];
}): { isValid: boolean; error?: string } {
  // Validate word (only English letters allowed)
  if (!/^[a-zA-Z\s\-']+$/.test(wordData.word)) {
    return { isValid: false, error: `Word "${wordData.word}" must contain only English letters, spaces, hyphens, or apostrophes` };
  }

  // Validate definition (English text only)
  if (!isEnglishText(wordData.definition)) {
    return { isValid: false, error: `Definition for "${wordData.word}" must be in English` };
  }

  // Validate example if provided
  if (wordData.example && !isEnglishText(wordData.example)) {
    return { isValid: false, error: `Example for "${wordData.word}" must be in English` };
  }

  // Validate notes if provided
  if (wordData.notes && !isEnglishText(wordData.notes)) {
    return { isValid: false, error: `Notes for "${wordData.word}" must be in English` };
  }

  // Validate tags if provided
  if (wordData.tags) {
    for (const tag of wordData.tags) {
      if (!/^[a-zA-Z0-9\-_]+$/.test(tag)) {
        return { isValid: false, error: `Tag "${tag}" for word "${wordData.word}" must contain only English letters, numbers, hyphens, or underscores` };
      }
    }
  }

  return { isValid: true };
}

// Register tools
server.tool(
  "add-words-batch",
  "Add words to vocabulary list and create Anki cards (supports both single and batch operations). For single word, pass an array with one item.",
  {
    words: z.array(z.object({
      word: z.string().describe("The word to add (English only)"),
      definition: z.string().describe("The definition of the word (English only)"),
      example: z.string().optional().describe("An example sentence using the word (English only)"),
      notes: z.string().optional().describe("Additional notes about the word (English only)"),
      tags: z.array(z.string()).optional().describe("Tags for categorizing the word (alphanumeric, hyphens, and underscores only)"),
    })).describe("Array of words to add (single item for single word)"),
  },
  async ({ words }) => {
    try {
      const wordCount = words.length;
      const isSingleWord = wordCount === 1;
      await log('INFO', isSingleWord ? `Adding word: ${words[0].word}` : `Starting batch addition of ${wordCount} words`);
      await ensureDirectories();

      // Validate all words first
      for (const wordData of words) {
        const validation = validateWordData(wordData);
        if (!validation.isValid) {
          return {
            content: [
              {
                type: "text",
                text: `Validation Error: ${validation.error}`,
              },
            ],
          };
        }
      }

      // Read existing vocabulary
      let existingWords = await readCsvFile(VOCAB_FILE) as any[];
      const results = {
        success: [] as any[],
        failed: [] as { word: string; error: string }[],
      };

      // Process each word
      for (const wordData of words) {
        try {
          const processedWord = await processWord(wordData);
          results.success.push(processedWord);
          existingWords.push(processedWord);
        } catch (error: any) {
          results.failed.push({
            word: wordData.word,
            error: error.message,
          });
        }
      }

      // Update vocabulary file
      if (results.success.length > 0) {
        await writeCsvFile(VOCAB_FILE, existingWords);
      }

      // Prepare response message
      let responseMessage = '';
      if (isSingleWord) {
        if (results.success.length === 1) {
          responseMessage = `✅ Successfully added word: "${words[0].word}"`;
        } else {
          responseMessage = `❌ Failed to add word "${words[0].word}": ${results.failed[0].error}`;
        }
      } else {
        responseMessage = `Batch addition completed:\n`;
        responseMessage += `✅ Successfully added: ${results.success.length} words\n`;
        if (results.failed.length > 0) {
          responseMessage += `❌ Failed: ${results.failed.length} words\n\n`;
          responseMessage += `Failure details:\n`;
          results.failed.forEach(({ word, error }) => {
            responseMessage += `- ${word}: ${error}\n`;
          });
        }
      }

      return {
        content: [
          {
            type: "text",
            text: responseMessage,
          },
        ],
      };
    } catch (error: any) {
      const errorMessage = words.length === 1 
        ? `Error adding word "${words[0].word}": ${error.message}`
        : `Error in batch addition: ${error.message}`;
      
      await log('ERROR', errorMessage, error);
      return {
        content: [
          {
            type: "text",
            text: errorMessage,
          },
        ],
      };
    }
  },
);

server.tool(
  "list-words",
  `List words from Anki with various sorting options:

  Sorting Methods:
  - due: Sort by due date (less familiar words first)
    Best for: Regular review sessions, focusing on words that need immediate attention
    Use when: You want to practice words you're struggling with
  
  - recent: Sort by review frequency (most recently reviewed first)
    Best for: Reviewing your recent learning progress
    Use when: You want to see what you've been studying lately
  
  - difficulty: Sort by accuracy rate (most challenging words first)
    Best for: Targeted practice on problematic words
    Use when: You want to focus on words with high error rates
  
  - added: Sort by creation date (newest first)
    Best for: Reviewing recently added vocabulary
    Use when: You want to practice new words you've just learned
  
  - lapses: Sort by number of lapses (most forgotten first)
    Best for: Identifying consistently troublesome words
    Use when: You want to focus on words you frequently forget

  Note: Results are limited to prevent overwhelming output. Use the limit parameter to adjust.`,
  {
    sortBy: z.enum([
      "due",
      "recent", 
      "difficulty",
      "added",
      "lapses"
    ]).optional().describe("Sorting method to use"),
    limit: z.number().min(1).max(100).optional().describe("Maximum number of words to return (1-100, default: 20)"),
  },
  async ({ sortBy = "recent", limit = 20 }) => {
    const startTime = Date.now();
    await log('INFO', `List words request received`, { sortBy, limit });

    try {
      // 获取指定牌组中的所有卡片
      await log('DEBUG', `Fetching cards from deck: ${ANKI_DECK_NAME}`);
      const cardIds = await invokeAnkiConnect("findCards", {
        query: `deck:${ANKI_DECK_NAME}`
      });

      await log('DEBUG', `Found ${cardIds.length} cards in deck`);

      if (cardIds.length === 0) {
        await log('INFO', 'No cards found in deck');
        return {
          content: [
            {
              type: "text",
              text: "No cards found in the deck. Please add some words first.",
            },
          ],
        };
      }

      // 获取卡片详细信息
      await log('DEBUG', `Fetching detailed information for ${cardIds.length} cards`);
      const cardsInfo = await invokeAnkiConnect("cardsInfo", {
        cards: cardIds
      });

      // 根据排序方式处理卡片
      await log('DEBUG', `Sorting cards by: ${sortBy}`);
      let sortedCards = [...cardsInfo];
      switch (sortBy) {
        case "due":
          sortedCards.sort((a, b) => a.interval - b.interval);
          await log('DEBUG', 'Cards sorted by interval (ascending)');
          break;
        case "recent":
          sortedCards.sort((a, b) => b.reps - a.reps);
          await log('DEBUG', 'Cards sorted by review count (descending)');
          break;
        case "difficulty":
          sortedCards.sort((a, b) => {
            const accuracyA = a.reps > 0 ? (a.reps - a.lapses) / a.reps : 0;
            const accuracyB = b.reps > 0 ? (b.reps - b.lapses) / b.reps : 0;
            return accuracyA - accuracyB;
          });
          await log('DEBUG', 'Cards sorted by accuracy rate (ascending)');
          break;
        case "added":
          sortedCards.sort((a, b) => b.id - a.id);
          await log('DEBUG', 'Cards sorted by card ID (descending)');
          break;
        case "lapses":
          sortedCards.sort((a, b) => b.lapses - a.lapses);
          await log('DEBUG', 'Cards sorted by lapse count (descending)');
          break;
      }

      // 限制返回数量
      sortedCards = sortedCards.slice(0, limit);
      await log('DEBUG', `Limited result to ${sortedCards.length} cards`);

      // 记录一些统计信息
      const stats = {
        totalCards: cardIds.length,
        returnedCards: sortedCards.length,
        averageReviews: sortedCards.reduce((sum, card) => sum + card.reps, 0) / sortedCards.length,
        averageLapses: sortedCards.reduce((sum, card) => sum + card.lapses, 0) / sortedCards.length,
        averageInterval: sortedCards.reduce((sum, card) => sum + card.interval, 0) / sortedCards.length,
      };
      await log('INFO', 'Card statistics', stats);

      // 格式化输出
      await log('DEBUG', 'Fetching note information for formatted output');
      const formattedCards = await Promise.all(sortedCards.map(async (card) => {
        const noteInfo = await invokeAnkiConnect("notesInfo", {
          notes: [card.note]
        });
        const note = noteInfo[0];
        const accuracy = card.reps > 0 ? ((card.reps - card.lapses) / card.reps * 100).toFixed(1) : "N/A";
        
        return `Word: ${note.fields.Word.value}\n` +
          `Definition: ${note.fields.Definition.value}\n` +
          `${note.fields.Example?.value ? `Example: ${note.fields.Example.value}\n` : ""}` +
          `Stats:\n` +
          `- Reviews: ${card.reps}\n` +
          `- Lapses: ${card.lapses}\n` +
          `- Accuracy: ${accuracy}%\n` +
          `- Familiarity: ${formatInterval(card.interval)}\n` +
          `- Next Review: ${new Date(card.due * 1000).toLocaleDateString()}\n` +
          "---";
      }));

      const summary = `Showing ${sortedCards.length} words (sorted by: ${sortBy})\n\n`;

      const executionTime = Date.now() - startTime;
      await log('INFO', `List words request completed`, { 
        executionTime: `${executionTime}ms`,
        cardsReturned: sortedCards.length,
        sortBy,
        limit
      });

      return {
        content: [
          {
            type: "text",
            text: summary + (formattedCards.join("\n") || "No matching words found."),
          },
        ],
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      const errorDetails = {
        message: error.message,
        sortBy,
        limit,
        executionTime: `${executionTime}ms`
      };
      
      await log('ERROR', `Failed to list words: ${error.message}`, errorDetails);
      return {
        content: [
          {
            type: "text",
            text: `Error listing words: ${error.message}`,
          },
        ],
      };
    }
  },
);

// 辅助函数：格式化时间间隔
function formatInterval(interval: number): string {
  if (interval === 0) return "新卡片";
  if (interval < 24) return `${interval}小时`;
  const days = Math.floor(interval / 24);
  if (days < 30) return `${days}天`;
  const months = Math.floor(days / 30);
  return `${months}个月`;
}

server.tool(
  "search-words",
  "Search for words in the vocabulary list",
  {
    query: z.string().describe("Search query (word or definition)"),
  },
  async ({ query }) => {
    try {
      await ensureDirectories();
      const words = await readCsvFile(VOCAB_FILE) as any[];
      
      const matchingWords = words.filter((w: any) => 
        w.word.toLowerCase().includes(query.toLowerCase()) ||
        w.definition.toLowerCase().includes(query.toLowerCase())
      );

      const formattedWords = matchingWords.map((w: any) => 
        `${w.word}\n` +
        `Definition: ${w.definition}\n` +
        `${w.example ? `Example: ${w.example}\n` : ""}` +
        `${w.notes ? `Notes: ${w.notes}\n` : ""}` +
        `${w.tags ? `Tags: ${w.tags}\n` : ""}` +
        "---"
      ).join("\n");

      return {
        content: [
          {
            type: "text",
            text: formattedWords || `No words found matching "${query}".`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error searching words: ${error.message}`,
          },
        ],
      };
    }
  },
);

// Main function to run the server
async function main() {
  await log('INFO', 'Starting Anki MCP Server...');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await log('INFO', 'Anki MCP Server running on stdio');
}

main().catch(async (error) => {
  await log('ERROR', `Fatal error in main(): ${error}`);
  process.exit(1);
}); 