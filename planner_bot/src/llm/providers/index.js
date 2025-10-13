/**
 * LLMプロバイダーファクトリー
 * プロバイダー名に応じて適切なプロバイダーインスタンスを生成
 */

const GeminiProvider = require('./gemini_provider');

/**
 * プロバイダー名からプロバイダーインスタンスを作成
 * @param {string} providerName - プロバイダー名（gemini, openai, claude など）
 * @returns {BaseLLMProvider} プロバイダーインスタンス
 */
function createProvider(providerName) {
  const name = (providerName || 'gemini').toLowerCase();

  switch (name) {
    case 'gemini':
      return new GeminiProvider();

    case 'openai':
    case 'chatgpt':
      // 将来実装: OpenAIProvider
      throw new Error('OpenAI provider is not yet implemented. Use "gemini" for now.');

    case 'claude':
      // 将来実装: ClaudeProvider
      throw new Error('Claude provider is not yet implemented. Use "gemini" for now.');

    default:
      throw new Error(`Unknown LLM provider: ${providerName}. Supported: gemini`);
  }
}

module.exports = {
  createProvider,
  GeminiProvider
};
