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
`bot.experience.*` が更新されたときに発火します。

#### "scoreboardCreated" (scoreboard)

スコアボードが追加されたときに発火。

#### "scoreboardDeleted" (scoreboard)

スコアボードが削除されたときに発火。

#### "scoreboardTitleChanged" (scoreboard)

スコアボードのタイトルが更新されたときに発火。

#### "scoreUpdated" (scoreboard, item)

スコアボード内の項目スコアが更新されたときに発火。

#### "scoreRemoved" (scoreboard, item)

スコアボード内の項目スコアが削除されたときに発火。

#### "scoreboardPosition" (position, scoreboard)

スコアボードの表示位置が更新されたときに発火。

#### "teamCreated" (team)

チームが追加されたときに発火。

#### "teamRemoved" (team)

チームが削除されたときに発火。

#### "teamUpdated" (team)

チームが更新されたときに発火。

#### "teamMemberAdded" (team)

チームにメンバーが追加されたときに発火。

#### "teamMemberRemoved" (team)

チームからメンバーが削除されたときに発火。

#### "bossBarCreated" (bossBar)

ボスバーが生成されたときに発火。

#### "bossBarDeleted" (bossBar)

ボスバーが削除されたときに発火。

#### "bossBarUpdated" (bossBar)

ボスバーが更新されたときに発火。

#### "heldItemChanged" (heldItem)

手持ちアイテムが変わったときに発火。

#### "physicsTick" ()

`bot.physicsEnabled` が true の場合、tick ごとに発火。

#### "chat:name" (matches)

チャットパターンの正規表現がすべてマッチしたときに発火。

#### "particle"

パーティクルが生成されたときに発火。

### 関数

#### bot.blockAt(point, extraInfos=true)

`point` のブロックを返します。未ロードなら `null`。`extraInfos` が true の場合、看板・絵画・ブロックエンティティ情報も含めます (低速)。`Block` を参照。

#### bot.waitForChunksToLoad()

多数のチャンク読込完了時に `void` を返す `Promise` を返します。

#### bot.blockInSight(maxSteps, vectorLength)

非推奨。代わりに `blockAtCursor` を使用してください。

視線先のブロック、または `null` を返します。
 * `maxSteps` - レイトレースのステップ数。既定 256。
 * `vectorLength` - レイの長さ。既定 `5/16`。

#### bot.blockAtCursor(maxDistance=256)

視線先のブロック、または `null` を返します。
 * `maxDistance` - 目線からの最大距離。既定 256。

#### bot.entityAtCursor(maxDistance=3.5)

視線先のエンティティ、または `null` を返します。
 * `maxDistance` - 目線からの最大距離。既定 3.5。

#### bot.blockAtEntityCursor(entity=bot.entity, maxDistance=256)

指定エンティティの視線先のブロック、または `null` を返します。
 * `entity` - エンティティオブジェクト
 * `maxDistance` - 目線からの最大距離。既定 256。

#### bot.canSeeBlock(block)

指定した `block` が視認可能かどうかを返します。

#### bot.findBlocks(options)

指定地点から近いブロックを検索します。
 * `options`:
   - `point` - 検索開始位置 (中心)。既定はボット位置。
   - `matching` - ブロックが条件を満たすと true を返す関数。ブロック ID または ID 配列も指定可。
   - `useExtraInfo` - 後方互換のため型で挙動が変化
      - **boolean** - `matching` 関数へ追加情報を渡します (遅くなります)
      - **function** - 二段階マッチング。`matching` が true の場合に追加情報付きで `useExtraInfo` を呼びます
   - `maxDistance` - 探索距離上限。既定 16。
   - `count` - 見つけるブロック数。既定 1。領域内に十分なブロックがなければ少ない件数で終了します。

見つかったブロック座標 (ブロックではなく座標) の配列を距離順で返します。

#### bot.findBlock(options)

