# 像素猫背景 Scene 契约设计

日期：2026-09-22

状态：待书面规格审核

## 目标

把已经验收的三张 96×64 涂鸦背景登记为像素猫的第六个成长槽位，使 Nutri 的成长深度从 15 阶增加到 18 阶，同时保持以下边界：

- 猫的基因／成长状态、猫表现型、猫美术资源和场景美术资源分别建模。
- 现有 `feline-phenotype-v2`、`pixel-art-catalog-v3`、`pixel-rgba-v1`、35,840 条猫图 coverage 和 64×64 猫图输出保持不变。
- 背景不进入猫图笛卡尔积，不把猫图 coverage 扩大为四倍。
- QMonster 交付可独立验证的 scene 包与参考合成器；Nutri 使用同一契约实现网页和小程序的展示、导出与成长接入。

成功标准是：三张背景能够按 N→R→L 顺序成长，任意合法 64×64 猫图都能在固定 96×64 场景中确定性合成，两端对相同输入生成相同 RGBA，并且旧的 64×64 猫图调用不受影响。

## 已确认的产品决定

背景作为第六个成长槽位，阶梯固定为：

1. `none`
2. `doodle-horizon`（N）
3. `doodle-leaf-shadow`（R）
4. `doodle-rainbow-trail`（L）

其中 `none → N → R → L` 提供三次成长，使现有 15 阶增加到 18 阶。顶阶只能由成长获得，孵化和空槽首掷继续只产生入口阶；具体随机权重沿用 Nutri 已上线的成长算法，本设计不改变其概率公式。

## 方案选择

采用独立的 Scene 契约。场景状态持有背景的语义取值，scene catalog 把语义取值映射到具体背景资源，猫表现型仍只描述猫本身。scene renderer 先处理背景，再接收现有猫 renderer 的 64×64 RGBA 输出作为输入。

没有采用以下方案：

- 把 `backdrop` 加入 `feline-phenotype-v2` 或新的猫 catalog：这会把场景和猫表现型耦合，并迫使 35,840 条猫 coverage 机械扩大四倍。
- 只在 Nutri 中硬编码三张背景：这会失去 QMonster 与 Nutri 之间的资源摘要、版本语义和确定性回放契约。

## 契约分层

### 1. 猫成长状态

Nutri 的持久化猫状态新增 `backdrop` 选择，默认值为 `none`。它是成长系统的第六个槽位，但不写入 `feline-phenotype-v2`。旧存档缺少该字段时必须确定性迁移为 `none`，不得随机补背景。

成长逻辑只操作稳定的语义 ID：`none`、`doodle-horizon`、`doodle-leaf-shadow`、`doodle-rainbow-trail`。它不保存 PNG 路径、资源摘要或绘制参数。

### 2. 猫表现型与猫资源包

现有猫表现型继续描述 `body`、`coat`、`eyes`、`expression`、`crown`、`ears`、`neck`、`back` 和 `tailTip`。现有 1.6.1 包保持原样：

- `schemaVersion: feline-phenotype-v2`
- `catalog schemaVersion: pixel-art-catalog-v3`
- `rendererVersion: pixel-rgba-v1`
- 输出尺寸 64×64
- 28 个 profile、63 个资源、35,840 条 approved／generatable coverage

scene 接入不得改变猫图的 phenotype key、coverage ID、资源摘要、RGBA 摘要或生成白名单。

### 3. 场景状态

新增轻量的 `pixel-scene-state-v1`：

```ts
type PixelSceneStateV1 = {
  schemaVersion: 'pixel-scene-state-v1'
  backdrop: 'none' | 'doodle-horizon' | 'doodle-leaf-shadow' | 'doodle-rainbow-trail'
}
```

该对象只表达场景表现型选择，不包含美术资源身份。它可与任意通过兼容性检查的猫表现型组合。

### 4. Scene catalog

新增独立的 `pixel-scene-catalog-v1`，不复用或改义 `pixel-art-catalog-v3`。首版包路径固定为：

`packages/asset-catalog/pixel/scene/v1/backdrop-1.0.0/`

catalog 至少包含：

