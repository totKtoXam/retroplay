import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fireEffect,
  impostorAction,
  isFrozen,
  memberFromRow,
  newMatch,
  presence,
  publicMembers,
  resolveCombat,
  roomFromState,
  seatMember,
  voiceAudience,
} from '../lib/room-hub-core.ts';
import {
  impostorCount,
  impostorView,
  newImpostorGame,
  seatsFor,
  TASK_MS,
} from '../lib/impostor.ts';
import { encodeCheckpoint, restoreCheckpoint } from '../lib/room-checkpoint.ts';
import { applyOperation, initialState } from '../lib/model.ts';
import { getMap } from '../lib/maps/index.ts';
import { isBlocked3D } from '../lib/world-collision.ts';
import { reachable } from './map-helpers.mjs';

const T = 1_000_000;
const stand = (x, z) => ({ x, y: 0, z, yaw: 0, stance: 'stand', moving: false });

/** Комната «Предателя» на корабле: ведущий `host` и ещё `extra` игроков в сети. */
function room(extra = 4, settings = {}) {
  const state = { mode: 'impostor', map: 'ship', impostor: { discussionSeconds: 10, votingSeconds: 20, ...settings } };
  const hub = {
    room: { ...roomFromState('host', state), shieldSeconds: 0 },
    members: new Map(),
    effects: [],
    seq: 0,
    match: newMatch(roomFromState('host', state), T),
    impostor: newImpostorGame(),
  };
  for (const id of ['host', ...Array.from({ length: extra }, (_, i) => `p${i + 1}`)])
    hub.members.set(id, memberFromRow({ session: id, name: id, seen: T }));
  return hub;
}

const act = (hub, self, op, now = T) => impostorAction(hub, self, op, now);
/** Начать партию и промотать показ ролей. */
function started(extra = 4, settings = {}) {
  const hub = room(extra, settings);
  assert.deepEqual(act(hub, 'host', { action: 'start' }), { ok: true });
  const now = T + 6000;
  for (const m of hub.members.values()) m.seen = now;
  resolveCombat(hub, now);
  assert.equal(hub.impostor.phase, 'play');
  const players = Object.values(hub.impostor.players);
  return {
    hub,
    now,
    impostors: players.filter((p) => p.role === 'impostor').map((p) => p.id),
    crew: players.filter((p) => p.role === 'crew').map((p) => p.id),
  };
}
const put = (hub, id, x, z) => {
  hub.members.get(id).pose = stand(x, z);
};

test('mode settings: the ship belongs to the impostor mode, numbers are clamped', () => {
  const set = (s, patch) => applyOperation(s, { type: 'room.settings', patch }, 'host', 'host');
  let s = set(initialState('Retro'), { mode: 'impostor' });
  assert.equal(s.mode, 'impostor');
  assert.equal(s.map, 'ship');
  s = set(s, { impostor: { impostors: 2, votingSeconds: 60 } });
  s = set(s, { impostor: { confirmEjects: false } });
  assert.deepEqual(s.impostor, { impostors: 2, votingSeconds: 60, confirmEjects: false });
  assert.throws(() => set(s, { impostor: { impostors: 9 } }));
  assert.throws(() => set(s, { impostor: { tasksPerPlayer: 1.5 } }));
  assert.throws(() => set(s, { map: 'mansion' }), 'a battle map does not fit the mode');
  const r = roomFromState('host', { mode: 'impostor', map: 'ship', impostor: { killCooldownSeconds: 999, discussionSeconds: -3 } });
  assert.equal(r.mode, 'impostor');
  assert.equal(r.teams, false);
  assert.equal(r.impostor.killCooldownSeconds, 60);
  assert.equal(r.impostor.discussionSeconds, 0);
  assert.equal(r.impostor.votingSeconds, 30);
});

test('impostor count: automatic by player count, always fewer than half', () => {
  assert.equal(impostorCount(4, 0), 1);
  assert.equal(impostorCount(4, 3), 1);
  assert.equal(impostorCount(7, 0), 2);
  assert.equal(impostorCount(5, 2), 2);
  assert.equal(impostorCount(15, 0), 3);
});

