import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpDown,
  Clock,
  Compass,
  Crosshair,
  Flame,
  Footprints,
  GitFork,
  Hand,
  Hash,
  Heart,
  HeartPulse,
  Hourglass,
  Layers,
  MapPin,
  Package,
  Radar,
  RefreshCw,
  Repeat,
  Rocket,
  RotateCw,
  Shield,
  SlidersHorizontal,
  Sword,
  Timer,
  Trophy,
  Wind,
  Zap,
} from 'lucide-react';

interface FieldIconSpec {
  icon: ReactNode;
  color: string;
}

/** 弹夹三发子弹排 SVG（匹配 Lucide 2px 几何线宽） */
function AmmoMagazineSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
      <path d="M5 10c0-2.5 1-4.5 2-5.5 1 1 2 3 2 5.5v9H5v-9Z" />
      <path d="M10 10c0-2.5 1-4.5 2-5.5 1 1 2 3 2 5.5v9h-4v-9Z" />
      <path d="M15 10c0-2.5 1-4.5 2-5.5 1 1 2 3 2 5.5v9h-4v-9Z" />
      <line x1="4" y1="19" x2="20" y2="19" />
    </svg>
  );
}

/** 双弹空中对撞抵消火花 SVG */
function BulletClashSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
      <path d="M3 12h4.5" />
      <circle cx="8.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <path d="M21 12h-4.5" />
      <circle cx="15.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <path d="M12 4.5v3" />
      <path d="M12 16.5v3" />
      <path d="M8.5 7.5 10 9" />
      <path d="M15.5 7.5 14 9" />
      <path d="M8.5 16.5 10 15" />
      <path d="M15.5 16.5 14 15" />
    </svg>
  );
}

/** 坦克前进速度 SVG（履带车体 + 双前冲箭头） */
function TankForwardSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
      <rect x="3" y="13" width="12" height="6" rx="2" />
      <path d="M6 13v-2a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2" />
      <path d="M13 11h6" />
      <path d="m17 6 4 3-4 3" />
    </svg>
  );
}

/** 坦克倒车速度 SVG（履带车体 + 后退箭头） */
function TankReverseSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
      <rect x="9" y="13" width="12" height="6" rx="2" />
      <path d="M12 13v-2a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2" />
      <path d="M12 11H5" />
      <path d="m7 6-4 3 4 3" />
    </svg>
  );
}

/** 普通弹飞行速度 SVG（高速弹丸 + 三道尾迹） */
function BulletSpeedSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
      <path d="M13 8h3.5a4 4 0 0 1 0 8H13V8Z" />
      <line x1="3" y1="9" x2="9" y2="9" />
      <line x1="5" y1="12" x2="9.5" y2="12" />
      <line x1="3" y1="15" x2="9" y2="15" />
    </svg>
  );
}

/** 地雷爆炸伤害半径 SVG（中心星爆 + 扩散环） */
function BlastRadiusSvg() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" strokeDasharray="3 2.5" />
      <path d="m12 6.5 1.4 3.6 3.9.4-3 2.5.9 3.8-3.2-2-3.2 2 .9-3.8-3-2.5 3.9-.4L12 6.5Z" />
    </svg>
  );
}

