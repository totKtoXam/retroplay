import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMap } from '../lib/maps/index.ts';
import { buildOutbreak } from '../lib/maps/outbreak.ts';
import { OUTBREAK_REAL_MODELS } from '../lib/maps/outbreak-real-models.ts';
import {
  isProcModel,
  propColliders,
  propModelInfo,
} from '../lib/maps/types.ts';
import { isGoreDecal } from '../lib/maps/decals.ts';
import { isBlocked3D, rayCastWorldObstacle } from '../lib/world-collision.ts';
import { navFor } from '../lib/bot-brain.ts';
import { sanitizePose } from '../lib/room-hub-core.ts';

const map = getMap('outbreak');
const arena = map.arena;
const info = (id) => propModelInfo(arena.propKit, id);

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
    'Колхоз «Заря»',
    'Лесопилка',
    'Лагерь альпинистов',
    'Лагерь выживших',
    'Озеро',
    'Хребет',
    'Тёмный бор',
    'Степь',
  ])
    assert.ok(names.has(name), name);
  // Бюджет: моделей много, но не больше ~30 тысяч — их рисует и сталкивает каждый клиент.
  assert.ok(
    arena.props.length > 10000 && arena.props.length < 30000,
    `моделей ${arena.props.length}`,
  );
  // Каждой постройке и дереву — столкновение: сквозь дом не пройти.
  assert.ok(
    map.colliders.length >
      arena.props.filter((p) => info(p.m).hit !== 'none').length,
  );
});

