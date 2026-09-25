/* 提前应用主题，避免深色模式下的白屏闪动。
   单独成文件（而不是内联脚本），这样页面可以启用严格 CSP：script-src 'self' */
(function () {
  try {
    var t = localStorage.getItem("zzx.theme") || "auto";
    document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
