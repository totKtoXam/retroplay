// Погода и ветер. Модуль чистый, как lib/day-cycle.ts: без three.js, React и
// Date.now() внутри расчётов. Погода и ветер выводятся из состояния комнаты и
// серверных часов, поэтому у всех игроков идёт один и тот же дождь и дует один
// и тот же ветер — хранить их в состоянии и рассылать каждый кадр не нужно.

export const WEATHER_KINDS = ['clear', 'cloudy', 'fog', 'rain', 'storm', 'snow', 'blizzard'] as const;
export type WeatherKind = (typeof WEATHER_KINDS)[number];
/** Что может выбрать ведущий: конкретную погоду или «авто» — смену по сезону. */
export const WEATHER_SETTINGS = ['auto', ...WEATHER_KINDS] as const;
export type WeatherSetting = (typeof WEATHER_SETTINGS)[number];

export const WEATHER_LABELS: Record<WeatherSetting, { label: string; icon: string }> = {
  auto: { label: 'Авто', icon: '🔄' },
  clear: { label: 'Ясно', icon: '☀️' },
  cloudy: { label: 'Пасмурно', icon: '☁️' },
  fog: { label: 'Туман', icon: '🌫️' },
  rain: { label: 'Дождь', icon: '🌧️' },
  storm: { label: 'Буря', icon: '⛈️' },
  snow: { label: 'Снегопад', icon: '🌨️' },
  blizzard: { label: 'Метель', icon: '❄️' },
};

/** Того минимума из состояния комнаты, что нужен расчёту. */
export type WeatherSource = { weather?: string; season?: string };

/** В режиме «авто» погода держится 4 минуты и 45 секунд перетекает в следующую. */
export const WEATHER_SLOT_MS = 4 * 60_000;
export const WEATHER_TRANSITION_MS = 45_000;

export const weatherSetting = (value: unknown): WeatherSetting =>
  WEATHER_SETTINGS.includes(value as WeatherSetting) ? (value as WeatherSetting) : 'clear';

