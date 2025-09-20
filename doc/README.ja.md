# Mineflayer

[![NPM version](https://img.shields.io/npm/v/mineflayer.svg?color=success&label=npm%20package&logo=npm)](https://www.npmjs.com/package/mineflayer)
[![Build Status](https://img.shields.io/github/actions/workflow/status/PrismarineJS/mineflayer/ci.yml.svg?label=CI&logo=github&logoColor=lightgrey)](https://github.com/PrismarineJS/mineflayer/actions?query=workflow%3A%22CI%22)
[![Try it on gitpod](https://img.shields.io/static/v1.svg?label=try&message=on%20gitpod&color=brightgreen&logo=gitpod)](https://gitpod.io/#https://github.com/PrismarineJS/mineflayer)
[![Open In Colab](https://img.shields.io/static/v1.svg?label=open&message=on%20colab&color=blue&logo=google-colab)](https://colab.research.google.com/github/PrismarineJS/mineflayer/blob/master/docs/mineflayer.ipynb)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/PrismarineJS)](https://github.com/sponsors/PrismarineJS)

[![Official Discord](https://img.shields.io/static/v1.svg?label=OFFICIAL&message=DISCORD&color=blue&logo=discord&style=for-the-badge)](https://discord.gg/GsEFRM8)

| <sub>EN</sub> [English](README.md) | <sub>RU</sub> [русский](ru/README_RU.md) | <sub>ES</sub> [Español](es/README_ES.md) | <sub>FR</sub> [Français](fr/README_FR.md) | <sub>TR</sub> [Türkçe](tr/README_TR.md) | <sub>ZH</sub> [中文](zh/README_ZH_CN.md) | <sub>BR</sub> [Português](br/README_BR.md) |
|-------------------------|----------------------------|----------------------------|----------------------------|----------------------------|-------------------------|--------------------|

強力で安定した高レベルの JavaScript [API](api.md) を使って、Minecraft ボットを作成できます。Python からも利用可能です。

Node.js を使うのが初めてですか？まずは [チュートリアル](tutorial.md) から始めましょう。Python に慣れているなら、[Python のサンプル集](https://github.com/PrismarineJS/mineflayer/tree/master/examples/python) や [Google Colab 上の Mineflayer](https://colab.research.google.com/github/PrismarineJS/mineflayer/blob/master/docs/mineflayer.ipynb) を試してみてください。

## 特長

 * Minecraft 1.8 から 1.21 まで (1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16, 1.17, 1.18, 1.19, 1.20, 1.21) に対応 <!--version-->
 * エンティティの把握と追跡
 * ブロック情報の参照。周囲のワールドを問い合わせ可能。任意のブロック検索もミリ秒単位
 * 物理と移動 — すべての当たり判定を処理
 * エンティティ攻撃と乗り物操作
 * インベントリ管理
 * クラフト、チェスト、ディスペンサー、エンチャントテーブル
 * 採掘と建築
 * 体力や天候などの各種ステータス取得
 * ブロックのアクティベートとアイテム使用
 * チャット

### ロードマップ

現在進行中のプロジェクトは [こちら](https://github.com/PrismarineJS/mineflayer/wiki/Big-Prismarine-projects) を参照してください。

## インストール

まず [nodejs.org](https://nodejs.org/) から Node.js >= 18 をインストールし、次のコマンドを実行します:

```bash
npm install mineflayer
```

mineflayer (および任意の Node.js パッケージ) と依存関係を更新するには次を使います。

```bash
npm update
```

## ドキュメント

| link | description |
|---|---|
|[tutorial](tutorial.md) | Node.js と mineflayer の入門 |
| [FAQ.md](FAQ.md) | よくある質問はこちら |
| **[api.md](api.md)** <br/>[unstable_api.md](unstable_api.md) | フル API リファレンス |
| [history.md](history.md) | mineflayer の変更履歴 |
| [examples/](https://github.com/PrismarineJS/mineflayer/tree/master/examples) | さまざまなサンプルボット |

## 貢献

[CONTRIBUTING.md](CONTRIBUTING.md) と [prismarine-contribute](https://github.com/PrismarineJS/prismarine-contribute) を参照してください。

## 使い方

**動画**

ボットの基本的なセットアップ手順を説明するチュートリアル動画は [こちら](https://www.youtube.com/watch?v=ltWosy4Z0Kw) にあります。

さらに学習したい場合は [こちらの再生リスト](https://www.youtube.com/playlist?list=PLh_alXmxHmzGy3FKbo95AkPp5D8849PEV) の動画と、対応するソースコード [こちら](https://github.com/TheDudeFromCI/Mineflayer-Youtube-Tutorials) を確認してください。

[<img src="https://img.youtube.com/vi/ltWosy4Z0Kw/0.jpg" alt="tutorial 1" width="200">](https://www.youtube.com/watch?v=ltWosy4Z0Kw)
[<img src="https://img.youtube.com/vi/UWGSf08wQSc/0.jpg" alt="tutorial 2" width="200">](https://www.youtube.com/watch?v=UWGSf08wQSc)
[<img src="https://img.youtube.com/vi/ssWE0kXDGJE/0.jpg" alt="tutorial 3" width="200">](https://www.youtube.com/watch?v=ssWE0kXDGJE)
[<img src="https://img.youtube.com/vi/walbRk20KYU/0.jpg" alt="tutorial 4" width="200">](https://www.youtube.com/watch?v=walbRk20KYU)

**はじめに**

バージョンを指定しない場合、接続先サーバーのバージョンは自動的に推測されます。認証方式を指定しない場合、Mojang 認証方式が推測されます。

### エコー例
```js
const mineflayer = require('mineflayer')

const bot = mineflayer.createBot({
  host: 'localhost', // Minecraft サーバーの IP
  username: 'Bot', // `offline` 認証の場合は参加名、オンラインの場合はこのアカウント固有の識別子
  auth: 'microsoft' // オフラインモードサーバーなら 'offline' を指定
  // port: 25565,              // ポートが必要なら指定
  // version: false,           // false で自動検出 (推奨)
  // password: '12345678',     // オンラインモードなら Microsoft パスワード
})

bot.on('chat', (username, message) => {
  if (username === bot.username) return
  bot.chat(message)
})

bot.once('spawn', () => {
  console.log('I spawned, and am ready to go')
})
```

### pathfinder を使った採掘

bot を使った採掘例です。
```js
const mineflayer = require('mineflayer')
const vec3 = require('vec3')

const bot = mineflayer.createBot({
  host: 'localhost',
  username: 'Bot',
  auth: 'microsoft'
})

bot.once('spawn', async () => {
  const mcData = await require('minecraft-data')(bot.version)
  const { Movements, goals } = require('mineflayer-pathfinder')(bot)
  const { GoalNear } = goals

  bot.chat('ready to dig some dirt')
  const defaultMove = new Movements(bot, mcData)
  bot.pathfinder.setMovements(defaultMove)
  bot.pathfinder.setGoal(new GoalNear(0, 0, 0, 16))
})
```

#### さらに詳しい例

| example | description |
|---|---|
|[viewer](https://github.com/PrismarineJS/mineflayer/tree/master/examples/viewer) | ブラウザでボットの視界を表示 |
|[pathfinder](https://github.com/PrismarineJS/mineflayer/tree/master/examples/pathfinder) | 任意の座標へ自動移動 |
|[chest](https://github.com/PrismarineJS/mineflayer/blob/master/examples/chest.js) | チェスト・かまど・ディスペンサー・エンチャントテーブル操作 |
|[digger](https://github.com/PrismarineJS/mineflayer/blob/master/examples/digger.js) | ブロックを掘削する簡単なボット |
|[discord](https://github.com/PrismarineJS/mineflayer/blob/master/examples/discord.js) | Discord ボットと連携 |
|[jumper](https://github.com/PrismarineJS/mineflayer/blob/master/examples/jumper.js) | 移動・ジャンプ・乗り物・攻撃動作 |
|[ansi](https://github.com/PrismarineJS/mineflayer/blob/master/examples/ansi.js) | 端末でチャット色を表示 |
|[guard](https://github.com/PrismarineJS/mineflayer/blob/master/examples/guard.js) | 指定エリアを警備するボット |
|[multiple-from-file](https://github.com/PrismarineJS/mineflayer/blob/master/examples/multiple_from_file.js) | 複数アカウントの一括ログイン |

その他の例は [examples](https://github.com/PrismarineJS/mineflayer/tree/master/examples) フォルダを参照してください。

### モジュール

活発な開発の多くは、mineflayer が利用している小さな npm パッケージ内で行われています。

#### The Node Way™

> 「アプリケーションが適切に作られていれば、それは抽象化しづらい本当にアプリ固有の残滓だけになります。便利で再利用可能なコンポーネントは GitHub や npm に流れ込んで、みんなが共同でコモンズを発展させられるのです。」 — substack, ["how I write modules"](https://gist.github.com/substack/5075355) より

#### 主なモジュール

これが mineflayer を構成する主要モジュールです。

| module | description |
|---|---|
| [minecraft-protocol](https://github.com/PrismarineJS/node-minecraft-protocol) | Minecraft パケットの解析とシリアライズ、認証、暗号化
| [minecraft-data](https://github.com/PrismarineJS/minecraft-data) | クライアント/サーバー/ライブラリ向けのデータ集
| [prismarine-physics](https://github.com/PrismarineJS/prismarine-physics) | Minecraft エンティティ用物理エンジン
| [prismarine-chunk](https://github.com/PrismarineJS/prismarine-chunk) | チャンクデータ保持クラス
| [node-vec3](https://github.com/PrismarineJS/node-vec3) | 堅牢な単体テスト付き 3D ベクトル演算
| [prismarine-block](https://github.com/PrismarineJS/prismarine-block) | ブロック情報の表現
| [prismarine-chat](https://github.com/PrismarineJS/prismarine-chat) | Minecraft チャットメッセージのパーサー
| [node-yggdrasil](https://github.com/PrismarineJS/node-yggdrasil) | Mojang 認証 (Yggdrasil) 用ライブラリ
| [prismarine-world](https://github.com/PrismarineJS/prismarine-world) | Prismarine のワールド実装
| [prismarine-windows](https://github.com/PrismarineJS/prismarine-windows) | Minecraft ウィンドウの表現
| [prismarine-item](https://github.com/PrismarineJS/prismarine-item) | アイテム情報の表現
| [prismarine-nbt](https://github.com/PrismarineJS/prismarine-nbt) | node-minecraft-protocol 用 NBT パーサー
| [prismarine-recipe](https://github.com/PrismarineJS/prismarine-recipe) | レシピ情報の表現
| [prismarine-biome](https://github.com/PrismarineJS/prismarine-biome) | バイオーム情報の表現
| [prismarine-entity](https://github.com/PrismarineJS/prismarine-entity) | エンティティ情報の表現

### デバッグ

`DEBUG` 環境変数を使うとプロトコルのデバッグ出力を有効にできます。

```bash
DEBUG="minecraft-protocol" node [...]
```

Windows の場合:
```
set DEBUG=minecraft-protocol
node your_script.js
```

## サードパーティ製プラグイン

Mineflayer はプラグイン方式に対応しており、誰でも Mineflayer 上にさらに高水準の API を追加できます。

更新が活発で便利なプラグイン例:

 * [minecraft-mcp-server](https://github.com/yuniko-software/minecraft-mcp-server) LLM から Mineflayer を操作できる MCP サーバー
 * [pathfinder](https://github.com/Karang/mineflayer-pathfinder) 多機能な A* パスファインダー
 * [prismarine-viewer](https://github.com/PrismarineJS/prismarine-viewer) シンプルな Web ベースのチャンクビューア
 * [web-inventory](https://github.com/ImHarvol/mineflayer-web-inventory) Web インベントリビューア
 * [statemachine](https://github.com/PrismarineJS/mineflayer-statemachine) 複雑な挙動向けステートマシン API
 * [Armor Manager](https://github.com/G07cha/MineflayerArmorManager) 防具の自動管理
 * [Dashboard](https://github.com/wvffle/mineflayer-dashboard) Mineflayer 用フロントエンドダッシュボード
 * [PVP](https://github.com/PrismarineJS/mineflayer-pvp) 基本的な PvP/PvE のための API
 * [Auto Eat](https://github.com/link-discord/mineflayer-auto-eat) 食料の自動摂取
 * [Auto Crystal](https://github.com/link-discord/mineflayer-autocrystal) エンドクリスタルの自動設置・破壊
 * [Tool](https://github.com/TheDudeFromCI/mineflayer-tool) ツール/武器の自動選択ユーティリティ
 * [Hawkeye](https://github.com/sefirosweb/minecraftHawkEye) 弓のオートエイム支援
 * [GUI](https://github.com/firejoust/mineflayer-GUI) ネストした GUI ウィンドウを async/await で操作
 * [Projectile](https://github.com/firejoust/mineflayer-projectile) 発射体の射角計算
 * [Movement](https://github.com/firejoust/mineflayer-movement) PvP 向けの滑らかで自然な移動
 * [Collect Block](https://github.com/PrismarineJS/mineflayer-collectblock) ブロック収集 API

その他にも以下をチェックしてください:

 * [radar](https://github.com/andrewrk/mineflayer-radar/) - canvas と socket.io を使った Web レーダーインターフェース。[YouTube デモ](https://www.youtube.com/watch?v=FjDmAfcVulQ)
 * [auto-auth](https://github.com/G07cha/MineflayerAutoAuth) - チャットベースのボット認証
 * [Bloodhound](https://github.com/Nixes/mineflayer-bloodhound) - エンティティにダメージを与えた原因を追跡
 * [tps](https://github.com/SiebeDW/mineflayer-tps) - 現在の TPS (処理 TPS) を取得
 * [panorama](https://github.com/IceTank/mineflayer-panorama) - ワールドのパノラマ画像を撮影
 * [player-death-event](https://github.com/tuanzisama/mineflayer-death-event) - プレイヤー死亡イベントを Mineflayer で発火

## Mineflayer を利用しているプロジェクト

 * [Voyager](https://github.com/MineDojo/Voyager) 大規模言語モデルを用いたオープンエンドの体験エージェント
 * [mindcraft](https://github.com/kolbytn/mindcraft) LLM と連携するためのライブラリ
 * [rom1504/rbot](https://github.com/rom1504/rbot)
   - [YouTube - らせん階段を建設](https://www.youtube.com/watch?v=UM1ZV5200S0)
   - [YouTube - 建物を複製](https://www.youtube.com/watch?v=0cQxg9uDnzA)
 * [Darthfett/Helperbot](https://github.com/Darthfett/Helperbot)
 * [vogonistic/voxel](https://github.com/vogonistic/mineflayer-voxel) - voxel.js でボットの行動を可視化
 * [JonnyD/Skynet](https://github.com/JonnyD/Skynet) - プレイヤーの行動をオンライン API に記録
 * [MinecraftChat](https://github.com/rom1504/MinecraftChat) (AlexKvazos による最終 OSS 版) - Web ベースの Minecraft チャットクライアント
 * [Cheese Bot](https://github.com/Minecheesecraft/Cheese-Bot) - クリーンな GUI を備えたプラグイン型ボット。Node-Webkit 製
 * [Chaoscraft](https://github.com/schematical/chaoscraft) - 遺伝的アルゴリズムを利用した Minecraft ボット。 [YouTube プレイリスト](https://www.youtube.com/playlist?list=PLLkpLgU9B5xJ7Qy4kOyBJl5J6zsDIMceH)
 * [hexatester/minetelegram](https://github.com/hexatester/minetelegram) - Mineflayer と telegraf を使った Minecraft- Telegram ブリッジ
 * [PrismarineJS/mineflayer-builder](https://github.com/PrismarineJS/mineflayer-builder) - サバイバルで設計図を印刷、向きも保持
 * [SilkePilon/OpenDeliveryBot](https://github.com/SilkePilon/OpenDeliveryBot) - アイテム配送ボット (Python)
 * [その他多数](https://github.com/PrismarineJS/mineflayer/network/dependents) - GitHub が検出した Mineflayer 利用プロジェクト

## テスト

### すべてのテスト

次を実行します。

```bash
npm test
```

### バージョン指定テスト

次を実行します。

```bash
npm run mocha_test -- -g <version>
```

`<version>` には `1.12` や `1.15.2` などの Minecraft バージョンを指定します。

### 特定テストの実行

次を実行します。

```bash
npm run mocha_test -- -g <test_name>
```

`<test_name>` には `bed`、`useChests`、`rayTrace` などのテスト名を指定します。

### 実行例

```bash
npm run mocha_test -- -g "1.18.1.*BlockFinder"
```

これは 1.18.1 のブロックファインダーテストを実行します。

## ライセンス

[MIT](/LICENSE)
