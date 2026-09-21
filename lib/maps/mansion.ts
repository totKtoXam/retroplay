import {
  perimeterWalls,
  type ArenaDef,
  type MapBox,
  type MapCylinder,
  type MapSphere,
  type MapWater,
  type SurfaceMaterial,
} from './types.ts';

// «Особняк» — team battle. Red holds the two-storey house in the west, blue starts in the
// "спецназ" corridor behind the east compound wall. Routes between them: the main gate and
// the paved plaza, the old sewer along the north wall, and a crawl hole in the east wall by
// the guard hut that only crouching or lying players fit through.
//
// Outdoors nothing stands closer than 1.3 m to anything else: an obstacle either touches its
// neighbour or leaves a real passage (tests/map-mansion.test.mjs checks every pair).

// --- palette -------------------------------------------------------------------------
const CREAM = '#e7dabb'; // outer plaster
const INNER = '#d8c7a2'; // partitions
const WOOD = '#6b4a2f'; // trim, stairs, furniture
const DECK = '#8a5f3c'; // floor slabs
const ROOF = '#a9472f';
const ROOF_TOP = '#8d3826';
const FENCE = '#c9bb9c'; // compound wall
const PAVE = '#9b9890';
const PAVE_LIGHT = '#b7b3a8';
const HEDGE = '#4c7f3d';
const WATER = '#2f6f9e';
const POOL = '#1d4f73';
const SEWER = '#77705f'; // old sewer brick
const SEWER_WATER = '#4b5a3c';
const PLANKS = '#8a6a4a'; // guard hut siding
const ROOF_TILE = '#9a4a33';
const SOIL = '#6b4f35';
const METAL = '#59626e';
const TILE_DARK = '#4d4c4a';
const TILE_LIGHT = '#cfc7b4';

// --- geometry constants --------------------------------------------------------------
const BOUNDS = { minX: -32, maxX: 32, minZ: -24, maxZ: 24 };
const WALL_T = 0.4; // house walls
const EAVES = 6.4; // top of the second-storey walls
const F2 = 3.6; // second floor level
const DOOR = 2.4; // door head height
const SILL = 1.0;
const LINTEL = 2.2; // ground-floor window head
const SILL2 = 4.6;
const LINTEL2 = 5.8; // second-floor window

// House grid lines (wall centres).
const XW = -26; // west outer wall
const XA = -18; // vending room | stair hall
const XB = -14.3; // west wing | foyer
const XE = -7; // east outer wall
const ZN = -16.6; // north outer wall
const ZNF = -12.3; // foyer north room
const Z1 = -7; // north room | middle room
const Z2 = 4.4; // middle room | south room
const ZSF = 8; // foyer south room
const ZS = 12; // south outer wall

// Compound.
const XGATE = 26; // east compound wall (blue corridor beyond it)
const TUN_S = -22; // service tunnel: inner face of its south wall
const TUN_H = 2.2;

/** One opening in a wall: the span [a, b] along the wall with a list of open y ranges. */
type Opening = { a: number; b: number; open: [number, number][] };

/**
 * Solid wall segments for a straight wall, cut by door/window openings.
 * `axis: 'z'` runs along z at x = `at`; `axis: 'x'` runs along x at z = `at`.
 */
function wallSegments(
  axis: 'x' | 'z',
  at: number,
  p0: number,
  p1: number,
  bottom: number,
  top: number,
  color: string,
  thickness = WALL_T,
  gaps: Opening[] = [],
): MapBox[] {
  const out: MapBox[] = [];
  const piece = (a: number, b: number, y0: number, y1: number) => {
    if (b - a < 1e-6 || y1 - y0 < 1e-6) return;
    out.push(
      axis === 'z'
        ? { x: at, y: (y0 + y1) / 2, z: (a + b) / 2, w: thickness, h: y1 - y0, d: b - a, color, solid: true }
        : { x: (a + b) / 2, y: (y0 + y1) / 2, z: at, w: b - a, h: y1 - y0, d: thickness, color, solid: true },
    );
  };
  let cursor = p0;
  for (const g of [...gaps].sort((m, n) => m.a - n.a)) {
    piece(cursor, g.a, bottom, top);
    let y = bottom;
    for (const [y0, y1] of g.open) {
      piece(g.a, g.b, y, y0);
      y = y1;
    }
    piece(g.a, g.b, y, top);
    cursor = g.b;
  }
  piece(cursor, p1, bottom, top);
  return out;
}

/** Walkable slab 0.2 m thick whose top is at `top` (its underside is a ceiling). */
const slab = (x0: number, x1: number, z0: number, z1: number, top: number, color = DECK): MapBox => ({
  x: (x0 + x1) / 2,
  y: top - 0.1,
  z: (z0 + z1) / 2,
  w: x1 - x0,
  h: 0.2,
  d: z1 - z0,
  color,
  floor: true,
});

/** Solid block given by its extents. */
const block = (
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  color: string,
): MapBox => ({
  x: (x0 + x1) / 2,
  y: (y0 + y1) / 2,
  z: (z0 + z1) / 2,
  w: x1 - x0,
  h: y1 - y0,
  d: z1 - z0,
  color,
  solid: true,
});

/** Flat paint on the ground (paving, tiles): decoration only. */
const paint = (
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  color: string,
  top = 0.04,
): MapBox => ({
  x: (x0 + x1) / 2,
  y: top / 2,
  z: (z0 + z1) / 2,
  w: x1 - x0,
  h: top,
  d: z1 - z0,
  color,
});

const windowGap = (a: number, b: number, both = true): Opening => ({
  a,
  b,
  open: both
    ? [
        [SILL, LINTEL],
        [SILL2, LINTEL2],
      ]
    : [[SILL, LINTEL]],
});

/** A second-floor window only (the ground floor below it stays wall or door). */
const upperWindow = (a: number, b: number): Opening => ({ a, b, open: [[SILL2, LINTEL2]] });

