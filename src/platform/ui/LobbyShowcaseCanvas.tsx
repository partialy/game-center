import { useEffect, useRef } from 'react';
import { stickmanDuelGame } from '../../games/stickman-duel';
import { STICKMAN_BOT_MODELS } from '../../games/stickman-duel/ai/botScripts';
import { StickmanDuelRenderer } from '../../games/stickman-duel/render/drawArena';
import { getDefaultStickmanRules } from '../../games/stickman-duel/rules';
import { StickmanDuelSession } from '../../games/stickman-duel/simulation/world';
import { TankBattleRenderer } from '../../games/tank-battle/render/drawArena';
import { getDefaultTankRules } from '../../games/tank-battle/rules';
import { TankBattleSession } from '../../games/tank-battle/simulation/world';
import { tankBattleGame } from '../../games/tank-battle';
import type { ActionInputState, InputFrame } from '../games/contracts';
import { createStaticInputFrame } from '../input/keyboard';
import type { LobbyPreviewKind } from './lobbyReel';

interface LobbyShowcaseCanvasProps {
  kind: LobbyPreviewKind;
  title: string;
}

/**
 * 大厅右侧大屏游玩示例动画画布：
 * - tank-battle 使用真实 TankBattleSession + TankBattleRenderer 驱动实机巡逻对战
 * - 其余扩展预览项运行各自定制的 60fps 宇宙风格玩法示例动画
 */
export function LobbyShowcaseCanvas({ kind, title }: LobbyShowcaseCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (kind === 'tank-battle') {
      return mountTankBattleDemo(canvas, ctx);
    }
    if (kind === 'stickman-duel') {
      return mountStickmanDuelDemo(canvas, ctx);
    }
    return mountProceduralCosmicDemo(canvas, ctx, kind);
  }, [kind]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="lobby-showcase-canvas"
      data-preview-kind={kind}
      aria-label={`${title} 实时游玩示例动画`}
      className="absolute inset-0 block w-full h-full"
    />
  );
}

function mountTankBattleDemo(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): () => void {
  const demoRules = {
    ...getDefaultTankRules(),
    controlMode: 'classic' as const,
    countdownSeconds: 0,
    gridCols: 8,
    gridRows: 6,
    extraPassages: 7,
    firstDropDelaySeconds: 2.2,
    dropIntervalMinSeconds: 4.8,
    dropIntervalMaxSeconds: 7.5,
    targetScore: 99,
  };

  const session = new TankBattleSession({
    gameId: 'tank-battle',
    rulesVersion: tankBattleGame.rulesVersion,
    rules: demoRules,
    players: [
      {
        slotId: 'p1',
        displayName: 'RED',
        rawName: 'RED',
        colorHex: '#E04B32',
        bindings: tankBattleGame.defaultBindingsBySlot.p1,
      },
      {
        slotId: 'p2',
        displayName: 'BLUE',
        rawName: 'BLUE',
        colorHex: '#2F74E0',
        bindings: tankBattleGame.defaultBindingsBySlot.p2,
      },
    ],
    sessionSeed: 0x20261125,
  });

  const renderer = new TankBattleRenderer();

  const syncSize = () => {
    const parent = canvas.parentElement;
    if (!parent) return;
    const rawW = parent.clientWidth || parent.getBoundingClientRect().width;
    const rawH = parent.clientHeight || parent.getBoundingClientRect().height;
    const w = Math.max(240, Math.floor(rawW));
    const h = Math.max(180, Math.floor(rawH));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextW = Math.round(w * dpr);
    const nextH = Math.round(h * dpr);
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }
    renderer.resize(w, h, dpr);
    renderer.render(ctx, session.getWorldState(), 0);
  };

  syncSize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncSize) : null;
  if (ro && canvas.parentElement) ro.observe(canvas.parentElement);

  let rafId = 0;
  let lastTs: number | null = null;
  let acc = 0;
  let tick = 0;

  const loop = (ts: number) => {
    if (lastTs === null) lastTs = ts;
    const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
    lastTs = ts;
    acc += dt;

    while (acc >= 1 / 60) {
      tick += 1;
      const p1TurnRight = tick % 180 > 125;
      const p1TurnLeft = tick % 180 >= 75 && tick % 180 <= 115;
      const p2TurnLeft = (tick + 50) % 160 > 110;
      const p2TurnRight = (tick + 50) % 160 >= 60 && (tick + 50) % 160 <= 95;
      const p1Fire = tick % 90 === 28;
      const p2Fire = tick % 105 === 72;

      session.step(
        1 / 60,
        createStaticInputFrame({
          p1: {
            forward: { held: true },
            turnRight: { held: p1TurnRight },
            turnLeft: { held: p1TurnLeft },
            fire: { justPressed: p1Fire, held: p1Fire },
          },
          p2: {
            forward: { held: true },
            turnLeft: { held: p2TurnLeft },
            turnRight: { held: p2TurnRight },
            fire: { justPressed: p2Fire, held: p2Fire },
          },
        })
      );
      acc -= 1 / 60;
    }

    renderer.render(ctx, session.getWorldState(), dt);
    rafId = window.requestAnimationFrame(loop);
  };

  rafId = window.requestAnimationFrame(loop);
  return () => {
    window.cancelAnimationFrame(rafId);
    ro?.disconnect();
  };
}

