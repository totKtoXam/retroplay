import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFreeForAll, MODE_CHOICES, modeChoice, modeChoiceOf } from '../lib/maps/catalog.ts';
import { minimapBlips } from '../lib/minimap-blips.ts';
import { matchOutcome } from '../lib/hud-feedback.ts';
import { applyOperation, initialState } from '../lib/model.ts';

const NOW = 1_700_000_000_000;
const person = (id, x, z, yaw = 0) => ({
  id,
  name: id,
  color: '#fff',
  team: '',
  lastSeen: NOW,
  hp: 100,
  pose: { x, y: 0, z, yaw, pitch: 0, stance: 'stand', moving: false },
  ping: 10,
  mood: '',
  hat: '',
});
const ME = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, stance: 'stand' };

test('«Каждый за себя» — бой без команд, отдельная карточка выбора режима', () => {
  assert.equal(isFreeForAll({ mode: 'battle', map: 'mansion', freeForAll: true }), true);
  assert.equal(isFreeForAll({ mode: 'battle', map: 'mansion' }), false);
  assert.equal(isFreeForAll({ mode: 'retro', freeForAll: true }), false, 'вне боя флаг ничего не значит');
  assert.equal(modeChoiceOf({ mode: 'battle', map: 'mansion', freeForAll: true }), 'ffa');
  assert.deepEqual(
    MODE_CHOICES.map((c) => c.id),
    ['retro', 'battle', 'ffa', 'impostor'],
  );
  assert.deepEqual([modeChoice('ffa').mode, modeChoice('ffa').freeForAll], ['battle', true]);
});

test('на плане «Каждый за себя» нет своих: чужие только засвеченные самим игроком', () => {
  // Перед игроком (вдоль −z) и за спиной.
  const members = [person('me', 0, 0), person('ahead', 0, -8), person('behind', 0, 8)];
  const out = minimapBlips({ members, self: 'me', now: NOW, me: ME, colliders: [], memory: new Map(), freeForAll: true });
  assert.equal(out.length, 1, 'того, кто за спиной, не видно');
  assert.deepEqual([out[0].x, out[0].z, out[0].enemy], [0, -8, true]);
  // В хабе (без флага) игрок без команды по-прежнему видит всех как своих.
  const hub = minimapBlips({ members, self: 'me', now: NOW, me: ME, colliders: [], memory: new Map() });
  assert.equal(hub.filter((b) => !b.enemy).length, 2);
});

test('итог матча «Каждый за себя»: победил я, победил другой, ничья', () => {
  const ended = { phase: 'ended', ffa: true };
  assert.deepEqual(
    matchOutcome({ ...ended, champion: { id: 'me', name: 'Аня', kills: 20 } }, '', 'me'),
    { title: 'ВЫ ПОБЕДИЛИ', tone: 'win' },
  );
  assert.deepEqual(
    matchOutcome({ ...ended, champion: { id: 'b', name: 'Борис', kills: 20 } }, '', 'me'),
    { title: 'ПОБЕДИЛ БОРИС', tone: 'loss' },
  );
  assert.deepEqual(matchOutcome({ ...ended, winner: 'draw' }, '', 'me'), { title: 'НИЧЬЯ', tone: 'neutral' });
});

test('ведущий включает «Каждый за себя» настройкой комнаты, карта боя остаётся', () => {
  const run = (s, patch) => applyOperation(s, { type: 'room.settings', patch }, 'host', 'host');
  const battle = run(initialState('Бой'), { mode: 'battle', map: 'valley' });
  const free = run(battle, { mode: 'battle', freeForAll: true });
  assert.deepEqual([free.mode, free.map, free.freeForAll, modeChoiceOf(free)], ['battle', 'valley', true, 'ffa']);
  assert.equal(modeChoiceOf(run(free, { freeForAll: false })), 'battle');
});
