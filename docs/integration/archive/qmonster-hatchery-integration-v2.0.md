# QMonster 生成器 × 孵化项目接入指南

文档版本：2.0。更新日期：2026-09-15。本文以当前完成尾巴修复的猫型组合实现为接入基线。

## 1. 当前接入方式

孵化项目直接调用组合生成、目录解析、共享 Canvas 渲染和图片导出模块。接入流程为：

```text
稳定 seed + 可选的精确选项
  → generateFelineCombination
  → resolveFelineCombination
  → renderFelineCombination
  → exportCanvas
  → 原子保存完整 visual 身份 + 图片缓存
  → 孵化项目标记 READY
```

当前接口使用 `FelineCombinationSpec`，不要再把它送入旧 `generateMonster`、`renderMonster`、`toV09GenerationRequest` 或旧孵化适配器。`packages/incubator-adapter` 尚无本组合版的导出接口；本文提供的是可运行的浏览器端接入示例，并未修改外部孵化项目。

| 身份 | 当前值 |
| --- | --- |
| spec.schemaVersion | `feline-combination-v1` |
| spec.catalogVersion | `0.10.0-candidate.1` |
| catalog.schemaVersion | `feline-combination-catalog-v1` |
| catalog.templateVersion | `feline-sit-v1` |
| 原生画布 | 1254 × 1254，透明背景 |
| 资源 | 39 张 PNG，54 个目录引用 |
| 组合空间 | 6 花纹 × 3 完整表情 × 48 异变组合 = 864 |

现有目录标识仍为 candidate，不能只在文档中改称 `0.10.0`。旧 `active-release.json` 仍属于 v0.9 发布机制，指向 v0.9.0；它不是当前组合版的目录加载入口。本次接入通过下述精确快照显式选择当前版本，不改动旧指针。

## 2. 工程组织与需要发布的文件

当前包均为 private workspace 包，根 package version `0.1.0` 不代表美术目录版本。推荐把孵化源码放入同一 workspace；如果是独立仓库，应构建并交付含代码与资源的固定快照，不要假设公共 npm SDK 已发布。

可用接口：

| 模块 | 接口 |
| --- | --- |
| generator-core | `generateFelineCombination`、`parseFelineCombinationSpec`、`mutationSelectionsFromList`、位置选择/锁定重掷接口 |
| feline-combination-catalog | `parseFelineCombinationCatalog`、`auditFelineCombinationCatalog`、`resolveFelineCombination` |
| feline-combination-render | `createFelineCombinationResourceResolver`、`renderFelineCombination` |
| renderer export | `exportCanvas`、`CanvasExportError` |

具体 import 路径见 [可运行示例](examples/feline-hatchery.ts)。目录与渲染器示例使用源码模块的直接路径，避免从包含 Node 专用工具的包总入口拉入浏览器构建。目录 JSON 没有公开 npm 子路径导出。

[快照清单](feline-combination-snapshot.json)记录实际目录 SHA-256、39 个资源的路径与哈希，以及生成器、随机数实现、目录解析、渲染器、定位数据、导出器和依赖锁文件的身份。交付时必须使用同一份源码及依赖构建并复制该清单；`runtimeRevision` 是集成封装的版本标识，不是原生 spec 字段，也不等于浏览器产物文件哈希。它由按路径排序的 `sourceHashes` 对象经 `JSON.stringify` 后计算 SHA-256 得到。

建议将资源复制到一个不可变发布目录，保留清单中的相对层级：

```text
/qmonster/<runtimeRevision>/
  packages/asset-catalog/catalog/v0.10.0-candidate.1/catalog.json
  packages/asset-catalog/assets/v0.10.0-candidate.1/*.png
```

例子中的 `resourceBaseUrl` 指向 `/qmonster/<runtimeRevision>/`，解析器会拼接 `resource.path`。不要只传 PNG 所在目录，否则会重复拼接路径。`catalogUrl` 则指向完整 catalog.json 地址。校验使用文件原始字节，发布时不要重排 JSON 或重新压缩 PNG。

这套接入只需当前 39 张资源和组合运行模块，不需要把 Creator 全量 dist、历史素材库或设计预览页面一起发布给孵化器。旧存档如仍使用旧版本，则另外保留其原版本资源和渲染实现。

## 3. 花纹、表情与异变输入

```ts
import { mutationSelectionsFromList } from '@qmonster/generator-core'
import { createFelineHatchery } from './examples/feline-hatchery'
import snapshot from './feline-combination-snapshot.json'

const base = new URL(`/qmonster/${snapshot.runtimeRevision}/`, location.origin)
const hatchery = await createFelineHatchery({
  catalogUrl: new URL(snapshot.catalogFile, base).href,
  resourceBaseUrl: base.href,
})

const mutations = mutationSelectionsFromList([
  'dragon-horns', 'small-lion-mane', 'forked-tail-tip',
])
const result = await hatchery.hatch('egg-20260915-001', {
  coat: 'brown-tabby',
  expression: 'small-fangs',
  ...mutations,
})
// result.visual 保存身份；result.image.blob 保存到 IndexedDB/对象存储。
// 保存成功后再将本次 egg/hatch 记录标记 READY。
```

| 位置 | 合法选项 |
| --- | --- |
| coat | brown-tabby / orange-white / tuxedo / calico / colorpoint / rosetted |
| expression | parted-mouth / small-fangs / tongue-tip |
| crown | none / dragon-horns / antlers |
| ears | none / fin-ears |
| neck | none / small-lion-mane |
| back | none / small-wings |
| tailTip | none / forked-tail-tip |

不同位置可以同时出现；同位置只能选一项。`mutationSelectionsFromList(['dragon-horns','antlers'])` 会抛出冲突错误，不能静默丢弃一个。`mutationSelectionsFromList([])` 返回所有异变位置为 `none`，适合普通无异变孵化。

