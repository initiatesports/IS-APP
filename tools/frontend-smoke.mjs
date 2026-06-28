#!/usr/bin/env node
// 前端瀏覽器 runtime 測試：用 puppeteer-core + 系統 Chrome headless 逐頁開家長/教練頁，
// 捉「未捕捉 JS 例外(pageerror)」、明顯 console 錯誤、同確認頁面有 render（防白屏/按鈕死）。
// 用法：node tools/frontend-smoke.mjs   （需先 npm install puppeteer-core；用系統 Chrome）
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://initiatesports.github.io/IS-APP/';
const PAGES = ['is-home.html','is-parent.html','is-coach.html','is-leave-makeup.html','is-pay.html','is-hub.html','is-guide.html'];
// 明顯無關嘅 console 噪音（唔當錯）：favicon、網絡層、未登入時嘅預期 fetch 失敗
const BENIGN = /favicon|ERR_|net::|Failed to load resource|the server responded with a status/i;

const problems = [];
let browser;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
} catch (e) {
  console.log('# 前端瀏覽器 runtime 測試\n  - 無法啟動 Chrome：' + e.message + '\n（需系統有 Chrome；設 CHROME_PATH 指向執行檔）');
  process.exit(2);
}
for (const pg of PAGES) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('JS例外: ' + String(e.message || e).slice(0, 140)));
  page.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!BENIGN.test(t)) errs.push('console錯誤: ' + t.slice(0, 140)); } });
  try {
    await page.goto(BASE + pg, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));   // 畀 JS 安頓
    const info = await page.evaluate(() => ({
      len: document.body ? document.body.innerText.trim().length : 0,
      btns: document.querySelectorAll('button').length,
      inputs: document.querySelectorAll('input').length,
    }));
    if (info.len < 30) problems.push(`${pg}: 頁面似乎空白（render ${info.len} 字、${info.btns} 掣、${info.inputs} 輸入框）`);
    errs.forEach(e => problems.push(`${pg}: ${e}`));
  } catch (e) {
    problems.push(`${pg}: 載入失敗 ${String(e.message || e).slice(0, 120)}`);
  }
  await page.close();
}
await browser.close();

console.log('# 前端瀏覽器 runtime 測試（' + PAGES.length + ' 頁）');
if (!problems.length) console.log('✅ 全部頁面正常 render、無 JS 例外');
else problems.forEach(p => console.log('  - ' + p));
console.log('\n---JSON---');
console.log(JSON.stringify({ pages: PAGES.length, problems }));
process.exit(problems.length ? 1 : 0);
