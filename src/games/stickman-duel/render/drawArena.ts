import type { GameRenderer } from '../../../platform/games/contracts';
import { getTile } from '../map/terrain';
import {
  PICKUP_ACCENTS,
  PICKUP_LABELS,
  computeGrenadeThrowVelocity,
} from '../simulation/combat';
import type {
  GroundPickup,
  LocalImpactWave,
  ProjectileTrailEffect,
  StickFighter,
  StickmanDuelRules,
  StickmanTerrain,
  StickmanWorld,
  StickProjectile,
  StickWeaponKind,
} from '../types';
import {
  blendStickmanPose,
  computeTargetStickmanPose,
  type StickmanPose,
} from './stickmanPose';
import { drawStickmanSprite, HELD_SPRITE_BOXES, preloadStickmanSprites } from './stickmanSprites';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

interface Palette {
  dark: boolean;
  canvasBg: string;
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  gridLine: string;
  silhouette: string;
  arenaBorder: string;
  bedrockBase: string;
  bedrockDark: string;
  bedrockRim: string;
  bedrockRivet: string;
  brickBase: string;
  brickLight: string;
  brickDark: string;
  brickMortar: string;
  platformTop: string;
  platformBody: string;
  platformAccent: string;
  stickStroke: string;
  stickCore: string;
  hpTrack: string;
  namePlateBg: string;
  namePlateText: string;
}

function getPalette(): Palette {
  const dark =
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark');
  if (dark) {
    return {
      dark: true,
      canvasBg: '#090D16',
      skyTop: '#0B1222',
      skyMid: '#121B30',
      skyBottom: '#192238',
      gridLine: 'rgba(148, 163, 184, 0.065)',
      silhouette: 'rgba(9, 14, 26, 0.55)',
      arenaBorder: '#2C3852',
      bedrockBase: '#1B2230',
      bedrockDark: '#101520',
      bedrockRim: '#475569',
      bedrockRivet: '#64748B',
      brickBase: '#4B3A36',
      brickLight: '#6A534C',
      brickDark: '#332623',
      brickMortar: '#1E1716',
      platformTop: '#38BDF8',
      platformBody: '#1E293B',
      platformAccent: 'rgba(56, 189, 248, 0.45)',
      stickStroke: '#F8FAFC',
      stickCore: '#0F172A',
      hpTrack: 'rgba(15, 23, 42, 0.85)',
      namePlateBg: 'rgba(15, 23, 42, 0.78)',
      namePlateText: '#F1F5F9',
    };
  }
  return {
    dark: false,
    canvasBg: '#EAE4D8',
    skyTop: '#F8F4EB',
    skyMid: '#EFE9DC',
    skyBottom: '#E3DAC8',
    gridLine: 'rgba(60, 72, 88, 0.065)',
    silhouette: 'rgba(182, 171, 152, 0.35)',
    arenaBorder: '#B9B09E',
    bedrockBase: '#333C48',
    bedrockDark: '#232A33',
    bedrockRim: '#6B7787',
    bedrockRivet: '#94A3B8',
    brickBase: '#B66A4A',
    brickLight: '#CE8261',
    brickDark: '#8E4E34',
    brickMortar: '#5E3422',
    platformTop: '#0284C7',
    platformBody: '#334155',
    platformAccent: 'rgba(2, 132, 199, 0.4)',
    stickStroke: '#181E26',
    stickCore: '#FFFFFF',
    hpTrack: 'rgba(28, 33, 39, 0.82)',
    namePlateBg: 'rgba(250, 248, 244, 0.88)',
    namePlateText: '#1C2127',
  };
}

export class StickmanDuelRenderer implements GameRenderer<StickmanWorld> {
  private cssWidth = 960;
  private cssHeight = 540;
  private dpr = 1;
  private debugMode = false;
  private elapsedVisual = 0;
  private readonly poseCache = new Map<string, StickmanPose>();
  private lastRoundNumber = -1;

  constructor() {
    preloadStickmanSprites();
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    this.dpr = Math.max(1, dpr);
  }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  render(ctx: CanvasRenderingContext2D, world: StickmanWorld, realDtSeconds: number): void {
    const dt = Math.min(0.05, Math.max(0, realDtSeconds));
    this.elapsedVisual += dt;
    if (world.roundNumber !== this.lastRoundNumber) {
      this.poseCache.clear();
      this.lastRoundNumber = world.roundNumber;
    }
    const palette = getPalette();

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = palette.canvasBg;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    const worldW = world.terrain.width;
    const worldH = world.terrain.height;
    const padX = 10;
    const padY = 10;
    const availW = Math.max(1, this.cssWidth - padX * 2);
    const availH = Math.max(1, this.cssHeight - padY * 2);
    const scale = Math.min(availW / worldW, availH / worldH);
    const drawW = worldW * scale;
    const drawH = worldH * scale;
    const offsetX = (this.cssWidth - drawW) * 0.5;
    const offsetY = (this.cssHeight - drawH) * 0.5;

    // 克制平滑的单向微推震屏（仅火箭大爆破/KO/爆头触发，去除高频眩晕晃动）
    let shakeX = 0;
    let shakeY = 0;
    if (world.shakeIntensity > 0.15) {
      const settle = Math.cos(this.elapsedVisual * 34);
      const damp = 0.72 + settle * 0.28;
      shakeX = world.shakeDirX * world.shakeIntensity * damp;
      shakeY = world.shakeDirY * world.shakeIntensity * damp;
    }

    ctx.save();
    ctx.translate(offsetX + shakeX * scale, offsetY + shakeY * scale);
    ctx.scale(scale, scale);

    // 裁剪到竞技场边界内
    ctx.beginPath();
    ctx.roundRect(0, 0, worldW, worldH, 10);
    ctx.clip();

    this.drawBackdrop(ctx, worldW, worldH, palette);
    this.drawTerrain(ctx, world.terrain, world.impactWaves, palette);
    this.drawPickups(ctx, world, palette);
    this.drawSlashes(ctx, world);
    this.drawProjectileTrails(ctx, world.projectileTrails);
    this.drawFighters(ctx, world, palette, dt);
    this.drawProjectiles(ctx, world.projectiles);
    this.drawExplosions(ctx, world);
    this.drawLocalImpactWaves(ctx, world.impactWaves);
    this.drawParticles(ctx, world);
    this.drawOverheadHud(ctx, world, palette);
    if (world.training) {
      this.drawTrainingOverlays(ctx, world, palette);
    }
    this.drawFloatingTexts(ctx, world);

    if (this.debugMode) {
      this.drawDebugOverlay(ctx, world);
    }

    ctx.restore();

    // 外框描边
    ctx.strokeStyle = palette.arenaBorder;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(offsetX, offsetY, drawW, drawH, Math.max(4, 10 * scale));
    ctx.stroke();

    ctx.restore();
  }

