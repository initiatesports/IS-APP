#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
//  INITIATE SPORTS — 部署前一致性檢查 (consistency guard)
//
//  目的：防止「更新時誤改了原本不打算改的東西」這類 bug 再發生。
//  每次 push / 部署前喺 repo 根目錄行：  node tools/check-consistency.mjs
//  有任何一項唔過 → 退出碼 1，唔好部署，先查清楚係咪計畫內嘅改動。
//
//  維護：當「以官網為準」嘅內容（私人訓練 PT、器材、章別）有合理改動時，
//  改完三個檔保持一致，呢個 script 自然會再次通過；唔好為咗令佢 pass 而
//  亂改 expectation。
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

let fails = 0;
const ok   = (m) => console.log('  ✓ ' + m);
const bad  = (m) => { console.log('  ✗ ' + m); fails++; };

// 抽出私人訓練彈窗嘅核心內容區（兒童 + 成人兩個 pane）。
const PT_START = '<div class="ptx-pane" id="ptx-pane-kid">';
const PT_END   = '</div><!-- /ptx-pane-adult -->';
function ptBlock(file) {
  const t = read(file);
  const s = t.indexOf(PT_START);
  const e = t.indexOf(PT_END);
  if (s < 0 || e < 0) return null;
  return t.slice(s, e + PT_END.length);
}

// ── 1) 私人訓練內容三檔一致（官網為準）────────────────────────────────────────
console.log('\n[1] 私人訓練 (PT) 內容跨檔一致 — 以 is-home.html 官網為準');
const PT_FILES = ['is-home.html', 'is-parent.html', 'is-leave-makeup.html'];
const blocks = PT_FILES.map((f) => ({ f, b: ptBlock(f) }));
const canonical = blocks[0].b;
if (!canonical) {
  bad('搵唔到 is-home.html 嘅 PT 內容區（官網基準遺失？）');
} else {
  for (const { f, b } of blocks) {
    if (b === null) bad(`${f} 缺少 PT 內容區（ptx-pane-kid…/ptx-pane-adult）`);
    else if (b !== canonical) bad(`${f} 嘅 PT 內容同官網唔一致 — 內容有改動就要三檔一齊改`);
    else ok(`${f} PT 內容與官網一致`);
  }
}

// ── 2) PT 內容區唔再寫死「張Sir」（應用「教練」）──────────────────────────────
console.log('\n[2] PT 內容區不應出現「張Sir」（統一用「教練」）');
for (const { f, b } of blocks) {
  if (!b) continue;
  if (/張\s?Sir/.test(b)) bad(`${f} 嘅 PT 內容仍有「張Sir」`);
  else ok(`${f} PT 內容已無「張Sir」`);
}

// ── 3) 家長端 modal app 要有「私人訓練」按鈕（ptx-fab）─────────────────────────
console.log('\n[3] 家長端 web app 要有「私人訓練」按鈕 (ptx-fab)');
for (const f of ['is-parent.html', 'is-leave-makeup.html']) {
  if (read(f).includes('class="ptx-fab"')) ok(`${f} 有私人訓練按鈕`);
  else bad(`${f} 缺少私人訓練按鈕 (ptx-fab)`);
}

// ── 4) 章別資料 Level 1–14 齊全且 desc 非空（防內容被截短）────────────────────
console.log('\n[4] is-attendance-app.html 章別 BADGE_DATA Level 1–14 齊全');
{
  const t = read('is-attendance-app.html');
  const found = new Set();
  const re = /\{id:(\d+),name:'[^']*',badge:'[^']*',url:'[^']*',desc:'([^']*)'\}/g;
  let m;
  while ((m = re.exec(t))) {
    const id = +m[1];
    if (id >= 1 && id <= 14 && m[2].trim().length > 0) found.add(id);
  }
  const missing = [];
  for (let i = 1; i <= 14; i++) if (!found.has(i)) missing.push(i);
  if (missing.length) bad('章別缺少或 desc 空白：Level ' + missing.join(', '));
  else ok('Level 1–14 全部存在且有描述');
}

// ── 5) 官網器材清單核心項目存在（防器材陣列被改錯）────────────────────────────
console.log('\n[5] is-home.html 器材清單核心項目存在');
{
  const t = read('is-home.html');
  for (const name of ['拍子繩', '鋼絲繩', '膠繩', '跳繩袋']) {
    if (t.includes(`name:'${name}'`)) ok(`器材「${name}」存在`);
    else bad(`器材「${name}」遺失`);
  }
}

console.log('\n' + (fails ? `✗ 一致性檢查未通過：${fails} 項問題 — 部署前請先處理。` : '✓ 全部一致性檢查通過。'));
process.exit(fails ? 1 : 0);
