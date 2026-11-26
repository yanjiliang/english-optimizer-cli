import { describe, it, expect } from 'vitest';
import { fillTextPlaceholder, buildCustomPrompt, cleanupModelResponse } from './template-utils';
import { getModeLabel, getModePrompts, isOptimizationMode } from './templates';
import { listAvailableModes, normalizeModeName } from './resolver';
import { OptimizationMode } from '../types';

describe('template-utils', () => {
  describe('fillTextPlaceholder', () => {
    it('replaces all {text} occurrences', () => {
      const result = fillTextPlaceholder('A: {text} / B: {text}', 'hello');
      expect(result).toBe('A: hello / B: hello');
    });

    it('preserves regex replacement patterns like $&, $1, and $` literally', () => {
      const userText = 'echo "$&" "$1" "$`" "$\'" "$$"';
      const result = fillTextPlaceholder('Translate:\n"{text}"', userText);
      expect(result).toBe(`Translate:\n"${userText}"`);
    });
  });

  describe('buildCustomPrompt', () => {
    it('substitutes {text} when present in instruction', () => {
      const result = buildCustomPrompt('Make this casual: {text}', 'cost is $&');
      expect(result).toBe('Make this casual: cost is $&');
    });

    it('appends the original text when {text} is absent', () => {
      const result = buildCustomPrompt('Rewrite in academic style.', 'We fixed the bug.');
      expect(result).toContain('Rewrite in academic style.');
      expect(result).toContain('"We fixed the bug."');
      expect(result).toContain('Rewritten text:');
    });
  });

  describe('cleanupModelResponse', () => {
    it('strips known prefixes and wrapping quotes', () => {
      expect(cleanupModelResponse('  "Hello world."  ', true)).toBe('Hello world.');
      expect(cleanupModelResponse('Rewritten text: "Hello world."', true)).toBe('Hello world.');
      expect(cleanupModelResponse('Corrected text: Fixed it.', true)).toBe('Fixed it.');
      expect(cleanupModelResponse('Optimized text: Cleaner.', false)).toBe(
        'Optimized text: Cleaner.'
      );
    });

    it('does not corrupt a single quote character', () => {
      expect(cleanupModelResponse('"', true)).toBe('"');
    });
  });

  describe('mode helpers', () => {
    it('validates built-in optimization modes including developer presets', () => {
      expect(isOptimizationMode('professional')).toBe(true);
      expect(isOptimizationMode('senior_developer')).toBe(true);
      expect(isOptimizationMode('slack')).toBe(true);
      expect(isOptimizationMode('pr')).toBe(true);
      expect(isOptimizationMode('commit')).toBe(true);
      expect(isOptimizationMode('email')).toBe(true);
      expect(isOptimizationMode('unknown')).toBe(false);
    });

    it('builds separated system and user prompts for developer presets', () => {
      const pr = getModePrompts(OptimizationMode.PR, '这里加个判空');
      expect(pr.systemPrompt).toContain('Pull Request');
      expect(pr.systemPrompt).toContain('NEVER answer');
      expect(pr.userPrompt).toContain('这里加个判空');

      const commit = getModePrompts(OptimizationMode.COMMIT, '修复登录跳转');
      expect(commit.systemPrompt).toContain('Conventional Commit');
      expect(commit.userPrompt).toContain('修复登录跳转');
    });

    it('formats display labels and resolves mode names including custom prompts', () => {
      expect(getModeLabel(OptimizationMode.CONCISE)).toBe('Concise');
      expect(getModeLabel(OptimizationMode.PR)).toBe('PR / Code Review');
      expect(getModeLabel('translate')).toBe('Translate & Optimize');
      expect(getModeLabel('variants')).toBe('Tone Variants');
      expect(getModeLabel('refine:shorter')).toBe('Refine (shorter)');
      expect(getModeLabel('custom:Academic')).toBe('Custom (Academic)');
      expect(getModeLabel('other')).toBe('other');

      const custom = [{ name: 'Academic', description: 'Academic', prompt: '{text}' }];
      expect(normalizeModeName(undefined, custom)).toBe('translate');
      expect(normalizeModeName('PR', custom)).toBe('pr');
      expect(normalizeModeName('academic', custom)).toBe('Academic');
      expect(() => normalizeModeName('bad-mode', custom)).toThrow(/Invalid mode/);

      const listed = listAvailableModes(custom);
      expect(listed.some((m) => m.key === 'pr')).toBe(true);
      expect(listed.some((m) => m.key === 'Academic' && m.custom)).toBe(true);
    });
  });
});
