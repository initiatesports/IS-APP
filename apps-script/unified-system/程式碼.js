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
  COACH_PASS:  "IS2026",                        // 教練版密碼
  WHATSAPP:    "85263317403",                   // 家長確認 WhatsApp
  TERM_START:  "2026-02-23",   // 學期窗（週一）；涵蓋現有 3 月資料
  TERM_END:    "2026-08-29",   // 學期窗結束（含暑期）
  MAKEUP_MONTHS: 2,            // 補堂限期 = 缺席日 + N 個月（B 規則）
  REMIND_HOUR: 20,            // 每晚幾點檢查「未完成點名」
  FEE_1: 1040,                // 每週 1 節 / 期（$130×8）
  FEE_2: 1760,                // 每週 2 節 / 期（$110×16）
  PAY_NUMBER: "6709 3390",   // FPS / PayMe 收款電話
};
const VERSION = "is-unified-v2";

/* ═══════════ 真實班別資料（你 App 真實學生）═══════════ */
/* cN: { dayZh, wd(1=一..6=六), time, students[] }
 * 已併入：顧舒然(c5)、潘洛詩(c7)（出席記錄已有，補回名單）。
 */
const CLASSES = {
  c1:{ dayZh:"星期一", wd:1, time:"5–6pm",  students:["余悅","孔善盈","何芯蕾","蔡芷彤","羅梓晉","羅君信","羅君浩","陳大文"] },
  c2:{ dayZh:"星期一", wd:1, time:"6–7pm",  students:["翟悅廷","郭栩澄","陳柏睎","葉宇浩","梁德瑜","梁德澤","許思溢"] },
  c3:{ dayZh:"星期三", wd:3, time:"5–6pm",  students:["鄧可澄","鄧幗恩","胡苡晨","胡汐森","文柏升","陳曉瑩","何梓程","梁正軒","陳思允"] },
  c4:{ dayZh:"星期三", wd:3, time:"6–7pm",  students:["陳卓楠","曾愛斯","王一言","王一心","古詩詠","古卓謙","梁心朗","陳信澄","陳澔泓","梁正宇","蘇穎悠"] },
  c5:{ dayZh:"星期五", wd:5, time:"6–7pm",  students:["吳瑋軒","黎柏言","陳曉瑩","梁正宇","郭可昕","黃玥晴","黃朗程","姚心穎","羅靖誼","黎柏希","陳焯棋","顧舒然"] },
  c6:{ dayZh:"星期六", wd:6, time:"11am–12", students:["張爾淳","張雅堯","黃梓昕","王尉鏇","王斯顏","呂洛希","馬仲然","鄧朗森","陳書雅"] },
  c7:{ dayZh:"星期六", wd:6, time:"3–4pm",  students:["劉家頤","鄭宇喬","鍾皓惟","周莉晶","李灝宏","潘洛詩"] },
};
const CLASS_IDS = Object.keys(CLASSES);

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
function holidaysSet(){
  var m=settingsMap(), h=m["public_holidays"];
  var arr=(Array.isArray(h)&&h.length)?h:DEFAULT_HOLIDAYS;
  var s={}; arr.forEach(function(d){ s[toIso_(d)]=1; }); return s;
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
  try{ feeSheet(); pinSheet(); addonSheet(); referralSheet(); noticeSheet(); transferSheet(); }catch(e){}   // 建立各分頁
  try{ genPeriod_(curPeriodLabel_()); genPeriod_(nextPeriodLabel_()); }catch(e){}   // 自動產生本期與下期繳費列
  try{ seedDemo_(); }catch(e){}
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
    applyCF(sh,bk);
    return;
  }
  sh = sh || ss.insertSheet(nm);
  sh.clear(); sh.setConditionalFormatRules([]);
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
  var sh=SS().getSheetByName(gridName(cid)), c=CLASSES[cid];
  var dates=sessionsFor(cid), n=dates.length, students=c.students, map={};
  if(sh && students.length){
    var vals=sh.getRange(DATA_START,NAME_COL,students.length,1+n).getValues();
    for(var i=0;i<students.length;i++) map[String(vals[i][0])]=vals[i].slice(1).map(function(x){return String(x||"");});
  }
  return {dates:dates,n:n,students:students,status:map};
}
function gridMeta(cid){
  var students=CLASSES[cid].students, dates=sessionsFor(cid);
  return {sh:SS().getSheetByName(gridName(cid)), dates:dates, n:dates.length,
    students:students, R:students.length, mkStart:DATA_START+students.length};
}
function dateCol(m,dateIso){ var i=m.dates.indexOf(dateIso); return i<0?-1:DATE_COL0+i; }
function findRow(m,name,create){
  var ri=m.students.indexOf(name); if(ri>=0) return DATA_START+ri;
  var names=m.sh.getRange(m.mkStart,NAME_COL,MK_MAX,1).getValues(), empty=-1;
  for(var j=0;j<MK_MAX;j++){ var v=String(names[j][0]||"");
    if(v===name) return m.mkStart+j; if(empty<0&&!v) empty=m.mkStart+j; }
  if(create && empty>=0){
    var r=empty, c0=colLetter(DATE_COL0), cN=colLetter(DATE_COL0+Math.max(m.n-1,0));
    m.sh.getRange(r,SEQ_COL).setValue("補"); m.sh.getRange(r,NAME_COL).setValue(name);
    m.sh.getRange(r,DATE_COL0+m.n).setValue('=COUNTIF('+c0+r+':'+cN+r+',"出席")+COUNTIF('+c0+r+':'+cN+r+',"補堂")');
    m.sh.getRange(r,DATE_COL0+m.n+1).setValue('=COUNTIF('+c0+r+':'+cN+r+',"請假")');
    m.sh.getRange(r,DATE_COL0+m.n+2).setValue('=COUNTIF('+c0+r+':'+cN+r+',"缺席")');
    return r;
  }
  return -1;
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
  if(m.R){
    var rv=m.sh.getRange(DATA_START,NAME_COL,m.R,1+m.n).getValues();
    for(var i=0;i<m.R;i++) reg[String(rv[i][0])]=rv[i].slice(1).map(function(x){return String(x||"");});
  }
  var mv=m.sh.getRange(m.mkStart,NAME_COL,MK_MAX,1+m.n).getValues();
  for(var j=0;j<MK_MAX;j++){ var nm=String(mv[j][0]||""); if(nm) mk.push({name:nm,statuses:mv[j].slice(1).map(function(x){return String(x||"");})}); }
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
  var sh=SS().getSheetByName("Roster");
  if(!sh || sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,5).getValues()
    .map(function(r){ return {name:String(r[0]).trim(), last4:String(r[1]), cid:String(r[2]), dayZh:String(r[3]), time:String(r[4])}; })
    .filter(function(r){ return r.name; });
}
function makeupSheet(){ return SS().getSheetByName("補堂"); }
function makeupAll(){
  var sh=makeupSheet(); if(!sh||sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,5).getValues().map(function(r,i){
    return {row:i+2, name:String(r[0]), from:String(r[1]), to:String(r[2]), date:toIso_(r[3]), status:String(r[4]||"")};
  });
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
  if(p.action){ var out; try{ out=route(p); }catch(err){ out={ok:false,err:String(err)}; }
    return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON); }
  return ContentService.createTextOutput("INITIATE SPORTS API "+VERSION+" OK");
}
function doPost(e){
  var p={}; try{ p=JSON.parse(e.postData.contents); }catch(err){}
  var out; try{ out=route(p); }catch(err){ out={ok:false,err:String(err)}; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
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
    case "uploadMedNote":   return apiUploadMedNote(p);
    // ── 繳費（Phase 1）──
    case "genPeriod":       return apiGenPeriod(p);
    case "payUpload":       return apiPayUpload(p);
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
    // ── B 相容 ──
    case "load":            return apiLoad(p);
    case "save_attendance": return apiSaveAttendance(p);
    case "save_absences":   return apiSaveAbsences(p);
    case "save_settings":   return apiSaveSettings(p);
    default:                return {ok:false, err:"unknown action"};
  }
}

