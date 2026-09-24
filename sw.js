/* 政治线 PWA Service Worker
   设计目标：
   1) 在线时永远拿到最新代码，绝不让旧版本复活；
   2) 预缓存逐个进行，单个文件失败不影响 Service Worker 安装（避免卡在安装态）；
   3) 回源一律使用「干净的同源 Request」，规避 iOS Safari 对原始 no-cors 请求的兼容问题；
   4) 离线可用；配图一次下载永久复用。
*/
const CACHE = 'zzx-shell-v12';
/* RUNTIME 名字冻结：里面存着约 36MB 配图，改名会导致全部重下 */
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

/* 大体量且内容不变的资源（配图、桌面图标）：缓存优先 */
function isHeavyAsset(url) {
  return url.pathname.indexOf('/img/') !== -1 || url.pathname.indexOf('/icons/') !== -1;
}

/* 干净的回源请求：不直接复用页面的原始 Request（脚本类为 no-cors，
   iOS Safari 在 Service Worker 内对其处理存在兼容问题），改为显式同源 GET。
   cache:'no-cache' 表示必须向服务器校验（命中 ETag 返回 304，流量极小），
   从而保证在线时拿到的永远是最新内容。 */
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
  } catch (e) { /* 忽略写入失败，不影响页面 */ }
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) =>
        fetch(netRequest(new URL(u, self.location.href).href, true))
          .then((res) => { if (res && res.status === 200) return c.put(u, res); })
          .catch(() => {})            /* 单文件失败不再让整个安装失败 */
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

/* 导航请求：网络优先（强制校验）→ 缓存 → 离线页 */
function handleNavigate(url) {
  return fetch(netRequest(url.href, true))
    .then((res) => { safePut(CACHE, './index.html', res); return res; })
    .catch(() => caches.match('./index.html')
      .then((r) => r || caches.match(url.href))
      .then((r) => r || offlineResponse()));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // 页面导航
  if (req.mode === 'navigate') {
    e.respondWith(handleNavigate(url));
    return;
  }

  // 配图与桌面图标：缓存优先，未命中再联网并写入 RUNTIME
  if (isHeavyAsset(url)) {
    e.respondWith(
      caches.match(url.href).then((cached) => {
        if (cached) return cached;
        return fetch(netRequest(url.href, false))
          .then((res) => { safePut(RUNTIME, url.href, res); return res; });
      })
    );
    return;
  }

  // 代码与数据：网络优先（强制校验）并写入缓存，离线回退缓存
  e.respondWith(
    fetch(netRequest(url.href, true))
      .then((res) => { safePut(CACHE, url.href, res); return res; })
      .catch(() => caches.match(url.href).then((r) => r || caches.match(req)))
  );
});
