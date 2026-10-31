#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「27 届背诵清单中心自研（终版）」搬进政治线 PWA。
数据源：/Users/he/CodeBuddy/20261009204802/data/beisong.json + beisong_hot.json
产出：js/data/beisong.js（window.ZZX_BS）
用法：python3 tools/build_beisong.py
"""
import json
import os
import re

SRC = "/Users/he/CodeBuddy/20261009204802/data"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "js/data/beisong.js")


def load(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return json.load(f)


def main():
    raw = load("beisong.json")
    hot = load("beisong_hot.json")
    lv = {}
    why = {}
    for it in hot.get("items", []):
        lv[it["title"]] = it.get("lv", 1)
        why[it["title"]] = it.get("why", "")

    total = 0
    parts = []
    seq = 0
    for p in raw["parts"]:
        sections = []
        for s in p["sections"]:
            groups = []
            for g in s["groups"]:
                items = []
                for it in g["items"]:
                    total += 1
                    seq += 1
                    items.append({
                        "key": seq,          # 全局唯一，进度用；no 只在原清单里作显示序号
                        "no": it["no"],
                        "title": it["title"],
                        "clue": it.get("clue", ""),
                        "body": [x for x in it.get("body", []) if x.strip()],
                        "method": it.get("method", "").strip(),
                        "note": it.get("note", "").strip(),
                        "lv": lv.get(it["title"], 1),
                        "why": why.get(it["title"], ""),
                    })
                groups.append({"name": g["name"], "items": items})
            sections.append({"name": s["name"], "groups": groups})
        parts.append({"no": p["no"], "abbr": p["abbr"], "name": p["name"],
                      "sub": p.get("sub", ""), "sections": sections})

    data = {
        "source": raw.get("source", ""),
        "stats": {"items": total},
        "parts": parts,
    }
    js = ("/* 背诵中心数据：27 届背诵清单 · 中心自研（终版）\n"
          "   由 tools/build_beisong.py 生成，勿手改。lv=2 必背 / 1 重点。 */\n"
          "window.ZZX_BS = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)
    print("wrote", OUT, len(js), "bytes;", total, "items")


if __name__ == "__main__":
    main()
