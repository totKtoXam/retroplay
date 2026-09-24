import {
  perimeterWalls,
  type ArenaDef,
  type MapBox,
  type MapCylinder,
  type MapLight,
  type MapSphere,
  type SurfaceMaterial,
} from './types.ts';
import { createFurnisher, type Furnisher } from './furnish.ts';

// Базар — a Central Asian bazaar. Three west↔east lanes between the two camps:
//  • north "Торговые ряды": stall rows and crate stacks, close quarters;
//  • centre "Крытый рынок": a two-storey covered hall with four doorways and a stair ramp;
//  • south "Набережная": an open embankment, a river nobody can wade and one bridge
//    to the pier — the only long sightlines on the map.
// Everything is axis-aligned: the boxes below feed both the scene and the collision.
//
// Dressing follows «Особняк»: counters, crates, sacks and the tea-house platform are solid
// boxes; goods, cloths, lanterns, ceilings and beams are furnishings, drawn only. At body
// height (0.1–2 m) furnishings sit on furniture or against walls; whatever hangs over a
// walkway (lanterns, chillies, garlic) stays above 2.1 m. Floor covers and rugs are boxes, so
// footsteps know what is underfoot (lib/footsteps.ts).

const BOUNDS = { minX: -30, maxX: 30, minZ: -20, maxZ: 20 };

// --- palette -------------------------------------------------------------------------
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
const CRATE = '#a3763f';
const SACK = '#cdba8c';
const WATER_BLUE = '#3f7f96';
const RED_CLOTH = '#c4402f';
const TEAL_CLOTH = '#2f8f86';
const SAFFRON = '#e0a12b';
const VIOLET = '#7a4f9c';
const CARPET_A = '#9b2f3a';
const CARPET_B = '#2e5f8a';
const CARPET_C = '#b5652a'; // madder orange
const CARPET_D = '#5a2f5f'; // plum
const LAMP = '#ffcf8a';
const PAVING = '#a99c84'; // embankment, lane strip, door aprons
const HALL_TILE = '#b98b62'; // fired-brick floor of the hall
const SOIL = '#8a6a48';
const BEAM = '#5e4029'; // beams, casings, posts, handrail
const CEILING = '#a57a4c'; // boards under the balcony and under the roof
const DOOR_WOOD = '#5a3a24';
const DOOR_CARVE = '#7a5234';
const BRASS = '#b8913a';
const IRON = '#3d3b3a';
const FLAME = '#ffc46e';
const EMBER = '#ff7a2a';
const GLAZE_BLUE = '#2e6f9e';
const GLAZE_WHITE = '#d9d2c3';
const WICKER = '#b8955a';
const ROPE = '#a88a5a';
const LEATHER = '#6b4226';
const BREAD = '#c98b4a';
const BREAD_TOP = '#e0b27a';
const MELON = '#79a24a';
const CHILLI = '#b8321f';
const CARPETS = [CARPET_A, CARPET_B, CARPET_C, CARPET_D];
// Ground spices: turmeric, paprika, cumin, sumac, chilli, coriander.
const SPICES = [SAFFRON, CHILLI, '#8a6a3a', '#7a2436', RED_CLOTH, '#b59a64'];
// Dried fruit and nuts: apricots, raisins, almonds, walnuts, dates, pistachios.
const DRIED = ['#d98a3a', '#4f2e1f', '#b98a5a', '#7a5a3a', '#6e3b1f', '#a89f6a'];
// Fresh fruit: apples, pomegranates, peaches, quinces.
const FRUIT = ['#c43c2c', '#9b2230', '#e39a5a', '#d9b44a'];

/** Box from its extents: [x0, x1] × [y0, y1] × [z0, z1]. Solid unless told otherwise. */
const box = (
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  color: string,
  material?: SurfaceMaterial,
  solid = true,
): MapBox => ({
  x: (x0 + x1) / 2,
  y: (y0 + y1) / 2,
  z: (z0 + z1) / 2,
  w: x1 - x0,
  h: y1 - y0,
  d: z1 - z0,
  color,
  ...(material ? { material } : {}),
  solid,
});

/** A non-solid box that footsteps and the camera still see: awnings, cloths, ground carpets. */
const sheet = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string, material?: SurfaceMaterial) =>
  box(x0, x1, y0, y1, z0, z1, color, material, false);

/** Walkable slab 0.2 m thick whose top is at `top`; its underside is a ceiling. */
const slab = (x0: number, x1: number, z0: number, z1: number, top: number, color: string, material?: SurfaceMaterial): MapBox => ({
  x: (x0 + x1) / 2,
  y: top - 0.1,
  z: (z0 + z1) / 2,
  w: x1 - x0,
  h: 0.2,
  d: z1 - z0,
  color,
  ...(material ? { material } : {}),
  floor: true,
});

const crate = (x: number, z: number, s: number, y0 = 0, color = CRATE) =>
  box(x - s / 2, x + s / 2, y0, y0 + s, z - s / 2, z + s / 2, color, 'crate');

const post = (x: number, z: number, y1: number, color = WOOD) =>
  box(x - 0.09, x + 0.09, 0, y1, z - 0.09, z + 0.09, color, 'wood');

/** Collision only: the furnishings drawn over it show what it is. */
const hidden = (b: MapBox): MapBox => ({ ...b, invisible: true });

const textured = (items: MapBox[], material: SurfaceMaterial) => items.map((b): MapBox => ({ ...b, material }));

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

/** Mirror across x = 0 for the red camp; tilts about y and z flip sign with it. */
const mirrorX = <T extends { x: number; rot?: [number, number, number] }>(items: T[]): T[] =>
  items.map((b) =>
    b.rot ? { ...b, x: -b.x, rot: [b.rot[0], -b.rot[1], -b.rot[2]] as [number, number, number] } : { ...b, x: -b.x },
  );

// --- dressing kit ----------------------------------------------------------------------
// Everything except the camps goes through `f`; the blue camp has its own furnisher so it
// can be mirrored whole into the red one.
const f = createFurnisher();
const { deco, decoCyl, cover } = f;

/** A cylinder lying along `axis`, centred at (x, y, z): logs, bolsters, rolled carpets, hubs. */
const lying = (
  k: Furnisher,
  x: number,
  y: number,
  z: number,
  r: number,
  length: number,
  axis: 'x' | 'z',
  color: string,
  material?: SurfaceMaterial,
  sides = 12,
) => k.decorCylinders.push({ x, y, z, r, h: length, axis, color, material, sides });

/** A brass tray with a cone of ground spice heaped on it. */
function spiceCone(x: number, base: number, z: number, color: string, r = 0.17) {
  decoCyl(x, base, z, r + 0.05, 0.025, BRASS, 'metal', { sides: 16 });
  decoCyl(x, base + 0.025, z, r, r * 1.5, color, 'sand', { rTop: 0.02, sides: 14 });
}

/** A wicker basket heaped with dried fruit or nuts. */
function basketHeap(x: number, base: number, z: number, color: string, r = 0.2) {
  decoCyl(x, base, z, r * 0.8, 0.12, WICKER, 'fabric', { rTop: r, sides: 14 });
  decoCyl(x, base + 0.12, z, r * 0.95, 0.09, color, 'sand', { rTop: r * 0.3, sides: 14 });
}

/** A stack of flat bread (лепёшки): golden discs with a stamped pale middle on top. */
function breadStack(x: number, base: number, z: number, n: number) {
  for (let i = 0; i < n; i++) decoCyl(x + (i % 2) * 0.012, base + i * 0.04, z, 0.16, 0.035, BREAD, 'adobe', { sides: 14 });
  decoCyl(x, base + (n - 1) * 0.04 + 0.03, z, 0.08, 0.01, BREAD_TOP, 'adobe', { sides: 12 });
}

/** A glazed teapot, spout toward +x. */
function teapot(x: number, base: number, z: number, color = GLAZE_BLUE) {
  decoCyl(x, base, z, 0.07, 0.1, color, 'marble', { rTop: 0.085, sides: 12 });
  decoCyl(x, base + 0.1, z, 0.085, 0.03, color, 'marble', { rTop: 0.04, sides: 12 });
  decoCyl(x, base + 0.13, z, 0.015, 0.02, BRASS, 'metal', { sides: 6 });
  deco(x + 0.08, x + 0.15, base + 0.05, base + 0.08, z - 0.012, z + 0.012, color, 'marble');
  deco(x - 0.12, x - 0.08, base + 0.03, base + 0.1, z - 0.01, z + 0.01, color, 'marble');
}

