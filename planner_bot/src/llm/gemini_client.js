/**
 * Gemini API クライアント
 * @google/genai を使用
 */

const { GoogleGenAI } = require('@google/genai');

let ai = null;
let modelName = null;

/**
 * Gemini APIクライアントを初期化
 * @param {string} apiKey - Gemini API Key
 * @param {string} model - モデル名（デフォルト: gemini-2.5-flash-latest）
 */
function initialize(apiKey, model = 'gemini-2.5-flash-latest') {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in environment variables');
  }

  console.log(`[GEMINI_CLIENT] Initializing with model: ${model}`);
  ai = new GoogleGenAI({ apiKey });
  modelName = model;
}

/**
 * Gemini APIを呼び出してJSON形式のレスポンスを取得
 * @param {string} systemPrompt - システムプロンプト
 * @param {string} userPrompt - ユーザープロンプト
 * @returns {Promise<Object>} { thought, speech, command }
 */
async function generateResponse(systemPrompt, userPrompt) {
  if (!ai) {
    throw new Error('Gemini client is not initialized. Call initialize() first.');
  }

  // プロンプトを結合（Geminiはシステムプロンプトとユーザープロンプトを分けない）
  const fullPrompt = `${systemPrompt}

---

${userPrompt}

---

あなたの出力（JSON形式で返してください）:`;

  console.log('[GEMINI_CLIENT] Sending request to Gemini API...');

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: fullPrompt,
      config:{
        thinkingConfig:{
          thinkingBudget:-1
        }
      }
    });

    const text = response.text;

    console.log('[GEMINI_CLIENT] Received response from Gemini API');
    console.log('[GEMINI_CLIENT] Raw response:', text);

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

    console.log('[GEMINI_CLIENT] Parsed response:', parsedResponse);

    return parsedResponse;
  } catch (error) {
    console.error('[GEMINI_CLIENT] Error:', error.message);
    throw new Error(`Gemini API error: ${error.message}`);
  }
}

module.exports = {
  initialize,
  generateResponse
};
