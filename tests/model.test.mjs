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
const run = (s, op, user = 'host') => applyOperation(s, op, user, 'host');
test('Rooms have independent state', () => {
  const a = run(initialState('A'), { type: 'note.add', text: 'Idea' });
  const b = initialState('B');
  assert.equal(a.notes.length, 1);
  assert.equal(b.notes.length, 0);
});
test('Private notes never enter other participant payloads', () => {
  let s = run(initialState('A'), {
    type: 'room.settings',
    patch: { privateWriting: true },
  });
  s = run(s, { type: 'note.add', text: 'secret' }, 'guest');
  assert.equal(publicState(s, 'host').notes.length, 0);
  assert.equal(publicState(s, 'guest').notes[0].text, 'secret');
  assert.throws(
    () =>
      run(s, { type: 'note.edit', id: s.notes[0].id, patch: { text: 'read' } }),
    /приватная/,
  );
  s = run(s, { type: 'reveal' }, 'guest');
  assert.equal(publicState(s, 'host').notes[0].text, 'secret');
});
test('Host authority enforced', () => {
  assert.throws(
    () =>
      run(
        initialState('A'),
        { type: 'room.settings', patch: { title: 'Bad' } },
        'guest',
      ),
    /ведущему/,
  );
  assert.throws(
    () => run(initialState('A'), { type: 'vote.start', limit: 5 }, 'guest'),
    /ведущему/,
  );
});
test('Vote budget and removal; active round hides other votes', () => {
  let s = run(initialState('A'), { type: 'note.add', text: 'Vote' });
  const id = s.notes[0].id;
  s = run(s, { type: 'vote.start', limit: 2 });
  s = run(s, { type: 'vote', id }, 'guest');
  s = run(s, { type: 'vote', id }, 'guest');
  assert.throws(() => run(s, { type: 'vote', id }, 'guest'), /Все голоса/);
  assert.deepEqual(publicState(s, 'host').rounds[0].votes, { host: {} });
  s = run(s, { type: 'vote', id, remove: true }, 'guest');
  s = run(s, { type: 'vote.end' });
  assert.equal(publicState(s, 'host').rounds[0].votes.guest[id], 1);
});
test('Guests cannot modify other participant notes', () => {
  const s = run(initialState('A'), { type: 'note.add', text: 'Original' });
  assert.throws(
    () =>
      run(
        s,
        { type: 'note.edit', id: s.notes[0].id, patch: { text: 'Changed' } },
        'guest',
      ),
    /автор/,
  );
});
test('Anonymous author hidden; own author retained', () => {
  let s = run(initialState('A'), {
    type: 'room.settings',
    patch: { anonymous: true },
  });
  s = run(s, { type: 'note.add', text: 'Anonymous' }, 'guest');
  assert.equal(publicState(s, 'host').notes[0].author, 'anonymous');
  assert.equal(publicState(s, 'guest').notes[0].author, 'guest');
});
test('Invalid coordinate, colour, protocol and phase are rejected', () => {
  for (const op of [
    { type: 'note.add', x: NaN },
    { type: 'note.add', url: 'javascript:alert(1)' },
    { type: 'phase', phase: 1.5 },
    { type: 'vote.start', limit: 0 },
  ])
    assert.throws(() => run(initialState('A'), op));
});
test('Reactions toggle and comments persist', () => {
  let s = run(initialState('A'), { type: 'note.add', text: 'A' });
  const id = s.notes[0].id;
  s = run(s, { type: 'note.react', id, emoji: '👍' }, 'guest');
  assert.equal(s.notes[0].reactions['👍'].length, 1);
  s = run(s, { type: 'note.react', id, emoji: '👍' }, 'guest');
  assert.equal(s.notes[0].reactions['👍'].length, 0);
  s = run(s, { type: 'note.comment', id, text: 'Hello' }, 'guest');
  assert.equal(s.notes[0].comments[0].text, 'Hello');
});
test('Archived room cannot be edited', () => {
  const s = run(initialState('A'), { type: 'archive', value: true });
  assert.throws(() => run(s, { type: 'note.add', text: 'Oops' }), /завершена/);
  assert.equal(run(s, { type: 'archive', value: false }).archived, false);
});
test('Import validates each row and does not mutate source on failure', () => {
  const s = initialState('A');
  assert.throws(() =>
    run(s, {
      type: 'import',
      notes: [{ text: 'Good' }, { url: 'javascript:bad' }],
    }),
  );
  assert.equal(s.notes.length, 0);
});
console.log(`${passed} behavioral tests passed`);
