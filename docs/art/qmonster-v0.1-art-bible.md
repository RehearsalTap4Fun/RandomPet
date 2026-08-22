# QMonster v0.1 美术圣经

版本：0.1.0
状态：锁定
角色：所有输入图都必须在提示词中标明为“风格参考”“锁定母体”“插槽遮罩”或“socket 定位参考”，不得把风格参考当作编辑目标。

## 不可变生成控制

- 固定三分之四正面视角；相机位于生物眼平；50mm 等效镜头。禁止正侧、俯拍、仰拍、鱼眼和透视漂移。
- 正式源母版为 2048×2048 RGBA；运行时裁切为 1024×1024 RGBA。
- 主光固定从左上方入射；相机方向提供宽柔补光；柔软接触阴影必须为独立层，部件层本身不得烘焙地面或背景。
- 风格固定为明亮、圆润、触感明确的友善 3D 怪奇卡通：夸张大眼和大嘴、轻微友善不对称、清晰软材质响应。
- 禁止血腥、尖锐写实解剖、恐怖谷、文字、logo、水印、道具、环境、背景平面和未经请求的额外肢体。
- 透明背景必须是真实 alpha，不接受白底伪透明、残留描边或不透明画布。
- 母体 ID 固定为 `base_blob_v1`、`base_biped_v1`、`base_floating_v1`。
- 所有母体和部件的主体安全边界为画布四边各 96px；任何非透明像素不得触碰边界。
- 色彩空间使用 sRGB；透明边缘使用直通 alpha；运行时 WebP 必须无损。

## 经批准的色键透明回退

当当前 Codex 内置图片生成把“透明背景”烘焙为 RGB 棋盘格时，必须重新生成，不得处理棋盘格版本。重新生成使用与主体色板互补、不会出现在主体内的均匀高饱和色键：优先纯绿 `#00ff00`；绿色主体改用纯品红 `#ff00ff`；品红主体改用纯青 `#00ffff`。提示词必须要求纯平色、无渐变、无地面和投影、无环境反光。

本地 `extractChromaAlpha` 仅在以下质量门全部通过时批准素材：

- 从安全边界像素确定性检测到 0/255 组成的高饱和色键。
- 安全边界背景色差 p95 ≤ 12，污染像素比例 ≤ 1%。
- 主体不与色键过度相似，且主体颜色到色键的 p05 距离 ≥ 80。
- 安全边界内与色键距离 ≤ 32 的编码噪点必须归零；其余 alpha > 8/255 的前景像素数不得超过 `max(16, 安全边界像素数×0.01%)`，以区分孤立编码噪点与真实裁切。
- 保留足量的局部 alpha，不接受完全硬切边或局部 alpha 占比 > 45%。
- 去色键后的边缘色键残留 p95 ≤ 4；局部 alpha 像素必须从至少 2px 内缩的最近不透明核心继承去污染颜色，最近核心距离 p95 ≤ 32，颜色差 p95 ≤ 12；不允许绿色、品红或青色边。

提取器必须输出诊断、质量指标、源文件 SHA-256 与处理后 SHA-256。任何门失败都必须拒绝并重新生成，禁止手工涂边掩盖失败。

## 参考风格的可用与禁用信息

用户提供的绿色毛绒怪物图仅作为风格参考。可继承：柔和棚拍光、圆润轮廓、触感明确的绒毛、大眼大嘴、非整齐牙齿与友好神态。不得复刻：具体绿色/蓝斑配色、角色轮廓、五官排列或任何可识别设计。

## 锁定母体判定

- `base_blob_v1`：矮墩团絮轮廓，重心低，头部和躯干近似连体；不带眼、嘴、纹样或主题装饰。
- `base_biped_v1`：短腿双足、圆润躯干、清晰头部安装区；不带眼、嘴、纹样或主题装饰。
- `base_floating_v1`：悬浮水滴/软团轮廓，下缘无地面接触；不带眼、嘴、纹样或主题装饰。
- 候选必须同时满足固定镜头、固定灯光、友好边界、透明 alpha、四边留白和 socket 可读性；否则拒绝。

## 部件编辑提示词模板（逐字锁定）

```text
Edit the supplied locked QMonster rig base. Change only the masked {slotId} region to: {partDescription}.
Preserve the camera, 3/4 front pose, body silhouette outside the mask, eye-level perspective,
upper-left soft key light, broad front fill, friendly rounded 3D cartoon proportions, and tactile material response.
Keep attachment points aligned with the supplied socket guides. No text, no props, no environment,
no extra limbs outside the requested slot, no gore, no horror-valley anatomy. Output a clean isolated subject.
```

每次调用还必须在模板之后声明：输入图角色、真实透明背景、不得出现 logo/水印，以及“只输出被请求插槽的模块层；母体其他区域必须完全透明”。这些是执行约束，不修改模板正文。

## 2×2 四候选评审

一个部件的一次生成可使用 2×2 等分候选板代表相同提示词的四个变体。四格不得带编号或文字。评审顺序固定为左上、右上、左下、右下；选择记录必须写明三个拒绝理由和一个批准理由。裁切后每格必须重新恢复透明 alpha，并按统一坐标扩展到 2048×2048。

评审维度：镜头、光向、遮罩外轮廓、socket、友好感、透明边缘、缩放。任何一项失败即拒绝。

## 运行时输出

- approved master：`asset-source/v0.1.0/{rigs|parts}/`，Git 忽略，保留来源 SHA-256。
- runtime PNG/WebP：`packages/asset-catalog/assets/v0.1.0/`，Git 跟踪，均为 1024×1024 RGBA。
- 目录、提示词 SHA-256、来源/运行时文件 SHA-256、四候选判定和人工接触表复核记录统一写入 `packages/asset-catalog/source-index.json`。
