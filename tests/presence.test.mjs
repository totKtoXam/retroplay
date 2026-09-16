import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOnline,
  isPresent,
  ONLINE_MS,
  PRESENT_MS,
  presenceOf,
  ROOM_MEMORY_MS,
} from '../lib/model.ts';
import { publicMembers } from '../lib/room-hub-core.ts';

const NOW = 1_700_000_000_000;
const quiet = (ms) => NOW - ms;

test('три состояния присутствия сменяют друг друга по времени молчания', () => {
  assert.equal(presenceOf(quiet(0), NOW), 'online');
  assert.equal(presenceOf(quiet(ONLINE_MS - 1), NOW), 'online');
  assert.equal(presenceOf(quiet(ONLINE_MS), NOW), 'away');
  assert.equal(presenceOf(quiet(PRESENT_MS - 1), NOW), 'away');
  assert.equal(presenceOf(quiet(PRESENT_MS), NOW), 'left');
  // Отошедший — всё ещё в комнате, но уже не в сети.
  assert.deepEqual(
    [isOnline(quiet(ONLINE_MS + 1), NOW), isPresent(quiet(ONLINE_MS + 1), NOW)],
    [false, true],
  );
  assert.deepEqual(
    [isOnline(quiet(PRESENT_MS + 1), NOW), isPresent(quiet(PRESENT_MS + 1), NOW)],
    [false, false],
  );
});

test('окно переподключения заметно длиннее окна «в сети»', () => {
  // Перезагрузка страницы и короткий обрыв связи обязаны укладываться в него.
  assert.ok(PRESENT_MS >= ONLINE_MS * 3, `${PRESENT_MS} vs ${ONLINE_MS}`);
});

const member = (id, seenAgo) => [
  id,
  {
    id,
    name: id,
    color: '#fff',
    team: '',
    seen: quiet(seenAgo),
    pose: { x: 0, y: 0, z: 0, yaw: 0, stance: 'stand', moving: false },
    ping: 10,
    mood: '',
    hat: '',
    hp: 100,
    respawnAt: 0,
    immuneUntil: 0,
    life: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
  },
];

const hub = (...members) => ({
  room: { anonymous: false, shieldSeconds: 0, bots: [] },
  members: new Map(members),
});

test('снимок комнаты несёт присутствующих и недавно ушедших, но не забытых', () => {
  // Ушедший остаётся в снимке: вырезать его должен получатель, который знает,
  // кто он сам, — из скрытой вкладки пакеты не уходят.
  const state = hub(
    member('here', 0),
    member('away', ONLINE_MS + 1000),
    member('left', PRESENT_MS + 1000),
    member('forgotten', ROOM_MEMORY_MS + 1000),
  );
  const ids = publicMembers(state, NOW).map((m) => m.id);
  assert.deepEqual(ids, ['here', 'away', 'left'], 'сотня мест не уходит на забытых');
});

test('вернувшийся получает обратно своё имя и счёт: запись о нём не стирается', () => {
  const state = hub(member('back', PRESENT_MS + 1000));
  const gone = state.members.get('back');
  gone.kills = 7;
  // Пока молчит — он в снимке есть, но по состоянию это уже «ушёл».
  assert.equal(presenceOf(publicMembers(state, NOW)[0].lastSeen, NOW), 'left');
  gone.seen = NOW;
  const [seen] = publicMembers(state, NOW);
  assert.equal(presenceOf(seen.lastSeen, NOW), 'online');
  assert.equal(seen.kills, 7);
});

test('уборка забывает молчащих заметно позже, чем они перестают быть в комнате', () => {
  assert.ok(ROOM_MEMORY_MS >= PRESENT_MS * 5, `${ROOM_MEMORY_MS} vs ${PRESENT_MS}`);
});
