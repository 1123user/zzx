  /* ================= 27 届三件套（2026-11-25 接入） =================
     关键词汇总 444 / 核心背诵包 271+33 / 时政线 58，数据在 js/data/{kw,bsx,xcline}.js，
     由 tools/build_xdf3.py 从三份中心自研 PDF 生成（源在 20261009204802/data）。
     背诵中心（ZZX_BS 92 条）保持不动：这三块是并列新栏目，不混进背诵清单。 */
  var KW_FILES = ["js/data/kw.js?v=44"];
  var BSX_FILES = ["js/data/bsx.js?v=44"];
  var XCLN_FILES = ["js/data/xcline.js?v=44"];
  var kwSt = { bk: "全部", q: "", mask: false, undone: false, done: {} };
  var bsxSt = { tab: "obj", bk: "全部" };
  var xcSt = { part: "全部", q: "" };
  try { kwSt.done = JSON.parse(localStorage.getItem("zzx.kw.done") || "{}") || {}; } catch (e) { kwSt.done = {}; }
  try { kwSt.mask = localStorage.getItem("zzx.kw.mask") === "1"; } catch (e) { kwSt.mask = false; }
  function kwSaveDone() { try { localStorage.setItem("zzx.kw.done", JSON.stringify(kwSt.done)); } catch (e) {} }
  function kwSaveMask() { try { localStorage.setItem("zzx.kw.mask", kwSt.mask ? "1" : "0"); } catch (e) {} }

  /* 「标志 / 首要 / 本质：解释」拆成术语 + 内容；不带冒号就整句当内容 */
  function xdfSplit(s) {
    var m = String(s || "").match(/^([^：:]{2,30})[：:]([\s\S]{2,})$/);
    return m ? { k: m[1], t: m[2] } : { k: "", t: String(s || "") };
  }
  function xdfTable(t) {
    var h = '<div class="xdf-tw"><table><thead><tr>';
    (t.head || []).forEach(function (x) { h += "<th>" + esc(x) + "</th>"; });
    h += "</tr></thead><tbody>";
    (t.rows || []).forEach(function (r) {
      h += "<tr>" + (r || []).map(function (c) { return "<td>" + esc(c) + "</td>"; }).join("") + "</tr>";
    });
    return h + "</tbody></table></div>";
  }
  function xdfExam(ex) {
    if (!ex || !ex.stem) return "";
    var h = '<div class="xdf-ex"><div class="xdf-ex-q">' + esc(ex.stem) + "</div>";
    (ex.opts || []).forEach(function (o) {
      h += '<div class="xdf-ex-o"><i>' + esc(o.k) + "</i>" + esc(o.t) + "</div>";
    });
    h += '<div class="xdf-ex-a">答案 ' + esc(ex.ans || "见解析") + (ex.note ? " · " + esc(ex.note) : "") + "</div></div>";
    return h;
  }

  function xdfOpen(which) {
    closeSidebar();
    if (which === "kw") {
      if (window.ZZX_KW) return renderKw();
      toast("正在拉关键词…", 1200);
      return loadExtra(KW_FILES).then(function (ok) { if (!ok) { toast("数据没拉到，检查网络后重进"); return; } renderKw(); });
    }
    if (which === "bsx") {
      if (window.ZZX_BSX) return renderBsx();
      toast("正在拉背诵包…", 1200);
      return loadExtra(BSX_FILES).then(function (ok) { if (!ok) { toast("数据没拉到，检查网络后重进"); return; } renderBsx(); });
    }
    if (window.ZZX_XCLINE) return renderXcline();
    toast("正在拉时政线…", 1200);
    return loadExtra(XCLN_FILES).then(function (ok) { if (!ok) { toast("数据没拉到，检查网络后重进"); return; } renderXcline(); });
  }

  /* ---------------- 关键词汇总 ---------------- */
  function kwMatch(it, q) { return !q || (it.k + " " + it.t).toLowerCase().indexOf(q) >= 0; }
  function renderKw() {
    var D = window.ZZX_KW, v = $("viewKw");
    if (!D || !D.boards) {
      v.innerHTML = '<div class="wrap"><div class="empty">关键词数据未加载<br>请检查网络后重进</div></div>';
      show("viewKw"); return;
    }
    var q = kwSt.q.trim().toLowerCase(), total = D.meta.total, doneN = Object.keys(kwSt.done).length;
    var h = '<div class="wrap">';
    h += '<div class="crumb"><span>27 届三件套</span><span>·</span><span>' + esc(D.meta.src) + "</span></div>";
    h += '<div class="hero-mini"><h1>一个考点<em>一句话</em></h1><p>五板块 ' + total +
      " 条：术语在前、解释在后，选择题就靠这句。「遮挡自测」把术语盖住，能说出后半句再打勾；史纲专题表照原文保留，左右滑动看。</p></div>";
    h += '<div class="bs-tabs"><button type="button" class="bs-tab' + (kwSt.bk === "全部" ? " on" : "") +
      '" data-kwb="全部">全部<em>' + total + " 条</em></button>";
    D.boards.forEach(function (b) {
      var n = 0; b.chapters.forEach(function (c) { n += (c.items || []).length; });
      h += '<button type="button" class="bs-tab' + (kwSt.bk === b.bk ? " on" : "") + '" data-kwb="' + esc(b.bk) + '">' +
        esc(b.bk) + "<em>" + n + " 条</em></button>";
    });
    h += "</div>";
    h += '<div class="bs-filters"><input id="kwQ" class="xdf-q" type="search" placeholder="搜考点，如 首要 / 长征 / 全过程人民民主" value="' + esc(kwSt.q) + '">' +
      '<button type="button" class="chip' + (kwSt.mask ? " on" : "") + '" data-kwmask="1">' + (kwSt.mask ? "术语已遮" : "遮挡自测") + "</button>" +
      '<button type="button" class="chip' + (kwSt.undone ? " on" : "") + '" data-kwundone="1">只看未掌握</button>' +
      '<span class="xdf-cnt" id="kwDoneN">已掌握 ' + doneN + " / " + total + "</span></div>";

    var shown = 0;
    D.boards.forEach(function (b) {
      if (kwSt.bk !== "全部" && kwSt.bk !== b.bk) return;
      var chs = [];
      b.chapters.forEach(function (c) {
        var its = (c.items || []).filter(function (it) {
          if (kwSt.undone && kwSt.done[b.bk + "|" + c.t + "|" + it.n]) return false;
          return kwMatch(it, q);
        });
        var tbs = (c.tables || []).filter(function (t) { return !q || JSON.stringify(t).toLowerCase().indexOf(q) >= 0; });
        if (its.length || tbs.length) chs.push({ c: c, its: its, tbs: tbs });
      });
      if (!chs.length) return;
      h += '<div class="xdf-board">' + esc(b.bk) + "</div>";
      chs.forEach(function (x) {
        var c = x.c;
        h += '<details class="bs-group xdf-ch" open><summary class="xdf-ch-t"><span>' + esc(c.t) + "</span><i>" +
          x.its.length + " 条" + (x.tbs.length ? " · " + x.tbs.length + " 表" : "") + "</i></summary>";
        x.its.forEach(function (it) {
          var id = b.bk + "|" + c.t + "|" + it.n, on = !!kwSt.done[id];
          shown++;
          h += '<div class="xdf-it' + (on ? " is-done" : "") + '"><span class="xdf-no">' + it.n + '</span><div class="xdf-body">' +
            (it.k ? '<b class="xdf-k' + (kwSt.mask ? " is-mask" : "") + '" data-kwshow="1">' + esc(it.k) + "</b>" : "") +
            '<span class="xdf-t">' + esc(it.t) + "</span></div>" +
            '<button type="button" class="xdf-ok" data-kwdone="' + esc(id) + '" aria-label="标记已掌握">' + (on ? "✓" : "") + "</button></div>";
        });
        x.tbs.forEach(function (t) { h += '<div class="xdf-tb-t">' + esc(t.t) + "</div>" + xdfTable(t); });
        h += "</details>";
      });
    });
    if (!shown && h.indexOf('class="xdf-tw') < 0) h += '<div class="empty">没有匹配的考点，换个词试试</div>';
    h += '<div class="home-foot">来源：' + esc(D.meta.src) + " · " + total +
      " 条按章归位；打勾「已掌握」只存本机，不影响背诵中心。</div></div>";
    v.innerHTML = h;
    show("viewKw");
    $("topTitle").textContent = "关键词汇总";
    $("topSub").textContent = total + " 条 · 已掌握 " + doneN;
    $("progressStrip").hidden = true;
    $("actionbar").hidden = true;
    var qEl = $("kwQ");
    if (qEl) {
      qEl.addEventListener("input", function () {
        clearTimeout(qEl._t);
        var val = qEl.value;
        qEl._t = setTimeout(function () {
          kwSt.q = val;
          var sc = v.scrollTop;
          renderKw();
          v.scrollTop = sc;
          var e2 = $("kwQ");
          if (e2) { e2.focus(); try { e2.setSelectionRange(e2.value.length, e2.value.length); } catch (e) {} }
        }, 240);
      });
    }
  }

  /* ---------------- 核心背诵包 ---------------- */
  function renderBsx() {
    var D = window.ZZX_BSX, v = $("viewBsx");
    if (!D || !D.obj) {
      v.innerHTML = '<div class="wrap"><div class="empty">背诵包数据未加载<br>请检查网络后重进</div></div>';
      show("viewBsx"); return;
    }
    var isObj = bsxSt.tab === "obj";
    var list = isObj ? D.obj : D.subj;
    var h = '<div class="wrap">';
    h += '<div class="crumb"><span>27 届三件套</span><span>·</span><span>' + esc(D.meta.src) + "</span></div>";
    h += '<div class="hero-mini"><h1>' + (isObj ? "客观题 <em>271 条</em>" : "主观题 <em>33 个热点</em>") + "</h1><p>" +
      (isObj ? "「标志 / 首要 / 本质 / 根本」一句话考点，遮住后半句自问；错句回关键词汇总查同章。"
             : "每个热点按设问拆开：先只看设问自己说 30 秒，再展开答题思路与要点（" + D.meta.asks + " 问）。") + "</p></div>";
    h += '<div class="bs-tabs"><button type="button" class="bs-tab' + (isObj ? " on" : "") + '" data-bsxtab="obj">客观题<em>' +
      D.meta.obj + ' 条</em></button><button type="button" class="bs-tab' + (!isObj ? " on" : "") +
      '" data-bsxtab="subj">主观题<em>' + D.meta.topics + " 热点</em></button></div>";
    h += '<div class="bs-filters"><button type="button" class="chip' + (bsxSt.bk === "全部" ? " on" : "") +
      '" data-bsxb="全部">全部板块</button>' + list.map(function (b) {
        return '<button type="button" class="chip' + (bsxSt.bk === b.bk ? " on" : "") + '" data-bsxb="' + esc(b.bk) + '">' +
          esc(b.bk.replace(/重要考点预测|考点预测/g, "")) + "</button>";
      }).join("") + "</div>";

    var shown = 0;
    if (isObj) {
      D.obj.forEach(function (b) {
        if (bsxSt.bk !== "全部" && bsxSt.bk !== b.bk) return;
        h += '<div class="xdf-board">' + esc(b.bk) + "</div>";
        b.items.forEach(function (it) {
          var kv = xdfSplit(it.t);
          shown++;
          h += '<div class="xdf-it"><span class="xdf-no">' + it.n + '</span><div class="xdf-body">' +
            (it.sec ? '<span class="xdf-sec">' + esc(it.sec) + "</span>" : "") +
            (kv.k ? '<b class="xdf-k">' + esc(kv.k) + "</b>" : "") +
            '<span class="xdf-t">' + esc(kv.t) + "</span></div></div>";
        });
      });
    } else {
      D.subj.forEach(function (b) {
        if (bsxSt.bk !== "全部" && bsxSt.bk !== b.bk) return;
        h += '<div class="xdf-board">' + esc(b.bk) + "</div>";
        (b.topics || []).forEach(function (t) {
          shown++;
          var its = t.items || [];
          h += '<details class="bs-group xdf-ch"><summary class="xdf-ch-t"><span>' + t.n + ". " + esc(t.t) +
            "</span><i>" + its.length + " 问</i></summary><div class=\"xdf-topic\">";
          if (t.lead) h += '<div class="xdf-lead">' + esc(t.lead).replace(/\n/g, "<br>") + "</div>";
          if (t.clue) h += '<div class="xdf-clue">答题线索：' + esc(t.clue).replace(/\n/g, "、") + "</div>";
          its.forEach(function (it, i) {
            h += '<div class="xdf-ask">' + (its.length > 1 ? "<i>第 " + (i + 1) + " 问</i>" : "") +
              "<b>设问</b>" + esc(it.q) + "</div>";
            if (it.clue) h += '<div class="xdf-clue">线索：' + esc(it.clue).replace(/\n/g, "、") + "</div>";
            if (it.idea) h += '<div class="xdf-idea">思路：' + esc(it.idea).replace(/\n/g, "<br>") + "</div>";
            if (it.points) h += '<div class="xdf-pts">' + esc(it.points).replace(/\n/g, "<br>") + "</div>";
          });
          h += "</div></details>";
        });
      });
    }
    if (!shown) h += '<div class="empty">这个板块下没有条目</div>';
    h += '<div class="home-foot">来源：' + esc(D.meta.src) + " · 客观 " + D.meta.obj + " 条 / 主观 " +
      D.meta.topics + " 热点 " + D.meta.asks + " 问；背诵中心仍是原来 92 条，不受影响。</div></div>";
    v.innerHTML = h;
    show("viewBsx");
    $("topTitle").textContent = "核心背诵包";
    $("topSub").textContent = "客观 " + D.meta.obj + " 条 · 主观 " + D.meta.topics + " 热点";
    $("progressStrip").hidden = true;
    $("actionbar").hidden = true;
  }

  /* ---------------- 时政线 ---------------- */
  function xcParts(D) {
    var seen = {}, out = [];
    (D.news || []).forEach(function (n) { if (!seen[n.part]) { seen[n.part] = 1; out.push(n.part); } });
    return out;
  }
  function renderXcline() {
    var D = window.ZZX_XCLINE, v = $("viewXcline");
    if (!D || !D.news) {
      v.innerHTML = '<div class="wrap"><div class="empty">时政数据未加载<br>请检查网络后重进</div></div>';
      show("viewXcline"); return;
    }
    var q = xcSt.q.trim().toLowerCase();
    var h = '<div class="wrap">';
    h += '<div class="crumb"><span>27 届三件套</span><span>·</span><span>' + esc(D.meta.src) + "</span></div>";
    h += '<div class="hero-mini"><h1>考什么、怎么答、<em>都发生了什么</em></h1><p>客观题基础 + 近年命题特点 + 分析题救命模板与 ' +
      D.meta.principles + " 个常考原理 + 1—11 月时政 " + D.meta.news + " 条（带原文与例题）。</p></div>";

    h += '<details class="xdf-fold"><summary>客观题基础 · ' + (D.basics.length + D.terms.length + D.situation.length) +
      ' 条术语</summary><div class="xdf-fold-b">';
    [["基础概念", D.basics], ["易混术语", D.terms], ["形势判断", D.situation]].forEach(function (g) {
      if (!g[1] || !g[1].length) return;
      h += '<div class="xdf-sub">' + g[0] + "</div>";
      g[1].forEach(function (x) { h += '<div class="xdf-it"><div class="xdf-body"><b class="xdf-k">' + esc(x.k) + '</b><span class="xdf-t">' + esc(x.t) + "</span></div></div>"; });
    });
    h += "</div></details>";

    h += '<details class="xdf-fold"><summary>分析题模板 ' + D.templates.length + " 个 · 常考原理 " + D.principles.length +
      ' 个</summary><div class="xdf-fold-b">';
    D.templates.forEach(function (t) { h += '<div class="xdf-ask"><b>模板</b>' + esc(t.t) + "</div><div class=\"xdf-pts\">" + esc(t.d) + "</div>"; });
    D.principles.forEach(function (p) {
      h += '<div class="xdf-sub">' + esc(p.t) + "</div>";
      (p.blocks || []).forEach(function (b) {
        h += '<div class="xdf-idea">' + esc(b.h || "") + "</div><div class=\"xdf-pts\">" + esc(b.d || "").replace(/\n/g, "<br>") + "</div>";
      });
    });
    h += "</div></details>";

    var tipN = (D.tips.single || []).length + (D.tips.multi || []).length;
    h += '<details class="xdf-fold"><summary>真题例证 ' + tipN + ' 道（单选 ' + D.tips.single.length + " / 多选 " + D.tips.multi.length +
      '）</summary><div class="xdf-fold-b">';
    [["single", "单选"], ["multi", "多选"]].forEach(function (g) {
      (D.tips[g[0]] || []).forEach(function (x) {
        h += '<div class="xdf-tip"><div class="xdf-tip-y">' + esc(x.y) + " · " + g[1] + "</div>" +
          '<div class="xdf-ex-q">' + esc(x.stem) + "</div>" +
          (x.opts || []).map(function (o) { return '<div class="xdf-ex-o"><i>' + esc(o.k) + "</i>" + esc(o.t) + "</div>"; }).join("") +
          '<div class="xdf-ex-a">答案 ' + esc(x.ans || "见解析") + (x.note ? " · " + esc(x.note) : "") + "</div></div>";
      });
    });
    h += "</div></details>";

    h += '<div class="sec-title">1—11 月时政 · ' + D.meta.news + " 条</div>";
    h += '<div class="bs-filters"><input id="xcQ" class="xdf-q" type="search" placeholder="搜事件 / 会议 / 文件，如 上合 / 十五五" value="' +
      esc(xcSt.q) + '">' + ["全部"].concat(xcParts(D)).map(function (p) {
        return '<button type="button" class="chip' + (xcSt.part === p ? " on" : "") + '" data-xcpart="' + esc(p) + '">' +
          esc(p.replace("时政", "")) + "</button>";
      }).join("") + "</div>";

    var shown = 0;
    (D.news || []).forEach(function (n) {
      if (xcSt.part !== "全部" && n.part !== xcSt.part) return;
      if (q && (n.title + " " + n.body + " " + (n.ex ? n.ex.stem : "")).toLowerCase().indexOf(q) < 0) return;
      shown++;
      var title = String(n.title || "").replace(/（\d{1,2}\s*月[^）]*）/g, "");
      h += '<details class="xdf-news"><summary><span class="xdf-date">' + esc(n.date) + (n.stars ? " · ☆" : "") +
        "</span><b>" + esc(title) + "</b>" + (n.ex ? '<i class="xdf-hasex">例</i>' : "") + "</summary>" +
        '<div class="xdf-nb"><p>' + esc(n.body) + "</p>" + xdfExam(n.ex) + "</div></details>";
    });
    if (!shown) h += '<div class="empty">没有匹配的时政条目</div>';
    h += '<div class="home-foot">来源：' + esc(D.meta.src) + " · 时政 " + D.meta.news + " 条 / 真题例证 " + tipN +
      " 道；原文例句只在手机上背，不替代背诵中心。</div></div>";
    v.innerHTML = h;
    show("viewXcline");
    $("topTitle").textContent = "时政线";
    $("topSub").textContent = D.meta.news + " 条时政 · " + tipN + " 道例证";
    $("progressStrip").hidden = true;
    $("actionbar").hidden = true;
    var qEl = $("xcQ");
    if (qEl) {
      qEl.addEventListener("input", function () {
        clearTimeout(qEl._t);
        var val = qEl.value;
        qEl._t = setTimeout(function () {
          xcSt.q = val;
          var sc = v.scrollTop;
          renderXcline();
          v.scrollTop = sc;
          var e2 = $("xcQ");
          if (e2) { e2.focus(); try { e2.setSelectionRange(e2.value.length, e2.value.length); } catch (e) {} }
        }, 240);
      });
    }
  }

  /* 三块视图的事件委托（放在 IIFE 里，DOM 就绪后 document 一定存在） */
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var b;
    if ((b = t.closest("[data-xdf]"))) { xdfOpen(b.getAttribute("data-xdf")); return; }
    if ((b = t.closest("[data-kwshow]"))) {
      if (b.classList.contains("is-mask")) { e.stopPropagation(); b.classList.remove("is-mask"); return; }
    }
    if ((b = t.closest("[data-kwb]"))) { kwSt.bk = b.getAttribute("data-kwb"); renderKw(); return; }
    if ((b = t.closest("[data-kwmask]"))) { kwSt.mask = !kwSt.mask; kwSaveMask(); renderKw(); return; }
    if ((b = t.closest("[data-kwundone]"))) { kwSt.undone = !kwSt.undone; renderKw(); return; }
    if ((b = t.closest("[data-kwdone]"))) {
      var id = b.getAttribute("data-kwdone");
      if (kwSt.done[id]) delete kwSt.done[id]; else kwSt.done[id] = 1;
      kwSaveDone();
      b.textContent = kwSt.done[id] ? "✓" : "";
      if (b.parentNode) b.parentNode.classList.toggle("is-done", !!kwSt.done[id]);
      var cnt = $("kwDoneN"), meta = (window.ZZX_KW || {}).meta || { total: 0 };
      if (cnt) cnt.textContent = "已掌握 " + Object.keys(kwSt.done).length + " / " + meta.total;
      return;
    }
    if ((b = t.closest("[data-bsxtab]"))) { bsxSt.tab = b.getAttribute("data-bsxtab") === "subj" ? "subj" : "obj"; bsxSt.bk = "全部"; renderBsx(); return; }
    if ((b = t.closest("[data-bsxb]"))) { bsxSt.bk = b.getAttribute("data-bsxb"); renderBsx(); return; }
    if ((b = t.closest("[data-xcpart]"))) { xcSt.part = b.getAttribute("data-xcpart"); renderXcline(); return; }
  });

  function xdfBindSide() {
    if ($("kwBtn") && !$("kwBtn")._xdf) { $("kwBtn")._xdf = 1; $("kwBtn").onclick = function () { xdfOpen("kw"); }; }
    if ($("bsxBtn") && !$("bsxBtn")._xdf) { $("bsxBtn")._xdf = 1; $("bsxBtn").onclick = function () { xdfOpen("bsx"); }; }
    if ($("xclnBtn") && !$("xclnBtn")._xdf) { $("xclnBtn")._xdf = 1; $("xclnBtn").onclick = function () { xdfOpen("xcln"); }; }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", xdfBindSide);
  else xdfBindSide();
