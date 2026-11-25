import type {
  GameSession,
  HudState,
  InputFrame,
  MatchLaunchSnapshot,
  MatchResultEvent,
  PlayerConfig,
  SessionStepResult,
  SoundEventKind,
} from '../../../platform/games/contracts';
import { decayVisualEffects, stepProjectilesAndMines, expireProjectiles } from '../combat/projectiles';
import { processWeaponActions, updateTankAmmoReload } from '../combat/weapons';
import { expireFieldDrops, updateItemDropSpawner } from '../items/drops';
import { expireTankEffects, processItemPickups } from '../items/effects';
import { generateMazeFromCodeOrParams } from '../map/generateMaze';
import { deriveSeed, DeterministicRng } from '../map/rng';
import { selectSpawnPoints } from '../map/spawnPoints';
import { buildTankHudState } from '../ui/hud';
import type { SpawnPoint, TankBattleRules, TankWorldState } from '../types';
import { updateTankMovement } from './movement';
import { TankReplayRecorder } from './replayRecorder';
import {
  buildMatchResult,
  createInitialWorld,
  resetRoundEntities,
  settleRoundStep,
} from './round';

/**
 * 《坦克大战》对局会话：完全脱离 DOM/React 运行。
 * 严格按照开发计划中的单步顺序推进每一固定模拟步：
 * 1. 处理到期效果、弹体、掉落物与补弹
 * 2. 更新坦克转向与位移，解决墙体与坦克阻挡，处理道具拾取
 * 3. 处理开火与地雷布放
 * 4. 推进弹体与追踪，引爆破片弹与地雷，计算激光路径与普通弹抵消
 * 5. 提交本步所有淘汰并结算比分/平局/限时，若仍交战则执行道具刷新尝试
 */
export class TankBattleSession implements GameSession<TankWorldState> {
  private readonly world: TankWorldState;
  private readonly players: PlayerConfig[];
  private readonly fixedSpawns: SpawnPoint[];
  private readonly spawnRng: DeterministicRng;
  private readonly dropRng: DeterministicRng;
  private readonly tieBreakRng: DeterministicRng;
  private readonly replayRecorder = new TankReplayRecorder();
  private entityIdSeq = 1;
  private matchResult: MatchResultEvent | null = null;
  private recordedRoundStartNumber = 0;

  constructor(snapshot: MatchLaunchSnapshot<TankBattleRules>) {
    // 冻结配置与玩家快照，防止外部引用变动污染进行中的对局
    const frozenRules: TankBattleRules = { ...snapshot.rules };
    this.players = snapshot.players.map((p) => ({
      ...p,
      bindings: { ...p.bindings },
    }));

    const maze = generateMazeFromCodeOrParams({
      mapCode: frozenRules.mapCode,
      cols: frozenRules.gridCols,
      rows: frozenRules.gridRows,
      extraPassages: frozenRules.extraPassages,
      fallbackSeed: snapshot.sessionSeed,
    });
    frozenRules.mapCode = maze.mapCode;

    // 出生点、道具刷新、同刻平手裁决各自使用独立随机流，互不影响地图地形
    const fixedSpawnRng = new DeterministicRng(deriveSeed(maze.seed, 101));
    this.fixedSpawns = selectSpawnPoints(maze, this.players.length, fixedSpawnRng);
    this.spawnRng = new DeterministicRng(deriveSeed(snapshot.sessionSeed, 202));
    this.dropRng = new DeterministicRng(deriveSeed(snapshot.sessionSeed, 303));
    this.tieBreakRng = new DeterministicRng(deriveSeed(snapshot.sessionSeed, 404));

    this.world = createInitialWorld(
      frozenRules,
      maze,
      this.players,
      this.fixedSpawns,
      this.spawnRng
    );
    this.recordRoundStartIfNeeded();
  }

  private recordRoundStartIfNeeded(): void {
    if (this.world.phase !== 'playing') return;
    if (this.recordedRoundStartNumber === this.world.roundNumber) return;
    this.recordedRoundStartNumber = this.world.roundNumber;
    this.replayRecorder.recordSnapshot(
      this.world,
      'round_start',
      `第 ${this.world.roundNumber} 回合开战`
    );
  }

  private readonly nextId = (): number => {
    const id = this.entityIdSeq;
    this.entityIdSeq += 1;
    return id;
  };

