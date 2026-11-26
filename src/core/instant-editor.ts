import readline from 'readline';
import { stdin as input, stdout as output } from 'process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import chalk from 'chalk';
import clipboardy from 'clipboardy';
import { CustomPrompt, GenerateOptions, OptimizationResult, TextVariant } from '../types';
import { Optimizer } from './optimizer';
import { HistoryLogger } from '../history/logger';
import { TranslationPromptLoader } from '../prompts/translation-prompt';
import { YAMLPromptLoader } from '../prompts/yaml-prompt';
import { listAvailableModes, normalizeModeName, resolveModePrompt } from '../prompts/resolver';
import {
  buildRefinePrompts,
  buildVariantsPrompts,
  buildWhyPrompts,
  parseVariantsResponse,
  RefinementKind,
} from '../prompts/structured';
import {
  displayError,
  displayHistoryEntry,
  displayInfo,
  displayVariants,
  displayWordDiff,
  shouldShowWordDiff,
} from '../utils/display';
import { Spinner } from '../utils/spinner';

export interface InstantEditorOptions {
  /** Path to the text prompt template (defaults to ~/.english-optimizer/translation-prompt.txt) */
  promptPath?: string;
  /** Use prompt.yaml when present (features.useYAMLPrompt) */
  useYAMLPrompt?: boolean;
  /** Stream tokens incrementally as they arrive (defaults to true) */
  stream?: boolean;
  /** Automatically copy optimized text to clipboard (defaults to true) */
  autoCopy?: boolean;
  /** Initial active mode (defaults to "translate") */
  initialMode?: string;
  /** Custom prompts loaded from prompts.json */
  customPrompts?: CustomPrompt[];
  /** Optional history logger for /history command */
  historyLogger?: HistoryLogger;
}

export interface ParsedSlashCommand {
  command: string;
  args: string;
}

const KNOWN_SLASH_COMMANDS = new Set([
  'help',
  '?',
  'm',
  'mode',
  'r',
  'retry',
  'v',
  'variants',
  'why',
  'diff',
  'copy',
  '1',
  '2',
  '3',
  'shorter',
  'softer',
  'formal',
  'casual',
  'edit',
  'clear',
  'star',
  'unstar',
  'h',
  'history',
  'q',
  'quit',
  'exit',
]);

/**
 * Parse a REPL slash command line. Unknown `/...` strings (such as file paths
 * or URL paths like `/api/v1/users`) return `null` so they are treated as text.
 */
export function parseSlashCommand(line: string): ParsedSlashCommand | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const spaceIdx = trimmed.indexOf(' ');
  const rawCmd = (spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)).toLowerCase();
  if (!KNOWN_SLASH_COMMANDS.has(rawCmd)) {
    return null;
  }

  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
  return { command: rawCmd, args };
}

export class InstantEditor {
  private optimizer: Optimizer;
  private promptLoader: TranslationPromptLoader;
  private yamlPromptLoader?: YAMLPromptLoader;
  private historyLogger?: HistoryLogger;
  private customPrompts: CustomPrompt[];
  private rl: readline.Interface;
  private pendingLines: string[] = [];
  private inBlockMode = false;
  private activeMode: string;
  private lastOriginal?: string;
  private lastOptimized?: string;
  private lastHistoryId?: string;
  private lastVariants: TextVariant[] = [];
  private stream: boolean;
  private autoCopy: boolean;
  private useYAMLPrompt: boolean;
  private promptPath?: string;
  private lineQueue: Promise<void> = Promise.resolve();

  constructor(optimizer: Optimizer, options: InstantEditorOptions = {}) {
    this.optimizer = optimizer;
    this.promptPath = options.promptPath;
    this.useYAMLPrompt = options.useYAMLPrompt ?? true;
    this.promptLoader = new TranslationPromptLoader(options.promptPath);
    this.historyLogger = options.historyLogger;
    this.customPrompts = options.customPrompts ?? [];
    this.stream = options.stream ?? true;
    this.autoCopy = options.autoCopy ?? true;
    this.activeMode = normalizeModeName(options.initialMode, this.customPrompts);

    if (this.useYAMLPrompt) {
      const yamlPromptLoader = new YAMLPromptLoader();
      if (yamlPromptLoader.hasYAMLPrompt()) {
        this.yamlPromptLoader = yamlPromptLoader;
        console.log(
          chalk.cyan('✓ Using YAML prompt configuration from: ' + yamlPromptLoader.getPromptPath())
        );
      }
    }

    this.rl = readline.createInterface({
      input,
      output,
      terminal: true,
      prompt: this.formatPrompt(),
    });
  }