test('only the host starts, with at least four players online', () => {
  const small = room(2);
  assert.equal(act(small, 'host', { action: 'start' }).ok, false);
  const hub = room(4);
  assert.equal(act(hub, 'p1', { action: 'start' }).ok, false);
  const lives = [...hub.members.values()].map((m) => m.life);
  assert.deepEqual(act(hub, 'host', { action: 'start' }), { ok: true });
  assert.equal(hub.impostor.phase, 'intro');
  assert.equal(isFrozen(hub, T), true);
  const players = Object.values(hub.impostor.players);
  assert.equal(players.length, 5);
  assert.equal(players.filter((p) => p.role === 'impostor').length, 1);
  for (const p of players) assert.equal(p.tasks.length, 4);
  // Все за столом, и у каждого новая жизнь — клиент телепортируется.
  [...hub.members.values()].forEach((m, i) => {
    assert.equal(m.life, lives[i] + 1);
    const d = Math.hypot(m.pose.x - getMap('ship').meeting.x, m.pose.z - getMap('ship').meeting.z);
    assert.ok(d > 3 && d < 4);
  });
  assert.equal(act(hub, 'host', { action: 'start' }).ok, false);
});

test('roles stay secret: a crewmate learns nothing, an impostor sees only allies', () => {
  const { hub, impostors, crew } = started(8);
  assert.equal(impostors.length, 2);
  const crewView = impostorView(hub, crew[0]);
  assert.equal(crewView.role, 'crew');
  assert.deepEqual(crewView.allies, []);
  assert.equal(crewView.roles, null);
  assert.equal(crewView.killReadyAt, 0);
  const text = JSON.stringify(crewView);
  assert.equal(text.includes('"impostor"'), false, 'no role of anyone else in a crew view');
  const impView = impostorView(hub, impostors[0]);
  assert.equal(impView.role, 'impostor');
  assert.deepEqual(impView.allies, [impostors[1]]);
  assert.ok(impView.killReadyAt > 0);
  // Задания видны только свои.
  assert.deepEqual(
    crewView.tasks.map((t) => t.station),
    hub.impostor.players[crew[0]].tasks.map((t) => t.station),
  );
});

test('kills: only an impostor, in reach, not through walls, after the cooldown', () => {
  const { hub, now, impostors, crew } = started(4, { killCooldownSeconds: 10 });
  const [killer] = impostors;
  const [victim, other] = crew;
  put(hub, killer, -3, -17);
  put(hub, victim, -1.5, -17);
  assert.equal(act(hub, killer, { action: 'kill', target: victim }, now).ok, false, 'cooldown');
  const later = now + 11_000;
  assert.equal(act(hub, other, { action: 'kill', target: victim }, later).ok, false, 'crew cannot kill');
  assert.equal(act(hub, killer, { action: 'kill', target: killer }, later).ok, false);
  put(hub, victim, 2.5, -17);
  assert.equal(act(hub, killer, { action: 'kill', target: victim }, later).ok, false, 'too far');
  // Западная стена кафетерия (x = -10) между ними.
  put(hub, killer, -9, -20);
  put(hub, victim, -11, -20);
  assert.equal(act(hub, killer, { action: 'kill', target: victim }, later).ok, false, 'through the wall');
  put(hub, killer, -3, -17);
  put(hub, victim, -1.5, -17);
  assert.deepEqual(act(hub, killer, { action: 'kill', target: victim }, later), { ok: true });
  assert.equal(hub.impostor.players[victim].alive, false);
  assert.equal(hub.impostor.bodies.length, 1);
  assert.equal(act(hub, killer, { action: 'kill', target: other }, later + 100).ok, false, 'cooldown again');
});

test('the dead are ghosts: living players neither see them nor learn of the death', () => {
  const { hub, now, impostors, crew } = started(4, { killCooldownSeconds: 10 });
  const t = now + 11_000;
  for (const m of hub.members.values()) m.seen = t;
  put(hub, impostors[0], -3, -17);
  put(hub, crew[0], -1.5, -17);
  act(hub, impostors[0], { action: 'kill', target: crew[0] }, t);
  const living = crew[1];
  assert.equal(publicMembers(hub, t, living).some((m) => m.id === crew[0]), false);
  assert.equal(publicMembers(hub, t, crew[0]).length, 5, 'a ghost sees everyone');
  assert.equal(impostorView(hub, living).players.find((p) => p.id === crew[0]).alive, true);
  assert.equal(impostorView(hub, crew[0]).players.find((p) => p.id === crew[0]).alive, false);
  // Призрак проходит сквозь стену кафетерия, живой — нет.
  const ghost = hub.members.get(crew[0]);
  ghost.pose = stand(-9.5, -20);
  ghost.lastMoveAt = t;
  presence(hub, ghost, { pose: stand(-10.6, -20), life: ghost.life }, t + 500);
  assert.equal(ghost.pose.x, -10.6);
  const alive = hub.members.get(living);
  alive.pose = stand(-9.5, -20);
  alive.lastMoveAt = t;
  presence(hub, alive, { pose: stand(-10.6, -20), life: alive.life }, t + 500);
  assert.equal(alive.pose.x, -9.5);
});

