import { perimeterWalls, type ArenaDef } from './types.ts';

// Placeholder: walls and spawns only. The full map follows the approved blueprint
// (cs_mansion layout, red spawn in the house rooms, crawl hole by the guard hut).
export const MANSION: ArenaDef = {
  id: 'mansion',
  title: 'Особняк',
  bounds: { minX: -32, maxX: 32, minZ: -24, maxZ: 24 },
  groundColor: '#7f8a5a',
  boxes: perimeterWalls({ minX: -32, maxX: 32, minZ: -24, maxZ: 24 }, 4, 0.6, '#b8ad96'),
  spawns: {
    red: [{ x: -20, z: 0 }],
    blue: [{ x: 28, z: 0 }],
  },
};
