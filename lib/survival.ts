// Режим «Выживание»: кооператив против волн зомби с ролевой прокачкой. Только чистые
// функции над состоянием комнаты, как lib/impostor.ts: правила одни и те же для сокета
// и HTTP, их же гоняют тесты без сервера.
//
// Сервер решает всё: когда идёт волна, где и кто появляется, сколько урона у укуса и
// у выстрела с навыком, кому идёт опыт. Клиент только просит (`start`, `stop`, `perk`)
// и рисует снимок `SurvivalView`. Сами зомби — участники комнаты с id `zed-…`
// (lib/room-hub-core.ts): по ним работает вся стрельба с лаг-компенсацией, а мозг
// (lib/zombie-brain.ts) ходит через те же ворота, что и боты.
import { ONLINE_MS, type Pose } from './model.ts';
import type { SpawnPoint } from './maps/types.ts';
import { SURVIVAL_DEFAULTS, type SurvivalDifficulty, type SurvivalSettings } from './survival-settings.ts';

export {
  isSurvivalDifficulty,
  SURVIVAL_DEFAULTS,
  SURVIVAL_LIMITS,
  type SurvivalDifficulty,
  type SurvivalSettings,
} from './survival-settings.ts';

// ------------------------------------------------------------------ зомби

export type ZombieKind = 'walker' | 'runner' | 'brute';
export type ZombieRules = {
  label: string;
  hp: number;
  /** Урон укуса на первой волне при обычной сложности. */
  damage: number;
  /** Скорость шага, м/с. */
  speed: number;
  /** Досягаемость укуса от тела до тела, м. */
  reach: number;
  /** Пауза между укусами, мс. */
  attackMs: number;
  /** Опыт за убийство. */
  xp: number;
  /** Дальше этого жертву не чует, м. */
  sight: number;
  /** Модели клиента (lib/maps/outbreak-real-models.ts) и их масштаб. */
  models: string[];
  scale: number;
};

export const ZOMBIES: Record<ZombieKind, ZombieRules> = {
  walker: {
    label: 'Ходячий',
    hp: 80,
    damage: 12,
    speed: 1.9,
    reach: 1.7,
    attackMs: 1300,
    xp: 10,
    sight: 90,
    models: ['zombies/z1b', 'zombies/z2', 'zombies/z6'],
    scale: 1,
  },
  runner: {
    label: 'Бегун',
    hp: 50,
    damage: 9,
    speed: 4.3,
    reach: 1.6,
    attackMs: 900,
    xp: 15,
    sight: 120,
    models: ['zombies/z7', 'zombies/z3'],
    scale: 0.95,
  },
  brute: {
    label: 'Громила',
    hp: 450,
    damage: 32,
    speed: 1.5,
    reach: 2.1,
    attackMs: 2000,
    xp: 60,
    sight: 110,
    models: ['zombies/z4'],
    scale: 1.3,
  },
};
export const ZOMBIE_KINDS = Object.keys(ZOMBIES) as ZombieKind[];
export const isZombieKind = (v: unknown): v is ZombieKind =>
  typeof v === 'string' && Object.hasOwn(ZOMBIES, v);

/** Id зомби: `zed-` и 12 шестнадцатеричных знаков — не пересекается ни с людьми, ни с ботами. */
const ZOMBIE_ID = /^zed-[0-9a-f]{12}$/;
export const isZombieId = (id: unknown): id is string => typeof id === 'string' && ZOMBIE_ID.test(id);
/** Имя зомби в ленте убийств и над головой. */
export const ZOMBIE_NAME = (kind: ZombieKind) => `🧟 ${ZOMBIES[kind].label}`;

