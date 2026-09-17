// Серверный бот режима «Предатель». Живёт в объекте комнаты, как боты боя (lib/bot-brain.ts), и
// ходит через те же ворота, что человек: шаг — пакет присутствия, действие — та же операция
// партии (lib/impostor.ts). Отдельных правил для ботов у сервера нет.
//
// Знает бот только то, что видит сам: живых в радиусе обзора и не за стеной, тела так же. Роли
// других он не знает (предатель знает союзников — как и человек-предатель). Подозрения экипажа
// строятся из собственных наблюдений: кто был рядом с местом убийства в момент убийства.
//
// Голосов других во время голосования бот не видит — как и человек. Голосом бот не говорит,
// поэтому на собрании он только голосует.
//
// Сервер комнаты импортирует этот модуль, а модуль не импортирует сервер: действия и шаги бот
// отдаёт через `BotHooks`, чтобы не было кольца импортов.
import type { HubMember, HubState } from './room-hub-core.ts';
import type { GameMap, MapVent, SabotagePanel } from './maps/types.ts';
import { navFor } from './bot-brain.ts';
import type { BotLevel, BotSpec } from './bot-levels.ts';
import { IMPOSTOR_BOT_LEVELS, type ImpostorBotRules } from './impostor-bot-levels.ts';
import { rayCastWorldObstacle } from './world-collision.ts';
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
type Sighting = { x: number; z: number; at: number };

export type BotHooks = {
  /** Действие партии от имени бота — та же операция, что шлёт клиент. */
  act: (id: string, op: Record<string, unknown>) => ImpostorResult;
  /** Пакет присутствия от имени бота. */
  move: (m: HubMember, op: { pose: Record<string, unknown>; life: number }) => void;
};

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
  private sightings = new Map<string, Sighting[]>();
  private suspicion = new Map<string, number>();
  private seenBodies = new Set<string>();
  private reportTarget: string | null = null;
  private pos: Point & { y: number; yaw: number } = { x: 0, y: 0, z: 0, yaw: 0 };

  constructor(spec: BotSpec, random: () => number = Math.random) {
    this.id = spec.id;
    this.rules = IMPOSTOR_BOT_LEVELS[spec.level];
    this.random = random;
  }

  setLevel(level: BotLevel) {
    this.rules = IMPOSTOR_BOT_LEVELS[level];
  }

  /** Подозрения бота-экипажа: для тестов и отладки. */
  suspects() {
    return new Map(this.suspicion);
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
      if (g.phase === 'voting' && p?.alive) this.vote(state, now, hooks, p);
    }
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
    this.sightings.clear();
    this.suspicion.clear();
    this.seenBodies.clear();
    this.reportTarget = null;
    this.goal = null;
    this.path = [];
    this.work = null;
    this.meetingKey = '';
  }

  // ------------------------------------------------------------ наблюдение

  private perceive(state: HubState, map: GameMap, now: number, p: ImpostorPlayer) {
    const g = state.impostor;
    const range = visionOf(g, p);
    for (const [id, other] of Object.entries(g.players)) {
      if (id === this.id || !other.alive || other.left || other.vent) continue;
      const m = state.members.get(id);
      if (!m || !seesPoint(map, this.pos, m.pose, range)) continue;
      const list = this.sightings.get(id) ?? [];
      list.push({ x: m.pose.x, z: m.pose.z, at: now });
      while (list.length && now - list[0].at > this.rules.memory) list.shift();
      this.sightings.set(id, list);
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

  /** Кто на собственной памяти был рядом с местом, когда там убили. */
  private suspectAround(body: ImpostorBody, now: number) {
    for (const [id, list] of this.sightings) {
      if (id === body.victim) continue;
      for (const s of list) {
        // Забытое не в счёт: память у ботов разная.
        if (now - s.at > this.rules.memory || Math.abs(s.at - body.at) > NEAR_BODY_MS) continue;
        const d = distance(s, body);
        if (d > NEAR_BODY) continue;
        // Вплотную к жертве почти в момент убийства — почти улика.
        const score = d < 3 && Math.abs(s.at - body.at) < 1500 ? 3 : d < 3 ? 2 : 1;
        this.suspicion.set(id, Math.max(this.suspicion.get(id) ?? 0, score));
        break;
      }
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
          if (hooks.act(this.id, { action: 'kill', target }).ok) this.afterKill(map);
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
    let target = 'skip';
    if (p.role === 'crew') {
      let best = 0;
      for (const [id, score] of this.suspicion)
        if (living(id) && score >= this.rules.suspectAt && score > best) {
          best = score;
          target = id;
        }
      // Новичок иногда голосует наугад.
      if (target === 'skip' && this.rules.suspectAt > 10 && this.random() < 0.25) {
        const pool = Object.keys(g.players).filter(living);
        if (pool.length) target = pool[Math.floor(this.random() * pool.length)];
      }
    } else if (this.rules.bandwagon) {
      // Хитрый предатель перекладывает вину на того, кто нашёл тело.
      const caller = g.meeting?.reason === 'report' ? g.meeting.caller : null;
      if (caller && living(caller) && g.players[caller].role === 'crew' && this.random() < 0.6) target = caller;
    }
    hooks.act(this.id, { action: 'vote', target });
    // После голосования подозрение к изгнанному уже ни к чему.
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
