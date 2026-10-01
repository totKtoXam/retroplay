// Game maps. The hub keeps its own hand-built scene and collision (lib/world-collision.ts);
// team-battle maps are declarative ArenaDefs: one list of boxes, ramps, cylinders and water
// from which both the scene (components/world-arena-scene.ts) and the collision are built,
// so what players see and what blocks them cannot drift apart.
import { forEachColliderNear, type BoxCollider3D } from '../world-collision.ts';
import { procBuildingInfo } from './proc-buildings.ts';

export type Stance = 'stand' | 'sit' | 'lie';
/** Body height for collisions: crouching ('sit') and lying fit through low openings. */
export const STANCE_HEIGHT: Record<Stance, number> = { stand: 1.8, sit: 1.2, lie: 0.6 };
export const stanceHeight = (stance?: string) => STANCE_HEIGHT[stance as Stance] ?? 1.8;

export type Team = 'red' | 'blue';
export type SpawnPoint = { x: number; z: number; y?: number; yaw?: number };
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

/**
 * What a surface is made of: picks the texture in the scene (components/world-arena-materials.ts)
 * and the footstep sound (lib/footsteps.ts). Missing means the generic stone-like detail.
 */
export type SurfaceMaterial =
  | 'plaster'
  | 'wallpaper'
  | 'wood'
  | 'parquet'
  | 'tile'
  | 'checker'
  | 'marble'
  | 'carpet'
  | 'fabric'
  | 'leather'
  | 'metal'
  | 'brick'
  | 'books'
  | 'grass'
  /** Leaves: a box or sphere of it is drawn lumpy, as a bush or a crown. */
  | 'foliage'
  | 'paving'
  | 'soil'
  | 'planks'
  | 'roof-tiles'
  /** Old wet brick with grime: sewer walls. */
  | 'sewer';

/** Axis-aligned box given by its centre (x, y, z) and size (w along x, h along y, d along z). */
export type MapBox = {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: string;
  material?: SurfaceMaterial;
  /** Blocks movement and shots (walls, furniture, hedges). */
  solid?: boolean;
  /** Walkable top surface (floor slab, balcony); its underside is a ceiling. */
  floor?: boolean;
  /**
   * Detailed model drawn in place of the plain box (components/world-interior.ts), e.g.
   * `console:wires` or `floor:tile`. Collision still uses the box itself.
   */
  art?: string;
  /** Yaw of the model's front (+z at 0), for `art` models that face somewhere. */
  yaw?: number;
  /**
   * Euler rotation (x, y, z) about the centre, radians — decor only (a sloped handrail):
   * the collision of a solid box ignores it.
   */
  rot?: [number, number, number];
};
/** Sloped walkway: height goes from y0 at `from` to y1 at `to` along `axis`. */
export type MapRamp = Bounds & {
  axis: 'x' | 'z';
  from: number;
  to: number;
  y0: number;
  y1: number;
  color: string;
  material?: SurfaceMaterial;
  /** Drawn as a flight of this many steps; walking still follows the smooth slope. */
  steps?: number;
};
export type MapCylinder = {
  x: number;
  y: number;
  z: number;
  r: number;
  h: number;
  color: string;
  /** Blocks as its bounding box. */
  solid?: boolean;
  sides?: number;
  material?: SurfaceMaterial;
  /** Detailed model drawn in place of the plain cylinder, as `MapBox.art`. */
  art?: string;
  /** Lies along this axis (a pipe), `h` being its length — decor only: collision assumes upright. */
  axis?: 'x' | 'z';
};
/**
 * A pitched roof, drawn only: two slopes of `material` rising `rise` above `y` to a ridge
 * along `ridge`, closed at both ends by gables of `gable`. `overhang` is the eaves' reach
 * beyond the footprint.
 */
export type MapRoof = Bounds & {
  y: number;
  rise: number;
  ridge: 'x' | 'z';
  color: string;
  material?: SurfaceMaterial;
  gable: string;
  gableMaterial?: SurfaceMaterial;
  overhang?: number;
};
/**
 * Purely visual detail (door frame, window, pipe, wall screen): no collision, so it must
 * stay out of the way — on a wall or above head height. Front faces +z rotated by `yaw`.
 */
/**
 * Модуль внешнего корпуса: прямоугольник пола отсека или коридора, снаружи обшитый
 * бронёй. `kind` — что пристроено снаружи (двигатели, антенна, купол…), по id отсека.
 */
