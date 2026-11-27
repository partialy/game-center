import type {
  GameSession,
  HudState,
  InputFrame,
  MatchLaunchSnapshot,
  MatchResultEvent,
  PlayerConfig,
  PlayerHudEntry,
  PlayerMatchStats,
  PlayerSlotId,
  SessionStepResult,
  SoundEventKind,
} from '../../../platform/games/contracts';
import { DeterministicRng } from '../../tank-battle/map/rng';
import {
  buildStickmanTerrain,
  destroyTerrainInRadius,
  findValidDropSurface,
  moveBodyWithTerrain,
  sampleProjectileTerrainHit,
} from '../map/terrain';
import {
  encodeStickmanMapCode,
  parseStickmanMapCode,
  resolveConcreteTemplate,
} from '../rules';
import type {
  FighterAttackKind,
  GroundPickup,
  StickFighter,
  StickPickupKind,
  StickmanDuelRules,
  StickmanWorld,
} from '../types';
import {
  PICKUP_ACCENTS,
  PICKUP_LABELS,
  applyMedkitHeal,
  computeRocketSplash,
  getWeaponMaxCharges,
  resolveEightWayAim,
  swapFighterWeapon,
} from './combat';

const FIGHTER_HALF_WIDTH = 13;
const FIGHTER_HEIGHT = 54;
const COYOTE_TIME_SECONDS = 0.085;
const JUMP_BUFFER_SECONDS = 0.095;
const DROP_THROUGH_SECONDS = 0.19;
const PICKUP_INTERACT_RADIUS = 56;
const PICKUP_DROP_OFFSET_Y = 46;
const ROUND_OVER_BANNER_SECONDS = 2.1;

function createEmptyStats(): PlayerMatchStats {
  return {
    kills: 0,
    selfEliminations: 0,
    deaths: 0,
    shotsFired: 0,
    hitsLanded: 0,
    itemsPicked: 0,
    itemsUsed: 0,
    itemUsageByKind: {},
  };
}

function createFighter(
  config: PlayerConfig,
  spawnX: number,
  spawnY: number,
  facing: -1 | 1,
  maxHp: number
): StickFighter {
  const scarf = Array.from({ length: 5 }, (_, idx) => ({
    x: spawnX - facing * idx * 5,
    y: spawnY - FIGHTER_HEIGHT + 11,
  }));
  return {
    slotId: config.slotId,
    config,
    x: spawnX,
    y: spawnY,
    vx: 0,
    vy: 0,
    halfWidth: FIGHTER_HALF_WIDTH,
    height: FIGHTER_HEIGHT,
    facing,
    aimX: facing,
    aimY: 0,
    hp: maxHp,
    maxHp,
    displayHp: maxHp,
    alive: true,
    onGround: false,
    onPlatform: false,
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    jumpsUsed: 0,
    maxJumps: 2,
    dropThroughTimer: 0,
    runPhase: 0,
    airSpinAngle: 0,
    hitStunTimer: 0,
    hitFlashTimer: 0,
    invulnTimer: 0,
    swapCooldown: 0,
    attackCooldown: 0,
    comboStep: 0,
    comboResetTimer: 0,
    attack: null,
    weapon: null,
    scarf,
    nearbyDropId: null,
    nearbyDropLabel: null,
    koSpin: 0,
    koTimer: 0,
  };
}

export class StickmanDuelSession implements GameSession<StickmanWorld> {
  private readonly snapshot: MatchLaunchSnapshot<StickmanDuelRules>;
  private readonly rules: StickmanDuelRules;
  private readonly rng: DeterministicRng;
  private readonly baseMapSeed: number;
  private readonly fixedTemplate: Exclude<StickmanDuelRules['mapTemplate'], 'random'> | null;
  private world: StickmanWorld;
  private nextEntityId = 1;
  private dropSpawnTimer = 0;
  private roundOverTimer = 0;
  private matchResult: MatchResultEvent | null = null;
  private lastDamagedBy = new Map<PlayerSlotId, PlayerSlotId>();

  constructor(snapshot: MatchLaunchSnapshot<StickmanDuelRules>) {
    this.snapshot = snapshot;
    this.rules = { ...snapshot.rules };
    this.rng = new DeterministicRng(snapshot.sessionSeed ^ 0x51a9c3d1);

    const parsedCode = parseStickmanMapCode(this.rules.mapCode ?? '');
    if (parsedCode) {
      this.baseMapSeed = parsedCode.seed;
      this.fixedTemplate = parsedCode.template;
    } else {
      this.baseMapSeed = (snapshot.sessionSeed >>> 0) || 0x20260701;
      this.fixedTemplate =
        this.rules.mapTemplate === 'random' ? null : this.rules.mapTemplate;
    }

    const scores: Record<PlayerSlotId, number> = {};
    const stats: Record<PlayerSlotId, PlayerMatchStats> = {};
    for (const p of snapshot.players) {
      scores[p.slotId] = 0;
      stats[p.slotId] = createEmptyStats();
    }

    const initialTerrain = this.buildRoundTerrain(1);
    const mapCode = encodeStickmanMapCode(initialTerrain.template, this.baseMapSeed);

    this.world = {
      phase: this.rules.countdownSeconds > 0 ? 'countdown' : 'playing',
      roundNumber: 1,
      targetScore: this.rules.targetScore,
      countdownSeconds: this.rules.countdownSeconds,
      battleElapsedSeconds: 0,
      roundTimeRemainingSeconds: this.rules.roundTimeLimitEnabled
        ? this.rules.roundTimeLimitSeconds
        : null,
      totalBattleSeconds: 0,
      mapCode,
      terrain: initialTerrain,
      fighters: this.spawnFightersForTerrain(initialTerrain, 1),
      pickups: [],
      projectiles: [],
      particles: [],
      slashes: [],
      explosions: [],
      floatingTexts: [],
      scores,
      stats,
      drawRounds: 0,
      roundBanner: null,
      hitstopTimer: 0,
      shakeIntensity: 0,
      shakeDirX: 0,
      shakeDirY: 0,
      rules: this.rules,
    };

    this.dropSpawnTimer = this.rules.firstDropDelaySeconds;
    // 开局按刷新位置策略（默认随机/可选中间）预先投放 1 件初始武器
    this.spawnInitialWeapon();
  }

  private buildRoundTerrain(roundNumber: number) {
    const roundSeed = this.fixedTemplate
      ? this.baseMapSeed
      : (this.baseMapSeed + Math.imul(roundNumber - 1, 0x9e3779b1)) >>> 0;
    const tpl = this.fixedTemplate ?? resolveConcreteTemplate(this.rules.mapTemplate, roundSeed);
    return buildStickmanTerrain(tpl, roundSeed, this.snapshot.players.length);
  }

  private spawnFightersForTerrain(
    terrain: StickmanWorld['terrain'],
    roundNumber: number
  ): StickFighter[] {
    const players = this.snapshot.players;
    const useLowerPair = players.length === 2 && roundNumber % 2 === 0;
    return players.map((config, idx) => {
      // 2 人模式：奇数回合上左/上右四角短平台，偶数回合下右/下左对角轮换；3~8 人依次占满四角再补中场
      const spIdx =
        players.length === 2
          ? useLowerPair
            ? idx === 0
              ? 3
              : 2
            : idx
          : idx;
      const sp = terrain.spawnPoints[spIdx % terrain.spawnPoints.length] ?? {
        x: terrain.width * (idx === 0 ? 0.2 : 0.8),
        y: terrain.height - terrain.tileSize,
      };
      const facing: -1 | 1 = sp.x < terrain.width * 0.5 ? 1 : -1;
      return createFighter(config, sp.x, sp.y, facing, this.rules.maxHp);
    });
  }

