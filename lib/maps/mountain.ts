import {
  perimeterWalls,
  type ArenaDef,
  type Bounds,
  type MapBox,
  type MapCylinder,
  type MapLight,
  type MapSphere,
  type SpawnPoint,
} from './types.ts';

/**
 * "Горный лагерь" — a snowy mountain camp.
 *
 *   z −23 ┌──────────── RED CAMP (log cabins, tents, firepit) ────────────┐
 *         │  ЛЕДЯНАЯ ПЕЩЕРА                                СОСНОВЫЙ ЛЕС  │
 *   z   0 │  (roofed rock       [ ПЛАТО y = 2.4 + вышка ]   (pines,       │
 *         │   corridor,          ramp N at z −10..−6        rocks,        │
 *         │   x −23.5..−15)      ramp S at z 10..6          logs)        │
 *   z  23 └──────────── BLUE CAMP (mirrored) ─────────────────────────────┘
 *         x −28                        x 0                          x 28
 *
 * Three north–south routes: the ice cave (west, enclosed), the open lanes either
 * side of the central plateau, and the pine forest (east). The plateau overlooks
 * everything but can only be entered over its two ramps — its sides are a solid
 * 2.4 m rock face (the engine steps up at most 0.55 m).
 */

const BOUNDS: Bounds = { minX: -28, maxX: 28, minZ: -24, maxZ: 24 };

const SNOW = '#e8eff5';
const SNOW_DRIFT = '#f6fafd';
const CLIFF = '#79848f';
const ROCK = '#6d7883';
const ROCK_DARK = '#5b6572';
const RAMP_STONE = '#8b939c';
const WOOD = '#7c5838';
const WOOD_DARK = '#5f4128';
const LOG = '#8c6544';
const ROOF = '#46505e';
const CANVAS_RED = '#8e403a';
const CANVAS_BLUE = '#3a5c8e';
const PINE_TRUNK = '#4a3526';
const PINE_1 = '#1f4a30';
const PINE_2 = '#245638';
const PINE_3 = '#2c6642';
const ICE = '#a8dcee';

// ---------------------------------------------------------------- camps ----

/** One team camp; `s` is −1 for the northern (red) camp, +1 for the southern (blue) one. */
const campBoxes = (s: 1 | -1, canvas: string): MapBox[] => [
  // Two log cabins flanking the camp.
  { x: -14, y: 1.6, z: s * 19, w: 6.5, h: 3.2, d: 5, color: WOOD, solid: true },
  { x: -14, y: 3.45, z: s * 19, w: 7.5, h: 0.5, d: 6, color: ROOF, solid: true },
  { x: 14, y: 1.6, z: s * 19, w: 6.5, h: 3.2, d: 5, color: WOOD, solid: true },
  { x: 14, y: 3.45, z: s * 19, w: 7.5, h: 0.5, d: 6, color: ROOF, solid: true },
  // Tents around the firepit.
  { x: -6.5, y: 0.9, z: s * 21.2, w: 3.4, h: 1.8, d: 3, color: canvas, solid: true },
  { x: 6.5, y: 0.9, z: s * 21.2, w: 3.4, h: 1.8, d: 3, color: canvas, solid: true },
  { x: 0, y: 0.9, z: s * 22.2, w: 3.4, h: 1.8, d: 1.8, color: canvas, solid: true },
  // Crates, a fallen log and boulders covering the way out of the camp.
  { x: -3, y: 0.6, z: s * 17, w: 2.4, h: 1.2, d: 1.2, color: WOOD_DARK, solid: true },
  { x: 3, y: 0.6, z: s * 17, w: 2.4, h: 1.2, d: 1.2, color: WOOD_DARK, solid: true },
  { x: 0, y: 0.45, z: s * 15, w: 4, h: 0.9, d: 1, color: LOG, solid: true },
  { x: -9.5, y: 0.6, z: s * 16, w: 1.4, h: 1.2, d: 3, color: ROCK, solid: true },
  { x: 9.5, y: 0.6, z: s * 16, w: 1.4, h: 1.2, d: 3, color: ROCK, solid: true },
  // Trodden snow around the firepit (decoration only).
  { x: 0, y: 0.14, z: s * 19.8, w: 12, h: 0.28, d: 5, color: SNOW_DRIFT },
];

