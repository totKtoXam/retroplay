import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, initialState } from '../lib/model.ts';
import {
  applyUndo,
  assembleState,
  diffForUndo,
  planWrite,
  stripNotes,
} from '../lib/room-store.ts';

const HOST = 'host';
// In-memory stand-in for rooms.state + notes rows, written only through planWrite.
const fresh = () => ({ json: stripNotes(initialState('Retro')), rows: [] });
const load = (db) => assembleState(db.json, db.rows);
function save(db, next) {
  const write = planWrite(db.json, db.rows, next);
  const rows = new Map(db.rows.map((r) => [r.id, r]));
  for (const id of write.remove) rows.delete(id);
  for (const r of write.upsert) rows.set(r.id, r);
  return { json: write.state ?? db.json, rows: [...rows.values()], write };
}
const run = (db, op, user = HOST) => save(db, applyOperation(load(db), op, user, HOST));
const add = (db, text) => run(db, { type: 'note.add', text, zone: 'good' });

test('each card is its own row: an edit writes one row, a delete rewrites no other card', () => {
  let db = fresh();
  for (const text of ['a', 'b', 'c']) {
    db = add(db, text);
    assert.equal(db.write.upsert.length, 1);
  }
  const [a, b] = load(db).notes;
  db = run(db, { type: 'note.edit', id: b.id, patch: { text: 'b2' } });
  assert.deepEqual([db.write.upsert.map((r) => r.id), db.write.remove, db.write.state], [[b.id], [], null]);
  db = run(db, { type: 'note.delete', id: a.id });
  assert.deepEqual([db.write.upsert.length, db.write.remove], [0, [a.id]]);
  assert.deepEqual(load(db).notes.map((n) => n.text), ['b2', 'c']);
  assert.ok(!('notes' in JSON.parse(db.json)), 'rooms.state carries no cards');
});

test('a room saved with inline notes is moved to rows on its first write', () => {
  let db = fresh();
  db = add(add(db, 'x'), 'y');
  const legacy = { json: JSON.stringify(load(db)), rows: [] };
  assert.deepEqual(load(legacy).notes.map((n) => n.text), ['x', 'y']);
  const moved = run(legacy, { type: 'phase', phase: 2 });
  assert.equal(moved.write.upsert.length, 2);
  assert.ok(!('notes' in JSON.parse(moved.json)));
  assert.deepEqual(load(moved).notes.map((n) => n.text), ['x', 'y']);
  assert.equal(load(moved).phase, 2);
});

test('undo restores the previous room for every kind of change', () => {
  let db = fresh();
  const ops = [
    () => ({ type: 'note.add', text: 'first', zone: 'good' }),
    () => ({ type: 'note.add', text: 'second', zone: 'bad' }),
    () => ({ type: 'note.add', text: 'third', zone: 'stop' }),
    (s) => ({ type: 'note.edit', id: s.notes[1].id, patch: { text: 'edited', x: 40 } }),
    (s) => ({ type: 'note.react', id: s.notes[0].id, emoji: '🔥' }),
    (s) => ({ type: 'note.delete', id: s.notes[1].id }),
    () => ({ type: 'room.settings', patch: { title: 'Renamed', respawnSeconds: 3 } }),
    () => ({ type: 'phase', phase: 3 }),
    () => ({ type: 'group.add', title: 'Theme' }),
    (s) => ({ type: 'group.delete', id: s.groups[0].id }),
  ];
  for (const make of ops) {
    const before = load(db);
    const next = applyOperation(before, make(before), HOST, HOST);
    const patch = JSON.parse(JSON.stringify(diffForUndo(before, next)));
    assert.deepEqual(applyUndo(next, patch), before, make(before).type);
    db = save(db, next);
  }
});

test('undoing a delete puts the card back in its place without rewriting the others', () => {
  let db = fresh();
  for (const text of ['a', 'b', 'c']) db = add(db, text);
  const before = load(db);
  const next = applyOperation(before, { type: 'note.delete', id: before.notes[1].id }, HOST, HOST);
  const patch = diffForUndo(before, next);
  db = save(db, next);
  db = save(db, applyUndo(load(db), patch));
  assert.deepEqual(load(db).notes.map((n) => n.text), ['a', 'b', 'c']);
  assert.deepEqual(db.write.upsert.map((r) => r.id), [before.notes[1].id]);
});

test('a card edit is recorded as a small patch, not a copy of the room', () => {
  let db = fresh();
  for (let i = 0; i < 30; i++) db = add(db, 'card ' + i);
  const before = load(db);
  const next = applyOperation(before, { type: 'note.edit', id: before.notes[5].id, patch: { text: 'x' } }, HOST, HOST);
  const patch = diffForUndo(before, next);
  assert.deepEqual(Object.keys(patch.notes), [before.notes[5].id]);
  assert.equal(patch.order, undefined);
  assert.deepEqual(patch.state, {});
  assert.ok(JSON.stringify(patch).length * 10 < JSON.stringify(before).length);
});

test('history rows written before patches (full rooms) still undo', () => {
  const db = add(fresh(), 'old');
  const full = load(db);
  const current = applyOperation(full, { type: 'phase', phase: 4 }, HOST, HOST);
  assert.deepEqual(applyUndo(current, JSON.parse(JSON.stringify(full))), full);
});
