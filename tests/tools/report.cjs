// Builds the evidence appendix from captured data; does not run a bot or alter golden plans.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {root}=require('../helpers/live');
const dir=path.join(root,'tests/fixtures');
const readGzip=name=>JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir,name))));
const lines=[];
const cell=value=>String(value).replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
const short=value=>{const s=JSON.stringify(value);return s.length<=220?s:s.slice(0,217)+'…';};
const summary=[];
for(const name of ['offline-run.log','live-final-run.log','vision-run.log','known-run.log']){
  const file=path.join(root,'tests/results',name);if(!fs.existsSync(file))continue;
  const raw=fs.readFileSync(file,'utf8');
  summary.push({name,lines:raw.split(/\r?\n/).filter(x=>/ℹ (tests|pass|fail|todo|duration_ms)|✔ (flat:|natural:)/.test(x))});
}
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(summary,null,2));
for(const name of ['live-flat.json','live-natural.json']){
  const file=path.join(root,'tests/results',name);if(fs.existsSync(file))fs.writeFileSync(path.join(dir,name+'.gz'),zlib.gzipSync(fs.readFileSync(file)));
}
if(fs.existsSync(path.join(root,'tests/results/vision.json')))fs.copyFileSync(path.join(root,'tests/results/vision.json'),path.join(dir,'vision-observation.json'));
lines.push('### 検証コマンドの結果','');
for(const row of summary)lines.push(`- ${row.name}: ${row.lines.join(' / ')}`);
lines.push('','`test:known` の2件と `test:vision` の1件は TODO なので、失敗を表示しても終了コード0。通常テストの成功と区別する。',
  '自然liveの各目標の詳細ログは `tests/fixtures/live-natural.json.gz`、フラットliveは `live-flat.json.gz`。','');
const natural=readGzip('live-natural.json.gz');
lines.push('| 最終自然live目標 | success | 秒 | 最終持ち物 |','|---|---|---:|---|');
for(const row of natural)lines.push(`| ${cell(row.input)} | ${row.returned.success} | ${(row.durationMs/1000).toFixed(2)} | ${cell(JSON.stringify(row.inventory))} |`);
lines.push('','### 14目標×5状態の計画手数','',
  'null は plan が見つからなかった結果。失敗理由と suggestions の全体は各 -plans.json に格納。','');
const labels=['flat-empty','flat-stocked','flat-underground','natural-empty','natural-stocked'];
const data=labels.map(label=>JSON.parse(fs.readFileSync(path.join(dir,label+'-plans.json'))));
lines.push('| 目標 | '+labels.join(' | ')+' |','|---|'+labels.map(()=> '---:').join('|')+'|');
for(const goal of Object.keys(data[0]))lines.push(`| ${goal} | ${data.map(x=>x[goal].plan?.length??'null').join(' | ')} |`);
lines.push('','### 元ワールドでの実行一覧','',
  '返り値欄はJSONの短縮表示。各行の番号は元ファイル配列の0始まりindexで、返り値・前後状態・ログ全文を辿れる。',
  'ログ欄はprefixのみ。省略は成功/未確認を意味しない。','');
for(const world of ['flat','natural']){
  const name=world+'-observations.json.gz',rows=readGzip(name);
  lines.push(`#### ${world} — ${rows.length}記録 (${name})`,'', '| index | 入力 | ms | 返り値/例外 | 前後の変化 | ログprefix |','|---:|---|---:|---|---|---|');
  rows.forEach((row,index)=>{
    const value=row.thrown?`throw ${row.thrown.name}: ${row.thrown.message}`:row.input.startsWith('stateManager.refresh')?'worldState全文（snapshotと元JSON参照）':short(row.returned);
    const effects=[];
    if(row.before&&row.after){
      if(JSON.stringify(row.before.position)!==JSON.stringify(row.after.position))effects.push('位置変化');
      if(JSON.stringify(row.before.items)!==JSON.stringify(row.after.items))effects.push('持ち物変化');
      if(row.before.yaw!==row.after.yaw||row.before.pitch!==row.after.pitch)effects.push('視線変化');
    }
    const prefixes=[...new Set((row.logs||[]).flatMap(s=>s.match(/\[(?:STATE|GOAP[^\]]*|EXECUTION|REACTIVE_GOAP|NAVIGATION|LOOK|IDLE|CHAT|HISTORY_ADD|COMMAND_RESULT|DIG|HAND_CRAFT|WORKBENCH_CRAFT|FURNACE_SMELT|PLACE_BLOCK|AUTO-[^\]]+)\]/g)||[]))].slice(0,6);
    lines.push(`| ${index} | ${cell(row.input)} | ${row.durationMs.toFixed(1)} | ${cell(value)} | ${effects.join('、')||'なし/対象外'} | ${prefixes.join(' ')} |`);
  });lines.push('');
}
lines.push('### 再現区画のフラット実行一覧','', '| 入力 | ms | 返り値 |','|---|---:|---|');
for(const row of readGzip('live-flat.json.gz'))lines.push(`| ${cell(row.input)} | ${row.durationMs??'-'} | ${cell(short(row.returned))} |`);
const file=path.join(root,'requests/2026-10-09_from-isg/00_observations.md');
const marker='（以下に検証後の結果と全実測一覧を追加する。）';
const source=fs.readFileSync(file,'utf8');
fs.writeFileSync(file,source.slice(0,source.indexOf(marker)+marker.length)+'\n\n'+lines.join('\n')+'\n');
console.log('Updated evidence appendix and immutable final verification fixtures.');
