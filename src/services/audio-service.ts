import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from 'url';
import OpenAI from "openai";
import { log } from '../logger.js';
import { formatWordForFilename, getStableHash } from '../utils.js';
import { AnkiService } from './anki-service.js';

// 定义项目路径
const PROJECT_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const AUDIO_DIR = path.join(DATA_DIR, "audio");

export class AudioService {
  private readonly openai: OpenAI;
  private readonly ankiService: AnkiService;

  constructor(openai: OpenAI, ankiService: AnkiService) {
    this.openai = openai;
    this.ankiService = ankiService;
  }

  async createAudioFile(text: string, word: string, audioType: string): Promise<string> {
    const formattedWord = formatWordForFilename(word);
    const stableHash = getStableHash(text);
    const audioFilename = `${formattedWord}-${audioType}-${stableHash}.mp3`;
    const audioPath = path.join(AUDIO_DIR, audioFilename);

    try {
      // 检查本地文件是否存在
      try {
        await fs.access(audioPath);
        
        // 检查文件是否也存在于 Anki 媒体集合中
        const mediaFiles = await this.ankiService.getMediaFilesNames();
        if (!mediaFiles.includes(audioFilename)) {
          // 如果文件在本地存在但不在 Anki 中，读取并添加到 Anki
          const fileBuffer = await fs.readFile(audioPath);
          await this.ankiService.storeMediaFile(
            audioFilename,
            fileBuffer.toString("base64")
          );
        }
      } catch (e) {
        // 文件不存在，创建它
        await log('DEBUG', `创建音频文件: ${audioFilename}`);
        
        // 确保目录存在
        await fs.mkdir(AUDIO_DIR, { recursive: true });
        
        // 生成音频
        const mp3Response = await this.openai.audio.speech.create({
          model: "tts-1",
          voice: "alloy",
          input: text,
          response_format: "mp3",
        });

        const buffer = Buffer.from(await mp3Response.arrayBuffer());
        
        // 保存到本地
        await fs.writeFile(audioPath, buffer);

        // 添加到 Anki
        await this.ankiService.storeMediaFile(
          audioFilename,
          buffer.toString("base64")
        );
      }

      return audioFilename;
    } catch (error) {
      await log('ERROR', `创建音频文件失败: ${audioFilename}`, error);
      throw error;
    }
  }

  async cleanupUnusedAudioFiles(): Promise<void> {
    try {
      // 获取所有本地音频文件
      const localFiles = await fs.readdir(AUDIO_DIR);
      
      // 获取 Anki 中的媒体文件
      const ankiFiles = await this.ankiService.getMediaFilesNames();
      
      // 找出只存在于本地的文件
      const unusedFiles = localFiles.filter(file => !ankiFiles.includes(file));
      
      // 删除未使用的文件
      for (const file of unusedFiles) {
        const filePath = path.join(AUDIO_DIR, file);
        try {
          await fs.unlink(filePath);
          await log('DEBUG', `删除未使用的音频文件: ${file}`);
        } catch (error) {
          await log('ERROR', `删除音频文件失败: ${file}`, error);
        }
      }
      
      await log('INFO', `清理完成，删除了 ${unusedFiles.length} 个未使用的音频文件`);
    } catch (error) {
      await log('ERROR', '清理未使用音频文件失败', error);
      throw error;
    }
  }
} 