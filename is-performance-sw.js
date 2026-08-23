/* INITIATE 成長中心 · Service Worker
   ⚠️ 只快取本 app 自己嘅 HTML（離線開得到）。對其他所有請求（其他 IS-APP 頁、
   API、資源）完全唔攔截 → 對全站其他 web app 完全透明、零影響。 */
const CACHE = 'growth-center-v1';
const APP = 'is-performance.html';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.add(APP)).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // 只接管「開啟本 app 頁」嘅導覽請求；network-first（有網攞最新→順手更新快取；冇網→用快取）。
  if (e.request.mode === 'navigate' && url.origin === self.location.origin && url.pathname.endsWith('/' + APP)) {
    e.respondWith(
      fetch(e.request)
        .then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(APP, cp)); return r; })
        .catch(() => caches.match(APP))
    );
    return;
  }
  // 其他一律唔 respondWith → 瀏覽器正常處理（對其他頁/API 完全透明）
});
