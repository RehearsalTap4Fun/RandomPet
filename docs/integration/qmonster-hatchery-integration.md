# QMonster 生成器 × 怪奇生物孵化器对接指南

> 文档版本：1.4
> 最低生成器基线：`feature/qmonster-v0.1` / `3b93fc385779c8ee44ae8ba190fc3c484736ee0f`
> 新孵化默认目录版本：`0.6.0`
> 新孵化默认渲染器版本：`0.6.0`
> 更新日期：2026-09-07

## 1. 目标与结论

孵化器在用户触发“孵化”时，直接调用 QMonster 的生成与渲染模块：

```text
孵化请求
  → generateMonster（生成 MonsterSpec）
  → renderMonster（绘制透明画布）
  → exportCanvas（编码 WebP，必要时回退 PNG）
  → 保存 MonsterSpec + 图片缓存
```

对接后的数据原则：

1. `MonsterSpec` 是生物的权威数据，决定种子、主题、全部特征和版本。
2. WebP/PNG 是由 `MonsterSpec` 派生的缓存，可以随时重新生成。
3. 恢复存档时必须使用 `MonsterSpec.catalogVersion` 指定的目录，不得自动换成最新目录。
4. 只有生成和渲染均无错误时，孵化结果才能进入 `READY` 状态。
5. 新生成的 `MonsterSpec` 必须把 `genome`、`visualSlots` 和 v0.6 的 Bundle 身份作为同一份身份数据一起持久化。
6. 新孵化默认加载 `0.6.0`；旧记录继续按其存储的 `catalogVersion` 与 `rendererVersion` 精确分派。

本文面向浏览器端孵化器。当前提供的“怪奇生物孵化器 (Copy).html”是保存后的页面外壳，其引用的 `_files/saved_resource.html` 没有随文件保存，因此本文按“孵化动作”定义稳定接入边界，不引用该页面中不可恢复的函数名或 DOM ID。

## 2. 当前能力与接入前置条件

### 2.1 可直接复用的模块

| 包 | 作用 | 主要接口 |
| --- | --- | --- |
| `@qmonster/generator-core` | 确定性生成、数据校验 | `generateMonster`、`parseMonsterSpec`、`validateMonsterSpecAgainstCatalog` |
| `@qmonster/renderer-canvas` | Canvas 渲染与图片编码 | `renderMonster`、`exportCanvas`、`detectExportCapabilities` |
| `@qmonster/asset-catalog` | 目录加载与版本注册 | `CatalogRegistry` |

### 2.2 当前分发限制

上述三个包目前均为 `private` workspace 包，不是可从公共 npm 仓库安装的 SDK；目录 JSON 也没有作为包子路径公开导出。因此正式接入前需要选择以下一种工程方式：

- 推荐：把孵化器源码加入同一 npm workspace，并直接依赖三个 workspace 包；
- 或者：由 QMonster 项目额外构建一个可分发的浏览器 bundle，再由孵化器依赖该 bundle。

不要直接修改保存后的 HTML 外壳。应先恢复孵化器源码项目，或新建一个可构建的 Vite/React 项目承载孵化器。

### 2.3 需要随孵化器发布的文件

孵化器构建产物至少需要包含：

```text
packages/asset-catalog/catalog/v0.6.0/catalog.json
packages/asset-catalog/assets/v0.6.0/**

# 只要仍有旧存档，就同时保留其精确版本：
packages/asset-catalog/catalog/v0.5.0/catalog.json
packages/asset-catalog/assets/v0.5.0/**
packages/asset-catalog/catalog/v0.4.0/catalog.json
packages/asset-catalog/assets/v0.4.0/**
packages/asset-catalog/catalog/v0.3.0/catalog.json
packages/asset-catalog/assets/v0.3.0/**
```

推荐发布到同源、不可变的版本目录，例如：

```text
/qmonster/catalog/v0.6.0/catalog.json
/qmonster/assets/v0.6.0/**

# 旧记录恢复路径，不得被 0.6.0 覆盖：
/qmonster/catalog/v0.5.0/catalog.json
/qmonster/assets/v0.5.0/**
/qmonster/catalog/v0.4.0/catalog.json
/qmonster/assets/v0.4.0/**
/qmonster/catalog/v0.3.0/catalog.json
/qmonster/assets/v0.3.0/**
```

每个版本的目录 JSON 和资源目录必须成套、不可变地部署，不得只替换其中一部分，也不得让新版本覆盖旧版本路径。

## 3. 对接契约

### 3.1 孵化请求

生成器现有输入类型为 `GenerationRequest`：

