import { describe, it, expect, vi, afterEach } from 'vitest';
import { Spinner } from './spinner';

describe('Spinner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('animates on TTY streams and clears the line cleanly on stop()', () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const spinner = new Spinner('Optimizing...', {
      isTTY: true,
      write: (chunk) => {
        writes.push(chunk);
        return true;
      },
    });

    spinner.start();
    vi.advanceTimersByTime(160);
    spinner.stop();
    spinner.stop(); // idempotent

    expect(writes.length).toBeGreaterThanOrEqual(3);
    expect(writes[0]).toContain('Optimizing...');
    expect(writes[writes.length - 1]).toBe('\r\x1b[K');
  });

  it('produces no output on non-TTY streams', () => {
    const writes: string[] = [];
    const spinner = new Spinner('Optimizing...', {
      isTTY: false,
      write: (chunk) => {
        writes.push(chunk);
        return true;
      },
    });

    spinner.start();
    spinner.stop();

    expect(writes).toEqual([]);
  });
});
