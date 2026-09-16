# 小猫平涂源图 · 试验批（nutri 像素小管家）

日期：2026-09-16。目的：验证「平涂赛璐璐源图 + 自动像素化」这条路能否产出接近手绘的像素猫。消费方是 nutri 的 `scripts/pixelCat.ts --source`，**不进 RandomPet 目录、不改 SDK、不需要批准流程**；效果成立后再决定是否升成正式的 `feline-pixel-v1` 目录。

背景：直接把 v0.10 毛绒图缩成像素（多级去纹理 + 小色板 + 去斑 + 1px 描边 + 64px×2 整数显示）已经上线试验，但上限是「像素化的照片」：明暗边界跟着光照噪声走、内部没有结构线、小特征被平均掉。平涂源图把这些取舍在源头做完，同一条流水线就能出近似手绘像素画。

## 出图规则（每张都要满足）

1. **画布与坐标**：1254×1254，与 v0.10 完全同一坐标系。主体图以毛绒主体为编辑目标、**轮廓与五官位置逐像素对齐**；部件图直接画在最终坐标（恒等变换），位置与尺度以 `reference/<id>.png` 为准（这些参考图已把模板×注册变换预先应用）。
2. **风格**：平涂赛璐璐。每种材质只允许 1 底色 + 1 阴影色 + 至多 1 高光色，全部硬边色块；无渐变、无毛发纹理、无软笔刷、无模糊。粗描边 #2B2320，宽约画面 1/60（≈20px），部件之间用稍细的内线分开。光源左上。眼睛大而简，瞳孔 #1B1B22 + 一点白高光；鼻 #E88A98；耳内 #F2A9B4。
3. **背景**：纯洋红 #FF00FF 铺满，无地面、无投影、无暗角。nutri 脚本按四角颜色自动抠底并向内腐蚀 3px，所以主体里不要用接近洋红的颜色。
4. **不要**：胡须、第二套器官、地面阴影、任何文字或水印。
5. **像素尺度提醒**：最终显示只有 64px，小于画面 1/60 的细节都会消失，宁可画大画简。

## 花纹调色板（阴影偏冷偏暗，高光偏暖，像素画习惯）

| id | 名称 | 调色板 | 虹膜 |
|---|---|---|---|
| orange-white | 橘白双色 | orange base #E98A3C, orange shadow #B9612B, orange highlight #F5B571; white base #F7F2E9, white shadow #CFC6D8 | #5FA8B8 teal |
| brown-tabby | 棕灰虎斑 | fur base #B08A62, fur shadow #7E5E40, fur highlight #D6B58E; stripes #5E4330; muzzle/chest #E9D9C3 | #7FB069 green |
| tuxedo | 黑白燕尾服 | black base #2A2A33, black shadow #15151B, black highlight #4A4A5A; white base #F7F2E9, white shadow #CFC6D8 | #E0B24A amber |
| calico | 三花 | white base #F7F2E9, white shadow #CFC6D8; orange #E98A3C, orange shadow #B9612B; black #2A2A33, black shadow #15151B | #5FA8B8 teal |
| colorpoint | 奶油重点色 | cream base #F1E4D2, cream shadow #CDB9A4, cream highlight #FBF3E8; points #4A3128, points shadow #2E1C16 | #4F86D8 blue |
| rosetted | 金棕豹点 | fur base #D9A45A, fur shadow #A87436, fur highlight #EFC98A; rosettes #4A3220; muzzle/belly #F3E4C8 | #C7A24A gold |

## 部件

| id | 名称 | 位置 | 层 | 数量 |
|---|---|---|---|---|
| `dragon-horns` | 小龙角 | crown | N | 1 张 |
| `antlers` | 鹿角 | crown | N | 1 张 |
| `halo` | 光环 | crown | L | 1 张 |
| `small-wings` | 小翅膀 | back | N | 1 张 |
| `feathered-wings` | 羽翼 | back | R | 1 张 |
| `dragon-wings` | 龙翼 | back | L | 1 张 |
| `frill-neck` | 伞蜥颈膜 | neck | R | 1 张 |
| `flame-tail` | 焰尾 | tailTip | R | 1 张 |
| `fin-ears` | 鳍耳 | ears | N | 按 6 花纹各 1 张 |
| `small-lion-mane` | 小狮鬃 | neck | N | 按 6 花纹各 1 张 |
| `forked-tail-tip` | 分叉尾尖 | tailTip | N | 按 6 花纹各 1 张 |

## 批次与顺序（提示词见同名 `-prompts.json`，`batch` 字段）

- **批 0（3 张，先跑通）**：`orange-white-parted-mouth`（平涂母版，以毛绒图为编辑目标）、`dragon-horns`、`flame-tail`。出完后 nutri 侧 `npm run pixelcat -- --source <solid 目录> --out /tmp/x && npm run pixelcat -- --preview out.png --out /tmp/x`，其余图层自动回退毛绒版混排，看这三张的像素结果是否明显优于毛绒版。**不满意就改提示词重出，不要往下铺。**
- **批 1（17 张）**：其余 5 花纹 × parted-mouth（以平涂母版为编辑目标、毛绒同花纹图为纹样参考），再 6 花纹 × 2 表情。
- **批 2（24 张）**：6 件与花纹无关的部件（除批 0 两件）+ 3 件绑花纹部件 × 6。

## 输出位置与命名

`docs/art/flat-source-trial/solid/<id>.png`，`<id>` 与 v0.10 资源 id 完全一致（主体 `<coat>-<expression>`，绑花纹部件 `<coat>-<part>`，其余 `<part>`）。nutri 消费命令：

```
cd nutri
npm run pixelcat -- --source ../RandomPet-master/docs/art/flat-source-trial/solid
npm run pixelcat -- --preview /tmp/pixelcat-flat.png
```

## 验收清单（看预览图）

- 64px 下眼、鼻、嘴一眼可辨；六种花纹在 64px 下能区分（虎斑与豹点是难点）。
- 主体轮廓与毛绒版对齐：换耳、换尾的清除多边形仍然干净（没有露出原耳/原尾残留，也没有缺口）。
- 部件露出身体轮廓的部分足够大（小翅膀是已知的反例，提示词里已要求放大）。
- 抠底无洋红溢色边。
