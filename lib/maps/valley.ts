import {
  perimeterWalls,
  type ArenaDef,
  type Bounds,
  type MapBox,
  type MapCylinder,
  type MapLight,
  type MapRamp,
  type MapSphere,
  type MapWater,
  type SpawnPoint,
} from './types.ts';

/**
 * «Ледниковая долина» — the big alpine map: 120 x 112 m, five times the area of the
 * mountain camp (56 x 48). Everything is mirrored across z = 0, so neither camp gets a
 * shorter way to anything.
 *
 *   z -56 | ---------------- КРАСНЫЙ ЛАГЕРЬ (дом, срубы, вышка) ----------------- |
 *   z -36 | === ЗАПАДНЫЕ ВОРОТА ====== ЦЕНТРАЛЬНЫЕ ====== ВОСТОЧНЫЕ ВОРОТА ====== | гряда
 *         |  ЛЕДНИК x -58..-40       ПОЛЕ: озёра,       СОСНОВЫЙ БОР x 30..43     |
 *   z   0 |  полка y = 2.5 и         остовы, валуны      КАРЬЕР: уступы           |
 *         |  колонный грот под ней                       y = 2.2 и y = 4.4        |
 *   z  36 | === ЗАПАДНЫЕ ВОРОТА ====== ЦЕНТРАЛЬНЫЕ ====== ВОСТОЧНЫЕ ВОРОТА ====== | гряда
 *   z  56 | ---------------- СИНИЙ ЛАГЕРЬ (зеркало красного) -------------------- |
 *         x -60                         x 0                                  x 60
 *
 * Центр долины — плато x -22..22, z -18..18 высотой 3,4 м с руиной станции наверху.
 * Наверх ведут только четыре пандуса, а насквозь — крестовый тоннель на уровне земли
 * с четырьмя устьями. Западный фланг двухэтажный: ледяная полка сверху, колонный грот
 * под ней. Восточный — лесной подход к двум уступам карьера. Между лагерями и центром
 * открытое поле с укрытиями и двумя замёрзшими озёрами.
 */

const BOUNDS: Bounds = { minX: -60, maxX: 60, minZ: -56, maxZ: 56 };

// --- палитра ---------------------------------------------------------------------------
const SNOW = '#e8eff5';
const SNOW_DRIFT = '#f6fafd';
const CLIFF = '#79848f';
const ROCK = '#6d7883';
const ROCK_DARK = '#5b6572';
const SLATE = '#4c5666';
const RAMP_STONE = '#8b939c';
const WOOD = '#7c5838';
const WOOD_DARK = '#5f4128';
const LOG = '#8c6544';
const ROOF = '#46505e';
const CANVAS_RED = '#8e403a';
const PINE_TRUNK = '#4a3526';
const PINE_1 = '#1f4a30';
const PINE_2 = '#245638';
const PINE_3 = '#2c6642';
const ICE = '#a8dcee';
const ICE_PALE = '#cfe9f4';
const ICE_DEEP = '#7fb8d4';
const METAL = '#59626e';
const RUST = '#8a5a3c';

// --- примитивы -------------------------------------------------------------------------

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

/** Flat paint on the snow (trodden ground, lake ice): decoration only. */
const paint = (x0: number, x1: number, z0: number, z1: number, color: string, h = 0.3): MapBox => ({
  x: (x0 + x1) / 2,
  y: h / 2,
  z: (z0 + z1) / 2,
  w: x1 - x0,
  h,
  d: z1 - z0,
  color,
});

// Один приём на всю карту: половина при z < 0 описана явно, вторая получается
// отражением. Так обе команды получают одинаковые расстояния, укрытия и подъёмы.
const mirrorBoxes = (bs: MapBox[]): MapBox[] => bs.map((b) => ({ ...b, z: -b.z }));
const mirrorCylinders = (cs: MapCylinder[]): MapCylinder[] => cs.map((c) => ({ ...c, z: -c.z }));
const mirrorSpheres = (ss: MapSphere[]): MapSphere[] => ss.map((s) => ({ ...s, z: -s.z }));
const mirrorLights = (ls: MapLight[]): MapLight[] => ls.map((l) => ({ ...l, z: -l.z }));
const mirrorWater = (ws: MapWater[]): MapWater[] => ws.map((w) => ({ ...w, minZ: -w.maxZ, maxZ: -w.minZ }));
/** A z-axis ramp also swaps its ends, so the mirrored copy still rises the same way. */
const mirrorRamps = (rs: MapRamp[]): MapRamp[] =>
  rs.map((r) => ({
    ...r,
    minZ: -r.maxZ,
    maxZ: -r.minZ,
    ...(r.axis === 'z' ? { from: -r.from, to: -r.to } : {}),
  }));

