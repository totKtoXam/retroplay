// Режим «Предатель» (в духе Among Us): правила партии, которые ведёт объект комнаты.
// Только чистые функции над HubState, как и lib/room-hub-core.ts.
//
// Главное правило режима — тайна ролей. Сервер знает всё, а клиент получает только
// то, что его игрок и так бы знал (`impostorView`): свою роль, своих союзников-предателей
// (если сам предатель), свои задания и общий прогресс. Кто погиб, живые узнают только на
// собрании; призраков живые не видят и не слышат. Итоговые роли открываются в конце партии.
//
// Проверки мини-игр на сервере нет и быть не может: сервер проверяет то, что проверить
// можно, — игрок жив или призрак, стоит у нужной точки и провёл там не меньше минимального
// времени задания. Убийство, репорт и кнопка собрания проверяются по расстоянию и видимости.
import { rayCastWorldObstacle } from './world-collision.ts';
import { getMap } from './maps/index.ts';
import type { GameMap, MapVent, SabotageKind, SabotagePanel, TaskKind, TaskStation, SpawnPoint } from './maps/types.ts';
import { ONLINE_MS, type Pose } from './model.ts';

export type ImpostorRole = 'crew' | 'impostor';
/**
 * lobby — ждём старта от ведущего; intro — показ ролей; play — игра; meeting — обсуждение;
 * voting — голосование; eject — итог голосования; ended — итог партии.
 */
export type ImpostorPhase = 'lobby' | 'intro' | 'play' | 'meeting' | 'voting' | 'eject' | 'ended';

export { IMPOSTOR_DEFAULTS, IMPOSTOR_LIMITS, type ImpostorSettings } from './impostor-settings.ts';
import type { ImpostorSettings } from './impostor-settings.ts';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 15;
/** Дотянуться до пульта задания, м. */
export const TASK_RANGE = 1.8;
export const KILL_RANGE = 2.2;
export const REPORT_RANGE = 3.5;
/** От центра стола до кнопки: дотягиваешься, стоя у стола или на своём месте за ним. */
export const BUTTON_RANGE = 3.6;
/** Минимальное время у пульта: быстрее мини-игру честно не пройти. */
export const TASK_MS: Record<TaskKind, number> = {
  wires: 2500,
  hold: 3000,
  calibrate: 2500,
  code: 3000,
  upload: 5000,
};
const INTRO_MS = 5000;
const EJECT_MS = 6000;
const ENDED_MS = 12_000;
/** После старта и после собрания кнопка недоступна столько времени. */
const BUTTON_COOLDOWN_MS = 15_000;
/** Кто не присылал ничего дольше, считается вышедшим из партии. */
export const LEFT_MS = 45_000;
/** Дотянуться до пульта аварии и до решётки вентиляции, м. */
export const PANEL_RANGE = 1.8;
export const VENT_RANGE = 1.3;
/** Критическая авария (реактор, O2): столько времени у экипажа на ремонт. */
export const CRITICAL_MS = 45_000;
/** Перерыв между саботажами: после ремонта, старта партии и собрания. */
export const SABOTAGE_COOLDOWN_MS = 30_000;
/**
 * Реактор чинят вдвоём: оба стабилизатора удерживают одновременно. Удержание — это
 * повторяющиеся запросы «fix»; последний считается действующим столько времени.
 */
export const HOLD_MS = 1500;
export const SABOTAGE_KINDS: readonly SabotageKind[] = ['lights', 'comms', 'reactor', 'o2'];
export const isCritical = (kind: SabotageKind) => kind === 'reactor' || kind === 'o2';

export type ImpostorSabotage = {
  kind: SabotageKind;
  /** Для критической аварии — когда предатели победят; 0 — без таймера. */
  until: number;
  /** Отремонтированные пульты (O2 — каждый чинят по разу). */
  fixed: string[];
  /** Кто сейчас держит пульт реактора и с какого запроса. */
  holds: Record<string, { by: string; at: number }>;
};

