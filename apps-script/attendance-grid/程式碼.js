/*  INITIATE SPORTS · 暑期班請假補堂系統 — 後端 v2 (Google Apps Script)
 *  方法B：每班「出席格仔表」= 可直接編輯嘅資料來源。
 *  - 你可以喺 Google Sheet 嘅班別分頁直接點名（揀 出席/缺席/請假/補堂，自動變色）
 *  - 手機 App 點名 / 家長請假補堂，都寫入「同一格」→ 唔會互相覆蓋
 *  安裝：貼入 Code.gs → 改 CONFIG → 執行 setup() → 部署為網頁應用程式(任何人)
 *  ⚠️ 重新執行 setup() 會重建所有分頁（會清空現有出席/請假資料）。
 */

const CONFIG = {
  COACH_EMAIL: "initiatesports6331@gmail.com",   // 收通知嘅 Gmail
  COACH_PASS:  PropertiesService.getScriptProperties().getProperty('COACH_PASS') || Utilities.getUuid(),  // 教練密碼:存 Script Properties(key=COACH_PASS),未設定則退回隨機值(fail-closed)
  START_MON:   "2026-07-13",
  N_SESS: 7,
  REMIND_HOUR: 20,                        // 每晚幾點檢查「未完成點名」（24 小時制）
};

const WD  = {"一":1,"二":2,"三":3,"四":4,"五":5,"六":6};
const WDN = ["日","一","二","三","四","五","六"];
const SPORT = {
  badminton:{name:"羽毛球",cap:12}, basketball:{name:"籃球",cap:12},
  gym:{name:"體操",cap:12}, athletics:{name:"田徑",cap:12},
  rope:{name:"花式跳繩",cap:12}, pickleball:{name:"匹克球",cap:6},
  fitness:{name:"運動體能",cap:12},
};
const TIMES = {
  "badminton|二":"13:00–15:00","badminton|三":"11:00–13:00","badminton|四":"10:00–12:00",
  "basketball|三":"09:00–10:00","gym|一":"14:00–15:00","gym|四":"15:00–16:00",
  "athletics|二":"17:15–18:15","athletics|四":"17:15–18:15",
  "rope|四":"14:00–15:00","rope|六":"15:00–16:00","pickleball|二":"10:00–11:00","pickleball|五":"13:00–15:00",
  "fitness|五":"15:00–16:00",
};
// 個別班別專屬學期（覆蓋全域 START_MON / N_SESS）。key=星期；只影響該星期嘅班。
// 花式跳繩(六)：2026-07-04 起，逢星期六，共 9 堂（最後一堂 2026-08-29）。
const SCHED_OVR = { "六":{start:"2026-07-04", n:9} };

const ROSTER = {
  badminton:{ "二":["蔡思言","梁心朗","吳瑋軒","黎柏希","黎柏言","葉天麒"],
              "三":["王韻喬","易晞渝","蔡芷彤","羅芷晴","潘洛詩","蔣佩琪","何諾軒"],
              "四":["張爾淳","張雅堯","劉鎮碩","劉家頤","方鎮浩","鄧可澄","陳大文"] },
  basketball:{"三":["張爾淳","張雅堯","甘卓熹","羅天佑","方鎮浩","曾衍霖","黃梓昕","方鎂恩"]},
  gym:{ "一":["曾愛斯","陳卓楠","王尉鏇","王斯顏","古詩詠"],
        "四":["黃樂悠","方鎂恩","劉家頤","張雅堯","盧文懿","呂洛希","周莉晶"] },
  athletics:{ "二":["張爾淳","胡汐森","胡苡晨","古詩詠","古卓謙","陳柏謙"],
              "四":["曾愛斯","曾喬烽","葉芯怡","葉芯淇","方鎮浩","盧文懿","許思溢","徐翊之"] },
  rope:{ "四":["黃信晴","甘卓熹","陳卓琛","劉初靜","羅天佑","張煦翹"],
         "六":["陳皓軒","汪柏叡"] },
  pickleball:{ "二":["呂洛希","鍾皓惟","古卓謙"], "五":["姚心穎","黃朗程","鄧可澄","盧文懿","黃翊雅"] },
  // 運動體能(fitness) 五：只得 2 人(周莉晶、陳靖朗)，開唔成班 → 移除整班（2026-06-28）。
  // 周莉晶 仍報體操(四)不受影響；陳靖朗 只報此班 → 完全退出暑期。
};

const PHONE = {"黃梓昕":"0397","曾衍霖":"0035","曾愛斯":"7058","曾喬烽":"7058","葉芯怡":"6759","葉芯淇":"6759","張爾淳":"1272","方鎮浩":"0162","胡汐森":"9126","胡苡晨":"9126","盧文懿":"5122","許思溢":"9159","古詩詠":"9158","古卓謙":"9158","張雅堯":"1272","蔡思言":"7716","梁心朗":"8883","劉鎮碩":"5352","劉家頤":"5352","鄧可澄":"0386","吳瑋軒":"6735","黎柏希":"2698","黎柏言":"2698","葉天麒":"5078","王韻喬":"9062","易晞渝":"0570","蔡芷彤":"8852","羅芷晴":"1331","潘洛詩":"6171","蔣佩琪":"2581","黃信晴":"1750","羅天佑":"9275","甘卓熹":"6736","陳卓琛":"9870","劉初靜":"1040","呂洛希":"4917","姚心穎":"6606","黃朗程":"9749","鍾皓惟":"9704","黃翊雅":"5791","陳卓楠":"9870","黃樂悠":"8345","方鎂恩":"0162","王尉鏇":"6801","王斯顏":"6801","周莉晶":"5181","何諾軒":"9613","陳柏謙":"3488","徐翊之":"3705","張煦翹":"9011","陳皓軒":"2359","汪柏叡":"8643","陳靖朗":"0623","陳大文":"1234"};

/* 版面常數 */
const ROPE_SLOTS = [   // 花式跳繩補堂可選時段（一/三/四/六）；六15:00–16:00 已改為正規班，不再作補堂時段
  {wd:"一",time:"17:00–18:00"},{wd:"一",time:"18:00–19:00"},
  {wd:"三",time:"17:00–18:00"},
  {wd:"四",time:"15:00–16:00"},
  {wd:"六",time:"11:00–12:00"},
];
const HEAD_ROW=4, DATA_START=5, SEQ_COL=1, NAME_COL=2, DATE_COL0=3;
const STATUSES=["出席","缺席","請假","補堂","停課"];
const MK_MAX=20;            // 每班補堂區最多行數
const VERSION="v2-grid-mk10"; // 補堂寫入格仔版

