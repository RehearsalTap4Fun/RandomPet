# 异变批次 1 · 小范围验收

日期：2026-09-15。新增五件资源已接入，**五件新素材均已获用户批准**（原话：“没问题，这一批通过”）。[批准记录](../../releases/v0.10.0/mutation-batch1/approval.json)。

## 查看素材

- [六花纹素材对照](spot-check.html)：36 张原生 1254px 合成图，按 200px 显示，可切换深浅背景并点击放大。
- [18 个代表样本](index.html)：10 个单件（橘白/黑白各五件）、2 个跨位置叠加、6 个旧版对照。
- [浅底图](light.png) / [深底图](dark.png)。已检查五件辨识度、毛边、光环悬浮、尾根遮挡和焰尾原尾移除；用户已确认本批通过。

## 工程验证范围

`npm run verify:mutations` 固定渲染 18 个样本，并逐个 JSON 序列化后重绘，RGBA 哈希一致；6 个旧样本与迁移基线一致，18 个样本均有不同的像素输出。[机器记录](verification.json)。

组合空间为 5,184，但**本批不跑全部组合**。全量任务已按用户要求中止，其不完整缩略图留在被 Git 忽略的 `renders/`，不作为通过证据，也不被验收页面引用。当前有效输出在 `representative-renders/`。

类型检查、单元测试及 `npm run build` 已通过。单元测试针对规格、互斥、目录和变换，不代表审美验收。`npm run verify:integration` 验证新叠加存档回放、两个精确旧快照和本批验收阶段存档恢复、旧身份拒绝新异变及错误处理，见[SDK 检查记录](../integration-verification.json)。没有在外部孵化项目执行同步或部署。

## 素材与定位

| 资源 | 位置 / 层 | 最终范围 x / y |
| --- | --- | --- |
| halo | crown / L | 420–700 / 15–85 |
| dragon-wings | back / L | 20–1240 / 120–940 |
| feathered-wings | back / R | 100–1160 / 250–880 |
| frill-neck | neck / R | 140–1010 / 320–910 |
| flame-tail | tailTip / R | 880–1235 / 380–1135 |

五张真实 RGBA PNG 均按最终画布坐标制作，渲染时恒等变换；六花纹共享这五张资源，新增 30 个目录投影。原有 39 张资源及按花纹登记的定位 JSON 保持原字节。总资源数为 44，目录投影为 18 个身体 + 66 个异变。

首批生成把棋盘格画入 RGB，已淘汰。经用户明确授权，重新生成纯绿/纯黑底，然后由 `scripts/prepare-mutation-batch1.mjs` 去底、缩放定位为 RGBA；光环和焰尾保留渐变 alpha。全部提示词、输入、原始输出、处理参数与最终哈希见[生成记录](../../art/mutation-batch1/generations.json)。

当前运行身份为 `942d401f8013f4def2ff027d0839a34ad58a608774f532629d0845d318994cf4`。精确交付信息以[快照](../../integration/feline-combination-snapshot.json)为准；接入步骤见[指南 v3.1](../../integration/qmonster-hatchery-integration.md)。
