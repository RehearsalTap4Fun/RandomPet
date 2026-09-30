# 狗狗双风格资源生产

用户于 2026-09-30 确认：像素、毛绒两套；柴犬、柯基、金毛、哈士奇、斑点狗、贵宾；逐批自动审核，每张最多返工三次；全部通过后通过现有交流文件提交推送，通知 Claude 接入。

## 最终资源状态（2026-09-30）

全部批次与资源验收已完成：90/90 主体、27/27 独立成长源图；24 个犬型 profile 派生 354 张成长图层和 72 张替换/头部分层遮罩。像素 92,160、毛绒 5,184 种合法组合均在原生尺寸逐一渲染通过；804 个组合有明确 AI 视觉检查，全部 90 个主体另有逐张源图审核。审核不代表用户逐图批准。

正式入口为 packages/asset-catalog/canine/v1/{pixel,plush}/catalog.approved.json；最终门禁为 docs/qa/canine-v1/release-gate.json；1,800 条交付包回放结果见 delivery-verification.json。只按 delivery.json 白名单接入，候选和失败尝试不得混入运行包。

10 张接受资源经过返工，最高第二次返工通过，没有超过三次上限。配准修复了旧尾残留、旧耳残点、耳遮罩误伤尾球和颈部遮脸。合成器增加严格的自身属性校验以拒绝特殊字段名；修复后全量合法组合 RGBA 摘要与修复前一致，1,800 张预览 PNG/RGBA 和接触表摘要也完全一致，保留原视觉审核证据。

接入说明：packages/asset-catalog/canine/v1/README.md。Claude 通过 docs/integration/nutri-codex-exchange.md 接收交接；实际接入/部署尚待对方回写。

## 固定范围

- 像素：6 犬种 × standard / shortleg-round / slender-tall × round / sleepy-almond × parted-mouth / small-fangs = 72 主体；64px 与最近邻 128px。
- 毛绒：6 犬种 × parted-mouth / small-fangs / tongue-tip = 18 主体；1254px 透明 PNG。
- 像素成长部件：dragon-horns、antlers、halo、crystal-horns、fin-ears、feathered-ears、celestial-ears、small-lion-mane、frill-neck、sunburst-ruff、small-wings、feathered-wings、dragon-wings、forked-tail-tip、flame-tail、phoenix-tail。
- 毛绒成长部件：上述集合去掉 crystal-horns、feathered-ears、celestial-ears、sunburst-ruff、phoenix-tail，共 11 种。
- 交付：完整图层、逐犬种/体型定位与遮挡规则、组合预览、批次技术及视觉审核、溯源与提示词、接入说明。猫的既有版本不可被狗狗文件覆盖。

## 批次

1. 柴犬双风格母版与风格/几何门槛。
2. 柴犬、柯基主体变体。
3. 金毛、哈士奇主体变体。
4. 斑点狗、贵宾主体变体。
5. 额顶/耳朵成长部件，按实际犬型适配。
6. 颈部/背部成长部件，按实际犬型适配。
7. 尾巴替换部件、残余器官与接口检查。
8. 全清单核对、组合回放、双背景视觉复核、完整交付与 Claude 通知。

## 审核与返工

逐张保留原始输出、提示词、来源路径、最终文件摘要、技术指标和视觉判断。生成工具为内置 image_gen，每张资源单独调用。背景请求真实透明，不把棋盘格当透明。像素技术处理仅用于尺寸/量化/最近邻导出，不以程序画图替代生成。

技术检查：解码尺寸、真实 alpha、非空内容、边界裁切、文件与 RGBA 摘要、资源引用闭合、组合回放、可重复性。视觉检查：犬种辨识、与现有对标一致、眼型表情可辨、器官完整、部件衔接和遮挡。技术通过不能代替视觉通过。审核人字段明确记录 AI，不能伪称用户逐图批准。

不合格资源最多返工三次；继续其他独立资源，末批汇总未解决项。任何必需资源未通过时不得宣布全部完成或通知 Claude 正式接入。

## 历史生产记录（最终状态见顶部）

生产已获用户确认。首组柴犬、柯基主体 30/30 已生成、逐张 AI 视觉审核并通过整组技术核验（每犬种像素 12、毛绒 3）；对应证据 `docs/qa/canine-v1/checkpoints/shiba.json`、`corgi.json`、`all.json` 及同名 `*-contact.png`。

像素标准小尖牙使用第二次返工稿，短腿圆眼小尖牙使用第一次返工稿。失败原因是 64px 下牙齿与浅色口鼻融合；原始尝试均保留。后续嘴型制作引用已通过嘴型和独立体型母版。

