# QMonster × 孵化项目接入指南

文档版本：3.0。更新日期：2026-09-15。工程根目录为 `C:/Project/QMonsterCreator`，所有运行、安装和构建操作从该目录开始。

## 工程与发布入口

工作台入口为 `apps/creator-web/index.html`。运行 `npm ci`、`npm run dev` 后访问 `http://127.0.0.1:4184/`。当前实现支持 6 花纹 × 3 完整表情 × 48 异变组合，共 864 种。

`npm run build` 生成两个独立交付目录：

| 目录 | 用途 |
| --- | --- |
| `dist/creator/` | 工作台网站，发布此目录即可运行 |
| `dist/hatchery/` | 孵化 SDK：`qmonster.js`、`snapshot.json`、目录 JSON 和 39 张 PNG |

源码包均为 private workspace 包，版本为 `0.10.0`。同仓库项目可直接 import `@qmonster/incubator-adapter`；独立孵化项目使用 `dist/hatchery/qmonster.js`，无需访问源码或工作树，也不需要旧素材库。

目录采用正式命名 `packages/asset-catalog/catalog/v0.10.0/` 与 `assets/v0.10.0/`。**为保持已存规格和 seed 结果不变，线上的数据字段 `spec.catalogVersion` 暂保留原值 `0.10.0-candidate.1`**，`spec.schemaVersion` 保持 `feline-combination-v1`。这是协议兼容标识，与包版本、文件目录名分开管理；不要自行替换存档中的字符串。

本工程使用[精确快照](feline-combination-snapshot.json)选择资源与运行实现，不读取旧 v0.9 active 指针。历史素材的人工批准范围保持原记录；目录迁移不扩大批准范围。

## 独立孵化项目接入

将整个 `dist/hatchery/` 发布至不可变的 `/qmonster/<runtimeRevision>/` 目录，保留内部层级：

```text
/qmonster/<runtimeRevision>/
├─ qmonster.js
├─ snapshot.json
└─ packages/asset-catalog/
   ├─ catalog/v0.10.0/catalog.json
   └─ assets/v0.10.0/*.png
```

部署时将下例 `releaseBase` 替换为已发布版本的固定地址；不要从用户存档中读取可任意替换的代码 URL。

```js
const releaseBase = new URL('/qmonster/固定运行版本/', location.origin)
const { createFelineHatchery, mutationSelectionsFromList } =
  await import(new URL('qmonster.js', releaseBase).href)
const snapshot = await (await fetch(new URL('snapshot.json', releaseBase))).json()
const hatchery = await createFelineHatchery({
  catalogUrl: new URL(snapshot.catalogFile, releaseBase).href,
  resourceBaseUrl: releaseBase.href,
})
const result = await hatchery.hatch('egg-20260915-001', {
  coat: 'brown-tabby',
  expression: 'small-fangs',
  ...mutationSelectionsFromList(['dragon-horns', 'small-lion-mane', 'forked-tail-tip']),
})
// 将 result.visual 和 result.image.blob 一起持久化；成功后再标记 READY。
// const replay = await hatchery.restore(savedVisual)
```

同 workspace 的 import 方式：

```ts
import { createFelineHatchery, mutationSelectionsFromList } from '@qmonster/incubator-adapter'
```

[示例入口](examples/feline-hatchery.ts)与[包实现](../../packages/incubator-adapter/src/feline-hatchery.ts)共用同一个实现。底层接口仍由 `@qmonster/generator-core`、`@qmonster/asset-catalog`、`@qmonster/renderer-canvas` 导出，可以按需调用。

## 花纹、表情与位置互斥

| 位置 | 合法选项 |
| --- | --- |
| coat | brown-tabby / orange-white / tuxedo / calico / colorpoint / rosetted |
| expression | parted-mouth / small-fangs / tongue-tip |
| crown | none / dragon-horns / antlers |
| ears | none / fin-ears |
| neck | none / small-lion-mane |
| back | none / small-wings |
| tailTip | none / forked-tail-tip |

不同位置可同时出现。同位置只能选一项，`mutationSelectionsFromList(['dragon-horns','antlers'])` 会报冲突。`mutationSelectionsFromList([])` 明确返回五个异变位置均为 `none`。

