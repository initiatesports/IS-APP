/*************************************************************
 *  INITIATE SPORTS 報名系統 — Google Apps Script 後端 (v2)
 *  --------------------------------------------------------
 *  更新重點:
 *   ・私隱:公開資料只回傳每堂「人數」,唔含姓名電話
 *   ・管理名單 / 睇截圖需要密碼(在後端驗證,非前端)
 *   ・家長只可憑自己電話查自己嘅報名
 *   ・防重複報名(同電話+同學生+同一堂)
 *   ・刪走正取後自動把第一位候補補上
 *
 *  安裝 / 重新部署:
 *   1. 把呢個檔案全部內容貼入 Apps Script(覆蓋舊嘅)
 *   2. 改下面 ADMIN_PIN 做你自己嘅密碼
 *   3. 撳「執行」跑一次 setup() 授權(如已授權過可略)
 *   4. 部署 → 管理部署作業 → 撳鉛筆 ✎ → 版本選「新版本」→ 部署
 *      (用返同一個網址,前端唔使改)
 *************************************************************/

// 管理密碼:存喺 Script Properties(專案設定 → 指令碼屬性,key = ADMIN_PIN),不再寫死喺 repo。
// 萬一未設定,退回每次隨機 UUID(fail-closed),確保空密碼唔會意外通過驗證。
var ADMIN_PIN    = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || Utilities.getUuid();
var SHEET_REG    = "Registrations";
var SHEET_CONFIG = "Config";
var DRIVE_FOLDER = "INITIATE SPORTS 付款截圖";
var COACH_EMAIL  = "initiatesports6331@gmail.com";
var BACKUP_FOLDER = "INITIATE SPORTS 報名備份";
var BACKUP_KEEP   = 0;                // 0 = 全部保留,永不自動刪除備份

// 報名自動關閉:到咗呢個日子(香港時間 00:00)就自動截止,除非老闆喺「教練管理」撳「重新開放」。
// 老闆可喺報名 Sheet 嘅 Config A1 JSON 加 "closeDate":"YYYY-MM-DD" 改日子;
// "forceOpen":true 即無視日子強制開放(由教練管理面板控制)。
var DEFAULT_CLOSE_DATE = "2026-07-11";

// 報名係咪已關閉:到期 且 老闆未強制重開 → 關閉。
// (專案時區已設 Asia/Hong_Kong,所以 new Date() 本身就係香港時間)
function isRegClosed_(cfg){
  cfg = cfg || readConfig();
  if (cfg.forceOpen === true) return false;            // 老闆強制重開
  var cd = cfg.closeDate || DEFAULT_CLOSE_DATE;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(cd));
  if (!m) return false;                                 // 日子格式唔啱就當開放,唔好誤封
  var close = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0);  // 當日 00:00 HKT
  return new Date().getTime() >= close.getTime();
}

/* ---------- 一次性初始化(手動跑一次以授權) ---------- */
function setup(){
  regSheet(); configSheet(); getOrCreateFolder(DRIVE_FOLDER);
  return "Setup done";
}

/* ---------- 每日自動備份 ----------
 *  ・手動跑一次 installDailyBackup() 即可設定每日備份(並授權)
 *  ・每日會把整個試算表複製一份去「INITIATE SPORTS 報名備份」資料夾
 *  ・全部備份永久保留,永不自動刪除(BACKUP_KEEP = 0)
 *  ・想即刻試:手動跑一次 dailyBackup()
 */