```ts
interface GenerationRequest {
  seed: string
  themeId: 'deep-sea' | 'fungal' | 'shadow'
  mode: 'normal' | 'mutation' | 'aberration'
  slotRolls?: Partial<Record<VisualSlotId, number>>
  lockedSelections?: Partial<Record<VisualSlotId, string>>
}
```

孵化器建议只对外暴露以下业务参数：

```ts
interface HatchMonsterRequest {
  hatchId: string
  seed: string
  themeId: 'deep-sea' | 'fungal' | 'shadow'
  mode: 'normal' | 'mutation' | 'aberration'
  archetypeId: 'feline'
  lockedSelections?: Partial<Record<VisualSlotId, string>>
  imageSize?: 1024 | 2048
}
```

字段约定：

- `hatchId`：孵化器中的一次孵化实例 ID，用于幂等和存档索引，不参与 QMonster 随机计算。
- `seed`：必须由孵化器或服务端稳定提供。同一请求、同一目录版本应生成同一 `MonsterSpec`。
- `themeId`：可由蛋种、栖息地或用户选择映射。
- `mode`：普通孵化使用 `normal`；变异玩法使用 `mutation` 或 `aberration`。
- `lockedSelections`：仅在玩法明确指定某个部位时传入；普通随机孵化应省略。
- `imageSize`：列表卡片和普通展示使用 `1024`，需要高分辨率导出时使用 `2048`。
- `slotRolls`：属于底层确定性数据，普通孵化器不应自行构造。

### 3.2 孵化结果

建议孵化器适配层统一返回：

```ts
interface HatchMonsterResult {
  hatchId: string
  status: 'READY'
  spec: MonsterSpec
  diagnostics: Diagnostic[]
  image: {
    blob: Blob
    mime: 'image/webp' | 'image/png'
    width: 1024 | 2048
    height: 1024 | 2048
    cacheKey: string
  }
}
```

`0.4.0` 新增的非脸部强视觉预算只影响 `surfaceMaterial`、`pattern`、`effect` 的自动选择：三者最多选择一个强特征。它不会给 `HatchMonsterResult` 增加字段，也不会改变 14 个 `visualSlots`、可选 `genome` 或 `P/H1/H2/H3` 的公共结构。

`0.5.0` 保留上述预算，并把新孵化限制为单头、长条尾巴：目录中只允许 `tail_none`、`tail_cat_long`、`tail_dog_long`；`mutation_double_head` 不在 v0.5 目录中。孵化器不得将 v0.4 的尾巴或双头 `partId` / modifier ID 锁定到 v0.5 请求中；对这类锁定应返回目录校验错误，而不是降级映射。

适配层遇到错误时应抛出结构化错误，不返回伪造的 `READY` 结果：

```ts
interface HatchMonsterError {
  stage: 'CATALOG' | 'GENERATE' | 'RENDER' | 'EXPORT' | 'PERSIST'
  diagnostics: Diagnostic[]
  retryable: boolean
}
```

### 3.3 基因与孵化器适配契约

新生成的生物包含一个确定性的四层基因组。公共 TypeScript 契约为：

```ts
export const GENOME_VERSION = '0.1.0' as const
export const GENOME_LAYERS = ['P', 'H1', 'H2', 'H3'] as const
export type GenomeLayer = typeof GENOME_LAYERS[number]

export interface SlotGenes {
  P: string
  H1: string
  H2: string
  H3: string
}

export interface MonsterGenome {
  genomeVersion: typeof GENOME_VERSION
  genes: Record<VisualSlotId, SlotGenes>
}
```

其中 `P` 是当前表现出来的显性层，`H1`、`H2`、`H3` 是持久化但不参与本版本渲染的隐藏层。每一层都覆盖全部 14 个视觉槽位，基因值是目录中稳定的 `partId`。相同请求与相同目录必须得到字节等价的 genome；隐藏层使用彼此隔离的确定性随机域，不得消耗或改变 `P` 的随机流。

适配器输出的扩展字段为：

```ts
visualExtension: Pick<
  MonsterSpec,
  'schemaVersion' | 'catalogVersion' | 'visualSlots' | 'genome'
>
```

适配器必须深拷贝 `visualSlots` 和可选的 `genome`，使孵化器记录与输入规格之间没有可变对象别名。新生成记录携带 `genome`；合法旧版（legacy）规格没有基因记录时，`visualExtension` 必须完全省略 `genome` 键，不能写入 `undefined` 占位或补造隐藏基因。

必须始终满足以下显性一致性约束：

```ts
genome.genes[slotId].P === visualSlots[slotId].partId
```

