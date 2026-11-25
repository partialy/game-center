import type { GameRenderer } from '../../../platform/games/contracts';
import { getWorldAiDebugSnapshots } from '../ai/botScripts';
import {
  CELL_SIZE,
  DROP_PICKUP_RADIUS,
  type DroppedItemEntity,
  type ItemKind,
  type MazeData,
  MINE_VISUAL_RADIUS,
  type MineEntity,
  type ProjectileEntity,
  TANK_BARREL_LENGTH,
  TANK_RADIUS,
  type TankEntity,
  type TankWorldState,
  WALL_THICKNESS,
} from '../types';
import { ITEM_ACCENT_COLORS } from '../ui/itemIcons';
import {
  getDroppedItemSprite,
  getMineSprite,
  getTankHullSprite,
  getTankTurretSprite,
} from './tankSprites';

interface PooledParticle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  shape: 'circle' | 'spark' | 'ring';
}

const PARTICLE_POOL_SIZE = 160;

/**
 * 《坦克大战》Canvas 2D 战场渲染器：
 * - 等比映射世界坐标，确保任意窗口尺寸下完整显示整张迷宫、无裁剪无拉伸
 * - 零 GC 预分配粒子池渲染炮口火花、碰墙跳弹、弹丸抵消、破盾与爆炸
 * - 地图内仅在坦克上方绘制玩家名称，车身周围直观绘制护盾与道具状态
 */
