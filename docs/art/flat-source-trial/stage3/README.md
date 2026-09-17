# Stage 3 体型与眼型候选生产记录

日期：2026-09-17

状态：技术验证通过，美术验收待用户确认

候选目录：`1.2.0-candidate.1` / `3ba990a5dfde65b0b79dabe958c9d3c742a08a30fdb582536b85cde5b11c288d`

渲染器：`pixel-rgba-v1`（未改变）

本批固定 `coat = orange-white`、`expression = small-fangs`，制作一个 `slender-tall` 体型和一个 `sleepy-almond` 眼型。四张选中源图都是 1254×1254、纯洋红背景的完整主体；眼型在语义层是独立字段，在当前美术层烘焙到完整主体 PNG，不使用运行时眼睛贴片。

技术回放、摘要一致、浏览器检查和自动 QA 通过，只证明候选可重复生产与渲染，**不等于用户美术批准**。七个新组合保持 `review: pending`，不进入 `generatable`；本记录不批准或生成正式 `1.2.0`。

## 四张选中源图

生成器原始输出只做统一色键归一化：RGB 到 `#FF00FF` 的欧氏距离小于 90 时改为精确 `#FF00FF`，其他 RGBA 字节不变，不缩放。原图保存在 `attempts/*-raw.png`，选中版本保存在 `solid/`。

| ID | 编辑目标 | 选中 SHA-256 | 原始输出 SHA-256 |
|---|---|---|---|
| `orange-white-sleepy-almond-small-fangs-standard` | stage2 标准圆眼主体 | `cb7f7f07ddbfa59897eb9cc90190aeaec4ddca8391450b6eecc2873bda509bde` | `ffab6f1d2f00af4f1a4fc2a57ec1c77e353f12b9429b1d44a3f555c91d8248d9` |
| `orange-white-sleepy-almond-small-fangs-shortleg-round` | stage2 短腿圆眼主体 | `ba1e40164ba0a1dd3b9631acfc182cda58b26a6f4b732e9cf8c38585b5a7a252` | `c67c201061c7ce55339c8f54279dc9fc13d529cb9ab053b6f98cb742d244c084` |
| `orange-white-round-small-fangs-slender-tall` | stage2 标准圆眼主体 | `6b7fa7244fcaa159a2bcd2a55c14413c1572ed789f22513a3da8aa986e39e6c7` | `01e3ce1d7490f293bc48411bf19591a0fdcbee607ae1a7d90c7541a6f455c5ea` |
| `orange-white-sleepy-almond-small-fangs-slender-tall` | 本批选中的修长圆眼主体 | `4f310383fce5cdd6ab9ba37dde7e6120acce3f301f3085b4ad97a228c7207acb` | `281e240240c1bc5b602ea7c5705aed2993f1dfcfc86e87966f203af9b41e3c1f` |

完整机器可读来源、工具输出路径、处理计数和摘要见 `generation.json`。

## 四次首轮生产提示词

### 标准体型 · 半眯杏仁眼

```text
Use case: precise-object-edit. Asset type: 1254x1254 game sprite production source. Input image 1 is the EDIT TARGET, the standard orange-white kitten. Change ONLY the two eyes from large round eyes to calm half-lidded almond eyes, within left eye rectangle x280..420 y300..420 and right eye rectangle x515..700 y300..430. Each eye has a horizontal almond opening, gently lowered upper eyelid, visible teal iris, dark pupil and exactly one white highlight. Keep both eyes open enough to survive 64px downsampling, with at least 55px opening height. Preserve EVERYTHING outside the two eye regions pixel-for-pixel: exact silhouette, head, ears, orange-white markings, nose, exaggerated two-small-fang mouth, paws, tail, colors, outlines and coordinates. Do not resize, shift or redraw the cat. Uniform exact solid #FF00FF background. No eyebrows, mouth change, extra marks, gradient, texture, shadow or text. Output exactly 1254x1254.
```

### 短腿圆身 · 半眯杏仁眼

```text
Use case: precise-object-edit. Asset type: 1254x1254 game sprite production source. Input image 1 is the EDIT TARGET, the shortleg-round orange-white kitten. Change ONLY the two eyes from large round eyes to calm half-lidded almond eyes, within left eye rectangle x280..425 y300..425 and right eye rectangle x515..710 y300..435. Each eye has a horizontal almond opening, gently lowered upper eyelid, visible teal iris, dark pupil and exactly one white highlight. Keep both eyes open enough to survive 64px downsampling, with at least 55px opening height. Preserve EVERYTHING outside the two eye regions pixel-for-pixel: exact squat body, broad low haunches, small low paws, head, ears, orange-white markings, nose, exaggerated two-small-fang mouth, single right-side tail, colors, outlines and coordinates. Do not resize, shift or redraw the cat. Uniform exact solid #FF00FF background. No eyebrows, mouth change, extra marks, gradient, texture, shadow or text. Output exactly 1254x1254.
```