  private drawBackdrop(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    palette: Palette
  ): void {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, palette.skyTop);
    grad.addColorStop(0.58, palette.skyMid);
    grad.addColorStop(1, palette.skyBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 远景建筑/巨柱剪影，增强 2D 横版格斗纵深感
    ctx.fillStyle = palette.silhouette;
    const pillars = [
      { x: 64, bw: 92, bh: 210 },
      { x: 210, bw: 62, bh: 150 },
      { x: 420, bw: 118, bh: 185 },
      { x: 635, bw: 86, bh: 225 },
      { x: 840, bw: 108, bh: 168 },
      { x: 1015, bw: 78, bh: 205 },
    ];
    for (const p of pillars) {
      ctx.fillRect(p.x, h - 36 - p.bh, p.bw, p.bh);
    }

    // 柔和蓝图刻度网格
    ctx.strokeStyle = palette.gridLine;
    ctx.lineWidth = 1;
    const step = 36;
    ctx.beginPath();
    for (let x = step; x < w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = step; y < h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  }

  /**
   * 计算某世界坐标在当前所有局部打击波下的场景位移与受激高亮强度。
   * 远离命中点的砖块/平台保持完全静止，仅命中点附近局部震动弹跳。
   */
  private sampleLocalSceneTremor(
    wx: number,
    wy: number,
    waves: LocalImpactWave[]
  ): { dx: number; dy: number; flash: number; color: string } {
    let dx = 0;
    let dy = 0;
    let flash = 0;
    let color = '#FEF08A';
    for (let i = 0; i < waves.length; i += 1) {
      const w = waves[i];
      const rx = wx - w.x;
      const ry = wy - w.y;
      const distSq = rx * rx + ry * ry;
      const maxR = w.radius;
      if (distSq >= maxR * maxR) continue;
      const dist = Math.sqrt(distSq);
      const progress = clamp(w.age / Math.max(0.01, w.maxAge), 0, 1);
      const decay = 1 - progress;
      const radial = 1 - dist / maxR;
      const falloff = radial * radial * decay;
      // 阻尼震荡波：向外推挤并伴随一次紧致回弹
      const osc = Math.cos(w.age * 52 - dist * 0.065);
      const invLen = dist > 1 ? 1 / dist : 0;
      const pushX = dist > 1 ? rx * invLen * 0.65 + w.dirX * 0.35 : w.dirX;
      const pushY = dist > 1 ? ry * invLen * 0.65 + w.dirY * 0.35 : w.dirY;
      const amp = w.strength * falloff * (0.55 + 0.45 * osc);
      dx += pushX * amp;
      dy += pushY * amp;
      if (falloff > flash) {
        flash = falloff;
        color = w.color;
      }
    }
    return {
      dx: clamp(dx, -7.5, 7.5),
      dy: clamp(dy, -7.5, 7.5),
      flash: clamp(flash, 0, 1),
      color,
    };
  }

  private drawTerrain(
    ctx: CanvasRenderingContext2D,
    terrain: StickmanTerrain,
    impactWaves: LocalImpactWave[],
    palette: Palette
  ): void {
    const ts = terrain.tileSize;
    const hasWaves = impactWaves.length > 0;

    for (let r = 0; r < terrain.rows; r += 1) {
      for (let c = 0; c < terrain.cols; c += 1) {
        const tile = getTile(terrain, c, r);
        if (tile === 'empty') continue;

        let x = c * ts;
        let y = r * ts;
        let localFlash = 0;
        let flashColor = '#FEF08A';
        if (hasWaves) {
          const tremor = this.sampleLocalSceneTremor(x + ts * 0.5, y + ts * 0.5, impactWaves);
          // 底层不可破坏基岩振幅减半，仅表层微震；砖块与短平台随冲击波轻弹
          const tileScale = tile === 'bedrock' ? 0.38 : tile === 'platform' ? 0.95 : 0.85;
          x += tremor.dx * tileScale;
          y += tremor.dy * tileScale;
          localFlash = tremor.flash;
          flashColor = tremor.color;
        }
        const variant = terrain.variants[r * terrain.cols + c] ?? 0;

        if (tile === 'bedrock') {
          // 最底层不可破坏基岩：重甲钢岩质感 + 顶边金属反光 + 铆钉
          ctx.fillStyle = palette.bedrockBase;
          ctx.fillRect(x, y, ts, ts);

          ctx.fillStyle = palette.bedrockDark;
          ctx.fillRect(x, y + ts * 0.55, ts, ts * 0.45);

          // 顶边不可破坏强化金属沿
          ctx.fillStyle = palette.bedrockRim;
          ctx.fillRect(x, y, ts, 5);

          // 砖块分缝
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, ts - 1, ts - 1);

          // 工业斜纹与铆钉
          ctx.fillStyle = palette.bedrockRivet;
          ctx.beginPath();
          ctx.arc(x + 7, y + 13, 1.8, 0, Math.PI * 2);
          ctx.arc(x + ts - 7, y + 13, 1.8, 0, Math.PI * 2);
          ctx.fill();

          if ((c + variant) % 3 === 0) {
            ctx.fillStyle = 'rgba(245, 158, 11, 0.25)';
            ctx.beginPath();
            ctx.moveTo(x + 8, y + ts - 4);
            ctx.lineTo(x + 16, y + ts - 12);
            ctx.lineTo(x + 22, y + ts - 12);
            ctx.lineTo(x + 14, y + ts - 4);
            ctx.closePath();
            ctx.fill();
          }
        } else if (tile === 'brick') {
          // 可破坏堆叠砖块：暖陶/岩砖质感，带高光与微裂纹提示可爆破
          ctx.fillStyle = palette.brickBase;
          ctx.fillRect(x, y, ts, ts);

          // 顶部与左侧受光倒角
          ctx.fillStyle = palette.brickLight;
          ctx.fillRect(x + 1, y + 1, ts - 2, 4);
          ctx.fillRect(x + 1, y + 1, 3, ts - 2);

          // 底部与右侧暗面
          ctx.fillStyle = palette.brickDark;
          ctx.fillRect(x + 1, y + ts - 5, ts - 2, 4);
          ctx.fillRect(x + ts - 4, y + 1, 3, ts - 2);

          // 砌砖水平与错位竖缝
          ctx.strokeStyle = palette.brickMortar;
          ctx.lineWidth = 1.25;
          ctx.strokeRect(x + 0.6, y + 0.6, ts - 1.2, ts - 1.2);

          ctx.beginPath();
          ctx.moveTo(x + 1, y + ts * 0.5);
          ctx.lineTo(x + ts - 1, y + ts * 0.5);
          const midOffset = (r % 2 === 0 ? 0.5 : 0.28) * ts;
          ctx.moveTo(x + midOffset, y + 1);
          ctx.lineTo(x + midOffset, y + ts * 0.5);
          const lowerOffset = (r % 2 === 0 ? 0.26 : 0.68) * ts;
          ctx.moveTo(x + lowerOffset, y + ts * 0.5);
          ctx.lineTo(x + lowerOffset, y + ts - 1);
          ctx.stroke();

          // 轻微裂纹细节
          if (variant % 5 === 0) {
            ctx.strokeStyle = 'rgba(0,0,0,0.22)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 9, y + 8);
            ctx.lineTo(x + 15, y + 14);
            ctx.lineTo(x + 12, y + 21);
            ctx.stroke();
          }
        } else if (tile === 'platform') {
          // 单向短平台：轻薄金属桥面 + 顶部高亮边 + 底部可穿透虚线暗示
          const ph = 11;
          const leftSame = getTile(terrain, c - 1, r) === 'platform';
          const rightSame = getTile(terrain, c + 1, r) === 'platform';

          ctx.fillStyle = palette.platformBody;
          ctx.beginPath();
          ctx.roundRect(
            x + (leftSame ? 0 : 2),
            y,
            ts - (leftSame ? 0 : 2) - (rightSame ? 0 : 2),
            ph,
            [leftSame ? 0 : 3, rightSame ? 0 : 3, rightSame ? 0 : 4, leftSame ? 0 : 4]
          );
          ctx.fill();

          // 顶部青蓝金属踏板条
          ctx.fillStyle = palette.platformTop;
          ctx.fillRect(
            x + (leftSame ? 0 : 3),
            y,
            ts - (leftSame ? 0 : 3) - (rightSame ? 0 : 3),
            3.2
          );

          // 底部镂空桁架竖撑
          ctx.fillStyle = palette.platformAccent;
          ctx.fillRect(x + 6, y + ph, 3, 4);
          ctx.fillRect(x + ts - 9, y + ph, 3, 4);

          // 桥面反光虚线
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          ctx.fillRect(x + 5, y + 5, ts - 10, 1.5);
        }

        // 命中点紧邻砖块/平台的受激亮边反馈，强化人物附近局部场景打击感
        if (localFlash > 0.24) {
          ctx.save();
          ctx.globalAlpha = Math.min(0.45, (localFlash - 0.24) * 0.65);
          ctx.strokeStyle = flashColor;
          ctx.lineWidth = 1.6;
          const h = tile === 'platform' ? 11 : ts;
          ctx.strokeRect(x + 1, y + 1, ts - 2, h - 2);
          ctx.restore();
        }
      }
    }
  }