  step(dtSeconds: number, input: InputFrame): SessionStepResult {
    const sounds: SoundEventKind[] = [];
    const world = this.world;

    // 衰减屏幕震动
    if (world.screenShakeTrauma > 0) {
      world.screenShakeTrauma = Math.max(0, world.screenShakeTrauma - dtSeconds * 1.8);
    }

    // 命中顿帧（hitstop）期间仅推进视觉表现，不消耗战斗逻辑时间
    if (world.hitstopTimer > 0) {
      world.hitstopTimer = Math.max(0, world.hitstopTimer - dtSeconds);
      decayVisualEffects(world, dtSeconds);
      return { sounds };
    }

    if (world.phase === 'match_over') {
      decayVisualEffects(world, dtSeconds);
      return { sounds };
    }

    // 倒数阶段：仅推进倒数计时，不开放移动、开火、补弹或道具刷新
    if (world.phase === 'countdown') {
      const prevCeil = Math.ceil(world.countdownRemaining);
      world.countdownRemaining = Math.max(0, world.countdownRemaining - dtSeconds);
      const nextCeil = Math.ceil(world.countdownRemaining);
      if (world.countdownRemaining <= 0) {
        world.phase = 'playing';
        sounds.push('countdown_go');
        this.recordRoundStartIfNeeded();
      } else if (nextCeil < prevCeil && nextCeil > 0) {
        sounds.push('countdown_tick');
      }
      return { sounds };
    }

    // 回合结束展示阶段：保留爆炸视觉，计时结束后进入下一回合
    if (world.phase === 'round_over') {
      decayVisualEffects(world, dtSeconds);
      world.roundOverTimer = Math.max(0, world.roundOverTimer - dtSeconds);
      if (world.roundOverTimer <= 0) {
        world.roundNumber += 1;
        resetRoundEntities(world, this.players, this.fixedSpawns, this.spawnRng);
        this.recordRoundStartIfNeeded();
      }
      return { sounds };
    }

    // ===== 正式交战步进 =====
    this.recordRoundStartIfNeeded();
    world.battleTime += dtSeconds;

    // 步骤 1：处理到期效果、弹体与掉落物，补充到时的弹药
    expireTankEffects(world.tanks, world.battleTime);
    expireProjectiles(world);
    expireFieldDrops(world);
    updateTankAmmoReload(world.tanks, world.battleTime, world.rules);

    // 步骤 2：计算车辆旋转和位移，解决墙体与坦克阻挡，处理道具拾取
    updateTankMovement(world.tanks, world.maze, world.rules, input, dtSeconds);
    processItemPickups(world, this.tieBreakRng, sounds);

    // 步骤 3：处理开火与地雷布放（含瞬发激光命中收集）
    const eliminatedSet = new Set<string>();
    processWeaponActions(world, input, eliminatedSet, this.nextId, sounds);

    // 步骤 4：推进弹体与追踪、普通弹抵消、破片引爆与地雷触发
    stepProjectilesAndMines(world, dtSeconds, eliminatedSet, this.nextId, sounds);
    decayVisualEffects(world, dtSeconds);

    // 步骤 5：统一结算本步淘汰与回合限时；若仍交战则执行到时的道具刷新
    const settlement = settleRoundStep(world, this.players, eliminatedSet, sounds);

    // 记录本步快照事件（精彩事件或周期关键帧）
    this.replayRecorder.recordStep(
      world,
      sounds,
      eliminatedSet,
      settlement.roundResult?.reason
    );

    if (settlement.matchResult) {
      settlement.matchResult.replay = this.replayRecorder.exportReplay(world);
      this.matchResult = settlement.matchResult;
    }

    if (world.phase === 'playing') {
      updateItemDropSpawner(world, this.dropRng, this.nextId);
    }

    return {
      roundResult: settlement.roundResult,
      matchResult: settlement.matchResult,
      sounds,
    };
  }

  getWorldState(): TankWorldState {
    return this.world;
  }

  getHudState(): HudState {
    return buildTankHudState(this.world);
  }

  getMatchResult(): MatchResultEvent | null {
    if (this.matchResult) return this.matchResult;
    if (this.world.phase === 'match_over') {
      const res = buildMatchResult(this.world, this.players);
      res.replay = this.replayRecorder.exportReplay(this.world);
      this.matchResult = res;
      return this.matchResult;
    }
    return null;
  }
}
