import inquirer from 'inquirer';
import chalk from 'chalk';
import { ConfigManager, maskApiKey } from './config';
import type { ApiProviderName, Config } from '../types';

type WizardAnswers = {
  provider: 'ollama' | 'api';
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  apiProvider?: ApiProviderName;
  apiKey?: string;
  apiBaseUrl?: string;
  apiModel?: string;
  enableHistory: boolean;
  enableYAMLPrompt: boolean;
};

export async function runConfigWizard(): Promise<void> {
  console.log(chalk.cyan.bold('\n🚀 English Optimizer CLI - Configuration Wizard\n'));

  const configManager = new ConfigManager();
  const currentConfig = configManager.getConfig();

  const existingApiKey = currentConfig.ai.api?.apiKey?.trim() || '';

  const answers = await inquirer.prompt<WizardAnswers>([
    {
      type: 'select',
      name: 'provider',
      message: 'Select AI provider:',
      choices: [
        { name: '🤖 Ollama (Local)', value: 'ollama' },
        { name: '☁️  Cloud API (OpenAI, GLM, etc.)', value: 'api' },
      ],
      default: currentConfig.ai.provider,
    },
    {
      type: 'input',
      name: 'ollamaBaseUrl',
      message: 'Ollama base URL:',
      default: currentConfig.ai.ollama?.baseUrl || 'http://localhost:11434',
      when: (answers) => answers.provider === 'ollama',
      validate: (input: string) => {
        try {
          new URL(input);
          return true;
        } catch {
          return 'Please enter a valid URL';
        }
      },
    },
    {
      type: 'input',
      name: 'ollamaModel',
      message: 'Ollama model name:',
      default: currentConfig.ai.ollama?.model || 'llama3.2:3b',
      when: (answers) => answers.provider === 'ollama',
    },
    {
      type: 'select',
      name: 'apiProvider',
      message: 'Select API provider:',
      choices: [
        { name: '🔵 OpenAI (GPT-4o / GPT-4o-mini)', value: 'openai' },
        { name: '🟢 GLM (Zhipu AI)', value: 'glm' },
        { name: '🔷 DeepSeek', value: 'deepseek' },
        { name: '🟣 Aliyun Qwen', value: 'qwen' },
        { name: '🌙 Moonshot (Kimi)', value: 'moonshot' },
        { name: '🔀 OpenRouter (Claude / GPT / Gemini)', value: 'openrouter' },
        { name: '✨ Google Gemini (OpenAI-compatible)', value: 'gemini' },
        { name: '🔧 Custom API', value: 'custom' },
      ],
      default: currentConfig.ai.api?.provider || 'openai',
      when: (answers) => answers.provider === 'api',
    },
    {
      type: 'password',
      name: 'apiKey',
      message: existingApiKey
        ? `Enter your API key (leave empty to keep ${maskApiKey(existingApiKey)}):`
        : 'Enter your API key:',
      mask: '*',
      when: (answers) => answers.provider === 'api',
      validate: (input: string) => {
        if ((!input || input.trim() === '') && !existingApiKey) {
          return 'API key cannot be empty';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'apiBaseUrl',
      message: 'API base URL:',
      default: (answers) => {
        const currentUrl = currentConfig.ai.api?.baseUrl || '';
        const providerDefaults: Record<string, string> = {
          openai: 'https://api.openai.com/v1',
          glm: 'https://open.bigmodel.cn/api/paas/v4',
          deepseek: 'https://api.deepseek.com/v1',
          qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          moonshot: 'https://api.moonshot.cn/v1',
          openrouter: 'https://openrouter.ai/api/v1',
          gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
          custom: currentUrl,
        };
        return providerDefaults[answers.apiProvider ?? 'custom'] || currentUrl;
      },
      when: (answers) => answers.provider === 'api',
      validate: (input: string) => {
        try {
          new URL(input);
          return true;
        } catch {
          return 'Please enter a valid URL';
        }
      },
    },
    {
      type: 'input',
      name: 'apiModel',
      message: 'Model name:',
      default: (answers) => {
        const currentModel = currentConfig.ai.api?.model || '';
        const modelDefaults: Record<string, string> = {
          openai: 'gpt-4o-mini',
          glm: 'glm-4',
          deepseek: 'deepseek-chat',
          qwen: 'qwen-turbo',
          moonshot: 'moonshot-v1-8k',
          openrouter: 'anthropic/claude-sonnet-4',
          gemini: 'gemini-2.5-flash',
          custom: currentModel,
        };
        return modelDefaults[answers.apiProvider ?? 'custom'] || currentModel;
      },
      when: (answers) => answers.provider === 'api',
    },
    {
      type: 'confirm',
      name: 'enableHistory',
      message: 'Enable optimization history?',
      default: currentConfig.features.enableHistory ?? true,
    },
    {
      type: 'confirm',
      name: 'enableYAMLPrompt',
      message: 'Use ./prompt.yaml when it exists in the current directory?',
      default: currentConfig.features.useYAMLPrompt ?? true,
    },
  ]);

  // Build new config
  const newConfig: Config = {
    ...currentConfig,
    ai: {
      provider: answers.provider,
      ollama:
        answers.provider === 'ollama'
          ? {
              baseUrl: answers.ollamaBaseUrl!,
              model: answers.ollamaModel!,
            }
          : currentConfig.ai.ollama,
      api:
        answers.provider === 'api'
          ? {
              provider: answers.apiProvider!,
              apiKey: answers.apiKey?.trim() || existingApiKey,
              baseUrl: answers.apiBaseUrl!,
              model: answers.apiModel!,
            }
          : currentConfig.ai.api,
    },
    features: {
      ...currentConfig.features,
      enableHistory: answers.enableHistory,
      useYAMLPrompt: answers.enableYAMLPrompt,
    },
  };

  // Save config
  console.log(chalk.cyan('\n💾 Saving configuration...\n'));
  configManager.saveConfig(newConfig);

  console.log(chalk.green.bold('✅ Configuration saved successfully!\n'));

  // Show summary
  console.log(chalk.white.bold('Current Configuration:\n'));
  console.log(chalk.gray('─'.repeat(50)));

  if (answers.provider === 'ollama') {
    console.log(chalk.cyan(`Provider: ${chalk.bold('Ollama (Local)')}`));
    console.log(chalk.cyan(`  URL: ${newConfig.ai.ollama!.baseUrl}`));
    console.log(chalk.cyan(`  Model: ${newConfig.ai.ollama!.model}`));
  } else {
    console.log(chalk.cyan(`Provider: ${chalk.bold(answers.apiProvider)}`));
    console.log(chalk.cyan(`  URL: ${newConfig.ai.api!.baseUrl}`));
    console.log(chalk.cyan(`  Model: ${newConfig.ai.api!.model}`));
  }

  console.log(chalk.cyan(`History: ${answers.enableHistory ? 'Enabled' : 'Disabled'}`));
  console.log(chalk.cyan(`YAML Prompt: ${answers.enableYAMLPrompt ? 'Enabled' : 'Disabled'}`));
  console.log(chalk.gray('─'.repeat(50)));

  console.log(chalk.green('\n🎉 Ready to use! Run:'));
  console.log(chalk.white.bold('  cao\n'));
}