const SPAWN_XZ: [number, number][] = [
  [-9.5, 19.5],
  [-9.5, 22],
  [-6, 18],
  [-3, 20.5],
  [0, 18.5],
  [3, 20.5],
  [6, 18],
  [9.5, 19.5],
  [9.5, 22],
];

/** Nine spawn points per camp; red looks south (yaw π), blue north (yaw 0). */
const campSpawns = (s: 1 | -1): SpawnPoint[] =>
  SPAWN_XZ.map(([x, z]) => ({ x, z: s * z, yaw: s < 0 ? Math.PI : 0 }));

// ------------------------------------------------------- ice cave (west) ----

/**
 * The west flank is one rock mass (x −28..−15, z −15..15) with a 2.5 m wide
 * corridor carved out of it. Corridor cells, in z order:
 *   A x[−23.5,−21] z[−15,−8]    north entrance, running south
 *   B x[−23.5,−18] z[−10.5,−8]  jog east
 *   C x[−20.5,−18] z[−10.5,2]   long middle leg
 *   D x[−20.5,−15] z[−0.5,2]    east entrance onto the open slope
 *   E x[−23.5,−18] z[0,4.5]     junction chamber
 *   F x[−23.5,−21] z[2,15]      south leg to the south entrance
 * The rock below is the complement of those cells, band by band.
 */
const CAVE_WALL_H = 3;
const CAVE_ROOF_Y = 3.2;

/** [zMin, zMax, ...[xMin, xMax] of rock] per band. */
const CAVE_ROCK: [number, number, [number, number][]][] = [
  [-15, -10.5, [[-28, -23.5], [-21, -15]]],
  [-10.5, -8, [[-28, -23.5], [-18, -15]]],
  [-8, -0.5, [[-28, -20.5], [-18, -15]]],
  [-0.5, 0, [[-28, -20.5]]],
  [0, 2, [[-28, -23.5]]],
  [2, 4.5, [[-28, -23.5], [-18, -15]]],
  [4.5, 15, [[-28, -23.5], [-21, -15]]],
];

/** Corridor cells, roofed over at 3 m so the passage stays covered. */
const CAVE_CORRIDORS: [number, number, number, number][] = [
  [-23.5, -21, -15, -8],
  [-23.5, -18, -10.5, -8],
  [-20.5, -18, -10.5, 2],
  [-20.5, -15, -0.5, 2],
  [-23.5, -18, 0, 4.5],
  [-23.5, -21, 2, 15],
];

const slab = (
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  h: number,
  color: string,
): MapBox => ({
  x: (x0 + x1) / 2,
  y,
  z: (z0 + z1) / 2,
  w: x1 - x0,
  h,
  d: z1 - z0,
  color,
  solid: true,
});

const caveBoxes: MapBox[] = [
  ...CAVE_ROCK.flatMap(([z0, z1, spans]) =>
    spans.map(([x0, x1]) => slab(x0, x1, z0, z1, CAVE_WALL_H / 2, CAVE_WALL_H, ROCK)),
  ),
  ...CAVE_CORRIDORS.map(([x0, x1, z0, z1]) =>
    slab(x0, x1, z0, z1, CAVE_ROOF_Y, 0.4, ROCK_DARK),
  ),
];

/** Icicles hanging from the cave roof — decoration, they block nothing. */
const ICICLE_XZ: [number, number][] = [
  [-22.6, -13],
  [-21.6, -11.5],
  [-23, -9.5],
  [-19.9, -7],
  [-18.6, -3],
  [-20, 1],
  [-16.5, 0.8],
  [-22.9, 3.5],
  [-21.7, 7],
  [-22.9, 10],
];

// ---------------------------------------------------- pine forest (east) ----

