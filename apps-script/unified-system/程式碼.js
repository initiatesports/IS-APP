/*  INITIATE SPORTS · 統一後端 (Google Apps Script)  —  is-unified-v1
 *  ─────────────────────────────────────────────────────────────────
 *  把「請假補堂系統（方法B：格仔即資料來源）」融入你嘅 IS 出席 App，
 *  一個 /exec、一個 Google Sheet，三平台（家長頁 / 教練頁 / Sheet）即時同步。
 *
 *  ★ 班別／學生用「你 App 嘅真實資料」(c1–c7, 57 名學生)，唔係 A 嘅暑期示範。
 *  ★ 格仔由 CLASSES 自動生成（每班一個分頁，日期欄 = 學期窗內該班星期）。
 *
 *  安裝：貼入 Code.gs → 改 CONFIG → 執行 setup()（非破壞性，會先備份）
 *        → 部署為網頁應用程式（執行者：自己；存取：任何人）。
 *        改完 Code.gs 記得「管理部署作業 → 新版本」，網址不變。
 *  ⚠️ setup() 安全（保留資料）；只有 rebuildAll()（不入選單）會清空重建。
 *
 *  資料完整性守則（第 7 節，務必遵守）：
 *   1. 補堂/備份日期一律文字格式 @，每個讀寫路徑用 toIso_() 正規化。
 *   2. 判斷補堂是否寫格 → 用「該日是否該班正規上課日」，唔靠狀態欄。
 *   3. setup() 非破壞；每日自動備份 + 還原揀「最完整」快照。
 *   4. markCell 統一寫格（正規行或補堂行皆同寫法）。
 */

/* ═══════════ 設定 ═══════════ */
const CONFIG = {
  COACH_EMAIL: "initiatesports6331@gmail.com",  // 收通知 Gmail
  COACH_PASS:  PropertiesService.getScriptProperties().getProperty('COACH_PASS') || Utilities.getUuid(),  // 教練密碼:存 Script Properties(key=COACH_PASS),未設定則退回隨機值(fail-closed)
  WHATSAPP:    "85263317403",                   // 家長確認 WhatsApp
  TERM_START:  "2026-02-23",   // 學期窗（週一）；涵蓋現有 3 月資料
  TERM_END:    "2026-08-31",   // 學期窗結束（含暑期）；08-31 確保星期一班最後一堂(8/31)計入 7-8月（原 08-29 會截走 → c1/c2 少計一堂）
  MAKEUP_MONTHS: 2,            // 補堂限期 = 缺席日 + N 個月（B 規則）
  REMIND_HOUR: 20,            // 每晚幾點檢查「未完成點名」
  FEE_1: 1040,                // 每週 1 節 / 期（$130×8）
  FEE_2: 1760,                // 每週 2 節 / 期（$110×16）
  PAY_NUMBER: "6709 3390",   // FPS / PayMe 收款電話
};
const VERSION = "is-unified-v2";

/* ═══════════ 逐期特殊收費設定（按淨堂計；含順延豁免、個別豁免、額外收費）═══════════
 * 單堂價：一週一堂 $130／節；一週兩堂 $110／節。
 * 7-8月：5-6月教練取消課程 → 順延豁免（逐班原取消日期，供家長端顯示）。
 *   星期一(c1,c2) 取消 6/1 → 豁免 1 節；星期三(c3,c4) 取消 5/27、6/3 → 2 節；
 *   星期五(c5) 取消 5/29、6/5 → 2 節；星期六(c6,c7) 取消 5/30、6/6 → 2 節。
 * 個別：梁正軒 6/12（星期五 c5）場地問題 → 額外豁免 1 節。
 * 額外收費：鄧幗恩 5/23 加操 $130 + 膠繩替芯 $30。 */
var PERIOD_RATE_1 = 130, PERIOD_RATE_2 = 110;   // 單堂價：一週一堂 / 一週兩堂
var PERIOD_EXEMPT = {
  "2026 7-8月": {
    byClass: { c1:["2026-06-01"], c2:["2026-06-01"],
               c3:["2026-05-27","2026-06-03"], c4:["2026-05-27","2026-06-03"],
               c5:["2026-05-29","2026-06-05"],
               c6:["2026-05-30","2026-06-06"], c7:["2026-05-09","2026-05-30","2026-06-06"] },
    byStudent: { "梁正軒":[{date:"2026-06-12", cid:"c5", reason:"場地問題"}],
                 "黎柏言":[{date:"2026-06-12", cid:"c5", reason:"場地問題"}],
                 "黎柏希":[{date:"2026-06-12", cid:"c5", reason:"場地問題"}],
                 // 黃玥晴 c5→c1 轉班：c1 byClass 只順延 1 堂(06-01)，但佢喺 c5 被取消嗰 2 堂(05-29/06-05)
                 // 跟住佢過 c1 → 多補 1 堂順延，合共扣 2 堂 → 9−2=7×$130=$910
                 "黃玥晴":[{date:"2026-06-05", cid:"c1", reason:"原 c5 班取消順延（轉班保留）"}],
                 // 李灝宏 c7→c6 轉班：c6 byClass 順延 2 堂(05-30/06-06)，但佢喺 c7 被取消 3 堂(05-09/05-30/06-06)
                 // 跟住佢過 c6 → 多補 1 堂(05-09)順延，合共扣 3 堂 → 9−3=6×$130=$780
                 "李灝宏":[{date:"2026-05-09", cid:"c6", reason:"原 c7 班取消順延（轉班保留）"}] }
  }
};
var PERIOD_EXTRA = {
  "2026 7-8月": { "鄧幗恩":[{amt:130, note:"5/23 加操"}, {amt:30, note:"膠繩替芯"}] }
};
// 本期新加入學生：唔享上期取消課程順延豁免（收全費）。例：梁心朗 2026-07 回歸 c4。
var PERIOD_NO_CARRY = { "2026 7-8月": ["梁心朗"] };
// 強制豁免（$0，本期不收費）：暫停／退出學生喺指定期。例：梁心朗 5-6月暫停。
var PERIOD_VOID = { "2026 5-6月": ["梁心朗"],
  // 何梓程(c3)、馬仲然(c6) 7-8月暫停，不報新一期 → 7-8月學費 $0／豁免（保留喺名單，
  // 等佢哋 7 月頭返嚟上返 5-6月被取消順延嗰幾堂；不退款，用堂抵）。
  "2026 7-8月": ["何梓程","馬仲然"] };

/* 特別安排固定學費：跨班／固定堂數，唔跟標準班別自動計（自動計會計錯）。
   設固定 due（應繳），記 paid（已繳，由其他來源轉抵）；genPeriodNet_ 會直接寫呢個數、
   唔行標準自動計，亦會保留家長已上傳嘅付款進度／截圖。weekly 只作顯示。 */
var CUSTOM_FEE = {
  "2026 7-8月": {
    // 周莉晶：暑期「運動體能」班取消 → 轉恆常 c7（7/4、7/11）+ c3（7/15、7/22、7/29、8/12、8/19、8/26）共 8 堂。
    // 8 堂 × $130 = $1040；已繳 $909（由暑期運動體能轉抵）→ 待繳 $131。
    "周莉晶": { weekly:1, due:1040, paid:909,
      note:"暑期運動體能取消→轉恆常：c7(7/4、7/11)+c3(7/15、7/22、7/29、8/12、8/19、8/26) 共8堂",
      adjNote:"已繳 $909 由暑期運動體能轉抵，待繳 $131" }
  }
};

/* ═══════════ 真實班別資料（你 App 真實學生）═══════════ */
/* cN: { dayZh, wd(1=一..6=六), time, students[] }
 * 已併入：顧舒然(c5)、潘洛詩(c7)（出席記錄已有，補回名單）。
 */
const CLASSES = {
  c1:{ dayZh:"星期一", wd:1, time:"5–6pm",  students:["余悅","孔善盈","蔡芷彤","羅梓晉","羅君信","羅君浩","陳大文","蘇穎悠","黃玥晴"] },
  c2:{ dayZh:"星期一", wd:1, time:"6–7pm",  students:["翟悅廷","郭栩澄","葉宇浩","梁德澤","許思溢","梁正軒","梁正宇"] },
  c3:{ dayZh:"星期三", wd:3, time:"5–6pm",  students:["鄧可澄","鄧幗恩","胡苡晨","胡汐森","文柏升","陳曉瑩","何梓程","陳思允"] },
  c4:{ dayZh:"星期三", wd:3, time:"6–7pm",  students:["陳卓楠","曾愛斯","王一言","王一心","古詩詠","古卓謙","梁德瑜","陳柏睎","梁心朗"] },
  c5:{ dayZh:"星期五", wd:5, time:"6–7pm",  students:["吳瑋軒","黎柏言","陳曉瑩","梁正宇","郭可昕","黃朗程","姚心穎","羅靖誼","黎柏希","陳焯棋","梁正軒"] },
  c6:{ dayZh:"星期六", wd:6, time:"11am–12", students:["張爾淳","張雅堯","黃梓昕","王尉鏇","王斯顏","呂洛希","馬仲然","鄧朗森","陳書雅","李灝宏"] },
  c7:{ dayZh:"星期六", wd:6, time:"3–4pm",  students:["劉家頤","鄭宇喬","鍾皓惟","周莉晶","何芯蕾"] },
  // 已退出（移出名冊，2026-06）：c4 陳信澄、c4 陳澔泓、c7 潘洛詩、c5 顧舒然。
  // 資料（成績/章別/體格/照片/出席）一律以姓名保留喺各表，回歸時把名字放返對應 class students 即可續用。
};
const CLASS_IDS = Object.keys(CLASSES);

/* ═══════════ 私人訓練（PT）═══════════
 * 與恆常班完全分開：各自 1對1、獨立 10 堂一個週期，無請假/補堂，只記「邊日上咗堂」。
 * 加／減私訓學員：在 PT_STUDENTS 陣列加減項目即可，毋須改其他地方。
 *   name   = 私訓記錄／顯示用名（出席表內的學員名，可以係家長名）
 *   family = 用邊個恆常班名冊帳號睇得到（家長登入名；同一家可共用）
 * 例：張雅堯個 slot 實際係佢父母 Keith & Elaine 上堂，但用「張雅堯」家庭帳號睇。
 */
const PT_STUDENTS = [
  { name:"鄧可澄",        family:"鄧可澄" },
  { name:"Keith & Elaine", family:"張雅堯" },
  { name:"陳大文",        family:"陳大文", demo:true }   // 示範帳號（電話後4位 1234）
];
const PT_CYCLE = 10;   // 每期堂數；夠數自動開新一期

/* ═══════════ 只保留登入、不入任何班別（暫停／可能回歸的學員）═══════════
 * 名單內的學生會出現喺 Roster（可用手機後4位登入），但唔屬於任何 c1–c7，
 * 所以唔會出現喺教練點名格、唔會計繳費／出席。真正回歸時，將佢由此處移走、
 * 加返入對應 CLASSES 班別即可。改完要執行一次 ensureRoster_/setup 先生效。
 * 例：梁心朗 2026-06 暫停，7月可能回來 —— 先保留帳號可登入。
 */
const LOGIN_ONLY = ["陳信澄","陳澔泓","潘洛詩","顧舒然"];  // 退出可回歸：可登入＋排行榜出名＋見回歸面板（梁心朗 2026-07 回歸 c4，已轉正式學生）
var RETURNABLE = LOGIN_ONLY;              // returner 名單（同 LOGIN_ONLY）
var RET_FEE_1 = 1200, RET_FEE_2 = 1800;   // 回歸費：1週1堂 $1200 / 1週2堂 $1800（$150/節）

/* ═══════════ 家長手機後4位（報名表抽出；兄弟姊妹共用 → 一家睇晒）═══════════ */
const PHONE = {
  "陳大文":"1234",
  "余悅":"7252",
  "孔善盈":"0792",
  "何芯蕾":"2984",
  "蔡芷彤":"8852",
  "羅梓晉":"2521",
  "羅君信":"2224",
  "羅君浩":"2224",
  "翟悅廷":"2201",
  "郭栩澄":"1199",
  "陳柏睎":"0713",
  "葉宇浩":"7599",
  "梁德瑜":"6607",
  "梁德澤":"6607",
  "許思溢":"9159",
  "鄧可澄":"0386",
  "鄧幗恩":"0886",
  "胡苡晨":"9126",
  "胡汐森":"9126",
  "文柏升":"4410",
  "陳曉瑩":"9322",
  "何梓程":"9003",
  "梁正軒":"9339",
  "陳思允":"0266",
  "陳卓楠":"9870",
  "曾愛斯":"7058",
  "王一言":"0535",
  "王一心":"0535",
  "古詩詠":"9158",
  "古卓謙":"9158",
  "梁心朗":"8883",
  "陳信澄":"8840",
  "陳澔泓":"8840",
  "梁正宇":"9339",
  "蘇穎悠":"5433",
  "吳瑋軒":"6918",
  "黎柏言":"2698",
  "陳曉瑩":"9322",
  "梁正宇":"9339",
  "郭可昕":"9860",
  "黃玥晴":"5352",
  "黃朗程":"9749",
  "姚心穎":"6606",
  "羅靖誼":"9650",
  "黎柏希":"2698",
  "陳焯棋":"9322",
  "顧舒然":"0777",
  "張爾淳":"1272",
  "張雅堯":"1272",
  "黃梓昕":"0397",
  "王尉鏇":"6801",
  "王斯顏":"6801",
  "呂洛希":"4917",
  "馬仲然":"8368",
  "鄧朗森":"7317",
  "陳書雅":"9721",
  "劉家頤":"5352",
  "鄭宇喬":"6455",
  "鍾皓惟":"9704",
  "周莉晶":"5181",
  "李灝宏":"5190",
  "潘洛詩":"6171"
};

/* 預設公眾假期（停課日）；教練可喺 Settings 分頁／設定頁加減（save_settings） */
const DEFAULT_HOLIDAYS = ["2026-04-05","2026-04-06","2026-05-01","2026-05-19","2026-06-19"];

/* ═══════════ 狀態詞對照 ═══════════ */
const WDN = ["日","一","二","三","四","五","六"];
const STATUSES = ["出席","缺席","請假","補堂","停課","豁免","加操","轉堂"];
const EN2ZH = { present:"出席", absent:"請假", makeup:"補堂", cancelled:"停課", exempt:"豁免" };
const ZH2EN = { "出席":"present", "請假":"absent", "缺席":"absent", "補堂":"makeup", "停課":"cancelled", "豁免":"exempt" };

/* 版面常數 */
const HEAD_ROW=4, DATA_START=5, SEQ_COL=1, NAME_COL=2, DATE_COL0=3, MK_MAX=20;

/* ═══════════ 基本工具 ═══════════ */
function SS(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function tz(){ return "Asia/Hong_Kong"; }   // 全系統一律以香港時區運作
function iso(d){ return Utilities.formatDate(d, tz(), "yyyy-MM-dd"); }
function nowStamp_(){ return Utilities.formatDate(new Date(), tz(), "yyyy-MM-dd HH:mm"); }   // 香港當前時間（分鐘）
function todayIso(){ return iso(new Date()); }
function pad4(x){ var s=String(x).replace(/\D/g,""); return ("0000"+s).slice(-4); }
function colLetter(c){ var s=""; while(c>0){ var m=(c-1)%26; s=String.fromCharCode(65+m)+s; c=(c-m-1)/26; } return s; }
function classOf(cid){ return CLASSES[cid]; }
function gridName(cid){ var c=CLASSES[cid]; return cid+" "+c.dayZh+c.time; } // 例：c1 星期一5–6pm

// 任何日期值 → yyyy-MM-dd 文字（修正 Sheets 自動轉 Date 嘅老問題）
function toIso_(v){
  if(v instanceof Date) return Utilities.formatDate(v, tz(), "yyyy-MM-dd");
  var s=String(v||"").trim();
  var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return m[1]+"-"+m[2]+"-"+m[3];
  var d=new Date(s); if(!isNaN(d)) return Utilities.formatDate(d, tz(), "yyyy-MM-dd");
  return s;
}
function addMonthsIso(isoStr, n){
  var a=String(isoStr).split("-").map(Number);
  var d=new Date(a[0], a[1]-1, a[2]); d.setMonth(d.getMonth()+n);
  return iso(d);
}
function addDaysIso(isoStr, n){
  var a=String(isoStr).split("-").map(Number);
  var d=new Date(a[0], a[1]-1, a[2]); d.setDate(d.getDate()+n);
  return iso(d);
}
// 暑期班請假補堂橋接：香港時間 2026-09-01 起自動關閉（家長端唔再顯示入口）
var SUMMER_BRIDGE_UNTIL = "2026-09-01";
function summerBridgeOn_(){ return todayIso() < SUMMER_BRIDGE_UNTIL; }

/* ═══════════ 補堂限期延長（逐筆覆寫；僅限「請假」可補堂節數）═══════════
   override store「限期延長」：學生|班別|缺席日|原限期|新限期|記錄時間
   有覆寫就用新限期，否則 = 缺席日 + MAKEUP_MONTHS。 */
function dlExtSheet(){
  var sh=SS().getSheetByName("限期延長");
  if(!sh){
    sh=SS().insertSheet("限期延長");
    sh.getRange(1,1,1,6).setValues([["學生","班別","缺席日","原限期","新限期","記錄時間"]]);
    sh.setFrozenRows(1);
    sh.getRange("A:F").setNumberFormat("@");
  }
  return sh;
}
function dlExtRows_(){
  var sh=dlExtSheet(); if(sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,6).getValues().map(function(r,i){
    return {row:i+2, name:String(r[0]||"").trim(), cid:String(r[1]||"").trim(),
      absDate:toIso_(r[2]), oldDl:toIso_(r[3]), newDl:toIso_(r[4]), at:String(r[5]||"")};
  }).filter(function(r){ return r.name && r.cid && r.absDate && r.newDl; });
}
function dlExtMap_(){
  var m={}; dlExtRows_().forEach(function(r){ m[r.name+"|"+r.cid+"|"+r.absDate]=r.newDl; });
  return m;
}
function effDeadline_(name, cid, absDate){
  var ov=dlExtMap_()[name+"|"+cid+"|"+toIso_(absDate)];
  return ov || addMonthsIso(absDate, CONFIG.MAKEUP_MONTHS);
}
/* 教練：手動設定／延長／回復某生某缺席日嘅補堂限期。coachPass 守護。
   newDl 留空 / "remove" / 等於原限期 → 只清走覆寫（回復原本限期，不延長）。*/
function apiSetMakeupDeadline(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var nm=String(p.name||"").trim(), cid=String(p.cid||"").trim(), absDate=toIso_(p.absDate||"");
  var rawNew=String(p.newDl||"").trim(), newDl=(rawNew && rawNew.toLowerCase()!=="remove")?toIso_(rawNew):"";
  if(!nm||!cid||!absDate) return {ok:false,err:"參數不全（name/cid/absDate）"};
  var oldDl=addMonthsIso(absDate, CONFIG.MAKEUP_MONTHS), sh=dlExtSheet();
  // 先清走同一缺席日嘅舊覆寫，避免累積／重複
  if(sh.getLastRow()>=2){
    var v=sh.getRange(2,1,sh.getLastRow()-1,6).getValues();
    for(var i=v.length-1;i>=0;i--){ if(String(v[i][0]).trim()===nm && String(v[i][1]).trim()===cid && toIso_(v[i][2])===absDate) sh.deleteRow(i+2); }
  }
  if(!newDl || newDl===oldDl){   // 回復原限期：只清走，唔加新覆寫
    try{ logAppend({name:nm,key:cid,action:"resetDl",date:absDate,status:"回復原限期 "+oldDl}); }catch(e){}
    return {ok:true, removed:true, name:nm, cid:cid, absDate:absDate, restoredTo:oldDl};
  }
  var row=sh.getLastRow()+1; sh.getRange(row,1,1,6).setNumberFormat("@");
  sh.getRange(row,1,1,6).setValues([[nm,cid,absDate,oldDl,newDl,nowStamp_()]]);
  try{ logAppend({name:nm,key:cid,action:"extendDl",date:absDate,status:"限期 "+oldDl+"→"+newDl}); }catch(e){}
  return {ok:true, name:nm, cid:cid, absDate:absDate, oldDl:oldDl, newDl:newDl};
}
/* 一次性：把「已過期、未補堂」嘅請假節數限期 +21 日。
   規則：新限期 = 原限期(缺席日+MAKEUP_MONTHS) + 21 日；
   只處理 (a) 屬「請假」可補節數、(b) 原限期已過今日、(c) 加 21 日後 ≥ 今日。
   仍過期者唔理；已覆寫過者略過（idempotent）。
   先用 extendExpiredDeadlinesDryRun() 睇清單，確認先 extendExpiredDeadlinesApply()。*/
function extendExpiredDeadlines(apply){
  var today=todayIso(), ADD=21, map=dlExtMap_();
  var eligible=[], stillExpired=[], already=[];
  CLASS_IDS.forEach(function(cid){
    var blk=readBlock(cid);
    Object.keys(blk.status).forEach(function(nm){
      var st=blk.status[nm]||[], lv=[];
      st.forEach(function(s,i){ if(s==="請假") lv.push(blk.dates[i]); });
      if(!lv.length) return;
      lv.sort();
      var madeUp=makeupUniq_().filter(function(m){ return m.name===nm && m.from===cid; }).length;
      for(var k=madeUp;k<lv.length;k++){           // 未補堂嘅請假節數（最舊優先配對後剩低）
        var d=lv[k], oldDl=addMonthsIso(d, CONFIG.MAKEUP_MONTHS);
        if(oldDl>=today) continue;                 // 未過期，唔使延
        var key=nm+"|"+cid+"|"+d;
        if(map[key]){ already.push({name:nm,cid:cid,absDate:d,newDl:map[key]}); continue; }
        var newDl=addDaysIso(oldDl, ADD);
        if(newDl<today){ stillExpired.push({name:nm,cid:cid,absDate:d,oldDl:oldDl,newDl:newDl}); continue; }
        eligible.push({name:nm,cid:cid,absDate:d,oldDl:oldDl,newDl:newDl});
      }
    });
  });
  if(apply && eligible.length){
    var sh=dlExtSheet();
    eligible.forEach(function(o){
      var row=sh.getLastRow()+1;
      sh.getRange(row,1,1,6).setNumberFormat("@");
      sh.getRange(row,1,1,6).setValues([[o.name,o.cid,o.absDate,o.oldDl,o.newDl,nowStamp_()]]);
    });
  }
  Logger.log("【補堂限期延長 +"+ADD+"日】"+(apply?"✅ 已套用寫入":"🔎 試行（未寫入）")
    +"\n合資格延長："+eligible.length+" 筆　|　仍過期(唔理)："+stillExpired.length+" 筆　|　已延長過(略過)："+already.length+" 筆");
  eligible.forEach(function(o){ Logger.log("  ✔ "+o.name+" / "+classLabel_(o.cid)+" / 缺席 "+o.absDate+" / 原限期 "+o.oldDl+" → 新限期 "+o.newDl); });
  stillExpired.forEach(function(o){ Logger.log("  ✖ "+o.name+" / "+classLabel_(o.cid)+" / 缺席 "+o.absDate+" / +21日="+o.newDl+"（仍過期，不處理）"); });
  return {apply:!!apply, eligible:eligible, stillExpired:stillExpired, already:already};
}
function extendExpiredDeadlinesDryRun(){ return extendExpiredDeadlines(false); }
function extendExpiredDeadlinesApply(){ return extendExpiredDeadlines(true); }

/* ═══════════ Settings：假期 / 加課 / 停課日（教練設定頁控制）═══════════ */
function settingsSheet(){ return SS().getSheetByName("Settings"); }
function settingsMap(){
  var sh=settingsSheet(), map={};
  if(!sh || sh.getLastRow()<2) return map;
  sh.getRange(2,1,sh.getLastRow()-1,2).getValues().forEach(function(r){
    var k=String(r[0]||"").trim(); if(!k) return;
    try{ map[k]=JSON.parse(r[1]); }catch(e){ map[k]=r[1]; }
  });
  return map;
}
// 程式碼層額外假期：喺 Settings public_holidays 之外「再加」（唔覆蓋 Settings，避免改錯其他日子）。
var EXTRA_HOLIDAYS = ["2026-07-01"];   // 2026-07-01（三）全校暫停課堂 → c3/c4 該堂自動唔計學費
function holidaysSet(){
  var m=settingsMap(), h=m["public_holidays"];
  var arr=(Array.isArray(h)&&h.length)?h:DEFAULT_HOLIDAYS;
  var s={}; arr.concat(EXTRA_HOLIDAYS).forEach(function(d){ s[toIso_(d)]=1; }); return s;
}
function listFromSettings(prefix,cid){
  var m=settingsMap(), v=m[prefix+cid];
  var s={}; if(Array.isArray(v)) v.forEach(function(d){ s[toIso_(d)]=1; }); return s;
}
function cancelledSet(cid){ return listFromSettings("cancelled_",cid); }
function extraSet(cid){ return listFromSettings("extra_",cid); }

/* ═══════════ 上課日生成（學期窗內，該班星期，扣假期/停課，加加課）═══════════ */
function sessionsFor(cid){
  var c=CLASSES[cid]; if(!c) return [];
  var a=CONFIG.TERM_START.split("-").map(Number), b=CONFIG.TERM_END.split("-").map(Number);
  var cur=new Date(a[0],a[1]-1,a[2]), end=new Date(b[0],b[1]-1,b[2]);
  // 推到第一個符合星期嘅日子
  while(cur.getDay()!==c.wd && cur<=end) cur.setDate(cur.getDate()+1);
  var hol=holidaysSet(), cancel=cancelledSet(cid), out=[];
  while(cur<=end){
    var s=iso(cur);
    if(!hol[s] && !cancel[s]) out.push(s);
    cur.setDate(cur.getDate()+7);
  }
  // 加課日（非正規星期）
  var extra=extraSet(cid);
  Object.keys(extra).forEach(function(s){ if(out.indexOf(s)<0 && !cancel[s]) out.push(s); });
  return out.sort();
}

/* ═══════════ 安裝（非破壞性）═══════════ */
function setup(){
  var ss=SS();
  try{ ss.setSpreadsheetTimeZone("Asia/Hong_Kong"); }catch(e){}   // 整份試算表鎖香港時區
  try{ backup(); }catch(e){}
  // Settings（只喺缺少時建立）
  var ST=ss.getSheetByName("Settings");
  if(!ST){ ST=ss.insertSheet("Settings"); ST.appendRow(["key","value"]);
    ST.appendRow(["public_holidays", JSON.stringify(DEFAULT_HOLIDAYS)]); }
  // Roster（安全重建，電話欄保留現有值）
  ensureRoster_(ss);
  // Log / 補堂
  var L=ss.getSheetByName("Log");
  if(!L){ L=ss.insertSheet("Log"); L.appendRow(["時間","學生","班別","動作","日期","狀態","可補","補去","補去日期"]); }
  var M=ss.getSheetByName("補堂");
  if(!M){ M=ss.insertSheet("補堂"); M.appendRow(["學生","原班","補去班","補堂日期","狀態"]); }
  M.getRange("D:D").setNumberFormat("@");
  // 醫生紙（病假上載，存 Drive 連結）
  var MN=ss.getSheetByName("MedNotes");
  if(!MN){ MN=ss.insertSheet("MedNotes"); MN.appendRow(["學生","班別","日期","連結","時間"]); }
  MN.getRange("C:C").setNumberFormat("@");
  // B 通道分頁（成績 / 身體 / 評級）
  ["Perf","Body","Grades"].forEach(function(n){ if(!ss.getSheetByName(n)){
    var s=ss.insertSheet(n);
    if(n==="Perf") s.appendRow(["name","metricId","date","val","v1","v2","v3"]);
    else if(n==="Body") s.appendRow(["name","date","height","weight"]);
    else s.appendRow(["name","grade"]);
  }});
  // 各班格仔（非破壞性）
  CLASS_IDS.forEach(function(cid){ buildGrid(ss,cid,false); });
  normalizeMakeupDates_();
  syncMakeupsToGrid();
  cleanupStray(ss);
  ensureAutoBackup();
  ensureDriveBackup();
  ensureReminders();
  ensureSickCertTrigger();
  try{ feeSheet(); pinSheet(); addonSheet(); referralSheet(); noticeSheet(); transferSheet(); dlExtSheet(); }catch(e){}   // 建立各分頁
  try{ genPeriod_(curPeriodLabel_()); genPeriod_(nextPeriodLabel_()); }catch(e){}   // 自動產生本期與下期繳費列
  try{ seedDemo_(); }catch(e){}
  try{ seedPtData(); }catch(e){}
  // 觸發對 #11 IS App Data 的授權（家長端即時讀真實出席用）；首次會彈出重新授權
  try{ var _d=is11_(); Logger.log("已連接 #11：attendance "+Object.keys(_d.att).length+" 格、absences "+_d.abs.length+" 筆"); }catch(e){ Logger.log("連接 #11 失敗："+e); }
  try{ backup(); }catch(e){}
  Logger.log("setup 完成（非破壞性；已啟用每日自動備份 + Drive 整份備份）。");
}

// Roster：寫入每名學生一行（保留已填電話）
function ensureRoster_(ss){
  var R=ss.getSheetByName("Roster");
  var prevPhone={};
  if(R && R.getLastRow()>1){
    R.getRange(2,1,R.getLastRow()-1,2).getValues().forEach(function(r){
      var nm=String(r[0]).trim(); if(nm) prevPhone[nm]=String(r[1]||"");
    });
  }
  R = R || ss.insertSheet("Roster");
  R.clear(); R.appendRow(["學生中文全名","家長手機後4位","班別","星期","時間"]);
  R.getRange("B:B").setNumberFormat("@");
  var rows=[];
  CLASS_IDS.forEach(function(cid){ var c=CLASSES[cid];
    c.students.forEach(function(nm){ rows.push([nm, prevPhone[nm]||PHONE[nm]||"", cid, c.dayZh, c.time]); });
  });
  // 只登入、不入班：可登入但無班別（暫停／待回歸）
  var inClass={}; rows.forEach(function(r){ inClass[r[0]]=1; });
  (typeof LOGIN_ONLY!=="undefined"?LOGIN_ONLY:[]).forEach(function(nm){
    if(inClass[nm]) return;   // 若已在某班則略過，避免重複
    rows.push([nm, prevPhone[nm]||PHONE[nm]||"", "", "", ""]);
  });
  if(rows.length) R.getRange(2,1,rows.length,5).setValues(rows);
}

function cleanupStray(ss){
  var keep={Roster:1,Log:1,"補堂":1,"備份":1,"出席報表":1,Settings:1,Perf:1,Body:1,Grades:1};
  CLASS_IDS.forEach(function(cid){ keep[gridName(cid)]=1; });
  ss.getSheets().forEach(function(s){ var n=s.getName();
    if(keep[n]) return;
    if(n==="工作表1"||n==="Sheet1"){ try{ ss.deleteSheet(s); }catch(e){} }
  });
}

// ⚠️ 破壞性：清空重建。只喺刻意重置先手動執行。
function rebuildAll(){
  var ss=SS();
  try{ backup(); }catch(e){}
  ["Log","補堂"].forEach(function(n){ var s=ss.getSheetByName(n); if(s) ss.deleteSheet(s); });
  CLASS_IDS.forEach(function(cid){ var s=ss.getSheetByName(gridName(cid)); if(s) ss.deleteSheet(s); });
  setup();
  Logger.log("rebuildAll 完成（已全部重置）。");
}

/* ═══════════ 格仔建立 ═══════════ */
function buildGrid(ss, cid, force){
  var c=CLASSES[cid], nm=gridName(cid), sh=ss.getSheetByName(nm);
  var dates=sessionsFor(cid), n=dates.length, students=c.students;
  if(sh && !force && sh.getLastRow()>=DATA_START && sameDateHeader_(sh,dates,n)){
    // 結構/日期一致 → 只重設下拉/變色（涵蓋補堂區），保留所有資料
    var bk=sh.getRange(DATA_START,DATE_COL0,students.length+MK_MAX,n);
    bk.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES,true).setAllowInvalid(false).build());
    // 清除總結欄（出席/請假/缺席 = 3 欄）及其右側殘留驗證，避免 COUNTIF 公式違反 status 驗證
    try{ sh.getRange(DATA_START, DATE_COL0+n, students.length+MK_MAX, 5).setDataValidation(null); }catch(e){}
    applyCF(sh,bk);
    return;
  }
  sh = sh || ss.insertSheet(nm);
  sh.clear(); sh.setConditionalFormatRules([]);
  // ⚠️ sh.clear() 唔會清走資料驗證。若舊 grid 欄數多過新 n（例如曾有 07/01 欄、
  // 後來 07-01 變假期被 sessionsFor 剔走），殘留嘅「狀態」驗證會落喺新總結欄位置，
  // 令下面寫 COUNTIF 公式撞驗證規則而 throw。故 rebuild 前先清晒全表驗證（下面會重新套用日期欄驗證）。
  try{ sh.getRange(1,1,Math.max(sh.getMaxRows(),1),Math.max(sh.getMaxColumns(),1)).clearDataValidations(); }catch(e){}
  var lastCol=2+n+3;
  sh.getRange(1,1,1,lastCol).merge().setValue("INITIATE SPORTS　"+c.dayZh+" "+c.time)
    .setFontSize(14).setFontWeight("bold").setHorizontalAlignment("center");
  var d0=n?dates[0].slice(5).replace("-","/"):"", d1=n?dates[n-1].slice(5).replace("-","/"):"";
  sh.getRange(2,1,1,lastCol).merge().setValue(c.dayZh+"　"+c.time+"　｜　"+d0+" – "+d1+"　｜　共 "+n+" 堂")
    .setHorizontalAlignment("center").setFontColor("#666");
  sh.getRange(3,1,1,lastCol).merge().setValue("點名：日期格揀「出席／缺席／請假／補堂」，同 App 即時同步；補堂學生會自動排喺名單下方")
    .setFontColor("#999").setFontSize(9);
  var head=["序號","姓名"];
  for(var i=0;i<n;i++){ var p=dates[i].split("-"); head.push(p[1]+"/"+p[2]); }
  head.push("出席","請假","缺席");
  sh.getRange(HEAD_ROW,1,1,lastCol).setValues([head]).setFontWeight("bold")
    .setHorizontalAlignment("center").setBackground("#1BAFBD").setFontColor("#FFFFFF").setWrap(true);
  var rows=[];
  for(var s=0;s<students.length;s++){
    var rn=DATA_START+s, r=[s+1, students[s]];
    for(var j=0;j<n;j++) r.push("");
    var c0=colLetter(DATE_COL0), cN=colLetter(DATE_COL0+Math.max(n-1,0));
    r.push('=COUNTIF('+c0+rn+':'+cN+rn+',"出席")+COUNTIF('+c0+rn+':'+cN+rn+',"補堂")');
    r.push('=COUNTIF('+c0+rn+':'+cN+rn+',"請假")');
    r.push('=COUNTIF('+c0+rn+':'+cN+rn+',"缺席")');
    rows.push(r);
  }
  if(students.length) sh.getRange(DATA_START,1,students.length,lastCol).setValues(rows);
  sh.getRange(HEAD_ROW,1,students.length+1,lastCol).setBorder(true,true,true,true,true,true);
  sh.setColumnWidth(1,46); sh.setColumnWidth(2,92);
  for(var i2=0;i2<n;i2++) sh.setColumnWidth(DATE_COL0+i2,58);
  sh.setColumnWidth(DATE_COL0+n,52); sh.setColumnWidth(DATE_COL0+n+1,52); sh.setColumnWidth(DATE_COL0+n+2,52);
  sh.setFrozenRows(HEAD_ROW);
  var block=sh.getRange(DATA_START,DATE_COL0,students.length+MK_MAX,Math.max(n,1));
  block.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES,true).setAllowInvalid(false).build());
  block.setHorizontalAlignment("center");
  try{ sh.getRange(DATA_START, DATE_COL0+n, students.length+MK_MAX, 5).setDataValidation(null); }catch(e){}
  applyCF(sh,block);
  // 預先標假期/停課日（落喺欄上嘅 → 「停課」）：扣咗就唔會喺欄出現，呢度只標額外加課後又取消嘅情況
}
function sameDateHeader_(sh,dates,n){
  if(n===0) return true;
  var lastCol=2+n+3;
  if(sh.getLastColumn()<lastCol) return false;
  var head=sh.getRange(HEAD_ROW,DATE_COL0,1,n).getValues()[0];
  for(var i=0;i<n;i++){ var p=dates[i].split("-"); if(String(head[i]||"")!==p[1]+"/"+p[2]) return false; }
  return true;
}
function applyCF(sh,block){
  sh.setConditionalFormatRules([
    cfRule(block,"出席","#C6EFCE","#006100"),
    cfRule(block,"補堂","#BDD7EE","#1F4E79"),
    cfRule(block,"請假","#FFEB9C","#9C6500"),
    cfRule(block,"缺席","#FFC7CE","#9C0006"),
    cfRule(block,"停課","#E2E3E5","#5F6368"),
    cfRule(block,"豁免","#F2F2F2","#7F7F7F"),
    cfRule(block,"加操","#E1D5F5","#5B2E91"),
    cfRule(block,"轉堂","#D5E8F5","#1B5E91"),
  ]);
}
function cfRule(range,txt,bg,fc){
  return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(txt)
    .setBackground(bg).setFontColor(fc).setRanges([range]).build();
}

