// Мозг серверного бота: что он видит, куда идёт и когда стреляет.
//
// Бот живёт в сервере комнаты (worker/room-hub.ts) и ходит через те же ворота,
// что и человек: шаг проходит проверку `applyPresence` (скорость, стены), а
// выстрел — `fireEffect` (перезарядка, магазин, щит). Отдельных правил для
// ботов у сервера нет, поэтому бот не может ни бежать быстрее, ни стрелять
// сквозь стену, ни пережить попадание, которое убило бы игрока.
//
// Знает бот только то, что видит сам: сектор обзора, дальность и чистую линию
// огня. Позиции тех, кого он не видит, не читаются — вместо них короткая память
// о последнем контакте и слух (чужие выстрелы рядом). Уровень сложности меняет
// человеческие качества — реакцию, точность, обзор (lib/bot-levels.ts).
//
// Поведение перенесено из scripts/bots.mjs — внешнего бота, который играл через
// HTTP и отлавливал ошибки сервера. Там оно отлажено на живых матчах; здесь из
// него убрана сеть и журнал аномалий.
import type { HubMember, HubState } from './room-hub-core.ts';
import { stanceHeight, type GameMap } from './maps/types.ts';
import { isBlocked3D, rayCastWorldObstacle } from './world-collision.ts';
import { WEAPONS, cooledDown, isBlaster, weaponCooldown, type Blaster } from './weapon-definition.ts';
import { memberWeapon } from './weapon-authority.ts';
import { BOT_LEVELS, type BotLevel, type BotLevelRules, type BotSpec } from './bot-levels.ts';

// -------------------------------------------------------------- постоянные

/** Радиус тела для своих проверок: с запасом к серверным 0.25. */
const BODY_RADIUS = 0.32;
/** Скорость бега «сильного» бота, м/с. Предел сервера — 4.8 * 1.5. */
const RUN_SPEED = 3.8;
/** Глаза относительно ног (стоя и присев). */
const EYE_STAND = 1.5;
const EYE_SIT = 1.15;
/** Центр туловища и головы относительно ног (lib/game-items.ts, хитбоксы). */
const TORSO = { stand: 1.4, sit: 1.07 };
const HEAD = { stand: 2.07, sit: 1.67 };
/** Чужой выстрел слышно на этом расстоянии («сильный» бот). */
const HEAR_RANGE = 20;
/** Ближе этого товарищи по команде расходятся. */
const MATE_SPACING = 4;
/** Участник считается в сети (ONLINE_MS в lib/room-hub-core.ts). */
const ONLINE_MS = 15_000;
/** Гранат в запасе и их «перезарядка»: у гранаты нет магазина на сервере. */
const GRENADES = 3;
const GRENADE_RELOAD_MS = 1600;

const TOOL_VARIANT: Record<string, string> = {
  paint: 'classic',
  confetti: 'stars',
  grenade: 'pinata',
  sniper: 'salute',
};
/** Темп стрельбы человека, мс: между выстрелами очереди и пауза после неё. */
const CADENCE: Record<string, [number, number]> = {
  paint: [240, 420],
  confetti: [780, 1200],
  grenade: [1500, 2400],
  sniper: [1250, 1900],
};
const BURST: Record<string, [number, number]> = {
  paint: [3, 7],
  confetti: [2, 3],
  grenade: [1, 1],
  sniper: [1, 2],
};

type Tool = 'paint' | 'confetti' | 'grenade' | 'sniper';
type Profile = {
  id: string;
  fov: number;
  memory: [number, number];
  /** Сдвиг реакции характера относительно уровня, мс. */
  reactionShift: number;
  turn: [number, number];
  keep: { min: number; max: number };
  push: number;
  tools: Tool[];
  spread: number;
  retreatHp: number;
  jump: number;
  crouchFrom: number;
};

/**
 * Характеры. Уровень сложности говорит, насколько хорошо бот играет, характер —
 * как: напористый лезет в ближний бой, снайпер держит дистанцию. Характер
 * выбирается по порядковому номеру бота в комнате.
 */
const PROFILES: Profile[] = [
  {
    id: 'напористый',
    fov: 110,
    memory: [4000, 5000],
    reactionShift: -30,
    turn: [4.2, 5.0],
    keep: { min: 3, max: 16 },
    push: 0.9,
    tools: ['confetti', 'paint'],
    spread: 0.013,
    retreatHp: 28,
    jump: 0.9,
    crouchFrom: 16,
  },
  {
    id: 'осторожный',
    fov: 96,
    memory: [5000, 6000],
    reactionShift: 20,
    turn: [3.0, 3.8],
    keep: { min: 8, max: 22 },
    push: 0.35,
    tools: ['paint', 'grenade'],
    spread: 0.01,
    retreatHp: 45,
    jump: 0.25,
    crouchFrom: 12,
  },
  {
    id: 'снайпер',
    fov: 90,
    memory: [5000, 6000],
    reactionShift: 10,
    turn: [3.0, 3.6],
    keep: { min: 14, max: 28 },
    push: 0.15,
    tools: ['sniper', 'paint'],
    spread: 0.006,
    retreatHp: 40,
    jump: 0.1,
    crouchFrom: 10,
  },
  {
    id: 'универсал',
    fov: 100,
    memory: [4000, 6000],
    reactionShift: 0,
    turn: [3.6, 4.4],
    keep: { min: 5, max: 20 },
    push: 0.6,
    tools: ['paint', 'confetti'],
    spread: 0.011,
    retreatHp: 35,
    jump: 0.5,
    crouchFrom: 14,
  },
];

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Угол в (-π, π]. */
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Курс на точку: в движке вперёд — это (-sin yaw, -cos yaw). */
const yawTo = (fromX: number, fromZ: number, toX: number, toZ: number) =>
  Math.atan2(-(toX - fromX), -(toZ - fromZ));
/** Направление взгляда (lib/game-camera.ts): pitch вниз — плюс. */
const viewDir = (yaw: number, pitch: number) => [
  -Math.sin(yaw) * Math.cos(pitch),
  -Math.sin(pitch),
  -Math.cos(yaw) * Math.cos(pitch),
];
const eyeHeight = (stance: string) => (stance === 'sit' ? EYE_SIT : EYE_STAND);

// --------------------------------------------------- сетка проходимости

/** Шаг сетки навигации, м. */
const NAV_CELL = 0.75;
/** Подъём выше этого шагом не берётся (нужен прыжок или рампа). */
const CLIMB = 0.55;
/** Спрыгнуть можно, а падать в пропасть — нет. */
const FALL = 3.5;
/** Восемь соседей: прямые дешевле диагоналей. */
const NEIGHBOURS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];
/** A* не обходит больше клеток: цель дальше считается недостижимой. */
const MAX_VISITS = 9000;

type PathNode = { x: number; z: number; y: number; crouch: boolean };

