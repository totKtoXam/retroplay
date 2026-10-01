import {
  OUTBREAK_REAL_MODELS,
  type RealModelId,
} from './outbreak-real-models.ts';
import {
  FLOOR_H,
  parseProcBuilding,
  procBuildingId,
  procBuildingInfo,
  type ProcBuildingStyle,
} from './proc-buildings.ts';
import {
  terrainHeightAt,
  type ArenaDef,
  type Bounds,
  type MapDecal,
  type MapNpc,
  type MapProp,
  type MapRoad,
  type MapTerrain,
  type MapWater,
  type MapZone,
  type PropKitModel,
  type SpawnPoint,
} from './types.ts';

/**
 * «Зона заражения» — огромная карта для режима с зомби: 2 × 2 км, в тысячу раз больше
 * «Горного лагеря». Всё, что стоит в мире, — реалистичные сканы и модели
 * (lib/maps/outbreak-real-models.ts, сборка — scripts/build-outbreak-real-models.mjs) и
 * процедурные дома (lib/maps/proc-buildings.ts); здесь только рельеф, дороги и расстановка.
 *
 *   z -1000 ┌──────────────── ХРЕБЕТ (снег выше 72 м) ─────────────────────┐
 *           │  Горный ·            · Лагерь альпинистов                    │
 *    z -400 │ ТЁМНЫЙ БОР                               СЕВЕРНЫЙ ЛЕС        │
 *           │  Сосновка ·  Лесопилка                                        │
 *      z  0 │══ Берёзовка ══════ НОВОГРАД ═══════════ МЕГАПОЛИС ═══════════│ шоссе
 *           │    Кладбище ·         ║                          · Свалка    │
 *    z  400 │ ДУБРАВА   ОЗЕРО       ╚═ Дачный посёлок                      │
 *           │   Заречье ·              Колхоз «Заря»  · Степное   СТЕПЬ    │
 *    z 1000 └───────────────────────────────────────────── Военная база ──┘
 *          x -1000                     x 0                              x 1000
 *
 * Север — это −z (вверху миникарты). Рельеф — сетка высот с шагом 5 м: пологие холмы
 * равнины, хребет на севере, котловина озера; под городами, деревнями и вдоль дорог
 * земля выровнена. Дороги — ленты асфальта и грунтовки (`ArenaDef.roads`), земля — сплат
 * PBR-сканов по видам (`terrain.palette[].texture`). Всё случайное взято из генератора с
 * постоянным зерном, поэтому клиент и сервер строят одну и ту же карту.
 */

const HALF = 1000;
const BOUNDS: Bounds = { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF };
/** Рельеф шире границ: с края карты видно продолжение холмов, а не обрыв в пустоту. */
const MARGIN = 150;
const CELL = 5;
const SEED = 20260930;

// --- шум и случайность -------------------------------------------------------------------

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (x: number, z: number, s: number) => {
  let h =
    Math.imul(x | 0, 374761393) ^
    Math.imul(z | 0, 668265263) ^
    Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const fade = (t: number) => t * t * (3 - 2 * t);
/** Гладкий шум 0..1 с узлами на целых координатах. */
function noise(x: number, z: number, s: number) {
  const ix = Math.floor(x),
    iz = Math.floor(z);
  const fx = fade(x - ix),
    fz = fade(z - iz);
  const a = hash(ix, iz, s),
    b = hash(ix + 1, iz, s),
    c = hash(ix, iz + 1, s),
    d = hash(ix + 1, iz + 1, s);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
function fbm(x: number, z: number, s: number, octaves = 4) {
  let sum = 0,
    amp = 0.5,
    norm = 0,
    f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * f, z * f, s + i * 31) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}
/** Гребни: острые хребты вместо округлых холмов. */
function ridged(x: number, z: number, s: number) {
  let sum = 0,
    amp = 0.55,
    norm = 0,
    f = 1;
  for (let i = 0; i < 5; i++) {
    const n = 1 - Math.abs(noise(x * f, z * f, s + i * 17) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return sum / norm;
}
/** Плавный переход 0 → 1 между e0 и e1 (e0 может быть больше e1 — тогда спадает). */
const step = (e0: number, e1: number, x: number) =>
  fade(Math.max(0, Math.min(1, (x - e0) / (e1 - e0))));

// --- места ---------------------------------------------------------------------------------

type Place = {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Полуразмеры прямоугольника места. */
  hw: number;
  hd: number;
  /** Высота, к которой выровнена земля (по умолчанию 0; у горных мест — своя). */
  flat?: number;
};

const PLACES = {
  megapolis: {
    id: 'megapolis',
    name: 'Мегаполис',
    x: 615,
    z: 0,
    hw: 245,
    hd: 280,
  },
  city: { id: 'city', name: 'Новоград', x: -90, z: 60, hw: 180, hd: 180 },
  dachas: {
    id: 'dachas',
    name: 'Дачный посёлок',
    x: 225,
    z: 370,
    hw: 125,
    hd: 55,
  },
  sosnovka: {
    id: 'sosnovka',
    name: 'Сосновка',
    x: -700,
    z: -170,
    hw: 85,
    hd: 70,
  },
  berezovka: {
    id: 'berezovka',
    name: 'Берёзовка',
    x: -560,
    z: 180,
    hw: 95,
    hd: 60,
  },
  zarechye: {
    id: 'zarechye',
    name: 'Заречье',
    x: -445,
    z: 640,
    hw: 75,
    hd: 70,
  },
  stepnoe: { id: 'stepnoe', name: 'Степное', x: 420, z: 700, hw: 70, hd: 75 },
  gorny: { id: 'gorny', name: 'Горный', x: -120, z: -700, hw: 60, hd: 50 },
  base: { id: 'base', name: 'Военная база', x: 800, z: 800, hw: 110, hd: 100 },
  cemetery: {
    id: 'cemetery',
    name: 'Старое кладбище',
    x: -330,
    z: 330,
    hw: 40,
    hd: 32,
  },
  climbers: {
    id: 'climbers',
    name: 'Лагерь альпинистов',
    x: 330,
    z: -650,
    hw: 40,
    hd: 35,
  },
  farm: { id: 'farm', name: 'Колхоз «Заря»', x: 150, z: 640, hw: 100, hd: 80 },
  sawmill: { id: 'sawmill', name: 'Лесопилка', x: -840, z: 20, hw: 45, hd: 40 },
  junkyard: { id: 'junkyard', name: 'Свалка', x: 925, z: 330, hw: 50, hd: 42 },
} satisfies Record<string, Place>;
const PLACE_LIST: Place[] = Object.values(PLACES);

/** Озеро в Дубраве: круглая котловина. */
const LAKE = { x: -720, z: 600, r: 135, level: -0.55 };

/** Ширина ленты, м: шоссе, городская улица, грунтовка к деревне. */
const HIGHWAY = 8,
  STREET = 7,
  TRACK = 5;
/** Дороги вне городов — ломаные по точкам (x, z). Сетка улиц городов строится отдельно. */
const ROADS: MapRoad[] = [
  // Шоссе с запада: через Берёзовку к Новограду.
  {
    points: [
      [-995, 180],
      [-560, 180],
      [-270, 180],
    ],
    width: HIGHWAY,
    texture: 'asphalt_02',
  },
  // Новоград → Мегаполис → восточный край.
  {
    points: [
      [90, 0],
      [370, 0],
    ],
    width: HIGHWAY,
    texture: 'asphalt_02',
  },
  {
    points: [
      [860, 0],
      [995, 0],
    ],
    width: HIGHWAY,
    texture: 'asphalt_02',
  },
  // На юг: дачи, Степное, база.
  {
    points: [
      [-30, 240],
      [-30, 370],
      [350, 370],
      [420, 560],
      [420, 790],
      [690, 790],
    ],
    width: STREET,
    texture: 'asphalt_02',
  },
  // Грунтовки: через Тёмный бор к Сосновке и лесопилке.
  {
    points: [
      [-270, 0],
      [-450, -20],
      [-700, -170],
      [-860, -170],
    ],
    width: TRACK,
    texture: 'brown_mud_dry',
  },
  // На юго-запад: мимо кладбища к Заречью и вдоль его улицы.
  {
    points: [
      [-150, 240],
      [-260, 420],
      [-445, 640],
      [-540, 700],
    ],
    width: TRACK,
    texture: 'rocky_trail',
  },
  {
    points: [
      [-445, 575],
      [-445, 705],
    ],
    width: TRACK,
    texture: 'rocky_trail',
  },
  // От Мегаполиса на север, к предгорьям.
  {
    points: [
      [580, -280],
      [520, -420],
    ],
    width: TRACK,
    texture: 'rocky_trail',
  },
  // Колхоз.
  {
    points: [
      [210, 370],
      [150, 560],
    ],
    width: TRACK,
    texture: 'brown_mud_dry',
  },
  // Свалка за Мегаполисом.
  {
    points: [
      [860, 280],
      [868, 300],
      [925, 300],
    ],
    width: TRACK,
    texture: 'rocky_trail',
  },
];

/** Сетки улиц: город через 60 м, мегаполис через 70 м. */
type Grid = { x0: number; x1: number; z0: number; z1: number; step: number };
const CITY_GRID: Grid = { x0: -270, x1: 90, z0: -120, z1: 240, step: 60 };
const MEGA_GRID: Grid = { x0: 370, x1: 860, z0: -280, z1: 280, step: 70 };
const gridLines = (a: number, b: number, s: number) => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-6; v += s) out.push(v);
  return out;
};
const gridRoads = (g: Grid): MapRoad[] => [
  ...gridLines(g.x0, g.x1, g.step).map(
    (x): MapRoad => ({
      points: [
        [x, g.z0],
        [x, g.z1],
      ],
      width: STREET,
      texture: 'asphalt026b',
    }),
  ),
  ...gridLines(g.z0, g.z1, g.step).map(
    (z): MapRoad => ({
      points: [
        [g.x0, z],
        [g.x1, z],
      ],
      width: STREET,
      texture: 'asphalt026b',
    }),
  ),
];
/** Все ленты карты: по ним выравнивается земля, вдоль них не растут деревья и не стоят дома. */
const ALL_ROADS: MapRoad[] = [
  ...ROADS,
  ...gridRoads(CITY_GRID),
  ...gridRoads(MEGA_GRID),
];

/** Отрезки лент: (ax, az, bx, bz, полуширина). */
type Segment = [number, number, number, number, number];
const SEGMENTS: Segment[] = ALL_ROADS.flatMap((r) =>
  r.points
    .slice(1)
    .map(
      (p, i): Segment => [
        r.points[i][0],
        r.points[i][1],
        p[0],
        p[1],
        r.width / 2,
      ],
    ),
);

function segmentDistance(x: number, z: number, s: Segment) {
  const [ax, az, bx, bz] = s;
  const dx = bx - ax,
    dz = bz - az;
  const t = Math.max(
    0,
    Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)),
  );
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
/**
 * Отрезки по клеткам 25 м: в клетке — те, что ближе ROAD_REACH к ней. Перебор всех
 * полусотни отрезков в каждом узле рельефа и для каждой травинки занимал больше секунды.
 */
const ROAD_CELL = 25;
const ROAD_REACH = 50;
const ROAD_COLS = Math.ceil((2 * (HALF + MARGIN)) / ROAD_CELL);
const ROAD_GRID: Segment[][] = Array.from(
  { length: ROAD_COLS * ROAD_COLS },
  (_, i) => {
    const x0 = -HALF - MARGIN + (i % ROAD_COLS) * ROAD_CELL,
      z0 = -HALF - MARGIN + Math.floor(i / ROAD_COLS) * ROAD_CELL;
    const cx = x0 + ROAD_CELL / 2,
      cz = z0 + ROAD_CELL / 2;
    // Расстояние до отрезка от центра клетки минус её полудиагональ — не больше, чем от любой её точки.
    return SEGMENTS.filter(
      (s) => segmentDistance(cx, cz, s) - s[4] - ROAD_CELL * 0.71 < ROAD_REACH,
    );
  },
);
/** Расстояние от точки до края ближайшей дороги (внутри ленты — отрицательное), не больше ROAD_REACH. */
const roadEdge = (x: number, z: number) => {
  const c = Math.floor((x + HALF + MARGIN) / ROAD_CELL),
    r = Math.floor((z + HALF + MARGIN) / ROAD_CELL);
  if (c < 0 || r < 0 || c >= ROAD_COLS || r >= ROAD_COLS) return ROAD_REACH;
  let d = ROAD_REACH;
  for (const s of ROAD_GRID[r * ROAD_COLS + c])
    d = Math.min(d, segmentDistance(x, z, s) - s[4]);
  return d;
};
/** Расстояние от точки до прямоугольника места (0 внутри). */
const placeDistance = (p: Place, x: number, z: number) =>
  Math.hypot(
    Math.max(0, Math.abs(x - p.x) - p.hw),
    Math.max(0, Math.abs(z - p.z) - p.hd),
  );

// --- рельеф --------------------------------------------------------------------------------

/** Доля гор в точке: хребет вдоль севера и отрог на северо-западе. */
const mountainMask = (x: number, z: number) =>
  Math.max(
    step(-360, -560, z + (fbm(x / 180, 3.7, SEED) - 0.5) * 120),
    step(320, 120, Math.hypot(x + 950, z + 520)),
  );
