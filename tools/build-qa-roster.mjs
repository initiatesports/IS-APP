#!/usr/bin/env node
/**
 * 建立每日家長 QA 用嘅名冊快照（/tmp/qa-roster.json），唔靠 Google Workspace MCP。
 *
 * 點解要有呢個：
 *  ① MCP 個 OAuth token 會過期，要老闆喺瀏覽器人手重新批准 —— 但每日自動巡查嗰陣冇人喺度，
 *    MCP 一過期 QA 就只可以用舊快照（甚至冇名冊），靜靜漏測。
 *  ② 就算 MCP 正常，佢讀嘅 Roster 分頁 **冇** 報名 overlay 新生（未 materialize），
 *    但佢哋其實登入得到（apiLogin 會併 overlay）→ 開學頭幾日最高風險嗰批家長反而冇測到。
 * 呢個工具直接問後端攞「而家真係登入得到嘅人」，兩個問題一齊解。
 *
 * 用法：COACH_PASS=... node tools/build-qa-roster.mjs [輸出路徑，預設 /tmp/qa-roster.json]
 * 全部 route 都係 coachPass gated 嘅**唯讀** export，零寫入。
 *
 * ⚠️ 私隱：輸出檔含學生姓名／電話後4位／自訂密碼 —— 只可以寫本機（/tmp 或 ~/.is-qa），
 *    **絕不可以** 入 repo / commit / 貼出去。呢個檔本身唔會印任何個人資料出 stdout。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ⚠️ 同 tools/qa-parents.mjs 一致（家長真正用緊嗰個 /exec）；切 /exec 兩邊要一齊改。
const EXEC4 = "https://script.google.com/macros/s/AKfycbxNikFcB8n34Lyqc-KKC0oIRhn_-35HXmrAo5mEVhGNZ5g21AdUEMFSca408oo0xUw/exec";
const EXEC_SA = "https://script.google.com/macros/s/AKfycbxDppkHErUG5qTob1oQmfLeCl7R9dZogGGYJA8dYQRU6H3spRZjDWMRUXc8V2dH7NA/exec";

const OUT = process.argv[2] || "/tmp/qa-roster.json";
const KEEP = join(homedir(), ".is-qa", "qa-roster-last.json");   // /tmp 會被清；留一份喺 home 保住自訂密碼
const PASS = process.env.COACH_PASS || "";
if (!PASS) { console.error("❌ 冇 COACH_PASS（由 Keychain 讀出再傳入，唔好寫入任何檔案）"); process.exit(2); }

const pad4 = x => ("0000" + String(x).replace(/\D/g, "")).slice(-4);

async function exportCsv(exec, type) {
  const u = `${exec}?action=export&type=${encodeURIComponent(type)}&coachPass=${encodeURIComponent(PASS)}`;
  // Apps Script 偶然會斷 socket（node fetch 拋 "fetch failed"）。單次失敗就回退／放棄名冊
  // ＝ QA 靜靜漏測，成本遠高於等多兩下 → 重試 3 次。
  let last;
  for (let i = 0; i < 3; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 120000);
    try {
      const r = await fetch(u, { redirect: "follow", signal: ac.signal });
      const j = await r.json();
      if (!j || !j.ok) throw new Error((j && j.err) || "後端拒絕");
      return String(j.csv || "");
    } catch (e) {
      last = e;
      if (String(e.message || "").indexOf("密碼") >= 0) break;   // 密碼錯，重試冇用
      await new Promise(s => setTimeout(s, 3000 * (i + 1)));
    } finally { clearTimeout(t); }
  }
  throw last;
}

// 後端 toCsv_ 會加 BOM，欄位有需要先會加引號。名／班別冇逗號，簡單解析已夠。
function parseRoster(csv) {
  const out = [];
  csv.replace(/^﻿/, "").split(/\r?\n/).slice(1).forEach(line => {
    if (!line.trim()) return;
    const c = line.split(",").map(s => s.replace(/^"|"$/g, "").trim());
    const [name, last4, cid] = c;
    if (!name || !last4 || !cid) return;   // 冇電話＝登入唔到（fail-closed，唔好當佢係 ERR）
    out.push([name, pad4(last4)]);
  });
  const seen = new Set();
  return out.filter(([n, l]) => { const k = n + "|" + l; if (seen.has(k)) return false; seen.add(k); return true; });
}

const prev = (() => {
  // 順序：今次輸出路徑 → home 長存本 → 預設 /tmp（MCP 正常嗰陣寫落嘅那份，自訂密碼多數喺呢度）
  for (const p of [OUT, KEEP, "/tmp/qa-roster.json"]) {
    try { if (existsSync(p)) { const j = JSON.parse(readFileSync(p, "utf8")); if (j && j.PIN4 && Object.keys(j.PIN4).length) return j; } } catch {}
  }
  return {};
})();

let R4 = [], RSA = [], warn = [];
try { R4 = parseRoster(await exportCsv(EXEC4, "roster_login")); }
catch (e) {
  warn.push("#4 roster_login 失敗：" + e.message);
  try { R4 = parseRoster(await exportCsv(EXEC4, "roster")); warn.push("#4 已回退 type=roster（唔含報名 overlay 新生）"); }
  catch (e2) { warn.push("#4 roster 亦失敗：" + e2.message); R4 = prev.R4 || []; }
}
try { RSA = parseRoster(await exportCsv(EXEC_SA, "roster")); }
catch (e) { warn.push("#SA roster 失敗：" + e.message); RSA = prev.RSA || []; }

// 自訂登入密碼：後端冇（亦唔應該有）route 派密碼 —— 沿用上一次由 MCP 讀落嚟嗰份。
// 有家長改咗自訂密碼而 MCP 又一直過期 → 嗰個家庭會報 ⚪ERR，係「要重新授權 MCP」嘅訊號，唔係後端壞。
const PIN4 = prev.PIN4 && typeof prev.PIN4 === "object" ? prev.PIN4 : {};

const j = { R4, RSA, R9: [], PIN4, builtAt: new Date().toISOString(), src: "backend export (roster_login)" };
writeFileSync(OUT, JSON.stringify(j), { mode: 0o600 });
try { mkdirSync(join(homedir(), ".is-qa"), { recursive: true, mode: 0o700 }); writeFileSync(KEEP, JSON.stringify(j), { mode: 0o600 }); } catch {}

console.log(`✅ 已建立 ${OUT}：恆常#4 ${R4.length} 人、運動班#SA ${RSA.length} 人、自訂密碼 ${Object.keys(PIN4).length} 個`);
warn.forEach(w => console.log("⚠️ " + w));
console.log("---JSON---");
console.log(JSON.stringify({ r4: R4.length, rsa: RSA.length, pins: Object.keys(PIN4).length, warn }));