/* ═══════════ 讀寫格仔 ═══════════ */
function readBlock(cid){
  var m=gridMeta(cid), dates=m.dates, n=m.n, students=m.students, map={};
  if(m.sh && students.length){
    var hp=Math.max(m.physN,1);
    var vals=m.sh.getRange(DATA_START,NAME_COL,students.length,1+hp).getValues();
    for(var i=0;i<students.length;i++){
      var dv=vals[i].slice(1);
      map[String(vals[i][0])]=dates.map(function(d){ var ci=m.colOf[mmdd_(d)]; return ci==null?"":String(dv[ci]||""); });
    }
  }
  return {dates:dates,n:n,students:students,status:map};
}

/* ═══════════ #11 IS App Data 即時讀取（恆常班真實出席來源）═══════════
 * 背景：教練一直用 is-attendance-app 喺 #11(parent-portal) 點名，#4 嘅 grid 從未
 * 真正接收過資料 → is-parent 家長頁全部顯示「已過」。今後家長顯示一律以 #11 為
 * 真相來源；#4 grid 只作後備（保留家長喺 is-parent 自助申請嘅未來請假/補堂）。
 *   present→出席, exempt→豁免, cancelled→停課,
 *   absent + 有 absences 紀錄 → 請假(可補堂)，absent + 冇 → 缺席。
 * ⚠️ 只影響「家長顯示」(classesFor_)，唔碰任何寫入/點名/驗證邏輯，零寫入風險。
 */
var DATA_SS_ID = "1prjceGydcVHvhidlp8SZEJ1abE0Cvz2WqwrjN6_K7qo";  // IS App Data (#11)
// 已知別字校正：#11 來源打錯、MCP 改唔到，喺讀入時校正（令該生歷史完整、唔再誤報「不明姓名」）
var NAME_FIX = { "陳柏晞":"陳柏睎" };
function fixName_(nm){ return NAME_FIX[nm] || nm; }
var _is11Cache = null;   // 每次執行只讀一次（Apps Script 全域於每次 doGet/doPost 重置）
function is11_(){
  if(_is11Cache) return _is11Cache;
  var out={att:{}, abs:[]};
  try{
    var ss=SpreadsheetApp.openById(DATA_SS_ID);
    var aSh=ss.getSheetByName("attendance");   // key,classId,date,name,status
    if(aSh && aSh.getLastRow()>1){
      aSh.getRange(2,1,aSh.getLastRow()-1,5).getValues().forEach(function(r){
        var cid=String(r[1]||"").trim(), d=toIso_(r[2]), nm=fixName_(String(r[3]||"").trim()), s=String(r[4]||"").trim();
        if(cid&&d&&nm&&s) out.att[cid+"|"+d+"|"+nm]=s;
      });
    }
    var bSh=ss.getSheetByName("absences");      // id,name,classId,absDate,deadline,madeUpDate
    if(bSh && bSh.getLastRow()>1){
      bSh.getRange(2,1,bSh.getLastRow()-1,6).getValues().forEach(function(r){
        var nm=fixName_(String(r[1]||"").trim()), cid=String(r[2]||"").trim(), ad=toIso_(r[3]);
        if(nm&&cid&&ad) out.abs.push({name:nm, cid:cid, absDate:ad,
          deadline:(r[4]?toIso_(r[4]):""), madeUpDate:(r[5]?toIso_(r[5]):"")});
      });
    }
  }catch(e){ Logger.log("is11_ 讀取 #11 失敗（家長端會退回 #4 grid）: "+e); }
  _is11Cache=out; return out;
}
// #11 英文狀態 → 中文（absent 視乎係咪有 absences 紀錄分「請假 / 缺席」）
function zhStatus11_(nm, d, raw, leaveSet){
  if(!raw) return "";
  if(raw==="present")   return "出席";
  if(raw==="exempt")    return "豁免";
  if(raw==="cancelled") return "停課";
  if(raw==="absent")    return leaveSet[nm+"|"+d] ? "請假" : "缺席";
  return raw;   // 已經係中文(教練直接打) → 原樣
}
// 家長顯示用：#4 grid 為主、#11 為後備
// （遷移後 #11 出席/缺席已搬入 #4 grid，且日後教練改用 #4 點名 → #4 grid 即恆常班出席真相；
//   #11 只作後備，補返個別未遷移嘅舊格，避免教練停用 #11 後家長見到舊資料。）
// 老闆確認(2026-06-22)：此日期之前嘅空白上課堂一律當「出席」（數碼系統上線前歷史補完）。
// 用固定日期、非「今日」：確保將來教練未點名嘅堂仍會顯示空白，唔會被自動當出席而遮蔽問題。
var INFER_PRESENT_BEFORE = "2026-06-16";
// 學生實際入班日（ISO）：此日之前嘅堂一律唔屬於佢 —— 唔顯示、唔推斷出席、唔計待補。
// 用於回歸／插班生：佢哋本來唔喺班，今期先加入 CLASSES，grid 卻有舊日期欄。
// 例：梁心朗 2026-07 回歸 c4（5-6月暫停、之前根本未上過堂）。
var STUDENT_JOIN = { "梁心朗":"2026-07-01", "黃玥晴":"2026-07-01",
  "李灝宏":"2026-05-23" };  // 李灝宏 由 c7 轉 c6（7月正式）；入班日設真正開始上 c6 嗰日 5/23，保留佢 5–6月 c6 補堂、又免 2–5月假推斷
function joinIso_(nm){ return STUDENT_JOIN[String(nm).trim()]||""; }
function readBlockMerged_(cid){
  var base=readBlock(cid), c=CLASSES[cid], d=is11_();
  var leaveSet={}; d.abs.forEach(function(a){ if(a.cid===cid) leaveSet[a.name+"|"+a.absDate]=true; });
  var map={};
  c.students.forEach(function(nm){
    var grid=base.status[nm]||[], ji=joinIso_(nm);
    map[nm]=base.dates.map(function(dt,i){
      if(ji && dt < ji) return "";   // 入班日之前：呢個學生根本未入班 → 唔顯示任何狀態
      var g=grid[i]||"";
      if(g) return g;   // #4 grid 有值 → 以 #4 為準（含家長 is-parent 自助請假寫入嘅「請假」）
      // #4 grid 該格為空 → 後備讀 #11（防個別未遷移嘅舊格）
      // attendance tab 有 raw 就用；否則若 absences 有該日請假紀錄（3月匯入歷史只入 absences，無 attendance）→ 顯示「請假」
      var s=zhStatus11_(nm, dt, d.att[cid+"|"+dt+"|"+nm], leaveSet) || (leaveSet[nm+"|"+dt] ? "請假" : "");
      if(s) return s;
      // 歷史補完：截止日之前嘅空白堂（已扣除假期/停課，剩低都係真實上課日）→ 非請假同學當「出席」。
      if(dt < INFER_PRESENT_BEFORE) return "出席";
      return "";
    });
  });
  return {dates:base.dates, n:base.n, students:base.students, status:map};
}

function gridMeta(cid){
  var students=CLASSES[cid].students, dates=sessionsFor(cid);
  var sh=SS().getSheetByName(gridName(cid)), colOf={}, physN=0;
  // 讀實體表頭日期 → date(MM/DD)→欄 index，令讀寫一律按「日期」對齊而非「位置」。
  // 解決：某日停課後從 sessionsFor 剔走，但 grid 仍留住嗰欄 → 之後全部日期錯位。
  if(sh){
    var lastC=sh.getLastColumn();
    if(lastC>=DATE_COL0){
      var fh=sh.getRange(HEAD_ROW,DATE_COL0,1,lastC-DATE_COL0+1).getValues()[0];
      physN=0; var found=false;
      for(var k=0;k<fh.length;k++){ if(String(fh[k])==="出席"){ physN=k; found=true; break; } }
      if(!found) physN=fh.length;   // 無「出席」總結欄 → 全部當日期欄
      // 表頭「06/20」可能被 Sheets 自動轉做日期物件 → 統一正規化做 MM/DD 先對照（否則 String() 對唔到）
      for(var h=0;h<physN;h++){ var key=(fh[h] instanceof Date)?Utilities.formatDate(fh[h],tz(),"MM/dd"):String(fh[h]||""); if(key && colOf[key]==null) colOf[key]=h; }
    }
  }
  return {sh:sh, dates:dates, n:dates.length, students:students, R:students.length,
    mkStart:DATA_START+students.length, colOf:colOf, physN:physN};
}
function mmdd_(iso){ return String(iso).slice(5).replace("-","/"); }
function dateCol(m,dateIso){
  var mmdd=mmdd_(dateIso);
  if(m.colOf && m.physN>0){ var c=m.colOf[mmdd]; return c==null?-1:DATE_COL0+c; }   // 按表頭對齊
  var i=m.dates.indexOf(dateIso); return i<0?-1:DATE_COL0+i;                         // 後備（無表頭）
}
function findRow(m,name,create){
  var ri=m.students.indexOf(name); if(ri>=0) return DATA_START+ri;
  var names=m.sh.getRange(m.mkStart,NAME_COL,MK_MAX,1).getValues(), empty=-1;
  for(var j=0;j<MK_MAX;j++){ var v=String(names[j][0]||"");
    if(v===name) return m.mkStart+j; if(empty<0&&!v) empty=m.mkStart+j; }
  if(create && empty>=0){
    // 用實體日期欄數 physN（非 sessionsFor 嘅 m.n），避免 grid 有停課殘留欄時總結欄落錯位
    var physN=Math.max(m.physN||0, m.n), sumC=DATE_COL0+physN;
    var r=empty, c0=colLetter(DATE_COL0), cN=colLetter(DATE_COL0+Math.max(physN-1,0));
    m.sh.getRange(r,SEQ_COL).setValue("補"); m.sh.getRange(r,NAME_COL).setValue(name);
    try{ m.sh.getRange(r, sumC, 1, 3).setDataValidation(null); }catch(e){}   // 清總結欄驗證，免 COUNTIF 違反「只准 status」
    m.sh.getRange(r,sumC).setValue('=COUNTIF('+c0+r+':'+cN+r+',"出席")+COUNTIF('+c0+r+':'+cN+r+',"補堂")');
    m.sh.getRange(r,sumC+1).setValue('=COUNTIF('+c0+r+':'+cN+r+',"請假")');
    m.sh.getRange(r,sumC+2).setValue('=COUNTIF('+c0+r+':'+cN+r+',"缺席")');
    return r;
  }
  return -1;
}
// 清補堂區某名嘅殘留空行：若該補堂行喺日期格已無任何標記，整行清走（序號/姓名/公式）
function clearStrayMakeupRow_(cid,name){
  var m=gridMeta(cid); if(!m.sh) return;
  var names=m.sh.getRange(m.mkStart,NAME_COL,MK_MAX,1).getValues();
  for(var j=0;j<MK_MAX;j++){
    if(String(names[j][0]||"").trim()!==String(name).trim()) continue;
    var r=m.mkStart+j, vals=m.sh.getRange(r,DATE_COL0,1,Math.max(m.n,1)).getValues()[0];
    if(!vals.some(function(v){ return String(v||"").trim()!==""; }))
      m.sh.getRange(r,SEQ_COL,1,DATE_COL0+m.n+2).clearContent();
    return;
  }
}
// 清理全部 grid 補堂區嘅殘留空行（無格仔標記 又 無補堂表記錄）
function cleanupStrayMakeupRows_(){
  var mk=makeupAll(), cleaned=0;
  CLASS_IDS.forEach(function(cid){
    var m=gridMeta(cid); if(!m.sh) return;
    var names=m.sh.getRange(m.mkStart,NAME_COL,MK_MAX,1).getValues();
    for(var j=0;j<MK_MAX;j++){
      var nm=String(names[j][0]||"").trim(); if(!nm) continue;
      var r=m.mkStart+j, vals=m.sh.getRange(r,DATE_COL0,1,Math.max(m.n,1)).getValues()[0];
      var hasMark=vals.some(function(v){ return String(v||"").trim()!==""; });
      var hasRec=mk.some(function(x){ return x.name===nm && x.to===cid; });
      if(!hasMark && !hasRec){ m.sh.getRange(r,SEQ_COL,1,DATE_COL0+m.n+2).clearContent(); cleaned++; }
    }
  });
  return cleaned;
}
function apiCleanupGrids(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  try{ backup(); }catch(e){}
  var cleaned=cleanupStrayMakeupRows_();
  // 清孤兒病假待證明：狀態仍「待證明」但格仔已唔係請假（如已取消病假）→ 刪走，免日後 false 逾期通知
  var pcCleaned=0;
  try{ var pc=pendingCertSheet();
    if(pc.getLastRow()>=2){ var pv=pc.getRange(2,1,pc.getLastRow()-1,5).getValues();
      for(var i=pv.length-1;i>=0;i--){ if(String(pv[i][4])!=="待證明") continue;
        var cid=String(pv[i][1]).trim(), nm=String(pv[i][0]).trim(), d=toIso_(pv[i][2]);
        if(!CLASSES[cid]) continue;
        var blk=readBlock(cid), st=blk.status[nm]||[], di=blk.dates.indexOf(d);
        if((di>=0?String(st[di]||""):"")!=="請假"){ pc.deleteRow(i+2); pcCleaned++; }
      } }
  }catch(e){}
  var futCleared=0; try{ futCleared=cleanFutureAttendance_(); }catch(e){}
  var nameFixed=0; try{ nameFixed=repairGridNames_(); }catch(e){}
  return {ok:true, cleaned:cleaned, pendingCertCleaned:pcCleaned, futureCleared:futCleared, nameFixed:nameFixed};
}
// 防呆：清走「未來上課日但標咗出席/補堂/加操」嘅格（未來請假/停課/豁免/轉堂屬合法預約 → 保留）。
// 批次寫入（逐班一讀一寫），只清未來上課日欄，唔掂過往同總結欄。
function cleanFutureAttendance_(){
  var today=todayIso(), FUT={"出席":1,"補堂":1,"加操":1}, cleared=0;
  CLASS_IDS.forEach(function(cid){
    var m=gridMeta(cid); if(!m.sh || m.physN<=0) return;
    var futOffs=[]; m.dates.forEach(function(d){ if(d>today){ var off=m.colOf[mmdd_(d)]; if(off!=null) futOffs.push(off); } });
    if(!futOffs.length) return;
    var firstRow=DATA_START, nR=m.mkStart+MK_MAX-firstRow;   // 正規學生 + 補堂區
    var block=m.sh.getRange(firstRow,DATE_COL0,nR,m.physN).getValues(), changed=false;
    for(var ri=0; ri<nR; ri++){ for(var fi=0; fi<futOffs.length; fi++){ var off=futOffs[fi];
      if(FUT[String(block[ri][off]||"")]){ block[ri][off]=""; changed=true; cleared++; } } }
    if(changed) m.sh.getRange(firstRow,DATE_COL0,nR,m.physN).setValues(block);
  });
  return cleared;
}
function cleanFutureAttendanceMenu(){
  try{ backup(); }catch(e){}
  var n=cleanFutureAttendance_();
  try{ SpreadsheetApp.getUi().alert("已清走未來誤標出席："+n+" 格\n（保留未來請假/停課/豁免；已先自動備份）"); }catch(e){}
}
// 修復誤刪嘅格仔姓名：規則學生行（DATA_START 起）姓名空白 → 按 CLASSES 名單順序補返序號＋姓名（唔郁出席資料、唔覆蓋非空姓名）。
function repairGridNames_(){
  var fixed=0;
  CLASS_IDS.forEach(function(cid){
    var sh=SS().getSheetByName(gridName(cid)); if(!sh) return;
    var studs=CLASSES[cid].students, n=studs.length;
    var cur=sh.getRange(DATA_START,SEQ_COL,n,2).getValues(), out=[], changed=false;
    for(var i=0;i<n;i++){
      var seq=String(cur[i][0]||""), nm=String(cur[i][1]||"").trim();
      if(!nm){ out.push([String(i+1), studs[i]]); changed=true; fixed++; }   // 姓名空白 → 補返
      else out.push([seq||String(i+1), nm]);
    }
    if(changed) sh.getRange(DATA_START,SEQ_COL,n,2).setValues(out);
  });
  return fixed;
}
function repairGridNamesMenu(){
  try{ backup(); }catch(e){}
  var n=repairGridNames_();
  try{ SpreadsheetApp.getUi().alert("已修復空白姓名格："+n+" 個（已先自動備份）。"); }catch(e){}
}
function markCell(cid,name,dateIso,status,create){
  var m=gridMeta(cid); if(!m.sh) return false;
  var col=dateCol(m,dateIso); if(col<0) return false;
  var row=findRow(m,name,!!create); if(row<0) return false;
  m.sh.getRange(row,col).setValue(status); return true;
}
function makeupStatus(cid,name,dateIso){
  var m=gridMeta(cid); if(!m.sh) return "";
  var col=dateCol(m,dateIso); if(col<0) return "";
  var names=m.sh.getRange(m.mkStart,NAME_COL,MK_MAX,1).getValues();
  for(var j=0;j<MK_MAX;j++){ if(String(names[j][0]||"")===name) return String(m.sh.getRange(m.mkStart+j,col).getValue()||""); }
  return "";
}
function readFull(cid){
  var m=gridMeta(cid), reg={}, mk=[];
  if(!m.sh) return {dates:m.dates,n:m.n,students:m.students,reg:reg,mk:mk};
  var hp=Math.max(m.physN,1);
  var align=function(dv){ return m.dates.map(function(d){ var ci=m.colOf[mmdd_(d)]; return ci==null?"":String(dv[ci]||""); }); };
  if(m.R){
    var rv=m.sh.getRange(DATA_START,NAME_COL,m.R,1+hp).getValues();
    for(var i=0;i<m.R;i++) reg[String(rv[i][0])]=align(rv[i].slice(1));
  }
  var mv=m.sh.getRange(m.mkStart,NAME_COL,MK_MAX,1+hp).getValues();
  for(var j=0;j<MK_MAX;j++){ var nm=String(mv[j][0]||""); if(nm) mk.push({name:nm,statuses:align(mv[j].slice(1))}); }
  return {dates:m.dates,n:m.n,students:m.students,reg:reg,mk:mk};
}
function normalizeMakeupDates_(){
  var M=makeupSheet(); if(!M||M.getLastRow()<2) return;
  var n=M.getLastRow()-1, rng=M.getRange(2,4,n,1), vals=rng.getValues();
  rng.setNumberFormat("@");
  rng.setValues(vals.map(function(r){ return [toIso_(r[0])]; }));
}
function syncMakeupsToGrid(){
  makeupAll().forEach(function(m){
    var cid=m.to; if(!CLASSES[cid]) return;
    if(sessionsFor(cid).indexOf(m.date)<0) return;     // 非正規上課日（特殊日）→ 唔寫格
    if(!makeupStatus(cid,m.name,m.date)) markCell(cid,m.name,m.date,"補堂",true);
  });
}

/* ═══════════ Roster / 補堂 / Log ═══════════ */
function rosterRows(){
  var sh=SS().getSheetByName("Roster"), rows=[];
  if(sh && sh.getLastRow()>1){
    rows=sh.getRange(2,1,sh.getLastRow()-1,5).getValues()
      .map(function(r){ return {name:String(r[0]).trim(), last4:String(r[1]), cid:String(r[2]), dayZh:String(r[3]), time:String(r[4])}; })
      .filter(function(r){ return r.name; });
  }
  // 自癒：可回歸學生若未喺名冊 → 用 PHONE 補返（可登入、無班別），毋須先跑 setup
  (typeof RETURNABLE!=="undefined"?RETURNABLE:[]).forEach(function(nm){
    if(!rows.some(function(r){ return r.name===nm; }) && PHONE[nm])
      rows.push({name:nm, last4:pad4(PHONE[nm]), cid:"", dayZh:"", time:""});
  });
  return rows;
}
function makeupSheet(){ return SS().getSheetByName("補堂"); }
function makeupAll(){
  var sh=makeupSheet(); if(!sh||sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,5).getValues().map(function(r,i){
    return {row:i+2, name:String(r[0]), from:String(r[1]), to:String(r[2]), date:toIso_(r[3]), status:String(r[4]||"")};
  });
}
// 計數/顯示專用：按 name|from|to|date 去重（補堂表可能有重複行 → 一筆補堂被當成多筆，
// 令待補(owed)被扣爆、預約被拒）。保留首次出現嗰行嘅 row。
// ⚠️ 涉及 row 號嘅寫入（取消補堂）仍要用 makeupAll()。
function makeupUniq_(){
  var seen={}, out=[];
  makeupAll().forEach(function(m){
    var k=m.name+"|"+m.from+"|"+m.to+"|"+m.date;
    if(seen[k]) return; seen[k]=1; out.push(m);
  });
  return out;
}
function logAppend(a){
  var L=SS().getSheetByName("Log"); if(!L) return;
  L.appendRow([new Date(), a.name, a.key||"", a.action, a.date||"", a.status||"",
    a.eligible===undefined?"":a.eligible, a.to||"", a.toDate||""]);
}

/* 補堂可選時段：同一套課程 → 可去任何其他班別時段 */
function makeupSlotsFor(cid){
  return CLASS_IDS.filter(function(k){ return k!==cid; }).map(function(k){
    var c=CLASSES[k]; return {key:k, dayZh:c.dayZh, time:c.time};
  });
}

/* ═══════════ Web App ═══════════ */
function doGet(e){
  var p=(e&&e.parameter)||{};
  if(p.action){ var out; try{ out=route(p); }catch(err){ reportError_("#4 doGet "+(p.action||""), err); out={ok:false,err:String(err)}; }
    return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON); }
  return ContentService.createTextOutput("INITIATE SPORTS API "+VERSION+" OK");
}
function doPost(e){
  var p={}; try{ p=JSON.parse(e.postData.contents); }catch(err){}
  var out; try{ out=route(p); }catch(err){ reportError_("#4 doPost "+(p&&p.action||""), err); out={ok:false,err:String(err)}; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
/* ═══════════ 統一錯誤通報：後端一出 exception 自動 email 老闆（節流防洗信）═══════════ */
function reportError_(where, err){
  try{
    var sig=String((err&&err.stack)||err).slice(0,140).replace(/\s+/g," ");
    var c=CacheService.getScriptCache();
    var k="errmail_"+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig)).slice(0,24);
    if(c.get(k)) return;                              // 同類錯誤 15 分鐘內唔重複寄
    if(Number(c.get("errmail_cap")||0)>=6) return;    // 全域每小時最多 6 封
    c.put(k,"1",900); c.put("errmail_cap", String(Number(c.get("errmail_cap")||0)+1), 3600);
    MailApp.sendEmail("initiatesports6331@gmail.com",
      "🛑 INITIATE 系統錯誤（"+where+"）",
      "後端發生錯誤，已自動記錄：\n\n位置："+where+"\n\n"+String((err&&err.stack)||err)+
      "\n\n時間："+Utilities.formatDate(new Date(), tz(), "yyyy-MM-dd HH:mm:ss")+
      "\n\n（同類錯誤 15 分鐘內只會通知一次）");
  }catch(e){ Logger.log("reportError_ 失敗："+e); }
}
function route(p){
  switch(p.action){
    case "ping":            return {ok:true, version:VERSION};
    case "login":           return apiLogin(p);
    case "applyLeave":      return apiLeave(p);
    case "cancelLeave":     return apiCancelLeave(p);
    case "bookMakeup":      return apiMakeup(p);
    case "cancelMakeup":    return apiCancelMakeup(p);
    case "dailyList":       return apiDaily(p);
    case "markAttendance":  return apiMark(p);
    case "cancelDay":       return apiCancelDay(p);
    case "cancelDayFree":   return apiCancelDayFree(p);
    case "cleanupGrids":    return apiCleanupGrids(p);
    case "uploadMedNote":   return apiUploadMedNote(p);
    // ── 繳費（Phase 1）──
    case "genPeriod":       return apiGenPeriod(p);
    case "applyRosterChanges": return apiApplyRosterChanges(p);
    case "recoverPayments": return apiRecoverPayments(p);
    case "setMakeupDeadline": return apiSetMakeupDeadline(p);
    case "cleanupDupMakeup": return apiCleanupDupMakeup(p);
    case "payUpload":       return apiPayUpload(p);
    case "payLookup":       return apiPayLookup(p);
    case "payUploadOpen":   return apiPayUploadOpen(p);
    case "payUploadFamily": return apiPayUploadFamily(p);
    case "verifyPay":       return apiVerifyPay(p);
    case "setFeeAdj":       return apiSetFeeAdj(p);
    case "feesAll":         return apiFeesAll(p);
    // ── 推薦優惠 ──
    case "addReferral":     return apiAddReferral(p);
    case "applyReferral":   return apiApplyReferral(p);
    case "referralsAll":    return apiReferralsAll(p);
    // ── 通知 ──
    case "addNotice":       return apiAddNotice(p);
    case "notices":         return apiNotices(p);
    case "deleteNotice":    return apiDeleteNotice(p);
    // ── 上課地點 ──
    case "setVenue":        return apiSetVenue(p);
    case "venuesAdmin":     return apiVenuesAdmin(p);
    case "weeklyText":      return apiWeeklyText(p);
    // ── 匯出 ──
    case "export":          return apiExport(p);
    // ── 加操 ──
    case "addSession":      return apiAddSession(p);
    case "addonUpload":     return apiAddonUpload(p);
    case "addonVerify":     return apiAddonVerify(p);
    case "addonsAll":       return apiAddonsAll(p);
    case "coachAddSession": return apiCoachAddAddon(p);
    case "coachTransfer":   return apiCoachTransfer(p);
    case "transfersAll":    return apiTransfersAll(p);
    // ── 教練登入 ──
    case "coachLogin":      return apiCoachLogin(p);
    // ── 自訂登入密碼 ──
    case "setPin":          return apiSetPin(p);
    // 公開:只回公眾假期(非敏感),畀家長頁顯示假期用,毋須登入。
    case "holidays":        return apiHolidays(p);
    // ── 私人訓練（與恆常班分開；只記上課日，無請假補堂）──
    case "pt_coach_load":   return apiPtCoachLoad(p);
    case "pt_mark":         return apiPtMark(p);
    case "pt_undo":         return apiPtUndo(p);
    // ── B 相容 ──
    case "load":            return apiLoad(p);
    case "save_attendance": return apiSaveAttendance(p);
    case "save_absences":   return apiSaveAbsences(p);
    case "save_settings":   return apiSaveSettings(p);
    // ── 退出學生回歸 ──
    case "returnPay":       return apiReturnPay(p);
    case "returnVerify":    return apiReturnVerify(p);
    case "returnsAll":      return apiReturnsAll(p);
    // ── 老闆控制台營運快照（教練密碼）──
    case "opsSnapshot":     return apiOpsSnapshot(p);
    case "health":          return apiHealth(p);   // 教練密碼保護：即場全面健康檢查，回問題清單
    default:                return {ok:false, err:"unknown action"};
  }
}

/* ═══════════ 家長：一個小朋友全部班別資料 ═══════════ */
function classesFor_(nm){
  var rows=rosterRows().filter(function(r){ return r.name===nm; });
  var mk=makeupUniq_().filter(function(m){ return m.name===nm; });
  var dlMap=dlExtMap_();
  var abs11all=is11_().abs;
  return rows.map(function(r){
    var cid=r.cid, blk=readBlockMerged_(cid), st=blk.status[nm]||[];
    // 回歸／插班生：入班日之前嘅堂唔屬於佢 → 由 dates+status 一齊剔走，
    // 令出席統計、待補、限期、補堂全部由入班日起計（家長端完全唔會見到入班前嘅堂）。
    var _ji=joinIso_(nm);
    if(_ji){
      var _keep=[]; blk.dates.forEach(function(d,i){ if(d>=_ji) _keep.push(i); });
      var _dates=_keep.map(function(i){ return blk.dates[i]; });
      var _status={}; Object.keys(blk.status).forEach(function(k){ var s=blk.status[k]||[]; _status[k]=_keep.map(function(i){ return s[i]; }); });
      blk={dates:_dates, n:_dates.length, students:blk.students, status:_status};
      st=blk.status[nm]||[];
    }
    var att=0,lv=0,ab=0;
    st.forEach(function(s){ if(s==="出席"||s==="補堂")att++; else if(s==="請假")lv++; else if(s==="缺席")ab++; });
    // 補堂來源：#11 absences 已補（madeUpDate）+ 家長經 is-parent 預約嘅 #4 補堂
    var abs11=abs11all.filter(function(a){ return a.name===nm && a.cid===cid; });
    var done11=abs11.filter(function(a){ return a.madeUpDate; });
    var mk4=mk.filter(function(m){ return m.from===cid; });   // mk 已由 makeupUniq_ 去重
    // 剔走遷移自 #11「已補」嘅重複列（importParentData 寫入，補去班 to 可能=本班/留空/原班）：
    // 同一筆已補堂喺 done11 已表示一次，唔可以再喺 mk4 顯示／計多一次，否則家長補堂清單重複、出席多計、owed 被多扣。
    var done11Dates={}; done11.forEach(function(a){ done11Dates[a.madeUpDate]=true; });
    var mk4real=mk4.filter(function(m){
      var migratedDone = done11Dates[m.date] && (!m.to || m.to===cid || m.to===m.from);
      return !migratedDone;
    });
    var mkInfo=done11.map(function(a){ return {to:cid, date:a.madeUpDate, status:"出席", from:a.absDate}; })   // #11 已補：確實知道原請假日
      .concat(mk4real.map(function(m){
        var onGrid = CLASSES[m.to] && sessionsFor(m.to).indexOf(m.date)>=0;
        var stt = onGrid ? (makeupStatus(m.to,nm,m.date)||"補堂") : (m.status||"補堂");
        return {to:m.to, date:m.date, status:stt, from:""};   // 下面按順序配對原請假日
      }));
    // 為新預約補堂(mk4real)配對原請假日：本班未被 #11 已補佔用嘅請假，按時間最舊先補（與 apiMakeup 一致）
    var doneAbsSet={}; done11.forEach(function(a){ doneAbsSet[a.absDate]=true; });
    var leaveDates=[];
    abs11.forEach(function(a){ if(!a.madeUpDate && !doneAbsSet[a.absDate] && leaveDates.indexOf(a.absDate)<0) leaveDates.push(a.absDate); });
    st.forEach(function(s,i){ if(s==="請假"){ var dd=blk.dates[i]; if(!doneAbsSet[dd] && leaveDates.indexOf(dd)<0) leaveDates.push(dd); } });
    leaveDates.sort();
    mkInfo.filter(function(x){ return !x.from; }).sort(function(a,b){ return a.date<b.date?-1:1; })
      .forEach(function(x,i){ x.from=leaveDates[i]||""; });
    var mkAtt=mkInfo.filter(function(x){ return x.status==="出席"; }).length;
    var sessions=blk.dates.map(function(d,i){ return {date:d, status:st[i]||""}; });
    var deadline=blk.dates.length? blk.dates[blk.dates.length-1] : "";
    // 每筆請假補堂限期：以 #11 absences.deadline 為準，#4 自訂延長覆寫優先
    var mkExt={};
    abs11.forEach(function(a){ if(!a.madeUpDate && a.deadline) mkExt[a.absDate]=a.deadline; });
    st.forEach(function(s,i){ if(s!=="請假") return; var d=blk.dates[i], ov=dlMap[nm+"|"+cid+"|"+d]; if(ov) mkExt[d]=ov; });
    // ── 待補（owed）：#4 grid 為主、#11 absences 補歷史限期 ──
    // 遷移後 #4 grid 係出席真相；#11 absences 仍保留歷史請假嘅補堂限期(deadline)。
    // 待補 = #11 未補嘅缺堂（madeUpDate 空）
    //          ＋ #4 grid 顯示「請假」但 #11 未有對應 absences 紀錄嘅堂（日後 #4-only 新請假，避免重複）
    //          － 經 is-parent 預約嘅 #4 補堂（mk4），不論已出席或待出席都各抵銷一節待補。
    //            （done11 已出席嘅 #11 補堂唔再減，因為佢哋已喺 pendingAbs11 用 madeUpDate 扣除咗，避免重複。）
    // 對賬 #4 真相：#11 標「未補缺席」但 #4 本班 grid 該堂顯示已出席/補堂/豁免/停課 → 該筆已解決
    // （教練後來改咗、或學生實際有上／獲豁免），唔可以再當待補，否則家長 owed 偏高、見到唔存在嘅待補堂。
    // #4 grid 空白（純 #11 歷史）或仍標「請假」嘅，照當未補堂計。
    var stByDate={}; blk.dates.forEach(function(d,i){ stByDate[d]=st[i]||""; });
    var RESOLVED11_={"出席":1,"補堂":1,"豁免":1,"停課":1};
    var today_=todayIso();
    // 該請假日嘅有效補堂限期（優先：自訂延長 dlMap > #11 原限期 > 缺席日+MAKEUP_MONTHS）；< 今日 = 已過期。
    var effDl_=function(d, stored){ return dlMap[nm+"|"+cid+"|"+d] || stored || addMonthsIso(d, CONFIG.MAKEUP_MONTHS); };
    var pendingAbs11=abs11.filter(function(a){
      if(a.madeUpDate) return false;                          // #11 已補
      var g=stByDate[a.absDate];                              // 該缺席日喺 #4 本班 grid 嘅真相狀態
      if(g!==undefined && RESOLVED11_[g]) return false;       // #4 顯示已出席/豁免等 → 已解決，唔計待補
      if(effDl_(a.absDate, a.deadline) < today_) return false; // 限期已過 → 唔再當待補（老闆定：過期 owed 歸 0）
      return true;
    }).length;
    var absDateSet={}; abs11.forEach(function(a){ absDateSet[a.absDate]=true; });
    var extraLeaves=0; st.forEach(function(s,i){ if(s==="請假" && !absDateSet[blk.dates[i]] && effDl_(blk.dates[i])>=today_) extraLeaves++; });
    // booked4：真正由本班「新預約」出去嘅補堂（已用 mk4real 剔走遷移重複列，不論已/待出席各抵銷一節待補）。
    //   真正 is-parent 新預約 to 必為另一班，不受 migratedDone 剔除影響（羅靖誼個案已修：唔再被殘留 to="" 列抵銷）。
    var booked4=mk4real.length;
    var owed=Math.max(0, pendingAbs11 + extraLeaves - booked4);
    return {key:cid, sport:cid, wd:r.dayZh, dayZh:r.dayZh, time:r.time,
      total:blk.dates.length, attended:att+mkAtt, leave:lv, absent:ab,
      owed:owed, sessions:sessions, makeups:mkInfo, deadline:deadline, mkExt:mkExt};
  });
}
/* ═══════════ 登入防爆破節流（CacheService，按帳號計失敗次數）═══════════ */
function rlBlocked_(bucket, max){ return Number(CacheService.getScriptCache().get("rl_"+bucket)||0) >= max; }
function rlBump_(bucket, ttlSec){ var c=CacheService.getScriptCache(), k="rl_"+bucket; c.put(k, String(Number(c.get(k)||0)+1), ttlSec); }
function rlClear_(bucket){ CacheService.getScriptCache().remove("rl_"+bucket); }

