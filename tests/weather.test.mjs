import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoWeather,
  beaufort,
  MAX_WIND_PUSH,
  OPEN_VISIBILITY,
  SCALES,
  WEATHER_KINDS,
  WEATHER_PARAM_INFO,
  WEATHER_PARAMS,
  WEATHER_PRESETS,
  WEATHER_SLOT_MS,
  WEATHER_TRANSITION_MS,
  weatherLevels,
  weatherLook,
  weatherMix,
  windAt,
  windDrift,
  windLevel,
  windPush,
  windRelative,
} from '../lib/weather.ts';
import { isVegetation, seasonColor } from '../lib/season-colors.ts';
import { initialState, applyOperation } from '../lib/model.ts';

const run = (s, op, user = 'host') => applyOperation(s, op, user, 'host');
const T0 = 1_790_000_000_000;

/** Скорости ветра за `minutes` минут с шагом в кадр. */
function windSamples(s, minutes = 10) {
  const out = [];
  for (let i = 0; i < 60 * 60 * minutes; i++) out.push(windAt(s, T0 + i * (1000 / 60)));
  return out;
}

test('ручная погода не меняется со временем', () => {
  for (const kind of WEATHER_KINDS)
    for (const dt of [0, 60_000, 3_600_000])
      assert.deepEqual(weatherMix({ weather: kind, season: 'summer' }, T0 + dt), { from: kind, to: kind, blend: 0 });
});

test('старые комнаты без поля погоды остаются ясными', () => {
  assert.equal(weatherMix({ season: 'winter' }, T0).from, 'clear');
});

test('у каждой погоды есть пресет по всем параметрам в пределах шкал', () => {
  for (const kind of WEATHER_KINDS)
    for (const param of WEATHER_PARAMS) {
      const level = WEATHER_PRESETS[kind][param];
      assert.ok(level >= WEATHER_PARAM_INFO[param].min && level <= 4, `${kind}.${param} = ${level}`);
    }
  for (const param of WEATHER_PARAMS) assert.equal(WEATHER_PARAM_INFO[param].levels.length, 5);
});

test('«авто» одинакова у всех и уважает сезон', () => {
  const seen = { summer: new Set(), winter: new Set() };
  for (let slot = 0; slot < 400; slot++) {
    seen.summer.add(autoWeather('summer', slot));
    seen.winter.add(autoWeather('winter', slot));
    assert.equal(autoWeather('winter', slot), autoWeather('winter', slot));
  }
  assert.ok(!seen.summer.has('blizzard') && !seen.summer.has('snow'), 'летом не метёт');
  assert.ok(!seen.winter.has('storm') && !seen.winter.has('rain') && !seen.winter.has('dust'), 'зимой нет гроз и пыли');
  assert.ok(seen.summer.size >= 3 && seen.winter.size >= 3, 'погода действительно меняется');
});

test('«авто» перетекает между погодами плавно', () => {
  const s = { weather: 'auto', season: 'autumn' };
  let slot = 1000;
  while (autoWeather('autumn', slot) === autoWeather('autumn', slot - 1)) slot++;
  const start = slot * WEATHER_SLOT_MS;
  const before = weatherLook(s, start - 1);
  const at = weatherLook(s, start);
  assert.ok(Math.abs(before.overcast - at.overcast) < 1e-6, 'на границе слота нет скачка');
  const mid = weatherMix(s, start + WEATHER_TRANSITION_MS / 2);
  assert.ok(mid.blend > 0.4 && mid.blend < 0.6);
  const after = weatherMix(s, start + WEATHER_TRANSITION_MS);
  assert.equal(after.from, after.to);
});

test('шкала Бофорта: баллы и четыре группы уровня ветра', () => {
  assert.equal(beaufort(0.2), 0);
  assert.equal(beaufort(3.3), 2);
  assert.equal(beaufort(5.5), 4);
  assert.equal(beaufort(10.8), 6);
  assert.equal(beaufort(20.8), 9);
  assert.equal(beaufort(40), 12);
  assert.deepEqual([4, 8, 15, 25].map(windLevel), [1, 2, 3, 4]);
  assert.equal(windLevel(1), 0, 'штиль индикатор приглушает');
  // Границы групп совпадают с баллами Бофорта.
  assert.deepEqual([...SCALES.windLow].slice(1), [0.5, 5.5, 10.8, 20.8]);
  assert.deepEqual([...SCALES.windHigh].slice(1), [5.4, 10.7, 20.7, 32.7]);
});

