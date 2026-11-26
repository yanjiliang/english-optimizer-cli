import chalk from 'chalk';
import { CustomPrompt } from '../types';
import { CustomPromptLoader } from './custom';
import { displayInfo, displaySuccess } from '../utils/display';

export interface AddPromptCommandOptions {
  name?: string;
  description?: string;
  prompt?: string;
  hotkey?: string;
  force?: boolean;
  /** Optional hook for injecting interactive answers in tests. */
  promptUser?: (defaults: Partial<CustomPrompt>) => Promise<CustomPrompt>;
}

/** Display all configured custom prompts. */
export function listCustomPrompts(loader: CustomPromptLoader): void {
  const prompts = loader.getCustomPrompts();

  if (prompts.length === 0) {
    displayInfo(`No custom prompts found in ${loader.getPromptsPath()}.`);
    console.log(chalk.gray('  Add one with: cao prompts add\n'));
    return;
  }

  console.log(chalk.cyan(`\n🧩 Custom Prompts (${prompts.length}):\n`));
  for (const prompt of prompts) {
    const hotkeyTag = prompt.hotkey ? chalk.yellow(` [hotkey: ${prompt.hotkey}]`) : '';
    console.log(`  ${chalk.white.bold(prompt.name)}${hotkeyTag}`);
    console.log(`    ${chalk.gray(prompt.description)}`);
    console.log(`    ${chalk.gray(`Use: cao -m ${prompt.name} "..."`)}`);
    console.log('');
  }
  console.log(chalk.gray(`File: ${loader.getPromptsPath()}`));
  console.log(
    chalk.gray('Commands: cao prompts show <name> · cao prompts add · cao prompts remove <name>\n')
  );
}

/** Display a single custom prompt's full details and template. */
export function showCustomPrompt(loader: CustomPromptLoader, name: string): CustomPrompt {
  const prompt = loader.getPromptByName(name);
  if (!prompt) {
    throw new Error(`Custom prompt "${name}" not found.`);
  }

  console.log(chalk.cyan(`\n🧩 Custom Prompt: ${prompt.name}\n`));
  console.log(`${chalk.gray('Description:')} ${prompt.description}`);
  console.log(`${chalk.gray('Hotkey:     ')} ${prompt.hotkey || 'None'}`);
  console.log(`${chalk.gray('Usage:      ')} cao -m ${prompt.name} "your text"`);
  console.log(chalk.gray('\nPrompt template:'));
  console.log(chalk.gray('─'.repeat(70)));
  console.log(prompt.prompt);
  console.log(chalk.gray('─'.repeat(70) + '\n'));

  return prompt;
}

/** Add (or overwrite with --force) a custom prompt via flags or interactive wizard. */
export async function addCustomPrompt(
  loader: CustomPromptLoader,
  options: AddPromptCommandOptions = {}
): Promise<CustomPrompt> {
  let name = options.name?.trim() || '';
  let description = options.description?.trim() || '';
  let promptTemplate = options.prompt?.trim() || '';
  let hotkey = options.hotkey?.trim() || undefined;

  if (!name || !promptTemplate) {
    if (options.promptUser) {
      const answered = await options.promptUser({
        name,
        description,
        prompt: promptTemplate,
        hotkey,
      });
      name = answered.name;
      description = answered.description;
      promptTemplate = answered.prompt;
      hotkey = answered.hotkey;
    } else if (process.stdin.isTTY) {
      const { default: inquirer } = await import('inquirer');
      console.log(chalk.cyan.bold('\n🧩 Add Custom Prompt\n'));
      const answers = await inquirer.prompt<{
        name: string;
        description: string;
        prompt: string;
        hotkey: string;
      }>([
        {
          type: 'input',
          name: 'name',
          message: 'Prompt name (used with cao -m <name>):',
          default: name || undefined,
          validate: (val: string) => (val.trim() ? true : 'Name is required'),
        },
        {
          type: 'input',
          name: 'description',
          message: 'Short description:',
          default: description || undefined,
        },
        {
          type: 'input',
          name: 'prompt',
          message: 'Prompt template (use {text} as placeholder, or omit to append text):',
          default: promptTemplate || undefined,
          validate: (val: string) => (val.trim() ? true : 'Prompt template is required'),
        },
        {
          type: 'input',
          name: 'hotkey',
          message: 'Optional single-character hotkey for --classic mode (leave empty for none):',
          default: hotkey || '',
          validate: (val: string) =>
            !val.trim() || val.trim().length === 1
              ? true
              : 'Hotkey must be a single character or empty',
        },
      ]);

      name = answers.name;
      description = answers.description;
      promptTemplate = answers.prompt;
      hotkey = answers.hotkey.trim() || undefined;
    } else {
      throw new Error(
        'Missing required arguments in non-interactive mode. Provide a name and --prompt "<template>".'
      );
    }
  }

  const saved = loader.addPrompt(
    {
      name,
      description,
      prompt: promptTemplate,
      ...(hotkey ? { hotkey } : {}),
    },
    { overwrite: Boolean(options.force) }
  );

  displaySuccess(`Saved custom prompt "${saved.name}" to ${loader.getPromptsPath()}`);
  console.log(chalk.gray(`  Use it with: cao -m ${saved.name} "your text"\n`));
  return saved;
}

/** Remove a custom prompt by name. */
export function removeCustomPrompt(loader: CustomPromptLoader, name: string): void {
  const removed = loader.removePrompt(name);
  if (!removed) {
    throw new Error(`Custom prompt "${name}" not found.`);
  }
  displaySuccess(`Removed custom prompt "${name}".`);
}