```ts
type PixelSceneCatalogV1 = {
  schemaVersion: 'pixel-scene-catalog-v1'
  sceneVersion: string
  revision: string
  rendererVersion: 'pixel-scene-rgba-v1'
  canvas: { width: 96; height: 64 }
  subject: {
    schemaVersion: 'feline-phenotype-v2'
    rendererVersion: 'pixel-rgba-v1'
    width: 64
    height: 64
    anchor: { x: 16; y: 0 }
  }
  outline: {
    owner: 'scene-renderer'
    neighborhood: 'four'
    width: 1
    color: 'adjacent-mean-darken'
    factor: 0.36
  }
  resources: Record<string, SceneResource>
  backdrops: Record<BackdropId, BackdropEntry>
  growth: {
    slot: 'backdrop'
    order: ['doodle-horizon', 'doodle-leaf-shadow', 'doodle-rainbow-trail']
  }
  validatedSubject: {
    artVersion: '1.6.1'
    revision: 'c622a13cb4f045edaa1fe8efc133d312bcb62f78414d75d8bc58a17d78f69ddf'
  }
}
```

`subject` 是兼容性接口：未来猫包只要继续满足相同 phenotype、renderer 和 64×64 输出契约，就可复用 scene 包。`validatedSubject` 记录首发验证使用的精确猫包，不把 scene 包永久锁死在 1.6.1。

`resources` 只包含 96×64 背景资源。猫的 64×64 部件仍只存在于猫资源包。`backdrops` 把稳定语义 ID 映射到资源 ID、稀有度和成长序号；`none` 不映射资源。

## 资源身份

首版收录已经验收的三个原始背景文件，必须逐字节复制，不能重新编码或重绘：

| 语义 ID | 稀有度 | 来源 | SHA-256 |
|---|---|---|---|
| `doodle-horizon` | N | `docs/qa/pixel-backdrop-batch/layers/doodle-horizon.png` | `2f4eaff9b6ed478dadfcaff7ae9828b4a3c076d2bea5dd988e9628cffdbc604b` |
| `doodle-leaf-shadow` | R | `docs/qa/pixel-backdrop-batch/layers/doodle-leaf-shadow.png` | `f6acae86a1a7c92ab13e2b9d23e21613b499d204bf0045747038b4f636e7f471` |
| `doodle-rainbow-trail` | L | `docs/qa/pixel-backdrop-batch/layers/doodle-rainbow-trail.png` | `17821cc32d36b65167393f802c313b595d4ec2d28b7b82e4ce20ea9d9820f872` |

每个资源条目记录相对路径、SHA-256、`width: 96` 和 `height: 64`。资源保持二值 alpha、一个四邻连通区域和四边透明。原始 PNG 不含外描边；描边是 renderer 行为。

## 渲染语义

加载阶段先用 scene catalog 的 `subject` 约束校验猫 catalog；通过后得到已验证的 scene composer。`pixel-scene-rgba-v1` 的纯合成阶段接收 scene state、已验证的 scene catalog，以及由该猫 catalog 和 `pixel-rgba-v1` 生成的 64×64 猫 RGBA，输出固定为 96×64 RGBA。

### 合成顺序

1. 创建全透明 96×64 场景。
2. 当 `backdrop !== none` 时，读取并校验对应的 96×64 原始背景。
3. 从原始背景生成一圈背景描边，并把“描边后的背景”放在场景原点 `(0,0)`。
4. 把未经改动的 64×64 猫 RGBA 放在 `(16,0)`，覆盖其下方的背景和背景描边。
5. 返回 96×64 RGBA；不裁切、不缩放、不对猫再次描边。

当 `backdrop === none` 时仍返回 96×64 场景，把猫放在 `(16,0)`，左右各留 16px 透明区域。这样成长前后显示尺寸不跳变。旧的猫图接口继续直接返回 64×64，不自动套 scene wrapper。

### 1px 描边归属与算法

描边只归 `pixel-scene-rgba-v1` 所有。资源构建器、猫 renderer、Nutri UI 和导出层不得预烘焙、补画或重复执行。

算法固定如下：

- 只扫描原始背景中的透明像素。
- 透明像素只要有上、下、左、右任一不透明邻居，就成为描边像素；对角邻居不参与。
- 描边 RGB 为所有不透明四邻像素 RGB 的逐通道算术平均值，再逐通道乘以 `0.36` 并四舍五入到整数。
- 描边 alpha 固定为 255。
- 邻居集合始终读取原始背景，不能读取本轮新生成的描边，因此只扩展一圈。
- 原始背景像素保持原 RGBA，不接受描边颜色回写。

首版背景和猫图均要求二值 alpha。合成时透明像素不写入，不透明像素完整覆盖目标像素；这与已验收的 `pixel-scene-preview-v1` 输出一致。

## 版本与确定性

- scene schema、scene renderer 和 scene art 分别版本化。字段或含义变化升级 schema；像素算法变化升级 `rendererVersion`；仅资源集合或资源内容变化升级 `sceneVersion` 和 `revision`。
- 候选版本使用 `1.0.0-candidate.1`，验收晋升后使用 `1.0.0`。
- `revision` 必须由规范化 catalog 数据、三个原始 PNG 摘要和影响输出的构建输入共同确定；路径分隔符和构建时间不得进入摘要。
- 相同 scene catalog、scene state 和猫 RGBA 必须逐字节产生相同场景 RGBA。
- scene 输出摘要属于 scene QA，不写回猫 catalog，也不改猫 coverage 摘要。