test('ветер ровный по уровню: средний держится в группе Бофорта, порывы сверху', () => {
  for (const level of [1, 2, 3, 4]) {
    const s = { weather: 'clear', weatherTuning: { wind: level, gusts: 1 } };
    const speeds = windSamples(s, 5).map((w) => w.speed);
    const min = Math.min(...speeds),
      max = Math.max(...speeds);
    assert.ok(min >= SCALES.windLow[level] - 1e-9, `уровень ${level}: минимум ${min.toFixed(2)}`);
    // Ровный ветер (порывы ×1.2) выходит за группу не больше чем на 20 %.
    assert.ok(max <= SCALES.windHigh[level] * 1.2 + 1e-9, `уровень ${level}: максимум ${max.toFixed(2)}`);
    assert.ok(max - min > (SCALES.windHigh[level] - SCALES.windLow[level]) * 0.3, `уровень ${level}: сила гуляет`);
  }
});

test('ветер меняется без рывков, порывистость и направление настраиваются', () => {
  const samples = windSamples({ weather: 'storm' });
  let maxStep = 0;
  for (let i = 1; i < samples.length; i++)
    maxStep = Math.max(maxStep, Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z));
  assert.ok(maxStep < 1.5, `за кадр ветер меняется плавно: ${maxStep.toFixed(3)}`);

  const peak = (gusts) => Math.max(...windSamples({ weather: 'clear', weatherTuning: { wind: 3, gusts } }, 5).map((w) => w.speed));
  assert.ok(peak(4) > peak(1) * 1.3, 'шквалистый ветер сильнее ровного в порывах');

  const spread = (direction) => {
    const angles = windSamples({ weather: 'clear', weatherTuning: { wind: 3, direction } }, 2).map((w) => Math.atan2(w.x, -w.z));
    let turn = 0;
    for (let i = 1; i < angles.length; i++) {
      let d = angles[i] - angles[i - 1];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      turn += Math.abs(d);
    }
    return turn;
  };
  assert.ok(spread(4) > spread(1) * 3, 'переменное направление виляет сильнее устойчивого');
});

test('ручные уровни перекрывают погоду, остальное берётся из неё', () => {
  const levels = weatherLevels({ weather: 'snow', weatherTuning: { fog: 4 } }, T0);
  assert.equal(levels.fog, 4);
  assert.equal(levels.snow, WEATHER_PRESETS.snow.snow);
  // Недопустимое в состоянии игнорируется, а не ломает расчёт.
  assert.equal(weatherLevels({ weather: 'clear', weatherTuning: { wind: 0, rain: 9 } }, T0).wind, 1);
});

test('густота: чем выше уровень, тем ближе видимость и гуще осадки', () => {
  const look = (tuning) => weatherLook({ weather: 'clear', weatherTuning: tuning }, T0);
  assert.equal(look({}).visibility, OPEN_VISIBILITY);
  for (const param of ['fog', 'snow', 'blizzard', 'dust']) {
    const vis = [1, 2, 3, 4].map((level) => look({ [param]: level }).visibility);
    for (let i = 1; i < 4; i++) assert.ok(vis[i] < vis[i - 1], `${param}: видимость падает ${vis.join(' > ')}`);
  }
  const rain = [1, 2, 3, 4].map((level) => look({ rain: level }).rain);
  const hail = [1, 2, 3, 4].map((level) => look({ hail: level }).hailSize);
  const flashes = [1, 2, 3, 4].map((level) => look({ lightning: level }).lightningPerMinute);
  for (const series of [rain, hail, flashes]) for (let i = 1; i < 4; i++) assert.ok(series[i] > series[i - 1]);
  // Позёмок у земли, буран — выше роста и со снегопадом.
  assert.ok(look({ blizzard: 1 }).driftHeight < 2 && look({ blizzard: 1 }).snow === 0);
  assert.ok(look({ blizzard: 4 }).driftHeight > 5 && look({ blizzard: 4 }).snow > 0.5);
  assert.equal(look({ clouds: 4 }).overcast, 1);
});