`generateFelineCombination(seed)` 会对全部未指定位置独立均匀抽样，包括异变位置；它不是“默认无异变”。精确指定选项会覆盖相应抽样。均匀抽样只是当前组合候选的规则，尚未定义生产概率、收藏稀有度、蛋种主题、risk 或 mutationBonus 映射。孵化玩法需要这些规则时应另行确定版本化映射，不沿用旧版字段含义。

## 4. 完整存档身份与回放

原生规格必须完整保存：

```ts
interface FelineCombinationSpec {
  schemaVersion: 'feline-combination-v1'
  catalogVersion: '0.10.0-candidate.1'
  seed: string
  selections: FelineCombinationSelections
  rolls: Record<FelineCombinationSlot, number>
  locks: FelineCombinationSlot[]
}
```

原生 spec 是严格对象，不接受 `genome`、`rendererVersion`、`generatorVersion`、`visualSlots`、`themeId` 等旧字段。业务身份另放在孵化记录外层。示例定义的保存封装为：

```ts
interface StoredFelineVisual {
  kind: 'qmonster-feline-combination'
  spec: FelineCombinationSpec
  catalogSha256: string
  runtimeRevision: string
}
```

`catalogSha256` 与 `runtimeRevision` 绑定实际素材和运行实现，解决仅存 seed 或 candidate 目录名无法防止后续重绘变化的问题。恢复时调用 `hatchery.restore(savedVisual)`，解析已保存 spec 并按原始 selections 渲染；不要重新调用 generate 来猜出原选项。示例拒绝未知快照或目录哈希不匹配的存档。未来有多个运行版本时，先按保存的版本身份选择对应 bundle，再恢复。

图片是派生缓存。示例缓存键同时包含目录哈希、运行版本、尺寸、实际 MIME 和完整 spec 的 canonical JSON SHA-256；canonical JSON 对对象键排序，保留数组顺序。`hatchId`、蛋 ID、账户和时间等由孵化业务保存，不放入严格 spec，也不作为修改 seed 的隐式随机源。

## 5. 重掷与互斥行为

- `setFelineCombinationSelection(spec, slot, value)`：明确替换该位置；保留其重掷计数。手动修改允许替换锁定位置。
- `rerollFelineCombinationSlot(spec, slot)`：只推进该位置的计数并重掷；锁定时不改变选择或计数。
- `rerollFelineCombination(spec)`：仅重掷未锁定位置。
- `locks` 保存需要保护的位置。锁定列表不能重复；计数是非负安全整数。
- 重掷可能抽中原选项，不承诺每次视觉必变。

鳍耳与分叉尾的原部位移除、根部遮挡和固定定位由共享模板处理。孵化器不要自行追加尾尖、画嘴、清除耳朵或传入坐标补丁。

## 6. 图片与错误处理

渲染器将画布固定为 1254×1254。需要列表缩略图时，在完整渲染成功后另生成缩略缓存，并将其尺寸写入缓存身份；不要把原生尺寸伪报为旧版 1024/2048。

示例优先导出透明 WebP，仅在编码能力明确不支持 WebP 时回退 PNG；其他错误继续抛出。目录哈希、资源 SHA-256、PNG 格式/真实 alpha、解码尺寸或规格校验失败时，不能生成伪造 READY，也不能用旧橘猫或最新目录替代。每次渲染使用独立画布，业务层仍应按 hatchId 丢弃过期请求并保证保存幂等。

同源发布最直接。跨域资源需要允许浏览器 fetch 的 CORS；Blob URL 仅供当前页面预览，用完撤销，不作为永久存档。浏览器 Canvas 是当前实装环境，服务端渲染需要另做兼容适配。

## 7. 历史读档和版本边界

| 已存记录 | 处理方式 |
| --- | --- |
| `feline-combination-v1` + 当前快照身份 | 使用本指南示例及当前组合运行模块 |
| 原 `MonsterSpec` / v0.8 记录 | 使用原目录和旧渲染器，不转成组合 spec |
| v0.9 `schemaVersion=0.4.0` 的记录 | 使用其 release 身份、共享旧 release loader 与旧适配契约 |
| 未知、混合或缺失的版本身份 | 明确失败，由业务决定恢复策略 |

旧版完整说明已移至 [历史接入指南 v1.6](archive/qmonster-hatchery-integration-v1.6.md)，仅用于维护旧记录，其中的“默认新孵化 v0.8”不再作为本指南当前组合接入路径。

## 8. 已有验证与接入验收

当前组合的 864 个规格已实际渲染并做 JSON 回放像素比对。尾巴修复后，不使用分叉尾的 432 个结果保持原像素，使用分叉尾的 432 个结果已更新。尾巴衔接获得用户确认，证据见 [组合 QA](../qa/feline-combination-candidate.md)。

接入项目应检查：固定 seed/显式选项可重现、保存完整身份后恢复、同位置冲突报错、跨位置共存、缺图或哈希不符阻断成功、图片保存失败不标记 READY、旧记录继续按原版本回放。仓库的浏览器示例验证脚本为 `scripts/verify-feline-hatchery-example.mjs`。

在仓库根目录运行 `npx tsc -p docs/integration/examples/tsconfig.json` 检查示例类型。启动[仓库 README](../../README.md) 所列的 4183 开发服务后，运行 `node scripts/verify-feline-hatchery-example.mjs` 验证真实生成、JSON 回放和错误路径；可用 `QMONSTER_VERIFY_URL` 指定其他服务地址。此脚本不会替外部业务实现持久化事务或旧版存档迁移。

本文更新接入文档与示例，不表示外部孵化项目已部署，也不替代旧发布系统的正式版本切换。
