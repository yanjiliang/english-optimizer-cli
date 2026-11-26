export enum OptimizationMode {
  PROFESSIONAL = 'professional',
  CONCISE = 'concise',
  GRAMMAR = 'grammar',
  SENIOR_DEVELOPER = 'senior_developer',
  SLACK = 'slack',
  PR = 'pr',
  COMMIT = 'commit',
  EMAIL = 'email',
}

export const API_PROVIDERS = [
  'openai',
  'glm',
  'deepseek',
  'qwen',
  'moonshot',
  'openrouter',
  'gemini',
  'custom',
] as const;
export type ApiProviderName = (typeof API_PROVIDERS)[number];

export interface GenerateOptions {
  /** Called incrementally with text chunks when streaming is enabled. */
  onToken?: (token: string) => void;
  /** Optional system instructions separated from the user input message. */
  systemPrompt?: string;
}

export interface PromptMessages {
  systemPrompt: string;
  userPrompt: string;
}

export interface TextVariant {
  tone: string;
  label: string;
  text: string;
}

export interface ExplainResult {
  optimized: string;
  explanation: string;
}

export interface CliConfigOverrides {
  provider?: 'ollama' | 'api';
  model?: string;
}

export interface AIProvider {
  /** Human-readable provider name, e.g. "ollama" or "openai" */
  readonly name: string;
  /** Model identifier used for requests */
  readonly model: string;
  optimize(text: string, mode: OptimizationMode, options?: GenerateOptions): Promise<string>;
  generateWithPrompt(prompt: string, options?: GenerateOptions): Promise<string>;
  isAvailable(): Promise<boolean>;
}

export interface OptimizationResult {
  original: string;
  optimized: string;
  /**
   * An OptimizationMode value, or a free-form label for prompt-driven runs
   * (e.g. "translate", "custom:Academic").
   */
  mode: string;
  timestamp: Date;
  provider: string;
  model: string;
  /** Set when history logging is enabled and the entry was persisted. */
  historyId?: string;
}

export interface HistoryEntry extends OptimizationResult {
  id: string;
  starred?: boolean;
}

export interface Config {
  ai: {
    provider: 'ollama' | 'api';
    ollama?: {
      baseUrl: string;
      model: string;
    };
    api?: {
      provider: ApiProviderName;
      apiKey: string;
      baseUrl: string;
      model: string;
    };
  };
  hotkeys: {
    [mode: string]: string;
  };
  features: {
    enableHistory: boolean;
    historyPath: string;
    enableCustomPrompts: boolean;
    customPromptsPath: string;
    useYAMLPrompt: boolean;
  };
}

export interface CustomPrompt {
  name: string;
  description: string;
  prompt: string;
  hotkey?: string;
}

export interface PromptTemplate {
  name: string;
  description: string;
  template: (text: string) => string;
}

/** All sections are optional; missing sections are simply omitted from the prompt. */
export interface YAMLPromptConfig {
  role?: {
    name?: string;
    description?: string;
  };
  goals?: string[];
  user_profile?: {
    background?: string;
    native_language?: string;
    learning_goal?: string;
  };
  instructions?: string[];
  output_format?: {
    style?: string;
    structure?: string[];
  };
  examples?: Array<{
    input: string;
    output: string;
  }>;
  constraints?: string[];
}