`bot.blockAt(bot.findBlocks(options)[0])` の別名。単一ブロックまたは `null` を返します。

#### bot.canDigBlock(block)

指定 `block` が採掘可能で射程内かどうかを返します。

#### bot.recipesFor(itemType, metadata, minResultCount, craftingTable)

`metadata` を持つ `itemType` をクラフトできる `Recipe` インスタンスの配列を返します。

 * `itemType` - 作成したいアイテムの数値 ID
 * `metadata` - 作成したいアイテムのメタデータ。`null` で任意。
 * `minResultCount` - 現在のインベントリでこの個数以上作れるレシピのみを返します。`null` は 1。
 * `craftingTable` - `Block` インスタンス。`null` ならインベントリクラフトのみ対象。


#### bot.recipesAll(itemType, metadata, craftingTable)

`bot.recipesFor` と同様ですが、手持ち材料のチェックを行いません。

#### bot.nearestEntity(match = (entity) => { return true })

条件に合致する最も近いエンティティを返します (既定はすべてのエンティティ)。見つからなければ `null`。

```js
const cow = bot.nearestEntity(entity => entity.name.toLowerCase() === 'cow')
```

### メソッド

#### bot.end(reason)

サーバーとの接続を終了します。
* `reason` - 任意の文字列で終了理由を指定。

#### bot.quit(reason)

指定した理由で丁寧に切断します (既定 `'disconnect.quitting'`)。

#### bot.tabComplete(str, [assumeCommand], [sendBlockInSight], [timeout])

完了時に `matches` を返す `Promise` を返します。サーバーにコマンド補完を依頼します。
 * `str` - 補完したい文字列
 * `assumeCommand` - サーバーへ送るフラグ。既定 false
 * `sendBlockInSight` - サーバーへ送るフラグ。既定 true。パフォーマンス重視なら false
 * `timeout` - タイムアウト (ms)。既定 5000。期限超過時は空配列を返します。

#### bot.chat(message)

公開チャットへメッセージを送信します。長文は自動的に分割されます。

#### bot.whisper(username, message)

`/tell <username>` のショートカット。分割されたメッセージもすべてウィスパーされます。

#### bot.chatAddPattern(pattern, chatType, description)

非推奨。代わりに `addChatPattern` を使用してください。

Bukkit 系などチャット形式が頻繁に変わるサーバー向けに、チャット解析用の正規表現パターンを追加します。
 * `pattern` - マッチさせる正規表現
 * `chatType` - マッチ時に発火するイベント名 (例: "chat"、"whisper")
 * `description` - 任意の説明文

#### bot.addChatPattern(name, pattern, chatPatternOptions)

※ `bot.addChatPatternSet(name, [pattern], chatPatternOptions)` の別名です。

指定パターンがメッセージにマッチするたびに `"chat:name"` イベントを発火させます。
* `name` - 監視イベント名
* `pattern` - 受信メッセージにマッチさせる正規表現
* `chatPatternOptions` - オプション
  * `repeat` - 既定 true。初回マッチ後も継続監視するか
  * `parse` - マッチしたメッセージではなく正規表現のキャプチャグループを返す
  * `deprecated` - (**不安定**) bot.chatAddPattern との互換性維持用。将来削除予定

戻り値は `bot.removeChatPattern()` で削除する際に使える番号です。

#### bot.addChatPatternSet(name, patterns, chatPatternOptions)

複数パターンがすべてマッチしたときに `"chat:name"` イベントを発火させます。
* `name` - 監視イベント名
* `patterns` - メッセージにマッチさせる正規表現配列
* `chatPatternOptions` - オプション
  * `repeat` - 既定 true。初回マッチ後も継続するか
  * `parse` - マッチしたメッセージではなくキャプチャグループを返す

戻り値は `bot.removeChatPattern()` で削除する際に使える番号です。

#### bot.removeChatPattern(name)

チャットパターンを削除します。
* `name` - 文字列または数値

