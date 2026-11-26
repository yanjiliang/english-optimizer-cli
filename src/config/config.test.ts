import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import {
  applyCliOverrides,
  configFromEnv,
  ConfigManager,
  DEFAULT_CONFIG,
  expandHome,
  loadDotenvFiles,
  maskApiKey,
  parseConfig,
  sanitizeConfigForDisplay,
  validateProviderConfig,
} from './config';

describe('config', () => {
  describe('expandHome', () => {
    it('expands leading tilde paths', () => {
      expect(expandHome('~')).toBe(homedir());
      expect(expandHome('~/foo/bar')).toBe(join(homedir(), 'foo/bar'));
      expect(expandHome('/abs/path')).toBe('/abs/path');
    });
  });

  describe('configFromEnv', () => {
    it('prefers CAO_-prefixed variables over legacy unprefixed names', () => {
      const partial = configFromEnv({
        AI_PROVIDER: 'ollama',
        API_KEY: 'other-project-key',
        CAO_AI_PROVIDER: 'api',
        CAO_API_PROVIDER: 'deepseek',
        CAO_API_KEY: 'cao-key',
        CAO_API_BASE_URL: 'https://api.deepseek.com/v1',
        CAO_API_MODEL: 'deepseek-chat',
        CAO_ENABLE_HISTORY: 'false',
        CAO_USE_YAML_PROMPT: 'false',
      });

      expect(partial.ai?.provider).toBe('api');
      expect(partial.ai?.api).toEqual({
        provider: 'deepseek',
        apiKey: 'cao-key',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
      });
      expect(partial.features?.enableHistory).toBe(false);
      expect(partial.features?.useYAMLPrompt).toBe(false);
    });

    it('still supports legacy unprefixed env vars when CAO_* are unset', () => {
      const partial = configFromEnv({
        AI_PROVIDER: 'api',
        API_PROVIDER: 'glm',
        API_KEY: 'legacy-key',
        API_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4',
        API_MODEL: 'glm-4',
      });

      expect(partial.ai?.provider).toBe('api');
      expect(partial.ai?.api?.provider).toBe('glm');
      expect(partial.ai?.api?.apiKey).toBe('legacy-key');
    });
  });

  describe('parseConfig', () => {
    it('merges defaults and expands ~ in feature paths', () => {
      const cfg = parseConfig({
        features: {
          historyPath: '~/.english-optimizer/custom-history.json',
        },
      });
      expect(cfg.ai.provider).toBe('ollama');
      expect(cfg.features.historyPath).toBe(
        join(homedir(), '.english-optimizer/custom-history.json')
      );
      expect(cfg.features.useYAMLPrompt).toBe(true);
    });

    it('rejects invalid URLs', () => {
      expect(() =>
        parseConfig({
          ai: {
            provider: 'ollama',
            ollama: { baseUrl: 'not-a-url', model: 'llama3.2:3b' },
          },
        })
      ).toThrow();
    });
  });

  describe('loadDotenvFiles', () => {
    let tempDir: string;
    const savedEnv: Record<string, string | undefined> = {};
    const watchedKeys = ['API_KEY', 'CAO_API_KEY', 'CAO_AI_PROVIDER'];

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'cao-env-test-'));
      for (const k of watchedKeys) {
        savedEnv[k] = process.env[k];
        delete process.env[k];
      }
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
      for (const k of watchedKeys) {
        if (savedEnv[k] === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = savedEnv[k];
        }
      }
    });

    it('loads only CAO_* keys from cwd .env and ignores unprefixed project keys', () => {
      writeFileSync(
        join(tempDir, '.env'),
        'API_KEY=unrelated-project-secret\nCAO_API_KEY=cao-secret\nCAO_AI_PROVIDER=api\n',
        'utf-8'
      );

      loadDotenvFiles(tempDir);

      expect(process.env.API_KEY).toBeUndefined();
      expect(process.env.CAO_API_KEY).toBe('cao-secret');
      expect(process.env.CAO_AI_PROVIDER).toBe('api');
    });

    it('does not overwrite already-set CAO_* shell env vars', () => {
      process.env.CAO_API_KEY = 'from-shell';
      writeFileSync(join(tempDir, '.env'), 'CAO_API_KEY=from-file\n', 'utf-8');

      loadDotenvFiles(tempDir);

      expect(process.env.CAO_API_KEY).toBe('from-shell');
    });
  });

  describe('maskApiKey and sanitizeConfigForDisplay', () => {
    it('masks keys of different lengths safely without mutating original config', () => {
      expect(maskApiKey('')).toBe('');
      expect(maskApiKey('short')).toBe('****');
      expect(maskApiKey('12345678')).toBe('****');
      expect(maskApiKey('sk-12345678')).toBe('sk****78');
      expect(maskApiKey('sk-proj-1234567890abcdef')).toBe('sk-p****cdef');

      const rawConfig = parseConfig({
        ai: {
          provider: 'api',
          api: { apiKey: 'sk-proj-1234567890abcdef' },
        },
      });
      const sanitized = sanitizeConfigForDisplay(rawConfig);
      expect(sanitized.ai.api?.apiKey).toBe('sk-p****cdef');
      expect(rawConfig.ai.api?.apiKey).toBe('sk-proj-1234567890abcdef');
    });
  });

  describe('config precedence and file permissions', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'cao-cfg-layer-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('lets CAO_* env vars override config.yaml while ignoring unrelated legacy env vars', () => {
      writeFileSync(
        join(tempDir, 'config.yaml'),
        [
          'ai:',
          '  provider: api',
          '  api:',
          '    provider: deepseek',
          '    apiKey: sk-from-config-file',
          '    baseUrl: https://api.deepseek.com/v1',
          '    model: deepseek-chat',
        ].join('\n'),
        'utf-8'
      );

      const manager = new ConfigManager({
        configDir: tempDir,
        cwd: tempDir,
        loadDotenv: false,
        env: {
          // Legacy unprefixed env var should NOT hijack an existing config file
          API_KEY: 'unrelated-shell-key',
          // CAO_* env var SHOULD override just the specified field
          CAO_API_MODEL: 'deepseek-reasoner',
        },
      });

      const cfg = manager.getConfig();
      expect(cfg.ai.provider).toBe('api');
      expect(cfg.ai.api?.provider).toBe('deepseek');
      expect(cfg.ai.api?.apiKey).toBe('sk-from-config-file');
      expect(cfg.ai.api?.baseUrl).toBe('https://api.deepseek.com/v1');
      expect(cfg.ai.api?.model).toBe('deepseek-reasoner');
    });

    it('saves config with owner-only 0600 permissions', () => {
      const manager = new ConfigManager({
        configDir: tempDir,
        cwd: tempDir,
        loadDotenv: false,
        env: {},
      });
      manager.saveConfig({
        ...DEFAULT_CONFIG,
        ai: {
          ...DEFAULT_CONFIG.ai,
          provider: 'api',
          api: {
            provider: 'openai',
            apiKey: 'sk-secret-1234567890',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4o',
          },
        },
      });

      if (process.platform !== 'win32') {
        const mode = statSync(join(tempDir, 'config.json')).mode & 0o777;
        expect(mode).toBe(0o600);
      }
    });
  });

  describe('applyCliOverrides and validateProviderConfig', () => {
    it('overrides provider and targets the active provider model', () => {
      const base = parseConfig({
        ai: {
          provider: 'api',
          api: { apiKey: 'sk-12345678901234', model: 'gpt-4o' },
          ollama: { model: 'llama3.2:3b' },
        },
      });

      const switched = applyCliOverrides(base, { provider: 'ollama', model: 'qwen2.5:7b' });
      expect(switched.ai.provider).toBe('ollama');
      expect(switched.ai.ollama?.model).toBe('qwen2.5:7b');
      expect(switched.ai.api?.model).toBe('gpt-4o');

      const modelOnly = applyCliOverrides(base, { model: 'gpt-4o-mini' });
      expect(modelOnly.ai.provider).toBe('api');
      expect(modelOnly.ai.api?.model).toBe('gpt-4o-mini');

      expect(() => applyCliOverrides(base, { provider: 'invalid' as 'ollama' })).toThrow(
        /Invalid provider/
      );
    });

    it('validates provider configuration offline without network calls', () => {
      expect(() => validateProviderConfig(DEFAULT_CONFIG)).not.toThrow();

      const missingKey = parseConfig({ ai: { provider: 'api', api: { apiKey: '' } } });
      expect(() => validateProviderConfig(missingKey)).toThrow(/API key is not configured/);

      const validApi = parseConfig({
        ai: { provider: 'api', api: { apiKey: 'sk-valid-key-1234' } },
      });
      expect(() => validateProviderConfig(validApi)).not.toThrow();
    });
  });
});
