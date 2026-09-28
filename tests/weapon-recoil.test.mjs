import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aimedSpread, recoilKick, spreadScale, ViewRecoil } from '../lib/weapon-recoil.ts';

const still = { moving: false, airborne: false, stance: 'stand', aiming: false };
const half = () => 0.5;

test('spread grows on the move and in the air, shrinks crouched and prone', () => {
  assert.equal(spreadScale(still), 1);
  assert.ok(spreadScale({ ...still, moving: true }) > 1);
  assert.ok(spreadScale({ ...still, airborne: true }) > spreadScale({ ...still, moving: true }));
  assert.ok(spreadScale({ ...still, stance: 'sit' }) < 1);
  assert.ok(spreadScale({ ...still, stance: 'lie' }) < spreadScale({ ...still, stance: 'sit' }));
});

test('aiming down the sights is exact standing still, not on the run', () => {
  assert.equal(aimedSpread('paint', { ...still, aiming: true }), 0);
  assert.ok(aimedSpread('paint', { ...still, aiming: true, moving: true }) > 0);
  assert.ok(aimedSpread('sniper', { ...still, aiming: true, airborne: true }) > 0.03);
});

test('recoil kicks the view up; the paint marker has a learnable pattern', () => {
  const a = recoilKick('paint', 6, still, half);
  const b = recoilKick('paint', 6, still, half);
  assert.ok(a.pitch < 0, 'up is negative pitch');
  assert.deepEqual(a, b, 'same shot of the burst, same kick');
  assert.ok(Math.abs(recoilKick('sniper', 0, still, half).pitch) > Math.abs(a.pitch));
  assert.ok(
    Math.abs(recoilKick('paint', 6, { ...still, aiming: true }, half).pitch) < Math.abs(a.pitch),
    'aiming tames the recoil',
  );
  assert.deepEqual(recoilKick('grenade', 0, still), { pitch: 0, yaw: 0 });
});

test('the view climbs over a few frames, then mostly comes back', () => {
  const r = new ViewRecoil();
  r.kick({ pitch: -0.1, yaw: 0 });
  let pitch = 0;
  pitch += r.step(1 / 60).pitch;
  assert.ok(pitch < 0 && pitch > -0.1, 'not a single-frame jump');
  for (let i = 0; i < 6; i++) pitch += r.step(1 / 60).pitch;
  const peak = pitch;
  assert.ok(peak < -0.09, `reaches the full kick, ${peak}`);
  for (let i = 0; i < 120; i++) pitch += r.step(1 / 60).pitch;
  assert.ok(pitch > -0.035 && pitch < -0.015, `returns about three quarters, ${pitch}`);
});