/** A tea bowl (пиала). */
const piala = (x: number, base: number, z: number, color = GLAZE_WHITE) =>
  decoCyl(x, base, z, 0.035, 0.045, color, 'marble', { rTop: 0.055, sides: 10 });

/** A brass samovar with a teapot warming on its crown; the tap faces +x. */
function samovar(x: number, base: number, z: number) {
  decoCyl(x, base, z, 0.15, 0.08, BRASS, 'metal', { rTop: 0.09, sides: 12 });
  decoCyl(x, base + 0.08, z, 0.07, 0.06, BRASS, 'metal', { sides: 10 });
  decoCyl(x, base + 0.14, z, 0.19, 0.34, BRASS, 'metal', { rTop: 0.21, sides: 14 });
  decoCyl(x, base + 0.48, z, 0.21, 0.06, BRASS, 'metal', { rTop: 0.1, sides: 14 });
  decoCyl(x, base + 0.54, z, 0.06, 0.08, IRON, 'metal', { sides: 10 });
  teapot(x, base + 0.62, z);
  deco(x + 0.19, x + 0.3, base + 0.2, base + 0.24, z - 0.02, z + 0.02, BRASS, 'metal');
  deco(x + 0.27, x + 0.3, base + 0.14, base + 0.2, z - 0.015, z + 0.015, BRASS, 'metal');
  for (const s of [-1, 1]) deco(x - 0.03, x + 0.03, base + 0.4, base + 0.46, z + s * 0.2 - 0.035, z + s * 0.2 + 0.035, BRASS, 'metal');
}

/** Lowest point of anything hung over a walkway. */
const HEADROOM = 2.15;

/** A string of chillies (0), garlic (1) or dried apricots (2) hanging from `top` down to head room. */
function hangingString(x: number, z: number, top: number, kind: number, floor = 0) {
  const piece = 0.075;
  const n = Math.floor((top - 0.06 - floor - HEADROOM) / piece);
  const bottom = top - 0.06 - n * piece;
  decoCyl(x, bottom, z, 0.006, top - bottom, ROPE, 'fabric', { sides: 4 });
  for (let i = 0; i < n; i++) {
    const y = bottom + i * piece,
      dx = i % 2 ? 0.022 : -0.022;
    if (kind % 3 === 0) decoCyl(x + dx, y, z, 0.01, piece, CHILLI, 'leather', { rTop: 0.03, sides: 6 });
    else if (kind % 3 === 1) decoCyl(x + dx, y, z, 0.04, piece * 0.8, GLAZE_WHITE, 'fabric', { rTop: 0.012, sides: 7 });
    else decoCyl(x + dx, y, z, 0.03, piece * 0.7, DRIED[0], 'leather', { rTop: 0.03, sides: 6 });
  }
}

/** A pyramid of fruit on a wicker tray: 3×3, then 2×2, then one on top. */
function fruitPyramid(x: number, base: number, z: number, color: string, r = 0.075) {
  decoCyl(x, base, z, r * 4, 0.03, WICKER, 'fabric', { sides: 16 });
  for (let layer = 0; layer < 3; layer++) {
    const n = 3 - layer;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        f.spheres.push({
          x: x + (i - (n - 1) / 2) * 2 * r,
          y: base + 0.03 + r + layer * r * 1.4,
          z: z + (j - (n - 1) / 2) * 2 * r,
          r,
          color,
        });
  }
}

/** A big cart wheel (арба) standing in the x–y plane: a rim of twelve felloes, spokes, a hub. */
function wheel(k: Furnisher, x: number, y: number, z: number, r: number) {
  const segments = 12,
    t = 0.08,
    felloe = 2 * r * Math.sin(Math.PI / segments) + 0.02;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    k.decor.push({ x: x + Math.cos(a) * (r - t / 2), y: y + Math.sin(a) * (r - t / 2), z, w: t, h: felloe, d: 0.08, color: DOOR_WOOD, material: 'wood', rot: [0, 0, a] });
  }
  for (let i = 0; i < 3; i++)
    k.decor.push({ x, y, z, w: 2 * (r - t), h: 0.05, d: 0.05, color: DOOR_WOOD, material: 'wood', rot: [0, 0, (i * Math.PI) / 3] });
  lying(k, x, y, z, 0.12, 0.22, 'z', BEAM, 'wood', 10);
}

// ─── Centre: the covered market hall, x −10..10, z −5..5 ────────────────────────
// Ground floor 0..3.4 with four 2 m doorways, slab on top (walk surface 3.6),
// a window band 4.6..6.0 over the lanes and a flat roof at 6.2.
const DOOR: Door = { at: 0, w: 2, h: 2.6 };
const HALL_T = 0.4;
const UPPER = 3.6; // the balcony floor
const HALL_COLUMNS = [
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
] as const;

const hallWalls: MapBox[] = [
  ...textured(
    [
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
      ...HALL_COLUMNS.map(([cx, cz]) => box(cx - 0.25, cx + 0.25, 4.6, 6.0, cz - 0.25, cz + 0.25, CLAY_DARK)),
    ],
    'adobe',
  ),
  slab(-10.5, 10.5, -5.5, 5.5, 6.2, CLAY_DARK, 'adobe'), // flat roof
  // Second floor, with an open stairwell over the ramp (x −9.8..−7, z −4.8..3.4).
  slab(-7, 9.8, -4.8, 4.8, UPPER, WOOD_LIGHT, 'planks'),
  slab(-9.8, -7, 3.4, 4.8, UPPER, WOOD_LIGHT, 'planks'),
];

// Stepped stone under the ramp so nobody walks through the slope. The ramp is drawn as a
// flight of steps solid down to the floor, which hides it (it would poke through the treads).
const rampSteps: MapBox[] = [1, 2, 3, 4, 5, 6, 7].map((i) =>
  hidden(box(-9.8, -7, 0, 0.45 * i, -4.6 + i, -3.6 + i, STONE, 'ashlar')),
);
const RAMP = { minX: -9.8, maxX: -7, from: -4.6, to: 3.4 };

type Stall = { x0: number; x1: number; z0: number; z1: number; cloth: string };
// The four ground-floor stalls: spices, dried fruit and nuts, bread, pottery and tea ware.
const HALL_STALLS: Stall[] = [
  { x0: -6.6, x1: -3.4, z0: -3.4, z1: -2.2, cloth: TEAL_CLOTH },
  { x0: -6.6, x1: -3.4, z0: 2.2, z1: 3.4, cloth: SAFFRON },
  { x0: 3.4, x1: 6.6, z0: -3.4, z1: -2.2, cloth: VIOLET },
  { x0: 3.4, x1: 6.6, z0: 2.2, z1: 3.4, cloth: RED_CLOTH },
];
const COUNTER = 1.0; // counter top in the hall

const hallProps: MapBox[] = [
  // Ground-floor stalls under striped cloths, and the central tea kiosk.
  ...HALL_STALLS.flatMap((s) => [
    box(s.x0, s.x1, 0, COUNTER, s.z0, s.z1, WOOD, 'wood'),
    sheet(s.x0 - 0.2, s.x1 + 0.2, 2.6, 2.75, s.z0 - 0.2, s.z1 + 0.2, s.cloth, 'awning'),
  ]),
  box(-1.2, 1.2, 0, 1.4, -1.2, 1.2, TERRACOTTA, 'tile'),
  sheet(-1.4, 1.4, 1.4, 1.55, -1.4, 1.4, WOOD_LIGHT, 'planks'),
  // Cover on the balcony floor.
  crate(-3, -3, 1.0, UPPER),
  crate(4, -3, 1.0, UPPER),
  crate(-3, 3, 1.0, UPPER),
  crate(4, 3, 1.0, UPPER),
  crate(7.5, 0, 1.2, UPPER),
];

// Ground floor: fired-brick tiles over the whole footprint, thresholds included; rugs a hair
// higher, laid clear of the ramp.
cover(-10.2, 10.2, -5.2, 5.2, 0, HALL_TILE, 'tile', 0.025);
f.rug(-0.8, 0.8, -4.6, -1.5, CARPET_A, 0.025);
f.rug(-0.8, 0.8, 1.5, 4.6, CARPET_B, 0.025);
f.rug(1.6, 9.6, -0.9, 0.9, CARPET_C, 0.025);
f.rug(-6.4, -1.6, -1.8, 1.8, CARPET_D, 0.025);

