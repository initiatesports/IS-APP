#!/usr/bin/env node
/* 後端引擎對驗（防復發）
   #SA(sports-attendance) 係 clone 自 #4(unified-system)，兩份 code 有大量同名函數。
   歷史問題：#4 修咗一個 bug，#SA 冇跟，靜靜分叉兩個星期都冇人知。
   2026-09-08 實例：#4 喺 08-24 把 findRow 由「名冊位置」改成「物理行 regIdx」，
   #SA 一直冇跟 → 教練點名會把出席寫落人哋嘅行（gym-sat2 6 個學生錯 5 個），
   純粹因為嗰班未開課、grid 仲空先冇污染真數據。

   呢個工具唔係做 diff（兩邊本來就應該有差異），而係掃「已知高危 pattern」：
   位置對應（students index → 物理行）一律當紅旗，兩個後端都要乾淨。
   零寫入、純文字掃描。 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BE = join(homedir(), "initiatesports", "IS-BACKENDS", "apps-script");
const TARGETS = [
  { key: "#4 unified-system", file: join(BE, "unified-system", "程式碼.js") },
  { key: "#SA sports-attendance", file: join(BE, "sports-attendance", "程式碼.js") },
];

/* 已知高危 pattern：用「名冊位置」推物理 grid 行。
   students 係 overlay 之後嘅名單，index／length 都唔對應物理行。 */
const RULES = [
  {
    id: "findRow-positional",
    re: /\bm\.students\.indexOf\s*\(\s*name\s*\)\s*;?\s*if\s*\(\s*ri\s*>=\s*0\s*\)\s*return\s+DATA_START\s*\+\s*ri/,
    msg: "findRow 用名冊位置推物理行 → 出席會寫落人哋嘅行。應改用 gridMeta 掃出嚟嘅 regIdx（姓名→真實行）。",
  },
  {
    id: "rowOf-positional",
    re: /rowOf\s*\[\s*nm\s*\]\s*=\s*DATA_START\s*\+\s*i\s*;\s*\}\s*\)\s*;/,
    msg: "restoreGridBatch_ 用名冊位置砌 rowOf → 還原備份會寫錯行。應優先用 m.regIdx（保留 fallback 可以）。",
    // 只有喺完全冇 regIdx fallback 嗰陣先算違規（見下面 guard）
    needsMissing: /m\.regIdx\s*&&\s*Object\.keys\s*\(\s*m\.regIdx\s*\)\.length/,
  },
  {
    id: "gridMeta-length-derived",
    re: /R\s*:\s*students\.length\s*,[\s\S]{0,80}?mkStart\s*:\s*DATA_START\s*\+\s*students\.length/,
    msg: "gridMeta 由 students.length 推 R／mkStart → 讀窗會溢入補堂區。應實掃物理「序號＋姓名」。",
  },
  {
    id: "roster-positional-compare",
    re: /if\s*\(\s*nm\s*!==\s*studs\s*\[\s*i\s*\]\s*\)/,
    msg: "健康檢查逐行對位置比對名冊 → 一個調班就報一大串假警報。應用「集合」比對，只捉孤兒行。",
  },
];

let problems = [];
let scanned = 0;

for (const t of TARGETS) {
  if (!existsSync(t.file)) {
    console.log(`  - ⏭️  ${t.key}：搵唔到 ${t.file}（未 clone？）→ 跳過`);
    continue;
  }
  scanned++;
  const src = readFileSync(t.file, "utf8");
  for (const r of RULES) {
    if (!r.re.test(src)) continue;
    if (r.needsMissing && r.needsMissing.test(src)) continue; // 已有安全寫法 → 唔當違規
    problems.push(`${t.key}｜${r.id}：${r.msg}`);
  }
}

console.log("# 後端引擎對驗（#4 ⇄ #SA 高危 pattern 掃描）");
console.log(`  - 掃描後端：${scanned}/${TARGETS.length}`);
if (!scanned) {
  console.log("  - ⏭️  冇後端可掃（IS-BACKENDS 唔喺本機）→ 跳過");
} else if (problems.length) {
  console.log(`  - 🔴 發現 ${problems.length} 個高危 pattern：`);
  problems.forEach((p) => console.log(`    - ${p}`));
} else {
  console.log("  - ✅ 兩個後端都冇「位置對應物理行」嘅高危 pattern");
}
console.log("\n---JSON---");
console.log(JSON.stringify({ scanned, problems }));
process.exit(0);