function installDailyBackup(){
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === "dailyBackup") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("dailyBackup").timeBased().everyDays(1).atHour(2).create();  // 每日約 02:00(以指令碼時區計)
  return "每日備份已設定(每日約 02:00)";
}
function dailyBackup(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var folder = getOrCreateFolder(BACKUP_FOLDER);
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd_HHmm");
  DriveApp.getFileById(ss.getId()).makeCopy("INITIATE備份_" + stamp, folder);
  if (BACKUP_KEEP > 0) pruneBackups(folder, BACKUP_KEEP);
}
function pruneBackups(folder, keep){
  var files = [], it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function(a, b){ return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  for (var i = keep; i < files.length; i++) files[i].setTrashed(true);
}

// 寫入/刪除前自動備份整份報名表(節流:同一 30 分鐘窗口最多一次)。
// 不依賴 installDailyBackup() trigger;沿用原政策(BACKUP_KEEP=0 → 全部保留,不自動刪)。
// 備份失敗唔阻塞報名(只記 log)。
function backupBeforeWrite_(){
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get("bk_done")) return;                          // 30 分鐘內已備份 → 跳過
    var folder = getOrCreateFolder(BACKUP_FOLDER);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd_HHmm");
    DriveApp.getFileById(ss.getId()).makeCopy("INITIATE備份_" + stamp, folder);
    cache.put("bk_done", "1", 1800);                           // 1800 秒 = 30 分鐘
    if (BACKUP_KEEP > 0) pruneBackups(folder, BACKUP_KEEP);    // 沿用設定:0 = 不刪
  } catch (e) { Logger.log("backupBeforeWrite_ 失敗(不阻塞寫入): " + e); }
}

/* ---------- HTTP 入口 ---------- */
// 登入防爆破節流（CacheService，按 bucket 計失敗次數）
function rlBlocked_(bucket, max){ return Number(CacheService.getScriptCache().get("rl_"+bucket)||0) >= max; }
function rlBump_(bucket, ttlSec){ var c=CacheService.getScriptCache(), k="rl_"+bucket; c.put(k, String(Number(c.get(k)||0)+1), ttlSec); }
function rlClear_(bucket){ CacheService.getScriptCache().remove("rl_"+bucket); }

function doGet(e){
  return json(getState());                 // 公開:只有人數 + 課堂設定
}
function doPost(e){
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch(err){ return json({ok:false, error:"bad request"}); }
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch(err){ return json({ok:false, error:"系統繁忙,請再試"}); }
  try {
    // 管理動作集中防爆破節流：連續試錯 ADMIN_PIN 達上限即擋一陣，保護付款/刪除/截圖等敏感操作
    var ADMIN_ACTIONS = ["admin","setPaid","setRefunded","deleteReg","releaseReg","saveConfig","getProof","setRegOpen"];
    if (ADMIN_ACTIONS.indexOf(body.action) >= 0) {
      if (rlBlocked_("adminpin", 10)) return json({ok:false, error:"嘗試太多次，請約 5 分鐘後再試"});
      if (String(body.pin || "") !== ADMIN_PIN) { rlBump_("adminpin", 300); return json({ok:false, error:"密碼錯誤"}); }
      rlClear_("adminpin");
    }
    // 寫入/刪除類動作:執行前先整份備份(節流),確保 deleteReg 等不可逆操作可還原。
    // (booking 雖有 dailyBackup,但要手動 installDailyBackup() 才會跑;此處自動執行,不依賴 trigger。)
    var WRITE_ACTIONS = ["register","uploadProof","setPaid","setRefunded","deleteReg","releaseReg","saveConfig","setRegOpen"];
    if (WRITE_ACTIONS.indexOf(body.action) >= 0) backupBeforeWrite_();

    switch(body.action){
      case "register":    return json(register(body));     // 公開
      case "lookup":      return json(lookup(body));        // 公開(只回傳該電話)
      case "uploadProof": return json(uploadProof(body));   // 公開(家長上傳自己)
      case "admin":       return json(adminList(body));     // 需密碼
      case "setPaid":     return json(setPaid(body));        // 需密碼
      case "setRefunded": return json(setRefunded(body));    // 需密碼
      case "deleteReg":   return json(deleteReg(body));      // 需密碼
      case "releaseReg":  return json(releaseReg(body));     // 需密碼(釋放名額,保留紀錄)
      case "saveConfig":  return json(saveConfig(body));     // 需密碼
      case "setRegOpen":  return json(setRegOpen(body));     // 需密碼(重新開放/關閉報名)
      case "getProof":    return json(getProof(body));       // 需密碼
      default:            return json({ok:false, error:"unknown action"});
    }
  } catch(err){
    reportError_("#1 doPost "+(body&&body.action||""), err);
    return json({ok:false, error:"系統錯誤，請稍後再試"});
  } finally {
    lock.releaseLock();
  }
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
    MailApp.sendEmail(COACH_EMAIL,
      "🛑 INITIATE 系統錯誤（"+where+"）",
      "報名系統後端發生錯誤，已自動記錄：\n\n位置："+where+"\n\n"+String((err&&err.stack)||err)+
      "\n\n時間："+Utilities.formatDate(new Date(), "Asia/Hong_Kong", "yyyy-MM-dd HH:mm:ss")+
      "\n\n（同類錯誤 15 分鐘內只會通知一次）");
  }catch(e){ Logger.log("reportError_ 失敗："+e); }
}

