#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 27 届三件套接进政治线 PWA：视图 / 侧栏 / 首页 / 样式 / SW 版本。"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "js", "app.js")
HTML = os.path.join(ROOT, "index.html")
CSS = os.path.join(ROOT, "css", "app.css")
SW = os.path.join(ROOT, "sw.js")
SNIP = os.path.join(ROOT, "tools", "xdf3_snippet.js")

HTML_SIDE = '''    <button class="side-action" id="kwBtn" type="button">
      <span>关键词汇总</span><i>27 届 · 444 条</i>
    </button>
    <button class="side-action" id="bsxBtn" type="button">
      <span>核心背诵包</span><i>271 客观 + 33 主观</i>
    </button>
    <button class="side-action" id="xclnBtn" type="button">
      <span>时政线</span><i>1—11 月 · 58 条</i>
    </button>
'''

HTML_VIEWS = '''    <section class="view" id="viewKw" hidden></section>
    <section class="view" id="viewBsx" hidden></section>
    <section class="view" id="viewXcline" hidden></section>
'''

HOME_CARDS = '''    /* 27 届三件套（2026-11-25）：与背诵中心并列的三份中心自研总结资料 */
    h += '<div class="sec-title">27 届三件套 · 中心自研</div><div class="cards">';
    h += '<button type="button" class="card sprint-card" data-xdf="kw" style="--cc:var(--c-my)">' +
      '<div class="card-top"><b>关键词汇总</b><span class="bdg">444 条</span></div>' +
      "<p>马原 / 毛中特 / 新思想 / 史纲 / 思法：一个考点一句话，术语盖住自测；史纲 6 张专题表照原文保留。</p>" +
      '<div class="mrow"><span>五板块 44 章</span><span>可遮挡自测</span></div></button>';
    h += '<button type="button" class="card sprint-card" data-xdf="bsx" style="--cc:var(--c-sg)">' +
      '<div class="card-top"><b>核心背诵包</b><span class="bdg">271 + 33</span></div>' +
      "<p>客观题 271 条「标志 / 首要 / 本质」，主观题 33 个热点 57 问，每问自带思路与要点。</p>" +
      '<div class="mrow"><span>客观 / 主观双段</span><span>考前收口</span></div></button>';
    h += '<button type="button" class="card sprint-card" data-xdf="xcln" style="--cc:var(--c-xc)">' +
      '<div class="card-top"><b>时政线</b><span class="bdg">58 条</span></div>' +
      "<p>客观题基础 + 命题特点 20 例 + 分析题模板与 5 个常理 + 1—11 月时政 58 条（带原文与例题）。</p>" +
      '<div class="mrow"><span>每条带例题</span><span>总结不是押题</span></div></button>';
    h += "</div>";
'''

