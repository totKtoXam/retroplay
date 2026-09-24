import {
  perimeterWalls,
  type ArenaDef,
  type Bounds,
  type MapBox,
  type MapCylinder,
  type MapLight,
  type MapSphere,
  type SpawnPoint,
  type SurfaceMaterial,
} from './types.ts';
import { createFurnisher, FLAME, IRON, LINEN, type Side } from './furnish.ts';

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
 *
 * The camp cabins are real rooms: a door toward the camp centre, windows onto the field and
 * the flank, bunks, a stove and a table inside. Everything else keeps the old footprints —
 * textured, and split into crates or sandbags where one box stood for several things.
 */

const BOUNDS: Bounds = { minX: -28, maxX: 28, minZ: -24, maxZ: 24 };

const SNOW = '#e8eff5';
const SNOW_DRIFT = '#f6fafd'; // drifts, caps and snow lying on things
const CLIFF = '#79848f';
const ROCK = '#6d7883';
const ROCK_DARK = '#5b6572';
const RAMP_STONE = '#8b939c';
const WOOD = '#7c5838';
const WOOD_DARK = '#5f4128';
const LOG = '#8c6544';
const CRATE = '#9a7045';
const SANDBAG = '#9c8a64';
const CANVAS_RED = '#8e403a';
const CANVAS_BLUE = '#3a5c8e';
const PINE_TRUNK = '#4a3526';
const PINE_1 = '#1f4a30';
const PINE_2 = '#245638';
const PINE_3 = '#2c6642';
const ICE = '#a8dcee';
const FROST = '#c4e3ef'; // saturated enough not to count as snow, so it does not melt in summer
const EMBER = '#ff7a2e';
const ASH = '#3b3632';
const FUR = '#6f5f50';
// furnish.ts's LINEN is light and grey enough to be taken for snow and turn green in summer.
const CABIN_LINEN = '#cdc4b0';
const SKI = '#9a4a32';
const COLD_GLASS = '#8fd0f5';
const LAMP = '#ffd9a0';
const COLD_LAMP = '#5fa6dc';

/** Furniture, cabins, tents and small props; merged into the ArenaDef at the bottom. */
const f = createFurnisher();

/** A snow cap: a flattened dome of snow centred on the surface at height `y`. */
const snowCap = (x: number, y: number, z: number, r: number): MapSphere => ({ x, y, z, r, color: SNOW_DRIFT, material: 'snow' });

/** A strip of snow along the top of the round log drawn for bark box `b`. */
function snowOnLog(b: MapBox) {
  const alongX = b.w >= b.d;
  const r = Math.min(b.h, alongX ? b.d : b.w) / 2;
  const top = b.y - b.h / 2 + 2 * r;
  const len = (alongX ? b.w : b.d) - 0.3,
    wide = r * 0.8;
  const [hw, hd] = alongX ? [len / 2, wide / 2] : [wide / 2, len / 2];
  f.deco(b.x - hw, b.x + hw, top - 0.05, top + 0.05, b.z - hd, b.z + hd, SNOW_DRIFT, 'snow');
}

/**
 * A decor cylinder lying along z, centred at (x, y, z) — `decoCyl` stands cylinders on their
 * base. Its `rTop` end points to +z.
 */
const lyingZ = (x: number, y: number, z: number, r: number, len: number, color: string, material: SurfaceMaterial, extra: Partial<MapCylinder> = {}) =>
  f.decorCylinders.push({ x, y, z, r, h: len, color, material, axis: 'z', ...extra });