存在但无效的 genome（包括版本不支持、槽位或层缺失、部件不存在、部件槽位错误、层不兼容或 `P` 不一致）会阻断 `READY`，导入和适配过程均不得静默修复、替换或删除它。

### 3.4 缓存键

图片缓存键必须绑定完整规格和渲染参数：

```text
qmonster:{catalogVersion}:{rendererVersion}:{width}:{groundShadow}:{specSha256}
```

`specSha256` 应对完整 `MonsterSpec` 的 canonical JSON 计算 SHA-256：对象键递归按键名排序，数组保持原顺序，字符串按 UTF-8 编码；可选字段缺失时保持缺失，不要自行写入 `undefined` 或 `null`。canonical 输入必须包含存在的 `genome` 及其 `genomeVersion`、全部槽位和 `P/H1/H2/H3`，因此两个表型相同但遗传身份不同的生物不能命中同一陈旧图片缓存。不能只用 `seed` 作为缓存键，因为相同 seed 在不同主题、模式、锁定特征或目录版本下可能产生不同结果。

## 4. 推荐适配层

孵化器不要在按钮事件中散落调用三个底层包。建议增加一个单一职责模块：

```text
src/qmonster/
  catalog.ts          # 加载、解析并缓存指定版本目录
  image-resolver.ts   # 把目录中的资源路径解析为 CanvasImageSource
  hatch-adapter.ts    # generate → render → export 的唯一入口
  persistence.ts      # MonsterSpec 和图片缓存的存取
```

### 4.1 目录加载

目录必须先通过 `parseCatalog`，解析失败时禁止继续孵化。新孵化明确调用 `loadCatalogV050`；旧版本加载器只用于恢复其原始版本的记录：

```ts
import {
  parseCatalog,
  type Catalog,
  type MonsterSpec,
} from '@qmonster/generator-core'

async function loadCatalogAt(url: string): Promise<Catalog> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`CATALOG_HTTP_${response.status}`)

  const parsed = parseCatalog(await response.json())
  if (!parsed.ok) {
    throw new Error(`CATALOG_INVALID:${parsed.diagnostics.map(item => item.code).join(',')}`)
  }
  return parsed.value
}

export function loadCatalogV050(): Promise<Catalog> {
  return loadCatalogAt('/qmonster/catalog/v0.5.0/catalog.json')
}

export function loadCatalogV040(): Promise<Catalog> {
  return loadCatalogAt('/qmonster/catalog/v0.4.0/catalog.json')
}

export function loadCatalogV030(): Promise<Catalog> {
  return loadCatalogAt('/qmonster/catalog/v0.3.0/catalog.json')
}

const catalogLoaders: Readonly<Record<string, () => Promise<Catalog>>> = {
  '0.3.0': loadCatalogV030,
  '0.4.0': loadCatalogV040,
  '0.5.0': loadCatalogV050,
}

export function loadCatalogForNewHatch(): Promise<Catalog> {
  return loadCatalogV050()
}

export function loadCatalogForStoredSpec(
  spec: Pick<MonsterSpec, 'catalogVersion'>,
): Promise<Catalog> {
  const loader = catalogLoaders[spec.catalogVersion]
  if (loader === undefined) throw new Error(`CATALOG_UNSUPPORTED_${spec.catalogVersion}`)
  return loader()
}
```

生产环境应按精确版本缓存成功加载的 `Catalog`；目录 URL 应带版本且使用不可变缓存策略。若仍需恢复 `0.1.0` 或 `0.2.0` 记录，应以同样方式注册并保留其精确目录与渲染器组合，不能回退到 `0.3.0`、`0.4.0` 或 `0.5.0`。

### 4.2 浏览器图片解析器

`renderMonster` 不直接访问网络，而是依赖 `ImageResolver`。孵化器需要提供资源解析器：