function mountStickmanDuelDemo(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): () => void {
  const demoRules = {
    ...getDefaultStickmanRules(),
    countdownSeconds: 0,
    targetScore: 99,
    mapTemplate: 'twin_towers' as const,
    firstDropDelaySeconds: 1.2,
    dropIntervalMinSeconds: 3.5,
    dropIntervalMaxSeconds: 5.5,
  };

  const session = new StickmanDuelSession({
    gameId: 'stickman-duel',
    rulesVersion: stickmanDuelGame.rulesVersion,
    rules: demoRules,
    players: [
      {
        slotId: 'p1',
        displayName: 'BLADE',
        rawName: 'BLADE',
        colorHex: '#38BDF8',
        bindings: stickmanDuelGame.defaultBindingsBySlot.p1,
        controller: 'ai',
      },
      {
        slotId: 'p2',
        displayName: 'EMBER',
        rawName: 'EMBER',
        colorHex: '#F97316',
        bindings: stickmanDuelGame.defaultBindingsBySlot.p2,
        controller: 'ai',
      },
    ],
    sessionSeed: 0x20261127,
  });

  const botModel = STICKMAN_BOT_MODELS[3] ?? STICKMAN_BOT_MODELS[0];
  const p1Bot = botModel.createAgent(101);
  const p2Bot = botModel.createAgent(202);
  const renderer = new StickmanDuelRenderer();

  const syncSize = () => {
    const parent = canvas.parentElement;
    if (!parent) return;
    const rawW = parent.clientWidth || parent.getBoundingClientRect().width;
    const rawH = parent.clientHeight || parent.getBoundingClientRect().height;
    const w = Math.max(240, Math.floor(rawW));
    const h = Math.max(180, Math.floor(rawH));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextW = Math.round(w * dpr);
    const nextH = Math.round(h * dpr);
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }
    renderer.resize(w, h, dpr);
    renderer.render(ctx, session.getWorldState(), 0);
  };

  syncSize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncSize) : null;
  if (ro && canvas.parentElement) ro.observe(canvas.parentElement);

  const IDLE: ActionInputState = { held: false, justPressed: false, justReleased: false };
  const prevHeld: Record<string, Record<string, boolean>> = { p1: {}, p2: {} };

  const buildSlotStates = (slotId: 'p1' | 'p2', intent: Record<string, boolean>) => {
    const prev = prevHeld[slotId];
    const next: Record<string, boolean> = {};
    const states: Record<string, ActionInputState> = {};
    const keys = new Set([...Object.keys(prev), ...Object.keys(intent)]);
    for (const k of keys) {
      const held = Boolean(intent[k]);
      const was = Boolean(prev[k]);
      if (held) next[k] = true;
      states[k] = { held, justPressed: held && !was, justReleased: !held && was };
    }
    prevHeld[slotId] = next;
    return states;
  };

  let rafId = 0;
  let lastTs: number | null = null;
  let acc = 0;

  const loop = (ts: number) => {
    if (lastTs === null) lastTs = ts;
    const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000));
    lastTs = ts;
    acc += dt;

    while (acc >= 1 / 60) {
      const world = session.getWorldState();
      const s1 = buildSlotStates('p1', p1Bot.decide(world, 'p1', 1 / 60));
      const s2 = buildSlotStates('p2', p2Bot.decide(world, 'p2', 1 / 60));
      const frame: InputFrame = {
        getAction(slotId, actionId) {
          if (slotId === 'p1') return s1[actionId] ?? IDLE;
          if (slotId === 'p2') return s2[actionId] ?? IDLE;
          return IDLE;
        },
      };
      session.step(1 / 60, frame);
      acc -= 1 / 60;
    }

    renderer.render(ctx, session.getWorldState(), dt);
    rafId = window.requestAnimationFrame(loop);
  };

  rafId = window.requestAnimationFrame(loop);
  return () => {
    window.cancelAnimationFrame(rafId);
    ro?.disconnect();
  };
}