export class TankBattleRenderer implements GameRenderer<TankWorldState> {
  private cssWidth = 800;
  private cssHeight = 600;
  private dpr = 1;
  private visualTime = 0;
  private debugMode = false;

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
  }

  private readonly particles: PooledParticle[] = Array.from(
    { length: PARTICLE_POOL_SIZE },
    () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      size: 2,
      color: '#1C2127',
      shape: 'circle',
    })
  );
  private particleCursor = 0;

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.dpr = dpr;
  }

  render(ctx: CanvasRenderingContext2D, world: TankWorldState, realDtSeconds: number): void {
    this.visualTime += realDtSeconds;
    this.consumeVisualCues(world);
    this.updateParticles(realDtSeconds);

    const { maze } = world;
    const padding = 20;
    const availW = Math.max(100, this.cssWidth - padding * 2);
    const availH = Math.max(100, this.cssHeight - padding * 2);
    const scale = Math.min(availW / maze.width, availH / maze.height);

    const drawW = maze.width * scale;
    const drawH = maze.height * scale;
    let offsetX = (this.cssWidth - drawW) * 0.5;
    let offsetY = (this.cssHeight - drawH) * 0.5;

    // 轻微平方衰减屏幕震动
    if (world.screenShakeTrauma > 0.01) {
      const mag = world.screenShakeTrauma * world.screenShakeTrauma * 9;
      offsetX += Math.sin(this.visualTime * 67) * mag;
      offsetY += Math.cos(this.visualTime * 83) * mag;
    }

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // 外部底板：与平台统一的暖岩纸色
    ctx.fillStyle = '#E8E3D7';
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // 1. 战场底板与战术方格
    this.drawFloor(ctx, maze);

    // 2. 地雷（铺设在地面层）
    for (let i = 0; i < world.mines.length; i += 1) {
      this.drawMine(ctx, world.mines[i], world);
    }

    // 3. 场上待拾取道具
    for (let i = 0; i < world.drops.length; i += 1) {
      this.drawDroppedItem(ctx, world.drops[i], world.battleTime);
    }

    // 4. 迷宫墙体（带柔和投影与建筑斜角高光）
    this.drawWalls(ctx, maze);

    // 5. 激光光迹
    for (let i = 0; i < world.laserBeams.length; i += 1) {
      const beam = world.laserBeams[i];
      const alpha = Math.max(0, beam.remainingVisualSeconds / beam.maxVisualSeconds);
      this.drawLaserBeam(ctx, beam.points, beam.colorHex, alpha);
    }

    // 6. 弹体（沿用发射者颜色，不同种类采用不同轮廓和尾迹）
    for (let i = 0; i < world.projectiles.length; i += 1) {
      this.drawProjectile(ctx, world.projectiles[i]);
    }

    // 7. 坦克本体、护盾环与头顶人名
    for (let i = 0; i < world.tanks.length; i += 1) {
      const tank = world.tanks[i];
      if (tank.alive) {
        this.drawTank(ctx, tank, world.battleTime);
      } else if (tank.eliminatedAtBattleTime !== null) {
        this.drawWreckMark(ctx, tank);
      }
    }

    // 8. 爆炸冲击波与粒子特效
    for (let i = 0; i < world.explosions.length; i += 1) {
      const exp = world.explosions[i];
      const progress = 1 - exp.remainingVisualSeconds / exp.maxVisualSeconds;
      this.drawExplosion(ctx, exp.x, exp.y, exp.radius, exp.colorHex, progress);
    }
    this.drawParticles(ctx);

    // 9. F3 开发者调试模式下绘制简洁 AI 战术调试叠加层
    if (this.debugMode) {
      this.drawAiDebugOverlay(ctx, world);
    }

    ctx.restore();
  }

  private drawAiDebugOverlay(ctx: CanvasRenderingContext2D, world: TankWorldState): void {
    const debugMap = getWorldAiDebugSnapshots(world);
    if (!debugMap) return;

    ctx.save();
    for (let i = 0; i < world.tanks.length; i += 1) {
      const tank = world.tanks[i];
      if (!tank.alive) continue;
      const snap = debugMap[tank.slotId];
      if (!snap) continue;

      // 1. 规划的迷宫掩体/寻路路径
      if (snap.plannedPathCells.length >= 2) {
        ctx.save();
        ctx.strokeStyle = tank.colorHex;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        for (let pi = 0; pi < snap.plannedPathCells.length; pi += 1) {
          const cell = world.maze.cells[snap.plannedPathCells[pi]];
          if (!cell) continue;
          if (pi === 0) ctx.moveTo(tank.x, tank.y);
          else ctx.lineTo(cell.centerX, cell.centerY);
        }
        ctx.stroke();
        ctx.restore();
      }

      // 2. 锁定目标连线
      if (snap.targetSlotId) {
        const target = world.tanks.find((t) => t.slotId === snap.targetSlotId && t.alive);
        if (target) {
          ctx.save();
          ctx.strokeStyle = 'rgba(220, 38, 38, 0.35)';
          ctx.lineWidth = 1.2;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(tank.x, tank.y);
          ctx.lineTo(target.x, target.y);
          ctx.stroke();
          ctx.restore();
        }
      }

      // 3. 最危险弹道告警点连线
      if (snap.mostDangerousPoint && Number.isFinite(snap.minThreatTtc)) {
        ctx.save();
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(tank.x, tank.y);
        ctx.lineTo(snap.mostDangerousPoint.x, snap.mostDangerousPoint.y);
        ctx.stroke();
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.arc(snap.mostDangerousPoint.x, snap.mostDangerousPoint.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 4. 紧凑战术状态标签（目标 / 拒火原因 / 威胁 TTC）
      const ttcStr = Number.isFinite(snap.minThreatTtc) ? `${snap.minThreatTtc.toFixed(2)}s` : '-';
      const reasonStr = snap.firedThisStep
        ? snap.isCancelShot
          ? 'CANCEL'
          : 'FIRE'
        : snap.fireRejectedReason !== 'ok'
        ? snap.fireRejectedReason
        : snap.goalKind;
      const label = `${snap.modelId} · ${reasonStr} · ttc:${ttcStr}`;

      ctx.font = '600 9px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(20, 24, 31, 0.82)';
      const tw = ctx.measureText(label).width + 8;
      const ly = tank.y + TANK_RADIUS + 6;
      ctx.fillRect(tank.x - tw * 0.5, ly, tw, 13);
      ctx.fillStyle = '#F8FAFC';
      ctx.fillText(label, tank.x, ly + 2);
    }
    ctx.restore();
  }

  private drawFloor(ctx: CanvasRenderingContext2D, maze: MazeData): void {
    // 战场外阴影框
    ctx.save();
    ctx.shadowColor = 'rgba(28, 33, 39, 0.14)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#F3EFE6';
    ctx.fillRect(0, 0, maze.width, maze.height);
    ctx.restore();

    // 柔和网格纹理
    ctx.strokeStyle = 'rgba(38, 45, 53, 0.075)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < maze.cols; c += 1) {
      const x = c * CELL_SIZE;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, maze.height);
    }
    for (let r = 1; r < maze.rows; r += 1) {
      const y = r * CELL_SIZE;
      ctx.moveTo(0, y);
      ctx.lineTo(maze.width, y);
    }
    ctx.stroke();

    // 格子中心极淡定位十字（建筑制图感）
    ctx.strokeStyle = 'rgba(38, 45, 53, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < maze.cells.length; i += 1) {
      const cell = maze.cells[i];
      ctx.moveTo(cell.centerX - 4, cell.centerY);
      ctx.lineTo(cell.centerX + 4, cell.centerY);
      ctx.moveTo(cell.centerX, cell.centerY - 4);
      ctx.lineTo(cell.centerX, cell.centerY + 4);
    }
    ctx.stroke();
  }

  private drawWalls(ctx: CanvasRenderingContext2D, maze: MazeData): void {
    // 先画墙体投影
    ctx.save();
    ctx.strokeStyle = 'rgba(28, 33, 39, 0.14)';
    ctx.lineWidth = WALL_THICKNESS + 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < maze.walls.length; i += 1) {
      const w = maze.walls[i];
      ctx.moveTo(w.x1 + 2.5, w.y1 + 3.5);
      ctx.lineTo(w.x2 + 2.5, w.y2 + 3.5);
    }
    ctx.stroke();

    // 主墙体（深石板炭灰）
    ctx.strokeStyle = '#262D35';
    ctx.lineWidth = WALL_THICKNESS;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < maze.walls.length; i += 1) {
      const w = maze.walls[i];
      ctx.moveTo(w.x1, w.y1);
      ctx.lineTo(w.x2, w.y2);
    }
    ctx.stroke();

    // 墙脊微高光
    ctx.strokeStyle = '#3C4652';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < maze.walls.length; i += 1) {
      const w = maze.walls[i];
      ctx.moveTo(w.x1, w.y1 - 1.5);
      ctx.lineTo(w.x2, w.y2 - 1.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawTank(ctx: CanvasRenderingContext2D, tank: TankEntity, battleTime: number): void {
    ctx.save();
    ctx.translate(tank.x, tank.y);

    // 护盾可视化环（围绕车身）
    if (tank.shield) {
      const rem = Math.max(0, tank.shield.expiresAtBattleTime - battleTime);
      const pulse = 0.5 + 0.5 * Math.sin(this.visualTime * 6);
      const blink = rem < 3 ? (Math.sin(this.visualTime * 22) > 0 ? 1 : 0.35) : 1;
      ctx.save();
      ctx.globalAlpha = 0.85 * blink;
      ctx.beginPath();
      ctx.arc(0, 0, TANK_RADIUS + 9 + pulse * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(14, 107, 168, 0.14)';
      ctx.fill();
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = '#0E6BA8';
      ctx.setLineDash([10, 5]);
      ctx.lineDashOffset = -this.visualTime * 28;
      ctx.stroke();
      ctx.restore();
    } else if (battleTime < tank.shieldGraceUntil) {
      // 破盾保护期极短闪环
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, TANK_RADIUS + 7, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(14, 107, 168, 0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    ctx.rotate(tank.angle);

    // 车身投影
    ctx.save();
    ctx.translate(2, 3.5);
    ctx.fillStyle = 'rgba(28, 33, 39, 0.2)';
    roundRectPath(ctx, -19, -15, 38, 30, 5);
    ctx.fill();
    ctx.restore();

    const hullColor = tank.hitFlashTimer > 0 ? '#FFFFFF' : tank.colorHex;
    const hullSprite = getTankHullSprite(hullColor);
    const turretSprite = getTankTurretSprite(hullColor);

    if (hullSprite && turretSprite) {
      // 1024px 原始画布按 17 px / 世界单位对齐，60.2 × 60.2 绘制框与碰撞箱/炮管长度 1:1 吻合
      const drawSize = 60.2;
      const half = drawSize / 2;
      const recoilShift = tank.recoilOffset * 0.55;

      ctx.drawImage(hullSprite, -half, -half, drawSize, drawSize);
      ctx.drawImage(turretSprite, -half - recoilShift, -half, drawSize, drawSize);

      if (tank.offense) {
        const accent = ITEM_ACCENT_COLORS[tank.offense.kind];
        ctx.fillStyle = accent.fg;
        ctx.beginPath();
        ctx.arc(TANK_BARREL_LENGTH - recoilShift + 2.5, 0, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // 资源未加载完成或无 DOM 测试环境时回退经典矢量绘制
      ctx.fillStyle = '#2B3139';
      roundRectPath(ctx, -20, -16.5, 40, 7, 2.5);
      ctx.fill();
      roundRectPath(ctx, -20, 9.5, 40, 7, 2.5);
      ctx.fill();

      ctx.strokeStyle = '#505A66';
      ctx.lineWidth = 1.6;
      const treadPhase = ((tank.treadDistance % 8) + 8) % 8;
      ctx.beginPath();
      for (let tx = -18 + treadPhase; tx <= 18; tx += 8) {
        ctx.moveTo(tx, -16);
        ctx.lineTo(tx, -10);
        ctx.moveTo(tx, 10);
        ctx.lineTo(tx, 16);
      }
      ctx.stroke();

      ctx.fillStyle = hullColor;
      ctx.strokeStyle = '#1C2127';
      ctx.lineWidth = 2;
      roundRectPath(ctx, -16.5, -12, 33, 24, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
      roundRectPath(ctx, -12, -9, 24, 6, 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(10, -4.5);
      ctx.lineTo(13.5, 0);
      ctx.lineTo(10, 4.5);
      ctx.stroke();

      const recoil = tank.recoilOffset;
      const barrelLen = TANK_BARREL_LENGTH - recoil;
      ctx.fillStyle = '#262D35';
      ctx.strokeStyle = '#14181C';
      ctx.lineWidth = 1.5;
      roundRectPath(ctx, 2 - recoil * 0.4, -3.4, barrelLen, 6.8, 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = hullColor;
      ctx.fillRect(barrelLen - 2, -4.2, 4, 8.4);
      ctx.strokeRect(barrelLen - 2, -4.2, 4, 8.4);

      if (tank.offense) {
        const accent = ITEM_ACCENT_COLORS[tank.offense.kind];
        ctx.fillStyle = accent.fg;
        ctx.beginPath();
        ctx.arc(barrelLen + 2.5, 0, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = hullColor;
      ctx.strokeStyle = '#1C2127';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-1, 0, 9.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
      ctx.beginPath();
      ctx.arc(-2.5, -2, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // 头顶玩家名（地图内唯一文字元素，保持水平不随车旋转）
    ctx.save();
    ctx.font = '700 13px "Plus Jakarta Sans", "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const labelY = tank.y - TANK_RADIUS - 11;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(243, 239, 230, 0.94)';
    ctx.strokeText(tank.displayName, tank.x, labelY);
    ctx.fillStyle = '#1C2127';
    ctx.fillText(tank.displayName, tank.x, labelY);
    ctx.restore();
  }

  private drawWreckMark(ctx: CanvasRenderingContext2D, tank: TankEntity): void {
    ctx.save();
    ctx.translate(tank.x, tank.y);
    ctx.rotate(tank.angle);
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = '#4B525B';
    roundRectPath(ctx, -16, -12, 32, 24, 4);
    ctx.fill();
    ctx.strokeStyle = '#262D35';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-10, -8);
    ctx.lineTo(10, 8);
    ctx.moveTo(10, -8);
    ctx.lineTo(-10, 8);
    ctx.stroke();
    ctx.restore();
  }

  private drawProjectile(ctx: CanvasRenderingContext2D, p: ProjectileEntity): void {
    const angle = Math.atan2(p.vy, p.vx);

    // 道具弹短尾迹
    if (p.source !== 'normal' && p.trail.length > 1) {
      ctx.save();
      ctx.strokeStyle = p.colorHex;
      ctx.lineCap = 'round';
      for (let i = 1; i < p.trail.length; i += 1) {
        const frac = i / p.trail.length;
        ctx.globalAlpha = frac * 0.36;
        ctx.lineWidth = Math.max(1.5, p.radius * frac * 1.15);
        ctx.beginPath();
        ctx.moveTo(p.trail[i - 1].x, p.trail[i - 1].y);
        ctx.lineTo(p.trail[i].x, p.trail[i].y);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);

    if (p.source === 'normal') {
      // 普通弹：经典实心圆弹
      ctx.fillStyle = p.colorHex;
      ctx.strokeStyle = '#1C2127';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.beginPath();
      ctx.arc(-1.2, -1.2, p.radius * 0.35, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.source === 'rapid_fire') {
      // 连发弹：流线曳光弹头
      ctx.fillStyle = p.colorHex;
      ctx.strokeStyle = '#1C2127';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.radius + 4, 0);
      ctx.lineTo(-p.radius - 2, -p.radius * 0.8);
      ctx.lineTo(-p.radius + 1, 0);
      ctx.lineTo(-p.radius - 2, p.radius * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (p.source === 'shotgun') {
      // 三连发散弹：菱形穿甲弹丸
      ctx.fillStyle = p.colorHex;
      ctx.strokeStyle = '#1C2127';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.radius + 2.5, 0);
      ctx.lineTo(0, -p.radius);
      ctx.lineTo(-p.radius - 1.5, 0);
      ctx.lineTo(0, p.radius);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (p.source === 'homing') {
      // 追踪弹：带尾翼微型导弹
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = p.colorHex;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(p.radius + 5, 0);
      ctx.lineTo(-p.radius - 1, -p.radius * 0.95);
      ctx.lineTo(-p.radius + 2, 0);
      ctx.lineTo(-p.radius - 1, p.radius * 0.95);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = p.colorHex;
      ctx.beginPath();
      ctx.arc(1.5, 0, 2.3, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.source === 'frag_parent') {
      // 破片母弹：脉冲定时集束弹
      const pulse = 1 + 0.16 * Math.sin(this.visualTime * 26);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = p.colorHex;
      ctx.strokeStyle = '#1C2127';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, p.radius + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-3.5, 0);
      ctx.lineTo(3.5, 0);
      ctx.moveTo(0, -3.5);
      ctx.lineTo(0, 3.5);
      ctx.stroke();
    } else {
      // 破片碎片：尖锐三角形破片
      ctx.fillStyle = p.colorHex;
      ctx.strokeStyle = '#1C2127';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p.radius + 2, 0);
      ctx.lineTo(-p.radius, -p.radius * 0.85);
      ctx.lineTo(-p.radius, p.radius * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawMine(ctx: CanvasRenderingContext2D, mine: MineEntity, world: TankWorldState): void {
    const armed = world.battleTime + 1e-9 >= mine.armedAtBattleTime;
    const mineSprite = getMineSprite(armed);
    ctx.save();
    ctx.translate(mine.x, mine.y);

    if (!armed) {
      // 未布防状态：虚线外圈 + 进度扇环
      const armDuration = Math.max(0.01, mine.armedAtBattleTime - mine.placedAtBattleTime);
      const frac = Math.max(
        0,
        Math.min(1, (world.battleTime - mine.placedAtBattleTime) / armDuration)
      );
      ctx.strokeStyle = 'rgba(28, 33, 39, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, MINE_VISUAL_RADIUS + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      if (mineSprite) {
        const size = 30.4;
        ctx.drawImage(mineSprite, -size / 2, -size / 2, size, size);
        ctx.strokeStyle = mine.colorHex;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(0, 0, MINE_VISUAL_RADIUS + 2.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#D6D0C4';
        ctx.strokeStyle = '#4B525B';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(0, 0, MINE_VISUAL_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = mine.colorHex;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, MINE_VISUAL_RADIUS - 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        ctx.stroke();
      }
    } else {
      // 已布防状态：微弱触发警戒圈 + 雷体 + 放置者涂装核心闪烁
      const blink = 0.55 + 0.45 * Math.sin(this.visualTime * 9);
      ctx.strokeStyle = mine.colorHex;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(0, 0, world.rules.mineTriggerRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (mineSprite) {
        const size = 30.4;
        ctx.drawImage(mineSprite, -size / 2, -size / 2, size, size);
        ctx.fillStyle = mine.colorHex;
        ctx.globalAlpha = blink;
        ctx.beginPath();
        ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = '#262D35';
        ctx.lineWidth = 2.4;
        for (let a = 0; a < 4; a += 1) {
          const ang = (a * Math.PI) / 2 + Math.PI / 4;
          ctx.beginPath();
          ctx.moveTo(Math.cos(ang) * 7, Math.sin(ang) * 7);
          ctx.lineTo(Math.cos(ang) * (MINE_VISUAL_RADIUS + 3), Math.sin(ang) * (MINE_VISUAL_RADIUS + 3));
          ctx.stroke();
        }

        ctx.fillStyle = '#2A313A';
        ctx.strokeStyle = '#14181C';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(0, 0, MINE_VISUAL_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = mine.colorHex;
        ctx.globalAlpha = blink;
        ctx.beginPath();
        ctx.arc(0, 0, 5.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawDroppedItem(
    ctx: CanvasRenderingContext2D,
    drop: DroppedItemEntity,
    battleTime: number
  ): void {
    const rem = Math.max(0, drop.expiresAtBattleTime - battleTime);
    const total = Math.max(0.01, drop.expiresAtBattleTime - drop.spawnedAtBattleTime);
    const ratio = Math.max(0, Math.min(1, rem / total));
    const blink = rem < 3 ? (Math.sin(this.visualTime * 18) > 0 ? 1 : 0.4) : 1;
    const bob = Math.sin(this.visualTime * 4 + drop.id) * 1.6;
    const palette = ITEM_ACCENT_COLORS[drop.kind];
    const itemSprite = getDroppedItemSprite(drop.kind);

    ctx.save();
    ctx.translate(drop.x, drop.y + bob);
    ctx.globalAlpha = blink;

    // 底部柔和阴影
    ctx.fillStyle = 'rgba(28, 33, 39, 0.14)';
    ctx.beginPath();
    ctx.ellipse(0, DROP_PICKUP_RADIUS * 0.8, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    const r = DROP_PICKUP_RADIUS;

    if (itemSprite) {
      // 八角徽章外框占贴图 82%，按 41.5 绘制使外径精确贴合 DROP_PICKUP_RADIUS = 17
      const size = 41.5;
      ctx.drawImage(itemSprite, -size / 2, -size / 2, size, size);

      ctx.strokeStyle = palette.fg;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.45 * blink;
      ctx.beginPath();
      ctx.arc(0, 0, r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
      ctx.stroke();
    } else {
      // 八边形战术补给底座
      ctx.fillStyle = palette.bg;
      ctx.strokeStyle = palette.fg;
      ctx.lineWidth = 2.2;
      octagonPath(ctx, r);
      ctx.fill();
      ctx.stroke();

      // 留场倒计时圆弧
      ctx.strokeStyle = palette.fg;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.45 * blink;
      ctx.beginPath();
      ctx.arc(0, 0, r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
      ctx.stroke();
      ctx.globalAlpha = blink;

      // 道具专属图标（与 HUD 矢量图标 1:1 匹配）
      drawItemGlyphOnCanvas(ctx, drop.kind, palette.fg);
    }

    ctx.restore();
  }

  private drawLaserBeam(
    ctx: CanvasRenderingContext2D,
    points: Array<{ x: number; y: number }>,
    colorHex: string,
    alpha: number
  ): void {
    if (points.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 外层光晕
    ctx.strokeStyle = colorHex;
    ctx.globalAlpha = alpha * 0.38;
    ctx.lineWidth = 11 * alpha + 3;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();

    // 主光束
    ctx.globalAlpha = alpha * 0.92;
    ctx.lineWidth = 4.2;
    ctx.stroke();

    // 中心亮芯
    ctx.strokeStyle = '#FFFFFF';
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.restore();
  }

  private drawExplosion(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    colorHex: string,
    progress: number
  ): void {
    const p = Math.max(0, Math.min(1, progress));
    const curR = radius * (0.25 + 0.75 * easeOutCubic(p));
    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = colorHex;
    ctx.globalAlpha = (1 - p) * 0.25;
    ctx.beginPath();
    ctx.arc(0, 0, curR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = colorHex;
    ctx.globalAlpha = (1 - p) * 0.85;
    ctx.lineWidth = Math.max(1.5, 6 * (1 - p));
    ctx.beginPath();
    ctx.arc(0, 0, curR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  private consumeVisualCues(world: TankWorldState): void {
    while (world.visualCues.length > 0) {
      const cue = world.visualCues.pop()!;
      if (cue.kind === 'muzzle') {
        const base = cue.angle ?? 0;
        for (let i = 0; i < 4; i += 1) {
          const ang = base + (Math.random() - 0.5) * 0.8;
          const spd = 60 + Math.random() * 90;
          this.spawnParticle(cue.x, cue.y, Math.cos(ang) * spd, Math.sin(ang) * spd, 0.16, 2.8, cue.colorHex, 'spark');
        }
      } else if (cue.kind === 'bounce') {
        for (let i = 0; i < 4; i += 1) {
          const ang = Math.random() * Math.PI * 2;
          const spd = 45 + Math.random() * 80;
          this.spawnParticle(cue.x, cue.y, Math.cos(ang) * spd, Math.sin(ang) * spd, 0.2, 2.4, '#262D35', 'spark');
        }
      } else if (cue.kind === 'cancel') {
        for (let i = 0; i < 8; i += 1) {
          const ang = (i * Math.PI * 2) / 8 + Math.random() * 0.3;
          const spd = 55 + Math.random() * 75;
          this.spawnParticle(cue.x, cue.y, Math.cos(ang) * spd, Math.sin(ang) * spd, 0.24, 3, '#E29527', 'spark');
        }
      } else if (cue.kind === 'pickup') {
        this.spawnParticle(cue.x, cue.y, 0, 0, 0.34, 24, cue.colorHex, 'ring');
        for (let i = 0; i < 6; i += 1) {
          const ang = (i * Math.PI * 2) / 6;
          this.spawnParticle(cue.x, cue.y, Math.cos(ang) * 70, Math.sin(ang) * 70, 0.28, 3, cue.colorHex, 'circle');
        }
      } else if (cue.kind === 'shield_break') {
        this.spawnParticle(cue.x, cue.y, 0, 0, 0.35, 34, '#0E6BA8', 'ring');
        for (let i = 0; i < 14; i += 1) {
          const ang = (i * Math.PI * 2) / 14;
          const spd = 85 + Math.random() * 70;
          this.spawnParticle(cue.x, cue.y, Math.cos(ang) * spd, Math.sin(ang) * spd, 0.35, 3.2, '#0E6BA8', 'spark');
        }
      } else if (cue.kind === 'frag_split') {
        for (let i = 0; i < 12; i += 1) {
          const ang = Math.random() * Math.PI * 2;
          const spd = 60 + Math.random() * 110;
          this.spawnParticle(cue.x, cue.y, Math.cos(ang) * spd, Math.sin(ang) * spd, 0.28, 3.2, cue.colorHex, 'spark');
        }
      } else if (cue.kind === 'explosion') {
        for (let i = 0; i < 20; i += 1) {
          const ang = Math.random() * Math.PI * 2;
          const spd = 50 + Math.random() * 165;
          const col = i % 3 === 0 ? '#262D35' : i % 3 === 1 ? cue.colorHex : '#E88B26';
          this.spawnParticle(cue.x, cue.y, Math.cos(ang) * spd, Math.sin(ang) * spd, 0.42 + Math.random() * 0.2, 3.5 + Math.random() * 2.5, col, 'circle');
        }
      }
    }
  }

  private spawnParticle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    maxLife: number,
    size: number,
    color: string,
    shape: 'circle' | 'spark' | 'ring'
  ): void {
    const p = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL_SIZE;
    p.active = true;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = maxLife;
    p.maxLife = maxLife;
    p.size = size;
    p.color = color;
    p.shape = shape;
  }

  private updateParticles(dt: number): void {
    if (dt <= 0) return;
    for (let i = 0; i < PARTICLE_POOL_SIZE; i += 1) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.93;
      p.vy *= 0.93;
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (let i = 0; i < PARTICLE_POOL_SIZE; i += 1) {
      const p = this.particles[i];
      if (!p.active) continue;
      const frac = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = frac;
      if (p.shape === 'ring') {
        const r = p.size * (1.2 - frac * 0.65);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.4 * frac;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.shape === 'spark') {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * frac, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function octagonPath(ctx: CanvasRenderingContext2D, r: number): void {
  const k = r * 0.42;
  ctx.beginPath();
  ctx.moveTo(-k, -r);
  ctx.lineTo(k, -r);
  ctx.lineTo(r, -k);
  ctx.lineTo(r, k);
  ctx.lineTo(k, r);
  ctx.lineTo(-k, r);
  ctx.lineTo(-r, k);
  ctx.lineTo(-r, -k);
  ctx.closePath();
}

function drawItemGlyphOnCanvas(
  ctx: CanvasRenderingContext2D,
  kind: ItemKind,
  color: string
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (kind) {
    case 'shield':
      ctx.beginPath();
      ctx.moveTo(0, -8.5);
      ctx.lineTo(7, -5.5);
      ctx.lineTo(7, 0.5);
      ctx.quadraticCurveTo(7, 6.2, 0, 9);
      ctx.quadraticCurveTo(-7, 6.2, -7, 0.5);
      ctx.lineTo(-7, -5.5);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -4.5);
      ctx.lineTo(0, 4.5);
      ctx.moveTo(-3.5, 0);
      ctx.lineTo(3.5, 0);
      ctx.stroke();
      break;
    case 'rapid_fire':
      for (const y of [-5, 0, 5]) {
        ctx.beginPath();
        ctx.moveTo(-7, y);
        ctx.lineTo(4.5, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(7, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'shotgun':
      ctx.beginPath();
      ctx.arc(-6, 0, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-4, -1);
      ctx.lineTo(6.5, -6.5);
      ctx.moveTo(-4, 0);
      ctx.lineTo(7.5, 0);
      ctx.moveTo(-4, 1);
      ctx.lineTo(6.5, 6.5);
      ctx.stroke();
      break;
    case 'laser':
      ctx.beginPath();
      ctx.moveTo(-7.5, 6.5);
      ctx.lineTo(-0.5, -1);
      ctx.lineTo(2.5, 2.5);
      ctx.lineTo(7.5, -6.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(7.5, -6.5, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'homing':
      ctx.beginPath();
      ctx.arc(0, 0, 6.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -9.5);
      ctx.lineTo(0, -6.2);
      ctx.moveTo(0, 6.2);
      ctx.lineTo(0, 9.5);
      ctx.moveTo(-9.5, 0);
      ctx.lineTo(-6.2, 0);
      ctx.moveTo(6.2, 0);
      ctx.lineTo(9.5, 0);
      ctx.stroke();
      break;
    case 'frag':
      ctx.beginPath();
      ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i += 1) {
        const ang = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * 5.2, Math.sin(ang) * 5.2);
        ctx.lineTo(Math.cos(ang) * 8.6, Math.sin(ang) * 8.6);
        ctx.stroke();
      }
      break;
    case 'mine':
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 4; i += 1) {
        const ang = (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * 6, Math.sin(ang) * 6);
        ctx.lineTo(Math.cos(ang) * 9, Math.sin(ang) * 9);
        ctx.stroke();
      }
      break;
  }
  ctx.restore();
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
