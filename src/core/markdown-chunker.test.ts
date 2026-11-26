import { describe, it, expect } from 'vitest';
import {
  isMarkdownFile,
  maskInlineCode,
  reassembleSegments,
  restoreInlineCode,
  splitDocumentIntoSegments,
} from './markdown-chunker';

describe('markdown-chunker', () => {
  it('detects Markdown files by extension or Markdown syntax', () => {
    expect(isMarkdownFile('README.md')).toBe(true);
    expect(isMarkdownFile('docs/guide.mdx')).toBe(true);
    expect(isMarkdownFile('notes.txt', 'plain text')).toBe(false);
    expect(isMarkdownFile('NOTES', '---\ntitle: Hello\n---\n\nBody')).toBe(true);
    expect(isMarkdownFile('NOTES', 'Intro\n\n```ts\nconst x = 1;\n```\n')).toBe(true);
  });

  it('protects YAML frontmatter, fenced code blocks, HTML comments, and horizontal rules verbatim', () => {
    const doc = [
      '---',
      'title: My Guide',
      'tags:',
      '  - cli',
      '---',
      '',
      '# Introduction',
      '',
      'Run `npm test` before submitting.',
      '',
      '```bash',
      'cao "你好世界"',
      '```',
      '',
      '<!-- internal note',
      'do not edit -->',
      '',
      '---',
      '',
      '~~~python',
      'print("hello")',
      '~~~',
      '',
      'Final paragraph.',
      '',
    ].join('\n');

    const split = splitDocumentIntoSegments(doc, { filePath: 'guide.md' });
    expect(split.isMarkdown).toBe(true);

    const proseSegments = split.segments.filter((s) => s.type === 'prose');
    expect(proseSegments).toHaveLength(2);
    expect(proseSegments[0].text).toBe('# Introduction\n\nRun `npm test` before submitting.');
    expect(proseSegments[1].text).toBe('Final paragraph.');

    const protectedText = split.segments
      .filter((s) => s.type === 'protected')
      .map((s) => s.text)
      .join('\n');
    expect(protectedText).toContain('title: My Guide');
    expect(protectedText).toContain('cao "你好世界"');
    expect(protectedText).toContain('<!-- internal note');
    expect(protectedText).toContain('print("hello")');

    // Lossless round-trip
    expect(reassembleSegments(split.segments, split.eol)).toBe(doc);
  });

  it('does not misclassify horizontal rules around prose as YAML frontmatter', () => {
    const doc = ['---', '# Just a heading', '---', '', 'Body text'].join('\n');
    const split = splitDocumentIntoSegments(doc, { filePath: 'note.md' });
    const prose = split.segments.filter((s) => s.type === 'prose').map((s) => s.text);
    expect(prose).toEqual(['# Just a heading', 'Body text']);
    expect(reassembleSegments(split.segments, split.eol)).toBe(doc);
  });

  it('splits large documents into paragraph/line chunks under maxChunkChars and preserves CRLF', () => {
    const p1 = 'Paragraph one. '.repeat(20).trim();
    const p2 = 'Paragraph two. '.repeat(20).trim();
    const p3 = 'Paragraph three. '.repeat(20).trim();
    const doc = `${p1}\r\n\r\n${p2}\r\n\r\n${p3}\r\n`;

    const split = splitDocumentIntoSegments(doc, {
      filePath: 'long.txt',
      maxChunkChars: 350,
    });
    expect(split.eol).toBe('\r\n');
    expect(split.proseChunkCount).toBe(3);
    expect(reassembleSegments(split.segments, split.eol)).toBe(doc);
  });

  it('splits a single oversized prose block on line boundaries', () => {
    const lines = Array.from(
      { length: 12 },
      (_, idx) => `- Bullet item number ${idx + 1} with text`
    );
    const doc = lines.join('\n');
    const split = splitDocumentIntoSegments(doc, {
      filePath: 'list.md',
      maxChunkChars: 200,
    });
    expect(split.proseChunkCount).toBeGreaterThan(1);
    expect(reassembleSegments(split.segments, split.eol)).toBe(doc);
  });

  it('masks and restores inline code spans including multi-backtick spans and regex special chars', () => {
    const input = 'Use `npm run $1 && echo $$` and ``echo `hello` $&`` with `flag`.';
    const { masked, placeholders } = maskInlineCode(input);

    expect(placeholders.size).toBe(3);
    expect(masked).toBe('Use @@CODE_0@@ and @@CODE_1@@ with @@CODE_2@@.');

    // Simulate model wrapping one placeholder in extra backticks and rewriting prose
    const modelOutput = 'Please run `@@CODE_0@@` and @@CODE_1@@ alongside @@CODE_2@@.';
    const { restored, missing } = restoreInlineCode(modelOutput, placeholders);

    expect(missing).toEqual([]);
    expect(restored).toBe(
      'Please run `npm run $1 && echo $$` and ``echo `hello` $&`` alongside `flag`.'
    );
  });

  it('reports missing placeholders if the model drops one and keeps unmatched backticks literal', () => {
    const { masked, placeholders } = maskInlineCode('Keep `foo` and stray ` backtick.');
    expect(masked).toBe('Keep @@CODE_0@@ and stray ` backtick.');
    expect(placeholders.size).toBe(1);

    const { missing } = restoreInlineCode('Model dropped the code token.', placeholders);
    expect(missing).toEqual(['@@CODE_0@@']);
  });
});