/* ---------- 公開狀態:只回傳人數,唔含個人資料 ---------- */
function getState(){
  var data = regSheet().getDataRange().getValues();
  var counts = {};
  for (var i = 1; i < data.length; i++){
    var cid = data[i][2], stt = data[i][9];
    if (!cid) continue;
    if (!counts[cid]) counts[cid] = {confirmed: 0, waitlist: 0};
    if (stt === "confirmed") counts[cid].confirmed++;
    else if (stt === "waitlist") counts[cid].waitlist++;
  }
  var cfg = readConfig();
  return {ok: true, counts: counts, extra: cfg.extra, overrides: cfg.overrides,
          closed: isRegClosed_(cfg), closeDate: cfg.closeDate, forceOpen: cfg.forceOpen};
}

/* ---------- 家長查自己報名(只回傳該電話) ---------- */
function lookup(body){
  var phone = String(body.phone || "");
  if (!/^\d{8}$/.test(phone)) return {ok: true, regs: []};
  var data = regSheet().getDataRange().getValues(), regs = [];
  for (var i = 1; i < data.length; i++){
    if (String(data[i][8]) === phone) regs.push(rowToReg(data[i]));
  }
  return {ok: true, regs: regs};
}

/* ---------- 教練攞完整名單(需密碼) ---------- */
function adminList(body){
  if (String(body.pin || "") !== ADMIN_PIN) return {ok: false, error: "密碼錯誤"};
  var data = regSheet().getDataRange().getValues(), regs = [];
  for (var i = 1; i < data.length; i++){ if (data[i][0]) regs.push(rowToReg(data[i])); }
  return {ok: true, regs: regs};
}

/* ---------- 報名:建立「未完成(pending)」紀錄,未占位;上傳截圖先正式留位 ---------- */
function register(body){
  if (isRegClosed_()) return {ok: false, closed: true, error: "報名已截止"};   // 自動關閉:伺服器端把關,前端改唔到都報唔到
  // ── 防洗版 / 防垃圾提交：欄位驗證 + 每電話節流 ──
  var phone  = String(body.phone  || "").trim();
  var parent = String(body.parent || "").trim();
  var student= String(body.student|| "").trim();
  if (!/^\d{8}$/.test(phone))                 return {ok:false, error:"電話號碼格式不正確（需 8 位數字）"};
  if (parent.length  < 1 || parent.length  > 40) return {ok:false, error:"請填寫家長姓名"};
  if (student.length < 1 || student.length > 40) return {ok:false, error:"請填寫學生姓名"};
  var classes = body.classes || [];
  if (!Array.isArray(classes) || classes.length < 1) return {ok:false, error:"請至少選擇一個班別"};
  if (classes.length > 20)                    return {ok:false, error:"一次選擇的班別過多"};
  // 每電話節流：1 小時內最多 10 次報名提交，擋連環洗版（dedup 之外再加一層）
  if (rlBlocked_("reg_"+phone, 10)) return {ok:false, error:"提交太頻繁，請稍後再試或 WhatsApp 我們"};
  rlBump_("reg_"+phone, 3600);
  body.phone = phone; body.parent = parent; body.student = student;
  var sh = regSheet(), data = sh.getDataRange().getValues();
  var now = new Date(), results = [];

  function dupStatus(cid){
    for (var i = 1; i < data.length; i++){
      if (data[i][2] === cid && String(data[i][8]) === String(body.phone) && String(data[i][7]) === String(body.student) && data[i][9] !== "released") return data[i][9];
    }
    return null;
  }

  classes.forEach(function(c){
    var dup = dupStatus(c.id);
    if (dup){ results.push({classId: c.id, status: dup, dup: true}); return; }
    var id = "r" + now.getTime().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    var row = [id, now, c.id, c.name, c.date, c.time, body.parent, body.student, body.phone, "pending", false, "", "", false];
    sh.appendRow(row); data.push(row);
    results.push({classId: c.id, status: "pending"});
  });
  return {ok: true, results: results};
}