/** Двоичная куча по f: открытый список A* на карте в десятки тысяч клеток. */
class Heap {
  private idx: number[] = [];
  private f: number[] = [];
  get size() {
    return this.idx.length;
  }
  push(idx: number, f: number) {
    const a = this.idx;
    const b = this.f;
    let i = a.length;
    a.push(idx);
    b.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (b[p] <= f) break;
      a[i] = a[p];
      b[i] = b[p];
      i = p;
    }
    a[i] = idx;
    b[i] = f;
  }
  pop() {
    const a = this.idx;
    const b = this.f;
    const top = a[0];
    const lastIdx = a.pop() as number;
    const lastF = b.pop() as number;
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= a.length) break;
        const r = l + 1;
        const c = r < a.length && b[r] < b[l] ? r : l;
        if (b[c] >= lastF) break;
        a[i] = a[c];
        b[i] = b[c];
        i = c;
      }
      a[i] = lastIdx;
      b[i] = lastF;
    }
    return top;
  }
}

/**
 * Проходимость карты клетками. Строится один раз на карту и общая для всех
 * ботов всех комнат этого экземпляра воркера: волна от точек возрождения
 * обходит карту так же, как ходит игрок — подъём не выше CLIMB (лестницы и
 * рампы проходятся, стены нет), а там, где стоя не пролезть, клетка помечается
 * «только присев».
 */
export class NavGrid {
  readonly map: GameMap;
  readonly minX: number;
  readonly minZ: number;
  readonly cols: number;
  readonly rows: number;
  /** 0 — непроходимо, 1 — стоя, 2 — только присев. */
  readonly kind: Uint8Array;
  readonly height: Float32Array;
  walkable = 0;
  private gScore: Float32Array;
  private came: Int32Array;
  private stamp: Int32Array;
  private pass = 0;

  constructor(map: GameMap) {
    const b = map.bounds;
    this.map = map;
    this.minX = b.minX;
    this.minZ = b.minZ;
    this.cols = Math.max(1, Math.ceil((b.maxX - b.minX) / NAV_CELL));
    this.rows = Math.max(1, Math.ceil((b.maxZ - b.minZ) / NAV_CELL));
    const size = this.cols * this.rows;
    this.kind = new Uint8Array(size);
    this.height = new Float32Array(size);
    this.gScore = new Float32Array(size);
    this.came = new Int32Array(size);
    this.stamp = new Int32Array(size);
    this.build();
  }

  cx(ix: number) {
    return this.minX + (ix + 0.5) * NAV_CELL;
  }

  cz(iz: number) {
    return this.minZ + (iz + 0.5) * NAV_CELL;
  }

  at(x: number, z: number) {
    const ix = Math.floor((x - this.minX) / NAV_CELL);
    const iz = Math.floor((z - this.minZ) / NAV_CELL);
    if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) return -1;
    return iz * this.cols + ix;
  }

  /** Какой стойкой клетка проходима на высоте y. */
  passable(x: number, z: number, y: number) {
    const colliders = this.map.colliders;
    if (!isBlocked3D(x, z, y, BODY_RADIUS, stanceHeight('stand'), colliders)) return 1;
    if (!isBlocked3D(x, z, y, BODY_RADIUS, stanceHeight('sit'), colliders)) return 2;
    return 0;
  }

  private build() {
    const spawns = [...(this.map.spawns?.red || []), ...(this.map.spawns?.blue || [])];
    const b = this.map.bounds;
    const seeds = spawns.length ? spawns : [{ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }];
    const seen = new Uint8Array(this.kind.length);
    const queue: number[] = [];
    for (const s of seeds) {
      const idx = this.at(s.x, s.z);
      if (idx < 0 || seen[idx]) continue;
      const x = this.cx(idx % this.cols);
      const z = this.cz(Math.floor(idx / this.cols));
      const y = this.map.groundHeight(x, z, 0);
      seen[idx] = 1;
      const kind = this.passable(x, z, y);
      if (!kind) continue;
      this.kind[idx] = kind;
      this.height[idx] = y;
      queue.push(idx);
    }
    for (let head = 0; head < queue.length; head++) {
      const idx = queue[head];
      const ix = idx % this.cols;
      const iz = Math.floor(idx / this.cols);
      const y = this.height[idx];
      for (const [dx, dz] of NEIGHBOURS) {
        const nx = ix + dx;
        const nz = iz + dz;
        if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
        const nidx = nz * this.cols + nx;
        if (seen[nidx]) continue;
        const wx = this.cx(nx);
        const wz = this.cz(nz);
        // Высоту считаем «от текущей ноги»: так работает и сам движок.
        const ny = this.map.groundHeight(wx, wz, y);
        seen[nidx] = 1;
        if (ny - y > CLIMB || y - ny > FALL) continue;
        const kind = this.passable(wx, wz, ny);
        if (!kind) continue;
        this.kind[nidx] = kind;
        this.height[nidx] = ny;
        queue.push(nidx);
      }
    }
    this.walkable = queue.length;
  }

  /** Ближайшая проходимая клетка к точке (поиск по расширяющемуся кольцу). */
  nearest(x: number, z: number) {
    const ix = Math.floor((x - this.minX) / NAV_CELL);
    const iz = Math.floor((z - this.minZ) / NAV_CELL);
    for (let r = 0; r <= 6; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (r && Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = ix + dx;
          const cz = iz + dz;
          if (cx < 0 || cz < 0 || cx >= this.cols || cz >= this.rows) continue;
          const idx = cz * this.cols + cx;
          if (!this.kind[idx]) continue;
          const d = Math.hypot(this.cx(cx) - x, this.cz(cz) - z);
          if (d < bestD) {
            bestD = d;
            best = idx;
          }
        }
      if (best >= 0) return best;
    }
    return -1;
  }

  /**
   * Прямая между точками проходима стоя: можно срезать угол пути.
   *
   * Проверка идёт по уже построенной сетке, а не по геометрии карты: маршруты
   * перестраиваются постоянно, и на Ледниковой долине (сотни коллайдеров и
   * рельеф) честные `groundHeight`/`isBlocked3D` на каждой точке съедали 75 %
   * такта ботов. Чтобы плечом не цеплять стену у края клетки, проверяется
   * коридор шириной в тело: центр и две точки по бокам на радиус тела.
   */
  clearLine(ax: number, az: number, ay: number, bx: number, bz: number) {
    const dist = Math.hypot(bx - ax, bz - az);
    if (dist < 1e-3) return true;
    const steps = Math.ceil(dist / (NAV_CELL / 3));
    // Поперёк направления — на радиус тела в обе стороны.
    const sx = (-(bz - az) / dist) * BODY_RADIUS;
    const sz = ((bx - ax) / dist) * BODY_RADIUS;
    let y = ay;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const idx = this.at(x, z);
      if (idx < 0 || this.kind[idx] !== 1) return false;
      const ny = this.height[idx];
      if (ny - y > CLIMB || y - ny > FALL) return false;
      for (const side of [1, -1]) {
        const edge = this.at(x + sx * side, z + sz * side);
        if (edge < 0 || this.kind[edge] !== 1 || Math.abs(this.height[edge] - ny) > CLIMB) return false;
      }
      y = ny;
    }
    return true;
  }

  /** Путь из точки в точку: A* по клеткам, затем срезание лишних узлов. null — пути нет. */
  find(fromX: number, fromZ: number, toX: number, toZ: number): PathNode[] | null {
    const start = this.nearest(fromX, fromZ);
    const goal = this.nearest(toX, toZ);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [];
    const pass = ++this.pass;
    const open = new Heap();
    open.push(start, 0);
    this.gScore[start] = 0;
    this.came[start] = -1;
    this.stamp[start] = pass;
    const goalX = this.cx(goal % this.cols);
    const goalZ = this.cz(Math.floor(goal / this.cols));
    const closed = new Set<number>();
    let found = false;
    while (open.size && closed.size < MAX_VISITS) {
      const current = open.pop();
      if (current === goal) {
        found = true;
        break;
      }
      if (closed.has(current)) continue;
      closed.add(current);
      const ix = current % this.cols;
      const iz = Math.floor(current / this.cols);
      const g = this.gScore[current];
      for (const [dx, dz, cost] of NEIGHBOURS) {
        const nx = ix + dx;
        const nz = iz + dz;
        if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
        const nidx = nz * this.cols + nx;
        if (!this.kind[nidx]) continue;
        // Углы не срезаем: по диагонали только если обе стороны свободны.
        if (dx && dz && (!this.kind[iz * this.cols + nx] || !this.kind[nz * this.cols + ix])) continue;
        const climb = Math.abs(this.height[nidx] - this.height[current]);
        // Присев ходят медленнее, крутые места тоже не бесплатны.
        const next = g + cost * NAV_CELL + (this.kind[nidx] === 2 ? 1.4 : 0) + climb * 0.6;
        if (this.stamp[nidx] === pass && this.gScore[nidx] <= next) continue;
        this.stamp[nidx] = pass;
        this.gScore[nidx] = next;
        this.came[nidx] = current;
        open.push(nidx, next + Math.hypot(this.cx(nx) - goalX, this.cz(nz) - goalZ));
      }
    }
    if (!found) return null;
    const nodes: PathNode[] = [];
    for (let idx = goal; idx >= 0; idx = this.came[idx]) {
      nodes.push({
        x: this.cx(idx % this.cols),
        z: this.cz(Math.floor(idx / this.cols)),
        y: this.height[idx],
        crouch: this.kind[idx] === 2,
      });
      if (idx === start) break;
    }
    nodes.reverse();
    // Срезаем узлы, между которыми и так можно пройти по прямой.
    const crouched = [0];
    for (const node of nodes) crouched.push(crouched[crouched.length - 1] + (node.crouch ? 1 : 0));
    const out: PathNode[] = [];
    let i = 0;
    let x = fromX;
    let z = fromZ;
    let y = nodes[0] ? nodes[0].y : 0;
    while (i < nodes.length) {
      // Срезаем не дальше пары десятков клеток вперёд: полный перебор до конца
      // пути — квадрат от его длины, а длинные прямые всё равно редкость.
      let j = Math.min(nodes.length - 1, i + 24);
      // Через низкие проходы идём по клеткам, иначе можно срезать.
      for (; j > i; j--) {
        if (crouched[j + 1] - crouched[i] > 0) continue;
        if (this.clearLine(x, z, y, nodes[j].x, nodes[j].z)) break;
      }
      out.push(nodes[j]);
      x = nodes[j].x;
      z = nodes[j].z;
      y = nodes[j].y;
      i = j + 1;
    }
    return out;
  }
}

