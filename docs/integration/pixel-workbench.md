# 像素创作工作台（2026-09-24）

## 当前入口

运行 `npm run dev`，打开 `http://127.0.0.1:4184/pixel`。新用户默认正式猫包 **1.6.1**：28 个 profile、63 张资源、35,840 条 approved／generatable coverage。正式目录为 `packages/asset-catalog/pixel/v3/approved-1.6.1/catalog.approved.json`。

先依次选择体型、毛色、眼型、表情，再搭配额顶、耳朵、颈部、背部、尾尖。选项从目录中已有的合法形象推导；更换前面的基础属性时，保留兼容的后续选择，不兼容项调整为有资源的选项。标准体型支持六毛色、两眼型、两表情；短腿与修长体型仅有橘白、小尖牙、两眼型。

工作台提供 64px 原生、128px 最近邻放大的透明 PNG，以及形象 JSON。预览的浅色、深色和棋盘格底板不会写入导出图片。加载目录或 PNG 失败时可以直接重试。

## 保存与恢复

1.6.1 继续使用 `feline-appearance-v2`，包含完整 phenotype 和 `art: { styleId, artVersion, revision }`。catalog 的 v3 表示部件渲染变体能力；形象语义仍为 phenotype v2，两者版本不必相同。

- 已有 localStorage 或导入 JSON 按完整美术身份恢复；七种历史 v1/v2 包仍可选择，候选保存不会被自动晋升。
- 旧毛绒 `feline-combination-v1` 没有像素美术身份，将其已确定的 selections 转为 phenotype，查询当前正式 1.6.1 覆盖；不重新抽取随机数。未覆盖的表情／部件会明确报错。
- JSON 解析失败、版本不匹配或组合未覆盖时，不替换当前有效形象。
- 浏览器保存键继续为 `qmonster.pixel-appearance.v2`，兼容旧 v1 保存键。只有合法选择成功应用后才写入存储。

## 实现边界

`packages/incubator-adapter/src/pixel-art-browser-v3.ts` 是新增浏览器适配层，提供 `createPixelArtV3Session(input)`。返回的 session 提供 `resolve`、`save`、`restore`、`key` 和 `load(resourceUrl)`；后者返回同步 `render(phenotype)`。

目录经过结构、生成白名单及 revision 校验，PNG 在解码前核验摘要和尺寸，解码后核验二值 alpha。会话保留私有目录与索引，返回的目录元数据为独立副本。原 v1/v2、已发布 v3 resolver、`pixel-rgba-v1` 和原素材目录保持原字节；新适配层不改写历史验收记录。

工作台按 URL 载入大目录，按索引查找合法组合；不会创建 35,840 个组合按钮。浏览器适配层随 creator 构建使用，既有独立 v3 SDK 的公开入口保持原状。

场景是独立的 96×64 资源与合成契约。其 1.0.0 已在另一发布流程完成晋升；本工作台输出仍为透明猫图。正式换包和部署状态以 [交接记录](nutri-codex-exchange.md) 为准。

## 验证

```sh
npm run typecheck
npm test
npm run verify:pixel
npm run build
npm run verify:pixel:built
npm run verify:loading
```

`npm test` 包含原 Vitest 测试、浏览器适配层契约测试和两份 Node 素材几何测试。13 个进化链代表样本会通过当前 resolver／renderer 重新合成并核对历史 RGBA 摘要。

`npm run verify:pixel` 启动独立本地测试服务，验证最新默认包、13 个代表形象、属性约束、PNG 实际下载及每个放大像素、JSON 往返、七种历史恢复、旧规格迁移和失败重试。它使用独立浏览器上下文，不覆盖历史 QA 报告。构建后使用 `npm run verify:pixel:built` 对生产产物执行相同往返与导出检查；网络故障注入在开发测试中执行，生产 PNG 可能被内联。

两套工坊通过动态入口分别加载，共享 React 与契约依赖。入口加载失败会显示重新加载按钮。`npm run verify:loading` 先构建最新 creator 产物，再检查启动依赖图不包含两套工坊、每个 JS 分块低于 500 kB，并用实际网络请求验证按需加载、跨工坊跳转及模块失败恢复。

[原 v1/v2 接入文档](pixel-art.md) 保留作为 1.2.1 及更早版本的历史说明；其中“当前”的范围限定在该历史交付。