文字列を渡すとその名前のパターンをすべて削除します。数値なら該当する 1 つのみ削除します。

#### bot.awaitMessage(...args)

指定したメッセージのいずれかがチャットに現れたときに解決される Promise。

```js
async function wait () {
  await bot.awaitMessage('<flatbot> hello world')
  await bot.awaitMessage(['<flatbot> hello', '<flatbot> world'])
  await bot.awaitMessage(['<flatbot> hello', '<flatbot> world'], ['<flatbot> im', '<flatbot> batman'])
  await bot.awaitMessage('<flatbot> hello', '<flatbot> world')
  await bot.awaitMessage(/<flatbot> (.+)/)
}
```

#### bot.setSettings(options)

`bot.settings` プロパティを参照してください。

#### bot.loadPlugin(plugin)

プラグインを注入します。既にロード済みなら何もしません。

 * `plugin` - 関数

```js
function somePlugin (bot, options) {
  function someFunction () {
    bot.chat('Yay!')
  }

  bot.myPlugin = {}
  bot.myPlugin.someFunction = someFunction
}

const bot = mineflayer.createBot({})
bot.loadPlugin(somePlugin)
bot.once('login', function () {
  bot.myPlugin.someFunction()
})
```

#### bot.loadPlugins(plugins)

複数プラグインを注入します (`bot.loadPlugin` 参照)。
 * `plugins` - 関数の配列

#### bot.hasPlugin(plugin)

指定プラグインがロード済み (またはロード予定) かを確認します。

#### bot.sleep(bedBlock)

完了時に `void` を返す `Promise` を返します。ベッド (`Block` インスタンス) で就寝します。

#### bot.isABed(bedBlock)

`bedBlock` がベッドなら true を返します。

#### bot.wake()

完了時に `void` を返す `Promise` を返します。ベッドから起き上がります。

#### bot.setControlState(control, state)

ボットの移動を制御する基本メソッドで、Minecraft のキー入力と同じ挙動です。`control` を true にすると該当方向へ移動し、false で停止します。`bot.lookAt` と組み合わせて移動方向を調整できます (例: `jumper.js`).

 * `control` - `forward` / `back` / `left` / `right` / `jump` / `sprint` / `sneak`
 * `state` - `true` または `false`

#### bot.getControlState(control)

指定した操作が有効かどうかを返します。

#### bot.clearControlStates()

すべての操作状態を解除します。

#### bot.getExplosionDamages(entity, position, radius, [rawDamages])

