#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import OpenAI from "openai";
import dotenv from "dotenv";
import { log } from './logger.js';
import { formatInterval } from './utils.js';
import { AnkiService } from './services/anki-service.js';
import { AudioService } from './services/audio-service.js';
import { VocabularyService } from './services/vocabulary-service.js';

// 加载环境变量
dotenv.config();

// 验证必要的环境变量
if (!process.env.OPENAI_API_KEY) {
  await log('ERROR', "未设置 OPENAI_API_KEY 环境变量");
  process.exit(1);
}

// 初始化服务
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE,
});

const ankiService = new AnkiService(
  process.env.ANKI_CONNECT_URL,
  process.env.ANKI_DECK_NAME,
  process.env.ANKI_MODEL_NAME
);

const audioService = new AudioService(openai, ankiService);
const vocabularyService = new VocabularyService(ankiService, audioService);

// Create server instance
const server = new McpServer({
  name: "anki-mcp",
  version: "1.0.0",
});

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
      await log('INFO', isSingleWord ? `添加单词: ${words[0].word}` : `开始批量添加 ${wordCount} 个单词`);

      const results = await vocabularyService.addWords(words);

      // 准备响应消息
      let responseMessage = '';
      if (isSingleWord) {
        if (results.success.length === 1) {
          responseMessage = `✅ 成功添加单词: "${words[0].word}"`;
        } else {
          responseMessage = `❌ 添加单词 "${words[0].word}" 失败: ${results.failed[0].error}`;
        }
      } else {
        responseMessage = `批量添加完成:\n`;
        responseMessage += `✅ 成功添加: ${results.success.length} 个单词\n`;
        if (results.failed.length > 0) {
          responseMessage += `❌ 失败: ${results.failed.length} 个单词\n\n`;
          responseMessage += `失败详情:\n`;
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
        ? `添加单词 "${words[0].word}" 时出错: ${error.message}`
        : `批量添加单词时出错: ${error.message}`;
      
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
    limit: z.number().min(1).max(100).optional().describe("Maximum number of results to return (1-100, default: 20)"),
  },
  async ({ sortBy = "recent", limit = 20 }) => {
    const startTime = Date.now();
    await log('INFO', `列出单词请求已收到`, { sortBy, limit });

    try {
      // 获取指定牌组中的所有卡片
      await log('DEBUG', `从牌组获取卡片: ${process.env.ANKI_DECK_NAME}`);
      const cardIds = await ankiService.findCards("");

      await log('DEBUG', `找到 ${cardIds.length} 张卡片`);

      if (cardIds.length === 0) {
        await log('INFO', '未找到卡片');
        return {
          content: [
            {
              type: "text",
              text: "牌组中没有卡片。请先添加一些单词。",
            },
          ],
        };
      }

      // 获取卡片详细信息
      await log('DEBUG', `获取 ${cardIds.length} 张卡片的详细信息`);
      const cardsInfo = await ankiService.getCardsInfo(cardIds);

      // 根据排序方式处理卡片
      await log('DEBUG', `按 ${sortBy} 排序卡片`);
      let sortedCards = [...cardsInfo];
      switch (sortBy) {
        case "due":
          sortedCards.sort((a, b) => a.interval - b.interval);
          await log('DEBUG', '按间隔排序（升序）');
          break;
        case "recent":
          sortedCards.sort((a, b) => b.reps - a.reps);
          await log('DEBUG', '按复习次数排序（降序）');
          break;
        case "difficulty":
          sortedCards.sort((a, b) => {
            const accuracyA = a.reps > 0 ? (a.reps - a.lapses) / a.reps : 0;
            const accuracyB = b.reps > 0 ? (b.reps - b.lapses) / b.reps : 0;
            return accuracyA - accuracyB;
          });
          await log('DEBUG', '按正确率排序（升序）');
          break;
        case "added":
          sortedCards.sort((a, b) => b.id - a.id);
          await log('DEBUG', '按卡片 ID 排序（降序）');
          break;
        case "lapses":
          sortedCards.sort((a, b) => b.lapses - a.lapses);
          await log('DEBUG', '按遗忘次数排序（降序）');
          break;
      }

      // 限制返回数量
      sortedCards = sortedCards.slice(0, limit);
      await log('DEBUG', `限制结果为 ${sortedCards.length} 张卡片`);

      // 记录一些统计信息
      const stats = {
        totalCards: cardIds.length,
        returnedCards: sortedCards.length,
        averageReviews: sortedCards.reduce((sum, card) => sum + card.reps, 0) / sortedCards.length,
        averageLapses: sortedCards.reduce((sum, card) => sum + card.lapses, 0) / sortedCards.length,
        averageInterval: sortedCards.reduce((sum, card) => sum + card.interval, 0) / sortedCards.length,
      };
      await log('INFO', '卡片统计信息', stats);

      // 格式化输出
      await log('DEBUG', '获取笔记信息以格式化输出');
      const formattedCards = await Promise.all(sortedCards.map(async (card) => {
        const noteInfo = await ankiService.getNotesInfo([card.note]);
        const note = noteInfo[0];
        const accuracy = card.reps > 0 ? ((card.reps - card.lapses) / card.reps * 100).toFixed(1) : "N/A";
        
        return `单词: ${note.fields.Word.value}\n` +
               `定义: ${note.fields.Definition.value}\n` +
               `${note.fields.Example?.value ? `例句: ${note.fields.Example.value}\n` : ""}` +
               `统计:\n` +
               `- 复习次数: ${card.reps}\n` +
               `- 遗忘次数: ${card.lapses}\n` +
               `- 正确率: ${accuracy}%\n` +
               `- 熟悉度: ${formatInterval(card.interval)}\n` +
               `- 下次复习: ${new Date(card.due * 1000).toLocaleDateString()}\n` +
               "---";
      }));

      const summary = `显示 ${sortedCards.length} 个单词（按 ${sortBy} 排序）\n\n`;

      const executionTime = Date.now() - startTime;
      await log('INFO', `列出单词请求完成`, { 
        executionTime: `${executionTime}ms`,
        cardsReturned: sortedCards.length,
        sortBy,
        limit
      });

      return {
        content: [
          {
            type: "text",
            text: summary + formattedCards.join("\n"),
          },
        ],
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      await log('ERROR', `列出单词失败`, {
        error: error.message,
        sortBy,
        limit,
        executionTime: `${executionTime}ms`
      });
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
  "Search words and definitions in Anki deck",
  {
    query: z.string().describe("Search query (word or definition)"),
    limit: z.number().min(1).max(50).optional().describe("Maximum number of results to return (1-50, default: 20)"),
  },
  async ({ query, limit = 20 }) => {
    const startTime = Date.now();
    await log('INFO', `搜索请求已收到`, { query, limit });

    try {
      // 搜索单词
      const words = await vocabularyService.searchWords(query);
      
      if (words.length === 0) {
        await log('INFO', '未找到匹配的单词');
        return {
          content: [
            {
              type: "text",
              text: `未找到包含 "${query}" 的单词。`,
            },
          ],
        };
      }

      // 获取 Anki 卡片信息
      const cardIds = await ankiService.findCards(
        `("Word:*${query}*" OR "Definition:*${query}*")`
      );
      const cardsInfo = await ankiService.getCardsInfo(cardIds);
      const notesInfo = await ankiService.getNotesInfo(cardsInfo.map(card => card.note));

      // 计算相关性分数并排序结果
      const scoredWords = words.map(word => {
        const card = cardsInfo.find(c => {
          const note = notesInfo.find(n => n.noteId === c.note);
          return note && note.fields.Word.value.toLowerCase() === word.word.toLowerCase();
        });

        if (!card) return null;

        // 计算相关性分数
        const searchQuery = query.toLowerCase();
        let score = 0;
        
        // 完全匹配（最高优先级）
        if (word.word.toLowerCase() === searchQuery) score += 100;
        // 单词以查询开头
        else if (word.word.toLowerCase().startsWith(searchQuery)) score += 80;
        // 单词包含查询
        else if (word.word.toLowerCase().includes(searchQuery)) score += 60;
        // 定义中的完整单词匹配
        else if (word.definition.toLowerCase().split(/\s+/).some(w => w === searchQuery)) score += 40;
        // 定义包含查询
        else if (word.definition.toLowerCase().includes(searchQuery)) score += 20;

        return { word, card, score };
      }).filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      // 格式化输出
      const formattedWords = scoredWords.map(({ word, card }) => {
        const accuracy = card.reps > 0 ? ((card.reps - card.lapses) / card.reps * 100).toFixed(1) : "N/A";
        
        return `单词: ${word.word}\n` +
               `定义: ${word.definition}\n` +
               `${word.example ? `例句: ${word.example}\n` : ""}` +
               `统计:\n` +
               `- 复习次数: ${card.reps}\n` +
               `- 遗忘次数: ${card.lapses}\n` +
               `- 正确率: ${accuracy}%\n` +
               `- 熟悉度: ${formatInterval(card.interval)}\n` +
               `- 下次复习: ${new Date(card.due * 1000).toLocaleDateString()}\n` +
               `${word.tags?.length ? `标签: ${word.tags.join(", ")}\n` : ""}` +
               "---";
      }).join("\n");

      const totalMatches = words.length;
      const summary = `找到 ${totalMatches} 个匹配的单词${totalMatches > limit ? `（显示前 ${limit} 个最相关结果）` : ""}:\n\n`;

      const executionTime = Date.now() - startTime;
      await log('INFO', `搜索完成`, {
        executionTime: `${executionTime}ms`,
        totalMatches,
        displayedResults: scoredWords.length,
        query,
        relevanceOrder: scoredWords.map(n => n.word.word).join(', ')
      });

      return {
        content: [
          {
            type: "text",
            text: summary + formattedWords,
          },
        ],
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      await log('ERROR', `搜索操作失败`, {
        error: error.message,
        query,
        executionTime: `${executionTime}ms`
      });
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

// 优雅关闭处理
async function handleShutdown() {
  await log('INFO', '关闭 Anki MCP 服务器...');
  try {
    // 清理未使用的音频文件
    await audioService.cleanupUnusedAudioFiles();
    await log('INFO', '服务器关闭完成');
    process.exit(0);
  } catch (error) {
    await log('ERROR', `关闭过程中出错: ${error}`, error);
    process.exit(1);
  }
}

// Main function to run the server
async function main() {
  await log('INFO', '启动 Anki MCP 服务器...');
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    await log('INFO', 'Anki MCP 服务器在 stdio 上运行');
  
    // 设置优雅关闭
    process.on('SIGTERM', handleShutdown);
    process.on('SIGINT', handleShutdown);
  } catch (error) {
    await log('ERROR', `服务器初始化错误: ${error}`, error);
    process.exit(1);
  }
}

main(); 