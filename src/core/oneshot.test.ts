import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Readable } from 'stream';
import { readStdin, resolveOneShotInput, runOneShot } from './oneshot';
import { Optimizer } from './optimizer';
import { AIProvider, GenerateOptions, OptimizationMode } from '../types';

function createBufferStream(isTTY: boolean) {
  let content = '';
  return {
    isTTY,
    write(chunk: string) {
      content += chunk;
      return true;
    },
    get output() {
      return content;
    },
  };
}

function createStreamingMockProvider(tokens: string[]): AIProvider {
  const joined = tokens.join('');
  return {
    name: 'openai',
    model: 'gpt-4o-mini',
    optimize: vi.fn(async (_text: string, _mode: OptimizationMode, opts?: GenerateOptions) => {
      for (const token of tokens) {
        opts?.onToken?.(token);
      }
      return joined.trim();
    }),
    generateWithPrompt: vi.fn(async (_prompt: string, opts?: GenerateOptions) => {
      for (const token of tokens) {
        opts?.onToken?.(token);
      }
      return joined.trim();
    }),
    isAvailable: vi.fn().mockResolvedValue(true),
  };
}

describe('oneshot', () => {
  let tempDir: string;
  let promptPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cao-oneshot-test-'));
    promptPath = join(tempDir, 'translation-prompt.txt');
    writeFileSync(promptPath, 'Translate: "{text}"', 'utf-8');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('readStdin', () => {
    it('reads UTF-8 chunks from a readable stream and trims whitespace', async () => {
      const text = await readStdin(
        Readable.from([Buffer.from('  你好 '), Buffer.from('world \n')])
      );
      expect(text).toBe('你好 world');
    });
  });

  describe('resolveOneShotInput', () => {
    it('reads from clipboard first when --clip is passed', async () => {
      const input = await resolveOneShotInput({
        textArgs: ['ignored'],
        clip: true,
        isStdinTTY: false,
        readClipboard: () => '  from clipboard  ',
      });
      expect(input).toEqual({ text: 'from clipboard', source: 'clip' });
    });

    it('throws when --clip is passed and clipboard is empty', async () => {
      await expect(
        resolveOneShotInput({
          textArgs: [],
          clip: true,
          readClipboard: () => '   ',
        })
      ).rejects.toThrow(/Clipboard is empty/);
    });

    it('joins positional arguments when provided', async () => {
      const input = await resolveOneShotInput({
        textArgs: ['fix', 'this', 'bug'],
        clip: false,
        isStdinTTY: true,
      });
      expect(input).toEqual({ text: 'fix this bug', source: 'arg' });
    });

    it('reads piped stdin when stdin is not a TTY and no args are provided', async () => {
      const input = await resolveOneShotInput({
        textArgs: [],
        clip: false,
        isStdinTTY: false,
        readStdinFn: async () => 'piped text',
      });
      expect(input).toEqual({ text: 'piped text', source: 'stdin' });
    });

    it('throws on empty piped stdin', async () => {
      await expect(
        resolveOneShotInput({
          textArgs: [],
          clip: false,
          isStdinTTY: false,
          readStdinFn: async () => '  ',
        })
      ).rejects.toThrow(/No input received from stdin/);
    });

    it('returns null for interactive TTY with no args and no --clip', async () => {
      const input = await resolveOneShotInput({
        textArgs: [],
        clip: false,
        isStdinTTY: true,
      });
      expect(input).toBeNull();
    });
  });

  describe('runOneShot', () => {
    it('streams output on TTY, prints status footer to stderr, and auto-copies to clipboard', async () => {
      const provider = createStreamingMockProvider(['Looks ', 'good!']);
      const optimizer = new Optimizer(provider);
      const stdout = createBufferStream(true);
      const stderr = createBufferStream(true);
      const clipboardSpy = vi.fn();

      const result = await runOneShot({
        text: '看起来不错',
        optimizer,
        useYAMLPrompt: false,
        promptPath,
        stdout,
        stderr,
        writeClipboard: clipboardSpy,
      });

      expect(result.mode).toBe('translate');
      expect(result.optimized).toBe('Looks good!');
      expect(stdout.output).toContain('Looks ');
      expect(stdout.output).toContain('good!');
      expect(stderr.output).toContain('openai/gpt-4o-mini');
      expect(stderr.output).toContain('Copied to clipboard');
      expect(clipboardSpy).toHaveBeenCalledWith('Looks good!');
    });

    it('outputs only clean text without ANSI or clipboard side effects when --raw or piped', async () => {
      const provider = createStreamingMockProvider(['Ship it!']);
      const optimizer = new Optimizer(provider);
      const stdout = createBufferStream(false);
      const stderr = createBufferStream(false);
      const clipboardSpy = vi.fn();

      await runOneShot({
        text: '可以发布了',
        optimizer,
        mode: 'concise',
        useYAMLPrompt: false,
        promptPath,
        stdout,
        stderr,
        writeClipboard: clipboardSpy,
      });

      expect(stdout.output).toBe('Ship it!\n');
      expect(stderr.output).toBe('');
      expect(clipboardSpy).not.toHaveBeenCalled();
      expect(provider.optimize).toHaveBeenCalledWith('可以发布了', OptimizationMode.CONCISE);
    });

    it('copies back to clipboard in --clip --raw mode while keeping stdout clean', async () => {
      const provider = createStreamingMockProvider(['Ready for QA tomorrow.']);
      const optimizer = new Optimizer(provider);
      const stdout = createBufferStream(true);
      const stderr = createBufferStream(true);
      const clipboardSpy = vi.fn();

      await runOneShot({
        text: '明天提测',
        optimizer,
        raw: true,
        clip: true,
        useYAMLPrompt: false,
        promptPath,
        stdout,
        stderr,
        writeClipboard: clipboardSpy,
      });

      expect(stdout.output).toBe('Ready for QA tomorrow.\n');
      expect(stderr.output).toBe('');
      expect(clipboardSpy).toHaveBeenCalledWith('Ready for QA tomorrow.');
    });

    it('respects --no-copy even on TTY and supports custom prompt names in --mode', async () => {
      const provider = createStreamingMockProvider(['Per our prior discussion...']);
      const optimizer = new Optimizer(provider);
      const stdout = createBufferStream(true);
      const stderr = createBufferStream(true);
      const clipboardSpy = vi.fn();

      const result = await runOneShot({
        text: 'as discussed',
        optimizer,
        mode: 'academic',
        copy: false,
        stream: false,
        customPrompts: [
          { name: 'Academic', description: 'Formal academic', prompt: 'Academic: {text}' },
        ],
        stdout,
        stderr,
        writeClipboard: clipboardSpy,
      });

      expect(result.mode).toBe('custom:Academic');
      expect(clipboardSpy).not.toHaveBeenCalled();
      expect(provider.generateWithPrompt).toHaveBeenCalledWith('Academic: as discussed');
    });

    it('throws a descriptive error for unknown modes', async () => {
      const provider = createStreamingMockProvider(['unused']);
      const optimizer = new Optimizer(provider);

      await expect(
        runOneShot({
          text: 'hello',
          optimizer,
          mode: 'nonexistent',
          stdout: createBufferStream(false),
          stderr: createBufferStream(false),
        })
      ).rejects.toThrow(/Invalid mode "nonexistent"/);
    });

    it('supports --explain, copying only optimized English and showing explanation on stderr', async () => {
      const tagged = `<optimized>
Could we add a null check here?
</optimized>
<explanation>
- 使用 Could we... 更委婉协作
</explanation>`;
      const provider = createStreamingMockProvider([tagged]);
      const optimizer = new Optimizer(provider);
      const stdout = createBufferStream(true);
      const stderr = createBufferStream(true);
      const clipboardSpy = vi.fn();

      const result = await runOneShot({
        text: 'Please add a null check here.',
        optimizer,
        mode: 'pr',
        explain: true,
        stdout,
        stderr,
        writeClipboard: clipboardSpy,
      });

      expect(result.optimized).toBe('Could we add a null check here?');
      expect(stdout.output).toContain('Could we add a null check here?');
      expect(stderr.output).toContain('Could we...');
      expect(stderr.output).toContain('Changes');
      expect(clipboardSpy).toHaveBeenCalledWith('Could we add a null check here?');
    });

    it('supports --variants with variant selection on TTY and clean output in --raw mode', async () => {
      const tagged = `<variant tone="Casual" label="轻松口语">
Can we ship tomorrow?
</variant>
<variant tone="Neutral" label="自然职场">
Are we on track to release tomorrow?
</variant>
<variant tone="Formal" label="正式专业">
Could you confirm if we are deploying tomorrow?
</variant>`;
      const provider = createStreamingMockProvider([tagged]);
      const optimizer = new Optimizer(provider);
      const stdout = createBufferStream(true);
      const stderr = createBufferStream(true);
      const clipboardSpy = vi.fn();

      const result = await runOneShot({
        text: '明天能上线吗',
        optimizer,
        variants: true,
        stdout,
        stderr,
        stdinIsTTY: true,
        writeClipboard: clipboardSpy,
        pickVariant: async () => 1, // Pick Neutral
      });

      expect(result.mode).toBe('variants');
      expect(result.optimized).toBe('Are we on track to release tomorrow?');
      expect(stdout.output).toContain('[1] Casual');
      expect(stdout.output).toContain('[2] Neutral');
      expect(stdout.output).toContain('[3] Formal');
      expect(clipboardSpy).toHaveBeenCalledWith('Are we on track to release tomorrow?');

      // Raw mode prints all variants cleanly without blocking for input
      const rawOut = createBufferStream(false);
      const rawErr = createBufferStream(false);
      await runOneShot({
        text: '明天能上线吗',
        optimizer,
        variants: true,
        raw: true,
        stdout: rawOut,
        stderr: rawErr,
      });
      expect(rawOut.output).toContain('[1] Casual: Can we ship tomorrow?');
      expect(rawOut.output).toContain('[2] Neutral: Are we on track to release tomorrow?');
      expect(rawOut.output).toContain(
        '[3] Formal: Could you confirm if we are deploying tomorrow?'
      );
      expect(rawErr.output).toBe('');
    });
  });
});