/* ---------- 工具 ---------- */
function SS(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function startMon(){ var a=CONFIG.START_MON.split("-"); return new Date(+a[0],+a[1]-1,+a[2]); }
function iso(d){ return Utilities.formatDate(d, SS().getSpreadsheetTimeZone(), "yyyy-MM-dd"); }
function sessionsFor(wd){
  var o=SCHED_OVR[wd];
  if(o){ var a=o.start.split("-"), b0=new Date(+a[0],+a[1]-1,+a[2]), out0=[];
    for(var k=0;k<o.n;k++){ var y=new Date(b0); y.setDate(y.getDate()+k*7); out0.push(iso(y)); } return out0; }
  var out=[],b=startMon(); b.setDate(b.getDate()+(WD[wd]-1));
  for(var i=0;i<CONFIG.N_SESS;i++){ var x=new Date(b); x.setDate(x.getDate()+i*7); out.push(iso(x)); } return out; }
function pad4(x){ var s=String(x).replace(/\D/g,""); return ("0000"+s).slice(-4); }
/* ── 與恆常班(#4)密碼同步：讀 #4「登入密碼」分頁，家長改咗自訂密碼 → 暑期班亦即時生效 ──
 * 家庭鍵＝電話後4位（兩系統一致）。唯讀；首次部署後須喺 #9 編輯器手動跑一次 setup()/任何函數批准 openById 授權。*/
var REG4_SS_ID = "1MwIOIZ8tv6XXEnqlTlZgLli4cwlDMqHFxxusgefXvyE";   // INITIATE SPORTS 出席補堂系統(#4)
var _pin4Cache = null;
function pin4For_(last4){
  if(_pin4Cache===null){
    _pin4Cache={};
    try{
      var sh=SpreadsheetApp.openById(REG4_SS_ID).getSheetByName("登入密碼");  // 家庭(後4位), 自訂密碼, 更新時間
      if(sh && sh.getLastRow()>1){
        sh.getRange(2,1,sh.getLastRow()-1,2).getValues().forEach(function(r){
          var k=pad4(r[0]), v=pad4(r[1]); if(k && v) _pin4Cache[k]=v;
        });
      }
    }catch(e){ Logger.log("pin4For_ 讀 #4 登入密碼失敗（退回電話後4位）: "+e); }
  }
  return _pin4Cache[pad4(last4)]||"";
}
// 有效憑證檢查：接受「電話後4位」或「#4 自訂密碼」（與恆常班同步）
function credOK9_(last4, entered){
  var want=pad4(entered), p=pin4For_(last4);
  return want===pad4(last4) || (!!p && want===p);
}
function gridName(sport,wd){ return SPORT[sport].name+"("+wd+")"; }
function colLetter(c){ var s=""; while(c>0){ var m=(c-1)%26; s=String.fromCharCode(65+m)+s; c=(c-m-1)/26; } return s; }
function classKeyParts(key){ var a=key.split("|"); return {sport:a[0],wd:a[1]}; }

/* ---------- 安裝 ---------- */
function setup(){
  var ss=SS();
  try{ backup(); }catch(e){}     // 防呆：任何重建之前，先備份現狀
  // Roster（參考資料，安全重建）
  var R=ss.getSheetByName("Roster")||ss.insertSheet("Roster");
  R.clear(); R.appendRow(["學生中文全名","家長手機後4位","項目","星期","時間"]);
  R.getRange("B:B").setNumberFormat("@");
  Object.keys(ROSTER).forEach(function(sp){ Object.keys(ROSTER[sp]).forEach(function(wd){
    ROSTER[sp][wd].forEach(function(nm){ R.appendRow([nm,PHONE[nm]||"",sp,wd,TIMES[sp+"|"+wd]||""]); });
  });});
  // Log（只喺缺少時建立 → 保留現有紀錄）
  var L=ss.getSheetByName("Log");
  if(!L){ L=ss.insertSheet("Log"); L.appendRow(["時間","學生","項目|星期","動作","日期","狀態","可補","補去","補去日期"]); }
  // 補堂索引（記邊個、由邊班、補去邊班邊日；正規日狀態喺格仔=「格」，特殊日狀態存呢度）
  var M=ss.getSheetByName("補堂");
  if(!M){ M=ss.insertSheet("補堂"); M.appendRow(["學生","原班","補去班","補堂日期","狀態"]); }
  // 各班格仔（非破壞性：已存在就保留資料，只補回下拉/變色）
  Object.keys(ROSTER).forEach(function(sp){ Object.keys(ROSTER[sp]).forEach(function(wd){ buildGrid(ss,sp,wd,false); });});
  normalizeMakeupDates_();     // 把補堂索引日期修正成 yyyy-MM-dd 文字（兼修舊資料）
  try{ ensureRosterRows_(); }catch(e){}  // 自癒：ROSTER 新增但 grid 未有嘅學生，安全補回（保留現有狀態）
  syncMakeupsToGrid();         // 把補堂索引嘅每筆，確保寫返入目標班格仔
  try{ seedDemo_(); }catch(e){}  // 示範帳號（陳大文）種一個請假，等暑期補堂都 demo 到
  cleanupStray(ss);
  ensureAutoBackup();          // 確保每日自動備份排程存在
  ensureReminders();           // 確保每晚「點名未完成提醒」排程存在
  try{ backup(); }catch(e){}   // 即時備份一次
  Logger.log("setup 完成（非破壞性；已啟用每日自動備份）。");
}

// 自癒：把「ROSTER 已加、但 grid 仲未有」嘅學生補返入格仔。
// buildGrid 非破壞模式只會重設下拉/變色、唔會為已存在嘅班加新學生，所以新增學生需呢個補底。
// 做法：先讀晒現有狀態 → force 重建（含新學生）→ 寫返原有狀態，零資料遺失；冪等（全部齊就唔郁）。
function ensureRosterRows_(){
  var ss=SS();
  Object.keys(ROSTER).forEach(function(sp){ Object.keys(ROSTER[sp]).forEach(function(wd){
    var sh=ss.getSheetByName(gridName(sp,wd)); if(!sh) return;
    var students=ROSTER[sp][wd];
    var present={};
    sh.getRange(DATA_START,NAME_COL,students.length,1).getValues().forEach(function(r){
      var nm=String(r[0]||"").trim(); if(nm) present[nm]=true;
    });
    var missing=students.filter(function(nm){ return !present[nm]; });
    if(!missing.length) return;                 // 全部齊 → 唔郁
    var blk=readBlock(sp,wd);                    // 先保留現有狀態（keyed by 現有名）
    buildGrid(ss,sp,wd,true);                    // force：按完整 ROSTER 重建（含新學生）
    Object.keys(blk.status).forEach(function(nm){
      if(students.indexOf(nm)<0) return;         // 殘留/非正式名 → 唔還原到正式區
      var arr=blk.status[nm]||[];
      for(var i=0;i<arr.length && i<blk.dates.length;i++){ if(arr[i]) writeStatus(sp,wd,nm,blk.dates[i],arr[i]); }
    });
    Logger.log("ensureRosterRows_: "+gridName(sp,wd)+" 補回 "+missing.join("、")+"（已保留原有狀態）");
  });});
}

// 示範用：為 陳大文（羽毛球·四）種一個請假，令暑期補堂示範到「待補 1 堂 + 可揀補堂時段」。
// 冪等：佢已有任何格仔狀態就唔覆蓋；只係示範，唔影響真實學生。
function seedDemo_(){
  var sp="badminton", wd="四", nm="陳大文";
  if(!ROSTER[sp] || !ROSTER[sp][wd] || ROSTER[sp][wd].indexOf(nm)<0) return;
  var blk=readBlock(sp,wd), st=blk.status[nm]||[];
  if(st.some(function(x){ return x; })) return;              // 已有資料 → 唔重複種
  var dates=blk.dates; if(!dates.length) return;
  writeStatus(sp,wd,nm,dates[0],"請假");                     // 第一堂請假（可補堂）
  logAppend({name:nm,key:sp+"|"+wd,action:"leave",date:dates[0],status:"請假(示範)",eligible:true});
  Logger.log("示範帳號 陳大文 已種一個請假（"+dates[0]+"）。");
}

// 只刪明顯舊版殘留 / 預設空白分頁，唔會誤刪資料表
function cleanupStray(ss){
  var keep={Roster:1,Log:1,"補堂":1};
  Object.keys(ROSTER).forEach(function(sp){ Object.keys(ROSTER[sp]).forEach(function(wd){ keep[gridName(sp,wd)]=1; });});
  ss.getSheets().forEach(function(s){ var n=s.getName();
    if(keep[n]) return;
    if(n.indexOf("出席·")===0 || n==="工作表1" || n==="Sheet1"){ try{ ss.deleteSheet(s); }catch(e){} }
  });
}

// ⚠️ 破壞性：清空所有資料重建。只喺第一次安裝、或刻意重置先手動執行。
function rebuildAll(){
  var ss=SS();
  try{ backup(); }catch(e){}     // 防呆：刪除之前一定先備份
  ["Log","補堂"].forEach(function(n){ var s=ss.getSheetByName(n); if(s) ss.deleteSheet(s); });
  Object.keys(ROSTER).forEach(function(sp){ Object.keys(ROSTER[sp]).forEach(function(wd){
    var s=ss.getSheetByName(gridName(sp,wd)); if(s) ss.deleteSheet(s);
  });});
  setup();
  Logger.log("rebuildAll 完成（已全部重置）。");
}

/* ⚙️ 一次性：2026-06-18 名單更新（非破壞性）
 * 套用：羽毛球三+何諾軒、田徑二+陳柏謙、田徑四+徐翊之、花式跳繩四+張煦翹、
 *       花式跳繩(六)新班[陳皓軒,汪柏叡]、體操 周莉晶 一→四。
 * 做法：先 setup()（安全：建新班格、重建 Roster、保留 Log/補堂），
 *       再 force 重建「有加/減學生」嘅現有班格（未變動嘅 basketball三/badminton四 等請假補堂資料不受影響），
 *       最後由補堂索引還原補堂格。跑完即可，重複跑亦安全。 */
function applyRosterUpdate_20260618(){
  setup();                                  // 建 花式跳繩(六)、重建 Roster、保留 Log/補堂
  var ss=SS();
  [["gym","一"],["gym","四"],["badminton","三"],
   ["athletics","二"],["athletics","四"],["rope","四"]].forEach(function(c){
    buildGrid(ss,c[0],c[1],true);           // force：clear 後按新名單重建（呢幾班本身無請假/補堂資料）
  });
  syncMakeupsToGrid();                       // 由保留嘅補堂索引，還原各目標班補堂格
  Logger.log("applyRosterUpdate_20260618 完成（非破壞性）。");
}

function buildGrid(ss, sport, wd, force){
  var nm=gridName(sport,wd);
  var sh=ss.getSheetByName(nm);
  var dates=sessionsFor(wd), n=dates.length, students=ROSTER[sport][wd];
  // 已存在且有資料、又唔係強制重建 → 視乎結構：
  if(sh && !force && sh.getLastRow()>=DATA_START){
    var bottom=String(sh.getRange(DATA_START+students.length,NAME_COL).getValue()||"");
    if(bottom!=="出席人數"){   // 新結構 → 只重設下拉/變色（涵蓋補堂區），保留所有資料
      var bk=sh.getRange(DATA_START,DATE_COL0,students.length+MK_MAX,n);
      bk.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES,true).setAllowInvalid(false).build());
      applyCF(sh,bk);
      return;
    }
    // 否則係舊結構（仲有底部「出席人數」統計行）→ 自動升級一次（重建新結構）
  }
  sh = sh || ss.insertSheet(nm);
  sh.clear(); sh.setConditionalFormatRules([]);
  var time=TIMES[sport+"|"+wd]||"", lastCol=2+n+3;
  // 標題
  sh.getRange(1,1,1,lastCol).merge().setValue("INITIATE SPORTS　暑期"+SPORT[sport].name+"班")
    .setFontSize(14).setFontWeight("bold").setHorizontalAlignment("center");
  var d0=dates[0].slice(5).replace("-","/"), d1=dates[n-1].slice(5).replace("-","/");
  sh.getRange(2,1,1,lastCol).merge().setValue("逢星期"+wd+"  "+time+"　｜　"+d0+" – "+d1+"　｜　共 "+n+" 堂")
    .setHorizontalAlignment("center").setFontColor("#666");
  sh.getRange(3,1,1,lastCol).merge().setValue("點名：日期格揀「出席／缺席／請假／補堂」，同 App 即時同步；補堂學生會自動排喺名單下方")
    .setFontColor("#999").setFontSize(9);
  // 表頭
  var head=["序號","姓名"];
  for(var i=0;i<n;i++){ var p=dates[i].split("-"); head.push(p[1]+"/"+p[2]); }
  head.push("出席","請假","缺席");
  sh.getRange(HEAD_ROW,1,1,lastCol).setValues([head]).setFontWeight("bold")
    .setHorizontalAlignment("center").setBackground("#1BAFBD").setFontColor("#FFFFFF").setWrap(true);
  // 學生行
  var rows=[];
  for(var s=0;s<students.length;s++){
    var rn=DATA_START+s, r=[s+1, students[s]];
    for(var j=0;j<n;j++) r.push("");
    var c0=colLetter(DATE_COL0), cN=colLetter(DATE_COL0+n-1);
    r.push('=COUNTIF('+c0+rn+':'+cN+rn+',"出席")+COUNTIF('+c0+rn+':'+cN+rn+',"補堂")');
    r.push('=COUNTIF('+c0+rn+':'+cN+rn+',"請假")');
    r.push('=COUNTIF('+c0+rn+':'+cN+rn+',"缺席")');
    rows.push(r);
  }
  sh.getRange(DATA_START,1,students.length,lastCol).setValues(rows);
  // 外觀（邊框只到正式學生；補堂區留白俾系統自動填）
  sh.getRange(HEAD_ROW,1,students.length+1,lastCol).setBorder(true,true,true,true,true,true);
  sh.setColumnWidth(1,46); sh.setColumnWidth(2,92);
  for(var i=0;i<n;i++) sh.setColumnWidth(DATE_COL0+i,62);
  sh.setColumnWidth(DATE_COL0+n,52); sh.setColumnWidth(DATE_COL0+n+1,52); sh.setColumnWidth(DATE_COL0+n+2,52);
  sh.setFrozenRows(HEAD_ROW);
  // 下拉 + 變色（涵蓋正式學生 + 補堂區）
  var block=sh.getRange(DATA_START,DATE_COL0,students.length+MK_MAX,n);
  block.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES,true).setAllowInvalid(false).build());
  block.setHorizontalAlignment("center");
  applyCF(sh,block);
}
function applyCF(sh,block){
  sh.setConditionalFormatRules([
    cfRule(block,"出席","#C6EFCE","#006100"),
    cfRule(block,"補堂","#BDD7EE","#1F4E79"),
    cfRule(block,"請假","#FFEB9C","#9C6500"),
    cfRule(block,"缺席","#FFC7CE","#9C0006"),
    cfRule(block,"停課","#E2E3E5","#5F6368"),
  ]);
}
function cfRule(range,txt,bg,fc){
  return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(txt)
    .setBackground(bg).setFontColor(fc).setRanges([range]).build();
}

