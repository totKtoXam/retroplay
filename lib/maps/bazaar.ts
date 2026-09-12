import { perimeterWalls, type ArenaDef, type MapBox, type MapCylinder, type MapLight, type MapSphere } from './types.ts';

// Базар — a Central Asian bazaar. Three west↔east lanes between the two camps:
//  • north "Торговые ряды": stall rows and crate stacks, close quarters;
//  • centre "Крытый рынок": a two-storey covered hall with four doorways and a stair ramp;
//  • south "Набережная": an open embankment, a river nobody can wade and one bridge
//    to the pier — the only long sightlines on the map.
// Everything is axis-aligned: the boxes below feed both the scene and the collision.

const BOUNDS = { minX: -30, maxX: 30, minZ: -20, maxZ: 20 };

const SAND = '#d8c48e';
const OUTSIDE = '#b09a72';
const CLAY = '#c68f61';
const CLAY_DARK = '#a87049';
const TERRACOTTA = '#b0523a';
const WOOD = '#8a5a34';
const WOOD_LIGHT = '#b07f45';
const STONE = '#9c9285';
const STONE_DARK = '#7b7164';
const FELT = '#e7ddc6';
const FELT_DARK = '#8d6a4a';
const CRATE = '#a3763f';
const SACK = '#cdba8c';
const WATER_BLUE = '#3f7f96';
const RED_CLOTH = '#c4402f';
const TEAL_CLOTH = '#2f8f86';
const SAFFRON = '#e0a12b';
const VIOLET = '#7a4f9c';
const CARPET_A = '#9b2f3a';
const CARPET_B = '#2e5f8a';
const LAMP = '#ffcf8a';

/** Box from its extents: [x0, x1] × [y0, y1] × [z0, z1]. Solid unless told otherwise. */
const box = (
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  color: string,
  solid = true,
): MapBox => ({
  x: (x0 + x1) / 2,
  y: (y0 + y1) / 2,
  z: (z0 + z1) / 2,
  w: x1 - x0,
  h: y1 - y0,
  d: z1 - z0,
  color,
  solid,
});

/** Pure decoration: no collider, no ceiling (awnings, carpets, hanging goods). */
const decor = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string) =>
  box(x0, x1, y0, y1, z0, z1, color, false);

/** Walkable slab 0.2 m thick whose top is at `top`; its underside is a ceiling. */
const slab = (x0: number, x1: number, z0: number, z1: number, top: number, color: string): MapBox => ({
  x: (x0 + x1) / 2,
  y: top - 0.1,
  z: (z0 + z1) / 2,
  w: x1 - x0,
  h: 0.2,
  d: z1 - z0,
  color,
  floor: true,
});

const crate = (x: number, z: number, s: number, y0 = 0, color = CRATE) =>
  box(x - s / 2, x + s / 2, y0, y0 + s, z - s / 2, z + s / 2, color);

const post = (x: number, z: number, y1: number, color = WOOD) =>
  box(x - 0.09, x + 0.09, 0, y1, z - 0.09, z + 0.09, color);

type Door = { at: number; w: number; h: number };

/** Wall running along x at a constant z, optionally pierced by a doorway (side pieces + lintel). */
function wallAlongX(z: number, t: number, x0: number, x1: number, y0: number, y1: number, color: string, door?: Door) {
  const za = z - t / 2,
    zb = z + t / 2;
  if (!door) return [box(x0, x1, y0, y1, za, zb, color)];
  const a = door.at - door.w / 2,
    b = door.at + door.w / 2;
  const parts = [box(x0, a, y0, y1, za, zb, color), box(b, x1, y0, y1, za, zb, color)];
  if (y1 > door.h) parts.push(box(a, b, door.h, y1, za, zb, color));
  return parts;
}

/** Wall running along z at a constant x, optionally pierced by a doorway. */
function wallAlongZ(x: number, t: number, z0: number, z1: number, y0: number, y1: number, color: string, door?: Door) {
  const xa = x - t / 2,
    xb = x + t / 2;
  if (!door) return [box(xa, xb, y0, y1, z0, z1, color)];
  const a = door.at - door.w / 2,
    b = door.at + door.w / 2;
  const parts = [box(xa, xb, y0, y1, z0, a, color), box(xa, xb, y0, y1, b, z1, color)];
  if (y1 > door.h) parts.push(box(xa, xb, door.h, y1, a, b, color));
  return parts;
}

