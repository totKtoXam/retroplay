import { OUTBREAK_MODELS, type OutbreakModelId } from './outbreak-models.ts';
import {
  terrainHeightAt,
  type ArenaDef,
  type Bounds,
  type MapProp,
  type MapTerrain,
  type MapWater,
  type MapZone,
  type SpawnPoint,
} from './types.ts';

/**
 * «Зона заражения» — огромная карта для режима с зомби: 2 × 2 км, в тысячу раз больше
 * «Горного лагеря». Всё, что стоит в мире, — готовые модели Kenney (CC0, сборка —
 * scripts/build-outbreak-models.mjs); здесь только рельеф и расстановка.
 *
 *   z -1000 ┌──────────────── ХРЕБЕТ (снег выше 72 м) ─────────────────────┐
 *           │  Горный ·            · Лагерь альпинистов                    │
 *    z -400 │ ТЁМНЫЙ БОР                               СЕВЕРНЫЙ ЛЕС        │
 *           │  Сосновка ·  Лесопилка                                        │
 *      z  0 │══ Берёзовка ══════ НОВОГРАД ═══════════ МЕГАПОЛИС ═══════════│ шоссе
 *           │    Кладбище ·         ║                                       │
 *    z  400 │ ДУБРАВА   ОЗЕРО       ╚═ Дачный посёлок                      │
 *           │   Заречье ·              Колхоз «Заря»  · Степное   СТЕПЬ    │
 *    z 1000 └───────────────────────────────────────────── Военная база ──┘
 *          x -1000                     x 0                              x 1000
 *
 * Север — это −z (вверху миникарты). Рельеф — сетка высот с шагом 5 м: пологие холмы
 * равнины, хребет на севере, котловина озера; под городами, деревнями и вдоль дорог
 * земля выровнена. Всё случайное взято из генератора с постоянным зерном, поэтому
 * клиент и сервер строят одну и ту же карту.
 */

const HALF = 1000;
const BOUNDS: Bounds = { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF };
/** Рельеф шире границ: с края карты видно продолжение холмов, а не обрыв в пустоту. */
const MARGIN = 150;
const CELL = 5;
const SEED = 20260930;

/** Адрес набора моделей (public/models/outbreak). */
export const OUTBREAK_PROPS_URL = '/models/outbreak/props.glb';

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
} satisfies Record<string, Place>;
const PLACE_LIST: Place[] = Object.values(PLACES);

/** Озеро в Дубраве: круглая котловина. */
const LAKE = { x: -720, z: 600, r: 135, level: -0.55 };

/** Дороги — ломаные по точкам (x, z). Сетка улиц городов строится отдельно. */
const ROADS: [number, number][][] = [
  // Шоссе с запада: через Берёзовку к Новограду.
  [
    [-995, 180],
    [-560, 180],
    [-270, 180],
  ],
  // Новоград → Мегаполис → восточный край.
  [
    [90, 0],
    [370, 0],
  ],
  [
    [860, 0],
    [995, 0],
  ],
  // На юг: дачи, Степное, база.
  [
    [-30, 240],
    [-30, 370],
    [350, 370],
    [420, 560],
    [420, 790],
    [690, 790],
  ],
  // На северо-запад: через Тёмный бор к Сосновке.
  [
    [-270, 0],
    [-450, -20],
    [-700, -170],
    [-860, -170],
  ],
  // На юго-запад: мимо кладбища к Заречью.
  [
    [-150, 240],
    [-260, 420],
    [-445, 640],
    [-540, 700],
  ],
  // От Мегаполиса на север, к предгорьям.
  [
    [580, -280],
    [520, -420],
  ],
  // Колхоз.
  [
    [210, 370],
    [150, 560],
  ],
];
const ROAD_HALF = 4;

/** Сетки улиц: город через 60 м, мегаполис через 70 м. */
type Grid = { x0: number; x1: number; z0: number; z1: number; step: number };
const CITY_GRID: Grid = { x0: -270, x1: 90, z0: -120, z1: 240, step: 60 };
const MEGA_GRID: Grid = { x0: 370, x1: 860, z0: -280, z1: 280, step: 70 };
const gridLines = (a: number, b: number, s: number) => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-6; v += s) out.push(v);
  return out;
};

/** Все отрезки дорог, включая сетки улиц: по ним выравнивается земля и не растут деревья. */
const SEGMENTS: [number, number, number, number][] = [
  ...ROADS.flatMap((r) =>
    r
      .slice(1)
      .map(
        (p, i) =>
          [r[i][0], r[i][1], p[0], p[1]] as [number, number, number, number],
      ),
  ),
  ...[CITY_GRID, MEGA_GRID].flatMap((g) => [
    ...gridLines(g.x0, g.x1, g.step).map(
      (x) => [x, g.z0, x, g.z1] as [number, number, number, number],
    ),
    ...gridLines(g.z0, g.z1, g.step).map(
      (z) => [g.x0, z, g.x1, z] as [number, number, number, number],
    ),
  ]),
];

function segmentDistance(
  x: number,
  z: number,
  s: [number, number, number, number],
) {
  const [ax, az, bx, bz] = s;
  const dx = bx - ax,
    dz = bz - az;
  const t = Math.max(
    0,
    Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)),
  );
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}
const roadDistance = (x: number, z: number) => {
  let d = Infinity;
  for (const s of SEGMENTS) d = Math.min(d, segmentDistance(x, z, s));
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
      const road = roadDistance(x, z);
      const w = step(ROAD_HALF + 28, ROAD_HALF + 6, road);
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
} as const;
// Цвета земли выцветшие: трава пожухла, асфальт в копоти, снег грязноват.
const PALETTE = [
  { color: '#5f7447', name: 'луг' },
  { color: '#43573a', name: 'лес' },
  { color: '#a3946a', name: 'степь' },
  { color: '#706c66', name: 'скалы' },
  { color: '#dcdfdf', name: 'снег' },
  { color: '#6a5540', name: 'пашня' },
  { color: '#57585a', name: 'асфальт' },
  { color: '#b8aa84', name: 'песок' },
  { color: '#7a6a52', name: 'грунт' },
];

function groundKind(t: MapTerrain, x: number, z: number, h: number) {
  const slope =
    Math.hypot(
      terrainHeightAt(t, x + 2, z) - terrainHeightAt(t, x - 2, z),
      terrainHeightAt(t, x, z + 2) - terrainHeightAt(t, x, z - 2),
    ) / 4;
  if (h > 72 + (noise(x / 40, z / 40, SEED + 11) - 0.5) * 14) return K.snow;
  if (slope > 0.75 || (mountainMask(x, z) > 0.55 && h > 20)) return K.rock;
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 14) return K.sand;
  for (const p of [PLACES.city, PLACES.megapolis])
    if (placeDistance(p, x, z) < 6) return K.asphalt;
  if (
    placeDistance(PLACES.base, x, z) < 4 ||
    placeDistance(PLACES.sawmill, x, z) < 4
  )
    return K.dirt;
  if (placeDistance(PLACES.farm, x, z) < 2 || fieldAt(x, z)) return K.field;
  if (forestMask(x, z) > 0.45) return K.forest;
  if (steppeMask(x, z) > 0.5) return K.steppe;
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
      roadDistance(x, z) > 14
    )
      return true;
  }
  return false;
}

