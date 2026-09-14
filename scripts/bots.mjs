// Headless-боты для боевой комнаты: заходят по HTTP-API (как обычный клиент),
// играют на карте и пишут журнал аномалий.
//
// Запуск (Node 22+, ESM, импорт .ts через стриппинг типов — как в npm test):
//   node --experimental-strip-types scripts/bots.mjs --url http://100.74.94.97:3001 --room <id>
//
// Полезные ключи: --count 6, --minutes 20, --names Алма,Ерлан, --invite <token>.
// Отчёт: scratchpad/bots-report.json (или путь из переменной BOTS_REPORT).
//
// Бот играет «честно»: он знает только то, что видит (сектор обзора, дальность,
// чистая линия огня) и слышит (чужие выстрелы рядом). Позиции невидимых врагов
// не читаются — вместо них короткая память о последнем контакте. Прицел
// доворачивается с ограниченной скоростью, с упреждением, разбросом и отдачей,
// между «увидел» и первым выстрелом проходит человеческая задержка реакции.
//
// Сервер — источник истины: боты шлют presence ~10 раз в секунду и принимают
// позу из ответа. Правила движения повторяют lib/room-hub-core.ts: шаг не
// длиннее допустимой скорости, не внутрь стены и не сквозь неё.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getMap } from '../lib/maps/index.ts';
import { stanceHeight } from '../lib/maps/types.ts';
import { isBlocked3D, rayCastWorldObstacle } from '../lib/world-collision.ts';
import { inHitRange } from '../lib/game-items.ts';

// ---------------------------------------------------------------- параметры

/** Разбор `--key value` и `--key=value`. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq > 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[arg.slice(2)] = 'true';
    else {
      out[arg.slice(2)] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const BASE = String(args.url || 'http://localhost:3000').replace(/\/+$/, '');
const ROOM = args.room || '';
const COUNT = Math.max(1, Math.min(16, Number(args.count) || 6));
const MINUTES = args.minutes === undefined ? 20 : Number(args.minutes);
const INVITE = args.invite || '';
const REPORT_PATH =
  process.env.BOTS_REPORT || path.join(process.cwd(), 'scratchpad', 'bots-report.json');

const DEFAULT_NAMES = [
  'Алма',
  'Ерлан',
  'Айгуль',
  'Тимур',
  'Динара',
  'Нурлан',
  'Асель',
  'Дархан',
  'Камила',
  'Ринат',
  'Сауле',
  'Азамат',
  'Жанна',
  'Мади',
  'Гульнар',
  'Санжар',
];
const NAMES = (args.names ? String(args.names).split(',') : DEFAULT_NAMES)
  .map((n) => n.trim())
  .filter(Boolean);

if (!ROOM || args.help === 'true') {
  console.log(
    [
      'Боты для боевой комнаты Jinaly · Retro 3D.',
      '',
      'node --experimental-strip-types scripts/bots.mjs --url http://host:port --room <id> \\',
      '     [--count 6] [--minutes 20] [--names Алма,Ерлан] [--invite <token>]',
      '',
      '--minutes 0 — работать до Ctrl+C. Отчёт: ' + REPORT_PATH + ' (или $BOTS_REPORT).',
    ].join('\n'),
  );
  process.exit(ROOM ? 0 : 1);
}

// -------------------------------------------------------------- постоянные

/** Частота пакетов presence, мс (как у живого клиента). */
const TICK_MS = 100;
/** Радиус тела для проверки стен; сервер считает с запасом 0.25. */
const BODY_RADIUS = 0.32;
/** Скорость бега бота, м/с. Предел сервера — 4.8 * 1.5, идём с запасом. */
const RUN_SPEED = 3.4;
/** Глаза и центр корпуса относительно ног. */
const EYE_HEIGHT = 1.5;
const CHEST_HEIGHT = 1.1;
/** Дальше этого бот не видит никого, даже в упор по прямой. */
const SIGHT_LIMIT = 30;
/** Чужой выстрел слышно на этом расстоянии. */
const HEAR_RANGE = 20;
/** Ближе этого товарищи по команде расходятся. */
const MATE_SPACING = 4;
/** Расхождение позы с сервером, которое считаем отказом в движении, м. */
const REFUSE_EPS = 0.3;
/** Урон должен появиться за это время после попадания. */
const DAMAGE_WAIT_MS = 2000;
/** Счёт матча должен вырасти за это время после убийства. */
const SCORE_WAIT_MS = 2500;
/** Участник считается онлайн (ONLINE_MS в lib/room-hub-core.ts). */
const ONLINE_MS = 15_000;

/** Пауза между выстрелами на сервере (lib/game-items.ts, effectCooldown). */
const TOOL_COOLDOWN = { paint: 90, confetti: 650, grenade: 1200, sniper: 1100 };
const TOOL_VARIANT = { paint: 'classic', confetti: 'stars', grenade: 'pinata', sniper: 'salute' };
/** Заряды и перезарядка — как у игрока (lib/tool-magazine.ts). */
const CAPACITY = { paint: 24, confetti: 6, sniper: 5, grenade: 3 };
const RELOAD_MS = { paint: 1450, confetti: 1700, sniper: 1900, grenade: 1600 };
/** Темп стрельбы человека, мс: очередь и пауза между очередями. */
const CADENCE = {
  paint: [240, 420],
  confetti: [780, 1200],
  grenade: [1500, 2400],
  sniper: [1250, 1900],
};
const BURST = { paint: [3, 7], confetti: [2, 3], grenade: [1, 1], sniper: [1, 2] };
const COLORS = ['#ff647c', '#ffb851', '#7fe0b8', '#64d4ef', '#bc91f5', '#f49fd6'];

/**
 * Характеры ботов. Профиль выбирается по индексу бота, внутри профиля числа
 * ещё немного разбрасываются, чтобы двое одинаковых играли по-разному.
 */
