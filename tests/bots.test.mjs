import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, initialState } from '../lib/model.ts';
import {
  memberFromRow,
  publicMembers,
  resolveCombat,
  roomFromState,
  stepBots,
  syncBots,
} from '../lib/room-hub-core.ts';
import { BotBrain, navFor } from '../lib/bot-brain.ts';
import { BOT_LEVEL_IDS, BOT_LEVELS, MAX_BOTS, isBotId } from '../lib/bot-levels.ts';
import { getMap } from '../lib/maps/index.ts';
import { stanceHeight } from '../lib/maps/types.ts';
import { isBlocked3D, rayCastWorldObstacle } from '../lib/world-collision.ts';

const T = 1_000_000;
const run = (s, op, user = 'host') => applyOperation(s, op, user, 'host');
const battle = () => run(initialState('Бой'), { type: 'room.settings', patch: { mode: 'battle', map: 'valley' } });

/** Воспроизводимый случай: иначе «эксперт быстрее слабого» было бы лотереей. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Комната в бою на Ледниковой долине: ведущий-человек и боты из состояния. */
function hubFor(state, over = {}) {
  const room = { ...roomFromState('host', state), shieldSeconds: 0, ...over };
  const human = memberFromRow({ session: 'host', name: 'Ведущий', seen: T });
  human.team = 'blue';
  const hub = {
    room,
    members: new Map([['host', human]]),
    effects: [],
    seq: 0,
    match: { mode: 'deathmatch', score: { red: 0, blue: 0 }, round: 1, phase: 'live', until: 0 },
  };
  return { hub, human };
}

/** Прогнать `seconds` секунд боя тактами по 100 мс; человек всё это время в сети. */
function simulate(hub, brains, from, seconds, onTick = () => {}) {
  let now = from;
  for (let i = 0; i < seconds * 10; i++) {
    now += 100;
    for (const m of hub.members.values()) if (!isBotId(m.id)) m.seen = now;
    stepBots(hub, brains, now);
    resolveCombat(hub, now);
    if (onTick(now) === false) break;
  }
  return now;
}

const valley = getMap('valley');
const nav = navFor(valley);
const chest = (p) => [p.x, p.y + 1.4, p.z];
const eye = (p) => [p.x, p.y + 1.5, p.z];
const clearLine = (a, b) => {
  const hit = rayCastWorldObstacle(eye(a), chest(b), valley.colliders);
  return !hit || !hit.hit || hit.distance >= Math.hypot(b.x - a.x, b.y + 1.4 - a.y - 1.5, b.z - a.z) - 0.35;
};

/** Две проходимые точки на ровном месте в `dist` метрах друг от друга. */
function findSpots(dist, wantClear) {
  for (let idx = 0; idx < nav.kind.length; idx += 7) {
    if (nav.kind[idx] !== 1) continue;
    const a = { x: nav.cx(idx % nav.cols), z: nav.cz(Math.floor(idx / nav.cols)), y: nav.height[idx] };
    const j = nav.at(a.x, a.z - dist);
    if (j < 0 || nav.kind[j] !== 1 || Math.abs(nav.height[j] - a.y) > 0.2) continue;
    const b = { x: a.x, z: a.z - dist, y: nav.height[j] };
    if (clearLine(a, b) === wantClear) return { a, b };
  }
  throw Error('Не нашлось подходящих точек на карте');
}

/** Один бот на точке `a`, лицом к человеку на точке `b`. */
function duel(level, seed, spots) {
  let state = battle();
  state = run(state, { type: 'bots.add', level, team: 'red' });
  const { hub, human } = hubFor(state);
  syncBots(hub, T);
  const spec = hub.room.bots[0];
  const bot = hub.members.get(spec.id);
  const { a, b } = spots;
  bot.pose = { ...bot.pose, x: a.x, y: a.y, z: a.z, yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)) };
  bot.spawn = { x: a.x, z: a.z };
  bot.immuneUntil = 0;
  human.pose = { ...human.pose, x: b.x, y: b.y, z: b.z };
  const brains = new Map([[spec.id, new BotBrain(spec, 3, seeded(seed))]]);
  return { hub, bot, human, brains };
}

