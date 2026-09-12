import { BAZAAR } from './bazaar.ts';
import { HUB } from './hub.ts';
import { MANSION } from './mansion.ts';
import { MOUNTAIN } from './mountain.ts';
import { MAP_CATALOG, type MapId } from './catalog.ts';
import { buildArena, type GameMap } from './types.ts';

export * from './catalog.ts';

const MAPS: Record<MapId, GameMap> = {
  hub: HUB,
  mansion: buildArena(MANSION),
  bazaar: buildArena(BAZAAR),
  mountain: buildArena(MOUNTAIN),
};

/** The room's map; unknown or missing ids fall back to the hub. */
export const getMap = (id?: string): GameMap => MAPS[id as MapId] ?? HUB;
export const MAP_LIST = MAP_CATALOG;
