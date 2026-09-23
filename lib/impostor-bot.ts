// Серверный бот режима «Предатель». Живёт в объекте комнаты, как боты боя (lib/bot-brain.ts), и
// ходит через те же ворота, что человек: шаг — пакет присутствия, действие — та же операция
// партии (lib/impostor.ts). Отдельных правил для ботов у сервера нет.
//
// Знает бот только то, что видит сам: живых в радиусе обзора и не за стеной, тела так же. Роли
// других он не знает (предатель знает союзников — как и человек-предатель). Подозрения экипажа
// строятся из собственных наблюдений: кто был рядом с местом убийства в момент убийства.
//
// Видит бот не всё и помнит не точно: чем дальше человек и чем занятее сам бот, тем легче не
// заметить встречу; место и время в памяти плывут, издалека и в темноте людей можно перепутать, а
// старое выцветает и забывается (lib/impostor-bot-memory.ts). Поэтому бот бывает искренне неправ.
//
// Голосов других во время голосования бот не видит — как и человек. Голосом бот не говорит, но
// на собрании пишет в чат: где был, что видел, кого подозревает; читает чужие сообщения и учитывает
// их, решая, кого выбросить за борт. Предатель-бот врёт об алиби, переводит стрелки и договаривается
// с союзниками в командном канале. Разбор текста и фразы — lib/impostor-bot-talk.ts.
//
// Сервер комнаты импортирует этот модуль, а модуль не импортирует сервер: действия и шаги бот
// отдаёт через `BotHooks`, чтобы не было кольца импортов.
import type { HubMember, HubState } from './room-hub-core.ts';
import type { GameMap, MapVent, SabotagePanel } from './maps/types.ts';
import { navFor } from './bot-brain.ts';
import type { BotLevel, BotSpec } from './bot-levels.ts';
import { IMPOSTOR_BOT_LEVELS, type ImpostorBotRules } from './impostor-bot-levels.ts';
import { rayCastWorldObstacle } from './world-collision.ts';
import { readsChat, type ChatChannel, type ChatMessage } from './room-chat.ts';
import { hear, placeOf, plainName, SAY, zoneOf } from './impostor-bot-talk.ts';
import { BotMemory, recalled } from './impostor-bot-memory.ts';
import {
  HOLD_MS,
  isCritical,
  KILL_RANGE,
  PANEL_RANGE,
  REPORT_RANGE,
  TASK_MS,
  TASK_RANGE,
  VENT_RANGE,
  type ImpostorBody,
  type ImpostorGame,
  type ImpostorPlayer,
  type ImpostorResult,
} from './impostor.ts';

/** Скорость ходьбы бота, м/с (человек бегает до 4,8). */
const WALK = 3.4;
/** Как часто бот осматривается: лучи против всей карты не нужны десять раз в секунду. */
const PERCEIVE_MS = 300;
/** Рядом с местом убийства — значит в этом радиусе, в этот промежуток времени. */
const NEAR_BODY = 6;
const NEAR_BODY_MS = 8_000;
/** Радиус обзора: такой же, как у людей в клиенте (lib/impostor-client.ts). */
const visionOf = (g: ImpostorGame, p: ImpostorPlayer | undefined) =>
  !p || !p.alive ? 40 : p.role === 'impostor' ? 12 : g.sabotage?.kind === 'lights' ? 3.5 : 8;

type Point = { x: number; z: number };
type Goal = Point & { kind: 'task' | 'panel' | 'body' | 'hunt' | 'vent' | 'wander' | 'fake'; ref?: string };

export type BotHooks = {
  /** Действие партии от имени бота — та же операция, что шлёт клиент. */
  act: (id: string, op: Record<string, unknown>) => ImpostorResult;
  /** Пакет присутствия от имени бота. */
  move: (m: HubMember, op: { pose: Record<string, unknown>; life: number }) => void;
  /** Сообщение в чат от имени бота; без этого крючка бот молчит. */
  say?: (id: string, channel: ChatChannel, text: string) => boolean;
};

/** Больше стольких сообщений за собрание бот не пишет: собрание — не чат-флуд. */
const MAX_LINES = 5;
/** Чей-то ответ на сообщение появляется не мгновенно: человек тоже читает и печатает. */
const REPLY_MS: [number, number] = [1500, 4000];
/**
 * Чужое обвинение становится поводом голосовать, начиная с этого веса: подробный рассказ
 * очевидца весит 1,5, обычное «он подозрительный» — 1, поручившийся за человека вычитает 1.
 */
const LOUD_ENOUGH = 1.5;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);

function seesPoint(map: GameMap, from: Point, to: Point, range: number) {
  if (distance(from, to) > range) return false;
  const hit = rayCastWorldObstacle([from.x, 1.5, from.z], [to.x, 1.2, to.z], map.colliders);
  return !hit?.hit;
}

