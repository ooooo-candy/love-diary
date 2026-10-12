/* 离线缓存：安装后无网络也能打开（照片数据本就存在设备本地） */
const CACHE = 'love-diary-v3';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/ui.js',
  './js/lunar.js',
  './js/store.js',
  './js/cloud.js',
  './js/mock-cloud.js',
  './js/auth.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

  const pathname = new URL(req.url).pathname;
  // 安装包等文件交给浏览器自己处理，不参与缓存
  if (/\.(apk|zip)$/i.test(pathname)) return;

  const isPage = req.mode === 'navigate';
  // 页面、脚本、样式总是优先取最新的，保证「一刷新就是新版」；离线才回落缓存
  const isFresh = isPage || /\.(js|css|webmanifest)$/i.test(pathname);

  if (isFresh) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(isPage ? './index.html' : req, copy));
          }
          return res;
        })
        .catch(() => caches.match(isPage ? './index.html' : req, { ignoreSearch: true }))
    );
    return;
  }

  // 图标等不常变的资源：缓存优先，后台悄悄更新
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