## 错误处理

以下情况必须直接失败，不能静默回退到 `none` 或旧背景：

- scene state 的 schema 或 backdrop ID 未知。
- catalog schema、renderer version 或成长顺序不符合契约。
- 背景资源缺失、摘要不匹配或尺寸不是 96×64。
- 猫 RGBA 长度不是 `64 × 64 × 4`。
- subject compatibility 与实际猫包不匹配。
- 锚点导致 64×64 猫超出 96×64 场景。

旧存档缺少 `backdrop` 是唯一迁移例外，明确迁移为 `none`。加载失败与迁移必须分开处理，避免损坏状态被伪装成旧存档。

## QMonster 交付边界

QMonster 负责：

- `pixel-scene-state-v1` 与 `pixel-scene-catalog-v1` 的类型、解析和引用校验。
- `pixel-scene-rgba-v1` 的纯 RGBA 参考实现。
- 候选／正式 scene 包构建、revision 和 provenance。
- 三张已批准背景的原样收录。
- 小范围 scene QA、确定性重建和 Nutri 回放清单。

QMonster 不负责 Nutri 的持久化、成长随机、网页布局、小程序 canvas 或线上发布。

## Nutri 接入边界

Nutri 负责：

- 在猫状态中迁移并持久化 `backdrop`，把它登记为第六个 `none → N → R → L` 成长槽位。
- 将 `maxGrowthSteps()` 从 15 提升到 18，并保持现有成长概率和顶阶获取规则。
- 先调用现有猫 renderer 得到 64×64 RGBA，再调用 scene renderer 得到 96×64 RGBA。
- 修改网页和小程序的缩放、canvas、预览与导出路径，使宽高分别处理；不能继续假设 `n × n`。
- 对 QMonster 的参考样本执行逐字节回放，并在发布前验证旧存档迁移和新版存档往返。

Nutri 可以移植参考算法，但输出必须服从本契约；QMonster 的 Node 实现不是要求 Nutri 共用同一份运行时代码。

## 验证与验收

### 自动契约验证

- schema 严格解析，拒绝额外或未知取值。
- 三张原始 PNG 的路径、SHA-256、尺寸、二值 alpha、四邻连通性和透明边界与审批证据一致。
- `none` 和三个背景均输出 96×64；猫锚点均为 `(16,0)`。
- 描边只扩展四邻 1px，颜色公式与 `0.36` 系数精确一致，无对角或递归扩展。
- 旧 1.6.1 猫 catalog、资源和 35,840 条 coverage 在 scene 构建前后逐字节不变。
- 连续两次 scene 构建的 catalog、provenance、资源和样本输出摘要完全一致。

### 小范围视觉验证

不生成背景与 35,840 个猫表现型的完整笛卡尔积。验收页只生成 9 张代表场景：

- 每张背景搭配 3 个猫组合。
- 九个组合合计覆盖六种毛色、三种体型，以及普通组合和含光环／耳部／颈部／翅膀／尾巴的高遮挡组合。
- 核心观察项是背景可见面积、深浅毛色对比度、部件溢出背景的层级以及左右透明留白。

候选通过 QMonster 自动验证和用户视觉验收后，再晋升 scene `1.0.0`。Nutri 只需回放同一组 9 个场景，并额外验证 `none` 场景、旧存档迁移、18 阶阵容以及网页／小程序矩形导出。

## 发布顺序

1. QMonster 发布 `1.0.0-candidate.1` scene 包和 9 张 QA 样本。
2. 用户完成小范围视觉验收。
3. Nutri 对候选执行 9 张逐字节回放和结构检查。
4. QMonster 根据回放证据晋升 scene `1.0.0`。
5. Nutri 换用正式包，完成网页与小程序验证，再独立发布。

候选、用户验收、QMonster 晋升和 Nutri 上线是四个独立状态；前一步完成不自动授权后一步。

## 本轮不包含

- 不修改三张已批准背景的像素内容。
- 不新增背景换色或颜色轴；颜色轴在 scene 契约稳定后另行设计。
- 不新增第四张背景或背景动画。
- 不改猫表现型 schema、猫 renderer、猫 catalog 或猫 coverage。
- 不对 143,360 个“猫 × 背景”组合做全量枚举或渲染。
- 不在本轮调整 Nutri 的成长概率、记账规则或其他槽位。
