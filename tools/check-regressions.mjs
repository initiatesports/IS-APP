#!/usr/bin/env node
// Regression 守衛：斷言「關鍵功能接線」仍然存在。
// 背景：老闆最高規矩——加新功能唔可以漏/整壞舊功能。過往曾因「首頁精簡」「私隱收窄」等
// 改動連帶移除咗舊功能入口，而檢測捉唔到。每次修一個 regression，就喺下面加一條斷言，
// 之後任何改動再移除呢個接線 → CI 直接 fail。
import { readFileSync } from 'fs';

function read(f){ return readFileSync(new URL('../'+f, import.meta.url), 'utf8'); }
// 粗略抽 function name(...){ ... } body（配對到對應嘅 }）
function fnBody(src, name){
  const i = src.indexOf('function '+name+'(');
  if(i<0) return null;
  let depth=0, started=false;
  for(let j=src.indexOf('{', i); j>=0 && j<src.length; j++){
    if(src[j]==='{'){ depth++; started=true; }
    else if(src[j]==='}'){ depth--; if(started && depth===0) return src.slice(i, j+1); }
  }
  return src.slice(i);
}

// {file, fn, must, why}：file 內 function fn() 嘅 body 必須包含 must 字串，否則＝regression
const CHECKS = [
  { file:'coach.html', fn:'renderHome', must:'renderNoticesAdmin(', why:'教練發佈/刪除通知面板入口（曾被「首頁精簡」移除，重要通知彈窗又啟用但冇補返入口）' },
  { file:'coach.html', fn:'renderHome', must:'renderVenueAdmin(',   why:'教練「上課地點」設定入口（曾一度消失）' },
  { file:'coach.html', fn:'loadRollSession', must:'showSummerMakeups(', why:'主點名表 openRoll 顯示暑期跳繩補堂生（曾只加喺另一 view 漏咗主點名）' },
  { file:'coach.html', fn:'renderHome', must:'renderReturnsPanel(', why:'教練回歸核實面板入口（家長交回歸付款後教練核實）' },
  { file:'is-leave-makeup.html', fn:'renderParent', must:'S.notices', why:'暑期家長端顯示通知（曾只彈 modal 通知、漏咗普通通知 inline 顯示）' },
  { file:'is-parent.html', fn:'renderParent', must:'S.notices', why:'恆常家長端顯示通知' },
];

let fail = 0;
for (const c of CHECKS){
  let src;
  try { src = read(c.file); } catch(e){ console.log(`✗ 讀唔到 ${c.file}`); fail=1; continue; }
  const body = fnBody(src, c.fn);
  if (!body){ console.log(`✗ ${c.file}: 搵唔到 function ${c.fn}() — ${c.why}`); fail=1; continue; }
  if (body.indexOf(c.must) < 0){
    console.log(`✗ REGRESSION: ${c.file} 嘅 ${c.fn}() 已經冇「${c.must}」— ${c.why}`);
    fail = 1;
  } else {
    console.log(`✓ ${c.file}: ${c.fn}() 仍接住 ${c.must}`);
  }
}
if (fail) { console.log('\n🛑 偵測到功能接線被移除（regression）。加新嘢唔可以漏舊嘢——請補返上面嘅接線。'); process.exit(1); }
console.log('\n✅ 所有關鍵功能接線仍在。');