const navCache = new Map<string, NavGrid>();
/** Сетка карты: строится при первом боте на карте и переиспользуется всеми. */
export function navFor(map: GameMap) {
  let grid = navCache.get(map.id);
  if (!grid) {
    grid = new NavGrid(map);
    navCache.set(map.id, grid);
  }
  return grid;
}

// ------------------------------------------------------------------- бот

type Point = { x: number; z: number };
type Contact = {
  id: string;
  x: number;
  y: number;
  z: number;
  stance: string;
  vx: number;
  vz: number;
  at: number;
  dist: number;
};
type Noise = { x: number; z: number; at: number; ally: boolean };

/** Что бот прислал бы по сети, будь он клиентом. */
export type BotPresence = { pose: Record<string, unknown>; life: number; ping: number };
export type BotShot = Record<string, unknown>;

/** Общее на всех ботов комнаты за один такт. */
export type BotContext = {
  state: HubState;
  map: GameMap;
  now: number;
  /** Подготовка раунда: сервер не примет ни шаг, ни выстрел. */
  frozen: boolean;
  /** Мозги всех ботов комнаты: чтобы не бежать на один шум всей командой. */
  squad: ReadonlyMap<string, BotBrain>;
};

export class BotBrain {
  readonly id: string;
  level: BotLevel;
  private rules: BotLevelRules;
  private readonly profile: Profile;
  private readonly index: number;
  private readonly random: () => number;
  // Личные отклонения внутри характера и уровня.
  private fovRad = 0;
  private sight = 0;
  private memoryMs = 0;
  private turnSpeed = 0;
  private spread = 0;
  // Своё состояние.
  team = '';
  huntKey = '';
  huntAt = 0;
  state = 'patrol';
  private mapId = '';
  private nav: NavGrid | null = null;
  private life = -1;
  private lastStepAt = 0;
  private aimYaw = 0;
  private aimPitch = 0;
  private stance: 'stand' | 'sit' = 'stand';
  private moving = false;
  /** Шёл ли в прошлом такте: присесть посреди бега нельзя. */
  private wasMoving = false;
  private speed = 0;
  private next: { x: number; y: number; z: number } | null = null;
  // Восприятие.
  private memory = new Map<string, Contact>();
  private noise: Noise | null = null;
  private lastSeq = 0;
  private contactId = '';
  private contactAt = 0;
  private reactionUntil = 0;
  private leadError = 1;
  private headAim = false;
  private target: Contact | null = null;
  // Движение.
  private waypoints: Point[] = [];
  private waypointTeam: string | null = null;
  private waypointIndex = 0;
  private slideSign: number;
  private slideTurn = 0;
  private slideUntil = 0;
  private moveDirX = 0;
  private moveDirZ = 0;
  private strafeSign: number;
  private strafeUntil = 0;
  private goalBest = Infinity;
  private goalBestAt = 0;
  private jumpUntil = 0;
  private coverPoint: Point | null = null;
  private holdUntil = 0;
  private path: PathNode[] | null = null;
  private pathIndex = 0;
  private pathGoal: Point | null = null;
  private pathAt = 0;
  private wantMove = false;
  private stuckAnchor: Point | null = null;
  private stuckAt = 0;
  private stuckStreak = 0;
  private huntUntil = 0;
  private huntPoint: Point | null = null;
  private rushUntil = 0;
  private phase = '';
  // Оружие.
  private tool: Tool;
  private toolUntil = 0;
  private nextShotAt = 0;
  private burst = 0;
  private burstLimit = 0;
  private grenades = GRENADES;
  private grenadeReloadUntil = 0;

  constructor(spec: BotSpec, index: number, random: () => number = Math.random) {
    this.id = spec.id;
    this.index = index;
    this.random = random;
    this.profile = PROFILES[index % PROFILES.length];
    this.level = spec.level;
    this.rules = BOT_LEVELS[spec.level];
    this.slideSign = index % 2 ? 1 : -1;
    this.strafeSign = index % 2 ? 1 : -1;
    this.tool = this.profile.tools[0];
    this.applyLevel();
  }

