// Hot room state (poses, HP, shots, combat) kept in memory by the room's Durable Object.
// Pure functions only: the rules are the ones the D1 version enforced in app/api/rooms/[id]
// and db/combat.ts, so HTTP fallback and WebSocket clients see the same game.
import {
  calculatePelletsHit,
  effectCooldown,
  effectDamage,
  effectStyle,
  inHitRange,
  isHeadshot,
} from './game-items.ts';
import { uid, type Person, type Pose, type RoomState, type WorldEffect } from './model.ts';
import { isBlocked3D, rayCastWorldObstacle } from './world-collision.ts';
import { getMap } from './maps/index.ts';
import { stanceHeight, type GameMap, type SpawnPoint } from './maps/types.ts';

/** Effects older than this are neither resolved nor sent to clients. */
export const EFFECT_TTL_MS = 15_000;
/** Members unseen for longer than this cannot be hit. */
export const ONLINE_MS = 15_000;
export const SPAWN_POSE: Pose = { x: 0, y: 0, z: 4, yaw: 0, stance: 'stand', moving: false };
/** Lag compensation: shots are checked against where victims were at most this long ago. */
export const MAX_REWIND_MS = 250;
/** Pose samples kept per member for rewinding. */
const TRACK_MS = 1000;
/** The fastest legal run is 4.8 m/s (world.tsx); the margin absorbs network jitter. */
const MOVE_SPEED = 4.8 * 1.5;
/** Movement allowance saved up while packets are delayed, m. */
const MOVE_BUDGET = 5;
/** A client whose moves have been refused this long is resynced to where it says it is. */
const RESYNC_MS = 1500;
/** Server-side body radius: below the client's 0.32 so rounded poses near walls still pass. */
const BODY_RADIUS = 0.25;
const EFFECT_KINDS = ['paint', 'confetti', 'grenade', 'sniper', 'like'];
const TOOLS = ['paint', 'confetti', 'grenade', 'sniper', 'pointer', 'other'];

export type Cursor = { x: number; y: number; mode: 'board' | '3d' };
export type HubMember = {
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
  lastMoveAt: number;
  /** Start of the current run of refused moves (0: none). */
  refusedSince: number;
  /** Where the current life started; the first step away ends spawn protection. */
  spawn: { x: number; z: number };
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
  archived: boolean;
  /** Map id (lib/maps). */
  map: string;
};
export type HubState = {
  room: HubRoom;
  members: Map<string, HubMember>;
  effects: HubEffect[];
  seq: number;
};

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const isVec3 = (p: unknown): p is number[] =>
  Array.isArray(p) && p.length === 3 && p.every((n) => finite(n) && Math.abs(n) < 200);
const isImmune = (m: HubMember, now: number) => m.immuneUntil === -1 || m.immuneUntil > now;

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
    archived: !!state.archived,
    map: getMap(state.map).id,
  };
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
    lastMoveAt: 0,
    refusedSince: 0,
    spawn: { x: SPAWN_POSE.x, z: SPAWN_POSE.z },
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

