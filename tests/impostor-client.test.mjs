import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amGhost,
  atButton,
  bodyHere,
  impostorFrozen,
  inGame,
  killTarget,
  taskHere,
  voiceAllowed,
  zoneAt,
} from '../lib/impostor-client.ts';
import { getMap } from '../lib/maps/index.ts';

const player = (id, alive = true) => ({ id, alive, left: false, name: id, color: '#fff' });
const view = (over = {}) => ({
  phase: 'play',
  until: 0,
  game: 1,
  role: 'crew',
  alive: true,
  allies: [],
  tasks: [
    { station: 'a', done: false, kind: 'wires', title: 'A', room: 'R', x: 0, z: 0 },
    { station: 'b', done: true, kind: 'hold', title: 'B', room: 'R', x: 5, z: 0 },
  ],
  progress: { done: 1, total: 2 },
  meetingsLeft: 1,
  killReadyAt: 0,
  buttonReadyAt: 0,
  working: null,
  players: [player('me'), player('p1'), player('p2'), player('dead', false)],
  impostors: 1,
  bodies: [{ victim: 'dead', x: 10, y: 0, z: 0, at: 1, color: '#f00' }],
  meeting: null,
  voted: [],
  votes: null,
  ejected: null,
  winner: null,
  winReason: null,
  roles: null,
  ...over,
});

test('phases: in game, frozen and ghost', () => {
  assert.equal(inGame(undefined), false);
  assert.equal(inGame(view({ phase: 'lobby' })), false);
  assert.equal(inGame(view()), true);
  assert.equal(impostorFrozen(view({ phase: 'voting' })), true);
  assert.equal(impostorFrozen(view()), false);
  assert.equal(amGhost(view()), false);
  assert.equal(amGhost(view({ alive: false })), true);
  assert.equal(amGhost(view({ role: null, alive: false })), true, 'a spectator is a ghost');
  assert.equal(amGhost(view({ phase: 'ended', alive: false })), false);
});

test('actions offered nearby: own undone task, a body, the button, a kill target', () => {
  assert.equal(taskHere(view(), { x: 0.5, z: 0 }).station, 'a');
  assert.equal(taskHere(view(), { x: 5, z: 0 }), null, 'done task');
  assert.equal(taskHere(view({ role: 'impostor' }), { x: 0, z: 0 }), null, 'impostors fake tasks');
  assert.equal(taskHere(view({ phase: 'meeting' }), { x: 0, z: 0 }), null);
  assert.equal(bodyHere(view(), { x: 8, z: 0 }).victim, 'dead');
  assert.equal(bodyHere(view({ alive: false }), { x: 8, z: 0 }), null, 'ghosts do not report');
  const map = getMap('ship');
  assert.equal(atButton(view(), map, { x: map.meeting.x, z: map.meeting.z + 2.5 }), true);
  assert.equal(atButton(view(), map, { x: map.meeting.x, z: map.meeting.z + 5 }), false);
  const members = [
    { id: 'me', pose: { x: 0, z: 0 } },
    { id: 'p1', pose: { x: 1, z: 0 } },
    { id: 'p2', pose: { x: 1.5, z: 0 } },
  ];
  const imp = view({ role: 'impostor', allies: ['p1'] });
  assert.equal(killTarget(imp, 'me', { x: 0, z: 0 }, members), 'p2', 'allies are skipped');
  assert.equal(killTarget(view(), 'me', { x: 0, z: 0 }, members), null, 'crew has no knife');
  assert.equal(zoneAt(map, { x: map.meeting.x, z: map.meeting.z }), 'Кафетерий');
});

test('voice: silence while playing, meetings for the living, ghosts only among ghosts', () => {
  assert.equal(voiceAllowed(undefined, 'p1'), true);
  assert.equal(voiceAllowed(view({ phase: 'lobby' }), 'p1'), true);
  assert.equal(voiceAllowed(view(), 'p1'), false);
  assert.equal(voiceAllowed(view({ phase: 'meeting' }), 'p1'), true);
  const ghost = view({ alive: false, phase: 'meeting' });
  assert.equal(voiceAllowed(ghost, 'p1'), false, 'a ghost cannot reach the living');
  assert.equal(voiceAllowed(ghost, 'dead'), true);
  assert.equal(voiceAllowed(ghost, 'spectator'), true, 'spectators are ghosts too');
});
