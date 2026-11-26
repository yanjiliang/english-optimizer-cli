import { readFileSync, writeFileSync } from 'fs';
import { extname } from 'path';
import chalk from 'chalk';
import { CustomPrompt } from '../types';
import { Optimizer } from './optimizer';
import { normalizeModeName, resolveModePrompt } from '../prompts/resolver';
import {
  DEFAULT_MAX_CHUNK_CHARS,
  DocumentSegment,
  maskInlineCode,
  reassembleSegments,
  restoreInlineCode,
  splitDocumentIntoSegments,
} from './markdown-chunker';
import { displayDiff, displayInfo, displayOptimization } from '../utils/display';
import { Spinner } from '../utils/spinner';

export interface BatchOptions {
  files: string[];
  /** Any valid mode: "translate", built-in OptimizationMode, or custom prompt name. */
  mode: string;
  inPlace: boolean;
  outputSuffix?: string;
  /** Preview diff without writing any output files. */
  dryRun?: boolean;
  /** Maximum characters per prose chunk (default: 2500). */
  maxChunkChars?: number;
  /** Use prompt.yaml when mode is "translate" (defaults to true). */
  useYAMLPrompt?: boolean;
  /** Custom prompts loaded from prompts.json. */
  customPrompts?: CustomPrompt[];
  /** Optional path override for translation-prompt.txt. */
  promptPath?: string;
  /** Optional path override for prompt.yaml. */
  yamlPromptPath?: string;
}

export interface BatchFileResult {
  filePath: string;
  outputPath?: string;
  status: 'updated' | 'created' | 'dry-run' | 'unchanged' | 'failed';
  chunks: number;
  error?: string;
}

export interface BatchSummary {
  total: number;
  succeeded: number;
  failed: number;
  results: BatchFileResult[];
}

/**
 * Insert the suffix before the file extension (notes.md -> notes.optimized.md).
 * Files without an extension get the suffix appended, so the output path never
 * equals the input path.
 */
export function getOutputPath(filePath: string, suffix: string = '.optimized'): string {
  const effectiveSuffix = suffix || '.optimized';
  const ext = extname(filePath);
  if (!ext) {
    return `${filePath}${effectiveSuffix}`;
  }
  return `${filePath.slice(0, -ext.length)}${effectiveSuffix}${ext}`;
}

export class BatchProcessor {
  private optimizer: Optimizer;

  constructor(optimizer: Optimizer) {
    this.optimizer = optimizer;
  }

  async processBatch(options: BatchOptions): Promise<BatchSummary> {
    const normalizedMode = normalizeModeName(options.mode, options.customPrompts);
    const results: BatchFileResult[] = [];

    const dryRunTag = options.dryRun ? ' (dry-run)' : '';
    displayInfo(
      `Processing ${options.files.length} file(s) with mode "${normalizedMode}"${dryRunTag}...`
    );

    for (let i = 0; i < options.files.length; i++) {
      const file = options.files[i];
      const fileResult = await this.processFile(file, normalizedMode, options, i + 1);
      results.push(fileResult);
    }

    const failed = results.filter((r) => r.status === 'failed').length;
    const succeeded = results.length - failed;

    if (failed === 0) {
      displayInfo(`Batch processing complete! (${succeeded}/${results.length} succeeded)`);
    } else {
      console.error(
        chalk.red(`\n❌ Batch completed with errors: ${succeeded} succeeded, ${failed} failed.`)
      );
    }

    return {
      total: results.length,
      succeeded,
      failed,
      results,
    };
  }

