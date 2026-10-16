import { BAZAAR } from './bazaar.ts';
import { HUB } from './hub.ts';
import { MANSION } from './mansion.ts';
import { MOUNTAIN } from './mountain.ts';
import { buildOutbreak } from './outbreak.ts';
import { SHIP } from './ship.ts';
import { VALLEY } from './valley.ts';
import { MAP_CATALOG, type MapId } from './catalog.ts';
import { buildArena, type GameMap } from './types.ts';

export * from './catalog.ts';

/**
 * Карты собираются при первом обращении: «Зона заражения» генерирует рельеф и тысячи
 * моделей, и незачем делать это в каждой комнате ретро или боя на другой карте.
 */
const BUILDERS: Record<MapId, () => GameMap> = {
  hub: () => HUB,
  mansion: () => buildArena(MANSION),
  bazaar: () => buildArena(BAZAAR),
  mountain: () => buildArena(MOUNTAIN),
  valley: () => buildArena(VALLEY),
  outbreak: () => buildArena(buildOutbreak()),
  ship: () => buildArena(SHIP),
};
const built = new Map<MapId, GameMap>();

/** The room's map; unknown or missing ids fall back to the hub. */
export const getMap = (id?: string): GameMap => {
  const key: MapId = id && id in BUILDERS ? (id as MapId) : 'hub';
  let map = built.get(key);
  if (!map) {
    map = BUILDERS[key]();
    built.set(key, map);
  }
  return map;
};
export const MAP_LIST = MAP_CATALOG;
