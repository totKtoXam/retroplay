import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleSlot, slotForDigit } from '../lib/loadout.ts';
test('Quick slots cycle through weapon and item objects, never board tools', () => {
  assert.equal(cycleSlot(0, 1), 1);
  assert.equal(cycleSlot(1, 1), 10);
  assert.equal(cycleSlot(10, 1), 11);
  assert.equal(cycleSlot(11, 1), 2);
  assert.equal(cycleSlot(2, 1), 9);
  assert.equal(cycleSlot(9, 1), 12);
  assert.equal(cycleSlot(12, 1), 0);
  assert.equal(cycleSlot(0, -1), 12);
  assert.equal(cycleSlot(12, -1), 9);
  assert.equal(cycleSlot(9, -1), 2);
  assert.equal(cycleSlot(2, -1), 11);
  assert.equal(cycleSlot(11, -1), 10);
});
test('Number keys equip quick slots; unsupported keys cannot change a tool', () => {
  assert.equal(slotForDigit('Digit1'), 0);
  assert.equal(slotForDigit('Digit2'), 1);
  assert.equal(slotForDigit('Digit3'), 10);
  assert.equal(slotForDigit('Digit4'), 11);
  assert.equal(slotForDigit('Digit5'), 2);
  assert.equal(slotForDigit('Digit6'), 9);
  assert.equal(slotForDigit('Digit7'), 12);
  for (const code of ['Digit0', 'Digit8', 'Digit9', 'KeyE'])
    assert.equal(slotForDigit(code), undefined);
});
