import { extname } from 'path';

export const DEFAULT_MAX_CHUNK_CHARS = 2500;

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx', '.mkd', '.mdown']);

export interface DocumentSegment {
  type: 'prose' | 'protected' | 'separator';
  text: string;
}

export interface DocumentSplitResult {
  segments: DocumentSegment[];
  eol: '\n' | '\r\n';
  isMarkdown: boolean;
  proseChunkCount: number;
}

export interface SplitDocumentOptions {
  /** Maximum target characters per prose chunk (default: 2500). */
  maxChunkChars?: number;
  /** Override auto-detection of Markdown protection (frontmatter, code blocks, dividers). */
  preserveMarkdown?: boolean;
  /** File path used to auto-detect Markdown extensions. */
  filePath?: string;
}

export interface MaskedInlineCode {
  masked: string;
  placeholders: Map<string, string>;
}

export interface RestoredInlineCode {
  restored: string;
  missing: string[];
}

function looksLikeYamlFrontmatter(innerLines: string[]): boolean {
  let hasKey = false;
  for (const line of innerLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    if (/^\s+/.test(line)) {
      continue;
    }
    if (/^[A-Za-z0-9_.-]+\s*:/.test(line)) {
      hasKey = true;
      continue;
    }
    return false;
  }
  return hasKey;
}

function matchOpeningFence(lineText: string): { char: '`' | '~'; length: number } | null {
  const match = lineText.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) {
    return null;
  }
  const fence = match[1];
  const infoString = match[2];
  const char = fence[0] as '`' | '~';
  // CommonMark: backtick fence info strings cannot contain backticks
  if (char === '`' && infoString.includes('`')) {
    return null;
  }
  return { char, length: fence.length };
}

function isClosingFence(lineText: string, char: '`' | '~', minLength: number): boolean {
  const match = lineText.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
  if (!match) {
    return false;
  }
  return match[1][0] === char && match[1].length >= minLength;
}

function isHorizontalRule(lineText: string): boolean {
  return /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(lineText);
}

