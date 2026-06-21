// ═══════════════════════════════════════════════════════════════════
//  INITIATE SPORTS — Google Apps Script  v3.0
//  修正：照片改用獨立 key 儲存（photo_{name}），避免超出 Sheets 格子限制
//  所有資料即時雲端同步
// ═══════════════════════════════════════════════════════════════════

const SHEET_ID = '1prjceGydcVHvhidlp8SZEJ1abE0Cvz2WqwrjN6_K7qo';

// 教練密碼存喺 Script Properties(專案設定 → 指令碼屬性,key = COACH_PASS),不寫死喺 repo。
// 未設定就退回每次隨機 UUID(fail-closed),確保空密碼唔會意外通過。
function getCoachPass_() {
  return PropertiesService.getScriptProperties().getProperty('COACH_PASS') || Utilities.getUuid();
}
function checkCoach_(body) {
  return String((body && body.coachPass) || '') === String(getCoachPass_());
}

// 登入防爆破節流（CacheService，按 bucket 計失敗次數）
function rlBlocked_(bucket, max){ return Number(CacheService.getScriptCache().get('rl_'+bucket)||0) >= max; }
function rlBump_(bucket, ttlSec){ var c=CacheService.getScriptCache(), k='rl_'+bucket; c.put(k, String(Number(c.get(k)||0)+1), ttlSec); }
function rlClear_(bucket){ CacheService.getScriptCache().remove('rl_'+bucket); }
// 驗證教練密碼（含節流）：連續錯太多次先擋一陣
function verifyCoachThrottled_(body) {
  if (rlBlocked_('coachlogin', 10)) return { ok: false, error: '嘗試太多次，請約 5 分鐘後再試' };
  var ok = checkCoach_(body);
  if (ok) rlClear_('coachlogin'); else rlBump_('coachlogin', 300);
  return { ok: ok };
}

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

// 寫入前自動備份整份 IS App Data 到 Drive。節流:同一 30 分鐘窗口最多備份一次,
// 避免每次 save 都複製;保留最近 14 份。備份失敗唔阻塞寫入(只記 log)。
function backupBeforeWrite_() {
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get('bk_done')) return;                       // 30 分鐘內已備份 → 跳過
    const FOLDER = 'IS App Data 備份', KEEP = 14;
    const it = DriveApp.getFoldersByName(FOLDER);
    const folder = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER);
    const tz = SpreadsheetApp.openById(SHEET_ID).getSpreadsheetTimeZone();
    const stamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd_HHmm');
    DriveApp.getFileById(SHEET_ID).makeCopy('IS App Data 備份 ' + stamp, folder);
    cache.put('bk_done', '1', 1800);                        // 1800 秒 = 30 分鐘
    const copies = [], fit = folder.getFiles();
    while (fit.hasNext()) { const f = fit.next(); if (f.getName().indexOf('IS App Data 備份 ') === 0) copies.push(f); }
    copies.sort((a, b) => b.getDateCreated() - a.getDateCreated());
    copies.slice(KEEP).forEach(f => { try { f.setTrashed(true); } catch (e) {} });
  } catch (e) { Logger.log('backupBeforeWrite_ 失敗(不阻塞寫入): ' + e); }
}

function makeResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── GET ────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    const action = e.parameter.action;
    // 完整 load(含身高體重/醫療備註/繳費等敏感資料)只准教練：改用 POST 帶教練密碼。
    // 匿名 GET ?action=load 一律拒絕，避免任何人攞到網址就睇晒全校資料。
    if (action === 'load') return makeResponse({ error: '未授權:請用教練端登入' });
    // 家長專區只攞「可公開展示」資料(班名/相片/星之學員/排行榜/補堂提醒);不含身高體重/醫療/繳費。
    if (action === 'home') return makeResponse(loadHome());
    if (action === 'ping') return makeResponse({ ok: true, ts: new Date().toISOString() });
    return makeResponse({ error: 'Unknown action: ' + action });
  } catch(err) {
    reportError_('#11 doGet ' + ((e&&e.parameter&&e.parameter.action)||''), err);
    return makeResponse({ error: err.message });
  }
}
/* ═══════════ 統一錯誤通報：後端一出 exception 自動 email 老闆（節流防洗信）═══════════ */
function reportError_(where, err){
  try{
    var sig=String((err&&err.stack)||err).slice(0,140).replace(/\s+/g,' ');
    var c=CacheService.getScriptCache();
    var k='errmail_'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig)).slice(0,24);
    if(c.get(k)) return;                              // 同類錯誤 15 分鐘內唔重複寄
    if(Number(c.get('errmail_cap')||0)>=6) return;    // 全域每小時最多 6 封
    c.put(k,'1',900); c.put('errmail_cap', String(Number(c.get('errmail_cap')||0)+1), 3600);
    MailApp.sendEmail('initiatesports6331@gmail.com',
      '🛑 INITIATE 系統錯誤（'+where+'）',
      '家長資料後端發生錯誤，已自動記錄：\n\n位置：'+where+'\n\n'+String((err&&err.stack)||err)+
      '\n\n時間：'+Utilities.formatDate(new Date(), 'Asia/Hong_Kong', 'yyyy-MM-dd HH:mm:ss')+
      '\n\n（同類錯誤 15 分鐘內只會通知一次）');
  }catch(e){ Logger.log('reportError_ 失敗：'+e); }
}

