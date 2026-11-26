import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { exportHistoryToJson, exportHistoryToMarkdown, HistoryLogger } from './logger';
import { runHistoryCommand } from './commands';
import { OptimizationMode } from '../types';

describe('HistoryLogger & history phrasebook commands', () => {
  let tempDir: string;
  let historyPath: string;
  let logger: HistoryLogger;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cao-history-test-'));
    historyPath = join(tempDir, 'history.json');
    logger = new HistoryLogger(historyPath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('queries by search text, starred status, mode, and limit', () => {
    const e1 = logger.addEntry({
      original: '这里会有空指针',
      optimized: 'Could we add a null check here?',
      mode: OptimizationMode.PR,
      timestamp: new Date('2026-01-01T10:00:00Z'),
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    const e2 = logger.addEntry({
      original: '修复登录跳转',
      optimized: 'fix(auth): redirect on session expiry',
      mode: OptimizationMode.COMMIT,
      timestamp: new Date('2026-01-02T10:00:00Z'),
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    logger.setStarred(e1.id, true);

    expect(logger.queryHistory({ starredOnly: true }).map((e) => e.id)).toEqual([e1.id]);
    expect(logger.queryHistory({ search: 'null check' }).map((e) => e.id)).toEqual([e1.id]);
    expect(logger.queryHistory({ mode: 'commit' }).map((e) => e.id)).toEqual([e2.id]);
    expect(logger.queryHistory({ limit: 1 }).map((e) => e.id)).toEqual([e2.id]);

    // Resolve by 1-based index or UUID prefix
    const all = logger.getHistory();
    expect(logger.resolveEntry('1', all)?.id).toBe(e2.id);
    expect(logger.resolveEntry(e1.id.slice(0, 8), all)?.id).toBe(e1.id);
  });

  it('preserves starred entries even when more than 100 unstarred entries are added', () => {
    const starred = logger.addEntry({
      original: 'Important idiom',
      optimized: 'Let us circle back on this.',
      mode: OptimizationMode.SLACK,
      timestamp: new Date('2026-01-01T00:00:00Z'),
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    logger.setStarred(starred.id, true);

    for (let i = 0; i < 105; i++) {
      logger.addEntry({
        original: `orig ${i}`,
        optimized: `opt ${i}`,
        mode: 'translate',
        timestamp: new Date(),
        provider: 'openai',
        model: 'gpt-4o-mini',
      });
    }

    const all = logger.getHistory();
    expect(all.some((e) => e.id === starred.id && e.starred)).toBe(true);
    expect(all.filter((e) => !e.starred)).toHaveLength(100);
  });

  it('supports clearHistory with keepStarred option and exports Markdown/JSON', () => {
    const e1 = logger.addEntry({
      original: 'Keep me',
      optimized: 'Please keep this expression.',
      mode: OptimizationMode.EMAIL,
      timestamp: new Date('2026-02-01T12:00:00Z'),
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    logger.setStarred(e1.id, true);
    logger.addEntry({
      original: 'Drop me',
      optimized: 'Temporary entry.',
      mode: 'translate',
      timestamp: new Date('2026-02-02T12:00:00Z'),
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    const removed = logger.clearHistory({ keepStarred: true });
    expect(removed).toBe(1);
    expect(logger.getHistory()).toHaveLength(1);
    expect(logger.getHistory()[0].id).toBe(e1.id);

    const md = exportHistoryToMarkdown(logger.getHistory());
    expect(md).toContain('# English Optimizer Phrasebook');
    expect(md).toContain('⭐ Workplace Email');
    expect(md).toContain('> Please keep this expression.');

    const json = exportHistoryToJson(logger.getHistory());
    expect(JSON.parse(json)).toHaveLength(1);
  });

  it('executes CLI history commands without appending ellipsis to short texts', () => {
    logger.addEntry({
      original: '你好',
      optimized: 'Hello!',
      mode: 'translate',
      timestamp: new Date('2026-03-01T00:00:00Z'),
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    logger.addEntry({
      original: '加个判空',
      optimized: 'Could we add a null check here?',
      mode: OptimizationMode.PR,
      timestamp: new Date('2026-03-02T00:00:00Z'),
      provider: 'openai',
      model: 'gpt-4o-mini',
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // List: short text must NOT have "..." appended
    runHistoryCommand(logger, {});
    const listOutput = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(listOutput).toContain('Hello!');
    expect(listOutput).not.toContain('Hello!...');
    expect(listOutput).not.toContain('你好...');

    // Star #1, then copy #1 from --starred
    runHistoryCommand(logger, { star: '1' });
    const clipboardSpy = vi.fn();
    runHistoryCommand(logger, { starred: true, copy: '1' }, { writeClipboard: clipboardSpy });
    expect(clipboardSpy).toHaveBeenCalledWith('Could we add a null check here?');

    // Export starred entries to Markdown file
    const mdFile = join(tempDir, 'phrasebook.md');
    runHistoryCommand(logger, { starred: true, export: mdFile });
    const exported = readFileSync(mdFile, 'utf-8');
    expect(exported).toContain('Could we add a null check here?');
    expect(exported).not.toContain('Hello!');

    // Export to stdout via "-"
    let stdoutBuf = '';
    runHistoryCommand(
      logger,
      { export: '-' },
      {
        stdout: {
          write: (chunk: string) => {
            stdoutBuf += chunk;
            return true;
          },
        },
      }
    );
    expect(stdoutBuf).toContain('Hello!');
    expect(stdoutBuf).toContain('Could we add a null check here?');

    // Invalid --number and missing entry throw descriptive errors
    expect(() => runHistoryCommand(logger, { number: 'abc' })).toThrow(/Invalid --number/);
    expect(() => runHistoryCommand(logger, { copy: '99' })).toThrow(/not found/);
  });
});