/** Integer hash → 0…1: scatters icicles the same way on every client. */
const hash = (i: number, j: number) => {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------- camps ----

/** A |z| range mirrored into camp `s`, as [min, max]. */
const zspan = (s: 1 | -1, a: number, b: number): [number, number] => (s > 0 ? [a, b] : [-b, -a]);

const CABIN_W = 6.5; // along x
const CABIN_D = 5; // along z
const CABIN_H = 3;

/**
 * A log cabin at (cx, s·19), laid out in its own frame so all four come out alike: `u` runs
 * from the door wall (facing the camp centre) to the outer flank, `v` from the field wall
 * (facing z = 0) to the back wall under the cliff.
 *
 * Solid furniture either touches a wall or stands ≥ 1.3 m from the next solid; the bunks,
 * bench and stumps are low enough to step onto. The door leaf swings inside against the door
 * wall, so that wall stays bare.
 */
function cabin(cx: number, s: 1 | -1) {
  const ex = cx > 0 ? 1 : -1;
  const cz = s * 19;
  const X = (u: number) => cx + ex * (u - CABIN_W / 2);
  const Z = (v: number) => cz + s * (v - CABIN_D / 2);
  const rect = (u0: number, u1: number, v0: number, v1: number): [number, number, number, number] => [
    Math.min(X(u0), X(u1)),
    Math.max(X(u0), X(u1)),
    Math.min(Z(v0), Z(v1)),
    Math.max(Z(v0), Z(v1)),
  ];
  const deco = (u0: number, u1: number, y0: number, y1: number, v0: number, v1: number, color: string, material?: SurfaceMaterial, glow?: number) => {
    const [x0, x1, z0, z1] = rect(u0, u1, v0, v1);
    f.deco(x0, x1, y0, y1, z0, z1, color, material, glow);
  };
  const side: Record<'door' | 'outer' | 'field' | 'back', Side> = {
    door: ex > 0 ? 'w' : 'e',
    outer: ex > 0 ? 'e' : 'w',
    field: s > 0 ? 'n' : 's',
    back: s > 0 ? 's' : 'n',
  };

  const [x0, x1, z0, z1] = rect(0, CABIN_W, 0, CABIN_D);
  f.logCabin({
    minX: x0,
    maxX: x1,
    minZ: z0,
    maxZ: z1,
    height: CABIN_H,
    wall: WOOD,
    roof: SNOW_DRIFT,
    roofMaterial: 'snow',
    doors: [{ side: side.door, at: Z(2.5) }],
    windows: [
      { side: side.field, at: X(3) },
      { side: side.outer, at: Z(3.05) },
    ],
  });

  // Inner faces of the walls: u 0.3…6.2, v 0.3…4.7.
  // Bunks along the outer and back walls, blankets in the team's colour.
  const blanket = s < 0 ? '#7c3b35' : '#35507c';
  f.bunk(...rect(4.25, 6.2, 3.8, 4.7), side.outer, { blanket });
  f.bunk(...rect(5.3, 6.2, 0.3, 2.3), side.field, { blanket });
  f.wallRug(side.outer, X(6.2), Math.min(Z(0.5), Z(2.1)), Math.max(Z(0.5), Z(2.1)), 1.9, 2.6, FUR);
  // Stove on the back wall with its pipe out through the roof, above the ridge (4.55 m);
  // the woodpile stacked against it.
  f.stove(X(2.55), Z(4.4), side.field, 4.8);
  f.decoCyl(X(2.55), 4.8, Z(4.4), 0.15, 0.08, IRON, 'metal', { rTop: 0.05, sides: 10 });
  f.woodpile(...rect(1.62, 2.2, 4.15, 4.7), 0.8, { along: 'x' });
  // Table under the field window, a bench and two stumps round it, supper on it.
  f.table(...rect(2.4, 3.6, 0.3, 1.1));
  f.bench(...rect(2.45, 3.55, 1.25, 1.6));
  f.stump(X(2.05), Z(0.7));
  f.stump(X(3.95), Z(0.7));
  f.decoCyl(X(2.75), 0.76, Z(0.6), 0.1, 0.16, IRON, 'metal', { rTop: 0.07, sides: 10 });
  f.decoCyl(X(3.2), 0.76, Z(0.8), 0.045, 0.1, IRON, 'metal', { sides: 8 });
  f.decoCyl(X(3.4), 0.76, Z(0.55), 0.045, 0.1, IRON, 'metal', { sides: 8 });
  // Supplies on a narrow shelf in the corner by the door (clear of the door leaf).
  f.shelf(...rect(0.3, 1.05, 0.3, 0.62), 1.7, side.back, { goods: ['#8a5a3a', '#c9a66b', '#6d4c3d', '#9b3d2f'] });
  // Fur rug in the middle; a lantern hangs over the table, where nobody stands.
  f.rug(...rect(1.4, 4.3, 1.8, 3.5), FUR, 0.03);
  f.lantern(X(3), 2.22, Z(0.75), { hang: CABIN_H - 0.03 });
  f.lights.push({ x: X(3), y: 2.4, z: Z(0.9), color: LAMP, intensity: 3.5, distance: 8 });
  // Snowshoes hung on the back wall between the stove and the bunk.
  for (const u of [3.3, 3.8]) {
    deco(u - 0.17, u + 0.17, 1.1, 1.75, 4.65, 4.7, WOOD_DARK, 'wood');
    deco(u - 0.13, u + 0.13, 1.15, 1.7, 4.63, 4.65, SANDBAG, 'fabric');
  }

  // Outside: skis and poles leaning by the door, a lantern on a bracket beside it.
  for (const v of [3.5, 3.68]) deco(-0.05, 0, 0, 1.9, v, v + 0.09, SKI, 'wood');
  for (const v of [3.95, 4.05]) f.decoCyl(X(-0.04), 0, Z(v), 0.015, 1.35, IRON, 'metal', { sides: 6 });
  deco(-0.18, 0, 2.2, 2.24, 1.36, 1.44, IRON, 'metal');
  f.lantern(X(-0.14), 1.96, Z(1.4));
  f.lights.push({ x: X(-0.5), y: 2.2, z: Z(1.4), color: LAMP, intensity: 2.5, distance: 7 });
  // Barrels and snow-covered sacks against the outer flank, by the back corner.
  for (const v of [4.58, 3.74]) {
    f.barrel(X(6.92), Z(v), { color: WOOD_DARK });
    f.spheres.push(snowCap(X(6.92), 1.0, Z(v), 0.34));
  }
  for (const v of [2.97, 2.47]) {
    f.sack(X(6.73), Z(v), { w: 0.46, d: 0.5 });
    f.spheres.push(snowCap(X(6.73), 0.5, Z(v), 0.22));
  }
}

/** One team camp; `s` is −1 for the northern (red) camp, +1 for the southern (blue) one. */
function camp(s: 1 | -1, canvas: string, flag: string) {
  // Two log cabins flanking the camp.
  cabin(-14, s);
  cabin(14, s);
  // Tents around the firepit: solid up to their ridge, drawn as canvas A-frames.
  f.tent(-8.2, -4.8, ...zspan(s, 19.7, 22.7), 1.8, canvas);
  f.tent(4.8, 8.2, ...zspan(s, 19.7, 22.7), 1.8, canvas);
  f.tent(-1.7, 1.7, ...zspan(s, 21.3, 23.1), 1.8, canvas);
  // Crates (two per old stack), a fallen log and boulders covering the way out of the camp.
  for (const x of [-4.2, -3, 1.8, 3]) {
    f.solid(x, x + 1.2, 0, 1.2, ...zspan(s, 16.4, 17.6), CRATE, 'crate');
    f.deco(x + 0.08, x + 1.12, 1.18, 1.26, ...zspan(s, 16.48, 17.52), SNOW_DRIFT, 'snow');
  }
  for (const x of [-4.51, 4.51]) {
    f.sack(x, s * 17, { w: 0.62, d: 0.45 });
    f.spheres.push(snowCap(x, 0.5, s * 17, 0.24));
  }
  snowOnLog(f.solid(-2, 2, 0, 0.9, ...zspan(s, 14.5, 15.5), LOG, 'bark'));
  for (const x of [-9.5, 9.5]) {
    f.solid(x - 0.7, x + 0.7, 0, 1.2, ...zspan(s, 14.5, 17.5), ROCK, 'rock');
    for (const z of [15.3, 16.7]) f.spheres.push(snowCap(x, 1.2, s * z, 0.55));
  }
  // Trodden snow around the firepit (decoration only).
  f.cover(-6, 6, ...zspan(s, 17.3, 22.3), 0, SNOW_DRIFT, 'snow', 0.06);

  // The firepit: a ring of stones round an ash bed, glowing embers under two crossed logs.
  const fz = s * 20;
  f.decoCyl(0, 0.04, fz, 0.66, 0.04, ASH, 'soil', { sides: 14 });
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    f.spheres.push({ x: Math.cos(a) * 0.75, y: 0.14, z: fz + Math.sin(a) * 0.75, r: 0.19 + (i % 3) * 0.02, color: ROCK_DARK, material: 'rock' });
  }
  f.decoCyl(0, 0.07, fz, 0.42, 0.05, EMBER, undefined, { glow: 2.2, sides: 12 });
  f.deco(-0.6, 0.6, 0.08, 0.3, fz - 0.11, fz + 0.11, LOG, 'bark');
  f.deco(-0.11, 0.11, 0.2, 0.42, fz - 0.6, fz + 0.6, LOG, 'bark');
  f.decoCyl(0, 0.2, fz, 0.2, 0.5, FLAME, undefined, { rTop: 0.02, glow: 2.2, sides: 7 });
  f.decoCyl(0.16, 0.12, fz + 0.1, 0.11, 0.36, EMBER, undefined, { rTop: 0.01, glow: 2.2, sides: 6 });
  f.decoCyl(-0.14, 0.12, fz - 0.12, 0.1, 0.32, EMBER, undefined, { rTop: 0.01, glow: 2.2, sides: 6 });
  // Log benches either side of the fire, clear of the spawn points and low enough to step on.
  for (const x of [-1.95, 1.55]) f.solid(x, x + 0.4, 0, 0.4, ...zspan(s, 19.3, 20.9), LOG, 'bark');

  // The team flag on a tall pole against the cliff behind the camp, between two tents.
  const pz = s * 23.1;
  f.decoCyl(3.25, 0, pz, 0.06, 5.6, IRON, 'metal', { sides: 8 });
  f.decoCyl(3.25, 5.6, pz, 0.1, 0.1, IRON, 'metal', { sides: 8 });
  f.deco(3.31, 4.51, 4.6, 5.4, pz - 0.02, pz + 0.02, flag, 'fabric');
}

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