const mirrorX = <T extends { x: number }>(items: T[]): T[] => items.map((b) => ({ ...b, x: -b.x }));

// ─── Centre: the covered market hall, x −10..10, z −5..5 ────────────────────────
// Ground floor 0..3.4 with four 2 m doorways, slab on top (walk surface 3.6),
// a window band 4.6..6.0 over the lanes and a flat roof at 6.2.
const DOOR: Door = { at: 0, w: 2, h: 2.6 };
const HALL_T = 0.4;

const hallWalls: MapBox[] = [
  ...wallAlongX(-5, HALL_T, -10.2, 10.2, 0, 3.4, CLAY, DOOR),
  ...wallAlongX(5, HALL_T, -10.2, 10.2, 0, 3.4, CLAY, DOOR),
  ...wallAlongZ(-10, HALL_T, -5.2, 5.2, 0, 3.4, CLAY, DOOR),
  ...wallAlongZ(10, HALL_T, -5.2, 5.2, 0, 3.4, CLAY, DOOR),
  // Parapet of the upper floor: chest-high, the window band sits above it.
  ...wallAlongX(-5, HALL_T, -10.2, 10.2, 3.4, 4.6, CLAY_DARK),
  ...wallAlongX(5, HALL_T, -10.2, 10.2, 3.4, 4.6, CLAY_DARK),
  ...wallAlongZ(-10, HALL_T, -5.2, 5.2, 3.4, 4.6, CLAY_DARK),
  ...wallAlongZ(10, HALL_T, -5.2, 5.2, 3.4, 4.6, CLAY_DARK),
  // Columns between the windows carry the roof.
  ...([
    [-10, -5],
    [-5, -5],
    [0, -5],
    [5, -5],
    [10, -5],
    [-10, 5],
    [-5, 5],
    [0, 5],
    [5, 5],
    [10, 5],
    [-10, 0],
    [10, 0],
  ] as const).map(([cx, cz]) => box(cx - 0.25, cx + 0.25, 4.6, 6.0, cz - 0.25, cz + 0.25, CLAY_DARK)),
  slab(-10.5, 10.5, -5.5, 5.5, 6.2, CLAY_DARK), // flat roof
  // Second floor, with an open stairwell over the ramp (x −9.8..−7, z −4.8..3.4).
  slab(-7, 9.8, -4.8, 4.8, 3.6, WOOD_LIGHT),
  slab(-9.8, -7, 3.4, 4.8, 3.6, WOOD_LIGHT),
];

// Stepped stone under the ramp so nobody walks through the slope.
const rampSteps: MapBox[] = [1, 2, 3, 4, 5, 6, 7].map((i) =>
  box(-9.8, -7, 0, 0.45 * i, -4.6 + i, -3.6 + i, STONE),
);

const hallProps: MapBox[] = [
  // Ground-floor stalls and the central kiosk.
  box(-6.6, -3.4, 0, 1.0, -3.4, -2.2, WOOD),
  box(-6.6, -3.4, 0, 1.0, 2.2, 3.4, WOOD),
  box(3.4, 6.6, 0, 1.0, -3.4, -2.2, WOOD),
  box(3.4, 6.6, 0, 1.0, 2.2, 3.4, WOOD),
  box(-1.2, 1.2, 0, 1.4, -1.2, 1.2, TERRACOTTA),
  decor(-1.4, 1.4, 1.4, 1.55, -1.4, 1.4, SAFFRON),
  decor(-6.8, -3.2, 2.6, 2.75, -3.6, -2.0, TEAL_CLOTH),
  decor(3.2, 6.8, 2.6, 2.75, 2.0, 3.6, RED_CLOTH),
  // Cover on the balcony floor.
  crate(-3, -3, 1.0, 3.6),
  crate(4, -3, 1.0, 3.6),
  crate(-3, 3, 1.0, 3.6),
  crate(4, 3, 1.0, 3.6),
  crate(7.5, 0, 1.2, 3.6),
  // Carpets hung on the outside walls.
  decor(-10.45, -10.35, 1.1, 2.7, -4.4, -2.4, CARPET_A),
  decor(10.35, 10.45, 1.1, 2.7, 2.4, 4.4, CARPET_B),
  decor(-6.0, -3.0, 2.8, 2.9, -5.45, -5.35, CARPET_B),
];

