import { stickmanDuelGame } from '../games/stickman-duel';
import { tankBattleGame } from '../games/tank-battle';
import { gameRegistry } from '../platform/games/registry';

let initialized = false;

/**
 * 集中登记平台所有可玩游戏。
 * 未来接入新游戏时，只需在此登记一次即可在大厅与设置中生效。
 */
export function registerAllGames(): void {
  if (initialized) return;
  initialized = true;
  gameRegistry.register(tankBattleGame);
  gameRegistry.register(stickmanDuelGame);
}