const inCorridor = (x: number, z: number) =>
  CAVE_CORRIDORS.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1);

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
  material: 'rock',
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

// Frost on the cave floor: thin ice sheets, glassy underfoot (sounds like stone).
for (const [x0, x1, z0, z1] of [
  [-23.1, -21.5, -13.8, -11.2],
  [-22.8, -18.6, -9.9, -8.6],
  [-20.1, -18.5, -6.6, -3.2],
  [-17.9, -15.8, 0.1, 1.5],
  [-22.9, -19.3, 1.2, 3.8],
  [-23.1, -21.5, 6.4, 9.6],
  [-23.0, -21.6, 11.6, 13.4],
])
  f.cover(x0, x1, z0, z1, 0, FROST, 'ice', 0.03);

// Lanterns of cold blue glass hang from the roof by three of the cave lights.
for (const [x, z] of [
  [-22.25, -12],
  [-19.25, -5],
  [-22.25, 6],
])
  f.lantern(x, 2.25, z, { hang: CAVE_WALL_H, color: COLD_GLASS });

/**
 * Icicles hanging from the cave roof — downward ice cones ending above 2.1 m, so nobody
 * walks into them. Decoration: they block nothing.
 */
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
const icicle = (x: number, z: number, len: number, rTop: number): MapCylinder => ({
  x,
  y: CAVE_WALL_H - len / 2,
  z,
  r: 0.01,
  rTop,
  h: len,
  color: ICE,
  material: 'ice',
  sides: 6,
});
const icicles: MapCylinder[] = ICICLE_XZ.map(([x, z]) => icicle(x, z, 0.9, 0.13));
// More along the walls and the mouths, where water runs down the rock and freezes.
for (let i = 0; i < 17; i++)
  for (let j = 0; j < 60; j++) {
    const x = -23.3 + i * 0.5,
      z = -14.8 + j * 0.5;
    const n = hash(i, j);
    if (n > 0.6 || !inCorridor(x, z)) continue;
    if ([[-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]].every(([dx, dz]) => inCorridor(x + dx, z + dz))) continue;
    const jx = x + (hash(j, i) - 0.5) * 0.25,
      jz = z + (hash(i + 7, j) - 0.5) * 0.25;
    const [px, pz] = inCorridor(jx, jz) ? [jx, jz] : [x, z];
    icicles.push(icicle(px, pz, 0.35 + n * 0.9, 0.08 + hash(j + 3, i) * 0.06));
  }

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

