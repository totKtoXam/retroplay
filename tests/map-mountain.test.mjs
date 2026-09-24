import { test } from 'node:test';
import assert from 'node:assert/strict';
import { footstepSurface } from '../lib/footsteps.ts';
import { getMap } from '../lib/maps/index.ts';
import { MOUNTAIN } from '../lib/maps/mountain.ts';
import { buildArena } from '../lib/maps/types.ts';
import { isBlocked3D } from '../lib/world-collision.ts';
import { reachable } from './map-helpers.mjs';

const map = getMap('mountain');
const RED = map.spawns.red;
const BLUE = map.spawns.blue;

/** The plateau top and the two ramp feet. */
const PLATEAU_TOP = { x: 0, z: 0, y: 2.4 };
const RAMP_N_FOOT = { x: 0, z: -9.5 };
const RAMP_S_FOOT = { x: 0, z: 9.5 };

test('the mountain map keeps its id, title and bounds', () => {
  assert.equal(map.id, 'mountain');
  assert.equal(map.title, 'Горный лагерь');
  assert.deepEqual(map.bounds, { minX: -28, maxX: 28, minZ: -24, maxZ: 24 });
  assert.ok(MOUNTAIN.boxes.length < 500, `boxes: ${MOUNTAIN.boxes.length}`);
  for (const b of MOUNTAIN.boxes) {
    assert.ok(Math.abs(b.x) + b.w / 2 <= 36 && Math.abs(b.z) + b.d / 2 <= 36, `box inside |36|: ${b.x},${b.z}`);
    assert.ok(b.y - b.h / 2 >= -0.001, `box above ground: ${b.x},${b.y},${b.z}`);
  }
});

test('both camps have at least six free spawn points on the ground', () => {
  assert.ok(RED.length >= 6 && BLUE.length >= 6, `${RED.length}/${BLUE.length}`);
  for (const team of ['red', 'blue']) {
    for (const s of map.spawns[team]) {
      const where = `${team} (${s.x}, ${s.z})`;
      assert.equal(map.groundHeight(s.x, s.z, 0.5), 0, `${where}: on the snow`);
      assert.equal(isBlocked3D(s.x, s.z, 0, 0.4, 1.8, map.colliders), false, `${where}: free`);
      assert.ok(team === 'red' ? s.z < -16 : s.z > 16, `${where}: in its own camp`);
      assert.ok(Math.abs(s.x) <= 10, `${where}: inside x −10..10`);
    }
  }
});

test('every red spawn reaches every blue spawn standing', () => {
  for (const r of RED)
    for (const b of BLUE)
      assert.equal(reachable(map, r, b, 'stand'), true, `(${r.x}, ${r.z}) -> (${b.x}, ${b.z})`);
});

test('the plateau top is reachable from both camps over the ramps', () => {
  assert.equal(reachable(map, RED[4], PLATEAU_TOP, 'stand'), true, 'red -> plateau');
  assert.equal(reachable(map, BLUE[4], PLATEAU_TOP, 'stand'), true, 'blue -> plateau');
  // Both ramp feet are on the snow and both ramps rise the full 2.4 m.
  assert.equal(map.groundHeight(RAMP_N_FOOT.x, -10, 0), 0);
  assert.equal(map.groundHeight(RAMP_S_FOOT.x, 10, 0), 0);
  assert.ok(Math.abs(map.groundHeight(0, -6, 2.1) - 2.4) < 1e-9, 'north ramp reaches the top');
  assert.ok(Math.abs(map.groundHeight(0, 6, 2.1) - 2.4) < 1e-9, 'south ramp reaches the top');
  // The lookout roof clears a standing head on the plateau (2.4 + 1.8 = 4.2).
  assert.ok(map.ceilingHeight(5, -0.4, 2.4) >= 4.3, 'lookout roof is high enough');
});

