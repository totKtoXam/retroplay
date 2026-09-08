import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleSlot, slotForDigit } from '../lib/loadout.ts';
test('Quick slots cycle through four objects, never board tools', () => {
  assert.equal(cycleSlot(0, 1), 1);
  assert.equal(cycleSlot(1, 1), 9);
  assert.equal(cycleSlot(9, 1), 10);
  assert.equal(cycleSlot(0, -1), 10);
  assert.equal(cycleSlot(9, -1), 1);
});
test('Number keys equip four slots; unsupported keys cannot change a tool', () => {
  assert.equal(slotForDigit('Digit1'), 0);
  assert.equal(slotForDigit('Digit2'), 1);
  assert.equal(slotForDigit('Digit3'), 9);
  assert.equal(slotForDigit('Digit4'), 10);
  for (const code of ['Digit0', 'Digit9', 'KeyE'])
    assert.equal(slotForDigit(code), undefined);
});
