import { describe, it, expect } from 'vitest';
import { parseSlashCommand } from './instant-editor';

describe('parseSlashCommand', () => {
  it('parses known REPL slash commands and their arguments', () => {
    expect(parseSlashCommand('/help')).toEqual({ command: 'help', args: '' });
    expect(parseSlashCommand('/m pr')).toEqual({ command: 'm', args: 'pr' });
    expect(parseSlashCommand('  /MODE  commit  ')).toEqual({ command: 'mode', args: 'commit' });
    expect(parseSlashCommand('/v 明天能上线吗')).toEqual({ command: 'v', args: '明天能上线吗' });
    expect(parseSlashCommand('/shorter')).toEqual({ command: 'shorter', args: '' });
    expect(parseSlashCommand('/softer')).toEqual({ command: 'softer', args: '' });
    expect(parseSlashCommand('/why')).toEqual({ command: 'why', args: '' });
    expect(parseSlashCommand('/diff')).toEqual({ command: 'diff', args: '' });
    expect(parseSlashCommand('/2')).toEqual({ command: '2', args: '' });
    expect(parseSlashCommand('/copy 3')).toEqual({ command: 'copy', args: '3' });
    expect(parseSlashCommand('/edit')).toEqual({ command: 'edit', args: '' });
    expect(parseSlashCommand('/star')).toEqual({ command: 'star', args: '' });
    expect(parseSlashCommand('/unstar')).toEqual({ command: 'unstar', args: '' });
    expect(parseSlashCommand('/h starred')).toEqual({ command: 'h', args: 'starred' });
    expect(parseSlashCommand('/history null check')).toEqual({
      command: 'history',
      args: 'null check',
    });
    expect(parseSlashCommand('/q')).toEqual({ command: 'q', args: '' });
  });

  it('ignores non-command paths and regular text so URLs/file paths are never hijacked', () => {
    expect(parseSlashCommand('/api/v1/users')).toBeNull();
    expect(parseSlashCommand('/usr/local/bin/node')).toBeNull();
    expect(parseSlashCommand('/unknown command')).toBeNull();
    expect(parseSlashCommand('normal text')).toBeNull();
  });
});
