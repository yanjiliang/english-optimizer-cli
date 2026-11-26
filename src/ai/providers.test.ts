import { describe, it, expect, vi, afterEach } from 'vitest';
import { Readable } from 'stream';
import axios from 'axios';
import { createProvider, ApiProvider, OllamaProvider } from './provider';
import { DEFAULT_CONFIG } from '../config/config';
import { OptimizationMode } from '../types';

describe('AI providers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates providers with accurate name and model getters', () => {
    const ollama = createProvider(DEFAULT_CONFIG);
    expect(ollama).toBeInstanceOf(OllamaProvider);
    expect(ollama.name).toBe('ollama');
    expect(ollama.model).toBe('llama3.2:3b');

    const api = createProvider({
      ...DEFAULT_CONFIG,
      ai: {
        ...DEFAULT_CONFIG.ai,
        provider: 'api',
        api: {
          provider: 'deepseek',
          apiKey: 'secret',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
        },
      },
    });
    expect(api).toBeInstanceOf(ApiProvider);
    expect(api.name).toBe('deepseek');
    expect(api.model).toBe('deepseek-chat');
  });

  it('cleans up ApiProvider responses and surfaces GLM balance errors', async () => {
    const provider = new ApiProvider({
      provider: 'glm',
      apiKey: 'test-key',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4',
    });

    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { choices: [{ message: { content: 'Rewritten text: "Clean output."' } }] },
    });
    const out = await provider.optimize('dirty input', OptimizationMode.CONCISE);
    expect(out).toBe('Clean output.');

    const axiosErr = Object.assign(new Error('Request failed'), {
      isAxiosError: true,
      response: { status: 429, data: { error: { code: '1113', message: 'insufficient balance' } } },
    });
    vi.spyOn(axios, 'post').mockRejectedValueOnce(axiosErr);
    await expect(provider.generateWithPrompt('hi')).rejects.toThrow('balance is insufficient');
  });

  it('cleans up OllamaProvider responses and reports ECONNREFUSED clearly', async () => {
    const provider = new OllamaProvider({
      baseUrl: 'http://localhost:11434',
      model: 'llama3.2:3b',
    });

    vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { response: '"Hello from Ollama"' },
    });
    expect(await provider.generateWithPrompt('prompt')).toBe('Hello from Ollama');

    const connErr = Object.assign(new Error('connect ECONNREFUSED'), {
      isAxiosError: true,
      code: 'ECONNREFUSED',
    });
    vi.spyOn(axios, 'post').mockRejectedValueOnce(connErr);
    await expect(provider.generateWithPrompt('prompt')).rejects.toThrow('Cannot connect to Ollama');
  });

  it('streams SSE tokens in ApiProvider and parses stream error bodies', async () => {
    const provider = new ApiProvider({
      provider: 'glm',
      apiKey: 'test-key',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
      model: 'glm-4',
    });

    const sseStream = Readable.from([
      'data: {"choices":[{"delta":{"content":"\\"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world!\\""}}]}\n\n',
      'data: [DONE]\n\n',
    ]);

    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: sseStream });
    const received: string[] = [];
    const result = await provider.generateWithPrompt('prompt', {
      onToken: (token) => received.push(token),
    });

    expect(postSpy).toHaveBeenCalledWith(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      expect.objectContaining({ stream: true }),
      expect.objectContaining({ responseType: 'stream' })
    );
    expect(received).toEqual(['"Hello ', 'world!"']);
    expect(result).toBe('Hello world!');

    // Verify GLM balance error is still detected when responseType: 'stream' rejects
    const errStream = Readable.from([
      JSON.stringify({ error: { code: '1113', message: 'insufficient balance' } }),
    ]);
    const streamErr = Object.assign(new Error('Request failed'), {
      isAxiosError: true,
      response: { status: 429, data: errStream },
    });
    vi.spyOn(axios, 'post').mockRejectedValueOnce(streamErr);
    await expect(provider.generateWithPrompt('hi', { onToken: () => {} })).rejects.toThrow(
      'balance is insufficient'
    );
  });

  it('streams NDJSON tokens in OllamaProvider and surfaces error JSON from streams', async () => {
    const provider = new OllamaProvider({
      baseUrl: 'http://localhost:11434/',
      model: 'llama3.2:3b',
    });

    const ndjsonStream = Readable.from([
      '{"response":"Looks ","done":false}\n',
      '{"response":"good!","done":false}\n',
      '{"response":"","done":true}\n',
    ]);

    const postSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: ndjsonStream });
    const received: string[] = [];
    const result = await provider.generateWithPrompt('prompt', {
      onToken: (token) => received.push(token),
    });

    expect(postSpy).toHaveBeenCalledWith(
      'http://localhost:11434/api/generate',
      expect.objectContaining({ stream: true }),
      expect.objectContaining({ responseType: 'stream' })
    );
    expect(received).toEqual(['Looks ', 'good!']);
    expect(result).toBe('Looks good!');

    const errStream = Readable.from([JSON.stringify({ error: 'model "missing" not found' })]);
    const notFoundErr = Object.assign(new Error('Request failed with status code 404'), {
      isAxiosError: true,
      response: { status: 404, data: errStream },
    });
    vi.spyOn(axios, 'post').mockRejectedValueOnce(notFoundErr);
    await expect(provider.generateWithPrompt('prompt', { onToken: () => {} })).rejects.toThrow(
      'model "missing" not found'
    );
  });

  it('sends separated system and user messages for ApiProvider and Ollama /api/chat', async () => {
    const api = new ApiProvider({
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });

    const apiSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { choices: [{ message: { content: 'Could we add a null check here?' } }] },
    });
    const prOut = await api.optimize('这里加个判空', OptimizationMode.PR);
    expect(prOut).toBe('Could we add a null check here?');
    expect(apiSpy).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        messages: [
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' }),
        ],
      }),
      expect.any(Object)
    );

    const ollama = new OllamaProvider({
      baseUrl: 'http://localhost:11434',
      model: 'llama3.2:3b',
    });
    const chatStream = Readable.from([
      '{"message":{"role":"assistant","content":"fix(auth): "},"done":false}\n',
      '{"message":{"role":"assistant","content":"redirect on session expiry"},"done":false}\n',
      '{"done":true}\n',
    ]);
    const ollamaSpy = vi.spyOn(axios, 'post').mockResolvedValueOnce({ data: chatStream });
    const tokens: string[] = [];
    const commitOut = await ollama.optimize('修复登录过期没跳转', OptimizationMode.COMMIT, {
      onToken: (t) => tokens.push(t),
    });

    expect(ollamaSpy).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({
        stream: true,
        messages: [
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' }),
        ],
      }),
      expect.objectContaining({ responseType: 'stream' })
    );
    expect(tokens).toEqual(['fix(auth): ', 'redirect on session expiry']);
    expect(commitOut).toBe('fix(auth): redirect on session expiry');
  });
});