### 修长高挑 · 圆眼

```text
Use case: precise-object-edit. Asset type: 1254x1254 game sprite production source. Input image 1 is the standard orange-white kitten EDIT TARGET and style reference. Redesign ONLY the kitten body proportions into a slender tall seated type: noticeably lengthen the visible front legs, narrow torso and haunches, and make both ears modestly larger relative to the head. Keep a cute juvenile seated pose, four clearly distinct paws, two separate long front legs with a clear central dividing outline, one right-side tail, centered placement and similar overall canvas occupancy. Preserve orange-white palette and marking layout, large round teal eyes each with one white glint, pink nose and exaggerated two-small-fang mouth. Keep hard-edged cel shading and dark outlines. At 64px the silhouette must visibly differ from standard and shortleg without becoming adult, skeletal or standing. Leave at least 35px magenta margin beyond every ear tip, paw and tail; do not crop. Uniform exact solid #FF00FF background; no ground, shadow, text, gradient, fur texture, eyebrows or extra limbs. Output exactly 1254x1254.
```

### 修长高挑 · 半眯杏仁眼

```text
Use case: precise-object-edit. Asset type: 1254x1254 game sprite production source. Input image 1 is the EDIT TARGET, the selected slender-tall orange-white round-eye kitten. Change ONLY the two eyes from large round eyes to calm half-lidded almond eyes, within left eye rectangle x330..455 y285..390 and right eye rectangle x535..695 y285..400. Each eye has a horizontal almond opening, gently lowered upper eyelid, visible teal iris, dark pupil and exactly one white highlight. Keep both eyes open enough to survive 64px downsampling, with at least 55px opening height. Preserve EVERYTHING outside the two eye regions pixel-for-pixel: exact slender seated silhouette, long separate front legs, narrow haunches, four paws, head, enlarged ears, orange-white markings, nose, exaggerated two-small-fang mouth, single right-side tail, colors, outlines and coordinates. Do not resize, shift or redraw the cat. Uniform exact solid #FF00FF background. No eyebrows, mouth change, extra marks, gradient, texture, shadow or text. Output exactly 1254x1254.
```

## 重试与选择

生产门检查发现首轮标准半眯图在眼区外有 3 个 64px alpha 差异、修长半眯图有 1 个；短腿半眯图精确通过。随后单独调用图像生成器进行 4 次标准重试和 1 次修长重试。五张产物均通过 1254px 源图检查，但仍有 1–4 个眼区外 alpha 差异，因此全部淘汰；另有一次标准第 4 次调用先返回 HTTP 403 且没有图片，随后同提示重试得到产物。原四张选中源图保持与提交 `571b3f4` 字节一致。

| 体型 / 次数 | 结果 | raw SHA-256 | 归一化 SHA-256 | 眼区外 64px alpha 差异 |
|---|---|---|---|---|
| standard / 1 | 未选中 | `5626b560e700464919e7aa2376c15ac310848aff645e0d8fbe3e4dc267fa5ae7` | `e393ab2d28f9261d2add44dd412546616f2d2a484dc781d3a3d883fce023df88` | `(43,29) (56,32) (13,48) (13,49)` |
| standard / 2 | 未选中 | `1e67c77fd499bd98deb32c48d7907a2a4d993883829833ba4bebdd4148584674` | `a52fca22f060da102e740ba21b9bb5403ae0882575b07c48c628222ea932efba` | `(13,49)` |
| standard / 3 | 未选中 | `10ce6700006b230011149a1c9728fd05fc5e0fe93bc6fb0167c33f8cdfaa5bca` | `ee0fc42b23a9a54798067b05c585b1d8a16d9433e222097df87f8934a863b32e` | `(13,49)` |
| slender-tall / 1 | 未选中 | `c0d08efb3e4e61920e0cce25b2af8d46218ed55322277f38365dc49b8915ce54` | `7e5878f7f4677293f19c3ff733b4dfe45c621c9340aaf6a911589f77c7b14cff` | `(39,42)` |
| standard / 4 | 工具错误，无图 | — | — | HTTP 403 |
| standard / 4（重试） | 未选中 | `92e3097a5b4787e48ffc7fc6251eb70ee11ef35085b59f5d251dfeef4bb07e9e` | `8a56f9cbcfe63328e803235a55c10fdae7e9c64cd99c4aa451b6df2282b8dc98` | `(43,21) (13,31) (56,32) (13,49)` |

每次重试的完整提示词、目标、附加参考、产物路径、PNG/RGBA 摘要和保存的生产门结果在 `revisions.json`；`check-retry-provenance.mjs` 会验证记录路径与摘要一致。