// Under the balcony: a boarded ceiling on beams across the hall; under the roof the same over
// the upper floor. Beams keep 2.2 m of head room above either floor.
deco(-7, 9.8, 3.37, 3.4, -4.8, 4.8, CEILING, 'planks');
deco(-9.8, -7, 3.37, 3.4, 3.4, 4.8, CEILING, 'planks');
for (let x = -6; x <= 8; x += 2) deco(x - 0.1, x + 0.1, 3.19, 3.37, -4.8, 4.8, BEAM, 'wood');
deco(-7.05, -6.95, 3.19, 3.4, -4.8, 3.4, BEAM, 'wood'); // edge of the stairwell
deco(-9.8, 9.8, 5.97, 6.0, -4.8, 4.8, CEILING, 'planks');
for (let x = -9; x <= 9; x += 2) deco(x - 0.1, x + 0.1, 5.79, 5.97, -4.8, 4.8, BEAM, 'wood');
for (const [cx, cz] of HALL_COLUMNS) deco(cx - 0.32, cx + 0.32, 5.84, 6.0, cz - 0.32, cz + 0.32, BEAM, 'wood');

// Handrail up the flight, along the west wall (the open side is left bare: a rail there would
// look like it stops you and would not).
{
  const run = RAMP.to - RAMP.from;
  const x = RAMP.minX + 0.08;
  f.decor.push({
    x,
    y: UPPER / 2 + 0.9,
    z: (RAMP.from + RAMP.to) / 2,
    w: 0.07,
    h: 0.07,
    d: Math.hypot(run, UPPER),
    color: BEAM,
    material: 'wood',
    rot: [-Math.atan2(UPPER, run), 0, 0],
  });
  for (let z = RAMP.from + 0.4; z < RAMP.to; z += 0.8) {
    const y = (UPPER * (z - RAMP.from)) / run;
    deco(x - 0.02, x + 0.02, y, y + 0.9, z - 0.02, z + 0.02, BEAM, 'wood');
  }
}

/** Carved double doors folded back flat against the outer wall face; casings round the opening. */
function hallDoor(axis: 'x' | 'z', face: number, out: 1 | -1) {
  const put = (a0: number, a1: number, y0: number, y1: number, d0: number, d1: number, color: string) => {
    const p = Math.min(face + out * d0, face + out * d1),
      q = Math.max(face + out * d0, face + out * d1);
    if (axis === 'x') deco(a0, a1, y0, y1, p, q, color, 'wood');
    else deco(p, q, y0, y1, a0, a1, color, 'wood');
  };
  put(-1.14, 1.14, DOOR.h, DOOR.h + 0.14, 0, 0.03, BEAM);
  for (const [a0, a1] of [
    [-1.14, -1],
    [1, 1.14],
  ])
    put(a0, a1, 0, DOOR.h, 0, 0.03, BEAM);
  for (const [a0, a1] of [
    [-2.02, -1.16],
    [1.16, 2.02],
  ]) {
    put(a0, a1, 0.02, 2.55, 0.03, 0.09, DOOR_WOOD);
    put(a0 + 0.12, a1 - 0.12, 0.3, 1.3, 0.09, 0.1, DOOR_CARVE);
    put(a0 + 0.12, a1 - 0.12, 1.45, 2.3, 0.09, 0.1, DOOR_CARVE);
  }
}
hallDoor('x', -5.2, -1);
hallDoor('x', 5.2, 1);
hallDoor('z', -10.2, -1);
hallDoor('z', 10.2, 1);

// Outside: a band of blue glazed tiles round the upper storey, carpets hung out on the walls.
deco(-10.2, 10.2, 4.25, 4.45, -5.215, -5.2, GLAZE_BLUE, 'tile');
deco(-10.2, 10.2, 4.25, 4.45, 5.2, 5.215, GLAZE_BLUE, 'tile');
deco(-10.215, -10.2, 4.25, 4.45, -5.2, 5.2, GLAZE_BLUE, 'tile');
deco(10.2, 10.215, 4.25, 4.45, -5.2, 5.2, GLAZE_BLUE, 'tile');
f.wallRug('e', -10.2, -4.4, -2.4, 1.1, 2.7, CARPET_A);
f.wallRug('w', 10.2, 2.4, 4.4, 1.1, 2.7, CARPET_B);
f.wallRug('s', -5.2, -6.0, -3.0, 1.2, 2.9, CARPET_B);
f.wallRug('n', 5.2, 5.4, 7.2, 1.2, 2.6, CARPET_D);

// Carpets on the inner walls behind the stalls.
f.wallRug('n', -4.8, -6.4, -3.6, 1.1, 2.5, CARPET_C);
f.wallRug('n', -4.8, 3.6, 6.4, 1.1, 2.5, CARPET_A);
f.wallRug('s', 4.8, -6.4, -3.6, 1.1, 2.5, CARPET_B);
f.wallRug('s', 4.8, 3.6, 6.4, 1.1, 2.5, CARPET_D);

// The stalls: poles from the counter corners up to the cloth, a kilim down the aisle side,
// strings of chillies, garlic and apricots from the cloth edges.
HALL_STALLS.forEach((s, n) => {
  for (const [x, z] of [
    [s.x0 + 0.02, s.z0 + 0.02],
    [s.x1 - 0.08, s.z0 + 0.02],
    [s.x0 + 0.02, s.z1 - 0.08],
    [s.x1 - 0.08, s.z1 - 0.08],
  ])
    deco(x, x + 0.06, COUNTER, 2.6, z, z + 0.06, BEAM, 'wood');
  const aisle = s.z0 < 0 ? s.z1 : s.z0;
  deco(s.x0 + 0.3, s.x1 - 0.3, 0.1, 0.95, Math.min(aisle, aisle - Math.sign(s.z0) * 0.03), Math.max(aisle, aisle - Math.sign(s.z0) * 0.03), CARPETS[n], 'carpet');
  for (let i = 0; i < 4; i++)
    for (const z of [s.z0 - 0.1, s.z1 + 0.1]) hangingString(s.x0 + 0.4 + i * 0.8, z, 2.6, i + n);
});
// Goods on a 4 × 2 grid over each counter.
const stallSpots = (s: Stall) =>
  [0, 1, 2, 3].flatMap((i) => [0, 1].map((j) => ({ x: s.x0 + 0.4 + i * 0.8, z: s.z0 + 0.35 + j * 0.5, k: i * 2 + j })));
for (const { x, z, k } of stallSpots(HALL_STALLS[0])) spiceCone(x, COUNTER, z, SPICES[k % SPICES.length]);
for (const { x, z, k } of stallSpots(HALL_STALLS[1])) basketHeap(x, COUNTER, z, DRIED[k % DRIED.length]);
for (const { x, z, k } of stallSpots(HALL_STALLS[2])) breadStack(x, COUNTER, z, 3 + (k % 3));
for (const { x, z, k } of stallSpots(HALL_STALLS[3])) {
  if (z > 2.8) {
    // Back row: jars and blue plates stood on edge.
    if (k % 4 === 1) f.jar(x, z, { base: COUNTER, r: 0.15, h: 0.4, color: TERRACOTTA });
    else lying(f, x, COUNTER + 0.18, z, 0.18, 0.02, 'z', GLAZE_BLUE, 'marble', 16);
  } else if (k % 4 === 0) teapot(x, COUNTER, z);
  else for (let i = 0; i < 3 + (k % 3); i++) piala(x, COUNTER + i * 0.04, z, i % 2 ? GLAZE_BLUE : GLAZE_WHITE);
}

// The tea kiosk: a brass band, the samovar, a tray of teapots and bowls, a stack of bowls.
deco(-1.22, 1.22, 1.24, 1.3, -1.22, 1.22, BRASS, 'metal');
samovar(0.5, 1.55, -0.5);
decoCyl(-0.45, 1.55, 0.4, 0.34, 0.02, BRASS, 'metal', { sides: 20 });
teapot(-0.6, 1.57, 0.3);
teapot(-0.3, 1.57, 0.62, GLAZE_WHITE);
for (const [x, z] of [
  [-0.25, 0.2],
  [-0.62, 0.62],
  [-0.2, 0.42],
])
  piala(x, 1.57, z);
