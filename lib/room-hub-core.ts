// Hot room state (poses, HP, shots, combat) kept in memory by the room's Durable Object.
// Pure functions only: the rules are the ones the D1 version enforced in app/api/rooms/[id]
// and db/combat.ts, so HTTP fallback and WebSocket clients see the same game.
import { memberWeapon } from './weapon-authority.ts';
import { BotBrain } from './bot-brain.ts';
import { BOT_PREFIX, isBotId, isBotLevel, MAX_BOTS, type BotSpec } from './bot-levels.ts';
import { isBlaster } from './weapon-definition.ts';
import type { ToolMagazine } from './tool-magazine.ts';
import {
  calculatePelletsHit,
  effectCooldown,
  effectDamage,
  effectStyle,
  hitZone,
  inHitRange,
  LIMB_DAMAGE_SCALE,
  SNIPER_LIMB_DAMAGE,
} from './game-items.ts';
import {
  ONLINE_MS,
  ROOM_MEMORY_MS,
  uid,
  type Person,
  type Pose,
  type RoomState,
  type WorldEffect,
} from './model.ts';
import { isBlocked3D, rayCastWorldObstacle } from './world-collision.ts';
import { getMap } from './maps/index.ts';
import { modeOf, type GameMode } from './maps/catalog.ts';
import {
  emergency,
  finishTask,
  gameActive,
  hearsVoice,
  enterVent,
  exitVent,
  fix,
  inVent,
  moveVent,
  sabotage,
  IMPOSTOR_DEFAULTS,
  IMPOSTOR_LIMITS,
  isGhost,
  kill,
  movementFrozen,
  newImpostorGame,
  report,
  startGame,
  startTask,
  stopGame,
  updateImpostor,
  visibleTo,
  vote,
  type ImpostorGame,
  type ImpostorResult,
  type ImpostorSettings,
} from './impostor.ts';
import type { ChatEntry } from './room-chat.ts';
import { stanceHeight, type Bounds, type GameMap, type SpawnPoint, type Team } from './maps/types.ts';

/** Effects older than this are neither resolved nor sent to clients. */
export const EFFECT_TTL_MS = 15_000;
/** Members unseen for longer than this cannot be hit. */
export { ONLINE_MS };
export const SPAWN_POSE: Pose = { x: 0, y: 0, z: 4, yaw: 0, stance: 'stand', moving: false };
/** Lag compensation: shots are checked against where victims were at most this long ago. */
export const MAX_REWIND_MS = 250;
/** Pose samples kept per member for rewinding. */
const TRACK_MS = 1000;
/** The fastest legal run is 4.8 m/s (world.tsx); the margin absorbs network jitter. */
const MOVE_SPEED = 4.8 * 1.5;
/** Movement allowance saved up while packets are delayed, m. */
const MOVE_BUDGET = 5;
/** Rounds mode: one round lasts this long, then the break before the next one. */
const ROUND_MS = 120_000;
const INTERMISSION_MS = 6_000;
/** Подготовка в начале раунда: никто не двигается, не стреляет и не получает урон. */
const FREEZE_MS = 5_000;
/** How long the result stays on screen before the next match starts. */
const ENDED_MS = 12_000;
/** Server-side body radius: below the client's 0.32 so rounded poses near walls still pass. */
const BODY_RADIUS = 0.25;
const EFFECT_KINDS = ['paint', 'confetti', 'grenade', 'sniper', 'like'];
const TOOLS = ['paint', 'confetti', 'grenade', 'sniper', 'pointer', 'flashlight', 'other'];

export type Cursor = { x: number; y: number; mode: 'board' | '3d' };
export type HubMember = {
  weapon?: { life: number; magazine: ToolMagazine; revision: number };
  id: string;
  name: string;
  color: string;
  mood: string;
  hat: string;
  seen: number;
  pose: Pose;
  ping: number;
  cursor: Cursor | null;
  hp: number;
  respawnAt: number;
  /** -1: spawn protection until the first movement. */
  immuneUntil: number;
  life: number;
  kills: number;
  deaths: number;
  assists: number;
  recentDamage: Record<string, number>;
  lastShot: number;
  /** Recent poses of the current life, oldest first, for lag compensation. */
  track: { at: number; pose: Pose }[];
  moveBudget: number;
  riseBudget?: number;
  /** Changes only when the server corrects a rejected position. */
  positionRevision?: number;
  lastMoveAt: number;
  /** Start of the current run of refused moves (0: none). */
  refusedSince: number;
  /** Where the current life started; the first step away ends spawn protection. */
  spawn: { x: number; z: number };
  /** Team in a team battle; empty in free-for-all. */
  team: Team | '';
  /** Когда участник писал в чат последние секунды (lib/room-chat.ts): защита от флуда. */
  chatTimes?: number[];
};
export type HubEffect = WorldEffect & {
  resolveAt: number;
  applied: boolean;
  /** Server time whose victim poses the hit is checked against. */
  rewindTo: number;
  /** Monotonic per hub; lets the tick send only effects added since the previous tick. */
  seq: number;
};
export type HubRoom = {
  host: string;
  anonymous: boolean;
  respawnSeconds: number;
  /** Щит возрождения, секунд после первого шага со спавна; 0 — щита нет. */
  shieldSeconds: number;
  /** Голосовой чат разрешён в комнате; выключенный ведущим глушит всех сразу. */
  voiceEnabled: boolean;
  /** Кого ведущий заглушил: их голос не идёт дальше сервера. */
  voiceMuted: Set<string>;
  /** Серверные боты комнаты (lib/bot-brain.ts); их участники живут только здесь, не в D1. */
  bots: BotSpec[];
  archived: boolean;
  /** Map id (lib/maps). */
  map: string;
  /** Режим комнаты (lib/maps/catalog.ts). */
  mode: GameMode;
  /** Настройки режима «Предатель» (lib/impostor.ts). */
  impostor: ImpostorSettings;
  /** Team battle: on for battle maps, off for the hub. */
  teams: boolean;
  friendlyFire: boolean;
  friendlyFirePercent: number;
  matchMode: 'deathmatch' | 'rounds';
  killLimit: number;
  matchMinutes: number;
  roundWins: number;
};
/** 'freeze' — подготовка в начале раунда: стоим на спавне, оружие молчит. */
export type MatchPhase = 'freeze' | 'live' | 'intermission' | 'ended';
export type HubMatch = {
  mode: 'deathmatch' | 'rounds';
  score: { red: number; blue: number };
  round: number;
  phase: MatchPhase;
  /** When the current phase ends (0: no timer). */
  until: number;
  winner?: Team | 'draw';
  /** Выигранные матчи за игру: переживают новый матч, обнуляются со сменой карты или режима. */
  wins: { red: number; blue: number };
};
export type HubState = {
  room: HubRoom;
  members: Map<string, HubMember>;
  effects: HubEffect[];
  seq: number;
  match: HubMatch;
  /** Партия режима «Предатель»; в других режимах стоит в лобби. */
  impostor: ImpostorGame;
  /** Открыт ли у участника сокет (ставит объект комнаты; в checkpoint не входит). */
  connected?: (id: string) => boolean;
  /** Последние сообщения текстового чата (lib/room-chat.ts); в checkpoint не входят. */
  chat?: ChatEntry[];
};

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const isVec3 = (p: unknown): p is number[] =>
  Array.isArray(p) && p.length === 3 && p.every((n) => finite(n) && Math.abs(n) < 200);
