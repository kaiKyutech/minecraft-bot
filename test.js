const mineflayer = require("mineflayer");
const { pathfinder, Movements, goals } = require("mineflayer-pathfinder");
let mcData;

// Bot の設定
const bot = mineflayer.createBot({
  host: "localhost", // Minecraft サーバーの IP またはホスト名
  port: 25565, // サーバーポート（デフォルト 25565）
  username: "My_First_Bot", // オフラインモードなら自由、オンラインモードなら Mojang/Microsoft アカウントが必要
  version: 1.21, // サーバーのバージョン（false なら自動検出）
});

bot.loadPlugin(pathfinder)

// ログイン時
bot.on("spawn", () => {
  console.log("Bot がログインしました！");
  bot.chat("こんにちは！Bot君です！!");
  mcData = require("minecraft-data")(bot.version);
  const defaultMove = new Movements(bot, mcData);
  bot.pathfinder.setMovements(defaultMove);
});

// チャット受信時
bot.on("chat", (username, message) => {
  console.log(`[${username}]: ${message}`);
  if (username === bot.username) return; // 自分の発言は無視

  if (message === "ping") {
    bot.chat(`[${username}] pong!`)
  }

  if (message === "forward") {
    bot.setControlState("forward", true)
    setTimeout(() => bot.setControlState("forward", false), 2000) // 2秒だけ前進
  }

  if (message === "chop") {
    ;(async () => {
      const tree = bot.findBlock({
        matching: (block) => block && block.name.includes("log"),
        maxDistance: 32,
      })

      if (!tree) {
        bot.chat("近くに木がないよ")
        return
      }

      try {
        const goal = new goals.GoalGetToBlock(tree.position.x, tree.position.y, tree.position.z)
        await bot.pathfinder.goto(goal)
      } catch (moveErr) {
        console.log("path error", moveErr)
        bot.chat("木まで行けなかった…")
        return
      }

      const target = bot.blockAt(tree.position)
      if (!target || !target.name.includes("log")) {
        bot.chat("あれ、木がなくなってる…")
        return
      }

      if (!bot.canDigBlock(target)) {
        bot.chat("この位置からは届かないみたい…")
        return
      }

      try {
        await bot.dig(target)
        bot.chat("木を切った！")
      } catch (error) {
        console.log("dig error", error)
        bot.chat("伐採できなかった…")
      }
    })()
  }


});

// エラーや終了時
bot.on("error", (err) => console.log("エラー:", err));
bot.on("end", () => console.log("Bot が切断されました"));
