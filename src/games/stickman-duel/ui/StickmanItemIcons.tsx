import type { StickPickupKind } from '../types';

export interface StickmanItemAccent {
  fg: string;
  bg: string;
  border: string;
}

export const STICKMAN_ITEM_ACCENTS: Record<StickPickupKind, StickmanItemAccent> = {
  sword: {
    fg: '#0284C7',
    bg: 'rgba(56, 189, 248, 0.14)',
    border: '#38BDF8',
  },
  pistol: {
    fg: '#D97706',
    bg: 'rgba(245, 158, 11, 0.14)',
    border: '#F59E0B',
  },
  shotgun: {
    fg: '#EA580C',
    bg: 'rgba(234, 88, 12, 0.14)',
    border: '#F97316',
  },
  rocket: {
    fg: '#DC2626',
    bg: 'rgba(239, 68, 68, 0.14)',
    border: '#EF4444',
  },
  grenade: {
    fg: '#4D7C0F',
    bg: 'rgba(132, 204, 22, 0.16)',
    border: '#84CC16',
  },
  medkit: {
    fg: '#059669',
    bg: 'rgba(16, 185, 129, 0.14)',
    border: '#10B981',
  },
};

/**
 * 火柴人军械库专属矢量武器与血包图标（与战场 Canvas 绘制风格一致）
 */
