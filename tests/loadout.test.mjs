import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleSlot, slotForDigit } from '../lib/loadout.ts';
test('Wheel cycles only equipped objects in both directions, never board tools', () => {
  assert.equal(cycleSlot(0, 1), 1);
  assert.equal(cycleSlot(1, 1), 9);
  assert.equal(cycleSlot(9, 1), 0);
  assert.equal(cycleSlot(0, -1), 9);
  assert.equal(cycleSlot(9, -1), 1);
});
test('Number keys equip three slots; unsupported keys cannot change a tool', () => {
  assert.equal(slotForDigit('Digit1'), 0);
  assert.equal(slotForDigit('Digit2'), 1);
  assert.equal(slotForDigit('Digit3'), 9);
  for (const code of ['Digit0', 'Digit4', 'Digit9', 'KeyE'])
    assert.equal(slotForDigit(code), undefined);
});