```ts
import type { Catalog } from '@qmonster/generator-core'
import type { ImageResolver } from '@qmonster/renderer-canvas'

const VERSIONED_ASSET_PREFIX = /^assets\/v([^/]+)\//

export function normalizeCatalogAssetPath(
  catalogVersion: string,
  assetPath: string,
): string {
  const portablePath = assetPath.replaceAll('\\', '/')
  const versionedPrefix = portablePath.match(VERSIONED_ASSET_PREFIX)
  if (versionedPrefix !== null && versionedPrefix[1] !== catalogVersion) {
    throw new Error(`ASSET_VERSION_MISMATCH:${catalogVersion}:${versionedPrefix[1]}`)
  }

  const exactVersionPrefix = `assets/v${catalogVersion}/`
  const relativePath = portablePath.startsWith(exactVersionPrefix)
    ? portablePath.slice(exactVersionPrefix.length)
    : portablePath
  const segments = relativePath.split('/')
  if (
    relativePath.length === 0
    || relativePath.startsWith('/')
    || segments.some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`ASSET_PATH_INVALID:${assetPath}`)
  }
  return relativePath
}

export class CatalogImageResolverCache {
  private readonly cache = new Map<string, Promise<ImageBitmap>>()

  public constructor(private readonly assetBaseUrl: URL) {}

  public forCatalog(catalogVersion: string): ImageResolver {
    return {
      resolve: originalAssetPath => {
        const assetPath = normalizeCatalogAssetPath(catalogVersion, originalAssetPath)
        const key = `${catalogVersion}\u0000${assetPath}`
        const cached = this.cache.get(key)
        if (cached !== undefined) return cached

        const pending = this.load(catalogVersion, assetPath).catch(error => {
          if (this.cache.get(key) === pending) this.cache.delete(key)
          throw error
        })
        this.cache.set(key, pending)
        return pending
      },
    }
  }

  private async load(catalogVersion: string, assetPath: string): Promise<ImageBitmap> {
    const versionRoot = new URL(`v${catalogVersion}/`, this.assetBaseUrl)
    const url = new URL(assetPath, versionRoot)
    if (url.origin !== versionRoot.origin || !url.pathname.startsWith(versionRoot.pathname)) {
      throw new Error(`ASSET_PATH_INVALID:${assetPath}`)
    }
    const response = await fetch(url)
    if (!response.ok) throw new Error(`ASSET_HTTP_${response.status}:${assetPath}`)
    return createImageBitmap(await response.blob())
  }
}

export const qmonsterImageResolvers = new CatalogImageResolverCache(
  new URL('/qmonster/assets/', window.location.origin),
)

export function imageResolverForCatalog(
  catalog: Pick<Catalog, 'version'>,
): ImageResolver {
  return qmonsterImageResolvers.forCatalog(catalog.version)
}
```

要求：

- `/qmonster/assets/` 必须以 `/` 结尾；`forCatalog('0.5.0')` 的资源根是 `/qmonster/assets/v0.5.0/`，旧记录分别解析到其对应的 `v0.4.0/` 或 `v0.3.0/` 根；
- 调用方必须传入实际加载的 `catalog.version`。版本同时参与路径标准化、URL 解析和缓存键，不能让不同版本的相同相对路径共享缓存；
- `parts/example.webp` 与 `assets/v0.5.0/parts/example.webp` 在 `0.5.0` 下会标准化为同一相对路径，不会重复添加 `assets/v0.5.0/`；带有其他版本前缀、绝对路径或目录穿越片段的路径会被拒绝；
- 推荐与孵化器同源部署，避免额外的 CORS 配置；
- 失败的 Promise 不会永久留在缓存中，下一次请求可以重新加载资源；
- 目录中使用的资源路径是项目相对路径，存档中不要保存解析后的绝对 URL。

### 4.3 孵化入口

以下代码展示现有真实 API 的组合方式。`makeHatchError`、`makeQMonsterCacheKey` 是孵化器适配层需要实现的业务辅助函数：

```ts
import {
  generateMonster,
  type Catalog,
  type Diagnostic,
  type MonsterSpec,
} from '@qmonster/generator-core'
import {
  CanvasExportError,
  exportCanvas,
  renderMonster,
  type ImageResolver,
} from '@qmonster/renderer-canvas'

const hasError = (diagnostics: Diagnostic[]) =>
  diagnostics.some(item => item.severity === 'error')

export async function hatchMonster(
  request: HatchMonsterRequest,
  catalog: Catalog,
  resolver: ImageResolver,
): Promise<HatchMonsterResult> {
  const generated = generateMonster({
    seed: request.seed,
    themeId: request.themeId,
    mode: request.mode,
    archetypeId: request.archetypeId,
    lockedSelections: request.lockedSelections,
  }, catalog)

  if (generated.blocked || hasError(generated.diagnostics)) {
    throw makeHatchError('GENERATE', generated.diagnostics, false)
  }

  const size = request.imageSize ?? 1024
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context === null) {
    throw makeHatchError('RENDER', [], true)
  }

  let rendered
  try {
    rendered = await renderMonster(
      context,
      generated.spec,
      catalog,
      resolver,
      {
        width: size,
        height: size,
        includeGroundShadow: false,
        applyPaletteMasks: true,
      },
    )
  } catch {
    throw makeHatchError('RENDER', [], true)
  }

  const diagnostics = [...generated.diagnostics, ...rendered.diagnostics]
  if (hasError(diagnostics)) {
    throw makeHatchError('RENDER', diagnostics, true)
  }

  let blob: Blob
  let mime: 'image/webp' | 'image/png' = 'image/webp'
  try {
    blob = await exportCanvas(canvas, mime)
  } catch (error) {
    if (!(error instanceof CanvasExportError)
      || error.code !== 'WEBP_EXPORT_UNSUPPORTED') {
      throw makeHatchError('EXPORT', [], true)
    }
    mime = 'image/png'
    try {
      blob = await exportCanvas(canvas, mime)
    } catch {
      throw makeHatchError('EXPORT', [], true)
    }
  }

  return {
    hatchId: request.hatchId,
    status: 'READY',
    spec: generated.spec,
    diagnostics,
    image: {
      blob,
      mime,
      width: size,
      height: size,
      cacheKey: await makeQMonsterCacheKey(generated.spec, size, false),
    },
  }
}
```

