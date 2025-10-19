# LLM統合プロンプト v0.11 - アーキテクチャ設計

**日付**: 2025-10-15
**目的**: スケーラブルなアイテム検索システムの設計
**技術選定**: LangChain vs カスタム実装の比較

---

## 課題の明確化

### v0.1の問題点
- **プロンプトが肥大化**: 60種類のアイテムリストをシステムプロンプトに直接記載
- **スケールしない**: Minecraftには1000種類以上のアイテムが存在
- **トークン浪費**: LLMが使わないアイテム情報まで毎回送信

### 目標
- LLMが自然言語（日本語）でアイテムを指定
- システムが正確なアイテムID（`diamond_pickaxe`）を返す
- プロンプトサイズを削減しつつ、柔軟性を維持

---

## 提案する解決策: Two-Step Tool Calling

### フロー概要

```
1. ユーザー: "ダイヤモンドのピッケルを作って"
   ↓
2. LLM: search_item("ダイヤモンドのピッケル") ツールを呼び出し
   ↓
3. システム: fuzzy searchで "diamond_pickaxe" を返す
   ↓
4. LLM: goal("diamond_pickaxe:1") コマンドを実行
```

### メリット
- **プロンプト削減**: アイテムリストを毎回送る必要がない
- **柔軟性**: 表記ゆれ（"ダイヤピッケル", "diamond pickaxe", "ひし形のツルハシ"）に対応
- **拡張性**: 新アイテム追加時もプロンプト変更不要

---

## アーキテクチャ選択: LangChain vs カスタム実装

### オプションA: LangChain（推奨）

#### 採用理由
1. **Tool Calling（Function Calling）が標準実装**
   - `@tool`デコレーターで簡単にツールを定義
   - LLMが自動的にツールを呼び出し、結果を受け取る
   - ReActパターン（Reasoning + Acting）が組み込み済み

2. **プロンプト管理が体系的**
   ```python
   from langchain.prompts import ChatPromptTemplate

   system_template = """
   あなたはMinecraftのAIプレイヤーです。

   ## 現在の状況
   {current_status}

   ## 使えるツール
   - search_item: アイテム名を検索して正確なIDを取得
   - goal: アイテムを作成
   """

   prompt = ChatPromptTemplate.from_messages([
       ("system", system_template),
       ("human", "{input}")
   ])
   ```

3. **会話履歴管理**
   ```python
   from langchain.memory import ConversationTokenBufferMemory

   memory = ConversationTokenBufferMemory(
       llm=llm,
       max_token_limit=2000,  # トークン制限を考慮
       return_messages=True
   )
   ```

4. **マルチプロバイダー対応**
   ```python
   # Gemini
   from langchain_google_genai import ChatGoogleGenerativeAI
   llm = ChatGoogleGenerativeAI(model="gemini-2.0-flash-exp")

   # OpenAI（切り替え簡単）
   # from langchain_openai import ChatOpenAI
   # llm = ChatOpenAI(model="gpt-4")
   ```

#### コード例

