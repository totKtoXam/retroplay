import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createFirstPersonHands } from '../components/world-hands.ts';
import { opticNdcBox, opticCatches } from '../components/world-optic-mark.ts';

/** Прицеливание краскомётом с коллиматором, как в бою. */
function aimed(sight = 'dot') {
  const camera = new T.PerspectiveCamera(56, 1.1, 0.06, 350);
  camera.updateProjectionMatrix();
  const hands = createFirstPersonHands(camera);
  for (let i = 0; i < 90; i++)
    hands.update(1 / 60, 10 + i / 60, 0, 'paint', '#ffffff', true, 1, 0, 'pinata', 0, sight);
  camera.updateMatrixWorld(true);
  return { camera, hands, box: opticNdcBox(hands.opticGlass, camera, new T.Box2()) };
}

test('Окно коллиматора накрывает центр экрана, но не весь экран', () => {
  const { box } = aimed();
  assert.ok(box.min.x < 0 && box.max.x > 0, 'центр экрана должен быть в окне');
  assert.ok(box.min.y < 0 && box.max.y > 0, 'центр экрана должен быть в окне');
  const width = box.max.x - box.min.x;
  const height = box.max.y - box.min.y;
  assert.ok(width > 0.05 && width < 0.6, `окно шириной ${width.toFixed(3)} NDC`);
  assert.ok(height > 0.05 && height < 0.6, `окно высотой ${height.toFixed(3)} NDC`);
});

test('В рамку попадает цель по центру, но не сбоку и не за спиной', () => {
  const { camera, box } = aimed();
  assert.ok(
    opticCatches(new T.Vector3(0, 0, -12), box, camera),
    'то, во что целятся, обязано быть в рамке',
  );
  assert.ok(
    !opticCatches(new T.Vector3(6, 0, -12), box, camera),
    'цель далеко сбоку в рамку не попадает',
  );
  assert.ok(
    !opticCatches(new T.Vector3(0, 6, -12), box, camera),
    'цель высоко над прицелом в рамку не попадает',
  );
  assert.ok(
    !opticCatches(new T.Vector3(0, 0, 12), box, camera),
    'цель за спиной подсвечивать нельзя: её проекция попадает в кадр зеркально',
  );
});

test('С механическим прицелом коллиматора нет, и подсвечивать нечем', () => {
  const camera = new T.PerspectiveCamera(56, 1.1, 0.06, 350);
  const hands = createFirstPersonHands(camera);
  for (let i = 0; i < 90; i++)
    hands.update(1 / 60, 10 + i / 60, 0, 'paint', '#ffffff', true, 1, 0, 'pinata', 0, 'irons');
  const optic = camera.getObjectByName('paint-optic');
  const irons = camera.getObjectByName('paint-irons');
  assert.equal(optic.visible, false);
  assert.equal(irons.visible, true);
  for (let i = 0; i < 4; i++)
    hands.update(1 / 60, 20 + i / 60, 0, 'paint', '#ffffff', true, 1, 0, 'pinata', 0, 'dot');
  assert.equal(optic.visible, true);
  assert.equal(irons.visible, false);
});

test('Оба прицела краскомёта целятся в одну точку', () => {
  const lines = ['irons', 'dot'].map((sight) => {
    const { camera } = aimed(sight);
    const gun = camera.getObjectByName('paint-launcher');
    return ['sight-rear', 'sight-front'].map((name) =>
      camera.worldToLocal(
        gun.getObjectByName(name).getWorldPosition(new T.Vector3()),
      ),
    );
  });
  for (const [rear, front] of lines) {
    assert.ok(Math.abs(rear.x) < 1e-6 && Math.abs(rear.y) < 1e-6);
    assert.ok(Math.abs(front.x) < 1e-6 && Math.abs(front.y) < 1e-6);
  }
});