for (let i = 0; i < 5; i++) piala(0.7, 1.55 + i * 0.04, 0.65, i % 2 ? GLAZE_BLUE : GLAZE_WHITE);
decoCyl(0.25, 1.55, 0.8, 0.07, 0.08, GLAZE_BLUE, 'marble', { rTop: 0.06, sides: 12 });

// Tea-house corner (чайхана) in the south-east, clear of the east door: a topchan (a low
// wooden platform you step onto) under a carpet, cushions and bolsters along the walls, a low
// table with the tea things, a lantern and rugs on the walls.
f.solid(7.9, 9.8, 0.3, 0.45, 2.6, 4.8, WOOD, 'planks');
f.legs(7.95, 9.75, 2.65, 4.75, 0, 0.3, WOOD, 0.09);
f.rug(7.95, 9.75, 2.65, 4.75, CARPET_A, 0.45);
deco(9.3, 9.78, 0.47, 0.58, 2.7, 4.78, CARPET_B, 'fabric');
deco(7.95, 9.3, 0.47, 0.58, 4.3, 4.78, CARPET_D, 'fabric');
lying(f, 9.64, 0.68, 3.7, 0.1, 1.9, 'z', CARPET_C, 'fabric');
lying(f, 8.6, 0.68, 4.64, 0.1, 1.2, 'x', CARPET_C, 'fabric');
f.table(8.25, 9.05, 3.1, 3.9, { base: 0.45, color: BEAM, height: 0.3 });
teapot(8.45, 0.75, 3.3);
for (const [x, z] of [
  [8.8, 3.3],
  [8.45, 3.65],
  [8.9, 3.72],
])
  piala(x, 0.75, z);
breadStack(8.7, 0.75, 3.5, 2);
f.wallRug('s', 4.8, 7.9, 9.7, 0.9, 2.6, CARPET_B);
f.wallRug('e', 9.8, 2.7, 4.6, 0.9, 2.6, CARPET_D);
// Shoes left at the edge of the topchan.
for (const x of [8.2, 8.34, 8.9, 9.04]) deco(x, x + 0.1, 0.025, 0.08, 2.32, 2.54, LEATHER, 'leather');

// North-east corner: open sacks of spice against the walls, jars beside them.
[
  [9.2, 9.8, -4.8, -4.2],
  [8.6, 9.2, -4.8, -4.2],
  [9.2, 9.8, -4.2, -3.6],
].forEach(([x0, x1, z0, z1], i) => {
  f.solid(x0, x1, 0, 0.7, z0, z1, SACK, 'sack');
  deco(x0 + 0.03, x1 - 0.03, 0.62, 0.74, z0 + 0.03, z1 - 0.03, WICKER, 'sack');
  decoCyl((x0 + x1) / 2, 0.72, (z0 + z1) / 2, 0.22, 0.2, SPICES[i + 1], 'sand', { rTop: 0.03, sides: 12 });
});
f.jar(9.45, -3.3, { r: 0.22, h: 0.6, color: TERRACOTTA });
f.jar(9.5, -2.85, { r: 0.16, h: 0.45, color: CLAY_DARK });

// Lanterns under the balcony, between the beams.
for (const [x, z] of [
  [-5, 0],
  [5, 0],
  [-1, -3.3],
  [1, 3.3],
  [8.7, 3.6],
  [9, -4.1],
])
  f.lantern(x, 2.35, z, { hang: 3.37 });

// The balcony: rugs, rolled carpets along the parapet, a stack of folded ones, sacks against
// the crates and carpets hung over the parapet.
f.rug(-1.4, 2.6, -1.6, 1.6, CARPET_C, UPPER);
f.rug(-6.6, -4.6, -1.4, 1.4, CARPET_D, UPPER);
for (const [x0, x1, face] of [
  [1.0, 2.8, -4.8],
  [-6.6, -4.8, 4.8],
] as const) {
  const s = face < 0 ? 1 : -1;
  lying(f, (x0 + x1) / 2, UPPER + 0.12, face + s * 0.14, 0.12, x1 - x0, 'x', CARPET_A, 'carpet');
  lying(f, (x0 + x1) / 2 + 0.05, UPPER + 0.12, face + s * 0.38, 0.12, x1 - x0 - 0.1, 'x', CARPET_B, 'carpet');
  lying(f, (x0 + x1) / 2 - 0.05, UPPER + 0.33, face + s * 0.26, 0.12, x1 - x0 - 0.2, 'x', CARPET_D, 'carpet');
}
f.boxes.push({ ...hidden(box(6.2, 7.6, UPPER, UPPER + 0.48, 4.0, 4.8, CARPET_B)), material: 'carpet' });
CARPETS.forEach((c, i) => deco(6.2 + (i % 2) * 0.04, 7.6 - (i % 2) * 0.03, UPPER + i * 0.12, UPPER + (i + 1) * 0.12, 4.0 + ((i + 1) % 2) * 0.03, 4.8, c, 'carpet'));
f.sack(4.8, -3.0, { base: UPPER, w: 0.6, d: 0.5 });
f.sack(-3.0, 3.75, { base: UPPER, w: 0.5, d: 0.5 });
f.sack(8.4, -0.25, { base: UPPER, w: 0.6, d: 0.5 });

/** A carpet hung over the upper parapet on `wall`: down the inner face, over the top, down the outside. */
function drapedRug(wall: 'n' | 's' | 'e' | 'w', a: number, b: number, color: string) {
  const top = 4.6;
  const inner = wall === 'n' ? -4.8 : wall === 's' ? 4.8 : wall === 'w' ? -9.8 : 9.8;
  const out = wall === 'n' || wall === 'w' ? -1 : 1;
  const outer = inner + out * HALL_T;
  const put = (d0: number, d1: number, y0: number, y1: number) => {
    const p = Math.min(d0, d1),
      q = Math.max(d0, d1);
    if (wall === 'n' || wall === 's') deco(a, b, y0, y1, p, q, color, 'carpet');
    else deco(p, q, y0, y1, a, b, color, 'carpet');
  };
  put(inner, inner - out * 0.02, UPPER + 0.2, top + 0.02);
  put(inner - out * 0.02, outer + out * 0.03, top, top + 0.02);
  put(outer, outer + out * 0.03, top - 0.9, top + 0.02);
}
drapedRug('n', -8.8, -7.0, CARPET_A);
drapedRug('n', -4.2, -2.4, CARPET_C);
drapedRug('n', 6.2, 8.0, CARPET_B);
drapedRug('s', -4.3, -2.5, CARPET_D);
drapedRug('s', 2.0, 3.8, CARPET_A);
drapedRug('e', -3.8, -2.0, CARPET_C);
drapedRug('e', 2.0, 3.8, CARPET_B);
drapedRug('w', -4.3, -2.5, CARPET_D);

// Lanterns under the roof hang only where nobody stands upright under them: over the crates
// and over the stairwell (the beams are at odd x).
for (const [x, z] of [
  [-3.35, -3],
  [-3.35, 3],
  [4, -3],
  [4, 3],
  [7.6, 0],
  [-8, -2.5],
  [-8, 1],
])
  f.lantern(x, 5.62, z, { hang: 5.97 });

// ─── North lane: Торговые ряды ──────────────────────────────────────────────────
const STALL_ROWS = [
  { x0: -17, x1: -7, left: RED_CLOTH, right: SAFFRON },
  { x0: -4, x1: 4, left: TEAL_CLOTH, right: VIOLET },
  { x0: 7, x1: 17, left: SAFFRON, right: RED_CLOTH },
];
const BOARD = 1.2; // top of the goods board on the counters

const stallRow = (x0: number, x1: number, left: string, right: string): MapBox[] => {
  const mid = (x0 + x1) / 2;
  return [
    box(x0, x1, 0, 1.1, -16.6, -15.4, WOOD, 'wood'), // counter
    sheet(x0, x1, 1.1, BOARD, -16.6, -15.4, WOOD_LIGHT, 'planks'), // goods board
    sheet(x0 - 0.4, mid, 2.8, 2.95, -17.1, -14.8, left, 'awning'), // awning
    sheet(mid, x1 + 0.4, 2.8, 2.95, -17.1, -14.8, right, 'awning'),
    ...[x0 + 0.2, mid, x1 - 0.2].flatMap((px) => [post(px, -16.91, 2.8), post(px, -14.89, 2.8)]),
  ];
};

