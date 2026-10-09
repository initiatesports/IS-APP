/* INITIATE 私訓 App · 推送通知 Service Worker（2026-10-09）
   ⚠️ 只做推送：冇 fetch handler（唔攔截任何請求、唔快取任何嘢）→ 對全站其他 web app 零影響。
   scope 收窄喺 is-pt.html（is-pt.html 註冊時指定）。
   後端發嘅 push 係「空」嘅（冇內容）→ 醒咗用學員帳戶叫 pushPull 攞內容先顯示，
   所以通知內容唔經 Apple／Google 推送伺服器。帳戶存 IndexedDB（唔用 Cache Storage：
   成長中心 SW activate 會清晒其他 cache）。 */
const API = 'https://script.google.com/macros/s/AKfycbz34SLDFmVISrW4_QinGwxzHVfZOshGFVZE8mAPaxppJdR4fo3c4Z6PrdzR8nnralhp/exec';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

function idbGet(key){
  return new Promise(res => {
    try{
      const rq = indexedDB.open('ispt', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onerror = () => res(null);
      rq.onsuccess = () => { try{ const tx = rq.result.transaction('kv', 'readonly'), g = tx.objectStore('kv').get(key); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); }catch(e){ res(null); } };
    }catch(e){ res(null); }
  });
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let list = [];
    const a = await idbGet('auth');
    if(a && a.name && a.code){
      for(let i = 0; i < 2 && !list.length; i++){
        try{
          const r = await fetch(API, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'}, body:JSON.stringify({action:'pushPull', name:a.name, code:a.code})});
          const t = await r.text();
          if(t.charAt(0) === '{'){ const j = JSON.parse(t); if(j.ok){ list = j.items || []; break; } }
        }catch(x){}
      }
    }
    // iPhone 規定：收到 push 一定要顯示通知，否則會被收回權限 → 攞唔到內容都要彈一個
    if(!list.length) list = [{id:'ispt', title:'INITIATE 私訓', body:'有新消息，撳入嚟睇吓', link:'home'}];
    for(const n of list.slice(0, 3)){
      await self.registration.showNotification(n.title || 'INITIATE 私訓', {
        body: n.body || '', icon: 'img/is-mark-512.png', badge: 'img/is-mark-96.png',
        tag: n.id || 'ispt', data: {link: n.link || 'home'}
      });
    }
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || 'home';
  const url = new URL('is-pt.html#go=' + encodeURIComponent(link), self.registration.scope).href;
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    for(const c of cs){
      if(c.url.indexOf('is-pt.html') >= 0){ try{ await c.focus(); }catch(x){} c.postMessage({go:link}); return; }
    }
    await self.clients.openWindow(url);
  })());
});
