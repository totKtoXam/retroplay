import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impostorAction, memberFromRow, newMatch, presence, resolveCombat, roomFromState, syncBots } from '../lib/room-hub-core.ts';
import { newImpostorGame } from '../lib/impostor.ts';
import { postChat, readsChat } from '../lib/room-chat.ts';
import { ImpostorBot, stepImpostorBots } from '../lib/impostor-bot.ts';
import { hear, placeOf, plainName, SAY, zoneOf } from '../lib/impostor-bot-talk.ts';
import { impostorSoundEvents } from '../lib/impostor-sound-events.ts';
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

function roomWithBots(level, count, settings = {}) {
  let state = applyOperation(initialState('Bots'), { type: 'room.settings', patch: { mode: 'impostor' } }, 'host', 'host');
  state = applyOperation(state, { type: 'room.settings', patch: { impostor: { discussionSeconds: 45, votingSeconds: 30, ...settings } } }, 'host', 'host');
  state = applyOperation(state, { type: 'bots.add', level, count }, 'host', 'host');
  const room = roomFromState('host', state);
  const hub = { room, members: new Map(), effects: [], seq: 0, match: newMatch(room, T), impostor: newImpostorGame() };
  hub.members.set('host', memberFromRow({ session: 'host', name: 'Ведущий', seen: T }));
  syncBots(hub, T);
  return hub;
}

/** Боты живут своими тактами; всё сказанное складываем в список. */
function run(hub, brains, from, seconds, random = seeded(5)) {
  const said = [];
  let now = from;
  for (let i = 0; i < seconds * 10; i++) {
    now += 100;
    hub.members.get('host').seen = now;
    stepImpostorBots(hub, brains, ship, now, {
      act: (id, op) => impostorAction(hub, id, op, now),
      move: (m, op) => presence(hub, m, op, now),
      say: (id, channel, text) => {
        const result = postChat(hub, id, { channel, text }, now);
        if (result.ok) said.push({ id, channel, text, entry: result.entry });
        return result.ok;
      },
    }, random);
    resolveCombat(hub, now);
  }
  return { now, said };
}

test('talk: a bot reads names and intent out of a chat line', () => {
  const names = [
    ['a', 'Вася'],
    ['b', 'Петя'],
  ];
  const accuse = hear('Я видел Васю у тела, голосую за него', names);
  assert.deepEqual(accuse.named, ['a']);
  assert.equal(accuse.accuse, true);
  const vouch = hear('Петя был со мной всё время', names);
  assert.deepEqual(vouch.named, ['b']);
  assert.equal(vouch.vouch, true);
  assert.equal(vouch.accuse, false, 'поручительство не считается обвинением');
  // «Вася не предатель» — тоже поручительство, хотя слово «предатель» в строке есть.
  assert.equal(hear('вася не предатель, он чинил реактор', names).vouch, true);
  assert.equal(hear('давайте пропустим, улик нет', names).skip, true);
  assert.deepEqual(hear('я ничего не видел', names).named, []);
  // Ё и регистр не мешают, и первым идёт тот, кого назвали раньше.
  assert.deepEqual(hear('ПЕТЯ подозрительный, а вася нет', names).named, ['b', 'a']);
});

test('talk: names lose the bot mark, zones turn into a place to name', () => {
  assert.equal(plainName('🤖 Кира'), 'Кира');
  assert.equal(plainName('Кира'), 'Кира');
  assert.equal(zoneOf(ship, { x: 0, z: -20 }), 'Кафетерий');
  assert.equal(placeOf('Кафетерий'), 'в отсеке «Кафетерий»');
  assert.equal(placeOf(''), 'в коридорах');
});

