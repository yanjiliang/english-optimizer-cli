import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  displayError,
  displayExplanation,
  displayHelp,
  displayHistoryEntry,
  displayModeInfo,
  displayOptimization,
  displayVariants,
  formatLineDiff,
  formatWordDiff,
  isPredominantlyEnglish,
  shouldShowWordDiff,
  truncateText,
} from './display';
import { OptimizationMode } from '../types';

describe('Display Utils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('displays configured hotkeys and custom prompt hotkeys', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    displayHelp({ professional: 'p', quit: 'q' }, [
      { name: 'Academic', description: 'Academic', prompt: '...', hotkey: 'a' },
    ]);

    const output = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('p - Professional tone');
    expect(output).toContain('q - Quit');
    expect(output).toContain('a - Academic (custom)');
    expect(output).toContain('Ctrl+C - Quit');
  });

  it('displays history entries for built-in, translate, and custom modes', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    for (const mode of [OptimizationMode.GRAMMAR, 'translate', 'custom:Academic']) {
      displayHistoryEntry({
        id: '123',
        original: 'orig',
        optimized: 'opt',
        mode,
        timestamp: new Date('2026-01-01T00:00:00Z'),
      });
    }

    const output = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Grammar');
    expect(output).toContain('Translate & Optimize');
    expect(output).toContain('Custom (Academic)');
  });

  it('displays mode info, optimization comparison, and writes errors to stderr', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    displayModeInfo(OptimizationMode.SENIOR_DEVELOPER);
    displayOptimization('before', 'after');
    displayError(new Error('boom'));
    displayError('plain error');

    const stdoutOutput = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const stderrOutput = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(stdoutOutput).toContain('Senior Developer Mode');
    expect(stdoutOutput).toContain('before');
    expect(stdoutOutput).toContain('after');
    expect(stdoutOutput).not.toContain('boom');
    expect(stderrOutput).toContain('boom');
    expect(stderrOutput).toContain('plain error');
  });

  it('detects predominantly English edits and formats word-level diff, variants, and explanations', () => {
    expect(isPredominantlyEnglish("it's works very good")).toBe(true);
    expect(isPredominantlyEnglish('这个需求明天提测')).toBe(false);
    expect(shouldShowWordDiff("it's works", 'It works!')).toBe(true);
    expect(shouldShowWordDiff('Same text', 'Same text')).toBe(false);
    expect(shouldShowWordDiff('明天提测', 'Ready for QA tomorrow.')).toBe(false);

    const diffStr = formatWordDiff('I think it is works', 'It works');
    expect(diffStr).toContain('works');
    expect(diffStr).toContain('It');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    displayExplanation('- 更地道');
    displayVariants([
      { tone: 'Casual', label: '轻松口语', text: 'Looks good!' },
      { tone: 'Formal', label: '正式', text: 'This looks satisfactory.' },
    ]);

    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('更地道');
    expect(output).toContain('[1] Casual');
    expect(output).toContain('Looks good!');
    expect(output).toContain('[2] Formal');

    // truncateText only appends ellipsis when text actually exceeds maxLength
    expect(truncateText('short', 100)).toBe('short');
    expect(truncateText('1234567890', 6)).toBe('12345…');

    // formatLineDiff prefixes every line in multi-line diffs
    const lineDiff = formatLineDiff('line1\nline2\n', 'line1\nupdated2\nadded3\n');
    expect(lineDiff).toContain('- line2');
    expect(lineDiff).toContain('+ updated2');
    expect(lineDiff).toContain('+ added3');
  });
});
