import { z } from 'zod';
import { chmodSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import dotenv from 'dotenv';
import * as yaml from 'js-yaml';
import {
  API_PROVIDERS,
  type ApiProviderName,
  type CliConfigOverrides,
  type Config,
} from '../types';

export const CONFIG_DIR = join(homedir(), '.english-optimizer');
const CONFIG_FILE_YAML_NAME = 'config.yaml';
const CONFIG_FILE_JSON_NAME = 'config.json';

/** Prefix for this tool's environment variables, e.g. CAO_API_KEY. */
export const ENV_PREFIX = 'CAO_';

/**
 * Load .env files without overriding variables already set in the shell.
 *
 * - `~/.english-optimizer/.env` belongs to this tool, so every key is loaded.
 * - `./.env` usually belongs to whatever project the user is in, so only
 *   `CAO_*` keys are taken from it. This keeps an unrelated project's
 *   `AI_PROVIDER` / `API_KEY` from hijacking the CLI.
 */
export function loadDotenvFiles(cwd: string = process.cwd(), configDir: string = CONFIG_DIR): void {
  const userEnvPath = join(configDir, '.env');
  if (existsSync(userEnvPath)) {
    dotenv.config({ path: userEnvPath, quiet: true });
  }

  const cwdEnvPath = resolve(cwd, '.env');
  if (cwdEnvPath !== userEnvPath && existsSync(cwdEnvPath)) {
    try {
      const parsed = dotenv.parse(readFileSync(cwdEnvPath));
      for (const [key, value] of Object.entries(parsed)) {
        if (key.startsWith(ENV_PREFIX) && process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    } catch {
      // Ignore unreadable .env files in the working directory
    }
  }
}

/** Expand a leading `~` so paths from config files work with fs APIs. */
export function expandHome(path: string): string {
  if (path === '~') {
    return homedir();
  }
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/** Mask an API key for safe terminal display (e.g. "sk-p****cdef"). */
export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.length <= 8) {
    return '****';
  }
  if (trimmed.length <= 12) {
    return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

/** Return a copy of config with sensitive credentials masked for display. */
export function sanitizeConfigForDisplay(config: Config): Config {
  return {
    ...config,
    ai: {
      ...config.ai,
      ollama: config.ai.ollama ? { ...config.ai.ollama } : undefined,
      api: config.ai.api
        ? {
            ...config.ai.api,
            apiKey: maskApiKey(config.ai.api.apiKey),
          }
        : undefined,
    },
    hotkeys: { ...config.hotkeys },
    features: { ...config.features },
  };
}

// Zod schema for validation
const ConfigSchema = z.object({
  ai: z.object({
    provider: z.enum(['ollama', 'api']),
    ollama: z
      .object({
        baseUrl: z.string().url(),
        model: z.string(),
      })
      .optional(),
    api: z
      .object({
        provider: z.enum(API_PROVIDERS),
        apiKey: z.string(),
        baseUrl: z.string().url(),
        model: z.string(),
      })
      .optional(),
  }),
  hotkeys: z.record(z.string(), z.string()),
  features: z.object({
    enableHistory: z.boolean(),
    historyPath: z.string().transform(expandHome),
    enableCustomPrompts: z.boolean(),
    customPromptsPath: z.string().transform(expandHome),
    useYAMLPrompt: z.boolean(),
  }),
});

export const DEFAULT_CONFIG: Config = {
  ai: {
    provider: 'ollama',
    ollama: {
      baseUrl: 'http://localhost:11434',
      model: 'llama3.2:3b',
    },
    api: {
      provider: 'openai',
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    },
  },
  hotkeys: {
    professional: 'p',
    concise: 'c',
    grammar: 'g',
    senior_developer: 'd',
    reset: 'r',
    history: 'h',
    quit: 'q',
  },
  features: {
    enableHistory: true,
    historyPath: join(CONFIG_DIR, 'history.json'),
    enableCustomPrompts: true,
    customPromptsPath: join(CONFIG_DIR, 'prompts.json'),
    useYAMLPrompt: true,
  },
};

/** A config fragment as read from a file or the environment. */
export interface PartialConfig {
  ai?: {
    provider?: Config['ai']['provider'];
    ollama?: Partial<NonNullable<Config['ai']['ollama']>>;
    api?: Partial<NonNullable<Config['ai']['api']>>;
  };
  hotkeys?: Config['hotkeys'];
  features?: Partial<Config['features']>;
}

function parseBool(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  return value.trim().toLowerCase() === 'true';
}

export interface ConfigFromEnvOptions {
  /** Also read legacy unprefixed env vars (AI_PROVIDER, API_KEY, ...). Defaults to true. */
  includeLegacy?: boolean;
}

/**
 * Build a config fragment from environment variables. `CAO_`-prefixed names
 * take precedence; legacy unprefixed names (AI_PROVIDER, API_KEY, ...) are
 * honored when `includeLegacy` is true.
 *
 * Only variables that are explicitly set populate the returned partial, so
 * layering on top of a config file preserves untouched fields.
 */
export function configFromEnv(
  env: NodeJS.ProcessEnv,
  options: ConfigFromEnvOptions = {}
): PartialConfig {
  const includeLegacy = options.includeLegacy ?? true;
  const read = (name: string): string | undefined => {
    const prefixed = env[ENV_PREFIX + name];
    if (prefixed !== undefined) {
      return prefixed;
    }
    return includeLegacy ? env[name] : undefined;
  };
  const readNonEmpty = (name: string): string | undefined => {
    const val = read(name);
    return val !== undefined && val.trim() !== '' ? val.trim() : undefined;
  };

  const config: PartialConfig = {};
  const ai: NonNullable<PartialConfig['ai']> = {};

  const provider = readNonEmpty('AI_PROVIDER');
  if (provider === 'ollama' || provider === 'api') {
    ai.provider = provider;
  } else if (provider !== undefined) {
    console.warn(`Ignoring ${ENV_PREFIX}AI_PROVIDER="${provider}": expected "ollama" or "api".`);
  }

  const ollama: Partial<NonNullable<Config['ai']['ollama']>> = {};
  const ollamaBaseUrl = readNonEmpty('OLLAMA_BASE_URL');
  const ollamaModel = readNonEmpty('OLLAMA_MODEL');
  if (ollamaBaseUrl !== undefined) ollama.baseUrl = ollamaBaseUrl;
  if (ollamaModel !== undefined) ollama.model = ollamaModel;
  if (Object.keys(ollama).length > 0) {
    ai.ollama = ollama;
  }

  const api: Partial<NonNullable<Config['ai']['api']>> = {};
  const apiProvider = readNonEmpty('API_PROVIDER');
  const apiKey = readNonEmpty('API_KEY');
  const apiBaseUrl = readNonEmpty('API_BASE_URL');
  const apiModel = readNonEmpty('API_MODEL');
  if (apiProvider !== undefined) api.provider = apiProvider as ApiProviderName;
  if (apiKey !== undefined) api.apiKey = apiKey;
  if (apiBaseUrl !== undefined) api.baseUrl = apiBaseUrl;
  if (apiModel !== undefined) api.model = apiModel;
  if (Object.keys(api).length > 0) {
    ai.api = api;
  }

  if (Object.keys(ai).length > 0) {
    config.ai = ai;
  }

  const features: Partial<Config['features']> = {};
  const enableHistory = parseBool(read('ENABLE_HISTORY'));
  const enableCustomPrompts = parseBool(read('ENABLE_CUSTOM_PROMPTS'));
  const useYAMLPrompt = parseBool(read('USE_YAML_PROMPT'));
  if (enableHistory !== undefined) features.enableHistory = enableHistory;
  if (enableCustomPrompts !== undefined) features.enableCustomPrompts = enableCustomPrompts;
  if (useYAMLPrompt !== undefined) features.useYAMLPrompt = useYAMLPrompt;
  if (Object.keys(features).length > 0) {
    config.features = features;
  }

  return config;
}

function stripUndefined<T extends Record<string, unknown>>(obj: T | undefined): Partial<T> {
  if (!obj) {
    return {};
  }
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key as keyof T] = value as T[keyof T];
    }
  }
  return result;
}

function mergeStringRecord(
  base: Record<string, string> | undefined,
  override: Record<string, string> | undefined
): Record<string, string> {
  const result: Record<string, string> = { ...base };
  if (override) {
    for (const [key, value] of Object.entries(override)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
  }
  return result;
}

/** Deep-merge PartialConfig fragments in order (later fragments win). */
export function mergePartialConfigs(...partials: PartialConfig[]): PartialConfig {
  const merged: PartialConfig = {};

  for (const partial of partials) {
    if (partial.ai) {
      merged.ai = {
        ...merged.ai,
        ...(partial.ai.provider !== undefined ? { provider: partial.ai.provider } : {}),
        ...(partial.ai.ollama
          ? { ollama: { ...merged.ai?.ollama, ...stripUndefined(partial.ai.ollama) } }
          : {}),
        ...(partial.ai.api
          ? { api: { ...merged.ai?.api, ...stripUndefined(partial.ai.api) } }
          : {}),
      };
    }
    if (partial.hotkeys) {
      merged.hotkeys = mergeStringRecord(merged.hotkeys, partial.hotkeys);
    }
    if (partial.features) {
      merged.features = { ...merged.features, ...stripUndefined(partial.features) };
    }
  }

  return merged;
}

export function mergeWithDefaults(partial: PartialConfig): Config {
  return {
    ai: {
      provider: partial.ai?.provider ?? DEFAULT_CONFIG.ai.provider,
      ollama: { ...DEFAULT_CONFIG.ai.ollama!, ...stripUndefined(partial.ai?.ollama) },
      api: { ...DEFAULT_CONFIG.ai.api!, ...stripUndefined(partial.ai?.api) },
    },
    hotkeys: mergeStringRecord(DEFAULT_CONFIG.hotkeys, partial.hotkeys),
    features: { ...DEFAULT_CONFIG.features, ...stripUndefined(partial.features) },
  };
}

export function parseConfig(partial: PartialConfig): Config {
  return ConfigSchema.parse(mergeWithDefaults(partial));
}

/** Apply per-invocation CLI overrides (`--provider`, `--model`) on top of a loaded Config. */
export function applyCliOverrides(config: Config, overrides?: CliConfigOverrides): Config {
  if (!overrides || (overrides.provider === undefined && overrides.model === undefined)) {
    return config;
  }

  if (overrides.provider !== undefined && !['ollama', 'api'].includes(overrides.provider)) {
    throw new Error(
      `Invalid provider "${String(overrides.provider)}". Expected "ollama" or "api".`
    );
  }

  const activeProvider = overrides.provider ?? config.ai.provider;
  const overridePartial: PartialConfig = {
    ai: {
      provider: activeProvider,
    },
  };

  const model = overrides.model?.trim();
  if (model) {
    if (activeProvider === 'ollama') {
      overridePartial.ai!.ollama = { model };
    } else {
      overridePartial.ai!.api = { model };
    }
  }

  return parseConfig(mergePartialConfigs(config, overridePartial));
}

/** Fast, offline check that the active provider has the required configuration. */
export function validateProviderConfig(config: Config): void {
  if (config.ai.provider === 'ollama') {
    if (!config.ai.ollama?.baseUrl?.trim()) {
      throw new Error('Ollama base URL is not configured. Run "cao config --setup".');
    }
    if (!config.ai.ollama?.model?.trim()) {
      throw new Error('Ollama model is not configured. Run "cao config --setup".');
    }
    return;
  }

  if (!config.ai.api) {
    throw new Error('API configuration is missing. Run "cao config --setup".');
  }
  if (!config.ai.api.apiKey.trim()) {
    throw new Error('API key is not configured. Run "cao config --setup" or set CAO_API_KEY.');
  }
  if (!config.ai.api.baseUrl.trim()) {
    throw new Error('API base URL is not configured. Run "cao config --setup".');
  }
  if (!config.ai.api.model.trim()) {
    throw new Error('API model is not configured. Run "cao config --setup".');
  }
}

export interface ConfigManagerOptions {
  configDir?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  loadDotenv?: boolean;
}

export class ConfigManager {
  private config: Config;
  private configDir: string;
  private configFileYaml: string;
  private configFileJson: string;
  private cwd: string;
  private env: NodeJS.ProcessEnv;
  private shouldLoadDotenv: boolean;

  constructor(options: ConfigManagerOptions = {}) {
    this.configDir = options.configDir ?? CONFIG_DIR;
    this.configFileYaml = join(this.configDir, CONFIG_FILE_YAML_NAME);
    this.configFileJson = join(this.configDir, CONFIG_FILE_JSON_NAME);
    this.cwd = options.cwd ?? process.cwd();
    this.env = options.env ?? process.env;
    this.shouldLoadDotenv = options.loadDotenv ?? true;
    this.config = this.loadConfig();
  }

  private loadFileConfig(): { config: PartialConfig; loaded: boolean } {
    if (existsSync(this.configFileYaml)) {
      try {
        const fileConfig = yaml.load(readFileSync(this.configFileYaml, 'utf-8')) as PartialConfig;
        return { config: fileConfig ?? {}, loaded: true };
      } catch (error) {
        console.warn('Failed to load YAML config file, trying JSON:', error);
      }
    }

    if (existsSync(this.configFileJson)) {
      try {
        const fileConfig = JSON.parse(readFileSync(this.configFileJson, 'utf-8')) as PartialConfig;
        return { config: fileConfig ?? {}, loaded: true };
      } catch (error) {
        console.warn('Failed to load JSON config file, using environment/defaults:', error);
      }
    }

    return { config: {}, loaded: false };
  }

  private loadConfig(): Config {
    const { config: fileConfig, loaded: hasConfigFile } = this.loadFileConfig();

    if (this.shouldLoadDotenv) {
      loadDotenvFiles(this.cwd, this.configDir);
    }

    // Precedence: env vars (CAO_* always; legacy unprefixed only when no config file exists) > config file > defaults
    const envPartial = configFromEnv(this.env, { includeLegacy: !hasConfigFile });

    try {
      return parseConfig(mergePartialConfigs(fileConfig, envPartial));
    } catch (error) {
      console.warn('Invalid configuration in environment variables, falling back:', error);
      try {
        return parseConfig(fileConfig);
      } catch {
        return parseConfig({});
      }
    }
  }

  getConfig(): Config {
    return this.config;
  }

  saveConfig(config: Config): void {
    const validated = ConfigSchema.parse(config);

    // Ensure config directory exists with owner-only permissions
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
    }

    // Save to YAML if it exists, otherwise JSON (preserving existing format)
    const configFilePath = existsSync(this.configFileYaml)
      ? this.configFileYaml
      : this.configFileJson;

    const serialized = configFilePath.endsWith('.yaml')
      ? yaml.dump(validated, { indent: 2 })
      : JSON.stringify(validated, null, 2);

    writeFileSync(configFilePath, serialized, { encoding: 'utf-8', mode: 0o600 });
    try {
      chmodSync(configFilePath, 0o600);
    } catch {
      // Ignore chmod errors on platforms/filesystems without POSIX permissions
    }

    this.config = validated;
  }

  static ensureConfigDir(): void {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
  }
}

let sharedManager: ConfigManager | undefined;

/** Lazily-created shared instance, so importing this module has no side effects. */
export const configManager = {
  getConfig(): Config {
    sharedManager ??= new ConfigManager();
    return sharedManager.getConfig();
  },
  saveConfig(config: Config): void {
    sharedManager ??= new ConfigManager();
    sharedManager.saveConfig(config);
  },
};
