// 報名系統 QA harness：跑現有學員 + N 個新學員，查 identify/報價/確認/價格 bug。
// 用法：COACH_PASS=xxxx node tools/qa-enroll.mjs [新學員數量=100]
// COACH_PASS 只經環境變數傳，唔會寫入任何檔案／log。
import fs from 'fs';

const EXEC = "https://script.google.com/macros/s/AKfycbxNikFcB8n34Lyqc-KKC0oIRhn_-35HXmrAo5mEVhGNZ5g21AdUEMFSca408oo0xUw/exec";
const COACH = process.env.COACH_PASS || "";
const NEW_N = Number(process.argv[2] || 100);
if (!COACH) { console.error("需要 COACH_PASS 環境變數"); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(params, tries = 3) {
  const u = EXEC + "?" + new URLSearchParams({ ...params, nc: Math.random().toString(36).slice(2) });
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
      const t = await r.text();
      try { return JSON.parse(t); } catch { if (i === tries - 1) return { ok: false, err: "非JSON:" + t.slice(0, 60) }; }
    } catch (e) { if (i === tries - 1) return { ok: false, err: "" + e }; }
    await sleep(800);
  }
}

// 現有學員名：由後端 code CLASSES.students 抽（同 live 名冊一致）
function existingNames() {
  const code = fs.readFileSync(new URL('../../IS-BACKENDS/apps-script/unified-system/程式碼.js', import.meta.url), 'utf8');
  const names = new Set();
  for (const m of code.matchAll(/students:\s*\[([^\]]*)\]/g)) {
    for (const q of m[1].matchAll(/"([^"]+)"/g)) { const n = q[1].trim(); if (n && n !== '示範學員') names.add(n); }
  }
  return [...names];
}
// 100 個唔會撞現有名嘅假新生名
function fakeNewNames(n, existing) {
  const ex = new Set(existing);
  const out = [];
  let i = 0;
  while (out.length < n) { const nm = "測試新生" + (1000 + i++); if (!ex.has(nm)) out.push(nm); }
  return out;
}

const bugs = [];
function flag(kind, who, detail) { bugs.push({ kind, who, detail }); }

async function main() {
  const cfg = await api({ action: 'enrollConfig' });
  if (!cfg || !cfg.ok) { console.error("enrollConfig 失敗", cfg); process.exit(1); }
  const courses = cfg.courses || [];
  const priceById = {}; courses.forEach(c => priceById[c.id] = { price: c.price, sessions: c.sessions, sport: c.sport, cap: c.cap });
  const sampleCourse = (courses.find(c => c.id === 'rope-mon5') || courses[0]);
  console.log(`enrollConfig OK：${courses.length} 課程；範例班 ${sampleCourse.id} 新生價 $${sampleCourse.price}`);

  const existing = existingNames();
  console.log(`\n=== 現有學員 ${existing.length} 人 ===`);
  let ei = 0;
  for (const name of existing) {
    process.stderr.write(`\r現有 ${++ei}/${existing.length} ${name}   `);
    const id = await api({ action: 'enrollIdentify', name, coachPass: COACH });
    if (!id || !id.ok) { flag('identify失敗', name, id && id.err); continue; }
    // 舊生應有 oldPrices；逐課程檢查價格 sane
    if (id.isOld) {
      if (!id.oldPrices) { flag('舊生冇oldPrices', name, ''); }
      else for (const cid of Object.keys(id.oldPrices)) {
        const op = id.oldPrices[cid], np = (priceById[cid] || {}).price;
        if (!(op > 0)) flag('舊生價≤0', name, `${cid}=${op}`);
        else if (np != null && op > np) flag('舊生價貴過新生', name, `${cid} 舊${op}>新${np}`);
      }
    }
    // 報價 + 確認 dryRun（範例班）
    const q = await api({ action: 'enrollQuote', name, coachPass: COACH, courses: sampleCourse.id });
    if (!q || !q.ok) flag('報價失敗', name, q && q.err);
    else if (!(q.net >= 0)) flag('報價net異常', name, `net=${q.net}`);
    await sleep(120);
  }
  process.stderr.write('\r' + ' '.repeat(50) + '\r');

  console.log(`\n=== 新學員 ${NEW_N} 人 ===`);
  const fakes = fakeNewNames(NEW_N, existing);
  let ni = 0;
  for (const name of fakes) {
    process.stderr.write(`\r新生 ${++ni}/${fakes.length}   `);
    const id = await api({ action: 'enrollIdentify', name });
    if (!id || !id.ok) { flag('新生identify失敗', name, id && id.err); continue; }
    if (id.isOld) flag('假新生被當舊生', name, 'isOld=true');
    if (id.oldPrices) flag('新生見到舊生價', name, '有oldPrices');
    // 報價
    const q = await api({ action: 'enrollQuote', name, courses: sampleCourse.id });
    if (!q || !q.ok) { flag('新生報價失敗', name, q && q.err); continue; }
    const expected = sampleCourse.price;
    if (q.net !== expected) flag('新生價錯', name, `${sampleCourse.id} 報價net=${q.net} 應=${expected}`);
    // 確認 dryRun（含制服+器材，驗總額）
    const gear = JSON.stringify([{ sku: 'beadrope', color: '藍×白', qty: 1 }, { sku: 'canvasbag', color: '深藍', qty: 3 }]);
    // dryRun 唔寫入；用 coachPass 跳過「新生要先註冊」auth（唔會建假 profile），純驗價格/總額計算
    const cf = await api({ action: 'enrollConfirm', dryRun: '1', coachPass: COACH, name, courses: sampleCourse.sport, courseIds: sampleCourse.id, uniformOpt: '2', gearItems: gear, agree: '同意', notesAgreed: '1', photoConsent: '1', signEn: 'T', signId: 'A123' });
    if (!cf || !cf.ok) { flag('新生確認失敗', name, cf && cf.err); continue; }
    const r = cf.record || {};
    const expGrand = expected + 180 + 100 + 50; // 學費 + 制服$180 + 硬珠$100 + 帆布3個$50
    if (r.grand !== expGrand) flag('新生總額錯', name, `grand=${r.grand} 應=${expGrand}`);
    await sleep(120);
  }
  process.stderr.write('\r' + ' '.repeat(50) + '\r');

  console.log(`\n========== QA 結果 ==========`);
  console.log(`現有學員：${existing.length} 人｜新學員：${fakes.length} 人`);
  if (!bugs.length) { console.log('✅ 冇發現 bug／價格錯誤。'); return; }
  const byKind = {}; bugs.forEach(b => (byKind[b.kind] = byKind[b.kind] || []).push(b));
  console.log(`🛑 發現 ${bugs.length} 個問題：`);
  for (const k of Object.keys(byKind)) {
    console.log(`\n【${k}】×${byKind[k].length}`);
    byKind[k].slice(0, 8).forEach(b => console.log(`  · ${b.who}：${b.detail || ''}`));
    if (byKind[k].length > 8) console.log(`  …仲有 ${byKind[k].length - 8} 個`);
  }
}
main().catch(e => { console.error('QA 崩潰', e); process.exit(1); });
