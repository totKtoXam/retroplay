// Headless-боты для боевой комнаты: заходят по HTTP-API (как обычный клиент),
// бегают по карте, стреляют друг в друга и в человека, и пишут журнал аномалий.
//
// Запуск (Node 22+, ESM, импорт .ts через стриппинг типов — как в npm test):
//   node --experimental-strip-types scripts/bots.mjs --url http://100.74.94.97:3001 --room <id>
//
// Полезные ключи: --count 6, --minutes 20, --names Алма,Ерлан, --invite <token>.
// Отчёт: scratchpad/bots-report.json (или путь из переменной BOTS_REPORT).
//
// Сервер — источник истины: боты шлют presence ~10 раз в секунду и принимают
// позу из ответа. Правила движения повторяют lib/room-hub-core.ts: шаг не
// длиннее допустимой скорости, не внутрь стены и не сквозь неё.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getMap } from '../lib/maps/index.ts';
import { stanceHeight } from '../lib/maps/types.ts';
import { isBlocked3D, rayCastWorldObstacle } from '../lib/world-collision.ts';

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
const EYE_HEIGHT = 1.55;
const CHEST_HEIGHT = 1.1;
/** Дальше этого бот врага не атакует. */
const ENGAGE_RANGE = 25;
/** Выстрелов до перезарядки и её длительность. */
const MAGAZINE = 24;
const RELOAD_MS = 1500;
/** Расхождение позы с сервером, которое считаем отказом в движении, м. */
const REFUSE_EPS = 0.3;
/** Урон должен появиться за это время после попадания. */
const DAMAGE_WAIT_MS = 2000;
/** Счёт матча должен вырасти за это время после убийства. */
const SCORE_WAIT_MS = 2500;
/** Участник считается онлайн (ONLINE_MS в lib/room-hub-core.ts). */
const ONLINE_MS = 15_000;

const TOOLS = ['paint', 'confetti', 'grenade', 'sniper'];
/** Пауза между выстрелами на сервере (lib/game-items.ts, effectCooldown). */
const TOOL_COOLDOWN = { paint: 90, confetti: 650, grenade: 1200, sniper: 1100 };
const TOOL_VARIANT = { paint: 'classic', confetti: 'stars', grenade: 'pinata', sniper: 'salute' };
const COLORS = ['#ff647c', '#ffb851', '#7fe0b8', '#64d4ef', '#bc91f5', '#f49fd6'];

const ROOM_PATH = '/api/rooms/' + ROOM;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const rand = (min, max) => min + Math.random() * (max - min);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const r3 = (n) => Math.round(n * 1000) / 1000;

// ------------------------------------------------------------ журнал ошибок

const anomalies = [];
const anomalyCounts = new Map();
const lastPrinted = new Map();
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

// ------------------------------------------------------------------- бот

