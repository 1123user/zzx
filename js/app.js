/* ============================================================
   政治线 · 考研政治五大板块
   事件（发生了什么）→ 会议（党决定了什么）→ 文献（党说了什么）
   ============================================================ */
(function () {
  "use strict";

  var BOARDS = [
    { id: "sg", name: "中国近现代史纲要", short: "史纲", badge: "时间线",
      files: ["js/data/sg.js", "js/data/sgdoc.js"], color: "var(--c-sg)",
      desc: "时间—事件—背景—内容经过—意义影响" },
    { id: "mao", name: "毛泽东思想和中国特色社会主义理论体系概论", short: "毛中特", badge: "脉络",
      files: ["js/data/mao.js"], color: "var(--c-mao)",
      desc: "时间—理论形成—核心内容—历史地位" },
    { id: "my", name: "马克思主义基本原理", short: "马原", badge: "知识树",
      file: "js/data/my.js", color: "var(--c-my)",
      desc: "哲学／政治经济学／科学社会主义" },
    { id: "sf", name: "思想道德与法治", short: "思修法治", badge: "主题",
      file: "js/data/sf.js", color: "var(--c-sf)",
      desc: "主题分类与案例对照" },
    { id: "xc", name: "形势与政策及当代世界经济与政治", short: "形策", badge: "年度清单",
      file: "js/data/xc.js", color: "var(--c-xc)",
      desc: "国内大事与国际热点两条线" }
  ];

  var KINDS = [
    { v: "", label: "全部" },
    { v: "event", label: "事件" },
    { v: "meeting", label: "会议" },
    { v: "doc", label: "文献" },
    { v: "theory", label: "理论" },
    { v: "principle", label: "原理" },
    { v: "topic", label: "专题" }
  ];
  var KIND_LABEL = { event: "事件", meeting: "会议", doc: "文献", theory: "理论", principle: "原理", topic: "专题" };

  var STORE_KEY = "zzx.progress.v1";
  var THEME_KEY = "zzx.theme";
  var IMG_KEY = "zzx.img";
  var THEMES = [{ v: "auto", label: "跟随系统" }, { v: "light", label: "浅色" }, { v: "dark", label: "深色" }];

  var state = {
    boardId: null, unitId: null, kind: "", index: 0, page: 0, done: {},
    imgMode: localStorage.getItem(IMG_KEY) || "on"
  };
  var progress = loadProgress();
  var searchHits = [];
  var searchKind = "";
  var quiz = { list: [], i: 0, right: 0, answered: false, seed: 0, picked: [], filter: "all", label: "" };
  var caseIndex = null;

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  /* 整十/整五/整百周年数字红色高亮：匹配 "XX周年" 或 "XX 周年"，数字能被 5 整除即高亮 */
  function hl(s) {
    return String(s == null ? "" : s).replace(/(\d+)\s*周年/g, function (m, n) {
      var num = parseInt(n, 10);
      if (num && num % 5 === 0) return '<span class="anniv">' + m + "</span>";
      return m;
    });
  }
  function boardAnnivs(id) {
    var d = getBoard(id); if (!d) return [];
    return (d.items || []).filter(function (it) { return it.anniv; });
  }
  var dom = {};

  function loadProgress() {
    try { var r = localStorage.getItem(STORE_KEY); return r ? JSON.parse(r) : {}; }
    catch (e) { return {}; }
  }
  function saveProgress() { try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) {} }
  function subProgress(id) {
    if (!progress[id]) progress[id] = { done: {}, current: null };
    if (!progress[id].done) progress[id].done = {};
    return progress[id];
  }
  function doneCount(bid) {
    var p = progress[bid];
    return p && p.done ? Object.keys(p.done).length : 0;
  }
  /* 位置记忆：记录每个板块最后浏览到的考点与分页，下次进入自动定位 */
  function savePos(bid, id, page) {
    if (!bid || !id) return;
    var p = subProgress(bid);
    p.current = id;
    p.page = page || 0;
    saveProgress();
  }
  function restoreIndex(bid) {
    var p = progress[bid], list = filteredItems();
    state.page = 0;
    if (!p || !p.current) return 0;
    for (var k = 0; k < list.length; k++) {
      if (list[k].id === p.current) { state.page = p.page || 0; return k; }
    }
    return 0;
  }

  /* ---------------- 数据 ---------------- */
  function getBoard(id) { return (window.ZZX || {})[id] || null; }
  function loadScript(src) {
    return new Promise(function (res) {
      var sc = document.createElement("script");
      sc.src = src; sc.onload = function () { res(true); };
      sc.onerror = function () { res(false); };
      document.head.appendChild(sc);
    });
  }
  function loadBoard(id) {
    var c = getBoard(id);
    if (c) return Promise.resolve(c);
    var meta = BOARDS.filter(function (b) { return b.id === id; })[0];
    var files = meta.files || [meta.file];
    var chain = Promise.resolve();
    files.forEach(function (f) { chain = chain.then(function () { return loadScript(f); }); });
    return chain.then(function () {
      var d = getBoard(id);
      if (d && d._more) { d.items = d.items.concat(d._more); delete d._more; }
      return d;
    });
  }
  function loadAll() { return Promise.all(BOARDS.map(function (b) { return loadBoard(b.id); })); }

  function allItems() {
    var out = [];
    BOARDS.forEach(function (b) {
      var d = getBoard(b.id); if (!d) return;
      (d.items || []).forEach(function (it) { it._b = b.id; out.push(it); });
    });
    return out;
  }
  function indexAll() {
    allItems().forEach(function (it) {
      if (it._idx) return;
      var buf = [it.title, it.sub || "", it.ym || "", it.dateLabel || "", (it.tags || []).join(" ")];
      (it.pages || []).forEach(function (pg) {
        buf.push(pg.label || "");
        (pg.blocks || []).forEach(function (b) {
          if (typeof b.v === "string") buf.push(b.v);
          else if (b.v && b.v.length) {
            b.v.forEach(function (x) {
              if (typeof x === "string") buf.push(x);
              else if (x && x.length) buf.push(x.filter(Boolean).join(" "));
            });
          }
          if (b.cap) buf.push(b.cap);
          if (b.k) buf.push(b.k);
        });
      });
      if (it.imgCap) buf.push(it.imgCap);
      it._idx = buf.join(" \u0001 ").toLowerCase();
    });
    if (!caseIndex) {
      caseIndex = [];
      allItems().forEach(function (it) {
        if (it.case && it.case.q) {
          caseIndex.push({ it: it, c: { q: it.case.q, a: it.case.a, kw: it.case.kw || [] } });
        }
        (it.pages || []).forEach(function (pg) {
          (pg.blocks || []).forEach(function (b) {
            if (b.t === "case" && b.q) caseIndex.push({ it: it, c: { q: b.q, a: b.a, kw: [] } });
          });
        });
      });
    }
  }
  function findItem(id) {
    var r = null;
    allItems().forEach(function (it) { if (it.id === id) r = it; });
    return r;
  }
  function boardOf(item) { return BOARDS.filter(function (b) { return b.id === item._b; })[0] || BOARDS[0]; }

  /* ---------------- 主题 / 图片 ---------------- */
  function applyTheme() {
    var t = localStorage.getItem(THEME_KEY) || "auto";
    document.documentElement.setAttribute("data-theme", t);
    var cur = THEMES.filter(function (x) { return x.v === t; })[0] || THEMES[0];
    $("themeBtn").textContent = "外观：" + cur.label;
    var sb = dom.sidebar;
    if (sb) sb.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue("--bg-elevated").trim();
  }
  function cycleTheme() {
    var t = localStorage.getItem(THEME_KEY) || "auto";
    var i = THEMES.map(function (x) { return x.v; }).indexOf(t);
    var n = THEMES[(i + 1) % THEMES.length].v;
    localStorage.setItem(THEME_KEY, n); applyTheme();
  }
  function syncImgBtn() { $("imgBtn").textContent = "图片：" + (state.imgMode === "on" ? "显示" : "隐藏"); }

  var toastTimer = null;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    requestAnimationFrame(function () { t.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove("show"); setTimeout(function () { t.hidden = true; }, 260);
    }, 1700);
  }
  function openSidebar() { dom.sidebar.classList.add("open"); dom.scrim.hidden = false; requestAnimationFrame(function () { dom.scrim.classList.add("show"); }); }
  function closeSidebar() { dom.sidebar.classList.remove("open"); dom.scrim.classList.remove("show"); setTimeout(function () { dom.scrim.hidden = true; }, 260); }

  function show(view) {
    ["viewHome", "viewStudy", "viewQuiz", "viewLine", "viewCase", "viewEssay"].forEach(function (v) { $(v).hidden = true; });
    $(view).hidden = false;
  }

  /* ---------------- 侧边栏 ---------------- */
  function renderSidebar() {
    $("subjectNav").innerHTML = BOARDS.map(function (b) {
      var d = getBoard(b.id);
      var total = d ? (d.items || []).length : 0;
      return '<button type="button" class="subject-item' + (state.boardId === b.id ? " active" : "") +
        '" data-board="' + b.id + '" style="--dot:' + b.color + '">' +
        '<span class="dot"></span><span class="name">' + esc(b.short) + "</span>" +
        '<span class="count">' + doneCount(b.id) + "/" + total + "</span></button>";
    }).join("");

    $("kindFilter").innerHTML = KINDS.map(function (k) {
      return '<button type="button" class="chip' + (state.kind === k.v ? " on" : "") + '" data-kind="' + k.v + '">' + k.label + "</button>";
    }).join("");

    var d = state.boardId ? getBoard(state.boardId) : null;
    if (d && d.units && d.units.length) {
      $("moduleBlock").hidden = false;
      $("moduleLabel").textContent = BOARDS.filter(function (b) { return b.id === state.boardId; })[0].short + " · 单元";
      $("moduleList").innerHTML = (state.kind ? "" : "") + d.units.map(function (u) {
        var n = (d.items || []).filter(function (it) { return it.unit === u[0]; }).length;
        var p = progress[state.boardId] || { done: {} };
        var dn = (d.items || []).filter(function (it) { return it.unit === u[0] && p.done && p.done[it.id]; }).length;
        return '<button type="button" class="module-item' + (state.unitId === u[0] ? " active" : "") +
          '" data-unit="' + u[0] + '"><span>' + esc(u[2]) + '</span><span class="mc">' + dn + "/" + n + "</span></button>";
      }).join("");
    } else { $("moduleBlock").hidden = true; }

    var tot = 0, dn = 0;
    BOARDS.forEach(function (b) { var d2 = getBoard(b.id); if (d2) tot += d2.items.length; dn += doneCount(b.id); });
    $("planBody").innerHTML =
      '<div class="anchor-card" style="box-shadow:none;padding:12px">' +
      '<h4>全程进度 ' + dn + " / " + tot + "</h4>" +
      '<div class="bar" style="height:5px;border-radius:5px;background:var(--line);overflow:hidden;margin:8px 0 6px">' +
      '<i style="display:block;height:100%;width:' + (tot ? Math.round(dn / tot * 100) : 0) + '%;background:var(--accent);border-radius:5px"></i></div>' +
      '<p style="font-size:12px;color:var(--fg-3);margin:0">' + (dn ? "继续保持，逐条过一遍即通关。" : "点开任一板块，从第一条开始。") + "</p></div>";
    $("quizTotal").textContent = quizAll().length + " 题";
  }

  /* ---------------- 首页 ---------------- */
  function renderHome() {
    var tot = 0, dn = 0;
    BOARDS.forEach(function (b) {
      var d = getBoard(b.id); if (!d) return;
      tot += d.items.length; dn += doneCount(b.id);
    });
    var h = '<div class="wrap">';
    h += '<div class="hero"><h1>把考点连成<em>一条线</em></h1>' +
      '<p>依据《2027 年考研政治考试大纲》梳理 · 马原 / 毛中特 / 史纲 / 思修法治 / 形策</p>' +
      '<div class="hero-stats">' +
      "<div><b>" + tot + "</b><span>考点</span></div>" +
      "<div><b>" + quizAll().length + "</b><span>自测题</span></div>" +
      "</div></div>";

    h += '<div class="sec-title">五大板块</div><div class="cards">';
    h += BOARDS.map(function (b) {
      var d = getBoard(b.id); if (!d) return "";
      var p = progress[b.id] || { done: {} };
      var n = p.done ? Object.keys(p.done).length : 0;
      var total = d.items.length;
      var pct = total ? Math.round(n / total * 100) : 0;
      var annTag = boardAnnivs(b.id).length ? '<span class="bdg bdg-anniv">本年度整周年重点</span>' : "";
      return '<button type="button" class="card" data-open="' + b.id + '" style="--cc:' + b.color + '">' +
        '<div class="card-top"><b>' + esc(b.name) + '</b><span class="bdg">' + b.badge + '</span>' + annTag + '</div>' +
        "<p>" + esc(b.desc) + "</p>" +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="mrow"><span>' + total + " 个考点</span><span>" + n + " 已学 · " + pct + "%</span></div></button>";
    }).join("");
    h += "</div>";

    h += "</div>";
    $("viewHome").innerHTML = h;
    $("topTitle").textContent = "政治线";
    $("topSub").textContent = "五大板块 · 依据 2027 年考试大纲";
    $("progressStrip").hidden = true;
    $("actionbar").hidden = true;
  }

  /* ---------------- 学习视图 ---------------- */
  function filteredItems() {
    var d = state.boardId ? getBoard(state.boardId) : null;
    if (!d) return [];
    return (d.items || []).filter(function (it) {
      if (state.kind && it.kind !== state.kind) return false;
      if (state.unitId && it.unit !== state.unitId) return false;
      return true;
    });
  }
  function curItem() { return filteredItems()[state.index] || null; }

  /* ---------------- 图片预加载 ---------------- */
  var preloaded = {};
  var idleRun = window.requestIdleCallback
    ? function (fn) { window.requestIdleCallback(fn, { timeout: 1500 }); }
    : function (fn) { setTimeout(fn, 240); };

  function imgSrcsOf(it) {
    if (!it) return [];
    var out = [];
    if (it.img) out.push(it.img);
    (it.pages || []).forEach(function (pg) {
      (pg.blocks || []).forEach(function (b) {
        if (b && b.t === "fig" && b.v) out.push(b.v);
      });
    });
    return out;
  }
  function preload(src) {
    if (state.imgMode !== "on" || !src || preloaded[src]) return;
    var im = new Image();
    im.decoding = "async";
    try { im.fetchPriority = "low"; } catch (e) {}
    im.src = src;
    preloaded[src] = im; // 持有引用，避免被回收导致请求中断
    if (typeof im.decode === "function") im.decode().catch(function () {});
  }
  function preloadItem(it) { imgSrcsOf(it).forEach(preload); }
  /* 下一条（最高优先级）→ 本条下一页 → 空闲时再预取往后两条与上一条 */
  function preloadAround() {
    if (state.imgMode !== "on") return;
    var list = filteredItems();
    var it = list[state.index];
    if (!it) return;
    preloadItem(list[state.index + 1]);
    var pg = (it.pages || [])[state.page + 1];
    if (pg) (pg.blocks || []).forEach(function (b) { if (b && b.t === "fig") preload(b.v); });
    idleRun(function () {
      preloadItem(list[state.index + 2]);
      preloadItem(list[state.index - 1]);
      idleRun(function () { preloadItem(list[state.index + 3]); });
    });
  }
  /* 尚未就绪的图先给占位微光，加载完成后移除 */
  function markShots() {
    var imgs = $("viewStudy").querySelectorAll("img.shot");
    for (var i = 0; i < imgs.length; i++) {
      (function (im) {
        if (im.complete && im.naturalWidth) return;
        im.classList.add("is-pending");
        im.addEventListener("load", function () { im.classList.remove("is-pending"); });
        im.addEventListener("error", function () { im.classList.remove("is-pending"); });
      })(imgs[i]);
    }
  }

  /* ---------------- 进度条：刻度可点击 + 自动定位当前 ---------------- */
  var navSmooth = false; // true 用平滑滚动；跳转/恢复位置时直接定位
  function pstripTrack() {
    var t = $("pstripTrack");
    if (!t) { // 兼容未更新的 HTML 缓存
      t = document.createElement("div");
      t.id = "pstripTrack"; t.className = "pstrip-track";
      t.setAttribute("role", "tablist");
      $("progressStrip").appendChild(t);
    }
    return t;
  }
  function centerPseg() {
    var track = pstripTrack();
    var cur = track.querySelector(".pseg.is-current");
    if (!cur) return;
    var max = Math.max(0, track.scrollWidth - track.clientWidth);
    var target = cur.offsetLeft - (track.clientWidth - cur.offsetWidth) / 2;
    target = Math.min(max, Math.max(0, Math.round(target)));
    if (!navSmooth || Math.abs(target - track.scrollLeft) < 8) { track.scrollLeft = target; return; }
    try { track.scrollTo({ left: target, behavior: "smooth" }); }
    catch (e) { track.scrollLeft = target; }
  }
  function renderPstrip(list) {
    var strip = $("progressStrip");
    if (!list.length) { strip.hidden = true; return; }
    var p = progress[state.boardId] || { done: {} };
    var done = p.done || {};
    pstripTrack().innerHTML = list.map(function (x, i) {
      var cls = "pseg";
      if (done[x.id]) cls += " is-done";
      if (i === state.index) cls += " is-current";
      return '<button type="button" class="' + cls + '" data-goto="' + i + '"' +
        (i === state.index ? ' aria-current="true"' : "") +
        ' title="' + esc((i + 1) + ". " + x.title) + '"' +
        ' aria-label="第 ' + (i + 1) + " 条：" + esc(x.title) + '"></button>';
    }).join("");
    strip.hidden = false;
    centerPseg();
    navSmooth = false;
  }

  function renderFig(b) {
    if (state.imgMode !== "on") return "";
    if (!b.v) return "";
    return '<figure class="b-fig"><img class="shot" src="' + esc(b.v) + '" alt="' + esc(b.cap || "") +
      '" loading="lazy" decoding="async" data-full="' + esc(b.v) + '" data-cap="' + esc(b.cap || "") + '">' +
      '<figcaption>' + esc(b.cap || "") + "</figcaption></figure>";
  }
  function renderBlock(b) {
    switch (b.t) {
      case "p": return '<p class="b-p">' + hl(b.v) + "</p>";
      case "core": return '<p class="b-core">' + hl(b.v) + "</p>";
      case "quote": return '<blockquote class="b-quote">' + hl(b.v) + "</blockquote>";
      case "kv": {
        var rows = (b.v || []).filter(function (r) { return r && r[1]; });
        return '<div class="b-kv">' + rows.map(function (r) {
          return '<div class="row"><div class="k">' + esc(r[0]) + '</div><div class="v">' + hl(r[1]) + "</div></div>";
        }).join("") + "</div>";
      }
      case "ul": return '<ul class="b-ul">' + (b.v || []).map(function (x) { return "<li>" + hl(x) + "</li>"; }).join("") + "</ul>";
      case "tip": return '<div class="b-tip">' + hl(b.v) + "</div>";
      case "case": return '<p class="b-p b-case"><strong>通俗案例 · ' + hl(b.q) + "</strong><br>" + hl(b.a) + "</p>";
      case "fig": return renderFig(b);
      case "meta": {
        var rs = (b.v || []).filter(function (r) { return r && r[1]; });
        return '<div class="b-meta"><div class="h">' + esc(b.title || "统一字段") + "</div>" +
          rs.map(function (r) {
            return '<div class="row"><div class="k">' + esc(r[0]) + '</div><div class="v">' + hl(r[1]) + "</div></div>";
          }).join("") + "</div>";
      }
      case "link": {
        var ls = (b.v || []).filter(Boolean);
        if (!ls.length) return "";
        return '<div class="b-link">' + ls.map(function (x) {
          var t = typeof x === "string" ? { id: x, label: "" } : x;
          var tt = findItem(t.id);
          if (!tt) return "";
          return '<button type="button" data-jump="' + esc(t.id) + '"><i>' + (KIND_LABEL[tt.kind] || "") + "</i>" +
            esc(t.label || tt.title) + "</button>";
        }).join("") + "</div>";
      }
      default: return "";
    }
  }

  function renderStudy() {
    var list = filteredItems();
    var it = list[state.index];
    if (!it) { renderHome(); return; }
    var bd = boardOf(it);
    var pi = Math.min(state.page, (it.pages || []).length - 1);
    if (pi < 0) pi = 0;
    var pg = (it.pages || [])[pi] || { blocks: [] };

    var h = '<div class="wrap">';
    h += '<div class="crumb"><span>' + esc(bd.name) + "</span>";
    var u = (getBoard(bd.id).units || []).filter(function (x) { return x[0] === it.unit; })[0];
    if (u) h += "<span>·</span><span>" + esc(u[2]) + "</span>";
    if (state.kind) h += "<span>·</span><span>" + KIND_LABEL[state.kind] + "筛选</span>";
    h += "</div>";

    var anns = boardAnnivs(bd.id);
    if (anns.length) {
      h += '<div class="anniv-banner"><strong>本年度整周年重点</strong>' +
        '<span>本科目收录 ' + anns.length + " 个整十／整五／整百周年纪念考点，周年数字已红色标注</span></div>";
    }

    h += '<div class="item-head">';
    h += '<span class="tagline k-' + it.kind + '">' + (KIND_LABEL[it.kind] || "考点") + "</span>";
    if (it.dateLabel) h += ' <span class="ym">' + esc(it.dateLabel) + "</span>";
    if (it.anniv) h += ' <span class="anniv-badge">本年度整周年重点 · ' + it.anniv + " 周年</span>";
    h += "<h2>" + hl(esc(it.title)) + "</h2>";
    if (it.sub) h += '<p class="sub">' + hl(esc(it.sub)) + "</p>";
    if (it.tags && it.tags.length) h += '<div class="item-tags">' + it.tags.map(function (t) {
      return '<button type="button" class="chip" data-tag="' + esc(t) + '">' + hl(esc(t)) + "</button>";
    }).join("") + "</div>";
    h += "</div>";

    if ((it.pages || []).length > 1) {
      h += '<div class="page-dots"><b>' + esc(pg.label || "第 " + (pi + 1) + " 页") + "</b>" +
        it.pages.map(function (_, i) {
          var cls = i === pi ? "pd on" : (i < pi ? "pd done" : "pd");
          return '<span class="' + cls + '" data-page="' + i + '">' + (i + 1) + "</span>";
        }).join("") + "</div>";
    } else if (pg.label) {
      h += '<div class="page-dots"><b>' + esc(pg.label) + "</b></div>";
    }

    if (it.img && state.imgMode === "on") {
      h += '<figure class="b-fig"><img class="shot" src="' + esc(it.img) + '" alt="' + esc(it.imgCap || "") +
        '" loading="lazy" decoding="async" data-full="' + esc(it.img) + '" data-cap="' + esc(it.imgCap || "") + '">' +
        '<figcaption>' + esc(it.imgCap || "") + "</figcaption></figure>";
    }

    h += (pg.blocks || []).map(renderBlock).join("");
    h += "</div>";

    $("viewStudy").innerHTML = h;
    show("viewStudy");
    $("viewStudy").scrollTop = 0;
    $("topTitle").textContent = it.title;
    $("topSub").textContent = bd.short + " · " + (it.dateLabel || KIND_LABEL[it.kind] || "");
    var p = subProgress(bd.id);
    savePos(bd.id, it.id, state.page);
    /* 细进度条跟随浏览位置，与刻度条上的当前刻度一致 */
    $("progressBar").style.width = (list.length ? Math.round((state.index + 1) / list.length * 100) : 0) + "%";
    $("progressText").textContent = (state.index + 1) + " / " + list.length +
      (p.done[it.id] ? " · 本条目已掌握" : "");
    renderPstrip(list);
    markShots();
    preloadAround();
    renderActionbar();
    renderSidebar();
  }

  function renderActionbar() {
    var list = filteredItems();
    var it = list[state.index]; if (!it) { $("actionbar").hidden = true; return; }
    var pages = (it.pages || []).length;
    $("actionbar").innerHTML =
      '<button class="btn" id="prevBtn" type="button"' + (state.index === 0 && state.page === 0 ? " disabled" : "") + ">上一条</button>" +
      (state.page < pages - 1
        ? '<button class="btn btn-primary" id="nextBtn" type="button">下一页 ' + (state.page + 2) + "/" + pages + "</button>"
        : '<button class="btn btn-primary" id="nextBtn" type="button"' + (state.index >= list.length - 1 ? " disabled" : "") + ">下一条</button>");
    $("actionbar").hidden = false;
  }

  function nav(d) {
    var list = filteredItems();
    var it = list[state.index]; if (!it) return;
    var pages = (it.pages || []).length;
    if (d > 0 && state.page < pages - 1) { state.page++; navSmooth = true; renderStudy(); return; }
    if (d < 0 && state.page > 0) { state.page--; navSmooth = true; renderStudy(); return; }
    var ni = state.index + d;
    if (ni < 0 || ni >= list.length) { toast(d > 0 ? "已是最后一条" : "已是第一条"); return; }
    state.index = ni; state.page = 0; navSmooth = true; renderStudy();
  }
  function jumpTo(id, page) {
    loadAll().then(function () {
      indexAll();
      var it = findItem(id); if (!it) { toast("未找到该条目"); return; }
      var bd = boardOf(it);
      if (state.boardId !== bd.id) { state.boardId = bd.id; state.unitId = null; state.kind = ""; }
      var list = filteredItems();
      var i = list.map(function (x) { return x.id; }).indexOf(id);
      if (i < 0) { state.kind = ""; state.unitId = null; list = filteredItems(); i = list.map(function (x) { return x.id; }).indexOf(id); }
      state.index = i < 0 ? 0 : i;
      state.page = page || 0;
      navSmooth = false;
      closeSearch();
      renderStudy();
    });
  }

  /* 进入板块：自动定位到上次浏览的位置 */
  function openBoard(id) {
    state.boardId = id;
    state.unitId = null; state.kind = "";
    state.index = 0; state.page = 0; navSmooth = false;
    return loadBoard(id).then(function () {
      indexAll();
      state.index = restoreIndex(id);
      renderStudy(); renderSidebar();
      var it = filteredItems()[state.index];
      if (state.index > 0 && it) toast("已回到上次进度 · 第 " + (state.index + 1) + " 条：" + it.title);
    });
  }

  /* ---------------- 双主线时间轴 ---------------- */
  var lineMode = 1;
  function renderLine() {
    var items = [];
    ["sg", "mao"].forEach(function (b) {
      var d = getBoard(b); if (!d) return;
      d.items.forEach(function (it) { it._b = b; items.push(it); });
    });
    items = items.filter(function (it) { return it.axis; });
    var evs = items.filter(function (it) { return it.axis.indexOf("event") >= 0; })
      .sort(function (a, b) { return (a.year || 0) - (b.year || 0); });
    var pols = items.filter(function (it) { return it.axis.indexOf("policy") >= 0; })
      .sort(function (a, b) { return (a.year || 0) - (b.year || 0); });

    function node(it) {
      var bd = boardOf(it);
      return '<div class="tl-node"><div class="tl-year">' + esc(it.dateLabel || it.year || "") + "</div>" +
        '<div class="tl-body"><h4>' + esc(it.title) + "</h4>" +
        "<p>" + esc(it.sub || "") + "</p>" +
        '<div class="tags"><button type="button" class="chip" data-jump="' + esc(it.id) + '">查看考点</button>' +
        (it.kind ? '<span class="tagline k-' + it.kind + '">' + (KIND_LABEL[it.kind] || "") + "</span>" : "") + "</div></div></div>";
    }
    var h = '<div class="wrap">';
    h += '<div class="crumb"><span>双主线时间轴</span><span>·</span><span>事件轴 ⇄ 党的理论政策轴</span></div>';
    h += '<div class="axis-switch">' +
      '<button type="button" class="chip' + (lineMode === 1 ? " on" : "") + '" data-line="1">并排对照</button>' +
      '<button type="button" class="chip' + (lineMode === 2 ? " on" : "") + '" data-line="2">仅事件轴</button>' +
      '<button type="button" class="chip' + (lineMode === 3 ? " on" : "") + '" data-line="3">仅政策轴</button>' +
      '<button type="button" class="chip" data-line="4">按年份合并</button></div>';

    if (lineMode === 1) {
      h += '<div class="tl-pair"><div class="tl-col-a"><div class="tl-col-h">历史事件轴（发生了什么）</div><div class="tl">' +
        evs.map(node).join("") + '</div></div><div class="tl-col-b"><div class="tl-col-h">党的理论政策轴（党做了什么）</div><div class="tl">' +
        pols.map(node).join("") + "</div></div></div>";
    } else if (lineMode === 2) {
      h += '<div class="tl">' + evs.map(node).join("") + "</div>";
    } else if (lineMode === 3) {
      h += '<div class="tl">' + pols.map(node).join("") + "</div>";
    } else {
      var yrs = {};
      items.forEach(function (it) { var y = it.year || 0; (yrs[y] = yrs[y] || []).push(it); });
      h += '<div class="tl">' + Object.keys(yrs).sort(function (a, b) { return a - b; }).map(function (y) {
        var arr = yrs[y].sort(function (a, b) { return a.axis.length - b.axis.length; });
        return '<div class="tl-node"><div class="tl-year">' + y + " 年</div>" +
          '<div class="tl-body">' + arr.map(function (it) {
            return "<h4>" + esc(it.title) + "</h4><p>" + esc(it.sub || "") +
              ' <button type="button" class="chip" data-jump="' + esc(it.id) + '">查看</button></p>';
          }).join('<div style="height:9px"></div>') + "</div></div>";
      }).join("") + "</div>";
    }
    h += "</div>";
    $("viewLine").innerHTML = h;
    show("viewLine");
    $("topTitle").textContent = "双主线时间轴";
    $("topSub").textContent = "事件轴 " + evs.length + " 条 · 政策轴 " + pols.length + " 条";
    $("progressStrip").hidden = true;
    $("actionbar").hidden = true;
  }

  /* ---------------- 案例反查 ---------------- */
  function renderCase(q) {
    var h = '<div class="wrap">';
    h += '<div class="crumb"><span>案例反查原理</span><span>·</span><span>马原专用</span></div>';
    h += '<div class="search-box" style="margin-bottom:14px"><input id="caseInput" type="search" placeholder="输入现实案例，如：统筹疫情防控与经济社会发展" value="' + esc(q || "") + '"></div>';
    var hits = [];
    if (q) {
      var k = q.toLowerCase();
      hits = (caseIndex || []).filter(function (x) {
        if (x.c.q.toLowerCase().indexOf(k) >= 0) return true;
        if (x.it.title.toLowerCase().indexOf(k) >= 0) return true;
        var kws = (x.c && x.c.kw) || [];
        for (var i = 0; i < kws.length; i++) {
          var w = String(kws[i]).toLowerCase();
          if (k.indexOf(w) >= 0 || w.indexOf(k) >= 0) return true;
        }
        return x.it._idx.indexOf(k) >= 0;
      });
    }
    if (!q) {
      h += '<div class="sec-title">常见案例速查</div><div class="cards">' + (caseIndex || []).slice(0, 24).map(function (x) {
        return '<button type="button" class="card" data-case="' + esc(x.c.q) + '" style="--cc:var(--c-my)">' +
          '<div class="card-top"><b>' + esc(x.c.q) + '</b><span class="bdg">案例</span></div>' +
          "<p>→ " + esc(x.it.title) + "</p></button>";
      }).join("") + "</div>";
    } else if (!hits.length) {
      h += '<div class="empty">没有匹配的案例或原理<br>换个关键词试试，例如「矛盾」「量变」「脱贫攻坚」「改革」</div>';
    } else {
      h += '<div class="sec-title">匹配到 ' + hits.length + " 条</div>";
      h += hits.map(function (x) {
        return '<div class="anchor-card" style="margin-bottom:10px">' +
          "<h4>" + esc(x.it.title) + " ← " + esc(x.c.q) + "</h4>" +
          '<p>' + x.c.a + "</p>" +
          '<div class="b-link" style="margin-top:9px"><button type="button" data-jump="' + esc(x.it.id) + '"><i>原理</i>查看完整考点</button></div></div>';
      }).join("");
    }
    h += "</div>";
    $("viewCase").innerHTML = h;
    show("viewCase");
    $("topTitle").textContent = "案例反查";
    $("topSub").textContent = (caseIndex || []).length + " 个现实案例 ↔ 哲学原理";
    $("progressStrip").hidden = true;
    $("actionbar").hidden = true;
    var inp = $("caseInput");
    if (inp) {
      if (q) { inp.focus(); inp.setSelectionRange(q.length, q.length); }
      inp.addEventListener("input", function () {
        clearTimeout(inp._t);
        var v = inp.value;
        inp._t = setTimeout(function () { renderCase(v); var i2 = $("caseInput"); if (i2) i2.focus(); }, 260);
      });
    }
  }

  /* ---------------- 搜索 ---------------- */
  function openSearch() {
    $("searchOverlay").hidden = false;
    $("searchFilters").innerHTML = KINDS.map(function (k) {
      return '<button type="button" class="chip' + (searchKind === k.v ? " on" : "") + '" data-sk="' + k.v + '">' + k.label + "</button>";
    }).join("");
    setTimeout(function () { $("searchInput").focus(); }, 80);
    loadAll().then(function () { indexAll(); renderSearch(); });
  }
  function closeSearch() { $("searchOverlay").hidden = true; }
  function renderSearch() {
    var q = ($("searchInput").value || "").trim().toLowerCase();
    if (!q) {
      $("searchResults").innerHTML = '<div class="sec-title" style="margin-top:4px">试试这些</div><div class="cards">' +
        ["1919", "统一战线", "新民主主义", "矛盾", "遵义会议", "论持久战", "遵义", "中国式现代化", "十四五", "六个必须坚持"]
          .map(function (x) { return '<button type="button" class="card" data-quick="' + esc(x) + '" style="--cc:var(--accent)"><div class="card-top"><b>' + esc(x) + "</b></div></button>"; }).join("") +
        "</div>";
      return;
    }
    var terms = q.split(/\s+/).filter(Boolean);
    searchHits = allItems().filter(function (it) {
      if (searchKind && it.kind !== searchKind) return false;
      return terms.every(function (t) { return it._idx.indexOf(t) >= 0; });
    });
    var groups = {};
    searchHits.forEach(function (it) { (groups[it._b] = groups[it._b] || []).push(it); });
    if (!searchHits.length) {
      $("searchResults").innerHTML = '<div class="empty">没有匹配「' + esc(q) + "」的考点<br>试试更短的关键词或切换锚点筛选</div>";
      return;
    }
    var h = '<div class="sec-title" style="margin-top:4px">共 ' + searchHits.length + " 条</div>";
    BOARDS.forEach(function (b) {
      var g = groups[b.id]; if (!g) return;
      h += '<div class="sr-group"><h5 style="color:' + b.color + '">' + esc(b.name) + " · " + g.length + "</h5>";
      h += g.slice(0, 60).map(function (it) {
        var snip = it.sub || "";
        if (!snip) {
          var pg0 = (it.pages || [])[0];
          if (pg0) {
            var b0 = (pg0.blocks || []).filter(function (x) { return typeof x.v === "string"; })[0];
            if (b0) snip = b0.v.replace(/<[^>]+>/g, "").slice(0, 70);
          }
        }
        return '<button type="button" class="sr-item" data-jump="' + esc(it.id) + '">' +
          '<div class="t">' + esc(it.title) + (it.kind ? '<span class="tagline k-' + it.kind + '">' + (KIND_LABEL[it.kind] || "") + "</span>" : "") + "</div>" +
          '<div class="d">' + esc(b.short) + " · " + esc(it.dateLabel || "") + "</div>" +
          (snip ? '<div class="s">' + esc(snip) + "</div>" : "") + "</button>";
      }).join("");
      h += "</div>";
    });
    $("searchResults").innerHTML = h;
  }

  /* ---------------- 自测 ---------------- */
  /* 题库按需加载：quiz.js（自测）+ quiz-zhenti.js（历年真题），二者都以 concat 方式追加 */
  var QUIZ_FILES = ["js/data/quiz.js", "js/data/quiz-zhenti.js"];
  var quizBank = null, quizLoading = null;

  function quizAll() { return quizBank || window.ZZX_QUIZ || []; }

  function quizBoardOf(q) {
    if (q.b) return q.b;
    return q.u ? String(q.u).replace(/\d+$/, "") : "";
  }
  function loadQuiz() {
    if (quizBank) return Promise.resolve(quizBank);
    if (quizLoading) return quizLoading;
    quizLoading = QUIZ_FILES.reduce(function (p, src) {
      return p.then(function () {
        return new Promise(function (res) {
          var s = document.createElement("script");
          s.src = src;
          s.onload = res;
          s.onerror = res;
          document.head.appendChild(s);
        });
      });
    }, Promise.resolve()).then(function () {
      quizBank = (window.ZZX_QUIZ || []).map(function (q) {
        return { y: q.y, n: q.n, u: q.u || "", b: quizBoardOf(q), q: q.q, o: q.o || [], a: q.a, e: q.e || "", j: q.j || "" };
      });
      return quizBank;
    });
    return quizLoading;
  }
  function isMulti(q) { return Object.prototype.toString.call(q.a) === "[object Array]" || Array.isArray(q.a); }
  function letters(v) {
    var arr = Array.isArray(v) ? v : [v];
    return arr.slice().sort(function (x, y) { return x - y; }).map(function (x) { return String.fromCharCode(65 + x); }).join("");
  }
  function shuffle(a, seed) {
    var r = seed || 1;
    function rnd() { r = (r * 9301 + 49297) % 233280; return r / 233280; }
    var arr = a.slice();
    for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  /* filter: all | 板块 id(sg/mao/my/sf/xc) | zhenti | y:2015 | u:my4 */
  function quizFilterName(filter) {
    if (filter === "all") return "全库混合";
    if (filter === "zhenti") return "历年真题";
    if (filter.indexOf("y:") === 0) return filter.slice(2) + " 年真题";
    if (filter.indexOf("u:") === 0) {
      var uid = filter.slice(2);
      var hit = "";
      BOARDS.some(function (b) {
        var d = getBoard(b.id); if (!d) return false;
        return (d.units || []).some(function (u) { if (u[0] !== uid) return false; hit = b.short + " · " + u[2]; return true; });
      });
      return hit || uid;
    }
    var bb = BOARDS.filter(function (b) { return b.id === filter; })[0];
    return bb ? bb.short : "自测";
  }
  function quizMatch(q, filter) {
    if (filter === "all") return true;
    if (filter === "zhenti") return !!q.y;
    if (filter.indexOf("y:") === 0) return String(q.y) === filter.slice(2);
    if (filter.indexOf("u:") === 0) return q.u === filter.slice(2);
    return q.b === filter;
  }
  function startQuiz(filter, n) {
    Promise.all([loadQuiz(), loadAll()]).then(function (r) {
      var bank = r[0] || [];
      indexAll();
      filter = filter || "all";
      var pool = bank.filter(function (q) { return quizMatch(q, filter); });
      if (!pool.length) pool = bank.slice();
      if (!pool.length) { toast("题库为空"); return; }
      quiz.filter = filter;
      quiz.label = quizFilterName(filter);
      var cnt = n || 12;
      quiz.list = shuffle(pool, Date.now() % 99991).slice(0, cnt);
      quiz.i = 0; quiz.right = 0; quiz.answered = false; quiz.picked = [];
      if (filter !== "all" && filter.indexOf(":") < 0) state.boardId = filter;
      show("viewQuiz"); renderQuiz();
    });
  }
  function renderQuiz() {
    var q = quiz.list[quiz.i];
    var h = '<div class="wrap">';
    if (!q) { renderHome(); return; }
    var multi = isMulti(q);
    h += '<div class="crumb"><span>' + esc(quiz.label || "自测练习") + "</span><span>·</span><span>第 " + (quiz.i + 1) + " / " + quiz.list.length + " 题</span>" +
      (q.y ? "<span>·</span><span>" + q.y + " 年第 " + q.n + " 题</span>" : "") + "</div>";
    h += '<div class="quiz-card">';
    h += '<p class="quiz-q">' + esc(q.q) + (multi ? '<span class="q-tag">多选题</span>' : '<span class="q-tag">单选题</span>') + "</p>";
    h += '<div class="quiz-opts">' + q.o.map(function (o, i) {
      return '<button type="button" class="opt' + (quiz.picked.indexOf(i) >= 0 ? " sel" : "") + '" data-opt="' + i + '"><b>' + String.fromCharCode(65 + i) + "</b><span>" + esc(o) + "</span></button>";
    }).join("") + "</div>";
    h += '<div id="quizEx"></div>';
    h += '<div class="quiz-foot">';
    if (multi && !quiz.answered) {
      h += '<button class="btn btn-primary btn-sm" id="quizSubmit" type="button"' + (quiz.picked.length ? "" : " disabled") + ">提交答案</button>";
    }
    h += '<button class="btn' + (multi && !quiz.answered ? " btn-ghost" : " btn-primary") +
      ' btn-sm" id="quizNext" type="button"' + (quiz.answered ? "" : " disabled") + ">" +
      (quiz.i >= quiz.list.length - 1 ? "看成绩" : "下一题") + "</button>" +
      '<span class="score">已答对 ' + quiz.right + " / " + (quiz.answered ? quiz.i + 1 : quiz.i) + "</span>" +
      '<button class="text-btn" id="quizExit" type="button">退出</button></div>';
    h += "</div></div>";
    $("viewQuiz").innerHTML = h;
    show("viewQuiz");
    $("topTitle").textContent = "随机自测";
    $("topSub").textContent = (quiz.label || "自测") + " · 共 " + quiz.list.length + " 题 · 单选点选项即判，多选点选后提交";
    $("progressStrip").hidden = true;
    $("actionbar").hidden = true;
  }
  /* 点选项：单选直接判分；多选切换选中状态 */
  function answerQuiz(i) {
    if (quiz.answered) return;
    var q = quiz.list[quiz.i];
    if (isMulti(q)) {
      var at = quiz.picked.indexOf(i);
      if (at >= 0) quiz.picked.splice(at, 1); else quiz.picked.push(i);
      var btn = $("viewQuiz").querySelector('[data-opt="' + i + '"]');
      if (btn) btn.classList.toggle("sel", at < 0);
      var sub = $("quizSubmit");
      if (sub) sub.disabled = !quiz.picked.length;
      return;
    }
    judgeQuiz([i]);
  }
  function judgeQuiz(picked) {
    if (quiz.answered) return;
    var q = quiz.list[quiz.i];
    var right = Array.isArray(q.a) ? q.a : [q.a];
    var ok = picked.length === right.length && picked.every(function (v) { return right.indexOf(v) >= 0; });
    quiz.answered = true;
    if (ok) quiz.right++;
    var opts = $("viewQuiz").querySelectorAll(".opt");
    for (var k = 0; k < opts.length; k++) {
      opts[k].disabled = true;
      opts[k].classList.remove("sel");
      if (right.indexOf(k) >= 0) opts[k].classList.add("right");
      else if (picked.indexOf(k) >= 0) opts[k].classList.add("wrong");
    }
    var tip = q.e || (q.y ? "本题出自 " + q.y + " 年考研政治真题第 " + q.n + " 题（" + (isMulti(q) ? "多选" : "单选") + "），正确答案为 " + letters(q.a) + "。可点击下方按钮跳到对应考点复习。" : "暂无解析");
    var ex = $("quizEx");
    ex.innerHTML = '<div class="quiz-ex"><strong>' + (ok ? "✓ 正确" : "✗ 正确答案：" + letters(q.a)) + "</strong><br>" + tip +
      (q.j ? '<div class="b-link" style="margin-top:8px"><button type="button" data-jump="' + esc(q.j) + '"><i>关联</i>查看对应考点</button></div>' : "") + "</div>";
    var sub = $("quizSubmit");
    if (sub) sub.hidden = true;
    var nx = $("quizNext");
    if (nx) { nx.disabled = false; nx.classList.remove("btn-ghost"); nx.classList.add("btn-primary"); }
    var sc = $("viewQuiz").querySelector(".score");
    if (sc) sc.textContent = "已答对 " + quiz.right + " / " + (quiz.i + 1);
  }
  function quizUnitsHtml(cnt) {
    return BOARDS.map(function (b) {
      var d = getBoard(b.id); if (!d) return "";
      var us = (d.units || []).filter(function (u) { return cnt[u[0]]; });
      if (!us.length) return "";
      return '<div class="unit-group"><span class="ug-name" style="color:' + b.color + '">' + esc(b.short) + "</span>" +
        us.map(function (u) {
          return '<button type="button" class="chip chip-sm" data-quiz="u:' + u[0] + '">' + esc(u[2]) + " <i>" + cnt[u[0]] + "</i></button>";
        }).join("") + "</div>";
    }).join("");
  }
  function quizYearsHtml(bank) {
    var ys = [];
    bank.forEach(function (q) { if (q.y && ys.indexOf(q.y) < 0) ys.push(q.y); });
    ys.sort(function (a, b) { return b - a; });
    if (!ys.length) return "";
    return '<div class="sec-title">按年份（历年真题）</div><div class="axis-switch">' +
      '<button type="button" class="chip" data-quiz="zhenti">全部年份</button>' +
      ys.map(function (y) { return '<button type="button" class="chip" data-quiz="y:' + y + '">' + y + "</button>"; }).join("") + "</div>";
  }
  function renderQuizHome() {
    Promise.all([loadQuiz(), loadAll()]).then(function (r) {
      var bank = r[0] || [];
      indexAll();
      var cnt = {}, ucnt = {}, zhenti = 0;
      bank.forEach(function (q) {
        cnt[q.b] = (cnt[q.b] || 0) + 1;
        if (q.u) ucnt[q.u] = (ucnt[q.u] || 0) + 1;
        if (q.y) zhenti++;
      });
      var h = '<div class="wrap"><div class="hero"><h1>随机自测</h1><p>按板块、章节或年份抽题。单选点选项即判，多选可多次点选后提交；答完即时给解析，并可跳到对应考点复习。</p></div>';
      h += '<div class="sec-title">选择范围</div><div class="cards">';
      h += '<button type="button" class="card" data-quiz="all" style="--cc:var(--accent)"><div class="card-top"><b>全库混合</b><span class="bdg">' + bank.length + " 题</span></div><p>自测题与历年真题混合抽取，检验跨板块串联能力。</p></button>";
      if (zhenti) {
        h += '<button type="button" class="card" data-quiz="zhenti" style="--cc:var(--c-sg)"><div class="card-top"><b>历年真题</b><span class="bdg">' + zhenti + " 题</span></div><p>2010—2023 年考研政治真题（单选 16 题 + 多选 17 题）。</p></button>";
      }
      h += BOARDS.map(function (b) {
        return '<button type="button" class="card" data-quiz="' + b.id + '" style="--cc:' + b.color + '">' +
          '<div class="card-top"><b>' + esc(b.short) + '</b><span class="bdg">' + (cnt[b.id] || 0) + " 题</span></div><p>" + esc(b.desc) + "</p></button>";
      }).join("");
      h += "</div>";
      var uh = quizUnitsHtml(ucnt);
      if (uh) { h += '<div class="sec-title">按章节</div><div class="unit-picker">' + uh + "</div>"; }
      h += quizYearsHtml(bank);
      var nRange = [10, 12, 20, 30, 50];
      h += '<div class="sec-title">题量</div><div class="axis-switch" id="quizNums">' +
        nRange.map(function (n) { return '<button type="button" class="chip" data-num="' + n + '">' + n + " 题</button>"; }).join("") + "</div>";
      h += "</div>";
      $("viewQuiz").innerHTML = h;
      bind._n = 12;
      var chips = $("viewQuiz").querySelectorAll('[data-num]');
      for (var i = 0; i < chips.length; i++) chips[i].classList.toggle("on", chips[i].getAttribute("data-num") === "12");
      show("viewQuiz");
      $("topTitle").textContent = "随机自测";
      $("topSub").textContent = "全库 " + bank.length + " 题 · 每轮随机抽取";
      $("progressStrip").hidden = true;
      $("actionbar").hidden = true;
    });
  }

  /* ---------------- 材料分析题（简答/分析题） ---------------- */
  var ESSAY_FILES = ["js/data/essay.js"];
  var essayBank = null, essayLoading = null;
  var efilter = { board: "all", year: "all" };
  var eOpen = {};

  function loadEssay() {
    if (essayBank) return Promise.resolve(essayBank);
    if (essayLoading) return essayLoading;
    essayLoading = ESSAY_FILES.reduce(function (p, src) {
      return p.then(function () {
        return new Promise(function (res) {
          var s = document.createElement("script");
          s.src = src; s.onload = res; s.onerror = res;
          document.head.appendChild(s);
        });
      });
    }, Promise.resolve()).then(function () {
      essayBank = (window.ZZX_ESSAY || []).slice().sort(function (a, b) { return (a.y - b.y) || (a.n - b.n); });
      return essayBank;
    });
    return essayLoading;
  }
  function essayTips() { return window.ZZX_ESSAY_TIPS || { rules: [], steps: [], boards: {}, signals: [], priority: {} }; }
  function bName(id) { var b = BOARDS.filter(function (x) { return x.id === id; })[0]; return b ? b.short : id; }
  function bColor(id) { var b = BOARDS.filter(function (x) { return x.id === id; })[0]; return b ? b.color : "var(--accent)"; }
  function unitNameOf(uid) {
    var hit = "";
    BOARDS.some(function (b) {
      var d = getBoard(b.id); if (!d) return false;
      return (d.units || []).some(function (u) { if (u[0] !== uid) return false; hit = u[2]; return true; });
    });
    return hit || uid;
  }
  function essayVisible() {
    return (essayBank || []).filter(function (e) {
      if (efilter.board !== "all" && e.b !== efilter.board) return false;
      if (efilter.year !== "all" && String(e.y) !== efilter.year) return false;
      return true;
    });
  }

  function renderEssay() {
    Promise.all([loadEssay(), loadAll()]).then(function (r) {
      var bank = r[0] || [];
      indexAll();
      var T = essayTips();
      var cnt = {};
      bank.forEach(function (e) { cnt[e.u] = (cnt[e.u] || 0) + 1; });
      var list = essayVisible();
      var h = '<div class="wrap">';
      h += '<div class="hero"><h1>材料分析题 · 出题逻辑</h1><p>2010—2024 年 34—38 题共 ' + bank.length +
        ' 道。这里不只给答案框架，更讲清“材料里的这句话为什么必然指向这个理论”，并给出该重点复习的章节。</p></div>';

      h += '<div class="sec-title">一、命题规律（出题逻辑总览）</div><div class="zone">';
      h += T.rules.map(function (r, i) {
        return '<div class="rule-row"><span class="rule-n">' + (i + 1) + "</span><div><b>" + esc(r.t) + "</b><p>" + esc(r.v) + "</p></div></div>";
      }).join("");
      h += "</div>";

      h += '<div class="sec-title">二、答题逻辑五步法</div><div class="zone">';
      h += T.steps.map(function (s) {
        return '<div class="rule-row"><span class="rule-n">步</span><div><b>' + esc(s.k) + "</b><p>" + esc(s.v) + "</p></div></div>";
      }).join("");
      h += "</div>";

      h += '<div class="sec-title">三、各板块答题模板</div><div class="cards">';
      BOARDS.forEach(function (b) {
        var t = T.boards[b.id]; if (!t) return;
        h += '<div class="card" style="--cc:' + b.color + '"><div class="card-top"><b>' + esc(t.name) +
          '</b><span class="bdg">' + esc(b.short) + "</span></div>" +
          '<p class="k-form">套式：' + esc(t.form) + "</p><ul class=\"k-list\">" +
          t.points.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul></div>";
      });
      h += "</div>";

      h += '<div class="sec-title">四、语言为什么指向这个理论（信号 → 理论）</div><div class="zone">';
      h += T.signals.map(function (s) {
        return '<div class="sig-row"><span class="sig-lang">' + esc(s.lang) + '</span><span class="sig-arrow">→</span>' +
          '<span class="sig-th">' + esc(s.th) + '</span><span class="q-tag" style="--cc:' + bColor(s.b) + '">' + esc(bName(s.b)) + "</span></div>";
      }).join("");
      h += "</div>";

      h += '<div class="sec-title">五、重点章节推荐（按历年真题频次）</div><div class="cards">';
      BOARDS.forEach(function (b) {
        var list = (T.priority[b.id] || []); if (!list.length) return;
        h += '<div class="card pri-card" style="--cc:' + b.color + '"><div class="card-top"><b>' + esc(bName(b.id)) +
          '</b><span class="bdg">' + list.length + " 个重点</span></div>";
        h += list.map(function (p) {
          return '<button type="button" class="pri-item" data-echapter="' + p.u + '">' +
            '<span class="pri-h"><b>' + esc(p.u + " " + unitNameOf(p.u)) + '</b><i>' + esc(p.t) +
            '</i><em>' + (cnt[p.u] ? "历年 " + cnt[p.u] + " 题" : "近 15 年未单独出题") + "</em></span><p>" + esc(p.why) + "</p></button>";
        }).join("");
        h += "</div>";
      });
      h += "</div>";

      h += '<div class="sec-title">六、逐题出题逻辑（' + list.length + " / " + bank.length + " 题）</div>";
      h += '<div class="axis-switch" id="eYears"><button type="button" class="chip' + (efilter.year === "all" ? " on" : "") +
        '" data-efyear="all">全部年份</button>';
      var years = [];
      bank.forEach(function (e) { if (years.indexOf(e.y) < 0) years.push(e.y); });
      h += years.map(function (y) {
        return '<button type="button" class="chip' + (efilter.year === String(y) ? " on" : "") + '" data-efyear="' + y + '">' + y + "</button>";
      }).join("") + "</div>";
      h += '<div class="axis-switch" id="eBoards"><button type="button" class="chip' + (efilter.board === "all" ? " on" : "") +
        '" data-efboard="all">全部板块</button>' + BOARDS.map(function (b) {
          return '<button type="button" class="chip' + (efilter.board === b.id ? " on" : "") + '" data-efboard="' + b.id + '">' + esc(b.short) + "</button>";
        }).join("") + "</div>";
      h += '<div class="axis-switch"><button type="button" class="chip" data-eall="1">展开全部</button>' +
        '<button type="button" class="chip" data-eall="0">全部收起</button></div>';

      if (!list.length) h += '<div class="empty">当前筛选下没有题目</div>';
      list.forEach(function (e) {
        var key = e.y + "." + e.n;
        var open = !!eOpen[key];
        h += '<article class="essay-item' + (open ? " open" : "") + '">';
        h += '<button type="button" class="essay-head" data-etoggle="' + key + '">' +
          '<span class="ey">' + e.y + "·" + e.n + "</span>" +
          '<span class="et">' + esc(e.t) + "</span>" +
          '<span class="q-tag" style="--cc:' + bColor(e.b) + '">' + esc(bName(e.b)) + "</span></button>";
        h += '<div class="essay-body"' + (open ? "" : " hidden") + ">";
        h += '<p class="ess-th"><b>指向理论：</b>' + esc(e.th) + "</p>";
        h += '<div class="ess-sec"><h5>材料要义</h5><p>' + esc(e.m) + "</p></div>";
        if (e.qs && e.qs.length) {
          h += '<div class="ess-sec"><h5>设问</h5><ol>' + e.qs.map(function (q) { return "<li>" + esc(q) + "</li>"; }).join("") + "</ol></div>";
        }
        h += '<div class="ess-sec"><h5>答题逻辑</h5><ol class="ess-a">' + e.a.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol></div>";
        h += '<div class="ess-sec why"><h5>材料语言为什么指向这个理论</h5><p>' + esc(e.why) + "</p></div>";
        if (e.k && e.k.length) {
          h += '<div class="ess-sec"><h5>关联考点（点击复习）</h5><div class="ess-k">' +
            e.k.map(function (id) {
              var it = findItem(id);
              return '<button type="button" class="chip chip-sm" data-jump="' + esc(id) + '">' + esc(it ? it.title : id) + "</button>";
            }).join("") + "</div></div>";
        }
        h += "</div></article>";
      });
      h += "</div>";
      $("viewEssay").innerHTML = h;
      show("viewEssay");
      $("topTitle").textContent = "材料分析题";
      $("topSub").textContent = bank.length + " 道历年分析题 · 出题逻辑与答题框架";
      $("progressStrip").hidden = true;
      $("actionbar").hidden = true;
    });
  }

  /* ---------------- 图片查看器（可缩放） ---------------- */
  var viewer = { open: false, scale: 1, tx: 0, ty: 0, fitW: 1, fitH: 1, W0: 0, H0: 0, min: 0.2, max: 6, dragging: false, px: 0, py: 0 };

  function viewStage() { return $("imgStage"); }
  function viewImg() { return $("imgBig"); }

  function viewApply() {
    viewImg().style.transform = "translate(" + viewer.tx + "px," + viewer.ty + "px) scale(" + viewer.scale + ")";
    $("imgZoomLabel").textContent = Math.round(viewer.scale * 100) + "%";
  }

  function viewFitWidth() {
    var st = viewStage();
    if (!st || !viewer.W0) return;
    var sw = st.clientWidth, sh = st.clientHeight;
    viewer.fitW = sw / viewer.W0;
    viewer.fitH = sh / viewer.H0;
    viewer.min = Math.min(viewer.fitW, viewer.fitH) * 0.8;
    viewer.scale = viewer.fitW;
    viewer.tx = 0;
    viewer.ty = Math.max(0, (sh - viewer.H0 * viewer.scale) / 2);
    viewApply();
  }

  function viewZoomTo(s, cx, cy) {
    var st = viewStage();
    if (!st) return;
    if (cx == null) cx = st.clientWidth / 2;
    if (cy == null) cy = st.clientHeight / 2;
    var ns = Math.min(viewer.max, Math.max(viewer.min, s));
    var k = ns / viewer.scale;
    viewer.tx = cx - (cx - viewer.tx) * k;
    viewer.ty = cy - (cy - viewer.ty) * k;
    viewer.scale = ns;
    viewApply();
  }

  function viewZoomBy(factor, cx, cy) { viewZoomTo(viewer.scale * factor, cx, cy); }

  function openViewer(src, cap) {
    var img = viewImg();
    viewer.open = true;
    viewer.scale = 1; viewer.tx = 0; viewer.ty = 0;
    $("imgCap").textContent = cap || "";
    $("imgOverlay").hidden = false;
    img.alt = cap || "";
    img.src = src;
    function ready() {
      viewer.W0 = img.naturalWidth || 1;
      viewer.H0 = img.naturalHeight || 1;
      viewFitWidth();
    }
    if (img.complete && img.naturalWidth) ready();
    else img.onload = ready;
  }

  function closeViewer() {
    viewer.open = false;
    $("imgOverlay").hidden = true;
    viewImg().src = "";
  }

  function viewBind() {
    var st = viewStage();

    $("imgClose").onclick = closeViewer;
    $("imgZoomIn").onclick = function () { viewZoomBy(1.4); };
    $("imgZoomOut").onclick = function () { viewZoomBy(1 / 1.4); };
    $("imgZoomFit").onclick = viewFitWidth;
    $("imgZoomOne").onclick = function () { viewZoomTo(1); };

    // 鼠标滚轮缩放
    st.addEventListener("wheel", function (e) {
      if (!viewer.open) return;
      e.preventDefault();
      var r = st.getBoundingClientRect();
      viewZoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    // 双击放大 / 还原
    st.addEventListener("dblclick", function (e) {
      if (!viewer.open) return;
      var r = st.getBoundingClientRect();
      var x = e.clientX - r.left, y = e.clientY - r.top;
      if (viewer.scale > viewer.fitW * 1.05) viewZoomTo(viewer.fitW, x, y);
      else viewZoomTo(viewer.fitW * 2.5, x, y);
    });

    // 鼠标拖动平移
    st.addEventListener("pointerdown", function (e) {
      if (!viewer.open || e.pointerType !== "mouse") return;
      viewer.dragging = true;
      viewer.px = e.clientX; viewer.py = e.clientY;
      st.classList.add("grabbing");
    });
    window.addEventListener("pointermove", function (e) {
      if (!viewer.dragging) return;
      viewer.tx += e.clientX - viewer.px;
      viewer.ty += e.clientY - viewer.py;
      viewer.px = e.clientX; viewer.py = e.clientY;
      viewApply();
    });
    window.addEventListener("pointerup", function () { viewer.dragging = false; st.classList.remove("grabbing"); });

    // 移动端：单指拖动 + 双指捏合缩放
    var touch = { mode: null, lx: 0, ly: 0, pinch: null };
    st.addEventListener("touchstart", function (e) {
      if (e.touches.length === 1) {
        touch.mode = "drag";
        touch.lx = e.touches[0].clientX; touch.ly = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        touch.mode = "pinch";
        touch.pinch = {
          d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY),
          s: viewer.scale
        };
      }
    }, { passive: true });
    st.addEventListener("touchmove", function (e) {
      if (touch.mode === "drag" && e.touches.length === 1) {
        viewer.tx += e.touches[0].clientX - touch.lx;
        viewer.ty += e.touches[0].clientY - touch.ly;
        touch.lx = e.touches[0].clientX; touch.ly = e.touches[0].clientY;
        viewApply();
      } else if (touch.mode === "pinch" && e.touches.length === 2) {
        e.preventDefault();
        var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        var r = st.getBoundingClientRect();
        var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
        var cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
        viewZoomTo(touch.pinch.s * (d / touch.pinch.d), cx, cy);
      }
    }, { passive: false });
    st.addEventListener("touchend", function (e) {
      if (e.touches.length === 0) touch.mode = null;
      else if (e.touches.length === 1) {
        touch.mode = "drag";
        touch.lx = e.touches[0].clientX; touch.ly = e.touches[0].clientY;
      }
    });

    // 窗口尺寸变化时重新适应
    window.addEventListener("resize", function () { if (viewer.open) viewFitWidth(); });
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    dom.sidebar = $("sidebar"); dom.scrim = $("scrim");
    $("menuBtn").onclick = openSidebar;
    $("scrim").onclick = closeSidebar;
    $("themeBtn").onclick = cycleTheme;
    $("imgBtn").onclick = function () {
      state.imgMode = state.imgMode === "on" ? "off" : "on";
      localStorage.setItem(IMG_KEY, state.imgMode); syncImgBtn();
      if (!$("viewStudy").hidden) renderStudy(); else renderHome();
      toast("配图已" + (state.imgMode === "on" ? "显示" : "隐藏"));
    };
    $("resetBtn").onclick = function () {
      if (!confirm("确定清空全部学习进度？")) return;
      progress = {}; saveProgress(); renderSidebar(); renderHome(); toast("进度已清空");
    };
    $("searchBtn").onclick = openSearch;
    $("searchClose").onclick = closeSearch;
    $("searchInput").addEventListener("input", function () { clearTimeout(this._t); this._t = setTimeout(renderSearch, 180); });
    $("quizBtn").onclick = function () { if (state.boardId) startQuiz(state.boardId, 12); else renderQuizHome(); };
    $("timelineBtn").onclick = function () { loadAll().then(function () { indexAll(); renderLine(); }); };
    $("caseBtn").onclick = function () { loadAll().then(function () { indexAll(); renderCase(""); }); };
    $("essayBtn").onclick = function () { renderEssay(); closeSidebar(); };
    viewBind();

    // 图片加载失败兜底：隐藏破图、保留说明文字，避免页面出现异常图标
    document.addEventListener("error", function (e) {
      var el = e.target;
      if (el && el.tagName === "IMG") el.classList.add("img-broken");
    }, true);

    document.addEventListener("click", function (e) {
      var t = e.target;
      var el = t.closest ? t : null;
      function up(sel) { return t.closest ? t.closest(sel) : null; }

      var b = up("[data-board]");
      if (b) {
        openBoard(b.getAttribute("data-board"));
        closeSidebar();
        return;
      }
      var k = up("[data-kind]");
      if (k) { state.kind = k.getAttribute("data-kind"); state.index = 0; state.page = 0; renderSidebar(); renderStudy(); return; }
      var u = up("[data-unit]");
      if (u) {
        var uv = u.getAttribute("data-unit");
        state.unitId = state.unitId === uv ? null : uv;
        state.index = 0; state.page = 0; renderSidebar(); renderStudy(); closeSidebar(); return;
      }
      var o = up("[data-open]");
      if (o) {
        openBoard(o.getAttribute("data-open"));
        return;
      }
      var ln = up("[data-line]");
      if (ln) {
        var v = parseInt(ln.getAttribute("data-line"), 10);
        if (!$("viewLine").hidden) { lineMode = v; renderLine(); }
        else loadAll().then(function () { indexAll(); lineMode = v; renderLine(); });
        return;
      }
      var jp = up("[data-jump]");
      if (jp) { jumpTo(jp.getAttribute("data-jump"), 0); return; }
      var gt = up("[data-goto]");
      if (gt) {
        var gi = parseInt(gt.getAttribute("data-goto"), 10);
        if (gi >= 0) { state.index = gi; state.page = 0; navSmooth = false; renderStudy(); }
        return;
      }
      var tg = up("[data-tag]");
      if (tg) {
        openSearch();
        loadAll().then(function () { indexAll(); $("searchInput").value = tg.getAttribute("data-tag"); renderSearch(); });
        return;
      }
      var qk = up("[data-quick]");
      if (qk) { $("searchInput").value = qk.getAttribute("data-quick"); renderSearch(); return; }
      var sk = up("[data-sk]");
      if (sk) { searchKind = sk.getAttribute("data-sk");
        var chips = $("searchFilters").querySelectorAll(".chip");
        for (var i = 0; i < chips.length; i++) chips[i].classList.toggle("on", chips[i].getAttribute("data-sk") === searchKind);
        renderSearch(); return; }
      var cs = up("[data-case]");
      if (cs) { renderCase(cs.getAttribute("data-case")); return; }
      var qz = up("[data-quiz]");
      if (qz) { startQuiz(qz.getAttribute("data-quiz"), bind._n || 12); return; }
      var nm = up("[data-num]");
      if (nm) {
        bind._n = parseInt(nm.getAttribute("data-num"), 10);
        var ns = $("viewQuiz").querySelectorAll("[data-num]");
        for (var j = 0; j < ns.length; j++) ns[j].classList.toggle("on", ns[j] === nm);
        return;
      }
      var op = up("[data-opt]");
      if (op) { answerQuiz(parseInt(op.getAttribute("data-opt"), 10)); return; }
      var pg = up("[data-page]");
      if (pg) { state.page = parseInt(pg.getAttribute("data-page"), 10); renderStudy(); return; }
      var et = up("[data-etoggle]");
      if (et) {
        var ek = et.getAttribute("data-etoggle");
        var ei = up(".essay-item");
        eOpen[ek] = !eOpen[ek];
        if (ei) {
          ei.classList.toggle("open", !!eOpen[ek]);
          var ebd = ei.querySelector(".essay-body");
          if (ebd) ebd.hidden = !eOpen[ek];
        }
        return;
      }
      var efb = up("[data-efboard]");
      if (efb) { efilter.board = efb.getAttribute("data-efboard"); renderEssay(); return; }
      var efy = up("[data-efyear]");
      if (efy) { efilter.year = efy.getAttribute("data-efyear"); renderEssay(); return; }
      var eall = up("[data-eall]");
      if (eall) {
        var onAll = eall.getAttribute("data-eall") === "1";
        essayVisible().forEach(function (e) { eOpen[e.y + "." + e.n] = onAll; });
        renderEssay(); return;
      }
      var ec = up("[data-echapter]");
      if (ec) {
        var cuid = ec.getAttribute("data-echapter");
        efilter.board = "all"; efilter.year = "all";
        var hits = [];
        (essayBank || []).forEach(function (e) {
          if (e.u === cuid) { hits.push(e); eOpen[e.y + "." + e.n] = true; }
        });
        renderEssay();
        setTimeout(function () {
          var first = hits[0] ? $("viewEssay").querySelector('[data-etoggle="' + hits[0].y + "." + hits[0].n + '"]') : null;
          if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
          else toast("该章节近 15 年未出分析题");
        }, 80);
        return;
      }
      var img = up(".shot");
      if (img) {
        openViewer(img.getAttribute("data-full"), img.getAttribute("data-cap") || "");
        return;
      }
    });

    $("actionbar").addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("button") : null;
      if (!t) return;
      if (t.id === "prevBtn") nav(-1);
      else if (t.id === "nextBtn") nav(1);
    });
    $("viewQuiz").addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("button") : null;
      if (!t) return;
      if (t.id === "quizNext") {
        if (quiz.i >= quiz.list.length - 1) {
          toast(quiz.label + "：答对 " + quiz.right + " / " + quiz.list.length + " 题");
          renderQuizHome();
        } else { quiz.i++; quiz.answered = false; quiz.picked = []; renderQuiz(); }
      } else if (t.id === "quizSubmit") {
        judgeQuiz(quiz.picked.slice());
      } else if (t.id === "quizExit") renderQuizHome();
    });

    document.addEventListener("keydown", function (e) {
      if (e.target.tagName === "INPUT") return;
      if (!$("searchOverlay").hidden && e.key === "Escape") { closeSearch(); return; }
      if (!$("imgOverlay").hidden) { if (e.key === "Escape") closeViewer(); return; }
      if (!$("viewStudy").hidden) {
        if (e.key === "ArrowRight" || e.key === "j") nav(1);
        if (e.key === "ArrowLeft" || e.key === "k") nav(-1);
      }
    });

    var lastX = 0, lastY = 0;
    document.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) return;
      lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
    }, { passive: true });
    document.addEventListener("touchend", function (e) {
      if ($("viewStudy").hidden) return;
      var dx = e.changedTouches[0].clientX - lastX;
      var dy = e.changedTouches[0].clientY - lastY;
      if (Math.abs(dx) > 62 && Math.abs(dx) > Math.abs(dy) * 1.8) nav(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    applyTheme(); syncImgBtn(); bind();
    Promise.all([loadQuiz(), loadAll()]).then(function () {
      indexAll();
      renderSidebar();
      renderHome();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