// ------------------------------------------------------------------ уровни

test('уровни сложности растут последовательно: реакция, точность, обзор, доворот', () => {
  const levels = BOT_LEVEL_IDS.map((id) => BOT_LEVELS[id]);
  assert.deepEqual(BOT_LEVEL_IDS, ['weak', 'medium', 'strong', 'expert']);
  assert.deepEqual(
    levels.map((l) => l.label),
    ['Слабый', 'Средний', 'Сильный', 'Эксперт'],
  );
  for (let i = 1; i < levels.length; i++) {
    const [prev, next] = [levels[i - 1], levels[i]];
    assert.ok(next.reaction[1] < prev.reaction[0], 'реакция быстрее');
    assert.ok(next.spread < prev.spread, 'разброс меньше');
    assert.ok(next.turn > prev.turn, 'доворот быстрее');
    assert.ok(next.sight > prev.sight, 'видит дальше');
    assert.ok(next.headshot >= prev.headshot, 'в голову не реже');
    assert.ok(next.lead[1] - next.lead[0] < prev.lead[1] - prev.lead[0], 'упреждение точнее');
  }
  // Даже эксперт не аимбот: у него остаются реакция и разброс.
  assert.ok(BOT_LEVELS.expert.reaction[0] >= 120);
  assert.ok(BOT_LEVELS.expert.spread > 0);
});

// ------------------------------------------------------ настройки комнаты

test('ботов добавляет, переучивает и убирает только ведущий', () => {
  let s = battle();
  assert.throws(() => run(s, { type: 'bots.add', level: 'strong' }, 'guest'), /только ведущему/);
  s = run(s, { type: 'bots.add', level: 'expert', team: 'red', count: 3 });
  assert.equal(s.bots.length, 3);
  assert.ok(s.bots.every((b) => isBotId(b.id) && b.level === 'expert' && b.team === 'red'));
  assert.equal(new Set(s.bots.map((b) => b.name)).size, 3, 'имена не повторяются');
  s = run(s, { type: 'bots.add', level: 'weak', team: 'auto' });
  assert.equal(s.bots[3].team, '', '«auto» оставляет сторону серверу');

  const id = s.bots[0].id;
  assert.throws(() => run(s, { type: 'bots.level', id, level: 'weak' }, 'guest'), /только ведущему/);
  s = run(s, { type: 'bots.level', id, level: 'medium' });
  assert.equal(s.bots[0].level, 'medium');
  assert.throws(() => run(s, { type: 'bots.remove', id }, 'guest'), /только ведущему/);
  s = run(s, { type: 'bots.remove', id });
  assert.equal(s.bots.length, 3);
  assert.equal(s.bots.some((b) => b.id === id), false);
  s = run(s, { type: 'bots.remove', all: true });
  assert.deepEqual(s.bots, []);
});

test('неверные операции с ботами отклоняются', () => {
  const s = battle();
  assert.throws(() => run(initialState('Ретро'), { type: 'bots.add', level: 'strong' }), /командном бою/);
  assert.throws(() => run(s, { type: 'bots.add', level: 'godlike' }), /уровень/);
  assert.throws(() => run(s, { type: 'bots.add', level: 'strong', count: 0 }));
  assert.throws(() => run(s, { type: 'bots.add', level: 'strong', count: 17 }));
  assert.throws(() => run(s, { type: 'bots.add', level: 'strong', count: 1.5 }), /целым/);
  assert.throws(() => run(s, { type: 'bots.remove', id: 'host' }), /не найден/);
  assert.throws(() => run(s, { type: 'bots.level', id: 'bot-000000000000', level: 'weak' }), /не найден/);
  let full = run(s, { type: 'bots.add', level: 'strong', count: 16 });
  full = run(full, { type: 'bots.add', level: 'strong', count: 16 });
  assert.equal(full.bots.length, MAX_BOTS);
  assert.throws(() => run(full, { type: 'bots.add', level: 'strong' }), /не больше/);
});

// ------------------------------------------------------------ сервер

