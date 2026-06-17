// ═══════════════════════════════════════════════════════════════════
//  INITIATE SPORTS — Google Apps Script  v3.0
//  修正：照片改用獨立 key 儲存（photo_{name}），避免超出 Sheets 格子限制
//  所有資料即時雲端同步
// ═══════════════════════════════════════════════════════════════════

const SHEET_ID = '1prjceGydcVHvhidlp8SZEJ1abE0Cvz2WqwrjN6_K7qo';

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
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
    if (action === 'load') return makeResponse(loadAll());
    if (action === 'ping') return makeResponse({ ok: true, ts: new Date().toISOString() });
    return makeResponse({ error: 'Unknown action: ' + action });
  } catch(err) {
    return makeResponse({ error: err.message });
  }
}

// ─── POST ───────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    if (action === 'save_attendance')  return makeResponse(saveAttendance(body.data));
    if (action === 'save_absences')    return makeResponse(saveAbsences(body.data));
    if (action === 'save_performance') return makeResponse(savePerformance(body.data));
    if (action === 'save_body')        return makeResponse(saveBody(body.data));
    if (action === 'save_fee')         return makeResponse(saveFee(body.data));
    if (action === 'save_settings')    return makeResponse(saveSettings(body.data));
    return makeResponse({ error: 'Unknown action: ' + action });
  } catch(err) {
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
  clearDataRows(sheet);
  if (!data || !data.length) return { ok: true, rows: 0 };
  const rows = data.map(a => [a.id||'', a.name||'', a.classId||'', a.absDate||'', a.deadline||'', a.madeUpDate||'']);
  sheet.getRange(2, 1, rows.length, 6).setValues(rows);
  return { ok: true, rows: rows.length };
}

// ═══════════════════════════════════════════════════════════════════
//  SAVE PERFORMANCE
// ═══════════════════════════════════════════════════════════════════
function savePerformance(data) {
  const sheet = getSheet('performance');
  ensureHeaders(sheet, ['name','metricId','date','val','v1','v2','v3']);
  clearDataRows(sheet);
  const rows = [];
  Object.entries(data || {}).forEach(([name, metrics]) => {
    Object.entries(metrics).forEach(([metricId, records]) => {
      (records || []).forEach(r => {
        rows.push([name, metricId, r.date||'', r.val!==undefined?r.val:'',
          r.v1!==undefined?r.v1:'', r.v2!==undefined?r.v2:'', r.v3!==undefined?r.v3:'']);
      });
    });
  });
  if (rows.length) sheet.getRange(2, 1, rows.length, 7).setValues(rows);
  return { ok: true, rows: rows.length };
}

// ═══════════════════════════════════════════════════════════════════
//  SAVE BODY
// ═══════════════════════════════════════════════════════════════════
function saveBody(data) {
  const sheet = getSheet('body');
  ensureHeaders(sheet, ['name','date','height','weight']);
  clearDataRows(sheet);
  const rows = [];
  Object.entries(data || {}).forEach(([name, records]) => {
    (records || []).forEach(r => rows.push([name, r.date||'', r.height||'', r.weight||'']));
  });
  if (rows.length) sheet.getRange(2, 1, rows.length, 4).setValues(rows);
  return { ok: true, rows: rows.length };
}

// ═══════════════════════════════════════════════════════════════════
//  SAVE FEE
// ═══════════════════════════════════════════════════════════════════
function saveFee(data) {
  const sheet = getSheet('fee_paid');
  ensureHeaders(sheet, ['key','periodId','classId','name','paid']);
  clearDataRows(sheet);
  const rows = Object.entries(data || {}).filter(([,v])=>v).map(([key]) => {
    const p = key.split('|');
    return [key, p[0]||'', p[1]||'', p[2]||'', true];
  });
  if (rows.length) sheet.getRange(2, 1, rows.length, 5).setValues(rows);
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
  clearDataRows(sheet);
  const rows = Object.entries(data || {}).map(([k, v]) => {
    // 照片 data URL 已是字串，直接存；其餘 object/array 才 stringify
    const stored = (typeof v === 'string') ? v : JSON.stringify(v);
    return [k, stored];
  });
  if (rows.length) sheet.getRange(2, 1, rows.length, 2).setValues(rows);
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