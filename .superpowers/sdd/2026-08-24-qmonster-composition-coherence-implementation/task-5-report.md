# Task 5 实施报告

## 结论

DONE。Catalog `0.2.0`、非破坏性 source/runtime 树、composition metadata、成对节点、七项 rework、候选证据、三张浏览器 contact sheet 与 production evidence 均已落地。实现提交：`1402e8dca39bbb67956bc2e57e130d81582d29b8`（`feat: produce composition-aware creature assets`）。本报告作为随后独立提交写入，避免提交 SHA 自引用。

Task 7 的整只组合 golden 验收尚未发生；本任务只批准 part-level compatible-rig contact sheets，不声明 full-composite golden 已通过。

## 位图生成、候选与选择

生成前通过 `view_image` 以原分辨率检查并标记：

- reference base：`asset-source/v0.1.0/rigs/base_biped_v1.png`，仅用于比例、3/4 视角、材质和暖棚灯光参考。
- reference/current leg：`asset-source/v0.1.0/parts/legs_mushroom.png`，仅作为现有高耸帽状/第二头误读的失败轮廓参考，不是编辑目标。

生成模式为 Codex built-in `image_gen`，use case 为 `stylized-concept`，asset type 为 `game modular paired-feet part asset`；未使用 CLI fallback 或 `n` 参数。每个候选均由一次独立调用生成。生成文件从 `$CODEX_HOME/generated_images` 复制到 workspace，记录于：

- `asset-source/v0.2.0/generation/part-candidates/legs_mushroom/generation-evidence.json`
- 第一轮四候选：`legs_mushroom-candidate-{1..4}-source.png`
- 第二轮四候选：`regeneration-2/legs_mushroom-candidate-{1..4}-source.png`

第一轮四个 1254×1254 RGBA 输出均把 checkerboard 烘焙进全不透明像素，immutable chroma gate 全部拒绝。没有降阈值，而是再次执行四次独立 built-in `image_gen` 调用。第二轮使用确定性的相连背景恢复构造精确 `#00ff00` gate 输入，再运行现有 gate：

| 候选 | 机器结果 | 关键结果 |
| --- | --- | --- |
| 1 | PASS | coverage `0.15523848`；partial alpha `2.36298%`；edge delta p95 `8.0623`；但 256×256 仍偏蒜头/球茎 |
| 2 | FAIL | `CHROMA_EDGE_DEGRADED`；edge delta p95 `13.0767` > `12` |
| 3 | PASS / SELECTED | coverage `0.20821537`；partial alpha `2.12419%`；edge delta p95 `7.0711`；nearest p95 `5`；safe border `0` |
| 4 | FAIL | `CHROMA_BACKGROUND_CONTAMINATED`、`CHROMA_SAFE_BORDER_CLIPPED`、`CHROMA_EDGE_DEGRADED` |

候选 3 在 256×256 可读为低矮承重双脚：前掌、趾瓣、鞋底厚度、狭窄踝部连接均清楚；不会读成帽子或第二头。最终 source/runtime 保存路径：

- `asset-source/v0.2.0/parts/legs_mushroom.png`
- `packages/asset-catalog/assets/v0.2.0/parts/legs_mushroom.png`
- `packages/asset-catalog/assets/v0.2.0/parts/legs_mushroom.webp`

master/runtime PNG SHA-256：`e81741103c1507c5427dd43d52f78c3f70e388fd84cd4648457a1f4ed6e513cc`；WebP SHA-256：`db9643d75c2c15dde9d7e0b54de0a6160ad55806819ab51bfecbe62f7b1e63f9`。master 为 2048×2048 真 RGBA，boundary alpha pixels 为 `0`。

四次最终再生成调用使用的保存 prompt 集为同一份规范化生产 prompt，逐字保存在 `asset-source/v0.2.0/prompts/legs_mushroom.txt`。其核心约束为：exactly two separated weight-bearing mushroom-inspired feet、clear soles、narrow ankle connectors、3/4 front、stylized tactile 3D game asset、真实透明 alpha 0 背景、无 checkerboard/身体/脸/孢子/地影，并要求在 256×256 读作脚而非帽或第二头。

## Catalog / composition 实施