  private async processFile(
    filePath: string,
    normalizedMode: string,
    options: BatchOptions,
    fileIndex: number
  ): Promise<BatchFileResult> {
    const spinner = new Spinner(`Optimizing ${filePath}...`);

    try {
      const content = readFileSync(filePath, 'utf-8');
      const split = splitDocumentIntoSegments(content, {
        filePath,
        maxChunkChars: options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS,
      });

      const targetPath = options.inPlace ? filePath : getOutputPath(filePath, options.outputSuffix);

      const mdTag = split.isMarkdown ? ' · Markdown-safe' : '';
      console.log(
        chalk.cyan(
          `\n[${fileIndex}/${options.files.length}] ${filePath} (${split.proseChunkCount} chunk${split.proseChunkCount === 1 ? '' : 's'}${mdTag})`
        )
      );

      if (split.proseChunkCount === 0) {
        if (!options.dryRun && !options.inPlace) {
          writeFileSync(targetPath, content, 'utf-8');
        }
        console.log(chalk.gray(`  ↳ No prose chunks found; preserved verbatim.`));
        return {
          filePath,
          outputPath: targetPath,
          status: 'unchanged',
          chunks: 0,
        };
      }

      spinner.start();
      const updatedSegments: DocumentSegment[] = [];
      let completedChunks = 0;
      let resolvedModeLabel = normalizedMode;
      let missingPlaceholderCount = 0;

      for (const segment of split.segments) {
        if (segment.type !== 'prose') {
          updatedSegments.push(segment);
          continue;
        }

        completedChunks++;
        spinner.setText(
          `Optimizing ${filePath} (chunk ${completedChunks}/${split.proseChunkCount})...`
        );

        const { masked, placeholders } = split.isMarkdown
          ? maskInlineCode(segment.text)
          : { masked: segment.text, placeholders: new Map<string, string>() };

        const resolved = resolveModePrompt(normalizedMode, masked, {
          useYAMLPrompt: options.useYAMLPrompt,
          promptPath: options.promptPath,
          yamlPromptPath: options.yamlPromptPath,
          customPrompts: options.customPrompts,
        });
        resolvedModeLabel = resolved.modeLabel;

        const extraRules: string[] = [];
        if (split.isMarkdown) {
          extraRules.push(
            'Preserve Markdown formatting (headings, lists, blockquotes, links, emphasis) and paragraph structure.'
          );
        }
        if (placeholders.size > 0) {
          extraRules.push(
            'Preserve every placeholder token like @@CODE_0@@ verbatim without modifying, quoting, or removing it.'
          );
        }

        const systemWithRules =
          extraRules.length > 0
            ? `${resolved.systemPrompt}\n\n${extraRules.join('\n')}`
            : resolved.systemPrompt;

        let optimizedChunk: string;
        if (resolved.builtInMode) {
          optimizedChunk = await this.optimizer.optimizeRaw(
            masked,
            resolved.builtInMode,
            extraRules.length > 0 ? { systemPrompt: systemWithRules } : undefined
          );
        } else if (resolved.customPrompt) {
          optimizedChunk = await this.optimizer.generateRaw(
            resolved.userPrompt,
            extraRules.length > 0 ? { systemPrompt: systemWithRules } : undefined
          );
        } else {
          optimizedChunk = await this.optimizer.generateRaw(resolved.userPrompt, {
            systemPrompt: systemWithRules,
          });
        }

        if (placeholders.size > 0) {
          const { restored, missing } = restoreInlineCode(optimizedChunk, placeholders);
          missingPlaceholderCount += missing.length;
          updatedSegments.push({ type: 'prose', text: restored });
        } else {
          updatedSegments.push({ type: 'prose', text: optimizedChunk });
        }
      }

      spinner.stop();

      if (missingPlaceholderCount > 0) {
        console.warn(
          chalk.yellow(
            `⚠️  Warning: ${missingPlaceholderCount} inline code placeholder(s) were altered by the model in ${filePath}. Please review the diff.`
          )
        );
      }

      const finalContent = reassembleSegments(updatedSegments, split.eol);

      if (options.dryRun) {
        if (finalContent === content) {
          console.log(chalk.gray(`  ↳ No changes for ${filePath}`));
          return {
            filePath,
            outputPath: targetPath,
            status: 'unchanged',
            chunks: split.proseChunkCount,
          };
        }

        const actionLabel = options.inPlace ? 'Would update' : 'Would create';
        console.log(chalk.yellow(`🔍 Dry run — ${actionLabel}: ${targetPath}\n`));
        displayDiff(content, finalContent);
        return {
          filePath,
          outputPath: targetPath,
          status: 'dry-run',
          chunks: split.proseChunkCount,
        };
      }

      if (split.proseChunkCount === 1 && content.length <= 500) {
        displayOptimization(content, finalContent);
      } else if (finalContent !== content) {
        displayDiff(content, finalContent);
      }

      this.optimizer.recordResult(content, finalContent, resolvedModeLabel);

      if (options.inPlace) {
        if (finalContent === content) {
          console.log(chalk.gray(`  ↳ No changes: ${filePath}`));
          return {
            filePath,
            outputPath: filePath,
            status: 'unchanged',
            chunks: split.proseChunkCount,
          };
        }
        writeFileSync(filePath, finalContent, 'utf-8');
        console.log(chalk.green(`✅ Updated: ${filePath}`));
        return {
          filePath,
          outputPath: filePath,
          status: 'updated',
          chunks: split.proseChunkCount,
        };
      }

      writeFileSync(targetPath, finalContent, 'utf-8');
      console.log(chalk.green(`✅ Created: ${targetPath}`));
      return {
        filePath,
        outputPath: targetPath,
        status: 'created',
        chunks: split.proseChunkCount,
      };
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`❌ Error processing ${filePath}: ${message}`));
      return {
        filePath,
        status: 'failed',
        chunks: 0,
        error: message,
      };
    }
  }
}