/** Tiers of needles, bottom up; the lowest starts at 2.4 m, over a standing head. */
const PINE_TIERS = [
  { y0: 2.4, h: 1.8, r: 1.6, rTop: 0.3, color: PINE_1 },
  { y0: 3.4, h: 1.6, r: 1.25, rTop: 0.2, color: PINE_2 },
  { y0: 4.3, h: 1.4, r: 0.95, rTop: 0.12, color: PINE_2 },
  { y0: 5.1, h: 1.1, r: 0.6, rTop: 0.05, color: PINE_3 },
];
/** Snow covers each tier from this share of its height up. */
const PINE_SNOW_FROM = 0.6;

/** Solid bark trunk under four cones of needles, each dusted with a thin cone of snow. */
const pine = ([x, z]: [number, number]): MapCylinder[] => [
  { x, y: 2.25, z, r: 0.3, h: 4.5, color: PINE_TRUNK, material: 'bark', solid: true, sides: 8 },
  ...PINE_TIERS.flatMap((t): MapCylinder[] => {
    const k = PINE_SNOW_FROM;
    const snowY0 = t.y0 + t.h * k,
      snowY1 = t.y0 + t.h + 0.03;
    return [
      { x, y: t.y0 + t.h / 2, z, r: t.r, rTop: t.rTop, h: t.h, color: t.color, material: 'foliage', sides: 11 },
      {
        x,
        y: (snowY0 + snowY1) / 2,
        z,
        r: t.r + (t.rTop - t.r) * k + 0.04,
        rTop: t.rTop + 0.02,
        h: snowY1 - snowY0,
        color: SNOW_DRIFT,
        material: 'snow',
        sides: 11,
      },
    ];
  }),
];

