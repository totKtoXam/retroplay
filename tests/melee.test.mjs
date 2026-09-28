import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromBehind,
  knockDistance,
  knockPath,
  KNOCK_GRAVITY,
  KNOCK_LIFT,
  MELEE,
  MELEE_STATS,
  meleeDamage,
  meleeStyle,
} from '../lib/melee.ts';
import { effectStyle } from '../lib/game-items.ts';
import { cooledDown, flightMs } from '../lib/weapon-definition.ts';

test('every melee weapon in the wheel has its stats', () => {
  for (const { id } of MELEE) assert.ok(MELEE_STATS[id], id);
  assert.equal(meleeStyle('knife'), 'knife');
  assert.equal(meleeStyle('chainsaw'), 'hammer', 'unknown weapons fall back to the hammer');
  assert.equal(effectStyle('melee', 'baguette'), 'baguette');
});

test('behind means in the back half of where the victim looks', () => {
  // yaw = 0 — взгляд на −z.
  const victim = { x: 0, z: 0, yaw: 0 };
  assert.equal(fromBehind([0, 1.9, 1.2], victim), true, 'from +z is behind');
  assert.equal(fromBehind([0, 1.9, -1.2], victim), false, 'from −z is face to face');
  assert.equal(fromBehind([1.2, 1.9, 0], victim), false, 'from the side is not a backstab');
});

test('only the knife kills with one blow, and only in the back', () => {
  for (const { id } of MELEE) {
    assert.ok(meleeDamage(id, 'head', false) < 100, `${id}: no one-hit head kill`);
    assert.ok(meleeDamage(id, 'limb', false) < meleeDamage(id, 'torso', false));
    assert.ok(meleeDamage(id, 'torso', true) > meleeDamage(id, 'torso', false), `${id}: the back hurts more`);
  }
  assert.equal(meleeDamage('knife', 'torso', true), 100);
});

test('the swing lands after the windup and each weapon keeps its own pace', () => {
  assert.equal(flightMs('melee', 2, 'knife'), MELEE_STATS.knife.windup);
  const m = { lastShot: 0 };
  assert.equal(cooledDown(m, 'melee', MELEE_STATS.knife.cooldown, 'knife'), true);
  assert.equal(cooledDown(m, 'melee', MELEE_STATS.knife.cooldown, 'hammer'), false, 'the hammer is slower');
});

test('observers draw the knockback along the same curve the victim flies', () => {
  const speed = MELEE_STATS.hammer.knockback;
  assert.equal(knockPath(0).reach, 0);
  // Почти весь путь пройден к концу предсказания (0,7 с) — дальше аватар ведут позы.
  assert.ok(knockPath(0.7).reach * speed > 0.95 * knockDistance(speed));
  assert.ok(knockPath(10).reach * speed <= knockDistance(speed) + 1e-9);
  // Подскок: вверх и обратно на землю.
  assert.ok(knockPath(0.1).height > 0);
  assert.equal(knockPath((2 * KNOCK_LIFT) / KNOCK_GRAVITY + 0.01).height, 0);
});
