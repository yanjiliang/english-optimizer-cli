import chalk from 'chalk';
import { applyCliOverrides, configManager, maskApiKey } from './config';
import { createProvider } from '../ai/provider';
import { CliConfigOverrides, OptimizationMode } from '../types';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function testConfiguration(overrides?: CliConfigOverrides): Promise<void> {
  console.log(chalk.cyan.bold('\n🧪 Testing API Configuration...\n'));

  const config = applyCliOverrides(configManager.getConfig(), overrides);

  try {
    const provider = createProvider(config);

    console.log(chalk.gray('Provider:'), chalk.white.bold(config.ai.provider));

    if (config.ai.provider === 'ollama') {
      console.log(chalk.gray('Ollama URL:'), chalk.white(config.ai.ollama!.baseUrl));
      console.log(chalk.gray('Ollama Model:'), chalk.white(config.ai.ollama!.model));
    } else {
      console.log(chalk.gray('API Provider:'), chalk.white.bold(config.ai.api!.provider));
      console.log(chalk.gray('API URL:'), chalk.white(config.ai.api!.baseUrl));
      console.log(chalk.gray('API Model:'), chalk.white(config.ai.api!.model));
      console.log(
        chalk.gray('API Key:'),
        chalk.white(maskApiKey(config.ai.api!.apiKey) || '(not set)')
      );
    }

    console.log(chalk.gray('\n' + '─'.repeat(50) + '\n'));
    console.log(chalk.cyan('🔄 Testing connection...\n'));

    let isAvailable = false;
    try {
      isAvailable = await provider.isAvailable();
    } catch (e: unknown) {
      if (getErrorMessage(e).includes('balance is insufficient')) {
        console.log(chalk.red.bold('\n❌ GLM Account Balance Issue!\n'));
        console.log(chalk.yellow('Your GLM account has insufficient balance.\n'));
        console.log(chalk.cyan('💡 To fix:'));
        console.log(chalk.white('  1. Visit https://open.bigmodel.cn/usercenter/finance'));
        console.log(chalk.white('  2. Recharge your account'));
        console.log(chalk.white('  3. Run test again: cao test\n'));
        process.exit(1);
      }
      throw e;
    }

    if (isAvailable) {
      console.log(chalk.green.bold('✅ API configuration is valid!\n'));

      if (config.ai.provider === 'api') {
        console.log(chalk.gray('Attempting a simple test request...\n'));

        try {
          const testText = 'Hello';
          const optimized = await provider.optimize(testText, OptimizationMode.PROFESSIONAL);

          console.log(chalk.cyan('Test Input:'), chalk.white(testText));
          console.log(chalk.cyan('Test Output:'), chalk.white(optimized));
          console.log(
            '\n' + chalk.green.bold('✅ Full test passed! Your API is working correctly.\n')
          );
        } catch (error: unknown) {
          console.log(chalk.yellow('\n⚠️  Connection successful but request failed:'));
          console.log(chalk.gray(getErrorMessage(error)));

          console.log('\n' + chalk.cyan('Possible issues:'));
          console.log(chalk.gray('  - API key may be invalid or expired'));
          console.log(chalk.gray('  - Model may not be available'));
          console.log(chalk.gray('  - API endpoint may have changed'));
          console.log('\n' + chalk.cyan('Please check your API configuration:'));
          console.log(chalk.white('  cao config --setup\n'));
        }
      } else {
        console.log(chalk.green.bold('🎉 Your local Ollama is ready!\n'));
        console.log(chalk.gray('You can start using:'));
        console.log(chalk.white.bold('  cao\n'));
      }
    } else {
      console.log(chalk.red.bold('❌ API configuration is invalid!\n'));

      if (config.ai.provider === 'ollama') {
        console.log(chalk.red('Issues:'));
        console.log(chalk.gray('  - Ollama is not running'));
        console.log(chalk.gray('  - Ollama URL is incorrect'));
        console.log('\n' + chalk.cyan('To start Ollama:'));
        console.log(chalk.gray('  docker-compose up -d'));
        console.log(chalk.gray('\nOr install Ollama locally:'));
        console.log(chalk.gray('  https://ollama.com/download'));
      } else {
        console.log(chalk.red('Issues:'));
        console.log(chalk.gray('  - API key is invalid or missing'));
        console.log(chalk.gray('  - API URL is incorrect'));
        console.log(chalk.gray('  - Network connection failed'));
        console.log('\n' + chalk.cyan('Please check your configuration:'));
        console.log(chalk.white('  cao config --setup'));
        console.log(chalk.gray('\nOr view current config:'));
        console.log(chalk.white('  cao config\n'));
      }

      process.exit(1);
    }
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    console.log(chalk.red.bold('\n❌ Configuration error!\n'));
    console.log(chalk.gray(message));

    if (message.includes('API key')) {
      console.log('\n' + chalk.cyan('💡 Tip: Make sure your API key is correct and active.'));
      console.log(chalk.gray('  For OpenAI: https://platform.openai.com/api-keys'));
      console.log(chalk.gray('  For GLM: https://open.bigmodel.cn/usercenter/apikeys'));
      console.log(chalk.gray('  For DeepSeek: https://platform.deepseek.com/\n'));
    }

    process.exit(1);
  }
}