test('voice: silence while playing, everyone at meetings, ghosts only among ghosts', () => {
  const { hub, now, impostors, crew } = started(4, { killCooldownSeconds: 10 });
  const t = now + 11_000;
  const hears = (from, to) => voiceAudience(hub, from, 'all')(to);
  assert.equal(hears(crew[0], crew[1]), false);
  put(hub, impostors[0], -3, -17);
  put(hub, crew[0], -1.5, -17);
  act(hub, impostors[0], { action: 'kill', target: crew[0] }, t);
  put(hub, crew[1], -1.5, -15.5);
  assert.equal(act(hub, crew[1], { action: 'report', body: crew[0] }, t).ok, true);
  assert.equal(hears(crew[1], crew[2]), true);
  assert.equal(hears(crew[0], crew[1]), false, 'the dead are not heard');
  assert.equal(hears(crew[1], crew[0]), true, 'the dead hear the living');
});

test('weapons are disabled in the impostor mode', () => {
  const { hub, now } = started();
  const shot = { kind: 'paint', origin: [0, 1, 0], target: [0, 1, -5], normal: [0, 0, 1], color: '#ff0000' };
  assert.deepEqual(fireEffect(hub, 'host', shot, now), { ok: false, reason: 'mode' });
});

test('report → discussion → voting → ejection; the dead cannot vote', () => {
  const { hub, now, impostors, crew } = started(5, { killCooldownSeconds: 10, discussionSeconds: 10, votingSeconds: 20 });
  const t = now + 11_000;
  const all = [...hub.members.values()];
  for (const m of all) m.seen = t;
  put(hub, impostors[0], -3, -17);
  put(hub, crew[0], -1.5, -17);
  act(hub, impostors[0], { action: 'kill', target: crew[0] }, t);
  put(hub, crew[1], 20, 0);
  assert.equal(act(hub, crew[1], { action: 'report', body: crew[0] }, t).ok, false, 'too far to report');
  put(hub, crew[1], 0, -16);
  assert.equal(act(hub, crew[0], { action: 'report', body: crew[0] }, t).ok, false, 'a ghost cannot report');
  assert.deepEqual(act(hub, crew[1], { action: 'report', body: crew[0] }, t), { ok: true });
  assert.equal(hub.impostor.phase, 'meeting');
  assert.equal(isFrozen(hub, t), true);
  assert.equal(impostorView(hub, crew[2]).players.find((p) => p.id === crew[0]).alive, false, 'death revealed');
  assert.equal(act(hub, crew[1], { action: 'vote', target: impostors[0] }, t).ok, false, 'discussion first');
  const voting = t + 10_001;
  for (const m of all) m.seen = voting;
  resolveCombat(hub, voting);
  assert.equal(hub.impostor.phase, 'voting');
  assert.equal(act(hub, crew[0], { action: 'vote', target: impostors[0] }, voting).ok, false, 'dead vote');
  assert.equal(act(hub, crew[1], { action: 'vote', target: crew[0] }, voting).ok, false, 'vote for the dead');
  act(hub, crew[1], { action: 'vote', target: impostors[0] }, voting);
  assert.equal(act(hub, crew[1], { action: 'vote', target: 'skip' }, voting).ok, false, 'one vote');
  // Пока идёт голосование, видно только кто проголосовал.
  const during = impostorView(hub, crew[2]);
  assert.deepEqual(during.voted, [crew[1]]);
  assert.equal(during.votes, null);
  act(hub, crew[2], { action: 'vote', target: impostors[0] }, voting);
  act(hub, crew[3], { action: 'vote', target: impostors[0] }, voting);
  act(hub, impostors[0], { action: 'vote', target: crew[1] }, voting);
  act(hub, crew[4], { action: 'vote', target: 'skip' }, voting);
  // Все живые проголосовали — итог сразу, без таймера.
  assert.equal(hub.impostor.phase, 'eject');
  assert.deepEqual(hub.impostor.ejected, { id: impostors[0], impostor: true, tie: false });
  resolveCombat(hub, voting + 6001);
  assert.equal(hub.impostor.phase, 'ended');
  assert.equal(hub.impostor.winner, 'crew');
  assert.equal(hub.impostor.winReason, 'ejected');
  assert.equal(impostorView(hub, crew[2]).roles[impostors[0]], 'impostor', 'roles revealed at the end');
});

