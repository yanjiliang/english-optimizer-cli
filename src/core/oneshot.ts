import readline from 'readline';
import { StringDecoder } from 'string_decoder';
import chalk from 'chalk';
import clipboardy from 'clipboardy';
import { CustomPrompt, GenerateOptions, OptimizationResult, TextVariant } from '../types';
import { Optimizer } from './optimizer';
import { resolveModePrompt } from '../prompts/resolver';
import {
  buildExplainPrompts,
  buildVariantsPrompts,
  parseExplainResponse,
  parseVariantsResponse,
} from '../prompts/structured';
import { formatWordDiff, shouldShowWordDiff } from '../utils/display';
import { Spinner, SpinnerStream } from '../utils/spinner';

export interface OneShotInput {
  text: string;
  source: 'arg' | 'clip' | 'stdin';
}

export interface ResolveInputOptions {
  textArgs: string[];
  clip: boolean;
  isStdinTTY?: boolean;
  readClipboard?: () => string;
  readStdinFn?: () => Promise<string>;
}

export interface RunOneShotOptions {
  text: string;
  optimizer: Optimizer;
  mode?: string;
  useYAMLPrompt?: boolean;
  promptPath?: string;
  yamlPromptPath?: string;
  customPrompts?: CustomPrompt[];
  raw?: boolean;
  clip?: boolean;
  copy?: boolean;
  stream?: boolean;
  explain?: boolean;
  variants?: boolean;
  diff?: boolean;
  stdout?: SpinnerStream;
  stderr?: SpinnerStream;
  stdinIsTTY?: boolean;
  writeClipboard?: (text: string) => void;
  pickVariant?: (variants: TextVariant[]) => Promise<number | null>;
}

/** Read all UTF-8 text from a readable stream (defaults to process.stdin). */
export async function readStdin(stream: NodeJS.ReadableStream = process.stdin): Promise<string> {
  const decoder = new StringDecoder('utf8');
  let data = '';

  for await (const chunk of stream) {
    data += typeof chunk === 'string' ? chunk : decoder.write(chunk as Buffer);
  }
  data += decoder.end();

  return data.trim();
}

/**
 * Determine whether the invocation should run in one-shot mode (clipboard,
 * positional text arguments, or piped stdin) or fall through to interactive mode.
 */
