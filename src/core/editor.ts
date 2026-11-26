import readline from 'readline';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import chalk from 'chalk';
import { CustomPrompt, GenerateOptions, OptimizationMode, OptimizationResult } from '../types';
import { Optimizer } from './optimizer';
import {
  displayWelcome,
  displayModeInfo,
  displayOptimization,
  displayWordDiff,
  displayHelp,
  displayHistoryEntry,
  displayError,
  displayInfo,
  displaySuccess,
  shouldShowWordDiff,
} from '../utils/display';
import { Spinner } from '../utils/spinner';
import { HistoryLogger } from '../history/logger';
import { CustomPromptLoader } from '../prompts/custom';

const CTRL_C = '\u0003';

const DEFAULT_HOTKEYS: Record<string, string> = {
  professional: 'p',
  concise: 'c',
  grammar: 'g',
  senior_developer: 'd',
  reset: 'r',
  history: 'h',
  quit: 'q',
};

const MODE_BY_ACTION: Record<string, OptimizationMode> = {
  professional: OptimizationMode.PROFESSIONAL,
  concise: OptimizationMode.CONCISE,
  grammar: OptimizationMode.GRAMMAR,
  senior_developer: OptimizationMode.SENIOR_DEVELOPER,
};

export class InteractiveEditor {
  private optimizer: Optimizer;
  private historyLogger?: HistoryLogger;
  private customPromptLoader?: CustomPromptLoader;
  private hotkeys: Record<string, string>;
  private stream: boolean;
  private originalText: string = '';
  private currentText: string = '';

  constructor(
    optimizer: Optimizer,
    historyLogger?: HistoryLogger,
    customPromptLoader?: CustomPromptLoader,
    hotkeys: Record<string, string> = {},
    options: { stream?: boolean } = {}
  ) {
    this.optimizer = optimizer;
    this.historyLogger = historyLogger;
    this.customPromptLoader = customPromptLoader;
    this.hotkeys = { ...DEFAULT_HOTKEYS, ...hotkeys };
    this.stream = options.stream ?? true;
  }

  async start(): Promise<void> {
    displayWelcome();
    displayHelp(this.hotkeys, this.getCustomPrompts());

    console.log('\nEnter your text (press Enter on an empty line to finish):\n');

    this.currentText = await this.readMultilineText();
    this.originalText = this.currentText;

    if (!this.currentText) {
      displayInfo('No text provided. Exiting...');
      return;
    }

    await this.runOptimizationLoop();
  }

  private async readMultilineText(): Promise<string> {
    const rl = createInterface({ input, output });
    const lines: string[] = [];
    try {
      while (true) {
        const line = await rl.question('');
        if (line.trim() === '') {
          break;
        }
        lines.push(line);
      }
    } finally {
      rl.close();
    }
    return lines.join('\n').trim();
  }

  private getCustomPrompts(): CustomPrompt[] {
    return this.customPromptLoader ? this.customPromptLoader.getCustomPrompts() : [];
  }

  /** Map a pressed key to the configured action name (e.g. "professional", "quit"). */
  private actionForKey(key: string): string | undefined {
    return Object.keys(this.hotkeys).find((action) => this.hotkeys[action] === key);
  }

  private async runOptimizationLoop(): Promise<void> {
    while (true) {
      console.log('\n' + '═'.repeat(60));
      console.log(chalk.cyan('Current text:'));
      console.log(chalk.gray(this.currentText));
      console.log('═'.repeat(60));

      console.log(chalk.yellow(`\nPress a hotkey (${this.hotkeys.quit} or Ctrl+C to quit):`));

      const key = await this.captureKeypress();
      const action = this.actionForKey(key);

      if (key === CTRL_C || action === 'quit') {
        console.log('\n\nGoodbye! 👋\n');
        break;
      }

      if (action === 'reset') {
        this.currentText = this.originalText;
        console.log(chalk.yellow('\n↺ Reset to original'));
        continue;
      }

      if (action === 'history') {
        this.showHistory();
        continue;
      }

      if (action && MODE_BY_ACTION[action]) {
        await this.performOptimization(MODE_BY_ACTION[action]);
        continue;
      }

      const customPrompt = this.customPromptLoader?.getPromptByHotkey(key);
      if (customPrompt) {
        await this.performCustomOptimization(customPrompt);
        continue;
      }

      displayInfo(`Unknown hotkey "${key.trim() || key}".`);
    }
  }

