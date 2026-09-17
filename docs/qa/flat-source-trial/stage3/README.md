# 体型与眼型像素候选 QA

七个候选均为 **pending**；本阶段不写发布目录，不进入生成白名单。

- [完整画廊](index.html)：64／128／256px、三档轮廓、三组圆眼→半眯眼和校准前后对照。
- [浅色底概览](light-review.html) · [深色浏览器截图](browser-preview.png) · [浅色候选截图](browser-light-candidates.png)
- [机器报告](report.json) · [浏览器检查](browser-check.json)

## 重跑

从仓库根运行 `node scripts/review-pixel-stage3.mjs`。可用 `NUTRI_DIR` 指向 Nutri Git checkout；默认读取本地参考仓库。默认固定 Nutri 提交 385bdfae615547c509da331efeeaacd96f94e463，通过 Git 只读提取到本仓库 node_modules 缓存。`NUTRI_REF` 可明确指定后续提交，但必须包含 9868de3。缺失任一指定源图、已验收基线或异化资源立即失败，无毛绒回退。浏览器截图为独立人工检查证据，不由像素化脚本伪造。

## alpha 归一化边界

2026-09-17 用户授权：仅将 64px 半眯眼主体在固定眼区外的 alpha 对齐同体型圆眼基线。所有 RGB、眼区 alpha、1254px 源图不变。标准三处 (43,21)、(56,32)、(13,49)，修长一处 (39,42)，均为 alpha 255→0；短腿无修改。前后字节、PNG 再解码、确定性与源图哈希均有断言。标准／短腿基线来自 1.1.0 已验收包；修长基线来自本批圆眼源图。完整边界矩形和前后摘要见 report.json。

## 独立几何

标准、短腿重新核对原 profile；修长独立测量耳尖、下巴、脚和尾根。修长鳍耳缩放 0.69／0.69、平移 119／8；鬃毛缩放 0.59／0.56、平移 203／203（均为 1254px 源坐标）。尾部复用已验收焰尾，原生向左平移 4px。鳍耳和鬃毛复用 1.1.0 的同源平涂美术重新定位，标准／短腿及龙角直接复用已验收 PNG。独立 clear／face occlusion 完整坐标在 profiles.json 和报告。校准前使用标准部件与标准遮罩；校准后使用修长定位与遮罩。

| 体型 | 不透明像素 | native bbox | y=40 的不透明连续段（身体、尾） |
|---|---:|---|---|
| standard | 2099 | 9, 3, 60, 61 | [[15,44],[49,58]] |
| shortleg-round | 2272 | 8, 3, 61, 60 | [[9,48],[50,59]] |
| slender-tall | 1557 | 13, 2, 54, 61 | [[21,37],[45,52]] |

## 验证

- 四个新主体、16 个生产图层均为 64×64 二值 alpha，保留透明 1px 边。
- 七个候选和两个旧圆眼对照；128／256px 每个像素严格对应原图的 2×／4× 最近邻。
- Nutri 与项目 pixel-rgba-v1 渲染逐字节一致；所有输入哈希不变；旧 1.1.0 的 14 个组合摘要不变。
- 两组含鬃毛候选的眼／鼻／嘴矩形逐字节保留；换耳和换尾原始区域清除且替代部件在身体外可见。
- 浏览器主画廊 42／42 图片加载；浅色候选概览 14／14。已检查眼睛、尖牙、四脚、尾根和层级。
- 类型检查通过；完整测试 118／118。

## 七个候选摘要

| ID | PNG SHA-256 | RGBA SHA-256 |
|---|---|---|
| standard-sleepy-base | b77dd184b5fbfe1eefd7c1756b52309e0a10337aaff14c62b448555a219cee66 | 556b39c1b2448b6a243f343f461d52d81c21935c1077355a8a20b7a6ff704621 |
| shortleg-sleepy-base | f749291dfcfab7caca7389e80dbcfad58c678feb102dc8145aa79d285dea791d | a730c2f2be05047d2d9ea41f4199727117f46a4f69b2f508a0b9479a168d722f |
| slender-round-base | 4e8d68042728e4c5ab78c0aba62aefe52065684ceec108a61f59b6ec1064bc4f | 638ffd978a07995d5029dad25c9316d20973a35819c381bcc09ed828b8eeb644 |
| slender-sleepy-base | 9d567f058c58c6f5331b5eca4c419e0fdcfcbc8d8a940ab29a77cbbad2433522 | a16d11e10d083fe231fd904f902d457c47dc091843753eb4d946b9fd3e8b726a |
| standard-sleepy-ears-mane | fae2b5889cc1d7f3541651799ced8130a9d8e648faacc67bcc3461207db5f795 | 34df77e1906dc565c7bd829edaca9034c068e7210f7297eb96dc778b66793d28 |
| shortleg-sleepy-horns-flame | 7ae68a260f4d375e44636cf8c3ad1382e4efcd80c8c2bad8bbf1a0c194fac642 | 8907df3732922d25e93b790ce0ecb912d798477acce0e8b77a9f2ebec9749b14 |
| slender-sleepy-stack | 76ea799765035b4356319dca81a89dceb7ca2399a841e662a25219defaa2994c | fd83683e19ee4098a72705fd13bfe7109dbf6428cbaf19db4e3c04e3cf5ad898 |
