import itemFragUrl from '../../../assets/tank-battle/item_frag.webp';
import itemHomingUrl from '../../../assets/tank-battle/item_homing.webp';
import itemLaserUrl from '../../../assets/tank-battle/item_laser.webp';
import itemMineUrl from '../../../assets/tank-battle/item_mine.webp';
import itemRapidFireUrl from '../../../assets/tank-battle/item_rapid_fire.webp';
import itemShieldUrl from '../../../assets/tank-battle/item_shield.webp';
import itemShotgunUrl from '../../../assets/tank-battle/item_shotgun.webp';
import mineArmedUrl from '../../../assets/tank-battle/mine_armed.webp';
import mineUnarmedUrl from '../../../assets/tank-battle/mine_unarmed.webp';
import tankHullBaseUrl from '../../../assets/tank-battle/tank_hull_base.webp';
import tankTurretBaseUrl from '../../../assets/tank-battle/tank_turret_base.webp';
import type { ItemKind } from '../types';

export const ITEM_SPRITE_URLS: Record<ItemKind, string> = {
  shield: itemShieldUrl,
  rapid_fire: itemRapidFireUrl,
  shotgun: itemShotgunUrl,
  laser: itemLaserUrl,
  homing: itemHomingUrl,
  frag: itemFragUrl,
  mine: itemMineUrl,
};

type TankPartKey = 'hull' | 'turret';

const TANK_PART_URLS: Record<TankPartKey, string> = {
  hull: tankHullBaseUrl,
  turret: tankTurretBaseUrl,
};

const imageCache = new Map<string, HTMLImageElement>();
const tintedTankCache = new Map<string, HTMLCanvasElement>();

function getLoadedImage(url: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') {
    return null;
  }
  let img = imageCache.get(url);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.src = url;
    imageCache.set(url, img);
  }
  if (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
    return null;
  }
  return img;
}

function parseHexColor(colorHex: string): [number, number, number] {
  const clean = colorHex.trim().replace('#', '');
  if (clean.length === 3) {
    return [
      Number.parseInt(clean[0] + clean[0], 16) || 255,
      Number.parseInt(clean[1] + clean[1], 16) || 255,
      Number.parseInt(clean[2] + clean[2], 16) || 255,
    ];
  }
  if (clean.length === 6) {
    return [
      Number.parseInt(clean.slice(0, 2), 16) || 0,
      Number.parseInt(clean.slice(2, 4), 16) || 0,
      Number.parseInt(clean.slice(4, 6), 16) || 0,
    ];
  }
  return [224, 75, 50];
}

/**
 * 为白灰中性坦克底图按玩家颜色生成离线染色贴图并缓存：
 * - 保留深炭灰履带、炮管主体及 #1C2127 卡通黑边不被污染
 * - 仅对亮灰中性装甲区域施加明暗调制与高光保留
 */
function buildTintedTankCanvas(img: HTMLImageElement, colorHex: string): HTMLCanvasElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }

  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const normalizedHex = colorHex.trim().toUpperCase();
  const isWhiteFlash = normalizedHex === '#FFFFFF' || normalizedHex === '#FFF';
  const [tr, tg, tb] = parseHexColor(normalizedHex);

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    if (isWhiteFlash) {
      const flashFactor = r + g + b > 180 ? 0.82 : 0.45;
      data[i] = Math.round(r + (255 - r) * flashFactor);
      data[i + 1] = Math.round(g + (255 - g) * flashFactor);
      data[i + 2] = Math.round(b + (255 - b) * flashFactor);
      continue;
    }

    const maxCh = Math.max(r, g, b);
    const minCh = Math.min(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;

    if (lum < 102 || maxCh - minCh > 30) {
      continue;
    }

    const blend = Math.min(1, (lum - 102) / 36);
    const shade = Math.min(1.06, lum / 225);
    let tintedR = tr * shade;
    let tintedG = tg * shade;
    let tintedB = tb * shade;

    if (lum > 236) {
      const highlight = ((lum - 236) / 19) * 0.42;
      tintedR += (255 - tintedR) * highlight;
      tintedG += (255 - tintedG) * highlight;
      tintedB += (255 - tintedB) * highlight;
    }

    data[i] = Math.min(255, Math.round(r + (tintedR - r) * blend));
    data[i + 1] = Math.min(255, Math.round(g + (tintedG - g) * blend));
    data[i + 2] = Math.min(255, Math.round(b + (tintedB - b) * blend));
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function getTintedTankPart(part: TankPartKey, colorHex: string): CanvasImageSource | null {
  const img = getLoadedImage(TANK_PART_URLS[part]);
  if (!img) {
    return null;
  }
  const cacheKey = `${part}:${colorHex.trim().toUpperCase()}`;
  const cached = tintedTankCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const canvas = buildTintedTankCanvas(img, colorHex);
  if (canvas) {
    tintedTankCache.set(cacheKey, canvas);
    return canvas;
  }
  return img;
}

export function getTankHullSprite(colorHex: string): CanvasImageSource | null {
  return getTintedTankPart('hull', colorHex);
}

export function getTankTurretSprite(colorHex: string): CanvasImageSource | null {
  return getTintedTankPart('turret', colorHex);
}

export function getDroppedItemSprite(kind: ItemKind): CanvasImageSource | null {
  return getLoadedImage(ITEM_SPRITE_URLS[kind]);
}

export function getMineSprite(armed: boolean): CanvasImageSource | null {
  return getLoadedImage(armed ? mineArmedUrl : mineUnarmedUrl);
}
