import type {
  ArenaDef,
  MapBox,
  MapCylinder,
  MapLight,
  MapVent,
  SabotageKind,
  SabotagePanel,
  SpawnPoint,
  TaskKind,
  TaskStation,
} from './types.ts';

// «Корабль» — карта режима «Предатель», по мотивам Skeld из Among Us. Четырнадцать отсеков
// соединены коридорами в два кольца вокруг хранилища: восточное (кафетерий → оружейная →
// навигация → щиты → связь → хранилище) и западное (кафетерий → верхний двигатель →
// реактор → нижний двигатель → хранилище). Медпункт, O2, администрация, электрика и охрана —
// тупики: в них можно остаться одному, и там опаснее всего.
//
// Отсеки и коридоры задаются прямоугольниками пола, а стены строятся по границе их
// объединения (`wallsAround`). Дверь получается сама — там, где торец коридора касается
// стороны отсека, поэтому отсеки друг друга не касаются, только через коридор.

const BOUNDS = { minX: -50, maxX: 50, minZ: -34, maxZ: 34 };
const WALL_H = 3.2;
const WALL_T = 0.3;
const CELL = 0.5;

const HULL = '#1c212b';
const WALL = '#8d97a6';
const CORRIDOR = '#5f6873';
const CONSOLE = '#2b3340';
const METAL = '#6f7a88';
const CRATE = '#9a7b4f';

type Rect = { minX: number; minZ: number; maxX: number; maxZ: number };
type Room = Rect & { id: string; name: string; floor: string; light: string };

const room = (id: string, name: string, minX: number, minZ: number, maxX: number, maxZ: number, floor: string, light: string): Room => ({
  id,
  name,
  minX,
  minZ,
  maxX,
  maxZ,
  floor,
  light,
});
const rect = (minX: number, minZ: number, maxX: number, maxZ: number): Rect => ({ minX, minZ, maxX, maxZ });

export const SHIP_ROOMS: Room[] = [
  room('cafeteria', 'Кафетерий', -10, -32, 10, -14, '#c9ccd2', '#ffffff'),
  room('weapons', 'Оружейная', 22, -32, 34, -22, '#9aa3ad', '#ffd2a1'),
  room('o2', 'O2', 18, -16, 28, -8, '#a9c3bd', '#b8fff0'),
  room('navigation', 'Навигация', 38, -8, 48, 8, '#9fb0c4', '#8fd3ff'),
  room('shields', 'Щиты', 22, 16, 34, 28, '#b0a9c4', '#d9c2ff'),
  room('comms', 'Связь', 4, 24, 14, 32, '#a3aab3', '#c8e3ff'),
  room('storage', 'Хранилище', -8, 6, 8, 22, '#aa9f8c', '#ffe7b8'),
  room('admin', 'Администрация', 10, -4, 20, 6, '#b8b1a0', '#fff1c9'),
  room('electrical', 'Электрика', -22, 8, -12, 18, '#9c9a86', '#ffe27a'),
  room('lower-engine', 'Нижний двигатель', -42, 14, -30, 26, '#958f8a', '#ffb38a'),
  room('reactor', 'Реактор', -48, -8, -40, 8, '#9c8f8f', '#ff9a6b'),
  room('upper-engine', 'Верхний двигатель', -42, -28, -30, -16, '#958f8a', '#ffb38a'),
  room('security', 'Охрана', -30, -6, -22, 2, '#8f98a3', '#a8c8ff'),
  room('medbay', 'Медпункт', -24, -18, -14, -8, '#b9d0cc', '#9dffc8'),
];

/** Коридоры шириной 3 м; их торцы, касаясь отсеков, становятся дверями. */
const CORRIDORS: Rect[] = [
  rect(-30, -25, -10, -22), // кафетерий — верхний двигатель
  rect(-20, -22, -17, -18), // ответвление в медпункт
  rect(10, -28, 22, -25), // кафетерий — оружейная
  rect(29, -22, 32, -12), // оружейная — восточный коридор
  rect(28, -12, 43, -9), // восточный коридор, дверь в O2
  rect(40, -9, 43, -8), // дверь в навигацию
  rect(40, 8, 43, 20), // навигация — щиты
  rect(34, 20, 43, 23), // дверь в щиты
  rect(14, 25, 22, 28), // щиты — связь
  rect(5, 22, 8, 24), // связь — хранилище
  rect(-1.5, -14, 1.5, 6), // кафетерий — хранилище
  rect(1.5, -1, 10, 2), // ответвление в администрацию
  rect(-30, 19, -8, 22), // хранилище — нижний двигатель
  rect(-18, 18, -15, 19), // дверь в электрику
  rect(-38, 4, -35, 14), // нижний двигатель — реактор
  rect(-40, 1, -35, 4), // нижняя дверь реактора
  rect(-38, -16, -35, -1), // верхний двигатель — реактор
  rect(-40, -4, -35, -1), // верхняя дверь реактора
  rect(-35, -3, -30, 0), // дверь в охрану
];

