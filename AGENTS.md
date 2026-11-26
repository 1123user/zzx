# 政治线 · 考研政治五大板块（手机 PWA）

线上：https://1123user.github.io/zzx/ （GitHub Pages，仓库 `1123user/zzx`，`git push main` 即发布）
手机：主屏「政治线」PWA（standalone），Service Worker 离线可用。

## 2027 三件套（2026-11-26 接入）
三份重庆新东方考研政治组中心自研资料，**与「背诵中心 92 条」并列，不混进背诵清单**：

| 栏目 | 视图 | 数据 | 量 |
|---|---|---|---|
| 关键词汇总 | `viewKw` | `js/data/kw.js` → `ZZX_KW` | 5 板块 44 章 444 条 + 史纲/思法 23 张专题表 |
| 核心背诵包 | `viewBsx` | `js/data/bsx.js` → `ZZX_BSX` | 客观 271 条 / 主观 33 热点 57 问 |
| 时政线 | `viewXcline` | `js/data/xcline.js` → `ZZX_XCLINE` | 基础 18 条 + 模板 3 + 原理 5 + 真题例证 20 + 时政 58 条 |

- 数据由 `python3 tools/build_xdf3.py` 生成，源是
  `/Users/he/CodeBuddy/20261009204802/data/xdf_{kw,sz,bs}.js`
  （那边 `tools/build_xdf2027.py` 从三份 PDF 解析并去 KSPX 水印）。
  **不要手改 `js/data/{kw,bsx,xcline}.js`**，改源头后重跑脚本。
- 入口：侧栏三个按钮（`kwBtn/bsxBtn/xclnBtn`）+ 首页「27 届三件套」三卡 +
  每页顶部互切条（`xdfNav`）。事件走 `[data-xdf] / [data-kwb] / [data-bsxtab] / [data-xcpart]` 委托。
- 已掌握打勾存 `localStorage zzx.kw.done`，遮挡开关存 `zzx.kw.mask`；不影响背诵中心进度。

## 改完必做（否则手机看不到）
1. `index.html` 里 `js/app.js?v=NN`、`css/app.css?v=NN` 同步 +1；
2. `sw.js` 的 `CACHE = 'zzx-shell-vNN'` +1，`SHELL` 里对应 `?v=` 改成新值（新增数据文件必须加进 SHELL）；
3. `git push main`，Pages 约 1—3 分钟；手机打开 App 会弹「已就绪新版本 · 点这里刷新」，
   没弹就强制退出重开；仍不对 → 侧栏「重置离线缓存」。

## 约定
- 统计口径：「主线」与「全量」分开，侧栏/单元/全程进度按当前阅读流书写（2026-11-14 统一）。
- 纯背诵定位：随机自测 / 材料分析题 / 错题分析入口保持 hidden，不新增做题流程。
- 样式：墨绿 + 米白主题，红只留给重点/必背/错题；三件套用 `--accent` 绿 + `--amber` 线索。
