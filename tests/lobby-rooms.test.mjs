import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterRooms, mergeRooms, roomStatusLabel, summaryMode } from '../lib/lobby-rooms.ts';

const base = { title: 'Спринт', theme: 'nauryz', archived: false, phase: 0, created: 1 };

test('lobby: режим из сводки — только известный', () => {
  assert.equal(summaryMode('battle'), 'battle');
  assert.equal(summaryMode('nope'), null);
  assert.equal(summaryMode(undefined), null);
});

test('lobby: этап ретро не выдаётся за статус боя', () => {
  const room = { mine: true, archived: false, phase: 1, status: null };
  assert.equal(roomStatusLabel({ ...room, mode: 'retro' }), 'Пишем идеи');
  assert.equal(roomStatusLabel({ ...room, mode: 'battle' }), 'Активна');
  assert.equal(roomStatusLabel({ ...room, mode: 'battle', mine: false, status: 'in_progress' }), 'Идёт бой');
  assert.equal(roomStatusLabel({ ...room, mode: null, mine: false, status: 'in_progress' }), 'Уже идёт');
  assert.equal(roomStatusLabel({ ...room, mode: 'retro', archived: true }), 'Завершена');
});

test('lobby: своя комната из публичного списка сохраняет счётчики и режим', () => {
  const merged = mergeRooms(
    [{ ...base, id: 'a', notes: 3 }],
    [{ ...base, id: 'a', hostName: 'Ведущий', membersCount: 2, maxPlayers: 8, status: 'available', mode: 'impostor' }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].mine, true);
  assert.equal(merged[0].mode, 'impostor');
  assert.equal(merged[0].membersCount, 2);
});

test('lobby: фильтр и поиск', () => {
  const rooms = mergeRooms(
    [{ ...base, id: 'a', notes: 0 }, { ...base, id: 'b', title: 'Архив', archived: true, created: 2, notes: 0 }],
    [],
  );
  assert.deepEqual(filterRooms(rooms, '', 'archive').map((r) => r.id), ['b']);
  assert.deepEqual(filterRooms(rooms, 'спр', 'all').map((r) => r.id), ['a']);
  assert.deepEqual(filterRooms(rooms, 'нет такой', 'all'), []);
});
