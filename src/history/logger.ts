import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { HistoryEntry, OptimizationResult } from '../types';
import { getModeLabel } from '../prompts/templates';

const MAX_UNSTARRED_ENTRIES = 100;

export interface HistoryQueryOptions {
  search?: string;
  starredOnly?: boolean;
  mode?: string;
  limit?: number;
}

export interface ClearHistoryOptions {
  /** Keep starred phrasebook entries when clearing history. */
  keepStarred?: boolean;
}

/** Format a list of history entries into a clean Markdown phrasebook document. */
export function exportHistoryToMarkdown(
  entries: HistoryEntry[],
  title: string = 'English Optimizer Phrasebook'
): string {
  const dateStr = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `# ${title}`,
    '',
    `_Exported on ${dateStr} · ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}_`,
    '',
  ];

  if (entries.length === 0) {
    lines.push('_No entries._', '');
    return lines.join('\n');
  }

  entries.forEach((entry, idx) => {
    const star = entry.starred ? '⭐ ' : '';
    const date = entry.timestamp.toISOString().slice(0, 10);
    lines.push(`## ${idx + 1}. ${star}${getModeLabel(entry.mode)} · ${date}`);
    lines.push('');
    lines.push('**Original:**');
    lines.push(quoteBlock(entry.original));
    lines.push('');
    lines.push('**Optimized:**');
    lines.push(quoteBlock(entry.optimized));
    lines.push('');
  });

  return lines.join('\n');
}

export function exportHistoryToJson(entries: HistoryEntry[]): string {
  return JSON.stringify(entries, null, 2) + '\n';
}

function quoteBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

export class HistoryLogger {
  private historyPath: string;

  constructor(historyPath: string) {
    this.historyPath = historyPath;
    this.ensureHistoryFile();
  }

  getHistoryPath(): string {
    return this.historyPath;
  }

  private ensureHistoryFile(): void {
    const dir = dirname(this.historyPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (!existsSync(this.historyPath)) {
      writeFileSync(this.historyPath, JSON.stringify([], null, 2), 'utf-8');
    }
  }

  private saveHistory(history: HistoryEntry[]): void {
    this.ensureHistoryFile();
    writeFileSync(this.historyPath, JSON.stringify(history, null, 2), 'utf-8');
  }

  private pruneHistory(history: HistoryEntry[]): HistoryEntry[] {
    let unstarredCount = 0;
    return history.filter((entry) => {
      if (entry.starred) {
        return true;
      }
      unstarredCount += 1;
      return unstarredCount <= MAX_UNSTARRED_ENTRIES;
    });
  }

  addEntry(result: OptimizationResult): HistoryEntry {
    const history = this.getHistory();
    const entry: HistoryEntry = {
      id: randomUUID(),
      original: result.original,
      optimized: result.optimized,
      mode: result.mode,
      timestamp: result.timestamp,
      provider: result.provider,
      model: result.model,
    };

    history.unshift(entry); // Add to the beginning
    const pruned = this.pruneHistory(history);

    this.saveHistory(pruned);
    return entry;
  }

  getHistory(): HistoryEntry[] {
    try {
      const content = readFileSync(this.historyPath, 'utf-8');
      const parsed: unknown = JSON.parse(content);
      if (!Array.isArray(parsed)) {
        return [];
      }
      // Timestamps are serialized as ISO strings; restore them to Date objects
      return parsed.map((entry: HistoryEntry) => ({
        ...entry,
        timestamp: new Date(entry.timestamp),
        starred: Boolean(entry.starred),
      }));
    } catch {
      return [];
    }
  }

  queryHistory(options: HistoryQueryOptions = {}): HistoryEntry[] {
    let entries = this.getHistory();

    if (options.starredOnly) {
      entries = entries.filter((entry) => Boolean(entry.starred));
    }

    if (options.mode) {
      const targetMode = options.mode.trim().toLowerCase();
      entries = entries.filter(
        (entry) =>
          entry.mode.toLowerCase() === targetMode ||
          entry.mode.toLowerCase() === `custom:${targetMode}` ||
          getModeLabel(entry.mode).toLowerCase().includes(targetMode)
      );
    }

    if (options.search) {
      const needle = options.search.trim().toLowerCase();
      if (needle) {
        entries = entries.filter(
          (entry) =>
            entry.original.toLowerCase().includes(needle) ||
            entry.optimized.toLowerCase().includes(needle) ||
            entry.mode.toLowerCase().includes(needle) ||
            getModeLabel(entry.mode).toLowerCase().includes(needle)
        );
      }
    }

    if (options.limit !== undefined && options.limit > 0) {
      return entries.slice(0, options.limit);
    }

    return entries;
  }

  /**
   * Resolve a user selector (1-based index into `pool`, or exact/prefix UUID) to an entry.
   */
  resolveEntry(selector: string, pool?: HistoryEntry[]): HistoryEntry | undefined {
    const trimmed = selector.trim();
    if (!trimmed) {
      return undefined;
    }

    const entries = pool ?? this.getHistory();
    if (/^\d+$/.test(trimmed)) {
      const idx = parseInt(trimmed, 10) - 1;
      return idx >= 0 && idx < entries.length ? entries[idx] : undefined;
    }

    const lower = trimmed.toLowerCase();
    return (
      entries.find((e) => e.id.toLowerCase() === lower) ??
      entries.find((e) => e.id.toLowerCase().startsWith(lower))
    );
  }

  setStarred(id: string, starred: boolean): HistoryEntry | undefined {
    const history = this.getHistory();
    const target = history.find((entry) => entry.id === id);
    if (!target) {
      return undefined;
    }
    target.starred = starred;
    this.saveHistory(this.pruneHistory(history));
    return target;
  }

  toggleStar(id: string): HistoryEntry | undefined {
    const history = this.getHistory();
    const target = history.find((entry) => entry.id === id);
    if (!target) {
      return undefined;
    }
    target.starred = !target.starred;
    this.saveHistory(this.pruneHistory(history));
    return target;
  }

  updateEntryOptimized(id: string, optimized: string): HistoryEntry | undefined {
    const history = this.getHistory();
    const target = history.find((entry) => entry.id === id);
    if (!target) {
      return undefined;
    }
    target.optimized = optimized;
    this.saveHistory(history);
    return target;
  }

  clearHistory(options: ClearHistoryOptions = {}): number {
    const existing = this.getHistory();
    if (options.keepStarred) {
      const kept = existing.filter((entry) => Boolean(entry.starred));
      this.saveHistory(kept);
      return existing.length - kept.length;
    }

    this.saveHistory([]);
    return existing.length;
  }

  getLatestEntry(): HistoryEntry | undefined {
    return this.getHistory()[0];
  }

  getEntryById(id: string): HistoryEntry | undefined {
    const history = this.getHistory();
    return history.find((entry) => entry.id === id);
  }

  getRecentEntries(count: number = 10): HistoryEntry[] {
    return this.queryHistory({ limit: count });
  }
}
