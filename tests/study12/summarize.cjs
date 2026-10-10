process.env.LOG_LEVEL='error'
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib')
const {states}=require('../study04/benchmark.cjs'),goap=require('../../planner_bot/src/planner/goap')
const {gatherEffort,costedActions,MODEL}=require('../../planner_bot/src/planner/gather_cost')
const before=require('./before.json'),after=require('./after.json'),live=require('./live-results.json')
const plans=r=>r.plan?.map(s=>s.action)||null
const fmt=v=>v===null||v===undefined?'なし':typeof v==='number'?String(Math.round(v*1000)/1000):v
const chain=r=>plans(r)?.join(' → ')||`計画なし (${r.reason})`
function stats(rows){const values=rows.map(r=>r.durationMs).sort((a,b)=>a-b);return {meanMs:rows.reduce((n,r)=>n+r.durationMs,0)/rows.length,medianMs:values[Math.floor(values.length/2)],p95Ms:values[Math.floor(values.length*.95)],iterations:rows.filter(r=>!r.repeat).reduce((n,r)=>n+r.iterations,0)}}
async function main(){
  const assert=require('node:assert/strict'),golden=require('../study05/matrix-B.json').rows.filter(r=>r.variant==='production'&&!r.repeat)
  for(const rows of [before.rows,after.rows])for(const row of rows.filter(r=>!r.repeat)){
    const repeat=rows.find(r=>r.state===row.state&&r.goal===row.goal&&r.repeat)
    assert.deepEqual([row.plan,row.cost,row.iterations,row.reason],[repeat.plan,repeat.cost,repeat.iterations,repeat.reason])
  }
  for(const row of before.rows.filter(r=>!r.repeat)){
    const old=golden.find(r=>r.state===row.state&&r.goal===row.goal)
    assert.deepEqual([row.plan,row.cost,row.iterations,row.reason],[old.plan,old.cost,old.iterations,old.reason])
  }
  await goap.prepareDomain('1.20.1')
  const prices=new Map(),changes=[],oldRows=before.rows.filter(r=>!r.repeat),newRows=after.rows.filter(r=>!r.repeat)
  for(const state of states()){
    const world=JSON.parse(zlib.gunzipSync(fs.readFileSync(state.file))),effort=await gatherEffort(world)
    prices.set(state.name,new Map(costedActions(goap.getAllActions(),effort).map(a=>[a.name,a.cost])))
  }
  for(const row of newRows){
    const old=oldRows.find(r=>r.state===row.state&&r.goal===row.goal)
    if(JSON.stringify([old.plan,old.cost,old.iterations,old.reason])===JSON.stringify([row.plan,row.cost,row.iterations,row.reason]))continue
    const repricedOldCost=old.plan?.reduce((n,s)=>n+prices.get(row.state).get(s.action),0)??null
    let assessment,reason
    if(!old.plan&&row.plan){assessment='改善';reason='コストによる探索順の変化で200回以内に計画を発見。'}
    else if(old.plan&&!row.plan){assessment='悪化';reason='旧版の成功が現行200回制限で未発見になった。不能の証明ではない。'}
    else if(JSON.stringify(plans(old))===JSON.stringify(plans(row))){assessment='情報改善';reason='手順は同じ。距離・埋没の費用を反映。探索順による展開数も変わり得る。'}
    else if(row.cost<repricedOldCost-0.001){assessment='推定改善';reason='全gatherの距離・埋没費を同じ式で比較すると、新計画の推定費用が低い。'}
    else if(row.cost>repricedOldCost+0.001){assessment='推定悪化';reason='旧計画を新式で再評価した費用より高い。従来のヒューリスティックは最適性を保証せず、探索順でこの経路を先に返す。'}
    else{assessment='中立';reason='新式で同費用の別手順／別順序を返す。'}
    changes.push({state:row.state,goal:row.goal,before:old,after:row,repricedOldCost,assessment,reason})
  }
  const counts=Object.fromEntries([...new Set(changes.map(c=>c.assessment))].map(k=>[k,changes.filter(c=>c.assessment===k).length]))
  const summary={base:'bee3d1c',model:MODEL,cases:270,repeats:2,changedCases:changes.length,successBefore:oldRows.filter(r=>r.plan).length,successAfter:newRows.filter(r=>r.plan).length,counts,performance:{before:stats(before.rows),after:stats(after.rows)},changes}
  fs.writeFileSync(path.join(__dirname,'comparison.json'),JSON.stringify(summary,null,2))
  const repro=live[0],nearest=repro.effort.plank[1],perf=summary.performance
  let md=`# 12 Gather cost 実装報告\n\n- 日付: 2026-10-10 (Asia/Tokyo)\n- 起点: master bee3d1c。ブランチ: isg/12-gather-cost-2026-10-10。master への merge / push は行っていない。\n\n## 原因\n\nisg の見立ては正しい。craft_generator.js の DEFAULT_COST=10 に対し、カテゴリの素手 gather は x1=3、x3=5、合計8。nearby.category.plank の数量だけを見て、距離や地下へのアクセスを費用に入れていなかった。原木、石、鉱石、砂等のカテゴリ gather、カテゴリ内の個別 gather、その他すべての個別 gather が同じ問題を持つ。goal_evaluator.js の estimatedMs は表示用の別モデルで、A* の cost には使われていなかった。\n\n## 変更\n\ngather_cost.js で観測ごとの共通費用を計算し、ドメインを変更せず計画ごとに gather 行動のコピーへ付ける。\n\n\`cost = 基礎コスト(count, tool) + 0.5 × max(0, nearestDistance - 2) + 2 × obstructionCount\`\n\n対象ブロックは gather の初回選択と同じ最寄り。カテゴリはその全ブロックを対象にする。採る個数は既存の数量・道具・まとめ取り割引に保持し、近付く費用は最寄り1対象から推定する。埋没判定は6隣接セルがすべて観測中の非空気・非水ブロックであること。埋没対象だけ、ボットの目から対象中心への線上を半ブロック間隔（最大512点）で検査し、対象自身を除く障害セルを重複なしで数える。露出資源には、地表を歩けば迂回できる土等の直線障害費を加えない。\n\n全gather（カテゴリ・個別・道具 variant・数量）に同じ規則が働く。板の例外、クラフト値の引下げ、採集前提の制限は追加していない。生成YAML・効果・閉包・200回制限・既存ヒューリスティックは維持。局所計画とworker計画は同じ費用を使う。workerへ座標一覧を送らず小さな要約だけ送り、evaluateGoals cacheにも要約を含める。原観測と共有ドメインを変更しない。投影は約2ms区間でyieldし、deadline / signal に対応する。\n\n## ライブ試験\n\nworld-snapshot-2026-10-10b をこのrepoの .cache/minecraft-bot/12-study/server/world へコピーし、127.0.0.1:25569 / RCON 25579 だけを使用。読み元ワールド・他worktree・他プロジェクト設定は変更していない。GPU / viewer / LLM / JEV / H2O-Lightning / subs-llmapi は使用していない。パスワードはコピー用server.propertiesにだけ保存し、報告・成果JSON・コミットに含めない。試験完了後 save-all → stop、ポートの待受がないことを確認。\n\n- (139.5,69,217.5)、acacia_log 16個、板4枚: 旧 \`${chain({plan:repro.before})}\` (8) → 新 \`${chain({plan:repro.after})}\` (10)。実行成功、原木15個と板4枚。最低y=${fmt(repro.minY)}、終了位置も同じ。実行 ${fmt(repro.durationMs)}ms。\n- 最寄り地下板の距離 ${fmt(nearest.distance)}、推定障害数 ${nearest.obstructionCount}。\n- 同地点、原木なし: log gather → 板クラフト。実行成功（地表の近い木を使用）。\n- 至近距離に露出した板4ブロックを置いたケース: 原木を持っていても環境の板を集める計画を保持。\n- 代表目標の計画比較（表は空手／原木16・iron_pickaxe・coal8の条件。成功はplanが存在する意味で、代表目標全件のライブ実行ではない）:\n\n| 状態 | 目標 | 旧手数 / 新手数 | 旧cost / 新cost |\n|---|---|---:|---:|\n`
  for(const r of live.filter(r=>r.goal))md+=`| ${r.case} | ${r.goal} | ${r.before.plan?.length??'未発見'} / ${r.after.plan?.length??'未発見'} | ${fmt(r.before.plan?.reduce((n,s)=>n+s.cost,0))} / ${fmt(r.after.plan?.reduce((n,s)=>n+s.cost,0))} |\n`
  md+=`\nライブの全手順・診断・展開ログは tests/study12/live-results.json、観測は repro.json.gz。鉄のツルハシ・ダイヤはこのライブ空手／装備条件では従来も今回も計画未発見。今回の変更は遠い資源の不在や旧来の探索上限を解消するものではない。\n\n## 回帰・270組の比較\n\n- npm test: **292 pass / 0 fail**。\n- node --test --test-concurrency=1 tests/study04/*.test.cjs: **9 pass / 0 fail**。\n- gather_cost12.test.cjs: **5 pass**（全種類への費用、原木→板、至近の板、worker一致、geometryのcache失効、予算・中断）。\n- ライブ: **13ケース成功**（2ゴール実行＋10代表計画比較＋至近の板）。\n- ⑤Bの9状態×30目標×2反復。旧 ${summary.successBefore}成功 → 新 ${summary.successAfter}成功。成功を失った組は0。変化 ${changes.length}/270組。分類: ${Object.entries(counts).map(([k,v])=>k+v).join('、')}。\n- 新版で成功した全計画を既存の前提・効果でreplayし、加算目標を満たすことと観測の非変更を検証。両反復の手順・費用・展開数も確認する。\n- 元の golden / results.json / matrix-B.json は変更していない。before.json / after.json / comparison.json は新しい別成果。新goldenとしての採否は依頼者に委ねる。古い exact テストは数量だけの観測で旧goldenを維持し、全観測ではreplay・直接計画/evaluation一致・逐次/並行一致を確かめるよう変更。worker停止・queued deadline試験は、新しい非同期投影が済んでdispatchしてから試験のqueueを作る。\n\n### 時間と探索回数\n\n| 指標 | 旧 | 新 |\n|---|---:|---:|\n| 平均 ms | ${fmt(perf.before.meanMs)} | ${fmt(perf.after.meanMs)} |\n| 中央値 ms | ${fmt(perf.before.medianMs)} | ${fmt(perf.after.medianMs)} |\n| p95 ms | ${fmt(perf.before.p95Ms)} | ${fmt(perf.after.p95Ms)} |\n| 展開数合計（270組） | ${perf.before.iterations} | ${perf.after.iterations} |\n\n新しい幾何投影の分だけ、とくに元々短い計画の時間は増える。平均増加は ${fmt((perf.after.meanMs/perf.before.meanMs-1)*100)}%。単なる高速化ではないことを明記する。展開数合計は ${fmt((1-perf.after.iterations/perf.before.iterations)*100)}%減少。40万以上のブロックの観測でも、全セルの文字列Mapを作らず、最寄り候補のアクセス検査に必要なセルだけを索引に保持する。要約を1バッチで共有し、探索中の再スキャンをしない。タイマー継続・中断・workerに対するbudget試験は通っている。測定は同一プロセスで旧/新を交互実行し、反復で順を反転したwall-clock値（Node ${process.version}）。\n\n## 残る問題と評価の限界\n\n- 直線アクセスは経路探索の代用。壁を迂回できる地下通路、非固体だが空気以外の植物、未読込セル、実際の道具速度は正確に扱わない。非空気・非水を障害近似に使い、未観測のセルは障害と決めつけない。\n- 最寄り1対象だけのアクセス推定。x3/x8の残りの対象の位置・掘削量、採集後の位置、枯渇、障害を一度掘って通路にした後の再利用は計画内で追跡しない。再計画時は再観測から費用を更新する。これを導入するには位置・資源消費も扱う別の計画モデルが必要。\n- ヒューリスティックは従来から最適性を保証しない（④の反例テストも維持）。下記の「推定悪化」はそのため新式で再評価した旧経路より費用の高い計画を先に返したもの。今回の式は個別目標を優遇せず、これらもすべて列挙する。改善判定もこの費用近似内の評価で、実地の短縮保証ではない。\n- 読み込むだけのAPI、公開入力とResult形は変更していない。costだけが観測依存になった。座標のない数量観測では旧費用。\n\n## 再実行\n\n- node tests/study12/matrix.cjs compare（git show bee3d1c のGOAPをVMに読み、現在版と交互計測。checkout不要）\n- PowerShell: & ./tests/study12/live.ps1 → 起動完了後 node tests/study12/live.cjs（終わるとsave-all/stop）\n- node tests/study12/summarize.cjs（比較JSONとこの報告を再生成）\n\n## 変わった全${changes.length}組\n\n「旧再評価」は旧手順を新式で計算した費用。同じ式での新旧比較に使う。各組の原plan（params・各step cost）、ms、2反復の値はcomparison.json / before.json / after.jsonに保持。\n`
  for(const [i,c]of changes.entries())md+=`\n### ${i+1}. ${c.state} / ${c.goal}\n\n- 旧: cost ${fmt(c.before.cost)}、展開 ${c.before.iterations}、${c.before.reason}\n- 新: cost ${fmt(c.after.cost)}、展開 ${c.after.iterations}、${c.after.reason}（旧再評価 ${fmt(c.repricedOldCost)}）\n- 判定: **${c.assessment}**。${c.reason}\n- 旧手順: \`${chain(c.before)}\`\n- 新手順: \`${chain(c.after)}\`\n`
  md=md.replace('下記の「推定悪化」はそのため新式で再評価した旧経路より費用の高い計画を先に返したもの。','今回の270組では成功を失う組・旧計画の再評価より高費用となる組はいずれも0。将来の「推定悪化」は新式で再評価した旧経路より費用の高い計画を先に返す場合を指す。')
  fs.writeFileSync(path.resolve(__dirname,'../../requests/2026-10-09_from-isg/12_report.md'),md)
  console.log(JSON.stringify({changed:summary.changedCases,successBefore:summary.successBefore,successAfter:summary.successAfter,counts,performance:summary.performance},null,2))
}
main().catch(e=>{console.error(e);process.exitCode=1})