/** Живых зомби разом не больше: каждый — маршрут и укус десять раз в секунду. */
export const MAX_ALIVE_ZOMBIES = 24;
/** Пауза между появлениями зомби в волне, мс. */
const SPAWN_EVERY_MS = 600;
/** Мёртвый зомби лежит в снимке столько, потом исчезает. */
export const CORPSE_MS = 3000;
/** Укус «виден» в позе (`tool: 'bite'`) столько — клиент играет клип атаки. */
export const BITE_MS = 600;
/** Итог партии показывается столько, потом снова лобби. */
const ENDED_MS = 15_000;
/** Аптечка лежит столько. */
const DROP_MS = 40_000;
export const DROP_PICK_RANGE = 1.3;
export const MEDKIT_HEAL = 40;
/** Регенерация начинается через столько после последнего ранения. */
const REGEN_AFTER_MS = 5000;
/** Кто не присылал ничего дольше, в партии не считается (как в «Предателе»). */
export const LEFT_MS = 45_000;

export const DIFFICULTY: Record<
  SurvivalDifficulty,
  { label: string; hint: string; hp: number; damage: number; count: number }
> = {
  easy: { label: 'Лёгкая', hint: 'Меньше зомби, слабее укус', hp: 0.8, damage: 0.7, count: 0.75 },
  normal: { label: 'Обычная', hint: 'Как задумано', hp: 1, damage: 1, count: 1 },
  hard: { label: 'Тяжёлая', hint: 'Толпа гуще, укус больнее, зомби живучее', hp: 1.3, damage: 1.4, count: 1.3 },
};

// ------------------------------------------------------------------ прокачка

export type PerkId = 'vitality' | 'regen' | 'power' | 'armor' | 'melee' | 'vampire' | 'scholar' | 'lucky';
export const PERKS: Record<PerkId, { label: string; hint: string; max: number }> = {
  vitality: { label: 'Живучесть', hint: '+20 к запасу здоровья за ранг', max: 3 },
  regen: { label: 'Второе дыхание', hint: '+1 здоровья в секунду вне боя за ранг', max: 3 },
  power: { label: 'Твёрдая рука', hint: '+15 % урона оружия за ранг', max: 3 },
  armor: { label: 'Толстая кожа', hint: '−10 % урона от укусов за ранг', max: 3 },
  melee: { label: 'Мясник', hint: '+35 % урона ближнего боя за ранг', max: 2 },
  vampire: { label: 'Вампиризм', hint: '+4 здоровья за каждое убийство за ранг', max: 3 },
  scholar: { label: 'Смекалка', hint: '+15 % опыта за ранг', max: 2 },
  lucky: { label: 'Везунчик', hint: 'Чаще находит аптечки в зомби', max: 2 },
};
export const PERK_IDS = Object.keys(PERKS) as PerkId[];
export const isPerkId = (v: unknown): v is PerkId => typeof v === 'string' && Object.hasOwn(PERKS, v);