/**
 * Щит держит урон. Выключенный в настройках щит снимается сразу со всех, даже с
 * тех, кто получил его до выключения и с тех пор не двигался: иначе после
 * «выключить щит» по комнате ещё бегали бы неуязвимые.
 */
const isImmune = (state: HubState, m: HubMember, now: number) =>
  state.room.shieldSeconds > 0 && (m.immuneUntil === -1 || m.immuneUntil > now);
/**
 * Выдать щит на новую жизнь. `-1` — «держится до первого шага», и только шаг
 * переводит его в обратный отсчёт (см. applyPresence). При выключенном щите
 * (0 секунд) новая жизнь начинается без неуязвимости вообще.
 */
const armShield = (state: HubState, m: HubMember) => {
  m.immuneUntil = state.room.shieldSeconds > 0 ? -1 : 0;
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return (JSON.parse(value) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function roomFromState(host: string, state: Partial<RoomState>): HubRoom {
  return {
    host,
    anonymous: !!state.anonymousPlayers,
    respawnSeconds: state.respawnSeconds ?? 5,
    // В «Предателе» не стреляют и не возрождаются: щита нет ни у кого.
    shieldSeconds: modeOf(state) === 'impostor' ? 0 : clamp(state.shieldSeconds ?? 5, 0, 30),
    voiceEnabled: state.voiceEnabled !== false,
    voiceMuted: new Set(Array.isArray(state.voiceMuted) ? state.voiceMuted : []),
    // Боты — участники боя и «Предателя»: в ретроспективе сервер их не выпускает.
    bots: ((modeOf(state) === 'battle' || modeOf(state) === 'impostor') && Array.isArray(state.bots) ? state.bots : [])
      .filter((b) => b && isBotId(b.id) && isBotLevel(b.level))
      .slice(0, MAX_BOTS)
      .map((b) => ({
        id: b.id,
        name: String(b.name || 'Бот').slice(0, 40),
        level: b.level,
        team: b.team === 'red' || b.team === 'blue' ? b.team : '',
      })),
    archived: !!state.archived,
    map: getMap(state.map).id,
    mode: modeOf(state),
    impostor: impostorSettings(state.impostor),
    // Teams belong to the battle mode; a retrospective is free-for-all.
    teams: modeOf(state) === 'battle',
    friendlyFire: !!state.friendlyFire,
    friendlyFirePercent: clamp(state.friendlyFirePercent ?? 50, 0, 100),
    matchMode: state.matchMode === 'rounds' ? 'rounds' : 'deathmatch',
    killLimit: clamp(state.killLimit ?? 30, 0, 200),
    matchMinutes: clamp(state.matchMinutes ?? 10, 0, 60),
    roundWins: clamp(state.roundWins ?? 5, 1, 15),
  };
}

/** Настройки режима «Предатель» из состояния комнаты: неизвестное — по умолчанию, числа — в пределах. */
export function impostorSettings(raw: unknown): ImpostorSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: ImpostorSettings = { ...IMPOSTOR_DEFAULTS };
  for (const [key, [min, max]] of Object.entries(IMPOSTOR_LIMITS) as [keyof typeof IMPOSTOR_LIMITS, readonly [number, number]][]) {
    const value = src[key];
    if (finite(value)) out[key] = clamp(Math.round(value), min, max);
  }
  if (typeof src.confirmEjects === 'boolean') out.confirmEjects = src.confirmEjects;
  return out;
}

/** A `members` row from D1 (snake_case columns) as a hub member. */
export function memberFromRow(row: Record<string, unknown>): HubMember {
  const cursor = parseJson<Partial<Cursor> | null>(row.cursor, null);
  const num = (v: unknown, fallback = 0) => (v == null || !Number.isFinite(Number(v)) ? fallback : Number(v));
  const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
  return {
    id: str(row.session),
    name: str(row.name),
    color: str(row.color, '#368c78'),
    mood: str(row.mood),
    hat: str(row.hat),
    seen: num(row.seen),
    pose: parseJson<Pose>(row.pose, { ...SPAWN_POSE }),
    ping: num(row.ping),
    cursor: cursor && finite(cursor.x) && finite(cursor.y) ? (cursor as Cursor) : null,
    hp: num(row.hp, 100),
    respawnAt: num(row.respawn_at),
    immuneUntil: num(row.immune_until),
    life: num(row.life),
    kills: num(row.kills),
    deaths: num(row.deaths),
    assists: num(row.assists),
    recentDamage: parseJson<Record<string, number>>(row.recent_damage, {}),
    lastShot: num(row.last_shot),
    track: [],
    moveBudget: MOVE_BUDGET,
    riseBudget: 1.5,
    positionRevision: 0,
    lastMoveAt: 0,
    refusedSince: 0,
    spawn: { x: SPAWN_POSE.x, z: SPAWN_POSE.z },
    team: row.team === 'red' || row.team === 'blue' ? row.team : '',
  };
}

export function sanitizeCursor(cursor: unknown): Cursor | null {
  const c = cursor as Partial<Cursor> | null;
  if (!c || !finite(c.x) || !finite(c.y)) return null;
  return {
    x: clamp(c.x, 0, 1540),
    y: clamp(c.y, 0, 1630),
    mode: c.mode === 'board' ? 'board' : '3d',
  };
}

/** The hub's extent; used when a pose arrives without a map to measure it against. */
const DEFAULT_BOUNDS: Bounds = { minX: -36, maxX: 36, minZ: -36, maxZ: 36 };

export function sanitizePose(pose: unknown, bounds: Bounds = DEFAULT_BOUNDS): Pose | null {
  const p = pose as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || ![p.x, p.y, p.z, p.yaw].every(finite)) return null;
  return {
    x: clamp(p.x as number, bounds.minX, bounds.maxX),
    y: clamp(p.y as number, 0, 10),
    z: clamp(p.z as number, bounds.minZ, bounds.maxZ),
    yaw: p.yaw as number,
    stance: p.stance === 'sit' || p.stance === 'lie' ? p.stance : 'stand',
    moving: !!p.moving,
    speed: finite(p.speed) ? clamp(p.speed, 0, 6.5) : p.moving ? 3.4 : 0,
    strafe: finite(p.strafe) ? clamp(p.strafe, -1, 1) : 0,
    forward: finite(p.forward) ? clamp(p.forward, -1, 1) : 0,
    pitch: finite(p.pitch) ? clamp(p.pitch, -1.35, 1.4) : 0,
    tool: TOOLS.includes(p.tool as string) ? (p.tool as string) : 'other',
    variant: effectStyle(p.tool as string, p.variant),
    working: !!p.working,
    crouching: !!p.crouching,
    aiming: !!p.aiming,
    reload: finite(p.reload) ? clamp(p.reload, 0, 1) : 0,
    light: !!p.light,
  };
}