/* ---------- 讀寫格仔 ---------- */
function readBlock(sport,wd){
  var dates=sessionsFor(wd), n=dates.length, students=(ROSTER[sport]&&ROSTER[sport][wd])||null;
  var sh=(SPORT[sport])?SS().getSheetByName(gridName(sport,wd)):null;
  if(!students || !sh) return {dates:dates,n:n,students:students||[],status:{}};   // 班已由 ROSTER 移除／格已刪 → 回空 block，唔再 throw
  var vals=sh.getRange(DATA_START,NAME_COL,students.length,1+n).getValues();
  var map={};
  for(var i=0;i<students.length;i++){ map[String(vals[i][0])]=vals[i].slice(1).map(function(x){return String(x||"");}); }
  return {dates:dates,n:n,students:students,status:map};
}
function writeStatus(sport,wd,name,dateIso,status){
  var students=ROSTER[sport][wd]; if(!students) return false;
  var ri=students.indexOf(name); if(ri<0) return false;
  var di=sessionsFor(wd).indexOf(dateIso); if(di<0) return false;
  SS().getSheetByName(gridName(sport,wd)).getRange(DATA_START+ri,DATE_COL0+di).setValue(status);
  return true;
}

/* ---------- 補堂格仔（補堂學生寫入目標班嗰日格仔） ---------- */
function gridMeta(sport,wd){
  return {sh:SS().getSheetByName(gridName(sport,wd)), dates:sessionsFor(wd),
    n:sessionsFor(wd).length, students:ROSTER[sport][wd], R:ROSTER[sport][wd].length,
    mkStart:DATA_START+ROSTER[sport][wd].length};
}
function dateCol(m,dateIso){ var i=m.dates.indexOf(dateIso); return i<0?-1:DATE_COL0+i; }
// 搵某名嘅行（正式或補堂區）；create=true 時喺補堂區開新行
function findRow(m,name,create){
  var ri=m.students.indexOf(name); if(ri>=0) return DATA_START+ri;
  var names=m.sh.getRange(m.mkStart,NAME_COL,MK_MAX,1).getValues(), empty=-1;
  for(var j=0;j<MK_MAX;j++){ var v=String(names[j][0]||"");
    if(v===name) return m.mkStart+j; if(empty<0&&!v) empty=m.mkStart+j; }
  if(create && empty>=0){
    var r=empty, c0=colLetter(DATE_COL0), cN=colLetter(DATE_COL0+m.n-1);
    m.sh.getRange(r,SEQ_COL).setValue("補"); m.sh.getRange(r,NAME_COL).setValue(name);
    m.sh.getRange(r,DATE_COL0+m.n).setValue('=COUNTIF('+c0+r+':'+cN+r+',"出席")+COUNTIF('+c0+r+':'+cN+r+',"補堂")');
    m.sh.getRange(r,DATE_COL0+m.n+1).setValue('=COUNTIF('+c0+r+':'+cN+r+',"請假")');
    m.sh.getRange(r,DATE_COL0+m.n+2).setValue('=COUNTIF('+c0+r+':'+cN+r+',"缺席")');
    return r;
  }
  return -1;
}
// 統一寫格（正式或補堂）
function markCell(sport,wd,name,dateIso,status,create){
  var m=gridMeta(sport,wd); var c=dateCol(m,dateIso); if(c<0) return false;
  var row=findRow(m,name,!!create); if(row<0) return false;
  m.sh.getRange(row,c).setValue(status); return true;
}
// 讀某補堂學生喺目標班某日嘅狀態
function makeupStatus(sport,wd,name,dateIso){
  var m=gridMeta(sport,wd); var c=dateCol(m,dateIso); if(c<0) return "";
  var names=m.sh.getRange(m.mkStart,NAME_COL,MK_MAX,1).getValues();
  for(var j=0;j<MK_MAX;j++){ if(String(names[j][0]||"")===name) return String(m.sh.getRange(m.mkStart+j,c).getValue()||""); }
  return "";
}
// 讀整張表（正式 + 補堂行）
function readFull(sport,wd){
  var m=gridMeta(sport,wd), reg={}, mk=[];
  var rv=m.sh.getRange(DATA_START,NAME_COL,m.R,1+m.n).getValues();
  for(var i=0;i<m.R;i++) reg[String(rv[i][0])]=rv[i].slice(1).map(function(x){return String(x||"");});
  var mv=m.sh.getRange(m.mkStart,NAME_COL,MK_MAX,1+m.n).getValues();
  for(var j=0;j<MK_MAX;j++){ var nm=String(mv[j][0]||""); if(nm) mk.push({name:nm,statuses:mv[j].slice(1).map(function(x){return String(x||"");})}); }
  return {dates:m.dates,n:m.n,students:m.students,reg:reg,mk:mk};
}
// 把補堂索引日期欄一次過修成 yyyy-MM-dd 文字（修正被 Sheets 轉成 Date 嘅舊資料）
function normalizeMakeupDates_(){
  var M=makeupSheet(); if(!M||M.getLastRow()<2) return;
  var n=M.getLastRow()-1, rng=M.getRange(2,4,n,1), vals=rng.getValues();
  rng.setNumberFormat("@");
  rng.setValues(vals.map(function(r){ return [toIso_(r[0])]; }));
}
// 把補堂索引嘅每筆，確保已寫入目標班格仔（只限正規上課日；已有狀態就唔覆蓋）
function syncMakeupsToGrid(){
  makeupAll().forEach(function(m){
    var pr=classKeyParts(m.to);
    if(!ROSTER[pr.sport]||!ROSTER[pr.sport][pr.wd]) return;
    if(sessionsFor(pr.wd).indexOf(m.date)<0) return;  // 唔係正規上課日（如籃球後備日）→ 唔寫格
    var cur=makeupStatus(pr.sport,pr.wd,m.name,m.date);
    if(!cur) markCell(pr.sport,pr.wd,m.name,m.date,"補堂",true);
  });
}

