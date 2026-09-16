# 像素正式化验收入口

运行 `npm run dev` 后打开 `/pixel`。默认显示已验收包 1.1.0 的 14 个组合，保留历史首批与候选版本供旧存档还原；可导出 64px／128px 透明 PNG 或带美术版本的形象 JSON。

用户回复“验收通过”，首批 4 个及第二阶段 10 个组合均已验收，14 个组合全部可生成。验收记录：`docs/qa/flat-source-trial/stage2/approval.json`。历史候选版本的待验收标记保留其当时状态，不代表当前版本状态。

- `pixel-workbench.png`：新工坊截图。
- `portable-consumer.png`：独立资源包消费端截图。
- `report.json`：浏览器校验与真实下载记录。
- `appearance.json`：短腿叠加组合的存档样例。
- PNG：测试中实际下载的 64px、128px 图片。

重跑：先 `npm run build`，再 `npm run verify:pixel`。完整接入说明见 `docs/integration/pixel-art.md`。