export type ImpostorTask = { station: string; done: boolean };
export type ImpostorPlayer = {
  id: string;
  role: ImpostorRole;
  alive: boolean;
  /** Вышел из партии: не считается ни живым, ни в заданиях. */
  left: boolean;
  /** Смерть уже известна всем (было собрание, изгнание или выход). */
  revealed: boolean;
  tasks: ImpostorTask[];
  meetingsLeft: number;
  killReadyAt: number;
  /** Начатое задание: у какого пульта и с какого момента. */
  working: { station: string; at: number } | null;
  /** Предатель прячется в этой решётке вентиляции: его не видно, и он не двигается. */
  vent: string | null;
};
export type ImpostorBody = { victim: string; x: number; y: number; z: number; at: number; color: string };
export type ImpostorMeeting = {
  caller: string;
  reason: 'report' | 'button';
  /** Чьё тело нашли (для репорта). */
  body?: string;
};
export type ImpostorGame = {
  phase: ImpostorPhase;
  /** Когда кончается текущая фаза (0 — без таймера). */
  until: number;
  /** Номер партии: растёт с каждым стартом. */
  game: number;
  players: Record<string, ImpostorPlayer>;
  bodies: ImpostorBody[];
  meeting: ImpostorMeeting | null;
  /** Голос: id игрока или 'skip'. */
  votes: Record<string, string>;
  /** Итог голосования: кого изгнали (null — никого) и был ли он предателем. */
  ejected: { id: string | null; impostor: boolean; tie: boolean } | null;
  buttonReadyAt: number;
  winner: ImpostorRole | null;
  winReason: 'tasks' | 'ejected' | 'kills' | 'left' | 'sabotage' | null;
  sabotage: ImpostorSabotage | null;
  /** С этого момента предатели могут устроить следующую аварию. */
  sabotageReadyAt: number;
};

/** Минимум, что нужно о члене комнаты: так модуль не тянет весь room-hub-core. */
export type ImpostorMember = { id: string; seen: number; pose: Pose; life: number; color?: string; name?: string };
export type ImpostorHub = {
  room: { host: string; map: string; impostor: ImpostorSettings; mode: string; anonymous?: boolean };
  members: Map<string, ImpostorMember>;
  impostor: ImpostorGame;
  /**
   * Открыт ли у игрока сокет. Свёрнутая вкладка не шлёт присутствие, но соединение
   * держит — такого игрока из партии не выкидываем.
   */
  connected?: (id: string) => boolean;
};

export const newImpostorGame = (): ImpostorGame => ({
  phase: 'lobby',
  until: 0,
  game: 0,
  players: {},
  bodies: [],
  meeting: null,
  votes: {},
  ejected: null,
  buttonReadyAt: 0,
  winner: null,
  winReason: null,
  sabotage: null,
  sabotageReadyAt: 0,
});

export const isImpostorRoom = (hub: { room: { mode: string } }) => hub.room.mode === 'impostor';

/** Партия идёт: роли розданы и ещё не открыты. */
export const gameActive = (g: ImpostorGame) =>
  g.phase === 'intro' || g.phase === 'play' || g.phase === 'meeting' || g.phase === 'voting' || g.phase === 'eject';

/** Двигаться нельзя: показ ролей, собрание и итог голосования. */
export const movementFrozen = (g: ImpostorGame) =>
  g.phase === 'intro' || g.phase === 'meeting' || g.phase === 'voting' || g.phase === 'eject';

/**
 * Призрак — погибший игрок или зритель, пришедший во время партии. Ходит сквозь стены,
 * живые его не видят и не слышат.
 */
export function isGhost(g: ImpostorGame, id: string) {
  if (!gameActive(g)) return false;
  const p = g.players[id];
  return !p || !p.alive;
}

/** Сколько предателей в партии из `players` игроков. */
export function impostorCount(players: number, wanted: number) {
  const auto = players <= 6 ? 1 : players <= 10 ? 2 : 3;
  // Предателей всегда меньше половины, иначе партия кончится, не начавшись.
  const max = Math.max(1, Math.floor((players - 1) / 2));
  return Math.max(1, Math.min(wanted > 0 ? wanted : auto, max, 3));
}

function shuffle<T>(list: T[], random: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Кто сейчас в сети: они и попадают в новую партию. */
const onlineIds = (hub: ImpostorHub, now: number) =>
  [...hub.members.values()].filter((m) => m.seen > now - ONLINE_MS).map((m) => m.id);

export type ImpostorResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): ImpostorResult => ({ ok: false, error });
const OK: ImpostorResult = { ok: true };

/** Места за столом собраний: по кругу, в порядке id, чтобы у каждого было своё. */
export function seatsFor(map: GameMap, ids: string[]): Map<string, SpawnPoint> {
  const out = new Map<string, SpawnPoint>();
  const m = map.meeting;
  const sorted = [...ids].sort();
  sorted.forEach((id, i) => {
    if (!m) {
      const spawns = map.spawns.red;
      out.set(id, spawns[i % spawns.length]);
      return;
    }
    const a = (i / Math.max(1, sorted.length)) * Math.PI * 2;
    const x = m.x + Math.sin(a) * m.seats,
      z = m.z + Math.cos(a) * m.seats;
    // Лицом к столу: yaw = угол направления от игрока к центру.
    out.set(id, { x, z, yaw: Math.atan2(x - m.x, z - m.z) });
  });
  return out;
}

