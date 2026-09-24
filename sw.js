/* 政治线 PWA Service Worker
   设计目标：
   1) 在线时永远拿到最新代码，绝不让旧版本复活；
   2) 预缓存逐个进行，单个文件失败不影响 Service Worker 安装（避免卡在安装态）；
   3) 每条分支都有多重兜底：任何一步失败都退回「最朴素的原生请求」，绝不把资源请求打死；
   4) 离线可用；配图一次下载永久复用。
*/
const CACHE = 'zzx-shell-v14';
/* 配图已全量转为 WebP（体积约减半），缓存名随之升级：
   旧 jpg 缓存会被自动清理，不会白白占着手机空间 */
const RUNTIME = 'zzx-runtime-v14';

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

/* 大体量且内容不变的资源（配图、桌面图标）：缓存优先 */
function isHeavyAsset(url) {
  return url.pathname.indexOf('/img/') !== -1 || url.pathname.indexOf('/icons/') !== -1;
}

/* 干净的回源请求：不直接复用页面的原始 Request（脚本类为 no-cors，
   个别 WebKit 版本对其在 Service Worker 内处理存在兼容问题），改为显式同源 GET。
   cache:'no-cache' = 必须向服务器校验，命中 ETag 返回 304，流量极小但内容永远最新 */
function netRequest(url, revalidate) {
  return new Request(url, {
    method: 'GET',
    credentials: 'same-origin',
    cache: revalidate ? 'no-cache' : 'default',
    redirect: 'follow'
  });
}

function safePut(cacheName, key, res) {
  if (!res || res.status !== 200 || res.type === 'opaque') return;
  try {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(key, copy)).catch(function () {});
  } catch (e) { /* 写入失败不影响页面 */ }
}

/* 强校验请求 → 失败退回原始请求 */
function fetchFresh(url, req) {
  return fetch(netRequest(url.href, true)).catch(function () { return fetch(req); });
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) =>
        fetch(netRequest(new URL(u, self.location.href).href, true))
          .catch(() => fetch(u))                 /* 兜底：退回最朴素请求 */
          .then((res) => { if (res && res.status === 200) return c.put(u, res); })
          .catch(() => {})                       /* 单文件失败不再让整个安装失败 */
      )))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k))))
      /* 清掉早期版本混入 RUNTIME 的代码/页面条目，只保留图片 */
      .then(() => caches.open(RUNTIME))
      .then((c) => c.keys().then((reqs) => Promise.all(reqs.map((r) => {
        let u;
        try { u = new URL(r.url); } catch (err) { return Promise.resolve(); }
        return isHeavyAsset(u) ? Promise.resolve() : c.delete(r).catch(function () {});
      }))))
      .then(() => self.clients.claim())
      .catch(() => self.clients.claim())
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
    '<p style="color:#57534b;font-size:14px;line-height:1.7;margin:0">请检查网络连接后重试。<br>若已添加到主屏幕，可先退出应用、联网后重新打开。</p></div></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // 页面导航：强校验网络优先 → 原始请求 → 缓存 → 离线页
  if (req.mode === 'navigate') {
    e.respondWith(
      fetchFresh(url, req)
        .then((res) => { safePut(CACHE, './index.html', res); return res; })
        .catch(() => caches.match('./index.html')
          .then((r) => r || caches.match(req))
          .then((r) => r || offlineResponse()))
    );
    return;
  }

  // 配图与桌面图标：缓存优先（沿用长期验证可用的原始请求方式），未命中再联网并写入 RUNTIME
  if (isHeavyAsset(url)) {
    e.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((res) => { safePut(RUNTIME, url.href, res); return res; })
          .catch(() => fetch(url.href));          /* 兜底：退回最朴素请求 */
      }).catch(() => fetch(url.href))
    );
    return;
  }

  // 代码与数据：强校验网络优先并写入缓存，离线回退缓存，最后再退原始请求
  e.respondWith(
    fetchFresh(url, req)
      .then((res) => { safePut(CACHE, url.href, res); return res; })
      .catch(() => caches.match(req).then((r) => r || caches.match(url.href)))
  );
});