  private spawnPickupByMode(kind: StickPickupKind, lifetime: number): void {
    const mode = this.rules.dropSpawnMode === 'center' ? 'center' : 'random';
    const avoidPoints: Array<{ x: number; y: number }> = [
      ...this.world.pickups.map((p) => ({ x: p.x, y: p.y })),
      ...this.world.fighters.filter((f) => f.alive).map((f) => ({ x: f.x, y: f.y })),
    ];
    const spot = findValidDropSurface(this.world.terrain, mode, this.rng, avoidPoints);
    const max = kind === 'medkit' ? 1 : getWeaponMaxCharges(kind, this.rules);
    const spawnY = Math.max(24, spot.surfaceY - PICKUP_DROP_OFFSET_Y);

    this.world.pickups.push({
      id: this.nextEntityId++,
      kind,
      remaining: max,
      max,
      x: spot.x,
      y: spawnY,
      vx: 0,
      vy: 0,
      radius: 15,
      onGround: false,
      age: 0,
      lifetime,
      pickupLockTimer: 0,
      droppedBySlotId: null,
    });

    this.spawnSparkBurst(spot.x, spawnY, 0, -1, 6, PICKUP_ACCENTS[kind]);
  }

  private spawnInitialWeapon(): void {
    const enabled = this.getEnabledWeaponKinds();
    if (enabled.length === 0) return;
    const kind = enabled[Math.floor(this.rng.next() * enabled.length)];
    this.spawnPickupByMode(kind, 32);
  }

  private getEnabledWeaponKinds(): Array<'sword' | 'pistol' | 'rocket'> {
    const out: Array<'sword' | 'pistol' | 'rocket'> = [];
    if (this.rules.enableSword) out.push('sword');
    if (this.rules.enablePistol) out.push('pistol');
    if (this.rules.enableRocket) out.push('rocket');
    return out;
  }

  private getEnabledPickupPool(): StickPickupKind[] {
    const out: StickPickupKind[] = [];
    if (this.rules.enableSword) out.push('sword', 'sword');
    if (this.rules.enablePistol) out.push('pistol', 'pistol');
    if (this.rules.enableRocket) out.push('rocket');
    if (this.rules.enableMedkit) out.push('medkit');
    return out;
  }

  getWorldState(): StickmanWorld {
    return this.world;
  }

  getMatchResult(): MatchResultEvent | null {
    return this.matchResult;
  }

  getHudState(): HudState {
    const players: PlayerHudEntry[] = this.world.fighters.map((f) => {
      const statusItems = [];
      if (f.weapon) {
        statusItems.push({
          id: `weapon-${f.weapon.kind}`,
          label: PICKUP_LABELS[f.weapon.kind],
          valueText: `${f.weapon.remaining}/${f.weapon.max}`,
          remainingCharges: f.weapon.remaining,
          maxCharges: f.weapon.max,
          iconKey: f.weapon.kind,
          tone: (f.weapon.kind === 'rocket' ? 'warning' : 'offense') as 'warning' | 'offense',
        });
      }
      return {
        slotId: f.slotId,
        displayName: f.config.displayName,
        colorHex: f.config.colorHex,
        score: this.world.scores[f.slotId] ?? 0,
        alive: f.alive,
        ammo: f.weapon ? f.weapon.remaining : 0,
        maxAmmo: f.weapon ? f.weapon.max : 0,
        reloadProgress: 0,
        hp: Math.max(0, Math.ceil(f.hp)),
        maxHp: f.maxHp,
        weaponKind: f.weapon?.kind ?? null,
        weaponLabel: f.weapon ? PICKUP_LABELS[f.weapon.kind] : undefined,
        weaponCount: f.weapon?.remaining ?? 0,
        weaponMaxCount: f.weapon?.max ?? 0,
        nearbyPickupLabel: f.nearbyDropLabel,
        statusItems,
      };
    });

    return {
      phase: this.world.phase,
      roundNumber: this.world.roundNumber,
      targetScore: this.world.targetScore,
      countdownSeconds: this.world.countdownSeconds,
      battleElapsedSeconds: this.world.battleElapsedSeconds,
      roundTimeRemainingSeconds: this.world.roundTimeRemainingSeconds,
      mapCode: this.world.mapCode,
      players,
      roundBanner: this.world.roundBanner,
    };
  }

  step(dtSeconds: number, input: InputFrame): SessionStepResult {
    const sounds: SoundEventKind[] = [];
    const dt = Math.min(0.05, Math.max(0, dtSeconds));

    // 相机震屏衰减（即使在顿帧中也可微幅释放视觉张力）
    if (this.world.shakeIntensity > 0) {
      this.world.shakeIntensity = Math.max(0, this.world.shakeIntensity - dt * 36);
    }

    if (this.world.phase === 'match_over') {
      this.updateEffects(dt);
      return { sounds, matchResult: this.matchResult ?? undefined };
    }

    // 1. 回合倒计时
    if (this.world.phase === 'countdown') {
      const prevCeil = Math.ceil(this.world.countdownSeconds);
      this.world.countdownSeconds = Math.max(0, this.world.countdownSeconds - dt);
      const nextCeil = Math.ceil(this.world.countdownSeconds);
      if (nextCeil < prevCeil && nextCeil > 0) {
        sounds.push('countdown_tick');
      }
      // 倒计时期间允许角色落地稳定 & 初始掉落下落
      this.updatePickups(dt);
      for (const f of this.world.fighters) {
        this.stepPassiveFighterPhysics(f, dt);
      }
      if (this.world.countdownSeconds <= 0) {
        this.world.phase = 'playing';
        sounds.push('countdown_go');
      }
      this.updateEffects(dt);
      return { sounds };
    }

    // 2. 回合结束展示（含慢动作 KO 飞出）
    if (this.world.phase === 'round_over') {
      const slowDt = dt * 0.42;
      for (const f of this.world.fighters) {
        this.stepPassiveFighterPhysics(f, slowDt);
      }
      this.updatePickups(slowDt);
      this.updateEffects(dt);
      this.roundOverTimer = Math.max(0, this.roundOverTimer - dt);
      if (this.world.roundBanner) {
        this.world.roundBanner = {
          ...this.world.roundBanner,
          nextRoundInSeconds: this.roundOverTimer,
        };
      }
      if (this.roundOverTimer <= 0) {
        this.startNextRound();
      }
      return { sounds };
    }

    // 3. 顿帧（Hitstop）：命中重击时短暂停顿，极具打击张力
    if (this.world.hitstopTimer > 0) {
      this.world.hitstopTimer = Math.max(0, this.world.hitstopTimer - dt);
      this.updateEffects(dt * 0.35);
      return { sounds };
    }

    // 4. 正常实战推进
    this.world.battleElapsedSeconds += dt;
    this.world.totalBattleSeconds += dt;

    if (this.world.roundTimeRemainingSeconds !== null) {
      this.world.roundTimeRemainingSeconds = Math.max(
        0,
        this.world.roundTimeRemainingSeconds - dt
      );
      if (this.world.roundTimeRemainingSeconds <= 0) {
        return this.finishRoundByTimeout(sounds);
      }
    }

    // 空投武器与血包刷新
    this.stepDropSpawner(dt);

    // 角色输入、移动、跳跃、动作与拾取/换武器
    for (const fighter of this.world.fighters) {
      if (!fighter.alive) {
        this.stepPassiveFighterPhysics(fighter, dt);
        continue;
      }
      this.stepActiveFighter(fighter, dt, input, sounds);
    }

    // 弹体推进与碰撞（手枪直线 / 火箭受重力抛物线）
    this.stepProjectiles(dt, sounds);

    // 地面道具重力下落、弹跳与生命周期
    this.updatePickups(dt);

    // 更新每位玩家身边最近的可拾取/换武器提示 + 自动拾取血包（残血时）
    this.refreshNearbyPickupsAndAutoMedkit(sounds);

    // 视觉特效粒子衰减
    this.updateEffects(dt);

    // 胜负判定
    const roundOutcome = this.checkRoundEnd(sounds);
    return {
      sounds,
      roundResult: roundOutcome.roundResult,
      matchResult: roundOutcome.matchResult,
    };
  }