// Stumps of felled pines, capped with snow (low enough to step onto).
for (const [x, z] of [
  [19.3, -9.8],
  [17, -2.2],
  [24.5, 3.2],
  [18.2, 7],
  [24.8, 11.2],
]) {
  f.stump(x, z);
  f.spheres.push(snowCap(x, 0.45, z, 0.2));
}

// Small snow-capped rocks between the trees, low enough to step onto.
for (const [x, z, w, d] of [
  [20.2, -10.3, 0.9, 0.7],
  [24.8, -1, 1, 0.8],
  [15.6, 10.7, 0.8, 0.9],
  [18.6, 3.4, 0.9, 0.7],
]) {
  f.solid(x - w / 2, x + w / 2, 0, 0.5, z - d / 2, z + d / 2, ROCK, 'rock');
  f.spheres.push(snowCap(x, 0.5, z, Math.min(w, d) * 0.5));
}

// A pine blown down along the east cliff: a trunk low enough to step onto, its root plate
// and crown of branches pressed against the rock face.
f.solid(26.7, 27.2, 0, 0.5, -13.2, -8.6, PINE_TRUNK, 'bark');
lyingZ(26.95, 0.55, -13.35, 0.6, 0.3, '#4a3a2c', 'soil', { sides: 10 });
lyingZ(26.95, 0.25, -7.1, 0.2, 3, PINE_TRUNK, 'bark', { rTop: 0.05, sides: 8 });
for (const [x, y, z, r, rTop, len] of [
  [26.72, 0.5, -8.0, 0.5, 0.18, 1.2],
  [26.78, 0.42, -6.9, 0.4, 0.1, 1.0],
  [26.85, 0.32, -6.0, 0.28, 0.03, 0.8],
]) {
  // Tiers of needles lying on their side, narrowing toward the tip.
  lyingZ(x, y, z, r, len, PINE_2, 'foliage', { rTop, sides: 10 });
  const mid = (r + rTop) / 2;
  f.spheres.push(snowCap(x + 0.05, y + mid * 0.85, z, mid + 0.06));
}
for (const z of [-12.4, -11.3, -10.2, -9.2]) f.deco(26.3, 26.75, 0.28, 0.34, z - 0.03, z + 0.03, PINE_TRUNK, 'bark');