test('the plateau cannot be climbed away from its ramps', () => {
  const noRamps = buildArena({ ...MOUNTAIN, ramps: [] });
  assert.equal(reachable(noRamps, RED[4], PLATEAU_TOP, 'stand'), false, 'red without ramps');
  assert.equal(reachable(noRamps, BLUE[4], PLATEAU_TOP, 'stand'), false, 'blue without ramps');
  // Beside the rock face the ground stays at 0 and the 2.4 m step is unreachable.
  for (const [x, z] of [[-8.6, 0], [8.6, 0], [-5, -6.6], [5, 6.6], [0, -6.6], [0, 6.6]]) {
    assert.equal(map.groundHeight(x, z, 0), 0, `outside the plateau at (${x}, ${z})`);
  }
  for (const [x, z] of [[-7.6, 0], [7.6, 0], [-5, -5.6], [5, 5.6]]) {
    assert.equal(map.groundHeight(x, z, 0), 0, `no step up onto the plateau at (${x}, ${z})`);
    assert.equal(isBlocked3D(x, z, 0, 0.32, 1.8, map.colliders), true, `rock face at (${x}, ${z})`);
  }
});

test('the ice cave is a closed corridor linking its north and south entrances', () => {
  const INSIDE_N = { x: -22, z: -12 };
  const INSIDE_MID = { x: -19.5, z: -5 };
  const INSIDE_S = { x: -22, z: 12 };
  const EAST_MOUTH = { x: -16, z: 1 };
  // The middle leg is walled in on every side, so reaching it means going through the cave.
  for (const p of [INSIDE_N, INSIDE_MID, INSIDE_S, EAST_MOUTH]) {
    assert.equal(map.groundHeight(p.x, p.z, 0), 0, `cave floor at (${p.x}, ${p.z})`);
    assert.equal(isBlocked3D(p.x, p.z, 0, 0.32, 1.8, map.colliders), false, `cave is clear at (${p.x}, ${p.z})`);
    assert.ok(map.ceilingHeight(p.x, p.z, 0) <= 3.05, `cave is roofed at (${p.x}, ${p.z})`);
  }
  assert.equal(reachable(map, INSIDE_N, INSIDE_S, 'stand'), true, 'north leg -> south leg');
  assert.equal(reachable(map, INSIDE_N, INSIDE_MID, 'stand'), true, 'north leg -> middle leg');
  assert.equal(reachable(map, INSIDE_MID, EAST_MOUTH, 'stand'), true, 'middle leg -> east mouth');
  assert.equal(reachable(map, RED[0], INSIDE_MID, 'stand'), true, 'red camp -> inside the cave');
  assert.equal(reachable(map, BLUE[0], INSIDE_MID, 'stand'), true, 'blue camp -> inside the cave');
  // The rock mass itself is solid: no walking around the corridor inside the flank.
  for (const [x, z] of [[-25, 0], [-25, -12], [-25, 12], [-17, -5], [-17, 8], [-19, -12]]) {
    assert.equal(isBlocked3D(x, z, 0, 0.32, 1.8, map.colliders), true, `cave rock at (${x}, ${z})`);
  }
});

test('the pine forest is passable north to south and gives cover', () => {
  const FOREST_N = { x: 19, z: -13 };
  const FOREST_S = { x: 19, z: 13 };
  assert.equal(reachable(map, FOREST_N, FOREST_S, 'stand'), true, 'forest north -> south');
  assert.equal(reachable(map, { x: 22.5, z: -13 }, { x: 15, z: 12 }, 'stand'), true, 'forest diagonal');
  // Trunks block, so the trees really are cover and not scenery.
  const trunks = (MOUNTAIN.cylinders ?? []).filter((c) => c.solid && c.r === 0.3);
  assert.ok(trunks.length >= 12, `pine trunks: ${trunks.length}`);
  for (const t of trunks.slice(0, 5))
    assert.equal(isBlocked3D(t.x, t.z, 0, 0.32, 1.8, map.colliders), true, `trunk at (${t.x}, ${t.z})`);
  // Open lanes either side of the plateau stay usable as a third and fourth route.
  assert.equal(reachable(map, { x: -11.5, z: -16 }, { x: -11.5, z: 16 }, 'stand'), true, 'west lane');
  assert.equal(reachable(map, { x: 11, z: -16 }, { x: 11, z: 16 }, 'stand'), true, 'east lane');
});

