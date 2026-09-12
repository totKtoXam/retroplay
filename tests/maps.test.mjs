import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAP_IDS, getMap } from '../lib/maps/index.ts';
import { buildArena, perimeterWalls, stanceHeight } from '../lib/maps/types.ts';
import { isBlocked3D } from '../lib/world-collision.ts';
import { applyOperation, initialState } from '../lib/model.ts';
import { reachable } from './map-helpers.mjs';

test('unknown map ids fall back to the hub', () => {
  assert.equal(getMap(undefined).id, 'hub');
  assert.equal(getMap('nope').id, 'hub');
  assert.equal(getMap('mansion').id, 'mansion');
});

test('every spawn point is inside its map, on the ground and not inside a wall', () => {
  for (const id of MAP_IDS) {
    const map = getMap(id);
    for (const team of ['red', 'blue']) {
      assert.ok(map.spawns[team].length > 0, `${id}: ${team} has spawns`);
      for (const s of map.spawns[team]) {
        const y = s.y ?? 0;
        const where = `${id} ${team} (${s.x}, ${s.z})`;
        assert.ok(s.x > map.bounds.minX && s.x < map.bounds.maxX && s.z > map.bounds.minZ && s.z < map.bounds.maxZ, where);
        assert.ok(Math.abs(map.groundHeight(s.x, s.z, y + 0.5) - y) < 0.05, `${where}: ground`);
        assert.equal(isBlocked3D(s.x, s.z, y, 0.4, 1.8, map.colliders), false, `${where}: blocked`);
      }
    }
  }
});

// A wall with a 1.3 m high hole: standing (1.8) is blocked, crouching (1.2) and lying (0.6) pass.
const crawl = buildArena({
  id: 't',
  title: 't',
  bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
  groundColor: '#000',
  boxes: [
    ...perimeterWalls({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }),
    // The wall spans the whole arena (inner edges of the perimeter at ±9.4).
    { x: -5.2, y: 2, z: 0, w: 8.4, h: 4, d: 0.4, color: '#000', solid: true },
    { x: 5.2, y: 2, z: 0, w: 8.4, h: 4, d: 0.4, color: '#000', solid: true },
    { x: 0, y: 2.65, z: 0, w: 2, h: 2.7, d: 0.4, color: '#000', solid: true },
    { x: 6, y: 3.5, z: 6, w: 4, h: 0.2, d: 4, color: '#000', floor: true },
  ],
  ramps: [{ minX: -8, maxX: -6, minZ: 2, maxZ: 8, axis: 'z', from: 2, to: 8, y0: 0, y1: 3, color: '#000' }],
  spawns: { red: [{ x: 0, z: -5 }], blue: [{ x: 0, z: 5 }] },
});

test('a low hole lets through crouching and lying players only', () => {
  const blocked = (stance) => isBlocked3D(0, 0, 0, 0.32, stanceHeight(stance), crawl.colliders);
  assert.deepEqual([blocked('stand'), blocked('sit'), blocked('lie')], [true, false, false]);
  assert.ok(Math.abs(crawl.ceilingHeight(0, 0, 0) - 1.3) < 1e-9);
});

test('reachable() follows the hub: plaza to the campus hall and up its stairs', () => {
  const hub = getMap('hub');
  assert.equal(reachable(hub, { x: 0, z: 4 }, { x: 0, z: -18, y: 0.2 }), true, 'through the front door');
  assert.equal(reachable(hub, { x: 0, z: 4 }, { x: 2, z: -18, y: 3.6 }), true, 'up the stairs');
  assert.equal(reachable(crawl, { x: 0, z: -5 }, { x: 0, z: 5 }, 'stand'), false, 'wall with a low hole');
  assert.equal(reachable(crawl, { x: 0, z: -5 }, { x: 0, z: 5 }, 'sit'), true, 'crouching through it');
});

test('the host picks the map; unknown ids are rejected', () => {
  let s = initialState('Retro');
  for (const map of MAP_IDS) {
    s = applyOperation(s, { type: 'room.settings', patch: { map } }, 'host', 'host');
    assert.equal(s.map, map);
  }
  assert.throws(() => applyOperation(s, { type: 'room.settings', patch: { map: 'dust2' } }, 'host', 'host'));
  assert.throws(() => applyOperation(s, { type: 'room.settings', patch: { map: 'hub' } }, 'guest', 'host'));
});

test('floor slabs are ground from above and ceiling from below; ramps interpolate', () => {
  assert.equal(crawl.groundHeight(6, 6, 3.6), 3.6);
  assert.equal(crawl.groundHeight(6, 6, 0), 0);
  assert.equal(crawl.ceilingHeight(6, 6, 0), 3.4);
  assert.equal(crawl.groundHeight(-7, 5, 1.5), 1.5);
  assert.equal(crawl.groundHeight(-7, 8, 3), 3);
});
