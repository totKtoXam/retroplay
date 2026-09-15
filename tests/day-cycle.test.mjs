import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorFor,
  dayMix,
  dayMoment,
  dayPosition,
  mixValue,
  sameMix,
  DAY_LENGTH_MS,
  DAY_PHASE_MS,
  TIMES_OF_DAY,
} from '../lib/day-cycle.ts';
import { initialState, applyOperation } from '../lib/model.ts';

const run = (s, op, user = 'host') => applyOperation(s, op, user, 'host');
const running = (anchor) => ({ time: 'day', dayCycle: { running: true, anchor } });

test('полные сутки — 12 минут, по 3 минуты на фазу', () => {
  assert.equal(DAY_PHASE_MS, 180_000);
  assert.equal(DAY_LENGTH_MS, 720_000);
  assert.deepEqual([...TIMES_OF_DAY], ['dawn', 'day', 'sunset', 'night']);
});

test('идущие сутки проходят все четыре фазы по порядку', () => {
  const seen = [];
  for (let minute = 0; minute < 12; minute++)
    seen.push(dayMoment(running(0), minute * 60_000 + 30_000).time);
  assert.deepEqual(seen, [
    'dawn', 'dawn', 'dawn',
    'day', 'day', 'day',
    'sunset', 'sunset', 'sunset',
    'night', 'night', 'night',
  ]);
});

test('сутки зациклены: через 12 минут всё повторяется', () => {
  const first = dayMoment(running(0), 61_000);
  const later = dayMoment(running(0), 61_000 + DAY_LENGTH_MS * 3);
  assert.equal(later.time, first.time);
  assert.equal(later.hours, first.hours);
  assert.equal(later.minutes, first.minutes);
});

test('якорь в будущем и часы, отставшие от сервера, не ломают расчёт', () => {
  // Отрицательный остаток от % — классическая ловушка; позиция обязана
  // оставаться внутри суток при любом знаке разницы.
  for (const now of [-DAY_LENGTH_MS * 2 - 1, -1, 0, 1, DAY_LENGTH_MS * 5 + 7]) {
    const position = dayPosition(running(0), now);
    assert.ok(position >= 0 && position < 4, `позиция вне суток: ${position}`);
  }
});

test('все клиенты с одной серверной отметкой видят одно время', () => {
  // Единственный источник — якорь и общее `now`; никакого локального старта.
  const state = running(1_700_000_000_000);
  const now = 1_700_000_500_000;
  assert.deepEqual(dayMoment(state, now), dayMoment({ ...state }, now));
  // Разные комнаты с разными якорями живут по своему времени.
  assert.notEqual(
    dayMoment(running(0), now).time,
    dayMoment(running(DAY_PHASE_MS * 2), now).time,
  );
});

test('игровые часы идут от 03:00 и проходят полные сутки', () => {
  assert.deepEqual(
    [dayMoment(running(0), 0).hours, dayMoment(running(0), 0).minutes],
    [3, 0],
  );
  // Середины фаз — 06:00, 12:00, 18:00 и 00:00: именно они задают освещение.
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => dayMoment(running(0), DAY_PHASE_MS * (i + 0.5)).hours),
    [6, 12, 18, 0],
  );
  assert.equal(dayMoment(running(0), DAY_LENGTH_MS - 1).hours, 2);
});

test('часы показывают, сколько осталось до смены фазы', () => {
  const m = dayMoment(running(0), 60_000);
  assert.equal(m.time, 'dawn');
  assert.equal(m.next, 'day');
  assert.equal(m.secondsLeft, 120);
  assert.equal(Math.round(m.progress * 100), 33);
  // У остановленных суток отсчёта нет: показывать «0:00 до смены» нечестно.
  assert.equal(dayMoment({ time: 'night' }, 0).secondsLeft, 0);
});