// --- the house -----------------------------------------------------------------------
const houseWalls: MapBox[] = [
  // West facade: back door into the north room, windows on both floors.
  ...wallSegments('z', XW, ZN, ZS, 0, EAVES, CREAM, WALL_T, [
    { a: -15, b: -13.3, open: [[0, DOOR]] },
    windowGap(-5, -3.6),
    windowGap(6, 7.4),
  ]),
  // North facade. The second-floor north-east room gets a second window on this side.
  ...wallSegments('x', ZN, XW, XE, 0, EAVES, CREAM, WALL_T, [
    windowGap(-23, -21.6),
    windowGap(-12.5, -11.1),
    upperWindow(-9.6, -8.2),
  ]),
  // South facade: door out of the south room; the second-floor south-east room gets a
  // second window on this side too.
  ...wallSegments('x', ZS, XW, XE, 0, EAVES, CREAM, WALL_T, [
    { a: -20, b: -18, open: [[0, DOOR]] },
    windowGap(-12.5, -11.1),
    upperWindow(-9.6, -8.2),
  ]),
  // East facade: veranda door with the balcony door above it, east door of the south-east room.
  // Both second-floor end rooms look out east over the garden to the fountain: the north-east
  // room through a window above the ground-floor one, the south-east room above its door.
  ...wallSegments('z', XE, ZN, ZS, 0, EAVES, CREAM, WALL_T, [
    windowGap(-14.5, -13.1),
    windowGap(-11, -9.6),
    windowGap(-8, -6.6),
    {
      a: -4,
      b: -0.4,
      open: [
        [0, DOOR],
        [F2 - 0.2, 6.0],
      ],
    },
    windowGap(3, 4.4),
    {
      a: 9,
      b: 10.7,
      open: [
        [0, DOOR],
        [SILL2, LINTEL2],
      ],
    },
  ]),

  // West wing | foyer. Ground: north room and stair hall doors, south room to the SE room.
  // Second floor: the dark corridor opens onto the gallery.
  ...wallSegments('z', XB, ZN, ZS, 0, EAVES, INNER, WALL_T, [
    {
      a: -10,
      b: -8.6,
      open: [
        [0, DOOR],
        [F2, 6.0],
      ],
    },
    { a: 2.6, b: Z2, open: [[0, DOOR]] },
    { a: 9.4, b: 10.8, open: [[0, DOOR]] },
  ]),
  // North room | middle room, and the same wall a floor up (room W2 | room M2).
  ...wallSegments('x', Z1, XW, XA, 0, EAVES, INNER, WALL_T, [
    {
      a: -23,
      b: -21.6,
      open: [
        [0, DOOR],
        [F2, 6.0],
      ],
    },
  ]),
  // Closes the dead space under the stairs; the stair top runs over it onto the second floor.
  ...wallSegments('x', Z1, XA, XB, 0, 3.2, INNER),
  // Middle room | south room (and above).
  ...wallSegments('x', Z2, XW, XA, 0, EAVES, INNER, WALL_T, [
    {
      a: -23,
      b: -21.6,
      open: [
        [0, DOOR],
        [F2, 6.0],
      ],
    },
  ]),
  // South side of the stairwell; upstairs it is the edge of the stair void.
  ...wallSegments('x', Z2, XA, XB, 0, EAVES, INNER),
  // Vending room | stair hall (door at the foot of the stairs).
  ...wallSegments('z', XA, Z1, Z2, 0, EAVES, INNER, WALL_T, [{ a: 2.6, b: Z2, open: [[0, DOOR]] }]),
  // Second floor only: west wall of the dark corridor, with a door into room W2.
  ...wallSegments('z', XA, ZNF, Z1, F2, EAVES, INNER, WALL_T, [{ a: -11.4, b: -10, open: [[F2, 6.0]] }]),
  // Second floor only: the dark corridor's door into the room above the north room.
  ...wallSegments('x', ZNF, XW, XB, F2, EAVES, INNER, WALL_T, [{ a: -17, b: -15.6, open: [[F2, 6.0]] }]),
  // Foyer | north end room (both floors).
  ...wallSegments('x', ZNF, XB, XE, 0, EAVES, INNER, WALL_T, [
    {
      a: -11,
      b: -9.6,
      open: [
        [0, DOOR],
        [F2, 6.0],
      ],
    },
  ]),
  // Foyer | south-east room (both floors).
  ...wallSegments('x', ZSF, XB, XE, 0, EAVES, INNER, WALL_T, [
    {
      a: -12,
      b: -10.6,
      open: [
        [0, DOOR],
        [F2, 6.0],
      ],
    },
  ]),
];

const houseFloors: MapBox[] = [
  // Second floor over the west wing, less the stair void (XA..XB, Z1..Z2).
  slab(XW, XB, ZN, Z1, F2),
  slab(XW, XA, Z1, Z2, F2),
  slab(XW, XB, Z2, ZS, F2),
  // Foyer: 2 m gallery around a double-height void, plus the end rooms.
  slab(XB, -12.1, ZNF, ZSF, F2),
  slab(-9.2, XE, ZNF, ZSF, F2),
  slab(-12.1, -9.2, ZNF, -10.1, F2),
  slab(-12.1, -9.2, 5.8, ZSF, F2),
  slab(XB, XE, ZN, ZNF, F2),
  slab(XB, XE, ZSF, ZS, F2),
  // Balcony over the veranda (reached through the gallery's east door).
  slab(XE, -3.5, -11, 6.6, F2, PAVE_LIGHT),
  // Roof.
  block(-26.4, -6.6, EAVES, 6.8, -17.1, 12.5, ROOF),
  block(-24.9, -8.1, 6.8, 7.1, -15.6, 11.0, ROOF_TOP),
];

const railings: MapBox[] = [
  // Gallery railings around the void.
  block(-12.175, -12.025, F2, F2 + 1, -10.1, 5.8, WOOD),
  block(-9.275, -9.125, F2, F2 + 1, -10.1, 5.8, WOOD),
  block(-12.1, -9.2, F2, F2 + 1, -10.175, -10.025, WOOD),
  block(-12.1, -9.2, F2, F2 + 1, 5.725, 5.875, WOOD),
  // Balcony parapet.
  block(-3.65, -3.5, F2, F2 + 1, -11, 6.6, CREAM),
  block(XE, -3.5, F2, F2 + 1, -11, -10.85, CREAM),
  block(XE, -3.5, F2, F2 + 1, 6.45, 6.6, CREAM),
];

// --- the staircase ------------------------------------------------------------------------
// One straight flight from the stair hall (z = Z2, ground) up to the second floor (z = Z1).
// It is drawn as steps; walking follows the smooth slope under them (MapRamp.steps).
const STAIR = { minX: -17.8, maxX: XB - 0.2, from: Z2, to: Z1, steps: 20 };
const stairRun = STAIR.from - STAIR.to;
const stairPitch = Math.atan2(F2, stairRun);
/** Height of the flight's slope at z. */
const stairY = (z: number) => (F2 * (STAIR.from - z)) / stairRun;

// --- interior --------------------------------------------------------------------------
// Solid parts of furniture (table tops, seats, bed frames, cabinets) go into `boxes` and block
// movement and shots; legs, cushions, frames, lamps and ceilings go into `decor`, which is
// drawn only. Anything solid and no higher than 0.55 m can be stepped onto, like in the hub.
const WALNUT = '#5a3a24';
const OAK = '#9a6b42';
const CEILING = '#efe7d8';
const LINEN = '#ece6d8';
const VELVET = '#6d2638';
const LEATHER = '#5b3620';
const FELT = '#2f6b44';
const GOLD = '#b8913a';
const SOOT = '#221d1a';
const RUG_RED = '#7c2c2c';
const RUG_BLUE = '#2d4a6d';
const RUG_GREEN = '#46603c';
const LEAF = '#3f6f37';
const POT = '#9b5b3b';

/** `hex` mixed toward white by `k` (0…1): cushions a shade lighter than their sofa. */
const lighten = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) + (255 - ((n >> shift) & 255)) * k);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
};

const decor: MapBox[] = [];
const decorCylinders: MapCylinder[] = [];

/** A decor box by its extents. */
const deco = (
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  color: string,
  material?: SurfaceMaterial,
) => decor.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2, w: x1 - x0, h: y1 - y0, d: z1 - z0, color, material });

/** A solid box with a surface material. */
const solid = (
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  color: string,
  material?: SurfaceMaterial,
): MapBox => ({ ...block(x0, x1, y0, y1, z0, z1, color), material });

/** A flat covering (floor finish, rug) lying on a surface at height `base`. */
const cover = (
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  base: number,
  color: string,
  material: SurfaceMaterial,
  h = 0.02,
): MapBox => ({ x: (x0 + x1) / 2, y: base + h / 2, z: (z0 + z1) / 2, w: x1 - x0, h, d: z1 - z0, color, material });

const legs = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, color: string, t = 0.07) => {
  for (const [x, z] of [
    [x0, z0],
    [x1 - t, z0],
    [x0, z1 - t],
    [x1 - t, z1 - t],
  ])
    deco(x, x + t, y0, y1, z, z + t, color, 'wood');
};

const interior: MapBox[] = [];

/** A table: solid top on decor legs. */
function table(x0: number, x1: number, z0: number, z1: number, base = 0, color = WALNUT, height = 0.76) {
  interior.push(solid(x0, x1, base + height - 0.06, base + height, z0, z1, color, 'wood'));
  legs(x0 + 0.06, x1 - 0.06, z0 + 0.06, z1 - 0.06, base, base + height - 0.06, color);
}

