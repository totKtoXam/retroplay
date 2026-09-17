import type * as T from 'three';
import type { ArenaDef, GameMap } from '@/lib/maps/types';
import { createArenaScene } from './world-arena-scene';
import { createWorldScene, STATIONS } from './world-scene';

/** What the engine (world.tsx) needs from a map's scene. Only the hub has board stations. */
export type WorldKit = ReturnType<typeof createWorldScene> & {
  stations: number[][];
  /** Каждый кадр — откуда смотрит камера: карта может подстроить под неё свет. */
  view?: (eye: T.Vector3, dt: number) => void;
};

export type MapSceneOptions = {
  /** Сколько ламп карты светят настоящим светом одновременно (components/world-lamp-lights.ts). */
  lampLights?: number;
};

export function createMapScene(map: GameMap, renderer?: T.WebGLRenderer, options: MapSceneOptions = {}): WorldKit {
  if (map.arena) return createArenaScene(map as GameMap & { arena: ArenaDef }, options);
  return { ...createWorldScene(renderer), stations: STATIONS };
}