- 安全、确定性 splitter 使用 `sharp.extract()`、alpha `>8` trim、相对 trim 后的 anchor、固定 PNG 与 lossless WebP；写入仅允许 `asset-source/v0.2.0` 或 `packages/asset-catalog/assets/v0.2.0`。
- bodyFrame 为唯一根；其余节点使用 Task 1 parent map 和显式 socket。arms、legs、`extra_moth_wings` 拆为左右节点。
- exactly seven rework actions 原样记录于 `asset-source/v0.2.0/generation/composition-rework.json`；eyes + mouth 为同一项 intensity audit，没有增加或删除 action。
- `head_mushroom_cap` 缩放 `0.78`，显式 face safe zone；surface/pattern/color 使用 body clip；effects 使用 protect-face；`oral_gummy_ridges` 仅挂 `mouthShape.oralDetail`。
- 最终 strong 共 10 项：mushroom cap、triple eyes、wide grin、lolling tongue、三种大型 extra、gel bubbles、两种 effect。`surface_soft_scales` 与 `oral_gummy_ridges` 均为 quiet。
- 为让每个 mandatory theme/rig 均有 quiet fallback，quiet motif metadata 覆盖三主题，并把可复用的 `surface_short_fur` 作为三 rig quiet surface fallback；未增加/删除 part、slot、theme 或 rig。
- composition node 是 trim 后的小图，因此 production file validation 新增显式 `trimmed-node` 尺寸模式；主 asset 仍严格要求 1024/2048 方图。
- asset-catalog 默认 `validate` 已切到 `validate:v0.2.0`；browser test 断言 `resolveProductionAssetUrl('0.2.0', 'parts/eyes_glossy_pair.png')` 解析到 bundled v0.2.0 URL。
- `asset-source/v0.1.0`、catalog/assets/audit v0.1.0 无 diff；0.2.0 为新树。

## 10,000-seed 分布

命令：

```text
npx vitest run scripts/build-production-catalog.test.ts -t "keeps every optional" --disableConsoleIntercept
```

输出：

```text
v0.2 optional-none distribution {
  headAppendage: 0.3628,
  tail: 0.4141,
  extraAppendage: 0.4857,
  effect: 0.3713
}
Test Files  1 passed (1)
Tests  1 passed | 10 skipped (11)
```

所有 optional none 均处于 `[0.35, 0.50]`；10,000 个 normal-mode seed 的 strong count 均 `<= 2`。

最终 none baseWeight：`head_appendage_none=1.8`、`tail_none=0.67`、`extra_appendage_none=0.08`、`effect_none=0.15`。完整逐 part classification 和权重记录于 `packages/asset-catalog/review/v0.2.0/rework-record.json`。

## Contact sheets 原分辨率审看

三张均用 `view_image(detail="original")` 审看，并在 rework record 中记录 `approved`：

| rig | 路径 | 尺寸 / 候选 | SHA-256 | 结论 |
| --- | --- | --- | --- | --- |
| blob | `packages/asset-catalog/review/v0.2.0/contact-sheet-blob.png` | 1200×3482 / 39 | `46d3cbabcaee1eb869164c5c1a88d9101d9bb4892c26a6a936a5ba1f5b9f0aba` | 39 项各一次；节点附着、脸区、body clip 与 protect-face 正常 |
| biped | `packages/asset-catalog/review/v0.2.0/contact-sheet-biped.png` | 1200×3482 / 39 | `ba19aa7cdb508d2fc63c2f5a56c4729e0fb0b3e22ed656e39df8602d19213605` | mushroom candidate 3 明确读作双脚；长臂和蛾翅双侧连接正常 |
| floating | `packages/asset-catalog/review/v0.2.0/contact-sheet-floating.png` | 1200×3482 / 37 | `12eb1120edef784b9cfc85ec9fddaa81da5285a0fac9b3685071977da6dbdf8d` | paddle/tiptoe/tail/tentacles 附着正常；quiet fur 不遮轮廓 |

## 红绿与构建证据

Splitter RED（实现前）：

```text
npx vitest run scripts/split-paired-part.test.ts
FAIL — Cannot find module './split-paired-part.js'
```

Splitter GREEN（实现后）：

```text
npx vitest run scripts/split-paired-part.test.ts
Test Files 1 passed (1)
Tests 3 passed (3)
```

Production gate 首次失败：

```text
npm run validate:v0.2.0 -w @qmonster/asset-catalog
ERROR CATALOG_FILE_MISSING ... catalog/v0.2.0/catalog.json
exit 1
```

完成初版 metadata/assets 后再次得到真实 composition/evidence/resource diagnostics，包括 `COMPOSITION_QUIET_FALLBACK_MISSING`、`PRODUCTION_REWORK_RECORD_MISSING`、`ASSET_DIMENSION_INVALID`；修复 metadata、hashed review evidence 与 trim-node file contract 后不降任何 gate threshold，最终无 warning/error。

生产 builders 按要求先后执行：