  private stepDropSpawner(dt: number): void {
    const pool = this.getEnabledPickupPool();
    if (pool.length === 0 || this.rules.maxDropsOnField <= 0) return;

    this.dropSpawnTimer -= dt;
    if (this.dropSpawnTimer > 0) return;

    if (this.world.pickups.length < this.rules.maxDropsOnField) {
      const kind = pool[Math.floor(this.rng.next() * pool.length)];
      this.spawnPickupByMode(kind, 30);
    }

    const minI = this.rules.dropIntervalMinSeconds;
    const maxI = Math.max(minI, this.rules.dropIntervalMaxSeconds);
    this.dropSpawnTimer = minI + this.rng.next() * (maxI - minI);
  }

  private stepPassiveFighterPhysics(f: StickFighter, dt: number): void {
    f.vy += this.rules.gravity * dt;
    f.vx *= Math.pow(0.08, dt);
    moveBodyWithTerrain(this.world.terrain, f, dt, false, f.alive ? 0 : 0.35);
    if (!f.alive) {
      f.koTimer += dt;
      f.koSpin += f.vx * dt * 0.028;
    }
    this.updateScarf(f, dt);
    this.smoothDisplayHp(f, dt);
  }

  private smoothDisplayHp(f: StickFighter, dt: number): void {
    if (f.displayHp > f.hp) {
      f.displayHp = Math.max(f.hp, f.displayHp - Math.max(28, (f.displayHp - f.hp) * 3.8) * dt);
    } else {
      f.displayHp = f.hp;
    }
  }

  private stepActiveFighter(
    f: StickFighter,
    dt: number,
    input: InputFrame,
    sounds: SoundEventKind[]
  ): void {
    // 计时器更新
    f.hitFlashTimer = Math.max(0, f.hitFlashTimer - dt);
    f.invulnTimer = Math.max(0, f.invulnTimer - dt);
    f.swapCooldown = Math.max(0, f.swapCooldown - dt);
    f.attackCooldown = Math.max(0, f.attackCooldown - dt);
    f.dropThroughTimer = Math.max(0, f.dropThroughTimer - dt);
    if (f.comboResetTimer > 0) {
      f.comboResetTimer = Math.max(0, f.comboResetTimer - dt);
      if (f.comboResetTimer === 0) f.comboStep = 0;
    }

    // 1. 采样移动与 8 向瞄准向量（兼容 360° 虚拟摇杆与双人键盘）
    const stick = input.getMoveVector?.(f.slotId) ?? null;
    const moveLeft = input.getAction(f.slotId, 'moveLeft').held;
    const moveRight = input.getAction(f.slotId, 'moveRight').held;
    const aimUp = input.getAction(f.slotId, 'aimUp').held;
    const aimDown = input.getAction(f.slotId, 'aimDown').held;

    let dirX = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);
    let dirY = (aimDown ? 1 : 0) - (aimUp ? 1 : 0);

    if (stick && stick.magnitude > 0.14) {
      dirX = stick.x * stick.magnitude;
      dirY = stick.y * stick.magnitude;
    }

    const jumpAct = input.getAction(f.slotId, 'jump');
    const attackAct = input.getAction(f.slotId, 'attack');
    const kickAct = input.getAction(f.slotId, 'kick');
    const swapAct = input.getAction(f.slotId, 'swap');

    if (jumpAct.justPressed) {
      f.jumpBufferTimer = JUMP_BUFFER_SECONDS;
    } else {
      f.jumpBufferTimer = Math.max(0, f.jumpBufferTimer - dt);
    }

    const inHitStun = f.hitStunTimer > 0;
    if (inHitStun) {
      f.hitStunTimer = Math.max(0, f.hitStunTimer - dt);
    }

    // 更新朝向与 8 向瞄准（受击硬直时锁朝向）
    if (!inHitStun && !f.attack) {
      if (dirX > 0.18) f.facing = 1;
      else if (dirX < -0.18) f.facing = -1;
    }
    const aim = resolveEightWayAim(dirX, dirY, f.facing);
    f.aimX = aim.x;
    f.aimY = aim.y;

    // 2. 水平速度控制
    if (!inHitStun) {
      const targetVx = Math.abs(dirX) > 0.14 ? Math.sign(dirX) * Math.min(1, Math.abs(dirX) * 1.15) * this.rules.moveSpeed : 0;
      const accel = f.onGround ? 2400 : 1450;
      const maxDelta = accel * dt;
      const diff = targetVx - f.vx;
      if (Math.abs(diff) <= maxDelta) {
        f.vx = targetVx;
      } else {
        f.vx += Math.sign(diff) * maxDelta;
      }
      if (f.onGround && Math.abs(f.vx) > 25) {
        f.runPhase += Math.abs(f.vx) * dt * 0.055;
      }
    } else {
      f.vx *= Math.pow(0.18, dt);
    }

    // 3. 土狼时间 + 二段跳 + 下穿短平台
    if (f.onGround) {
      f.coyoteTimer = COYOTE_TIME_SECONDS;
      f.jumpsUsed = 0;
      f.airSpinAngle = 0;
    } else {
      f.coyoteTimer = Math.max(0, f.coyoteTimer - dt);
    }

    const holdingDown = dirY > 0.55;
    if (!inHitStun && f.jumpBufferTimer > 0) {
      if (holdingDown && f.onGround && f.onPlatform) {
        // 下 + 跳：主动下穿短平台
        f.dropThroughTimer = DROP_THROUGH_SECONDS;
        f.y += 4;
        f.vy = Math.max(f.vy, 110);
        f.onGround = false;
        f.onPlatform = false;
        f.coyoteTimer = 0;
        f.jumpBufferTimer = 0;
        sounds.push('stick_jump');
      } else if (f.coyoteTimer > 0 || f.jumpsUsed < f.maxJumps) {
        const isDoubleJump = f.coyoteTimer <= 0 && f.jumpsUsed > 0;
        f.vy = -this.rules.jumpVelocity * (isDoubleJump ? 0.93 : 1);
        f.onGround = false;
        f.onPlatform = false;
        f.coyoteTimer = 0;
        f.jumpBufferTimer = 0;
        f.jumpsUsed = isDoubleJump ? f.maxJumps : 1;
        if (isDoubleJump) {
          f.airSpinAngle = 0.01;
        }
        this.spawnDustBurst(f.x, f.y, isDoubleJump ? 7 : 5, isDoubleJump ? f.config.colorHex : '#CBD5E1');
        sounds.push('stick_jump');
      }
    }

    if (!f.onGround && f.airSpinAngle > 0) {
      f.airSpinAngle += dt * Math.PI * 5.2;
      if (f.airSpinAngle >= Math.PI * 2) {
        f.airSpinAngle = 0;
      }
    }

    // 4. 拾取 / 换武器（右 / B）
    if (!inHitStun && swapAct.justPressed && f.swapCooldown <= 0) {
      this.tryManualPickupOrSwap(f, sounds);
    }

