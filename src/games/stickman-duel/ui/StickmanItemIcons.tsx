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
  rocket: {
    fg: '#DC2626',
    bg: 'rgba(239, 68, 68, 0.14)',
    border: '#EF4444',
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
