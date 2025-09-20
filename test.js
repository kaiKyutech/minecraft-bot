const mineflayer = require("mineflayer");

// Bot の設定
const bot = mineflayer.createBot({
  host: "localhost", // Minecraft サーバーの IP またはホスト名
  port: 25565, // サーバーポート（デフォルト 25565）
  username: "My_First_Bot", // オフラインモードなら自由、オンラインモードなら Mojang/Microsoft アカウントが必要
  version: false, // サーバーのバージョン（false なら自動検出）
});

// ログイン時
bot.on("spawn", () => {
  console.log("Bot がログインしました！");
  bot.chat("こんにちは！Bot君です！!");
});

// チャット受信時
bot.on("chat", (username, message) => {
  console.log(`[${username}]: ${message}`);
  if (username === bot.username) return; // 自分の発言は無視

  if (message === "ping") {
    bot.chat(`[${username}] pong!`)
  }
});

// エラーや終了時
bot.on("error", (err) => console.log("エラー:", err));
bot.on("end", () => console.log("Bot が切断されました"));