const northLane: MapBox[] = [
  ...STALL_ROWS.flatMap(({ x0, x1, left, right }) => stallRow(x0, x1, left, right)),
  // Crate stacks in front of the rows: the second line of cover.
  crate(-12.4, -10.4, 1.2),
  crate(-12.4, -10.4, 0.9, 1.2),
  crate(-11.1, -10.5, 1.0),
  crate(-12.0, -9.4, 1.0),
  box(-10.8, -10.0, 0, 0.7, -9.8, -9.0, SACK, 'sack'),
  crate(-0.6, -10.4, 1.2),
  crate(-0.6, -10.4, 0.9, 1.2),
  crate(0.7, -10.0, 1.0),
  box(-0.4, 0.4, 0, 0.7, -9.3, -8.7, SACK, 'sack'),
  crate(12.4, -10.4, 1.2),
  crate(12.4, -10.4, 0.9, 1.2),
  crate(11.1, -10.5, 1.0),
  crate(12.0, -9.4, 1.0),
  box(10.0, 10.8, 0, 0.7, -9.8, -9.0, SACK, 'sack'),
  // Back alley behind the rows (z −19.4..−17): a flank route with a little cover.
  crate(-20.0, -18.3, 1.0),
  crate(-5.5, -18.3, 1.0),
  crate(9.0, -18.3, 1.0),
  crate(20.0, -18.3, 1.0),
  // Carpets spread out for sale on the ground.
  sheet(-24, -18, 0.02, 0.06, -14.5, -11.5, CARPET_A, 'carpet'),
  sheet(18, 24, 0.02, 0.06, -14.5, -11.5, CARPET_B, 'carpet'),
];

STALL_ROWS.forEach(({ x0, x1, left, right }, n) => {
  const mid = (x0 + x1) / 2;
  // Valances along the awning's front edge, kilims over the counter front and back.
  deco(x0 - 0.4, mid, 2.62, 2.8, -14.82, -14.8, left, 'awning');
  deco(mid, x1 + 0.4, 2.62, 2.8, -14.82, -14.8, right, 'awning');
  deco(x0 + 0.2, mid - 0.3, 0.12, 1.04, -15.4, -15.37, CARPETS[n], 'carpet');
  deco(mid + 0.3, x1 - 0.2, 0.12, 1.04, -15.4, -15.37, CARPETS[n + 1], 'carpet');
  deco(x0 + 0.4, x1 - 0.4, 0.2, 1.04, -16.63, -16.6, CARPETS[(n + 2) % 4], 'carpet');
  // Strings of chillies, garlic and apricots from the awning, over the counter.
  for (let x = x0 + 0.5, k = n; x < x1 - 0.3; x += 1.15, k++) hangingString(x, -16.3, 2.8, k);
  // A lantern on a bracket off the middle front post.
  deco(mid - 0.02, mid + 0.02, 2.6, 2.65, -14.8, -14.56, IRON, 'metal');
  f.lantern(mid, 2.2, -14.58, { hang: 2.62 });
});

// Goods on the boards between the melons: fruit pyramids, spice trays and, in the middle row,
// rolled carpets.
for (const x of [-16.2, -13.25, -10.75, 0, 10.75, 13.25, 16.2]) fruitPyramid(x, BOARD, -16, FRUIT[Math.abs(Math.round(x)) % FRUIT.length]);
[-8.4, -7.7, -3.5, -2.8, 7.7, 8.4].forEach((x, i) => {
  spiceCone(x, BOARD, -16.25, SPICES[i % SPICES.length], 0.14);
  spiceCone(x, BOARD, -15.75, SPICES[(i + 3) % SPICES.length], 0.14);
});
for (let i = 0; i < 7; i++) lying(f, 2.3 + i * 0.2, BOARD + 0.09, -16, 0.09, 1.0, 'z', CARPETS[i % 4], 'carpet');
for (let i = 0; i < 3; i++) lying(f, 2.5 + i * 0.3, BOARD + 0.26, -16, 0.09, 1.0, 'z', CARPETS[(i + 2) % 4], 'carpet');

// Back alley: jars and baskets against the north wall.
for (const x of [-14, -1.5, 4.5, 14]) {
  f.jar(x, -19.05, { r: 0.26, h: 0.62, color: TERRACOTTA });
  f.jar(x + 0.6, -19.12, { r: 0.2, h: 0.5, color: CLAY_DARK });
  decoCyl(x - 0.6, 0, -19.1, 0.22, 0.32, WICKER, 'fabric', { rTop: 0.27, sides: 14 });
}

// Rolled carpets piled at the edge of the carpets on the ground: low enough to step onto.
for (const s of [-1, 1]) {
  const x0 = Math.min(s * 23.8, s * 22.2),
    x1 = Math.max(s * 23.8, s * 22.2);
  f.boxes.push({ ...hidden(box(x0, x1, 0.06, 0.5, -14.4, -13.84, CARPET_C)), material: 'carpet' });
  lying(f, (x0 + x1) / 2, 0.18, -14.26, 0.12, x1 - x0, 'x', CARPET_C, 'carpet');
  lying(f, (x0 + x1) / 2, 0.18, -13.98, 0.12, x1 - x0 - 0.1, 'x', CARPET_D, 'carpet');
  lying(f, (x0 + x1) / 2, 0.38, -14.12, 0.12, x1 - x0 - 0.2, 'x', CARPET_A, 'carpet');
}

// ─── South lane: Набережная, the river and the bridge ───────────────────────────
// Water is decoration; the 1.2 m stone banks are what keeps players out of it,
// so the bridge (x −2..2, railed) is the only way to the pier.
const BANK_TOP = 1.2;
const DECK = 0.45;

const southLane: MapBox[] = [
  sheet(-29.4, 29.4, 0, 0.06, 5, 9.8, PAVING, 'paving'), // paved embankment
  box(-20, -16, 0, 1.1, 7.2, 7.8, STONE_DARK, 'ashlar'),
  box(16, 20, 0, 1.1, 7.2, 7.8, STONE_DARK, 'ashlar'),
  crate(-6.5, 7.4, 1.0),
  crate(6.5, 7.4, 1.0),
  crate(-24.5, 6.6, 1.2),
  crate(24.5, 6.6, 1.2),
  box(-13.4, -12.6, 0, 0.8, 8.2, 9.0, SACK, 'sack'),
  box(12.6, 13.4, 0, 0.8, 8.2, 9.0, SACK, 'sack'),
  // River banks, open only where the bridge crosses.
  box(-29.8, -2, 0, BANK_TOP, 9.8, 10.2, STONE, 'ashlar'),
  box(2, 29.8, 0, BANK_TOP, 9.8, 10.2, STONE, 'ashlar'),
  box(-29.8, -2, 0, BANK_TOP, 15.8, 16.2, STONE, 'ashlar'),
  box(2, 29.8, 0, BANK_TOP, 15.8, 16.2, STONE, 'ashlar'),
  // Bridge: deck one step up, railings on both sides (drawn as posts and rails below).
  slab(-2, 2, 9, 17, DECK, WOOD, 'planks'),
  hidden(box(2.0, 2.2, DECK, DECK + 1.0, 9, 17, WOOD_LIGHT, 'wood')),
  hidden(box(-2.2, -2.0, DECK, DECK + 1.0, 9, 17, WOOD_LIGHT, 'wood')),
  // Pier: reachable over the bridge only, walled in chest-high.
  slab(-6, 6, 16.2, 19.4, DECK, WOOD, 'planks'),
  box(-6, 6, DECK, DECK + 0.8, 19.1, 19.4, STONE_DARK, 'ashlar'),
  box(-6, -5.7, DECK, DECK + 0.8, 16.2, 19.4, STONE_DARK, 'ashlar'),
  box(5.7, 6, DECK, DECK + 0.8, 16.2, 19.4, STONE_DARK, 'ashlar'),
  box(-6, -2, DECK, DECK + 0.8, 16.2, 16.5, STONE_DARK, 'ashlar'),
  box(2, 6, DECK, DECK + 0.8, 16.2, 16.5, STONE_DARK, 'ashlar'),
  crate(-4.2, 18.2, 1.0, DECK),
  crate(4.2, 18.2, 1.0, DECK),
  sheet(-1.6, 1.6, DECK + 0.02, DECK + 0.06, 11, 15, CARPET_A, 'carpet'),
];

