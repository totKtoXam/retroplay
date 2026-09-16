import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoWeather,
  MAX_WIND_PUSH,
  WEATHER_KINDS,
  WEATHER_SLOT_MS,
  WEATHER_TRANSITION_MS,
  weatherLook,
  weatherMix,
  windAt,
  windDrift,
  windPush,
  windRelative,
} from '../lib/weather.ts';
import { isVegetation, seasonColor } from '../lib/season-colors.ts';
import { initialState, applyOperation } from '../lib/model.ts';

const run = (s, op, user = 'host') => applyOperation(s, op, user, 'host');
const T0 = 1_790_000_000_000;

test('ручная погода не меняется со временем', () => {
  for (const kind of WEATHER_KINDS)
    for (const dt of [0, 60_000, 3_600_000])
      assert.deepEqual(weatherMix({ weather: kind, season: 'summer' }, T0 + dt), { from: kind, to: kind, blend: 0 });
});

test('старые комнаты без поля погоды остаются ясными', () => {
  assert.equal(weatherMix({ season: 'winter' }, T0).from, 'clear');
});

test('«авто» одинакова у всех и уважает сезон', () => {
  const seen = { summer: new Set(), winter: new Set() };
  for (let slot = 0; slot < 400; slot++) {
    seen.summer.add(autoWeather('summer', slot));
    seen.winter.add(autoWeather('winter', slot));
    assert.equal(autoWeather('winter', slot), autoWeather('winter', slot));
  }
  assert.ok(!seen.summer.has('blizzard') && !seen.summer.has('snow'), 'летом не метёт');
  assert.ok(!seen.winter.has('storm') && !seen.winter.has('rain'), 'зимой нет гроз');
  assert.ok(seen.summer.size >= 3 && seen.winter.size >= 3, 'погода действительно меняется');
});

test('«авто» перетекает между погодами плавно', () => {
  const s = { weather: 'auto', season: 'autumn' };
  // Слот, где погода сменилась.
  let slot = 1000;
  while (autoWeather('autumn', slot) === autoWeather('autumn', slot - 1)) slot++;
  const start = slot * WEATHER_SLOT_MS;
  const before = weatherLook(weatherMix(s, start - 1));
  const at = weatherLook(weatherMix(s, start));
  assert.ok(Math.abs(before.overcast - at.overcast) < 1e-6, 'на границе слота нет скачка');
  const mid = weatherMix(s, start + WEATHER_TRANSITION_MS / 2);
  assert.ok(mid.blend > 0.4 && mid.blend < 0.6);
  const after = weatherMix(s, start + WEATHER_TRANSITION_MS);
  assert.equal(after.from, after.to);
});

test('ветер меняется, но без рывков, и в бурю сильнее, чем в ясный день', () => {
  const storm = { weather: 'storm' },
    clear = { weather: 'clear' };
  let maxStep = 0,
    min = Infinity,
    max = 0,
    stormSum = 0,
    clearSum = 0;
  let prev = windAt(storm, T0);
  for (let i = 1; i < 60 * 600; i++) {
    const now = T0 + i * (1000 / 60);
    const w = windAt(storm, now);
    maxStep = Math.max(maxStep, Math.hypot(w.x - prev.x, w.z - prev.z));
    min = Math.min(min, w.speed);
    max = Math.max(max, w.speed);
    stormSum += w.speed;
    clearSum += windAt(clear, now).speed;
    prev = w;
  }
  assert.ok(maxStep < 1, `за кадр ветер меняется плавно: ${maxStep.toFixed(3)}`);
  assert.ok(max - min > 5, `сила ветра не константа: ${min.toFixed(1)}…${max.toFixed(1)}`);
  assert.ok(stormSum > clearSum * 3);
  // Направление за 10 минут тоже поворачивается.
  const a = windAt(clear, T0),
    b = windAt(clear, T0 + 25 * 60_000);
  const angle = (w) => Math.atan2(w.x, -w.z);
  assert.ok(Math.abs(angle(a) - angle(b)) > 0.05);
});

