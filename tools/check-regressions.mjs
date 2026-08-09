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
  // 補堂「開課前 6 小時不可取消 + 少於6h申請要提示」彈窗（老闆 2026-08-05 定；所有彈窗要按 OK）
  { file:'is-parent.html', fn:'submitMakeup', must:'lateBookWarn', why:'恆常：少於開課前6h申請補堂彈窗提示（一經提交不可取消、否則照扣）' },
  { file:'is-parent.html', fn:'cancelOneMakeup', must:'lateCancelBlock', why:'恆常：距開課<6h單筆取消補堂被攔+彈窗' },
  { file:'is-parent.html', fn:'submitCancelMakeup', must:'lateCancelBlock', why:'恆常：距開課<6h批量取消補堂被攔+彈窗' },
  { file:'is-leave-makeup.html', fn:'submitMakeup', must:'mkHrsToStart9', why:'暑期：少於開課前6h申請補堂彈窗提示' },
  { file:'is-leave-makeup.html', fn:'submitCancelMakeup', must:'mkHrsToStart9', why:'暑期：距開課<6h取消補堂被攔+彈窗' },
  // 暑期病假完整跟恆常（老闆 2026-08-05）：當日病假可上載醫生紙，48h逾期自動改缺席
  { file:'is-leave-makeup.html', fn:'submitLeave', must:'uploadMedNote', why:'暑期當日病假醫生紙上載（跟恆常，逾48h未交自動改缺席）' },
  { file:'is-leave-makeup.html', fn:'onMedFile', must:'FileReader', why:'暑期病假醫生紙選檔讀取（onMedFile）' },
  // 特別時間安排：家長端要反映該日 override（下一堂）＋通知去重（老闆 2026-08-09 撞到重複通知＋下一堂冇跟改）
  { file:'is-leave-makeup.html', fn:'nextClassInfo', must:'s.time||c.time', why:'下一堂要顯示該日特別時間 override（唔係淨正規 c.time）' },
  { file:'is-leave-makeup.html', fn:'renderParent', must:'_seen', why:'最新通知同文案去重，防重複轟炸' },
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
