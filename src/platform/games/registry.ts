import type { GameDefinition } from './contracts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyGameDefinition = GameDefinition<any, any>;

class GameRegistry {
  private readonly games = new Map<string, AnyGameDefinition>();

  register(def: AnyGameDefinition): void {
    this.games.set(def.id, def);
  }

  get(gameId: string): AnyGameDefinition | undefined {
    return this.games.get(gameId);
  }

  list(): AnyGameDefinition[] {
    return Array.from(this.games.values());
  }
}

export const gameRegistry = new GameRegistry();
