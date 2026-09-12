import type * as T from 'three';
import type { ArenaDef, GameMap } from '@/lib/maps/types';
import { createArenaScene } from './world-arena-scene';
import { createWorldScene, STATIONS } from './world-scene';

/** What the engine (world.tsx) needs from a map's scene. Only the hub has board stations. */
export type WorldKit = ReturnType<typeof createWorldScene> & { stations: number[][] };

export function createMapScene(map: GameMap, renderer?: T.WebGLRenderer): WorldKit {
  if (map.arena) return createArenaScene(map as GameMap & { arena: ArenaDef });
  return { ...createWorldScene(renderer), stations: STATIONS };
}
