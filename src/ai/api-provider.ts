import axios from 'axios';
import chalk from 'chalk';
import { AIProvider, ApiProviderName, GenerateOptions, OptimizationMode } from '../types';
import { getModePrompts } from '../prompts/templates';
import { cleanupModelResponse } from '../prompts/template-utils';
import { isAsyncIterable, readOpenAISSEStream, readStreamAsString } from './stream-utils';

export interface ApiProviderConfig {
  provider: ApiProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface ApiErrorBody {
  error?: {
    code?: string | number;
    message?: string;
  };
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const GLM_INSUFFICIENT_BALANCE_CODE = '1113';
const GLM_BALANCE_MESSAGE =
  'GLM account balance is insufficient. Please recharge your account at https://open.bigmodel.cn/usercenter/finance';

function isGlmBalanceError(data: unknown): boolean {
  const body = data as ApiErrorBody | undefined;
  return String(body?.error?.code) === GLM_INSUFFICIENT_BALANCE_CODE;
}

export class ApiProvider implements AIProvider {
  private config: ApiProviderConfig;

  constructor(config: ApiProviderConfig) {
    this.config = config;
  }

  get name(): string {
    return this.config.provider;
  }

  get model(): string {
    return this.config.model;
  }

  private get completionsUrl(): string {
    return `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  }

  private async extractErrorBody(data: unknown): Promise<unknown> {
    if (!isAsyncIterable(data)) {
      return data;
    }
    try {
      const raw = await readStreamAsString(data);
      if (!raw.trim()) {
        return undefined;
      }
      try {
        return JSON.parse(raw);
      } catch {
        return { error: { message: raw.trim() } };
      }
    } catch {
      return undefined;
    }
  }

  private async handleApiError(error: unknown): Promise<never> {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        const status = error.response.status;
        const body = await this.extractErrorBody(error.response.data);

        if (isGlmBalanceError(body)) {
          throw new Error(GLM_BALANCE_MESSAGE);
        }

        if (status === 401) {
          throw new Error('Invalid API key. Please check your API credentials.');
        } else if (status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        }

        const detail = (body as ApiErrorBody | undefined)?.error?.message;
        if (detail) {
          throw new Error(`API error (${status}): ${detail}`);
        }
      }
      throw new Error(`API error: ${error.message}`);
    }
    throw error;
  }

  async optimize(text: string, mode: OptimizationMode, options?: GenerateOptions): Promise<string> {
    const { systemPrompt, userPrompt } = getModePrompts(mode, text);
    const result = await this.callAPI(userPrompt, {
      ...options,
      systemPrompt: options?.systemPrompt ?? systemPrompt,
    });
    return cleanupModelResponse(result, true);
  }

  async generateWithPrompt(prompt: string, options?: GenerateOptions): Promise<string> {
    const result = await this.callAPI(prompt, options);
    return cleanupModelResponse(result, true);
  }

  private async callAPI(prompt: string, options?: GenerateOptions): Promise<string> {
    const streaming = Boolean(options?.onToken);
    const messages = options?.systemPrompt
      ? [
          { role: 'system', content: options.systemPrompt },
          { role: 'user', content: prompt },
        ]
      : [{ role: 'user', content: prompt }];

    try {
      const response = await axios.post<ChatCompletionResponse | AsyncIterable<Buffer | string>>(
        this.completionsUrl,
        {
          model: this.config.model,
          messages,
          temperature: 0.7,
          max_tokens: 2000,
          ...(streaming ? { stream: true } : {}),
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
          ...(streaming ? { responseType: 'stream' as const } : {}),
        }
      );

      if (streaming && isAsyncIterable(response.data)) {
        const result = await readOpenAISSEStream(response.data, options?.onToken);
        if (result) {
          return result;
        }
        throw new Error('Invalid response from API');
      }

      const data = response.data as ChatCompletionResponse;
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === 'string') {
        const trimmed = content.trim();
        if (streaming && trimmed) {
          options?.onToken?.(trimmed);
        }
        return trimmed;
      }

      throw new Error('Invalid response from API');
    } catch (error) {
      return await this.handleApiError(error);
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.config.apiKey) {
      return false;
    }

    try {
      // Try a simple API call to check if key is valid
      const response = await axios.post(
        this.completionsUrl,
        {
          model: this.config.model,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 5,
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );
      return response.status === 200;
    } catch (error) {
      if (!axios.isAxiosError(error)) {
        console.log('\n' + chalk.yellow('Request setup error:'), (error as Error).message);
        return false;
      }

      if (error.response) {
        console.log(
          '\n' + chalk.yellow('API connection failed with status:'),
          error.response.status
        );
        if (error.response.data) {
          console.log(chalk.yellow('Error details:'), JSON.stringify(error.response.data));

          // Throw error for GLM balance issues
          if (isGlmBalanceError(error.response.data)) {
            throw new Error(GLM_BALANCE_MESSAGE);
          }
        }
      } else if (error.request) {
        console.log('\n' + chalk.yellow('No response from API'));
        console.log(chalk.gray('Possible issues:'));
        console.log(chalk.gray('  - Network connectivity'));
        console.log(chalk.gray('  - API URL is incorrect'));
        console.log(chalk.gray('  - Firewall blocking the request'));
      } else {
        console.log('\n' + chalk.yellow('Request setup error:'), error.message);
      }
      return false;
    }
  }
}
