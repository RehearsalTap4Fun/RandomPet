# 不规则涂鸦背景 · 美术验收

状态：用户于 2026-09-20 回复「ok」并通过本批美术；当前为 `art-approved-registration-pending`，尚未新增表现型字段、升级 catalog 或登记正式像素包。

## 三档候选

- `doodle-horizon`（N）：米白横向涂抹块和两笔短弧。
- `doodle-leaf-shadow`（R）：浅绿底与叶影笔触。
- `doodle-rainbow-trail`（L）：浅紫底、青橙虹弧和米白星轨。

三张均为 64×64、二值 alpha、单一四邻连通区域；参考以太猫使用多段圆润横带构成横向不规则涂抹块，猫遮住中部后主要从头顶和身体两侧露出。四边保留透明空白，边界分别为 N `[2,9]-[62,53]`、R `[2,9]-[62,53]`、L `[1,8]-[62,54]`，面积分别为 1928、1996、2175px。L 档底色相对亮度为 0.662，三种装饰色分别为 0.508、0.469、0.832，均满足设计门槛。

## 21 格验收

- 前 18 格：三档背景分别搭配 `orange-white`、`brown-tabby`、`tuxedo`、`calico`、`colorpoint`、`rosetted` 六种毛色。
- 后 3 格：三档背景分别搭配光环、颈膜、羽翼和焰尾满配组合。
- 页面：`index.html`。每格同时显示 3 倍最近邻预览与原生 64px，并可切换深浅页面底色。

## 合成边界

QA 以正式 `packages/asset-catalog/pixel/v3/approved-1.5.0/catalog.approved.json` 为基础，把候选背景临时插入为第一个 `frame` 绘制操作，再调用正式 `pixel-rgba-v1` 合成器。候选没有写入生产 profile、coverage 或资源表，正式 1.5.0 和 Nutri 运行时均未修改。

`report.json` 固定三张候选的文件摘要、几何与明度统计，以及 21 个组合的 PNG／RGBA SHA-256。
