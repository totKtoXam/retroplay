import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArena, propColliders, propModelInfo } from '../lib/maps/types.ts';
import { procBuildingInfo } from '../lib/maps/proc-buildings.ts';
import { decalBounds, decalTextures, isGoreDecal } from '../lib/maps/decals.ts';

const PROC = 'proc/building:16x12x4:7:apt';
const arena = (props, models = {}) => ({
  id: 't',
  title: 't',
  bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
  groundColor: '#000',
  boxes: [],
  spawns: { red: [], blue: [] },
  props,
  propKit: { models },
});

test('рамка модели: из набора, у процедурного здания — по id, иначе нет', () => {
  const kit = {
    models: {
      'vehicles/sedan': {
        file: '/models/outbreak-real/vehicles/sedan.glb',
        min: [-1, 0, -2],
        max: [1, 1.5, 2],
        hit: 'box',
      },
    },
  };
  assert.equal(
    propModelInfo(kit, 'vehicles/sedan'),
    kit.models['vehicles/sedan'],
  );
  assert.deepEqual(propModelInfo(kit, PROC), procBuildingInfo(PROC));
  assert.equal(propModelInfo(kit, 'vehicles/nope'), undefined);
  assert.equal(propModelInfo(undefined, 'vehicles/sedan'), undefined);
});

test('buildArena ставит столкновения процедурным зданиям и моделям с файлом', () => {
  const sedan = {
    file: '/x.glb',
    min: [-1, 0, -2],
    max: [1, 1.5, 2],
    hit: 'box',
  };
  const props = [
    { m: PROC, x: 10, y: 0, z: 10 },
    { m: 'vehicles/sedan', x: -20, y: 0, z: 0 },
  ];
  const map = buildArena(arena(props, { 'vehicles/sedan': sedan }));
  const info = procBuildingInfo(PROC);
  const expected =
    (info ? propColliders(props[0], info).length : 0) +
    propColliders(props[1], sedan).length;
  assert.equal(map.colliders.length, expected);
  assert.ok(map.groundHeight(-20, 0, 2) >= 1.5, 'на крышу машины можно встать');
});

test('кровь прячется настройкой, грязь и ржавчина — нет', () => {
  for (const id of [
    'd1-blood-splatter-exilegl',
    'd2',
    'd3',
    'd4-bloodfx-flipbook#2',
    'proc-blood',
    'blood-pool',
  ])
    assert.ok(isGoreDecal(id), id);
  for (const id of ['d5-leaking-grime', 'graffiti', 'rust-decal'])
    assert.ok(!isGoreDecal(id), id);
});

test('файлы декалей и кадр флипбука', () => {
  // Файлы грязи лежат с буквенным префиксом сборки: d5-graffiti → d5e-*.
  assert.deepEqual(
    decalTextures('d5-graffiti').alphaMap,
    '/textures/outbreak/decals/d5e-opacity.webp',
  );
  assert.equal(
    decalTextures('d3-diffuse').normalMap,
    '/textures/outbreak/decals/d3-normal.webp',
  );
  const flip = decalTextures('d4-bloodfx-flipbook#5');
  assert.equal(flip.map, undefined);
  assert.equal(
    flip.alphaMap,
    '/textures/outbreak/decals/d4-bloodfx-flipbook.webp',
  );
  assert.deepEqual(flip.frame, { cols: 3, rows: 3, index: 5 });
  assert.equal(
    decalTextures('proc-blood').map,
    '/textures/outbreak/proc-blood/albedo.webp',
  );
  assert.ok(decalTextures('proc-blood').roughness < 0.5, 'кровь блестит');
  const b = decalBounds({ x: 0, z: 0, s: 2, yaw: Math.PI / 4, texture: 'd1' });
  assert.ok(
    Math.abs(b.maxX - Math.SQRT2) < 1e-9 &&
      Math.abs(b.minZ + Math.SQRT2) < 1e-9,
  );
});