test('a tie or a skip ejects nobody and play resumes with bodies cleared', () => {
  const { hub, now, impostors, crew } = started(4, { discussionSeconds: 0 });
  const t = now + 16_000;
  for (const m of hub.members.values()) m.seen = t;
  put(hub, crew[0], 0, -20.5);
  assert.deepEqual(act(hub, crew[0], { action: 'meeting' }, t), { ok: true });
  assert.equal(hub.impostor.phase, 'voting', 'no discussion when it is set to zero');
  assert.equal(hub.impostor.players[crew[0]].meetingsLeft, 0);
  act(hub, crew[0], { action: 'vote', target: crew[1] }, t);
  act(hub, crew[1], { action: 'vote', target: crew[0] }, t);
  act(hub, crew[2], { action: 'vote', target: 'skip' }, t);
  assert.equal(hub.impostor.phase, 'voting', 'waits for everyone');
  act(hub, crew[3], { action: 'vote', target: 'skip' }, t);
  act(hub, impostors[0], { action: 'vote', target: 'skip' }, t);
  assert.equal(hub.impostor.phase, 'eject');
  assert.equal(hub.impostor.ejected.id, null);
  resolveCombat(hub, t + 6001);
  assert.equal(hub.impostor.phase, 'play');
  assert.deepEqual(hub.impostor.bodies, []);
  put(hub, crew[0], 0, -20.5);
  assert.equal(act(hub, crew[0], { action: 'meeting' }, t + 7000).ok, false, 'no meetings left');
});

test('emergency button: at the table, after its cooldown', () => {
  const { hub, now, crew } = started();
  put(hub, crew[0], 0, -20.5);
  assert.equal(act(hub, crew[0], { action: 'meeting' }, now).ok, false, 'button cooldown');
  put(hub, crew[0], 0, -17);
  assert.equal(act(hub, crew[0], { action: 'meeting' }, now + 16_000).ok, false, 'away from the table');
});

test('tasks: only crew, at the console, not faster than the mini-game; all done wins', () => {
  const { hub, now, impostors, crew } = started(4, { tasksPerPlayer: 2 });
  const map = getMap('ship');
  const station = (id) => map.stations.find((s) => s.id === id);
  const imp = hub.impostor.players[impostors[0]];
  const st0 = station(imp.tasks[0].station);
  put(hub, impostors[0], st0.x, st0.z);
  assert.equal(act(hub, impostors[0], { action: 'task.start', station: st0.id }, now).ok, false);
  let t = now;
  for (const id of crew) {
    for (const task of hub.impostor.players[id].tasks) {
      const st = station(task.station);
      put(hub, id, st.x + 3, st.z);
      assert.equal(act(hub, id, { action: 'task.start', station: st.id }, t).ok, false, 'too far');
      put(hub, id, st.x, st.z);
      assert.deepEqual(act(hub, id, { action: 'task.start', station: st.id }, t), { ok: true });
      assert.equal(act(hub, id, { action: 'task.done', station: st.id }, t + 500).ok, false, 'too fast');
      t += TASK_MS[st.kind];
      if (hub.impostor.phase === 'play') assert.deepEqual(act(hub, id, { action: 'task.done', station: st.id }, t), { ok: true });
    }
  }
  assert.equal(hub.impostor.phase, 'ended');
  assert.equal(hub.impostor.winner, 'crew');
  assert.equal(hub.impostor.winReason, 'tasks');
  assert.deepEqual(impostorView(hub, crew[0]).progress, { done: crew.length * 2, total: crew.length * 2 });
});