/**
 * Ведущий начинает партию: роли, задания, все за столом. `place` переносит игрока на
 * место и начинает ему новую жизнь (клиент телепортируется, увидев смену жизни).
 */
export function startGame(
  hub: ImpostorHub,
  self: string,
  now: number,
  place: (id: string, seat: SpawnPoint) => void,
  random: () => number = Math.random,
): ImpostorResult {
  const g = hub.impostor;
  if (!isImpostorRoom(hub)) return fail('Комната не в режиме «Предатель»');
  if (self !== hub.room.host) return fail('Партию начинает ведущий');
  if (gameActive(g)) return fail('Партия уже идёт');
  const ids = onlineIds(hub, now);
  if (ids.length < MIN_PLAYERS) return fail(`Нужно хотя бы ${MIN_PLAYERS} игрока в сети`);
  if (ids.length > MAX_PLAYERS) return fail(`В партии не больше ${MAX_PLAYERS} игроков`);
  const map = getMap(hub.room.map);
  const stations = map.stations;
  if (!stations.length) return fail('На этой карте нет заданий');
  const s = hub.room.impostor;
  const impostors = new Set(shuffle(ids, random).slice(0, impostorCount(ids.length, s.impostors)));
  const perPlayer = Math.min(s.tasksPerPlayer, stations.length);
  const players: Record<string, ImpostorPlayer> = {};
  for (const id of ids)
    players[id] = {
      id,
      role: impostors.has(id) ? 'impostor' : 'crew',
      alive: true,
      left: false,
      revealed: false,
      // У предателей тоже есть список — для прикрытия; выполнить его нельзя.
      tasks: shuffle(stations, random)
        .slice(0, perPlayer)
        .map((st) => ({ station: st.id, done: false })),
      meetingsLeft: s.emergencyMeetings,
      killReadyAt: now + INTRO_MS + s.killCooldownSeconds * 1000,
      working: null,
      vent: null,
    };
  Object.assign(g, newImpostorGame(), {
    phase: 'intro',
    until: now + INTRO_MS,
    game: g.game + 1,
    players,
    buttonReadyAt: now + INTRO_MS + BUTTON_COOLDOWN_MS,
    sabotageReadyAt: now + INTRO_MS + SABOTAGE_COOLDOWN_MS,
  });
  for (const [id, seat] of seatsFor(map, ids)) place(id, seat);
  return OK;
}

/** Ведущий прерывает партию: роли открываются, все возвращаются в лобби. */
export function stopGame(hub: ImpostorHub, self: string): ImpostorResult {
  if (self !== hub.room.host) return fail('Партию останавливает ведущий');
  if (!gameActive(hub.impostor)) return fail('Партия не идёт');
  hub.impostor.phase = 'lobby';
  hub.impostor.until = 0;
  hub.impostor.meeting = null;
  hub.impostor.votes = {};
  hub.impostor.bodies = [];
  hub.impostor.sabotage = null;
  for (const p of Object.values(hub.impostor.players)) p.vent = null;
  return OK;
}

const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** Между двумя позами нет стены: убивать и репортить сквозь стену нельзя. */
function inSight(map: GameMap, a: Pose, b: { x: number; y: number; z: number }) {
  const hit = rayCastWorldObstacle([a.x, a.y + 1, a.z], [b.x, b.y + 1, b.z], map.colliders);
  return !hit?.hit;
}

function livingPlayer(hub: ImpostorHub, id: string) {
  const g = hub.impostor;
  const p = g.players[id];
  const m = hub.members.get(id);
  if (!p || !m || !p.alive || p.left) return null;
  return { p, m };
}

/** Живой игрок не в вентиляции: из решётки нельзя ни убить, ни репортить, ни чинить. */
function activePlayer(hub: ImpostorHub, id: string) {
  const found = livingPlayer(hub, id);
  return found && !found.p.vent ? found : null;
}

