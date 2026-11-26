#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import axios from 'axios';
import { basename } from 'path';
import { spawnSync } from 'child_process';
import {
  applyCliOverrides,
  configManager,
  ConfigManager,
  sanitizeConfigForDisplay,
  validateProviderConfig,
} from './config/config';
import { createProvider } from './ai/provider';
import { Optimizer } from './core/optimizer';
import { InteractiveEditor } from './core/editor';
import { InstantEditor } from './core/instant-editor';
import { resolveOneShotInput, runOneShot } from './core/oneshot';
import { BatchProcessor } from './core/batch';
import { HistoryLogger } from './history/logger';
import { runHistoryCommand } from './history/commands';
import { CustomPromptLoader } from './prompts/custom';
import {
  addCustomPrompt,
  listCustomPrompts,
  removeCustomPrompt,
  showCustomPrompt,
} from './prompts/commands';
import { normalizeModeName } from './prompts/resolver';
import { CliConfigOverrides } from './types';
import { displayError, displayInfo } from './utils/display';
import packageJson from '../package.json';

const PACKAGE_NAME = 'english-optimizer-cli';
const PACKAGE_VERSION = packageJson.version;

const invokedBin = basename(process.argv[1] || '');
const CLI_NAME = invokedBin === 'eopt' ? 'eopt' : 'cao';

const program = new Command();

program
  .name(CLI_NAME)
  .description('CLI tool to help non-native English speakers improve their writing using AI')
  .version(PACKAGE_VERSION)
  .addHelpText(
    'after',
    `
Examples:
  $ ${CLI_NAME}                                   Start interactive mode (with /m, /v, /why, /star)
  $ ${CLI_NAME} "这个需求今天能做完，明天提测"      One-shot translate & copy to clipboard
  $ ${CLI_NAME} -m pr "这里会有空指针，加个判空"    Polite PR / code review comment
  $ ${CLI_NAME} -m commit "修复登录过期跳转问题"    Generate Conventional Commit message
  $ ${CLI_NAME} -v "明天能上线吗"                  Generate 3 tone variants (Casual / Neutral / Formal)
  $ ${CLI_NAME} -e "it's works very good"         Optimize with word diff & Chinese explanation
  $ ${CLI_NAME} -x                                Optimize clipboard contents and copy back
  $ echo "fix bug pls" | ${CLI_NAME} -m concise   Optimize piped stdin
  $ pbpaste | ${CLI_NAME} --raw | pbcopy          Clean pipeline (raw text only on stdout)
  $ ${CLI_NAME} batch README.md --dry-run         Preview Markdown-safe chunked diff
  $ ${CLI_NAME} history --starred --export pb.md  Export starred phrasebook to Markdown
  $ ${CLI_NAME} start --help                      Show all start/one-shot options
`
  );

function extractOverrides(options: { provider?: string; model?: string }): CliConfigOverrides {
  return {
    provider: options.provider as CliConfigOverrides['provider'],
    model: options.model,
  };
}

function getCustomPromptLoader(): CustomPromptLoader {
  const config = configManager.getConfig();
  ConfigManager.ensureConfigDir();
  return new CustomPromptLoader(config.features.customPromptsPath);
}

function openFileInEditor(filePath: string): boolean {
  const editorCmd = (
    process.env.VISUAL ||
    process.env.EDITOR ||
    (process.platform === 'win32' ? 'notepad' : 'vi')
  ).trim();
  const [bin, ...editorArgs] = editorCmd.split(/\s+/);
  const result = spawnSync(bin, [...editorArgs, filePath], { stdio: 'inherit' });
  return !result.error && result.status === 0;
}

