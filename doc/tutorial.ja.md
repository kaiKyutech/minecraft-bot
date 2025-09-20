# チュートリアル

**目次**

- [基礎編](#基礎編)
  - [JavaScript の基礎](#javascript-の基礎)
    - [Node のインストール](#node-のインストール)
    - [JavaScript の変数](#javascript-の変数)
    - [出力を表示する](#出力を表示する)
    - [JavaScript の関数](#javascript-の関数)
    - [JavaScript の型](#javascript-の型)
    - [if 文](#if-文)
    - [ループ](#ループ)
    - [Node パッケージマネージャ](#node-パッケージマネージャ)
  - [ボットを作成する](#ボットを作成する)
    - [JavaScript のオブジェクト](#javascript-のオブジェクト)
    - [ログイン](#ログイン)
  - [関数を渡す](#関数を渡す)
  - [イベントを待ち受ける](#イベントを待ち受ける)
  - [Promise](#promise)
    - [正しい書き方と間違った書き方](#正しい書き方と間違った書き方)
- [応用編](#応用編)
  - [オブジェクトをループする](#オブジェクトをループする)
  - [チャットからイベントを作る](#チャットからイベントを作る)
    - [Hello Bot に応答する](#hello-bot-に応答する)
    - [独自チャットイベント](#独自チャットイベント)
- [FAQ](#faq)
  - [Android でボットを動かすには](#android-でボットを動かすには)
    - [Termux をインストール](#termux-をインストール)
    - [セットアップ](#セットアップ)
    - [ボットの起動](#ボットの起動)

## はじめに

このチュートリアルは、Mineflayer を初めて扱う人がコーディング知識ゼロからでも使い始められるようサポートします。  
すでに Node や NPM について把握しているなら、[ボットを作成する](#ボットを作成する) セクションから読み始めても構いません。

## 基礎編

ここでは Mineflayer を使う前に知っておきたい基礎概念を紹介します。

### JavaScript の基礎

#### Node のインストール

このセクションでは JavaScript、Node、NPM の基本を学びます。

JavaScript は Web のために設計されたプログラミング言語で、多くのインタラクションを実現しています。  
Node.js (以下 Node) を使うと、Web ブラウザ以外でも JavaScript を実行できます。

最初のステップは Node をインストールすることです。[こちら](https://nodejs.org/en/download/) から入手してください。  
インストール後、コマンドプロンプト (ターミナル) を開いて `node -v` と入力します。  
正しくインストールできていればバージョン番号が表示されます。コマンドが見つからないと言われた場合は、再インストールを試してください。

Node が使えるようになったら、すぐにコードを書き始めることもできますが、その前にもう 1 つ準備をすることをおすすめします。  
JavaScript はメモ帳のようなテキストエディタでも書けますが、[統合開発環境](https://ja.wikipedia.org/wiki/%E7%B5%B1%E5%90%88%E9%96%8B%E7%99%BA%E7%92%B0%E5%A2%83) (IDE) を使うとより便利です。  
IDE はコード補完や潜在的な問題の警告などを提供してくれます。初心者には [Visual Studio Code](https://code.visualstudio.com/) (VS Code) が使いやすいでしょう。  
VS Code をインストールしてセットアップしたら、新しいファイルを作成し、`bot.js` のように `.js` 拡張子で保存してください。  
これで VS Code は JavaScript を編集していると認識し、適切な補完を提供してくれます。

#### JavaScript の変数

まず次のコードを入力してみましょう。

```js
const test = 5
```

これは `test` という名前の変数を作成し、値 `5` を代入します。  
変数はデータを保存し、後で使うためのものです。

ファイルを保存したら、ターミナルを開いてファイルを保存したフォルダに移動します。`cd` コマンドを使い、例: `cd Documents\javascript`。  
JavaScript ファイルと同じフォルダまで移動したら `node ファイル名.js` で実行できます。  
ここまでのコードを実行しても何も表示されません。  
次の章ではターミナルへ表示する方法を学びます。

基本的には `let` より `const` を使うのが良い習慣です。`const` で宣言した変数は後から再代入できず定数になります。  
変数の値が変わらないと分かっていれば、JavaScript はより効率的にコードを実行できます。  
もちろん値を変更したい場合は `let` を使ってください。

```js
const test = 5
// eslint-disable-next-line
test = 10 // この行は無効
```

2 行目は `test` に再代入しようとしているため無効です。

自分や他の人がコードを理解しやすくするにはコメントを活用しましょう。  
`//` 以降は JavaScript から無視されるコメントになります。

#### 出力を表示する

多くの場合、変数の現在値を確認して動作をチェックしたくなります。  
ターミナルに値を出力することで確認できます。  
JavaScript では `console.log()` 関数を使います。

```js
const test = 5

console.log(test)
```

保存して再実行すると次のように表示されます。

```txt
5
```

#### JavaScript の関数

次に関数について学びましょう。関数は何度でも呼び出せるコードの塊で、同じ処理を繰り返し書く手間を省けます。

```js
const addition = (a, b) => {
  return a + b
}

const test1 = addition(5, 10)
const test2 = addition(1, 0)

console.log(test1)
console.log(test2)
```

`=>` は関数を定義する矢印演算子です。  
矢印の前にある丸括弧 `()` 内はパラメーターリストで、カンマ区切りで引数を受け取ります。  
パラメーターは関数が処理するための入力値です。  
矢印の後の波括弧 `{}` 内が関数本体で、実際の処理を書きます。  
この例では関数に `addition` という名前を付けています。

コードでは `a` と `b` を受け取って足し合わせ、結果を返しています。  
関数は定義しただけでは実行されず、呼び出したタイミングで `{}` の中が動きます。  
呼び出すには関数名の後に丸括弧を付け、必要なパラメーターを渡します。`addition(1, 2)` のように書きます。  
実行後、関数呼び出しの部分は返り値に置き換わると考えると理解しやすいでしょう。

`function addition() {}` のような書き方もあり、意味は同じです。ただし一般的には `() => {}` が好まれます。(理由を詳しく知りたい場合は「javascript function vs arrow function」で検索してください)

このコードの出力は以下の通りです。

```txt
15
1
```

#### JavaScript の型

ここまで扱ったのは数値のみですが、JavaScript には他にもさまざまな型があります。

- 文字列: 複数文字を持つテキスト。引用符 `''` で囲みます。

```js
const string = 'This is a string' // 文字列型
```

- 配列: 複数の値をまとめて保持できる型。角括弧 `[]` で定義します。

```js
const array = [1, 2, 3] // 配列型
```

- オブジェクト: より高度なデータ構造で、後ほど詳しく扱います。波括弧 `{}` で定義します。

```js
const object = {} // オブジェクト型
```

- 関数も独自の型を持ちます。

```js
const adder = (a, b) => { return a + b } // 関数型
```

- 真偽値: `true` または `false` のみを取る型です。

```js
const boolean = true // 真偽値型
```

- まだ定義されていない場合、その型は `undefined` になります。

```js
let nothing // undefined
const notDefined = undefined // undefined
```

#### if 文

条件によって異なる処理を行いたい場合は if 文を使います。

```js
const name = 'Bob'

if (name === 'Bob') {
  console.log('Your name is Bob')
} else if (name === 'Alice') {
  console.log('Your name is Alice')
} else {
  console.log('Your name is not Bob or Alice')
}
```

`if` の後に丸括弧 `()` で条件を書き、波括弧 `{}` 内に条件が真 (`true`) のとき実行したい処理を書きます。  
条件は必ず真偽値に評価される式でなければなりません。この例では等価演算子 `===` を使い、左右の値が同じなら `true`、そうでなければ `false` になります。  
必要に応じて `else if` で条件を追加し、最後に `else` を書くと、どの条件にも当てはまらない場合の処理を定義できます。`else if` は必要な数だけ追加できますが、`if` と `else` はそれぞれ 1 回のみです。

#### ループ

ループは条件が満たされるまで同じ処理を繰り返します。

```js
let countDown = 5

while (countDown > 0) {
  console.log(countDown)
  countDown = countDown - 1
}

console.log('Finished!')
```

`while` ループは、条件が `true` の間 `{}` の処理を繰り返します。この例ではカウントダウンを表示し、毎回 1 ずつ減らしています。条件が `false` になった時点でループを抜けます。

`for` ループを使うと初期化・条件・更新処理を 1 行にまとめられます。

```js
for (let countDown = 5; countDown > 0; countDown = countDown - 1) {
  console.log(countDown)
}
```

丸括弧内はセミコロンで 3 つの部分に分かれています。最初は 1 回だけ実行される初期化、2 番目は条件、3 番目は各ループ後に実行される更新処理です。

配列の各要素を処理する場合は `for...of` ループが便利です。

```js
const array = [1, 2, 3]

for (const element of array) {
  console.log(element)
}
```

`of` の前で現在の要素を受け取る変数を宣言し、`of` の後に繰り返したい配列やイテラブルを指定します。各反復で `element` に現在の要素が代入されます。

#### Node パッケージマネージャ

NPM (Node Package Manager) は、他の人が作成した JavaScript パッケージをインストールして利用する仕組みです。  
Node をインストールすると自動的に付属し、`npm install パッケージ名` でライブラリを取得できます。

```bash
npm install mineflayer
```

インストール後は `require()` を使ってモジュールを読み込みます。

```js
const mineflayer = require('mineflayer')
```

これで `mineflayer` 変数からライブラリの機能にアクセスできます。  
`package.json` にはプロジェクト設定と依存関係が記録されており、Mineflayer プロジェクトでも活用します。

### ボットを作成する

#### JavaScript のオブジェクト

オブジェクトはキーと値のペアを保持できるデータ構造です。たとえば次のように記述します。

```js
const person = {
  name: 'Nick',
  age: 18
}
```

この例では `name` と `age` がキーで、それぞれ文字列と数値を値として持ちます。  
オブジェクトから値を取り出すには `person.name` や `person['age']` のようにアクセスします。

#### ログイン

では実際に Mineflayer のボットを作ってみましょう。

```js
const mineflayer = require('mineflayer')

const bot = mineflayer.createBot({
  host: 'localhost',
  port: 25565,
  username: 'Bot'
})
```

`createBot` に渡しているのがオブジェクトです。各キーの意味は以下の通りです。

- `host`: 接続するサーバーのアドレス
- `port`: サーバーのポート (省略時は 25565)
- `username`: ボットが使用する名前

このスクリプトを実行すると、指定したサーバーへログインしようとします。  
オンラインモードのサーバーに接続する場合は Microsoft アカウント認証が必要で、追加パラメーターが求められます。詳しくは [API リファレンス](api.md) を参照してください。

#### コマンドライン引数

他の人が同じボットを異なるサーバーやアカウントで使いたい場合、ソースコードに毎回サーバー情報やパスワードを書くのは不便で危険です。  
そこでコマンドライン引数を利用すると、実行時に接続情報を渡せます。

```js
const bot = mineflayer.createBot({
  host: process.argv[2],
  port: parseInt(process.argv[3]),
  username: process.argv[4],
  password: process.argv[5]
})
```

`process.argv` はコマンドライン引数を配列として保持しており、スペース区切りで分割されます。  
`node bot.js host port username password` と実行すると、`process.argv[2]` 以降に順番に値が入ります。  
こうしてコード内に認証情報を残さずに済みます。

### 関数を渡す

JavaScript では関数を別の関数に渡すことができます。Mineflayer の多くの API もコールバック関数を受け取ります。

```js
const runTask = (callback) => {
  console.log('task start')
  callback()
  console.log('task end')
}

runTask(() => {
  console.log('callback executed')
})
```

`runTask` はコールバックを受け取り、適切なタイミングで実行します。

### イベントを待ち受ける

Mineflayer のボットには多くの便利な[イベント](http://prismarinejs.github.io/mineflayer/#/api?id=events)があります。`bot.on('event', handler)` や `bot.once('event', handler)` を使って任意のイベントを監視できます。

```js
bot.on('spawn', () => {
  console.log('ログイン完了！')
})

bot.on('chat', (username, message) => {
  console.log(`[${username}]: ${message}`)
})
```

- `bot.on(eventName, listener)` : イベント `eventName` が発生するたびに `listener` を実行します。
- `bot.once(eventName, listener)` : 最初の 1 度だけ `listener` を実行します。
- `bot.removeListener(eventName, listener)` : 指定したリスナーを解除します。解除には `function myNamedFunc() {}` のような名前付き関数、または `const myNamedFunc = () => {}` のような変数経由で関数を参照できるようにしておく必要があります。

[`Chest`](http://prismarinejs.github.io/mineflayer/#/api?id=mineflayerchest) や [`Furnace`](http://prismarinejs.github.io/mineflayer/#/api?id=mineflayerfurnace)、[`Dispenser`](http://prismarinejs.github.io/mineflayer/#/api?id=mineflayerdispenser)、[`EnchantmentTable`](http://prismarinejs.github.io/mineflayer/#/api?id=mineflayerenchantmenttable)、[`Villager`](http://prismarinejs.github.io/mineflayer/#/api?id=mineflayervillager) などのオブジェクトにも独自のイベントがあります。


### Promise

[Promise](https://nodejs.dev/learn/understanding-javascript-promises) は、完了を待つことができる非同期処理です。`await` を付けると完了まで待機し、付けなければ待たずに次の処理へ進みます。

```js
async function consume (bot) {
  try {
    await bot.consume()
    console.log('Finished consuming')
  } catch (err) {
    console.log(err)
  }
}
```

このコードはボットが手に持っているものを食べようとし、成功すれば「Finished consuming」と表示します。失敗した場合は `catch` 節が実行されます。

#### 正しい書き方と間違った書き方

以下はオーク原木をオーク板にクラフトし、その後棒に加工する例です。

誤った例 ❌:

```js
function craft (bot) {
  const mcData = require('minecraft-data')(bot.version)
  const plankRecipe = bot.recipesFor(mcData.itemsByName.oak_planks.id ?? mcData.itemsByName.planks.id)[0]
  bot.craft(plankRecipe, 1)

  const stickRecipe = bot.recipesFor(mcData.itemsByName.sticks.id)[0]
  bot.craft(stickRecipe, 1)
}
```

正しい例 ✔️:

```js
async function craft (bot) {
  const mcData = require('minecraft-data')(bot.version)
  const plankRecipe = bot.recipesFor(mcData.itemsByName.oak_planks.id ?? mcData.itemsByName.planks.id)[0]
  await bot.craft(plankRecipe, 1, null)
  const stickRecipe = bot.recipesFor(mcData.itemsByName.sticks.id)[0]
  await bot.craft(stickRecipe, 1, null)
  bot.chat('Crafting Sticks finished')
}
```

誤った例では `bot.craft()` が完了する前に次のクラフト処理へ進んでしまうため、必要な素材がまだ用意されておらず失敗します。  
Promise と `await` を使えば、処理が完了してから次へ進めるため安全です。  
`bot.craft()` について詳しくは [API リファレンス](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md#botcraftrecipe-count-craftingtable) を参照してください。

## 応用編

ここから先は Mineflayer のボットを作るうえで必須ではありませんが、より高度なボットを作る際に役立つ概念です。  
[基礎編](#基礎編) を理解していることを前提としています。

### オブジェクトをループする

[ループ](#ループ) で紹介した `for...of` はオブジェクトにも応用できます。

```js
const obj = { a: 1, b: 2, c: 3 }

for (const value of Object.values(obj)) {
  console.log(value)
}
```

```txt
1
2
3
```

キーだけが欲しい場合は `Object.keys(obj)`、キーと値を同時に扱いたい場合は分割代入を使って `Object.entries(obj)` をループします。

```js
for (const [key, value] of Object.entries(obj)) {
  console.log(key + ', ' + value)
}
```

```txt
a, 1
b, 2
c, 3
```

`Object.values()` と `Object.keys()` は配列を返すので `for...of` で遍歴できます。`Object.entries()` は `[key, value]` 形式の配列を返します。  
なお、`for...in` ループはオブジェクト自身のプロパティだけでなく継承元のキーも列挙するため、意図しない結果を招くことがあります。多くの場合は `for...of` を使う方が安全です。

### チャットからイベントを作る

チャットパターンに基づいて独自のイベントを作りたい場合は [`bot.chatAddPattern()`](http://prismarinejs.github.io/mineflayer/#/api?id=botchataddpatternpattern-chattype-description) を使います。  
引数は次の 3 つです。

- `pattern`: マッチさせたい正規表現
- `chatType`: パターンに一致したときにボットが発火するイベント名 (例: `"chat"` や `"whisper"`)
- `description`: 任意。パターンの説明

正規表現でキャプチャグループを使うと、イベントリスナーの引数として順番に渡されます。正規表現については [MDN](https://developer.mozilla.org/ja/docs/Web/JavaScript/Guide/Regular_Expressions/Groups_and_Ranges) を参照してください。

#### Hello Bot に応答する

他のプレイヤーが「hello」と発言したら挨拶するボットの例です。

```js
bot.chatAddPattern(
  /(helo|hello|Hello)/,
  'hello',
  'Someone says hello'
)

const hi = () => {
  bot.chat('Hi!')
}

bot.on('hello', hi)
```

#### 独自チャットイベント

以下のようなカスタムチャットログから役職・名前・メッセージを抽出する例です。

```txt
[Player] Player1 > Hello
[Admin] Alex > Hi
[Player] Player2 > Help me, im stuck
[Mod] Jim > On my way
```

```js
bot.chatAddPattern(
  /^\[(.+)\] (\S+) > (.+)$/,
  'my_chat_event',
  'Custom chat event'
)

const logger = (rank, username, message) => {
  console.log(`${username} said ${message}`)
}

bot.on('my_chat_event', logger)
```

正規表現 `^\[(.+)\] (\S+) > (.+)$` の解説は [こちら](https://regex101.com/r/VDUrDC/2) を参照してください。

## FAQ

### Android でボットを動かすには

[Termux](https://termux.com/) を使って Android 端末上でボットを動かす手順です。

#### Termux をインストール

[Termux](https://termux.com/) をインストールして起動します。

#### セットアップ

Node.js をインストールします。

```bash
pkg update -y
pkg install nodejs -y
```

Termux のアプリ設定からストレージアクセスを許可してください。内部ストレージに作業用フォルダを作成します。

```bash
cd /sdcard
mkdir my_scripts
cd my_scripts
```

次に Mineflayer をインストールします。

```bash
npm install mineflayer
```

作成した `my_scripts` フォルダにスクリプトを保存してください。

#### ボットの起動

ボットを起動するには、スクリプト名を指定して Node を実行します。

```bash
node script_name.js
```

Termux を開くたびに作業ディレクトリを `/sdcard/my_scripts` に変更してから実行してください。

```bash
cd /sdcard/my_scripts
```
