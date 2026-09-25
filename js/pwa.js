/* Service Worker 注册与更新检查。
   单独成文件（而不是内联脚本），这样页面可以启用严格 CSP：script-src 'self'。
   注意：这里的更新检查只做「静默检查」，绝不自动刷新页面，避免 iOS 上出现刷新死循环；
   新版本由 Service Worker 自身接管，页面侧会收到提示（见 app.js 的 toast 处理）。 */
(function () {
  /* 主样式表先用 media="print" 低优先级加载（首屏由内联关键样式撑住，不阻塞首帧），
     加载完成后再切换为正式生效。这里用脚本切换而不是内联 onload——
     内联属性会被严格 CSP（script-src-attr）拦下，样式就永远不生效了 */
  var css = document.getElementById('appCss');
  if (css) {
    var applyCss = function () { try { css.media = 'all'; } catch (e) {} };
    if (css.sheet) applyCss();
    else css.addEventListener('load', applyCss);
  }

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