program
  .command('start', { isDefault: true })
  .description('Start interactive mode, or optimize text directly via args / stdin / clipboard')
  .argument('[text...]', 'Text to optimize directly (one-shot mode)')
  .option('-c, --classic', 'Use classic interactive mode (hotkey style switching)', false)
  .option(
    '-m, --mode <mode>',
    'Optimization mode (translate, slack, pr, commit, email, professional, concise, grammar, senior_developer, or custom prompt name)'
  )
  .option('-e, --explain', 'Include brief Chinese explanation of key improvements', false)
  .option('-v, --variants', 'Generate 3 tone variants (Casual / Neutral / Formal)', false)
  .option('--diff', 'Always display inline word-level diff', false)
  .option('-x, --clip', 'Read text from clipboard and copy optimized result back', false)
  .option('-q, --raw', 'Output only the optimized text (ideal for pipes and scripts)', false)
  .option('--copy', 'Copy result to clipboard')
  .option('--no-copy', 'Do not copy result to clipboard')
  .option('--no-stream', 'Disable streaming output')
  .option('-p, --provider <provider>', 'Override AI provider (ollama or api)')
  .option('--model <model>', 'Override AI model for the active provider')
  .action(async (text: string[], options) => {
    try {
      const config = applyCliOverrides(configManager.getConfig(), extractOverrides(options));
      validateProviderConfig(config);

      // Initialize provider (connectivity errors surface directly on request; use `cao test` to probe)
      const provider = createProvider(config);

      // Initialize optional features
      let historyLogger: HistoryLogger | undefined;
      if (config.features.enableHistory) {
        ConfigManager.ensureConfigDir();
        historyLogger = new HistoryLogger(config.features.historyPath);
      }

      let customPromptLoader: CustomPromptLoader | undefined;
      if (config.features.enableCustomPrompts) {
        ConfigManager.ensureConfigDir();
        customPromptLoader = new CustomPromptLoader(config.features.customPromptsPath);
      }

      // Initialize optimizer
      const optimizer = new Optimizer(provider, historyLogger);

      // One-shot path: clipboard, positional text args, or piped stdin
      if (!options.classic) {
        const oneShotInput = await resolveOneShotInput({
          textArgs: text,
          clip: Boolean(options.clip),
        });

        if (oneShotInput) {
          await runOneShot({
            text: oneShotInput.text,
            optimizer,
            mode: options.mode,
            useYAMLPrompt: config.features.useYAMLPrompt,
            customPrompts: customPromptLoader?.getCustomPrompts(),
            raw: Boolean(options.raw),
            clip: Boolean(options.clip),
            copy: options.copy,
            stream: options.stream,
            explain: Boolean(options.explain),
            variants: Boolean(options.variants),
            diff: Boolean(options.diff),
          });
          return;
        }
      }

      // Interactive editor (instant mode by default, or classic mode with flag)
      if (options.classic) {
        const editor = new InteractiveEditor(
          optimizer,
          historyLogger,
          customPromptLoader,
          config.hotkeys,
          { stream: options.stream }
        );
        await editor.start();
      } else {
        const editor = new InstantEditor(optimizer, {
          useYAMLPrompt: config.features.useYAMLPrompt,
          stream: options.stream,
          autoCopy: options.copy ?? true,
          initialMode: options.mode,
          customPrompts: customPromptLoader?.getCustomPrompts(),
          historyLogger,
        });
        await editor.start();
      }
    } catch (error) {
      displayError(error as Error);
      process.exit(1);
    }
  });