const inside = (r: Rect, x: number, z: number) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;

/**
 * Стены по границе объединения прямоугольников: на сетке CELL ищем рёбра между полом и
 * пустотой и склеиваем соседние рёбра в длинные стены. Стена стоит по оси ребра и чуть
 * заходит в проход — на 0,15 м, что меньше радиуса тела и не мешает.
 */
export function wallsAround(areas: Rect[], bounds: Rect, color: string): MapBox[] {
  const nx = Math.round((bounds.maxX - bounds.minX) / CELL);
  const nz = Math.round((bounds.maxZ - bounds.minZ) / CELL);
  const floor = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return false;
    const x = bounds.minX + (i + 0.5) * CELL,
      z = bounds.minZ + (j + 0.5) * CELL;
    return areas.some((a) => inside(a, x, z));
  };
  const walls: MapBox[] = [];
  const wall = (x0: number, z0: number, x1: number, z1: number) =>
    walls.push({
      x: (x0 + x1) / 2,
      y: WALL_H / 2,
      z: (z0 + z1) / 2,
      w: x1 - x0 + WALL_T,
      h: WALL_H,
      d: z1 - z0 + WALL_T,
      color,
      solid: true,
    });
  // Рёбра вдоль x (граница между клетками j-1 и j) и вдоль z (между i-1 и i).
  for (let j = 0; j <= nz; j++) {
    let start = -1;
    for (let i = 0; i <= nx; i++) {
      const edge = i < nx && floor(i, j - 1) !== floor(i, j);
      if (edge && start < 0) start = i;
      if (!edge && start >= 0) {
        const z = bounds.minZ + j * CELL;
        wall(bounds.minX + start * CELL, z, bounds.minX + i * CELL, z);
        start = -1;
      }
    }
  }
  for (let i = 0; i <= nx; i++) {
    let start = -1;
    for (let j = 0; j <= nz; j++) {
      const edge = j < nz && floor(i - 1, j) !== floor(i, j);
      if (edge && start < 0) start = j;
      if (!edge && start >= 0) {
        const x = bounds.minX + i * CELL;
        wall(x, bounds.minZ + start * CELL, x, bounds.minZ + j * CELL);
        start = -1;
      }
    }
  }
  return walls;
}

type Side = 'n' | 's' | 'e' | 'w';
const PANEL = '#6a2e33';
const byId = new Map(SHIP_ROOMS.map((r) => [r.id, r]));

/**
 * Пульт у стены отсека: сам пульт — твёрдый, точка задания — перед ним, в шаге от стены.
 * `n` — стена с меньшим z, `s` — с большим, `w` — с меньшим x, `e` — с большим; `at` —
 * координата вдоль стены.
 */
function station(id: string, kind: TaskKind, title: string, roomId: string, side: Side, at: number) {
  const { box, point, room } = console3d(roomId, side, at, CONSOLE);
  return { box, station: { id, kind, title, room, ...point } satisfies TaskStation };
}

/** Пульт аварии: такой же, как пульт задания, но красный. */
function panel(id: string, sabotage: SabotageKind, title: string, roomId: string, side: Side, at: number) {
  const { box, point, room } = console3d(roomId, side, at, PANEL);
  return { box, panel: { id, sabotage, title, room, ...point } satisfies SabotagePanel };
}

function console3d(roomId: string, side: Side, at: number, color: string) {
  const r = byId.get(roomId)!;
  const console = 0.45,
    point = 1.2;
  const pos = (offset: number) =>
    side === 'n'
      ? { x: at, z: r.minZ + offset }
      : side === 's'
        ? { x: at, z: r.maxZ - offset }
        : side === 'w'
          ? { x: r.minX + offset, z: at }
          : { x: r.maxX - offset, z: at };
  const along = side === 'n' || side === 's';
  const c = pos(console);
  const box: MapBox = { x: c.x, y: 0.55, z: c.z, w: along ? 1.2 : 0.6, h: 1.1, d: along ? 0.6 : 1.2, color, solid: true };
  return { box, point: pos(point), room: r.name };
}