/** An iron lamp post from `base` with a lantern on top. */
function lampPost(x: number, z: number, base: number, top = 2.9) {
  decoCyl(x, base, z, 0.1, 0.12, IRON, 'metal', { sides: 10 });
  decoCyl(x, base, z, 0.045, top - base, IRON, 'metal', { sides: 8 });
  f.lantern(x, top, z);
}

// Bridge railings: posts every metre, a handrail and a middle rail over the hidden colliders.
for (const x of [-2.1, 2.1]) {
  for (let z = 9.05; z < 17; z += 0.9875) deco(x - 0.05, x + 0.05, DECK, DECK + 1.05, z - 0.05, z + 0.05, WOOD_LIGHT, 'wood');
  deco(x - 0.07, x + 0.07, DECK + 0.95, DECK + 1.07, 9, 17, WOOD_LIGHT, 'wood');
  deco(x - 0.03, x + 0.03, DECK + 0.45, DECK + 0.52, 9, 17, WOOD_LIGHT, 'wood');
  lampPost(x, 9.05, DECK);
  lampPost(x, 16.95, DECK);
}
// Lamps on the low walls and the far corners of the pier.
lampPost(-18, 7.5, 1.1);
lampPost(18, 7.5, 1.1);
lampPost(-5.85, 19.25, DECK + 0.8);
lampPost(5.85, 19.25, DECK + 0.8);
// Stone copings on the low walls.
for (const s of [-1, 1]) deco(Math.min(s * 15.95, s * 20.05), Math.max(s * 15.95, s * 20.05), 1.1, 1.17, 7.15, 7.85, STONE, 'ashlar');

// Benches: against the hall's south wall and along the low walls (seats low enough to step on).
for (const s of [-1, 1]) {
  f.bench(Math.min(s * 5.3, s * 7.3), Math.max(s * 5.3, s * 7.3), 5.22, 5.62, { color: WOOD });
  f.bench(Math.min(s * 16.6, s * 19.4), Math.max(s * 16.6, s * 19.4), 6.8, 7.2, { color: WOOD });
}

// Bollards on the quay and mooring rings on its river face.
for (const x of [-23, -17, -11, -5, 5, 11, 17, 23]) {
  decoCyl(x, BANK_TOP, 10, 0.1, 0.28, IRON, 'metal', { rTop: 0.08, sides: 10 });
  decoCyl(x, BANK_TOP + 0.28, 10, 0.13, 0.05, IRON, 'metal', { sides: 10 });
  lying(f, x, 0.75, 10.21, 0.09, 0.02, 'z', IRON, 'metal', 10);
  lying(f, x, 0.75, 10.215, 0.06, 0.02, 'z', STONE, 'ashlar', 10);
}
// The pier: bollards on its walls, sacks against the crates, rope coils, a net over the wall.
for (const [x, z] of [
  [-5.85, 17.5],
  [5.85, 17.5],
  [-2.5, 19.25],
  [2.5, 19.25],
]) {
  decoCyl(x, DECK + 0.8, z, 0.1, 0.25, IRON, 'metal', { rTop: 0.08, sides: 10 });
  decoCyl(x, DECK + 1.05, z, 0.13, 0.05, IRON, 'metal', { sides: 10 });
}
f.sack(-3.4, 18.2, { base: DECK, w: 0.6, d: 0.5 });
f.sack(3.4, 18.35, { base: DECK, w: 0.6, d: 0.5 });
for (const [x, z] of [
  [-1.4, 18.75],
  [4.9, 17.0],
])
  decoCyl(x, DECK, z, 0.24, 0.07, ROPE, 'fabric', { sides: 16 });
// The pier's south wall backs onto the perimeter wall, so the net only covers its face and top.
deco(-1.8, 0.8, DECK + 0.3, DECK + 0.82, 19.07, 19.1, '#8a8266', 'fabric');
deco(-1.8, 0.8, DECK + 0.8, DECK + 0.82, 19.1, 19.4, '#8a8266', 'fabric');

// A rowing boat moored west of the pier: decoration on the water, nobody can reach it.
{
  const x0 = -10.6,
    x1 = -7.6,
    z = 17.5,
    half = 0.55,
    y0 = 0.12,
    y1 = 0.55;
  deco(x0, x1, y0, y0 + 0.08, z - half + 0.05, z + half - 0.05, WOOD, 'planks');
  for (const s of [-1, 1]) {
    const zs = z + s * (half - 0.03);
    deco(x0, x1, y0, y1, zs - 0.03, zs + 0.03, WOOD, 'planks');
    deco(x0, x1, y1 - 0.08, y1 + 0.02, zs - 0.04, zs + 0.04, TEAL_CLOTH, 'wood');
    // Bow planks meeting in the stem.
    const len = Math.hypot(0.6, half);
    f.decor.push({ x: x1 + 0.3, y: (y0 + y1) / 2, z: z + (s * half) / 2, w: len, h: y1 - y0, d: 0.06, color: WOOD, material: 'planks', rot: [0, s * Math.atan2(half, 0.6), 0] });
  }
  deco(x0 - 0.06, x0, y0, y1, z - half, z + half, WOOD, 'planks');
  for (const x of [x0 + 0.7, x0 + 1.9]) deco(x - 0.12, x + 0.12, y1 - 0.14, y1 - 0.1, z - half, z + half, WOOD_LIGHT, 'planks');
  deco(x0 + 0.3, x1 - 0.1, y1 - 0.1, y1 - 0.06, z + 0.18, z + 0.23, WOOD_LIGHT, 'wood');
  deco(x1 - 0.5, x1 - 0.1, y1 - 0.1, y1 - 0.07, z + 0.1, z + 0.3, WOOD_LIGHT, 'wood');
  // The painter, from the bow up to the bollard on the pier wall.
  const dx = -5.85 - (x1 + 0.6),
    dy = DECK + 0.95 - y1;
  f.decor.push({ x: x1 + 0.6 + dx / 2, y: y1 + dy / 2, z, w: Math.hypot(dx, dy), h: 0.025, d: 0.025, color: ROPE, material: 'fabric', rot: [0, 0, Math.atan2(dy, dx)] });
}

// ─── Camps: caravan carts and crates at both spawn exits ────────────────────────
// Built for the blue camp and mirrored whole into the red one.
const camp = createFurnisher();
camp.boxes.push(
  crate(-22.6, -6.0, 1.2),
  crate(-22.6, -6.0, 0.9, 1.2),
  crate(-22.6, 6.0, 1.2),
  crate(-22.6, 6.0, 0.9, 1.2),
  crate(-22.2, 0, 1.0),
  box(-26.6, -25.8, 0, 0.7, -3.4, -2.6, SACK, 'sack'),
  box(-26.6, -25.8, 0, 0.7, 2.6, 3.4, SACK, 'sack'),
  sheet(-29.2, -23.0, 3.0, 3.15, -7.2, 7.2, VIOLET, 'canvas'), // camp canopy
  post(-29.0, -7.0, 3.0),
  post(-29.0, 7.0, 3.0),
  post(-23.2, -7.0, 3.0),
  post(-23.2, 7.0, 3.0),
  sheet(-27.5, -24.5, 0.02, 0.06, -1.5, 1.5, CARPET_B, 'carpet'),
);
camp.barrel(-26.5, -2.2, { r: 0.45, h: 1.0, color: WOOD });
camp.barrel(-26.5, 2.2, { r: 0.45, h: 1.0, color: WOOD });