export function kill(hub: ImpostorHub, self: string, target: unknown, now: number): ImpostorResult {
  const g = hub.impostor;
  if (g.phase !== 'play') return fail('Сейчас нельзя');
  const killer = activePlayer(hub, self);
  if (!killer || killer.p.role !== 'impostor') return fail('Убивать может только живой предатель вне вентиляции');
  if (typeof target !== 'string') return fail('Не указана цель');
  const victim = livingPlayer(hub, target);
  if (!victim || victim.p.role === 'impostor') return fail('Эту цель нельзя');
  if (killer.p.killReadyAt > now) return fail('Нож ещё не готов');
  const map = getMap(hub.room.map);
  if (distance(killer.m.pose, victim.m.pose) > KILL_RANGE || !inSight(map, killer.m.pose, victim.m.pose))
    return fail('Слишком далеко');
  victim.p.alive = false;
  victim.p.working = null;
  const { x, y, z } = victim.m.pose;
  g.bodies.push({ victim: target, x, y, z, at: now, color: victim.m.color ?? '#c0392b' });
  killer.p.killReadyAt = now + hub.room.impostor.killCooldownSeconds * 1000;
  checkWinner(g, now);
  return OK;
}

function callMeeting(hub: ImpostorHub, meeting: ImpostorMeeting, now: number, place: (id: string, seat: SpawnPoint) => void) {
  const g = hub.impostor;
  g.meeting = meeting;
  g.votes = {};
  g.ejected = null;
  // Всё, что случилось до собрания, теперь известно всем: погибшие отмечены на столе.
  for (const p of Object.values(g.players)) {
    if (!p.alive) p.revealed = true;
    p.working = null;
    // Собрание вытаскивает всех из вентиляции и гасит аварию.
    p.vent = null;
  }
  g.sabotage = null;
  const s = hub.room.impostor;
  if (s.discussionSeconds > 0) {
    g.phase = 'meeting';
    g.until = now + s.discussionSeconds * 1000;
  } else {
    g.phase = 'voting';
    g.until = now + s.votingSeconds * 1000;
  }
  const seated = Object.values(g.players)
    .filter((p) => p.alive && !p.left)
    .map((p) => p.id);
  for (const [id, seat] of seatsFor(getMap(hub.room.map), seated)) place(id, seat);
}

export function report(
  hub: ImpostorHub,
  self: string,
  victim: unknown,
  now: number,
  place: (id: string, seat: SpawnPoint) => void,
): ImpostorResult {
  const g = hub.impostor;
  if (g.phase !== 'play') return fail('Сейчас нельзя');
  const me = activePlayer(hub, self);
  if (!me) return fail('Репортить может только живой игрок');
  const body = g.bodies.find((b) => b.victim === victim);
  if (!body) return fail('Тела нет');
  if (distance(me.m.pose, body) > REPORT_RANGE || !inSight(getMap(hub.room.map), me.m.pose, body))
    return fail('Слишком далеко');
  callMeeting(hub, { caller: self, reason: 'report', body: body.victim }, now, place);
  return OK;
}

export function emergency(
  hub: ImpostorHub,
  self: string,
  now: number,
  place: (id: string, seat: SpawnPoint) => void,
): ImpostorResult {
  const g = hub.impostor;
  if (g.phase !== 'play') return fail('Сейчас нельзя');
  const me = activePlayer(hub, self);
  if (!me) return fail('Кнопку жмёт только живой игрок');
  if (g.sabotage && isCritical(g.sabotage.kind)) return fail('Сначала устраните аварию');
  if (me.p.meetingsLeft <= 0) return fail('Экстренные собрания кончились');
  if (g.buttonReadyAt > now) return fail('Кнопка ещё не готова');
  const meeting = getMap(hub.room.map).meeting;
  if (!meeting || distance(me.m.pose, meeting) > BUTTON_RANGE) return fail('Кнопка на столе собраний');
  me.p.meetingsLeft -= 1;
  callMeeting(hub, { caller: self, reason: 'button' }, now, place);
  return OK;
}

export function vote(hub: ImpostorHub, self: string, target: unknown, now: number): ImpostorResult {
  const g = hub.impostor;
  if (g.phase !== 'voting') return fail('Голосование ещё не началось');
  const me = livingPlayer(hub, self);
  if (!me) return fail('Голосуют только живые');
  if (self in g.votes) return fail('Голос уже отдан');
  if (target !== 'skip' && !(typeof target === 'string' && livingPlayer(hub, target)))
    return fail('За этого игрока голосовать нельзя');
  g.votes[self] = target as string;
  // Все проголосовали — не ждём таймера.
  const voters = Object.values(g.players).filter((p) => p.alive && !p.left);
  if (voters.every((p) => p.id in g.votes)) finishVoting(hub, now);
  return OK;
}

