import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fireEffect,
  memberFromRow,
  newMatch,
  presence,
  publicMembers,
  resolveCombat,
  roomFromState,
  stepZombies,
  survivalAction,
} from '../lib/room-hub-core.ts';
import {
  CORPSE_MS,
  DIFFICULTY,
  levelFor,
  MAX_ALIVE_ZOMBIES,
  newSurvivalGame,
  PERKS,
  survivalView,
  waveQueue,
  xpForLevel,
  ZOMBIES,
} from '../lib/survival.ts';
import { newImpostorGame } from '../lib/impostor.ts';
import { encodeCheckpoint, restoreCheckpoint } from '../lib/room-checkpoint.ts';
import { applyOperation, initialState } from '../lib/model.ts';
import { getMap } from '../lib/maps/index.ts';
import { navFor } from '../lib/bot-brain.ts';
import { isBlocked3D } from '../lib/world-collision.ts';

const T = 1_000_000;

/** Комната «Выживания» на «Зоне заражения»: ведущий `host` и ещё `extra` игроков в сети. */
function room(extra = 1, settings = {}) {
  const state = { mode: 'survival', map: 'outbreak', survival: { prepSeconds: 10, ...settings } };
  const hub = {
    room: { ...roomFromState('host', state), shieldSeconds: 0 },
    members: new Map(),
    effects: [],
    seq: 0,
    match: newMatch(roomFromState('host', state), T),
    impostor: newImpostorGame(),
    survival: newSurvivalGame(),
  };
  const base = getMap('outbreak').base;
  ['host', ...Array.from({ length: extra }, (_, i) => `p${i + 1}`)].forEach((id, i) => {
    const m = memberFromRow({ session: id, name: id, seen: T });
    m.pose = { ...m.pose, x: base[i].x, z: base[i].z, y: base[i].y };
    hub.members.set(id, m);
  });
  return hub;
}

const act = (hub, self, op, now = T) => survivalAction(hub, self, op, now);
const humans = (hub) => [...hub.members.values()].filter((m) => !m.zombie);
const zombies = (hub) => [...hub.members.values()].filter((m) => m.zombie);

/** Такты по 100 мс: люди в сети, зомби думают, бой считается. */
function simulate(hub, brains, from, seconds, onTick = () => {}) {
  let now = from;
  for (let i = 0; i < seconds * 10; i++) {
    now += 100;
    for (const m of humans(hub)) presence(hub, m, { pose: m.pose, life: m.life }, now);
    stepZombies(hub, brains, now);
    resolveCombat(hub, now);
    if (onTick(now) === false) break;
  }
  return now;
}

/** Партия начата и первая волна пошла. */
function waveStarted(extra = 1, settings = {}) {
  const hub = room(extra, settings);
  assert.deepEqual(act(hub, 'host', { action: 'start' }), { ok: true });
  assert.equal(hub.survival.phase, 'prep');
  const brains = new Map();
  const now = simulate(hub, brains, T, 10.5);
  assert.equal(hub.survival.phase, 'wave');
  assert.equal(hub.survival.wave, 1);
  return { hub, brains, now };
}

test('настройки: сложность из списка, числа в пределах, целые', () => {
  let s = initialState('Выживание');
  s = applyOperation(s, { type: 'room.settings', patch: { mode: 'survival' } }, 'host', 'host');
  assert.equal(s.map, 'outbreak');
  s = applyOperation(s, { type: 'room.settings', patch: { survival: { difficulty: 'hard', waves: 0, prepSeconds: 30 } } }, 'host', 'host');
  assert.deepEqual(s.survival, { difficulty: 'hard', waves: 0, prepSeconds: 30 });
  assert.throws(() => applyOperation(s, { type: 'room.settings', patch: { survival: { difficulty: 'nightmare' } } }, 'host', 'host'), /сложность/);
  assert.throws(() => applyOperation(s, { type: 'room.settings', patch: { survival: { waves: 2.5 } } }, 'host', 'host'), /целым/);
  assert.throws(() => applyOperation(s, { type: 'room.settings', patch: { survival: { prepSeconds: 500 } } }, 'host', 'host'));
  // Сервер подрезает всё лишнее и дополняет умолчаниями.
  const r = roomFromState('host', { mode: 'survival', map: 'outbreak', survival: { waves: 999, difficulty: 'x' } });
  assert.deepEqual(r.survival, { difficulty: 'normal', waves: 50, prepSeconds: 25 });
  assert.equal(r.teams, false);
  // Боты в «Выживании» разрешены.
  s = applyOperation(s, { type: 'bots.add', level: 'medium' }, 'host', 'host');
  assert.equal(s.bots.length, 1);
});