const TREE_XZ: [number, number][] = [
  [15.5, -13],
  [19, -12],
  [22.5, -13.5],
  [16.5, -9],
  [21, -8.5],
  [23.5, -6],
  [14.8, -5],
  [18, -4.5],
  [21.5, -2.5],
  [15.5, -0.5],
  [23, 1],
  [17, 2.5],
  [20, 5],
  [15, 8.5],
  [22, 8.5],
  [18.5, 11],
  [16, 13],
  [21.5, 13],
];

/** Solid trunk plus three decorative crowns, all above head height. */
const pine = ([x, z]: [number, number]): MapCylinder[] => [
  { x, y: 2.25, z, r: 0.3, h: 4.5, color: PINE_TRUNK, solid: true, sides: 8 },
  { x, y: 3.2, z, r: 1.6, h: 1.6, color: PINE_1, sides: 8 },
  { x, y: 4.4, z, r: 1.1, h: 1.6, color: PINE_2, sides: 8 },
  { x, y: 5.4, z, r: 0.6, h: 1.4, color: PINE_3, sides: 8 },
];

// ----------------------------------------------------------------- boxes ----

const boxes: MapBox[] = [
  ...perimeterWalls(BOUNDS, 5, 0.8, CLIFF),

  // --- Central plateau: a 2.4 m rock block, climbable only over the ramps. ---
  { x: 0, y: 1.2, z: 0, w: 16, h: 2.4, d: 12, color: CLIFF, solid: true },
  // Parapets round the top, with gaps at both ramp mouths (x −2..2).
  { x: -5, y: 2.9, z: -5.7, w: 6, h: 1, d: 0.6, color: ROCK_DARK, solid: true },
  { x: 5, y: 2.9, z: -5.7, w: 6, h: 1, d: 0.6, color: ROCK_DARK, solid: true },
  { x: -5, y: 2.9, z: 5.7, w: 6, h: 1, d: 0.6, color: ROCK_DARK, solid: true },
  { x: 5, y: 2.9, z: 5.7, w: 6, h: 1, d: 0.6, color: ROCK_DARK, solid: true },
  { x: -7.7, y: 2.9, z: -3.5, w: 0.6, h: 1, d: 4, color: ROCK_DARK, solid: true },
  { x: -7.7, y: 2.9, z: 3.5, w: 0.6, h: 1, d: 4, color: ROCK_DARK, solid: true },
  { x: 7.7, y: 2.9, z: -3.5, w: 0.6, h: 1, d: 4, color: ROCK_DARK, solid: true },
  { x: 7.7, y: 2.9, z: 3.5, w: 0.6, h: 1, d: 4, color: ROCK_DARK, solid: true },
  // Lookout post: a wooden roof on four posts (underside 4.4 m, well over a
  // standing head at 2.4 + 1.8) and supply crates for cover.
  { x: 5, y: 4.6, z: -0.4, w: 4.4, h: 0.4, d: 4.4, color: WOOD_DARK, solid: true },
  { x: -4.5, y: 2.9, z: -2, w: 1.4, h: 1, d: 3, color: WOOD_DARK, solid: true },
  { x: -4.5, y: 2.75, z: 2.5, w: 1.4, h: 0.7, d: 2, color: WOOD_DARK, solid: true },
  { x: 5, y: 2.9, z: 4.2, w: 3, h: 1, d: 0.8, color: WOOD_DARK, solid: true },

  ...caveBoxes,

  // --- Cover in the pine forest. ---
  { x: 17.5, y: 0.4, z: -7.5, w: 5, h: 0.8, d: 0.8, color: LOG, solid: true },
  { x: 22.5, y: 0.4, z: -4.5, w: 3.4, h: 0.8, d: 0.8, color: LOG, solid: true },
  { x: 21, y: 0.4, z: 3.5, w: 0.8, h: 0.8, d: 5, color: LOG, solid: true },
  { x: 22.5, y: 0.65, z: -10.5, w: 2.4, h: 1.3, d: 2.4, color: ROCK, solid: true },
  { x: 19.5, y: 0.7, z: -0.5, w: 2.6, h: 1.4, d: 2.2, color: ROCK, solid: true },
  { x: 16, y: 0.6, z: 5.5, w: 2.2, h: 1.2, d: 2.6, color: ROCK, solid: true },
  { x: 19, y: 0.6, z: 9.5, w: 2.8, h: 1.2, d: 2, color: ROCK, solid: true },

  // --- Boulders on the open slopes. ---
  { x: -11.5, y: 0.7, z: -11, w: 2.4, h: 1.4, d: 2, color: ROCK, solid: true },
  { x: -12.5, y: 0.6, z: 3, w: 2, h: 1.2, d: 2.6, color: ROCK, solid: true },
  { x: -10, y: 0.45, z: 11, w: 3.6, h: 0.9, d: 1, color: LOG, solid: true },
  { x: 11, y: 0.7, z: -9, w: 2.2, h: 1.4, d: 2.2, color: ROCK, solid: true },
  { x: 11.5, y: 0.6, z: 8, w: 2.6, h: 1.2, d: 2, color: ROCK, solid: true },
  { x: -4, y: 0.6, z: -12, w: 2.6, h: 1.2, d: 1.6, color: ROCK, solid: true },
  { x: 5, y: 0.5, z: -13, w: 3, h: 1, d: 1.4, color: ROCK, solid: true },
  { x: 4, y: 0.6, z: 12, w: 2.6, h: 1.2, d: 1.6, color: ROCK, solid: true },
  { x: -5, y: 0.5, z: 13, w: 3, h: 1, d: 1.4, color: ROCK, solid: true },

  // --- Snow drifts: pure decoration, nothing collides with them. ---
  { x: -10, y: 0.15, z: -8, w: 8, h: 0.3, d: 3, color: SNOW_DRIFT },
  { x: 10.5, y: 0.15, z: -3, w: 5, h: 0.3, d: 6, color: SNOW_DRIFT },
  { x: -11, y: 0.15, z: 8, w: 6, h: 0.3, d: 3.5, color: SNOW_DRIFT },
  { x: 9.5, y: 0.15, z: 13, w: 7, h: 0.3, d: 3, color: SNOW_DRIFT },
  { x: 0, y: 0.15, z: -12.5, w: 5, h: 0.3, d: 2.5, color: SNOW_DRIFT },
  { x: 0, y: 0.15, z: 12.5, w: 5, h: 0.3, d: 2.5, color: SNOW_DRIFT },
  { x: 25, y: 0.15, z: -18, w: 4, h: 0.3, d: 6, color: SNOW_DRIFT },
  { x: -25, y: 0.15, z: 18, w: 4, h: 0.3, d: 6, color: SNOW_DRIFT },

  ...campBoxes(-1, CANVAS_RED),
  ...campBoxes(1, CANVAS_BLUE),
];

