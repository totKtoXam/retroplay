import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  impostorAction,
  memberFromRow,
  newMatch,
  presence,
  resolveCombat,
  roomFromState,
  syncBots,
} from '../lib/room-hub-core.ts';
import { newImpostorGame, taskProgress } from '../lib/impostor.ts';
import { ImpostorBot, stepImpostorBots } from '../lib/impostor-bot.ts';
import { IMPOSTOR_BOT_LEVELS } from '../lib/impostor-bot-levels.ts';
import { BOT_LEVEL_IDS } from '../lib/bot-levels.ts';
import { applyOperation, initialState } from '../lib/model.ts';
import { getMap } from '../lib/maps/index.ts';

const T = 1_000_000;
const ship = getMap('ship');

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

/** Комната «Предателя»: ведущий-человек за столом и `count` ботов уровня `level`. */
function roomWithBots(level, count, settings = {}) {
  let state = applyOperation(initialState('Bots'), { type: 'room.settings', patch: { mode: 'impostor' } }, 'host', 'host');
  state = applyOperation(state, { type: 'room.settings', patch: { impostor: { discussionSeconds: 0, votingSeconds: 15, ...settings } } }, 'host', 'host');
  state = applyOperation(state, { type: 'bots.add', level, count }, 'host', 'host');
  const room = roomFromState('host', state);
  const hub = { room, members: new Map(), effects: [], seq: 0, match: newMatch(room, T), impostor: newImpostorGame() };
  const human = memberFromRow({ session: 'host', name: 'Ведущий', seen: T });
  hub.members.set('host', human);
  syncBots(hub, T);
  return { hub, human };
}

const hooks = (hub, now) => ({
  act: (id, op) => impostorAction(hub, id, op, now),
  move: (m, op) => presence(hub, m, op, now),
});

/** Прогнать `seconds` секунд партии тактами по 100 мс. */
function simulate(hub, brains, from, seconds, onTick = () => {}, random = seeded(7)) {
  let now = from;
  for (let i = 0; i < seconds * 10; i++) {
    now += 100;
    hub.members.get('host').seen = now;
    stepImpostorBots(hub, brains, ship, now, hooks(hub, now), random);
    resolveCombat(hub, now);
    if (onTick(now) === false) break;
  }
  return now;
}

/** Раздать роли вручную: `impostors` — id предателей, остальные экипаж. */
function forceRoles(hub, impostors) {
  for (const p of Object.values(hub.impostor.players)) p.role = impostors.includes(p.id) ? 'impostor' : 'crew';
}

test('bots: every level has a short hint for the add panel; bots are allowed in the impostor mode', () => {
  for (const level of BOT_LEVEL_IDS) {
    const hint = IMPOSTOR_BOT_LEVELS[level].hint;
    assert.ok(hint.length > 20 && hint.length < 140, `${level}: ${hint}`);
  }
  const { hub } = roomWithBots('medium', 3);
  assert.equal(hub.room.bots.length, 3);
  assert.equal([...hub.members.keys()].length, 4, 'bots joined the room');
});

test('bots fill the table: one human and three bots can start a game', () => {
  const { hub } = roomWithBots('medium', 3);
  assert.deepEqual(impostorAction(hub, 'host', { action: 'start' }, T), { ok: true });
  assert.equal(Object.keys(hub.impostor.players).length, 4);
});

test('crew bots walk to their consoles and complete tasks', () => {
  const { hub } = roomWithBots('expert', 4, { tasksPerPlayer: 2, killCooldownSeconds: 60 });
  impostorAction(hub, 'host', { action: 'start' }, T);
  const bots = hub.room.bots.map((b) => b.id);
  // Все боты — экипаж, предатель — человек, который стоит на месте: никто не мешает.
  forceRoles(hub, ['host']);
  const brains = new Map();
  let done = 0;
  simulate(hub, brains, T, 90, () => {
    done = bots.reduce((n, id) => n + hub.impostor.players[id].tasks.filter((t) => t.done).length, 0);
    // Экипаж может успеть победить заданиями — дальше партия уйдёт в лобби.
    return hub.impostor.phase === 'play' || hub.impostor.phase === 'intro';
  });
  assert.ok(done >= 4, `bots completed ${done} tasks in 90 s`);
});

test('a careful impostor bot never kills in front of a witness; a weak one does', () => {
  for (const [level, expectKill] of [
    ['strong', false],
    ['weak', true],
  ]) {
    const { hub, human } = roomWithBots(level, 3, { killCooldownSeconds: 10 });
    impostorAction(hub, 'host', { action: 'start' }, T);
    const [killer, victim, witness] = hub.room.bots.map((b) => b.id);
    forceRoles(hub, [killer]);
    let now = T + 6_000;
    resolveCombat(hub, now);
    // Все в кафетерии, в прямой видимости друг друга; нож готов.
    const place = (id, x, z) => {
      const m = hub.members.get(id);
      m.pose = { ...m.pose, x, y: 0, z };
      m.lastMoveAt = 0;
    };
    place(killer, -4, -17);
    place(victim, -3, -17);
    place(witness, 3, -17);
    place('host', 4, -30);
    human.seen = now;
    hub.impostor.players[killer].killReadyAt = now;
    // Свидетель и человек замирают: вне симуляции они не ходят.
    const brains = new Map();
    let killed = false;
    for (let i = 0; i < 30 && !killed; i++) {
      now += 100;
      human.seen = now;
      const brain = brains.get(killer) ?? new ImpostorBot(hub.room.bots[0], seeded(1));
      brains.set(killer, brain);
      brain.step(hub, ship, now, hooks(hub, now));
      place(victim, -3, -17);
      place(witness, 3, -17);
      killed = !hub.impostor.players[victim].alive;
    }
    assert.equal(killed, expectKill, `${level}: killed with a witness = ${killed}`);
  }
});