test('сервер выпускает ботов только в бою и ставит их на свою сторону', () => {
  let state = run(battle(), { type: 'bots.add', level: 'strong', team: 'red', count: 2 });
  state = run(state, { type: 'bots.add', level: 'weak', count: 2 });
  // В ретроспективе список остаётся в настройках, но играть сервер их не пускает.
  const retro = run(state, { type: 'room.settings', patch: { mode: 'retro' } });
  assert.equal(retro.bots.length, 4);
  assert.deepEqual(roomFromState('host', retro).bots, []);

  const { hub } = hubFor(state);
  // Давно ушедший «красный» не должен перетягивать ботов на синюю сторону.
  const ghost = memberFromRow({ session: 'ghost', name: 'Ушёл', seen: T - 3_600_000, team: 'red' });
  hub.members.set('ghost', ghost);
  assert.equal(syncBots(hub, T), true);
  const bots = state.bots.map((b) => hub.members.get(b.id));
  assert.deepEqual(
    bots.map((m) => m.team),
    ['red', 'red', 'blue', 'red'],
    // Каждый бот без стороны встаёт в меньшую команду: 2 красных против синего
    // человека — синий, затем 2 на 2 — красный. Посчитай сервер «ушедшего»
    // красного, оба ушли бы к синим.
    'боты без стороны добирают меньшую команду по тем, кто в сети',
  );
  for (const m of bots) {
    const spawn = valley.spawns[m.team];
    assert.ok(spawn.some((p) => Math.hypot(p.x - m.pose.x, p.z - m.pose.z) < 0.01), 'стоит на спавне своей стороны');
    assert.equal(m.name.startsWith('🤖 '), true);
  }
  const listed = publicMembers(hub, T).find((m) => m.id === state.bots[2].id);
  assert.equal(listed.bot, 'weak');
  assert.equal(publicMembers(hub, T).find((m) => m.id === 'host').bot, undefined);

  // Убрали бота из настроек — сервер убирает участника.
  hub.room = { ...hub.room, bots: hub.room.bots.slice(1) };
  assert.equal(syncBots(hub, T), true);
  assert.equal(hub.members.has(state.bots[0].id), false);
  assert.equal(syncBots(hub, T), false, 'повторная сверка ничего не меняет');
});

test('без людей в сети боты спят и не тратят сервер', () => {
  const state = run(battle(), { type: 'bots.add', level: 'expert', count: 2 });
  const { hub, human } = hubFor(state);
  syncBots(hub, T);
  human.seen = T - 60_000;
  const before = state.bots.map((b) => ({ ...hub.members.get(b.id).pose }));
  const brains = new Map();
  for (let now = T; now < T + 2000; now += 100) stepBots(hub, brains, now);
  assert.equal(brains.size, 0, 'мозги даже не создавались');
  assert.deepEqual(
    state.bots.map((b) => hub.members.get(b.id).pose),
    before,
  );
});

test('боты ходят по карте и ни разу не оказываются в стене', () => {
  let state = run(battle(), { type: 'bots.add', level: 'strong', team: 'red', count: 3 });
  state = run(state, { type: 'bots.add', level: 'medium', team: 'blue', count: 3 });
  const { hub, human } = hubFor(state);
  // Человек стоит в углу и не мешает: проверяем, что боты сами ищут бой.
  human.pose = { ...human.pose, ...valley.spawns.blue[0] };
  syncBots(hub, T);
  const start = new Map(state.bots.map((b) => [b.id, { ...hub.members.get(b.id).pose }]));
  const brains = new Map();
  const far = new Map();
  simulate(hub, brains, T, 25, () => {
    for (const b of state.bots) {
      const m = hub.members.get(b.id);
      if (m.hp <= 0) continue;
      const p = m.pose;
      assert.equal(
        isBlocked3D(p.x, p.z, p.y, 0.25, stanceHeight(p.stance), valley.colliders),
        false,
        `${m.name} в стене: ${p.x} ${p.y} ${p.z}`,
      );
      const s = start.get(b.id);
      far.set(b.id, Math.max(far.get(b.id) ?? 0, Math.hypot(p.x - s.x, p.z - s.z)));
    }
  });
  for (const b of state.bots) assert.ok(far.get(b.id) > 12, `${b.name} ушёл со спавна: ${far.get(b.id)}`);
});