test('состав волн: толпа растёт, бегуны с третьей волны, громилы с пятой; сложность множит', () => {
  const w1 = waveQueue(1, 'normal', 1, 7);
  assert.ok(w1.length >= 8 && w1.every((k) => k === 'walker'), 'первая волна — только ходячие');
  const w3 = waveQueue(3, 'normal', 1, 7);
  assert.ok(w3.length > w1.length);
  assert.ok(w3.includes('runner'));
  assert.ok(!w3.includes('brute'));
  const w5 = waveQueue(5, 'normal', 1, 7);
  assert.equal(w5.filter((k) => k === 'brute').length, 1);
  assert.ok(waveQueue(5, 'hard', 4, 7).length > w5.length, 'тяжёлая сложность и четверо игроков — толпа гуще');
  assert.ok(waveQueue(5, 'easy', 1, 7).length < w5.length);
  assert.deepEqual(waveQueue(4, 'normal', 2, 11), waveQueue(4, 'normal', 2, 11), 'состав воспроизводим по зерну');
  assert.ok(DIFFICULTY.hard.hp > DIFFICULTY.normal.hp && DIFFICULTY.easy.damage < 1);
});

test('опыт и уровни: пороги растут, уровень по опыту, навыки ограничены рангами', () => {
  assert.equal(xpForLevel(1), 0);
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(xpForLevel(2)), 2);
  assert.equal(levelFor(xpForLevel(5) - 1), 4);
  assert.ok(xpForLevel(3) - xpForLevel(2) < xpForLevel(4) - xpForLevel(3));
  assert.equal(levelFor(1e9), 30);
  for (const p of Object.values(PERKS)) assert.ok(p.max >= 1 && p.max <= 3);
  for (const z of Object.values(ZOMBIES)) assert.ok(z.hp > 0 && z.speed > 0 && z.models.length);
});

test('старт только у ведущего и только в этом режиме; подготовка, затем волна и зомби у базы', () => {
  const hub = room();
  assert.equal(act(hub, 'p1', { action: 'start' }).ok, false);
  assert.deepEqual(act(hub, 'host', { action: 'start' }), { ok: true });
  assert.equal(act(hub, 'host', { action: 'start' }).ok, false, 'второй старт — ошибка');
  assert.equal(hub.survival.phase, 'prep');
  assert.equal(hub.survival.game, 1);
  const view = survivalView(hub, T);
  assert.equal(view.players.length, 2);
  assert.equal(view.players[0].level, 1);
  const brains = new Map();
  simulate(hub, brains, T, 3);
  assert.equal(zombies(hub).length, 0, 'на подготовке зомби нет');
  simulate(hub, brains, T + 3000, 9);
  assert.equal(hub.survival.phase, 'wave');
  const z = zombies(hub);
  assert.ok(z.length >= 3 && z.length <= MAX_ALIVE_ZOMBIES, `вышло ${z.length} зомби`);
  const map = getMap('outbreak');
  for (const m of z) {
    const near = humans(hub).map((h) => Math.hypot(h.pose.x - m.pose.x, h.pose.z - m.pose.z));
    assert.ok(Math.min(...near) >= 15, 'не из воздуха за спиной');
    assert.ok(Math.min(...near) <= 80, 'и не на другом конце карты');
    assert.ok(!isBlocked3D(m.pose.x, m.pose.z, m.pose.y, 0.25, 1.8, map.colliders), 'не в стене');
    assert.ok(m.hp > 0 && m.zombie && hub.survival.zombies[m.id]);
  }
  const pub = publicMembers(hub, T + 12_000);
  const zp = pub.find((p) => p.zombie);
  assert.ok(zp && zp.maxHp > 0 && zp.name.includes('Ходячий'));
  assert.equal(pub.find((p) => p.id === 'host').maxHp, 100);
});

test('зомби идут к выжившим, кусают вплотную и убивают; погибший ждёт волну', () => {
  const { hub, brains, now: t0 } = waveStarted(0);
  const host = hub.members.get('host');
  const before = Math.min(...zombies(hub).map((z) => Math.hypot(z.pose.x - host.pose.x, z.pose.z - host.pose.z)));
  const hp0 = host.hp;
  let bitten = 0;
  let after = before;
  let closest = Infinity;
  const now = simulate(hub, brains, t0, 40, (t) => {
    const d = Math.min(...zombies(hub).map((z) => Math.hypot(z.pose.x - host.pose.x, z.pose.z - host.pose.z)));
    if (Number.isFinite(d)) {
      after = d;
      closest = Math.min(closest, d);
    }
    if (host.hp < hp0 && !bitten) bitten = t;
    return host.hp > 0;
  });
  assert.ok(after < before - 10, `толпа приблизилась: ${before.toFixed(1)} → ${after.toFixed(1)}`);
  assert.ok(bitten > 0, 'укусили');
  assert.ok(closest < 3, 'кусают вплотную');
  assert.equal(host.hp, 0, 'одинокого выжившего толпа съедает');
  const kill = hub.effects.find((e) => e.kind === 'kill' && e.victim === 'host');
  assert.ok(kill && kill.tool === 'bite' && kill.killerName.includes('🧟'));
  assert.equal(host.respawnAt, 0, 'возрождения по таймеру нет');
  // Все люди погибли — партия окончена, итог с номером волны; зомби убраны.
  resolveCombat(hub, now + 100);
  assert.equal(hub.survival.phase, 'ended');
  assert.equal(hub.survival.result.won, false);
  assert.equal(hub.survival.result.wave, 1);
  assert.equal(zombies(hub).length, 0);
  assert.deepEqual(act(hub, 'host', { action: 'stop' }, now).ok, false, 'останавливать нечего');
  // Через ENDED снова лобби.
  resolveCombat(hub, now + 20_000);
  assert.equal(hub.survival.phase, 'lobby');
});

