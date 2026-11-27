# AI-Game 项目指南

项目是桌面浏览器上的本地对战网站，技术栈为 React、Vite、TypeScript 和 Canvas 2D。《坦克大战》已支持同屏、五档内置 AI（含 Lv.5 终极 Boss「地狱使者」）、自定义 AI 工坊和 2～8 席乱斗。

应用由 `index.html` 和 `src/main.tsx` 启动，项目脚本提供 `dev` 和 `build`。

大厅页头和浏览器标签使用 [圆形 ICO](src/assets/ai-game-certer-icon_round.ico)。《坦克大战》战场精灵贴图位于 `src/assets/tank-battle/`（`256×256` RGBA WebP），由 `src/games/tank-battle/render/tankSprites.ts` 负责异步解码、按玩家涂装离线染色缓存并与碰撞箱等比对齐。

《星渊火柴人决斗》的透明 PNG 位于 `src/assets/stickman-duel/`。`src/games/stickman-duel/render/stickmanSprites.ts` 集中维护 6 种道具和 2 种飞行物的素材，战场、军械库和训练台共用道具图。Canvas 按持武手或飞行物位置定位贴图，并绘制弹道、尾焰及其他动态特效。

火柴人移动由 `src/games/stickman-duel/simulation/world.ts` 按固定时间步插值水平速度，使用碰撞后的地面速度推进步态。`src/games/stickman-duel/render/stickmanPose.ts` 根据地面接触与速度生成并混合待机、走跑、起跳、滞空、下落和落地的 IK 姿态帧。

## 按任务查阅

- 设计大厅、赛前设置、玩家资料、按键、游戏接入或持久化时，先读[多游戏平台架构与开发计划](docs/platform-architecture-plan.md)。平台计划也定义了目录结构和编码规范。
- 实现坦克移动、迷宫、弹道、道具、计分或回合流程时，先读[坦克大战游戏设计与开发计划](docs/tank-battle-plan.md)。坦克规则及其默认数值集中维护在该计划中。
- 修改内置 AI、战场预测、Boss 选人或脚本工坊时，先读[坦克 AI 战术改造计划](docs/tank-ai-tactics-refactor-plan.md)。核心模块分布于 `src/games/tank-battle/ai/`（`physicsPrediction.ts`、`threatMap.ts`、`routePlanner.ts`、`maneuverPlanner.ts`、`shotPlanner.ts`、`botScripts.ts`、`aiSdk.ts`），核对物理规则用 `src/games/tank-battle/rules.ts` 和模拟源码。

## 开发约定

- React 管理页面、表单和 HUD。游戏模拟通过玩家动作推进，Canvas 读取模拟结果绘制。平台通过游戏注册入口接入各个游戏。
- 玩家按稳定标识组织。游戏使用动作名接收输入，键位由各玩家的映射决定。规则在开赛时形成整场比赛使用的快照。
- 平台契约 `BotModelDefinition.difficultyLevel` 支持 `1..5` 及可选 `isBoss` 与集中定义的 `BOSS_TIER_THEME`；`GameRenderer` 支持可选 `setDebugMode` 在 `F3` / `Ctrl+Shift+D` 调试模式下绘制 AI 战术叠加层并统计单步 AI 耗时。
- 移动端与平板支持：`src/platform/mobile/MobileViewportContext.tsx` 负责触控设备识别、竖屏下 CSS 90° 强制横屏容器与触摸坐标映射及全屏横屏辅助；`InputFrame.getMoveVector` 与 `src/platform/input/virtualInput.ts` 提供 `360°` 连续模拟摇杆与按住连发脉冲；`src/platform/ui/MobileArenaHud.tsx` 隐藏移动端顶部厚 HUD，将时间与工具按钮居中置顶（2 人两侧贴迷你比分，3～8 席乱斗分列左右最边缘）、弹药/道具贴左上右上边缘、回合贴左下、地图 ID 贴右下；`src/platform/ui/VirtualControls.tsx` 为单人对战渲染左区浮动摇杆与可拖拽自定义位置的独立开火按键，支持 `10%–80%` 透明度调节并持久化。
- 变更游戏接入契约、目录职责或关键流程时，同步维护本指南与对应计划。
- 开发阶段默认做与改动相关的类型检查和编译检查。各阶段的功能验收场景供用户试玩时使用。