test('a crew bot that saw the kill reports the body and votes against the killer', () => {
  const { hub, human } = roomWithBots('expert', 3, { killCooldownSeconds: 10, votingSeconds: 30 });
  impostorAction(hub, 'host', { action: 'start' }, T);
  const [watcher, victim, other] = hub.room.bots.map((b) => b.id);
  forceRoles(hub, ['host']);
  let now = T + 6_000;
  resolveCombat(hub, now);
  const place = (id, x, z) => {
    const m = hub.members.get(id);
    m.pose = { ...m.pose, x, y: 0, z };
    m.lastMoveAt = 0;
  };
  place(watcher, 0, -17);
  place(victim, -4.5, -17);
  place('host', -3, -17);
  place(other, 30, -30);
  hub.impostor.players.host.killReadyAt = 0;
  const brain = new ImpostorBot(hub.room.bots[0], seeded(3));
  const step = () => {
    human.seen = now;
    brain.step(hub, ship, now, hooks(hub, now));
    resolveCombat(hub, now);
  };
  // Наблюдатель видит всех рядом несколько осмотров подряд.
  for (let i = 0; i < 6; i++) {
    now += 100;
    place(watcher, 0, -17);
    step();
  }
  assert.deepEqual(impostorAction(hub, 'host', { action: 'kill', target: victim }, now), { ok: true });
  for (let i = 0; i < 80 && hub.impostor.phase === 'play'; i++) {
    now += 100;
    step();
  }
  assert.equal(hub.impostor.phase, 'voting', 'the watcher reported the body');
  assert.equal(hub.impostor.meeting.caller, watcher);
  assert.ok((brain.suspects().get('host') ?? 0) >= 2, 'the killer is suspected');
  for (let i = 0; i < 120 && !(watcher in hub.impostor.votes); i++) {
    now += 100;
    step();
  }
  assert.equal(hub.impostor.votes[watcher], 'host');
});

test('crew bots rush to repair a critical sabotage', () => {
  const { hub } = roomWithBots('expert', 4, { killCooldownSeconds: 60 });
  impostorAction(hub, 'host', { action: 'start' }, T);
  forceRoles(hub, ['host']);
  const now = T + 6_000;
  resolveCombat(hub, now);
  hub.impostor.sabotageReadyAt = 0;
  assert.deepEqual(impostorAction(hub, 'host', { action: 'sabotage', kind: 'o2' }, now), { ok: true });
  const brains = new Map();
  simulate(hub, brains, now, 44, () => hub.impostor.sabotage !== null);
  assert.equal(hub.impostor.sabotage, null, 'O2 repaired in time');
  assert.notEqual(hub.impostor.winReason, 'sabotage');
});

test('crew bots split between the two reactor stabilizers', () => {
  const { hub } = roomWithBots('medium', 4, { killCooldownSeconds: 60 });
  impostorAction(hub, 'host', { action: 'start' }, T);
  forceRoles(hub, ['host']);
  const now = T + 6_000;
  resolveCombat(hub, now);
  hub.impostor.sabotageReadyAt = 0;
  assert.deepEqual(impostorAction(hub, 'host', { action: 'sabotage', kind: 'reactor' }, now), { ok: true });
  const brains = new Map();
  simulate(hub, brains, now, 44, () => hub.impostor.sabotage !== null);
  assert.equal(hub.impostor.sabotage, null, 'reactor stabilised in time');
});

test('a full game of bots reaches an ending, and a bot tick stays cheap', () => {
  for (const level of BOT_LEVEL_IDS) {
    const { hub } = roomWithBots(level, 9, { tasksPerPlayer: 3, killCooldownSeconds: 15, votingSeconds: 15 });
    const random = seeded(11);
    impostorAction(hub, 'host', { action: 'start' }, T);
    // Человек — экипаж и стоит за столом: партия решается ботами.
    const botImpostor = hub.room.bots[0].id;
    forceRoles(hub, [botImpostor, hub.room.bots[1].id]);
    const brains = new Map();
    let worst = 0,
      total = 0,
      ticks = 0;
    simulate(
      hub,
      brains,
      T,
      600,
      () => {
        ticks++;
        return hub.impostor.phase !== 'lobby';
      },
      random,
    );
    // Время такта меряем отдельно на свежей партии, чтобы не зависеть от её исхода.
    const fresh = roomWithBots(level, 14, { killCooldownSeconds: 15 });
    impostorAction(fresh.hub, 'host', { action: 'start' }, T);
    const freshBrains = new Map();
    let now = T;
    for (let i = 0; i < 300; i++) {
      now += 100;
      fresh.hub.members.get('host').seen = now;
      const started = performance.now();
      stepImpostorBots(fresh.hub, freshBrains, ship, now, hooks(fresh.hub, now), random);
      const spent = performance.now() - started;
      resolveCombat(fresh.hub, now);
      if (i > 20) {
        worst = Math.max(worst, spent);
        total += spent;
      }
    }
    const progress = taskProgress(hub.impostor);
    assert.ok(ticks < 6000, `${level}: the game ended (winner ${hub.impostor.winner}, tasks ${progress.done}/${progress.total})`);
    assert.ok(total / 279 < 8, `${level}: 14 bots, average tick ${(total / 279).toFixed(2)} ms`);
  }
});