/** Лес: Тёмный бор, Дубрава, Северный лес — с мягкими краями и полянами. */
function forestMask(x: number, z: number) {
  const edge = (fbm(x / 90, z / 90, SEED + 5) - 0.5) * 90;
  const nw =
    step(-360, -420, x + edge) * step(-470, -410, z) * step(90, 40, z + edge);
  const sw = step(-300, -360, x + edge) * step(230, 290, z + edge);
  const ne =
    step(360, 420, x + edge) * step(-600, -560, z) * step(-300, -350, z + edge);
  const glade = step(0.62, 0.72, fbm(x / 140, z / 140, SEED + 9));
  return Math.max(nw, sw, ne) * (1 - glade);
}
/** Тёмный бор — хвойный: там земля в хвое, а среди деревьев больше сосен. */
const pineForest = (x: number, z: number) => x < -300 && z < 150;
const steppeMask = (x: number, z: number) =>
  step(-80, 40, x) * step(430, 520, z);

/** Высота «дикой» земли до выравнивания под места и дороги. */
function wildHeight(x: number, z: number) {
  const plain = (fbm(x / 260, z / 260, SEED + 1) - 0.5) * 12;
  const steppe = (fbm(x / 420, z / 420, SEED + 2) - 0.5) * 8;
  let h = plain + (steppe - plain) * steppeMask(x, z);
  const m = mountainMask(x, z);
  if (m > 0) h += m * (18 + 105 * ridged(x / 330, z / 330, SEED + 3));
  // За границей карты земля поднимается холмами: край мира — не обрыв.
  const out = Math.max(Math.abs(x), Math.abs(z)) - HALF;
  h +=
    step(-40, MARGIN, out) * 45 * (0.6 + 0.4 * fbm(x / 120, z / 120, SEED + 4));
  const lake = Math.hypot(x - LAKE.x, z - LAKE.z);
  h += (-3.2 - h) * step(LAKE.r + 45, LAKE.r - 15, lake);
  return h;
}

function buildTerrain(): MapTerrain {
  const minX = -HALF - MARGIN,
    minZ = -HALF - MARGIN;
  const cols = Math.round((2 * (HALF + MARGIN)) / CELL) + 1,
    rows = cols;
  const heights = new Float32Array(cols * rows);
  const kinds = new Uint8Array(cols * rows);
  // Горные места выровнены к высоте своей «дикой» земли, а не к нулю.
  for (const p of PLACE_LIST)
    if (p.id === 'gorny' || p.id === 'climbers') p.flat = wildHeight(p.x, p.z);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = minX + c * CELL,
        z = minZ + r * CELL;
      let h = wildHeight(x, z);
      for (const p of PLACE_LIST) {
        const w = step(45, 0, placeDistance(p, x, z));
        if (w > 0) h += ((p.flat ?? 0) - h) * w;
      }
      const w = step(28, 6, roadEdge(x, z));
      if (w > 0) h += (0 - h) * w * (1 - mountainMask(x, z));
      heights[r * cols + c] = h;
    }
  const t: MapTerrain = {
    minX,
    minZ,
    cell: CELL,
    cols,
    rows,
    heights,
    kinds,
    palette: PALETTE,
  };
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = minX + c * CELL,
        z = minZ + r * CELL,
        i = r * cols + c;
      kinds[i] = groundKind(t, x, z, heights[i]);
    }
  return t;
}

/** Виды земли: индекс в палитре рельефа. */
const K = {
  meadow: 0,
  forest: 1,
  steppe: 2,
  rock: 3,
  snow: 4,
  field: 5,
  asphalt: 6,
  sand: 7,
  dirt: 8,
  withered: 9,
  needles: 10,
  stony: 11,
} as const;
// Земля — PBR-сканы (public/textures/outbreak/<texture>); `color` — средний цвет скана:
// им рисуется миникарта и дальний план, поэтому он не должен спорить с текстурой.
const PALETTE = [
  { color: '#989357', name: 'луг', texture: 'ground037' },
  { color: '#8e713a', name: 'лес', texture: 'forest_leaves_02' },
  { color: '#81674a', name: 'степь', texture: 'ground071' },
  { color: '#4e555b', name: 'скалы', texture: 'rock058' },
  { color: '#dfeffc', name: 'снег', texture: 'snow010a' },
  { color: '#735b3d', name: 'пашня', texture: 'brown_mud_dry' },
  { color: '#5b5a55', name: 'асфальт', texture: 'asphalt_02' },
  { color: '#cbb894', name: 'песок', texture: 'ground093c' },
  { color: '#4d4437', name: 'грунт', texture: 'brown_mud_02' },
  { color: '#ac9479', name: 'сухая трава', texture: 'withered_grass' },
  { color: '#6a5a44', name: 'хвоя', texture: 'forest_ground_04' },
  { color: '#93816a', name: 'каменистая земля', texture: 'rocky_trail' },
];

function groundKind(t: MapTerrain, x: number, z: number, h: number) {
  const slope =
    Math.hypot(
      terrainHeightAt(t, x + 2, z) - terrainHeightAt(t, x - 2, z),
      terrainHeightAt(t, x, z + 2) - terrainHeightAt(t, x, z - 2),
    ) / 4;
  if (h > 72 + (noise(x / 40, z / 40, SEED + 11) - 0.5) * 14) return K.snow;
  const mountain = mountainMask(x, z);
  if (slope > 0.75 || (mountain > 0.55 && h > 20)) return K.rock;
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 14) return K.sand;
  for (const p of [PLACES.city, PLACES.megapolis])
    if (placeDistance(p, x, z) < 6) return K.asphalt;
  for (const p of [PLACES.base, PLACES.sawmill, PLACES.junkyard])
    if (placeDistance(p, x, z) < 4) return K.dirt;
  if (placeDistance(PLACES.farm, x, z) < 2 || fieldAt(x, z)) return K.field;
  if (mountain > 0.3) return K.stony;
  if (forestMask(x, z) > 0.45) return pineForest(x, z) ? K.needles : K.forest;
  if (steppeMask(x, z) > 0.5) return K.steppe;
  // Пожухлые пятна на лугу: равнина не однотонная.
  if (fbm(x / 160, z / 160, SEED + 12) > 0.56) return K.withered;
  return K.meadow;
}
/** Пашни у деревень: полосы вдоль осей с шагом 40 м. */
function fieldAt(x: number, z: number) {
  for (const p of [PLACES.berezovka, PLACES.stepnoe, PLACES.zarechye]) {
    const d = placeDistance(p, x, z);
    if (
      d > 15 &&
      d < 110 &&
      Math.floor((x + z * 0.3) / 40) % 3 === 0 &&
      roadEdge(x, z) > 10
    )
      return true;
  }
  return false;
}

// --- модели --------------------------------------------------------------------------------

/** Процедурное здание: id из `procBuildingId`. Отдельный тип — чтобы опечатка в id скана ловилась проверкой типов. */
type ProcId = string & { readonly proc: unique symbol };
type ModelId = RealModelId | ProcId;

const MODELS: Readonly<Record<string, PropKitModel>> = OUTBREAK_REAL_MODELS;
const NONE: PropKitModel = { min: [0, 0, 0], max: [0, 0, 0], hit: 'none' };
const infoOf = (m: ModelId): PropKitModel =>
  MODELS[m] ?? procBuildingInfo(m) ?? NONE;

/**
 * Наборы процедурных домов: десяток вариантов на стиль. Дома одного варианта рисуются
 * инстансами одной геометрии — сотня уникальных домов стоила бы сотни мешей.
 */
function procPool(
  style: ProcBuildingStyle,
  n: number,
  w: [number, number],
  d: [number, number],
  floors: [number, number],
  salt: number,
): ProcId[] {
  const r = mulberry(SEED + salt);
  const int = ([a, b]: [number, number]) => a + Math.floor(r() * (b - a + 1));
  return Array.from(
    { length: n },
    (_, i) =>
      procBuildingId({
        w: int(w),
        d: int(d),
        floors: int(floors),
        seed: salt * 1000 + i,
        style,
      }) as ProcId,
  );
}
const APT_LOW = procPool('apt', 10, [14, 26], [11, 14], [3, 5], 1);
const APT_HIGH = procPool('apt', 10, [16, 30], [12, 15], [7, 12], 2);
const OFFICE = procPool('office', 10, [16, 28], [14, 20], [4, 12], 3);
const HOUSE = procPool('house', 12, [7, 11], [6, 9], [1, 2], 4);
const DACHA = procPool('house', 6, [5, 7], [5, 6], [1, 1], 5);
const INDUSTRIAL = procPool('industrial', 6, [18, 34], [14, 24], [1, 2], 6);
const RUIN = procPool('ruin', 10, [12, 24], [11, 16], [2, 6], 7);
const RUIN_HOUSE = procPool('ruin', 4, [7, 10], [6, 8], [1, 2], 8);

/** Рамка модели после поворота на кратный 90° угол: полуразмеры по x и z. */
function footprint(m: ModelId, yaw: number, s = 1) {
  const info = infoOf(m);
  const w = (info.max[0] - info.min[0]) * s,
    d = (info.max[2] - info.min[2]) * s;
  const quarter = Math.round(yaw / (Math.PI / 2)) % 2 !== 0;
  return quarter ? { hw: d / 2, hd: w / 2 } : { hw: w / 2, hd: d / 2 };
}
/**
 * Поворот, при котором длинная сторона модели идёт по направлению `dir` (угол atan2(dz, dx)):
 * у одних машин длинная ось — x, у других — z.
 */
function alongYaw(m: ModelId, dir: number) {
  const info = infoOf(m);
  return info.max[0] - info.min[0] > info.max[2] - info.min[2]
    ? -dir
    : Math.PI / 2 - dir;
}
const halfLength = (m: ModelId) => {
  const info = infoOf(m);
  return Math.max(info.max[0] - info.min[0], info.max[2] - info.min[2]) / 2;
};

/** Клип анимации: нужный, если он есть у модели, иначе первый. */
function clipOf(m: RealModelId, wanted: string) {
  const clips = MODELS[m].clips ?? [];
  return clips.includes(wanted) ? wanted : (clips[0] ?? wanted);
}

/** Занятые круги (x, z, r) в хеше клеток 20 м: деревья не растут в домах и друг в друге. */
class Reserve {
  private cells = new Map<number, [number, number, number][]>();
  private key = (cx: number, cz: number) => (cx + 200) * 1000 + (cz + 200);
  add(x: number, z: number, r: number) {
    const c0 = Math.floor((x - r) / 20),
      c1 = Math.floor((x + r) / 20),
      r0 = Math.floor((z - r) / 20),
      r1 = Math.floor((z + r) / 20);
    for (let a = c0; a <= c1; a++)
      for (let b = r0; b <= r1; b++) {
        const k = this.key(a, b);
        const list = this.cells.get(k) ?? [];
        list.push([x, z, r]);
        this.cells.set(k, list);
      }
  }
  free(x: number, z: number, r: number) {
    const c = Math.floor(x / 20),
      rr = Math.floor(z / 20);
    for (let a = c - 1; a <= c + 1; a++)
      for (let b = rr - 1; b <= rr + 1; b++)
        for (const [ox, oz, or] of this.cells.get(this.key(a, b)) ?? [])
          if (Math.hypot(ox - x, oz - z) < or + r) return false;
    return true;
  }
}

/** Поставленная постройка: по ней потом развешивают кондиционеры, пожарные лестницы, потёки. */
type House = {
  m: ModelId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Полуразмеры рамки в своих осях (до поворота). */
  hw: number;
  hd: number;
  h: number;
  floors: number;
  kind: 'apt' | 'office' | 'house' | 'industrial' | 'ruin' | 'scan';
};
type Side = 'front' | 'back' | 'left' | 'right';

