import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMap } from '../lib/maps/index.ts';
import { rampHeight } from '../lib/maps/types.ts';
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

test('bazaar: textured and furnished — sand outside, real floors inside, spawns and doors clear', async () => {
  const { footstepSurface } = await import('../lib/footsteps.ts');
  const arena = bazaar.arena;
  const surface = (p) => footstepSurface({ map: bazaar, season: 'summer', sheltered: false, rain: 0, snow: 0 }, p.x, p.y ?? 0.03, p.z);
  // Sand in the lanes; tiles, rugs and boards in the hall; paving and planks by the river.
  assert.equal(arena.groundMaterial, 'sand');
  assert.equal(surface({ x: -20, z: -3, y: 0 }), 'gravel', 'open ground is sand');
  for (const p of [HALL_GROUND, { x: -5, z: 4.1 }, { x: 5, z: -4.1 }, { x: 8, z: 0 }, { x: -2, z: 0 }])
    assert.notEqual(surface(p), 'gravel', `the hall has a floor at (${p.x}, ${p.z})`);
  assert.equal(surface({ x: -5, z: 4.1 }), 'tile', 'fired-brick tiles');
  assert.equal(surface(HALL_GROUND), 'carpet', 'the runner from the north door');
  assert.equal(surface(HALL_UPPER), 'carpet', 'a rug on the balcony');
  assert.equal(surface({ x: 6, z: -1.5, y: 3.6 }), 'wood', 'balcony boards');
  assert.equal(surface(EMBANKMENT), 'stone', 'the paved embankment');
  assert.equal(surface({ x: 0, z: 10, y: 0.45 }), 'wood', 'the bridge deck');
  // Every solid box that is drawn has a surface; the kit is there, within the draw-call budget.
  const untextured = arena.boxes.filter((b) => b.solid && !b.invisible && !b.material);
  assert.deepEqual(untextured, [], 'untextured solid boxes');
  assert.ok(arena.boxes.every((b) => !b.floor || b.material), 'textured floor slabs');
  assert.ok(arena.furnishings.length > 300 && arena.furnishingCylinders.length > 300, 'furnished');
  assert.ok(arena.boxes.length < 500, `boxes: ${arena.boxes.length}`);
  const pairs = new Set(
    [...arena.boxes.filter((b) => !b.invisible), ...arena.furnishings, ...arena.cylinders, ...arena.furnishingCylinders, ...arena.spheres].map(
      (o) => `${o.color}|${o.material ?? ''}|${o.glow ?? ''}`,
    ),
  );
  assert.ok(pairs.size <= 150, `distinct colour/material pairs: ${pairs.size}`);
  // The stair ramp is a flight of stone steps; the yurts keep their felt collider.
  const [stairs] = arena.ramps;
  assert.ok(stairs.steps >= 16 && stairs.material === 'ashlar');
  const yurts = arena.cylinders.filter((c) => c.solid && c.r === 2);
  assert.deepEqual(
    yurts.map((c) => [c.x, c.z, c.h, c.material]),
    [
      [-16, 0, 2.2, 'felt'],
      [16, 0, 2.2, 'felt'],
    ],
  );
  // Spawns stay free, and the north, south and east doorways still let a standing player
  // straight in (the west one opens onto the stone under the ramp, as it always has).
  for (const s of [...blue, ...red]) assert.equal(isBlocked3D(s.x, s.z, 0, 0.4, 1.8, bazaar.colliders), false, `spawn (${s.x}, ${s.z})`);
  for (const [outside, inside] of [
    [{ x: 0, z: -6.5 }, { x: 0, z: -3.5 }],
    [{ x: 0, z: 6.5 }, { x: 0, z: 3.5 }],
    [{ x: 12, z: 0 }, { x: 8, z: 0 }],
  ])
    assert.equal(reachable(bazaar, outside, inside), true, `straight in from (${outside.x}, ${outside.z})`);
  // The tea-house topchan is low enough to step onto; its carpet sounds soft.
  assert.equal(bazaar.groundHeight(8.4, 4.4, 0.45), 0.45);
  assert.equal(reachable(bazaar, blue[0], { x: 8.4, z: 4.4, y: 0.45 }), true, 'onto the topchan');
  assert.equal(surface({ x: 8.4, z: 4.4, y: 0.47 }), 'carpet');
});

