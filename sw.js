/* 政治线 PWA Service Worker —— 保证添加到桌面后快速打开、不白屏 */
const CACHE = 'zzx-shell-v6';

const SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/data/sg.js',
  './js/data/sgdoc.js',
  './js/data/mao.js',
  './js/data/my.js',
  './js/data/sf.js',
  './js/data/xc.js',
  './js/data/quiz.js',
  './js/data/quiz-zhenti.js',
  './js/data/essay.js',
  './icon.svg',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 完全离线且无缓存时，返回友好提示页（替代系统默认的"网络无法连接"）
function offlineResponse() {
  return new Response(
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>政治线 · 离线</title></head>' +
    '<body style="font-family:system-ui;margin:0;background:#f6f4ef;color:#1d1b18;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center">' +
    '<div style="padding:24px"><h1 style="font-size:20px;margin:0 0 8px">暂时无法加载</h1>' +
    '<p style="color:#57534b;font-size:14px;line-height:1.7;margin:0">请检查网络连接后重试。<br>若应用已添加到主屏幕，可先退出后重新联网打开。</p></div></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先，失败才回退缓存，再失败返回离线提示页 —— 保证不出现系统级"网络无法连接"
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')
          .then((r) => r || caches.match('./'))
          .then((r) => r || offlineResponse()))
    );
    return;
  }

  // 静态资源与图片：缓存优先 + 后台更新（stale-while-revalidate）
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type !== 'opaque') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