test('impostors win when they equal the living crew', () => {
  const { hub, now, impostors, crew } = started(3, { killCooldownSeconds: 10 });
  const t = now + 11_000;
  put(hub, impostors[0], -3, -17);
  put(hub, crew[0], -1.5, -17);
  assert.deepEqual(act(hub, impostors[0], { action: 'kill', target: crew[0] }, t), { ok: true });
  assert.equal(hub.impostor.phase, 'play', '1 impostor vs 2 crew');
  put(hub, crew[1], -1.5, -17);
  assert.deepEqual(act(hub, impostors[0], { action: 'kill', target: crew[1] }, t + 10_001), { ok: true });
  assert.equal(hub.impostor.phase, 'ended');
  assert.equal(hub.impostor.winner, 'impostor');
});

test('a player who leaves drops out; if the impostor leaves, the crew wins', () => {
  const { hub, now, impostors, crew } = started(4);
  const t = now + 50_000;
  for (const id of crew) hub.members.get(id).seen = t;
  // Свёрнутая вкладка с живым сокетом — ещё в партии.
  hub.connected = (id) => id === impostors[0];
  resolveCombat(hub, t);
  assert.equal(hub.impostor.players[impostors[0]].left, false);
  hub.connected = () => false;
  resolveCombat(hub, t);
  assert.equal(hub.impostor.players[impostors[0]].left, true);
  assert.equal(hub.impostor.phase, 'ended');
  assert.equal(hub.impostor.winner, 'crew');
  assert.equal(hub.impostor.winReason, 'left');
  // После итога все возвращаются в лобби за стол.
  resolveCombat(hub, t + 12_001);
  assert.equal(hub.impostor.phase, 'lobby');
});

test('host can stop a game; a room switched to another mode resets it', () => {
  const { hub, now } = started();
  assert.equal(act(hub, 'p1', { action: 'stop' }, now).ok, false);
  assert.deepEqual(act(hub, 'host', { action: 'stop' }, now), { ok: true });
  assert.equal(hub.impostor.phase, 'lobby');
  const other = started();
  other.hub.room = { ...other.hub.room, mode: 'retro', map: 'hub' };
  resolveCombat(other.hub, other.now);
  assert.equal(other.hub.impostor.phase, 'lobby');
  assert.equal(act(other.hub, 'host', { action: 'start' }, other.now).ok, false);
});

test('checkpoint keeps the game: roles, tasks and phase survive a restart', () => {
  const { hub, crew } = started();
  const data = encodeCheckpoint('room', hub);
  const fresh = room();
  assert.equal(restoreCheckpoint('room', fresh, data), true);
  assert.deepEqual(fresh.impostor, hub.impostor);
  assert.equal(fresh.impostor.players[crew[0]].role, 'crew');
});

test('ship: every station and seat is free and reachable from the table', () => {
  const map = getMap('ship');
  assert.ok(map.stations.length >= 8);
  assert.ok(map.meeting);
  const ids = Array.from({ length: 15 }, (_, i) => `id${String(i).padStart(2, '0')}`);
  const seats = [...seatsFor(map, ids).values()];
  for (const p of [...seats, ...map.spawns.red])
    assert.equal(isBlocked3D(p.x, p.z, 0, 0.4, 1.8, map.colliders), false, `seat (${p.x}, ${p.z})`);
  const from = seats[0];
  for (const st of map.stations) {
    assert.equal(isBlocked3D(st.x, st.z, 0, 0.32, 1.8, map.colliders), false, `${st.id} blocked`);
    assert.ok(reachable(map, from, st), `${st.id} unreachable`);
  }
});

test('seatMember starts a new life at the seat', () => {
  const hub = room(0);
  const m = hub.members.get('host');
  seatMember(hub, 'host', { x: 1, z: 2, yaw: 0.5 });
  assert.equal(m.life, 1);
  assert.deepEqual([m.pose.x, m.pose.z, m.pose.yaw], [1, 2, 0.5]);
});

test('ship: each station stands inside the room it names; the ship is indoors', () => {
  const map = getMap('ship');
  assert.equal(map.arena.indoor, true);
  for (const st of map.stations) {
    const zone = map.arena.zones.find((z) => z.name === st.room);
    assert.ok(zone, `${st.id}: room ${st.room}`);
    assert.ok(st.x > zone.minX && st.x < zone.maxX && st.z > zone.minZ && st.z < zone.maxZ, `${st.id} outside ${st.room}`);
  }
  assert.equal(new Set(map.stations.map((s) => s.id)).size, map.stations.length, 'unique ids');
});

// ---------------------------------------------------------------- саботаж и вентиляция