type Side = 'n' | 's' | 'e' | 'w';
/** A chair at (x, z) whose back is on `back` (the sitter faces the other way). */
function chair(x: number, z: number, back: Side, base = 0, color = WALNUT, seat = OAK) {
  const r = 0.22;
  interior.push(solid(x - r, x + r, base + 0.42, base + 0.47, z - r, z + r, seat, 'fabric'));
  legs(x - r, x + r, z - r, z + r, base, base + 0.42, color, 0.05);
  const t = 0.05;
  if (back === 'n') deco(x - r, x + r, base + 0.47, base + 1.0, z - r, z - r + t, color, 'wood');
  if (back === 's') deco(x - r, x + r, base + 0.47, base + 1.0, z + r - t, z + r, color, 'wood');
  if (back === 'w') deco(x - r, x - r + t, base + 0.47, base + 1.0, z - r, z + r, color, 'wood');
  if (back === 'e') deco(x + r - t, x + r, base + 0.47, base + 1.0, z - r, z + r, color, 'wood');
}

/** A sofa or armchair: solid seat, decor back, arms and cushions. */
function sofa(x0: number, x1: number, z0: number, z1: number, back: Side, base = 0, color = VELVET) {
  interior.push(solid(x0, x1, base, base + 0.42, z0, z1, color, 'fabric'));
  const t = 0.22;
  const along = back === 'n' || back === 's';
  if (back === 'n') deco(x0, x1, base + 0.42, base + 0.95, z0, z0 + t, color, 'fabric');
  if (back === 's') deco(x0, x1, base + 0.42, base + 0.95, z1 - t, z1, color, 'fabric');
  if (back === 'w') deco(x0, x0 + t, base + 0.42, base + 0.95, z0, z1, color, 'fabric');
  if (back === 'e') deco(x1 - t, x1, base + 0.42, base + 0.95, z0, z1, color, 'fabric');
  if (along) {
    deco(x0, x0 + 0.16, base + 0.42, base + 0.65, z0, z1, color, 'fabric');
    deco(x1 - 0.16, x1, base + 0.42, base + 0.65, z0, z1, color, 'fabric');
  } else {
    deco(x0, x1, base + 0.42, base + 0.65, z0, z0 + 0.16, color, 'fabric');
    deco(x0, x1, base + 0.42, base + 0.65, z1 - 0.16, z1, color, 'fabric');
  }
  // Cushions a shade lighter.
  const inset = 0.2;
  deco(x0 + inset, x1 - inset, base + 0.42, base + 0.5, z0 + inset, z1 - inset, lighten(color, 0.18), 'fabric');
}

/** A bed with its headboard on `head`. */
function bed(x0: number, x1: number, z0: number, z1: number, head: Side, base: number, blanket: string) {
  interior.push(solid(x0, x1, base, base + 0.4, z0, z1, WALNUT, 'wood'));
  deco(x0 + 0.05, x1 - 0.05, base + 0.4, base + 0.58, z0 + 0.05, z1 - 0.05, LINEN, 'fabric');
  const t = 0.08;
  if (head === 'w') {
    deco(x0 - t, x0, base, base + 1.15, z0, z1, WALNUT, 'wood');
    deco(x0 + 0.1, x0 + 0.55, base + 0.58, base + 0.72, z0 + 0.15, z1 - 0.15, LINEN, 'fabric');
    deco(x0 + 0.7, x1 - 0.02, base + 0.58, base + 0.64, z0 + 0.02, z1 - 0.02, blanket, 'fabric');
  } else if (head === 'e') {
    deco(x1, x1 + t, base, base + 1.15, z0, z1, WALNUT, 'wood');
    deco(x1 - 0.55, x1 - 0.1, base + 0.58, base + 0.72, z0 + 0.15, z1 - 0.15, LINEN, 'fabric');
    deco(x0 + 0.02, x1 - 0.7, base + 0.58, base + 0.64, z0 + 0.02, z1 - 0.02, blanket, 'fabric');
  } else if (head === 'n') {
    deco(x0, x1, base, base + 1.15, z0 - t, z0, WALNUT, 'wood');
    deco(x0 + 0.15, x1 - 0.15, base + 0.58, base + 0.72, z0 + 0.1, z0 + 0.55, LINEN, 'fabric');
    deco(x0 + 0.02, x1 - 0.02, base + 0.58, base + 0.64, z0 + 0.7, z1 - 0.02, blanket, 'fabric');
  } else {
    deco(x0, x1, base, base + 1.15, z1, z1 + t, WALNUT, 'wood');
    deco(x0 + 0.15, x1 - 0.15, base + 0.58, base + 0.72, z1 - 0.55, z1 - 0.1, LINEN, 'fabric');
    deco(x0 + 0.02, x1 - 0.02, base + 0.58, base + 0.64, z0 + 0.02, z1 - 0.7, blanket, 'fabric');
  }
}

/** A cabinet, sideboard or wardrobe with a darker top and a strip of handles on its `front`. */
function cabinet(x0: number, x1: number, z0: number, z1: number, height: number, front: Side, base = 0, color = OAK) {
  interior.push(solid(x0, x1, base, base + height, z0, z1, color, 'wood'));
  deco(x0 - 0.02, x1 + 0.02, base + height, base + height + 0.03, z0 - 0.02, z1 + 0.02, WALNUT, 'wood');
  const y = base + height * 0.7;
  if (front === 'e') deco(x1, x1 + 0.02, y, y + 0.04, z0 + 0.15, z1 - 0.15, GOLD, 'metal');
  if (front === 'w') deco(x0 - 0.02, x0, y, y + 0.04, z0 + 0.15, z1 - 0.15, GOLD, 'metal');
  if (front === 's') deco(x0 + 0.15, x1 - 0.15, y, y + 0.04, z1, z1 + 0.02, GOLD, 'metal');
  if (front === 'n') deco(x0 + 0.15, x1 - 0.15, y, y + 0.04, z0 - 0.02, z0, GOLD, 'metal');
}

/** A bookcase: solid carcass and a face of book spines on its `front`. */
function bookcase(x0: number, x1: number, z0: number, z1: number, height: number, front: Side, base = 0) {
  interior.push(solid(x0, x1, base, base + height, z0, z1, WALNUT, 'wood'));
  const i = 0.06;
  if (front === 'e') deco(x1, x1 + 0.01, base + 0.1, base + height - i, z0 + i, z1 - i, '#b59a7a', 'books');
  if (front === 'w') deco(x0 - 0.01, x0, base + 0.1, base + height - i, z0 + i, z1 - i, '#b59a7a', 'books');
  if (front === 's') deco(x0 + i, x1 - i, base + 0.1, base + height - i, z1, z1 + 0.01, '#b59a7a', 'books');
  if (front === 'n') deco(x0 + i, x1 - i, base + 0.1, base + height - i, z0 - 0.01, z0, '#b59a7a', 'books');
}

/** A framed painting hung on the wall face at `at` (x for 'e'/'w' walls, z for 'n'/'s'). */
function painting(side: Side, at: number, a: number, b: number, y0: number, y1: number, canvas: string) {
  const t = 0.04;
  if (side === 'n' || side === 's') {
    const s = side === 'n' ? 1 : -1;
    deco(a, b, y0, y1, Math.min(at, at + s * t), Math.max(at, at + s * t), GOLD, 'wood');
    deco(a + 0.08, b - 0.08, y0 + 0.08, y1 - 0.08, Math.min(at, at + s * (t + 0.01)), Math.max(at, at + s * (t + 0.01)), canvas, 'marble');
  } else {
    const s = side === 'w' ? 1 : -1;
    deco(Math.min(at, at + s * t), Math.max(at, at + s * t), y0, y1, a, b, GOLD, 'wood');
    deco(Math.min(at, at + s * (t + 0.01)), Math.max(at, at + s * (t + 0.01)), y0 + 0.08, y1 - 0.08, a + 0.08, b - 0.08, canvas, 'marble');
  }
}