// Списки моделей по ролям. Повтор id — его вес при случайном выборе.
const CARS: readonly RealModelId[] = [
  'vehicles/sedan',
  'vehicles/sedan',
  'vehicles/car',
  'vehicles/car',
  'vehicles/van',
  'vehicles/junk-car',
  'vehicles/junk-car',
  'items/covered-car',
];
const JAM: readonly RealModelId[] = [
  ...CARS,
  'vehicles/bus',
  'vehicles/destroyed-bus',
  'vehicles/burnt-cars',
];
const MILITARY: readonly RealModelId[] = [
  'vehicles/btr80',
  'vehicles/gaz66',
  'vehicles/gaz66',
];
/** Тела зомби в позе смерти; лёгкие модели чаще тяжёлых сканов. */
const DEAD: readonly RealModelId[] = [
  'corpses/z1b-fallingback',
  'corpses/z1b-fallingforward',
  'corpses/z2-dead1',
  'corpses/z2-dead2',
  'corpses/z2-dead3',
  'corpses/z1b-fallingback',
  'corpses/z2-dead1',
  'corpses/z5-death',
  'corpses/z7-lying',
  'corpses/z8-lying',
  'corpses/z5-death',
  'corpses/z7-lying',
  'corpses/z8-lying',
  'corpses/z9-lying',
  'corpses/z4-lying',
  'corpses/z6-lying',
  'corpses/z3-dead1',
  'corpses/z3-dead2',
];
/** Погибшие люди: мешок, окровавленная простыня, голова (полулежащее тело c2 — только у стен). */
const VICTIMS: readonly RealModelId[] = [
  'corpses/c1',
  'corpses/c1',
  'corpses/c4',
  'corpses/c4',
  'corpses/c6',
];
const SOLDIERS_DEAD: readonly RealModelId[] = [
  'corpses/s2-lying',
  'corpses/s3-lying',
  'corpses/s4-lying',
];
/** Сидящие тела под простынями — у стен и в ряд. */
const SITTING: readonly RealModelId[] = [
  'corpses/c3-a',
  'corpses/c3-b',
  'corpses/c3-c',
  'corpses/c3-d',
];
/** Анимированные зомби (у z5 нет клипов, z9 в Т-позе, z8 без скелета — они не здесь). */
const WALKERS: readonly RealModelId[] = [
  'zombies/z1b',
  'zombies/z2',
  'zombies/z7',
  'zombies/z1b',
  'zombies/z2',
  'zombies/z7',
  'zombies/z4',
  'zombies/z6',
  'zombies/z3',
];
const CIVILIANS: readonly RealModelId[] = [
  'survivors/rb-female03',
  'survivors/rb-male05',
  'survivors/rb-medic',
  'survivors/rb-military',
  'survivors/rb-police',
];
const SOLDIERS: readonly RealModelId[] = [
  'survivors/s2',
  'survivors/s3',
  'survivors/s4',
];
const IDLES = ['idle', 'idle2', 'idle3'] as const;
const LITTER: readonly RealModelId[] = [
  'items/trashbag',
  'items/trashbag',
  'props/trash-bag',
  'props/trash-bag',
  'items/cardboard-box',
  'items/old-tyre',
  'items/rusted-can',
  'items/rusted-wheel-rim',
  'items/plastic-crate',
  'items/plastic-crate-3',
  'props/pallet',
  'items/wooden-crate',
  'items/jerrycan',
  'props/canister',
];
/** Брошенное и рассыпанное — без столкновений: может лежать и на дороге. */
const LOOSE = LITTER.filter((m) => OUTBREAK_REAL_MODELS[m].hit === 'none');
const BINS: readonly RealModelId[] = [
  'props/dumpster',
  'props/dumpster-4k',
  'items/metal-trash-can',
];
const YARD: readonly RealModelId[] = [
  'items/barrel',
  'items/barrel-stove',
  'props/oil-barrel',
  'items/propane-tank',
  'items/storage-cart',
  'items/hand-truck',
  'items/steel-shelves',
  'items/wooden-ladder',
  'items/wooden-crate-2',
  'props/barrels-pallet',
  'props/bricks-pallet',
  'items/old-tyre',
];
const DEBRIS: readonly RealModelId[] = [
  'props/rubble-pile',
  'props/rubble-pile',
  'props/dirt-pile',
  'props/bricks-pallet',
  'props/remains',
  'props/broken-window',
  'props/broken-glass-window',
  'props/pallet',
  'items/rusted-wheel-rim',
  'nature/dead-tree-trunk-02',
];
/** Кровь: брызги и лужи (их прячет «Кровь и жестокость» — lib/maps/decals.ts). */
const BLOOD = ['d1', 'd2', 'd3-diffuse', 'proc-blood', 'd1', 'd2'] as const;
const GRIME = [
  'd5-leaking-grime',
  'd5-smear-grime',
  'd5-surface-imperfections',
  'd5-rust-decal',
] as const;
/** Что может стоять на проезжей части: машины и заграждения. */
const ON_ROAD_OK = (m: ModelId) =>
  m.startsWith('vehicles/') ||
  m === 'items/covered-car' ||
  m === 'props/barriers' ||
  m === 'props/concrete-barrier-scan' ||
  m === 'items/concrete-road-barrier';
/** Лёгкие оттенки: машины и дома одного скана не выглядят клонами. */
const TINTS = ['#e8e2da', '#dcd8d0', '#efe6d8', '#d8dce0', '#e4dcd2'] as const;