const panel = (id) => getMap('ship').panels.find((p) => p.id === id);
const ventAt = (id) => getMap('ship').vents.find((v) => v.id === id);

test('sabotage: only an alive impostor, one at a time, after the cooldown', () => {
  const { hub, now, impostors, crew } = started();
  const t = now + 31_000;
  assert.equal(act(hub, impostors[0], { action: 'sabotage', kind: 'lights' }, now).ok, false, 'cooldown after start');
  assert.equal(act(hub, crew[0], { action: 'sabotage', kind: 'lights' }, t).ok, false, 'crew cannot sabotage');
  assert.equal(act(hub, impostors[0], { action: 'sabotage', kind: 'meteor' }, t).ok, false);
  assert.deepEqual(act(hub, impostors[0], { action: 'sabotage', kind: 'lights' }, t), { ok: true });
  assert.equal(act(hub, impostors[0], { action: 'sabotage', kind: 'o2' }, t).ok, false, 'one at a time');
  // Все видят аварию, но таймер у света не тикает.
  assert.equal(impostorView(hub, crew[0]).sabotage.kind, 'lights');
  assert.equal(impostorView(hub, crew[0]).sabotage.until, 0);
  assert.equal(impostorView(hub, crew[0]).sabotageReadyAt, 0, 'crew does not learn the cooldown');
  const p = panel('elec-lights');
  put(hub, crew[0], p.x + 3, p.z);
  assert.equal(act(hub, crew[0], { action: 'fix', panel: p.id }, t).ok, false, 'too far');
  put(hub, crew[0], p.x, p.z);
  assert.equal(act(hub, crew[0], { action: 'fix', panel: 'comms-fix' }, t).ok, false, 'wrong panel');
  assert.deepEqual(act(hub, crew[0], { action: 'fix', panel: p.id }, t), { ok: true });
  assert.equal(hub.impostor.sabotage, null);
  assert.equal(act(hub, impostors[0], { action: 'sabotage', kind: 'comms' }, t + 1000).ok, false, 'cooldown after repair');
});

test('comms sabotage hides task lists', () => {
  const { hub, now, impostors, crew } = started();
  act(hub, impostors[0], { action: 'sabotage', kind: 'comms' }, now + 31_000);
  const view = impostorView(hub, crew[0]);
  assert.deepEqual(view.tasks, []);
  assert.deepEqual(view.progress, { done: 0, total: 0 });
});

test('o2: both panels once each; unrepaired in time, impostors win', () => {
  const { hub, now, impostors, crew } = started();
  const t = now + 31_000;
  for (const m of hub.members.values()) m.seen = t + 50_000;
  act(hub, impostors[0], { action: 'sabotage', kind: 'o2' }, t);
  put(hub, crew[0], 0, -20.5);
  assert.equal(act(hub, crew[0], { action: 'meeting' }, t).ok, false, 'no button during a critical sabotage');
  const a = panel('o2-panel');
  put(hub, crew[0], a.x, a.z);
  act(hub, crew[0], { action: 'fix', panel: a.id }, t + 1000);
  assert.ok(hub.impostor.sabotage, 'one panel is not enough');
  act(hub, crew[0], { action: 'fix', panel: a.id }, t + 1100);
  assert.deepEqual(hub.impostor.sabotage.fixed, ['o2-panel'], 'the same panel counts once');
  resolveCombat(hub, t + 45_001);
  assert.equal(hub.impostor.phase, 'ended');
  assert.equal(hub.impostor.winner, 'impostor');
  assert.equal(hub.impostor.winReason, 'sabotage');
});

test('reactor: two different players must hold both panels at once', () => {
  const { hub, now, impostors, crew } = started();
  const t = now + 31_000;
  act(hub, impostors[0], { action: 'sabotage', kind: 'reactor' }, t);
  const top = panel('reactor-top'),
    bottom = panel('reactor-bottom');
  put(hub, crew[0], top.x, top.z);
  put(hub, crew[1], bottom.x, bottom.z);
  act(hub, crew[0], { action: 'fix', panel: top.id }, t + 1000);
  act(hub, crew[1], { action: 'fix', panel: bottom.id }, t + 4000);
  assert.ok(hub.impostor.sabotage, 'holds far apart in time do not count');
  put(hub, crew[0], bottom.x, bottom.z);
  act(hub, crew[0], { action: 'fix', panel: bottom.id }, t + 4100);
  put(hub, crew[0], top.x, top.z);
  act(hub, crew[0], { action: 'fix', panel: top.id }, t + 4200);
  assert.ok(hub.impostor.sabotage, 'one player cannot hold both');
  act(hub, crew[1], { action: 'fix', panel: bottom.id }, t + 4300);
  assert.equal(hub.impostor.sabotage, null);
});