CSS_ADD = '''

/* ================= 27 届三件套（关键词 / 背诵包 / 时政线） ================= */
.xdf-q{flex:1 1 220px;min-width:0;padding:8px 11px;border:1px solid var(--line);border-radius:10px;
  background:var(--bg-elevated);color:var(--fg);font:inherit;font-size:13.5px}
.xdf-q:focus{outline:none;border-color:var(--accent)}
.xdf-cnt{font-size:12px;color:var(--fg-3);margin-left:auto;white-space:nowrap}
.xdf-board{margin:18px 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;color:var(--accent);
  padding-left:9px;border-left:3px solid var(--accent)}
.xdf-ch{margin:0 0 10px;border:1px solid var(--line-soft);border-radius:var(--r-sm);
  background:var(--bg-elevated);padding:0 12px}
.xdf-ch-t{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:11px 0;
  font-size:13.5px;font-weight:700}
.xdf-ch-t::-webkit-details-marker{display:none}
.xdf-ch-t>span{flex:1}
.xdf-ch-t>i{font-size:11.5px;font-weight:500;color:var(--fg-3);font-style:normal}
.xdf-ch-t::before{content:"▸";color:var(--fg-3);font-size:11px;transition:transform .18s}
.xdf-ch[open]>.xdf-ch-t::before{transform:rotate(90deg)}
.xdf-it{display:flex;gap:9px;align-items:flex-start;padding:9px 0;border-top:1px dashed var(--line-soft);
  font-size:13.5px;line-height:1.72}
.xdf-ch .xdf-it:first-of-type{border-top:none}
.xdf-no{flex:none;min-width:20px;font-size:11.5px;font-weight:700;color:var(--fg-3);padding-top:2px;text-align:right}
.xdf-body{flex:1;min-width:0}
.xdf-sec{display:inline-block;font-size:11px;color:var(--fg-3);background:var(--bg-sunken);
  border-radius:5px;padding:1px 6px;margin-right:6px}
.xdf-k{color:var(--accent);font-weight:700}
.xdf-k.is-mask{background:var(--fg-2);color:transparent;border-radius:4px;cursor:pointer;user-select:none}
.xdf-t{color:var(--fg)}
.xdf-ok{flex:none;width:26px;height:26px;border-radius:50%;border:1px solid var(--line);background:transparent;
  color:var(--fg-3);font-size:13px;cursor:pointer;margin-top:1px}
.xdf-it.is-done .xdf-ok{background:var(--success-soft);border-color:var(--success-line);color:var(--success)}
.xdf-tw{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:8px 0 12px;
  border:1px solid var(--line-soft);border-radius:8px}
.xdf-tw table{border-collapse:collapse;min-width:520px;font-size:12.5px}
.xdf-tw th,.xdf-tw td{border-bottom:1px solid var(--line-soft);padding:7px 9px;text-align:left;
  vertical-align:top;line-height:1.6}
.xdf-tw th{background:var(--bg-sunken);font-weight:700;white-space:nowrap}
.xdf-tb-t{font-size:12px;font-weight:700;color:var(--fg-2);margin:10px 0 0}
.xdf-topic{padding:0 0 12px}
.xdf-lead{color:var(--fg-2);font-size:13px;margin:8px 0}
.xdf-ask{margin:10px 0 6px;font-size:13.5px;line-height:1.7}
.xdf-ask>b{display:inline-block;font-size:11px;color:var(--on-flag);background:var(--flag);
  border-radius:5px;padding:1px 6px;margin-right:6px}
.xdf-ask>i{font-style:normal;font-size:11px;color:var(--fg-3);margin-right:6px}
.xdf-idea{font-size:12.5px;color:var(--accent);background:var(--accent-soft);border-radius:7px;
  padding:6px 9px;margin:6px 0;line-height:1.65}
.xdf-clue{font-size:12.5px;color:var(--amber);background:var(--amber-soft);border-radius:7px;
  padding:6px 9px;margin:6px 0;line-height:1.65}
.xdf-pts{font-size:13px;line-height:1.78;color:var(--fg);margin:6px 0}
.xdf-fold{margin:0 0 10px;border:1px solid var(--line);border-radius:var(--r-sm);
  background:var(--bg-elevated);padding:0 12px}
.xdf-fold>summary{cursor:pointer;list-style:none;padding:11px 0;font-size:13.5px;font-weight:700}
.xdf-fold>summary::-webkit-details-marker{display:none}
.xdf-fold>summary::before{content:"▸ ";color:var(--fg-3);font-size:11px}
.xdf-fold[open]>summary::before{content:"▾ "}
.xdf-fold-b{padding:0 0 12px;border-top:1px dashed var(--line-soft)}
.xdf-sub{font-size:12.5px;font-weight:700;color:var(--fg-2);margin:12px 0 4px}
.xdf-tip{border-top:1px dashed var(--line-soft);padding:10px 0}
.xdf-tip-y{font-size:11.5px;color:var(--fg-3);margin-bottom:5px}
.xdf-ex{margin-top:8px;background:var(--bg-sunken);border-radius:8px;padding:9px 11px}
.xdf-ex-q{font-size:13px;line-height:1.7}
.xdf-ex-o{font-size:12.5px;color:var(--fg-2);line-height:1.7}
.xdf-ex-o>i{display:inline-block;width:16px;font-style:normal;font-weight:700;color:var(--fg-3)}
.xdf-ex-a{font-size:12.5px;color:var(--success);margin-top:5px;font-weight:600}
.xdf-news{border-bottom:1px solid var(--line-soft);padding:0 2px}
.xdf-news>summary{cursor:pointer;list-style:none;padding:10px 0;display:flex;gap:8px;
  align-items:baseline;font-size:13.5px;line-height:1.6}
.xdf-news>summary::-webkit-details-marker{display:none}
.xdf-date{flex:none;font-size:11.5px;color:var(--fg-3);min-width:58px}
.xdf-news b{font-weight:600;flex:1;min-width:0}
.xdf-hasex{flex:none;font-style:normal;font-size:10.5px;color:var(--flag);border:1px solid var(--flag);
  border-radius:4px;padding:0 4px}
.xdf-nb{padding:0 0 12px}
.xdf-nb p{font-size:13px;line-height:1.78;color:var(--fg-2);margin:0 0 8px}
'''


