/*
  匯倬FXVIC 零用金使用紀錄 - Service Worker
  --------------------------------------------------
  更新 App 時，請將 CACHE_VERSION 數字 +1（例如 v1 -> v2），
  部署後使用者下次開啟就會自動抓取新版本並清除舊快取，
  不會影響 IndexedDB 內已儲存的記帳資料（資料庫與快取是分開的儲存空間）。
*/
const CACHE_VERSION = 'v2';
const CACHE_NAME = `fxvic-cache-${CACHE_VERSION}`;

// App Shell：一定要能離線使用的核心檔案
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

// 第三方 CDN 資源（圖表/匯出功能），盡量快取，若失敗不影響安裝
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // 重要修正：改為逐一快取並個別 try/catch，任何單一檔案 404 或載入失敗
      // 都不會讓整個 Service Worker 安裝流程失敗（舊版用 cache.addAll 一次
      // 全部要求成功，只要少一個檔案就會整個安裝失敗，導致離線快取完全失效）。
      await Promise.allSettled(
        APP_SHELL.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res && res.ok) await cache.put(url, res);
          } catch (e) { console.warn('[SW] 略過無法快取的檔案:', url, e); }
        })
      );
      // CDN 資源逐一嘗試快取，個別失敗不中斷安裝流程
      await Promise.allSettled(
        CDN_ASSETS.map(async (url) => {
          try {
            const res = await fetch(url, { mode: 'cors' });
            if (res && res.ok) await cache.put(url, res);
          } catch (e) { /* 離線環境或封鎖時略過，不影響安裝 */ }
        })
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // 導覽請求（開啟 App）：優先嘗試網路，離線時回退到快取的 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch (e) {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match('./index.html')) || Response.error();
        }
      })()
    );
    return;
  }

  // 其他資源（含 CDN 函式庫、圖示）：快取優先，並在背景更新快取
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      return cached || (await networkFetch) || Response.error();
    })()
  );
});
