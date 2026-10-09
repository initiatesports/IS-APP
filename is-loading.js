/* INITIATE SPORTS 共用「載入中」提示（老闆 2026-10-09：撳完掣等緊後端，家長／學生以為系統壞咗）
   全部 web app 喺 <head> 引入：<script src="is-loading.js?v=1"></script>
   • 只睇呼叫後端（script.google.com／googleusercontent.com）嘅 fetch，其他請求唔理
   • 用戶撳完掣 1.5 秒內發出嘅請求＝「前台」：0.4 秒仲未返 → 中間彈「載入中…」窗（擋住再撳，防重複提交）
     8 秒 →「網絡有啲慢，仲處理緊…」；25 秒 → 出「收埋」掣（請求照繼續，唔會卡死）
   • 其他（開頁、背景自動更新）＝「背景」：頂部一條細進度條，唔擋操作
   • 唔改任何 app 自己嘅邏輯（只包住 window.fetch）；個別請求唔想要提示：fetch(url,{...,isNoLoading:true}) */
(function(){
  if(window.__isLoadingInstalled || !window.fetch) return; window.__isLoadingInstalled=true;
  var RX=/(^|\/\/)(script\.google\.com|script\.googleusercontent\.com)\//;
  var lastTap=0; ['pointerdown','touchstart','click','keydown','submit'].forEach(function(ev){ document.addEventListener(ev, function(){ lastTap=Date.now(); }, true); });
  var fg=0, bg=0, showT=null, hideT=null, slowT=null, stuckT=null, ov=null, bar=null, fgSince=0, dismissed=false;
  var en=function(){ return /^en/i.test(document.documentElement.lang||''); };   // app 轉英文會改 <html lang>
  var TX=function(k){ var E=en(); return ({load:E?'Loading…':'載入中…', slow:E?'The network is a bit slow — still working, please don’t close the app':'網絡有啲慢，仲處理緊…請唔好閂 app', hide:E?'Hide':'收埋'})[k]; };
  function css(){ if(document.getElementById('isld-css')) return; var s=document.createElement('style'); s.id='isld-css';
    s.textContent='@keyframes isldspin{to{transform:rotate(360deg)}}@keyframes isldbar{0%{left:-40%;width:40%}50%{left:30%;width:50%}100%{left:100%;width:40%}}'+
      '#isld-ov{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.22);opacity:0;transition:opacity .15s;-webkit-tap-highlight-color:transparent}'+
      '#isld-ov.on{opacity:1}#isld-card{background:rgba(24,24,24,.9);color:#fff;border-radius:16px;padding:18px 22px;min-width:150px;max-width:78vw;text-align:center;font:600 15px/1.5 -apple-system,BlinkMacSystemFont,"PingFang HK","Noto Sans HK",sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25)}'+
      '#isld-sp{width:30px;height:30px;margin:2px auto 10px;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:isldspin .8s linear infinite}'+
      '#isld-msg{white-space:pre-line}#isld-hide{margin-top:12px;background:none;border:1px solid rgba(255,255,255,.5);color:#fff;border-radius:999px;padding:5px 16px;font:inherit;font-size:13px;display:none}'+
      '#isld-bar{position:fixed;top:0;left:0;right:0;height:3px;z-index:2147483001;overflow:hidden;pointer-events:none;display:none}#isld-bar i{position:absolute;top:0;height:100%;background:#2f8f6b;animation:isldbar 1.1s ease-in-out infinite}';
    (document.head||document.documentElement).appendChild(s); }
  function mkOv(){ if(ov) return ov; css(); ov=document.createElement('div'); ov.id='isld-ov'; ov.setAttribute('role','alert'); ov.setAttribute('aria-live','polite');
    ov.innerHTML='<div id="isld-card"><div id="isld-sp"></div><div id="isld-msg"></div><button id="isld-hide" type="button"></button></div>';
    ov.addEventListener('click', function(e){ e.stopPropagation(); e.preventDefault(); }, true);   // 擋住背後撳掣（防重複提交）
    ov.querySelector('#isld-hide').addEventListener('click', function(e){ e.stopPropagation(); dismissed=true; hideOv(); }, true);
    document.body.appendChild(ov); return ov; }
  function mkBar(){ if(bar) return bar; css(); bar=document.createElement('div'); bar.id='isld-bar'; bar.innerHTML='<i></i>'; document.body.appendChild(bar); return bar; }
  function showOv(){ if(!document.body || dismissed) return; mkOv(); ov.querySelector('#isld-msg').textContent=TX('load'); var hb=ov.querySelector('#isld-hide'); hb.textContent=TX('hide'); hb.style.display='none';
    ov.style.display='flex'; requestAnimationFrame(function(){ ov.className='on'; });
    clearTimeout(slowT); clearTimeout(stuckT);
    slowT=setTimeout(function(){ if(fg>0 && ov) ov.querySelector('#isld-msg').textContent=TX('slow'); }, 8000);
    stuckT=setTimeout(function(){ if(fg>0 && ov) ov.querySelector('#isld-hide').style.display='inline-block'; }, 25000); }
  function hideOv(){ clearTimeout(slowT); clearTimeout(stuckT); if(ov){ ov.className=''; ov.style.display='none'; } }
  function sync(){
    clearTimeout(hideT);
    if(fg>0){ if(!showT && !(ov && ov.style.display==='flex')) showT=setTimeout(function(){ showT=null; if(fg>0) showOv(); }, 400); }
    else { clearTimeout(showT); showT=null; hideT=setTimeout(function(){ if(fg===0){ hideOv(); dismissed=false; } }, 250); }   // 重試之間嘅空隙唔好閃
    if(document.body){ if(bg>0 && fg===0){ mkBar(); if(bar.style.display!=='block' && !bar._t) bar._t=setTimeout(function(){ bar._t=null; if(bg>0 && fg===0) bar.style.display='block'; }, 400); } else if(bar){ clearTimeout(bar._t); bar._t=null; bar.style.display='none'; } }
  }
  var of=window.fetch;
  window.fetch=function(input, init){
    var url=''; try{ url=typeof input==='string'?input:(input&&input.url)||String(input); }catch(e){}
    if(!RX.test(url) || (init && init.isNoLoading)) return of.apply(this, arguments);
    var user=(Date.now()-lastTap)<1500; if(user) fg++; else bg++; sync();
    var done=false, fin=function(){ if(done) return; done=true; if(user) fg=Math.max(0,fg-1); else bg=Math.max(0,bg-1); sync(); };
    var p; try{ p=of.apply(this, arguments); }catch(e){ fin(); throw e; }
    p.then(fin, fin); return p;
  };
})();
