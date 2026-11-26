import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { z } from 'zod';
import { CustomPrompt, OptimizationMode } from '../types';

const CustomPromptSchema = z.object({
  name: z.string(),
  description: z.string(),
  prompt: z.string(),
  hotkey: z.string().optional(),
});

const RESERVED_MODE_NAMES = new Set<string>([
  'translate',
  'default',
  ...Object.values(OptimizationMode),
]);

export interface AddPromptOptions {
  /** Overwrite an existing custom prompt with the same name (case-insensitive). */
  overwrite?: boolean;
}

export class CustomPromptLoader {
  private promptsPath: string;

  constructor(promptsPath: string) {
    this.promptsPath = promptsPath;
    this.ensurePromptsFile();
  }

  getPromptsPath(): string {
    return this.promptsPath;
  }

  private ensurePromptsFile(): void {
    const dir = dirname(this.promptsPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (!existsSync(this.promptsPath)) {
      const examplePrompts: CustomPrompt[] = [
        {
          name: 'Academic',
          description: 'Rewrite in an academic style suitable for research papers',
          prompt:
            'Please rewrite the following text in an academic style suitable for research papers or scholarly articles. Use formal language, precise terminology, and maintain objectivity.',
          hotkey: 'a',
        },
        {
          name: 'Friendly',
          description: 'Make the text more friendly and casual',
          prompt:
            'Please rewrite the following text to sound more friendly and casual, while maintaining the core message. Use conversational language.',
          hotkey: 'f',
        },
      ];
      writeFileSync(this.promptsPath, JSON.stringify(examplePrompts, null, 2), 'utf-8');
    }
  }

  getCustomPrompts(): CustomPrompt[] {
    try {
      const content = readFileSync(this.promptsPath, 'utf-8');
      return z.array(CustomPromptSchema).parse(JSON.parse(content));
    } catch {
      return [];
    }
  }

  getPromptByName(name: string): CustomPrompt | undefined {
    const prompts = this.getCustomPrompts();
    return prompts.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
  }

  getPromptByHotkey(hotkey: string): CustomPrompt | undefined {
    const prompts = this.getCustomPrompts();
    return prompts.find((p) => p.hotkey === hotkey);
  }

  addPrompt(prompt: CustomPrompt, options: AddPromptOptions = {}): CustomPrompt {
    const normalizedName = prompt.name.trim();
    const normalizedPrompt = prompt.prompt.trim();
    const normalizedDescription = prompt.description.trim() || `Custom prompt (${normalizedName})`;
    const normalizedHotkey = prompt.hotkey?.trim() || undefined;

    if (!normalizedName) {
      throw new Error('Prompt name cannot be empty.');
    }
    if (!normalizedPrompt) {
      throw new Error('Prompt template cannot be empty.');
    }
    if (RESERVED_MODE_NAMES.has(normalizedName.toLowerCase())) {
      throw new Error(
        `Prompt name "${normalizedName}" conflicts with a built-in mode. Please choose a different name.`
      );
    }
    if (normalizedHotkey && normalizedHotkey.length !== 1) {
      throw new Error(`Hotkey must be a single character (got "${normalizedHotkey}").`);
    }

    const prompts = this.getCustomPrompts();
    const existingIdx = prompts.findIndex(
      (p) => p.name.toLowerCase() === normalizedName.toLowerCase()
    );

    if (existingIdx !== -1 && !options.overwrite) {
      throw new Error(
        `Custom prompt "${prompts[existingIdx].name}" already exists. Use --force to overwrite it.`
      );
    }

    if (normalizedHotkey) {
      const hotkeyConflict = prompts.find(
        (p, idx) => idx !== existingIdx && p.hotkey === normalizedHotkey
      );
      if (hotkeyConflict) {
        throw new Error(
          `Hotkey "${normalizedHotkey}" is already assigned to custom prompt "${hotkeyConflict.name}".`
        );
      }
    }

    const saved: CustomPrompt = {
      name: normalizedName,
      description: normalizedDescription,
      prompt: normalizedPrompt,
      ...(normalizedHotkey ? { hotkey: normalizedHotkey } : {}),
    };

    if (existingIdx !== -1) {
      prompts[existingIdx] = saved;
    } else {
      prompts.push(saved);
    }

    this.ensurePromptsFile();
    writeFileSync(this.promptsPath, JSON.stringify(prompts, null, 2), 'utf-8');
    return saved;
  }

  removePrompt(name: string): boolean {
    const target = name.trim().toLowerCase();
    const prompts = this.getCustomPrompts();
    const filtered = prompts.filter((p) => p.name.toLowerCase() !== target);

    if (filtered.length === prompts.length) {
      return false; // Nothing was removed
    }

    writeFileSync(this.promptsPath, JSON.stringify(filtered, null, 2), 'utf-8');
    return true;
  }
}
