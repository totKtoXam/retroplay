import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMap } from '../lib/maps/index.ts';
import { VALLEY } from '../lib/maps/valley.ts';
import { MOUNTAIN } from '../lib/maps/mountain.ts';
import { buildArena } from '../lib/maps/types.ts';
import { isBlocked3D } from '../lib/world-collision.ts';
import { footstepSurface } from '../lib/footsteps.ts';
import { isSnowy } from '../lib/season-colors.ts';
import { reachable } from './map-helpers.mjs';

const map = getMap('valley');
const RED = map.spawns.red;
const BLUE = map.spawns.blue;

const PLATEAU_TOP = { x: -15, z: -12, y: 3.4 };
const PLATEAU_TOP_S = { x: 15, z: 12, y: 3.4 };
const RUIN_COURT = { x: 0, z: 0, y: 3.4 };
const SHELF = { x: -50, z: -10, y: 2.5 };
const SHELF_S = { x: -50, z: 10, y: 2.5 };
const GROTTO = { x: -50, z: 0 };
const TERRACE_2 = { x: 57, z: -5, y: 4.4 };
const TERRACE_2_S = { x: 57, z: 5, y: 4.4 };
const WATCHTOWER = { x: -16, z: -41, y: 3 };

const area = (b) => (b.maxX - b.minX) * (b.maxZ - b.minZ);

test('the valley keeps its id, title and is five times the mountain camp', () => {
  assert.equal(map.id, 'valley');
  assert.equal(map.title, 'Ледниковая долина');
  assert.deepEqual(map.bounds, { minX: -60, maxX: 60, minZ: -56, maxZ: 56 });
  assert.equal(area(VALLEY.bounds), 5 * area(MOUNTAIN.bounds));
});

test('every box sits inside the bounds and on or above the ground', () => {
  assert.ok(VALLEY.boxes.length < 700, `boxes: ${VALLEY.boxes.length}`);
  for (const b of VALLEY.boxes) {
    assert.ok(Math.abs(b.x) + b.w / 2 <= 60.001, `box inside |x| 60: ${b.x}, ${b.z}`);
    assert.ok(Math.abs(b.z) + b.d / 2 <= 56.001, `box inside |z| 56: ${b.x}, ${b.z}`);
    assert.ok(b.y - b.h / 2 >= -0.001, `box above ground: ${b.x}, ${b.y}, ${b.z}`);
  }
});

/**
 * Обе команды должны получить одинаковую карту, иначе бой не равный: всё, что стоит
 * при z < 0, обязано иметь близнеца при z > 0. Карта собрана отражением, и этот тест
 * стережёт свойство от ручной правки одной из половин.
 */
test('the whole map is mirror-symmetric across z = 0', () => {
  const round = (v) => Math.round(v * 1000) / 1000;
  const same = (label, list, key, mirror) => {
    const a = list.map((o) => key(o)).sort();
    const b = list.map((o) => key(mirror(o))).sort();
    assert.deepEqual(a, b, label);
  };
  // Декор бывает повёрнут: при отражении z -> -z углы вокруг x и y меняют знак.
  const boxKey = (b) =>
    [b.x, b.y, round(b.z), b.w, b.h, b.d, b.color, b.material, b.glow, !!b.solid, !!b.floor, !!b.invisible, (b.rot ?? []).map(round)].join('|');
  const mirrorBox = (b) => ({ ...b, z: -b.z, ...(b.rot ? { rot: [-b.rot[0], -b.rot[1], b.rot[2]] } : {}) });
  const cylKey = (c) => [c.x, c.y, round(c.z), c.r, c.rTop, c.h, c.color, c.material, c.glow, c.axis, !!c.solid].join('|');
  same('boxes', VALLEY.boxes, boxKey, mirrorBox);
  same('cylinders', VALLEY.cylinders, cylKey, (c) => ({ ...c, z: -c.z }));
  same(
    'spheres',
    VALLEY.spheres,
    (s) => [s.x, s.y, round(s.z), s.r, s.color, s.material, s.glow].join('|'),
    (s) => ({ ...s, z: -s.z }),
  );
  same('furnishings', VALLEY.furnishings, boxKey, mirrorBox);
  same('furnishing cylinders', VALLEY.furnishingCylinders, cylKey, (c) => ({ ...c, z: -c.z }));
  same(
    'roofs',
    VALLEY.roofs,
    (r) => [r.minX, r.maxX, round(r.minZ), round(r.maxZ), r.y, r.rise, r.ridge, r.color, r.material, r.gable].join('|'),
    (r) => ({ ...r, minZ: -r.maxZ, maxZ: -r.minZ }),
  );
  same(
    'lights',
    VALLEY.lights,
    (l) => [l.x, l.y, round(l.z), l.color, l.intensity, l.distance].join('|'),
    (l) => ({ ...l, z: -l.z }),
  );
  same(
    'ramps',
    VALLEY.ramps,
    (r) => [r.minX, r.maxX, round(r.minZ), round(r.maxZ), r.axis, round(r.from), round(r.to), r.y0, r.y1].join('|'),
    (r) => ({
      ...r,
      minZ: -r.maxZ,
      maxZ: -r.minZ,
      ...(r.axis === 'z' ? { from: -r.from, to: -r.to } : {}),
    }),
  );
  same(
    'water',
    VALLEY.water,
    (w) => [w.minX, w.maxX, round(w.minZ), round(w.maxZ), w.y].join('|'),
    (w) => ({ ...w, minZ: -w.maxZ, maxZ: -w.minZ }),
  );
  assert.deepEqual(
    RED.map((s) => [s.x, -s.z].join('|')).sort(),
    BLUE.map((s) => [s.x, s.z].join('|')).sort(),
    'spawns',
  );
});

