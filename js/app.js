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

  var THEME_KEY = "zzx.theme";
  var IMG_KEY = "zzx.img";
  var THEMES = [{ v: "auto", label: "跟随系统" }, { v: "light", label: "浅色" }, { v: "dark", label: "深色" }];

  var state = {
    boardId: null, unitId: null, kind: "", index: 0, page: 0, done: {},
    imgMode: localStorage.getItem(IMG_KEY) || "on",
    user: null                       // 当前登录账号；null = 本机身份（无账号）
  };
  /* ---------------- 本地数据库（IndexedDB）+ 内存缓存 ----------------
     为什么不用 localStorage 存学习数据（沿用开源实践 idb-keyval / Dexie 的思路）：
       · localStorage 只有约 5MB，多账号 + 错题库很容易写满，而且写满时是静默失败；
       · 同步写入会卡住主线程，账号一多、数据一大就明显卡顿；
       · 写入非事务，中途失败会留下"半截 JSON"，读出来就报错。
     所以：
       · 账号、进度、错题、会话都放进 IndexedDB 的单表 kv（异步 + 事务写入，容量数百 MB）；
       · 界面仍然同步读内存缓存；写入先改动内存、去抖 500ms 批量落盘，切后台/离开页面强制落盘；
       · 每条记录带 rev 与时间戳；发现同一键被别处改过（另一个标签页/另一个账号页）就做合并：
         进度取并集（已掌握只会增加，不会丢）、错题计数取最大值、攻克记录以清除标记为准；
       · 写入超配额先自动瘦身重试，再降级到 localStorage，并明确告知用户；
       · 首次启动把旧的 localStorage 数据整体搬进库（旧键保留不删，可随时回退）。 */
  var DB_NAME = "zzx-db", DB_STORE = "kv", DB_VER = 1;
  var dbp = null, dbFailed = false, bc = null;
  var mem = {};              // key -> { rev, at, data }
  var dirtyKeys = {}, flushTimer = null;
  var STORE_KEY = "progress";     // 逻辑键前缀（进度）
  var WRONG_KEY = "wrong";        // 逻辑键前缀（错题库）
  var SSESS_KEY = "zzx.session.tmp";   // 未勾选「记住登录」时的临时会话（仅本次会话有效）
  var LAST_KEY = "zzx.lastUser";
  var PBKDF2_ITER = 150000;

  function idbOpen() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error("no-indexeddb"));
      var req = window.indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("idb-error")); };
      req.onblocked = function () { reject(new Error("idb-blocked")); };
    });
    return dbp;
  }
  function idbTx(mode, fn) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, mode);
        var out = fn(tx.objectStore(DB_STORE));
        tx.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }
  function idbGetAll() {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readonly");
        var out = {}, req = tx.objectStore(DB_STORE).openCursor();
        req.onsuccess = function () {
          var c = req.result;
          if (!c) return resolve(out);
          out[c.key] = c.value;
          c.continue();
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }
  function isQuotaErr(e) {
    return !!e && (e.name === "QuotaExceededError" || e.code === 22 || /quota|storage/i.test(String(e.name || e.message || "")));
  }
  function lsRecKey(k) { return "zzxdb:" + k; }
  function lsPutRec(k, rec) {
    try { localStorage.setItem(lsRecKey(k), JSON.stringify(rec)); return Promise.resolve(true); }
    catch (e) { return Promise.reject(e); }
  }
  /* 超配额时精简：先丢历史轮次，再丢错题里的选项原文（体积最大且可重建） */
  function slimRec(rec) {
    try {
      var d = rec && rec.data;
      if (!d) return false;
      if (Array.isArray(d.rounds) && d.rounds.length > 5) { d.rounds = d.rounds.slice(0, 5); return true; }
      if (d.q && Object.keys(d.q).length) {
        var n = 0;
        Object.keys(d.q).forEach(function (id) { if (d.q[id] && d.q[id].o) { d.q[id].o = []; n++; } });
        if (n) return true;
      }
      if (Array.isArray(d.rounds) && d.rounds.length) { d.rounds = []; return true; }
    } catch (e) {}
    return false;
  }
  function putRec(key, rec, retried) {
    return idbTx("readwrite", function (st) { st.put(rec, key); }).catch(function (err) {
      if (!retried && isQuotaErr(err) && slimRec(rec)) {
        toastOnce("本机存储空间紧张，已自动精简历史记录");
        return putRec(key, rec, true);
      }
      dbFailed = true;                       // 降级：改用 localStorage 记录表（学习数据仍完整保存）
      toastOnce("本机存储空间紧张：已自动切换备用存储，建议清理离线缓存");
      return lsPutRec(key, rec).catch(function () {
        toastOnce("本机存储已满：请先「导出学习数据」，再清理离线缓存");
        return false;
      });
    });
  }
  function delRecInDb(key) {
    return idbTx("readwrite", function (st) { st.delete(key); }).catch(function () {
      try { localStorage.removeItem(lsRecKey(key)); } catch (e) {}
    });
  }
  function recGetAll() {
    return idbGetAll().catch(function () {
      dbFailed = true;                       // 无 IndexedDB（个别隐私模式）：读 localStorage 记录表
      var out = {};
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf("zzxdb:") === 0) {
            var v = safeJSON(localStorage.getItem(k));
            if (v) out[k.slice(6)] = v;
          }
        }
      } catch (e) {}
      return out;
    });
  }
  /* ---------------- 数据防污染 / 完整性校验 ----------------
     参考开源实践（OWASP 输入校验、idb-keyval 的写入约定、以及「写入前留一份好副本」的自愈模式）：
       · 解析一律走 safeJSON：JSON.parse 带 reviver，丢掉 __proto__ / constructor / prototype 键，
         防止「原型链污染」这类通过数据注入影响全局对象的攻击；
       · 读入的进度/错题数据一律过一遍白名单校验（键格式、类型、长度、数量上限），
         任何越界/异常字段都会被丢弃而不是带进内存与渲染层；
       · 每条记录带指纹 sig；读回时校验，不匹配就回滚到上一次正常副本，
         再不行就把坏数据隔离（quarantine）并以干净数据继续——坏数据永远不会污染正在使用的数据；
       · 单条记录序列化超过 3MB 拒绝写入，避免异常数据把存储写爆。 */
  var ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
  var MAX_REC_BYTES = 3 * 1024 * 1024;

  function isPlainObject(o) {
    return !!o && typeof o === "object" && !Array.isArray(o) && Object.getPrototypeOf(o) === Object.prototype;
  }
  function safeJSON(str) {
    try {
      return JSON.parse(String(str), function (k, v) {
        if (k === "__proto__" || k === "constructor" || k === "prototype") return undefined;
        return v;
      });
    } catch (e) { return null; }
  }
  function capStr(s, n) {
    s = String(s == null ? "" : s);
    return s.length > n ? s.slice(0, n) : s;
  }
  function capInt(v, min, max, dflt) {
    var n = (typeof v === "number" && isFinite(v)) ? Math.round(v) : NaN;
    if (!isFinite(n)) return dflt;
    return Math.min(max, Math.max(min, n));
  }
  function sanitizeAnswer(a) {
    if (Array.isArray(a)) return a.slice(0, 8).filter(function (x) { return typeof x === "number" && x >= 0 && x <= 7; });
    return (typeof a === "number" && a >= 0 && a <= 7) ? a : 0;
  }
  function sanitizeOpts(o) {
    return (Array.isArray(o) ? o : []).slice(0, 8).map(function (x) { return capStr(x, 300); });
  }
  /* 进度：只保留已知板块 + 合法考点 id；类型/上限全部收紧 */
  function sanitizeProgressData(d) {
    var out = {};
    if (!isPlainObject(d)) return out;
    Object.keys(d).forEach(function (bid) {
      if (!/^[a-z]{2}$/.test(bid)) return;
      var src = d[bid]; if (!isPlainObject(src)) return;
      var t = { done: {}, current: null, page: 0 }, n = 0;
      if (isPlainObject(src.done)) {
        Object.keys(src.done).forEach(function (id) {
          if (n >= 4000 || !ID_RE.test(id)) return;
          if (src.done[id]) { t.done[id] = 1; n++; }
        });
      }
      if (typeof src.current === "string" && ID_RE.test(src.current)) t.current = src.current;
      t.page = capInt(src.page, 0, 500, 0);
      out[bid] = t;
    });
    return out;
  }
  /* 错题库：字段白名单 + 类型/长度/数量上限 */
  function sanitizeWrongData(d) {
    var out = blankWrong();
    if (!isPlainObject(d)) return out;
    var qs = isPlainObject(d.q) ? d.q : {};
    Object.keys(qs).slice(0, 3000).forEach(function (id) {
      if (!ID_RE.test(id)) return;
      var e = qs[id]; if (!isPlainObject(e)) return;
      out.q[id] = {
        w: capInt(e.w, 0, 9999, 0), r: capInt(e.r, 0, 9999, 0), streak: capInt(e.streak, 0, 9999, 0),
        last: capInt(e.last, 0, 9999999999999, 0),
        b: capStr(e.b, 8), u: capStr(e.u, 16), j: capStr(e.j, 64),
        y: capInt(e.y, 0, 2100, 0), n: capInt(e.n, 0, 500, 0),
        q: capStr(e.q, 600), e: capStr(e.e, 3000),
        a: sanitizeAnswer(e.a), o: sanitizeOpts(e.o)
      };
    });
    ["b", "u"].forEach(function (grp) {
      var src = isPlainObject(d[grp]) ? d[grp] : {};
      Object.keys(src).slice(0, 200).forEach(function (k) {
        if (!ID_RE.test(k)) return;
        var s = src[k]; if (!isPlainObject(s)) return;
        out[grp][k] = { t: capInt(s.t, 0, 999999, 0), c: capInt(s.c, 0, 999999, 0) };
      });
    });
    (Array.isArray(d.rounds) ? d.rounds : []).slice(0, 30).forEach(function (rd) {
      if (!isPlainObject(rd)) return;
      out.rounds.push({
        at: capInt(rd.at, 0, 9999999999999, 0), label: capStr(rd.label, 40),
        t: capInt(rd.t, 0, 500, 0), c: capInt(rd.c, 0, 500, 0),
        ids: (Array.isArray(rd.ids) ? rd.ids : []).slice(0, 500).filter(function (x) { return typeof x === "string" && ID_RE.test(x); })
      });
    });
    if (isPlainObject(d.cleared)) {
      Object.keys(d.cleared).slice(0, 3000).forEach(function (id) {
        if (ID_RE.test(id)) out.cleared[id] = capInt(d.cleared[id], 0, 9999999999999, 0);
      });
    }
    return out;
  }
  /* 记录指纹：长度 + FNV-1a 散列（用于发现被篡改/损坏的数据，不用于安全加密） */
  function sigOf(data) {
    var s = "";
    try { s = JSON.stringify(data) || ""; } catch (e) { s = ""; }
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return "s1." + s.length.toString(36) + "." + h.toString(36);
  }
  /* 读回校验：指纹不符 → 回滚上一次正常副本 → 再不行就隔离坏数据 */
  function verifyRecords() {
    var restored = 0, quarantined = 0;
    Object.keys(mem).forEach(function (k) {
      if (k === "meta" || k === "session" || k.indexOf("acc:") === 0) return;
      if (k.indexOf("backup:") === 0) return;
      if (k.indexOf("quarantine:") === 0) return;
      var rec = mem[k];
      if (!isPlainObject(rec) || typeof rec.sig !== "string") return;   // 旧版记录无指纹：跳过（下次写入自动补上）
      if (rec.sig === sigOf(rec.data)) return;
      var bak = mem["backup:" + k];
      if (bak && isPlainObject(bak) && bak.sig === sigOf(bak.data)) {
        mem[k] = bak;
        dirtyKeys[k] = 1;                      // 回滚结果必须写回数据库，否则下次启动又会读到坏数据
        restored++;
      } else {
        var qk = "quarantine:" + k + ":" + Date.now();
        mem[qk] = rec;                         // 留住证据，便于排查
        dirtyKeys[qk] = 1;                     // 隔离副本落库
        delete mem[k];
        delRecInDb(k);                         // 坏记录从库里删掉（内存里已移出）
        quarantined++;
      }
    });
    if (restored || quarantined) flushNow();       // 把自愈结果立刻落库
    if (restored) toastOnce("检测到学习数据异常，已自动回滚到上一次正常状态");
    if (quarantined) toastOnce("检测到数据损坏，已隔离坏数据并继续使用（数据未被污染）");
    return { restored: restored, quarantined: quarantined };
  }

  /* ---- 内存读写（同步）与去抖落盘 ---- */
  function recData(key) { var r = mem[key]; return r ? r.data : null; }
  function recAt(key) { var r = mem[key]; return r ? (r.at || 0) : 0; }
  function setRec(key, data, noFlush) {
    var prev = mem[key];
    /* 落库前先规范化 + 限长：异常/超大数据不允许写进数据库 */
    var payload = data;
    if (key.indexOf("progress") === 0) payload = sanitizeProgressData(data);
    else if (key.indexOf("wrong") === 0) payload = sanitizeWrongData(data);
    var size = 0;
    try { size = (JSON.stringify(payload) || "").length; } catch (e) { size = MAX_REC_BYTES + 1; }
    if (size > MAX_REC_BYTES) {
      toastOnce("单条数据过大（超过 3MB），已拒绝写入以保护存储");
      return prev || null;
    }
    /* 覆盖前留住「上一次正常副本」，供自愈回滚 */
    if (prev && typeof prev.sig === "string") {
      try { if (prev.sig === sigOf(prev.data)) mem["backup:" + key] = prev; } catch (e) {}
    }
    mem[key] = { rev: (prev && prev.rev ? prev.rev : 0) + 1, at: Date.now(), data: payload, sig: sigOf(payload) };
    dirtyKeys[key] = 1;
    if (!noFlush) flushSoon();
    return mem[key];
  }
  function delRec(key) {
    if (mem[key]) { delete mem[key]; dirtyKeys[key] = 1; flushSoon(); }
    delete mem["backup:" + key];
    delRecInDb(key);
    delRecInDb("backup:" + key);
  }
  function flushSoon(ms) {
    if (flushTimer) return;
    flushTimer = setTimeout(function () { flushTimer = null; flushNow(); }, ms || 500);
  }
  function flushNow() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    var keys = Object.keys(dirtyKeys);
    dirtyKeys = {};
    keys.forEach(function (k) { if (mem[k]) putRec(k, mem[k], false); });   // 真正落盘
    broadcast({ type: "changed", keys: keys });
  }
  function broadcast(msg) {
    try {
      if (!bc && window.BroadcastChannel) bc = new BroadcastChannel("zzx-db");
      if (bc) bc.postMessage(msg);
    } catch (e) {}
  }
  function toastOnce(msg) {
    if (toastOnce._t) return;
    toastOnce._t = 1;
    setTimeout(function () { toastOnce._t = 0; }, 8000);
    toast(msg, 4200);
  }
  function authMode() { return document.body.classList.contains("auth-mode"); }
  /* 申请持久化存储：避免系统在空间紧张时清掉学习数据（PWA 通行做法） */
  function askPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    } catch (e) {}
  }
  function storageInfo() {
    if (navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate()
        .then(function (e) { return { used: e.usage || 0, quota: e.quota || 0 }; })
        .catch(function () { return { used: 0, quota: 0 }; });
    }
    return Promise.resolve({ used: 0, quota: 0 });
  }
  function clearImageCache() {
    if (typeof caches === "undefined" || !caches.keys) return Promise.resolve(false);
    return caches.keys().then(function (ks) {
      return Promise.all(ks.filter(function (k) { return k.indexOf("zzx-runtime") === 0; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return true; }).catch(function () { return false; });
  }
  /* 存储占用与清理：先说清数据在哪、占多少，再决定清什么（学习数据永远不动） */
  function showStorage() {
    storageInfo().then(function (i) {
      var mb = function (n) { return (n / 1048576).toFixed(1) + " MB"; };
      var keys = Object.keys(mem);
      var msg = "本机存储占用：" + mb(i.used) + "\n可用上限：" + (i.quota ? mb(i.quota) : "未知") +
        "\n\n账号数：" + accountNames().length +
        "\n进度记录：" + keys.filter(function (k) { return k.indexOf("progress:") === 0; }).length + " 个账号" +
        "\n错题库记录：" + keys.filter(function (k) { return k.indexOf("wrong:") === 0; }).length + " 个账号" +
        "\n\n点「确定」清理配图离线缓存（不影响任何学习进度，下次看图会自动重新下载）";
      if (confirm(msg)) {
        clearImageCache().then(function (ok) {
          toast(ok ? "配图缓存已清理，学习数据完好" : "清理失败，请稍后重试");
        });
      }
    });
  }
  /* ---- 合并：进度取并集；错题计数取最大；攻克（已清除）以标记为准 ----
     只有内容确实变了才提升 rev，避免两个标签页互相广播形成无限循环 */
  function mergeProgressData(localRec, remoteRec) {
    var older = ((localRec && localRec.at) || 0) >= ((remoteRec && remoteRec.at) || 0) ? remoteRec : localRec;
    var newer = older === localRec ? remoteRec : localRec;
    var out = {};
    [older, newer].forEach(function (r) {
      var src = (r && r.data) || {};
      Object.keys(src).forEach(function (b) {
        var s = src[b] || {};
        var t = out[b] || (out[b] = { done: {}, current: null, page: 0 });
        if (!t.done) t.done = {};
        Object.keys(s.done || {}).forEach(function (id) { if (s.done[id]) t.done[id] = 1; });   // 并集：已掌握只增不减
        if (s.current != null) t.current = s.current;
        if (s.page) t.page = s.page;
      });
    });
    return out;
  }
  function mergeWrongData(localRec, remoteRec) {
    var out = blankWrong();
    [localRec, remoteRec].forEach(function (r) {
      var src = (r && r.data) || null;
      if (!src) return;
      Object.keys(src.q || {}).forEach(function (id) {
        var b = src.q[id] || {}, a = out.q[id];
        if (!a) { out.q[id] = JSON.parse(JSON.stringify(b)); return; }
        a.w = Math.max(a.w || 0, b.w || 0); a.r = Math.max(a.r || 0, b.r || 0);
        a.streak = Math.max(a.streak || 0, b.streak || 0); a.last = Math.max(a.last || 0, b.last || 0);
      });
      ["b", "u"].forEach(function (grp) {
        Object.keys(src[grp] || {}).forEach(function (k) {
          var o = out[grp][k] || (out[grp][k] = { t: 0, c: 0 }), s = src[grp][k] || {};
          o.t = Math.max(o.t, s.t || 0); o.c = Math.max(o.c, s.c || 0);
        });
      });
      Object.keys(src.cleared || {}).forEach(function (id) { out.cleared[id] = Math.max(out.cleared[id] || 0, src.cleared[id] || 0); });
      (src.rounds || []).forEach(function (rd) {
        if (!out.rounds.some(function (x) { return x.at === rd.at; })) out.rounds.push(rd);
      });
    });
    Object.keys(out.cleared).forEach(function (id) { delete out.q[id]; });   // 已攻克的题不因合并而复活
    out.rounds.sort(function (a, b) { return b.at - a.at; });
    if (out.rounds.length > 20) out.rounds.length = 20;
    return out;
  }
  /* 合并单条记录：内容真的变了才写入并提版本 */
  function mergeRecFor(key, localRec, remoteRec) {
    var merged;
    if (key.indexOf("progress") === 0) merged = mergeProgressData(localRec, remoteRec);
    else if (key.indexOf("wrong") === 0) merged = mergeWrongData(localRec, remoteRec);
    else return { rec: remoteRec, changed: true };
    if (localRec && JSON.stringify(localRec.data) === JSON.stringify(merged)) {
      return { rec: localRec, changed: false };      // 已经一致：不提版本、不再广播
    }
    return {
      rec: { rev: Math.max((localRec && localRec.rev) || 0, (remoteRec && remoteRec.rev) || 0) + 1, at: Date.now(), data: merged },
      changed: true
    };
  }
  /* 从库中拉取并合并（切回前台 / 收到其它标签页广播时调用） */
  function syncAndMerge() {
    if (dbFailed) return Promise.resolve(false);
    return idbGetAll().then(function (rows) {
      var changed = false;
      Object.keys(rows).forEach(function (k) {
        var cur = mem[k], rec = rows[k];
        if (!cur) { mem[k] = rec; changed = true; return; }
        if ((rec.rev || 0) > (cur.rev || 0)) {           // 别处改过：合并而不是覆盖
          var m = mergeRecFor(k, cur, rec);
          if (m.changed) { mem[k] = m.rec; dirtyKeys[k] = 1; changed = true; }
        }
      });
      if (changed) { flushSoon(300); applyUserData(); }
      return changed;
    }).catch(function () { return false; });
  }
  /* 把内存里的当前账号数据同步到界面状态 */
  function applyUserData() {
    var p = recData("progress:" + (state.user || ""));
    var w = recData("wrong:" + (state.user || ""));
    if (p) progress = p;
    if (w && w.q) wrong = w;
    try { syncWrongBadge(); syncQuizTotal(); renderSidebar(); } catch (e) {}
    if (!$("viewHome") || $("viewHome").hidden) return;
    try { renderHome(); } catch (e) {}
  }
  function accountNames() {
    return Object.keys(mem).filter(function (k) { return k.indexOf("acc:") === 0; })
      .map(function (k) { return k.slice(4); });
  }
  function readAccounts() {
    var users = {};
    accountNames().forEach(function (n) { var d = recData("acc:" + n); if (d) users[n] = d; });
    return { users: users };
  }
  function writeAccounts(a) {
    Object.keys(a.users || {}).forEach(function (n) { setRec("acc:" + n, a.users[n]); });
  }
  /* 首次启动：把旧的 localStorage 数据整体搬进库（旧键保留，可回退） */
  function migrateLegacy() {
    if (mem["meta"]) return 0;
    var n = 0;
    try {
      var accRaw = localStorage.getItem("zzx.accounts.v1");
      if (accRaw) {
        var a = safeJSON(accRaw);
        Object.keys((a && a.users) || {}).forEach(function (u) {
          if (/^[A-Za-z0-9\u4e00-\u9fa5._-]{1,20}$/.test(u)) { setRec("acc:" + u, a.users[u], true); n++; }
        });
      }
      var sesRaw = localStorage.getItem("zzx.session.v1") || sessionStorage.getItem("zzx.session.v1");
      if (sesRaw) { var sr = safeJSON(sesRaw); if (isPlainObject(sr)) { setRec("session", sr, true); n++; } }
      var keys = [];
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && (k.indexOf("zzx.progress.v1") === 0 || k.indexOf("zzx.wrong.v1") === 0)) keys.push(k);
        }
      } catch (e) {}
      keys.forEach(function (k) {
        var user = k.indexOf("::") >= 0 ? k.slice(k.indexOf("::") + 2) : "";
        var kind = k.indexOf("zzx.progress.v1") === 0 ? "progress" : "wrong";
        try {
          var v = JSON.parse(localStorage.getItem(k));
          if (v && !mem[kind + ":" + user]) { setRec(kind + ":" + user, v, true); n++; }
        } catch (e) {}
      });
    } catch (e) {}
    setRec("meta", { v: 1, migratedAt: Date.now(), n: n }, true);
    flushNow();
    return n;
  }
  function b64encode(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function b64decode(str) {
    var s = atob(str || ""), b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  /* 密码散列：优先 WebCrypto PBKDF2（HTTPS/localhost 可用），否则退化为加盐散列（仅本机校验） */
  function hashPassword(pw, saltB64, iter) {
    var wc = window.crypto;
    if (wc && wc.subtle && wc.subtle.importKey && window.TextEncoder) {
      var enc = new TextEncoder();
      return wc.subtle.importKey("raw", enc.encode(String(pw)), "PBKDF2", false, ["deriveBits"])
        .then(function (k) {
          return wc.subtle.deriveBits({ name: "PBKDF2", salt: b64decode(saltB64), iterations: iter || PBKDF2_ITER, hash: "SHA-256" }, k, 256);
        })
        .then(function (bits) { return "p2" + b64encode(bits); })
        .catch(function () { return "h" + hashStr(saltB64 + "|" + pw + "|" + iter); });
    }
    return Promise.resolve("h" + hashStr(saltB64 + "|" + pw + "|" + iter));
  }
  function newSalt() {
    var a = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(a);
    else for (var i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256);
    return b64encode(a);
  }
  function registerAccount(name, pw) {
    name = String(name || "").trim();
    var a = readAccounts();
    if (!name) return Promise.reject(new Error("请输入用户名"));
    /* 用户名白名单：只允许中英文、数字、下划线、点、短横线，1-20 位。
       这样用户名不会带进数据库键名里造成键空间混淆，也不会在页面上形成注入面 */
    if (!/^[A-Za-z0-9\u4e00-\u9fa5._-]{1,20}$/.test(name)) {
      return Promise.reject(new Error("用户名只能用中英文、数字、下划线、点与短横线（1-20 位）"));
    }
    if (a.users[name]) return Promise.reject(new Error("该用户名已存在，请直接登录"));
    if (Object.keys(a.users).length >= 20) return Promise.reject(new Error("本机最多保存 20 个账号"));
    if (String(pw || "").length < 4) return Promise.reject(new Error("密码至少 4 位"));
    if (String(pw || "").length > 64) return Promise.reject(new Error("密码最多 64 位"));
    var salt = newSalt();
    return hashPassword(pw, salt, PBKDF2_ITER).then(function (hash) {
      a.users[name] = { salt: salt, iter: PBKDF2_ITER, hash: hash, at: Date.now() };
      writeAccounts(a);
      adoptLegacyData(name);
      return name;
    });
  }
  function loginAccount(name, pw) {
    name = String(name || "").trim();
    var u = readAccounts().users[name];
    if (!u) return Promise.reject(new Error("用户名不存在，请先注册"));
    return hashPassword(pw, u.salt, u.iter || PBKDF2_ITER).then(function (h) {
      if (h !== u.hash) throw new Error("密码不正确");
      return name;
    });
  }
  /* 会话：记住登录状态（存库）；不勾选时只放在 sessionStorage，关闭即失效 */
  function setSession(name, remember) {
    if (remember) setRec("session", { user: name, at: Date.now() });
    else delRec("session");
    try {
      if (remember) sessionStorage.removeItem(SSESS_KEY);
      else sessionStorage.setItem(SSESS_KEY, JSON.stringify({ user: name, at: Date.now() }));
    } catch (e) {}
  }
  function readSession() {
    var d = recData("session");
    if (d && d.user && readAccounts().users[d.user]) return d.user;
    try {                                        // 兜底：本次会话内的临时登录
      var t = safeJSON(sessionStorage.getItem(SSESS_KEY) || "null");
      if (isPlainObject(t) && t.user && readAccounts().users[t.user]) return t.user;
    } catch (e) {}
    try {                                        // 兜底：旧版本留在 localStorage 的会话
      var old = safeJSON(localStorage.getItem("zzx.session.v1") || "null");
      if (isPlainObject(old) && old.user && readAccounts().users[old.user]) return old.user;
    } catch (e) {}
    return null;
  }
  function clearSession() {
    delRec("session");
    try { sessionStorage.removeItem(SSESS_KEY); localStorage.removeItem("zzx.session.v1"); } catch (e) {}
  }
  function lastName() { try { return localStorage.getItem(LAST_KEY) || ""; } catch (e) { return ""; } }
  function rememberName(u) { try { localStorage.setItem(LAST_KEY, u); } catch (e) {} }
  /* 按账号隔离数据键：progress:<用户名> / wrong:<用户名>；空用户名 = 本机身份 */
  function userKey(base) { return base + ":" + (state.user || ""); }
  /* 首个注册的账号承接升级前（本机身份）的历史数据 */
  function adoptLegacyData(name) {
    if (accountNames().length !== 1) return;
    ["progress", "wrong"].forEach(function (kind) {
      var g = recData(kind + ":");
      if (g && !recData(kind + ":" + name)) setRec(kind + ":" + name, g);
    });
  }

  var progress = {};
  var searchHits = [];
  var searchKind = "";
  var quiz = { list: [], i: 0, right: 0, answered: false, seed: 0, picked: [], filter: "all", label: "", wrongIds: [] };
  var caseIndex = null;

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  /* 整十/整五/整百周年数字红色高亮：匹配 "XX周年" 或 "XX 周年"，数字能被 5 整除即高亮。
     先做 HTML 转义再插入高亮标签——任何来自数据/导入文件的字符串都不会变成可执行标记 */
  function hl(s) {
    return esc(s).replace(/(\d+)\s*周年/g, function (m, n) {
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
    return sanitizeProgressData(recData(userKey(STORE_KEY)));
  }
  function saveProgress() {
    if (document.body.classList.contains("auth-mode")) return;   // 登录页上不写入，避免串账号
    setRec(userKey(STORE_KEY), progress);
  }
  /* 导出/导入：账号数据可在设备之间搬运，也是备份手段 */
  function exportData() {
    try {
      var payload = { app: "zzx", v: 1, user: state.user || "本机", at: Date.now(), progress: progress, wrong: wrong };
      var blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "政治线-学习数据-" + (state.user || "本机") + ".json";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast("已导出学习数据，可用于备份或换机恢复");
    } catch (e) { toast("导出失败，请更换浏览器重试"); }
  }
  function importData(file, inputEl) {
    /* 导入是唯一的「外部数据入口」，按不可信输入处理：
       限大小 → 原型链安全解析 → 白名单校验 → 才允许写入。
       注意：必须等 FileReader 读完再清空 input——过早置空会让文件句柄失效，读不到内容 */
    if (!file) return;
    function resetInput() { try { if (inputEl) inputEl.value = ""; } catch (e) {} }
    if (file.size > 2 * 1024 * 1024) { toast("文件过大（超过 2MB），已拒绝导入"); resetInput(); return; }
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var d = safeJSON(fr.result);
        if (!isPlainObject(d) || (!d.progress && !isPlainObject(d.wrong))) { toast("文件格式不正确，导入失败"); return; }
        if (!confirm("导入会覆盖当前账号的进度与错题库，确定继续？")) return;
        var np = sanitizeProgressData(d.progress);
        var nw = sanitizeWrongData(d.wrong);
        if (!Object.keys(np).length && !Object.keys(nw.q).length) { toast("文件里没有可用的学习数据"); return; }
        progress = np; saveProgress();
        wrong = nw; saveWrong();
        indexAll(); renderSidebar(); renderHome(); syncWrongBadge();
        toast("已导入：进度 " + Object.keys(np).length + " 个板块 · 错题 " + Object.keys(nw.q).length + " 道" +
          (typeof d.user === "string" ? "（来自 " + capStr(d.user, 20) + "）" : ""));
      } catch (e) { toast("文件格式不正确，导入失败"); }
      resetInput();
    };
    fr.onerror = function () { toast("读取文件失败"); resetInput(); };
    fr.readAsText(file);
  }
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

  /* ---------------- 错题库 / 薄弱度统计 ----------------
     localStorage: zzx.wrong.v1
     { q:{[qid]:{w,r,streak,last,b,u,j,y,n,q,o,a,e}}, b:{板块:{t,c}}, u:{单元:{t,c}}, rounds:[{at,label,t,c,ids}] }
     t=作答数 c=答对数 w=答错累计 r=答对累计 streak=连续答对（满 2 次视为已攻克，自动移出错题库） */
  function blankWrong() { return { q: {}, b: {}, u: {}, rounds: [], cleared: {} }; }
  function loadWrong() {
    return sanitizeWrongData(recData(userKey(WRONG_KEY)));
  }
  var wrong = blankWrong();
  function saveWrong() {
    if (document.body.classList.contains("auth-mode")) return;   // 登录页上不写入，避免串账号
    setRec(userKey(WRONG_KEY), wrong);
  }
  function hashStr(s) {
    var h = 5381;
    s = String(s == null ? "" : s);
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  /* 题目稳定 id：真题＝年份+题号；自测题＝板块+单元+题干哈希（题库重排也不变） */
  function qidOf(q, b, idx) {
    if (q.y && q.n) return "z" + q.y + "." + q.n;
    return "s" + (b || "x") + "-" + (q.u || "") + "-" + hashStr(q.q || String(idx));
  }
  function wrongCount() { return Object.keys(wrong.q).length; }
  function accOf(o) { return o && o.t ? Math.round(o.c / o.t * 100) : 0; }
  function syncWrongBadge() {
    var el = $("wrongBadge");
    if (!el) return;
    var n = wrongCount();
    el.textContent = n ? n + " 道待攻克" : "暂无错题";
  }
  /* 一道题作答后：累计板块/单元正确率，并把错题写进错题库 */
  function recordResult(it, ok) {
    if (!it || !it.id) return;
    if (it.b) { var pb = wrong.b[it.b] || (wrong.b[it.b] = { t: 0, c: 0 }); pb.t++; if (ok) pb.c++; }
    if (it.u) { var pu = wrong.u[it.u] || (wrong.u[it.u] = { t: 0, c: 0 }); pu.t++; if (ok) pu.c++; }
    var e = wrong.q[it.id];
    if (ok) {
      if (e) {
        e.r = (e.r || 0) + 1;
        e.streak = (e.streak || 0) + 1;
        if (e.streak >= 2) { delete wrong.q[it.id]; wrong.cleared[it.id] = Date.now(); } // 连对两次＝已攻克（记清除标记，合并时不会复活）
      }
    } else {
      if (!e) {
        e = wrong.q[it.id] = {
          w: 0, r: 0, streak: 0, last: 0,
          b: it.b || "", u: it.u || "", j: it.j || "", y: it.y || 0, n: it.n || 0,
          q: it.q || "", o: it.o || [], a: it.a, e: it.e || ""
        };
      }
      e.w = (e.w || 0) + 1;
      e.streak = 0;
      e.last = Date.now();
    }
    saveWrong();
    syncWrongBadge();
  }
  function wrongRemove(id) {
    if (wrong.q[id]) {
      delete wrong.q[id];
      wrong.cleared[id] = Date.now();     // 手动移出也算"已处理"，合并时不会复活
      saveWrong(); syncWrongBadge();
    }
  }
  /* 板块薄弱度（含错题数） */
  function weakBoards() {
    return BOARDS.map(function (b) {
      var o = wrong.b[b.id] || { t: 0, c: 0 };
      var wn = 0;
      Object.keys(wrong.q).forEach(function (k) { if (wrong.q[k].b === b.id) wn++; });
      return { id: b.id, name: b.short, color: b.color, t: o.t, c: o.c, acc: accOf(o), wrong: wn };
    });
  }
  /* 单元薄弱度，按正确率升序 */
  function weakUnits(limit) {
    var arr = [];
    Object.keys(wrong.u).forEach(function (uid) {
      var o = wrong.u[uid];
      var bd = String(uid).replace(/\d+$/, "");
      var wn = 0;
      Object.keys(wrong.q).forEach(function (k) { if (wrong.q[k].u === uid) wn++; });
      arr.push({ id: uid, name: unitNameOf(uid), board: bd, boardName: bName(bd), t: o.t, c: o.c, acc: accOf(o), wrong: wn });
    });
    arr.sort(function (a, b) { return (a.acc - b.acc) || (b.wrong - a.wrong) || (b.t - a.t); });
    return limit ? arr.slice(0, limit) : arr;
  }
  function answerText(e) {
    var arr = Array.isArray(e.a) ? e.a : [e.a];
    return arr.map(function (i) { return String.fromCharCode(65 + i) + "．" + ((e.o && e.o[i]) || ""); }).join("　");
  }
  function shortStem(s) {
    s = String(s || "");
    return s.length > 22 ? s.slice(0, 22) + "…" : s;
  }

  /* ---------------- 数据 ---------------- */
  function getBoard(id) { return (window.ZZX || {})[id] || null; }
  function loadScript(src) {
    return new Promise(function (resolve) {
      var done = false, timer = 0;
      function finish(ok) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ok);
      }
      function inject(url) {
        var sc = document.createElement("script");
        sc.src = url;
        sc.onload = function () { finish(true); };
        sc.onerror = function () {
          /* 首次失败：稍后换参数重试一次，规避偶发网络/缓存故障 */
          if (url.indexOf("zzxretry=1") < 0) {
            setTimeout(function () { inject(src + (src.indexOf("?") < 0 ? "?" : "&") + "zzxretry=1"); }, 1200);
          } else { finish(false); }
        };
        document.head.appendChild(sc);
      }
      /* 超时兜底：请求悬挂时也不让启动流程无限等待 */
      timer = setTimeout(function () { finish(false); }, 15000);
      inject(src);
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
  function toast(msg, ms) {
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    requestAnimationFrame(function () { t.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove("show"); t.onclick = null;
      setTimeout(function () { t.hidden = true; }, 260);
    }, ms || 1700);
  }
  function openSidebar() { dom.sidebar.classList.add("open"); dom.scrim.hidden = false; requestAnimationFrame(function () { dom.scrim.classList.add("show"); }); }
  function closeSidebar() {
    if (!dom.sidebar) return;
    dom.sidebar.classList.remove("open");
    dom.scrim.classList.remove("show");
    setTimeout(function () { dom.scrim.hidden = true; }, 260);
  }

  function show(view) {
    closeSidebar(); // 任何视图切换都收起侧边栏，避免浮层压住内容
    ["viewHome", "viewStudy", "viewQuiz", "viewLine", "viewCase", "viewEssay", "viewAnalysis", "viewAuth"].forEach(function (v) { $(v).hidden = true; });
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
    syncQuizTotal();
    syncWrongBadge();
  }
  /* 题库改为按需加载（体积较大，不阻塞首屏），未加载时给出中性文案；
     加载完成后原地补数字，不重排页面 */
  function syncQuizTotal() {
    var el = $("quizTotal");
    if (el) el.textContent = quizLoaded() ? quizAll().length + " 题" : "点开即用";
    var hn = $("heroQuizN");
    if (hn && quizLoaded()) hn.textContent = quizAll().length;
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
      '<div><b id="heroQuizN">' + (quizLoaded() ? quizAll().length : "—") + "</b><span>自测题</span></div>" +
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
    show("viewHome");                     // 关键：渲染首页时必须切到首页
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
  /* 配图加载状态：图片本身已全部转为 baseline JPEG（不存在渐进式模糊帧），
     因此直接交给浏览器原生加载即可，最稳：不接管 src、不做解码门控、
     不设超时兜底，任何环境下都不会出现"永远加载不出来" */
  function markShots() {
    var imgs = $("viewStudy").querySelectorAll("img.shot");
    for (var i = 0; i < imgs.length; i++) {
      (function (im) {
        if (im.dataset.shotReady === "1") return;
        im.dataset.shotReady = "1";
        if (im.complete) {                       // 已结束（成功或失败）
          if (!im.naturalWidth) im.classList.add("img-broken");
          return;
        }
        im.classList.add("is-pending");          // 静态占位，纯装饰
        var fig = im.parentNode;
        if (fig && fig.classList) fig.classList.add("is-loading");   // 显示「配图加载中…」，不再是一团灰雾
        function ok() {
          im.classList.remove("is-pending");
          if (fig && fig.classList) { fig.classList.remove("is-broken"); fig.classList.remove("is-loading"); }
        }
        function bad() {
          im.classList.remove("is-pending"); im.classList.add("img-broken");
          if (fig && fig.classList) { fig.classList.remove("is-loading"); fig.classList.add("is-broken"); }
        }
        im.addEventListener("load", ok);
        im.addEventListener("error", bad);
        /* 纯装饰性兜底：只清理样式类，绝不触碰 src，避免任何"卡住"的可能 */
        setTimeout(function () {
          if (!im.complete) return;
          if (im.naturalWidth) ok(); else bad();
        }, 3000);
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
    h += '<span class="tagline k-' + esc(KIND_LABEL[it.kind] ? it.kind : "topic") + '">' + (KIND_LABEL[it.kind] || "考点") + "</span>";
    if (it.dateLabel) h += ' <span class="ym">' + esc(it.dateLabel) + "</span>";
    if (it.anniv) h += ' <span class="anniv-badge">本年度整周年重点 · ' + esc(it.anniv) + " 周年</span>";
    h += "<h2>" + hl(it.title) + "</h2>";
    if (it.sub) h += '<p class="sub">' + hl(it.sub) + "</p>";
    if (it.tags && it.tags.length) h += '<div class="item-tags">' + it.tags.map(function (t) {
      return '<button type="button" class="chip" data-tag="' + esc(t) + '">' + hl(t) + "</button>";
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
    var p = subProgress(state.boardId);
    var isDone = !!(p.done && p.done[it.id]);
    $("actionbar").innerHTML =
      '<button class="btn" id="prevBtn" type="button"' + (state.index === 0 && state.page === 0 ? " disabled" : "") + ">上一条</button>" +
      '<button class="btn' + (isDone ? " btn-done" : "") + '" id="doneBtn" type="button">' + (isDone ? "已掌握 ✓" : "标记已掌握") + "</button>" +
      (state.page < pages - 1
        ? '<button class="btn btn-primary" id="nextBtn" type="button">下一页 ' + (state.page + 2) + "/" + pages + "</button>"
        : '<button class="btn btn-primary" id="nextBtn" type="button"' + (state.index >= list.length - 1 ? " disabled" : "") + ">下一条</button>");
    $("actionbar").hidden = false;
  }
  /* 标记/取消「已掌握」：学习进度的核心数据（只增不减，多标签页合并时取并集） */
  function toggleDone() {
    var list = filteredItems();
    var it = list[state.index];
    if (!it) return;
    var p = subProgress(state.boardId);
    if (p.done[it.id]) { delete p.done[it.id]; toast("已取消「已掌握」"); }
    else { p.done[it.id] = 1; toast("已标记为掌握 · " + doneCount(state.boardId) + "/" + list.length); }
    saveProgress();
    renderStudy();
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

  /* 进入某板块的某个单元（错题库/薄弱分析里的「去学这个单元」） */
  function openUnit(bid, uid) {
    return loadAll().then(function () {
      indexAll();
      state.boardId = bid;
      state.unitId = uid || null;
      state.kind = "";
      state.index = 0; state.page = 0; navSmooth = false;
      if (uid && !filteredItems().length) state.unitId = null; // 该单元暂时没有考点则退回整个板块
      renderStudy(); renderSidebar();
      closeSidebar();
      if (uid) toast("已定位到 " + bName(bid) + " · " + unitNameOf(uid) + "，从第 1 条开始");
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
        (it.kind ? '<span class="tagline k-' + esc(KIND_LABEL[it.kind] ? it.kind : "topic") + '">' + (KIND_LABEL[it.kind] || "") + "</span>" : "") + "</div></div></div>";
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
          "<p>" + esc(x.c.a) + "</p>" +
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
  /* 题库按需加载：加载完成前首页/侧栏的数字显示占位，完成后原地补上，不重排页面 */
  function quizLoaded() { return !!quizBank; }

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
      quizBank = (window.ZZX_QUIZ || []).map(function (q, idx) {
        var bd = quizBoardOf(q);
        return { id: qidOf(q, bd, idx), y: q.y, n: q.n, u: q.u || "", b: bd, q: q.q, o: q.o || [], a: q.a, e: q.e || "", j: q.j || "" };
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
      quiz.i = 0; quiz.right = 0; quiz.answered = false; quiz.picked = []; quiz.wrongIds = []; quiz.finished = false;
      if (filter !== "all" && filter.indexOf(":") < 0) state.boardId = filter;
      show("viewQuiz"); renderQuiz();
    });
  }
  function renderQuiz() {
    var q = quiz.list[quiz.i];
    var h = '<div class="wrap quiz-page">';
    if (!q) { renderHome(); return; }
    var multi = isMulti(q);
    h += '<div class="quiz-card">';
    h += '<div class="crumb"><span>' + esc(quiz.label || "自测练习") + "</span><span>·</span><span>第 " + (quiz.i + 1) + " / " + quiz.list.length + " 题</span>" +
      (q.y ? "<span>·</span><span>" + q.y + " 年第 " + q.n + " 题</span>" : "") + "</div>";
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
  /* 答完一题后一定能“去对应章节”复习：
     有关联考点就直接跳考点；没有关联考点时按「该题所属单元 → 整个板块」回退，保证每题都能跳 */
  function quizJumpHtml(q) {
    var acts = "";
    if (q.j && findItem(q.j)) {
      acts += '<button type="button" data-jump="' + esc(q.j) + '"><i>考点</i>去学这道题的考点</button>';
    }
    if (q.b && q.u) {
      acts += '<button type="button" data-unitgo="' + esc(q.b + "|" + q.u) + '"><i>章节</i>去学' + esc(unitNameOf(q.u) || bName(q.b)) + "</button>";
    } else if (q.b) {
      acts += '<button type="button" data-unitgo="' + esc(q.b + "|") + '"><i>板块</i>去学' + esc(bName(q.b)) + "</button>";
    }
    if (!acts) return "";
    return '<div class="b-link" style="margin-top:10px">' + acts + "</div>";
  }
  function judgeQuiz(picked) {
    if (quiz.answered) return;
    var q = quiz.list[quiz.i];
    var right = Array.isArray(q.a) ? q.a : [q.a];
    var ok = picked.length === right.length && picked.every(function (v) { return right.indexOf(v) >= 0; });
    quiz.answered = true;
    if (ok) quiz.right++;
    /* 写入错题库与板块/单元正确率统计 */
    recordResult(q, ok);
    if (!ok && q.id) quiz.wrongIds.push(q.id);
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
      quizJumpHtml(q) + "</div>";
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
      /* 上一轮没做完（例如中途跳去复习）就给一个继续入口，不用重头再抽题 */
      if (quiz.list.length && !quiz.finished) {
        h += '<div class="sec-title">继续</div><div class="cards">' +
          '<button type="button" class="card" data-quizresume="1" style="--cc:var(--accent)"><div class="card-top"><b>继续上次练习</b><span class="bdg">第 ' +
          (quiz.i + 1) + " / " + quiz.list.length + ' 题</span></div><p>' + esc(quiz.label || "自测") + " · 已答对 " + quiz.right + " 题</p></button></div>";
      }
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
  /* 一轮答完：记入历史并展示本轮成绩分析 */
  function finishRound() {
    var t = quiz.list.length, c = quiz.right;
    quiz.finished = true;
    wrong.rounds.unshift({ at: Date.now(), label: quiz.label || "自测", t: t, c: c, ids: quiz.wrongIds.slice() });
    if (wrong.rounds.length > 20) wrong.rounds.length = 20;
    saveWrong();
    renderAnalysis("now");
    toast(quiz.label + "：答对 " + c + " / " + t + " 题，已更新薄弱度分析");
  }

  /* ---------------- 错题与薄弱分析 ---------------- */
  var analTab = "weak";
  function statCell(v, label) {
    return '<div class="stat-cell"><b>' + v + "</b><span>" + label + "</span></div>";
  }
  function accBar(acc, ok) {
    return '<div class="acc-bar' + (ok ? " ok" : "") + '"><i style="width:' + Math.max(acc, 2) + '%"></i></div>';
  }
  function wrongItemHtml(id, e) {
    var bdName = e.b ? bName(e.b) : "未标注板块";
    var un = e.u ? unitNameOf(e.u) : "";
    var tip = e.e;
    if (!tip) {
      tip = "本题出自 " + (e.y || "") + " 年考研政治真题第 " + (e.n || "") + " 题，考点属于「" + bdName + (un ? " · " + un : "") +
        "」，正确答案 " + letters(e.a) + "。建议先把该单元的考点按顺序过一遍，再回来重做这道题。";
    }
    var acts = "";
    if (e.j) acts += '<button type="button" class="primary" data-jump="' + esc(e.j) + '"><i>考点</i>去看对应考点</button>';
    if (e.b && e.u) acts += '<button type="button" data-unitgo="' + esc(e.b + "|" + e.u) + '"><i>模块</i>去学' + esc(un || bdName) + "</button>";
    acts += '<button type="button" data-wdel="' + esc(id) + '">移出错题库</button>';
    return '<div class="wrong-item"><h4>' + esc(e.q) + "</h4>" +
      '<div class="wrong-meta"><span class="hot">错 ' + (e.w || 1) + " 次</span>" +
      (e.r ? "<span>答对 " + e.r + " 次</span>" : "") +
      "<span>" + esc(bdName) + (un ? " · " + esc(un) : "") + "</span>" +
      (e.y ? "<span>" + e.y + " 年第 " + e.n + " 题</span>" : "<span>自测题</span>") + "</div>" +
      '<div class="wrong-point"><b>正确答案：' + esc(answerText(e)) + "</b><p>" + esc(tip) + "</p></div>" +
      '<div class="wrong-act">' + acts + "</div></div>";
  }
  function renderNowTab() {
    var rd = wrong.rounds[0];
    if (!rd) {
      return '<div class="empty-tip">还没有完成过一轮自测。做完一轮后，这里会给出本轮正确率、本轮错题清单与最该补的板块。<div class="wrong-act" style="margin-top:12px">' +
        '<button type="button" class="primary" data-quiz="all">开始一轮自测（12 题）</button></div></div>';
    }
    var acc = rd.t ? Math.round(rd.c / rd.t * 100) : 0;
    var ids = (rd.ids || []).filter(function (id) { return wrong.q[id]; });
    var when = new Date(rd.at);
    var h = '<div class="stat-grid">' + statCell(acc + "%", "本轮正确率") + statCell(rd.c + " / " + rd.t, "答对 / 总题") + statCell(ids.length, "本轮错题") + "</div>";
    h += '<div class="zone" style="padding:12px 15px"><p style="margin:0 0 8px;font-size:13px;color:var(--fg-2)">' +
      esc(rd.label) + " · " + when.getMonth() + 1 + " 月 " + when.getDate() + " 日 " + (when.getHours() < 10 ? "0" : "") + when.getHours() + ":" + (when.getMinutes() < 10 ? "0" : "") + when.getMinutes() + "</p>" + accBar(acc, acc >= 80) + "</div>";
    h += '<div class="wrong-act" style="margin:12px 0 14px">' +
      '<button type="button" class="primary" data-quiz="all">再测一轮（12 题）</button>' +
      '<button type="button" data-anal="wrong">查看错题库</button>' +
      '<button type="button" data-anal="weak">看薄弱度分析</button></div>';
    if (ids.length) {
      h += '<div class="sec-title">本轮错题 ' + ids.length + " 道（已存入错题库）</div>";
      ids.forEach(function (id) { h += wrongItemHtml(id, wrong.q[id]); });
    } else {
      h += '<div class="sec-title">本轮错题</div><div class="empty-tip">本轮全对，没有新增错题。可以切换到「薄弱度分析」看看累计哪一块最弱。</div>';
    }
    return h;
  }
  function renderWeakTab() {
    var rows = weakBoards().filter(function (x) { return x.t > 0; });
    if (!rows.length) {
      return '<div class="empty-tip">还没有答题记录。先去「随机自测练习」做一轮，回来就能看到板块与单元的正确率排行和补强建议。</div>';
    }
    var ranked = rows.slice().sort(function (a, b) { return (a.acc - b.acc) || (b.wrong - a.wrong); });
    var weak = null;
    for (var i = 0; i < ranked.length; i++) { if (ranked[i].t >= 3) { weak = ranked[i]; break; } }
    if (!weak) weak = ranked[0];

    var h = '<div class="sec-title">板块薄弱度（正确率由低到高）</div><div class="zone" style="padding:6px 15px">';
    ranked.forEach(function (x) {
      var isWeak = x.id === weak.id;
      h += '<div class="weak-row' + (isWeak ? " is-weak" : "") + '">' +
        '<span class="wn"' + (isWeak ? "" : ' style="color:' + x.color + '"') + ">" + esc(x.name) + "</span>" +
        '<div class="wm">' + accBar(x.acc, x.acc >= 80) + "</div>" +
        '<span class="wv">' + x.acc + "% · " + x.c + "/" + x.t + " 题" + (x.wrong ? " · 错 " + x.wrong : "") + "</span></div>";
    });
    h += "</div>";

    var units = weakUnits(5);
    var wu = null;
    for (var k = 0; k < units.length; k++) { if (units[k].t >= 2) { wu = units[k]; break; } }
    if (!wu) wu = units[0];
    if (wu) {
      h += '<div class="weak-tip"><b>最该补的模块：' + esc(wu.boardName) + " · " + esc(wu.name) + "</b>" +
        "<p>正确率 " + wu.acc + "%（" + wu.c + " / " + wu.t + " 题）" + (wu.wrong ? "，错题库里还有 " + wu.wrong + " 道该单元的题" : "") +
        "。建议先按考点顺序把该单元过一遍，再回错题库把这些题重做一遍——连对两次即自动移出错题库。</p>" +
        '<div class="wrong-act"><button type="button" class="primary" data-unitgo="' + esc(wu.board + "|" + wu.id) + '">去学这个单元</button>' +
        '<button type="button" data-anal="wrong">看错题库</button></div></div>';
    }
    if (units.length) {
      h += '<div class="sec-title">单元薄弱 Top ' + units.length + "</div><div class=\"zone\" style=\"padding:6px 15px\">";
      units.forEach(function (x) {
        h += '<div class="weak-row"><span class="wn" style="color:' + bColor(x.board) + '">' + esc(x.boardName) + "</span>" +
          '<div class="wm"><b style="font-size:12.5px">' + esc(x.name) + "</b>" + accBar(x.acc, x.acc >= 80) + "</div>" +
          '<span class="wv">' + x.acc + "%</span>" +
          '<button type="button" class="chip chip-sm" data-unitgo="' + esc(x.board + "|" + x.id) + '">去学</button></div>';
      });
      h += "</div>";
    }
    return h;
  }
  function renderWrongTab() {
    var ids = Object.keys(wrong.q).sort(function (a, b) {
      return ((wrong.q[b].w || 0) - (wrong.q[a].w || 0)) || ((wrong.q[b].last || 0) - (wrong.q[a].last || 0));
    });
    if (!ids.length) return '<div class="empty-tip">错题库是空的。做错的题会自动收进来；同一道题连对两次会自动移出。</div>';
    var h = '<div class="sec-title">错题库 · 共 ' + ids.length + " 道（按错误次数排序）</div>";
    ids.forEach(function (id) { h += wrongItemHtml(id, wrong.q[id]); });
    return h;
  }
  function renderAnalysis(tab) {
    if (tab) analTab = tab;
    loadAll().then(function () {
      indexAll();
      var tq = 0, tc = 0;
      Object.keys(wrong.b).forEach(function (k) { tq += wrong.b[k].t || 0; tc += wrong.b[k].c || 0; });
      var wn = wrongCount();
      var acc = tq ? Math.round(tc / tq * 100) : 0;
      var tabs = [["now", "本轮成绩"], ["weak", "薄弱度分析"], ["wrong", "错题库 " + wn]];
      var h = '<div class="wrap">';
      h += '<div class="hero"><h1>错题与薄弱分析</h1><p>累计作答 ' + tq + " 题，正确率 " + acc + "%，错题库待攻克 " + wn +
        " 道。每答一题自动更新板块与单元的正确率；同一道错题连对两次即自动移出错题库。</p></div>";
      h += '<div class="axis-switch anal-tabs">' + tabs.map(function (a) {
        return '<button type="button" class="chip' + (analTab === a[0] ? " on" : "") + '" data-anal="' + a[0] + '">' + a[1] + "</button>";
      }).join("") + "</div>";
      if (analTab === "now") h += renderNowTab();
      else if (analTab === "wrong") h += renderWrongTab();
      else h += renderWeakTab();
      h += "</div>";
      $("viewAnalysis").innerHTML = h;
      show("viewAnalysis");
      $("topTitle").textContent = "错题与薄弱分析";
      $("topSub").textContent = "累计 " + tq + " 题 · 正确率 " + acc + "% · 错题 " + wn + " 道";
      $("progressStrip").hidden = true;
      $("actionbar").hidden = true;
      syncWrongBadge();
      closeSidebar();
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
  /* 回到主界面（首页五大板块），并清理顶部进度条与底部操作栏 */
  function goHome() {
    if (document.body.classList.contains("auth-mode")) return;
    loadAll().then(function () {
      indexAll(); renderSidebar(); renderHome();
      show("viewHome");
      var v = $("viewHome");
      if (v) v.scrollTop = 0;
      $("topTitle").textContent = "政治线";
      $("topSub").textContent = "选择板块开始学习";
      $("progressStrip").hidden = true;
      $("actionbar").hidden = true;
      closeSidebar();
    });
  }
  function bind() {
    dom.sidebar = $("sidebar"); dom.scrim = $("scrim");
    $("menuBtn").onclick = openSidebar;
    $("scrim").onclick = closeSidebar;
    $("sideClose").onclick = closeSidebar;
    $("themeBtn").onclick = cycleTheme;
    $("imgBtn").onclick = function () {
      state.imgMode = state.imgMode === "on" ? "off" : "on";
      localStorage.setItem(IMG_KEY, state.imgMode); syncImgBtn();
      if (!$("viewStudy").hidden) renderStudy();
      else if (!$("viewHome").hidden) renderHome();   // 只在首页时重绘首页，不强行切视图
      toast("配图已" + (state.imgMode === "on" ? "显示" : "隐藏"));
    };
    if ($("cacheBtn")) $("cacheBtn").onclick = function () {
      if (!confirm("将重新下载页面与配图（学习进度、错题库不受影响）。继续？")) return;
      hardReset();
    };
    /* 不关闭侧栏：下载进度直接显示在这个按钮上 */
    if ($("packBtn")) $("packBtn").onclick = function () { startPack(); };
    syncPackBtn();

    /* 账号相关入口 */
    syncUserUI();
    if ($("logoutBtn")) $("logoutBtn").onclick = function () {
      if (!confirm("退出登录？学习数据仍保存在本机，下次登录即可继续。")) return;
      clearSession(); closeSidebar(); location.reload();
    };
    if ($("switchUserBtn")) $("switchUserBtn").onclick = function () {
      clearSession(); closeSidebar(); authTab = "login"; renderAuth("请输入要切换的账号与密码");
    };
    if ($("exportBtn")) $("exportBtn").onclick = function () { exportData(); };
    if ($("importBtn") && $("importFile")) $("importBtn").onclick = function () { $("importFile").click(); };
    if ($("importFile")) $("importFile").onchange = function () {
      var f = this.files && this.files[0];
      if (f) importData(f, this);        // 读完再清空（见 importData 内注释）
      else this.value = "";
    };
    /* 数据落盘与多标签页同步：
       切后台/离开页面立即强制落盘（避免丢数据）；切回前台或收到其它标签页的改动广播时做一次合并 */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { flushNow(); return; }
      if (!authMode()) syncAndMerge();
    });
    window.addEventListener("pagehide", function () { flushNow(); });
    window.addEventListener("beforeunload", function () { flushNow(); });
    try {
      if (window.BroadcastChannel) {
        bc = new BroadcastChannel("zzx-db");
        bc.onmessage = function (e) {
          var d = e.data || {};
          if (d.type === "changed" && !document.hidden) syncAndMerge();
        };
      }
    } catch (e) {}

    /* 每次「进入」应用回到主界面（含五大板块）：
       iOS 主屏幕应用常以「恢复冻结页面」的方式打开（不重新加载页面），
       所以在恢复或长时间离开后主动回到首页，避免一进来停在别的页面 */
    window.addEventListener("pageshow", function (e) { if (e.persisted) goHome(); });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { bind.hiddenAt = Date.now(); return; }
      if (bind.hiddenAt && Date.now() - bind.hiddenAt > 3 * 60 * 1000) { bind.hiddenAt = 0; goHome(); }
    });
    if ($("spaceBtn")) $("spaceBtn").onclick = function () { showStorage(); };

    /* 登录/注册页交互 */
    var av = $("viewAuth");
    if (av) {
      av.addEventListener("click", function (e) {
        var el = e.target;
        var tab = el.closest ? el.closest("[data-auth]") : null;
        if (tab) { authTab = tab.getAttribute("data-auth"); renderAuth(""); return; }
        if (el.closest && el.closest("#authGo")) { authSubmit(); return; }
        if (el.closest && el.closest("#authSkip")) {
          if (confirm("沿用本机已有进度，不创建账号。之后随时可在侧边栏注册并登录。")) signIn(null);
          return;
        }
      });
      av.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); authSubmit(); }
      });
    }

    /* 新版 Service Worker 接管后给出可点击的提示（不自动刷新，避免 iOS 上刷新成环） */
    if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener("message", function (e) {
        var d = e.data || {};
        if (d.type !== "zzx-updated") return;
        toast("已就绪新版本 · 点这里刷新", 8000);
        var t = $("toast");
        t.onclick = function () { location.reload(); };
      });
    }
    $("resetBtn").onclick = function () {
      if (!confirm("确定清空全部学习进度？")) return;
      progress = {};
      state.index = 0; state.page = 0;
      delRec(userKey(STORE_KEY));            // 直接从数据库删除该账号的进度记录
      renderSidebar(); renderHome(); toast("当前账号的学习进度已清空");
    };
    $("searchBtn").onclick = openSearch;
    $("searchClose").onclick = closeSearch;
    $("searchInput").addEventListener("input", function () { clearTimeout(this._t); this._t = setTimeout(renderSearch, 180); });
    $("quizBtn").onclick = function () {
      closeSidebar();
      /* 上一轮没答完：先给「继续上次练习」的入口，不悄悄重开一轮 */
      if (quiz.list.length && !quiz.finished) { renderQuizHome(); return; }
      if (state.boardId) startQuiz(state.boardId, 12); else renderQuizHome();
    };
    $("timelineBtn").onclick = function () { closeSidebar(); loadAll().then(function () { indexAll(); renderLine(); }); };
    $("caseBtn").onclick = function () { closeSidebar(); loadAll().then(function () { indexAll(); renderCase(""); }); };
    $("essayBtn").onclick = function () { renderEssay(); closeSidebar(); };
    $("analysisBtn").onclick = function () { renderAnalysis(wrongCount() ? "weak" : "now"); };
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
      if (k) { state.kind = k.getAttribute("data-kind"); state.index = 0; state.page = 0; renderSidebar(); renderStudy(); closeSidebar(); return; }
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
      var qr = up("[data-quizresume]");
      if (qr) { show("viewQuiz"); renderQuiz(); return; }     // 继续上一轮未答完的练习
      var nm = up("[data-num]");
      if (nm) {
        bind._n = parseInt(nm.getAttribute("data-num"), 10);
        var ns = $("viewQuiz").querySelectorAll("[data-num]");
        for (var j = 0; j < ns.length; j++) ns[j].classList.toggle("on", ns[j] === nm);
        return;
      }
      var an = up("[data-anal]");
      if (an) { renderAnalysis(an.getAttribute("data-anal")); return; }
      var ug = up("[data-unitgo]");
      if (ug) {
        var ugv = String(ug.getAttribute("data-unitgo")).split("|");
        openUnit(ugv[0], ugv[1] || null);
        return;
      }
      var wd = up("[data-wdel]");
      if (wd) {
        wrongRemove(wd.getAttribute("data-wdel"));
        renderAnalysis("wrong");
        toast("已移出错题库");
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
        /* 尚未成功显示的配图（加载失败或还在等懒加载）：点一下就地重试，而不是打开空的大图查看器 */
        if (!img.naturalWidth) {
          var full = img.getAttribute("data-full") || img.getAttribute("src") || "";
          if (full) {
            img.classList.remove("img-broken");
            if (img.parentNode && img.parentNode.classList) { img.parentNode.classList.remove("is-broken"); img.parentNode.classList.add("is-loading"); }
            img.classList.add("is-pending");
            img.src = full + (full.indexOf("?") < 0 ? "?" : "&") + "zzxr=" + Date.now();
            toast("正在重新加载配图…");
          }
          return;
        }
        openViewer(img.getAttribute("data-full"), img.getAttribute("data-cap") || "");
        return;
      }
    });

    $("actionbar").addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("button") : null;
      if (!t) return;
      if (t.id === "prevBtn") nav(-1);
      else if (t.id === "nextBtn") nav(1);
      else if (t.id === "doneBtn") toggleDone();
    });
    $("viewQuiz").addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("button") : null;
      if (!t) return;
      if (t.id === "quizNext") {
        if (quiz.i >= quiz.list.length - 1) {
          finishRound(); // 答完一轮 → 直接呈现本轮成绩与薄弱分析
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
  /* 极端情况自救：注销 Service Worker、清空全部离线缓存后重载。
     用于旧版离线缓存损坏导致页面打不开的场景，用户无需删除主屏幕图标 */
  function hardReset() {
    function done() { location.reload(); }
    try {
      var tasks = [];
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        tasks.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
          return Promise.all(rs.map(function (r) { return r.unregister(); }));
        }));
      }
      if (typeof caches !== "undefined" && caches.keys) {
        tasks.push(caches.keys().then(function (ks) {
          return Promise.all(ks.map(function (k) { return caches.delete(k); }));
        }));
      }
      if (!tasks.length) return done();
      Promise.all(tasks).then(done, done);
    } catch (e) { done(); }
  }
  window.zzxHardReset = hardReset;

  /* ---------------- 配图离线包：一键把全部配图存到本机 ---------------- */
  var PACK_KEY = "zzx.pack.v1";
  var packRunning = false;
  function packInfo() {
    try { return JSON.parse(localStorage.getItem(PACK_KEY) || "null"); } catch (e) { return null; }
  }
  function allImgUrls() {
    var urls = [], seen = {};
    allItems().forEach(function (it) {
      imgSrcsOf(it).forEach(function (u) { if (u && !seen[u]) { seen[u] = 1; urls.push(u); } });
    });
    return urls;
  }
  function syncPackBtn() {
    var b = $("packBtn");
    if (!b || packRunning) return;
    b.textContent = packInfo() ? "配图已下载 ✓（点此补齐）" : "下载全部配图（离线秒开）";
  }
  function downloadImages(urls) {
    packRunning = true;
    var btn = $("packBtn"), done = 0, fail = 0, i = 0, CONC = 4;
    function label() { if (btn) btn.textContent = "下载中 " + done + " / " + urls.length + "…"; }
    label();
    function next() {
      if (i >= urls.length) return Promise.resolve();
      var batch = urls.slice(i, i + CONC); i += CONC;
      return Promise.all(batch.map(function (u) {
        /* 已缓存的图由 Service Worker 直接返回，不会重复走网络 */
        return fetch(u, { credentials: "same-origin" })
          .then(function (r) { if (r.ok) { done++; return r.blob(); } fail++; })
          .catch(function () { fail++; });
      })).then(function () { label(); return next(); });
    }
    return next().then(function () {
      packRunning = false;
      try { localStorage.setItem(PACK_KEY, JSON.stringify({ at: Date.now(), n: urls.length })); } catch (e) {}
      syncPackBtn();
      toast(fail
        ? "配图离线包：成功 " + done + " 张，失败 " + fail + " 张，可稍后重试"
        : "配图离线包完成：" + done + " 张已存入本机，之后离线也能秒看");
    });
  }
  function startPack() {
    if (packRunning) { toast("正在下载配图，请稍候…"); return; }
    loadAll().then(function () {
      indexAll();
      var urls = allImgUrls();
      if (!urls.length) { toast("没有需要下载的配图"); return; }
      var mb = Math.max(1, Math.round(urls.length * 55 / 1024));
      var p = packInfo();
      var msg = p
        ? ("已下载过 " + (p.n || 0) + " 张。补齐缺失的 " + urls.length + " 张配图？已缓存的不会重复下载。")
        : ("将把 " + urls.length + " 张配图（约 " + mb + " MB）存到本机，之后翻看任何考点秒开、离线也能看。\n建议在 Wi-Fi 下进行，继续？");
      if (!confirm(msg)) return;
      downloadImages(urls);
    });
  }

  /* 首屏数据加载失败/超时时的可恢复提示，替代永远转圈的「正在加载考点数据…」 */
  function bootError(reason) {
    var home = $("viewHome");
    if (!home || home.hidden) return;
    var host = home.querySelector(".boot-hint");
    if (!host) return;
    host.className = "boot-hint is-error";
    host.innerHTML = "<span>数据加载失败" + (reason ? "（" + esc(reason) + "）" : "") +
      "，请检查网络后重试。已缓存的内容在离线时仍可查看。</span>" +
      '<button type="button" class="boot-retry" data-boot-retry="reload">重新加载</button>' +
      '<button type="button" class="boot-retry ghost" data-boot-retry="reset">重置离线缓存并重载</button>';
    /* 不用内联 onclick（严格 CSP 下会被拦截），改为绑定事件 */
    if (host.dataset.retryBound !== "1") {
      host.dataset.retryBound = "1";
      host.addEventListener("click", function (e) {
        var b = e.target && e.target.closest ? e.target.closest("[data-boot-retry]") : null;
        if (!b) return;
        if (b.getAttribute("data-boot-retry") === "reset") { if (window.zzxHardReset) window.zzxHardReset(); }
        else location.reload();
      });
    }
  }
  /* ---------------- 登录 / 注册视图 ---------------- */
  var authTab = "login";
  function renderAuth(msg) {
    document.body.classList.add("auth-mode");
    if (state.user) { state.user = null; progress = {}; wrong = blankWrong(); }
    syncUserUI();
    var a = readAccounts();
    var names = Object.keys(a.users);
    var hasLegacy = !names.length && (localStorage.getItem("zzx.progress.v1") || localStorage.getItem("zzx.wrong.v1"));
    var isReg = authTab === "reg";
    var h = '<div class="auth-wrap"><div class="auth-card">' +
      '<div class="hero" style="padding:0 0 14px;border-bottom:0;margin:0">' +
      '<h1 style="font-size:21px">' + (isReg ? "注册新账号" : "登录") + "<em>·</em>政治线</h1>" +
      "<p>" + (isReg
        ? "设置用户名与密码，之后的学习进度就记在这个账号名下。"
        : "输入用户名与密码，进入你自己的学习进度（已掌握、错题库、薄弱分析）。") +
      "</p></div>" +
      '<div class="auth-field"><label>用户名</label><input id="authName" type="text" autocomplete="username" autocapitalize="off" placeholder="例如：kaoyan" value="' + esc(lastName()) + '"></div>' +
      '<div class="auth-field"><label>密码</label><input id="authPw" type="password" autocomplete="' + (isReg ? "new-password" : "current-password") + '" placeholder="' + (isReg ? "至少 4 位" : "请输入密码") + '"></div>' +
      (isReg ? '<div class="auth-field"><label>确认密码</label><input id="authPw2" type="password" autocomplete="new-password" placeholder="再输一次"></div>' : "") +
      '<label class="auth-check"><input id="authRemember" type="checkbox" checked> 记住登录状态（下次打开免输密码）</label>' +
      '<div class="auth-actions"><button type="button" class="auth-btn primary" id="authGo">' + (isReg ? "注册" : "登录") + "</button></div>" +
      '<div class="auth-msg" id="authMsg">' + esc(msg || "") + "</div>" +
      '<div class="auth-switch">' + (isReg
        ? '<span>已经有账号了？</span><button type="button" class="auth-link" data-auth="login">返回登录</button>'
        : '<span>还没有账号？</span><button type="button" class="auth-link" data-auth="reg">注册新账号</button>') +
      "</div>" +
      (hasLegacy ? '<div class="auth-extra"><button type="button" class="auth-btn" id="authSkip">先用本机已有进度（不注册）</button></div>' : "") +
      '<p class="auth-note">账号只保存在这台设备上，不需要服务器、不上传任何数据。密码以加盐散列保存，不存明文；换设备时可用「导出学习数据 / 导入学习数据」迁移。</p>' +
      "</div></div>";
    $("viewAuth").innerHTML = h;
    show("viewAuth");
    $("topTitle").textContent = isReg ? "注册新账号" : "登录";
    $("topSub").textContent = isReg
      ? "设置用户名与密码即可"
      : (names.length ? "已有 " + names.length + " 个账号，输入密码进入" : "第一次使用？点下方「注册新账号」");
    var el = $("authName");
    if (el && !lastName()) { try { el.focus(); } catch (e) {} }
  }
  function authSubmit() {
    var name = ($("authName") || {}).value || "";
    var pw = ($("authPw") || {}).value || "";
    var msg = $("authMsg");
    var remember = !$("authRemember") || $("authRemember").checked;
    function say(m) { if (msg) msg.textContent = m || ""; }
    if (authTab === "reg") {
      var pw2 = ($("authPw2") || {}).value || "";
      if (pw !== pw2) return say("两次输入的密码不一致");
      say("正在创建账号…");
      registerAccount(name, pw).then(function (u) {
        rememberName(u);
        setSession(u, remember);
        toast("账号「" + u + "」已创建，学习进度将记在它名下");
        signIn(u);
      }).catch(function (e) {
        var m = (e && e.message) || "注册失败";
        if (/已存在/.test(m)) m += "：点下方「返回登录」直接输入密码即可";
        say(m);
      });
    } else {
      if (!String(name).trim() || !pw) return say("请输入用户名与密码");
      say("正在登录…");
      loginAccount(name, pw).then(function (u) {
        rememberName(u);
        setSession(u, remember);
        toast("已登录：" + u);
        signIn(u);
      }).catch(function (e) {
        var m = (e && e.message) || "登录失败";
        if (/不存在/.test(m)) m += "：点下方「注册新账号」创建";
        say(m);
      });
    }
  }
  function syncUserUI() {
    var el = $("userName");
    if (el) el.textContent = state.user || (document.body.classList.contains("auth-mode") ? "未登录" : "本机用户");
  }
  /* 登录成功（或选择本机身份）后进入主流程 */
  function signIn(name) {
    state.user = name || null;
    progress = loadProgress();
    wrong = loadWrong();
    document.body.classList.remove("auth-mode");
    authTab = "login";                 // 下次再出现登录页时，默认就是「登录」而不是注册
    syncUserUI();
    boot();
  }

  function boot() {
    var settled = false;
    /* 看门狗：超过 18 秒仍未就绪，给出可点击的重试入口 */
    var guard = setTimeout(function () { if (!settled) bootError("加载超时"); }, 18000);
    /* 首屏只等考点数据；题库（约 250KB）不再阻塞启动，改为空闲时后台预热 */
    loadAll().then(function () {
      settled = true; clearTimeout(guard);
      indexAll(); renderSidebar();
      var okBoards = BOARDS.filter(function (b) { return getBoard(b.id); }).length;
      if (!okBoards) { bootError("数据未能加载"); return; }   // 全部失败：显示可重试提示，不留空首页
      renderHome();
      var missing = BOARDS.length - okBoards;
      if (missing) toast(missing + " 个板块的数据未加载成功，可重试或稍后再打开");  // 部分失败：明确告知
      idleRun(function () {
        loadQuiz().then(function () { syncQuizTotal(); }).catch(function () {});
      });
    }).catch(function (err) {
      settled = true; clearTimeout(guard);
      try { indexAll(); renderSidebar(); } catch (e2) {}
      bootError((err && err.message) || "数据异常");
    });
  }

  /* ---------------- 启动：先过账号，再进入主界面 ---------------- */
  function init() {
    applyTheme(); syncImgBtn(); bind();
    /* 先打开本地数据库并把旧数据搬进来，再过账号门槛 */
    recGetAll().then(function (rows) {
      mem = rows || {};
      migrateLegacy();
      verifyRecords();          // 指纹校验：损坏/被篡改的记录会回滚或隔离，不进内存
      askPersist();
      var sess = readSession();
      if (sess) { signIn(sess); return; }    // 「记住登录」：直接进入自己的进度
      renderAuth("");
    }).catch(function () {
      renderAuth("");
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
