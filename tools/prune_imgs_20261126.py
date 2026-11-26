#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""政治线配图瘦身：只留重点考点的图。

保留口径（用户 2026-11-26）：史纲主线 + 毛中特 / 马原 / 思法 / 形策 全部有图条目；
删除：① 数据里根本没引用的历史残留；② 史纲下线细节（tier.sg.cut）；③ 文献专项（sg6/sg7）。
用法：python3 tools/prune_imgs_20261126.py [--apply]
依赖：/tmp/zzx_dump3.json（jsc 导出：sg/sgdoc/mao/my/sf/xc/tier）
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUMP = "/tmp/zzx_dump3.json"
DATA_FILES = ["sg.js", "sgdoc.js", "mao.js", "my.js", "sf.js", "xc.js"]


def main():
    apply = "--apply" in sys.argv
    d = json.load(open(DUMP, encoding="utf-8"))
    tier = d["tier"]
    cut = set((tier.get("sg") or {}).get("cut") or [])

    meta = {}
    for k in ["sg", "mao", "my", "sf", "xc"]:
        for it in (d[k].get("items") or []) + (d[k].get("_more") or []):
            meta[it["id"]] = (k, it.get("unit"))

    def imgs_of(it):
        out = []
        if it.get("img"):
            out.append(it["img"])
        for pg in it.get("pages") or []:
            for b in pg.get("blocks") or []:
                v = b.get("v")
                if isinstance(v, str) and v.startswith("img/pol/"):
                    out.append(v)
        return out

    refs = {}
    for k in ["sg", "mao", "my", "sf", "xc"]:
        for it in (d[k].get("items") or []) + (d[k].get("_more") or []):
            for u in imgs_of(it):
                refs.setdefault(u, set()).add(it["id"])

    keep, drop_cut, drop_doc = set(), set(), set()
    for u, ids in refs.items():
        if any((meta.get(i) or ("", ""))[0] == "sg" and (meta.get(i) or ("", ""))[1] in ("sg6", "sg7") for i in ids):
            drop_doc.add(u)
        elif any(i in cut for i in ids):
            drop_cut.add(u)
        else:
            keep.add(u)

    disk = set("img/pol/" + os.path.basename(p) for p in glob.glob(os.path.join(ROOT, "img/pol/*.webp")))
    drop_unused = disk - set(refs)
    drop = (drop_cut | drop_doc | drop_unused) & disk

    size_all = sum(os.path.getsize(os.path.join(ROOT, u)) for u in disk if os.path.exists(os.path.join(ROOT, u)))
    size_keep = sum(os.path.getsize(os.path.join(ROOT, u)) for u in keep if os.path.exists(os.path.join(ROOT, u)))
    print("磁盘 %d 张 %.1fM · 保留 %d 张 %.1fM · 删除 %d 张（未引用 %d / 下线 %d / 文献 %d）"
          % (len(disk), size_all / 1048576, len(keep), size_keep / 1048576,
             len(drop), len(drop_unused), len(drop_cut), len(drop_doc)))

    if not apply:
        print("（dry，加 --apply 执行）")
        return

    # 1) 删图（原图 + 缩略）
    n = 0
    for u in drop:
        for p in (os.path.join(ROOT, u), os.path.join(ROOT, "img/pol/t", os.path.basename(u))):
            if os.path.exists(p):
                os.remove(p)
                n += 1
    print("删除文件", n)

    # 2) 数据里被删图的引用清空（img:"" 后渲染层就不再画 figure）
    removed_refs = 0
    for f in DATA_FILES:
        p = os.path.join(ROOT, "js/data", f)
        s = open(p, encoding="utf-8").read()
        for u in drop:
            pat = 'img:"%s"' % u
            if pat in s:
                s = s.replace(pat, 'img:""')
                removed_refs += 1
        open(p, "w", encoding="utf-8").write(s)
    print("清空引用", removed_refs)

    # 3) imgsize.js 只留保留图
    p = os.path.join(ROOT, "js/data/imgsize.js")
    s = open(p, encoding="utf-8").read()
    i = s.index("=") + 1
    sizes = json.JSONDecoder().raw_decode(s[i:].lstrip().rstrip(";"))[0]
    new = {k: v for k, v in sizes.items() if k in keep}
    head = s[: s.index("window.ZZX_IMGSIZE")]
    tail = "window.ZZX_IMGSIZE=%s;\n" % json.dumps(new, ensure_ascii=False, separators=(",", ":"))
    open(p, "w", encoding="utf-8").write(head + tail)
    print("imgsize %d → %d 条" % (len(sizes), len(new)))

    # 4) Service Worker：外壳与图片缓存都换代（旧图不再占手机空间）
    p = os.path.join(ROOT, "sw.js")
    s = open(p, encoding="utf-8").read()
    s = re.sub(r"zzx-shell-v\d+", "zzx-shell-v46", s)
    s = re.sub(r"zzx-runtime-v\d+", "zzx-runtime-v16", s)
    open(p, "w", encoding="utf-8").write(s)
    print("sw 缓存 → v46 / runtime v16")


if __name__ == "__main__":
    main()
