/* ⏳ 全站「載入中」窗口（老闆 2026-10-09：撳完掣要等嘅時候冇反應，家長以為系統壞咗／再撳一次）
 *
 * 做法：包住 window.fetch —— 凡係同 Apps Script 後端（script.google.com／googleusercontent）溝通，
 *   超過 400ms 未完成就彈出全畫面「載入中…」窗口（同時擋住重複撳）；完成即消失。
 *   等得耐會轉字：6 秒「處理緊，請稍候（唔使再撳）」、20 秒「網絡較慢，仍在處理…」。
 * 背景載入（例如已顯示快取再靜靜更新、成績、假期）唔彈：fetch(url, {..., isBg:true})。
 * 安全：純前端顯示；最多 70 秒自動收起（fetch 本身 45 秒逾時），永遠唔會卡死畫面。
 * 用法：<script src="is-loading.js"></script> 放喺頁面其他 script 之前。
 */
(function () {
  if (window.__isLoadingInstalled) return; window.__isLoadingInstalled = true;
  var pending = 0, showT = null, stepT = [], el = null, shownAt = 0, guardT = null;
  var en = function () { try { return (typeof LANG !== 'undefined' && LANG === 'en') || /^en/i.test(document.documentElement.lang || ''); } catch (e) { return false; } };
  var TXT = {
    load: function () { return en() ? 'Loading…' : '載入中…'; },
    slow: function () { return en() ? 'Still working — please wait (no need to tap again)' : '處理緊，請稍候（唔使再撳）'; },
    vslow: function () { return en() ? 'Slow network — still processing, please be patient' : '網絡較慢，仍在處理，請耐心等候'; }
  };
  function ensureEl() {
    if (el) return el;
    var st = document.createElement('style');
    st.textContent = '#is-loading{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;background:rgba(10,18,28,.38);-webkit-backdrop-filter:blur(1.5px);backdrop-filter:blur(1.5px)}'
      + '#is-loading.on{display:flex}'
      + '#is-loading .box{background:#fff;color:#1f2a30;border-radius:16px;padding:20px 26px;min-width:180px;max-width:80vw;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.25);font:600 15px/1.5 -apple-system,"PingFang HK","Noto Sans HK","Microsoft JhengHei",sans-serif}'
      + '#is-loading .sp{width:34px;height:34px;margin:0 auto 12px;border-radius:50%;border:4px solid #d9eef1;border-top-color:#28B8C8;animation:isld 0.8s linear infinite}'
      + '#is-loading .sub{font-size:12.5px;font-weight:500;color:#66757c;margin-top:6px}'
      + '@keyframes isld{to{transform:rotate(360deg)}}';
    (document.head || document.documentElement).appendChild(st);
    el = document.createElement('div'); el.id = 'is-loading'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="box"><div class="sp"></div><div class="t"></div><div class="sub"></div></div>';
    (document.body || document.documentElement).appendChild(el);
    return el;
  }
  function setText(t, sub) { var e = ensureEl(); e.querySelector('.t').textContent = t; e.querySelector('.sub').textContent = sub || ''; }
  function show() {
    showT = null; if (pending <= 0) return;
    setText(TXT.load()); ensureEl().classList.add('on'); shownAt = Date.now();
    stepT.push(setTimeout(function () { if (pending > 0) setText(TXT.load(), TXT.slow()); }, 6000));
    stepT.push(setTimeout(function () { if (pending > 0) setText(TXT.load(), TXT.vslow()); }, 20000));
    clearTimeout(guardT); guardT = setTimeout(function () { pending = 0; hide(); }, 70000);   // 安全閥：永不卡死
  }
  function hide() {
    clearTimeout(showT); showT = null; stepT.forEach(clearTimeout); stepT = []; clearTimeout(guardT);
    if (el) el.classList.remove('on');
  }
  function begin() { pending++; if (!showT && !(el && el.classList.contains('on'))) showT = setTimeout(show, 400); }
  function end() { pending = Math.max(0, pending - 1); if (pending === 0) hide(); }
  var isBackend = function (u) { return /script\.google(usercontent)?\.com\//.test(u); };

  var orig = window.fetch && window.fetch.bind(window);
  if (!orig) return;
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var bg = !!(init && init.isBg);
    if (init && 'isBg' in init) { init = Object.assign({}, init); delete init.isBg; }
    if (bg || !isBackend(url)) return orig(input, init);
    begin();
    var p;
    try { p = orig(input, init); } catch (e) { end(); throw e; }
    // 等埋 body 讀完先收起？唔使：回應到就收（.json() 好快）；用 finally 確保失敗都收
    return p.then(function (r) { end(); return r; }, function (e) { end(); throw e; });
  };
  // 畀頁面手動用（例如非 fetch 嘅長時間操作）：ISLOAD.wrap(promise)
  window.ISLOAD = {
    wrap: function (pr) { begin(); return Promise.resolve(pr).then(function (v) { end(); return v; }, function (e) { end(); throw e; }); },
    on: begin, off: end
  };
})();