test('освещение перетекает, а не прыгает раз в три минуты', () => {
  // В середине фазы — чистая палитра этой фазы.
  const noon = dayMix(running(0), DAY_PHASE_MS * 1.5);
  assert.equal(noon.from, 'day');
  assert.equal(noon.blend, 0);
  // На границе фаз — ровно половина между дневной и закатной палитрой.
  const edge = dayMix(running(0), DAY_PHASE_MS * 2);
  assert.equal(edge.from, 'day');
  assert.equal(edge.to, 'sunset');
  assert.equal(edge.blend, 0.5);
  assert.equal(mixValue({ dawn: 0, day: 0, sunset: 10, night: 0 }, edge), 5);
  // Смесь монотонно ползёт: соседние секунды не совпадают.
  assert.ok(!sameMix(dayMix(running(0), 0), dayMix(running(0), 1000)));
});

test('остановленные сутки стоят в середине выбранной фазы', () => {
  for (const time of TIMES_OF_DAY) {
    const m = dayMix({ time, dayCycle: { running: false, anchor: 0 } }, 12345);
    // Нулевая доля смешивания — значит, сцена берёт палитру `from` как есть.
    assert.equal(m.from, time);
    assert.equal(m.blend, 0);
  }
});

test('комната без dayCycle работает по старому статичному времени', () => {
  const m = dayMoment({ time: 'sunset' }, Date.now());
  assert.equal(m.running, false);
  assert.equal(m.time, 'sunset');
  assert.equal(dayMix({ time: 'sunset' }, 999).blend, 0);
});

test('запуск цикла продолжает с того времени, что на экране', () => {
  const now = 5_000_000;
  const anchor = anchorFor({ time: 'night' }, now);
  assert.equal(dayMoment({ time: 'night', dayCycle: { running: true, anchor } }, now).time, 'night');
  // И картинка в момент запуска не дёргается.
  assert.deepEqual(
    dayMix({ time: 'night', dayCycle: { running: true, anchor } }, now),
    dayMix({ time: 'night' }, now),
  );
});

test('новая комната создаётся с идущими сутками', () => {
  const s = initialState('Ретро');
  assert.equal(s.dayCycle.running, true);
  assert.equal(dayMoment(s, Date.now()).time, 'day');
});

test('ручной выбор времени останавливает цикл и фиксирует фазу', () => {
  const s = run(initialState('Ретро'), {
    type: 'room.settings',
    patch: { time: 'night' },
  });
  assert.equal(s.time, 'night');
  assert.equal(s.dayCycle.running, false);
  // Через десять минут время всё ещё то, что выбрал ведущий.
  assert.equal(dayMoment(s, Date.now() + 600_000).time, 'night');
});

test('переключатель снова запускает сутки с текущей фазы', () => {
  const fixed = run(initialState('Ретро'), {
    type: 'room.settings',
    patch: { time: 'sunset' },
  });
  const now = Date.now();
  const back = run(fixed, { type: 'room.settings', patch: { dayCycle: true } });
  assert.equal(back.dayCycle.running, true);
  assert.equal(dayMoment(back, now).time, 'sunset');
  // И дальше сутки идут: через 3 минуты — уже ночь.
  assert.equal(dayMoment(back, now + DAY_PHASE_MS).time, 'night');
});

test('остановка цикла фиксирует ту фазу, которую видят участники', () => {
  const started = {
    ...initialState('Ретро'),
    dayCycle: { running: true, anchor: Date.now() - DAY_PHASE_MS * 2.5 },
  };
  assert.equal(dayMoment(started, Date.now()).time, 'sunset');
  const stopped = run(started, {
    type: 'room.settings',
    patch: { dayCycle: false },
  });
  assert.equal(stopped.dayCycle.running, false);
  assert.equal(stopped.time, 'sunset');
});

test('время суток меняет только ведущий', () => {
  assert.throws(
    () => run(initialState('Ретро'), { type: 'room.settings', patch: { dayCycle: false } }, 'guest'),
    /ведущему/,
  );
});

test('недопустимое время суток отвергается', () => {
  assert.throws(
    () => run(initialState('Ретро'), { type: 'room.settings', patch: { time: 'midnight' } }),
    /Недопустимое значение/,
  );
});
