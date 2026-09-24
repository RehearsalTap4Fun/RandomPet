# QMonsterCreator

猫型组合创作工具，包含毛绒与像素两套工作台。工程根目录为 `C:/Project/QMonsterCreator`。

## 当前能力（2026-09-24）

| 入口／资源 | 当前版本与范围 |
|---|---|
| 像素工坊 `/pixel` | 新用户默认正式猫包 1.6.1；28 套基础形象、63 张资源、35,840 个登记组合。支持九项属性选择、64/128px 透明 PNG、形象 JSON 保存恢复与加载重试 |
| 历史像素形象 | 保留 v1/v2 的七种正式／候选身份，按存档的完整美术版本恢复 |
| 毛绒工坊 `/` | 保留 6 花纹、3 表情、288 异变组合，共 5,184 种；支持锁定重掷和规格导入导出 |
| 独立场景包 | scene 1.0.0 已正式晋升；三张 96×64 背景与独立合成器。运行时换包与部署状态见交接记录 |

像素猫的基础形象范围：标准体型支持六毛色、两眼型、两表情；短腿和修长体型支持橘白、小尖牙、两眼型。35,840 是登记的合法组合集合，视觉验收采用代表样本。

- [像素工作台与当前接入说明](docs/integration/pixel-workbench.md)
- [场景与消费端交接状态](docs/integration/nutri-codex-exchange.md)

## 启动与验证

```sh
npm ci
npm run dev
```

打开 [像素工坊](http://127.0.0.1:4184/pixel) 或 [毛绒工坊](http://127.0.0.1:4184/)。类型检查使用 `npm run typecheck`；`npm test` 包含 Vitest 与 Node 素材几何测试；`npm run verify:pixel` 验证当前工坊的真实浏览器交互和下载；完整构建使用 `npm run build`。

## 目录结构

```text
QMonsterCreator/
├─ apps/creator-web/             工作台：index.html、src/main.tsx、src/styles.css
├─ packages/
│  ├─ generator-core/            严格规格、确定性生成、重掷与互斥
│  ├─ asset-catalog/             目录解析及 v0.10.0 素材
│  ├─ renderer-canvas/           共享渲染、固定定位与导出
│  └─ incubator-adapter/         孵化 SDK：生成、保存身份、恢复
├─ docs/
│  ├─ integration/               接入指南、示例和精确快照
│  ├─ art/                       历史经验与制作规范
│  ├─ releases/v0.10.0/          迁移清单、原始批准及溯源
│  └─ qa/                        当前验证记录
├─ scripts/                     构建与验证工具
└─ dist/                        构建产物（Git 忽略）
   ├─ creator/                  可独立发布的工作台
   ├─ hatchery/                 可独立发布的旧孵化 SDK 与 44 张素材
   ├─ pixel-art/                当前与历史像素包、对应 SDK
   └─ pixel-scene/              独立场景候选／正式产物
```

正式工程的运行、依赖安装、构建和验证均不依赖工作树。历史试验保留在原工作树，未带入当前发布目录。

- [孵化项目接入指南](docs/integration/qmonster-hatchery-integration.md)
- [美术制作规则](docs/art/feline-composition-guidelines.md)
- [迁移与兼容说明](docs/releases/v0.10.0/README.md)

工程包版本与毛绒素材目录为 `0.10.0`，像素猫美术版本为 `1.6.1`，场景独立版本为 `1.0.0`。毛绒存档中的原协议标识保留兼容；扩展选项后，相同 seed 重新生成可能改变异变，恢复时必须使用完整存档中的 selections。详见接入指南。

本批按要求只做小范围验证：`npm run verify:mutations` 固定检查 18 个代表样本，不遍历全部组合。结果与原图入口见[批次验收记录](docs/qa/mutation-batch1/README.md)。