// Caravan carts (арба): a solid bed with a tall headboard by the wall, two big wheels, a load
// of sacks and felt, water skins hung on the headboard.
for (const [z0, z1] of [
  [-9.2, -7.8],
  [7.8, 9.2],
]) {
  const zc = (z0 + z1) / 2;
  camp.solid(-28.0, -25.0, 0, 1.25, z0, z1, WOOD, 'wood');
  camp.solid(-28.0, -27.6, 1.25, 2.1, z0, z1, WOOD_LIGHT, 'wood');
  camp.deco(-27.6, -25.0, 1.25, 1.35, z0, z0 + 0.06, WOOD_LIGHT, 'wood');
  camp.deco(-27.6, -25.0, 1.25, 1.35, z1 - 0.06, z1, WOOD_LIGHT, 'wood');
  for (const z of [z0 - 0.08, z1 + 0.08]) wheel(camp, -26.2, 0.8, z, 0.8);
  camp.deco(-27.5, -26.8, 1.25, 1.62, z0 + 0.15, z0 + 0.65, SACK, 'sack');
  camp.deco(-26.7, -26.0, 1.25, 1.58, z0 + 0.2, z0 + 0.7, SACK, 'sack');
  camp.deco(-27.4, -26.6, 1.25, 1.55, z1 - 0.65, z1 - 0.15, SACK, 'sack');
  lying(camp, -25.6, 1.4, zc, 0.15, 1.2, 'z', FELT, 'felt');
  camp.deco(-27.6, -27.48, 1.4, 1.95, zc - 0.45, zc - 0.15, LEATHER, 'leather');
  camp.deco(-27.6, -27.5, 1.45, 1.9, zc + 0.1, zc + 0.35, LEATHER, 'leather');
}

// A hitching rail (коновязь) against the west wall, with a bucket at its foot.
camp.boxes.push(hidden(box(-29.4, -29.1, 0, 1.1, -12.8, -10.6, WOOD, 'wood')));
for (const z of [-12.72, -10.68]) camp.deco(-29.32, -29.18, 0, 1.15, z - 0.07, z + 0.07, WOOD, 'wood');
camp.deco(-29.3, -29.2, 0.95, 1.05, -12.8, -10.6, WOOD, 'wood');
camp.decoCyl(-29.25, 0, -11.6, 0.14, 0.26, WOOD_LIGHT, 'wood', { rTop: 0.16, sides: 12 });

// Campfire in the corner, off every route: soil, a ring of stones, crossed logs, embers,
// flames and a cauldron on a tripod. Its collider keeps players out of the flames; logs and a
// stump round it are seats low enough to step onto.
const FIRE = { x: -26.6, z: -16.4 };
camp.cover(FIRE.x - 1.8, FIRE.x + 1.8, FIRE.z - 1.6, FIRE.z + 1.6, 0, SOIL, 'soil', 0.02);
camp.boxes.push(hidden(box(FIRE.x - 0.6, FIRE.x + 0.6, 0, 0.9, FIRE.z - 0.6, FIRE.z + 0.6, STONE_DARK, 'rock')));
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2;
  camp.spheres.push({ x: FIRE.x + Math.cos(a) * 0.52, y: 0.04, z: FIRE.z + Math.sin(a) * 0.52, r: 0.12, color: STONE_DARK, material: 'rock' });
}
camp.deco(FIRE.x - 0.3, FIRE.x + 0.3, 0.02, 0.06, FIRE.z - 0.3, FIRE.z + 0.3, EMBER, undefined, 2.2);
camp.deco(FIRE.x - 0.34, FIRE.x + 0.34, 0.04, 0.16, FIRE.z - 0.06, FIRE.z + 0.06, BEAM, 'bark');
camp.deco(FIRE.x - 0.06, FIRE.x + 0.06, 0.12, 0.24, FIRE.z - 0.34, FIRE.z + 0.34, BEAM, 'bark');
camp.decoCyl(FIRE.x, 0.06, FIRE.z, 0.16, 0.4, FLAME, undefined, { rTop: 0.02, glow: 2.2, sides: 7 });
camp.decoCyl(FIRE.x + 0.1, 0.06, FIRE.z - 0.08, 0.09, 0.26, EMBER, undefined, { rTop: 0.01, glow: 2.2, sides: 6 });
camp.decoCyl(FIRE.x, 0.5, FIRE.z, 0.2, 0.28, IRON, 'metal', { rTop: 0.27, sides: 12 });
camp.decoCyl(FIRE.x, 0.78, FIRE.z, 0.008, 0.52, IRON, 'metal', { sides: 4 });
for (let i = 0; i < 3; i++) {
  const psi = (i / 3) * Math.PI * 2 + 0.4,
    spread = 0.55,
    apex = 1.3,
    length = Math.hypot(spread, apex);
  camp.decor.push({
    x: FIRE.x + (Math.cos(psi) * spread) / 2,
    y: apex / 2,
    z: FIRE.z + (Math.sin(psi) * spread) / 2,
    w: 0.05,
    h: length,
    d: 0.05,
    color: BEAM,
    material: 'wood',
    rot: [Math.atan2(-spread * Math.sin(psi), apex), 0, Math.asin((spread * Math.cos(psi)) / length)],
  });
}
camp.solid(FIRE.x - 0.8, FIRE.x + 0.8, 0, 0.35, FIRE.z + 1.05, FIRE.z + 1.4, BEAM, 'bark');
camp.solid(FIRE.x + 1.05, FIRE.x + 1.4, 0, 0.35, FIRE.z - 0.8, FIRE.z + 0.8, BEAM, 'bark');
camp.stump(FIRE.x - 1.25, FIRE.z + 0.9);
camp.lights.push({ x: FIRE.x, y: 0.9, z: FIRE.z, color: '#ffb060', intensity: 8, distance: 10 });

// Team colours: lantern glass under each canopy and pennants along its inner edge.
for (const [s, glass, flag] of [
  [-1, '#9ecbff', CARPET_B],
  [1, '#ff9e9e', CARPET_A],
] as const) {
  f.lantern(s * 26.1, 2.35, 0, { hang: 3.0, color: glass });
  for (let z = -6.3; z <= 6.4; z += 1.8) deco(Math.min(s * 23.0, s * 23.03), Math.max(s * 23.0, s * 23.03), 2.5, 3.0, z - 0.2, z + 0.2, flag, 'fabric');
}

// ─── Yurts at the spawn exits ───────────────────────────────────────────────────
// The felt wall is the collider; the ornament band, the cone roof with its shanyrak and
// straps, and the painted door (south, towards the embankment) are drawn only.
const yurtWalls: MapCylinder[] = [];
function yurt(x: number) {
  yurtWalls.push({ x, y: 1.1, z: 0, r: 2, h: 2.2, color: FELT, solid: true, sides: 16, material: 'felt' });
  decoCyl(x, 0, 0, 2.04, 0.14, WOOD, 'wood', { sides: 16 });
  decoCyl(x, 0.9, 0, 2.02, 0.05, ROPE, 'fabric', { sides: 16 });
  decoCyl(x, 1.5, 0, 2.03, 0.32, CARPET_A, 'carpet', { sides: 16 });
  decoCyl(x, 2.2, 0, 2.15, 1.25, FELT, 'felt', { rTop: 0.45, sides: 16 });
  decoCyl(x, 3.45, 0, 0.5, 0.1, WOOD, 'wood', { sides: 16 });
  decoCyl(x, 3.46, 0, 0.4, 0.1, DOOR_WOOD, 'wood', { sides: 16 });
  for (const along of ['x', 'z'] as const)
    for (const off of [-0.14, 0.14])
      if (along === 'x') deco(x - 0.44, x + 0.44, 3.55, 3.6, off - 0.03, off + 0.03, WOOD, 'wood');
      else deco(x + off - 0.03, x + off + 0.03, 3.55, 3.6, -0.44, 0.44, WOOD, 'wood');
  // Straps down the roof at the four quarters, lying just on the cone.
  const rise = 1.25,
    run = 2.15 - 0.45,
    slope = Math.atan2(rise, run);
  for (const psi of [0.25, 0.75, 1.25, 1.75].map((q) => q * Math.PI)) {
    const r = (2.15 + 0.45) / 2 + 0.03 * Math.sin(slope);
    f.decor.push({
      x: x + Math.cos(psi) * r,
      y: 2.2 + rise / 2 + 0.03 * Math.cos(slope),
      z: Math.sin(psi) * r,
      w: Math.hypot(rise, run),
      h: 0.03,
      d: 0.1,
      color: CARPET_A,
      material: 'fabric',
      rot: [0, Math.PI - psi, slope],
    });
  }
  // The door: a painted leaf with an ornament panel in a wooden frame, a lantern beside it.
  deco(x - 0.42, x + 0.42, 0.14, 1.55, 1.9, 2.04, CARPET_C, 'wood');
  deco(x - 0.3, x + 0.3, 0.35, 1.35, 2.04, 2.05, SAFFRON, 'carpet');
  deco(x - 0.52, x - 0.42, 0, 1.65, 1.88, 2.06, DOOR_WOOD, 'wood');
  deco(x + 0.42, x + 0.52, 0, 1.65, 1.88, 2.06, DOOR_WOOD, 'wood');
  deco(x - 0.52, x + 0.52, 1.55, 1.65, 1.88, 2.06, DOOR_WOOD, 'wood');
  // The felt wall is a 16-gon with a corner at +z, so off the door it is set back to z ≈ 1.87.
  f.lantern(x + 0.66, 1.45, 1.98);
  deco(x + 0.64, x + 0.68, 1.72, 1.76, 1.86, 1.98, IRON, 'metal');
}
yurt(-16);
yurt(16);

