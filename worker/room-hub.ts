import { checkpointRoom, encodeCheckpoint, restoreCheckpoint } from '@/lib/room-checkpoint';
import { DurableObject } from 'cloudflare:workers';
import { ensureCombatColumns } from '@/db/combat';
import { controlWeapon, weaponReply } from '@/lib/weapon-authority';
import type { Person, WorldEffect } from '@/lib/model';
import { getMap } from '@/lib/maps';
import {
  applyPresence,
  balanceTeam,
  changeMap,
  newMatch,
  placeIfInvalid,
  respawnAll,
  setTeam,
  effectsSince,
  fireEffect,
  isFrozen,
  memberFromRow,
  publicEffects,
  publicMembers,
  resolveCombat,
  roomFromState,
  type HubMatch,
  type HubMember,
  type HubState,
} from '@/lib/room-hub-core';

/** Broadcast rate for connected sockets. */
const TICK_MS = 100;
/** Hot state is written back to D1 at most this often (lobby counts, restarts). */
const FLUSH_MS = 2000;
const MAX_MESSAGE = 16_384;
const MEMBER_COLUMNS =
  'session,name,color,seen,pose,ping,mood,hat,cursor,hp,respawn_at,immune_until,life,kills,deaths,assists,recent_damage,last_shot,team';

export type LiveView = {
  now: number;
  members: Person[];
  effects: WorldEffect[];
  /** Team battle score and clock; free-for-all rooms keep it at zero. */
  match: HubMatch;
};

/**
 * One instance per room (`idFromName(roomId)`). Owns the hot state — poses, HP, shots,
 * combat — in memory; D1 keeps the cold data (board, names, history) and a periodic copy
 * of the hot fields. Clients talk to it over a WebSocket; HTTP route handlers use the RPC
 * methods below, so both transports see the same game.
 */
export class RoomHub extends DurableObject<Cloudflare.Env> {
  private hub: HubState | null = null;
  private loading: Promise<HubState> | null = null;
  private roomId = '';
  private sockets = new Map<WebSocket, string>();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private sentSeq = 0;
  private dirty = false;
  private flushScheduled = false;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room_checkpoint (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');
  }

  private checkpoint() {
    if (this.hub) this.ctx.storage.sql.exec(
      'INSERT INTO room_checkpoint (id,data) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      encodeCheckpoint(this.roomId, this.hub),
    );
  }

  private savedCheckpoint() {
    return this.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM room_checkpoint WHERE id=1').toArray()[0]?.data;
  }

  /** Persist the revision too, before acknowledging either transport. */
  private acknowledge<T>(reply: T): T {
    this.markDirty();
    return reply;
  }

  // ---- RPC for app/api/rooms/[id] ----

  /** Presence over HTTP (fallback when the socket is down): applies it and returns the live view. */
  async presence(room: string, self: string, op: Record<string, unknown>, since: number | null) {
    const hub = await this.state(room);
    const now = Date.now();
    applyPresence(
      await this.member(hub, self),
      op,
      now,
      getMap(hub.room.map),
      isFrozen(hub, now),
    );
    const changed = resolveCombat(hub, now);
    this.markDirty(changed);
    return this.view(hub, now, since);
  }

  async effect(room: string, self: string, op: Record<string, unknown>) {
    const hub = await this.state(room);
    const member = await this.member(hub, self);
    const now = Date.now();
    let result;
    try { result = fireEffect(hub, self, op, now); }
    catch (error) { return this.acknowledge(weaponReply(member, typeof op.id === 'string' ? op.id : '', now, false, (error as Error).message)); }
    resolveCombat(hub, now);
    return this.acknowledge(weaponReply(member, typeof op.id === 'string' ? op.id : '', now, result.ok, result.reason));
  }

  async weapon(room: string, self: string, op: Record<string, unknown>) {
    const hub = await this.state(room);
    const member = await this.member(hub, self);
    return this.acknowledge(controlWeapon(member, op, Date.now()));
  }

  async live(room: string, since: number | null) {
    const hub = await this.state(room);
    const now = Date.now();
    if (resolveCombat(hub, now)) this.markDirty();
    return this.view(hub, now, since);
  }

  /** The host moved a player to a team: they respawn on that side. */
  async team(room: string, self: string, value: 'red' | 'blue') {
    const hub = await this.state(room);
    await this.member(hub, self);
    if (setTeam(hub, self, value, Date.now())) this.markDirty();
    return { ok: true };
  }

