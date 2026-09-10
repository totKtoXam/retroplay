import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAvatar,
  animateAvatar,
  avatarShoot,
  setAvatarStyle,
  setAvatarAnonymous,
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

test('Tactical skin replaces all legacy body surfaces within a small draw-call budget', () => {
  const a = createAvatar('#8196dd');
  const visible = (o) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const legacy = [],
    agent = [],
    meshes = [];
  a.traverse((o) => {
    if (o.name === 'legacy-skin') legacy.push(o);
    if (o.name === 'agent-skin') agent.push(o);
    if (o.isMesh && visible(o)) meshes.push(o);
  });
  assert.ok(agent.length >= 10);
  assert.ok(legacy.every((o) => !visible(o)));
  assert.ok(meshes.length <= 24, 'Character must batch details per joint');
  setAvatarStyle(a, true);
  assert.ok(agent.every((o) => !visible(o)));
  assert.ok(legacy.some(visible));
});

test('Anonymous bag conceals the head across both styles and can be removed', () => {
  const a = createAvatar('#657ac9');
  setAvatarAnonymous(a, true);
  for (const anime of [true, false]) {
    setAvatarStyle(a, anime);
    assert.equal(a.getObjectByName('unmasked-head').visible, false);
    assert.equal(a.getObjectByName('anonymous-bag').visible, true);
  }
  setAvatarAnonymous(a, false);
  assert.equal(a.getObjectByName('unmasked-head').visible, true);
  assert.equal(a.getObjectByName('anonymous-bag').visible, false);
});

test('Sitting and prone have expressive idle breathing and crawling locomotion', () => {
  const a = createAvatar('#8196dd');
  // 1. Sitting idle has natural breathing bob
  frames(a, { stance: 'sit', speed: 0 }, 60);
  const sitY0 = a.getObjectByName('rig').position.y;
  assert.ok(Math.abs(sitY0 - (-0.4)) < 0.05);

  // 2. Sitting with speed shuffles legs and hands
  frames(a, { stance: 'sit', speed: 2.5 }, 30);
  const kneeL = a.getObjectByName('kneeL').rotation.x;
  assert.ok(kneeL < -1.1);

  // 3. Prone idle has chest breathing and propped head
  frames(a, { stance: 'lie', speed: 0 }, 30);
  const headX = a.getObjectByName('head').rotation.x;
  assert.ok(headX > 0.5, 'Head should be propped up looking ahead while prone');
  const rigY = a.getObjectByName('rig').position.y;
  assert.ok(rigY > 0.18, 'Prone character stays above ground');

  // 4. Prone crawling has alternating low-crawl knee drives
  let minKnee = 0;
  for (let f = 0; f < 30; f++) {
    animateAvatar(a, { ...idle, stance: 'lie', speed: 1.5, forward: 1 }, 1 / 60, f / 60);
    minKnee = Math.min(minKnee, a.getObjectByName('kneeL').rotation.x, a.getObjectByName('kneeR').rotation.x);
  }
  assert.ok(minKnee < -0.1, 'Crawling bends knees forward in soldier crawl');
});