// ─── Ground, walls and clay pots ────────────────────────────────────────────────
// A paved strip down the stall rows, aprons at the hall doors, trodden dirt here and there —
// all thin enough that nobody trips.
cover(-17, 17, -14.3, -11.6, 0, PAVING, 'paving', 0.03);
cover(-1.6, 1.6, -7.4, -5.2, 0, PAVING, 'paving', 0.03);
cover(-13.8, -10.2, -1.6, 1.6, 0, PAVING, 'paving', 0.03);
cover(10.2, 13.8, -1.6, 1.6, 0, PAVING, 'paving', 0.03);
for (const [x0, x1, z0, z1] of [
  [-21.5, -18.8, 2.6, 4.4],
  [18.8, 21.5, -4.4, -2.6],
  [-7.0, -3.5, -8.8, -6.6],
  [3.0, 6.8, -8.4, -6.4],
  [-23.0, -20.0, -10.2, -8.4],
  [20.0, 23.0, -10.2, -8.4],
])
  cover(x0, x1, z0, z1, 0, SOIL, 'soil', 0.02);
// A darker adobe coping along the top of the perimeter wall.
deco(-30, 30, 4.0, 4.12, -20.05, -19.35, CLAY_DARK, 'adobe');
deco(-30, 30, 4.0, 4.12, 19.35, 20.05, CLAY_DARK, 'adobe');
deco(-30.05, -29.35, 4.0, 4.12, -20, 20, CLAY_DARK, 'adobe');
deco(29.35, 30.05, 4.0, 4.12, -20, 20, CLAY_DARK, 'adobe');

/** A big clay pot (хум): tapered body (its collider is the bottom radius), a flared rim. */
const pot = (x: number, z: number): MapCylinder => {
  decoCyl(x, 0.9, z, 0.36, 0.08, TERRACOTTA, 'adobe', { rTop: 0.42, sides: 12 });
  return { x, y: 0.45, z, r: 0.5, rTop: 0.36, h: 0.9, color: TERRACOTTA, solid: true, sides: 12, material: 'adobe' };
};
// Two of the pots by the hall are full of turmeric.
decoCyl(-8.5, 0.9, -7.5, 0.36, 0.34, SAFFRON, 'sand', { rTop: 0.03, sides: 12 });
decoCyl(8.5, 0.9, 7.5, 0.36, 0.34, SAFFRON, 'sand', { rTop: 0.03, sides: 12 });

const cylinders: MapCylinder[] = [
  ...yurtWalls,
  pot(-8.5, -7.5),
  pot(8.5, -7.5),
  pot(-8.5, 7.5),
  pot(8.5, 7.5),
  pot(-19.5, -13.5),
  pot(19.5, -13.5),
];

const spheres: MapSphere[] = [
  // Melons on the counters, river stones.
  ...[-14.5, -12, -9.5, -1.5, 1.5, 9.5, 12, 14.5].map((x) => ({ x, y: 1.35, z: -16, r: 0.26, color: MELON })),
  { x: -7.5, y: 0.3, z: 12.5, r: 0.6, color: STONE_DARK, material: 'rock' },
  { x: 9.0, y: 0.3, z: 13.5, r: 0.7, color: STONE_DARK, material: 'rock' },
  { x: 18.5, y: 0.3, z: 11.8, r: 0.5, color: STONE_DARK, material: 'rock' },
  { x: -20.0, y: 0.3, z: 14.2, r: 0.55, color: STONE_DARK, material: 'rock' },
];

const lights: MapLight[] = [
  // Lanterns off the middle posts of the stall rows.
  ...STALL_ROWS.map(({ x0, x1 }) => ({ x: (x0 + x1) / 2, y: 2.35, z: -14.58, color: LAMP, intensity: 9, distance: 13 })),
  // Hall: under the balcony, the tea-house corner, under the roof.
  { x: -5, y: 2.3, z: 0, color: LAMP, intensity: 10, distance: 14 },
  { x: 5, y: 2.3, z: 0, color: LAMP, intensity: 10, distance: 14 },
  { x: 8.7, y: 2.2, z: 3.6, color: LAMP, intensity: 6, distance: 9 },
  { x: -3.35, y: 5.3, z: 3, color: LAMP, intensity: 9, distance: 13 },
  { x: 4, y: 5.3, z: -3, color: LAMP, intensity: 9, distance: 13 },
  { x: -8, y: 5.4, z: 1, color: LAMP, intensity: 7, distance: 10 },
  // Lamp posts on the embankment, the bridge and the pier.
  { x: -18, y: 3.0, z: 7.5, color: LAMP, intensity: 8, distance: 12 },
  { x: 18, y: 3.0, z: 7.5, color: LAMP, intensity: 8, distance: 12 },
  { x: -2.1, y: 3.0, z: 9.05, color: LAMP, intensity: 8, distance: 12 },
  { x: 2.1, y: 3.0, z: 16.95, color: LAMP, intensity: 8, distance: 12 },
  { x: -5.85, y: 3.0, z: 19.25, color: LAMP, intensity: 7, distance: 10 },
  { x: 5.85, y: 3.0, z: 19.25, color: LAMP, intensity: 7, distance: 10 },
  // Yurt doors.
  { x: -15.34, y: 1.8, z: 2.5, color: LAMP, intensity: 6, distance: 9 },
  { x: 16.66, y: 1.8, z: 2.5, color: LAMP, intensity: 6, distance: 9 },
  // Team-tinted lanterns under the camp canopies.
  { x: -26.1, y: 2.5, z: 0, color: '#9ecbff', intensity: 8, distance: 12 },
  { x: 26.1, y: 2.5, z: 0, color: '#ff9e9e', intensity: 8, distance: 12 },
  // Campfires.
  ...camp.lights,
  ...mirrorX(camp.lights),
];

export const BAZAAR: ArenaDef = {
  id: 'bazaar',
  title: 'Базар',
  bounds: BOUNDS,
  groundColor: SAND,
  groundMaterial: 'sand',
  outsideColor: OUTSIDE,
  boxes: [
    ...textured(perimeterWalls(BOUNDS, 4, 0.6, CLAY), 'adobe'),
    ...hallWalls,
    ...rampSteps,
    ...hallProps,
    ...northLane,
    ...southLane,
    ...f.boxes,
    ...camp.boxes,
    ...mirrorX(camp.boxes),
  ],
  ramps: [
    {
      minX: RAMP.minX,
      maxX: RAMP.maxX,
      minZ: RAMP.from,
      maxZ: RAMP.to,
      axis: 'z',
      from: RAMP.from,
      to: RAMP.to,
      y0: 0,
      y1: UPPER,
      color: STONE,
      material: 'ashlar',
      steps: 18,
    },
  ],
  cylinders: [...cylinders, ...f.cylinders, ...camp.cylinders, ...mirrorX(camp.cylinders)],
  spheres: [...spheres, ...f.spheres, ...camp.spheres, ...mirrorX(camp.spheres)],
  // The river, plus the backwater on either side of the pier: the far shore is water,
  // so the only dry ground south of the banks is the pier itself.
  water: [
    { minX: -29.4, maxX: 29.4, minZ: 9.9, maxZ: 16.1, y: 0.22, color: WATER_BLUE },
    { minX: -29.4, maxX: -6, minZ: 15.9, maxZ: 19.4, y: 0.22, color: WATER_BLUE },
    { minX: 6, maxX: 29.4, minZ: 15.9, maxZ: 19.4, y: 0.22, color: WATER_BLUE },
  ],
  furnishings: [...f.decor, ...camp.decor, ...mirrorX(camp.decor)],
  furnishingCylinders: [...f.decorCylinders, ...camp.decorCylinders, ...mirrorX(camp.decorCylinders)],
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
