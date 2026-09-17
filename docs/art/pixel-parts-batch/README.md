# 像素部件补齐批：7 张缺失部件

用户决定（2026-09-18）：先补这 7 张，A 批剩余的 68 条登记暂缓。依据见 `docs/integration/nutri-codex-exchange.md` 的「2026-09-18（二）」条。

## 为什么是这 7 张

它们是**毛绒版 v0.10 已验收、像素包 1.2.1 缺失**的全部部件。补齐后像素版与毛绒版的部件阵容对齐（11 件），一只猫的成长步数从 **4 步升到 19 步**——这是 Nutri「7 天成长期、约 35 笔记录」设计成立的前提。登记条目再多也不改变成长步数，所以这批优先于补登记。

## 清单（背部三件优先）

| # | id | 槽位 | 层 | 备注 |
|---|---|---|---|---|
| 1 | `small-wings` | back | N | 翼链入口。毛绒版已知"露出很少"（几乎全被躯干挡住），像素版请按 64px 可辨放大 |
| 2 | `feathered-wings` | back | R | 翼链中段 |
| 3 | `dragon-wings` | back | L | 翼链顶端 |
| 4 | `antlers` | crown | N | 与现有 `dragon-horns` 并列的另一条链入口 |
| 5 | `halo` | crown | L | 悬浮金环。毛绒版已知偏细（露出仅约 15 个 64px 像素），像素版建议加粗环体 |
| 6 | `frill-neck` | neck | R | 现有 `small-lion-mane` 之上一阶 |
| 7 | `forked-tail-tip` | tailTip | N | 现有 `flame-tail` 之下一阶。毛绒版绑毛色，但像素包目前只有橘白，仍是 1 张 |

前 6 件不绑毛色，每件 1 张。

## 参考素材

- `reference/*.png`：毛绒版 v0.10 的该部件，**已按模板×注册变换烘焙到 1254 最终坐标**，可直接作为位置与形状参考。由 Nutri 侧 `npm run pixelcat -- --reference <dir>` 生成。
- 像素风格的目标参照像素包 1.2.1 里已验收的 4 件（`dragon-horns`／`fin-ears`／`small-lion-mane`／`flame-tail`）。
- `forked-tail-tip` 的参考图取橘白版（`orange-white-forked-tail-tip.png`），与当前像素包的唯一毛色一致。

## 已知的登记后果

补完后每 profile 的完整格从 16 变 288（crown 4 × ears 2 × neck 3 × back 4 × tail 3），7 个 profile 共 2016 条。Claude 已验证这个数字**无法靠子集压缩**（五槽独立、288 种状态全部会被实际经过），可压缩的是人工验收的采样密度而不是登记条目。详见交流文件同一条。