说明：

- `includeGroundShadow: false` 适合把透明生物放进孵化器场景；独立立绘可设为 `true`。
- `applyPaletteMasks: true` 是正式彩色渲染路径。
- 业务代码不得传入 `connectorMetricProjection`、`bridgeRoleProjection` 或 `diagnosticScope`；这些是历史审计专用参数。
- 同一页面并发孵化时，每次请求应带唯一 `hatchId`。UI 还应使用 request ID 丢弃已过期的异步结果，防止较慢的旧请求覆盖新结果。

## 5. 孵化器数据映射

### 5.1 玩法到生成参数

| 孵化器概念 | QMonster 字段 | 建议 |
| --- | --- | --- |
| 孵化实例 | `hatchId` | 使用服务端订单 ID、蛋 ID 或本地 UUID |
| 随机种子 | `seed` | 服务端下发时最稳定；离线模式可用持久化 UUID |
| 深海蛋 | `themeId: 'deep-sea'` | 蓝青色、珊瑚和深海意象 |
| 菌菇蛋 | `themeId: 'fungal'` | 绿色、橙色和孢子意象 |
| 暗影蛋 | `themeId: 'shadow'` | 紫色和暗影意象 |
| 普通孵化 | `mode: 'normal'` | 默认模式 |
| 变异孵化 | `mode: 'mutation'` | 应在 UI 中明确提示 |
| 怪诞孵化 | `mode: 'aberration'` | 用于更高变异度玩法 |
| v0.6 外观类型 | `archetypeId: 'feline'` | v0.6 请求必须显式传入 `feline`；`canine` 与 `lagomorph` 被拒绝。旧版请求省略该字段 |
| 指定遗传特征 | `lockedSelections` | 只传允许继承的槽位及合法 part ID |

不要根据中文展示名回填特征；展示名可能本地化。持久化和业务判断始终使用 `partId`、`themeId`、`rigId` 等稳定 ID。

### 5.2 可用于孵化结果展示的数据

`MonsterSpec` 中可直接读取：

- `seed`、`themeId`、`palette`；
- 14 个 `visualSlots` 的 `partId` 和 `rigId`；
- 新生成记录中 14 个槽位的 `genome.genes`，每个槽位包含 `P/H1/H2/H3`；
- 8 个 `semanticTraits`；
- `mutation` 与 `aberrations`；
- `schemaVersion`、`catalogVersion`、`rendererVersion`。
- 对于 v0.6，`archetypeId: 'feline'` 与 `anatomyBundleId`；两者是恢复完整外观所必需的身份数据。

展示具体中文名称和描述时，应通过当前版本 `Catalog` 用 ID 查找 `displayName`、`flavorText`，不要把显示文案重复写进 `MonsterSpec`。

## 6. 持久化与恢复

### 6.1 推荐记录结构

```ts
interface HatchedMonsterRecord {
  id: string
  status: 'READY' | 'RENDER_PENDING' | 'UNSUPPORTED_VERSION'
  createdAt: string
  updatedAt: string
  spec: MonsterSpec
  specSha256: string
  renderCache?: {
    cacheKey: string
    blobKey: string
    mime: 'image/webp' | 'image/png'
    width: 1024 | 2048
    height: 1024 | 2048
  }
}
```

推荐存储方式：

- `MonsterSpec` 和索引数据：业务数据库或 IndexedDB；
- 图片 Blob：对象存储、Cache Storage 或 IndexedDB；
- 不推荐：把 Base64 图片放进 `localStorage`，容易超过容量限制并阻塞主线程。

新生成记录必须原子持久化完整 `MonsterSpec`，也就是把 `genome` 与解析后的表现型 `visualSlots` 一起保存；不能只保存其中之一。缺少 `genome` 仅对历史遗留（legacy）规格有效，这类记录应继续保持无基因状态，普通读取、编辑或重新渲染都不得推测并补齐 `H1/H2/H3`。