test('both camps have twelve free spawn points on the ground behind their own ridge', () => {
  assert.equal(RED.length, 12);
  assert.equal(BLUE.length, 12);
  for (const team of ['red', 'blue']) {
    for (const s of map.spawns[team]) {
      const where = `${team} (${s.x}, ${s.z})`;
      assert.equal(map.groundHeight(s.x, s.z, 0.5), 0, `${where}: on the snow`);
      assert.equal(isBlocked3D(s.x, s.z, 0, 0.4, 1.8, map.colliders), false, `${where}: free`);
      assert.ok(team === 'red' ? s.z < -37 : s.z > 37, `${where}: behind its own ridge`);
      assert.ok(Math.abs(s.x) <= 26, `${where}: inside the camp, x -26..26`);
    }
  }
});

test('the camps reach each other, and every sector of the valley is open to both', () => {
  // Одна пара спавнов на каждый угол лагеря: полный перебор 12x12 на карте такого
  // размера считался бы минутами, а маршрут от лагеря до лагеря один и тот же.
  for (const [r, b] of [
    [RED[0], BLUE[0]],
    [RED[5], BLUE[5]],
    [RED[8], BLUE[8]],
    [RED[11], BLUE[11]],
  ])
    assert.equal(reachable(map, r, b, 'stand'), true, `(${r.x}, ${r.z}) -> (${b.x}, ${b.z})`);
  for (const sector of [
    { label: 'plateau', at: PLATEAU_TOP },
    { label: 'ruin courtyard', at: RUIN_COURT },
    { label: 'ice shelf', at: SHELF },
    { label: 'grotto', at: GROTTO },
    { label: 'quarry terrace 2', at: TERRACE_2 },
  ]) {
    assert.equal(reachable(map, RED[4], sector.at, 'stand'), true, `red -> ${sector.label}`);
    assert.equal(reachable(map, BLUE[4], sector.at, 'stand'), true, `blue -> ${sector.label}`);
  }
  // И зеркальные цели — чтобы «доступно» не означало «доступно только своей команде».
  assert.equal(reachable(map, RED[4], PLATEAU_TOP_S, 'stand'), true, 'red -> south plateau');
  assert.equal(reachable(map, BLUE[4], SHELF_S, 'stand'), true, 'blue -> south shelf');
  assert.equal(reachable(map, RED[4], TERRACE_2_S, 'stand'), true, 'red -> south terrace');
  assert.equal(reachable(map, RED[4], WATCHTOWER, 'stand'), true, 'red -> its watchtower');
});

