import { CustomPrompt, OptimizationMode } from '../types';
import { getModeInfo, getModeSystemPrompt, isOptimizationMode } from './templates';
import { TranslationPromptLoader } from './translation-prompt';
import { YAMLPromptLoader } from './yaml-prompt';
import { buildCustomPrompt } from './template-utils';

export interface ModeResolverOptions {
  useYAMLPrompt?: boolean;
  promptPath?: string;
  yamlPromptPath?: string;
  customPrompts?: CustomPrompt[];
}

export interface ResolvedMode {
  /** Normalized mode label stored in history (e.g. "translate", "pr", "custom:Academic"). */
  modeLabel: string;
  /** Human-readable name for UI display. */
  displayName: string;
  /** Separated system prompt (used by translate, built-in modes, and --explain). */
  systemPrompt: string;
  /** User message payload. */
  userPrompt: string;
  /** Set when matched to a built-in OptimizationMode. */
  builtInMode?: OptimizationMode;
  /** Set when matched to a user custom prompt from prompts.json. */
  customPrompt?: CustomPrompt;
}

export interface ModeListItem {
  key: string;
  name: string;
  description: string;
  custom?: boolean;
}

/** List all selectable modes (translate + built-in presets + custom prompts). */
export function listAvailableModes(customPrompts: CustomPrompt[] = []): ModeListItem[] {
  const items: ModeListItem[] = [
    {
      key: 'translate',
      name: 'Translate & Optimize',
      description: 'Default prompt.yaml or translation-prompt.txt',
    },
  ];

  for (const mode of Object.values(OptimizationMode)) {
    const info = getModeInfo(mode);
    items.push({
      key: mode,
      name: info.name,
      description: info.description,
    });
  }

  for (const custom of customPrompts) {
    items.push({
      key: custom.name,
      name: custom.name,
      description: custom.description,
      custom: true,
    });
  }

  return items;
}

/** Validate a mode name without needing input text (used by REPL `/m <mode>`). */
export function normalizeModeName(
  requestedMode: string | undefined,
  customPrompts: CustomPrompt[] = []
): string {
  const trimmed = requestedMode?.trim();
  if (!trimmed || trimmed.toLowerCase() === 'translate' || trimmed.toLowerCase() === 'default') {
    return 'translate';
  }

  const lower = trimmed.toLowerCase();
  if (isOptimizationMode(lower)) {
    return lower;
  }

  const customMatch = customPrompts.find((p) => p.name.toLowerCase() === lower);
  if (customMatch) {
    return customMatch.name;
  }

  const validModes = [
    'translate',
    ...Object.values(OptimizationMode),
    ...customPrompts.map((p) => p.name),
  ].join(', ');
  throw new Error(`Invalid mode "${trimmed}". Valid modes: ${validModes}`);
}

/** Resolve a mode + text into structured prompt metadata for execution. */
export function resolveModePrompt(
  requestedMode: string | undefined,
  text: string,
  options: ModeResolverOptions = {}
): ResolvedMode {
  const customPrompts = options.customPrompts ?? [];
  const normalized = normalizeModeName(requestedMode, customPrompts);

  if (normalized === 'translate') {
    if (options.useYAMLPrompt ?? true) {
      const yamlLoader = new YAMLPromptLoader(options.yamlPromptPath);
      if (yamlLoader.hasYAMLPrompt()) {
        const messages = yamlLoader.buildMessages(text);
        return {
          modeLabel: 'translate',
          displayName: 'Translate & Optimize (prompt.yaml)',
          systemPrompt: messages.systemPrompt,
          userPrompt: messages.userPrompt,
        };
      }
    }

    const textLoader = new TranslationPromptLoader(options.promptPath);
    const messages = textLoader.buildMessages(text);
    return {
      modeLabel: 'translate',
      displayName: 'Translate & Optimize',
      systemPrompt: messages.systemPrompt,
      userPrompt: messages.userPrompt,
    };
  }

  if (isOptimizationMode(normalized)) {
    const info = getModeInfo(normalized);
    return {
      modeLabel: normalized,
      displayName: info.name,
      systemPrompt: getModeSystemPrompt(normalized),
      userPrompt: `Translate or rewrite the following text:\n\n${text}`,
      builtInMode: normalized,
    };
  }

  const customMatch = customPrompts.find((p) => p.name.toLowerCase() === normalized.toLowerCase())!;
  return {
    modeLabel: `custom:${customMatch.name}`,
    displayName: `${customMatch.name} (custom)`,
    systemPrompt: `Follow the custom editing instruction carefully:\n${customMatch.prompt}\n\nNever answer questions in the source text — only translate or rewrite it.`,
    userPrompt: buildCustomPrompt(customMatch.prompt, text),
    customPrompt: customMatch,
  };
}