128px 导出最初使用图像库 resize，导致完全透明像素的隐藏 RGB 被归零；逐像素验证暴露此差异。现改为显式 RGBA 整数复制，已通过整组核验，原生图字节未改动。

金毛主体 15/15 已完成并通过 `golden-retriever.json` 整组核验，目前共 45/90 款主体通过。金毛毛绒小尖牙初版生成了整排门牙，判定失败；第一次返工保留两颗上犬齿后通过。失败图、技术报告、视觉报告与预览已归档至 `docs/qa/canine-v1/history/plush/golden-retriever-small-fangs/`。`promote` 现会在替换 canonical 文件之前保留被替换稿的完整证据。金毛修长体型头部略高、略小，后续部件必须采用其实际坐标单独配准。

哈士奇主体 15/15 已完成并通过 `husky.json` 整组核验。像素母版第一次返工修复尾部碰右边界；短腿半睁眼尖牙、修长圆眼尖牙各第一次返工修复蓝虹膜被 32 色量化合并的问题。调色板对比图保留，最终仍采用统一 32 色导出；后续哈士奇提示词明确大块纯蓝虹膜。毛绒母版第一次返工增加耳尖和脚底透明留白。所有失败稿在 `history/` 保留完整证据。修长体型脚底基线 y62，需要实际体型配准。

斑点狗主体 15/15 已完成并通过 `dalmatian.json` 整组核验。像素标准圆眼尖牙初版及第一次返工在 64px 下右牙与白口鼻融合，第二次返工加大封闭口腔、保留深色边缘后通过；后续尖牙引用该通过稿。毛绒三表情均通过。

贵宾主体 15/15 完成，标准圆眼尖牙第一次返工修复牙齿融合，其余变体均通过。`poodle.json` 和 `all.json` 已核验全部 90/90 主体（72 像素、18 毛绒），含实际文件与审核哈希、透明度、无边缘裁切、128px 精确整数复制、原始来源和提示词。主体阶段完成不等于全任务完成。

成长部件原图 27/27 已逐张独立生成并通过原图审核（像素 16、毛绒 11），`parts-manifest.json` 和 `checkpoints/parts.json` 已记录并核验。像素颈褶初稿右边界裁切，第一次返工通过，初稿完整证据保存在 `history/pixel/growth-frill-neck/`。部件采用统一幻想材质，每个实际犬型需独立几何配准，不能把源图审核等同全部适配完成。

初步像素额顶与耳部配准位于 `crown-registration.json`、`ear-registration.json`，各 18 犬种/体型条目。耳部首次拼接出现垂耳犬耳根脱离和修长金毛左颊切缺、残耳，已向内收耳根、调整遮挡顺序并修正金毛遮罩；`registration/golden-ear-detail-1.png` 保留失败放大图，`golden-ear-detail-fixed.png` 为修正后。其余犬型与全部表情仍需最终组合复核，当前两个 study 脚本不是正式渲染入口。

上述为阶段日志，配准、正式目录及组合校验已完成；最终状态以顶部与 release-gate.json 为准。

## 复现生产（历史命令）

- `node scripts/canine-next-job.mjs pixel poodle` 输出下一犬种的可生成任务与完整提示词/参考图；先完成该犬种两套母版，审核后其他变体才进入候选。
- 工具调用每张独立执行内置 image_gen，真实透明；提示词保存在 `prompts/`。先用 view_image 查看尚未见过的参考图。
- `node scripts/canine-production.mjs import <style> <id> <generated-path> <prompt-path>` 复制原图并记录溯源；再 `normalize <style> <id>`、`preview <style>/<id>`。
- 查看最终深浅背景预览后执行 `review <style> <id> pass|fail <具体视觉判断>`。不得根据技术通过自动填写视觉通过。
- 返工以 `-r1` 到 `-r3` 独立命名，审核后 `promote <style> <attempt-id> <canonical-id>`。原始图和提示词永久保留，正式交付只按审核清单选取 canonical ID，不得目录通配包含失败稿。
- `node scripts/verify-canine-checkpoint.mjs <breed>` 校验该犬种完整 15 款；无参数仅核验当前已审核主体并明确报告剩余工作，不能作为全任务完成证据。
- `manifest.json` 为 90 款主体任务状态。成长部件尚需另外登记实际生成/复用及适配变体、组成规则和逐组合审核，不能把主体完成等同资源包完成。
