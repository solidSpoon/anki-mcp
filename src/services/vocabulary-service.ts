import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import { parse } from "csv-parse";
import { stringify } from "csv-stringify/sync";
import { log } from '../logger.js';
import { WordData, deduplicateWordData, validateWordData } from '../utils.js';
import { AnkiService } from './anki-service.js';
import { AudioService } from './audio-service.js';

// 定义项目路径
const PROJECT_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const VOCAB_FILE = path.join(DATA_DIR, "vocabulary.csv");

export class VocabularyService {
  private readonly ankiService: AnkiService;
  private readonly audioService: AudioService;

  constructor(ankiService: AnkiService, audioService: AudioService) {
    this.ankiService = ankiService;
    this.audioService = audioService;
  }

  private async readCsvFile(): Promise<WordData[]> {
    try {
      const content = await fs.readFile(VOCAB_FILE, "utf-8");
      return new Promise((resolve, reject) => {
        parse(content, {
          columns: true,
          skip_empty_lines: true,
        }, (err, data) => {
          if (err) reject(err);
          else resolve(deduplicateWordData(data as WordData[]));
        });
      });
    } catch (e: any) {
      // 如果文件不存在，返回空数组
      if (e.code === 'ENOENT') {
        return [];
      }
      throw e;
    }
  }

  private async writeCsvFile(data: WordData[]): Promise<void> {
    const uniqueData = deduplicateWordData(data);
    const csvContent = stringify(uniqueData, { header: true });
    await fs.writeFile(VOCAB_FILE, csvContent);
  }

  async addWords(words: Array<{
    word: string;
    definition: string;
    example?: string;
    notes?: string;
    tags?: string[];
  }>): Promise<{
    success: WordData[];
    failed: Array<{ word: string; error: string }>;
  }> {
    try {
      // 确保目录存在
      await fs.mkdir(DATA_DIR, { recursive: true });
      
      // 读取现有词汇
      const existingWords = await this.readCsvFile();
      const results = {
        success: [] as WordData[],
        failed: [] as Array<{ word: string; error: string }>,
      };

      // 并行处理单词，每批次处理 3 个
      const batchSize = 3;
      for (let i = 0; i < words.length; i += batchSize) {
        const batch = words.slice(i, i + batchSize);
        const batchPromises = batch.map(async (wordData) => {
          try {
            // 验证单词数据
            const validation = validateWordData(wordData);
            if (!validation.isValid) {
              throw new Error(validation.error);
            }

            // 生成音频文件
            const [wordAudio, definitionAudio, exampleAudio] = await Promise.all([
              this.audioService.createAudioFile(wordData.word, wordData.word, "word"),
              this.audioService.createAudioFile(wordData.definition, wordData.word, "definition"),
              wordData.example
                ? this.audioService.createAudioFile(wordData.example, wordData.word, "example")
                : Promise.resolve(""),
            ]);

            // 创建 Anki 笔记
            const fields = {
              Word: wordData.word,
              WordAudio: `[sound:${wordAudio}]`,
              Definition: wordData.definition,
              DefinitionAudio: `[sound:${definitionAudio}]`,
              Example: wordData.example || "",
              ExampleAudio: wordData.example ? `[sound:${exampleAudio}]` : "",
            };

            await this.ankiService.addNote(fields, wordData.tags);

            // 准备要保存的数据
            const processedWord: WordData = {
              ...wordData,
              dateAdded: new Date().toISOString(),
            };

            return { success: true, data: processedWord };
          } catch (error: any) {
            return {
              success: false,
              error: {
                word: wordData.word,
                error: error.message,
              },
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        
        // 处理批次结果
        batchResults.forEach(result => {
          if (result.success && result.data) {
            results.success.push(result.data);
          } else if (!result.success && result.error) {
            results.failed.push(result.error);
          }
        });
      }

      // 更新词汇文件
      if (results.success.length > 0) {
        await this.writeCsvFile([...existingWords, ...results.success]);
      }

      return results;
    } catch (error: any) {
      await log('ERROR', '添加单词失败', error);
      throw error;
    }
  }

  async searchWords(query: string): Promise<WordData[]> {
    try {
      const words = await this.readCsvFile();
      const lowercaseQuery = query.toLowerCase();
      
      return words.filter(word => 
        word.word.toLowerCase().includes(lowercaseQuery) ||
        word.definition.toLowerCase().includes(lowercaseQuery) ||
        (word.example && word.example.toLowerCase().includes(lowercaseQuery))
      );
    } catch (error: any) {
      await log('ERROR', '搜索单词失败', error);
      throw error;
    }
  }

  async getAllWords(): Promise<WordData[]> {
    try {
      return await this.readCsvFile();
    } catch (error: any) {
      await log('ERROR', '获取所有单词失败', error);
      throw error;
    }
  }
} 