/* ═══════════ 家長：一個小朋友全部班別資料 ═══════════ */
function classesFor_(nm){
  var rows=rosterRows().filter(function(r){ return r.name===nm; });
  var mk=makeupAll().filter(function(m){ return m.name===nm; });
  return rows.map(function(r){
    var cid=r.cid, blk=readBlock(cid), st=blk.status[nm]||[];
    var att=0,lv=0,ab=0;
    st.forEach(function(s){ if(s==="出席"||s==="補堂")att++; else if(s==="請假")lv++; else if(s==="缺席")ab++; });
    var myMk=mk.filter(function(m){ return m.from===cid; });
    var mkInfo=myMk.map(function(m){
      var onGrid = CLASSES[m.to] && sessionsFor(m.to).indexOf(m.date)>=0;
      var stt = onGrid ? (makeupStatus(m.to,nm,m.date)||"補堂") : (m.status||"補堂");
      return {to:m.to, date:m.date, status:stt};
    });
    var mkAtt=mkInfo.filter(function(x){ return x.status==="出席"; }).length;
    var sessions=blk.dates.map(function(d,i){ return {date:d, status:st[i]||""}; });
    var deadline=blk.dates.length? blk.dates[blk.dates.length-1] : "";
    return {key:cid, sport:cid, wd:r.dayZh, dayZh:r.dayZh, time:r.time,
      total:blk.dates.length, attended:att+mkAtt, leave:lv, absent:ab,
      owed:Math.max(0, lv-myMk.length), sessions:sessions, makeups:mkInfo, deadline:deadline};
  });
}
function apiLogin(p){
  var want=pad4(p.last4), nm=String(p.name).trim();
  var all=rosterRows();
  // 配對：輸入碼須等於該家庭「有效憑證」（有自訂密碼用密碼，否則用電話後4位）
  var hit=all.filter(function(r){ return r.name===nm && r.last4!==""; })
            .filter(function(r){ return effectiveCred_(pad4(r.last4))===want; });
  if(!hit.length) return {ok:false, err:"搵唔到，請檢查中文全名同登入密碼（首次登入用手機後4位；如已設定自訂密碼請用自訂密碼）"};
  var fam=pad4(hit[0].last4);   // 內部家庭鍵＝名冊電話後4位（不變）
  var names=[]; all.forEach(function(r){ if(r.last4!=="" && pad4(r.last4)===fam && names.indexOf(r.name)<0) names.push(r.name); });
  var children=names.map(function(cn){ return {name:cn, classes:classesFor_(cn), fees:feesFor_(cn), addons:addonsFor_(cn), referralBalance:referralBalance_(cn), transfers:transfersFor_(cn)}; });
  return {ok:true, family:{last4:fam, hasPin:!!pinFor_(fam)}, children:children,
    student:{name:nm,last4:fam}, classes:children.length?children[0].classes:[],
    payNumber:CONFIG.PAY_NUMBER, notices:noticesRecent_(6)};
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
  logAppend({name:p.name,key:cid,action:"cancelLeave",date:p.date,status:"取消請假(原:"+cur+")"});
  notify("【取消請假】"+p.name, p.name+"\n班別："+classLabel_(cid)+"\n日期："+p.date+"\n已還原為正常出席（未上）。");
  return {ok:true};
}