function apiLogin(p){
  var want=pad4(p.last4), nm=String(p.name).trim();
  if(rlBlocked_("login_"+nm, 12)) return {ok:false, err:"嘗試太多次，請約 5 分鐘後再試"};
  var all=rosterRows();
  // 配對：輸入碼須等於該家庭「有效憑證」（有自訂密碼用密碼，否則用電話後4位）
  var hit=all.filter(function(r){ return r.name===nm && r.last4!==""; })
            .filter(function(r){ return effectiveCred_(pad4(r.last4))===want; });
  if(!hit.length){ rlBump_("login_"+nm, 300); return {ok:false, err:"搵唔到，請檢查中文全名同登入密碼（首次登入用手機後4位；如已設定自訂密碼請用自訂密碼）"}; }
  rlClear_("login_"+nm);
  var fam=pad4(hit[0].last4);   // 內部家庭鍵＝名冊電話後4位（不變）
  // 防資料洩漏：同一後4位再加「姓氏首字」先當同一家庭。兩個唔同家庭撞同一手機後4位（如黃玥晴/劉家頤同為5352）
  //            時，淨靠後4位會錯誤把對方小朋友當成自己仔女顯示。兄弟姊妹必同姓同後4位，故加姓氏唔影響正常家庭。
  var surn=String(hit[0].name).trim().charAt(0);
  var names=[]; all.forEach(function(r){ if(r.last4!=="" && pad4(r.last4)===fam && String(r.name).trim().charAt(0)===surn && names.indexOf(r.name)<0) names.push(r.name); });
  var children=names.map(function(cn){ var cl=classesFor_(cn);
    return {name:cn, classes:cl, fees:feesFor_(cn), addons:addonsFor_(cn), referralBalance:referralBalance_(cn), transfers:transfersFor_(cn), pt:null,
      returnable:(cl.length===0 && RETURNABLE.indexOf(cn)>=0)}; });
  // 私人訓練：當成可揀嘅獨立「學生」加入 children（家長可喺頂部揀）。同名加「⭐私訓」標籤以資識別。
  PT_STUDENTS.forEach(function(s){
    if(names.indexOf(s.family)<0) return;          // 該家庭名下冇此私訓學員
    var sum=ptSummary_(s.name); if(!sum) return;
    var dispName=(s.name===s.family)?(s.name+" ⭐私訓"):s.name;
    children.push({name:dispName, classes:[], fees:[], addons:[], referralBalance:0, transfers:[], pt:sum, ptOnly:true, returnable:false});
  });
  return {ok:true, family:{last4:fam, hasPin:!!pinFor_(fam)}, children:children,
    student:{name:nm,last4:fam}, classes:children.length?children[0].classes:[],
    payNumber:CONFIG.PAY_NUMBER, notices:noticesRecent_(6), summerBridge:summerBridgeOn_(),
    venues:venueMap_(),
    retFees:{f1:RET_FEE_1, f2:RET_FEE_2}, nextPeriod:nextPeriodLabel_()};
}

/* ═══════════ 請假 / 取消請假 ═══════════ */
function apiLeave(p){
  var cid=p.key; if(!CLASSES[cid]) return {ok:false,err:"班別不存在"};
  if(!authParent_(p.name,p.code)) return {ok:false,err:"登入碼不正確，無法操作"};
  var date=toIso_(p.date), today=todayIso(), type=p.leaveType||"", sameDay=(date===today);
  var per=periodLabelFromIso_(date);
  if(!periodPaid_(p.name,per)) return {ok:false, locked:true, err:"請先繳付 "+per+" 學費，方可申請請假"};
  // 病假只適用於當日；提前請病假 → 一律當「提前事假」處理（請假可補、不需醫生紙）
  var effType=type;
  if(type==="病假" && !sameDay) effType="事假";
  // 事假：須最少提前一日；當日不可請事假（前端亦會攔，後端為權威）
  if(effType==="事假" && sameDay){
    return {ok:false, blocked:true, sameDay:true,
      err:"當天不可請事假（須最少提前一日）。若當日缺席，將照常扣一節課、不設補堂。"};
  }
  // 允許情況（提前事假 / 提前病假按事假 / 當日病假）一律記「請假」（可補）
  writeStatus_(cid,p.name,date,"請假");
  var pendingCert=false, certDeadline="";
  if(effType==="病假" && sameDay){          // 只有當日病假才需 48 小時內交醫生證明
    pendingCert=true; certDeadline=addPendingCert_(p.name,cid,date);
  }
  var asAdvance=(type==="病假" && !sameDay);  // 提前病假被當作提前事假
  logAppend({name:p.name,key:cid,action:"leave",date:date,
    status:"請假("+type+(asAdvance?"→按事假":"")+")"+(pendingCert?"·待證明":""), eligible:true});
  notify("【請假】"+p.name, p.name+"\n班別："+classLabel_(cid)+"\n日期："+date+"\n假別："+type
    +(asAdvance?"（提前病假，已按提前事假處理）":"")
    +"\n結果："+(pendingCert
      ?("可補堂；但須於 48 小時內（"+certDeadline+" 前）上傳醫生證明，否則改計缺席、扣一堂、不設補堂")
      :"可補堂（格內已標請假）"));
  return {ok:true, eligible:true, pendingCert:pendingCert, certDeadline:certDeadline, treatedAs:effType, asAdvance:asAdvance};
}
function writeStatus_(cid,name,dateIso,status){ return markCell(cid,name,dateIso,status,false); }
function apiCancelLeave(p){
  if(!authParent_(p.name,p.code)) return {ok:false,err:"登入碼不正確，無法操作"};
  var cid=p.key; if(!CLASSES[cid]) return {ok:false,err:"班別不存在"};
  if(sessionsFor(cid).indexOf(p.date)<0) return {ok:false,err:"並非此班上課日"};
  if(String(p.date)<todayIso()) return {ok:false,err:"課堂已過，無法取消請假"};
  var blk=readBlock(cid), st=blk.status[p.name]||[], di=blk.dates.indexOf(p.date);
  var cur=di>=0?String(st[di]||""):"";
  if(cur!=="請假" && cur!=="缺席") return {ok:false,err:"此堂並非請假狀態，毋須取消"};
  writeStatus_(cid,p.name,p.date,"");
  try{ removePendingCert_(p.name,cid,p.date); }catch(e){}   // 同時清病假待證明，免日後 false「逾期」通知
  logAppend({name:p.name,key:cid,action:"cancelLeave",date:p.date,status:"取消請假(原:"+cur+")"});
  notify("【取消請假】"+p.name, p.name+"\n班別："+classLabel_(cid)+"\n日期："+p.date+"\n已還原為正常出席（未上）。");
  return {ok:true};
}

/* ═══════════ 補堂 / 取消補堂 ═══════════ */
function apiMakeup(p){
  var toCid=p.toKey, date=toIso_(p.toDate);
  if(!CLASSES[toCid]) return {ok:false,err:"目標班別不存在"};
  if(!authParent_(p.name,p.code)) return {ok:false,err:"登入碼不正確，無法操作"};
  if(holidaysSet()[date]) return {ok:false,err:"該日為假期／停課日（如 7/1），不能補堂，請另揀日期"};
  // 註：補堂係補返「已付款嘅缺席」，2個月限期由下面 effDeadline_ 把關，
  //     故唔再用補堂目標日期所屬期嘅學費作閘（即使補去未繳費嘅下一期都照畀預約）。
  var dup=makeupAll().some(function(m){ return m.name===p.name && m.from===p.fromKey && m.to===p.toKey && m.date===date; });
  if(dup) return {ok:true, dup:true};
  // 限期檢查：今次補堂對應「最舊未補嘅缺席」，須喺該缺席日 +N 個月內（#9）
  if(CLASSES[p.fromKey]){
    var fb=readBlock(p.fromKey), fst=fb.status[p.name]||[], fd=fb.dates, lv=[];
    fst.forEach(function(s,i){ if(s==="請假") lv.push(fd[i]); });
    lv.sort();
    // madeUp 要同前端 owed(mk4real) 一致：剔走由 #11 遷移嘅「已補」歷史補堂（madeUpDate 對應 #11 absence、
    // to 為本班/空）。否則歷史補堂會誤當佔咗本班待補額，令真正待補（如新一次請假）申請被拒（羅靖誼個案）。
    var done11D={}; is11_().abs.forEach(function(a){ if(a.name===p.name && a.cid===p.fromKey && a.madeUpDate) done11D[a.madeUpDate]=true; });
    var madeUp=makeupUniq_().filter(function(m){
      if(m.name!==p.name || m.from!==p.fromKey) return false;
      var migratedDone = done11D[m.date] && (!m.to || m.to===p.fromKey || m.to===m.from);
      return !migratedDone;
    }).length;
    if(madeUp>=lv.length) return {ok:false,err:"此班暫無待補堂節數"};
    var absDate=lv[madeUp], dl=effDeadline_(p.name, p.fromKey, absDate);
    if(date>dl) return {ok:false,err:"已超過補堂限期：須於 "+dl+" 或之前補堂"};
  }
  var onGrid = sessionsFor(toCid).indexOf(date)>=0;
  if(onGrid) markCell(toCid,p.name,date,"補堂",true);
  var M=makeupSheet(), row=M.getLastRow()+1;
  M.getRange(row,4).setNumberFormat("@");
  M.getRange(row,1,1,5).setValues([[p.name, p.fromKey, p.toKey, date, onGrid?"格":"補堂"]]);
  logAppend({name:p.name,key:p.fromKey,action:"makeup",to:p.toKey,toDate:date,status:"補堂"});
  var mkSameDay=(date===todayIso());
  notify((mkSameDay?"【今日有補堂】":"【補堂】")+p.name, p.name+"\n原班："+classLabel_(p.fromKey)+"\n補去："+classLabel_(toCid)+"　"+date
    + (mkSameDay?"\n⚠️ 今日（"+date+"）有學生前嚟補堂，請於今日點名表留意。":"\n（已加入該班該日點名表）"));
  return {ok:true};
}
function apiCancelMakeup(p){
  if(!authParent_(p.name,p.code)) return {ok:false,err:"登入碼不正確，無法操作"};
  var toCid=p.toKey, date=toIso_(p.toDate);
  var all=makeupAll(), hit=null;
  for(var i=0;i<all.length;i++){ var m=all[i];
    if(m.name===p.name && m.from===p.fromKey && m.to===p.toKey && m.date===date){ hit=m; break; } }
  if(!hit) return {ok:false,err:"搵唔到呢個補堂紀錄"};
  var onGrid = CLASSES[toCid] && sessionsFor(toCid).indexOf(date)>=0;
  var stt = onGrid ? (makeupStatus(toCid,p.name,date)||"補堂") : (hit.status||"補堂");
  if(stt==="出席"||stt==="缺席") return {ok:false,err:"此補堂已"+stt+"，無法取消"};
  if(String(date)<todayIso()) return {ok:false,err:"補堂日已過，無法取消"};
  if(onGrid){ markCell(toCid,p.name,date,"",false); try{ clearStrayMakeupRow_(toCid,p.name); }catch(e){} }
  makeupSheet().deleteRow(hit.row);
  logAppend({name:p.name,key:p.fromKey,action:"cancelMakeup",to:p.toKey,toDate:date,status:"取消補堂"});
  notify("【取消補堂】"+p.name, p.name+"\n原班："+classLabel_(p.fromKey)+"\n原補去："+classLabel_(toCid)+"　"+date+"\n已取消。");
  return {ok:true};
}
function classLabel_(cid){ var c=CLASSES[cid]; return c? (c.dayZh+" "+c.time) : cid; }

/* ═══════════ 醫生紙上載（病假，存 Drive）═══════════ */
function medNotesSheet(){ return SS().getSheetByName("MedNotes"); }
function medNotesAll(){
  var sh=medNotesSheet(); if(!sh||sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,4).getValues().map(function(r){
    return {name:String(r[0]), classId:String(r[1]), date:toIso_(r[2]), link:String(r[3])};
  }).filter(function(x){ return x.name && x.link; });
}
function apiUploadMedNote(p){
  if(!authParent_(p.name,p.code)) return {ok:false,err:"登入碼不正確，無法操作"};
  try{
    var dataUrl=String(p.dataUrl||""); var comma=dataUrl.indexOf(",");
    if(comma<0) return {ok:false,err:"檔案格式不正確"};
    var meta=dataUrl.slice(0,comma), b64=dataUrl.slice(comma+1);
    var ctMatch=meta.match(/data:(.*?);/); var ct=ctMatch?ctMatch[1]:"image/jpeg";
    var ext=ct.indexOf("pdf")>=0?"pdf":(ct.indexOf("png")>=0?"png":"jpg");
    var fname=(p.name||"醫生紙")+"_"+classLabel_(p.key)+"_"+toIso_(p.date)+"."+ext;
    var folders=DriveApp.getFoldersByName("IS 醫生紙");
    var folder=folders.hasNext()?folders.next():DriveApp.createFolder("IS 醫生紙");
    var blob=Utilities.newBlob(Utilities.base64Decode(b64), ct, fname);
    var file=folder.createFile(blob);
    try{ file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }catch(e){}
    var link=file.getUrl();
    var MN=medNotesSheet();
    if(MN){ var row=MN.getLastRow()+1; MN.getRange(row,3).setNumberFormat("@");
      MN.getRange(row,1,1,5).setValues([[p.name, p.key, toIso_(p.date), link, new Date()]]); }
    logAppend({name:p.name,key:p.key,action:"medNote",date:toIso_(p.date),status:"上載醫生紙"});
    try{ resolvePendingCert_(p.name, p.key, toIso_(p.date)); }catch(e){}
    notify("【醫生紙】"+p.name, p.name+"\n班別："+classLabel_(p.key)+"\n日期："+toIso_(p.date)+"\n醫生證明："+link);
    return {ok:true, link:link};
  }catch(e){ return {ok:false, err:"上載失敗："+(e&&e.message||e)}; }
}

/* ═══════════ 病假待證明（當日病假 48 小時內須交醫生證明，否則改計缺席）═══════════ */
function pendingCertSheet(){
  var sh=SS().getSheetByName("病假待證明");
  if(!sh){ sh=SS().insertSheet("病假待證明");
    sh.getRange(1,1,1,5).setValues([["姓名","班別","日期","限期","狀態"]]);
    sh.setFrozenRows(1); }
  return sh;
}
// 移除某生某堂「待證明」嘅病假待證明列（取消病假時用，免日後 false「逾期」通知）
function removePendingCert_(name,cid,dateIso){
  var sh=pendingCertSheet(); if(sh.getLastRow()<2) return;
  var vals=sh.getRange(2,1,sh.getLastRow()-1,5).getValues();
  for(var i=vals.length-1;i>=0;i--){
    if(String(vals[i][0]).trim()===String(name).trim() && String(vals[i][1]).trim()===String(cid).trim()
       && toIso_(vals[i][2])===toIso_(dateIso) && String(vals[i][4])==="待證明") sh.deleteRow(i+2);
  }
}
function addPendingCert_(name,cid,dateIso){
  var sh=pendingCertSheet();
  var dl=new Date(); dl.setHours(dl.getHours()+48);
  var dlStr=Utilities.formatDate(dl, tz(), "yyyy-MM-dd HH:mm");
  var row=sh.getLastRow()+1;
  sh.getRange(row,3).setNumberFormat("@"); sh.getRange(row,4).setNumberFormat("@");
  sh.getRange(row,1,1,5).setValues([[name,cid,dateIso,dlStr,"待證明"]]);
  return dlStr;
}
function resolvePendingCert_(name,cid,dateIso){
  var sh=pendingCertSheet(); if(sh.getLastRow()<2) return;
  var rng=sh.getRange(2,1,sh.getLastRow()-1,5), vals=rng.getValues(), changed=false;
  for(var i=0;i<vals.length;i++){
    if(String(vals[i][0])===name && String(vals[i][1])===cid
       && toIso_(vals[i][2])===dateIso && String(vals[i][4])==="待證明"){
      vals[i][4]="已收證明"; changed=true; }
  }
  if(changed) rng.setValues(vals);
}
/* 每小時執行：逾 48 小時仍未交證明 → 若格仍為「請假」則改「缺席」（教練已改則尊重）*/
function enforceSickCert(){
  var sh=pendingCertSheet(); if(sh.getLastRow()<2) return;
  var rng=sh.getRange(2,1,sh.getLastRow()-1,5), vals=rng.getValues();
  var notes=medNotesAll(), nowStr=nowStamp_(), changed=false;   // nowStr 為香港當前時間
  for(var i=0;i<vals.length;i++){
    var nm=String(vals[i][0]), cid=String(vals[i][1]), date=toIso_(vals[i][2]),
        dlStr=String(vals[i][3]), stt=String(vals[i][4]);
    if(stt!=="待證明") continue;
    var got=notes.some(function(x){ return x.name===nm && x.classId===cid && x.date===date; });
    if(got){ vals[i][4]="已收證明"; changed=true; continue; }
    // 限期同為「yyyy-MM-dd HH:mm」香港時間，字串比較即等於時間比較
    if(dlStr && nowStr>dlStr){
      var blk=readBlock(cid), st=blk.status[nm]||[], di=blk.dates.indexOf(date);
      var cur=di>=0?String(st[di]||""):"";
      if(cur==="請假"){ writeStatus_(cid,nm,date,"缺席"); }
      vals[i][4]="逾期改缺席"; changed=true;
      logAppend({name:nm,key:cid,action:"sickExpire",date:date,status:"病假逾期未交證明→缺席"});
      notify("【病假逾期】"+nm, nm+"\n班別："+classLabel_(cid)+"\n日期："+date
        +"\n48 小時內未上傳醫生證明 → 已改計缺席、扣一堂、不設補堂。");
    }
  }
  if(changed) rng.setValues(vals);
}
function ensureSickCertTrigger(){
  try{
    var has=ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction()==="enforceSickCert"; });
    if(!has) ScriptApp.newTrigger("enforceSickCert").timeBased().everyHours(1).create();
  }catch(e){}
}
/* 教練／管理：確認「離線」收到某生某堂病假紙（家長私下交、冇上傳系統）。
 * → 該堂改回「請假」(可補)；「病假待證明」標「已收證明（教練離線確認）」，
 *   令 enforceSickCert 唔再當逾期、唔再扣堂。先自動備份。*/
function markSickCertReceived_(name, cid, dateIso){
  name=String(name).trim(); cid=String(cid).trim(); dateIso=toIso_(dateIso);
  backup();
  var cur="";
  try{ var b=readBlock(cid), st=b.status[name]||[], di=b.dates.indexOf(dateIso); cur=di>=0?String(st[di]||""):""; }catch(e){}
  writeStatus_(cid, name, dateIso, "請假");                 // 缺席/空白 → 請假（可補）
  var sh=pendingCertSheet(), flipped=false;
  if(sh.getLastRow()>=2){
    var rng=sh.getRange(2,1,sh.getLastRow()-1,5), vals=rng.getValues();
    for(var i=0;i<vals.length;i++){
      if(String(vals[i][0]).trim()===name && String(vals[i][1]).trim()===cid && toIso_(vals[i][2])===dateIso){
        vals[i][4]="已收證明（教練離線確認）"; flipped=true;
      }
    }
    if(flipped) rng.setValues(vals);
  }
  try{ logAppend({name:name,key:cid,action:"sickCertOffline",date:dateIso,status:"教練離線確認收病假紙→請假"}); }catch(e){}
  return {ok:true, from:cur, flipped:flipped};
}
function markSickCertReceivedMenu(){
  var ui=SpreadsheetApp.getUi();
  var r1=ui.prompt("確認已收病假紙（離線）","學生中文全名：",ui.ButtonSet.OK_CANCEL); if(r1.getSelectedButton()!==ui.Button.OK) return;
  var nm=r1.getResponseText().trim(); if(!nm) return;
  var r2=ui.prompt("班別代碼（如 c4）","",ui.ButtonSet.OK_CANCEL); if(r2.getSelectedButton()!==ui.Button.OK) return;
  var cid=r2.getResponseText().trim();
  var r3=ui.prompt("堂日期（YYYY-MM-DD）","",ui.ButtonSet.OK_CANCEL); if(r3.getSelectedButton()!==ui.Button.OK) return;
  var d=r3.getResponseText().trim();
  if(!CLASSES[cid]){ ui.alert("搵唔到班別："+cid); return; }
  var res=markSickCertReceived_(nm,cid,d);
  ui.alert("✅ "+nm+"｜"+cid+"｜"+d+"\n該堂已改回「請假」(可補)、病假待證明標「已收證明」。\n原狀態："+(res.from||"空白")+(res.flipped?"":"\n（注意：病假待證明搵唔到對應列，但格已改請假）")+"\n已先備份，可還原。");
}

/* ═══════════ 繳費（Phase 1：每期預繳、上傳截圖、教練核實）═══════════ */
function feeSheet(){
  var sh=SS().getSheetByName("繳費");
  if(!sh){ sh=SS().insertSheet("繳費");
    sh.getRange(1,1,1,14).setValues([["學生","期","每週堂數","應繳","推薦折扣","實際應繳","已繳","狀態","截圖","核實教練","核實時間","備註","調整","調整說明"]]);
    sh.setFrozenRows(1); }
  else if(sh.getRange(1,13).getValue()!=="調整"){   // 舊表自動升級
    sh.getRange(1,13,1,2).setValues([["調整","調整說明"]]);
  }
  return sh;
}
function feeRows_(){
  var sh=feeSheet(); if(sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,14).getValues().map(function(r,i){
    return {row:i+2, name:String(r[0]), period:String(r[1]), weekly:Number(r[2])||0,
      due:Number(r[3])||0, discount:Number(r[4])||0, net:Number(r[5])||0,
      paid:Number(r[6])||0, status:String(r[7]||""), link:String(r[8]||""),
      verifier:String(r[9]||""), verifyTime:String(r[10]||""), note:String(r[11]||""),
      adj:Number(r[12])||0, adjNote:String(r[13]||"")};
  }).filter(function(x){ return x.name && x.period; });
}
function weeklySessions_(nm){
  var cids={}; rosterRows().forEach(function(r){ if(r.name===nm && r.cid) cids[r.cid]=1; });
  return Object.keys(cids).length;
}
function feeAmount_(n){ return n>=2 ? CONFIG.FEE_2 : CONFIG.FEE_1; }
function feesFor_(nm){
  return feeRows_().filter(function(x){ return x.name===nm; }).map(function(x){
    var unit=(x.weekly>=2 ? PERIOD_RATE_2 : PERIOD_RATE_1);          // 每堂價：$130(一週一堂)/$110(一週兩堂)
    var sess=(x.due>0 && x.due%unit===0) ? x.due/unit : null;        // 實收堂數（應繳÷每堂價）
    // 特別安排固定學費（跨班／固定堂數，如周莉晶 c7+c3 共 8 堂）：只按指定堂數計，
    // 唔套標準班別順延豁免；否則會把名冊班別（c7）嘅 3 堂順延誤加成「原定 11」。
    var isCustom=!!((CUSTOM_FEE[x.period]||{})[x.name]);
    // 扣減（停課/順延）堂數 + 原定堂數：原定 = 實收 + 扣減（即扣減前本期應上幾多堂）
    var det=null; if(!isCustom){ try{ det=periodFeeDetail_(x.name, x.period); }catch(e){} }
    var deducted=det ? det.exemptDates.length : 0;
    var dnote=det ? periodExemptNote_(det) : x.note;
    var sched=(sess!=null) ? sess+deducted : null;
    return {period:x.period, weekly:x.weekly, due:x.due, discount:x.discount, adj:x.adj, adjNote:x.adjNote,
      net:x.net, paid:x.paid, status:x.status, hasScreenshot:!!x.link, note:dnote,
      unitPrice:unit, sessions:sess, deducted:deducted, scheduled:sched, custom:isCustom,
      active:(x.status==="已繳"||x.status==="豁免")};
  });
}
/* 期排序值（年×6＋雙月序）；用嚟分辨「本期及之前」vs「未來期」*/
function periodOrder_(label){
  var m=String(label).match(/(\d{4})\s*(\d{1,2})-/);
  if(!m) return 0; return Number(m[1])*6 + Math.floor((Number(m[2])-1)/2);
}
/* 某生某期是否已啟用：本期及之前（系統外已繳清）自動啟用；未來期則需已繳/豁免 */
function periodPaid_(nm, label){
  // 示範帳號（陳大文）：永遠當已繳，令每日健康檢查嘅寫入測試（請假/取消）唔會被學費閘攔住。
  try{ if(PT_STUDENTS.some(function(s){ return s.demo && (s.name===nm||s.family===nm); })) return true; }catch(e){}
  if(periodOrder_(label) <= periodOrder_(curPeriodLabel_())) return true;  // 3-6 月等本期及之前：自動啟用
  var rows=feeRows_().filter(function(x){ return x.name===nm && x.period===label; });
  if(!rows.length) return false;
  var x=rows[0];
  return x.status==="已繳" || x.status==="豁免" || x.net<=0;
}
function periodLabelFromIso_(isoStr){
  var y=isoStr.slice(0,4), mo=Number(isoStr.slice(5,7)), idx=Math.floor((mo-1)/2);
  return y+" "+(idx*2+1)+"-"+(idx*2+2)+"月";
}
function curPeriodLabel_(){ return periodLabelFromIso_(todayIso()); }
function nextPeriodLabel_(){
  var t=todayIso(), y=Number(t.slice(0,4)), mo=Number(t.slice(5,7)), idx=Math.floor((mo-1)/2)+1;
  if(idx>5){ idx=0; y++; }   // 跨年（11-12月 → 下年 1-2月）
  return y+" "+(idx*2+1)+"-"+(idx*2+2)+"月";
}
/* 期 → 該期第一個月 1 號（用作逾期判斷起點），格式 yyyy-MM-dd */
function periodStartIso_(label){
  var m=String(label).match(/(\d{4})\s*(\d{1,2})-/);
  if(!m) return "";
  var y=m[1], mo=("0"+m[2]).slice(-2); return y+"-"+mo+"-01";
}
/* 指定期之後嗰一期（如 2026 7-8月 → 2026 9-10月；11-12月 → 下年 1-2月） */
function periodAfter_(label){
  var m=String(label).match(/(\d{4})\s*(\d{1,2})-/); if(!m) return "";
  var y=Number(m[1]), idx=Math.floor((Number(m[2])-1)/2)+1;
  if(idx>5){ idx=0; y++; }
  return y+" "+(idx*2+1)+"-"+(idx*2+2)+"月";
}

/* ═══════════ 學費抵扣 ledger（停課退費等順延折扣；可重複套用、唔會被重算覆蓋）═══════════
   每筆：學生｜套用期｜金額(正數=要扣)｜原因｜時間。genPeriodNet_ 寫列時會自動扣減。*/