/* ---------- 標記已付款(需密碼) ---------- */
function setPaid(body){
  if (String(body.pin || "") !== ADMIN_PIN) return {ok: false, error: "未授權"};
  var sh = regSheet(), data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++){
    if (data[i][0] === body.id){ sh.getRange(i + 1, 11).setValue(!!body.paid); return {ok: true}; }
  }
  return {ok: false, error: "找不到記錄"};
}

/* ---------- 刪除報名 + 候補自動補位(需密碼) ---------- */
function deleteReg(body){
  if (String(body.pin || "") !== ADMIN_PIN) return {ok: false, error: "未授權"};
  var sh = regSheet(), data = sh.getDataRange().getValues();
  var rowIdx = -1, cid = null, wasConfirmed = false;
  for (var i = 1; i < data.length; i++){
    if (data[i][0] === body.id){ rowIdx = i + 1; cid = data[i][2]; wasConfirmed = (data[i][9] === "confirmed"); break; }
  }
  if (rowIdx < 0) return {ok: false, error: "找不到記錄"};
  sh.deleteRow(rowIdx);

  var promoted = null;
  if (wasConfirmed && cid){
    var cap = Number(body.capacity) || 0;
    data = sh.getDataRange().getValues();
    var conf = 0, waitRows = [];
    for (var j = 1; j < data.length; j++){
      if (data[j][2] === cid){
        if (data[j][9] === "confirmed") conf++;
        else if (data[j][9] === "waitlist") waitRows.push({rowNum: j + 1, ts: (data[j][1] instanceof Date) ? data[j][1].getTime() : 0, name: data[j][7], phone: data[j][8], cname: data[j][3], date: data[j][4]});
      }
    }
    waitRows.sort(function(a, b){ return a.ts - b.ts; });
    while (conf < cap && waitRows.length){
      var w = waitRows.shift();
      sh.getRange(w.rowNum, 10).setValue("confirmed");
      conf++; promoted = w;
    }
    if (promoted) notifyPromotion(promoted);
  }
  return {ok: true, promoted: promoted ? {student: promoted.name, phone: String(promoted.phone)} : null};
}

/* ---------- 標記已退款(需密碼) ---------- */
function setRefunded(body){
  if (String(body.pin || "") !== ADMIN_PIN) return {ok: false, error: "未授權"};
  var sh = regSheet(), data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++){
    if (data[i][0] === body.id){ sh.getRange(i + 1, 14).setValue(!!body.refunded); return {ok: true}; }
  }
  return {ok: false, error: "找不到記錄"};
}

/* ---------- 釋放名額:保留紀錄(狀態改 released)+ 候補自動補位(需密碼) ---------- */
function releaseReg(body){
  if (String(body.pin || "") !== ADMIN_PIN) return {ok: false, error: "未授權"};
  var sh = regSheet(), data = sh.getDataRange().getValues();
  var rowIdx = -1, cid = null, wasConfirmed = false;
  for (var i = 1; i < data.length; i++){
    if (data[i][0] === body.id){ rowIdx = i + 1; cid = data[i][2]; wasConfirmed = (data[i][9] === "confirmed"); break; }
  }
  if (rowIdx < 0) return {ok: false, error: "找不到記錄"};
  sh.getRange(rowIdx, 10).setValue("released");      // 保留該行,只改狀態

  var promoted = null;
  if (wasConfirmed && cid){
    var cap = Number(body.capacity) || 0;
    data = sh.getDataRange().getValues();
    var conf = 0, waitRows = [];
    for (var j = 1; j < data.length; j++){
      if (data[j][2] === cid){
        if (data[j][9] === "confirmed") conf++;
        else if (data[j][9] === "waitlist") waitRows.push({rowNum: j + 1, ts: (data[j][1] instanceof Date) ? data[j][1].getTime() : 0, name: data[j][7], phone: data[j][8], cname: data[j][3], date: data[j][4]});
      }
    }
    waitRows.sort(function(a, b){ return a.ts - b.ts; });
    while (conf < cap && waitRows.length){
      var w = waitRows.shift();
      sh.getRange(w.rowNum, 10).setValue("confirmed");
      conf++; promoted = w;
    }
    if (promoted) notifyPromotion(promoted);
  }
  return {ok: true, promoted: promoted ? {student: promoted.name, phone: String(promoted.phone)} : null};
}