/** Solid trunk plus three decorative crowns, all above head height. */
const pine = ([x, z]: [number, number]): MapCylinder[] => [
  { x, y: 2.25, z, r: 0.3, h: 4.5, color: PINE_TRUNK, solid: true, sides: 8 },
  { x, y: 3.2, z, r: 1.6, h: 1.6, color: PINE_1, sides: 8 },
  { x, y: 4.4, z, r: 1.1, h: 1.6, color: PINE_2, sides: 8 },
  { x, y: 5.4, z, r: 0.6, h: 1.4, color: PINE_3, sides: 8 },
];

// --- лагерь ----------------------------------------------------------------------------

/**
 * Северный (красный) лагерь. Дом стоит спиной к обрыву, перед ним двор с палатками и
 * костром, по бокам два сруба, справа вышка с пандусом. Выход из лагеря — только через
 * трое ворот в гряде на z = -36: западные x -46..-38, центральные x -6..6, восточные
 * x 38..46.
 */
const campBoxes: MapBox[] = [
  // Дом: стены 0..4,2 м, два проёма в южной стене, крыша поверх.
  block(-13, 13, 0, 4.2, -54, -53.5, WOOD),
  block(-13, -12.5, 0, 4.2, -54, -46, WOOD),
  block(12.5, 13, 0, 4.2, -54, -46, WOOD),
  block(-13, -8, 0, 4.2, -46.5, -46, WOOD),
  block(-3, 3, 0, 4.2, -46.5, -46, WOOD),
  block(8, 13, 0, 4.2, -46.5, -46, WOOD),
  block(-8, -3, 2.6, 4.2, -46.5, -46, WOOD),
  block(3, 8, 2.6, 4.2, -46.5, -46, WOOD),
  block(-14.5, 14.5, 4.2, 4.8, -55.5, -45, ROOF),
  // Обстановка внутри дома.
  block(-9, -5, 0, 0.9, -52, -48, WOOD_DARK),
  block(5, 9, 0, 0.9, -52, -48, WOOD_DARK),
  block(-2, 2, 0, 1.2, -53, -51, WOOD_DARK),

  // Два сруба по бокам двора.
  block(-28, -20, 0, 3.2, -46, -40, WOOD),
  block(-29, -19, 3.2, 3.8, -47, -39, ROOF),
  block(20, 28, 0, 3.2, -46, -40, WOOD),
  block(19, 29, 3.2, 3.8, -47, -39, ROOF),

  // Вышка над западной частью двора: площадка на 3 м, перила с разрывом под пандус,
  // который заходит с севера. Под площадкой остаётся крытый проход (потолок 2,9 м).
  slab(-19, -13, -44, -38, 3, WOOD_DARK),
  block(-19, -18, 3, 3.9, -44, -43.6, WOOD_DARK),
  block(-14, -13, 3, 3.9, -44, -43.6, WOOD_DARK),
  block(-19, -18.6, 3, 3.9, -43.6, -38, WOOD_DARK),
  block(-13.4, -13, 3, 3.9, -43.6, -38, WOOD_DARK),
  block(-18.6, -13.4, 3, 3.9, -38.4, -38, WOOD_DARK),

  // Палатки и утоптанный снег вокруг костра.
  block(-9, -5.6, 0, 1.9, -45, -42, CANVAS_RED),
  block(5.6, 9, 0, 1.9, -45, -42, CANVAS_RED),
  paint(-7, 7, -46, -40, SNOW_DRIFT),

  // Мешки, ящики и валуны, прикрывающие двор.
  block(-11, -7, 0, 1.2, -39, -38, ROCK),
  block(7, 11, 0, 1.2, -39, -38, ROCK),
  block(-3, 3, 0, 1, -41, -40, WOOD_DARK),
  block(-34, -31, 0, 1.5, -44, -41, ROCK),
  block(31, 34, 0, 1.5, -44, -41, ROCK),
  block(-40, -36, 0, 1.4, -50, -47, ROCK),
  block(36, 40, 0, 1.4, -50, -47, ROCK),
  block(-46, -42, 0, 1.6, -42, -39, ROCK),
  block(42, 46, 0, 1.6, -42, -39, ROCK),
  block(-52, -48, 0, 1.4, -48, -45, ROCK),
  block(48, 52, 0, 1.4, -48, -45, ROCK),

  // Гряда на z = -36 с тремя воротами и каменными столбами по их краям.
  block(-59, -46, 0, 5, -37, -35, ROCK),
  block(-38, -6, 0, 5, -37, -35, ROCK),
  block(6, 38, 0, 5, -37, -35, ROCK),
  block(46, 59, 0, 5, -37, -35, ROCK),
  block(-46.8, -45, 0, 6, -37.6, -34.4, ROCK_DARK),
  block(-38, -36.2, 0, 6, -37.6, -34.4, ROCK_DARK),
  block(-6.8, -5, 0, 6, -37.6, -34.4, ROCK_DARK),
  block(5, 6.8, 0, 6, -37.6, -34.4, ROCK_DARK),
  block(36.2, 38, 0, 6, -37.6, -34.4, ROCK_DARK),
  block(45, 46.8, 0, 6, -37.6, -34.4, ROCK_DARK),
];