function mountProceduralCosmicDemo(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  kind: Exclude<LobbyPreviewKind, 'tank-battle' | 'stickman-duel'>
): () => void {
  let width = 640;
  let height = 420;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  // 球体状态（供星环轨道弹球使用）
  const pongState = {
    x: 0,
    y: 0,
    vx: 180,
    vy: 112,
    trail: [] as Array<{ x: number; y: number }>,
    ripples: [] as Array<{ x: number; y: number; r: number; alpha: number; color: string }>,
  };

  const drawByKind = (t: number, dt: number) => {
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 统一深空舞台底色
    const grad = ctx.createRadialGradient(
      width * 0.5,
      height * 0.48,
      24,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.72
    );
    grad.addColorStop(0, '#101A36');
    grad.addColorStop(0.6, '#090F22');
    grad.addColorStop(1, '#050814');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // 细微星标网格
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
    ctx.lineWidth = 1;
    const cell = 44;
    for (let gx = (width % cell) / 2; gx < width; gx += cell) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, height);
      ctx.stroke();
    }
    for (let gy = (height % cell) / 2; gy < height; gy += cell) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(width, gy);
      ctx.stroke();
    }

    if (kind === 'orbital-pong') {
      drawOrbitalPongDemo(ctx, width, height, t, dt, pongState);
    } else {
      drawGravityLabyrinthDemo(ctx, width, height, t);
    }

    ctx.restore();
  };

  const syncSize = () => {
    const parent = canvas.parentElement;
    if (!parent) return;
    const rawW = parent.clientWidth || parent.getBoundingClientRect().width;
    const rawH = parent.clientHeight || parent.getBoundingClientRect().height;
    width = Math.max(240, Math.floor(rawW));
    height = Math.max(180, Math.floor(rawH));
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const nextW = Math.round(width * dpr);
    const nextH = Math.round(height * dpr);
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }
    drawByKind(0, 0);
  };

  syncSize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncSize) : null;
  if (ro && canvas.parentElement) ro.observe(canvas.parentElement);

  let rafId = 0;
  let startTs: number | null = null;
  let lastDrawTs = 0;
  const minFrameIntervalMs = 1000 / 45;

  const loop = (ts: number) => {
    if (startTs === null) startTs = ts;
    const sinceLast = ts - lastDrawTs;
    if (sinceLast >= minFrameIntervalMs) {
      const dt = lastDrawTs === 0 ? 0 : Math.min(0.05, Math.max(0, sinceLast / 1000));
      lastDrawTs = ts;
      drawByKind((ts - startTs) / 1000, dt);
    }
    rafId = window.requestAnimationFrame(loop);
  };

  rafId = window.requestAnimationFrame(loop);
  return () => {
    window.cancelAnimationFrame(rafId);
    ro?.disconnect();
  };
}