/** A floor lamp or a table lamp (base at `base`). */
function lamp(x: number, z: number, base: number, height: number) {
  decorCylinders.push({ x, y: base + 0.02, z, r: 0.16, h: 0.04, color: SOOT, material: 'metal' });
  decorCylinders.push({ x, y: base + height / 2, z, r: 0.025, h: height, color: GOLD, material: 'metal' });
  decorCylinders.push({ x, y: base + height + 0.12, z, r: 0.22, h: 0.26, color: '#f4e4c1', material: 'fabric', sides: 12 });
}

/** A potted plant. */
function plant(x: number, z: number, base = 0, size = 1) {
  decorCylinders.push({ x, y: base + 0.2 * size, z, r: 0.22 * size, h: 0.4 * size, color: POT, sides: 10 });
  decorCylinders.push({ x, y: base + 0.75 * size, z, r: 0.34 * size, h: 0.7 * size, color: LEAF, sides: 7 });
  decorCylinders.push({ x, y: base + 1.2 * size, z, r: 0.2 * size, h: 0.35 * size, color: '#4d8042', sides: 6 });
}

/** A chandelier hanging from `top` down to `y`. */
function chandelier(x: number, z: number, y: number, top: number, r = 0.6) {
  decorCylinders.push({ x, y: (y + top) / 2, z, r: 0.02, h: top - y, color: GOLD, material: 'metal' });
  decorCylinders.push({ x, y, z, r, h: 0.06, color: GOLD, material: 'metal', sides: 12 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    decorCylinders.push({ x: x + Math.cos(a) * r, y: y + 0.12, z: z + Math.sin(a) * r, r: 0.07, h: 0.18, color: '#fff3d6', sides: 8 });
  }
}

// Ground floor. Finished floor over the whole footprint (it covers the door thresholds too),
// with tiles in the kitchen and marble in the foyer laid a hair higher.
interior.push(
  cover(XW - 0.2, XE + 0.2, ZN - 0.2, ZS + 0.2, 0, DECK, 'parquet', 0.025),
  cover(XW + 0.2, XA - 0.2, Z1 + 0.2, Z2 - 0.2, 0, '#d9d4c8', 'tile', 0.03),
  cover(XB + 0.2, XE - 0.2, ZNF + 0.2, ZSF - 0.2, 0, '#e8e2d4', 'checker', 0.03),
);
// Ceilings under the second-floor slabs (the foyer void stays open to the roof).
for (const [x0, x1, z0, z1] of [
  [XW, XB, ZN, Z1],
  [XW, XA, Z1, Z2],
  [XW, XB, Z2, ZS],
  [XB, XE, ZN, ZNF],
  [XB, XE, ZSF, ZS],
  [XB, -12.1, ZNF, ZSF],
  [-9.2, XE, ZNF, ZSF],
])
  deco(x0 + 0.2, x1 - 0.2, F2 - 0.23, F2 - 0.21, z0 + 0.2, z1 - 0.2, CEILING, 'plaster');
// And under the roof, over the second floor and the foyer void.
deco(XW + 0.2, XE - 0.2, EAVES - 0.03, EAVES - 0.01, ZN + 0.2, ZS - 0.2, CEILING, 'plaster');

// North room: the dining room (red spawns at -23/-14, -19/-14, -23/-10).
interior.push(cover(-23.4, -18.4, -13.9, -10.1, 0.025, RUG_RED, 'carpet'));
table(-22.3, -19.5, -12.5, -11.4);
chair(-21.6, -12.95, 'n');
chair(-20.2, -12.95, 'n');
chair(-21.6, -10.95, 's');
chair(-20.2, -10.95, 's');
chair(-18.95, -11.95, 'e');
sofa(-24.6, -23.6, -10.7, -8.3, 'w');
cabinet(-25.8, -25.3, -12.6, -10.8, 0.9, 'e');
lamp(-25.55, -12.3, 0.93, 0.35);
// Fireplace on the partition to the kitchen.
interior.push(solid(-20.2, -17.6, 0, 1.25, -7.85, -7.2, '#8a4a36', 'brick'));
deco(-19.7, -18.1, 0.05, 0.85, -7.87, -7.84, SOOT);
deco(-20.35, -17.45, 1.25, 1.33, -8.0, -7.2, '#e3ddd0', 'marble');
painting('s', -7.2, -19.6, -18.2, 1.7, 2.7, '#9fb7c9');
painting('n', ZN + 0.2, -20.4, -18.2, 1.3, 2.6, '#d6b77a');
chandelier(-20.9, -11.95, 2.7, F2 - 0.23, 0.45);

// Middle room: the kitchen, around the old vending machine.
interior.push(solid(-25.6, -24.8, 0, 2.0, -2.7, -1.3, '#b4302e'));
deco(-24.82, -24.79, 1.1, 1.8, -2.5, -1.5, '#e9f2f5', 'marble');
cabinet(-18.8, -18.2, -6.8, -1.2, 0.9, 'w', 0, '#dcd3c2');
deco(-18.85, -18.2, 0.9, 0.95, -6.8, -1.2, '#d9d6cf', 'marble');
deco(-18.55, -18.2, 1.5, 2.2, -6.8, -1.2, '#dcd3c2', 'wood');
interior.push(solid(-25.8, -25.1, 0, 1.9, -6.6, -5.8, '#e8ebee', 'metal'));
// Island (was the plain table) and a breakfast table between the spawns.
cabinet(-20.6, -19.4, 1.4, 2.6, 0.9, 'w', 0, '#dcd3c2');
deco(-20.7, -19.3, 0.9, 0.95, 1.3, 2.7, '#d9d6cf', 'marble');
table(-22.7, -21.3, -1.4, -0.5, 0, OAK);
chair(-23.2, -0.95, 'w', 0, OAK, OAK);
chair(-20.8, -0.95, 'e', 0, OAK, OAK);
chandelier(-22, -0.95, 2.6, F2 - 0.23, 0.3);

// South room: the drawing room with a billiard table.
interior.push(cover(-24.4, -20.8, 4.9, 7.9, 0.025, RUG_BLUE, 'carpet'));
sofa(-25.1, -24.1, 5.4, 7.6, 'w', 0, LEATHER);
table(-23.6, -22.8, 5.9, 7.1, 0, WALNUT, 0.45);
interior.push(solid(-21.5, -18.5, 0.62, 0.84, 7.4, 8.6, FELT, 'fabric'));
deco(-21.6, -18.4, 0.72, 0.88, 7.3, 7.42, WALNUT, 'wood');
deco(-21.6, -18.4, 0.72, 0.88, 8.58, 8.7, WALNUT, 'wood');
deco(-21.6, -21.48, 0.72, 0.88, 7.3, 8.7, WALNUT, 'wood');
deco(-18.52, -18.4, 0.72, 0.88, 7.3, 8.7, WALNUT, 'wood');
legs(-21.4, -18.6, 7.5, 8.5, 0, 0.62, WALNUT, 0.14);
bookcase(-15.1, -14.5, 5.0, 8.8, 2.3, 'w');
lamp(-24.6, 8.4, 0, 1.5);
painting('w', XW + 0.2, 8.2, 10.8, 1.3, 2.4, '#b98a5a');
chandelier(-20, 8, 2.7, F2 - 0.23, 0.4);

// Stair hall: a plant at the foot of the flight, handrails with balusters along both walls.
plant(-17.2, 3.8, 0.025, 0.8);
for (const x of [STAIR.minX + 0.08, STAIR.maxX - 0.08]) {
  const length = Math.hypot(stairRun, F2);
  decor.push({
    x,
    y: F2 / 2 + 0.9,
    z: (STAIR.from + STAIR.to) / 2,
    w: 0.07,
    h: 0.07,
    d: length,
    color: WALNUT,
    material: 'wood',
    rot: [stairPitch, 0, 0],
  });
  for (let z = STAIR.from - 0.4; z > STAIR.to + 0.2; z -= 0.6) {
    const y = stairY(z);
    deco(x - 0.02, x + 0.02, y, y + 0.9, z - 0.02, z + 0.02, WALNUT, 'wood');
  }
  deco(x - 0.05, x + 0.05, 0, 1.0, STAIR.from - 0.3, STAIR.from - 0.2, WALNUT, 'wood');
}

// Foyer: marble floor, a long table on a rug under the chandelier, the sideboard.
interior.push(cover(-12.8, -8.4, -4.6, 0.6, 0.03, RUG_RED, 'carpet'));
table(-11.6, -9.6, -3, -1, 0.03, WALNUT);
decorCylinders.push({ x: -10.6, y: 1.0, z: -2, r: 0.12, h: 0.45, color: '#2f5f8a', material: 'marble', sides: 12 });
cabinet(-8.2, -7.4, 2, 4.5, 0.9, 'w', 0.03, WALNUT);
lamp(-7.8, 2.6, 0.96, 0.4);
painting('w', XB + 0.2, -6.5, -3.5, 1.4, 3.1, '#8fb39a');
painting('e', XE - 0.2, 4.6, 6.8, 1.4, 2.8, '#c98b6d');
plant(-7.8, -5.0, 0.03);
plant(-7.8, 0.6, 0.03);
chandelier(-10.65, -2, 4.7, EAVES - 0.03, 0.9);

// North end room: the library.
interior.push(cover(-12.6, -8.4, -15.8, -13.0, 0.025, RUG_GREEN, 'carpet'));
bookcase(-14.1, -13.6, -16.2, -12.7, 2.4, 'e');
table(-11.0, -9.4, -16.3, -15.5, 0.025, WALNUT);
chair(-10.2, -15.0, 's');
sofa(-8.0, -7.2, -15.6, -13.6, 'e', 0.025, LEATHER);
lamp(-7.7, -12.9, 0.025, 1.5);

// South-east room: a music room (the old table stays as a low cabinet by the door).
cabinet(-13.4, -12.4, 9.2, 10.2, 0.9, 'e', 0, WALNUT);
interior.push(solid(-10.2, -8.4, 0, 1.25, 11.2, 11.8, SOOT, 'wood'));
deco(-10.1, -8.5, 0.72, 0.76, 10.95, 11.2, '#f3efe6', 'marble');
chair(-9.3, 10.75, 'n', 0, SOOT, SOOT);
plant(-7.7, 8.6, 0.025, 0.8);

// Second floor. Parquet on every slab.
for (const [x0, x1, z0, z1] of [
  [XW, XB, ZN, Z1],
  [XW, XA, Z1, Z2],
  [XW, XB, Z2, ZS],
  [XB, -12.1, ZNF, ZSF],
  [-9.2, XE, ZNF, ZSF],
  [-12.1, -9.2, ZNF, -10.1],
  [-12.1, -9.2, 5.8, ZSF],
  [XB, XE, ZN, ZNF],
  [XB, XE, ZSF, ZS],
])
  interior.push(cover(x0, x1, z0, z1, F2, DECK, 'parquet'));

// Room over the dining room: the master bedroom.
interior.push(cover(-24.4, -20.4, -16.0, -12.8, F2 + 0.02, RUG_RED, 'carpet'));
bed(-25.6, -23.4, -15.6, -13.6, 'w', F2, VELVET);
cabinet(-25.8, -25.3, -13.4, -12.8, 0.6, 'e', F2, WALNUT);
cabinet(-25.8, -25.3, -16.4, -15.8, 0.6, 'e', F2, WALNUT);
cabinet(-19.0, -17.4, -16.4, -15.8, 2.1, 's', F2, WALNUT);
lamp(-25.55, -13.1, F2 + 0.63, 0.3);
painting('s', ZNF - 0.2, -24.8, -23.2, F2 + 1.3, F2 + 2.2, '#cdb88a');

// Room W2 (beside the dark corridor): a study.
table(-25.5, -24.1, -11.8, -10.6, F2, WALNUT);
chair(-23.7, -11.2, 'e', F2);
bookcase(-21.0, -18.6, -12.1, -11.6, 2.2, 's', F2);

// Room M2: the sitting room (its TV cabinet was the plain block).
cabinet(-25.4, -24.4, -3, -1, 0.7, 'e', F2, WALNUT);
deco(-25.3, -25.2, F2 + 0.75, F2 + 1.5, -2.8, -1.2, SOOT, 'metal');
interior.push(cover(-23.6, -20.0, -3.6, 0.6, F2 + 0.02, RUG_BLUE, 'carpet'));
sofa(-21.2, -20.2, -3.2, -0.8, 'e', F2, VELVET);
table(-23.0, -22.0, -2.6, -1.4, F2, WALNUT, 0.45);
plant(-25.3, 3.4, F2, 0.9);

// Room S2: the guest bedroom.
bed(-21.5, -19.5, 9.8, 11.8, 's', F2, '#2d5c6b');
cabinet(-22.4, -21.8, 11.2, 11.8, 0.6, 'n', F2, WALNUT);
cabinet(-25.8, -25.2, 8.6, 10.6, 2.1, 'e', F2, WALNUT);
interior.push(cover(-22.0, -19.0, 7.6, 9.6, F2 + 0.02, RUG_GREEN, 'carpet'));
lamp(-22.1, 11.5, F2 + 0.63, 0.3);

// Gallery end rooms: a writing desk to the north, armchairs by the south-east window.
table(-13.8, -12.6, -16.3, -15.5, F2, OAK);
chair(-13.2, -15.0, 's', F2);
sofa(-8.2, -7.3, 10.6, 11.6, 'e', F2, LEATHER);
sofa(-12.4, -11.4, 11.0, 11.8, 's', F2, LEATHER);
plant(-7.7, 8.6, F2, 0.8);

const furniture: MapBox[] = [
  ...interior,
  // Chimney, through the pitched roof.
  solid(-22.5, -21.3, 6.8, 9.6, -10.6, -9.4, '#8a4a36', 'brick'),
];

/** A garden bench: a solid seat (low enough to step onto) with a decor back and legs. */
function bench(x0: number, x1: number, z0: number, z1: number, back: Side) {
  const seat = solid(x0, x1, 0.42, 0.5, z0, z1, OAK, 'wood');
  legs(x0 + 0.1, x1 - 0.1, z0 + 0.05, z1 - 0.05, 0, 0.42, SOOT, 0.08);
  if (back === 'n') deco(x0, x1, 0.5, 0.95, z0, z0 + 0.06, OAK, 'wood');
  if (back === 's') deco(x0, x1, 0.5, 0.95, z1 - 0.06, z1, OAK, 'wood');
  return seat;
}

const spheres: MapSphere[] = [];
/** A bush of flowers or leaves: drawn only, it hides nobody. */
const shrub = (x: number, z: number, r: number, color: string, y = r * 0.7) =>
  spheres.push({ x, y, z, r, color, material: 'foliage' });

/** A flower bed: soil and a row of flowering shrubs along it. */
function flowerBed(x0: number, x1: number, z0: number, z1: number) {
  const flowers = ['#c0506f', '#d9b23a', '#8a5fb0', '#e07a3c', '#d8d0c0'];
  const n = Math.max(3, Math.round((x1 - x0) / 1.2));
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) * (x1 - x0)) / n,
      z = (z0 + z1) / 2 + ((i % 2) - 0.5) * (z1 - z0) * 0.35;
    shrub(x, z, 0.42, i % 2 ? '#4a7a3a' : flowers[i % flowers.length], 0.3);
  }
  return { ...paint(x0, x1, z0, z1, SOIL, 0.05), material: 'soil' as const };
}