export function StickmanItemIcon({
  kind,
  className = 'w-9 h-9',
}: {
  kind: StickPickupKind;
  className?: string;
}) {
  if (kind === 'sword') {
    return (
      <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
        {/* 青蓝剑刃外光 */}
        <path
          d="M17 31 L38 10 L40 8 L38 14 L20 32 Z"
          fill="#38BDF8"
          opacity="0.28"
        />
        {/* 亮银长刃 */}
        <path
          d="M17 30 L35 12 L40 9 L37 14 L19 32 Z"
          fill="#E0F2FE"
          stroke="#0284C7"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* 剑脊高光 */}
        <line x1="20" y1="28" x2="35" y2="13" stroke="#FFFFFF" strokeWidth="1.6" strokeLinecap="round" />
        {/* 金色护手 */}
        <path
          d="M13 24 L24 35"
          stroke="#F59E0B"
          strokeWidth="4.2"
          strokeLinecap="round"
        />
        {/* 握柄与剑首 */}
        <path
          d="M10 38 L17.5 30.5"
          stroke="#334155"
          strokeWidth="4.2"
          strokeLinecap="round"
        />
        <circle cx="9.5" cy="38.5" r="2.8" fill="#F59E0B" stroke="#1E293B" strokeWidth="1.2" />
      </svg>
    );
  }

  if (kind === 'pistol') {
    return (
      <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
        {/* 套筒主体 */}
        <rect
          x="8"
          y="14"
          width="30"
          height="10"
          rx="2.5"
          fill="#1E293B"
          stroke="#0F172A"
          strokeWidth="1.5"
        />
        {/* 琥珀战术顶轨 */}
        <rect x="10" y="14" width="25" height="4" rx="1.5" fill="#F59E0B" />
        {/* 准星与枪口 */}
        <rect x="38" y="16" width="3.5" height="5.5" rx="1" fill="#475569" />
        <rect x="33" y="11.5" width="3" height="2.8" rx="0.8" fill="#FBBF24" />
        {/* 扳机护圈与握把 */}
        <path
          d="M19 24 L25 24 L25 29 C25 30.5 23.5 31 22 31 L18 31"
          fill="none"
          stroke="#475569"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M11 24 L20 24 L17 38 L9 38 Z"
          fill="#334155"
          stroke="#0F172A"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* 握把防滑纹 */}
        <line x1="12.5" y1="28" x2="16.5" y2="28" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="11.8" y1="32" x2="15.8" y2="32" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === 'shotgun') {
    return (
      <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
        <g transform="rotate(-18 24 24)">
          {/* 30° 扇形散射示意光晕与三枚小弹丸 */}
          <path d="M35 20 L46 14 L46 26 Z" fill="#F97316" opacity="0.22" />
          <circle cx="43.5" cy="16.2" r="1.9" fill="#EA580C" />
          <circle cx="45" cy="20" r="1.9" fill="#F97316" />
          <circle cx="43.5" cy="23.8" r="1.9" fill="#EA580C" />
          {/* 胡桃木枪托 */}
          <path
            d="M4 22 L15 19 L16 26 L5 31 Z"
            fill="#9A3412"
            stroke="#431407"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          {/* 双管金属枪管 */}
          <rect x="14" y="16.5" width="23" height="4.4" rx="1.4" fill="#1E293B" />
          <rect x="17" y="20.4" width="20" height="3" rx="1" fill="#475569" />
          {/* 橙铜机匣 */}
          <rect
            x="14"
            y="17"
            width="8.5"
            height="7"
            rx="1.5"
            fill="#EA580C"
            stroke="#7C2D12"
            strokeWidth="1.2"
          />
          {/* 木质泵动护木 */}
          <rect
            x="23.5"
            y="22.5"
            width="10"
            height="4.4"
            rx="1.5"
            fill="#B45309"
            stroke="#431407"
            strokeWidth="1.2"
          />
          <line x1="26" y1="23.5" x2="26" y2="26" stroke="#FDE68A" strokeWidth="1" opacity="0.65" />
          <line x1="29" y1="23.5" x2="29" y2="26" stroke="#FDE68A" strokeWidth="1" opacity="0.65" />
          <line x1="32" y1="23.5" x2="32" y2="26" stroke="#FDE68A" strokeWidth="1" opacity="0.65" />
        </g>
      </svg>
    );
  }

  if (kind === 'rocket') {
    return (
      <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
        {/* 发射筒主体 */}
        <g transform="rotate(-18 24 24)">
          <rect
            x="9"
            y="18"
            width="24"
            height="12"
            rx="2.5"
            fill="#3F4E3C"
            stroke="#1E293B"
            strokeWidth="1.6"
          />
          {/* 尾喷口 */}
          <rect x="5" y="16.5" width="5" height="15" rx="1.5" fill="#1E293B" />
          {/* 黄色警示环 */}
          <rect x="19" y="18" width="5" height="12" fill="#F59E0B" />
          {/* 烈焰红弹头 */}
          <path
            d="M33 17.5 L43 24 L33 30.5 Z"
            fill="#EF4444"
            stroke="#991B1B"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          {/* 瞄准镜与握把 */}
          <rect x="14" y="13.5" width="8" height="3.5" rx="1" fill="#334155" />
          <rect x="17" y="30" width="4.5" height="6.5" rx="1.2" fill="#1E293B" />
        </g>
      </svg>
    );
  }

  if (kind === 'grenade') {
    return (
      <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
        {/* 六向微碎片辐射示意点 */}
        <circle cx="9" cy="18" r="1.6" fill="#84CC16" opacity="0.7" />
        <circle cx="39" cy="18" r="1.6" fill="#84CC16" opacity="0.7" />
        <circle cx="8" cy="30" r="1.5" fill="#65A30D" opacity="0.6" />
        <circle cx="40" cy="30" r="1.5" fill="#65A30D" opacity="0.6" />
        {/* 握把保险勺 */}
        <path
          d="M27 11 C33 12 36 17 35.5 25"
          fill="none"
          stroke="#475569"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* 顶盖与拉环 */}
        <rect
          x="19.5"
          y="9.5"
          width="9"
          height="5"
          rx="1.6"
          fill="#334155"
          stroke="#1E293B"
          strokeWidth="1.3"
        />
        <circle
          cx="15.5"
          cy="11.5"
          r="3.2"
          fill="none"
          stroke="#F59E0B"
          strokeWidth="2"
        />
        {/* 橄榄绿破片手雷椭球主体 */}
        <ellipse
          cx="24"
          cy="27.5"
          rx="11"
          ry="13"
          fill="#4D7C0F"
          stroke="#1A2E05"
          strokeWidth="1.8"
        />
        {/* 高光与破片格纹 */}
        <path
          d="M15 23 H33 M14 28 H34 M15.5 33 H32.5"
          stroke="#1A2E05"
          strokeWidth="1.3"
          opacity="0.75"
        />
        <path
          d="M20 15.5 C18.5 22 18.5 32 20 39.5 M28 15.5 C29.5 22 29.5 32 28 39.5"
          fill="none"
          stroke="#1A2E05"
          strokeWidth="1.3"
          opacity="0.75"
        />
        {/* 亮绿警戒腰带 */}
        <rect x="13.5" y="25.8" width="21" height="3.2" rx="1" fill="#A3E635" opacity="0.88" />
        <ellipse cx="19.5" cy="21" rx="2.4" ry="4" fill="#D9F99D" opacity="0.32" />
      </svg>
    );
  }

  // medkit
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      {/* 提手 */}
      <path
        d="M18 15 V12 C18 10.5 19.2 9.5 20.8 9.5 H27.2 C28.8 9.5 30 10.5 30 12 V15"
        fill="none"
        stroke="#059669"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
      {/* 医疗箱外壳 */}
      <rect
        x="8"
        y="15"
        width="32"
        height="24"
        rx="5"
        fill="#FFFFFF"
        stroke="#10B981"
        strokeWidth="2.4"
      />
      {/* 翠绿十字 */}
      <rect x="21" y="20" width="6" height="14" rx="1.5" fill="#10B981" />
      <rect x="17" y="24" width="14" height="6" rx="1.5" fill="#10B981" />
    </svg>
  );
}