export type HullModule = { minX: number; minZ: number; maxX: number; maxZ: number; kind: string };

export type MapDecor = {
  kind: string;
  x: number;
  y: number;
  z: number;
  /** Size along the local x (width) and y (height); depth is up to the model. */
  w: number;
  h: number;
  yaw: number;
  label?: string;
};
/**
 * A fountain: water arcs from a jet at (x, jetY, z) into a bowl of radius `bowlR` at `bowlY`,
 * spills over its rim and falls into the pool below. Scene only — the pedestal, bowl and pool
 * are ordinary cylinders, boxes and water.
 */
export type MapFountain = { x: number; z: number; jetY: number; bowlY: number; bowlR: number; poolY: number };
export type MapSphere = { x: number; y: number; z: number; r: number; color: string; material?: SurfaceMaterial };
/** Still water at height `y`; with `round` it is the disc inscribed in the bounds (a fountain bowl). */
export type MapWater = Bounds & { y: number; color?: string; round?: boolean };
export type MapLight = { x: number; y: number; z: number; color: string; intensity: number; distance: number };
/**
 * Kind of mini-game at a task station (режим «Предатель», lib/impostor.ts). Первые пять —
 * исходный набор; остальные добавлены по мотивам заданий Among Us и закреплены за конкретными
 * отсеками «Корабля» (lib/maps/ship.ts).
 */
export type TaskKind =
  | 'wires'
  | 'hold'
  | 'calibrate'
  | 'code'
  | 'upload'
  /** Оружейная: сбить кликом падающие астероиды. */
  | 'asteroids'
  /** Администрация: провести пропуск с нужной скоростью — не быстрее и не медленнее. */
  | 'swipe'
  /** O2: перетащить листья с решётки фильтра в сторону. */
  | 'leaves'
  /** Щиты: кликами погасить все красные шестиугольники. */
  | 'shields'
  /** Двигатели: ползунком выставить и удержать метку на линии. */
  | 'align'
  /** Реактор: повторить растущую последовательность подсвеченных кнопок. */
  | 'simon'
  /** Хранилище: перетащить канистру к баку и дождаться заправки. */
  | 'fuel';
/** A place where a crewmate does a task: the player must stand within reach of (x, z). */
export type TaskStation = { id: string; kind: TaskKind; title: string; room: string; x: number; z: number };
/**
 * Sabotage of the impostor mode: `lights` cuts the crew's vision, `comms` hides task lists,
 * `reactor` and `o2` are critical — unrepaired in time, they win the game for the impostors.
 */
export type SabotageKind = 'lights' | 'comms' | 'reactor' | 'o2';
/** A panel where a sabotage is repaired; a kind may need several panels. */
export type SabotagePanel = { id: string; sabotage: SabotageKind; title: string; room: string; x: number; z: number };
/** A vent: impostors hide in it and crawl to the linked vents. Links are symmetric. */
export type MapVent = { id: string; room: string; x: number; z: number; links: string[] };
/** A named room of a map. */
export type MapZone = Bounds & { id: string; name: string };
/** The meeting table with the emergency button at its centre. */
export type MeetingPoint = { x: number; z: number; /** Seat ring radius around the table. */ seats: number };

/**
 * Рельеф: сетка высот земли с шагом `cell` м от угла (minX, minZ), `cols` × `rows` узлов
 * по строкам вдоль x. Между узлами высота интерполируется. Нужен большим картам с горами
 * и низинами; без него земля везде на y = 0.
 */
export type MapTerrain = {
  minX: number;
  minZ: number;
  cell: number;
  cols: number;
  rows: number;
  heights: Float32Array;
  /**
   * Вид земли в каждом узле (индекс в `palette`): трава, лес, степь, скалы, снег, асфальт…
   * Только для сцены и миникарты.
   */
  kinds?: Uint8Array;
  /**
   * `texture` — id PBR-набора в public/textures/outbreak/<id>/ (трава, асфальт, грязь):
   * им рельеф рисуется вблизи, а `color` остаётся для миникарты и дальнего плана.
   */
  palette?: { color: string; name: string; texture?: string }[];
};

