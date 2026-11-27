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
  destroySingleNearestTile,
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
  StickProjectile,
  StickmanDuelRules,
  StickmanWorld,
} from '../types';
import {
  PICKUP_ACCENTS,
  PICKUP_LABELS,
  applyMedkitHeal,
  computeGrenadeThrowVelocity,
  computeRocketSplash,
  getWeaponMaxCharges,
  isProjectileSlashable,
  resolveEightWayAim,
  resolveProjectileHitZone,
  swapFighterWeapon,
  type ProjectileHitZone,
} from './combat';

const FIGHTER_HALF_WIDTH = 13;
const FIGHTER_HEIGHT = 54;
const COYOTE_TIME_SECONDS = 0.085;
const JUMP_BUFFER_SECONDS = 0.095;
const DROP_THROUGH_SECONDS = 0.19;
const PICKUP_INTERACT_RADIUS = 56;
const PICKUP_DROP_OFFSET_Y = 46;
const GRENADE_BLAST_RADIUS = 38;
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
    lastHitVolleyId: null,
    recoilTimer: 0,
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
      projectileTrails: [],
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

  private getEnabledWeaponKinds(): Array<'sword' | 'pistol' | 'shotgun' | 'rocket' | 'grenade'> {
    const out: Array<'sword' | 'pistol' | 'shotgun' | 'rocket' | 'grenade'> = [];
    if (this.rules.enableSword) out.push('sword');
    if (this.rules.enablePistol) out.push('pistol');
    if (this.rules.enableShotgun) out.push('shotgun');
    if (this.rules.enableRocket) out.push('rocket');
    if (this.rules.enableGrenade) out.push('grenade');
    return out;
  }

  private getEnabledPickupPool(): StickPickupKind[] {
    const out: StickPickupKind[] = [];
    if (this.rules.enableSword) out.push('sword', 'sword');
    if (this.rules.enablePistol) out.push('pistol', 'pistol');
    if (this.rules.enableShotgun) out.push('shotgun', 'shotgun');
    if (this.rules.enableGrenade) out.push('grenade', 'grenade');
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
    if (f.invulnTimer <= 0) {
      f.lastHitVolleyId = null;
    }
    f.recoilTimer = Math.max(0, f.recoilTimer - dt);
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

    // 2. 水平速度控制（含猎枪后坐力滑移窗口，确保后退位移清晰可感）
    if (!inHitStun) {
      const hasMoveInput = Math.abs(dirX) > 0.14;
      const targetVx = hasMoveInput
        ? Math.sign(dirX) * Math.min(1, Math.abs(dirX) * 1.15) * this.rules.moveSpeed
        : 0;
      if (f.recoilTimer > 0 && !hasMoveInput) {
        f.vx *= Math.pow(0.06, dt);
      } else {
        const accel = f.recoilTimer > 0 ? 540 : f.onGround ? 2400 : 1450;
        const maxDelta = accel * dt;
        const diff = targetVx - f.vx;
        if (Math.abs(diff) <= maxDelta) {
          f.vx = targetVx;
        } else {
          f.vx += Math.sign(diff) * maxDelta;
        }
      }
      if (f.onGround && Math.abs(f.vx) > 25 && f.recoilTimer <= 0) {
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
    } else if (kind === 'shotgun') {
      f.attack = {
        kind: 'shotgun',
        elapsed: 0,
        totalDuration: 0.34,
        startup: 0.04,
        activeEnd: 0.1,
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
    } else if (kind === 'grenade') {
      f.attack = {
        kind: 'grenade',
        elapsed: 0,
        totalDuration: 0.3,
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
    if (
      (atk.kind === 'pistol' ||
        atk.kind === 'shotgun' ||
        atk.kind === 'rocket' ||
        atk.kind === 'grenade') &&
      !atk.projectileFired &&
      atk.elapsed >= atk.startup
    ) {
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

      // 长剑斩弹：挥剑可砍碎手枪/猎枪/手雷碎片等子弹（火箭筒不可砍），发出「叮」声并扣 1 耐久
      if (atk.kind === 'sword' && f.weapon?.kind === 'sword' && f.weapon.remaining > 0) {
        const slashHalfW = reach * 0.62;
        const slashHalfH = heightReach * 0.62;
        for (let pi = this.world.projectiles.length - 1; pi >= 0; pi -= 1) {
          if (!f.weapon || f.weapon.kind !== 'sword' || f.weapon.remaining <= 0) break;
          const proj = this.world.projectiles[pi];
          if (!isProjectileSlashable(proj.kind)) continue;
          if (proj.ownerSlotId === f.slotId && proj.age < 0.08) continue;

          const midX = (proj.prevX + proj.x) * 0.5;
          const midY = (proj.prevY + proj.y) * 0.5;
          const hitNow =
            Math.abs(proj.x - hitCenterX) <= slashHalfW + proj.radius &&
            Math.abs(proj.y - hitCenterY) <= slashHalfH + proj.radius;
          const hitMid =
            Math.abs(midX - hitCenterX) <= slashHalfW + proj.radius &&
            Math.abs(midY - hitCenterY) <= slashHalfH + proj.radius;
          if (!hitNow && !hitMid) continue;

          if (proj.kind === 'shotgun') {
            this.world.projectileTrails.push({
              x1: proj.originX,
              y1: proj.originY,
              x2: proj.x,
              y2: proj.y,
              color: '#FB923C',
              width: 3.0,
              age: 0,
              maxAge: 0.24,
            });
          }
          this.world.projectiles.splice(pi, 1);

          sounds.push('stick_sword_clang');
          this.spawnSparkBurst(proj.x, proj.y, -Math.sign(proj.vx || f.facing), -0.35, 11, '#E0F2FE');
          this.spawnSparkBurst(proj.x, proj.y, f.facing, -0.5, 6, '#FDE047');
          this.world.floatingTexts.push({
            x: proj.x,
            y: proj.y - 12,
            vy: -56,
            text: '叮!',
            color: '#38BDF8',
            scale: 1.08,
            age: 0,
            maxAge: 0.62,
          });
          this.world.hitstopTimer = Math.max(this.world.hitstopTimer, 0.032);
          this.addShake(3.2, f.facing, -0.2);

          const slashStats = this.world.stats[f.slotId];
          if (slashStats) {
            slashStats.itemsUsed += 1;
            slashStats.itemUsageByKind.sword = (slashStats.itemUsageByKind.sword ?? 0) + 1;
          }
          this.consumeSwordDurability(f, f.facing);
        }
      }

      for (const target of this.world.fighters) {
        if (target.slotId === f.slotId || !target.alive || target.invulnTimer > 0) continue;
        if (atk.hitSlotIds.includes(target.slotId)) continue;
        if (atk.kind === 'sword' && (!f.weapon || f.weapon.kind !== 'sword')) break;

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

  private consumeSwordDurability(attacker: StickFighter, dir: -1 | 1): void {
    if (!attacker.weapon || attacker.weapon.kind !== 'sword') return;
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

  private fireRangedWeapon(
    f: StickFighter,
    kind: 'pistol' | 'shotgun' | 'rocket' | 'grenade',
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
        originX: muzzleX,
        originY: muzzleY,
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
    } else if (kind === 'shotgun') {
      const pellets = Math.max(1, Math.round(this.rules.shotgunPellets));
      const spreadRad = (Math.max(0, this.rules.shotgunSpreadAngleDeg) * Math.PI) / 180;
      const baseAngle = Math.atan2(ny, nx);
      const speed = this.rules.shotgunSpeed;
      const volleyId = this.nextEntityId++;

      for (let p = 0; p < pellets; p += 1) {
        const randomOffset = (this.rng.next() - 0.5) * spreadRad;
        const pelletAngle = baseAngle + randomOffset;
        const pvx = Math.cos(pelletAngle) * speed;
        const pvy = Math.sin(pelletAngle) * speed;
        this.world.projectiles.push({
          id: this.nextEntityId++,
          kind: 'shotgun',
          volleyId,
          ownerSlotId: f.slotId,
          colorHex: f.config.colorHex,
          originX: muzzleX,
          originY: muzzleY,
          x: muzzleX,
          y: muzzleY,
          prevX: muzzleX,
          prevY: muzzleY,
          vx: pvx,
          vy: pvy,
          radius: 3.4,
          damage: this.rules.shotgunDamage,
          knockback: 195,
          gravityScale: 0, // 猎枪小弹丸直线高速散射
          age: 0,
          maxAge: 1.05,
          blastRadius: 0,
        });
      }

      // 猎枪后坐力位移反馈：赋予短时滑移阻尼窗口 + 反向推力 + 脚底擦地微尘
      f.recoilTimer = 0.14;
      f.vx -= nx * 210;
      f.vy -= ny * 65;
      if (f.onGround && Math.abs(nx) > 0.2) {
        this.spawnDustBurst(f.x, f.y, 4, '#CBD5E1');
      }
      this.world.particles.push({
        x: f.x + nx * 8,
        y: muzzleY - 2,
        vx: -nx * 88 + (this.rng.next() - 0.5) * 45,
        vy: -155 - this.rng.next() * 45,
        size: 4.2,
        color: '#EA580C',
        alpha: 1,
        age: 0,
        maxAge: 0.52,
        gravity: 660,
        kind: 'shell',
        rotation: 0,
        vRot: 16,
      });
      this.spawnSparkBurst(muzzleX, muzzleY, nx, ny, 12, '#FB923C');
      this.addShake(5.5, -nx, -ny);
      sounds.push('fire_shotgun');
    } else if (kind === 'grenade') {
      // 碎片手雷：8 方向抛物线投出，触碰任何物体立即引发一格小爆破 + 6 向 0.3× 碎片
      const throwVel = computeGrenadeThrowVelocity(nx, ny, this.rules.grenadeSpeed);
      this.world.projectiles.push({
        id: this.nextEntityId++,
        kind: 'grenade',
        ownerSlotId: f.slotId,
        colorHex: f.config.colorHex,
        originX: muzzleX,
        originY: muzzleY,
        x: muzzleX,
        y: muzzleY,
        prevX: muzzleX,
        prevY: muzzleY,
        vx: throwVel.vx,
        vy: throwVel.vy,
        radius: 6,
        damage: this.rules.grenadeDamage,
        knockback: 360,
        gravityScale: 1,
        age: 0,
        maxAge: 4.2,
        blastRadius: GRENADE_BLAST_RADIUS,
      });
      f.vx += nx * 35;
      sounds.push('stick_grenade_throw');
    } else {
      const speed = this.rules.rocketSpeed;
      this.world.projectiles.push({
        id: this.nextEntityId++,
        kind: 'rocket',
        ownerSlotId: f.slotId,
        colorHex: f.config.colorHex,
        originX: muzzleX,
        originY: muzzleY,
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
    if (kind === 'sword') {
      this.consumeSwordDurability(attacker, dir);
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
    sounds: SoundEventKind[],
    volleyId?: number,
    hitZone?: ProjectileHitZone
  ): boolean {
    const sameVolleyBypass =
      volleyId !== undefined && target.lastHitVolleyId === volleyId;
    if (!target.alive || (target.invulnTimer > 0 && !sameVolleyBypass)) return false;
    target.hp = Math.max(0, target.hp - damage);
    if (sameVolleyBypass) {
      // 同一次猎枪齐射的后续弹丸叠加部分击退，避免覆盖主击退方向
      target.vx += kbX * 0.42;
      target.vy = Math.min(target.vy, kbY);
    } else {
      target.vx = kbX;
      target.vy = kbY;
    }
    target.onGround = false;
    target.onPlatform = false;
    target.hitStunTimer = Math.max(target.hitStunTimer, stunSeconds);
    target.hitFlashTimer = 0.12;
    const invulnDuration = Math.max(0, this.rules.hurtInvulnSeconds ?? 0.1);
    if (invulnDuration > 0) {
      target.invulnTimer = Math.max(target.invulnTimer, invulnDuration);
      target.lastHitVolleyId = volleyId ?? null;
    } else {
      target.lastHitVolleyId = null;
    }
    target.attack = null;

    if (attackerSlotId !== target.slotId) {
      this.lastDamagedBy.set(target.slotId, attackerSlotId);
    }

    const isHeadshot = hitZone === 'head';
    const isLegShot = hitZone === 'legs';
    const impactX = target.x;
    const impactY = isHeadshot
      ? target.y - target.height * 0.88
      : isLegShot
      ? target.y - target.height * 0.18
      : target.y - target.height * 0.55;
    const dirLen = Math.hypot(kbX, kbY) || 1;
    this.spawnSparkBurst(
      impactX,
      impactY,
      kbX / dirLen,
      kbY / dirLen,
      isHeadshot || damage >= 25 ? 16 : isLegShot ? 6 : 9,
      isHeadshot ? '#EF4444' : damage >= 25 ? '#F97316' : '#FEF08A'
    );

    const dmgText = isHeadshot ? `爆头 -${damage}!` : `-${damage}`;
    const dmgColor = isHeadshot
      ? '#EF4444'
      : isLegShot
      ? '#94A3B8'
      : damage >= 25
      ? '#EF4444'
      : '#F59E0B';
    const dmgScale = isHeadshot ? 1.32 : isLegShot ? 0.85 : damage >= 25 ? 1.3 : 1.0;

    this.world.floatingTexts.push({
      x: impactX + (this.rng.next() - 0.5) * 16,
      y: target.y - target.height - (isHeadshot ? 16 : 10),
      vy: isHeadshot ? -72 : -62,
      text: dmgText,
      color: dmgColor,
      scale: dmgScale,
      age: 0,
      maxAge: isHeadshot ? 0.92 : 0.78,
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
        const g = proj.kind === 'grenade' ? this.rules.grenadeGravity : this.rules.rocketGravity;
        proj.vy += g * proj.gravityScale * dt;
        // 火箭飞行烟迹 / 手雷微弱引信火星
        if (proj.kind === 'rocket' && Math.floor(proj.age * 60) % 2 === 0) {
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
        } else if (proj.kind === 'grenade' && Math.floor(proj.age * 40) % 3 === 0) {
          this.world.particles.push({
            x: proj.x,
            y: proj.y - 4,
            vx: (this.rng.next() - 0.5) * 35,
            vy: -35 - this.rng.next() * 25,
            size: 2.2,
            color: '#BEF264',
            alpha: 0.9,
            age: 0,
            maxAge: 0.18,
            gravity: 160,
            kind: 'spark',
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

        // 2. 命中角色检测（无敌保护期间免疫直射子弹命中与击退；碎片手雷碰任何角色直接引爆）
        for (const f of this.world.fighters) {
          if (!f.alive) continue;
          const sameVolleyBypass =
            proj.volleyId !== undefined && f.lastHitVolleyId === proj.volleyId;
          if (f.invulnTimer > 0 && !sameVolleyBypass && proj.kind !== 'grenade') continue;
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
        // 先移出当前弹体，避免手雷引爆新增的 6 枚碎片干扰反向遍历索引
        this.world.projectiles.splice(i, 1);

        // 猎枪散弹命中或到达散开终点时保留从枪口到散开点的半透明轨迹残影
        if (proj.kind === 'shotgun') {
          this.world.projectileTrails.push({
            x1: proj.originX,
            y1: proj.originY,
            x2: proj.x,
            y2: proj.y,
            color: '#FB923C',
            width: 3.2,
            age: 0,
            maxAge: 0.24,
          });
        }

        if (proj.kind === 'rocket') {
          this.detonateRocket(proj.x, proj.y, proj.ownerSlotId, proj.blastRadius, proj.damage, sounds);
        } else if (proj.kind === 'grenade') {
          this.detonateGrenade(proj, sounds);
        } else if (hitFighter) {
          const dirLen = Math.hypot(proj.vx, proj.vy) || 1;
          const isShotgun = proj.kind === 'shotgun';
          const isShrapnel = proj.kind === 'shrapnel';
          // 全部直射弹丸（手枪、猎枪、手雷碎片）适用打头 1.5x / 打身 1.0x / 打脚 0.6x
          const hitZone = resolveProjectileHitZone(proj.y, hitFighter.y, hitFighter.height);
          const finalDamage = Math.max(1, Math.round(proj.damage * hitZone.multiplier));
          const landed = this.dealDamage(
            proj.ownerSlotId,
            hitFighter,
            finalDamage,
            (proj.vx / dirLen) * proj.knockback,
            Math.min(
              isShotgun || isShrapnel ? -110 : -150,
              (proj.vy / dirLen) * proj.knockback * 0.55 - (isShotgun || isShrapnel ? 80 : 120)
            ),
            isShrapnel ? 0.14 : isShotgun ? 0.18 : 0.22,
            hitZone.zone === 'head' ? 0.062 : isShrapnel ? 0.032 : isShotgun ? 0.042 : 0.052,
            hitZone.zone === 'head' ? 6.4 : isShrapnel ? 3.2 : isShotgun ? 4.4 : 5.8,
            sounds,
            proj.volleyId,
            hitZone.zone
          );
          if (landed) {
            const ownerStats = this.world.stats[proj.ownerSlotId];
            if (ownerStats) ownerStats.hitsLanded += 1;
          }
        } else if (impacted) {
          this.spawnSparkBurst(
            proj.x,
            proj.y,
            -Math.sign(proj.vx || 1),
            -0.4,
            proj.kind === 'shrapnel' ? 4 : proj.kind === 'shotgun' ? 5 : 7,
            proj.kind === 'shrapnel' ? '#BEF264' : proj.kind === 'shotgun' ? '#FB923C' : '#FDE047'
          );
          sounds.push('bounce');
        }
      }
    }
  }

  private detonateGrenade(proj: StickProjectile, sounds: SoundEventKind[]): void {
    const cx = proj.x;
    const cy = proj.y;
    const blastRadius = proj.blastRadius || GRENADE_BLAST_RADIUS;

    // 1. 小爆破仅炸毁命中的单个可破坏砖块/短平台（底层基岩永久保留）
    const brokenTile = destroySingleNearestTile(this.world.terrain, cx, cy, blastRadius + 4);
    if (brokenTile) {
      sounds.push('stick_block_break');
      for (let k = 0; k < 5; k += 1) {
        const angle = this.rng.next() * Math.PI * 2;
        const spd = 95 + this.rng.next() * 195;
        this.world.particles.push({
          x: brokenTile.x + (this.rng.next() - 0.5) * 14,
          y: brokenTile.y + (this.rng.next() - 0.5) * 14,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd - 135,
          size: brokenTile.kind === 'platform' ? 6 : 8,
          color: brokenTile.kind === 'platform' ? '#64748B' : '#B47B56',
          alpha: 1,
          age: 0,
          maxAge: 0.55 + this.rng.next() * 0.3,
          gravity: 920,
          kind: 'debris',
          rotation: this.rng.next() * Math.PI,
          vRot: (this.rng.next() - 0.5) * 14,
        });
      }
    }

    // 2. 极小范围爆破伤害（约 1 个方框大小）
    let hitAnyone = false;
    for (const f of this.world.fighters) {
      if (!f.alive || f.invulnTimer > 0) continue;
      const closestX = Math.max(f.x - f.halfWidth, Math.min(cx, f.x + f.halfWidth));
      const closestY = Math.max(f.y - f.height, Math.min(cy, f.y));
      const dist = Math.hypot(closestX - cx, closestY - cy);
      const splash = computeRocketSplash(dist, blastRadius, proj.damage);
      if (!splash) continue;

      const fx = f.x;
      const fy = f.y - f.height * 0.5;
      const dx = fx - cx;
      const dy = fy - cy;
      const len = Math.hypot(dx, dy) || 1;
      const kbSpeed = 360 * splash.knockbackScale;
      const landed = this.dealDamage(
        proj.ownerSlotId,
        f,
        splash.damage,
        (dx / len) * kbSpeed,
        Math.min(-210, (dy / len) * kbSpeed - 150),
        0.24,
        0.058,
        7.5,
        sounds
      );
      if (landed && f.slotId !== proj.ownerSlotId) {
        hitAnyone = true;
      }
    }
    if (hitAnyone) {
      const ownerStats = this.world.stats[proj.ownerSlotId];
      if (ownerStats) ownerStats.hitsLanded += 1;
    }

    // 3. 计算安全爆心（略微退回空气侧，避免 6 向碎片刚生成即撞死在底层基岩边缘）
    const velLen = Math.hypot(proj.vx, proj.vy) || 1;
    let safeX = cx;
    let safeY = cy;
    if (sampleProjectileTerrainHit(this.world.terrain, safeX, safeY) !== 'empty') {
      safeX = cx - (proj.vx / velLen) * 10;
      safeY = cy - (proj.vy / velLen) * 10;
    }

    // 4. 向 6 个均匀方向（每 60° 一道）直线射出 0.3× 伤害碎片
    const shrapnelDamage = Math.max(
      1,
      Math.round(proj.damage * this.rules.grenadeShrapnelMultiplier)
    );
    const shrapnelSpeed = 680;
    for (let k = 0; k < 6; k += 1) {
      const ang = (k * Math.PI) / 3;
      const sx = safeX + Math.cos(ang) * 5;
      const sy = safeY + Math.sin(ang) * 5;
      this.world.projectiles.push({
        id: this.nextEntityId++,
        kind: 'shrapnel',
        ownerSlotId: proj.ownerSlotId,
        colorHex: proj.colorHex,
        originX: safeX,
        originY: safeY,
        x: sx,
        y: sy,
        prevX: safeX,
        prevY: safeY,
        vx: Math.cos(ang) * shrapnelSpeed,
        vy: Math.sin(ang) * shrapnelSpeed,
        radius: 3.0,
        damage: shrapnelDamage,
        knockback: 145,
        gravityScale: 0, // 6 向碎片直线高速飞出
        age: 0,
        maxAge: 0.72,
        blastRadius: 0,
      });
    }

    // 5. 紧致小爆破特效与震屏
    this.world.explosions.push({
      x: cx,
      y: cy,
      radius: blastRadius,
      age: 0,
      maxAge: 0.28,
      color: '#84CC16',
    });
    this.spawnSparkBurst(cx, cy, 0, -1, 14, '#BEF264');
    this.addShake(7.5, 0, -1);
    sounds.push('fire_frag');
    sounds.push('explosion');
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

    for (let i = this.world.projectileTrails.length - 1; i >= 0; i -= 1) {
      const tr = this.world.projectileTrails[i];
      tr.age += dt;
      if (tr.age >= tr.maxAge) {
        this.world.projectileTrails.splice(i, 1);
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
    this.world.projectileTrails = [];
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