/* ---------- Roster / 補堂 / Log ---------- */
function rosterRows(){ var sh=SS().getSheetByName("Roster");
  if(sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,5).getValues()
    .map(function(r){return {name:String(r[0]).trim(),last4:String(r[1]),sport:r[2],wd:String(r[3]),time:r[4]};})
    .filter(function(r){return r.name && ROSTER[r.sport] && ROSTER[r.sport][r.wd];}); }   // 只認 ROSTER const 仍有嘅班；已移除嘅班（如運動體能）舊 Roster 行自動忽略，login/檢查/readBlock 全部唔再撞
function makeupSheet(){ return SS().getSheetByName("補堂"); }
// 把任何日期值(Date 物件 / 文字 / 帶時間)一律正規化成 yyyy-MM-dd 文字
function toIso_(v){
  if(v instanceof Date) return Utilities.formatDate(v, SS().getSpreadsheetTimeZone(), "yyyy-MM-dd");
  var s=String(v||"").trim();
  var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return m[1]+"-"+m[2]+"-"+m[3];
  var d=new Date(s); if(!isNaN(d)) return Utilities.formatDate(d, SS().getSpreadsheetTimeZone(), "yyyy-MM-dd");
  return s;
}
function makeupAll(){ var sh=makeupSheet(); if(!sh||sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,5).getValues().map(function(r,i){
    return {row:i+2,name:String(r[0]),from:String(r[1]),to:String(r[2]),date:toIso_(r[3]),status:String(r[4]||"")};}); }
function logAppend(a){ SS().getSheetByName("Log").appendRow(
  [new Date(),a.name,a.key||"",a.action,a.date||"",a.status||"",a.eligible===undefined?"":a.eligible,a.to||"",a.toDate||""]); }

/* ---------- 補堂規則 ---------- */
function makeupSlotsFor(sport,wd){
  if(sport==="rope") return ROPE_SLOTS.map(function(s){return {sport:"rope",wd:s.wd,time:s.time};});
  if(sport==="pickleball") return wd==="五"
    ? [{sport:"pickleball",wd:"二",time:"10:00–11:00",note:"一堂兩小時，可分兩次補"}]
    : [{sport:"pickleball",wd:"五",time:"13:00–15:00",note:"補回一小時"}];
  if(sport==="athletics"){var o=wd==="二"?"四":"二";return[{sport:"athletics",wd:o,time:"17:15–18:15"}];}
  if(sport==="basketball") return [{sport:"basketball",wd:"三",time:"09:00–10:00",fixed:["2026-08-21","2026-08-28"],note:"後備日"}];
  if(sport==="badminton"||sport==="gym"){
    var all=sport==="badminton"?["二","三","四"]:["一","四"];
    return all.filter(function(w){return w!==wd;}).map(function(w){return {sport:sport,wd:w,time:TIMES[sport+"|"+w]};});
  }
  return [];
}
// 某時段字串（"13:00–15:00"）嘅小時數
function hoursOfTime_(t){
  var m=String(t||"").match(/(\d+):(\d+)\D+(\d+):(\d+)/); if(!m) return 1;
  return Math.max(1, Math.round(((Number(m[3])*60+Number(m[4]))-(Number(m[1])*60+Number(m[2])))/60));
}
// 每次請假可補嘅「補堂堂數」＝原班時數 ÷ 補堂時段時數。
// 例：匹克球 五(2小時)→二(1小時)＝2（一次請假可補兩堂）；其餘班同時數 → 1。
function makeupUnits_(sport,wd){
  var fromH=hoursOfTime_(TIMES[sport+"|"+wd]);
  var slots=makeupSlotsFor(sport,wd); if(!slots||!slots.length) return 1;
  var slotH=hoursOfTime_(slots[0].time||TIMES[slots[0].sport+"|"+slots[0].wd]);
  return Math.max(1, Math.round(fromH/slotH));
}

/* ---------- Web App ---------- */
function doGet(){ return ContentService.createTextOutput("INITIATE SPORTS API "+VERSION+" OK"); }
function doPost(e){
  var p={}; try{ p=JSON.parse(e.postData.contents); }catch(err){}
  var out; try{ out=route(p); }catch(err){ reportError_("#9 doPost "+(p&&p.action||""), err); out={ok:false,err:String(err)}; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
/* ═══════════ 統一錯誤通報：後端一出 exception 自動 email 老闆（節流防洗信）═══════════ */
function reportError_(where, err){
  try{
    var sig=String((err&&err.stack)||err).slice(0,140).replace(/\s+/g," ");
    var c=CacheService.getScriptCache();
    var k="errmail_"+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig)).slice(0,24);
    if(c.get(k)) return;
    if(Number(c.get("errmail_cap")||0)>=6) return;
    c.put(k,"1",900); c.put("errmail_cap", String(Number(c.get("errmail_cap")||0)+1), 3600);
    MailApp.sendEmail((CONFIG&&CONFIG.COACH_EMAIL) || "initiatesports6331@gmail.com",
      "🛑 INITIATE 系統錯誤（"+where+"）",
      "暑期班出席後端發生錯誤，已自動記錄：\n\n位置："+where+"\n\n"+String((err&&err.stack)||err)+
      "\n\n時間："+Utilities.formatDate(new Date(), "Asia/Hong_Kong", "yyyy-MM-dd HH:mm:ss")+
      "\n\n（同類錯誤 15 分鐘內只會通知一次）");
  }catch(e){ Logger.log("reportError_ 失敗："+e); }
}
function route(p){
  switch(p.action){
    case "login": return apiLogin(p);
    case "applyLeave": return apiLeave(p);
    case "cancelLeave": return apiCancelLeave(p);
    case "bookMakeup": return apiMakeup(p);
    case "cancelMakeup": return apiCancelMakeup(p);
    case "ping": return {ok:true, version:VERSION};
    case "health": return {ok:true, version:VERSION, problems:dataIntegrityCheck9_().concat(functionalCheck9_()).concat(writePathCheck9_())};  // 資料完整性+功能+寫入測試摘要(無學生姓名)，畀 #4 匯總
    case "verifyCoach": return apiVerifyCoach(p);  // 畀前端鎖畫面驗證,只回 true/false,不洩漏密碼
    case "dailyList": return apiDaily(p);
    case "markAttendance": return apiMark(p);
    case "cancelDay": return apiCancelDay(p);
    case "setVenue": return apiSetVenue(p);
    case "venuesAdmin": return apiVenuesAdmin(p);
    case "weeklyText": return apiWeeklyText(p);
    default: return {ok:false,err:"unknown action"};
  }
}