// --- расстановка ---------------------------------------------------------------------------

type ModelId = OutbreakModelId;

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

/** Рамка модели после поворота на кратный 90° угол: полуразмеры по x и z. */
function footprint(m: ModelId, yaw: number, s = 1) {
  const info = OUTBREAK_MODELS[m];
  const w = (info.max[0] - info.min[0]) * s,
    d = (info.max[2] - info.min[2]) * s;
  const quarter = Math.round(yaw / (Math.PI / 2)) % 2 !== 0;
  return quarter ? { hw: d / 2, hd: w / 2 } : { hw: w / 2, hd: d / 2 };
}

function generate() {
  const terrain = buildTerrain();
  const heightAt = (x: number, z: number) => terrainHeightAt(terrain, x, z);
  const rand = mulberry(SEED);
  const pick = <T>(list: readonly T[]) =>
    list[Math.floor(rand() * list.length)];
  const props: MapProp[] = [];
  const reserve = new Reserve();
  const slopeAt = (x: number, z: number) =>
    Math.hypot(
      heightAt(x + 2, z) - heightAt(x - 2, z),
      heightAt(x, z + 2) - heightAt(x, z - 2),
    ) / 4;

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
  /** Постройка с рамкой, поставленная на самую низкую точку своего пятна: не висит над склоном. */
  const building = (
    m: ModelId,
    x: number,
    z: number,
    yaw: number,
    s = 1,
    tint?: string,
  ) => {
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
  };
  const inPlace = (x: number, z: number, margin = 0) =>
    PLACE_LIST.some((p) => placeDistance(p, x, z) < margin);

  // --- следы катастрофы: копоть, пожарища, мусор, кровь и тела ---
  /** Оттенки-множители: сгоревшая машина, ржавая, дом в копоти, выгоревший дом. */
  const BURNED = '#5d534c',
    RUST = '#a57a58',
    SOOT = '#a19b93',
    CHARRED = '#5c544d';
  const DEAD: readonly ModelId[] = [
    'zk/dead-zombie',
    'zk/dead-zombie',
    'zk/dead-zombie-chubby',
    'zk/dead-zombie-arm',
    'zk/dead-zombie-ribcage',
  ];
  const VICTIMS: readonly ModelId[] = [
    'zk/dead-lis',
    'zk/dead-matt',
    'zk/dead-sam',
    'zk/dead-shaun',
  ];
  const BLOOD: readonly ModelId[] = [
    'zk/blood-1',
    'zk/blood-2',
    'zk/blood-2',
    'zk/blood-3',
    'zk/blood-3',
  ];
  const LITTER: readonly ModelId[] = [
    'zk/trash-bag-1',
    'zk/trash-bag-2',
    'zk/trash-bag-1',
    'zk/cinder-block',
    'zk/pallet-broken',
    'zk/pallet',
    'zk/wheel',
    'car/debris-tire',
    'grave/debris',
    'grave/debris-wood',
  ];
  const DROPPED: readonly ModelId[] = [
    'zk/rifle',
    'zk/shotgun',
    'zk/axe',
    'zk/bat-barbed',
    'zk/bat-saw',
  ];
  /** Высота поверхности: на улице — поверх плитки асфальта, иначе на земле. */
  const surface = (x: number, z: number) =>
    heightAt(x, z) + (roadDistance(x, z) < ROAD_HALF + 0.5 ? 0.13 : 0.03);
  // Лужи на разной высоте на миллиметры: наложенные друг на друга не мерцают.
  const blood = (x: number, z: number, s = 0.7 + rand() * 0.6) =>
    put(
      pick(BLOOD),
      x,
      z,
      rand() * Math.PI * 2,
      s,
      surface(x, z) + 0.01 + rand() * 0.012,
    );
  /** Тело зомби или погибшего человека, обычно с лужей крови. Столкновений нет — только вид. */
  const body = (x: number, z: number, victim = false) => {
    put(
      pick(victim ? VICTIMS : DEAD),
      x,
      z,
      rand() * Math.PI * 2,
      0.95 + rand() * 0.1,
      surface(x, z),
    );
    if (rand() < 0.8) blood(x + (rand() - 0.5) * 1.4, z + (rand() - 0.5) * 1.4);
  };
  /** Место бойни: тела вокруг точки, кровь, брошенное оружие. */
  const massacre = (
    x: number,
    z: number,
    r: number,
    count: number,
    victims = 0.3,
  ) => {
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2,
        d = Math.sqrt(rand()) * r;
      body(x + Math.cos(a) * d, z + Math.sin(a) * d, rand() < victims);
    }
    for (let i = 0; i < count / 2; i++)
      blood(x + (rand() - 0.5) * r * 2, z + (rand() - 0.5) * r * 2);
    for (let i = 0; i < Math.ceil(count / 5); i++) {
      const wx = x + (rand() - 0.5) * r * 2,
        wz = z + (rand() - 0.5) * r * 2;
      put(
        pick(DROPPED),
        wx,
        wz,
        rand() * Math.PI * 2,
        1,
        surface(wx, wz) + 0.02,
      );
    }
  };
  /** Мусор у стены или на тротуаре. */
  const litter = (x: number, z: number) => {
    if (!reserve.free(x, z, 0.6)) return;
    const m = pick(LITTER);
    put(m, x, z, rand() * Math.PI * 2, 1, surface(x, z));
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

  // --- дороги ---
  // Улицы — плитки Zombie Apocalypse Kit: тёмный разбитый асфальт с тротуарами и
  // разметкой, часть — с трещинами. Прямая плитка идёт вдоль своей оси z, у Т-перекрёстка
  // глухая сторона смотрит в −x, поворот соединяет +x и +z.
  const TILE = 8;
  const STRAIGHTS: readonly ModelId[] = [
    'zk/street',
    'zk/street',
    'zk/street',
    'zk/street',
    'zk/street',
    'zk/street-crack-1',
    'zk/street-crack-2',
  ];
  /** Плитки улицы от точки до точки, с небольшим нахлёстом и без щелей. */
  const roadTiles = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    lift = 0,
  ) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / TILE));
    const yaw = Math.PI / 2 - Math.atan2(bz - az, bx - ax);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = ax + (bx - ax) * t,
        z = az + (bz - az) * t;
      // Соседние плитки чуть по-разному по высоте: их края перекрываются и иначе мерцали бы.
      put(
        pick(STRAIGHTS),
        x,
        z,
        yaw,
        1,
        heightAt(x, z) + 0.02 + (i % 2) * 0.012 + lift,
      );
    }
  };
  for (const road of ROADS) {
    for (let i = 1; i < road.length; i++) {
      const [ax, az] = road[i - 1],
        [bx, bz] = road[i];
      roadTiles(ax, az, bx, bz);
    }
    // Изломы круче 10° — перекрёсток поверх стыка; прямой стык не нужен.
    for (let i = 1; i < road.length - 1; i++) {
      const a = Math.atan2(
          road[i][1] - road[i - 1][1],
          road[i][0] - road[i - 1][0],
        ),
        b = Math.atan2(
          road[i + 1][1] - road[i][1],
          road[i + 1][0] - road[i][0],
        );
      const turn = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
      if (turn > 0.17)
        put(
          'zk/street-4way',
          road[i][0],
          road[i][1],
          (a + b) / -2,
          1.25,
          heightAt(road[i][0], road[i][1]) + 0.05,
        );
    }
  }
  // Сетки улиц: прямые между перекрёстками; внутри — крест, по краю — Т, в углах — поворот.
  const streets = (g: Grid) => {
    const xs = gridLines(g.x0, g.x1, g.step),
      zs = gridLines(g.z0, g.z1, g.step);
    for (const [ix, x] of xs.entries())
      for (const [iz, z] of zs.entries()) {
        const edgeX = ix === 0 ? -1 : ix === xs.length - 1 ? 1 : 0,
          edgeZ = iz === 0 ? -1 : iz === zs.length - 1 ? 1 : 0;
        const y = heightAt(x, z) + 0.04;
        if (edgeX && edgeZ) {
          // Поворот внутрь сетки: из угла улицы уходят на восток или запад и на юг или север.
          const yaw =
            edgeX === -1
              ? edgeZ === -1
                ? 0
                : Math.PI / 2
              : edgeZ === -1
                ? -Math.PI / 2
                : Math.PI;
          put('zk/street-turn', x, z, yaw, 1, y);
        } else if (edgeX || edgeZ) {
          // Глухая сторона Т — наружу сетки.
          const yaw =
            edgeZ === -1
              ? -Math.PI / 2
              : edgeZ === 1
                ? Math.PI / 2
                : edgeX === -1
                  ? 0
                  : Math.PI;
          put('zk/street-t', x, z, yaw, 1, y);
        } else put('zk/street-4way', x, z, 0, 1, y);
      }
    for (const x of xs)
      for (let i = 1; i < zs.length; i++)
        roadTiles(x, zs[i - 1] + TILE / 2, x, zs[i] - TILE / 2);
    for (const z of zs)
      for (let i = 1; i < xs.length; i++)
        roadTiles(xs[i - 1] + TILE / 2, z, xs[i] - TILE / 2, z);
  };
  streets(CITY_GRID);
  streets(MEGA_GRID);
  // Столбы вдоль шоссе.
  for (const road of [ROADS[0], ROADS[3], ROADS[4], ROADS[5]])
    for (let i = 1; i < road.length; i++) {
      const [ax, az] = road[i - 1],
        [bx, bz] = road[i];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len,
        nz = (bx - ax) / len;
      for (let d = 20; d < len - 10; d += 45) {
        const x = ax + ((bx - ax) * d) / len + nx * 9,
          z = az + ((bz - az) * d) / len + nz * 9;
        if (inPlace(x, z, 4) || !reserve.free(x, z, 1)) continue;
        put(
          'road/electricity-pole-single',
          x,
          z,
          -Math.atan2(bz - az, bx - ax),
        );
        reserve.add(x, z, 1);
      }
    }

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
    s = 1,
    yard?: (cx: number, cz: number, w: number, d: number) => void,
  ) => {
    const inset = ROAD_HALF + 2.5;
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
        const { hw, hd } = footprint(m, yaw, s);
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
          const roll = rand();
          building(
            m,
            x,
            z,
            yaw,
            s,
            roll < 0.06 ? CHARRED : roll < 0.24 ? SOOT : undefined,
          );
          placed.push(rect);
          t += along * 2 + 1 + rand() * 3;
        } else t += 4;
      }
    }
    // Тротуары: мусор у домов, иногда кровь и тела — улицы пережили не одну волну.
    for (let i = 0; i < 7; i++) {
      const side = Math.floor(rand() * 4),
        t = rand();
      const x =
          side < 2
            ? x0 + 6 + (x1 - x0 - 12) * t
            : side === 2
              ? x0 + 5.2
              : x1 - 5.2,
        z =
          side >= 2
            ? z0 + 6 + (z1 - z0 - 12) * t
            : side === 0
              ? z0 + 5.2
              : z1 - 5.2;
      litter(x, z);
    }
    if (rand() < 0.35) {
      const x = x0 + rand() * (x1 - x0),
        z = rand() < 0.5 ? z0 : z1;
      body(x, z + (rand() - 0.5) * 3, rand() < 0.35);
    }
    if (rand() < 0.4) blood(x0 + rand() * (x1 - x0), rand() < 0.5 ? z0 : z1);
    if (yard) {
      const cx = (x0 + x1) / 2,
        cz = (z0 + z1) / 2;
      yard(cx, cz, (x1 - x0) / 2 - 22, (z1 - z0) / 2 - 22);
    }
  };
  /** Двор: машины, мусорные баки, деревья — где свободно. */
  const courtyard = (cx: number, cz: number, hw: number, hd: number) => {
    if (hw < 4 || hd < 4) return;
    for (let i = 0; i < 7; i++) {
      const x = cx + (rand() * 2 - 1) * hw,
        z = cz + (rand() * 2 - 1) * hd;
      const roll = rand();
      if (roll < 0.35 && reserve.free(x, z, 3)) {
        put(
          pick(CARS),
          x,
          z,
          Math.round(rand() * 4) * (Math.PI / 2) + (rand() - 0.5) * 0.3,
        );
        reserve.add(x, z, 3);
      } else if (roll < 0.55 && reserve.free(x, z, 1.5)) {
        put('road/dumpster', x, z, Math.round(rand() * 4) * (Math.PI / 2));
        reserve.add(x, z, 1.5);
      } else if (reserve.free(x, z, 2.5)) {
        put(
          pick(['sub/tree-large', 'sub/tree-small'] as const),
          x,
          z,
          rand() * Math.PI * 2,
        );
        reserve.add(x, z, 2);
      }
    }
  };
  const park = (cx: number, cz: number, hw: number, hd: number) => {
    put(
      pick([
        'nat/statue-obelisk',
        'nat/statue-head',
        'nat/statue-column',
      ] as const),
      cx,
      cz,
      0,
      1.4,
    );
    reserve.add(cx, cz, 4);
    for (let i = 0; i < 26; i++) {
      const x = cx + (rand() * 2 - 1) * (hw + 14),
        z = cz + (rand() * 2 - 1) * (hd + 14);
      if (!reserve.free(x, z, 3)) continue;
      put(
        pick([
          'nat/tree-oak',
          'nat/tree-default',
          'nat/tree-detailed',
          'nat/tree-fat',
        ] as const),
        x,
        z,
        rand() * 6.28,
        0.8 + rand() * 0.3,
      );
      reserve.add(x, z, 2.5);
    }
    for (let i = 0; i < 6; i++) {
      const x = cx + (rand() * 2 - 1) * (hw + 10),
        z = cz + (rand() * 2 - 1) * (hd + 10);
      if (!reserve.free(x, z, 1.5)) continue;
      put(
        pick([
          'grave/bench-damaged',
          'com/detail-parasol-a',
          'com/detail-parasol-b',
        ] as const),
        x,
        z,
        rand() * 6.28,
      );
      reserve.add(x, z, 1.5);
    }
  };
  const ruin = (cx: number, cz: number, hw: number, hd: number) => {
    for (let i = 0; i < 18; i++) {
      const x = cx + (rand() * 2 - 1) * (hw + 12),
        z = cz + (rand() * 2 - 1) * (hd + 12);
      if (!reserve.free(x, z, 2)) continue;
      put(
        pick([
          'grave/debris',
          'grave/stone-wall-damaged',
          'grave/brick-wall',
          'car/debris-plate-a',
          'car/debris-tire',
          'road/construction-barrier',
        ] as const),
        x,
        z,
        rand() * 6.28,
        1.2,
      );
      reserve.add(x, z, 1.6);
    }
  };

  const OFFICES: readonly ModelId[] = [
    'com/building-a',
    'com/building-b',
    'com/building-c',
    'com/building-d',
    'com/building-e',
    'com/building-f',
    'com/building-g',
    'com/building-h',
    'com/building-i',
    'com/building-k',
    'com/building-l',
  ];
  const BIG: readonly ModelId[] = [
    'com/building-i',
    'com/building-j',
    'com/building-k',
    'com/building-l',
    'com/building-m',
    'com/building-n',
  ];
  const TOWERS: readonly ModelId[] = [
    'com/building-skyscraper-a',
    'com/building-skyscraper-b',
    'com/building-skyscraper-c',
    'com/building-skyscraper-d',
    'com/building-skyscraper-e',
  ];
  const HIGHRISE: readonly ModelId[] = [
    'com/low-detail-building-a',
    'com/low-detail-building-b',
    'com/low-detail-building-c',
    'com/low-detail-building-d',
    'com/low-detail-building-f',
    'com/low-detail-building-g',
    'com/low-detail-building-h',
    'com/low-detail-building-j',
    'com/low-detail-building-l',
    'com/low-detail-building-m',
    'com/low-detail-building-wide-a',
    'com/low-detail-building-wide-b',
  ];
  const HOUSES: readonly ModelId[] = [
    'sub/building-type-a',
    'sub/building-type-b',
    'sub/building-type-c',
    'sub/building-type-d',
    'sub/building-type-e',
    'sub/building-type-f',
    'sub/building-type-g',
    'sub/building-type-h',
    'sub/building-type-i',
    'sub/building-type-j',
    'sub/building-type-k',
    'sub/building-type-l',
    'sub/building-type-m',
    'sub/building-type-n',
    'sub/building-type-o',
    'sub/building-type-p',
    'sub/building-type-q',
    'sub/building-type-r',
    'sub/building-type-s',
    'sub/building-type-t',
    'sub/building-type-u',
  ];
  const CARS: readonly ModelId[] = [
    'car/sedan',
    'car/sedan',
    'car/sedan-sports',
    'car/hatchback-sports',
    'car/suv',
    'car/suv-luxury',
    'car/taxi',
    'car/van',
    'car/delivery',
    'car/police',
    'car/ambulance',
    'car/truck',
    'zk/pickup',
    'zk/sports',
    'zk/truck',
  ];

  /**
   * Лагерь выживших: квартал, обнесённый стеной из контейнеров с двумя проходами; внутри
   * палатки, бронированный пикап, водонапорная башня, бочки, костры и ящики с припасами.
   * Снаружи у стены — тела зомби, которых отстреливали со стены.
   */
  const survivorCamp = (cx: number, cz: number, half: number) => {
    const CONTAINER = 6.6;
    for (const side of [-1, 1]) {
      for (
        let t = -half + CONTAINER / 2;
        t <= half - CONTAINER / 2 + 0.01;
        t += CONTAINER
      ) {
        // Проходы — посередине северной и южной стены.
        if (Math.abs(t) < CONTAINER / 2) continue;
        building(
          rand() < 0.5 ? 'zk/container-red' : 'zk/container-green',
          cx + t,
          cz + side * half,
          0,
        );
        building(
          rand() < 0.5 ? 'zk/container-red' : 'zk/container-green',
          cx + side * half,
          cz + t,
          Math.PI / 2,
        );
      }
      // У прохода — бетонные блоки и заграждение.
      for (const k of [-1, 1])
        put('zk/traffic-barrier-1', cx + k * 2.2, cz + side * (half + 2.5), 0);
    }
    building('zk/water-tower', cx - half + 6, cz - half + 6, 0);
    building('zk/pickup-armored', cx + half - 8, cz + 4, Math.PI / 2);
    building('zk/truck-armored', cx + half - 8, cz - 8, Math.PI / 2);
    for (const [dx, dz] of [
      [-8, 6],
      [0, 10],
      [-12, -4],
    ] as const)
      building(
        pick(['nat/tent-detailedclosed', 'nat/tent-detailedopen'] as const),
        cx + dx,
        cz + dz,
        rand() * 6.28,
        1.4,
      );
    for (let i = 0; i < 10; i++) {
      const x = cx + (rand() - 0.5) * half * 1.4,
        z = cz + (rand() - 0.5) * half * 1.4;
      if (!reserve.free(x, z, 1)) continue;
      put(
        pick([
          'zk/barrel',
          'zk/barrel',
          'zk/chest',
          'zk/chest-special',
          'zk/wheels-stack',
          'zk/couch',
          'grave/fire-basket',
        ] as const),
        x,
        z,
        rand() * 6.28,
      );
      reserve.add(x, z, 1);
    }
    for (let i = 0; i < 14; i++) {
      const a = rand() * Math.PI * 2,
        r = half + 5 + rand() * 12;
      body(cx + Math.cos(a) * r, cz + Math.sin(a) * r, rand() < 0.15);
    }
  };
  // Новоград: плотная застройка, в центре — лагерь выживших, один квартал в руинах.
  {
    const g = CITY_GRID,
      xs = gridLines(g.x0, g.x1, g.step),
      zs = gridLines(g.z0, g.z1, g.step);
    for (let i = 1; i < xs.length; i++)
      for (let j = 1; j < zs.length; j++) {
        const cx = (xs[i - 1] + xs[i]) / 2,
          cz = (zs[j - 1] + zs[j]) / 2;
        if (i === 3 && j === 3) {
          survivorCamp(cx, cz, 23);
          continue;
        }
        if (i === 5 && j === 2) {
          ruin(cx, cz, 12, 12);
          massacre(cx, cz, 14, 9);
          continue;
        }
        block(
          xs[i - 1],
          zs[j - 1],
          xs[i],
          zs[j],
          Math.hypot(cx - PLACES.city.x, cz - PLACES.city.z) < 100
            ? BIG
            : OFFICES,
          1,
          courtyard,
        );
      }
  }
  // Мегаполис: башни в сердцевине, высотки вокруг, по краю — обычные дома; площадь в центре.
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
          ruin(cx, cz, 14, 14);
          massacre(cx, cz, 16, 12);
          continue;
        }
        const set = d < 150 ? TOWERS : d < 250 ? HIGHRISE : BIG;
        block(xs[i - 1], zs[j - 1], xs[i], zs[j], set, 1, courtyard);
      }
  }

  // --- деревни ---
  /** Дом с участком: забор из досок с трёх сторон, сено или поленница во дворе. */
  const homestead = (x: number, z: number, yaw: number, fenced: boolean) => {
    const m = pick(HOUSES);
    if (!reserve.free(x, z, 7)) return;
    // Часть домов выгорела или закопчена.
    building(
      m,
      x,
      z,
      yaw,
      1,
      rand() < 0.2 ? (rand() < 0.4 ? CHARRED : SOOT) : undefined,
    );
    if (!fenced) return;
    const back = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const side = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    // Задний забор и боковые: сегменты по 4 м.
    for (let k = -2; k <= 2; k++) {
      const fx = x + back.x * 11 + side.x * k * 4,
        fz = z + back.z * 11 + side.z * k * 4;
      if (reserve.free(fx, fz, 1))
        put(
          pick(['nat/fence-planks', 'nat/fence-simple'] as const),
          fx,
          fz,
          yaw,
        );
    }
    for (const sgn of [-1, 1])
      for (let k = -1; k <= 2; k++) {
        const fx = x + side.x * sgn * 10 + back.x * k * 4,
          fz = z + side.z * sgn * 10 + back.z * k * 4;
        if (reserve.free(fx, fz, 1))
          put(
            pick([
              'nat/fence-planks',
              'grave/fence',
              'grave/fence-damaged',
            ] as const),
            fx,
            fz,
            yaw + Math.PI / 2,
          );
      }
    const yx = x + back.x * 8 + side.x * (rand() * 8 - 4),
      yz = z + back.z * 8 + side.z * (rand() * 8 - 4);
    if (reserve.free(yx, yz, 1.5)) {
      put(
        pick([
          'grave/hay-bale',
          'grave/hay-bale-bundled',
          'nat/log-stack',
          'nat/log-stacklarge',
          'nat/stump-round',
        ] as const),
        yx,
        yz,
        rand() * 6.28,
      );
      reserve.add(yx, yz, 1.5);
    }
    // Во дворе — то, что осталось от хозяев или от незваных гостей.
    const roll = rand();
    if (roll < 0.14)
      body(
        x + back.x * 7 + side.x * (rand() * 6 - 3),
        z + back.z * 7 + side.z * (rand() * 6 - 3),
        rand() < 0.5,
      );
    else if (roll < 0.17) {
      const dx = x - back.x * 8,
        dz = z - back.z * 8;
      put('zk/dead-dog', dx, dz, rand() * 6.28, 1, surface(dx, dz));
      blood(dx, dz, 0.5);
    } else if (roll < 0.3)
      litter(x - back.x * 7 + side.x * 4, z - back.z * 7 + side.z * 4);
    if (rand() < 0.12) {
      const cx = x + back.x * 9,
        cz = z + back.z * 9;
      if (reserve.free(cx, cz, 1)) put('zk/chest', cx, cz, yaw);
    }
    const tx = x + back.x * 6 + side.x * (rand() < 0.5 ? -7 : 7),
      tz = z + back.z * 6 + side.z * (rand() < 0.5 ? -7 : 7);
    if (reserve.free(tx, tz, 2)) {
      put(
        pick([
          'nat/tree-oak',
          'nat/tree-default',
          'nat/tree-fat',
          'nat/tree-detailed',
        ] as const),
        tx,
        tz,
        rand() * 6.28,
        0.8,
      );
      reserve.add(tx, tz, 2);
    }
  };
  /** Деревня вдоль улицы: дома по обе стороны фасадом к ней. */
  const village = (p: Place, axis: 'x' | 'z', rows = 1, fenced = true) => {
    const len = axis === 'x' ? p.hw : p.hd;
    for (let row = 0; row < rows; row++)
      for (const sgn of [-1, 1])
        for (let t = -len + 10; t <= len - 10; t += 24 + rand() * 6) {
          const off = sgn * (18 + row * 30);
          const x = axis === 'x' ? p.x + t : p.x + off,
            z = axis === 'x' ? p.z + off : p.z + t;
          if (roadDistance(x, z) < 12) continue;
          // Фасадом к улице: к оси деревни.
          const yaw =
            axis === 'x'
              ? sgn < 0
                ? 0
                : Math.PI
              : sgn < 0
                ? Math.PI / 2
                : -Math.PI / 2;
          homestead(x, z, yaw, fenced);
        }
  };
  village(PLACES.berezovka, 'x', 2);
  village(PLACES.sosnovka, 'x', 2);
  village(PLACES.zarechye, 'z', 2);
  village(PLACES.stepnoe, 'z', 2);
  village(PLACES.gorny, 'x', 1);
  // Дачи: ровные ряды у шоссе.
  village(PLACES.dachas, 'x', 2, false);
  // Колодец-обелиск и костры в центрах деревень.
  for (const p of [
    PLACES.berezovka,
    PLACES.sosnovka,
    PLACES.zarechye,
    PLACES.stepnoe,
    PLACES.gorny,
  ]) {
    const x = p.x + 6,
      z = p.z + 9;
    if (reserve.free(x, z, 2)) {
      put('nat/campfire-stones', x, z, rand() * 6.28);
      reserve.add(x, z, 2);
    }
  }
  // Поля у деревень: ряды кукурузы и пшеницы на пашне.
  for (let x = -1000; x < 1000; x += 6)
    for (let z = -1000; z < 1000; z += 6) {
      if (!fieldAt(x, z) || rand() > 0.6) continue;
      if (!reserve.free(x, z, 1)) continue;
      put(
        pick([
          'nat/crops-cornstagec',
          'nat/crops-cornstaged',
          'nat/crops-wheatstageb',
          'nat/crops-leafsstageb',
        ] as const),
        x + rand() * 2,
        z + rand() * 2,
        rand() * 6.28,
      );
    }

  // --- особые места ---
  // Колхоз: ангары-«сараи» из больших домов, трактора, стога, поле, водонапорная башня.
  {
    const p = PLACES.farm;
    building('sub/building-type-n', p.x - 40, p.z - 30, 0);
    building('sub/building-type-b', p.x + 10, p.z - 35, 0);
    building('sub/building-type-f', p.x + 55, p.z - 25, -Math.PI / 2);
    for (const [m, dx, dz] of [
      ['car/tractor', -10, -8],
      ['car/tractor-shovel', 20, -5],
      ['car/truck-flat', 40, 5],
    ] as const) {
      put(m, p.x + dx, p.z + dz, rand() * 6.28);
      reserve.add(p.x + dx, p.z + dz, 3);
    }
    for (let i = 0; i < 40; i++) {
      const x = p.x + (rand() * 2 - 1) * p.hw,
        z = p.z + 5 + rand() * p.hd;
      if (!reserve.free(x, z, 1.2)) continue;
      put(
        pick(['grave/hay-bale', 'grave/hay-bale-bundled'] as const),
        x,
        z,
        rand() * 6.28,
      );
      reserve.add(x, z, 1.2);
    }
    building('zk/water-tower', p.x - 80, p.z - 50, 0);
    massacre(p.x + 20, p.z + 40, 20, 6, 0.3);
    for (let x = p.x - p.hw; x < p.x + p.hw; x += 5)
      for (let z = p.z + 20; z < p.z + p.hd; z += 5)
        if (reserve.free(x, z, 1) && rand() < 0.8)
          put('nat/crops-wheatstageb', x, z, rand() * 6.28);
  }
  // Кладбище: ограда, ряды могил, склепы, кривые сосны.
  {
    const p = PLACES.cemetery;
    for (let x = p.x - p.hw; x <= p.x + p.hw; x += 2.4) {
      for (const z of [p.z - p.hd, p.z + p.hd]) {
        if (Math.abs(x - p.x) < 3 && z > p.z) continue;
        put(
          rand() < 0.2 ? 'grave/iron-fence-damaged' : 'grave/iron-fence',
          x,
          z,
          0,
        );
      }
    }
    for (let z = p.z - p.hd + 1.2; z <= p.z + p.hd - 1.2; z += 2.4)
      for (const x of [p.x - p.hw, p.x + p.hw])
        put(
          rand() < 0.2 ? 'grave/iron-fence-damaged' : 'grave/iron-fence',
          x,
          z,
          Math.PI / 2,
        );
    put('grave/iron-fence-border-gate', p.x, p.z + p.hd, 0);
    for (let x = p.x - p.hw + 5; x < p.x + p.hw - 4; x += 4.5)
      for (let z = p.z - p.hd + 6; z < p.z + p.hd - 6; z += 5.5) {
        if (rand() < 0.15) continue;
        put(
          pick([
            'grave/gravestone-bevel',
            'grave/gravestone-broken',
            'grave/gravestone-cross',
            'grave/gravestone-round',
            'grave/gravestone-roof',
            'grave/gravestone-wide',
            'grave/cross',
            'grave/cross-wood',
          ] as const),
          x,
          z,
          (rand() - 0.5) * 0.3,
        );
        put(rand() < 0.3 ? 'grave/grave-border' : 'grave/grave', x, z + 1.9, 0);
      }
    building('grave/crypt-large', p.x - p.hw + 9, p.z - p.hd + 8, 0);
    building('grave/crypt-small', p.x + p.hw - 8, p.z - p.hd + 7, 0);
    reserve.add(p.x, p.z, Math.max(p.hw, p.hd));
    for (let i = 0; i < 12; i++) {
      const a = rand() * Math.PI * 2,
        r = Math.max(p.hw, p.hd) + 6 + rand() * 12;
      put(
        pick([
          'grave/pine-crooked',
          'grave/pine-fall-crooked',
          'grave/pine',
        ] as const),
        p.x + Math.cos(a) * r,
        p.z + Math.sin(a) * r,
        rand() * 6.28,
      );
    }
    put('grave/lightpost-double', p.x + 3, p.z + p.hd + 3, 0);
    // Поднявшиеся мертвецы, которых уложили второй раз, — у разрытых могил.
    for (let i = 0; i < 9; i++)
      body(
        p.x + (rand() - 0.5) * p.hw * 1.6,
        p.z + (rand() - 0.5) * p.hd * 1.6,
      );
    // Братская могила за оградой: гробы, тела, свежая земля.
    const gx = p.x + p.hw + 22,
      gz = p.z + 6;
    reserve.add(gx, gz, 10);
    for (let i = 0; i < 6; i++)
      put(
        'grave/coffin-old',
        gx - 6 + (i % 3) * 3,
        gz - 4 + Math.floor(i / 3) * 3,
        0.1 * (rand() - 0.5),
        1.1,
      );
    for (let i = 0; i < 3; i++)
      put('grave/grave-border', gx - 5 + i * 4, gz + 5, 0);
    put('grave/shovel-dirt', gx + 8, gz, rand() * 6.28);
    massacre(gx, gz, 7, 10, 0.6);
  }
  // Военная база: ограждение, палатки, грузовики, ящики, блокпост у ворот.
  {
    const p = PLACES.base;
    for (let x = p.x - p.hw; x <= p.x + p.hw; x += 3)
      for (const z of [p.z - p.hd, p.z + p.hd])
        put('road/construction-fence', x, z, Math.PI / 2);
    for (let z = p.z - p.hd; z <= p.z + p.hd; z += 3) {
      // Ворота с запада — на дороге.
      if (Math.abs(z - 790) < 8) continue;
      for (const x of [p.x - p.hw, p.x + p.hw])
        put('road/construction-fence', x, z, 0);
    }
    reserve.add(p.x, p.z, Math.min(p.hw, p.hd) - 5);
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 3; j++)
        put(
          j === 1 ? 'nat/tent-detailedclosed' : 'nat/tent-detailedopen',
          p.x - 60 + i * 16,
          p.z - 60 + j * 14,
          Math.PI / 2,
          1.6,
        );
    // Техника: броня и грузовики, часть сгорела при прорыве.
    for (let i = 0; i < 6; i++)
      put(
        pick([
          'zk/truck-armored',
          'zk/pickup-armored',
          'zk/sports-armored',
          'car/truck',
          'car/truck-flat',
        ] as const),
        p.x + 40 + (i % 3) * 14,
        p.z - 40 + Math.floor(i / 3) * 20,
        0,
        1,
        undefined,
        rand() < 0.4 ? BURNED : undefined,
      );
    for (let i = 0; i < 6; i++)
      put(
        i % 2 ? 'zk/container-green' : 'zk/container-red',
        p.x - 80 + i * 8,
        p.z + 70,
        Math.PI / 2,
      );
    put('zk/water-tower', p.x + 90, p.z - 80, 0);
    for (let i = 0; i < 8; i++)
      put(
        rand() < 0.3 ? 'zk/chest-special' : 'zk/chest',
        p.x + 70 + (i % 4) * 2,
        p.z + 40 + Math.floor(i / 4) * 2,
        0,
      );
    // База пала: тела солдат и зомби по всему лагерю, у ворот — гуще.
    massacre(p.x - 30, p.z - 10, 40, 30, 0.35);
    massacre(p.x - p.hw - 10, 790, 12, 14, 0.4);
    for (let i = 0; i < 30; i++)
      put(
        'car/box',
        p.x + 20 + (rand() * 2 - 1) * 60,
        p.z + 30 + rand() * 50,
        rand() * 6.28,
        1.3,
      );
    for (const dz of [-6, 6])
      put('road/construction-light', p.x - p.hw - 3, 790 + dz, 0);
    for (const dz of [-3, 3])
      put('road/construction-barrier', p.x - p.hw - 8, 790 + dz, 0);
    put('car/police', p.x - p.hw - 16, 796, 0.3);
  }
  // Лагерь альпинистов: палатки и костёр на горном плато.
  {
    const p = PLACES.climbers;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      building(
        pick([
          'nat/tent-smallclosed',
          'nat/tent-smallopen',
          'nat/tent-detailedopen',
        ] as const),
        p.x + Math.cos(a) * 18,
        p.z + Math.sin(a) * 14,
        -a - Math.PI / 2,
      );
    }
    put('nat/campfire-logs', p.x, p.z, 0);
    put('nat/log-large', p.x + 4, p.z + 2, 0.5);
    put('nat/log-large', p.x - 4, p.z - 2, 2.1);
    // До лагеря они тоже добрались.
    massacre(p.x + 6, p.z + 8, 9, 5, 0.6);
  }
  // Лесопилка: штабеля брёвен, пни, грузовик.
  {
    const p = PLACES.sawmill;
    building('sub/building-type-h', p.x, p.z - 18, 0);
    for (let i = 0; i < 16; i++) {
      const x = p.x + (rand() * 2 - 1) * p.hw,
        z = p.z + rand() * p.hd;
      if (!reserve.free(x, z, 2)) continue;
      put(
        pick([
          'nat/log-stacklarge',
          'nat/log-stack',
          'nat/log-large',
          'nat/stump-squaredetailedwide',
          'grave/trunk-long',
        ] as const),
        x,
        z,
        rand() * 6.28,
      );
      reserve.add(x, z, 2);
    }
    put('car/truck-flat', p.x + 25, p.z - 10, 1.2, 1, undefined, RUST);
    reserve.add(p.x + 25, p.z - 10, 4);
    body(p.x - 6, p.z + 12, true);
    put('zk/axe', p.x - 4, p.z + 13, 0.7, 1, surface(p.x - 4, p.z + 13) + 0.02);
    massacre(p.x + 10, p.z + 20, 8, 4, 0);
  }

  // --- брошенные машины: пробки на выездах, одиночки на шоссе ---
  const wreck = (x: number, z: number, yaw: number) => {
    if (!reserve.free(x, z, 2.6)) return;
    const roll = rand();
    put(
      pick(CARS),
      x,
      z,
      yaw,
      1,
      undefined,
      roll < 0.35 ? BURNED : roll < 0.55 ? RUST : undefined,
    );
    reserve.add(x, z, 2.6);
    // У открытой двери — водитель, не успевший уйти, или тот, кто его догнал.
    if (rand() < 0.3) {
      const side = rand() < 0.5 ? -1 : 1;
      body(
        x + Math.cos(yaw) * side * 2.4,
        z - Math.sin(yaw) * side * 2.4,
        rand() < 0.6,
      );
    } else if (rand() < 0.2)
      blood(x + (rand() - 0.5) * 5, z + (rand() - 0.5) * 5);
    if (rand() < 0.3) {
      const dx = (rand() - 0.5) * 8,
        dz = (rand() - 0.5) * 8;
      if (reserve.free(x + dx, z + dz, 0.8))
        put(
          pick([
            'car/debris-tire',
            'car/debris-door',
            'car/debris-bumper',
            'car/debris-plate-b',
          ] as const),
          x + dx,
          z + dz,
          rand() * 6.28,
        );
    }
  };
  // Пробка между Новоградом и Мегаполисом. Машина смотрит вдоль своей оси z.
  for (let x = 110; x < 360; x += 7 + rand() * 6) {
    wreck(x, -2 + (rand() - 0.5), -Math.PI / 2 + (rand() - 0.5) * 0.4);
    if (rand() < 0.7)
      wreck(x + 3, 2 + (rand() - 0.5), Math.PI / 2 + (rand() - 0.5) * 0.4);
  }
  // Одиночные машины по всем дорогам, часть — поперёк.
  for (const road of ROADS)
    for (let i = 1; i < road.length; i++) {
      const [ax, az] = road[i - 1],
        [bx, bz] = road[i];
      const len = Math.hypot(bx - ax, bz - az);
      const dir = Math.atan2(bz - az, bx - ax);
      for (let d = 30 + rand() * 60; d < len - 10; d += 60 + rand() * 120) {
        const lane = rand() < 0.5 ? -2 : 2;
        const x = ax + ((bx - ax) * d) / len - Math.sin(dir) * lane,
          z = az + ((bz - az) * d) / len + Math.cos(dir) * lane;
        // Модель машины смотрит вдоль +z: по ходу дороги — поворот π/2 − dir.
        const along = Math.PI / 2 - dir + (lane > 0 ? 0 : Math.PI);
        if (!inPlace(x, z, 0) || rand() < 0.4)
          wreck(
            x,
            z,
            along + (rand() < 0.25 ? rand() * 3 : (rand() - 0.5) * 0.3),
          );
      }
    }
  // Блокпосты на въездах в Мегаполис и Новоград.
  for (const [x, z, yaw] of [
    [362, 0, Math.PI / 2],
    [-280, 180, Math.PI / 2],
    [-30, 252, 0],
  ] as const) {
    for (const k of [-3, -1, 1, 3]) {
      const bx = x + Math.cos(yaw) * k * 1.2,
        bz = z - Math.sin(yaw) * k * 1.2;
      // Барьер длинный вдоль своей оси z: ставим его вдоль линии заграждения.
      put('road/construction-barrier', bx, bz, yaw - Math.PI / 2);
      reserve.add(bx, bz, 1);
    }
    put(
      'road/construction-light',
      x + Math.cos(yaw) * 6,
      z - Math.sin(yaw) * 6,
      0,
    );
    wreck(
      x + Math.sin(yaw) * -8 + Math.cos(yaw) * 5,
      z + Math.cos(yaw) * -8 - Math.sin(yaw) * 5,
      yaw + 0.2,
    );
    // Блокпост не удержали: за заграждением — полицейские и солдаты, перед ним — волна зомби.
    const bx = x - Math.sin(yaw) * 12,
      bz = z - Math.cos(yaw) * 12;
    massacre(bx, bz, 9, 12, 0.15);
    massacre(x + Math.sin(yaw) * 6, z + Math.cos(yaw) * 6, 6, 5, 0.8);
    for (const k of [-6, 6]) {
      const px = x + Math.cos(yaw) * k,
        pz = z - Math.sin(yaw) * k;
      if (reserve.free(px, pz, 0.8))
        put('zk/plastic-barrier', px, pz, yaw - Math.PI / 2);
    }
  }
  // Указатели на въездах в города.
  for (const [x, z, yaw] of [
    [-300, 188, 0],
    [340, 9, 0],
    [-38, 280, Math.PI / 2],
  ] as const)
    if (reserve.free(x, z, 3)) {
      put('zk/town-sign', x, z, yaw, 1, undefined, SOOT);
      reserve.add(x, z, 3);
    }
  // Одиночные тела и кровь вдоль шоссе — следы тех, кто уходил пешком.
  for (const road of ROADS)
    for (let i = 1; i < road.length; i++) {
      const [ax, az] = road[i - 1],
        [bx, bz] = road[i];
      const len = Math.hypot(bx - ax, bz - az);
      for (let d = 40 + rand() * 80; d < len - 10; d += 90 + rand() * 160) {
        const x = ax + ((bx - ax) * d) / len + (rand() - 0.5) * 12,
          z = az + ((bz - az) * d) / len + (rand() - 0.5) * 12;
        if (rand() < 0.6) body(x, z, rand() < 0.4);
        else blood(x, z);
      }
    }
  // Фонари вдоль улиц города и мегаполиса.
  for (const g of [CITY_GRID, MEGA_GRID]) {
    for (const x of gridLines(g.x0, g.x1, g.step))
      for (let z = g.z0 + 16; z < g.z1 - 8; z += 30) {
        const lx = x + 5.2;
        if (reserve.free(lx, z, 0.5)) {
          // Вынос фонаря смотрит в −z модели: разворачиваем его на проезжую часть.
          put('road/light-square', lx, z, Math.PI / 2);
          reserve.add(lx, z, 0.5);
        }
      }
    for (const z of gridLines(g.z0, g.z1, g.step))
      for (let x = g.x0 + 16; x < g.x1 - 8; x += 30) {
        const lz = z + 5.2;
        if (reserve.free(x, lz, 0.5)) {
          put('road/light-curved', x, lz, 0);
          reserve.add(x, lz, 0.5);
        }
      }
  }

  // --- природа ---
  const PINES: readonly ModelId[] = [
    'nat/tree-pinedefaulta',
    'nat/tree-pinedefaultb',
    'nat/tree-pinerounda',
    'nat/tree-pineroundb',
    'nat/tree-pineroundc',
    'nat/tree-pinetalla',
    'nat/tree-pinetallb',
    'nat/tree-pinetallc',
    'nat/tree-pinetalld',
    'nat/tree-pinetalld-detailed',
    'nat/tree-pinesmalla',
    'nat/tree-pinesmallb',
    'grave/pine',
    'grave/pine-crooked',
  ];
  const LEAFY: readonly ModelId[] = [
    'nat/tree-oak',
    'nat/tree-oak-dark',
    'nat/tree-default',
    'nat/tree-default-dark',
    'nat/tree-detailed',
    'nat/tree-detailed-dark',
    'nat/tree-fat',
    'nat/tree-tall',
    'nat/tree-thin',
    'nat/tree-simple',
    'nat/tree-plateau',
    'nat/tree-oak-fall',
    'nat/tree-default-fall',
  ];
  const DARK: readonly ModelId[] = [
    'nat/tree-cone',
    'nat/tree-cone-dark',
    'nat/tree-tall-dark',
    'nat/tree-default-dark',
    'nat/tree-pinetallc',
    'nat/tree-pinetalld',
  ];
  const DRY: readonly ModelId[] = [
    'nat/tree-fat-fall',
    'nat/tree-simple-fall',
    'nat/tree-thin-fall',
    'nat/tree-plateau-fall',
    'nat/tree-default-fall',
  ];
  const BUSHES: readonly ModelId[] = [
    'nat/plant-bush',
    'nat/plant-bushdetailed',
    'nat/plant-bushlarge',
    'nat/plant-bushsmall',
    'nat/plant-bushtriangle',
    'nat/plant-bushlargetriangle',
  ];
  const ROCKS: readonly ModelId[] = [
    'nat/rock-largea',
    'nat/rock-largeb',
    'nat/rock-largec',
    'nat/rock-larged',
    'nat/rock-largee',
    'nat/rock-largef',
    'nat/rock-talla',
    'nat/rock-tallb',
    'nat/rock-tallc',
    'nat/rock-talld',
    'nat/rock-tallg',
    'nat/rock-tallh',
  ];
  const STONES: readonly ModelId[] = [
    'nat/stone-largea',
    'nat/stone-largeb',
    'nat/stone-largec',
    'nat/stone-larged',
    'nat/stone-largee',
    'nat/stone-largef',
    'nat/stone-talla',
    'nat/stone-tallb',
    'nat/stone-tallc',
  ];

  const wildOk = (x: number, z: number, r: number) =>
    Math.abs(x) < HALF - 2 &&
    Math.abs(z) < HALF - 2 &&
    !inPlace(x, z, 6) &&
    roadDistance(x, z) > ROAD_HALF + 3 + r &&
    Math.hypot(x - LAKE.x, z - LAKE.z) > LAKE.r + 4 &&
    reserve.free(x, z, r);

  const GRID = 9;
  for (let gx = -HALF; gx < HALF; gx += GRID)
    for (let gz = -HALF; gz < HALF; gz += GRID) {
      const x = gx + rand() * GRID,
        z = gz + rand() * GRID;
      const h = heightAt(x, z);
      const forest = forestMask(x, z);
      const mountain = mountainMask(x, z);
      const steppe = steppeMask(x, z);
      const roll = rand();
      let model: ModelId | null = null;
      let scale = 0.85 + rand() * 0.35;
      if (h > 68 || slopeAt(x, z) > 0.9) {
        if (roll < 0.05) model = pick(STONES);
      } else if (forest > 0.4 && roll < forest * 0.85) {
        model =
          x < -300 && z < 150
            ? pick(PINES)
            : x > 300
              ? pick(DARK)
              : pick(LEAFY);
      } else if (mountain > 0.25) {
        if (roll < 0.22) model = pick(PINES);
        else if (roll < 0.3) model = pick(STONES);
      } else if (steppe > 0.5) {
        if (roll < 0.012) model = pick(DRY);
        else if (roll < 0.03) model = pick(ROCKS);
        else if (roll < 0.06) model = pick(BUSHES);
      } else if (roll < 0.035) {
        model = pick(LEAFY);
      } else if (roll < 0.05) model = pick(BUSHES);
      else if (roll < 0.058) model = pick(ROCKS);
      if (!model) continue;
      const hit = OUTBREAK_MODELS[model].hit;
      const r = hit === 'box' ? 3 : hit === 'trunk' ? 1.6 : 0.8;
      if (hit === 'box') scale = 0.7 + rand() * 0.8;
      if (!wildOk(x, z, r)) continue;
      put(model, x, z, rand() * Math.PI * 2, scale, heightAt(x, z) - 0.15);
      if (hit !== 'none') reserve.add(x, z, r);
    }
  // Подлесок и трава: без столкновений, только для вида.
  for (let gx = -HALF; gx < HALF; gx += 12)
    for (let gz = -HALF; gz < HALF; gz += 12) {
      const x = gx + rand() * 12,
        z = gz + rand() * 12;
      if (heightAt(x, z) > 60 || !wildOk(x, z, 0.5)) continue;
      const forest = forestMask(x, z);
      const roll = rand();
      if (forest > 0.4) {
        if (roll < 0.08)
          put(
            pick([
              'nat/log-large',
              'nat/stump-oldtall',
              'nat/stump-round',
            ] as const),
            x,
            z,
            rand() * 6.28,
          );
        else if (roll < 0.2)
          put(
            pick([
              'nat/mushroom-redgroup',
              'nat/mushroom-tangroup',
              'nat/grass-leafslarge',
              'nat/grass-leafs',
            ] as const),
            x,
            z,
            rand() * 6.28,
          );
        else if (roll < 0.4) put(pick(BUSHES), x, z, rand() * 6.28);
      } else if (steppeMask(x, z) < 0.5 && roll < 0.35) {
        put(
          pick([
            'nat/grass',
            'nat/grass-large',
            'nat/grass',
            'nat/flower-reda',
            'nat/flower-yellowa',
            'nat/flower-purplea',
          ] as const),
          x,
          z,
          rand() * 6.28,
        );
      } else if (roll < 0.12)
        put(
          pick(['nat/grass', 'nat/grass-large'] as const),
          x,
          z,
          rand() * 6.28,
          0.8,
        );
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
  return { terrain, props, spawns, zones, water };
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Описание карты строится при первом обращении: генерация занимает доли секунды, но не нужна другим картам. */
export function buildOutbreak(): ArenaDef {
  const { terrain, props, spawns, zones, water } = generate();
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
    propKit: { url: OUTBREAK_PROPS_URL, models: OUTBREAK_MODELS },
    spawns,
    zones,
    navCell: 3,
    mood: 'grim',
    viewDistance: 320,
  };
}