export class ImpostorBot {
  readonly id: string;
  private rules: ImpostorBotRules;
  private random: () => number;
  private lastStep = 0;
  private lastPerceive = 0;
  private goal: Goal | null = null;
  private path: Point[] = [];
  private pathFor = '';
  private pathAt = 0;
  private stuckFrom: Point | null = null;
  private stuckAt = 0;
  private work: { station: string; until: number; fake: boolean } | null = null;
  private fakeIndex = 0;
  private ventMoveAt = 0;
  private ventExitAt = 0;
  private game = -1;
  private meetingKey = '';
  private voteAt = 0;
  /** Кого и где видел — так, как это помнится: с пробелами, погрешностью и ошибками. */
  private memory: BotMemory;
  /**
   * Улики против других: не готовые очки, а то, на чём они держатся. Балл считается заново тогда,
   * когда он нужен, потому что воспоминание под ним к этому времени могло выцвести.
   */
  private evidence = new Map<string, { weight: number; strength: number; sure: boolean; at: number }>();
  private seenBodies = new Set<string>();
  private reportTarget: string | null = null;
  /** Где бот был во время игры: отсеки по порядку, для алиби на собрании. */
  private whereabouts: { zone: string; at: number }[] = [];
  /** Собрание: когда началось, что прочитано и что услышано в чате. */
  private meetingAt = 0;
  private chatSeen = new Set<string>();
  /** Кого в чате обвиняли: на кого → кто и с подробностью ли («видел его у тела»). */
  private accused = new Map<string, Map<string, boolean>>();
  private vouched = new Map<string, Set<string>>();
  private reacted = new Set<string>();
  /** Кого предатель решил подставить: сам или по подсказке союзника. */
  private scapegoat: string | null = null;
  /** Реплики, ждущие своей секунды. */
  private lines: { at: number; channel: ChatChannel; text: string }[] = [];
  private said = 0;
  private cheered = -1;
  private pos: Point & { y: number; yaw: number } = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(spec: BotSpec, random: () => number = Math.random) {
    this.id = spec.id;
    this.rules = IMPOSTOR_BOT_LEVELS[spec.level];
    this.random = random;
    this.memory = new BotMemory(this.rules.memory, random);
  }

  setLevel(level: BotLevel) {
    this.rules = IMPOSTOR_BOT_LEVELS[level];
    this.memory.setRules(this.rules.memory);
  }

  /**
   * Насколько бот подозревает `id` прямо сейчас. Улика стоит столько, сколько осталось от
   * воспоминания под ней: чем дольше идёт собрание, тем меньше бот уверен в том, что видел.
   * Насколько честно он в этом сомневается, решает уровень (`think.fades`): новичок держится за
   * первое впечатление, опытный сам себе говорит «я уже не уверен».
   */
  private suspicionOf(id: string, now: number) {
    const clue = this.evidence.get(id);
    if (!clue) return 0;
    const dim = clue.sure ? 1 : 0.75;
    const holds = this.rules.memory.horizon * this.rules.think.holds;
    const left = recalled(clue.strength, now - clue.at, holds) * dim;
    const fades = this.rules.think.fades;
    return clue.weight * (left * fades + clue.strength * dim * (1 - fades));
  }

  /** Подозрения бота-экипажа на его последний такт: для тестов и отладки. */
  suspects(now = this.lastStep) {
    const out = new Map<string, number>();
    for (const id of this.evidence.keys()) out.set(id, this.suspicionOf(id, now));
    return out;
  }

  step(state: HubState, map: GameMap, now: number, hooks: BotHooks) {
    const me = state.members.get(this.id);
    if (!me) return;
    const g = state.impostor;
    const dt = this.lastStep ? Math.min(0.5, Math.max(0, now - this.lastStep) / 1000) : 0.1;
    this.lastStep = now;
    if (g.game !== this.game) this.resetGame(g.game);
    // Новая жизнь (посадили за стол, переползли вентиляцией) — считаем позу заново.
    this.pos = { x: me.pose.x, y: me.pose.y, z: me.pose.z, yaw: me.pose.yaw };
    const p = g.players[this.id];
    let moving = false;
    if (g.phase === 'play' && p && !p.left) {
      if (now - this.lastPerceive >= PERCEIVE_MS) {
        this.lastPerceive = now;
        this.perceive(state, map, now, p);
      }
      moving =
        p.role === 'crew'
          ? this.crew(state, map, now, hooks, p, dt)
          : p.alive
            ? this.impostor(state, map, now, hooks, p, dt)
            : this.wander(map, now, dt);
    } else {
      this.goal = null;
      this.path = [];
      this.work = null;
      const talking = !!p?.alive && !p.left && (g.phase === 'meeting' || g.phase === 'voting');
      if (talking) this.discuss(state, map, now, p);
      else if (g.phase !== 'eject') this.meetingAt = 0;
      if (g.phase === 'voting' && p?.alive) this.vote(state, now, hooks, p);
      if (g.phase === 'ended' && p && !p.left) this.cheer(g, now);
    }
    this.speak(now, hooks);
    hooks.move(me, {
      life: me.life,
      pose: {
        x: this.pos.x,
        y: this.pos.y,
        z: this.pos.z,
        yaw: this.pos.yaw,
        stance: 'stand',
        moving,
        speed: moving ? WALK * this.rules.speed : 0,
        forward: moving ? 1 : 0,
        strafe: 0,
        pitch: 0,
        tool: 'other',
        working: !!this.work,
      },
    });
  }