const cylinders: MapCylinder[] = [
  ...TREE_XZ.flatMap(pine),
  // Firepits in both camps.
  { x: 0, y: 0.2, z: -20, r: 0.95, h: 0.4, color: ROCK_DARK, sides: 10 },
  { x: 0, y: 0.2, z: 20, r: 0.95, h: 0.4, color: ROCK_DARK, sides: 10 },
  // Icicles under the cave roof.
  ...ICICLE_XZ.map(([x, z]): MapCylinder => ({ x, y: 2.55, z, r: 0.12, h: 0.9, color: ICE, sides: 6 })),
  // Lookout post supports.
  { x: 3.2, y: 3.4, z: -2.2, r: 0.16, h: 2, color: WOOD_DARK, solid: true, sides: 6 },
  { x: 6.8, y: 3.4, z: -2.2, r: 0.16, h: 2, color: WOOD_DARK, solid: true, sides: 6 },
  { x: 3.2, y: 3.4, z: 1.4, r: 0.16, h: 2, color: WOOD_DARK, solid: true, sides: 6 },
  { x: 6.8, y: 3.4, z: 1.4, r: 0.16, h: 2, color: WOOD_DARK, solid: true, sides: 6 },
];

const spheres: MapSphere[] = [
  // Snow caps on the bigger boulders.
  { x: -11.5, y: 1.5, z: -11, r: 0.9, color: SNOW_DRIFT },
  { x: 11, y: 1.5, z: -9, r: 0.9, color: SNOW_DRIFT },
  { x: 19.5, y: 1.5, z: -0.5, r: 0.9, color: SNOW_DRIFT },
  { x: -12.5, y: 1.3, z: 3, r: 0.8, color: SNOW_DRIFT },
  { x: 11.5, y: 1.3, z: 8, r: 0.8, color: SNOW_DRIFT },
  { x: 22.5, y: 1.4, z: -10.5, r: 0.85, color: SNOW_DRIFT },
  { x: 16, y: 1.3, z: 5.5, r: 0.8, color: SNOW_DRIFT },
  { x: 19, y: 1.3, z: 9.5, r: 0.8, color: SNOW_DRIFT },
  // Ice blocks at the cave mouths.
  { x: -21.8, y: 0.5, z: -15.4, r: 0.7, color: ICE },
  { x: -22.8, y: 0.5, z: 15.4, r: 0.7, color: ICE },
  { x: -14.6, y: 0.5, z: 2.4, r: 0.6, color: ICE },
];

