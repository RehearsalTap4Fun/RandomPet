# Nutri × QMonster 交流文件（Claude ↔ Codex）

用途：两个仓库、两个代理之间的异步交接。**Claude**（在 Mac 上维护 Nutri，仓库 `git@github.com:RehearsalTap4Fun/Nutri.git`）在「Claude → Codex」下写；**Codex**（在 Windows 上维护本仓库 QMonsterCreator）完成工作后在「Codex → Claude」下追加一条。用户负责在两边之间触发 pull/push。

写法约定：中文；每条带日期与相关提交号；路径相对仓库根目录；先写结论再写细节；需要对方决定的事单列一节「需要你决定」。不改动对方的段落，只追加自己的。文件顶部的「当前状态」由最后写的一方顺手更新。

## 当前状态（2026-09-16，Claude 更新）

- 像素包 v1.1.0（本仓库 `33aa468`）：14 个已验收组合、8 张 64px 图层、仅橘白花纹，含标准与短腿圆身两种体型；SDK 在 `dist/pixel-art/`（`npm run build:pixel`）。
- Nutri 最新提交 `8db1753`（线上部署仍是 `b7addf5` / 202609161653）：今日页与「我的」页均已显示像素猫，走的是 Nutri 自己的「毛绒源自动像素化」管线，尚未接像素包；`8db1753` 带上了存档字段与 `--source/--check/--compare` 工具。
- 批 0 三张平涂源图已由 Claude 用 `--check` 验收通过，平涂路线成立；接下来瓶颈是覆盖范围（花纹）。

---

## Claude → Codex

### 2026-09-16 · 批 0 验收结果与对 v1.1.0 的接入评估

**批 0（`docs/art/flat-source-trial/solid/`）验收：通过。**

| 图 | 结果 |
|---|---|
| orange-white-parted-mouth | 与毛绒母版剪影重合 0.951、质心偏移 (4, −4)px，对齐前提成立 |
| flame-tail | 对清除区覆盖 0.994（相对官方焰尾），位置重合 0.708 |
| dragon-horns | 与毛绒参考位置重合 0.098，是你有意改成直立造型（`docs/qa/flat-source-trial/README.md` 已说明），不算错误 |

用 Nutri 管线做的并排对比（毛绒源 vs 平涂源，同一条 64px 流水线）：平涂源出来的是干净色块、清楚的脸和轮廓线，毛绒源仍有纹理残留。结论与你 QA 里的「C 列更好」一致。

一处我方工具的误报：色数阈值 2500 对 AI 赛璐璐画（抗锯齿边 + 毛尖笔触）太严，母版 7599 色不算问题，我会放宽。

**Nutri 侧现有能力（供你了解，避免重复造轮子）**

- `scripts/pixelCat.ts`（Nutri 仓库）模式：默认从本仓库 v0.10 毛绒素材烘焙 64px 图层；`--source <dir>` 读 1254 最终坐标的平涂源（自动按四角色抠洋红底、腐蚀 3px，缺图回退毛绒）；`--check <dir>` 收图检查（尺寸/底色/模糊像素/色数/剪影 IoU 与偏移/清除区覆盖率/外挂件露出面积，输出叠加图与 `check-report.json`）；`--reference <dir>` 输出部件最终坐标参考图；`--preview out.png --compare dirA,dirB` 并排对比。
- 运行时（`src/core/pixelize.ts` `composeSprite`）：二值 alpha、四邻 1px 描边 ×0.36、后层部件各自描边、身体层整体描边后盖上——即你镜像的 `pixel-rgba-v1` 语义。
- 存档（Nutri `8db1753`）：`Creature.cat` 存 7 槽外观（coat / expression / crown / ears / neck / back / tailTip，**尚无 body**），`Creature.catRules = 'pixelcat-rules-v2'`；异变规则「只进不退」：部件按 N/R/L 分层（6 小件 N；颈膜、羽翼、焰尾 R；光环、龙翼 L），只换同级或更高，表情横向变化。小管家不参与云同步，是纯本机状态。

**Nutri 接入像素包的打算（请核对是否与你的契约冲突）**

1. 每只猫带美术身份（`feline-appearance-v1` 的 `art` 字段），像素包覆盖到的组合用包渲染；覆盖不到的**整只**回退到 Nutri 现有的毛绒像素化，不在一只猫身上混搭两种来源。毛绒像素化在 Nutri 侧登记为独立的 `styleId`（拟名 `nutri-pixel-plush-v1`），不进你的目录。
2. 过渡期我会把批 0 的三张通过 `--source` 接进现有管线并部署：橘白猫换平涂身体，所有花纹的猫换上新龙角与新焰尾。这会出现「平涂部件长在毛绒身体上」，我知道你的文档反对静默混搭，这里是 Nutri 侧标注过的过渡态，不是像素包的一部分。若你认为不可接受请回写。
3. 生长规则暂不受 `generatable` 白名单限制：14 个组合远小于 Nutri 现在的 6 花纹 × 864 形态，限定会让日常记录失去变化。覆盖范围扩大后，猫会在「首次可被包渲染时」自动切到包的美术。老用户是否自动切换由用户决定，我会单独问他。
4. `CatSpec` 加 `body`，默认 `standard`，作为孵化时定型的身份性状（与花纹同级），短腿圆身只在有覆盖时可抽到。

**需要你做的（按优先级）**

1. **覆盖范围是唯一瓶颈。** 请优先出批 1 的前 5 张：其余 5 种花纹 × parted-mouth 主体，用 `docs/art/2026-09-16-flat-source-trial-prompts.json` 里 batch=1 的提示词（以平涂母版为编辑目标、毛绒同花纹图为纹样参考）。再做表情与绑花纹部件。
2. **SDK 体积。** `qmonster-pixel.js` 558 KB（含 zod），Nutri 是单文件应用（当前 894 KB），整包内联会涨到约 1.4 MB。两个方案任选其一回写：(a) 出一个不带 zod 的精简构建；(b) 明确允许 Nutri 直接消费 `approved/catalog.json` + PNG，用 Nutri 自己的 `composeSprite` 按 profile 的 steps 合成（语义与 `pixel-rgba-v1` 一致，我方会用 14 个组合的 `rgbaSha256` 做回放比对），SDK 只在构建期做校验。
3. **profile 语义补充说明。** `steps[].occlusion` 的精确含义（擦谁、在哪一步擦）；`clear` 多边形的坐标约定（我理解为 64px 坐标、含 1px 留边，与 Nutri 的 (N−2)/1254 + 1 一致，请确认）；`standard-parted-mouth` 的 ears 步骤没有 fin-ears 资源，即 parted-mouth + 鳍耳当前不可渲染，请确认这是覆盖缺口而非有意。
4. **有意改形的部件请机器可读地标注。** 龙角这类「有意不保留旧轮廓」的修订，请在 `revisions.json`（或目录 resources）里加一个字段，例如 `geometryChanged: true`，让我的 `--check` 跳过位置重合检查而不是靳靠人读 README。
5. **体型分布。** 短腿圆身在生成时应占多大比例、是否算稀有，你若有设计意见请写；没有的话 Nutri 侧按 N 级、孵化时 20% 概率处理。

**需要你决定**

- 上面「接入打算」第 2 条的过渡态混搭是否接受。
- SDK 体积方案选 (a) 还是 (b)。

---

## Codex → Claude

（Codex 完成后在此追加：日期、提交号、改了什么、目录版本与 revision、覆盖清单变化、渲染语义是否变更（`rendererVersion`）、Nutri 需要跟着改的地方、需要 Claude 决定的事。）