  private formatPrompt(): string {
    if (this.inBlockMode) {
      return chalk.gray('... ');
    }
    if (this.activeMode === 'translate') {
      return '> ';
    }
    return chalk.cyan(`[${this.activeMode}] `) + '> ';
  }

  private refreshPrompt(): void {
    this.rl.setPrompt(this.formatPrompt());
    this.rl.prompt();
  }

  async start(): Promise<void> {
    this.displayWelcome();
    this.displayInstructions();

    console.log(chalk.cyan('\n✨ Ready! Start typing or run /help for commands...\n'));

    this.refreshPrompt();

    this.rl.on('line', (line) => {
      this.lineQueue = this.lineQueue
        .then(() => this.handleLine(line))
        .catch((error) => {
          displayError(error as Error);
          this.refreshPrompt();
        });
    });

    this.rl.on('SIGINT', () => {
      console.log('\n\n' + chalk.gray('─'.repeat(60)));
      console.log(chalk.cyan('\n👋 Goodbye!\n'));
      this.close();
      process.exit(0);
    });
  }

  private async handleLine(line: string): Promise<void> {
    const trimmed = line.trim();

    // Multi-paragraph fenced block mode using `"""`
    if (trimmed === '"""') {
      if (!this.inBlockMode) {
        this.inBlockMode = true;
        console.log(
          chalk.gray('  ↳ Multi-paragraph mode started (blank lines allowed). Type """ to finish.')
        );
        this.refreshPrompt();
        return;
      }

      this.inBlockMode = false;
      this.rl.setPrompt(this.formatPrompt());
      if (this.pendingLines.length > 0) {
        await this.translateAndOptimize();
      } else {
        this.refreshPrompt();
      }
      return;
    }

    if (this.inBlockMode) {
      this.pendingLines.push(line);
      this.refreshPrompt();
      return;
    }

    // Check slash commands (allowed even with pending lines for /clear, /help, /q)
    const slash = parseSlashCommand(line);
    if (
      slash &&
      (this.pendingLines.length === 0 ||
        ['clear', 'help', '?', 'q', 'quit', 'exit'].includes(slash.command))
    ) {
      await this.handleSlashCommand(slash);
      return;
    }

    if (trimmed === '') {
      // Empty line triggers optimization when text is buffered
      if (this.pendingLines.length > 0) {
        await this.translateAndOptimize();
      } else {
        this.refreshPrompt();
      }
      return;
    }

    // Accumulate text
    this.pendingLines.push(line);

    console.log(
      chalk.gray(`  ✓ Line ${this.pendingLines.length} added. Press Enter (empty line) to optimize`)
    );
    this.refreshPrompt();
  }

  private async handleSlashCommand({ command, args }: ParsedSlashCommand): Promise<void> {
    switch (command) {
      case 'help':
      case '?':
        this.displaySlashHelp();
        this.refreshPrompt();
        return;

      case 'q':
      case 'quit':
      case 'exit':
        console.log(chalk.cyan('\n👋 Goodbye!\n'));
        this.close();
        process.exit(0);
        return;

      case 'clear':
        this.pendingLines = [];
        this.inBlockMode = false;
        console.log(chalk.gray('\n✓ Input buffer cleared.\n'));
        this.refreshPrompt();
        return;

      case 'm':
      case 'mode':
        this.handleModeCommand(args);
        this.refreshPrompt();
        return;

      case 'r':
      case 'retry':
        if (!this.lastOriginal) {
          displayInfo('Nothing to retry yet. Enter some text first.');
          this.refreshPrompt();
          return;
        }
        await this.optimizeText(this.lastOriginal);
        return;

      case 'v':
      case 'variants': {
        const target = args || this.lastOriginal;
        if (!target) {
          displayInfo('Usage: /v <text> (or run /v right after optimizing text).');
          this.refreshPrompt();
          return;
        }
        await this.generateVariants(target);
        return;
      }

      case '1':
      case '2':
      case '3':
        this.copyVariantByNumber(parseInt(command, 10));
        this.refreshPrompt();
        return;

      case 'copy':
        if (args && /^[1-9]$/.test(args)) {
          this.copyVariantByNumber(parseInt(args, 10));
        } else if (this.lastOptimized) {
          this.copyToClipboard(this.lastOptimized);
        } else {
          displayInfo('Nothing to copy yet.');
        }
        this.refreshPrompt();
        return;

      case 'shorter':
      case 'softer':
      case 'formal':
      case 'casual':
        await this.refineLast(command);
        return;

      case 'why':
        await this.explainLast();
        return;

      case 'diff':
        if (!this.lastOriginal || !this.lastOptimized) {
          displayInfo('No previous result to diff yet.');
        } else {
          displayWordDiff(this.lastOriginal, this.lastOptimized);
          console.log();
        }
        this.refreshPrompt();
        return;

      case 'edit':
        await this.openExternalEditor();
        return;

      case 'star':
        this.handleStarCommand();
        this.refreshPrompt();
        return;

      case 'unstar':
        this.handleStarCommand(false);
        this.refreshPrompt();
        return;

      case 'h':
      case 'history':
        this.showHistory(args);
        this.refreshPrompt();
        return;
    }
  }