/* ═══════════ 補堂 / 取消補堂 ═══════════ */
function apiMakeup(p){
  var toCid=p.toKey, date=toIso_(p.toDate);
  if(!CLASSES[toCid]) return {ok:false,err:"目標班別不存在"};
  if(!authParent_(p.name,p.code)) return {ok:false,err:"登入碼不正確，無法操作"};
  var perM=periodLabelFromIso_(date);
  if(!periodPaid_(p.name,perM)) return {ok:false, locked:true, err:"請先繳付 "+perM+" 學費，方可預約補堂"};
  var dup=makeupAll().some(function(m){ return m.name===p.name && m.from===p.fromKey && m.to===p.toKey && m.date===date; });
  if(dup) return {ok:true, dup:true};
  // 限期檢查：今次補堂對應「最舊未補嘅缺席」，須喺該缺席日 +N 個月內（#9）
  if(CLASSES[p.fromKey]){
    var fb=readBlock(p.fromKey), fst=fb.status[p.name]||[], fd=fb.dates, lv=[];
    fst.forEach(function(s,i){ if(s==="請假") lv.push(fd[i]); });
    lv.sort();
    var madeUp=makeupAll().filter(function(m){ return m.name===p.name && m.from===p.fromKey; }).length;
    if(madeUp>=lv.length) return {ok:false,err:"此班暫無待補堂節數"};
    var absDate=lv[madeUp], dl=addMonthsIso(absDate, CONFIG.MAKEUP_MONTHS);
    if(date>dl) return {ok:false,err:"已超過補堂限期：缺席日 "+absDate+" 起 "+CONFIG.MAKEUP_MONTHS+" 個月內補堂，須於 "+dl+" 或之前"};
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
  if(onGrid) markCell(toCid,p.name,date,"",false);
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
    return {period:x.period, weekly:x.weekly, due:x.due, discount:x.discount, adj:x.adj, adjNote:x.adjNote,
      net:x.net, paid:x.paid, status:x.status, hasScreenshot:!!x.link,
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
/* 內部：為所有在學學生產生某期應繳列（已存在則跳過）；供 setup 與 API 共用 */
function genPeriod_(label){
  label=String(label).trim();
  var existing={}; feeRows_().forEach(function(x){ if(x.period===label) existing[x.name]=1; });
  var names=[]; rosterRows().forEach(function(r){ if(r.name && names.indexOf(r.name)<0) names.push(r.name); });
  var sh=feeSheet(), added=0;
  names.forEach(function(nm){
    if(existing[nm]) return;
    var wk=weeklySessions_(nm)||1, due=feeAmount_(wk);
    var disc=referralAutoDisc_(nm, due, 0);   // 自動套用推薦優惠（上限 50%）
    var row=sh.getLastRow()+1;
    sh.getRange(row,2).setNumberFormat("@");
    sh.getRange(row,1,1,14).setValues([[nm,label,wk,due,disc,due-disc,0,"未繳","","","","",0,""]]);
    added++;
  });
  return {ok:true, period:label, added:added};
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
function apiPayUpload(p){
  if(!authParent_(p.name,p.code)) return {ok:false,err:"登入碼不正確，無法操作"};
  try{
    var nm=String(p.name).trim(), label=String(p.period).trim();
    var rows=feeRows_(), hit=null;
    for(var i=0;i<rows.length;i++){ if(rows[i].name===nm && rows[i].period===label){ hit=rows[i]; break; } }
    if(!hit) return {ok:false,err:"搵唔到該期繳費紀錄，請聯絡張 Sir"};
    var dataUrl=String(p.dataUrl||""); var comma=dataUrl.indexOf(",");
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
  }catch(e){ return {ok:false, err:"上載失敗："+(e&&e.message||e)}; }
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
function genCurrentPeriodFees(){ var r=apiGenPeriod({coachPass:CONFIG.COACH_PASS}); SpreadsheetApp.getUi().alert("已產生 "+r.period+" 繳費列，新增 "+r.added+" 位學生。"); }

/* ═══════════ 家長操作權限：須附家庭登入碼（後端驗證，防冒用）═══════════ */
function authParent_(name, code){
  var all=rosterRows();
  return all.filter(function(r){ return r.name===String(name).trim() && r.last4!==""; })
            .some(function(r){ return effectiveCred_(pad4(r.last4))===pad4(code); });
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
function apiCoachLogin(p){ return {ok: String(p.coachPass)===String(CONFIG.COACH_PASS), version:VERSION}; }

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
    full.students.forEach(function(nm){ g.rows.push({name:nm, makeup:false, status:(full.reg[nm]||[])[di]||""}); });
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

/* ═══════════════════════════════════════════════
   B 相容層：load / save_attendance / save_absences / save_settings
   ─ 出席真相來源 = 格仔；以下由格仔反推 B 前端期望嘅資料形狀
   ═══════════════════════════════════════════════ */
function apiLoad(p){
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
  var absences=[], idx=0, used={};
  absencesRaw.sort(function(a,b){ return a.absDate.localeCompare(b.absDate); });
  absencesRaw.forEach(function(a){
    var done=null, pool=mkByName[a.name];
    if(pool){ used[a.name]=used[a.name]||0; if(used[a.name]<pool.length){ done=pool[used[a.name]]; used[a.name]++; } }
    absences.push({ id:"g"+(idx++), name:a.name, classId:a.classId, absDate:a.absDate,
      deadline:addMonthsIso(a.absDate, CONFIG.MAKEUP_MONTHS), madeUpDate:done });
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
function tableRows_(sheetName, cols){
  var sh=SS().getSheetByName(sheetName); if(!sh||sh.getLastRow()<2) return [];
  var w=cols.length, v=sh.getRange(2,1,sh.getLastRow()-1,w).getValues();
  return v.filter(function(r){return String(r[0]||"").trim();}).map(function(r){
    var o={}; cols.forEach(function(c,i){ o[c]= (c==="date")?toIso_(r[i]) : r[i]; }); return o;
  });
}
function apiSaveAttendance(p){
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
function notify(subject, body){
  try{ GmailApp.sendEmail(CONFIG.COACH_EMAIL, "INITIATE SPORTS · "+subject, body); }catch(e){}
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
  var rows=[], mkAll=makeupAll();
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
  SpreadsheetApp.getUi().createMenu("INITIATE")
    .addItem("初始化 / 更新（保留資料）","setup")
    .addItem("產生出席報表","buildReport")
    .addItem("產生本期繳費列","genCurrentPeriodFees")
    .addItem("立即備份","backup")
    .addItem("備份到 Drive（整份複製）","backupToDrive")
    .addItem("備份清單","listBackups")
    .addItem("還原至最近備份（最完整）","restoreLatest")
    .addItem("還原（自選時間）","restoreChoose")
    .addToUi();
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
    full.students.forEach(function(nm){ (full.reg[nm]||[]).forEach(function(stt,i){
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
  if(M && M.getLastRow()>1) M.getRange(2,1,M.getLastRow()-1,5).clearContent();
  var mkr=[], seen={};
  rows.forEach(function(r){ if(r[1]!=="補") return;
    var key=r[3]+"|"+r[2]+"|"+r[6]+"|"+toIso_(r[4]); if(seen[key]) return; seen[key]=1;
    mkr.push([r[3],r[2],r[6],toIso_(r[4]),r[5]]); });
  if(mkr.length && M){ M.getRange(2,4,mkr.length,1).setNumberFormat("@"); M.getRange(2,1,mkr.length,5).setValues(mkr); }
  rows.forEach(function(r){ if(r[1]==="格"){ markCell(r[2], r[3], toIso_(r[4]), r[5], true); } });
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