/** Готовая модель из набора карты (`ArenaDef.propKit`), поставленная в мир. */
export type MapProp = {
  /** Id модели в `propKit.models`. */
  m: string;
  x: number;
  y: number;
  z: number;
  /** Поворот вокруг вертикали, радианы. */
  yaw?: number;
  /** Множитель размера. */
  s?: number;
  /**
   * Оттенок-множитель цвета модели (#rrggbb): сгоревшая машина почти чёрная, ржавая —
   * рыжая, дом в копоти — серее. Только для вида.
   */
  tint?: string;
};
/** Рамка модели в метрах у её начала координат (до поворота) и как она сталкивается. */
export type PropModelInfo = {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  /** 'box' — вся рамка, 'trunk' — ствол полушириной `t` у начала координат, 'none' — сквозь. */
  hit: 'box' | 'trunk' | 'none';
  t?: number;
  /** Кровь и тела: их прячет настройка игрока «Кровь и жестокость». Столкновений у них нет. */
  gore?: boolean;
};
/**
 * Модель набора. С `file` она грузится из своего .glb (сканы со своими материалами и
 * текстурами, часто из нескольких мешей), без него — узлом `prop:<id>` из общего `PropKit.url`.
 */
export type PropKitModel = PropModelInfo & {
  /** URL своего .glb, например `/models/outbreak-real/vehicles/sedan.glb`. */
  file?: string;
  /** Треугольников в модели: тяжёлые сканы рисуются только вблизи. */
  tris?: number;
  /** Модель со скелетом (фигуры `ArenaDef.npcs`) и имена её анимаций. */
  skinned?: boolean;
  clips?: readonly string[];
};
/**
 * Набор моделей карты и их рамки. `url` — старый общий .glb с узлами `prop:<id>` для
 * моделей без своего `file`.
 */
export type PropKit = { url?: string; models: Readonly<Record<string, PropKitModel>> };

/** Процедурное здание: id вида `proc/building:<w>x<d>x<этажей>:<зерно>:<стиль>` (lib/maps/proc-buildings.ts). */
export const PROC_PREFIX = 'proc/';
export const isProcModel = (id: string) => id.startsWith(PROC_PREFIX);

/**
 * Рамка модели по id: из набора карты, а у процедурных зданий — по разбору самого id,
 * чтобы столкновения, миникарта и сцена считали их одинаково.
 */
export function propModelInfo(kit: PropKit | undefined, id: string): PropKitModel | undefined {
  return kit?.models[id] ?? (isProcModel(id) ? procBuildingInfo(id) : undefined);
}

/**
 * Пятно на земле (кровь, грязь, ржавые потёки): квадрат стороной `s` м, повёрнутый на `yaw`,
 * лежит на высоте `y` (без неё — на рельефе). Столкновений нет. Как id текстуры превращается
 * в файлы и какие пятна прячет настройка «Кровь и жестокость» — lib/maps/decals.ts.
 */
export type MapDecal = { x: number; y?: number; z: number; yaw?: number; s?: number; texture: string };
/**
 * Живая фигура для атмосферы (components/world-ambient-npcs.ts): зомби бредёт на месте,
 * выживший стоит. `m` — id скелетной модели в `propKit.models`, `clip` — имя анимации.
 * Без `y` стоит на рельефе. Столкновений нет: это декор, а не боты.
 */
export type MapNpc = { m: string; x: number; y?: number; z: number; yaw?: number; clip: string; s?: number };
/** Дорога: лента шириной `width` м по точкам осевой линии, `texture` — PBR-набор (асфальт). */
export type MapRoad = { points: [number, number][]; width: number; texture?: string };
/** HDRI-небо и освещение окружения: файл public/hdri/<hdri>.hdr. */
export type MapSky = { hdri: string; exposure?: number };

