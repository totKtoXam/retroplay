// Погода и ветер. Модуль чистый, как lib/day-cycle.ts: без three.js, React и
// Date.now() внутри расчётов. Погода и ветер выводятся из состояния комнаты и
// серверных часов, поэтому у всех игроков идёт один и тот же дождь и дует один
// и тот же ветер — хранить их в состоянии и рассылать каждый кадр не нужно.
//
// Устройство: вид погоды («Метель», «Буря») — это пресет, набор уровней 0–4 по
// параметрам (ветер, туман, снег…). Любой параметр ведущий может переопределить
// своим уровнем (`weatherTuning`). Уровни опираются на настоящие шкалы — Бофорта,
// окты, код видимости, интенсивность осадков ВМО, LAL, TORRO, — а физические
// величины лежат таблицами (SCALES), чтобы их можно было подкрутить без миграций.

export const WEATHER_KINDS = ['clear', 'cloudy', 'fog', 'rain', 'storm', 'snow', 'blizzard', 'hail', 'dust'] as const;
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
  hail: { label: 'Град', icon: '🧊' },
  dust: { label: 'Пыльная буря', icon: '🏜️' },
};

/** Параметры погоды, у каждого своя шкала и уровни 0–4 (0 — явления нет). */
export const WEATHER_PARAMS = [
  'wind',
  'gusts',
  'direction',
  'clouds',
  'fog',
  'rain',
  'snow',
  'blizzard',
  'lightning',
  'hail',
  'dust',
] as const;
export type WeatherParam = (typeof WEATHER_PARAMS)[number];
/** Уровни по параметрам. После смешивания двух погод бывают дробными. */
export type WeatherLevels = Record<WeatherParam, number>;
/** Переопределения ведущего: нет ключа — уровень берётся из погоды. */
export type WeatherTuning = Partial<Record<WeatherParam, number>>;

export type ParamInfo = {
  label: string;
  /** Откуда шкала — для подсказки в интерфейсе. */
  scale: string;
  /** Нижний уровень: у ветра, порывов и направления «нуля» нет. */
  min: 0 | 1;
  /** Уровни 0–4: короткое имя и расшифровка по шкале. */
  levels: [string, string][];
};

