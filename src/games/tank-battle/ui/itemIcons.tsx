import { ITEM_SPRITE_URLS } from '../render/tankSprites';
import type { ItemKind } from '../types';

export const ITEM_ACCENT_COLORS: Record<ItemKind, { bg: string; fg: string; border: string }> = {
  shield: { bg: '#E1F2FA', fg: '#0E6BA8', border: '#66B3E0' },
  rapid_fire: { bg: '#FEF0DB', fg: '#C25E00', border: '#ECA34B' },
  shotgun: { bg: '#FCE6E0', fg: '#B8321A', border: '#E47E6B' },
  laser: { bg: '#F4E5F9', fg: '#8624A8', border: '#C47CE0' },
  homing: { bg: '#E2F5EC', fg: '#16794B', border: '#5EC293' },
  frag: { bg: '#FDE8EA', fg: '#B81D38', border: '#E46F84' },
  mine: { bg: '#ECEAE4', fg: '#3A3F47', border: '#8A8F98' },
};

interface ItemIconProps {
  kind: string;
  className?: string;
}

/**
 * 与战场内待拾取道具一一对应的七类道具图标（优先使用卡通 WebP 贴图，未知类型回退矢量图标）。
 */
export function TankItemIcon({ kind, className = 'w-4 h-4' }: ItemIconProps) {
  const spriteUrl = ITEM_SPRITE_URLS[kind as ItemKind];
  if (spriteUrl) {
    return (
      <img
        src={spriteUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={`${className} object-contain select-none`}
      />
    );
  }

  switch (kind as ItemKind) {
    case 'shield':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
          <path
            d="M12 3L4.5 6.2V11.8C4.5 16.4 7.7 20.1 12 21.5C16.3 20.1 19.5 16.4 19.5 11.8V6.2L12 3Z"
            fill="currentColor"
            fillOpacity="0.18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path d="M12 7.2V16.8M8.5 11.5H15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'rapid_fire':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
          <path d="M4 7.5H15L19.5 7.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M6 12H18L21 12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M4 16.5H15L19.5 16.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="19.5" cy="7.5" r="1.5" fill="currentColor" />
          <circle cx="21" cy="12" r="1.5" fill="currentColor" />
          <circle cx="19.5" cy="16.5" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'shotgun':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
          <circle cx="5.5" cy="12" r="2.2" fill="currentColor" />
          <path d="M7.5 11L18.5 5.5M7.5 12H19.5M7.5 13L18.5 18.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="19" cy="5.5" r="1.7" fill="currentColor" />
          <circle cx="20" cy="12" r="1.7" fill="currentColor" />
          <circle cx="19" cy="18.5" r="1.7" fill="currentColor" />
        </svg>
      );
    case 'laser':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
          <path
            d="M3.5 18.5L11 11L14.5 14.5L20.5 5.5"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="20.5" cy="5.5" r="2" fill="currentColor" />
        </svg>
      );
    case 'homing':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="2.5" fill="currentColor" />
          <path d="M12 2.5V6M12 18V21.5M2.5 12H6M18 12H21.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'frag':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity="0.24" stroke="currentColor" strokeWidth="2" />
          <path
            d="M12 3.2V6.2M12 17.8V20.8M3.2 12H6.2M17.8 12H20.8M5.8 5.8L7.9 7.9M16.1 16.1L18.2 18.2M18.2 5.8L16.1 7.9M7.9 16.1L5.8 18.2"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'mine':
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="6" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="2" />
          <circle cx="12" cy="12" r="2.3" fill="currentColor" />
          <path d="M12 3.5V5.8M12 18.2V20.5M3.5 12H5.8M18.2 12H20.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    default:
      return null;
  }
}
