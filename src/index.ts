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
async function log(level: 'INFO' | 'ERROR' | 'DEBUG', message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}\n`;
  
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(LOG_FILE, logMessage);
  } catch (error) {
    console.error('写入日志失败:', error);
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
  const response = await fetch(ANKI_CONNECT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action,
      version: 6,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`AnkiConnect request failed: ${response.statusText}`);
  }

  const result = await response.json();
  if (result.error) {
    throw new Error(`AnkiConnect error: ${result.error}`);
  }

  return result.result;
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
  const content = await fs.readFile(filePath, "utf-8");
  return new Promise((resolve, reject) => {
    parse(content, {
      columns: true,
      skip_empty_lines: true,
    }, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

// Helper function to write CSV file
async function writeCsvFile(filePath: string, data: any[]) {
  const csvContent = stringify(data, { header: true });
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

// Register tools
server.tool(
  "add-word",
  "Add a new word to vocabulary list and create Anki card",
  {
    word: z.string().describe("The word to add"),
    definition: z.string().describe("The definition of the word"),
    example: z.string().optional().describe("An example sentence using the word"),
    notes: z.string().optional().describe("Additional notes about the word"),
    tags: z.array(z.string()).optional().describe("Tags for categorizing the word"),
  },
  async ({ word, definition, example = "", notes = "", tags = [] }) => {
    try {
      await log('INFO', `Adding new word: ${word}`);
      
      // 1. Add to CSV
      await ensureDirectories();
      let words = [];
      try {
        words = await readCsvFile(VOCAB_FILE) as any[];
      } catch (e) {
        await log('DEBUG', 'Vocabulary file does not exist, creating new one');
      }

      // 2. Generate audio files
      await log('INFO', `Generating audio for word: ${word}`);
      const wordAudio = await createAudioFile(word, word, "word");
      
      await log('INFO', 'Generating audio for definition');
      const definitionAudio = await createAudioFile(definition, word, "definition");
      
      let exampleAudio = "";
      if (example) {
        await log('INFO', 'Generating audio for example');
        exampleAudio = await createAudioFile(example, word, "example");
      }

      const newWord = {
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

      words.push(newWord);
      await writeCsvFile(VOCAB_FILE, words);

      // 3. Create Anki card with template
      const cardFront = `
        <div class="container">
          <div class="word">${word}</div>
          <div class="hidden">[sound:${wordAudio}]</div>
        </div>
      `;

      const cardBack = `
        <div class="container">
          <div class="header">
            <div class="word">${word}</div>
            <div class="hidden">[sound:${wordAudio}]</div>
          </div>
          <div class="section">
            <div class="label">Definition</div>
            <div class="content">${definition}</div>
            <div class="hidden">[sound:${definitionAudio}]</div>
          </div>
          ${example ? `
            <div class="section">
              <div class="label">Example</div>
              <div class="content">${example}</div>
              <div class="hidden">[sound:${exampleAudio}]</div>
            </div>
          ` : ""}
          ${notes ? `
            <div class="section">
              <div class="label">Notes</div>
              <div class="content">${notes}</div>
            </div>
          ` : ""}
        </div>
      `;

      // 4. Create note in Anki
      await invokeAnkiConnect("createNote", {
        note: {
          deckName: ANKI_DECK_NAME,
          modelName: ANKI_MODEL_NAME,
          fields: {
            Front: cardFront,
            Back: cardBack,
          },
          tags: tags,
        },
      });

      await log('INFO', `Successfully added word: ${word}`);
      
      return {
        content: [
          {
            type: "text",
            text: `成功添加单词 "${word}" 到词汇表并创建了 Anki 卡片。`,
          },
        ],
      };
    } catch (error: any) {
      await log('ERROR', `Error adding word ${word}: ${error.message}`);
      return {
        content: [
          {
            type: "text",
            text: `添加单词时出错: ${error.message}`,
          },
        ],
      };
    }
  },
);

server.tool(
  "list-words",
  "List all words in the vocabulary list",
  {},
  async () => {
    try {
      await ensureDirectories();
      const words = await readCsvFile(VOCAB_FILE) as any[];
      
      if (words.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "词汇列表为空。使用 add-word 命令来添加新单词。",
            },
          ],
        };
      }
      
      const formattedWords = words.map((w: any) => 
        `${w.word}\n` +
        `定义: ${w.definition}\n` +
        `${w.example ? `例句: ${w.example}\n` : ""}` +
        `${w.notes ? `笔记: ${w.notes}\n` : ""}` +
        `${w.tags ? `标签: ${w.tags}\n` : ""}` +
        "---"
      ).join("\n");

      return {
        content: [
          {
            type: "text",
            text: formattedWords,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `列出单词时出错: ${error.message}`,
          },
        ],
      };
    }
  },
);

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
        `定义: ${w.definition}\n` +
        `${w.example ? `例句: ${w.example}\n` : ""}` +
        `${w.notes ? `笔记: ${w.notes}\n` : ""}` +
        `${w.tags ? `标签: ${w.tags}\n` : ""}` +
        "---"
      ).join("\n");

      return {
        content: [
          {
            type: "text",
            text: formattedWords || `没有找到匹配 "${query}" 的单词。`,
          },
        ],
      };
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `搜索单词时出错: ${error.message}`,
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