export type ArenaDef = {
  id: string;
  title: string;
  /** Playable area; the client and the server clamp poses to exactly these bounds. */
  bounds: Bounds;
  groundColor: string;
  groundMaterial?: SurfaceMaterial;
  /**
   * The season the map is painted in (lib/season-colors.ts); other seasons recolour it
   * from there. Missing means summer.
   */
  season?: 'spring' | 'summer' | 'autumn' | 'winter';
  /** Terrain beyond the walls. */
  outsideColor?: string;
  boxes: MapBox[];
  ramps?: MapRamp[];
  cylinders?: MapCylinder[];
  spheres?: MapSphere[];
  roofs?: MapRoof[];
  water?: MapWater[];
  /**
   * Scene-only detail: furniture legs, cushions, frames, lamps, ceilings. Never collides, never
   * counts as a roof or a floor, never shortens the camera boom.
   */
  furnishings?: MapBox[];
  furnishingCylinders?: MapCylinder[];
  fountains?: MapFountain[];
  lights?: MapLight[];
  spawns: Record<Team, SpawnPoint[]>;
  /** Task stations of the impostor mode. */
  stations?: TaskStation[];
  meeting?: MeetingPoint;
  /** Named rooms, e.g. to tell a player where they are. */
  zones?: MapZone[];
  /** The whole map is indoors: no precipitation and no wind. */
  indoor?: boolean;
  /** Sabotage repair panels of the impostor mode. */
  panels?: SabotagePanel[];
  vents?: MapVent[];
  /** Visual-only details: door frames, windows, pipes. */
  decor?: MapDecor[];
  /**
   * Карта — корабль в открытом космосе: снаружи строится корпус по этим модулям, окна
   * сквозные, за ними — космос и другие отсеки, а земли под кораблём нет.
   */
  hull?: HullModule[];
  /** Рельеф земли; без него земля плоская на y = 0. */
  terrain?: MapTerrain;
  /** Готовые модели (дома, деревья, машины) из `propKit`. */
  props?: MapProp[];
  propKit?: PropKit;
  /** Пятна крови и грязи на земле. */
  decals?: MapDecal[];
  /** Анимированные фигуры для атмосферы. */
  npcs?: MapNpc[];
  /** Асфальтовые ленты дорог поверх рельефа. */
  roads?: MapRoad[];
  /** Небо из HDRI вместо градиента. */
  sky?: MapSky;
  /**
   * Шаг сетки проходимости ботов, м (по умолчанию 0,75). Огромной карте нужен крупнее:
   * мелкая сетка на квадратные километры не поместилась бы в память объекта комнаты.
   */
  navCell?: number;
  /**
   * Сколько метров видно до полного тумана (по умолчанию — от размера карты, не дальше
   * 330 м). На огромной карте мир за туманом не рисуется вовсе.
   */
  viewDistance?: number;
  /**
   * Настроение карты: 'grim' — мрачный мир после катастрофы: блёклые цвета моделей и
   * земли, тяжёлое небо, дымка, приглушённое солнце и виньетка поверх кадра.
   */
  mood?: 'grim';
};

export type GameMap = {
  id: string;
  title: string;
  bounds: Bounds;
  colliders: BoxCollider3D[];
  /** Walkable height under (x, z) for a body whose feet are at `y`. */
  groundHeight: (x: number, z: number, y?: number) => number;
  /** Lowest ceiling above feet at `y` (Infinity: open sky). */
  ceilingHeight: (x: number, z: number, y?: number) => number;
  spawns: Record<Team, SpawnPoint[]>;
  /** Set for declarative maps; the hub builds its own scene. */
  arena?: ArenaDef;
  /** Task stations of the impostor mode; empty on other maps. */
  stations: TaskStation[];
  meeting?: MeetingPoint;
  panels: SabotagePanel[];
  vents: MapVent[];
  /** Высота рельефа под (x, z) без построек (0 на картах без рельефа). */
  terrainHeight?: (x: number, z: number) => number;
  /** Где могут быть ноги игрока, м (по умолчанию 0–10): у карты с горами — от низин до вершин. */
  heightRange?: readonly [number, number];
};

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const within = (c: Bounds, x: number, z: number) =>
  x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ;

export const boxCollider = (b: MapBox, label?: string): BoxCollider3D => ({
  minX: b.x - b.w / 2,
  maxX: b.x + b.w / 2,
  minZ: b.z - b.d / 2,
  maxZ: b.z + b.d / 2,
  minY: b.y - b.h / 2,
  maxY: b.y + b.h / 2,
  label,
});

/** Height of a ramp at (x, z). */
export const rampHeight = (r: MapRamp, x: number, z: number) =>
  r.y0 + (r.y1 - r.y0) * clamp01(((r.axis === 'x' ? x : z) - r.from) / (r.to - r.from));

