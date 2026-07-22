#!/usr/bin/env node
/**
 * QA harness：以「真實家長身分」登入全部恆常班(#4)＋暑期班(#9)，
 * 自動偵測：未來堂誤標出席、跨家庭資料洩漏、登入失敗、學費負數、班別資料異常。
 * 全部用 login（唯讀），唔會寫入任何真實資料。
 *
 * 用法：node tools/qa-parents.mjs [YYYY-MM-DD]   （日期預設今日，香港時區）
 * 輸出：人類可讀報告 + 最後一行 JSON 摘要（畀排程解析）。
 */

const EXEC4 = "https://script.google.com/macros/s/AKfycbyI6UVHEZNXAr22Y9aZ4yeZrwv_brRG2aI3LMRo5M6hI7biFDQ4a6qNcPTUCnEjz5dX/exec";
const EXEC9 = "https://script.google.com/macros/s/AKfycby9Ln3kZUubqRIuGdCF5cJ5tk4KuPITMQDuOFFuee1OwrId5gUa_sP_W5CuHga9y6i8/exec";

const TODAY = process.argv[2] || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Hong_Kong" });

import { readFileSync } from "node:fs";
const pad4 = x => ("0000" + String(x).replace(/\D/g, "")).slice(-4);

// ⚠️ 私隱：呢個 repo 係 PUBLIC。學生姓名／電話尾4位／自訂密碼一律「唔可以」寫入呢度。
// 名冊＋密碼一律由執行時嘅 QA_ROSTER JSON 提供（排程用 MCP 讀 live Roster + 登入密碼，
// 寫去 /tmp、唔入 repo）。格式：{ "R4":[[姓名,尾4],...], "R9":[[...]], "PIN4":{尾4:密碼} }。
let R4 = [], R9 = [], PIN4 = {}, ROSTER_SRC = "(未提供)";
if (process.env.QA_ROSTER) {
  try {
    const j = JSON.parse(readFileSync(process.env.QA_ROSTER, "utf8"));
    if (Array.isArray(j.R4)) R4 = j.R4;
    if (Array.isArray(j.R9)) R9 = j.R9;
    if (j.PIN4 && typeof j.PIN4 === "object") PIN4 = j.PIN4;
    ROSTER_SRC = "live:" + process.env.QA_ROSTER;
  } catch (e) { console.error("⚠️ 讀 QA_ROSTER 失敗：" + e.message); }
}
// 已退出學生：名冊 sheet 未移除但已退學 → 硬跳過,唔再誤報登入失敗。新增退學者加入此 Set。
const EXITED = new Set(["陳靖朗"]);
R4 = R4.filter(([nm]) => !EXITED.has(String(nm).trim()));
R9 = R9.filter(([nm]) => !EXITED.has(String(nm).trim()));
if (!R4.length && !R9.length) {
  console.error("❌ 冇名冊資料。請設 QA_ROSTER 指向由 live sheet 建立嘅 JSON（見檔頭註解）。本工具唔再內建學生資料（私隱：public repo）。");
  process.exit(2);
}

// 未來堂只有呢啲狀態先當「誤標」（出席類）；請假/停課/豁免/轉堂屬合法預先安排。
const FUTURE_BAD = { "出席": 1, "補堂": 1, "加操": 1 };
// 歷史補完截止日（同後端 INFER_PRESENT_BEFORE 一致）：此日期前嘅過往堂唔應再有空白。
const HIST_CUTOFF = "2026-06-16";

async function callLogin(exec, name, cred) {
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {   // 重試 3 次，防短暫網絡
    try {
      const res = await fetch(exec, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "login", name, last4: cred }),
        redirect: "follow",
      });
      const txt = await res.text();
      try { return JSON.parse(txt); } catch { lastErr = "NON_JSON:" + txt.slice(0, 80); }
    } catch (e) { lastErr = e.message || String(e); }
    await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
  }
  return { ok: false, err: lastErr || "fetch failed" };
}

// 教練 load（authoritative grid）：回傳全校 attendance=[{key:"cid|date",name,status}]（只非空格）。
// 用嚟做「全班漏點」判斷，唔靠家長登入 → 杜絕「有標記學生登入失敗 → 全班誤判漏點」盲點。
async function callLoad(exec, coachPass) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(exec, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "load", coachPass }),
        redirect: "follow",
      });
      const txt = await res.text();
      try { return JSON.parse(txt); } catch { /* 重試 */ }
    } catch (e) { /* 重試 */ }
    await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
  }
  return { ok: false, err: "load fetch failed" };
}

async function callAudit(exec, coachPass) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(exec + "?" + new URLSearchParams({ action: "audit", coachPass }), { redirect: "follow" });
      const txt = await res.text();
      try { return JSON.parse(txt); } catch { /* 重試 */ }
    } catch (e) { /* 重試 */ }
    await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
  }
  return { ok: false, err: "audit fetch failed" };
}

