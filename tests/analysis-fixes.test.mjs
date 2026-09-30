// Остатки анализа 2026-09-11 (docs/analys): CSV-инъекция, зона формата доски,
// раунд голосования по флагу клиента.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, initialState } from '../lib/model.ts';
import { csvCell, fromCsvCell, toCsv } from '../lib/room-export.ts';

const HOST = 'host';
const op = (s, o, user = HOST) => applyOperation(s, o, user, HOST);

test('CSV: формулы обезврежены, обычный текст как есть, импорт снимает апостроф', () => {
  for (const bad of ['=HYPERLINK("x")', '+1', '-2+3', '@SUM(A1)', '\tкод', '\rкод']) {
    assert.equal(csvCell(bad), "'" + bad);
    assert.equal(fromCsvCell(csvCell(bad)), bad);
  }
  assert.equal(csvCell('Просто текст'), 'Просто текст');
  assert.equal(fromCsvCell("'не формула"), "'не формула");
  assert.ok(toCsv([['=1+1']]).includes(`"'=1+1"`));
});

test('зона: в формате из трёх колонок сервер не принимает «Сложно»', () => {
  // Формат задаётся при создании комнаты и дальше не меняется.
  let s = { ...initialState('Retro'), template: 'three' };
  assert.throws(() => op(s, { type: 'note.add', text: 'x', zone: 'bad' }, 'ann'), /Недопустимое/);
  s = op(s, { type: 'note.add', text: 'x', zone: 'good' }, 'ann');
  const id = s.notes[0].id;
  assert.throws(() => op(s, { type: 'note.edit', id, patch: { zone: 'bad' } }, 'ann'), /Недопустимое/);
  assert.throws(() => op(s, { type: 'focus', zone: 'bad' }), /Недопустимое/);
});

test('голосование: флаг лайкомёта открывает раунд только в ретро', () => {
  let s = op(initialState('Retro'), { type: 'note.add', text: 'x', zone: 'good' }, 'ann');
  const id = s.notes[0].id;
  const retro = op(s, { type: 'vote', id, kind: 'blaster' }, 'bob');
  assert.equal(retro.rounds.length, 1);
  s = op(s, { type: 'room.settings', patch: { mode: 'battle' } });
  assert.throws(() => op(s, { type: 'vote', id, force: true }, 'bob'), /не запущено/);
});