/** Four solid walls just inside `bounds`. */
export function perimeterWalls(b: Bounds, height = 4, thickness = 0.6, color = '#8a8f98'): MapBox[] {
  const w = b.maxX - b.minX,
    d = b.maxZ - b.minZ,
    t = thickness,
    y = height / 2;
  return [
    { x: (b.minX + b.maxX) / 2, y, z: b.minZ + t / 2, w, h: height, d: t, color, solid: true },
    { x: (b.minX + b.maxX) / 2, y, z: b.maxZ - t / 2, w, h: height, d: t, color, solid: true },
    { x: b.minX + t / 2, y, z: (b.minZ + b.maxZ) / 2, w: t, h: height, d, color, solid: true },
    { x: b.maxX - t / 2, y, z: (b.minZ + b.maxZ) / 2, w: t, h: height, d, color, solid: true },
  ];
}

/** Высота рельефа в точке: билинейно между узлами сетки, за её краем — по крайнему узлу. */
export function terrainHeightAt(t: MapTerrain, x: number, z: number) {
  const fx = Math.max(0, Math.min(t.cols - 1.0001, (x - t.minX) / t.cell)),
    fz = Math.max(0, Math.min(t.rows - 1.0001, (z - t.minZ) / t.cell));
  const ix = Math.floor(fx),
    iz = Math.floor(fz);
  const ax = fx - ix,
    az = fz - iz;
  const i = iz * t.cols + ix,
    h = t.heights;
  const top = h[i] + (h[i + 1] - h[i]) * ax,
    bottom = h[i + t.cols] + (h[i + t.cols + 1] - h[i + t.cols]) * ax;
  return top + (bottom - top) * az;
}

/** Высоты ног от самой низкой точки рельефа до вершин с запасом на прыжок и крыши. */
function terrainRange(t: MapTerrain): [number, number] {
  let low = 0,
    high = 0;
  for (const h of t.heights) {
    low = Math.min(low, h);
    high = Math.max(high, h);
  }
  return [Math.floor(low - 1), Math.ceil(Math.max(10, high + 10))];
}

/**
 * Толща гор для столкновений: под каждым квадратом рельефа со стороной `TERRAIN_BLOCK` м
 * — коробка до самой низкой его точки минус запас. Сквозь неё не пройдёт ни пуля, ни
 * взгляд бота, а по склону над ней ходят как обычно: верх коробки всегда ниже земли.
 */
const TERRAIN_BLOCK = 8;
function terrainColliders(t: MapTerrain): BoxCollider3D[] {
  const out: BoxCollider3D[] = [];
  const step = Math.max(1, Math.round(TERRAIN_BLOCK / t.cell));
  for (let r = 0; r < t.rows - 1; r += step)
    for (let c = 0; c < t.cols - 1; c += step) {
      let low = Infinity;
      for (let dr = 0; dr <= step && r + dr < t.rows; dr++)
        for (let dc = 0; dc <= step && c + dc < t.cols; dc++) low = Math.min(low, t.heights[(r + dr) * t.cols + c + dc]);
      const top = low - 0.4;
      if (top < 0.8) continue;
      out.push({
        minX: t.minX + c * t.cell,
        maxX: t.minX + Math.min(c + step, t.cols - 1) * t.cell,
        minZ: t.minZ + r * t.cell,
        maxZ: t.minZ + Math.min(r + step, t.rows - 1) * t.cell,
        minY: -50,
        maxY: top,
        label: 'terrain',
      });
    }
  return out;
}

/**
 * Столкновение готовой модели. Коробка, повёрнутая не на кратный 90° угол, режется вдоль
 * длинной стороны на куски: рамка каждого куска ближе к модели, чем рамка целой коробки
 * (брошенная поперёк дороги машина не перегораживает полосу своей диагональю).
 */
