import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { YAMLPromptLoader, buildPromptFromConfig, resolveYAMLPromptPath } from './yaml-prompt';

describe('YAMLPromptLoader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cao-yaml-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('builds a prompt from README example without output_format.structure', () => {
    const yamlContent = `
role:
  name: Native English Full-Stack Engineer Coach
  description: You are a senior full-stack software engineer.

goals:
  - Help the user learn natural English

output_format:
  style: Natural, spoken English commonly used in engineering teams.

examples:
  - input: '这个问题我稍后再跟进'
    output: "I'll follow up on this later."

constraints:
  - Do not change the original meaning
`;
    const filePath = join(tempDir, 'prompt.yaml');
    writeFileSync(filePath, yamlContent, 'utf-8');

    const loader = new YAMLPromptLoader(filePath);
    expect(loader.hasYAMLPrompt()).toBe(true);

    const prompt = loader.buildPrompt('这个功能明天上线');
    expect(prompt).toContain('## Role');
    expect(prompt).toContain('## Output Format');
    expect(prompt).toContain('Style: Natural, spoken English');
    expect(prompt).not.toContain('Structure:');
    expect(prompt).toContain('## Input to Optimize\n"这个功能明天上线"');
  });

  it('handles repo prompt.yaml with output_format.structure', () => {
    const loader = new YAMLPromptLoader(join(process.cwd(), 'prompt.yaml'));
    expect(loader.hasYAMLPrompt()).toBe(true);

    const prompt = loader.buildPrompt('price is $& and $1');
    expect(prompt).toContain('Structure:');
    expect(prompt).toContain('price is $& and $1');
  });

  it('returns null for missing, empty, or non-object YAML files', () => {
    const missing = new YAMLPromptLoader(join(tempDir, 'missing.yaml'));
    expect(missing.hasYAMLPrompt()).toBe(false);
    expect(() => missing.buildPrompt('hello')).toThrow('YAML prompt config not found');

    const emptyPath = join(tempDir, 'empty.yaml');
    writeFileSync(emptyPath, '', 'utf-8');
    expect(new YAMLPromptLoader(emptyPath).loadConfig()).toBeNull();

    const arrayPath = join(tempDir, 'array.yaml');
    writeFileSync(arrayPath, '- item1\n- item2\n', 'utf-8');
    expect(new YAMLPromptLoader(arrayPath).loadConfig()).toBeNull();
  });

  it('omits empty sections cleanly in buildPromptFromConfig', () => {
    const prompt = buildPromptFromConfig({}, 'hello world');
    expect(prompt).toContain('## Input to Optimize\n"hello world"');
    expect(prompt).not.toContain('## Role');
    expect(prompt).not.toContain('## Goals');
    expect(prompt).not.toContain('## Output Format');
  });

  it('resolves ./prompt.yaml first and falls back to global ~/.english-optimizer/prompt.yaml', () => {
    const projectDir = join(tempDir, 'project');
    const globalDir = join(tempDir, 'global');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(globalDir, { recursive: true });

    const globalPrompt = join(globalDir, 'prompt.yaml');
    writeFileSync(globalPrompt, 'role:\n  name: Global Coach\n', 'utf-8');

    // Falls back to global when project has no prompt.yaml
    expect(resolveYAMLPromptPath(projectDir, globalDir)).toBe(globalPrompt);
    const globalLoader = new YAMLPromptLoader(undefined, { cwd: projectDir, configDir: globalDir });
    expect(globalLoader.hasYAMLPrompt()).toBe(true);
    expect(globalLoader.buildMessages('Can you check this?').systemPrompt).toContain(
      'Global Coach'
    );
    expect(globalLoader.buildMessages('Can you check this?').userPrompt).toContain(
      'Can you check this?'
    );

    // Local ./prompt.yaml overrides global
    const localPrompt = join(projectDir, 'prompt.yaml');
    writeFileSync(localPrompt, 'role:\n  name: Project Coach\n', 'utf-8');
    expect(resolveYAMLPromptPath(projectDir, globalDir)).toBe(localPrompt);
    expect(new YAMLPromptLoader(localPrompt).getRawContent()).toBe(
      'role:\n  name: Project Coach\n'
    );
    expect(new YAMLPromptLoader(join(tempDir, 'missing.yaml')).getRawContent()).toBeNull();
  });
});
