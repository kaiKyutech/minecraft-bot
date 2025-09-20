# API リファレンス

## 列挙型 (Enums)

これらの列挙型は言語非依存の [minecraft-data](https://github.com/PrismarineJS/minecraft-data) プロジェクトに保存されており、
[node-minecraft-data](https://github.com/PrismarineJS/node-minecraft-data) を通じて参照できます。

### minecraft-data
[minecraft-data](https://github.com/PrismarineJS/node-minecraft-data) モジュールを通じて利用できます。

`require('minecraft-data')(bot.version)` を呼び出すとデータにアクセスできます。

### mcdata.blocks
ID をキーにしたブロック定義。

### mcdata.items
ID をキーにしたアイテム定義。

### mcdata.materials

キーが素材名、値はツールのアイテム ID をキーに効率倍率を値に持つオブジェクトです。

### mcdata.recipes
ID をキーにしたレシピ定義。

### mcdata.instruments
ID をキーにした演奏音定義。

### mcdata.biomes
ID をキーにしたバイオーム定義。

### mcdata.entities
ID をキーにしたエンティティ定義。

## クラス

### vec3

[andrewrk/node-vec3](https://github.com/andrewrk/node-vec3) を参照してください。

Mineflayer ではあらゆる座標をこのクラスのインスタンスとして扱います。

 * x - 南方向
 * y - 上方向
 * z - 西方向

座標を受け取る関数やメソッドは `Vec3` インスタンスのほか、3 要素の配列、`x`・`y`・`z` プロパティを持つオブジェクトも受け付けます。

### mineflayer.Location

### Entity

Entity はプレイヤー、モブ、アイテムなどを表します。さまざまなイベントで渡され、
自分自身のエンティティは `bot.entity` から参照できます。
詳しくは [prismarine-entity](https://github.com/PrismarineJS/prismarine-entity) を参照してください。

#### Player Skin Data

スキン情報が存在する場合、プレイヤーオブジェクトの `skinData` プロパティに格納されます。

```js
// player.skinData
{
  url: 'http://textures.minecraft.net/texture/...',
  model: 'slim' // もしくは 'classic'
}
```

### Block

[prismarine-block](https://github.com/PrismarineJS/prismarine-block) を参照してください。

加えて `block.blockEntity` プロパティにはブロックエンティティのデータが `Object` として入っています。内容はバージョンによって異なります。
```js
// 1.19 の sign.blockEntity の例
{
  GlowingText: 0, // 0 は false、1 は true
  Color: 'black',
  Text1: '{"text":"1"}',
  Text2: '{"text":"2"}',
  Text3: '{"text":"3"}',
  Text4: '{"text":"4"}'
}
```

看板のテキストを単純に取得したい場合は、不安定な blockEntity を直接読むのではなく [`block.getSignText()`](https://github.com/PrismarineJS/prismarine-block/blob/master/doc/API.md#sign) を利用してください。
```java
> block = bot.blockAt(new Vec3(0, 60, 0)) // ここに看板があると仮定
> block.getSignText()
[ "Front text\nHello world", "Back text\nHello world" ]
```
### Biome

[prismarine-biome](https://github.com/PrismarineJS/prismarine-biome) を参照してください。

### Item

[prismarine-item](https://github.com/PrismarineJS/prismarine-item) を参照してください。

### windows.Window (基底クラス)

[prismarine-windows](https://github.com/PrismarineJS/prismarine-windows) を参照してください。

#### window.deposit(itemType, metadata, count, nbt)

完了時に `void` を返す `Promise` を返します。

 * `itemType` - 数値のアイテム ID
 * `metadata` - 数値のメタデータ。`null` は任意値にマッチ
 * `count` - 預ける個数。`null` は 1 と同義
 * `nbt` - NBT データをマッチさせる。`null` は NBT を無視

#### window.withdraw(itemType, metadata, count, nbt)

完了時に `void` を返す `Promise` を返します。インベントリに空きがない場合は例外を投げます。

 * `itemType` - 数値のアイテム ID
 * `metadata` - 数値のメタデータ。`null` は任意値にマッチ
 * `count` - 取り出す個数。`null` は 1 と同義
 * `nbt` - NBT データをマッチさせる。`null` は NBT を無視

#### window.close()

### Recipe

[prismarine-recipe](https://github.com/PrismarineJS/prismarine-recipe) を参照してください。

### mineflayer.Container

チェストやディスペンサーなどのために windows.Window を拡張したクラスです。
`bot.openContainer(chestBlock または minecartchestEntity)` で開きます。

### mineflayer.Furnace

かまどや溶鉱炉向けに windows.Window を拡張したクラスです。
`bot.openFurnace(furnaceBlock)` で開きます。

#### furnace "update"

`furnace.fuel` または `furnace.progress` が更新されたときに発火します。

#### furnace.takeInput()

完了時に `item` を返す `Promise` を返します。

#### furnace.takeFuel()

完了時に `item` を返す `Promise` を返します。

#### furnace.takeOutput()

完了時に `item` を返す `Promise` を返します。

#### furnace.putInput(itemType, metadata, count)

完了時に `void` を返す `Promise` を返します。

#### furnace.putFuel(itemType, metadata, count)

完了時に `void` を返す `Promise` を返します。

#### furnace.inputItem()

投入スロットの `Item` インスタンスを返します。

#### furnace.fuelItem()

燃料スロットの `Item` インスタンスを返します。

#### furnace.outputItem()

出力スロットの `Item` インスタンスを返します。

#### furnace.fuel

残燃料量を 0〜1 の範囲で返します。

#### furnace.progress

調理進捗を 0〜1 の範囲で返します。

### mineflayer.EnchantmentTable

エンチャントテーブル用に windows.Window を拡張したクラスです。
`bot.openEnchantmentTable(enchantmentTableBlock)` で開きます。

#### enchantmentTable "ready"

`enchantmentTable.enchantments` が揃い、`enchantmentTable.enchant(choice)` で選択できる状態になると発火します。

#### enchantmentTable.targetItem()

対象となるアイテムを取得します。これは入力兼出力スロットです。

#### enchantmentTable.xpseed

サーバーから送信される 16 ビットの xpseed 値。

#### enchantmentTable.enchantments

選択肢となる 3 つのエンチャントが入った配列。サーバーから情報が届いていない場合は `level` が `-1` です。

```js
[
  {
    level: 3
  },
  {
    level: 4
  },
  {
    level: 9
  }
]
```

#### enchantmentTable.enchant(choice)

エンチャント完了時に `item` を返す `Promise` を返します。

 * `choice` - 0〜2 の整数で、選択したいエンチャントのインデックス。

#### enchantmentTable.takeTargetItem()

完了時に `item` を返す `Promise` を返します。

#### enchantmentTable.putTargetItem(item)

完了時に `void` を返す `Promise` を返します。
#### enchantmentTable.putLapis(item)

完了時に `void` を返す `Promise` を返します。

### mineflayer.anvil

金床用に windows.Window を拡張したクラスです。
`bot.openAnvil(anvilBlock)` で開きます。

#### anvil.combine(itemOne, itemTwo[, name])

完了時に `void` を返す `Promise` を返します。

#### anvil.combine(item[, name])

完了時に `void` を返す `Promise` を返します。

#### villager "ready"

`villager.trades` が読み込まれた際に発火します。

#### villager.trades

取引情報の配列です。

```js
[
  {
    firstInput: Item,
    output: Item,
    hasSecondItem: false,
    secondaryInput: null,
    disabled: false,
    tooluses: 0,
    maxTradeuses: 7
  },
  {
    firstInput: Item,
    output: Item,
    hasSecondItem: false,
    secondaryInput: null,
    disabled: false,
    tooluses: 0,
    maxTradeuses: 7
  },
  {
    firstInput: Item,
    output: Item,
    hasSecondItem: true,
    secondaryInput: Item,
    disabled: false,
    tooluses: 0,
    maxTradeuses: 7
  }
]
```

#### villager.trade(tradeIndex, [times])

[bot.trade(villagerInstance, tradeIndex, [times])](#bottradevillagerinstance-tradeindex-times) と同じです。

### mineflayer.ScoreBoard

#### ScoreBoard.name

スコアボードの内部名。

#### ScoreBoard.title

スコアボードに表示されるタイトル (name と異なる場合があります)。

#### ScoreBoard.itemsMap

スコアボードに含まれる全項目をまとめたオブジェクト。
```js
{
  wvffle: { name: 'wvffle', value: 3 },
  dzikoysk: { name: 'dzikoysk', value: 6 }
}
```

#### ScoreBoard.items

スコアボードの項目を並び替えた配列。
```js
[
  { name: 'dzikoysk', value: 6 },
  { name: 'wvffle', value: 3 }
]
```

### mineflayer.Team

#### Team.name

チーム名。

#### Team.friendlyFire

フレンドリーファイアの許可状況。

#### Team.nameTagVisibility

`always`、`hideForOtherTeams`、`hideForOwnTeam` のいずれか。

#### Team.collisionRule

`always`、`pushOtherTeams`、`pushOwnTeam` のいずれか。

#### Team.color

チームの色 (または装飾)。例: `dark_green`、`red`、`underlined`

#### Team.prefix

チームのプレフィックスを表すチャットコンポーネント。

#### Team.suffix

チームのサフィックスを表すチャットコンポーネント。

#### Team.members

チームメンバーの配列。プレイヤーはユーザー名、その他は UUID。

### mineflayer.BossBar

#### BossBar.title

ボスバーのタイトル。ChatMessage インスタンス。

#### BossBar.health

ボスの体力割合 (`0`〜`1`)。

#### BossBar.dividers

ボスバーの区切り数。`0`、`6`、`10`、`12`、`20` のいずれか。

#### BossBar.entityUUID

ボスバー対象エンティティの UUID。

#### BossBar.shouldDarkenSky

空を暗くするかどうか。
#### BossBar.isDragonBar

ドラゴンバーかどうか。

#### BossBar.createFog

霧を発生させるかどうか。

#### BossBar.color

ボスバーの色。`pink`、`blue`、`red`、`green`、`yellow`、`purple`、`white` のいずれか。

### mineflayer.Particle

#### Particle.id

[プロトコル](https://minecraft.wiki/w/Protocol#Particle) で定義されたパーティクル ID。

#### Particle.name

プロトコルで定義されたパーティクル名。

#### Particle.position

パーティクルが生成された位置を表す Vec3。

#### Particle.offset

パーティクルのオフセットを表す Vec3。

#### Particle.longDistanceRender

クライアントのパーティクル設定を無視して描画を強制するかどうか。描画距離を 256 から 65536 に拡張します。

#### Particle.count

生成されたパーティクル数。

#### Particle.movementSpeed

ランダム方向へのパーティクル速度。

## Bot

### mineflayer.createBot(options)

bot クラスのインスタンスを生成して返します。`options` は以下の任意プロパティを持つオブジェクトです。
 * username : 既定は `Player`
 * port : 既定は 25565
 * password : 省略可能 (token も省略するとオフラインモードで接続)
 * host : 既定は localhost
 * version : 接続先サーバーのバージョン。省略時は自動推測。例: "1.12.2"
 * auth : 既定は `mojang`。`microsoft` も指定可能。
 * clientToken : password が指定された場合に生成。
 * accessToken : password が指定された場合に生成。
 * logErrors : 既定で true。例外を捕捉してログ出力します。
 * hideErrors : 既定で true。`logErrors` が true でもログ出力を抑制します。
 * keepAlive : KeepAlive パケットを送信するか (既定 true)。
 * checkTimeoutInterval : KeepAlive 応答の監視間隔 (既定 `30*1000` ミリ秒)。応答がなければ切断します。
 * loadInternalPlugins : 既定 true。
 * storageBuilder : 任意。引数に version と worldName を受け取り、prismarine-provider-anvil と同等の API を持つインスタンスを返す関数。ワールド保存に利用します。
 * client : node-minecraft-protocol のインスタンス。指定しない場合は mineflayer が生成します。複数クライアントやプロキシ経由で利用する場合に指定します。
 * brand : クライアントブランド名。既定は `vanilla`。カスタムクライアントを装う用途に利用。
 * respawn : false にすると自動リスポーンを無効化 (既定 true)。
 * plugins : オブジェクト。既定 `{}`
   - pluginName : false → 指定した内部プラグインを読み込まない
   - pluginName : true → `loadInternalPlugins` が false でも指定プラグインを読み込む
   - pluginName : 外部プラグイン関数 → 指定名の外部プラグインを読み込み、内部実装を上書き
 * physicsEnabled : 既定 true。物理演算を適用するか。`bot.physicsEnabled` で後から変更可能。
 * [chat](#bot.settings.chat)
 * [colorsEnabled](#bot.settings.colorsEnabled)
 * [viewDistance](#bot.settings.viewDistance)
 * [difficulty](#bot.settings.difficulty)
 * [skinParts](#bot.settings.skinParts)
 * [enableTextFiltering](#bot.settings.enableTextFiltering)
 * [enableServerListing](#bot.settings.enableServerListing)
 * chatLengthLimit : 1 メッセージで送信できる最大文字数。未指定の場合、1.11 未満では 100、1.11 以上では 256。
 * defaultChatPatterns : 既定 true。`chat` や `whisper` など標準パターンを追加しない場合は false。

### プロパティ

#### bot.registry

ボットが使用する minecraft-data のインスタンス。prismarine-block など minecraft-data インスタンスを必要とするコンストラクタに渡します。

#### bot.world

ワールドを同期的に表現したオブジェクト。詳しくは http://github.com/PrismarineJS/prismarine-world を参照。

##### world "blockUpdate" (oldBlock, newBlock)

ブロックが更新された際に発火します。`oldBlock` と `newBlock` を比較できます。
通常の更新では `oldBlock` が `null` の場合があります。

##### world "blockUpdate:(x, y, z)" (oldBlock, newBlock)

特定座標の更新時に発火します。`oldBlock` と `newBlock` は全てのリスナーで `null` として受け取り、ワールドがアンロードされると自動でリスナーが解除されます。
通常の更新では `oldBlock` が `null` の場合があります。

#### bot.entity

自身のエンティティ。`Entity` 参照。

#### bot.entities

周囲のエンティティ一覧。entityId から Entity へのマップです。

#### bot.username

自分のユーザー名。

#### bot.spawnPoint

初期スポーン地点の座標。コンパスが指す位置です。

#### bot.heldItem

手に持っているアイテム。[prismarine-item](https://github.com/PrismarineJS/prismarine-item) のインスタンスとして表されます。

#### bot.usingHeldItem

食事や盾など、手持ちアイテムを使用中かどうか。

#### bot.game.levelType

#### bot.game.dimension

現在のディメンション。例: `overworld`、`the_end`、`the_nether`

#### bot.game.difficulty

#### bot.game.gameMode

#### bot.game.hardcore

#### bot.game.maxPlayers

#### bot.game.serverBrand

#### bot.game.minY

ワールドの最小 y。

#### bot.game.height

ワールドの高さ。
#### bot.physicsEnabled

物理演算を有効にするか (既定 true)。

#### bot.player

ボットのプレイヤー情報。
```js
{
  username: 'player',
  displayName: { toString: Function }, // ChatMessage オブジェクト
  gamemode: 0,
  ping: 28,
  entity: entity // 離れている場合は null
}
```

プレイヤーの ping は初期値 0 で、サーバーから情報が届くまで時間がかかります。

#### bot.players

ユーザー名をキーにしたプレイヤー一覧のマップ。

#### bot.tablist

`header` と `footer` を持つタブリストオブジェクト。

```js
{
  header: { toString: Function }, // ChatMessage オブジェクト
  footer: { toString: Function } // ChatMessage オブジェクト
}
```

#### bot.isRaining

#### bot.rainState

現在の降雨レベルを表す数値。雨が降っていないときは 0、降り始めると 1 まで徐々に増え、止むと再び 0 まで減少します。
`bot.rainState` が変化するたびに "weatherUpdate" イベントが発火します。

#### bot.thunderState

現在の雷雨レベルを表す数値。雷がないときは 0、雷雨が始まると 1 まで増え、止むと 0 まで減少します。変化時に "weatherUpdate" イベントが発火します。
雷雨中は `bot.rainState` と `bot.thunderState` の両方が変化します。

#### bot.chatPatterns

以下の形式のパターンオブジェクト配列です。
{ /regex/, "chattype", "description" }
 * /regex/ - 少なくとも 2 つのキャプチャグループを含む正規表現
 * 'chattype' - パターンが一致するチャット種別。例: "chat" や "whisper"。任意の文字列を指定可能。
 * 'description' - パターンの説明 (任意)。

#### bot.settings.chat

設定値:

 * `enabled` (既定)
 * `commandsOnly`
 * `disabled`

#### bot.settings.colorsEnabled

既定 true。サーバーからのチャットでカラーコードを受け取るかどうか。

#### bot.settings.viewDistance

以下の文字列または正の数値を指定できます。
 * `far` (既定)
 * `normal`
 * `short`
 * `tiny`

#### bot.settings.difficulty

server.properties と同じ設定。

#### bot.settings.skinParts

自分のスキンに表示する追加パーツを制御するブーリアン設定。

##### bot.settings.skinParts.showCape - boolean

マントを持っている場合、ここを false にすると非表示。

##### bot.settings.skinParts.showJacket - boolean

##### bot.settings.skinParts.showLeftSleeve - boolean

##### bot.settings.skinParts.showRightSleeve - boolean

##### bot.settings.skinParts.showLeftPants - boolean

##### bot.settings.skinParts.showRightPants - boolean

##### bot.settings.skinParts.showHat - boolean

#### bot.settings.enableTextFiltering - boolean
Notchian(バニラ)クライアントでは未使用で既定 false。

#### bot.settings.enableServerListing - boolean
サーバーリストにプレイヤーを表示するかどうかをサーバーへ通知します。

#### bot.experience.level

#### bot.experience.points

総経験値。

#### bot.experience.progress

次のレベルまでの進捗 (0〜1)。

#### bot.health

体力を半ハート単位で表した 0〜20 の数値。

#### bot.food

満腹度を半ターキーレッグ単位で表した 0〜20 の数値。

#### bot.foodSaturation

満腹度の上乗せ値。飽和度が 0 を超えている間は満腹度が減少しません。ログイン時は自動的に 5.0 が設定されます。食べ物を摂取すると飽和度と満腹度が増加します。

#### bot.oxygenLevel

酸素ゲージを表す 0〜20 の数値。

#### bot.physics

重力やジャンプ速度、終端速度などの物理パラメータ。変更は自己責任で行ってください。

#### bot.fireworkRocketDuration

花火ロケットによる加速が残っている tick 数。
#### bot.simpleClick.leftMouse (slot)

`bot.clickWindow(slot, 0, 0)` のラッパー。

#### bot.simpleClick.rightMouse (slot)

`bot.clickWindow(slot, 1, 0)` のラッパー。

#### bot.time.doDaylightCycle

gamerule doDaylightCycle が有効かどうか。

#### bot.time.bigTime

0 日目からの経過 tick 数。BigInt なので 2^51 - 1 を超えても精度を保ちます。

#### bot.time.time

0 日目からの経過 tick 数。

JavaScript の Number は 2^51 - 1 を超えると精度が失われるため、その場合は `bot.time.bigTime` を使用してください。ただし自然到達には約 14280821 年かかるため、実用上は問題になりません。

#### bot.time.timeOfDay

1 日の経過 tick 数。

Minecraft の時間は 20 tick = 1 秒、1 日 = 24000 tick (20 分) です。
0 が日の出、6000 が正午、12000 が日没、18000 が真夜中です。

#### bot.time.day

ワールドでの経過日数。

#### bot.time.isDay

現在が昼 (0〜13000 tick) かどうか。

#### bot.time.moonPhase

月齢。0〜7 で 0 が満月。

#### bot.time.bigAge

ワールド年齢 (tick)。BigInt で高精度。

#### bot.time.age

ワールド年齢 (tick)。2^51 - 1 を超えると精度が落ちるため、必要に応じて `bot.time.bigAge` を使用してください。

#### bot.quickBarSlot

選択されているホットバーのスロット (0〜8)。

#### bot.inventory

インベントリを表す [`Window`](https://github.com/PrismarineJS/prismarine-windows#windowswindow-base-class) インスタンス。

#### bot.targetDigBlock

現在採掘中の `block`。ない場合は `null`。

#### bot.isSleeping

ベッドで寝ているかどうか (boolean)。

#### bot.scoreboards

ボットが認知しているスコアボード (名前 → スコアボード) のマップ。

#### bot.scoreboard

表示スロットごとのスコアボード。

 * `belowName` - プレイヤー名の下
 * `sidebar` - サイドバー
 * `list` - プレイヤーリスト
 * `0-18` - [プロトコル](https://minecraft.wiki/w/Protocol#Display_Scoreboard) で定義されたスロット

#### bot.teams

ボットが認識しているすべてのチーム。

#### bot.teamMap

メンバーからチームへのマッピング。プレイヤーはユーザー名、その他は UUID を使用。

#### bot.controlState

メインの操作状態 (`forward`, `back`, `left`, `right`, `jump`, `sprint`, `sneak`) をキーに持つオブジェクト。

値を変更すると内部的に [bot.setControlState](#botsetcontrolstatecontrol-state) が呼び出されます。

### イベント

#### "chat" (username, message, translate, jsonMsg, matches)

プレイヤーが公開チャットしたときに発火します。

 * `username` - 発言者 (`bot.username` と比較して自分の発言を無視できます)
 * `message` - 色コードや制御文字を取り除いたメッセージ
 * `translate` - チャットメッセージタイプ。多くの Bukkit 系メッセージでは null
 * `jsonMsg` - サーバーからの JSON メッセージそのまま
 * `matches` - 正規表現による一致配列。存在しない場合は null

#### "whisper" (username, message, translate, jsonMsg, matches)

プレイヤーが自分へ個別チャットしたときに発火します。

 * `username` - 発言者
 * `message` - 色コードや制御文字を除いたメッセージ
 * `translate` - チャットメッセージタイプ。多くの Bukkit 系で null
 * `jsonMsg` - サーバーからの JSON メッセージ
 * `matches` - 正規表現マッチの配列。存在しない場合は null

#### "actionBar" (jsonMsg, verified)

アクションバーに表示されるサーバーメッセージごとに発火します。

 * `jsonMsg` - サーバーからの JSON メッセージ
 * `verified` - 署名なしなら null、署名済みで正しければ true、署名済みで不正なら false

#### "message" (jsonMsg, position, sender, verified)

チャットを含むあらゆるサーバーメッセージで発火します。

 * `jsonMsg` - 整形済みメッセージを含む [ChatMessage](https://github.com/PrismarineJS/prismarine-chat) オブジェクト。追加で以下のプロパティを持つ場合があります:
   * unsigned - 未署名の ChatMessage。1.19.2 以降で、サーバーがユーザー署名なしでメッセージを改変した場合にのみ存在

 * `position` - (1.8.1 以降) メッセージの表示箇所。`chat` / `system` / `game_info`

 * `sender` - 送信者の UUID (1.16+)。不明な場合は null。
#### "messagestr" (message, messagePosition, jsonMsg, sender, verified)

"message" イベントの別名で、発火前に prismarine-message の `toString()` を呼び出し文字列化します。

 * `sender` - 送信者の UUID (1.16+)。不明なら null
 * `verified` - 署名なしなら null、署名済みで正しければ true、署名済みで不正なら false

#### "inject_allowed"

インデックスファイルが読み込まれたときに発火します。ここで mcData やプラグインをロードできますが、通常は "spawn" を待つ方が安全です。

#### "login"

サーバーへのログイン成功後に発火します。ほとんどの場合、実際の処理は `spawn` イベントを待ってから行います。

#### "spawn"

初回ログイン後にスポーンした際、また死亡後のリスポーン時に発火します。サーバー上で処理を始める前に待機すべき代表的なイベントです。

#### "respawn"

ディメンション切り替え直後に発火します。通常はこのイベントを無視し、"spawn" を待ちます。

#### "game"

サーバーがゲーム設定を変更したときに発火します。

#### "resourcePack" (url, hash)

サーバーからリソースパックが送られたときに発火します。

#### "title" (title, type)

サーバーがタイトルを表示したときに発火します。

* `title` - タイトル文
* `type` - 種別 (`"subtitle"`, `"title"`)

#### "title_times" (fadeIn, stay, fadeOut)

タイトルのフェードイン/表示/フェードアウト時間が設定・更新されたときに発火します。

 * `fadeIn` - フェードイン時間 (tick)
 * `stay` - 表示時間 (tick)
 * `fadeOut` - フェードアウト時間 (tick)

```js
bot.on('title_times', (fadeIn, stay, fadeOut) => {
  console.log(`Title times: fadeIn=${fadeIn}, stay=${stay}, fadeOut=${fadeOut}`)
})
```

#### "title_clear"

タイトルが全て消去されたときに発火します。

#### "rain"

雨の開始・停止時に発火します。参加時に雨が降っていれば即座に発火します。

#### "weatherUpdate"

`bot.thunderState` または `bot.rainState` が変化したときに発火します。参加時に既に雨が降っている場合も発火します。

#### "time"

サーバーから時間更新を受け取ったときに発火します (`bot.time` 参照)。

#### "kicked" (reason, loggedIn)

サーバーからキックされたときに発火します。`reason` は理由を示すチャットメッセージ、`loggedIn` はログイン後なら true、ログインフェーズ中なら false。

#### "end" (reason)

サーバーとの接続が終了したときに発火します。`reason` は切断理由 (既定 'socketClosed')。

#### "error" (err)

エラー発生時に発火します。

#### "spawnReset"

ベッドでスポーンできずスポーン地点がリセットされたときに発火します。

#### "death"

死亡時に発火します。

#### "health"

HP または満腹度が変化したときに発火します。

#### "breath"

酸素ゲージが変化したときに発火します。

#### "entityAttributes" (entity)

エンティティの属性が変化したときに発火します。

#### "entitySwingArm" (entity)
#### "entityHurt" (entity)
#### "entityDead" (entity)
#### "entityTaming" (entity)
#### "entityTamed" (entity)
#### "entityShakingOffWater" (entity)
#### "entityEatingGrass" (entity)
#### "entityHandSwap" (entity)
#### "entityWake" (entity)
#### "entityEat" (entity)
#### "entityCriticalEffect" (entity)
#### "entityMagicCriticalEffect" (entity)
#### "entityCrouch" (entity)
#### "entityUncrouch" (entity)
#### "entityEquip" (entity)
#### "entitySleep" (entity)
#### "entitySpawn" (entity)
#### "entityElytraFlew" (entity)

エリトラ飛行を開始したとき。

#### "itemDrop" (entity)
#### "playerCollect" (collector, collected)

エンティティがアイテムを拾ったとき。

 * `collector` - アイテムを拾ったエンティティ
 * `collected` - 地面に落ちていたアイテムのエンティティ

#### "entityGone" (entity)
#### "entityMoved" (entity)
#### "entityDetach" (entity, vehicle)
#### "entityAttach" (entity, vehicle)

エンティティが乗り物 (トロッコやボートなど) に乗ったとき。

 * `entity` - 乗る側のエンティティ
 * `vehicle` - 乗り物側のエンティティ

#### "entityUpdate" (entity)
#### "entityEffect" (entity, effect)
#### "entityEffectEnd" (entity, effect)
#### "playerJoined" (player)
#### "playerUpdated" (player)
#### "playerLeft" (player)

#### "blockUpdate" (oldBlock, newBlock)

(可能であれば `bot.world` から利用する方が良い) ブロック更新時に発火。`oldBlock` と `newBlock` を比較できます。`oldBlock` は `null` の場合があります。

#### "blockUpdate:(x, y, z)" (oldBlock, newBlock)

特定座標のブロック更新時に発火します。`oldBlock` は `null` の場合があります。

#### "blockPlaced" (oldBlock, newBlock)

ボットがブロックを設置したときに発火。`oldBlock` は `null` の場合があります。

#### "chunkColumnLoad" (point)
#### "chunkColumnUnload" (point)

チャンクがロード/アンロードされたときに発火します。`point` は最小 x, y, z を持つチャンク角の座標です。

#### "soundEffectHeard" (soundName, position, volume, pitch)

名前付きサウンドを再生したときに発火します。

 * `soundName` - サウンド名
 * `position` - サウンド発生位置 (Vec3)
 * `volume` - 音量 (1.0 が 100%)
 * `pitch` - ピッチ (63 が 100%)

#### "hardcodedSoundEffectHeard" (soundId, soundCategory, position, volume, pitch)

固定 ID のサウンドを再生したときに発火します。

 * `soundId` - サウンド ID
 * `soundCategory` - サウンドカテゴリ
 * `position` - 発生位置 (Vec3)
 * `volume` - 音量 (1.0 が 100%)
 * `pitch` - ピッチ (63 が 100%)

#### "noteHeard" (block, instrument, pitch)

ノートブロックが鳴ったときに発火します。

 * `block` - 音を出した Block インスタンス
 * `instrument` - 以下の情報を含みます:
   - `id`: 整数 ID
   - `name`: [`harp`, `doubleBass`, `snareDrum`, `sticks`, `bassDrum`] のいずれか
 * `pitch` - 音程 (0〜24)。詳細は [公式 Wiki](http://minecraft.wiki/w/Note_Block) を参照。

#### "pistonMove" (block, isPulling, direction)

#### "chestLidMove" (block, isOpen, block2)

 * `block` - 蓋が開いたブロック (二連チェストなら右側)
 * `isOpen` - チェストを開いているプレイヤー数。0 なら閉じています。
 * `block2` - 二連チェストの場合のもう一方のブロック。単体なら null。

#### "blockBreakProgressObserved" (block, destroyStage, entity)

破壊中のブロックを観測したときに発火します。

 * `block` - 破壊されている Block インスタンス
 * `destroyStage` - 破壊進捗 (0〜9)
 * `entity` - ブロックを破壊しているエンティティ

#### "blockBreakProgressEnd" (block, entity)

破壊進行が終了したとき (完了または中断) に発火します。

 * `block` - 破壊対象だった Block インスタンス
 * `entity` - 破壊を停止したエンティティ

#### "diggingCompleted" (block)

 * `block` - 破壊が完了したブロック

#### "diggingAborted" (block)

 * `block` - 破壊が中断され残っているブロック

#### "usedFirework" (fireworkEntityId)

エリトラ飛行中に花火を使用した際に発火。

 * `fireworkEntityId` - 花火エンティティ ID

#### "move"

ボットが移動したときに発火。現在位置は `bot.entity.position`、移動前は `bot.entity.position.minus(bot.entity.velocity)`。

#### "forcedMove"

サーバーにより強制移動 (テレポートやスポーン) したときに発火。現在位置は `bot.entity.position` を参照。

#### "mount"

トロッコなどのエンティティに乗ったときに発火。乗り物は `bot.vehicle` で取得します。

#### "dismount" (vehicle)

エンティティから降りたときに発火します。

#### "windowOpen" (window)

作業台、チェスト、醸造台などを開いたときに発火します。

#### "windowClose" (window)

作業台やチェストなどの使用が終了したときに発火します。

#### "sleep"

就寝時に発火します。

#### "wake"

起床時に発火します。

#### "experience"
