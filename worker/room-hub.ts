import { checkpointRoom, encodeCheckpoint, restoreCheckpoint } from '@/lib/room-checkpoint';
import { DurableObject } from 'cloudflare:workers';
import { ensureCombatColumns } from '@/db/combat';
import { controlWeapon, weaponReply } from '@/lib/weapon-authority';
import type { Person, WorldEffect } from '@/lib/model';
import type { BotBrain } from '@/lib/bot-brain';
import { isBotId } from '@/lib/bot-levels';
import { impostorView, newImpostorGame, type ImpostorView } from '@/lib/impostor';
import { stepImpostorBots, type ImpostorBot } from '@/lib/impostor-bot';
import { getMap } from '@/lib/maps';
import { chatFor, postChat, readsChat, type ChatChannel, type ChatEntry } from '@/lib/room-chat';
import {
  balanceTeam,
  changeMap,
  chooseSpawn,
  newMatch,
  placeIfInvalid,
  respawnAll,
  setTeam,
  effectsSince,
  fireEffect,
  humansOnline,
  impostorAction,
  memberFromRow,
  presence,
  publicEffects,
  publicMembers,
  resolveCombat,
  roomFromState,
  seatMember,
  stepBots,
  syncBots,
  type HubMatch,
  type HubMember,
  type HubState,
  voiceAudience,
  voiceSilenced,
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
  /** Партия «Предателя» глазами получателя; только в этом режиме. */
  impostor?: ImpostorView;
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
  /** Мозги серверных ботов: память, маршрут, прицел. В checkpoint не входят — после перезапуска бот просто заново осматривается. */
  private brains = new Map<string, BotBrain>();
  /** Мозги ботов «Предателя»: наблюдения и подозрения живут только в памяти объекта. */
  private impostorBrains = new Map<string, ImpostorBot>();
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
    presence(hub, await this.member(hub, self), op, now);
    const changed = resolveCombat(hub, now);
    this.markDirty(changed);
    this.wakeBots(hub);
    return this.view(hub, now, since, self);
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

  async live(room: string, since: number | null, self?: string) {
    const hub = await this.state(room);
    const now = Date.now();
    if (resolveCombat(hub, now)) this.markDirty();
    this.wakeBots(hub);
    return this.view(hub, now, since, self);
  }

  /** Действие режима «Предатель» по HTTP (без сокета). */
  async impostor(room: string, self: string, op: Record<string, unknown>) {
    const hub = await this.state(room);
    await this.member(hub, self);
    return this.impostorAct(hub, self, op);
  }

  /**
   * Ход партии меняет роли, жизни и места за столом — горячее состояние, которое должно
   * пережить перезапуск объекта: сразу в checkpoint и сразу всем сокетам.
   */
  private impostorAct(hub: HubState, self: string, op: Record<string, unknown>) {
    const now = Date.now();
    const result = impostorAction(hub, self, op, now);
    if (result.ok) {
      resolveCombat(hub, now);
      this.markDirty();
      this.sendTicks(hub, now, []);
    }
    return result;
  }

  /**
   * Игрок (или ведущий за него) сменил сторону: в бою это стоит жизни и очка убийства,
   * возрождение поставит бойца на спавн новой команды. Счёт считает сервер — клиент
   * присылает только желаемую сторону.
   */
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
      if (syncBots(hub, Date.now())) this.markDirty();
      this.wakeBots(hub);
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
      // Открыл комнату — значит, в ней. Иначе вернувшийся из свёрнутой вкладки
      // до первого пакета присутствия выглядел бы ушедшим, в том числе в
      // собственной таблице. Продлевать это на каждом тике нельзя: свёрнутая
      // вкладка тогда навсегда оставалась бы «в сети» (lib/model.ts, Presence).
      const joined = await this.member(hub, self);
      joined.seen = Math.max(joined.seen, Date.now());
      this.markDirty(false);
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
    server.send(JSON.stringify({ t: 'tick', ...this.view(hub, now, now - 2000, self) }));
    // История чата — только то, что этот участник и так имел право прочитать.
    server.send(JSON.stringify({ t: 'chat', messages: chatFor(hub, self), history: true }));
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
      presence(hub, m, msg, now);
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
    } else if (msg.t === 'voice') {
      this.relayVoice(hub, self, msg);
    } else if (msg.t === 'chat') {
      const result = postChat(hub, self, msg, now);
      if (result.ok) this.deliverChat(result.entry);
      else ws.send(JSON.stringify({ t: 'chat.error', error: result.error }));
    } else if (msg.t === 'impostor') {
      const result = this.impostorAct(hub, self, msg);
      ws.send(JSON.stringify({ t: 'impostor', id: typeof msg.id === 'string' ? msg.id : '', ...result }));
    }
  }

  /**
   * Пересылка голосового чата. Сам звук идёт мимо сервера — напрямую между
   * браузерами (WebRTC), и здесь проходит только служебное: договориться о
   * соединении (`offer`/`answer`/`ice`), сказать «я готов говорить» (`ready`) и
   * «я сейчас говорю» (`talk`). Так на воркер не ложится ни один килобайт
   * звука, а комната всё равно решает, кто кого слышит.
   *
   * Заглушённому сервер не даёт договориться о соединении: без `offer` и `ice`
   * его голосу просто некуда идти, даже если клиент подправили. А вот отметку
   * «говорю» от него пересылаем — с пометкой `silenced`. Иначе человек жал бы
   * кнопку в пустоту, и ни собеседники, ни ведущий не узнали бы, что его
   * пытаются о чём-то попросить.
   */
  private relayVoice(hub: HubState, self: string, msg: Record<string, unknown>) {
    const kind = msg.kind;
    if (kind !== 'offer' && kind !== 'answer' && kind !== 'ice' && kind !== 'ready' && kind !== 'talk')
      return;
    const silenced = voiceSilenced(hub, self);
    const out: Record<string, unknown> = { t: 'voice', kind, from: self };
    if (kind === 'talk') {
      const channel = msg.channel === 'team' ? 'team' : 'all';
      out.channel = channel;
      out.on = !!msg.on;
      if (silenced) out.silenced = true;
      const hears = voiceAudience(hub, self, channel);
      this.sendToMembers(hears, JSON.stringify(out));
      return;
    }
    if (silenced) return;
    if (kind === 'ready') {
      out.on = !!msg.on;
      // Новичку отвечают лично: иначе он узнал бы о собеседниках только со
      // следующей общей рассылки, а её никто не обязан делать.
      const to = typeof msg.to === 'string' ? msg.to : '';
      if (to) this.sendToMembers((id) => id === to && !voiceSilenced(hub, id), JSON.stringify(out));
      else this.sendToMembers((id) => id !== self && !voiceSilenced(hub, id), JSON.stringify(out));
      return;
    }
    // Договорённость о соединении всегда адресная: она бессмысленна для всех,
    // кроме одного собеседника, и пересылать её шире — лишний трафик.
    const to = msg.to;
    if (typeof to !== 'string' || !hub.members.has(to) || voiceSilenced(hub, to)) return;
    out.payload = msg.payload;
    this.sendToMembers((id) => id === to, JSON.stringify(out));
  }

  /** Сообщение чата — тем, кому оно адресовано (получатели решены в lib/room-chat.ts). */
  private deliverChat(entry: ChatEntry) {
    this.sendToMembers((id) => readsChat(entry, id), JSON.stringify({ t: 'chat', messages: [entry.message] }));
  }

  private sendToMembers(match: (id: string) => boolean, message: string) {
    for (const [ws, id] of this.sockets) {
      if (!match(id)) continue;
      try {
        ws.send(message);
      } catch {
        this.sockets.delete(ws);
      }
    }
  }

  /**
   * Боты играют, пока в комнате есть люди, — даже если все они сидят на HTTP
   * без сокета: иначе на плохой сети бой с ботами просто замирал бы. Такт сам
   * останавливается, когда не остаётся ни сокетов, ни людей в сети.
   */
  private wakeBots(hub: HubState) {
    if (hub.room.bots.length && humansOnline(hub, Date.now())) this.startTicking();
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
    if (!hub) return this.stopTicking();
    const now = Date.now();
    const bots = hub.room.bots.length > 0 && humansOnline(hub, now);
    if (!this.sockets.size && !bots) return this.stopTicking();
    if (bots && hub.room.mode === 'impostor') {
      stepImpostorBots(hub, this.impostorBrains, getMap(hub.room.map), now, {
        act: (id, op) => impostorAction(hub, id, op, now),
        move: (m, op) => presence(hub, m, op, now),
        say: (id, channel: ChatChannel, text) => {
          const result = postChat(hub, id, { channel, text }, now);
          if (result.ok) this.deliverChat(result.entry);
          return result.ok;
        },
      });
      this.markDirty(false);
    } else if (bots) {
      stepBots(hub, this.brains, now);
      // Шаги ботов, как и presence людей, уходят в D1 редкой записью без checkpoint.
      this.markDirty(false);
    }
    if (resolveCombat(hub, now)) this.markDirty();
    const fresh = hub.effects.filter((e) => e.seq > this.sentSeq);
    this.sentSeq = hub.seq;
    this.sendTicks(hub, now, fresh);
  }

  /**
   * Рассылка такта. Обычно снимок один на всех; в «Предателе» — свой каждому: роли,
   * задания и призраки у всех разные, а общий снимок выдал бы тайну любому, кто
   * откроет инструменты разработчика.
   */
  private sendTicks(hub: HubState, now: number, effects: HubState['effects']) {
    if (hub.room.mode !== 'impostor') {
      this.broadcast(JSON.stringify({ t: 'tick', ...this.snapshot(hub, now, effects) }));
      return;
    }
    for (const [ws, id] of this.sockets) {
      try {
        ws.send(JSON.stringify({ t: 'tick', ...this.snapshot(hub, now, effects, id) }));
      } catch {
        this.sockets.delete(ws);
      }
    }
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

  private view(hub: HubState, now: number, since: number | null, self?: string): LiveView {
    return this.snapshot(hub, now, effectsSince(hub, now, since), self);
  }

  /** Build every transport snapshot from the same live-state contract. */
  private snapshot(
    hub: HubState,
    now: number,
    effects: HubState['effects'],
    viewer?: string,
  ): LiveView {
    const impostor = hub.room.mode === 'impostor' && viewer !== undefined;
    return {
      now,
      members: publicMembers(hub, now, impostor ? viewer : undefined),
      effects: publicEffects(effects, hub.room.anonymous),
      match: hub.match,
      ...(impostor ? { impostor: impostorView(hub, viewer) } : {}),
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
      impostor: newImpostorGame(),
      connected: (id) => {
        for (const owner of this.sockets.values()) if (owner === id) return true;
        return false;
      },
    };
    for (const r of members.results as Record<string, unknown>[]) {
      const m = memberFromRow(r);
      hub.members.set(m.id, m);
    }
    // До восстановления checkpoint: бою, жизням и счёту ботов есть куда вернуться.
    syncBots(hub, Date.now());
    const saved = this.savedCheckpoint();
    const restored = saved !== undefined && restoreCheckpoint(room, hub, saved);
    this.hub = hub;
    const now = Date.now();
    for (const m of hub.members.values()) {
      if (balanceTeam(hub, m, now)) this.markDirty();
      if (placeIfInvalid(hub, m, now)) this.markDirty();
    }
    // Legacy rooms initialize once; a restored match keeps its lives, score and deadlines.
    // В «Предателе» все начинают за столом собраний, а не там, где их оставила прошлая карта.
    if ((hub.room.teams || hub.room.mode === 'impostor') && !restored) {
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
      // Новичок «Предателя» встаёт за стол; во время партии он зритель-призрак и живым не виден.
      if (hub.room.mode === 'impostor') {
        seatMember(hub, self, chooseSpawn(hub, getMap(hub.room.map), self, Date.now()));
        this.markDirty();
      }
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
    // У ботов нет строк в D1: их состояние живёт только здесь и в checkpoint.
    const statements = [...hub.members.values()].filter((m) => !isBotId(m.id)).map((m) =>
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