const props: MapBox[] = [
  // Garden benches. Planters by the veranda steps.
  bench(-4.5, -2.5, -21.5, -20.9, 'n'),
  bench(4, 6, 18.2, 18.8, 's'),
  bench(19, 21, -18.8, -18.2, 'n'),
  solid(-1.6, -0.8, 0, 0.8, -5.4, -4.6, PAVE_LIGHT, 'plaster'),
  solid(-1.6, -0.8, 0, 0.8, 0.6, 1.4, PAVE_LIGHT, 'plaster'),
  // Crates: cover by the guard hut (one stack, clear of the hut) and along the blue corridor.
  solid(21.8, 23, 0, 1.2, 14.2, 15.4, WOOD, 'wood'),
  solid(22, 23, 0, 0.9, 15.4, 16.3, WOOD, 'wood'),
  solid(30.3, 31.4, 0, 1.1, -4, -2.8, WOOD, 'wood'),
  solid(30.3, 31.4, 0, 1.1, 12, 13.2, WOOD, 'wood'),
  // Flower beds.
  flowerBed(-14, -8, -20, -17),
  flowerBed(10, 16, -20, -17),
  flowerBed(-14, -8, 17, 20),
  flowerBed(10, 16, 6, 9),
];
shrub(-1.2, -5, 0.5, '#4f8a3f', 1.15);
shrub(-1.2, 1, 0.5, '#4f8a3f', 1.15);

