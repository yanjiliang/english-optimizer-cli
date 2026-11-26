import chalk from 'chalk';
import { diffLines, diffWords } from 'diff';
import { CustomPrompt, OptimizationMode, TextVariant } from '../types';
import { getModeInfo, getModeLabel } from '../prompts/templates';

const CJK_REGEX = /[一-鿿぀-ヿ가-힯]/g;

/** Returns true when text is mostly non-CJK (so word-level English diff is informative). */
export function isPredominantlyEnglish(text: string): boolean {
  const compact = text.replace(/\s+/g, '');
  if (!compact) {
    return false;
  }
  const cjkMatches = compact.match(CJK_REGEX);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  return cjkCount / compact.length < 0.2;
}

/** Decide whether auto-displaying a word-level diff adds signal (English -> English edits). */
export function shouldShowWordDiff(original: string, optimized: string): boolean {
  return original.trim() !== optimized.trim() && isPredominantlyEnglish(original);
}

/** Render an inline word-level diff with red strikethrough deletions and green bold additions. */
export function formatWordDiff(original: string, optimized: string): string {
  const parts = diffWords(original, optimized);
  return parts
    .map((part) => {
      if (part.added) {
        return chalk.green.bold(part.value);
      }
      if (part.removed) {
        return chalk.red.strikethrough(part.value);
      }
      return chalk.gray(part.value);
    })
    .join('');
}

export function displayWordDiff(original: string, optimized: string): void {
  console.log(chalk.cyan('\n🔍 Changes:'));
  console.log(formatWordDiff(original, optimized));
}

export function displayExplanation(explanation: string): void {
  if (!explanation.trim()) {
    return;
  }
  console.log(chalk.cyan('\n💡 Why / 改进要点:'));
  console.log(chalk.gray(explanation.trim()));
}

export function displayVariants(variants: TextVariant[]): void {
  console.log(chalk.gray('\n' + '═'.repeat(70)));
  console.log(chalk.cyan.bold('\n🎨 Tone Variants / 多语气版本:\n'));
  variants.forEach((variant, index) => {
    const header =
      variant.label && variant.label !== variant.tone
        ? `[${index + 1}] ${variant.tone} — ${variant.label}`
        : `[${index + 1}] ${variant.tone}`;
    console.log(chalk.yellow(header));
    console.log(chalk.white.bold(variant.text));
    if (index < variants.length - 1) {
      console.log();
    }
  });
  console.log(chalk.gray('\n' + '═'.repeat(70)));
}

export function displayWelcome(): void {
  console.log(chalk.cyan.bold('\n🚀 English Optimizer CLI\n'));
}

export function displayModeInfo(mode: OptimizationMode): void {
  const modeInfo = getModeInfo(mode);
  console.log(chalk.yellow(`\n[${modeInfo.name} Mode]`));
  console.log(chalk.gray(modeInfo.description));
}

export function displayOptimization(original: string, optimized: string): void {
  displaySeparator();
  displayOriginalAndOptimized(original, optimized);
  displaySeparator();
}

/** Truncate text cleanly only when it actually exceeds `maxLength`. */
export function truncateText(text: string, maxLength: number = 120): string {
  if (maxLength <= 0 || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/** Format a line-level diff where every line in each hunk gets a `+ `, `- `, or `  ` prefix. */
export function formatLineDiff(original: string, optimized: string): string {
  const differences = diffLines(original, optimized);
  const lines: string[] = [];

  for (const part of differences) {
    const color = part.added ? chalk.green : part.removed ? chalk.red : chalk.gray;
    const prefix = part.added ? '+ ' : part.removed ? '- ' : '  ';
    const rawLines = part.value.split('\n');
    // diffLines usually includes a trailing empty string after a trailing newline
    if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '') {
      rawLines.pop();
    }
    for (const line of rawLines) {
      lines.push(color(prefix + line));
    }
  }

  return lines.join('\n');
}

export function displayDiff(original: string, optimized: string): void {
  console.log(formatLineDiff(original, optimized));
  console.log();
}

export function displayError(error: Error | string): void {
  const message = typeof error === 'string' ? error : error.message;
  console.error(chalk.red('\n❌ Error:'), chalk.white(message));
}

export function displaySuccess(message: string): void {
  console.log(chalk.green('\n✅'), chalk.white(message));
}

export function displayInfo(message: string): void {
  console.log(chalk.cyan('\nℹ️'), chalk.white(message));
}

const HOTKEY_LABELS: Array<[action: string, label: string]> = [
  ['professional', 'Professional tone'],
  ['concise', 'Concise version'],
  ['grammar', 'Grammar fix'],
  ['senior_developer', 'Senior developer style'],
  ['reset', 'Reset to original'],
  ['history', 'View history'],
  ['quit', 'Quit'],
];

export function displayHelp(
  hotkeys: Record<string, string>,
  customPrompts: CustomPrompt[] = []
): void {
  console.log(chalk.cyan('\n📖 Hotkeys:\n'));
  for (const [action, label] of HOTKEY_LABELS) {
    if (hotkeys[action]) {
      console.log(chalk.gray(`  ${hotkeys[action]} - ${label}`));
    }
  }
  for (const prompt of customPrompts) {
    if (prompt.hotkey) {
      console.log(chalk.gray(`  ${prompt.hotkey} - ${prompt.name} (custom)`));
    }
  }
  console.log(chalk.gray('  Ctrl+C - Quit\n'));
}

export function displayHistoryEntry(
  entry: {
    id: string;
    original: string;
    optimized: string;
    mode: string;
    timestamp: Date;
    starred?: boolean;
  },
  options: { index?: number; maxChars?: number } = {}
): void {
  displaySeparator();
  const indexLabel = options.index !== undefined ? chalk.white.bold(`#${options.index} `) : '';
  const starBadge = entry.starred ? chalk.yellow('⭐ ') : '';
  console.log(
    `\n${indexLabel}${starBadge}${chalk.yellow(getModeLabel(entry.mode))} ${chalk.gray(`· ${entry.timestamp.toLocaleString()} · ${entry.id.slice(0, 8)}`)}`
  );
  const originalText =
    options.maxChars !== undefined
      ? truncateText(entry.original, options.maxChars)
      : entry.original;
  const optimizedText =
    options.maxChars !== undefined
      ? truncateText(entry.optimized, options.maxChars)
      : entry.optimized;
  displayOriginalAndOptimized(originalText, optimizedText);
  displaySeparator();
}

// Helper functions
function displaySeparator(): void {
  console.log(chalk.gray('\n' + '─'.repeat(60)));
}

function displayOriginalAndOptimized(original: string, optimized: string): void {
  console.log(chalk.red('\n❌ Original:'));
  console.log(chalk.gray(original));
  console.log(chalk.green('\n✅ Optimized:'));
  console.log(chalk.white(optimized));
}