function creditSheet(){
  var sh=SS().getSheetByName("學費抵扣");
  if(!sh){ sh=SS().insertSheet("學費抵扣");
    sh.getRange(1,1,1,5).setValues([["學生","套用期","金額","原因","時間"]]);
    sh.setFrozenRows(1); sh.getRange("B:B").setNumberFormat("@"); }
  return sh;
}
function creditRows_(){
  var sh=creditSheet(); if(sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,5).getValues().map(function(r,i){
    return {row:i+2, name:String(r[0]||"").trim(), period:String(r[1]||"").trim(),
      amt:Number(r[2])||0, why:String(r[3]||""), at:String(r[4]||"")};
  }).filter(function(x){ return x.name && x.period; });
}
// 程式碼層額外抵扣：喺 學費抵扣 ledger 之外「再加」（特別課程退款等）。金額正數=要扣。
var EXTRA_CREDITS = {
  // 周莉晶 5-6月 c7 取消課程順延 3 堂 = $390（5/9、5/30、6/6）。先抵 7-8月固定收費尾數
  // $131（$1040−已繳$909）→ 7-8月清袋；剩 $390−$131 = $259 順延至 9-10月抵扣。
  "2026 7-8月": [
    {name:"黃朗程", amt:900, why:"6-7月特別課程退款"},
    {name:"鄭宇喬", amt:280, why:"6-7月特別課程退款"},
    {name:"周莉晶", amt:131, why:"5-6月 c7 取消順延抵繳本期尾數"}
  ],
  "2026 9-10月": [
    {name:"周莉晶", amt:259, why:"5-6月 c7 取消順延餘額（$390−$131）"}
  ]
};
function creditsFor_(nm,label){
  var t=0; creditRows_().forEach(function(x){ if(x.name===nm && x.period===label) t+=x.amt; });
  (EXTRA_CREDITS[label]||[]).forEach(function(e){ if(e.name===nm) t+=e.amt; });
  return t;
}
function creditNotesFor_(nm,label){
  var a=creditRows_().filter(function(x){ return x.name===nm && x.period===label; })
    .map(function(x){ return x.why+" -$"+x.amt; });
  (EXTRA_CREDITS[label]||[]).forEach(function(e){ if(e.name===nm) a.push(e.why+" -$"+e.amt); });
  return a.join("；");
}
// 加一筆抵扣（idempotent：同學生/期/原因已存在就唔重覆加）
function addCredit_(nm,label,amt,why){
  if(!nm||!label||!(amt>0)) return false;
  var dup=creditRows_().some(function(x){ return x.name===nm && x.period===label && x.why===why; });
  if(dup) return false;
  var sh=creditSheet(), row=sh.getLastRow()+1;
  sh.getRange(row,2).setNumberFormat("@");
  sh.getRange(row,1,1,5).setValues([[nm,label,amt,why,nowStamp_()]]);
  return true;
}
/* 內部：為所有在學學生產生某期應繳列（已存在則跳過）；供 setup 與 API 共用 */
/* ═══════════ 按淨堂計學費（順延豁免 / 個別豁免 / 額外收費）═══════════ */
// 期（雙月）窗口 [lo, hi)；hi = 期尾月之後嗰個月 1 號
function periodWindow_(label){
  var m=String(label).match(/(\d{4})\s*(\d{1,2})-(\d{1,2})/); if(!m) return null;
  var y=Number(m[1]), m1=Number(m[2]), m2=Number(m[3]);
  var lo=y+"-"+("0"+m1).slice(-2)+"-01";
  var hY=y, hM=m2+1; if(hM>12){ hM=1; hY++; }
  return {lo:lo, hi:hY+"-"+("0"+hM).slice(-2)+"-01"};
}
function isoInPeriod_(iso, label){ var w=periodWindow_(label); return !!w && iso>=w.lo && iso<w.hi; }
// 某班喺指定期（雙月）窗口內嘅實際上課堂數（受 sessionsFor 假期/停課/TERM_END 限制）
function sessionsInPeriod_(cid, label){
  var w=periodWindow_(label); if(!w) return 0;
  return sessionsFor(cid).filter(function(d){ return d>=w.lo && d<w.hi; }).length;
}
// 某生某期完整收費明細：淨堂 × 單堂價 ＋ 額外收費；附豁免日期供顯示
function periodFeeDetail_(nm, label){
  var cids=[]; rosterRows().forEach(function(r){ if(r.name===nm && r.cid && cids.indexOf(r.cid)<0) cids.push(r.cid); });
  if(!cids.length) return null;
  var rate=(cids.length>=2 ? PERIOD_RATE_2 : PERIOD_RATE_1);
  var ex=PERIOD_EXEMPT[label]||{byClass:{},byStudent:{}};
  var noCarry=((PERIOD_NO_CARRY[label]||[]).indexOf(nm)>=0);   // 本期新加入 → 唔享順延豁免
  var net=0, exemptDates=[];
  cids.forEach(function(cid){
    var n=sessionsInPeriod_(cid, label), cex=noCarry?[]:((ex.byClass||{})[cid]||[]);
    net += Math.max(0, n - cex.length);
    cex.forEach(function(d){ exemptDates.push({cid:cid, date:d, reason:"課程取消順延"}); });
  });
  ((ex.byStudent||{})[nm]||[]).forEach(function(e){
    net -= 1; exemptDates.push({cid:e.cid||cids[0], date:e.date, reason:e.reason||"豁免"});
  });
  // 顯示用：本期內「停課（不收費）」日期（已由 sessionsFor 扣咗，唔再影響 net，純粹話畀家長知邊日停咗）
  cids.forEach(function(cid){
    var cset=cancelledSet(cid);
    Object.keys(cset).forEach(function(dd){ if(isoInPeriod_(dd, label)) exemptDates.push({cid:cid, date:dd, reason:"停課不收費"}); });
  });
  if(net<0) net=0;
  var base=net*rate;
  var extras=((PERIOD_EXTRA[label]||{})[nm])||[];
  var extraTot=0; extras.forEach(function(e){ extraTot += Number(e.amt)||0; });
  return {nm:nm, weekly:cids.length, rate:rate, net:net, base:base, newJoin:noCarry,
          extras:extras, extraTot:extraTot, due:base+extraTot, exemptDates:exemptDates};
}
function periodExemptNote_(d){
  return d.exemptDates.map(function(e){ return classLabel_(e.cid)+" "+e.date+"（"+e.reason+"）"; }).join("；");
}
// 產生／更新某期「按淨堂計」收費列（已繳／豁免行唔郁）；dry=true 只試算記 log
function genPeriodNet_(label, dry, skipBackup){
  label=String(label).trim();
  var names=[]; rosterRows().forEach(function(r){ if(r.name && names.indexOf(r.name)<0) names.push(r.name); });
  if(!dry && !skipBackup) backup();   // 寫入前備份
  var sh=feeSheet(), rowMap={};
  feeRows_().forEach(function(x){ if(x.period===label) rowMap[x.name]={row:x.row, status:x.status}; });
  var lines=[], n_new=0, n_upd=0, n_skip=0, n_void=0;
  var voidList=PERIOD_VOID[label]||[];
  names.forEach(function(nm){
    // 強制豁免名單（本期暫停／退出）→ 設 $0，唔收費
    if(voidList.indexOf(nm)>=0){
      var hv=rowMap[nm];
      if(hv && hv.status!=="已繳"){
        if(!dry){ sh.getRange(hv.row,4,1,3).setValues([[0,0,0]]); sh.getRange(hv.row,8).setValue("豁免");
                  sh.getRange(hv.row,12).setValue("本期暫停，不收費"); sh.getRange(hv.row,13,1,2).setValues([[0,""]]); }
        n_void++; lines.push("🚫 "+nm+"：本期強制豁免 $0（暫停）");
      }
      return;
    }
    // 特別安排固定學費（跨班／固定堂數）→ 用固定 due，唔行標準自動計，保留已上傳付款進度
    var cf=(CUSTOM_FEE[label]||{})[nm];
    if(cf){
      var fixed=Number(cf.due)||0, hc=rowMap[nm], paid=Number(cf.paid)||0, scr="", vBy="", vAt="";
      // 順延抵扣（如上期取消課程順延）亦套落固定收費，否則 credit 會被寫死 due 食咗、靜靜消失。
      var ccredit=creditsFor_(nm,label);
      var due=Math.max(0, fixed-ccredit);              // 實際應繳 = 固定學費 − 抵扣
      if(hc){
        if(hc.status==="已繳"){ n_skip++; lines.push("⏭ "+nm+"（特別安排固定學費，已繳，略過）"); return; }
        var pc=sh.getRange(hc.row,7,1,5).getValues()[0];  // 7已繳/8狀態/9截圖/10核實/11時間
        if((Number(pc[0])||0)>paid || String(pc[2]||"")!==""){ paid=Number(pc[0])||paid; scr=pc[2]||""; vBy=pc[3]||""; vAt=pc[4]||""; }
      }
      var st = paid<=0 ? (scr?"待核實":"未繳") : (paid>=due ? "已繳" : (scr?"待核實":"部分"));
      var cAdj = ccredit>0 ? -ccredit : 0;
      var cAdjNote = (cf.adjNote||"") + (ccredit>0 ? ((cf.adjNote?"；":"")+"抵扣 "+creditNotesFor_(nm,label)) : "");
      // 欄4=固定學費(顯示堂數用)、欄6=實收(扣抵扣後)、欄13=調整(−抵扣)、欄14=調整說明
      var cv=[nm,label,cf.weekly||1,fixed,0,due,paid,st,scr,vBy,vAt,cf.note||"特別安排固定學費",cAdj,cAdjNote];
      if(!dry){
        if(hc){ sh.getRange(hc.row,2).setNumberFormat("@"); sh.getRange(hc.row,1,1,14).setValues([cv]); }
        else { var nrc=sh.getLastRow()+1; sh.getRange(nrc,2).setNumberFormat("@"); sh.getRange(nrc,1,1,14).setValues([cv]); }
      }
      if(hc) n_upd++; else n_new++;
      lines.push("⭐ "+nm+"：特別安排固定學費 $"+fixed+(ccredit>0?(" −抵扣$"+ccredit):"")+" = $"+due+"（已繳 $"+paid+(paid<due?("，待繳 $"+(due-paid)):"")+"）");
      return;
    }
    var d=periodFeeDetail_(nm, label); if(!d) return;   // 無在學班別（如暫停學生）→ 略過
    var disc=referralAutoDisc_(nm, d.base, 0);           // 保留推薦優惠（上限該期 base 50%）
    var credit=creditsFor_(nm, label);                   // 順延抵扣（停課退費等；ledger，重算唔會丟）
    var adjAmt=d.extraTot - credit;                      // 調整 = 額外收費 − 抵扣
    var net=Math.max(0, d.base - disc + adjAmt);
    var note=periodExemptNote_(d);
    if(d.newJoin && !note) note="本期新加入（收全費，不適用順延豁免）";
    var adjNote=d.extras.map(function(e){ return e.note+" $"+e.amt; })
      .concat(credit>0 ? ["抵扣 "+creditNotesFor_(nm,label)] : []).join("；");
    var vals=[nm, label, d.weekly, d.base, disc, net, 0, "未繳", "", "", "", note, adjAmt, adjNote];
    var line=nm+" | "+d.weekly+"班 淨"+d.net+"堂×$"+d.rate+"=$"+d.base+(disc?(" −優惠$"+disc):"")+(d.extraTot?(" +$"+d.extraTot):"")+(credit?(" −抵扣$"+credit):"")+" = $"+net;
    var hit=rowMap[nm];
    if(hit){
      if(hit.status==="已繳"||hit.status==="豁免"){ n_skip++; lines.push("⏭ "+line+"（"+hit.status+"，略過）"); return; }
      if(!dry){
        sh.getRange(hit.row,2).setNumberFormat("@");
        // ⚠️ 保留付款進度欄（7已繳/8狀態/9截圖/10核實教練/11核實時間）：家長已上傳截圖＝待核實，
        // 重算學費唔可以清走佢，否則教練端見唔到要核實（曾因此漏咗家長已交嘅截圖）。
        var pay=sh.getRange(hit.row,7,1,5).getValues()[0];
        var hasPay=(String(pay[1]||"")==="待核實"||String(pay[1]||"")==="部分"||(Number(pay[0])||0)>0||String(pay[2]||"")!=="");
        if(hasPay){ vals[6]=pay[0]; vals[7]=pay[1]; vals[8]=pay[2]; vals[9]=pay[3]; vals[10]=pay[4]; }
        sh.getRange(hit.row,1,1,14).setValues([vals]);
      }
      n_upd++; lines.push("✏ "+line);
    } else {
      if(d.base<=0){ return; }   // 該期未排堂（如超出學期窗）→ 唔建空列（抵扣留喺 ledger，排堂後先套用）
      if(!dry){ var nr=sh.getLastRow()+1; sh.getRange(nr,2).setNumberFormat("@"); sh.getRange(nr,1,1,14).setValues([vals]); }
      n_new++; lines.push("＋ "+line);
    }
  });
  // 清理：本期已存在、但學生已無在學班別（暫停／退出）嘅列 → 設豁免 $0，唔再向家長收費
  feeRows_().filter(function(x){ return x.period===label; }).forEach(function(x){
    if(periodFeeDetail_(x.name, label)) return;               // 有在學班別 → 上面已處理
    if(x.status==="已繳"||x.status==="豁免") return;            // 已繳／已豁免 → 唔郁
    if(!dry){
      sh.getRange(x.row,4,1,3).setValues([[0,0,0]]);          // 應繳/折扣/實際應繳 = 0
      sh.getRange(x.row,8).setValue("豁免");
      sh.getRange(x.row,12).setValue("暫停／退出學生，本期不收費");
      sh.getRange(x.row,13,1,2).setValues([[0,""]]);          // 調整/調整說明清零
    }
    n_void++; lines.push("🚫 "+x.name+"：無在學班別 → 本期豁免 $0");
  });
  Logger.log("【"+label+" 按淨堂計學費】"+(dry?"🔎 試算（未寫入）":"✅ 已寫入")+"　新增 "+n_new+"／更新 "+n_upd+"／略過 "+n_skip+"／豁免暫停 "+n_void+"\n"+lines.join("\n"));
  return {ok:true, period:label, added:n_new, updated:n_upd, skipped:n_skip, voided:n_void, dry:!!dry, lines:lines};
}
function genPeriod78NetDryRun(){ return genPeriodNet_("2026 7-8月", true); }
// 跨期強制豁免：把 PERIOD_VOID 名單（非本次產生嘅期，如 5-6月）設 $0；已繳行唔郁，唔重算其他人
function applyPeriodVoids_(dry){
  var sh=feeSheet(), done=[];
  Object.keys(PERIOD_VOID).forEach(function(label){
    (PERIOD_VOID[label]||[]).forEach(function(nm){
      feeRows_().filter(function(x){ return x.period===label && x.name===nm; }).forEach(function(x){
        if(x.status==="已繳") return;   // 已繳唔郁（避免改歷史）
        if(!dry){ sh.getRange(x.row,4,1,3).setValues([[0,0,0]]); sh.getRange(x.row,8).setValue("豁免");
                  sh.getRange(x.row,12).setValue("本期暫停，不收費"); sh.getRange(x.row,13,1,2).setValues([[0,""]]); }
        done.push(label+"｜"+nm);
      });
    });
  });
  return done;
}
// 把某班 CLASSES const 名單同步去 Settings class_cN_students（只動指定班，唔影響其他班）
function syncClassSettingFromConst_(cid){
  if(!CLASSES[cid]) return;
  try{ upsertSetting_("class_"+cid+"_students", JSON.stringify(CLASSES[cid].students)); }catch(e){}
}
function genPeriod78NetApply(){
  backup();
  try{ ensureRoster_(SS()); }catch(e){}            // 套用最新 CLASSES（梁心朗 入 c4）→ 名冊
  try{ buildGrid(SS(),"c4",false); }catch(e){}     // c4 grid 容納新學生（非破壞性）
  try{ syncClassSettingFromConst_("c4"); }catch(e){} // Settings class_c4_students 對齊 const
  var v=applyPeriodVoids_(false);                  // 跨期強制豁免（梁心朗 5-6月 $0）
  var r=genPeriodNet_("2026 7-8月", false);
  try{ SpreadsheetApp.getUi().alert("✅ 7-8月學費（按淨堂計）已寫入\n新增 "+r.added+"／更新 "+r.updated+"／已繳豁免略過 "+r.skipped+"／本期豁免 "+r.voided
    +"\n跨期豁免（如 5-6月暫停）："+v.length+" 筆"+(v.length?("（"+v.join("、")+"）"):"")
    +"\n\n（家長端揀對應月份即見金額同說明）"); }catch(e){}
  return {ok:true, net:r, crossVoid:v};
}

/* 🔁 通用：套用任何 CLASSES 名單改動（轉班／加減學生／加堂），安全重建全部出席表＋對齊名冊＋重算學費。
 * 改 const 直接郁 grid 會位置錯位（人數 vs 實體行）或清空洗資料（header 一變），故用 production 機制：
 *   1) backup() 快照現況（已修：掃 reg keys，唔會再漏邊界補堂行）。
 *   2) buildGrid(全部 CLASS_IDS, true) force 重建（已修：rebuild 前清殘留驗證，唔會 throw）。
 *   3) applySnapshot_ 按姓名還原全部資料 —— 各班舊出席原位還原；新加/未來堂無資料 → 留空（正確）。
 *   4) ensureRoster_/syncClassSetting 令 Roster + Settings 對齊 const。
 *   5) 重算 7-8月學費。
 * 已套用：梁心朗 c3→c4；c1/c2 加 8/31；黃玥晴 c5→c1（STUDENT_JOIN 7/1、byStudent 保留順延 $910）。
 * 冪等：再跑都安全（已對齊就無變化）。出事可用「還原至最近備份」。 */
function applyRosterChangesMigrate_(){
  var ui; try{ ui=SpreadsheetApp.getUi(); }catch(e){}
  backup();                                              // 1) 安全網＋快照（按姓名）
  var map=snapshots_(), keys=Object.keys(map);
  if(!keys.length){ if(ui) ui.alert("❌ 備份失敗，已中止。"); return {ok:false, err:"no backup"}; }
  var best=keys[0]; keys.forEach(function(t){ if(map[t].total>map[best].total) best=t; });
  var rows=map[best].rows;
  CLASS_IDS.forEach(function(cid){ buildGrid(SS(),cid,true); });   // 2) force 重建全部班別
  applySnapshot_(rows);                                  // 3) 按姓名還原全部人資料
  try{ ensureRoster_(SS()); }catch(e){}                  // 4) Roster 對齊 const
  CLASS_IDS.forEach(function(cid){ try{ syncClassSettingFromConst_(cid); }catch(e){} });
  var fee=genPeriodNet_("2026 7-8月", false, true);      // 5) 重算學費（已備份→skipBackup）
  if(ui) ui.alert("✅ 名單改動已套用\n\n已 force 重建全部出席表並按姓名還原全部學生資料（其他人不受影響）。\n已先備份（"+best+"）。學費已重算（更新 "+fee.updated+" 筆）。\n\n如有任何異樣可用「還原至最近備份」即時復原。");
  return {ok:true, fee:fee, backup:best};
}
function migrateLeungC3toC4(){ return applyRosterChangesMigrate_(); }   // 向後相容別名
function migrateLeungC3toC4Menu(){
  var ui=SpreadsheetApp.getUi();
  var c=ui.alert("套用名單改動（重建出席表＋重算學費）",
    "會 force 重建全部出席表並按姓名還原全部學生資料（其他人不受影響），再對齊名冊同重算 7-8月學費。\n用於任何轉班／加減學生（目前：黃玥晴 c5→c1）。\n執行前自動備份，可隨時還原。\n\n確定執行？",
    ui.ButtonSet.OK_CANCEL);
  if(c!==ui.Button.OK) return;
  try{ applyRosterChangesMigrate_(); }
  catch(e){ ui.alert("❌ 失敗：\n"+(e&&e.message||e)+"\n\n可用「還原至最近備份」復原。"); }
}

// 產生某期繳費列：改用「按實際堂數×每堂價」（接 sessionsFor／點名停課），取代固定 $1040/$1760。
// 已繳／豁免行唔郁；未繳行會跟最新排程重算（停課自動少計、抵扣 ledger 自動套用）。
function genPeriod_(label){
  return genPeriodNet_(String(label).trim(), false, true);   // skipBackup：通常由 setup/呼叫方自行備份
}
/* 遠端觸發「套用名單改動」（重建全部 grid＋還原＋重算學費），coachPass 守護。
   等同選單按鈕，方便老闆唔喺電腦時遠端套用 CLASSES 改動。先自動備份，可還原。*/
function apiApplyRosterChanges(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  return applyRosterChangesMigrate_();
}
function apiGenPeriod(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  return genPeriod_(String(p.period||curPeriodLabel_()));
}
/* 重算某行淨額與狀態：淨額 = 應繳 − 推薦折扣 + 調整 */
function recalcFeeRow_(row){
  var sh=feeSheet();
  var due=Number(sh.getRange(row,4).getValue())||0;
  var disc=Number(sh.getRange(row,5).getValue())||0;
  var adj=Number(sh.getRange(row,13).getValue())||0;
  var paid=Number(sh.getRange(row,7).getValue())||0;
  var net=due-disc+adj;
  sh.getRange(row,6).setValue(net);
  var status;
  if(net<=0) status="已繳";                       // 全數豁免 / 無須再繳
  else if(paid>=net && paid>0) status="已繳";
  else if(paid>0) status="部分";
  else status="未繳";
  // 已上傳截圖但未核實 → 待核實（除非已繳）
  if(status==="未繳" && String(sh.getRange(row,9).getValue()||"")!=="") status="待核實";
  sh.getRange(row,8).setValue(status);
  return {net:net, status:status};
}
/* ═══════════ 推薦優惠帳本（每位新生 $100；每期上限 = 該期學費 50%；餘額結轉）═══════════ */
function referralSheet(){
  var sh=SS().getSheetByName("推薦優惠");
  if(!sh){ sh=SS().insertSheet("推薦優惠");
    sh.getRange(1,1,1,5).setValues([["推薦人","新生","金額","日期","備註"]]);
    sh.setFrozenRows(1); }
  return sh;
}
function referralRows_(){
  var sh=referralSheet(); if(sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,5).getValues().map(function(r){
    return {ref:String(r[0]).trim(), newbie:String(r[1]).trim(), amt:Number(r[2])||0, date:String(r[3]||""), note:String(r[4]||"")};
  }).filter(function(x){ return x.ref; });
}
function referralEarned_(nm){ var t=0; referralRows_().forEach(function(x){ if(x.ref===nm) t+=x.amt; }); return t; }
function referralApplied_(nm){ var t=0; feeRows_().forEach(function(x){ if(x.name===nm) t+=(x.discount||0); }); return t; }
function referralBalance_(nm){ return Math.max(0, referralEarned_(nm)-referralApplied_(nm)); }
/* 計可套用折扣：min(餘額, 50%×應繳)；excludeDisc = 計餘額時要扣返本行原本折扣（重算時用）*/
function referralAutoDisc_(nm, due, excludeDisc){
  var bal=referralBalance_(nm)+(excludeDisc||0);
  var cap=Math.floor(due*0.5);
  return Math.max(0, Math.min(bal, cap));
}
/* 教練：登記一筆推薦優惠（+$100），並自動套用到該推薦人未繳之本期/下期 */
function apiAddReferral(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var ref=String(p.ref||"").trim(), nb=String(p.newbie||"").trim(), amt=Number(p.amt)||100;
  if(!ref) return {ok:false,err:"請填推薦人"};
  var sh=referralSheet(), row=sh.getLastRow()+1;
  sh.getRange(row,4).setNumberFormat("@");
  sh.getRange(row,1,1,5).setValues([[ref,nb,amt,todayIso(),String(p.note||"")]]);
  // 自動套用到推薦人未繳之本期 / 下期
  [curPeriodLabel_(), nextPeriodLabel_()].forEach(function(lab){ applyReferralRow_(ref,lab); });
  logAppend({name:ref,key:"",action:"referral",status:"推薦 "+nb+" +$"+amt});
  return {ok:true, balance:referralBalance_(ref)};
}
/* 套用推薦折扣到指定學生某期（未繳先套）*/
function applyReferralRow_(nm, label){
  var rows=feeRows_(), hit=null;
  for(var i=0;i<rows.length;i++){ if(rows[i].name===nm && rows[i].period===label){ hit=rows[i]; break; } }
  if(!hit || hit.status==="已繳") return false;
  var disc=referralAutoDisc_(nm, hit.due, hit.discount);
  var sh=feeSheet();
  sh.getRange(hit.row,5).setValue(disc);
  recalcFeeRow_(hit.row);
  return true;
}
function apiApplyReferral(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var ok=applyReferralRow_(String(p.name).trim(), String(p.period).trim());
  return {ok:ok, balance:referralBalance_(String(p.name).trim())};
}
function apiReferralsAll(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var byRef={}; referralRows_().forEach(function(x){ byRef[x.ref]=(byRef[x.ref]||0)+x.amt; });
  var bals=Object.keys(byRef).map(function(nm){ return {name:nm, earned:byRef[nm], applied:referralApplied_(nm), balance:referralBalance_(nm)}; });
  return {ok:true, ledger:referralRows_(), balances:bals};
}

/* ═══════════ 每週通知（場地／時間／天氣）═══════════ */
function noticeSheet(){
  var sh=SS().getSheetByName("通知");
  if(!sh){ sh=SS().insertSheet("通知");
    sh.getRange(1,1,1,4).setValues([["時間","內容","適用班別","發佈者"]]);
    sh.setFrozenRows(1); }
  return sh;
}
function noticesRecent_(n){
  var sh=noticeSheet(); if(sh.getLastRow()<2) return [];
  var all=sh.getRange(2,1,sh.getLastRow()-1,4).getValues().map(function(r,i){
    return {row:i+2, at:String(r[0]||""), text:String(r[1]||""), scope:String(r[2]||""), by:String(r[3]||"")};
  }).filter(function(x){ return x.text; });
  all.reverse();   // 最新喺前
  return n?all.slice(0,n):all;
}
/* ═══════════ 上課地點（場地）：教練按日期設定，家長端每節顯示 ═══════════ */
function venueSheet_(){
  var sh=SS().getSheetByName("場地");
  if(!sh){ sh=SS().insertSheet("場地"); sh.appendRow(["日期","體育館","場地","更新時間"]); sh.getRange("A:A").setNumberFormat("@"); }
  return sh;
}
function venueRows_(){
  var sh=venueSheet_(); if(sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,4).getValues().map(function(r,i){
    return {row:i+2, date:toIso_(r[0]), centre:String(r[1]||"").trim(), room:String(r[2]||"").trim(), at:String(r[3]||"")};
  }).filter(function(x){ return x.date; });
}
function venueMap_(){
  var m={}; venueRows_().forEach(function(v){ if(v.centre||v.room) m[v.date]={centre:v.centre, room:v.room}; }); return m;
}
function apiSetVenue(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var date=toIso_(p.date); if(!date) return {ok:false,err:"請揀日期"};
  var centre=String(p.centre||"").trim(), room=String(p.room||"").trim();
  var sh=venueSheet_(), hit=null;
  venueRows_().forEach(function(v){ if(v.date===date) hit=v; });
  if(!centre && !room){ if(hit) sh.deleteRow(hit.row); return {ok:true, cleared:true}; }   // 兩個都空＝清除該日
  if(hit){ sh.getRange(hit.row,1,1,4).setValues([[date,centre,room,nowStamp_()]]); }
  else { var nr=sh.getLastRow()+1; sh.getRange(nr,1).setNumberFormat("@"); sh.getRange(nr,1,1,4).setValues([[date,centre,room,nowStamp_()]]); }
  return {ok:true};
}
function addDaysIso_(iso,n){ var d=new Date(iso+"T00:00:00"); d.setDate(d.getDate()+n); return Utilities.formatDate(d, tz(), "yyyy-MM-dd"); }
function timeStartHour_(s){ s=String(s||""); var m=s.match(/(\d+)\s*(am|pm)?/i); if(!m) return 0; var h=Number(m[1]), ap=(m[2]||"").toLowerCase();
  if(ap==="pm"&&h<12) h+=12; else if(ap==="am"&&h===12) h=0; else if(!ap && /pm/i.test(s) && h<8) h+=12; return h; }
// 一鍵生成 WhatsApp 文案：列出未來 days 日內每個上課日（日期＋地點＋場地＋各班時間），假期標取消。
function apiWeeklyText(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var days=Number(p.days)||10, today=todayIso(), end=addDaysIso_(today,days), vmap=venueMap_(), hol=holidaysSet();
  var WDZH=["日","一","二","三","四","五","六"], byDate={};
  CLASS_IDS.forEach(function(cid){
    sessionsFor(cid).forEach(function(d){ if(d>=today && d<=end){ (byDate[d]=byDate[d]||[]).push({time:CLASSES[cid].time, h:timeStartHour_(CLASSES[cid].time)}); } });
  });
  var holDates={};
  Object.keys(hol).forEach(function(d){
    if(d<today || d>end) return;
    var wd=new Date(d+"T00:00:00").getDay();
    if(CLASS_IDS.some(function(cid){return CLASSES[cid].wd===wd;}) && d>=CONFIG.TERM_START && d<=CONFIG.TERM_END) holDates[d]=1;
  });
  var all={}; Object.keys(byDate).forEach(function(d){all[d]=1;}); Object.keys(holDates).forEach(function(d){all[d]=1;});
  var out=Object.keys(all).sort().map(function(d){
    var dt=new Date(d+"T00:00:00"), head=dt.getDate()+"/"+(dt.getMonth()+1)+"（"+WDZH[dt.getDay()]+"）";
    if(holDates[d] && !byDate[d]) return head+"\n❗公眾假期，所有課堂取消❗";
    var v=vmap[d], times=(byDate[d]||[]).sort(function(a,b){return a.h-b.h;}).map(function(x){return x.time;}).join(" & ");
    var centreLine = (v&&v.centre) ? (v.centre==="青衣體育館"?v.centre:("❗"+v.centre+"❗")) : "（地點待定）";
    var roomLine = (v&&v.room) ? (v.room+"："+times) : times;
    return head+"\n"+centreLine+"\n"+roomLine;
  });
  return {ok:true, text: out.join("\n\n"), count: out.length};
}
function apiVenuesAdmin(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  return {ok:true, venues:venueRows_().filter(function(v){return v.centre||v.room;}).sort(function(a,b){return a.date<b.date?1:-1;})};
}
function apiAddNotice(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var text=String(p.text||"").trim(); if(!text) return {ok:false,err:"內容不可空白"};
  var sh=noticeSheet(), row=sh.getLastRow()+1;
  sh.getRange(row,1).setNumberFormat("@");
  sh.getRange(row,1,1,4).setValues([[nowStamp_(), text, String(p.scope||"全部"), String(p.by||"教練")]]);
  return {ok:true};
}
function apiNotices(p){ return {ok:true, notices:noticesRecent_(Number(p.n)||8)}; }
function apiDeleteNotice(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var sh=noticeSheet(), rownum=Number(p.row);
  if(rownum>=2 && rownum<=sh.getLastRow()){ sh.deleteRow(rownum); return {ok:true}; }
  return {ok:false,err:"找不到該通知"};
}

/* ═══════════ CSV 匯出（教練）═══════════ */
function csvCell_(v){ var s=String(v==null?"":v); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }
function toCsv_(rows){ return "\ufeff"+rows.map(function(r){ return r.map(csvCell_).join(","); }).join("\r\n"); }
function apiExport(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var type=String(p.type||"roster"), rows=[];
  if(type==="roster"){
    rows.push(["學生","電話後4","班別","星期","時間"]);
    rosterRows().forEach(function(r){ rows.push([r.name,r.last4,r.cid,r.dayZh,r.time]); });
  } else if(type==="fees"){
    rows.push(["學生","期","每週堂數","應繳","推薦折扣","調整","實際應繳","已繳","狀態"]);
    feeRows_().forEach(function(x){ rows.push([x.name,x.period,x.weekly,x.due,x.discount,x.adj,x.net,x.paid,x.status]); });
  } else if(type==="addons"){
    rows.push(["學生","月份","序號","去班別","日期","應付","狀態"]);
    addonRows_().forEach(function(x){ rows.push([x.name,x.month,x.seq,x.to,x.date,x.price,x.status]); });
  } else if(type==="attendance"){
    rows.push(["班別","學生","日期","狀態"]);
    CLASS_IDS.forEach(function(cid){ var blk=readBlock(cid);
      Object.keys(blk.status).forEach(function(nm){ var arr=blk.status[nm]||[];
        blk.dates.forEach(function(d,i){ if(arr[i]) rows.push([cid,nm,d,arr[i]]); }); }); });
  } else return {ok:false,err:"未知匯出類型"};
  return {ok:true, type:type, csv:toCsv_(rows)};
}

/* 教練：編輯個別學生本期調整（豁免／補收上期），自動更新淨額 */
function apiSetFeeAdj(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var nm=String(p.name).trim(), label=String(p.period).trim();
  var rows=feeRows_(), hit=null;
  for(var i=0;i<rows.length;i++){ if(rows[i].name===nm && rows[i].period===label){ hit=rows[i]; break; } }
  if(!hit) return {ok:false,err:"搵唔到該期繳費紀錄"};
  var adj=Number(p.adj)||0, note=String(p.adjNote||"");
  var sh=feeSheet();
  sh.getRange(hit.row,13).setValue(adj);
  sh.getRange(hit.row,14).setValue(note);
  var r=recalcFeeRow_(hit.row);
  logAppend({name:nm,key:label,action:"feeAdj",status:"調整 $"+adj+"（"+note+"）→ 淨額 $"+r.net});
  return {ok:true, net:r.net, status:r.status};
}
/* 家長：上傳付款截圖（存 Drive，狀態→待核實）*/
// 上載付款截圖核心（已驗身或已核名後呼叫）：寫入截圖連結 + 標待核實 + 通知
function payUploadCore_(nm, label, dataUrl){
  var rows=feeRows_(), hit=null;
  for(var i=0;i<rows.length;i++){ if(rows[i].name===nm && rows[i].period===label){ hit=rows[i]; break; } }
  if(!hit) return {ok:false,err:"搵唔到該期繳費紀錄，請聯絡張 Sir"};
  if(hit.status==="豁免") return {ok:false,err:"此期為豁免，無須繳費"};
  dataUrl=String(dataUrl||""); var comma=dataUrl.indexOf(",");
  if(comma<0) return {ok:false,err:"檔案格式不正確"};
  var meta=dataUrl.slice(0,comma), b64=dataUrl.slice(comma+1);
  var ctMatch=meta.match(/data:(.*?);/); var ct=ctMatch?ctMatch[1]:"image/jpeg";
  var ext=ct.indexOf("pdf")>=0?"pdf":(ct.indexOf("png")>=0?"png":"jpg");
  var fname=nm+"_"+label+"_付款."+ext;
  var folders=DriveApp.getFoldersByName("IS 付款截圖");
  var folder=folders.hasNext()?folders.next():DriveApp.createFolder("IS 付款截圖");
  var file=folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), ct, fname));
  try{ file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }catch(e){}
  var link=file.getUrl(), sh=feeSheet();
  sh.getRange(hit.row,9).setValue(link);
  if(hit.status!=="已繳") sh.getRange(hit.row,8).setValue("待核實");
  logAppend({name:nm,key:label,action:"payUpload",status:"上傳付款截圖"});
  notify("【繳費截圖】"+nm, nm+"\n期："+label+"\n金額：$"+hit.net+"\n截圖："+link+"\n請於教練端核實。");
  return {ok:true, link:link};
}
function apiPayUpload(p){
  if(!authParent_(p.name,p.code)) return {ok:false,err:"登入碼不正確，無法操作"};
  try{ return payUploadCore_(String(p.name).trim(), String(p.period).trim(), p.dataUrl); }
  catch(e){ return {ok:false, err:"上載失敗："+(e&&e.message||e)}; }
}
/* 復原：由 Drive「IS 付款截圖」掃返全部已上傳截圖，重新連結去對應繳費行＋標「待核實」。
   用於：截圖連結／待核實狀態被學費重算誤清（檔案仍在 Drive）。冪等；已繳/豁免行唔郁。*/
function recoverPendingPayments_(){
  var folders=DriveApp.getFoldersByName("IS 付款截圖");
  if(!folders.hasNext()) return {ok:true, count:0, recovered:[], note:"無付款截圖資料夾"};
  var folder=folders.next(), it=folder.getFiles();
  var sh=feeSheet(), idx={}; feeRows_().forEach(function(x){ idx[x.name+"|"+x.period]=x; });
  var recovered=[], skipped=[];
  while(it.hasNext()){
    var f=it.next(), name=String(f.getName()||"");
    var p=name.lastIndexOf("_付款."); if(p<0) continue;
    var parts=name.slice(0,p).split("_"); if(parts.length<2) continue;
    var nm=parts[0], label=parts.slice(1).join("_"), hit=idx[nm+"|"+label];
    if(!hit){ skipped.push(name); continue; }
    if(hit.status==="已繳"||hit.status==="豁免") continue;     // 已核實／豁免 → 唔郁
    try{ f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }catch(e){}
    if(!String(sh.getRange(hit.row,9).getValue()||"")) sh.getRange(hit.row,9).setValue(f.getUrl());
    if(hit.status!=="待核實") sh.getRange(hit.row,8).setValue("待核實");
    recovered.push(nm+"｜"+label);
  }
  logAppend({name:"(系統)",key:"-",action:"recoverPay",status:"復原待核實 "+recovered.length+" 筆"});
  return {ok:true, count:recovered.length, recovered:recovered, skipped:skipped};
}
function apiRecoverPayments(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  return recoverPendingPayments_();
}

/* ═══════════ 免登入「一鍵繳費」（只憑姓名，供 is-pay.html）═══════════
   只暴露應繳金額同明細；上載只標「待核實」，要教練核實先當收到。 */
