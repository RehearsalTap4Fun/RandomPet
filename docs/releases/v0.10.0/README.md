# 根目录工程 · v0.10.0

2026-09-15，按用户要求将现行组合实现迁入项目根目录，并使用正式应用入口与目录命名。

## 已迁入内容

- `apps/creator-web/index.html`、`src/main.tsx` 与 `src/styles.css`，默认首页直接进入当前工作台。
- 生成核心、目录管理、共享渲染及孵化适配器四个 workspace 包。
- `packages/asset-catalog/catalog/v0.10.0/` 和 `assets/v0.10.0/`：39 张 PNG 的原始字节全部保留。
- 当前接入文档、可运行示例、独立 SDK 构建、聚焦测试和迁移验证工具。
- 当前资源的来源、提示词、原始尾巴批准、批准时源码和渲染报告，按内容哈希存入 `provenance/`。

迁移前后路径及哈希见 [migration.json](migration.json)。共享旧版工具和历史实验资料保留在原工作树；当前工程不引用它们运行。根目录原有早期文档未覆盖。

## 兼容边界

目录和 package 版本使用 `0.10.0`，但 `feline-combination-v1` 的原 `catalogVersion` 数据值保持不变，随机子流也保持原实现。现有规格可直接导入。孵化 SDK 额外识别唯一一个迁移前精确封装身份，将其无损恢复后归一到当前快照；未知身份仍拒绝。

素材人工批准保留原始范围。迁移不会把所有 pending 元数据改写为 approved，也不会改写历史签认记录。新的根目录工程使用独立精确快照，不修改旧 v0.9 release 指针。

## 验证证据

- `npm run build`：类型检查、工作台生产构建和独立孵化 SDK 构建通过。
- `npm test`：83 项原有规则与渲染测试通过。
- [工作台检查](../../qa/workbench-verification.json)：锁定、互斥、导入导出、透明 PNG、非法规格与缺图处理。
- [导入并发检查](../../qa/import-race-verification.json)：异步文件读取不会覆盖更新的操作。
- [接入检查](../../qa/integration-verification.json)：生成、JSON 回放、缓存、并发和错误路径。
- [迁移检查](../../qa/root-migration-verification.json)：全部 864 个组合与迁移前 RGBA 逐项一致；39 张素材哈希不变；生产工作台和 SDK 仅访问构建产物即可运行，旧封装恢复图像不变。

`render-baseline.json` 为迁移前报告提取的规格与像素哈希，原始完整报告另保存在 provenance 中。`previous-snapshot.json` 为迁移前接入身份，供严格兼容使用，不是当前资源入口。