test('снос игрока ограничен и не выходит за серверный предел скорости', () => {
  const hurricane = { x: 60, z: 0 };
  const push = windPush(hurricane, { stance: 'stand', moving: true, airborne: true });
  assert.ok(Math.hypot(push.x, push.z) <= MAX_WIND_PUSH + 1e-9);
  // Бег 4.8 м/с + снос < 7.2 м/с, которые пропускает сервер.
  assert.ok(4.8 + MAX_WIND_PUSH < 7.2);
  // Стоящего на месте лёгкий ветер не двигает, лёжа сносит слабее.
  assert.deepEqual(windPush({ x: 5, z: 0 }, { stance: 'stand', moving: false, airborne: false }), { x: 0, z: 0 });
  const standing = windPush({ x: 10, z: 0 }, { stance: 'stand', moving: true, airborne: false }).x;
  const lying = windPush({ x: 10, z: 0 }, { stance: 'lie', moving: true, airborne: false }).x;
  assert.ok(standing > lying && lying > 0);
});

test('снос пули растёт с дистанцией и не уводит её от прицела', () => {
  const wind = { x: 10, z: 0 };
  const near = windDrift('paint', wind, 10).x,
    far = windDrift('paint', wind, 40).x;
  assert.ok(far > near * 10, 'квадрат дистанции');
  assert.ok(windDrift('sniper', wind, 40).x < far, 'снайперку сносит меньше');
  assert.ok(Math.hypot(...Object.values(windDrift('confetti', { x: 200, z: 0 }, 60))) <= 60 * 0.08 + 1e-9);
  assert.deepEqual(windDrift('like', wind, 40), { x: 0, z: 0 }, 'голосование ветер не трогает');
});

test('индикатор: ветер относительно взгляда', () => {
  // yaw 0: вперёд — это -z, вправо — +x.
  assert.ok(Math.abs(windRelative({ x: 0, z: -5 }, 0).angle) < 1e-9, 'попутный — стрелка вверх');
  assert.ok(Math.abs(windRelative({ x: 5, z: 0 }, 0).angle - Math.PI / 2) < 1e-9, 'сносит вправо');
  // Повернулись налево (yaw +90°): тот же ветер на +x теперь дует в спину.
  assert.ok(Math.abs(Math.abs(windRelative({ x: 5, z: 0 }, Math.PI / 2).angle) - Math.PI) < 1e-9);
});

test('сезоны на боевых картах: зелень желтеет и уходит под снег', () => {
  const hedge = '#4f7a3a';
  assert.ok(isVegetation(hedge));
  assert.equal(seasonColor(hedge, 'summer'), hedge, 'родной сезон не трогаем');
  const autumn = seasonColor(hedge, 'autumn');
  assert.ok(!isVegetation(autumn), `осенью зелень уже не зелёная: ${autumn}`);
  const winterGround = seasonColor('#6f8f4a', 'winter', 'summer', 'ground');
  assert.ok(parseInt(winterGround.slice(1, 3), 16) > 0xd0, `земля зимой белая: ${winterGround}`);
  assert.equal(seasonColor('#8a8f98', 'autumn'), '#8a8f98', 'камень осенью не меняется');
  // Заснеженная карта летом тает, а огни и стены не трогаются.
  const snow = '#e8eff5';
  assert.equal(seasonColor(snow, 'winter', 'winter', 'ground'), snow);
  assert.notEqual(seasonColor(snow, 'summer', 'winter', 'ground'), snow);
  assert.equal(seasonColor('#ffd9a0', 'summer', 'winter'), '#ffd9a0');
  assert.equal(seasonColor('#fff', 'winter'), seasonColor('#ffffff', 'winter'));
});

test('ведущий меняет погоду и ветер, недопустимое отклоняется', () => {
  const s0 = initialState('Ретро');
  assert.equal(s0.weather, 'auto');
  assert.equal(s0.windEffects, true);
  const s1 = run(s0, { type: 'room.settings', patch: { weather: 'blizzard', windEffects: false } });
  assert.equal(s1.weather, 'blizzard');
  assert.equal(s1.windEffects, false);
  assert.throws(() => run(s1, { type: 'room.settings', patch: { weather: 'tornado' } }));
  assert.throws(() => run(s1, { type: 'room.settings', patch: { weather: 'rain' } }, 'guest'));
});
