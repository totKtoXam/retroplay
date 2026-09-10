import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getGroundHeight,
  getCeilingHeight,
  isBlocked3D,
  ALL_3D_COLLIDERS,
  CAMPUS_WALL_COLLIDERS,
} from '../lib/world-collision.ts';

test('Ground height returns 0 on open terrain', () => {
  assert.equal(getGroundHeight(0, 0, 0), 0);
  assert.equal(getGroundHeight(15, -15, 0), 0);
  assert.equal(getGroundHeight(-15, 15, 0), 0);
});

test('Bridge over the pond has elevated walkable height', () => {
  const bridgeY = getGroundHeight(-19, 2, 0);
  assert.equal(bridgeY, 0.43);
});

test('Station platforms have elevated walkable height', () => {
  const stationY = getGroundHeight(9, 9, 0);
  assert.equal(stationY, 0.28);
  const station2Y = getGroundHeight(-9, -6, 0);
  assert.equal(station2Y, 0.28);
});

test('Campus building 1st floor slab has ground height 0.2', () => {
  const floor1Y = getGroundHeight(0, -18, 0);
  assert.equal(floor1Y, 0.2);
});

test('Stairs step up smoothly from 0.6m to 3.6m', () => {
  // Stair is along west wall: x in [-4.2, -2.6], z from -15.2 to -20.8
  const step0 = getGroundHeight(-3.4, -15.5, 0.5);
  assert.equal(step0, 0.6);

  const stepMiddle = getGroundHeight(-3.4, -17.9, 1.8);
  assert.equal(stepMiddle, 2.1);

  const stepTop = getGroundHeight(-3.4, -20.5, 3.2);
  assert.equal(stepTop, 3.6);
});

test('Campus building 2nd floor has floor height 3.6', () => {
  const floor2Y = getGroundHeight(0, -18, 3.6);
  assert.equal(floor2Y, 3.6);

  // Balcony front area on 2nd floor
  const balconyY = getGroundHeight(2, -14.5, 3.6);
  assert.equal(balconyY, 3.6);
});

test('Entrance canopy roof is walkable at height 2.7', () => {
  const canopyY = getGroundHeight(0, -13.0, 2.5);
  assert.equal(canopyY, 2.7);
});

test('Entrance doorway is completely open and unblocked', () => {
  // Center of entrance door: x = 0, z = -13.5, y = 0.2 (floor 1 level)
  const blocked = isBlocked3D(0, -13.5, 0.2);
  assert.equal(blocked, false, 'Doorway center must be unblocked');

  // Walking through entrance from outside (z = -13.0) to inside (z = -14.0)
  for (let z = -12.5; z >= -14.5; z -= 0.2) {
    assert.equal(isBlocked3D(0, z, 0.2), false, `Path at z=${z} must be clear`);
  }
});

test('Walls block horizontal passage', () => {
  // South wall solid left side: x = -3.0, z = -13.5
  assert.equal(isBlocked3D(-3.0, -13.5, 0.2), true);
  // South wall solid right side: x = 3.0, z = -13.5
  assert.equal(isBlocked3D(3.0, -13.5, 0.2), true);
  // West wall solid corner: x = -4.5, z = -14.5
  assert.equal(isBlocked3D(-4.5, -14.5, 0.2), true);
  // East wall solid corner: x = 4.5, z = -14.5
  assert.equal(isBlocked3D(4.5, -14.5, 0.2), true);
});

test('Windows have open apertures between sills and lintels', () => {
  // Window NW on North wall: x = -2.1, z = -22.5
  // Sill is at y: [0, 0.95]. Standing on floor (y = 0.2) is blocked by sill.
  assert.equal(isBlocked3D(-2.1, -22.5, 0.2, 0.25, 1.2), true);

  // When jumping/vaulting at window opening (e.g. crouched or jump height y = 1.0, player height = 1.3):
  // feet at 1.0 + 0.35 = 1.35 > 0.95 sill, head at 1.0 + 1.25 = 2.25 < 2.5 lintel
  assert.equal(isBlocked3D(-2.1, -22.5, 1.0, 0.25, 1.3), false, 'Window opening must allow jumping through');
});

test('Ceiling heights correctly constrain vertical position', () => {
  // Floor 1 ceiling
  assert.equal(getCeilingHeight(0, -18, 0.2), 3.5);
  // Floor 2 ceiling
  assert.equal(getCeilingHeight(0, -18, 3.6), 6.8);
  // Outside: no ceiling
  assert.equal(getCeilingHeight(0, 0, 0), Number.POSITIVE_INFINITY);
});