用户在 2026-09-17 明确授权生产阶段只在 64px 复制同体型圆眼基线的眼区外 alpha，同时保留所有 RGB、眼区内 alpha 和四张 1254px 源图。最终标准与修长生产图的眼区外差异均归零；短腿图无需改动。该操作属于有界生产归一化，未改变 `pixel-rgba-v1`。

## Profile 决策

- 三个体型各自拥有两块耳部 clear、多边形尾部 clear、脸部 occlusion 和部件定位；完整数值固定在 `profiles.json`，SHA-256 为 `6bb62db46be2effe03d27ab0ebbf04a527d8080fe3e4a741bbae43e632e88000`。
- `standard` 与 `shortleg-round` 以已验证 stage2 几何为起点，并针对新的完整主体重新测量；两者没有因为 eye 语义而共享 profile selector。
- `slender-tall` 使用独立几何。最终 64px 主体 bbox 为 `[13,2,54,61]`、不透明像素 1557；修长体型的耳 clear、尾 clear、脸部 occlusion 和鳍耳／鬃毛定位均单独校准。
- 既有龙角、焰尾、鳍耳和小狮鬃 PNG 可复用，但每个体型映射与 clear/occlusion 仍由自己的 profile 声明。六步顺序保持 `back, crown, body, ears, tailTip, neck`，渲染器继续接收原有 `PixelArtPlan`。
- v2 候选共有 7 个四项 selector：`body + coat + eyes + expression`；不能从已有资源推断未登记组合。`standard + parted-mouth + fin-ears` 仍是明确的未覆盖组合。

## 自动 QA 与候选摘要

源图检查确认四张图均为 1254×1254、四角 `#FF00FF`、只做背景归一化；标准／短腿／修长半眯图相对同体型圆眼参考的眼区外 silhouette IoU 分别为 0.998655、0.999295、0.998824。修长主体 bbox 为 `[242,27,1094,1225]`，没有裁切或触边。Nutri 原生 checker 不认识新 v2 ID，因此记录了原生拒绝，并以同体型别名运行相同检查；Nutri 提交和模块摘要固定在 `evidence/source-checks.json`，Nutri tracked 文件未改变。

`node scripts/review-pixel-stage3.mjs` 产出原生 64×64、二值 alpha 结果，并验证：

- 7/7 pending 候选确定性重放，目录记录 PNG 与原生 RGBA SHA-256；
- 14/14 v1.1.0 既有组合 RGBA 不变；
- 所有输入图层未修改；
- 标准和修长鬃毛遮罩保持脸区字节不变；
- 鳍耳分别清除 199 / 220 个旧耳不透明像素；焰尾分别清除 343 / 262 个原尾不透明像素；
- 64px、128px、256px 样张齐备，放大图是严格最近邻结果；
- 浏览器画廊加载 42/42 图，浅色候选页加载 14/14 图；深浅背景均检查过眼睛、尖牙、四爪、修长长腿、耳尾替换和图层顺序。

| pending ID | profile | RGBA SHA-256 |
|---|---|---|
| `standard-sleepy-base` | `standard-sleepy-almond-small-fangs` | `556b39c1b2448b6a243f343f461d52d81c21935c1077355a8a20b7a6ff704621` |
| `shortleg-sleepy-base` | `shortleg-round-sleepy-almond-small-fangs` | `a730c2f2be05047d2d9ea41f4199727117f46a4f69b2f508a0b9479a168d722f` |
| `slender-round-base` | `slender-tall-round-small-fangs` | `638ffd978a07995d5029dad25c9316d20973a35819c381bcc09ed828b8eeb644` |
| `slender-sleepy-base` | `slender-tall-sleepy-almond-small-fangs` | `a16d11e10d083fe231fd904f902d457c47dc091843753eb4d946b9fd3e8b726a` |
| `standard-sleepy-ears-mane` | `standard-sleepy-almond-small-fangs` | `34df77e1906dc565c7bd829edaca9034c068e7210f7297eb96dc778b66793d28` |
| `shortleg-sleepy-horns-flame` | `shortleg-round-sleepy-almond-small-fangs` | `8907df3732922d25e93b790ce0ecb912d798477acce0e8b77a9f2ebec9749b14` |
| `slender-sleepy-stack` | `slender-tall-sleepy-almond-small-fangs` | `fd83683e19ee4098a72705fd13bfe7109dbf6428cbaf19db4e3c04e3cf5ad898` |

完整证据见 `docs/qa/flat-source-trial/stage3/report.json`、`browser-check.json` 和 `docs/qa/pixel-body-eye-batch/report.json`。用户审阅入口为本地开发服务器的 `/pixel`，选择 `候选包 1.2.0 · 21 个组合` 后可查看全部七个 pending 组合。
