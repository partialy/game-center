# AI-Game 项目指南

项目是桌面浏览器上的本地对战网站，技术栈为 React、Vite、TypeScript 和 Canvas 2D。《坦克大战》已支持同屏、五档内置 AI（含 Lv.5 终极 Boss「地狱使者」）、自定义 AI 工坊和 2～8 席乱斗。

应用由 `index.html` 和 `src/main.tsx` 启动，项目脚本提供 `dev` 和 `build`。

大厅页头和浏览器标签使用 [圆形 ICO](src/assets/ai-game-certer-icon_round.ico)。《坦克大战》战场精灵贴图位于 `src/assets/tank-battle/`（`256×256` RGBA WebP），由 `src/games/tank-battle/render/tankSprites.ts` 负责异步解码、按玩家涂装离线染色缓存并与碰撞箱等比对齐。

## 按任务查阅

- 设计大厅、赛前设置、玩家资料、按键、游戏接入或持久化时，先读[多游戏平台架构与开发计划](docs/platform-architecture-plan.md)。平台计划也定义了目录结构和编码规范。
- 实现坦克移动、迷宫、弹道、道具、计分或回合流程时，先读[坦克大战游戏设计与开发计划](docs/tank-battle-plan.md)。坦克规则及其默认数值集中维护在该计划中。
- 修改内置 AI、战场预测、Boss 选人或脚本工坊时，先读[坦克 AI 战术改造计划](docs/tank-ai-tactics-refactor-plan.md)。核心模块分布于 `src/games/tank-battle/ai/`（`physicsPrediction.ts`、`threatMap.ts`、`routePlanner.ts`、`maneuverPlanner.ts`、`shotPlanner.ts`、`botScripts.ts`、`aiSdk.ts`），核对物理规则用 `src/games/tank-battle/rules.ts` 和模拟源码。

## 开发约定

- React 管理页面、表单和 HUD。游戏模拟通过玩家动作推进，Canvas 读取模拟结果绘制。平台通过游戏注册入口接入各个游戏。
- 玩家按稳定标识组织。游戏使用动作名接收输入，键位由各玩家的映射决定。规则在开赛时形成整场比赛使用的快照。
- 平台契约 `BotModelDefinition.difficultyLevel` 支持 `1..5` 及可选 `isBoss` 与集中定义的 `BOSS_TIER_THEME`；`GameRenderer` 支持可选 `setDebugMode` 在 `F3` / `Ctrl+Shift+D` 调试模式下绘制 AI 战术叠加层并统计单步 AI 耗时。
- 变更游戏接入契约、目录职责或关键流程时，同步维护本指南与对应计划。
- 开发阶段默认做与改动相关的类型检查和编译检查。各阶段的功能验收场景供用户试玩时使用。
