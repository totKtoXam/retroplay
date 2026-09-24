import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  footstepSurface,
  splitSteps,
  strideLength,
  surfaceOfColor,
} from '../lib/footsteps.ts';
import { getMap } from '../lib/maps/index.ts';
import { buildArena } from '../lib/maps/types.ts';

const dry = { season: 'summer', sheltered: false, rain: 0, snow: 0 };

// Небольшая арена: луг, деревянный настил с ковром, каменная площадка, пруд.
const yard = buildArena({
  id: 'yard',
  title: 'Двор',
  bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
  groundColor: '#6f8f4a',
  boxes: [
    { x: 0, y: 0.25, z: 0, w: 6, h: 0.5, d: 6, color: '#8a5f3c', floor: true },
    { x: 1, y: 0.52, z: 1, w: 2, h: 0.04, d: 2, color: '#9b2f3a' },
    { x: 10, y: 0.05, z: 0, w: 4, h: 0.1, d: 4, color: '#9c9285' },
    // Стол на настиле: на него не наступают, звук берётся с пола.
    { x: -2, y: 0.9, z: -2, w: 1, h: 0.8, d: 1, color: '#6b4a2f' },
  ],
  water: [{ minX: -15, maxX: -10, minZ: -5, maxZ: 5, y: 0.3 }],
  spawns: { red: [{ x: 0, z: 0 }], blue: [{ x: 0, z: 0 }] },
});

test('цвета палитр карт узнаются как поверхности', () => {
  assert.equal(surfaceOfColor('#6f8f4a'), 'grass'); // луг особняка
  assert.equal(surfaceOfColor('#2e5c33'), 'grass'); // живая изгородь
  assert.equal(surfaceOfColor('#8a5f3c'), 'wood'); // настил особняка
  assert.equal(surfaceOfColor('#7c5838'), 'wood'); // доски горного лагеря
  assert.equal(surfaceOfColor('#e8eff5'), 'snow');
  assert.equal(surfaceOfColor('#f6fafd', true), 'snow'); // голубоватый наст сугробов
  assert.equal(surfaceOfColor('#d8c48e'), 'gravel'); // песок базара
  assert.equal(surfaceOfColor('#9c9285'), 'stone');
  assert.equal(surfaceOfColor('#6d7883'), 'stone'); // скалы
  assert.equal(surfaceOfColor('#9b2f3a', true), 'carpet'); // ковёр базара
  assert.equal(surfaceOfColor('#9b2f3a', false), 'stone'); // та же краска на стене — не ковёр
});

test('поверхность под ногами: земля, настил, ковёр, камень, вода', () => {
  assert.equal(footstepSurface({ map: yard, ...dry }, 15, 0, 15), 'grass');
  assert.equal(footstepSurface({ map: yard, ...dry }, -2.5, 0.5, 2.5), 'wood');
  assert.equal(footstepSurface({ map: yard, ...dry }, -2, 0.5, -2), 'wood'); // под столом — пол
  assert.equal(footstepSurface({ map: yard, ...dry }, 1, 0.54, 1), 'carpet');
  assert.equal(footstepSurface({ map: yard, ...dry }, 10, 0.1, 0), 'stone');
  assert.equal(footstepSurface({ map: yard, ...dry }, -12, 0, 0), 'wet');
});

test('сезон перекрашивает землю: зимой луг хрустит снегом', () => {
  assert.equal(
    footstepSurface({ map: yard, ...dry, season: 'winter' }, 15, 0, 15),
    'snow',
  );
  // Заснеженная горная карта летом зарастает лугом.
  const mountain = getMap('mountain');
  const b = mountain.bounds;
  let checked = 0;
  for (let x = b.minX + 2; x < b.maxX; x += 7)
    for (let z = b.minZ + 2; z < b.maxZ; z += 7) {
      if (mountain.groundHeight(x, z, 0) !== 0) continue;
      // Пруд зимой замёрз и хрустит снегом, а летом оттаивает — это не луг.
      if (mountain.arena.water.some((w) => x >= w.minX && x <= w.maxX && z >= w.minZ && z <= w.maxZ)) continue;
      if (
        footstepSurface(
          { map: mountain, ...dry, season: 'winter' },
          x,
          0,
          z,
        ) !== 'snow'
      )
        continue;
      assert.equal(
        footstepSurface({ map: mountain, ...dry, season: 'summer' }, x, 0, z),
        'grass',
        `${x},${z}`,
      );
      checked++;
    }
  assert.ok(checked > 10, `открытых заснеженных точек: ${checked}`);
});

