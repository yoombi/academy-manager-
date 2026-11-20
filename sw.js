/* 엄마다했쏙 — 오프라인 캐시 서비스워커
   · 앱 파일(html/js/css)은 네트워크 우선: 새 버전이 바로 반영됩니다.
   · 그 밖의 자산(아이콘 등)은 캐시 우선: 오프라인·느린 회선에서도 빠르게 뜹니다. */
const CACHE = 'academy-manager-v8';
const ASSETS = [
  './index.html',
  './styles.css',
  './logic.js',
  './app.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(ASSETS.map((url) =>
        /* cache: 'reload' — 브라우저 HTTP 캐시에 남은 예전 파일을 쓰지 않고 네트워크에서 새로 받는다 */
        fetch(new Request(url, { cache: 'reload' }))
          .then((res) => (res && res.ok ? cache.put(url, res) : null))
          .catch(() => null)
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAppFile(req, url) {
  if (req.mode === 'navigate' || req.destination === 'document') return true;
  if (req.destination === 'script' || req.destination === 'style') return true;
  return /\.(?:html|js|css|json)$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isAppFile(req, url)) {
    /* 네트워크 우선 — 실패하면 캐시(없으면 index.html)로 */
    event.respondWith(
      fetch(new Request(req, { cache: 'no-cache' }))
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })
          .then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached || caches.match('./index.html'));
      return cached || network;
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.postMessage({ type: 'open-homework' });
          return client.focus();
        }
      }
      return self.clients.openWindow('./index.html');
    })
  );
});
