import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createAvatar, animateAvatar } from '../components/world-avatar.ts';
import {
  avatarMuzzle,
  createFlashlightBeam,
  createPlayerFlashlight,
} from '../components/world-flashlight.ts';

const idle = {
  speed: 0,
  strafe: 0,
  forward: 1,
  airborne: false,
  velocityY: 0,
  stance: 'stand',
  tool: 'paint',
  pitch: 0,
};

function armed(tool, pitch = 0) {
  const scene = new T.Scene();
  const avatar = createAvatar('#8196dd');
  avatar.position.set(4, 0.27, -3);
  avatar.rotation.y = 0.7;
  scene.add(avatar);
  const beam = createFlashlightBeam();
  avatar.add(beam.group);
  for (let i = 0; i < 90; i++) animateAvatar(avatar, { ...idle, tool, pitch }, 1 / 60, i / 60);
  scene.updateMatrixWorld(true);
  return { scene, avatar, beam, gun: avatar.getObjectByName('gun') };
}

for (const tool of ['paint', 'confetti', 'sniper']) {
  test(`Луч фонарика начинается у дула (${tool}), а не у плеча`, () => {
    const { avatar, beam, gun } = armed(tool, 0.3);
    beam.set(true, 0.3, tool);
    avatar.updateMatrixWorld(true);
    const start = beam.group.getWorldPosition(new T.Vector3());
    const muzzle = avatarMuzzle(gun, tool);
    assert.ok(start.distanceTo(muzzle) < 1e-6, `луч в ${start.distanceTo(muzzle).toFixed(3)} м от дула`);
    // Дуло — впереди кисти, то есть сам луч действительно вынесен к стволу.
    const hand = gun.getWorldPosition(new T.Vector3());
    assert.ok(muzzle.distanceTo(hand) > 0.2, 'точка дула должна быть на конце ствола');
  });
}

test('Без оружия в руках луч идёт из кисти', () => {
  const { avatar, beam, gun } = armed('grenade');
  assert.equal(gun.visible, false);
  beam.set(true, 0, 'grenade');
  avatar.updateMatrixWorld(true);
  const start = beam.group.getWorldPosition(new T.Vector3());
  assert.ok(start.distanceTo(gun.getWorldPosition(new T.Vector3())) < 0.15);
});

test('Свой фонарик светит от заданной точки туда, куда смотрит игрок', () => {
  const scene = new T.Scene();
  const flashlight = createPlayerFlashlight(scene);
  const light = scene.children.find((o) => o instanceof T.SpotLight);
  assert.ok(light, 'свет висит в сцене, а не на камере');
  assert.equal(flashlight.toggle(), true);
  const origin = new T.Vector3(1, 1.4, 2);
  const direction = new T.Vector3(0, -0.2, -1).normalize();
  flashlight.aim(origin, direction);
  assert.ok(light.position.distanceTo(origin) < 1e-9);
  const toTarget = light.target.position.clone().sub(light.position).normalize();
  assert.ok(toTarget.distanceTo(direction) < 1e-9);
  flashlight.dispose();
  assert.equal(light.parent, null);
});