test('снос игрока ограничен и не выходит за серверный предел скорости', () => {
  const push = windPush({ x: 60, z: 0 }, { stance: 'stand', moving: true, airborne: true });
  assert.ok(Math.hypot(push.x, push.z) <= MAX_WIND_PUSH + 1e-9);
  assert.ok(4.8 + MAX_WIND_PUSH < 7.2);
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
  assert.ok(Math.abs(windRelative({ x: 0, z: -5 }, 0).angle) < 1e-9, 'попутный — стрелка вверх');
  assert.ok(Math.abs(windRelative({ x: 5, z: 0 }, 0).angle - Math.PI / 2) < 1e-9, 'сносит вправо');
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
  const s1 = run(s0, { type: 'room.settings', patch: { weather: 'hail', windEffects: false } });
  assert.equal(s1.weather, 'hail');
  assert.equal(s1.windEffects, false);
  assert.throws(() => run(s1, { type: 'room.settings', patch: { weather: 'tornado' } }));
  assert.throws(() => run(s1, { type: 'room.settings', patch: { weather: 'rain' } }, 'guest'));
});

test('ручные уровни: частичный патч, возврат к погоде и сброс', () => {
  const s0 = initialState('Бой');
  const s1 = run(s0, { type: 'room.settings', patch: { weatherTuning: { wind: 4, fog: 3 } } });
  assert.deepEqual(s1.weatherTuning, { wind: 4, fog: 3 });
  const s2 = run(s1, { type: 'room.settings', patch: { weatherTuning: { fog: null, rain: 0 } } });
  assert.deepEqual(s2.weatherTuning, { wind: 4, rain: 0 });
  const s3 = run(s2, { type: 'room.settings', patch: { weatherTuning: null } });
  assert.equal(s3.weatherTuning, undefined);
  for (const bad of [{ wind: 0 }, { fog: 5 }, { fog: 1.5 }, { tornado: 1 }, [1]])
    assert.throws(() => run(s1, { type: 'room.settings', patch: { weatherTuning: bad } }), JSON.stringify(bad));
  assert.throws(() => run(s1, { type: 'room.settings', patch: { weatherTuning: { fog: 1 } } }, 'guest'));
});

test('крыши: под перекрытием осадков и сноса нет, на улице есть', async () => {
  const { buildArena, perimeterWalls } = await import('../lib/maps/types.ts');
  const { getMap } = await import('../lib/maps/index.ts');
  const { buildRoofMap, openShare, OPEN_SKY, roofAt, underRoof } = await import('../lib/weather-shelter.ts');
  const bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
  const map = buildArena({
    id: 'roof-test',
    title: 'roof-test',
    bounds,
    groundColor: '#000',
    boxes: [
      ...perimeterWalls(bounds),
      // Дом x 0..6, z 0..6: стена от земли и крыша-плита на высоте 3 м.
      { x: 3, y: 1.5, z: 0.1, w: 6, h: 3, d: 0.2, color: '#000', solid: true },
      { x: 3, y: 3.1, z: 3, w: 6, h: 0.2, d: 6, color: '#000', floor: true },
      // Навес x -8..-6 на 2 м и ящик на земле рядом.
      { x: -7, y: 2.1, z: -7, w: 2, h: 0.2, d: 2, color: '#000', solid: true },
      { x: -3, y: 0.5, z: -3, w: 1, h: 1, d: 1, color: '#000', solid: true },
    ],
    spawns: { red: [{ x: 0, z: 8 }], blue: [{ x: 0, z: -8 }] },
  });
  const roof = buildRoofMap(map);
  assert.ok(Math.abs(roofAt(roof, 3, 3) - 3) < 1e-6, 'в доме перекрытие на 3 м');
  assert.ok(underRoof(roof, 3, 1, 3), 'дождь внутри дома скрыт');
  assert.ok(!underRoof(roof, 3, 3.5, 3), 'а на крыше идёт');
  assert.equal(roofAt(roof, -7, -7), 2, 'навес');
  assert.equal(roofAt(roof, -3, -3), OPEN_SKY, 'ящик на земле не крыша');
  assert.equal(roofAt(roof, -5, 5), OPEN_SKY, 'двор открыт');
  // Выстрел из дома наружу сносит только на уличной половине пути.
  const share = openShare(roof, [3, 1.5, 3], [3, 1.5, -3]);
  assert.ok(share > 0.4 && share < 0.6, `доля открытого пути ${share}`);
  assert.equal(openShare(roof, [-5, 1.5, 5], [-5, 1.5, -5]), 1);
  // Настоящие карты: комната особняка под крышей, хаб — площадь открыта, корпус под крышей.
  const mansion = buildRoofMap(getMap('mansion'));
  assert.ok(underRoof(mansion, -22.4, 1, -7.6));
  assert.ok(!underRoof(mansion, 0, 1, 0));
  const hub = buildRoofMap(getMap('hub'));
  assert.ok(underRoof(hub, 0, 1, -18));
  assert.ok(!underRoof(hub, 0, 1, 4));
});