function rosterHasName_(nm){ return rosterRows().some(function(r){ return r.name===nm && r.cid; }); }
function unpaidFeesFor_(nm){
  return feesFor_(nm).filter(function(f){ return f.net>0 && f.status!=="已繳" && f.status!=="豁免"; })
    .sort(function(a,b){ return periodOrder_(a.period)-periodOrder_(b.period); });
}
// 同一家庭（電話後4位＋姓氏首字，同 apiLogin 防洩漏邏輯）名下嘅兄弟姊妹姓名
function familySiblings_(nm){
  var all=rosterRows(), self=all.filter(function(r){ return r.name===nm && r.last4!==""; })[0];
  if(!self) return [nm];
  var fam=pad4(self.last4), surn=String(nm).trim().charAt(0), names=[];
  all.forEach(function(r){ if(r.last4!=="" && pad4(r.last4)===fam && String(r.name).trim().charAt(0)===surn && names.indexOf(r.name)<0) names.push(r.name); });
  return names.length?names:[nm];
}
function apiPayLookup(p){
  var nm=String(p.name||"").trim();
  if(!nm) return {ok:false, err:"請輸入小朋友中文全名"};
  if(rlBlocked_("paylk_"+nm, 20)) return {ok:false, err:"嘗試太多次，請稍後再試"};
  if(!rosterHasName_(nm)){ rlBump_("paylk_"+nm, 300); return {ok:false, err:"搵唔到呢位小朋友，請確認中文全名（如有疑問請 WhatsApp 教練 6331 7403）"}; }
  rlClear_("paylk_"+nm);
  // 兄弟姊妹（同電話＋同姓）一齊顯示，可一次過繳交
  var students=familySiblings_(nm).map(function(cn){ return {name:cn, fees:unpaidFeesFor_(cn)}; })
    .filter(function(s){ return s.fees.length; });
  var total=0; students.forEach(function(s){ s.fees.forEach(function(f){ total += Math.max(0,(Number(f.net)||0)-(Number(f.paid)||0)); }); });
  return {ok:true, name:nm, payNumber:CONFIG.PAY_NUMBER, students:students, total:total,
          fees: students.length ? (students.filter(function(s){return s.name===nm;})[0]||students[0]).fees : []};  // 向後相容
}
// 一次過上傳一張截圖 cover 多位小朋友／多期（每個 名+期 各自標「待核實」供教練逐筆核實）
function apiPayUploadFamily(p){
  var items = Array.isArray(p.items) ? p.items : [];
  if(!items.length) return {ok:false, err:"冇學費項目"};
  var key="payupf_"+String(items[0].name||"");
  if(rlBlocked_(key, 12)) return {ok:false, err:"嘗試太多次，請稍後再試"};
  rlBump_(key, 600);
  var done=[], failed=[];
  items.forEach(function(it){
    var cn=String(it.name||"").trim(), label=String(it.period||"").trim();
    if(!cn || !rosterHasName_(cn)){ failed.push(cn+"｜"+label); return; }
    try{ var r=payUploadCore_(cn, label, p.dataUrl); if(r&&r.ok) done.push(cn+"｜"+label); else failed.push(cn+"｜"+label); }
    catch(e){ failed.push(cn+"｜"+label); }
  });
  return {ok:done.length>0, done:done, failed:failed};
}
function apiPayUploadOpen(p){
  var nm=String(p.name||"").trim(), label=String(p.period||"").trim();
  if(!nm || !rosterHasName_(nm)) return {ok:false, err:"搵唔到呢位小朋友，請確認中文全名"};
  if(rlBlocked_("payup_"+nm, 12)) return {ok:false, err:"嘗試太多次，請稍後再試"};
  rlBump_("payup_"+nm, 600);
  try{ return payUploadCore_(nm, label, p.dataUrl); }
  catch(e){ return {ok:false, err:"上載失敗："+(e&&e.message||e)}; }
}

/* ═══════════ 退出學生回歸（returner）═══════════
 * RETURNABLE 學生：可登入、排行榜出名、is-parent 中間區換成「回歸下一期」面板。
 * 流程：揀 1～2 班 → 上傳付款截圖（$1200/$1800）→ 教練核實 → 自動加入該班設定（變正常學生）。*/
function returnSheet(){
  var sh=SS().getSheetByName("回歸");
  if(!sh){ sh=SS().insertSheet("回歸");
    sh.getRange(1,1,1,9).setValues([["學生","選班別","期","每週堂數","費用","狀態","截圖","申請時間","核實時間"]]);
    sh.setFrozenRows(1); }
  return sh;
}
function returnRows_(){
  var sh=returnSheet(); if(sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,9).getValues().map(function(r,i){
    var cids=[]; try{ cids=JSON.parse(r[1]); }catch(e){ cids=String(r[1]).split(","); }
    return {row:i+2, name:String(r[0]), cids:cids, period:String(r[2]), weekly:Number(r[3])||0,
      fee:Number(r[4])||0, status:String(r[5]||""), link:String(r[6]||""), at:String(r[7]||""), verifiedAt:String(r[8]||"")};
  }).filter(function(x){ return x.name; });
}
function isReturnable_(nm){ return RETURNABLE.indexOf(String(nm).trim())>=0 && classesFor_(nm).length===0; }
function returnFee_(n){ return n>=2 ? RET_FEE_2 : RET_FEE_1; }

// 家長：回歸付款（揀 1～2 班 + 上傳截圖）
function apiReturnPay(p){
  if(!authParent_(p.name,p.code)) return {ok:false,err:"登入碼不正確"};
  var nm=String(p.name).trim();
  if(!isReturnable_(nm)) return {ok:false,err:"此帳戶毋須回歸（已在學或非可回歸名單）"};
  var cids=(p.classIds||[]).map(function(x){ return String(x).trim(); }).filter(function(c){ return CLASSES[c]; });
  cids=cids.filter(function(c,i){ return cids.indexOf(c)===i; });
  if(!cids.length || cids.length>2) return {ok:false,err:"請揀 1～2 個班別"};
  var fee=returnFee_(cids.length), per=nextPeriodLabel_();
  try{
    var dataUrl=String(p.dataUrl||""); var comma=dataUrl.indexOf(",");
    if(comma<0) return {ok:false,err:"請上傳付款截圖"};
    var meta=dataUrl.slice(0,comma), b64=dataUrl.slice(comma+1);
    var ctMatch=meta.match(/data:(.*?);/); var ct=ctMatch?ctMatch[1]:"image/jpeg";
    var ext=ct.indexOf("pdf")>=0?"pdf":(ct.indexOf("png")>=0?"png":"jpg");
    var folders=DriveApp.getFoldersByName("IS 付款截圖");
    var folder=folders.hasNext()?folders.next():DriveApp.createFolder("IS 付款截圖");
    var file=folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), ct, nm+"_回歸_"+per+"."+ext));
    try{ file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }catch(e){}
    var link=file.getUrl(), sh=returnSheet();
    var rowVals=[nm, JSON.stringify(cids), per, cids.length, fee, "待核實", link, nowStamp_(), ""];
    var existing=returnRows_().filter(function(x){ return x.name===nm && x.status!=="已核實"; })[0];
    if(existing) sh.getRange(existing.row,1,1,9).setValues([rowVals]);
    else sh.getRange(sh.getLastRow()+1,1,1,9).setValues([rowVals]);
    notify("【回歸付款】"+nm, nm+" 申請回歸\n班別："+cids.map(function(c){ return classLabel_(c); }).join("、")+
      "\n期："+per+"\n費用：$"+fee+"\n截圖："+link+"\n請喺教練端核實。");
    return {ok:true, link:link, fee:fee, period:per};
  }catch(e){ return {ok:false,err:"上載失敗："+(e&&e.message||e)}; }
}
// 教練：核實回歸 → 加入班別設定（即變正常學生；先自動備份）
function apiReturnVerify(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var nm=String(p.name).trim();
  var hit=returnRows_().filter(function(x){ return x.name===nm && x.status!=="已核實"; })[0];
  if(!hit) return {ok:false,err:"搵唔到待核實回歸申請"};
  try{ backup(); }catch(e){}
  hit.cids.forEach(function(cid){
    if(!CLASSES[cid]) return;
    var arr=CLASSES[cid].students.slice();
    if(arr.indexOf(nm)<0) arr.push(nm);
    upsertSetting_("class_"+cid+"_students", JSON.stringify(arr));   // 寫設定 → 全系統認
    CLASSES[cid].students=arr;                                       // 即時生效（同次執行）
  });
  try{ ensureRoster_(SS()); }catch(e){}                              // 名冊即時更新 → 家長端認得
  var sh=returnSheet(); sh.getRange(hit.row,6).setValue("已核實"); sh.getRange(hit.row,9).setValue(nowStamp_());
  notify("【回歸完成】"+nm, nm+" 已核實回歸，加入："+hit.cids.map(function(c){ return classLabel_(c); }).join("、")+
    "\n⚠️ 請執行一次「⬇️ 匯入家長資料」令 grid 加返佢嗰行（非破壞性）。");
  return {ok:true, name:nm, classes:hit.cids};
}
function apiReturnsAll(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  return {ok:true, returns:returnRows_()};
}
// 選單：核實回歸申請（列出待核實 → 輸入姓名核實 → 加入班別）
function reviewReturnsMenu(){
  var ui=SpreadsheetApp.getUi();
  var pending=returnRows_().filter(function(x){ return x.status!=="已核實"; });
  if(!pending.length){ ui.alert("冇待核實嘅回歸申請。"); return; }
  var msg=pending.map(function(x){ return "• "+x.name+" → "+x.cids.map(function(c){ return classLabel_(c); }).join("、")+"（"+x.period+"，$"+x.fee+"）"; }).join("\n");
  var resp=ui.prompt("待核實回歸："+pending.length+" 宗\n\n"+msg+"\n\n核實前請先睇「回歸」表嘅付款截圖。\n輸入要核實嘅學生中文全名（核實＝加入班別、變正常學生）：", ui.ButtonSet.OK_CANCEL);
  if(resp.getSelectedButton()!==ui.Button.OK) return;
  var nm=String(resp.getResponseText()||"").trim(); if(!nm) return;
  var vr=apiReturnVerify({coachPass:CONFIG.COACH_PASS, name:nm});
  ui.alert(vr.ok ? ("✅ "+nm+" 已核實回歸，加入："+vr.classes.map(function(c){ return classLabel_(c); }).join("、")+"\n\n⚠️ 跟住請：1) 執行一次「⬇️ 匯入家長資料」令 grid 對齊；2) 通知我把佢加入程式碼名單做永久。") : ("核實失敗："+(vr.err||"")));
}
/* 教練：核實已繳 */
function apiVerifyPay(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var nm=String(p.name).trim(), label=String(p.period).trim();
  var rows=feeRows_(), hit=null;
  for(var i=0;i<rows.length;i++){ if(rows[i].name===nm && rows[i].period===label){ hit=rows[i]; break; } }
  if(!hit) return {ok:false,err:"搵唔到該期繳費紀錄"};
  var paid=(p.paid!==undefined && p.paid!=="")?Number(p.paid):hit.net;
  var sh=feeSheet();
  sh.getRange(hit.row,7).setValue(paid);
  sh.getRange(hit.row,8).setValue(paid>=hit.net?"已繳":(paid>0?"部分":"未繳"));
  sh.getRange(hit.row,10).setValue(p.coach||"教練");
  sh.getRange(hit.row,11).setValue(nowStamp_());
  logAppend({name:nm,key:label,action:"verifyPay",status:"核實已繳 $"+paid});
  return {ok:true};
}
/* 教練：全部繳費總覽（含逾期判斷：期首月 +1 個月仍未繳）*/
function apiFeesAll(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var today=todayIso();
  var rows=feeRows_().map(function(x){
    var start=periodStartIso_(x.period);
    var dueBy=start?addMonthsIso(start,1):"";   // 期首月 + 1 個月
    var overdue=(x.status!=="已繳" && x.status!=="豁免" && dueBy && today>dueBy);
    return {name:x.name, period:x.period, weekly:x.weekly, due:x.due, discount:x.discount,
      adj:x.adj, adjNote:x.adjNote, net:x.net, paid:x.paid, status:x.status,
      hasScreenshot:!!x.link, link:x.link, verifier:x.verifier, overdue:overdue, dueBy:dueBy};
  });
  return {ok:true, fees:rows};
}
function genCurrentPeriodFees(){
  // 一次過產生本期＋下期繳費列（已存在嘅期會跳過）→ 家長端揀下期就會見到收費功能區
  var cur=apiGenPeriod({coachPass:CONFIG.COACH_PASS, period:curPeriodLabel_()});
  var nxt=apiGenPeriod({coachPass:CONFIG.COACH_PASS, period:nextPeriodLabel_()});
  SpreadsheetApp.getUi().alert("已產生繳費列：\n• "+cur.period+"：新增 "+cur.added+" 位\n• "+nxt.period+"：新增 "+nxt.added+" 位\n\n（家長端揀對應月份即見收費功能區）");
}
/* 一次性：把示範帳號 陳大文 現有「豁免」繳費列改返「未繳」（先自動備份）*/
function fixDemoUnexempt(){
  try{ backup(); }catch(e){}                          // 先備份，確保可還原
  var nm="陳大文", sh=feeSheet(), n=0;
  feeRows_().filter(function(x){ return x.name===nm && x.status==="豁免"; }).forEach(function(x){
    sh.getRange(x.row,7).setValue(0);                 // 已繳 = 0
    recalcFeeRow_(x.row);                              // 重算 → 狀態變「未繳」
    n++;
  });
  try{ SpreadsheetApp.getUi().alert("已把示範帳號 陳大文 嘅 "+n+" 筆「豁免」改返「未繳」。\n家長端用 1234 登入、揀對應月份就會見到收費功能區。"); }catch(e){}
  return n;
}

/* ═══════════ 家長操作權限：須附家庭登入碼（後端驗證，防冒用）═══════════ */
function authParent_(name, code){
  var nm=String(name).trim();
  if(rlBlocked_("login_"+nm, 12)) return false;
  var all=rosterRows();
  var ok = all.filter(function(r){ return r.name===nm && r.last4!==""; })
              .some(function(r){ return effectiveCred_(pad4(r.last4))===pad4(code); });
  if(ok) rlClear_("login_"+nm); else rlBump_("login_"+nm, 300);
  return ok;
}
function familyOf_(name){
  var hit=rosterRows().filter(function(r){ return r.name===String(name).trim() && r.last4!==""; });
  return hit.length?pad4(hit[0].last4):"";
}

/* ═══════════ 加操（增加上課堂數，階梯定價）═══════════ */
/* 每月：第 1–3 堂 $130；滿 4 堂改 $110/堂（第 4 堂只補差價 $50）；第 5 堂起 $110 */
function addonCumCost_(n){ return n>=4 ? n*110 : n*130; }
function addonPriceForNth_(n){ return addonCumCost_(n)-addonCumCost_(n-1); }  // n=1..3→130, n=4→50, n≥5→110
function addonSheet(){
  var sh=SS().getSheetByName("加操");
  if(!sh){ sh=SS().insertSheet("加操");
    sh.getRange(1,1,1,9).setValues([["學生","月份","序號","去班別","日期","應付","狀態","截圖","申請時間"]]);
    sh.setFrozenRows(1); }
  return sh;
}
function addonRows_(){
  var sh=addonSheet(); if(sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,9).getValues().map(function(r,i){
    return {row:i+2, name:String(r[0]), month:String(r[1]), seq:Number(r[2])||0, to:String(r[3]),
      date:toIso_(r[4]), price:Number(r[5])||0, status:String(r[6]||""), link:String(r[7]||""), at:String(r[8]||"")};
  }).filter(function(x){ return x.name && x.date; });
}
function addonsFor_(nm){
  return addonRows_().filter(function(x){ return x.name===nm; }).map(function(x){
    return {month:x.month, seq:x.seq, to:x.to, date:x.date, price:x.price, status:x.status, hasScreenshot:!!x.link};
  });
}
/* 家長：申請加操 */
function apiAddSession(p){
  if(!authParent_(p.name,p.code)) return {ok:false,err:"登入碼不正確，無法申請"};
  var nm=String(p.name).trim(), toCid=String(p.toKey), date=toIso_(p.toDate);
  if(!CLASSES[toCid]) return {ok:false,err:"班別不存在"};
  if(sessionsFor(toCid).indexOf(date)<0) return {ok:false,err:"該日不是有效上課日"};
  // 未繳該期學費 → 鎖定
  var per=periodLabelFromIso_(date);
  if(!periodPaid_(nm,per)) return {ok:false,err:"請先繳付 "+per+" 學費，方可申請加操"};
  // 防重複（同生同日同班已申請）
  var dup=addonRows_().some(function(x){ return x.name===nm && x.to===toCid && x.date===date; });
  if(dup) return {ok:false,err:"你已申請此堂加操"};
  var month=date.slice(0,7);
  var nThis=addonRows_().filter(function(x){ return x.name===nm && x.month===month; }).length;
  var seq=nThis+1, price=addonPriceForNth_(seq);
  markCell(toCid, nm, date, "加操", true);     // 落格，教練見到
  var sh=addonSheet(), row=sh.getLastRow()+1;
  sh.getRange(row,2).setNumberFormat("@"); sh.getRange(row,5).setNumberFormat("@");
  sh.getRange(row,1,1,9).setValues([[nm,month,seq,toCid,date,price,"待繳","",nowStamp_()]]);
  logAppend({name:nm,key:toCid,action:"addon",date:date,status:"加操#"+seq+" $"+price});
  notify("【加操申請】"+nm, nm+"\n去班別："+classLabel_(toCid)+"\n日期："+date+"\n本月第 "+seq+" 堂　應付 $"+price+"\n（已加入該班該日點名表）");
  return {ok:true, seq:seq, price:price, month:month};
}
/* 家長：上傳加操付款截圖 */
function apiAddonUpload(p){
  try{
    if(!authParent_(p.name,p.code)) return {ok:false,err:"登入碼不正確"};
    var nm=String(p.name).trim(), toCid=String(p.toKey), date=toIso_(p.toDate);
    var rows=addonRows_(), hit=null;
    for(var i=0;i<rows.length;i++){ if(rows[i].name===nm && rows[i].to===toCid && rows[i].date===date){ hit=rows[i]; break; } }
    if(!hit) return {ok:false,err:"搵唔到加操紀錄"};
    var dataUrl=String(p.dataUrl||""), comma=dataUrl.indexOf(",");
    if(comma<0) return {ok:false,err:"檔案格式不正確"};
    var meta=dataUrl.slice(0,comma), b64=dataUrl.slice(comma+1);
    var ctM=meta.match(/data:(.*?);/), ct=ctM?ctM[1]:"image/jpeg";
    var ext=ct.indexOf("pdf")>=0?"pdf":(ct.indexOf("png")>=0?"png":"jpg");
    var folders=DriveApp.getFoldersByName("IS 付款截圖");
    var folder=folders.hasNext()?folders.next():DriveApp.createFolder("IS 付款截圖");
    var file=folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), ct, nm+"_加操_"+date+"."+ext));
    try{ file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }catch(e){}
    var sh=addonSheet(); sh.getRange(hit.row,8).setValue(file.getUrl());
    if(hit.status!=="已繳") sh.getRange(hit.row,7).setValue("待核實");
    notify("【加操截圖】"+nm, nm+"\n"+classLabel_(toCid)+" "+date+"\n金額 $"+hit.price+"\n截圖："+file.getUrl());
    return {ok:true, link:file.getUrl()};
  }catch(e){ return {ok:false, err:"上載失敗："+(e&&e.message||e)}; }
}
/* 教練：核實加操已繳 / 全部加操列 */
function apiAddonVerify(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var nm=String(p.name).trim(), toCid=String(p.toKey), date=toIso_(p.toDate);
  var rows=addonRows_(), hit=null;
  for(var i=0;i<rows.length;i++){ if(rows[i].name===nm && rows[i].to===toCid && rows[i].date===date){ hit=rows[i]; break; } }
  if(!hit) return {ok:false,err:"搵唔到加操紀錄"};
  addonSheet().getRange(hit.row,7).setValue("已繳");
  logAppend({name:nm,key:toCid,action:"addonVerify",date:date,status:"加操核實已繳 $"+hit.price});
  return {ok:true};
}
function apiAddonsAll(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  return {ok:true, addons:addonRows_().map(function(x){
    return {name:x.name, month:x.month, seq:x.seq, to:x.to, date:x.date, price:x.price, status:x.status, hasScreenshot:!!x.link, link:x.link};
  })};
}
/* 教練代客加操（可直接標已付）；不受未繳鎖定限制 */
function apiCoachAddAddon(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var nm=String(p.name).trim(), toCid=String(p.toKey).trim(), date=toIso_(p.toDate);
  if(!CLASSES[toCid]) return {ok:false,err:"班別 "+toCid+" 不存在"};
  if(sessionsFor(toCid).indexOf(date)<0) return {ok:false,err:date+" 不是 "+toCid+" 有效上課日"};
  if(addonRows_().some(function(x){ return x.name===nm && x.to===toCid && x.date===date; }))
    return {ok:false,err:"已有此堂加操紀錄"};
  var month=date.slice(0,7);
  var seq=addonRows_().filter(function(x){ return x.name===nm && x.month===month; }).length+1;
  var price=addonPriceForNth_(seq), status=p.paid?"已繳":"待繳";
  markCell(toCid, nm, date, "加操", true);
  var sh=addonSheet(), row=sh.getLastRow()+1;
  sh.getRange(row,2).setNumberFormat("@"); sh.getRange(row,5).setNumberFormat("@");
  sh.getRange(row,1,1,9).setValues([[nm,month,seq,toCid,date,price,status,"",nowStamp_()]]);
  logAppend({name:nm,key:toCid,action:"coachAddon",date:date,status:"代客加操#"+seq+" $"+price+"／"+status});
  return {ok:true, seq:seq, price:price, status:status};
}

/* ═══════════ 教練登入（後端驗證密碼，前端唔再硬編）═══════════ */
function apiCoachLogin(p){
  if(rlBlocked_("coachlogin", 10)) return {ok:false, version:VERSION, err:"嘗試太多次，請約 5 分鐘後再試"};
  var ok = String(p.coachPass)===String(CONFIG.COACH_PASS);
  if(ok) rlClear_("coachlogin"); else rlBump_("coachlogin", 300);
  return {ok: ok, version:VERSION};
}

/* ═══════════ 調堂／轉班（把學生加入目標班指定日期，免費）═══════════ */
function transferSheet(){
  var sh=SS().getSheetByName("調堂");
  if(!sh){ sh=SS().insertSheet("調堂");
    sh.getRange(1,1,1,4).setValues([["學生","去班別","日期","記錄時間"]]);
    sh.setFrozenRows(1); }
  return sh;
}
function transferRows_(){
  var sh=transferSheet(); if(sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,4).getValues().map(function(r){
    return {name:String(r[0]).trim(), to:String(r[1]).trim(), date:toIso_(r[2]), at:String(r[3]||"")};
  }).filter(function(x){ return x.name && x.date; });
}
function transfersFor_(nm){
  return transferRows_().filter(function(x){ return x.name===nm; }).map(function(x){ return {to:x.to, date:x.date}; });
}
/* 教練：把學生加入目標班指定日期（多日用逗號），免費，狀態「轉堂」 */
function apiCoachTransfer(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var nm=String(p.name).trim(), toCid=String(p.toKey).trim();
  if(!CLASSES[toCid]) return {ok:false,err:"班別 "+toCid+" 不存在"};
  var list=String(p.dates||"").split(/[,，\s]+/).map(function(s){return s.trim();}).filter(Boolean);
  if(!list.length) return {ok:false,err:"請提供日期"};
  var sh=transferSheet(), done=[], skip=[];
  list.forEach(function(d){
    var iso=toIso_(d);
    if(sessionsFor(toCid).indexOf(iso)<0){ skip.push(d+"(非上課日)"); return; }
    if(transferRows_().some(function(x){ return x.name===nm && x.to===toCid && x.date===iso; })){ skip.push(d+"(已存在)"); return; }
    markCell(toCid, nm, iso, "轉堂", true);
    var row=sh.getLastRow()+1; sh.getRange(row,3).setNumberFormat("@");
    sh.getRange(row,1,1,4).setValues([[nm,toCid,iso,nowStamp_()]]);
    done.push(iso);
  });
  logAppend({name:nm,key:toCid,action:"transfer",status:"調堂 "+done.length+" 堂"});
  return {ok:true, added:done.length, dates:done, skipped:skip};
}
function apiTransfersAll(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  return {ok:true, transfers:transferRows_()};
}

/* ═══════════ 自訂登入密碼（家長首次登入後可改）═══════════ */
function pinSheet(){
  var sh=SS().getSheetByName("登入密碼");
  if(!sh){ sh=SS().insertSheet("登入密碼");
    sh.getRange(1,1,1,3).setValues([["家庭(電話後4位)","自訂密碼","更新時間"]]);
    sh.setFrozenRows(1); }
  return sh;
}
function pinFor_(last4){
  var sh=pinSheet(); if(sh.getLastRow()<2) return "";
  var vals=sh.getRange(2,1,sh.getLastRow()-1,2).getValues();
  for(var i=0;i<vals.length;i++){ if(pad4(vals[i][0])===pad4(last4)) return pad4(vals[i][1]); }
  return "";
}
function effectiveCred_(last4){ var pin=pinFor_(last4); return pin || pad4(last4); }
function setPin_(last4, pin){
  var sh=pinSheet(); var vals=sh.getLastRow()<2?[]:sh.getRange(2,1,sh.getLastRow()-1,3).getValues();
  for(var i=0;i<vals.length;i++){ if(pad4(vals[i][0])===pad4(last4)){
    sh.getRange(i+2,1).setNumberFormat("@"); sh.getRange(i+2,2).setNumberFormat("@");
    sh.getRange(i+2,1,1,3).setValues([[pad4(last4),pad4(pin),nowStamp_()]]); return; } }
  var row=sh.getLastRow()+1; sh.getRange(row,1).setNumberFormat("@"); sh.getRange(row,2).setNumberFormat("@");
  sh.getRange(row,1,1,3).setValues([[pad4(last4),pad4(pin),nowStamp_()]]);
}
/* 家長：設定/修改自訂密碼（須先以現有憑證驗證）*/
function apiSetPin(p){
  var nm=String(p.name).trim(), cur=pad4(p.code), np=String(p.newPin||"").replace(/\D/g,"");
  if(np.length!==4) return {ok:false,err:"新密碼必須為 4 個數字"};
  var all=rosterRows();
  var hit=all.filter(function(r){ return r.name===nm && r.last4!==""; })
             .filter(function(r){ return effectiveCred_(pad4(r.last4))===cur; });
  if(!hit.length) return {ok:false,err:"目前密碼不正確，無法修改"};
  var fam=pad4(hit[0].last4);
  setPin_(fam, np);
  logAppend({name:nm,key:fam,action:"setPin",status:"更新自訂登入密碼"});
  return {ok:true};
}

/* ═══════════ 教練：當日點名 ═══════════ */
function apiDaily(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  try{ enforceSickCert(); }catch(e){}
  var date=p.date, groups={};
  CLASS_IDS.forEach(function(cid){
    if(sessionsFor(cid).indexOf(date)<0) return;
    var full=readFull(cid), di=full.dates.indexOf(date), c=CLASSES[cid];
    var g={c:{sport:cid, key:cid, wd:c.dayZh, dayZh:c.dayZh, time:c.time}, rows:[]};
    full.students.forEach(function(nm){
      var ji=joinIso_(nm); if(ji && String(date)<ji) return;   // 未到入班日（STUDENT_JOIN）→ 唔喺點名表出現（如黃玥晴 7/1 前唔顯示喺 c1）
      g.rows.push({name:nm, makeup:false, status:(full.reg[nm]||[])[di]||""});
    });
    full.mk.forEach(function(x){ if(x.statuses[di]) g.rows.push({name:x.name, makeup:true, status:x.statuses[di]}); });
    groups[cid]=g;
  });
  // 特殊日（非正規上課日）補堂，例如後備日；正規日已喺格仔涵蓋
  makeupAll().forEach(function(m){ if(m.date!==date) return;
    var cid=m.to; var onGrid = CLASSES[cid] && sessionsFor(cid).indexOf(m.date)>=0;
    if(onGrid) return;
    if(!groups[cid]){ var c=CLASSES[cid]||{}; groups[cid]={c:{sport:cid,key:cid,wd:c.dayZh||"",dayZh:c.dayZh||"",time:c.time||""},rows:[]}; }
    groups[cid].rows.push({name:m.name, makeup:true, status:(m.status&&m.status!=="格"?m.status:"補堂")});
  });
  return {ok:true, list:CLASS_IDS.filter(function(k){return groups[k];}).map(function(k){return groups[k];})};
}
function apiMark(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var cid=p.key;
  if(CLASSES[cid] && markCell(cid,p.name,p.date,p.status,false)) return {ok:true};
  var sh=makeupSheet(), all=makeupAll();
  for(var i=0;i<all.length;i++){ if(all[i].name===p.name && all[i].to===p.key && all[i].date===p.date){
    sh.getRange(all[i].row,5).setValue(p.status); return {ok:true}; } }
  return {ok:false,err:"搵唔到該學生喺呢班嘅行"};
}
function apiCancelDay(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var date=toIso_(p.date), classes=[];
  CLASS_IDS.forEach(function(cid){
    if(sessionsFor(cid).indexOf(date)<0) return;
    var full=readFull(cid), di=full.dates.indexOf(date), cnt=0;
    full.students.forEach(function(nm){ if(markCell(cid,nm,date,"停課",false)) cnt++; });
    full.mk.forEach(function(x){ if(x.statuses[di]){ markCell(cid,x.name,date,"停課",false); cnt++; } });
    if(cnt) classes.push({sport:cid, key:cid, wd:CLASSES[cid].dayZh, n:cnt});
  });
  var sh=makeupSheet();
  makeupAll().forEach(function(m){ if(m.date!==date) return;
    var cid=m.to; if(!(CLASSES[cid] && sessionsFor(cid).indexOf(date)>=0)) sh.getRange(m.row,5).setValue("停課");
  });
  logAppend({name:"(全班)",key:"-",action:"cancelDay",date:date,status:"停課"});
  notify("【停課】"+date, "今日課堂已標記為停課（共 "+classes.length+" 班）。按報名須知計一堂、不設補堂。");
  return {ok:true, date:date, classes:classes};
}
/* 停課（不收費）：某日課堂取消且唔收費 → 該堂從 sessionsFor 剔走（學費自動少計一堂）。
   已繳該期費嘅學生 → 多收咗一堂，自動順延做下一期折扣（抵扣 ledger）。
   未繳 → 重算即自動平。idempotent：同日再撳唔會重覆扣。 */
function apiCancelDayFree(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var date=toIso_(p.date), label=periodLabelFromIso_(date), nextLab=periodAfter_(label);
  var m=settingsMap(), affected=[];
  CLASS_IDS.forEach(function(cid){
    if(sessionsFor(cid).indexOf(date)<0) return;     // 該班嗰日本身唔上堂／已停 → skip
    affected.push(cid);
  });
  if(!affected.length) return {ok:false, err:"當日冇恆常班上堂（或已停課）"};
  backup();
  // 1) 已繳/豁免該期嘅學生 → 順延一堂折扣去下一期（先記 ledger，後面 genPeriodNet_ 自動套）
  var paidRows={}; feeRows_().forEach(function(x){ if(x.period===label) paidRows[x.name]=x.status; });
  var credited=[];
  affected.forEach(function(cid){
    (CLASSES[cid].students||[]).forEach(function(nm){
      var st=paidRows[nm];
      if(st==="已繳"||st==="豁免"){
        var rate=(weeklySessions_(nm)>=2?PERIOD_RATE_2:PERIOD_RATE_1);
        if(addCredit_(nm, nextLab, rate, classLabel_(cid)+" "+date+" 停課")) credited.push(nm);
      }
    });
  });
  // 2) 把該日加入 cancelled_cN（sessionsFor 之後唔再計 → 學費自動少一堂）
  affected.forEach(function(cid){
    var arr=Array.isArray(m["cancelled_"+cid])?m["cancelled_"+cid].slice():[];
    if(arr.map(toIso_).indexOf(date)<0){ arr.push(date); upsertSetting_("cancelled_"+cid, JSON.stringify(arr)); }
  });
  // 3) 重算本期（未繳自動少一堂）＋下一期（套用順延折扣）；4) 重建受影響 grid（剔走該日）
  genPeriodNet_(label, false, true);
  genPeriodNet_(nextLab, false, true);
  affected.forEach(function(cid){ try{ buildGrid(SS(),cid,false); }catch(e){} });
  logAppend({name:"(全班)",key:"-",action:"cancelDayFree",date:date,status:"停課·不收費"});
  notify("【停課·不收費】"+date, "已取消 "+affected.length+" 班（不收費）：\n• 該期學費自動少計一堂\n• 已繳家長自動順延 "+credited.length+" 位做「"+nextLab+"」折扣");
  return {ok:true, date:date, classes:affected, credited:credited.length, nextPeriod:nextLab};
}

/* ═══════════════════════════════════════════════
   B 相容層：load / save_attendance / save_absences / save_settings
   ─ 出席真相來源 = 格仔；以下由格仔反推 B 前端期望嘅資料形狀
   ═══════════════════════════════════════════════ */
function apiLoad(p){
  // load 會回傳全校資料(出席/補堂/成績/體測/醫療備註等),只准教練;匿名 /exec?action=load 一律拒絕。
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false, err:"未授權"};
  var attendance=[], absencesRaw=[];
  CLASS_IDS.forEach(function(cid){
    var full=readFull(cid);
    full.students.forEach(function(nm){ var st=full.reg[nm]||[];
      st.forEach(function(zh,i){ if(!zh) return;
        var en=ZH2EN[zh]; if(en) attendance.push({key:cid+"|"+full.dates[i], name:nm, status:en});
        if(zh==="請假"||zh==="缺席") absencesRaw.push({name:nm, classId:cid, absDate:full.dates[i]});
      });
    });
    full.mk.forEach(function(x){ x.statuses.forEach(function(zh,i){ if(!zh) return;
      var en=ZH2EN[zh]; if(en) attendance.push({key:cid+"|"+full.dates[i], name:x.name, status:en}); }); });
  });
  // madeUpDate：每名學生嘅補堂 ledger（出席）按最舊缺席配對
  var mkByName={};
  makeupAll().forEach(function(m){
    var onGrid = CLASSES[m.to] && sessionsFor(m.to).indexOf(m.date)>=0;
    var stt = onGrid ? (makeupStatus(m.to,m.name,m.date)||"補堂") : (m.status||"補堂");
    if(stt==="出席"){ (mkByName[m.name]=mkByName[m.name]||[]).push(m.date); }
  });
  Object.keys(mkByName).forEach(function(n){ mkByName[n].sort(); });
  var absences=[], idx=0, used={}, dlMap=dlExtMap_();
  absencesRaw.sort(function(a,b){ return a.absDate.localeCompare(b.absDate); });
  absencesRaw.forEach(function(a){
    var done=null, pool=mkByName[a.name];
    if(pool){ used[a.name]=used[a.name]||0; if(used[a.name]<pool.length){ done=pool[used[a.name]]; used[a.name]++; } }
    absences.push({ id:"g"+(idx++), name:a.name, classId:a.classId, absDate:a.absDate,
      deadline:(dlMap[a.name+"|"+a.classId+"|"+a.absDate] || addMonthsIso(a.absDate, CONFIG.MAKEUP_MONTHS)), madeUpDate:done });
  });
  // settings / perf / body / grades
  var settings=settingsRows_();
  var performance=tableRows_("Perf", ["name","metricId","date","val","v1","v2","v3"]);
  var body=tableRows_("Body", ["name","date","height","weight"]);
  var grades=tableRows_("Grades", ["name","grade"]);
  return {ok:true, version:VERSION, attendance:attendance, absences:absences,
    settings:settings, performance:performance, body:body, grades:grades, medNotes:medNotesAll(), fee_paid:[]};
}
function settingsRows_(){
  var sh=settingsSheet(); if(!sh||sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,2).getValues()
    .filter(function(r){return String(r[0]||"").trim();})
    .map(function(r){ return {key:String(r[0]), value:String(r[1])}; });
}
// 只回公眾假期陣列(非敏感),家長頁顯示假期用;不含任何學生個人資料。
function apiHolidays(p){
  var holidays=[];
  settingsRows_().forEach(function(r){
    if(r.key==="public_holidays"){ try{ var a=JSON.parse(r.value); if(Array.isArray(a)) holidays=a; }catch(e){} }
  });
  // 併入 EXTRA_HOLIDAYS（如 2026-07-01 全校停課）→ 前端補堂日期會自動排除呢啲日
  EXTRA_HOLIDAYS.forEach(function(d){ var iso=toIso_(d); if(holidays.indexOf(iso)<0) holidays.push(iso); });
  return {ok:true, holidays:holidays};
}
/* ═══════════════════════════════════════════════
   私人訓練（PT）：與恆常班分開，無請假/補堂，只記「邊日上咗堂」
   資料表「私人訓練」：學生 | 日期 | 期數 | 第幾堂 | 記錄時間（每行一堂）
   每位學員各自獨立堂數；夠 PT_CYCLE 堂自動開新一期。
   ═══════════════════════════════════════════════ */
