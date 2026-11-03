#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把「帽子题」考点接进政治线背诵中心。

数据源：/Users/he/CodeBuddy/20261009204802/data/beisong.json + maozi.json
产出：js/data/bs-hat.js（window.ZZX_BS_HAT）

做法：对每条背诵条目（key 与 build_beisong.py 的 seq 同序），在正文/线索/方法论里
定位同板块帽子题的 pred（归一化后子串匹配，NFKC + 去标点空白），映射回原文区间得到
可直接替换的原文片段 t。前端拿到 t 就把这句「帽子」标成深红，点开能看到
「主体 是 帽子」的完整搭配——背诵时一眼看出哪句是选择题的坑。

用法：python3 tools/build_bs_hat.py
"""
import json
import os
import re
import unicodedata

SRC = "/Users/he/CodeBuddy/20261009204802/data"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "js/data/bs-hat.js")

PUNCT = set("，。、；：！？“”‘’（）()《》【】〈〉·—…－-~～ 　\t\r\n\"'「」『』,.;:!?()[]<>/-_=+*#@%&")

# 太短的 pred 容易误标；4~5 字的还要主体也在同一段里才收
MIN_LEN = 4
MIN_LEN_STRICT = 6


def load(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return json.load(f)


def norm_map(s):
    """归一化文本 + 每个字符回到原文的下标。"""
    chars, idx = [], []
    for i, ch in enumerate(s):
        for c in unicodedata.normalize("NFKC", ch):
            if c in PUNCT or c.isspace():
                continue
            chars.append(c)
            idx.append(i)
    return "".join(chars), idx


def norm(s):
    return norm_map(s)[0]


def locate(text, target):
    """在原文里找出归一化后等于 target 的片段，返回原文子串（找不到返回 None）。"""
    ntext, idx = norm_map(text)
    pos = ntext.find(target)
    if pos < 0:
        return None
    a, b = idx[pos], idx[pos + len(target) - 1] + 1
    frag = text[a:b]
    if norm(frag) != target:
        return None
    return frag


def main():
    raw = load("beisong.json")
    mao = load("maozi.json")

    # 按板块分组；pred 归一化，主表也带上归一化主体用于置信判断
    by_part = {}
    for m in mao.get("items", []):
        pred = norm(m.get("pred", ""))
        if len(pred) < MIN_LEN:
            continue
        by_part.setdefault(m.get("part", ""), []).append({
            "id": m["id"],
            "s": m.get("subject", ""),
            "p": m.get("pred", ""),
            "h": m.get("hat", ""),
            "c": m.get("cat", ""),
            "n": m.get("note", ""),
            "_np": pred,
            "_ns": norm(m.get("subject", "")),
        })

    by_key = {}
    stat = {"items": 0, "hit_items": 0, "links": 0}
    seq = 0
    for p in raw["parts"]:
        part = p.get("abbr", "")
        cands = by_part.get(part, [])
        for s in p["sections"]:
            for g in s["groups"]:
                for it in g["items"]:
                    seq += 1
                    stat["items"] += 1
                    pieces = [it.get("clue", "")] + list(it.get("body", [])) + \
                             [it.get("method", ""), it.get("note", "")]
                    text = "\n".join(x for x in pieces if x)
                    ntext = norm(text)
                    if not ntext:
                        continue
                    links, seen = [], set()
                    for c in cands:
                        if c["id"] in seen:
                            continue
                        strong = len(c["_np"]) >= MIN_LEN_STRICT
                        if not strong and (not c["_ns"] or c["_ns"] not in ntext):
                            continue
                        frag = locate(text, c["_np"])
                        if not frag:
                            continue
                        seen.add(c["id"])
                        links.append({
                            "id": c["id"], "t": frag, "s": c["s"], "p": c["p"],
                            "h": c["h"], "c": c["c"],
                            **({"n": c["n"]} if c.get("n") else {}),
                        })
                    if links:
                        links.sort(key=lambda x: -len(x["t"]))
                        by_key[str(seq)] = links
                        stat["hit_items"] += 1
                        stat["links"] += len(links)

    data = {
        "meta": {
            "title": "帽子题考点（接进背诵清单）",
            "source": "考研政治 · 帽子题专题 189 条",
            "note": "同一版块内做归一化子串匹配：背诵正文里出现的「帽子」原文片段 t 标深红，点开看「主体 是 帽子」。",
            "counts": stat,
        },
        "byKey": by_key,
    }
    js = ("/* 背诵中心·帽子题考点红标数据\n"
          "   由 tools/build_bs_hat.py 生成，勿手改。key 与 beisong.js 的 seq 同序。 */\n"
          "window.ZZX_BS_HAT = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)
    print("wrote", OUT, len(js), "bytes")
    print("items", stat["items"], "hit", stat["hit_items"], "links", stat["links"])


if __name__ == "__main__":
    main()