const blockedAt = (map: GameMap, p: Pose) =>
  isBlocked3D(p.x, p.z, p.y, BODY_RADIUS, stanceHeight(p.stance), map.colliders);

/** A move is legal within the saved-up allowance, outside walls and not through them. */
function moveAllowed(map: GameMap, from: Pose, to: Pose, step: number, budget: number) {
  if (step > budget || blockedAt(map, to)) return false;
  // Low enough to pass under a crawl hole's lintel, high enough to clear kerbs.
  const h = Math.min(0.9, stanceHeight(to.stance) / 2);
  const wall = rayCastWorldObstacle([from.x, from.y + h, from.z], [to.x, to.y + h, to.z], map.colliders);
  return !wall?.hit;
}

function recordPose(m: HubMember, now: number) {
  m.track.push({ at: now, pose: m.pose });
  while (m.track.length > 64 || m.track[0].at < now - TRACK_MS) m.track.shift();
}

/** Where the member was at server time `t` (linear between samples); the current pose if later. */
export function poseAt(m: HubMember, t: number): Pose {
  const track = m.track;
  const last = track[track.length - 1];
  if (!last || t >= last.at) return m.pose;
  let i = track.length - 1;
  while (i > 0 && track[i - 1].at > t) i--;
  const b = track[i];
  if (i === 0) return b.pose;
  const a = track[i - 1];
  const k = (t - a.at) / Math.max(1, b.at - a.at);
  return {
    ...(k < 0.5 ? a.pose : b.pose),
    x: a.pose.x + (b.pose.x - a.pose.x) * k,
    y: a.pose.y + (b.pose.y - a.pose.y) * k,
    z: a.pose.z + (b.pose.z - a.pose.z) * k,
  };
}

/**
 * Presence packet: marks the member online and takes the pose unless they are dead or the
 * packet belongs to a previous life (sent before a respawn reached the client). Positions
 * that move faster than a run allows, end inside a wall or pass through one are refused
 * (look direction is kept). Repeated refusals never grant a teleport; clients reconcile
 * using positionRevision from both HTTP and WebSocket snapshots.
 */
export function applyPresence(
  m: HubMember,
  op: { pose?: unknown; cursor?: unknown; ping?: unknown; life?: unknown },
  now: number,
  map: GameMap = getMap('hub'),
  /** Подготовка раунда: поворот и стойка принимаются, шаги — нет. */
  frozen = false,
  /** Длительность щита возрождения, мс; 0 — щит выключен в настройках комнаты. */
  shieldMs = 5000,
  /** Призрак режима «Предатель»: скорость проверяется, стены — нет. */
  ghost = false,
) {
  const pose = sanitizePose(op.pose, map.bounds);
  const cursor = sanitizeCursor(op.cursor);
  const life = Number.isInteger(op.life) ? (op.life as number) : 0;
  m.seen = now;
  m.ping = finite(op.ping) ? clamp(Math.round(op.ping), 0, 60000) : 0;
  if (cursor) m.cursor = cursor;
  if (!pose || m.hp <= 0 || m.life !== life) return;
  if (frozen) {
    const from = m.pose;
    if (Math.hypot(pose.x - from.x, pose.y - from.y, pose.z - from.z) > 0.02)
      m.positionRevision = (m.positionRevision ?? 0) + 1;
    m.pose = { ...pose, x: from.x, y: from.y, z: from.z, moving: false };
    m.lastMoveAt = now;
    recordPose(m, now);
    return;
  }
  const dt = m.lastMoveAt ? Math.max(0, now - m.lastMoveAt) / 1000 : Infinity;
  m.lastMoveAt = now;
  m.moveBudget = Math.min(MOVE_BUDGET, m.moveBudget + MOVE_SPEED * dt);
  const from = m.pose;
  const step = Math.hypot(pose.x - from.x, pose.z - from.z);
  // Separate upward allowance: jumping cannot be used to bypass horizontal checks.
  // At most one jump's height can be saved up, even after a long idle period.
  m.riseBudget = Math.min(1.5, (m.riseBudget ?? 1.5) + 6.5 * dt);
  const rise = pose.y - from.y;
  const verticalAllowed = rise <= m.riseBudget && -rise <= 1.5 + 26 * Math.min(dt, 0.5);
  const allowed = ghost ? step <= m.moveBudget : moveAllowed(map, from, pose, step, m.moveBudget);
  if (!verticalAllowed || !allowed) {
    if (!m.refusedSince) m.refusedSince = now;
    m.positionRevision = (m.positionRevision ?? 0) + 1;
    const stance = blockedAt(map, { ...from, stance: pose.stance }) ? from.stance : pose.stance;
    m.pose = { ...pose, x: from.x, y: from.y, z: from.z, stance, moving: false };
    recordPose(m, now);
    return;
  }
  m.riseBudget = Math.max(0, m.riseBudget - Math.max(0, rise));
  m.refusedSince = 0;
  m.moveBudget = Math.max(0, m.moveBudget - step);
  m.pose = pose;
  recordPose(m, now);
  // Spawn protection lasts until the first move, then the room's few seconds more.
  if (m.immuneUntil === -1 && (pose.moving || Math.hypot(pose.x - m.spawn.x, pose.z - m.spawn.z) > 0.45))
    m.immuneUntil = shieldMs > 0 ? now + shieldMs : 0;
}