test('материал поверхности задаёт звук, а снег звучит по сезонному цвету', () => {
  const camp = buildArena({
    id: 'camp',
    title: 'Лагерь',
    bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
    groundColor: '#e8eff5',
    groundMaterial: 'snow',
    season: 'winter',
    boxes: [
      // Сугроб, пол сруба, бревно-лавка, ящик и глыба льда.
      { x: 0, y: 0.1, z: 0, w: 4, h: 0.2, d: 4, color: '#f6fafd', material: 'snow' },
      { x: 8, y: 0.015, z: 0, w: 4, h: 0.03, d: 4, color: '#8a6a4a', material: 'planks' },
      { x: -8, y: 0.2, z: 0, w: 2, h: 0.4, d: 0.4, color: '#8c6544', material: 'bark', solid: true },
      { x: 0, y: 0.25, z: 8, w: 1, h: 0.5, d: 1, color: '#a3763f', material: 'crate', solid: true },
      { x: 0, y: 0.25, z: -8, w: 2, h: 0.5, d: 2, color: '#a8dcee', material: 'ice', solid: true },
    ],
    spawns: { red: [{ x: 0, z: 0 }], blue: [{ x: 0, z: 0 }] },
  });
  const at = (season, x, y, z) => footstepSurface({ map: camp, ...dry, season }, x, y, z);
  assert.equal(at('winter', 0, 0.2, 0), 'snow');
  // Летом сугроб на заснеженной карте перекрашен в луг — и шуршит травой.
  assert.equal(at('summer', 0, 0.2, 0), 'grass');
  assert.equal(at('winter', 8, 0.03, 0), 'wood');
  assert.equal(at('winter', -8, 0.4, 0), 'wood');
  assert.equal(at('winter', 0, 0.5, 8), 'wood');
  assert.equal(at('winter', 0, 0.5, -8), 'stone');
});

test('зимой стоячая вода замерзает и не хлюпает, а фонтан бьёт и зимой', () => {
  const winter = { ...dry, season: 'winter' };
  // Пруд двора зимой — лёд поверх луга, который зимой под снегом.
  assert.equal(footstepSurface({ map: yard, ...dry }, -12, 0, 0), 'wet');
  assert.equal(footstepSurface({ map: yard, ...winter }, -12, 0, 0), 'snow');
  // Бассейн особняка с фонтаном остаётся водой.
  const mansion = getMap('mansion');
  const [fountain] = mansion.arena.fountains;
  assert.equal(footstepSurface({ map: mansion, ...winter }, fountain.x + 3, 0.3, fountain.z), 'wet');
});

test('погода: снегопад и дождь только под открытым небом', () => {
  assert.equal(
    footstepSurface({ map: yard, ...dry, snow: 0.6 }, 15, 0, 15),
    'snow',
  );
  assert.equal(
    footstepSurface({ map: yard, ...dry, rain: 0.6 }, 10, 0.1, 0),
    'wet',
  );
  assert.equal(
    footstepSurface({ map: yard, ...dry, rain: 0.6 }, 1, 0.54, 1),
    'carpet',
  );
  assert.equal(
    footstepSurface(
      { map: yard, ...dry, rain: 0.6, sheltered: true },
      10,
      0.1,
      0,
    ),
    'tile',
  );
  assert.equal(
    footstepSurface(
      { map: yard, ...dry, snow: 0.6, sheltered: true },
      -2.5,
      0.5,
      2.5,
    ),
    'wood',
  );
});

test('корабль целиком металлический, хаб — плитка внутри и камень снаружи', () => {
  assert.equal(
    footstepSurface({ map: getMap('ship'), ...dry, sheltered: true }, 0, 0, 0),
    'metal',
  );
  assert.equal(
    footstepSurface({ map: getMap('hub'), ...dry, sheltered: true }, 0, 0, 0),
    'tile',
  );
  assert.equal(
    footstepSurface({ map: getMap('hub'), ...dry, rain: 0.8 }, 0, 0, 0),
    'wet',
  );
  assert.equal(
    footstepSurface({ map: getMap('hub'), ...dry }, 0, 0, 0),
    'stone',
  );
});

test('шаг шире на бегу: темп остаётся человеческим', () => {
  const perSecond = (speed) => speed / strideLength(speed);
  assert.ok(
    perSecond(2) > 1.8 && perSecond(2) < 2.6,
    `крадучись ${perSecond(2)}`,
  );
  assert.ok(
    perSecond(4.8) > 2.6 && perSecond(4.8) < 3.4,
    `бег ${perSecond(4.8)}`,
  );
});

test('запись делится на шаги по тишине', () => {
  const rate = 8000;
  const samples = new Float32Array(rate * 2);
  const burst = (from, length) => {
    for (let i = 0; i < length * rate; i++)
      samples[Math.round(from * rate) + i] = Math.sin(i) * 0.5;
  };
  burst(0.25, 0.2);
  // Короткий провал внутри шага (пятка → носок) шаг не разрезает.
  burst(0.5, 0.1);
  burst(1.0, 0.15);
  burst(1.6, 0.01); // щелчок короче minLength — не шаг
  const steps = splitSteps(samples, rate);
  assert.equal(steps.length, 2);
  assert.ok(
    Math.abs(steps[0][0] - 0.25) < 0.01 && Math.abs(steps[0][1] - 0.6) < 0.01,
    JSON.stringify(steps),
  );
  assert.ok(
    Math.abs(steps[1][0] - 1.0) < 0.01 && Math.abs(steps[1][1] - 1.15) < 0.01,
    JSON.stringify(steps),
  );
});
