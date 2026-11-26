import axios, { AxiosError } from 'axios';
import { AIProvider, GenerateOptions, OptimizationMode } from '../types';
import { getModePrompts } from '../prompts/templates';
import { cleanupModelResponse } from '../prompts/template-utils';
import { isAsyncIterable, readOllamaNDJSONStream, readStreamAsString } from './stream-utils';

export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

interface OllamaErrorBody {
  error?: string;
}

export class OllamaProvider implements AIProvider {
  private config: OllamaConfig;

  constructor(config: OllamaConfig) {
    this.config = config;
  }

  get name(): string {
    return 'ollama';
  }

  get model(): string {
    return this.config.model;
  }

  private get normalizedBaseUrl(): string {
    return this.config.baseUrl.replace(/\/+$/, '');
  }

  async optimize(text: string, mode: OptimizationMode, options?: GenerateOptions): Promise<string> {
    const { systemPrompt, userPrompt } = getModePrompts(mode, text);
    const result = await this.callOllama(userPrompt, {
      ...options,
      systemPrompt: options?.systemPrompt ?? systemPrompt,
    });
    return cleanupModelResponse(result, true);
  }

  async generateWithPrompt(prompt: string, options?: GenerateOptions): Promise<string> {
    const result = await this.callOllama(prompt, options);
    return cleanupModelResponse(result, true);
  }

  private async extractErrorMessage(data: unknown): Promise<string | undefined> {
    let body: unknown = data;
    if (isAsyncIterable(data)) {
      try {
        const raw = await readStreamAsString(data);
        body = JSON.parse(raw);
      } catch {
        return undefined;
      }
    }
    const parsed = body as OllamaErrorBody | undefined;
    return typeof parsed?.error === 'string' && parsed.error.trim()
      ? parsed.error.trim()
      : undefined;
  }

  private async callOllama(prompt: string, options?: GenerateOptions): Promise<string> {
    const streaming = Boolean(options?.onToken);
    const useChatApi = Boolean(options?.systemPrompt);
    const url = `${this.normalizedBaseUrl}${useChatApi ? '/api/chat' : '/api/generate'}`;
    const body = useChatApi
      ? {
          model: this.config.model,
          messages: [
            { role: 'system', content: options!.systemPrompt },
            { role: 'user', content: prompt },
          ],
          stream: streaming,
          options: {
            temperature: 0.7,
            top_p: 0.9,
          },
        }
      : {
          model: this.config.model,
          prompt,
          stream: streaming,
          options: {
            temperature: 0.7,
            top_p: 0.9,
          },
        };

    try {
      const response = await axios.post(url, body, {
        timeout: 60000,
        ...(streaming ? { responseType: 'stream' as const } : {}),
      });

      if (streaming && isAsyncIterable(response.data)) {
        const result = await readOllamaNDJSONStream(response.data, options?.onToken);
        if (result) {
          return result;
        }
        throw new Error('Invalid response from Ollama');
      }

      const rawContent =
        typeof response.data?.message?.content === 'string'
          ? response.data.message.content
          : response.data?.response;

      if (typeof rawContent === 'string' && rawContent.trim()) {
        const content = rawContent.trim();
        if (streaming) {
          options?.onToken?.(content);
        }
        return content;
      }

      throw new Error('Invalid response from Ollama');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.code === 'ECONNREFUSED') {
          throw new Error(
            `Cannot connect to Ollama at ${this.config.baseUrl}. Make sure Ollama is running.`
          );
        }
        const detail = await this.extractErrorMessage(axiosError.response?.data);
        if (detail) {
          throw new Error(`Ollama API error: ${detail}`);
        }
        throw new Error(`Ollama API error: ${axiosError.message}`);
      }
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.normalizedBaseUrl}/api/tags`, {
        timeout: 5000,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
