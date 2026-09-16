import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minimapBlips } from '../lib/minimap-blips.ts';
import { ONLINE_MS, PRESENT_MS } from '../lib/model.ts';
import { SPOT_MEMORY_MS } from '../lib/spotting.ts';

const NOW = 1_700_000_000_000;

/** Участник в точке (x, z), смотрит вдоль −z; молчит `quiet` мс. */
const person = (id, team, x, z, { quiet = 0, hp = 100, yaw = 0 } = {}) => ({
  id,
  name: id,
  color: '#fff',
  team,
  lastSeen: NOW - quiet,
  hp,
  pose: { x, y: 0, z, yaw, pitch: 0, stance: 'stand', moving: false },
  ping: 10,
  mood: '',
  hat: '',
});

/** Свой игрок в начале координат, смотрит вдоль −z. */
const ME = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, stance: 'stand' };

const blips = (members, { now = NOW, memory = new Map(), me = ME } = {}) =>
  minimapBlips({ members, self: 'me', now, me, colliders: [], memory });

const ids = (list, members) =>
  list.map((b) => members.find((m) => m.pose.x === b.x && m.pose.z === b.z)?.id).sort();

test('на плане свои в сети; отошедшие и ушедшие не показываются', () => {
  const members = [
    person('me', 'red', 0, 0),
    person('online', 'red', 5, 5),
    person('away', 'red', 6, 6, { quiet: ONLINE_MS + 1000 }),
    person('left', 'red', 7, 7, { quiet: PRESENT_MS + 1000 }),
  ];
  assert.deepEqual(ids(blips(members), members), ['online']);
});

test('себя план рисует стрелкой, а не отметкой', () => {
  const members = [person('me', 'red', 0, 0), person('mate', 'red', 3, 3)];
  assert.deepEqual(ids(blips(members), members), ['mate']);
});

test('ушедший исчезает, даже если новых снимков комнаты не было — важны часы', () => {
  // Один и тот же снимок: союзник молчит, время идёт.
  const members = [person('me', 'red', 0, 0), person('mate', 'red', 5, 5)];
  assert.equal(blips(members).length, 1, 'пока в сети — виден');
  assert.equal(blips(members, { now: NOW + ONLINE_MS + 1000 }).length, 0, 'замолчал — пропал');
});

test('незасвеченный враг на плане не виден', () => {
  // Враг за спиной: я смотрю вдоль −z, он на +z.
  const members = [person('me', 'red', 0, 0), person('enemy', 'blue', 0, 20)];
  assert.deepEqual(blips(members), []);
});

test('враг в прицеле засвечивается и отмечается как враг', () => {
  const members = [person('me', 'red', 0, 0), person('enemy', 'blue', 0, -20)];
  const [mark] = blips(members);
  assert.equal(mark.enemy, true);
  assert.equal(mark.team, 'blue');
  assert.deepEqual([mark.x, mark.z], [0, -20]);
  assert.equal(mark.fresh, 1);
});

test('засветка живёт SPOT_MEMORY_MS и показывает последнее известное место', () => {
  const memory = new Map();
  const seen = [person('me', 'red', 0, 0), person('enemy', 'blue', 0, -20)];
  blips(seen, { memory });
  // Враг ушёл из прицела и сдвинулся, но на плане — старое место и гаснущая отметка.
  const moved = [person('me', 'red', 0, 0), person('enemy', 'blue', 0, 30)];
  const half = blips(moved, { memory, now: NOW + SPOT_MEMORY_MS / 2 });
  assert.equal(half.length, 1);
  assert.deepEqual([half[0].x, half[0].z], [0, -20]);
  assert.ok(Math.abs(half[0].fresh - 0.5) < 1e-9);
  // Память истекла — отметка пропала.
  assert.deepEqual(blips(moved, { memory, now: NOW + SPOT_MEMORY_MS + 1 }), []);
});

test('засвечивает и союзник: достаточно, чтобы смотрел кто-то из своих', () => {
  // Я смотрю в сторону, а союзник на z = −40 смотрит на врага перед собой.
  const aside = { ...ME, yaw: Math.PI };
  const members = [
    person('me', 'red', 0, 0),
    person('mate', 'red', 0, -40),
    person('enemy', 'blue', 0, -60),
  ];
  const marks = blips(members, { me: aside });
  assert.equal(marks.filter((b) => b.enemy).length, 1);
});

test('ушедший и погибший враг не засвечиваются, даже стоя в прицеле', () => {
  const members = [
    person('me', 'red', 0, 0),
    person('gone', 'blue', 0, -20, { quiet: PRESENT_MS + 1000 }),
    person('dead', 'blue', 1, -20, { hp: 0 }),
  ];
  assert.deepEqual(blips(members), []);
});

test('погибший свой остаётся на плане, но помечен', () => {
  const members = [person('me', 'red', 0, 0), person('mate', 'red', 5, 5, { hp: 0 })];
  const [mark] = blips(members);
  assert.equal(mark.dead, true);
});

test('без команд (хаб) видны все в сети, а засветки нет', () => {
  const memory = new Map([['stale', { x: 1, z: 1, at: NOW }]]);
  const members = [person('me', '', 0, 0), person('a', '', 0, -20), person('b', '', 5, 5)];
  const marks = blips(members, { memory });
  assert.deepEqual(ids(marks, members), ['a', 'b']);
  assert.equal(marks.some((b) => b.enemy), false);
  assert.equal(memory.size, 0, 'память засветки очищена');
});