/** Пакет присутствия с правилами комнаты: карта, заморозка, щит и призраки. */
export function presence(
  state: HubState,
  m: HubMember,
  op: { pose?: unknown; cursor?: unknown; ping?: unknown; life?: unknown },
  now: number,
) {
  const impostor = state.room.mode === 'impostor';
  const ghost = impostor && isGhost(state.impostor, m.id);
  // В вентиляции игрок стоит на месте решётки: поворот принимается, шаги — нет.
  const frozen = isFrozen(state, now) || (impostor && inVent(state.impostor, m.id));
  applyPresence(m, op, now, getMap(state.room.map), frozen, state.room.shieldSeconds * 1000, ghost);
}

export type FireResult = {
  ok: boolean;
  reason?: 'respawning' | 'immune' | 'freeze' | 'cooldown' | 'magazine' | 'stale-life' | 'duplicate' | 'mode';
  effect?: HubEffect;
};

/** Validates a shot and queues it; damage is dealt by `resolveCombat`. Throws on malformed input. */
export function fireEffect(
  state: HubState,
  self: string,
  op: Record<string, unknown>,
  now: number,
): FireResult {
  if (state.room.archived) return { ok: false };
  const kind = op.kind as WorldEffect['kind'];
  if (!EFFECT_KINDS.includes(kind)) throw Error('Неизвестный эффект');
  const { origin, target, normal } = op;
  if (!isVec3(origin) || !isVec3(target) || !isVec3(normal)) throw Error('Некорректная траектория');
  if (typeof op.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(op.color))
    throw Error('Некорректный цвет');
  // В «Предателе» оружия нет: убивает только нож предателя (lib/impostor.ts).
  if (state.room.mode === 'impostor') return { ok: false, reason: 'mode' };
  if (isFrozen(state, now)) return { ok: false, reason: 'freeze' };
  const shooter = state.members.get(self);
  if (!shooter || shooter.hp <= 0) return { ok: false, reason: 'respawning' };
  if (op.life !== undefined && op.life !== shooter.life) return { ok: false, reason: 'stale-life' };
  if (isImmune(state, shooter, now)) return { ok: false, reason: 'immune' };
  if (
    Math.hypot(origin[0] - shooter.pose.x, origin[1] - shooter.pose.y, origin[2] - shooter.pose.z) > 9 ||
    Math.hypot(target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]) > 75
  )
    throw Error('Предмет слишком далеко');
  const id = typeof op.id === 'string' && /^[a-f0-9-]{36}$/.test(op.id) ? op.id : uid();
  if (state.effects.some((e) => e.id === id)) return { ok: false, reason: 'duplicate' };
  if (shooter.lastShot > now - effectCooldown(kind)) return { ok: false, reason: 'cooldown' };
  if (isBlaster(kind) && !memberWeapon(shooter).magazine.fire(kind, now))
    return { ok: false, reason: 'magazine' };
  const effect: HubEffect = {
    id,
    kind,
    variant: effectStyle(kind, op.variant),
    origin,
    target,
    normal,
    color: op.color,
    scoped: typeof op.scoped === 'boolean' ? op.scoped : undefined,
    noScope: typeof op.noScope === 'boolean' ? op.noScope : undefined,
    pelletsHit: typeof op.pelletsHit === 'number' ? op.pelletsHit : undefined,
    author: self,
    at: now,
    resolveAt: now + (kind === 'grenade' ? 1100 : 0),
    applied: false,
    // A grenade explodes later in server time; other shots hit what the shooter saw.
    rewindTo:
      kind === 'grenade' || !finite(op.seenAt) ? now : clamp(op.seenAt, now - MAX_REWIND_MS, now),
    seq: ++state.seq,
  };
  state.effects.push(effect);
  shooter.lastShot = now;
  return { ok: true, effect };
}