/* ---------- 儲存額外課堂 / 改價錢人數(需密碼) ---------- */
function saveConfig(body){
  if (String(body.pin || "") !== ADMIN_PIN) return {ok: false, error: "未授權"};
  var cur = readConfig();   // 保留 forceOpen / closeDate,唔好被覆蓋
  configSheet().getRange("A1").setValue(JSON.stringify({
    extra: body.extra || [], overrides: body.overrides || {},
    forceOpen: cur.forceOpen === true, closeDate: cur.closeDate || DEFAULT_CLOSE_DATE
  }));
  return {ok: true};
}

/* ---------- 重新開放 / 再次關閉報名(需密碼,由「教練管理」面板控制) ---------- */
function setRegOpen(body){
  if (String(body.pin || "") !== ADMIN_PIN) return {ok: false, error: "未授權"};
  var cur = readConfig();
  var obj = {
    extra: cur.extra || [], overrides: cur.overrides || {},
    forceOpen: (body.open === true), closeDate: cur.closeDate || DEFAULT_CLOSE_DATE
  };
  configSheet().getRange("A1").setValue(JSON.stringify(obj));
  return {ok: true, closed: isRegClosed_(obj), forceOpen: obj.forceOpen};
}

/* ---------- 上傳付款截圖:正式留位(pending → confirmed/waitlist) ---------- */
function uploadProof(body){
  var sh = regSheet(), data = sh.getDataRange().getValues();
  var rowIndex = -1, row = null;
  for (var i = 1; i < data.length; i++){ if (data[i][0] === body.id){ rowIndex = i + 1; row = data[i]; break; } }
  if (rowIndex < 0) return {ok: false, error: "找不到報名記錄"};

  var b64   = String(body.dataUrl || "").replace(/^data:[^,]+,/, "");
  var bytes = Utilities.base64Decode(b64);
  var fname = sanitize(row[4]) + "_" + sanitize(row[7]) + "_" + body.id + ".jpg";   // 日期_學生_id
  var blob  = Utilities.newBlob(bytes, "image/jpeg", fname);
  var file  = getOrCreateFolder(DRIVE_FOLDER).createFile(blob);

  sh.getRange(rowIndex, 12).setValue(file.getUrl());
  sh.getRange(rowIndex, 13).setValue(file.getId());

  // 上傳截圖先正式留位:若該筆仍是 pending,按現有名額判斷 confirmed / waitlist
  var status = row[9];
  if (status === "pending"){
    var cid = row[2], cap = Number(body.capacity) || 0, conf = 0;
    for (var j = 1; j < data.length; j++){ if (data[j][2] === cid && data[j][9] === "confirmed") conf++; }
    status = (conf < cap) ? "confirmed" : "waitlist";
    sh.getRange(rowIndex, 10).setValue(status);
  }

  notifyProof(row, file, status);
  return {ok: true, status: status};
}

/* ---------- 回傳截圖畀後台(需密碼) ---------- */
function getProof(body){
  if (String(body.pin || "") !== ADMIN_PIN) return {ok: false, error: "未授權"};
  var data = regSheet().getDataRange().getValues();
  for (var i = 1; i < data.length; i++){
    if (data[i][0] === body.id){
      var fid = data[i][12];
      if (!fid) return {ok: false};
      var blob = DriveApp.getFileById(fid).getBlob();
      return {ok: true, dataUrl: "data:" + blob.getContentType() + ";base64," + Utilities.base64Encode(blob.getBytes())};
    }
  }
  return {ok: false};
}