test('the plateau is 3.4 m high and can only be climbed over its four ramps', () => {
  const noRamps = buildArena({ ...VALLEY, ramps: [] });
  assert.equal(reachable(noRamps, RED[4], PLATEAU_TOP, 'stand'), false, 'red without ramps');
  assert.equal(reachable(noRamps, BLUE[4], PLATEAU_TOP, 'stand'), false, 'blue without ramps');
  // У подножия скальной стены земля остаётся на нуле, а сама стена непроходима.
  for (const [x, z] of [[-18, -19], [18, -19], [-18, 19], [18, 19], [-23, 0], [23, 0]]) {
    assert.equal(map.groundHeight(x, z, 0), 0, `outside the plateau at (${x}, ${z})`);
  }
  for (const [x, z] of [[-18, -17], [18, -17], [-18, 17], [18, 17]]) {
    assert.equal(isBlocked3D(x, z, 0, 0.32, 1.8, map.colliders), true, `rock face at (${x}, ${z})`);
  }
  // Пандусы начинаются на снегу, тянут ровно, а вершиной совпадают с плато.
  for (const x of [-11, 11]) {
    for (const s of [-1, 1]) {
      assert.equal(map.groundHeight(x, s * 25, 0), 0, `ramp foot at (${x}, ${s * 25})`);
      assert.ok(Math.abs(map.groundHeight(x, s * 21.5, 1.4) - 1.7) < 1e-9, `ramp middle at x ${x}`);
      assert.ok(Math.abs(map.groundHeight(x, s * 18, 3.1) - 3.4) < 1e-9, `ramp top at x ${x}`);
    }
  }
});

test('the cross tunnel runs under the plateau and joins all four mouths', () => {
  const MOUTHS = [{ x: 0, z: -17 }, { x: 0, z: 17 }, { x: -21, z: 0 }, { x: 21, z: 0 }];
  for (const p of MOUTHS) {
    assert.equal(map.groundHeight(p.x, p.z, 0), 0, `tunnel floor at (${p.x}, ${p.z})`);
    assert.equal(isBlocked3D(p.x, p.z, 0, 0.32, 1.8, map.colliders), false, `tunnel clear at (${p.x}, ${p.z})`);
    assert.ok(map.ceilingHeight(p.x, p.z, 0) <= 3.05, `tunnel roofed at (${p.x}, ${p.z})`);
  }
  assert.equal(reachable(map, MOUTHS[0], MOUTHS[1], 'stand'), true, 'north mouth -> south mouth');
  assert.equal(reachable(map, MOUTHS[2], MOUTHS[3], 'stand'), true, 'west mouth -> east mouth');
  // Внутри плато сплошной камень: обойти тоннель по его толще нельзя.
  for (const [x, z] of [[-12, -10], [12, -10], [-12, 10], [12, 10], [-19, -6], [19, 6]]) {
    assert.equal(isBlocked3D(x, z, 0, 0.32, 1.8, map.colliders), true, `plateau rock at (${x}, ${z})`);
  }
});

test('the glacier is two levels: a shelf reached by ramps and a grotto under it', () => {
  // Под полкой можно идти в полный рост, но потолок над головой есть.
  for (const z of [-24, -8, 0, 8, 24]) {
    assert.equal(map.groundHeight(-50, z, 0), 0, `grotto floor at z ${z}`);
    assert.ok(map.ceilingHeight(-50, z, 0) <= 2.35, `grotto roofed at z ${z}`);
    assert.ok(map.ceilingHeight(-50, z, 0) >= 1.85, `grotto is standing height at z ${z}`);
  }
  assert.equal(map.groundHeight(-50, -10, 2), 2.5, 'the shelf is walkable on top');
  // Без пандусов на полку не подняться: её край — отвесные 2,5 м.
  const onlyPlateauRamps = buildArena({
    ...VALLEY,
    ramps: VALLEY.ramps.filter((r) => Math.abs(r.minX) <= 22 && Math.abs(r.maxX) <= 22),
  });
  assert.equal(reachable(onlyPlateauRamps, RED[0], SHELF, 'stand'), false, 'no way up without the ice ramps');
  assert.equal(reachable(map, GROTTO, SHELF, 'stand'), true, 'grotto -> shelf over a ramp');
});

test('the quarry stacks two terraces, the upper one only over its ramp', () => {
  assert.equal(map.groundHeight(50, -5, 2), 2.2, 'first terrace');
  assert.equal(map.groundHeight(57, -5, 4), 4.4, 'second terrace');
  const noUpper = buildArena({ ...VALLEY, ramps: VALLEY.ramps.filter((r) => r.y0 !== 2.2) });
  assert.equal(reachable(noUpper, RED[1], TERRACE_2, 'stand'), false, 'terrace 2 needs its own ramp');
  assert.equal(reachable(noUpper, RED[1], { x: 50, z: -5, y: 2.2 }, 'stand'), true, 'terrace 1 stays open');
});

