import { ALL_3D_COLLIDERS, getCeilingHeight, getGroundHeight } from '../world-collision.ts';
import type { GameMap } from './types.ts';

/** The meeting hub: hand-built scene (components/world-scene.ts) and collision. */
export const HUB: GameMap = {
  id: 'hub',
  title: 'Хаб',
  bounds: { minX: -36, maxX: 36, minZ: -36, maxZ: 36 },
  colliders: ALL_3D_COLLIDERS,
  groundHeight: getGroundHeight,
  ceilingHeight: getCeilingHeight,
  // The hub is a meeting place, not a battle map: everyone keeps the single plaza spawn.
  spawns: { red: [{ x: 0, z: 4 }], blue: [{ x: 0, z: 4 }] },
};