/** Двенадцать точек спавна на лагерь: одиннадцать во дворе, одна в доме. */
const SPAWN_XZ: [number, number][] = [
  [-17, 51],
  [17, 51],
  [-24, 50],
  [24, 50],
  [-11, 41],
  [11, 41],
  [-3.5, 44],
  [3.5, 44],
  [0, 38.5],
  [-20, 38.5],
  [20, 38.5],
  [0, 49.5],
];

/** Красные стоят на севере и смотрят на юг (yaw π), синие — наоборот. */
const campSpawns = (s: 1 | -1): SpawnPoint[] =>
  SPAWN_XZ.map(([x, z]) => ({ x, z: s * z, yaw: s < 0 ? Math.PI : 0 }));

// --- центральное плато -----------------------------------------------------------------

const PLATEAU_TOP = 3.4;
const TUNNEL_CEIL = 3;

/** Северная половина плато: четверть-блоки, крыша северного рукава тоннеля, бруствер. */
const plateauNorth: MapBox[] = [
  block(-22, -3, 0, PLATEAU_TOP, -18, -3, CLIFF),
  block(3, 22, 0, PLATEAU_TOP, -18, -3, CLIFF),
  block(-3, 3, TUNNEL_CEIL, PLATEAU_TOP, -18, -3, ROCK_DARK),
  // Бруствер по северной кромке с разрывами под пандусы (x -14..-8 и 8..14).
  block(-22, -14, PLATEAU_TOP, 4.4, -18, -17.4, ROCK_DARK),
  block(-8, 8, PLATEAU_TOP, 4.4, -18, -17.4, ROCK_DARK),
  block(14, 22, PLATEAU_TOP, 4.4, -18, -17.4, ROCK_DARK),
  // Руина станции: северная стена с проёмом и северные половины боковых стен.
  block(-10, -2, PLATEAU_TOP, 6.4, -10, -9.2, SLATE),
  block(2, 10, PLATEAU_TOP, 6.4, -10, -9.2, SLATE),
  block(-10, -9.2, PLATEAU_TOP, 6.4, -10, -2, SLATE),
  block(9.2, 10, PLATEAU_TOP, 6.4, -10, -2, SLATE),
  // Две угловые башни — ориентир, видимый через всю долину.
  block(-21, -17, PLATEAU_TOP, 8.2, -15, -11, SLATE),
  block(17, 21, PLATEAU_TOP, 8.2, -15, -11, SLATE),
  // Укрытия во дворе руины и в северном рукаве тоннеля.
  block(-6, -3, PLATEAU_TOP, 4.4, -7, -5, WOOD_DARK),
  block(3, 6, PLATEAU_TOP, 4.4, -7, -5, WOOD_DARK),
  block(-2.4, 2.4, 0, 1.2, -13, -11, ROCK),
];

/** Части плато, лежащие на самой оси z = 0. */
const plateauCentre: MapBox[] = [
  block(-22, 22, TUNNEL_CEIL, PLATEAU_TOP, -3, 3, ROCK_DARK),
  block(-22, -21.4, PLATEAU_TOP, 4.4, -18, 18, ROCK_DARK),
  block(21.4, 22, PLATEAU_TOP, 4.4, -18, 18, ROCK_DARK),
  block(-13, -11, 0, 1.2, -2.4, 2.4, ROCK),
  block(11, 13, 0, 1.2, -2.4, 2.4, ROCK),
];

