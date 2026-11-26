import {
  AIProvider,
  CustomPrompt,
  GenerateOptions,
  OptimizationMode,
  OptimizationResult,
} from '../types';
import { HistoryLogger } from '../history/logger';
import { buildCustomPrompt } from '../prompts/template-utils';

export class Optimizer {
  public provider: AIProvider;
  private historyLogger?: HistoryLogger;

  constructor(provider: AIProvider, historyLogger?: HistoryLogger) {
    this.provider = provider;
    this.historyLogger = historyLogger;
  }

  /** Optimize text with one of the built-in modes. */
  async optimize(
    text: string,
    mode: OptimizationMode,
    options?: GenerateOptions
  ): Promise<OptimizationResult> {
    const optimized = options
      ? await this.provider.optimize(text, mode, options)
      : await this.provider.optimize(text, mode);
    return this.createResult(text, optimized, mode);
  }

  /** Run a fully-built prompt and record the result under the given mode label. */
  async generate(
    text: string,
    prompt: string,
    modeLabel: string,
    options?: GenerateOptions
  ): Promise<OptimizationResult> {
    const optimized = options
      ? await this.provider.generateWithPrompt(prompt, options)
      : await this.provider.generateWithPrompt(prompt);
    return this.createResult(text, optimized, modeLabel);
  }

  /** Optimize text using a user-defined prompt from prompts.json. */
  async optimizeWithCustomPrompt(
    text: string,
    customPrompt: CustomPrompt,
    options?: GenerateOptions
  ): Promise<OptimizationResult> {
    const prompt = buildCustomPrompt(customPrompt.prompt, text);
    return this.generate(text, prompt, `custom:${customPrompt.name}`, options);
  }

  /** Optimize text with a built-in mode without recording history (used for chunked batch). */
  async optimizeRaw(
    text: string,
    mode: OptimizationMode,
    options?: GenerateOptions
  ): Promise<string> {
    return options
      ? await this.provider.optimize(text, mode, options)
      : await this.provider.optimize(text, mode);
  }

  /** Run a prompt without recording history (used for explanations and structured parsing). */
  async generateRaw(prompt: string, options?: GenerateOptions): Promise<string> {
    return options
      ? await this.provider.generateWithPrompt(prompt, options)
      : await this.provider.generateWithPrompt(prompt);
  }

  /** Record a pre-parsed optimization result (e.g. from --explain or --variants) into history. */
  recordResult(original: string, optimized: string, mode: string): OptimizationResult {
    return this.createResult(original, optimized, mode);
  }

  private createResult(original: string, optimized: string, mode: string): OptimizationResult {
    const result: OptimizationResult = {
      original,
      optimized,
      mode,
      timestamp: new Date(),
      provider: this.provider.name,
      model: this.provider.model,
    };

    // Save to history if enabled
    if (this.historyLogger) {
      const entry = this.historyLogger.addEntry(result);
      result.historyId = entry.id;
    }

    return result;
  }
}
