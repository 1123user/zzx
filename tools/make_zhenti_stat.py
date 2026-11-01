#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 462 道历年真题里统计单元级命中，产出 js/data/zhenti-stat.js。

目的：把"考点"和"真题"真正接上，而不是只在首页放一个笼统的题量数字。
产出字段：
  n       该单元真题总数
  recent  近五年（含最近一次考试年份）题数——判断"还考不考"的关键
  last    最近一次考到的年份
  years   逐年题数

用法：python3 tools/make_zhenti_stat.py
"""
import collections
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "js", "data", "quiz-zhenti.js")
OUT = os.path.join(ROOT, "js", "data", "zhenti-stat.js")


def main():
    s = open(SRC, encoding="utf-8", errors="ignore").read()
    pairs = re.findall(r'\{y:(\d+),n:\d+,u:"([^"]+)"', s)
    if not pairs:
        raise SystemExit("没匹配到真题条目，检查 quiz-zhenti.js 的结构")
    agg = collections.defaultdict(lambda: {"n": 0, "y": collections.Counter()})
    for y, u in pairs:
        agg[u]["n"] += 1
        agg[u]["y"][int(y)] += 1
    out = {}
    for u, v in agg.items():
        ys = v["y"]
        last = max(ys)
        recent = sum(c for y, c in ys.items() if y >= last - 4)
        out[u] = {"n": v["n"], "recent": recent, "last": last,
                  "years": dict(sorted(ys.items()))}
    body = ("/* 单元真题统计（tools/make_zhenti_stat.py 生成）：\n"
            "   n 总数 / recent 近五年 / last 最近年份 / years 逐年 */\n"
            "window.ZZX_ZT=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
    with open(OUT, "w", encoding="utf-8") as fp:
        fp.write(body)
    print("单元 %d 个，真题 %d 道，文件 %.1f KB" % (len(out), len(pairs), len(body.encode()) / 1024))


if __name__ == "__main__":
    main()
