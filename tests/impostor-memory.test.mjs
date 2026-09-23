import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotMemory, lookAlike, recalled } from '../lib/impostor-bot-memory.ts';
import { IMPOSTOR_BOT_LEVELS } from '../lib/impostor-bot-levels.ts';
import { getMap } from '../lib/maps/index.ts';

const T = 1_000_000;
const ship = getMap('ship');
/** Кафетерий: −10…10 по x, −32…−14 по z. */
const CAFETERIA = { x: 0, z: -20 };

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OTHERS = [
  { id: 'a', color: '#ff647c' },
  { id: 'b', color: '#ff6a80' },
  { id: 'c', color: '#64d4ef' },
];

const look = (from, extra = {}) => ({ map: ship, from, range: 8, others: OTHERS, ...extra });

/** Сколько раз из `tries` встреча отложилась в памяти. */
function noticed(rules, distance, extra = {}, tries = 400) {
  let seen = 0;
  for (let i = 0; i < tries; i++) {
    const memory = new BotMemory(rules, seeded(i + 1));
    if (memory.see(T, 'a', { x: CAFETERIA.x + distance, z: CAFETERIA.z }, look(CAFETERIA, extra))) seen++;
  }
  return seen / tries;
}

test('memory: fades with time and disappears entirely', () => {
  assert.equal(recalled(1, 0, 10_000), 1);
  assert.ok(recalled(1, 2000, 10_000) > 0.85, 'свежее помнится почти как было');
  assert.ok(recalled(1, 5000, 10_000) < 0.6);
  assert.equal(recalled(1, 10_000, 10_000), 0, 'за горизонтом памяти не остаётся ничего');
  assert.ok(recalled(0.5, 3000, 10_000) < recalled(1, 3000, 10_000), 'слабое воспоминание тает быстрее');
});

test('memory: the far, the dark and the busy are noticed less often', () => {
  const rules = IMPOSTOR_BOT_LEVELS.expert.memory;
  const near = noticed(rules, 1);
  const far = noticed(rules, 7);
  assert.ok(near > far + 0.2, `рядом ${near.toFixed(2)} против далёкого ${far.toFixed(2)}`);
  assert.ok(noticed(rules, 1, { busy: true }) < near - 0.2, 'занятый пультом замечает реже');
  assert.ok(noticed(rules, 1, { dark: true }) < near - 0.1, 'в темноте замечает реже');
  // Невнимательный пропускает больше, чем опытный, даже вплотную.
  assert.ok(noticed(IMPOSTOR_BOT_LEVELS.weak.memory, 1) < near - 0.3);
});

test('memory: a glimpse keeps who, roughly where and roughly when', () => {
  const memory = new BotMemory(IMPOSTOR_BOT_LEVELS.expert.memory, seeded(4));
  let ok = false;
  for (let i = 0; i < 20 && !ok; i++) ok = memory.see(T, 'a', CAFETERIA, look({ x: 2, z: -20 }));
  const [seen] = memory.recall(T);
  assert.equal(seen.who, 'a');
  assert.equal(seen.zone, 'Кафетерий');
  assert.ok(Math.hypot(seen.x - CAFETERIA.x, seen.z - CAFETERIA.z) < 3, 'место помнится примерно');
  assert.ok(Math.abs(seen.at - T) < 2500, 'время помнится примерно');
  assert.ok(seen.sure, 'вблизи и при свете человека узнают точно');
  assert.ok(seen.sureness > 0.7);
});

test('memory: far in the dark people get mixed up with a look-alike', () => {
  const rules = { ...IMPOSTOR_BOT_LEVELS.expert.memory, attention: 1, mixUp: 1 };
  const memory = new BotMemory(rules, seeded(9));
  assert.equal(memory.see(T, 'a', { x: 7, z: -20 }, look(CAFETERIA, { dark: true })), true);
  const [seen] = memory.recall(T);
  assert.equal(seen.who, 'b', 'перепутали с самым похожим по цвету');
  assert.equal(seen.sure, false);
  assert.ok(seen.sureness < 0.8, 'в таком воспоминании бот менее уверен');
  // Вблизи и при свете не путают даже самого забывчивого.
  const close = new BotMemory({ ...IMPOSTOR_BOT_LEVELS.weak.memory, attention: 1, mixUp: 1 }, seeded(9));
  close.see(T, 'a', { x: 1, z: -20 }, look(CAFETERIA));
  assert.equal(close.recall(T)[0].who, 'a');
});

test('memory: look-alike is the closest colour, never the person themself', () => {
  assert.equal(lookAlike('#ff647c', OTHERS.filter((o) => o.id !== 'a')), 'b');
  // Из двух красных к голубому чуть ближе тот, что светлее: сравниваются сами числа цвета.
  assert.equal(lookAlike('#64d4ef', OTHERS.filter((o) => o.id !== 'c')), 'b');
  assert.equal(lookAlike('#ff647c', []), null);
});

test('memory: only a few meetings fit, the dimmest is forgotten first', () => {
  const rules = { ...IMPOSTOR_BOT_LEVELS.expert.memory, attention: 1, capacity: 3, horizon: 30_000 };
  const memory = new BotMemory(rules, seeded(2));
  // Пять встреч в разных отсеках, разнесённые по времени.
  const spots = [
    ['a', { x: 0, z: -20 }],
    ['b', { x: 24, z: -12 }],
    ['c', { x: 43, z: 0 }],
    ['a', { x: 28, z: 22 }],
    ['b', { x: -36, z: 20 }],
  ];
  spots.forEach(([who, at], i) => memory.see(T + i * 1000, who, at, look(at)));
  const kept = memory.recall(T + 5000);
  assert.equal(kept.length, 3, 'в голове помещается лишь несколько встреч');
  // Забывается самое тусклое — самое старое: первой встречи уже нет.
  assert.ok(!kept.some((g) => g.zone === 'Кафетерий'));
  // За горизонтом памяти не остаётся ничего.
  assert.deepEqual(memory.recall(T + 60_000), []);
});

test('memory: the same person in the same room is one memory, not twenty', () => {
  const memory = new BotMemory({ ...IMPOSTOR_BOT_LEVELS.expert.memory, attention: 1 }, seeded(6));
  for (let i = 0; i < 12; i++) memory.see(T + i * 300, 'a', CAFETERIA, look({ x: 1, z: -20 }));
  const kept = memory.recall(T + 3600);
  assert.equal(kept.length, 1);
  assert.ok(kept[0].strength >= 0.9, 'встреченный снова и снова запоминается крепче');
});

test('memory: the alibi witness comes from memory and can be forgotten', () => {
  const memory = new BotMemory({ ...IMPOSTOR_BOT_LEVELS.expert.memory, attention: 1 }, seeded(8));
  memory.see(T, 'a', CAFETERIA, look({ x: 1, z: -20 }));
  const alive = () => true;
  assert.equal(memory.latest(T + 1000, alive)?.who, 'a');
  assert.equal(memory.latest(T + 30_000, alive), null, 'давнее в алиби не годится');
  assert.equal(memory.latest(T + 1000, (id) => id !== 'a'), null, 'на погибшего не сошлёшься');
});