export function propColliders(p: MapProp, info: PropModelInfo): BoxCollider3D[] {
  if (info.hit === 'none') return [];
  const s = p.s ?? 1;
  const minY = p.y + info.min[1] * s,
    maxY = p.y + info.max[1] * s;
  if (info.hit === 'trunk') {
    const t = (info.t ?? 0.3) * s;
    return [{ minX: p.x - t, maxX: p.x + t, minZ: p.z - t, maxZ: p.z + t, minY, maxY }];
  }
  const yaw = p.yaw ?? 0;
  const cos = Math.cos(yaw),
    sin = Math.sin(yaw);
  // Локальная точка (lx, lz) → мир (поворот вокруг y, как у three.js).
  const toWorld = (lx: number, lz: number) => [p.x + lx * cos + lz * sin, p.z - lx * sin + lz * cos];
  const x0 = info.min[0] * s,
    x1 = info.max[0] * s,
    z0 = info.min[2] * s,
    z1 = info.max[2] * s;
  const quarter = Math.abs(Math.sin(yaw * 2)) < 1e-3;
  const alongX = x1 - x0 >= z1 - z0;
  const pieces = quarter ? 1 : Math.min(6, Math.max(1, Math.round(alongX ? (x1 - x0) / (z1 - z0) : (z1 - z0) / (x1 - x0))));
  const out: BoxCollider3D[] = [];
  for (let i = 0; i < pieces; i++) {
    const a = i / pieces,
      b = (i + 1) / pieces;
    const lx0 = alongX ? x0 + (x1 - x0) * a : x0,
      lx1 = alongX ? x0 + (x1 - x0) * b : x1,
      lz0 = alongX ? z0 : z0 + (z1 - z0) * a,
      lz1 = alongX ? z1 : z0 + (z1 - z0) * b;
    const corners = [toWorld(lx0, lz0), toWorld(lx1, lz0), toWorld(lx0, lz1), toWorld(lx1, lz1)];
    out.push({
      minX: Math.min(...corners.map((c) => c[0])),
      maxX: Math.max(...corners.map((c) => c[0])),
      minZ: Math.min(...corners.map((c) => c[1])),
      maxZ: Math.max(...corners.map((c) => c[1])),
      minY,
      maxY,
    });
  }
  return out;
}

/** Collision for a declarative map. Base ground is y = 0 everywhere, or the terrain. */
export function buildArena(def: ArenaDef): GameMap {
  const kit = def.propKit;
  const colliders: BoxCollider3D[] = [
    ...def.boxes.filter((b) => b.solid).map((b) => boxCollider(b)),
    ...(def.cylinders ?? [])
      .filter((c) => c.solid)
      .map((c) => ({
        minX: c.x - c.r,
        maxX: c.x + c.r,
        minZ: c.z - c.r,
        maxZ: c.z + c.r,
        minY: c.y - c.h / 2,
        maxY: c.y + c.h / 2,
      })),
    ...(def.props ?? []).flatMap((p) => {
      const info = propModelInfo(kit, p.m);
      return info ? propColliders(p, info) : [];
    }),
    ...(def.terrain ? terrainColliders(def.terrain) : []),
  ];
  const floors = def.boxes.filter((b) => b.floor).map((b) => boxCollider(b));
  const ramps = def.ramps ?? [];
  const terrain = def.terrain;
  const base = terrain ? (x: number, z: number) => terrainHeightAt(terrain, x, z) : () => 0;
  const groundHeight = (x: number, z: number, y = 0) => {
    let ground = base(x, z);
    for (const r of ramps) {
      if (!within(r, x, z)) continue;
      const h = rampHeight(r, x, z);
      if (y >= h - 0.7) ground = Math.max(ground, h);
    }
    forEachColliderNear(floors, x, x, z, z, (f) => {
      if (within(f, x, z) && y >= f.maxY - 0.7) ground = Math.max(ground, f.maxY);
    });
    // Tops of furniture and walls can be landed on, as in the hub.
    forEachColliderNear(colliders, x, x, z, z, (c) => {
      if (within(c, x, z) && y >= c.maxY - 0.6) ground = Math.max(ground, c.maxY);
    });
    return ground;
  };
  const ceilingHeight = (x: number, z: number, y = 0) => {
    let ceiling = Number.POSITIVE_INFINITY;
    const lower = (c: BoxCollider3D) => {
      if (within(c, x, z) && c.minY >= y + 0.3) ceiling = Math.min(ceiling, c.minY);
    };
    forEachColliderNear(floors, x, x, z, z, lower);
    forEachColliderNear(colliders, x, x, z, z, lower);
    return ceiling;
  };
  return {
    id: def.id,
    title: def.title,
    bounds: def.bounds,
    colliders,
    groundHeight,
    ceilingHeight,
    spawns: def.spawns,
    arena: def,
    stations: def.stations ?? [],
    meeting: def.meeting,
    panels: def.panels ?? [],
    vents: def.vents ?? [],
    terrainHeight: terrain ? base : undefined,
    heightRange: terrain ? terrainRange(terrain) : undefined,
  };
}
