import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCheckpoint, restoreCheckpoint } from '../lib/room-checkpoint.ts';
import { memberFromRow, newMatch, roomFromState } from '../lib/room-hub-core.ts';
import { memberWeapon, weaponReply } from '../lib/weapon-authority.ts';
function state() {
  const room = roomFromState('a', { map: 'mansion' });
  return { room, members: new Map([['a', memberFromRow({ session: 'a', name: 'current', life: 2, hp: 70 })]]),
    match: newMatch(room, 1000), effects: [], seq: 0 };
}
test('JSON restart preserves match, lives, magazine, revision and reload deadline', () => {
  const source = state(), m = source.members.get('a');
  source.match = { mode: 'rounds', score: { red: 3, blue: 2 }, round: 6, phase: 'intermission', until: 9000 };
  m.kills = 4; m.hp = 0; m.respawnAt = 8000;
  memberWeapon(m).magazine.fire('paint', 2000);
  memberWeapon(m).magazine.reload('paint', 2500);
  const before = weaponReply(m, 'before', 2600, true);
  const target = state();
  assert.equal(restoreCheckpoint('room', target, encodeCheckpoint('room', source)), true);
  assert.deepEqual(target.match, source.match);
  const restored = target.members.get('a');
  assert.equal(restored.kills, 4); assert.equal(restored.hp, 0); assert.equal(restored.life, 2);
  assert.equal(restored.respawnAt, 8000);
  const after = weaponReply(restored, 'after', 2700, true);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.magazine, before.magazine);
  assert.equal(weaponReply(restored, 'elapsed', 10000, true).magazine.rounds.paint, 24);
});
test('spent ammo stays spent and applied effects are not reset', () => {
  const source = state(); memberWeapon(source.members.get('a')).magazine.fire('paint', 2000);
  source.effects = [{ id: 'hit', applied: true, seq: 4, resolveAt: 2000 }]; source.seq = 4;
  const target = state(); restoreCheckpoint('room', target, encodeCheckpoint('room', source));
  assert.equal(weaponReply(target.members.get('a'), 'sync', 10000, true).magazine.rounds.paint, 23);
  assert.deepEqual(target.effects, source.effects); assert.equal(target.seq, 4);
});
test('D1 membership and current profile win over old checkpoints', () => {
  const source = state(); source.members.get('a').name = 'old';
  source.members.set('removed', memberFromRow({ session: 'removed' }));
  const target = state(); restoreCheckpoint('room', target, encodeCheckpoint('room', source));
  assert.equal(target.members.get('a').name, 'current'); assert.equal(target.members.has('removed'), false);
});
test('map changes reject stale state; unknown formats and identities fail explicitly', () => {
  const source = state(), saved = encodeCheckpoint('room', source), target = state();
  target.room.map = 'hub'; assert.equal(restoreCheckpoint('room', target, saved), false);
  assert.throws(() => restoreCheckpoint('other', state(), saved), /identity/);
  assert.throws(() => restoreCheckpoint('room', state(), saved.replace('"version":1', '"version":2')), /version/);
});
