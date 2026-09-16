import { perimeterWalls, type ArenaDef, type MapBox, type SpawnPoint, type TaskStation } from './types.ts';

// «Корабль» — карта режима «Предатель». Кафетерий со столом собраний в центре, от него
// четыре коридора в отсеки: реактор (запад), навигация (восток), электрика (север) и
// медпункт (юг). Пространство между отсеками замкнуто стенами и недоступно: вся игра идёт
// в комнатах и коридорах, где можно остаться одному. Первая простая версия — геометрия и
// оформление дорабатываются отдельно (этап 2), точки заданий и стол уже на своих местах.

const HULL = '#5d6675';
const WALL = '#8b95a5';
const FLOOR_CAFE = '#c9ccd2';
const FLOOR_ROOM = '#9aa3ad';
const CORRIDOR = '#77808c';
const TABLE = '#3d7ea6';
const CONSOLE = '#2d3440';

const BOUNDS = { minX: -30, maxX: 30, minZ: -22, maxZ: 22 };
const H = 3; // wall height
const T = 0.4; // wall thickness
/** Half-width of doorways and corridors. */
const DOOR = 1.5;

/** A straight wall from (x1, z1) to (x2, z2) along one axis. */
function wall(x1: number, z1: number, x2: number, z2: number): MapBox {
  const alongX = z1 === z2;
  return {
    x: (x1 + x2) / 2,
    y: H / 2,
    z: (z1 + z2) / 2,
    w: alongX ? Math.abs(x2 - x1) + T : T,
    h: H,
    d: alongX ? T : Math.abs(z2 - z1) + T,
    color: WALL,
    solid: true,
  };
}

/** A wall with a doorway of half-width DOOR centred at `at` on its axis. */
function wallWithDoor(x1: number, z1: number, x2: number, z2: number, at: number): MapBox[] {
  if (z1 === z2) return [wall(x1, z1, at - DOOR, z1), wall(at + DOOR, z1, x2, z1)];
  return [wall(x1, z1, x1, at - DOOR), wall(x1, at + DOOR, x1, z2)];
}

/** Thin floor decal (not a collider) marking a room. */
const floor = (minX: number, minZ: number, maxX: number, maxZ: number, color: string): MapBox => ({
  x: (minX + maxX) / 2,
  y: 0.01,
  z: (minZ + maxZ) / 2,
  w: maxX - minX,
  h: 0.02,
  d: maxZ - minZ,
  color,
});

export const SHIP_STATIONS: TaskStation[] = [
  { id: 'reactor-core', kind: 'hold', title: 'Стабилизировать реактор', room: 'Реактор', x: -27, z: 0 },
  { id: 'reactor-wires', kind: 'wires', title: 'Починить проводку', room: 'Реактор', x: -21, z: -8.6 },
  { id: 'nav-course', kind: 'calibrate', title: 'Выставить курс', room: 'Навигация', x: 27, z: 0 },
  { id: 'nav-upload', kind: 'upload', title: 'Загрузить данные', room: 'Навигация', x: 21, z: 8.6 },
  { id: 'elec-wires', kind: 'wires', title: 'Починить проводку', room: 'Электрика', x: -6.4, z: -20.4 },
  { id: 'elec-calibrate', kind: 'calibrate', title: 'Откалибровать щиток', room: 'Электрика', x: 6.4, z: -20.4 },
  { id: 'med-scan', kind: 'hold', title: 'Пройти сканирование', room: 'Медпункт', x: 0, z: 19.5 },
  { id: 'med-code', kind: 'code', title: 'Ввести код аптечки', room: 'Медпункт', x: -6.4, z: 20.4 },
  { id: 'cafe-upload', kind: 'upload', title: 'Выгрузить отчёт', room: 'Кафетерий', x: -6.4, z: -6.4 },
  { id: 'cafe-code', kind: 'code', title: 'Ввести код торгового автомата', room: 'Кафетерий', x: 6.4, z: 6.4 },
];

