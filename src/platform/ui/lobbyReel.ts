import type { GameDefinition } from '../games/contracts';

export type LobbyPreviewKind =
  | 'tank-battle'
  | 'stickman-duel'
  | 'orbital-pong'
  | 'gravity-labyrinth';

export interface LobbyGameHighlight {
  label: string;
  value: string;
}

export interface LobbyCatalogEntry {
  id: string;
  title: string;
  englishSubtitle: string;
  statusText: string;
  playable: boolean;
  metaItems: string[];
  description: string;
  highlights: LobbyGameHighlight[];
  controlsSummary: string;
  thumbnailUrl: string;
  fallbackGradient: string;
  accentHex: string;
  previewKind: LobbyPreviewKind;
}

export const REEL_ITEM_HEIGHT_PX = 104;
export const REEL_ITEM_GAP_PX = 20;
export const REEL_ITEM_PITCH_PX = REEL_ITEM_HEIGHT_PX + REEL_ITEM_GAP_PX;

const TANK_THUMB = '/src/assets/images/thumb_tank_battle_1795598368966.jpg';
const STICKMAN_THUMB = '/src/assets/images/thumb_stickman_duel_1795598370156.jpg';
const PONG_THUMB = '/src/assets/images/thumb_orbital_pong_1795598370581.jpg';
const LABYRINTH_THUMB = '/src/assets/images/thumb_gravity_labyrinth_1795598372528.jpg';

const UPCOMING_SHOWCASE_ENTRIES: LobbyCatalogEntry[] = [
  {
    id: 'stickman-duel',
    title: '星渊火柴人决斗',
    englishSubtitle: 'Astral Stickman Duel',
    statusText: '开发中预览',
    playable: false,
    metaItems: ['2 人同屏', '光刃格挡反击', '浮空星岩地形'],
    description:
      '两位星光武者在漂浮黑曜石平台上展开高速近身拼刀。把握冲刺无敌帧与弹反时机，将对手击落星渊或瞬间终结。',
    highlights: [
      { label: '核心机制', value: '光刃连斩、精准弹反与空中二段冲刺' },
      { label: '控制方式', value: '双人同屏键盘移动、跳跃与轻重攻击' },
      { label: '战场演化', value: '随回合坍塌的浮空陨石平台与能量补给' },
    ],
    controlsSummary: '演示动画 · 空中光刃拼杀与陨石浮台机动',
    thumbnailUrl: STICKMAN_THUMB,
    fallbackGradient: 'linear-gradient(135deg, #0E1F45 0%, #1C1338 55%, #3B2314 100%)',
    accentHex: '#38BDF8',
    previewKind: 'stickman-duel',
  },
  {
    id: 'orbital-pong',
    title: '星环轨道弹球',
    englishSubtitle: 'Orbital Comet Rally',
    statusText: '开发中预览',
    playable: false,
    metaItems: ['2 人同屏', '360° 环形球场', '蓄力弧线抽球'],
    description:
      '在星象仪般的深空环形轨道中操控光弧挡板，迎击高速加速的彗星能量球。切线擦球可打出诡异弯曲轨道，压迫对手防线。',
    highlights: [
      { label: '核心机制', value: '环形轨面反弹、彗星充能加速与弧线切削' },
      { label: '控制方式', value: '左右轨道滑移 + 一键脉冲蓄力击球' },
      { label: '节奏特色', value: '单局 90 秒快节奏攻防，连击触发引力井偏移' },
    ],
    controlsSummary: '演示动画 · 环形轨道双弧挡板彗星对拉',
    thumbnailUrl: PONG_THUMB,
    fallbackGradient: 'linear-gradient(135deg, #101A3B 0%, #1A2452 50%, #3E2C12 100%)',
    accentHex: '#F5C469',
    previewKind: 'orbital-pong',
  },
  {
    id: 'gravity-labyrinth',
    title: '引力星环迷阵',
    englishSubtitle: 'Gravity Ring Labyrinth',
    statusText: '开发中预览',
    playable: false,
    metaItems: ['2 人同屏', '动态旋转环道', '信标争夺竞速'],
    description:
      '驾驶星光侦察机穿梭于缓缓错位旋转的同心金属环道。抢先激活中央引力信标并开启脉冲闸门，用地形位移封锁对手路线。',
    highlights: [
      { label: '核心机制', value: '三层同心旋转迷宫、信标充能与电磁闸门切换' },
      { label: '控制方式', value: '全向推进器飞行 + 引力脉冲干扰' },
      { label: '策略深度', value: '实时预判环道缺口对齐时机，博弈捷径与拦截' },
    ],
    controlsSummary: '演示动画 · 同心旋转星环与双机信标竞逐',
    thumbnailUrl: LABYRINTH_THUMB,
    fallbackGradient: 'linear-gradient(135deg, #0A1B2E 0%, #102B42 52%, #2C2111 100%)',
    accentHex: '#22D3EE',
    previewKind: 'gravity-labyrinth',
  },
];