  private resetGame(game: number) {
    this.game = game;
    this.memory.forget();
    this.evidence.clear();
    this.seenBodies.clear();
    this.reportTarget = null;
    this.goal = null;
    this.path = [];
    this.work = null;
    this.meetingKey = '';
    this.whereabouts = [];
    this.meetingAt = 0;
    this.scapegoat = null;
    this.lines = [];
  }

  // ------------------------------------------------------------ наблюдение

  private perceive(state: HubState, map: GameMap, now: number, p: ImpostorPlayer) {
    const g = state.impostor;
    const range = visionOf(g, p);
    const zone = zoneOf(map, this.pos);
    if (zone && this.whereabouts[this.whereabouts.length - 1]?.zone !== zone) {
      this.whereabouts.push({ zone, at: now });
      if (this.whereabouts.length > 20) this.whereabouts.shift();
    }
    // С кем можно спутать того, кого не разглядели: участники партии с их цветами.
    const others = Object.keys(g.players).flatMap((id) => {
      const color = state.members.get(id)?.color;
      return color ? [{ id, color }] : [];
    });
    const dark = g.sabotage?.kind === 'lights';
    for (const [id, other] of Object.entries(g.players)) {
      if (id === this.id || !other.alive || other.left || other.vent) continue;
      const m = state.members.get(id);
      if (!m || !seesPoint(map, this.pos, m.pose, range)) continue;
      this.memory.see(now, id, m.pose, { map, from: this.pos, range, busy: !!this.work, dark, others });
    }
    for (const body of g.bodies) {
      const key = body.victim + ':' + body.at;
      if (this.seenBodies.has(key) || !seesPoint(map, this.pos, body, range)) continue;
      // Невнимательный может пройти мимо — но в следующий осмотр снова может заметить.
      if (this.random() > this.rules.notice) continue;
      this.seenBodies.add(key);
      if (p.role === 'crew') this.suspectAround(body, now);
      if (p.alive && p.role === 'crew') this.reportTarget = body.victim;
    }
  }

  /**
   * Кто на собственной памяти был рядом с местом, когда там убили. Улика весит ровно столько,
   * насколько бот уверен в воспоминании: смутное «вроде кто-то мелькал» уликой не станет, а
   * перепутанный человек попадёт под подозрение зря — как это и бывает со свидетелями.
   */
  private suspectAround(body: ImpostorBody, now: number) {
    for (const seen of this.memory.recall(now)) {
      if (seen.who === body.victim || seen.who === this.id) continue;
      const apart = Math.abs(seen.at - body.at);
      if (apart > NEAR_BODY_MS) continue;
      const d = distance(seen, body);
      if (d > NEAR_BODY) continue;
      // Вплотную к жертве почти в момент убийства — почти улика.
      const weight = d < 3 && apart < 1500 ? 3 : d < 3 ? 2 : 1;
      const known = this.evidence.get(seen.who);
      if (known && known.weight * known.strength >= weight * seen.strength) continue;
      this.evidence.set(seen.who, { weight, strength: seen.strength, sure: seen.sure, at: seen.at });
    }
  }

  // ---------------------------------------------------------------- экипаж

  private crew(state: HubState, map: GameMap, now: number, hooks: BotHooks, p: ImpostorPlayer, dt: number) {
    const g = state.impostor;
    // Нашёл тело — идём репортить (призрак не репортит).
    if (p.alive && this.reportTarget) {
      const body = g.bodies.find((b) => b.victim === this.reportTarget);
      if (!body) this.reportTarget = null;
      else {
        this.work = null;
        if (distance(this.pos, body) <= REPORT_RANGE - 0.8) {
          hooks.act(this.id, { action: 'report', body: body.victim });
          this.reportTarget = null;
          return false;
        }
        return this.moveTo(map, now, dt, { x: body.x, z: body.z, kind: 'body', ref: body.victim });
      }
    }
    // Авария: живые, кто умеет, идут чинить.
    const s = g.sabotage;
    if (p.alive && s && this.rules.repairs && (isCritical(s.kind) || s.kind === 'lights')) {
      const panel = this.repairPanel(map, s.kind, s.fixed, s.holds, now);
      if (panel) {
        this.work = null;
        if (distance(this.pos, panel) <= PANEL_RANGE - 0.4) {
          hooks.act(this.id, { action: 'fix', panel: panel.id });
          return false;
        }
        return this.moveTo(map, now, dt, { x: panel.x, z: panel.z, kind: 'panel', ref: panel.id });
      }
    }
    return this.doTasks(state, map, now, hooks, p, dt, false);
  }