  private drawPickups(
    ctx: CanvasRenderingContext2D,
    world: StickmanWorld,
    palette: Palette
  ): void {
    const highlightedIds = new Set<number>();
    for (const f of world.fighters) {
      if (f.alive && f.nearbyDropId !== null) {
        highlightedIds.add(f.nearbyDropId);
      }
    }

    for (const drop of world.pickups) {
      const bob = drop.onGround ? Math.sin(this.elapsedVisual * 4.2 + drop.id * 1.7) * 3.5 : 0;
      const tremor =
        world.impactWaves.length > 0
          ? this.sampleLocalSceneTremor(drop.x, drop.y - 12, world.impactWaves)
          : null;
      const cx = drop.x + (tremor ? tremor.dx * 0.9 : 0);
      const cy = drop.y - 12 + bob + (tremor ? tremor.dy * 0.9 : 0);
      const accent = PICKUP_ACCENTS[drop.kind];
      const highlighted = highlightedIds.has(drop.id);

      // 即将消失时闪烁
      const remainingLife = drop.lifetime - drop.age;
      if (remainingLife < 4 && Math.floor(remainingLife * 8) % 2 === 0) {
        continue;
      }

      ctx.save();

      // 落地光晕
      const glowR = highlighted ? 28 : 21;
      const glow = ctx.createRadialGradient(cx, cy, 3, cx, cy, glowR);
      glow.addColorStop(0, `${accent}55`);
      glow.addColorStop(1, `${accent}00`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      ctx.fill();

      // 可拾取/替换高亮环
      if (highlighted) {
        const pulse = 0.5 + 0.5 * Math.sin(this.elapsedVisual * 8);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.65 + pulse * 0.35;
        ctx.beginPath();
        ctx.arc(cx, cy, 20 + pulse * 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // 底座小徽章框
      ctx.fillStyle = palette.dark ? 'rgba(15, 23, 42, 0.88)' : 'rgba(255, 255, 255, 0.92)';
      ctx.strokeStyle = accent;
      ctx.lineWidth = highlighted ? 2.4 : 1.8;
      ctx.beginPath();
      ctx.roundRect(cx - 16, cy - 13, 32, 26, 7);
      ctx.fill();
      ctx.stroke();

      this.drawPickupIcon(ctx, drop, cx, cy, accent);

      // 耐久 / 弹药小角标（保留替换掉落前的真实剩余次数）
      const countTag = drop.kind === 'medkit' ? '+25%' : `${drop.remaining}`;
      ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tagW = drop.kind === 'medkit' ? 30 : 18;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(cx + 8 - tagW * 0.5, cy + 7, tagW, 13, 6);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(countTag, cx + 8, cy + 13.8);

      // 当玩家靠近时显示拾取/替换提示条
      if (highlighted) {
        const label =
          drop.kind === 'medkit'
            ? '血包 +25%'
            : `换 ${PICKUP_LABELS[drop.kind]} (${drop.remaining}/${drop.max})`;
        ctx.font = '700 11px system-ui, -apple-system, sans-serif';
        const tw = Math.max(58, ctx.measureText(label).width + 14);
        ctx.fillStyle = palette.dark ? 'rgba(15, 23, 42, 0.94)' : 'rgba(28, 33, 39, 0.92)';
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.roundRect(cx - tw * 0.5, cy - 35, tw, 18, 9);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#F8FAFC';
        ctx.fillText(label, cx, cy - 25.5);
      }

      ctx.restore();
    }
  }

  private drawPickupIcon(
    ctx: CanvasRenderingContext2D,
    drop: GroundPickup,
    cx: number,
    cy: number,
    accent: string
  ): void {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (drop.kind === 'sword') ctx.rotate(-Math.PI * 0.25);
    const spriteDrawn = drawStickmanSprite(ctx, drop.kind, 0, -1, 27, 20);
    if (drop.kind === 'sword') ctx.rotate(Math.PI * 0.25);
    if (spriteDrawn) {
      ctx.restore();
      return;
    }

    if (drop.kind === 'sword') {
      ctx.rotate(-Math.PI * 0.25);
      // 剑身
      ctx.strokeStyle = '#E0F2FE';
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(12, 0);
      ctx.stroke();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-3, 0);
      ctx.lineTo(11, 0);
      ctx.stroke();
      // 护手与剑柄
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(-4, -5);
      ctx.lineTo(-4, 5);
      ctx.stroke();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(-11, 0);
      ctx.lineTo(-5, 0);
      ctx.stroke();
    } else if (drop.kind === 'pistol') {
      ctx.fillStyle = '#334155';
      ctx.fillRect(-10, -5, 19, 6);
      ctx.fillStyle = accent;
      ctx.fillRect(-9, -5, 16, 2.5);
      ctx.fillStyle = '#1E293B';
      ctx.beginPath();
      ctx.moveTo(-8, 1);
      ctx.lineTo(-2, 1);
      ctx.lineTo(-4, 9);
      ctx.lineTo(-10, 9);
      ctx.closePath();
      ctx.fill();
    } else if (drop.kind === 'shotgun') {
      // 猎枪：木质枪托 + 橙铜机匣 + 双管长枪管 + 护木
      ctx.rotate(-0.18);
      ctx.fillStyle = '#9A3412';
      ctx.beginPath();
      ctx.moveTo(-13, 0);
      ctx.lineTo(-5, -2.5);
      ctx.lineTo(-4, 3);
      ctx.lineTo(-13, 5.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#334155';
      ctx.fillRect(-5, -4, 19, 3.6);
      ctx.fillStyle = '#64748B';
      ctx.fillRect(-2, -1.2, 16, 2.2);
      ctx.fillStyle = accent;
      ctx.fillRect(-5, -3.5, 6, 4.5);
      ctx.fillStyle = '#B45309';
      ctx.fillRect(2, 0.5, 8, 3);
    } else if (drop.kind === 'rocket') {
      // 火箭筒筒身
      ctx.fillStyle = '#3F4E3C';
      ctx.fillRect(-11, -4, 20, 8);
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(-13, -5, 4, 10);
      // 橙红弹头
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(9, -4.5);
      ctx.lineTo(15, 0);
      ctx.lineTo(9, 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FCD34D';
      ctx.fillRect(-3, -4, 4, 8);
    } else if (drop.kind === 'grenade') {
      // 碎片手雷：军绿纺锤雷体 + 破片格纹 + 保险环
      ctx.fillStyle = '#365314';
      ctx.beginPath();
      ctx.ellipse(0, 2, 7.2, 8.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.strokeStyle = '#BEF264';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(6, 0);
      ctx.moveTo(-5.5, 4);
      ctx.lineTo(5.5, 4);
      ctx.moveTo(0, -5);
      ctx.lineTo(0, 9);
      ctx.stroke();
      // 顶部引信与拉环
      ctx.fillStyle = '#475569';
      ctx.fillRect(-2.5, -9, 5, 3.5);
      ctx.strokeStyle = '#FACC15';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(4.8, -8, 2.5, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // 医疗血包
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(-9, -7, 18, 14, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.fillRect(-2, -5, 4, 10);
      ctx.fillRect(-5, -2, 10, 4);
    }

    ctx.restore();
  }

  private drawFighters(
    ctx: CanvasRenderingContext2D,
    world: StickmanWorld,
    palette: Palette,
    dtSeconds: number
  ): void {
    for (const f of world.fighters) {
      this.drawSingleFighter(ctx, f, world.rules, palette, dtSeconds);
    }
  }

  private drawSingleFighter(
    ctx: CanvasRenderingContext2D,
    f: StickFighter,
    rules: StickmanDuelRules,
    palette: Palette,
    dtSeconds: number
  ): void {
    ctx.save();

    const targetPose = computeTargetStickmanPose(f, this.elapsedVisual, rules.moveSpeed);
    const pose = blendStickmanPose(this.poseCache.get(f.slotId), targetPose, dtSeconds);
    this.poseCache.set(f.slotId, pose);

    const invulnAlpha =
      f.alive && f.invulnTimer > 0
        ? Math.floor(f.invulnTimer * 36) % 2 === 0
          ? 0.34
          : 0.82
        : 1;

    // 计算人物级局部受击/后坐力颤动与挤压形变（顿帧期间依然高频微震，打击感极强且不晃全屏）
    let localShakeX = 0;
    let localShakeY = 0;
    let impactScaleX = 1;
    let impactScaleY = 1;
    if (f.impactShakeTimer > 0 && f.impactShakeIntensity > 0.1) {
      const ratio = clamp(f.impactShakeTimer / Math.max(0.04, f.impactShakeMax), 0, 1);
      const vib = Math.sin(this.elapsedVisual * 115 + f.x * 0.13);
      const perpX = -f.impactDirY;
      const perpY = f.impactDirX;
      const amp = f.impactShakeIntensity * ratio;
      localShakeX = (f.impactDirX * 0.65 + perpX * vib * 0.72) * amp;
      localShakeY = (f.impactDirY * 0.55 + perpY * vib * 0.55) * amp;
      // 方向性受击挤压/拉伸弹性形变（水平受击时横向微压、纵向微拉）
      const deform = clamp(amp * 0.022, 0, 0.19) * ratio;
      const horizBias = Math.abs(f.impactDirX) >= Math.abs(f.impactDirY) ? 1 : -1;
      impactScaleX = 1 - horizBias * deform;
      impactScaleY = 1 + horizBias * deform * 0.85;
    }

    // 脚底接触阴影（仅存活且贴近地面/空中柔和缩放，随落地缓冲与起跳自然呼吸）
    if (f.alive) {
      ctx.fillStyle = palette.dark ? 'rgba(0,0,0,0.42)' : 'rgba(28,33,39,0.18)';
      ctx.beginPath();
      const shadowScale = f.onGround ? clamp(pose.poseScaleX, 0.85, 1.25) : 0.62;
      ctx.ellipse(
        f.x + localShakeX * 0.4,
        f.y + 1,
        15 * shadowScale,
        f.onGround ? 4 : 2.5,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }

    // 飘动头巾（世界坐标绘制，叠加人物受击局部颤动保持首尾同步）
    if (f.scarf.length >= 2) {
      ctx.save();
      ctx.globalAlpha = f.alive ? 0.95 * invulnAlpha : Math.max(0.15, 1 - f.koTimer * 0.7);
      ctx.strokeStyle = f.config.colorHex;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 5.2;
      ctx.beginPath();
      ctx.moveTo(f.scarf[0].x + localShakeX, f.scarf[0].y + localShakeY);
      for (let i = 1; i < f.scarf.length; i += 1) {
        const w = 1 - i / f.scarf.length;
        ctx.lineTo(f.scarf[i].x + localShakeX * w, f.scarf[i].y + localShakeY * w);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 远程武器 8 向瞄准辅助线（手枪直线 / 猎枪 30° 扇形 / 火箭与手雷抛物线）
    if (
      f.alive &&
      f.weapon &&
      (f.weapon.kind === 'pistol' ||
        f.weapon.kind === 'shotgun' ||
        f.weapon.kind === 'rocket' ||
        f.weapon.kind === 'grenade')
    ) {
      this.drawAimGuide(ctx, f, rules);
    }

    // 移动到角色锚点（脚底中心 + 人物局部受击抖动）
    ctx.translate(f.x + localShakeX, f.y + localShakeY);

    // 动作弹性形变（落地缓冲以脚底为锚点避免离地悬浮；空中起跳以重心为锚点自然拉长）
    if (Math.abs(pose.poseScaleX - 1) > 0.002 || Math.abs(pose.poseScaleY - 1) > 0.002) {
      if (f.onGround) {
        ctx.scale(pose.poseScaleX, pose.poseScaleY);
      } else {
        ctx.translate(0, -24);
        ctx.scale(pose.poseScaleX, pose.poseScaleY);
        ctx.translate(0, 24);
      }
    }

    if (impactScaleX !== 1 || impactScaleY !== 1) {
      ctx.translate(0, -24);
      ctx.scale(impactScaleX, impactScaleY);
      ctx.translate(0, 24);
    }

    if (!f.alive) {
      ctx.globalAlpha = Math.max(0.22, 1 - f.koTimer * 0.45);
      ctx.translate(0, -18);
      ctx.rotate(f.koSpin);
      ctx.translate(0, 18);
    } else {
      if (invulnAlpha < 1) {
        ctx.globalAlpha = invulnAlpha;
      }
      if (!f.onGround && f.jumpsUsed >= 2 && Math.abs(f.airSpinAngle) > 0.01) {
        // 二段跳抱膝空中翻滚
        ctx.translate(0, -24);
        ctx.rotate(f.airSpinAngle);
        ctx.translate(0, 24);
      }
    }

    const isFlash = f.hitFlashTimer > 0;
    const bodyStroke = isFlash ? '#FFFFFF' : palette.stickStroke;
    const accent = isFlash ? '#FFFFFF' : f.config.colorHex;
    const attack = f.attack;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const strokeLimbLayer = (drawPath: () => void, outerWidth: number, innerWidth: number) => {
      ctx.strokeStyle = accent;
      ctx.lineWidth = outerWidth;
      ctx.beginPath();
      drawPath();
      ctx.stroke();

      ctx.strokeStyle = bodyStroke;
      ctx.lineWidth = innerWidth;
      ctx.beginPath();
      drawPath();
      ctx.stroke();
    };

    // 分层绘制（后肢 -> 弯曲脊柱躯干 -> 前肢），让跑跳交叉动作具有清晰的前后景层次
    strokeLimbLayer(
      () => {
        ctx.moveTo(pose.hip.x, pose.hip.y);
        ctx.lineTo(pose.backKnee.x, pose.backKnee.y);
        ctx.lineTo(pose.backFoot.x, pose.backFoot.y);
        ctx.moveTo(pose.shoulder.x, pose.shoulder.y);
        ctx.lineTo(pose.backElbow.x, pose.backElbow.y);
        ctx.lineTo(pose.backHand.x, pose.backHand.y);
      },
      5.8,
      3.1
    );

    // 柔性二次贝塞尔脊柱躯干
    strokeLimbLayer(
      () => {
        ctx.moveTo(pose.hip.x, pose.hip.y);
        ctx.quadraticCurveTo(pose.spineMid.x, pose.spineMid.y, pose.shoulder.x, pose.shoulder.y);
      },
      6.5,
      3.7
    );

    // 前腿与前臂（含攻击肢体，覆盖在躯干之前呈现立体武术轮廓）
    strokeLimbLayer(
      () => {
        ctx.moveTo(pose.hip.x, pose.hip.y);
        ctx.lineTo(pose.frontKnee.x, pose.frontKnee.y);
        ctx.lineTo(pose.frontFoot.x, pose.frontFoot.y);
        ctx.moveTo(pose.shoulder.x, pose.shoulder.y);
        ctx.lineTo(pose.frontElbow.x, pose.frontElbow.y);
        ctx.lineTo(pose.frontHand.x, pose.frontHand.y);
      },
      6.4,
      3.6
    );

    // 头部（实心对比圆 + 随动作微倾的护目镜/头带亮条）
    ctx.save();
    ctx.translate(pose.head.x, pose.head.y);
    ctx.rotate(pose.headTilt);

    ctx.fillStyle = bodyStroke;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, 0, 7.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 护目镜/头带亮条，指示朝向与视线仰俯
    ctx.fillStyle = accent;
    ctx.fillRect(f.facing === 1 ? 0.5 : -6.5, -2.6, 6, 2.6);
    ctx.restore();

    // 出拳/踢腿打击残影亮点
    if (attack?.kind === 'punch' && pose.isActiveStrike) {
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(pose.frontHand.x, pose.frontHand.y, 5.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (attack?.kind === 'kick' && pose.isActiveStrike) {
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(pose.frontFoot.x, pose.frontFoot.y, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 绘制手持武器（紧贴前手关节与程序化武器角度）
    if (f.weapon && f.alive) {
      this.drawHeldWeapon(
        ctx,
        f.weapon.kind,
        pose.frontHand.x,
        pose.frontHand.y,
        pose.weaponAngle,
        f.facing
      );
    }

    ctx.restore();
  }

  private drawHeldWeapon(
    ctx: CanvasRenderingContext2D,
    kind: StickWeaponKind,
    handX: number,
    handY: number,
    angle: number,
    facing: -1 | 1
  ): void {
    ctx.save();
    ctx.translate(handX, handY);
    ctx.rotate(angle);

    ctx.save();
    if (
      Math.cos(angle) < 0 &&
      (kind === 'pistol' || kind === 'shotgun' || (kind === 'rocket' && facing === -1))
    ) {
      ctx.scale(1, -1);
    }
    const spriteDrawn = drawStickmanSprite(ctx, kind, ...HELD_SPRITE_BOXES[kind]);
    ctx.restore();
    if (spriteDrawn) {
      ctx.restore();
      return;
    }

    if (kind === 'sword') {
      // 长剑：亮银青光刃 + 金色护手（保留角色无敌闪烁时的透明度继承）
      const baseAlpha = ctx.globalAlpha;
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 5.5;
      ctx.globalAlpha = baseAlpha * 0.35;
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(44, 0);
      ctx.stroke();

      ctx.globalAlpha = baseAlpha;
      ctx.strokeStyle = '#F8FAFC';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(3, 0);
      ctx.lineTo(43, 0);
      ctx.stroke();

      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(2, -6.5);
      ctx.lineTo(2, 6.5);
      ctx.stroke();

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(2, 0);
      ctx.stroke();
    } else if (kind === 'pistol') {
      const flipY = Math.cos(angle) < 0 ? -1 : 1;
      ctx.scale(1, flipY);
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(-3, -4, 17, 5.5);
      ctx.fillStyle = '#F59E0B';
      ctx.fillRect(-2, -4, 14, 2);
      ctx.fillStyle = '#334155';
      ctx.fillRect(-3, 1, 5, 7);
    } else if (kind === 'shotgun') {
      // 猎枪（双手平端：胡桃木托 + 橙铜机匣 + 双管长枪管 + 木质护木）
      const flipY = Math.cos(angle) < 0 ? -1 : 1;
      ctx.scale(1, flipY);
      ctx.fillStyle = '#9A3412';
      ctx.beginPath();
      ctx.moveTo(-12, -1);
      ctx.lineTo(-2, -3);
      ctx.lineTo(-1, 3.5);
      ctx.lineTo(-12, 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(-3, -4.5, 27, 4);
      ctx.fillStyle = '#64748B';
      ctx.fillRect(0, -1, 24, 2.4);
      ctx.fillStyle = '#EA580C';
      ctx.fillRect(-3, -4, 8, 5);
      ctx.fillStyle = '#B45309';
      ctx.fillRect(6, 0.8, 10, 3.2);
    } else if (kind === 'grenade') {
      // 手持碎片手雷：紧握掌心的小型军绿破片雷 + 亮黄拉环
      ctx.fillStyle = '#365314';
      ctx.beginPath();
      ctx.ellipse(3, 0, 5.8, 6.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#84CC16';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = '#475569';
      ctx.fillRect(1, -8, 4, 3);
      ctx.strokeStyle = '#FACC15';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(6.5, -7, 2.1, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // 火箭筒（肩扛式）
      const flipY = facing === -1 && Math.cos(angle) < 0 ? -1 : 1;
      ctx.scale(1, flipY);
      ctx.fillStyle = '#3F4E3C';
      ctx.fillRect(-16, -5.5, 34, 10);
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(-19, -6.5, 5, 12);
      ctx.fillStyle = '#F59E0B';
      ctx.fillRect(-2, -5.5, 6, 10);
      ctx.fillStyle = '#EF4444';
      ctx.beginPath();
      ctx.moveTo(18, -5);
      ctx.lineTo(26, -0.5);
      ctx.lineTo(18, 4.5);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  private drawAimGuide(
    ctx: CanvasRenderingContext2D,
    f: StickFighter,
    rules: StickmanDuelRules
  ): void {
    if (!f.weapon) return;
    const ox = f.x + f.aimX * 22;
    const oy = f.y - f.height * 0.62 + f.aimY * 18;

    ctx.save();
    if (f.weapon.kind === 'pistol') {
      ctx.strokeStyle = f.config.colorHex;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + f.aimX * 135, oy + f.aimY * 135);
      ctx.stroke();
    } else if (f.weapon.kind === 'shotgun') {
      // 猎枪 30° 扇形散射区预览
      const baseAngle = Math.atan2(f.aimY, f.aimX);
      const halfSpread = ((rules.shotgunSpreadAngleDeg * Math.PI) / 180) * 0.5;
      const coneLen = 118;

      ctx.fillStyle = '#EA580C';
      ctx.globalAlpha = 0.13;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.arc(ox, oy, coneLen, baseAngle - halfSpread, baseAngle + halfSpread);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#EA580C';
      ctx.globalAlpha = 0.42;
      ctx.lineWidth = 1.3;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + Math.cos(baseAngle - halfSpread) * coneLen, oy + Math.sin(baseAngle - halfSpread) * coneLen);
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + Math.cos(baseAngle + halfSpread) * coneLen, oy + Math.sin(baseAngle + halfSpread) * coneLen);
      ctx.stroke();
    } else if (f.weapon.kind === 'grenade') {
      // 碎片手雷 8 方向抛物线预览虚点
      ctx.fillStyle = '#84CC16';
      const vel = computeGrenadeThrowVelocity(f.aimX, f.aimY, rules.grenadeSpeed);
      const g = rules.grenadeGravity;
      for (let i = 1; i <= 7; i += 1) {
        const t = i * 0.05;
        const px = ox + vel.vx * t;
        const py = oy + vel.vy * t + 0.5 * g * t * t;
        ctx.globalAlpha = 0.62 - i * 0.068;
        ctx.beginPath();
        ctx.arc(px, py, 2.5 - i * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (f.weapon.kind === 'rocket') {
      // 短抛物线落点虚点预览，直观体现火箭受重力下坠
      ctx.fillStyle = '#F97316';
      const speed = rules.rocketSpeed;
      const g = rules.rocketGravity;
      for (let i = 1; i <= 7; i += 1) {
        const t = i * 0.055;
        const px = ox + f.aimX * speed * t;
        const py = oy + f.aimY * speed * t + 0.5 * g * t * t;
        ctx.globalAlpha = 0.58 - i * 0.065;
        ctx.beginPath();
        ctx.arc(px, py, 2.6 - i * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawProjectileTrails(
    ctx: CanvasRenderingContext2D,
    trails: ProjectileTrailEffect[]
  ): void {
    for (const tr of trails) {
      const life = 1 - clamp(tr.age / Math.max(0.01, tr.maxAge), 0, 1);
      ctx.save();
      ctx.lineCap = 'round';
      const grad = ctx.createLinearGradient(tr.x1, tr.y1, tr.x2, tr.y2);
      grad.addColorStop(0, `rgba(251, 146, 60, ${0.06 * life})`);
      grad.addColorStop(0.55, `rgba(251, 146, 60, ${0.34 * life})`);
      grad.addColorStop(1, `rgba(255, 247, 237, ${0.52 * life})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(1, tr.width * (0.55 + 0.45 * life));
      ctx.beginPath();
      ctx.moveTo(tr.x1, tr.y1);
      ctx.lineTo(tr.x2, tr.y2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawProjectiles(
    ctx: CanvasRenderingContext2D,
    projectiles: StickProjectile[]
  ): void {
    for (const p of projectiles) {
      const angle = Math.atan2(p.vy, p.vx);
      ctx.save();

      if (p.kind === 'pistol') {
        // 高速直线拖尾
        ctx.strokeStyle = '#FDE68A';
        ctx.lineWidth = 3.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.prevX - Math.cos(angle) * 14, p.prevY - Math.sin(angle) * 14);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'shotgun') {
        // 猎枪 3 枚散弹：从发射点到当前散开点的半透明渐变视觉轨迹 + 亮核小弹丸
        const trailGrad = ctx.createLinearGradient(p.originX, p.originY, p.x, p.y);
        trailGrad.addColorStop(0, 'rgba(251, 146, 60, 0.08)');
        trailGrad.addColorStop(0.65, 'rgba(251, 146, 60, 0.36)');
        trailGrad.addColorStop(1, 'rgba(255, 247, 237, 0.62)');
        ctx.strokeStyle = trailGrad;
        ctx.lineWidth = 2.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.originX, p.originY);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();

        ctx.fillStyle = '#FFF7ED';
        ctx.strokeStyle = '#EA580C';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'shrapnel') {
        // 手雷 6 向高速金属碎片：青柠-银白尖锐菱形破片与短尾迹
        ctx.strokeStyle = 'rgba(190, 242, 100, 0.72)';
        ctx.lineWidth = 2.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.prevX - Math.cos(angle) * 10, p.prevY - Math.sin(angle) * 10);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();

        ctx.translate(p.x, p.y);
        ctx.rotate(angle);
        ctx.fillStyle = '#ECFCCB';
        ctx.strokeStyle = '#65A30D';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(5, 0);
        ctx.lineTo(-2, -2.6);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-2, 2.6);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'grenade') {
        // 抛物线翻滚飞行中的碎片手雷
        ctx.translate(p.x, p.y);
        ctx.rotate(p.age * 11 * (p.vx >= 0 ? 1 : -1));
        if (drawStickmanSprite(ctx, 'grenadeFlight', 0, 0, p.radius * 2.2, p.radius * 2.4)) {
          ctx.restore();
          continue;
        }
        ctx.fillStyle = '#365314';
        ctx.beginPath();
        ctx.ellipse(0, 0, 5.8, 6.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#84CC16';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.fillStyle = '#BEF264';
        ctx.fillRect(-3.8, -1, 7.6, 2);
        ctx.fillStyle = '#475569';
        ctx.fillRect(-2, -8, 4, 2.8);
      } else {
        // 火箭弹体 + 尾焰
        ctx.translate(p.x, p.y);
        ctx.rotate(angle);

        const flicker = 0.8 + 0.4 * Math.sin(this.elapsedVisual * 55 + p.id);
        ctx.fillStyle = '#F97316';
        ctx.beginPath();
        ctx.moveTo(-8, -4.5);
        ctx.lineTo(-19 * flicker, 0);
        ctx.lineTo(-8, 4.5);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#FEF08A';
        ctx.beginPath();
        ctx.moveTo(-8, -2.5);
        ctx.lineTo(-13 * flicker, 0);
        ctx.lineTo(-8, 2.5);
        ctx.closePath();
        ctx.fill();

        if (drawStickmanSprite(ctx, 'rocketProjectile', 2.5, 0, 21, 10)) {
          ctx.restore();
          continue;
        }
        ctx.fillStyle = '#334155';
        ctx.fillRect(-8, -3.6, 13, 7.2);
        ctx.fillStyle = '#EF4444';
        ctx.beginPath();
        ctx.moveTo(5, -4);
        ctx.lineTo(13, 0);
        ctx.lineTo(5, 4);
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    }
  }

  private drawSlashes(ctx: CanvasRenderingContext2D, world: StickmanWorld): void {
    for (const s of world.slashes) {
      const progress = clamp(s.age / Math.max(0.01, s.maxAge), 0, 1);
      const alpha = (1 - progress) * 0.92;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.globalAlpha = alpha;
      ctx.lineCap = 'round';

      const half = s.arcSpan * 0.5;
      // 外焰
      ctx.strokeStyle = s.color;
      ctx.lineWidth = (s.kind === 'sword' ? 14 : 9) * (1 - progress * 0.45);
      ctx.beginPath();
      ctx.arc(0, 0, s.radius + progress * 6, s.angle - half, s.angle + half);
      ctx.stroke();

      // 锋利白芯
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = (s.kind === 'sword' ? 5 : 3) * (1 - progress * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, s.radius + progress * 6, s.angle - half * 0.82, s.angle + half * 0.82);
      ctx.stroke();

      ctx.restore();
    }
  }

  private drawExplosions(ctx: CanvasRenderingContext2D, world: StickmanWorld): void {
    for (const ex of world.explosions) {
      const p = clamp(ex.age / Math.max(0.01, ex.maxAge), 0, 1);
      const easeOut = 1 - Math.pow(1 - p, 3);
      const r = ex.radius * (0.28 + easeOut * 0.82);

      ctx.save();
      // 内核火球
      const grad = ctx.createRadialGradient(ex.x, ex.y, r * 0.08, ex.x, ex.y, r);
      grad.addColorStop(0, `rgba(255, 251, 235, ${(1 - p) * 0.95})`);
      grad.addColorStop(0.35, `rgba(251, 146, 60, ${(1 - p) * 0.78})`);
      grad.addColorStop(0.75, `rgba(220, 38, 38, ${(1 - p) * 0.38})`);
      grad.addColorStop(1, 'rgba(220, 38, 38, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, r, 0, Math.PI * 2);
      ctx.fill();

      // 冲击波扩散外环
      ctx.strokeStyle = `rgba(254, 240, 138, ${(1 - p) * 0.9})`;
      ctx.lineWidth = Math.max(1.5, 6 * (1 - p));
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, ex.radius * (0.35 + easeOut * 0.72), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * 绘制命中点、斩弹点与爆心周围的局部冲击环与短芒打击线，
   * 让每一次受击与格挡都在局部空间内“炸开”，无需抖动整块画面。
   */
  private drawLocalImpactWaves(
    ctx: CanvasRenderingContext2D,
    waves: LocalImpactWave[]
  ): void {
    for (const w of waves) {
      const p = clamp(w.age / Math.max(0.01, w.maxAge), 0, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      const alpha = (1 - p) * (w.kind === 'muzzle' ? 0.52 : 0.85);
      if (alpha <= 0.02) continue;

      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.globalAlpha = alpha;

      if (w.kind === 'parry') {
        // 斩弹「叮！」：双层天蓝音爆环 + 锐利十字星芒
        const r = 10 + ease * 38;
        ctx.strokeStyle = '#E0F2FE';
        ctx.lineWidth = Math.max(1.2, 3.4 * (1 - p));
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = Math.max(1, 2.2 * (1 - p));
        const rayLen = 14 + ease * 18;
        ctx.beginPath();
        ctx.moveTo(-rayLen, 0);
        ctx.lineTo(rayLen, 0);
        ctx.moveTo(0, -rayLen);
        ctx.lineTo(0, rayLen);
        ctx.stroke();
      } else if (w.kind === 'muzzle') {
        // 枪口/火箭喷口方向性短弧冲击波
        const ang = Math.atan2(w.dirY, w.dirX);
        const r = 8 + ease * 26;
        ctx.strokeStyle = w.color;
        ctx.lineWidth = Math.max(1, 2.6 * (1 - p));
        ctx.beginPath();
        ctx.arc(0, 0, r, ang - 0.85, ang + 0.85);
        ctx.stroke();
      } else {
        // 受击/爆破局部冲击环 + 沿受力方向散射的漫画短芒打击线
        const maxRing = w.kind === 'blast' ? Math.min(w.radius * 0.72, 125) : Math.min(w.radius * 0.45, 52);
        const r = 8 + ease * maxRing;
        ctx.strokeStyle = w.color;
        ctx.lineWidth = Math.max(1.2, (w.kind === 'blast' ? 4.2 : 3.2) * (1 - p));
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();

        // 局部放射短芒（沿冲击方向偏置）
        const baseAng = Math.atan2(w.dirY, w.dirX);
        const rays = w.kind === 'blast' ? 6 : 4;
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = Math.max(1, 2.2 * (1 - p));
        ctx.lineCap = 'round';
        for (let i = 0; i < rays; i += 1) {
          const a = baseAng + ((i - (rays - 1) * 0.5) * 0.62);
          const inner = r * 0.62;
          const outer = r * 1.16 + 5;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
          ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
          ctx.stroke();
        }
      }

      ctx.restore();
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, world: StickmanWorld): void {
    for (const pt of world.particles) {
      const life = 1 - clamp(pt.age / Math.max(0.01, pt.maxAge), 0, 1);
      ctx.save();
      ctx.globalAlpha = pt.alpha * life;
      ctx.translate(pt.x, pt.y);
      ctx.rotate(pt.rotation);

      if (pt.kind === 'debris') {
        ctx.fillStyle = pt.color;
        ctx.fillRect(-pt.size * 0.5, -pt.size * 0.5, pt.size, pt.size * 0.82);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(-pt.size * 0.5, -pt.size * 0.5, pt.size, pt.size * 0.82);
      } else if (pt.kind === 'heal') {
        ctx.fillStyle = pt.color;
        ctx.fillRect(-pt.size * 0.25, -pt.size * 0.85, pt.size * 0.5, pt.size * 1.7);
        ctx.fillRect(-pt.size * 0.85, -pt.size * 0.25, pt.size * 1.7, pt.size * 0.5);
      } else if (pt.kind === 'shell') {
        ctx.fillStyle = pt.color;
        ctx.fillRect(-pt.size, -pt.size * 0.45, pt.size * 2, pt.size * 0.9);
      } else {
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(0, 0, pt.size * (pt.kind === 'smoke' ? 1 + (1 - life) * 1.4 : 1), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawOverheadHud(
    ctx: CanvasRenderingContext2D,
    world: StickmanWorld,
    palette: Palette
  ): void {
    for (const f of world.fighters) {
      if (!f.alive && f.koTimer > 1.1) continue;

      const barW = 54;
      const barH = 6;
      const topY = f.y - f.height - 26;
      const leftX = f.x - barW * 0.5;

      ctx.save();
      ctx.globalAlpha = f.alive ? 0.96 : Math.max(0, 1 - f.koTimer);

      // 名称与当前手持武器角标
      const isTrainingPlayer =
        Boolean(world.training) && f.slotId === world.fighters[0]?.slotId;
      const isTrainingDummy =
        Boolean(world.training) && f.slotId === world.fighters[1]?.slotId;
      const weaponTag = f.weapon
        ? ` · ${PICKUP_LABELS[f.weapon.kind][0]}${
            world.training?.infiniteWeapon && isTrainingPlayer ? '∞' : f.weapon.remaining
          }`
        : '';
      const displayName = isTrainingDummy
        ? world.training?.drill === 'parry'
          ? '发球机'
          : '不死假人'
        : f.config.displayName;
      const label = `${displayName}${weaponTag}`;
      ctx.font = '700 10px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelW = Math.max(barW, ctx.measureText(label).width + 18);

      ctx.fillStyle = palette.namePlateBg;
      ctx.beginPath();
      ctx.roundRect(f.x - labelW * 0.5, topY - 15, labelW, 13, 6);
      ctx.fill();

      ctx.fillStyle = f.config.colorHex;
      ctx.beginPath();
      ctx.arc(f.x - labelW * 0.5 + 6.5, topY - 8.5, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = palette.namePlateText;
      ctx.fillText(label, f.x + 4.5, topY - 8.2);

      // 双层血条：底槽 + 白色缓冲扣血条 + 实际血量条
      ctx.fillStyle = palette.hpTrack;
      ctx.beginPath();
      ctx.roundRect(leftX - 1, topY - 1, barW + 2, barH + 2, 4);
      ctx.fill();

      const hpRatio = clamp(f.hp / Math.max(1, f.maxHp), 0, 1);
      const displayRatio = clamp(f.displayHp / Math.max(1, f.maxHp), 0, 1);

      if (displayRatio > hpRatio) {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.roundRect(leftX, topY, barW * displayRatio, barH, 3);
        ctx.fill();
      }

      const hpColor =
        hpRatio > 0.55 ? '#22C55E' : hpRatio > 0.28 ? '#F59E0B' : '#EF4444';
      if (hpRatio > 0) {
        ctx.fillStyle = hpColor;
        ctx.beginPath();
        ctx.roundRect(leftX, topY, Math.max(2, barW * hpRatio), barH, 3);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  private drawFloatingTexts(ctx: CanvasRenderingContext2D, world: StickmanWorld): void {
    for (const ft of world.floatingTexts) {
      const p = clamp(ft.age / Math.max(0.01, ft.maxAge), 0, 1);
      const pop = p < 0.16 ? 0.75 + (p / 0.16) * 0.35 : 1.1 - (p - 0.16) * 0.18;
      ctx.save();
      ctx.globalAlpha = p > 0.65 ? Math.max(0, 1 - (p - 0.65) / 0.35) : 1;
      ctx.translate(ft.x, ft.y);
      ctx.scale(ft.scale * pop, ft.scale * pop);
      ctx.font = '800 15px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.strokeText(ft.text, 0, 0);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, 0, 0);
      ctx.restore();
    }
  }

  private drawTrainingOverlays(
    ctx: CanvasRenderingContext2D,
    world: StickmanWorld,
    palette: Palette
  ): void {
    const tr = world.training;
    const player = world.fighters[0];
    const dummy = world.fighters[1];
    if (!tr) return;

    ctx.save();

    // 1. 假人头 / 躯干 / 腿脚部位伤害判定辅助线（爆头专练默认开启，随时可切换）
    if (tr.showHitZones && dummy && dummy.alive) {
      const topY = dummy.y - dummy.height;
      const headLineY = topY + dummy.height * 0.28;
      const legsLineY = topY + dummy.height * 0.72;
      const leftX = dummy.x - dummy.halfWidth - 8;
      const rightX = dummy.x + dummy.halfWidth + 8;

      // 头部 1.5x 高危暴击高亮区
      ctx.fillStyle = 'rgba(239, 68, 68, 0.14)';
      ctx.fillRect(leftX, topY, rightX - leftX, headLineY - topY);

      // 腿脚 0.6x 减伤区
      ctx.fillStyle = 'rgba(148, 163, 184, 0.12)';
      ctx.fillRect(leftX, legsLineY, rightX - leftX, dummy.y - legsLineY);

      // 部位分隔虚线
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
      ctx.beginPath();
      ctx.moveTo(leftX - 4, headLineY);
      ctx.lineTo(rightX + 4, headLineY);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.78)';
      ctx.beginPath();
      ctx.moveTo(leftX - 4, legsLineY);
      ctx.lineTo(rightX + 4, legsLineY);
      ctx.stroke();
      ctx.setLineDash([]);

      // 头部瞄准准星圈
      const headCenterY = topY + dummy.height * 0.14;
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.72)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(dummy.x, headCenterY, 10, 0, Math.PI * 2);
      ctx.stroke();

      // 右侧极简倍率标注
      ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const labelX = rightX + 8;

      ctx.fillStyle = '#EF4444';
      ctx.fillText('头 1.5×', labelX, topY + dummy.height * 0.14);
      ctx.fillStyle = palette.dark ? '#CBD5E1' : '#334155';
      ctx.fillText('身 1.0×', labelX, topY + dummy.height * 0.5);
      ctx.fillStyle = '#64748B';
      ctx.fillText('脚 0.6×', labelX, topY + dummy.height * 0.86);
    }

    // 2. 砍子弹专练发球预警线：明确区分「可斩弹（天蓝）」与「火箭不可砍（猩红）」
    if (tr.parryTelegraphTimer > 0 && dummy && player && dummy.alive && player.alive) {
      const isRocket = tr.parryNextKind === 'rocket';
      const pulse = 0.55 + 0.45 * Math.sin(this.elapsedVisual * 28);
      const ox = dummy.x + dummy.aimX * 22;
      const oy = dummy.y - dummy.height * 0.62 + dummy.aimY * 18;
      const tx = player.x;
      const ty = player.y - player.height * 0.56;

      ctx.strokeStyle = isRocket
        ? `rgba(239, 68, 68, ${0.42 + pulse * 0.45})`
        : `rgba(56, 189, 248, ${0.38 + pulse * 0.42})`;
      ctx.lineWidth = isRocket ? 2.4 : 1.8;
      ctx.setLineDash(isRocket ? [8, 5] : [5, 5]);
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);

      // 枪口充能光点
      ctx.fillStyle = isRocket ? '#EF4444' : '#38BDF8';
      ctx.beginPath();
      ctx.arc(ox, oy, 4 + pulse * 3, 0, Math.PI * 2);
      ctx.fill();

      // 假人头顶简短预警提示
      const warnText = isRocket
        ? '火箭不可砍 · 跳闪!'
        : `即将发射 ${PICKUP_LABELS[tr.parryNextKind]}`;
      ctx.font = '700 11px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = Math.max(92, ctx.measureText(warnText).width + 16);
      const bx = clamp(dummy.x, w * 0.5 + 12, world.terrain.width - w * 0.5 - 12);
      const by = dummy.y - dummy.height - 54;
      ctx.fillStyle = isRocket ? 'rgba(153, 27, 27, 0.92)' : 'rgba(12, 74, 110, 0.92)';
      ctx.beginPath();
      ctx.roundRect(bx - w * 0.5, by - 10, w, 20, 6);
      ctx.fill();
      ctx.fillStyle = '#F8FAFC';
      ctx.fillText(warnText, bx, by + 0.5);
    }

    // 3. 实时格斗连击浮标（位于右上角安全留白区，不遮挡中场交锋）
    if (tr.stats.comboHits >= 2) {
      const rx = world.terrain.width - 28;
      const ry = 44;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.font = '900 32px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.lineWidth = 4;
      ctx.strokeStyle = palette.dark ? 'rgba(9, 13, 22, 0.9)' : 'rgba(255, 255, 255, 0.92)';
      const hitLabel = `${tr.stats.comboHits} HIT`;
      ctx.strokeText(hitLabel, rx, ry);
      ctx.fillStyle = tr.stats.comboHits >= 5 ? '#EF4444' : '#F59E0B';
      ctx.fillText(hitLabel, rx, ry);

      ctx.font = '700 13px ui-monospace, SFMono-Regular, Menlo, monospace';
      const dmgLabel = `${tr.stats.comboDamage} DMG`;
      ctx.strokeText(dmgLabel, rx, ry + 36);
      ctx.fillStyle = palette.dark ? '#E2E8F0' : '#1E293B';
      ctx.fillText(dmgLabel, rx, ry + 36);
    }

    ctx.restore();
  }

  private drawDebugOverlay(ctx: CanvasRenderingContext2D, world: StickmanWorld): void {
    ctx.save();
    for (const f of world.fighters) {
      if (!f.alive) continue;
      ctx.strokeStyle = '#22D3EE';
      ctx.lineWidth = 1;
      ctx.strokeRect(f.x - f.halfWidth, f.y - f.height, f.halfWidth * 2, f.height);

      // 速度矢量
      ctx.strokeStyle = '#FACC15';
      ctx.beginPath();
      ctx.moveTo(f.x, f.y - f.height * 0.5);
      ctx.lineTo(f.x + f.vx * 0.12, f.y - f.height * 0.5 + f.vy * 0.12);
      ctx.stroke();

      // 8 向瞄准矢量
      ctx.strokeStyle = '#FB7185';
      ctx.beginPath();
      ctx.moveTo(f.x, f.y - f.height * 0.62);
      ctx.lineTo(f.x + f.aimX * 36, f.y - f.height * 0.62 + f.aimY * 36);
      ctx.stroke();
    }
    ctx.restore();
  }
}
