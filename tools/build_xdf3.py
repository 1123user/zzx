#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 27 届三件套（关键词 / 核心背诵包 / 时政线）转成政治线 PWA 的数据。

来源：/Users/he/CodeBuddy/20261009204802/data/xdf_{kw,sz,bs}.js
      （那边由 tools/build_xdf2027.py 从三份中心自研 PDF 解析，去水印版在 assets/pdf/）
输出：js/data/kw.js / bsx.js / xcline.js
用法：python3 tools/build_xdf3.py
"""
import json
import os

SRC = "/Users/he/CodeBuddy/20261009204802/data"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "js", "data")


def load(f):
    t = open(os.path.join(SRC, f), encoding="utf-8").read()
    i = t.index("data:") + 5
    return json.JSONDecoder().raw_decode(t[i:].lstrip())[0]


def dump(name, var, payload, note):
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    head = "/* 自动生成：tools/build_xdf3.py · %s · 勿手改 */\n" % note
    open(os.path.join(OUT, name), "w", encoding="utf-8").write(head + "window.%s=%s;\n" % (var, body))
    print("[写出] js/data/%s  %.1fKB" % (name, (len(body) + len(head)) / 1024))


def main():
    kw = load("xdf_kw.js")
    n_kw = sum(len(c.get("items", [])) for b in kw for c in b["chapters"])
    dump("kw.js", "ZZX_KW", {
        "meta": {"title": "关键词汇总", "src": "27 届考研政治关键词汇总（中心自研）",
                 "total": n_kw, "boards": [b["bk"] for b in kw]},
        "boards": kw,
    }, "关键词 %d 条" % n_kw)

    sz = load("xdf_sz.js")
    dump("xcline.js", "ZZX_XCLINE", {
        "meta": {"title": "时政线", "src": "③27 届时政讲义（中心自研）",
                 "news": len(sz["news"]), "tips": len(sz["tips"].get("single", [])) + len(sz["tips"].get("multi", [])),
                 "principles": len(sz["principles"]), "templates": len(sz["templates"])},
        "basics": sz["basics"], "terms": sz["terms"], "situation": sz["situation"],
        "tips": sz["tips"], "templates": sz["templates"], "principles": sz["principles"],
        "news": sz["news"],
    }, "时政 %d 条" % len(sz["news"]))

    bs = load("xdf_bs.js")
    n_obj = sum(len(b["items"]) for b in bs["obj"])
    n_q = sum(len(t["items"]) for b in bs["subj"] for t in b["topics"])
    dump("bsx.js", "ZZX_BSX", {
        "meta": {"title": "核心背诵包", "src": "2027 考研政治核心背诵包（中心自研）",
                 "obj": n_obj, "topics": sum(len(b["topics"]) for b in bs["subj"]), "asks": n_q},
        "obj": bs["obj"], "subj": bs["subj"],
    }, "背诵包 客观 %d / 主观 %d 问" % (n_obj, n_q))


if __name__ == "__main__":
    main()