export const MAX_LEVEL = 30;
/** Опыт, нужный для уровня `level` с нуля: шаг растёт на 40 с каждым уровнем. */
export const xpForLevel = (level: number) => (20 * (level - 1) * level);
/** Уровень по накопленному опыту (1…MAX_LEVEL). */
export function levelFor(xp: number) {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

export type SurvivalPlayer = {
  id: string;
  xp: number;
  level: number;
  /** Непотраченные очки навыков. */
  points: number;
  perks: Partial<Record<PerkId, number>>;
  kills: number;
  /** Когда последний раз ранили: регенерация ждёт тишины. */
  hurtAt: number;
  /** Когда прибавится следующая единица регенерации. */
  healAt: number;
};
export type SurvivalZombie = {
  id: string;
  kind: ZombieKind;
  wave: number;
  hpMax: number;
  /** Следующий укус не раньше. */
  attackAt: number;
  /** До этого момента в позе стоит `tool: 'bite'`. */
  biteUntil: number;
  /** Когда погиб; 0 — жив. */
  diedAt: number;
};
export type SurvivalDrop = { id: string; kind: 'medkit'; x: number; y: number; z: number; until: number };
export type SurvivalPhase = 'lobby' | 'prep' | 'wave' | 'ended';
export type SurvivalResult = { won: boolean; wave: number; kills: number; seconds: number };
export type SurvivalGame = {
  phase: SurvivalPhase;
  /** Номер партии: растёт с каждым стартом. */
  game: number;
  wave: number;
  /** Когда кончается фаза (0 — без таймера; волна длится до последнего зомби). */
  until: number;
  startedAt: number;
  /** Сколько зомби этой волны ещё не вышло и каких. */
  queue: ZombieKind[];
  spawnAt: number;
  players: Record<string, SurvivalPlayer>;
  zombies: Record<string, SurvivalZombie>;
  drops: SurvivalDrop[];
  result: SurvivalResult | null;
  /** Зерно случайностей партии: состав волн воспроизводим в тестах. */
  seed: number;
};

export const newSurvivalGame = (): SurvivalGame => ({
  phase: 'lobby',
  game: 0,
  wave: 0,
  until: 0,
  startedAt: 0,
  queue: [],
  spawnAt: 0,
  players: {},
  zombies: {},
  drops: [],
  result: null,
  seed: 1,
});

export const isSurvivalRoom = (hub: { room: { mode: string } }) => hub.room.mode === 'survival';
/** Партия идёт: зомби появляются, опыт считается. */
export const survivalActive = (g: SurvivalGame) => g.phase === 'prep' || g.phase === 'wave';

// ------------------------------------------------------------------ состав волн

/** Детерминированный генератор для состава волны: воспроизводим в тестах. */
function lcg(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Сколько и каких зомби выходит в волне: толпа растёт с номером, бегуны с третьей, громилы с пятой. */
export function waveQueue(wave: number, difficulty: SurvivalDifficulty, players: number, seed: number): ZombieKind[] {
  const d = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
  const crowd = 0.75 + 0.25 * Math.max(1, Math.min(8, players));
  const count = Math.max(3, Math.round((5 + 4 * wave) * d.count * crowd));
  const brutes = wave >= 5 ? Math.floor((wave - 2) / 3) : 0;
  const runnerShare = wave >= 3 ? Math.min(0.4, 0.1 * (wave - 2)) : 0;
  const random = lcg(seed * 7919 + wave * 104729);
  const out: ZombieKind[] = [];
  for (let i = 0; i < count - brutes; i++) out.push(random() < runnerShare ? 'runner' : 'walker');
  // Громилы — в гуще волны, не первыми: иначе до них не добежишь.
  for (let i = 0; i < brutes; i++) out.splice(Math.floor(out.length * (0.3 + 0.6 * random())), 0, 'brute');
  return out;
}

/** Здоровье зомби этой волны. */
export const zombieHp = (kind: ZombieKind, wave: number, difficulty: SurvivalDifficulty) =>
  Math.round(ZOMBIES[kind].hp * (DIFFICULTY[difficulty] ?? DIFFICULTY.normal).hp * (1 + 0.07 * (wave - 1)));
/** Урон укуса этой волны. */
export const zombieBite = (kind: ZombieKind, wave: number, difficulty: SurvivalDifficulty) =>
  Math.round(ZOMBIES[kind].damage * (DIFFICULTY[difficulty] ?? DIFFICULTY.normal).damage * (1 + 0.04 * (wave - 1)));

// ------------------------------------------------------------------ навыки в бою

export function playerOf(g: SurvivalGame, id: string): SurvivalPlayer {
  let p = g.players[id];
  if (!p) {
    p = { id, xp: 0, level: 1, points: 0, perks: {}, kills: 0, hurtAt: 0, healAt: 0 };
    g.players[id] = p;
  }
  return p;
}
const rank = (g: SurvivalGame, id: string, perk: PerkId) => g.players[id]?.perks[perk] ?? 0;

/** Запас здоровья игрока с навыками; у зомби — его собственный. */
export const maxHpOf = (g: SurvivalGame, id: string) => 100 + 20 * rank(g, id, 'vitality');
/** Множитель урона, который наносит игрок. */
export const damageDealt = (g: SurvivalGame, id: string, melee: boolean) =>
  (1 + 0.15 * rank(g, id, 'power')) * (melee ? 1 + 0.35 * rank(g, id, 'melee') : 1);
/** Множитель урона, который игрок получает от зомби. */
export const damageTaken = (g: SurvivalGame, id: string) => 1 - 0.1 * rank(g, id, 'armor');
/** Множитель опыта. */
const xpScale = (g: SurvivalGame, id: string) => 1 + 0.15 * rank(g, id, 'scholar');
/** Шанс аптечки из убитого зомби. */
const dropChance = (g: SurvivalGame, id: string) => 0.08 + 0.07 * rank(g, id, 'lucky');

export function addXp(g: SurvivalGame, id: string, amount: number) {
  const p = playerOf(g, id);
  p.xp += Math.round(amount * xpScale(g, id));
  const level = levelFor(p.xp);
  if (level > p.level) {
    p.points += level - p.level;
    p.level = level;
  }
}

// ------------------------------------------------------------------ интерфейс сервера

export type SurvivalMember = {
  id: string;
  name: string;
  seen: number;
  hp: number;
  life: number;
  pose: Pose;
  kills: number;
  deaths: number;
};
export type SurvivalHub = {
  room: { host: string; map: string; mode: string; survival: SurvivalSettings; anonymous?: boolean };
  members: Map<string, SurvivalMember>;
  survival: SurvivalGame;
  connected?: (id: string) => boolean;
};
/** Что сервер комнаты делает по просьбе правил: поставить зомби, убрать, перенести игрока, вылечить. */
export type SurvivalIo = {
  /** Появление зомби рядом с игроками; null — места нет. */
  spawn: (kind: ZombieKind, hp: number, now: number) => string | null;
  remove: (id: string) => void;
  /** Новая жизнь игрока на базе с полным здоровьем. */
  revive: (id: string, now: number) => void;
  heal: (id: string, hp: number) => void;
  random?: () => number;
};

export type SurvivalResponse = { ok: true } | { ok: false; error: string };
const fail = (error: string): SurvivalResponse => ({ ok: false, error });
const OK: SurvivalResponse = { ok: true };

/** Игроки партии: люди и боты-союзники, не зомби. */
const survivors = (hub: SurvivalHub) => [...hub.members.values()].filter((m) => !isZombieId(m.id));
const humansAlive = (hub: SurvivalHub, now: number) =>
  survivors(hub).filter((m) => m.hp > 0 && m.seen > now - ONLINE_MS && !m.id.startsWith('bot-'));
const humansHere = (hub: SurvivalHub, now: number) =>
  survivors(hub).some((m) => !m.id.startsWith('bot-') && (m.seen > now - LEFT_MS || hub.connected?.(m.id)));

function clearZombies(hub: SurvivalHub, io: Pick<SurvivalIo, 'remove'>) {
  for (const id of Object.keys(hub.survival.zombies)) io.remove(id);
  hub.survival.zombies = {};
  hub.survival.queue = [];
}

/** Подготовка к следующей волне: все погибшие встают на базе, у живых полное здоровье. */
function beginPrep(hub: SurvivalHub, now: number, io: SurvivalIo) {
  const g = hub.survival;
  g.phase = 'prep';
  g.until = now + hub.room.survival.prepSeconds * 1000;
  for (const m of survivors(hub)) {
    if (m.seen <= now - LEFT_MS && !hub.connected?.(m.id)) continue;
    if (m.hp <= 0) io.revive(m.id, now);
    else io.heal(m.id, maxHpOf(g, m.id));
  }
}

function beginWave(hub: SurvivalHub, now: number) {
  const g = hub.survival;
  const players = survivors(hub).filter((m) => m.seen > now - ONLINE_MS).length;
  g.wave += 1;
  g.phase = 'wave';
  g.until = 0;
  g.queue = waveQueue(g.wave, hub.room.survival.difficulty, players, g.seed);
  g.spawnAt = now;
}

function endGame(hub: SurvivalHub, now: number, won: boolean, io: SurvivalIo) {
  const g = hub.survival;
  let kills = 0;
  for (const p of Object.values(g.players)) kills += p.kills;
  g.result = { won, wave: g.wave, kills, seconds: Math.round((now - g.startedAt) / 1000) };
  g.phase = 'ended';
  g.until = now + ENDED_MS;
  clearZombies(hub, io);
  g.drops = [];
}

export function startSurvival(hub: SurvivalHub, self: string, now: number, io: SurvivalIo): SurvivalResponse {
  if (!isSurvivalRoom(hub)) return fail('Комната не в режиме «Выживание»');
  if (self !== hub.room.host) return fail('Партию начинает ведущий');
  const g = hub.survival;
  if (survivalActive(g)) return fail('Партия уже идёт');
  clearZombies(hub, io);
  Object.assign(g, newSurvivalGame(), {
    game: g.game + 1,
    startedAt: now,
    seed: (now ^ (g.game + 1) * 2654435761) >>> 0 || 1,
  });
  // Очки и уровни — на партию: каждая начинается с первого уровня, как в аркаде.
  for (const m of survivors(hub)) playerOf(g, m.id);
  beginPrep(hub, now, io);
  return OK;
}

export function stopSurvival(hub: SurvivalHub, self: string, now: number, io: SurvivalIo): SurvivalResponse {
  if (!isSurvivalRoom(hub)) return fail('Комната не в режиме «Выживание»');
  if (self !== hub.room.host) return fail('Партию останавливает ведущий');
  if (!survivalActive(hub.survival)) return fail('Партия не идёт');
  endGame(hub, now, false, io);
  return OK;
}

/** Потратить очко навыка. Полное здоровье от «Живучести» прибавляется сразу. */
export function choosePerk(hub: SurvivalHub, self: string, perk: unknown, io: Pick<SurvivalIo, 'heal'>): SurvivalResponse {
  if (!isSurvivalRoom(hub)) return fail('Комната не в режиме «Выживание»');
  if (!isPerkId(perk)) return fail('Неизвестный навык');
  const g = hub.survival;
  if (!survivalActive(g)) return fail('Партия не идёт');
  const p = g.players[self];
  if (!p) return fail('Вы не в партии');
  if (p.points <= 0) return fail('Нет свободных очков навыков');
  const current = p.perks[perk] ?? 0;
  if (current >= PERKS[perk].max) return fail('Навык уже на максимуме');
  p.perks[perk] = current + 1;
  p.points -= 1;
  if (perk === 'vitality') {
    const m = hub.members.get(self);
    if (m && m.hp > 0) io.heal(self, Math.min(maxHpOf(g, self), m.hp + 20));
  }
  return OK;
}

export function survivalAction(
  hub: SurvivalHub,
  self: string,
  op: Record<string, unknown>,
  now: number,
  io: SurvivalIo,
): SurvivalResponse {
  switch (op.action) {
    case 'start':
      return startSurvival(hub, self, now, io);
    case 'stop':
      return stopSurvival(hub, self, now, io);
    case 'perk':
      return choosePerk(hub, self, op.perk, io);
    default:
      return fail('Неизвестное действие');
  }
}

/** Зомби убит: опыт убийце (половина — помощнику), вампиризм, шанс аптечки. */
export function zombieKilled(
  hub: SurvivalHub,
  zombieId: string,
  killer: string | undefined,
  assister: string | undefined,
  now: number,
  io: Pick<SurvivalIo, 'heal' | 'random'>,
) {
  const g = hub.survival;
  const z = g.zombies[zombieId];
  if (!z || z.diedAt) return;
  z.diedAt = now;
  const xp = ZOMBIES[z.kind].xp;
  if (killer && !isZombieId(killer)) {
    const p = playerOf(g, killer);
    p.kills += 1;
    addXp(g, killer, xp);
    const vampire = rank(g, killer, 'vampire');
    const m = hub.members.get(killer);
    if (vampire && m && m.hp > 0) io.heal(killer, Math.min(maxHpOf(g, killer), m.hp + 4 * vampire));
    const zm = hub.members.get(zombieId);
    if (zm && (io.random ?? Math.random)() < dropChance(g, killer) && g.drops.length < 30)
      g.drops.push({
        id: `drop-${now.toString(36)}-${g.drops.length}`,
        kind: 'medkit',
        x: zm.pose.x,
        y: zm.pose.y,
        z: zm.pose.z,
        until: now + DROP_MS,
      });
  }
  if (assister && !isZombieId(assister) && assister !== killer) addXp(g, assister, Math.round(xp / 2));
}

/** Игрока ранили: регенерация ждёт тишины. */
export function playerHurt(g: SurvivalGame, id: string, now: number) {
  const p = playerOf(g, id);
  p.hurtAt = now;
  p.healAt = now + REGEN_AFTER_MS;
}

/** Подобрать аптечку шагом: лечит на MEDKIT_HEAL, не выше запаса. */
export function pickDrops(hub: SurvivalHub, m: SurvivalMember, io: Pick<SurvivalIo, 'heal'>) {
  const g = hub.survival;
  if (!survivalActive(g) || m.hp <= 0 || isZombieId(m.id)) return false;
  const max = maxHpOf(g, m.id);
  let picked = false;
  g.drops = g.drops.filter((d) => {
    if (picked || m.hp >= max) return true;
    if (Math.hypot(d.x - m.pose.x, d.z - m.pose.z) > DROP_PICK_RANGE || Math.abs(d.y - m.pose.y) > 2) return true;
    io.heal(m.id, Math.min(max, m.hp + MEDKIT_HEAL));
    picked = true;
    return false;
  });
  return picked;
}

/**
 * Такт партии: фазы, выход зомби, уборка трупов, регенерация, срок аптечек, конец
 * партии. Возвращает, изменилось ли что-то, что стоит сохранить в checkpoint.
 */
export function updateSurvival(hub: SurvivalHub, now: number, io: SurvivalIo) {
  const g = hub.survival;
  if (!isSurvivalRoom(hub)) {
    if (g.phase === 'lobby' && !Object.keys(g.zombies).length) return false;
    clearZombies(hub, io);
    Object.assign(g, newSurvivalGame(), { game: g.game });
    return true;
  }
  let changed = false;
  if (survivalActive(g)) {
    // Без людей партия не идёт: некому играть, а сервер зря крутил бы толпу.
    if (!humansHere(hub, now)) {
      endGame(hub, now, false, io);
      return true;
    }
    // Все люди погибли — партия проиграна (боты-союзники без людей не в счёт).
    if (!humansAlive(hub, now).length) {
      endGame(hub, now, false, io);
      return true;
    }
    for (const m of survivors(hub)) {
      if (m.hp <= 0 || m.seen <= now - ONLINE_MS) continue;
      const p = g.players[m.id];
      const regen = p?.perks.regen ?? 0;
      if (!p || !regen || now < p.healAt || m.hp >= maxHpOf(g, m.id)) continue;
      io.heal(m.id, Math.min(maxHpOf(g, m.id), m.hp + regen));
      p.healAt = now + 1000;
      changed = true;
    }
    const before = g.drops.length;
    g.drops = g.drops.filter((d) => d.until > now);
    if (g.drops.length !== before) changed = true;
    for (const z of Object.values(g.zombies)) {
      if (!z.diedAt || now < z.diedAt + CORPSE_MS) continue;
      io.remove(z.id);
      delete g.zombies[z.id];
      changed = true;
    }
  }
  if (g.phase === 'wave') {
    let alive = 0;
    for (const z of Object.values(g.zombies)) if (!z.diedAt) alive++;
    while (g.queue.length && alive < MAX_ALIVE_ZOMBIES && now >= g.spawnAt) {
      const kind = g.queue[0];
      const id = io.spawn(kind, zombieHp(kind, g.wave, hub.room.survival.difficulty), now);
      // Места нет (все игроки в тесноте) — попробуем на следующем такте.
      if (!id) break;
      g.queue.shift();
      g.zombies[id] = {
        id,
        kind,
        wave: g.wave,
        hpMax: zombieHp(kind, g.wave, hub.room.survival.difficulty),
        attackAt: now + 800,
        biteUntil: 0,
        diedAt: 0,
      };
      g.spawnAt = now + SPAWN_EVERY_MS;
      alive++;
      changed = true;
    }
    if (!g.queue.length && !alive) {
      const limit = hub.room.survival.waves;
      if (limit > 0 && g.wave >= limit) endGame(hub, now, true, io);
      else beginPrep(hub, now, io);
      return true;
    }
    return changed;
  }
  if (g.until === 0 || now < g.until) return changed;
  if (g.phase === 'prep') beginWave(hub, now);
  else if (g.phase === 'ended') Object.assign(g, newSurvivalGame(), { game: g.game });
  return true;
}

// ------------------------------------------------------------------ снимок клиенту

/** Игрок в снимке: прогресс открыт всем — свои очки и навыки клиент берёт из своей строки. */
export type SurvivalScore = {
  id: string;
  name: string;
  level: number;
  xp: number;
  points: number;
  perks: Partial<Record<PerkId, number>>;
  kills: number;
  alive: boolean;
};
export type SurvivalView = {
  phase: SurvivalPhase;
  game: number;
  wave: number;
  /** Предел волн из настроек; 0 — бесконечно. */
  waves: number;
  until: number;
  /** Зомби, которых ещё нужно убить в волне: живые плюс не вышедшие. */
  zombiesLeft: number;
  /** Живых выживших. */
  alive: number;
  difficulty: SurvivalDifficulty;
  players: SurvivalScore[];
  drops: SurvivalDrop[];
  result: SurvivalResult | null;
};

export function survivalView(hub: SurvivalHub, now: number): SurvivalView {
  const g = hub.survival;
  let left = g.queue.length;
  for (const z of Object.values(g.zombies)) if (!z.diedAt) left++;
  const players: SurvivalScore[] = [];
  let alive = 0;
  for (const m of survivors(hub)) {
    if (m.seen <= now - LEFT_MS && !hub.connected?.(m.id)) continue;
    const p = g.players[m.id];
    if (m.hp > 0) alive++;
    players.push({
      id: m.id,
      name: hub.room.anonymous ? 'Участник' : m.name,
      level: p?.level ?? 1,
      xp: p?.xp ?? 0,
      points: p?.points ?? 0,
      perks: p?.perks ?? {},
      kills: p?.kills ?? 0,
      alive: m.hp > 0,
    });
  }
  players.sort((a, b) => b.xp - a.xp || b.kills - a.kills);
  return {
    phase: g.phase,
    game: g.game,
    wave: g.wave,
    waves: hub.room.survival.waves,
    until: g.until,
    zombiesLeft: left,
    alive,
    difficulty: hub.room.survival.difficulty ?? SURVIVAL_DEFAULTS.difficulty,
    players,
    drops: g.drops,
    result: g.result,
  };
}

/** Точки базы: где выжившие начинают и возрождаются между волнами. */
export const baseSpawns = (map: { base?: SpawnPoint[]; spawns: { red: SpawnPoint[] } }): SpawnPoint[] =>
  map.base?.length ? map.base : map.spawns.red;