const PROFILES = [
  {
    id: 'напористый',
    fov: 110,
    sight: 30,
    memory: [4000, 5000],
    reaction: [170, 260],
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
    sight: 28,
    memory: [5000, 6000],
    reaction: [240, 320],
    turn: [3.0, 3.8],
    keep: { min: 8, max: 22 },
    push: 0.35,
    tools: ['paint', 'grenade'],
    spread: 0.010,
    retreatHp: 45,
    jump: 0.25,
    crouchFrom: 12,
  },
  {
    id: 'снайпер',
    fov: 90,
    sight: 30,
    memory: [5000, 6000],
    reaction: [210, 300],
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
    sight: 30,
    memory: [4000, 6000],
    reaction: [200, 300],
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

const ROOM_PATH = '/api/rooms/' + ROOM;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const r3 = (n) => Math.round(n * 1000) / 1000;
/** Угол в (-π, π]. */
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** Курс на точку: в движке вперёд — это (-sin yaw, -cos yaw). */
const yawTo = (fromX, fromZ, toX, toZ) => Math.atan2(-(toX - fromX), -(toZ - fromZ));
/** Направление взгляда (lib/game-camera.ts, viewDirection): pitch вниз — плюс. */
const viewDir = (yaw, pitch) => [
  -Math.sin(yaw) * Math.cos(pitch),
  -Math.sin(pitch),
  -Math.cos(yaw) * Math.cos(pitch),
];
/** Грубая нормаль: сумма четырёх равномерных — почти гаусс. */
const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 0.82;

// --------------------------------------------------- сетка проходимости

/** Шаг сетки навигации, м. */
const NAV_CELL = 0.75;
/** Подъём выше этого шагом не берётся (нужен прыжок или рампа). */
const CLIMB = 0.55;
/** Спрыгнуть можно, а падать в пропасть — нет. */
const FALL = 3.5;
/** Восемь соседей: прямые дешевле диагоналей. */
const NEIGHBOURS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Проходимость карты клетками. Строится один раз на карту и общая для всех
 * ботов: волна от точек возрождения обходит карту так же, как ходит игрок —
 * подъём не выше CLIMB (лестницы и рампы проходятся, стены нет), а там, где
 * стоя не пролезть (дыра в стене Особняка), клетка помечается «только присев».
 */
class NavGrid {
  constructor(map) {
    const b = map.bounds;
    this.map = map;
    this.minX = b.minX;
    this.minZ = b.minZ;
    this.cols = Math.max(1, Math.ceil((b.maxX - b.minX) / NAV_CELL));
    this.rows = Math.max(1, Math.ceil((b.maxZ - b.minZ) / NAV_CELL));
    const size = this.cols * this.rows;
    /** 0 — непроходимо, 1 — стоя, 2 — только присев. */
    this.kind = new Uint8Array(size);
    this.height = new Float32Array(size);
    this.seen = new Uint8Array(size);
    // Рабочие массивы A*: переиспользуем, чтобы не давить сборщик мусора.
    this.gScore = new Float32Array(size);
    this.came = new Int32Array(size);
    this.stamp = new Int32Array(size);
    this.pass = 0;
    this.build();
  }

  cx(ix) {
    return this.minX + (ix + 0.5) * NAV_CELL;
  }

  cz(iz) {
    return this.minZ + (iz + 0.5) * NAV_CELL;
  }

  at(x, z) {
    const ix = Math.floor((x - this.minX) / NAV_CELL);
    const iz = Math.floor((z - this.minZ) / NAV_CELL);
    if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) return -1;
    return iz * this.cols + ix;
  }

  /** Какой стойкой клетка проходима на высоте y. */
  passable(x, z, y) {
    const colliders = this.map.colliders;
    if (!isBlocked3D(x, z, y, BODY_RADIUS, stanceHeight('stand'), colliders)) return 1;
    if (!isBlocked3D(x, z, y, BODY_RADIUS, stanceHeight('sit'), colliders)) return 2;
    return 0;
  }

  build() {
    const started = performance.now();
    const spawns = [...(this.map.spawns?.red || []), ...(this.map.spawns?.blue || [])];
    const b = this.map.bounds;
    const seeds = spawns.length
      ? spawns
      : [{ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }];
    const queue = [];
    for (const s of seeds) {
      const idx = this.at(s.x, s.z);
      if (idx < 0 || this.seen[idx]) continue;
      const y = this.map.groundHeight(this.cx(idx % this.cols), this.cz(Math.floor(idx / this.cols)), 0);
      this.seen[idx] = 1;
      const kind = this.passable(this.cx(idx % this.cols), this.cz(Math.floor(idx / this.cols)), y);
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
        if (this.seen[nidx]) continue;
        const wx = this.cx(nx);
        const wz = this.cz(nz);
        // Высоту считаем «от текущей ноги»: так работает и сам движок.
        const ny = this.map.groundHeight(wx, wz, y);
        this.seen[nidx] = 1;
        if (ny - y > CLIMB || y - ny > FALL) continue;
        const kind = this.passable(wx, wz, ny);
        if (!kind) continue;
        this.kind[nidx] = kind;
        this.height[nidx] = ny;
        queue.push(nidx);
      }
    }
    this.walkable = queue.length;
    this.buildMs = Math.round(performance.now() - started);
  }

  /** Ближайшая проходимая клетка к точке (поиск по расширяющемуся кольцу). */
  nearest(x, z) {
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

  /** Прямая между точками проходима: можно срезать угол пути. */
  clearLine(ax, az, ay, bx, bz) {
    const dist = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(dist / 0.4);
    let y = ay;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const ny = this.map.groundHeight(x, z, y);
      if (ny - y > CLIMB || y - ny > FALL) return false;
      if (!this.passable(x, z, ny)) return false;
      y = ny;
    }
    return true;
  }

  /** Путь из точки в точку: A* по клеткам, затем срезание лишних узлов. */
  find(fromX, fromZ, toX, toZ) {
    const start = this.nearest(fromX, fromZ);
    const goal = this.nearest(toX, toZ);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [];
    const pass = ++this.pass;
    const open = [{ idx: start, f: 0 }];
    this.gScore[start] = 0;
    this.came[start] = -1;
    this.stamp[start] = pass;
    const goalX = this.cx(goal % this.cols);
    const goalZ = this.cz(Math.floor(goal / this.cols));
    let visits = 0;
    let found = false;
    while (open.length && visits < 9000) {
      // Небольшая куча: очередь короткая, выборка минимума линейная.
      let bestI = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bestI].f) bestI = i;
      const current = open.splice(bestI, 1)[0];
      if (current.idx === goal) {
        found = true;
        break;
      }
      visits++;
      const ix = current.idx % this.cols;
      const iz = Math.floor(current.idx / this.cols);
      const g = this.gScore[current.idx];
      for (const [dx, dz, cost] of NEIGHBOURS) {
        const nx = ix + dx;
        const nz = iz + dz;
        if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
        const nidx = nz * this.cols + nx;
        if (!this.kind[nidx]) continue;
        // Углы не срезаем: по диагонали только если обе стороны свободны.
        if (dx && dz) {
          if (!this.kind[iz * this.cols + nx] || !this.kind[nz * this.cols + ix]) continue;
        }
        const climb = Math.abs(this.height[nidx] - this.height[current.idx]);
        // Присев ходят медленнее, крутые места тоже не бесплатны.
        const next = g + cost * NAV_CELL + (this.kind[nidx] === 2 ? 1.4 : 0) + climb * 0.6;
        if (this.stamp[nidx] === pass && this.gScore[nidx] <= next) continue;
        this.stamp[nidx] = pass;
        this.gScore[nidx] = next;
        this.came[nidx] = current.idx;
        const h = Math.hypot(this.cx(nx) - goalX, this.cz(nz) - goalZ);
        open.push({ idx: nidx, f: next + h });
      }
    }
    if (!found) return null;
    const nodes = [];
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
    const out = [];
    let i = 0;
    let x = fromX;
    let z = fromZ;
    let y = nodes[0] ? nodes[0].y : 0;
    while (i < nodes.length) {
      let j = nodes.length - 1;
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

const navCache = new Map();
/** Сетка карты: строится один раз и переиспользуется всеми ботами. */
function navFor(map) {
  let grid = navCache.get(map.id);
  if (!grid) {
    grid = new NavGrid(map);
    navCache.set(map.id, grid);
    console.log(
      `  сетка «${map.id}»: ${grid.walkable} проходимых клеток (${grid.cols}×${grid.rows}) за ${grid.buildMs} мс`,
    );
  }
  return grid;
}

// ------------------------------------------------------------ журнал ошибок

const anomalies = [];
const anomalyCounts = new Map();
const lastPrinted = new Map();
/** Где боты залипали: «x;z» с точностью до метра -> сколько раз. */
const stuckSpots = new Map();
/** Подробностей в файле храним не больше, чем это; счётчики считают всё. */
const MAX_ANOMALY_ROWS = 4000;

function anomaly(kind, bot, detail) {
  anomalyCounts.set(kind, (anomalyCounts.get(kind) || 0) + 1);
  const who = bot ? bot.name : '—';
  const row = { at: new Date().toISOString(), kind, bot: who, ...detail };
  if (anomalies.length < MAX_ANOMALY_ROWS) anomalies.push(row);
  // Одинаковые аномалии сыплются пачками — в консоль не чаще раза в 2 с.
  const key = kind + '|' + who;
  const now = Date.now();
  if ((lastPrinted.get(key) || 0) > now - 2000) return;
  lastPrinted.set(key, now);
  console.error('⚠ ' + kind + ' · ' + who + ': ' + JSON.stringify(detail));
}

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[clamp(Math.floor((sorted.length - 1) * p), 0, sorted.length - 1)]);
};

// -------------------------------------------------------------- перекличка

/**
 * Что боты сообщают друг другу: свою команду, позицию, занятие и участок, куда
 * пошли проверять шум. Позиции врагов не передаются — каждый видит сам.
 */
const squad = new Map();
const zoneKey = (x, z) => Math.round(x / 6) + ':' + Math.round(z / 6);
/** Сколько союзников уже идут проверять этот участок. */
function alliesHunting(bot, key) {
  const now = Date.now();
  let n = 0;
  for (const [id, row] of squad)
    if (id !== bot.id && row.team === bot.team && row.hunt === key && row.at > now - 4000) n++;
  return n;
}

// ------------------------------------------------------------------- бот

