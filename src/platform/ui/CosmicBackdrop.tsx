import { useEffect, useRef } from 'react';

interface StarPoint {
  x: number;
  y: number;
  radius: number;
  depth: number;
  baseAlpha: number;
  twinkleSpeed: number;
  phase: number;
  hueTint: string;
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  length: number;
}

const STARFIELD_MIN_INTERVAL_MS = 1000 / 30;

/**
 * 深空星河动态背景：
 * - 静态深空底色、双层星云柔光与斜向银河带由 GPU 合成的纯 CSS 渐变渲染，零每帧重绘开销
 * - 顶层轻量透明 Canvas 仅负责星辰闪烁漂移与偶发流星（30fps 节流，严格遵循 prefers-reduced-motion）
 */
export function CosmicBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    let seed = 0x5a73c91d;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };

    const starPalette = ['#F8FAFC', '#DBEAFE', '#E0F2FE', '#FEF3C7', '#E2E8F0'];
    const stars: StarPoint[] = Array.from({ length: 115 }, () => {
      const depth = 0.25 + rand() * 0.75;
      return {
        x: rand(),
        y: rand(),
        radius: 0.6 + depth * 1.1,
        depth,
        baseAlpha: 0.28 + rand() * 0.62,
        twinkleSpeed: 0.6 + rand() * 1.6,
        phase: rand() * Math.PI * 2,
        hueTint: starPalette[Math.floor(rand() * starPalette.length)],
      };
    });

    let meteor: ShootingStar | null = null;
    let nextMeteorIn = 3.2;

    const drawFrame = (elapsedSec: number, dtSec: number) => {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      for (const s of stars) {
        const driftY = prefersReduced ? 0 : (elapsedSec * 0.002 * s.depth) % 1;
        const driftX = prefersReduced ? 0 : (elapsedSec * 0.0007 * s.depth) % 1;
        const sx = ((s.x + driftX) % 1) * width;
        const sy = ((s.y - driftY + 1) % 1) * height;
        const twinkle = prefersReduced
          ? 1
          : 0.65 + 0.35 * Math.sin(elapsedSec * s.twinkleSpeed + s.phase);
        const alpha = Math.min(1, s.baseAlpha * twinkle);

        ctx.globalAlpha = alpha;
        ctx.fillStyle = s.hueTint;
        ctx.beginPath();
        ctx.arc(sx, sy, s.radius, 0, Math.PI * 2);
        ctx.fill();

        if (s.radius > 1.45 && alpha > 0.65) {
          ctx.globalAlpha = alpha * 0.36;
          ctx.strokeStyle = s.hueTint;
          ctx.lineWidth = 0.75;
          const arm = s.radius * 3.1;
          ctx.beginPath();
          ctx.moveTo(sx - arm, sy);
          ctx.lineTo(sx + arm, sy);
          ctx.moveTo(sx, sy - arm);
          ctx.lineTo(sx, sy + arm);
          ctx.stroke();
        }
      }

      if (!prefersReduced && dtSec > 0) {
        nextMeteorIn -= dtSec;
        if (!meteor && nextMeteorIn <= 0) {
          meteor = {
            x: width * (0.28 + rand() * 0.62),
            y: height * (0.06 + rand() * 0.25),
            vx: -410 - rand() * 160,
            vy: 185 + rand() * 85,
            life: 0,
            maxLife: 0.75 + rand() * 0.35,
            length: 75 + rand() * 55,
          };
          nextMeteorIn = 5.5 + rand() * 6;
        }

        if (meteor) {
          meteor.life += dtSec;
          meteor.x += meteor.vx * dtSec;
          meteor.y += meteor.vy * dtSec;
          const progress = meteor.life / meteor.maxLife;
          if (progress >= 1) {
            meteor = null;
          } else {
            const fade = Math.sin(progress * Math.PI);
            const speed = Math.hypot(meteor.vx, meteor.vy);
            const tailX = meteor.x - (meteor.vx / speed) * meteor.length;
            const tailY = meteor.y - (meteor.vy / speed) * meteor.length;

            const mGrad = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
            mGrad.addColorStop(0, `rgba(248, 250, 252, ${0.85 * fade})`);
            mGrad.addColorStop(0.35, `rgba(125, 211, 252, ${0.45 * fade})`);
            mGrad.addColorStop(1, 'rgba(125, 211, 252, 0)');

            ctx.globalAlpha = 1;
            ctx.strokeStyle = mGrad;
            ctx.lineWidth = 1.6;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(meteor.x, meteor.y);
            ctx.lineTo(tailX, tailY);
            ctx.stroke();
          }
        }
      }

      ctx.restore();
    };

    const syncSize = () => {
      const parent = canvas.parentElement;
      const rect = parent
        ? parent.getBoundingClientRect()
        : { width: window.innerWidth, height: window.innerHeight };
      width = Math.max(320, Math.floor(rect.width));
      height = Math.max(240, Math.floor(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const targetW = Math.round(width * dpr);
      const targetH = Math.round(height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      drawFrame(0, 0);
    };

    syncSize();
    window.addEventListener('resize', syncSize);

    if (prefersReduced) {
      return () => {
        window.removeEventListener('resize', syncSize);
      };
    }

    let rafId = 0;
    let startTs: number | null = null;
    let lastDrawTs = 0;

    const loop = (ts: number) => {
      if (startTs === null) startTs = ts;
      const sinceLast = ts - lastDrawTs;
      if (sinceLast >= STARFIELD_MIN_INTERVAL_MS) {
        const dtSec = lastDrawTs === 0 ? 0 : Math.min(0.08, sinceLast / 1000);
        lastDrawTs = ts;
        drawFrame((ts - startTs) / 1000, dtSec);
      }
      rafId = window.requestAnimationFrame(loop);
    };

    rafId = window.requestAnimationFrame(loop);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', syncSize);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        background:
          'radial-gradient(60% 55% at 20% 24%, rgba(37, 74, 158, 0.28) 0%, rgba(18, 34, 78, 0.10) 48%, transparent 100%), ' +
          'radial-gradient(54% 52% at 80% 74%, rgba(79, 52, 138, 0.24) 0%, rgba(28, 24, 72, 0.08) 50%, transparent 100%), ' +
          'linear-gradient(135deg, #040712 0%, #070C1E 52%, #090D1C 100%)',
      }}
    >
      {/* 斜向柔光银河星带 */}
      <div
        className="absolute -inset-x-1/4 top-1/2 h-[42vh] -translate-y-1/2 -rotate-[18deg] opacity-60"
        style={{
          background:
            'linear-gradient(to bottom, transparent 0%, rgba(125, 211, 252, 0.05) 48%, rgba(167, 139, 250, 0.04) 55%, transparent 100%)',
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 block w-full h-full" />
    </div>
  );
}