/** The team's spawn point farthest from the living rivals (both lists in free-for-all). */
export function chooseSpawn(
  state: HubState,
  map: GameMap,
  self: string,
  now: number,
  team: Team | '' = '',
): SpawnPoint {
  const points = state.room.teams && team ? map.spawns[team] : [...map.spawns.red, ...map.spawns.blue];
  const living = [...state.members.values()].filter(
    (o) => o.id !== self && o.hp > 0 && o.seen > now - ONLINE_MS,
  );
  const rivals = living.filter((o) => !(state.room.teams && team && o.team === team));
  // Never stack two players on one point while another is free.
  const free = points.filter(
    (p) => !living.some((o) => Math.hypot(o.pose.x - p.x, o.pose.z - p.z) < 2),
  );
  const list = free.length ? free : points;
  let best = list[0],
    bestScore = -1;
  for (const p of list) {
    const score = rivals.length
      ? Math.min(...rivals.map((o) => Math.hypot(o.pose.x - p.x, o.pose.z - p.z)))
      : 0;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

function placeAt(m: HubMember, spawn: SpawnPoint) {
  m.pose = { ...SPAWN_POSE, x: spawn.x, y: spawn.y ?? 0, z: spawn.z, yaw: spawn.yaw ?? 0 };
  m.spawn = { x: spawn.x, z: spawn.z };
  m.track = [];
  m.moveBudget = MOVE_BUDGET;
  m.riseBudget = 1.5;
  m.refusedSince = 0;
}

/** Moves a member standing outside the room's map or inside one of its walls to a spawn point. */
export function placeIfInvalid(state: HubState, m: HubMember, now: number) {
  const map = getMap(state.room.map),
    b = map.bounds,
    p = m.pose;
  if (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && !blockedAt(map, p)) return false;
  placeAt(m, chooseSpawn(state, map, m.id, now, m.team));
  return true;
}

/**
 * Puts a member without a team into the smaller one and onto that team's spawn (they may
 * be standing wherever the previous map or the hub left them). Returns whether it did.
 */
export function balanceTeam(state: HubState, m: HubMember, now: number) {
  if (!state.room.teams || m.team) return false;
  let red = 0,
    blue = 0;
  for (const o of state.members.values()) {
    if (o.id === m.id) continue;
    if (o.team === 'red') red++;
    else if (o.team === 'blue') blue++;
  }
  m.team = red <= blue ? 'red' : 'blue';
  placeAt(m, chooseSpawn(state, getMap(state.room.map), m.id, now, m.team));
  return true;
}

/**
 * Переход в другую команду. В бою он платный: иначе выгодно перебегать к тем, кто
 * выигрывает, — поэтому боец гибнет и отдаёт одно очко убийства. Очко уходит в минус
 * осознанно: при нуле штраф иначе ничего не стоил бы и переход был бы бесплатным.
 *
 * Крайние случаи:
 *  - та же сторона — не изменение, выходим до штрафа;
 *  - уже мёртв — второй раз не убиваем и таймер возрождения не продлеваем (он и так
 *    его отсиживает), но очко снимаем: иначе достаточно дождаться смерти и перейти даром;
 *  - стороны ещё не было — это первое назначение, а не побег из команды: бесплатно;
 *  - вне боя (ретро-комната, `teams` выключен) команд и счёта нет — просто переставляем.
 *
 * Платит тот, кого переводят, — и когда сторону меняет он сам, и когда его двигает
 * ведущий: иначе «попроси ведущего перевести» было бы бесплатным обходом правила.
 *
 * На спавн новой стороны бойца поставит обычное возрождение (`revive`/`respawnAll`),
 * которое уже читает `m.team`; так смена стороны идёт по существующим правилам режима —
 * в раундах мёртвый ждёт конца раунда, в бою с возрождением — свои секунды.
 */
export function setTeam(state: HubState, self: string, team: Team, now: number) {
  const m = state.members.get(self);
  if (!m || m.team === team) return false;
  const previous = m.team;
  m.team = team;
  m.recentDamage = {};
  if (!state.room.teams || !previous) {
    m.life += 1;
    m.hp = 100;
    m.respawnAt = 0;
    armShield(state, m);
    placeAt(m, chooseSpawn(state, getMap(state.room.map), m.id, now, team));
    return true;
  }
  m.kills -= 1;
  if (m.hp > 0) {
    m.hp = 0;
    m.respawnAt = now + state.room.respawnSeconds * 1000;
  }
  return true;
}

export function newMatch(room: HubRoom, now: number, wins = { red: 0, blue: 0 }): HubMatch {
  // Раунды начинаются с подготовки; в бою с возрождением ждать нечего.
  const rounds = room.matchMode === 'rounds';
  return {
    mode: room.matchMode,
    score: { red: 0, blue: 0 },
    wins: { ...wins },
    round: 1,
    phase: rounds ? 'freeze' : 'live',
    until: rounds
      ? now + FREEZE_MS
      : room.matchMinutes > 0
        ? now + room.matchMinutes * 60_000
        : 0,
  };
}

/** Идёт подготовка раунда или собрание «Предателя»: движение, выстрелы и урон отключены. */
export function isFrozen(state: HubState, now: number) {
  const m = state.match;
  if (state.room.mode === 'impostor') return movementFrozen(state.impostor);
  return (
    state.room.teams &&
    m.mode === 'rounds' &&
    m.phase === 'freeze' &&
    m.until > 0 &&
    now < m.until
  );
}

/** Everyone starts a new life at their team's spawn (new round, new match, new map). */
export function respawnAll(state: HubState, now: number) {
  const map = getMap(state.room.map);
  for (const m of state.members.values()) {
    m.life += 1;
    m.hp = 100;
    m.respawnAt = 0;
    armShield(state, m);
    m.recentDamage = {};
    placeAt(m, chooseSpawn(state, map, m.id, now, m.team));
  }
}

function endMatch(state: HubState, now: number) {
  const match = state.match;
  match.phase = 'ended';
  match.winner =
    match.score.red === match.score.blue ? 'draw' : match.score.red > match.score.blue ? 'red' : 'blue';
  if (match.winner !== 'draw') match.wins[match.winner] += 1;
  match.until = now + ENDED_MS;
}

/**
 * Runs the match clock: ends a deathmatch on the kill limit or the time, ends a round when
 * one side is wiped out or its time runs out, and starts the next round or match after the
 * break. Free-for-all rooms (the hub) have no match.
 */
export function updateMatch(state: HubState, now: number) {
  const room = state.room,
    match = state.match;
  if (!room.teams) return false;
  if (match.mode !== room.matchMode) {
    state.match = newMatch(room, now);
    respawnAll(state, now);
    return true;
  }
  if (match.phase === 'live' && room.matchMode === 'rounds') {
    const alive = { red: 0, blue: 0 };
    for (const m of state.members.values())
      if (m.team && m.hp > 0 && m.seen > now - ONLINE_MS) alive[m.team] += 1;
    const wiped = (alive.red === 0) !== (alive.blue === 0);
    if (!wiped && !(match.until > 0 && now >= match.until)) return false;
    const winner: Team | 'draw' =
      alive.red === alive.blue ? 'draw' : alive.red > alive.blue ? 'red' : 'blue';
    if (winner !== 'draw') match.score[winner] += 1;
    if (match.score.red >= room.roundWins || match.score.blue >= room.roundWins) endMatch(state, now);
    else {
      match.phase = 'intermission';
      match.until = now + INTERMISSION_MS;
    }
    return true;
  }
  if (match.phase === 'live') {
    const limit = room.killLimit > 0 && (match.score.red >= room.killLimit || match.score.blue >= room.killLimit);
    if (!limit && !(match.until > 0 && now >= match.until)) return false;
    endMatch(state, now);
    return true;
  }
  if (match.until === 0 || now < match.until) return false;
  if (match.phase === 'freeze') {
    // Подготовка кончилась — раунд пошёл, все уже стоят на своих спавнах.
    match.phase = 'live';
    match.until = now + ROUND_MS;
    return true;
  }
  if (match.phase === 'intermission') {
    match.round += 1;
    match.phase = 'freeze';
    match.until = now + FREEZE_MS;
  } else {
    state.match = newMatch(room, now, match.wins);
  }
  respawnAll(state, now);
  return true;
}

/**
 * The host switched maps (state.room.map already holds the new one): everyone starts a new
 * life on a spawn point of it. Clients teleport when they see their life change.
 */
export function changeMap(state: HubState, now: number) {
  state.effects = [];
  state.impostor = { ...newImpostorGame(), game: state.impostor.game };
  state.match = newMatch(state.room, now);
  for (const m of state.members.values()) {
    m.kills = 0;
    m.deaths = 0;
    m.assists = 0;
    if (state.room.teams) balanceTeam(state, m, now);
    else m.team = '';
  }
  respawnAll(state, now);
}

function revive(state: HubState, now: number) {
  let changed = false;
  // In rounds mode the dead wait for the next round.
  if (state.room.teams && state.room.matchMode === 'rounds') return changed;
  for (const m of state.members.values()) {
    if (m.hp !== 0 || m.respawnAt <= 0 || m.respawnAt > now) continue;
    m.hp = 100;
    m.respawnAt = 0;
    m.life += 1;
    armShield(state, m);
    m.recentDamage = {};
    placeAt(m, chooseSpawn(state, getMap(state.room.map), m.id, now, m.team));
    changed = true;
  }
  return changed;
}

function applyHits(state: HubState, e: HubEffect, now: number) {
  const colliders = getMap(state.room.map).colliders;
  const origin = e.origin || [0, 0, 0];
  const target = e.target || [0, 0, 0];
  const author = state.members.get(e.author);
  const authorImmune = !!author && isImmune(state, author, now);
  for (const p of state.members.values()) {
    if (p.id === e.author || p.hp <= 0 || p.seen <= now - ONLINE_MS) continue;
    const pose = poseAt(p, e.rewindTo);
    const hit =
      e.kind === 'confetti'
        ? calculatePelletsHit(origin, target, pose, 8, colliders).pelletsHit > 0
        : inHitRange(e.kind, origin, target, pose, colliders);
    // After a respawn a player can neither take nor deal damage.
    if (!hit || authorImmune || isImmune(state, p, now)) continue;
    // Безвредное (лайк) не ранит и не убивает даже попаданием в голову.
    if (e.kind !== 'confetti' && effectDamage(e.kind) <= 0) continue;
    // Взрыв гранаты накрывает целиком, у остального оружия урон зависит от зоны попадания:
    // голова — сразу насмерть, туловище — полный урон, руки и ноги — ослабленный.
    const zone = e.kind === 'grenade' ? 'torso' : hitZone(origin, target, pose);
    const head = zone === 'head';
    let damage: number;
    let pelletsHit: number | undefined;
    if (e.kind === 'confetti') {
      const pellets = calculatePelletsHit(origin, target, pose, 8, colliders);
      pelletsHit = pellets.pelletsHit;
      damage = head
        ? 100
        : zone === 'limb'
          ? Math.round(pellets.damage * LIMB_DAMAGE_SCALE)
          : pellets.damage;
    } else if (head) {
      damage = 100;
    } else if (e.kind === 'sniper') {
      // Снайперка убивает с одного выстрела в голову и в туловище, по конечностям — ранит.
      damage = zone === 'limb' ? SNIPER_LIMB_DAMAGE : 100;
    } else {
      const distance = Math.hypot(target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]);
      damage = effectDamage(e.kind, distance);
      if (zone === 'limb') damage = Math.round(damage * LIMB_DAMAGE_SCALE);
    }
    // Teammates take no damage, or the share the host allows.
    const friendly = !!(state.room.teams && author && p.team && author.team === p.team);
    if (friendly) damage = Math.round(damage * (state.room.friendlyFire ? state.room.friendlyFirePercent / 100 : 0));
    if (damage <= 0) continue;
    if (p.hp > damage) {
      p.hp = Math.max(0, p.hp - damage);
      p.recentDamage[e.author] = now;
      continue;
    }
    let assister: string | undefined;
    let latest = 0;
    for (const [attacker, time] of Object.entries(p.recentDamage)) {
      if (attacker !== e.author && typeof time === 'number' && now - time <= 15000 && time > latest) {
        latest = time;
        assister = attacker;
      }
    }
    const assisterMember = assister ? state.members.get(assister) : undefined;
    p.hp = 0;
    p.respawnAt = now + state.room.respawnSeconds * 1000;
    p.deaths += 1;
    p.recentDamage = {};
    // A team kill earns nothing; a proper kill scores for the shooter's team.
    if (author && !friendly) {
      author.kills += 1;
      // In rounds mode the score counts rounds won, not kills.
      if (state.room.teams && author.team && state.room.matchMode === 'deathmatch')
        state.match.score[author.team] += 1;
    }
    if (assisterMember && !friendly) assisterMember.assists += 1;
    state.effects.push({
      id: uid(),
      kind: 'kill',
      killer: e.author,
      killerName: author?.name || 'Игрок',
      victim: p.id,
      victimName: p.name || 'Игрок',
      assister,
      assisterName: assisterMember?.name,
      color: author?.color || '#ff647c',
      tool: e.kind,
      headshot: head,
      teamkill: friendly || undefined,
      scoped: e.scoped,
      noScope: e.kind === 'sniper' && (e.noScope ?? !e.scoped),
      pelletsHit,
      author: e.author,
      at: now,
      resolveAt: 0,
      applied: true,
      rewindTo: 0,
      seq: ++state.seq,
    });
  }
}

/**
 * Revives members whose respawn time came, drops expired effects and deals damage for every
 * effect whose fuse ran out. Each effect is resolved exactly once. Returns whether anything changed.
 */
export function resolveCombat(state: HubState, now: number) {
  let changed = updateMatch(state, now);
  changed = updateImpostor(state, now, (id, seat) => seatMember(state, id, seat)) || changed;
  changed = revive(state, now) || changed;
  const before = state.effects.length;
  state.effects = state.effects.filter((e) => e.at > now - EFFECT_TTL_MS);
  if (state.effects.length !== before) changed = true;
  // Kill effects appended during the loop are already applied, so iterating the growing array is safe.
  for (let i = 0; i < state.effects.length; i++) {
    const e = state.effects[i];
    if (e.applied || e.resolveAt <= 0 || e.resolveAt > now) continue;
    e.applied = true;
    changed = true;
    applyHits(state, e, now);
  }
  return changed;
}

/** Up to 80 newest effects after `since` (never older than the TTL), newest first. */
export function effectsSince(state: HubState, now: number, since?: number | null) {
  const min = finite(since) && since > 0 ? Math.max(now - EFFECT_TTL_MS, since) : now - EFFECT_TTL_MS;
  return state.effects
    .filter((e) => e.at > min)
    .sort((a, b) => b.at - a.at)
    .slice(0, 80);
}

export function publicEffects(effects: HubEffect[], anonymous: boolean): WorldEffect[] {
  return effects.map((e) => {
    const out: WorldEffect & Partial<HubEffect> = { ...e };
    delete out.resolveAt;
    delete out.applied;
    delete out.rewindTo;
    delete out.seq;
    if (anonymous && out.kind === 'kill') {
      out.killerName = 'Участник';
      out.victimName = 'Участник';
      if (out.assisterName) out.assisterName = 'Участник';
    }
    return out;
  });
}

/**
 * Кому уходит голос и отметка «говорит».
 *
 * Правило одно и для звука, и для отметки: если бы отметка о разговоре в
 * команде уходила всем, противник читал бы по ней, что команда сейчас
 * договаривается, — а это ровно та информация, ради которой командный канал и
 * заводят. В свободной игре команд нет, и «своим» там значит «всем».
 */
export function voiceAudience(
  state: HubState,
  from: string,
  channel: 'team' | 'all',
): (id: string) => boolean {
  if (state.room.mode === 'impostor') return (id) => id !== from && hearsVoice(state.impostor, from, id);
  const author = state.members.get(from);
  if (channel === 'all' || !state.room.teams || !author?.team) return (id) => id !== from;
  const team = author.team;
  return (id) => id !== from && state.members.get(id)?.team === team;
}

/** Голос заглушён: чат выключен в комнате или ведущий заглушил именно этого. */
export function voiceSilenced(state: HubState, id: string) {
  return !state.room.voiceEnabled || state.room.voiceMuted.has(id);
}

/**
 * Members as clients see them: newest first, at most 100, names hidden in
 * anonymous rooms.
 *
 * Давно забытых снимок не несёт — иначе список копил бы всех, кто когда-либо
 * заходил, и сотня мест уходила бы на ушедших. Это именно уборка, а не
 * присутствие: кто «в сети», кто «отошёл», а кто ушёл, решает получатель по
 * `lastSeen` (`presenceOf` в lib/model.ts). Снимок один на всю комнату, и
 * вырезать по присутствию здесь нельзя: из скрытой вкладки пакеты не уходят, и
 * получатель вырезал бы в том числе самого себя.
 */
export function publicMembers(state: HubState, now: number, viewer?: string): Person[] {
  const anonymous = state.room.anonymous;
  const bots = new Map(state.room.bots.map((b) => [b.id, b.level]));
  // В «Предателе» живые не видят призраков: снимок собирается для каждого получателя.
  const hidden =
    viewer !== undefined && state.room.mode === 'impostor' && gameActive(state.impostor)
      ? (id: string) => !visibleTo(state.impostor, viewer, id)
      : () => false;
  return [...state.members.values()]
    .filter((m) => m.seen > now - ROOM_MEMORY_MS && !hidden(m.id))
    .sort((a, b) => b.seen - a.seen)
    .slice(0, 100)
    .map((m) => ({
      id: m.id,
      ...(bots.has(m.id) ? { bot: bots.get(m.id) } : {}),
      name: anonymous ? 'Участник' : m.name,
      color: m.color,
      team: m.team,
      lastSeen: m.seen,
      pose: m.pose,
      positionRevision: m.positionRevision ?? 0,
      ping: m.ping,
      mood: anonymous ? '' : m.mood,
      hat: anonymous ? '' : m.hat,
      cursor: m.cursor ?? {},
      hp: m.hp,
      respawnAt: m.respawnAt,
      immuneUntil: m.immuneUntil,
      life: m.life,
      kills: m.kills,
      deaths: m.deaths,
      assists: m.assists,
      immuneRemaining: !state.room.shieldSeconds
        ? 0
        : m.immuneUntil === -1
          ? state.room.shieldSeconds * 1000
          : Math.max(0, m.immuneUntil - now),
      respawnRemaining: Math.max(0, m.respawnAt - now),
    }));
}

// ------------------------------------------------------------------ боты

const BOT_COLORS = ['#ff647c', '#ffb851', '#7fe0b8', '#64d4ef', '#bc91f5', '#f49fd6'];
/**
 * В комнате есть живой человек в сети. Без людей боты спят: играть им не для
 * кого, а каждый такт — работа сервера комнаты.
 */
export function humansOnline(state: HubState, now: number) {
  for (const m of state.members.values()) if (!isBotId(m.id) && m.seen > now - ONLINE_MS) return true;
  return false;
}

/**
 * Сторона нового бота. В отличие от `balanceTeam` считаются только те, кто в
 * сети, и сами боты: строки давно ушедших игроков копятся в комнате (операции
 * «выйти» нет), и по ним бот вставал бы не туда, где людей и правда меньше.
 */
function botTeam(state: HubState, spec: BotSpec, now: number): Team | '' {
  if (!state.room.teams) return '';
  if (spec.team) return spec.team;
  let red = 0,
    blue = 0;
  for (const o of state.members.values()) {
    if (o.id === spec.id || !(isBotId(o.id) || o.seen > now - ONLINE_MS)) continue;
    if (o.team === 'red') red++;
    else if (o.team === 'blue') blue++;
  }
  return red <= blue ? 'red' : 'blue';
}

/**
 * Привести участников-ботов к списку в настройках комнаты: новых поставить на
 * спавн их стороны, удалённых убрать. Уже играющих не трогает — смена уровня
 * меняет только мозг (`stepBots`), а не жизнь и счёт бота.
 */
export function syncBots(state: HubState, now: number) {
  let changed = false;
  const wanted = new Set(state.room.bots.map((b) => b.id));
  // Удалять из Map во время обхода безопасно: удалённые ключи просто не встретятся.
  for (const id of state.members.keys())
    if (isBotId(id) && !wanted.has(id)) {
      state.members.delete(id);
      changed = true;
    }
  const map = getMap(state.room.map);
  state.room.bots.forEach((spec, i) => {
    const known = state.members.get(spec.id);
    if (known) {
      known.name = BOT_PREFIX + spec.name;
      return;
    }
    const m = memberFromRow({
      session: spec.id,
      name: BOT_PREFIX + spec.name,
      color: BOT_COLORS[i % BOT_COLORS.length],
      seen: now,
    });
    m.team = botTeam(state, spec, now);
    armShield(state, m);
    state.members.set(spec.id, m);
    placeAt(m, chooseSpawn(state, map, m.id, now, m.team));
    changed = true;
  });
  return changed;
}

/**
 * Такт всех ботов комнаты: каждый смотрит, решает и шлёт серверу то же, что
 * прислал бы клиент, — шаг через `applyPresence`, выстрел через `fireEffect`.
 * Урон по-прежнему считает `resolveCombat`. Возвращает, выстрелил ли кто-то.
 *
 * Такт идёт тремя фазами, а не бот за ботом: сначала все думают по одному и
 * тому же снимку, потом все шагают, потом все стреляют. Иначе ходивший позже
 * видел бы соперников уже на новом месте, а его соперники стреляли бы туда,
 * где его к расчёту попаданий уже нет, — в зеркальном матче равных ботов это
 * давало стороне, стоящей в списке второй, полтора убийства на одно.
 */
export function stepBots(state: HubState, brains: Map<string, BotBrain>, now: number) {
  const specs = state.room.bots;
  for (const id of brains.keys()) if (!specs.some((b) => b.id === id)) brains.delete(id);
  if (!specs.length || !humansOnline(state, now)) return false;
  const map = getMap(state.room.map);
  const ctx = { state, map, now, frozen: isFrozen(state, now), squad: brains };
  const turns: { m: HubMember; brain: BotBrain; presence: ReturnType<BotBrain['think']> }[] = [];
  // Характер — по номеру бота внутри его команды: так у сторон одинаковый
  // набор характеров, а не «двое напористых против двоих осторожных».
  const inTeam = new Map<string, number>();
  for (const spec of specs) {
    const m = state.members.get(spec.id);
    if (!m) continue;
    const index = inTeam.get(m.team) ?? 0;
    inTeam.set(m.team, index + 1);
    let brain = brains.get(spec.id);
    if (!brain) {
      brain = new BotBrain(spec, index);
      brains.set(spec.id, brain);
    }
    brain.setLevel(spec.level);
    turns.push({ m, brain, presence: brain.think(ctx, m) });
  }
  for (const { m, presence } of turns)
    applyPresence(m, presence, now, map, ctx.frozen, state.room.shieldSeconds * 1000);
  let fired = false;
  for (const { m, brain } of turns) {
    const { shot, reload } = brain.trigger(ctx, m);
    if (reload) memberWeapon(m).magazine.reload(reload, now);
    if (shot && fireEffect(state, m.id, shot, now).ok) fired = true;
  }
  return fired;
}

// ------------------------------------------------------------------ «Предатель»

/** Новая жизнь на месте за столом: клиент телепортируется, увидев смену жизни. */
export function seatMember(state: HubState, id: string, seat: SpawnPoint) {
  const m = state.members.get(id);
  if (!m) return;
  m.life += 1;
  m.hp = 100;
  m.respawnAt = 0;
  m.immuneUntil = 0;
  m.recentDamage = {};
  placeAt(m, seat);
}

/** Действие игрока в режиме «Предатель». Сервер решает всё сам: клиент только просит. */
export function impostorAction(state: HubState, self: string, op: Record<string, unknown>, now: number): ImpostorResult {
  if (state.room.mode !== 'impostor') return { ok: false, error: 'Комната не в режиме «Предатель»' };
  if (state.room.archived) return { ok: false, error: 'Комната в архиве' };
  const place = (id: string, seat: SpawnPoint) => seatMember(state, id, seat);
  switch (op.action) {
    case 'start':
      return startGame(state, self, now, place);
    case 'stop':
      return stopGame(state, self);
    case 'kill':
      return kill(state, self, op.target, now);
    case 'report':
      return report(state, self, op.body, now, place);
    case 'meeting':
      return emergency(state, self, now, place);
    case 'vote':
      return vote(state, self, op.target, now);
    case 'task.start':
      return startTask(state, self, op.station, now);
    case 'task.done':
      return finishTask(state, self, op.station, now);
    case 'sabotage':
      return sabotage(state, self, op.kind, now);
    case 'fix':
      return fix(state, self, op.panel, now);
    case 'vent.enter':
      return enterVent(state, self, op.vent);
    case 'vent.move':
      return moveVent(state, self, op.vent, place);
    case 'vent.exit':
      return exitVent(state, self);
    default:
      return { ok: false, error: 'Неизвестное действие' };
  }
}