```text
npx tsx scripts/build-runtime-assets.ts --version 0.2.0
{"built":58}

npx tsx scripts/build-color-scheme-masks.ts --version 0.2.0
{"schemes":3,"masks":27}

npx tsx scripts/build-production-catalog.ts --version 0.2.0
{"parts":55,"semanticOnly":12,"modifiers":4}

npx tsx scripts/render-production-contact-sheets-browser.ts --version 0.2.0
[{"rigId":"blob","candidates":39,"width":1200,"height":3482,"outputPath":"packages/asset-catalog/review/v0.2.0/contact-sheet-blob.png","sha256":"46d3...f0aba"},{"rigId":"biped","candidates":39,"width":1200,"height":3482,"outputPath":"packages/asset-catalog/review/v0.2.0/contact-sheet-biped.png","sha256":"ba19...13605"},{"rigId":"floating","candidates":37,"width":1200,"height":3482,"outputPath":"packages/asset-catalog/review/v0.2.0/contact-sheet-floating.png","sha256":"12eb...df8d"}]
```

最终验证：

```text
npx vitest run scripts/split-paired-part.test.ts scripts/build-production-catalog.test.ts packages/asset-catalog/src/production-validation.test.ts packages/asset-catalog/src/file-validation.test.ts
Test Files 4 passed (4)
Tests 48 passed (48)

npm run validate:v0.1.0 -w @qmonster/asset-catalog
exit 0; no diagnostics

npm run validate:v0.2.0 -w @qmonster/asset-catalog
exit 0; no diagnostics

npm run validate -w @qmonster/asset-catalog
delegated to validate:v0.2.0; exit 0; no diagnostics

npx vitest run apps/creator-web/src/components/PreviewCanvas.test.tsx
Test Files 1 passed (1)
Tests 10 passed (10)

npm run typecheck
exit 0

npm test
Test Files 47 passed (47)
Tests 422 passed | 1 skipped (423)
```

## Concerns

- built-in `image_gen` 两轮都返回带烘焙 checkerboard 的全不透明 PNG，而不是直接可用的真透明输出；本任务没有伪称原始输出透明，而是完整保留原图，使用确定性背景恢复后再走 immutable extraction gate，并在 production index/source evidence 中记录 `built-in-transparent-recovery-v1`。
- 本提交包含从 v0.1 非破坏性复制而来的完整 v0.2 source tree（约 418 MiB）和 runtime tree（约 68 MiB），这是 brief 明确要求，未修改 v0.1。
- Task 7 的整只组合验收仍是后续工作；本报告不提前批准 full-composite goldens。

## Fix round 1（审查基线 `1ec7ec25`）

结论：DONE。实现提交为 `5a457fcfdff35756ed45d8e9b3ca38ef2b084806`（`fix: verify composition-aware asset reviews`）。本节作为独立报告提交追加，因此最终 HEAD 在该实现提交之后。以上初版 contact-sheet hashes 已被本轮真实 v0.2 composition 重渲结果取代；候选图、最终 legs asset、generation evidence、七项 rework、none calibration 与强弱分类均未重生或改项。

### 审查问题与红→绿

1. Production review harness：先新增测试要求完整 catalog/compositionPolicy、`rendererVersion=0.2.0` 与 mushroom legs 左右 node；RED 为缺少 `production-render-review` 模块。实现后 v0.2 保留完整 catalog，14 个 visual slot 以兼容 baseline 锁定，目标 slot 单独替换；legacy 0.1 仍走原隔离 harness。浏览器页面额外暴露 `drawnAssetIds`、`compositionMetrics` 与 `resolvedAssetPaths`。
2. 真实浏览器组合：首个 Chromium RED 为 blob face 的 `COMPOSITION_FACE_OUT_OF_ZONE` / `COMPOSITION_FACE_OCCLUDED`，证明旧 metadata 在真实挂接下不可用。扩大 head face-safe zone，并按职责校准 head/eyes/mouth/oral/head-appendage 缩放后，完整 contact builder 又依次捕获 `oral_lolling_tongue/blob` mouth visible ratio `0.821 < 0.85` 与 `head_horns_soft_nubs/blob` eyes visible ratio `0.647 < 0.85`。最终 oral scale `0.12`、head-appendage scale `0.30`，未降低任何诊断阈值；115 个 cell 全部取得非空 composition metrics，并验证每个目标 part 的所有兼容 node resolver call。
3. v0.2 source tools：静态测试 RED 同时发现 `create-guides.ts` 与 `vertical-render.ts` 含 `v0.1.0`；GREEN 后两者只读写 `asset-source/v0.2.0` 和 `packages/asset-catalog/assets/v0.2.0`。
4. Splitter canonical root：lookalike 回归 RED 证明旧实现会在仓外生成 `left/right`，junction 回归 RED 证明可穿过仓内 junction 写仓外。实现改为从脚本位置锚定 repository roots，执行 lexical containment、deepest-existing-ancestor `realpath`、创建后 `realpath` 与写前再次解析；GREEN 为 5/5，lookalike/junction 均拒绝且仓外零写入，原越界零写入与 deterministic rerun 保持通过。