  /** Ведущий поменял уровень: бот продолжает бой, но уже с другими качествами. */
  setLevel(level: BotLevel) {
    if (level === this.level) return;
    this.level = level;
    this.rules = BOT_LEVELS[level];
    this.applyLevel();
  }

  get character() {
    return this.profile.id;
  }

  private rand(min: number, max: number) {
    return min + this.random() * (max - min);
  }

  /** Грубая нормаль: сумма четырёх равномерных — почти гаусс. */
  private gauss() {
    return (this.random() + this.random() + this.random() + this.random() - 2) / 0.82;
  }

  private applyLevel() {
    const p = this.profile;
    const l = this.rules;
    this.fovRad = (((p.fov + this.rand(-6, 6)) * l.fov) * Math.PI) / 180;
    this.sight = l.sight + this.rand(-2, 2);
    this.memoryMs = this.rand(p.memory[0], p.memory[1]) * l.memory;
    this.turnSpeed = this.rand(p.turn[0], p.turn[1]) * l.turn;
    this.spread = p.spread * this.rand(0.85, 1.2) * l.spread;
  }

  // ------------------------------------------------------------- такт

  /**
   * Первая половина такта: осмотреться, решить и сделать шаг. Возвращает пакет
   * presence — его сервер проверит так же, как пакет живого игрока.
   */
  think(ctx: BotContext, me: HubMember): BotPresence {
    const { now, map } = ctx;
    const dt = clamp(this.lastStepAt ? (now - this.lastStepAt) / 1000 : 0.1, 0.02, 0.4);
    this.lastStepAt = now;
    this.team = me.team;
    if (map.id !== this.mapId) {
      this.mapId = map.id;
      this.nav = navFor(map);
      this.waypointTeam = null;
      this.clearPath();
      this.memory.clear();
    }
    if (me.life !== this.life) this.newLife(me);
    if (this.phase === 'freeze' && ctx.state.match.phase === 'live') this.rushUntil = now + 12_000;
    this.phase = ctx.state.match.phase;
    this.next = null;
    this.hear(ctx, me);
    this.target = this.act(ctx, me, dt);
    this.trackStuck(now, me);
    const pos = this.next ?? me.pose;
    // Клиент достраивает движение чужих игроков между пакетами по
    // yaw/forward/strafe/speed (components/world-remote-players.ts): раскладываем
    // настоящее направление шага по осям взгляда, иначе аватар «уезжает».
    const sinY = Math.sin(this.aimYaw);
    const cosY = Math.cos(this.aimYaw);
    const forward = this.moving ? clamp(-this.moveDirX * sinY - this.moveDirZ * cosY, -1, 1) : 0;
    const strafe = this.moving ? clamp(this.moveDirX * cosY - this.moveDirZ * sinY, -1, 1) : 0;
    const weapon = isBlaster(this.tool) ? memberWeapon(me).magazine : null;
    return {
      life: me.life,
      ping: 0,
      pose: {
        x: r3(pos.x),
        y: r3(pos.y),
        z: r3(pos.z),
        yaw: r3(this.aimYaw),
        stance: this.stance,
        moving: this.moving,
        speed: r3(this.speed),
        forward: r3(forward),
        strafe: r3(strafe),
        pitch: r3(this.aimPitch),
        tool: this.tool,
        variant: TOOL_VARIANT[this.tool],
        aiming: !!this.target && this.tool === 'sniper',
        crouching: this.stance === 'sit',
        reload: weapon ? weapon.progress(now) : 0,
        working: false,
      },
    };
  }

  /**
   * Вторая половина такта, когда сервер уже принял (или отверг) шаг: нажать на
   * спуск или перезарядиться. Выстрел уходит от той позы, что сервер признал.
   */
  trigger(ctx: BotContext, me: HubMember): { shot?: BotShot; reload?: Blaster } {
    const { now } = ctx;
    const target = this.target;
    if (me.hp <= 0 || ctx.frozen) return {};
    // Под щитом возрождения сервер выстрел всё равно отклонит.
    if (ctx.state.room.shieldSeconds > 0 && (me.immuneUntil === -1 || me.immuneUntil > now)) return {};
    this.pickTool(now);
    const magazine = memberWeapon(me).magazine;
    magazine.tick(now);
    const blaster = isBlaster(this.tool) ? this.tool : null;
    // Пусто и врага не видно — перезаряжаемся заранее, а не посреди перестрелки.
    if (blaster && !magazine.reloading && magazine.rounds[blaster] < WEAPONS[blaster].capacity) {
      const empty = magazine.rounds[blaster] === 0;
      if (empty || (!target && !this.memory.size && magazine.rounds[blaster] < WEAPONS[blaster].capacity / 3))
        return { reload: blaster };
    }
    if (!target || now < this.reactionUntil || now < this.nextShotAt) return {};
    if (this.state === 'cover' && now < this.holdUntil && this.stance === 'sit' && this.moving) return {};
    if (blaster && (magazine.reloading || magazine.rounds[blaster] <= 0)) return {};
    if (this.tool === 'grenade') {
      if (now < this.grenadeReloadUntil) return {};
      if (this.grenades <= 0) {
        this.grenades = GRENADES;
        this.grenadeReloadUntil = now + GRENADE_RELOAD_MS;
        return {};
      }
    }
    if (this.tool === 'sniper' && target.dist < 3) return {};
    if (this.tool === 'grenade' && (target.dist < 5 || target.dist > 22)) return {};
    if (!cooledDown(me, this.tool, now)) return {};
    const eye = eyeHeight(me.pose.stance);
    const origin = [me.pose.x, me.pose.y + eye, me.pose.z];
    const aim = this.leadPoint(target);
    const dist = Math.max(1, Math.hypot(aim[0] - origin[0], aim[1] - origin[1], aim[2] - origin[2]));
    // Разброс: хуже в движении, на дистанции и в конце очереди.
    const sigma =
      this.spread *
      (1 + (this.moving ? 0.9 : 0) + dist / 32 + this.burst * 0.12) *
      (this.stance === 'sit' ? 0.7 : 1);
    const yaw = wrapAngle(this.aimYaw + this.gauss() * sigma);
    const pitch = clamp(this.aimPitch + this.gauss() * sigma, -1.3, 1.35);
    const dir = viewDir(yaw, pitch);
    // Граната летит в точку, а не по лучу взгляда: у неё своя дуга.
    const reach = this.tool === 'grenade' ? dist : Math.min(dist + 6, 74);
    const end =
      this.tool === 'grenade'
        ? [aim[0] + this.gauss() * sigma * dist, target.y, aim[2] + this.gauss() * sigma * dist]
        : [origin[0] + dir[0] * reach, origin[1] + dir[1] * reach, origin[2] + dir[2] * reach];
    // Очередь: несколько выстрелов подряд, потом пауза на доводку прицела.
    const [fastMin, fastMax] = CADENCE[this.tool];
    if (!this.burstLimit) this.burstLimit = Math.round(this.rand(BURST[this.tool][0], BURST[this.tool][1]));
    this.burst++;
    const pause = this.burst >= this.burstLimit;
    if (pause) {
      this.burst = 0;
      this.burstLimit = 0;
      // Следующая очередь — может, уже в голову.
      this.headAim = this.random() < this.rules.headshot;
    }
    this.nextShotAt =
      now +
      Math.max(
        weaponCooldown(this.tool) + 40,
        pause ? this.rand(fastMax, fastMax + 700) * this.rules.pause : this.rand(fastMin, fastMax),
      );
    if (this.tool === 'grenade') this.grenades--;
    // Отдача: прицел подбрасывает вверх, доводка вернёт его обратно.
    this.aimPitch = clamp(
      this.aimPitch - this.rand(0.006, 0.02) * (this.tool === 'sniper' ? 2.5 : 1),
      -1.3,
      1.35,
    );
    const normal = [-dir[0], -dir[1], -dir[2]];
    return {
      shot: {
        kind: this.tool,
        variant: TOOL_VARIANT[this.tool],
        origin: origin.map(r3),
        target: end.map(r3),
        normal: normal.map(r3),
        color: me.color && /^#[0-9a-f]{6}$/i.test(me.color) ? me.color : '#ff647c',
        seenAt: now,
        life: me.life,
        ...(this.tool === 'sniper' ? { scoped: true, noScope: false } : {}),
      },
    };
  }

