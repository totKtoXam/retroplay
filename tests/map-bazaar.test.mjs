import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMap } from '../lib/maps/index.ts';
import { isBlocked3D } from '../lib/world-collision.ts';
import { reachable } from './map-helpers.mjs';

const bazaar = getMap('bazaar');
const blue = bazaar.spawns.blue;
const red = bazaar.spawns.red;

// Landmarks of the three lanes (see lib/maps/bazaar.ts).
const NORTH_WEST_ROW = { x: -12, z: -13 };
const NORTH_EAST_ROW = { x: 12, z: -13 };
const HALL_GROUND = { x: 0, z: -3.5 };
const HALL_UPPER = { x: 2, z: 0, y: 3.6 };
const EMBANKMENT = { x: 0, z: 7.5 };
const EMBANKMENT_EAST = { x: 22, z: 8.5 };
const BRIDGE = { x: 0, z: 13, y: 0.45 };
const PIER = { x: 0, z: 18.5, y: 0.45 };
const RIVER_EAST = { x: 8, z: 13 };
const RIVER_WEST = { x: -8, z: 13 };
const ROOF = { x: 0, z: 0, y: 6.2 };

test('bazaar: identity, size and spawn count', () => {
  assert.equal(bazaar.id, 'bazaar');
  assert.equal(bazaar.title, 'Базар');
  assert.deepEqual(bazaar.bounds, { minX: -30, maxX: 30, minZ: -20, maxZ: 20 });
  assert.ok(bazaar.arena.boxes.length < 500, `boxes: ${bazaar.arena.boxes.length}`);
  assert.ok(blue.length >= 6 && red.length >= 6);
  for (const s of [...blue, ...red]) {
    assert.ok(Math.abs(s.x) <= 36 && Math.abs(s.z) <= 36);
    assert.equal(bazaar.groundHeight(s.x, s.z, 0.5), 0, `spawn (${s.x}, ${s.z}) stands on the ground`);
    assert.equal(isBlocked3D(s.x, s.z, 0, 0.4, 1.8, bazaar.colliders), false, `spawn (${s.x}, ${s.z}) is free`);
  }
  // The camps face each other across the map.
  assert.ok(blue.every((s) => s.x <= -21 && s.x >= -29 && Math.abs(s.z) <= 6));
  assert.ok(red.every((s) => s.x >= 21 && s.x <= 29 && Math.abs(s.z) <= 6));
});

test('bazaar: every blue spawn reaches every red spawn standing', () => {
  for (const b of blue)
    for (const r of red)
      assert.equal(reachable(bazaar, b, r), true, `blue (${b.x}, ${b.z}) -> red (${r.x}, ${r.z})`);
  for (const r of red) assert.equal(reachable(bazaar, r, blue[0]), true, `red (${r.x}, ${r.z}) -> blue`);
});

test('bazaar: all three lanes are passable from both camps', () => {
  for (const { name, at } of [
    { name: 'north row (west)', at: NORTH_WEST_ROW },
    { name: 'north row (east)', at: NORTH_EAST_ROW },
    { name: 'covered market', at: HALL_GROUND },
    { name: 'embankment', at: EMBANKMENT },
    { name: 'embankment (east)', at: EMBANKMENT_EAST },
  ]) {
    assert.equal(reachable(bazaar, blue[0], at), true, `blue -> ${name}`);
    assert.equal(reachable(bazaar, red[0], at), true, `red -> ${name}`);
  }
});

test('bazaar: the market balcony at 3.6 is reachable from both camps', () => {
  assert.equal(bazaar.groundHeight(HALL_UPPER.x, HALL_UPPER.z, 3.6), 3.6, 'the slab is walkable');
  assert.ok(bazaar.ceilingHeight(HALL_UPPER.x, HALL_UPPER.z, 3.6) >= 5.5, 'head room under the roof');
  assert.ok(bazaar.ceilingHeight(0, 0, 0) >= 3.4, 'head room under the balcony');
  assert.equal(reachable(bazaar, blue[0], HALL_UPPER), true, 'blue up the stair ramp');
  assert.equal(reachable(bazaar, red[0], HALL_UPPER), true, 'red up the stair ramp');
  assert.equal(reachable(bazaar, blue[0], ROOF), false, 'the roof stays out of reach');
  // The stepped stone under the ramp: no walking through the slope.
  assert.equal(isBlocked3D(-8.5, 0, 0, 0.32, 1.8, bazaar.colliders), true, 'under the ramp');
  assert.ok(bazaar.groundHeight(-8.5, 0, 2.1) > 2, 'the ramp carries you at its mid point');
});

test('bazaar: the pier is reachable over the bridge and the river is not wadeable', () => {
  assert.equal(reachable(bazaar, blue[0], BRIDGE), true, 'onto the bridge');
  assert.equal(reachable(bazaar, blue[0], PIER), true, 'blue -> pier');
  assert.equal(reachable(bazaar, red[0], PIER), true, 'red -> pier');
  assert.equal(reachable(bazaar, blue[0], RIVER_EAST), false, 'no wading east of the bridge');
  assert.equal(reachable(bazaar, blue[0], RIVER_WEST), false, 'no wading west of the bridge');
  assert.equal(reachable(bazaar, red[0], RIVER_EAST), false, 'no wading from the red side');
  // The banks are the thing that keeps players out: 1.2 m is above the 0.55 m step.
  assert.equal(isBlocked3D(8, 10, 0, 0.32, 1.8, bazaar.colliders), true, 'north bank');
  assert.equal(isBlocked3D(8, 16, 0, 0.32, 1.8, bazaar.colliders), true, 'south bank');
  // Water is decoration only; it must sit below the bridge deck.
  const water = bazaar.arena.water[0];
  assert.ok(water.y < 0.45 && water.minZ <= 10 && water.maxZ >= 16);
});

test('bazaar: the doorways of the covered market are wide and high enough', () => {
  // Doors are centred on each side; standing players fit through all four.
  for (const [inside, outside] of [
    [{ x: 0, z: -3.5 }, { x: 0, z: -6.5 }],
    [{ x: 0, z: 3.5 }, { x: 0, z: 6.5 }],
    [{ x: -4, z: 0 }, { x: -12, z: 0 }],
    [{ x: 8, z: 0 }, { x: 12, z: 0 }],
  ]) {
    assert.equal(reachable(bazaar, outside, inside), true, `door at (${outside.x}, ${outside.z})`);
  }
});