function uniqByName(rows) {
  const seen = new Set(), out = [];
  for (const [n, l] of rows) { if (!seen.has(n)) { seen.add(n); out.push([n, l]); } }
  return out;
}

const anomalies = [];
const add = (sev, sys, who, msg) => anomalies.push({ sev, sys, who, msg });
const clsDate = {};   // 恆常#4 班別×日期點名覆蓋：偵測整班漏點

async function sweep(label, exec, rows, withPin) {
  const students = uniqByName(rows);
  let okCount = 0;
  for (const [name, last4] of students) {
    const cred = (withPin && PIN4[pad4(last4)]) ? PIN4[pad4(last4)] : pad4(last4);
    const r = await callLogin(exec, name, cred);
    if (!r || !r.ok) { add("ERR", label, name, "登入失敗：" + ((r && r.err) || "?")); continue; }
    okCount++;
    const surn = name.trim().charAt(0);

    // 1) 資料洩漏：children 含唔同姓（非真兄弟姊妹）；私訓 pseudo-student（如 Keith & Elaine）唔計
    const kids = (r.children || []).filter(c => !c.ptOnly).map(c => c.name);
    const foreign = kids.filter(k => k.trim().charAt(0) !== surn);
    if (foreign.length) add("LEAK", label, name, "登入後見到唔同姓學生：" + foreign.join("、"));

    // 2) 未來堂誤標：date > 今日 但有狀態
    for (const c of (r.children || [])) {
      for (const cls of (c.classes || [])) {
        for (const s of (cls.sessions || [])) {
          if (s.date > TODAY && FUTURE_BAD[s.status]) {
            add("FUTURE", label, c.name, `${cls.cid || cls.key || ""} ${s.date} 未到但顯示「${s.status}」`);
          }
        }
        // 3) 學費負數
        const net = cls.net != null ? cls.net : (cls.owed != null ? cls.owed : null);
        if (net != null && Number(net) < 0) add("FEE", label, c.name, `${cls.cid || cls.key} 應繳負數 ${net}`);
        // 3b) 補堂完整性（信任重災）：未來請假被顯示「已補堂」＝補堂日期對唔上原缺席日，家長會覺得騙咗一堂。
        //     用同 is-parent 一致嘅 madeUp 邏輯（makeups 出席+from）。
        const mkMade = new Set((cls.makeups || []).filter(m => m.status === "出席" && m.from).map(m => m.from));
        for (const s of (cls.sessions || [])) {
          if (s.status === "請假" && s.date > TODAY && (mkMade.has(s.date) || s.madeUp)) {
            // 多數＝合法提前補堂（有真出席補堂＋明確原缺席日）；但若補堂日對唔上／無真補堂＝陳思允式錯配 bug。agent 需核對。
            const clsId = cls.cid || cls.key || (cls.sport ? cls.sport + "|" + cls.wd : "?");
            add("MKMADEUP", label, c.name, `${clsId} ${s.date} 未來請假顯示已補堂（核對：有無對應真出席補堂；多數係提前補堂則正常）`);
          }
        }
        // 4) 歷史補完（只恆常#4）：截止日前嘅過往堂應已補完，唔應再有空白
        if (label === "恆常#4") {
          const gaps = (cls.sessions || []).filter(s => s.date < HIST_CUTOFF && s.date <= TODAY && !s.status).map(s => s.date);
          if (gaps.length) add("HISTGAP", label, c.name, `${cls.cid || cls.key} 截止日前仍空白：${gaps.join(" ")}`);
          // 5) 整班漏點：統計截止日後、今日之前嘅上課日空白（逐班逐日匯總，全班空白＝漏點）
          for (const s of (cls.sessions || [])) {
            if (s.date >= HIST_CUTOFF && s.date < TODAY) {
              const k = (cls.cid || cls.key) + "|" + s.date;
              const o = clsDate[k] || (clsDate[k] = { seen: 0, blank: 0 });
              o.seen++; if (!s.status) o.blank++;
            }
          }
        }
      }
      // 6) 私訓「學生」完整性：堂數唔可超上限、唔可有未來日期
      if (c.ptOnly && c.pt) {
        if (Number(c.pt.done) > Number(c.pt.cap)) add("PT", label, c.name, `私訓堂數 ${c.pt.done} 超上限 ${c.pt.cap}`);
        const futs = [...new Set([...(c.pt.curSessions || []), ...(c.pt.sessions || [])].filter(x => x.date > TODAY).map(x => x.date))];
        if (futs.length) add("PT", label, c.name, `私訓有未來日期：${futs.join(" ")}`);
      }
    }
    // nextPeriod 學費負數（#4）
    if (r.nextPeriod && r.retFees) {
      for (const k of Object.keys(r.retFees)) {
        const f = r.retFees[k];
        if (f && Number(f.net) < 0) add("FEE", label, name, `下期 ${k} 應繳負數 ${f.net}`);
      }
    }
  }
  return { tested: students.length, ok: okCount };
}