/** Seats around the meeting table, also the spawn points. */
const SEATS: SpawnPoint[] = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  // Facing the table: yaw 0 looks along -z in the client (same as other maps' spawns).
  return { x: +(Math.sin(a) * 3.4).toFixed(2), z: +(Math.cos(a) * 3.4).toFixed(2), yaw: +a.toFixed(3) };
});

export const SHIP: ArenaDef = {
  id: 'ship',
  title: 'Корабль',
  bounds: BOUNDS,
  groundColor: HULL,
  outsideColor: '#10141c',
  boxes: [
    ...perimeterWalls(BOUNDS, H, T, HULL),
    floor(-8, -8, 8, 8, FLOOR_CAFE),
    floor(-30, -10, -16, 10, FLOOR_ROOM),
    floor(16, -10, 30, 10, FLOOR_ROOM),
    floor(-8, -22, 8, -12, FLOOR_ROOM),
    floor(-8, 12, 8, 22, FLOOR_ROOM),
    floor(-16, -DOOR, -8, DOOR, CORRIDOR),
    floor(8, -DOOR, 16, DOOR, CORRIDOR),
    floor(-DOOR, -12, DOOR, -8, CORRIDOR),
    floor(-DOOR, 8, DOOR, 12, CORRIDOR),
    // Cafeteria: four doorways.
    ...wallWithDoor(-8, -8, 8, -8, 0),
    ...wallWithDoor(-8, 8, 8, 8, 0),
    ...wallWithDoor(-8, -8, -8, 8, 0),
    ...wallWithDoor(8, -8, 8, 8, 0),
    // Corridors.
    wall(-16, -DOOR, -8, -DOOR),
    wall(-16, DOOR, -8, DOOR),
    wall(8, -DOOR, 16, -DOOR),
    wall(8, DOOR, 16, DOOR),
    wall(-DOOR, -12, -DOOR, -8),
    wall(DOOR, -12, DOOR, -8),
    wall(-DOOR, 8, -DOOR, 12),
    wall(DOOR, 8, DOOR, 12),
    // Reactor (west).
    ...wallWithDoor(-16, -10, -16, 10, 0),
    wall(-30, -10, -16, -10),
    wall(-30, 10, -16, 10),
    // Navigation (east).
    ...wallWithDoor(16, -10, 16, 10, 0),
    wall(16, -10, 30, -10),
    wall(16, 10, 30, 10),
    // Electrical (north).
    ...wallWithDoor(-8, -12, 8, -12, 0),
    wall(-8, -22, -8, -12),
    wall(8, -22, 8, -12),
    // MedBay (south).
    ...wallWithDoor(-8, 12, 8, 12, 0),
    wall(-8, 12, -8, 22),
    wall(8, 12, 8, 22),
    // Task consoles: low markers, not colliders, so the station point stays reachable.
    ...SHIP_STATIONS.map(
      (s): MapBox => ({ x: s.x, y: 0.5, z: s.z, w: 0.7, h: 1, d: 0.7, color: CONSOLE }),
    ),
  ],
  cylinders: [{ x: 0, y: 0.45, z: 0, r: 1.6, h: 0.9, color: TABLE, solid: true, sides: 24 }],
  lights: [
    { x: 0, y: 2.8, z: 0, color: '#ffffff', intensity: 1.2, distance: 14 },
    { x: -23, y: 2.8, z: 0, color: '#ff9a6b', intensity: 1, distance: 14 },
    { x: 23, y: 2.8, z: 0, color: '#8fd3ff', intensity: 1, distance: 14 },
    { x: 0, y: 2.8, z: -17, color: '#ffe27a', intensity: 1, distance: 12 },
    { x: 0, y: 2.8, z: 17, color: '#9dffc8', intensity: 1, distance: 12 },
  ],
  spawns: { red: SEATS, blue: SEATS },
  stations: SHIP_STATIONS,
  meeting: { x: 0, z: 0, seats: 3.4 },
};