### 6.1.1 v0.6 Bundle 身份与历史记录

v0.6 孵化记录必须原样保存以下精确元组：

```text
(schemaVersion, catalogVersion, rendererVersion, archetypeId, anatomyBundleId)
= ('0.2.0', '0.6.0', '0.6.0', 'feline', <catalog bundle ID>)
```

`anatomyBundleId` 表示一张完整、连续的猫科外观（躯干、头部、四肢、尾巴和额外附肢），不是可由单个结构槽位重新推断的装饰 ID。`visualSlots` 仍保存该 Bundle 派生的结构选择和局部特征；眼睛、口部、口腔细节、头部附饰、材质、花纹、配色与效果只在该 Bundle 允许的局部 trait pool 内解释。

旧版本记录可以缺少 `archetypeId`、`anatomyBundleId` 和 `genome`，并且必须以只读历史模式恢复：不得从旧结构槽位猜测 Bundle，不得补写新字段，也不得把它们迁移成 v0.6 记录。只有显式重新生成才会产生新的 v0.6 身份元组。

### 6.2 两阶段保存

1. 生成包含 `visualSlots` 与 `genome` 的完整 `MonsterSpec`，校验显性一致性后按 canonical JSON 计算 `specSha256`；
2. 渲染并编码图片；
3. 先写入图片 Blob，再原子更新记录为 `READY`；
4. 如果图片写入失败，保留 `MonsterSpec` 并标记 `RENDER_PENDING`，下次可重试渲染；
5. 不要因为渲染重试而重新调用 `generateMonster`，否则业务代码可能错误地换 seed 或参数。

### 6.3 从存档恢复

```text
读取 MonsterSpec
  → parseMonsterSpec
  → CatalogRegistry.load(spec.catalogVersion)
  → validateMonsterSpecAgainstCatalog
  → 命中图片缓存：直接展示
  → 未命中：按原 rendererVersion 重新渲染
```

恢复规则：

- 缺少对应 `catalogVersion`：标记 `UNSUPPORTED_VERSION`，保留原始记录，不得用新目录猜测替换；
- 规格校验含错误：隔离该记录并上报，不进入正常展示；
- v0.6 缺少 Bundle、Bundle 不在已加载目录中，或 Bundle 与猫科/版本不匹配：拒绝该记录且不创建部分孵化结果；未知 Bundle 会返回 `SPEC_ANATOMY_BUNDLE_UNKNOWN`；
- v0.6 请求的 `archetype` 不是 `feline`：适配器返回 `ADAPTER_ARCHETYPE_UNSUPPORTED`；缺少或非法的存档 archetype 同样阻断恢复；
- genome 存在时必须验证 `genomeVersion`、完整的 `P/H1/H2/H3`、目录部件和层兼容性，以及 `genome.genes[slotId].P === visualSlots[slotId].partId`；任一错误都阻断 `READY`，不得静默修复；
- genome 缺失只作为旧版记录处理；恢复和导入不得为其合成隐藏层。若业务明确把旧版生物“重新生成”为一只新生物，新结果才按正常生成流程获得 genome；
- 只有警告：可以展示，但应记录遥测；
- 图片缓存损坏：删除缓存后按原规格重绘；
- 升级目录时保留旧目录，直到所有旧存档都完成显式迁移。

## 7. 状态、错误与重试

| 阶段 | 典型失败 | 是否重试 | 处理 |
| --- | --- | --- | --- |
| `CATALOG` | 目录不存在、JSON 无效 | 网络错误可重试 | 禁止开始孵化 |
| `GENERATE` | 非法锁定特征、无合法组合、阻断诊断 | 通常不可重试 | 修正请求参数 |
| `RENDER` | 资源加载失败、Canvas 不可用、结构诊断错误 | 资源错误可重试 | 保留规格，进入 `RENDER_PENDING` |
| `EXPORT` | WebP 不支持 | 自动降级 | 回退透明 PNG |
| `PERSIST` | 存储空间不足、网络失败 | 可重试 | 不标记 `READY` |

诊断处理约定：

- `severity: 'error'`：阻断当前阶段；
- `severity: 'warning'`：允许继续，但写入日志或遥测；
- 不要只检查异常。`generateMonster` 和 `renderMonster` 都可能通过返回的 `diagnostics` 报告业务错误。
- `ADAPTER_ARCHETYPE_UNSUPPORTED`、`SPEC_ANATOMY_BUNDLE_UNKNOWN` 以及 v0.6 的缺失 Bundle/archetype 诊断都是阻断错误；不得保存部分 `visualExtension` 或降级到旧结构槽位。

