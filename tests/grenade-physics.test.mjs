import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aimGrenadeAt, grenadeAt, simulateGrenade } from '../lib/grenade-physics.ts';
import { effectDamage, GRENADE_BLAST_RADIUS } from '../lib/game-items.ts';
import { getMap } from '../lib/maps/index.ts';

const flat = { colliders: [], groundHeight: () => 0 };
const wall = (z) => ({ minX: -5, maxX: 5, minY: 0, maxY: 4, minZ: z - 0.2, maxZ: z + 0.2 });

test('a grenade falls under gravity and comes to rest on the floor', () => {
  const f = simulateGrenade([0, 1.5, 0], [0, 1.5, -10], flat);
  const top = Math.max(...f.path.map((p) => p[1]));
  assert.ok(top > 1.5 && top < 3, `a flat throw arcs a little above the hand, top ${top}`);
  assert.ok(Math.abs(f.end[1] - 0.08) < 1e-9, 'lies on the floor at the end of the fuse');
  assert.ok(f.end[2] < -8, 'thrown forward');
  assert.ok(f.bounces.length >= 1, 'hitting the floor is heard');
});

test('a grenade bounces off a wall instead of passing through it', () => {
  const world = { colliders: [wall(-4)], groundHeight: () => 0 };
  const f = simulateGrenade([0, 1.5, 0], [0, 1.5, -10], world);
  for (const p of f.path) assert.ok(p[2] > -3.8, `never inside or behind the wall, z ${p[2]}`);
  assert.ok(f.end[2] > -3, 'rebounds back towards the thrower');
});

test('a grenade does not fly through a ceiling', () => {
  const world = { colliders: [], groundHeight: () => 0, ceilingHeight: () => 2.6 };
  const f = simulateGrenade([0, 1.5, 0], [0, 11.5, -5], world);
  for (const p of f.path) assert.ok(p[1] <= 2.6, `under the ceiling, y ${p[1]}`);
});

test('the same throw gives the same blast point: server and clients agree', () => {
  const map = getMap('mansion');
  const a = simulateGrenade([1, 1.5, 2], [3, 2, -9], map);
  const b = simulateGrenade([1, 1.5, 2], [3, 2, -9], map);
  assert.deepEqual(a, b);
});

test('the flight is sampled over the whole fuse and interpolated', () => {
  const f = simulateGrenade([0, 1.5, 0], [0, 1.5, -10], flat);
  assert.deepEqual(grenadeAt(f, 0), [0, 1.5, 0]);
  assert.deepEqual(grenadeAt(f, 1e6), f.end);
});

test('bots find the throw that lands the grenade where they want', () => {
  for (const d of [5, 10, 15]) {
    const aim = aimGrenadeAt([0, 1.5, 0], [0, 0, -d]);
    const { end } = simulateGrenade([0, 1.5, 0], aim, flat);
    assert.ok(Math.abs(-end[2] - d) < 0.6, `wanted ${d} m, got ${-end[2]}`);
  }
});

test('blast damage falls off with distance from the explosion', () => {
  assert.equal(effectDamage('grenade', 0), 80);
  assert.equal(effectDamage('grenade', GRENADE_BLAST_RADIUS), 15);
  assert.ok(effectDamage('grenade', 1) > effectDamage('grenade', 3));
});