/** Detect whether a file should use Markdown-safe protection. */
export function isMarkdownFile(filePath?: string, content?: string): boolean {
  if (filePath && MARKDOWN_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    return true;
  }
  if (!content) {
    return false;
  }
  const normalized = content.replace(/\r\n/g, '\n');
  if (/^---\n[\s\S]+?\n---(?:\n|$)/.test(normalized)) {
    const firstEnd = normalized.indexOf('\n---', 3);
    if (firstEnd !== -1) {
      const inner = normalized.slice(4, firstEnd).split('\n');
      if (looksLikeYamlFrontmatter(inner)) {
        return true;
      }
    }
  }
  return /^\s{0,3}(?:`{3,}|~{3,})/m.test(normalized);
}

function pushSegment(segments: DocumentSegment[], segment: DocumentSegment): void {
  if (!segment.text) {
    return;
  }
  const prev = segments[segments.length - 1];
  if (prev && prev.type === 'separator' && segment.type === 'separator') {
    prev.text += segment.text;
    return;
  }
  segments.push(segment);
}

function splitOversizedProse(text: string, maxChunkChars: number): DocumentSegment[] {
  if (text.length <= maxChunkChars) {
    return [{ type: 'prose', text }];
  }

  const lines = text.split('\n');
  const result: DocumentSegment[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const line of lines) {
    const addedLen = current.length === 0 ? line.length : line.length + 1;
    if (current.length > 0 && currentLen + addedLen > maxChunkChars) {
      result.push({ type: 'prose', text: current.join('\n') });
      result.push({ type: 'separator', text: '\n' });
      current = [line];
      currentLen = line.length;
    } else {
      current.push(line);
      currentLen += addedLen;
    }
  }

  if (current.length > 0) {
    result.push({ type: 'prose', text: current.join('\n') });
  }

  return result;
}

/**
 * Merge adjacent prose segments separated only by blank-line separators into
 * larger chunks up to `maxChunkChars` so we minimize API calls while keeping
 * protected blocks (frontmatter, code blocks, HTML comments, dividers) intact.
 */
function mergeProseSegments(segments: DocumentSegment[], maxChunkChars: number): DocumentSegment[] {
  const expanded: DocumentSegment[] = [];
  for (const seg of segments) {
    if (seg.type === 'prose' && seg.text.length > maxChunkChars) {
      expanded.push(...splitOversizedProse(seg.text, maxChunkChars));
    } else {
      expanded.push(seg);
    }
  }

  const merged: DocumentSegment[] = [];
  let i = 0;
  while (i < expanded.length) {
    const seg = expanded[i];
    if (seg.type !== 'prose') {
      merged.push(seg);
      i++;
      continue;
    }

    let combined = seg.text;
    let next = i + 1;
    while (
      next + 1 < expanded.length &&
      expanded[next].type === 'separator' &&
      expanded[next + 1].type === 'prose'
    ) {
      const candidateLen =
        combined.length + expanded[next].text.length + expanded[next + 1].text.length;
      if (candidateLen > maxChunkChars) {
        break;
      }
      combined += expanded[next].text + expanded[next + 1].text;
      next += 2;
    }

    merged.push({ type: 'prose', text: combined });
    i = next;
  }

  return merged;
}

/**
 * Split a document into protected blocks, separators, and prose chunks ready for
 * incremental optimization. Reassembling the unmodified segments reproduces the
 * original input byte-for-byte.
 */
export function splitDocumentIntoSegments(
  content: string,
  options: SplitDocumentOptions = {}
): DocumentSplitResult {
  const eol: '\n' | '\r\n' = content.includes('\r\n') ? '\r\n' : '\n';
  const normalized = eol === '\r\n' ? content.replace(/\r\n/g, '\n') : content;
  const maxChunkChars = Math.max(200, options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS);
  const preserveMarkdown = options.preserveMarkdown ?? isMarkdownFile(options.filePath, normalized);

  if (!normalized) {
    return { segments: [], eol, isMarkdown: preserveMarkdown, proseChunkCount: 0 };
  }

  const rawLines = normalized.match(/[^\n]*\n|[^\n]+/g) ?? [];
  const lineTexts = rawLines.map((line) => (line.endsWith('\n') ? line.slice(0, -1) : line));
  const rawSegments: DocumentSegment[] = [];

  let i = 0;

  // 1. Protect YAML frontmatter at start of document
  if (preserveMarkdown && lineTexts[0] === '---') {
    for (let j = 1; j < rawLines.length; j++) {
      if (lineTexts[j] === '---' || lineTexts[j] === '...') {
        if (looksLikeYamlFrontmatter(lineTexts.slice(1, j))) {
          pushSegment(rawSegments, {
            type: 'protected',
            text: rawLines.slice(0, j + 1).join(''),
          });
          i = j + 1;
        }
        break;
      }
    }
  }

  // 2. Walk remaining lines
  while (i < rawLines.length) {
    const lineText = lineTexts[i];

    // Blank line separator
    if (/^\s*$/.test(lineText)) {
      let end = i + 1;
      while (end < rawLines.length && /^\s*$/.test(lineTexts[end])) {
        end++;
      }
      pushSegment(rawSegments, {
        type: 'separator',
        text: rawLines.slice(i, end).join(''),
      });
      i = end;
      continue;
    }

    // Fenced code block (``` or ~~~)
    if (preserveMarkdown) {
      const fence = matchOpeningFence(lineText);
      if (fence) {
        let end = i + 1;
        while (end < rawLines.length && !isClosingFence(lineTexts[end], fence.char, fence.length)) {
          end++;
        }
        const closeExclusive = end < rawLines.length ? end + 1 : rawLines.length;
        pushSegment(rawSegments, {
          type: 'protected',
          text: rawLines.slice(i, closeExclusive).join(''),
        });
        i = closeExclusive;
        continue;
      }

      // Standalone HTML comment block
      if (/^\s*<!--/.test(lineText)) {
        let end = i;
        while (end < rawLines.length && !lineTexts[end].includes('-->')) {
          end++;
        }
        const closeExclusive = end < rawLines.length ? end + 1 : rawLines.length;
        pushSegment(rawSegments, {
          type: 'protected',
          text: rawLines.slice(i, closeExclusive).join(''),
        });
        i = closeExclusive;
        continue;
      }

      // Horizontal rule divider
      if (isHorizontalRule(lineText)) {
        pushSegment(rawSegments, {
          type: 'protected',
          text: rawLines[i],
        });
        i++;
        continue;
      }
    }

    // Prose block: collect consecutive prose lines
    let end = i + 1;
    while (end < rawLines.length) {
      const nextText = lineTexts[end];
      if (/^\s*$/.test(nextText)) {
        break;
      }
      if (
        preserveMarkdown &&
        (matchOpeningFence(nextText) || /^\s*<!--/.test(nextText) || isHorizontalRule(nextText))
      ) {
        break;
      }
      end++;
    }

    const joined = rawLines.slice(i, end).join('');
    if (joined.endsWith('\n')) {
      pushSegment(rawSegments, { type: 'prose', text: joined.slice(0, -1) });
      pushSegment(rawSegments, { type: 'separator', text: '\n' });
    } else {
      pushSegment(rawSegments, { type: 'prose', text: joined });
    }
    i = end;
  }

  const merged = mergeProseSegments(rawSegments, maxChunkChars);
  const proseChunkCount = merged.filter((s) => s.type === 'prose').length;

  return {
    segments: merged,
    eol,
    isMarkdown: preserveMarkdown,
    proseChunkCount,
  };
}