/** 将平台已注册可玩游戏与大厅扩展预览目录组合为录像带轮播清单 */
export function buildLobbyCatalog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  games: GameDefinition<any, any>[]
): LobbyCatalogEntry[] {
  const registeredEntries: LobbyCatalogEntry[] = games.map((game) => {
    if (game.id === 'tank-battle') {
      return {
        id: game.id,
        title: game.name,
        englishSubtitle: 'Tactical Maze Tank Arena',
        statusText: '现已可玩',
        playable: true,
        metaItems: [`${game.minPlayers} 人同屏`, '先得 5 分获胜', '7 种战术道具'],
        description:
          '在全连通随机迷宫中展开双人同屏战术坦克对决。利用墙面弹道反弹、普通弹空中抵消与独立护盾进攻槽，体验直觉 360° 瞄准与经典双模式操控。',
        highlights: [
          { label: '核心玩法', value: '墙体折射弹道、激光穿透、破片霰弹与隐身伏击' },
          { label: '操控模式', value: '直觉八向微调 360° 射击与经典坦克双模式切换' },
          { label: '自定义项', value: '命名规则预设、涂装配色、改键与地图编号复玩' },
        ],
        controlsSummary: '实机演算 · P1 WASD + 空格 · P2 方向键 + Enter',
        thumbnailUrl: TANK_THUMB,
        fallbackGradient: 'linear-gradient(135deg, #1E1B2E 0%, #15233D 55%, #3B181A 100%)',
        accentHex: '#F97316',
        previewKind: 'tank-battle',
      };
    }

    if (game.id === 'stickman-duel') {
      return {
        id: game.id,
        title: game.name,
        englishSubtitle: 'Astral Stickman Duel',
        statusText: '现已可玩',
        playable: true,
        metaItems: ['2–8 席格斗', '可破坏地形', 'ABXY 虚拟手柄'],
        description:
          '在底层基岩、可炸毁堆叠砖块与单向短平台构成的 2D 竞技场中展开硬核火柴人血条对决。左拳/上腿/下跳/右换武器，抢夺长剑、手枪、火箭筒与血包一决高下。',
        highlights: [
          { label: '武器军械', value: '8 耐久长剑、3 发直线手枪、炸地形火箭筒与 25% 血包' },
          { label: '操控方式', value: '键盘双人同屏 + 摇杆/ABXY 虚拟手柄模式，支持 8 向瞄准与二段跳穿台' },
          { label: '对战模式', value: '单人 5 档 AI（含 Boss）、双人同屏与多席乱斗全面支持' },
        ],
        controlsSummary: '实机演算 · P1 WASD+JKL/空格 · 支持 ABXY 虚拟手柄',
        thumbnailUrl: STICKMAN_THUMB,
        fallbackGradient: 'linear-gradient(135deg, #0E1F45 0%, #1C1338 55%, #3B2314 100%)',
        accentHex: '#38BDF8',
        previewKind: 'stickman-duel',
      };
    }

    return {
      id: game.id,
      title: game.name,
      englishSubtitle: 'Local Arena Game',
      statusText: '现已可玩',
      playable: true,
      metaItems: [`${game.minPlayers} 人同屏`, '本地键盘对战'],
      description: game.description,
      highlights: [
        { label: '对战方式', value: '本地同屏键盘竞技' },
        { label: '配置支持', value: '支持规则预设与自定义按键' },
        { label: '即刻开玩', value: '进入赛前配置或一键快速开局' },
      ],
      controlsSummary: '本地双人同屏竞技',
      thumbnailUrl: TANK_THUMB,
      fallbackGradient: 'linear-gradient(135deg, #121B33 0%, #1F2A44 100%)',
      accentHex: '#7DD3FC',
      previewKind: 'tank-battle',
    };
  });

  const existingIds = new Set(registeredEntries.map((item) => item.id));
  const extras = UPCOMING_SHOWCASE_ENTRIES.filter((item) => !existingIds.has(item.id));
  return [...registeredEntries, ...extras];
}

export function clampReelIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.trunc(index)));
}

export function stepReelIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return clampReelIndex(current + delta, count);
}

/**
 * 计算竖排录像带轨道的垂直位移（px）：
 * 轨道起点位于容器垂直中线处，偏移 `-activeIndex * itemPitchPx` 即可让当前项精准落入中央方框。
 */
export function computeReelTrackOffset(
  activeIndex: number,
  itemPitchPx = REEL_ITEM_PITCH_PX
): number {
  return activeIndex === 0 ? 0 : -activeIndex * itemPitchPx;
}

/**
 * 鼠标滚轮 / 触控板累计阈值步进算法：
 * 既能让普通鼠标滚轮一格即切换一项，又能避免触控板惯性微滚动连续跳过多项。
 */
export function computeWheelStep(
  accumulatedDelta: number,
  incomingDeltaY: number,
  threshold = 36
): { step: -1 | 0 | 1; nextAccumulated: number } {
  if (!Number.isFinite(incomingDeltaY) || incomingDeltaY === 0) {
    return { step: 0, nextAccumulated: accumulatedDelta };
  }
  // 反向滚动时重置累计，确保反向切屏响应干脆
  const base =
    accumulatedDelta !== 0 && Math.sign(accumulatedDelta) !== Math.sign(incomingDeltaY)
      ? 0
      : accumulatedDelta;
  const sum = base + incomingDeltaY;
  if (sum >= threshold) {
    return { step: 1, nextAccumulated: 0 };
  }
  if (sum <= -threshold) {
    return { step: -1, nextAccumulated: 0 };
  }
  return { step: 0, nextAccumulated: sum };
}