建议遥测字段：`hatchId`、`seed`、`catalogVersion`、`rendererVersion`、失败阶段、诊断 code。不要上传完整图片或用户隐私数据作为普通错误日志。

## 8. 版本与升级策略

### 8.1 版本绑定

`MonsterSpec` 同时记录：

- `schemaVersion`：数据结构版本；
- `catalogVersion`：部件、兼容性和资源版本；
- `rendererVersion`：合成与渲染算法版本。

v0.6 还记录 `archetypeId` 与 `anatomyBundleId`。五个字段必须作为一个整体比较、存储和恢复；不能用同名 Bundle、最新目录或单个 `visualSlots` 替代其中任一字段。

存在 genome 时还记录独立的 `genomeVersion`。v0.6 Bundle 规格使用 `MonsterSpec.schemaVersion: '0.2.0'`；`MonsterGenome.genomeVersion` 仍固定为 `0.1.0`。两者版本职责不同，不得相互替代或在读档时覆写。

五个身份字段必须作为一个兼容性组合处理。孵化器不得在读档时直接覆写其中任一字段。

### 8.2 兼容性表

| `catalogVersion` | `rendererVersion` | 用途 | 加载行为 |
| --- | --- | --- | --- |
| `0.1.0` | `0.1.0` | 更早的旧记录恢复 | 仅在存在该版本记录时注册并保留精确目录与渲染器 |
| `0.2.0` | `0.2.0` | 更早的旧记录恢复 | 仅在存在该版本记录时注册并保留精确目录与渲染器 |
| `0.3.0` | `0.3.0` | 旧记录恢复 | 调用 `loadCatalogV030`，按存储版本重绘 |
| `0.4.0` | `0.4.0` | 旧记录恢复 | 调用 `loadCatalogV040`，按存储版本重绘 |
| `0.5.0` | `0.5.0` | 旧记录恢复 | 调用 `loadCatalogV050`；仅使用单头和 `tail_none` / `tail_cat_long` / `tail_dog_long` |
| `0.6.0` | `0.6.0` | 新孵化默认；Bundle 记录恢复 | 仅接受 `schemaVersion: '0.2.0'`、`archetypeId: 'feline'` 和目录内的 `anatomyBundleId` |

只支持同版本的精确组合。`0.3.0`、`0.4.0`、`0.5.0`、`0.6.0` 的目录与渲染器不得交叉使用；未注册的版本应进入 `UNSUPPORTED_VERSION`，不能静默回退。

### 8.3 推荐升级流程

1. 新旧目录同时部署；
2. 新孵化默认使用新目录，旧记录仍按旧目录渲染；
3. 对旧 `MonsterSpec` 执行离线迁移演练并生成视觉对比；
4. 只有通过人工视觉验收后才写入新版本规格；
5. 旧规格和旧图片保留回滚窗口；
6. 不允许仅通过修改 `catalogVersion` 或 `rendererVersion` 声称迁移完成。

## 9. 与孵化器 UI 的接入顺序

推荐事件流程：

```text
用户点击孵化
  → UI 锁定按钮并创建 hatchId
  → 获取/确定 seed、themeId、mode
  → 调用 hatchMonster
  → 展示孵化动画
  → READY：动画结束时替换为透明生物图
  → 保存 MonsterSpec 和图片缓存
  → 解锁后续分享、命名、收藏操作
```

注意：

- 动画时长和生成耗时解耦；生成提前完成时可以等待动画节点，生成较慢时展示明确加载状态；
- 连续点击必须幂等。同一个 `hatchId` 不得创建两个不同 `MonsterSpec`；
- 页面卸载或请求过期后，应丢弃 UI 回调，但可根据产品规则继续后台持久化；
- 列表页优先读取图片缓存，详情页需要查看特征时再加载目录和解析 `MonsterSpec`。

## 10. 联调步骤

1. 恢复孵化器源码并建立可重复构建环境；
2. 以 workspace 依赖接入三个 QMonster 包；
3. 发布 v0.5.0 目录 JSON 和资产目录，并为现有 v0.4.0 / v0.3.0 记录保留原目录与资产；
4. 实现新孵化默认使用的 `loadCatalogV050`、旧记录使用的 `loadCatalogV040` / `loadCatalogV030` 和 `BrowserImageResolver`；
5. 实现单一入口 `hatchMonster`；
6. 接入孵化按钮，但暂不写持久化；
7. 用固定 seed 对照 QMonster 工作台的输出；
8. 接入 `MonsterSpec` 与 Blob 的两阶段保存；
9. 验证刷新页面后的缓存命中与缺失缓存重绘；
10. 验证 WebP 不支持时回退 PNG；
11. 验证 v0.4.0 / v0.3.0 旧记录精确恢复、旧版本目录缺失、资源 404、v0.5 非法旧尾巴或双头锁定特征，以及重复点击；
12. 完成视觉验收后再开放随机孵化。