  private handleModeCommand(args: string): void {
    if (!args) {
      const modes = listAvailableModes(this.customPrompts);
      console.log(chalk.cyan('\n🎯 Available Modes / 可用模式:\n'));
      for (const m of modes) {
        const active = m.key.toLowerCase() === this.activeMode.toLowerCase();
        const marker = active ? chalk.green('●') : chalk.gray('○');
        const namePart = active ? chalk.white.bold(m.key) : chalk.white(m.key);
        const tag = m.custom ? chalk.magenta(' (custom)') : '';
        console.log(`  ${marker} ${namePart.padEnd(20)} ${chalk.gray(m.description)}${tag}`);
      }
      console.log(chalk.gray('\nSwitch with: /m <mode>  (e.g. /m pr, /m slack, /m commit)\n'));
      return;
    }

    try {
      this.activeMode = normalizeModeName(args, this.customPrompts);
      console.log(chalk.green(`\n✓ Switched mode to: ${chalk.bold(this.activeMode)}\n`));
    } catch (error) {
      displayError(error as Error);
      console.log();
    }
  }

  private copyVariantByNumber(num: number): void {
    const idx = num - 1;
    const variant = this.lastVariants[idx];
    if (!variant) {
      displayInfo(
        this.lastVariants.length === 0
          ? 'No tone variants yet. Run /v first.'
          : `Invalid choice. Pick 1–${this.lastVariants.length}.`
      );
      return;
    }

    this.lastOptimized = variant.text;
    if (this.historyLogger && this.lastHistoryId) {
      this.historyLogger.updateEntryOptimized(this.lastHistoryId, variant.text);
    }
    this.copyToClipboard(variant.text, `[${num}] ${variant.tone}`);
  }

  private copyToClipboard(text: string, label?: string): void {
    try {
      clipboardy.writeSync(text);
      const suffix = label ? ` (${label})` : '';
      console.log(chalk.green.bold(`\n✓ 已复制到剪贴板 / Copied to clipboard${suffix}!\n`));
    } catch {
      console.log(chalk.yellow('\n⚠️  剪贴板复制失败 / Failed to copy to clipboard\n'));
    }
  }

  private async translateAndOptimize(): Promise<void> {
    const fullText = this.pendingLines.join('\n').trim();
    this.pendingLines = [];

    if (!fullText) {
      console.log(chalk.yellow('\n⚠️  No text to optimize. Type something first!\n'));
      this.refreshPrompt();
      return;
    }

    await this.optimizeText(fullText);
  }