// ----------------------------------------------------------------- boxes ----

/** Parapets round the plateau top, with gaps at both ramp mouths (x −2..2): [x0, x1, z0, z1]. */
const PARAPETS: [number, number, number, number][] = [
  [-8, -2, -6, -5.4],
  [2, 8, -6, -5.4],
  [-8, -2, 5.4, 6],
  [2, 8, 5.4, 6],
  [-8, -7.4, -5.5, -1.5],
  [-8, -7.4, 1.5, 5.5],
  [7.4, 8, -5.5, -1.5],
  [7.4, 8, 1.5, 5.5],
];
// Each parapet is a 0.6 m rock sill topped by a row of sandbags to its old 1 m height, so it
// blocks exactly as before.
for (const [x0, x1, z0, z1] of PARAPETS) {
  f.solid(x0, x1, 2.4, 3.0, z0, z1, ROCK_DARK, 'rock');
  const alongX = x1 - x0 > z1 - z0;
  const [a0, a1] = alongX ? [x0, x1] : [z0, z1];
  const n = Math.round((a1 - a0) / 0.62);
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / n,
      b = a0 + ((a1 - a0) * (i + 1)) / n;
    if (alongX) f.solid(a, b, 3.0, 3.4, z0, z1, SANDBAG, 'sack');
    else f.solid(x0, x1, 3.0, 3.4, a, b, SANDBAG, 'sack');
  }
}
// Supply crates for cover on the plateau, split into single crates along the old stacks.
for (const [x0, x1, y1, z0, z1] of [
  [-5.2, -3.8, 3.4, -3.5, -2],
  [-5.2, -3.8, 3.4, -2, -0.5],
  [-5.2, -3.8, 3.1, 1.5, 2.5],
  [-5.2, -3.8, 3.1, 2.5, 3.5],
  [3.5, 5, 3.4, 3.8, 4.6],
  [5, 6.5, 3.4, 3.8, 4.6],
])
  f.solid(x0, x1, 2.4, y1, z0, z1, CRATE, 'crate');
// A field radio on the north crates, a telescope on a tripod on the south ones.
f.deco(-4.75, -4.3, 3.4, 3.68, -1.45, -1.05, '#3f4447', 'metal');
f.deco(-4.3, -4.29, 3.5, 3.58, -1.35, -1.2, FLAME, undefined, 1.8);
f.decoCyl(-4.68, 3.68, -1.12, 0.01, 0.9, IRON, 'metal', { sides: 5 });
for (const [x, z] of [
  [4.85, 4.05],
  [5.15, 4.05],
  [5, 4.32],
])
  f.deco(x - 0.015, x + 0.015, 3.4, 3.92, z - 0.015, z + 0.015, IRON, 'metal');
lyingZ(5, 3.97, 4.25, 0.05, 0.8, '#b08d3c', 'metal', { rTop: 0.08, sides: 10 });
// Snow on the lookout's plank roof and a lantern on the north-west post.
f.deco(2.85, 7.15, 4.8, 4.9, -2.55, 1.75, SNOW_DRIFT, 'snow');
f.lantern(3.46, 3.75, -2.2);

const FOREST_LOGS: MapBox[] = [
  { x: 17.5, y: 0.4, z: -7.5, w: 5, h: 0.8, d: 0.8, color: LOG, material: 'bark', solid: true },
  { x: 22.5, y: 0.4, z: -4.5, w: 3.4, h: 0.8, d: 0.8, color: LOG, material: 'bark', solid: true },
  { x: 21, y: 0.4, z: 3.5, w: 0.8, h: 0.8, d: 5, color: LOG, material: 'bark', solid: true },
];
const SLOPE_LOG: MapBox = { x: -10, y: 0.45, z: 11, w: 3.6, h: 0.9, d: 1, color: LOG, material: 'bark', solid: true };
for (const b of [...FOREST_LOGS, SLOPE_LOG]) snowOnLog(b);