// ─── North lane: Торговые ряды ──────────────────────────────────────────────────
const stallRow = (x0: number, x1: number, left: string, right: string): MapBox[] => {
  const mid = (x0 + x1) / 2;
  return [
    box(x0, x1, 0, 1.1, -16.6, -15.4, WOOD), // counter
    decor(x0, x1, 1.1, 1.2, -16.6, -15.4, WOOD_LIGHT), // goods board
    decor(x0 - 0.4, mid, 2.8, 2.95, -17.1, -14.8, left), // awning
    decor(mid, x1 + 0.4, 2.8, 2.95, -17.1, -14.8, right),
    ...[x0 + 0.2, mid, x1 - 0.2].flatMap((px) => [post(px, -16.91, 2.8), post(px, -14.89, 2.8)]),
  ];
};

const northLane: MapBox[] = [
  ...stallRow(-17, -7, RED_CLOTH, SAFFRON),
  ...stallRow(-4, 4, TEAL_CLOTH, VIOLET),
  ...stallRow(7, 17, SAFFRON, RED_CLOTH),
  // Crate stacks in front of the rows: the second line of cover.
  crate(-12.4, -10.4, 1.2),
  crate(-12.4, -10.4, 0.9, 1.2),
  crate(-11.1, -10.5, 1.0),
  crate(-12.0, -9.4, 1.0),
  box(-10.8, -10.0, 0, 0.7, -9.8, -9.0, SACK),
  crate(-0.6, -10.4, 1.2),
  crate(-0.6, -10.4, 0.9, 1.2),
  crate(0.7, -10.0, 1.0),
  box(-0.4, 0.4, 0, 0.7, -9.3, -8.7, SACK),
  crate(12.4, -10.4, 1.2),
  crate(12.4, -10.4, 0.9, 1.2),
  crate(11.1, -10.5, 1.0),
  crate(12.0, -9.4, 1.0),
  box(10.0, 10.8, 0, 0.7, -9.8, -9.0, SACK),
  // Back alley behind the rows (z −19.4..−17): a flank route with a little cover.
  crate(-20.0, -18.3, 1.0),
  crate(-5.5, -18.3, 1.0),
  crate(9.0, -18.3, 1.0),
  crate(20.0, -18.3, 1.0),
  decor(-24, -18, 0.02, 0.06, -14.5, -11.5, CARPET_A),
  decor(18, 24, 0.02, 0.06, -14.5, -11.5, CARPET_B),
];

// ─── South lane: Набережная, the river and the bridge ───────────────────────────
// Water is decoration; the 1.2 m stone banks are what keeps players out of it,
// so the bridge (x −2..2, railed) is the only way to the pier.
const BANK_TOP = 1.2;
const DECK = 0.45;

const southLane: MapBox[] = [
  decor(-29.4, 29.4, 0, 0.06, 5, 9.8, STONE), // paved embankment
  box(-20, -16, 0, 1.1, 7.2, 7.8, STONE_DARK),
  box(16, 20, 0, 1.1, 7.2, 7.8, STONE_DARK),
  crate(-6.5, 7.4, 1.0),
  crate(6.5, 7.4, 1.0),
  crate(-24.5, 6.6, 1.2),
  crate(24.5, 6.6, 1.2),
  box(-13.4, -12.6, 0, 0.8, 8.2, 9.0, SACK),
  box(12.6, 13.4, 0, 0.8, 8.2, 9.0, SACK),
  // River banks, open only where the bridge crosses.
  box(-29.8, -2, 0, BANK_TOP, 9.8, 10.2, STONE),
  box(2, 29.8, 0, BANK_TOP, 9.8, 10.2, STONE),
  box(-29.8, -2, 0, BANK_TOP, 15.8, 16.2, STONE),
  box(2, 29.8, 0, BANK_TOP, 15.8, 16.2, STONE),
  // Bridge: deck one step up, railings on both sides.
  slab(-2, 2, 9, 17, DECK, WOOD),
  box(2.0, 2.2, DECK, DECK + 1.0, 9, 17, WOOD_LIGHT),
  box(-2.2, -2.0, DECK, DECK + 1.0, 9, 17, WOOD_LIGHT),
  // Pier: reachable over the bridge only, walled in chest-high.
  slab(-6, 6, 16.2, 19.4, DECK, WOOD),
  box(-6, 6, DECK, DECK + 0.8, 19.1, 19.4, STONE_DARK),
  box(-6, -5.7, DECK, DECK + 0.8, 16.2, 19.4, STONE_DARK),
  box(5.7, 6, DECK, DECK + 0.8, 16.2, 19.4, STONE_DARK),
  box(-6, -2, DECK, DECK + 0.8, 16.2, 16.5, STONE_DARK),
  box(2, 6, DECK, DECK + 0.8, 16.2, 16.5, STONE_DARK),
  crate(-4.2, 18.2, 1.0, DECK),
  crate(4.2, 18.2, 1.0, DECK),
  decor(-1.6, 1.6, DECK + 0.02, DECK + 0.06, 11, 15, CARPET_A),
];

