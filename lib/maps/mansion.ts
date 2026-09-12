import { perimeterWalls, type ArenaDef, type MapBox } from './types.ts';

// «Особняк» — team battle. Red holds the two-storey house in the west, blue starts in the
// "спецназ" corridor behind the east compound wall. Routes between them: the main gate and
// the paved plaza, the roofed service tunnel along the north wall, and a crawl hole in the
// east wall by the guard hut that only crouching or lying players fit through.

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
const HEDGE = '#2e5c33';
const WATER = '#2f6f9e';
const POOL = '#1d4f73';
const CONCRETE = '#7d7c74'; // service tunnel
const METAL = '#59626e';
const TILE_DARK = '#4d4c4a';
const TILE_LIGHT = '#cfc7b4';
const CLOTH = '#7a3f3f';

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

// --- the house -----------------------------------------------------------------------
const houseWalls: MapBox[] = [
  // West facade: back door into the north room, windows on both floors.
  ...wallSegments('z', XW, ZN, ZS, 0, EAVES, CREAM, WALL_T, [
    { a: -15, b: -13.3, open: [[0, DOOR]] },
    windowGap(-5, -3.6),
    windowGap(6, 7.4),
  ]),
  // North facade.
  ...wallSegments('x', ZN, XW, XE, 0, EAVES, CREAM, WALL_T, [windowGap(-23, -21.6), windowGap(-12.5, -11.1)]),
  // South facade: door out of the south room.
  ...wallSegments('x', ZS, XW, XE, 0, EAVES, CREAM, WALL_T, [
    { a: -20, b: -18, open: [[0, DOOR]] },
    windowGap(-12.5, -11.1),
  ]),
  // East facade: veranda door with the balcony door above it, east door of the south-east room.
  ...wallSegments('z', XE, ZN, ZS, 0, EAVES, CREAM, WALL_T, [
    windowGap(-14.5, -13.1, false),
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
    { a: 9, b: 10.7, open: [[0, DOOR]] },
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

const furniture: MapBox[] = [
  // North room (red spawn).
  block(-22.1, -19.9, 0, 0.8, -12.6, -11.4, WOOD),
  block(-24.6, -23.4, 0, 0.7, -10.7, -8.3, CLOTH),
  // Middle room: the vending machine.
  block(-25.6, -24.8, 0, 2.0, -2.7, -1.3, '#b4302e'),
  block(-20.5, -19.5, 0, 0.9, 1.5, 2.5, WOOD),
  // South room.
  block(-21.5, -18.5, 0, 0.8, 7.4, 8.6, WOOD),
  block(-25.1, -24.1, 0, 0.7, 5.4, 7.6, CLOTH),
  // Foyer: a long table in the middle, a sideboard by the east wall.
  block(-11.6, -9.6, 0, 0.7, -3, -1, WOOD),
  block(-8.2, -7.4, 0, 0.9, 2, 4.5, WOOD),
  // South-east room.
  block(-13.4, -12.4, 0, 0.9, 9.2, 10.2, WOOD),
  // Second floor: furniture in the lit rooms.
  block(-24.5, -22.5, F2, F2 + 0.6, -15.4, -13.4, CLOTH),
  block(-25.4, -24.4, F2, F2 + 0.9, -3, -1, WOOD),
  block(-21.5, -19.5, F2, F2 + 0.8, 9.4, 10.6, WOOD),
  // Chimney.
  block(-22.5, -21.3, 6.8, 8.2, -10.6, -9.4, ROOF_TOP),
];

const props: MapBox[] = [
  // Garden benches and planters by the veranda steps.
  block(-11, -9, 0, 0.5, -16.6, -15.8, WOOD),
  block(4, 6, 0, 0.5, 18, 18.8, WOOD),
  block(19, 21, 0, 0.5, -18.8, -18, WOOD),
  block(-3.2, -2.4, 0, 0.8, -5.4, -4.6, PAVE_LIGHT),
  block(-3.2, -2.4, 0, 0.8, 0.6, 1.4, PAVE_LIGHT),
  // Crates: cover by the guard hut and along the blue corridor.
  block(20.6, 21.8, 0, 1.2, 15.2, 16.4, WOOD),
  block(21, 22, 0, 0.9, 17, 18, WOOD),
  block(30.2, 31.3, 0, 1.1, -4, -2.8, WOOD),
  block(30.2, 31.3, 0, 1.1, 12, 13.2, WOOD),
  // Flower beds.
  paint(-14, -8, -20, -17, '#5a7a3a'),
  paint(10, 16, -20, -17, '#5a7a3a'),
  paint(-14, -8, 17, 20, '#5a7a3a'),
  paint(10, 16, 6, 9, '#5a7a3a'),
];

const verandaTiles: MapBox[] = [];
for (let i = 0; i < 2; i++)
  for (let j = 0; j < 8; j++)
    if ((i + j) % 2 === 0)
      verandaTiles.push(
        paint(XE + i * 1.75, XE + (i + 1) * 1.75, -11 + j * 2.2, -11 + (j + 1) * 2.2, TILE_DARK, 0.06),
      );

const veranda: MapBox[] = [paint(XE, -3.5, -11, 6.6, TILE_LIGHT), ...verandaTiles];

// --- courtyard -----------------------------------------------------------------------
const PX = 6.7;
const PZ = -2;
const plaza: MapBox[] = [
  paint(PX - 8.3, PX + 8.3, PZ - 8.3, PZ + 8.3, PAVE_LIGHT, 0.03),
  paint(PX - 9.5, PX + 9.5, PZ - 6.6, PZ + 6.6, PAVE, 0.04),
  paint(PX - 6.6, PX + 6.6, PZ - 9.5, PZ + 9.5, PAVE, 0.05),
  // Path from the plaza out through the gate.
  paint(15.9, XGATE, -4, 1, PAVE, 0.05),
];

const pool: MapBox[] = [
  // A low rim you can climb and hide behind.
  block(PX - 4.8, PX + 4.8, 0, 0.5, PZ - 4.8, PZ - 4.3, PAVE_LIGHT),
  block(PX - 4.8, PX + 4.8, 0, 0.5, PZ + 4.3, PZ + 4.8, PAVE_LIGHT),
  block(PX - 4.8, PX - 4.3, 0, 0.5, PZ - 4.8, PZ + 4.8, PAVE_LIGHT),
  block(PX + 4.3, PX + 4.8, 0, 0.5, PZ - 4.8, PZ + 4.8, PAVE_LIGHT),
  paint(PX - 4.3, PX + 4.3, PZ - 4.3, PZ + 4.3, POOL, 0.06),
];

const hedges: MapBox[] = [
  // North-west quadrant.
  block(-0.6, 0, 0, 1.6, -22, -14, HEDGE),
  block(-0.6, 8, 0, 1.6, -14.3, -13.7, HEDGE),
  // North-east quadrant.
  block(24.2, 24.8, 0, 1.6, -22, -7, HEDGE),
  block(17, 24.8, 0, 1.6, -6, -5.4, HEDGE),
  // South-west quadrant.
  block(-0.6, 0, 0, 1.6, 14, 23, HEDGE),
  block(-0.6, 8, 0, 1.6, 13.7, 14.3, HEDGE),
  // South-east quadrant.
  block(24.2, 24.8, 0, 1.6, 3, 20, HEDGE),
  block(17, 24.8, 0, 1.6, 2.6, 3.2, HEDGE),
];

// Guard hut in the south garden, right by the crawl hole.
const hut: MapBox[] = [
  ...wallSegments('x', 15.8, 14.8, 20, 0, 2.8, PAVE, 0.3, [{ a: 16.5, b: 17.9, open: [[0, DOOR]] }]),
  ...wallSegments('x', 18.8, 14.8, 20, 0, 2.8, PAVE, 0.3, [{ a: 16.5, b: 17.9, open: [[1.0, 2.0]] }]),
  ...wallSegments('z', 14.8, 15.8, 18.8, 0, 2.8, PAVE, 0.3),
  ...wallSegments('z', 20, 15.8, 18.8, 0, 2.8, PAVE, 0.3),
  block(14.6, 20.2, 2.8, 3.0, 15.6, 19.0, METAL),
  block(18.4, 19.6, 0, 0.9, 16.6, 18.2, WOOD),
];

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
  block(25.4, 26.6, 0, 5, -5.2, -4, PAVE),
  block(25.4, 26.6, 0, 5, 1, 2.2, PAVE),
  // Blue corridor props.
  block(26.7, 27.7, 0, 1.2, 5.8, 7.2, METAL),
  block(26.7, 27.7, 0, 1.2, 7.8, 9.2, METAL),
  paint(26.4, 31.4, -23.5, 23.5, PAVE, 0.03),
];

// --- service tunnel ("sewer") along the north wall -------------------------------------
// The engine has no basement, so the sewer is a roofed 1.7 m wide service run: from the
// blue corridor through a bore in the east wall, west to the yard behind the house.
const tunnel: MapBox[] = [
  ...wallSegments('x', TUN_S + 0.2, -28.8, 26.6, 0, TUN_H, CONCRETE, 0.4, [
    { a: -28, b: -26.4, open: [[0, TUN_H]] }, // behind the house
    { a: 17, b: 18.6, open: [[0, TUN_H]] }, // north-east yard
  ]),
  ...wallSegments('z', -28.8, -23.5, TUN_S + 0.4, 0, TUN_H, CONCRETE),
  slab(-29, 25.7, -23.5, -21.5, TUN_H, CONCRETE),
  slab(26.3, 28.4, -23.5, -21.5, TUN_H, CONCRETE),
];

export const MANSION: ArenaDef = {
  id: 'mansion',
  title: 'Особняк',
  bounds: BOUNDS,
  groundColor: '#6f8f4a',
  outsideColor: '#4d5b34',
  boxes: [
    ...compound,
    ...tunnel,
    ...houseWalls,
    ...houseFloors,
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
    { minX: -17.8, maxX: XB, minZ: Z1, maxZ: Z2, axis: 'z', from: Z2, to: Z1, y0: 0, y1: F2, color: WOOD },
  ],
  cylinders: [
    // Fountain pillar in the pool.
    { x: PX, y: 1.6, z: PZ, r: 0.7, h: 3.2, color: PAVE_LIGHT, solid: true, sides: 8 },
    // Veranda columns carrying the balcony.
    { x: -3.7, y: 1.8, z: -10, r: 0.25, h: 3.6, color: CREAM, solid: true },
    { x: -3.7, y: 1.8, z: -5, r: 0.25, h: 3.6, color: CREAM, solid: true },
    { x: -3.7, y: 1.8, z: 0, r: 0.25, h: 3.6, color: CREAM, solid: true },
    { x: -3.7, y: 1.8, z: 5, r: 0.25, h: 3.6, color: CREAM, solid: true },
    // Garden trees.
    { x: -6, y: 1.7, z: -18, r: 0.3, h: 3.4, color: WOOD, solid: true, sides: 8 },
    { x: -12, y: 1.7, z: -19.5, r: 0.3, h: 3.4, color: WOOD, solid: true, sides: 8 },
    { x: 21, y: 1.7, z: -12, r: 0.3, h: 3.4, color: WOOD, solid: true, sides: 8 },
    { x: -8, y: 1.7, z: 18, r: 0.3, h: 3.4, color: WOOD, solid: true, sides: 8 },
    { x: 22, y: 1.7, z: 8, r: 0.3, h: 3.4, color: WOOD, solid: true, sides: 8 },
  ],
  spheres: [
    { x: PX, y: 3.5, z: PZ, r: 0.6, color: PAVE_LIGHT },
    { x: -6, y: 4.2, z: -18, r: 1.9, color: '#3d6b34' },
    { x: -12, y: 4.2, z: -19.5, r: 1.7, color: '#44753a' },
    { x: 21, y: 4.2, z: -12, r: 1.9, color: '#3d6b34' },
    { x: -8, y: 4.2, z: 18, r: 1.8, color: '#44753a' },
    { x: 22, y: 4.2, z: 8, r: 1.9, color: '#3d6b34' },
  ],
  water: [{ minX: PX - 4.3, maxX: PX + 4.3, minZ: PZ - 4.3, maxZ: PZ + 4.3, y: 0.35, color: WATER }],
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
    // Service tunnel: dim only.
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
