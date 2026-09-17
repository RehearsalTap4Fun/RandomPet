# 像素部件 2,016 状态登记候选

状态：工程回放通过，等待组合美术验收；运行时保持关闭。

- 候选包：`1.3.0-candidate.1`
- 契约：`pixel-art-catalog-v3`
- 登记范围：7 profile × 288 状态 = 2,016 条 coverage
- 已批准且可生成：沿用 1.2.1 的 20 条
- 本批待验收：1996 条
- 资源：22 张（旧 15 张 + 已批准新部件 7 张）

v3 是加法版本，用于让同一槽位的不同性状选择各自的渲染层级：`small-lion-mane` 继续位于主体前，`frill-neck` 位于主体后。独立尾巴统一以已发布火焰尾的非透明左边界 `x=40` 为注册锚点；分叉尾尖整体左移后与其对齐。v1/v2 的源码、catalog 与 SDK 证据不变。

打开 `index.html` 查看 34 格抽样：颈×背 12 格、冠饰×耳型 8 格、7 个 profile 跨体型 14 格。每格同时展示 ×3 预览和 64px 实际尺寸。

生成与复核：

```powershell
npm run build:pixel-parts
npm run review:pixel-parts
```