test('the map is textured: snow ground, rock cliffs and plateau, stone steps', () => {
  assert.equal(MOUNTAIN.groundMaterial, 'snow');
  const plateau = MOUNTAIN.boxes.find((b) => b.solid && b.x === 0 && b.z === 0 && b.w === 16 && b.d === 12);
  assert.equal(plateau?.material, 'rock', 'the plateau is a rock mass');
  // Every visible solid box says what it is made of (tents and woodpiles are invisible colliders).
  const bare = MOUNTAIN.boxes.filter((b) => b.solid && !b.invisible && !b.material);
  assert.deepEqual(bare.map((b) => `${b.x},${b.y},${b.z}`), []);
  // The perimeter cliffs, the cave rock and its roof are rock.
  const cliffs = MOUNTAIN.boxes.filter((b) => b.solid && (b.w >= 56 || b.d >= 48));
  assert.equal(cliffs.length, 4);
  for (const b of cliffs) assert.equal(b.material, 'rock');
  for (const [x, z] of [[-25, 1], [-17, -5], [-22, -12]]) {
    const rock =MOUNTAIN.boxes.filter((b) => b.solid && Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2);
    assert.ok(rock.length > 0 && rock.every((b) => b.material === 'rock'), `cave rock at (${x}, ${z})`);
  }
  // Both ramps are flights of stone steps; logs are round bark; drifts are snow.
  for (const r of MOUNTAIN.ramps) assert.deepEqual([r.material, r.steps], ['ashlar', 12]);
  const logs = MOUNTAIN.boxes.filter((b) => b.solid && b.material === 'bark');
  assert.ok(logs.length >= 6, `logs: ${logs.length}`);
  const drifts = MOUNTAIN.boxes.filter((b) => !b.solid && b.color === '#f6fafd');
  assert.ok(drifts.length >= 10 && drifts.every((b) => b.material === 'snow'), 'snow drifts');
  // Tents and cabins are drawn with roofs, and there is plenty of detail.
  assert.equal((MOUNTAIN.roofs ?? []).length, 10, '6 tents + 4 cabins');
  assert.ok((MOUNTAIN.furnishings ?? []).length > 300, `furnishings: ${MOUNTAIN.furnishings?.length}`);
});

test('pines are cones of needles and icicles hang from the cave roof', () => {
  const crowns = MOUNTAIN.cylinders.filter((c) => c.material === 'foliage');
  assert.ok(crowns.length >= 3 * 18, `crown tiers: ${crowns.length}`);
  for (const c of crowns) {
    assert.ok(c.rTop !== undefined && c.rTop < c.r / 3, `a cone at (${c.x}, ${c.z})`);
    assert.ok(c.y - c.h / 2 >= 2.4 - 1e-9, `crown over head height at (${c.x}, ${c.z})`);
    assert.ok((c.sides ?? 16) >= 10);
  }
  const icicles = MOUNTAIN.cylinders.filter((c) => c.material === 'ice');
  assert.ok(icicles.length >= 40, `icicles: ${icicles.length}`);
  for (const c of icicles) {
    const where = `icicle at (${c.x.toFixed(2)}, ${c.z.toFixed(2)})`;
    assert.ok(c.rTop > c.r, `${where} points down`);
    assert.ok(Math.abs(c.y + c.h / 2 - 3) < 1e-9 && c.y - c.h / 2 >= 2.1 - 1e-9, `${where} hangs from 3 m to above 2.1 m`);
    assert.ok(Math.abs(map.ceilingHeight(c.x, c.z, 0) - 3) < 1e-9, `${where} is under the cave roof`);
  }
});

/** The four log cabins: centre and the side (±1 along x) whose door faces the camp centre. */
const CABINS = [-1, 1].flatMap((s) => [-1, 1].map((e) => ({ x: e * 14, z: s * 19, s, e })));