test('«Туман: нет» убирает и дымку от осадков, «авто» её оставляет', () => {
  for (const weather of ['blizzard', 'storm', 'snow', 'dust', 'fog']) {
    assert.equal(weatherLook({ weather, weatherTuning: { fog: 0 } }, T0).visibility, OPEN_VISIBILITY, weather);
  }
  assert.ok(weatherLook({ weather: 'blizzard' }, T0).visibility < 60, 'без ручного тумана метель урезает видимость');
  // Ручной уровень задаёт видимость ровно по шкале тумана, даже в пыльную бурю.
  assert.equal(weatherLook({ weather: 'dust', weatherTuning: { fog: 1 } }, T0).visibility, SCALES.fogVisibility[1]);
});

test('частота смены погоды «авто»: слот, переход и валидация', async () => {
  const { autoWeather: pick, nextWeatherChangeIn, weatherTiming, WEATHER_PERIODS } = await import('../lib/weather.ts');
  assert.deepEqual(weatherTiming({}), { slot: WEATHER_SLOT_MS, transition: WEATHER_TRANSITION_MS }, 'по умолчанию 4 минуты');
  assert.deepEqual(weatherTiming({ weatherPeriod: 1 }), { slot: 60_000, transition: 15_000 }, 'переход — четверть короткого слота');
  assert.deepEqual(weatherTiming({ weatherPeriod: 60 }), { slot: 3_600_000, transition: WEATHER_TRANSITION_MS });
  assert.equal(weatherTiming({ weatherPeriod: 7 }).slot, WEATHER_SLOT_MS, 'чужое значение — по умолчанию');
  // Погода держится ровно период: в середине часового слота та же, что в его начале.
  const hour = { weather: 'auto', season: 'autumn', weatherPeriod: 60 };
  const start = Math.ceil(T0 / 3_600_000) * 3_600_000;
  const at = (t) => weatherMix(hour, t);
  assert.equal(at(start + 60_000).to, at(start + 59 * 60_000).to);
  assert.equal(at(start + 60_000).to, pick('autumn', start / 3_600_000));
  assert.equal(nextWeatherChangeIn(hour, start + 10 * 60_000), 50 * 60_000);
  // Каждую минуту погода может смениться, и за час их хотя бы несколько разных.
  const minute = { weather: 'auto', season: 'autumn', weatherPeriod: 1 };
  const kinds = new Set();
  for (let m = 0; m < 60; m++) kinds.add(weatherMix(minute, start + m * 60_000 + 30_000).to);
  assert.ok(kinds.size >= 3);

  const s0 = initialState('Погода');
  for (const minutes of WEATHER_PERIODS)
    assert.equal(run(s0, { type: 'room.settings', patch: { weatherPeriod: minutes } }).weatherPeriod, minutes);
  for (const bad of [0, 3, -1, '4', null])
    assert.throws(() => run(s0, { type: 'room.settings', patch: { weatherPeriod: bad } }), String(bad));
  assert.throws(() => run(s0, { type: 'room.settings', patch: { weatherPeriod: 8 } }, 'guest'));
});
