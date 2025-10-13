/**
 * 統一LLMクライアント（シングルトン）
 * どのプロバイダーを使っていても、同じインターフェースでLLMにアクセスできる
 */

const { createProvider } = require('./providers');

class LLMClient {
  constructor() {
    this.provider = null;
    this.providerName = null;
  }

  /**
   * LLMクライアントを初期化
   * @param {string} providerName - プロバイダー名（gemini, openai, claude など）
   * @param {string} apiKey - APIキー
   * @param {string} modelName - モデル名
   */
  async initialize(providerName, apiKey, modelName) {
    if (this.provider) {
      console.log(`[LLM_CLIENT] Already initialized with ${this.providerName}`);
      return;
    }

    console.log(`[LLM_CLIENT] Initializing with provider: ${providerName}`);

    this.provider = createProvider(providerName);
    this.providerName = providerName;

    await this.provider.initialize(apiKey, modelName);

    console.log(`[LLM_CLIENT] Successfully initialized ${this.provider.getName()} provider`);
  }

  /**
   * LLMにプロンプトを送信してレスポンスを取得
   * @param {string} systemPrompt - システムプロンプト
   * @param {string} userPrompt - ユーザープロンプト
   * @returns {Promise<Object>} { thought, speech, command }
   */
  async generateResponse(systemPrompt, userPrompt) {
    if (!this.provider) {
      throw new Error('LLM client is not initialized. Call initialize() first.');
    }

    return this.provider.generateResponse(systemPrompt, userPrompt);
  }

  /**
   * 現在のプロバイダー名を取得
   * @returns {string}
   */
  getProviderName() {
    return this.providerName || 'none';
  }

  /**
   * 初期化されているかチェック
   * @returns {boolean}
   */
  isInitialized() {
    return this.provider !== null;
  }
}

// シングルトンインスタンスとしてエクスポート
module.exports = new LLMClient();
