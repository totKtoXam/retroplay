import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOW_HP,
  damageSource,
  inRelockWindow,
  lowHealth,
  matchOutcome,
  relativeAngle,
  respawnCaption,
  roundCountdown,
} from '../lib/hud-feedback.ts';
import { DEFAULT_HUD_PREFS, aimFov, readHudPrefs, viewFov } from '../lib/hud-prefs.ts';
import { PREF_KEYS } from '../lib/user-prefs.ts';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
beforeEach(() => store.clear());

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('угол до источника урона — относительно взгляда', () => {
  const me = { x: 0, z: 0 };
  // yaw 0 смотрит в −z: впереди, справа (+x), слева, сзади.
  close(relativeAngle(me, { x: 0, z: -5 }, 0), 0);
  close(relativeAngle(me, { x: 5, z: 0 }, 0), Math.PI / 2);
  close(relativeAngle(me, { x: -5, z: 0 }, 0), -Math.PI / 2);
  close(Math.abs(relativeAngle(me, { x: 0, z: 5 }, 0)), Math.PI);
  // Повернулся налево на 90° (yaw +π/2 смотрит в −x): стрелок с −x теперь впереди.
  close(relativeAngle(me, { x: -5, z: 0 }, Math.PI / 2), 0);
});

test('источник урона — дуло ближайшего чужого выстрела', () => {
  const now = 10_000;
  const me = { pose: { x: 0, y: 0, z: 0 } };
  const effects = [
    { id: 'a', kind: 'paint', author: 'x', at: now - 300, origin: [9, 1, 9], target: [20, 1, 20] },
    { id: 'b', kind: 'sniper', author: 'y', at: now - 200, origin: [-7, 1, 3], target: [0.2, 1, 0.1] },
    { id: 'c', kind: 'paint', author: 'me', at: now - 100, origin: [1, 1, 1], target: [0, 1, 0] },
    { id: 'd', kind: 'kill', author: 'y', at: now - 50 },
  ];
  assert.deepEqual(damageSource(effects, 'me', me, [], now), { x: -7, z: 3 });
});

test('без дула — поза автора; без чужих выстрелов — источника нет', () => {
  const now = 5_000;
  const me = { pose: { x: 0, y: 0, z: 0 } };
  const members = [{ id: 'y', pose: { x: 4, y: 0, z: -2 } }];
  const effects = [{ id: 'b', kind: 'grenade', author: 'y', at: now - 900, target: [0, 0, 0] }];
  assert.deepEqual(damageSource(effects, 'me', me, members, now), { x: 4, z: -2 });
  assert.equal(damageSource([], 'me', me, members, now), null);
  assert.equal(damageSource([{ id: 'c', kind: 'paint', author: 'me', at: now }], 'me', me, members, now), null);
});

test('итог — относительно своей команды', () => {
  assert.deepEqual(matchOutcome({ phase: 'ended', winner: 'blue' }, 'blue'), { title: 'ВЫ ПОБЕДИЛИ', tone: 'win' });
  assert.deepEqual(matchOutcome({ phase: 'ended', winner: 'blue' }, 'red'), { title: 'ВЫ ПРОИГРАЛИ', tone: 'loss' });
  assert.equal(matchOutcome({ phase: 'intermission', winner: 'red' }, 'red').title, 'РАУНД ЗА ВАМИ');
  assert.equal(matchOutcome({ phase: 'intermission', winner: 'red' }, 'blue').title, 'РАУНД ПРОИГРАН');
  assert.equal(matchOutcome({ phase: 'ended', winner: 'draw' }, 'red').title, 'НИЧЬЯ');
  // Без команды — нейтрально, названием стороны (у 'red' — оранжевые).
  const neutral = matchOutcome({ phase: 'ended', winner: 'red' }, '');
  assert.equal(neutral.tone, 'neutral');
  assert.match(neutral.title, /^ПОБЕДА /);
  assert.equal(matchOutcome({ phase: 'live' }, 'red'), null);
});

test('отсчёт 3-2-1 — только в подготовке и только последние три секунды', () => {
  assert.equal(roundCountdown('freeze', 5), 0);
  assert.equal(roundCountdown('freeze', 3), 3);
  assert.equal(roundCountdown('freeze', 1), 1);
  assert.equal(roundCountdown('freeze', 0), 0);
  assert.equal(roundCountdown('live', 2), 0);
});

test('подпись возрождения не показывает «1» при нуле', () => {
  assert.equal(respawnCaption(3, false), 'Возрождение через 3 с');
  assert.doesNotMatch(respawnCaption(0, false), /\d/);
  assert.match(respawnCaption(0, true), /следующем раунде/);
});

test('мало здоровья — ниже порога и только у живого', () => {
  assert.equal(lowHealth(LOW_HP - 1, false), true);
  assert.equal(lowHealth(LOW_HP, false), false);
  assert.equal(lowHealth(0, true), false);
  assert.equal(lowHealth(10, true), false);
});

test('повтор захвата мыши — только в окне после выхода', () => {
  assert.equal(inRelockWindow(1000, 1200), true);
  assert.equal(inRelockWindow(1000, 2600), false);
  assert.equal(inRelockWindow(-Infinity, 50), false);
});

test('настройки HUD: по умолчанию, границы и мусор', () => {
  assert.deepEqual(readHudPrefs(), DEFAULT_HUD_PREFS);
  localStorage.setItem(PREF_KEYS.fov, '140');
  localStorage.setItem(PREF_KEYS.sfxVolume, '0.4');
  localStorage.setItem(PREF_KEYS.crosshairStyle, 'cross-dot');
  localStorage.setItem(PREF_KEYS.crosshairColor, '#FFAA00');
  localStorage.setItem(PREF_KEYS.hudScale, '0.5');
  localStorage.setItem(PREF_KEYS.colorblind, '1');
  localStorage.setItem(PREF_KEYS.showStats, '0');
  localStorage.setItem(PREF_KEYS.gore, '0');
  assert.deepEqual(readHudPrefs(), {
    fov: 100,
    sfxVolume: 0.4,
    crosshairStyle: 'cross-dot',
    crosshairColor: '#ffaa00',
    hudScale: 0.9,
    colorblind: true,
    showStats: false,
    gore: false,
  });
  localStorage.setItem(PREF_KEYS.crosshairColor, 'red; background: url(x)');
  localStorage.setItem(PREF_KEYS.crosshairStyle, 'star');
  localStorage.setItem(PREF_KEYS.fov, 'abc');
  const junk = readHudPrefs();
  assert.equal(junk.crosshairColor, DEFAULT_HUD_PREFS.crosshairColor);
  assert.equal(junk.crosshairStyle, 'cross');
  assert.equal(junk.fov, 80);
});

test('поле зрения: по умолчанию прежние 80/68 и 56/50', () => {
  close(viewFov(80, 'first'), 80);
  close(viewFov(80, 'third'), 68);
  close(aimFov(80, 'first'), 56);
  close(aimFov(80, 'third'), 50);
  // Прицеливание приближает в той же пропорции при любом поле зрения.
  close(aimFov(100, 'first') / viewFov(100, 'first'), 56 / 80);
  close(aimFov(70, 'third') / viewFov(70, 'third'), 50 / 68);
});
