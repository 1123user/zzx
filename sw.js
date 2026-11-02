/* 政治线 PWA Service Worker
   性能策略（打开即秒开）：
   1) 外壳/数据/图片一律「缓存优先」——本地有就毫秒级返回，完全不等网络；
   2) 每次返回缓存的同时，在后台静默向服务器校验并更新缓存（下次打开就是最新内容）；
   3) 版本升级由 Service Worker 自身完成：install 预缓存本版本全部外壳（逐文件，单文件失败不影响安装），
      activate 时清理旧版本缓存并通知页面「新版本已就绪」；
   4) 预缓存与所有网络请求均有兜底，任何一步失败都不会把资源请求打死。
*/
const CACHE = 'zzx-shell-v37';
/* 配图为 WebP，缓存名与内容版本对应；改名会自动清理旧图片缓存 */
const RUNTIME = 'zzx-runtime-v14';

const SHELL = [
  './',
  './index.html',
  './css/app.css?v=37',
  './js/theme.js?v=37',
  './js/pwa.js?v=37',
  './js/app.js?v=37',
  './js/data/sg.js',
  './js/data/sgdoc.js',
  './js/data/mao.js',
  './js/data/my.js',
  './js/data/sf.js',
  './js/data/xc.js',
  './js/data/imgsize.js?v=37',
  './js/data/zhenti-stat.js?v=37',
  './js/data/tier.js?v=37',
  './js/data/my-pair.js',
  './js/data/sg-anniv.js',
  './js/data/beisong.js?v=37',
  './js/data/daily.js?v=37',
  './icon.svg',
  './icons/icon-180.png?v=2',
  './icons/icon-192.png?v=2',
  './icons/icon-512.png?v=2',
  './icons/icon-512-maskable.png?v=2',
  './manifest.json'
];
/* 题库与材料分析题体积较大，只在用到时才下载（首屏不下载，也不预缓存） */

/* 大体量且内容不变的资源（配图、桌面图标）：缓存优先 */
function isHeavyAsset(url) {
  return url.pathname.indexOf('/img/') !== -1 || url.pathname.indexOf('/icons/') !== -1;
}

/* 干净的回源请求：不直接复用页面的原始 Request（脚本类为 no-cors，
   个别 WebKit 版本对其在 Service Worker 内处理存在兼容问题），改为显式同源 GET */
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

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) =>
        fetch(netRequest(new URL(u, self.location.href).href, true))
          .catch(() => fetch(u))
          .then((res) => { if (res && res.status === 200) return c.put(u, res); })
          .catch(() => {})                       /* 单文件失败不影响整体安装 */
      )))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k))))
      /* 清掉早期版本混入 RUNTIME 的非图片条目 */
      .then(() => caches.open(RUNTIME))
      .then((c) => c.keys().then((reqs) => Promise.all(reqs.map((r) => {
        let u;
        try { u = new URL(r.url); } catch (err) { return Promise.resolve(); }
        return isHeavyAsset(u) ? Promise.resolve() : c.delete(r).catch(function () {});
      }))))
      .then(() => self.clients.claim())
      /* 告知已打开的页面有新版本可用（由页面决定是否提示刷新，绝不自动刷新） */
      .then(() => self.clients.matchAll({ includeUncontrolled: true }))
      .then((cs) => cs.forEach((c) => { try { c.postMessage({ type: 'zzx-updated' }); } catch (err) {} }))
      .catch(function () {})
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

  /* 页面导航：网络优先（1.8 秒没回来就用缓存）。
     以前是「缓存优先 + 后台更新」，结果是每次打开都慢一拍：发版后用户看到的仍是上一版，
     修好的问题「一直不生效」，只能靠开两次或删掉重装。 */
  if (req.mode === 'navigate') {
    const net = fetch(netRequest(url.href, true)).then(function (res) {
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (ct.indexOf('text/html') >= 0) safePut(CACHE, './index.html', res.clone());
      return res;
    });
    const picked = new Promise(function (resolve) {
      let settled = false;
      const timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        caches.match('./index.html').then(function (c) {
          if (c && (c.headers.get('content-type') || '').toLowerCase().indexOf('text/html') >= 0) resolve(c);
          else resolve(net);
        }).catch(function () { resolve(net); });
      }, 1800);
      net.then(function (res) {
        if (settled) return;
        settled = true; clearTimeout(timer); resolve(res);
      }).catch(function () {
        if (settled) return;
        settled = true; clearTimeout(timer);
        caches.match('./index.html').then(function (c) {
          if (c && (c.headers.get('content-type') || '').toLowerCase().indexOf('text/html') >= 0) return resolve(c);
          caches.match(req).then(function (r2) { resolve(r2 || offlineResponse()); });
        }).catch(function () { resolve(offlineResponse()); });
      });
    });
    e.respondWith(picked);
    return;
  }

  // 配图与桌面图标：缓存优先（内容不变，一次存入永久复用）
  if (isHeavyAsset(url)) {
    e.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).then((res) => { safePut(RUNTIME, url.href, res); return res; })
          .catch(function () { return fetch(url.href); });
      }).catch(function () { return fetch(url.href); })
    );
    return;
  }

  /* 代码与数据：缓存秒出 + 后台静默校验；没有缓存才等网络。
     注意：网络请求与响应不能和 waitUntil 共用同一个 Response Promise——
     两者同时消费同一个响应时，本地开发服务器（缺 Cache-Control）会直接 ERR_FAILED，
     表现为 essay.js / quiz.js 这类「不预缓存、用到才拉」的文件永远加载不出来。
     这里把「返回给页面的响应」与「写缓存的后台请求」拆成两个独立请求。 */
  e.respondWith(
    caches.match(req).then(function (cached) {
      const net = fetch(netRequest(url.href, true))
        .then(function (res) {
          if (res && res.status === 200 && res.type !== 'opaque') safePut(CACHE, url.href, res);
          return res;
        })
        .catch(function () { return fetch(req); });
      if (cached) {
        e.waitUntil(net.catch(function () {}));
        return cached;
      }
      return net;
    }).catch(function () { return fetch(req); })
  );
});