test('bots discuss at the meeting: the one who found the body names it, others answer', () => {
  const hub = roomWithBots('expert', 4, { killCooldownSeconds: 60 });
  impostorAction(hub, 'host', { action: 'start' }, T);
  const bots = hub.room.bots.map((b) => b.id);
  for (const p of Object.values(hub.impostor.players)) p.role = p.id === 'host' ? 'impostor' : 'crew';
  const brains = new Map();
  let now = T + 6000;
  resolveCombat(hub, now);
  // Человек-предатель убивает первого бота на глазах у второго.
  const place = (id, x, z) => {
    const m = hub.members.get(id);
    m.pose = { ...m.pose, x, y: 0, z };
    m.lastMoveAt = 0;
  };
  place('host', -3, -17);
  place(bots[0], -4, -17);
  place(bots[1], 0, -17);
  const watcher = new ImpostorBot(hub.room.bots[1], seeded(3));
  brains.set(bots[1], watcher);
  for (let i = 0; i < 6; i++) {
    now += 100;
    place(bots[1], 0, -17);
    hub.members.get('host').seen = now;
    watcher.step(hub, ship, now, { act: (id, op) => impostorAction(hub, id, op, now), move: (m, op) => presence(hub, m, op, now) });
  }
  hub.impostor.players.host.killReadyAt = 0;
  assert.equal(impostorAction(hub, 'host', { action: 'kill', target: bots[0] }, now).ok, true);
  const { now: after, said } = run(hub, brains, now, 30);
  assert.equal(hub.impostor.phase, 'meeting', 'тело нашли и созвали собрание');
  const caller = hub.impostor.meeting.caller;
  assert.ok(said.length >= 2, `боты заговорили: ${said.map((s) => s.text).join(' | ')}`);
  assert.ok(
    said.some((s) => s.id === caller && /тело|труп/i.test(s.text)),
    'нашедший рассказал про тело',
  );
  // Обвинение против человека звучит вслух, и это обвинение именно того, кого видели.
  assert.ok(
    said.some((s) => s.text.includes('Ведущий')),
    `кто-то назвал убийцу: ${said.map((s) => s.text).join(' | ')}`,
  );
  // Сообщения собрания читают все, включая призрака убитого.
  assert.ok(said.every((s) => readsChat(s.entry, bots[0])));
  assert.ok(after > now);
});

test('bots listen: a human accusation moves the vote of a crew bot that saw nothing', () => {
  const hub = roomWithBots('medium', 4, { killCooldownSeconds: 60, discussionSeconds: 0, votingSeconds: 30 });
  impostorAction(hub, 'host', { action: 'start' }, T);
  const bots = hub.room.bots.map((b) => b.id);
  for (const p of Object.values(hub.impostor.players)) p.role = p.id === bots[3] ? 'impostor' : 'crew';
  const g = hub.impostor;
  // Собрание без обсуждения: сразу голосование, боты ничего не видели.
  const now = T + 6000;
  resolveCombat(hub, now);
  g.phase = 'voting';
  g.until = now + 30_000;
  g.meeting = { caller: 'host', reason: 'button' };
  const victim = bots[3];
  const name = plainName(hub.members.get(victim).name);
  // Три человека (ведущий и двое «игроков») уверенно обвиняют одного и того же.
  for (const [i, from] of ['host', bots[0], bots[1]].entries()) {
    const r = postChat(hub, from, { channel: 'all', text: `Я видел ${name} у тела, голосую за него` }, now + i);
    assert.equal(r.ok, true);
  }
  const brains = new Map();
  const { said } = run(hub, brains, now, 25);
  const followers = [bots[0], bots[1], bots[2]].filter((id) => g.votes[id] === victim);
  assert.ok(followers.length >= 1, `боты услышали чат: ${JSON.stringify(g.votes)}`);
  // Проголосовав, бот говорит об этом вслух — но не обязан: реплика необязательная.
  assert.ok(said.every((line) => typeof line.text === 'string'));
});

test('impostor bots keep their plans in the team channel', () => {
  const hub = roomWithBots('expert', 4, { killCooldownSeconds: 60 });
  impostorAction(hub, 'host', { action: 'start' }, T);
  const bots = hub.room.bots.map((b) => b.id);
  const traitors = [bots[0], bots[1]];
  for (const p of Object.values(hub.impostor.players)) p.role = traitors.includes(p.id) ? 'impostor' : 'crew';
  const g = hub.impostor;
  const now = T + 6000;
  resolveCombat(hub, now);
  g.phase = 'meeting';
  g.until = now + 45_000;
  g.meeting = { caller: 'host', reason: 'button' };
  const { said } = run(hub, new Map(), now, 20);
  const team = said.filter((s) => s.channel === 'team');
  for (const line of team) {
    assert.ok(traitors.includes(line.id), 'командный канал только у предателей');
    assert.ok(!readsChat(line.entry, 'host'), 'экипаж не читает переписку предателей');
  }
  // Что бы ни говорили предатели вслух, себя они не обвиняют.
  for (const line of said.filter((s) => s.channel === 'all' && traitors.includes(s.id))) {
    for (const mate of traitors) assert.ok(!line.text.includes(plainName(hub.members.get(mate).name)), line.text);
  }
});

