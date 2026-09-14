import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldPlayer } from '../components/world-player.ts';
import { buildArena, perimeterWalls } from '../lib/maps/types.ts';

/**
 * A flat 20 x 20 arena with a ramp, a low crate and a wall with a 1.3 m crawl hole.
 * Note how the engine treats them: a ramp (or a floor slab) is walked up, while a solid
 * box stops you — the body touches it before its centre reaches the footprint, so a crate
 * has to be jumped onto. Maps are built with that in mind (lib/maps).
 */
const map = buildArena({
  id: 'test',
  title: 'test',
  bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
  groundColor: '#000',
  boxes: [
    ...perimeterWalls({ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }),
    // Knee-high crate at x 3..5, z -1..1.
    { x: 4, y: 0.2, z: 0, w: 2, h: 0.4, color: '#000', d: 2, solid: true },
    // Wall across x 5..10 at z 3, with the hole left open at x 4..5.
    { x: 7.5, y: 2, z: 3, w: 5, h: 4, d: 0.4, color: '#000', solid: true },
    // Lintel over the hole: open from 0 to 1.3 m.
    { x: 4.5, y: 2.65, z: 3, w: 1, h: 2.7, d: 0.4, color: '#000', solid: true },
  ],
  // Ramp up to 1.5 m along -z at x -8..-6.
  ramps: [
    { minX: -8, maxX: -6, minZ: -8, maxZ: -2, axis: 'z', from: -2, to: -8, y0: 0, y1: 1.5, color: '#000' },
  ],
  spawns: { red: [{ x: 0, z: 8 }], blue: [{ x: 0, z: -8 }] },
});

const player = (over = {}) => {
  const keys = new Set();
  const stances = [];
  const p = createWorldPlayer({
    map,
    keys,
    initial: { x: 0, y: 0, z: 0, yaw: 0, stance: 'stand', moving: false },
    isDead: () => false,
    onStance: (s) => stances.push(s),
    ...over,
  });
  /** `frames` frames of 1/60 s, moving with whatever keys are held. */
  const run = (frames, input = {}) => {
    let last;
    for (let i = 0; i < frames; i++)
      last = p.update(1 / 60, { control: true, aimHeld: false, ...input });
    return last;
  };
  return { p, keys, stances, run };
};

test('walking: W runs forward at 4.8 m/s and the perimeter stops it', () => {
  const { p, keys, run } = player();
  keys.add('KeyW'); // yaw 0: forward is -z
  const out = run(30);
  assert.deepEqual([out.moving, out.speed], [true, 4.8]);
  assert.ok(Math.abs(p.pos.z + 2.4) < 0.01, `half a second of running: ${p.pos.z.toFixed(2)}`);
  assert.ok(Math.abs(p.pos.x) < 1e-9, 'no sideways drift');
  run(600);
  assert.ok(p.pos.z > -9.7, `stopped at the wall: ${p.pos.z.toFixed(2)}`);
});

test('walking: Shift walks, aiming slows down, crouching and lying are slower still', () => {
  const { p, keys, run } = player();
  keys.add('KeyW');
  assert.equal(run(1).speed, 4.8);
  assert.equal(run(1, { aimHeld: true }).speed, 3);
  keys.add('ShiftLeft');
  assert.equal(run(1).speed, 2);
  keys.delete('ShiftLeft');
  p.holdCrouch();
  assert.equal(run(1).speed, 1.5);
  p.releaseCrouch();
  p.toggleStance(1000);
  p.toggleStance(1200); // second press inside 360 ms: lie down
  assert.equal(run(1).speed, 0.65);
});

test('a ramp is walked up, a knee-high crate is not — but can be jumped onto', () => {
  const { p, keys, run } = player();
  p.teleport(-7, 0, -1);
  keys.add('KeyW');
  run(90);
  assert.ok(p.pos.y > 1.2, `climbed the ramp: ${p.pos.y.toFixed(2)}`);
  keys.delete('KeyW');

  const crate = player();
  crate.p.teleport(1.5, 0, 0);
  crate.keys.add('KeyD'); // towards +x, into the crate
  crate.run(60);
  assert.ok(crate.p.pos.x < 2.7, `stopped in front of the crate: ${crate.p.pos.x.toFixed(2)}`);
  assert.equal(crate.p.pos.y, 0);
  crate.p.jump();
  crate.run(20); // rise and step over the edge…
  crate.keys.delete('KeyD');
  crate.run(80); // …then land on top instead of running past it
  assert.ok(Math.abs(crate.p.pos.y - 0.4) < 0.01, `landed on the crate: ${crate.p.pos.y.toFixed(2)}`);
});

test('gravity: a jump rises and lands back on the ground', () => {
  const { p, run } = player();
  p.jump();
  run(6);
  assert.ok(p.pos.y > 0.3, `off the ground: ${p.pos.y.toFixed(2)}`);
  run(120);
  assert.equal(p.pos.y, 0, 'landed');
});

test('stances: the HUD sees every change and nobody stands up inside a crawl hole', () => {
  const { p, stances } = player();
  p.holdCrouch();
  assert.equal(p.stance, 'sit');
  p.releaseCrouch();
  assert.equal(p.stance, 'stand');
  p.toggleStance(1000);
  p.toggleStance(1200);
  assert.equal(p.stance, 'lie');
  assert.deepEqual(stances, ['sit', 'stand', 'sit', 'lie']);
  p.teleport(4.5, 0, 3); // inside the hole
  assert.deepEqual([p.canStand('stand'), p.canStand('sit'), p.canStand('lie')], [false, true, true]);
  p.holdCrouch();
  p.releaseCrouch();
  assert.equal(p.stance, 'sit', 'stayed crouched under the lintel');
});

test('the crawl hole lets a crouching player through and stops a standing one', () => {
  const cross = (crouch) => {
    const { p, keys, run } = player();
    p.teleport(4.5, 0, 1.5);
    if (crouch) p.holdCrouch();
    keys.add('KeyS'); // +z: towards the wall and through the hole
    run(120);
    return p.pos.z;
  };
  assert.ok(cross(false) < 2.7, 'standing: stopped in front of the wall');
  assert.ok(cross(true) > 3.3, 'crouching: came out on the other side');
});

test('teleport resets the fall and the stance', () => {
  const { p, run } = player();
  p.jump();
  run(3);
  p.teleport(-5, 0, -5);
  assert.deepEqual([p.pos.x, p.pos.y, p.pos.z, p.stance, p.vy], [-5, 0, -5, 'stand', 0]);
});
