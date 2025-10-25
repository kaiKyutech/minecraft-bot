/**
 * !creative コマンドのハンドラ
 * 将来の拡張用（建築など）のために形だけ残す
 *
 * 注意: navigation は !navigation に移動しました
 * 注意: exploration は !info scanBlocks に移動しました
 *
 * @param {Object} bot - Mineflayerボット
 * @param {string} username - コマンド送信者のユーザー名
 * @param {string} commandStr - コマンド文字列
 * @param {Object} stateManager - 状態マネージャー
 */
async function handleCreativeCommand(bot, username, commandStr, stateManager) {
  throw new Error(
    '!creative コマンドは現在利用できません。\n' +
    '移動: !navigation を使用してください\n' +
    '情報取得: !info を使用してください'
  )
}

module.exports = handleCreativeCommand
