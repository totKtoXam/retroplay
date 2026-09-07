import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolMagazine, CAPACITY } from '../lib/tool-magazine.ts';
test('Fire cadence, empty magazine and timed reload are enforced', () => {
  const m = new ToolMagazine();
  assert.equal(m.fire('paint', 0), true);
  assert.equal(m.fire('paint', 50), false);
  for (let i = 1; i < CAPACITY.paint; i++)
    assert.equal(m.fire('paint', i * 200), true);
  assert.equal(m.rounds.paint, 0);
  assert.equal(m.fire('paint', 5000), false);
  assert.equal(m.reloading, true);
  assert.equal(m.fire('paint', 5200), false);
  assert.ok(m.progress(5700) > 0);
  m.tick(6450);
  assert.equal(m.rounds.paint, CAPACITY.paint);
});
test('Cancelled reload preserves rounds; switching weapons keeps separate magazines', () => {
  const m = new ToolMagazine();
  m.fire('paint', 0);
  m.reload('paint', 200);
  m.cancel();
  m.tick(5000);
  assert.equal(m.rounds.paint, 23);
  assert.equal(m.rounds.confetti, 6);
  assert.equal(m.reload('confetti', 5000), false);
  assert.equal(m.fire('confetti', 5100), true);
  assert.equal(m.rounds.confetti, 5);
});