/** Детерминированный хэш целого в [0, 1). */
export function hash01(n: number): number {
  let x = Math.floor(n) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Гладкий одномерный шум в [0, 1]: значения в целых точках, между ними — smoothstep. */
export function noise1(t: number, seed = 0): number {
  const i = Math.floor(t),
    f = t - i,
    u = f * f * (3 - 2 * f);
  const a = hash01(i * 374761 + seed * 668265),
    b = hash01((i + 1) * 374761 + seed * 668265);
  return a + (b - a) * u;
}

/** Какая погода вероятна в каждом сезоне. Метели летом не бывает, грозы зимой — тоже. */
const SEASON_WEIGHTS: Record<string, Partial<Record<WeatherKind, number>>> = {
  spring: { clear: 3, cloudy: 3, rain: 3, fog: 1, storm: 1 },
  summer: { clear: 5, cloudy: 2, rain: 1.5, storm: 1.5 },
  autumn: { clear: 1.5, cloudy: 3, rain: 3, fog: 2, storm: 1, snow: 0.5 },
  winter: { clear: 2, cloudy: 2.5, snow: 3.5, blizzard: 1.5, fog: 1 },
};
const SEASON_SEED: Record<string, number> = { spring: 1, summer: 2, autumn: 3, winter: 4 };

/** Погода «авто» в слоте `slot` для сезона. */
export function autoWeather(season: string | undefined, slot: number): WeatherKind {
  const weights = SEASON_WEIGHTS[season ?? ''] ?? SEASON_WEIGHTS.summer;
  const entries = Object.entries(weights) as [WeatherKind, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let pick = hash01(slot * 7919 + (SEASON_SEED[season ?? ''] ?? 2) * 104729) * total;
  for (const [kind, w] of entries) {
    pick -= w;
    if (pick < 0) return kind;
  }
  return entries[entries.length - 1][0];
}

/** Смесь двух погод, как DayMix у суток: при `blend` 0 — ровно `from`. */
export type WeatherMix = { from: WeatherKind; to: WeatherKind; blend: number };

export function weatherMix(s: WeatherSource, now: number): WeatherMix {
  const setting = weatherSetting(s.weather);
  if (setting !== 'auto') return { from: setting, to: setting, blend: 0 };
  const slot = Math.floor(now / WEATHER_SLOT_MS);
  const current = autoWeather(s.season, slot);
  const into = now - slot * WEATHER_SLOT_MS;
  if (into >= WEATHER_TRANSITION_MS) return { from: current, to: current, blend: 0 };
  const previous = autoWeather(s.season, slot - 1);
  if (previous === current) return { from: current, to: current, blend: 0 };
  const t = into / WEATHER_TRANSITION_MS;
  return { from: previous, to: current, blend: t * t * (3 - 2 * t) };
}

/** Какая погода «сейчас» для подписи в интерфейсе. */
export const currentWeather = (m: WeatherMix): WeatherKind => (m.blend < 0.5 ? m.from : m.to);

/** Всё, что погода меняет в мире; числа смешиваются линейно. */
export type WeatherLook = {
  /** Плотность дождя и снега, 0..1. */
  rain: number;
  snow: number;
  /** Насколько небо затянуто, 0..1. */
  overcast: number;
  /** Насколько туман ближе обычного: дальняя граница умножается на (1 - fog). */
  fog: number;
  /** Множитель экспозиции и прямого солнца. */
  exposure: number;
  sun: number;
  /** Частота молний, 0..1. */
  lightning: number;
  /** Средний ветер и сила порывов, м/с. */
  wind: number;
  gust: number;
};

export const WEATHER_LOOKS: Record<WeatherKind, WeatherLook> = {
  clear: { rain: 0, snow: 0, overcast: 0, fog: 0, exposure: 1, sun: 1, lightning: 0, wind: 2, gust: 2.5 },
  cloudy: { rain: 0, snow: 0, overcast: 0.6, fog: 0.15, exposure: 0.84, sun: 0.45, lightning: 0, wind: 4.5, gust: 3.5 },
  fog: { rain: 0, snow: 0, overcast: 0.75, fog: 0.72, exposure: 0.88, sun: 0.35, lightning: 0, wind: 1, gust: 1 },
  rain: { rain: 0.6, snow: 0, overcast: 0.8, fog: 0.4, exposure: 0.74, sun: 0.3, lightning: 0, wind: 6, gust: 5 },
  storm: { rain: 1, snow: 0, overcast: 1, fog: 0.55, exposure: 0.58, sun: 0.15, lightning: 1, wind: 12, gust: 10 },
  snow: { rain: 0, snow: 0.6, overcast: 0.7, fog: 0.4, exposure: 0.9, sun: 0.4, lightning: 0, wind: 3, gust: 2.5 },
  blizzard: { rain: 0, snow: 1, overcast: 1, fog: 0.8, exposure: 0.78, sun: 0.15, lightning: 0, wind: 14, gust: 9 },
};

export function weatherLook(m: WeatherMix): WeatherLook {
  const a = WEATHER_LOOKS[m.from],
    b = WEATHER_LOOKS[m.to];
  const out = { ...a };
  for (const key of Object.keys(a) as (keyof WeatherLook)[]) out[key] = a[key] + (b[key] - a[key]) * m.blend;
  return out;
}

/**
 * Ветер: вектор (x, z) — куда дует, м/с по горизонтали. Направление медленно
 * гуляет, скорость дышит, а поверх идут порывы — как в жизни, без констант.
 */
export type Wind = { x: number; z: number; speed: number };

/** Слегка «фрактальный» шум: три октавы. */
const fbm = (t: number, seed: number) =>
  noise1(t, seed) * 0.55 + noise1(t * 2.3 + 17, seed + 1) * 0.3 + noise1(t * 5.1 + 41, seed + 2) * 0.15;

export function windFromLook(look: Pick<WeatherLook, 'wind' | 'gust'>, now: number): Wind {
  const t = now / 1000;
  // Преобладающее направление дрейфует за десятки минут, поверх — колебания за
  // минуты и короткое «виляние» в порывах.
  const angle =
    noise1(t / 900, 11) * Math.PI * 4 +
    (noise1(t / 120, 12) - 0.5) * 1.4 +
    (fbm(t / 6, 13) - 0.5) * 0.7;
  const breathing = 0.7 + 0.6 * fbm(t / 40, 21);
  const gustiness = Math.min(1, Math.max(0, fbm(t / 3.5, 31) - 0.42) / 0.35);
  const speed = Math.max(0, look.wind * breathing + look.gust * gustiness * gustiness);
  return { x: Math.sin(angle) * speed, z: -Math.cos(angle) * speed, speed };
}

export const windAt = (s: WeatherSource, now: number): Wind => windFromLook(weatherLook(weatherMix(s, now)), now);

/** Ветер слабее этого (м/с) стоящего на месте игрока не сдвигает: ноги держат. */
const GRIP_WIND = 8;
/** Сколько скорости ветра переходит в снос тела. */
const PUSH_SCALE = 0.085;
/**
 * Предел сноса, м/с. Бег 4.8 м/с плюс снос остаются ниже 7.2 м/с, которые
 * сервер пропускает при проверке движения (lib/room-hub-core.ts, MOVE_SPEED).
 */
export const MAX_WIND_PUSH = 1.8;
const STANCE_PUSH: Record<string, number> = { stand: 1, sit: 0.6, lie: 0.25 };

/** Скорость сноса игрока ветром, м/с. */
export function windPush(
  wind: { x: number; z: number },
  opts: { stance?: string; moving: boolean; airborne: boolean },
): { x: number; z: number } {
  const speed = Math.hypot(wind.x, wind.z);
  if (speed < 1e-6) return { x: 0, z: 0 };
  // Стоящего сносит только сильный ветер и только избытком над «сцеплением».
  const effective = opts.moving || opts.airborne ? speed : Math.max(0, speed - GRIP_WIND);
  let push =
    effective * PUSH_SCALE * (STANCE_PUSH[opts.stance ?? 'stand'] ?? 1) * (opts.airborne ? 1.3 : 1);
  push = Math.min(MAX_WIND_PUSH, push);
  return { x: (wind.x / speed) * push, z: (wind.z / speed) * push };
}

/**
 * Парусность снарядов: снос = ветер × k × дистанция². Квадрат — потому что
 * снаряд дольше летит на дальнюю цель и всё это время его сносит с ускорением.
 * Шарик краски лёгкий и медленный, фейерверк снайперки — быстрый и тяжёлый.
 * Лайкомёта здесь нет намеренно: им голосуют за стикеры на доске, и ветер не
 * должен решать, за какой стикер отдан голос. Граната летит своей дугой.
 */
export const WIND_DRIFT: Record<string, number> = {
  paint: 7e-5,
  confetti: 9e-5,
  sniper: 1.6e-5,
};
/** Снос не больше этой доли дистанции (≈4.6°): даже в бурю пуля летит в сторону прицела. */
const MAX_DRIFT_SHARE = 0.08;

export function windDrift(kind: string, wind: { x: number; z: number }, distance: number): { x: number; z: number } {
  const k = WIND_DRIFT[kind] ?? 0;
  if (!k || distance <= 0) return { x: 0, z: 0 };
  let x = wind.x * k * distance * distance,
    z = wind.z * k * distance * distance;
  const len = Math.hypot(x, z),
    cap = distance * MAX_DRIFT_SHARE;
  if (len > cap) {
    x *= cap / len;
    z *= cap / len;
  }
  return { x, z };
}

/**
 * Ветер относительно взгляда камеры: `side` > 0 — дует вправо, `ahead` > 0 —
 * от игрока вперёд (попутный). Направления движения те же, что у world-player:
 * вперёд — (-sin yaw, -cos yaw), вправо — (cos yaw, -sin yaw).
 */
export function windRelative(wind: { x: number; z: number }, yaw: number) {
  const side = wind.x * Math.cos(yaw) - wind.z * Math.sin(yaw),
    ahead = -wind.x * Math.sin(yaw) - wind.z * Math.cos(yaw);
  return { side, ahead, angle: Math.atan2(side, ahead) };
}

/** Шкала силы ветра для индикатора: 0 — штиль … 4 — шторм. */
export const windLevel = (speed: number) => (speed < 1.5 ? 0 : speed < 5 ? 1 : speed < 10 ? 2 : speed < 16 ? 3 : 4);
