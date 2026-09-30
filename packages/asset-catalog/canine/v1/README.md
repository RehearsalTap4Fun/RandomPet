# 狗狗资源包 canine-1.0.0

六犬种：`shiba`、`corgi`、`golden-retriever`、`husky`、`dalmatian`、`poodle`。

| 风格 | 主体 | 原生画布 | 独立部件类型 | 配准 profile | 合法组合 |
|---|---:|---:|---:|---:|---:|
| pixel | 72 | 64×64 RGBA | 16 | 18 | 92,160 |
| plush | 18 | 1254×1254 RGBA | 11 | 6 | 5,184 |

像素主体包含三体型 `standard / shortleg-round / slender-tall`、两眼型 `round / sleepy-almond`、两嘴型 `parted-mouth / small-fangs`；毛绒包含标准体型、圆眼、三嘴型 `parted-mouth / small-fangs / tongue-tip`。每个嘴型是完整独立主体图，不能把嘴或眼另叠一层。毛绒源图在合成画布内统一缩放至 56/64、逻辑坐标 `(4,7)`，为成长留白；`none` 也使用相同构图。

## 读取与合成

只读 `{style}/catalog.approved.json`。`delivery.json` 是运行包文件白名单；不要扫描 `assets/`，那里还保存生产尝试稿。PNG 的 `resources[id].path` **相对于本目录**，不是相对于 catalog 文件目录。所有已配准图层、遮罩均与该风格画布同尺寸，消费者无需再次缩放、移位或裁剪。

```js
import {resolveCanine, composeCanine} from './runtime.mjs'
const selection = {
  bodyId: 'shiba-standard-round-parted-mouth',
  crown: 'antlers', ears: 'fin-ears', neck: 'frill-neck',
  back: 'feathered-wings', tailTip: 'flame-tail',
}
const plan = resolveCanine(catalog, selection)
// decoded[id] = 已校验摘要的 PNG 解码为 straight RGBA Uint8Array
const rgba = composeCanine(plan, decoded)
```

加载 `plan.body`、`clearMasks`、`behind`、`front` 和可选 `headMask` 引用的资源，先核 PNG `sha256`，再核解码 `rgbaSha256` 和尺寸。输出为 straight RGBA；完全透明像素 RGB 固定为零。浏览器 Canvas 可能因预乘 alpha 丢失边缘 RGB，精确回放应使用无损 PNG 解码器，或 Node + Sharp。显示可以使用 Canvas，但消费者不得用一套不同的 Canvas 层叠逻辑代替本合成器。包 revision 为去除自身 `revision` 后 `canonicalJson` 的 SHA-256；运行模块摘要另列 `runtimeSha256`。

未选槽默认 `none`，未知主体/字段/部件立即报错。五槽可自由组合，每个槽最多选一个：

| 槽 | 像素选项（另有 none） | 毛绒选项（另有 none） |
|---|---|---|
| crown | dragon-horns, antlers, halo, crystal-horns | dragon-horns, antlers, halo |
| ears | fin-ears, feathered-ears, celestial-ears | fin-ears |
| neck | small-lion-mane, frill-neck, sunburst-ruff | small-lion-mane, frill-neck |
| back | small-wings, feathered-wings, dragon-wings | 同像素 |
| tailTip | forked-tail-tip, flame-tail, phoenix-tail | forked-tail-tip, flame-tail |

绘制顺序由 `runtime.mjs` 唯一定义：先清除**原主体**的被替换耳/尾，再画背部、尾、耳和主体；有颈部时把原主体按 head 遮罩分成两层，颈部置于真实下巴之后，最后额顶。清除遮罩不能作用于已合成结果，否则会删掉新耳/新尾。头遮罩按实际 alpha 分层，不能简单用多边形删除颈部。

像素原始 64px 主体/部件的精确 128px 导出在 `pixel/exports-128/`。运行时先在 64px 合成再将每个 RGBA 像素复制成 2×2，可得到 128px；不要分别重采样各层。毛绒按当前选择懒加载、释放暂用解码层，避免把全部 102 张原生图层同时解码驻留。

## 交付、审核与回放

`node scripts/release-canine.mjs` 从已完成证据构建 `dist/canine/approved-1.0.0/`，仅包含白名单运行资源。117 张接受源图、原始生成文件、提示词和失败尝试保留在仓库，位置由 `provenance.json` 追溯。27 张部件为独立生成的共享幻想材质原图，按 24 个实际犬型派生 354 张配准部件；不把派生图记作独立 AI 生成。

审核由用户授权的 AI 执行，`userArtApproval:false`。最终门禁：`docs/qa/canine-v1/release-gate.json`。它校验 117 份源图审核、90 份组合审核、804 个明确视觉检查案例、1,800 个预览/回放案例，以及 97,344 种全量原生尺寸组合渲染。视觉检查覆盖所有犬型、表情和部件；不声称逐一视觉查看了全部 97,344 种组合。

`fixtures.json` 提供 1,800 条固定选择与 RGBA 摘要。完整选择和 RGBA 摘要在 `docs/qa/canine-v1/combinations/{pixel,plush}.jsonl.gz`。消费者先复现 fixtures，再按 gzip 清单做全量回放；PNG 压缩字节可能随编码器改变，跨端验收以 RGBA 摘要为准。

本地示例：将选择对象保存为 JSON，执行 `node scripts/render-canine.mjs pixel selection.json output.png`；像素会同时导出逐像素复制的 `output-128.png`。`node scripts/verify-canine-delivery.mjs` 从实际 dist 目录校验白名单并回放全部 1,800 条 fixtures。生成时的 `attempts/*.json` 是入库原始记录，其初始 pending 字段不代表最终状态；以 `visual/*.json` 和 release gate 为准。

本包新增独立 canine schema，不自动兼容旧 feline phenotype，也不改变猫/场景运行时。Claude 接入时应新增犬种/风格选择、把支持部件登记进实际成长阵容，验证阵容与目录双向一致，原猫存档继续走原逻辑。这里不擅自指定狗狗的成长概率、稀有度或解锁次序。

`runtimeEnabled:false` 表示接入和部署状态待 Claude 回写；资源审核完成不等于 Nutri 已部署。请回写接入提交、两风格 revision、回放结果，以及实际发布后的两端版本号。