test('the ridge lets the camps out through three gates and nowhere else', () => {
  for (const s of [-1, 1]) {
    for (const x of [-42, 0, 42]) {
      assert.equal(isBlocked3D(x, s * 36, 0, 0.32, 1.8, map.colliders), false, `gate at (${x}, ${s * 36})`);
    }
    for (const x of [-52, -20, -8, 8, 20, 52]) {
      assert.equal(isBlocked3D(x, s * 36, 0, 0.32, 1.8, map.colliders), true, `ridge at (${x}, ${s * 36})`);
    }
  }
});

// --- отделка и обстановка ----------------------------------------------------------------

const DRY = { season: 'winter', rain: 0, snow: 0 };
const inside = (o, x0, x1, z0, z1) => o.x > x0 && o.x < x1 && o.z > z0 && o.z < z1;
/** Дом красных; у синих — его отражение. */
const LODGE = (s) => ({ x0: -12.5, x1: 12.5, z0: s < 0 ? -53.5 : 46.5, z1: s < 0 ? -46.5 : 53.5 });
/** Четыре сруба: по два в каждом лагере. */
const CABINS = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ cx: 24 * sx, cz: 43 * sz, sx, sz })));

test('the valley is textured: snow ground, rock, ice and concrete, stepped stone ramps, pines of needles', () => {
  assert.equal(VALLEY.groundMaterial, 'snow');
  const solids = VALLEY.boxes.filter((b) => b.solid && !b.invisible);
  const bare = solids.filter((b) => !b.material);
  assert.equal(bare.length, 0, `solid boxes without a surface: ${bare.map((b) => `${b.x},${b.z}`).join(' ')}`);
  const used = new Set(solids.map((b) => b.material));
  for (const m of ['rock', 'concrete', 'ice', 'logs', 'ashlar', 'rust', 'metal', 'bark', 'crate'])
    assert.ok(used.has(m), `some solid block is ${m}`);
  // Пандусы: на плато — каменные лестницы, на полку — лёд, на вышку — доски со ступенями.
  const plateauRamps = VALLEY.ramps.filter((r) => r.y1 === 3.4);
  assert.equal(plateauRamps.length, 4);
  for (const r of plateauRamps) assert.deepEqual([r.material, r.steps], ['ashlar', 17]);
  for (const r of VALLEY.ramps.filter((r) => r.y1 === 2.5)) assert.deepEqual([r.material, r.steps], ['ice', undefined]);
  for (const r of VALLEY.ramps.filter((r) => r.y1 === 3)) assert.ok(r.material === 'planks' && r.steps > 0, 'tower stairs');
  // Сосны: ствол в коре, крона — ярусы конусов хвои над головой.
  const crowns = VALLEY.cylinders.filter((c) => c.material === 'foliage');
  const trunks = VALLEY.cylinders.filter((c) => c.material === 'bark' && c.r === 0.3 && c.solid);
  assert.equal(crowns.length, trunks.length * 4, 'four tiers per pine');
  for (const c of crowns) {
    assert.ok(c.rTop < c.r / 2, `crown at (${c.x}, ${c.z}) is a cone`);
    assert.ok(c.y - c.h / 2 >= 2.1, `crown at (${c.x}, ${c.z}) is above head height`);
  }
  assert.ok(VALLEY.spheres.some((s) => s.material === 'snow') && VALLEY.spheres.some((s) => s.material === 'ice'), 'snow caps and ice');
});

test('nothing but snow wears a snow colour, and the palette stays small', () => {
  // Сезоны перекрашивают по цвету: светлое бесцветное на зимней карте летом «тает» в луг.
  const all = [
    ...VALLEY.boxes,
    ...VALLEY.cylinders,
    ...VALLEY.spheres,
    ...VALLEY.furnishings,
    ...VALLEY.furnishingCylinders,
  ];
  for (const o of all)
    if (!o.glow && o.material !== 'snow' && !o.invisible)
      assert.equal(isSnowy(o.color), false, `${o.color} ${o.material ?? ''} at (${o.x}, ${o.y}, ${o.z}) would melt`);
  const pairs = new Set(all.map((o) => `${o.color}|${o.material ?? ''}|${o.glow ?? ''}`));
  for (const r of VALLEY.roofs) pairs.add(`${r.color}|${r.material}`).add(`${r.gable}|${r.gableMaterial}`);
  assert.ok(pairs.size <= 150, `draw calls: ${pairs.size}`);
  assert.ok(VALLEY.lights.length <= 30, `lights: ${VALLEY.lights.length}`);
});