// ─── Camps: caravan carts and crates at both spawn exits ────────────────────────
const blueCamp: MapBox[] = [
  box(-28.0, -25.0, 0, 1.25, -9.2, -7.8, WOOD),
  box(-28.0, -27.6, 1.25, 2.1, -9.2, -7.8, WOOD_LIGHT),
  box(-28.0, -25.0, 0, 1.25, 7.8, 9.2, WOOD),
  box(-28.0, -27.6, 1.25, 2.1, 7.8, 9.2, WOOD_LIGHT),
  crate(-22.6, -6.0, 1.2),
  crate(-22.6, -6.0, 0.9, 1.2),
  crate(-22.6, 6.0, 1.2),
  crate(-22.6, 6.0, 0.9, 1.2),
  crate(-22.2, 0, 1.0),
  box(-26.6, -25.8, 0, 0.7, -3.4, -2.6, SACK),
  box(-26.6, -25.8, 0, 0.7, 2.6, 3.4, SACK),
  decor(-29.2, -23.0, 3.0, 3.15, -7.2, 7.2, VIOLET), // camp canopy
  post(-29.0, -7.0, 3.0),
  post(-29.0, 7.0, 3.0),
  post(-23.2, -7.0, 3.0),
  post(-23.2, 7.0, 3.0),
  decor(-27.5, -24.5, 0.02, 0.06, -1.5, 1.5, CARPET_B),
];

const cylinders: MapCylinder[] = [
  // Yurts at the spawn exits.
  { x: -16, y: 1.1, z: 0, r: 2, h: 2.2, color: FELT, solid: true, sides: 16 },
  { x: 16, y: 1.1, z: 0, r: 2, h: 2.2, color: FELT, solid: true, sides: 16 },
  { x: -16, y: 3.45, z: 0, r: 0.4, h: 0.5, color: FELT_DARK, sides: 12 },
  { x: 16, y: 3.45, z: 0, r: 0.4, h: 0.5, color: FELT_DARK, sides: 12 },
  // Barrels and clay pots.
  { x: -26.5, y: 0.5, z: -2.2, r: 0.45, h: 1.0, color: WOOD, solid: true, sides: 10 },
  { x: -26.5, y: 0.5, z: 2.2, r: 0.45, h: 1.0, color: WOOD, solid: true, sides: 10 },
  { x: 26.5, y: 0.5, z: -2.2, r: 0.45, h: 1.0, color: WOOD, solid: true, sides: 10 },
  { x: 26.5, y: 0.5, z: 2.2, r: 0.45, h: 1.0, color: WOOD, solid: true, sides: 10 },
  { x: -8.5, y: 0.45, z: -7.5, r: 0.5, h: 0.9, color: TERRACOTTA, solid: true, sides: 10 },
  { x: 8.5, y: 0.45, z: -7.5, r: 0.5, h: 0.9, color: TERRACOTTA, solid: true, sides: 10 },
  { x: -8.5, y: 0.45, z: 7.5, r: 0.5, h: 0.9, color: TERRACOTTA, solid: true, sides: 10 },
  { x: 8.5, y: 0.45, z: 7.5, r: 0.5, h: 0.9, color: TERRACOTTA, solid: true, sides: 10 },
  { x: -19.5, y: 0.45, z: -13.5, r: 0.5, h: 0.9, color: TERRACOTTA, solid: true, sides: 10 },
  { x: 19.5, y: 0.45, z: -13.5, r: 0.5, h: 0.9, color: TERRACOTTA, solid: true, sides: 10 },
];

