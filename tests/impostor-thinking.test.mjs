import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impostorAction, memberFromRow, newMatch, presence, resolveCombat, roomFromState, syncBots } from '../lib/room-hub-core.ts';
import { newImpostorGame } from '../lib/impostor.ts';
import { ImpostorBot, stepImpostorBots } from '../lib/impostor-bot.ts';
import { postChat } from '../lib/room-chat.ts';
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

/**
 * Сцена: человек-предатель убивает бота на глазах у бота-свидетеля. Возвращает свидетеля с уже
 * сложившейся уликой и время, когда он её получил.
 */
function witnessScene(level, seed = 3) {
  let state = applyOperation(initialState('Think'), { type: 'room.settings', patch: { mode: 'impostor' } }, 'host', 'host');
  state = applyOperation(state, { type: 'room.settings', patch: { impostor: { discussionSeconds: 0, votingSeconds: 60, killCooldownSeconds: 60 } } }, 'host', 'host');
  state = applyOperation(state, { type: 'bots.add', level, count: 3 }, 'host', 'host');
  const room = roomFromState('host', state);
  const hub = { room, members: new Map(), effects: [], seq: 0, match: newMatch(room, T), impostor: newImpostorGame() };
  hub.members.set('host', memberFromRow({ session: 'host', name: 'Ведущий', seen: T }));
  syncBots(hub, T);
  impostorAction(hub, 'host', { action: 'start' }, T);
  const [watcher, victim, far] = hub.room.bots.map((b) => b.id);
  for (const p of Object.values(hub.impostor.players)) p.role = p.id === 'host' ? 'impostor' : 'crew';
  const place = (id, x, z) => {
    const m = hub.members.get(id);
    m.pose = { ...m.pose, x, y: 0, z };
    m.lastMoveAt = 0;
  };
  let now = T + 6000;
  resolveCombat(hub, now);
  place(watcher, 0, -17);
  place(victim, -4.5, -17);
  place('host', -3, -17);
  place(far, 40, 30);
  const brain = new ImpostorBot(hub.room.bots[0], seeded(seed));
  const hooks = () => ({ act: (id, op) => impostorAction(hub, id, op, now), move: (m, op) => presence(hub, m, op, now) });
  const tick = () => {
    now += 100;
    hub.members.get('host').seen = now;
    place(watcher, 0, -17);
    place('host', -3, -17);
    brain.step(hub, ship, now, hooks());
    resolveCombat(hub, now);
  };
  for (let i = 0; i < 10; i++) tick();
  hub.impostor.players.host.killReadyAt = 0;
  assert.equal(impostorAction(hub, 'host', { action: 'kill', target: victim }, now).ok, true);
  // Ждём, пока свидетель заметит тело: у невнимательного на это уходит больше взглядов.
  for (let i = 0; i < 200 && !brain.suspects(now).size; i++) tick();
  return { hub, brain, watcher, victim, seen: now, place, hooks };
}

/** Собрание, начатое в момент `at`: свидетель голосует и возвращает свой голос. */
function voteAt(scene, at) {
  const { hub, brain, watcher, victim, hooks } = scene;
  const g = hub.impostor;
  g.phase = 'voting';
  g.until = at + 60_000;
  g.meeting = { caller: watcher, reason: 'report', body: victim };
  g.votes = {};
  let now = at;
  for (let i = 0; i < 400 && !(watcher in g.votes); i++) {
    now += 100;
    hub.members.get('host').seen = now;
    brain.step(hub, ship, now, hooks());
  }
  return g.votes[watcher];
}

test('thinking: every level says what it remembers, how it reasons and how it lies', () => {
  for (const level of BOT_LEVEL_IDS) {
    const rules = IMPOSTOR_BOT_LEVELS[level];
    for (const key of ['horizon', 'attention', 'mixUp', 'capacity']) assert.equal(typeof rules.memory[key], 'number', `${level}.memory.${key}`);
    for (const key of ['suspectAt', 'trust', 'detail', 'vouch', 'fades', 'holds', 'follows', 'guesses', 'counters'])
      assert.equal(typeof rules.think[key], 'number', `${level}.think.${key}`);
    assert.equal(typeof rules.think.agrees, 'boolean', `${level}.think.agrees`);
    for (const key of ['blameReporter', 'blameRandom', 'joinsBlame', 'defendsAlly'])
      assert.equal(typeof rules.lying[key], 'number', `${level}.lying.${key}`);
    assert.equal(typeof rules.lying.plansWithAllies, 'boolean', `${level}.lying.plansWithAllies`);
  }
});

