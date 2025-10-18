const navigation = require('../creative_actions/navigation')
const vision = require('../creative_actions/vision')

/**
 * !creative コマンドのハンドラ
 * GOAPで扱えない創造的な行動を実行する
 *
 * 使用例:
 *   !creative nav register {"name": "home"}
 *   !creative nav goto {"name": "home"}
 *   !creative nav gotoCoords {"x": 250, "y": 64, "z": -100}
 *   !creative nav list
 *   !creative vision capture {}
 *   !creative vision capturePanorama {}
 *   !creative vision stats {}
 *
 * @param {Object} bot - Mineflayerボット
 * @param {string} username - コマンド送信者のユーザー名
 * @param {string} commandStr - コマンド文字列（例: "nav register {...}"）
 * @param {Object} stateManager - 状態マネージャー
 */
async function handleCreativeCommand(bot, username, commandStr, stateManager) {
  const parts = commandStr.trim().split(' ')

  if (parts.length < 2) {
    throw new Error('使用方法: !creative <category> <action> [params]')
  }

  const category = parts[0]  // navigation, vision, exploration, etc.
  const action = parts[1]    // register, goto, capture, etc.

  let params = {}
  if (parts.length > 2) {
    const jsonStr = parts.slice(2).join(' ')
    try {
      params = JSON.parse(jsonStr)
    } catch (error) {
      throw new Error(`パラメータのJSON解析に失敗: ${error.message}`)
    }
  }

  console.log(`[CREATIVE] ${category}.${action}(${JSON.stringify(params)})`)

  let result

  // カテゴリの判定（navigation / nav）
  if (category === 'navigation' || category === 'nav') {
    if (!navigation[action]) {
      const available = Object.keys(navigation).join(', ')
      throw new Error(
        `未知のナビゲーション操作: ${action}\n` +
        `利用可能: ${available}`
      )
    }
    result = await navigation[action](bot, stateManager, params)
  }
  // カテゴリの判定（vision / vis）
  else if (category === 'vision' || category === 'vis') {
    if (!vision[action]) {
      const available = Object.keys(vision).join(', ')
      throw new Error(
        `未知のvision操作: ${action}\n` +
        `利用可能: ${available}`
      )
    }
    result = await vision[action](bot, stateManager, params)
  }
  else {
    throw new Error(
      `未知のカテゴリ: ${category}\n` +
      `利用可能: nav (navigation), vis (vision)`
    )
  }

  // 成功メッセージをウィスパーで送信（ディレイ付き）
  if (result.success) {
    await bot.chatWithDelay(username, result.message)
  }

  return result
}

module.exports = handleCreativeCommand