class Bot {
  constructor(name, index) {
    this.name = '🤖 ' + name;
    this.index = index;
    this.cookie = '';
    this.id = '';
    this.color = COLORS[index % COLORS.length];
    const profile = PROFILES[index % PROFILES.length];
    this.profile = profile;
    // Личные отклонения внутри характера.
    this.fovRad = ((profile.fov + rand(-6, 6)) * Math.PI) / 180;
    this.sight = Math.min(SIGHT_LIMIT, profile.sight + rand(-2, 2));
    this.memoryMs = rand(profile.memory[0], profile.memory[1]);
    this.turnSpeed = rand(profile.turn[0], profile.turn[1]);
    this.spread = profile.spread * rand(0.85, 1.2);
    this.keepMin = profile.keep.min;
    this.keepMax = profile.keep.max;
    // Последний снимок комнаты.
    this.version = 0;
    this.lastEffectAt = 0;
    this.members = [];
    this.match = null;
    this.teams = false;
    this.serverNow = Date.now();
    this.serverNowLocal = Date.now();
    this.respawnSeconds = 5;
    this.mapId = 'hub';
    this.map = getMap('hub');
    this.nav = null;
    // Своё состояние.
    this.pose = { x: 0, y: 0, z: 4 };
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.stance = 'stand';
    this.moving = false;
    this.speed = 0;
    this.hp = 100;
    this.life = 0;
    this.team = '';
    this.kills = 0;
    this.deaths = 0;
    this.shots = 0;
    this.hits = 0;
    this.traveled = 0;
    this.state = 'patrol';
    this.lastTickAt = 0;
    // Восприятие.
    this.memory = new Map();
    this.noise = null;
    this.contactId = '';
    this.contactAt = 0;
    this.reactionUntil = 0;
    this.leadError = 1;
    // Движение.
    this.waypoints = [];
    this.waypointTeam = null;
    this.waypointIndex = 0;
    this.slideSign = index % 2 ? 1 : -1;
    this.slideTurn = 0;
    this.slideUntil = 0;
    this.moveDirX = 0;
    this.moveDirZ = 0;
    this.strafeSign = index % 2 ? 1 : -1;
    this.strafeUntil = 0;
    this.goalBest = Infinity;
    this.goalBestAt = 0;
    this.jumpUntil = 0;
    this.coverPoint = null;
    this.holdUntil = 0;
    // Маршрут по сетке проходимости.
    this.path = null;
    this.pathIndex = 0;
    this.pathGoal = null;
    this.pathAt = 0;
    this.needCrouch = false;
    this.wantMove = false;
    // Залипание: якорь, от которого меряем сдвиг, и счётчики.
    this.stuckAnchor = null;
    this.stuckAt = 0;
    this.stuckCount = 0;
    this.stuckStreak = 0;
    this.huntUntil = 0;
    this.huntPoint = null;
    this.huntKey = '';
    this.rushUntil = 0;
    // Оружие.
    this.tool = profile.tools[0];
    this.toolUntil = 0;
    this.roundsLeft = CAPACITY[this.tool];
    this.reloadUntil = 0;
    this.nextShotAt = 0;
    this.burst = 0;
    this.burstLimit = 0;
    // Наблюдение за аномалиями.
    this.latency = [];
    this.latencyBaseline = 0;
    this.latencyWarnedAt = 0;
    this.pendingHits = [];
    this.seenKills = new Set();
    this.scoreWaits = [];
    this.watchScore = index === 0;
    this.deadSince = 0;
    this.respawnDeadline = 0;
    this.respawnReported = false;
    // Первые секунды после входа/возрождения сервер сам ставит игрока на спавн —
    // расхождение позы в это время не считаем отказом.
    this.graceUntil = 0;
    this.alive = true;
  }

  // ---------------------------------------------------------------- сеть