### 真实 v0.2 composition contact sheets

命令：

```text
npx tsx scripts/render-production-contact-sheets-browser.ts --version 0.2.0
[{"rigId":"blob","candidates":39,"width":1200,"height":3482,"outputPath":"packages/asset-catalog/review/v0.2.0/contact-sheet-blob.png","sha256":"1bf8f8678c5da08aabdf7c2121a012a2e693be52a339c85b46dfdf098c3ca1a7"},{"rigId":"biped","candidates":39,"width":1200,"height":3482,"outputPath":"packages/asset-catalog/review/v0.2.0/contact-sheet-biped.png","sha256":"82429973ef98e026803c3466cc946cc559bd570aee7fc44573920d92f3dd5032"},{"rigId":"floating","candidates":37,"width":1200,"height":3482,"outputPath":"packages/asset-catalog/review/v0.2.0/contact-sheet-floating.png","sha256":"d1833e17d4a4f914fd566be844f76cc3f791c83b27e0bb8c0b2828e3de2af992"}]
```

三张均再次调用 `view_image(detail="original")` 审看：

| rig | SHA-256 | 审看结果 |
| --- | --- | --- |
| blob | `1bf8f8678c5da08aabdf7c2121a012a2e693be52a339c85b46dfdf098c3ca1a7` | 39/39 完整组合；pair attach、face safe zone、body clip、protect-face 均清晰且无诊断 |
| biped | `82429973ef98e026803c3466cc946cc559bd570aee7fc44573920d92f3dd5032` | 39/39；`legs_mushroom` 左右节点读作两只低矮承重脚而非帽子/第二头，长臂与蛾翅保持双侧挂接 |
| floating | `d1833e17d4a4f914fd566be844f76cc3f791c83b27e0bb8c0b2828e3de2af992` | 37/37；paddle/tiptoe/tail/tentacles 挂接正常，body-clipped surface/pattern/color 与 protect-face effects 不破坏脸部或轮廓 |

`contact-sheet-index.json` 现在逐 rig 记录 `compositionVerified: true` 和去重后的 `resolvedTargetNodePaths`；`rework-record.json`、source index、evidence manifest 已更新为上述新 hashes 与真实 composition 审看方法。exactly seven rework action 仍为七条，其中 eyes+mouth 仍是同一条 intensity audit；未提前批准 Task 7 full-composite goldens。

### Fix round 1 验证

```text
npx vitest run scripts/production-render-review.test.ts scripts/render-production-contact-sheets.test.ts scripts/split-paired-part.test.ts scripts/v0.2-source-tools.test.ts scripts/build-production-catalog.test.ts packages/asset-catalog/src/production-validation.test.ts
Test Files 6 passed (6)
Tests 51 passed (51)

npx playwright test tests/render/production-composition.spec.ts tests/render/production-color.spec.ts --project=chromium --workers=1
2 passed (9.3s)

npm run validate:v0.1.0 -w @qmonster/asset-catalog
exit 0; no diagnostics

npm run validate:v0.2.0 -w @qmonster/asset-catalog
exit 0; no diagnostics

npm run typecheck
exit 0

npm test
Test Files 49 passed (49)
Tests 428 passed | 1 skipped (429)

git diff --name-only 1ec7ec25f08e4c5ecbd67182d01ec99fda8df415 -- asset-source/v0.1.0 packages/asset-catalog/catalog/v0.1.0 packages/asset-catalog/assets/v0.1.0 packages/asset-catalog/audit/v0.1.0
(empty)

git diff --check
exit 0
```

### Fix round 1 concerns

- 本轮的联系表是 part-by-part 的完整组合 harness，而不是 Task 7 的随机整只组合 golden；Task 7 验收边界不变。
- 真实 composition 首次揭示的 face/occlusion 错误通过 catalog geometry 修复，没有退回 legacy renderer，也没有弱化阈值。
- 初版报告中关于 built-in image generation 透明恢复与大体积 v0.2 非破坏性树的 concerns 仍成立；本轮没有重生或替换任何候选素材。