```python
from langchain.agents import tool
from langchain.agents import AgentExecutor, create_react_agent
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain.prompts import PromptTemplate

# ツール定義
@tool
def search_item(query: str) -> str:
    """
    日本語または英語のアイテム名から、正確なMinecraftアイテムIDを検索します。

    Args:
        query: "ダイヤモンドのピッケル", "diamond pickaxe", "ダイヤピッケル" など

    Returns:
        正確なアイテムID（例: "diamond_pickaxe"）またはエラーメッセージ
    """
    # 実装: Fuse.js, RapidFuzz, または単純な辞書検索
    from fuzzywuzzy import process

    items = {
        "diamond_pickaxe": ["ダイヤモンドのピッケル", "ダイヤピッケル", "diamond pickaxe"],
        "diamond_sword": ["ダイヤモンドの剣", "ダイヤの剣", "diamond sword"],
        "iron_ingot": ["鉄インゴット", "鉄の延べ棒", "iron ingot"],
        # ... 他のアイテム
    }

    # 全ての別名を展開
    item_map = {}
    for item_id, aliases in items.items():
        for alias in aliases:
            item_map[alias.lower()] = item_id

    # fuzzy match
    result = process.extractOne(query.lower(), item_map.keys())
    if result and result[1] > 70:  # 70%以上の類似度
        return item_map[result[0]]

    return f"アイテムが見つかりませんでした: {query}"

@tool
def goal(command: str) -> str:
    """
    GOAPシステムでアイテムを作成します。

    Args:
        command: "アイテムID:個数" 形式（例: "diamond_pickaxe:1"）

    Returns:
        実行結果（成功/失敗メッセージ）
    """
    # 実装: 既存のGOAPシステムを呼び出し
    # !goal inventory.{item_id}:{count} に変換して実行
    import re
    match = re.match(r'^(\w+):(\d+)$', command)
    if not match:
        return f"不正なコマンド形式: {command}"

    item_id, count = match.groups()
    goap_command = f"!goal inventory.{item_id}:{count}"

    # 既存のGOAPエグゼキュータを呼び出し
    # result = execute_goap_command(goap_command)
    return f"実行中: {goap_command}"

# エージェント作成
llm = ChatGoogleGenerativeAI(model="gemini-2.0-flash-exp", temperature=0.7)

tools = [search_item, goal]

prompt = PromptTemplate.from_template("""
あなたはMinecraftのAIプレイヤーです。

## 現在の状況
{current_status}

## 使えるツール
{tools}

## 会話履歴
{chat_history}

## ユーザーメッセージ
{input}

## あなたの思考プロセス
{agent_scratchpad}

必ず以下の形式で出力してください：
- アイテム名が曖昧な場合: search_itemツールで検索
- 正確なアイテムIDが分かったら: goalツールで実行
- 雑談の場合: Final Answerで返答

Thought: （現在の状況を分析）
Action: （使用するツール名）
Action Input: （ツールへの入力）
Observation: （ツールの結果）
... （必要に応じて繰り返し）
Thought: （最終的な判断）
Final Answer: （ユーザーへの発話）
""")

agent = create_react_agent(llm, tools, prompt)
agent_executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# 実行例
response = agent_executor.invoke({
    "input": "ダイヤモンドのピッケルを作って",
    "current_status": "位置: (125, 68, -45), 道具: iron_pickaxe x1",
    "chat_history": ""
})
```

#### 期待される実行フロー

```
Input: "ダイヤモンドのピッケルを作って"

Thought: ダイヤモンドのピッケルの正確なアイテムIDを確認する必要がある
Action: search_item
Action Input: ダイヤモンドのピッケル
Observation: diamond_pickaxe

Thought: アイテムIDが分かった。GOAPで作成を指示する
Action: goal
Action Input: diamond_pickaxe:1
Observation: 実行中: !goal inventory.diamond_pickaxe:1

Thought: コマンドを実行した
Final Answer: わかりました！ダイヤモンドのピッケルを作ります。
```

---

### オプションB: カスタム実装（非推奨だが理解のため記載）

#### 採用する場合
- 学習コストを避けたい
- 依存関係を最小にしたい
- 極めてシンプルなユースケース

#### 実装例

```javascript
// planner_bot/src/llm/agent.js

class SimpleAgent {
  constructor(llm, tools) {
    this.llm = llm
    this.tools = new Map(tools.map(t => [t.name, t]))
    this.history = []
  }

  async run(userInput, context) {
    const systemPrompt = this.buildSystemPrompt(context)
    const userPrompt = `${userInput}\n\n使えるツール:\n${this.getToolDescriptions()}`

    // Phase 1: LLMがツールを選択
    const response1 = await this.llm.generate({
      system: systemPrompt,
      user: userPrompt,
      schema: {
        thought: "string",
        tool: "string | null",
        tool_input: "string | null"
      }
    })

    if (!response1.tool) {
      return { speech: response1.thought, command: null }
    }

    // Phase 2: ツールを実行
    const tool = this.tools.get(response1.tool)
    const toolResult = await tool.execute(response1.tool_input)

    // Phase 3: 結果を元に最終出力
    const response2 = await this.llm.generate({
      system: systemPrompt,
      user: `${userInput}\n\nツール実行結果: ${toolResult}\n\n最終的にユーザーに何を伝えますか？`,
      schema: {
        speech: "string",
        command: "string | null"
      }
    })

    return response2
  }

  buildSystemPrompt(context) {
    return `あなたはMinecraftのAIプレイヤーです。

