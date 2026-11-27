import type { GameRenderer } from '../../../platform/games/contracts';
import { getTile } from '../map/terrain';
import { PICKUP_ACCENTS, PICKUP_LABELS } from '../simulation/combat';
import type {
  GroundPickup,
  StickFighter,
  StickmanTerrain,
  StickmanWorld,
  StickProjectile,
} from '../types';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssWidth = Math.max(1, cssWidth);
    this.cssHeight = Math.max(1, cssHeight);
    this.dpr = Math.max(1, dpr);
  }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  render(ctx: CanvasRenderingContext2D, world: StickmanWorld, realDtSeconds: number): void {
    this.elapsedVisual += Math.min(0.05, Math.max(0, realDtSeconds));
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

    // 方向性打击震屏偏移
    let shakeX = 0;
    let shakeY = 0;
    if (world.shakeIntensity > 0.2) {
      const jitter = (Math.sin(this.elapsedVisual * 78) + Math.cos(this.elapsedVisual * 113)) * 0.5;
      shakeX = (world.shakeDirX * 0.65 + jitter * 0.55) * world.shakeIntensity;
      shakeY = (world.shakeDirY * 0.65 + Math.cos(this.elapsedVisual * 95) * 0.45) * world.shakeIntensity;
    }

    ctx.save();
    ctx.translate(offsetX + shakeX * scale, offsetY + shakeY * scale);
    ctx.scale(scale, scale);

    // 裁剪到竞技场边界内
    ctx.beginPath();
    ctx.roundRect(0, 0, worldW, worldH, 10);
    ctx.clip();

    this.drawBackdrop(ctx, worldW, worldH, palette);
    this.drawTerrain(ctx, world.terrain, palette);
    this.drawPickups(ctx, world, palette);
    this.drawSlashes(ctx, world);
    this.drawFighters(ctx, world, palette);
    this.drawProjectiles(ctx, world.projectiles);
    this.drawExplosions(ctx, world);
    this.drawParticles(ctx, world);
    this.drawOverheadHud(ctx, world, palette);
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

  private drawTerrain(
    ctx: CanvasRenderingContext2D,
    terrain: StickmanTerrain,
    palette: Palette
  ): void {
    const ts = terrain.tileSize;

    for (let r = 0; r < terrain.rows; r += 1) {
      for (let c = 0; c < terrain.cols; c += 1) {
        const tile = getTile(terrain, c, r);
        if (tile === 'empty') continue;

        const x = c * ts;
        const y = r * ts;
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
      const cx = drop.x;
      const cy = drop.y - 12 + bob;
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
    palette: Palette
  ): void {
    for (const f of world.fighters) {
      this.drawSingleFighter(ctx, f, palette);
    }
  }

  private drawSingleFighter(
    ctx: CanvasRenderingContext2D,
    f: StickFighter,
    palette: Palette
  ): void {
    ctx.save();

    // 脚底接触阴影（仅存活且贴近地面/空中柔和缩放）
    if (f.alive) {
      ctx.fillStyle = palette.dark ? 'rgba(0,0,0,0.42)' : 'rgba(28,33,39,0.18)';
      ctx.beginPath();
      ctx.ellipse(f.x, f.y + 1, f.onGround ? 15 : 9, f.onGround ? 4 : 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 飘动头巾（世界坐标绘制，提供强烈动势与玩家颜色辨识）
    if (f.scarf.length >= 2) {
      ctx.save();
      ctx.globalAlpha = f.alive ? 0.95 : Math.max(0.15, 1 - f.koTimer * 0.7);
      ctx.strokeStyle = f.config.colorHex;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 5.2;
      ctx.beginPath();
      ctx.moveTo(f.scarf[0].x, f.scarf[0].y);
      for (let i = 1; i < f.scarf.length; i += 1) {
        ctx.lineTo(f.scarf[i].x, f.scarf[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 远程武器 8 向瞄准辅助线（仅在持枪/火箭且存活时）
    if (f.alive && f.weapon && (f.weapon.kind === 'pistol' || f.weapon.kind === 'rocket')) {
      this.drawAimGuide(ctx, f);
    }

    // 移动到角色锚点（脚底中心）
    ctx.translate(f.x, f.y);

    if (!f.alive) {
      ctx.globalAlpha = Math.max(0.22, 1 - f.koTimer * 0.45);
      ctx.translate(0, -18);
      ctx.rotate(f.koSpin);
      ctx.translate(0, 18);
    } else if (!f.onGround && f.jumpsUsed >= 2 && Math.abs(f.airSpinAngle) > 0.01) {
      // 二段跳空中翻滚
      ctx.translate(0, -24);
      ctx.rotate(f.airSpinAngle);
      ctx.translate(0, 24);
    }

    const isFlash = f.hitFlashTimer > 0;
    const bodyStroke = isFlash ? '#FFFFFF' : palette.stickStroke;
    const accent = isFlash ? '#FFFFFF' : f.config.colorHex;

    // 计算核心关节点（局部坐标：原点为脚底中心，向上为 -Y）
    const speedRatio = clamp(Math.abs(f.vx) / 260, 0, 1);
    const breath = f.onGround && speedRatio < 0.15 ? Math.sin(this.elapsedVisual * 5 + f.x) * 1.4 : 0;

    let hipX = 0;
    let hipY = -20 + breath * 0.5;
    let lean = f.facing * (0.1 + speedRatio * 0.24);
    if (f.hitStunTimer > 0) {
      lean = -f.facing * 0.42;
      hipX = -f.facing * 4;
    }

    const attack = f.attack;
    const atkRatio = attack ? clamp(attack.elapsed / Math.max(0.01, attack.totalDuration), 0, 1) : 0;
    const isActivePhase = attack
      ? attack.elapsed >= attack.startup && attack.elapsed <= attack.activeEnd
      : false;

    if (attack?.kind === 'punch') {
      lean = f.facing * (isActivePhase ? 0.46 : 0.24);
    } else if (attack?.kind === 'kick') {
      lean = -f.facing * (isActivePhase ? 0.34 : 0.16);
      hipY -= isActivePhase ? 3 : 1;
    } else if (attack?.kind === 'sword') {
      lean = f.facing * (isActivePhase ? 0.5 : -0.18);
    }

    const shoulderX = hipX + Math.sin(lean) * 18;
    const shoulderY = hipY - Math.cos(lean) * 18;
    const headX = shoulderX + Math.sin(lean * 0.8) * 9;
    const headY = shoulderY - 9.5;

    // 腿部关节计算
    let backKneeX: number;
    let backKneeY: number;
    let backFootX: number;
    let backFootY: number;
    let frontKneeX: number;
    let frontKneeY: number;
    let frontFootX: number;
    let frontFootY: number;

    if (attack?.kind === 'kick') {
      const ext = isActivePhase ? 1 : atkRatio < 0.3 ? atkRatio / 0.3 : Math.max(0, 1 - (atkRatio - 0.55) / 0.45);
      // 支撑腿
      backKneeX = hipX - f.facing * 5;
      backKneeY = hipY + 11;
      backFootX = hipX - f.facing * 7;
      backFootY = 0;
      // 高位飞踢腿
      const kickDirX = f.facing * 0.94;
      const kickDirY = -0.34;
      frontKneeX = hipX + kickDirX * (13 + ext * 7);
      frontKneeY = hipY + kickDirY * (10 + ext * 5);
      frontFootX = hipX + kickDirX * (18 + ext * 22);
      frontFootY = hipY + kickDirY * (14 + ext * 16);
    } else if (!f.onGround) {
      // 空中微蜷跃姿
      const rising = f.vy < 0;
      backKneeX = hipX - f.facing * 8;
      backKneeY = hipY + (rising ? 9 : 13);
      backFootX = hipX - f.facing * 13;
      backFootY = hipY + (rising ? 16 : 21);
      frontKneeX = hipX + f.facing * 10;
      frontKneeY = hipY + (rising ? 6 : 11);
      frontFootX = hipX + f.facing * 6;
      frontFootY = hipY + (rising ? 15 : 20);
    } else if (speedRatio > 0.14) {
      const s = Math.sin(f.runPhase);
      const c = Math.cos(f.runPhase);
      backKneeX = hipX - s * 11;
      backKneeY = hipY + 10 - Math.max(0, -c) * 4;
      backFootX = hipX - s * 15 - f.facing * 2;
      backFootY = Math.min(0, -Math.max(0, -c) * 7);

      frontKneeX = hipX + s * 11;
      frontKneeY = hipY + 10 - Math.max(0, c) * 4;
      frontFootX = hipX + s * 15 + f.facing * 2;
      frontFootY = Math.min(0, -Math.max(0, c) * 7);
    } else {
      // 格斗戒备站姿
      backKneeX = hipX - f.facing * 6;
      backKneeY = hipY + 10;
      backFootX = hipX - f.facing * 10;
      backFootY = 0;
      frontKneeX = hipX + f.facing * 7;
      frontKneeY = hipY + 10;
      frontFootX = hipX + f.facing * 10;
      frontFootY = 0;
    }

    // 手臂与手持武器角度计算
    let backElbowX = shoulderX - f.facing * 8;
    let backElbowY = shoulderY + 7;
    let backHandX = shoulderX - f.facing * 3;
    let backHandY = shoulderY + 13;

    let frontElbowX = shoulderX + f.facing * 9;
    let frontElbowY = shoulderY + 6;
    let frontHandX = shoulderX + f.facing * 16;
    let frontHandY = shoulderY + 4 + breath * 0.4;

    let weaponAngle = f.facing === 1 ? 0 : Math.PI;

    if (f.weapon && (f.weapon.kind === 'pistol' || f.weapon.kind === 'rocket')) {
      weaponAngle = Math.atan2(f.aimY, f.aimX);
      const recoil = attack && isActivePhase ? -5 : 0;
      const ux = Math.cos(weaponAngle);
      const uy = Math.sin(weaponAngle);
      frontElbowX = shoulderX + ux * (10 + recoil * 0.5);
      frontElbowY = shoulderY + uy * (10 + recoil * 0.5) + 2;
      frontHandX = shoulderX + ux * (19 + recoil);
      frontHandY = shoulderY + uy * (19 + recoil);
      backElbowX = shoulderX + ux * 6 - f.facing * 3;
      backElbowY = shoulderY + uy * 6 + 5;
      backHandX = shoulderX + ux * 13;
      backHandY = shoulderY + uy * 13 + 2;
    } else if (attack?.kind === 'sword') {
      // 双手大弧度斩击
      const startAng = f.facing === 1 ? -2.35 : Math.PI + 2.35;
      const endAng = f.facing === 1 ? 0.95 : Math.PI - 0.95;
      const swingT = clamp((atkRatio - 0.1) / 0.55, 0, 1);
      const eased = 1 - Math.pow(1 - swingT, 3);
      weaponAngle = lerp(startAng, endAng, eased);
      frontElbowX = shoulderX + Math.cos(weaponAngle) * 11;
      frontElbowY = shoulderY + Math.sin(weaponAngle) * 11;
      frontHandX = shoulderX + Math.cos(weaponAngle) * 20;
      frontHandY = shoulderY + Math.sin(weaponAngle) * 20;
      backHandX = frontHandX - Math.cos(weaponAngle) * 3;
      backHandY = frontHandY - Math.sin(weaponAngle) * 3;
      backElbowX = (shoulderX + backHandX) * 0.5;
      backElbowY = (shoulderY + backHandY) * 0.5 + 3;
    } else if (attack?.kind === 'punch') {
      const punchExt = isActivePhase ? 1 : atkRatio < 0.25 ? atkRatio / 0.25 : 0.2;
      const yOff = attack.comboStep === 2 ? -6 : attack.comboStep === 1 ? 2 : -1;
      frontElbowX = shoulderX + f.facing * (10 + punchExt * 8);
      frontElbowY = shoulderY + 3 + yOff * 0.5;
      frontHandX = shoulderX + f.facing * (15 + punchExt * 20);
      frontHandY = shoulderY + yOff;
      backElbowX = shoulderX - f.facing * 10;
      backElbowY = shoulderY + 6;
      backHandX = shoulderX - f.facing * 6;
      backHandY = shoulderY + 11;
    } else if (f.weapon?.kind === 'sword') {
      // 持剑戒备姿势
      weaponAngle = f.facing === 1 ? -0.58 : Math.PI + 0.58;
      frontElbowX = shoulderX + f.facing * 9;
      frontElbowY = shoulderY + 6;
      frontHandX = shoulderX + f.facing * 16;
      frontHandY = shoulderY + 4;
    } else if (speedRatio > 0.14 && f.onGround) {
      const s = Math.sin(f.runPhase);
      frontElbowX = shoulderX + s * 10;
      frontElbowY = shoulderY + 7;
      frontHandX = shoulderX + s * 15 + f.facing * 3;
      frontHandY = shoulderY + 3;
      backElbowX = shoulderX - s * 10;
      backElbowY = shoulderY + 7;
      backHandX = shoulderX - s * 14;
      backHandY = shoulderY + 5;
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 彩色轮廓底描边，让火柴人在亮/暗背景和混战中都极高对比
    const strokeSkeleton = (color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      // 后腿 & 后臂
      ctx.moveTo(hipX, hipY);
      ctx.lineTo(backKneeX, backKneeY);
      ctx.lineTo(backFootX, backFootY);
      ctx.moveTo(shoulderX, shoulderY);
      ctx.lineTo(backElbowX, backElbowY);
      ctx.lineTo(backHandX, backHandY);
      // 躯干
      ctx.moveTo(hipX, hipY);
      ctx.lineTo(shoulderX, shoulderY);
      // 前腿 & 前臂
      ctx.moveTo(hipX, hipY);
      ctx.lineTo(frontKneeX, frontKneeY);
      ctx.lineTo(frontFootX, frontFootY);
      ctx.moveTo(shoulderX, shoulderY);
      ctx.lineTo(frontElbowX, frontElbowY);
      ctx.lineTo(frontHandX, frontHandY);
      ctx.stroke();
    };

    // 1. 角色主题色外发光勾边
    strokeSkeleton(accent, 6.4);
    // 2. 清晰主骨架线条
    strokeSkeleton(bodyStroke, 3.6);

    // 头部（实心对比圆 + 玩家主题色头带/护目镜）
    ctx.fillStyle = bodyStroke;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(headX, headY, 7.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 护目镜/头带亮条，指示朝向
    ctx.fillStyle = accent;
    ctx.fillRect(
      headX + (f.facing === 1 ? 0.5 : -6.5),
      headY - 2.6,
      6,
      2.6
    );

    // 出拳/踢腿打击残影亮点
    if (attack?.kind === 'punch' && isActivePhase) {
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(frontHandX, frontHandY, 5.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (attack?.kind === 'kick' && isActivePhase) {
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(frontFootX, frontFootY, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 绘制手持武器
    if (f.weapon && f.alive) {
      this.drawHeldWeapon(ctx, f.weapon.kind, frontHandX, frontHandY, weaponAngle, f.facing);
    }

    ctx.restore();
  }

  private drawHeldWeapon(
    ctx: CanvasRenderingContext2D,
    kind: 'sword' | 'pistol' | 'rocket',
    handX: number,
    handY: number,
    angle: number,
    facing: -1 | 1
  ): void {
    ctx.save();
    ctx.translate(handX, handY);
    ctx.rotate(angle);

    if (kind === 'sword') {
      // 长剑：亮银青光刃 + 金色护手
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 5.5;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(44, 0);
      ctx.stroke();

      ctx.globalAlpha = 1;
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

  private drawAimGuide(ctx: CanvasRenderingContext2D, f: StickFighter): void {
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
    } else if (f.weapon.kind === 'rocket') {
      // 短抛物线落点虚点预览，直观体现火箭受重力下坠
      ctx.fillStyle = '#F97316';
      const speed = 540;
      const g = 560;
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
      const weaponTag = f.weapon
        ? ` · ${PICKUP_LABELS[f.weapon.kind][0]}${f.weapon.remaining}`
        : '';
      const label = `${f.config.displayName}${weaponTag}`;
      ctx.font = '700 10px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelW = Math.max(barW, ctx.measureText(label).width + 10);

      ctx.fillStyle = palette.namePlateBg;
      ctx.beginPath();
      ctx.roundRect(f.x - labelW * 0.5, topY - 15, labelW, 13, 6);
      ctx.fill();

      ctx.fillStyle = f.config.colorHex;
      ctx.beginPath();
      ctx.arc(f.x - labelW * 0.5 + 5.5, topY - 8.5, 2.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = palette.namePlateText;
      ctx.fillText(label, f.x + 2, topY - 8.2);

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