test('thinking: levels differ from novice to veteran, and in the right direction', () => {
  const [weak, medium, strong, expert] = ['weak', 'medium', 'strong', 'expert'].map((l) => IMPOSTOR_BOT_LEVELS[l]);
  // Чем опытнее, тем дольше и точнее память.
  assert.ok(weak.memory.horizon < medium.memory.horizon);
  assert.ok(medium.memory.horizon < strong.memory.horizon);
  assert.ok(strong.memory.horizon < expert.memory.horizon);
  assert.ok(weak.memory.attention < expert.memory.attention);
  assert.ok(weak.memory.mixUp > expert.memory.mixUp);
  assert.ok(weak.memory.capacity < expert.memory.capacity);
  // Чем опытнее, тем меньше веры чужим словам и больше — своим уликам.
  assert.ok(weak.think.trust > expert.think.trust);
  assert.ok(weak.think.follows > expert.think.follows);
  assert.ok(weak.think.guesses > expert.think.guesses);
  assert.ok(weak.think.vouch < expert.think.vouch, 'новичок не слышит поручительств');
  assert.ok(weak.think.fades < expert.think.fades, 'новичок держится за первое впечатление');
  assert.ok(weak.think.suspectAt > expert.think.suspectAt);
  // Хитрость предателя тоже растёт с уровнем.
  assert.ok(weak.lying.blameReporter < expert.lying.blameReporter);
  assert.ok(weak.lying.joinsBlame < expert.lying.joinsBlame);
  assert.equal(weak.lying.plansWithAllies, false);
  assert.equal(expert.lying.plansWithAllies, true);
  assert.ok(weak.think.holds < expert.think.holds, 'опытный дольше держит при себе улику');
  assert.ok(weak.think.detail < expert.think.detail, 'новичок не отличает свидетеля от болтуна');
  assert.equal(weak.think.counters, 0, 'новичку не приходит в голову, что обвинитель врёт');
  assert.ok(expert.think.counters > strong.think.counters);
});

test('memory drives the vote: a fresh clue accuses, and the veteran keeps it through the talk', () => {
  const fresh = witnessScene('expert');
  const seen = fresh.brain.suspects(fresh.seen).get('host');
  assert.ok(seen >= IMPOSTOR_BOT_LEVELS.expert.think.suspectAt, 'свидетель уверен сразу после убийства');
  assert.equal(voteAt(fresh, fresh.seen), 'host', 'по свежей улике голосует против убийцы');
  // Увиденное у тела опытный обдумывает и пересказывает: к концу собрания он помнит это так же.
  assert.ok(fresh.brain.suspects(fresh.seen + 60_000).get('host') > seen * 0.8);
});

test('memory drives the vote: what is forgotten stops counting', () => {
  // Обычный игрок держит улику около минуты: полторы минуты спустя настаивать уже не на чем.
  const stale = witnessScene('medium', 5);
  const later = stale.seen + 90_000;
  const before = stale.brain.suspects(stale.seen).get('host');
  const after = stale.brain.suspects(later).get('host');
  assert.ok(after < before * 0.6, `улика потускнела: ${before.toFixed(2)} → ${after.toFixed(2)}`);
  assert.ok(after < IMPOSTOR_BOT_LEVELS.medium.think.suspectAt, 'до обвинения уже не дотягивает');
  assert.equal(voteAt(stale, later), 'skip', 'на том, чего толком не помнит, бот не настаивает');
});

test('memory drives the vote: a novice sticks to the first impression', () => {
  const scene = witnessScene('weak', 11);
  const later = scene.seen + 40_000;
  const before = scene.brain.suspects(scene.seen).get('host') ?? 0;
  const after = scene.brain.suspects(later).get('host') ?? 0;
  assert.ok(before > 0, 'новичок всё-таки что-то заметил');
  assert.ok(after > before * 0.7, `впечатление держится: ${before.toFixed(2)} → ${after.toFixed(2)}`);
});

/**
 * Собрание после убийства: очевидец и бот, который ничего не видел, обсуждают и голосуют.
 * `talk` — слышат ли они друг друга в чате. Возвращает голос того, кто ничего не видел.
 */
function meetingAfter(scene, talk) {
  const { hub, brain, watcher, victim } = scene;
  const blind = hub.room.bots[2].id;
  const g = hub.impostor;
  let now = scene.seen;
  g.phase = 'meeting';
  g.until = now + 20_000;
  g.meeting = { caller: watcher, reason: 'report', body: victim };
  g.votes = {};
  const brains = new Map([[watcher, brain]]);
  for (let i = 0; i < 900 && !(blind in g.votes); i++) {
    now += 100;
    hub.members.get('host').seen = now;
    stepImpostorBots(
      hub,
      brains,
      ship,
      now,
      {
        act: (id, op) => impostorAction(hub, id, op, now),
        move: (m, op) => presence(hub, m, op, now),
        ...(talk ? { say: (id, channel, text) => postChat(hub, id, { channel, text }, now).ok } : {}),
      },
      seeded(4),
    );
    resolveCombat(hub, now);
  }
  return { vote: g.votes[blind], suspects: brains.get(blind)?.suspects(now) };
}

test('bots talk each other round: a witness bot convinces a bot that saw nothing', () => {
  const heard = meetingAfter(witnessScene('expert'), true);
  assert.equal(heard.vote, 'host', 'поверил очевидцу и проголосовал против убийцы');
  // Чужой рассказ меняет голос, но не становится своим воспоминанием: сам бот ничего не видел.
  assert.equal(heard.suspects.size, 0);
  const silent = meetingAfter(witnessScene('expert'), false);
  assert.equal(silent.vote, 'skip', 'без разговора ничего не видевший пропускает');
});