  /** A member joined or edited their profile: reload the cold fields from D1. */
  async memberChanged(room: string, self: string) {
    const hub = await this.state(room);
    await this.reloadMember(hub, self);
  }

  /** Board, settings or join requests changed in D1: reload room flags and tell sockets to refetch. */
  async roomChanged(room: string) {
    const hub = await this.state(room);
    const row = await this.env.DB.prepare('SELECT host,state FROM rooms WHERE id=?')
      .bind(this.roomId)
      .first<{ host: string; state: string }>();
    if (row) {
      const next = roomFromState(row.host, JSON.parse(row.state));
      const mapChanged = next.map !== hub.room.map;
      hub.room = next;
      if (mapChanged) {
        changeMap(hub, Date.now());
        this.markDirty();
      }
    }
    this.broadcast(JSON.stringify({ t: 'refresh' }));
  }

  // ---- WebSocket ----

  async fetch(request: Request) {
    const room = request.headers.get('x-room') || '';
    const self = request.headers.get('x-session') || '';
    let hub: HubState;
    try {
      hub = await this.state(room);
      await this.member(hub, self);
    } catch {
      return new Response('Сначала войдите в комнату', { status: 403 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.sockets.set(server, self);
    server.addEventListener('message', (event) => this.onMessage(server, self, event.data));
    const drop = () => {
      this.sockets.delete(server);
      if (!this.sockets.size) this.stopTicking();
    };
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);
    // Catch the new socket up on the last couple of seconds; clients dedupe effects by id.
    const now = Date.now();
    if (resolveCombat(hub, now)) this.markDirty();
    server.send(JSON.stringify({ t: 'tick', ...this.view(hub, now, now - 2000) }));
    this.startTicking();
    return new Response(null, { status: 101, webSocket: client });
  }

  private onMessage(ws: WebSocket, self: string, data: unknown) {
    if (typeof data !== 'string' || data.length > MAX_MESSAGE) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    const hub = this.hub;
    const m = hub?.members.get(self);
    if (!hub || !m) return;
    const now = Date.now();
    if (msg.t === 'presence') {
      applyPresence(m, msg, now, getMap(hub.room.map), isFrozen(hub, now));
      this.markDirty(false);
    } else if (msg.t === 'effect') {
      let reply;
      try {
        const result = fireEffect(hub, self, msg, now);
        if (result.ok) resolveCombat(hub, now);
        reply = weaponReply(m, typeof msg.id === 'string' ? msg.id : '', now, result.ok, result.reason);
      } catch (e) {
        reply = weaponReply(m, typeof msg.id === 'string' ? msg.id : '', now, false, (e as Error).message);
      }
      ws.send(JSON.stringify({ t: 'weapon', ...this.acknowledge(reply) }));
    } else if (msg.t === 'weapon') {
      ws.send(JSON.stringify({ t: 'weapon', ...this.acknowledge(controlWeapon(m, msg, now)) }));
    } else if (msg.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', at: msg.at }));
    }
  }

  private startTicking() {
    this.ticker ??= setInterval(() => this.tick(), TICK_MS);
  }

  private stopTicking() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  private tick() {
    const hub = this.hub;
    if (!hub || !this.sockets.size) return this.stopTicking();
    const now = Date.now();
    if (resolveCombat(hub, now)) this.markDirty();
    const fresh = hub.effects.filter((e) => e.seq > this.sentSeq);
    this.sentSeq = hub.seq;
    this.broadcast(
      JSON.stringify({
        t: 'tick',
        ...this.snapshot(hub, now, fresh),
      }),
    );
  }

  private broadcast(message: string) {
    for (const ws of this.sockets.keys()) {
      try {
        ws.send(message);
      } catch {
        this.sockets.delete(ws);
      }
    }
  }

  private view(hub: HubState, now: number, since: number | null): LiveView {
    return this.snapshot(hub, now, effectsSince(hub, now, since));
  }

  /** Build every transport snapshot from the same live-state contract. */
  private snapshot(
    hub: HubState,
    now: number,
    effects: HubState['effects'],
  ): LiveView {
    return {
      now,
      members: publicMembers(hub, now),
      effects: publicEffects(effects, hub.room.anonymous),
      match: hub.match,
    };
  }

  // ---- State and persistence ----

  private state(room: string): Promise<HubState> {
    if (this.hub) return Promise.resolve(this.hub);
    this.roomId = room;
    this.loading ??= this.load(room).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async load(room: string) {
    await ensureCombatColumns();
    const db = this.env.DB;
    const [rooms, members] = await db.batch([
      db.prepare('SELECT host,state FROM rooms WHERE id=?').bind(room),
      db.prepare(`SELECT ${MEMBER_COLUMNS} FROM members WHERE room=?`).bind(room),
    ]);
    const row = rooms.results[0] as { host: string; state: string } | undefined;
    if (!row) throw Error('Комната не найдена');
    const settings = roomFromState(row.host, JSON.parse(row.state));
    const hub: HubState = {
      room: settings,
      members: new Map(),
      effects: [],
      seq: 0,
      match: newMatch(settings, Date.now()),
    };
    for (const r of members.results as Record<string, unknown>[]) {
      const m = memberFromRow(r);
      hub.members.set(m.id, m);
    }
    const saved = this.savedCheckpoint();
    const restored = saved !== undefined && restoreCheckpoint(room, hub, saved);
    this.hub = hub;
    const now = Date.now();
    for (const m of hub.members.values()) {
      if (balanceTeam(hub, m, now)) this.markDirty();
      if (placeIfInvalid(hub, m, now)) this.markDirty();
    }
    // Legacy rooms initialize once; a restored match keeps its lives, score and deadlines.
    if (hub.room.teams && !restored) {
      respawnAll(hub, now);
      this.markDirty();
    }
    this.checkpoint();
    return hub;
  }

  private async member(hub: HubState, self: string): Promise<HubMember> {
    const m = hub.members.get(self) ?? (await this.reloadMember(hub, self));
    if (!m) throw Error('Сначала войдите в комнату');
    return m;
  }

  private async reloadMember(hub: HubState, self: string) {
    const row = await this.env.DB.prepare(`SELECT ${MEMBER_COLUMNS} FROM members WHERE room=? AND session=?`)
      .bind(this.roomId, self)
      .first<Record<string, unknown>>();
    if (!row) return undefined;
    const fresh = memberFromRow(row);
    const known = hub.members.get(self);
    if (!known) {
      hub.members.set(self, fresh);
      if (balanceTeam(hub, fresh, Date.now())) this.markDirty();
      if (placeIfInvalid(hub, fresh, Date.now())) this.markDirty();
      return fresh;
    }
    // Hot fields live here; only the profile comes from D1.
    Object.assign(known, {
      name: fresh.name,
      color: fresh.color,
      mood: fresh.mood,
      hat: fresh.hat,
      seen: Math.max(known.seen, fresh.seen),
    });
    return known;
  }

  private markDirty(persist = true) {
    if (persist) this.checkpoint();
    this.dirty = true;
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    void this.ctx.storage.setAlarm(Date.now() + FLUSH_MS);
  }

  async alarm() {
    this.flushScheduled = false;
    if (!this.hub) {
      const saved = this.savedCheckpoint();
      if (saved === undefined) return;
      await this.state(checkpointRoom(saved));
      this.dirty = true;
    }
    const hub = this.hub;
    if (!hub || !this.dirty) return;
    this.checkpoint();
    this.dirty = false;
    const db = this.env.DB;
    const update = db.prepare(
      'UPDATE members SET seen=?,pose=?,ping=?,cursor=?,hp=?,respawn_at=?,immune_until=?,life=?,kills=?,deaths=?,assists=?,recent_damage=?,last_shot=?,team=? WHERE room=? AND session=?',
    );
    const statements = [...hub.members.values()].map((m) =>
      update.bind(
        m.seen,
        JSON.stringify(m.pose),
        m.ping,
        JSON.stringify(m.cursor ?? {}),
        m.hp,
        m.respawnAt,
        m.immuneUntil,
        m.life,
        m.kills,
        m.deaths,
        m.assists,
        JSON.stringify(m.recentDamage),
        m.lastShot,
        m.team,
        this.roomId,
        m.id,
      ),
    );
    try {
      if (statements.length) await db.batch(statements);
    } catch (e) {
      console.error('room hub flush failed', e);
      this.markDirty();
    }
  }
}