const spheres: MapSphere[] = [
  // Yurt domes, melons on the counters, river stones.
  { x: -16, y: 2.3, z: 0, r: 1.7, color: FELT_DARK },
  { x: 16, y: 2.3, z: 0, r: 1.7, color: FELT_DARK },
  ...[-14.5, -12, -9.5, -1.5, 1.5, 9.5, 12, 14.5].map((x) => ({ x, y: 1.35, z: -16, r: 0.26, color: '#79a24a' })),
  { x: -8.5, y: 1.0, z: -7.5, r: 0.35, color: SAFFRON },
  { x: 8.5, y: 1.0, z: 7.5, r: 0.35, color: SAFFRON },
  { x: -7.5, y: 0.3, z: 12.5, r: 0.6, color: STONE_DARK },
  { x: 9.0, y: 0.3, z: 13.5, r: 0.7, color: STONE_DARK },
  { x: 18.5, y: 0.3, z: 11.8, r: 0.5, color: STONE_DARK },
  { x: -20.0, y: 0.3, z: 14.2, r: 0.55, color: STONE_DARK },
];

const lights: MapLight[] = [
  { x: -12, y: 2.6, z: -15.8, color: LAMP, intensity: 9, distance: 13 },
  { x: 0, y: 2.6, z: -15.8, color: LAMP, intensity: 9, distance: 13 },
  { x: 12, y: 2.6, z: -15.8, color: LAMP, intensity: 9, distance: 13 },
  { x: -5, y: 3.0, z: 0, color: LAMP, intensity: 10, distance: 14 },
  { x: 5, y: 3.0, z: 0, color: LAMP, intensity: 10, distance: 14 },
  { x: 0, y: 5.5, z: 0, color: LAMP, intensity: 10, distance: 14 },
  { x: 0, y: 2.2, z: 9.6, color: LAMP, intensity: 8, distance: 12 },
  { x: 0, y: 2.2, z: 16.4, color: LAMP, intensity: 8, distance: 12 },
  { x: -16, y: 2.9, z: 0, color: LAMP, intensity: 8, distance: 12 },
  { x: 16, y: 2.9, z: 0, color: LAMP, intensity: 8, distance: 12 },
  { x: -26, y: 2.9, z: 0, color: '#9ecbff', intensity: 8, distance: 12 },
  { x: 26, y: 2.9, z: 0, color: '#ff9e9e', intensity: 8, distance: 12 },
];

export const BAZAAR: ArenaDef = {
  id: 'bazaar',
  title: 'Базар',
  bounds: BOUNDS,
  groundColor: SAND,
  outsideColor: OUTSIDE,
  boxes: [
    ...perimeterWalls(BOUNDS, 4, 0.6, CLAY),
    ...hallWalls,
    ...rampSteps,
    ...hallProps,
    ...northLane,
    ...southLane,
    ...blueCamp,
    ...mirrorX(blueCamp),
  ],
  ramps: [
    { minX: -9.8, maxX: -7, minZ: -4.6, maxZ: 3.4, axis: 'z', from: -4.6, to: 3.4, y0: 0, y1: 3.6, color: STONE },
  ],
  cylinders,
  spheres,
  // The river, plus the backwater on either side of the pier: the far shore is water,
  // so the only dry ground south of the banks is the pier itself.
  water: [
    { minX: -29.4, maxX: 29.4, minZ: 9.9, maxZ: 16.1, y: 0.22, color: WATER_BLUE },
    { minX: -29.4, maxX: -6, minZ: 15.9, maxZ: 19.4, y: 0.22, color: WATER_BLUE },
    { minX: 6, maxX: 29.4, minZ: 15.9, maxZ: 19.4, y: 0.22, color: WATER_BLUE },
  ],
  lights,
  spawns: {
    blue: [
      { x: -28, z: -5, yaw: Math.PI / 2 },
      { x: -28, z: 0, yaw: Math.PI / 2 },
      { x: -28, z: 5, yaw: Math.PI / 2 },
      { x: -25, z: -5, yaw: Math.PI / 2 },
      { x: -25, z: 0, yaw: Math.PI / 2 },
      { x: -25, z: 5, yaw: Math.PI / 2 },
    ],
    red: [
      { x: 28, z: -5, yaw: -Math.PI / 2 },
      { x: 28, z: 0, yaw: -Math.PI / 2 },
      { x: 28, z: 5, yaw: -Math.PI / 2 },
      { x: 25, z: -5, yaw: -Math.PI / 2 },
      { x: 25, z: 0, yaw: -Math.PI / 2 },
      { x: 25, z: 5, yaw: -Math.PI / 2 },
    ],
  },
};
