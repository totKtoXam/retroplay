import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getMap } from '../lib/maps/index.ts';
import { stanceHeight } from '../lib/maps/types.ts';
import { isBlocked3D } from '../lib/world-collision.ts';
import { reachable } from './map-helpers.mjs';

const map = getMap('mansion');
const arena = map.arena;

// Landmarks of the blueprint (see lib/maps/mansion.ts).
const HOLE = { x: 26, z: 20.8 }; // crawl hole in the east compound wall, by the guard hut
const BY_THE_HUT = { x: 24, z: 20.8 }; // just inside the wall, in the south garden
const IN_CORRIDOR = { x: 28, z: 20.8 }; // the blue "спецназ" corridor, past the hole
const DARK_CORRIDOR = { x: -16, z: -9.5, y: 3.6 }; // second floor, no lights at all
const BALCONY = { x: -5, z: 0, y: 3.6 }; // over the veranda, 1 m parapet
const TUNNEL_MID = { x: 0, z: -22.5 }; // inside the roofed service tunnel
const BACKYARD = { x: -28.5, z: -14 }; // behind the house, by the west back door

test('the mansion is a declarative arena of a sane size', () => {
  assert.equal(map.id, 'mansion');
  assert.equal(map.title, 'Особняк');
  assert.ok(arena, 'built from an ArenaDef');
  assert.ok(arena.boxes.length < 500, `boxes: ${arena.boxes.length}`);
  assert.ok(map.spawns.red.length >= 6 && map.spawns.blue.length >= 6);
  // Red spawns sit in the three ground-floor rooms of the west wing.
  for (const s of map.spawns.red) {
    assert.ok(s.x > -26 && s.x < -14.3 && s.z > -16.6 && s.z < 12, `red spawn in the west wing: ${s.x}, ${s.z}`);
  }
  // Blue spawns sit in the corridor beyond the east compound wall.
  for (const s of map.spawns.blue) assert.ok(s.x > 26.3 && s.x < 31.4, `blue spawn in the corridor: ${s.x}`);
});

test('every red spawn reaches the blue corridor, and every blue spawn is reachable', () => {
  // Two representative targets per red spawn (north and south ends of the corridor)...
  for (const red of map.spawns.red)
    for (const blue of [map.spawns.blue[0], map.spawns.blue.at(-1)])
      assert.equal(reachable(map, red, blue), true, `red (${red.x}, ${red.z}) -> blue (${blue.x}, ${blue.z})`);
  // ...and every blue spawn from one red spawn in each of the three rooms.
  for (const red of [map.spawns.red[0], map.spawns.red[3], map.spawns.red[5]])
    for (const blue of map.spawns.blue)
      assert.equal(reachable(map, red, blue), true, `red (${red.x}, ${red.z}) -> blue (${blue.x}, ${blue.z})`);
});

test('the stairs lead to the dark second-floor corridor and on to the balcony', () => {
  const red = map.spawns.red[0];
  assert.equal(reachable(map, red, DARK_CORRIDOR), true, 'up the stairs into the corridor');
  assert.equal(reachable(map, red, BALCONY), true, 'gallery door onto the balcony');
  assert.equal(reachable(map, red, { x: -20, z: -14.4, y: 3.6 }), true, 'the room above the north room');
  // It really is a second floor: the slab is ground from above and a ceiling from below.
  assert.equal(map.groundHeight(DARK_CORRIDOR.x, DARK_CORRIDOR.z, 3.6), 3.6);
  assert.equal(map.groundHeight(DARK_CORRIDOR.x, DARK_CORRIDOR.z, 0), 0);
  assert.equal(map.ceilingHeight(BALCONY.x, BALCONY.z, 0), 3.4);
  // No light anywhere in the corridor volume.
  for (const l of arena.lights ?? [])
    assert.ok(
      !(l.x > -18 && l.x < -14.3 && l.z > -12.3 && l.z < -7 && l.y > 3.6 && l.y < 6.4),
      `light inside the dark corridor: ${l.x}, ${l.y}, ${l.z}`,
    );
});

test('the crawl hole by the guard hut only lets crouching and lying players through', () => {
  const blocked = (stance) => isBlocked3D(HOLE.x, HOLE.z, 0, 0.32, stanceHeight(stance), map.colliders);
  assert.deepEqual([blocked('stand'), blocked('sit'), blocked('lie')], [true, false, false]);
  assert.ok(Math.abs(map.ceilingHeight(HOLE.x, HOLE.z, 0) - 1.3) < 1e-9, 'a 1.3 m lintel');
  assert.equal(reachable(map, BY_THE_HUT, IN_CORRIDOR, 'sit'), true, 'crouching through the hole');
  assert.equal(reachable(map, BY_THE_HUT, IN_CORRIDOR, 'lie'), true, 'lying through the hole');
  // The gate is the only standing route, so a standing player has to walk all the way round.
  assert.equal(reachable(map, BY_THE_HUT, IN_CORRIDOR, 'stand'), true, 'the long way, through the gate');
});

test('the service tunnel links the blue corridor to the yard behind the house', () => {
  assert.equal(reachable(map, map.spawns.blue[0], TUNNEL_MID), true, 'blue corridor into the tunnel');
  assert.equal(reachable(map, TUNNEL_MID, BACKYARD), true, 'tunnel out behind the house');
  assert.equal(reachable(map, TUNNEL_MID, { x: 20, z: -10 }), true, 'side opening into the north-east yard');
  // It is a tunnel, not an alley: roofed at 2.2 m and walled off from the garden.
  assert.equal(map.ceilingHeight(TUNNEL_MID.x, TUNNEL_MID.z, 0), 2.0);
  assert.equal(isBlocked3D(0, -21.8, 0, 0.32, 1.8, map.colliders), true, 'its south wall');
  assert.equal(map.groundHeight(TUNNEL_MID.x, TUNNEL_MID.z, 0), 0, 'the tunnel floor is the ground');
});
