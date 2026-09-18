# 像素进化链补阶批 · 5 张

状态：**美术已验收，等待正式像素包登记。** 用户于 2026-09-18 回复 `ok，通过`；审批范围与文件摘要见 `docs/qa/pixel-evolution-chains/approval.json`。

本批按 `docs/integration/nutri-codex-exchange.md` 的 2026-09-23 建议执行，不增加槽位，不改变 `rendererVersion`，新增部件全部不绑毛色。

| id | 名称 | 槽位 | 稀有度 | 递进关系 |
|---|---|---|---|---|
| `crystal-horns` | 晶角 | crown | R | 龙角 N → 晶角 R |
| `feathered-ears` | 羽翅耳 | ears | R | 鳍耳 N → 羽翅耳 R |
| `celestial-ears` | 星辉翼耳 | ears | L | 羽翅耳 R → 星辉翼耳 L |
| `sunburst-ruff` | 日冕颈饰 | neck | L | 小狮鬃 N → 颈膜 R → 日冕颈饰 L |
| `phoenix-tail` | 凤凰尾 | tailTip | L | 分叉尾 N → 焰尾 R → 凤凰尾 L |

## 生成方式

- 概念源图：内置 `image_gen`，参考已批准的前层部件组合图，分别生成透明背景的独立部件。
- 像素落图：`scripts/build-pixel-evolution-chain-art.mjs` 将概念轮廓压到 64×64 槽位锚点，使用固定调色板、最近邻采样和二值 alpha。
- 组合验收：`scripts/review-pixel-evolution-chains.mjs` 使用正式 1.5.0 的 `pixel-rgba-v1` 合成器生成 15 格页面。

概念提示词的核心要求：

1. 晶角：金色根部到浅青晶体尖，紧凑对称，根部位于双耳内侧后方。
2. 羽翅耳：三片短羽向外上方展开，暖白、桃粉与珊瑚色。
3. 星辉翼耳：更完整的三羽翼扇，白紫羽片、金色结构和连在轮廓内的浅青星芒。
4. 日冕颈饰：位于头部和肩部后方的短放射领，珊瑚到金色，不读成背翼。
5. 凤凰尾：右侧完整替换尾，向上弯曲并在顶部形成三支相连的火羽，金橙珊瑚配色。

共同约束：透明背景、无文字、无投影、无独立粒子、部件之外不生成猫身体；最终轮廓由运行时统一描边。

## 锚点与层级

- `crystal-horns`：`frame`，身体之前绘制；沿用龙角的耳内侧连接方式。
- `feathered-ears`／`celestial-ears`：`subject`，沿用耳部 clear 区域并分别注册左右耳。除外接边界外，还沿原耳根多边形下斜边裁切：左侧 `(11.88,15.34) → (24.24,10.39)`，右侧 `(33.63,10.89) → (45.5,21.27)`；直角范围内、斜线下方的三角区不得占用。内侧边缘贴近原耳根，部件只向外／向上扩展。
- `sunburst-ruff`：`frame`，身体之前绘制，避免遮住脸部。
- `phoenix-tail`：`frame`，沿用尾部 clear 区域；非透明左边界固定为 `x=40`。

## 验收范围

- 12 格：四条涉及新增资源的槽位分别查看 N／R／L 递进。
- 3 格：标准、短腿、细长体型的新部件满配压力测试。
- 页面：`docs/qa/pixel-evolution-chains/index.html`。
