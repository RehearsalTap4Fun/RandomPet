# 像素体型与眼型首批扩展设计

日期：2026-09-16  
状态：用户已确认设计，待实施计划  
范围：QMonsterCreator 像素美术包；Nutri 仅在新目录产出后做跨仓回放

## 目标

在现有标准体型、短腿圆身和圆眼基础上，新增一个修长高挑体型与一个半眯杏仁眼型。眼型成为独立表现型字段，美术仍使用完整主体图保证 64px 下的脸部质量。首批限定橘白花纹与小尖牙表情，用小范围组合验证体型、眼型和既有异化部件的兼容性。

本批不扩花纹、配色、嘴型或异化种类，不开启 Nutri 像素包运行时，也不重新设计品质与概率。

## 已确认的美术方向

### 新体型：修长高挑型

- 语义 ID：`slender-tall`。
- 相对标准体型：腿更长、躯干更窄、耳朵略大。
- 保持正面坐姿、尾巴位于右侧、主体中心和整体画布占比与现有主体接近。
- 64px 下应与 `standard`、`shortleg-round` 形成明显的三档轮廓差异。
- 独立提供主体、耳部清除区、尾部清除区、脸部遮罩和部件定位，不借用另一体型的几何作为正式配置。

### 新眼型：半眯杏仁眼

- 语义 ID：`sleepy-almond`。
- 现有圆眼 ID：`round`。
- 横向杏仁形眼裂，上眼睑略压低，保留清晰瞳孔及单点高光。
- 眼神平静、略慵懒，不通过嘴部或眉毛改变情绪。
- 64px 下应无需放大即可与 `round` 区分，并保持左右眼、鼻子和小尖牙清楚。

## 表现型和目录版本

### 表现型

新增 `feline-phenotype-v2`：

```ts
interface FelinePhenotypeV2 {
  schemaVersion: 'feline-phenotype-v2'
  body: string
  coat: string
  eyes: string
  expression: string
  crown: string
  ears: string
  neck: string
  back: string
  tailTip: string
}
```

字段顺序固定为 `body, coat, eyes, expression, crown, ears, neck, back, tailTip`。眼型与嘴部表情是两个独立性状。表现型不保存图片路径、坐标、遮罩、种子或品质。

旧 `feline-phenotype-v1` 适配到 v2 时确定性补 `eyes: round`，其余八个性状原样复制，不重新运行旧随机生成器。旧 v1 对应的 key、目录和存档继续使用旧实现回放；适配产生的是一份新的 v2 表现型。

### 美术目录与存档

- 新目录 schema：`pixel-art-catalog-v2`。
- profile 选择条件：`body + coat + eyes + expression`。
- 候选美术版本：`1.2.0-candidate.1`。
- 验收后美术版本：`1.2.0`。
- 新存档 schema：`feline-appearance-v2`，保存 v2 表现型和完整 art identity。
- 旧 `pixel-art-catalog-v1`、`feline-appearance-v1`、目录文件及 revision 原样保留。
- 合成算法不变，继续声明 `rendererVersion: pixel-rgba-v1`。

目录解析器明确区分 v1 和 v2。不能在 v1 schema 中悄悄增加 eyes，也不能把旧 revision 解释成新目录。缓存 key 对 v2 包含 art identity 和九个表现型字段。

## 美术资源策略

眼型在语义层独立，在当前美术层按完整主体图烘焙。目录通过四项 profile selector 选择主体资源，而不是在运行时擦除旧眼并叠加眼睛贴片。

采用完整主体的原因：

- 眼睛在 64px 中只占少量像素，眼贴片容易残留旧眼轮廓或产生双描边。
- 不同体型的脸宽、眼距和上眼睑角度不同，独立主体能保留稳定的脸部设计。
- 表现型与美术仍然分离；未来可在不改变 `eyes` 语义的情况下替换具体画法。

本批新增四张 1254×1254 源图：

| 主体 | 体型 | 眼型 | 表情 | 制作方式 |
|---|---|---|---|---|
| `orange-white-round-small-fangs-slender-tall` | slender-tall | round | small-fangs | 以标准圆眼小尖牙为参考，改造完整体型 |
| `orange-white-sleepy-almond-small-fangs-standard` | standard | sleepy-almond | small-fangs | 只修改标准主体眼部 |
| `orange-white-sleepy-almond-small-fangs-shortleg-round` | shortleg-round | sleepy-almond | small-fangs | 只修改短腿主体眼部 |
| `orange-white-sleepy-almond-small-fangs-slender-tall` | slender-tall | sleepy-almond | small-fangs | 以修长圆眼主体为编辑目标，只修改眼部 |

文件名顺序采用 `coat-eyes-expression-body`，避免把 body 或 eyes 隐含在说明文字中。正式资源 ID 与目录映射使用同一命名。

源图规范：纯洋红 `#FF00FF` 背景；1254×1254；无地面、阴影、渐变、毛发纹理、模糊或噪点；硬边平涂；深色轮廓；主体不得超出画布。生成图先作为候选，不能因生成成功自动进入目录。

## 小批次覆盖矩阵

固定 `coat = orange-white`、`expression = small-fangs`、`back = none`。新增七个候选 coverage：

