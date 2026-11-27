import swordUrl from '../../../assets/stickman-duel/sword.png';
import pistolUrl from '../../../assets/stickman-duel/pistol.png';
import shotgunUrl from '../../../assets/stickman-duel/shotgun.png';
import rocketLauncherUrl from '../../../assets/stickman-duel/rocket-launcher.png';
import grenadeUrl from '../../../assets/stickman-duel/grenade.png';
import medkitUrl from '../../../assets/stickman-duel/medkit.png';
import grenadeFlightUrl from '../../../assets/stickman-duel/grenade-flight.png';
import rocketProjectileUrl from '../../../assets/stickman-duel/rocket-projectile.png';
import type { StickPickupKind, StickWeaponKind } from '../types';

export const STICKMAN_ITEM_SPRITE_URLS: Record<StickPickupKind, string> = {
  sword: swordUrl,
  pistol: pistolUrl,
  shotgun: shotgunUrl,
  rocket: rocketLauncherUrl,
  grenade: grenadeUrl,
  medkit: medkitUrl,
};

const SPRITE_URLS = {
  ...STICKMAN_ITEM_SPRITE_URLS,
  grenadeFlight: grenadeFlightUrl,
  rocketProjectile: rocketProjectileUrl,
};

const images = new Map<string, HTMLImageElement>();

// 原点是角色的持武手，位置与尺寸均使用战场坐标。
export const HELD_SPRITE_BOXES: Record<StickWeaponKind, readonly [number, number, number, number]> = {
  sword: [18.5, 0, 51, 14],
  pistol: [5.5, 2, 18, 14],
  shotgun: [6, 0.8, 36, 13],
  rocket: [3.5, -0.5, 45, 14],
  grenade: [3, -0.5, 14, 16],
};

export function preloadStickmanSprites(): void {
  if (typeof Image === 'undefined' || images.size > 0) return;

  for (const url of Object.values(SPRITE_URLS)) {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    images.set(url, image);
  }
}

export function drawStickmanSprite(
  ctx: CanvasRenderingContext2D,
  kind: keyof typeof SPRITE_URLS,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number
): boolean {
  const image = images.get(SPRITE_URLS[kind]);
  if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return false;

  const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  ctx.drawImage(image, x - width / 2, y - height / 2, width, height);
  return true;
}
