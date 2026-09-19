#!/usr/bin/env node
// 前端瀏覽器 runtime 測試：用 puppeteer-core + 系統 Chrome headless 逐頁開家長/教練頁，
// 捉「未捕捉 JS 例外(pageerror)」、明顯 console 錯誤、同確認頁面有 render（防白屏/按鈕死）。
// 用法：node tools/frontend-smoke.mjs   （需先 npm install puppeteer-core；用系統 Chrome）
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://initiatesports.github.io/IS-APP/';
// 審計 2026-08-24：補回最大最常改嘅頁（教練主頁/報名/運動班/成長中心），佢哋白屏或 JS 例外原本測唔到。
const PAGES = ['index.html','is-parent.html','is-coach.html','is-leave-makeup.html','is-pay.html','is-hub.html','is-guide.html',
  'coach.html','is-enroll.html','is-pt-enroll.html','coach-sports.html','is-performance.html','is-attendance-app.html','is-enroll-admin.html'];   // parent-sports.html 已退役(轉址 is-parent，2026-09-01)
// 明顯無關嘅 console 噪音（唔當錯）：favicon、網絡層、未登入時嘅預期 fetch 失敗
const BENIGN = /favicon|ERR_|net::|Failed to load resource|the server responded with a status/i;
const SLOW_MS = Number(process.env.SMOKE_SLOW_MS || 20000);   // DOM ready 超過呢個＝家長真係等到唔耐煩，先當問題

const problems = [];        // 真前端問題：JS 例外／console 錯誤／白屏
const netProblems = [];     // 網絡/CDN：載入超時或極慢（唔當 code bug，但要見到）
let browser;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
} catch (e) {
  console.log('# 前端瀏覽器 runtime 測試\n  - 無法啟動 Chrome：' + e.message + '\n（需系統有 Chrome；設 CHROME_PATH 指向執行檔）');
  process.exit(2);
}
for (const pg of PAGES) {
  let ok = false, lastErr = '';
  for (let attempt = 1; attempt <= 2 && !ok; attempt++) {   // 導航失敗重試一次：分開「CDN/網絡慢」同「前端 code 壞」
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('JS例外: ' + String(e.message || e).slice(0, 140)));
  page.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!BENIGN.test(t)) errs.push('console錯誤: ' + t.slice(0, 140)); } });
  try {
    /* 2026-09-19：原本 waitUntil:'networkidle2' + 30s 會把**健康**嘅頁報成「載入失敗」——
       官網 index.html 4.4s 已 DOM ready、render 2065 字 26 掣、零 JS 例外，但 lazy 課程相
       (initiatesportshk.com/img/courses/*.jpg 各 8-9s) + #11 CMS fetch 令 network 45s 先靜。
       後端一慢(keep-warm 尖峰)仲會連累 5 版一齊「失敗」＝日日假警報，遮住真故障
       （見 [[monitor-retry-masks-real-failures]]）。改成：DOM ready 為準 → 盡量等 network 靜
       (等唔到唔當錯) → 安頓 → 驗 render/JS 例外。真嘅慢(DOM ready > SLOW_MS)另外報「載入慢」。 */
    const t0 = Date.now();
    await page.goto(BASE + pg, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const dcl = Date.now() - t0;
    try { await page.waitForNetworkIdle({ idleTime: 500, timeout: 12000 }); } catch { /* 圖/CMS 慢唔當錯 */ }
    await new Promise(r => setTimeout(r, 1500));   // 畀 JS 安頓
    const info = await page.evaluate(() => ({
      len: document.body ? document.body.innerText.trim().length : 0,
      btns: document.querySelectorAll('button').length,
      inputs: document.querySelectorAll('input').length,
    }));
    if (info.len < 30) problems.push(`${pg}: 頁面似乎空白（render ${info.len} 字、${info.btns} 掣、${info.inputs} 輸入框）`);
    if (dcl > SLOW_MS) netProblems.push(`${pg}: 載入慢（DOM ready ${Math.round(dcl / 1000)}s > ${SLOW_MS / 1000}s，家長會覺得卡）`);
    errs.forEach(e => problems.push(`${pg}: ${e}`));
    ok = true;
  } catch (e) {
    lastErr = String(e.message || e).slice(0, 120);
  }
  await page.close();
  }
  /* 兩次都導航唔到 ≠ 前端 code 壞（多數係 GitHub Pages 邊緣節點／本機網絡）。分開 netProblems 報，
     唔好同 JS 例外／白屏混埋一齊，否則真 bug 會被日日嘅網絡噪音蓋住。 */
  if (!ok) netProblems.push(`${pg}: 載入超時（網絡/CDN，非 JS 錯誤）${lastErr}`);
}
await browser.close();

console.log('# 前端瀏覽器 runtime 測試（' + PAGES.length + ' 頁）');
if (!problems.length) console.log('✅ 全部頁面正常 render、無 JS 例外');
else problems.forEach(p => console.log('  - ' + p));
if (netProblems.length) { console.log('— 以下屬網絡/CDN（唔係前端 code，重試兩次都載入唔到或好慢）：'); netProblems.forEach(p => console.log('  ~ ' + p)); }
console.log('\n---JSON---');
console.log(JSON.stringify({ pages: PAGES.length, problems, netProblems }));
process.exit(problems.length ? 1 : 0);   // 只有真前端問題先 exit 1；網絡噪音唔當失敗