// --- западный фланг: ледник и грот -----------------------------------------------------

const SHELF_TOP = 2.5;
/** Низ полки: под ней 2,3 м — во весь рост проходится, вставать можно. */
const SHELF_UNDER = SHELF_TOP - 0.2;

/** Ряд ледяных колонн, держащих полку. */
const grottoPillars = (z: number): MapBox[] => [
  block(-54.9, -53.1, 0, SHELF_UNDER, z - 0.9, z + 0.9, ICE_DEEP),
  block(-47.9, -46.1, 0, SHELF_UNDER, z - 0.9, z + 0.9, ICE_DEEP),
];

const glacierNorth: MapBox[] = [
  ...grottoPillars(-24),
  ...grottoPillars(-16),
  ...grottoPillars(-8),
  // Сераки на полке — единственные укрытия наверху.
  block(-56, -53, SHELF_TOP, 4.6, -22, -19, ICE),
  block(-48, -45, SHELF_TOP, 4.6, -14, -11, ICE),
  block(-44, -41.5, SHELF_TOP, 4.2, -24, -21, ICE),
  block(-57, -54, SHELF_TOP, 4, -9, -6, ICE),
  // Глыбы льда в гроте.
  block(-52, -50, 0, 1.4, -26, -24, ICE),
  block(-45, -43, 0, 1.5, -19, -17, ICE),
  block(-51, -49, 0, 1.3, -12, -10, ICE),
  // Каменный порог у восточного пандуса на полку.
  block(-40, -37, 0, 1.4, -16, -14, ROCK),
];

const glacierCentre: MapBox[] = [
  slab(-58, -40, -28, 28, SHELF_TOP, ICE_PALE),
  ...grottoPillars(0),
  block(-52, -49, SHELF_TOP, 4.4, -5, 5, ICE),
  block(-46, -44, 0, 1.4, -2, 2, ICE),
];

// --- восточный фланг: карьер -----------------------------------------------------------

const quarryNorth: MapBox[] = [
  block(45, 48, 2.2, 3.4, -18, -15, ROCK_DARK),
  block(50, 53, 2.2, 3.2, -18, -16, ROCK_DARK),
  block(55, 58, 4.4, 5.6, -10, -7, SLATE),
  block(54, 57, 4.4, 5.4, -13.6, -11.6, SLATE),
  block(48, 51, 2.2, 3.2, -8, -6, METAL),
  // Опрокинутая вагонетка у подошвы уступа.
  block(40, 43, 0, 1.6, -23, -21, RUST),
];

const quarryCentre: MapBox[] = [
  block(44, 59, 0, 2.2, -20, 20, ROCK),
  block(53, 59, 0, 4.4, -14, 14, ROCK_DARK),
  block(45, 47, 2.2, 3.4, -3, 3, ROCK_DARK),
  block(54, 56, 4.4, 5.4, -2, 2, SLATE),
];

// --- поле между лагерями и центром -----------------------------------------------------

const fieldNorth: MapBox[] = [
  // Остов грузовика на центральном подходе.
  block(-4, 2, 0, 2.4, -30, -27, RUST),
  block(2, 5, 0, 2.8, -30, -27.5, METAL),
  // Мешки и брёвна.
  block(8, 14, 0, 1.2, -28, -27, ROCK),
  block(18, 22, 0, 1.3, -25, -24, ROCK),
  block(-11, -7, 0, 0.9, -22, -21, LOG),
  block(24, 28, 0, 0.9, -31, -30, LOG),
  block(-34, -28, 0, 2, -22, -21.4, ROCK_DARK),
  block(-24, -19, 0, 2, -22, -21.4, ROCK_DARK),
  block(28, 33, 0, 2, -22, -21.4, ROCK_DARK),
  // Валуны.
  block(-30, -27.5, 0, 1.5, -13, -11, ROCK),
  block(-27, -25, 0, 1.3, -30, -28, ROCK),
  block(26, 28.5, 0, 1.5, -13, -11, ROCK),
  block(30, 32, 0, 1.4, -8, -6, ROCK),
  block(-14, -12, 0, 1.3, -32, -30, ROCK),
  block(14, 16, 0, 1.4, -34, -32, ROCK),
  block(-38, -35, 0, 1.6, -26, -24, ROCK),
  block(35, 38, 0, 1.6, -30, -28, ROCK),
  block(-8, -6, 0, 1.2, -20, -19, ROCK),
  block(6, 8, 0, 1.2, -20, -19, ROCK),
  // Замёрзшее озеро и глыба на его берегу.
  paint(-26, -8, -34, -26, ICE_PALE, 0.12),
  block(-9, -7, 0, 1.1, -33, -31, ICE),
  // Снежные надувы.
  paint(-44, -36, -18, -13, SNOW_DRIFT),
  paint(16, 24, -18, -14, SNOW_DRIFT),
  paint(-20, -12, -29, -25, SNOW_DRIFT),
  paint(44, 52, -32, -27, SNOW_DRIFT),
  paint(-56, -48, -34, -30, SNOW_DRIFT),
];

