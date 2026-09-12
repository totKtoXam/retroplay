import { test } from 'node:test';
import assert from 'node:assert/strict';
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
