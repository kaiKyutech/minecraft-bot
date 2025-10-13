/**
 * LLMプロバイダーの基底クラス
 * すべてのプロバイダーはこのクラスを継承して実装する
 */
class BaseLLMProvider {
  /**
   * プロバイダーを初期化
   * @param {string} apiKey - APIキー
   * @param {string} modelName - モデル名
   */
  async initialize(apiKey, modelName) {
    throw new Error('initialize() must be implemented by subclass');
  }

  /**
   * LLMにプロンプトを送信してレスポンスを取得
   * @param {string} systemPrompt - システムプロンプト
   * @param {string} userPrompt - ユーザープロンプト
   * @returns {Promise<Object>} { thought, speech, command }
   */
  async generateResponse(systemPrompt, userPrompt) {
    throw new Error('generateResponse() must be implemented by subclass');
  }

  /**
   * プロバイダー名を取得
   * @returns {string}
   */
  getName() {
    return 'base';
  }
}

module.exports = BaseLLMProvider;