// --- сосны -----------------------------------------------------------------------------

const FOREST_NORTH: [number, number][] = [
  [31, -33],
  [35, -31],
  [40, -33],
  [33, -27],
  [38, -25],
  [42, -28],
  [30.5, -21],
  [36, -20],
  [41, -18],
  [32, -14],
  [37, -11],
  [42, -7],
];

const FIELD_TREES_NORTH: [number, number][] = [
  [-36, -32],
  [-31, -25],
  [-28.5, -31],
  [-19, -24],
  [-28, -9],
  [-32, -17],
  [-25, -21],
  [-6, -32],
  [10, -25],
  [22, -26],
];

const FOREST_CENTRE: [number, number][] = [
  [36, 0],
  [41, 0],
];

// --- сборка ----------------------------------------------------------------------------

const northBoxes: MapBox[] = [
  ...campBoxes,
  ...plateauNorth,
  ...glacierNorth,
  ...quarryNorth,
  ...fieldNorth,
];

const boxes: MapBox[] = [
  ...perimeterWalls(BOUNDS, 6, 1, CLIFF),
  ...plateauCentre,
  ...glacierCentre,
  ...quarryCentre,
  ...northBoxes,
  ...mirrorBoxes(northBoxes),
];

const northRamps: MapRamp[] = [
  // Два пандуса на плато с севера.
  { minX: -14, maxX: -8, minZ: -25, maxZ: -18, axis: 'z', from: -25, to: -18, y0: 0, y1: PLATEAU_TOP, color: RAMP_STONE },
  { minX: 8, maxX: 14, minZ: -25, maxZ: -18, axis: 'z', from: -25, to: -18, y0: 0, y1: PLATEAU_TOP, color: RAMP_STONE },
  // Подъёмы на ледяную полку: с севера и с востока.
  { minX: -52, maxX: -46, minZ: -35, maxZ: -28, axis: 'z', from: -35, to: -28, y0: 0, y1: SHELF_TOP, color: ICE_PALE },
  { minX: -40, maxX: -33, minZ: -12, maxZ: -6, axis: 'x', from: -33, to: -40, y0: 0, y1: SHELF_TOP, color: ICE_PALE },
  // Уступы карьера: с поля на первый, с первого на второй.
  { minX: 44, maxX: 50, minZ: -27, maxZ: -20, axis: 'z', from: -27, to: -20, y0: 0, y1: 2.2, color: RAMP_STONE },
  { minX: 47, maxX: 53, minZ: -11, maxZ: -5, axis: 'x', from: 47, to: 53, y0: 2.2, y1: 4.4, color: RAMP_STONE },
  // Заезд на вышку лагеря.
  { minX: -18, maxX: -14, minZ: -50, maxZ: -44, axis: 'z', from: -50, to: -44, y0: 0, y1: 3, color: WOOD_DARK },
];

const ramps: MapRamp[] = [...northRamps, ...mirrorRamps(northRamps)];