function generate() {
  const terrain = buildTerrain();
  const heightAt = (x: number, z: number) => terrainHeightAt(terrain, x, z);
  const rand = mulberry(SEED);
  const pick = <T>(list: readonly T[]) =>
    list[Math.floor(rand() * list.length)];
  const props: MapProp[] = [];
  const decals: MapDecal[] = [];
  const npcs: MapNpc[] = [];
  const houses: House[] = [];
  const reserve = new Reserve();
  const slopeAt = (x: number, z: number) =>
    Math.hypot(
      heightAt(x + 2, z) - heightAt(x - 2, z),
      heightAt(x, z + 2) - heightAt(x, z - 2),
    ) / 4;
  /** Высота поверхности: на дороге — поверх ленты асфальта (она приподнята над рельефом). */
  const surface = (x: number, z: number) =>
    heightAt(x, z) + (roadEdge(x, z) < 0.3 ? 0.08 : 0.02);
  const inPlace = (x: number, z: number, margin = 0) =>
    PLACE_LIST.some((p) => placeDistance(p, x, z) < margin);

  const put = (
    m: ModelId,
    x: number,
    z: number,
    yaw = 0,
    s = 1,
    y?: number,
    tint?: string,
  ) => {
    props.push({
      m,
      x: round(x),
      y: round(y ?? heightAt(x, z)),
      z: round(z),
      yaw: round(yaw),
      ...(s !== 1 ? { s: round(s) } : {}),
      ...(tint ? { tint } : {}),
    });
  };
  /**
   * Предмет на свободном месте: занимает круг `r`, иначе не ставится. Твёрдое на проезжую
   * часть не попадает — кроме машин и заграждений, которым там и место.
   */
  const place = (
    m: ModelId,
    x: number,
    z: number,
    r: number,
    yaw = rand() * Math.PI * 2,
    s = 1,
    y?: number,
  ) => {
    if (!reserve.free(x, z, r)) return false;
    if (
      infoOf(m).hit !== 'none' &&
      !ON_ROAD_OK(m) &&
      roadEdge(x, z) < r * 0.5 + 0.5
    )
      return false;
    put(m, x, z, yaw, s, y ?? surface(x, z));
    reserve.add(x, z, r);
    return true;
  };
  const decal = (
    texture: string,
    x: number,
    z: number,
    s: number,
    yaw = rand() * Math.PI * 2,
  ) => {
    const onRoad = roadEdge(x, z) < 0.6;
    decals.push({
      x: round(x),
      z: round(z),
      yaw: round(yaw),
      s: round(s),
      texture,
      // На асфальте пятно лежит поверх ленты, иначе его спрятала бы дорога.
      ...(onRoad ? { y: round(heightAt(x, z) + 0.08) } : {}),
    });
  };
  const blood = (x: number, z: number, s = 1 + rand() * 1.6) =>
    decal(
      rand() < 0.3 ? `d4-flipbook#${Math.floor(rand() * 9)}` : pick(BLOOD),
      x,
      z,
      s,
    );
  const grime = (x: number, z: number, s = 2 + rand() * 3, yaw?: number) =>
    decal(rand() < 0.08 ? 'd5-graffiti' : pick(GRIME), x, z, s, yaw);

  /** Постройка с рамкой, поставленная на самую низкую точку своего пятна: не висит над склоном. */
  const building = (
    m: ModelId,
    x: number,
    z: number,
    yaw: number,
    s = 1,
    tint?: string,
  ): House => {
    const { hw, hd } = footprint(m, yaw, s);
    const y = Math.min(
      heightAt(x, z),
      heightAt(x - hw, z - hd),
      heightAt(x + hw, z - hd),
      heightAt(x - hw, z + hd),
      heightAt(x + hw, z + hd),
    );
    put(m, x, z, yaw, s, y, tint);
    reserve.add(x, z, Math.hypot(hw, hd) * 0.85);
    const info = infoOf(m);
    const proc = parseProcBuilding(m);
    const house: House = {
      m,
      x,
      y,
      z,
      yaw,
      hw: info.max[0] * s,
      hd: info.max[2] * s,
      h: info.max[1] * s,
      floors:
        proc?.floors ?? Math.max(1, Math.floor((info.max[1] * s) / FLOOR_H)),
      kind: proc ? proc.style : 'scan',
    };
    houses.push(house);
    return house;
  };
  /**
   * Точка у стены постройки: `t` от −1 до 1 вдоль стены, `out` — отступ наружу. `yaw` —
   * поворот, при котором +z модели смотрит от стены.
   */
  const wall = (b: House, side: Side, t: number, out: number) => {
    const [lx, lz, turn] =
      side === 'front'
        ? [t * b.hw, b.hd + out, 0]
        : side === 'back'
          ? [t * b.hw, -b.hd - out, Math.PI]
          : side === 'right'
            ? [b.hw + out, t * b.hd, Math.PI / 2]
            : [-b.hw - out, t * b.hd, -Math.PI / 2];
    const cos = Math.cos(b.yaw),
      sin = Math.sin(b.yaw);
    return {
      x: b.x + lx * cos + lz * sin,
      z: b.z - lx * sin + lz * cos,
      yaw: b.yaw + turn,
    };
  };

  // --- следы катастрофы: тела, кровь, зомби ---
  /** Тело зомби или погибшего человека, обычно с лужей крови. Столкновений нет — только вид. */
  const body = (
    x: number,
    z: number,
    kind: 'zombie' | 'victim' | 'soldier' = 'zombie',
  ) => {
    const m = pick(
      kind === 'victim' ? VICTIMS : kind === 'soldier' ? SOLDIERS_DEAD : DEAD,
    );
    put(m, x, z, rand() * Math.PI * 2, 0.95 + rand() * 0.1, surface(x, z));
    if (rand() < 0.85)
      blood(x + (rand() - 0.5) * 1.2, z + (rand() - 0.5) * 1.2);
  };
  /** Место бойни: тела вокруг точки, лужи крови, брошенные вещи. */
  const massacre = (
    x: number,
    z: number,
    r: number,
    count: number,
    victims = 0.3,
    soldiers = 0,
  ) => {
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2,
        d = Math.sqrt(rand()) * r;
      const roll = rand();
      body(
        x + Math.cos(a) * d,
        z + Math.sin(a) * d,
        roll < soldiers
          ? 'soldier'
          : roll < soldiers + victims
            ? 'victim'
            : 'zombie',
      );
    }
    for (let i = 0; i < count / 2; i++)
      blood(
        x + (rand() - 0.5) * r * 2,
        z + (rand() - 0.5) * r * 2,
        1.5 + rand() * 2,
      );
    for (let i = 0; i < Math.ceil(count / 4); i++) {
      const wx = x + (rand() - 0.5) * r * 2,
        wz = z + (rand() - 0.5) * r * 2;
      put(pick(LOOSE), wx, wz, rand() * Math.PI * 2, 1, surface(wx, wz));
    }
  };
  /**
   * Толпа зомби: бредут на месте или стоят, все примерно в одну сторону. `clip` 'attack'
   * — ломятся во что-то (в стену лагеря). Иногда среди них — неподвижная фигура z8.
   */
  const horde = (
    x: number,
    z: number,
    r: number,
    count: number,
    facing = rand() * Math.PI * 2,
    clip?: string,
  ) => {
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2,
        d = Math.sqrt(rand()) * r;
      const nx = x + Math.cos(a) * d,
        nz = z + Math.sin(a) * d;
      const yaw = round(facing + (rand() - 0.5) * 1.2);
      if (rand() < 0.08) {
        put('zombies/z8', nx, nz, yaw, 0.95 + rand() * 0.1, surface(nx, nz));
        continue;
      }
      const m = pick(WALKERS);
      npcs.push({
        m,
        x: round(nx),
        y: round(surface(nx, nz) - 0.02),
        z: round(nz),
        yaw,
        clip: clipOf(m, clip ?? (rand() < 0.6 ? 'walk' : 'idle')),
        s: round(0.94 + rand() * 0.12),
      });
    }
  };
  /** Живые люди: стоят, переминаются (три разных idle, чтобы не двигались хором). */
  const people = (
    list: readonly RealModelId[],
    spots: readonly [number, number, number][],
  ) => {
    const first = Math.floor(rand() * list.length);
    for (const [i, [x, z, yaw]] of spots.entries()) {
      // По кругу: в лагере каждый — свой человек, а не пятеро одинаковых.
      const m = list[(first + i) % list.length];
      npcs.push({
        m,
        x: round(x),
        y: round(surface(x, z) - 0.02),
        z: round(z),
        yaw: round(yaw),
        clip: clipOf(m, pick(IDLES)),
      });
      reserve.add(x, z, 0.6);
    }
  };
  /** Мусор у стены или на тротуаре; у мусора — крысы. */
  const litter = (x: number, z: number) => {
    if (!reserve.free(x, z, 0.6)) return;
    put(pick(LITTER), x, z, rand() * Math.PI * 2, 1, surface(x, z));
    if (rand() < 0.25)
      put(
        'items/street-rat',
        x + 0.6,
        z + 0.3,
        rand() * Math.PI * 2,
        1.2,
        surface(x, z),
      );
  };

  // Точки появления держим свободными до всего остального.
  const spawnAt = (x: number, z: number, yaw: number): SpawnPoint => {
    reserve.add(x, z, 3.5);
    return { x, z, y: round(heightAt(x, z)), yaw };
  };
  const spawns = {
    red: [
      spawnAt(-560, 184, 0),
      spawnAt(-540, 176, Math.PI),
      spawnAt(-700, -166, Math.PI / 2),
      spawnAt(-690, -174, 0),
      spawnAt(-445, 622, Math.PI),
      spawnAt(-445, 660, Math.PI / 2),
      spawnAt(-268, 30, Math.PI / 2),
      spawnAt(-268, -30, Math.PI / 2),
      spawnAt(-330, 372, 0),
      spawnAt(-840, 40, 0),
      spawnAt(-120, -700, Math.PI),
      spawnAt(-780, 184, Math.PI / 2),
    ],
    blue: [
      spawnAt(372, 30, -Math.PI / 2),
      spawnAt(372, -30, -Math.PI / 2),
      spawnAt(615, 4, 0),
      spawnAt(420, 682, 0),
      spawnAt(420, 740, -Math.PI / 2),
      spawnAt(760, 790, -Math.PI / 2),
      spawnAt(230, 372, 0),
      spawnAt(150, 570, Math.PI),
      spawnAt(322, -650, Math.PI),
      spawnAt(858, 30, -Math.PI / 2),
      spawnAt(550, -350, Math.PI),
      spawnAt(960, 4, -Math.PI / 2),
    ],
  };

  // --- дороги: ленты рисует сцена; здесь — столбы, люки, фонари ---
  /** Точки вдоль ломаной через `every` м: (x, z, направление). */
  const alongRoad = (
    points: readonly [number, number][],
    first: number,
    every: () => number,
  ) => {
    const out: [number, number, number][] = [];
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1],
        [bx, bz] = points[i];
      const len = Math.hypot(bx - ax, bz - az);
      const dir = Math.atan2(bz - az, bx - ax);
      for (let d = first; d < len - 10; d += every())
        out.push([ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len, dir]);
    }
    return out;
  };
  // Линия электропередачи вдоль шоссе: набор столбов с проводами, как один пролёт.
  for (const road of [ROADS[0], ROADS[3], ROADS[4], ROADS[5]])
    for (const [x0, z0, dir] of alongRoad(
      road.points,
      40,
      () => 110 + rand() * 30,
    )) {
      const off = road.width / 2 + 6;
      const x = x0 - Math.sin(dir) * off,
        z = z0 + Math.cos(dir) * off;
      if (inPlace(x, z, 4) || !reserve.free(x, z, 4)) continue;
      put(
        'structures/modular-electricity-poles',
        x,
        z,
        alongYaw('structures/modular-electricity-poles', dir),
      );
      reserve.add(x, z, 4);
    }
  // Сетки улиц: фонари вдоль тротуаров, люки на проезжей части, щитки на углах.
  const LAMPS: readonly RealModelId[] = [
    'structures/street-lamp-01',
    'props/street-lamp',
  ];
  const streets = (g: Grid) => {
    const xs = gridLines(g.x0, g.x1, g.step),
      zs = gridLines(g.z0, g.z1, g.step);
    for (const x of xs)
      for (let z = g.z0 + 15; z < g.z1 - 8; z += 30) {
        const side = Math.floor(z / 30) % 2 ? 1 : -1;
        if (reserve.free(x + side * 4.6, z, 0.5)) {
          put(
            pick(LAMPS),
            x + side * 4.6,
            z,
            side > 0 ? -Math.PI / 2 : Math.PI / 2,
          );
          reserve.add(x + side * 4.6, z, 0.5);
        }
      }
    for (const z of zs)
      for (let x = g.x0 + 15; x < g.x1 - 8; x += 30) {
        const side = Math.floor(x / 30) % 2 ? 1 : -1;
        if (reserve.free(x, z + side * 4.6, 0.5)) {
          put(pick(LAMPS), x, z + side * 4.6, side > 0 ? Math.PI : 0);
          reserve.add(x, z + side * 4.6, 0.5);
        }
      }
    for (const x of xs)
      for (const z of zs) {
        // Перекрёсток: люк посреди одной из улиц, щиток и гидрант на углах тротуара.
        const lx = x + (rand() < 0.5 ? 1 : -1) * 1.6,
          lz = z + (rand() < 0.5 ? 12 : -12);
        put(
          'structures/water-manhole-cover',
          lx,
          lz,
          rand() * Math.PI,
          1,
          heightAt(lx, lz) + 0.08,
        );
        const cx = x + (rand() < 0.5 ? 5.4 : -5.4),
          cz = z + (rand() < 0.5 ? 5.4 : -5.4);
        if (rand() < 0.5)
          place(
            rand() < 0.6 ? 'structures/utility-box-01' : 'items/fire-hydrant',
            cx,
            cz,
            0.8,
            Math.round(rand() * 4) * (Math.PI / 2),
          );
        if (rand() < 0.35)
          blood(x + (rand() - 0.5) * 6, z + (rand() - 0.5) * 6);
        else if (rand() < 0.5)
          grime(x + (rand() - 0.5) * 5, z + (rand() - 0.5) * 5, 3 + rand() * 3);
      }
  };
  streets(CITY_GRID);
  streets(MEGA_GRID);

  // --- обстановка у стен ---
  /**
   * Дом обрастает тем, что висит и стоит у стен: кондиционеры и пожарная лестница во двор,
   * фонарь и щиток у входа, рольставни и прожектор у ангаров, потёки и битые окна у цоколя.
   */
  const dress = (b: House) => {
    const tall =
      b.kind === 'apt' ||
      b.kind === 'office' ||
      b.m === 'buildings/panel-house';
    const hangar =
      b.kind === 'industrial' ||
      b.m === 'buildings/warehouse' ||
      b.m === 'buildings/factory';
    if (tall) {
      // Кондиционеры — на дворовой и боковых стенах, на случайных этажах. Скан тяжёлый
      // (два блока — 14 тыс. треугольников), поэтому их по одному-два на дом.
      for (let i = Math.floor(rand() * 3); i > 0; i--) {
        const side: Side = pick(['back', 'back', 'left', 'right'] as const);
        const floor = 1 + Math.floor(rand() * Math.max(1, b.floors - 1));
        const p = wall(b, side, rand() * 1.6 - 0.8, 0.22);
        put(
          'structures/exterior-aircon-unit',
          p.x,
          p.z,
          p.yaw,
          1,
          b.y + floor * FLOOR_H + 0.9,
        );
      }
      if (b.floors >= 4 && b.hw > 6 && rand() < 0.6) {
        const p = wall(b, 'back', rand() < 0.5 ? -0.45 : 0.45, 0.72);
        put('structures/modular-fire-escape', p.x, p.z, p.yaw, 1, b.y);
      }
      if (rand() < 0.4) {
        const door = wall(b, 'front', 0, 0.42);
        put(
          'structures/street-lamp-02',
          door.x,
          door.z,
          door.yaw,
          1,
          b.y + 2.7,
        );
      }
      if (rand() < 0.5) {
        const p = wall(b, 'front', 0.6, 0.2);
        put('structures/power-box-01', p.x, p.z, p.yaw, 1, b.y + 1.1);
      }
    }
    // Кран-балка — под крышей склада: на улице она висела бы в воздухе без опор.
    if (b.m === 'buildings/warehouse')
      put(
        'structures/overhead-crane',
        b.x,
        b.z,
        b.yaw + Math.PI / 2,
        1,
        b.y + 2.2,
      );
    if (hangar) {
      const door = wall(b, 'front', rand() * 0.8 - 0.4, 0.16);
      put('structures/rollershutter-door', door.x, door.z, door.yaw, 1, b.y);
      const lamp = wall(b, 'front', rand() < 0.5 ? -0.7 : 0.7, 0.2);
      put('structures/security-light', lamp.x, lamp.z, lamp.yaw, 1, b.y + 4.2);
      const cables = wall(b, 'right', rand() * 0.8 - 0.4, 0.12);
      put(
        'structures/modular-electric-cables',
        cables.x,
        cables.z,
        cables.yaw,
        1,
        b.y + 3.2,
      );
      // Трубы и воздуховод прижаты к стене: рамка дома и так держит вокруг себя пустое место.
      const pipes = wall(b, 'left', rand() * 0.8 - 0.4, 0.2);
      put(
        'structures/modular-industrial-pipes-01',
        pipes.x,
        pipes.z,
        pipes.yaw,
        1,
        b.y,
      );
      const duct = wall(b, 'back', rand() * 0.6 - 0.3, 0.8);
      put(
        'structures/modular-airduct-circular-01',
        duct.x,
        duct.z,
        duct.yaw,
        1,
        b.y,
      );
    }
    // Потёки и грязь у цоколя, битые окна у стены, иногда сидящее у стены тело.
    for (let i = 0; i < 2; i++) {
      const p = wall(
        b,
        pick(['front', 'back', 'left', 'right'] as const),
        rand() * 1.6 - 0.8,
        0.9,
      );
      grime(p.x, p.z, 2.2 + rand() * 2.5, p.yaw);
    }
    if (rand() < 0.35) {
      const p = wall(
        b,
        pick(['front', 'back'] as const),
        rand() * 1.6 - 0.8,
        0.3,
      );
      put(
        rand() < 0.5 ? 'props/broken-window' : 'props/broken-glass-window',
        p.x,
        p.z,
        p.yaw + 0.15,
        1,
        surface(p.x, p.z),
      );
    }
    if (rand() < 0.12) {
      const p = wall(b, 'back', rand() * 1.6 - 0.8, 0.5);
      put(
        rand() < 0.3 ? 'corpses/c2' : pick(SITTING),
        p.x,
        p.z,
        p.yaw,
        1,
        surface(p.x, p.z),
      );
      blood(p.x, p.z, 1.4);
    }
  };

  // --- кварталы ---
  /**
   * Застройка квартала по периметру: дома фасадом на улицу, впритык вдоль тротуара.
   * `models` — из чего строить; середина квартала — двор (`yard`).
   */
  const block = (
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    models: readonly ModelId[],
    yard?: (cx: number, cz: number, w: number, d: number) => void,
  ) => {
    const inset = STREET / 2 + 3;
    const bx0 = x0 + inset,
      bx1 = x1 - inset,
      bz0 = z0 + inset,
      bz1 = z1 - inset;
    const placed: { x0: number; x1: number; z0: number; z1: number }[] = [];
    const overlaps = (a: { x0: number; x1: number; z0: number; z1: number }) =>
      placed.some(
        (b) =>
          a.x0 < b.x1 - 0.2 &&
          a.x1 > b.x0 + 0.2 &&
          a.z0 < b.z1 - 0.2 &&
          a.z1 > b.z0 + 0.2,
      );
    // Стороны: [начало, конец вдоль, линия фасада, ось вдоль x?, поворот фасадом наружу].
    const sides: [number, number, number, boolean, number][] = [
      [bx0, bx1, bz0, true, Math.PI],
      [bx0, bx1, bz1, true, 0],
      [bz0, bz1, bx0, false, -Math.PI / 2],
      [bz0, bz1, bx1, false, Math.PI / 2],
    ];
    for (const [a0, a1, line, alongX, yaw] of sides) {
      let t = a0;
      for (let guard = 0; guard < 40 && t < a1; guard++) {
        const m = pick(models);
        const { hw, hd } = footprint(m, yaw);
        const along = alongX ? hw : hd,
          depth = alongX ? hd : hw;
        if (t + along * 2 > a1) {
          t += 3;
          continue;
        }
        const c = t + along;
        const inward = alongX ? (line === bz0 ? 1 : -1) : line === bx0 ? 1 : -1;
        const x = alongX ? c : line + inward * depth,
          z = alongX ? line + inward * depth : c;
        const rect = { x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd };
        if (
          !overlaps(rect) &&
          reserve.free(x, z, Math.hypot(hw, hd) * 0.85) &&
          rect.x0 >= bx0 - 0.1 &&
          rect.x1 <= bx1 + 0.1 &&
          rect.z0 >= bz0 - 0.1 &&
          rect.z1 <= bz1 + 0.1
        ) {
          dress(
            building(m, x, z, yaw, 1, rand() < 0.25 ? pick(TINTS) : undefined),
          );
          placed.push(rect);
          t += along * 2 + 1 + rand() * 3;
        } else t += 4;
      }
    }
    // Тротуары: мусор и баки у домов, иногда кровь и тела — улицы пережили не одну волну.
    const sidewalk = (t: number, side: number, off: number) =>
      side === 0
        ? [x0 + 7 + (x1 - x0 - 14) * t, z0 + off]
        : side === 1
          ? [x0 + 7 + (x1 - x0 - 14) * t, z1 - off]
          : side === 2
            ? [x0 + off, z0 + 7 + (z1 - z0 - 14) * t]
            : [x1 - off, z0 + 7 + (z1 - z0 - 14) * t];
    for (let i = 0; i < 10; i++) {
      const [x, z] = sidewalk(rand(), Math.floor(rand() * 4), 5.6);
      litter(x, z);
    }
    if (rand() < 0.6) {
      const side = Math.floor(rand() * 4);
      const [x, z] = sidewalk(rand(), side, 5.7);
      place(pick(BINS), x, z, 1.2, side < 2 ? 0 : Math.PI / 2);
    }
    if (rand() < 0.4) {
      const [x, z] = sidewalk(rand(), Math.floor(rand() * 4), 2.5 + rand() * 2);
      body(x, z, rand() < 0.35 ? 'victim' : 'zombie');
    }
    if (yard)
      yard(
        (x0 + x1) / 2,
        (z0 + z1) / 2,
        (x1 - x0) / 2 - 22,
        (z1 - z0) / 2 - 22,
      );
  };
  /** Двор: машины, баки, деревья, хозяйственный хлам — где свободно. */
  const courtyard = (cx: number, cz: number, hw: number, hd: number) => {
    if (hw < 4 || hd < 4) return;
    for (let i = 0; i < 8; i++) {
      const x = cx + (rand() * 2 - 1) * hw,
        z = cz + (rand() * 2 - 1) * hd;
      const roll = rand();
      if (roll < 0.3) {
        const m = pick(CARS);
        if (reserve.free(x, z, halfLength(m))) {
          put(
            m,
            x,
            z,
            Math.round(rand() * 4) * (Math.PI / 2) + (rand() - 0.5) * 0.3,
            1,
            undefined,
            rand() < 0.4 ? pick(TINTS) : undefined,
          );
          reserve.add(x, z, halfLength(m));
        }
      } else if (roll < 0.45)
        place(pick(BINS), x, z, 1.4, Math.round(rand() * 4) * (Math.PI / 2));
      else if (roll < 0.65) place(pick(YARD), x, z, 1);
      else if (roll < 0.9) {
        if (reserve.free(x, z, 2.5)) {
          put(
            rand() < 0.3 ? 'nature/island-tree-01' : 'nature/old-tree',
            x,
            z,
            rand() * Math.PI * 2,
            1.6 + rand() * 0.6,
            heightAt(x, z) - 0.1,
          );
          reserve.add(x, z, 2);
        }
      } else litter(x, z);
    }
    if (rand() < 0.3) grime(cx, cz, 4 + rand() * 3);
    if (rand() < 0.15)
      horde(cx, cz, Math.min(hw, hd), 3 + Math.floor(rand() * 3));
  };
  /** Сквер: деревья, кусты, фонари, кострище; посреди — табличка. */
  const park = (cx: number, cz: number, hw: number, hd: number) => {
    place('props/rusty-sign', cx, cz, 2, 0, 1.2);
    place('items/stone-fire-pit', cx + 4, cz + 3, 1.2);
    for (let i = 0; i < 26; i++) {
      const x = cx + (rand() * 2 - 1) * (hw + 14),
        z = cz + (rand() * 2 - 1) * (hd + 14);
      if (!reserve.free(x, z, 3)) continue;
      const roll = rand();
      put(
        roll < 0.45
          ? 'nature/island-tree-01'
          : roll < 0.85
            ? 'nature/old-tree'
            : 'nature/dead-trees-demo',
        x,
        z,
        rand() * Math.PI * 2,
        roll < 0.85 ? 1.7 + rand() * 0.5 : 0.8,
        heightAt(x, z) - 0.1,
      );
      reserve.add(x, z, 2.5);
    }
    for (let i = 0; i < 18; i++) {
      const x = cx + (rand() * 2 - 1) * (hw + 12),
        z = cz + (rand() * 2 - 1) * (hd + 12);
      if (!reserve.free(x, z, 1)) continue;
      put(
        pick([
          'nature/shrub-02',
          'nature/fern-02',
          'nature/wild-rooibos-bush',
          'nature/nettle-plant',
        ] as const),
        x,
        z,
        rand() * Math.PI * 2,
        1.4,
      );
    }
    for (const [dx, dz] of [
      [-hw, -hd],
      [hw, hd],
      [-hw, hd],
      [hw, -hd],
    ])
      place('props/lantern', cx + dx, cz + dz, 0.5, 0, 1.6);
    horde(cx, cz, 10, 5);
  };
  /** Руины квартала: щебень, кучи земли, остатки стен, сгоревшие машины. */
  const ruin = (cx: number, cz: number, hw: number, hd: number) => {
    for (let i = 0; i < 18; i++) {
      const x = cx + (rand() * 2 - 1) * (hw + 12),
        z = cz + (rand() * 2 - 1) * (hd + 12);
      place(pick(DEBRIS), x, z, 2, rand() * Math.PI * 2, 1 + rand() * 0.4);
    }
    place(
      'vehicles/burnt-cars',
      cx + (rand() - 0.5) * hw,
      cz + (rand() - 0.5) * hd,
      5,
    );
    for (let i = 0; i < 6; i++)
      grime(
        cx + (rand() - 0.5) * hw * 2,
        cz + (rand() - 0.5) * hd * 2,
        3 + rand() * 3,
      );
  };

  /** Наборы застройки (повтор — вес). */
  const NOVO_CORE: readonly ModelId[] = [
    ...APT_HIGH,
    ...OFFICE,
    'buildings/panel-house',
    'buildings/panel-house',
    'buildings/ukraine-apartment',
    'buildings/ukraine-apartment',
    'buildings/destroyed-building',
  ];
  const NOVO: readonly ModelId[] = [
    ...APT_LOW,
    ...APT_HIGH,
    'buildings/panel-house',
    'buildings/panel-house',
    ...RUIN.slice(0, 2),
  ];
  const MEGA_CORE: readonly ModelId[] = [
    ...OFFICE,
    ...OFFICE,
    ...APT_HIGH,
    'buildings/panel-house',
    'buildings/panel-house',
  ];
  const MEGA_MID: readonly ModelId[] = [
    ...APT_HIGH,
    ...OFFICE,
    ...APT_LOW,
    'buildings/ukraine-apartment',
    'buildings/ukraine-apartment',
    'buildings/panel-house',
    'buildings/panel-house',
    'buildings/destroyed-building',
    ...RUIN.slice(0, 3),
  ];
  const MEGA_EDGE: readonly ModelId[] = [
    ...APT_LOW,
    ...INDUSTRIAL,
    'buildings/warehouse',
    'buildings/container-building',
    'buildings/container-building',
    'buildings/factory',
  ];
  const RUINS: readonly ModelId[] = [
    ...RUIN,
    'buildings/ruined-building',
    'buildings/ruined-building',
    'buildings/destroyed-building',
  ];
  /** Промзона: ангары, склады, цех с кран-балкой, трубы, забор из сетки. */
  const industrialBlock = (x0: number, z0: number, x1: number, z1: number) => {
    block(x0, z0, x1, z1, [
      ...INDUSTRIAL,
      'buildings/warehouse',
      'buildings/factory',
      'buildings/container-building',
    ]);
    const cx = (x0 + x1) / 2,
      cz = (z0 + z1) / 2;
    for (let i = 0; i < 10; i++)
      place(
        pick([
          'props/barrels-pallet',
          'props/bricks-pallet',
          'props/oil-barrel',
          'props/pallet',
          'items/storage-cart',
          'items/wooden-crate-2',
        ] as const),
        cx + (rand() - 0.5) * 20,
        cz + (rand() - 0.5) * 20,
        1,
      );
  };

  /**
   * Лагерь выживших: квартал, обнесённый стеной из бытовок с воротами на север и юг;
   * внутри — костры, бочки-печки, припасы, грузовик. Снаружи у стены — тела зомби и
   * новые, которые ломятся внутрь.
   */
  const survivorCamp = (cx: number, cz: number, half: number) => {
    for (const side of [-1, 1]) {
      // Север и юг: две бытовки, между ними ворота; по краям — сетка.
      for (const k of [-1, 1]) {
        building(
          'buildings/container-building',
          cx + k * 9.5,
          cz + side * half,
          0,
        );
        place(
          'structures/modular-chainlink-fence',
          cx + k * 21,
          cz + side * half,
          1,
          0,
        );
        // Восток и запад: бытовки поперёк и сетка у углов.
        building(
          'buildings/container-building',
          cx + side * half,
          cz + k * 7.4,
          Math.PI / 2,
        );
        place(
          'structures/modular-chainlink-fence',
          cx + side * half,
          cz + k * 19,
          1,
          Math.PI / 2,
        );
      }
      put('structures/large-iron-gate', cx, cz + side * half, 0);
      for (const k of [-1, 1])
        put(
          'items/concrete-road-barrier',
          cx + k * 2.4,
          cz + side * (half + 3),
          0,
        );
      place(
        'structures/security-light',
        cx + 4,
        cz + side * (half - 3.4),
        0.3,
        side > 0 ? 0 : Math.PI,
        1,
        heightAt(cx, cz) + 4,
      );
    }
    place('vehicles/gaz66', cx + half - 9, cz + 6, 3.2, 0);
    place('items/covered-car', cx + half - 9, cz - 8, 2.4, 0);
    place('items/wooden-barrels', cx - half + 7, cz - 8, 2.5, 0);
    for (const [dx, dz] of [
      [-4, 3],
      [6, -6],
    ] as const) {
      place('items/stone-fire-pit', cx + dx, cz + dz, 1.2, 0);
      place('items/barrel-stove', cx + dx + 2.5, cz + dz - 1, 0.5);
    }
    for (let i = 0; i < 16; i++)
      place(
        pick([
          'props/barrels-pallet',
          'items/military-crate',
          'items/wooden-crate-2',
          'items/wooden-crate',
          'items/propane-tank',
          'items/jerrycan',
          'props/canister',
          'items/plastic-crate',
          'items/plastic-crate-3',
          'items/steel-shelves',
          'items/storage-cart',
          'items/cardboard-box',
          'props/lantern',
        ] as const),
        cx + (rand() - 0.5) * half * 1.5,
        cz + (rand() - 0.5) * half * 1.5,
        0.8,
      );
    people(CIVILIANS, [
      [cx - 6, cz + 3, Math.PI / 2],
      [cx - 2, cz + 5.5, Math.PI],
      [cx - 4, cz + 0.2, 0],
      [cx + 8.5, cz - 6, -Math.PI / 2],
      [cx + 6, cz - 3.5, Math.PI],
      [cx + 1, cz + half - 3, 0],
      [cx - 1.5, cz - half + 3, Math.PI],
    ]);
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2,
        r = half + 6 + rand() * 12;
      body(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
    }
    // У ворот — толпа, которая ломится внутрь.
    horde(cx, cz + half + 9, 4, 6, Math.PI, 'attack');
    horde(cx, cz - half - 9, 4, 5, 0, 'attack');
  };
  // Новоград: плотная застройка, в центре — лагерь выживших, один квартал в руинах, на краю — промзона.
  {
    const g = CITY_GRID,
      xs = gridLines(g.x0, g.x1, g.step),
      zs = gridLines(g.z0, g.z1, g.step);
    for (let i = 1; i < xs.length; i++)
      for (let j = 1; j < zs.length; j++) {
        const cx = (xs[i - 1] + xs[i]) / 2,
          cz = (zs[j - 1] + zs[j]) / 2;
        if (i === 3 && j === 3) {
          survivorCamp(cx, cz, 22);
          continue;
        }
        if (i === 5 && j === 2) {
          block(xs[i - 1], zs[j - 1], xs[i], zs[j], RUINS);
          ruin(cx, cz, 10, 10);
          massacre(cx, cz, 14, 9);
          horde(cx, cz, 10, 7);
          continue;
        }
        if (i === 1 && j === 6) {
          industrialBlock(xs[i - 1], zs[j - 1], xs[i], zs[j]);
          continue;
        }
        block(
          xs[i - 1],
          zs[j - 1],
          xs[i],
          zs[j],
          Math.hypot(cx - PLACES.city.x, cz - PLACES.city.z) < 100
            ? NOVO_CORE
            : NOVO,
          courtyard,
        );
      }
  }
  // Мегаполис: высотки в сердцевине, вокруг — жилые дома, по краю — склады и промзона; сквер в центре.
  {
    const g = MEGA_GRID,
      xs = gridLines(g.x0, g.x1, g.step),
      zs = gridLines(g.z0, g.z1, g.step);
    for (let i = 1; i < xs.length; i++)
      for (let j = 1; j < zs.length; j++) {
        const cx = (xs[i - 1] + xs[i]) / 2,
          cz = (zs[j - 1] + zs[j]) / 2;
        const d = Math.hypot(cx - PLACES.megapolis.x, cz - PLACES.megapolis.z);
        if (i === 4 && j === 4) {
          park(cx, cz, 12, 12);
          continue;
        }
        if ((i === 2 && j === 7) || (i === 6 && j === 2)) {
          block(xs[i - 1], zs[j - 1], xs[i], zs[j], RUINS);
          ruin(cx, cz, 14, 14);
          massacre(cx, cz, 16, 12);
          horde(cx, cz, 12, 8);
          continue;
        }
        if ((i === 7 && j === 6) || (i === 1 && j === 1)) {
          industrialBlock(xs[i - 1], zs[j - 1], xs[i], zs[j]);
          continue;
        }
        block(
          xs[i - 1],
          zs[j - 1],
          xs[i],
          zs[j],
          d < 150 ? MEGA_CORE : d < 250 ? MEGA_MID : MEGA_EDGE,
          courtyard,
        );
      }
  }
  // Зомби на улицах городов: группы на перекрёстках и посреди кварталов.
  for (const [g, n] of [
    [CITY_GRID, 6],
    [MEGA_GRID, 9],
  ] as const) {
    const xs = gridLines(g.x0, g.x1, g.step),
      zs = gridLines(g.z0, g.z1, g.step);
    for (let i = 0; i < n; i++) {
      const alongX = rand() < 0.5;
      const x = alongX ? g.x0 + rand() * (g.x1 - g.x0) : pick(xs),
        z = alongX ? pick(zs) : g.z0 + rand() * (g.z1 - g.z0);
      horde(
        x,
        z,
        3,
        3 + Math.floor(rand() * 4),
        alongX
          ? rand() < 0.5
            ? Math.PI / 2
            : -Math.PI / 2
          : rand() < 0.5
            ? 0
            : Math.PI,
      );
    }
  }

  // --- деревни ---
  const VILLAGE_HOUSES: readonly ModelId[] = [
    ...HOUSE,
    ...HOUSE,
    'buildings/abandoned-house-2',
    'buildings/abandoned-house-3',
    'buildings/abandoned-house-3',
    'buildings/destroyed-house',
    'buildings/destroyed-house',
    ...RUIN_HOUSE,
  ];
  /** Дом с участком: сарай, хозяйственный хлам, дерево; во дворе — то, что осталось от хозяев. */
  const homestead = (
    x: number,
    z: number,
    yaw: number,
    set: readonly ModelId[],
  ) => {
    let m = pick(set);
    const r = Math.hypot(footprint(m, yaw).hw, footprint(m, yaw).hd);
    if (!reserve.free(x, z, r * 0.85)) {
      m = pick(HOUSE);
      if (!reserve.free(x, z, 7)) return;
    }
    const b = building(m, x, z, yaw, 1, rand() < 0.2 ? pick(TINTS) : undefined);
    dress(b);
    const back = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const side = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const at = (b0: number, s0: number) =>
      [x + back.x * b0 + side.x * s0, z + back.z * b0 + side.z * s0] as const;
    if (rand() < 0.3) {
      const [sx, sz] = at(b.hd + 8, rand() < 0.5 ? -6 : 6);
      if (reserve.free(sx, sz, 6))
        building('buildings/barn', sx, sz, yaw + Math.PI, 0.8);
    }
    for (let i = 0; i < 3; i++) {
      const [yx, yz] = at(b.hd + 2 + rand() * 6, rand() * 14 - 7);
      place(
        pick([
          'items/wooden-barrels',
          'items/wooden-ladder',
          'items/wooden-crate',
          'items/old-tyre',
          'items/hand-truck',
          'items/barrel',
          'items/propane-tank',
          'items/jerrycan',
          'props/dirt-pile',
          'nature/tree-stump-02',
          'nature/dry-branches-medium-01',
          'items/stone-fire-pit',
        ] as const),
        yx,
        yz,
        1.2,
      );
    }
    const roll = rand();
    if (roll < 0.14) {
      const [bx, bz] = at(b.hd + 4, rand() * 6 - 3);
      body(bx, bz, rand() < 0.5 ? 'victim' : 'zombie');
    } else if (roll < 0.3) {
      const [lx, lz] = at(-b.hd - 4, 4);
      litter(lx, lz);
    }
    const [tx, tz] = at(b.hd * 0.5, rand() < 0.5 ? -b.hw - 5 : b.hw + 5);
    if (reserve.free(tx, tz, 2)) {
      put(
        rand() < 0.7 ? 'nature/old-tree' : 'nature/island-tree-01',
        tx,
        tz,
        rand() * Math.PI * 2,
        1.7 + rand() * 0.5,
        heightAt(tx, tz) - 0.1,
      );
      reserve.add(tx, tz, 2);
    }
    // Бурьян у заборов: крапива, сорняки, кусты — мелочь без столкновений.
    for (let i = 0; i < 4; i++) {
      const [wx, wz] = at(
        rand() * 16 - 8,
        (rand() < 0.5 ? -1 : 1) * (b.hw + 2 + rand() * 4),
      );
      if (reserve.free(wx, wz, 0.5))
        put(
          pick([
            'nature/nettle-plant',
            'nature/weed-plant-02',
            'nature/shrub-01',
            'nature/shrub-03',
            'nature/shrub-04',
            'nature/grass-bermuda-01',
          ] as const),
          wx,
          wz,
          rand() * Math.PI * 2,
          1.4 + rand() * 0.6,
        );
    }
  };
  /** Деревня вдоль улицы: дома по обе стороны фасадом к ней. */
  const village = (
    p: Place,
    axis: 'x' | 'z',
    rows = 1,
    set = VILLAGE_HOUSES,
  ) => {
    const len = axis === 'x' ? p.hw : p.hd;
    for (let row = 0; row < rows; row++)
      for (const sgn of [-1, 1])
        for (let t = -len + 10; t <= len - 10; t += 24 + rand() * 6) {
          const off = sgn * (18 + row * 30);
          const x = axis === 'x' ? p.x + t : p.x + off,
            z = axis === 'x' ? p.z + off : p.z + t;
          if (roadEdge(x, z) < 10) continue;
          // Фасадом к улице: к оси деревни.
          const yaw =
            axis === 'x'
              ? sgn < 0
                ? 0
                : Math.PI
              : sgn < 0
                ? Math.PI / 2
                : -Math.PI / 2;
          homestead(x, z, yaw, set);
        }
  };
  village(PLACES.berezovka, 'x', 2);
  village(PLACES.sosnovka, 'x', 2);
  village(PLACES.zarechye, 'z', 2);
  village(PLACES.stepnoe, 'z', 2);
  village(PLACES.gorny, 'x', 1);
  // Дачи: ровные ряды маленьких домиков у шоссе.
  village(PLACES.dachas, 'x', 2, [
    ...DACHA,
    ...DACHA,
    'buildings/abandoned-house-3',
    'buildings/container-building',
  ]);
  // Кострище в центре деревни и бродячие мертвецы на улицах.
  for (const p of [
    PLACES.berezovka,
    PLACES.sosnovka,
    PLACES.zarechye,
    PLACES.stepnoe,
    PLACES.gorny,
    PLACES.dachas,
  ]) {
    place('items/stone-fire-pit', p.x + 6, p.z + 9, 2, 0);
    place('items/wooden-barrels', p.x - 8, p.z + 10, 2.5, rand() * Math.PI);
    horde(
      p.x + (rand() - 0.5) * p.hw,
      p.z + (rand() - 0.5) * 8,
      5,
      3 + Math.floor(rand() * 3),
    );
  }
  // Поля у деревень: бурьян и сорняки по краям пашни, редкие брошенные тракторы.
  for (let x = -1000; x < 1000; x += 9)
    for (let z = -1000; z < 1000; z += 9) {
      if (!fieldAt(x, z) || rand() > 0.25) continue;
      const fx = x + rand() * 4,
        fz = z + rand() * 4;
      if (!reserve.free(fx, fz, 1)) continue;
      put(
        pick([
          'nature/weed-plant-02',
          'nature/grass-bermuda-01',
          'nature/wild-rooibos-bush',
          'nature/dry-branches-medium-01',
        ] as const),
        fx,
        fz,
        rand() * Math.PI * 2,
        1.6,
      );
    }

  // --- особые места ---
  // Колхоз: амбары, ангар, коровник, тракторы и грузовик, бочки, кучи земли.
  {
    const p = PLACES.farm;
    building('buildings/barn', p.x - 40, p.z - 30, 0);
    building('buildings/barn', p.x - 22, p.z - 32, 0);
    building('buildings/warehouse', p.x + 15, p.z - 40, 0);
    dress(building(INDUSTRIAL[0], p.x + 62, p.z - 25, -Math.PI / 2));
    for (const [m, dx, dz, yaw] of [
      ['vehicles/tractor', -10, -8, 0.6],
      ['vehicles/tractor', 30, 30, 2.2],
      ['vehicles/gaz66', 40, 5, 1.4],
    ] as const)
      place(m, p.x + dx, p.z + dz, 3, yaw);
    for (let i = 0; i < 24; i++)
      place(
        pick([
          'props/dirt-pile',
          'items/wooden-barrels',
          'props/barrels-pallet',
          'props/pallet',
          'items/old-tyre',
          'items/barrel',
          'items/hand-truck',
          'items/wooden-ladder',
          'items/storage-cart',
          'props/bricks-pallet',
        ] as const),
        p.x + (rand() * 2 - 1) * p.hw * 0.8,
        p.z - 10 + rand() * 30,
        1.6,
      );
    // Поле колхоза заросло: бурьян, сухие ветки, кучи земли — пашня не голая.
    for (let x = p.x - p.hw; x < p.x + p.hw; x += 7)
      for (let z = p.z + 15; z < p.z + p.hd; z += 7) {
        if (rand() > 0.4) continue;
        const fx = x + rand() * 4,
          fz = z + rand() * 4;
        if (reserve.free(fx, fz, 1))
          put(
            pick([
              'nature/weed-plant-02',
              'nature/grass-bermuda-01',
              'nature/wild-rooibos-bush',
              'nature/shrub-02',
              'nature/dry-branches-medium-01',
            ] as const),
            fx,
            fz,
            rand() * Math.PI * 2,
            1.6,
          );
      }
    massacre(p.x + 20, p.z + 40, 20, 8, 0.3);
    horde(p.x + 10, p.z + 20, 8, 5);
  }
  // Кладбище: кованая ограда с воротами, ряды холмиков с камнями и табличками.
  {
    const p = PLACES.cemetery;
    const GATE = 3;
    for (
      let x = p.x - p.hw + GATE / 2;
      x <= p.x + p.hw - GATE / 2 + 0.01;
      x += GATE
    )
      for (const z of [p.z - p.hd, p.z + p.hd]) {
        if (Math.abs(x - p.x) < GATE && z > p.z) continue;
        put('structures/large-iron-gate', x, z, 0);
      }
    for (
      let z = p.z - p.hd + GATE / 2;
      z <= p.z + p.hd - GATE / 2 + 0.01;
      z += GATE
    )
      for (const x of [p.x - p.hw, p.x + p.hw])
        put('structures/large-iron-gate', x, z, Math.PI / 2);
    // Ворота — та же решётка, распахнутая.
    put('structures/large-iron-gate', p.x - 1.4, p.z + p.hd + 1.4, -1.2);
    for (let x = p.x - p.hw + 5; x < p.x + p.hw - 4; x += 4.5)
      for (let z = p.z - p.hd + 6; z < p.z + p.hd - 6; z += 5.5) {
        if (rand() < 0.15) continue;
        // Надгробия: ржавые таблички, бетонные плиты и камни.
        const roll = rand();
        if (roll < 0.4)
          put('props/rusty-sign', x, z, (rand() - 0.5) * 0.3, 0.3);
        else if (roll < 0.75)
          put(
            'props/concrete-barrier-scan',
            x,
            z,
            Math.PI / 2 + (rand() - 0.5) * 0.3,
            0.55,
          );
        else
          put(
            'nature/rock-face-02',
            x,
            z,
            (rand() - 0.5) * 0.3,
            0.28 + rand() * 0.06,
          );
        put(
          'props/dirt-pile',
          x,
          z + 1.6,
          (rand() - 0.5) * 0.3,
          0.32,
          heightAt(x, z + 1.6) - 0.08,
        );
        if (rand() < 0.2) place('props/lantern', x + 0.7, z + 0.4, 0.2, 0, 1);
      }
    reserve.add(p.x, p.z, Math.max(p.hw, p.hd));
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2,
        r = Math.max(p.hw, p.hd) + 6 + rand() * 12;
      const x = p.x + Math.cos(a) * r,
        z = p.z + Math.sin(a) * r;
      if (reserve.free(x, z, 3)) {
        put(
          rand() < 0.6 ? 'nature/dead-trees-demo' : 'nature/old-tree',
          x,
          z,
          rand() * Math.PI * 2,
          rand() < 0.6 ? 0.9 : 2.4,
          heightAt(x, z) - 0.1,
        );
        reserve.add(x, z, 3);
      }
    }
    // Поднявшиеся мертвецы, которых уложили второй раз, — у разрытых могил.
    for (let i = 0; i < 9; i++)
      body(
        p.x + (rand() - 0.5) * p.hw * 1.6,
        p.z + (rand() - 0.5) * p.hd * 1.6,
      );
    horde(p.x - 12, p.z, 8, 7);
    horde(p.x + 15, p.z + 8, 6, 6);
    // Братская могила за оградой: тела под простынями в ряд, мешки, свежая земля.
    const gx = p.x + p.hw + 22,
      gz = p.z + 6;
    reserve.add(gx, gz, 10);
    for (let i = 0; i < 3; i++)
      put(
        'corpses/c3',
        gx - 4,
        gz - 5 + i * 2,
        0,
        1,
        surface(gx - 4, gz - 5 + i * 2),
      );
    for (let i = 0; i < 5; i++)
      put(
        pick(SITTING),
        gx - 7 + i * 1.3,
        gz + 3.5,
        Math.PI,
        1,
        surface(gx - 7 + i * 1.3, gz + 3.5),
      );
    for (let i = 0; i < 6; i++)
      put(
        'corpses/c1',
        gx + 2 + (i % 3) * 1,
        gz - 4 + Math.floor(i / 3) * 2.4,
        0.05 * (rand() - 0.5),
        1,
        surface(gx + 2 + (i % 3), gz),
      );
    put('props/dirt-pile', gx + 7, gz, rand() * Math.PI * 2);
    put('props/dirt-pile', gx + 6, gz + 5, rand() * Math.PI * 2, 0.8);
    massacre(gx, gz, 7, 10, 0.6);
  }
  // Военная база: стена из бытовок, сетка у ворот, техника, склад, ящики, — и тела у ворот.
  {
    const p = PLACES.base;
    const L = 14.3;
    for (let x = p.x - p.hw + L / 2; x <= p.x + p.hw - L / 2 + 0.01; x += L)
      for (const z of [p.z - p.hd, p.z + p.hd])
        put('buildings/container-building', x, z, 0, 1, heightAt(x, z) - 0.05);
    for (let z = p.z - p.hd + L / 2; z <= p.z + p.hd - L / 2 + 0.01; z += L)
      for (const x of [p.x - p.hw, p.x + p.hw]) {
        // Ворота с запада — на дороге: там сетка и распахнутая решётка вместо бытовок.
        if (x < p.x && Math.abs(z - 790) < 20) continue;
        put(
          'buildings/container-building',
          x,
          z,
          Math.PI / 2,
          1,
          heightAt(x, z) - 0.05,
        );
      }
    for (const k of [-1, 1])
      put(
        'structures/modular-chainlink-fence',
        p.x - p.hw,
        790 + k * 13,
        Math.PI / 2,
      );
    put('structures/large-iron-gate', p.x - p.hw - 1.2, 790 - 5.5, 1.1);
    // Казармы — ряды бытовок, ангар, цех.
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 2; j++)
        dress(
          building(
            'buildings/container-building',
            p.x - 60 + i * 18,
            p.z - 60 + j * 14,
            0,
          ),
        );
    dress(building('buildings/warehouse', p.x + 55, p.z - 55, Math.PI / 2));
    dress(building(INDUSTRIAL[1], p.x + 50, p.z + 55, 0));
    // Техника: бронетранспортёры и грузовики; часть сгорела при прорыве.
    for (let i = 0; i < 7; i++) {
      const m = pick(MILITARY);
      put(
        m,
        p.x - 10 + (i % 4) * 9,
        p.z - 15 + Math.floor(i / 4) * 12,
        alongYaw(m, Math.PI / 2),
        1,
        undefined,
        rand() < 0.3 ? '#8a827a' : undefined,
      );
    }
    for (let i = 0; i < 26; i++)
      place(
        pick([
          'items/military-crate',
          'items/military-crate',
          'items/wooden-crate-2',
          'props/oil-barrel',
          'props/barrels-pallet',
          'items/barrel',
          'items/jerrycan',
          'props/canister',
          'items/propane-tank',
          'items/steel-shelves',
          'items/storage-cart',
          'items/hand-truck',
        ] as const),
        p.x + 20 + (rand() * 2 - 1) * 50,
        p.z + 10 + rand() * 40,
        0.9,
      );
    for (let i = 0; i < 6; i++)
      place('props/barriers', p.x - 40 + i * 12, p.z + 30, 6, 0);
    for (let i = 0; i < 8; i++)
      place('structures/street-lamp-01', p.x - 80 + i * 22, p.z - 30, 0.4, 0);
    // База пала: тела солдат и зомби по всему лагерю, у ворот — гуще.
    massacre(p.x - 30, p.z - 10, 40, 30, 0.1, 0.3);
    massacre(p.x - p.hw - 10, 790, 12, 14, 0.1, 0.4);
    for (let i = 0; i < 3; i++)
      put(
        'corpses/c3',
        p.x - 70,
        p.z + 40 + i * 2.2,
        Math.PI / 2,
        1,
        surface(p.x - 70, p.z + 40 + i * 2.2),
      );
    horde(p.x - 20, p.z, 15, 8);
    horde(p.x + 30, p.z + 30, 12, 7);
    horde(p.x - p.hw - 18, 790, 6, 6, 0);
  }
  // Лагерь альпинистов: кострище, брёвна-скамейки, снаряжение на горном плато.
  {
    const p = PLACES.climbers;
    place('items/stone-fire-pit', p.x, p.z, 1.2, 0);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      place(
        'nature/dead-tree-trunk',
        p.x + Math.cos(a) * 3.2,
        p.z + Math.sin(a) * 3.2,
        1,
        -a + Math.PI / 2,
      );
    }
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2,
        r = 5 + rand() * 14;
      place(
        pick([
          'props/lantern',
          'items/jerrycan',
          'items/propane-tank',
          'items/plastic-crate',
          'items/wooden-crate',
          'items/cardboard-box',
          'props/canister',
          'items/rusted-can',
          'nature/dry-branches-medium-01',
        ] as const),
        p.x + Math.cos(a) * r,
        p.z + Math.sin(a) * r,
        0.6,
      );
    }
    place('nature/rock-moss-set-01', p.x - 18, p.z + 10, 5, 0.4);
    place('nature/rock-face-01', p.x + 20, p.z - 12, 4, 2.1, 1.5);
    // До лагеря они тоже добрались.
    massacre(p.x + 6, p.z + 8, 9, 5, 0.6);
    horde(p.x - 8, p.z + 14, 6, 4);
  }
  // Лесопилка: цех, пилорама-склад с кран-балкой, штабеля брёвен, старый грузовик.
  {
    const p = PLACES.sawmill;
    // Набор панелей фасада — недостроенный цех на заднем плане (панели в нём стоят с зазорами).
    building('structures/modular-factory-facade', p.x - 8, p.z - 36, 0, 0.5);
    dress(building('buildings/factory', p.x - 22, p.z - 12, 0));
    dress(building('buildings/warehouse', p.x + 28, p.z - 22, 0));
    // Штабеля: брёвна рядом в два слоя.
    for (const [sx, sz] of [
      [p.x + 6, p.z + 2],
      [p.x + 18, p.z + 6],
      [p.x - 8, p.z + 18],
    ]) {
      if (!reserve.free(sx, sz, 2.5)) continue;
      for (let layer = 0; layer < 2; layer++)
        for (let k = 0; k < 5 - layer; k++)
          put(
            'nature/dead-tree-trunk',
            sx,
            sz - 1 + k * 0.32 + layer * 0.16,
            0,
            1.4,
            heightAt(sx, sz) + layer * 0.3,
          );
      reserve.add(sx, sz, 2.5);
    }
    for (let i = 0; i < 14; i++)
      place(
        pick([
          'nature/dead-tree-trunk-02',
          'nature/tree-stump-02',
          'items/wooden-ladder',
          'items/hand-truck',
          'items/wooden-barrels',
          'props/pallet',
          'items/wooden-crate-2',
          'nature/dry-branches-medium-01',
        ] as const),
        p.x + (rand() * 2 - 1) * p.hw,
        p.z + rand() * p.hd,
        1.6,
      );
    place('vehicles/gaz66', p.x + 8, p.z - 6, 3.5, 1.2);
    body(p.x - 6, p.z + 12, 'victim');
    massacre(p.x + 10, p.z + 20, 8, 4, 0);
    horde(p.x + 5, p.z + 25, 6, 4);
  }
  // Свалка: сгоревшие и ржавые машины рядами, покрышки, диски, кучи земли, забор из сетки.
  {
    const p = PLACES.junkyard;
    for (let x = p.x - p.hw + 4; x <= p.x + p.hw - 4; x += 8.1)
      for (const z of [p.z - p.hd, p.z + p.hd])
        put('structures/modular-chainlink-fence', x, z, 0);
    for (let z = p.z - p.hd + 4; z <= p.z + p.hd - 4; z += 8.1) {
      if (Math.abs(z - 300) < 6) continue;
      for (const x of [p.x - p.hw, p.x + p.hw])
        put('structures/modular-chainlink-fence', x, z, Math.PI / 2);
    }
    put('structures/large-iron-gate', p.x - p.hw - 1.2, 300 + 5.5, 1.2);
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 6; k++) {
        const m = pick([
          'vehicles/burnt-cars',
          'vehicles/junk-car',
          'vehicles/junk-car',
          'vehicles/car',
          'vehicles/junk-car',
        ] as const);
        place(
          m,
          p.x - 35 + k * 13,
          p.z - 28 + row * 17,
          halfLength(m) * 0.8,
          alongYaw(m, (rand() - 0.5) * 0.4),
        );
      }
    place(
      'vehicles/destroyed-bus',
      p.x + 30,
      p.z + 30,
      6,
      alongYaw('vehicles/destroyed-bus', 0.1),
    );
    for (let i = 0; i < 40; i++) {
      const x = p.x + (rand() * 2 - 1) * p.hw * 0.9,
        z = p.z + (rand() * 2 - 1) * p.hd * 0.9;
      const m = pick([
        'items/old-tyre',
        'items/rusted-wheel-rim',
        'props/dirt-pile',
        'props/rubble-pile',
        'items/metal-trash-can',
        'items/trashbag',
        'props/oil-barrel',
      ] as const);
      if (place(m, x, z, m === 'props/dirt-pile' ? 2.5 : 0.8) && rand() < 0.3)
        put(
          'items/street-rat',
          x + 0.7,
          z,
          rand() * Math.PI * 2,
          1.2,
          surface(x, z),
        );
    }
    for (let i = 0; i < 10; i++)
      grime(
        p.x + (rand() * 2 - 1) * p.hw,
        p.z + (rand() * 2 - 1) * p.hd,
        3 + rand() * 4,
      );
    massacre(p.x, p.z, 12, 5, 0.4);
    horde(p.x + 10, p.z - 5, 8, 5);
  }

  // --- брошенные машины: пробки на выездах, одиночки на шоссе ---
  const wreck = (m: RealModelId, x: number, z: number, yaw: number) => {
    const r = halfLength(m) * 0.75;
    if (!reserve.free(x, z, r)) return;
    put(
      m,
      x,
      z,
      yaw,
      1,
      surface(x, z) - 0.02,
      rand() < 0.35 ? pick(TINTS) : undefined,
    );
    reserve.add(x, z, r);
    // У открытой двери — водитель, не успевший уйти, или тот, кто его догнал.
    const roll = rand();
    if (roll < 0.3) {
      const side = rand() < 0.5 ? -1 : 1;
      body(
        x + Math.cos(yaw) * side * 2.2,
        z - Math.sin(yaw) * side * 2.2,
        rand() < 0.6 ? 'victim' : 'zombie',
      );
    } else if (roll < 0.51)
      blood(x + (rand() - 0.5) * 5, z + (rand() - 0.5) * 5);
    if (rand() < 0.3) {
      const dx = (rand() - 0.5) * 8,
        dz = (rand() - 0.5) * 8;
      if (reserve.free(x + dx, z + dz, 0.8))
        put(
          pick([
            'items/old-tyre',
            'items/rusted-wheel-rim',
            'items/cardboard-box',
            'items/trashbag',
          ] as const),
          x + dx,
          z + dz,
          rand() * Math.PI * 2,
          1,
          surface(x + dx, z + dz),
        );
    }
  };
  // Пробка между Новоградом и Мегаполисом: по две полосы, машины разной длины; во главе — автобус.
  wreck('vehicles/bus', 104, 2.2, alongYaw('vehicles/bus', 0) + 0.1);
  wreck(
    'vehicles/destroyed-bus',
    60,
    368,
    alongYaw('vehicles/destroyed-bus', 0) - 0.15,
  );
  for (const lane of [-2, 2]) {
    let x = 110 + rand() * 6;
    while (x < 355) {
      const m = pick(JAM);
      const half = halfLength(m);
      x += half;
      if (rand() < 0.85)
        wreck(
          m,
          x,
          lane + (rand() - 0.5) * 0.6,
          alongYaw(m, 0) + (rand() - 0.5) * 0.35,
        );
      x += half + 1.2 + rand() * 4;
    }
  }
  // Брошенные машины на городских улицах: у обочины и посреди полосы, между перекрёстками.
  for (const g of [CITY_GRID, MEGA_GRID]) {
    const xs = gridLines(g.x0, g.x1, g.step),
      zs = gridLines(g.z0, g.z1, g.step);
    const spans: [number, number, number, number][] = [
      ...xs.flatMap((x) =>
        zs
          .slice(1)
          .map((z, i): [number, number, number, number] => [x, zs[i], x, z]),
      ),
      ...zs.flatMap((z) =>
        xs
          .slice(1)
          .map((x, i): [number, number, number, number] => [xs[i], z, x, z]),
      ),
    ];
    for (const [ax, az, bx, bz] of spans) {
      const dir = Math.atan2(bz - az, bx - ax),
        len = Math.hypot(bx - ax, bz - az);
      for (let n = rand() < 0.55 ? 1 + Math.floor(rand() * 2) : 0; n > 0; n--) {
        const t = 12 + rand() * (len - 24),
          lane = (rand() < 0.5 ? -1 : 1) * (1.6 + rand() * 0.6);
        const m = pick(rand() < 0.1 ? JAM : CARS);
        wreck(
          m,
          ax + Math.cos(dir) * t - Math.sin(dir) * lane,
          az + Math.sin(dir) * t + Math.cos(dir) * lane,
          alongYaw(m, dir) + (rand() - 0.5) * 0.4,
        );
      }
    }
  }
  horde(200, 6, 6, 6, Math.PI / 2);
  horde(300, -6, 6, 5, -Math.PI / 2);
  // Одиночные машины по всем дорогам, часть — поперёк; на грунтовках — техника.
  for (const road of ROADS) {
    const track = road.width <= TRACK;
    for (const [x0, z0, dir] of alongRoad(
      road.points,
      30 + rand() * 60,
      () => 60 + rand() * 140,
    )) {
      const lane = (rand() < 0.5 ? -1 : 1) * road.width * 0.25;
      const x = x0 - Math.sin(dir) * lane,
        z = z0 + Math.cos(dir) * lane;
      if (inPlace(x, z, 0) && rand() < 0.6) continue;
      const m = track
        ? pick([
            'vehicles/junk-car',
            'vehicles/tractor',
            'vehicles/gaz66',
            'vehicles/car',
          ] as const)
        : pick(JAM);
      wreck(
        m,
        x,
        z,
        alongYaw(m, dir) + (rand() < 0.25 ? rand() * 3 : (rand() - 0.5) * 0.3),
      );
    }
  }
  /**
   * Блокпост поперёк дороги (`dir` — её направление): бетонные блоки с проездом, барьеры,
   * конусы, бронетехника у обочины. `held` — его ещё держат солдаты, иначе он пал: за ним
   * тела солдат и полицейских, перед ним — волна зомби.
   */
  const checkpoint = (x: number, z: number, dir: number, held: boolean) => {
    const nx = -Math.sin(dir),
      nz = Math.cos(dir);
    const ax = Math.cos(dir),
      az = Math.sin(dir);
    for (const k of [-3.2, -1.7, 1.7, 3.2]) {
      const bx = x + nx * k,
        bz = z + nz * k;
      put(
        'items/concrete-road-barrier',
        bx,
        bz,
        alongYaw('items/concrete-road-barrier', dir + Math.PI / 2),
        1,
        surface(bx, bz) - 0.02,
      );
      reserve.add(bx, bz, 0.8);
    }
    for (const k of [-5.5, 5.5])
      place(
        'props/concrete-barrier-scan',
        x + nx * k - ax * 3,
        z + nz * k - az * 3,
        1,
        alongYaw('props/concrete-barrier-scan', dir),
      );
    for (const k of [-0.5, 0.5])
      place(
        'props/traffic-cone',
        x + nx * k + ax * 4,
        z + nz * k + az * 4,
        0.3,
      );
    place(
      'props/barriers',
      x + nx * 9 - ax * 8,
      z + nz * 9 - az * 8,
      6,
      alongYaw('props/barriers', dir),
    );
    const m = pick(MILITARY);
    place(
      m,
      x - nx * 9 - ax * 10,
      z - nz * 9 - az * 10,
      halfLength(m) * 0.7,
      alongYaw(m, dir) + 0.2,
    );
    for (let i = 0; i < 4; i++)
      place(
        pick([
          'items/military-crate',
          'props/oil-barrel',
          'items/barrel-stove',
          'items/jerrycan',
        ] as const),
        x + nx * (7 + rand() * 3) - ax * (4 + rand() * 6),
        z + nz * (7 + rand() * 3) - az * (4 + rand() * 6),
        0.6,
      );
    const behindX = x - ax * 12,
      behindZ = z - az * 12;
    if (held) {
      people(SOLDIERS, [
        [x - ax * 2 + nx * 2.5, z - az * 2 + nz * 2.5, Math.PI / 2 - dir],
        [x - ax * 2 - nx * 2.5, z - az * 2 - nz * 2.5, Math.PI / 2 - dir],
        [behindX + nx * 6, behindZ + nz * 6, Math.PI / 2 - dir + 0.4],
        [behindX - nx * 4, behindZ - nz * 4, -Math.PI / 2 - dir],
      ]);
      massacre(x + ax * 14, z + az * 14, 8, 10, 0);
    } else {
      massacre(behindX, behindZ, 9, 12, 0.2, 0.4);
      massacre(x + ax * 6, z + az * 6, 6, 5, 0.1);
      horde(x + ax * 3, z + az * 3, 6, 6, Math.PI / 2 - dir + Math.PI);
    }
  };
  checkpoint(362, 0, Math.PI, false);
  checkpoint(-280, 180, 0, false);
  checkpoint(-30, 252, -Math.PI / 2, true);
  // Указатели на въездах в города.
  for (const [x, z, yaw] of [
    [-300, 190, 0],
    [340, 10, 0],
    [-40, 280, Math.PI / 2],
  ] as const)
    place('props/rusty-sign', x, z, 2, yaw);
  // Одиночные тела и кровь вдоль дорог — следы тех, кто уходил пешком.
  for (const road of ROADS)
    for (const [x0, z0] of alongRoad(
      road.points,
      40 + rand() * 80,
      () => 90 + rand() * 160,
    )) {
      const x = x0 + (rand() - 0.5) * 12,
        z = z0 + (rand() - 0.5) * 12;
      if (rand() < 0.6) body(x, z, rand() < 0.4 ? 'victim' : 'zombie');
      else blood(x, z);
      if (rand() < 0.1)
        horde(x + (rand() - 0.5) * 20, z + (rand() - 0.5) * 20, 4, 3);
    }

  // --- природа ---
  const wildOk = (x: number, z: number, r: number) =>
    Math.abs(x) < HALF - 2 &&
    Math.abs(z) < HALF - 2 &&
    !inPlace(x, z, 6) &&
    roadEdge(x, z) > 3 + r &&
    Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r + 4 &&
    reserve.free(x, z, r);
  /**
   * Дерево леса. Сканы тяжёлые (сосенки и лиственное дерево — по 50 тыс. треугольников),
   * поэтому основа леса — лёгкое старое дерево и набор сухих деревьев, а тяжёлых — ~14 %:
   * в круге видимости леса их иначе было бы под тысячу (дальше 150 м их не рисует сцена).
   */
  const forestTree = (x: number, z: number): [RealModelId, number] => {
    const r = rand();
    if (pineForest(x, z))
      return r < 0.12
        ? ['nature/pine-sapling-small', 4 + rand() * 1.5]
        : r < 0.8
          ? ['nature/old-tree', 2.2 + rand() * 0.8]
          : ['nature/dead-trees-demo', 0.9 + rand() * 0.3];
    return r < 0.62
      ? ['nature/old-tree', 2.2 + rand() * 0.8]
      : r < 0.86
        ? ['nature/dead-trees-demo', 0.9 + rand() * 0.3]
        : r < 0.94
          ? ['nature/island-tree-01', 1.9 + rand() * 0.6]
          : ['nature/pine-sapling-small', 4 + rand() * 1.5];
  };
  const ROCKS: readonly RealModelId[] = [
    'nature/rock-face-01',
    'nature/rock-face-02',
    'nature/boulder-01',
    'nature/namaqualand-boulder-02',
    'nature/namaqualand-boulder-04',
    'nature/namaqualand-boulder-06',
    'nature/rock-moss-set-01',
  ];
  /** Масштаб камня: сканы разного размера, на склоне нужны глыбы в рост человека и выше. */
  const rockScale = (m: RealModelId) =>
    m === 'nature/rock-moss-set-01'
      ? 0.8 + rand() * 0.5
      : m === 'nature/namaqualand-boulder-06'
        ? 1.5 + rand()
        : 1 + rand() * 1.4;
  const GRID = 11;
  for (let gx = -HALF; gx < HALF; gx += GRID)
    for (let gz = -HALF; gz < HALF; gz += GRID) {
      const x = gx + rand() * GRID,
        z = gz + rand() * GRID;
      const h = heightAt(x, z);
      const forest = forestMask(x, z);
      const mountain = mountainMask(x, z);
      const steppe = steppeMask(x, z);
      const roll = rand();
      let pickd: [RealModelId, number] | null = null;
      if (h > 68 || slopeAt(x, z) > 0.9) {
        if (roll < 0.06) {
          const m = pick(ROCKS);
          pickd = [m, rockScale(m) * 1.5];
        }
      } else if (forest > 0.4 && roll < forest * 0.85) pickd = forestTree(x, z);
      else if (mountain > 0.25) {
        if (roll < 0.16)
          pickd =
            rand() < 0.25
              ? ['nature/pine-sapling-small', 3.5 + rand() * 1.5]
              : ['nature/old-tree', 2 + rand() * 0.6];
        else if (roll < 0.26) {
          const m = pick(ROCKS);
          pickd = [m, rockScale(m)];
        }
      } else if (steppe > 0.5) {
        if (roll < 0.01) pickd = ['nature/dead-trees-demo', 0.8 + rand() * 0.3];
        else if (roll < 0.03) {
          const m = pick([
            'nature/namaqualand-boulder-02',
            'nature/namaqualand-boulder-04',
            'nature/boulder-01',
          ] as const);
          pickd = [m, rockScale(m)];
        }
      } else if (roll < 0.02)
        pickd = ['nature/island-tree-01', 1.8 + rand() * 0.6];
      else if (roll < 0.035) pickd = ['nature/old-tree', 2 + rand() * 0.8];
      else if (roll < 0.042) {
        const m = pick(ROCKS);
        pickd = [m, rockScale(m)];
      }
      if (!pickd) continue;
      const [m, s] = pickd;
      const info = MODELS[m];
      const r = m === 'nature/dead-trees-demo' ? 5 : info.hit === 'box' ? 3 : 2;
      if (!wildOk(x, z, r)) continue;
      // Камень на склоне садится на нижний край своего пятна, иначе с подветренной стороны висит.
      const e =
        info.hit === 'box' ? Math.max(info.max[0], info.max[2]) * s * 0.7 : 0;
      const y =
        info.hit === 'box'
          ? Math.min(
              heightAt(x, z),
              heightAt(x - e, z),
              heightAt(x + e, z),
              heightAt(x, z - e),
              heightAt(x, z + e),
            ) - 0.25
          : heightAt(x, z) - 0.12;
      put(m, x, z, rand() * Math.PI * 2, s, y);
      reserve.add(x, z, r);
    }
  // Подлесок, трава, камни под ногами: без столкновений (кроме стволов и корней), только для вида.
  for (let gx = -HALF; gx < HALF; gx += 12)
    for (let gz = -HALF; gz < HALF; gz += 12) {
      const x = gx + rand() * 12,
        z = gz + rand() * 12;
      if (heightAt(x, z) > 60 || !wildOk(x, z, 0.5)) continue;
      const forest = forestMask(x, z);
      const roll = rand();
      const yaw = rand() * Math.PI * 2;
      if (forest > 0.4) {
        if (roll < 0.06) {
          const m = pick([
            'nature/dead-tree-trunk',
            'nature/dead-tree-trunk-02',
            'nature/tree-stump-02',
            'nature/root-cluster-01',
          ] as const);
          put(
            m,
            x,
            z,
            yaw,
            m === 'nature/dead-tree-trunk' ? 1.6 : 1,
            heightAt(x, z) - 0.1,
          );
          reserve.add(x, z, 2);
        } else if (roll < 0.3)
          put(
            pick([
              'nature/fern-02',
              'nature/fern-02',
              'nature/dry-branches-medium-01',
              'nature/shrub-02',
              'nature/nettle-plant',
            ] as const),
            x,
            z,
            yaw,
            1.3 + rand() * 0.5,
          );
        continue;
      }
      if (mountainMask(x, z) > 0.25) {
        if (roll < 0.15)
          put(
            pick([
              'nature/rock-07',
              'nature/rock-09',
              'nature/stone-01',
            ] as const),
            x,
            z,
            yaw,
            4 + rand() * 4,
            heightAt(x, z) - 0.05,
          );
        continue;
      }
      // Трава и бурьян — у дорог и мест, куда игрок ходит; в чистом поле их не видно издалека.
      const nearby = roadEdge(x, z) < 35 || inPlace(x, z, 40);
      if (steppeMask(x, z) > 0.5) {
        if (roll < 0.12)
          put(
            pick([
              'nature/wild-rooibos-bush',
              'nature/shrub-02',
              'nature/dry-branches-medium-01',
              'nature/weed-plant-02',
            ] as const),
            x,
            z,
            yaw,
            1.5 + rand() * 0.5,
          );
      } else if (nearby && roll < 0.45)
        put(
          pick([
            'nature/grass-bermuda-01',
            'nature/grass-bermuda-01',
            'nature/weed-plant-02',
            'nature/nettle-plant',
            'nature/shrub-01',
            'nature/shrub-03',
            'nature/shrub-04',
            'nature/wild-rooibos-bush',
          ] as const),
          x,
          z,
          yaw,
          1.4 + rand() * 0.8,
        );
      else if (roll < 0.06)
        put(
          pick(['nature/shrub-02', 'nature/wild-rooibos-bush'] as const),
          x,
          z,
          yaw,
          1.4 + rand() * 0.5,
        );
      else if (roll < 0.08)
        put(
          pick(['nature/rock-07', 'nature/stone-01'] as const),
          x,
          z,
          yaw,
          3 + rand() * 3,
          heightAt(x, z) - 0.04,
        );
    }
  // Берег озера: коряги, замшелые камни.
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2,
      r = LAKE.r + 2 + rand() * 10;
    const x = LAKE.x + Math.cos(a) * r,
      z = LAKE.z + Math.sin(a) * r;
    if (!reserve.free(x, z, 1.5) || inPlace(x, z, 2)) continue;
    const m = pick([
      'nature/dead-tree-trunk-02',
      'nature/rock-moss-set-01',
      'nature/dry-branches-medium-01',
      'nature/root-cluster-01',
    ] as const);
    put(
      m,
      x,
      z,
      rand() * Math.PI * 2,
      m === 'nature/rock-moss-set-01' ? 0.6 : 1,
      heightAt(x, z) - 0.1,
    );
    reserve.add(x, z, 1.5);
  }

  const zones: MapZone[] = [
    ...PLACE_LIST.map((p) => ({
      id: p.id,
      name: p.name,
      minX: p.x - p.hw,
      maxX: p.x + p.hw,
      minZ: p.z - p.hd,
      maxZ: p.z + p.hd,
    })),
    {
      id: 'camp',
      name: 'Лагерь выживших',
      minX: -143,
      maxX: -97,
      minZ: 7,
      maxZ: 53,
    },
    {
      id: 'lake',
      name: 'Озеро',
      minX: LAKE.x - LAKE.r,
      maxX: LAKE.x + LAKE.r,
      minZ: LAKE.z - LAKE.r,
      maxZ: LAKE.z + LAKE.r,
    },
    {
      id: 'ridge',
      name: 'Хребет',
      minX: -400,
      maxX: 400,
      minZ: -1000,
      maxZ: -760,
    },
    {
      id: 'dark-forest',
      name: 'Тёмный бор',
      minX: -1000,
      maxX: -520,
      minZ: -420,
      maxZ: -250,
    },
    {
      id: 'oak-forest',
      name: 'Дубрава',
      minX: -1000,
      maxX: -600,
      minZ: 800,
      maxZ: 1000,
    },
    {
      id: 'north-forest',
      name: 'Северный лес',
      minX: 620,
      maxX: 1000,
      minZ: -560,
      maxZ: -360,
    },
    {
      id: 'steppe',
      name: 'Степь',
      minX: 520,
      maxX: 1000,
      minZ: 460,
      maxZ: 660,
    },
  ];
  const water: MapWater[] = [
    {
      minX: LAKE.x - LAKE.r,
      maxX: LAKE.x + LAKE.r,
      minZ: LAKE.z - LAKE.r,
      maxZ: LAKE.z + LAKE.r,
      y: LAKE.level,
      color: '#3b7188',
      round: true,
    },
  ];
  return { terrain, props, decals, npcs, spawns, zones, water };
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Описание карты строится при первом обращении: генерация занимает доли секунды, но не нужна другим картам. */
export function buildOutbreak(): ArenaDef {
  const { terrain, props, decals, npcs, spawns, zones, water } = generate();
  return {
    id: 'outbreak',
    title: 'Зона заражения',
    bounds: BOUNDS,
    groundColor: '#6d8f4a',
    groundMaterial: 'grass',
    outsideColor: '#667f4a',
    boxes: [],
    water,
    terrain,
    props,
    // Все модели — свои .glb (`file`), процедурные дома строятся по id: общего props.glb нет.
    propKit: { models: OUTBREAK_REAL_MODELS },
    decals,
    npcs,
    roads: ALL_ROADS,
    // Мрачный дневной HDRI: пасмурное небо над пустошью.
    sky: { hdri: 'wasteland_clouds_puresky' },
    spawns,
    zones,
    navCell: 3,
    mood: 'grim',
    viewDistance: 320,
  };
}
