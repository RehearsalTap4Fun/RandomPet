# QMonsterCreator

猫型组合生成器：6 种花纹、3 套完整表情、48 种合法异变组合，共 864 种。工程根目录为 `C:/Project/QMonsterCreator`。

## 启动与验证

```sh
npm ci
npm run dev
```

打开 [小猫组合工坊](http://127.0.0.1:4184/)。类型检查使用 `npm run typecheck`，测试使用 `npm test`，构建使用 `npm run build`。

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
   └─ hatchery/                 可独立发布的 SDK 与 39 张素材
```

正式工程的运行、依赖安装、构建和验证均不依赖工作树。历史试验保留在原工作树，未带入当前发布目录。

- [孵化项目接入指南](docs/integration/qmonster-hatchery-integration.md)
- [美术制作规则](docs/art/feline-composition-guidelines.md)
- [迁移与兼容说明](docs/releases/v0.10.0/README.md)

包版本和素材目录为 `0.10.0`。存档中的原协议标识保留兼容，避免目录迁移改变 seed 结果；详见接入指南。
