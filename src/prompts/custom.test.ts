import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CustomPromptLoader } from './custom';
import {
  addCustomPrompt,
  listCustomPrompts,
  removeCustomPrompt,
  showCustomPrompt,
} from './commands';

describe('CustomPromptLoader & prompts CLI commands', () => {
  let tempDir: string;
  let promptsPath: string;
  let loader: CustomPromptLoader;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cao-prompts-test-'));
    promptsPath = join(tempDir, 'prompts.json');
    loader = new CustomPromptLoader(promptsPath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates default example prompts and validates additions/overwrites/removals', () => {
    const defaults = loader.getCustomPrompts();
    expect(defaults.map((p) => p.name)).toEqual(['Academic', 'Friendly']);

    // Add valid prompt
    const saved = loader.addPrompt({
      name: 'Tweet',
      description: 'Short tech post',
      prompt: 'Rewrite as a punchy tweet: {text}',
      hotkey: 't',
    });
    expect(saved.name).toBe('Tweet');
    expect(loader.getPromptByName('tweet')?.hotkey).toBe('t');

    // Reject duplicate name unless overwrite is enabled
    expect(() => loader.addPrompt({ name: 'tweet', description: 'dup', prompt: '{text}' })).toThrow(
      /already exists/
    );

    const updated = loader.addPrompt(
      { name: 'Tweet', description: 'Updated', prompt: 'New template: {text}', hotkey: 't' },
      { overwrite: true }
    );
    expect(updated.description).toBe('Updated');
    expect(loader.getPromptByName('Tweet')?.prompt).toBe('New template: {text}');

    // Reject built-in mode collisions, empty prompt, and hotkey conflicts
    expect(() => loader.addPrompt({ name: 'pr', description: 'PR', prompt: '{text}' })).toThrow(
      /conflicts with a built-in mode/
    );
    expect(() =>
      loader.addPrompt({ name: 'translate', description: 'T', prompt: '{text}' })
    ).toThrow(/conflicts with a built-in mode/);
    expect(() => loader.addPrompt({ name: 'Empty', description: 'E', prompt: '   ' })).toThrow(
      /cannot be empty/
    );
    expect(() =>
      loader.addPrompt({ name: 'MultiKey', description: 'M', prompt: '{text}', hotkey: 'ab' })
    ).toThrow(/single character/);
    expect(() =>
      loader.addPrompt({ name: 'ConflictKey', description: 'C', prompt: '{text}', hotkey: 't' })
    ).toThrow(/already assigned/);

    // Remove works case-insensitively
    expect(loader.removePrompt('TWEET')).toBe(true);
    expect(loader.removePrompt('TWEET')).toBe(false);
    expect(loader.getPromptByName('Tweet')).toBeUndefined();
  });

  it('runs list, show, add (flags & interactive), and remove command handlers', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    listCustomPrompts(loader);
    expect(logSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('Academic');

    const shown = showCustomPrompt(loader, 'academic');
    expect(shown.name).toBe('Academic');
    expect(() => showCustomPrompt(loader, 'missing')).toThrow(/not found/);

    // Non-interactive add via flags
    await addCustomPrompt(loader, {
      name: 'ReleaseNotes',
      description: 'Changelog entry',
      prompt: 'Write a release note bullet for: {text}',
    });
    expect(loader.getPromptByName('ReleaseNotes')).toBeDefined();

    // Interactive add via injected promptUser hook
    await addCustomPrompt(loader, {
      promptUser: async () => ({
        name: 'Standup',
        description: 'Daily standup update',
        prompt: 'Rewrite as a concise standup update: {text}',
        hotkey: 's',
      }),
    });
    expect(loader.getPromptByName('Standup')?.hotkey).toBe('s');

    removeCustomPrompt(loader, 'ReleaseNotes');
    expect(loader.getPromptByName('ReleaseNotes')).toBeUndefined();
    expect(() => removeCustomPrompt(loader, 'NonExistent')).toThrow(/not found/);
  });
});