export function sanitizePose(pose: unknown): Pose | null {
  const p = pose as Record<string, unknown> | null;
  if (!p || typeof p !== 'object' || ![p.x, p.y, p.z, p.yaw].every(finite)) return null;
  return {
    x: clamp(p.x as number, -36, 36),
    y: clamp(p.y as number, 0, 10),
    z: clamp(p.z as number, -36, 36),
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
 * (the rest of the pose is kept); after RESYNC_MS of refusals a legal position is accepted.
 */
export function applyPresence(
  m: HubMember,
  op: { pose?: unknown; cursor?: unknown; ping?: unknown; life?: unknown },
  now: number,
  map: GameMap = getMap('hub'),
) {
  const pose = sanitizePose(op.pose);
  const cursor = sanitizeCursor(op.cursor);
  const life = Number.isInteger(op.life) ? (op.life as number) : 0;
  m.seen = now;
  m.ping = finite(op.ping) ? clamp(Math.round(op.ping), 0, 60000) : 0;
  if (cursor) m.cursor = cursor;
  if (!pose || m.hp <= 0 || m.life !== life) return;
  const dt = m.lastMoveAt ? Math.max(0, now - m.lastMoveAt) / 1000 : Infinity;
  m.lastMoveAt = now;
  m.moveBudget = Math.min(MOVE_BUDGET, m.moveBudget + MOVE_SPEED * dt);
  const from = m.pose;
  const step = Math.hypot(pose.x - from.x, pose.z - from.z);
  if (step > 1e-3 && !moveAllowed(map, from, pose, step, m.moveBudget)) {
    if (!m.refusedSince) m.refusedSince = now;
    if (now - m.refusedSince < RESYNC_MS || blockedAt(map, pose)) {
      m.pose = { ...pose, x: from.x, y: from.y, z: from.z, moving: false };
      recordPose(m, now);
      return;
    }
  }
  m.refusedSince = 0;
  m.moveBudget = Math.max(0, m.moveBudget - step);
  m.pose = pose;
  recordPose(m, now);
  // Spawn protection lasts until the first move, then 5 more seconds.
  if (m.immuneUntil === -1 && (pose.moving || Math.hypot(pose.x - m.spawn.x, pose.z - m.spawn.z) > 0.45))
    m.immuneUntil = now + 5000;
}

export type FireResult = { ok: boolean; reason?: 'respawning' | 'immune'; effect?: HubEffect };

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
  const shooter = state.members.get(self);
  if (!shooter || shooter.hp <= 0) return { ok: false, reason: 'respawning' };
  if (isImmune(shooter, now)) return { ok: false, reason: 'immune' };
  if (
    Math.hypot(origin[0] - shooter.pose.x, origin[1] - shooter.pose.y, origin[2] - shooter.pose.z) > 9 ||
    Math.hypot(target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]) > 75
  )
    throw Error('Предмет слишком далеко');
  const id = typeof op.id === 'string' && /^[a-f0-9-]{36}$/.test(op.id) ? op.id : uid();
  if (state.effects.some((e) => e.id === id)) return { ok: false };
  if (shooter.lastShot > now - effectCooldown(kind)) return { ok: false };
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

/** The spawn point farthest from the other living players (teams share the list for now). */
export function chooseSpawn(state: HubState, map: GameMap, self: string, now: number): SpawnPoint {
  const points = [...map.spawns.red, ...map.spawns.blue];
  const rivals = [...state.members.values()].filter(
    (o) => o.id !== self && o.hp > 0 && o.seen > now - ONLINE_MS,
  );
  let best = points[0],
    bestScore = -1;
  for (const p of points) {
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
  m.refusedSince = 0;
}

/** Moves a member standing outside the room's map or inside one of its walls to a spawn point. */
export function placeIfInvalid(state: HubState, m: HubMember, now: number) {
  const map = getMap(state.room.map),
    b = map.bounds,
    p = m.pose;
  if (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && !blockedAt(map, p)) return false;
  placeAt(m, chooseSpawn(state, map, m.id, now));
  return true;
}

/**
 * The host switched maps (state.room.map already holds the new one): everyone starts a new
 * life on a spawn point of it. Clients teleport when they see their life change.
 */
export function changeMap(state: HubState, now: number) {
  const map = getMap(state.room.map);
  state.effects = [];
  for (const m of state.members.values()) {
    m.life += 1;
    m.hp = 100;
    m.respawnAt = 0;
    m.immuneUntil = -1;
    m.recentDamage = {};
    placeAt(m, chooseSpawn(state, map, m.id, now));
  }
}

function revive(state: HubState, now: number) {
  let changed = false;
  for (const m of state.members.values()) {
    if (m.hp !== 0 || m.respawnAt <= 0 || m.respawnAt > now) continue;
    m.hp = 100;
    m.respawnAt = 0;
    m.life += 1;
    m.immuneUntil = -1;
    m.recentDamage = {};
    placeAt(m, chooseSpawn(state, getMap(state.room.map), m.id, now));
    changed = true;
  }
  return changed;
}

function applyHits(state: HubState, e: HubEffect, now: number) {
  const colliders = getMap(state.room.map).colliders;
  const origin = e.origin || [0, 0, 0];
  const target = e.target || [0, 0, 0];
  const author = state.members.get(e.author);
  const authorImmune = !!author && isImmune(author, now);
  for (const p of state.members.values()) {
    if (p.id === e.author || p.hp <= 0 || p.seen <= now - ONLINE_MS) continue;
    const pose = poseAt(p, e.rewindTo);
    const hit =
      e.kind === 'confetti'
        ? calculatePelletsHit(origin, target, pose, 8, colliders).pelletsHit > 0
        : inHitRange(e.kind, origin, target, pose, colliders);
    // After a respawn a player can neither take nor deal damage.
    if (!hit || authorImmune || isImmune(p, now)) continue;
    const head = isHeadshot(e.kind, origin, target, pose);
    let damage: number;
    let pelletsHit: number | undefined;
    if (e.kind === 'confetti') {
      const pellets = calculatePelletsHit(origin, target, pose, 8, colliders);
      pelletsHit = pellets.pelletsHit;
      damage = head ? 100 : pellets.damage;
    } else {
      const distance = Math.hypot(target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]);
      damage = head ? 100 : effectDamage(e.kind, distance);
    }
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
    if (author) author.kills += 1;
    if (assisterMember) assisterMember.assists += 1;
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
  let changed = revive(state, now);
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

/** Members as clients see them: newest first, at most 100, names hidden in anonymous rooms. */
export function publicMembers(state: HubState, now: number): Person[] {
  const anonymous = state.room.anonymous;
  return [...state.members.values()]
    .sort((a, b) => b.seen - a.seen)
    .slice(0, 100)
    .map((m) => ({
      id: m.id,
      name: anonymous ? 'Участник' : m.name,
      color: m.color,
      lastSeen: m.seen,
      pose: m.pose,
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
      immuneRemaining: m.immuneUntil === -1 ? 5000 : Math.max(0, m.immuneUntil - now),
      respawnRemaining: Math.max(0, m.respawnAt - now),
    }));
}
