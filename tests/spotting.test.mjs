import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inSight, spotTargets, SPOT_CONE, SPOT_RANGE } from '../lib/spotting.ts';
import { getMap } from '../lib/maps/index.ts';

/** Смотрящий в начале координат, взгляд по умолчанию — вдоль −z (yaw 0). */
const watcher = (over = {}) => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, stance: 'stand', ...over });
/** Цель на `d` метров прямо по взгляду. */
const ahead = (d, over = {}) => ({ id: 't', x: 0, y: 0, z: -d, ...over });

/** Стена поперёк взгляда на z = −5, во всю высоту. */
const WALL = [{ minX: -6, maxX: 6, minZ: -5.2, maxZ: -4.8, minY: 0, maxY: 4 }];
/** Барьер в рост груди: стоящему видно макушку над ним, присевшего он скрывает. */
const BARRIER = [{ minX: -6, maxX: 6, minZ: -5.2, maxZ: -4.8, minY: 0, maxY: 1.6 }];

test('цель прямо по прицелу и в чистом поле видна', () => {
  assert.equal(inSight(watcher(), ahead(12), []), true);
});

test('стена между бойцами закрывает цель', () => {
  assert.equal(inSight(watcher(), ahead(12), WALL), false);
  // Та же стена, но цель перед ней — видно.
  assert.equal(inSight(watcher(), ahead(3), WALL), true);
});

test('за барьером засчитывается торчащая голова, а пригнувшийся скрыт', () => {
  // Грудь за барьером не видна, но макушка над ним — да, и этого достаточно:
  // иначе боец, которого прекрасно видно, считался бы невидимым.
  assert.equal(inSight(watcher(), ahead(12), BARRIER), true);
  // Тот же барьер, но цель пригнулась или легла — скрыта целиком.
  assert.equal(inSight(watcher(), ahead(12, { stance: 'sit' }), BARRIER), false);
  assert.equal(inSight(watcher(), ahead(12, { stance: 'lie' }), BARRIER), false);
});

test('вне сектора прицела цель не засвечивается, даже когда её ничто не закрывает', () => {
  const d = 20;
  // Точно на границе сектора — видно; заметно шире — уже нет.
  const inside = Math.tan(SPOT_CONE * 0.6) * d;
  const outside = Math.tan(SPOT_CONE * 2.5) * d;
  assert.equal(inSight(watcher(), { id: 't', x: inside, y: 0, z: -d }, []), true);
  assert.equal(inSight(watcher(), { id: 't', x: outside, y: 0, z: -d }, []), false);
  // Цель за спиной не видна ни при каких условиях.
  assert.equal(inSight(watcher(), { id: 't', x: 0, y: 0, z: d }, []), false);
});

test('сектор поворачивается вместе с yaw и наклоняется вместе с pitch', () => {
  // Взгляд на восток (+x) — это yaw = −π/2 при направлении (−sin yaw, −cos yaw).
  const east = watcher({ yaw: -Math.PI / 2 });
  assert.equal(inSight(east, { id: 't', x: 20, y: 0, z: 0 }, []), true);
  assert.equal(inSight(east, ahead(20), []), false);
  // Взгляд в пол: цель впереди на том же уровне уходит из сектора.
  assert.equal(inSight(watcher({ pitch: 1.2 }), ahead(20), []), false);
  // И наоборот: цель на уступе видна, когда ствол поднят к ней.
  const up = { id: 't', x: 0, y: 12, z: -12 };
  assert.equal(inSight(watcher(), up, []), false);
  assert.equal(inSight(watcher({ pitch: -0.75 }), up, []), true);
});

test('дальше предела засветки цель не видна', () => {
  assert.equal(inSight(watcher(), ahead(SPOT_RANGE - 5), []), true);
  assert.equal(inSight(watcher(), ahead(SPOT_RANGE + 5), []), false);
});

test('засвечивает вся команда: хватает одного, кто смотрит', () => {
  // Цель позади первого бойца и прямо перед вторым (оба смотрят вдоль −z).
  const target = { id: 'enemy', x: 0, y: 0, z: 15 };
  const blind = watcher();
  const seeing = watcher({ z: 30 });
  assert.deepEqual(spotTargets([blind], [target], []), []);
  assert.deepEqual(spotTargets([blind, seeing], [target], []), ['enemy']);
});

test('на настоящей карте плато закрывает тоннель от того, кто стоит наверху', () => {
  const map = getMap('valley');
  // Боец на плато смотрит вниз, ровно туда, где под ним идёт тоннель.
  const onTop = { x: 0, y: 3.4, z: -10, yaw: 0, pitch: 1.2, stance: 'stand' };
  const inTunnel = { id: 'enemy', x: 0, y: 0, z: -14 };
  assert.equal(inSight(onTop, inTunnel, map.colliders), false, 'сквозь камень плато');
  // Тот же враг с того же расстояния, но по прямой в самом тоннеле — виден.
  const inside = { x: 0, y: 0, z: -4, yaw: 0, pitch: 0, stance: 'stand' };
  assert.equal(inSight(inside, inTunnel, map.colliders), true, 'по коридору');
});

test('на настоящей карте гряда закрывает лагерь, а её ворота — нет', () => {
  const map = getMap('valley');
  // Одна и та же дистанция по обе стороны гряды: в глухом месте она держит...
  const atRidge = { x: 20, y: 0, z: -32, yaw: 0, pitch: 0, stance: 'stand' };
  assert.equal(
    inSight(atRidge, { id: 'enemy', x: 20, y: 0, z: -39 }, map.colliders),
    false,
    'через гряду',
  );
  // ...а в проёме центральных ворот простреливается насквозь.
  const atGate = { x: 0, y: 0, z: -32, yaw: 0, pitch: 0, stance: 'stand' };
  assert.equal(
    inSight(atGate, { id: 'enemy', x: 0, y: 0, z: -39 }, map.colliders),
    true,
    'через ворота',
  );
});