function finishVoting(hub: ImpostorHub, now: number) {
  const g = hub.impostor;
  const tally = new Map<string, number>();
  for (const [voter, target] of Object.entries(g.votes)) {
    // Голос вышедшего или за вышедшего не считается.
    if (!livingPlayer(hub, voter)) continue;
    if (target !== 'skip' && !livingPlayer(hub, target)) continue;
    tally.set(target, (tally.get(target) ?? 0) + 1);
  }
  let best: string | null = null,
    top = 0,
    tie = false;
  for (const [target, count] of tally) {
    if (count > top) {
      best = target;
      top = count;
      tie = false;
    } else if (count === top) tie = true;
  }
  const id = tie || best === 'skip' ? null : best;
  const ejected = id ? g.players[id] : null;
  if (ejected) {
    ejected.alive = false;
    ejected.revealed = true;
  }
  g.ejected = { id, impostor: ejected?.role === 'impostor', tie };
  g.phase = 'eject';
  g.until = now + EJECT_MS;
}

/** Пройдено всё: задания экипажа, включая погибших (призраки доделывают свои). */
export function taskProgress(g: ImpostorGame) {
  let done = 0,
    total = 0;
  for (const p of Object.values(g.players)) {
    if (p.role !== 'crew' || p.left) continue;
    total += p.tasks.length;
    done += p.tasks.filter((t) => t.done).length;
  }
  return { done, total };
}

/**
 * Итог партии, если он уже есть. В игре проверяется сразу после убийства, задания и
 * выхода; во время собрания — только после изгнания, чтобы голосование не обрывалось.
 */
export function checkWinner(g: ImpostorGame, now: number) {
  if (g.phase === 'ended' || g.phase === 'lobby') return false;
  let impostors = 0,
    crew = 0;
  for (const p of Object.values(g.players)) {
    if (!p.alive || p.left) continue;
    if (p.role === 'impostor') impostors++;
    else crew++;
  }
  const progress = taskProgress(g);
  let winner: ImpostorRole | null = null;
  let reason: ImpostorGame['winReason'] = null;
  if (impostors === 0) {
    winner = 'crew';
    reason = g.ejected?.impostor ? 'ejected' : 'left';
  } else if (g.sabotage && isCritical(g.sabotage.kind) && g.sabotage.until > 0 && now >= g.sabotage.until) {
    winner = 'impostor';
    reason = 'sabotage';
  } else if (impostors >= crew) {
    winner = 'impostor';
    reason = crew === 0 || Object.values(g.players).some((p) => p.role === 'crew' && !p.left && !p.alive) ? 'kills' : 'left';
  } else if (progress.total > 0 && progress.done >= progress.total) {
    winner = 'crew';
    reason = 'tasks';
  }
  if (!winner) return false;
  g.phase = 'ended';
  g.until = now + ENDED_MS;
  g.winner = winner;
  g.winReason = reason;
  g.meeting = null;
  g.sabotage = null;
  for (const p of Object.values(g.players)) p.vent = null;
  return true;
}

// ---------------------------------------------------------------- саботаж

/** Предатель устраивает аварию. Одновременно — только одна, и между ними перерыв. */
export function sabotage(hub: ImpostorHub, self: string, kind: unknown, now: number): ImpostorResult {
  const g = hub.impostor;
  if (g.phase !== 'play') return fail('Сейчас нельзя');
  const me = livingPlayer(hub, self);
  if (!me || me.p.role !== 'impostor') return fail('Саботаж устраивает только живой предатель');
  if (!SABOTAGE_KINDS.includes(kind as SabotageKind)) return fail('Неизвестная авария');
  const k = kind as SabotageKind;
  if (!getMap(hub.room.map).panels.some((p) => p.sabotage === k)) return fail('На этой карте такой аварии нет');
  if (g.sabotage) return fail('Авария уже идёт');
  if (g.sabotageReadyAt > now) return fail('Саботаж ещё не готов');
  g.sabotage = { kind: k, until: isCritical(k) ? now + CRITICAL_MS : 0, fixed: [], holds: {} };
  return OK;
}

function panelOf(hub: ImpostorHub, id: unknown): SabotagePanel | undefined {
  return getMap(hub.room.map).panels.find((p) => p.id === id);
}

/**
 * Ремонт у пульта. Свет и связь — один пульт; O2 — каждый пульт по разу; реактор — два
 * пульта одновременно разными игроками (клиент повторяет запрос, пока игрок держит пульт).
 * Чинить может любой живой, в том числе предатель — для прикрытия.
 */