function ptSheet(){
  var sh=SS().getSheetByName("私人訓練");
  if(!sh){
    sh=SS().insertSheet("私人訓練");
    sh.getRange(1,1,1,5).setValues([["學生","日期","期數","第幾堂","記錄時間"]]);
    sh.setFrozenRows(1);
    sh.getRange("A:E").setNumberFormat("@");   // 文字格式，避免日期被自動轉
  }
  return sh;
}
function ptRows_(){
  var sh=ptSheet(); if(sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,5).getValues().map(function(r,i){
    return {row:i+2, name:String(r[0]||"").trim(), date:toIso_(r[1]),
      cycle:Number(r[2])||1, no:Number(r[3])||0, at:String(r[4]||"")};
  }).filter(function(r){ return r.name && r.date; });
}
function ptSummary_(name){
  var rows=ptRows_().filter(function(r){ return r.name===name; })
    .sort(function(a,b){ return a.date.localeCompare(b.date) || (a.no-b.no); });
  var maxCycle=1; rows.forEach(function(r){ if(r.cycle>maxCycle) maxCycle=r.cycle; });
  var cur=rows.filter(function(r){ return r.cycle===maxCycle; });
  return {
    name:name, cycle:maxCycle, cap:PT_CYCLE, done:cur.length, totalDone:rows.length,
    curSessions:cur.map(function(r){ return {date:r.date, no:r.no}; }),
    sessions:rows.map(function(r){ return {date:r.date, cycle:r.cycle, no:r.no}; })
  };
}
function ptForFamily_(cn){
  // 該登入帳號（cn）名下有冇私訓 slot；有就回 summary（用記錄名 name）
  var hit=PT_STUDENTS.filter(function(s){ return s.family===cn; });
  if(!hit.length) return null;
  // 同一家可有多個 slot；目前每家最多一個，取第一個
  return ptSummary_(hit[0].name);
}
function apiPtCoachLoad(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  return {ok:true, cap:PT_CYCLE, today:todayIso(),
    students:PT_STUDENTS.map(function(s){ return ptSummary_(s.name); })};
}
function apiPtMark(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var name=String(p.name||"").trim();
  if(!PT_STUDENTS.some(function(s){ return s.name===name; })) return {ok:false,err:"非私人訓練學員"};
  var date=p.date? toIso_(p.date) : todayIso();
  var rows=ptRows_().filter(function(r){ return r.name===name; });
  if(rows.some(function(r){ return r.date===date; }))
    return {ok:false, dup:true, err:date+" 已記錄此學員", summary:ptSummary_(name)};
  var maxCycle=1; rows.forEach(function(r){ if(r.cycle>maxCycle) maxCycle=r.cycle; });
  var inCur=rows.filter(function(r){ return r.cycle===maxCycle; }).length;
  var cycle, no;
  if(rows.length===0){ cycle=1; no=1; }
  else if(inCur>=PT_CYCLE){ cycle=maxCycle+1; no=1; }   // 夠 PT_CYCLE 堂 → 自動開新一期
  else { cycle=maxCycle; no=inCur+1; }
  ptSheet().appendRow([name, date, String(cycle), String(no), nowStamp_()]);
  logAppend({name:name, key:"PT", action:"pt_mark", date:date, status:"第"+cycle+"期 第"+no+"堂"});
  return {ok:true, newCycle:(no===1 && cycle>1), cycle:cycle, no:no, summary:ptSummary_(name)};
}
function apiPtUndo(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var name=String(p.name||"").trim();
  var rows=ptRows_().filter(function(r){ return r.name===name; });
  if(!rows.length) return {ok:false,err:"未有記錄"};
  var target;
  if(p.date){ var d=toIso_(p.date);
    target=rows.filter(function(r){ return r.date===d; }).sort(function(a,b){ return b.row-a.row; })[0];
  } else {
    target=rows.sort(function(a,b){ return b.date.localeCompare(a.date) || (b.row-a.row); })[0];
  }
  if(!target) return {ok:false,err:"搵唔到該記錄"};
  ptSheet().deleteRow(target.row);
  logAppend({name:name, key:"PT", action:"pt_undo", date:target.date, status:"撤銷"});
  return {ok:true, summary:ptSummary_(name)};
}
/* 私訓：內部加一堂（idempotent；同名同日已存在則跳過）。自動計期數／第幾堂。回傳係咪新增。 */
function ptAdd_(name, date){
  name=String(name||"").trim(); date=toIso_(date);
  if(!name || !date) return false;
  var rows=ptRows_().filter(function(r){ return r.name===name; });
  if(rows.some(function(r){ return r.date===date; })) return false;   // 已有同日 → 跳過
  var maxCycle=1; rows.forEach(function(r){ if(r.cycle>maxCycle) maxCycle=r.cycle; });
  var inCur=rows.filter(function(r){ return r.cycle===maxCycle; }).length;
  var cycle, no;
  if(rows.length===0){ cycle=1; no=1; }
  else if(inCur>=PT_CYCLE){ cycle=maxCycle+1; no=1; }   // 夠 PT_CYCLE 堂 → 自動開新一期
  else { cycle=maxCycle; no=inCur+1; }
  ptSheet().appendRow([name, date, String(cycle), String(no), nowStamp_()]);
  return true;
}
/* 種私訓資料：示範帳號 陳大文（跟恆常班節奏，每週一堂、穩定上課，現處第 1 期）
   ＋ 鄧可澄(2026-06-12)、Keith & Elaine(2026-06-13) 實際記錄。
   全部 idempotent：已有同日記錄就跳過，可安全重複執行。 */
function seedPtData(){
  // (1) 示範帳號 陳大文：跟恆常班 c1（星期一）節奏，每週一堂，已連續上 7 堂（現 7/10，似快完一期嘅恆常學生）
  var demo="陳大文";
  if(CLASSES.c1 && CLASSES.c1.students.indexOf(demo)>=0 &&
     ptRows_().filter(function(r){ return r.name===demo; }).length===0){
    var anchor=new Date(todayIso()+"T00:00:00");
    var back=(anchor.getDay()-1+7)%7; if(back===0) back=7;   // today 之前最近一個星期一
    var lastMon=new Date(anchor.getTime()); lastMon.setDate(lastMon.getDate()-back);
    for(var k=6;k>=0;k--){ var d=new Date(lastMon.getTime()); d.setDate(d.getDate()-k*7); ptAdd_(demo, iso(d)); }
  }
  // (2) 實際記錄
  ptAdd_("鄧可澄", "2026-06-12");
  ptAdd_("Keith & Elaine", "2026-06-13");
  Logger.log("私訓示範／記錄已種（idempotent）。");
}
function tableRows_(sheetName, cols){
  var sh=SS().getSheetByName(sheetName); if(!sh||sh.getLastRow()<2) return [];
  var w=cols.length, v=sh.getRange(2,1,sh.getLastRow()-1,w).getValues();
  return v.filter(function(r){return String(r[0]||"").trim();}).map(function(r){
    var o={}; cols.forEach(function(c,i){ o[c]= (c==="date")?toIso_(r[i]) : r[i]; }); return o;
  });
}
function apiSaveAttendance(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var d=p.data||{}, key=d.key||"", session=d.session||{};
  var parts=key.split("|"), cid=parts[0], date=parts[1];
  if(!CLASSES[cid]) return {ok:false,err:"班別不存在"};
  Object.keys(session).forEach(function(nm){
    var zh=EN2ZH[session[nm]] || "";
    markCell(cid, nm, date, zh, true);   // 正規或補堂行皆可
  });
  logAppend({name:"(批量)",key:cid,action:"save_attendance",date:date,status:Object.keys(session).length+"人"});
  return {ok:true};
}
function apiSaveAbsences(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  // B 推送 ABSENCES：確保缺席格已標、已補嘅寫入 ledger（非破壞，去重）
  var arr=p.data||[]; var existing=makeupAll();
  arr.forEach(function(a){
    if(!a||!a.classId||!CLASSES[a.classId]) return;
    if(a.absDate && sessionsFor(a.classId).indexOf(a.absDate)>=0){
      var blk=readBlock(a.classId), st=(blk.status[a.name]||[]), di=blk.dates.indexOf(a.absDate);
      var cur=di>=0?String(st[di]||""):"";
      if(!cur) markCell(a.classId, a.name, a.absDate, "請假", false);  // 未標先補標請假
    }
    if(a.madeUpDate){ // 已補 → 記入 ledger（去重）；目標班未知 → 記特殊日
      var dup=existing.some(function(m){ return m.name===a.name && m.from===a.classId && m.date===toIso_(a.madeUpDate); });
      if(!dup){ var M=makeupSheet(), row=M.getLastRow()+1; M.getRange(row,4).setNumberFormat("@");
        M.getRange(row,1,1,5).setValues([[a.name, a.classId, a.classId, toIso_(a.madeUpDate), "出席"]]); }
    }
  });
  return {ok:true};
}
function apiSaveSettings(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var data=p.data||{}, sh=settingsSheet();
  if(!sh){ sh=SS().insertSheet("Settings"); sh.appendRow(["key","value"]); }
  var existing={}, last=sh.getLastRow();
  if(last>=2) sh.getRange(2,1,last-1,1).getValues().forEach(function(r,i){ var k=String(r[0]||""); if(k) existing[k]=i+2; });
  Object.keys(data).forEach(function(k){
    var val=(typeof data[k]==="string")?data[k]:JSON.stringify(data[k]);
    if(existing[k]) sh.getRange(existing[k],2).setValue(val);
    else { sh.appendRow([k,val]); existing[k]=sh.getLastRow(); }
  });
  return {ok:true};
}

/* ═══════════ 通知 / 提醒 ═══════════ */
var _SUPPRESS_NOTIFY=false;   // 寫入自我測試期間設 true，免發測試 email 騷擾老闆
function notify(subject, body){
  if(_SUPPRESS_NOTIFY) return;
  // 用 MailApp（窄權限：只「以你身份寄信」）取代 GmailApp（要求闊 Gmail 讀寫權限）
  try{ MailApp.sendEmail(CONFIG.COACH_EMAIL, "INITIATE SPORTS · "+subject, body); }catch(e){}
}
function ensureReminders(){
  try{
    var has=ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction()==="remindUnmarked"; });
    if(!has) ScriptApp.newTrigger("remindUnmarked").timeBased().everyDays(1).atHour(CONFIG.REMIND_HOUR||20).create();
  }catch(e){}
}
function remindUnmarked(){
  var today=todayIso(), lines=[];
  CLASS_IDS.forEach(function(cid){
    if(sessionsFor(cid).indexOf(today)<0) return;
    var full=readFull(cid), di=full.dates.indexOf(today), miss=[];
    full.students.forEach(function(nm){ if(!((full.reg[nm]||[])[di]||"")) miss.push(nm); });
    full.mk.forEach(function(x){ if(x.statuses[di]==="補堂") miss.push(x.name+"(補)"); });
    if(miss.length) lines.push("・"+classLabel_(cid)+"："+miss.length+" 人未點 — "+miss.join("、"));
  });
  if(!lines.length) return;
  notify("【點名提醒】今日仲有未完成", today+"（星期"+WDN[new Date(today+"T00:00:00").getDay()]+"）\n"
    +lines.join("\n")+"\n\n請開教練版補返點名。");
}

/* ═══════════ 出席報表 ═══════════ */
function buildReport(){
  var ss=SS(), sh=ss.getSheetByName("出席報表")||ss.insertSheet("出席報表");
  sh.clear();
  sh.appendRow(["INITIATE SPORTS · 出席報表","","","","","","","",""]);
  sh.appendRow(["產生時間："+Utilities.formatDate(new Date(),tz(),"yyyy-MM-dd HH:mm"),"","","","","","","",""]);
  sh.appendRow(["班別","星期","學生","總堂","已上","請假","缺席","補堂(約/到)","出席率"]);
  var rows=[], mkAll=makeupUniq_();
  CLASS_IDS.forEach(function(cid){
    var full=readFull(cid), c=CLASSES[cid];
    full.students.forEach(function(nm){
      var st=full.reg[nm]||[], att=0,lv=0,ab=0;
      st.forEach(function(s){ if(s==="出席")att++; else if(s==="請假")lv++; else if(s==="缺席")ab++; });
      var myMk=mkAll.filter(function(m){ return m.from===cid && m.name===nm; }), mkAtt=0, mkAb=0;
      myMk.forEach(function(m){ var onG=CLASSES[m.to]&&sessionsFor(m.to).indexOf(m.date)>=0;
        var s=onG?makeupStatus(m.to,nm,m.date):(m.status||"");
        if(s==="出席")mkAtt++; else if(s==="缺席")mkAb++; });
      var present=att+mkAtt, held=present+ab+mkAb;
      var rate=held>0?Math.round(present/held*100)+"%":"—";
      rows.push([cid+" "+c.time,"星期"+c.dayZh.slice(-1),nm,full.dates.length,present,lv,ab,myMk.length+"/"+mkAtt,rate]);
    });
  });
  if(rows.length) sh.getRange(4,1,rows.length,9).setValues(rows);
  sh.getRange(1,1,1,9).merge().setFontSize(14).setFontWeight("bold").setBackground("#1BAFBD").setFontColor("#FFFFFF").setHorizontalAlignment("center");
  sh.getRange(2,1,1,9).merge().setFontColor("#999").setFontSize(10);
  sh.getRange(3,1,1,9).setFontWeight("bold").setBackground("#EAF8FA");
  sh.setFrozenRows(3); sh.setColumnWidth(1,120); sh.setColumnWidth(3,96); sh.setColumnWidth(8,86);
  try{ SpreadsheetApp.getUi().alert("已產生「出席報表」分頁（"+rows.length+" 位學生）。"); }catch(e){}
  return rows.length;
}

/* ═══════════ 選單 ═══════════ */
function onOpen(){
  var ui=SpreadsheetApp.getUi();
  var maint=ui.createMenu("⚙️ 安裝 / 維護（少用）")
    .addItem("🔑 一次性授權上網/寄信","authorizeNow")
    .addItem("🩺 安裝每日健康檢查（約 08:00）","installHealthCheck")
    .addItem("📦 安裝每月異地備份（email xlsx）","installMonthlyBackup")
    .addItem("📦 立即寄一份異地備份（測試）","monthlyOffsiteBackupMenu")
    .addItem("📊 安裝營運簡報（逢一催繳＋月報）","installOpsReports")
    .addItem("📈 立即寄月度營運報表（測試）","monthlyOpsReportMenu");
  ui.createMenu("INITIATE")
    .addItem("初始化 / 更新（保留資料）","setup")
    .addItem("產生出席報表","buildReport")
    .addItem("產生繳費列（本期＋下期）","genCurrentPeriodFees")
    .addItem("🧾 7-8月學費試算（按淨堂，不寫入）","genPeriod78NetDryRun")
    .addItem("💰 7-8月學費寫入（按淨堂＋豁免＋額外收費）","genPeriod78NetApply")
    .addItem("🔄 核實回歸申請（退出學生付款回歸）","reviewReturnsMenu")
    .addSeparator()
    .addItem("立即備份","backup")
    .addItem("備份到 Drive（整份複製）","backupToDrive")
    .addItem("備份清單","listBackups")
    .addItem("還原至最近備份（最完整）","restoreLatest")
    .addItem("還原（自選時間）","restoreChoose")
    .addSeparator()
    .addItem("⬇️ 匯入家長資料（IS App Data）","importParentDataMenu")
    .addItem("⬇️ 匯入繳費標記（IS App Data）","importFeesMenu")
    .addItem("🔄 重建學生名冊（只顯示現時班別）","rebuildRosterMenu")
    .addItem("🔧 校正繳費每週堂數（以名冊為準）","syncFeesFromRosterMenu")
    .addSeparator()
    .addItem("🧹 清理重複補堂行（先自動備份）","cleanupDupMakeupMenu")
    .addItem("🧹 清走未來誤標出席（保留未來請假/停課）","cleanFutureAttendanceMenu")
    .addItem("🔧 修復格仔姓名（誤刪還原）","repairGridNamesMenu")
    .addItem("🩹 確認已收病假紙（離線）→ 改回請假","markSickCertReceivedMenu")
    .addItem("🔁 套用名單改動（重建出席表＋重算學費）","migrateLeungC3toC4Menu")
    .addSeparator()
    .addItem("🩺 全面健康檢查（前端/後端/家長/教練/資料）","healthCheckMenu")
    .addItem("💸 立即寄催繳名單","weeklyUnpaidReportMenu")
    .addSeparator()
    .addSubMenu(maint)
    .addToUi();
}

/* ═══════════ 每月異地備份（email xlsx 附件）═══════════
 * 把核心營運試算表匯出 xlsx 作 email 附件寄畀老闆，令備份「離開 Google Drive」。
 * 萬一 Google 帳號被鎖/盜，仲有 email 收件箱（甚至可轉寄去非 Google 信箱）嗰份可救。
 * 收件人：指令碼屬性 BACKUP_EMAIL（自己設，唔使畀我睇）；未設就用 HEALTH_EMAIL。
 * 安裝：選單「📦 安裝每月異地備份」撳一次（順便授權）。 */