## 現在の状況
${context.status}

## 使えるツール
${this.getToolDescriptions()}
`
  }

  getToolDescriptions() {
    return Array.from(this.tools.values())
      .map(t => `- ${t.name}: ${t.description}`)
      .join('\n')
  }
}

// 使用例
const agent = new SimpleAgent(llm, [
  {
    name: "search_item",
    description: "アイテム名を検索",
    execute: async (query) => {
      // fuzzy search実装
      return "diamond_pickaxe"
    }
  },
  {
    name: "goal",
    description: "アイテムを作成",
    execute: async (command) => {
      // GOAP実行
      return "実行中"
    }
  }
])

const result = await agent.run("ダイヤモンドのピッケルを作って", context)
```

#### 課題
- ツール呼び出しロジックを自前実装
- エラーハンドリングが煩雑
- プロンプトバージョン管理が難しい
- LLM APIの変更に追随が必要

---

## 推奨: LangChainを採用すべき理由まとめ

### ✅ 圧倒的なメリット
1. **開発速度**: Tool Calling、メモリ管理が既に実装済み
2. **保守性**: LLM APIの変更に自動追随
3. **拡張性**: 新しいツールを`@tool`で簡単に追加
4. **デバッグ**: LangSmithで実行フローを可視化
5. **コミュニティ**: 問題解決のための情報が豊富

### ⚠️ デメリット
1. **学習コスト**: LangChainの概念（Agent, Tool, Memory）を理解する必要
2. **依存関係**: `langchain`, `langchain-google-genai` などをインストール
3. **抽象化**: 内部の挙動が見えにくい（デバッグが難しい場合も）

### 🎯 結論
- **v0.11以降はLangChainを採用すべき**
- カスタム実装は「学習用」または「極めてシンプルなケース」のみ
- 今後の機能拡張（探索、建築、村人との交渉など）を考えるとLangChainの方が有利

---

## 実装ロードマップ

### v0.11: アイテム検索システム
- [ ] LangChainのインストール
- [ ] `search_item` ツールの実装（fuzzy search）
- [ ] `goal` ツールの実装（既存GOAPとの連携）
- [ ] ReActエージェントの構築
- [ ] テストシナリオの実行

### v0.12: プロンプト最適化
- [ ] システムプロンプトの簡略化（アイテムリストを削除）
- [ ] トークン消費量の測定
- [ ] 会話履歴のトークンバッファ管理

### v0.2: Creative Actions統合
- [ ] `navigate` ツール（場所への移動）
- [ ] `explore` ツール（新しい場所の探索）
- [ ] マルチステップ計画立案

---

## 参考リンク

- [LangChain Documentation](https://python.langchain.com/)
- [LangChain Agents](https://python.langchain.com/docs/modules/agents/)
- [Tool Calling with Gemini](https://ai.google.dev/gemini-api/docs/function-calling)
- [RapidFuzz (fuzzy search library)](https://github.com/maxbachmann/RapidFuzz)

---

## 次のステップ

1. **LangChainのプロトタイプ作成** (`planner_bot/src/llm/langchain_agent.py`)
2. **アイテムデータベースの構築** (`config/items.yaml`)
3. **テストケースの作成** (`test/llm_agent_test.js`)
4. **v0.1との性能比較** (トークン消費量、応答速度、精度)
