// Идущие внутриигровые сутки. Модуль намеренно чистый (без three.js, React и
// Date.now() внутри расчётов): одни и те же функции считают время суток и на
// воркере, и в интерфейсе комнаты, и в 3D-сцене — иначе у игроков разъехалась
// бы картинка.
//
// Почему не таймер на клиенте: у каждого свой старт вкладки и свой дрейф часов,
// и через пару кругов один играл бы в полдень, другой — в полночь. Поэтому в
// состоянии комнаты лежит только якорь на серверных часах (`anchor`), а «который
// час» каждый выводит из него сам. Сервер рассылает свой `now` в каждом тике
// (worker/room-hub.ts), клиент держит поправку к локальным часам
// (`clockRef` в components/use-room-sync.ts) — этого достаточно, чтобы общее
// время совпадало с точностью до пинга.

export const TIMES_OF_DAY = ['dawn', 'day', 'sunset', 'night'] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/** Одна фаза суток — 3 минуты, полные сутки — 12 минут. */
export const DAY_PHASE_MS = 3 * 60_000;
export const DAY_LENGTH_MS = DAY_PHASE_MS * TIMES_OF_DAY.length;
/** Игровых часов в одной фазе: 24 часа поровну на четыре фазы. */
export const HOURS_PER_PHASE = 24 / TIMES_OF_DAY.length;
/**
 * Сутки начинаются с рассвета в 03:00. Точка выбрана так, чтобы середины фаз —
 * а по ним строится освещение — попали ровно на 06:00, 12:00, 18:00 и 00:00.
 */
export const DAY_START_HOUR = 3;

/**
 * Состояние цикла в комнате. `anchor` — момент серверных часов, которому
 * соответствует позиция 0 (начало рассвета). Пока цикл стоит, время берётся из
 * обычного `state.time`, и старые комнаты без этого поля работают как раньше.
 */
export type DayCycle = { running: boolean; anchor: number };

/** Того минимума из состояния комнаты, что нужен расчёту. */
export type DaySource = { time?: string; dayCycle?: DayCycle | null };

export function timeOfDay(value: unknown): TimeOfDay {
  return TIMES_OF_DAY.includes(value as TimeOfDay) ? (value as TimeOfDay) : 'day';
}

/**
 * Позиция внутри суток в «фазах»: 0 — начало рассвета, 1.5 — полдень, 4 — снова
 * рассвет. Остановленный цикл стоит ровно в середине выбранной вручную фазы:
 * ручной «День» обязан выглядеть как полдень, а не как его край.
 */
export function dayPosition(s: DaySource, now: number): number {
  const cycle = s.dayCycle;
  if (!cycle?.running) return TIMES_OF_DAY.indexOf(timeOfDay(s.time)) + 0.5;
  const elapsed = (((now - cycle.anchor) % DAY_LENGTH_MS) + DAY_LENGTH_MS) % DAY_LENGTH_MS;
  return elapsed / DAY_PHASE_MS;
}

/**
 * Якорь, с которым запущенный цикл продолжится ровно с того, что сейчас на
 * экране. Без этого мир прыгал бы в другое время в момент нажатия кнопки.
 */
export function anchorFor(s: DaySource, now: number): number {
  return Math.round(now - dayPosition(s, now) * DAY_PHASE_MS);
}

export type DayMoment = {
  running: boolean;
  /** Текущая фаза суток. */
  time: TimeOfDay;
  /** Какая фаза наступит следующей. */
  next: TimeOfDay;
  /** Игровое время: 0–23 часа и 0–59 минут. */
  hours: number;
  minutes: number;
  /** Доля пройденной фазы, 0..1. */
  progress: number;
  /** Секунд до смены фазы; у остановленных суток — 0. */
  secondsLeft: number;
};

/** Что показывать часам в интерфейсе. */
export function dayMoment(s: DaySource, now: number): DayMoment {
  const cycle = s.dayCycle?.running ? s.dayCycle : null;
  const position = dayPosition(s, now);
  const index = Math.floor(position) % TIMES_OF_DAY.length;
  const progress = position - Math.floor(position);
  const running = !!s.dayCycle?.running;
  const clock = (DAY_START_HOUR + position * HOURS_PER_PHASE) % 24;
  const hours = Math.floor(clock);
  // Остаток фазы считается в целых миллисекундах от якоря, а не из доли
  // `progress`: 1/3 фазы в double даёт 120.000000001 с и «121 с до заката».
  const sincePhase = cycle
    ? (((now - cycle.anchor) % DAY_PHASE_MS) + DAY_PHASE_MS) % DAY_PHASE_MS
    : 0;
  return {
    running,
    time: TIMES_OF_DAY[index],
    next: TIMES_OF_DAY[(index + 1) % TIMES_OF_DAY.length],
    hours,
    minutes: Math.floor((clock - hours) * 60),
    progress,
    secondsLeft: running ? Math.ceil((DAY_PHASE_MS - sincePhase) / 1000) : 0,
  };
}

/**
 * Смесь двух палитр для освещения. Ключевые палитры стоят в серединах фаз —
 * в полдень сцена выглядит ровно так, как её задаёт ручной «День», — а между
 * серединами свет перетекает. Иначе «идущие сутки» сводились бы к рывку раз в
 * три минуты, ради которого всё и затевалось.
 */
export type DayMix = { from: TimeOfDay; to: TimeOfDay; blend: number };

export function dayMix(s: DaySource, now: number): DayMix {
  const shifted =
    (((dayPosition(s, now) - 0.5) % TIMES_OF_DAY.length) + TIMES_OF_DAY.length) %
    TIMES_OF_DAY.length;
  const index = Math.floor(shifted);
  return {
    from: TIMES_OF_DAY[index],
    to: TIMES_OF_DAY[(index + 1) % TIMES_OF_DAY.length],
    blend: shifted - index,
  };
}

/** Линейная смесь числовых настроек по таблице «значение на фазу». */
export function mixValue(table: Record<TimeOfDay, number>, m: DayMix): number {
  return table[m.from] + (table[m.to] - table[m.from]) * m.blend;
}

/** Две соседние фазы совпадают — значит, свет можно не пересобирать. */
export const sameMix = (a: DayMix, b: DayMix) =>
  a.from === b.from && a.to === b.to && a.blend === b.blend;
