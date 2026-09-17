import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createLampLights, pickLamps } from '../components/world-lamp-lights.ts';
import { getMap } from '../lib/maps/index.ts';

const lamp = (x, z, distance = 10, intensity = 1) => ({ x, y: 3, z, color: '#ffd9a8', intensity, distance });
const row = [lamp(0, 0), lamp(10, 0), lamp(20, 0), lamp(30, 0), lamp(40, 0)];
const pointLights = (scene) => {
  const list = [];
  scene.traverse((o) => o.isPointLight && list.push(o));
  return list;
};

test('светят ближайшие к камере лампы', () => {
  assert.deepEqual([...pickLamps(row, { x: 27, y: 1.6, z: 0 }, 2)].sort((a, b) => a - b), [2, 3]);
});

test('уже горящая лампа не уступает место почти равноудалённой', () => {
  // Камера чуть ближе к лампе 2, но лампа 1 уже горит: перемигивания нет.
  const eye = { x: 15.5, y: 3, z: 0 };
  assert.deepEqual([...pickLamps(row, eye, 1)], [2]);
  assert.deepEqual([...pickLamps(row, eye, 1, new Set([1]))], [1]);
});

test('источников в сцене ровно столько, сколько слотов, при любом движении камеры', () => {
  const scene = new T.Scene();
  const lights = createLampLights(scene, row, 2);
  assert.equal(pointLights(scene).length, 2);
  const eye = new T.Vector3();
  for (let x = 0; x <= 40; x += 0.5) {
    eye.set(x, 1.6, 0);
    lights.update(eye, 1 / 30);
    assert.equal(pointLights(scene).length, 2, 'смена числа источников пересобрала бы шейдеры');
  }
});

test('ушедшая лампа гаснет плавно, и к новой переезжает только погасший источник', () => {
  const scene = new T.Scene();
  const lights = createLampLights(scene, row, 1);
  const [light] = pointLights(scene);
  const eye = new T.Vector3(40, 1.6, 0);
  lights.update(eye, 0.1);
  assert.ok(light.intensity > 0 && light.intensity < 1, 'гаснет, а не щёлкает');
  assert.equal(light.position.x, 0, 'пока горит — стоит у старой лампы');
  for (let i = 0; i < 20; i++) lights.update(eye, 0.1);
  assert.equal(light.position.x, 40);
  assert.equal(light.intensity, 1);
});

test('на боевых картах света не больше пула, даже если ламп больше', () => {
  const map = getMap('mansion');
  assert.ok((map.arena?.lights?.length ?? 0) > 4);
  const scene = new T.Scene();
  const lights = createLampLights(scene, map.arena.lights, 4);
  assert.equal(lights.count, 4);
  assert.equal(pointLights(scene).length, 4);
  lights.dispose();
  assert.equal(pointLights(scene).length, 0);
});
