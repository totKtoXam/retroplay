import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.transpileModule(
  readFileSync(new URL('../lib/model.ts', import.meta.url), 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

const { initialState, applyOperation, publicState } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
);

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('PASS', name);
}

const run = (s, op, user = 'host', host = 'host') =>
  applyOperation(s, op, user, host);

test('Default room access is Public with free join policy', () => {
  const room = initialState('Alpha');
  assert.ok(room.access);
  assert.equal(room.access.type, 'public');
  assert.equal(room.access.visibility, 'public');
  assert.equal(room.access.joinPolicy, 'free');
  assert.equal(room.access.maxPlayers, 8);
  assert.ok(room.access.inviteToken.length > 10);
});

test('Private room creation initializes hidden visibility and host_approval policy', () => {
  const room = initialState('Secret', 'nauryz', 'four', 'private', 12);
  assert.ok(room.access);
  assert.equal(room.access.type, 'private');
  assert.equal(room.access.visibility, 'hidden');
  assert.equal(room.access.joinPolicy, 'host_approval');
  assert.equal(room.access.maxPlayers, 12);
  assert.ok(room.access.inviteToken.length > 10);
});

test('Host can switch access between Public and Private; non-host is rejected', () => {
  let s = initialState('Room1');
  assert.equal(s.access.type, 'public');

  // Non-host attempts to change access
  assert.throws(
    () => run(s, { type: 'access.set', accessType: 'private' }, 'guest'),
    /ведущему/,
  );

  // Host changes to private
  s = run(s, { type: 'access.set', accessType: 'private' }, 'host');
  assert.equal(s.access.type, 'private');
  assert.equal(s.access.visibility, 'hidden');
  assert.equal(s.access.joinPolicy, 'host_approval');

  // Host changes back to public
  s = run(s, { type: 'access.set', accessType: 'public' }, 'host');
  assert.equal(s.access.type, 'public');
  assert.equal(s.access.visibility, 'public');
  assert.equal(s.access.joinPolicy, 'free');
});

test('Host can regenerate invite link token; old token is replaced', () => {
  let s = initialState('Room1', 'nauryz', 'four', 'private');
  const oldToken = s.access.inviteToken;

  assert.throws(
    () => run(s, { type: 'access.regenerate_invite' }, 'guest'),
    /ведущему/,
  );

  s = run(s, { type: 'access.regenerate_invite' }, 'host');
  assert.notEqual(s.access.inviteToken, oldToken);
  assert.ok(s.access.inviteToken.length > 10);
});

test('Host can adjust maxPlayers within 2..50 range', () => {
  let s = initialState('Room1');
  s = run(s, { type: 'access.max_players', maxPlayers: 16 }, 'host');
  assert.equal(s.access.maxPlayers, 16);

  s = run(s, { type: 'access.max_players', maxPlayers: 50 }, 'host');
  assert.equal(s.access.maxPlayers, 50);

  s = run(s, { type: 'access.max_players', maxPlayers: 2 }, 'host');
  assert.equal(s.access.maxPlayers, 2);

  assert.throws(
    () => run(s, { type: 'access.max_players', maxPlayers: 100 }, 'host'),
    /Некорректное числовое значение/,
  );
  assert.throws(
    () => run(s, { type: 'access.max_players', maxPlayers: 1 }, 'host'),
    /Некорректное числовое значение/,
  );
});

test('PublicState masks inviteToken for guests and preserves for host', () => {
  const s = initialState('Secret', 'nauryz', 'four', 'private');
  const token = s.access.inviteToken;

  const hostView = publicState(s, 'host', 'host');
  assert.equal(hostView.access.inviteToken, token);

  const guestView = publicState(s, 'guest', 'host');
  assert.equal(guestView.access.inviteToken, '');
  assert.equal(guestView.access.type, 'private');
});

console.log(`\nAll ${passed} access model tests passed!`);