function drawOrbitalPongDemo(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  dt: number,
  state: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    trail: Array<{ x: number; y: number }>;
    ripples: Array<{ x: number; y: number; r: number; alpha: number; color: string }>;
  }
): void {
  const cx = w * 0.5;
  const cy = h * 0.5;
  const radius = Math.min(w, h) * 0.37;

  // 更新球体位置（在圆环内持续反弹）
  if (dt > 0) {
    state.x += state.vx * dt;
    state.y += state.vy * dt;
    const dist = Math.hypot(state.x, state.y);
    const limit = radius - 14;
    if (dist >= limit && dist > 0.01) {
      const nx = state.x / dist;
      const ny = state.y / dist;
      state.x = nx * limit;
      state.y = ny * limit;
      const dot = state.vx * nx + state.vy * ny;
      state.vx -= 2 * dot * nx;
      state.vy -= 2 * dot * ny;
      // 轻微旋球偏转，避免轨道单调重复
      const twist = 0.14;
      const vxNext = state.vx * Math.cos(twist) - state.vy * Math.sin(twist);
      const vyNext = state.vx * Math.sin(twist) + state.vy * Math.cos(twist);
      state.vx = vxNext;
      state.vy = vyNext;

      state.ripples.push({
        x: cx + state.x,
        y: cy + state.y,
        r: 8,
        alpha: 0.9,
        color: state.x < 0 ? '#F5C469' : '#60A5FA',
      });
    }

    state.trail.push({ x: cx + state.x, y: cy + state.y });
    if (state.trail.length > 26) state.trail.shift();

    for (let i = state.ripples.length - 1; i >= 0; i -= 1) {
      state.ripples[i].r += 85 * dt;
      state.ripples[i].alpha -= 1.4 * dt;
      if (state.ripples[i].alpha <= 0) state.ripples.splice(i, 1);
    }
  }

  // 星象仪同心轨道线
  for (const factor of [1, 0.72, 0.44]) {
    ctx.strokeStyle =
      factor === 1 ? 'rgba(125, 211, 252, 0.32)' : 'rgba(148, 163, 184, 0.12)';
    ctx.lineWidth = factor === 1 ? 2 : 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * factor, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 两位玩家的弧形光盾挡板自动追踪彗星角度
  const ballAngle = Math.atan2(state.y, state.x);
  const leftAngle = Math.PI + Math.sin(t * 1.7) * 0.45 + (state.x < 0 ? (ballAngle - Math.PI) * 0.25 : 0);
  const rightAngle = Math.cos(t * 1.5) * 0.45 + (state.x >= 0 ? ballAngle * 0.35 : 0);

  drawCrescentPaddle(ctx, cx, cy, radius - 4, leftAngle, '#F5C469');
  drawCrescentPaddle(ctx, cx, cy, radius - 4, rightAngle, '#60A5FA');

  // 碰撞波纹
  for (const rip of state.ripples) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, rip.alpha);
    ctx.strokeStyle = rip.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(rip.x, rip.y, rip.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 彗星拖尾
  for (let i = 0; i < state.trail.length; i += 1) {
    const pt = state.trail[i];
    const ratio = (i + 1) / state.trail.length;
    ctx.fillStyle = `rgba(125, 211, 252, ${ratio * 0.55})`;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 2 + ratio * 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // 彗星核心
  const bx = cx + state.x;
  const by = cy + state.y;
  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  ctx.arc(bx, by, 7.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawCrescentPaddle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  angle: number,
  color: string
): void {
  const span = 0.34;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = 10;
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  ctx.arc(cx, cy, r, angle - span, angle + span);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, angle - span, angle + span);
  ctx.stroke();
  ctx.restore();
}

function drawGravityLabyrinthDemo(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number
): void {
  const cx = w * 0.5;
  const cy = h * 0.5;
  const maxR = Math.min(w, h) * 0.39;

  // 三层反方向缓慢旋转的同心星环墙体（带通行缺口）
  const rings = [
    { r: maxR, speed: 0.22, gaps: [0, Math.PI], color: 'rgba(125, 211, 252, 0.55)' },
    { r: maxR * 0.72, speed: -0.34, gaps: [0.6, 2.7, 4.7], color: 'rgba(56, 189, 248, 0.5)' },
    { r: maxR * 0.44, speed: 0.48, gaps: [1.1, 4.2], color: 'rgba(245, 196, 105, 0.6)' },
  ];

  for (const ring of rings) {
    const gapWidth = 0.42;
    const sorted = [...ring.gaps].sort((a, b) => a - b);
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';

    for (let i = 0; i < sorted.length; i += 1) {
      const start = sorted[i] + gapWidth * 0.5 + t * ring.speed;
      const nextGap = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2;
      const end = nextGap - gapWidth * 0.5 + t * ring.speed;
      if (end > start) {
        ctx.beginPath();
        ctx.arc(cx, cy, ring.r, start, end);
        ctx.stroke();
      }
    }
  }

  // 中央引力信标脉冲
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
  const coreGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, 34 + pulse * 14);
  coreGrad.addColorStop(0, 'rgba(254, 243, 199, 0.95)');
  coreGrad.addColorStop(0.45, 'rgba(245, 158, 11, 0.45)');
  coreGrad.addColorStop(1, 'rgba(245, 158, 11, 0)');
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, 34 + pulse * 14, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#FEF3C7';
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fill();

  // 两架沿着星环轨道穿行的侦察机
  const drones = [
    { orbitR: maxR * 0.86, angle: t * 0.85, color: '#38BDF8' },
    { orbitR: maxR * 0.58, angle: -t * 1.15 + 1.8, color: '#F97316' },
  ];

  for (const d of drones) {
    // 尾迹弧线
    ctx.strokeStyle = d.color;
    ctx.globalAlpha = 0.32;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      d.orbitR,
      d.angle - (d.orbitR > maxR * 0.7 ? 0.55 : -0.55),
      d.angle,
      d.orbitR <= maxR * 0.7
    );
    ctx.stroke();

    ctx.globalAlpha = 1;
    const dx = cx + Math.cos(d.angle) * d.orbitR;
    const dy = cy + Math.sin(d.angle) * d.orbitR;
    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(d.angle + (d.orbitR > maxR * 0.7 ? Math.PI / 2 : -Math.PI / 2));
    ctx.fillStyle = d.color;
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-8, -6.5);
    ctx.lineTo(-4.5, 0);
    ctx.lineTo(-8, 6.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