def rep(path, old, new, cnt=1):
    s = open(path, encoding="utf-8").read()
    assert s.count(old) == cnt, "%s: 期望 %d 处，实际 %d 处（%s）" % (os.path.basename(path), cnt, s.count(old), old[:50])
    open(path, "w", encoding="utf-8").write(s.replace(old, new))


def main():
    # 1) VIEWS 注册
    rep(APP, '"viewBs", "viewDaily"];', '"viewBs", "viewDaily", "viewKw", "viewBsx", "viewXcline"];')

    # 2) 首页三件套卡片（放在 homeNextHtml 之前）
    rep(APP, "    h += homeNextHtml();", HOME_CARDS + "\n    h += homeNextHtml();")

    # 3) 主体代码插入 IIFE 尾部
    snippet = open(SNIP, encoding="utf-8").read()
    anchor = '  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);'
    rep(APP, anchor, snippet + "\n" + anchor)

    # 4) index.html：侧栏 + 三个视图 + 版本号
    rep(HTML, '    <button class="side-action" id="quizBtn" type="button" hidden>', HTML_SIDE +
        '    <button class="side-action" id="quizBtn" type="button" hidden>')
    rep(HTML, '    <section class="view" id="viewAuth" hidden></section>',
        '    <section class="view" id="viewAuth" hidden></section>\n' + HTML_VIEWS.rstrip("\n"), 1)
    rep(HTML, 'js/app.js?v=43', 'js/app.js?v=44')
    rep(HTML, 'css/app.css?v=42', 'css/app.css?v=43')

    # 5) 样式
    s = open(CSS, encoding="utf-8").read()
    if ".xdf-news" not in s:
        open(CSS, "a", encoding="utf-8").write(CSS_ADD)

    # 6) Service Worker：缓存版本 + 预缓存清单
    rep(SW, "const CACHE = 'zzx-shell-v43';", "const CACHE = 'zzx-shell-v44';")
    rep(SW, "'./js/app.js?v=43'", "'./js/app.js?v=44'")
    rep(SW, "'./css/app.css?v=42'", "'./css/app.css?v=43'")
    s = open(SW, encoding="utf-8").read()
    if "kw.js" not in s:
        s = s.replace("  './js/data/my-pair.js',",
                      "  './js/data/kw.js?v=44',\n  './js/data/bsx.js?v=44',\n  './js/data/xcline.js?v=44',\n  './js/data/my-pair.js',")
        open(SW, "w", encoding="utf-8").write(s)

    print("✓ app.js / index.html / app.css / sw.js 已更新")
    for f in ("js/app.js", "index.html", "sw.js"):
        print("  ", f, os.path.getsize(os.path.join(ROOT, f)), "字节")


if __name__ == "__main__":
    main()
