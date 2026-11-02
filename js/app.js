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
  /* 板块 id 白名单：进度数据只接受这五个 id（校验时必须以它为唯一依据，
     不能用「两字母」之类的形状推断——毛中特的 id 是 "mao"，三个字母） */
  var BOARD_ID_SET = {};
  BOARDS.forEach(function (b) { BOARD_ID_SET[b.id] = 1; });

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
    full: localStorage.getItem("zzx.full") === "1",   // 冲刺模式（默认）／全量模式
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
  /* 进度：只保留已知板块（BOARD_ID_SET 白名单）+ 合法考点 id；类型/上限全部收紧 */
  function sanitizeProgressData(d) {
    var out = {};
    if (!isPlainObject(d)) return out;
    Object.keys(d).forEach(function (bid) {
      if (!BOARD_ID_SET[bid]) return;
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
        /* 指纹对不上时，老逻辑是「隔离 + 从库里删掉」。但数据全部由本机写入，
           没有跨端不可信来源；一次指纹算法调整、一次写入被系统打断，
           就会把用户几个月的进度静默抹掉（表现为「打开是空的，只能重来」）。
           现在改成：留一份原始副本，主记录重新签名后照样使用。 */
        var qk = "quarantine:" + k + ":" + Date.now();
        mem[qk] = { at: Date.now(), oldSig: rec.sig, data: rec.data };   // 留存证据，便于排查
        dirtyKeys[qk] = 1;
        rec.oldSig = rec.sig;
        delete rec.sig;                        // 让 setRec 重算指纹
        setRec(k, rec.data, true);             // 走正规写入：规范化 + 新指纹
        quarantined++;
      }
    });
    if (restored || quarantined) flushNow();       // 把自愈结果立刻落库
    if (restored) toastOnce("检测到学习数据异常，已自动回滚到上一次正常状态");
    if (quarantined) toastOnce("学习数据的校验标记不一致，已重新校验并完整保留（数据不会丢）");
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
    var dd = recData("daily:" + (state.user || ""));
    if (p) progress = p;
    if (w && w.q) wrong = w;
    daily = dd ? sanitizeDaily(dd) : blankDaily();
    try { syncWrongBadge(); syncQuizTotal(); renderSidebar(); } catch (e) {}
    if (!$("viewHome") || $("viewHome").hidden) return;
    try { renderHome(); } catch (e) {}
  }
  function accountNames() {
    return Object.keys(mem).filter(function (k) { return k.indexOf("acc:") === 0; })
      .map(function (k) { return k.slice(4); });
  }
  /* ---------------- 数据即身份（device-first） ----------------
     账号记录只是「一把锁」，不是进门的门票。学习数据（progress/wrong）在谁名下，
     谁就是这台设备上的用户。这样 IndexedDB 被系统清理、换过域名、旧版迁移失败时，
     用户也不会被挡在登录页上「只能重新注册」。 */
  function hasUserData(name) {
    var want = (name || "");
    var keys = Object.keys(mem);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf("progress:") !== 0 && k.indexOf("wrong:") !== 0) continue;
      if (k.slice(k.indexOf(":") + 1) !== want) continue;
      var d = mem[k] && mem[k].data;
      if (isPlainObject(d) && Object.keys(d).length) return true;
    }
    return false;
  }
  /* 有数据、但账号记录已丢的身份（空字符串＝「本机身份」） */
  function localIdentities() {
    var accs = accountNames(), seen = {}, out = [];
    Object.keys(mem).forEach(function (k) {
      var i = k.indexOf(":");
      if (i < 0) return;
      var kind = k.slice(0, i), n = k.slice(i + 1);
      if (kind !== "progress" && kind !== "wrong") return;   // 只要进度或错题库有内容，就算用过
      if (n && accs.indexOf(n) >= 0) return;
      if (seen[n]) return;
      if (!hasUserData(n)) return;
      seen[n] = 1; out.push(n);
    });
    out.sort(function (a, b) { return (b ? 1 : 0) - (a ? 1 : 0); });   // 具名身份排在「本机身份」前
    return out;
  }
  /* 补一条「无密码」账号记录：让这份数据重新有名字，之后可随时上锁 */
  function ensureAccount(name) {
    name = String(name || "").trim();
    if (!name) return false;
    if (readAccounts().users[name]) return false;
    if (!/^[A-Za-z0-9\u4e00-\u9fa5._-]{1,20}$/.test(name)) return false;
    setRec("acc:" + name, { salt: "", iter: 0, hash: "", at: Date.now(), restored: true });
    syncAccountMirror();
    return true;
  }
  /* 用本次输入的密码，把「已在数据里存在」的身份认领下来（顺手设成新密码） */
  function claimAccount(name, pw) {
    name = String(name || "").trim();
    if (!/^[A-Za-z0-9\u4e00-\u9fa5._-]{1,20}$/.test(name)) {
      return Promise.reject(new Error("用户名只能用中英文、数字、下划线、点与短横线（1-20 位）"));
    }
    if (String(pw || "").length < 4) return Promise.reject(new Error("密码至少 4 位，用来给这份进度上锁"));
    if (String(pw || "").length > 64) return Promise.reject(new Error("密码最多 64 位"));
    var salt = newSalt();
    return hashPassword(pw, salt, PBKDF2_ITER).then(function (h) {
      setRec("acc:" + name, { salt: salt, iter: PBKDF2_ITER, hash: h, at: Date.now(), claimed: true });
      syncAccountMirror();
      return name;
    });
  }

  /* 账号表在 localStorage 再留一份镜像：iOS 只清 IndexedDB、或 IDB 损坏时，
     账号（含 salt/散列）还能捞回来，用户不必重新注册。 */
  function syncAccountMirror() {
    try {
      localStorage.setItem("zzx.accounts.v1", JSON.stringify({ v: 1, users: readAccounts().users }));
    } catch (e) {}
  }

  function readAccounts() {
    var users = {};
    accountNames().forEach(function (n) { var d = recData("acc:" + n); if (d) users[n] = d; });
    return { users: users };
  }
  function writeAccounts(a) {
    Object.keys(a.users || {}).forEach(function (n) { setRec("acc:" + n, a.users[n]); });
    syncAccountMirror();
  }
  /* 首次启动：把旧的 localStorage 数据整体搬进库（旧键保留，可回退） */
  function migrateLegacy() {
    /* 只搬「库里还没有」的键：以前只要有 meta 就整体跳过，
       一旦 IndexedDB 被清掉，留在 localStorage 的老数据就再也搬不回来。
       现在每次启动都对一遍，缺什么补什么（幂等，毫秒级）。 */
    var n = 0;
    try {
      var accRaw = localStorage.getItem("zzx.accounts.v1");
      if (accRaw) {
        var a = safeJSON(accRaw);
        Object.keys((a && a.users) || {}).forEach(function (u) {
          if (!/^[A-Za-z0-9\u4e00-\u9fa5._-]{1,20}$/.test(u)) return;
          if (mem["acc:" + u]) return;                 // 已有记录不覆盖
          setRec("acc:" + u, a.users[u], true); n++;
        });
      }
      var sesRaw = localStorage.getItem("zzx.session.v1") || sessionStorage.getItem("zzx.session.v1");
      if (sesRaw && !mem["session"]) {
        var sr = safeJSON(sesRaw);
        if (isPlainObject(sr)) { setRec("session", sr, true); n++; }
      }
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
  /* 老账号可能是「WebCrypto 不可用」时注册的（h 散列，如早期用局域网 IP / file:// 打开）。
     现在换成 https 打开，登录只会算 p2 散列，永远对不上 —— 于是「密码没错却登不进去」。
     这里两种都验，命中旧格式就顺手升级成 PBKDF2，以后不再有这个问题。 */
  /* 忘了密码不用重新注册：本机数据本来就归本机用户，验证「账号存在」即可换新密码。
     重置后旧密码立即失效，学习进度 / 错题库原封不动。 */
  function resetPassword(name, pw) {
    name = String(name || "").trim();
    var a = readAccounts(), u = a.users[name];
    if (!u) return Promise.reject(new Error("本机没有这个账号"));
    if (String(pw || "").length < 4) return Promise.reject(new Error("新密码至少 4 位"));
    if (String(pw || "").length > 64) return Promise.reject(new Error("新密码最多 64 位"));
    var salt = newSalt();
    return hashPassword(pw, salt, PBKDF2_ITER).then(function (h) {
      u.salt = salt; u.hash = h; u.iter = PBKDF2_ITER; u.resetAt = Date.now();
      a.users[name] = u;
      writeAccounts(a);
      syncAccountMirror();
      return name;
    });
  }

  function loginAccount(name, pw) {
    name = String(name || "").trim();
    var a = readAccounts(), u = a.users[name];
    if (!u) {
      /* 账号记录没了但数据还在：直接把这份进度认领下来，不再要求重新注册 */
      if (hasUserData(name)) return claimAccount(name, pw);
      return Promise.reject(new Error("NONE:" + name));
    }
    /* 恢复出来的记录没有密码锁：用这次输入的密码补上 */
    if (!u.hash) return claimAccount(name, pw);
    var iter = u.iter || PBKDF2_ITER;
    return hashPassword(pw, u.salt, iter).then(function (h) {
      if (h === u.hash) return name;
      var legacy = "h" + hashStr(u.salt + "|" + pw + "|" + iter);
      if (legacy === u.hash) {              // 旧散列通过：升级为 PBKDF2
        u.hash = h; u.iter = PBKDF2_ITER; u.upgradedAt = Date.now();
        a.users[name] = u;
        writeAccounts(a);
        return name;
      }
      throw new Error("密码不正确");
    });
  }
  /* 会话：记住登录状态（存库）；不勾选时只放在 sessionStorage，关闭即失效 */
  function setSession(name, remember) {
    if (remember) {
      setRec("session", { user: name, at: Date.now() });
      /* 双写一份到 localStorage：IndexedDB 被系统清理/隐私模式时仍能免密进入 */
      try { localStorage.setItem("zzx.session.v1", JSON.stringify({ user: name, at: Date.now() })); } catch (e) {}
    } else {
      delRec("session");
      try { localStorage.removeItem("zzx.session.v1"); } catch (e) {}
    }
    try {
      if (remember) sessionStorage.removeItem(SSESS_KEY);
      else sessionStorage.setItem(SSESS_KEY, JSON.stringify({ user: name, at: Date.now() }));
    } catch (e) {}
  }
  function readSession() {
    /* 老实现要求「账号记录还在」才算有会话——记录一丢就掉登录，只能重新注册。
       现在只要这份身份在库里有数据，就认它是同一个人。 */
    function ok(u) { return typeof u === "string" && (readAccounts().users[u] || hasUserData(u)); }
    var d = recData("session");
    if (d && ok(d.user)) return d.user;
    try {                                        // 兜底：本次会话内的临时登录
      var t = safeJSON(sessionStorage.getItem(SSESS_KEY) || "null");
      if (isPlainObject(t) && ok(t.user)) return t.user;
    } catch (e) {}
    try {                                        // 兜底：旧版本留在 localStorage 的会话
      var old = safeJSON(localStorage.getItem("zzx.session.v1") || "null");
      if (isPlainObject(old) && ok(old.user)) return old.user;
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

  /* ---------------- 动效基础（全站共用同一套运动规则） ----------------
     · 系统开启「减弱动态效果」时，所有动效瞬时完成（不是关掉功能）
     · 吸附滚动：中段加速、收尾快速贴住目标（磁吸的手感来自"速度逐渐变快"）
     · 弹一下：给元素临时加一个动画类，用于吸附/回弹这类一次性反馈 */
  var reduceMotion = false;
  try {
    var mq = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
    reduceMotion = !!(mq && mq.matches);
    if (mq && mq.addEventListener) mq.addEventListener("change", function (e) { reduceMotion = !!e.matches; });
  } catch (e) {}
  function motionOK() { return !reduceMotion; }
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  var snapScrollToken = 0;
  function snapScrollTo(el, to, ms) {
    if (!el) return;
    var from = el.scrollLeft, d = to - from;
    if (!motionOK() || Math.abs(d) < 2) { el.scrollLeft = to; return; }
    var tok = ++snapScrollToken, t0 = nowMs();
    (function step(now) {
      if (tok !== snapScrollToken) return;
      var p = Math.min(1, (now - t0) / (ms || 330));
      var e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;   // 中段加速、收尾更快
      el.scrollLeft = from + d * e;
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }
  function popClass(el, cls, ms) {
    if (!el || !motionOK()) return;
    el.classList.remove(cls);
    void el.offsetWidth;                  // 重启动画
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms || 380);
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
      var payload = { app: "zzx", v: 1, user: state.user || "本机", at: Date.now(), progress: progress, wrong: wrong, daily: daily };
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
        daily = sanitizeDaily(d.daily); saveDaily();
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
  /* 移出错题库：被移出的条目先轻微缩出，剩下的条目从原位置弹上来
     （碰撞推挤与回弹——元素会对彼此的运动做出回应） */
  function removeWrongAnimated(id) {
    var view = $("viewAnalysis");
    if (!view) { wrongRemove(id); return; }
    var btn = view.querySelector('[data-wdel="' + id + '"]');
    var target = btn && btn.closest ? btn.closest(".wrong-item") : null;
    var items = view.querySelectorAll(".wrong-item");
    var rects = [], idx = -1;
    for (var i = 0; i < items.length; i++) {
      rects.push(items[i].getBoundingClientRect());
      if (items[i] === target) idx = i;
    }
    var animated = !!(target && motionOK());
    var delay = animated ? 170 : 0;
    if (animated) target.classList.add("is-out");
    wrongRemove(id);
    function rerender() {
      renderAnalysis("wrong");
      toast("已移出错题库");
      if (!animated) return;
      /* 等重绘完成后再做 FLIP：剩下的条目从旧位置滑到新位置 */
      setTimeout(function () {
        var after = $("viewAnalysis").querySelectorAll(".wrong-item");
        for (var j = 0; j < after.length; j++) {
          var oldR = rects[j + (idx >= 0 ? 1 : 0)];
          if (!oldR) continue;
          var d = oldR.top - after[j].getBoundingClientRect().top;
          if (Math.abs(d) < 2) continue;
          after[j].style.transition = "none";
          after[j].style.transform = "translateY(" + d + "px)";
        }
        requestAnimationFrame(function () {
          for (var k = 0; k < after.length; k++) {
            after[k].style.transition = "";
            after[k].style.transform = "";
          }
        });
      }, 0);
    }
    setTimeout(rerender, delay);
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
  function openSidebar() {
    var sb = dom.sidebar;
    if (!sb) return;
    sb.style.transform = "";                       // 清掉手势拖动留下的位置
    sb.classList.remove("is-drag");
    sb.classList.add("is-spring", "open");
    setTimeout(function () { sb.classList.remove("is-spring"); }, 280);
    dom.scrim.hidden = false;
    dom.scrim.style.opacity = "";
    requestAnimationFrame(function () { dom.scrim.classList.add("show"); });
  }
  function closeSidebar() {
    var sb = dom.sidebar;
    if (!sb) return;
    sb.classList.remove("is-drag");
    sb.classList.add("is-spring");
    sb.style.transform = "";
    sb.classList.remove("open");
    dom.scrim.classList.remove("show");
    dom.scrim.style.opacity = "";
    setTimeout(function () { sb.classList.remove("is-spring"); }, 280);
    setTimeout(function () { dom.scrim.hidden = true; }, 260);
  }

  /* 视图切换：①记住每个视图的滚动位置，切回时原地续读（不再"回到顶部一片空白"）
     ②新视图 180ms 淡入，遮住硬切瞬间的黑/白闪（也就是用户说的"黑屏、发雾"） */
  var VIEWS = ["viewHome", "viewStudy", "viewQuiz", "viewLine", "viewCase", "viewEssay", "viewAnalysis", "viewAuth", "viewPair", "viewAnniv", "viewBs", "viewDaily"];
  var viewScroll = {};
  function show(view) {
    closeSidebar(); // 任何视图切换都收起侧边栏，避免浮层压住内容
    var cur = null;
    for (var i = 0; i < VIEWS.length; i++) { if (!$(VIEWS[i]).hidden) { cur = $(VIEWS[i]); break; } }
    if (cur && cur.id === view) return;               // 同一视图不重复渲染
    if (cur) viewScroll[cur.id] = cur.scrollTop;
    VIEWS.forEach(function (v) { $(v).hidden = true; });
    var el = $(view);
    el.hidden = false;
    var y = viewScroll[view];
    el.scrollTop = (typeof y === "number" && y > 0) ? y : 0;
    el.classList.remove("view-enter");
    void el.offsetWidth;                              // 强制重排，保证动画可重放
    el.classList.add("view-enter");
  }
  /* 主动导航（进板块/换板块/做题）一律回到顶部，不继承上次位置 */
  function resetViewScroll(id) { viewScroll[id] = 0; }

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
    var bsEl = $("bsSideN");
    if (bsEl) { var bn = bsTotal(); bsEl.textContent = bn ? (bn + " 条 · 手机离线背") : "手机离线背"; }
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
      var pool = d.items.filter(function (x) { return inMainline(x, b.id); });
      var pr = progress[b.id];
      tot += pool.length;
      pool.forEach(function (x) { if (pr && pr.done && pr.done[x.id]) dn++; });
    });
    var bsN = bsTotal();
    var h = '<div class="wrap">';
    h += '<div class="hero"><h1>打开就<em>背</em>，背完就记住</h1>' +
      '<p>依据《2027 年考研政治考试大纲》梳理 · 马原 / 毛中特 / 史纲 / 思修法治 / 形策</p>' +
      '<div class="hero-stats">' +
      "<div><b>" + tot + "</b><span>考点</span></div>" +
      "<div><b>" + (bsN || "—") + "</b><span>背诵条目</span></div>" +
      "<div><b>" + (bsN ? bsMustCount() : "—") + "</b><span>必背</span></div>" +
      "</div></div>";

    /* 背诵优先级最高：一进来就是「今天还要背几条 / 今天该复习几条」 */
    h += bsCtaHtml();
    /* 每日一题：每天一道真题大题，从 5 个考点里选 3 个 */
    h += dailyCardHtml();

    /* 背诵三件套：背（清单）→ 对（材料）→ 串（周年线） */
    h += '<div class="sec-title">背诵三件套</div><div class="cards">';
    h += '<button type="button" class="card sprint-card" data-home="bs" style="--cc:var(--c-my)">' +
      '<div class="card-top"><b>背诵中心</b><span class="bdg">' + (bsN || 92) + " 条</span></div>" +
      "<p>27 届背诵清单：标题→线索→正文→方法论；遮住正文按键回忆，翻到哪背到哪。</p>" +
      '<div class="mrow"><span>四部分 · 重点分级</span><span>手机离线可用</span></div></button>';
    h += '<button type="button" class="card sprint-card" data-home="pair" style="--cc:var(--c-my)">' +
      '<div class="card-top"><b>马原 · 原理对材料</b><span class="bdg">18 原理</span></div>' +
      "<p>背完一句原理，立刻知道材料里出现哪句话就该答它；附三步答题框架与考纲落点。</p>" +
      '<div class="mrow"><span>材料 → 原理反查</span><span>18 条哲学原理</span></div></button>';
    h += '<button type="button" class="card sprint-card" data-home="anniv" style="--cc:var(--c-sg)">' +
      '<div class="card-top"><b>2026 整周年主线</b><span class="bdg">24 节点</span></div>' +
      "<p>史纲只背这一页：逢五逢十周年 + 一句结论，救亡—革命—建设—改革—复兴五条线。</p>" +
      '<div class="mrow"><span>史纲已瘦身</span><span>直接背结论</span></div></button>';
    h += "</div>";

    h += homeNextHtml();

    h += '<div class="sec-title">五大板块</div><div class="cards">';
    h += BOARDS.map(function (b) {
      var d = getBoard(b.id); if (!d) return "";
      var p = progress[b.id] || { done: {} };
      var pool = d.items.filter(function (x) { return inMainline(x, b.id); });
      var n = 0;
      pool.forEach(function (x) { if (p.done && p.done[x.id]) n++; });
      var total = pool.length;
      var pct = total ? Math.round(n / total * 100) : 0;
      var annTag = boardAnnivs(b.id).length ? '<span class="bdg bdg-anniv">本年度整周年重点</span>' : "";
      return '<button type="button" class="card" data-open="' + b.id + '" style="--cc:' + b.color + '">' +
        '<div class="card-top"><b>' + esc(b.name) + '</b><span class="bdg">' + b.badge + '</span>' + annTag + '</div>' +
        "<p>" + esc(b.desc) + "</p>" +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="mrow"><span>' + total + " 个考点" + (state.full ? "" : " · 主线") + "</span><span>" + n + " 已学 · " + pct + "%</span></div></button>";
    }).join("");
    h += "</div>";

    h += '<div class="home-foot">纯背诵模式：题目与自测已停用，只保留「背清单 → 对材料 → 串周年」三件事。过程性细节与 34 篇文献默认收起，可一键切回全量。</div>';

    h += "</div>";
    $("viewHome").innerHTML = h;
    show("viewHome");                     // 关键：渲染首页时必须切到首页
    $("topTitle").textContent = "政治线";
    $("topSub").textContent = "纯背诵 · 依据 2027 年考试大纲";
    $("progressStrip").hidden = true;
    $("actionbar").hidden = true;
    consumeDeepLink();
  }

  /* ---------------- 背诵统计（首页/侧栏共用） ---------------- */
  function bsTotal() {
    var D = window.ZZX_BS;
    return (D && D.parts) ? bsAll(D).length : 0;
  }
  function bsMustCount() {
    var D = window.ZZX_BS;
    if (!D || !D.parts) return 0;
    return bsAll(D).filter(function (x) { return x.lv === 2; }).length;
  }
  /* 首页入口卡：回到上次翻到的那一部分，用户自己往下背 */
  function bsCtaHtml() {
    var D = window.ZZX_BS;
    if (!D || !D.parts) return "";
    var st = bsState(), all = bsAll(D);
    var must = all.filter(function (x) { return x.lv === 2; }).length;
    var pi = Math.min(st.part, D.parts.length - 1);
    var part = D.parts[pi] || { name: "" };
    /* 四段小格代替百分比：这是"背到第几部分"，不是完成度，避免误读成打卡进度 */
    var segs = D.parts.map(function (_, i) {
      return "<i" + (i <= pi ? ' class="on"' : "") + "></i>";
    }).join("");
    return '<div class="bs-cta"><div class="bs-cta-top">' +
      "<b>接着背：" + esc(part.abbr || part.name) + "</b>" +
      "<span>第 " + (pi + 1) + "/" + D.parts.length + " 部分 · 必背 " + must + "</span></div>" +
      '<div class="bs-cta-parts">' + segs + "</div>" +
      '<button type="button" class="bs-cta-go" data-home="bs">继续背 →</button></div>';
  }

  /* 首页「从这里开始」：一个继续按钮 + 一个高频推荐，替代"自己找上次学到哪" */
  function homeNextHtml() {
    var cont = null;
    BOARDS.forEach(function (b) {
      var p = progress[b.id];
      if (!p || !p.current) return;
      var d = getBoard(b.id); if (!d) return;
      var it = (d.items || []).filter(function (x) { return x.id === p.current; })[0];
      if (!it) return;
      cont = { bid: b.id, name: b.name, title: it.title, at: p.at || 0 };
    });
    var hot = bestHotUnit();
    if (!cont && !hot) return "";
    var h = '<div class="sec-title">从这里开始</div><div class="next-card">';
    if (cont) {
      h += '<button type="button" class="next-row" data-open="' + esc(cont.bid) + '">' +
        '<i>继续</i><b>' + esc(cont.name) + "</b><span>" + esc(cont.title) + "</span></button>";
    }
    if (hot) {
      h += '<button type="button" class="next-row" data-unitgo="' + esc(hot.bid + "|" + hot.unit) + '">' +
        '<i>高频</i><b>' + esc(hot.uname) + "</b><span>" + esc(hot.name) + " · 近年考 " + hot.n + " 次</span></button>";
    }
    return h + "</div>";
  }
  /* 未学完单元里"真题最多 × 近年权重"最高的那个：先把高频拿下 */
  function bestHotUnit() {
    var Z = window.ZZX_ZT || {}, best = null;
    BOARDS.forEach(function (b) {
      var d = getBoard(b.id); if (!d) return;
      var p = progress[b.id] || { done: {} };
      (d.units || []).forEach(function (u) {
        var z = Z[u[0]]; if (!z || !z.n) return;
        var items = (d.items || []).filter(function (x) { return x.unit === u[0] && inMainline(x, b.id); });
        if (!items.length) return;
        var undone = items.filter(function (x) { return !(p.done && p.done[x.id]); });
        if (!undone.length) return;
        var score = z.n * 10 + (z.recent || 0) * 8 + undone.length * 2;
        if (!best || score > best.score) best = { bid: b.id, name: b.name, unit: u[0], uname: u[2], n: z.n, score: score };
      });
    });
    return best;
  }

  /* 主屏图标长按快捷方式：?go=bs|pair|anniv 直接进对应视图 */
  function consumeDeepLink() {
    var m = /[?&]go=(bs|pair|anniv)/.exec(location.search || "");
    if (!m) return;
    var v = m[1];
    try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) {}
    openSprint(v);
  }

  /* ---------------- 学习视图 ---------------- */
  /* ---------------- 冲刺分层（tier.js） ----------------
     默认「冲刺模式」：只走主线条目——已下线的过程细节与 34 篇文献不进入阅读流；
     侧栏/学习页可切「全量」，全部条目立即回来。data 文件本身不删，随时可回退。 */
  function tierOf(boardId) {
    var T = window.ZZX_TIER || {};
    return T[boardId] || {};
  }
  function inMainline(it, bid) {
    if (state.full) return true;
    var t = tierOf(bid || state.boardId || it._b);
    if (t.cut && t.cut.indexOf(it.id) >= 0) return false;
    if (t.main && t.main.length && t.main.indexOf(it.id) < 0) return false;
    if (t.docHide && it.kind === "doc") return false;
    return true;
  }
  function filteredItems() {
    var d = state.boardId ? getBoard(state.boardId) : null;
    if (!d) return [];
    return (d.items || []).filter(function (it) {
      if (state.kind && it.kind !== state.kind) return false;
      if (state.unitId && it.unit !== state.unitId) return false;
      if (!inMainline(it)) return false;
      return true;
    });
  }
  function countCut(boardId) {
    var d = getBoard(boardId); if (!d) return 0;
    var t = tierOf(boardId), n = 0;
    (d.items || []).forEach(function (it) {
      var off = false;
      if (t.cut && t.cut.indexOf(it.id) >= 0) off = true;
      else if (t.main && t.main.length && t.main.indexOf(it.id) < 0) off = true;
      if (t.docHide && it.kind === "doc") off = true;
      if (off) n++;
    });
    return n;
  }
  function curItem() { return filteredItems()[state.index] || null; }

  /* ---------------- 图片预加载 ---------------- */
  var preloaded = {};
  var idleRun = window.requestIdleCallback
    ? function (fn) { window.requestIdleCallback(fn, { timeout: 1500 }); }
    : function (fn) { setTimeout(fn, 240); };

  /* 配图分级：正文里用 480px 缩略图（img/pol/t/，单张约 14KB），
     点开大图才拉原图（data-full）。首屏图片体积从 21MB 降到 4.4MB，弱网不再空白断档。
     缩略图缺失时自动回退原图（markShots 里处理），不会出现"永远加载不出来"。 */
  function thumbOf(src) {
    if (!src || typeof src !== "string") return src;
    if (src.indexOf("img/pol/t/") === 0) return src;
    if (src.indexOf("img/pol/") !== 0) return src;
    return src.replace("img/pol/", "img/pol/t/");
  }
  /* 原始宽高：写进 img 的 width/height，浏览器提前留出正确高度 */
  function imgSizeOf(src) {
    var m = window.ZZX_IMGSIZE || {};
    var v = m[src];
    if (!v || v.length < 2) return null;
    return { w: v[0], h: v[1] };
  }
  function imgAttrs(src) {
    var sz = imgSizeOf(src);
    return sz ? ' width="' + sz.w + '" height="' + sz.h + '"' : "";
  }
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
    src = thumbOf(src);
    if (preloaded[src]) return;
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
          /* 一级回退：缩略图缺失/损坏 → 换原图再试一次（老数据、新增配图都能兜住） */
          var th = im.getAttribute("data-thumb"), full = im.getAttribute("data-full");
          if (th && full && im.getAttribute("src") === th) {
            im.removeAttribute("data-thumb");
            im.src = full;
            return;
          }
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
    snapScrollTo(track, target, 340);   // 磁吸：吸附速度逐渐变快
  }
  /* 中心聚焦：横向刻度里离视口中心最近的那一条轻微放大，
     让"当前翻到哪儿"在细刻度上也看得出来（内容型 App 的聚焦提示） */
  var psegFocus = { cur: null, queued: false };
  function focusPsegNow() {
    psegFocus.queued = false;
    var track = pstripTrack();
    if (!track || !track.isConnected) return;
    var r = track.getBoundingClientRect();
    var seg = null;
    if (r.bottom > 0 && r.top < window.innerHeight) {
      var el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (el && el.classList && el.classList.contains("pseg")) seg = el;
    }
    if (seg === psegFocus.cur) return;
    if (psegFocus.cur) psegFocus.cur.classList.remove("is-focus");
    if (seg && !seg.classList.contains("is-current")) seg.classList.add("is-focus");
    psegFocus.cur = seg;
  }
  function focusPsegSoon() {
    if (psegFocus.queued) return;
    psegFocus.queued = true;
    requestAnimationFrame(focusPsegNow);
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
    return '<figure class="b-fig"><img class="shot" src="' + esc(thumbOf(b.v)) + '" alt="' + esc(b.cap || "") +
      '" loading="lazy" decoding="async"' + imgAttrs(b.v) + ' data-thumb="' + esc(thumbOf(b.v)) +
      '" data-full="' + esc(b.v) + '" data-cap="' + esc(b.cap || "") + '">' +
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

  /* 单元目录：把「本单元还有哪些考点」摊开，代替盲翻上一页/下一页。
     已学条目打勾、当前条目高亮，底部直通本单元真题。 */
  function unitMapHtml(bid, cur) {
    var d = getBoard(bid); if (!d) return "";
    var u = (d.units || []).filter(function (x) { return x[0] === cur.unit; })[0];
    if (!u) return "";
    var items = (d.items || []).filter(function (x) { return x.unit === cur.unit && inMainline(x, bid); });
    if (items.length < 2) return boardMapHtml(bid, cur);  // 单条单元：改给板块级框架，仍有"目录感"
    var p = progress[bid] || { done: {} };
    var done = 0;
    items.forEach(function (x) { if (p.done && p.done[x.id]) done++; });
    var zt = (window.ZZX_ZT || {})[cur.unit] || {};
    var h = '<details class="umap"><summary>' +
      '<div class="um-t"><b>' + esc(u[2]) + "</b><span>" + items.length + " 条 · 已学 " + done +
      (zt.n ? " · 考频 " + zt.n : "") + "</span></div>" +
      '<i class="um-x">目录</i></summary><div class="um-list">';
    items.forEach(function (x, i) {
      h += '<button type="button"' + (x.id === cur.id ? ' class="on"' : "") +
        ' data-jump="' + esc(x.id) + '"><i>' + (i + 1) + "</i><span>" + esc(x.title) + "</span>" +
        (p.done && p.done[x.id] ? "<em>已学</em>" : "") + "</button>";
    });
    if (zt.n) h += '<div class="um-note">本单元近年考 ' + zt.n + " 次 · " + items.length + " 条背诵内容</div>";
    return h + "</div></details>";
  }

  /* 板块级框架：单元 → 条数/真题数，点单元直接进去。
     对标二轮复习的「章节目录」，让用户随时能看到自己在整本书的哪一格。 */
  function boardMapHtml(bid, cur) {
    var d = getBoard(bid); if (!d) return "";
    var units = d.units || [];
    if (units.length < 2) return "";
    var p = progress[bid] || { done: {} };
    var Z = window.ZZX_ZT || {};
    var h = '<details class="umap"><summary><div class="um-t"><b>' + esc(d.name || "本板块") +
      " 框架</b><span>" + units.length + " 个单元 · 共 " + (d.items || []).length + " 条考点</span></div>" +
      '<i class="um-x">目录</i></summary><div class="um-list">';
    units.forEach(function (u, i) {
      var its = (d.items || []).filter(function (x) { return x.unit === u[0] && inMainline(x, bid); });
      var dn = 0;
      its.forEach(function (x) { if (p.done && p.done[x.id]) dn++; });
      var z = Z[u[0]] || {};
      var here = (u[0] === cur.unit);
      h += '<button type="button"' + (here ? ' class="on"' : "") + ' data-unitgo="' +
        esc(bid + "|" + u[0]) + '"><i>' + (i + 1) + "</i><span>" + esc(u[2]) + "</span>" +
        '<u class="um-meta">' + its.length + " 条" + (z.n ? " · 考频 " + z.n : "") +
        (dn ? " · 已学 " + dn : "") + "</u></button>";
    });
    return h + "</div></details>";
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

    /* 冲刺模式提示：把「收起了多少」直接摊开，避免误以为考点缺失 */
    var cutN = countCut(bd.id);
    if (cutN && !state.full) {
      h += '<div class="tier-bar"><span>冲刺模式：已收起 ' + cutN + " 条过程细节／文献，只走主线</span>" +
        '<button type="button" class="tier-btn" data-full="1">看全量 ' + (getBoard(bd.id).items || []).length + "</button></div>";
    } else if (state.full) {
      h += '<div class="tier-bar"><span>全量模式：含已下线细节与全部文献</span>' +
        '<button type="button" class="tier-btn" data-full="0">回到冲刺主线</button></div>';
    }
    /* 真题贴合度：单元级命中（总数/近五年/最近年份）+ 一键练本单元真题。
       数据来自 quiz-zhenti.js 的 462 道真题统计，考点与真题由此直接咬合。 */
    var zt = (window.ZZX_ZT || {})[it.unit] || {};
    var hotN = zt.n || ((window.ZZX_TIER || {}).hot || {})[it.unit] || 0;
    if (hotN) {
      var lvl = hotN >= 25 ? "A" : (hotN >= 12 ? "B" : "C");
      h += '<div class="hot-note lvl-' + lvl + '">' +
        '<b class="hot-lvl">' + lvl + " 级高频</b>" +
        "<span>本单元近年考 <b>" + hotN + "</b> 次" +
        (zt.recent ? " · 近五年 " + zt.recent + " 次" : "") +
        (zt.last ? " · 最近 " + zt.last + " 年考过" : "") + "</span>" +
        '<b class="hot-must">高频必背</b></div>';
    }
    h += unitMapHtml(bd.id, it);

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
      /* 当前条目是"正在看的那张图"，用 eager + high 抢优先级：
         iOS PWA 里 lazy 图片在滚动容器中偶发不触发，表现为"图一直不出来" */
      h += '<figure class="b-fig' + (imgSizeOf(it.img) ? " has-ratio" : "") + '"><img class="shot" src="' +
        esc(thumbOf(it.img)) + '" alt="' + esc(it.imgCap || "") +
        '" loading="eager" fetchpriority="high" decoding="async"' + imgAttrs(it.img) + ' data-thumb="' + esc(thumbOf(it.img)) +
        '" data-full="' + esc(it.img) + '" data-cap="' + esc(it.imgCap || "") + '">' +
        '<figcaption>' + esc(it.imgCap || "") + "</figcaption></figure>";
    }

    h += (pg.blocks || []).map(renderBlock).join("");
    h += "</div>";

    $("viewStudy").innerHTML = h;
    show("viewStudy");
    $("viewStudy").scrollTop = 0;
    resetViewScroll("viewStudy");   // 进新板块一律从顶部开始，不被上一次的续读位置带偏
    $("topTitle").textContent = it.title;
    $("topSub").textContent = bd.short + " · " + (it.dateLabel || KIND_LABEL[it.kind] || "");
    var p = subProgress(bd.id);
    savePos(bd.id, it.id, state.page);
    /* 细进度条跟随浏览位置，与刻度条上的当前刻度一致 */
    $("progressBar").style.width = (list.length ? Math.round((state.index + 1) / list.length * 100) : 0) + "%";
    $("progressText").textContent = (state.index + 1) + " / " + list.length +
      (p.done[it.id] ? " · 本条目已掌握" : "");
    renderPstrip(list);
    focusPsegSoon();          // 刻度条的中心聚焦（离中心最近的那条轻微放大）
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

  /* ================= 真题锚点（小板块共用） =================
     小板块最容易写成"讲道理"，这里统一给每条内容挂上真实数据：
     它属于哪个单元、这个单元在真题里考过几次、具体哪几年考过。 */
  function ztOf(unit) { return unit ? (window.ZZX_ZT || {})[unit] || null : null; }
  function ztYears(unit, max) {
    var z = ztOf(unit);
    if (!z || !z.years) return "";
    var ys = Object.keys(z.years).sort();
    return ys.slice(Math.max(0, ys.length - (max || 3))).join("·");
  }
  /* 单元 → 可读标签，如「史纲 2」 */
  function unitLabel(unit) {
    if (!unit) return "";
    var m = /^(my|mao|sg|sf|xc)(\d+)$/.exec(unit);
    if (!m) return unit;
    var nm = { my: "马原", mao: "毛中特", sg: "史纲", sf: "思修", xc: "形策" }[m[1]] || m[1];
    return nm + " " + m[2];
  }
  /* id → unit（整周年用 ids 反查） */
  var _unitById = null;
  function itemUnitOf(id) {
    if (!_unitById) {
      _unitById = {};
      ["my", "mao", "sg", "sf", "xc"].forEach(function (b) {
        var d = getBoard(b);
        if (d) d.items.forEach(function (x) { _unitById[x.id] = x.unit; });
      });
    }
    return _unitById[id] || "";
  }
  /* 一条真题锚点文案：「史纲 2 · 2009 年考 · 2010·2015·2021」 */
  function ztAnchor(unit, max) {
    var z = ztOf(unit);
    if (!z || !z.n) return "";
    var ys = ztYears(unit, max || 3);
    return unitLabel(unit) + " · 考 " + z.n + " 次" + (ys ? "（" + ys + "）" : "");
  }
  /* 条目首个正文段落，用于在案例卡上给"考点原文" */
  function firstPara(it) {
    var bs = (it && it.blocks) || [];
    for (var i = 0; i < bs.length; i++) {
      if (bs[i].t === "p" && bs[i].v) return String(bs[i].v);
      if (bs[i].t === "kv" && bs[i].v && bs[i].v[0]) return bs[i].v[0][1];
    }
    return "";
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
      /* 时间轴按时间读，单元名重复没意义，只留「考几次 + 哪几年」 */
      var z = ztOf(it.unit), zt = "";
      if (z && z.n) { var ys = ztYears(it.unit, 3); zt = "真题 " + z.n + " 次" + (ys ? " · " + ys : ""); }
      return '<div class="tl-node"><div class="tl-year">' + esc(it.dateLabel || it.year || "") + "</div>" +
        '<div class="tl-body"><h4>' + esc(it.title) + "</h4>" +
        "<p>" + esc(it.sub || "") + "</p>" +
        (zt ? '<div class="tl-zt">' + esc(zt) + "</div>" : "") +
        '<div class="tags"><button type="button" class="chip" data-jump="' + esc(it.id) + '">看考点原文</button>' +
        (it.kind ? '<span class="tagline k-' + esc(KIND_LABEL[it.kind] ? it.kind : "topic") + '">' + (KIND_LABEL[it.kind] || "") + "</span>" : "") + "</div></div></div>";
    }
    var h = '<div class="wrap">';
    var ztSum = 0;
    var seenU = {};
    items.forEach(function (it) {
      if (!it.unit || seenU[it.unit]) return;
      seenU[it.unit] = 1;
      var z = ztOf(it.unit); if (z) ztSum += z.n;
    });
    h += '<div class="crumb"><span>双主线时间轴</span><span>·</span><span>事件轴 ⇄ 党的理论政策轴</span></div>';
    h += '<div class="tl-note">每个节点都标了它所在单元的真题锚点（考过几次、哪几年考），背完一句就知道这个点值几分。</div>';
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
    h += '<div class="case-tip">分析题的材料都长这样：先认案例，再答它对应的原理原句，最后落材料。每条都标了考点原文与真题锚点。</div>';
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
      h += '<div class="sec-title">按案例找原理 · ' + (caseIndex || []).length + ' 条</div><div class="cards">' +
        (caseIndex || []).slice(0, 24).map(function (x) {
          var fp = firstPara(x.it);
          return '<button type="button" class="card" data-case="' + esc(x.c.q) + '" style="--cc:var(--c-my)">' +
            '<div class="card-top"><b>' + esc(x.c.q) + '</b><span class="bdg">' + esc(x.it.title) + "</span></div>" +
            "<p>" + esc(fp ? fp.slice(0, 62) + (fp.length > 62 ? "…" : "") : x.c.a) + "</p>" +
            (ztAnchor(x.it.unit, 2) ? '<div class="case-zt">真题锚点：' + esc(ztAnchor(x.it.unit, 2)) + "</div>" : "") +
            "</button>";
        }).join("") + "</div>";
    } else if (!hits.length) {
      h += '<div class="empty">没有匹配的案例或原理<br>换个关键词试试，例如「矛盾」「量变」「脱贫攻坚」「改革」</div>';
    } else {
      h += '<div class="sec-title">匹配到 ' + hits.length + " 条</div>";
      h += hits.map(function (x) {
        var fp = firstPara(x.it), zt = ztAnchor(x.it.unit, 3);
        return '<div class="anchor-card" style="margin-bottom:10px">' +
          "<h4>" + esc(x.it.title) + " ← " + esc(x.c.q) + "</h4>" +
          "<p>" + esc(x.c.a) + "</p>" +
          (fp ? '<p class="case-core"><b>考点原文</b>' + esc(fp) + "</p>" : "") +
          (zt ? '<div class="case-zt">真题锚点：' + esc(zt) + "</div>" : "") +
          '<div class="b-link" style="margin-top:9px"><button type="button" data-jump="' + esc(x.it.id) + '"><i>原理</i>背诵原句</button></div></div>';
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

  /* ---------------- 通用：按需加载额外数据 ---------------- */
  var extraLoaded = {};
  function loadExtra(files) {
    var chain = Promise.resolve(true);
    files.forEach(function (f) {
      if (extraLoaded[f]) return;
      chain = chain.then(function () {
        return loadScript(f).then(function (ok) { if (ok) extraLoaded[f] = true; return ok; });
      });
    });
    return chain;
  }

  /* ================= 马原 · 原理 × 材料对接 =================
     编排：王一珉「选考点 → 搭框架 → 填材料」；每条原理配「材料里长这样」的触发句。
     用法：先背 one（一句原理），再记 sig（什么材料该答它），最后看 exams（真题怎么考）。 */
  var PAIR_FILES = ["js/data/my-pair.js"];
  var pairHide = localStorage.getItem("zzx.pairhide") === "1";
  function pairItems() { return ((window.ZZX_MY_PAIR || {}).items || []).slice(); }

  function renderPair(q, forceTop) {
    q = (q || "").trim();
    var all = pairItems().sort(function (a, b) { return (b.rank || 0) - (a.rank || 0); });
    var list = all;
    if (q) {
      var k = q.toLowerCase();
      list = all.filter(function (p) {
        if (p.name.toLowerCase().indexOf(k) >= 0) return true;
        if ((p.one || "").toLowerCase().indexOf(k) >= 0) return true;
        return (p.sig || []).some(function (s) {
          return (s.q + s.t).toLowerCase().indexOf(k) >= 0;
        });
      });
    }
    var h = '<div class="wrap">';
    h += '<div class="crumb"><span>马原</span><span>·</span><span>原理 × 材料对接</span></div>';
    h += '<div class="hero-mini"><h1>背一句原理，<em>认一句材料</em></h1>' +
      '<p>' + esc((window.ZZX_MY_PAIR || {}).note || "") + "</p></div>";
    h += '<div class="pair-tools">' +
      '<div class="search-box"><input id="pairInput" type="search" placeholder="贴材料原句，或搜「变废为宝」「抓重点」" value="' + esc(q) + '"></div>' +
      '<button type="button" class="chip' + (pairHide ? " on" : "") + '" data-pairhide="1">' + (pairHide ? "背诵句已遮住" : "遮住背诵句") + "</button></div>";
    h += '<details class="pair-howto"><summary>王一珉：30 秒读材料 → 选考点（点开）</summary>' +
      "<ol>" +
      "<li><b>圈三样</b>：时间、主体、做法。时间本身是史纲考点；做法决定是「为什么」还是「怎么做」。</li>" +
      "<li><b>看设问动词</b>：是什么／为什么 → 先定性再讲原因；怎么做／意义 → 先对策再讲价值。答偏比答少更亏。</li>" +
      "<li><b>只抄对得上的原文</b>：比喻句、形容词、细节、问句不抄；数据、时间、人名要先加工；领导人讲话去引号抓关键词。</li>" +
      "<li><b>最后定原理</b>：材料里出现「对立又统一／转化／偶然／试点／技术该不该」，回到下面对应卡片。</li>" +
      "</ol></details>";

    if (q && !list.length) {
      h += '<div class="empty">没匹配到材料信号<br>换个说法试试：转化｜抓重点｜偶然｜试点｜技术该不该</div>';
    } else {
      h += '<div class="sec-title">' + (q ? "匹配 " + list.length + " 条原理" : "18 条哲学原理 · 按分析题命中排序") + "</div>";
      h += list.map(function (p, i) {
        return '<div class="pair-card">' +
          '<div class="pair-head"><h3>' + (i + 1) + ". " + esc(p.name) + "</h3>" +
          (p.rank ? '<span class="pair-rank">分析题 ' + p.rank + " 次</span>" : '<span class="pair-rank pair-r0">以选择题为主</span>') + "</div>" +
          '<div class="pair-sec"><i>① 背这一句</i>' +
          '<p class="pair-one' + (pairHide ? " pair-hidden" : "") + '">' + esc(p.one) + "</p></div>" +
          '<div class="pair-sec"><i>② 材料长这样 → 就答它</i><ul class="pair-sig">' +
          (p.sig || []).map(function (s) {
            return "<li><span class=\"sig-q\">" + esc(s.q) + '</span><span class="sig-arrow">→</span><b>' + esc(s.t) + "</b></li>";
          }).join("") + "</ul></div>" +
          '<div class="pair-sec"><i>③ 三步框架（原理句—材料句—方法句）</i><ol class="pair-frame">' +
          (p.frame || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ol></div>" +
          ((p.exams || []).length
            ? '<div class="pair-sec"><i>④ 真题考法</i><div class="pair-exams">' +
              p.exams.map(function (e) {
                return '<span class="pe"><b>' + e.y + "</b> " + esc(e.t) + ' <em>' + esc(e.hit) + "</em></span>";
              }).join("") + "</div></div>"
            : "") +
          (p.fill ? '<div class="pair-tip">⑤ ' + esc(p.fill) + "</div>" : "") +
          '<div class="pair-foot"><button type="button" class="ghost-btn" data-jump="' + esc(p.id) + '">查看完整原理 →</button></div>' +
          "</div>";
      }).join("");
    }
    h += "</div>";

    $("viewPair").innerHTML = h;
    show("viewPair");
    if (forceTop || !q) { $("viewPair").scrollTop = 0; resetViewScroll("viewPair"); }
    $("topTitle").textContent = "原理 × 材料";
    $("topSub").textContent = "背一句 → 认一句材料 → 套三步框架";
    $("progressStrip").hidden = true;
    $("actionbar").hidden = true;
    var inp = $("pairInput");
    if (inp) {
      if (q) { inp.focus(); inp.setSelectionRange(q.length, q.length); }
      inp.addEventListener("input", function () {
        clearTimeout(inp._t);
        inp._t = setTimeout(function () { renderPair(inp.value); var i2 = $("pairInput"); if (i2) i2.focus(); }, 300);
      });
    }
  }

  /* ================= 史纲 · 2026 整周年主线 ================= */
  var ANNIV_FILES = ["js/data/sg-anniv.js"];
  function renderAnniv() {
    var D = window.ZZX_SG_ANNIV || { items: [], lines: [] };
    var items = (D.items || []).slice().sort(function (a, b) { return (a.y - b.y) || (b.n - a.n); });
    var h = '<div class="wrap">';
    h += '<div class="crumb"><span>史纲</span><span>·</span><span>2026 整周年主线</span></div>';
    var ztAll = "";
    (function () {
      var sum = 0, seen = {};
      items.forEach(function (it) {
        (it.ids || []).forEach(function (id) {
          var u = itemUnitOf(id);
          if (!u || seen[u]) return;
          seen[u] = 1;
          var z = ztOf(u); if (z) sum += z.n;
        });
      });
      if (sum) ztAll = '<div class="anniv-zt-top">这些节点覆盖的考点单元，2010—2023 年真题共考 ' + sum + " 次。</div>";
    })();
    h += '<div class="hero-mini"><h1>史纲只背<em>这一页</em></h1><p>' + esc(D.note || "") + "</p>" + ztAll + "</div>";
    h += '<div class="anniv-lines">' + (D.lines || []).map(function (l) {
      return '<div class="al-item"><b>' + esc(l.name) + "</b><span>" + esc(l.desc) + "</span></div>";
    }).join("") + "</div>";
    h += '<div class="sec-title">整周年节点 · ' + items.length + " 个</div>";
    h += items.map(function (it) {
      /* 用 ids 反查单元，把"这个整周年在真题里考过几次"直接标出来 */
      var us = [], anchors = [];
      (it.ids || []).forEach(function (id) {
        var u = itemUnitOf(id);
        if (u && us.indexOf(u) < 0) { us.push(u); var a = ztAnchor(u, 3); if (a) anchors.push(a); }
      });
      return '<div class="annv-card">' +
        '<div class="annv-y"><b>' + it.y + '</b><span>' + it.n + " 周年</span></div>" +
        '<div class="annv-main"><h4>' + esc(it.ev) + '</h4><p>' + esc(it.core) + "</p>" +
        (anchors.length ? '<div class="annv-zt">真题锚点：' + esc(anchors.join("；")) + "</div>" : "") +
        ((it.ids || []).length
          ? '<div class="annv-links">' + it.ids.map(function (id) {
              return '<button type="button" class="chip" data-jump="' + esc(id) + '">回看考点</button>';
            }).join("") + "</div>"
          : "") +
        "</div></div>";
    }).join("");
    h += '<div class="home-foot">史纲已按主线瘦身：以上节点 + 高频事件即主线，过程性细节已收起（可在板块页切全量）。</div>';
    h += "</div>";

    $("viewAnniv").innerHTML = h;
    show("viewAnniv");
    $("viewAnniv").scrollTop = 0;
    resetViewScroll("viewAnniv");
    $("topTitle").textContent = "2026 整周年";
    $("topSub").textContent = "24 个节点 · 一句结论直接背";
    $("progressStrip").hidden = true;
    $("actionbar").hidden = true;
  }

  /* ================= 背诵中心（27 届背诵清单 92 条） =================
     手机主屏打到 PWA 上，打开即背：选部分 → 看「线索」回忆 → 展开正文核对 → 遮住正文自测。
     数据与进度都存本地，离线可用；进度单独一个 key，不并入五板块进度。 */
  var BS_FILES = ["js/data/beisong.js"];
  var BS_KEY = "zzx.bs.v1";
  /* 只记「背到哪」：部分、筛选、遮不遮正文、上次滚动位置。
     不做会背/模糊这类自评打标，进度完全由自己掌握（翻到哪就是哪）。 */
  function bsState() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(BS_KEY) || "{}") || {}; } catch (e) { s = {}; }
    return {
      hide: !!s.hide,
      part: s.part || 0,
      filter: s.filter === "lv2" ? "lv2" : "all",
      scroll: s.scroll || 0
    };
  }
  function bsSave(s) {
    try {
      localStorage.setItem(BS_KEY, JSON.stringify({
        hide: s.hide, part: s.part, filter: s.filter, scroll: s.scroll || 0
      }));
    } catch (e) {}
  }
  function bsAll(D) {
    var out = [];
    (D.parts || []).forEach(function (p) {
      (p.sections || []).forEach(function (s) {
        (s.groups || []).forEach(function (g) {
          (g.items || []).forEach(function (it) { out.push(it); });
        });
      });
    });
    return out;
  }
  function renderBs() {
    var D = window.ZZX_BS;
    if (!D || !D.parts) {
      $("viewBs").innerHTML = '<div class="wrap"><div class="empty">背诵数据未加载<br>请检查网络后重进</div></div>';
      show("viewBs"); return;
    }
    var st = bsState();
    var all = bsAll(D);
    var lv2 = all.filter(function (x) { return x.lv === 2; });
    var pi = Math.min(st.part, D.parts.length - 1);
    var part = D.parts[pi];

    var h = '<div class="wrap">';
    h += '<div class="crumb"><span>背诵中心</span><span>·</span><span>' + esc((D.source && D.source.title) || "27 届背诵清单") + "</span></div>";
    h += '<div class="hero-mini"><h1>打开就背，<em>' + all.length + " 条</em></h1>" +
      '<p>先看线索回忆，再展开核对；不设打卡、不计进度，背到哪算哪。遮住正文可点一句露一句。</p></div>';

    h += '<div class="bs-tabs">' + D.parts.map(function (p, i) {
      var n = 0;
      (p.sections || []).forEach(function (s) {
        (s.groups || []).forEach(function (g) { n += (g.items || []).length; });
      });
      return '<button type="button" class="bs-tab' + (i === pi ? " on" : "") + '" data-bspart="' + i + '">' +
        esc(p.abbr) + "<em>" + n + " 条</em></button>";
    }).join("") + "</div>";

    h += '<div class="bs-filters">' +
      '<button type="button" class="chip' + (st.filter === "all" ? " on" : "") + '" data-bsfilter="all">全部</button>' +
      '<button type="button" class="chip' + (st.filter === "lv2" ? " on" : "") + '" data-bsfilter="lv2">只看必背 ' + lv2.length + "</button>" +
      '<button type="button" class="chip' + (st.hide ? " on" : "") + '" data-bshide="1">' + (st.hide ? "正文已遮住" : "遮住正文") + "</button>" +
      "</div>";

    h += (part.sections || []).map(function (s) {
      var groups = (s.groups || []).map(function (g) {
        var items = (g.items || []).filter(function (it) {
          if (st.filter === "lv2" && it.lv !== 2) return false;
          return true;
        });
        if (!items.length) return "";
        return '<div class="bs-group"><div class="bs-group-name">' + esc(g.name) + "</div>" +
          items.map(function (it) {
            return '<div class="bs-item">' +
              '<div class="bs-top">' +
              '<span class="bs-no">' + (it.no < 10 ? "0" : "") + it.no + "</span>" +
              '<b class="bs-title">' + esc(it.title) + "</b>" +
              (it.lv === 2 ? '<span class="bs-lv">必背</span>' : "") +
              "</div>" +
              (it.clue ? '<div class="bs-clue"><i>线索</i>' + esc(it.clue) + "</div>" : "") +
              '<div class="bs-body' + (st.hide ? " bs-hidden" : "") + '">' +
              (it.body || []).map(function (x, xi) {
                return '<p data-bsrev="' + it.key + "|" + xi + '">' + esc(x) + "</p>";
              }).join("") +
              "</div>" +
              (it.method ? '<div class="bs-method"><i>方法论</i>' + esc(it.method) + "</div>" : "") +
              (it.why ? '<div class="bs-why"><i>陷阱</i>' + esc(it.why) + "</div>" : "") +
              "</div>";
          }).join("") + "</div>";
      }).join("");
      return groups ? '<div class="bs-sec"><h3>' + esc(s.name) + "</h3>" + groups + "</div>" : "";
    }).join("");

    if (h.indexOf('class="bs-group"') < 0) {
      h += '<div class="empty">这个筛选下没有条目，换个筛选看看</div>';
    }
    h += '<div class="home-foot">数据来源：' + esc(((D.source && D.source.file) || "27 届背诵清单中心自研（终版）")) +
      " · 重点分级按考纲固定搭配与近年考频判断</div>";
    h += "</div>";

    var bsSc = $("viewBs").scrollTop, bsFresh = $("viewBs").hidden || !$("viewBs").innerHTML;
    $("viewBs").innerHTML = h;
    show("viewBs");
    /* 背到哪停在哪：本次会话沿用原位置，重开 App 用上次存下的位置；滚动时节流回写 */
    var vb = $("viewBs");
    var keep = bsFresh ? (st.scroll || 0) : bsSc;
    vb.scrollTop = keep;
    viewScroll["viewBs"] = keep;
    if (!vb._bsScroll) {
      vb._bsScroll = 1;
      vb.addEventListener("scroll", function () {
        clearTimeout(vb._t);
        vb._t = setTimeout(function () {
          var s5 = bsState(); s5.scroll = vb.scrollTop; bsSave(s5);
        }, 600);
      }, { passive: true });
    }
    $("topTitle").textContent = "背诵中心";
    $("topSub").textContent = all.length + " 条 · " + lv2.length + " 必背 · " + esc(part.abbr);
    $("progressStrip").hidden = true;
    $("actionbar").hidden = true;
  }

  /* 冲刺三件套入口（首页卡片 / 侧栏按钮共用） */
  function openSprint(v) {
    closeSidebar();
    if (v === "pair") return loadExtra(PAIR_FILES).then(function () { renderPair("", true); });
    if (v === "anniv") return loadExtra(ANNIV_FILES).then(function () { renderAnniv(); });
    /* 背诵数据已随首屏加载，这里不再重复拉一次 */
    if (window.ZZX_BS) { renderBs(); return; }
    return loadExtra(BS_FILES).then(function () { renderBs(); });
  }

  /* ================= 每日一题（真题大题 · 选 3 个考点） =================
     每天一道 2010—2024 年的 34—38 题：先看材料要义与设问，再从 5 个考点里
     选出参考答案真正用到的 3 个。板块按天轮流（马原→毛中特→史纲→思修→形策），
     每个板块 5 天一换题，25 天不重样；答完给参考答案要点与“为什么是这三个”。
     答题记录单独存一个 key（按账号隔离），不并入五板块进度。 */
  var DAILY_BOARDS = ["my", "mao", "sg", "sf", "xc"];
  var DAILY_KEY = "daily";
  /* 轮换起点：2026-01-06 起算，使 2026-11-02 正好落在「马原 · 2024 年」这一格；
     之后每天换板块，5 天换一道题，25 天把 25 道题走完一遍。 */
  var DAILY_EPOCH = Date.UTC(2026, 0, 6);
  var DAILY_LETTER = ["A", "B", "C", "D", "E"];
  var daily = blankDaily();

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function todayKey() { return ymdOf(new Date()); }
  function mdLabel() { var d = new Date(); return (d.getMonth() + 1) + " 月 " + d.getDate() + " 日"; }
  function dailyDayNo() {
    var d = new Date();
    var t = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.max(0, Math.round((t - DAILY_EPOCH) / 86400000));
  }
  function dailyBank() {
    var D = window.ZZX_DAILY;
    return (D && D.items) ? D.items : [];
  }
  function dailyToday() {
    var bank = dailyBank();
    if (!bank.length) return null;
    var n = dailyDayNo();
    var bid = DAILY_BOARDS[n % DAILY_BOARDS.length];
    var pool = bank.filter(function (x) { return x.b === bid; });
    if (!pool.length) return null;
    pool = pool.slice().sort(function (a, b) { return (b.y - a.y) || (b.n - a.n); });   // 近年真题优先
    var idx = Math.floor(n / DAILY_BOARDS.length) % pool.length;
    return { it: pool[idx], bid: bid, dayNo: n, date: todayKey() };
  }
  function dailyBoard(bid) {
    return BOARDS.filter(function (b) { return b.id === bid; })[0] || null;
  }
  function blankDaily() { return { rec: {}, draft: { d: "", picks: [] } }; }
  function cleanPicks(v) {
    var out = [];
    (Array.isArray(v) ? v : []).slice(0, 3).forEach(function (x) {
      var n = capInt(x, 0, 4, -1);
      if (n >= 0 && out.indexOf(n) < 0) out.push(n);
    });
    return out;
  }
  /* 记录来自本机，读回时仍按白名单收紧：日期、题号、选项下标、对错与命中数 */
  function sanitizeDaily(d) {
    var out = blankDaily();
    if (!isPlainObject(d)) return out;
    var rec = isPlainObject(d.rec) ? d.rec : {};
    Object.keys(rec).slice(0, 400).forEach(function (k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
      var e = rec[k]; if (!isPlainObject(e)) return;
      var id = capStr(e.id, 16);
      if (!/^\d{4}-\d{2}$/.test(id)) return;
      out.rec[k] = {
        id: id, b: capStr(e.b, 8), picks: cleanPicks(e.picks),
        ok: e.ok ? 1 : 0, hit: capInt(e.hit, 0, 3, 0), at: capInt(e.at, 0, 9999999999999, 0)
      };
    });
    if (isPlainObject(d.draft) && /^\d{4}-\d{2}-\d{2}$/.test(d.draft.d || "")) {
      out.draft = { d: d.draft.d, picks: cleanPicks(d.draft.picks) };
    }
    return out;
  }
  function loadDaily() { return sanitizeDaily(recData(userKey(DAILY_KEY))); }
  function saveDaily() {
    if (document.body.classList.contains("auth-mode")) return;   // 登录页上不写入，避免串账号
    setRec(userKey(DAILY_KEY), daily);
  }
  /* 连续答对天数：今天还没答就先看昨天；今天答错则从 0 开始 */
  function dailyStreak() {
    var d = new Date(), n = 0, today = todayKey(), skipped = false;
    for (var i = 0; i < 400; i++) {
      var k = ymdOf(d), r = daily.rec[k];
      if (!r && k === today && !skipped) { skipped = true; d.setDate(d.getDate() - 1); continue; }
      if (r && r.ok) { n++; d.setDate(d.getDate() - 1); continue; }
      break;
    }
    return n;
  }

  /* 首页入口卡：今天该做哪道、做完没有 */
  function dailyCardHtml() {
    var t = dailyToday(); if (!t) return "";
    var it = t.it, bd = dailyBoard(t.bid), rec = daily.rec[t.date];
    var bname = bd ? bd.short : (it.b || "");
    var status = rec
      ? (rec.ok ? "今日已答对 · 连续 " + dailyStreak() + " 天" : "今日已答 · 选对 " + rec.hit + "/3")
      : "5 个考点里选 3 个 · 选项来自参考答案";
    return '<button type="button" class="daily-card' + (rec ? " is-done" : "") + '" data-daily="1" style="--cc:' +
      (bd ? bd.color : "var(--accent)") + '">' +
      '<div class="daily-top"><span class="daily-kicker">每日一题 · ' + mdLabel() + '</span>' +
      '<span class="daily-bdg">' + esc(bname) + "</span></div>" +
      '<div class="daily-title">' + (rec ? "今天这道已答完" : "这道大题，该答哪三个原理？") + "</div>" +
      '<div class="daily-sub">' + it.y + " 年第 " + it.n + " 题 · " + esc(it.t) + "</div>" +
      '<div class="daily-foot"><span>' + esc(status) + "</span><b>" + (rec ? "看解析" : "开始") + " →</b></div></button>";
  }

  function dailyHistoryHtml() {
    var cells = "", any = false, today = todayKey();
    for (var i = 6; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var k = ymdOf(d), r = daily.rec[k];
      if (r) any = true;
      cells += '<div class="dh-cell' + (r && r.ok ? " ok" : r ? " bad" : "") + (k === today ? " today" : "") + '">' +
        "<b>" + (r ? (r.ok ? "✓" : "✗") : "·") + "</b><span>" + (d.getMonth() + 1) + "/" + d.getDate() + "</span></div>";
    }
    if (!any) return "";
    return '<div class="daily-hist"><div class="dh-title">最近 7 天</div><div class="dh-row">' + cells + "</div></div>";
  }

  function renderDaily() {
    var t = dailyToday();
    var host = $("viewDaily");
    if (!t) {
      host.innerHTML = '<div class="wrap"><div class="empty">每日一题的数据没有加载成功<br>联网后重新打开即可</div></div>';
      show("viewDaily");
      $("topTitle").textContent = "每日一题";
      $("topSub").textContent = "数据未加载";
      $("progressStrip").hidden = true;
      $("actionbar").hidden = true;
      return;
    }
    var it = t.it, bd = dailyBoard(t.bid), rec = daily.rec[t.date], answered = !!rec;
    var picks = rec ? rec.picks.slice() : (daily.draft.d === t.date ? daily.draft.picks.slice() : []);
    var hit = rec ? rec.hit : 0;
    var ok = answered && rec.ok;

    var h = '<div class="wrap daily-wrap">';
    h += '<button type="button" class="daily-back" data-gohome="1">← 回首页</button>';
    h += '<div class="crumb"><span>每日一题</span><span>·</span><span>' + mdLabel() + "</span><span>·</span><span>" +
      esc(bd ? bd.name : it.b) + "</span></div>";
    h += '<div class="hero-mini daily-hero"><h1>这道大题，该答<em>哪三个原理</em></h1>' +
      "<p>" + it.y + " 年第 " + it.n + " 题 · " + esc(it.t) + "。选项全部来自参考答案，选出真正用得上的 3 个。</p></div>";

    h += '<div class="daily-q">' +
      '<div class="dq-sec"><i>材料要义</i><p>' + esc(it.m) + "</p></div>" +
      '<div class="dq-sec"><i>设问</i><p class="dq-ask">' + esc(it.q) + "</p></div></div>";

    h += '<div class="daily-sec-title"><b>从 5 个考点里选 3 个</b><span>' +
      (answered ? "已提交" : "已选 " + picks.length + "/3") + "</span></div>";
    h += '<div class="daily-opts' + (answered ? " is-answered" : "") + '">';
    it.o.forEach(function (txt, i) {
      var right = it.a.indexOf(i) >= 0, picked = picks.indexOf(i) >= 0;
      var cls = "", mark = "";
      if (answered) {
        if (right && picked) { cls = " right sel"; mark = "✓ 选对"; }
        else if (right) { cls = " right miss"; mark = "应选"; }
        else if (picked) { cls = " wrong sel"; mark = "✕ 错选"; }
      } else if (picked) { cls = " sel"; mark = "已选"; }
      h += '<button type="button" class="dopt' + cls + '" data-dopt="' + i + '"' + (answered ? " disabled" : "") + ">" +
        "<b>" + DAILY_LETTER[i] + "</b><span>" + esc(txt) + "</span>" +
        (mark ? '<i class="dopt-mark">' + mark + "</i>" : "") + "</button>";
    });
    h += "</div>";

    if (!answered) {
      h += '<div class="daily-act"><span class="daily-count">已选 ' + picks.length + " / 3</span>" +
        '<button type="button" class="btn btn-primary" data-dsubmit="1"' + (picks.length === 3 ? "" : " disabled") +
        ">提交答案</button></div>" +
        '<div class="daily-tip">先看设问问的是“为什么 / 如何”，再从 5 个选项里挑能直接回答它的原理。多选、少选都算错。</div>';
    } else {
      h += '<div class="daily-result ' + (ok ? "ok" : "part") + '">' +
        '<div class="dr-head"><b>' + (ok ? "全对 · 3/3" : "选对 " + hit + " / 3") + "</b>" +
        "<span>连续 " + dailyStreak() + " 天</span></div>" +
        '<p class="dr-line">' + (ok ? "三个落点都抓住了，明天换个板块继续。"
          : hit === 2 ? "差一个：材料里还有一层意思没落到选项上。"
            : "先对照参考答案的落点，再回看材料里的关键词。") + "</p>" +
        '<div class="dr-pick"><span>正确答案 <b>' +
        it.a.slice().sort(function (a, b) { return a - b; }).map(function (i) { return DAILY_LETTER[i]; }).join(" ") +
        "</b></span><span>你的选择 <b>" +
        picks.slice().sort(function (a, b) { return a - b; }).map(function (i) { return DAILY_LETTER[i]; }).join(" ") +
        "</b></span></div>" +
        '<div class="dr-sec"><i>参考答案要点</i><ul>' +
        (it.ref || []).map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" +
        '<div class="dr-sec why"><i>为什么是这三个</i><p>' + esc(it.why) + "</p></div>" +
        '<div class="dr-sec"><i>这道题指向</i><p>' + esc(it.th) + "</p></div>" +
        ((it.k && it.k.length) ? '<div class="dr-k">' + it.k.map(function (id) {
          var x = findItem(id);
          return '<button type="button" class="chip chip-sm" data-jump="' + esc(id) + '">' + esc(x ? x.title : id) + "</button>";
        }).join("") + "</div>" : "") +
        '<div class="daily-act"><button type="button" class="btn btn-primary" data-dessay="' + it.y + "|" + it.n +
        '">看完整答题逻辑</button><button type="button" class="btn btn-sm" data-dailyall="1">全部材料分析题</button></div>' +
        "</div>";
    }

    h += dailyHistoryHtml();
    h += "</div>";
    host.innerHTML = h;
    show("viewDaily");
    $("topTitle").textContent = "每日一题";
    $("topSub").textContent = mdLabel() + " · " + (bd ? bd.short : it.b) + " · " + it.y + " 年第 " + it.n + " 题";
    $("progressStrip").hidden = true;
    $("actionbar").hidden = true;
  }

  function dailyPick(i) {
    var t = dailyToday(); if (!t || daily.rec[t.date]) return;
    var picks = (daily.draft.d === t.date) ? daily.draft.picks.slice() : [];
    var at = picks.indexOf(i);
    if (at >= 0) picks.splice(at, 1);
    else if (picks.length >= 3) { toast("只能选 3 个：先取消一个再选"); return; }
    else picks.push(i);
    daily.draft = { d: t.date, picks: picks };
    saveDaily();
    renderDaily();
  }
  function dailySubmit() {
    var t = dailyToday(); if (!t || daily.rec[t.date]) return;
    var picks = (daily.draft.d === t.date) ? daily.draft.picks.slice() : [];
    if (picks.length !== 3) { toast("先选满 3 个考点"); return; }
    var it = t.it;
    var hit = picks.filter(function (x) { return it.a.indexOf(x) >= 0; }).length;
    daily.rec[t.date] = { id: it.id, b: it.b, picks: picks, ok: hit === 3 ? 1 : 0, hit: hit, at: Date.now() };
    daily.draft = { d: "", picks: [] };
    saveDaily();
    renderDaily();
    if (hit === 3) toast("全对 · 三个落点都抓住了");
    var el = $("viewDaily").querySelector(".daily-result");
    if (el) setTimeout(function () { try { el.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (e) {} }, 140);
  }
  function openDaily() {
    closeSidebar();
    if (!dailyBank().length) { toast("每日一题数据未加载，联网后重进即可"); return; }
    renderDaily();
  }
  /* 答完后跳到材料分析题里这道题的完整答题逻辑，并展开定位 */
  function openEssayAt(y, n) {
    efilter.board = "all"; efilter.year = "all";
    eOpen[y + "." + n] = true;
    var p = renderEssay();
    (p && p.then ? p : Promise.resolve()).then(function () {
      setTimeout(function () {
        var el = document.getElementById("essay-" + y + "-" + n);
        if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: "start", behavior: "smooth" }); } catch (e) {} }
      }, 120);
    });
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
  /* 单元 → 该单元第一条考点（真题解析里的"回考点"入口用） */
  function firstItemOfUnit(uid) {
    if (!uid) return null;
    var hit = null;
    BOARDS.some(function (b) {
      var d = getBoard(b.id); if (!d) return false;
      var it = (d.items || []).filter(function (x) { return x.unit === uid; })[0];
      if (it) { hit = it.id; return true; }
      return false;
    });
    return hit;
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
      /* 真题数据只标到单元，没有逐题考点 id：退一步跳到该单元第一条考点，
         保证"做错 → 回考点"这条路永远走得通（而不是没有入口） */
      var jid = q.j || firstItemOfUnit(q.u);
      if (jid) acts += '<button type="button" data-jump="' + esc(jid) + '"><i>考点</i>' +
        (q.j ? "去学这道题的考点" : "去学本单元考点") + "</button>";
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
  /* 选中 Tab 的液态指示条：从上一个位置滑到当前项（中段拉伸、经过中间位置后收缩回落）。
     用 scaleX 表达宽度，才能做出"液体被拉长再收回"的观感 */
  var tabInk = { x: null, w: 0 };
  var INK_BASE = 100;
  function moveTabInk() {
    var box = document.querySelector("#viewAnalysis .anal-tabs");
    if (!box) return;
    var ink = box.querySelector(".tab-ink");
    var on = box.querySelector(".chip.on");
    if (!ink || !on) return;
    var x = on.offsetLeft, w = on.offsetWidth, h = on.offsetHeight;
    ink.style.width = INK_BASE + "px";
    ink.style.height = h + "px";
    function place(px, pw, animate) {
      ink.style.transition = animate ? "" : "none";
      ink.style.transform = "translateX(" + px + "px) scaleX(" + (pw / INK_BASE) + ")";
    }
    if (motionOK() && tabInk.x != null && Math.abs(tabInk.x - x) > 1) {
      place(tabInk.x, tabInk.w || w, false);       // 先摆回上次位置（不带动画）
      void ink.offsetWidth;
      requestAnimationFrame(function () { place(x, w, true); });   // 再滑到当前项
    } else {
      place(x, w, true);
    }
    tabInk.x = x; tabInk.w = w;
  }
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
      }).join("") + '<span class="tab-ink" aria-hidden="true"></span></div>';
      if (analTab === "now") h += renderNowTab();
      else if (analTab === "wrong") h += renderWrongTab();
      else h += renderWeakTab();
      h += "</div>";
      $("viewAnalysis").innerHTML = h;
      show("viewAnalysis");
      requestAnimationFrame(function () { moveTabInk(); });   // 液态指示条滑到当前项
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
    return Promise.all([loadEssay(), loadAll()]).then(function (r) {
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
        h += '<article id="essay-' + e.y + '-' + e.n + '" class="essay-item' + (open ? " open" : "") + '">';
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
  var viewer = {
    open: false, scale: 1, tx: 0, ty: 0, fitW: 1, fitH: 1, W0: 0, H0: 0, min: 0.2, max: 6,
    dragging: false, px: 0, py: 0,
    src: "", fromEl: null                       // 记录来源缩略图，用于「图片展开/收回」的原位动画
  };

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

  /* 当前图片在屏幕上的最终位置（stage 内的 tx/ty + 缩放后的尺寸） */
  function viewFinalRect() {
    var st = viewStage();
    if (!st) return null;
    var r = st.getBoundingClientRect();
    var w = viewer.W0 * viewer.scale, h = viewer.H0 * viewer.scale;
    return { left: r.left + viewer.tx, top: r.top + viewer.ty, width: w, height: h };
  }
  /* 把 transform 写成 "translate(x,y) scale(s)"：与 viewApply 的取值方式保持一致 */
  function tfOf(tx, ty, s) { return "translate(" + tx + "px," + ty + "px) scale(" + s + ")"; }
  /* 图片展开/收起的公共动画。
     用 Web Animations API 而不是 CSS transition：
     这两次 transform 变更常发生在同一帧里，CSS transition 会被浏览器并帧吞掉（表现为"瞬间到位"） */
  function flipAnim(img, from, to, ms, onEnd) {
    if (!motionOK()) { if (onEnd) onEnd(); return; }
    try {
      var a = img.animate([{ transform: from }, { transform: to }],
        { duration: ms || 340, easing: "cubic-bezier(.22,.61,.36,1)", fill: "none" });
      if (onEnd) a.onfinish = onEnd;
    } catch (e) { if (onEnd) onEnd(); }
  }
  /* 缩略图尺寸 → 全屏（或反向）的起点/终点：以中心对齐，让图从原位向四周扩展 */
  function flipEnds(rect, scale) {
    var fin = viewFinalRect();
    if (!rect || !rect.width || !fin || !fin.width) return null;
    var st = viewStage(), sr = st.getBoundingClientRect();
    var k = Math.max(0.02, rect.width / fin.width);
    var s = scale * k;
    var cx = rect.left + rect.width / 2 - sr.left, cy = rect.top + rect.height / 2 - sr.top;
    return { tf: tfOf(cx - (fin.width * k) / 2, cy - (fin.height * k) / 2, s) };
  }
  /* 图片展开：从被点的那张缩略图的位置与尺寸出发，原位向四周扩展到全屏（共享元素过渡） */
  function flipFromRect(img, rect) {
    var end = flipEnds(rect, viewer.scale);
    if (!end) return;
    flipAnim(img, end.tf, tfOf(viewer.tx, viewer.ty, viewer.scale), 360);
  }
  /* 关闭：原路收回一张图的位置（还在页面上就飞回去，否则淡出） */
  function flipToRect(img, rect) {
    var end = flipEnds(rect, viewer.scale);
    if (!end) return false;
    flipAnim(img, tfOf(viewer.tx, viewer.ty, viewer.scale), end.tf, 320);
    return true;
  }

  function openViewer(src, cap, fromEl) {
    var img = viewImg();
    viewer.open = true;
    viewer.scale = 1; viewer.tx = 0; viewer.ty = 0;
    viewer.src = src;
    viewer.fromEl = fromEl || null;
    img.classList.remove("is-flip", "is-spring");
    img.style.transform = "";
    img.style.transition = "";
    $("imgCap").textContent = cap || "";
    $("imgOverlay").hidden = false;
    img.alt = cap || "";
    img.src = src;
    function ready() {
      viewer.W0 = img.naturalWidth || 1;
      viewer.H0 = img.naturalHeight || 1;
      viewFitWidth();
      var r = viewer.fromEl && viewer.fromEl.getBoundingClientRect ? viewer.fromEl.getBoundingClientRect() : null;
      flipFromRect(img, r);                      // 从缩略图原位扩展出来
    }
    if (img.complete && img.naturalWidth) ready();
    else img.onload = ready;
    requestAnimationFrame(function () { $("imgOverlay").classList.add("is-open"); });
  }

  function closeViewer() {
    var img = viewImg(), ov = $("imgOverlay");
    if (!viewer.open) { ov.hidden = true; return; }
    viewer.open = false;
    var from = viewer.fromEl;
    var rect = (from && from.isConnected && from.getBoundingClientRect) ? from.getBoundingClientRect() : null;
    ov.style.opacity = "";
    ov.classList.remove("is-open");
    if (!flipToRect(img, rect)) {
      setTimeout(function () { ov.hidden = true; img.src = ""; }, 200);
      return;
    }
    setTimeout(function () {
      ov.hidden = true;
      img.classList.remove("is-flip");
      img.style.transform = "";
      img.src = "";
      viewer.scale = 1; viewer.tx = 0; viewer.ty = 0;
    }, 380);
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

    // 移动端：单指拖动 + 双指捏合缩放 + 下滑关闭（手势转场：手指拖多少就跟多少）
    var touch = { mode: null, lx: 0, ly: 0, pinch: null, dismiss: null };
    function dismissReset(spring) {
      var img = viewImg();
      $("imgOverlay").style.opacity = "";
      st.classList.remove("is-dismiss");
      if (!touch.dismiss) return;
      if (spring) {
        img.classList.add("is-spring");
        viewApply();                                  // 回到原位（回弹缓动）
        setTimeout(function () { img.classList.remove("is-spring"); }, 280);
      }
      touch.dismiss = null;
    }
    st.addEventListener("touchstart", function (e) {
      touch.dismiss = null;
      if (e.touches.length === 1) {
        touch.mode = "drag";
        touch.lx = e.touches[0].clientX; touch.ly = e.touches[0].clientY;
        touch.sx = e.touches[0].clientX; touch.sy = e.touches[0].clientY;
        touch.t0 = Date.now();
      } else if (e.touches.length === 2) {
        touch.mode = "pinch";
        touch.dismiss = null;
        touch.pinch = {
          d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY),
          s: viewer.scale
        };
      }
    }, { passive: true });
    st.addEventListener("touchmove", function (e) {
      if (touch.mode === "drag" && e.touches.length === 1) {
        var x = e.touches[0].clientX, y = e.touches[0].clientY;
        var dx = x - touch.lx, dy = y - touch.ly;
        /* 未放大时的下滑 = 关闭手势：以手指位移为主，只有明显偏竖直才接管，避免影响平时平移 */
        if (!touch.dismiss && viewer.scale <= viewer.fitW * 1.06) {
          var ndx = Math.abs(x - touch.sx), ndy = y - touch.sy;
          if (ndy > 10 && ndy > ndx * 1.25) {
            touch.dismiss = { y0: touch.sy, last: touch.sy, lastT: Date.now(), v: 0 };
            st.classList.add("is-dismiss");
          }
        }
        if (touch.dismiss) {
          var total = Math.max(0, y - touch.dismiss.y0);
          var dt = Math.max(1, Date.now() - touch.dismiss.lastT);
          touch.dismiss.v = (y - touch.dismiss.last) / dt;          // px/ms
          touch.dismiss.last = y; touch.dismiss.lastT = Date.now();
          var img = viewImg();
          img.classList.remove("is-spring");
          img.style.transform = "translate(" + viewer.tx + "px," + (viewer.ty + total) + "px) scale(" + viewer.scale + ")";
          $("imgOverlay").style.opacity = String(Math.max(0.12, 1 - total / 460));
          e.preventDefault();
          return;
        }
        viewer.tx += dx; viewer.ty += dy;
        touch.lx = x; touch.ly = y;
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
      if (touch.dismiss) {
        var total = Math.max(0, touch.dismiss.last - touch.dismiss.y0);
        var fast = touch.dismiss.v > 0.45;
        /* 拖得够远、或又快又拉得动，才关闭；轻轻一划就回弹，避免误关 */
        if (total > 96 || (fast && total > 72)) { dismissReset(false); closeViewer(); }
        else dismissReset(true);
        if (e.touches.length === 0) touch.mode = null;
        return;
      }
      if (e.touches.length === 0) touch.mode = null;
      else if (e.touches.length === 1) {
        touch.mode = "drag";
        touch.lx = e.touches[0].clientX; touch.ly = e.touches[0].clientY;
      }
    });

    // 窗口尺寸变化时重新适应
    window.addEventListener("resize", function () { if (viewer.open) viewFitWidth(); });
  }

  /* 手势转场：侧栏已打开时，向左横拖跟随手指收起、右拖回来。
     只在明显偏水平（|dx| > |dy|·1.4）时才接管，纵向滚动照旧；
     不做"从左边缘拖出"——iOS 那里是系统返回手势的地盘，会互相打架 */
  function bindDrawerDrag() {
    var sb = dom.sidebar;
    if (!sb) return;
    var g = null;
    function width() { return sb.offsetWidth || sb.getBoundingClientRect().width || 300; }
    sb.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1 || !sb.classList.contains("open")) { g = null; return; }
      g = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, x: e.touches[0].clientX,
            w: width(), pos: 0, engaged: false, lastT: Date.now(), v: 0 };
    }, { passive: true });
    sb.addEventListener("touchmove", function (e) {
      if (!g || e.touches.length !== 1) return;
      var x = e.touches[0].clientX, y = e.touches[0].clientY;
      var dx = x - g.x0, dy = y - g.y0;
      if (!g.engaged) {
        if (Math.abs(dx) < 9) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.4) { g = null; return; }      // 交给纵向滚动
        g.engaged = true;
        sb.classList.remove("is-spring");
        sb.classList.add("is-drag");
      }
      g.pos = Math.min(0, Math.max(-g.w, dx));                            // 手指拖多少就跟多少
      sb.style.transform = "translateX(" + g.pos + "px)";
      var dt = Math.max(1, Date.now() - g.lastT);
      g.v = (x - g.x) / dt;
      g.x = x; g.lastT = Date.now();
      dom.scrim.style.opacity = String(Math.max(0, 1 + g.pos / g.w));
      e.preventDefault();
    }, { passive: false });
    function finish() {
      if (!g) return;
      var gg = g; g = null;
      if (!gg.engaged) return;
      sb.classList.remove("is-drag");
      var closing = gg.pos <= -gg.w * 0.35 || gg.v <= -0.35;
      sb.classList.add("is-spring");
      if (closing) {
        sb.classList.remove("open");
        dom.scrim.classList.remove("show");
        sb.style.transform = "";
        dom.scrim.style.opacity = "";
        setTimeout(function () { sb.classList.remove("is-spring"); dom.scrim.hidden = true; }, 280);
      } else {
        sb.style.transform = "";
        dom.scrim.style.opacity = "";
        setTimeout(function () { sb.classList.remove("is-spring"); }, 280);
      }
    }
    sb.addEventListener("touchend", finish);
    sb.addEventListener("touchcancel", finish);
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
        var au = el.closest ? el.closest("[data-authuser]") : null;
        if (au) {
          var nm = au.getAttribute("data-authuser") || "";
          if ($("authName")) $("authName").value = nm;
          if ($("authPw")) { try { $("authPw").focus(); } catch (e) {} }
          return;
        }
        var cl = el.closest ? el.closest("[data-claim]") : null;
        if (cl) { enterLocal(cl.getAttribute("data-claim") || ""); return; }
        if (el.closest && el.closest("#authSkip")) {
          enterLocal(el.getAttribute("data-skip") || "");
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
      daily = blankDaily();
      state.index = 0; state.page = 0;
      delRec(userKey(STORE_KEY));            // 直接从数据库删除该账号的进度记录
      delRec(userKey(DAILY_KEY));            // 每日一题的答题记录一并清掉
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
    $("bsBtn").onclick = function () { openSprint("bs"); };
    $("pairBtn").onclick = function () { openSprint("pair"); };
    $("annivBtn").onclick = function () { openSprint("anniv"); };
    if ($("dailyBtn")) $("dailyBtn").onclick = openDaily;
    $("analysisBtn").onclick = function () { renderAnalysis(wrongCount() ? "weak" : "now"); };
    viewBind();
    /* 动效绑定：刻度条滚动时做中心聚焦；窗口尺寸变化时重排指示条 */
    pstripTrack().addEventListener("scroll", focusPsegSoon, { passive: true });
    window.addEventListener("resize", function () {
      focusPsegSoon();
      if (!$("viewAnalysis") || $("viewAnalysis").hidden) return;
      tabInk.x = null;
      moveTabInk();
    });
    window.addEventListener("orientationchange", focusPsegSoon);
    bindDrawerDrag();

    // 图片加载失败兜底：隐藏破图、保留说明文字，避免页面出现异常图标
    document.addEventListener("error", function (e) {
      var el = e.target;
      if (el && el.tagName === "IMG") el.classList.add("img-broken");
    }, true);

    document.addEventListener("click", function (e) {
      var t = e.target;
      var el = t.closest ? t : null;
      function up(sel) { return t.closest ? t.closest(sel) : null; }

      var gh = up("[data-gohome]");
      if (gh) { goHome(); return; }
      var dly = up("[data-daily]");
      if (dly) { openDaily(); return; }
      var dopt = up("[data-dopt]");
      if (dopt) { dailyPick(parseInt(dopt.getAttribute("data-dopt"), 10)); return; }
      var dsub = up("[data-dsubmit]");
      if (dsub) { dailySubmit(); return; }
      var dessa = up("[data-dessay]");
      if (dessa) {
        var dy = String(dessa.getAttribute("data-dessay")).split("|");
        openEssayAt(parseInt(dy[0], 10), parseInt(dy[1], 10));
        return;
      }
      var dall = up("[data-dailyall]");
      if (dall) { renderEssay(); return; }
      var hm = up("[data-home]");
      if (hm) { openSprint(hm.getAttribute("data-home")); return; }
      var ph = up("[data-pairhide]");
      if (ph) {
        pairHide = !pairHide;
        localStorage.setItem("zzx.pairhide", pairHide ? "1" : "0");
        renderPair($("pairInput") ? $("pairInput").value : "");
        return;
      }
      var fg = up("[data-full]");
      if (fg) {
        state.full = fg.getAttribute("data-full") === "1";
        localStorage.setItem("zzx.full", state.full ? "1" : "0");
        state.index = 0; state.page = 0;
        renderStudy(); renderSidebar();
        toast(state.full ? "已切到全量（含已下线细节与文献）" : "已回到冲刺主线");
        return;
      }
      var bsp = up("[data-bspart]");
      if (bsp) { var s1 = bsState(); s1.part = parseInt(bsp.getAttribute("data-bspart"), 10) || 0; bsSave(s1); renderBs(); return; }
      var bsf = up("[data-bsfilter]");
      if (bsf) { var s2 = bsState(); s2.filter = bsf.getAttribute("data-bsfilter"); bsSave(s2); renderBs(); return; }
      var bsh = up("[data-bshide]");
      if (bsh) { var s3 = bsState(); s3.hide = !s3.hide; bsSave(s3); renderBs(); return; }
      /* 逐句揭示优先：点到某一段就只露那一段（比整块揭开更接近主动回忆）；
         点到正文空白处再整块揭开兜底 */
      var bsr = up("[data-bsrev]");
      if (bsr) {
        var wrap4 = bsr.closest(".bs-body");
        if (wrap4 && wrap4.classList.contains("bs-hidden")) { bsr.classList.toggle("is-reveal"); return; }
      }
      var bb = up(".bs-body");
      if (bb && bb.classList.contains("bs-hidden")) { bb.classList.remove("bs-hidden"); return; }
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
        if (gi >= 0) {
          state.index = gi; state.page = 0; navSmooth = false; renderStudy();
          var cur = pstripTrack().querySelector(".pseg.is-current");
          popClass(cur, "is-snap", 380);          // 点刻度：给一个吸附回弹反馈
        }
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
      if (wd) { removeWrongAnimated(wd.getAttribute("data-wdel")); return; }
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
        openViewer(img.getAttribute("data-full"), img.getAttribute("data-cap") || "", img);
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
    if (state.user) { state.user = null; progress = {}; wrong = blankWrong(); daily = blankDaily(); }
    syncUserUI();
    var a = readAccounts();
    var names = Object.keys(a.users);
    var isReg = authTab === "reg", isReset = authTab === "reset";
    var orphans = localIdentities().filter(function (n) { return !!n; });   // 有数据、没账号记录的身份
    var hasLegacy = !names.length && (localStorage.getItem("zzx.progress.v1") || localStorage.getItem("zzx.wrong.v1"));
    /* 任何情况下都留一条出口：没数据也能先进去，别让人卡在门口 */
    var canSkip = !names.length && !isReg && !isReset;
    var skipName = orphans[0] || "";
    var skipHasData = localIdentities().length > 0 || !!hasLegacy;
    var twoPw = isReg || isReset;
    var h = '<div class="auth-wrap"><div class="auth-card">' +
      '<div class="hero" style="padding:0 0 14px;border-bottom:0;margin:0">' +
      '<h1 style="font-size:21px">' + (isReg ? "注册新账号" : (isReset ? "重置密码" : "登录")) + "<em>·</em>政治线</h1>" +
      "<p>" + (isReg
        ? "设置用户名与密码，之后的学习进度就记在这个账号名下。"
        : (isReset
          ? "账号还在，只是密码忘了：输入用户名和新密码即可，学习进度、错题库都不受影响。"
          : "输入用户名与密码，进入你自己的学习进度（背诵位置、已学考点、错题库）。")) +
      "</p></div>" +
      '<div class="auth-field"><label>用户名</label><input id="authName" type="text" autocomplete="username" autocapitalize="off" placeholder="例如：kaoyan" value="' + esc(lastName()) + '"></div>' +
      '<div class="auth-field"><label>' + (isReset ? "新密码" : "密码") + '</label><input id="authPw" type="password" autocomplete="' + (twoPw ? "new-password" : "current-password") + '" placeholder="' + (twoPw ? "至少 4 位" : "请输入密码") + '"></div>' +
      (twoPw ? '<div class="auth-field"><label>确认密码</label><input id="authPw2" type="password" autocomplete="new-password" placeholder="再输一次"></div>' : "") +
      (!isReg && orphans.length ? '<div class="auth-claim"><b>本机还有这些学习进度</b>' +
        orphans.map(function (n) {
          return '<button type="button" class="auth-claim-btn" data-claim="' + esc(n) + '">' +
            "「" + esc(n) + "」· 背诵位置与错题都在 → 直接进入</button>";
        }).join("") + "</div>" : "") +
      (!isReg && names.length ? '<div class="auth-users"><span>本机账号</span>' +
        names.map(function (n) {
          return '<button type="button" class="auth-user" data-authuser="' + esc(n) + '">' + esc(n) + "</button>";
        }).join("") + "</div>" : "") +
      '<label class="auth-check"><input id="authRemember" type="checkbox" checked> 记住登录状态（下次打开免输密码）</label>' +
      '<div class="auth-actions"><button type="button" class="auth-btn primary" id="authGo">' + (isReg ? "注册" : (isReset ? "重置密码" : "登录")) + "</button></div>" +
      '<div class="auth-msg" id="authMsg">' + esc(msg || "") + "</div>" +
      '<div class="auth-switch">' + (isReg
        ? '<span>已经有账号了？</span><button type="button" class="auth-link" data-auth="login">返回登录</button>'
        : (isReset
          ? '<span>想起来了？</span><button type="button" class="auth-link" data-auth="login">返回登录</button>'
          : '<span>还没有账号？</span><button type="button" class="auth-link" data-auth="reg">注册新账号</button>' +
            (names.length ? '<button type="button" class="auth-link" data-auth="reset">忘了密码</button>' : ""))) +
      "</div>" +
      (canSkip ? '<div class="auth-extra"><button type="button" class="auth-btn" id="authSkip" data-skip="' +
        esc(skipName) + '">' + (skipHasData ? "不登录，直接用本机进度进入" : "先不登录，直接进入（进度为空）") +
        "</button></div>" : "") +
      '<p class="auth-note">账号只是给本机进度上的一把锁，不需要服务器、不上传任何数据。' +
        (orphans.length ? "" : "没登录也能直接用，之后在侧边栏「切换账号」里随时设置密码。") +
        "换设备时可用「导出学习数据 / 导入学习数据」迁移。</p>" +
      "</div></div>";
    $("viewAuth").innerHTML = h;
    show("viewAuth");
    $("topTitle").textContent = isReg ? "注册新账号" : (isReset ? "重置密码" : "登录");
    $("topSub").textContent = isReg
      ? "设置用户名与密码即可"
      : (isReset ? "账号保留，只换密码"
        : (names.length ? "已有 " + names.length + " 个账号，输入密码进入" : "第一次使用？点下方「注册新账号」"));
    var el = $("authName");
    if (el && !lastName()) { try { el.focus(); } catch (e) {} }
  }
  function authSubmit() {
    var name = ($("authName") || {}).value || "";
    var pw = ($("authPw") || {}).value || "";
    var msg = $("authMsg");
    var remember = !$("authRemember") || $("authRemember").checked;
    function say(m) { if (msg) msg.textContent = m || ""; }
    if (authTab === "reset") {
      var npw2 = ($("authPw2") || {}).value || "";
      if (!String(name).trim()) return say("请输入要重置的用户名");
      if (pw.length < 4) return say("新密码至少 4 位");
      if (pw !== npw2) return say("两次输入的新密码不一致");
      say("正在重置…");
      resetPassword(name, pw).then(function (u) {
        authTab = "login";
        rememberName(u);
        renderAuth("「" + u + "」的密码已重置，直接用新密码登录即可（学习进度没动）");
      }).catch(function (e) { say((e && e.message) || "重置失败"); });
      return;
    }
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
        var have = Object.keys(readAccounts().users);
        /* 本机一个账号都没有：不再让人「先去注册」（那正是「一直登不上」的死结）。
           本地账号只是本机的一把锁，没有服务端要校验，直接用它输的名字与密码建号即可。 */
        if (!have.length && !/密码不正确/.test(m)) {
          say("正在本机建立账号…");
          registerAccount(name, pw).then(function (u) {
            rememberName(u);
            setSession(u, remember);
            toast("已在本机建好账号「" + u + "」，以后用这个用户名和密码打开即可");
            signIn(u);
          }).catch(function (e2) {
            say((e2 && e2.message) || "账号创建失败");
          });
          return;
        }
        if (/^NONE:/.test(m)) {
          var wantName = m.slice(5).trim();
          m = "本机没有「" + wantName + "」的数据（可能是换过设备或清过浏览器数据）。" +
            (have.length ? "本机现有账号：" + have.join("、") + "。" : "") +
            "可以点「注册新账号」用这个名字重新开始，或用「导出学习数据」把旧进度导入回来。";
        } else if (/密码不正确/.test(m)) {
          m = "密码不正确。想不起来可以用下方「忘了密码」在本机重置（账号与进度都在，不用重新注册）。";
        } else if (/不存在/.test(m)) {
          m = "本机没有「" + String(name).trim() + "」这个账号。已有账号：" + have.join("、") +
            "（点上面的账号名自动填入）。想换个名字，用下方「注册新账号」创建一次即可。";
        }
        say(m);
      });
    }
  }
  function syncUserUI() {
    var el = $("userName");
    if (el) el.textContent = state.user || (document.body.classList.contains("auth-mode") ? "未登录" : "本机用户");
  }
  /* 用本机已有数据进入：补一条账号记录（无密码），并记住这个身份，
     下次打开不再被登录页拦住。密码可之后在「切换账号」里补。 */
  function enterLocal(name) {
    name = String(name || "").trim();
    if (name) ensureAccount(name);
    rememberName(name);
    setSession(name, true);
    toast(name ? "已用「" + name + "」的进度进入" : "已用本机进度进入");
    signIn(name);
  }

  /* 登录成功（或选择本机身份）后进入主流程 */
  function signIn(name) {
    state.user = name || null;
    progress = loadProgress();
    wrong = loadWrong();
    daily = loadDaily();
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
      /* 纯背诵模式：题库（自测 543 + 真题 462，约 272KB）不再预加载 */
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
      if (sess !== null) {                   // 记住登录：账号记录缺失也直接进
        if (sess) ensureAccount(sess);
        signIn(sess); return;
      }
      /* 本机只有一份进度、却没有账号记录（存储被清 / 换过地址 / 旧版迁移失败）：
         不拦人，直接进这份进度，并补上身份记录 */
      var ids = localIdentities();
      if (ids.length === 1) {
        var only = ids[0];
        if (only) ensureAccount(only);
        rememberName(only);
        setSession(only, true);
        signIn(only);
        toastOnce("检测到本机学习进度，已自动接着用" + (only ? "（" + only + "）" : ""));
        return;
      }
      renderAuth("");
    }).catch(function () {
      renderAuth("");
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