  private newLife(me: HubMember) {
    this.life = me.life;
    this.aimYaw = me.pose.yaw || 0;
    this.aimPitch = 0;
    this.memory.clear();
    this.noise = null;
    this.huntPoint = null;
    this.huntKey = '';
    this.coverPoint = null;
    this.holdUntil = 0;
    this.waypointIndex = 0;
    this.goalBest = Infinity;
    this.goalBestAt = this.lastStepAt;
    this.burst = 0;
    this.grenades = GRENADES;
    this.clearPath();
    this.stuckAnchor = null;
  }

  // ------------------------------------------------------------ восприятие

  /** Линия от глаз к точке свободна. */
  private canSee(map: GameMap, me: HubMember, point: number[]) {
    const origin = [me.pose.x, me.pose.y + eyeHeight(me.pose.stance), me.pose.z];
    const reach = Math.hypot(point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]);
    const wall = rayCastWorldObstacle(origin, point, map.colliders);
    return !wall || !wall.hit || wall.distance >= reach - 0.35;
  }

  private isFoe(ctx: BotContext, me: HubMember, m: HubMember) {
    if (m.id === me.id || m.hp <= 0) return false;
    if (m.seen <= ctx.now - ONLINE_MS) return false;
    if (ctx.state.room.teams && me.team && m.team === me.team) return false;
    return true;
  }

  /**
   * Кого бот сейчас действительно видит: сектор обзора, дальность и чистая
   * линия огня. Всё увиденное кладётся в короткую память.
   */
  private look(ctx: BotContext, me: HubMember) {
    const { now, map } = ctx;
    const visible: Contact[] = [];
    for (const m of ctx.state.members.values()) {
      if (!this.isFoe(ctx, me, m)) continue;
      const p = m.pose;
      const dist = Math.hypot(p.x - me.pose.x, p.z - me.pose.z);
      if (dist > this.sight) continue;
      // В упор человек замечает и сбоку — сектор чуть шире вблизи.
      const fov = dist < 4 ? Math.min(Math.PI * 1.1, this.fovRad * 1.6) : this.fovRad;
      const diff = Math.abs(wrapAngle(yawTo(me.pose.x, me.pose.z, p.x, p.z) - this.aimYaw));
      if (diff > fov / 2) continue;
      const torso = p.stance === 'sit' ? TORSO.sit : TORSO.stand;
      if (!this.canSee(map, me, [p.x, p.y + torso, p.z])) continue;
      const known = this.memory.get(m.id);
      const entry: Contact = {
        id: m.id,
        x: p.x,
        y: p.y,
        z: p.z,
        stance: p.stance,
        // Скорость — по двум своим наблюдениям, как игрок на глаз.
        vx: known && now > known.at ? ((p.x - known.x) * 1000) / (now - known.at) : 0,
        vz: known && now > known.at ? ((p.z - known.z) * 1000) / (now - known.at) : 0,
        at: now,
        dist,
      };
      this.memory.set(m.id, entry);
      visible.push(entry);
    }
    // Память живёт несколько секунд, потом контакт забывается.
    for (const [id, entry] of this.memory) if (now - entry.at > this.memoryMs) this.memory.delete(id);
    // Ближе и слабее — важнее.
    const hp = (id: string) => ctx.state.members.get(id)?.hp ?? 100;
    visible.sort((a, b) => a.dist - b.dist + (hp(a.id) - hp(b.id)) / 400);
    return visible;
  }

  /** Чужие выстрелы рядом: запоминаем, откуда стреляли, чтобы сходить проверить. */
  private hear(ctx: BotContext, me: HubMember) {
    const range = HEAR_RANGE * this.rules.hearing;
    let latest = this.lastSeq;
    for (const e of ctx.state.effects) {
      if (e.seq <= this.lastSeq) continue;
      if (e.seq > latest) latest = e.seq;
      if (e.author === me.id) continue;
      if (e.kind !== 'paint' && e.kind !== 'confetti' && e.kind !== 'sniper' && e.kind !== 'grenade') continue;
      const o = e.origin;
      if (!Array.isArray(o)) continue;
      const dist = Math.hypot(o[0] - me.pose.x, o[2] - me.pose.z);
      if (dist > range) continue;
      const shooter = ctx.state.members.get(e.author);
      this.noise = {
        x: o[0],
        z: o[2],
        at: ctx.now,
        ally: !!(shooter && me.team && shooter.team === me.team),
      };
    }
    this.lastSeq = latest;
  }

  // ---------------------------------------------------------------- прицел

  /** Доворот прицела с ограниченной скоростью; возвращает остаток угла. */
  private turnTo(me: HubMember, dt: number, point: number[], scale = 1) {
    const eyeY = me.pose.y + eyeHeight(this.stance);
    const dx = point[0] - me.pose.x;
    const dz = point[2] - me.pose.z;
    const horiz = Math.max(0.3, Math.hypot(dx, dz));
    const wantYaw = Math.atan2(-dx, -dz);
    // pitch положительный — взгляд вниз (lib/game-camera.ts).
    const wantPitch = clamp(-Math.atan2(point[1] - eyeY, horiz), -1.3, 1.35);
    const maxStep = this.turnSpeed * scale * dt;
    const dYaw = wrapAngle(wantYaw - this.aimYaw);
    this.aimYaw = wrapAngle(this.aimYaw + clamp(dYaw, -maxStep, maxStep));
    this.aimPitch = clamp(this.aimPitch + clamp(wantPitch - this.aimPitch, -maxStep, maxStep), -1.3, 1.35);
    return Math.abs(wrapAngle(wantYaw - this.aimYaw));
  }

  /** Куда бот целится: упреждение со своей ошибкой в оценке скорости цели. */
  private leadPoint(c: Contact) {
    const flight = 0.1 * this.leadError;
    const sit = c.stance === 'sit';
    const height = this.headAim ? (sit ? HEAD.sit : HEAD.stand) : sit ? TORSO.sit : TORSO.stand;
    return [c.x + c.vx * flight, c.y + height, c.z + c.vz * flight];
  }

  // ---------------------------------------------------------------- тактика

  private blocked(map: GameMap, x: number, z: number, y: number, stance: string) {
    const b = map.bounds;
    const m = BODY_RADIUS + 0.25;
    if (x < b.minX + m || x > b.maxX - m || z < b.minZ + m || z > b.maxZ - m) return true;
    return isBlocked3D(x, z, y, BODY_RADIUS, stanceHeight(stance), map.colliders);
  }

  /** Точка в стороне от угрозы, которую та не простреливает. */
  private findCover(map: GameMap, me: HubMember, threat: Contact) {
    const away = yawTo(threat.x, threat.z, me.pose.x, me.pose.z);
    let best: (Point & { hidden: boolean }) | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 18; i++) {
      const a = away + this.rand(-1.1, 1.1);
      const d = this.rand(4, 12);
      const x = me.pose.x - Math.sin(a) * d;
      const z = me.pose.z - Math.cos(a) * d;
      const y = map.groundHeight(x, z, me.pose.y);
      if (this.blocked(map, x, z, y, 'stand')) continue;
      // Укрытие должно быть на проходимой клетке, иначе до него не дойти.
      const cell = this.nav ? this.nav.at(x, z) : -1;
      if (cell >= 0 && this.nav && !this.nav.kind[cell]) continue;
      const gain =
        Math.hypot(x - threat.x, z - threat.z) - Math.hypot(me.pose.x - threat.x, me.pose.z - threat.z);
      if (gain < 0) continue;
      const from = [threat.x, threat.y + EYE_STAND, threat.z];
      const to = [x, y + TORSO.stand, z];
      const reach = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      const wall = rayCastWorldObstacle(from, to, map.colliders);
      const hidden = !!(wall && wall.hit && wall.distance < reach - 0.35);
      const score = (hidden ? 100 : 0) + gain - d * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = { x, z, hidden };
      }
    }
    return best;
  }

  /** Отталкивание от своих: командой ходят рядом, но не в одной точке. */
  private mateSpacing(ctx: BotContext, me: HubMember): [number, number] {
    if (!me.team) return [0, 0];
    let px = 0;
    let pz = 0;
    for (const m of ctx.state.members.values()) {
      if (m.id === me.id || m.hp <= 0 || m.team !== me.team) continue;
      const dx = me.pose.x - m.pose.x;
      const dz = me.pose.z - m.pose.z;
      const d = Math.hypot(dx, dz);
      if (d > MATE_SPACING || d < 1e-3) continue;
      const push = (MATE_SPACING - d) / MATE_SPACING;
      px += (dx / d) * push;
      pz += (dz / d) * push;
    }
    return [px, pz];
  }

  // ---------------------------------------------------------- перемещение

  /**
   * Маршрут патруля по проходимым клеткам карты: точки заведомо достижимы,
   * разбросаны по всей карте и у каждого бота свои, поэтому команда не ходит
   * гуськом и не стоит на базе.
   */
  private ensureWaypoints(me: HubMember, map: GameMap) {
    if (this.waypointTeam === me.team && this.waypoints.length) return;
    this.waypointTeam = me.team;
    const nav = this.nav ?? navFor(map);
    this.nav = nav;
    const points: Point[] = [];
    for (let guard = 0; points.length < 9 && guard < 800; guard++) {
      const idx = Math.floor(this.random() * nav.kind.length);
      if (nav.kind[idx] !== 1) continue;
      const x = nav.cx(idx % nav.cols);
      const z = nav.cz(Math.floor(idx / nav.cols));
      if (points.some((p) => Math.hypot(p.x - x, p.z - z) < 7)) continue;
      points.push({ x, z });
    }
    // Половина противника — там и встречаются: добавляем точку у их спавна.
    const foe = me.team === 'red' ? 'blue' : 'red';
    const spawns = map.spawns?.[foe] || [];
    if (spawns.length) {
      const s = spawns[this.index % spawns.length];
      points.push({ x: s.x, z: s.z });
    }
    const b = map.bounds;
    points.push({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 });
    // Свой порядок обхода у каждого бота.
    for (let i = points.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [points[i], points[j]] = [points[j], points[i]];
    }
    this.waypoints = points;
    // Начинаем с ближайшей точки, чтобы не бежать через всю карту зря.
    let best = 0;
    let bestD = Infinity;
    points.forEach((p, i) => {
      const d = Math.hypot(p.x - me.pose.x, p.z - me.pose.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    this.waypointIndex = best;
    this.goalBest = Infinity;
    this.goalBestAt = this.lastStepAt;
  }

  private nextWaypoint(now: number) {
    this.waypointIndex = (this.waypointIndex + 1) % Math.max(1, this.waypoints.length);
    this.goalBest = Infinity;
    this.goalBestAt = now;
  }

  /** Откуда делать следующий шаг: уже сделанный в этом такте или поза сервера. */
  private here(me: HubMember) {
    return this.next ?? me.pose;
  }

  /**
   * Шаг в заданную сторону. Высота следующей точки проверяется как в движке:
   * подъём выше CLIMB не берётся без прыжка, низкий проход — только присев.
   * Короткий «скользящий» обход остаётся на мелочь (углы, чужие тела).
   */
  private walk(ctx: BotContext, me: HubMember, dt: number, dirX: number, dirZ: number, scale = 1) {
    const { now, map } = ctx;
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-3 || scale < 0.05) {
      this.moving = false;
      this.speed = 0;
      this.moveDirX = 0;
      this.moveDirZ = 0;
      return false;
    }
    this.wantMove = scale > 0.2;
    const from = this.here(me);
    const ux = dirX / len;
    const uz = dirZ / len;
    const speed = RUN_SPEED * this.rules.speed * scale * (this.stance === 'sit' ? 0.45 : 1);
    const step = speed * dt;
    // В прыжке тело выше: сервер проверяет луч на высоте поднятой позы.
    const lift = now < this.jumpUntil ? Math.sin(Math.PI * (1 - (this.jumpUntil - now) / 620)) * 0.9 : 0;
    // Выбранный обход держим полсекунды: иначе бот каждые 100 мс выбирает новую
    // сторону и дёргается на месте вместо того, чтобы обойти препятствие.
    const held = now < this.slideUntil ? this.slideTurn : 0;
    const turns = held ? [held, 0, held * 1.8, -held, -held * 1.8] : [0, 0.35, -0.35, 0.8, -0.8, 1.3, -1.3];
    let moved = false;
    for (const turn of turns) {
      const a = held ? turn : turn * (turn ? this.slideSign : 1);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const nx = from.x + (ux * cos - uz * sin) * step;
      const nz = from.z + (ux * sin + uz * cos) * step;
      const ground = map.groundHeight(nx, nz, from.y);
      // Ступенька выше колена берётся только в прыжке, обрыв глубже FALL — никак.
      if (ground - from.y > CLIMB + lift || from.y - ground > FALL) continue;
      const ny = clamp(ground + lift, 0, 10);
      if (this.blocked(map, nx, nz, ny, this.stance)) {
        // Низкий проход: пролезаем присев, а не бьёмся о притолоку.
        if (this.stance === 'sit' || this.blocked(map, nx, nz, ny, 'sit')) continue;
        this.stance = 'sit';
      }
      // Та же проверка, что у сервера (moveAllowed): шаг не проходит сквозь стену.
      const h = Math.min(0.9, stanceHeight(this.stance) / 2);
      const wall = rayCastWorldObstacle([from.x, from.y + h, from.z], [nx, ny + h, nz], map.colliders);
      if (wall && wall.hit) continue;
      this.next = { x: nx, y: ny, z: nz };
      // Настоящее направление шага: из него считаются forward/strafe пакета.
      this.moveDirX = ux * cos - uz * sin;
      this.moveDirZ = ux * sin + uz * cos;
      if (a) {
        this.slideTurn = a;
        this.slideUntil = now + 500;
      } else if (!held) this.slideUntil = 0;
      moved = true;
      break;
    }
    if (!moved) {
      this.slideSign = -this.slideSign;
      this.slideUntil = 0;
      this.moveDirX = 0;
      this.moveDirZ = 0;
    }
    this.moving = moved;
    this.speed = moved ? speed : 0;
    return moved;
  }

  private clearPath() {
    this.path = null;
    this.pathIndex = 0;
    this.pathGoal = null;
  }

  /** Проложить маршрут по сетке; null — цель недостижима. */
  private replan(now: number, me: HubMember, map: GameMap, goal: Point) {
    const nav = this.nav ?? navFor(map);
    this.nav = nav;
    this.pathGoal = { x: goal.x, z: goal.z };
    this.pathAt = now;
    this.pathIndex = 0;
    this.goalBest = Infinity;
    this.goalBestAt = now;
    this.path = nav.find(me.pose.x, me.pose.z, goal.x, goal.z);
    return this.path;
  }

  /**
   * Идём к цели по маршруту сетки. Возвращает true, когда цель достигнута или
   * недостижима (тогда вызывающий выбирает следующую).
   */
  private navigate(ctx: BotContext, me: HubMember, dt: number, goal: Point, scale = 1) {
    const { now, map } = ctx;
    const pos = me.pose;
    const straight = Math.hypot(goal.x - pos.x, goal.z - pos.z);
    if (straight < 1.5) {
      this.clearPath();
      return true;
    }
    // Идём, пока приближаемся: за 8 с без прогресса цель считаем безнадёжной.
    if (straight < this.goalBest - 0.5) {
      this.goalBest = straight;
      this.goalBestAt = now;
    } else if (now - this.goalBestAt > 8000) {
      this.clearPath();
      this.goalBest = Infinity;
      this.goalBestAt = now;
      return true;
    }
    const stale =
      !this.path ||
      !this.pathGoal ||
      Math.hypot(this.pathGoal.x - goal.x, this.pathGoal.z - goal.z) > 1.5 ||
      now - this.pathAt > 8000;
    if (stale && !this.replan(now, me, map, goal)) {
      this.clearPath();
      return true;
    }
    const path = this.path as PathNode[];
    let node = path[this.pathIndex];
    // Узлы, которые уже позади, пропускаем.
    while (node && Math.hypot(node.x - pos.x, node.z - pos.z) < 0.8) {
      this.pathIndex++;
      node = path[this.pathIndex];
    }
    if (!node) {
      this.clearPath();
      return straight < 2.5;
    }
    // Сбило с маршрута (толкнули, отказ сервера) — перестраиваем.
    if (Math.hypot(node.x - pos.x, node.z - pos.z) > 6 && now - this.pathAt > 600) {
      const fresh = this.replan(now, me, map, goal);
      if (!fresh) {
        this.clearPath();
        return true;
      }
      node = fresh[this.pathIndex] || node;
    }
    if (node.crouch || path[this.pathIndex + 1]?.crouch) this.stance = 'sit';
    const [px, pz] = this.mateSpacing(ctx, me);
    // Ступеньку вверх берём прыжком: рампы и лестницы проходятся шагом.
    const climb = node.y - pos.y;
    if (climb > CLIMB * 0.8 && climb < 1.6 && now > this.jumpUntil + 500) this.jumpUntil = now + 620;
    this.walk(ctx, me, dt, node.x - pos.x + px * 0.6, node.z - pos.z + pz * 0.6, scale);
    return false;
  }

  /**
   * Залипание: хотел идти, но за 1.5 с сдвинулся меньше чем на 0.3 м —
   * перестраиваем маршрут, а со второго раза подряд меняем цель.
   */
  private trackStuck(now: number, me: HubMember) {
    const pos = me.pose;
    if (!this.wantMove || me.hp <= 0 || this.state === 'freeze' || !this.stuckAnchor) {
      this.stuckAnchor = { x: pos.x, z: pos.z };
      this.stuckAt = now;
      this.stuckStreak = 0;
      return;
    }
    if (Math.hypot(pos.x - this.stuckAnchor.x, pos.z - this.stuckAnchor.z) > 0.3) {
      this.stuckAnchor = { x: pos.x, z: pos.z };
      this.stuckAt = now;
      this.stuckStreak = 0;
      return;
    }
    if (now - this.stuckAt < 1500) return;
    this.stuckAnchor = { x: pos.x, z: pos.z };
    this.stuckAt = now;
    this.stuckStreak++;
    this.slideSign = -this.slideSign;
    this.jumpUntil = now + 620;
    this.clearPath();
    if (this.stuckStreak >= 2) {
      this.stuckStreak = 0;
      this.nextWaypoint(now);
      this.huntPoint = null;
      this.huntUntil = 0;
      this.coverPoint = null;
      this.holdUntil = 0;
    }
  }

  /** Темп хода: осторожные характеры идут чуть медленнее, после старта раунда — рывок. */
  private dash(now: number) {
    if (now < this.rushUntil) return 1;
    return this.profile.push > 0.5 ? 1 : 0.85;
  }

  // ------------------------------------------------------------- поведение

  /** Что бот делает в этот такт: смотрит, решает, поворачивается, идёт. */
  private act(ctx: BotContext, me: HubMember, dt: number): Contact | null {
    const { now, map } = ctx;
    // Ставится в walk(): отличает «стою нарочно» от «застрял».
    this.wantMove = false;
    this.wasMoving = this.moving;
    this.moving = false;
    this.speed = 0;
    if (me.hp <= 0) {
      this.state = 'dead';
      this.memory.clear();
      this.noise = null;
      return null;
    }
    if (ctx.frozen) {
      // Подготовка раунда: сервер шаг не примет — стоим и осматриваемся.
      this.state = 'freeze';
      this.stance = 'stand';
      const b = map.bounds;
      this.turnTo(me, dt, [(b.minX + b.maxX) / 2, me.pose.y + EYE_STAND, (b.minZ + b.maxZ) / 2], 0.5);
      return null;
    }
    this.ensureWaypoints(me, map);
    const visible = this.look(ctx, me);
    const target = visible[0] || null;
    // Новый контакт — человеческая задержка реакции до первого выстрела.
    if (target && target.id !== this.contactId) {
      this.contactId = target.id;
      this.contactAt = now;
      const [min, max] = this.rules.reaction;
      this.reactionUntil = now + Math.max(80, this.rand(min, max) + this.profile.reactionShift);
      this.leadError = this.rand(this.rules.lead[0], this.rules.lead[1]);
      this.headAim = this.random() < this.rules.headshot;
    } else if (!target && now - this.contactAt > 1200) this.contactId = '';

    const magazine = memberWeapon(me).magazine;
    const blaster = isBlaster(this.tool) ? this.tool : null;
    const emptyMag = !!blaster && magazine.rounds[blaster] <= 0;
    const lowHp = me.hp < this.profile.retreatHp;
    const threat = target || this.freshMemory(now);
    if (this.rules.cover && (lowHp || emptyMag) && threat && now > this.holdUntil)
      this.takeCover(now, map, me, threat, lowHp);

    if (this.state === 'cover' && now < this.holdUntil) {
      this.coverMove(ctx, me, dt, threat);
      return target;
    }
    if (target) {
      this.state = 'engage';
      this.engage(ctx, me, dt, target);
      return target;
    }
    // Никого не видно: идём на шум или к последнему контакту, иначе патруль.
    const lead = this.huntTarget(ctx, me);
    if (lead) {
      this.state = 'hunt';
      this.stance = 'stand';
      this.turnTo(me, dt, [lead.x, me.pose.y + EYE_STAND, lead.z], 0.7);
      if (this.navigate(ctx, me, dt, lead, this.dash(now))) {
        this.huntUntil = 0;
        this.huntPoint = null;
        this.noise = null;
        this.huntKey = '';
      }
      return null;
    }
    this.state = 'patrol';
    this.patrol(ctx, me, dt);
    return null;
  }

  /** Самый свежий контакт из памяти (для отхода и поиска). */
  private freshMemory(now: number) {
    let best: Contact | null = null;
    for (const entry of this.memory.values()) if (!best || entry.at > best.at) best = entry;
    return best && now - best.at <= this.memoryMs ? best : null;
  }

  private takeCover(now: number, map: GameMap, me: HubMember, threat: Contact, lowHp: boolean) {
    const cover = this.findCover(map, me, threat);
    if (!cover) return;
    this.state = 'cover';
    this.coverPoint = cover;
    // Раненый отсиживается дольше, пустой магазин — только на перезарядку.
    this.holdUntil = now + (lowHp ? this.rand(3500, 6000) : this.rand(1200, 2200));
  }

  /** Отход за укрытие: дойти, присесть и переждать. */
  private coverMove(ctx: BotContext, me: HubMember, dt: number, threat: Contact | null) {
    const point = this.coverPoint || { x: me.pose.x, z: me.pose.z };
    if (this.navigate(ctx, me, dt, point, 1)) {
      this.moving = false;
      this.speed = 0;
      this.stance = 'sit';
    }
    // Смотрим туда, откуда пришла угроза.
    if (threat) {
      const torso = threat.stance === 'sit' ? TORSO.sit : TORSO.stand;
      this.turnTo(me, dt, [threat.x, threat.y + torso, threat.z], 0.8);
    }
  }

  /** Бой: держим дистанцию характера, кружим, прыгаем на сближении, садимся на дальней. */
  private engage(ctx: BotContext, me: HubMember, dt: number, target: Contact) {
    const { now } = ctx;
    this.turnTo(me, dt, this.leadPoint(target));
    const dist = target.dist;
    if (now > this.strafeUntil) {
      this.strafeSign = this.random() < 0.5 ? -1 : 1;
      this.strafeUntil = now + this.rand(900, 2400);
    }
    // Дальний бой — приседаем, ближний — прыгаем и давим.
    this.stance = dist > this.profile.crouchFrom && !this.wasMoving ? 'sit' : 'stand';
    if (dist < 9 && this.random() < 0.02 * this.profile.jump * this.rules.strafe && now > this.jumpUntil + 900)
      this.jumpUntil = now + 620;
    const toX = target.x - me.pose.x;
    const toZ = target.z - me.pose.z;
    const len = Math.hypot(toX, toZ) || 1;
    const fx = toX / len;
    const fz = toZ / len;
    const { keep } = this.profile;
    const push = dist > keep.max ? this.profile.push : dist < keep.min ? -1 : 0;
    const [px, pz] = this.mateSpacing(ctx, me);
    const strafe = this.strafeSign * 0.9 * this.rules.strafe;
    const dirX = fx * push - fz * strafe + px * 0.6;
    const dirZ = fz * push + fx * strafe + pz * 0.6;
    if (Math.hypot(dirX, dirZ) < 0.05) return;
    this.walk(ctx, me, dt, dirX, dirZ, this.stance === 'sit' ? 0.6 : 1);
  }

  /** Куда идти проверять: свежий шум (не толпой) или последний контакт. */
  private huntTarget(ctx: BotContext, me: HubMember): Point | null {
    const { now } = ctx;
    if (this.huntPoint && now < this.huntUntil) return this.huntPoint;
    const noise = this.noise;
    if (noise && now - noise.at < 4000) {
      const key = Math.round(noise.x / 6) + ':' + Math.round(noise.z / 6);
      // На один шум идут не больше двух: остальные держат свои участки.
      let allies = 0;
      for (const other of ctx.squad.values())
        if (other !== this && other.team === me.team && other.huntKey === key && other.huntAt > now - 4000)
          allies++;
      if (allies < (noise.ally ? 1 : 2)) {
        this.huntKey = key;
        this.huntAt = now;
        this.huntPoint = { x: noise.x, z: noise.z };
        this.huntUntil = now + this.rand(5000, 8000);
        return this.huntPoint;
      }
      this.noise = null;
    }
    const memory = this.freshMemory(now);
    if (memory && now - memory.at > 700) {
      this.huntKey = Math.round(memory.x / 6) + ':' + Math.round(memory.z / 6);
      this.huntAt = now;
      this.huntPoint = { x: memory.x, z: memory.z };
      this.huntUntil = now + 4000;
      return this.huntPoint;
    }
    return null;
  }

  private patrol(ctx: BotContext, me: HubMember, dt: number) {
    this.stance = 'stand';
    // Дошли или цель недостижима — сразу берём следующую точку, а не стоим
    // такт на месте: бот должен непрерывно ходить по карте и искать бой.
    for (let attempt = 0; attempt < 4; attempt++) {
      const goal = this.waypoints[this.waypointIndex] || { x: 0, z: 0 };
      const look = this.path?.[this.pathIndex] ?? goal;
      // Смотрим вдоль маршрута, а не на цель за стеной — как живой игрок.
      this.turnTo(me, dt, [look.x, me.pose.y + EYE_STAND, look.z], 0.6);
      if (!this.navigate(ctx, me, dt, goal, this.dash(ctx.now))) return;
      this.nextWaypoint(ctx.now);
    }
  }

  // ------------------------------------------------------------ оружие

  private pickTool(now: number) {
    if (now <= this.toolUntil) return;
    const tools = this.profile.tools;
    this.tool = this.random() < 0.75 ? tools[0] : tools[Math.floor(this.random() * tools.length)];
    this.toolUntil = now + this.rand(20_000, 45_000);
    this.burst = 0;
  }
}
