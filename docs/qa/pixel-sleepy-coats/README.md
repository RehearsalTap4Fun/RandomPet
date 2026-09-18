# 五种毛色 sleepy-almond 组合抽查

状态：工程回放通过，等待 15 格美术抽查；运行时保持关闭。

- 5 种毛色 × sleepy-almond × 2 表情 = 10 张新主体
- 新增 2,880 条 pending coverage；既有 5,184 条 approved/generatable 原样保留
- 眼型迁移限制在固定眼部区域，区域外 RGB 不变；alpha 继承已批准 sleepy-almond 模板
- 固定种子分层随机抽查：每种 3 格，共 15 格
