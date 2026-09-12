import { perimeterWalls, type ArenaDef } from './types.ts';

// Placeholder: walls and spawns only. The full map follows the blueprint
// (central plateau with two ramps, ice cave west, pine forest east).
export const MOUNTAIN: ArenaDef = {
  id: 'mountain',
  title: 'Горный лагерь',
  bounds: { minX: -28, maxX: 28, minZ: -24, maxZ: 24 },
  groundColor: '#dfe6ec',
  boxes: perimeterWalls({ minX: -28, maxX: 28, minZ: -24, maxZ: 24 }, 5, 0.8, '#8d96a3'),
  spawns: {
    red: [{ x: 0, z: -20 }],
    blue: [{ x: 0, z: 20 }],
  },
};