/* ---------- Email 通知 ---------- */
function notifyNewRegistration(body, results, classes){
  try {
    var lines = results.filter(function(r){ return !r.dup; }).map(function(r){
      var c = findClass(classes, r.classId);
      var label = c ? (c.date + " " + c.name + " (" + c.time + ")") : r.classId;
      return "• " + label + " — " + (r.status === "confirmed" ? "已留位" : "候補");
    });
    if (!lines.length) return;
    var msg = "有新報名:\n\n學生:" + body.student + "\n家長:" + body.parent +
              "\n電話:" + body.phone + "\n\n班別:\n" + lines.join("\n") +
              "\n\n(報名系統自動通知。家長付款後會再上傳截圖。)";
    MailApp.sendEmail(COACH_EMAIL, "INITIATE SPORTS 新報名 - " + body.student, msg);
  } catch(e){}
}
function notifyProof(row, file, status){
  try {
    var stTxt = (status === "waitlist") ? "已滿,列入候補(如無位需退款)" : "已成功留位";
    var msg = "學生 " + row[7] + " 已付款並上傳截圖(" + stTxt + ")。\n\n" +
              "班別:" + row[3] + " " + row[4] + " " + row[5] +
              "\n電話:" + row[8] +
              "\n截圖:" + file.getUrl() +
              "\n\n請喺報名系統後台核對並標記已付款。";
    MailApp.sendEmail(COACH_EMAIL, "INITIATE SPORTS 留位+付款 - " + row[7], msg);
  } catch(e){}
}
function notifyPromotion(w){
  try {
    var msg = "有候補學生自動補上正取:\n\n學生:" + w.name + "\n電話:" + w.phone +
              "\n班別:" + (w.cname || "") + " " + (w.date || "") +
              "\n\n請通知家長並安排付款。";
    MailApp.sendEmail(COACH_EMAIL, "INITIATE SPORTS 候補補位 - " + w.name, msg);
  } catch(e){}
}

/* ---------- 工具 ---------- */
function json(obj){ return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function rowToReg(r){
  var ts = (r[1] instanceof Date) ? r[1].getTime() : (Date.parse(r[1]) || 0);
  return {
    id: String(r[0]), classId: String(r[2]),
    parent: String(r[6]), student: String(r[7]), phone: String(r[8]),
    status: String(r[9]),
    paid: (r[10] === true || r[10] === "TRUE" || r[10] === "true"),
    proof: !!r[12], ts: ts,
    refunded: (r[13] === true || r[13] === "TRUE" || r[13] === "true")
  };
}
function readConfig(){
  var cfg = {extra: [], overrides: {}, forceOpen: false, closeDate: DEFAULT_CLOSE_DATE};
  try { var raw = configSheet().getRange("A1").getValue(); if (raw){ var p = JSON.parse(raw);
    cfg.extra = p.extra || []; cfg.overrides = p.overrides || {};
    cfg.forceOpen = (p.forceOpen === true);
    if (p.closeDate) cfg.closeDate = p.closeDate;
  } } catch(e){}
  return cfg;
}
function regSheet(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_REG);
  if (!sh){
    sh = ss.insertSheet(SHEET_REG);
    sh.appendRow(["id","時間","classId","班別","日期","時間","家長","學生","電話","狀態","已付款","截圖連結","proofId","已退款"]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function configSheet(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_CONFIG);
  if (!sh){ sh = ss.insertSheet(SHEET_CONFIG); sh.getRange("A1").setValue('{"extra":[],"overrides":{}}'); }
  return sh;
}
function getOrCreateFolder(name){ var it = DriveApp.getFoldersByName(name); return it.hasNext() ? it.next() : DriveApp.createFolder(name); }
function findClass(classes, id){ for (var i = 0; i < classes.length; i++) if (classes[i].id === id) return classes[i]; return null; }
function sanitize(s){ return String(s || "").replace(/[\/\\?%*:|"<>]/g, "-").replace(/\s+/g, "_").slice(0, 40); }