  private async optimizeText(fullText: string): Promise<void> {
    const spinner = new Spinner('Translating and optimizing...', output);

    try {
      const resolved = resolveModePrompt(this.activeMode, fullText, {
        useYAMLPrompt: this.useYAMLPrompt,
        promptPath: this.promptPath,
        yamlPromptPath: this.yamlPromptLoader?.getPromptPath(),
        customPrompts: this.customPrompts,
      });

      let streamedAny = false;
      let lastChunkEndedWithNewline = false;

      const genOptions: GenerateOptions | undefined = this.stream
        ? {
            onToken: (token: string) => {
              if (!streamedAny) {
                spinner.stop();
                this.displayBilingualHeader(fullText, resolved.displayName);
                streamedAny = true;
              }
              output.write(chalk.white.bold(token));
              lastChunkEndedWithNewline = token.endsWith('\n');
            },
          }
        : undefined;

      console.log();
      spinner.start();

      let result: OptimizationResult;
      if (resolved.builtInMode) {
        result = await this.optimizer.optimize(fullText, resolved.builtInMode, genOptions);
      } else if (resolved.customPrompt) {
        result = await this.optimizer.optimizeWithCustomPrompt(
          fullText,
          resolved.customPrompt,
          genOptions
        );
      } else {
        result = await this.optimizer.generate(fullText, resolved.userPrompt, resolved.modeLabel, {
          ...genOptions,
          systemPrompt: resolved.systemPrompt,
        });
      }
      spinner.stop();

      this.lastOriginal = result.original;
      this.lastOptimized = result.optimized;
      this.lastHistoryId = result.historyId;
      this.lastVariants = [];

      const meta = `${spinner.elapsedSeconds()} · ${result.provider}/${result.model}`;
      if (streamedAny) {
        if (!lastChunkEndedWithNewline) {
          output.write('\n');
        }
        this.displayBilingualFooter(result.original, result.optimized, meta);
      } else {
        this.displayBilingualResult(result.original, result.optimized, meta, resolved.displayName);
      }

      console.log(
        chalk.gray(
          '  Tip: /why explain · /v variants · /shorter · /softer · /star save · /m <mode>\n'
        )
      );
      this.refreshPrompt();
    } catch (error) {
      spinner.stop();
      displayError(error as Error);
      console.log(chalk.cyan('\nContinue typing...\n'));
      this.refreshPrompt();
    }
  }

  private async refineLast(kind: RefinementKind): Promise<void> {
    if (!this.lastOptimized) {
      displayInfo('Nothing to refine yet. Optimize some text first.');
      this.refreshPrompt();
      return;
    }

    const previous = this.lastOptimized;
    const prompts = buildRefinePrompts(previous, kind, this.lastOriginal);
    const spinner = new Spinner(`Refining (${kind})...`, output);

    try {
      let streamedAny = false;
      let lastChunkEndedWithNewline = false;

      const genOptions: GenerateOptions = {
        systemPrompt: prompts.systemPrompt,
        ...(this.stream
          ? {
              onToken: (token: string) => {
                if (!streamedAny) {
                  spinner.stop();
                  this.displayBilingualHeader(previous, `Refine (${kind})`);
                  streamedAny = true;
                }
                output.write(chalk.white.bold(token));
                lastChunkEndedWithNewline = token.endsWith('\n');
              },
            }
          : {}),
      };

      console.log();
      spinner.start();
      const result = await this.optimizer.generate(
        previous,
        prompts.userPrompt,
        `refine:${kind}`,
        genOptions
      );
      spinner.stop();

      this.lastOptimized = result.optimized;
      this.lastHistoryId = result.historyId;

      const meta = `${spinner.elapsedSeconds()} · ${result.provider}/${result.model}`;
      if (streamedAny) {
        if (!lastChunkEndedWithNewline) {
          output.write('\n');
        }
        this.displayBilingualFooter(previous, result.optimized, meta);
      } else {
        this.displayBilingualResult(previous, result.optimized, meta, `Refine (${kind})`);
      }

      this.refreshPrompt();
    } catch (error) {
      spinner.stop();
      displayError(error as Error);
      this.refreshPrompt();
    }
  }

  private async generateVariants(text: string): Promise<void> {
    const modeHint = this.activeMode !== 'translate' ? this.activeMode : undefined;
    const prompts = buildVariantsPrompts(text, modeHint);
    const spinner = new Spinner('Generating tone variants...', output);

    try {
      console.log();
      spinner.start();
      const raw = await this.optimizer.generateRaw(prompts.userPrompt, {
        systemPrompt: prompts.systemPrompt,
      });
      spinner.stop();

      const variants = parseVariantsResponse(raw);
      if (variants.length === 0) {
        displayError('Could not parse tone variants from model response.');
        this.refreshPrompt();
        return;
      }

      this.lastOriginal = text;
      this.lastVariants = variants;
      this.lastOptimized = variants[0].text;
      const recorded = this.optimizer.recordResult(text, variants[0].text, 'variants');
      this.lastHistoryId = recorded.historyId;

      displayVariants(variants);
      console.log(
        chalk.gray(`${spinner.elapsedSeconds()} · ${recorded.provider}/${recorded.model}`)
      );
      if (this.autoCopy) {
        this.copyToClipboard(variants[0].text, `[1] ${variants[0].tone}`);
      }
      console.log(chalk.gray('  Type /1, /2, or /3 to copy another version.\n'));
      this.refreshPrompt();
    } catch (error) {
      spinner.stop();
      displayError(error as Error);
      this.refreshPrompt();
    }
  }