const PLACED = [
  station('cafe-wires', 'wires', 'Починить проводку', 'cafeteria', 'n', -6),
  station('cafe-code', 'code', 'Ввести код автомата', 'cafeteria', 'n', 6),
  station('weapons-calibrate', 'calibrate', 'Навести орудия', 'weapons', 'n', 28),
  station('o2-filter', 'hold', 'Очистить фильтр', 'o2', 'w', -12),
  station('o2-code', 'code', 'Ввести код O2', 'o2', 's', 23),
  station('nav-course', 'calibrate', 'Выставить курс', 'navigation', 'e', 0),
  station('nav-upload', 'upload', 'Загрузить карту', 'navigation', 'n', 45.5),
  station('shields-hold', 'hold', 'Поднять щиты', 'shields', 's', 28),
  station('comms-upload', 'upload', 'Отправить сводку', 'comms', 's', 9),
  station('storage-wires', 'wires', 'Починить проводку', 'storage', 'w', 12),
  station('storage-fuel', 'hold', 'Заправить канистру', 'storage', 'e', 14),
  station('admin-card', 'code', 'Провести пропуск', 'admin', 'n', 15),
  station('admin-upload', 'upload', 'Выгрузить отчёт', 'admin', 'e', 2),
  station('elec-wires', 'wires', 'Починить проводку', 'electrical', 'n', -17),
  station('elec-calibrate', 'calibrate', 'Откалибровать щиток', 'electrical', 'w', 13),
  station('lower-engine', 'calibrate', 'Выровнять двигатель', 'lower-engine', 'w', 20),
  station('reactor-core', 'hold', 'Стабилизировать реактор', 'reactor', 'w', 0),
  station('reactor-code', 'code', 'Ввести код запуска', 'reactor', 'n', -44),
  station('upper-engine', 'calibrate', 'Выровнять двигатель', 'upper-engine', 'w', -22),
  station('security-wires', 'wires', 'Починить камеры', 'security', 'n', -26),
  station('med-scan', 'hold', 'Пройти сканирование', 'medbay', 's', -19),
  station('med-code', 'code', 'Ввести код аптечки', 'medbay', 'w', -13),
];

export const SHIP_STATIONS: TaskStation[] = PLACED.map((p) => p.station);

const PANELS_PLACED = [
  panel('elec-lights', 'lights', 'Восстановить свет', 'electrical', 'e', 12),
  panel('comms-fix', 'comms', 'Перезапустить связь', 'comms', 'n', 11.5),
  panel('reactor-top', 'reactor', 'Удерживать стабилизатор', 'reactor', 'w', -5),
  panel('reactor-bottom', 'reactor', 'Удерживать стабилизатор', 'reactor', 's', -46),
  panel('o2-panel', 'o2', 'Ввести код O2', 'o2', 'n', 23),
  panel('admin-o2', 'o2', 'Ввести код O2', 'admin', 's', 15),
];
export const SHIP_PANELS: SabotagePanel[] = PANELS_PLACED.map((p) => p.panel);

const vent = (id: string, roomId: string, x: number, z: number, links: string[]): MapVent => ({
  id,
  room: byId.get(roomId)?.name ?? 'Коридор',
  x,
  z,
  links,
});
/** Вентиляция: четыре несвязанные между собой сети. */
export const SHIP_VENTS: MapVent[] = [
  // Запад: двигатели через реактор.
  vent('v-reactor', 'reactor', -45, -3, ['v-upper', 'v-lower']),
  vent('v-upper', 'upper-engine', -33, -19, ['v-reactor']),
  vent('v-lower', 'lower-engine', -33, 17, ['v-reactor']),
  // Центр-запад: медпункт, охрана, электрика.
  vent('v-medbay', 'medbay', -21, -10, ['v-security', 'v-elec']),
  vent('v-security', 'security', -28, 1, ['v-medbay', 'v-elec']),
  vent('v-elec', 'electrical', -14, 10, ['v-medbay', 'v-security']),
  // Восток: оружейная и щиты через навигацию.
  vent('v-weapons', 'weapons', 31, -30, ['v-nav-top']),
  vent('v-nav-top', 'navigation', 44, -3, ['v-weapons']),
  vent('v-nav-bottom', 'navigation', 45, 5, ['v-shields']),
  vent('v-shields', 'shields', 31, 26, ['v-nav-bottom']),
  // Центр: кафетерий, коридор, администрация.
  vent('v-cafe', 'cafeteria', 8, -16, ['v-hall', 'v-admin']),
  vent('v-hall', 'corridor', 0, -6, ['v-cafe', 'v-admin']),
  vent('v-admin', 'admin', 18, -2, ['v-cafe', 'v-hall']),
];

const MEETING = { x: 0, z: -23, seats: 3.4 };

/** Места вокруг стола собраний; они же точки появления. */
const SEATS: SpawnPoint[] = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  const x = MEETING.x + Math.sin(a) * MEETING.seats,
    z = MEETING.z + Math.cos(a) * MEETING.seats;
  // Лицом к столу (вперёд — это (-sin yaw, -cos yaw), как у остальных карт).
  return { x: +x.toFixed(2), z: +z.toFixed(2), yaw: +a.toFixed(3) };
});