const rock = (x: number, y: number, z: number, w: number, h: number, d: number): MapBox => ({
  x,
  y,
  z,
  w,
  h,
  d,
  color: ROCK,
  material: 'rock',
  solid: true,
});

/** Non-solid snow drift: drawn as a soft pillow of snow, walked through. */
const drift = (x: number, z: number, w: number, d: number): MapBox => ({
  x,
  y: 0.15,
  z,
  w,
  h: 0.3,
  d,
  color: SNOW_DRIFT,
  material: 'snow',
});

const boxes: MapBox[] = [
  ...perimeterWalls(BOUNDS, 5, 0.8, CLIFF).map((b): MapBox => ({ ...b, material: 'rock' })),

  // --- Central plateau: a 2.4 m rock block, climbable only over the ramps. ---
  { x: 0, y: 1.2, z: 0, w: 16, h: 2.4, d: 12, color: CLIFF, material: 'rock', solid: true },
  // Lookout post: a plank roof on four log posts (underside 4.4 m, well over a
  // standing head at 2.4 + 1.8). Parapets and crates are built with the furniture kit above.
  { x: 5, y: 4.6, z: -0.4, w: 4.4, h: 0.4, d: 4.4, color: WOOD_DARK, material: 'planks', solid: true },

  ...caveBoxes,

  // --- Cover in the pine forest. ---
  ...FOREST_LOGS,
  rock(22.5, 0.65, -10.5, 2.4, 1.3, 2.4),
  rock(19.5, 0.7, -0.5, 2.6, 1.4, 2.2),
  rock(16, 0.6, 5.5, 2.2, 1.2, 2.6),
  rock(19, 0.6, 9.5, 2.8, 1.2, 2),

  // --- Boulders on the open slopes. ---
  rock(-11.5, 0.7, -11, 2.4, 1.4, 2),
  rock(-12.5, 0.6, 3, 2, 1.2, 2.6),
  SLOPE_LOG,
  rock(11, 0.7, -9, 2.2, 1.4, 2.2),
  rock(11.5, 0.6, 8, 2.6, 1.2, 2),
  rock(-4, 0.6, -12, 2.6, 1.2, 1.6),
  rock(5, 0.5, -13, 3, 1, 1.4),
  rock(4, 0.6, 12, 2.6, 1.2, 1.6),
  rock(-5, 0.5, 13, 3, 1, 1.4),

  // --- Snow drifts: pure decoration, nothing collides with them. ---
  drift(-10, -8, 8, 3),
  drift(10.5, -3, 5, 6),
  drift(-11, 8, 6, 3.5),
  drift(9.5, 13, 7, 3),
  drift(0, -12.5, 5, 2.5),
  drift(0, 12.5, 5, 2.5),
  drift(25, -18, 4, 6),
  drift(-25, 18, 4, 6),
  drift(25, 18, 4, 5),
  drift(-25, -19, 4, 5),
];

camp(-1, CANVAS_RED, '#b3382f');
camp(1, CANVAS_BLUE, '#2f5fb3');

const cylinders: MapCylinder[] = [
  ...TREE_XZ.flatMap(pine),
  ...icicles,
  // Lookout post supports: barked logs.
  ...[
    [3.2, -2.2],
    [6.8, -2.2],
    [3.2, 1.4],
    [6.8, 1.4],
  ].map(([x, z]): MapCylinder => ({ x, y: 3.4, z, r: 0.16, h: 2, color: PINE_TRUNK, material: 'bark', solid: true, sides: 8 })),
];