爆発地点と半径から、その範囲内のエンティティが受けるダメージ量を返します。
防具がなく `rawDamages` が true でない場合は計算できないため `null` を返します。

 * `entity` - Entity インスタンス
 * `position` - [Vec3](https://github.com/andrewrk/node-vec3)
 * `radius` - 爆発半径
 * `rawDamages` - true で防具を無視して計算

#### bot.lookAt(point, [force])

指定座標を向き終えたら `void` を返す `Promise` を返します。

 * `point` - Vec3 インスタンス。正確にこの点を向きます。
 * `force` - `bot.look` の `force` を参照。

#### bot.look(yaw, pitch, [force])

指定した向きを向き終えたら `void` を返す `Promise` を返します。

 * `yaw` - 垂直軸周りの回転 (東を基準に反時計回りラジアン)
 * `pitch` - 上下方向の角度。0 が水平、`pi/2` が真上、`-pi/2` が真下。
 * `force` - true でサーバー側のスムーズ移動を省略。アイテム投下や弓射撃など正確な視線が必要な場合に true。

#### bot.updateSign(block, text, back = false)

看板のテキストを書き換えます。1.20 以降で `back` を真にすると背面テキストも設定できます (壁付けでない場合)。

#### bot.equip(item, destination)

装備完了または失敗時に `void` を返す `Promise` を返します。インベントリからアイテムを装備します。`item` が `Item` インスタンスならそのスロットのアイテム、数値なら ID が一致する最初のアイテムを装備します (ホットバーが最後に検索されます)。

 * `item` - `Item` インスタンス、またはアイテム ID
 * `destination`
   - `"hand"` (`null` も同義)
   - `"head"`
   - `"torso"`
   - `"legs"`
   - `"feet"`
   - `"off-hand"` (対応バージョンのみ)

#### bot.unequip(destination)

指定部位の装備を外します。完了時に `void` を返す `Promise`。

#### bot.tossStack(item)

アイテムスタックを投げ捨てます。完了時に `void` を返す `Promise`。

 * `item` - 捨てたいスタック。失敗した場合はエラーが発生します。

#### bot.toss(itemType, metadata, count)

指定アイテムを投げ捨てます。完了時に `void` を返す `Promise`。

 * `itemType` - アイテム ID
 * `metadata` - メタデータ。`null` で任意
 * `count` - 捨てる個数。`null` で 1

#### bot.elytraFly()

エリトラ飛行を開始します。完了時に `void` を返す `Promise`。失敗時はエラーを投げます。

#### bot.dig(block, [forceLook = true], [digFace])

ブロック破壊完了または中断時に `void` を返す `Promise`。

現在の装備で `block` を掘り始めます。`diggingCompleted` / `diggingAborted` イベントも参照。

同時に別ブロックを掘ることはできず、破壊完了か `bot.stopDigging()` を呼ぶまで他のブロックは掘れません。

 * `block` - 掘るブロック
 * `forceLook` - true で即座に視線を合わせて掘り開始。false でゆっくり向きを変えます。`'ignore'` で視線移動なし。`'raycast'` で視線地点へレイキャスト。
 * `digFace` - 既定 `'auto'`。ベクトルを指定するとその面を向いて掘削。`vec3(0, 1, 0)` なら上面。`'raycast'` で視線から見える面を選択 (アンチチート対策に有用)。

掘削完了前に再度 `bot.dig` を呼ぶと致命的な `diggingAborted` エラーになります。

#### bot.stopDigging()

掘削を停止します。

#### bot.digTime(block)

指定ブロックを破壊するのに必要な時間 (ms) を返します。

#### bot.acceptResourcePack()

リソースパックを受け入れます。

#### bot.denyResourcePack()

リソースパックを拒否します。

#### bot.placeBlock(referenceBlock, faceVector)

サーバーが設置を確認すると `void` を返す `Promise` を返します。

 * `referenceBlock` - 設置先の隣接ブロック
 * `faceVector` - `new Vec3(0, 1, 0)` など、どの面に設置するかを示すベクトル

新しいブロックは `referenceBlock.position.plus(faceVector)` に配置されます。

#### bot.placeEntity(referenceBlock, faceVector)

サーバーがエンティティ設置を確認すると `Entity` を返す `Promise`。
`referenceBlock.position.plus(faceVector)` に新しいブロックが配置されます。

#### bot.activateBlock(block, direction?: Vec3, cursorPos?: Vec3)

ブロックをアクティブ化します (ノートブロックを叩く、ドアを開くなど)。完了時に `void` を返す `Promise`。

 * `block` - 操作対象ブロック
 * `direction` - 任意。既定 `new Vec3(0, 1, 0)` (上)。ブロックとどの面でインタラクトするか。
 * `cursorPos` - 任意。既定 `new Vec3(0.5, 0.5, 0.5)`。クリック位置。コンテナエンティティ対象の場合は無視されます。

#### bot.activateEntity(entity)

エンティティをアクティブ化します (村人など)。完了時に `void` を返す `Promise`。

#### bot.activateEntityAt(entity, position)

指定位置をクリックしてエンティティをアクティブ化します (防具立てなど)。完了時に `void` を返す `Promise`。

#### bot.consume()

現在手に持っているアイテムを食べる・飲む。完了時に `void` を返す `Promise`。

#### bot.fish()

釣り竿を使用します。完了時に `void` を返す `Promise`。

#### bot.activateItem(offHand=false)

現在の手持ちアイテムを使用します (食事、弓、卵、花火等)。`offHand` が true ならオフハンド。

#### bot.deactivateItem()

アイテム使用を停止します (弓の射出、食事終了など)。

#### bot.useOn(targetEntity)

現在のアイテムをエンティティに使用します (鞍を付ける、ハサミを使う等)。

#### bot.attack(entity, swing = true)

プレイヤーやモブを攻撃します。

 * `entity` - 攻撃対象。`bot.nearestEntity()` や `bot.entities` で取得。
 * `swing` - 既定 true。false で腕振りアニメーションを行いません。

#### bot.swingArm([hand], showHand)

腕振りアニメーションを再生します。

 * `hand` - `left` または `right`。既定 `right`
 * `showHand` - パケットに手情報を含めるか。既定 true

#### bot.mount(entity)

乗り物に乗ります。降りるには `bot.dismount()`。

#### bot.dismount()

乗り物から降ります。

#### bot.moveVehicle(left, forward)

乗り物を操作します。

 * `left` - `-1` (右) または `1` (左)
 * `forward` - `-1` (後退) または `1` (前進)

方向はボットの向きに対する相対値です。

#### bot.setQuickBarSlot(slot)

ホットバーのスロット (0〜8) を選択します。

#### bot.craft(recipe, count, craftingTable)

クラフト完了で `void` を返す `Promise`。

 * `recipe` - `Recipe` インスタンス (`bot.recipesFor` 参照)
 * `count` - 操作回数。例: 棒 8 本を作るなら 2 回。`null` は 1
 * `craftingTable` - 使用するクラフト台の `Block`。不要なレシピなら `null`

#### bot.writeBook(slot, pages)

本と羽ペンに書き込む。完了時に `void` を返す `Promise`。

 * `slot` - インベントリウィンドウ座標 (36 がホットバー先頭等)
 * `pages` - ページ文字列配列

#### bot.openContainer(containerBlock or containerEntity, direction?, cursorPos?)

ブロックまたはエンティティのコンテナを開きます。`Container` インスタンスを返す Promise。

 * `containerBlock` / `containerEntity` - 開く対象
 * `direction` - 任意。既定 `new Vec3(0, 1, 0)`
 * `cursorPos` - 任意。既定 `new Vec3(0.5, 0.5, 0.5)`

#### bot.openChest(chestBlock or minecartchestEntity, direction?, cursorPos?)

非推奨。`openContainer` と同じ。

#### bot.openFurnace(furnaceBlock)

開いたかまどを表す `Furnace` インスタンスを返す Promise。

#### bot.openDispenser(dispenserBlock)

非推奨。`openContainer` と同じ。

#### bot.openEnchantmentTable(enchantmentTableBlock)

エンチャントテーブルを表す `EnchantmentTable` インスタンスを返す Promise。

#### bot.openAnvil(anvilBlock)

金床を表す `anvil` インスタンスを返す Promise。

#### bot.openVillager(villagerEntity)

取引ウィンドウを表す `Villager` インスタンスを返す Promise を返します。`ready` イベントで準備完了を検出できます。

#### bot.trade(villagerInstance, tradeIndex, [times])

開いている `villagerInstance` を使って取引します。完了時に `void` を返す `Promise`。

#### bot.setCommandBlock(pos, command, [options])

`pos` のコマンドブロックを設定します。

```js
{
  mode: 2,
  trackOutput: true,
  conditional: false,
  alwaysActive: true
}
```

`mode` は 0 (SEQUENCE)、1 (AUTO)、2 (REDSTONE)。既定値は 2。その他のオプションは既定 false。

#### bot.supportFeature(name)

現在の Minecraft バージョンで特定機能が利用可能か確認します。`lib/features.json` 参照。

#### bot.waitForTicks(ticks)

指定したゲーム内 tick が経過するまで待機する Promise ベースのタイマー。物理 tick 速度に依存せず、`setTimeout` のゲーム内版として利用可能。

#### bot.respawn()

`respawn` オプションを無効にしている場合、手動でリスポーンさせます。

### 低レベルのインベントリ操作

高レベル API が使えない場合に利用します。

#### bot.clickWindow(slot, mouseButton, mode)

ウィンドウ上でクリック操作を行います。完了時に `void` を返す `Promise`。

- 安定実装:
  - 0: 通常クリック
- 実験的:
  - 1: Shift クリック
  - 2: 数字キー
  - 3: 中クリック
  - 4: Drop クリック
- 未実装:
  - 5: ドラッグ
  - 6: ダブルクリック

詳細は https://minecraft.wiki/w/Protocol#Click_Container を参照。通常は `bot.simpleClick.*` を推奨。

#### bot.putSelectedItemRange(start, end, window, slot)

`slot` のアイテムを指定範囲へ移動します。完了時に `void` を返す `Promise`。

#### bot.putAway(slot)

`slot` のアイテムをインベントリへしまいます。

#### bot.closeWindow(window)

指定ウィンドウを閉じます。

#### bot.transfer(options)

アイテムを別範囲へ移動します。完了時に `void` を返す `Promise`。`options`:

 * `window` - 任意。対象ウィンドウ
 * `itemType` - アイテム ID
 * `metadata` - 任意。メタデータ
 * `sourceStart`, `sourceEnd` - 元範囲 (`sourceEnd` 未指定で `sourceStart+1`)
 * `destStart`, `destEnd` - 移動先範囲 (`destEnd` 未指定で `destStart+1`)
 * `count` - 移動数。既定 1
 * `nbt` - NBT 条件。既定 `nullish`

#### bot.openBlock(block, direction?: Vec3, cursorPos?: Vec3)

ブロックを開き、`Window` を表す Promise を返します。

#### bot.openEntity(entity)

インベントリ付きエンティティを開き、`Window` を返す Promise。

#### bot.moveSlotItem(sourceSlot, destSlot)

現在のウィンドウでスロット間を移動します。

#### bot.updateHeldItem()

`bot.heldItem` を最新化します。

#### bot.getEquipmentDestSlot(destination)

指定部位名の装備スロット ID を返します (head/torso/legs/feet/hand/off-hand)。

### bot.creative

クリエイティブモード向けの API 群です。ゲームモード変更検出は未実装なので、クリエイティブでの利用を前提とします。

#### bot.creative.setInventorySlot(slot, item)

サーバーがスロットを設定した時点で `void` を返す `Promise`。

 * `slot` - インベントリ座標
 * `item` - [prismarine-item](https://github.com/PrismarineJS/prismarine-item) インスタンス。`null` で削除

変更がある場合は `bot.inventory.on("updateSlot")` で通知されます。

#### bot.creative.clearSlot(slot)

スロットを `null` にします。完了時に `void` を返す `Promise`。

#### bot.creative.clearInventory()

インベントリ全体をクリアします。完了時に `void` を返す `Promise`。

#### bot.creative.flyTo(destination)

`startFlying()` を呼んで一定速度で直線移動し、到着時に `void` を返す `Promise`。
`destination` は Vec3。障害物があると失敗するので短距離の連続移動が推奨。経路探索は行いません。

通常の物理に戻すには `stopFlying()`。

#### bot.creative.startFlying()

`bot.physics.gravity` を 0 にします。浮遊しながらの作業に便利。終了時は `stopFlying()`。
浮遊しながら地面を掘りたい場合などに便利です。`flyTo()` の前に呼ぶ必要はありません。なお、飛行中は `bot.entity.velocity` が正確ではなくなります。

#### bot.creative.stopFlying()

`bot.physics.gravity` を元に戻します。