  private async performOptimization(mode: OptimizationMode): Promise<void> {
    displayModeInfo(mode);
    await this.runAndOffer((genOptions) =>
      this.optimizer.optimize(this.currentText, mode, genOptions)
    );
  }

  private async performCustomOptimization(customPrompt: CustomPrompt): Promise<void> {
    console.log(chalk.yellow(`\n[${customPrompt.name}]`));
    console.log(chalk.gray(customPrompt.description));
    await this.runAndOffer((genOptions) =>
      this.optimizer.optimizeWithCustomPrompt(this.currentText, customPrompt, genOptions)
    );
  }

  /** Run an optimization, show the result and ask whether to keep it. */
  private async runAndOffer(
    run: (genOptions?: GenerateOptions) => Promise<OptimizationResult>
  ): Promise<void> {
    const spinner = new Spinner('Optimizing...', output);
    try {
      let streamedAny = false;
      let lastChunkEndedWithNewline = false;

      const genOptions: GenerateOptions | undefined = this.stream
        ? {
            onToken: (token: string) => {
              if (!streamedAny) {
                spinner.stop();
                console.log(chalk.gray('\n' + '─'.repeat(60)));
                console.log(chalk.red('\n❌ Original:'));
                console.log(chalk.gray(this.currentText));
                console.log(chalk.green('\n✅ Optimized:'));
                streamedAny = true;
              }
              output.write(chalk.white(token));
              lastChunkEndedWithNewline = token.endsWith('\n');
            },
          }
        : undefined;

      spinner.start();
      const result = await run(genOptions);
      spinner.stop();

      if (streamedAny) {
        if (!lastChunkEndedWithNewline) {
          output.write('\n');
        }
        console.log(chalk.gray('\n' + '─'.repeat(60)));
      } else {
        displayOptimization(result.original, result.optimized);
      }

      if (shouldShowWordDiff(result.original, result.optimized)) {
        displayWordDiff(result.original, result.optimized);
      }

      console.log(chalk.gray(`${spinner.elapsedSeconds()} · ${result.provider}/${result.model}`));

      const accept = await this.question('\nUse this version? (y/n): ');
      if (accept.trim().toLowerCase() === 'y') {
        this.currentText = result.optimized;
        displaySuccess('Text updated!');
      }
    } catch (error) {
      spinner.stop();
      displayError(error as Error);
    }
  }

  private showHistory(): void {
    if (!this.historyLogger) {
      displayInfo('History is disabled.');
      return;
    }

    const history = this.historyLogger.getRecentEntries(5);

    if (history.length === 0) {
      displayInfo('No history yet.');
      return;
    }

    console.log(chalk.cyan('\n📜 Recent Optimizations:\n'));

    for (const entry of history) {
      displayHistoryEntry(entry);
    }
  }

  /**
   * Ask a single line question. A fresh interface is used per question so that
   * keys captured in raw mode never leak into a readline line buffer.
   */
  private async question(query: string): Promise<string> {
    const rl = createInterface({ input, output });
    try {
      return await rl.question(query);
    } finally {
      rl.close();
    }
  }

  /** Read a single key press. Falls back to reading a line when stdin is not a TTY. */
  private async captureKeypress(): Promise<string> {
    if (!input.isTTY) {
      const line = await this.question('');
      return line.trim().charAt(0);
    }

    return new Promise((resolve) => {
      readline.emitKeypressEvents(input);
      const wasRaw = input.isRaw;
      input.setRawMode(true);
      input.resume();

      const onKeypress = (str: string | undefined, key?: readline.Key) => {
        input.off('keypress', onKeypress);
        input.setRawMode(wasRaw);
        input.pause();

        if (key?.ctrl && key.name === 'c') {
          resolve(CTRL_C);
        } else {
          resolve(str ?? key?.name ?? '');
        }
      };

      input.on('keypress', onKeypress);
    });
  }
}