export const WEATHER_PARAM_INFO: Record<WeatherParam, ParamInfo> = {
  wind: {
    label: 'Ветер',
    scale: 'шкала Бофорта, средняя скорость',
    min: 1,
    levels: [
      ['—', ''],
      ['Слабый', '0–3 балла, до 5.4 м/с'],
      ['Умеренный', '4–5 баллов, 5.5–10.7 м/с'],
      ['Сильный', '6–8 баллов, 10.8–20.7 м/с'],
      ['Шторм', '9–12 баллов, от 20.8 м/с'],
    ],
  },
  gusts: {
    label: 'Порывы',
    scale: 'коэффициент порывистости: порыв к среднему ветру',
    min: 1,
    levels: [
      ['—', ''],
      ['Ровный', 'порывы до ×1.2'],
      ['Умеренные', 'порывы до ×1.4'],
      ['Порывистый', 'порывы до ×1.6'],
      ['Шквалистый', 'порывы до ×2 — шквал по ВМО'],
    ],
  },
  direction: {
    label: 'Направление',
    scale: 'устойчивость направления, как в сводках METAR',
    min: 1,
    levels: [
      ['—', ''],
      ['Устойчивое', 'колебания ±15°'],
      ['Колеблется', 'колебания ±45°'],
      ['Неустойчивое', 'колебания ±90°'],
      ['Переменное', 'VRB: дует с любой стороны'],
    ],
  },
  clouds: {
    label: 'Облачность',
    scale: 'окты — восьмые доли неба',
    min: 0,
    levels: [
      ['Ясно', '0 окт'],
      ['Малооблачно', '1–2 окты (FEW)'],
      ['Облачно', '3–4 окты (SCT)'],
      ['Значительная', '5–7 окт (BKN)'],
      ['Сплошная', '8 окт (OVC)'],
    ],
  },
  fog: {
    label: 'Туман',
    scale: 'международный код видимости; в игре дистанции сжаты',
    min: 0,
    levels: [
      ['Нет', 'без тумана'],
      ['Слабый', 'видимость 500–1000 м (код 3)'],
      ['Умеренный', 'видимость 200–500 м (код 2)'],
      ['Густой', 'видимость 50–200 м (код 1)'],
      ['Очень густой', 'видимость меньше 50 м (код 0)'],
    ],
  },
  rain: {
    label: 'Дождь',
    scale: 'интенсивность осадков ВМО',
    min: 0,
    levels: [
      ['Нет', 'без дождя'],
      ['Слабый', 'до 2.5 мм/ч'],
      ['Умеренный', '2.5–7.6 мм/ч'],
      ['Сильный', '7.6–50 мм/ч'],
      ['Ливень', 'больше 50 мм/ч'],
    ],
  },
  snow: {
    label: 'Снегопад',
    scale: 'интенсивность снега по видимости (NWS)',
    min: 0,
    levels: [
      ['Нет', 'без снега'],
      ['Слабый', 'видимость больше 1 км'],
      ['Умеренный', 'видимость 0.5–1 км'],
      ['Сильный', 'видимость меньше 400 м'],
      ['Очень сильный', 'видимость меньше 200 м'],
    ],
  },
  blizzard: {
    label: 'Метель',
    scale: 'тип метели',
    min: 0,
    levels: [
      ['Нет', 'снег не переносится'],
      ['Позёмок', 'ветер гонит снег у самой земли'],
      ['Низовая', 'поднятый снег выше роста, без снегопада'],
      ['Общая', 'снегопад вместе с переносом снега'],
      ['Буран', 'ветер от 15.6 м/с и видимость меньше 400 м'],
    ],
  },
  lightning: {
    label: 'Гроза',
    scale: 'LAL — уровень грозовой активности',
    min: 0,
    levels: [
      ['Нет', 'без молний'],
      ['Редкие', 'отдельные молнии'],
      ['Рассеянные', 'несколько молний в минуту'],
      ['Частые', 'молния каждые несколько секунд'],
      ['Непрерывные', 'почти непрерывные вспышки'],
    ],
  },
  hail: {
    label: 'Град',
    scale: 'шкала TORRO',
    min: 0,
    levels: [
      ['Нет', 'без града'],
      ['Мелкий', 'H0–H1, 5–15 мм'],
      ['Средний', 'H2–H4, 20–40 мм'],
      ['Крупный', 'H5–H7, 40–75 мм'],
      ['Гигантский', 'H8–H10, больше 75 мм'],
    ],
  },
  dust: {
    label: 'Пыль',
    scale: 'пыльные явления ВМО',
    min: 0,
    levels: [
      ['Нет', 'чистый воздух'],
      ['Мгла', 'пыльная дымка, видимость несколько км'],
      ['Поднятая', 'ветер поднимает пыль'],
      ['Буря', 'пыльная буря, видимость меньше 1 км'],
      ['Сильная буря', 'видимость меньше 200 м'],
    ],
  },
};

const preset = (
  wind: number,
  gusts: number,
  direction: number,
  clouds: number,
  extra: Partial<WeatherLevels> = {},
): WeatherLevels => ({
  wind,
  gusts,
  direction,
  clouds,
  fog: 0,
  rain: 0,
  snow: 0,
  blizzard: 0,
  lightning: 0,
  hail: 0,
  dust: 0,
  ...extra,
});

/** Уровни, которые задаёт каждый вид погоды. */
export const WEATHER_PRESETS: Record<WeatherKind, WeatherLevels> = {
  clear: preset(1, 1, 1, 0),
  cloudy: preset(2, 2, 2, 3),
  fog: preset(1, 1, 2, 3, { fog: 3 }),
  rain: preset(2, 2, 2, 4, { fog: 1, rain: 2 }),
  storm: preset(3, 4, 3, 4, { fog: 1, rain: 4, lightning: 3 }),
  snow: preset(1, 1, 2, 4, { fog: 1, snow: 2 }),
  blizzard: preset(3, 3, 3, 4, { fog: 1, snow: 3, blizzard: 4 }),
  hail: preset(2, 3, 2, 4, { rain: 2, lightning: 2, hail: 2 }),
  dust: preset(3, 3, 2, 1, { dust: 3 }),
};

/** Того минимума из состояния комнаты, что нужен расчёту. */
export type WeatherSource = { weather?: string; season?: string; weatherTuning?: WeatherTuning | null };

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
  spring: { clear: 3, cloudy: 3, rain: 3, fog: 1, storm: 1, hail: 0.5 },
  summer: { clear: 5, cloudy: 2, rain: 1.5, storm: 1.5, hail: 0.6, dust: 0.7 },
  autumn: { clear: 1.5, cloudy: 3, rain: 3, fog: 2, storm: 1, snow: 0.5, dust: 0.3 },
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

/** Допустимый уровень параметра или null, если значение не годится. */
export function tuningLevel(param: WeatherParam, value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= WEATHER_PARAM_INFO[param].min && value <= 4 ? value : null;
}