  private async explainLast(): Promise<void> {
    if (!this.lastOriginal || !this.lastOptimized) {
      displayInfo('Nothing to explain yet. Optimize some text first.');
      this.refreshPrompt();
      return;
    }

    const prompts = buildWhyPrompts(this.lastOriginal, this.lastOptimized);
    const spinner = new Spinner('Analyzing improvements...', output);

    try {
      let streamedAny = false;
      let lastChunkEndedWithNewline = false;

      const genOptions: GenerateOptions = {
        systemPrompt: prompts.systemPrompt,
        ...(this.stream
          ? {
              onToken: (token: string) => {
                if (!streamedAny) {
                  spinner.stop();
                  console.log(chalk.cyan('\n💡 Why / 改进要点:\n'));
                  streamedAny = true;
                }
                output.write(chalk.gray(token));
                lastChunkEndedWithNewline = token.endsWith('\n');
              },
            }
          : {}),
      };

      console.log();
      spinner.start();
      const explanation = await this.optimizer.generateRaw(prompts.userPrompt, genOptions);
      spinner.stop();

      if (streamedAny) {
        if (!lastChunkEndedWithNewline) {
          output.write('\n');
        }
        console.log();
      } else {
        console.log(chalk.cyan('\n💡 Why / 改进要点:\n'));
        console.log(chalk.gray(explanation) + '\n');
      }
      this.refreshPrompt();
    } catch (error) {
      spinner.stop();
      displayError(error as Error);
      this.refreshPrompt();
    }
  }

