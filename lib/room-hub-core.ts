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

/** Effects older than this are neither resolved nor sent to clients. */
export const EFFECT_TTL_MS = 15_000;
/** Members unseen for longer than this cannot be hit. */
export const ONLINE_MS = 15_000;
export const SPAWN_POSE: Pose = { x: 0, y: 0, z: 4, yaw: 0, stance: 'stand', moving: false };
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
};
export type HubEffect = WorldEffect & {
  resolveAt: number;
  applied: boolean;
  /** Monotonic per hub; lets the tick send only effects added since the previous tick. */
  seq: number;
};
export type HubRoom = {
  host: string;
  anonymous: boolean;
  respawnSeconds: number;
  archived: boolean;
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

/**
 * Presence packet: marks the member online and takes the pose unless they are dead or the
 * packet belongs to a previous life (sent before a respawn reached the client).
 */
export function applyPresence(
  m: HubMember,
  op: { pose?: unknown; cursor?: unknown; ping?: unknown; life?: unknown },
  now: number,
) {
  const pose = sanitizePose(op.pose);
  const cursor = sanitizeCursor(op.cursor);
  const life = Number.isInteger(op.life) ? (op.life as number) : 0;
  m.seen = now;
  m.ping = finite(op.ping) ? clamp(Math.round(op.ping), 0, 60000) : 0;
  if (cursor) m.cursor = cursor;
  if (!pose || m.hp <= 0 || m.life !== life) return;
  m.pose = pose;
  // Spawn protection lasts until the first move, then 5 more seconds.
  if (m.immuneUntil === -1 && (pose.moving || Math.hypot(pose.x, pose.z - SPAWN_POSE.z) > 0.45))
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
    seq: ++state.seq,
  };
  state.effects.push(effect);
  shooter.lastShot = now;
  return { ok: true, effect };
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
    m.pose = { ...SPAWN_POSE };
    changed = true;
  }
  return changed;
}

function applyHits(state: HubState, e: HubEffect, now: number) {
  const origin = e.origin || [0, 0, 0];
  const target = e.target || [0, 0, 0];
  const author = state.members.get(e.author);
  const authorImmune = !!author && isImmune(author, now);
  for (const p of state.members.values()) {
    if (p.id === e.author || p.hp <= 0 || p.seen <= now - ONLINE_MS) continue;
    const hit =
      e.kind === 'confetti'
        ? calculatePelletsHit(origin, target, p.pose).pelletsHit > 0
        : inHitRange(e.kind, origin, target, p.pose);
    // After a respawn a player can neither take nor deal damage.
    if (!hit || authorImmune || isImmune(p, now)) continue;
    const head = isHeadshot(e.kind, origin, target, p.pose);
    let damage: number;
    let pelletsHit: number | undefined;
    if (e.kind === 'confetti') {
      const pellets = calculatePelletsHit(origin, target, p.pose);
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