export function fix(hub: ImpostorHub, self: string, panelId: unknown, now: number): ImpostorResult {
  const g = hub.impostor;
  const s = g.sabotage;
  if (g.phase !== 'play' || !s) return fail('Чинить нечего');
  const me = activePlayer(hub, self);
  if (!me) return fail('Чинит только живой игрок');
  const panel = panelOf(hub, panelId);
  if (!panel || panel.sabotage !== s.kind) return fail('Этот пульт не для этой аварии');
  if (distance(me.m.pose, panel) > PANEL_RANGE) return fail('Подойдите к пульту');
  const panels = getMap(hub.room.map).panels.filter((p) => p.sabotage === s.kind);
  if (s.kind === 'reactor') {
    s.holds[panel.id] = { by: self, at: now };
    const holders = panels.map((p) => s.holds[p.id]).filter((h) => h && now - h.at <= HOLD_MS && livingPlayer(hub, h.by));
    const distinct = new Set(holders.map((h) => h!.by));
    if (holders.length < panels.length || distinct.size < panels.length) return OK;
  } else {
    if (!s.fixed.includes(panel.id)) s.fixed.push(panel.id);
    if (panels.some((p) => !s.fixed.includes(p.id))) return OK;
  }
  g.sabotage = null;
  g.sabotageReadyAt = now + SABOTAGE_COOLDOWN_MS;
  return OK;
}

// ---------------------------------------------------------------- вентиляция

function ventOf(hub: ImpostorHub, id: unknown): MapVent | undefined {
  return getMap(hub.room.map).vents.find((v) => v.id === id);
}

/** Предатель залезает в решётку, у которой стоит. */
export function enterVent(hub: ImpostorHub, self: string, ventId: unknown): ImpostorResult {
  const g = hub.impostor;
  if (g.phase !== 'play') return fail('Сейчас нельзя');
  const me = activePlayer(hub, self);
  if (!me || me.p.role !== 'impostor') return fail('В вентиляцию лезет только предатель');
  const vent = ventOf(hub, ventId);
  if (!vent || distance(me.m.pose, vent) > VENT_RANGE) return fail('Подойдите к решётке');
  me.p.vent = vent.id;
  me.p.working = null;
  return OK;
}

/** Переползти в соседнюю решётку той же сети: игрок переносится туда, но остаётся скрытым. */
export function moveVent(
  hub: ImpostorHub,
  self: string,
  ventId: unknown,
  place: (id: string, seat: SpawnPoint) => void,
): ImpostorResult {
  const g = hub.impostor;
  if (g.phase !== 'play') return fail('Сейчас нельзя');
  const me = livingPlayer(hub, self);
  const from = me?.p.vent ? ventOf(hub, me.p.vent) : undefined;
  if (!me || !from) return fail('Вы не в вентиляции');
  const to = ventOf(hub, ventId);
  if (!to || !from.links.includes(to.id)) return fail('Отсюда туда не пролезть');
  me.p.vent = to.id;
  place(self, { x: to.x, z: to.z, yaw: me.m.pose.yaw });
  return OK;
}

export function exitVent(hub: ImpostorHub, self: string): ImpostorResult {
  const me = livingPlayer(hub, self);
  if (!me?.p.vent) return fail('Вы не в вентиляции');
  me.p.vent = null;
  return OK;
}

/** Игрок сидит в вентиляции: сервер не двигает его позу. */
export const inVent = (g: ImpostorGame, id: string) => gameActive(g) && !!g.players[id]?.vent;

function station(hub: ImpostorHub, id: unknown): TaskStation | undefined {
  return getMap(hub.room.map).stations.find((s) => s.id === id);
}

/** Игрок подошёл к пульту и открыл мини-игру. */
export function startTask(hub: ImpostorHub, self: string, stationId: unknown, now: number): ImpostorResult {
  const g = hub.impostor;
  if (g.phase !== 'play') return fail('Сейчас нельзя');
  const p = g.players[self];
  const m = hub.members.get(self);
  if (!p || !m || p.left) return fail('Вы не в партии');
  if (p.role === 'impostor') return fail('Предатель только делает вид');
  const st = station(hub, stationId);
  const task = st && p.tasks.find((t) => t.station === st.id);
  if (!st || !task) return fail('Это не ваше задание');
  if (task.done) return fail('Задание уже выполнено');
  if (distance(m.pose, st) > TASK_RANGE) return fail('Подойдите к пульту');
  p.working = { station: st.id, at: now };
  return OK;
}