  async request(method, pathname, body) {
    const started = performance.now();
    let res;
    let text = '';
    const options = {
      method,
      headers: {
        Cookie: this.cookie,
        // fetch в Node не хранит куки и не ставит Origin — делаем это руками,
        // иначе POST отклоняется проверкой источника (db/server.ts).
        Origin: BASE,
      },
    };
    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    try {
      res = await fetch(BASE + pathname, options);
      text = await res.text();
    } catch (e) {
      anomaly('exception', this, {
        op: (body && body.type) || method,
        message: e instanceof Error ? e.message : String(e),
      });
      return { status: 0, data: null };
    }
    this.trackLatency(performance.now() - started);
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok)
      anomaly('http-error', this, {
        op: (body && body.type) || method,
        status: res.status,
        body: text.slice(0, 300),
      });
    return { status: res.status, data };
  }

  /** POST с версией комнаты; при конфликте версий перечитываем комнату и повторяем. */
  async post(body) {
    let r = await this.request('POST', ROOM_PATH, { ...body, version: this.version });
    const error = (r.data && r.data.error) || '';
    if (r.status === 409 || /Комнату обновил|Повторите действие/.test(error)) {
      anomaly('version-conflict', this, { op: body.type, version: this.version, error });
      await this.refresh();
      r = await this.request('POST', ROOM_PATH, { ...body, version: this.version });
    }
    return r;
  }

  async refresh() {
    const suffix = INVITE ? '?invite=' + encodeURIComponent(INVITE) : '';
    const r = await this.request('GET', ROOM_PATH + suffix);
    if (r.data && !r.data.join) this.absorb(r.data);
    return r;
  }

  trackLatency(ms) {
    this.latency.push(ms);
    if (this.latency.length === 100) this.latencyBaseline = percentile(this.latency, 0.5);
    if (this.latency.length < 200 || this.latency.length % 100) return;
    const recent = this.latency.slice(-100);
    const p95 = percentile(recent, 0.95);
    const base = this.latencyBaseline || percentile(this.latency.slice(0, 100), 0.5);
    const now = Date.now();
    if (p95 > Math.max(400, base * 4) && now - this.latencyWarnedAt > 60_000) {
      this.latencyWarnedAt = now;
      anomaly('latency-growth', this, {
        baselineMedianMs: base,
        recentMedianMs: percentile(recent, 0.5),
        recentP95Ms: p95,
        samples: this.latency.length,
      });
    }
  }

  // ----------------------------------------------------------- подключение

  async connect() {
    const res = await fetch(BASE + '/api/session', {
      method: 'POST',
      headers: { Origin: BASE, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const raw = res.headers.get('set-cookie');
    if (!res.ok || !raw) throw Error('Сессия не выдана: HTTP ' + res.status);
    this.cookie = raw.split(';')[0];
    this.id = (await res.json()).id;
  }

  async join() {
    const first = await this.refresh();
    if (first.data && first.data.join) {
      const joined = await this.request('POST', ROOM_PATH, { type: 'join', name: this.name });
      if (joined.status === 403) {
        // Комната с одобрением ведущего: подаём заявку и ждём ответа.
        await this.request('POST', ROOM_PATH, {
          type: 'join_request.create',
          name: this.name,
          inviteToken: INVITE,
        });
        const until = Date.now() + 120_000;
        let status = 'pending';
        while (running && status === 'pending' && Date.now() < until) {
          await sleep(2000);
          const s = await this.request('POST', ROOM_PATH, { type: 'join_request.status' });
          status = (s.data && s.data.status) || 'pending';
        }
        if (status !== 'accepted') throw Error('Заявка на вход не одобрена: ' + status);
        await this.request('POST', ROOM_PATH, { type: 'join', name: this.name });
      } else if (joined.status !== 200) {
        throw Error('Вход в комнату не удался: HTTP ' + joined.status);
      }
    }
    await this.request('POST', ROOM_PATH, { type: 'profile', color: this.color });
    await this.refresh();
    this.graceUntil = Date.now() + 3000;
  }

  // ------------------------------------------------------- разбор снимка

  absorb(data) {
    if (typeof data.version === 'number') this.version = data.version;
    if (typeof data.serverNow === 'number') {
      this.serverNow = data.serverNow;
      this.serverNowLocal = Date.now();
    }
    if (data.state) {
      const nextMap = getMap(data.state.map);
      if (nextMap.id !== this.mapId) {
        this.mapId = nextMap.id;
        this.map = nextMap;
        this.nav = navFor(nextMap);
        this.waypointTeam = null;
        this.clearPath();
        this.memory.clear();
        this.graceUntil = Date.now() + 3000;
      }
      if (Number.isFinite(data.state.respawnSeconds)) this.respawnSeconds = data.state.respawnSeconds;
    }
    // Счёт до этого снимка: убийство и очко приходят вместе, сравнивать надо с прошлым.
    const before = this.match && this.match.score ? this.match.score.red + this.match.score.blue : null;
    const phaseBefore = this.match ? this.match.phase : null;
    if (data.match) this.match = data.match;
    // Подготовка кончилась — рывок к точкам карты, как делает живой игрок.
    if (phaseBefore === 'freeze' && this.match && this.match.phase === 'live')
      this.rushUntil = Date.now() + 12_000;
    if (Array.isArray(data.members)) {
      this.members = data.members;
      this.teams = data.members.some((m) => m.team);
    }
    if (Array.isArray(data.effects)) {
      for (const e of data.effects) {
        if (typeof e.at === 'number' && e.at > this.lastEffectAt) this.lastEffectAt = e.at;
        if (e.kind === 'kill') this.noteKill(e, before);
        else if (e.author && e.author !== this.id) this.hear(e);
      }
    }
  }

  self() {
    return this.members.find((m) => m.id === this.id) || null;
  }

  /** Идёт подготовка раунда: не двигаемся и не стреляем (lib/room-hub-core.ts). */
  frozen() {
    return !!this.match && this.match.phase === 'freeze' && this.match.mode === 'rounds';
  }

  /** Убийство в ленте эффектов: следим, растёт ли от него счёт матча. */
  noteKill(effect, scoreBefore) {
    if (!this.watchScore || this.seenKills.has(effect.id)) return;
    this.seenKills.add(effect.id);
    if (this.seenKills.size > 500) this.seenKills = new Set([effect.id]);
    if (effect.teamkill || scoreBefore === null) return;
    if (!this.match || this.match.mode !== 'deathmatch' || !this.teams) return;
    const killer = this.members.find((m) => m.id === effect.killer);
    if (!killer || !killer.team) return;
    this.scoreWaits.push({
      base: scoreBefore,
      deadline: Date.now() + SCORE_WAIT_MS,
      killer: effect.killerName,
      victim: effect.victimName,
    });
  }

  checkScore() {
    if (!this.scoreWaits.length || !this.match) return;
    const score = this.match.score || { red: 0, blue: 0 };
    const total = score.red + score.blue;
    const now = Date.now();
    this.scoreWaits = this.scoreWaits.filter((w) => {
      if (total > w.base) return false;
      if (now <= w.deadline) return true;
      anomaly('score-stuck', this, {
        killer: w.killer,
        victim: w.victim,
        scoreBefore: w.base,
        scoreNow: total,
      });
      return false;
    });
  }

  /** После попадания (по правилам сервера) HP жертвы обязано упасть за DAMAGE_WAIT_MS. */
  checkDamage() {
    if (!this.pendingHits.length) return;
    const now = Date.now();
    this.pendingHits = this.pendingHits.filter((h) => {
      const victim = this.members.find((m) => m.id === h.victim);
      if (!victim) return false;
      if (victim.hp < h.hpBefore || victim.life !== h.life) {
        this.hits++;
        return false;
      }
      if (now <= h.deadline) return true;
      // Цель успела уйти с той позы, по которой стреляли: сервер отматывает мир
      // не дальше 250 мс, поэтому такой промах — норма, а не баг.
      const p = victim.pose || {};
      if (Math.hypot(p.x - h.aim.x, p.z - h.aim.z) > 0.6) return false;
      anomaly('damage-not-applied', this, {
        victim: victim.name,
        tool: h.tool,
        distance: r3(h.distance),
        hpBefore: h.hpBefore,
        hpNow: victim.hp,
        effect: h.effectId,
      });
      return false;
    });
  }

  checkRespawn() {
    const me = this.self();
    if (!me) return;
    const now = Date.now();
    if (me.hp > 0) {
      this.deadSince = 0;
      this.respawnReported = false;
      return;
    }
    // В режиме раундов мёртвые ждут следующего раунда — это не аномалия.
    const rounds = this.match && this.match.mode === 'rounds' && this.teams;
    if (rounds) return;
    if (!this.deadSince) {
      this.deadSince = now;
      const wait = me.respawnRemaining || this.respawnSeconds * 1000;
      this.respawnDeadline = now + wait + 3000;
      return;
    }
    if (!this.respawnReported && now > this.respawnDeadline) {
      this.respawnReported = true;
      anomaly('no-respawn', this, {
        deadForMs: now - this.deadSince,
        respawnSeconds: this.respawnSeconds,
        respawnRemaining: me.respawnRemaining,
      });
    }
  }

  // ------------------------------------------------------------ восприятие

  /** Линия огня от глаз к точке свободна. */
  canSee(point) {
    const origin = [this.pose.x, this.pose.y + EYE_HEIGHT, this.pose.z];
    const reach = Math.hypot(point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]);
    const wall = rayCastWorldObstacle(origin, point, this.map.colliders);
    return !wall || !wall.hit || wall.distance >= reach - 0.35;
  }

  isFoe(m) {
    if (m.id === this.id || m.hp <= 0) return false;
    if (this.team && m.team && m.team === this.team) return false;
    return true;
  }

  /**
   * Кого бот сейчас действительно видит: сектор обзора от своего взгляда,
   * дальность и чистая линия огня. Всё увиденное кладётся в короткую память.
   */
  look(now) {
    const serverNow = this.serverNow + (Date.now() - this.serverNowLocal);
    const visible = [];
    for (const m of this.members) {
      if (!this.isFoe(m)) continue;
      if (m.lastSeen && m.lastSeen < serverNow - ONLINE_MS) continue;
      const p = m.pose || {};
      if (!Number.isFinite(p.x)) continue;
      const dist = Math.hypot(p.x - this.pose.x, p.z - this.pose.z);
      if (dist > this.sight) continue;
      // В упор человек замечает и сбоку — сектор чуть шире вблизи.
      const fov = dist < 4 ? Math.min(Math.PI * 1.1, this.fovRad * 1.6) : this.fovRad;
      const diff = Math.abs(wrapAngle(yawTo(this.pose.x, this.pose.z, p.x, p.z) - this.aimYaw));
      if (diff > fov / 2) continue;
      if (!this.canSee([p.x, (p.y || 0) + CHEST_HEIGHT, p.z])) continue;
      const known = this.memory.get(m.id);
      this.memory.set(m.id, {
        id: m.id,
        name: m.name,
        x: p.x,
        y: p.y || 0,
        z: p.z,
        stance: p.stance || 'stand',
        yaw: p.yaw || 0,
        hp: m.hp,
        life: m.life,
        immune: m.immuneRemaining > 0,
        at: now,
        seenAt: this.serverNow,
        // Скорость считаем по двум своим наблюдениям — как игрок на глаз.
        vx: known && now > known.at ? ((p.x - known.x) * 1000) / (now - known.at) : 0,
        vz: known && now > known.at ? ((p.z - known.z) * 1000) / (now - known.at) : 0,
        dist,
      });
      visible.push(this.memory.get(m.id));
    }
    // Память живёт несколько секунд, потом контакт забывается.
    for (const [id, entry] of this.memory)
      if (now - entry.at > this.memoryMs) this.memory.delete(id);
    // Ближе и слабее — важнее.
    visible.sort((a, b) => a.dist - b.dist + (a.hp - b.hp) / 400);
    return visible;
  }

  /** Чужой выстрел рядом: запоминаем направление, чтобы сходить проверить. */
  hear(effect) {
    const o = effect.origin;
    if (!Array.isArray(o) || !Number.isFinite(o[0])) return;
    if (effect.kind !== 'paint' && effect.kind !== 'confetti' && effect.kind !== 'sniper' && effect.kind !== 'grenade')
      return;
    const dist = Math.hypot(o[0] - this.pose.x, o[2] - this.pose.z);
    if (dist > HEAR_RANGE) return;
    const shooter = this.members.find((m) => m.id === effect.author);
    this.noise = {
      x: o[0],
      z: o[2],
      at: Date.now(),
      dist,
      ally: !!(shooter && this.team && shooter.team === this.team),
    };
  }

  // ---------------------------------------------------------------- прицел

  /** Доворот прицела с ограниченной скоростью; возвращает остаток угла. */
  turnTo(dt, point, scale = 1) {
    const eyeY = this.pose.y + EYE_HEIGHT;
    const dx = point[0] - this.pose.x;
    const dz = point[2] - this.pose.z;
    const horiz = Math.max(0.3, Math.hypot(dx, dz));
    const wantYaw = Math.atan2(-dx, -dz);
    // pitch положительный — взгляд вниз (lib/game-camera.ts).
    const wantPitch = clamp(-Math.atan2(point[1] - eyeY, horiz), -1.3, 1.35);
    const maxStep = this.turnSpeed * scale * dt;
    const dYaw = wrapAngle(wantYaw - this.aimYaw);
    this.aimYaw = wrapAngle(this.aimYaw + clamp(dYaw, -maxStep, maxStep));
    const dPitch = wantPitch - this.aimPitch;
    this.aimPitch = clamp(this.aimPitch + clamp(dPitch, -maxStep, maxStep), -1.3, 1.35);
    return Math.abs(wrapAngle(wantYaw - this.aimYaw));
  }

  /** Куда бот целится с упреждением и своей ошибкой в оценке скорости. */
  leadPoint(entry) {
    const ping = percentile(this.latency.slice(-20), 0.5) / 1000;
    const flight = clamp(ping * 0.6 + 0.08, 0.08, 0.5) * this.leadError;
    return [
      entry.x + entry.vx * flight,
      entry.y + CHEST_HEIGHT + (entry.stance === 'sit' ? -0.35 : 0),
      entry.z + entry.vz * flight,
    ];
  }

  // ---------------------------------------------------------------- тактика

  blocked(x, z, y, stance) {
    const b = this.map.bounds;
    const m = BODY_RADIUS + 0.25;
    if (x < b.minX + m || x > b.maxX - m || z < b.minZ + m || z > b.maxZ - m) return true;
    return isBlocked3D(x, z, y, BODY_RADIUS, stanceHeight(stance), this.map.colliders);
  }

  /** Точка в стороне от угрозы, которую та не простреливает. */
  findCover(threat) {
    const away = yawTo(threat.x, threat.z, this.pose.x, this.pose.z);
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 26; i++) {
      const a = away + rand(-1.1, 1.1);
      const d = rand(4, 12);
      const x = this.pose.x - Math.sin(a) * d;
      const z = this.pose.z - Math.cos(a) * d;
      const y = this.map.groundHeight(x, z, this.pose.y);
      if (this.blocked(x, z, y, 'stand')) continue;
      // Укрытие должно быть на проходимой клетке, иначе до него не дойти.
      const cell = this.nav ? this.nav.at(x, z) : -1;
      if (cell >= 0 && !this.nav.kind[cell]) continue;
      const gain = Math.hypot(x - threat.x, z - threat.z) - Math.hypot(this.pose.x - threat.x, this.pose.z - threat.z);
      if (gain < 0) continue;
      const from = [threat.x, threat.y + EYE_HEIGHT, threat.z];
      const to = [x, y + CHEST_HEIGHT, z];
      const reach = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      const wall = rayCastWorldObstacle(from, to, this.map.colliders);
      const hidden = wall && wall.hit && wall.distance < reach - 0.35;
      const score = (hidden ? 100 : 0) + gain - d * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = { x, z, hidden: !!hidden };
      }
    }
    return best;
  }

  /** Отталкивание от своих: командой ходят рядом, но не в одной точке. */
  mateSpacing() {
    let px = 0;
    let pz = 0;
    for (const m of this.members) {
      if (m.id === this.id || m.hp <= 0) continue;
      if (!this.team || m.team !== this.team) continue;
      const p = m.pose || {};
      const dx = this.pose.x - p.x;
      const dz = this.pose.z - p.z;
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
   * Маршрут патруля строится по проходимым клеткам карты (а не по спавнам):
   * точки заведомо достижимы, разбросаны по всей карте и у каждого бота свои,
   * поэтому команда не ходит гуськом и не стоит на базе.
   */
  ensureWaypoints() {
    if (this.waypointTeam === this.team && this.waypoints.length) return;
    this.waypointTeam = this.team;
    if (!this.nav) this.nav = navFor(this.map);
    const nav = this.nav;
    const points = [];
    for (let guard = 0; points.length < 9 && guard < 800; guard++) {
      const idx = Math.floor(Math.random() * nav.kind.length);
      if (nav.kind[idx] !== 1) continue;
      const x = nav.cx(idx % nav.cols);
      const z = nav.cz(Math.floor(idx / nav.cols));
      if (points.some((p) => Math.hypot(p.x - x, p.z - z) < 7)) continue;
      points.push({ x, z });
    }
    // Половина противника — там и встречаются: добавляем одну точку у их спавна.
    const foe = this.team === 'red' ? 'blue' : 'red';
    const spawns = (this.map.spawns && this.map.spawns[foe]) || [];
    if (spawns.length) {
      const s = spawns[this.index % spawns.length];
      points.push({ x: s.x, z: s.z });
    }
    const b = this.map.bounds;
    points.push({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 });
    // Свой порядок обхода у каждого бота.
    for (let i = points.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [points[i], points[j]] = [points[j], points[i]];
    }
    this.waypoints = points;
    // Начинаем с ближайшей точки, чтобы не бежать через всю карту зря.
    let best = 0;
    let bestD = Infinity;
    points.forEach((p, i) => {
      const d = Math.hypot(p.x - this.pose.x, p.z - this.pose.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    this.waypointIndex = best;
    this.goalBest = Infinity;
    this.goalBestAt = Date.now();
  }

  nextWaypoint() {
    this.waypointIndex = (this.waypointIndex + 1) % Math.max(1, this.waypoints.length);
    this.goalBest = Infinity;
    this.goalBestAt = Date.now();
  }

  /**
   * Шаг в заданную сторону. Высота следующей точки проверяется как в движке:
   * подъём выше CLIMB не берётся без прыжка, а низкий проход — только присев.
   * Короткий «скользящий» обход остаётся на мелочь (углы, чужие тела).
   */
  walk(now, dt, dirX, dirZ, scale = 1) {
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-3 || scale < 0.05) {
      this.moving = false;
      this.speed = 0;
      this.moveDirX = 0;
      this.moveDirZ = 0;
      return false;
    }
    this.wantMove = scale > 0.2;
    const ux = dirX / len;
    const uz = dirZ / len;
    const speed = RUN_SPEED * scale * (this.stance === 'sit' ? 0.45 : 1);
    const step = speed * dt;
    // Подъём в прыжке входит в проверку стен: в воздухе тело задевает то, что
    // на земле обходится (сервер проверяет луч на высоте поднятой позы).
    const lift = now < this.jumpUntil ? Math.sin(Math.PI * (1 - (this.jumpUntil - now) / 620)) * 0.9 : 0;
    // Выбранный обход держим полсекунды: иначе бот каждые 100 мс выбирает новую
    // сторону и дёргается на месте вместо того, чтобы обойти препятствие.
    const held = now < this.slideUntil ? this.slideTurn : 0;
    const turns = held
      ? [held, 0, held * 1.8, -held, -held * 1.8]
      : [0, 0.35, -0.35, 0.8, -0.8, 1.3, -1.3];
    let moved = false;
    for (const turn of turns) {
      const a = held ? turn : turn * (turn ? this.slideSign : 1);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const nx = this.pose.x + (ux * cos - uz * sin) * step;
      const nz = this.pose.z + (ux * sin + uz * cos) * step;
      const ground = this.map.groundHeight(nx, nz, this.pose.y);
      // Ступенька выше колена берётся только в прыжке, обрыв глубже FALL — никак.
      if (ground - this.pose.y > CLIMB + lift || this.pose.y - ground > FALL) continue;
      const ny = clamp(ground + lift, 0, 10);
      if (this.blocked(nx, nz, ny, this.stance)) {
        // Низкий проход: пролезаем присев, а не бьёмся о притолоку.
        if (this.stance === 'sit' || this.blocked(nx, nz, ny, 'sit')) continue;
        this.stance = 'sit';
      }
      // Та же проверка, что у сервера (moveAllowed): шаг не проходит сквозь стену.
      const h = Math.min(0.9, stanceHeight(this.stance) / 2);
      const wall = rayCastWorldObstacle(
        [this.pose.x, this.pose.y + h, this.pose.z],
        [nx, ny + h, nz],
        this.map.colliders,
      );
      if (wall && wall.hit) continue;
      this.pose.x = nx;
      this.pose.z = nz;
      this.pose.y = ny;
      // Настоящее направление шага: из него считаются forward/strafe пакета,
      // по которым клиент предсказывает движение аватара между пакетами.
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      this.moveDirX = ux * cosA - uz * sinA;
      this.moveDirZ = ux * sinA + uz * cosA;
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

  // ------------------------------------------------------------- маршрут

  clearPath() {
    this.path = null;
    this.pathIndex = 0;
    this.pathGoal = null;
    this.needCrouch = false;
  }

  /** Проложить маршрут по сетке; null — цель недостижима. */
  replan(now, goal) {
    if (!this.nav) this.nav = navFor(this.map);
    this.pathGoal = { x: goal.x, z: goal.z };
    this.pathAt = now;
    this.pathIndex = 0;
    this.goalBest = Infinity;
    this.goalBestAt = now;
    this.path = this.nav.find(this.pose.x, this.pose.z, goal.x, goal.z);
    return this.path;
  }

  /**
   * Идём к цели по маршруту сетки: бот больше не упирается в стену и не
   * «скользит» вдоль неё наугад. Возвращает true, когда цель достигнута или
   * недостижима (тогда вызывающий выбирает следующую).
   */
  navigate(now, dt, goal, scale = 1) {
    const straight = Math.hypot(goal.x - this.pose.x, goal.z - this.pose.z);
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
    if (stale && !this.replan(now, goal)) {
      // Пути нет: цель за стеной или в непроходимой клетке — берём другую.
      this.clearPath();
      return true;
    }
    let node = this.path[this.pathIndex];
    // Узлы, которые уже позади, пропускаем.
    while (node && Math.hypot(node.x - this.pose.x, node.z - this.pose.z) < 0.8) {
      this.pathIndex++;
      node = this.path[this.pathIndex];
    }
    if (!node) {
      this.clearPath();
      return straight < 2.5;
    }
    // Сбило с маршрута (толкнули, отказ сервера) — перестраиваем.
    if (Math.hypot(node.x - this.pose.x, node.z - this.pose.z) > 6 && now - this.pathAt > 600) {
      if (!this.replan(now, goal)) {
        this.clearPath();
        return true;
      }
      node = this.path[this.pathIndex] || node;
    }
    this.needCrouch = !!node.crouch || !!(this.path[this.pathIndex + 1] || {}).crouch;
    if (this.needCrouch) this.stance = 'sit';
    const [px, pz] = this.mateSpacing();
    // Ступеньку вверх берём прыжком: рампы и лестницы проходятся шагом.
    const climb = node.y - this.pose.y;
    if (climb > CLIMB * 0.8 && climb < 1.6 && now > this.jumpUntil + 500) this.jumpUntil = now + 620;
    this.walk(now, dt, node.x - this.pose.x + px * 0.6, node.z - this.pose.z + pz * 0.6, scale);
    return false;
  }

  /**
   * Залипание: если бот хотел идти, но за 1.5 с сдвинулся меньше чем на 0.3 м —
   * пишем аномалию, перестраиваем маршрут, а со второго раза меняем цель.
   */
  trackStuck(now) {
    if (!this.wantMove || this.hp <= 0 || this.state === 'freeze' || now < this.graceUntil) {
      this.stuckAnchor = { x: this.pose.x, z: this.pose.z };
      this.stuckAt = now;
      this.stuckStreak = 0;
      return;
    }
    if (!this.stuckAnchor) {
      this.stuckAnchor = { x: this.pose.x, z: this.pose.z };
      this.stuckAt = now;
      return;
    }
    const moved = Math.hypot(this.pose.x - this.stuckAnchor.x, this.pose.z - this.stuckAnchor.z);
    if (moved > 0.3) {
      this.stuckAnchor = { x: this.pose.x, z: this.pose.z };
      this.stuckAt = now;
      this.stuckStreak = 0;
      return;
    }
    if (now - this.stuckAt < 1500) return;
    this.stuckAnchor = { x: this.pose.x, z: this.pose.z };
    this.stuckAt = now;
    this.stuckCount++;
    this.stuckStreak++;
    const spot = Math.round(this.pose.x) + ';' + Math.round(this.pose.z);
    stuckSpots.set(spot, (stuckSpots.get(spot) || 0) + 1);
    anomaly('stuck', this, {
      x: r3(this.pose.x),
      y: r3(this.pose.y),
      z: r3(this.pose.z),
      map: this.mapId,
      state: this.state,
      stance: this.stance,
      goal: this.pathGoal ? { x: r3(this.pathGoal.x), z: r3(this.pathGoal.z) } : null,
      attempt: this.stuckStreak,
    });
    this.slideSign = -this.slideSign;
    this.jumpUntil = now + 620;
    const goal = this.pathGoal;
    this.clearPath();
    if (this.stuckStreak >= 2) {
      // Дважды подряд — цель недостижима отсюда, берём следующую.
      this.stuckStreak = 0;
      this.nextWaypoint();
      this.huntPoint = null;
      this.huntUntil = 0;
      this.coverPoint = null;
      this.holdUntil = 0;
    } else if (goal) this.replan(now, goal);
  }

  /**
   * Темп хода. Скорость держим постоянной — рывки и остановки на маршруте
   * ломают предсказание движения у клиента и выглядят как дёрганье. Осторожные
   * характеры просто идут чуть медленнее.
   */
  dash(now) {
    if (now < this.rushUntil) return 1;
    return this.profile.push > 0.5 ? 1 : 0.85;
  }

  // ------------------------------------------------------------- поведение

  /** Что бот делает в этот такт: смотрит, решает, поворачивается, идёт. */
  act(now, dt) {
    // Ставится в walk(): нужен, чтобы отличать «стою нарочно» от «застрял».
    this.wantMove = false;
    if (this.hp <= 0) {
      this.state = 'dead';
      this.moving = false;
      this.speed = 0;
      this.memory.clear();
      this.noise = null;
      return null;
    }
    if (this.frozen()) {
      // Подготовка раунда: сервер всё равно не примет шаг — стоим и осматриваемся.
      this.state = 'freeze';
      this.moving = false;
      this.speed = 0;
      this.stance = 'stand';
      const b = this.map.bounds;
      this.turnTo(dt, [(b.minX + b.maxX) / 2, this.pose.y + EYE_HEIGHT, (b.minZ + b.maxZ) / 2], 0.5);
      return null;
    }
    this.ensureWaypoints();
    const visible = this.look(now);
    const target = visible[0] || null;
    // Новый контакт — человеческая задержка реакции до первого выстрела.
    if (target && target.id !== this.contactId) {
      this.contactId = target.id;
      this.contactAt = now;
      this.reactionUntil = now + rand(this.profile.reaction[0], this.profile.reaction[1]);
      this.leadError = rand(0.55, 1.3);
    } else if (!target && now - this.contactAt > 1200) this.contactId = '';

    const lowHp = this.hp < this.profile.retreatHp;
    const emptyMag = this.roundsLeft <= 0 && now > this.reloadUntil;
    const threat = target || this.freshMemory(now);
    if ((lowHp || emptyMag) && threat && now > this.holdUntil) this.takeCover(now, threat, lowHp);

    if (this.state === 'cover' && now < this.holdUntil) {
      this.coverMove(now, dt, threat);
      return this.canShootFromCover(now, target) ? target : null;
    }
    if (target) {
      this.state = 'engage';
      this.engage(now, dt, target);
      return now > this.reactionUntil ? target : null;
    }
    // Никого не видно: идём на шум или к последнему контакту, иначе патруль.
    const lead = this.huntTarget(now);
    if (lead) {
      this.state = 'hunt';
      this.stance = 'stand';
      this.turnTo(dt, [lead.x, this.pose.y + EYE_HEIGHT, lead.z], 0.7);
      if (this.navigate(now, dt, lead, this.dash(now))) {
        this.huntUntil = 0;
        this.huntPoint = null;
        this.noise = null;
        this.huntKey = '';
      }
      return null;
    }
    this.state = 'patrol';
    this.patrol(now, dt);
    return null;
  }

  /** Самый свежий контакт из памяти (для отхода и поиска). */
  freshMemory(now) {
    let best = null;
    for (const entry of this.memory.values())
      if (!best || entry.at > best.at) best = entry;
    return best && now - best.at <= this.memoryMs ? best : null;
  }

  takeCover(now, threat, lowHp) {
    const cover = this.findCover(threat);
    if (!cover) return;
    this.state = 'cover';
    this.coverPoint = cover;
    // Раненый отсиживается дольше, пустой магазин — только на перезарядку.
    this.holdUntil = now + (lowHp ? rand(3500, 6000) : rand(1200, 2200));
  }

  /** Отход за укрытие: сначала дойти, потом переждать и перезарядиться. */
  coverMove(now, dt, threat) {
    const point = this.coverPoint || { x: this.pose.x, z: this.pose.z };
    // До укрытия идём по маршруту — в отходе особенно нельзя упереться в стену.
    if (this.navigate(now, dt, point, 1)) {
      this.moving = false;
      this.speed = 0;
      this.stance = 'sit';
      // В укрытии можно спокойно перезарядиться.
      if (this.roundsLeft <= 0 && now > this.reloadUntil) this.startReload(now);
    }
    // Смотрим туда, откуда пришла угроза.
    if (threat) this.turnTo(dt, [threat.x, threat.y + CHEST_HEIGHT, threat.z], 0.8);
  }

  canShootFromCover(now, target) {
    // Отстреливаться из укрытия можно, если цель сама вышла на глаза и есть чем.
    return !!target && this.roundsLeft > 0 && now > this.reloadUntil && now > this.reactionUntil;
  }

  /** Бой: держим дистанцию профиля, кружим, прыгаем на сближении, садимся на дальней. */
  engage(now, dt, target) {
    const aim = this.leadPoint(target);
    this.turnTo(dt, aim);
    const dist = target.dist;
    if (now > this.strafeUntil) {
      this.strafeSign = Math.random() < 0.5 ? -1 : 1;
      this.strafeUntil = now + rand(900, 2400);
    }
    // Дальний бой — приседаем, ближний — прыгаем и давим.
    this.stance = dist > this.profile.crouchFrom && !this.moving ? 'sit' : 'stand';
    if (dist < 9 && Math.random() < 0.02 * this.profile.jump && now > this.jumpUntil + 900)
      this.jumpUntil = now + 620;
    const toX = target.x - this.pose.x;
    const toZ = target.z - this.pose.z;
    const len = Math.hypot(toX, toZ) || 1;
    const fx = toX / len;
    const fz = toZ / len;
    const push = dist > this.keepMax ? this.profile.push : dist < this.keepMin ? -1 : 0;
    const [px, pz] = this.mateSpacing();
    const dirX = fx * push - fz * this.strafeSign * 0.9 + px * 0.6;
    const dirZ = fz * push + fx * this.strafeSign * 0.9 + pz * 0.6;
    if (Math.hypot(dirX, dirZ) < 0.05) {
      this.moving = false;
      this.speed = 0;
      return;
    }
    this.walk(now, dt, dirX, dirZ, this.stance === 'sit' ? 0.6 : 1);
  }

  /** Куда идти проверять: свежий шум (не толпой) или последний контакт. */
  huntTarget(now) {
    if (this.huntPoint && now < this.huntUntil) return this.huntPoint;
    const noise = this.noise;
    if (noise && now - noise.at < 4000) {
      const key = zoneKey(noise.x, noise.z);
      // На один шум идут не больше двух: остальные держат свои участки.
      if (alliesHunting(this, key) < (noise.ally ? 1 : 2)) {
        this.huntKey = key;
        this.huntPoint = { x: noise.x, z: noise.z };
        this.huntUntil = now + rand(5000, 8000);
        return this.huntPoint;
      }
      this.noise = null;
    }
    const memory = this.freshMemory(now);
    if (memory && now - memory.at > 700) {
      this.huntKey = zoneKey(memory.x, memory.z);
      this.huntPoint = { x: memory.x, z: memory.z };
      this.huntUntil = now + 4000;
      return this.huntPoint;
    }
    return null;
  }

  patrol(now, dt) {
    this.stance = 'stand';
    // Дошли или цель недостижима — сразу берём следующую точку, а не стоим
    // такт на месте: бот должен непрерывно ходить по карте и искать бой.
    for (let attempt = 0; attempt < 4; attempt++) {
      const goal = this.waypoints[this.waypointIndex] || { x: 0, z: 0 };
      const node = this.path && this.path[this.pathIndex];
      const look = node || goal;
      // Смотрим вдоль маршрута, а не на цель за стеной — как живой игрок.
      this.turnTo(dt, [look.x, this.pose.y + EYE_HEIGHT, look.z], 0.6);
      if (!this.navigate(now, dt, goal, this.dash(now))) return;
      this.nextWaypoint();
    }
  }

  // ------------------------------------------------------------ стрельба

  startReload(now) {
    this.reloadUntil = now + RELOAD_MS[this.tool];
    this.roundsLeft = CAPACITY[this.tool];
  }

  pickTool(now) {
    if (now <= this.toolUntil) return;
    const tools = this.profile.tools;
    this.tool = Math.random() < 0.75 ? tools[0] : pick(tools);
    this.toolUntil = now + rand(20_000, 45_000);
    this.roundsLeft = CAPACITY[this.tool];
    this.burst = 0;
  }

  async fire(now, target) {
    if (this.hp <= 0 || !target || this.frozen()) return;
    this.pickTool(now);
    if (now < this.reloadUntil) return;
    if (this.roundsLeft <= 0) {
      // В открытом поле перезаряжаться не хочется, но выбора нет.
      this.startReload(now);
      return;
    }
    if (now < this.nextShotAt) return;
    const me = this.self();
    if (me && me.immuneRemaining > 0) return; // под защитой спавна выстрел отклонят
    if (this.tool === 'sniper' && target.dist < 3) return;
    const origin = [this.pose.x, this.pose.y + EYE_HEIGHT, this.pose.z];
    const aim = this.leadPoint(target);
    const dist = Math.max(1, Math.hypot(aim[0] - origin[0], aim[1] - origin[1], aim[2] - origin[2]));
    // Разброс: хуже в движении, на дистанции и в конце очереди.
    const sigma =
      this.spread *
      (1 + (this.moving ? 0.9 : 0) + dist / 32 + this.burst * 0.12) *
      (this.stance === 'sit' ? 0.7 : 1);
    const yaw = wrapAngle(this.aimYaw + gauss() * sigma);
    const pitch = clamp(this.aimPitch + gauss() * sigma, -1.3, 1.35);
    const dir = viewDir(yaw, pitch);
    const target3 = [origin[0] + dir[0] * dist, origin[1] + dir[1] * dist, origin[2] + dir[2] * dist];
    const normal = [-dir[0], -dir[1], -dir[2]];
    const effectId = crypto.randomUUID();
    // seenAt — серверное время мира, по позам которого мы целились: это время
    // последнего снимка. Дальше 250 мс сервер всё равно не отматывает.
    const serverNow = this.serverNow + (Date.now() - this.serverNowLocal);
    const seenAt = Math.round(clamp(target.seenAt, serverNow - 240, serverNow));
    const r = await this.post({
      type: 'effect',
      id: effectId,
      kind: this.tool,
      variant: TOOL_VARIANT[this.tool],
      origin: origin.map(r3),
      target: target3.map(r3),
      normal: normal.map(r3),
      color: this.color,
      seenAt,
      ...(this.tool === 'sniper' ? { scoped: true, noScope: false } : {}),
    });
    // Очередь: несколько выстрелов подряд, потом пауза на доводку прицела.
    const [fastMin, fastMax] = CADENCE[this.tool];
    if (!this.burstLimit) this.burstLimit = Math.round(rand(BURST[this.tool][0], BURST[this.tool][1]));
    this.burst++;
    const pause = this.burst >= this.burstLimit;
    if (pause) {
      this.burst = 0;
      this.burstLimit = 0;
    }
    this.nextShotAt =
      now +
      Math.max(
        TOOL_COOLDOWN[this.tool] + 40,
        pause ? rand(fastMax, fastMax + 700) : rand(fastMin, fastMax),
      );
    if (r.status !== 200 || !r.data || r.data.ok !== true) return;
    this.shots++;
    this.roundsLeft--;
    // Отдача: прицел подбрасывает вверх, доводка вернёт его обратно.
    this.aimPitch = clamp(this.aimPitch - rand(0.006, 0.02) * (this.tool === 'sniper' ? 2.5 : 1), -1.3, 1.35);
    // Урон ждём только там, где по правилам сервера выстрел точно попал:
    // так «урон не применился» остаётся сигналом о баге, а не о промахе.
    const victim = this.members.find((m) => m.id === target.id);
    const pose = victim && victim.pose;
    // Сервер отматывает мир не дальше 250 мс: по старому снимку промах законен.
    // Исключение — стоящая цель: её поза за это время всё равно не изменилась.
    const fresh =
      serverNow - target.seenAt < 260 || Math.hypot(target.vx, target.vz) < 0.8;
    const hit =
      pose &&
      (this.tool === 'paint' || this.tool === 'sniper') &&
      !victim.immuneRemaining &&
      fresh &&
      inHitRange(this.tool, origin, target3, pose, this.map.colliders);
    if (hit)
      this.pendingHits.push({
        victim: victim.id,
        hpBefore: victim.hp,
        life: victim.life,
        tool: this.tool,
        distance: target.dist,
        aim: { x: pose.x, z: pose.z },
        effectId,
        deadline: now + DAMAGE_WAIT_MS,
      });
  }

  // ----------------------------------------------------------------- цикл

  async tick() {
    const now = Date.now();
    const dt = clamp(this.lastTickAt ? (now - this.lastTickAt) / 1000 : TICK_MS / 1000, 0.02, 0.4);
    this.lastTickAt = now;
    // Поза, которую сервер принял в прошлом такте: от неё он и считает шаг.
    const from = { x: this.pose.x, y: this.pose.y, z: this.pose.z };
    const target = this.act(now, dt);
    this.trackStuck(now);
    squad.set(this.id, {
      team: this.team,
      x: this.pose.x,
      z: this.pose.z,
      state: this.state,
      hunt: this.huntKey,
      at: now,
    });
    const sentLife = this.life;
    const sent = { x: this.pose.x, y: this.pose.y, z: this.pose.z };
    // Клиент достраивает движение чужих игроков между пакетами по
    // yaw/forward/strafe/speed (components/world-remote-players.ts). Поэтому
    // раскладываем настоящее направление шага по осям взгляда: иначе аватар
    // «уезжает» не туда и на каждом пакете дёргается назад.
    const sinY = Math.sin(this.aimYaw);
    const cosY = Math.cos(this.aimYaw);
    const forward = this.moving ? clamp(-this.moveDirX * sinY - this.moveDirZ * cosY, -1, 1) : 0;
    const strafe = this.moving ? clamp(this.moveDirX * cosY - this.moveDirZ * sinY, -1, 1) : 0;
    const pose = {
      x: r3(this.pose.x),
      y: r3(this.pose.y),
      z: r3(this.pose.z),
      yaw: r3(this.aimYaw),
      stance: this.stance,
      moving: this.moving,
      speed: r3(this.speed),
      forward: r3(forward),
      strafe: r3(strafe),
      pitch: r3(this.aimPitch),
      tool: this.tool,
      variant: TOOL_VARIANT[this.tool],
      aiming: !!target && this.tool === 'sniper',
      crouching: this.stance === 'sit',
      reload:
        now < this.reloadUntil
          ? clamp(1 - (this.reloadUntil - now) / RELOAD_MS[this.tool], 0, 1)
          : 0,
      working: false,
    };
    const r = await this.post({
      type: 'presence',
      pose,
      life: this.life,
      ping: percentile(this.latency.slice(-40), 0.5),
      sinceEffect: this.lastEffectAt,
    });
    if (!r.data || r.data.ok !== true) return;
    this.absorb(r.data);
    const me = this.self();
    if (me) {
      const server = me.pose || {};
      const teamChanged = me.team !== this.team;
      const lifeChanged = me.life !== sentLife;
      const hurt = me.hp < this.hp;
      this.hp = me.hp;
      this.life = me.life;
      this.team = me.team || '';
      this.kills = me.kills;
      this.deaths = me.deaths;
      if (teamChanged) {
        this.waypointTeam = null;
        this.graceUntil = Date.now() + 3000;
      }
      const drift = Math.hypot(server.x - sent.x, server.z - sent.z);
      if (
        drift > REFUSE_EPS &&
        !lifeChanged &&
        !teamChanged &&
        !this.frozen() &&
        this.hp > 0 &&
        Date.now() > this.graceUntil
      )
        anomaly('move-refused', this, {
          from: { x: r3(from.x), y: r3(from.y), z: r3(from.z) },
          sent: { x: r3(sent.x), y: r3(sent.y), z: r3(sent.z) },
          server: { x: r3(server.x), y: r3(server.y), z: r3(server.z) },
          stepM: r3(Math.hypot(sent.x - from.x, sent.z - from.z)),
          driftM: r3(drift),
          state: this.state,
          stance: this.stance,
          life: me.life,
          hp: me.hp,
        });
      // Сколько бот реально прошёл: видно, ходит он по карте или стоит на базе.
      if (!lifeChanged && drift < 3) this.traveled += Math.hypot(server.x - from.x, server.z - from.z);
      // Дальше идём от позиции сервера — она главная.
      this.pose.x = server.x;
      this.pose.y = server.y;
      this.pose.z = server.z;
      // Прилетело из ниоткуда — разворачиваемся на ближайший шум.
      if (hurt && !this.memory.size && this.noise) this.huntUntil = 0;
      if (lifeChanged) {
        this.graceUntil = Date.now() + 1500;
        this.aimYaw = server.yaw || 0;
        this.aimPitch = 0;
        this.memory.clear();
        this.noise = null;
        this.huntPoint = null;
        this.huntKey = '';
        this.coverPoint = null;
        this.holdUntil = 0;
        this.waypointIndex = 0;
        this.goalBest = Infinity;
        this.goalBestAt = Date.now();
        this.roundsLeft = CAPACITY[this.tool];
        this.burst = 0;
        this.pendingHits = [];
      }
    }
    this.checkDamage();
    this.checkRespawn();
    this.checkScore();
    if (target) await this.fire(Date.now(), target);
  }

  async run(endAt) {
    while (running && (!endAt || Date.now() < endAt)) {
      const started = Date.now();
      try {
        await this.tick();
      } catch (e) {
        anomaly('exception', this, {
          where: 'tick',
          message: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? String(e.stack).split('\n').slice(0, 4).join(' | ') : '',
        });
        await sleep(500);
      }
      await sleep(Math.max(0, TICK_MS - (Date.now() - started)));
    }
    this.alive = false;
  }
}

// ------------------------------------------------------------------ запуск

let running = true;
const bots = [];
const startedAt = Date.now();

function stats() {
  const all = [];
  for (const bot of bots) all.push(...bot.latency);
  return {
    samples: all.length,
    medianMs: percentile(all, 0.5),
    p95Ms: percentile(all, 0.95),
  };
}

/** Самые «липкие» места карты: там геометрия мешает пройти. */
function stuckTop(limit = 10) {
  return [...stuckSpots]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([spot, count]) => {
      const [x, z] = spot.split(';').map(Number);
      return { x, z, count };
    });
}

function summary() {
  const latency = stats();
  console.log('\n=== Сводка ===');
  console.log('Комната: ' + BASE + ROOM_PATH + ' · карта: ' + (bots[0] ? bots[0].mapId : '—'));
  console.log('Время работы: ' + Math.round((Date.now() - startedAt) / 1000) + ' с');
  for (const bot of bots) {
    const own = percentile(bot.latency, 0.5);
    console.log(
      `${bot.name.padEnd(14)} ${bot.profile.id.padEnd(11)} команда ${(bot.team || '—').padEnd(5)} ` +
        `убийств ${String(bot.kills).padStart(3)} смертей ${String(bot.deaths).padStart(3)} ` +
        `выстрелов ${String(bot.shots).padStart(4)} попаданий ${String(bot.hits).padStart(4)} ` +
        `залипаний ${String(bot.stuckCount).padStart(3)} прошёл ${String(Math.round(bot.traveled)).padStart(5)} м медиана ${own} мс`,
    );
  }
  const spots = stuckTop(5);
  if (spots.length) {
    console.log('Чаще всего залипали (карта ' + (bots[0] ? bots[0].mapId : '—') + '):');
    for (const s of spots) console.log(`  x=${s.x} z=${s.z} — ${s.count} раз`);
  }
  console.log('Задержка всех ботов: медиана ' + latency.medianMs + ' мс, 95-й процентиль ' + latency.p95Ms + ' мс');
  if (!anomalyCounts.size) console.log('Аномалий не зафиксировано.');
  else {
    console.log('Аномалии:');
    for (const [kind, count] of [...anomalyCounts].sort((a, b) => b[1] - a[1]))
      console.log('  ' + kind.padEnd(20) + count);
  }
  console.log('Отчёт: ' + REPORT_PATH);
}

async function writeReport() {
  const report = {
    url: BASE,
    room: ROOM,
    map: bots[0] ? bots[0].mapId : null,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    latency: stats(),
    bots: bots.map((b) => ({
      name: b.name,
      id: b.id,
      profile: b.profile.id,
      team: b.team,
      kills: b.kills,
      deaths: b.deaths,
      shots: b.shots,
      confirmedHits: b.hits,
      stuckCount: b.stuckCount,
      traveledM: Math.round(b.traveled),
      medianLatencyMs: percentile(b.latency, 0.5),
      p95LatencyMs: percentile(b.latency, 0.95),
    })),
    navGrids: [...navCache.values()].map((g) => ({
      map: g.map.id,
      cells: g.cols * g.rows,
      walkable: g.walkable,
      cellSize: NAV_CELL,
      buildMs: g.buildMs,
    })),
    stuckSpots: stuckTop(30),
    anomalyCounts: Object.fromEntries(anomalyCounts),
    anomalies,
  };
  try {
    await mkdir(path.dirname(REPORT_PATH), { recursive: true });
    await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  } catch (e) {
    console.error('Не удалось записать отчёт: ' + (e instanceof Error ? e.message : String(e)));
  }
}

process.on('unhandledRejection', (e) => {
  anomaly('exception', null, {
    where: 'unhandledRejection',
    message: e instanceof Error ? e.message : String(e),
  });
});

let stopping = false;
process.on('SIGINT', () => {
  if (stopping) process.exit(130);
  stopping = true;
  running = false;
  console.log('\nОстанавливаю ботов…');
});

console.log(
  `Запускаю ${COUNT} ботов в ${BASE}${ROOM_PATH}` +
    (MINUTES > 0 ? ` на ${MINUTES} мин` : ' до Ctrl+C'),
);

for (let i = 0; i < COUNT; i++) {
  const bot = new Bot(NAMES[i % NAMES.length] + (i >= NAMES.length ? ' ' + (i + 1) : ''), i);
  try {
    await bot.connect();
    await bot.join();
    bots.push(bot);
    console.log(`  вошёл ${bot.name} (${bot.profile.id}), карта ${bot.mapId}`);
  } catch (e) {
    anomaly('exception', bot, {
      where: 'join',
      message: e instanceof Error ? e.message : String(e),
    });
  }
  // Входим по очереди: сервер раскидывает по командам по мере появления.
  await sleep(250);
}

if (!bots.length) {
  console.error('Ни один бот не вошёл в комнату.');
  await writeReport();
  process.exit(1);
}

const endAt = MINUTES > 0 ? Date.now() + MINUTES * 60_000 : 0;
// Промежуточный отчёт: если процесс убьют, журнал не пропадёт.
const saver = setInterval(() => void writeReport(), 30_000);
await Promise.all(bots.map((bot) => bot.run(endAt)));
clearInterval(saver);
running = false;
summary();
await writeReport();
process.exit(0);
