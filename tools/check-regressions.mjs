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
  { file:'coach.html', fn:'renderHome', must:'renderManualLeaveMakeup(', why:'手動請假／補堂面板入口（WhatsApp fallback:打名+日期+當日班別）' },
  { file:'coach.html', fn:'renderHome', must:'renderGenFeePanel(', why:'生成本期學費面板入口' },
  { file:'coach.html', fn:'gfRun', must:'genPeriod', why:'生成學費經 genPeriod(試算/正式)' },
  { file:'coach.html', fn:'mlSubmit', must:'coachAddMakeup', why:'手動補堂經 coachAddMakeup(教練代加)；請假經 markLeave' },
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
  // 恆常班特別時間安排（2026-08-09 加，同暑期一致）：教練面板入口 + 家長端顯示 + 通知去重
  { file:'coach.html', fn:'renderHome', must:'renderTimeAdjAdmin(', why:'恆常教練端「特別時間安排」面板入口' },
  { file:'coach.html', fn:'postTimeAdj', must:'setSessionTime', why:'恆常特別時間安排提交（setSessionTime）' },
  { file:'is-parent.html', fn:'nextClassInfo', must:'time:s.time', why:'恆常下一堂要帶該日特別時間' },
  { file:'is-parent.html', fn:'sessRow', must:'特別時間', why:'恆常 session 卡顯示該日特別時間' },
  // 特別時間要貫穿補堂揀時段/記錄/摘要（老闆 2026-08-09：所有東西都要對得上證據，兩系統）
  { file:'is-parent.html', fn:'openMakeup', must:'adj:taTime', why:'恆常補堂揀時段顯示該日特別時間' },
  { file:'is-leave-makeup.html', fn:'openMakeup', must:'taTime9', why:'暑期補堂揀時段顯示該日特別時間' },
  // 已約補堂顯示地點 + 申請記錄請假↔補堂配成同一行（老闆 2026-08-09）
  { file:'is-leave-makeup.html', fn:'classCard', must:'venueAt(m.date,m.to)', why:'暑期已約補堂顯示地點' },
  { file:'is-leave-makeup.html', fn:'historyHTML', must:'absDate===s.date', why:'暑期申請記錄請假↔補堂同一行(按absDate配對)' },
  // 9-10月恆常班報名系統（老闆 2026-08-11 全面重製）——關鍵接線唔可以漏
  { file:'is-enroll.html', fn:'doIdentify', must:'enrollIdentify', why:'入場靠姓名自動分辨新/舊生（唔再用兩個按鈕）' },
  { file:'is-enroll.html', fn:'doIdentify', must:'renderProfileScreen', why:'認人後→先填/核對資料（老闆調序:先資料後收費）' },
  { file:'is-enroll.html', fn:'renderPriceTable', must:'renderCourses', why:'價格表「開始報名」→揀課（先睇齊價再揀）' },
  { file:'is-enroll.html', fn:'boot', must:'renderHome', why:'首頁課程介紹做入口（睇完先報名）' },
  { file:'is-enroll.html', fn:'renderHome', must:'openCourseDetail', why:'首頁課程卡可開詳細介紹' },
  { file:'is-enroll.html', fn:'boot', must:'loadOfficialCourses', why:'開頁自動同步官網課程介紹(官網一改報名頁跟住改)' },
  { file:'is-enroll.html', fn:'loadOfficialCourses', must:'extractLiteral', why:'括號平衡掃描可靠抽官網課程內容(唔用脆弱regex)' },
  { file:'is-enroll.html', fn:'saveProfileGo', must:'renderUniform', why:'資料填好→制服頁（老闆:順序喺資料後，新生必買）' },
  { file:'is-enroll.html', fn:'renderUniform', must:'renderWeather', why:'制服揀好→惡劣天氣安排（流程內頁；順序:資料→制服→天氣→收費）' },
  { file:'is-enroll.html', fn:'renderUniform', must:'UNIFORM_OPTS', why:'制服選項(已有/制服$180/制服+速度器$240/舊生:只買上衣$100/只買短褲$100)+尺碼' },
  { file:'is-enroll.html', fn:'renderFee', must:'uniformCost', why:'費用頁把制服費加入總計應付' },
  { file:'is-enroll.html', fn:'renderPay', must:'uniformCost', why:'付款頁應付金額＝學費＋制服' },
  { file:'is-enroll.html', fn:'submitEnroll', must:'uniformOpt', why:'提交把制服選項/尺碼/費用傳畀後端記錄' },
  { file:'is-enroll.html', fn:'renderFee', must:'renderNotes', why:'費用後→課程注意事項頁(逐項同意，安全所需)' },
  { file:'is-enroll.html', fn:'renderNotes', must:'nt_all', why:'共通+逐課程注意事項純顯示＋一個總確認（已閱讀並明白）先可繼續' },
  { file:'is-enroll.html', fn:'renderTerms', must:'setupSigPad', why:'聲明頁加家長手寫簽名板(合約PDF嵌入)' },
  { file:'is-enroll.html', fn:'renderTerms', must:'sigDataUrl', why:'未簽名唔可以去付款(手寫簽名必填)' },
  { file:'is-enroll.html', fn:'submitEnroll', must:'signImg', why:'提交把家長手寫簽名+注意事項同意傳後端' },
  { file:'is-enroll.html', fn:'renderProfile', must:'pf_m_', why:'健康狀況做多選checkbox(跟舊form 11項),唔再淨係text' },
  { file:'is-enroll.html', fn:'saveProfileGo', must:'pfMultiVal', why:'健康多選收集(checkbox+其他)入 profile' },
  { file:'is-enroll.html', fn:'renderWeather', must:'renderMakeupInfo', why:'惡劣天氣頁→請假補堂介紹頁（流程內）' },
  { file:'is-enroll.html', fn:'renderMakeupInfo', must:'renderPriceTable', why:'請假補堂頁（流程內）→收費一覽' },
  { file:'is-enroll.html', fn:'renderHome', must:'renderAdultForm', why:'首頁「成人課程報名」獨立入口' },
  { file:'is-enroll.html', fn:'renderHome', must:'renderMakeupInfo', why:'首頁「請假／補堂」自助入口' },
  { file:'is-enroll.html', fn:'renderMakeupInfo', must:'MAKEUP_URL', why:'請假補堂介紹頁→連去家長請假補堂系統(MAKEUP_URL=is-parent.html)' },
  { file:'is-enroll.html', fn:'submitAdult', must:'adultEnroll', why:'成人報名提交→後端 adultEnroll route' },
  { file:'is-enroll.html', fn:'openCourseDetail', must:'COACH_SECTION', why:'課程詳情加教練資歷(NKT×SCS只私訓)' },
  { file:'is-enroll.html', fn:'renderUniform', must:'uchart', why:'制服頁顯示完整尺碼表(上身/下身,照原圖數據)+球衣圖' },
  { file:'is-enroll.html', fn:'renderProfileScreen', must:'renderProfile', why:'新舊生都用全表單(舊生預填免重打,健康問卷必填)' },
  { file:'is-enroll.html', fn:'renderProfilePreview', must:'editField', why:'舊生資料逐項「修改」（少填）' },
  { file:'is-enroll.html', fn:'submitEnroll', must:'clientToken', why:'防重複提交：逾時重撳用同一 token（後端 dedupe）' },
  { file:'is-enroll.html', fn:'renderLogin', must:'loadDraft', why:'草稿續報：中途走可繼續上次揀課' },
  { file:'is-enroll.html', fn:'renderDone', must:'reportAnother', why:'多子女：再報一位免重新輸入電話' },
  { file:'is-enroll.html', fn:'renderPay', must:'copyTxt', why:'付款頁 FPS/金額一撳複製' },
  { file:'coach.html', fn:'renderHome', must:'is-enroll-admin.html', why:'教練首頁「報名管理」入口（否則老闆要死記 URL）' },
  { file:'is-enroll.html', fn:'renderCourses', must:'isOld', why:'課程卡只顯示登入者身份嘅價（新生睇唔到價差）' },
  { file:'is-enroll.html', fn:'renderFee', must:'學費（全期', why:'新生單科無折淨顯示一行學費、唔用「原價」（免察覺價差）' },
  { file:'is-enroll.html', fn:'renderPay', must:'請勿現在過數', why:'未開放(預覽)時隱藏FPS/截圖+明確勿過數（防提早付款）' },
  { file:'is-enroll.html', fn:'saveProfileGo', must:'slice(-4)', why:'新生電話最後4位要同登入一致（令enrollAuth認得,防報唔到名）' },
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
