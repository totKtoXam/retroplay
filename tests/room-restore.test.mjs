import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, initialState, publicState } from '../lib/model.ts';
import { diffForUndo, restoreDeleted } from '../lib/room-store.ts';

const HOST = 'host';
const op = (s, o, user = HOST) => applyOperation(s, o, user, HOST);

test('reveal all: ведущий открывает только идеи, скрытые приватным написанием', () => {
  let s = initialState('Retro');
  s = op(s, { type: 'note.add', text: 'личная', zone: 'good', hidden: true }, 'ann');
  s = op(s, { type: 'room.settings', patch: { privateWriting: true } });
  s = op(s, { type: 'note.add', text: 'в раунде', zone: 'good' }, 'bob');
  const [personal, sealed] = s.notes;
  assert.equal(personal.hidden, true);
  assert.equal(!!personal.sealed, false);
  assert.equal(sealed.hidden && sealed.sealed, true);
  // Ведущий видит, сколько идей может открыть, но не их текст.
  const seen = publicState(s, HOST, HOST).notes.find((n) => n.id === sealed.id);
  assert.equal(seen.sealed, true);
  assert.equal(seen.text, '');
  assert.throws(() => op(s, { type: 'reveal', all: true }, 'bob'), /ведущему/);
  s = op(s, { type: 'reveal', all: true });
  assert.equal(s.notes.find((n) => n.id === sealed.id).hidden, false);
  assert.equal(s.notes.find((n) => n.id === personal.id).hidden, true);
});

test('reveal all: автор, сам скрывший заметку, выводит её из-под раскрытия ведущим', () => {
  let s = op(initialState('Retro'), { type: 'room.settings', patch: { privateWriting: true } });
  s = op(s, { type: 'note.add', text: 'x', zone: 'bad' }, 'ann');
  const id = s.notes[0].id;
  s = op(s, { type: 'note.edit', id, patch: { hidden: true } }, 'ann');
  s = op(s, { type: 'reveal', all: true });
  assert.equal(s.notes[0].hidden, true);
});

test('restore: удалённая карточка возвращается после чужих правок, чужие правки целы', () => {
  let s = initialState('Retro');
  s = op(s, { type: 'note.add', text: 'моя', zone: 'good' }, 'ann');
  s = op(s, { type: 'note.add', text: 'чужая', zone: 'bad' }, 'bob');
  const [mine, other] = s.notes;
  const before = s;
  s = op(s, { type: 'note.delete', id: mine.id }, 'ann');
  const patch = JSON.parse(JSON.stringify(diffForUndo(before, s)));
  s = op(s, { type: 'note.edit', id: other.id, patch: { text: 'правка' } }, 'bob');
  s = restoreDeleted(s, patch, 'note.delete');
  assert.equal(s.notes.find((n) => n.id === mine.id)?.text, 'моя');
  assert.equal(s.notes.find((n) => n.id === other.id)?.text, 'правка');
  assert.throws(() => restoreDeleted(s, patch, 'note.delete'), /Уже возвращено/);
});

test('restore: тема возвращается вместе с карточками, если их не переложили', () => {
  let s = initialState('Retro');
  s = op(s, { type: 'group.add', title: 'Процессы' });
  const g = s.groups.at(-1).id;
  s = op(s, { type: 'note.add', text: 'a', zone: 'good', group: g }, 'ann');
  s = op(s, { type: 'note.add', text: 'b', zone: 'good', group: g }, 'ann');
  const [a, b] = s.notes;
  const before = s;
  s = op(s, { type: 'group.delete', id: g });
  const patch = JSON.parse(JSON.stringify(diffForUndo(before, s)));
  s = op(s, { type: 'group.add', title: 'Другая' });
  const other = s.groups.at(-1).id;
  s = op(s, { type: 'note.edit', id: b.id, patch: { group: other } }, 'ann');
  s = restoreDeleted(s, patch, 'group.delete');
  assert.ok(s.groups.some((x) => x.id === g));
  assert.equal(s.notes.find((n) => n.id === a.id).group, g);
  assert.equal(s.notes.find((n) => n.id === b.id).group, other);
});

test('restore: другие действия и завершённую встречу вернуть нельзя', () => {
  const s = initialState('Retro');
  assert.throws(() => restoreDeleted(s, { v: 2, notes: {}, state: {} }, 'phase'), /нельзя вернуть/);
  assert.throws(
    () => restoreDeleted({ ...s, archived: true }, { v: 2, notes: {}, state: {} }, 'note.delete'),
    /завершена/,
  );
});