// 暑期 #9 資料完整性檢查：逐個(運動×星期)格掃姓名空白 / 補堂區不明姓名 / readBlock 出錯。
// 只回「數量＋格名」摘要，唔含學生姓名，可安全經 health 端點開放畀 #4 匯總。
function dataIntegrityCheck9_(){
  var P=[], known={}, groups={};
  rosterRows().forEach(function(r){ if(!r.name) return; known[r.name]=1; var k=r.sport+"|"+r.wd; (groups[k]=groups[k]||[]).push(r.name); });
  Object.keys(groups).forEach(function(k){
    var pp=k.split("|"), sport=pp[0], wd=pp[1], studs=groups[k];
    var nm=(SPORT[sport]&&SPORT[sport].name)||sport, sh=SS().getSheetByName(gridName(sport,wd));
    if(!sh){ P.push("暑期 "+nm+"("+wd+") 出席格唔見"); return; }
    var col=sh.getRange(DATA_START,NAME_COL,studs.length,1).getValues(), blank=0;
    for(var i=0;i<studs.length;i++){ if(!String(col[i][0]||"").trim()) blank++; }
    if(blank) P.push("暑期 "+nm+"("+wd+") 有 "+blank+" 個學生姓名空白");
    var seq=sh.getRange(DATA_START,SEQ_COL,studs.length,1).getValues();   // 序號連續性
    for(var s2=0;s2<studs.length;s2++){ if(String(seq[s2][0]||"").replace(/\D/g,"")!==String(s2+1)){ P.push("暑期 "+nm+"("+wd+") 序號錯位（疑插/刪行）"); break; } }
    var mk=sh.getRange(DATA_START+studs.length,NAME_COL,MK_MAX,1).getValues(), bad=0;
    for(var j=0;j<MK_MAX;j++){ var v=String(mk[j][0]||"").trim(); if(v && !known[v]) bad++; }
    if(bad) P.push("暑期 "+nm+"("+wd+") 補堂區有 "+bad+" 個不明姓名");
    try{ readBlock(sport,wd); }catch(e){ P.push("暑期 "+nm+"("+wd+") readBlock 出錯"); }
  });
  return P;
}
// 暑期 #9 功能 smoke：今日點名表行得通
function functionalCheck9_(){
  var P=[], today=Utilities.formatDate(new Date(), SS().getSpreadsheetTimeZone(), "yyyy-MM-dd");
  try{ var r=apiDaily({date:today, coachPass:CONFIG.COACH_PASS}); if(r&&r.ok===false) P.push("暑期 今日點名表 回傳失敗："+(r.err||"?")); }catch(e){ P.push("暑期 今日點名表 出錯："+e); }
  return P;
}
// 暑期 #9 寫入鏈 round-trip：示範帳號(陳大文 羽毛球四)空白未來格 寫請假→驗→清→驗
function writePathCheck9_(){
  var P=[], nm="陳大文", sport="badminton", wd="四";
  if(!ROSTER[sport]||!ROSTER[sport][wd]||ROSTER[sport][wd].indexOf(nm)<0) return P;
  var today=Utilities.formatDate(new Date(), SS().getSpreadsheetTimeZone(), "yyyy-MM-dd");
  var blk=readBlock(sport,wd), futs=sessionsFor(wd).filter(function(d){ return d>today; }), d=null;
  for(var i=0;i<futs.length;i++){ var di=blk.dates.indexOf(futs[i]); if((di>=0?String((blk.status[nm]||[])[di]||""):"")===""){ d=futs[i]; break; } }
  if(!d) return P;
  try{
    writeStatus(sport,wd,nm,d,"請假");
    var b1=readBlock(sport,wd); if(String((b1.status[nm]||[])[b1.dates.indexOf(d)]||"")!=="請假") P.push("暑期寫入測試・寫請假後讀返唔係請假");
    writeStatus(sport,wd,nm,d,"");
    var b2=readBlock(sport,wd); if(String((b2.status[nm]||[])[b2.dates.indexOf(d)]||"")!=="") P.push("暑期寫入測試・清除後仍殘留");
  }catch(e){ P.push("暑期寫入測試・出錯："+e); }
  finally{ try{ writeStatus(sport,wd,nm,d,""); }catch(e){} }
  return P;
}
// 計一個小朋友嘅所有班別資料（含補堂限期 deadline）
function classesFor_(nm){
  var rows=rosterRows().filter(function(r){return r.name===nm;});
  var mk=makeupAll().filter(function(m){return m.name===nm;});
  return rows.map(function(r){
    var key=r.sport+"|"+r.wd, blk=readBlock(r.sport,r.wd), st=blk.status[nm]||[];
    var att=0,lv=0,ab=0;
    st.forEach(function(s){ if(s==="出席"||s==="補堂")att++; else if(s==="請假")lv++; else if(s==="缺席")ab++; });
    var myMk=mk.filter(function(m){return m.from===key;});
    var mkInfo=myMk.map(function(m){ var pr=classKeyParts(m.to);
      var onGrid = ROSTER[pr.sport] && ROSTER[pr.sport][pr.wd] && sessionsFor(pr.wd).indexOf(m.date)>=0;
      var stt = onGrid ? (makeupStatus(pr.sport,pr.wd,nm,m.date)||"補堂") : (m.status||"補堂");
      return {to:m.to,date:m.date,status:stt}; });
    var mkAtt=mkInfo.filter(function(x){return x.status==="出席";}).length;
    var sessions=blk.dates.map(function(d,i){return {date:d,status:st[i]||""};});
    var deadline=blk.dates.length? blk.dates[blk.dates.length-1] : "";  // 補堂限期＝本班最後一堂
    return {sport:r.sport,wd:r.wd,time:r.time,total:blk.dates.length,
      attended:att+mkAtt, leave:lv, absent:ab,
      owed:Math.max(0, lv*makeupUnits_(r.sport,r.wd)-myMk.length), sessions:sessions, makeups:mkInfo, deadline:deadline};
  });
}

// 登入防爆破節流（CacheService，按帳號計失敗次數，5 分鐘窗口）
function rlBlocked_(bucket, max){ return Number(CacheService.getScriptCache().get("rl_"+bucket)||0) >= max; }
function rlBump_(bucket, ttlSec){ var c=CacheService.getScriptCache(), k="rl_"+bucket; c.put(k, String(Number(c.get(k)||0)+1), ttlSec); }
function rlClear_(bucket){ CacheService.getScriptCache().remove("rl_"+bucket); }

function apiVerifyCoach(p){
  if(rlBlocked_("coachlogin", 10)) return {ok:false, err:"嘗試太多次，請約 5 分鐘後再試"};
  var ok = String(p.coachPass)===String(CONFIG.COACH_PASS);
  if(ok) rlClear_("coachlogin"); else rlBump_("coachlogin", 300);
  return {ok: ok};
}