const northCylinders: MapCylinder[] = [
  ...FOREST_NORTH.flatMap(pine),
  ...FIELD_TREES_NORTH.flatMap(pine),
  // Костёр лагеря.
  { x: 0, y: 0.25, z: -43, r: 1.1, h: 0.5, color: ROCK_DARK, sides: 10 },
  // Опоры вышки.
  { x: -18, y: 1.5, z: -43, r: 0.25, h: 3, color: WOOD_DARK, solid: true, sides: 6 },
  { x: -14, y: 1.5, z: -43, r: 0.25, h: 3, color: WOOD_DARK, solid: true, sides: 6 },
  { x: -18, y: 1.5, z: -39, r: 0.25, h: 3, color: WOOD_DARK, solid: true, sides: 6 },
  { x: -14, y: 1.5, z: -39, r: 0.25, h: 3, color: WOOD_DARK, solid: true, sides: 6 },
  // Бочки в лагере и на уступе карьера.
  { x: -17, y: 0.55, z: -41, r: 0.5, h: 1.1, color: RUST, solid: true, sides: 8 },
  { x: 17, y: 0.55, z: -41, r: 0.5, h: 1.1, color: RUST, solid: true, sides: 8 },
  { x: 46, y: 2.75, z: -12, r: 0.5, h: 1.1, color: RUST, solid: true, sides: 8 },
  // Мачта прожектора карьера.
  { x: 51, y: 5.2, z: -19, r: 0.22, h: 6, color: METAL, solid: true, sides: 6 },
  // Сосульки под ледяной полкой.
  { x: -55, y: 1.95, z: -20, r: 0.14, h: 0.9, color: ICE, sides: 6 },
  { x: -50, y: 1.95, z: -13, r: 0.14, h: 0.9, color: ICE, sides: 6 },
  { x: -44, y: 1.95, z: -22, r: 0.14, h: 0.9, color: ICE, sides: 6 },
  { x: -47, y: 1.95, z: -5, r: 0.14, h: 0.9, color: ICE, sides: 6 },
];

const cylinders: MapCylinder[] = [
  ...FOREST_CENTRE.flatMap(pine),
  ...northCylinders,
  ...mirrorCylinders(northCylinders),
];

const northSpheres: MapSphere[] = [
  { x: -30, y: 1.6, z: -12, r: 1, color: SNOW_DRIFT },
  { x: 27, y: 1.6, z: -12, r: 1, color: SNOW_DRIFT },
  { x: -38, y: 1.7, z: -25, r: 0.9, color: SNOW_DRIFT },
  { x: 36, y: 1.7, z: -29, r: 0.9, color: SNOW_DRIFT },
  { x: -14, y: 1.4, z: -31, r: 0.8, color: SNOW_DRIFT },
  { x: 40, y: 1.7, z: -22, r: 0.85, color: SNOW_DRIFT },
  { x: -51, y: 1.5, z: -25, r: 0.75, color: ICE },
  { x: -50, y: 1.4, z: -11, r: 0.7, color: ICE },
  { x: -43, y: 0.6, z: -30, r: 0.8, color: ICE },
];

const spheres: MapSphere[] = [...northSpheres, ...mirrorSpheres(northSpheres)];

const northWater: MapWater[] = [{ minX: -26, maxX: -8, minZ: -34, maxZ: -26, y: 0.14, color: '#8fc4dc' }];
const water: MapWater[] = [...northWater, ...mirrorWater(northWater)];

const northLights: MapLight[] = [
  { x: 0, y: 1.6, z: -43, color: '#ffa95e', intensity: 10, distance: 18 },
  { x: 0, y: 3, z: -50, color: '#ffd9a0', intensity: 5, distance: 15 },
  { x: -24, y: 2.6, z: -39, color: '#ffd9a0', intensity: 4, distance: 10 },
  { x: 24, y: 2.6, z: -39, color: '#ffd9a0', intensity: 4, distance: 10 },
  { x: -54, y: 1.7, z: -20, color: '#5fa6dc', intensity: 4, distance: 14 },
  { x: -47, y: 1.7, z: -8, color: '#5fa6dc', intensity: 4, distance: 14 },
  { x: 0, y: 2.4, z: -10, color: '#7fa8c8', intensity: 3.5, distance: 12 },
  { x: 51, y: 7.5, z: -19, color: '#ffeccb', intensity: 7, distance: 22 },
];

const lights: MapLight[] = [
  ...northLights,
  ...mirrorLights(northLights),
  { x: -50, y: 1.7, z: 0, color: '#5fa6dc', intensity: 4, distance: 14 },
  { x: -12, y: 2.4, z: 0, color: '#7fa8c8', intensity: 3.5, distance: 12 },
  { x: 12, y: 2.4, z: 0, color: '#7fa8c8', intensity: 3.5, distance: 12 },
  { x: 0, y: 5.4, z: 0, color: '#c9dcf2', intensity: 4, distance: 16 },
];

export const VALLEY: ArenaDef = {
  id: 'valley',
  title: 'Ледниковая долина',
  bounds: BOUNDS,
  groundColor: SNOW,
  season: 'winter',
  outsideColor: '#c4d2de',
  boxes,
  ramps,
  cylinders,
  spheres,
  water,
  lights,
  spawns: { red: campSpawns(-1), blue: campSpawns(1) },
};
