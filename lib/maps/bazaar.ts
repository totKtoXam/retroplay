import { perimeterWalls, type ArenaDef } from './types.ts';

// Placeholder: walls and spawns only. The full map follows the blueprint
// (market rows north, covered market centre, river and bridge south).
export const BAZAAR: ArenaDef = {
  id: 'bazaar',
  title: 'Базар',
  bounds: { minX: -30, maxX: 30, minZ: -20, maxZ: 20 },
  groundColor: '#c9b48a',
  boxes: perimeterWalls({ minX: -30, maxX: 30, minZ: -20, maxZ: 20 }, 4, 0.6, '#b89f76'),
  spawns: {
    red: [{ x: -26, z: 0 }],
    blue: [{ x: 26, z: 0 }],
  },
};
