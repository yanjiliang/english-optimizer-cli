import { writeFileSync } from 'fs';
import { extname } from 'path';
import chalk from 'chalk';
import clipboardy from 'clipboardy';
import { exportHistoryToJson, exportHistoryToMarkdown, HistoryLogger } from './logger';
import { getModeLabel } from '../prompts/templates';
import { displayInfo, displaySuccess, truncateText } from '../utils/display';

export interface HistoryCommandOptions {
  number?: string;
  all?: boolean;
  full?: boolean;
  search?: string;
  starred?: boolean;
  mode?: string;
  star?: string;
  unstar?: string;
  copy?: string;
  export?: string;
  clear?: boolean;
  keepStarred?: boolean;
}

export interface HistoryCommandIO {
  writeClipboard?: (text: string) => void;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
}

const DEFAULT_PREVIEW_LENGTH = 200;

export function parseHistoryLimit(raw?: string, all?: boolean): number | undefined {
  if (all) {
    return undefined;
  }
  if (raw === undefined) {
    return 10;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid --number value "${raw}". Expected a non-negative integer.`);
  }
  return parsed === 0 ? undefined : parsed;
}

/** Execute `cao history` CLI actions (list, search, star/unstar, copy, export, clear). */
export function runHistoryCommand(
  historyLogger: HistoryLogger,
  options: HistoryCommandOptions,
  io: HistoryCommandIO = {}
): void {
  const writeClipboard = io.writeClipboard ?? ((text: string) => clipboardy.writeSync(text));
  const stdout = io.stdout ?? process.stdout;

  // 1. Clear history
  if (options.clear) {
    const removed = historyLogger.clearHistory({ keepStarred: Boolean(options.keepStarred) });
    if (options.keepStarred) {
      displaySuccess(`Cleared ${removed} unstarred history entry(s); starred entries kept.`);
    } else {
      displaySuccess(`Cleared ${removed} history entry(s).`);
    }
    return;
  }

  // Query pool (without limit first when acting on star/unstar/copy/export)
  const limit = parseHistoryLimit(options.number, options.all);
  const matching = historyLogger.queryHistory({
    search: options.search,
    starredOnly: Boolean(options.starred),
    mode: options.mode,
  });

  // 2. Star / unstar entry
  if (options.star) {
    const target = historyLogger.resolveEntry(options.star, matching);
    if (!target) {
      throw new Error(`History entry "${options.star}" not found.`);
    }
    historyLogger.setStarred(target.id, true);
    displaySuccess(`Starred entry #${matching.indexOf(target) + 1} (${target.id.slice(0, 8)}):`);
    console.log(chalk.white(`  ${truncateText(target.optimized, 100)}\n`));
    return;
  }

  if (options.unstar) {
    const target = historyLogger.resolveEntry(options.unstar, matching);
    if (!target) {
      throw new Error(`History entry "${options.unstar}" not found.`);
    }
    historyLogger.setStarred(target.id, false);
    displaySuccess(`Unstarred entry #${matching.indexOf(target) + 1} (${target.id.slice(0, 8)}).`);
    return;
  }

  // 3. Copy entry to clipboard
  if (options.copy) {
    const target = historyLogger.resolveEntry(options.copy, matching);
    if (!target) {
      throw new Error(`History entry "${options.copy}" not found.`);
    }
    writeClipboard(target.optimized);
    displaySuccess(
      `Copied entry #${matching.indexOf(target) + 1} (${getModeLabel(target.mode)}) to clipboard:`
    );
    console.log(chalk.white(`  ${truncateText(target.optimized, 120)}\n`));
    return;
  }

  // 4. Export to Markdown or JSON (or stdout via "-")
  if (options.export) {
    const entriesToExport =
      limit !== undefined && options.number !== undefined ? matching.slice(0, limit) : matching;
    const isJson = extname(options.export).toLowerCase() === '.json';
    const title = options.starred
      ? 'English Optimizer Starred Phrasebook'
      : 'English Optimizer History';
    const content = isJson
      ? exportHistoryToJson(entriesToExport)
      : exportHistoryToMarkdown(entriesToExport, title);

    if (options.export === '-') {
      stdout.write(content);
      return;
    }

    writeFileSync(options.export, content, 'utf-8');
    displaySuccess(
      `Exported ${entriesToExport.length} ${entriesToExport.length === 1 ? 'entry' : 'entries'} to ${options.export}`
    );
    return;
  }

  // 5. Display matching entries
  const visible = limit !== undefined ? matching.slice(0, limit) : matching;

  if (visible.length === 0) {
    if (options.search || options.starred || options.mode) {
      displayInfo('No matching history entries found.');
    } else {
      displayInfo('No history yet.');
    }
    return;
  }

  const filterParts: string[] = [];
  if (options.starred) filterParts.push('starred');
  if (options.mode) filterParts.push(`mode=${options.mode}`);
  if (options.search) filterParts.push(`search="${options.search}"`);
  const filterNote = filterParts.length > 0 ? ` (${filterParts.join(', ')})` : '';
  const totalNote = matching.length > visible.length ? ` of ${matching.length}` : '';

  console.log(
    chalk.cyan(`\n📜 Showing ${visible.length}${totalNote} optimizations${filterNote}:\n`)
  );

  const maxChars = options.full ? undefined : DEFAULT_PREVIEW_LENGTH;

  visible.forEach((entry, idx) => {
    const starBadge = entry.starred ? chalk.yellow('⭐ ') : '';
    const originalDisplay =
      maxChars !== undefined ? truncateText(entry.original, maxChars) : entry.original;
    const optimizedDisplay =
      maxChars !== undefined ? truncateText(entry.optimized, maxChars) : entry.optimized;

    console.log(chalk.gray('─'.repeat(60)));
    console.log(
      `${chalk.white.bold(`#${idx + 1}`)} ${starBadge}${chalk.yellow(getModeLabel(entry.mode))} ${chalk.gray(`· ${entry.timestamp.toLocaleString()} · ${entry.id.slice(0, 8)}`)}`
    );
    console.log(`${chalk.gray('Original: ')} ${chalk.gray(originalDisplay)}`);
    console.log(`${chalk.green('Optimized:')} ${chalk.white(optimizedDisplay)}`);
    console.log('');
  });

  console.log(
    chalk.gray(
      'Tip: cao history --copy 1 · --star 1 · --search "<text>" · --starred · --export phrasebook.md\n'
    )
  );
}
