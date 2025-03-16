import { log } from '../logger.js';
import { delay } from '../utils.js';

export class AnkiService {
  private readonly baseUrl: string;
  private readonly deckName: string;
  private readonly modelName: string;
  private readonly maxRetries: number;
  private readonly initialRetryDelay: number;

  constructor(
    baseUrl: string = "http://localhost:8765",
    deckName: string = "Vocabulary",
    modelName: string = "Basic",
    maxRetries: number = 2,
    initialRetryDelay: number = 500
  ) {
    this.baseUrl = baseUrl;
    this.deckName = deckName;
    this.modelName = modelName;
    this.maxRetries = maxRetries;
    this.initialRetryDelay = initialRetryDelay;
  }

  private async invokeAnkiConnect(action: string, params = {}, retries = this.maxRetries): Promise<any> {
    let lastError;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const requestBody = {
          action,
          version: 6,
          params,
        };

        await log('DEBUG', `调用 AnkiConnect API: ${action}`, { action, params });

        const response = await fetch(this.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        await log('DEBUG', '收到 AnkiConnect 响应', { result });

        if (result.error) {
          throw new Error(`AnkiConnect error: ${result.error}`);
        }

        return result.result;
      } catch (error: any) {
        lastError = error;
        
        await log('ERROR', `AnkiConnect 请求失败 (尝试 ${attempt + 1}/${retries + 1}): ${action}`, {
          error,
          request: { action, params, url: this.baseUrl }
        });

        if (attempt < retries) {
          const delayMs = Math.pow(2, attempt) * this.initialRetryDelay;
          await delay(delayMs);
        }
      }
    }

    throw lastError;
  }

  async findCards(query: string): Promise<number[]> {
    return this.invokeAnkiConnect("findCards", {
      query: `deck:${this.deckName} ${query}`
    });
  }

  async getCardsInfo(cardIds: number[]): Promise<any[]> {
    return this.invokeAnkiConnect("cardsInfo", { cards: cardIds });
  }

  async getNotesInfo(noteIds: number[]): Promise<any[]> {
    return this.invokeAnkiConnect("notesInfo", { notes: noteIds });
  }

  async addNote(fields: Record<string, string>, tags: string[] = []): Promise<number> {
    const note = {
      deckName: this.deckName,
      modelName: this.modelName,
      fields,
      tags,
      options: {
        allowDuplicate: false,
        duplicateScope: "deck",
      },
    };

    return this.invokeAnkiConnect("addNote", { note });
  }

  async storeMediaFile(filename: string, data: string): Promise<void> {
    await this.invokeAnkiConnect("storeMediaFile", {
      filename,
      data,
    });
  }

  async getMediaFilesNames(): Promise<string[]> {
    return this.invokeAnkiConnect("getMediaFilesNames", {});
  }
} 