const floorDecal = (r: Rect, color: string): MapBox => ({
  x: (r.minX + r.maxX) / 2,
  y: 0.01,
  z: (r.minZ + r.maxZ) / 2,
  w: r.maxX - r.minX,
  h: 0.02,
  d: r.maxZ - r.minZ,
  color,
});
const solid = (x: number, y: number, z: number, w: number, h: number, d: number, color: string): MapBox => ({
  x,
  y,
  z,
  w,
  h,
  d,
  color,
  solid: true,
});

/** Мебель и укрытия: проходы между ними не уже двух метров. */
const PROPS: MapBox[] = [
  // Хранилище: штабеля ящиков.
  solid(-3, 0.75, 14, 2, 1.5, 2, CRATE),
  solid(3, 0.6, 10, 1.5, 1.2, 1.5, CRATE),
  solid(3.5, 0.5, 17.5, 1.2, 1, 1.2, CRATE),
  // Администрация: стол с картой корабля.
  solid(15, 0.45, 1, 3, 0.9, 2, METAL),
  // Медпункт: две койки.
  solid(-16, 0.35, -15.5, 1.2, 0.7, 2.2, '#dfe7ea'),
  solid(-16, 0.35, -11, 1.2, 0.7, 2.2, '#dfe7ea'),
  // Оружейная: пушка у внешней стены.
  solid(25, 0.8, -30.3, 2, 1.6, 2, METAL),
  // Щиты и связь: аппаратные стойки.
  solid(24, 1, 18, 1, 2, 1, METAL),
  solid(12.5, 1, 30.5, 1, 2, 1, METAL),
  // Охрана: стол с мониторами.
  solid(-24, 0.45, -1, 1, 0.9, 3, METAL),
];

const CYLINDERS: MapCylinder[] = [
  { x: MEETING.x, y: 0.45, z: MEETING.z, r: 1.6, h: 0.9, color: '#3d7ea6', solid: true, sides: 24 },
  // Кнопка экстренного собрания в центре стола.
  { x: MEETING.x, y: 1.0, z: MEETING.z, r: 0.35, h: 0.2, color: '#e5484d', sides: 16 },
  // Столики кафетерия.
  { x: -6.5, y: 0.4, z: -27.5, r: 1.2, h: 0.8, color: '#6b8fa6', solid: true },
  { x: 6.5, y: 0.4, z: -27.5, r: 1.2, h: 0.8, color: '#6b8fa6', solid: true },
  { x: -6, y: 0.4, z: -18.5, r: 1.2, h: 0.8, color: '#6b8fa6', solid: true },
  { x: 6, y: 0.4, z: -18.5, r: 1.2, h: 0.8, color: '#6b8fa6', solid: true },
  // Двигатели и ядро реактора.
  { x: -37, y: 1.2, z: 23.5, r: 1.5, h: 2.4, color: '#7b5d4a', solid: true },
  { x: -38.5, y: 1.2, z: -25.8, r: 1.5, h: 2.4, color: '#7b5d4a', solid: true },
  { x: -44, y: 1.3, z: 4.5, r: 1, h: 2.6, color: '#c0563b', solid: true },
  // Сканер медпункта — плоская платформа, на неё встают.
  { x: -19, y: 0.03, z: -9.8, r: 0.8, h: 0.06, color: '#56d69a' },
];

const LIGHTS: MapLight[] = SHIP_ROOMS.map((r) => ({
  x: (r.minX + r.maxX) / 2,
  y: WALL_H - 0.2,
  z: (r.minZ + r.maxZ) / 2,
  color: r.light,
  intensity: 1.1,
  distance: Math.max(r.maxX - r.minX, r.maxZ - r.minZ) + 4,
}));

export const SHIP: ArenaDef = {
  id: 'ship',
  title: 'Корабль',
  bounds: BOUNDS,
  groundColor: HULL,
  outsideColor: '#0b0e14',
  indoor: true,
  boxes: [
    ...SHIP_ROOMS.map((r) => floorDecal(r, r.floor)),
    ...CORRIDORS.map((c) => floorDecal(c, CORRIDOR)),
    ...wallsAround([...SHIP_ROOMS, ...CORRIDORS], BOUNDS, WALL),
    ...PLACED.map((p) => p.box),
    ...PANELS_PLACED.map((p) => p.box),
    // Решётки вентиляции: плоские, на них можно встать.
    ...SHIP_VENTS.map((v): MapBox => ({ x: v.x, y: 0.03, z: v.z, w: 1.1, h: 0.04, d: 0.8, color: '#3b424d' })),
    ...PROPS,
  ],
  cylinders: CYLINDERS,
  lights: LIGHTS,
  spawns: { red: SEATS, blue: SEATS },
  stations: SHIP_STATIONS,
  meeting: MEETING,
  panels: SHIP_PANELS,
  vents: SHIP_VENTS,
  zones: SHIP_ROOMS.map(({ id, name, minX, minZ, maxX, maxZ }) => ({ id, name, minX, minZ, maxX, maxZ })),
};