/** Мини-игра пройдена: засчитываем, если игрок всё ещё у пульта и не спешил. */
export function finishTask(hub: ImpostorHub, self: string, stationId: unknown, now: number): ImpostorResult {
  const g = hub.impostor;
  if (g.phase !== 'play') return fail('Сейчас нельзя');
  const p = g.players[self];
  const m = hub.members.get(self);
  if (!p || !m || p.left) return fail('Вы не в партии');
  const st = station(hub, stationId);
  if (!st || p.working?.station !== st.id) return fail('Задание не начато');
  const task = p.tasks.find((t) => t.station === st.id);
  if (!task || task.done) return fail('Задание уже выполнено');
  if (distance(m.pose, st) > TASK_RANGE) return fail('Подойдите к пульту');
  if (now - p.working.at < TASK_MS[st.kind]) return fail('Слишком быстро');
  task.done = true;
  p.working = null;
  checkWinner(g, now);
  return OK;
}

/**
 * Часы партии: конец показа ролей, обсуждения, голосования, итога; выход игроков.
 * Возвращает, изменилось ли что-то.
 */
export function updateImpostor(
  hub: ImpostorHub,
  now: number,
  place: (id: string, seat: SpawnPoint) => void,
) {
  const g = hub.impostor;
  if (!isImpostorRoom(hub)) {
    if (g.phase === 'lobby') return false;
    Object.assign(g, newImpostorGame(), { game: g.game });
    return true;
  }
  let changed = false;
  if (gameActive(g)) {
    for (const p of Object.values(g.players)) {
      if (p.left) continue;
      const m = hub.members.get(p.id);
      if (m && (m.seen > now - LEFT_MS || hub.connected?.(p.id))) continue;
      p.left = true;
      p.revealed = true;
      p.working = null;
      p.vent = null;
      changed = true;
    }
    // Вышедших доигрываем по правилам: во время собрания итог подводит голосование.
    if (changed && (g.phase === 'play' || g.phase === 'intro')) checkWinner(g, now);
    // Не успели починить реактор или O2 — победа предателей.
    const s = g.sabotage;
    if (g.phase === 'play' && s && s.until > 0 && now >= s.until) {
      checkWinner(g, now);
      changed = true;
    }
  }
  if (g.until === 0 || now < g.until) return changed;
  const s = hub.room.impostor;
  switch (g.phase) {
    case 'intro':
      g.phase = 'play';
      g.until = 0;
      break;
    case 'meeting':
      g.phase = 'voting';
      g.until = now + s.votingSeconds * 1000;
      break;
    case 'voting':
      finishVoting(hub, now);
      break;
    case 'eject':
      if (checkWinner(g, now)) break;
      g.phase = 'play';
      g.until = 0;
      g.meeting = null;
      g.votes = {};
      g.bodies = [];
      g.buttonReadyAt = now + BUTTON_COOLDOWN_MS;
      g.sabotageReadyAt = now + SABOTAGE_COOLDOWN_MS;
      for (const p of Object.values(g.players)) if (p.role === 'impostor') p.killReadyAt = now + s.killCooldownSeconds * 1000;
      break;
    case 'ended': {
      const ids = Object.keys(g.players);
      Object.assign(g, newImpostorGame(), { game: g.game });
      // Все снова за столом: и живые, и призраки, и зрители.
      const seated = [...new Set([...ids, ...hub.members.keys()])].filter((id) => hub.members.has(id));
      for (const [id, seat] of seatsFor(getMap(hub.room.map), seated)) place(id, seat);
      break;
    }
  }
  return true;
}

/** Что видит один игрок. Всё, чего нет здесь, клиент знать не должен. */
export type ImpostorView = {
  phase: ImpostorPhase;
  until: number;
  game: number;
  /** Своя роль; null — не в партии (зритель или лобби). */
  role: ImpostorRole | null;
  alive: boolean;
  /** Союзники-предатели; только для предателя. */
  allies: string[];
  tasks: (ImpostorTask & { kind: TaskKind; title: string; room: string; x: number; z: number })[];
  progress: { done: number; total: number };
  meetingsLeft: number;
  killReadyAt: number;
  buttonReadyAt: number;
  working: { station: string; at: number } | null;
  /**
   * Участники партии; `alive: false` — только об известных всем смертях. Имя и цвет здесь,
   * потому что погибших нет в списке участников у живых, а на собрании их показывают.
   */
  players: { id: string; alive: boolean; left: boolean; name: string; color: string }[];
  /** Сколько предателей в партии — это знают все. */
  impostors: number;
  bodies: ImpostorBody[];
  meeting: ImpostorMeeting | null;
  /** Кто уже проголосовал; за кого — только после голосования. */
  voted: string[];
  votes: Record<string, string> | null;
  ejected: ImpostorGame['ejected'];
  winner: ImpostorRole | null;
  winReason: ImpostorGame['winReason'];
  /** Роли всех — только в конце партии. */
  roles: Record<string, ImpostorRole> | null;
  /** Идущая авария: её видят все (сирена и мигающий свет не секрет). */
  sabotage: { kind: SabotageKind; until: number; fixed: string[]; held: string[] } | null;
  /** Когда предатель сможет устроить следующую аварию; другим — 0. */
  sabotageReadyAt: number;
  /** В какой решётке сижу я сам. */
  vent: string | null;
};