test('the lodges are furnished, floored in planks and reached from their spawns', () => {
  for (const s of [-1, 1]) {
    const L = LODGE(s);
    const team = s < 0 ? RED : BLUE;
    const solids = VALLEY.boxes.filter((b) => b.solid && inside(b, L.x0, L.x1, L.z0, L.z1));
    // Стол радиста, два стола, четыре скамьи и скамья у вешалки, нары, полки, поленница, печь, шкафчики.
    assert.ok(solids.length >= 14, `solid furniture: ${solids.length}`);
    const decor = VALLEY.furnishings.filter((b) => inside(b, L.x0, L.x1, L.z0, L.z1));
    assert.ok(decor.length >= 150, `decor: ${decor.length}`);
    assert.ok(decor.some((b) => b.glow), 'a lantern or the radio dial glows');
    // Шаги по доскам пола — дерево, и под крышей, и если крыша не распознана.
    for (const sheltered of [true, false])
      for (const [x, z] of [
        [-4, -50],
        [4, -52.5],
        [-10.8, -49],
      ])
        assert.equal(footstepSurface({ map, ...DRY, sheltered }, x, 0, s * -z), 'wood', `floor at (${x}, ${s * -z})`);
    assert.equal(map.ceilingHeight(-10, s * 50, 0), 4.2, 'ceiling');
    assert.ok(
      VALLEY.roofs.some((r) => r.material === 'planks' && r.minX <= -14 && r.maxX >= 14 && r.minZ < s * 50 && r.maxZ > s * 50),
      'pitched roof over the lodge',
    );
    // Из дома в оба конца столовой и со двора внутрь.
    const home = team[11];
    assert.deepEqual([home.x, home.z], [0, s * 49.5], 'the spawn inside the lodge');
    assert.equal(reachable(map, home, { x: -10.8, z: s * 49 }, 'stand'), true, 'to the west end');
    assert.equal(reachable(map, team[6], { x: 10.8, z: s * 50.5 }, 'stand'), true, 'from the yard to the east end');
  }
});

test('the log cabins are enterable, roofed, furnished, and their neighbouring spawns stay free', () => {
  for (const { cx, cz, sx, sz } of CABINS) {
    const where = `cabin (${cx}, ${cz})`;
    const x0 = cx - 3.7,
      x1 = cx + 3.7,
      z0 = cz - 2.7,
      z1 = cz + 2.7;
    const spot = { x: cx - sx * 2, z: cz };
    assert.equal(map.groundHeight(spot.x, spot.z, 0), 0, `${where}: floor`);
    assert.equal(isBlocked3D(spot.x, spot.z, 0, 0.32, 1.8, map.colliders), false, `${where}: room inside`);
    assert.ok(Math.abs(map.ceilingHeight(spot.x, spot.z, 0) - 3.2) < 1e-9, `${where}: ceiling`);
    assert.ok(
      VALLEY.roofs.some((r) => r.minX < cx && r.maxX > cx && r.minZ < cz && r.maxZ > cz && r.material === 'planks'),
      `${where}: pitched roof`,
    );
    assert.equal(footstepSurface({ map, ...DRY, sheltered: true }, spot.x, 0, spot.z), 'wood', `${where}: plank floor`);
    const furniture = VALLEY.boxes.filter((b) => b.solid && inside(b, x0, x1, z0, z1));
    // Две нары, печь, поленница, стол, полки.
    assert.ok(furniture.length >= 6, `${where}: furniture ${furniture.length}`);
    assert.ok(VALLEY.furnishings.some((b) => b.glow && inside(b, x0, x1, z0, z1)), `${where}: a lantern`);
    // Вход с ближнего к срубу спавна за домом.
    const team = sz < 0 ? RED : BLUE;
    const near = team.find((p) => p.x === cx && Math.abs(p.z) === 50);
    assert.equal(reachable(map, near, spot, 'stand'), true, `${where}: from the spawn behind it`);
  }
});

test('the tunnel lining is decor only: the arms stay clear from wall to wall', () => {
  for (const [x, z] of [
    [-2.6, -16],
    [2.6, -8],
    [-2.6, 16],
    [-8, -2.6],
    [17, 2.6],
    [-19, 2.6],
  ])
    assert.equal(isBlocked3D(x, z, 0, 0.32, 1.8, map.colliders), false, `tunnel at (${x}, ${z})`);
  assert.equal(footstepSurface({ map, ...DRY, sheltered: true }, 0, 0, -8), 'tile', 'concrete floor under the plateau');
});