function resolveFieldIconSpec(fieldKey: string): FieldIconSpec {
  switch (fieldKey) {
    // 游戏 · 坦克与普通弹
    case 'magazineCapacity':
      return { icon: <AmmoMagazineSvg />, color: '#EA580C' };
    case 'reloadIntervalSeconds':
      return { icon: <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />, color: '#0284C7' };
    case 'normalFireCooldownSeconds':
      return { icon: <Flame className="w-3.5 h-3.5" aria-hidden="true" />, color: '#E11D48' };
    case 'normalBulletLifetimeSeconds':
      return { icon: <Hourglass className="w-3.5 h-3.5" aria-hidden="true" />, color: '#7C3AED' };
    case 'normalBulletCancelEnabled':
      return { icon: <BulletClashSvg />, color: '#0D9488' };

    // 游戏 · 高级手感参数
    case 'tankForwardSpeed':
      return { icon: <TankForwardSvg />, color: '#059669' };
    case 'tankReverseSpeed':
      return { icon: <TankReverseSvg />, color: '#2563EB' };
    case 'tankTurnSpeedDeg':
      return { icon: <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />, color: '#D97706' };
    case 'normalBulletSpeed':
      return { icon: <BulletSpeedSvg />, color: '#EA580C' };
    case 'homingBulletSpeed':
      return { icon: <Rocket className="w-3.5 h-3.5" aria-hidden="true" />, color: '#0D9488' };
    case 'homingTurnRateDeg':
      return { icon: <Compass className="w-3.5 h-3.5" aria-hidden="true" />, color: '#6366F1' };
    case 'mineTriggerRadius':
      return { icon: <Radar className="w-3.5 h-3.5" aria-hidden="true" />, color: '#D97706' };
    case 'mineBlastRadius':
      return { icon: <BlastRadiusSvg />, color: '#DC2626' };

    // 基础 · 赛制
    case 'targetScore':
      return { icon: <Trophy className="w-3.5 h-3.5" aria-hidden="true" />, color: '#D97706' };
    case 'countdownSeconds':
      return { icon: <Timer className="w-3.5 h-3.5" aria-hidden="true" />, color: '#0284C7' };
    case 'roundTimeLimitEnabled':
    case 'roundTimeLimitSeconds':
      return { icon: <Clock className="w-3.5 h-3.5" aria-hidden="true" />, color: '#E11D48' };

    // 地图与出生
    case 'gridCols':
      return { icon: <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden="true" />, color: '#0D9488' };
    case 'gridRows':
      return { icon: <ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" />, color: '#6366F1' };
    case 'extraPassages':
      return { icon: <GitFork className="w-3.5 h-3.5" aria-hidden="true" />, color: '#059669' };
    case 'mapCode':
      return { icon: <Hash className="w-3.5 h-3.5" aria-hidden="true" />, color: '#EA580C' };
    case 'spawnMode':
      return { icon: <MapPin className="w-3.5 h-3.5" aria-hidden="true" />, color: '#7C3AED' };
    case 'fixedSpawnSwap':
      return { icon: <Repeat className="w-3.5 h-3.5" aria-hidden="true" />, color: '#D97706' };

    // 火柴人决斗 · 地形、血条、拳脚与武器
    case 'mapTemplate':
      return { icon: <Layers className="w-3.5 h-3.5" aria-hidden="true" />, color: '#0284C7' };
    case 'maxHp':
      return { icon: <Heart className="w-3.5 h-3.5" aria-hidden="true" />, color: '#E11D48' };
    case 'hurtInvulnSeconds':
      return { icon: <Shield className="w-3.5 h-3.5" aria-hidden="true" />, color: '#0284C7' };
    case 'punchDamage':
      return { icon: <Hand className="w-3.5 h-3.5" aria-hidden="true" />, color: '#EA580C' };
    case 'kickDamage':
      return { icon: <Footprints className="w-3.5 h-3.5" aria-hidden="true" />, color: '#D97706' };
    case 'kickKnockback':
      return { icon: <Wind className="w-3.5 h-3.5" aria-hidden="true" />, color: '#7C3AED' };
    case 'moveSpeed':
      return { icon: <Zap className="w-3.5 h-3.5" aria-hidden="true" />, color: '#059669' };
    case 'jumpVelocity':
      return { icon: <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />, color: '#0284C7' };
    case 'gravity':
      return { icon: <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />, color: '#6366F1' };
    case 'dropSpawnMode':
      return { icon: <MapPin className="w-3.5 h-3.5" aria-hidden="true" />, color: '#7C3AED' };
    case 'firstDropDelaySeconds':
    case 'dropIntervalMinSeconds':
    case 'dropIntervalMaxSeconds':
      return { icon: <Timer className="w-3.5 h-3.5" aria-hidden="true" />, color: '#0D9488' };
    case 'maxDropsOnField':
      return { icon: <Package className="w-3.5 h-3.5" aria-hidden="true" />, color: '#D97706' };
    case 'enableSword':
    case 'swordDurability':
    case 'swordDamage':
      return { icon: <Sword className="w-3.5 h-3.5" aria-hidden="true" />, color: '#0284C7' };
    case 'enablePistol':
    case 'pistolAmmo':
    case 'pistolDamage':
    case 'pistolSpeed':
      return { icon: <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />, color: '#D97706' };
    case 'enableShotgun':
    case 'shotgunAmmo':
      return { icon: <AmmoMagazineSvg />, color: '#EA580C' };
    case 'shotgunPellets':
    case 'shotgunSpreadAngleDeg':
      return { icon: <GitFork className="w-3.5 h-3.5" aria-hidden="true" />, color: '#EA580C' };
    case 'shotgunDamage':
      return { icon: <Flame className="w-3.5 h-3.5" aria-hidden="true" />, color: '#EA580C' };
    case 'shotgunSpeed':
      return { icon: <BulletSpeedSvg />, color: '#EA580C' };
    case 'enableRocket':
    case 'rocketAmmo':
    case 'rocketDamage':
    case 'rocketSpeed':
    case 'rocketGravity':
      return { icon: <Rocket className="w-3.5 h-3.5" aria-hidden="true" />, color: '#DC2626' };
    case 'rocketBlastRadius':
      return { icon: <BlastRadiusSvg />, color: '#DC2626' };
    case 'enableMedkit':
    case 'medkitHealPercent':
      return { icon: <HeartPulse className="w-3.5 h-3.5" aria-hidden="true" />, color: '#10B981' };

    default:
      return { icon: <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />, color: 'var(--accent)' };
  }
}

/**
 * 规则项游戏 App 风格微图标徽章（24×24 圆角图标槽 + 语义着色）
 */
export function RuleFieldBadgeIcon({
  fieldKey,
  disabled = false,
}: {
  fieldKey: string;
  disabled?: boolean;
}) {
  const spec = resolveFieldIconSpec(fieldKey);
  const isVarColor = spec.color.startsWith('var(');
  return (
    <span
      data-testid={`rule-field-icon-${fieldKey}`}
      className={`w-6 h-6 rounded-lg inline-flex items-center justify-center shrink-0 transition-opacity ${
        disabled ? 'opacity-45' : ''
      }`}
      style={{
        color: spec.color,
        backgroundColor: isVarColor ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : `${spec.color}1C`,
      }}
    >
      {spec.icon}
    </span>
  );
}
