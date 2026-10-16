import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMoveFilter, MOVE_LIMIT } from '../lib/mouse-filter.ts';

test('мышь: одиночный всплеск на спокойной мыши отбрасывается', () => {
  const f = createMoveFilter();
  for (let i = 0; i < 5; i++) f.filter(3, 1);
  assert.equal(f.filter(900, 0), null);
  assert.deepEqual(f.filter(4, 0), [4, 0]);
});

test('мышь: нарастающий быстрый рывок проходит, только ограничен сверху', () => {
  const f = createMoveFilter();
  const out = [60, 140, 240, 340, 420, 380].map((dx) => f.filter(dx, 0));
  assert.ok(out.every(Boolean));
  assert.equal(out[4][0], MOVE_LIMIT);
});

test('мышь: после сброса история не держит порог', () => {
  const f = createMoveFilter();
  for (let i = 0; i < 6; i++) f.filter(250, 0);
  f.reset();
  assert.equal(f.filter(800, 0), null);
});
