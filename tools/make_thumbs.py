#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成配图缩略图与原始尺寸表（可重复执行，幂等）。

为什么要有这一层：
  img/pol/*.webp 是 21MB、单张平均 70KB 的整页截图，正文里直接 <img> 会
  ①弱网首屏一片空白 ②没有预留高度导致图片到达时整段跳动（用户体感是"断档/发雾"）。
  这里统一产出 480px 宽、q=72 的缩略图（合计约 4.4MB，单张 14KB），
  并把原始宽高写进 js/data/imgsize.js，渲染时用 width/height 提前留出正确高度。

用法：python3 tools/make_thumbs.py
产出：img/pol/t/*.webp、js/data/imgsize.js
"""
import glob
import json
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("需要 Pillow：/Library/Frameworks/Python.framework/Versions/3.13/bin/python3 -m pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "img", "pol")
DST = os.path.join(SRC, "t")
SIZE_JS = os.path.join(ROOT, "js", "data", "imgsize.js")
MAX_W = 480
QUALITY = 72


def main():
    os.makedirs(DST, exist_ok=True)
    sizes = {}
    total = 0
    n = 0
    for f in sorted(glob.glob(os.path.join(SRC, "*.webp"))):
        name = os.path.basename(f)
        try:
            im = Image.open(f)
            w, h = im.size
            sizes["img/pol/" + name] = [w, h]
            out = os.path.join(DST, name)
            need = (not os.path.exists(out)) or os.path.getmtime(out) < os.path.getmtime(f)
            if need:
                if w > MAX_W:
                    im = im.convert("RGB").resize((MAX_W, round(h * MAX_W / w)), Image.LANCZOS)
                else:
                    im = im.convert("RGB")
                im.save(out, "WEBP", quality=QUALITY, method=6)
            total += os.path.getsize(out)
            n += 1
        except Exception as e:              # 单张坏图不影响整批
            print("跳过", name, e)
    body = ("/* 配图原始宽高（tools/make_thumbs.py 生成）：渲染时写进 img 的 width/height，\n"
            "   浏览器提前留出正确高度，消除图片到达时的布局跳动与空白断档 */\n"
            "window.ZZX_IMGSIZE=" + json.dumps(sizes, ensure_ascii=False, separators=(",", ":")) + ";\n")
    with open(SIZE_JS, "w", encoding="utf-8") as fp:
        fp.write(body)
    print("缩略图 %d 张，合计 %.1f MB；尺寸表 %.1f KB" % (n, total / 1048576, len(body.encode()) / 1024))


if __name__ == "__main__":
    main()