| ID 后缀 | body | eyes | crown | ears | neck | tailTip | 验证目的 |
|---|---|---|---|---|---|---|---|
| `standard-sleepy-base` | standard | sleepy-almond | none | none | none | none | 标准体型只换眼型 |
| `shortleg-sleepy-base` | shortleg-round | sleepy-almond | none | none | none | none | 短腿体型只换眼型 |
| `slender-round-base` | slender-tall | round | none | none | none | none | 只换新体型 |
| `slender-sleepy-base` | slender-tall | sleepy-almond | none | none | none | none | 新体型与新眼型交叉 |
| `standard-sleepy-ears-mane` | standard | sleepy-almond | none | fin-ears | small-lion-mane | none | 眼型、换耳和前胸遮罩 |
| `shortleg-sleepy-horns-flame` | shortleg-round | sleepy-almond | dragon-horns | none | none | flame-tail | 眼型、后层角和换尾 |
| `slender-sleepy-stack` | slender-tall | sleepy-almond | dragon-horns | fin-ears | small-lion-mane | flame-tail | 新体型完整几何和层级 |

验收页同时显示现有 `standard + round` 与 `shortleg-round + round` 基线，但旧条目不重复登记为新 coverage。首批 7 个候选均为 `review: pending`，不进入 `generatable`；用户明确验收后随 1.2.0 一起提升。

## profile 与合成

v2 profile 必须提供六个既有步骤：`back, crown, body, ears, tailTip, neck`。body 仍按 expression 选择主体资源，但 profile 自身已经由 body、coat、eyes、expression 唯一选中。

- `standard + sleepy-almond + small-fangs` 和 `shortleg-round + sleepy-almond + small-fangs` 可以从已验证体型 profile 派生初始几何，但发布前必须对新主体重新测量和验证。
- `slender-tall` 必须建立独立 ears clear、tailTip clear、mane face occlusion，以及鳍耳和鬃毛定位。
- 现有龙角、焰尾、鳍耳和小狮鬃 PNG 可以复用；复用只减少图层资源数，不自动扩大 coverage。
- clear、occlusion、frame／subject 和描边语义不变。新目录全部组合的原生 RGBA 必须记录 SHA-256。
- `standard-parted-mouth + fin-ears` 不属于本批；目录继续明确报告未覆盖。

## 生产流程

1. 为四张图分别编写生产提示词；所有编辑提示词明确 edit target 和必须保持不变的部分。
2. 使用内置 image generation 工具，每张图单独调用。先生成修长圆眼，再用其最终版本制作修长半眯眼。
3. 每张输出复制到仓库的本批 `solid/`；所有被淘汰版本保存到 `attempts/`，生成提示词、来源路径和摘要写入批次记录。
4. 使用 Nutri 最新收图规则检查尺寸、底色、软边、色数和已存在参考的剪影。修长新体型没有旧体型参考，不伪造 IoU 门槛；为其记录人工轮廓验收，后续同体型眼型变体以修长圆眼为参考检查一致性。
5. 使用与 `pixel-rgba-v1` 一致的离线流程生成 64px 图层。建立 v2 profile，合成七个候选组合及对照。
6. 自动检查二值 alpha、64×64、目录引用、确定性回放、输入不变、脸部关键区域和透明 PNG 导出。
7. 人工验收页同时展示 64px、128px 和 256px 最近邻放大，在深浅背景检查眼睛、脸、轮廓、遮罩和层级。
8. 用户明确通过后生成 1.2.0 已验收目录；保留 1.2.0-candidate.1 及所有旧目录。
9. 在交流文件通知 Claude 拉取新目录并运行 Nutri `scripts/pixelPackReplay.ts`，记录通过数和失败组合。

## 验收标准

### 源图

- 文件恰为 1254×1254，背景为纯洋红，主体外无影子或杂物。
- 标准、短腿的半眯眼版本除眼区外不产生可见体型漂移。
- 修长圆眼和修长半眯眼除眼区外保持同一轮廓、体型比例和坐标。
- 修长体型在 64px 下与标准、短腿均可一眼区分，耳朵和长腿不与画布边缘相切。

### 像素结果

- 原生 64×64，alpha 仅 0 或 255；128px 为严格 2× 最近邻放大。
- 半眯杏仁眼在三种体型上可辨认，瞳孔和高光不消失，不与鼻子或轮廓粘连。
- 三种体型的基础轮廓可辨；修长体型的腿长和窄躯干在 64px 保留。
- 鳍耳清除原耳；焰尾清除原尾；鬃毛不遮眼、鼻、嘴；龙角、鳍耳和焰尾有足够露出面积。
- 七个新组合确定性回放，RGBA 摘要与目录一致；现有 v1.1.0 的 14 个组合回放不变。
- 未覆盖组合得到明确诊断，不使用毛绒或其他眼型资源填补。

### 跨仓契约

- `rendererVersion` 仍为 `pixel-rgba-v1`。
- Nutri 能识别 v2 schema 或明确拒绝，不能把缺 eyes 的 v1 数据直接当成 v2。
- Nutri 对新目录执行 revision、PNG 摘要、全部 coverage RGBA 及输入图层不变检查。
- 是否打开 Nutri 运行时由覆盖连通性和用户后续决定，不由本批验收自动触发。

## 失败处理和边界

- 图像生成器改变了非目标区域：保留到 attempts，用单一修改指令重做，不手工把错误结果登记为正式资源。
- 半眯眼缩到 64px 后变成一条黑线：优先扩大眼裂高度和高光，不改变嘴型或体型补偿。
- 修长体型的既有部件定位不合适：修改该体型 profile，不改共享部件 PNG，除非部件自身在所有合理位置都不可读。
- 新体型需要改变既有部件造型时，另开后续美术批次；本批只允许定位和遮罩差异。
- 任何实现发现需要改变像素合成顺序、描边或透明语义时，停止并提升 `rendererVersion`，重新进行跨仓设计确认。

## 明确不在本批范围

- 其他五种花纹和配色。
- 新嘴型、新异化、花纹与眼型的完整笛卡尔积。
- 独立眼睛运行时贴片或程序化绘眼。
- Nutri 运行时开关、正式概率、旧用户迁移。
- 育种、显隐性、基因编码或性状稀有度重构。