program
  .command('history')
  .description('View, search, star, copy, export, or clear optimization history')
  .option('-n, --number <count>', 'Number of entries to show (0 for all, default: 10)')
  .option('-a, --all', 'Show all matching history entries', false)
  .option('--full', 'Show full original/optimized text without truncation', false)
  .option('-s, --search <query>', 'Search history by original, optimized text, or mode')
  .option('--starred', 'Show only starred phrasebook entries', false)
  .option('-m, --mode <mode>', 'Filter history by mode')
  .option('--star <indexOrId>', 'Star an entry by #index or ID prefix')
  .option('--unstar <indexOrId>', 'Remove star from an entry by #index or ID prefix')
  .option('-c, --copy <indexOrId>', 'Copy an entry’s optimized text to clipboard by #index or ID')
  .option(
    '--export <file>',
    'Export matching entries to Markdown (.md), JSON (.json), or "-" stdout'
  )
  .option('--clear', 'Clear optimization history', false)
  .option('--keep-starred', 'Keep starred entries when using --clear', false)
  .action((options) => {
    try {
      const config = configManager.getConfig();

      if (!config.features.enableHistory) {
        displayInfo('History is disabled in configuration.');
        process.exit(0);
      }

      ConfigManager.ensureConfigDir();
      const historyLogger = new HistoryLogger(config.features.historyPath);
      runHistoryCommand(historyLogger, options);
    } catch (error) {
      displayError(error as Error);
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Show current configuration or run setup wizard')
  .option('-s, --setup', 'Run interactive setup wizard', false)
  .option('--show-secrets', 'Display unmasked API keys', false)
  .action(async (options) => {
    try {
      if (options.setup) {
        const { runConfigWizard } = await import('./config/wizard');
        await runConfigWizard();
      } else {
        const config = configManager.getConfig();
        const displayConfig = options.showSecrets ? config : sanitizeConfigForDisplay(config);
        console.log(JSON.stringify(displayConfig, null, 2));
      }
    } catch (error) {
      displayError(error as Error);
      process.exit(1);
    }
  });

const promptsCommand = program
  .command('prompts')
  .description('Manage custom prompts (list, show, add, remove)')
  .action(() => {
    try {
      listCustomPrompts(getCustomPromptLoader());
    } catch (error) {
      displayError(error as Error);
      process.exit(1);
    }
  });

promptsCommand
  .command('list')
  .alias('ls')
  .description('List all custom prompts')
  .action(() => {
    try {
      listCustomPrompts(getCustomPromptLoader());
    } catch (error) {
      displayError(error as Error);
      process.exit(1);
    }
  });

promptsCommand
  .command('show')
  .description('Show details and template of a custom prompt')
  .argument('<name>', 'Name of the custom prompt')
  .action((name: string) => {
    try {
      showCustomPrompt(getCustomPromptLoader(), name);
    } catch (error) {
      displayError(error as Error);
      process.exit(1);
    }
  });

promptsCommand
  .command('add')
  .description('Add a new custom prompt (interactive if required flags are omitted)')
  .argument('[name]', 'Name of the custom prompt (used with -m <name>)')
  .option('-d, --description <desc>', 'Short description')
  .option('-p, --prompt <template>', 'Prompt template (use {text} placeholder)')
  .option('-k, --hotkey <key>', 'Optional single-character hotkey for --classic mode')
  .option('-f, --force', 'Overwrite if a custom prompt with the same name exists', false)
  .action(async (name: string | undefined, options) => {
    try {
      await addCustomPrompt(getCustomPromptLoader(), {
        name,
        description: options.description,
        prompt: options.prompt,
        hotkey: options.hotkey,
        force: Boolean(options.force),
      });
    } catch (error) {
      displayError(error as Error);
      process.exit(1);
    }
  });

promptsCommand
  .command('remove')
  .aliases(['rm', 'delete'])
  .description('Remove a custom prompt by name')
  .argument('<name>', 'Name of the custom prompt to remove')
  .action((name: string) => {
    try {
      removeCustomPrompt(getCustomPromptLoader(), name);
    } catch (error) {
      displayError(error as Error);
      process.exit(1);
    }
  });

promptsCommand
  .command('path')
  .description('Print path to prompts.json')
  .action(() => {
    try {
      console.log(getCustomPromptLoader().getPromptsPath());
    } catch (error) {
      displayError(error as Error);
      process.exit(1);
    }
  });

program
  .command('prompt')
  .description('Manage translation prompt template (prompt.yaml / translation-prompt.txt)')
  .option('-e, --edit', 'Edit the active prompt file in $EDITOR', false)
  .option('-s, --show', 'Show the active prompt file contents', false)
  .option('-r, --raw', 'Output raw prompt contents without headers (with --show)', false)
  .action(async (options) => {
    try {
      const config = configManager.getConfig();
      const { TranslationPromptLoader } = await import('./prompts/translation-prompt');
      const { YAMLPromptLoader } = await import('./prompts/yaml-prompt');

      const yamlPromptLoader = new YAMLPromptLoader();
      const textPromptLoader = new TranslationPromptLoader();

      const useYAML = config.features.useYAMLPrompt && yamlPromptLoader.hasYAMLPrompt();

      if (options.show) {
        const rawContent = useYAML
          ? (yamlPromptLoader.getRawContent() ?? '')
          : textPromptLoader.getPrompt();

        if (options.raw || !process.stdout.isTTY) {
          process.stdout.write(rawContent.endsWith('\n') ? rawContent : `${rawContent}\n`);
          return;
        }

        if (useYAML) {
          console.log(chalk.cyan(`\n📄 YAML Prompt file: ${yamlPromptLoader.getPromptPath()}\n`));
        } else {
          console.log(
            chalk.cyan(`\n📄 Prompt file location: ${textPromptLoader.getPromptPath()}\n`)
          );
        }
        console.log(chalk.gray('─'.repeat(70)));
        console.log(rawContent.trimEnd());
        console.log(chalk.gray('─'.repeat(70) + '\n'));
      } else if (options.edit) {
        const promptPath = useYAML
          ? yamlPromptLoader.getPromptPath()
          : textPromptLoader.getPromptPath();
        // Ensure default text prompt exists before opening editor
        if (!useYAML) {
          textPromptLoader.getPrompt();
        }
        console.log(`\n📝 Opening ${promptPath} in your default editor...\n`);
        if (!openFileInEditor(promptPath)) {
          console.log(chalk.yellow('\n⚠️  Could not open editor. Please edit manually:'));
          console.log(chalk.gray(promptPath));
        }
      } else {
        if (useYAML) {
          console.log(`\n📄 YAML Prompt file: ${yamlPromptLoader.getPromptPath()}`);
          console.log(chalk.cyan('\n✓ Using YAML prompt configuration'));
        } else {
          console.log(`\n📄 Prompt file location: ${textPromptLoader.getPromptPath()}`);
          if (!config.features.useYAMLPrompt && yamlPromptLoader.hasYAMLPrompt()) {
            console.log(
              chalk.gray(
                `  (YAML prompt exists at ${yamlPromptLoader.getPromptPath()}, but features.useYAMLPrompt is false)`
              )
            );
          }
        }
        console.log(chalk.gray('\nCommands:'));
        console.log(`  ${CLI_NAME} prompt --show        Show current prompt (raw YAML or text)`);
        console.log(`  ${CLI_NAME} prompt --show --raw  Print raw file only (for piping)`);
        console.log(`  ${CLI_NAME} prompt --edit        Edit active prompt file`);
        console.log(chalk.gray('\nEdit the file directly to customize translation behavior.\n'));
      }
    } catch (error) {
      displayError(error as Error);
      process.exit(1);
    }
  });

program
  .command('batch')
  .description('Batch optimize files with Markdown-safe chunking')
  .argument('<files...>', 'Files to optimize')
  .option(
    '-m, --mode <mode>',
    'Optimization mode (translate, professional, concise, grammar, senior_developer, slack, pr, commit, email, or custom prompt name)',
    'professional'
  )
  .option('-i, --in-place', 'Modify files in place', false)
  .option('-s, --suffix <suffix>', 'Output file suffix', '.optimized')
  .option('--dry-run', 'Preview diffs without writing any files', false)
  .option('--chunk-size <chars>', 'Max characters per prose chunk (default: 2500)')
  .option('-p, --provider <provider>', 'Override AI provider (ollama or api)')
  .option('--model <model>', 'Override AI model for the active provider')
  .action(async (files: string[], options) => {
    try {
      const config = applyCliOverrides(configManager.getConfig(), extractOverrides(options));

      let customPromptLoader: CustomPromptLoader | undefined;
      if (config.features.enableCustomPrompts) {
        ConfigManager.ensureConfigDir();
        customPromptLoader = new CustomPromptLoader(config.features.customPromptsPath);
      }
      const customPrompts = customPromptLoader?.getCustomPrompts();

      // Validate mode upfront before creating provider
      const mode = normalizeModeName(options.mode, customPrompts);

      let maxChunkChars: number | undefined;
      if (options.chunkSize !== undefined) {
        const parsed = Number.parseInt(options.chunkSize, 10);
        if (!Number.isFinite(parsed) || parsed < 200) {
          throw new Error('--chunk-size must be an integer >= 200.');
        }
        maxChunkChars = parsed;
      }

      validateProviderConfig(config);
      const provider = createProvider(config);

      // Initialize optimizer
      let historyLogger: HistoryLogger | undefined;
      if (config.features.enableHistory) {
        ConfigManager.ensureConfigDir();
        historyLogger = new HistoryLogger(config.features.historyPath);
      }

      const optimizer = new Optimizer(provider, historyLogger);
      const batchProcessor = new BatchProcessor(optimizer);

      const summary = await batchProcessor.processBatch({
        files,
        mode,
        inPlace: Boolean(options.inPlace),
        outputSuffix: options.suffix,
        dryRun: Boolean(options.dryRun),
        maxChunkChars,
        useYAMLPrompt: config.features.useYAMLPrompt,
        customPrompts,
      });

      if (summary.failed > 0) {
        process.exit(1);
      }
    } catch (error) {
      displayError(error as Error);
      process.exit(1);
    }
  });

program
  .command('update')
  .description('Update to the latest version')
  .action(async () => {
    try {
      console.log(chalk.cyan('\n🔄 Checking for updates...\n'));

      // Get current version
      const currentVersion = packageJson.version;

      // Fetch latest version from npm
      try {
        const response = await axios.get(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`);
        const latestVersion = response.data.version;

        console.log(chalk.gray(`Current version: ${currentVersion}`));
        console.log(chalk.gray(`Latest version: ${latestVersion}\n`));

        if (currentVersion === latestVersion) {
          console.log(chalk.green('✅ You are already using the latest version!\n'));
        } else {
          console.log(chalk.yellow('⚠️  A new version is available!\n'));
          console.log(chalk.cyan('To update, run:'));
          console.log(chalk.white.bold('  npm update -g english-optimizer-cli\n'));
          console.log(chalk.gray('Or reinstall:'));
          console.log(chalk.gray('  npm install -g english-optimizer-cli@latest\n'));
        }
      } catch {
        console.log(chalk.yellow('⚠️  Could not check for updates.\n'));
        console.log(chalk.gray('Please check manually:'));
        console.log(chalk.gray('  npm view english-optimizer-cli version\n'));
      }
    } catch (error) {
      displayError(error as Error);
      process.exit(1);
    }
  });

program
  .command('test')
  .description('Test API configuration and connection')
  .option('-p, --provider <provider>', 'Override AI provider (ollama or api)')
  .option('--model <model>', 'Override AI model for the active provider')
  .action(async (options) => {
    try {
      const { testConfiguration } = await import('./config/test');
      await testConfiguration(extractOverrides(options));
    } catch (error) {
      displayError(error as Error);
      process.exit(1);
    }
  });

program.parse();