test('выстрел ранит зомби с множителем навыка, убийство даёт опыт, уровень и очко навыка', () => {
  const { hub, brains, now: t0 } = waveStarted(1);
  const host = hub.members.get('host');
  const z = zombies(hub)[0];
  // Зомби — прямо перед стрелком, стрелок смотрит на него.
  z.pose = { ...z.pose, x: host.pose.x, z: host.pose.z - 6, y: host.pose.y };
  z.track = [];
  const shoot = (now) => {
    const origin = [host.pose.x, host.pose.y + 1.5, host.pose.z];
    const target = [z.pose.x, z.pose.y + 1.3, z.pose.z];
    const r = fireEffect(hub, 'host', { kind: 'paint', origin, target, normal: [0, 1, 0], color: '#ff0000' }, now);
    assert.ok(r.ok, r.reason);
    return r.effect;
  };
  let now = t0 + 100;
  const e = shoot(now);
  // Зомби стоит на месте: мозг не шагает, пока мы держим его позу.
  for (const m of humans(hub)) m.seen = now + 2000;
  z.seen = now + 2000;
  resolveCombat(hub, e.resolveAt + 1);
  assert.ok(z.hp < hub.survival.zombies[z.id].hpMax, 'краскомёт ранит зомби');
  const hpAfterOne = z.hp;
  // Добиваем: урон идёт, пока зомби не умрёт.
  now = e.resolveAt + 1;
  for (let i = 0; i < 20 && z.hp > 0; i++) {
    now += 400;
    for (const m of humans(hub)) m.seen = now;
    z.seen = now;
    const s = shoot(now);
    resolveCombat(hub, s.resolveAt + 1);
    now = s.resolveAt + 1;
  }
  assert.equal(z.hp, 0, 'зомби убит');
  assert.ok(hpAfterOne < hub.survival.zombies[z.id].hpMax);
  const kill = hub.effects.find((ev) => ev.kind === 'kill' && ev.victim === z.id);
  assert.ok(kill && kill.killer === 'host');
  const me = hub.survival.players.host;
  assert.equal(me.kills, 1);
  assert.equal(me.xp, ZOMBIES[z.zombie].xp);
  assert.equal(host.kills, 1);
  assert.ok(hub.survival.zombies[z.id].diedAt > 0);
  // Труп исчезает из комнаты через CORPSE_MS.
  resolveCombat(hub, now + CORPSE_MS + 100);
  assert.ok(!hub.members.has(z.id));
  assert.ok(!hub.survival.zombies[z.id]);
  // Опыт до второго уровня — очко навыка; «Живучесть» поднимает запас здоровья.
  me.xp = xpForLevel(2) - 1;
  const z2 = zombies(hub).find((m) => m.hp > 0);
  z2.pose = { ...z2.pose, x: host.pose.x, z: host.pose.z - 6, y: host.pose.y };
  z2.track = [];
  z2.hp = 1;
  for (const m of humans(hub)) m.seen = now + CORPSE_MS + 200;
  z2.seen = now + CORPSE_MS + 200;
  const s2 = shoot(now + CORPSE_MS + 200);
  resolveCombat(hub, s2.resolveAt + 1);
  assert.equal(z2.hp, 0);
  assert.equal(me.level, 2);
  assert.equal(me.points, 1);
  assert.equal(act(hub, 'host', { action: 'perk', perk: 'nope' }).ok, false);
  assert.equal(act(hub, 'p1', { action: 'perk', perk: 'vitality' }).ok, false, 'без очков навык не взять');
  assert.deepEqual(act(hub, 'host', { action: 'perk', perk: 'vitality' }), { ok: true });
  assert.equal(me.points, 0);
  assert.equal(me.perks.vitality, 1);
  assert.equal(publicMembers(hub, s2.resolveAt + 1).find((p) => p.id === 'host').maxHp, 120);
  assert.equal(host.hp, 120, 'ранг «Живучести» прибавляет здоровье сразу');
  assert.equal(act(hub, 'host', { action: 'perk', perk: 'power' }).ok, false, 'очко уже потрачено');
  simulate(hub, brains, s2.resolveAt + 1, 0.2);
});

