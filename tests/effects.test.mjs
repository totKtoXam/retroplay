import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterNewEffects } from '../lib/model.ts';

test('filterNewEffects deduplicates repeated effect ids', () => {
  const seen = new Map();
  const effects = [
    { id: 'a', kind: 'paint', at: 1, author: 'u1' },
    { id: 'b', kind: 'paint', at: 2, author: 'u2' },
    { id: 'a', kind: 'paint', at: 3, author: 'u1' },
    { id: 'c', kind: 'confetti', at: 4, author: 'u3' },
  ];

  const firstPass = filterNewEffects(effects, seen, 15000);
  assert.deepEqual(
    firstPass.map((effect) => effect.id),
    ['a', 'b', 'c'],
  );

  const secondPass = filterNewEffects(effects, seen, 15000);
  assert.deepEqual(secondPass, []);
});