test('the log cabins are enterable from the spawns, roofed and furnished', () => {
  for (const c of CABINS) {
    const name = `cabin (${c.x}, ${c.z})`;
    const spawn = (c.s < 0 ? RED : BLUE).find((p) => p.x === c.e * 9.5 && p.z === c.s * 19.5);
    assert.ok(spawn, `${name}: a spawn by the door`);
    // Just inside the door and deep in the room, by the bunks.
    const door = { x: c.x - c.e * 2, z: c.z };
    const deep = { x: c.x + c.e * 1.25, z: c.z - c.s * 0.3 };
    for (const p of [door, deep]) {
      const where = `${name} at (${p.x}, ${p.z})`;
      assert.equal(reachable(map, spawn, p, 'stand'), true, `${where}: reachable from the spawn`);
      assert.equal(map.groundHeight(p.x, p.z, 0), 0, `${where}: on the floor`);
      assert.ok(Math.abs(map.ceilingHeight(p.x, p.z, 0) - 3) < 1e-9, `${where}: under a 3 m ceiling`);
    }
    // Plank floor underfoot, indoors and in any season.
    for (const season of ['winter', 'summer'])
      assert.equal(footstepSurface({ map, season, sheltered: true, rain: 0, snow: 0 }, door.x, 0, door.z), 'wood', `${name}: ${season}`);
    // Furniture inside: bunks, stove, woodpile, table, bench and shelf.
    const inside = MOUNTAIN.boxes.filter(
      (b) => b.solid && b.material !== 'logs' && Math.abs(b.x - c.x) < 2.95 && Math.abs(b.z - c.z) < 2.2,
    );
    assert.ok(inside.length >= 6, `${name}: ${inside.length} pieces of furniture`);
    assert.ok(inside.some((b) => b.material === 'rust'), `${name}: a stove`);
    // The stove pipe goes out above the roof ridge (3.25 + 1.3); a lamp is lit inside.
    const pipe = MOUNTAIN.furnishingCylinders.find(
      (p) => Math.abs(p.x - c.x) < 3 && Math.abs(p.z - c.z) < 2.5 && p.y + p.h / 2 > 4.6 && p.y - p.h / 2 < 1,
    );
    assert.ok(pipe, `${name}: stove pipe through the roof`);
    assert.ok(
      MOUNTAIN.lights.some((l) => Math.abs(l.x - c.x) < 2.95 && Math.abs(l.z - c.z) < 2.2 && l.y < 3),
      `${name}: a lamp inside`,
    );
  }
  // Red and blue get the same cabins, mirrored.
  const count = (s) => MOUNTAIN.boxes.filter((b) => Math.sign(b.z) === s && Math.abs(Math.abs(b.z) - 19) < 2.6 && Math.abs(Math.abs(b.x) - 14) < 3.3).length;
  assert.equal(count(-1), count(1));
});

test('both camps have tents, a firepit, crates and their flag', () => {
  for (const s of [-1, 1]) {
    const tents = MOUNTAIN.boxes.filter((b) => b.invisible && b.h === 1.8 && Math.sign(b.z) === s);
    assert.equal(tents.length, 3, `tents at z ${s * 20}`);
    const embers = MOUNTAIN.furnishingCylinders.filter((c) => c.glow && Math.hypot(c.x, c.z - s * 20) < 1);
    assert.ok(embers.length >= 2, 'glowing embers in the firepit');
    const stones = MOUNTAIN.spheres.filter((b) => b.material === 'rock' && Math.hypot(b.x, b.z - s * 20) < 1);
    assert.ok(stones.length >= 8, 'a ring of stones');
    const crates = MOUNTAIN.boxes.filter((b) => b.material === 'crate' && Math.sign(b.z) === s && Math.abs(b.z) > 15);
    assert.equal(crates.length, 4);
    // The flag pole rises above the cliff behind the camp.
    assert.ok(MOUNTAIN.furnishingCylinders.some((c) => Math.abs(c.z - s * 23.1) < 0.2 && c.y + c.h / 2 > 5.4));
  }
});