test('выжившие друг друга не ранят; волна кончается, когда зомби не осталось, и начинается подготовка', () => {
  const { hub, now: t0 } = waveStarted(1, { waves: 1 });
  const host = hub.members.get('host');
  const p1 = hub.members.get('p1');
  p1.pose = { ...p1.pose, x: host.pose.x, z: host.pose.z - 4, y: host.pose.y };
  p1.track = [];
  const e = fireEffect(
    hub,
    'host',
    { kind: 'sniper', origin: [host.pose.x, host.pose.y + 1.5, host.pose.z], target: [p1.pose.x, p1.pose.y + 1.4, p1.pose.z], normal: [0, 1, 0], color: '#ff0000' },
    t0 + 100,
  );
  assert.ok(e.ok);
  for (const m of hub.members.values()) m.seen = e.effect.resolveAt + 1;
  resolveCombat(hub, e.effect.resolveAt + 1);
  assert.equal(p1.hp, 100, 'кооператив: своих не ранят даже снайперкой в голову');
  // Убираем всю волну «вручную» — как если бы её перестреляли.
  const now = e.effect.resolveAt + 1;
  hub.survival.queue = [];
  for (const z of zombies(hub)) {
    z.hp = 0;
    hub.survival.zombies[z.id].diedAt = now;
  }
  for (const m of hub.members.values()) m.seen = now + CORPSE_MS + 200;
  resolveCombat(hub, now + CORPSE_MS + 200);
  assert.equal(zombies(hub).length, 0);
  // Единственная волна пройдена — победа.
  assert.equal(hub.survival.phase, 'ended');
  assert.equal(hub.survival.result.won, true);
  assert.equal(hub.survival.result.wave, 1);
});

test('между волнами погибшие встают на базе с полным здоровьем, а живые лечатся', () => {
  const { hub, now: t0 } = waveStarted(1, { waves: 0 });
  const host = hub.members.get('host');
  const p1 = hub.members.get('p1');
  p1.hp = 0;
  p1.pose = { ...p1.pose, x: 300, z: 300 };
  host.hp = 37;
  hub.survival.queue = [];
  let now = t0;
  for (const z of zombies(hub)) {
    z.hp = 0;
    hub.survival.zombies[z.id].diedAt = now;
  }
  for (const m of hub.members.values()) m.seen = now + CORPSE_MS + 200;
  resolveCombat(hub, now + CORPSE_MS + 200);
  assert.equal(hub.survival.phase, 'prep');
  assert.equal(p1.hp, 100);
  assert.equal(host.hp, 100);
  const base = getMap('outbreak').base;
  assert.ok(base.some((b) => Math.hypot(b.x - p1.pose.x, b.z - p1.pose.z) < 1), 'погибший встал на базе');
  // Вторая волна гуще первой.
  now = now + CORPSE_MS + 200 + 10_100;
  for (const m of hub.members.values()) m.seen = now;
  resolveCombat(hub, now);
  assert.equal(hub.survival.phase, 'wave');
  assert.equal(hub.survival.wave, 2);
  assert.ok(hub.survival.queue.length + 1 > waveQueue(1, 'normal', 2, hub.survival.seed).length);
});

test('чекпоинт переживает перезапуск вместе с партией и толпой', () => {
  const { hub } = waveStarted(1);
  const saved = encodeCheckpoint('r1', hub);
  const fresh = room(1);
  assert.ok(restoreCheckpoint('r1', fresh, saved));
  assert.equal(fresh.survival.phase, 'wave');
  assert.equal(zombies(fresh).length, zombies(hub).length);
  const z = zombies(fresh)[0];
  assert.ok(z.zombie && z.hp > 0 && fresh.survival.zombies[z.id]);
});

test('смена режима на другой убирает партию и зомби', () => {
  const { hub } = waveStarted(1);
  hub.room = { ...hub.room, mode: 'battle', teams: true };
  resolveCombat(hub, T + 20_000);
  assert.equal(hub.survival.phase, 'lobby');
  assert.equal(zombies(hub).length, 0);
});

test('сетка проходимости: база лагеря достижима снаружи', () => {
  const nav = navFor(getMap('outbreak'));
  const base = getMap('outbreak').base;
  assert.ok(base.length >= 4);
  for (const b of base) {
    const idx = nav.at(b.x, b.z);
    assert.ok(idx >= 0 && nav.kind[idx], 'точка базы проходима');
  }
  assert.ok(nav.find(-120, 90, base[0].x, base[0].z), 'снаружи в лагерь есть путь');
});