  /**
   * Какой пульт чинить. Реактор держат двое: если пульт уже держит кто-то другой, бот идёт
   * к свободному — это видно всем по счётчику стабилизаторов. Иначе расходятся по номеру.
   */
  private repairPanel(
    map: GameMap,
    kind: string,
    fixed: string[],
    holds: Record<string, { by: string; at: number }>,
    now: number,
  ) {
    const panels = map.panels.filter((x) => x.sabotage === kind && !(kind === 'o2' && fixed.includes(x.id)));
    if (!panels.length) return null;
    if (kind === 'reactor') {
      const heldByOther = (id: string) => {
        const h = holds[id];
        return !!h && h.by !== this.id && now - h.at <= HOLD_MS;
      };
      const mine = panels.find((x) => holds[x.id]?.by === this.id && now - holds[x.id].at <= HOLD_MS);
      if (mine) return mine;
      const free = panels.filter((x) => !heldByOther(x.id));
      let hash = 0;
      for (const c of this.id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
      const pool = free.length ? free : panels;
      return pool[hash % pool.length];
    }
    return panels.reduce<SabotagePanel>((best, x) => (distance(this.pos, x) < distance(this.pos, best) ? x : best), panels[0]);
  }

  /** Задания по порядку (настоящие или, у предателя, для вида). Всё сделано — бродит. */
  private doTasks(
    state: HubState,
    map: GameMap,
    now: number,
    hooks: BotHooks,
    p: ImpostorPlayer,
    dt: number,
    fake: boolean,
  ) {
    const g = state.impostor;
    if (this.work) {
      if (now < this.work.until) return false;
      if (!this.work.fake) hooks.act(this.id, { action: 'task.done', station: this.work.station });
      else this.fakeIndex++;
      this.work = null;
    }
    // Связь нарушена: список заданий пропал — бот, как человек, просто бродит.
    const blind = g.sabotage?.kind === 'comms';
    const todo = blind ? [] : fake ? [p.tasks[this.fakeIndex % Math.max(1, p.tasks.length)]].filter(Boolean) : p.tasks.filter((t) => !t.done);
    const station = todo
      .map((t) => map.stations.find((st) => st.id === t.station))
      .filter((st) => !!st)
      .sort((a, b) => distance(this.pos, a) - distance(this.pos, b))[0];
    if (!station) return this.wander(map, now, dt);
    if (distance(this.pos, station) <= TASK_RANGE - 0.6) {
      const until = now + TASK_MS[station.kind] * this.rules.taskTime + 300;
      if (fake) this.work = { station: station.id, until, fake: true };
      else if (hooks.act(this.id, { action: 'task.start', station: station.id }).ok)
        this.work = { station: station.id, until, fake: false };
      return false;
    }
    return this.moveTo(map, now, dt, { x: station.x, z: station.z, kind: fake ? 'fake' : 'task', ref: station.id });
  }

  private wander(map: GameMap, now: number, dt: number) {
    if (!this.goal || this.goal.kind !== 'wander' || distance(this.pos, this.goal) < 1.2) {
      const spots = map.stations;
      if (!spots.length) return false;
      const spot = spots[Math.floor(this.random() * spots.length)];
      this.goal = { x: spot.x, z: spot.z, kind: 'wander' };
    }
    return this.moveTo(map, now, dt, this.goal);
  }

  // -------------------------------------------------------------- предатель

  private impostor(state: HubState, map: GameMap, now: number, hooks: BotHooks, p: ImpostorPlayer, dt: number) {
    const g = state.impostor;
    // В вентиляции: переползти в соседнюю решётку и вылезти там.
    if (p.vent) {
      if (this.ventMoveAt && now >= this.ventMoveAt) {
        const vent = map.vents.find((v) => v.id === p.vent);
        const link = vent?.links[Math.floor(this.random() * vent.links.length)];
        if (link) hooks.act(this.id, { action: 'vent.move', vent: link });
        this.ventMoveAt = 0;
      } else if (!this.ventMoveAt && now >= this.ventExitAt) hooks.act(this.id, { action: 'vent.exit' });
      return false;
    }
    // Авария — время от времени, когда можно.
    const kinds = this.rules.sabotage.filter((k) => map.panels.some((x) => x.sabotage === k));
    if (kinds.length && !g.sabotage && g.sabotageReadyAt <= now && this.random() < 0.02)
      hooks.act(this.id, { action: 'sabotage', kind: kinds[Math.floor(this.random() * kinds.length)] });

    // Уходим от тела через вентиляцию.
    if (this.goal?.kind === 'vent') {
      const vent = map.vents.find((v) => v.id === this.goal?.ref);
      if (vent && distance(this.pos, vent) <= VENT_RANGE - 0.5) {
        if (hooks.act(this.id, { action: 'vent.enter', vent: vent.id }).ok) {
          this.ventMoveAt = now + 1000;
          this.ventExitAt = now + 2500;
        }
        this.goal = null;
        return false;
      }
      if (vent) return this.moveTo(map, now, dt, this.goal);
    }

    if (p.killReadyAt <= now) {
      const target = this.pickTarget(state, map, p);
      if (target) {
        this.work = null;
        const m = state.members.get(target)!;
        if (distance(this.pos, m.pose) <= KILL_RANGE - 0.4) {
          if (hooks.act(this.id, { action: 'kill', target }).ok) {
            this.afterKill(map);
            // Хитрый предатель сообщает союзникам, чтобы те не наткнулись на тело первыми.
            const victim = this.nameOf(state, target);
            if (this.rules.lying.plansWithAllies && victim && this.allies(g).length && this.random() < 0.6)
              this.queue(now, 'team', this.pick(SAY.killedTeam(victim, placeOf(zoneOf(map, m.pose)))));
          }
          return false;
        }
        return this.moveTo(map, now, dt, { x: m.pose.x, z: m.pose.z, kind: 'hunt', ref: target });
      }
    }
    if (this.rules.fakeTasks) return this.doTasks(state, map, now, hooks, p, dt, true);
    return this.wander(map, now, dt);
  }

  /** Ближайший видимый член экипажа, которого можно убить без свидетелей (если бот осторожен). */
  private pickTarget(state: HubState, map: GameMap, p: ImpostorPlayer) {
    const g = state.impostor;
    const range = visionOf(g, p);
    const living = Object.values(g.players).filter((x) => x.alive && !x.left && x.id !== this.id);
    let best: string | null = null,
      bestDistance = Infinity;
    for (const victim of living) {
      if (victim.role === 'impostor') continue;
      const m = state.members.get(victim.id);
      if (!m || !seesPoint(map, this.pos, m.pose, range)) continue;
      const d = distance(this.pos, m.pose);
      if (d >= bestDistance) continue;
      if (this.rules.careful) {
        // Свидетель — любой другой живой не-союзник, который видит жертву.
        const witnessed = living.some((w) => {
          if (w.id === victim.id || w.role === 'impostor' || w.vent) return false;
          const wm = state.members.get(w.id);
          return !!wm && seesPoint(map, wm.pose, m.pose, visionOf(g, w));
        });
        if (witnessed) continue;
      }
      best = victim.id;
      bestDistance = d;
    }
    return best;
  }

  private afterKill(map: GameMap) {
    if (this.rules.vents) {
      const vent = map.vents
        .filter((v) => distance(this.pos, v) < 10)
        .sort((a, b) => distance(this.pos, a) - distance(this.pos, b))[0] as MapVent | undefined;
      if (vent) {
        this.goal = { x: vent.x, z: vent.z, kind: 'vent', ref: vent.id };
        this.path = [];
        return;
      }
    }
    // Без вентиляции — уйти к далёкому пульту, будто занят делом.
    const far = map.stations.filter((st) => distance(this.pos, st) > 15);
    const spot = far[Math.floor(this.random() * far.length)];
    if (spot) this.goal = { x: spot.x, z: spot.z, kind: 'wander' };
  }

  // ------------------------------------------------------------ собрание

  /** Такт бота на собрании: начать разговор, прочитать новое в чате. */
  private discuss(state: HubState, map: GameMap, now: number, p: ImpostorPlayer) {
    if (!this.meetingAt) this.openMeeting(state, map, now, p);
    for (const entry of state.chat ?? []) {
      const m = entry.message;
      // Пара секунд до того, как бот заметил собрание, — это тоже собрание: фазу он видит тиком позже.
      if (m.at < this.meetingAt - 2000 || this.chatSeen.has(m.id) || !readsChat(entry, this.id)) continue;
      this.chatSeen.add(m.id);
      if (m.from !== this.id) this.listen(state, map, now, p, m);
    }
  }

  /** Собрание началось: что бот скажет сам, пока его ни о чём не спросили. */
  private openMeeting(state: HubState, map: GameMap, now: number, p: ImpostorPlayer) {
    const g = state.impostor;
    this.meetingAt = now;
    this.chatSeen.clear();
    this.accused.clear();
    this.vouched.clear();
    this.reacted.clear();
    this.lines = [];
    this.said = 0;
    if (p.role === 'impostor') this.scapegoat = null;
    const meeting = g.meeting;
    const caller = meeting?.caller === this.id;
    const body = meeting?.reason === 'report' ? g.bodies.find((b) => b.victim === meeting.body) : undefined;
    const victim = body ? this.nameOf(state, body.victim) : null;
    const bodyPlace = body ? placeOf(zoneOf(map, body)) : '';
    const said: string[] = [];
    // Не каждый бот разговорчив: необязательные реплики говорит с вероятностью уровня.
    const maybe = (text: string) => {
      if (this.random() < this.rules.chat) said.push(text);
    };
    if (p.role === 'crew') {
      const [suspect, score] = this.topSuspect(g, now);
      const who = suspect ? this.nameOf(state, suspect) : null;
      if (caller && body) said.push(this.pick(SAY.foundBody(victim, bodyPlace)));
      else if (caller) said.push(this.pick(who && score >= 1 ? SAY.buttonSuspect(who) : SAY.button));
      // Чем крепче воспоминание, тем увереннее фраза: «точно он», «был рядом», «вроде мелькал».
      // Планка — своя на каждом уровне: то, что новичок назовёт уликой, опытный считает догадкой.
      const sure = this.rules.think.suspectAt;
      if (who && score >= sure * 1.6) said.push(this.pick(SAY.sawKill(who, victim)));
      else if (who && score >= sure) said.push(this.pick(SAY.nearBody(who, bodyPlace || 'у места убийства')));
      else if (who && score >= sure * 0.4) maybe(this.pick(SAY.hunch(who)));
      // Нашедший тело без улик не отмалчивается, а спрашивает остальных.
      else if (caller && body) said.push(this.pick(SAY.askWho(bodyPlace)));
      else maybe(this.pick(SAY.noClue));
      const buddy = this.companion(state, now);
      const here = placeOf(this.lastZone());
      maybe(this.pick(buddy ? SAY.alibiWith(here, buddy) : SAY.alibi(here)));
      if (!(who && score >= sure) && this.random() < 0.5) maybe(this.pick(SAY.suggestSkip));
    } else {
      if (caller && body) said.push(this.pick(SAY.foundBodyImpostor(victim, bodyPlace)));
      else if (caller) said.push(this.pick(SAY.button));
      maybe(this.pick(SAY.alibi(placeOf(this.alibiZone(map, body)))));
      const lying = this.rules.lying;
      const reporter = meeting?.reason === 'report' && !caller ? meeting.caller : null;
      const crew = this.livingCrew(g).filter((id) => id !== reporter);
      if (reporter && this.isLivingCrew(g, reporter) && this.random() < lying.blameReporter) this.scapegoat = reporter;
      else if (crew.length && this.random() < lying.blameRandom)
        this.scapegoat = crew[Math.floor(this.random() * crew.length)];
      const who = this.scapegoat ? this.nameOf(state, this.scapegoat) : null;
      if (who) said.push(this.pick(this.scapegoat === reporter ? SAY.blameReporter(who) : SAY.blame(who)));
      // Союзникам — кого топим, чтобы голоса не разбежались.
      if (who && lying.plansWithAllies && this.allies(g).length) this.queue(now + 500, 'team', this.pick(SAY.planTeam(who)));
      if (!who) maybe(this.pick(SAY.shrug));
    }
    // Первая реплика — через пару секунд, дальше — с паузами, как пишет человек.
    let at = now + 1200 + this.random() * 3500;
    for (const text of said) {
      this.queue(at, 'all', text);
      at += 2200 + this.random() * 3000;
    }
  }

  /** Бот прочитал чужое сообщение: подсчитать обвинения и, если нужно, ответить. */
  private listen(state: HubState, map: GameMap, now: number, p: ImpostorPlayer, m: ChatMessage) {
    const g = state.impostor;
    // Живые участники, кроме автора: только их и можно обвинить или защитить.
    const names: [string, string][] = Object.values(g.players)
      .filter((x) => x.alive && !x.left && x.id !== m.from)
      .flatMap((x) => {
        const name = this.nameOf(state, x.id);
        return name ? [[x.id, name] as [string, string]] : [];
      });
    const heard = hear(m.text, names);
    const target = heard.named[0];
    // Союзник-предатель в своём канале подсказывает, кого топить.
    if (m.channel === 'team' && p.role === 'impostor') {
      if (target && this.isLivingCrew(g, target)) this.scapegoat = target;
      return;
    }
    if (!target) return;
    if (heard.vouch) {
      // Уровень, который поручительств не слушает, их и не запоминает.
      if (this.rules.think.vouch <= 0) return;
      const said = this.vouched.get(target) ?? new Set<string>();
      said.add(m.from);
      this.vouched.set(target, said);
      return;
    }
    if (!heard.accuse) return;
    const blamed = this.accused.get(target) ?? new Map<string, boolean>();
    blamed.set(m.from, heard.detail || !!blamed.get(m.from));
    this.accused.set(target, blamed);
    const reply = now + REPLY_MS[0] + this.random() * (REPLY_MS[1] - REPLY_MS[0]);
    const accuser = this.nameOf(state, m.from);
    if (target === this.id) {
      if (this.reacted.has('me')) return;
      this.reacted.add('me');
      if (p.role === 'crew') {
        this.queue(reply, 'all', this.pick(SAY.denyCrew(placeOf(this.lastZone()))));
        // Сам бот точно не предатель — значит, обвинивший ошибается или врёт. Такая улика не
        // выцветает: это не мельком увиденная сцена, а сказанное только что и прямо ему. И вслух
        // он это тоже говорит: молча передуманное собрание не услышит.
        const counters = this.rules.think.counters;
        if (counters > 0 && accuser) {
          this.evidence.set(m.from, { weight: counters, strength: 1, sure: true, at: now });
          this.queue(reply + 2000, 'all', this.pick(SAY.counter(accuser)));
        }
      } else {
        this.queue(reply, 'all', this.pick(SAY.denyImpostor(placeOf(this.alibiZone(map)))));
        if (accuser && this.isLivingCrew(g, m.from) && this.random() < this.rules.lying.blameReporter) {
          this.scapegoat = m.from;
          this.queue(reply + 2500, 'all', this.pick(SAY.counter(accuser)));
        }
      }
      return;
    }
    const who = this.nameOf(state, target);
    if (!who || this.reacted.has('agree')) return;
    if (p.role === 'crew') {
      // Поддерживает вслух только то, что видел сам; чужие слова учтёт при голосовании.
      if (this.rules.think.agrees && this.suspicionOf(target, now) >= this.rules.think.suspectAt * 0.6) {
        this.reacted.add('agree');
        this.queue(reply, 'all', this.pick(SAY.agree(who)));
      }
    } else if (this.isLivingCrew(g, target)) {
      // Предатель охотно подхватывает обвинение невиновного.
      if (this.random() < this.rules.lying.joinsBlame) {
        this.reacted.add('agree');
        this.scapegoat ??= target;
        this.queue(reply, 'all', this.pick(SAY.agree(who)));
      }
    } else if (this.random() < this.rules.lying.defendsAlly) {
      this.reacted.add('agree');
      this.queue(reply, 'all', this.pick(SAY.defendAlly(who)));
    }
  }

  /** Сказать всё, чему пришло время. */
  private speak(now: number, hooks: BotHooks) {
    if (!this.lines.length) return;
    const due = this.lines.filter((l) => l.at <= now);
    if (!due.length) return;
    this.lines = this.lines.filter((l) => l.at > now);
    for (const line of due) {
      if (this.said >= MAX_LINES) break;
      if (hooks.say?.(this.id, line.channel, line.text)) this.said++;
    }
  }

  private queue(at: number, channel: ChatChannel, text: string) {
    this.lines.push({ at, channel, text });
  }

  /** В конце партии иногда пишет «gg». */
  private cheer(g: ImpostorGame, now: number) {
    if (this.cheered === g.game) return;
    this.cheered = g.game;
    this.said = 0;
    if (this.random() < 0.35 * this.rules.chat) this.queue(now + 1500 + this.random() * 4000, 'all', this.pick(SAY.goodGame));
  }

  // ------------------------------------------------------------ голосование

  private vote(state: HubState, now: number, hooks: BotHooks, p: ImpostorPlayer) {
    const g = state.impostor;
    const key = `${g.game}:${g.meeting?.caller}:${g.until}`;
    if (this.meetingKey !== key) {
      this.meetingKey = key;
      const [from, to] = this.rules.voteDelay;
      this.voteAt = now + (from + this.random() * (to - from)) * 1000;
    }
    if (now < this.voteAt || this.id in g.votes) return;
    this.voteAt = Infinity;
    const living = (id: string) => {
      const x = g.players[id];
      return !!x && x.alive && !x.left && id !== this.id;
    };
    const think = this.rules.think;
    // Чужие слова: каждое обвинение весит по доверию уровня, подробное — с прибавкой; поручившиеся
    // за этого человека вычитаются.
    const talk = (id: string) => {
      let sum = 0;
      for (const detail of this.accused.get(id)?.values() ?? []) sum += think.trust + (detail ? think.detail : 0);
      return sum - think.vouch * (this.vouched.get(id)?.size ?? 0);
    };
    let target = 'skip';
    if (p.role === 'crew') {
      // Своя улика весит столько, сколько от неё осталось в памяти; чужие слова — по доверию.
      let best = 0;
      for (const id of Object.keys(g.players)) {
        if (!living(id)) continue;
        const score = this.suspicionOf(id, now) + talk(id);
        if (score >= think.suspectAt && score > best) {
          best = score;
          target = id;
        }
      }
      if (target === 'skip') {
        // Своих улик не хватило: идём за самым громким обвинением, а иначе — наугад.
        const loud = this.mostAccused(g, living);
        if (loud && this.random() < think.follows) target = loud;
        else if (this.random() < think.guesses) {
          const pool = Object.keys(g.players).filter(living);
          if (pool.length) target = pool[Math.floor(this.random() * pool.length)];
        }
      }
    } else {
      // Предатель никогда не голосует против своих. Топит того, на кого договорились или на
      // кого и так уже показывают, а без этого хитрый — нашедшего тело.
      const lying = this.rules.lying;
      const crew = (id: string) => living(id) && g.players[id].role === 'crew';
      const loud = this.mostAccused(g, crew);
      const caller = g.meeting?.reason === 'report' ? g.meeting.caller : null;
      if (this.scapegoat && crew(this.scapegoat)) target = this.scapegoat;
      else if (loud && this.random() < lying.joinsBlame) target = loud;
      else if (caller && crew(caller) && this.random() < lying.blameReporter) target = caller;
    }
    if (!hooks.act(this.id, { action: 'vote', target }).ok) return;
    if (this.random() < 0.5 * this.rules.chat) {
      const who = target === 'skip' ? null : this.nameOf(state, target);
      this.queue(now + 300 + this.random() * 1500, 'all', this.pick(who ? SAY.vote(who) : SAY.voteSkip));
    }
  }

  // ------------------------------------------------------------ знания

  /** Самый подозрительный на собственной памяти на эту минуту: [id, очки]. */
  private topSuspect(g: ImpostorGame, now: number): [string | null, number] {
    let best: string | null = null,
      top = 0;
    for (const id of this.evidence.keys()) {
      const x = g.players[id];
      const score = this.suspicionOf(id, now);
      if (x?.alive && !x.left && score > top) {
        best = id;
        top = score;
      }
    }
    return [best, top];
  }

  /**
   * На кого в чате показывают увереннее всего. Одного голоса мало: по чужому слову бот идёт, если
   * это рассказ очевидца с подробностями («видел его у тела») или если на человека показывают
   * хотя бы двое независимо. Иначе достаточно было бы одному громко крикнуть — и этим бессовестно
   * пользовался бы предатель, который на собрании говорит первым.
   */
  private mostAccused(g: ImpostorGame, allowed: (id: string) => boolean) {
    let best: string | null = null,
      top = LOUD_ENOUGH - 0.001;
    for (const [id, who] of this.accused) {
      let weight = -(this.vouched.get(id)?.size ?? 0);
      for (const detail of who.values()) weight += detail ? 1.5 : 1;
      if (allowed(id) && g.players[id] && weight > top) {
        best = id;
        top = weight;
      }
    }
    return best;
  }

  /** Кто был рядом последние секунды игры — живой свидетель алиби. */
  private companion(state: HubState, now: number) {
    const g = state.impostor;
    const seen = this.memory.latest(now, (id) => {
      const x = g.players[id];
      return !!x && x.alive && !x.left;
    });
    return seen ? this.nameOf(state, seen.who) : null;
  }

  private lastZone() {
    return this.whereabouts[this.whereabouts.length - 1]?.zone ?? '';
  }

  /**
   * Где предатель «был». Правду говорит, если она его не выдаёт; убил в том же отсеке, где лежит
   * тело, — называет отсек своего ложного задания.
   */
  private alibiZone(map: GameMap, body?: { x: number; z: number }) {
    const real = this.lastZone();
    if (real && (!body || zoneOf(map, body) !== real)) return real;
    const zones = map.stations.map((st) => zoneOf(map, st)).filter((z) => z && z !== real);
    return zones.length ? zones[Math.floor(this.random() * zones.length)] : real;
  }

  private allies(g: ImpostorGame) {
    return Object.values(g.players).filter((x) => x.role === 'impostor' && x.alive && !x.left && x.id !== this.id);
  }

  private livingCrew(g: ImpostorGame) {
    return Object.values(g.players)
      .filter((x) => x.role === 'crew' && x.alive && !x.left)
      .map((x) => x.id);
  }

  private isLivingCrew(g: ImpostorGame, id: string) {
    const x = g.players[id];
    return !!x && x.role === 'crew' && x.alive && !x.left;
  }

  /** Как бот называет участника в чате; в анонимной комнате имён нет — и называть некого. */
  private nameOf(state: HubState, id: string) {
    if (state.room.anonymous) return null;
    const name = state.members.get(id)?.name;
    return name ? plainName(name) || null : null;
  }

  private pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.random() * list.length)];
  }

  // ---------------------------------------------------------------- ходьба

  /** Шаг к цели по сетке проходимости; застрял — выбирает путь заново. */
  private moveTo(map: GameMap, now: number, dt: number, goal: Goal) {
    const key = `${goal.kind}:${goal.ref ?? ''}:${Math.round(goal.x)}:${Math.round(goal.z)}`;
    if (key !== this.pathFor || now - this.pathAt > 4000 || !this.path.length) {
      const nav = navFor(map);
      const found = nav.find(this.pos.x, this.pos.z, goal.x, goal.z);
      this.path = found ? found.map((n) => ({ x: n.x, z: n.z })) : [];
      this.path.push({ x: goal.x, z: goal.z });
      this.pathFor = key;
      this.pathAt = now;
      this.goal = goal;
    }
    let budget = WALK * this.rules.speed * dt;
    let moved = false;
    while (budget > 1e-3 && this.path.length) {
      const next = this.path[0];
      const d = distance(this.pos, next);
      if (d < 0.05) {
        this.path.shift();
        continue;
      }
      const stepLen = Math.min(budget, d);
      this.pos.x += ((next.x - this.pos.x) / d) * stepLen;
      this.pos.z += ((next.z - this.pos.z) / d) * stepLen;
      // Вперёд — это (-sin yaw, -cos yaw), как у людей.
      this.pos.yaw = Math.atan2(-(next.x - this.pos.x), -(next.z - this.pos.z)) || this.pos.yaw;
      budget -= stepLen;
      moved = true;
      if (stepLen >= d) this.path.shift();
    }
    this.pos.y = map.groundHeight(this.pos.x, this.pos.z, this.pos.y);
    // Застрял (сервер не пускает, тело мешает) — полторы секунды без продвижения: новый путь.
    if (!this.stuckFrom || distance(this.stuckFrom, this.pos) > 0.5) {
      this.stuckFrom = { x: this.pos.x, z: this.pos.z };
      this.stuckAt = now;
    } else if (now - this.stuckAt > 1500) {
      this.path = [];
      this.stuckAt = now;
      if (goal.kind === 'wander') this.goal = null;
    }
    return moved;
  }
}

/**
 * Такт всех ботов «Предателя». Вызывает сервер комнаты вместо `stepBots` боя; действия и шаги
 * приходят в `hooks`, чтобы модуль не зависел от сервера.
 */
export function stepImpostorBots(
  state: HubState,
  brains: Map<string, ImpostorBot>,
  map: GameMap,
  now: number,
  hooks: BotHooks,
  random: () => number = Math.random,
) {
  const specs = state.room.bots;
  for (const id of brains.keys()) if (!specs.some((b) => b.id === id)) brains.delete(id);
  for (const spec of specs) {
    let brain = brains.get(spec.id);
    if (!brain) {
      brain = new ImpostorBot(spec, random);
      brains.set(spec.id, brain);
    }
    brain.setLevel(spec.level);
    brain.step(state, map, now, hooks);
  }
}