export async function resolveOneShotInput(
  options: ResolveInputOptions
): Promise<OneShotInput | null> {
  if (options.clip) {
    let clipText: string;
    try {
      const reader = options.readClipboard ?? (() => clipboardy.readSync());
      clipText = reader().trim();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read from clipboard: ${msg}`);
    }
    if (!clipText) {
      throw new Error('Clipboard is empty. Copy some text first, then run "cao --clip".');
    }
    return { text: clipText, source: 'clip' };
  }

  if (options.textArgs.length > 0) {
    const joined = options.textArgs.join(' ').trim();
    if (!joined) {
      throw new Error('Input text is empty.');
    }
    return { text: joined, source: 'arg' };
  }

  const isStdinTTY = options.isStdinTTY ?? Boolean(process.stdin.isTTY);
  if (!isStdinTTY) {
    const reader = options.readStdinFn ?? (() => readStdin());
    const stdinText = (await reader()).trim();
    if (!stdinText) {
      throw new Error(
        'No input received from stdin. Pipe text into cao, pass text as an argument, or run in an interactive terminal.'
      );
    }
    return { text: stdinText, source: 'stdin' };
  }

  return null;
}

/** Prompt the user with a single keypress to pick which variant (1..N) to copy. */
async function promptVariantSelection(
  variants: TextVariant[],
  stderr: SpinnerStream
): Promise<number | null> {
  const max = variants.length;
  stderr.write(chalk.yellow(`\nCopy version [1-${max}, Enter=1, q=skip]: `));

  return new Promise((resolve) => {
    const input = process.stdin;
    readline.emitKeypressEvents(input);
    const wasRaw = input.isRaw;
    input.setRawMode(true);
    input.resume();

    const finish = (choice: number | null) => {
      input.off('keypress', onKeypress);
      input.setRawMode(wasRaw);
      input.pause();
      stderr.write('\n');
      resolve(choice);
    };

    const onKeypress = (str: string | undefined, key?: readline.Key) => {
      if ((key?.ctrl && key.name === 'c') || key?.name === 'escape' || str?.toLowerCase() === 'q') {
        finish(null);
        return;
      }
      if (key?.name === 'return' || key?.name === 'enter') {
        finish(0);
        return;
      }
      if (str && /^[1-9]$/.test(str)) {
        const idx = parseInt(str, 10) - 1;
        if (idx >= 0 && idx < max) {
          finish(idx);
        }
      }
    };

    input.on('keypress', onKeypress);
  });
}

function tryCopy(
  text: string,
  writeClipboard: (t: string) => void
): { copied: boolean; copyFailed: boolean } {
  try {
    writeClipboard(text);
    return { copied: true, copyFailed: false };
  } catch {
    return { copied: false, copyFailed: true };
  }
}

/** Execute a single non-interactive optimization and write output / clipboard. */
export async function runOneShot(options: RunOneShotOptions): Promise<OptimizationResult> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const writeClipboard = options.writeClipboard ?? ((t: string) => clipboardy.writeSync(t));
  const stdinIsTTY = options.stdinIsTTY ?? Boolean(process.stdin.isTTY);

  const isRaw = Boolean(options.raw || !stdout.isTTY);
  const shouldStream = Boolean((options.stream ?? true) && !isRaw);
  const shouldCopy = options.copy !== undefined ? options.copy : Boolean(options.clip || !isRaw);

  const resolved = resolveModePrompt(options.mode, options.text, {
    useYAMLPrompt: options.useYAMLPrompt,
    promptPath: options.promptPath,
    yamlPromptPath: options.yamlPromptPath,
    customPrompts: options.customPrompts,
  });

  // --- Variants branch (--variants / -v) ---
  if (options.variants) {
    const modeHint = options.mode ? resolved.displayName : undefined;
    const prompts = buildVariantsPrompts(options.text, modeHint);
    const spinner = new Spinner('Generating tone variants...', stderr);
    let rawOutput: string;

    if (!isRaw) {
      spinner.start();
    }
    try {
      rawOutput = await options.optimizer.generateRaw(prompts.userPrompt, {
        systemPrompt: prompts.systemPrompt,
      });
    } finally {
      spinner.stop();
    }

    const variants = parseVariantsResponse(rawOutput);
    if (variants.length === 0) {
      throw new Error('Could not parse tone variants from model response.');
    }

    if (isRaw) {
      for (const [idx, variant] of variants.entries()) {
        stdout.write(`[${idx + 1}] ${variant.tone}: ${variant.text}\n`);
      }
      const primary = variants[0];
      const result = options.optimizer.recordResult(options.text, primary.text, 'variants');
      if (shouldCopy) {
        const { copyFailed } = tryCopy(primary.text, writeClipboard);
        if (copyFailed) {
          stderr.write('Warning: failed to copy result to clipboard.\n');
        }
      }
      return result;
    }

    for (const [idx, variant] of variants.entries()) {
      const header =
        variant.label && variant.label !== variant.tone
          ? `[${idx + 1}] ${variant.tone} — ${variant.label}`
          : `[${idx + 1}] ${variant.tone}`;
      stdout.write(chalk.yellow(header) + '\n');
      stdout.write(chalk.white.bold(variant.text) + '\n');
      if (idx < variants.length - 1) {
        stdout.write('\n');
      }
    }

    let selectedIndex: number | null = null;
    if (shouldCopy) {
      if (options.pickVariant) {
        selectedIndex = await options.pickVariant(variants);
      } else if (stdinIsTTY && variants.length > 1) {
        selectedIndex = await promptVariantSelection(variants, stderr);
      } else {
        selectedIndex = 0;
      }
    }

    const chosen = selectedIndex !== null ? variants[selectedIndex] : variants[0];
    const result = options.optimizer.recordResult(options.text, chosen.text, 'variants');

    const metaParts = [
      chalk.gray(`${spinner.elapsedSeconds()} · ${result.provider}/${result.model}`),
    ];
    if (shouldCopy && selectedIndex !== null) {
      const { copied, copyFailed } = tryCopy(chosen.text, writeClipboard);
      if (copied) {
        metaParts.push(chalk.green(`✓ Copied [${selectedIndex + 1}] ${chosen.tone} to clipboard`));
      } else if (copyFailed) {
        metaParts.push(chalk.yellow('⚠ Failed to copy to clipboard'));
      }
    }
    stderr.write(`\n${metaParts.join(chalk.gray('  │  '))}\n`);
    return result;
  }

  // --- Explain branch (--explain / -e) ---
  if (options.explain) {
    const prompts = buildExplainPrompts(resolved.systemPrompt, options.text);
    const spinner = new Spinner('Optimizing & explaining...', stderr);
    let rawOutput: string;

    if (!isRaw) {
      spinner.start();
    }
    try {
      rawOutput = await options.optimizer.generateRaw(prompts.userPrompt, {
        systemPrompt: prompts.systemPrompt,
      });
    } finally {
      spinner.stop();
    }

    const parsed = parseExplainResponse(rawOutput);
    const result = options.optimizer.recordResult(
      options.text,
      parsed.optimized,
      resolved.modeLabel
    );

    if (isRaw) {
      stdout.write(result.optimized + '\n');
      if (parsed.explanation) {
        stderr.write('\n' + parsed.explanation + '\n');
      }
    } else {
      stdout.write(chalk.white.bold(result.optimized) + '\n');
      if (options.diff || shouldShowWordDiff(options.text, result.optimized)) {
        stderr.write(
          chalk.cyan('\n🔍 Changes:\n') + formatWordDiff(options.text, result.optimized) + '\n'
        );
      }
      if (parsed.explanation) {
        stderr.write(chalk.cyan('\n💡 Why / 改进要点:\n') + chalk.gray(parsed.explanation) + '\n');
      }
    }

    const copyStatus = shouldCopy
      ? tryCopy(result.optimized, writeClipboard)
      : { copied: false, copyFailed: false };

    if (!isRaw) {
      const metaParts = [
        chalk.gray(`${spinner.elapsedSeconds()} · ${result.provider}/${result.model}`),
      ];
      if (copyStatus.copied) {
        metaParts.push(chalk.green('✓ Copied to clipboard'));
      } else if (copyStatus.copyFailed) {
        metaParts.push(chalk.yellow('⚠ Failed to copy to clipboard'));
      }
      stderr.write(`\n${metaParts.join(chalk.gray('  │  '))}\n`);
    } else if (copyStatus.copyFailed) {
      stderr.write('Warning: failed to copy result to clipboard.\n');
    }

    return result;
  }

  // --- Standard optimization path ---
  const execute = (genOptions?: GenerateOptions): Promise<OptimizationResult> => {
    if (resolved.builtInMode) {
      return options.optimizer.optimize(options.text, resolved.builtInMode, genOptions);
    }
    if (resolved.customPrompt) {
      return options.optimizer.optimizeWithCustomPrompt(
        options.text,
        resolved.customPrompt,
        genOptions
      );
    }
    return options.optimizer.generate(options.text, resolved.userPrompt, resolved.modeLabel, {
      ...genOptions,
      systemPrompt: resolved.systemPrompt,
    });
  };

  let result: OptimizationResult;
  const spinner = new Spinner('Optimizing...', stderr);

  if (isRaw) {
    result = await execute();
    stdout.write(result.optimized + '\n');
  } else {
    let streamedAny = false;
    let lastChunkEndedWithNewline = false;

    const genOptions: GenerateOptions | undefined = shouldStream
      ? {
          onToken: (token: string) => {
            if (!streamedAny) {
              spinner.stop();
              streamedAny = true;
            }
            stdout.write(chalk.white.bold(token));
            lastChunkEndedWithNewline = token.endsWith('\n');
          },
        }
      : undefined;

    spinner.start();
    try {
      result = await execute(genOptions);
    } finally {
      spinner.stop();
    }

    if (streamedAny) {
      if (!lastChunkEndedWithNewline) {
        stdout.write('\n');
      }
    } else {
      stdout.write(chalk.white.bold(result.optimized) + '\n');
    }

    if (options.diff || shouldShowWordDiff(options.text, result.optimized)) {
      stderr.write(
        chalk.cyan('\n🔍 Changes:\n') + formatWordDiff(options.text, result.optimized) + '\n'
      );
    }
  }

  const copyStatus = shouldCopy
    ? tryCopy(result.optimized, writeClipboard)
    : { copied: false, copyFailed: false };

  if (!isRaw) {
    const metaParts = [
      chalk.gray(`${spinner.elapsedSeconds()} · ${result.provider}/${result.model}`),
    ];
    if (copyStatus.copied) {
      metaParts.push(chalk.green('✓ Copied to clipboard'));
    } else if (copyStatus.copyFailed) {
      metaParts.push(chalk.yellow('⚠ Failed to copy to clipboard'));
    }
    stderr.write(`\n${metaParts.join(chalk.gray('  │  '))}\n`);
  } else if (copyStatus.copyFailed) {
    stderr.write('Warning: failed to copy result to clipboard.\n');
  }

  return result;
}
