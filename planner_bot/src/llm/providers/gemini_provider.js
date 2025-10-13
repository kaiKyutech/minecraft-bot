/**
 * Gemini LLMプロバイダー
 * @google/genai を使用
 */

const BaseLLMProvider = require('./base_provider');
const { GoogleGenAI } = require('@google/genai');

class GeminiProvider extends BaseLLMProvider {
  constructor() {
    super();
    this.ai = null;
    this.modelName = null;
  }

  /**
   * Gemini APIクライアントを初期化
   * @param {string} apiKey - Gemini API Key
   * @param {string} modelName - モデル名（デフォルト: gemini-2.5-flash）
   */
  async initialize(apiKey, modelName = 'gemini-2.5-flash') {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required');
    }

    console.log(`[GEMINI_PROVIDER] Initializing with model: ${modelName}`);
    this.ai = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
  }

  /**
   * Gemini APIを呼び出してJSON形式のレスポンスを取得
   * @param {string} systemPrompt - システムプロンプト
   * @param {string} userPrompt - ユーザープロンプト
   * @returns {Promise<Object>} { thought, speech, command }
   */
  async generateResponse(systemPrompt, userPrompt) {
    if (!this.ai) {
      throw new Error('Gemini provider is not initialized. Call initialize() first.');
    }

    // プロンプトを結合（Geminiはシステムプロンプトとユーザープロンプトを分けない）
    const fullPrompt = `${systemPrompt}

---

${userPrompt}

---

あなたの出力（JSON形式で返してください）:`;

    console.log('[GEMINI_PROVIDER] Sending request to Gemini API...');

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: fullPrompt,
        config: {
          thinkingConfig: {
            thinkingBudget: -1
          }
        }
      });

      const text = response.text;

      console.log('[GEMINI_PROVIDER] Received response from Gemini API');
      console.log('[GEMINI_PROVIDER] Raw response:', text);

      // JSONを抽出（マークダウンのコードブロックに囲まれている場合を考慮）
      let jsonText = text.trim();

      // ```json ... ``` または ``` ... ``` で囲まれている場合
      const jsonBlockMatch = jsonText.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
      if (jsonBlockMatch) {
        jsonText = jsonBlockMatch[1].trim();
      }

      // JSONをパース
      const parsedResponse = JSON.parse(jsonText);

      // バリデーション
      if (!parsedResponse.thought || !parsedResponse.speech || !('command' in parsedResponse)) {
        throw new Error('Invalid response format: missing required fields (thought, speech, command)');
      }

      console.log('[GEMINI_PROVIDER] Parsed response:', parsedResponse);

      return parsedResponse;
    } catch (error) {
      console.error('[GEMINI_PROVIDER] Error:', error.message);
      throw new Error(`Gemini API error: ${error.message}`);
    }
  }

  getName() {
    return 'gemini';
  }
}

module.exports = GeminiProvider;