const verandaTiles: MapBox[] = [];
for (let i = 0; i < 2; i++)
  for (let j = 0; j < 8; j++)
    if ((i + j) % 2 === 0)
      verandaTiles.push(
        paint(XE + i * 1.75, XE + (i + 1) * 1.75, -11 + j * 2.2, -11 + (j + 1) * 2.2, TILE_DARK, 0.06),
      );

const veranda: MapBox[] = [{ ...paint(XE, -3.5, -11, 6.6, TILE_LIGHT), material: 'tile' }, ...verandaTiles.map((b): MapBox => ({ ...b, material: 'tile' }))];

// --- courtyard -----------------------------------------------------------------------
const PX = 6.7;
const PZ = -2;
const plaza: MapBox[] = [
  paint(PX - 8.3, PX + 8.3, PZ - 8.3, PZ + 8.3, PAVE_LIGHT, 0.03),
  paint(PX - 9.5, PX + 9.5, PZ - 6.6, PZ + 6.6, PAVE, 0.04),
  paint(PX - 6.6, PX + 6.6, PZ - 9.5, PZ + 9.5, PAVE, 0.05),
  // Path from the plaza out through the gate, and from the veranda to the plaza.
  paint(15.9, XGATE, -4, 1, PAVE, 0.05),
  paint(-3.5, PX - 8.3, -3.2, -0.8, PAVE, 0.04),
].map((b): MapBox => ({ ...b, material: 'paving' }));

const pool: MapBox[] = [
  // A low rim you can climb and hide behind.
  solid(PX - 4.8, PX + 4.8, 0, 0.5, PZ - 4.8, PZ - 4.3, PAVE_LIGHT, 'marble'),
  solid(PX - 4.8, PX + 4.8, 0, 0.5, PZ + 4.3, PZ + 4.8, PAVE_LIGHT, 'marble'),
  solid(PX - 4.8, PX - 4.3, 0, 0.5, PZ - 4.8, PZ + 4.8, PAVE_LIGHT, 'marble'),
  solid(PX + 4.3, PX + 4.8, 0, 0.5, PZ - 4.8, PZ + 4.8, PAVE_LIGHT, 'marble'),
  { ...paint(PX - 4.3, PX + 4.3, PZ - 4.3, PZ + 4.3, POOL, 0.06), material: 'tile' },
];

// The fountain: a pedestal carrying a wide bowl brimming over, and a small upper basin whose
// spout throws the jet (components/world-arena-scene.ts draws the water itself).
const BOWL_TOP = 1.5;
decorCylinders.push(
  { x: PX, y: 1.31, z: PZ, r: 1.58, h: 0.06, color: PAVE_LIGHT, material: 'marble', sides: 28 },
  { x: PX, y: 1.9, z: PZ, r: 0.14, h: 0.8, color: PAVE_LIGHT, material: 'marble', sides: 12 },
  { x: PX, y: 2.3, z: PZ, r: 0.45, h: 0.12, color: PAVE_LIGHT, material: 'marble', sides: 16 },
  { x: PX, y: 2.43, z: PZ, r: 0.05, h: 0.16, color: GOLD, material: 'metal', sides: 8 },
);

// Clipped hedges. Along the east wall they stand right against it (no dead-end slot behind
// them), and the south-west one stops short of the south wall to leave a passage.
const hedges: MapBox[] = [
  // North-west quadrant.
  solid(-0.6, 0, 0, 1.6, -21.6, -14, HEDGE, 'foliage'),
  solid(-0.6, 8, 0, 1.6, -14.3, -13.7, HEDGE, 'foliage'),
  // North-east quadrant.
  solid(XGATE - 0.9, XGATE - 0.3, 0, 1.6, -21.6, -5.2, HEDGE, 'foliage'),
  solid(17, XGATE - 0.9, 0, 1.6, -6, -5.4, HEDGE, 'foliage'),
  // South-west quadrant.
  solid(-0.6, 0, 0, 1.6, 14, 21.4, HEDGE, 'foliage'),
  solid(-0.6, 8, 0, 1.6, 13.7, 14.3, HEDGE, 'foliage'),
  // South-east quadrant: stops at the crawl hole.
  solid(XGATE - 0.9, XGATE - 0.3, 0, 1.6, 2.2, 20, HEDGE, 'foliage'),
  solid(17, XGATE - 0.9, 0, 1.6, 2.6, 3.2, HEDGE, 'foliage'),
];

// Guard hut in the south garden, right by the crawl hole: a board cabin with a door to the
// north, a window to the south and a tiled pitched roof (drawn only, over the flat ceiling).
const hut: MapBox[] = [
  ...[
    ...wallSegments('x', 15.8, 14.8, 20, 0, 2.8, PLANKS, 0.3, [{ a: 16.5, b: 17.9, open: [[0, DOOR]] }]),
    ...wallSegments('x', 18.8, 14.8, 20, 0, 2.8, PLANKS, 0.3, [{ a: 16.5, b: 17.9, open: [[1.0, 2.0]] }]),
    ...wallSegments('z', 14.8, 15.8, 18.8, 0, 2.8, PLANKS, 0.3),
    ...wallSegments('z', 20, 15.8, 18.8, 0, 2.8, PLANKS, 0.3),
  ].map((b): MapBox => ({ ...b, material: 'planks' })),
  solid(14.6, 20.2, 2.8, 3.0, 15.6, 19.0, '#6b5440', 'wood'),
  // The guard's desk, against the east wall.
  solid(18.7, 19.85, 0.72, 0.8, 17.3, 18.65, WOOD, 'wood'),
];
legs(18.75, 19.8, 17.35, 18.6, 0, 0.72, WOOD);
// Stone footing, corner posts, the door frame with its leaf folded back against the wall,
// the window frame and glass, a lamp over the door and a stovepipe through the roof.
deco(14.55, 20.25, 0, 0.3, 15.55, 19.05, PAVE, 'paving');
for (const [x, z] of [
  [14.8, 15.8],
  [20, 15.8],
  [14.8, 18.8],
  [20, 18.8],
])
  deco(x - 0.2, x + 0.2, 0, 2.85, z - 0.2, z + 0.2, '#5c4630', 'wood');
deco(16.36, 16.5, 0, DOOR + 0.1, 15.58, 15.68, '#5c4630', 'wood');
deco(17.9, 18.04, 0, DOOR + 0.1, 15.58, 15.68, '#5c4630', 'wood');
deco(16.36, 18.04, DOOR, DOOR + 0.14, 15.58, 15.68, '#5c4630', 'wood');
deco(15.0, 16.36, 0.05, DOOR - 0.05, 15.58, 15.63, '#4a3322', 'wood');
deco(16.5, 17.9, 1.0, 2.0, 18.79, 18.81, '#a9cbd9', 'marble');
deco(17.17, 17.23, 1.0, 2.0, 18.9, 18.96, '#5c4630', 'wood');
for (const [y0, y1] of [
  [0.9, 1.0],
  [2.0, 2.1],
])
  deco(16.4, 18.0, y0, y1, 18.64, 18.98, '#5c4630', 'wood');