export function impostorView(hub: ImpostorHub, viewer: string): ImpostorView {
  const g = hub.impostor;
  const me = gameActive(g) || g.phase === 'ended' ? g.players[viewer] : undefined;
  const ghost = !me || !me.alive;
  const ended = g.phase === 'ended';
  const stations = new Map(getMap(hub.room.map).stations.map((s) => [s.id, s]));
  const confirm = hub.room.impostor.confirmEjects;
  const s = g.sabotage;
  const now = Date.now();
  // Авария связи прячет списки заданий: игрок не знает, что и где ему делать.
  const commsDown = s?.kind === 'comms';
  const ejected = g.ejected && { ...g.ejected, impostor: confirm || ended ? g.ejected.impostor : false };
  return {
    phase: g.phase,
    until: g.until,
    game: g.game,
    role: me?.role ?? null,
    alive: !!me?.alive,
    allies:
      me?.role === 'impostor'
        ? Object.values(g.players)
            .filter((p) => p.role === 'impostor' && p.id !== viewer)
            .map((p) => p.id)
        : [],
    tasks: (commsDown ? [] : (me?.tasks ?? [])).flatMap((t) => {
      const st = stations.get(t.station);
      return st ? [{ ...t, kind: st.kind, title: st.title, room: st.room, x: st.x, z: st.z }] : [];
    }),
    progress: commsDown ? { done: 0, total: 0 } : taskProgress(g),
    meetingsLeft: me?.meetingsLeft ?? 0,
    killReadyAt: me?.role === 'impostor' ? me.killReadyAt : 0,
    buttonReadyAt: g.buttonReadyAt,
    working: me?.working ?? null,
    players: Object.values(g.players).map((p) => {
      const m = hub.members.get(p.id);
      return {
        id: p.id,
        // Призраки и итог партии знают правду; живые — только то, что открылось на собрании.
        alive: ended || ghost || p.revealed ? p.alive : true,
        left: p.left,
        name: hub.room.anonymous ? 'Участник' : (m?.name ?? 'Игрок'),
        color: m?.color ?? '#8d97a6',
      };
    }),
    impostors: Object.values(g.players).filter((p) => p.role === 'impostor').length,
    // Тела видны на карте всем: их и так видно глазами, если подойти.
    bodies: g.bodies,
    meeting: g.meeting,
    voted: g.phase === 'voting' ? Object.keys(g.votes) : [],
    votes: g.phase === 'eject' || ended ? g.votes : null,
    ejected: g.phase === 'eject' || ended ? ejected : null,
    winner: g.winner,
    winReason: g.winReason,
    roles: ended ? Object.fromEntries(Object.values(g.players).map((p) => [p.id, p.role])) : null,
    sabotage: s && {
      kind: s.kind,
      until: s.until,
      fixed: s.fixed,
      held: Object.entries(s.holds)
        .filter(([, h]) => now - h.at <= HOLD_MS)
        .map(([panel]) => panel),
    },
    sabotageReadyAt: me?.role === 'impostor' ? g.sabotageReadyAt : 0,
    vent: me?.vent ?? null,
  };
}

/**
 * Видит ли `viewer` участника `id` в мире. Живые не видят призраков и зрителей; призраки
 * видят всех. Вне партии видны все.
 */
export function visibleTo(g: ImpostorGame, viewer: string, id: string) {
  if (!gameActive(g) || viewer === id) return true;
  if (isGhost(g, viewer)) return true;
  if (isGhost(g, id)) return false;
  // Сидящего в вентиляции видят только свои предатели.
  if (g.players[id]?.vent) return g.players[viewer]?.role === 'impostor';
  return true;
}

/**
 * Кто слышит голос. Во время игры живые молчат (как в Among Us — говорят на собраниях),
 * призраки всегда говорят только между собой.
 */
export function hearsVoice(g: ImpostorGame, from: string, to: string) {
  if (!gameActive(g)) return true;
  if (isGhost(g, from)) return isGhost(g, to);
  return g.phase === 'meeting' || g.phase === 'voting' || g.phase === 'eject';
}