test('bazaar: decor never floats in a walkway, and every lamp light has a lantern or a fire', () => {
  const arena = bazaar.arena;
  const floors = arena.boxes.filter((b) => b.floor);
  /** Walking surface under (x, z) at or below `y`: ground, slabs and the ramp — not furniture. */
  const walk = (x, z, y) => {
    let top = 0;
    for (const b of floors)
      if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2 && b.y + b.h / 2 <= y + 0.05) top = Math.max(top, b.y + b.h / 2);
    for (const r of arena.ramps)
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ && rampHeight(r, x, z) <= y + 0.05) top = Math.max(top, rampHeight(r, x, z));
    return top;
  };
  const extent = (o) => {
    const r = Math.max(o.r ?? 0, o.rTop ?? 0);
    if (o.r === undefined) return { minX: o.x - o.w / 2, maxX: o.x + o.w / 2, minY: o.y - o.h / 2, maxY: o.y + o.h / 2, minZ: o.z - o.d / 2, maxZ: o.z + o.d / 2 };
    if (o.h === undefined) return { minX: o.x - r, maxX: o.x + r, minY: o.y - r, maxY: o.y + r, minZ: o.z - r, maxZ: o.z + r };
    const hx = o.axis === 'x' ? o.h / 2 : r,
      hz = o.axis === 'z' ? o.h / 2 : r,
      hy = o.axis ? r : o.h / 2;
    return { minX: o.x - hx, maxX: o.x + hx, minY: o.y - hy, maxY: o.y + hy, minZ: o.z - hz, maxZ: o.z + hz };
  };
  // Tilted pieces (handrail, tripod, straps, the boat's bow) are checked by eye.
  const decor = [...arena.furnishings.filter((b) => !b.rot), ...arena.furnishingCylinders, ...arena.spheres].map(extent);
  const water = (x, z) => arena.water.some((w) => x > w.minX && x < w.maxX && z > w.minZ && z < w.maxZ);
  const floating = [];
  for (const d of decor) {
    const x = (d.minX + d.maxX) / 2,
      z = (d.minZ + d.maxZ) / 2,
      ground = walk(x, z, d.minY);
    if (d.maxY - ground <= 0.1 || d.minY - ground >= 2.1 || (ground < 0.3 && water(x, z))) continue;
    // At body height it must stand on, hang off or lean against something solid.
    const held = bazaar.colliders.some(
      (c) =>
        d.maxX > c.minX - 0.36 && d.minX < c.maxX + 0.36 && d.maxZ > c.minZ - 0.36 && d.minZ < c.maxZ + 0.36 &&
        c.maxY >= Math.max(ground + 0.1, d.minY - 1.1) && c.minY <= d.maxY,
    );
    if (!held) floating.push(`(${x.toFixed(2)}, ${d.minY.toFixed(2)}..${d.maxY.toFixed(2)}, ${z.toFixed(2)})`);
  }
  assert.deepEqual(floating, [], 'decor floating at body height');
  // Nothing drawn inside the doorway openings of the hall (casings may touch their edges).
  const doorways = [
    { minX: -1, maxX: 1, minZ: -5.2, maxZ: -4.8 },
    { minX: -1, maxX: 1, minZ: 4.8, maxZ: 5.2 },
    { minX: -10.2, maxX: -9.8, minZ: -1, maxZ: 1 },
    { minX: 9.8, maxX: 10.2, minZ: -1, maxZ: 1 },
  ];
  const e = 0.01;
  const inDoorway = decor.filter(
    (d) =>
      d.maxY > 0.1 &&
      d.minY < 2.0 &&
      doorways.some((w) => d.maxX > w.minX + e && d.minX < w.maxX - e && d.maxZ > w.minZ + e && d.minZ < w.maxZ - e),
  );
  assert.deepEqual(inDoorway, []);
  // Lights: a reasonable number, each at a lantern's glass or a fire.
  const glowing = [...arena.furnishings, ...arena.furnishingCylinders].filter((o) => o.glow);
  assert.ok(arena.lights.length >= 12 && arena.lights.length <= 30, `lights: ${arena.lights.length}`);
  for (const l of arena.lights)
    assert.ok(
      glowing.some((g) => Math.hypot(g.x - l.x, g.y - l.y, g.z - l.z) < 1.2),
      `light at (${l.x}, ${l.y}, ${l.z}) has no lantern`,
    );
});