// ─── POST ───────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    // 用教練密碼解鎖(畀前端鎖畫面用):只回傳是否正確,不洩漏密碼本身。
    if (action === 'verify') return makeResponse(verifyCoachThrottled_(body));

    // 完整 load:教練端(is-attendance-app)登入後以 POST 帶教練密碼讀取全校資料;密碼錯誤即拒。
    if (action === 'load') {
      if (!checkCoach_(body)) return makeResponse({ ok: false, error: '未授權:教練密碼錯誤' });
      return makeResponse(loadAll());
    }

    // 所有寫入動作都必須帶正確教練密碼,否則拒絕 —— 防止任何人匿名清空/竄改資料。
    const WRITE_ACTIONS = ['save_attendance','save_absences','save_performance','save_body','save_fee','save_settings'];
    if (WRITE_ACTIONS.indexOf(action) >= 0) {
      if (!checkCoach_(body)) return makeResponse({ ok: false, error: '未授權:教練密碼錯誤' });
      // ⚠️ save_* 多數係「清空 tab 再整片寫入」,萬一推送空資料就會清掉整個 tab。
      // 寫入前先整份備份(節流),確保任何覆寫/清空都可還原。
      backupBeforeWrite_();
    }

    if (action === 'save_attendance')  return makeResponse(saveAttendance(body.data));
    if (action === 'save_absences')    return makeResponse(saveAbsences(body.data));
    if (action === 'save_performance') return makeResponse(savePerformance(body.data));
    if (action === 'save_body')        return makeResponse(saveBody(body.data));
    if (action === 'save_fee')         return makeResponse(saveFee(body.data));
    if (action === 'save_settings')    return makeResponse(saveSettings(body.data));
    return makeResponse({ error: 'Unknown action: ' + action });
  } catch(err) {
    reportError_('#11 doPost', err);
    return makeResponse({ error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════
//  LOAD ALL
// ═══════════════════════════════════════════════════════════════════
function loadAll() {
  return {
    attendance:  sheetToArray('attendance'),
    absences:    sheetToArray('absences'),
    performance: sheetToArray('performance'),
    body:        sheetToArray('body'),
    fee_paid:    sheetToArray('fee_paid'),
    settings:    sheetToArray('settings'),
  };
}

// 家長專區(is-home)用:只回可公開展示嘅資料。
// 刻意排除 body(身高體重)、fee_paid(繳費)——呢啲敏感資料家長專區根本冇用到,
// 唔再經匿名 endpoint 送出瀏覽器。settings 含班名/相片/星之學員,absences/performance 供補堂提醒同排行榜。
function loadHome() {
  return {
    settings:    sheetToArray('settings'),
    absences:    sheetToArray('absences'),
    performance: sheetToArray('performance'),
  };
}

function formatCellValue(val) {
  if (val instanceof Date) {
    const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    return Utilities.formatDate(val, tz, 'yyyy-MM-dd');
  }
  if (val === null || val === undefined || val === '') return null;
  return val;
}

function sheetToArray(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = formatCellValue(row[i]); });
    return obj;
  });
}

// ═══════════════════════════════════════════════════════════════════
//  SAVE ATTENDANCE
// ═══════════════════════════════════════════════════════════════════
function saveAttendance(data) {
  const sheet = getSheet('attendance');
  ensureHeaders(sheet, ['key','classId','date','name','status']);
  deleteRowsWhere(sheet, 'key', data.key);
  const parts = data.key.split('|');
  const rows = Object.entries(data.session).map(([name, status]) =>
    [data.key, parts[0]||'', parts[1]||'', name, status]
  );
  if (rows.length) sheet.getRange(sheet.getLastRow()+1, 1, rows.length, 5).setValues(rows);
  return { ok: true, rows: rows.length };
}

// ═══════════════════════════════════════════════════════════════════
//  SAVE ABSENCES
// ═══════════════════════════════════════════════════════════════════
function saveAbsences(data) {
  const sheet = getSheet('absences');
  ensureHeaders(sheet, ['id','name','classId','absDate','deadline','madeUpDate']);
  // 防呆：收到空資料一律唔清空，避免一次壞 push 抹走整個 tab
  if (!data || !data.length) return { ok: true, rows: 0, skipped: 'empty-guard' };
  const rows = data.map(a => [a.id||'', a.name||'', a.classId||'', a.absDate||'', a.deadline||'', a.madeUpDate||'']);
  clearDataRows(sheet);
  sheet.getRange(2, 1, rows.length, 6).setValues(rows);
  return { ok: true, rows: rows.length };
}

