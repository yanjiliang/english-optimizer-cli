import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Optimizer } from './optimizer';
import { HistoryLogger } from '../history/logger';
import { AIProvider, CustomPrompt, OptimizationMode } from '../types';

function createMockProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    name: 'openai',
    model: 'gpt-4o',
    optimize: vi.fn().mockResolvedValue('Optimized output'),
    generateWithPrompt: vi.fn().mockResolvedValue('Generated output'),
    isAvailable: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('Optimizer and HistoryLogger', () => {
  let tempDir: string;
  let historyPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cao-opt-test-'));
    historyPath = join(tempDir, 'history.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('records real provider name, model, and mode on built-in optimize()', async () => {
    const provider = createMockProvider({ name: 'ollama', model: 'llama3.2:3b' });
    const logger = new HistoryLogger(historyPath);
    const optimizer = new Optimizer(provider, logger);

    const result = await optimizer.optimize('fix bug pls', OptimizationMode.PROFESSIONAL);

    expect(provider.optimize).toHaveBeenCalledWith('fix bug pls', OptimizationMode.PROFESSIONAL);
    expect(result.provider).toBe('ollama');
    expect(result.model).toBe('llama3.2:3b');
    expect(result.mode).toBe(OptimizationMode.PROFESSIONAL);

    const saved = logger.getHistory();
    expect(saved).toHaveLength(1);
    expect(saved[0].provider).toBe('ollama');
    expect(saved[0].model).toBe('llama3.2:3b');
    expect(saved[0].timestamp).toBeInstanceOf(Date);
  });

  it('uses custom prompt instruction instead of defaulting to professional mode', async () => {
    const provider = createMockProvider();
    const logger = new HistoryLogger(historyPath);
    const optimizer = new Optimizer(provider, logger);

    const custom: CustomPrompt = {
      name: 'Academic',
      description: 'Academic style',
      prompt: 'Rewrite academically: {text}',
      hotkey: 'a',
    };

    const result = await optimizer.optimizeWithCustomPrompt('We made it faster ($&).', custom);

    expect(provider.optimize).not.toHaveBeenCalled();
    expect(provider.generateWithPrompt).toHaveBeenCalledWith(
      'Rewrite academically: We made it faster ($&).'
    );
    expect(result.mode).toBe('custom:Academic');
    expect(result.optimized).toBe('Generated output');

    const saved = logger.getRecentEntries(5);
    expect(saved[0].mode).toBe('custom:Academic');
  });

  it('records translate mode label via generate()', async () => {
    const provider = createMockProvider();
    const logger = new HistoryLogger(historyPath);
    const optimizer = new Optimizer(provider, logger);

    const result = await optimizer.generate('你好', 'Translate: "你好"', 'translate');
    expect(result.mode).toBe('translate');
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o');
    expect(logger.getHistory()[0].mode).toBe('translate');
  });

  it('handles corrupted history files safely', () => {
    writeFileSync(historyPath, '{not valid json', 'utf-8');
    const logger = new HistoryLogger(historyPath);
    expect(logger.getHistory()).toEqual([]);

    writeFileSync(historyPath, '{"not":"an array"}', 'utf-8');
    expect(logger.getHistory()).toEqual([]);
  });
});