class Bot {
  constructor(name, index) {
    this.name = '🤖 ' + name;
    this.index = index;
    this.cookie = '';
    this.id = '';
    this.color = COLORS[index % COLORS.length];
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
    // Своё состояние.
    this.pose = { x: 0, y: 0, z: 4 };
    this.yaw = 0;
    this.pitch = 0;
    this.stance = 'stand';
    this.moving = false;
    this.speed = 0;
    this.forward = 0;
    this.strafe = 0;
    this.hp = 100;
    this.life = 0;
    this.team = '';
    this.kills = 0;
    this.deaths = 0;
    this.shots = 0;
    this.hits = 0;
    // Движение.
    this.waypoints = [];
    this.waypointTeam = null;
    this.waypointIndex = 0;
    this.slideSign = index % 2 ? 1 : -1;
    this.strafeSign = index % 2 ? 1 : -1;
    this.strafeUntil = 0;
    this.stuckSince = 0;
    this.stuckFrom = { x: 0, z: 0 };
    this.jumpUntil = 0;
    this.stanceUntil = 0;
    // Оружие.
    this.tool = TOOLS[index % TOOLS.length];
    this.toolUntil = 0;
    this.roundsLeft = MAGAZINE;
    this.reloadUntil = 0;
    this.nextShotAt = 0;
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
        this.waypointTeam = null;
        this.graceUntil = Date.now() + 3000;
      }
      if (Number.isFinite(data.state.respawnSeconds)) this.respawnSeconds = data.state.respawnSeconds;
    }
    // Счёт до этого снимка: убийство и очко приходят вместе, сравнивать надо с прошлым.
    const before = this.match && this.match.score ? this.match.score.red + this.match.score.blue : null;
    if (data.match) this.match = data.match;
    if (Array.isArray(data.members)) {
      this.members = data.members;
      this.teams = data.members.some((m) => m.team);
    }
    if (Array.isArray(data.effects)) {
      for (const e of data.effects) {
        if (typeof e.at === 'number' && e.at > this.lastEffectAt) this.lastEffectAt = e.at;
        if (e.kind === 'kill') this.noteKill(e, before);
      }
    }
  }

  self() {
    return this.members.find((m) => m.id === this.id) || null;
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

  /** После точного попадания HP жертвы обязано упасть за DAMAGE_WAIT_MS. */
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

  // ---------------------------------------------------------- перемещение

  blocked(x, z, y, stance) {
    const b = this.map.bounds;
    const m = BODY_RADIUS + 0.25;
    if (x < b.minX + m || x > b.maxX - m || z < b.minZ + m || z > b.maxZ - m) return true;
    return isBlocked3D(x, z, y, BODY_RADIUS, stanceHeight(stance), this.map.colliders);
  }

  ensureWaypoints() {
    if (this.waypointTeam === this.team && this.waypoints.length) return;
    this.waypointTeam = this.team;
    const map = this.map;
    const b = map.bounds;
    const center = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
    const foe = this.team === 'red' ? 'blue' : 'red';
    const mine = this.team === 'blue' ? 'blue' : 'red';
    const list = [center];
    const spawnsOf = (team) => (map.spawns && map.spawns[team]) || [];
    // Сначала к центру карты, потом к чужой половине, потом обратно к своей.
    for (const p of spawnsOf(foe).slice(0, 3)) list.push({ x: p.x, z: p.z });
    list.push(center);
    for (const p of spawnsOf(mine).slice(0, 2)) list.push({ x: p.x, z: p.z });
    // Пара случайных точек патрулирования, чтобы боты не ходили одним маршрутом.
    for (let i = 0; i < 3; i++) {
      for (let attempt = 0; attempt < 40; attempt++) {
        const x = rand(b.minX + 2, b.maxX - 2);
        const z = rand(b.minZ + 2, b.maxZ - 2);
        if (this.blocked(x, z, map.groundHeight(x, z, 0), 'stand')) continue;
        list.push({ x, z });
        break;
      }
    }
    this.waypoints = list;
    this.waypointIndex = this.index % list.length;
  }

  nextWaypoint() {
    this.waypointIndex = (this.waypointIndex + 1) % Math.max(1, this.waypoints.length);
    this.stuckSince = 0;
  }

  /** Ближайший видимый живой враг. */
  enemy() {
    const me = this.self();
    if (!me) return null;
    const now = this.serverNow + (Date.now() - this.serverNowLocal);
    const origin = [this.pose.x, this.pose.y + EYE_HEIGHT, this.pose.z];
    let best = null;
    let bestDist = Infinity;
    for (const m of this.members) {
      if (m.id === this.id || m.hp <= 0) continue;
      if (m.lastSeen && m.lastSeen < now - ONLINE_MS) continue;
      if (this.team && m.team && m.team === this.team) continue;
      const pose = m.pose || {};
      const dist = Math.hypot(pose.x - this.pose.x, pose.z - this.pose.z);
      if (dist > ENGAGE_RANGE || dist >= bestDist) continue;
      const center = [pose.x, (pose.y || 0) + CHEST_HEIGHT, pose.z];
      const wall = rayCastWorldObstacle(origin, center, this.map.colliders);
      const reach = Math.hypot(center[0] - origin[0], center[1] - origin[1], center[2] - origin[2]);
      if (wall && wall.hit && wall.distance < reach - 0.35) continue;
      best = m;
      bestDist = dist;
    }
    return best ? { member: best, distance: bestDist } : null;
  }

  /** Считает следующую позу: цель боя или точка патрулирования, с обходом стен. */
  move(now, foe) {
    const dt = TICK_MS / 1000;
    if (this.hp <= 0) {
      this.moving = false;
      this.speed = 0;
      return;
    }
    this.ensureWaypoints();
    if (now > this.stanceUntil) {
      // Изредка приседаем: так стрелять по боту труднее.
      this.stance = Math.random() < 0.12 ? 'sit' : 'stand';
      this.stanceUntil = now + (this.stance === 'sit' ? rand(1200, 2600) : rand(2500, 7000));
    }
    if (now > this.strafeUntil) {
      this.strafeSign = Math.random() < 0.5 ? -1 : 1;
      this.strafeUntil = now + rand(1200, 3000);
    }
    if (now > this.jumpUntil + 900 && Math.random() < 0.006) this.jumpUntil = now + 620;

    let dirX = 0;
    let dirZ = 0;
    if (foe) {
      const p = foe.member.pose || {};
      const toX = p.x - this.pose.x;
      const toZ = p.z - this.pose.z;
      const len = Math.hypot(toX, toZ) || 1;
      const fx = toX / len;
      const fz = toZ / len;
      // Держим удобную дистанцию и кружим вокруг цели.
      const push = foe.distance > 13 ? 1 : foe.distance < 5 ? -1 : 0;
      dirX = fx * push - fz * this.strafeSign * 0.85;
      dirZ = fz * push + fx * this.strafeSign * 0.85;
      this.forward = push;
      this.strafe = -this.strafeSign;
      this.yaw = Math.atan2(-toX, -toZ);
      const dy = (p.y || 0) + CHEST_HEIGHT - (this.pose.y + EYE_HEIGHT);
      this.pitch = clamp(Math.atan2(dy, Math.max(0.5, foe.distance)), -1.35, 1.4);
    } else {
      const goal = this.waypoints[this.waypointIndex] || { x: 0, z: 0 };
      const toX = goal.x - this.pose.x;
      const toZ = goal.z - this.pose.z;
      const len = Math.hypot(toX, toZ);
      if (len < 1.5) {
        this.nextWaypoint();
        this.moving = false;
        this.speed = 0;
        return;
      }
      dirX = toX / len;
      dirZ = toZ / len;
      this.forward = 1;
      this.strafe = 0;
      this.yaw = Math.atan2(-toX, -toZ);
      this.pitch = 0;
    }
    const dirLen = Math.hypot(dirX, dirZ);
    if (dirLen < 1e-3) {
      this.moving = false;
      this.speed = 0;
      return;
    }
    dirX /= dirLen;
    dirZ /= dirLen;
    const speed = RUN_SPEED * (this.stance === 'sit' ? 0.45 : 1);
    const step = speed * dt;
    // «Скользящий» обход: если прямо — стена, пробуем повернуть шаг.
    const turns = [0, 0.45, -0.45, 0.95, -0.95, 1.57, -1.57, 2.4, -2.4];
    let moved = false;
    for (const turn of turns) {
      const a = turn * (turn ? this.slideSign : 1);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const nx = this.pose.x + (dirX * cos - dirZ * sin) * step;
      const nz = this.pose.z + (dirX * sin + dirZ * cos) * step;
      const ny = this.map.groundHeight(nx, nz, this.pose.y);
      if (this.blocked(nx, nz, ny, this.stance)) continue;
      this.pose.x = nx;
      this.pose.z = nz;
      this.pose.y = clamp(ny, 0, 10);
      moved = true;
      if (turn) this.slideSign = a > 0 ? 1 : -1;
      break;
    }
    if (!moved) {
      // Зажаты со всех сторон: меняем сторону обхода и цель.
      this.slideSign = -this.slideSign;
      this.nextWaypoint();
    }
    if (now < this.jumpUntil) {
      const k = 1 - (this.jumpUntil - now) / 620;
      this.pose.y = clamp(this.pose.y + Math.sin(Math.PI * k) * 0.9, 0, 10);
    }
    this.moving = moved;
    this.speed = moved ? speed : 0;
    // Если бот топчется на месте — идём к другой точке.
    if (Math.hypot(this.pose.x - this.stuckFrom.x, this.pose.z - this.stuckFrom.z) > 0.5) {
      this.stuckFrom = { x: this.pose.x, z: this.pose.z };
      this.stuckSince = now;
    } else if (!this.stuckSince) this.stuckSince = now;
    else if (now - this.stuckSince > 4000) {
      this.slideSign = -this.slideSign;
      this.nextWaypoint();
      this.stuckFrom = { x: this.pose.x, z: this.pose.z };
      this.stuckSince = now;
    }
  }

  // ------------------------------------------------------------ выстрелы

  async fire(now, foe) {
    if (this.hp <= 0 || !foe) return;
    if (now < this.reloadUntil || now < this.nextShotAt) return;
    if (now > this.toolUntil) {
      this.tool = pick(TOOLS);
      this.toolUntil = now + rand(15_000, 40_000);
    }
    const me = this.self();
    if (me && me.immuneRemaining > 0) return; // под защитой спавна выстрел отклонят
    const victim = foe.member;
    if (this.tool === 'sniper' && foe.distance < 3) return;
    const p = victim.pose || {};
    const origin = [this.pose.x, this.pose.y + EYE_HEIGHT, this.pose.z];
    const aim = [p.x, (p.y || 0) + CHEST_HEIGHT, p.z];
    // Иногда промахиваемся: смещаем точку прицеливания вбок и вверх.
    const miss = Math.random() < 0.32;
    const target = miss
      ? [aim[0] + rand(-2.2, 2.2), aim[1] + rand(-0.8, 1.4), aim[2] + rand(-2.2, 2.2)]
      : aim;
    const dx = target[0] - origin[0];
    const dy = target[1] - origin[1];
    const dz = target[2] - origin[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    const normal = [-dx / len, -dy / len, -dz / len];
    const effectId = crypto.randomUUID();
    // seenAt — серверное время мира, по позам которого мы целились: это время
    // последнего снимка. Дальше 250 мс сервер всё равно не отматывает.
    const serverNow = this.serverNow + (Date.now() - this.serverNowLocal);
    const seenAt = Math.round(clamp(this.serverNow, serverNow - 240, serverNow));
    const body = {
      type: 'effect',
      id: effectId,
      kind: this.tool,
      variant: TOOL_VARIANT[this.tool],
      origin: origin.map(r3),
      target: target.map(r3),
      normal: normal.map(r3),
      color: this.color,
      seenAt,
      ...(this.tool === 'sniper' ? { scoped: true, noScope: false } : {}),
    };
    const r = await this.post(body);
    this.nextShotAt = now + Math.max(rand(600, 1200), TOOL_COOLDOWN[this.tool] + 120);
    if (r.status !== 200 || !r.data || r.data.ok !== true) return;
    this.shots++;
    this.roundsLeft--;
    if (this.roundsLeft <= 0) {
      this.roundsLeft = MAGAZINE;
      this.reloadUntil = now + RELOAD_MS;
    }
    // Точный выстрел в упор по уязвимой цели обязан снять HP.
    const trackable =
      !miss && (this.tool === 'paint' || this.tool === 'sniper') && !victim.immuneRemaining;
    if (trackable)
      this.pendingHits.push({
        victim: victim.id,
        hpBefore: victim.hp,
        life: victim.life,
        tool: this.tool,
        distance: foe.distance,
        effectId,
        deadline: now + DAMAGE_WAIT_MS,
      });
  }

  // ----------------------------------------------------------------- цикл

  async tick() {
    const now = Date.now();
    const foe = this.enemy();
    this.move(now, foe);
    const sentLife = this.life;
    const sent = { x: this.pose.x, z: this.pose.z };
    const pose = {
      x: r3(this.pose.x),
      y: r3(this.pose.y),
      z: r3(this.pose.z),
      yaw: r3(this.yaw),
      stance: this.stance,
      moving: this.moving,
      speed: r3(this.speed),
      forward: this.forward,
      strafe: this.strafe,
      pitch: r3(this.pitch),
      tool: this.tool,
      variant: TOOL_VARIANT[this.tool],
      aiming: !!foe && this.tool === 'sniper',
      crouching: this.stance === 'sit',
      reload: now < this.reloadUntil ? clamp(1 - (this.reloadUntil - now) / RELOAD_MS, 0, 1) : 0,
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
        this.hp > 0 &&
        Date.now() > this.graceUntil
      )
        anomaly('move-refused', this, {
          sent: { x: r3(sent.x), z: r3(sent.z) },
          server: { x: r3(server.x), z: r3(server.z) },
          driftM: r3(drift),
          stance: this.stance,
        });
      // Дальше идём от позиции сервера — она главная.
      this.pose.x = server.x;
      this.pose.y = server.y;
      this.pose.z = server.z;
      if (lifeChanged) {
        this.graceUntil = Date.now() + 1500;
        this.waypointIndex = this.index % Math.max(1, this.waypoints.length);
        this.stuckSince = 0;
        this.roundsLeft = MAGAZINE;
        this.pendingHits = [];
      }
    }
    this.checkDamage();
    this.checkRespawn();
    this.checkScore();
    await this.fire(Date.now(), this.enemy());
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

function summary() {
  const latency = stats();
  console.log('\n=== Сводка ===');
  console.log('Комната: ' + BASE + ROOM_PATH + ' · карта: ' + (bots[0] ? bots[0].mapId : '—'));
  console.log('Время работы: ' + Math.round((Date.now() - startedAt) / 1000) + ' с');
  for (const bot of bots) {
    const own = percentile(bot.latency, 0.5);
    console.log(
      `${bot.name.padEnd(14)} команда ${(bot.team || '—').padEnd(5)} ` +
        `убийств ${String(bot.kills).padStart(3)} смертей ${String(bot.deaths).padStart(3)} ` +
        `выстрелов ${String(bot.shots).padStart(4)} подтверждённых попаданий ${String(bot.hits).padStart(4)} ` +
        `медиана ${own} мс`,
    );
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
      team: b.team,
      kills: b.kills,
      deaths: b.deaths,
      shots: b.shots,
      confirmedHits: b.hits,
      medianLatencyMs: percentile(b.latency, 0.5),
      p95LatencyMs: percentile(b.latency, 0.95),
    })),
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
    console.log(`  вошёл ${bot.name} (${bot.id.slice(0, 8)}…), карта ${bot.mapId}`);
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