/** Уровни погоды сейчас: смесь пресетов и поверх — переопределения ведущего. */
export function weatherLevels(s: WeatherSource, now: number): WeatherLevels {
  const m = weatherMix(s, now);
  const a = WEATHER_PRESETS[m.from],
    b = WEATHER_PRESETS[m.to];
  const out = { ...a };
  for (const key of WEATHER_PARAMS) {
    const fixed = tuningLevel(key, s.weatherTuning?.[key]);
    out[key] = fixed ?? a[key] + (b[key] - a[key]) * m.blend;
  }
  return out;
}

/** Значение таблицы «по уровню 0–4» для дробного уровня. */
export function levelValue(table: readonly number[], level: number): number {
  const l = Math.max(0, Math.min(table.length - 1, level));
  const i = Math.min(table.length - 2, Math.floor(l));
  return table[i] + (table[i + 1] - table[i]) * (l - i);
}

/** Видимость, которую погода не ограничивает, м. */
export const OPEN_VISIBILITY = 1000;

/** Физика уровней: индекс в каждой таблице — уровень 0–4. */
export const SCALES = {
  /** Бофорт по группам: нижняя и верхняя граница средней скорости, м/с. */
  windLow: [0, 0.5, 5.5, 10.8, 20.8],
  windHigh: [0, 5.4, 10.7, 20.7, 32.7],
  gustFactor: [1, 1.2, 1.4, 1.6, 2],
  /** Колебания направления, рад: ±15°, ±45°, ±90°, с любой стороны. */
  directionSpread: [0, Math.PI / 12, Math.PI / 4, Math.PI / 2, Math.PI],
  oktas: [0, 1.5, 3.5, 6, 8],
  /**
   * Видимость в игре, м. Реальные 500–1000 м на карте шириной 60–100 м были бы
   * незаметны, поэтому код видимости сжат примерно в пять раз.
   */
  fogVisibility: [OPEN_VISIBILITY, 160, 90, 45, 20],
  rainDensity: [0, 0.2, 0.45, 0.75, 1],
  /** Сильный дождь сам по себе съедает видимость. */
  rainVisibility: [OPEN_VISIBILITY, OPEN_VISIBILITY, 180, 110, 60],
  snowDensity: [0, 0.2, 0.45, 0.75, 1],
  snowVisibility: [OPEN_VISIBILITY, 190, 130, 70, 35],
  /** Метель: сколько снега несёт ветер и до какой высоты, м. */
  driftDensity: [0, 0.45, 0.8, 0.85, 1],
  driftHeight: [0, 1.2, 5, 8, 14],
  /** Общая метель и буран — это ещё и снегопад. */
  blizzardSnow: [0, 0, 0, 0.6, 1],
  blizzardVisibility: [OPEN_VISIBILITY, OPEN_VISIBILITY, 75, 50, 22],
  /** Молний в минуту. */
  lightningPerMinute: [0, 1, 3, 7, 16],
  hailDensity: [0, 0.3, 0.5, 0.7, 0.9],
  /** Диаметр градины, м (TORRO). */
  hailSize: [0, 0.012, 0.028, 0.05, 0.08],
  dustDensity: [0, 0.15, 0.45, 0.8, 1],
  dustVisibility: [OPEN_VISIBILITY, 220, 120, 45, 16],
} as const;

/** Всё, что погода меняет в мире; числа смешиваются и сглаживаются линейно. */
export type WeatherLook = {
  /** Плотность дождя, снегопада, метели, града и пыли, 0..1. */
  rain: number;
  snow: number;
  drift: number;
  /** До какой высоты над землёй метель несёт снег, м. */
  driftHeight: number;
  hail: number;
  hailSize: number;
  dust: number;
  /** Насколько небо затянуто, 0..1. */
  overcast: number;
  /** Дальность видимости, м (OPEN_VISIBILITY — погода не ограничивает). */
  visibility: number;
  /** Множители экспозиции и прямого солнца. */
  exposure: number;
  sun: number;
  lightningPerMinute: number;
  /** Средний ветер гуляет внутри группы Бофорта; порывы — сверху. */
  windLow: number;
  windHigh: number;
  gustFactor: number;
  directionSpread: number;
};

