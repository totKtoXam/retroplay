import { BAZAAR } from './bazaar.ts';
import { HUB } from './hub.ts';
import { MANSION } from './mansion.ts';
import { MOUNTAIN } from './mountain.ts';
import { buildArena, type GameMap } from './types.ts';

export const MAP_IDS = ['hub', 'mansion', 'bazaar', 'mountain'] as const;
export type MapId = (typeof MAP_IDS)[number];

const MAPS: Record<MapId, GameMap> = {
  hub: HUB,
  mansion: buildArena(MANSION),
  bazaar: buildArena(BAZAAR),
  mountain: buildArena(MOUNTAIN),
};

/** The room's map; unknown or missing ids fall back to the hub. */
export const getMap = (id?: string): GameMap => MAPS[id as MapId] ?? HUB;
export const MAP_LIST = MAP_IDS.map((id) => ({ id, title: MAPS[id].title }));