test('только реалистичные модели и процедурные дома: старого props.glb нет', () => {
  assert.equal(arena.propKit.url, undefined);
  assert.equal(arena.propKit.models, OUTBREAK_REAL_MODELS);
  for (const p of arena.props) {
    const m = info(p.m);
    assert.ok(m, `нет модели ${p.m}`);
    if (!isProcModel(p.m))
      assert.match(m.file, /^\/models\/outbreak-real\//, p.m);
  }
  // В дело идут все модели таблицы, кроме тех, что нельзя поставить: z5 без клипов, z9 в
  // Т-позе (есть лежачий z9-lying) и пустой peter-d-death.
  const used = new Set([
    ...arena.props.map((p) => p.m),
    ...arena.npcs.map((n) => n.m),
  ]);
  const skip = new Set(['zombies/z5', 'zombies/z9', 'zombies/peter-d-death']);
  const unused = Object.keys(OUTBREAK_REAL_MODELS).filter(
    (id) => !used.has(id) && !skip.has(id),
  );
  assert.deepEqual(unused, []);
  // Процедурные дома всех стилей, и их немного разных: одинаковые рисуются инстансами.
  const proc = new Set(
    arena.props.filter((p) => isProcModel(p.m)).map((p) => p.m),
  );
  for (const style of ['apt', 'office', 'house', 'industrial', 'ruin'])
    assert.ok(
      [...proc].some((id) => id.endsWith(`:${style}`)),
      style,
    );
  assert.ok(proc.size < 100, `вариантов домов ${proc.size}`);
});

test('генератор с постоянным зерном: клиент и сервер строят одну карту', () => {
  const again = buildOutbreak();
  for (const key of ['props', 'decals', 'npcs']) {
    assert.equal(again[key].length, arena[key].length, key);
    assert.deepEqual(again[key].at(-1), arena[key].at(-1), key);
  }
  assert.deepEqual(again.props[1234], arena.props[1234]);
  assert.deepEqual(again.roads, arena.roads);
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
  // Каждый вид земли — PBR-скан, и каждый встречается на карте.
  for (const [i, kind] of t.palette.entries()) {
    assert.match(kind.texture, /^[a-z0-9_]+$/, kind.name);
    assert.match(kind.color, /^#[0-9a-f]{6}$/, kind.name);
    assert.ok(t.kinds.includes(i), `вид «${kind.name}» не встречается`);
  }
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

test('дороги — ленты: шоссе, улицы и грунтовки; сквозь дома не проходят', () => {
  const widths = new Set(arena.roads.map((r) => r.width));
  assert.deepEqual(
    [...widths].sort((a, b) => a - b),
    [5, 7, 8],
  );
  assert.ok(
    arena.roads.some((r) => r.texture === 'brown_mud_dry') &&
      arena.roads.some((r) => r.texture === 'rocky_trail'),
  );
  // Постройки (дома, заборы, лестницы) — не машины и не заграждения — не пересекают осевую линию.
  const solid = arena.props
    .filter(
      (p) =>
        !p.m.startsWith('vehicles/') &&
        p.m !== 'items/covered-car' &&
        !/barrier/.test(p.m),
    )
    .flatMap((p) => propColliders(p, info(p.m)).map((c) => ({ c, m: p.m })));
  const blocked = [];
  for (const r of arena.roads)
    for (let i = 1; i < r.points.length; i++) {
      const [ax, az] = r.points[i - 1],
        [bx, bz] = r.points[i];
      const len = Math.hypot(bx - ax, bz - az);
      for (let d = 0; d <= len; d += 2) {
        const x = ax + ((bx - ax) * d) / len,
          z = az + ((bz - az) * d) / len;
        for (const { c, m } of solid)
          if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ)
            blocked.push(`${m} (${x.toFixed(0)}, ${z.toFixed(0)})`);
      }
    }
  assert.deepEqual(
    blocked.slice(0, 5),
    [],
    `на дорогах ${blocked.length} препятствий`,
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

test('кровь, тела и зомби: без столкновений, кровь — только у тел и в пятнах крови', () => {
  assert.equal(arena.mood, 'grim');
  assert.equal(arena.sky.hdri, 'wasteland_clouds_puresky');
  // Настройка «Кровь и жестокость» прячет gore-модели и gore-пятна: это тела, зомби и кровь.
  for (const [id, m] of Object.entries(OUTBREAK_REAL_MODELS)) {
    const gore = id.startsWith('corpses/') || id.startsWith('zombies/');
    assert.equal(!!m.gore, gore, id);
    if (m.gore) assert.equal(m.hit, 'none', id);
  }
  const bodies = arena.props.filter((p) => p.m.startsWith('corpses/'));
  assert.ok(bodies.length > 200, `тел ${bodies.length}`);
  // Тела запечены в позе смерти: лежат, а не стоят.
  for (const p of bodies) assert.ok(info(p.m).max[1] < 1.2, `${p.m} лежит`);
  const blood = arena.decals.filter((d) => isGoreDecal(d.texture));
  const grime = arena.decals.filter((d) => !isGoreDecal(d.texture));
  assert.ok(
    blood.length > 300 && grime.length > 300,
    `крови ${blood.length}, грязи ${grime.length}`,
  );
  for (const d of arena.decals)
    assert.match(
      d.texture,
      /^(d1|d2|d3-diffuse|proc-blood|d4-flipbook#[0-8]|d5-(leaking-grime|smear-grime|surface-imperfections|rust-decal|graffiti))$/,
      d.texture,
    );
  // Фигуры: зомби бредут и стоят группами, выжившие и солдаты стоят; у каждой — свой клип.
  assert.ok(
    arena.npcs.length >= 150 && arena.npcs.length <= 260,
    `фигур ${arena.npcs.length}`,
  );
  for (const n of arena.npcs) {
    const m = OUTBREAK_REAL_MODELS[n.m];
    assert.ok(m?.skinned, n.m);
    assert.ok(m.clips.includes(n.clip), `${n.m}: ${n.clip}`);
  }
  const survivors = arena.npcs.filter((n) => n.m.startsWith('survivors/'));
  assert.ok(
    survivors.length >= 5 && survivors.length <= 14,
    `выживших ${survivors.length}`,
  );
  // Лагерь выживших: люди стоят внутри стены.
  const camp = arena.zones.find((z) => z.id === 'camp');
  assert.ok(
    survivors.filter(
      (n) =>
        n.x > camp.minX &&
        n.x < camp.maxX &&
        n.z > camp.minZ &&
        n.z < camp.maxZ,
    ).length >= 5,
  );
  for (const p of arena.props.filter((p) => p.tint))
    assert.match(p.tint, /^#[0-9a-f]{6}$/);
});