(async () => {
  console.log(`# QA 家長登入自動測試  （日期基準 ${TODAY}，香港時區；名冊來源 ${ROSTER_SRC}）\n`);
  const s4 = await sweep("恆常#4", EXEC4, R4, true);
  const s9 = await sweep("暑期#9", EXEC9, R9, false);

  console.log(`恆常#4：登入 ${s4.ok}/${s4.tested}`);
  console.log(`暑期#9：登入 ${s9.ok}/${s9.tested}\n`);

  // 整班漏點偵測。clsDate 提供「窗口內有課堂嘅 (班|日)」候選（由家長 session 列舉，
  // 只要每班有 1 個家長登入到就齊全）。有無點名嘅裁決分兩路：
  //   ① COACH_PASS 有 → 讀教練 grid（load）判斷該日 grid 有無任何非空記錄（authoritative，
  //      唔理邊個學生登入到；解決「有標記學生登入失敗 → 全班誤判漏點」，如 c4 2026-06-24）。
  //   ② 冇 COACH_PASS → 回退舊法（家長 session 全班空白）。
  let gridMark = null;
  if (process.env.COACH_PASS) {
    const g = await callLoad(EXEC4, process.env.COACH_PASS);
    if (g && g.ok && Array.isArray(g.attendance)) {
      gridMark = {};
      for (const a of g.attendance) gridMark[a.key] = (gridMark[a.key] || 0) + 1;   // 每 (班|日) 非空格數
    } else {
      console.error("⚠️ 教練 load 失敗，整班漏點回退用登入統計：" + ((g && g.err) || "?"));
    }
  }
  for (const k of Object.keys(clsDate)) {
    const o = clsDate[k];
    const [cid, date] = k.split("|");
    if (gridMark) {
      if (!(gridMark[k] > 0)) add("UNPOINTED", "恆常#4", cid, `${date} 全班未點名（grid 零記錄，可能漏點）`);
    } else if (o.seen > 0 && o.blank === o.seen) {
      add("UNPOINTED", "恆常#4", cid, `${date} 全班 ${o.seen} 人都未點名（可能漏咗點名）`);
    }
  }

  // 🔍 補堂完整性審計（兩系統 audit route）：owed 不變式全校掃。owed 錯計＝真 bug（OWED，紅）；
  //    未來請假顯示已補堂＝提前補堂（歸 MKMADEUP，核對用）。需 COACH_PASS。
  if (process.env.COACH_PASS) {
    for (const [sys, exec] of [["恆常#4", EXEC4], ["暑期#9", EXEC9]]) {
      const au = await callAudit(exec, process.env.COACH_PASS);
      if (!au || !au.ok) { add("ERR", sys, "audit", "審計 route 失敗：" + ((au && au.err) || "?")); continue; }
      for (const x of (au.anomalies || [])) {
        const who = x.name + " " + (x.cid || x.cls || "");
        for (const f of (x.flags || [])) {
          if (f.indexOf("owed=") >= 0 && f.indexOf("應") >= 0) add("OWED", sys, who, f);   // owed 錯計＝真 bug
          else if (f.indexOf("已補堂") >= 0) add("MKMADEUP", sys, who, f);                  // 提前補堂＝核對
          else add("ERR", sys, who, f);
        }
      }
    }
  }

  const bySev = {};
  for (const a of anomalies) (bySev[a.sev] = bySev[a.sev] || []).push(a);
  const order = ["LEAK", "OWED", "FUTURE", "FEE", "HISTGAP", "UNPOINTED", "MKMADEUP", "PT", "ERR"];
  const names = { LEAK: "🔴 資料洩漏", OWED: "🔴 待補數計錯（補堂閘可能亮/唔亮錯）", MKMADEUP: "🟡 未來請假顯示已補堂（核對提前補堂）", FUTURE: "🟠 未來堂誤標", FEE: "🟡 學費異常", HISTGAP: "🟣 歷史補完遺漏", UNPOINTED: "🔵 整班漏點名", PT: "🟤 私訓異常", ERR: "⚪ 登入/請求問題" };
  if (!anomalies.length) console.log("✅ 冇偵測到異常。");
  for (const sev of order) {
    if (!bySev[sev]) continue;
    console.log(`\n## ${names[sev]}（${bySev[sev].length}）`);
    for (const a of bySev[sev]) console.log(`  - [${a.sys}] ${a.who}：${a.msg}`);
  }
  console.log("\n---JSON---");
  console.log(JSON.stringify({
    date: TODAY,
    tested: { c4: s4, c9: s9 },
    counts: { LEAK: (bySev.LEAK || []).length, OWED: (bySev.OWED || []).length, MKMADEUP: (bySev.MKMADEUP || []).length, FUTURE: (bySev.FUTURE || []).length, FEE: (bySev.FEE || []).length, HISTGAP: (bySev.HISTGAP || []).length, UNPOINTED: (bySev.UNPOINTED || []).length, PT: (bySev.PT || []).length, ERR: (bySev.ERR || []).length },
    anomalies,
  }));
})();