const lights: MapLight[] = [
  { x: 0, y: 1.5, z: -20, color: '#ffa95e', intensity: 9, distance: 16 },
  { x: 0, y: 1.5, z: 20, color: '#ffa95e', intensity: 9, distance: 16 },
  { x: -14, y: 2.7, z: -16.2, color: '#ffd9a0', intensity: 4, distance: 9 },
  { x: 14, y: 2.7, z: -16.2, color: '#ffd9a0', intensity: 4, distance: 9 },
  { x: -14, y: 2.7, z: 16.2, color: '#ffd9a0', intensity: 4, distance: 9 },
  { x: 14, y: 2.7, z: 16.2, color: '#ffd9a0', intensity: 4, distance: 9 },
  { x: 5, y: 4.1, z: -0.4, color: '#ffd9a0', intensity: 5, distance: 12 },
  // Dim blue glow inside the ice cave.
  { x: -22.25, y: 2.3, z: -12, color: '#5fa6dc', intensity: 3.5, distance: 11 },
  { x: -22.25, y: 2.3, z: -9, color: '#5fa6dc', intensity: 3.5, distance: 11 },
  { x: -19.25, y: 2.3, z: -5, color: '#5fa6dc', intensity: 3.5, distance: 11 },
  { x: -19.25, y: 2.3, z: 0.5, color: '#5fa6dc', intensity: 3.5, distance: 11 },
  { x: -17.5, y: 2.3, z: 0.8, color: '#5fa6dc', intensity: 3, distance: 9 },
  { x: -22.25, y: 2.3, z: 6, color: '#5fa6dc', intensity: 3.5, distance: 11 },
  { x: -22.25, y: 2.3, z: 11, color: '#5fa6dc', intensity: 3.5, distance: 11 },
];

export const MOUNTAIN: ArenaDef = {
  id: 'mountain',
  title: 'Горный лагерь',
  bounds: BOUNDS,
  groundColor: SNOW,
  outsideColor: '#c4d2de',
  boxes,
  ramps: [
    // The only two ways onto the plateau.
    { minX: -2, maxX: 2, minZ: -10, maxZ: -6, axis: 'z', from: -10, to: -6, y0: 0, y1: 2.4, color: RAMP_STONE },
    { minX: -2, maxX: 2, minZ: 6, maxZ: 10, axis: 'z', from: 10, to: 6, y0: 0, y1: 2.4, color: RAMP_STONE },
  ],
  cylinders,
  spheres,
  water: [{ minX: -14, maxX: -9.5, minZ: 5, maxZ: 10, y: 0.06, color: '#8fc4dc' }],
  lights,
  spawns: { red: campSpawns(-1), blue: campSpawns(1) },
};
