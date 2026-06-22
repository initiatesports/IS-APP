#!/usr/bin/env node
/**
 * QA harness：以「真實家長身分」登入全部恆常班(#4)＋暑期班(#9)，
 * 自動偵測：未來堂誤標出席、跨家庭資料洩漏、登入失敗、學費負數、班別資料異常。
 * 全部用 login（唯讀），唔會寫入任何真實資料。
 *
 * 用法：node tools/qa-parents.mjs [YYYY-MM-DD]   （日期預設今日，香港時區）
 * 輸出：人類可讀報告 + 最後一行 JSON 摘要（畀排程解析）。
 */

const EXEC4 = "https://script.google.com/macros/s/AKfycbxeQizogWDoNl6PhAp_sE3_HfFc8MAtYEd-66k7zF3rRyhxPOM7qmnxYx6EzFUkiHLb/exec";
const EXEC9 = "https://script.google.com/macros/s/AKfycby9Ln3kZUubqRIuGdCF5cJ5tk4KuPITMQDuOFFuee1OwrId5gUa_sP_W5CuHga9y6i8/exec";

const TODAY = process.argv[2] || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Hong_Kong" });

const pad4 = x => ("0000" + String(x).replace(/\D/g, "")).slice(-4);

// ── 恆常班 #4 名冊（name,last4）+ 自訂密碼override ──
const R4 = [
  ["余悅","7252"],["孔善盈","0792"],["蔡芷彤","8852"],["羅梓晉","2521"],["羅君信","2224"],["羅君浩","2224"],["陳大文","1234"],["蘇穎悠","5433"],
  ["翟悅廷","2201"],["郭栩澄","1199"],["葉宇浩","7599"],["梁德澤","6607"],["許思溢","9159"],["梁正軒","9339"],["梁正宇","9339"],
  ["鄧可澄","0386"],["鄧幗恩","0886"],["胡苡晨","9126"],["胡汐森","9126"],["文柏升","4410"],["陳曉瑩","9322"],["何梓程","9003"],["陳思允","0266"],["梁心朗","8883"],
  ["陳卓楠","9870"],["曾愛斯","7058"],["王一言","0535"],["王一心","0535"],["古詩詠","9158"],["古卓謙","9158"],["梁德瑜","6607"],["陳柏睎","0713"],
  ["吳瑋軒","6918"],["黎柏言","2698"],["郭可昕","9860"],["黃玥晴","5352"],["黃朗程","9749"],["姚心穎","6606"],["羅靖誼","9650"],["黎柏希","2698"],["陳焯棋","9322"],
  ["張爾淳","1272"],["張雅堯","1272"],["黃梓昕","0397"],["王尉鏇","6801"],["王斯顏","6801"],["呂洛希","4917"],["馬仲然","8368"],["鄧朗森","7317"],["陳書雅","9721"],
  ["劉家頤","5352"],["鄭宇喬","6455"],["鍾皓惟","9704"],["周莉晶","5181"],["李灝宏","5190"],["何芯蕾","2984"],
];
const PIN4 = { "1234": "2580", "0792": "0619" };   // 自訂密碼override（last4→pin）

// ── 暑期班 #9 名冊（name,last4）──
const R9 = [
  ["蔡思言","7716"],["梁心朗","8883"],["吳瑋軒","6735"],["黎柏希","2698"],["黎柏言","2698"],["葉天麒","5078"],
  ["王韻喬","9062"],["易晞渝","570"],["蔡芷彤","8852"],["羅芷晴","1331"],["潘洛詩","6171"],["蔣佩琪","2581"],["何諾軒","9613"],
  ["張爾淳","1272"],["張雅堯","1272"],["劉鎮碩","5352"],["劉家頤","5352"],["方鎮浩","162"],["鄧可澄","386"],["陳大文","1234"],
  ["甘卓熹","6736"],["羅天佑","9275"],["曾衍霖","35"],["黃梓昕","397"],["方鎂恩","162"],
  ["曾愛斯","7058"],["陳卓楠","9870"],["王尉鏇","6801"],["王斯顏","6801"],["古詩詠","9158"],
  ["黃樂悠","8345"],["劉家頤","5352"],["盧文懿","5122"],["呂洛希","4917"],["周莉晶","5181"],
  ["胡汐森","9126"],["胡苡晨","9126"],["古卓謙","9158"],["陳柏謙","3488"],
  ["曾喬烽","7058"],["葉芯怡","6759"],["葉芯淇","6759"],["許思溢","9159"],["徐翊之","3705"],
  ["黃信晴","1750"],["陳卓琛","9870"],["劉初靜","1040"],["張煦翹","9011"],["陳皓軒","2359"],["汪柏叡","8643"],
  ["鍾皓惟","9704"],["姚心穎","6606"],["黃朗程","9749"],["黃翊雅","5791"],["陳靖朗","623"],
];

// 未來堂只有呢啲狀態先當「誤標」（出席類）；請假/停課/豁免/轉堂屬合法預先安排。
const FUTURE_BAD = { "出席": 1, "補堂": 1, "加操": 1 };

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

function uniqByName(rows) {
  const seen = new Set(), out = [];
  for (const [n, l] of rows) { if (!seen.has(n)) { seen.add(n); out.push([n, l]); } }
  return out;
}

const anomalies = [];
const add = (sev, sys, who, msg) => anomalies.push({ sev, sys, who, msg });

async function sweep(label, exec, rows, withPin) {
  const students = uniqByName(rows);
  let okCount = 0;
  for (const [name, last4] of students) {
    const cred = (withPin && PIN4[pad4(last4)]) ? PIN4[pad4(last4)] : pad4(last4);
    const r = await callLogin(exec, name, cred);
    if (!r || !r.ok) { add("ERR", label, name, "登入失敗：" + ((r && r.err) || "?")); continue; }
    okCount++;
    const surn = name.trim().charAt(0);

    // 1) 資料洩漏：children 含唔同姓（非真兄弟姊妹）
    const kids = (r.children || []).map(c => c.name);
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
  console.log(`# QA 家長登入自動測試  （日期基準 ${TODAY}，香港時區）\n`);
  const s4 = await sweep("恆常#4", EXEC4, R4, true);
  const s9 = await sweep("暑期#9", EXEC9, R9, false);

  console.log(`恆常#4：登入 ${s4.ok}/${s4.tested}`);
  console.log(`暑期#9：登入 ${s9.ok}/${s9.tested}\n`);

  const bySev = {};
  for (const a of anomalies) (bySev[a.sev] = bySev[a.sev] || []).push(a);
  const order = ["LEAK", "FUTURE", "FEE", "ERR"];
  const names = { LEAK: "🔴 資料洩漏", FUTURE: "🟠 未來堂誤標", FEE: "🟡 學費異常", ERR: "⚪ 登入/請求問題" };
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
    counts: { LEAK: (bySev.LEAK || []).length, FUTURE: (bySev.FUTURE || []).length, FEE: (bySev.FEE || []).length, ERR: (bySev.ERR || []).length },
    anomalies,
  }));
})();
