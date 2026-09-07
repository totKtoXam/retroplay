import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAvatar,
  animateAvatar,
  avatarShoot,
  setAvatarStyle,
  followCameraHeading,
} from '../components/world-avatar.ts';

const idle = {
  speed: 0,
  strafe: 0,
  forward: 1,
  airborne: false,
  velocityY: 0,
  stance: 'stand',
  tool: 'other',
  pitch: 0,
};
function frames(a, m, n = 60, dt = 1 / 60) {
  for (let i = 0; i < n; i++) animateAvatar(a, { ...idle, ...m }, dt, i * dt);
}
test('Camera drives heading while stationary and crosses angle wrap by the short path', () => {
  let angle = 0;
  for (let i = 0; i < 60; i++)
    angle = followCameraHeading(angle, Math.PI / 2, 1 / 60);
  assert.ok(Math.abs(angle - Math.PI / 2) < 0.001);
  const crossed = followCameraHeading(Math.PI - 0.02, -Math.PI + 0.02, 1 / 60);
  assert.ok(crossed > Math.PI - 0.02);
  assert.ok(crossed < Math.PI + 0.02);
});
test('Sitting articulates knees without squashing the character; prone transition is smooth', () => {
  const a = createAvatar('#8196dd');
  frames(a, { stance: 'sit' });
  const rig = a.getObjectByName('rig');
  assert.equal(rig.scale.y, 1);
  assert.ok(a.getObjectByName('kneeL').rotation.x < -1.4);
  assert.ok(a.getObjectByName('legL').rotation.x > 1.3);
  animateAvatar(a, { ...idle, stance: 'lie' }, 1 / 60, 2);
  assert.ok(rig.rotation.x > -Math.PI / 2);
  assert.ok(rig.rotation.x < 0);
  frames(a, { stance: 'lie' });
  assert.ok(Math.abs(rig.rotation.x + Math.PI / 2) < 0.001);
  assert.ok(rig.position.y > 0.18);
});
test('Jump bends legs; landing absorbs impact and returns to idle', () => {
  const a = createAvatar('#8196dd');
  frames(a, { airborne: true, velocityY: 4 }, 20);
  assert.ok(a.getObjectByName('kneeL').rotation.x < -0.5);
  animateAvatar(a, idle, 1 / 60, 1);
  assert.ok(a.getObjectByName('rig').position.y < 0);
  frames(a, {}, 90);
  assert.ok(Math.abs(a.getObjectByName('rig').position.y) < 0.02);
});
test('Weapon recoil recovers, inventory replaces gun with tablet, anime is switchable', () => {
  const a = createAvatar('#8196dd');
  frames(a, { tool: 'paint' });
  const gun = a.getObjectByName('gun'),
    rest = gun.position.z;
  avatarShoot(a);
  animateAvatar(a, { ...idle, tool: 'paint' }, 1 / 60, 1);
  assert.ok(gun.position.z > rest);
  frames(a, { tool: 'paint' }, 90);
  assert.ok(Math.abs(gun.position.z - rest) < 0.002);
  frames(a, { tool: 'paint', inventory: true }, 2);
  assert.equal(gun.visible, false);
  assert.equal(a.getObjectByName('tablet').visible, true);
  setAvatarStyle(a, true);
  assert.equal(a.getObjectByName('anime-detail').visible, true);
  assert.equal(a.getObjectByName('classic-detail').visible, false);
  setAvatarStyle(a, false);
  assert.equal(a.getObjectByName('classic-detail').visible, true);
});
test('Pose blending is stable at 30 and 60 FPS', () => {
  const a = createAvatar('#8196dd'),
    b = createAvatar('#8196dd');
  frames(a, { stance: 'sit' }, 30, 1 / 30);
  frames(b, { stance: 'sit' }, 60, 1 / 60);
  assert.ok(
    Math.abs(
      a.getObjectByName('legL').rotation.x -
        b.getObjectByName('legL').rotation.x,
    ) < 0.001,
  );
});
