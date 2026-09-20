# 不规则涂鸦背景 · 美术验收

状态：用户于 2026-09-20 对独立叠加的 96×64 场景版明确回复「验收通过」；当前为 `art-approved-registration-pending`，尚未新增表现型字段、升级 catalog 或登记正式像素包。

## 三档候选

- `doodle-horizon`（N）：米白横向涂抹块和左右成组的波浪涂线。
- `doodle-leaf-shadow`（R）：浅绿底与左右对称的带叶脉枝条。
- `doodle-rainbow-trail`（L）：浅紫底、两侧双层青橙虹弧和米白星芒。

三张均为 96×64、二值 alpha、单一四邻连通区域；参考以太猫使用多段圆润横带构成横向不规则涂抹块。边界分别为 N `[4,7]-[92,54]`、R `[3,7]-[91,55]`、L `[3,7]-[92,55]`，面积分别为 3097、3213、3221px。每张在 `y≤14` 的头顶区域至少保留 400px，在 `x≤15` 或 `x≥80` 的两侧区域至少保留 300px。L 档底色相对亮度为 0.662，三种装饰色分别为 0.508、0.469、0.832，均满足设计门槛。

## 21 格验收

- 前 18 格：三档背景分别搭配 `orange-white`、`brown-tabby`、`tuxedo`、`calico`、`colorpoint`、`rosetted` 六种毛色。
- 后 3 格：三档背景分别搭配光环、颈膜、羽翼和焰尾满配组合。
- 满配时仍可见的背景本体像素分别为 N 729px、R 797px、L 834px；首版 64×64 同画布方案仅为 73px、90px、119px。
- 页面：`index.html`。每格同时显示 3 倍最近邻预览与原生 96×64 场景，并可切换深浅页面底色。

## 合成边界

QA 先用正式 `packages/asset-catalog/pixel/v3/approved-1.5.0/catalog.approved.json` 与 `pixel-rgba-v1` 生成不变的 64×64 猫图，再由临时 `pixel-scene-preview-v1` 把猫水平居中叠到 96×64 背景上，偏移为 `(16,0)`。候选没有写入生产 profile、coverage 或资源表，正式 1.5.0 和 Nutri 运行时均未修改。

`report.json` 固定三张候选的文件摘要、几何与明度统计，以及 21 个组合的 PNG／RGBA SHA-256。