    // 5. 触发攻击：左键=空手出拳或持武攻击；上键=踢腿击飞
    if (!inHitStun && !f.attack && f.attackCooldown <= 0) {
      if (kickAct.justPressed) {
        this.startAttack(f, 'kick', sounds);
      } else if (attackAct.justPressed) {
        const atkKind: FighterAttackKind = f.weapon ? f.weapon.kind : 'punch';
        this.startAttack(f, atkKind, sounds);
      }
    }

    // 6. 推进当前攻击状态机（挥击/射击判定）
    if (f.attack) {
      this.stepFighterAttack(f, dt, sounds);
    }

    // 7. 重力与地形碰撞
    const wasOnGround = f.onGround;
    const prevVy = f.vy;
    f.vy += this.rules.gravity * dt;
    moveBodyWithTerrain(this.world.terrain, f, dt, f.dropThroughTimer > 0, 0);
    if (!wasOnGround && f.onGround && prevVy > 260) {
      this.spawnDustBurst(f.x, f.y, 4, '#94A3B8');
    }

    this.updateScarf(f, dt);
    this.smoothDisplayHp(f, dt);
  }

  private startAttack(
    f: StickFighter,
    kind: FighterAttackKind,
    sounds: SoundEventKind[]
  ): void {
    const aimX = f.aimX;
    const aimY = f.aimY;
    if (Math.abs(aimX) > 0.1) {
      f.facing = aimX > 0 ? 1 : -1;
    }

    if (kind === 'punch') {
      const step = f.comboStep % 3;
      f.comboStep = (f.comboStep + 1) % 3;
      f.comboResetTimer = 0.52;
      f.attack = {
        kind: 'punch',
        elapsed: 0,
        totalDuration: step === 2 ? 0.25 : 0.19,
        startup: 0.045,
        activeEnd: 0.125,
        aimX: f.facing,
        aimY: 0,
        hitSlotIds: [],
        comboStep: step,
        projectileFired: false,
      };
      f.vx += f.facing * (step === 2 ? 125 : 65);
      sounds.push('stick_punch');
      this.world.slashes.push({
        x: f.x + f.facing * 22,
        y: f.y - f.height * 0.62,
        angle: f.facing > 0 ? 0 : Math.PI,
        radius: step === 2 ? 26 : 20,
        arcSpan: 1.05,
        color: f.config.colorHex,
        age: 0,
        maxAge: 0.11,
        kind: 'punch',
      });
    } else if (kind === 'kick') {
      f.attack = {
        kind: 'kick',
        elapsed: 0,
        totalDuration: 0.3,
        startup: 0.065,
        activeEnd: 0.17,
        aimX: f.facing,
        aimY: -0.28,
        hitSlotIds: [],
        comboStep: 0,
        projectileFired: false,
      };
      f.vx += f.facing * 140;
      sounds.push('stick_kick');
      this.world.slashes.push({
        x: f.x + f.facing * 24,
        y: f.y - f.height * 0.45,
        angle: f.facing > 0 ? -0.25 : Math.PI + 0.25,
        radius: 32,
        arcSpan: 1.5,
        color: '#F59E0B',
        age: 0,
        maxAge: 0.15,
        kind: 'kick',
      });
    } else if (kind === 'sword') {
      f.attack = {
        kind: 'sword',
        elapsed: 0,
        totalDuration: 0.27,
        startup: 0.05,
        activeEnd: 0.16,
        aimX: f.facing,
        aimY: 0,
        hitSlotIds: [],
        comboStep: f.comboStep % 2,
        projectileFired: false,
      };
      f.comboStep = (f.comboStep + 1) % 2;
      f.comboResetTimer = 0.6;
      f.vx += f.facing * 115;
      sounds.push('stick_sword');
      this.world.slashes.push({
        x: f.x + f.facing * 18,
        y: f.y - f.height * 0.56,
        angle: f.facing > 0 ? 0 : Math.PI,
        radius: 56,
        arcSpan: 2.05,
        color: PICKUP_ACCENTS.sword,
        age: 0,
        maxAge: 0.16,
        kind: 'sword',
      });
    } else if (kind === 'pistol') {
      f.attack = {
        kind: 'pistol',
        elapsed: 0,
        totalDuration: 0.24,
        startup: 0.03,
        activeEnd: 0.08,
        aimX,
        aimY,
        hitSlotIds: [],
        comboStep: 0,
        projectileFired: false,
      };
    } else if (kind === 'rocket') {
      f.attack = {
        kind: 'rocket',
        elapsed: 0,
        totalDuration: 0.36,
        startup: 0.05,
        activeEnd: 0.12,
        aimX,
        aimY,
        hitSlotIds: [],
        comboStep: 0,
        projectileFired: false,
      };
    }
  }

  private stepFighterAttack(
    f: StickFighter,
    dt: number,
    sounds: SoundEventKind[]
  ): void {
    const atk = f.attack;
    if (!atk) return;
    atk.elapsed += dt;

    // 远程武器在 startup 时刻发射
    if ((atk.kind === 'pistol' || atk.kind === 'rocket') && !atk.projectileFired && atk.elapsed >= atk.startup) {
      atk.projectileFired = true;
      this.fireRangedWeapon(f, atk.kind, atk.aimX, atk.aimY, sounds);
    }

    // 近战生效窗口：拳 / 踢 / 剑
    if (
      (atk.kind === 'punch' || atk.kind === 'kick' || atk.kind === 'sword') &&
      atk.elapsed >= atk.startup &&
      atk.elapsed <= atk.activeEnd
    ) {
      const reach = atk.kind === 'sword' ? 68 : atk.kind === 'kick' ? 46 : 38;
      const heightReach = atk.kind === 'sword' ? 52 : 42;
      const hitCenterX = f.x + f.facing * (reach * 0.56);
      const hitCenterY = f.y - f.height * (atk.kind === 'kick' ? 0.44 : 0.58);

      for (const target of this.world.fighters) {
        if (target.slotId === f.slotId || !target.alive || target.invulnTimer > 0) continue;
        if (atk.hitSlotIds.includes(target.slotId)) continue;

        const targetCenterY = target.y - target.height * 0.5;
        const dx = Math.abs(target.x - hitCenterX);
        const dy = Math.abs(targetCenterY - hitCenterY);
        if (dx <= reach * 0.54 + target.halfWidth && dy <= heightReach * 0.55 + target.height * 0.38) {
          atk.hitSlotIds.push(target.slotId);
          this.applyMeleeHit(f, target, atk.kind, atk.comboStep, sounds);
        }
      }
    }

    if (atk.elapsed >= atk.totalDuration) {
      f.attack = null;
      f.attackCooldown = atk.kind === 'punch' ? 0.04 : 0.08;
    }
  }

  private fireRangedWeapon(
    f: StickFighter,
    kind: 'pistol' | 'rocket',
    aimX: number,
    aimY: number,
    sounds: SoundEventKind[]
  ): void {
    const len = Math.hypot(aimX, aimY) || 1;
    const nx = aimX / len;
    const ny = aimY / len;
    const muzzleX = f.x + nx * 26;
    const muzzleY = f.y - f.height * 0.62 + ny * 22;

    const stats = this.world.stats[f.slotId];
    if (stats) {
      stats.shotsFired += 1;
      stats.itemsUsed += 1;
      stats.itemUsageByKind[kind] = (stats.itemUsageByKind[kind] ?? 0) + 1;
    }

    if (kind === 'pistol') {
      const speed = this.rules.pistolSpeed;
      this.world.projectiles.push({
        id: this.nextEntityId++,
        kind: 'pistol',
        ownerSlotId: f.slotId,
        colorHex: f.config.colorHex,
        x: muzzleX,
        y: muzzleY,
        prevX: muzzleX,
        prevY: muzzleY,
        vx: nx * speed,
        vy: ny * speed,
        radius: 4.5,
        damage: this.rules.pistolDamage,
        knockback: 265,
        gravityScale: 0, // 手枪直线无重力
        age: 0,
        maxAge: 2.2,
        blastRadius: 0,
      });
      // 轻后坐力 + 弹壳粒子
      f.vx -= nx * 70;
      this.world.particles.push({
        x: f.x + nx * 10,
        y: muzzleY - 2,
        vx: -nx * 70 + (this.rng.next() - 0.5) * 40,
        vy: -135 - this.rng.next() * 40,
        size: 3.5,
        color: '#FBBF24',
        alpha: 1,
        age: 0,
        maxAge: 0.45,
        gravity: 620,
        kind: 'shell',
        rotation: 0,
        vRot: 14,
      });
      this.spawnSparkBurst(muzzleX, muzzleY, nx, ny, 6, '#FDE047');
      this.addShake(3.2, -nx, -ny);
      sounds.push('stick_pistol');
    } else {
      const speed = this.rules.rocketSpeed;
      this.world.projectiles.push({
        id: this.nextEntityId++,
        kind: 'rocket',
        ownerSlotId: f.slotId,
        colorHex: f.config.colorHex,
        x: muzzleX,
        y: muzzleY,
        prevX: muzzleX,
        prevY: muzzleY,
        vx: nx * speed,
        vy: ny * speed,
        radius: 7,
        damage: this.rules.rocketDamage,
        knockback: 640,
        gravityScale: 1, // 火箭筒受重力影响
        age: 0,
        maxAge: 4.5,
        blastRadius: this.rules.rocketBlastRadius,
      });
      // 强后坐力
      f.vx -= nx * 210;
      f.vy -= ny * 110;
      this.spawnSparkBurst(muzzleX - nx * 20, muzzleY - ny * 20, -nx, -ny, 9, '#FB923C');
      this.addShake(5.5, -nx, -ny);
      sounds.push('stick_rocket');
    }

    // 消耗弹药；打空自动卸下武器
    if (f.weapon && f.weapon.kind === kind) {
      f.weapon.remaining -= 1;
      if (f.weapon.remaining <= 0) {
        f.weapon = null;
      }
    }
  }

  private applyMeleeHit(
    attacker: StickFighter,
    target: StickFighter,
    kind: 'punch' | 'kick' | 'sword',
    comboStep: number,
    sounds: SoundEventKind[]
  ): void {
    const dir = attacker.facing;
    let damage = this.rules.punchDamage;
    let kbX = dir * 240;
    let kbY = -165;
    let hitstop = 0.04;
    let stun = 0.16;
    let shake = 4.2;

    if (kind === 'punch' && comboStep === 2) {
      damage = Math.round(this.rules.punchDamage * 1.3);
      kbX = dir * 350;
      kbY = -240;
      hitstop = 0.055;
      stun = 0.22;
      shake = 6.2;
    } else if (kind === 'kick') {
      damage = this.rules.kickDamage;
      kbX = dir * this.rules.kickKnockback;
      kbY = -340;
      hitstop = 0.068;
      stun = 0.28;
      shake = 7.8;
    } else if (kind === 'sword') {
      damage = this.rules.swordDamage;
      kbX = dir * 390;
      kbY = -255;
      hitstop = 0.072;
      stun = 0.24;
      shake = 7.5;
    }

    const attackerStats = this.world.stats[attacker.slotId];
    if (attackerStats) {
      attackerStats.hitsLanded += 1;
      if (kind === 'sword') {
        attackerStats.itemsUsed += 1;
        attackerStats.itemUsageByKind.sword = (attackerStats.itemUsageByKind.sword ?? 0) + 1;
      }
    }

    // 长剑耐久制：击中对手一次扣 1 点（挥空不掉），默认 5 点，归零碎裂
    if (kind === 'sword' && attacker.weapon && attacker.weapon.kind === 'sword') {
      attacker.weapon.remaining -= 1;
      if (attacker.weapon.remaining <= 0) {
        this.spawnSparkBurst(
          attacker.x + dir * 30,
          attacker.y - attacker.height * 0.55,
          dir,
          -0.3,
          14,
          '#38BDF8'
        );
        this.world.floatingTexts.push({
          x: attacker.x,
          y: attacker.y - attacker.height - 16,
          vy: -42,
          text: '剑碎!',
          color: '#38BDF8',
          scale: 0.95,
          age: 0,
          maxAge: 0.85,
        });
        attacker.weapon = null;
      }
    }

    this.dealDamage(attacker.slotId, target, damage, kbX, kbY, stun, hitstop, shake, sounds);
  }

  private dealDamage(
    attackerSlotId: PlayerSlotId,
    target: StickFighter,
    damage: number,
    kbX: number,
    kbY: number,
    stunSeconds: number,
    hitstopSeconds: number,
    shakePower: number,
    sounds: SoundEventKind[]
  ): boolean {
    if (!target.alive || target.invulnTimer > 0) return false;
    target.hp = Math.max(0, target.hp - damage);
    target.vx = kbX;
    target.vy = kbY;
    target.onGround = false;
    target.onPlatform = false;
    target.hitStunTimer = Math.max(target.hitStunTimer, stunSeconds);
    target.hitFlashTimer = 0.12;
    const invulnDuration = Math.max(0, this.rules.hurtInvulnSeconds ?? 0.1);
    if (invulnDuration > 0) {
      target.invulnTimer = Math.max(target.invulnTimer, invulnDuration);
    }
    target.attack = null;

    if (attackerSlotId !== target.slotId) {
      this.lastDamagedBy.set(target.slotId, attackerSlotId);
    }

    const impactX = target.x;
    const impactY = target.y - target.height * 0.55;
    const dirLen = Math.hypot(kbX, kbY) || 1;
    this.spawnSparkBurst(
      impactX,
      impactY,
      kbX / dirLen,
      kbY / dirLen,
      damage >= 25 ? 16 : 9,
      damage >= 25 ? '#F97316' : '#FEF08A'
    );

    this.world.floatingTexts.push({
      x: impactX + (this.rng.next() - 0.5) * 16,
      y: target.y - target.height - 10,
      vy: -62,
      text: `-${damage}`,
      color: damage >= 25 ? '#EF4444' : '#F59E0B',
      scale: damage >= 25 ? 1.3 : 1.0,
      age: 0,
      maxAge: 0.78,
    });

    this.world.hitstopTimer = Math.max(this.world.hitstopTimer, hitstopSeconds);
    this.addShake(shakePower, kbX / dirLen, kbY / dirLen);
    if (damage >= 14) {
      sounds.push('stick_hit_heavy');
    }

    if (target.hp <= 0) {
      this.eliminateFighter(target, attackerSlotId, sounds);
    }
    return true;
  }

  private eliminateFighter(
    victim: StickFighter,
    killerSlotId: PlayerSlotId,
    sounds: SoundEventKind[]
  ): void {
    victim.alive = false;
    victim.hp = 0;
    victim.attack = null;
    victim.vy = Math.min(victim.vy, -380);
    victim.vx = (victim.vx >= 0 ? 1 : -1) * Math.max(Math.abs(victim.vx), 320);

    // KO 掉落手中武器，保持战场生态真实
    if (victim.weapon && victim.weapon.remaining > 0) {
      this.world.pickups.push({
        id: this.nextEntityId++,
        kind: victim.weapon.kind,
        remaining: victim.weapon.remaining,
        max: victim.weapon.max,
        x: victim.x,
        y: victim.y - victim.height * 0.5,
        vx: -victim.facing * 100,
        vy: -240,
        radius: 15,
        onGround: false,
        age: 0,
        lifetime: 24,
        pickupLockTimer: 0.3,
        droppedBySlotId: victim.slotId,
      });
      victim.weapon = null;
    }

    const vStats = this.world.stats[victim.slotId];
    if (vStats) vStats.deaths += 1;

    const effectiveKiller =
      killerSlotId === victim.slotId
        ? this.lastDamagedBy.get(victim.slotId) ?? victim.slotId
        : killerSlotId;

    const kStats = this.world.stats[effectiveKiller];
    if (kStats) {
      if (effectiveKiller === victim.slotId) {
        kStats.selfEliminations += 1;
      } else {
        kStats.kills += 1;
      }
    }

    this.world.hitstopTimer = Math.max(this.world.hitstopTimer, 0.12);
    this.addShake(11, victim.vx > 0 ? 1 : -1, -0.5);
    this.spawnSparkBurst(victim.x, victim.y - victim.height * 0.5, 0, -1, 22, victim.config.colorHex);
    this.world.floatingTexts.push({
      x: victim.x,
      y: victim.y - victim.height - 18,
      vy: -48,
      text: 'K.O.!',
      color: '#EF4444',
      scale: 1.5,
      age: 0,
      maxAge: 1.15,
    });
    sounds.push('explosion');
  }

  private stepProjectiles(dt: number, sounds: SoundEventKind[]): void {
    for (let i = this.world.projectiles.length - 1; i >= 0; i -= 1) {
      const proj = this.world.projectiles[i];
      proj.age += dt;
      proj.prevX = proj.x;
      proj.prevY = proj.y;

      if (proj.gravityScale > 0) {
        proj.vy += this.rules.rocketGravity * proj.gravityScale * dt;
        // 火箭飞行烟迹
        if (Math.floor(proj.age * 60) % 2 === 0) {
          this.world.particles.push({
            x: proj.x - proj.vx * 0.015,
            y: proj.y - proj.vy * 0.015,
            vx: (this.rng.next() - 0.5) * 28,
            vy: (this.rng.next() - 0.5) * 28 - 16,
            size: 5.5 + this.rng.next() * 3.5,
            color: '#94A3B8',
            alpha: 0.72,
            age: 0,
            maxAge: 0.42,
            gravity: -35,
            kind: 'smoke',
            rotation: 0,
            vRot: 0,
          });
        }
      }

      // 子步防高速子弹穿薄砖/穿人
      const speed = Math.hypot(proj.vx, proj.vy);
      const subSteps = Math.max(1, Math.min(5, Math.ceil((speed * dt) / 14)));
      const subDt = dt / subSteps;
      let impacted = false;
      let hitFighter: StickFighter | null = null;

      for (let s = 0; s < subSteps; s += 1) {
        proj.x += proj.vx * subDt;
        proj.y += proj.vy * subDt;

        // 1. 命地形检测
        const tileHit = sampleProjectileTerrainHit(this.world.terrain, proj.x, proj.y);
        if (tileHit !== 'empty') {
          impacted = true;
          break;
        }

        // 2. 命中角色检测（无敌保护期间免疫子弹命中与击退）
        for (const f of this.world.fighters) {
          if (!f.alive || f.invulnTimer > 0) continue;
          if (f.slotId === proj.ownerSlotId && proj.age < 0.14) continue;
          const withinX = Math.abs(proj.x - f.x) <= f.halfWidth + proj.radius;
          const withinY = proj.y >= f.y - f.height - proj.radius && proj.y <= f.y + proj.radius;
          if (withinX && withinY) {
            impacted = true;
            hitFighter = f;
            break;
          }
        }
        if (impacted) break;
      }

      if (impacted || proj.age >= proj.maxAge) {
        if (proj.kind === 'rocket') {
          this.detonateRocket(proj.x, proj.y, proj.ownerSlotId, proj.blastRadius, proj.damage, sounds);
        } else if (hitFighter) {
          const dirLen = Math.hypot(proj.vx, proj.vy) || 1;
          const landed = this.dealDamage(
            proj.ownerSlotId,
            hitFighter,
            proj.damage,
            (proj.vx / dirLen) * proj.knockback,
            Math.min(-150, (proj.vy / dirLen) * proj.knockback * 0.55 - 120),
            0.22,
            0.052,
            5.8,
            sounds
          );
          if (landed) {
            const ownerStats = this.world.stats[proj.ownerSlotId];
            if (ownerStats) ownerStats.hitsLanded += 1;
          }
        } else if (impacted) {
          this.spawnSparkBurst(proj.x, proj.y, -Math.sign(proj.vx || 1), -0.4, 7, '#FDE047');
          sounds.push('bounce');
        }
        this.world.projectiles.splice(i, 1);
      }
    }
  }

  private detonateRocket(
    cx: number,
    cy: number,
    ownerSlotId: PlayerSlotId,
    blastRadius: number,
    maxDamage: number,
    sounds: SoundEventKind[]
  ): void {
    // 1. 炸毁半径内所有砖块与短平台（底层基岩永久保留）
    const destroyed = destroyTerrainInRadius(this.world.terrain, cx, cy, blastRadius);
    if (destroyed.length > 0) {
      sounds.push('stick_block_break');
      for (const tile of destroyed) {
        for (let k = 0; k < 3; k += 1) {
          const angle = this.rng.next() * Math.PI * 2;
          const spd = 110 + this.rng.next() * 240;
          this.world.particles.push({
            x: tile.x + (this.rng.next() - 0.5) * 18,
            y: tile.y + (this.rng.next() - 0.5) * 18,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd - 160,
            size: tile.kind === 'platform' ? 7 : 9,
            color: tile.kind === 'platform' ? '#64748B' : '#B47B56',
            alpha: 1,
            age: 0,
            maxAge: 0.65 + this.rng.next() * 0.4,
            gravity: 960,
            kind: 'debris',
            rotation: this.rng.next() * Math.PI,
            vRot: (this.rng.next() - 0.5) * 14,
          });
        }
      }
    }

    // 2. 爆炸冲击波推开附近地面道具（让原本停在被炸平台上的武器立刻失重抛飞）
    for (const drop of this.world.pickups) {
      const dx = drop.x - cx;
      const dy = drop.y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist <= blastRadius * 1.4) {
        const push = (1 - dist / (blastRadius * 1.4)) * 320;
        const len = dist || 1;
        drop.vx += (dx / len) * push;
        drop.vy -= 180 + push * 0.5;
        drop.onGround = false;
      }
    }

    // 3. 大范围溅射伤害与强力放射击飞（受伤无敌期间同样完全免疫伤害与击退）
    let hitAnyone = false;
    for (const f of this.world.fighters) {
      if (!f.alive || f.invulnTimer > 0) continue;
      const fx = f.x;
      const fy = f.y - f.height * 0.5;
      const dx = fx - cx;
      const dy = fy - cy;
      const dist = Math.hypot(dx, dy);
      const splash = computeRocketSplash(dist, blastRadius, maxDamage);
      if (!splash) continue;

      const len = dist || 1;
      const kbSpeed = 620 * splash.knockbackScale;
      const kbX = (dx / len) * kbSpeed;
      const kbY = Math.min(-260, (dy / len) * kbSpeed - 220);

      const landed = this.dealDamage(
        ownerSlotId,
        f,
        splash.damage,
        kbX,
        kbY,
        0.34,
        0.095,
        13.5,
        sounds
      );
      if (landed && f.slotId !== ownerSlotId) {
        hitAnyone = true;
      }
    }

    if (hitAnyone) {
      const ownerStats = this.world.stats[ownerSlotId];
      if (ownerStats) ownerStats.hitsLanded += 1;
    }

    this.world.explosions.push({
      x: cx,
      y: cy,
      radius: blastRadius,
      age: 0,
      maxAge: 0.42,
      color: '#F97316',
    });
    this.spawnSparkBurst(cx, cy, 0, -1, 24, '#FB923C');
    this.addShake(14, 0, -1);
    sounds.push('explosion');
  }

  private updatePickups(dt: number): void {
    for (let i = this.world.pickups.length - 1; i >= 0; i -= 1) {
      const d = this.world.pickups[i];
      d.age += dt;
      d.pickupLockTimer = Math.max(0, d.pickupLockTimer - dt);
      if (d.age >= d.lifetime) {
        this.world.pickups.splice(i, 1);
        continue;
      }

      // 所有掉落武器与血包始终受重力影响（如果脚下砖块被炸毁会自动往下掉）
      d.vy += this.rules.gravity * 0.85 * dt;
      const body = {
        x: d.x,
        y: d.y + d.radius,
        vx: d.vx,
        vy: d.vy,
        halfWidth: d.radius * 0.8,
        height: d.radius * 1.6,
        onGround: d.onGround,
        onPlatform: false,
      };
      moveBodyWithTerrain(this.world.terrain, body, dt, false, 0.32);
      d.x = body.x;
      d.y = body.y - d.radius;
      d.vx = body.onGround ? body.vx * Math.pow(0.02, dt) : body.vx;
      d.vy = body.vy;
      d.onGround = body.onGround;
    }
  }

  private findClosestPickupFor(f: StickFighter, includeMedkit: boolean): GroundPickup | null {
    let best: GroundPickup | null = null;
    let bestDist = PICKUP_INTERACT_RADIUS;
    const fcY = f.y - f.height * 0.45;
    for (const d of this.world.pickups) {
      if (!includeMedkit && d.kind === 'medkit') continue;
      if (d.pickupLockTimer > 0 && d.droppedBySlotId === f.slotId) continue;
      const dist = Math.hypot(d.x - f.x, d.y - fcY);
      if (dist <= bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best;
  }

  private refreshNearbyPickupsAndAutoMedkit(sounds: SoundEventKind[]): void {
    for (const f of this.world.fighters) {
      if (!f.alive) {
        f.nearbyDropId = null;
        f.nearbyDropLabel = null;
        continue;
      }

      // 1. 血包在角色不满血且贴近时自动生效（恢复 25%，绝不顶掉手持武器）
      if (f.hp < f.maxHp) {
        const fcY = f.y - f.height * 0.45;
        for (let i = this.world.pickups.length - 1; i >= 0; i -= 1) {
          const d = this.world.pickups[i];
          if (d.kind !== 'medkit') continue;
          if (Math.hypot(d.x - f.x, d.y - fcY) <= 36) {
            this.consumeMedkit(f, i, sounds);
            break;
          }
        }
      }

      // 2. 更新附近武器提示（用于画布交互标签 & ABXY 右键脉冲提示）
      const nearWeapon = this.findClosestPickupFor(f, false);
      if (nearWeapon) {
        f.nearbyDropId = nearWeapon.id;
        f.nearbyDropLabel = `${f.weapon ? '换' : '捡'} ${PICKUP_LABELS[nearWeapon.kind]}`;
      } else {
        const nearMed = f.hp < f.maxHp ? this.findClosestPickupFor(f, true) : null;
        f.nearbyDropId = nearMed ? nearMed.id : null;
        f.nearbyDropLabel = nearMed ? '使用 血包' : null;
      }
    }
  }

  private consumeMedkit(f: StickFighter, pickupIndex: number, sounds: SoundEventKind[]): void {
    const healed = applyMedkitHeal(f, this.rules.medkitHealPercent);
    if (healed <= 0) return;
    this.world.pickups.splice(pickupIndex, 1);

    const stats = this.world.stats[f.slotId];
    if (stats) {
      stats.itemsPicked += 1;
      stats.itemsUsed += 1;
      stats.itemUsageByKind.medkit = (stats.itemUsageByKind.medkit ?? 0) + 1;
    }

    for (let k = 0; k < 10; k += 1) {
      const ang = (Math.PI * 2 * k) / 10;
      this.world.particles.push({
        x: f.x + Math.cos(ang) * 14,
        y: f.y - f.height * 0.5 + Math.sin(ang) * 16,
        vx: Math.cos(ang) * 35,
        vy: -55 - this.rng.next() * 45,
        size: 5,
        color: '#10B981',
        alpha: 1,
        age: 0,
        maxAge: 0.55,
        gravity: -40,
        kind: 'heal',
        rotation: 0,
        vRot: 0,
      });
    }
    this.world.floatingTexts.push({
      x: f.x,
      y: f.y - f.height - 14,
      vy: -52,
      text: `+${healed} HP`,
      color: '#10B981',
      scale: 1.15,
      age: 0,
      maxAge: 0.9,
    });
    sounds.push('stick_heal');
  }

  private tryManualPickupOrSwap(f: StickFighter, sounds: SoundEventKind[]): void {
    const near = this.findClosestPickupFor(f, true);
    if (!near) return;
    const idx = this.world.pickups.findIndex((p) => p.id === near.id);
    if (idx < 0) return;

    if (near.kind === 'medkit') {
      if (f.hp < f.maxHp) {
        this.consumeMedkit(f, idx, sounds);
        f.swapCooldown = 0.22;
      }
      return;
    }

    // 拾取/替换武器：原武器带剩余耐久/弹药抛落地面
    const picked = this.world.pickups[idx];
    this.world.pickups.splice(idx, 1);
    const droppedOld = swapFighterWeapon(f, picked, this.nextEntityId++);
    if (droppedOld) {
      this.world.pickups.push(droppedOld);
    }
    f.swapCooldown = 0.25;

    const stats = this.world.stats[f.slotId];
    if (stats) stats.itemsPicked += 1;

    this.world.floatingTexts.push({
      x: f.x,
      y: f.y - f.height - 12,
      vy: -44,
      text: `装备 ${PICKUP_LABELS[picked.kind]}`,
      color: PICKUP_ACCENTS[picked.kind],
      scale: 0.95,
      age: 0,
      maxAge: 0.8,
    });
    sounds.push('stick_swap');
  }

  private updateScarf(f: StickFighter, dt: number): void {
    const headX = f.x - f.facing * 2;
    const headY = f.y - f.height + 12;
    if (f.scarf.length === 0) return;
    f.scarf[0].x = headX;
    f.scarf[0].y = headY;
    const segLen = 5.5;
    for (let i = 1; i < f.scarf.length; i += 1) {
      const prev = f.scarf[i - 1];
      const curr = f.scarf[i];
      // 轻风后飘 + 重力下垂
      curr.x += (-f.facing * 65 - f.vx * 0.22) * dt;
      curr.y += (26 + Math.sin(this.world.battleElapsedSeconds * 9 + i) * 18) * dt;
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist > segLen) {
        curr.x = prev.x + (dx / dist) * segLen;
        curr.y = prev.y + (dy / dist) * segLen;
      }
    }
  }

  private spawnDustBurst(x: number, y: number, count: number, color: string): void {
    for (let i = 0; i < count; i += 1) {
      const ang = -Math.PI * (0.1 + this.rng.next() * 0.8);
      const spd = 35 + this.rng.next() * 75;
      this.world.particles.push({
        x: x + (this.rng.next() - 0.5) * 12,
        y: y - 2,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd * 0.6,
        size: 4 + this.rng.next() * 3,
        color,
        alpha: 0.65,
        age: 0,
        maxAge: 0.28 + this.rng.next() * 0.14,
        gravity: 80,
        kind: 'dust',
        rotation: 0,
        vRot: 0,
      });
    }
  }

  private spawnSparkBurst(
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    count: number,
    color: string
  ): void {
    const baseAngle = Math.atan2(dirY, dirX);
    for (let i = 0; i < count; i += 1) {
      const ang = baseAngle + (this.rng.next() - 0.5) * 2.1;
      const spd = 120 + this.rng.next() * 290;
      this.world.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 45,
        size: 2.5 + this.rng.next() * 3.5,
        color,
        alpha: 1,
        age: 0,
        maxAge: 0.22 + this.rng.next() * 0.24,
        gravity: 520,
        kind: 'spark',
        rotation: ang,
        vRot: 0,
      });
    }
  }

  private addShake(power: number, dirX: number, dirY: number): void {
    if (power >= this.world.shakeIntensity) {
      this.world.shakeIntensity = Math.min(18, power);
      this.world.shakeDirX = dirX;
      this.world.shakeDirY = dirY;
    }
  }

  private updateEffects(dt: number): void {
    for (let i = this.world.particles.length - 1; i >= 0; i -= 1) {
      const p = this.world.particles[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.world.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.vRot * dt;
    }

    for (let i = this.world.slashes.length - 1; i >= 0; i -= 1) {
      const s = this.world.slashes[i];
      s.age += dt;
      if (s.age >= s.maxAge) {
        this.world.slashes.splice(i, 1);
      }
    }

    for (let i = this.world.explosions.length - 1; i >= 0; i -= 1) {
      const e = this.world.explosions[i];
      e.age += dt;
      if (e.age >= e.maxAge) {
        this.world.explosions.splice(i, 1);
      }
    }

    for (let i = this.world.floatingTexts.length - 1; i >= 0; i -= 1) {
      const t = this.world.floatingTexts[i];
      t.age += dt;
      t.y += t.vy * dt;
      t.vy *= Math.pow(0.18, dt);
      if (t.age >= t.maxAge) {
        this.world.floatingTexts.splice(i, 1);
      }
    }
  }

  private checkRoundEnd(sounds: SoundEventKind[]): {
    roundResult?: SessionStepResult['roundResult'];
    matchResult?: MatchResultEvent;
  } {
    const alive = this.world.fighters.filter((f) => f.alive);
    if (alive.length > 1) return {};

    if (alive.length === 1) {
      return this.concludeRound(alive[0], '击倒全部对手', sounds);
    }
    return this.concludeRound(null, '同归于尽', sounds);
  }

  private finishRoundByTimeout(sounds: SoundEventKind[]): SessionStepResult {
    const alive = this.world.fighters.filter((f) => f.alive);
    alive.sort((a, b) => b.hp - a.hp);
    const winner =
      alive.length >= 2 && alive[0].hp === alive[1].hp
        ? null
        : alive[0] ?? null;
    const outcome = this.concludeRound(
      winner,
      winner ? '时间到 · 剩余血量领先' : '时间到 · 血量持平',
      sounds
    );
    return {
      sounds,
      roundResult: outcome.roundResult,
      matchResult: outcome.matchResult,
    };
  }

  private concludeRound(
    winner: StickFighter | null,
    reason: string,
    sounds: SoundEventKind[]
  ): {
    roundResult: NonNullable<SessionStepResult['roundResult']>;
    matchResult?: MatchResultEvent;
  } {
    if (winner) {
      this.world.scores[winner.slotId] = (this.world.scores[winner.slotId] ?? 0) + 1;
    } else {
      this.world.drawRounds += 1;
    }

    const roundResult = {
      roundNumber: this.world.roundNumber,
      winnerSlotId: winner?.slotId ?? null,
      isDraw: !winner,
      reason,
      scores: { ...this.world.scores },
    };

    const reachedTarget =
      winner !== null && (this.world.scores[winner.slotId] ?? 0) >= this.world.targetScore;

    if (reachedTarget) {
      this.world.phase = 'match_over';
      this.world.roundBanner = {
        roundNumber: this.world.roundNumber,
        isDraw: false,
        winnerSlotId: winner.slotId,
        winnerName: winner.config.displayName,
        winnerColor: winner.config.colorHex,
        reason,
        nextRoundInSeconds: 0,
      };
      this.matchResult = this.buildMatchResult([winner.slotId]);
      sounds.push('match_win');
      return { roundResult, matchResult: this.matchResult };
    }

    this.world.phase = 'round_over';
    this.roundOverTimer = ROUND_OVER_BANNER_SECONDS;
    this.world.roundBanner = {
      roundNumber: this.world.roundNumber,
      isDraw: !winner,
      winnerSlotId: winner?.slotId ?? null,
      winnerName: winner?.config.displayName ?? null,
      winnerColor: winner?.config.colorHex ?? null,
      reason,
      nextRoundInSeconds: this.roundOverTimer,
    };
    sounds.push(winner ? 'round_win' : 'round_draw');
    return { roundResult };
  }

  private startNextRound(): void {
    const nextRound = this.world.roundNumber + 1;
    const terrain = this.buildRoundTerrain(nextRound);
    this.lastDamagedBy.clear();

    this.world.roundNumber = nextRound;
    this.world.terrain = terrain;
    this.world.mapCode = encodeStickmanMapCode(
      terrain.template,
      this.fixedTemplate
        ? this.baseMapSeed
        : (this.baseMapSeed + Math.imul(nextRound - 1, 0x9e3779b1)) >>> 0
    );
    this.world.fighters = this.spawnFightersForTerrain(terrain, nextRound);
    this.world.pickups = [];
    this.world.projectiles = [];
    this.world.slashes = [];
    this.world.explosions = [];
    this.world.particles = [];
    this.world.floatingTexts = [];
    this.world.roundBanner = null;
    this.world.battleElapsedSeconds = 0;
    this.world.roundTimeRemainingSeconds = this.rules.roundTimeLimitEnabled
      ? this.rules.roundTimeLimitSeconds
      : null;
    this.world.countdownSeconds = this.rules.countdownSeconds;
    this.world.phase = this.rules.countdownSeconds > 0 ? 'countdown' : 'playing';
    this.dropSpawnTimer = this.rules.firstDropDelaySeconds;
    this.spawnInitialWeapon();
  }

  private buildMatchResult(winnerSlotIds: PlayerSlotId[]): MatchResultEvent {
    return {
      gameId: 'stickman-duel',
      winnerSlotIds,
      isTie: winnerSlotIds.length !== 1,
      scores: { ...this.world.scores },
      drawRounds: this.world.drawRounds,
      totalRounds: this.world.roundNumber,
      totalBattleSeconds: this.world.totalBattleSeconds,
      mapCode: this.world.mapCode,
      players: this.snapshot.players.map((p) => ({
        slotId: p.slotId,
        displayName: p.displayName,
        colorHex: p.colorHex,
        score: this.world.scores[p.slotId] ?? 0,
        controller: p.controller,
        aiModelName: p.aiModelName,
        stats: { ...(this.world.stats[p.slotId] ?? createEmptyStats()) },
      })),
    };
  }
}