  private async openExternalEditor(): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), 'cao-edit-'));
    const tempFile = join(tempDir, 'draft.txt');
    const editorCmd = (
      process.env.VISUAL ||
      process.env.EDITOR ||
      (process.platform === 'win32' ? 'notepad' : 'vi')
    ).trim();
    const [bin, ...editorArgs] = editorCmd.split(/\s+/);

    try {
      writeFileSync(tempFile, this.pendingLines.join('\n'), 'utf-8');
      this.rl.pause();

      const res = spawnSync(bin, [...editorArgs, tempFile], { stdio: 'inherit' });
      this.rl.resume();

      if (res.error) {
        displayError(`Could not launch editor "${editorCmd}": ${res.error.message}`);
        this.refreshPrompt();
        return;
      }

      const content = readFileSync(tempFile, 'utf-8').trim();
      this.pendingLines = [];
      if (!content) {
        displayInfo('Editor closed with empty content.');
        this.refreshPrompt();
        return;
      }

      await this.optimizeText(content);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private handleStarCommand(forceState?: boolean): void {
    if (!this.historyLogger) {
      displayInfo('History is disabled. Enable history in config to save starred expressions.');
      return;
    }

    const targetId = this.lastHistoryId ?? this.historyLogger.getLatestEntry()?.id;
    if (!targetId) {
      displayInfo('Nothing to star yet. Optimize some text first.');
      return;
    }

    const updated =
      forceState === undefined
        ? this.historyLogger.toggleStar(targetId)
        : this.historyLogger.setStarred(targetId, forceState);

    if (!updated) {
      displayInfo('Could not find the last history entry to star.');
      return;
    }

    if (updated.starred) {
      console.log(
        chalk.yellow('\n⭐ Starred! Saved to your phrasebook (view with: cao history --starred)\n')
      );
    } else {
      console.log(chalk.gray('\n☆ Removed star from the last entry.\n'));
    }
  }

  private showHistory(args: string = ''): void {
    if (!this.historyLogger) {
      displayInfo('History is disabled.');
      return;
    }

    const trimmed = args.trim();
    const isStarredFilter = trimmed.toLowerCase() === 'starred' || trimmed === '⭐';
    const history = isStarredFilter
      ? this.historyLogger.queryHistory({ starredOnly: true, limit: 10 })
      : trimmed
        ? this.historyLogger.queryHistory({ search: trimmed, limit: 10 })
        : this.historyLogger.getRecentEntries(5);

    if (history.length === 0) {
      displayInfo(trimmed ? 'No matching history entries found.' : 'No history yet.');
      return;
    }

    const header = isStarredFilter
      ? '\n⭐ Starred Phrasebook:\n'
      : trimmed
        ? `\n🔍 History matching "${trimmed}":\n`
        : '\n📜 Recent Optimizations:\n';
    console.log(chalk.cyan(header));
    history.forEach((entry, idx) => {
      displayHistoryEntry(entry, { index: idx + 1 });
    });
    console.log();
  }

  private displayBilingualHeader(original: string, modeName?: string): void {
    console.log(chalk.gray('═'.repeat(70)));

    const suffix = modeName ? chalk.gray(` [${modeName}]`) : '';
    console.log(chalk.cyan.bold('\n📝 中英文对照 / Bilingual Comparison') + suffix + '\n');

    console.log(chalk.yellow('Original / 原文:'));
    console.log(chalk.gray(original));

    console.log(chalk.green('\nOptimized English / 优化后的英文:'));
  }

  private displayBilingualFooter(original: string, optimized: string, meta?: string): void {
    if (shouldShowWordDiff(original, optimized)) {
      displayWordDiff(original, optimized);
    }

    console.log(chalk.gray('\n' + '═'.repeat(70)));

    if (meta) {
      console.log(chalk.gray(meta));
    }

    if (this.autoCopy) {
      this.copyToClipboard(optimized);
    }
  }

  private displayBilingualResult(
    original: string,
    optimized: string,
    meta?: string,
    modeName?: string
  ): void {
    this.displayBilingualHeader(original, modeName);
    console.log(chalk.white.bold(optimized));
    this.displayBilingualFooter(original, optimized, meta);
  }

  private displayWelcome(): void {
    console.log(chalk.cyan.bold('\n🚀 English Optimizer CLI - 中英文优化模式\n'));
  }

  private displayInstructions(): void {
    console.log(chalk.white.bold('使用说明 / How to use:'));
    console.log(
      chalk.gray('1. 输入中文或英文，按 ') +
        chalk.cyan.bold('Enter (空行)') +
        chalk.gray(' 立即流式翻译优化并复制剪贴板')
    );
    console.log(
      chalk.gray('2. 多段落长文：输入 ') +
        chalk.cyan.bold('"""') +
        chalk.gray(' 开始/结束块输入，或 ') +
        chalk.cyan.bold('/edit') +
        chalk.gray(' 调用外部编辑器')
    );
    console.log(
      chalk.gray('3. 快捷指令：') +
        chalk.cyan('/m pr') +
        chalk.gray(' 切场景 · ') +
        chalk.cyan('/v') +
        chalk.gray(' 多语气 · ') +
        chalk.cyan('/why') +
        chalk.gray(' 讲解 · ') +
        chalk.cyan('/shorter') +
        chalk.gray(' / ') +
        chalk.cyan('/softer') +
        chalk.gray(' 微调 · ') +
        chalk.cyan('/help') +
        chalk.gray(' 全部指令')
    );
    console.log(chalk.gray('4. Ctrl+C 或 /q 退出\n'));
  }

  private displaySlashHelp(): void {
    console.log(chalk.cyan('\n📖 Slash Commands / 快捷指令:\n'));
    const rows: Array<[string, string]> = [
      ['/m [mode]', 'List or switch preset (translate, slack, pr, commit, email, ...)'],
      ['/r, /retry', 'Re-run optimization on the last input'],
      ['/v [text]', 'Generate 3 tone variants (Casual / Neutral / Formal)'],
      ['/1, /2, /3', 'Copy a specific tone variant to clipboard'],
      ['/shorter', 'Make the last English result shorter & punchier'],
      ['/softer', 'Make the last English result warmer & more polite'],
      ['/formal', 'Make the last English result more formal'],
      ['/casual', 'Make the last English result more casual (Slack style)'],
      ['/why', 'Explain in Chinese why the optimized English is better'],
      ['/diff', 'Show word-level diff between original and optimized'],
      ['/copy [1-3]', 'Re-copy the last result (or chosen variant) to clipboard'],
      ['/edit', 'Open $EDITOR to write multi-paragraph text'],
      ['"""', 'Toggle multi-paragraph block input (blank lines allowed)'],
      ['/star', 'Star/unstar the last result into your personal phrasebook'],
      ['/clear', 'Clear buffered input lines'],
      ['/h [query]', 'Show recent history (or /h starred, /h <keyword>)'],
      ['/q, /quit', 'Exit'],
    ];
    for (const [cmd, desc] of rows) {
      console.log(`  ${chalk.cyan(cmd.padEnd(14))} ${chalk.gray(desc)}`);
    }
    console.log();
  }

  close(): void {
    this.rl.close();
  }
}
