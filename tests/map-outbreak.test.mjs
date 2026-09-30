import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getMap } from '../lib/maps/index.ts';
import { buildOutbreak } from '../lib/maps/outbreak.ts';
import { OUTBREAK_MODELS } from '../lib/maps/outbreak-models.ts';
import { isBlocked3D, rayCastWorldObstacle } from '../lib/world-collision.ts';
import { navFor } from '../lib/bot-brain.ts';
import { sanitizePose } from '../lib/room-hub-core.ts';

const map = getMap('outbreak');
const arena = map.arena;

// Детерминированный генератор для случайных проверок: тесты не должны мигать.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

test('«Зона заражения» — 2 × 2 км: города, деревни, лес, горы, степь, озеро', () => {
  const b = map.bounds;
  assert.deepEqual([b.maxX - b.minX, b.maxZ - b.minZ], [2000, 2000]);
  const names = new Set(arena.zones.map((z) => z.name));
  for (const name of [
    'Мегаполис',
    'Новоград',
    'Сосновка',
    'Берёзовка',
    'Заречье',
    'Степное',
    'Горный',
    'Военная база',
    'Старое кладбище',
    'Озеро',
    'Хребет',
    'Тёмный бор',
    'Степь',
  ])
    assert.ok(names.has(name), name);
  assert.ok(arena.props.length > 15000, `моделей ${arena.props.length}`);
  const used = new Set(arena.props.map((p) => p.m));
  assert.ok(used.size >= 150, `видов моделей ${used.size}`);
  for (const id of used) assert.ok(id in OUTBREAK_MODELS, id);
  // Каждой постройке и дереву — столкновение: сквозь дом не пройти.
  assert.ok(
    map.colliders.length >
      arena.props.filter((p) => OUTBREAK_MODELS[p.m].hit !== 'none').length,
  );
});

test('генератор с постоянным зерном: клиент и сервер строят одну карту', () => {
  const again = buildOutbreak();
  assert.equal(again.props.length, arena.props.length);
  assert.deepEqual(again.props.at(-1), arena.props.at(-1));
  assert.deepEqual(again.props[1234], arena.props[1234]);
  assert.deepEqual(
    Array.from(again.terrain.heights.slice(5000, 5010)),
    Array.from(arena.terrain.heights.slice(5000, 5010)),
  );
});

test('рельеф: горы на севере со снегом, котловина озера под водой, дороги и города ровные', () => {
  const t = arena.terrain;
  let peak = 0;
  for (let z = -1000; z <= -600; z += 10)
    for (let x = -1000; x <= 1000; x += 10)
      peak = Math.max(peak, map.terrainHeight(x, z));
  assert.ok(peak > 90, `вершина ${peak}`);
  assert.ok(t.kinds.some((k) => t.palette[k].name === 'снег'));
  const lake = arena.water[0];
  assert.ok(
    map.terrainHeight(
      (lake.minX + lake.maxX) / 2,
      (lake.minZ + lake.maxZ) / 2,
    ) <
      lake.y - 1,
  );
  // Шоссе между городами и центр мегаполиса выровнены почти в ноль.
  for (const [x, z] of [
    [200, 0],
    [-800, 180],
    [615, 0],
    [-90, 60],
  ])
    assert.ok(Math.abs(map.terrainHeight(x, z)) < 0.5, `${x}, ${z}`);
  // Игрок в горах: сервер принимает высоту ног выше прежних 10 м.
  const pose = sanitizePose(
    { x: 0, y: 120, z: -900, yaw: 0 },
    map.bounds,
    map.heightRange,
  );
  assert.equal(pose.y, 120);
});

test('дома не стоят на дорогах: середина каждой плитки дороги свободна', () => {
  const tiles = arena.props.filter((p) => p.m === 'road/road-straight');
  assert.ok(tiles.length > 1000);
  const blocked = tiles.filter((p) => {
    const building = map.colliders.find(
      (c) =>
        c.label !== 'terrain' &&
        p.x > c.minX &&
        p.x < c.maxX &&
        p.z > c.minZ &&
        p.z < c.maxZ &&
        c.maxY - c.minY > 4,
    );
    return !!building;
  });
  assert.deepEqual(
    blocked.slice(0, 3),
    [],
    `на дороге ${blocked.length} построек`,
  );
});

test('сетка ускорения коллизий отвечает так же, как перебор всех коробок', () => {
  const rand = rng(7);
  const colliders = map.colliders;
  assert.ok(colliders.length > 256, 'на огромной карте включается сетка');
  for (let i = 0; i < 300; i++) {
    const x = rand() * 1800 - 900,
      z = rand() * 1800 - 900;
    const y = map.groundHeight(x, z, 300) + (rand() < 0.3 ? -0.5 : 0);
    const fast = isBlocked3D(x, z, y, 0.4, 1.8, colliders);
    // Короткий список (одна коробка) сеткой не пользуется: это и есть перебор.
    const slow = colliders.some((c) => isBlocked3D(x, z, y, 0.4, 1.8, [c]));
    assert.equal(fast, slow, `тело в (${x.toFixed(1)}, ${z.toFixed(1)})`);
    const a = rand() * Math.PI * 2,
      len = 5 + rand() * 150;
    const from = [x, y + 1.5, z],
      to = [
        x + Math.cos(a) * len,
        y + 1.5 + (rand() - 0.5) * 20,
        z + Math.sin(a) * len,
      ];
    const hit = rayCastWorldObstacle(from, to, colliders);
    let best = Infinity;
    for (const c of colliders) {
      const h = rayCastWorldObstacle(from, to, [c]);
      if (h) best = Math.min(best, h.distance);
    }
    assert.equal(
      hit ? hit.distance.toFixed(6) : 'нет',
      best === Infinity ? 'нет' : best.toFixed(6),
      `луч ${i}`,
    );
  }
});

test('боты находят путь между местами по крупной сетке огромной карты', () => {
  const nav = navFor(map);
  assert.equal(nav.cell, 3);
  // С запада (Берёзовка) в Новоград и из Новограда в Мегаполис.
  assert.ok(nav.find(-560, 184, -268, 30), 'Берёзовка → Новоград');
  assert.ok(nav.find(-268, 30, 372, 30), 'Новоград → Мегаполис');
  assert.ok(nav.find(420, 682, 760, 790), 'Степное → база');
});

test('в props.glb есть узел каждой модели из таблицы размеров', () => {
  const glb = readFileSync(
    new URL('../public/models/outbreak/props.glb', import.meta.url),
  );
  // Первый чанк GLB — JSON: длина по смещению 12, данные с 20.
  const json = JSON.parse(
    glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'),
  );
  const nodes = new Set(json.nodes.map((n) => n.name));
  for (const id of Object.keys(OUTBREAK_MODELS))
    assert.ok(nodes.has(`prop:${id}`), id);
});
