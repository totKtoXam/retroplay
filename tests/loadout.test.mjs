import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cycleSlot,
  defaultSlot,
  hasSlot,
  slotForDigit,
  slotsFor,
} from '../lib/loadout.ts';
import { GAME_TOOLS } from '../lib/model.ts';

test('inventory holds only the items of its mode', () => {
  const ids = (mode) => slotsFor(mode).map((s) => GAME_TOOLS[s.index].id);
  assert.deepEqual(ids('retro'), ['pointer', 'sticky', 'paint', 'confetti', 'like']);
  assert.deepEqual(ids('battle'), ['paint', 'confetti', 'grenade', 'sniper']);
  // Keys are 1..N in both modes, with no duplicates and no gaps.
  for (const mode of ['retro', 'battle'])
    assert.deepEqual(
      slotsFor(mode).map((s) => s.key),
      slotsFor(mode).map((_, i) => String(i + 1)),
    );
  // Weapons of a battle never appear in a retrospective and vice versa.
  assert.equal(hasSlot('retro', 10), false, 'no grenade in a retrospective');
  assert.equal(hasSlot('retro', 11), false, 'no sniper in a retrospective');
  assert.equal(hasSlot('battle', 9), false, 'no tablet in a battle');
  assert.equal(GAME_TOOLS[defaultSlot('retro')].id, 'pointer');
  assert.equal(GAME_TOOLS[defaultSlot('battle')].id, 'paint');
});

test('the wheel cycles within the mode and wraps around', () => {
  const retro = slotsFor('retro').map((s) => s.index);
  for (let i = 0; i < retro.length; i++)
    assert.equal(cycleSlot('retro', retro[i], 1), retro[(i + 1) % retro.length]);
  for (let i = 0; i < retro.length; i++)
    assert.equal(
      cycleSlot('retro', retro[i], -1),
      retro[(i + retro.length - 1) % retro.length],
    );
  assert.equal(cycleSlot('battle', 0, 1), 1);
  assert.equal(cycleSlot('battle', 11, 1), 0, 'the last weapon wraps to the first');
  // An item from the other mode falls back to the first slot of this one.
  assert.equal(cycleSlot('battle', 9, 1), 1);
});

test('number keys equip this mode only; other keys change nothing', () => {
  assert.equal(slotForDigit('battle', 'Digit1'), 0);
  assert.equal(slotForDigit('battle', 'Digit3'), 10);
  assert.equal(slotForDigit('battle', 'Digit4'), 11);
  assert.equal(slotForDigit('battle', 'Digit5'), undefined, 'battle has four items');
  assert.equal(slotForDigit('retro', 'Digit1'), 9, 'the tablet comes first');
  assert.equal(slotForDigit('retro', 'Digit5'), 12);
  for (const code of ['Digit0', 'Digit8', 'Digit9', 'KeyE'])
    assert.equal(slotForDigit('retro', code), undefined);
});