deco(16.4, 16.5, 1.0, 2.0, 18.64, 18.98, '#5c4630', 'wood');
deco(17.9, 18.0, 1.0, 2.0, 18.64, 18.98, '#5c4630', 'wood');
decorCylinders.push(
  { x: 17.2, y: 2.62, z: 15.5, r: 0.1, h: 0.22, color: '#f4e4c1', sides: 8 },
  { x: 19.2, y: 3.9, z: 16.4, r: 0.1, h: 1.6, color: SOOT, material: 'metal', sides: 10 },
);

// --- compound wall, gate and crawl hole ------------------------------------------------
const compound: MapBox[] = [
  ...perimeterWalls(BOUNDS, 4, 0.6, FENCE),
  ...wallSegments('z', XGATE, BOUNDS.minZ, BOUNDS.maxZ, 0, 4, FENCE, 0.6, [
    // Bore for the service tunnel.
    { a: -24, b: TUN_S, open: [[0, TUN_H]] },
    // Main gate.
    { a: -4, b: 1, open: [[0, 4]] },
    // Crawl hole: 1.6 m wide, 1.3 m high — crouch or lie to get through.
    { a: 20, b: 21.6, open: [[0, 1.3]] },
  ]),
  // Gate piers.
  solid(25.4, 26.6, 0, 5, -5.2, -4, PAVE, 'paving'),
  solid(25.4, 26.6, 0, 5, 1, 2.2, PAVE, 'paving'),
  // Blue corridor props: two cabinets side by side against the wall.
  solid(26.3, 27.3, 0, 1.2, 5.8, 7.2, METAL, 'metal'),
  solid(26.3, 27.3, 0, 1.4, 7.2, 8.6, METAL, 'metal'),
  { ...paint(26.4, 31.4, -23.5, 23.5, PAVE, 0.03), material: 'paving' },
];

// --- the sewer along the north wall ----------------------------------------------------
// The engine has no basement, so the sewer is an old brick culvert at ground level, turfed
// over: from the blue corridor through a bore in the east wall, west to the yard behind the
// house. A channel of murky water runs down the middle between two narrow kerbs.
const SEWER_IN = { minX: -28.6, maxX: XGATE - 0.3, minZ: BOUNDS.minZ + 0.6, maxZ: TUN_S }; // its inside
const SEWER_OPENINGS: [number, number][] = [
  [-28, -26.4], // behind the house
  [17, 18.6], // north-east yard
];
const tunnel: MapBox[] = [
  ...wallSegments(
    'x',
    TUN_S + 0.2,
    -28.8,
    26.6,
    0,
    TUN_H,
    SEWER,
    0.4,
    SEWER_OPENINGS.map(([a, b]): Opening => ({ a, b, open: [[0, TUN_H]] })),
  ),
  ...wallSegments('z', -28.8, -23.5, TUN_S + 0.4, 0, TUN_H, SEWER),
  slab(-29, 25.7, -23.5, -21.5, TUN_H, SEWER),
  slab(26.3, 28.4, -23.5, -21.5, TUN_H, SEWER),
].map((b): MapBox => ({ ...b, material: 'sewer' }));
const channel = { minZ: -22.95, maxZ: -22.45 };
tunnel.push(
  // Kerbs either side of the channel and its dark bed.
  { ...paint(SEWER_IN.minX, SEWER_IN.maxX, SEWER_IN.minZ, channel.minZ, '#6f6a5c', 0.06), material: 'paving' },
  { ...paint(SEWER_IN.minX, SEWER_IN.maxX, channel.maxZ, SEWER_IN.maxZ, '#6f6a5c', 0.06), material: 'paving' },
  { ...paint(SEWER_IN.minX, SEWER_IN.maxX, channel.minZ, channel.maxZ, '#2e3328', 0.015), material: 'sewer' },
);
const sewerWater: MapWater = { minX: SEWER_IN.minX, maxX: SEWER_IN.maxX, ...channel, y: 0.035, color: SEWER_WATER };
// Old brick over the compound wall's inner face, so the whole culvert is one material.
deco(SEWER_IN.minX, SEWER_IN.maxX, 0, TUN_H - 0.2, SEWER_IN.minZ, SEWER_IN.minZ + 0.04, SEWER, 'sewer');
// Brick ribs of the vault every 4 m (not across the side openings).
const inOpening = (x: number) => SEWER_OPENINGS.some(([a, b]) => x > a - 0.4 && x < b + 0.4);
for (let x = SEWER_IN.minX + 1.5; x < SEWER_IN.maxX - 0.5; x += 4) {
  deco(x - 0.2, x + 0.2, TUN_H - 0.32, TUN_H - 0.2, SEWER_IN.minZ, SEWER_IN.maxZ, '#5f594b', 'sewer');
  deco(x - 0.2, x + 0.2, 0, TUN_H - 0.2, SEWER_IN.minZ, SEWER_IN.minZ + 0.12, '#5f594b', 'sewer');
  if (!inOpening(x)) deco(x - 0.2, x + 0.2, 0, TUN_H - 0.2, SEWER_IN.maxZ - 0.12, SEWER_IN.maxZ, '#5f594b', 'sewer');
}
// Rusty pipes on brackets along the north side: one under the vault, one low by the kerb.
for (const [y, r] of [
  [1.62, 0.09],
  [0.4, 0.07],
] as const)
  decorCylinders.push({
    x: (SEWER_IN.minX + SEWER_IN.maxX) / 2,
    y,
    z: SEWER_IN.minZ + 0.22,
    r,
    h: SEWER_IN.maxX - SEWER_IN.minX - 0.2,
    color: '#7a4b31',
    material: 'metal',
    sides: 10,
    axis: 'x',
  });
for (let x = SEWER_IN.minX + 0.5; x < SEWER_IN.maxX; x += 2) {
  deco(x - 0.04, x + 0.04, 1.5, 1.74, SEWER_IN.minZ, SEWER_IN.minZ + 0.32, SOOT, 'metal');
  deco(x - 0.04, x + 0.04, 0.3, 0.5, SEWER_IN.minZ, SEWER_IN.minZ + 0.3, SOOT, 'metal');
}
// Brick portals round the openings, turf over the vault, manholes and a vent stack.
for (const [a, b] of SEWER_OPENINGS) {
  deco(a - 0.35, a, 0, TUN_H + 0.1, TUN_S + 0.4, TUN_S + 0.5, '#5f594b', 'sewer');
  deco(b, b + 0.35, 0, TUN_H + 0.1, TUN_S + 0.4, TUN_S + 0.5, '#5f594b', 'sewer');
  deco(a - 0.35, b + 0.35, TUN_H - 0.3, TUN_H + 0.1, TUN_S + 0.4, TUN_S + 0.5, '#5f594b', 'sewer');
}
deco(-29, XGATE - 0.3, TUN_H, TUN_H + 0.08, -23.5, -21.5, '#5d7d3a', 'grass');
for (const x of [-18, -2, 12])
  decorCylinders.push({ x, y: TUN_H + 0.1, z: -22.5, r: 0.42, h: 0.05, color: '#4d4b46', material: 'metal', sides: 20 });
decorCylinders.push({ x: 6, y: TUN_H + 0.6, z: -22.2, r: 0.12, h: 1.1, color: '#6d6a62', material: 'metal', sides: 10 });