function apiLogin(p){
  var want=pad4(p.last4), nm=String(p.name).trim();
  if(rlBlocked_("login_"+nm, 12)) return {ok:false,err:"嘗試太多次，請約 5 分鐘後再試"};
  var all=rosterRows();
  // 必須中文全名＋（手機後4位 或 恆常班自訂密碼）配對先得（防止淨係靠後4位掃出全部學生）
  var hit=all.filter(function(r){ return r.name===nm && credOK9_(r.last4, p.last4); });
  if(!hit.length){ rlBump_("login_"+nm, 300); return {ok:false,err:"搵唔到，請檢查中文全名同手機後4位（如已設定自訂密碼請用自訂密碼）"}; }
  rlClear_("login_"+nm);
  var fam=pad4(hit[0].last4);   // 真正家庭鍵＝電話後4位（即使用自訂密碼登入亦然）
  var surn=nm.charAt(0);        // 同姓先當一家：防同一後4位撞唔同家庭時洩漏別人資料（與 #4 一致）
  // 同一電話後4位＋同姓 = 一家人，列出所有小朋友（去重）
  var names=[]; all.forEach(function(r){ if(pad4(r.last4)===fam && String(r.name).trim().charAt(0)===surn && names.indexOf(r.name)<0) names.push(r.name); });
  var children=names.map(function(cn){ return {name:cn, classes:classesFor_(cn)}; });
  // 向後兼容：保留 student/classes（第一個小朋友）。一律回傳家庭鍵＝電話後4位（fam），
  // 令前端之後嘅操作（authParent_）用後4位驗證，即使今次用自訂密碼登入亦正常。
  return {ok:true, family:{last4:fam}, children:children,
    venues:venueMap_(),
    student:{name:nm,last4:fam}, classes:children.length?children[0].classes:[]};
}
/* ═══════════ 上課地點（場地）：教練設定，家長端每節顯示；一鍵生成 WhatsApp 文案 ═══════════ */
function venueSheet_(){
  var sh=SS().getSheetByName("場地");
  if(!sh){ sh=SS().insertSheet("場地"); sh.appendRow(["日期","班別","體育館","場地","更新時間"]); sh.getRange("A:A").setNumberFormat("@"); return sh; }
  // 舊格式（無「班別」欄）遷移：喺 A 之後插入「班別」欄；舊列班別留空＝該日全部班
  var lc=Math.max(1,sh.getLastColumn()), hdr=sh.getRange(1,1,1,lc).getValues()[0];
  if(String(hdr[1]||"")!=="班別"){ sh.insertColumnAfter(1); sh.getRange(1,2).setValue("班別"); }
  return sh;
}
function venueRows_(){
  var sh=venueSheet_(); if(sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,5).getValues().map(function(r,i){
    return {row:i+2, date:toIso_(r[0]), cid:String(r[1]||"").trim(), centre:String(r[2]||"").trim(), room:String(r[3]||"").trim(), at:String(r[4]||"")};
  }).filter(function(x){ return x.date; });
}
// nested：{ date: { "_all":{centre,room}, "sport|wd":{centre,room}, ... } }；班別空＝_all（該日全部班）
function venueMap_(){
  var m={};
  venueRows_().forEach(function(v){ if(!(v.centre||v.room)) return;
    (m[v.date]=m[v.date]||{})[v.cid||"_all"]={centre:v.centre, room:v.room};
  });
  return m;
}
function venueFor_(vmap,date,cid){ var d=vmap[date]; if(!d) return null; return d[cid]||d["_all"]||null; }
function nowStamp9_(){ return Utilities.formatDate(new Date(), SS().getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm"); }
function todayIso9_(){ return Utilities.formatDate(new Date(), SS().getSpreadsheetTimeZone(), "yyyy-MM-dd"); }
function addDaysIso9_(isoStr,n){ var d=new Date(isoStr+"T00:00:00"); d.setDate(d.getDate()+n); return Utilities.formatDate(d, SS().getSpreadsheetTimeZone(), "yyyy-MM-dd"); }
function apiSetVenue(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var date=toIso_(p.date); if(!date) return {ok:false,err:"請揀日期"};
  var cid=String(p.cid||"").trim();   // 空＝該日全部班；否則 "sport|wd"
  var centre=String(p.centre||"").trim(), room=String(p.room||"").trim();
  var sh=venueSheet_(), hit=null;
  venueRows_().forEach(function(v){ if(v.date===date && (v.cid||"")===cid) hit=v; });
  if(!centre && !room){ if(hit) sh.deleteRow(hit.row); return {ok:true, cleared:true}; }
  if(hit){ sh.getRange(hit.row,1,1,5).setValues([[date,cid,centre,room,nowStamp9_()]]); }
  else { var nr=sh.getLastRow()+1; sh.getRange(nr,1).setNumberFormat("@"); sh.getRange(nr,1,1,5).setValues([[date,cid,centre,room,nowStamp9_()]]); }
  return {ok:true};
}
function apiVenuesAdmin(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  return {ok:true, venues:venueRows_().filter(function(v){return v.centre||v.room;}).sort(function(a,b){return a.date<b.date?1:-1;})};
}
// 一鍵生成 WhatsApp 文案：未來 days 日內每個暑期上課日（日期＋地點＋場地＋各運動時間）
function apiWeeklyText(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var days=Number(p.days)||10, today=todayIso9_(), end=addDaysIso9_(today,days), vmap=venueMap_();
  var WDZH=["日","一","二","三","四","五","六"], byDate={};
  Object.keys(ROSTER).forEach(function(sp){ Object.keys(ROSTER[sp]).forEach(function(wd){
    var time=TIMES[sp+"|"+wd]||"", cid=sp+"|"+wd;
    sessionsFor(wd).forEach(function(d){ if(d>=today && d<=end){ (byDate[d]=byDate[d]||[]).push({cid:cid, sport:(SPORT[sp]&&SPORT[sp].name)||sp, time:time}); } });
  });});
  var out=Object.keys(byDate).sort().map(function(d){
    var dt=new Date(d+"T00:00:00"), head=dt.getDate()+"/"+(dt.getMonth()+1)+"（"+WDZH[dt.getDay()]+"）";
    var sess=byDate[d].slice().sort(function(a,b){return (a.time||"")<(b.time||"")?-1:1;});
    // 按場地分組：同場地嘅運動合併一段；唔同場地各自一段
    var groups=[], gkey={};
    sess.forEach(function(s){
      var v=venueFor_(vmap,d,s.cid)||{centre:"",room:""}, k=(v.centre||"")+"|"+(v.room||"");
      if(gkey[k]==null){ gkey[k]=groups.length; groups.push({v:v, lines:[]}); }
      groups[gkey[k]].lines.push(s.sport+"："+s.time);
    });
    var body=groups.map(function(g){
      var v=g.v, centreLine = v.centre ? (v.centre==="青衣體育館"?v.centre:("❗"+v.centre+"❗")) : "（地點待定）";
      return centreLine+(v.room?("\n"+v.room):"")+"\n"+g.lines.join("\n");
    }).join("\n");
    return head+"\n"+body;
  });
  return {ok:true, text: out.join("\n\n"), count: out.length};
}

// 家長操作權限：須附家庭登入碼（手機後4位 或 恆常班自訂密碼），且該學生屬於該家庭，方可操作（防冒名）
function authParent_(name, code){
  var nm=String(name).trim(), want=pad4(code);
  if(rlBlocked_("login_"+nm, 12)) return false;
  var ok=rosterRows().some(function(r){ return r.name===nm && credOK9_(r.last4, code); });
  if(ok) rlClear_("login_"+nm); else rlBump_("login_"+nm, 300);
  return ok;
}

function apiLeave(p){
  if(!authParent_(p.name,p.code)) return {ok:false,err:"登入碼不正確，無法操作"};
  var pr=classKeyParts(p.key);
  var t=(p.date||"")+"T"+((TIMES[p.key]||"00:00").slice(0,5))+":00";
  var hrs=(new Date(t)-new Date())/36e5;
  var eligible=(p.leaveType==="病假")?true:hrs>=24;
  var cell=eligible?"請假":"缺席";
  writeStatus(pr.sport,pr.wd,p.name,p.date,cell);
  logAppend({name:p.name,key:p.key,action:"leave",date:p.date,status:"請假("+p.leaveType+")",eligible:eligible});
  notify("【請假】"+p.name, p.name+"\n班別："+p.key+"\n日期："+p.date+"\n假別："+p.leaveType
    +"\n結果："+(eligible?"可補堂（格內已標請假）":"不足24小時／待醫生證明 → 已標缺席照計一堂"));
  return {ok:true, eligible:eligible};
}

// 取消請假：把該堂格仔還原做空白（未上）。只限本班正規上課日、未過、現狀態為請假/缺席。
function apiCancelLeave(p){
  if(!authParent_(p.name,p.code)) return {ok:false,err:"登入碼不正確，無法操作"};
  var pr=classKeyParts(p.key);
  if(!ROSTER[pr.sport]||!ROSTER[pr.sport][pr.wd]) return {ok:false,err:"班別不存在"};
  if(sessionsFor(pr.wd).indexOf(p.date)<0) return {ok:false,err:"並非此班上課日"};
  var today=Utilities.formatDate(new Date(), SS().getSpreadsheetTimeZone(), "yyyy-MM-dd");
  if(String(p.date)<today) return {ok:false,err:"課堂已過，無法取消請假"};
  var blk=readBlock(pr.sport,pr.wd), st=blk.status[p.name]||[], di=blk.dates.indexOf(p.date);
  var cur=di>=0?String(st[di]||""):"";
  if(cur!=="請假" && cur!=="缺席") return {ok:false,err:"此堂並非請假狀態，毋須取消"};
  writeStatus(pr.sport,pr.wd,p.name,p.date,"");   // 還原做未上
  logAppend({name:p.name,key:p.key,action:"cancelLeave",date:p.date,status:"取消請假(原:"+cur+")"});
  notify("【取消請假】"+p.name, p.name+"\n班別："+p.key+"\n日期："+p.date+"\n原狀態："+cur+"\n已還原為正常出席（未上）。如該堂已約補堂，補堂仍保留。");
  return {ok:true};
}

function apiMakeup(p){
  if(!authParent_(p.name,p.code)) return {ok:false,err:"登入碼不正確，無法操作"};
  var from=classKeyParts(p.fromKey), to=classKeyParts(p.toKey), date=toIso_(p.toDate);
  var dup=makeupAll().some(function(m){ return m.name===p.name && m.from===p.fromKey && m.to===p.toKey && m.date===date; });
  if(dup) return {ok:true, dup:true};                            // 已約過同一堂 → 唔重複寫
  // —— 後端驗證閘（唔淨係信前端，防繞過網頁直打 API）——
  // (a) 原班存在、且學生確屬該班
  if(!ROSTER[from.sport]||!ROSTER[from.sport][from.wd]) return {ok:false,err:"原班不存在"};
  var inClass=rosterRows().some(function(r){ return r.name===p.name && (r.sport+"|"+r.wd)===p.fromKey; });
  if(!inClass) return {ok:false,err:"並非此班學生，無法補堂"};
  // (b) 仲有待補額：請假數 − 已約補堂數 > 0
  var fblk=readBlock(from.sport,from.wd), fst=fblk.status[p.name]||[], lv=0;
  fst.forEach(function(s){ if(s==="請假") lv++; });
  var booked=makeupAll().filter(function(m){ return m.name===p.name && m.from===p.fromKey; }).length;
  if(lv*makeupUnits_(from.sport,from.wd)-booked<=0) return {ok:false,err:"冇待補堂數，無法補堂"};
  // (c) 補堂目標必須係此原班嘅合法時段（同項目、指定星期）
  var slots=makeupSlotsFor(from.sport, from.wd), slot=null;
  for(var si=0; si<slots.length; si++){ if(slots[si].sport===to.sport && slots[si].wd===to.wd){ slot=slots[si]; break; } }
  if(!slot) return {ok:false,err:"並非有效補堂時段"};
  // (d) 日期：唔可以過去；籃球後備日用固定日，其餘唔可以過補堂限期（原班最後一堂）
  var todayIso_=Utilities.formatDate(new Date(), SS().getSpreadsheetTimeZone(), "yyyy-MM-dd");
  if(date<todayIso_) return {ok:false,err:"補堂日已過，無法補堂"};
  if(slot.fixed){
    if(slot.fixed.indexOf(date)<0) return {ok:false,err:"並非有效後備日"};
  } else {
    var dl=fblk.dates.length? fblk.dates[fblk.dates.length-1] : "";
    if(dl && date>dl) return {ok:false,err:"已超過補堂限期：須於 "+dl+" 或之前補堂"};
  }
  var onGrid = (ROSTER[to.sport] && ROSTER[to.sport][to.wd] && sessionsFor(to.wd).indexOf(date)>=0);
  if(onGrid) markCell(to.sport,to.wd,p.name,date,"補堂",true);   // 正規上課日 → 寫入格仔
  var M=makeupSheet(), row=M.getLastRow()+1;
  M.getRange(row,4).setNumberFormat("@");                        // 補堂日期鎖文字，防止 Sheets 轉做 Date
  M.getRange(row,1,1,5).setValues([[p.name,p.fromKey,p.toKey,date, onGrid?"格":"補堂"]]);
  logAppend({name:p.name,key:p.fromKey,action:"makeup",to:p.toKey,toDate:date,status:"補堂"});
  notify("【補堂】"+p.name, p.name+"\n原班："+p.fromKey+"\n補去："+p.toKey+"　"+date
    +"\n（已加入該班該日點名表）");
  return {ok:true};
}

// 取消補堂：刪 ledger 紀錄 + 清返目標班格仔。只限未出席/缺席、未過日。
function apiCancelMakeup(p){
  if(!authParent_(p.name,p.code)) return {ok:false,err:"登入碼不正確，無法操作"};
  var to=classKeyParts(p.toKey), date=toIso_(p.toDate);
  var today=Utilities.formatDate(new Date(), SS().getSpreadsheetTimeZone(), "yyyy-MM-dd");
  var all=makeupAll(), hit=null;
  for(var i=0;i<all.length;i++){ var m=all[i];
    if(m.name===p.name && m.from===p.fromKey && m.to===p.toKey && m.date===date){ hit=m; break; } }
  if(!hit) return {ok:false,err:"搵唔到呢個補堂紀錄"};
  var onGrid = ROSTER[to.sport] && ROSTER[to.sport][to.wd] && sessionsFor(to.wd).indexOf(date)>=0;
  var stt = onGrid ? (makeupStatus(to.sport,to.wd,p.name,date)||"補堂") : (hit.status||"補堂");
  if(stt==="出席"||stt==="缺席") return {ok:false,err:"此補堂已"+stt+"，無法取消"};
  if(String(date)<today) return {ok:false,err:"補堂日已過，無法取消"};
  if(onGrid) markCell(to.sport,to.wd,p.name,date,"",false);   // 清返格仔
  makeupSheet().deleteRow(hit.row);                            // 刪 ledger 行
  logAppend({name:p.name,key:p.fromKey,action:"cancelMakeup",to:p.toKey,toDate:date,status:"取消補堂"});
  notify("【取消補堂】"+p.name, p.name+"\n原班："+p.fromKey+"\n原補去："+p.toKey+"　"+date+"\n已取消，待補堂數回復。");
  return {ok:true};
}

function apiDaily(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var date=p.date, groups={};
  Object.keys(ROSTER).forEach(function(sp){ Object.keys(ROSTER[sp]).forEach(function(wd){
    if(sessionsFor(wd).indexOf(date)<0) return;
    var full=readFull(sp,wd), di=full.dates.indexOf(date), key=sp+"|"+wd;
    var g={c:{sport:sp,wd:wd,time:TIMES[key]||""},rows:[]};
    full.students.forEach(function(nm){ g.rows.push({name:nm,makeup:false,status:(full.reg[nm]||[])[di]||""}); });
    full.mk.forEach(function(x){ if(x.statuses[di]) g.rows.push({name:x.name,makeup:true,status:x.statuses[di]}); });
    groups[key]=g;
  });});
  // 合併特殊日（非正規上課日）補堂，例如籃球後備日；正規日已喺格仔涵蓋
  makeupAll().forEach(function(m){ if(m.date!==date) return;
    var pr=classKeyParts(m.to);
    var onGrid = ROSTER[pr.sport] && ROSTER[pr.sport][pr.wd] && sessionsFor(pr.wd).indexOf(m.date)>=0;
    if(onGrid) return;
    if(!groups[m.to]) groups[m.to]={c:{sport:pr.sport,wd:pr.wd,time:TIMES[m.to]||""},rows:[]};
    groups[m.to].rows.push({name:m.name,makeup:true,status:(m.status&&m.status!=="格"?m.status:"補堂")});
  });
  return {ok:true, list:Object.keys(groups).map(function(k){return groups[k];})};
}

function apiMark(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};  // 點名屬寫入動作,必須教練密碼
  var pr=classKeyParts(p.key);
  if(markCell(pr.sport,pr.wd,p.name,p.date,p.status,false)) return {ok:true};  // 格仔（正式或補堂行）
  // 特殊日補堂 → 更新索引狀態
  var sh=makeupSheet(), all=makeupAll();
  for(var i=0;i<all.length;i++){ if(all[i].name===p.name && all[i].to===p.key && all[i].date===p.date){
    sh.getRange(all[i].row,5).setValue(p.status); return {ok:true}; } }
  return {ok:false,err:"搵唔到該學生喺呢班嘅行"};
}

// 天氣停課：把指定日子所有班（正式+補堂）標記為「停課」，回傳處理咗邊幾班
function apiCancelDay(p){
  if(String(p.coachPass)!==String(CONFIG.COACH_PASS)) return {ok:false,err:"密碼錯誤"};
  var date=toIso_(p.date), classes=[];
  Object.keys(ROSTER).forEach(function(sp){ Object.keys(ROSTER[sp]).forEach(function(wd){
    if(sessionsFor(wd).indexOf(date)<0) return;
    var full=readFull(sp,wd), di=full.dates.indexOf(date), cnt=0;
    full.students.forEach(function(nm){ if(markCell(sp,wd,nm,date,"停課",false)) cnt++; });
    full.mk.forEach(function(x){ if(x.statuses[di]){ markCell(sp,wd,x.name,date,"停課",false); cnt++; } });
    if(cnt) classes.push({sport:sp,wd:wd,n:cnt});
  });});
  // 特殊日（如籃球後備）補堂亦標停課（喺索引）
  var sh=makeupSheet();
  makeupAll().forEach(function(m){ if(m.date!==date) return;
    var pr=classKeyParts(m.to);
    if(!(ROSTER[pr.sport]&&ROSTER[pr.sport][pr.wd]&&sessionsFor(pr.wd).indexOf(date)>=0)) sh.getRange(m.row,5).setValue("停課");
  });
  logAppend({name:"(全班)",key:"-",action:"cancelDay",date:date,status:"停課"});
  notify("【停課】"+date, "今日課堂已標記為停課（共 "+classes.length+" 班）。按報名須知計一堂、不設補堂。");
  return {ok:true, date:date, classes:classes};
}

/* ---------- 通知（Email） ---------- */
function notify(subject, body){
  try{ GmailApp.sendEmail(CONFIG.COACH_EMAIL, "INITIATE SPORTS · "+subject, body); }catch(e){}
}

/* ---------- 點名未完成提醒（每晚自動） ---------- */
function ensureReminders(){
  try{
    var has=ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction()==="remindUnmarked"; });
    if(!has){ ScriptApp.newTrigger("remindUnmarked").timeBased().everyDays(1).atHour(CONFIG.REMIND_HOUR||20).create(); }
  }catch(e){}
}
// 檢查「今日」有上課嘅班，有冇學生未點名；有就通知教練
function remindUnmarked(){
  var ss=SS(), today=Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
  var lines=[];
  Object.keys(ROSTER).forEach(function(sp){ Object.keys(ROSTER[sp]).forEach(function(wd){
    if(sessionsFor(wd).indexOf(today)<0) return;                 // 今日呢班冇堂
    var full=readFull(sp,wd), di=full.dates.indexOf(today), miss=[];
    full.students.forEach(function(nm){ if(!((full.reg[nm]||[])[di]||"")) miss.push(nm); });
    full.mk.forEach(function(x){ if(x.statuses[di]==="補堂") miss.push(x.name+"(補)"); });  // 補堂仲係「補堂」=未確認出席
    if(miss.length) lines.push("・"+SPORT[sp].name+"("+wd+")："+miss.length+" 人未點 — "+miss.join("、"));
  });});
  if(!lines.length) return;                                       // 全部點晒 → 唔煩你
  notify("【點名提醒】今日仲有未完成", today+"（星期"+WDN[new Date(today+"T00:00:00").getDay()]+"）\n"
    +lines.join("\n")+"\n\n請開教練版補返點名。");
}