test('impostor sounds follow the party: start, meeting, votes, ejection and the result', () => {
  const snap = (patch) => ({ phase: 'play', game: 1, role: 'crew', winner: null, voted: [], ejected: null, sabotage: null, ...patch });
  assert.deepEqual(impostorSoundEvents(undefined, snap({})), [], 'первый снимок молчит');
  assert.deepEqual(impostorSoundEvents(snap({ phase: 'lobby' }), snap({ phase: 'intro' })), [{ sound: 'start' }]);
  assert.deepEqual(impostorSoundEvents(snap({}), snap({ phase: 'meeting' })), [{ sound: 'meeting' }]);
  // Без обсуждения собрание сразу становится голосованием — это всё ещё созыв.
  assert.deepEqual(impostorSoundEvents(snap({}), snap({ phase: 'voting' })), [{ sound: 'meeting' }]);
  assert.deepEqual(impostorSoundEvents(snap({ phase: 'meeting' }), snap({ phase: 'voting' })), [{ sound: 'voting' }]);
  assert.deepEqual(
    impostorSoundEvents(snap({ phase: 'voting', voted: ['a'] }), snap({ phase: 'voting', voted: ['a', 'b'] })),
    [{ sound: 'vote' }],
  );
  assert.deepEqual(
    impostorSoundEvents(snap({ phase: 'voting' }), snap({ phase: 'eject', ejected: { id: 'a', impostor: true, tie: false } })),
    [{ sound: 'eject', delay: 0.3 }],
  );
  assert.deepEqual(
    impostorSoundEvents(snap({ phase: 'voting' }), snap({ phase: 'eject', ejected: { id: null, impostor: false, tie: true } })),
    [],
    'никого не изгнали — никто и не падает за борт',
  );
  assert.deepEqual(impostorSoundEvents(snap({}), snap({ phase: 'ended', winner: 'crew' })), [{ sound: 'win' }]);
  assert.deepEqual(impostorSoundEvents(snap({}), snap({ phase: 'ended', winner: 'impostor' })), [{ sound: 'lose' }]);
  assert.deepEqual(
    impostorSoundEvents(snap({ role: null }), snap({ phase: 'ended', role: null, winner: 'impostor' })),
    [{ sound: 'win' }],
    'у зрителя нет проигравшей стороны',
  );
  assert.deepEqual(
    impostorSoundEvents(snap({}), snap({ sabotage: { kind: 'o2', until: 1, fixed: [], held: [] } })),
    [{ sound: 'sabotage' }],
  );
  assert.deepEqual(
    impostorSoundEvents(snap({ sabotage: { kind: 'o2', until: 1, fixed: [], held: [] } }), snap({ sabotage: { kind: 'o2', until: 1, fixed: ['x'], held: [] } })),
    [],
    'та же авария не воет заново каждый тик',
  );
});

test('talk: bots understand every line other bots say about someone', () => {
  const names = [['x', 'Динара']];
  const who = 'Динара',
    victim = 'Тимур',
    place = 'в отсеке «Кафетерий»';
  // Что должен услышать другой бот: обвинение очевидца, обвинение или поручительство.
  const expect = {
    witness: [...SAY.sawKill(who, victim), ...SAY.nearBody(who, place)],
    accuse: [
      ...SAY.hunch(who),
      ...SAY.buttonSuspect(who),
      ...SAY.blameReporter(who),
      ...SAY.blame(who),
      ...SAY.agree(who),
      ...SAY.counter(who),
      ...SAY.vote(who),
      ...SAY.planTeam(who),
    ],
    vouch: [...SAY.defendAlly(who), ...SAY.alibiWith(place, who)],
  };
  for (const [kind, lines] of Object.entries(expect))
    for (const text of lines) {
      const heard = hear(text, names);
      assert.deepEqual(heard.named, ['x'], `имя найдено: ${text}`);
      if (kind === 'vouch') assert.ok(heard.vouch && !heard.accuse, `поручительство: ${text}`);
      else assert.ok(heard.accuse && !heard.vouch, `обвинение: ${text}`);
      if (kind === 'witness') assert.ok(heard.detail, `рассказ очевидца: ${text}`);
      // Подстава предателя — рассуждение, а не свидетельство: подробностью она не считается.
      if ([...SAY.blameReporter(who), ...SAY.blame(who)].includes(text)) assert.ok(!heard.detail, `не очевидец: ${text}`);
    }
});

test('talk: lines without anyone to blame never turn into an accusation of the named', () => {
  const names = [['x', 'Динара']];
  // Своё алиби и отрицание не задевают других, даже если в них есть слова вроде «предатель».
  for (const text of [
    ...SAY.denyCrew('в отсеке «Связь»'),
    ...SAY.denyImpostor('в отсеке «Связь»'),
    ...SAY.alibi('в отсеке «Связь»'),
    ...SAY.noClue,
    ...SAY.shrug,
    ...SAY.suggestSkip,
  ])
    assert.deepEqual(hear(text, names).named, [], text);
});