/**
 * Replace Markdown inline code spans (`...`, ``...``) with neutral placeholders
 * (`@@CODE_0@@`) so AI models do not alter identifiers, flags, or code snippets.
 */
export function maskInlineCode(text: string): MaskedInlineCode {
  const placeholders = new Map<string, string>();
  let masked = '';
  let i = 0;

  while (i < text.length) {
    if (text[i] !== '`') {
      masked += text[i];
      i++;
      continue;
    }

    // Count opening backticks
    let openEnd = i;
    while (openEnd < text.length && text[openEnd] === '`') {
      openEnd++;
    }
    const tickLen = openEnd - i;

    // Search for matching exact-length closing backticks within the same paragraph
    const paraBreak = text.indexOf('\n\n', openEnd);
    const searchLimit = paraBreak === -1 ? text.length : paraBreak;

    let closeStart = -1;
    let cursor = openEnd;
    while (cursor < searchLimit) {
      if (text[cursor] !== '`') {
        cursor++;
        continue;
      }
      let runEnd = cursor;
      while (runEnd < searchLimit && text[runEnd] === '`') {
        runEnd++;
      }
      if (runEnd - cursor === tickLen) {
        closeStart = cursor;
        break;
      }
      cursor = runEnd;
    }

    if (closeStart !== -1) {
      const span = text.slice(i, closeStart + tickLen);
      const token = `@@CODE_${placeholders.size}@@`;
      placeholders.set(token, span);
      masked += token;
      i = closeStart + tickLen;
    } else {
      // Unmatched backticks: keep literally
      masked += text.slice(i, openEnd);
      i = openEnd;
    }
  }

  return { masked, placeholders };
}

/**
 * Restore masked inline code placeholders back to their original backtick spans.
 * Also handles models accidentally wrapping a placeholder in extra backticks.
 */
export function restoreInlineCode(
  text: string,
  placeholders: Map<string, string>
): RestoredInlineCode {
  let restored = text;
  const missing: string[] = [];

  for (const [token, originalSpan] of placeholders.entries()) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('`?' + escaped + '`?', 'g');
    let matched = false;
    restored = restored.replace(pattern, () => {
      matched = true;
      return originalSpan;
    });
    if (!matched) {
      missing.push(token);
    }
  }

  return { restored, missing };
}

/** Reassemble segments back into a full document string with original line endings. */
export function reassembleSegments(segments: DocumentSegment[], eol: '\n' | '\r\n'): string {
  const joined = segments.map((s) => s.text).join('');
  return eol === '\r\n' ? joined.replace(/\n/g, '\r\n') : joined;
}