/* ---------- 暑期出席報表 ---------- */
function buildReport(){
  var ss=SS(), sh=ss.getSheetByName("出席報表")||ss.insertSheet("出席報表");
  sh.clear();
  sh.appendRow(["INITIATE SPORTS · 暑期出席報表","","","","","","","",""]);
  sh.appendRow(["產生時間："+Utilities.formatDate(new Date(),ss.getSpreadsheetTimeZone(),"yyyy-MM-dd HH:mm"),"","","","","","","",""]);
  sh.appendRow(["項目","星期","學生","總堂","已上","請假","缺席","補堂(約/到)","出席率"]);
  var rows=[], mkAll=makeupAll();
  Object.keys(ROSTER).forEach(function(sp){ Object.keys(ROSTER[sp]).forEach(function(wd){
    var key=sp+"|"+wd, full=readFull(sp,wd);
    full.students.forEach(function(nm){
      var st=full.reg[nm]||[], att=0,lv=0,ab=0;
      st.forEach(function(s){ if(s==="出席")att++; else if(s==="請假")lv++; else if(s==="缺席")ab++; });
      var myMk=mkAll.filter(function(m){return m.from===key && m.name===nm;}), mkAtt=0, mkAb=0;
      myMk.forEach(function(m){ var pr=classKeyParts(m.to);
        var on=ROSTER[pr.sport]&&ROSTER[pr.sport][pr.wd]&&sessionsFor(pr.wd).indexOf(m.date)>=0;
        var s=on?makeupStatus(pr.sport,pr.wd,nm,m.date):(m.status||"");
        if(s==="出席")mkAtt++; else if(s==="缺席")mkAb++; });
      var present=att+mkAtt, held=present+ab+mkAb;        // 已舉行=出席+缺席（請假同未點唔計）
      var rate=held>0?Math.round(present/held*100)+"%":"—";
      rows.push([SPORT[sp].name,"星期"+wd,nm,CONFIG.N_SESS,present,lv,ab,myMk.length+"/"+mkAtt,rate]);
    });
  });});
  if(rows.length) sh.getRange(4,1,rows.length,9).setValues(rows);
  sh.getRange(1,1,1,9).merge().setFontSize(14).setFontWeight("bold").setBackground("#1BAFBD").setFontColor("#FFFFFF").setHorizontalAlignment("center");
  sh.getRange(2,1,1,9).merge().setFontColor("#999").setFontSize(10);
  sh.getRange(3,1,1,9).setFontWeight("bold").setBackground("#EAF8FA");
  sh.setFrozenRows(3); sh.setColumnWidth(1,72); sh.setColumnWidth(3,96); sh.setColumnWidth(8,86);
  try{ SpreadsheetApp.getUi().alert("已產生「出席報表」分頁（"+rows.length+" 位學生）。"); }catch(e){}
  return rows.length;
}