test('на подготовке раунда боты стоят и не стреляют', () => {
  const spots = findSpots(10, true);
  const { hub, bot, brains } = duel('expert', 1, spots);
  hub.room = { ...hub.room, matchMode: 'rounds' };
  hub.match = { mode: 'rounds', score: { red: 0, blue: 0 }, round: 1, phase: 'freeze', until: T + 60_000 };
  const { x, z } = bot.pose;
  simulate(hub, brains, T, 3);
  assert.equal(Math.hypot(bot.pose.x - x, bot.pose.z - z) < 0.01, true);
  assert.equal(hub.effects.length, 0);
});

test('бот не стреляет в того, кого закрывает стена', () => {
  const spots = findSpots(7, false);
  const { hub, bot, brains } = duel('expert', 7, spots);
  simulate(hub, brains, T, 1.5);
  assert.equal(hub.effects.filter((e) => e.author === bot.id).length, 0);
});

test('эксперт замечает и поражает цель быстрее слабого', () => {
  const spots = findSpots(10, true);
  const firstShot = (level, seed) => {
    const { hub, bot, human, brains } = duel(level, seed, spots);
    let shotAt = Infinity;
    let hurtAt = Infinity;
    simulate(hub, brains, T, 8, (now) => {
      if (shotAt === Infinity && hub.effects.some((e) => e.author === bot.id)) shotAt = now - T;
      if (hurtAt === Infinity && human.hp < 100) hurtAt = now - T;
      // Цель не умирает: считаем только, когда пошёл урон.
      human.hp = 100;
      if (hurtAt !== Infinity) return false;
    });
    return { shotAt, hurtAt };
  };
  const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const seeds = [1, 2, 3, 4, 5];
  const expert = seeds.map((seed) => firstShot('expert', seed));
  const weak = seeds.map((seed) => firstShot('weak', seed));
  for (const r of expert) assert.ok(r.hurtAt < 3000, `эксперт ранил за ${r.hurtAt} мс`);
  assert.ok(
    median(expert.map((r) => r.shotAt)) + 300 <= median(weak.map((r) => r.shotAt)),
    `первый выстрел: эксперт ${JSON.stringify(expert.map((r) => r.shotAt))}, слабый ${JSON.stringify(weak.map((r) => r.shotAt))}`,
  );
  assert.ok(
    median(expert.map((r) => r.hurtAt)) < median(weak.map((r) => r.hurtAt)),
    `первый урон: эксперт ${JSON.stringify(expert.map((r) => r.hurtAt))}, слабый ${JSON.stringify(weak.map((r) => r.hurtAt))}`,
  );
});

test('смена уровня применяется к уже играющему боту', () => {
  const spots = findSpots(10, true);
  const { hub, brains } = duel('weak', 3, spots);
  simulate(hub, brains, T, 0.5);
  const spec = hub.room.bots[0];
  const brain = brains.get(spec.id);
  hub.room = { ...hub.room, bots: [{ ...spec, level: 'expert' }] };
  simulate(hub, brains, T + 500, 0.2);
  assert.equal(brains.get(spec.id), brain, 'мозг тот же: память и маршрут не сброшены');
  assert.equal(brain.level, 'expert');
});

test('у обеих команд одинаковый набор характеров', () => {
  // Характер выбирался по номеру в общем списке: красные с номерами 0–4 и
  // синие 5–9 получали разные наборы, и в зеркальном матче равных ботов одна
  // сторона стабильно набивала в полтора раза больше.
  let state = run(battle(), { type: 'bots.add', level: 'strong', team: 'red', count: 5 });
  state = run(state, { type: 'bots.add', level: 'strong', team: 'blue', count: 5 });
  const { hub } = hubFor(state);
  syncBots(hub, T);
  const brains = new Map();
  stepBots(hub, brains, T + 100);
  const set = (team) =>
    state.bots
      .filter((b) => b.team === team)
      .map((b) => brains.get(b.id).character)
      .sort((x, y) => x.localeCompare(y));
  assert.deepEqual(set('red'), set('blue'));
});