test('a meeting clears the sabotage and pulls everyone out of vents', () => {
  const { hub, now, impostors, crew } = started();
  const t = now + 31_000;
  act(hub, impostors[0], { action: 'sabotage', kind: 'lights' }, t);
  const v = ventAt('v-cafe');
  put(hub, impostors[0], v.x, v.z);
  assert.deepEqual(act(hub, impostors[0], { action: 'vent.enter', vent: v.id }, t), { ok: true });
  put(hub, crew[0], 0, -20.5);
  assert.deepEqual(act(hub, crew[0], { action: 'meeting' }, t), { ok: true });
  assert.equal(hub.impostor.sabotage, null);
  assert.equal(hub.impostor.players[impostors[0]].vent, null);
});

test('vents: impostors hide, crawl along links, cannot act or move from inside', () => {
  const { hub, now, impostors, crew } = started(4, { killCooldownSeconds: 10 });
  const t = now + 11_000;
  for (const m of hub.members.values()) m.seen = t;
  const imp = impostors[0];
  const cafe = ventAt('v-cafe');
  put(hub, crew[0], cafe.x, cafe.z);
  assert.equal(act(hub, crew[0], { action: 'vent.enter', vent: cafe.id }, t).ok, false, 'crew cannot vent');
  put(hub, imp, cafe.x + 3, cafe.z);
  assert.equal(act(hub, imp, { action: 'vent.enter', vent: cafe.id }, t).ok, false, 'too far');
  put(hub, imp, cafe.x, cafe.z);
  put(hub, crew[0], cafe.x + 1, cafe.z);
  assert.deepEqual(act(hub, imp, { action: 'vent.enter', vent: cafe.id }, t), { ok: true });
  // Живые не видят сидящего в решётке.
  assert.equal(publicMembers(hub, t, crew[1]).some((m) => m.id === imp), false);
  assert.equal(act(hub, imp, { action: 'kill', target: crew[0] }, t).ok, false, 'no kill from a vent');
  // Шаги из решётки сервер не принимает.
  const m = hub.members.get(imp);
  m.lastMoveAt = t;
  presence(hub, m, { pose: stand(cafe.x + 1, cafe.z), life: m.life }, t + 500);
  assert.equal(m.pose.x, cafe.x);
  assert.equal(act(hub, imp, { action: 'vent.move', vent: 'v-reactor' }, t).ok, false, 'not linked');
  const life = m.life;
  assert.deepEqual(act(hub, imp, { action: 'vent.move', vent: 'v-admin' }, t), { ok: true });
  const admin = ventAt('v-admin');
  assert.deepEqual([m.pose.x, m.pose.z, m.life], [admin.x, admin.z, life + 1], 'moved with a new life');
  assert.deepEqual(act(hub, imp, { action: 'vent.exit' }, t), { ok: true });
  assert.equal(publicMembers(hub, t, crew[1]).some((x) => x.id === imp), true);
  assert.equal(impostorView(hub, imp).vent, null);
});

test('ship: sabotage panels and vents are free, reachable, and vent links are symmetric', () => {
  const map = getMap('ship');
  const from = seatsFor(map, ['a']).get('a');
  for (const kind of ['lights', 'comms', 'reactor', 'o2'])
    assert.ok(map.panels.some((p) => p.sabotage === kind), `${kind} has a panel`);
  assert.equal(map.panels.filter((p) => p.sabotage === 'reactor').length, 2);
  for (const p of [...map.panels, ...map.vents]) {
    assert.equal(isBlocked3D(p.x, p.z, 0, 0.32, 1.8, map.colliders), false, `${p.id} blocked`);
    assert.ok(reachable(map, from, p), `${p.id} unreachable`);
  }
  const ids = new Set(map.vents.map((v) => v.id));
  for (const v of map.vents)
    for (const link of v.links) {
      assert.ok(ids.has(link), `${v.id} -> ${link}`);
      assert.ok(map.vents.find((x) => x.id === link).links.includes(v.id), `${link} <-> ${v.id}`);
    }
});
