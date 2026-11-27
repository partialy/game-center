import { STICKMAN_ITEM_SPRITE_URLS } from '../render/stickmanSprites';
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

export function StickmanItemIcon({
  kind,
  className = 'w-9 h-9',
}: {
  kind: StickPickupKind;
  className?: string;
}) {
  return (
    <img
      src={STICKMAN_ITEM_SPRITE_URLS[kind]}
      alt=""
      draggable={false}
      className={`object-contain ${kind === 'sword' ? '-rotate-45 ' : ''}${className}`}
    />
  );
}
