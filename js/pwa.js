/* Service Worker 注册与更新检查。
   单独成文件（而不是内联脚本），这样页面可以启用严格 CSP：script-src 'self'。
   注意：这里的更新检查只做「静默检查」，绝不自动刷新页面，避免 iOS 上出现刷新死循环；
   新版本由 Service Worker 自身接管，页面侧会收到提示（见 app.js 的 toast 处理）。 */
(function () {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
      var lastAt = 0;
      function checkUpdate() {
        var now = Date.now();
        if (now - lastAt < 30000) return;          // 节流 30 秒
        lastAt = now;
        try { reg.update(); } catch (e) {}
      }
      checkUpdate();
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) checkUpdate();
      });
      window.addEventListener('online', checkUpdate);
    }).catch(function () {});
  });
})();