function onOpen(){
  SpreadsheetApp.getUi().createMenu("INITIATE")
    .addItem("初始化 / 更新（保留資料）","setup")
    .addItem("產生出席報表","buildReport")
    .addItem("立即備份","backup")
    .addItem("備份清單","listBackups")
    .addItem("還原至最近備份（最完整）","restoreLatest")
    .addItem("還原（自選時間）","restoreChoose")
    .addToUi();
}

/* ---------- 自動備份 ---------- */
// setup 會確保有「每日自動備份」排程，並即時備份一次。
function ensureAutoBackup(){
  try{
    var has=ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction()==="backup"; });
    if(!has){ ScriptApp.newTrigger("backup").timeBased().everyDays(1).atHour(23).create(); }
  }catch(e){}
}

// 備份：把所有班別格仔（正式 + 補堂行）+ 補堂索引，append 入「備份」分頁（只加不刪，再自動精簡）
function backup(){
  var ss=SS();
  var bk=ss.getSheetByName("備份")||ss.insertSheet("備份");
  if(bk.getLastRow()<1) bk.appendRow(["備份時間","類型","班別","學生","日期","狀態","補去班"]);
  bk.getRange("A:A").setNumberFormat("@"); bk.getRange("E:E").setNumberFormat("@"); // 時間/日期鎖文字，防止顯示成 Date
  normalizeBackupStamps_(bk);                                                       // 修正舊資料嘅時間/日期顯示
  var stamp=Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var rows=[];
  Object.keys(ROSTER).forEach(function(sp){ Object.keys(ROSTER[sp]).forEach(function(wd){
    var full=readFull(sp,wd), key=sp+"|"+wd;
    full.students.forEach(function(nm){ (full.reg[nm]||[]).forEach(function(stt,i){
      if(stt) rows.push([stamp,"格",key,nm,full.dates[i],stt,""]); }); });
    full.mk.forEach(function(x){ x.statuses.forEach(function(stt,i){
      if(stt) rows.push([stamp,"格",key,x.name,full.dates[i],stt,""]); }); });
  });});
  makeupAll().forEach(function(m){ rows.push([stamp,"補",m.from,m.name,toIso_(m.date),m.status||"",m.to]); });
  if(rows.length) bk.getRange(bk.getLastRow()+1,1,rows.length,7).setValues(rows);
  pruneBackups_(bk,30);                                                             // 自動保留最近 30 個 + 最完整嗰個
  Logger.log("備份完成："+rows.length+" 筆 @ "+stamp);
  return rows.length;
}
// 把備份時間(A)同日期(E)欄一次過修成乾淨文字（修正被 Sheets 轉成 Date 嘅舊資料）
function normalizeBackupStamps_(bk){
  if(bk.getLastRow()<2) return;
  var n=bk.getLastRow()-1;
  var a=bk.getRange(2,1,n,1).getValues(), e=bk.getRange(2,5,n,1).getValues(), tz=SS().getSpreadsheetTimeZone();
  bk.getRange(2,1,n,1).setValues(a.map(function(r){ return [ r[0] instanceof Date ? Utilities.formatDate(r[0],tz,"yyyy-MM-dd HH:mm:ss") : String(r[0]||"") ]; }));
  bk.getRange(2,5,n,1).setValues(e.map(function(r){ return [ toIso_(r[0]) ]; }));
}
// 自動精簡：保留最近 keepN 個快照 + 行數最多（最完整）嗰個，其餘刪走
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

// 把「備份」按時間戳分組
function snapshots_(){
  var bk=SS().getSheetByName("備份"); if(!bk||bk.getLastRow()<2) return {};
  var v=bk.getRange(2,1,bk.getLastRow()-1,7).getValues(), map={};
  v.forEach(function(r){ var t=String(r[0]); if(!t) return;
    if(!map[t]) map[t]={t:t,total:0,mk:0,rows:[]};
    map[t].rows.push(r); map[t].total++; if(r[1]==="補") map[t].mk++; });
  return map;
}
// 套用一個快照（重建補堂索引 + 覆寫所有格仔）
function applySnapshot_(rows){
  var ss=SS();
  var M=ss.getSheetByName("補堂");
  if(M && M.getLastRow()>1) M.getRange(2,1,M.getLastRow()-1,5).clearContent();
  var mkr=[], seen={};
  rows.forEach(function(r){ if(r[1]!=="補") return;
    var key=r[3]+"|"+r[2]+"|"+r[6]+"|"+toIso_(r[4]); if(seen[key]) return; seen[key]=1;  // 去重（防同秒備份合併造成重複）
    mkr.push([r[3],r[2],r[6],toIso_(r[4]),r[5]]); });
  if(mkr.length && M){ M.getRange(2,4,mkr.length,1).setNumberFormat("@"); M.getRange(2,1,mkr.length,5).setValues(mkr); }
  rows.forEach(function(r){ if(r[1]==="格"){ var pr=classKeyParts(r[2]); markCell(pr.sport,pr.wd,r[3],toIso_(r[4]),r[5],true); } });
}
// 還原：揀「最完整」（行數最多）嗰個快照，避免揀到清空後嘅空白快照
function restoreLatest(){
  var map=snapshots_(), keys=Object.keys(map);
  if(!keys.length){ try{SpreadsheetApp.getUi().alert("未有備份");}catch(e){} return 0; }
  var best=keys[0]; keys.forEach(function(t){ if(map[t].total>map[best].total) best=t; });
  applySnapshot_(map[best].rows);
  try{ SpreadsheetApp.getUi().alert("已還原最完整備份：\n"+best+"\n共 "+map[best].total+" 筆（補堂 "+map[best].mk+" 筆）"); }catch(e){}
  Logger.log("已還原："+best);
  return map[best].total;
}
// 列出所有備份時間 + 內容
function listBackups(){
  var map=snapshots_(), keys=Object.keys(map).sort();
  var msg=keys.length? keys.map(function(t){ return t+"　｜ 共"+map[t].total+"筆，補堂"+map[t].mk+"筆"; }).join("\n") : "未有備份";
  SpreadsheetApp.getUi().alert("備份清單（最新喺最底）\n\n"+msg+"\n\n用「還原（自選時間）」貼返時間就可以還原指定版本。");
}
// 還原指定時間
function restoreChoose(){
  var ui=SpreadsheetApp.getUi();
  var res=ui.prompt("還原指定備份","貼返備份時間（例如 2026-06-09 22:00:01，可先用「備份清單」查看）：",ui.ButtonSet.OK_CANCEL);
  if(res.getSelectedButton()!==ui.Button.OK) return;
  var t=res.getResponseText().trim(), map=snapshots_();
  if(!map[t]){ ui.alert("搵唔到「"+t+"」嘅備份。請用「備份清單」對返完整時間（連秒）。"); return; }
  applySnapshot_(map[t].rows);
  ui.alert("已還原至 "+t+"\n共 "+map[t].total+" 筆（補堂 "+map[t].mk+" 筆）");
}