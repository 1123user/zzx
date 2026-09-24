/* 政治线 PWA Service Worker
   原则：在线时永远拿到最新代码；离线时完整可用；配图缓存尽量保留，不重复下载 */
const CACHE = 'zzx-shell-v11';
/* RUNTIME 名字冻结在此版本：里面存着约 36MB 配图，改名将导致全部重下。
   v11 起它只存放图片类资源，早期版本混入的代码条目会在 activate 时被清理 */
const RUNTIME = 'zzx-runtime-v10';

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

/* 大体量且内容不变的资源（配图、桌面图标）：缓存优先，一次下载永久复用 */
function isHeavyAsset(url) {
  return url.pathname.indexOf('/img/') !== -1 || url.pathname.indexOf('/icons/') !== -1;
}

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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k))))
      /* 清掉旧版本 SWR 策略混入 RUNTIME 的代码/页面条目，只保留图片 */
      .then(() => caches.open(RUNTIME))
      .then((c) => c.keys().then((reqs) => Promise.all(reqs.map((r) => {
        let u;
        try { u = new URL(r.url); } catch (err) { return Promise.resolve(); }
        return isHeavyAsset(u) ? Promise.resolve() : c.delete(r);
      }))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
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

  // 页面导航：网络优先，失败才回退缓存，再失败返回离线提示页
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

  // 配图与桌面图标：缓存优先（内容不变，避免重复下载几十 MB）
  if (isHeavyAsset(url)) {
    e.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.status === 200 && res.type !== 'opaque') {
            const copy = res.clone();
            caches.open(RUNTIME).then((c) => c.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // 代码与数据（js/css/json/svg 等）：网络优先并写入缓存，离线回退缓存
  // —— 保证在线打开时页面与代码永远是同一版本，不会再出现"旧版复活"
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
