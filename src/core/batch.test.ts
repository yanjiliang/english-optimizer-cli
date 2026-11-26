import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BatchProcessor, getOutputPath } from './batch';
import { Optimizer } from './optimizer';
import { HistoryLogger } from '../history/logger';
import { AIProvider, OptimizationMode } from '../types';

describe('batch processor', () => {
  describe('getOutputPath', () => {
    it('inserts suffix before the file extension', () => {
      expect(getOutputPath('notes.md', '.optimized')).toBe('notes.optimized.md');
      expect(getOutputPath('/tmp/doc.v1.txt', '.en')).toBe('/tmp/doc.v1.en.txt');
    });

    it('appends suffix when file has no extension so original is not overwritten', () => {
      expect(getOutputPath('README', '.optimized')).toBe('README.optimized');
      expect(getOutputPath('/tmp/Makefile', '')).toBe('/tmp/Makefile.optimized');
    });
  });

  describe('BatchProcessor.processBatch', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'cao-batch-test-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('writes suffixed files or updates in-place', async () => {
      const provider: AIProvider = {
        name: 'openai',
        model: 'gpt-4o',
        optimize: vi.fn().mockResolvedValue('Improved text'),
        generateWithPrompt: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(true),
      };
      const optimizer = new Optimizer(provider);
      const processor = new BatchProcessor(optimizer);

      const fileWithExt = join(tempDir, 'draft.md');
      const fileNoExt = join(tempDir, 'NOTES');
      writeFileSync(fileWithExt, 'original draft', 'utf-8');
      writeFileSync(fileNoExt, 'original notes', 'utf-8');

      vi.spyOn(console, 'log').mockImplementation(() => {});
      await processor.processBatch({
        files: [fileWithExt, fileNoExt],
        mode: OptimizationMode.CONCISE,
        inPlace: false,
        outputSuffix: '.en',
      });

      expect(readFileSync(join(tempDir, 'draft.en.md'), 'utf-8')).toBe('Improved text');
      expect(readFileSync(join(tempDir, 'NOTES.en'), 'utf-8')).toBe('Improved text');
      expect(readFileSync(fileNoExt, 'utf-8')).toBe('original notes');

      const summary = await processor.processBatch({
        files: [fileWithExt],
        mode: OptimizationMode.PROFESSIONAL,
        inPlace: true,
      });
      expect(summary.failed).toBe(0);
      expect(summary.succeeded).toBe(1);
      expect(readFileSync(fileWithExt, 'utf-8')).toBe('Improved text');
      vi.restoreAllMocks();
    });

    it('preserves YAML frontmatter, fenced code blocks, and inline code across Markdown chunks', async () => {
      const seenChunks: string[] = [];
      const provider: AIProvider = {
        name: 'openai',
        model: 'gpt-4o-mini',
        optimize: vi.fn(async (text: string) => {
          seenChunks.push(text);
          return text.replace(/bad english/g, 'polished English');
        }),
        generateWithPrompt: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(true),
      };
      const optimizer = new Optimizer(provider);
      const processor = new BatchProcessor(optimizer);

      const mdContent = [
        '---',
        'title: bad english title in frontmatter',
        '---',
        '',
        '# Intro',
        '',
        'This is bad english with `bad english inline` code.',
        '',
        '```ts',
        'const msg = "bad english inside code fence";',
        '```',
        '',
        'Another bad english paragraph.',
        '',
      ].join('\n');

      const mdFile = join(tempDir, 'doc.md');
      writeFileSync(mdFile, mdContent, 'utf-8');

      vi.spyOn(console, 'log').mockImplementation(() => {});
      const summary = await processor.processBatch({
        files: [mdFile],
        mode: OptimizationMode.PROFESSIONAL,
        inPlace: false,
        outputSuffix: '.out',
      });

      expect(summary.failed).toBe(0);
      expect(seenChunks).toHaveLength(2);
      expect(seenChunks[0]).toContain('@@CODE_0@@');
      expect(seenChunks[0]).not.toContain('frontmatter');

      const out = readFileSync(join(tempDir, 'doc.out.md'), 'utf-8');
      expect(out).toContain('title: bad english title in frontmatter');
      expect(out).toContain('This is polished English with `bad english inline` code.');
      expect(out).toContain('const msg = "bad english inside code fence";');
      expect(out).toContain('Another polished English paragraph.');
      vi.restoreAllMocks();
    });

    it('previews diffs in --dry-run without writing files or recording history, and reports failures', async () => {
      const historyLogger = new HistoryLogger(join(tempDir, 'history.json'));
      const provider: AIProvider = {
        name: 'openai',
        model: 'gpt-4o-mini',
        optimize: vi.fn().mockResolvedValue('Clean output'),
        generateWithPrompt: vi.fn().mockResolvedValue('Custom output'),
        isAvailable: vi.fn().mockResolvedValue(true),
      };
      const optimizer = new Optimizer(provider, historyLogger);
      const processor = new BatchProcessor(optimizer);

      const goodFile = join(tempDir, 'good.txt');
      const missingFile = join(tempDir, 'missing.txt');
      writeFileSync(goodFile, 'rough input', 'utf-8');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const drySummary = await processor.processBatch({
        files: [goodFile, missingFile],
        mode: 'Academic',
        inPlace: false,
        dryRun: true,
        customPrompts: [{ name: 'Academic', description: 'Academic', prompt: 'Rewrite: {text}' }],
      });

      expect(drySummary.total).toBe(2);
      expect(drySummary.succeeded).toBe(1);
      expect(drySummary.failed).toBe(1);
      expect(drySummary.results[0].status).toBe('dry-run');
      expect(drySummary.results[1].status).toBe('failed');
      expect(existsSync(join(tempDir, 'good.optimized.txt'))).toBe(false);
      expect(readFileSync(goodFile, 'utf-8')).toBe('rough input');
      expect(historyLogger.getHistory()).toHaveLength(0);
      expect(logSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('Dry run');
      expect(errSpy).toHaveBeenCalled();

      vi.restoreAllMocks();
    });
  });
});