`generateFelineCombination(seed)` 对所有未指定位置独立均匀抽样，包括异变。明确指定的选项覆盖该位置抽样；不传异变字段不代表无异变。当前未引入生产稀有度、蛋种主题、risk 或 mutationBonus 映射，业务需要时应另行定义版本化规则。

## 保存、恢复与缓存

完整保存 `result.visual`，结构为：

```ts
interface StoredFelineVisual {
  kind: 'qmonster-feline-combination'
  spec: FelineCombinationSpec
  catalogSha256: string
  runtimeRevision: string
}
```

`spec` 必须包含 schemaVersion、catalogVersion、seed、七个 selections、七个 rolls 和 locks。严格规格拒绝未知字段；蛋 ID、账户、hatchId 和时间等业务身份放在外层。不要只存 seed，也不要恢复时重新抽样。

`hatchery.restore(savedVisual)` 校验身份与规格后按保存的选项重绘。当前版本同时识别[迁移前的精确快照](../releases/v0.10.0/previous-snapshot.json)：读取该快照的旧封装时保留 spec 和图像，返回当前根目录快照身份。此兼容只覆盖已验证的这一个快照，不接受任意历史 runtimeRevision。

`result.image` 包含 blob、实际 mime、width、height 与 cacheKey。缓存键绑定目录哈希、运行版本、尺寸、实际 MIME 和完整 spec 的 canonical JSON 哈希；对象键排序、数组顺序保留。图片属于派生缓存，Blob URL 用完撤销，不作为永久地址。业务负责原子保存、hatchId 幂等和过期请求处理。

## 重掷与渲染

- `setFelineCombinationSelection` 替换指定位置，保留计数；手动修改可替换锁定位置。
- `rerollFelineCombinationSlot` 只推进指定位置；锁定时不变。
- `rerollFelineCombination` 只重掷未锁定位置。
- 重掷可能重复原结果。计数为非负安全整数，锁定位置不能重复。

工作台和孵化端共用同一合成入口。1254×1254 透明画布、耳与尾部移除、根部遮挡、定位和毛边处理全部由模板负责，业务不得额外拼接嘴巴或尾尖。

## 发布校验与错误处理

SDK 校验目录原始字节 SHA-256；资源加载校验 PNG、真实 alpha、尺寸及 SHA-256。资源路径相对于 `resourceBaseUrl`，该 URL 必须以 `/` 结尾并指向发布目录顶层。不要传入 PNG 子目录，不要重新排版目录 JSON 或改写图片字节。跨域部署必须允许 fetch 的 CORS。

每次请求使用独立画布。优先导出透明 WebP，仅在明确不支持 WebP 编码时回退 PNG。缺图、目录/资源哈希不符、非法规格或未知快照均抛出错误，不能回退旧猫或伪造 READY。列表缩略图在原生渲染成功后生成，并使用独立尺寸缓存键。

快照固定运行源码、依赖锁文件、目录和资源。`runtimeRevision` 为按路径排序的 `sourceHashes` 对象经 `JSON.stringify` 后的 SHA-256，不是 bundle 文件哈希。运行实现或目录有意改变后，审核变更并运行 `node scripts/update-release-snapshot.mjs`，随后重新验证和构建；普通构建不会自动接受快照漂移。

旧 v0.8/v0.9 的 MonsterSpec 属于不同实现，不能交给本 SDK。旧版维护资料见[历史指南 v1.6](archive/qmonster-hatchery-integration-v1.6.md)；当前交付目录只提供现行猫型组合运行时。

## 验证命令

```sh
npm run typecheck
npm test
npm run build
# 下列命令需要另一个终端已运行 npm run dev
npm run verify:integration
npm run verify:workbench
npm run verify:migration
```

迁移验证比较全部 864 个组合的原始 RGBA，与迁移前结果逐项一致；同时验证独立构建的工作台和 SDK、旧封装恢复及素材完整性。记录见[根目录迁移说明](../releases/v0.10.0/README.md)。本仓库提供可运行 SDK 与接入契约，外部孵化项目的业务代码和部署仍由接入方完成。
