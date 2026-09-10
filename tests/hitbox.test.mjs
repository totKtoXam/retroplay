import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inHitRange, isHeadshot } from '../lib/game-items.ts';

test('Headshot is strictly registered on head, not on chest or torso', () => {
  const pose = { x: 0, y: 0, z: 0, yaw: 0, stance: 'stand' };

  // Firing from z = 5 towards z = -5 through player at (0, 0, 0)
  const fireAt = (y, x = 0) => ({
    origin: [x, y, 5],
    target: [x, y, -5],
  });

  // 1. Direct head center (y = 2.07) -> Headshot
  const headShot = fireAt(2.07);
  assert.ok(inHitRange('paint', headShot.origin, headShot.target, pose));
  assert.equal(isHeadshot('paint', headShot.origin, headShot.target, pose), true);

  // 2. Forehead (y = 2.20) -> Headshot
  const forehead = fireAt(2.20);
  assert.ok(inHitRange('paint', forehead.origin, forehead.target, pose));
  assert.equal(isHeadshot('paint', forehead.origin, forehead.target, pose), true);

  // 3. Lower face / chin (y = 1.90) -> Headshot
  const chin = fireAt(1.90);
  assert.ok(inHitRange('paint', chin.origin, chin.target, pose));
  assert.equal(isHeadshot('paint', chin.origin, chin.target, pose), true);

  // 4. Chest (y = 1.50) -> Hit registered, but NOT a headshot!
  const chest = fireAt(1.50);
  assert.ok(inHitRange('paint', chest.origin, chest.target, pose));
  assert.equal(isHeadshot('paint', chest.origin, chest.target, pose), false, 'chest shot must NOT be headshot');

  // 5. Upper chest / collarbone (y = 1.70) -> Hit registered, but NOT a headshot!
  const upperChest = fireAt(1.70);
  assert.ok(inHitRange('paint', upperChest.origin, upperChest.target, pose));
  assert.equal(isHeadshot('paint', upperChest.origin, upperChest.target, pose), false, 'collarbone must NOT be headshot');

  // 6. Stomach (y = 1.20) -> Hit registered, NOT a headshot
  const stomach = fireAt(1.20);
  assert.ok(inHitRange('paint', stomach.origin, stomach.target, pose));
  assert.equal(isHeadshot('paint', stomach.origin, stomach.target, pose), false);

  // 7. Legs (y = 0.50) -> Hit registered, NOT a headshot
  const legs = fireAt(0.50);
  assert.ok(inHitRange('paint', legs.origin, legs.target, pose));
  assert.equal(isHeadshot('paint', legs.origin, legs.target, pose), false);

  // 8. Grenades never register as headshots
  assert.equal(isHeadshot('grenade', headShot.origin, headShot.target, pose), false);

  // 9. Wide miss (x = 1.2, y = 2.07)
  const miss = fireAt(2.07, 1.2);
  assert.equal(inHitRange('paint', miss.origin, miss.target, pose), false);
  assert.equal(isHeadshot('paint', miss.origin, miss.target, pose), false);
});

test('Sitting stance headshot vs chest detection', () => {
  const pose = { x: 0, y: 0, z: 0, yaw: 0, stance: 'sit' };
  const fireAt = (y) => ({
    origin: [0, y, 4],
    target: [0, y, -4],
  });

  // Sitting head at y = 1.67
  const head = fireAt(1.67);
  assert.ok(inHitRange('paint', head.origin, head.target, pose));
  assert.equal(isHeadshot('paint', head.origin, head.target, pose), true);

  // Sitting chest at y = 1.10 -> NOT headshot
  const chest = fireAt(1.10);
  assert.ok(inHitRange('paint', chest.origin, chest.target, pose));
  assert.equal(isHeadshot('paint', chest.origin, chest.target, pose), false);
});
