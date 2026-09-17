# 像素缺失部件批 · 美术验收证据

本目录固定 7 个缺失部件经过 Nutri 实际流程生成的 64px 图层与人工验收预览。用户于 2026-09-17 回复 `ok，通过`；精确文件摘要见 `approval.json`。

## 验收图

- `back-chain-preview.png`：小翅膀、羽翼、龙翼，深浅背景。
- `front-chain-preview.png`：鹿角、光环、伞蜥颈膜、分叉尾尖，深浅背景。
- `previews/*-64.png` 与 `*-256.png`：单件实装结果；256px 文件使用最近邻放大，不是另一套素材。

## 生成链路

最终源图位于 `docs/art/pixel-parts-batch/sources/solid/`。使用 Nutri 本地参考 checkout 中的实际像素化实现生成：

```powershell
$env:RANDOMPET_DIR = (Get-Location).Path
node .worktrees/nutri-pixel-reference/scripts/.codex-pixelCat.mjs `
  --source (Resolve-Path docs/art/pixel-parts-batch/sources/solid).Path `
  --out (Resolve-Path docs/qa/pixel-parts-batch/layers).Path `
  --size 64
```

本次输出 44 个完整试验图层，其中 7 个来自本批平涂源图；`layers/manifest.json` 保留该次真实输出清单。审批只覆盖 `approval.json` 中列出的 7 个图层。

## 边界

这次批准的是美术源图和 64px 实装外观。正式包登记、2016 个完整组合的生成证据与抽样矩阵仍待后续批次；Nutri 运行时保持关闭。