var OFFSITE_TARGETS = [
  {id:"1MwIOIZ8tv6XXEnqlTlZgLli4cwlDMqHFxxusgefXvyE", name:"出席補堂系統(#4)"},
  {id:"1prjceGydcVHvhidlp8SZEJ1abE0Cvz2WqwrjN6_K7qo", name:"IS App Data(#11)"},
  {id:"1EKLNEShazlt1N9HFvGK3E2vsxh_sAq08doofIom81zc", name:"6-7月報名系統(#1)"}
];
var OFFSITE_EMAILS = ["initiatesports6331@gmail.com", "leocheung0615@gmail.com"];  // 固定寄去呢兩個信箱（雙保險）
function monthlyOffsiteBackup(){
  var extra=PropertiesService.getScriptProperties().getProperty("BACKUP_EMAIL");   // 想再多一個收件人就設呢個屬性
  var list=OFFSITE_EMAILS.slice();
  if(extra && list.indexOf(extra)<0) list.push(extra);
  var to=list.join(",");
  var stamp=Utilities.formatDate(new Date(), tz(), "yyyy-MM-dd");
  var attachments=[], failed=[];
  OFFSITE_TARGETS.forEach(function(t){
    try{
      var url="https://docs.google.com/spreadsheets/d/"+t.id+"/export?format=xlsx";
      var blob=UrlFetchApp.fetch(url,{headers:{Authorization:"Bearer "+ScriptApp.getOAuthToken()},muteHttpExceptions:true}).getBlob();
      blob.setName(t.name+"_"+stamp+".xlsx");
      attachments.push(blob);
    }catch(e){ failed.push(t.name+"："+e); }
  });
  MailApp.sendEmail({
    to: to,
    subject: "📦 INITIATE 每月異地備份 "+stamp+(failed.length?"（部分失敗）":""),
    body: "附件為各營運試算表 xlsx 副本，建議下載另存（脫離 Google Drive 作異地備份）。\n\n包含：\n• "+
          OFFSITE_TARGETS.map(function(t){return t.name;}).join("\n• ")+
          (failed.length?("\n\n⚠️ 匯出失敗：\n• "+failed.join("\n• ")):"")+
          "\n\n—— 每月自動異地備份",
    attachments: attachments
  });
  Logger.log("異地備份：寄出 "+attachments.length+" 個附件，失敗 "+failed.length);
  return {sent:attachments.length, failed:failed.length};
}
function installMonthlyBackup(){
  ScriptApp.getProjectTriggers().forEach(function(t){ if(t.getHandlerFunction()==="monthlyOffsiteBackup") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("monthlyOffsiteBackup").timeBased().onMonthDay(1).atHour(7).create();   // 每月 1 號約 07:00
  try{ SpreadsheetApp.getUi().alert("✅ 每月異地備份已設定（每月 1 號約 07:00 寄 xlsx 副本去：\n• "+OFFSITE_EMAILS.join("\n• ")+"）。\n想再加一個收件人：專案設定 → 指令碼屬性 → 加 BACKUP_EMAIL。"); }catch(e){}
  return "已設定";
}
function monthlyOffsiteBackupMenu(){
  var r=monthlyOffsiteBackup();
  SpreadsheetApp.getUi().alert("已寄出 "+r.sent+" 個 xlsx 附件"+(r.failed?("（"+r.failed+" 個失敗）"):"")+"。\n請查收 email（未設定時用預設收件箱）。");
}

/* ═══════════ 每日系統健康檢查 ═══════════
 * 每日自動 ping 4 個後端 /exec + 各前端頁面；有異常先 email 老闆（正常唔寄，免騷擾）。
 * 安裝：選單「🩺 安裝每日健康檢查」撳一次（順便授權 UrlFetch + 寄信）。
 * 測試：選單「🩺 立即健康檢查」即時跑一次並彈出結果。 */
var HEALTH_EMAIL = "initiatesports6331@gmail.com";
/* 🔑 一次性授權：故意「唔包 try/catch」咁用 UrlFetch + MailApp，
 * 令 Apps Script 偵測到缺 scope → 彈出授權視窗，批准一次即解決健康檢查/異地備份紅字。
 * （healthCheck 等function內部 try/catch 接住咗錯誤，所以唔會觸發授權，故另設此function。）*/
function authorizeNow(){
  UrlFetchApp.fetch("https://www.google.com");                       // 觸發「連線至外部服務」授權
  MailApp.sendEmail(HEALTH_EMAIL, "INITIATE 授權成功 ✅",
    "你收到呢封 email，代表上網同寄信權限已經批准。\n之後「立即健康檢查」應該會顯示全部正常。");
  return "authorized";
}
var HEALTH_BACKENDS = [
  {name:"#4 unified-system",  url:"https://script.google.com/macros/s/AKfycbxeQizogWDoNl6PhAp_sE3_HfFc8MAtYEd-66k7zF3rRyhxPOM7qmnxYx6EzFUkiHLb/exec", expect:"is-unified-v2"},
  {name:"#11 parent-portal",  url:"https://script.google.com/macros/s/AKfycbxuJ6ypxGG3bZi5SGtgPkedl3fs0mm3SJ3c9DcauTN0SDzfTvSw7nyTBcaaI5vC9GU/exec", expect:null},
  {name:"#9 attendance-grid", url:"https://script.google.com/macros/s/AKfycby9Ln3kZUubqRIuGdCF5cJ5tk4KuPITMQDuOFFuee1OwrId5gUa_sP_W5CuHga9y6i8/exec", expect:"v2-grid"},
  {name:"#1 booking",         url:"https://script.google.com/macros/s/AKfycbyQQoDyXnXB5vFNlUYUW-FU56zOkOhGgwIyRzGMNQ-IX0e5jigwFpqyJDsWNFx4hilj/exec", expect:"\"ok\":true"},
  {name:"#10 暑期報名",       url:"https://script.google.com/macros/s/AKfycbwRW3PBA6GA0I7AvHOdPVPkpsAl-Qi2vvmz-MDUtLGX4Vw0mI9whfkwXb6ddMgGZOU/exec", expect:"quota"}
];
// {url, expect}：expect = 頁面 HTML 應含嘅關鍵字（確認唔係 404/空白/錯版本；非 null 先檢查）
var HEALTH_PAGES = [
  {url:"https://initiatesports.github.io/IS-APP/is-home.html",                expect:"Initiate Sports"},
  {url:"https://initiatesports.github.io/IS-APP/is-hub.html",                 expect:"INITIATE 控制台"},
  {url:"https://initiatesports.github.io/IS-APP/is-parent.html",              expect:"請假補堂"},
  {url:"https://initiatesports.github.io/IS-APP/is-coach.html",               expect:"教練點名"},
  {url:"https://initiatesports.github.io/IS-APP/is-leave-makeup.html",        expect:"請假補堂系統"},
  {url:"https://initiatesports.github.io/IS-APP/is-attendance-app.html",      expect:"IS 出席系統"},
  {url:"https://initiatesports.github.io/IS-APP/initiate-sports-booking.html",expect:null},
  {url:"https://initiatesports.github.io/SUMMER-COURSE-2026/index.html",      expect:"暑期運動班"}
];
// 探測一個 URL，最多試 3 次：任何一次成功即放行；連續失敗先當異常。
// 避免 Apps Script /exec 或 GitHub Pages 偶發短暫 blip（如 404/500）造成假警報。
function probeOk_(url, expect){
  var lastBad="連線失敗";
  for(var a=0; a<3; a++){
    try{
      var r=UrlFetchApp.fetch(url,{muteHttpExceptions:true,followRedirects:true});
      var code=r.getResponseCode();
      if(code===200){
        if(expect && r.getContentText().indexOf(expect)<0){ lastBad="回應異常（缺「"+expect+"」）"; }
        else return {ok:true};
      } else { lastBad="HTTP "+code; }
    }catch(err){ lastBad="連線失敗："+err; }
    if(a<2) Utilities.sleep(2500);   // 等 2.5 秒再試
  }
  return {ok:false, why:lastBad};
}
// 並行探測多個 URL（fetchAll 一次過併發），失敗者隔 2.5 秒再批量重試一次（避開偶發 blip）。
// 取代逐個 probeOk_ 順序等待，把 13 個探測由「逐個累加」變「兩輪併發」，大幅減省健康檢查時間。
function probeJudge_(r, expect){
  if(!r) return "連線失敗";
  var code; try{ code=r.getResponseCode(); }catch(e){ return "連線失敗"; }
  if(code!==200) return "HTTP "+code;
  if(expect){ try{ if(r.getContentText().indexOf(expect)<0) return "回應異常（缺「"+expect+"」）"; }catch(e){ return "讀內容失敗"; } }
  return null;
}
function probeBatch_(items){
  var out=[];
  function run(list){
    var reqs=list.map(function(it){ return {url:it.url, muteHttpExceptions:true, followRedirects:true}; });
    var res; try{ res=UrlFetchApp.fetchAll(reqs); }catch(e){ res=[]; }
    var fail=[];
    list.forEach(function(it,i){ var bad=probeJudge_(res[i], it.expect); if(bad){ it._bad=bad; fail.push(it); } });
    return fail;
  }
  var fail=run(items);
  if(fail.length){ Utilities.sleep(2500); fail=run(fail); }   // 失敗者再批量重試一次
  fail.forEach(function(it){ out.push(it.name+" → "+it._bad); });
  return out;
}
// ═══════ 全面資料完整性檢查（直接掃 Sheet，唔靠登入）═══════
// 覆蓋：grid 姓名(空白/對唔上名冊/重複)、補堂區不明姓名、缺日期欄、非法狀態、未來誤標出席、
//       #11/補堂表別字、學費負數、私訓超期/未來。回傳問題陣列。
function dataIntegrityCheck_(){
  var P=[], today=todayIso(), STAT={}, FUT={"出席":1,"補堂":1,"加操":1};
  STATUSES.forEach(function(s){ STAT[s]=1; });
  // 合法嘅未來補堂預約（補去班+日期）：未來格標「補堂」若有對應預約 → 正常，唔當誤報。
  var mkBooked={}; try{ makeupUniq_().forEach(function(m){ mkBooked[m.name+"|"+m.to+"|"+m.date]=1; }); }catch(e){}
  var known={};
  CLASS_IDS.forEach(function(cid){ CLASSES[cid].students.forEach(function(nm){ known[nm]=1; }); });
  PT_STUDENTS.forEach(function(s){ known[s.name]=1; known[s.family]=1; });
  try{ (RETURNABLE||[]).forEach(function(nm){ known[nm]=1; }); }catch(e){}
  CLASS_IDS.forEach(function(cid){
    var m=gridMeta(cid); if(!m.sh){ P.push("出席格 "+cid+" 唔見咗分頁"); return; }
    var sh=m.sh, studs=CLASSES[cid].students, n=studs.length;
    var allNames=sh.getRange(DATA_START,NAME_COL,n+MK_MAX,1).getValues().map(function(r){ return String(r[0]||"").trim(); });
    // 序號連續性：規則行序號應為 1..N（捉人手插/刪整行致全班錯位）
    var seq=sh.getRange(DATA_START,SEQ_COL,n,1).getValues();
    for(var si=0;si<n;si++){ if(String(seq[si][0]||"").replace(/\D/g,"")!==String(si+1)){ P.push(cid+" 序號錯位（第"+(si+1)+"行序號應為 "+(si+1)+"，疑插/刪咗行）"); break; } }
    var seen={};
    for(var i=0;i<n;i++){ var nm=allNames[i];
      if(!nm){ P.push(cid+" 第"+(i+1)+"行姓名空白（應為 "+studs[i]+"）"); }
      else { if(nm!==studs[i]) P.push(cid+" 第"+(i+1)+"行姓名「"+nm+"」對唔上名冊「"+studs[i]+"」");
             if(seen[nm]) P.push(cid+" 規則名單姓名重複："+nm); seen[nm]=1; } }
    for(var j=0;j<MK_MAX;j++){ var mn=allNames[n+j]; if(mn && !known[mn]) P.push(cid+" 補堂區有不明姓名（疑別字）："+mn); }
    if(m.physN>0){
      sessionsFor(cid).forEach(function(d){ if(d<today && m.colOf[mmdd_(d)]==null) P.push(cid+" 缺過往上課日欄："+d); });
      var nR=n+MK_MAX, blk=sh.getRange(DATA_START,DATE_COL0,nR,m.physN).getValues(), offIso={};
      m.dates.forEach(function(d){ var o=m.colOf[mmdd_(d)]; if(o!=null) offIso[o]=d; });
      for(var r2=0;r2<nR;r2++){ var who=allNames[r2]||("#"+(r2+1)); for(var off=0;off<m.physN;off++){
        var v=String(blk[r2][off]||""); if(!v) continue;
        if(!STAT[v]){ P.push(cid+" "+who+" 有非法狀態「"+v+"」"); continue; }
        var iso=offIso[off];
        // 未來格標出席類 → 誤報；但「補堂」若有對應預約屬合法（家長預約咗未來補堂），唔當異常。
        if(iso && iso>today && FUT[v] && !(v==="補堂" && mkBooked[who+"|"+cid+"|"+iso])) P.push(cid+" "+who+" "+iso+" 未到但標咗「"+v+"」"); } }
    }
  });
  try{ var sA={}; is11_().abs.forEach(function(a){ if(a.name && !known[a.name] && !sA[a.name]){ sA[a.name]=1; P.push("#11 請假紀錄有不明姓名（疑別字）："+a.name); } }); }catch(e){}
  try{ var sM={}; makeupAll().forEach(function(x){ if(x.name && !known[x.name] && !sM[x.name]){ sM[x.name]=1; P.push("補堂表有不明姓名（疑別字）："+x.name); } }); }catch(e){}
  try{ feeRows_().forEach(function(f){ if(Number(f.net)<0) P.push("學費負數："+f.name+" "+f.period+" = $"+f.net); }); }catch(e){}
  try{ PT_STUDENTS.forEach(function(s){ var sum=ptSummary_(s.name); if(!sum) return;
    if(Number(sum.done)>Number(sum.cap)) P.push("私訓 "+s.name+" 本期堂數 "+sum.done+" 超上限 "+sum.cap);
    (sum.sessions||[]).forEach(function(x){ if(x.date>today) P.push("私訓 "+s.name+" 有未來日期："+x.date); }); }); }catch(e){}
  // 登入憑證 + 名冊一致：班別學生冇手機後4位（登入唔到）/ 名冊缺學生
  try{
    var rr=rosterRows(), rByCid={};
    rr.forEach(function(r){ if(!r.cid) return; (rByCid[r.cid]=rByCid[r.cid]||[]).push(r.name);
      if(CLASSES[r.cid] && CLASSES[r.cid].students.indexOf(r.name)>=0 && String(r.last4||"").replace(/\D/g,"")==="")
        P.push("名冊 "+r.name+"("+r.cid+") 冇手機後4位，家長登入唔到"); });
    CLASS_IDS.forEach(function(cid){ var rs=rByCid[cid]||[]; CLASSES[cid].students.forEach(function(nm){ if(rs.indexOf(nm)<0) P.push("名冊缺 "+cid+" 學生："+nm); }); });
  }catch(e){}
  // 學費行自洽：實收 = max(0, 應繳 − 折扣 + 調整)（豁免除外）
  try{ feeRows_().forEach(function(f){ if(f.status==="豁免") return; var exp=Math.max(0, f.due - f.discount + f.adj);
    if(Number(f.net)!==exp) P.push("學費不自洽："+f.name+" "+f.period+"：實收$"+f.net+" ≠ 計$"+exp); }); }catch(e){}
  // 學費獨立重算對賬：未繳行重新計一次淨額同儲存值對賬（捉計錯/堂數變/漏重算）
  try{ var curL=curPeriodLabel_(), nextL=nextPeriodLabel_();
    feeRows_().forEach(function(f){
      if(f.status==="已繳"||f.status==="豁免") return;            // 已繳/豁免唔郁
      if(f.period!==curL && f.period!==nextL) return;             // 只查本期＋下期
      if((CUSTOM_FEE[f.period]||{})[f.name]) return;             // 特別安排固定學費（CUSTOM_FEE）→ 唔用標準重算對賬（如周莉晶跨班 $1040）
      var dd=periodFeeDetail_(f.name, f.period); if(!dd) return;
      var disc=referralAutoDisc_(f.name, dd.base, 0), credit=creditsFor_(f.name, f.period);
      var expNet=Math.max(0, dd.base - disc + (dd.extraTot - credit));
      if(Number(f.net)!==expNet) P.push("學費需重算："+f.name+" "+f.period+"：儲存$"+f.net+" ≠ 重算$"+expNet);
    }); }catch(e){}
  // 補堂表重複
  try{ var mkS={}; makeupAll().forEach(function(m){ var k=m.name+"|"+m.from+"|"+m.to+"|"+m.date;
    if(mkS[k]) P.push("補堂表重複："+m.name+" "+m.from+"→"+m.to+" "+m.date); mkS[k]=1; }); }catch(e){}
  // #11 IS App Data 內容驗證：官網成績/出席來源；核心分頁要存在兼有內容（防被清空/壞）
  try{ var d11=SpreadsheetApp.openById(DATA_SS_ID);
    [["attendance",2],["performance",2],["settings",2]].forEach(function(t){
      var sh=d11.getSheetByName(t[0]); if(!sh) P.push("#11 缺分頁："+t[0]); else if(sh.getLastRow()<t[1]) P.push("#11 "+t[0]+" 空（疑被清空）"); });
  }catch(e){ P.push("#11 IS App Data 讀取失敗："+e); }
  // 期數切換守護：本期＋下期學費列要為每個在學學生生成（轉期時最易漏；漏咗家長見唔到要交幾多）
  try{
    var fr=feeRows_(), have={};
    fr.forEach(function(f){ have[f.name+"|"+f.period]=1; });
    var actives={}; rosterRows().forEach(function(r){ if(r.cid && CLASSES[r.cid] && CLASSES[r.cid].students.indexOf(r.name)>=0) actives[r.name]=1; });
    [curPeriodLabel_(), nextPeriodLabel_()].forEach(function(lab){
      Object.keys(actives).forEach(function(nm){ if(!have[nm+"|"+lab]) P.push("學費列未生成："+nm+" "+lab+"（轉期漏咗，請『產生繳費列』）"); });
    });
  }catch(e){}
  return P;
}
// ═══════ 功能層 smoke test：後端直接行四端核心函數，捉 throw / 壞 return ═══════
function functionalCheck_(){
  var P=[], today=todayIso(), cp=CONFIG.COACH_PASS;
  function chk(label, fn){ try{ var r=fn(); if(r && r.ok===false) P.push(label+" 回傳失敗："+(r.err||"?")); }catch(e){ P.push(label+" 出錯："+e); } }
  CLASS_IDS.forEach(function(cid){
    chk("後端 sessionsFor("+cid+")", function(){ var s=sessionsFor(cid); return {ok:!!(s&&s.length)}; });
    chk("後端 readBlockMerged_("+cid+")", function(){ readBlockMerged_(cid); });
    var nm=CLASSES[cid].students[0]; if(nm){
      chk("家長端 classesFor_("+nm+")", function(){ return {ok:Array.isArray(classesFor_(nm))}; });
      chk("家長端 feesFor_("+nm+")", function(){ feesFor_(nm); });
    }
  });
  chk("教練端 今日點名表(dailyList)", function(){ return apiDaily({date:today, coachPass:cp}); });
  chk("教練端 全校載入(load)", function(){ return apiLoad({coachPass:cp}); });
  chk("教練端 學費總覽(feesAll)", function(){ return apiFeesAll({coachPass:cp}); });
  chk("教練端 私訓載入(pt_coach_load)", function(){ return apiPtCoachLoad({coachPass:cp}); });
  return P;
}
// ═══════ 寫入鏈自我測試：用示範帳號 陳大文 行真實「請假→讀寫驗證→取消→驗證清乾淨」round-trip ═══════
// 抑制 email；讀寫驗證，唔受 demo 舊資料影響（apiMakeup 揀最舊請假，狀態依賴，故唔放入自動測試）。
function rbStatus_(cid,nm,date){ var b=readBlock(cid), st=b.status[nm]||[], di=b.dates.indexOf(date); return di>=0?String(st[di]||""):""; }
function writePathCheck_(){
  var P=[], nm="陳大文", cid="c1", today=todayIso();
  if(!CLASSES[cid] || CLASSES[cid].students.indexOf(nm)<0) return P;
  var code=effectiveCred_(pad4(PHONE[nm]||"1234"));
  var futs=sessionsFor(cid).filter(function(d){ return d>today; });
  // 只揀「現時空白」嘅未來上課日 → 絕不覆蓋示範帳號現有資料
  var d=null; for(var i=0;i<futs.length;i++){ if(rbStatus_(cid,nm,futs[i])===""){ d=futs[i]; break; } }
  if(!d) return P;
  _SUPPRESS_NOTIFY=true;
  try{
    var r1=apiLeave({key:cid, name:nm, code:code, date:d, leaveType:"事假"});
    if(!r1||!r1.ok){ P.push("寫入測試・請假寫入失敗："+((r1&&r1.err)||"?")); }
    else if(rbStatus_(cid,nm,d)!=="請假"){ P.push("寫入測試・請假寫咗但讀返唔係請假（讀寫鏈異常）"); }
    var r2=apiCancelLeave({key:cid, name:nm, code:code, date:d});
    if(!r2||!r2.ok){ P.push("寫入測試・取消請假失敗："+((r2&&r2.err)||"?")); }
    else if(rbStatus_(cid,nm,d)!==""){ P.push("寫入測試・取消後仍殘留："+rbStatus_(cid,nm,d)); }
    // 教練點名儲存（save_attendance）：標出席 → 驗 → 清
    var sess={}; sess[nm]="present";
    var r3=apiSaveAttendance({coachPass:CONFIG.COACH_PASS, data:{key:cid+"|"+d, session:sess}});
    if(!r3||!r3.ok){ P.push("寫入測試・教練點名儲存失敗："+((r3&&r3.err)||"?")); }
    else if(rbStatus_(cid,nm,d)!=="出席"){ P.push("寫入測試・點名儲存後讀返唔係出席"); }
  }catch(e){ P.push("寫入測試・出錯："+e); }
  finally{ try{ markCell(cid,nm,d,"",false); }catch(e){} _SUPPRESS_NOTIFY=false; }
  return P;
}
// ═══════ 系統運維健康：關鍵觸發器存在 + 備份新鮮度 ═══════
function opsHealthCheck_(){
  var P=[], today=todayIso(), trigs={};
  try{ ScriptApp.getProjectTriggers().forEach(function(t){ trigs[t.getHandlerFunction()]=1; }); }catch(e){ P.push("讀觸發器失敗："+e); }
  if(!trigs["healthCheck"]) P.push("觸發器缺失：每日健康檢查(healthCheck) 未安裝 → 監察會停");
  if(!trigs["backup"]) P.push("觸發器缺失：每日自動備份(backup) 未安裝 → 冇自動備份");
  try{ var snaps=snapshots_(), keys=Object.keys(snaps).sort();
    if(!keys.length) P.push("冇任何備份紀錄");
    else { var latest=String(keys[keys.length-1]); if(latest.slice(0,10) < addDaysIso(today,-2)) P.push("自動備份似乎停咗（最近一次 "+latest+"）"); }
  }catch(e){}
  // 資料量：Log / 備份 sheet 過大 → readBlock/load 變慢、超時風險（提早警示，可清舊）
  try{ [["Log",8000],["備份",20000]].forEach(function(t){ var sh=SS().getSheetByName(t[0]); if(sh && sh.getLastRow()>t[1]) P.push(t[0]+" 分頁過大（"+sh.getLastRow()+" 行 > "+t[1]+"），建議清舊防超時"); }); }catch(e){}
  return P;
}
function healthCheck(){ return runHealthChecks_(true); }   // 每日 trigger：有問題就 email
// coachPass 保護：即場觸發成個健康檢查並回傳問題清單（唔寄 email，畀教練端/驗證用）
function apiHealth(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  return {ok:true, problems:runHealthChecks_(false)};
}
function runHealthChecks_(sendEmail){
  var problems=[], _t0=new Date();
  // 並行探測所有後端 /exec + 前端頁（fetchAll 併發，取代逐個順序等待）
  probeBatch_(
    HEALTH_BACKENDS.map(function(e){ return {name:"後端 "+e.name, url:e.url, expect:e.expect}; })
    .concat(HEALTH_PAGES.map(function(pg){ return {name:"前端 "+pg.url, url:pg.url, expect:pg.expect}; }))
  ).forEach(function(x){ problems.push(x); });
  // 暑期 #9 深層資料完整性（跨後端匯總；#9 health 只回摘要、無學生姓名）
  try{
    var IS9="https://script.google.com/macros/s/AKfycby9Ln3kZUubqRIuGdCF5cJ5tk4KuPITMQDuOFFuee1OwrId5gUa_sP_W5CuHga9y6i8/exec";
    var r9=UrlFetchApp.fetch(IS9,{method:"post",contentType:"text/plain;charset=utf-8",payload:JSON.stringify({action:"health"}),muteHttpExceptions:true,followRedirects:true});
    var j9=JSON.parse(r9.getContentText());
    (j9.problems||[]).forEach(function(x){ problems.push(x); });
  }catch(e){}
  // 全面資料完整性（grid 姓名/對齊/狀態、別字、學費、私訓…）
  try{ dataIntegrityCheck_().forEach(function(x){ problems.push(x); }); }
  catch(e){ problems.push("資料完整性檢查出錯："+e); }
  // 功能層 smoke test（後端核心 / 家長端 / 教練端）
  try{ functionalCheck_().forEach(function(x){ problems.push(x); }); }
  catch(e){ problems.push("功能檢查出錯："+e); }
  // 寫入鏈自我測試（示範帳號全流程，抑制 email、完成即清）；最重，若前面已耗時過多就今次略過免超時
  try{
    if((new Date()-_t0)/1000 < 210){ writePathCheck_().forEach(function(x){ problems.push(x); }); }
    else { Logger.log("健康檢查：已耗時過多，本次略過寫入鏈自我測試（防超時）"); }
  }
  catch(e){ problems.push("寫入測試出錯："+e); }
  // 系統運維（觸發器 / 備份新鮮度 / 資料量）
  try{ opsHealthCheck_().forEach(function(x){ problems.push(x); }); }
  catch(e){ problems.push("運維檢查出錯："+e); }
  // 執行時間守護：健康檢查本身太慢 → 接近 Apps Script 6 分鐘上限，trigger 隨時靜靜超時
  try{ var secs=Math.round((new Date()-_t0)/1000); if(secs>240) problems.push("健康檢查耗時 "+secs+" 秒（接近超時上限），需精簡/分拆"); }catch(e){}
  if(sendEmail && problems.length){
    try{
      MailApp.sendEmail(HEALTH_EMAIL,
        "⚠️ INITIATE 系統健康警示（"+problems.length+" 項異常）",
        "以下系統檢查未通過，建議盡快查看：\n\n• "+problems.join("\n• ")+
        "\n\n—— 每日自動健康檢查（"+Utilities.formatDate(new Date(),tz(),"yyyy-MM-dd HH:mm")+"）");
    }catch(e){ Logger.log("健康警示 email 寄送失敗："+e); }
  }
  Logger.log("健康檢查完成："+(problems.length?problems.length+" 項異常":"全部正常"));
  return problems;
}
function installHealthCheck(){
  ScriptApp.getProjectTriggers().forEach(function(t){ if(t.getHandlerFunction()==="healthCheck") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("healthCheck").timeBased().everyDays(1).atHour(8).create();   // 每日約 08:00
  try{ SpreadsheetApp.getUi().alert("✅ 每日健康檢查已設定（約 08:00）。\n有異常先會 email 你，正常唔會騷擾。"); }catch(e){}
  return "每日健康檢查已設定";
}
function healthCheckMenu(){
  var p=healthCheck();
  SpreadsheetApp.getUi().alert(p.length ? ("發現 "+p.length+" 項異常：\n\n• "+p.join("\n• ")+"\n\n（同樣已 email 你一份）") : "✅ 全部正常（前端＋後端即時檢查通過）");
}

/* ═══════════ 營運自動簡報（只 email 老闆自己，零對外風險）═══════════
 * 全部資料即時讀 #4：繳費表、補堂表、點名格、名冊。唔寄畀家長、唔改任何資料。
 *   1) dailyOpsBrief()      每日約 07:00：今日課堂 + 繳費概況 + 補堂限期將到期
 *   2) weeklyUnpaidReport() 逢星期一約 09:00：未繳名單 + 可即用 WhatsApp 催繳範本
 * 安裝：選單「📊 安裝營運簡報」撳一次（順便授權寄信）。 */
var OPS_EMAIL = "initiatesports6331@gmail.com";   // 營運簡報收件（老闆自己）

function dDaysOps_(a,b){ var x=a.split("-").map(Number),y=b.split("-").map(Number); return Math.round((new Date(y[0],y[1]-1,y[2])-new Date(x[0],x[1]-1,x[2]))/86400000); }

// 今日有上課嘅恆常班（已扣假期/停課，以 sessionsFor 為準）
function opsTodayClasses_(){
  var today=todayIso(), out=[];
  CLASS_IDS.forEach(function(cid){
    if(sessionsFor(cid).indexOf(today)>=0)
      out.push({cid:cid, label:gridName(cid), count:CLASSES[cid].students.length});
  });
  return out;
}

// 未繳費（本期及之前；分「催繳」同「等核實」兩批）
function opsUnpaid_(){
  var today=todayIso(), curOrd=periodOrder_(curPeriodLabel_());
  var roster=rosterRows(), chase=[], verify=[];
  feeRows_().forEach(function(x){
    if(x.status==="已繳"||x.status==="豁免") return;
    var owed=x.net-x.paid; if(owed<=0) return;
    if(periodOrder_(x.period) > curOrd) return;             // 未來期未到繳費時間，唔催
    var start=periodStartIso_(x.period), dueBy=start?addMonthsIso(start,1):"";
    var overdue=(dueBy && today>dueBy);
    var cids={}; roster.forEach(function(r){ if(r.name===x.name && r.cid) cids[r.cid]=1; });
    var labels=Object.keys(cids).map(function(c){ return classLabel_(c); });
    var rec={name:x.name, period:x.period, owed:owed, status:x.status, overdue:overdue, classes:labels};
    if(x.status==="待核實") verify.push(rec); else chase.push(rec);
  });
  chase.sort(function(a,b){ return (b.overdue?1:0)-(a.overdue?1:0) || b.owed-a.owed; });
  return {chase:chase, verify:verify};
}

// 未補堂、限期喺 days 日內到期（沿用補堂限期延長工具同一套算法：請假節數 − 已補 = 未補；effDeadline_ 已含延期覆寫）
function opsMakeupsDueSoon_(days){
  var today=todayIso(), out=[];
  CLASS_IDS.forEach(function(cid){
    var blk=readBlock(cid);
    Object.keys(blk.status).forEach(function(nm){
      var lv=[]; (blk.status[nm]||[]).forEach(function(s,i){ if(s==="請假") lv.push(blk.dates[i]); });
      if(!lv.length) return;
      lv.sort();
      var madeUp=makeupUniq_().filter(function(m){ return m.name===nm && m.from===cid; }).length;
      for(var k=madeUp;k<lv.length;k++){
        var d=lv[k], dl=effDeadline_(nm,cid,d);
        if(dl<today) continue;                               // 已過期 → 由「補堂限期延長」工具另行處理
        var left=dDaysOps_(today,dl);
        if(left<=days) out.push({name:nm, label:classLabel_(cid), absDate:d, deadline:dl, daysLeft:left});
      }
    });
  });
  out.sort(function(a,b){ return a.deadline<b.deadline?-1:(a.deadline>b.deadline?1:0); });
  return out;
}
// 未補堂總數（不限到期日）
function opsOutstandingMakeups_(){
  var n=0;
  CLASS_IDS.forEach(function(cid){
    var blk=readBlock(cid);
    Object.keys(blk.status).forEach(function(nm){
      var lv=0; (blk.status[nm]||[]).forEach(function(s){ if(s==="請假") lv++; });
      if(!lv) return;
      var madeUp=makeupUniq_().filter(function(m){ return m.name===nm && m.from===cid; }).length;
      if(lv>madeUp) n+=(lv-madeUp);
    });
  });
  return n;
}

// ── 每日營運簡報 ──
function dailyOpsBrief(){
  return {disabled:true};   // 🛑 已停用：老闆覺得每日簡報太煩（2026-06）。週一催繳／月報仍保留。如要復用，刪此行。
  var today=todayIso(), wd=["日","一","二","三","四","五","六"][new Date().getDay()];
  var cls=opsTodayClasses_(), up=opsUnpaid_(), soon=opsMakeupsDueSoon_(7), outM=opsOutstandingMakeups_();
  var cur=curPeriodLabel_(), curRows=feeRows_().filter(function(x){ return x.period===cur; });
  var done=curRows.filter(function(x){ return x.status==="已繳"||x.status==="豁免"||x.net<=0; }).length;
  var rate=curRows.length? Math.round(done/curRows.length*100):100;
  var chaseAmt=up.chase.reduce(function(s,x){ return s+x.owed; },0);

  var L=[];
  L.push("INITIATE 每日營運簡報　"+today+"（星期"+wd+"）");
  L.push("");
  L.push("📅 今日課堂："+(cls.length?"":"今日無恆常班課堂"));
  cls.forEach(function(c){ L.push("• "+c.label+"｜"+c.count+" 人"); });
  L.push("");
  L.push("💰 繳費（本期 "+cur+"，完成率 "+rate+"%）：");
  L.push("• 未繳 / 部分："+up.chase.length+" 位，合共 $"+chaseAmt);
  L.push("• 等你核實（家長已上傳截圖）："+up.verify.length+" 筆");
  L.push("");
  L.push("🔁 補堂限期 7 日內到期："+soon.length+" 筆　|　未補堂總數："+outM+" 筆");
  soon.forEach(function(m){ L.push("• "+(m.daysLeft<=3?"🔴":"🟡")+" "+m.name+"（"+m.label+"）缺席 "+m.absDate+"｜限期 "+m.deadline+"（剩 "+m.daysLeft+" 日）"); });
  L.push("");
  L.push("—— 每日自動營運簡報（只寄你自己）");
  try{ MailApp.sendEmail(OPS_EMAIL, "📊 INITIATE 每日營運簡報 "+today, L.join("\n")); }
  catch(e){ Logger.log("每日簡報寄送失敗："+e); }
  return {classes:cls.length, unpaid:up.chase.length, verify:up.verify.length, makeupSoon:soon.length};
}

// ── 每週催繳名單（含 WhatsApp 範本）──
function weeklyUnpaidReport(){
  var today=todayIso(), up=opsUnpaid_(), pay=CONFIG.PAY_NUMBER;
  var chaseAmt=up.chase.reduce(function(s,x){ return s+x.owed; },0);
  var L=[];
  L.push("INITIATE 本週催繳名單　截至 "+today);
  L.push("");
  if(!up.chase.length && !up.verify.length){
    L.push("🎉 本期學費全部收清，無須催繳。");
  } else {
    L.push("🔴 未繳 / 部分（建議催繳）："+up.chase.length+" 位，合共 $"+chaseAmt);
    up.chase.forEach(function(x){
      L.push("• "+x.name+"（"+(x.classes.join("、")||"—")+"）｜"+x.period+"｜欠 $"+x.owed+(x.overdue?"　⚠️逾期":""));
    });
    L.push("");
    L.push("🟡 已上傳截圖、等你核實："+up.verify.length+" 筆");
    up.verify.forEach(function(x){ L.push("• "+x.name+"｜"+x.period+"｜$"+x.owed); });
    L.push("（核實：教練端或繳費表第 8 欄改「已繳」即可）");
    L.push("");
    L.push("════ WhatsApp 催繳範本（copy 即用）════");
    up.chase.forEach(function(x){
      L.push("— "+x.name+" —");
      L.push("家長您好 🙂 溫馨提醒 "+x.name+" "+x.period+"學費 $"+x.owed+" 暫未收到，方便嘅話請於本週內以 FPS／PayMe（"+pay+"）繳交，多謝支持！— INITIATE SPORTS");
      L.push("");
    });
  }
  L.push("—— 每週一自動催繳提醒（只寄你自己）");
  try{ MailApp.sendEmail(OPS_EMAIL, "💸 INITIATE 本週催繳名單 "+today+"（未繳 "+up.chase.length+" 位）", L.join("\n")); }
  catch(e){ Logger.log("催繳名單寄送失敗："+e); }
  return {chase:up.chase.length, verify:up.verify.length, amount:chaseAmt};
}

function installOpsReports(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    var f=t.getHandlerFunction();
    if(f==="dailyOpsBrief"||f==="weeklyUnpaidReport"||f==="monthlyOpsReport") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("dailyOpsBrief").timeBased().everyDays(1).atHour(7).create();                       // 每日約 07:00
  ScriptApp.newTrigger("weeklyUnpaidReport").timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();  // 逢星期一約 09:00
  ScriptApp.newTrigger("monthlyOpsReport").timeBased().onMonthDay(1).atHour(8).create();                   // 每月 1 號約 08:00
  try{ SpreadsheetApp.getUi().alert("✅ 營運簡報已設定：\n• 每日約 07:00 寄「營運簡報」\n• 逢星期一約 09:00 寄「催繳名單」\n• 每月 1 號約 08:00 寄「月度營運報表」\n全部只寄你自己，唔會騷擾家長。"); }catch(e){}
  return "已設定";
}
function dailyOpsBriefMenu(){ var r=dailyOpsBrief(); SpreadsheetApp.getUi().alert("已寄出每日營運簡報。\n今日課堂 "+r.classes+" 班｜未繳 "+r.unpaid+" 位｜待核實 "+r.verify+" 筆｜補堂將到期 "+r.makeupSoon+" 筆。"); }
function weeklyUnpaidReportMenu(){ var r=weeklyUnpaidReport(); SpreadsheetApp.getUi().alert("已寄出催繳名單。\n未繳 "+r.chase+" 位，合共 $"+r.amount+"｜待核實 "+r.verify+" 筆。"); }

/* ── 月度營運報表（每月 1 號；學生數 / 出席率 / 收入 / 各班人數 / 推薦 / 未補堂）── */
function monthlyOpsReport(){
  var today=todayIso(), mo=today.slice(0,7), cur=curPeriodLabel_();
  var curRows=feeRows_().filter(function(x){ return x.period===cur; });
  var billed=0, collected=0, unpaidAmt=0;
  curRows.forEach(function(x){
    billed+=x.net; collected+=Math.min(x.paid,x.net);
    if(x.status!=="已繳"&&x.status!=="豁免") unpaidAmt+=Math.max(0,x.net-x.paid);
  });
  var rate=billed?Math.round(collected/billed*100):100;
  var distinct={}; rosterRows().forEach(function(r){ if(r.name) distinct[r.name]=1; });
  // 本期出席率（只計本期月份內、已點名嘅格）
  var att=0, tot=0;
  CLASS_IDS.forEach(function(cid){
    var blk=readBlockMerged_(cid);
    blk.dates.forEach(function(d,i){
      if(periodLabelFromIso_(d)!==cur) return;
      Object.keys(blk.status).forEach(function(nm){
        var s=(blk.status[nm]||[])[i]||"";
        if(s==="出席"||s==="補堂"){ att++; tot++; }
        else if(s==="請假"||s==="缺席"){ tot++; }
      });
    });
  });
  var attRate=tot?Math.round(att/tot*100):0;
  var refMo=referralRows_().filter(function(x){ return String(x.date).slice(0,7)===mo; });
  var refAmt=refMo.reduce(function(s,x){ return s+x.amt; },0);
  var outM=opsOutstandingMakeups_();
  var L=[];
  L.push("INITIATE 月度營運報表　"+mo);
  L.push("");
  L.push("👥 在學學生："+Object.keys(distinct).length+" 位");
  L.push("📊 本期出席率（"+cur+"）："+attRate+"%（出席+補堂 "+att+" / 已點名 "+tot+" 格）");
  L.push("");
  L.push("💰 學費（本期 "+cur+"）：");
  L.push("• 應收 $"+billed+"｜已收 $"+collected+"｜完成率 "+rate+"%");
  L.push("• 尚未收 $"+unpaidAmt);
  L.push("");
  L.push("🏫 各班人數：");
  CLASS_IDS.forEach(function(cid){ L.push("• "+gridName(cid)+"："+CLASSES[cid].students.length+" 人"); });
  L.push("");
  L.push("🎁 本月新推薦："+refMo.length+" 宗（折扣額共 $"+refAmt+"）");
  L.push("🔁 未補堂總數："+outM+" 筆");
  L.push("");
  L.push("—— 每月 1 號自動營運報表（只寄你自己）");
  try{ MailApp.sendEmail(OPS_EMAIL, "📈 INITIATE 月度營運報表 "+mo, L.join("\n")); }
  catch(e){ Logger.log("月報寄送失敗："+e); }
  return {students:Object.keys(distinct).length, attRate:attRate, rate:rate, unpaidAmt:unpaidAmt};
}
function monthlyOpsReportMenu(){ var r=monthlyOpsReport(); SpreadsheetApp.getUi().alert("已寄出月度營運報表。\n學生 "+r.students+" 位｜出席率 "+r.attRate+"%｜繳費完成率 "+r.rate+"%｜未收 $"+r.unpaidAmt+"。"); }

/* 老闆控制台用：即時營運快照（教練密碼）*/
function apiOpsSnapshot(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var cls=opsTodayClasses_(), up=opsUnpaid_(), soon=opsMakeupsDueSoon_(7), outM=opsOutstandingMakeups_();
  var cur=curPeriodLabel_(), curRows=feeRows_().filter(function(x){ return x.period===cur; });
  var done=curRows.filter(function(x){ return x.status==="已繳"||x.status==="豁免"||x.net<=0; }).length;
  return {ok:true,
    today: cls.map(function(c){ return {label:c.label, count:c.count}; }),
    fees: { unpaid:up.chase.length, unpaidAmt:up.chase.reduce(function(s,x){return s+x.owed;},0),
            verify:up.verify.length, period:cur, rate:(curRows.length?Math.round(done/curRows.length*100):100) },
    makeupSoon: soon.length, outstandingMakeups: outM,
    students: (function(){ var s={}; rosterRows().forEach(function(r){ if(r.name)s[r.name]=1; }); return Object.keys(s).length; })(),
    at: nowStamp_() };
}

/* ═══════════ 清理「補堂」表重複行 ═══════════
 * 背景：補堂表曾出現同一筆補堂被寫入多次（例如陳大文 c1→c3 同日 ×14），
 *       令 owed/預約計數一度出錯。計數路徑已用 makeupUniq_() 去重避開，
 *       但底層髒資料仍會被每日備份一直複製、且 makeupAll() 路徑仍會撞到。
 * 做法：先整份備份到 Drive（可還原），再按 name|from|to|date 保留首行、
 *       由下而上刪除其餘重複行（保留其他欄如 IMP 標記，唔做整片重寫）。 */
function cleanupDupMakeup(){
  var M=makeupSheet(); if(!M||M.getLastRow()<2) return {removed:0,kept:0};
  backupToDrive();                         // 先整份複製到 Drive，確保任何誤刪可還原
  backup();                                // 同時寫一份 sheet 內快照
  var seen={}, dupRows=[], kept=0;
  makeupAll().forEach(function(m){         // 已帶 row 號，按現有行序
    var k=m.name+"|"+m.from+"|"+m.to+"|"+m.date;
    if(seen[k]){ dupRows.push(m.row); } else { seen[k]=1; kept++; }
  });
  dupRows.sort(function(a,b){ return b-a; });          // 由下而上刪，避免行號偏移
  dupRows.forEach(function(r){ M.deleteRow(r); });
  Logger.log("清理重複補堂行：刪除 "+dupRows.length+" 行，保留 "+kept+" 筆唯一補堂");
  return {removed:dupRows.length, kept:kept};
}
// 遠端觸發補堂表去重（coachPass 守護，內部已先備份到 Drive＋sheet）
function apiCleanupDupMakeup(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  return {ok:true, result:cleanupDupMakeup()};
}
function cleanupDupMakeupMenu(){
  var r=cleanupDupMakeup();
  SpreadsheetApp.getUi().alert(
    "清理完成 ✅\n刪除重複補堂行："+r.removed+" 行\n保留唯一補堂："+r.kept+" 筆\n（已先整份備份到 Drive，可還原）");
}

/* ═══════════ 自動備份 / 還原 ═══════════ */
function ensureAutoBackup(){
  try{
    var has=ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction()==="backup"; });
    if(!has) ScriptApp.newTrigger("backup").timeBased().everyDays(1).atHour(23).create();
  }catch(e){}
}
/* 每日將「整個試算表」複製一份去 Drive（防整個 Sheet 損毀/誤刪）；只留最近 KEEP 份 */
function ensureDriveBackup(){
  try{
    var has=ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction()==="backupToDrive"; });
    if(!has) ScriptApp.newTrigger("backupToDrive").timeBased().everyDays(1).atHour(1).create();
  }catch(e){}
}
function backupToDrive(){
  var KEEP=14, folderName="IS 系統備份";
  var it=DriveApp.getFoldersByName(folderName), folder=it.hasNext()?it.next():DriveApp.createFolder(folderName);
  var ss=SS(), file=DriveApp.getFileById(ss.getId());
  var stamp=Utilities.formatDate(new Date(), tz(), "yyyy-MM-dd_HHmm");
  file.makeCopy("IS 備份 "+stamp, folder);
  var copies=[], fit=folder.getFiles();
  while(fit.hasNext()){ var f=fit.next(); if(f.getName().indexOf("IS 備份 ")===0) copies.push(f); }
  copies.sort(function(a,b){ return b.getDateCreated()-a.getDateCreated(); });
  copies.slice(KEEP).forEach(function(f){ try{ f.setTrashed(true); }catch(e){} });
  Logger.log("Drive 備份完成 @ "+stamp+"（保留最近 "+KEEP+" 份）");
}
/* 示範帳號 陳大文（電話後4位 1234，c1）— 種一批示範資料；已有資料則跳過（非破壞性） */
function seedDemo_(){
  var nm="陳大文", c1="c1", c3="c3";
  if(!CLASSES[c1] || CLASSES[c1].students.indexOf(nm)<0) return;
  var blk=readBlock(c1), st=blk.status[nm]||[];
  if(st.some(function(x){ return x; })) return;            // 已有資料 → 唔重複種
  // 註：示範帳號 陳大文 繳費不再設「豁免」（補堂示範用本期日子，periodPaid_ 本期及之前自動放行，唔會被閘）。
  var today=todayIso();
  var past=sessionsFor(c1).filter(function(d){ return d<today; });
  past.slice(0,3).forEach(function(d){ markCell(c1,nm,d,"出席",true); });   // 出席 ×3
  // 請假#1（較早）→ 補去 c3，已出席（示範「已補堂」）
  if(past.length>=4){
    var lv1=past[3]; markCell(c1,nm,lv1,"請假",true);
    var s3=sessionsFor(c3), mk=s3.filter(function(d){ return d>lv1; })[0] || s3[0];
    if(mk){
      var M=makeupSheet(), row=M.getLastRow()+1; M.getRange(row,4).setNumberFormat("@");
      M.getRange(row,1,1,5).setValues([[nm,c1,c3,mk, sessionsFor(c3).indexOf(mk)>=0?"格":"補堂"]]);
      markCell(c3,nm,mk, (mk<today?"出席":"補堂"), true);
    }
  }
  // 請假#2（未補）→ 揀一個「補堂限期喺未來 14 日內」嘅過去堂，示範「待補堂 + 限期提醒」；冇就用最近一堂
  function dDays_(a,b){ var x=a.split("-").map(Number),y=b.split("-").map(Number); return Math.round((new Date(y[0],y[1]-1,y[2])-new Date(x[0],x[1]-1,x[2]))/86400000); }
  var lv1used = (past.length>=4)? past[3] : "";
  var soon=past.filter(function(d){ if(d===lv1used) return false; var dl=addMonthsIso(d,CONFIG.MAKEUP_MONTHS); return dl>today && dDays_(today,dl)<=14; });
  var lv2 = soon.length? soon[soon.length-1] : (past.length>=5? past[past.length-1] : "");
  if(lv2 && lv2!==lv1used) markCell(c1,nm,lv2,"請假",true);
  Logger.log("示範帳號 陳大文 已種示範資料。");
}
function backup(){
  var ss=SS(), bk=ss.getSheetByName("備份")||ss.insertSheet("備份");
  if(bk.getLastRow()<1) bk.appendRow(["備份時間","類型","班別","學生","日期","狀態","補去班"]);
  bk.getRange("A:A").setNumberFormat("@"); bk.getRange("E:E").setNumberFormat("@");
  normalizeBackupStamps_(bk);
  var stamp=Utilities.formatDate(new Date(), tz(), "yyyy-MM-dd HH:mm:ss"), rows=[];
  CLASS_IDS.forEach(function(cid){
    var full=readFull(cid);
    // 掃「所有實體正式區姓名」（用 reg keys，唔只 CLASSES 名單）：當 CLASSES 人數一時多過
    // 實體正式行（如轉班/回歸期間），邊界嗰行（多數係補堂生）會被 readFull 讀入 reg，
    // 若只掃 full.students 就會漏咗備份 → 重建時流失（曾發生：蘇穎悠 c4）。掃 reg keys 杜絕。
    Object.keys(full.reg).forEach(function(nm){ if(!nm) return; (full.reg[nm]||[]).forEach(function(stt,i){
      if(stt) rows.push([stamp,"格",cid,nm,full.dates[i],stt,""]); }); });
    full.mk.forEach(function(x){ x.statuses.forEach(function(stt,i){
      if(stt) rows.push([stamp,"格",cid,x.name,full.dates[i],stt,""]); }); });
  });
  makeupAll().forEach(function(m){ rows.push([stamp,"補",m.from,m.name,toIso_(m.date),m.status||"",m.to]); });
  if(rows.length) bk.getRange(bk.getLastRow()+1,1,rows.length,7).setValues(rows);
  pruneBackups_(bk,30);
  Logger.log("備份完成："+rows.length+" 筆 @ "+stamp);
  return rows.length;
}
function normalizeBackupStamps_(bk){
  if(bk.getLastRow()<2) return;
  var n=bk.getLastRow()-1;
  var a=bk.getRange(2,1,n,1).getValues(), e=bk.getRange(2,5,n,1).getValues(), z=tz();
  bk.getRange(2,1,n,1).setValues(a.map(function(r){ return [ r[0] instanceof Date ? Utilities.formatDate(r[0],z,"yyyy-MM-dd HH:mm:ss") : String(r[0]||"") ]; }));
  bk.getRange(2,5,n,1).setValues(e.map(function(r){ return [ toIso_(r[0]) ]; }));
}
function pruneBackups_(bk,keepN){
  var map=snapshots_(), keys=Object.keys(map).sort();
  if(keys.length<=keepN) return;
  var best=keys[0]; keys.forEach(function(t){ if(map[t].total>map[best].total) best=t; });
  var keep={}; keys.slice(keys.length-keepN).forEach(function(t){keep[t]=1;}); keep[best]=1;
  var kept=[];
  keys.forEach(function(t){ if(keep[t]) map[t].rows.forEach(function(r){ kept.push(r); }); });
  bk.getRange(2,1,bk.getLastRow()-1,7).clearContent();
  if(kept.length) bk.getRange(2,1,kept.length,7).setValues(kept);
}
function snapshots_(){
  var bk=SS().getSheetByName("備份"); if(!bk||bk.getLastRow()<2) return {};
  var v=bk.getRange(2,1,bk.getLastRow()-1,7).getValues(), map={};
  v.forEach(function(r){ var t=String(r[0]); if(!t) return;
    if(!map[t]) map[t]={t:t,total:0,mk:0,rows:[]};
    map[t].rows.push(r); map[t].total++; if(r[1]==="補") map[t].mk++; });
  return map;
}
function applySnapshot_(rows){
  var ss=SS(), M=ss.getSheetByName("補堂");
  // 1) 補堂表（已批次，快）
  if(M && M.getLastRow()>1) M.getRange(2,1,M.getLastRow()-1,5).clearContent();
  var mkr=[], seen={};
  rows.forEach(function(r){ if(r[1]!=="補") return;
    var key=r[3]+"|"+r[2]+"|"+r[6]+"|"+toIso_(r[4]); if(seen[key]) return; seen[key]=1;
    mkr.push([r[3],r[2],r[6],toIso_(r[4]),r[5]]); });
  if(mkr.length && M){ M.getRange(2,4,mkr.length,1).setNumberFormat("@"); M.getRange(2,1,mkr.length,5).setValues(mkr); }
  // 2) 格仔：按班分組，逐班一次過批次寫入（取代逐格 markCell，避免幾千次寫入超時）
  var byCid={};
  rows.forEach(function(r){ if(r[1]==="格"){ (byCid[r[2]]=byCid[r[2]]||[]).push(r); } });
  Object.keys(byCid).forEach(function(cid){ try{ restoreGridBatch_(cid, byCid[cid]); }catch(e){ Logger.log("restoreGridBatch_ "+cid+" 失敗："+e); } });
}
// 把某班快照「格」資料一次過 overlay 寫入 grid：只覆蓋備份有值嘅格，唔清空其他（保留原 markCell 安全特性）。
function restoreGridBatch_(cid, gridRows){
  var m=gridMeta(cid); if(!m.sh) return;
  var sh=m.sh, physN=m.physN||0; if(physN<=0) return;
  var colOf=m.colOf||{};
  var rowOf={}; m.students.forEach(function(nm,i){ rowOf[nm]=DATA_START+i; });
  // 現有補堂區名單 → 行號；空行備用
  var mkNames=sh.getRange(m.mkStart,NAME_COL,MK_MAX,1).getValues(), mkRowByName={}, emptyMkRows=[];
  for(var j=0;j<MK_MAX;j++){ var v=String(mkNames[j][0]||"").trim();
    if(v) mkRowByName[v]=m.mkStart+j; else emptyMkRows.push(m.mkStart+j); }
  var writes=[], newMk=[];
  gridRows.forEach(function(r){
    var nm=String(r[3]).trim(), st=String(r[5]||""); if(!st) return;
    var off=colOf[mmdd_(toIso_(r[4]))]; if(off==null) return;   // 該日期唔喺 grid 表頭 → 跳過
    var row=rowOf[nm]; if(row==null) row=mkRowByName[nm];
    if(row==null){ if(!emptyMkRows.length) return; row=emptyMkRows.shift(); mkRowByName[nm]=row; newMk.push({row:row,name:nm}); }
    writes.push({row:row, off:off, val:st});
  });
  // 新補堂行：序號/姓名/總結公式（清總結欄驗證，免 COUNTIF 撞驗證）
  if(newMk.length){
    var c0=colLetter(DATE_COL0), cN=colLetter(DATE_COL0+physN-1), sumC=DATE_COL0+physN;
    newMk.forEach(function(x){
      sh.getRange(x.row,SEQ_COL).setValue("補"); sh.getRange(x.row,NAME_COL).setValue(x.name);
      try{ sh.getRange(x.row,sumC,1,3).setDataValidation(null); }catch(e){}
      sh.getRange(x.row,sumC).setValue('=COUNTIF('+c0+x.row+':'+cN+x.row+',"出席")+COUNTIF('+c0+x.row+':'+cN+x.row+',"補堂")');
      sh.getRange(x.row,sumC+1).setValue('=COUNTIF('+c0+x.row+':'+cN+x.row+',"請假")');
      sh.getRange(x.row,sumC+2).setValue('=COUNTIF('+c0+x.row+':'+cN+x.row+',"缺席")');
    });
  }
  if(!writes.length) return;
  // 一次過讀 min..max 行嘅日期 block，overlay 備份值，再一次過寫返（只動日期欄，唔掂總結欄）
  var minRow=writes[0].row, maxRow=writes[0].row;
  writes.forEach(function(w){ if(w.row<minRow)minRow=w.row; if(w.row>maxRow)maxRow=w.row; });
  var block=sh.getRange(minRow,DATE_COL0,maxRow-minRow+1,physN).getValues();
  writes.forEach(function(w){ block[w.row-minRow][w.off]=w.val; });
  sh.getRange(minRow,DATE_COL0,maxRow-minRow+1,physN).setValues(block);
}
function restoreLatest(){
  var map=snapshots_(), keys=Object.keys(map);
  if(!keys.length){ try{SpreadsheetApp.getUi().alert("未有備份");}catch(e){} return 0; }
  var best=keys[0]; keys.forEach(function(t){ if(map[t].total>map[best].total) best=t; });
  applySnapshot_(map[best].rows);
  try{ SpreadsheetApp.getUi().alert("已還原最完整備份：\n"+best+"\n共 "+map[best].total+" 筆（補堂 "+map[best].mk+" 筆）"); }catch(e){}
  return map[best].total;
}
function listBackups(){
  var map=snapshots_(), keys=Object.keys(map).sort();
  var msg=keys.length? keys.map(function(t){ return t+"　｜ 共"+map[t].total+"筆，補堂"+map[t].mk+"筆"; }).join("\n") : "未有備份";
  SpreadsheetApp.getUi().alert("備份清單（最新喺最底）\n\n"+msg+"\n\n用「還原（自選時間）」貼返時間即可還原指定版本。");
}
function restoreChoose(){
  var ui=SpreadsheetApp.getUi();
  var res=ui.prompt("還原指定備份","貼返備份時間（例如 2026-06-09 22:00:01）：",ui.ButtonSet.OK_CANCEL);
  if(res.getSelectedButton()!==ui.Button.OK) return;
  var t=res.getResponseText().trim(), map=snapshots_();
  if(!map[t]){ ui.alert("搵唔到「"+t+"」嘅備份。請用「備份清單」對返完整時間（連秒）。"); return; }
  applySnapshot_(map[t].rows);
  ui.alert("已還原至 "+t+"\n共 "+map[t].total+" 筆（補堂 "+map[t].mk+" 筆）");
}