// Garden trees: a trunk and a crown of three clumps of leaves. The one by the house stands
// clear of its wall.
const TREES: [number, number][] = [
  [-4, -19],
  [-12, -19.5],
  [21, -12],
  [-8, 18],
  [22, 8],
];
TREES.forEach(([x, z], i) => {
  const green = i % 2 ? '#5a9447' : '#4f8a3f';
  shrub(x, z, 1.7, green, 4.3);
  shrub(x + 0.9, z + 0.5, 1.1, green, 3.7);
  shrub(x - 0.8, z - 0.6, 1.0, green, 3.8);
});

export const MANSION: ArenaDef = {
  id: 'mansion',
  title: 'Особняк',
  bounds: BOUNDS,
  groundColor: '#6f8f4a',
  groundMaterial: 'grass',
  outsideColor: '#4d5b34',
  boxes: [
    ...compound.map((b): MapBox => (b.color === FENCE ? { ...b, material: 'plaster' } : b)),
    ...tunnel,
    // Outer walls are plastered, the partitions papered.
    ...houseWalls.map((b): MapBox => ({ ...b, material: b.color === INNER ? 'wallpaper' : 'plaster' })),
    ...houseFloors.map((b): MapBox => (b.color === ROOF || b.color === ROOF_TOP ? { ...b, material: 'brick' } : b)),
    ...railings,
    ...furniture,
    ...props,
    ...veranda,
    ...plaza,
    ...pool,
    ...hedges,
    ...hut,
  ],
  ramps: [
    // Straight flight in the stair hall: ground at z = 4.4 up to the second floor at z = -7.
    {
      minX: STAIR.minX,
      maxX: XB,
      minZ: Z1,
      maxZ: Z2,
      axis: 'z',
      from: Z2,
      to: Z1,
      y0: 0,
      y1: F2,
      color: OAK,
      material: 'wood',
      steps: STAIR.steps,
    },
  ],
  roofs: [
    // Gable roof over the house, ridge north–south, and the guard hut's, ridge east–west.
    { minX: -26.4, maxX: -6.6, minZ: -17.1, maxZ: 12.5, y: 6.8, rise: 4.2, ridge: 'z', color: ROOF_TILE, material: 'roof-tiles', gable: CREAM, gableMaterial: 'plaster', overhang: 0.5 },
    { minX: 14.6, maxX: 20.2, minZ: 15.6, maxZ: 19.0, y: 3.0, rise: 1.2, ridge: 'x', color: ROOF_TILE, material: 'roof-tiles', gable: PLANKS, gableMaterial: 'planks', overhang: 0.35 },
  ],
  cylinders: [
    // Fountain in the pool: the pedestal, then the bowl on top of it.
    { x: PX, y: 0.675, z: PZ, r: 0.5, h: 1.35, color: PAVE_LIGHT, solid: true, sides: 12, material: 'marble' },
    { x: PX, y: BOWL_TOP - 0.075, z: PZ, r: 1.5, h: 0.15, color: PAVE_LIGHT, solid: true, sides: 28, material: 'marble' },
    // Veranda columns carrying the balcony.
    { x: -3.7, y: 1.8, z: -10, r: 0.25, h: 3.6, color: CREAM, solid: true },
    { x: -3.7, y: 1.8, z: -5, r: 0.25, h: 3.6, color: CREAM, solid: true },
    { x: -3.7, y: 1.8, z: 0, r: 0.25, h: 3.6, color: CREAM, solid: true },
    { x: -3.7, y: 1.8, z: 5, r: 0.25, h: 3.6, color: CREAM, solid: true },
    // Garden trees.
    ...TREES.map(([x, z]): MapCylinder => ({ x, y: 1.7, z, r: 0.3, h: 3.4, color: WOOD, solid: true, sides: 8, material: 'wood' })),
  ],
  spheres,
  water: [
    { minX: PX - 4.3, maxX: PX + 4.3, minZ: PZ - 4.3, maxZ: PZ + 4.3, y: 0.35, color: WATER },
    // The bowl, filled to the brim.
    { minX: PX - 1.46, maxX: PX + 1.46, minZ: PZ - 1.46, maxZ: PZ + 1.46, y: BOWL_TOP + 0.02, color: WATER, round: true },
    sewerWater,
  ],
  fountains: [{ x: PX, z: PZ, jetY: 2.5, bowlY: BOWL_TOP + 0.02, bowlR: 1.46, poolY: 0.35 }],
  furnishings: decor,
  furnishingCylinders: decorCylinders,
  lights: [
    // House, ground floor.
    { x: -20, y: 2.9, z: -12, color: '#ffd9a8', intensity: 1.1, distance: 14 },
    { x: -22, y: 2.9, z: -1, color: '#ffd9a8', intensity: 1.1, distance: 14 },
    { x: -20, y: 2.9, z: 8, color: '#ffd9a8', intensity: 1.1, distance: 14 },
    { x: -10.6, y: 5.6, z: -2, color: '#ffe3bb', intensity: 1.6, distance: 16 },
    { x: -10.6, y: 2.6, z: -14.4, color: '#ffd9a8', intensity: 0.9, distance: 10 },
    { x: -10.6, y: 2.6, z: 10, color: '#ffd9a8', intensity: 0.9, distance: 10 },
    // Second floor — nothing at all over the corridor (XA..XB, ZNF..Z1): it stays dark,
    // and the neighbouring lamps are kept short-range so little of them reaches it.
    { x: -23, y: 5.6, z: -15, color: '#ffd9a8', intensity: 1.0, distance: 8 },
    { x: -23, y: 5.6, z: -2, color: '#ffd9a8', intensity: 1.0, distance: 8 },
    { x: -21, y: 5.6, z: 8, color: '#ffd9a8', intensity: 1.0, distance: 9 },
    // Outside.
    { x: -5.2, y: 3.3, z: -2, color: '#ffe0b0', intensity: 1.2, distance: 16 },
    { x: PX, y: 3.2, z: PZ, color: '#9fd6ff', intensity: 1.4, distance: 18 },
    { x: XGATE, y: 3.6, z: -1.5, color: '#ffe0b0', intensity: 1.2, distance: 14 },
    { x: 17.4, y: 2.4, z: 17.3, color: '#ffd9a8', intensity: 0.9, distance: 9 },
    { x: 29, y: 3.2, z: 0, color: '#cfe6ff', intensity: 1.2, distance: 18 },
    { x: 29, y: 3.2, z: 14, color: '#cfe6ff', intensity: 1.2, distance: 18 },
    // Sewer: dim only.
    { x: 20, y: 1.9, z: -22.8, color: '#8fb6a6', intensity: 0.45, distance: 10 },
    { x: 4, y: 1.9, z: -22.8, color: '#8fb6a6', intensity: 0.45, distance: 10 },
    { x: -14, y: 1.9, z: -22.8, color: '#8fb6a6', intensity: 0.45, distance: 10 },
  ],
  spawns: {
    // Red: the three ground-floor rooms of the west wing.
    red: [
      { x: -23, z: -14, yaw: Math.PI / 2 },
      { x: -19, z: -14, yaw: Math.PI / 2 },
      { x: -23, z: -10, yaw: Math.PI / 2 },
      { x: -22, z: -3, yaw: Math.PI / 2 },
      { x: -22, z: 1, yaw: Math.PI / 2 },
      { x: -23, z: 8, yaw: Math.PI / 2 },
      { x: -19, z: 10, yaw: Math.PI / 2 },
    ],
    // Blue: the "спецназ" corridor behind the east wall.
    blue: [
      { x: 29, z: -19, yaw: -Math.PI / 2 },
      { x: 29, z: -13, yaw: -Math.PI / 2 },
      { x: 29, z: -7, yaw: -Math.PI / 2 },
      { x: 29, z: -1, yaw: -Math.PI / 2 },
      { x: 29, z: 5, yaw: -Math.PI / 2 },
      { x: 29, z: 11, yaw: -Math.PI / 2 },
      { x: 29, z: 17, yaw: -Math.PI / 2 },
    ],
  },
};