## 11. 验收清单

### 11.1 功能验收

- [ ] 同一 seed、主题、模式和目录版本重复孵化，得到相同 `MonsterSpec`；
- [ ] 新生成记录同时保存 `genome` 与 `visualSlots`，且相同请求和目录得到字节等价的四层 genome；
- [ ] 每个槽位都满足 `genome.genes[slotId].P === visualSlots[slotId].partId`，并包含完整 `P/H1/H2/H3`；
- [ ] 合法旧版记录省略 genome，读档、导入和普通编辑均不会合成隐藏基因；
- [ ] 存在但无效的 genome 会阻断 `READY`，且原始导入数据不被静默修复；
- [ ] 固定规格重复渲染，输出像素与正式接受集一致；
- [ ] 14 个视觉槽位均来自当前目录中的合法 part ID；
- [ ] 双足生物的头、躯干、四肢连接无明显断裂或错误遮挡；
- [ ] `blocked === true` 或存在 error 诊断时不创建 `READY` 记录；
- [ ] WebP 编码失败时自动生成透明 PNG；
- [ ] 页面刷新后可从 `MonsterSpec` 恢复同一只生物；
- [ ] 删除图片缓存后可以按原规格重绘；
- [ ] 重复点击不会让旧请求覆盖新结果；
- [ ] 缺少旧目录时保留记录并显示版本不支持状态。
- [ ] 新孵化固定使用 `0.5.0`；v0.4.0、v0.3.0 旧记录仍按存储的精确目录和渲染器恢复。
- [ ] v0.5 新生成只出现一个 `headShape`，且尾巴仅为 `tail_none`、`tail_cat_long` 或 `tail_dog_long`。

### 11.2 工程验收

- [ ] QMonster 包版本和资源目录版本被锁定；
- [ ] 生产资源使用同源或正确的 CORS 配置；
- [ ] 目录和资产发布路径不可变；
- [ ] 不把 Base64 图片写入 `localStorage`；
- [ ] 错误日志包含诊断 code，但不包含不必要的用户数据；
- [ ] 孵化器 CI 包含固定 seed、版本恢复、WebP 回退和资源缺失测试。
- [ ] canonical `specSha256` 覆盖完整 genome，遗传身份不同的规格不会共享陈旧图片缓存。

### 11.3 建议的首批联调样本

使用已人工批准的确定性样本：

- `2026082101` 至 `2026082120`；
- `qmonster-v0.1-first-hatch`。

正式视觉基准位于：

```text
packages/asset-catalog/review/v0.3.0/full-composite-manifest.json
packages/asset-catalog/review/v0.3.0/full-composite-contact-sheet.png
packages/asset-catalog/review/v0.3.0/full-composite-acceptance.json
```

## 12. 常见问题

### 为什么不能只存图片？

图片无法恢复部件 ID、语义特征、变异信息和版本，也不能可靠支持换尺寸重绘。图片应视为缓存，`MonsterSpec` 才是生物身份。

### 为什么不能只存 seed？

seed 必须与主题、模式、锁定特征、目录版本和生成算法共同解释。只存 seed 无法防止升级后生成另一只生物。

### 可以把生成器页面嵌进 iframe 吗？

可以，但本方案已经确定采用模块直调。模块直调的数据契约更清楚，也更方便持久化、测试和错误处理。

### 可以在服务端渲染吗？

当前正式路径使用浏览器 `CanvasRenderingContext2D`、`CanvasImageSource` 和浏览器图片编码能力。服务端渲染需要额外的 Canvas 兼容层，不属于本次对接范围。

### 孵化器能直接引用保存后的 HTML 吗？

不建议。当前保存文件缺少其 iframe 内部资源，而且私有 workspace 包也不能通过普通 `<script>` 标签直接使用。应恢复源码并参与构建，或先为生成器增加正式浏览器 bundle。

## 13. 本次文档不包含的工作

本指南只定义接入方式，不包含以下实现：

- 发布公共 npm SDK；
- 新增一站式 `hatchMonster` 包；
- 修改孵化器源码或 UI；
- 服务端渲染；
- 旧孵化数据迁移；
- 新主题、新部件或新生成规则。

如果后续开始代码接入，建议先完成“恢复孵化器源码 + workspace 依赖 + 资源发布”三个前置步骤，再实现本文第 4 节的适配层。