/* ═══════════ 一次性匯入：由「IS App Data」搬出席/成績/體測（冪等）═══════════
 * 由 parent-portal 後端嘅 container sheet 直接讀，逐筆原班原日寫入本系統。
 * 動作前自動 backup()；可隨時用「還原」復原。繳費結構不同，只記 Log 人手處理。 */
const PORTAL_SHEET_ID = "1prjceGydcVHvhidlp8SZEJ1abE0Cvz2WqwrjN6_K7qo";
const IMPORT_NAME_FIX = { "陳柏晞":"陳柏睎" };   // 打錯字 → 正名

function importParentDataMenu(){
  var ui=SpreadsheetApp.getUi();
  var c=ui.alert("匯入家長資料",
    "會由「IS App Data」匯入出席／成績／體測，並套用最新班別名單。\n動作前自動備份，可用「還原」復原。\n\n確定執行？",
    ui.ButtonSet.OK_CANCEL);
  if(c!==ui.Button.OK) return;
  var r;
  try{ r=importParentData(); }
  catch(e){ ui.alert("匯入失敗：\n"+(e&&e.message||e)+"\n\n資料可用「還原至最近備份」復原。"); return; }
  ui.alert("匯入完成 ✅",
    "出席寫入："+r.attWrote+" / "+r.attTotal+"\n"+
    (r.attSkip.length?("⚠️ 未能寫入 "+r.attSkip.length+" 筆（詳見「查看」→ Apps Script 記錄）\n"):"")+
    "補堂紀錄："+r.mkWrote+"\n成績："+r.perfWrote+"\n體測："+r.bodyWrote+"\n\n"+
    "繳費 "+r.feeCount+" 筆結構不同，需人手處理（已記 Log）。\n已自動備份。",
    ui.ButtonSet.OK);
}

function rebuildRosterMenu(){
  var ui=SpreadsheetApp.getUi();
  var c=ui.alert("重建學生名冊",
    "會依最新班別名單（CLASSES）重建名冊，保留各家長手機。\n家長頁將只顯示現時班別；舊班別歷史出席紀錄不受影響、仍保留在各班格仔內。\n\n確定執行？",
    ui.ButtonSet.OK_CANCEL);
  if(c!==ui.Button.OK) return;
  try{ ensureRoster_(SS()); }
  catch(e){ ui.alert("重建失敗：\n"+(e&&e.message||e)); return; }
  ui.alert("名冊已重建 ✅","家長頁現只顯示現時班別。",ui.ButtonSet.OK);
}

/* 🔧 一次性：c5 名單對位修正 — 出席表 c5 正式名單區嘅「顧舒然」(已退出)改名做「梁正軒」(現役)。
 * 老闆確認該行 5-6 月出席係梁正軒（顧舒然 5 月起已無參加），故改名保留出席即可。
 * 先自動備份；只動 c5 正式名單區；冪等（搵唔到顧舒然就唔郁）。改名後 readBlock 按姓名讀格，
 * 梁正軒即接返自己出席，#11「c5 06-12 缺席」被 grid 已出席推翻 → 待補(owed) 自動歸 0。*/
// 一次性修正：張爾淳/張雅堯 c6 06/20 出席被還原移位（06/20 變豁免、06/27 變出席）→ 改返 06/20=出席、06/27=清空。
function fixZhangC6Jun20(){
  var ui=SpreadsheetApp.getUi(), cid="c6", names=["張爾淳","張雅堯"];
  var c=ui.alert("修正張家 c6 06/20",
    "會將 張爾淳、張雅堯 嘅 06/20 改返「出席」、06/27 清空（修正還原移位）。\n執行前會自動備份。\n\n確定？",
    ui.ButtonSet.OK_CANCEL);
  if(c!==ui.Button.OK) return;
  try{ backup(); }catch(e){}
  var m=gridMeta(cid), c27=dateCol(m,"2026-06-27"), fixed=0;
  names.forEach(function(nm){
    if(markCell(cid, nm, "2026-06-20", "出席", false)) fixed++;          // 06/20 → 出席（按表頭對齊寫）
    var ri=m.students.indexOf(nm);
    if(c27>0 && ri>=0) m.sh.getRange(DATA_START+ri, c27).setValue("");    // 06/27 → 清空
  });
  try{ logAppend({name:names.join("/"),key:cid,action:"fixShift",date:"2026-06-20",status:"06/20→出席,06/27清空"}); }catch(e){}
  ui.alert("已修正 ✅\n張爾淳、張雅堯：06/20→出席、06/27→清空（已先備份）。");
}
function fixC5GuToLeung(){
  var ui=SpreadsheetApp.getUi(), cid="c5", oldNm="顧舒然", newNm="梁正軒";
  var c=ui.alert("修正 c5 名單",
    "會把出席表「"+gridName(cid)+"」正式名單嘅「"+oldNm+"」改名做「"+newNm+"」，保留該行出席。\n執行前會自動備份。\n\n確定？",
    ui.ButtonSet.OK_CANCEL);
  if(c!==ui.Button.OK) return;
  try{ backup(); }catch(e){}
  var sh=SS().getSheetByName(gridName(cid));
  if(!sh){ ui.alert("搵唔到分頁："+gridName(cid)); return; }
  var R=CLASSES[cid].students.length, names=sh.getRange(DATA_START,NAME_COL,R,1).getValues(), at=-1;
  for(var i=0;i<R;i++){ if(String(names[i][0]||"").trim()===oldNm){ at=i; break; } }
  if(at<0){ ui.alert("ℹ️ c5 正式名單冇搵到「"+oldNm+"」，可能已修正過，無改動。"); return; }
  sh.getRange(DATA_START+at,NAME_COL).setValue(newNm);
  try{ logAppend({name:newNm,key:cid,action:"fixRoster",date:"",status:"c5 "+oldNm+"→"+newNm}); }catch(e){}
  ui.alert("✅ 已修正","c5 第 "+(at+1)+" 行 "+oldNm+" → "+newNm+"（出席保留，已備份）。\n家長頁待補(owed) 會自動正常。",ui.ButtonSet.OK);
}

/* ✅ 一鍵：標記某期（預設 5-6月）全部已繳 → 已繳=實際應繳、狀態=已繳；家長頁付款區自動消失 */
function markPeriodFeesPaid_(monthLabel){
  var sh=feeSheet();
  var rows=feeRows_().filter(function(x){ return x.period.indexOf(monthLabel)>=0; });
  var done=0;
  rows.forEach(function(x){
    if(x.status==="已繳") return;                  // 已係已繳就跳過
    sh.getRange(x.row,7).setValue(x.net);          // 已繳 = 實際應繳
    recalcFeeRow_(x.row);                            // 重算狀態 → 已繳
    done++;
  });
  return {total:rows.length, marked:done};
}
/* ✅ 校正繳費「每週堂數/應繳」：以 Roster 名冊為準重新同步；若某期原本已繳、因應繳上升而變未付清，補回已繳=淨額（該期已收足） */
function syncFeesFromRoster_(){
  var sh=feeSheet(), changed=[];
  feeRows_().forEach(function(x){
    var wk=weeklySessions_(x.name)||1, due=feeAmount_(wk);
    if(x.weekly===wk && x.due===due) return;       // 已正確 → 跳過
    sh.getRange(x.row,3).setValue(wk);              // 每週堂數
    sh.getRange(x.row,4).setValue(due);             // 應繳
    var wasPaid=(x.status==="已繳");
    var r=recalcFeeRow_(x.row);
    if(wasPaid && r.status!=="已繳"){               // 該期原已收足 → 補回已繳=淨額
      sh.getRange(x.row,7).setValue(r.net);
      r=recalcFeeRow_(x.row);
    }
    changed.push({name:x.name, period:x.period, weekly:x.weekly+"→"+wk,
      due:x.due+"→"+due, paid:Number(sh.getRange(x.row,7).getValue())||0, status:r.status});
  });
  return {ok:true, changedCount:changed.length, changed:changed};
}
/* 退出學生離場：刪除指定學生「7-8月」未繳的繳費列（5-6月已繳保留），並以最新 CLASSES 重建 Roster。
   名冊重建為非破壞性（importParentData/ensureRoster_ 會保留現有出席）。 */
function offboardStudents_(names){
  var set={}; (names||[]).forEach(function(n){ set[String(n).trim()]=1; });
  var sh=feeSheet(), deleted=[], kept=[];
  // 由下而上刪，避免行號位移
  feeRows_().slice().reverse().forEach(function(x){
    if(!set[x.name]) return;
    if(x.period.indexOf("7-8月")>=0 && x.status!=="已繳"){
      deleted.push({name:x.name, period:x.period, status:x.status, paid:x.paid});
      sh.deleteRow(x.row);
    }else{
      kept.push({name:x.name, period:x.period, status:x.status, paid:x.paid});
    }
  });
  ensureRoster_(SS());   // 以新 CLASSES 重建名冊
  return {ok:true, deletedCount:deleted.length, deleted:deleted, kept:kept};
}
function syncFeesFromRosterMenu(){
  var ui=SpreadsheetApp.getUi();
  var c=ui.alert("校正繳費每週堂數",
    "會以 Roster 名冊為準，重新同步所有繳費紀錄嘅「每週堂數 / 應繳」。\n若某期原本已繳、因應繳上升而變未付清，會自動補回已繳=淨額。\n\n會先自動備份。確定執行？",
    ui.ButtonSet.OK_CANCEL);
  if(c!==ui.Button.OK) return;
  var r;
  try{ backup(); r=syncFeesFromRoster_(); }
  catch(e){ ui.alert("執行失敗：\n"+(e&&e.message||e)); return; }
  ui.alert("完成 ✅","更新 "+r.changedCount+" 個繳費紀錄（以 Roster 為準）。",ui.ButtonSet.OK);
}
function markFiveSixPaidMenu(){
  var ui=SpreadsheetApp.getUi();
  var rows=feeRows_().filter(function(x){ return x.period.indexOf("5-6月")>=0; });
  var pending=rows.filter(function(x){ return x.status!=="已繳"; }).length;
  var c=ui.alert("標記 5-6月 全部已繳",
    "共 "+rows.length+" 個 5-6月 繳費紀錄，其中 "+pending+" 個未繳/部分。\n會將佢哋全部標記為「已繳」（已繳金額 = 實際應繳）。\n家長頁該期付款區會自動消失。\n\n會先自動備份。確定執行？",
    ui.ButtonSet.OK_CANCEL);
  if(c!==ui.Button.OK) return;
  var r;
  try{ backup(); r=markPeriodFeesPaid_("5-6月"); }
  catch(e){ ui.alert("執行失敗：\n"+(e&&e.message||e)); return; }
  ui.alert("完成 ✅","5-6月 共 "+r.total+" 個紀錄，新標記 "+r.marked+" 個為已繳。",ui.ButtonSet.OK);
}

function importParentData(){
  var ss=SS();
  backup();
  ensureRoster_(ss);   // 名冊套用最新 CLASSES 班別（保留家長手機）→ 家長頁只顯示現時班別
  // 捕捉各班現有格仔（舊上課日）→ 之後改名單/加堂強制重建仍可還原（保留陳大文 demo 等）
  var beforeMap={};
  CLASS_IDS.forEach(function(cid){ beforeMap[cid]=readFull(cid); });
  // c5 加返勞動節 2026-05-01 做特別上課日
  upsertSetting_("extra_c5", JSON.stringify(["2026-05-01"]));

  // 組裝每班 marks：{ cid: { name: { dateIso: zh } } }（記憶體合併，最後一次過寫）
  var marks={}; CLASS_IDS.forEach(function(cid){ marks[cid]={}; });
  function put(cid,name,iso,zh){
    if(!cid||!name||!iso||!zh||!marks[cid]) return;
    (marks[cid][name]=marks[cid][name]||{})[iso]=zh;
  }
  // (a) 保留 #4 既有格（demo／任何已有資料），用日期字串對位（對亂序安全）
  CLASS_IDS.forEach(function(cid){
    var before=beforeMap[cid];
    Object.keys(before.reg).forEach(function(nm){ if(!nm) return;
      before.reg[nm].forEach(function(zh,i){ if(zh && before.dates[i]) put(cid,nm,before.dates[i],zh); }); });
    before.mk.forEach(function(x){ if(!x.name) return;
      x.statuses.forEach(function(zh,i){ if(zh && before.dates[i]) put(cid,x.name,before.dates[i],zh); }); });
  });

  var SRC=SpreadsheetApp.openById(PORTAL_SHEET_ID);

  // 先建 absences 索引：key=cid|absDate|name → 有此 row 代表「正式請假(有記錄、可補堂)」
  // 用嚟分辨 #11 attendance 嘅 absent：有對應 absences = 請假；冇 = 缺席。
  var absSet={};
  var abvPre=SRC.getSheetByName("absences").getDataRange().getValues();
  for(var ap=1;ap<abvPre.length;ap++){
    var an=String(abvPre[ap][1]||"").trim(); an=IMPORT_NAME_FIX[an]||an;
    var ac=String(abvPre[ap][2]||"").trim();
    var ad=toIso_(abvPre[ap][3]);
    if(an&&ac&&ad) absSet[ac+"|"+ad+"|"+an]=true;
  }

  // (b)「IS App Data」出席：只補 #4 空格（#4 為準，唔覆蓋 #4 已有點名）
  //     ⚠️ #4 已係恆常班真相來源。今後再 import 只係「搬清 #11 尾數」，故該格 #4 有值就跳過，
  //        避免用 #11 舊資料覆蓋 #4 新點名（之前的「#11 覆蓋」只適用於最初 #4 grid 全空嘅一次性遷移）。
  var av=SRC.getSheetByName("attendance").getDataRange().getValues();
  var attSkip=[], attFilled=0, attKept=0;
  for(var i=1;i<av.length;i++){
    var cid=String(av[i][1]||"").trim();
    var date=toIso_(av[i][2]);
    var name=String(av[i][3]||"").trim(); name=IMPORT_NAME_FIX[name]||name;
    var st=String(av[i][4]||"").trim();
    if(!cid||!name||!st) continue;
    var zh=EN2ZH[st]; if(!zh){ attSkip.push(cid+"|"+date+"|"+name+"|"+st+"(未知狀態)"); continue; }
    // absent：有 absences 記錄 → 請假(可補)；冇 → 缺席。修正 EN2ZH 一律當請假嘅失真。
    if(st==="absent" && !absSet[cid+"|"+date+"|"+name]) zh="缺席";
    if(!marks[cid]){ attSkip.push(cid+"|"+date+"|"+name+"|"+st+"(未知班別)"); continue; }
    if(marks[cid][name] && marks[cid][name][date]){ attKept++; continue; }   // #4 已有 → 保留 #4，唔覆蓋
    put(cid,name,date,zh); attFilled++;                                      // #4 空格 → 由 #11 補上
  }
  Logger.log("import 出席合併：由 #11 補上空格 "+attFilled+" 格，保留 #4 既有 "+attKept+" 格");

  // 計算「應寫入」總數（合併後）
  var attTotal=0;
  CLASS_IDS.forEach(function(cid){ Object.keys(marks[cid]).forEach(function(nm){
    attTotal+=Object.keys(marks[cid][nm]).length; }); });

  // 逐班強制重建（套用最新 CLASSES 名單）→ 一次過 setValues 寫入（快，唔會逾時）
  var attWrote=0;
  CLASS_IDS.forEach(function(cid){
    buildGrid(ss, cid, true);
    var r=applyMarksBulk_(cid, marks[cid]);
    attWrote+=r.wrote;
    r.skip.forEach(function(s){ attSkip.push(s); });
  });
  SpreadsheetApp.flush();

  // ② 補堂 ledger：由 absences.madeUpDate；冪等先清 IMP 標記行（第6欄）
  var MK=makeupSheet(); clearTagged_(MK, 6);
  var abv=SRC.getSheetByName("absences").getDataRange().getValues();
  var mkRows=[], mkWrote=0;
  for(var j=1;j<abv.length;j++){
    var nm=String(abv[j][1]||"").trim(); nm=IMPORT_NAME_FIX[nm]||nm;
    var mud=abv[j][5];
    if(!nm || mud===""||mud===null||mud===undefined) continue;
    mkRows.push([nm, String(abv[j][2]||"").trim(), "", toIso_(mud), "出席", "IMP"]); mkWrote++;
  }
  if(mkRows.length){ MK.getRange(MK.getLastRow()+1,1,mkRows.length,6).setValues(mkRows); MK.getRange("D:D").setNumberFormat("@"); }

  // ③ 成績 Perf（冪等：清 IMP 第8欄 → 重寫）
  var P=ss.getSheetByName("Perf"); clearTagged_(P, 8);
  var pv=SRC.getSheetByName("performance").getDataRange().getValues();
  var perfRows=[], perfWrote=0;
  for(var k=1;k<pv.length;k++){ var pn=String(pv[k][0]||"").trim(); if(!pn) continue;
    perfRows.push([pn, String(pv[k][1]||""), toIso_(pv[k][2]), pv[k][3], "", "", "", "IMP"]); perfWrote++; }
  if(perfRows.length) P.getRange(P.getLastRow()+1,1,perfRows.length,8).setValues(perfRows);

  // ④ 體測 Body（冪等：清 IMP 第5欄 → 重寫）
  var B=ss.getSheetByName("Body"); clearTagged_(B, 5);
  var bv=SRC.getSheetByName("body").getDataRange().getValues();
  var bodyRows=[], bodyWrote=0;
  for(var b=1;b<bv.length;b++){ var bn=String(bv[b][0]||"").trim(); if(!bn) continue;
    bodyRows.push([bn, toIso_(bv[b][1]), bv[b][2], bv[b][3], "IMP"]); bodyWrote++; }
  if(bodyRows.length) B.getRange(B.getLastRow()+1,1,bodyRows.length,5).setValues(bodyRows);

  // ⑤ 繳費：結構不同，只記 Log 畀老闆人手處理
  var fv=SRC.getSheetByName("fee_paid").getDataRange().getValues(), feeCount=0;
  for(var f=1;f<fv.length;f++){ if(String(fv[f][3]||"").trim()){ feeCount++;
    Logger.log("繳費(人手)："+fv[f][3]+" / "+fv[f][1]+" / "+fv[f][2]+" / paid="+fv[f][4]); } }

  attSkip.forEach(function(s){ Logger.log("出席未寫："+s); });
  SpreadsheetApp.flush();
  return {attWrote:attWrote, attTotal:attTotal, attSkip:attSkip,
          mkWrote:mkWrote, perfWrote:perfWrote, bodyWrote:bodyWrote, feeCount:feeCount};
}

/* ⬇️ 匯入繳費「已繳」標記：由「IS App Data」fee_paid 搬入本系統繳費表（冪等）
 * 來源 paid=true → 對應 (學生,期) 那列：已繳=實際應繳、狀態自動計成「已繳」。 */
const FEE_MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
function portalPeriodToLabel_(pid){
  var m=String(pid).match(/(\d{4})-([a-z]{3})-([a-z]{3})/i);
  if(!m) return "";
  var a=FEE_MONTHS[m[2].toLowerCase()], b=FEE_MONTHS[m[3].toLowerCase()];
  if(!a||!b) return "";
  return m[1]+" "+a+"-"+b+"月";
}
function importFeesMenu(){
  var ui=SpreadsheetApp.getUi();
  var c=ui.alert("匯入繳費標記",
    "會由「IS App Data」將已繳費學生喺本系統繳費表標記為「已繳」。\n動作前自動備份，可用「還原」復原。\n\n確定執行？",
    ui.ButtonSet.OK_CANCEL);
  if(c!==ui.Button.OK) return;
  var r;
  try{ backup(); r=importFeesFromPortal_(); }
  catch(e){ ui.alert("匯入失敗：\n"+(e&&e.message||e)+"\n\n可用「還原至最近備份」復原。"); return; }
  ui.alert("繳費標記匯入完成 ✅",
    "標記為已繳："+r.done+" 筆\n"+
    (r.miss.length?("⚠️ 未能對應 "+r.miss.length+" 筆（詳見 Apps Script 記錄）"):"全部成功對應")+
    "\n已自動備份。", ui.ButtonSet.OK);
}
function importFeesFromPortal_(){
  var SRC=SpreadsheetApp.openById(PORTAL_SHEET_ID);
  var fv=SRC.getSheetByName("fee_paid").getDataRange().getValues();   // 欄：key,periodId,classId,name,paid
  var sh=feeSheet(), done=0, miss=[];
  for(var i=1;i<fv.length;i++){
    var paid=String(fv[i][4]||"").trim().toLowerCase();
    if(paid!=="true"&&paid!=="1"&&paid!=="已繳") continue;
    var nm=String(fv[i][3]||"").trim(); nm=IMPORT_NAME_FIX[nm]||nm;
    var label=portalPeriodToLabel_(fv[i][1]);
    if(!nm||!label){ miss.push("paid列無法解析："+JSON.stringify(fv[i])); continue; }
    var hit=null; feeRows_().forEach(function(x){ if(x.name===nm && x.period===label) hit=x; });
    if(!hit){ miss.push(nm+" / "+label+"（繳費表搵唔到此列）"); continue; }
    if(hit.status==="已繳"){ continue; }   // 冪等：已標記就跳過
    var net=Number(sh.getRange(hit.row,6).getValue())||hit.net||hit.due||0;
    sh.getRange(hit.row,7).setValue(net>0?net:hit.due);   // 已繳 = 實際應繳
    recalcFeeRow_(hit.row);                                // 狀態自動計成「已繳」
    done++;
  }
  miss.forEach(function(s){ Logger.log("繳費標記未對應："+s); });
  SpreadsheetApp.flush();
  return {done:done, miss:miss};
}

/* 寫入/更新 Settings 一個 key */
function upsertSetting_(key, value){
  var ST=settingsSheet(); if(!ST){ ST=SS().insertSheet("Settings"); ST.appendRow(["key","value"]); }
  var last=ST.getLastRow();
  if(last>=2){ var keys=ST.getRange(2,1,last-1,1).getValues();
    for(var i=0;i<keys.length;i++){ if(String(keys[i][0]).trim()===key){ ST.getRange(i+2,2).setValue(value); return; } } }
  ST.appendRow([key, value]);
}

/* 一次過將整班 marks 寫入 grid（取代逐格 markCell，避免逾時）
 * marksByName = { name: { dateIso: zh } }；正規學生用矩陣，名單以外排補堂訪客列。
 * 回傳 {wrote, skip[]}；非上課日／補堂區滿 → 入 skip 不漏報。 */
function applyMarksBulk_(cid, marksByName){
  var ss=SS(), sh=ss.getSheetByName(gridName(cid));
  var dates=sessionsFor(cid), n=dates.length, students=CLASSES[cid].students;
  var wrote=0, skip=[]; marksByName=marksByName||{};
  if(!sh){ Object.keys(marksByName).forEach(function(nm){ skip.push(cid+"|"+nm+"|(無班表)"); }); return {wrote:0,skip:skip}; }
  var dcol={}; for(var i=0;i<n;i++) dcol[dates[i]]=i;
  // 寫入前清晒驗證：避免個別舊值（如遷移殘留「格」/非標準字）觸發 status 驗證錯誤而令整個匯入中斷。
  // 寫完喺函數尾再重設返驗證（日期欄 status 下拉、總結欄清驗證）。
  var vBlockR=students.length+MK_MAX, vBlock=sh.getRange(DATA_START,DATE_COL0,vBlockR,Math.max(n,1));
  try{ vBlock.setDataValidation(null); }catch(e){}

  // ① 正規學生：R×n 矩陣，一次過 setValues
  var R=students.length;
  if(R && n){
    var mat=[]; for(var r=0;r<R;r++){ var row=[]; for(var c=0;c<n;c++) row.push(""); mat.push(row); }
    for(var s=0;s<R;s++){
      var snm=students[s], sm=marksByName[snm]; if(!sm) continue;
      Object.keys(sm).forEach(function(iso){
        var ci=dcol[iso];
        if(ci===undefined){ skip.push(cid+"|"+snm+"|"+iso+"|"+sm[iso]+"(非上課日)"); return; }
        mat[s][ci]=sm[iso]; wrote++;
      });
    }
    sh.getRange(DATA_START,DATE_COL0,R,n).setValues(mat);
  }

  // ② 名單以外（訪客／補堂）：排名單下方，最多 MK_MAX 行，整塊一次過寫
  var guests=Object.keys(marksByName).filter(function(nm){ return students.indexOf(nm)<0; });
  if(guests.length){
    var mkStart=DATA_START+R, lastCol=2+n+3;
    var c0=colLetter(DATE_COL0), cN=colLetter(DATE_COL0+Math.max(n-1,0));
    var block=[];
    for(var g=0; g<guests.length && g<MK_MAX; g++){
      var gn=guests[g], gm=marksByName[gn], rn=mkStart+g, line=["補", gn];
      var cells=[]; for(var c2=0;c2<n;c2++) cells.push("");
      Object.keys(gm).forEach(function(iso){
        var ci=dcol[iso];
        if(ci===undefined){ skip.push(cid+"|"+gn+"|"+iso+"|"+gm[iso]+"(非上課日)"); return; }
        cells[ci]=gm[iso]; wrote++;
      });
      line=line.concat(cells);
      line.push('=COUNTIF('+c0+rn+':'+cN+rn+',"出席")+COUNTIF('+c0+rn+':'+cN+rn+',"補堂")');
      line.push('=COUNTIF('+c0+rn+':'+cN+rn+',"請假")');
      line.push('=COUNTIF('+c0+rn+':'+cN+rn+',"缺席")');
      block.push(line);
    }
    if(block.length) sh.getRange(mkStart,1,block.length,lastCol).setValues(block);
    for(var g2=MK_MAX; g2<guests.length; g2++){
      var on=guests[g2], om=marksByName[on];
      Object.keys(om).forEach(function(iso){ skip.push(cid+"|"+on+"|"+iso+"|"+om[iso]+"(補堂區滿"+MK_MAX+")"); });
    }
  }
  // 重設驗證：日期欄 status 下拉；總結欄(出席/請假/缺席及右側)清驗證，免 COUNTIF 公式違反驗證。
  try{ vBlock.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES,true).setAllowInvalid(false).build()); }catch(e){}
  try{ sh.getRange(DATA_START, DATE_COL0+n, vBlockR, 5).setDataValidation(null); }catch(e){}
  return {wrote:wrote, skip:skip};
}

/* 刪走某欄被標記 "IMP" 嘅行（整塊讀→過濾→重寫），用於冪等重匯 */
function clearTagged_(sh, markCol){
  if(!sh) return; var last=sh.getLastRow(); if(last<2) return;
  var lastCol=sh.getLastColumn();
  var all=sh.getRange(2,1,last-1,lastCol).getValues();
  var keep=all.filter(function(row){ return String(row[markCol-1]||"").trim()!=="IMP"; });
  sh.getRange(2,1,last-1,lastCol).clearContent();
  if(keep.length) sh.getRange(2,1,keep.length,lastCol).setValues(keep);
}