import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FLOOR_H,
  ROOF_H,
  PROC_BUILDING_STYLES,
  mulberry32,
  parseProcBuilding,
  procBuildingBase,
  procBuildingHeight,
  procBuildingId,
  procBuildingInfo,
} from '../lib/maps/proc-buildings.ts';

test('id собирается и разбирается туда-обратно для всех стилей', () => {
  for (const style of PROC_BUILDING_STYLES) {
    const p = { w: 16, d: 12, floors: 4, seed: 1337, style };
    const id = procBuildingId(p);
    assert.equal(id, `proc/building:16x12x4:1337:${style}`);
    assert.deepEqual(parseProcBuilding(id), p);
  }
  assert.deepEqual(parseProcBuilding('proc/building:8x6x1:-5:house'), {
    w: 8,
    d: 6,
    floors: 1,
    seed: -5,
    style: 'house',
  });
});

test('чужие и битые id не разбираются', () => {
  for (const id of [
    'vehicles/sedan',
    'proc/building:',
    'proc/building:16x12:1:apt',
    'proc/building:16x12x4:1:castle',
    'proc/building:16x12x0:1:apt',
    'proc/building:16x12x13:1:apt',
    'proc/building:2x12x4:1:apt',
    'proc/building:16x12x4:1.5:apt',
    'proc/building:16.5x12x4:1:apt',
    'proc/building:16x12x4:1:apt:extra',
  ]) {
    assert.equal(parseProcBuilding(id), undefined, id);
    assert.equal(procBuildingInfo(id), undefined, id);
  }
});

test('рамка: центр x/z в нуле, низ на земле, высота = этажи × 3.1 + крыша', () => {
  assert.equal(FLOOR_H, 3.1);
  const apt = procBuildingInfo('proc/building:16x12x4:7:apt');
  assert.deepEqual(apt.min, [-8, 0, -6]);
  assert.equal(apt.max[0], 8);
  assert.equal(apt.max[2], 6);
  assert.ok(Math.abs(apt.max[1] - (4 * 3.1 + ROOF_H.apt)) < 1e-9);
  assert.equal(apt.hit, 'box');

  const house = procBuildingInfo('proc/building:9x7x2:3:house');
  assert.ok(Math.abs(house.max[1] - (2 * 3.1 + 2.5)) < 1e-9);

  const office = procBuildingInfo('proc/building:30x18x9:11:office');
  assert.ok(Math.abs(office.max[1] - (9 * 3.1 + ROOF_H.office)) < 1e-9);
});

test('руина строится на одном из целых стилей и берёт его высоту крыши', () => {
  for (let seed = 0; seed < 50; seed++) {
    const tall = { w: 16, d: 12, floors: 5, seed, style: 'ruin' };
    const base = procBuildingBase(tall);
    assert.ok(base === 'apt' || base === 'office', base);
    assert.ok(
      Math.abs(procBuildingHeight(tall) - (5 * FLOOR_H + ROOF_H[base])) < 1e-9,
    );
    const low = { w: 10, d: 8, floors: 2, seed, style: 'ruin' };
    const lowBase = procBuildingBase(low);
    assert.ok(lowBase === 'house' || lowBase === 'industrial', lowBase);
  }
});

test('детерминированность: одно зерно — одна последовательность, одна рамка', () => {
  const a = mulberry32(42),
    b = mulberry32(42),
    c = mulberry32(43);
  const sa = Array.from({ length: 8 }, () => a());
  const sb = Array.from({ length: 8 }, () => b());
  const sc = Array.from({ length: 8 }, () => c());
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
  const id = 'proc/building:20x14x6:99:ruin';
  assert.deepEqual(procBuildingInfo(id), procBuildingInfo(id));
  assert.equal(
    procBuildingBase(parseProcBuilding(id)),
    procBuildingBase(parseProcBuilding(id)),
  );
});
