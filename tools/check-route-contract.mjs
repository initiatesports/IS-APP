#!/usr/bin/env node
// 前後端 route 契約檢測（審計 2026-08-24）：捉「前端 call 一個後端冇/已改名嘅 action」——
//   呢個係公司歷史反覆出事嘅第一大類（2026-08-24 補堂壞正正係前端 audit#3 改咗、後端未對）。
//   IS-APP 同 IS-BACKENDS 係兩個 repo、CI 唔會 checkout 對面，所以呢個 lint 要喺兩個 repo 都喺本機
//   嗰度跑（每日 QA / 本機）。做法：union 全部後端 route case + 前端所有 action，報「冇任何後端 serve」嘅前端 action。
// 用法：node tools/check-route-contract.mjs   （預設 IS-BACKENDS 喺 ../IS-BACKENDS 或 ~/initiatesports/IS-BACKENDS）
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const FE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const BE_DIR = process.env.IS_BACKENDS_DIR
  || [join(FE_DIR, '..', 'IS-BACKENDS'), join(homedir(), 'initiatesports', 'IS-BACKENDS')].find(existsSync);

// 前端 call 但唔經後端 route 嘅（demo/本地/特殊）→ 唔當 mismatch
const ALLOW = new Set(['ping', '__routes', 'demo', 'preview']);

function backendRoutes() {
  if (!BE_DIR || !existsSync(BE_DIR)) {
    console.log('# route 契約檢測\n  - ⚠️ 搵唔到 IS-BACKENDS（設 IS_BACKENDS_DIR）→ 跳過（唔當有問題）');
    process.exit(0);
  }
  const set = new Set();
  const asDir = join(BE_DIR, 'apps-script');
  for (const proj of readdirSync(asDir, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue;
    for (const f of readdirSync(join(asDir, proj.name))) {
      if (!/\.(js|gs)$/.test(f)) continue;
      const src = readFileSync(join(asDir, proj.name, f), 'utf8');
      // route() 嘅 case 'X': ＋ preamble 嘅 action==='X' / action=='X'
      for (const m of src.matchAll(/case\s*['"]([a-zA-Z0-9_]+)['"]\s*:/g)) set.add(m[1]);
      for (const m of src.matchAll(/action\s*===?\s*['"]([a-zA-Z0-9_]+)['"]/g)) set.add(m[1]);
    }
  }
  return set;
}

function frontendActions() {
  const out = []; // {file, action}
  for (const f of readdirSync(FE_DIR)) {
    if (!f.endsWith('.html')) continue;
    const src = readFileSync(join(FE_DIR, f), 'utf8');
    const seen = new Set();
    const add = (a) => { if (a && !seen.has(a)) { seen.add(a); out.push({ file: f, action: a }); } };
    // 只認真正嘅 API call，唔好 match 任何 {action:'X'} 物件（如本地 DEMO.log）：
    //  ① api('X', …) / apiPost('X', …)           ② apiPost({ …action:'X'… }) / api({ …action:'X'… })
    for (const m of src.matchAll(/\bapi(?:Post)?\(\s*['"]([a-zA-Z0-9_]+)['"]/g)) add(m[1]);
    for (const m of src.matchAll(/\bapi(?:Post)?\(\s*\{[^}]{0,120}?\baction\s*:\s*['"]([a-zA-Z0-9_]+)['"]/g)) add(m[1]);
  }
  return out;
}

const routes = backendRoutes();
const actions = frontendActions();
const missing = actions.filter(a => !routes.has(a.action) && !ALLOW.has(a.action));

console.log('# 前後端 route 契約檢測');
console.log(`  - 後端 route 總數：${routes.size}；前端 action 引用：${actions.length}`);
if (!missing.length) {
  console.log('  - ✅ 全部前端 action 都有後端 route 對應（冇斷裂）');
  process.exit(0);
}
console.log(`  - 🔴 ${missing.length} 個前端 action 冇任何後端 route 對應（可能後端改名/刪走 → 該功能靜靜失效）：`);
for (const m of missing) console.log(`      ${m.file} → action:'${m.action}'`);
process.exit(1);