export function lookFromLevels(v: WeatherLevels): WeatherLook {
  const overcast = levelValue(SCALES.oktas, v.clouds) / 8;
  const rain = levelValue(SCALES.rainDensity, v.rain);
  const dust = levelValue(SCALES.dustDensity, v.dust);
  const visibility = Math.min(
    levelValue(SCALES.fogVisibility, v.fog),
    levelValue(SCALES.rainVisibility, v.rain),
    levelValue(SCALES.snowVisibility, v.snow),
    levelValue(SCALES.blizzardVisibility, v.blizzard),
    levelValue(SCALES.dustVisibility, v.dust),
  );
  // Чем ближе видимость, тем меньше прямого солнца доходит до земли.
  const murk = 1 - Math.min(1, visibility / 160);
  return {
    rain,
    snow: Math.max(levelValue(SCALES.snowDensity, v.snow), levelValue(SCALES.blizzardSnow, v.blizzard)),
    drift: levelValue(SCALES.driftDensity, v.blizzard),
    driftHeight: levelValue(SCALES.driftHeight, v.blizzard),
    hail: levelValue(SCALES.hailDensity, v.hail),
    hailSize: levelValue(SCALES.hailSize, v.hail),
    dust,
    overcast,
    visibility,
    exposure: Math.max(0.5, 1 - overcast * 0.2 - rain * 0.14 - dust * 0.12 - murk * 0.08),
    sun: Math.max(0.1, 1 - overcast * 0.8 - dust * 0.4 - murk * 0.5),
    lightningPerMinute: levelValue(SCALES.lightningPerMinute, v.lightning),
    windLow: levelValue(SCALES.windLow, v.wind),
    windHigh: levelValue(SCALES.windHigh, v.wind),
    gustFactor: levelValue(SCALES.gustFactor, v.gusts),
    directionSpread: levelValue(SCALES.directionSpread, v.direction),
  };
}

export const weatherLook = (s: WeatherSource, now: number): WeatherLook => lookFromLevels(weatherLevels(s, now));

/**
 * Ветер: вектор (x, z) — куда дует, м/с по горизонтали. Направление медленно
 * гуляет, скорость дышит, а поверх идут порывы — как в жизни, без констант.
 */
export type Wind = { x: number; z: number; speed: number };

/** Слегка «фрактальный» шум: три октавы. */
const fbm = (t: number, seed: number) =>
  noise1(t, seed) * 0.55 + noise1(t * 2.3 + 17, seed + 1) * 0.3 + noise1(t * 5.1 + 41, seed + 2) * 0.15;

export function windFromLook(
  look: Pick<WeatherLook, 'windLow' | 'windHigh' | 'gustFactor' | 'directionSpread'>,
  now: number,
): Wind {
  const t = now / 1000;
  // Преобладающее направление дрейфует за десятки минут; вокруг него ветер виляет
  // тем шире, чем неустойчивее направление (вплоть до «переменного»).
  const angle =
    noise1(t / 900, 11) * Math.PI * 4 +
    (noise1(t / 120, 12) - 0.5) * 0.6 +
    (fbm(t / 6, 13) - 0.5) * 2.6 * look.directionSpread;
  // Средний ветер гуляет внутри группы Бофорта, порывы добавляются сверху.
  const breathing = Math.min(1, Math.max(0, (fbm(t / 40, 21) - 0.2) / 0.6));
  const mean = look.windLow + (look.windHigh - look.windLow) * breathing;
  const gustiness = Math.min(1, Math.max(0, fbm(t / 3.5, 31) - 0.42) / 0.35);
  const speed = Math.max(0, mean * (1 + (look.gustFactor - 1) * gustiness * gustiness));
  return { x: Math.sin(angle) * speed, z: -Math.cos(angle) * speed, speed };
}

export const windAt = (s: WeatherSource, now: number): Wind => windFromLook(weatherLook(s, now), now);

/** Балл Бофорта по скорости ветра, 0–12. */
export function beaufort(speed: number): number {
  const upper = [0.5, 1.5, 3.3, 5.4, 7.9, 10.7, 13.8, 17.1, 20.7, 24.4, 28.4, 32.6];
  const i = upper.findIndex((u) => speed < u + 0.05);
  return i === -1 ? 12 : i;
}

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

/**
 * Группа ветра для индикатора — те же четыре группы Бофорта, что в настройке:
 * 1 — слабый (0–3 б.), 2 — умеренный (4–5), 3 — сильный (6–8), 4 — шторм (9–12).
 * 0 — штиль и тихий ветер (0–1 б.): индикатор при нём приглушён.
 */
export function windLevel(speed: number): number {
  const b = beaufort(speed);
  return b <= 1 ? 0 : b <= 3 ? 1 : b <= 5 ? 2 : b <= 8 ? 3 : 4;
}
