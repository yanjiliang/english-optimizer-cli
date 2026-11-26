import { describe, it, expect } from 'vitest';
import {
  buildExplainPrompts,
  buildRefinePrompts,
  buildVariantsPrompts,
  buildWhyPrompts,
  parseExplainResponse,
  parseVariantsResponse,
} from './structured';

describe('structured prompts and parsers', () => {
  describe('parseExplainResponse', () => {
    it('extracts optimized text and Chinese explanation from XML tags', () => {
      const raw = `<optimized>
"Could we add a null check here?"
</optimized>
<explanation>
- 使用 Could we... 语气更委婉协作，适合 Code Review
- null check 比 check if empty 更地道
</explanation>`;

      const parsed = parseExplainResponse(raw);
      expect(parsed.optimized).toBe('Could we add a null check here?');
      expect(parsed.explanation).toContain('Could we...');
      expect(parsed.explanation).toContain('null check');
    });

    it('falls back cleanly when a small model omits tags', () => {
      const parsed = parseExplainResponse('Rewritten text: "Looks good to me!"');
      expect(parsed.optimized).toBe('Looks good to me!');
      expect(parsed.explanation).toBe('');
    });
  });

  describe('parseVariantsResponse', () => {
    it('parses tagged Casual / Neutral / Formal variants', () => {
      const raw = `<variant tone="Casual" label="轻松口语 (Slack/Teams)">
Can we ship tomorrow?
</variant>
<variant tone="Neutral" label="自然职场 (日常沟通)">
Are we on track to release tomorrow?
</variant>
<variant tone="Formal" label="正式专业 (邮件/文档)">
Could you confirm whether we are scheduled to deploy tomorrow?
</variant>`;

      const variants = parseVariantsResponse(raw);
      expect(variants).toHaveLength(3);
      expect(variants[0]).toEqual({
        tone: 'Casual',
        label: '轻松口语 (Slack/Teams)',
        text: 'Can we ship tomorrow?',
      });
      expect(variants[1].tone).toBe('Neutral');
      expect(variants[2].tone).toBe('Formal');
    });

    it('falls back to numbered list output when tags are omitted', () => {
      const raw = [
        '1. **Casual**: Looks great!',
        '2. **Neutral**: This looks good to me.',
        '3. **Formal**: Everything appears to be in order.',
      ].join('\n');

      const variants = parseVariantsResponse(raw);
      expect(variants).toHaveLength(3);
      expect(variants[0]).toEqual({ tone: 'Casual', label: 'Casual', text: 'Looks great!' });
      expect(variants[2].text).toBe('Everything appears to be in order.');
    });

    it('falls back to a single variant when plain text is returned', () => {
      const variants = parseVariantsResponse('"Just a single version."');
      expect(variants).toEqual([
        { tone: 'Optimized', label: 'Optimized', text: 'Just a single version.' },
      ]);
    });
  });

  describe('prompt builders', () => {
    it('builds separated system and user prompts for explain, variants, why, and refine', () => {
      const explain = buildExplainPrompts('Base rules', 'it is works');
      expect(explain.systemPrompt).toContain('<optimized>');
      expect(explain.userPrompt).toContain('it is works');

      const variants = buildVariantsPrompts('明天上线', 'Slack / Team Chat');
      expect(variants.systemPrompt).toContain('Slack / Team Chat');
      expect(variants.systemPrompt).toContain('<variant');
      expect(variants.userPrompt).toContain('明天上线');

      const why = buildWhyPrompts("it's works", 'It works!');
      expect(why.userPrompt).toContain("it's works");
      expect(why.userPrompt).toContain('It works!');

      const refine = buildRefinePrompts('Please fix this immediately.', 'softer', '马上改一下');
      expect(refine.systemPrompt).toContain('warmer');
      expect(refine.userPrompt).toContain('Please fix this immediately.');
      expect(refine.userPrompt).toContain('马上改一下');
    });
  });
});