const spheres: MapSphere[] = [
  // Snow caps on the boulders.
  snowCap(-11.5, 1.5, -11, 0.9),
  snowCap(11, 1.5, -9, 0.9),
  snowCap(19.5, 1.5, -0.5, 0.9),
  snowCap(-12.5, 1.3, 3, 0.8),
  snowCap(11.5, 1.3, 8, 0.8),
  snowCap(22.5, 1.4, -10.5, 0.85),
  snowCap(16, 1.3, 5.5, 0.8),
  snowCap(19, 1.3, 9.5, 0.8),
  snowCap(-4, 1.2, -12, 0.7),
  snowCap(5, 1.0, -13, 0.7),
  snowCap(4, 1.2, 12, 0.7),
  snowCap(-5, 1.0, 13, 0.7),
  // Ice blocks at the cave mouths.
  { x: -21.8, y: 0.5, z: -15.4, r: 0.7, color: ICE, material: 'ice' },
  { x: -22.8, y: 0.5, z: 15.4, r: 0.7, color: ICE, material: 'ice' },
  { x: -14.6, y: 0.5, z: 2.4, r: 0.6, color: ICE, material: 'ice' },
  // Stones round the frozen pond.
  ...[
    [-14.2, 6.2],
    [-13.6, 10.25],
    [-11, 10.3],
    [-9.3, 8.7],
    [-9.4, 5.6],
    [-12.4, 4.75],
  ].map(([x, z]): MapSphere => ({ x, y: 0.06, z, r: 0.28, color: ROCK_DARK, material: 'rock' })),
];

const lights: MapLight[] = [
  { x: 0, y: 1.5, z: -20, color: '#ffa95e', intensity: 9, distance: 16 },
  { x: 0, y: 1.5, z: 20, color: '#ffa95e', intensity: 9, distance: 16 },
  // At the lantern on the lookout post.
  { x: 3.5, y: 4.0, z: -2.2, color: LAMP, intensity: 5, distance: 12 },
  // Dim blue glow inside the ice cave.
  { x: -22.25, y: 2.3, z: -12, color: COLD_LAMP, intensity: 3.5, distance: 11 },
  { x: -22.25, y: 2.3, z: -9, color: COLD_LAMP, intensity: 3.5, distance: 11 },
  { x: -19.25, y: 2.3, z: -5, color: COLD_LAMP, intensity: 3.5, distance: 11 },
  { x: -19.25, y: 2.3, z: 0.5, color: COLD_LAMP, intensity: 3.5, distance: 11 },
  { x: -17.5, y: 2.3, z: 0.8, color: COLD_LAMP, intensity: 3, distance: 9 },
  { x: -22.25, y: 2.3, z: 6, color: COLD_LAMP, intensity: 3.5, distance: 11 },
  { x: -22.25, y: 2.3, z: 11, color: COLD_LAMP, intensity: 3.5, distance: 11 },
];

export const MOUNTAIN: ArenaDef = {
  id: 'mountain',
  title: 'Горный лагерь',
  bounds: BOUNDS,
  groundColor: SNOW,
  groundMaterial: 'snow',
  season: 'winter',
  outsideColor: '#c4d2de',
  boxes: [...boxes, ...f.boxes],
  ramps: [
    // The only two ways onto the plateau, drawn as flights of stone steps.
    { minX: -2, maxX: 2, minZ: -10, maxZ: -6, axis: 'z', from: -10, to: -6, y0: 0, y1: 2.4, color: RAMP_STONE, material: 'ashlar', steps: 12 },
    { minX: -2, maxX: 2, minZ: 6, maxZ: 10, axis: 'z', from: 10, to: 6, y0: 0, y1: 2.4, color: RAMP_STONE, material: 'ashlar', steps: 12 },
  ],
  cylinders: [...cylinders, ...f.cylinders],
  spheres: [...spheres, ...f.spheres],
  roofs: f.roofs,
  water: [{ minX: -14, maxX: -9.5, minZ: 5, maxZ: 10, y: 0.06, color: '#8fc4dc' }],
  furnishings: f.decor.map((b): MapBox => (b.color === LINEN ? { ...b, color: CABIN_LINEN } : b)),
  furnishingCylinders: f.decorCylinders,
  lights: [...lights, ...f.lights],
  spawns: { red: campSpawns(-1), blue: campSpawns(1) },
};