// ═══════════════════════════════════════════════════════════════════
//  SAVE PERFORMANCE
// ═══════════════════════════════════════════════════════════════════
function savePerformance(data) {
  const sheet = getSheet('performance');
  ensureHeaders(sheet, ['name','metricId','date','val','v1','v2','v3']);
  const rows = [];
  Object.entries(data || {}).forEach(([name, metrics]) => {
    Object.entries(metrics).forEach(([metricId, records]) => {
      (records || []).forEach(r => {
        rows.push([name, metricId, r.date||'', r.val!==undefined?r.val:'',
          r.v1!==undefined?r.v1:'', r.v2!==undefined?r.v2:'', r.v3!==undefined?r.v3:'']);
      });
    });
  });
  // 防呆：算唔到任何資料就唔清空
  if (!rows.length) return { ok: true, rows: 0, skipped: 'empty-guard' };
  clearDataRows(sheet);
  sheet.getRange(2, 1, rows.length, 7).setValues(rows);
  return { ok: true, rows: rows.length };
}

// ═══════════════════════════════════════════════════════════════════
//  SAVE BODY
// ═══════════════════════════════════════════════════════════════════
function saveBody(data) {
  const sheet = getSheet('body');
  ensureHeaders(sheet, ['name','date','height','weight']);
  const rows = [];
  Object.entries(data || {}).forEach(([name, records]) => {
    (records || []).forEach(r => rows.push([name, r.date||'', r.height||'', r.weight||'']));
  });
  // 防呆：算唔到任何資料就唔清空
  if (!rows.length) return { ok: true, rows: 0, skipped: 'empty-guard' };
  clearDataRows(sheet);
  sheet.getRange(2, 1, rows.length, 4).setValues(rows);
  return { ok: true, rows: rows.length };
}

// ═══════════════════════════════════════════════════════════════════
//  SAVE FEE
// ═══════════════════════════════════════════════════════════════════
function saveFee(data) {
  const sheet = getSheet('fee_paid');
  ensureHeaders(sheet, ['key','periodId','classId','name','paid']);
  const rows = Object.entries(data || {}).filter(([,v])=>v).map(([key]) => {
    const p = key.split('|');
    return [key, p[0]||'', p[1]||'', p[2]||'', true];
  });
  // 防呆：算唔到任何資料就唔清空
  if (!rows.length) return { ok: true, rows: 0, skipped: 'empty-guard' };
  clearDataRows(sheet);
  sheet.getRange(2, 1, rows.length, 5).setValues(rows);
  return { ok: true, rows: rows.length };
}

// ═══════════════════════════════════════════════════════════════════
//  SAVE SETTINGS
//  v3 重要：照片以 photo_{name} 獨立 key 傳入
//  每個 value 若已是字串則直接存，否則 JSON.stringify
// ═══════════════════════════════════════════════════════════════════
function saveSettings(data) {
  const sheet = getSheet('settings');
  ensureHeaders(sheet, ['key','value']);
  const rows = Object.entries(data || {}).map(([k, v]) => {
    // 照片 data URL 已是字串，直接存；其餘 object/array 才 stringify
    const stored = (typeof v === 'string') ? v : JSON.stringify(v);
    return [k, stored];
  });
  // 防呆：算唔到任何資料就唔清空（保住相片/星星/設定）
  if (!rows.length) return { ok: true, rows: 0, skipped: 'empty-guard' };
  clearDataRows(sheet);
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  return { ok: true, rows: rows.length };
}

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════
function ensureHeaders(sheet, headers) {
  const existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (existing[0] !== headers[0]) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@STRING@');
  }
}

function clearDataRows(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.deleteRows(2, lastRow - 1);
}

function deleteRowsWhere(sheet, col, value) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;
  const colIdx = data[0].indexOf(col);
  if (colIdx < 0) return;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][colIdx]) === String(value)) sheet.deleteRow(i + 1);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  初始化（第一次部署後手動執行一次）
// ═══════════════════════════════════════════════════════════════════
function initSheets() {
  [
    { name:'attendance',  h:['key','classId','date','name','status'] },
    { name:'absences',    h:['id','name','classId','absDate','deadline','madeUpDate'] },
    { name:'performance', h:['name','metricId','date','val','v1','v2','v3'] },
    { name:'body',        h:['name','date','height','weight'] },
    { name:'fee_paid',    h:['key','periodId','classId','name','paid'] },
    { name:'settings',    h:['key','value'] },
  ].forEach(({name, h}) => ensureHeaders(getSheet(name), h));
  return { ok: true, message: '所有工作表已初始化' };
}